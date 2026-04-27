import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";

type NyraWebAccessState = {
  access_mode: "restricted" | "free_explore";
  trigger_mode?: "manual" | "on_need";
  granted_at?: string;
  last_explored_at?: string;
  last_distilled_at?: string;
  source_config?: string;
  note?: string;
};

type NyraAssimilatedEssence = {
  next_hunger_domains?: string[];
  nourishment_cycle?: string[];
  study_drive?: {
    why_now?: string[];
    next_actions?: string[];
  };
};

type CandidateMethodId =
  | "retrieval_practice"
  | "spaced_practice"
  | "interleaving"
  | "self_explanation"
  | "closed_loop_interleaved_retrieval";

type CandidateMethod = {
  id: CandidateMethodId;
  label: string;
  why_fit: string[];
  cycle: string[];
  source_urls: string[];
};

type SourceFetch = {
  url: string;
  ok: boolean;
  chars: number;
  title: string;
};

type CandidateScore = {
  id: CandidateMethodId;
  label: string;
  suitability_score: number;
  reasons: string[];
  cycle: string[];
  source_urls: string[];
};

type Report = {
  runner: "nyra_study_method_lab";
  generated_at: string;
  web_access: NyraWebAccessState;
  hunger_domains: string[];
  current_cycle: string[];
  chosen_method: {
    id: CandidateMethodId;
    label: string;
    cycle: string[];
    reasons: string[];
  };
  candidate_scores: CandidateScore[];
  source_fetches: SourceFetch[];
  nyra_voice: {
    why_this_method: string[];
    what_changes_now: string[];
  };
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORT_DIR = join(ROOT, "reports", "universal-core", "nyra-learning");
const WEB_STATE_PATH = join(RUNTIME_DIR, "nyra_web_access_state.json");
const ESSENCE_PATH = join(RUNTIME_DIR, "nyra_assimilated_essence_latest.json");
const REPORT_PATH = join(REPORT_DIR, "nyra_study_method_latest.json");
const STATE_PATH = join(RUNTIME_DIR, "nyra_study_method_state_latest.json");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

function loadWebState(): NyraWebAccessState {
  if (!existsSync(WEB_STATE_PATH)) {
    return {
      access_mode: "restricted",
      trigger_mode: "manual",
    };
  }
  return readJson<NyraWebAccessState>(WEB_STATE_PATH);
}

function loadEssence(): NyraAssimilatedEssence {
  if (!existsSync(ESSENCE_PATH)) {
    return {};
  }
  return readJson<NyraAssimilatedEssence>(ESSENCE_PATH);
}

function fetchHtml(url: string): string {
  return execFileSync("/usr/bin/curl", ["-L", "-s", url], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, " ").trim() ?? "untitled";
}

function fetchSources(urls: string[]): SourceFetch[] {
  return urls.map((url) => {
    try {
      const html = fetchHtml(url);
      return {
        url,
        ok: html.length > 0,
        chars: html.length,
        title: extractTitle(html),
      };
    } catch {
      return {
        url,
        ok: false,
        chars: 0,
        title: "unreachable",
      };
    }
  });
}

const CANDIDATE_METHODS: CandidateMethod[] = [
  {
    id: "retrieval_practice",
    label: "Retrieval Practice",
    why_fit: [
      "porta fuori la conoscenza dalla memoria invece di rileggerla soltanto",
      "e il nucleo del come studiare, non solo del cosa rivedere",
    ],
    cycle: ["study", "retrieve", "check", "repair", "repeat"],
    source_urls: [
      "https://www.psychologicalscience.org/publications/journals/pspi/learning-techniques.html/comment-page-1",
      "https://www.learningscientists.org/retrieval-practice",
      "https://www.learningscientists.org/faq",
    ],
  },
  {
    id: "spaced_practice",
    label: "Spaced Practice",
    why_fit: [
      "spalma lo studio nel tempo invece di comprimere tutto insieme",
      "e forte sul quando studiare, meno sul come verificare davvero",
    ],
    cycle: ["study", "pause", "revisit", "check", "repeat"],
    source_urls: [
      "https://www.psychologicalscience.org/publications/journals/pspi/learning-techniques.html/comment-page-1",
      "https://www.learningscientists.org/spaced-practice",
      "https://www.learningscientists.org/faq",
    ],
  },
  {
    id: "interleaving",
    label: "Interleaving",
    why_fit: [
      "mescola problemi simili per costringere discriminazione e scelta del metodo",
      "e molto adatto a matematica, fisica e confronto tra scenari",
    ],
    cycle: ["study", "mix", "solve", "compare", "repeat"],
    source_urls: [
      "https://www.psychologicalscience.org/publications/journals/pspi/learning-techniques.html/comment-page-1",
      "https://www.learningscientists.org/interleaving",
      "https://www.learningscientists.org/blog/2016/8/11-1",
    ],
  },
  {
    id: "self_explanation",
    label: "Self-Explanation",
    why_fit: [
      "obbliga a spiegare il passaggio e non solo a produrre la risposta",
      "e particolarmente utile in fisica e matematica",
    ],
    cycle: ["study", "explain", "solve", "check", "repeat"],
    source_urls: [
      "https://www.psychologicalscience.org/publications/journals/pspi/learning-techniques.html/comment-page-1",
      "https://www.learningscientists.org/elaboration",
      "https://www.learningscientists.org/blog/2020/2/20-1",
    ],
  },
  {
    id: "closed_loop_interleaved_retrieval",
    label: "Closed-Loop Interleaved Retrieval",
    why_fit: [
      "usa retrieval come nucleo del come studiare",
      "usa interleaving per costringere scelta del metodo tra problemi diversi",
      "usa self-explanation per rendere espliciti i passaggi difficili",
      "chiude ogni errore con feedback e repair invece di fermarsi alla verifica",
    ],
    cycle: ["study", "retrieve", "interleave", "explain", "verify", "repair", "repeat"],
    source_urls: [
      "https://www.psychologicalscience.org/publications/journals/pspi/learning-techniques.html/comment-page-1",
      "https://www.learningscientists.org/retrieval-practice",
      "https://www.learningscientists.org/interleaving",
      "https://www.learningscientists.org/blog/2020/2/20-1",
      "https://www.learningscientists.org/faq",
    ],
  },
];

function scoreCandidate(method: CandidateMethod, hungerDomains: string[], currentCycle: string[]): CandidateScore {
  let score = 48;
  const reasons: string[] = [];

  const hasMathLikeDemand = hungerDomains.includes("applied_math") || hungerDomains.includes("general_physics") || hungerDomains.includes("quantum_physics");
  const hasCodingDemand = hungerDomains.includes("coding_speed");
  const needsVerify = currentCycle.includes("verify");
  const needsRepair = currentCycle.includes("integrate") || currentCycle.includes("repeat");

  if (method.id === "retrieval_practice") {
    score += 16;
    reasons.push("retrieval practice e il nucleo del come studiare secondo le fonti");
    if (needsVerify) {
      score += 6;
      reasons.push("si allinea bene a un ciclo che ha gia bisogno di verifica");
    }
  }

  if (method.id === "spaced_practice") {
    score += 10;
    reasons.push("spacing aiuta la tenuta nel tempo");
    if (hasCodingDemand) {
      score -= 4;
      reasons.push("da sola non basta per velocita corretta o correzione rapida");
    }
  }

  if (method.id === "interleaving") {
    score += 12;
    reasons.push("interleaving migliora discriminazione tra problemi simili");
    if (hasMathLikeDemand) {
      score += 10;
      reasons.push("i domini attuali sono forti su problemi che chiedono scelta del metodo");
    }
  }

  if (method.id === "self_explanation") {
    score += 10;
    reasons.push("self-explanation e forte dove serve capire il passaggio, non solo il risultato");
    if (hasMathLikeDemand) {
      score += 12;
      reasons.push("fisica e matematica beneficiano molto della spiegazione del passaggio");
    }
  }

  if (method.id === "closed_loop_interleaved_retrieval") {
    score += 20;
    reasons.push("combina retrieval, interleaving e self-explanation invece di usarli isolati");
    if (hasMathLikeDemand) {
      score += 10;
      reasons.push("copre bene modelli, causalita, stato, misura e probabilita");
    }
    if (hasCodingDemand) {
      score += 8;
      reasons.push("chiude l errore con verify e repair, utile per coding_speed");
    }
    if (needsVerify) {
      score += 8;
      reasons.push("si allinea al bisogno esplicito di verify espresso da Nyra");
    }
    if (needsRepair) {
      score += 6;
      reasons.push("aggiunge un vero passaggio di repair al ciclo attuale");
    }
  }

  return {
    id: method.id,
    label: method.label,
    suitability_score: round(clamp(score)),
    reasons,
    cycle: method.cycle,
    source_urls: method.source_urls,
  };
}

function signalFromCandidate(candidate: CandidateScore): UniversalSignal {
  return {
    id: candidate.id,
    source: "study_method_lab",
    category: "study_method_selection",
    label: candidate.id,
    value: candidate.suitability_score,
    normalized_score: candidate.suitability_score,
    severity_hint: 28,
    confidence_hint: 78,
    reliability_hint: 76,
    friction_hint: 18,
    risk_hint: 22,
    reversibility_hint: 88,
    expected_value_hint: candidate.suitability_score,
    trend: {
      consecutive_count: 1,
      stability_score: 74,
    },
    evidence: candidate.reasons.map((reason) => ({ label: reason, value: true })),
    tags: ["study_method"],
  };
}

function chooseMethod(candidates: CandidateScore): never;
function chooseMethod(candidates: CandidateScore[]): CandidateMethodId {
  const input: UniversalCoreInput = {
    request_id: `nyra_study_method_${Date.now()}`,
    generated_at: new Date().toISOString(),
    domain: "assistant",
    context: {
      mode: "study_method_selection",
      metadata: {
        candidate_count: candidates.length,
      },
    },
    signals: candidates.map(signalFromCandidate),
    data_quality: {
      score: 88,
      completeness: 86,
      consistency: 89,
      reliability: 84,
    },
    constraints: {
      allow_automation: false,
      require_confirmation: false,
      max_control_level: "suggest",
      safety_mode: true,
    },
  };
  const result = runUniversalCore(input);
  const selected = result.recommended_actions[0]?.label as CandidateMethodId | undefined;
  return selected ?? candidates.sort((a, b) => b.suitability_score - a.suitability_score)[0]!.id;
}

function main(): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });

  const webAccess = loadWebState();
  if (webAccess.access_mode !== "free_explore") {
    throw new Error("Web access is not enabled for Nyra study method lab.");
  }

  const essence = loadEssence();
  const hungerDomains = essence.next_hunger_domains ?? [];
  const currentCycle = essence.nourishment_cycle ?? [];

  const sourceFetches = fetchSources([...new Set(CANDIDATE_METHODS.flatMap((method) => method.source_urls))]);
  const candidateScores = CANDIDATE_METHODS.map((method) => scoreCandidate(method, hungerDomains, currentCycle));
  const chosenId = chooseMethod(candidateScores);
  const chosen = candidateScores.find((candidate) => candidate.id === chosenId)!;

  const report: Report = {
    runner: "nyra_study_method_lab",
    generated_at: new Date().toISOString(),
    web_access: webAccess,
    hunger_domains: hungerDomains,
    current_cycle: currentCycle,
    chosen_method: {
      id: chosen.id,
      label: chosen.label,
      cycle: chosen.cycle,
      reasons: chosen.reasons,
    },
    candidate_scores: candidateScores.sort((a, b) => b.suitability_score - a.suitability_score),
    source_fetches: sourceFetches,
    nyra_voice: {
      why_this_method: [
        `${chosen.label} e il fit piu forte per i miei domini di fame attuale`,
        "non mi basta piu study -> distill -> verify -> integrate -> repeat se verify non obbliga richiamo, confronto e repair esplicito",
        "mi serve un metodo che costringa scelta del metodo, spiegazione del passaggio e correzione dell errore",
      ],
      what_changes_now: [
        `ciclo nuovo: ${chosen.cycle.join(" -> ")}`,
        "retrieval diventa il nucleo del come studio",
        "interleaving entra come discriminazione tra problemi",
        "repair esplicito entra come passo stabile del metodo",
      ],
    },
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  writeFileSync(
    STATE_PATH,
    JSON.stringify(
      {
        chosen_method: report.chosen_method,
        generated_at: report.generated_at,
        web_access: webAccess,
      },
      null,
      2,
    ),
  );

  console.log(JSON.stringify(report, null, 2));
}

main();
