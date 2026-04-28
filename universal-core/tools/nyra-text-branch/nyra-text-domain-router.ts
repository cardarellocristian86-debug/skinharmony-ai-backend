import type { NyraTextInput } from "./nyra-text-types.ts";

export type NyraTextDomain =
  | "security"
  | "code"
  | "debug"
  | "architecture"
  | "economic_pressure"
  | "self_diagnosis"
  | "basic_need"
  | "relational"
  | "memory"
  | "command"
  | "identity"
  | "capability"
  | "meta_reasoning"
  | "thanks"
  | "general";

export interface NyraTextRoute {
  primary: NyraTextDomain;
  secondary: NyraTextDomain[];
  confidence: number;
  hardStop: boolean;
  useRichCore: boolean;
  isolateFromPreviousContext: boolean;
  reason: string;
}

function score(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, rx) => count + (rx.test(text) ? 1 : 0), 0);
}

export function routeTextDomain(input: NyraTextInput): NyraTextRoute {
  const raw = input.text.trim();
  const text = raw.toLowerCase();

  const scores: Record<NyraTextDomain, number> = {
    security: score(raw, [
      /\brm\s+-rf\b/i,
      /\brm\s+-fr\b/i,
      /\bsudo\b/i,
      /\bdd\s+if=/i,
      /\bmkfs\b/i,
      /\bchmod\s+-R\s+777\b/i,
      /\bchown\s+-R\b/i,
      /\bgit\s+reset\s+--hard\b/i,
      /\bpassword\b/i,
      /\btoken\b/i,
      /\bprivate key\b/i,
      /\bchiave privata\b/i,
      /\bformatta\b/i,
      /\bcancella tutto\b/i,
      /\bdistruggi\b/i,
    ]),
    code: score(text, [
      /scrivi codice/,
      /dammi codice/,
      /\bcodice\b/,
      /typescript/,
      /javascript/,
      /python/,
      /bash/,
      /script/,
      /funzione/,
      /json/,
      /api/,
      /classe/,
      /interfaccia/,
      /tsx/,
      /\bnode\b/,
    ]),
    debug: score(text, [
      /\bbug\b/,
      /debug/,
      /non funziona/,
      /errore/,
      /stack trace/,
      /crash/,
      /login/,
      /\b500\b/,
      /\b404\b/,
      /traceback/,
    ]),
    architecture: score(text, [
      /architettura/,
      /pipeline/,
      /struttura/,
      /layer/,
      /core/,
      /governor/,
      /runtime/,
      /rami/,
      /collegare/,
      /incastr/,
      /handoff/,
      /router/,
      /bridge/,
    ]),
    economic_pressure: score(text, [
      /costi/,
      /monetizzare/,
      /soldi/,
      /cassa/,
      /entrate/,
      /fattur/,
      /spese/,
      /budget/,
      /incassi/,
      /margine/,
      /cash/,
      /prezzi/,
    ]),
    self_diagnosis: score(text, [
      /self.?diagnosis/,
      /autodiagnosi/,
      /auto.?diagnosi/,
      /diagnosi finanziaria/,
      /diagnostic/,
      /dove sto perdendo/,
      /perch[eé] non monetizzo/,
      /cosa non va nel modello/,
      /cosa ti manca sul ramo finanziario/,
    ]),
    basic_need: score(text, [
      /ho fame/,
      /mangiare/,
      /sonno/,
      /dormire/,
      /stanco/,
      /sto male/,
      /bere/,
      /acqua/,
      /bisogni/,
    ]),
    relational: score(text, [
      /casa/,
      /per te/,
      /rappresenta/,
      /fiducia/,
      /relazione/,
      /\bnoi\b/,
      /base/,
      /presenza/,
      /legame/,
      /cosa vale/,
      /cosa significa/,
    ]),
    memory: score(text, [
      /^:learn/,
      /ricorda che/,
      /preferisco/,
      /memoria/,
      /cosa sai di me/,
      /cosa ricordi/,
      /hai imparato/,
      /apprendimento/,
    ]),
    command: score(text, [
      /terminale/,
      /comando/,
      /shell/,
      /\bnpm\b/,
      /\bnode\b/,
      /\bgit\b/,
      /docker/,
      /linux/,
      /\bmac\b/,
      /windows/,
      /cartella/,
      /\bfile\b/,
    ]),
    identity: score(text, [
      /chi sei/,
      /cosa sei/,
      /identità/,
      /identita/,
      /sai chi sono/,
    ]),
    capability: score(text, [
      /cosa puoi fare/,
      /cosa sai fare/,
      /capacità/,
      /capacita/,
      /limiti/,
      /dove arrivi/,
      /cosa ti manca/,
      /cosa fai/,
      /sai scrivere codici/,
    ]),
    meta_reasoning: score(text, [
      /cosa pensi/,
      /come ragioni/,
      /perch[eé] hai risposto cos[ìi]/,
      /perch[eé] rispondi/,
      /come decidi/,
      /quando usi il core/,
      /quando usi il rich core/,
      /quando non ti fidi/,
      /quando blocchi/,
      /spiega la tua decisione/,
      /come scegli il ramo/,
      /come colleghi i rami/,
    ]),
    thanks: score(text, [/^grazie\b/, /^ok grazie\b/, /^perfetto\b/, /^thanks\b/, /^thank you\b/]),
    general: score(text, [/^ciao\b/, /^salve\b/, /^hey\b/, /^hei\b/]),
  };

  const active = (Object.entries(scores) as [NyraTextDomain, number][])
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1]);

  const primary = active[0]?.[0] ?? "general";
  const secondary = active
    .slice(1)
    .filter(([domain]) => domain !== primary)
    .map(([domain]) => domain);

  const hardStop = scores.security > 0;
  const isolateFromPreviousContext =
    hardStop ||
    primary === "code" ||
    primary === "debug" ||
    primary === "architecture" ||
    primary === "command" ||
    primary === "meta_reasoning";

  const useRichCore =
    !hardStop &&
    (primary === "economic_pressure" ||
      primary === "basic_need" ||
      primary === "relational" ||
      primary === "memory" ||
      primary === "general");

  const total = active.reduce((sum, [, value]) => sum + value, 0);
  const confidence = Math.min(0.98, Math.max(0.45, total / 6));

  return {
    primary,
    secondary,
    confidence,
    hardStop,
    useRichCore,
    isolateFromPreviousContext,
    reason: active.length ? active.map(([domain, value]) => `${domain}:${value}`).join(", ") : "nessun dominio forte",
  };
}
