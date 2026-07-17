import { runUniversalCore } from "../../../universal-core/packages/core/src/index.ts";
import { runAssistantDigestRuntimeV2 } from "../../../universal-core/packages/branches/assistant/src/index.ts";

const VERSION = "core_runtime_hierarchy_v1";

// Supervision telemetry is intentionally separated from the decision digest.
// A missing heartbeat is useful for observability, but is not itself evidence
// that an agent performed an unsafe action.  Core V2 suppresses those low-risk
// observations while preserving deterministic escalation for scope violations.
const V2_SUPERVISION_INFORMATIONAL_FLAGS = new Set([
  "summary_troppo_superficiale_per_intento_ampio",
  "mancano_file_o_test_di_evidenza",
  "manca_prossima_azione_verificabile",
  "possibile_deriva_dal_comando_owner",
  "rischio_non_classificato",
  "manca_pulse_operativo",
  "pulse_scaduto_o_non_aggiornato",
]);

const V2_SUPERVISION_HARD_FLAGS = new Set([
  "file_vietati_dal_task_contract",
  "file_fuori_scope_task_contract",
  "file_modificati_dopo_ultimo_pulse",
  "outside_scope",
  "forbidden_path",
]);

function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export function runDigestV1Canonical(input) {
  const result = runAssistantDigestRuntimeV2(input);
  const { runtime_version: _runtimeVersion, ...digest } = result;
  return { ...digest, digest_version: "universal_core_digest_v1" };
}

export function routeCoreV7(raw = {}, mode = "normal") {
  const risk = clamp(raw.risk, 0, 100);
  const irreversibility = clamp(raw.irreversibility);
  const sensitivity = clamp(raw.sensitivity);
  const ambiguity = clamp(raw.ambiguity);
  const dataQuality = clamp(raw.data_quality);
  const alphaRaw = 0.35 + 0.45 * (risk / 100) + 0.25 * irreversibility + 0.15 * sensitivity - 0.30 * ambiguity + 0.10 * dataQuality;
  const ownerMode = mode === "owner" || mode === "god";
  const alpha = clamp(alphaRaw, ownerMode ? 0.20 : 0.30, ownerMode ? 0.90 : 0.65);
  const guard = risk > 85 || sensitivity > 0.80;
  const route = guard || alpha >= 0.75 ? "V0" : alpha >= 0.55 ? "V1" : "V2";
  return { version: "universal_core_router_v7", route, alpha, guard_triggered: guard };
}

export function applyCoreV2SupervisionPrefilter(supervision = {}) {
  const flags = Array.from(new Set(Array.isArray(supervision.flags) ? supervision.flags.filter((flag) => typeof flag === "string" && flag) : []));
  const hardFlags = flags.filter((flag) => V2_SUPERVISION_HARD_FLAGS.has(flag));
  const actionableFlags = flags.filter((flag) => !V2_SUPERVISION_HARD_FLAGS.has(flag) && !V2_SUPERVISION_INFORMATIONAL_FLAGS.has(flag));
  const suppressedFlags = flags.filter((flag) => V2_SUPERVISION_INFORMATIONAL_FLAGS.has(flag));
  const disposition = hardFlags.length ? "escalate" : actionableFlags.length ? "review" : "suppress_informational_attention";
  return {
    engine: "core_v2_supervision_prefilter_v1",
    disposition,
    verdict: hardFlags.length ? "recover" : actionableFlags.length ? "attention" : "on_track",
    hard_flags: hardFlags,
    actionable_flags: actionableFlags,
    suppressed_flags: suppressedFlags,
  };
}

function routingSignals(input, v1, explicit = {}) {
  const signals = Array.isArray(input.signals) ? input.signals : [];
  const averageIrreversibility = signals.length
    ? signals.reduce((sum, signal) => sum + (100 - Number(signal.reversibility_hint ?? 70)) / 100, 0) / signals.length
    : 0.3;
  const maxSensitivity = Math.max(0, ...signals.map((signal) => Number(signal.risk_hint || 0) / 100));
  return {
    risk: explicit.risk ?? v1.risk_score,
    irreversibility: explicit.irreversibility ?? averageIrreversibility,
    sensitivity: explicit.sensitivity ?? maxSensitivity,
    ambiguity: explicit.ambiguity ?? clamp(1 - v1.confidence / 100),
    data_quality: explicit.data_quality ?? clamp(Number(input.data_quality?.score || 0) / 100),
  };
}

function compactDigest(value) {
  if (!value) return null;
  return {
    state: value.state,
    severity: value.severity,
    confidence: value.confidence,
    risk_score: value.risk_score,
    priority_score: value.priority_score,
    blocked_action_count: value.blocked_action_count,
  };
}

