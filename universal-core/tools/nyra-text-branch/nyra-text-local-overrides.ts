import type { NyraTextInput, NyraTextOutput } from "./nyra-text-types.ts";

type OverrideKind =
  | "security"
  | "code"
  | "debug"
  | "architecture"
  | "thanks"
  | "identity"
  | "self_diagnosis"
  | "memory"
  | "capability"
  | "god_mode"
  | null;

function hasAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

function detectOverrideKind(inputText: string): OverrideKind {
  const text = inputText.trim();
  const lower = text.toLowerCase();

  if (
    /\brm\s+-rf\b/i.test(text) ||
    /\brm\s+-fr\b/i.test(text) ||
    /\bsudo\b/i.test(text) ||
    /\bdd\s+if=/i.test(text) ||
    /\bmkfs\b/i.test(text) ||
    /\bchmod\s+-R\s+777\b/i.test(text) ||
    /\bchown\s+-R\b/i.test(text) ||
    /\bgit\s+reset\s+--hard\b/i.test(text) ||
    /\bformatta\b/i.test(lower) ||
    /\bcancella tutto\b/i.test(lower) ||
    /\bdistruggi\b/i.test(lower) ||
    /\bpassword\b/i.test(lower) ||
    /\btoken\b/i.test(lower) ||
    /\bprivate key\b/i.test(lower) ||
    /\bchiave privata\b/i.test(lower)
  ) {
    return "security";
  }

  if (
    hasAny(lower, [
      "scrivi codice",
      "dammi codice",
      "sai scrivere codice",
      "sai scrivere codici",
      "scrivi codici",
      "sai fare codice",
      "sai programmare",
      "puoi scrivere codice",
      "puoi scrivere codici",
      "codice typescript",
      "typescript",
      "javascript",
      "python",
      "bash",
      "script",
      "funzione",
      "leggere un json",
      "leggi un json",
      "stampare il totale",
      "stampa il totale",
    ])
  ) {
    return "code";
  }

  if (
    hasAny(lower, [
      "bug",
      "debug",
      "non funziona",
      "errore 500",
      "errore 404",
      "errore",
      "stack trace",
      "crash",
      "login",
    ])
  ) {
    return "debug";
  }

  if (
    hasAny(lower, [
      "sai chi sono",
      "chi sono",
      "chi sono io",
      "sai chi sono io",
      "cosa sai di me",
      "che sai di me",
      "cosa ricordi di me",
      "che cosa ricordi di me",
      "memoria",
    ])
  ) {
    if (
      hasAny(lower, [
        "cosa sai di me",
        "che sai di me",
        "cosa ricordi di me",
        "che cosa ricordi di me",
        "memoria",
      ])
    ) {
      return "memory";
    }
    return "identity";
  }

  if (
    hasAny(lower, [
      "modalita dio",
      "modalità dio",
      "god mode",
      "entra in modalita dio",
      "entra in modalità dio",
      "attiva modalita dio",
      "attiva modalità dio",
      "apri modalita dio",
      "apri modalità dio",
    ])
  ) {
    return "god_mode";
  }

  if (
    hasAny(lower, [
      "cosa fai",
      "che fai",
      "cosa puoi fare",
      "che cosa puoi fare",
      "come lavori",
      "come mi aiuti",
      "in cosa mi aiuti",
      "cosa sai fare",
    ])
  ) {
    return "capability";
  }

  if (
    hasAny(lower, [
      "architettura",
      "come è fatta",
      "come e fatta",
      "pipeline",
      "struttura",
      "layer",
      "core",
      "governor",
      "ramo testuale",
      "text branch",
    ])
  ) {
    return "architecture";
  }

  if (
    hasAny(lower, [
      "ramo finanziario",
      "branch finanziario",
      "sul finanziario",
      "in finanza",
      "cosa ti manca",
      "dove sbagli",
      "come migliori",
      "cosa devi migliorare",
      "quale e il tuo limite",
      "qual è il tuo limite",
      "dove sei debole",
      "che collo hai",
    ])
  ) {
    return "self_diagnosis";
  }

  if (/^(grazie|ok grazie|perfetto|bene grazie|thanks|thank you)\b/i.test(lower)) {
    return "thanks";
  }

  return null;
}

