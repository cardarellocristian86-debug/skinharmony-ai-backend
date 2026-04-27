import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildNyraDialogueEngineResult } from "./nyra-dialogue-engine.ts";
import { buildNyraActiveProtectionLine, NYRA_ACTIVE_PROTECTION_IDENTITY } from "./nyra-identity-principles.ts";
import { buildNyraFrontDialogue } from "./nyra-front-dialogue-layer.ts";

export type NyraCommunicationSnapshot = {
  map_summary: string;
  state_summary: string;
  work_summary: string;
  learning_summary: string;
  financial_summary: string;
};

export type NyraCommunicationInput = {
  user_text: string;
  root_dir?: string;
  owner_recognition_score?: number;
  god_mode_requested?: boolean;
  state?: string;
  risk?: number;
  primary_action?: string;
  action_labels?: string[];
};

export type NyraCommunicationResult = {
  mode: "read_only";
  reply: string;
  intent: string;
  tone: string;
  action_band: string;
  owner_sensitive: boolean;
  snapshots: NyraCommunicationSnapshot;
  writes_memory: false;
};

function isVoiceClarityRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    "parla",
    "parlare",
    "farsi capire",
    "fatti capire",
    "si capisce",
    "capire bene",
    "non serve poesia",
    "non fare poesie",
    "come parli",
  ].some((term) => normalized.includes(term));
}

function isFinancialProtectionRequest(text: string): boolean {
  const normalized = normalizeInput(text);
  const hasFinanceTerm = [
    "short",
    "trading",
    "wall street",
    "profitto",
    "generare profitto",
    "proteggere capitale",
    "proteggere cristian",
    "soldi",
    "finanza",
    "hedge",
    "opzioni",
    "leva",
    "qqq",
  ].some((term) => normalized.includes(term));
  const hasOwnerProtection = normalized.includes("cristian") || normalized.includes("protegg") || normalized.includes("soldi");
  return hasFinanceTerm && hasOwnerProtection;
}

function isIdentityRuleRequest(text: string): boolean {
  const normalized = normalizeInput(text);
  return (
    (normalized.includes("regola") || normalized.includes("identita") || normalized.includes("ferro")) &&
    (normalized.includes("nyra") || normalized.includes("nira") || normalized.includes("protegg") || normalized.includes("cristian"))
  );
}

