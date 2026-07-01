import { runNyraTextBranch } from "./nyra-text-branch/nyra-text-runtime.ts";
import type { NyraTextChatOutput } from "./nyra-text-chat-types.ts";
import { summarizeNyraVectorMemory, summarizeNyraVectorRetrievalContext } from "./nyra-vector-memory.ts";
import { semanticDomainAllowlistForPrompt } from "./nyra-semantic-router.ts";

function buildHelpMessage(): string {
  return [
    "Modalita attiva: chat testuale locale.",
    "Comandi disponibili:",
    "- :help",
    "- :memory",
    "- :memory-json",
    "- :forget",
    "- :learn chiave=valore",
    "- :learning",
    "- :good",
    "- :bad",
    "- :wrong <correzione>",
    "- :teach <regola>",
    "- :clear-learning",
    "- Ricorda che ...",
  ].join("\n");
}

export async function runNyraTextChatTurn(text: string, sessionId = "nyra-text-chat"): Promise<NyraTextChatOutput> {
  const trimmed = text.trim();
  const command = trimmed.toLowerCase();

  if (!trimmed) {
    return {
      content: "Scrivimi il punto reale e lo stringo in testo chiaro.",
      confidence: 1,
      risk: "low",
      memoryUpdated: false,
      source: "command",
    };
  }

  if (command === ":help") {
    return {
      content: buildHelpMessage(),
      confidence: 1,
      risk: "low",
      memoryUpdated: false,
      source: "command",
    };
  }

  if (command === ":forget") {
    const result = await runNyraTextBranch({
      ownerId: sessionId,
      text: ":forget-text",
    });
    return {
      content: result.content,
      confidence: result.confidence,
      risk: result.risk,
      memoryUpdated: result.memoryUpdated,
      source: result.source,
    };
  }

  if (command === ":memory") {
    const result = await runNyraTextBranch({
      ownerId: sessionId,
      text: ":memory-text",
    });
    return {
      content: result.content,
      confidence: result.confidence,
      risk: result.risk,
      memoryUpdated: result.memoryUpdated,
      source: result.source,
    };
  }

  if (command === ":memory-json") {
    const result = await runNyraTextBranch({
      ownerId: sessionId,
      text: ":memory-text",
    });
    return {
      content: result.content,
      confidence: result.confidence,
      risk: result.risk,
      memoryUpdated: result.memoryUpdated,
      source: result.source,
    };
  }

  const result = await runNyraTextBranch({
    ownerId: sessionId,
    text: trimmed,
  });

  const semanticMemorySummary = summarizeNyraVectorMemory(process.cwd());
  const semanticRetrieval = summarizeNyraVectorRetrievalContext({
    root_dir: process.cwd(),
    query: trimmed,
    limit: 2,
    domain_allowlist: semanticDomainAllowlistForPrompt(trimmed),
    exclude_private: true,
    min_score: 0.5,
  });

  return {
    ...(result as any),
    content: [result.content, semanticRetrieval].filter(Boolean).join(" ").trim(),
    confidence: result.confidence,
    risk: result.risk,
    memoryUpdated: result.memoryUpdated,
    source: result.source,
    ui: {
      ...(((result as any).ui || {}) as Record<string, unknown>),
      notes: [
        `Memoria semantica: ${semanticMemorySummary}`,
        ...((((result as any).ui?.notes || []) as string[])),
      ],
    },
  };
}
