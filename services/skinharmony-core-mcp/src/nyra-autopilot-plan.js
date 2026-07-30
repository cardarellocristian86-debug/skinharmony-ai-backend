import { digest } from "./work-continuity-runtime.js";

// This compiler is intentionally pure. It creates a bounded, explainable
// proposal for the Work: it never invokes a model, selects a provider, calls
// a tool, or authorizes an external action.
export const NYRA_AUTOPILOT_PLAN_SCHEMA_VERSION = "nyra_autopilot_plan_v1";
export const NYRA_AUTOPILOT_MAX_ACTIVE_ROLES = 3;
export const NYRA_AUTOPILOT_MAX_PARALLEL = 2;
export const NYRA_AUTOPILOT_BLUEPRINT_IDS = Object.freeze([
  "memory_curator", "researcher", "planner", "executor_specialist",
  "independent_verifier", "release_operations",
]);

const BLUEPRINT_SET = new Set(NYRA_AUTOPILOT_BLUEPRINT_IDS);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TENANT_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/i;
const PROJECT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/;
const INTENT_PATTERNS = Object.freeze({
  research: /\b(research\w*|ricerc\w*|eviden\w*|market analysis|analisi (?:di )?mercato|investiga\w*|confront\w*|benchmark)\b/i,
  implementation: /\b(implement\w*|svilupp\w*|codice|code|build|integra\w*|fix|bug|patch|refactor|migra\w*|test\w*|developer)\b/i,
  release: /\b(release|rilasc\w*|deploy|production|produzione|publish|pubblic\w*|merge|rollout|render)\b/i,
  risky: /\b(production|produzione|deploy|release|rilasc\w*|merge|publish|pubblic\w*|credential|credenzial\w*|secret|segreti|security|sicurezza|payment|pagament\w*|personali|pii|destructive|distruttiv\w*)\b/i,
});
const ROLE_DETAILS = Object.freeze({
  memory_curator: Object.freeze({ reason_code: "work_memory_continuity_required", reason: "Ogni Work richiede continuità di memoria, capsule e handoff strutturati." }),
  planner: Object.freeze({ reason_code: "work_plan_required", reason: "Ogni Work richiede una scomposizione verificabile prima di qualunque assegnazione." }),
  researcher: Object.freeze({ reason_code: "research_intent_detected", reason: "Il Work richiede ricerca o raccolta di evidenze con provenienza esplicita." }),
  executor_specialist: Object.freeze({ reason_code: "implementation_intent_detected", reason: "Il Work richiede preparazione di un artefatto tecnico delimitato." }),
  release_operations: Object.freeze({ reason_code: "release_intent_detected", reason: "Il Work richiede preparazione controllata di rilascio e rollback." }),
  independent_verifier: Object.freeze({ reason_code: "independent_verification_required", reason: "Il Work richiede una verifica indipendente prima del join del Core." }),
});

