import { runUniversalCore } from "../../../universal-core/packages/core/src/index.ts";
import { runAssistantDigestRuntimeV2 } from "../../../universal-core/packages/branches/assistant/src/index.ts";

const VERSION = "core_runtime_hierarchy_v1";

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

export function compareDigestParity(reference, candidate, tolerance = 1e-8) {
  const numeric = ["severity", "confidence", "risk_score", "priority_score"];
  const deltas = Object.fromEntries(numeric.map((key) => [key, Math.abs(Number(reference[key]) - Number(candidate[key]))]));
  const exact = reference.state === candidate.state && reference.blocked_action_count === candidate.blocked_action_count;
  return { matched: exact && Object.values(deltas).every((delta) => delta <= tolerance), deltas };
}

export async function evaluateCoreRuntimeHierarchy(input, options = {}) {
  if (!input || !Array.isArray(input.signals) || !input.signals.length) throw new Error("core_runtime_input_required");
  const mode = ["shadow", "active", "disabled"].includes(options.mode) ? options.mode : "shadow";
  const v1 = runDigestV1Canonical(input);
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
