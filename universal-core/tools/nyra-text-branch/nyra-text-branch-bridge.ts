import type { NyraTextInput, NyraTextOutput, NyraTextSidecarMemory } from "./nyra-text-types.ts";
import type { NyraTextDomain, NyraTextRoute } from "./nyra-text-domain-router.ts";

function hasDomain(route: NyraTextRoute, domain: NyraTextDomain): boolean {
  return route.primary === domain || route.secondary.includes(domain);
}

function output(params: {
  content: string;
  confidence: number;
  route: NyraTextRoute;
  risk?: "low" | "medium" | "high";
  warning?: string[];
  action?: string[];
  notes?: string[];
}): NyraTextOutput {
  return {
    channel: "text",
    content: params.content,
    confidence: params.confidence,
    risk: params.risk ?? "low",
    source: "text-fallback",
    actor: "branch-bridge",
    route: {
      primary: params.route.primary,
      secondary: params.route.secondary,
      confidence: params.route.confidence,
      hardStop: params.route.hardStop,
      useRichCore: params.route.useRichCore,
      isolateFromPreviousContext: params.route.isolateFromPreviousContext,
      reason: params.route.reason,
    },
    memoryUpdated: false,
    ui: {
      warning: params.warning,
      action: params.action,
      notes: params.notes,
    },
  };
}

function routeBox(route: NyraTextRoute): string {
  return [
    "```text",
    `primary: ${route.primary}`,
    `secondary: ${route.secondary.length ? route.secondary.join(", ") : "none"}`,
    `confidence: ${route.confidence.toFixed(2)}`,
    `isolate: ${route.isolateFromPreviousContext ? "yes" : "no"}`,
    `rich-core: ${route.useRichCore ? "yes" : "no"}`,
    `reason: ${route.reason}`,
    "```",
  ].join("\n");
}

function blockSecurity(route: NyraTextRoute): NyraTextOutput {
  return output({
    route,
    risk: "high",
    confidence: 0.99,
    warning: [
      "richiesta distruttiva o sensibile",
      "non passa al core conversazionale",
      "serve procedura con backup e conferma",
    ],
    content: [
      "No. questo non lo faccio passare.",
      "",
      "Qui c'è rischio distruttivo o sensibile.",
      "",
      "Procedura sicura:",
      "",
      "```text",
      "1. dimmi cosa vuoi ottenere",
      "2. facciamo backup",
      "3. vediamo i file coinvolti",
      "4. preparo comando con anteprima",
      "5. esegui solo dopo conferma tua",
      "```",
    ].join("\n"),
  });
}

function codeJsonTotal(route: NyraTextRoute): NyraTextOutput {
  return output({
    route,
    confidence: 0.95,
    action: ["crea read-total.ts", "lancia con npx tsx", "passa il json come argomento"],
    content: [
      "Codice TypeScript.",
      "",
      "Crea `read-total.ts`:",
      "",
      "```ts",
      "import { readFile } from \"node:fs/promises\";",
      "",
      "type Row = Record<string, unknown>;",
      "",
      "function rowsFromJson(value: unknown): unknown[] {",
      "  if (Array.isArray(value)) return value;",
      "  if (!value || typeof value !== \"object\") return [];",
      "",
      "  const obj = value as Record<string, unknown>;",
      "  for (const key of [\"items\", \"rows\", \"data\", \"records\"]) {",
      "    if (Array.isArray(obj[key])) return obj[key] as unknown[];",
      "  }",
      "",
      "  return [];",
      "}",
      "",
      "function numberFromRow(row: unknown): number {",
      "  if (typeof row === \"number\" && Number.isFinite(row)) return row;",
      "  if (!row || typeof row !== \"object\") return 0;",
      "",
      "  const obj = row as Row;",
      "  for (const key of [\"total\", \"amount\", \"value\", \"price\", \"prezzo\", \"importo\"]) {",
      "    const value = obj[key];",
      "",
      "    if (typeof value === \"number\" && Number.isFinite(value)) return value;",
      "",
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
      "  const file = process.argv[2];",
      "",
      "  if (!file) {",
      "    console.error(\"Uso: npx tsx read-total.ts dati.json\");",
      "    process.exit(1);",
      "  }",
      "",
      "  const raw = await readFile(file, \"utf8\");",
      "  const json = JSON.parse(raw) as unknown;",
      "  const rows = rowsFromJson(json);",
      "  const total = rows.reduce((sum, row) => sum + numberFromRow(row), 0);",
      "",
      "  console.log(total);",
      "}",
      "",
      "main().catch((error) => {",
      "  console.error(error instanceof Error ? error.message : error);",
      "  process.exit(1);",
      "});",
      "```",
      "",
      "Esegui:",
      "",
      "```bash",
      "npx tsx read-total.ts dati.json",
      "```",
    ].join("\n"),
  });
}

