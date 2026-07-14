import { pathToFileURL } from "node:url";
import type { NyraActionRoute } from "./nyra-action-router.ts";
import type { NyraBranchOverlay } from "./nyra-branch-overlay.ts";
import type { NyraBranchLearningBundle } from "./nyra-branch-learning.ts";
import type { NyraCore2PipelineResult } from "./nyra-core2-pipeline.ts";
import {
  buildNyraBranchSummaryLine,
  buildNyraRuntimeOverlayBundle,
} from "./nyra-branch-composer.ts";
import { importNyraCodexWorkMemory, summarizeNyraCodexWorkMemory } from "./nyra-codex-memory-importer.ts";
import { buildNyraCodexGuidance, type NyraCodexGuidance } from "./nyra-codex-guidance.ts";
import { appendNyraLocalEvent, type NyraLocalEventWriteResult } from "./nyra-local-event-emitter.ts";
import {
  getNyraOwnerPrivateMemoryStatus,
  queryNyraOwnerPrivateMemory,
  type NyraOwnerMemoryEntry,
  type NyraOwnerMemoryStatus,
} from "./nyra-owner-private-memory.ts";
import { buildNyraOperationalDiagnosis, type NyraOperationalDiagnosis } from "./nyra-operational-diagnosis.ts";
import { buildNyraRichChat, type NyraRichChatResult } from "./nyra-rich-chat.ts";
import type { NyraCortexGraph } from "./nyra-cortex-graph.ts";
import {
  buildNyraVectorRetrievalPolicy,
  summarizeNyraVectorMemory,
  summarizeNyraVectorRetrievalContext,
} from "./nyra-vector-memory.ts";

export type NyraLocalGovernanceInput = {
  user_text: string;
  root_dir?: string;
  write_event?: boolean;
  session_id?: string;
};

export type NyraLocalGovernanceResult = {
  mode: "local_governance";
  local_only: true;
  render_touched: false;
  reply: string;
  rich_chat: NyraRichChatResult;
  branch_overlay: NyraBranchOverlay;
  branch_learning?: NyraBranchLearningBundle;
  action_route: NyraActionRoute;
  core2_pipeline: NyraCore2PipelineResult;
  cortex_graph?: NyraCortexGraph;
  owner_private_memory: {
    status: NyraOwnerMemoryStatus;
    matches: NyraOwnerMemoryEntry[];
  };
  operational_diagnosis: NyraOperationalDiagnosis;
  codex_guidance: NyraCodexGuidance;
  codex_work_memory: {
    path: string;
    summary: string;
    stats: {
      event_lines_seen: number;
      events_imported: number;
      task_contracts_imported: number;
      final_reports_imported: number;
    };
  };
  semantic_memory: {
    summary: string;
    retrieval: string;
  };
  event?: {
    path: string;
    ts: string;
    type: string;
  };
};

function compact(text: string, maxLength = 360): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function buildReply(input: {
  richChat: NyraRichChatResult;
  overlay: NyraBranchOverlay;
  branchLearning?: NyraBranchLearningBundle;
  route: NyraActionRoute;
  core2Pipeline: NyraCore2PipelineResult;
  cortexGraph?: NyraCortexGraph;
  diagnosis: NyraOperationalDiagnosis;
  guidance: NyraCodexGuidance;
  codexWorkMemory: NyraLocalGovernanceResult["codex_work_memory"];
  semanticMemory: NyraLocalGovernanceResult["semantic_memory"];
  memoryMatches: NyraOwnerMemoryEntry[];
  event?: NyraLocalEventWriteResult;
}): string {
  const renderLine = input.overlay.render_protected
    ? "Render resta protetto: qui non lo tocco."
    : "Perimetro locale: nessun Render coinvolto.";
  const eventLine = input.event ? `Evento locale scritto: ${input.event.path}.` : "Evento locale non scritto per scelta runtime.";
  const routeLine = `${buildNyraBranchSummaryLine({
    branch_overlay: input.overlay,
    branch_learning: input.branchLearning,
    action_route: input.route,
    core2_pipeline: input.core2Pipeline,
    cortex_graph: input.cortexGraph,
  })} Rischio route: ${input.route.risk_band}.`;
  const coreLine = `Core 2.0: ${input.core2Pipeline.winner.control_level} · V1 ${input.core2Pipeline.stages.v1.control_level} · V2 ${input.core2Pipeline.stages.v2.control_level} · V7 ${input.core2Pipeline.stages.v7.path_label}. Nyra spiega, Core decide.`;
  const memoryLine = input.memoryMatches.length
    ? `Memoria owner richiamata: ${input.memoryMatches.slice(0, 2).map((entry) => entry.summary).join(" | ")}.`
    : "Memoria owner privata: nessun richiamo utile ancora.";
  const codexMemoryLine = input.codexWorkMemory.summary
    ? `Memoria Codex: ${input.codexWorkMemory.summary}.`
    : "Memoria Codex: non ancora disponibile.";
  const semanticLine = input.semanticMemory.retrieval || `Layer vettoriale locale: ${input.semanticMemory.summary}.`;
  const missingLine = `Manca ora: ${input.diagnosis.missing_now.slice(0, 2).join(" ; ")}.`;

  return [
    input.richChat.reply,
    renderLine,
    routeLine,
    coreLine,
    `Guida Codex: ${input.guidance.first_moves.slice(0, 3).join(" ")}`,
    codexMemoryLine,
    semanticLine,
    memoryLine,
    missingLine,
    eventLine,
  ].join(" ");
}