function normalizeId(value, name, pattern) {
  const id = String(value || "").trim();
  if (!pattern.test(id)) throw new Error(`${name}_invalid`);
  return id;
}
function asRecord(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function asText(value) { return typeof value === "string" ? value.replaceAll("\u0000", " ").trim().slice(0, 12_000) : ""; }
function textValues(input, work) {
  const fields = [input.intent, input.objective, input.idea, input.summary, input.request, input.description,
    work.intent, work.objective, work.idea, work.summary, work.request, work.description];
  const labels = [input.tags, input.labels, input.categories, work.tags, work.labels, work.categories];
  return [...fields.map(asText), ...labels.flatMap((value) => Array.isArray(value) ? value.map(asText) : [asText(value)])].filter(Boolean).join("\n");
}
function truthyIntent(input, work, name) {
  const camel = `needs${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  const snake = `needs_${name}`;
  const needs = [input.needs, work.needs, input.required_capabilities, work.required_capabilities];
  return [input[camel], input[snake], work[camel], work[snake], input[name], work[name]].some((value) => value === true)
    || needs.some((value) => asRecord(value)[name] === true);
}
function isHighRisk(input, work, text) {
  const level = String(input.risk_level || input.riskLevel || work.risk_level || work.riskLevel || "").trim().toLowerCase();
  return ["high", "critical", "restricted"].includes(level) || input.risky === true || work.risky === true || INTENT_PATTERNS.risky.test(text);
}
function activeWave(id, blueprintIds, reasonCode) {
  const unique = [...new Set(blueprintIds)];
  if (unique.length > NYRA_AUTOPILOT_MAX_ACTIVE_ROLES) throw new Error("nyra_autopilot_active_role_limit_exceeded");
  if (!unique.every((blueprintId) => BLUEPRINT_SET.has(blueprintId))) throw new Error("nyra_autopilot_blueprint_invalid");
  return Object.freeze({ wave_id: id, active_blueprint_ids: Object.freeze(unique), max_parallel: Math.min(NYRA_AUTOPILOT_MAX_PARALLEL, unique.length), reason_code: reasonCode });
}
function role(blueprintId) { return Object.freeze({ blueprint_id: blueprintId, ...ROLE_DETAILS[blueprintId] }); }

export function compileNyraAutopilotPlan(input = {}) {
  const source = asRecord(input);
  const work = asRecord(source.work);
  const scope = Object.freeze({
    tenant_id: normalizeId(source.tenant_id ?? source.tenantId ?? work.tenant_id ?? work.tenantId, "tenant", TENANT_PATTERN),
    project_id: normalizeId(source.project_id ?? source.projectId ?? work.project_id ?? work.projectId, "project", PROJECT_PATTERN),
    work_id: normalizeId(source.work_id ?? source.workId ?? work.work_id ?? work.workId, "work", UUID_PATTERN),
  });
  const text = textValues(source, work);
  const needsResearch = truthyIntent(source, work, "research") || INTENT_PATTERNS.research.test(text);
  const needsImplementation = truthyIntent(source, work, "implementation") || INTENT_PATTERNS.implementation.test(text);
  const needsRelease = truthyIntent(source, work, "release") || INTENT_PATTERNS.release.test(text);
  const risky = isHighRisk(source, work, text);
  const verificationRequired = risky || needsImplementation || needsRelease;
  const requiredIds = ["memory_curator", "planner"];
  if (needsResearch) requiredIds.push("researcher");
  if (needsImplementation) requiredIds.push("executor_specialist");
  if (needsRelease) requiredIds.push("release_operations");
  if (verificationRequired) requiredIds.push("independent_verifier");
  const waves = [activeWave("plan", ["memory_curator", "planner"], "work_plan_required")];
  if (needsResearch) waves.push(activeWave("research", ["memory_curator", "researcher"], "research_intent_detected"));
  if (needsImplementation) waves.push(activeWave("implementation", ["memory_curator", "executor_specialist"], "implementation_intent_detected"));
  if (needsRelease) waves.push(activeWave("release_preparation", ["memory_curator", "release_operations"], "release_intent_detected"));
  if (verificationRequired) waves.push(activeWave("independent_verification", ["memory_curator", "independent_verifier"], "independent_verification_required"));
  const plan = {
    schema_version: NYRA_AUTOPILOT_PLAN_SCHEMA_VERSION,
    scope,
    intent: { research: needsResearch, implementation: needsImplementation, release: needsRelease, risky, independent_verification_required: verificationRequired },
    required_roles: requiredIds.map(role),
    activation: {
      max_active_roles: NYRA_AUTOPILOT_MAX_ACTIVE_ROLES,
      max_parallel: NYRA_AUTOPILOT_MAX_PARALLEL,
      priority_blueprint_ids: ["memory_curator", "planner", ...(verificationRequired ? ["independent_verifier"] : []), ...(needsImplementation ? ["executor_specialist"] : []), ...(needsRelease ? ["release_operations"] : []), ...(needsResearch ? ["researcher"] : [])],
      waves,
    },
    execution: { execution_authorized: false, model_invocation_allowed: false, tool_invocation_allowed: false, external_action_allowed: false },
    core_join: { required: true, authority: "universal_core", required_before_external_action: true },
  };
  return Object.freeze({ ...plan, plan_digest: digest(plan) });
}