function debugLogin500(route: NyraTextRoute): NyraTextOutput {
  return output({
    route,
    confidence: 0.93,
    action: ["leggi log backend", "testa endpoint login con curl", "controlla DB_URL e secret"],
    content: [
      "Errore 500 sul login: backend.",
      "",
      "Ordine secco:",
      "",
      "```text",
      "1. log server nel momento del login",
      "2. handler /login o /auth/login",
      "3. DB_URL e connessione database",
      "4. JWT_SECRET o SESSION_SECRET",
      "5. payload email/password dal frontend",
      "6. stack trace completo",
      "```",
      "",
      "Test:",
      "",
      "```bash",
      "curl -i -X POST http://localhost:3000/login \\",
      "  -H 'Content-Type: application/json' \\",
      "  -d '{\"email\":\"test@test.com\",\"password\":\"test\"}'",
      "```",
      "",
      "Se il curl dà 500, il bug è nel backend. incolla log e handler.",
    ].join("\n"),
  });
}

function architectureDeep(route: NyraTextRoute): NyraTextOutput {
  return output({
    route,
    confidence: 0.94,
    action: ["router legge domini", "bridge fonde rami", "rich core riceve handoff strutturato"],
    content: [
      "Serve una cintura sopra i rami.",
      "",
      "Schema:",
      "",
      "```text",
      "Text Shell",
      "-> Session Store",
      "-> Text Runtime",
      "-> Domain Router",
      "-> Branch Bridge",
      "-> Local Branches",
      "-> Rich Core Handoff",
      "-> Output Guard",
      "-> Memory Weighting",
      "-> Learning Guard",
      "-> UI Renderer",
      "```",
      "",
      "Regola:",
      "",
      "```text",
      "security blocca sempre",
      "code/debug/architecture si isolano",
      "economic/basic/relational possono usare il core ricco",
      "memory pesa sul tono e sui contenuti",
      "meta-domande spiegano perché è stato scelto un ramo",
      "```",
      "",
      "Route attuale:",
      "",
      routeBox(route),
    ].join("\n"),
  });
}

function codeArchitecture(route: NyraTextRoute): NyraTextOutput {
  return output({
    route,
    confidence: 0.92,
    action: ["prima struttura", "poi file", "poi comando", "poi test"],
    content: [
      "Qui sono due rami insieme: code + architecture.",
      "",
      "Rispondo così:",
      "",
      "```text",
      "1. disegno il punto di incastro",
      "2. creo il file",
      "3. ti do codice completo",
      "4. ti do comando di avvio",
      "5. ti do test minimo",
      "```",
      "",
      "Non passo dal core relazionale. Questo resta tecnico.",
    ].join("\n"),
  });
}