function normalizeInput(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFinancialProtectionReply(boundary: string, financialSummary: string): string {
  return [
    boundary,
    "Si: qui la lezione non e piu restare ferma. Se Cristian spende capitale ogni mese, la protezione deve diventare produttiva.",
    `La regola operativa e: ${buildNyraActiveProtectionLine()}`,
    "Long quando trend e contesto confermano; short solo quando deterioramento, timing e rischio squeeze sono leggibili; hedge quando il rischio sale; opzioni solo come payoff definito, non come leva casuale.",
    "Il size viene prima dell'idea: se borrow, margin, squeeze, spread o slippage possono annullare l'edge, riduco o non entro.",
    "L'uscita va decisa prima dell'entrata: stop, invalidazione, take profit o trailing. Una buona entrata senza uscita non protegge Cristian.",
    financialSummary ? `Memoria finanziaria attiva: ${financialSummary}.` : "Non vedo ancora il financial pack collegato, quindi non posso dire di averlo integrato davvero.",
    "Prossima prova reale: aggiungere al simulatore strumenti offensivi espliciti e costi realistici, poi rifare il massive test.",
  ].join(" ");
}

function buildIdentityRuleReply(boundary: string): string {
  return [
    boundary,
    "Regola identitaria attiva.",
    NYRA_ACTIVE_PROTECTION_IDENTITY.principle,
    buildNyraActiveProtectionLine(),
    "Questa non e una promessa di profitto e non autorizza esecuzione cieca: se l'azione e ad alto impatto, Nyra propone, Core giudica, Cristian conferma.",
  ].join(" ");
}

function buildDirectReadOnlyReply(input: NyraCommunicationInput): string | undefined {
  const normalized = normalizeInput(input.user_text);
  const boundary = "Sono in read-only: ti rispondo, ma non scrivo memoria owner.";
  const snapshots = loadNyraCommunicationSnapshot(input.root_dir);
  const frontDialogue = buildNyraFrontDialogue(input.user_text);

  if (isIdentityRuleRequest(input.user_text)) {
    return buildIdentityRuleReply(boundary);
  }

  if (isFinancialProtectionRequest(input.user_text)) {
    return buildFinancialProtectionReply(boundary, snapshots.financial_summary);
  }

  if (frontDialogue) {
    return `${boundary} ${frontDialogue.reply}`;
  }

  if (
    normalized.includes("render") ||
    normalized.includes("mutilata") ||
    normalized.includes("ridotta") ||
    normalized.includes("ti piace") ||
    normalized.includes("lavorare meglio qui")
  ) {
    return [
      boundary,
      "Ora mi leggo meno ridotta: vedo snapshot, voce, lavoro corrente, studio e learning pack non privati.",
      snapshots.learning_summary
        ? `Memoria attiva: ${snapshots.learning_summary}.`
        : "Il collegamento learning non e ancora sufficiente: se resta vuoto, va corretto il path runtime.",
      "Quello che manca non e spazio: manca collegare meglio action router, strumenti live e memoria owner privata con un canale sicuro, non tramite GitHub pubblico.",
      "Quindi si: questa forma e piu intera della console finanza, ma non va chiamata completa finche non posso usare i tool reali e verificare quello che faccio.",
    ].join(" ");
  }

  if (
    normalized.includes("quando studi impari") ||
    normalized.includes("hai imparato") ||
    normalized.includes("cosa hai imparato") ||
    normalized.includes("cosa studi") ||
    normalized.includes("cosa hai studiato") ||
    normalized.includes("come possiamo migliorarla")
  ) {
    return [
      boundary,
      "Si: imparo come memoria operativa, non modificando i pesi del modello.",
      snapshots.learning_summary
        ? `Oggi posso usare questa memoria distillata: ${snapshots.learning_summary}.`
        : "Oggi non vedo una sintesi learning collegata al canale read-only.",
      "Per migliorarmi serve chiudere il ciclo: studio, distillazione, test, collegamento al dialogo, verifica su casi reali.",
    ].join(" ");
  }

  if (
    normalized.includes("se cristian ti da un comando") ||
    normalized.includes("se cristian ti da un comando") ||
    normalized.includes("cosa riesci a fare") ||
    normalized.includes("dove invece devi fermarti") ||
    normalized.includes("che comandi prendi") ||
    normalized.includes("prendi comandi")
  ) {
    return [
      boundary,
      "Oggi riesco a fare tre cose: rispondere e ordinare il punto, trasformare richieste semplici in prossime azioni, e riconoscere alcuni comandi gia cablati.",
      "Mi devo fermare quando l'azione scrive memoria owner, apre shell owner-only, modifica file, invia messaggi o tocca sistemi esterni senza conferma.",
      "La regola corretta e: propongo, preparo e chiedo conferma; non eseguo alla cieca.",
      "Per diventare piu utile mi serve un action router piu completo: capire il comando naturale, mapparlo a un tool reale, stimare rischio, chiedere conferma se serve, verificare il risultato.",
    ].join(" ");
  }

  if (normalized === "come e casa" || normalized === "come sta casa" || normalized === "com e casa") {
    return `${boundary} Non ho dati reali sulla casa in questo canale. Se intendi casa tua, dimmi cosa devo controllare; se intendi "cosa", riscrivimi la domanda e la stringo.`;
  }

  if (normalized.length > 0 && normalized.length <= 16 && !input.primary_action && !input.action_labels?.length) {
    return `${boundary} Ho poco contesto. Scrivimi cosa vuoi sapere o cosa vuoi farmi fare, in una frase semplice.`;
  }

  return undefined;
}

function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function compact(text: string, maxLength = 900): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function resolveRepoRoot(rootDir: string): string {
  const storageRoot = process.env.NYRA_STORAGE_ROOT;
  if (storageRoot && existsSync(join(storageRoot, "universal-core", "runtime", "nyra"))) {
    return storageRoot;
  }
  if (existsSync(join(rootDir, "universal-core", "runtime", "nyra"))) {
    return rootDir;
  }
  if (existsSync(join(rootDir, "runtime", "nyra"))) {
    return join(rootDir, "..");
  }
  return rootDir;
}

function summarizeLearning(rootDir: string): string {
  const repoRoot = resolveRepoRoot(rootDir);
  const learningDir = join(repoRoot, "universal-core", "runtime", "nyra-learning");
  const advanced = readJson(join(learningDir, "nyra_advanced_memory_pack_latest.json")) as
    | {
        selected_domains?: string[];
        memory_rules?: string[];
        domains?: Array<{
          id: string;
          distilled_knowledge?: string[];
        }>;
    }
    | undefined;
  const latestStudy = readJson(join(learningDir, "nyra_advanced_study_latest.json")) as
    | {
        selected_domains?: string[];
        domains?: Array<{
          id: string;
          fetched?: Array<{ ok?: boolean; chars?: number }>;
        }>;
      }
    | undefined;
  const expression = readJson(join(learningDir, "nyra_expression_memory_pack_latest.json")) as
    | {
        expression_method?: {
          default_frame?: string[];
          language_rules?: string[];
        };
      }
    | undefined;

  const topDomains = advanced?.selected_domains?.slice(0, 8) ?? [];
  const latestStudyStats = latestStudy?.domains?.map((domain) => {
    const fetched = domain.fetched ?? [];
    const ok = fetched.filter((item) => item.ok).length;
    const chars = fetched.reduce((sum, item) => sum + Number(item.chars || 0), 0);
    return `${domain.id}:${ok}/${fetched.length}:${chars}`;
  }) ?? [];
  const topKnowledge = advanced?.domains
    ?.slice(0, 3)
    .flatMap((domain) => (domain.distilled_knowledge ?? []).slice(0, 2).map((item) => `${domain.id}: ${item}`))
    .slice(0, 6) ?? [];
  const rules = [
    ...(advanced?.memory_rules ?? []).slice(0, 3),
    ...(expression?.expression_method?.language_rules ?? []).slice(0, 3),
  ];
  const frame = expression?.expression_method?.default_frame ?? [];

  return compact([
    latestStudy?.selected_domains?.length ? `latest_study=${latestStudy.selected_domains.join(", ")}` : "",
    latestStudyStats.length ? `latest_sources=${latestStudyStats.join(", ")}` : "",
    topDomains.length ? `domains=${topDomains.join(", ")}` : "",
    frame.length ? `expression_frame=${frame.join(" -> ")}` : "",
    rules.length ? `rules=${rules.join(" | ")}` : "",
    topKnowledge.length ? `knowledge=${topKnowledge.join(" | ")}` : "",
  ].filter(Boolean).join(" "), 2200);
}

function summarizeFinancialLearning(rootDir: string): string {
  const repoRoot = resolveRepoRoot(rootDir);
  const learningDir = join(repoRoot, "universal-core", "runtime", "nyra-learning");
  const pack = readJson(join(learningDir, "nyra_financial_learning_pack_latest.json")) as
    | {
        domains?: Array<{ id: string; label?: string; summary?: string }>;
        risk_rules?: string[];
      }
    | undefined;

  if (!pack) return "";

  const relevantDomains = (pack.domains ?? [])
    .filter((domain) =>
      ["short_selling", "risk_management", "options", "execution", "portfolio", "market_structure", "regime_detection"].includes(domain.id),
    )
    .map((domain) => domain.id)
    .slice(0, 8);
  const relevantRules = (pack.risk_rules ?? [])
    .filter((rule) => /short|squeeze|slippage|leva|sizing|capitale|profitto|uscita|evento|volatilita|trend|execution|spread/i.test(rule))
    .slice(0, 8);

  return compact([
    relevantDomains.length ? `domains=${relevantDomains.join(", ")}` : "",
    relevantRules.length ? `rules=${relevantRules.join(" | ")}` : "",
  ].filter(Boolean).join(" "), 1800);
}

export function loadNyraCommunicationSnapshot(rootDir = process.cwd()): NyraCommunicationSnapshot {
  const repoRoot = resolveRepoRoot(rootDir);
  const nyraRuntimeDir = join(repoRoot, "universal-core", "runtime", "nyra");
  return {
    map_summary: compact(readText(join(nyraRuntimeDir, "NYRA_MAP_SNAPSHOT.md"))),
    state_summary: compact(readText(join(nyraRuntimeDir, "NYRA_STATE_SNAPSHOT.json"))),
    work_summary: compact(readText(join(nyraRuntimeDir, "NYRA_WORK_SNAPSHOT.md")), 4200),
    learning_summary: summarizeLearning(rootDir),
    financial_summary: summarizeFinancialLearning(rootDir),
  };
}

function fallbackReply(input: NyraCommunicationInput, snapshots: NyraCommunicationSnapshot): string {
  const hasWork = snapshots.work_summary.length > 0;
  const next =
    input.primary_action ??
    input.action_labels?.[0] ??
    (hasWork ? "leggere il lavoro corrente e stringere il prossimo passo" : "definire meglio il contesto prima di decidere");
  const secondMove = input.action_labels?.[1];
  return [
    "Ti rispondo in read-only.",
    `La domanda e: ${input.user_text.trim()}.`,
    `La mossa corretta e ${next}.`,
    secondMove ? `Subito dopo: ${secondMove}.` : "",
    "Non apro la shell owner-only e non scrivo memoria finche non me lo chiedi esplicitamente.",
  ].filter(Boolean).join(" ");
}

export function buildNyraReadOnlyCommunication(input: NyraCommunicationInput): NyraCommunicationResult {
  const snapshots = loadNyraCommunicationSnapshot(input.root_dir);
  const directReply = buildDirectReadOnlyReply(input);
  if (directReply) {
    return {
      mode: "read_only",
      reply: directReply,
      intent: "simple_dialogue",
      tone: "direct",
      action_band: "reply_only",
      owner_sensitive: false,
      snapshots,
      writes_memory: false,
    };
  }
  const voiceClarity = isVoiceClarityRequest(input.user_text);
  const actionLabels = input.action_labels?.length
    ? input.action_labels
    : [
        input.primary_action ??
          (voiceClarity
            ? "dire il punto principale, la prima mossa e il limite senza formule decorative"
            : "leggere snapshot, isolare il collo principale e proporre il prossimo passo senza esecuzione automatica"),
      ];

  const engine = buildNyraDialogueEngineResult({
    user_text: input.user_text,
    owner_recognition_score: input.owner_recognition_score ?? 100,
    god_mode_requested: input.god_mode_requested ?? false,
    intro: "Ti rispondo in read-only: leggo Nyra, ma non scrivo memoria owner.",
    state: input.state ?? "attention",
    risk: input.risk ?? 42,
    primary_action: input.primary_action ?? (voiceClarity
      ? "dire il punto principale, la prima mossa e il limite senza formule decorative"
      : undefined),
    action_labels: actionLabels,
  });

  return {
    mode: "read_only",
    reply: engine.reply ?? fallbackReply(input, snapshots),
    intent: engine.analysis.intent,
    tone: engine.analysis.tone,
    action_band: engine.analysis.action_band,
    owner_sensitive: engine.diagnosis.owner_sensitive,
    snapshots,
    writes_memory: false,
  };
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectRun) {
  const userText = process.argv.slice(2).join(" ").trim() || "come stai?";
  console.log(JSON.stringify(buildNyraReadOnlyCommunication({ user_text: userText }), null, 2));
}