export async function buildNyraLocalGovernance(input: NyraLocalGovernanceInput): Promise<NyraLocalGovernanceResult> {
  const rootDir = input.root_dir ?? process.cwd();
  const codexMemoryImport = importNyraCodexWorkMemory({
    root_dir: rootDir,
    populate_owner_private: false,
  });
  const codexWorkMemory = {
    path: codexMemoryImport.path,
    summary: summarizeNyraCodexWorkMemory(rootDir),
    stats: {
      event_lines_seen: codexMemoryImport.memory.stats.event_lines_seen,
      events_imported: codexMemoryImport.memory.stats.events_imported,
      task_contracts_imported: codexMemoryImport.memory.stats.task_contracts_imported,
      final_reports_imported: codexMemoryImport.memory.stats.final_reports_imported,
    },
  };
  const richChat = await buildNyraRichChat({
    user_text: input.user_text,
    root_dir: rootDir,
    primary_action: "leggere la richiesta, sovrapporre i rami, fissare il perimetro locale e guidare Codex senza toccare Render",
    action_labels: [
      "sovrapporre rami Nyra/Core/Codex",
      "scrivere evento locale redatto",
      "preparare verifica end-to-end locale",
    ],
  });
  const overlayBundle = buildNyraRuntimeOverlayBundle(input.user_text, rootDir);
  const branchOverlay = overlayBundle.branch_overlay;
  const branchLearning = overlayBundle.branch_learning;
  const actionRoute = overlayBundle.action_route;
  const core2Pipeline = overlayBundle.core2_pipeline;
  const ownerMemoryStatus = getNyraOwnerPrivateMemoryStatus(rootDir);
  const ownerMemoryMatches = queryNyraOwnerPrivateMemory({
    root_dir: rootDir,
    query: input.user_text,
    limit: 3,
  });
  const operationalDiagnosis = buildNyraOperationalDiagnosis({
    rich_chat: richChat,
    overlay: branchOverlay,
    action_route: actionRoute,
    owner_memory_status: ownerMemoryStatus,
  });
  const codexGuidance = buildNyraCodexGuidance({
    user_text: input.user_text,
    overlay: branchOverlay,
    rich_chat: richChat,
  });
  const vectorPolicy = buildNyraVectorRetrievalPolicy({
    user_text: input.user_text,
    branch_overlay: branchOverlay,
    action_route: actionRoute,
  });
  const semanticMemory = {
    summary: summarizeNyraVectorMemory(rootDir),
    retrieval: summarizeNyraVectorRetrievalContext({
      root_dir: rootDir,
      query: vectorPolicy.query,
      limit: 2,
      domain_allowlist: vectorPolicy.domain_allowlist,
      preferred_domains: vectorPolicy.preferred_domains,
      scope_allowlist: vectorPolicy.scope_allowlist,
      tags_any: vectorPolicy.tags_any,
      exclude_private: true,
      min_score: vectorPolicy.min_score,
    }),
  };

  const shouldWriteEvent = input.write_event ?? process.env.NYRA_LOCAL_GOVERNANCE_EVENT !== "0";
  const event = shouldWriteEvent
    ? appendNyraLocalEvent({
        root_dir: rootDir,
        type: "nyra.local_governance",
        actor: "nyra",
        source: "universal-core-2.0",
        session_id: input.session_id,
        summary: compact(input.user_text),
        payload: {
          user_text_preview: compact(input.user_text),
          rich_chat_provider: richChat.provider,
          rich_chat_validator: richChat.validator,
          generative: richChat.generative,
          action_route: actionRoute,
          core2_pipeline: core2Pipeline,
          cortex_graph: overlayBundle.cortex_graph,
          owner_private_memory_status: ownerMemoryStatus,
          owner_private_memory_matches: ownerMemoryMatches.map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            tags: entry.tags,
            confidence: entry.confidence,
          })),
          codex_work_memory: codexWorkMemory,
          semantic_memory: semanticMemory,
          operational_diagnosis: operationalDiagnosis,
          local_only: true,
          render_touched: false,
        },
        branch_overlay: branchOverlay,
        codex_guidance: codexGuidance,
      })
    : undefined;

  return {
    mode: "local_governance",
    local_only: true,
    render_touched: false,
    reply: buildReply({
    richChat,
    overlay: branchOverlay,
    branchLearning,
    route: actionRoute,
      core2Pipeline,
      diagnosis: operationalDiagnosis,
      guidance: codexGuidance,
      codexWorkMemory,
      semanticMemory,
      cortexGraph: overlayBundle.cortex_graph,
      memoryMatches: ownerMemoryMatches,
      event,
    }),
    rich_chat: richChat,
    branch_overlay: branchOverlay,
    branch_learning: branchLearning,
    action_route: actionRoute,
    core2_pipeline: core2Pipeline,
    cortex_graph: overlayBundle.cortex_graph,
    owner_private_memory: {
      status: ownerMemoryStatus,
      matches: ownerMemoryMatches,
    },
    operational_diagnosis: operationalDiagnosis,
    codex_guidance: codexGuidance,
    codex_work_memory: codexWorkMemory,
    semantic_memory: semanticMemory,
    ...(event ? { event: { path: event.path, ts: event.event.ts, type: event.event.type } } : {}),
  };
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const noEvent = args.includes("--no-event");
  const userText = args.filter((arg) => arg !== "--json" && arg !== "--no-event").join(" ").trim();

  if (!userText) {
    console.log("Nyra Local Governance pronta. Passa una richiesta o usa --json.");
    return;
  }

  const result = await buildNyraLocalGovernance({
    user_text: userText,
    root_dir: process.cwd(),
    write_event: !noEvent,
  });
  console.log(json ? JSON.stringify(result, null, 2) : result.reply);
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
  await runCli();
}
