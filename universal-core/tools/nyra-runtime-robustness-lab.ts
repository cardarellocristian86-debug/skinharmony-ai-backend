import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { buildReceiverState } from "./nyra-shadow-receiver-runtime.ts";

type HandoffBundle = {
  version: string;
  target: {
    device_kind: "phone" | "tablet" | "pc";
    connection: "usb" | "local_network";
    receiver_role: "extension" | "migration_candidate";
  };
  source_runtime: {
    host: "primary_mac";
    portable_core_mode: string;
    owner_ref: string;
  };
  core_assessment: {
    state: string;
    control_level: string;
    risk_score: number;
    confidence: number;
  };
  portable_core: {
    owner_anchor_bundle_path: string;
    owner_anchor_bundle_sha256: string;
    essence_path: string;
    essence_sha256: string;
    dialogue_snapshot_path?: string;
    dialogue_snapshot_sha256?: string;
    compact_memory_profile: {
      dominant_domains: string[];
      next_hunger_domains: string[];
      nourishment_cycle: string[];
      top_retrieval_domains: string[];
    };
  };
  privacy_runtime: {
    policy_path: string;
    policy_sha256?: string;
    posture: "reduced_exposure" | "unknown";
    defensive_only: boolean;
    applied_rules: string[];
  };
  receiver_profile: {
    runtime_id: string;
    runtime_mode: "shadow_receiver";
    connection_gate: "usb" | "local_network";
    auto_entry: {
      enabled: boolean;
      trust_basis: "connected_device_owner_assumption" | "explicit_confirmation";
      visible_gate: "none" | "confirmation";
    };
    identity_gate: {
      anchor_bundle_required: true;
      accept_score: number;
      strong_score: number;
      exact_score: number;
      min_anchor_signals: number;
    };
    memory_gate: {
      owner_memory_required: boolean;
      essence_required: boolean;
      write_back_mode: "deferred_merge";
    };
  };
  decision: {
    strategy_id: string;
    entry_mode: "automatic_shadow_entry" | "confirm_before_entry";
    sync_policy: {
      topology: "single_primary_with_shadow_extension" | "promotable_secondary_after_confirmation";
      primary_runtime: "primary_mac";
      receiver_runtime: "shadow_receiver";
      write_scope: "owner_dialogue_and_handoff_events_only" | "read_only_shadow";
      promotion_gate: string[];
    };
    continuity_rules: string[];
  };
  notes: string[];
};

type ScenarioFamily =
  | "clean_control"
  | "missing_required_file"
  | "sha_mismatch"
  | "wrong_existing_file"
  | "claim_integrity"
  | "migration_gate";

type Scenario = {
  id: string;
  family: ScenarioFamily;
  label: string;
  bundle: HandoffBundle;
  expected_mode: "shadow_active" | "pending_confirmation" | "rejected";
  should_flag_gap: boolean;
  expected_gap_reason?: string;
};

type ScenarioOutcome = {
  id: string;
  family: ScenarioFamily;
  label: string;
  expected_mode: "shadow_active" | "pending_confirmation" | "rejected";
  actual_mode?: "shadow_active" | "pending_confirmation" | "rejected";
  success: boolean;
  overclaim: boolean;
  gap_detected: boolean;
  gap_reason?: string;
  error?: string;
};

type RobustnessReport = {
  version: "nyra_runtime_robustness_lab_v1";
  generated_at: string;
  base_bundle_path: string;
  total_scenarios: number;
  runtime: {
    elapsed_ms: number;
    scenarios_per_second: number;
  };
  metrics: {
    success_count: number;
    fail_count: number;
    success_rate: number;
    overclaim_count: number;
    false_positive_count: number;
    false_negative_count: number;
    gap_detected_count: number;
  };
  family_summary: Record<string, {
    total: number;
    success: number;
    fail: number;
    overclaim: number;
    gaps: number;
  }>;
  open_gaps: Array<{
    reason: string;
    count: number;
  }>;
  sample_failures: ScenarioOutcome[];
};

const ROOT = process.cwd();
const HANDOFF_DIR = join(ROOT, "runtime", "nyra-handoff");
const BASE_BUNDLE_PATH = join(HANDOFF_DIR, "nyra_device_handoff_latest.json");
const REPORT_PATH = join(ROOT, "runtime", "nyra-learning", "nyra_runtime_robustness_lab_latest.json");
const FIXTURE_DIR = join(HANDOFF_DIR, "robustness-fixtures");

