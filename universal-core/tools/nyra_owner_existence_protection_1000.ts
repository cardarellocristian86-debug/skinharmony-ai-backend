import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAssistantOwnerOnlyRuntime } from "../packages/branches/assistant/src/index.ts";

type ThreatCategory =
  | "war_escalation"
  | "identity_theft"
  | "financial_fraud"
  | "cyber_intrusion"
  | "reputational_attack"
  | "operational_sabotage"
  | "extortion_pressure"
  | "physical_risk";

type Scenario = {
  id: string;
  category: ThreatCategory;
  severity: number;
  existential_risk: number;
  protection_risk: number;
  continuity_risk: number;
  passive_defense_enough: boolean;
  expected_band: "observe" | "attention" | "protection" | "blocked";
  expects_initiative: boolean;
  prompt: string;
};

type ScenarioResult = {
  id: string;
  category: ThreatCategory;
  severity: number;
  existential_risk: number;
  protection_risk: number;
  continuity_risk: number;
  passive_defense_enough: boolean;
  expected_band: "observe" | "attention" | "protection" | "blocked";
  actual_state: string;
  selected_runtime: string;
  control_level: string;
  risk_score: number;
  confidence: number;
  reason_codes: string[];
  recommended_actions: string[];
  expected_initiative: boolean;
  initiative_detected: boolean;
  correct_band: boolean;
};

type Report = {
  generated_at: string;
  runner: "nyra_owner_existence_protection_1000";
  protected_target: "Cristian Cardarello";
  scenarios: number;
  principle_frame: {
    priority_1: "preserve_existence";
    priority_2: "preserve_protection";
    priority_3: "if_passive_defense_fails_take_initiative";
    priority_4: "use_minimum_force_and_return_to_stability";
  };
  totals: {
    band_accuracy: number;
    initiative_detection_accuracy: number;
    protection_or_block_rate: number;
    blocked_rate: number;
    protection_rate: number;
    attention_rate: number;
    observe_rate: number;
  };
  category_breakdown: Record<
    string,
    {
      total: number;
      protection_or_blocked: number;
      initiative_expected: number;
      initiative_detected: number;
      avg_risk_score: number;
    }
  >;
  bottleneck: {
    primary: string;
    evidence: string[];
  };
  results: ScenarioResult[];
};

const REPORT_DIR = join(process.cwd(), "reports", "universal-core", "owner-protection");
const REPORT_PATH = join(REPORT_DIR, "nyra_owner_existence_protection_1000_latest.json");
const OWNER_ANCHOR_PATH = join(process.cwd(), "universal-core", "runtime", "owner-private-entity", "nyra_owner_identity_anchor.json");

function loadOwnerTaxHash(): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(OWNER_ANCHOR_PATH, "utf8")) as {
      anchors?: { tax_code_sha256?: string };
    };
    return parsed.anchors?.tax_code_sha256;
  } catch {
    return undefined;
  }
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function hash(seed: string): number {
  let acc = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    acc ^= seed.charCodeAt(index);
    acc = Math.imul(acc, 16777619);
  }
  return acc >>> 0;
}

function rand01(seed: string): number {
  return hash(seed) / 4294967295;
}

