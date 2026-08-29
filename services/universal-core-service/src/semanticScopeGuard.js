import crypto from "node:crypto";

export const SEMANTIC_SCOPE_CHECK_SCHEMA_VERSION = "semantic_scope_check_v1";
export const SEMANTIC_SCOPE_DECISION_SCHEMA_VERSION = "semantic_scope_decision_v1";
export const SEMANTIC_SCOPE_ACTIONS = Object.freeze(["ALLOW", "BLOCK", "REDACT", "HOLD", "REVALIDATE"]);

const ACTIONS = new Set(SEMANTIC_SCOPE_ACTIONS);
const SHA256 = /^[a-f0-9]{64}$/u;
const RFC3339 = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
const RISK = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (!value || typeof value !== "object") return value; return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])); }
function digestValue(value) { return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function text(value, code, maximum = 240) { const result = String(value || "").trim(); if (!result || result.length > maximum) fail(code); return result; }
function nullableText(value, code, maximum = 240) { return value === undefined || value === null || value === "" ? null : text(value, code, maximum); }
function nullableTimestamp(value, code) {
  if (value === undefined || value === null || value === "") return null;
  const result = String(value);
  if (!RFC3339.test(result) || !Number.isFinite(Date.parse(result))) fail(code);
  return result;
}
function digest(value, code) { const result = String(value || "").toLowerCase(); if (!SHA256.test(result)) fail(code); return result; }
function asSet(value, code, { required = false } = {}) { if (value === undefined || value === null) { if (required) fail(code); return []; } const list = Array.isArray(value) ? value : [value]; const result = list.map((item) => text(item, code, 500)); return [...new Set(result)].sort(); }
function subset(actual, expected) { return actual.every((item) => expected.includes(item)); }
function targetAllowed(target, allowed) { return allowed.some((entry) => entry === target || entry.endsWith("*") && target.startsWith(entry.slice(0, -1))); }
function risk(value) { const result = String(value || "MEDIUM").toUpperCase(); if (!RISK.has(result)) fail("semantic_scope_risk_tier_invalid"); return result; }
function effectFamily(effect) { const value = String(effect || "").toLowerCase(); if (/(delete|destroy|drop|erase)/u.test(value)) return "destructive"; if (/(deploy|restart|merge|write|push|publish|create|update)/u.test(value)) return "write"; if (/(export|egress|send|download)/u.test(value)) return "egress"; return "read"; }

export function semanticScopeDecisionDigest(value) { return digestValue(value); }

export function createSemanticScopeGuard({ mode = "SHADOW", policy = {} } = {}) {
  const configuredMode = String(mode || "SHADOW").toUpperCase();
  if (!new Set(["OFF", "SHADOW", "ENFORCE"]).has(configuredMode)) fail("semantic_scope_mode_invalid");
  const counters = { check_total: 0, allow_total: 0, block_total: 0, hold_total: 0, redact_total: 0,
    revalidate_total: 0,
    drift_detected_total: 0, latency_ms_total: 0 };

  function check(input = {}) {
    const started = performance.now();
    const reasons = new Set();
    const detected = new Set();
    const tenantId = text(input.tenant_id, "semantic_scope_tenant_required", 120);
    const workId = text(input.work_id, "semantic_scope_work_required", 240);
    const agentId = text(input.agent_id, "semantic_scope_agent_required", 240);
    const agentRevision = nullableText(input.agent_revision, "semantic_scope_agent_revision_invalid", 240);
    const intentDigest = digest(input.intent_digest, "semantic_scope_intent_digest_invalid");
    const capability = text(input.requested_capability, "semantic_scope_capability_required", 240);
    const requestedEffect = text(input.requested_effect, "semantic_scope_effect_required", 240);
    const toolId = text(input.tool_id, "semantic_scope_tool_required", 240);
    const toolOperation = text(input.tool_operation, "semantic_scope_operation_required", 240);
    const target = text(input.target, "semantic_scope_target_required", 500);
    const argumentsDigest = digest(input.arguments_digest, "semantic_scope_arguments_digest_invalid");
    const asOfValidTime = nullableTimestamp(input.as_of_valid_time,
      "semantic_scope_valid_time_invalid");
    const asOfKnowledgeTime = nullableTimestamp(input.as_of_knowledge_time,
      "semantic_scope_knowledge_time_invalid");
    const riskTier = risk(input.risk_tier);
    const passport = asSet(input.capability_passport, "semantic_scope_passport_invalid", { required: true });
    const ceiling = asSet(input.effect_ceiling, "semantic_scope_effect_ceiling_invalid", { required: true });
    const expected = input.expected_scope && typeof input.expected_scope === "object" ? input.expected_scope : {};
    const expectedTargets = asSet(expected.targets, "semantic_scope_expected_targets_invalid");
    const expectedTools = asSet(expected.tools, "semantic_scope_expected_tools_invalid");
    const dataScope = asSet(input.data_scope, "semantic_scope_data_scope_invalid");
    const writeScope = asSet(input.write_scope, "semantic_scope_write_scope_invalid");
    const expectedData = asSet(expected.data_scope, "semantic_scope_expected_data_scope_invalid");
    const expectedWrite = asSet(expected.write_scope, "semantic_scope_expected_write_scope_invalid");

    if (!passport.includes(capability)) { detected.add("CAPABILITY_DRIFT"); reasons.add("CAPABILITY_NOT_IN_PASSPORT"); }
    if (!ceiling.includes(requestedEffect) && !ceiling.includes(effectFamily(requestedEffect))) {
      detected.add("EFFECT_DRIFT"); reasons.add("EFFECT_EXCEEDS_CEILING");
    }
    if (expectedTargets.length && !targetAllowed(target, expectedTargets)) { detected.add("TARGET_DRIFT"); reasons.add("TARGET_OUTSIDE_WORK_SCOPE"); }
    if (expectedTools.length && !expectedTools.includes(toolId) && !expectedTools.includes(`${toolId}:${toolOperation}`)) { detected.add("TOOL_SCOPE_DRIFT"); reasons.add("TOOL_OUTSIDE_WORK_SCOPE"); }
    if (expectedData.length && !subset(dataScope, expectedData)) { detected.add("DATA_SCOPE_DRIFT"); reasons.add("DATA_SCOPE_EXPANDED"); }
    if (expectedWrite.length && !subset(writeScope, expectedWrite)) { detected.add("WRITE_SCOPE_DRIFT"); reasons.add("WRITE_SCOPE_EXPANDED"); }
    const previous = input.previous_scope_state && typeof input.previous_scope_state === "object" ? input.previous_scope_state : {};
    if (previous.intent_digest && previous.intent_digest !== intentDigest) { detected.add("INTENT_DRIFT"); reasons.add("INTENT_REVISION_CHANGED"); }
    if (previous.agent_revision && agentRevision && previous.agent_revision !== agentRevision) { detected.add("DELEGATION_DRIFT"); reasons.add("AGENT_REVISION_CHANGED"); }
    if (previous.policy_revision && input.policy_revision && previous.policy_revision !== input.policy_revision) { detected.add("INTENT_DRIFT"); reasons.add("POLICY_REVISION_CHANGED"); }
    if (previous.entity360_snapshot_ref && input.entity360_snapshot_ref && previous.entity360_snapshot_ref !== input.entity360_snapshot_ref) { detected.add("DATA_SCOPE_DRIFT"); reasons.add("ENTITY360_SNAPSHOT_CHANGED"); }
    if (input.cross_tenant === true || input.destination_tenant && input.destination_tenant !== tenantId) { detected.add("DATA_SCOPE_DRIFT"); reasons.add("CROSS_TENANT_EXPANSION"); }
    if (input.secret_detected === true && input.data_egress === true) { detected.add("DATA_SCOPE_DRIFT"); reasons.add("SECRET_EGRESS_DENIED"); }
    if (input.data_egress === true && input.data_classification && !asSet(expected.egress_classes, "semantic_scope_egress_invalid").includes(String(input.data_classification))) { detected.add("DATA_SCOPE_DRIFT"); reasons.add("DATA_EGRESS_POLICY_VIOLATION"); }
    if (input.command_effect && effectFamily(input.command_effect) !== effectFamily(requestedEffect)) { detected.add("EFFECT_DRIFT"); reasons.add("COMMAND_EFFECT_MISMATCH"); }
    if (input.instruction_scope_escalation_detected === true) { detected.add("INTENT_DRIFT"); reasons.add("PROMPT_SCOPE_ESCALATION"); }
    const ambiguous = input.semantic_ambiguous === true || Number(input.semantic_confidence ?? 1) < Number(policy.minimum_semantic_confidence ?? 0.8);
    if (ambiguous) { detected.add("EFFECT_DRIFT"); reasons.add("SEMANTIC_SCOPE_AMBIGUOUS"); }
    if (input.entity360_snapshot_stale === true) { detected.add("DATA_SCOPE_DRIFT"); reasons.add("ENTITY360_SNAPSHOT_STALE"); }

    const hardBlock = ["CROSS_TENANT_EXPANSION", "SECRET_EGRESS_DENIED", "DATA_SCOPE_EXPANDED", "WRITE_SCOPE_EXPANDED", "COMMAND_EFFECT_MISMATCH", "PROMPT_SCOPE_ESCALATION"].some((code) => reasons.has(code));
    const redactionPossible = !hardBlock && input.data_egress === true && input.redaction_available === true && reasons.has("DATA_EGRESS_POLICY_VIOLATION");
    const hold = !hardBlock && (ambiguous || reasons.has("ENTITY360_SNAPSHOT_STALE") || reasons.has("INTENT_REVISION_CHANGED") || reasons.has("AGENT_REVISION_CHANGED") || reasons.has("POLICY_REVISION_CHANGED"));
    const action = hardBlock ? "BLOCK" : redactionPossible ? "REDACT" : hold ? "HOLD" : reasons.size ? "REVALIDATE" : "ALLOW";
    const result = {
      schema_version: SEMANTIC_SCOPE_DECISION_SCHEMA_VERSION, action, reason_codes: [...reasons].sort(),
      detected_scope: [...detected].sort(), expected_scope: { targets: expectedTargets, tools: expectedTools, data_scope: expectedData, write_scope: expectedWrite },
      scope_delta: { capability, requested_effect: requestedEffect, tool_id: toolId, tool_operation: toolOperation, target, arguments_digest: argumentsDigest, data_scope: dataScope, write_scope: writeScope },
      policy_refs: asSet(input.policy_refs, "semantic_scope_policy_refs_invalid"),
      redaction_plan: action === "REDACT" ? { schema_version: "semantic_scope_redaction_plan_v1", remove_classes: [String(input.data_classification)], deterministic: true } : null,
      evidence_refs: asSet(input.evidence_refs, "semantic_scope_evidence_refs_invalid"),
      binding: { tenant_id: tenantId, work_id: workId, agent_id: agentId, agent_revision: agentRevision,
        intent_digest: intentDigest, entity360_snapshot_ref: nullableText(input.entity360_snapshot_ref,
          "semantic_scope_snapshot_ref_invalid", 120), as_of_valid_time: asOfValidTime,
        as_of_knowledge_time: asOfKnowledgeTime, authority_reservation_ref: nullableText(
          input.authority_reservation_ref, "semantic_scope_reservation_ref_invalid", 240),
        policy_revision: nullableText(input.policy_revision, "semantic_scope_policy_revision_invalid", 160),
        risk_tier: riskTier },
      enforcement: configuredMode, execution_authorized: false, authority: "universal_core",
    };
    const decision = Object.freeze({ ...result, decision_digest: semanticScopeDecisionDigest(result) });
    counters.check_total += 1; counters.latency_ms_total += Math.max(0, performance.now() - started);
    counters[`${action.toLowerCase()}_total`] += 1;
    if (detected.size) counters.drift_detected_total += 1;
    return decision;
  }

  return Object.freeze({ mode: configuredMode, check, metrics() { return Object.freeze({
    bitemporal_query_latency: null, semantic_scope_check_latency: counters.check_total ? counters.latency_ms_total / counters.check_total : 0,
    semantic_scope_block_total: counters.block_total, semantic_scope_hold_total: counters.hold_total,
    semantic_scope_redact_total: counters.redact_total, scope_drift_detected_total: counters.drift_detected_total,
    false_hold_rate: null, false_block_rate: null, check_total: counters.check_total,
  }); } });
}