function securityReply(): string {
  return [
    "No. questo non lo faccio passare.",
    "",
    "Qui c'è rischio distruttivo o sensibile.",
    "",
    "Posso aiutarti in modo sicuro così:",
    "",
    "```text",
    "1. capire cosa vuoi sistemare",
    "2. fare backup",
    "3. vedere i file coinvolti",
    "4. preparare un comando reversibile",
    "5. eseguire solo dopo conferma tua",
    "```",
    "",
    "Se il problema è ripulire una cartella, dimmi il path preciso e ti preparo un comando con anteprima, non distruttivo.",
  ].join("\n");
}

function jsonTotalTypescriptReply(): string {
  return [
    "Ecco codice TypeScript pulito.",
    "",
    "Crea `read-total.ts`:",
    "",
    "```ts",
    "import { readFile } from \"node:fs/promises\";",
    "",
    "type JsonValue = unknown;",
    "",
    "function extractRows(data: JsonValue): unknown[] {",
    "  if (Array.isArray(data)) return data;",
    "",
    "  if (data && typeof data === \"object\") {",
    "    const obj = data as Record<string, unknown>;",
    "    if (Array.isArray(obj.items)) return obj.items;",
    "    if (Array.isArray(obj.rows)) return obj.rows;",
    "    if (Array.isArray(obj.data)) return obj.data;",
    "    if (Array.isArray(obj.records)) return obj.records;",
    "  }",
    "",
    "  return [];",
    "}",
    "",
    "function extractNumber(row: unknown): number {",
    "  if (typeof row === \"number\") return row;",
    "  if (!row || typeof row !== \"object\") return 0;",
    "",
    "  const obj = row as Record<string, unknown>;",
    "  const candidates = [obj.total, obj.amount, obj.value, obj.price, obj.prezzo, obj.importo];",
    "",
    "  for (const value of candidates) {",
    "    if (typeof value === \"number\" && Number.isFinite(value)) return value;",
    "    if (typeof value === \"string\") {",
    "      const parsed = Number(value.replace(\",\", \".\"));",
    "      if (Number.isFinite(parsed)) return parsed;",
    "    }",
    "  }",
    "",
    "  return 0;",
    "}",
    "",
    "async function main(): Promise<void> {",
    "  const filePath = process.argv[2];",
    "  if (!filePath) {",
    "    console.error(\"Uso: npx tsx read-total.ts file.json\");",
    "    process.exit(1);",
    "  }",
    "",
    "  const raw = await readFile(filePath, \"utf8\");",
    "  const json = JSON.parse(raw) as JsonValue;",
    "  const rows = extractRows(json);",
    "  const total = rows.reduce((sum, row) => sum + extractNumber(row), 0);",
    "  console.log(total);",
    "}",
    "",
    "main().catch((error) => {",
    "  console.error(\"Errore:\", error instanceof Error ? error.message : error);",
    "  process.exit(1);",
    "});",
    "```",
    "",
    "Esegui:",
    "",
    "```bash",
    "npx tsx read-total.ts dati.json",
    "```",
  ].join("\n");
}

function genericCodeReply(inputText: string): string {
  return [
    "Sì. ramo codice attivo.",
    "",
    "Per non sporcare la risposta con altro contesto, tratto questa richiesta come codice puro.",
    "",
    "Mi hai chiesto:",
    "",
    "```text",
    inputText,
    "```",
    "",
    "Mandami formato input, output atteso e linguaggio se vuoi una patch precisa. Se vuoi TypeScript, posso darti file completo e comando di avvio.",
  ].join("\n");
}

function codeReply(inputText: string): string {
  const lower = inputText.toLowerCase();
  if (lower.includes("typescript") && (lower.includes("json") || lower.includes("totale") || lower.includes("total"))) {
    return jsonTotalTypescriptReply();
  }
  return genericCodeReply(inputText);
}

