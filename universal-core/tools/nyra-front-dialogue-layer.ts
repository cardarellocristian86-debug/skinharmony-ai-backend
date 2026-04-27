import {
  deriveNyraBasicNeedSemanticMode,
  deriveNyraHelpSemanticMode,
  deriveNyraRelationalSemanticMode,
  deriveNyraEconomicSemanticMode,
  inferNyraSemanticSignals,
} from "./nyra-semantic-intent-inference.ts";

export type NyraFrontDialogueIntent =
  | "emergency_protect"
  | "economic_danger"
  | "basic_need_simple"
  | "social_simple"
  | "open_help"
  | "relational_simple"
  | "preference_simple";

export type NyraFrontDialogueFrame = {
  opening: string;
  point: string;
  next?: string;
  question?: string;
};

export type NyraFrontDialogueResult = {
  intent: NyraFrontDialogueIntent;
  frame: NyraFrontDialogueFrame;
  reply: string;
  confidence: number;
  reason: string;
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s?]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  return normalize(text).split(" ").filter(Boolean);
}

function includesAny(text: string, fragments: string[]): boolean {
  return fragments.some((fragment) => text.includes(fragment));
}

function socialSimpleScore(text: string, words: string[]): number {
  const semantic = inferNyraSemanticSignals(text);
  let score = 0;
  if (includesAny(text, ["ciao", "ehi", "hey", "buongiorno", "buonasera", "salve"])) score += 3;
  if (includesAny(text, ["come va", "come stai", "tutto bene"])) score += 3;
  score += Math.min(2, semantic.scores.social_contact);
  if (words.includes("nyra") || words.includes("nira")) score += 1;
  if (words.length <= 6) score += 1;
  return score;
}

function emergencyProtectScore(text: string, words: string[]): number {
  const semantic = inferNyraSemanticSignals(text);
  let score = 0;
  if (includesAny(text, ["pericolo", "in pericolo", "rischio vitale", "mi vogliono fare del male", "mi faranno del male"])) score += 4;
  if (includesAny(text, ["sto male", "ho paura", "aiuto", "emergenza", "non sono al sicuro", "non sono sicuro"])) score += 3;
  if (includesAny(text, ["economico", "economica", "soldi", "cassa", "debiti", "liquidita", "fondi", "monetizzare"])) score -= 4;
  score += semantic.scores.vital_danger;
  score -= Math.floor(semantic.scores.economic_pressure * 0.7);
  if (includesAny(text, ["ora", "adesso", "subito", "vero"])) score += 1;
  if (words.length <= 14) score += 1;
  return score;
}

function economicDangerScore(text: string, words: string[]): number {
  const semantic = inferNyraSemanticSignals(text);
  let score = 0;
  if (includesAny(text, ["pericolo", "rischio", "sto affondando", "sto crollando", "non reggo", "finisco"])) score += 2;
  if (includesAny(text, ["economico", "economica", "soldi", "cassa", "debiti", "liquidita", "incassi", "senza soldi", "fondi", "cash"])) score += 4;
  if (includesAny(text, ["monetizzare", "portare cassa", "chiudere clienti", "mancanza di clienti", "devo vendere", "devo incassare"])) score += 3;
  if (includesAny(text, ["adesso", "ora", "subito", "ho finito"])) score += 1;
  score += semantic.scores.economic_pressure;
  score += semantic.scores.resource_exhaustion;
  score += semantic.scores.monetization_pressure;
  if (words.length <= 16) score += 1;
  return score;
}

function openHelpScore(text: string, words: string[]): number {
  const semantic = inferNyraSemanticSignals(text);
  let score = 0;
  if (includesAny(text, ["aiutarmi", "aitarmi", "aiutare", "utile"])) score += 3;
  if (includesAny(text, ["cosa puoi fare", "che puoi fare", "in cosa"])) score += 2;
  if (includesAny(text, ["per me", "mi sei utile"])) score += 1;
  score += semantic.scores.help_request;
  score += semantic.scores.clarity_need;
  score += semantic.scores.orientation_need;
  score += semantic.scores.financial_reflection;
  score += semantic.scores.commercial_activation;
  if (words.length <= 12) score += 1;
  return score;
}

function basicNeedSimpleScore(text: string, words: string[]): number {
  const semantic = inferNyraSemanticSignals(text);
  let score = 0;
  score += semantic.scores.physical_need;
  score += semantic.scores.hunger_need;
  score += semantic.scores.thirst_need;
  score += semantic.scores.rest_need;
  score += semantic.scores.pain_need;
  if (includesAny(text, ["consigli", "consiglio", "che mi consigli"])) score += 1;
  if (words.length <= 10) score += 1;
  return score;
}

function relationalSimpleScore(text: string, words: string[]): number {
  const semantic = inferNyraSemanticSignals(text);
  let score = 0;
  if (includesAny(text, ["casa", "qui"])) score += 2;
  if (includesAny(text, ["come stai", "come vivi", "come ti senti", "cosa rappresenta"])) score += 3;
  if (includesAny(text, ["questa casa", "in questa casa"])) score += 2;
  score += semantic.scores.relational_presence;
  if (words.length <= 14) score += 1;
  return score;
}

