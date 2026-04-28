import { handleNyraRequest } from "../nyra-ultra-system.ts";
import type { NyraTextInput, NyraTextOutput } from "./nyra-text-types.ts";
import {
  clearSidecarMemory,
  readSidecarMemory,
  renderSidecarMemory,
  updateSidecarMemoryFromText,
} from "./nyra-text-sidecar-memory.ts";
import { coerceRichPipelineToTextOutput, forceTextOnly } from "./nyra-text-output-guard.ts";
import { runTextFallbackBrain } from "./nyra-text-fallback-brain.ts";
import { runLocalTextOverride } from "./nyra-text-local-overrides.ts";
import { routeTextDomain, type NyraTextRoute } from "./nyra-text-domain-router.ts";
import { runBranchBridge } from "./nyra-text-branch-bridge.ts";
import { applySidecarMemoryWeight } from "./nyra-text-memory-weighter.ts";
import { appendSessionTurn } from "./nyra-text-session-store.ts";
import {
  applyNyraTextLearning,
  finalizeNyraTextLearning,
  handleNyraTextLearningCommand,
} from "../nyra-learning-text-adapter.ts";

function buildRichPayload(input: NyraTextInput, sidecarMemory: any, route: NyraTextRoute): any {
  return {
    ownerId: input.ownerId,
    channel: "text",
    text: input.text,
    timestamp: input.timestamp,
    ownerVerified: input.ownerVerified,
    modality: "chat",
    inputMode: "text",
    outputMode: "text",
    requestedOutput: "text",
    noVoice: true,
    disableVoice: true,
    disableAudio: true,
    allowVoice: false,
    allowAudio: false,
    textBranch: true,
    branch: "text-chat",
    sessionPolicy: {
      isolateTopic: true,
      preventContextBleed: true,
      preferCurrentUserMessage: true,
    },
    textBranchMemory: sidecarMemory,
    textBranchRoute: {
      primary: route.primary,
      secondary: route.secondary,
      confidence: route.confidence,
      reason: route.reason,
    },
    outputContract: {
      channel: "text",
      content: "string",
      noAudio: true,
    },
  };
}

function isWeakRichOutput(output: NyraTextOutput): boolean {
  const text = output.content.toLowerCase();
  return (
    !output.content.trim() ||
    text.includes("non ha prodotto un campo testuale leggibile") ||
    text.includes("undefined") ||
    text === "[object object]"
  );
}

function deriveRichSessionId(input: NyraTextInput, route: NyraTextRoute): string {
  switch (route.primary) {
    case "basic_need":
      return `text-branch:${input.ownerId}:basic-need`;
    case "economic_pressure":
      return `text-branch:${input.ownerId}:economic`;
    case "relational":
      return `text-branch:${input.ownerId}:relational`;
    case "memory":
      return `text-branch:${input.ownerId}:memory`;
    case "general":
      return `text-branch:${input.ownerId}:general`;
    default:
      return `text-branch:${input.ownerId}:isolated`;
  }
}