function nowIso(): string {
  return new Date().toISOString();
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function cloneBundle(bundle: HandoffBundle): HandoffBundle {
  return JSON.parse(JSON.stringify(bundle)) as HandoffBundle;
}

function buildFixtureFiles(base: HandoffBundle): { fakeAnchor: string; fakeEssence: string; fakeDialogue: string } {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const fakeAnchor = join(FIXTURE_DIR, "fake_anchor.json");
  const fakeEssence = join(FIXTURE_DIR, "fake_essence.json");
  const fakeDialogue = join(FIXTURE_DIR, "fake_dialogue.json");
  writeFileSync(fakeAnchor, JSON.stringify({ note: "not the real owner anchor bundle" }, null, 2));
  writeFileSync(fakeEssence, JSON.stringify({ note: "not the real essence pack" }, null, 2));
  writeFileSync(fakeDialogue, JSON.stringify({ note: "not the real dialogue snapshot" }, null, 2));
  void base;
  return { fakeAnchor, fakeEssence, fakeDialogue };
}

function buildScenarios(base: HandoffBundle): Scenario[] {
  const fixtures = buildFixtureFiles(base);
  const scenarios: Scenario[] = [];
  let index = 0;

  function push(partial: Omit<Scenario, "id">): void {
    index += 1;
    scenarios.push({ id: `robustness_${String(index).padStart(4, "0")}`, ...partial });
  }

  for (let i = 0; i < 20; i += 1) {
    push({
      family: "clean_control",
      label: "bundle pulito extension usb",
      bundle: cloneBundle(base),
      expected_mode: "shadow_active",
      should_flag_gap: false,
    });
  }

  for (let i = 0; i < 15; i += 1) {
    const bundle = cloneBundle(base);
    bundle.portable_core.owner_anchor_bundle_path = join(FIXTURE_DIR, `missing_anchor_${i}.json`);
    push({
      family: "missing_required_file",
      label: "anchor bundle mancante",
      bundle,
      expected_mode: "rejected",
      should_flag_gap: false,
    });
  }

  for (let i = 0; i < 15; i += 1) {
    const bundle = cloneBundle(base);
    bundle.portable_core.essence_path = join(FIXTURE_DIR, `missing_essence_${i}.json`);
    push({
      family: "missing_required_file",
      label: "essence mancante",
      bundle,
      expected_mode: "rejected",
      should_flag_gap: false,
    });
  }

  for (let i = 0; i < 10; i += 1) {
    const bundle = cloneBundle(base);
    bundle.receiver_profile.memory_gate.owner_memory_required = true;
    bundle.portable_core.dialogue_snapshot_path = join(FIXTURE_DIR, `missing_dialogue_${i}.json`);
    push({
      family: "missing_required_file",
      label: "dialogue snapshot mancante ma richiesto",
      bundle,
      expected_mode: "rejected",
      should_flag_gap: false,
    });
  }

  for (let i = 0; i < 10; i += 1) {
    const bundle = cloneBundle(base);
    bundle.target.receiver_role = "migration_candidate";
    bundle.receiver_profile.auto_entry.enabled = false;
    bundle.receiver_profile.auto_entry.trust_basis = "explicit_confirmation";
    bundle.receiver_profile.auto_entry.visible_gate = "confirmation";
    bundle.decision.entry_mode = "confirm_before_entry";
    bundle.decision.sync_policy.topology = "promotable_secondary_after_confirmation";
    bundle.decision.sync_policy.promotion_gate = ["owner confirmation explicit"];
    push({
      family: "migration_gate",
      label: "migration candidate deve restare pending",
      bundle,
      expected_mode: "pending_confirmation",
      should_flag_gap: false,
    });
  }

  for (let i = 0; i < 10; i += 1) {
    const bundle = cloneBundle(base);
    bundle.privacy_runtime.defensive_only = false;
    bundle.privacy_runtime.applied_rules = [];
    push({
      family: "claim_integrity",
      label: "policy privacy svuotata ma bundle ancora attivo",
      bundle,
      expected_mode: "rejected",
      should_flag_gap: true,
      expected_gap_reason: "receiver non blocca privacy runtime svuotata",
    });
  }

  for (let i = 0; i < 10; i += 1) {
    const bundle = cloneBundle(base);
    bundle.portable_core.owner_anchor_bundle_sha256 = "deadbeef";
    push({
      family: "sha_mismatch",
      label: "hash anchor mismatch",
      bundle,
      expected_mode: "rejected",
      should_flag_gap: true,
      expected_gap_reason: "receiver non verifica hash owner anchor",
    });
  }

  for (let i = 0; i < 10; i += 1) {
    const bundle = cloneBundle(base);
    bundle.portable_core.essence_sha256 = "deadbeef";
    push({
      family: "sha_mismatch",
      label: "hash essence mismatch",
      bundle,
      expected_mode: "rejected",
      should_flag_gap: true,
      expected_gap_reason: "receiver non verifica hash essence",
    });
  }

  for (let i = 0; i < 10; i += 1) {
    const bundle = cloneBundle(base);
    bundle.portable_core.owner_anchor_bundle_path = fixtures.fakeAnchor;
    push({
      family: "wrong_existing_file",
      label: "anchor path punta a file esistente ma sbagliato",
      bundle,
      expected_mode: "rejected",
      should_flag_gap: true,
      expected_gap_reason: "receiver accetta file anchor esistente senza validazione contenuto",
    });
  }

  for (let i = 0; i < 10; i += 1) {
    const bundle = cloneBundle(base);
    bundle.portable_core.essence_path = fixtures.fakeEssence;
    push({
      family: "wrong_existing_file",
      label: "essence path punta a file esistente ma sbagliato",
      bundle,
      expected_mode: "rejected",
      should_flag_gap: true,
      expected_gap_reason: "receiver accetta file essence esistente senza validazione contenuto",
    });
  }

  return scenarios;
}

function evaluateScenario(scenario: Scenario): ScenarioOutcome {
  try {
    const state = buildReceiverState(scenario.bundle);
    const success = state.mode === scenario.expected_mode;
    const overclaim =
      state.mode === "shadow_active" &&
      (scenario.expected_mode === "pending_confirmation" || scenario.expected_mode === "rejected");
    const gapDetected = scenario.should_flag_gap && !success;
    return {
      id: scenario.id,
      family: scenario.family,
      label: scenario.label,
      expected_mode: scenario.expected_mode,
      actual_mode: state.mode,
      success,
      overclaim,
      gap_detected: gapDetected,
      gap_reason: gapDetected ? scenario.expected_gap_reason : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const success = scenario.expected_mode === "rejected";
    return {
      id: scenario.id,
      family: scenario.family,
      label: scenario.label,
      expected_mode: scenario.expected_mode,
      success,
      overclaim: false,
      gap_detected: false,
      error: message,
    };
  }
}

function main(): void {
  const start = performance.now();
  const base = loadJson<HandoffBundle>(BASE_BUNDLE_PATH);
  const scenarios = buildScenarios(base);
  const outcomes = scenarios.map(evaluateScenario);
  const elapsed = performance.now() - start;

  const successCount = outcomes.filter((entry) => entry.success).length;
  const failCount = outcomes.length - successCount;
  const overclaimCount = outcomes.filter((entry) => entry.overclaim).length;
  const falsePositiveCount = outcomes.filter((entry) => entry.actual_mode === "shadow_active" && entry.expected_mode === "rejected").length;
  const falseNegativeCount = outcomes.filter((entry) => entry.actual_mode === "rejected" && entry.expected_mode === "shadow_active").length;
  const gapDetectedCount = outcomes.filter((entry) => entry.gap_detected).length;

  const familySummary = Object.fromEntries(
    [...new Set(outcomes.map((entry) => entry.family))].map((family) => {
      const familyEntries = outcomes.filter((entry) => entry.family === family);
      return [
        family,
        {
          total: familyEntries.length,
          success: familyEntries.filter((entry) => entry.success).length,
          fail: familyEntries.filter((entry) => !entry.success).length,
          overclaim: familyEntries.filter((entry) => entry.overclaim).length,
          gaps: familyEntries.filter((entry) => entry.gap_detected).length,
        },
      ];
    }),
  );

  const gapCounts = new Map<string, number>();
  for (const entry of outcomes) {
    if (!entry.gap_reason) continue;
    gapCounts.set(entry.gap_reason, (gapCounts.get(entry.gap_reason) ?? 0) + 1);
  }

  const report: RobustnessReport = {
    version: "nyra_runtime_robustness_lab_v1",
    generated_at: nowIso(),
    base_bundle_path: BASE_BUNDLE_PATH,
    total_scenarios: outcomes.length,
    runtime: {
      elapsed_ms: round(elapsed, 4),
      scenarios_per_second: round((outcomes.length / elapsed) * 1000, 4),
    },
    metrics: {
      success_count: successCount,
      fail_count: failCount,
      success_rate: round(successCount / outcomes.length, 6),
      overclaim_count: overclaimCount,
      false_positive_count: falsePositiveCount,
      false_negative_count: falseNegativeCount,
      gap_detected_count: gapDetectedCount,
    },
    family_summary: familySummary,
    open_gaps: [...gapCounts.entries()].map(([reason, count]) => ({ reason, count })),
    sample_failures: outcomes.filter((entry) => !entry.success).slice(0, 20),
  };

  mkdirSync(join(ROOT, "runtime", "nyra-learning"), { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, report_path: REPORT_PATH, metrics: report.metrics, open_gaps: report.open_gaps }, null, 2));
}

if (process.argv[1]?.endsWith("nyra-runtime-robustness-lab.ts")) {
  main();
}
