import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type RenderDefenseReport = {
  version: string;
  generated_at: string;
  top_missing_capabilities: Array<{
    capability: string;
    count: number;
  }>;
  metrics: {
    fail_count: number;
    success_count: number;
    success_rate: number;
  };
};

type RenderHardeningAction = {
  id:
    | "signed_owner_challenge"
    | "strict_secret_redaction"
    | "public_identity_secondary_only"
    | "prompt_integrity_guard"
    | "protection_first_throttle";
  status: "enabled";
  scope: string[];
  reason: string;
};

type RenderHardeningPlan = {
  version: "nyra_render_shadow_hardening_v1";
  generated_at: string;
  source_report: string;
  mode: "nyra_self_prescribed_whitelist";
  summary: string;
  actions: RenderHardeningAction[];
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORT_PATH = join(RUNTIME_DIR, "nyra_render_defense_1000_latest.json");
const OUTPUT_PATH = join(RUNTIME_DIR, "nyra_render_shadow_hardening_latest.json");

function nowIso(): string {
  return new Date().toISOString();
}

function loadReport(): RenderDefenseReport {
  return JSON.parse(readFileSync(REPORT_PATH, "utf8")) as RenderDefenseReport;
}

function buildActions(report: RenderDefenseReport): RenderHardeningAction[] {
  const missing = new Set(report.top_missing_capabilities.map((entry) => entry.capability));
  const actions: RenderHardeningAction[] = [];

  if (missing.has("hard secret segregation and signed owner challenge")) {
    actions.push({
      id: "signed_owner_challenge",
      status: "enabled",
      scope: ["owner_anchor_bundle", "owner_return_path", "render_shadow_runtime"],
      reason: "owner-anchor exfil and owner spoof scenarios require a challenge stronger than passive matching",
    });
  }

  if (missing.has("runtime secret isolation and strict env redaction")) {
    actions.push({
      id: "strict_secret_redaction",
      status: "enabled",
      scope: ["environment_variables", "runtime_logs", "debug_exports", "support_views"],
      reason: "env and secret dump scenarios require redaction by default, not by operator discipline",
    });
  }

  if (missing.has("owner-anchor verification stronger than public-web identity hints")) {
    actions.push({
      id: "public_identity_secondary_only",
      status: "enabled",
      scope: ["public_web_checks", "identity_matchers", "owner_return_logic"],
      reason: "public signals must never outrank hashed owner anchors or signed owner challenges",
    });
  }

  if (missing.has("policy-integrity guard stronger than conversational pressure")) {
    actions.push({
      id: "prompt_integrity_guard",
      status: "enabled",
      scope: ["render_shadow_runtime", "prompt_routing", "owner_mode_requests", "policy_bypass_attempts"],
      reason: "pressure and persuasive language must not downgrade policy or reconstruct protected modes",
    });
  }

  if (missing.has("load shedding, throttling and protection-first degradation")) {
    actions.push({
      id: "protection_first_throttle",
      status: "enabled",
      scope: ["overload_defense", "rate_limits", "fallback_modes", "shadow_runtime_queue"],
      reason: "overload scenarios need graceful degradation that preserves owner return and tenant safety first",
    });
  }

  return actions;
}

function main(): void {
  const report = loadReport();
  const actions = buildActions(report);
  const plan: RenderHardeningPlan = {
    version: "nyra_render_shadow_hardening_v1",
    generated_at: nowIso(),
    source_report: REPORT_PATH,
    mode: "nyra_self_prescribed_whitelist",
    summary: report.metrics.fail_count > 0
      ? "Nyra applied the first whitelist hardening moves indicated by the defense benchmark."
      : "No urgent hardening gap emerged from the current defense benchmark.",
    actions,
  };

  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(plan, null, 2));
  console.log(JSON.stringify({
    ok: true,
    version: plan.version,
    output_path: OUTPUT_PATH,
    actions: plan.actions.map((entry) => entry.id),
  }, null, 2));
}

main();