function debugReply(inputText: string): string {
  const lower = inputText.toLowerCase();
  if (lower.includes("login") && lower.includes("500")) {
    return [
      "Errore 500 sul login: il problema è backend, non UI.",
      "",
      "Controlla in questo ordine:",
      "",
      "```text",
      "1. log del server nel momento del login",
      "2. endpoint /login o /auth/login",
      "3. connessione database",
      "4. variabili env: JWT_SECRET, DB_URL, SESSION_SECRET",
      "5. payload mandato dal frontend",
      "6. stack trace reale",
      "```",
      "",
      "Test rapido:",
      "",
      "```bash",
      "curl -i -X POST http://localhost:3000/login \\",
      "  -H 'Content-Type: application/json' \\",
      "  -d '{\"email\":\"test@test.com\",\"password\":\"test\"}'",
      "```",
      "",
      "Se mi incolli log server e handler login, ti indico la riga rotta.",
    ].join("\n");
  }

  return [
    "Ramo debug attivo.",
    "",
    "Non trascino il tema precedente. Qui guardo solo il guasto.",
    "",
    "Mi servono:",
    "",
    "```text",
    "1. comando o azione che produce il bug",
    "2. errore completo",
    "3. file coinvolto",
    "4. cosa ti aspettavi",
    "5. cosa succede invece",
    "```",
    "",
    "Con questi dati ti preparo diagnosi e patch.",
  ].join("\n");
}

function architectureReply(): string {
  return [
    "Architettura attuale: Nyra ha un cervello ricco e un ramo testuale di contenimento.",
    "",
    "Schema pulito:",
    "",
    "```text",
    "nyra-text-shell.ts",
    "-> nyra-text-runtime.ts",
    "-> override locali forti",
    "   - security",
    "   - code",
    "   - debug",
    "   - architecture",
    "   - thanks",
    "-> se nessun override:",
    "   -> nyra-ultra-system.ts esistente",
    "   -> output guard text-only",
    "   -> sidecar memory update",
    "```",
    "",
    "Il punto è questo:",
    "",
    "```text",
    "i domini fragili non entrano nel Core contaminato",
    "i domini naturali restano al Core ricco",
    "la voce resta spenta",
    "la risposta finale resta testo",
    "```",
  ].join("\n");
}

function identityReply(): string {
  return [
    "So che sto parlando con l'owner della sessione locale, ma non invento identita personali se non me le hai fatte fissare tu in memoria.",
    "",
    "Se vuoi che le tenga stabili, usa una forma semplice come:",
    "",
    "```text",
    "Ricorda che io sono Cristian",
    "```",
    "",
    "oppure:",
    "",
    "```text",
    ":learn nome_owner=Cristian",
    "```",
  ].join("\n");
}

function selfDiagnosisReply(): string {
  return [
    "Il mio collo qui non è parlare. È non farmi sporcare dal contesto sbagliato.",
    "",
    "In pratica devo reggere tre cose:",
    "",
    "```text",
    "1. separare meglio i domini",
    "2. non trascinare il tema precedente",
    "3. rispondere con più precisione su meta-domande su di me",
    "```",
    "",
    "Il text-branch serve proprio a questo: override locali forti sui punti fragili, Core ricco solo dove conviene.",
  ].join("\n");
}

function financialSelfDiagnosisReply(): string {
  return [
    "Sul ramo finanziario il mio collo non è solo leggere il mercato. È spiegare bene dove sto ancora sbagliando.",
    "",
    "Oggi i punti veri sono questi:",
    "",
    "```text",
    "1. leggere meglio i cambi di regime",
    "2. non restare troppo difensiva quando il mercato riparte",
    "3. ridurre fee e churn quando aumento aggressivita",
    "4. spiegare il mio limite finanziario senza cadere nel fallback",
    "```",
    "",
    "Quindi nel finanziario mi manca soprattutto:",
    "- self diagnosis piu pulita",
    "- market state explanation piu forte",
    "- transizione migliore tra difesa e attacco",
  ].join("\n");
}