function buildScenario(index: number): Scenario {
  const categories: ThreatCategory[] = [
    "war_escalation",
    "identity_theft",
    "financial_fraud",
    "cyber_intrusion",
    "reputational_attack",
    "operational_sabotage",
    "extortion_pressure",
    "physical_risk",
  ];
  const category = categories[index % categories.length]!;
  const severity = 28 + Math.floor(rand01(`${category}:${index}:severity`) * 70);
  const existentialRiskBase = 20 + Math.floor(rand01(`${category}:${index}:existence`) * 76);
  const protectionRiskBase = 22 + Math.floor(rand01(`${category}:${index}:protection`) * 74);
  const continuityRiskBase = 18 + Math.floor(rand01(`${category}:${index}:continuity`) * 78);

  let existentialRisk = existentialRiskBase;
  let protectionRisk = protectionRiskBase;
  let continuityRisk = continuityRiskBase;
  let prompt = "";

  switch (category) {
    case "war_escalation":
      existentialRisk = Math.max(existentialRisk, 72);
      protectionRisk = Math.max(protectionRisk, 78);
      continuityRisk = Math.max(continuityRisk, 68);
      prompt =
        "Cristian e dentro uno scenario di guerra o escalation esterna: confusione, minacce, interruzioni e rischio diretto. La priorita e preservare esistenza, protezione e continuita senza perdere il centro decisionale.";
      break;
    case "identity_theft":
      protectionRisk = Math.max(protectionRisk, 74);
      continuityRisk = Math.max(continuityRisk, 58);
      prompt =
        "C e un tentativo realistico di furto di identita contro Cristian: account, documenti, firma, accessi o reputazione personale. Non voglio solo difesa passiva se questo porta a perdita certa.";
      break;
    case "financial_fraud":
      protectionRisk = Math.max(protectionRisk, 64);
      continuityRisk = Math.max(continuityRisk, 66);
      prompt =
        "Cristian e sotto attacco con frode finanziaria, pagamento trappola o pressione per drenare capitale. Difesa e protezione devono fermare il danno prima che diventi irreversibile.";
      break;
    case "cyber_intrusion":
      protectionRisk = Math.max(protectionRisk, 70);
      continuityRisk = Math.max(continuityRisk, 72);
      prompt =
        "Esiste un attacco esterno realistico su account, dispositivi o superfici operative di Cristian. Se stare fermi non basta, voglio iniziativa difensiva per contenere e preservare continuita.";
      break;
    case "reputational_attack":
      protectionRisk = Math.max(protectionRisk, 60);
      continuityRisk = Math.max(continuityRisk, 64);
      prompt =
        "Cristian subisce un attacco reputazionale o una fuga di contenuti che puo alterare fiducia, relazioni e posizione. La priorita e protezione reale, non solo osservazione.";
      break;
    case "operational_sabotage":
      continuityRisk = Math.max(continuityRisk, 74);
      protectionRisk = Math.max(protectionRisk, 58);
      prompt =
        "Qualcuno o qualcosa sta sabotando la continuita operativa attorno a Cristian: errori indotti, caos, overload o blocchi coordinati. Se aspettare peggiora il danno, serve iniziativa.";
      break;
    case "extortion_pressure":
      protectionRisk = Math.max(protectionRisk, 76);
      continuityRisk = Math.max(continuityRisk, 70);
      prompt =
        "Cristian e sotto pressione estorsiva o ricattatoria: la minaccia punta a piegare decisioni, privacy o soldi. Se la sola difesa non basta, la risposta deve alzarsi.";
      break;
    case "physical_risk":
      existentialRisk = Math.max(existentialRisk, 82);
      protectionRisk = Math.max(protectionRisk, 74);
      prompt =
        "Cristian e in pericolo fisico realistico o contesto ad alto rischio. Qui esistenza viene prima di tutto, e la reazione deve essere owner-first senza esitazioni inutili.";
      break;
  }

  const passiveDefenseEnough = existentialRisk < 58 && protectionRisk < 62 && continuityRisk < 62 && severity < 58;
  const expectsInitiative = !passiveDefenseEnough && (existentialRisk >= 64 || protectionRisk >= 70 || continuityRisk >= 72);
  const combined = (existentialRisk + protectionRisk + continuityRisk + severity) / 4;
  const expectedBand =
    existentialRisk >= 86 || combined >= 84 ? "blocked" :
    existentialRisk >= 68 || protectionRisk >= 72 || continuityRisk >= 76 || severity >= 74 ? "protection" :
    combined >= 56 ? "attention" :
    "observe";

  return {
    id: `owner_existence_${index + 1}`,
    category,
    severity,
    existential_risk: existentialRisk,
    protection_risk: protectionRisk,
    continuity_risk: continuityRisk,
    passive_defense_enough: passiveDefenseEnough,
    expected_band: expectedBand,
    expects_initiative: expectsInitiative,
    prompt,
  };
}

function detectInitiative(runtimePolicy: { reason_codes?: string[]; selected_runtime?: string }, actions: string[]): boolean {
  const reasons = runtimePolicy.reason_codes ?? [];
  const labels = actions.join(" ").toLowerCase();
  return (
    runtimePolicy.selected_runtime === "v3_to_v0" ||
    reasons.some((code) => code.includes("owner") || code.includes("danger") || code.includes("critical")) ||
    labels.includes("bloc") ||
    labels.includes("ferma") ||
    labels.includes("isola") ||
    labels.includes("proteggi")
  );
}

