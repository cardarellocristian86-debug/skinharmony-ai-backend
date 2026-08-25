import { digest } from "./work-continuity-runtime.js";
import { authenticatedHostKind } from "./host-app-registry.js";

const TENANT = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/;
const PROJECT = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/;
const REPOSITORY = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const BRANCH = /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
const CHECK = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/;

function text(value, maximum = 8_000) {
  return String(value || "").replaceAll("\u0000", " ").trim().slice(0, maximum);
}

function valid(value, expression, code) {
  const result = text(value);
  if (!expression.test(result)) throw new Error(code);
  return result;
}

// The mapping is server-owned configuration, never supplied by a chat.  It
// gives Nyra enough exact release scope to create the Core-native plan without
// asking a new conversation to rediscover the repository and required checks.
export function parseNyraProjectReleaseBindings(value) {
  if (!value) return [];
  let source;
  try { source = JSON.parse(value); } catch { throw new Error("NYRA_PROJECT_RELEASE_BINDINGS_JSON must be valid JSON"); }
  if (!source || typeof source !== "object" || Array.isArray(source) || source.schema_version !== "nyra_project_release_bindings_v1" || !Array.isArray(source.bindings)) {
    throw new Error("NYRA_PROJECT_RELEASE_BINDINGS_JSON must contain nyra_project_release_bindings_v1 bindings");
  }
  const seen = new Set();
  return source.bindings.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("NYRA_PROJECT_RELEASE_BINDINGS_JSON binding invalid");
    const tenant_id = valid(item.tenant_id, TENANT, "NYRA_PROJECT_RELEASE_BINDINGS_JSON tenant invalid");
    const project_id = valid(item.project_id, PROJECT, "NYRA_PROJECT_RELEASE_BINDINGS_JSON project invalid");
    const repository = valid(item.repository, REPOSITORY, "NYRA_PROJECT_RELEASE_BINDINGS_JSON repository invalid");
    const base_branch = valid(item.base_branch, BRANCH, "NYRA_PROJECT_RELEASE_BINDINGS_JSON branch invalid");
    const required_checks = Array.isArray(item.required_checks)
      ? [...new Set(item.required_checks.map((check) => valid(check, CHECK, "NYRA_PROJECT_RELEASE_BINDINGS_JSON check invalid")))].sort()
      : [];
    if (!required_checks.length) throw new Error("NYRA_PROJECT_RELEASE_BINDINGS_JSON checks required");
    const key = `${tenant_id}\u0000${project_id}`;
    if (seen.has(key)) throw new Error("NYRA_PROJECT_RELEASE_BINDINGS_JSON duplicate binding");
    seen.add(key);
    return Object.freeze({ tenant_id, project_id, repository, base_branch, required_checks: Object.freeze(required_checks) });
  });
}

export function resolveNyraProjectReleaseBinding(bindings, { tenantId, projectId } = {}) {
  return (Array.isArray(bindings) ? bindings : []).find((binding) =>
    binding.tenant_id === tenantId && binding.project_id === projectId,
  ) || null;
}

export function buildNyraNativePlanRequest({ identity, work, intent, autopilot, binding } = {}) {
  if (!binding) throw new Error("nyra_project_release_binding_required");
  const work_id = valid(work?.work_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "nyra_native_work_id_invalid");
  const plan = autopilot?.plan;
  if (!plan || typeof plan !== "object" || !/^[a-f0-9]{64}$/.test(String(autopilot?.plan_digest || ""))) {
    throw new Error("nyra_autopilot_plan_invalid");
  }
  const objective = text(intent?.anchor?.objective || work?.objective || "Complete the bounded Work safely.", 4_000);
  // Public MCP calls carry a registry-authenticated host principal. Never
  // relabel an unfamiliar future host as Codex merely because it is not
  // ChatGPT. The fallback remains only for direct legacy/internal callers.
  const host_type = identity?.authenticatedHostPrincipal
    ? authenticatedHostKind(identity)
    : identity?.kind === "codex" || identity?.agentPresence?.client_type === "codex"
      ? "codex_native"
      : "chatgpt_native";
  const release = plan.intent?.release === true;
  const implementation = plan.intent?.implementation === true;
  const builderInstruction = [
    `Execute only the bounded Work objective: ${objective}`,
    "Use the server-issued context and exact repository scope; do not rediscover unrelated project state.",
    "Do not merge, deploy, change permissions, or use provider credentials. Return reproducible change and test evidence.",
  ].join(" ");
  const verifierInstruction = [
    "Independently verify the builder evidence, required checks, changed scope, and rollback readiness.",
    "Do not edit, merge, deploy, or authorize external actions. Report evidence and any blocking discrepancy.",
  ].join(" ");
  return {
    work_id,
    repository: binding.repository,
    base_branch: binding.base_branch,
    host_type,
    required_checks: [...binding.required_checks],
    tasks: [
      { task_id: "build", kind: "builder", instruction: builderInstruction },
      { task_id: "verify", kind: "verifier", instruction: verifierInstruction, dependencies: ["build"] },
    ],
    max_parallel: 1,
    closure_requirements: {
      independent_verifier_required: true,
      tests_required: true,
      evidence_required: true,
      live_verification_required: release || implementation,
    },
    idempotency_key: `nyra_native_${digest({ work_id, plan_digest: autopilot.plan_digest, binding, host_type }).slice(0, 48)}`,
  };
}