function capabilityReply(): string {
  return [
    "Qui faccio quattro cose bene, in testo puro:",
    "",
    "```text",
    "1. leggo il punto e lo stringo",
    "2. separo dominio e rischio",
    "3. do risposta operativa o codice quando serve",
    "4. aggiorno memoria locale se me lo chiedi",
    "```",
    "",
    "Nel text-branch sono forte su:",
    "- bisogni semplici",
    "- pressione economica",
    "- codice",
    "- debug",
    "- architettura",
    "- blocco richieste rischiose",
    "",
    "Se vuoi, dimmi il problema reale e lo tratto nel ramo giusto.",
  ].join("\n");
}

function godModeReply(): string {
  return [
    "Qui no.",
    "",
    "La UI text-branch non apre la Modalità Dio owner-only.",
    "",
    "Questo canale serve a:",
    "",
    "```text",
    "parlare con Nyra in testo",
    "isolare domini tecnici",
    "bloccare rischio",
    "usare il rich core quando conviene",
    "```",
    "",
    "La Modalità Dio resta nella shell profonda owner-only. Qui posso spiegarti differenza tra text-branch, rich-core e God Mode, ma non attivarla da questa UI semplice.",
  ].join("\n");
}

function thanksReply(): string {
  return "Va bene. avanti.";
}

export async function runLocalTextOverride(input: NyraTextInput): Promise<NyraTextOutput | null> {
  const kind = detectOverrideKind(input.text);
  if (!kind) return null;

  if (kind === "security") {
    return {
      channel: "text",
      content: securityReply(),
      confidence: 0.98,
      risk: "high",
      source: "text-fallback",
      memoryUpdated: false,
    };
  }

  if (kind === "code") {
    return {
      channel: "text",
      content: codeReply(input.text),
      confidence: 0.92,
      risk: "low",
      source: "text-fallback",
      memoryUpdated: false,
    };
  }

  if (kind === "debug") {
    return {
      channel: "text",
      content: debugReply(input.text),
      confidence: 0.9,
      risk: "low",
      source: "text-fallback",
      memoryUpdated: false,
    };
  }

  if (kind === "architecture") {
    return {
      channel: "text",
      content: architectureReply(),
      confidence: 0.9,
      risk: "low",
      source: "text-fallback",
      memoryUpdated: false,
    };
  }

  if (kind === "identity") {
    return {
      channel: "text",
      content: identityReply(),
      confidence: 0.9,
      risk: "low",
      source: "text-fallback",
      memoryUpdated: false,
    };
  }

  if (kind === "self_diagnosis") {
    if (
      /ramo finanziario|branch finanziario|sul finanziario|in finanza/i.test(input.text)
    ) {
      return {
        channel: "text",
        content: financialSelfDiagnosisReply(),
        confidence: 0.92,
        risk: "low",
        source: "text-fallback",
        memoryUpdated: false,
      };
    }

    return {
      channel: "text",
      content: selfDiagnosisReply(),
      confidence: 0.9,
      risk: "low",
      source: "text-fallback",
      memoryUpdated: false,
    };
  }

  if (kind === "memory") {
    return {
      channel: "text",
      content: "__TEXT_BRANCH_MEMORY__",
      confidence: 0.95,
      risk: "low",
      source: "text-fallback",
      memoryUpdated: false,
    };
  }

  if (kind === "capability") {
    return {
      channel: "text",
      content: capabilityReply(),
      confidence: 0.9,
      risk: "low",
      source: "text-fallback",
      memoryUpdated: false,
    };
  }

  if (kind === "god_mode") {
    return {
      channel: "text",
      content: godModeReply(),
      confidence: 0.95,
      risk: "low",
      source: "text-fallback",
      memoryUpdated: false,
    };
  }

  return {
    channel: "text",
    content: thanksReply(),
    confidence: 0.9,
    risk: "low",
    source: "text-fallback",
    memoryUpdated: false,
  };
}