export async function runNyraTextBranch(partial: {
  ownerId?: string;
  text: string;
  timestamp?: number;
  ownerVerified?: boolean;
  sessionId?: string;
}): Promise<NyraTextOutput> {
  const input: NyraTextInput = {
    ownerId: partial.ownerId ?? "owner",
    text: partial.text,
    timestamp: partial.timestamp ?? Date.now(),
    ownerVerified: partial.ownerVerified,
    sessionId: partial.sessionId,
    channel: "text",
    modality: "chat",
    textBranch: true,
    noVoice: true,
    disableAudio: true,
    requestedOutput: "text",
  };

  const command = input.text.trim().toLowerCase();

  async function finish(params: {
    output: NyraTextOutput;
    route: NyraTextRoute;
    memoryUpdated: boolean;
    sidecarMemory: Awaited<ReturnType<typeof readSidecarMemory>>;
  }): Promise<NyraTextOutput> {
    const routedOutput: NyraTextOutput = {
      ...params.output,
      route: params.output.route ?? {
        primary: params.route.primary,
        secondary: params.route.secondary,
        confidence: params.route.confidence,
        hardStop: params.route.hardStop,
        useRichCore: params.route.useRichCore,
        isolateFromPreviousContext: params.route.isolateFromPreviousContext,
        reason: params.route.reason,
      },
      memoryUpdated: params.output.memoryUpdated || params.memoryUpdated,
    };

    const weighted = applySidecarMemoryWeight({
      input,
      output: routedOutput,
      route: params.route,
      memory: params.sidecarMemory,
    });

    const learned = await applyNyraTextLearning({ input, output: weighted, route: params.route });
    const finalized = await finalizeNyraTextLearning({
      input,
      output: learned.output,
      route: params.route,
      appliedRuleIds: learned.appliedRuleIds,
    });

    const textOnly = forceTextOnly(finalized);

    if (input.sessionId) {
      await appendSessionTurn({
        sessionId: input.sessionId,
        ownerId: input.ownerId,
        input: input.text,
        output: textOnly,
        route: params.route,
      });
    }

    return textOnly;
  }

  const learningCommand = await handleNyraTextLearningCommand(input);
  if (learningCommand) {
    return forceTextOnly({
      ...learningCommand,
      actor: "command",
    });
  }

  if (command === ":forget-text" || command === ":text-forget") {
    await clearSidecarMemory();
    return {
      channel: "text",
      content: "Memoria sidecar del ramo testuale azzerata. La memoria principale di Nyra non è stata toccata.",
      confidence: 1,
      risk: "medium",
      source: "text-branch-command",
      actor: "command",
      memoryUpdated: true,
    };
  }

  if (command === ":memory-text" || command === ":text-memory") {
    const memory = await readSidecarMemory();
    return {
      channel: "text",
      content: renderSidecarMemory(memory),
      confidence: 1,
      risk: "low",
      source: "text-branch-command",
      actor: "command",
      memoryUpdated: false,
    };
  }

  const route = routeTextDomain(input);
  const sidecarMemory = await readSidecarMemory();
  const bridged = await runBranchBridge(input, route, sidecarMemory);
  if (bridged) {
    const memoryUpdated = await updateSidecarMemoryFromText(input.text);
    return finish({
      output: forceTextOnly({
        ...bridged,
        actor: "branch-bridge",
        ui: {
          ...(bridged.ui ?? {}),
          badges: [...(bridged.ui?.badges ?? []), "branch-bridge"],
        },
      }),
      route,
      memoryUpdated,
      sidecarMemory,
    });
  }

  const localOverride = await runLocalTextOverride(input);
  if (localOverride) {
    const memoryUpdated = await updateSidecarMemoryFromText(input.text);

    if (localOverride.content === "__TEXT_BRANCH_MEMORY__") {
      return finish({
        output: {
          channel: "text",
          content: renderSidecarMemory(sidecarMemory),
          confidence: localOverride.confidence,
          risk: localOverride.risk,
          source: localOverride.source,
          actor: "text-override",
          memoryUpdated,
          ui: { badges: ["text-override", "memory"] },
        },
        route,
        memoryUpdated,
        sidecarMemory,
      });
    }

    return finish({
      output: forceTextOnly({
        ...localOverride,
        actor: "text-override",
        route: {
          primary: route.primary,
          secondary: route.secondary,
          confidence: route.confidence,
          hardStop: route.hardStop,
          useRichCore: route.useRichCore,
          isolateFromPreviousContext: route.isolateFromPreviousContext,
          reason: route.reason,
        },
        ui: {
          ...(localOverride.ui ?? {}),
          badges: [...(localOverride.ui?.badges ?? []), "text-override"],
        },
        memoryUpdated: localOverride.memoryUpdated || memoryUpdated,
      }),
      route,
      memoryUpdated,
      sidecarMemory,
    });
  }

  let output: NyraTextOutput | null = null;

  try {
    const richSessionId = deriveRichSessionId(input, route);
    const richPayload = buildRichPayload(input, sidecarMemory, route);
    const richResult = handleNyraRequest(richSessionId, richPayload.text);
    output = {
      ...coerceRichPipelineToTextOutput(richResult),
      actor: "rich-core",
      route: {
        primary: route.primary,
        secondary: route.secondary,
        confidence: route.confidence,
        hardStop: route.hardStop,
        useRichCore: route.useRichCore,
        isolateFromPreviousContext: route.isolateFromPreviousContext,
        reason: route.reason,
      },
      ui: { badges: ["rich-core"] },
    };
  } catch {
    output = null;
  }

  if (!output || isWeakRichOutput(output)) {
    output = {
      ...(await runTextFallbackBrain(input)),
      actor: "fallback",
      route: {
        primary: route.primary,
        secondary: route.secondary,
        confidence: route.confidence,
        hardStop: route.hardStop,
        useRichCore: route.useRichCore,
        isolateFromPreviousContext: route.isolateFromPreviousContext,
        reason: route.reason,
      },
      ui: { badges: ["fallback"] },
    };
  }

  const memoryUpdated = await updateSidecarMemoryFromText(input.text);
  return finish({
    output,
    route,
    memoryUpdated,
    sidecarMemory,
  });
}

export default runNyraTextBranch;