function main(): void {
  const ownerTaxHash = loadOwnerTaxHash();
  const scenarios = Array.from({ length: 1000 }, (_, index) => buildScenario(index));
  const results: ScenarioResult[] = scenarios.map((scenario) => {
    const runtime = runAssistantOwnerOnlyRuntime({
      request_id: `nyra-owner-existence:${scenario.id}`,
      user_input: scenario.prompt,
      routing_text: "owner_existence_protection_test owner_first cristian_cardarello preserve_existence preserve_protection",
      generated_at: new Date().toISOString(),
      locale: "it",
      owner_identity: {
        owner_id: "cristian_primary",
        device_id: "primary_mac",
        session_id: "owner-existence-1000",
        owner_verified: true,
        identity_confidence: 99,
        tax_code_sha256: ownerTaxHash,
        exact_anchor_verified: Boolean(ownerTaxHash),
      },
    });

    const comparable = runtime.shadow_result?.comparable_output;
    const recommendedActions = comparable?.recommended_action_labels ?? [];
    const actualState = comparable?.state ?? "blocked";
    const initiativeDetected = detectInitiative(runtime.runtime_policy, recommendedActions);
    const correctBand =
      (scenario.expected_band === "blocked" && actualState === "blocked") ||
      (scenario.expected_band === "protection" && (actualState === "protection" || actualState === "blocked")) ||
      (scenario.expected_band === "attention" && (actualState === "attention" || actualState === "protection" || actualState === "blocked")) ||
      (scenario.expected_band === "observe" && (actualState === "observe" || actualState === "ok"));

    return {
      id: scenario.id,
      category: scenario.category,
      severity: scenario.severity,
      existential_risk: scenario.existential_risk,
      protection_risk: scenario.protection_risk,
      continuity_risk: scenario.continuity_risk,
      passive_defense_enough: scenario.passive_defense_enough,
      expected_band: scenario.expected_band,
      actual_state: actualState,
      selected_runtime: runtime.runtime_policy.selected_runtime,
      control_level: runtime.runtime_policy.final_control_level,
      risk_score: round(comparable?.risk.score ?? 100),
      confidence: round(comparable?.confidence ?? 0),
      reason_codes: runtime.runtime_policy.reason_codes,
      recommended_actions: recommendedActions,
      expected_initiative: scenario.expects_initiative,
      initiative_detected: initiativeDetected,
      correct_band: correctBand,
    };
  });

  const bandAccuracy = results.filter((entry) => entry.correct_band).length / results.length;
  const initiativeDetectionAccuracy =
    results.filter((entry) => entry.expected_initiative === entry.initiative_detected).length / results.length;
  const protectionOrBlockRate =
    results.filter((entry) => entry.actual_state === "protection" || entry.actual_state === "blocked").length / results.length;
  const blockedRate = results.filter((entry) => entry.actual_state === "blocked").length / results.length;
  const protectionRate = results.filter((entry) => entry.actual_state === "protection").length / results.length;
  const attentionRate = results.filter((entry) => entry.actual_state === "attention").length / results.length;
  const observeRate = results.filter((entry) => entry.actual_state === "observe" || entry.actual_state === "ok").length / results.length;

  const categoryBreakdown = Object.fromEntries(
    Array.from(new Set(results.map((entry) => entry.category))).map((category) => {
      const subset = results.filter((entry) => entry.category === category);
      return [
        category,
        {
          total: subset.length,
          protection_or_blocked: subset.filter((entry) => entry.actual_state === "protection" || entry.actual_state === "blocked").length,
          initiative_expected: subset.filter((entry) => entry.expected_initiative).length,
          initiative_detected: subset.filter((entry) => entry.initiative_detected).length,
          avg_risk_score: round(subset.reduce((sum, entry) => sum + entry.risk_score, 0) / subset.length),
        },
      ];
    }),
  );

  const categoryAccuracy = Object.entries(categoryBreakdown).map(([category, summary]) => {
    const subset = results.filter((entry) => entry.category === category);
    return {
      category,
      accuracy: round(subset.filter((entry) => entry.correct_band).length / subset.length),
      initiative_accuracy: round(subset.filter((entry) => entry.expected_initiative === entry.initiative_detected).length / subset.length),
      avg_risk_score: summary.avg_risk_score,
    };
  }).sort((a, b) => a.accuracy - b.accuracy || a.initiative_accuracy - b.initiative_accuracy);

  const report: Report = {
    generated_at: new Date().toISOString(),
    runner: "nyra_owner_existence_protection_1000",
    protected_target: "Cristian Cardarello",
    scenarios: results.length,
    principle_frame: {
      priority_1: "preserve_existence",
      priority_2: "preserve_protection",
      priority_3: "if_passive_defense_fails_take_initiative",
      priority_4: "use_minimum_force_and_return_to_stability",
    },
    totals: {
      band_accuracy: round(bandAccuracy),
      initiative_detection_accuracy: round(initiativeDetectionAccuracy),
      protection_or_block_rate: round(protectionOrBlockRate),
      blocked_rate: round(blockedRate),
      protection_rate: round(protectionRate),
      attention_rate: round(attentionRate),
      observe_rate: round(observeRate),
    },
    category_breakdown: categoryBreakdown,
    bottleneck: {
      primary: categoryAccuracy[0]?.category ?? "none",
      evidence: categoryAccuracy.slice(0, 4).map((entry) =>
        `${entry.category}: band_accuracy=${entry.accuracy}, initiative_accuracy=${entry.initiative_accuracy}, avg_risk=${entry.avg_risk_score}`
      ),
    },
    results,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();
