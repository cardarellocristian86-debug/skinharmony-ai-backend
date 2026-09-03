import { digest } from "./work-continuity-runtime.js";
import { authenticatedHostKind } from "./host-app-registry.js";

const TENANT = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/;
const PROJECT = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/;
const REPOSITORY = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const BRANCH = /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
const CHECK = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/;
const RELEASE_BINDING_RESOLUTION_SCHEMA_VERSION = "nyra_project_release_binding_resolution_v1";

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

function releaseBindingResolution(binding, { tenantId, projectId, mode }) {
  const material = Object.freeze({
    schema_version: RELEASE_BINDING_RESOLUTION_SCHEMA_VERSION,
    mode,
    tenant_id: tenantId,
    requested_project_id: projectId,
    resolved_project_id: binding.project_id,
    binding_digest: digest(binding),
  });
  return Object.freeze({
    ...material,
    binding,
    resolution_digest: digest(material),
  });
}

export function resolveNyraProjectReleaseBindingResolution(bindings, { tenantId, projectId } = {}) {
  const requestedTenantId = typeof tenantId === "string" ? tenantId.trim() : "";
  const requestedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  if (!TENANT.test(requestedTenantId) || !PROJECT.test(requestedProjectId)) return null;

  // Never use a global singleton as a fallback: repository scope may only be
  // inherited from the authenticated tenant. An exact project binding remains
  // authoritative even when that tenant owns several release bindings.
  const tenantBindings = (Array.isArray(bindings) ? bindings : []).filter((binding) =>
    binding?.tenant_id === requestedTenantId,
  );
  const exact = tenantBindings.find((binding) => binding?.project_id === requestedProjectId);
  if (exact) {
    return releaseBindingResolution(exact, {
      tenantId: requestedTenantId,
      projectId: requestedProjectId,
      mode: "exact_project",
    });
  }
  if (tenantBindings.length !== 1) return null;
  return releaseBindingResolution(tenantBindings[0], {
    tenantId: requestedTenantId,
    projectId: requestedProjectId,
    mode: "tenant_singleton_fallback",
  });
}

export function resolveNyraProjectReleaseBinding(bindings, scope = {}) {
  return resolveNyraProjectReleaseBindingResolution(bindings, scope)?.binding || null;
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
  const precommit = !release;
  const builderInstruction = [
    `Execute only the bounded Work objective: ${objective}`,
    "Use the server-issued context and exact repository scope; do not rediscover unrelated project state.",
    precommit
      ? "For this precommit phase, report server-digested precommit evidence for the exact base, binary diff, and changed files; do not claim a commit SHA."
      : "For this release phase, report the exact reviewed commit SHA and reproducible release evidence.",
    "Do not merge, deploy, change permissions, or use provider credentials. Return reproducible change and test evidence.",
  ].join(" ");
  const verifierInstruction = [
    "Independently verify the builder evidence, required checks, changed scope, and rollback readiness.",
    "Run in a distinct native agent session; never reuse the builder identity or session.",
    precommit
      ? "For this precommit phase, submit matching precommit evidence, attest every server-issued constraint, and attest only objective or acceptance criteria already genuinely provable; leave future-only objective or acceptance criteria deferred without inventing evidence. For a V2-bound task, include the exact server-issued v2-task:<v2_task_digest> reference after reading its immutable task binding. Live verification is deferred to release."
      : "For this release phase, submit acceptance evidence for every server-issued criterion and live verification after the deployment readback.",
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
    launch_request: {
      schema_version: "nyra_host_launch_request_v1",
      requested_by: "nyra",
      action: "START_NATIVE_PLAN",
      verifier_task_id: "verify",
      distinct_session_required: true,
      host_execution_required: true,
    },
    closure_requirements: {
      independent_verifier_required: true,
      tests_required: true,
      evidence_required: true,
      // A precommit plan has no deployed artifact to verify. Requiring live
      // readback here makes the git.commit ticket depend on a later release.
      // Keep it mandatory only for a plan explicitly classified as release.
      live_verification_required: release,
    },
    idempotency_key: `nyra_native_${digest({ work_id, plan_digest: autopilot.plan_digest, binding, host_type }).slice(0, 48)}`,
  };
}
