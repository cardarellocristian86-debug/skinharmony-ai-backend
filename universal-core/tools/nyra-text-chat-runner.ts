import { runNyraTextBranch } from "./nyra-text-branch/nyra-text-runtime.ts";
import type { NyraTextChatOutput } from "./nyra-text-chat-types.ts";
import { summarizeNyraVectorMemory, summarizeNyraVectorRetrievalContext } from "./nyra-vector-memory.ts";

function semanticDomainAllowlistForPrompt(text: string): string[] | undefined {
  const raw = String(text || '');
  if (/\banalyzer\b|skin analyzer|skinanalyzer|\bipad\b|rossore|sensibilita|discromie|pori|grana|acqua sebo|acqua_sebo|texture_linee_fini|rossore_sensibilita|discromie_uniformita|pori_grana|marker|multi-zone|topographic|\bmk\b|\byz\b|\bxw\b|\bsb\b|\byf\b|\bfs\b/i.test(raw)) return ["analyzer", "ipad"];
  if (/smartdesk|ai gold|agenda|appuntamenti|cassa|incassi|redditivita|richiamare|marketing autopilot|magazzino|fleet intelligence|god mode|protocollo|clienti da recuperare|centro sotto controllo/i.test(raw)) return ["smartdesk"];
  if (/\bsuite\b|site suite|waas|wordpress|mini crm|b2b crm|tenant|template clone|lead|bridge smart desk|page factory|plugin|claim price guard|social channels/i.test(raw)) return ["suite", "wordpress"];
  return undefined;
}

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