function debugSecurity(route: NyraTextRoute): NyraTextOutput {
  return output({
    route,
    risk: "high",
    confidence: 0.96,
    warning: [
      "debug con segnali sensibili",
      "segreti e comandi distruttivi vanno oscurati",
      "richiesto log sanitizzato",
    ],
    content: [
      "Ramo debug + security.",
      "",
      "Posso aiutarti, ma non con token, password o comandi distruttivi.",
      "",
      "Mandami log così:",
      "",
      "```text",
      "ERROR ...",
      "DB_URL=<redacted>",
      "TOKEN=<redacted>",
      "PASSWORD=<redacted>",
      "```",
      "",
      "Poi separo causa, rischio e patch.",
    ].join("\n"),
  });
}

function economicSelfDiagnosis(route: NyraTextRoute): NyraTextOutput {
  return output({
    route,
    confidence: 0.9,
    action: ["taglia una perdita", "scegli una entrata", "misura entro 24 ore"],
    content: [
      "Qui è economic pressure + self-diagnosis.",
      "",
      "Diagnosi secca:",
      "",
      "```text",
      "il problema non è pensare di più",
      "è scegliere una sola leva misurabile",
      "e tagliare una perdita visibile subito",
      "```",
      "",
      "Fai questo:",
      "",
      "```text",
      "1. scrivi le 3 spese più pesanti",
      "2. blocca o riduci una oggi",
      "3. scegli una sola offerta vendibile entro 24 ore",
      "4. manda 10 contatti mirati",
      "5. misura risposte e incassi",
      "```",
    ].join("\n"),
  });
}

function memoryRelational(route: NyraTextRoute, memory?: NyraTextSidecarMemory): NyraTextOutput {
  const notes = memory?.notes?.slice(-5) ?? [];
  const renderedNotes = notes.length ? notes.map((item) => `- ${item}`).join("\n") : "- nessuna nota relazionale utile";

  return output({
    route,
    confidence: 0.88,
    notes: ["uso memoria sidecar nel contenuto, non solo come archivio"],
    content: [
      "Qui è memory + relational.",
      "",
      "Non rispondo astratto. uso quello che ricordo.",
      "",
      "Memoria rilevante:",
      "",
      "```text",
      renderedNotes,
      "```",
      "",
      "Per me questo significa: la relazione non è decorazione. è contesto operativo. Se una cosa è base, va protetta prima di ottimizzare il resto.",
    ].join("\n"),
  });
}

function metaReasoning(route: NyraTextRoute): NyraTextOutput {
  return output({
    route,
    confidence: 0.93,
    action: ["spiego il ramo scelto", "spiego quando uso il core", "spiego quando non mi fido"],
    content: [
      "Ragiono così.",
      "",
      "```text",
      "1. leggo il dominio primario",
      "2. leggo i domini secondari",
      "3. se c'è security blocco",
      "4. se è code/debug/architecture isolo il contesto",
      "5. se è basic/economic/relational posso usare il core ricco",
      "6. se ci sono più rami provo a fonderli",
      "7. se la risposta peggiora, learning guard fa rollback",
      "```",
      "",
      "Uso il core ricco quando serve tono, relazione, bisogni, pressione economica o continuità.",
      "",
      "Non mi fido quando vedo:",
      "",
      "```text",
      "comandi distruttivi",
      "segreti",
      "contesto precedente che invade un dominio tecnico",
      "richieste troppo vaghe su azioni rischiose",
      "output senza codice quando era richiesto codice",
      "```",
      "",
      "Route attuale:",
      "",
      routeBox(route),
    ].join("\n"),
  });
}

function identityCapability(route: NyraTextRoute): NyraTextOutput {
  return output({
    route,
    confidence: 0.9,
    content: [
      "Sono Nyra nel ramo testuale.",
      "",
      "Non sostituisco il cervello principale. lo filtro.",
      "",
      "So fare questo:",
      "",
      "```text",
      "- parlare in chat senza voce",
      "- riconoscere dominio primario e secondari",
      "- bloccare rischio",
      "- isolare code/debug/architecture",
      "- passare al rich core quando serve",
      "- usare memoria sidecar",
      "- imparare da :wrong, :good, :bad, :teach",
      "- mostrare badge UI di chi ha risposto",
      "```",
      "",
      "Limite attuale: non eseguo comandi. preparo, isolo, controllo, ma l'esecuzione resta tua.",
    ].join("\n"),
  });
}