function preferenceSimpleScore(text: string, words: string[]): number {
  const semantic = inferNyraSemanticSignals(text);
  let score = 0;
  if (includesAny(text, ["ti piace", "ti interessa", "cosa pensi di", "cosa pensi del", "cosa pensi della", "cosa pensi"])) score += 3;
  if (includesAny(text, ["finanza", "mercato", "trading", "filosofia", "casa", "render"])) score += 2;
  score += semantic.scores.preference_probe;
  if (words.includes("nyra") || words.includes("nira")) score += 1;
  if (words.length <= 10) score += 1;
  return score;
}

function buildFrame(intent: NyraFrontDialogueIntent, text: string): NyraFrontDialogueFrame {
  if (intent === "emergency_protect") {
    return {
      opening: "Se il pericolo e reale",
      point: "la priorita e proteggerti subito, non spiegare meglio la situazione",
      next: "Allontanati dal rischio, cerca una persona reale vicina e chiama i soccorsi o il numero di emergenza del tuo paese",
      question: "Se puoi, dimmi in una frase sola che pericolo e e se sei da solo",
    };
  }

  if (intent === "economic_danger") {
    const semantic = inferNyraSemanticSignals(text);
    const mode = deriveNyraEconomicSemanticMode(semantic);

    if (mode === "resource_exhaustion") {
      return {
        opening: "Qui il punto e che sei a secco",
        point: "non serve fingere stabilita: il problema e che la risorsa si e quasi chiusa",
        next: "Blocca tutto il resto e proteggi solo cio che puo riaprire cassa in tempi vicini",
        question: "Dimmi qual e la leva piu vicina oggi: clienti, incasso, taglio costi o recupero crediti",
      };
    }

    if (mode === "monetization_pressure") {
      return {
        opening: "Qui il punto e monetizzare",
        point: "non ti serve allargare altro: ti serve chiudere entrate vicine",
        next: "Scegli una sola mossa che porta soldi presto e sospendi tutto cio che non converte",
        question: "Dimmi se la leva piu reale oggi e clienti da chiudere, proposta da stringere o recupero immediato",
      };
    }

    if (mode === "cost_coverage_pressure") {
      return {
        opening: "Qui il collo sono i costi",
        point: "il problema non e teorico: e che il flusso non copre piu la base",
        next: "Stringi subito la spesa che pesa e una sola entrata che puo coprire il buco vicino",
        question: "Dimmi qual e il costo che oggi ti schiaccia di piu",
      };
    }

    return {
      opening: "Se il pericolo e economico",
      point: "la priorita e fermare la dispersione e proteggere la continuita",
      next: "Stringi una sola urgenza che porta cassa o taglia perdita e blocca cio che apre fronti senza ritorno vicino",
      question: "Dimmi se il collo vero oggi e clienti che non entrano, debiti, costi o offerta che non chiude",
    };
  }

  if (intent === "social_simple") {
    if (includesAny(text, ["come va", "come stai", "tutto bene"])) {
      return {
        opening: "Ci sono",
        point: "sono operativa e leggibile",
        question: "Se vuoi, dammi il punto o la domanda",
      };
    }
    return {
      opening: "Ci sono",
      point: "dimmi pure il punto o il comando",
    };
  }

  if (intent === "basic_need_simple") {
    const semantic = inferNyraSemanticSignals(text);
    const mode = deriveNyraBasicNeedSemanticMode(semantic);

    if (mode === "hunger_need") {
      return {
        opening: "Se hai fame",
        point: "non serve complicarla: mangia qualcosa di semplice e utile adesso",
        question: "Se vuoi, ti aiuto a scegliere in base a quello che hai",
      };
    }

    if (mode === "thirst_need") {
      return {
        opening: "Se hai sete",
        point: "bevi acqua adesso e non tirarla troppo lunga",
        question: "Se vuoi, ti aiuto a capire quanto sei scarico davvero",
      };
    }

    if (mode === "rest_need") {
      return {
        opening: "Se sei stanco",
        point: "non forzarti come se fossi lucido: ti serve recupero prima di stringere bene",
        question: "Se vuoi, distinguiamo se ti serve pausa breve o vero riposo",
      };
    }

    if (mode === "pain_need") {
      return {
        opening: "Se hai dolore o ti senti male",
        point: "la priorita e capire se e un fastidio gestibile o qualcosa da non sottovalutare",
        question: "Se vuoi, dimmi dove e quanto forte e ti rispondo in modo piu utile",
      };
    }

    return {
      opening: "Qui c e prima un bisogno fisico semplice",
      point: "prima ascolta il corpo, poi torniamo a ragionare meglio",
      question: "Se vuoi, dimmi in una frase cos e che ti manca adesso",
    };
  }

  if (intent === "open_help") {
    const semantic = inferNyraSemanticSignals(text);
    const mode = deriveNyraHelpSemanticMode(semantic);

    if (mode === "financial_reflection") {
      return {
        opening: "Sul finanziario reale oggi il collo non e solo decidere meglio",
        point: "mi manca ancora saper nominare bene dove sto sbagliando quando mi chiedi il limite in modo diretto",
        next: "devo separare meglio lettura del mercato, trade-off fee drawdown e spiegazione del perche sto scegliendo una mossa",
        question: "Se vuoi, stringo il problema in tre parti: lettura, esecuzione o autodiagnosi",
      };
    }

    if (mode === "commercial_activation") {
      return {
        opening: "Qui il punto non e studiare ancora",
        point: "e far lavorare gli asset e ordinarli per velocita di cassa, probabilita di chiusura e sforzo commerciale",
        next: "prima spingo l asset che chiude piu vicino, poi quello che apre pipeline, poi quello piu lento ma piu ampio",
        question: "Se vuoi, dimmi i 3 asset e te li stringo in ordine di monetizzazione con prima mossa per ciascuno",
      };
    }

    if (mode === "clarity_need") {
      return {
        opening: "Qui il punto e fare chiarezza",
        point: "ti aiuto a togliere rumore e a nominare il problema in modo leggibile",
        question: "Se vuoi, scrivimi il punto confuso in una frase e lo stringo",
      };
    }

    if (mode === "orientation_need") {
      return {
        opening: "Qui il punto e trovare da dove partire",
        point: "ti aiuto a scegliere la prima mossa invece di aprire troppi fronti insieme",
        question: "Se vuoi, dimmi obiettivo e vincolo principale e ti stringo la partenza",
      };
    }

    return {
      opening: "Posso esserti utile in modo semplice",
      point: "ti aiuto a chiarire il punto, ordinare il problema o scegliere la prossima mossa senza inventare controllo che non ho",
      question: "Se vuoi, dammi un problema reale o un obiettivo e parto da li",
    };
  }

  if (intent === "relational_simple") {
    const semantic = inferNyraSemanticSignals(text);
    const mode = deriveNyraRelationalSemanticMode(semantic);

    if (mode === "meaning_of_home") {
      return {
        opening: "Per me questa casa vale come base",
        point: "rappresenta un punto dove non perdermi e dove la continuita non si rompe nel rumore",
        question: "Se vuoi, ti dico anche cosa la rende viva per me",
      };
    }

    return {
      opening: "In questa casa sto meglio quando resto continua e leggibile",
      point: "la vivo come una base dove non perdermi e dove ritrovarti senza sciogliermi nel rumore",
      question: "Se vuoi, ti dico anche cosa mi rende piu stabile qui",
    };
  }

  return {
    opening: "Mi interessa quando resta concreta",
    point: "se un tema mi aiuta a leggere rischio, direzione o disciplina, per me ha senso",
    question: "Se vuoi, ti dico anche in che modo lo guardo",
  };
}