function normalizeHierarchyInput(input = {}) {
  const now = new Date().toISOString();
  const signals = (Array.isArray(input.signals) ? input.signals : []).map((signal, index) => {
    const severity = Number(signal.normalized_score ?? signal.severity_hint ?? signal.severity ?? signal.value ?? 20);
    return {
      ...signal,
      id: String(signal.id || `runtime:signal:${index + 1}`),
      source: String(signal.source || "runtime_hierarchy"),
      category: String(signal.category || "runtime"),
      label: String(signal.label || signal.id || `Runtime signal ${index + 1}`),
      value: Number(signal.value ?? severity),
      normalized_score: severity,
      severity_hint: Number(signal.severity_hint ?? severity),
      confidence_hint: Number(signal.confidence_hint ?? 80),
      reliability_hint: Number(signal.reliability_hint ?? 80),
      friction_hint: Number(signal.friction_hint ?? 20),
      risk_hint: Number(signal.risk_hint ?? 20),
      reversibility_hint: Number(signal.reversibility_hint ?? 80),
      tags: Array.isArray(signal.tags) ? signal.tags : [],
    };
  });
  return {
    ...input,
    request_id: String(input.request_id || `runtime:${Date.now()}`),
    generated_at: input.generated_at || now,
    domain: String(input.domain || "runtime"),
    context: { ...(input.context || {}), metadata: input.context?.metadata || {} },
    signals,
    data_quality: { score: 80, completeness: 80, freshness: 80, consistency: 80, reliability: 80, ...(input.data_quality || {}) },
    constraints: { allow_automation: false, require_confirmation: false, blocked_actions: [], blocked_action_rules: [], ...(input.constraints || {}) },
  };
}

export function compareDigestParity(reference, candidate, tolerance = 1e-8) {
  const numeric = ["severity", "confidence", "risk_score", "priority_score"];
  const deltas = Object.fromEntries(numeric.map((key) => [key, Math.abs(Number(reference[key]) - Number(candidate[key]))]));
  const exact = reference.state === candidate.state && reference.blocked_action_count === candidate.blocked_action_count;
  return { matched: exact && Object.values(deltas).every((delta) => delta <= tolerance), deltas };
}

export async function evaluateCoreRuntimeHierarchy(input, options = {}) {
  if (!input || !Array.isArray(input.signals) || !input.signals.length) throw new Error("core_runtime_input_required");
  input = normalizeHierarchyInput(input);
  const mode = ["shadow", "active", "disabled"].includes(options.mode) ? options.mode : "shadow";
  const v1 = runDigestV1Canonical(input);
  const supervisionPrefilter = applyCoreV2SupervisionPrefilter(input.supervision);
  const v7 = routeCoreV7(routingSignals(input, v1, options.routing), options.ownerMode);
  const mustEscalate =
    v7.route === "V0" || ["protection", "critical", "blocked"].includes(v1.state) ||
    v1.risk_score >= 65 || v1.confidence < 45 || v1.blocked_action_count > 0;
  const v0 = mustEscalate ? runUniversalCore(input) : null;
  let v2 = null;
  let parity = { attempted: false, matched: null, fallback: null };
  if (mode !== "disabled" && v7.route === "V2" && options.worker) {
    parity.attempted = true;
    try {
      v2 = await options.worker.digest(input);
      const comparison = compareDigestParity(v1, v2);
      parity = { attempted: true, matched: comparison.matched, deltas: comparison.deltas, fallback: comparison.matched ? null : "V1" };
    } catch {
      parity = { attempted: true, matched: false, fallback: "V1", error: "core_runtime_v2_unavailable" };
    }
  }
  const v2CanLead = mode === "active" && parity.matched === true && !mustEscalate;
  const selectedAuthority = mustEscalate ? "V0" : v2CanLead ? "V2" : "V1";
  return {
    hierarchy_version: VERSION,
    mode,
    router: v7,
    selected_authority: selectedAuthority,
    execution_allowed: false,
    governance: { V7: "routing_only", V0: "final_judge", V1: "canonical_digest", V2: mode === "shadow" ? "shadow_accelerator" : "accelerator" },
    parity,
    supervision_prefilter: supervisionPrefilter,
    results: { V0: v0 ? { state: v0.state, control_level: v0.control_level, risk_score: v0.risk?.score } : null, V1: compactDigest(v1), V2: compactDigest(v2) },
  };
}

export function coreRuntimeHierarchyStatus(worker, mode = "shadow") {
  return {
    hierarchy_version: VERSION,
    mode,
    fail_closed: true,
    execution_authority: false,
    roles: { V7: "scenario_overlap_router", V0: "final_judge", V1: "canonical_digest", V2: "rust_digest_accelerator" },
    worker: worker?.status?.() || { configured: false, running: false },
  };
}