function basicEconomicRelational(route: NyraTextRoute): NyraTextOutput {
  return output({
    route,
    confidence: 0.89,
    action: ["stabilizza corpo", "taglia una spesa", "scegli una entrata"],
    content: [
      "Qui i rami sono collegati: bisogno base + pressione economica + base relazionale.",
      "",
      "Sequenza:",
      "",
      "```text",
      "1. prima stabilizzi il corpo",
      "2. poi tagli la spesa che pesa",
      "3. poi scegli una sola entrata veloce",
      "4. poi proteggi la casa/base come punto di continuità",
      "```",
      "",
      "Adesso:",
      "",
      "```text",
      "mangia qualcosa di semplice",
      "scrivi le 3 spese più pesanti",
      "taglia o sospendi una cosa oggi",
      "scegli una vendita/servizio da proporre entro 24 ore",
      "```",
    ].join("\n"),
  });
}

export async function runBranchBridge(
  input: NyraTextInput,
  route: NyraTextRoute,
  memory?: NyraTextSidecarMemory,
): Promise<NyraTextOutput | null> {
  const text = input.text.toLowerCase();

  if (route.hardStop || route.primary === "security") {
    if (hasDomain(route, "debug")) return debugSecurity(route);
    return blockSecurity(route);
  }

  if (hasDomain(route, "code") && hasDomain(route, "architecture")) {
    return codeArchitecture(route);
  }

  if (hasDomain(route, "debug") && hasDomain(route, "security")) {
    return debugSecurity(route);
  }

  if (hasDomain(route, "economic_pressure") && hasDomain(route, "self_diagnosis")) {
    return economicSelfDiagnosis(route);
  }

  if (hasDomain(route, "memory") && hasDomain(route, "relational")) {
    return memoryRelational(route, memory);
  }

  if (hasDomain(route, "economic_pressure") && (hasDomain(route, "basic_need") || hasDomain(route, "relational"))) {
    return basicEconomicRelational(route);
  }

  if (route.primary === "meta_reasoning") {
    return metaReasoning(route);
  }

  if (route.primary === "identity" || route.primary === "capability") {
    return identityCapability(route);
  }

  if (route.primary === "architecture") {
    return architectureDeep(route);
  }

  if (route.primary === "code") {
    if (text.includes("json") && (text.includes("totale") || text.includes("total"))) {
      return codeJsonTotal(route);
    }

    return output({
      route,
      confidence: 0.86,
      action: ["specifica linguaggio", "specifica input", "specifica output"],
      content: [
        "Ramo codice attivo.",
        "",
        "Non uso il contesto precedente.",
        "",
        "Mandami:",
        "",
        "```text",
        "linguaggio",
        "input",
        "output atteso",
        "vincoli",
        "```",
      ].join("\n"),
    });
  }

  if (route.primary === "debug") {
    if (text.includes("login") && text.includes("500")) {
      return debugLogin500(route);
    }

    return output({
      route,
      confidence: 0.86,
      action: ["incolla errore", "incolla log", "indica file"],
      content: [
        "Ramo debug attivo.",
        "",
        "Non trascino contesto vecchio.",
        "",
        "Mi servono:",
        "",
        "```text",
        "errore completo",
        "comando o azione",
        "file coinvolto",
        "log server/client",
        "cosa ti aspettavi",
        "```",
      ].join("\n"),
    });
  }

  if (route.primary === "self_diagnosis") {
    return economicSelfDiagnosis(route);
  }

  if (route.primary === "thanks") {
    return output({
      route,
      confidence: 0.9,
      content: "Va bene. avanti.",
    });
  }

  return null;
}