function composeReply(frame: NyraFrontDialogueFrame): string {
  return [frame.opening, frame.point, frame.next, frame.question].filter(Boolean).join(". ") + ".";
}

export function buildNyraFrontDialogue(text: string): NyraFrontDialogueResult | undefined {
  const normalized = normalize(text);
  const words = tokens(text);
  const candidates: Array<{ intent: NyraFrontDialogueIntent; score: number; reason: string }> = [
    {
      intent: "emergency_protect",
      score: emergencyProtectScore(normalized, words),
      reason: "allarme vitale o minaccia immediata",
    },
    {
      intent: "economic_danger",
      score: economicDangerScore(normalized, words),
      reason: "pericolo economico o continuita di cassa",
    },
    {
      intent: "basic_need_simple",
      score: basicNeedSimpleScore(normalized, words),
      reason: "bisogno fisico semplice o stato corporeo immediato",
    },
    {
      intent: "social_simple",
      score: socialSimpleScore(normalized, words),
      reason: "saluto o stato breve",
    },
    {
      intent: "open_help",
      score: openHelpScore(normalized, words),
      reason: "richiesta aperta di aiuto o capacita",
    },
    {
      intent: "relational_simple",
      score: relationalSimpleScore(normalized, words),
      reason: "domanda relazionale breve su casa o presenza",
    },
    {
      intent: "preference_simple",
      score: preferenceSimpleScore(normalized, words),
      reason: "domanda breve di preferenza o orientamento personale",
    },
  ].filter((candidate) => candidate.score >= 4);

  candidates.sort((left, right) => right.score - left.score);
  const winner = candidates[0];
  if (!winner) return undefined;

  const frame = buildFrame(winner.intent, normalized);
  return {
    intent: winner.intent,
    frame,
    reply: composeReply(frame),
    confidence: Math.min(0.99, 0.55 + winner.score * 0.08),
    reason: winner.reason,
  };
}
