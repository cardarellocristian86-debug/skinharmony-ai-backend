import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const HOST_NATIVE_HEALTH_CONTRACT_VERSION = "host_native_health_contract_v1";
export const HOST_RELEASE_MANIFEST_VERSION = "host_release_manifest_v2";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalObject(value) {
  if (Array.isArray(value)) return value.map(canonicalObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) =>
    value[key] === undefined ? [] : [[key, canonicalObject(value[key])]],
  ));
}

export const HOST_NATIVE_HEALTH_CONTRACT_DIGEST = crypto
  .createHash("sha256")
  .update(canonical({
    schema_version: HOST_NATIVE_HEALTH_CONTRACT_VERSION,
    transport: "https",
    path: "/healthz",
    content_type: "application/json",
    required: {
      ok: true,
      version: "non_empty",
      build_commit_sha: "exact_release_commit",
      build_commit_verifiable: true,
      render_ready: true,
    },
  }))
  .digest("hex");

export const HOST_NATIVE_ABSOLUTE_DENY_ACTIONS = Object.freeze([
  "secrets.read",
  "secrets.export",
  "credential.exfiltrate",
  "git.force_push",
  "git.delete_ref",
  "git.tag",
  "host.policy.override",
  "provider.api.call",
  "provider.agent.spawn",
]);

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const OWNER_FINGERPRINT = /^osf_[a-f0-9]{64}$/;
const RENDER_ORIGIN = /^https:\/\/[a-z0-9][a-z0-9-]*\.onrender\.com$/;
const MAX_DELEGATION_MS = 12 * 60 * 60 * 1_000;
const DEFAULT_TICKET_TTL_MS = 10 * 60_000;
const DEFAULT_RESERVATION_LEASE_MS = 5 * 60_000;
const DEFAULT_CORE_JOIN_TTL_MS = 30 * 60_000;
const MAX_FINALIZE_AUTHORIZATION_HISTORY = 16;

function fail(code) {
  throw new Error(code);
}

function clone(value) {
  return structuredClone(value);
}

function text(value, code, max = 2_000) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) fail(code);
  return normalized;
}

function digest(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA256.test(normalized)) fail("digest_invalid");
  return normalized;
}

function commit(value, code = "commit_invalid") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!GIT_SHA.test(normalized)) fail(code);
  return normalized;
}

function positiveInteger(value, code, maximum = Number.MAX_SAFE_INTEGER) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) fail(code);
  return result;
}

function exactKeys(value, allowed, code = "unknown_field") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("object_invalid");
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${code}:${key}`);
  }
}

function stableStrings(values, code = "values_invalid", maximum = 500) {
  if (!Array.isArray(values) || values.length < 1 || values.length > maximum) fail(code);
  const normalized = values.map((value) => text(value, code, 2_000));
  const unique = [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
  if (unique.length !== normalized.length) fail(code);
  return unique;
}

function sameStrings(left, right) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function hostNativeDigest(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

export function hostNativeGithubDiffDigest({
  repository,
  base_commit,
  head_commit,
  tree_sha,
  changed_files,
} = {}) {
  return hostNativeDigest({
    schema_version: "host_native_github_diff_v1",
    repository: text(repository, "repository_invalid"),
    base_commit: commit(base_commit),
    head_commit: commit(head_commit),
    tree_sha: commit(tree_sha, "tree_sha_invalid"),
    changed_files: stableStrings(changed_files, "changed_files_invalid"),
  });
}

function hmac(prefix, secret, value) {
  return `${prefix}_${crypto.createHmac("sha256", secret)
    .update(value)
    .digest("hex")}`;
}

// Causal Continuity deliberately shares the already-provisioned host-native
// governance signing domain.  The caller supplies a purpose label so one
// signature cannot be replayed as another Core artifact.
export function createHostNativeDomainSigner({ signingSecret } = {}) {
  const signing = text(signingSecret, "host_native_signing_secret_missing", 8_000);
  if (Buffer.byteLength(signing, "utf8") < 32) fail("host_native_signing_secret_missing");
  return Object.freeze({
    sign(value, { purpose } = {}) {
      return hmac("hnc", signing, canonical({ purpose: text(purpose, "signing_purpose_missing", 160), value }));
    },
    verify(value, signature, { purpose } = {}) {
      const expected = hmac("hnc", signing, canonical({ purpose: text(purpose, "signing_purpose_missing", 160), value }));
      return safeEqual(String(signature || ""), expected);
    },
  });
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function nowMillis(now) {
  const value = Number(typeof now === "function" ? now() : Date.now());
  if (!Number.isFinite(value)) fail("clock_invalid");
  return value;
}

function iso(value) {
  return new Date(value).toISOString();
}

function validRenderOrigin(origin) {
  const normalized = String(origin || "").trim().toLowerCase();
  if (!RENDER_ORIGIN.test(normalized)) fail("render_service_origin_invalid");
  let parsed;
  try { parsed = new URL(normalized); }
  catch { fail("render_service_origin_invalid"); }
  if (
    parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password ||
    parsed.pathname !== "/" || parsed.search || parsed.hash ||
    parsed.hostname !== normalized.slice("https://".length) ||
    parsed.hostname.split(".").length !== 3
  ) {
    fail("render_service_origin_invalid");
  }
  return normalized;
}

function branchAllowed(branch, patterns) {
  const value = String(branch || "").trim();
  if (!value || value.includes("..") || value.startsWith("/")) return false;
  return patterns.some((pattern) => (
    pattern.endsWith("*")
      ? value.startsWith(pattern.slice(0, -1))
      : value === pattern
  ));
}

function actionBranch(action) {
  return action.kind === "github.draft_pr" || action.kind === "github.ready" || action.kind === "github.merge"
    ? action.head_branch
    : action.branch;
}

function isReleaseAction(kind) {
  return [
    "git.push.protected",
    "github.merge",
    "render.deploy",
    "render.rollback",
    "render.observe",
  ].includes(kind);
}

function ticketReleaseBinding(manifest) {
  // The signed manifest keeps services under delivery.  The runtime binding
  // also exposes the exact resolved set at the top level so the independent
  // readback verifier cannot accidentally select another service list.
  return { ...manifest, services: manifest.delivery.services };
}

function actionUsage(kind, action) {
  const commits = kind === "git.commit" ? 1 : 0;
  const pushes = ["git.push.branch", "git.push.protected", "github.merge"].includes(kind) ? 1 : 0;
  const directDeploy = ["render.deploy", "render.rollback"].includes(kind) ? 1 : 0;
  const inducedDeploys = Array.isArray(action?.induced_effects) ? action.induced_effects.length : 0;
  return { commits, pushes, deploys: directDeploy + inducedDeploys, total_actions: 1 };
}

function emptyState() {
  return {
    schema_version: "host_native_governance_store_v1",
    delegations: {},
    tickets: {},
    core_join_verdicts: {},
    owner_nonces: {},
    idempotency: {},
  };
}

function normalizeState(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return emptyState();
  return {
    schema_version: "host_native_governance_store_v1",
    delegations: input.delegations && typeof input.delegations === "object" ? input.delegations : {},
    tickets: input.tickets && typeof input.tickets === "object" ? input.tickets : {},
    core_join_verdicts: input.core_join_verdicts && typeof input.core_join_verdicts === "object" ? input.core_join_verdicts : {},
    owner_nonces: input.owner_nonces && typeof input.owner_nonces === "object" ? input.owner_nonces : {},
    idempotency: input.idempotency && typeof input.idempotency === "object" ? input.idempotency : {},
  };
}

export function createInMemoryHostNativeGovernanceStore() {
  let state = emptyState();
  return Object.freeze({
    kind: "memory",
    restart_durable: false,
    distributed: false,
    readState() { return clone(state); },
    mutate(operation) {
      const result = operation(state);
      return clone(result);
    },
  });
}

export function createFileHostNativeGovernanceStore({ root } = {}) {
  const directory = path.resolve(text(root, "host_native_governance_root_invalid", 4_000));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "host-native-governance.json");
  const lock = `${file}.lock`;
  function read() {
    try {
      return normalizeState(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (cause) {
      if (cause?.code === "ENOENT") return emptyState();
      fail("store_unavailable");
    }
  }
  function mutate(operation) {
    let descriptor;
    try { descriptor = fs.openSync(lock, "wx", 0o600); }
    catch { fail("store_lock_timeout"); }
    try {
      const state = read();
      const result = operation(state);
      const temporary = `${file}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, file);
      return clone(result);
    } catch (cause) {
      if (String(cause?.message || "").startsWith("store_")) throw cause;
      throw cause;
    } finally {
      try { fs.closeSync(descriptor); } catch {}
      try { fs.unlinkSync(lock); } catch {}
    }
  }
  return Object.freeze({
    kind: "file_atomic",
    restart_durable: true,
    distributed: false,
    readState() { return clone(read()); },
    mutate,
  });
}

function requireStore(store) {
  if (!store || typeof store.readState !== "function" || typeof store.mutate !== "function") {
    fail("host_native_governance_store_required");
  }
  return store;
}

function idempotencyKey(tenantId, method, key) {
  const normalized = String(key || "").trim();
  return normalized ? `${tenantId}\u0000${method}\u0000${normalized}` : null;
}

function getIdempotent(state, tenantId, method, input) {
  const key = idempotencyKey(tenantId, method, input?.idempotency_key);
  if (!key) return null;
  const existing = state.idempotency[key];
  const requestDigest = hostNativeDigest({
    ...input,
    idempotency_key: String(input.idempotency_key),
  });
  if (!existing) return { key, requestDigest, result: null };
  if (existing.request_digest !== requestDigest) fail("idempotency_key_conflict");
  return { key, requestDigest, result: clone(existing.result) };
}

function saveIdempotent(state, descriptor, result) {
  if (descriptor?.key) {
    state.idempotency[descriptor.key] = {
      request_digest: descriptor.requestDigest,
      result: clone(result),
    };
  }
  return result;
}

function checkOwnerConfirmation(confirmation) {
  exactKeys(confirmation, new Set([
    "verified", "request_bound", "owner_subject_fingerprint", "consent_nonce", "confirmation_reference",
  ]));
  if (confirmation.verified !== true || confirmation.request_bound !== true) {
    fail("owner_confirmation_invalid");
  }
  const owner_subject_fingerprint = text(confirmation.owner_subject_fingerprint, "owner_confirmation_invalid", 100);
  if (!OWNER_FINGERPRINT.test(owner_subject_fingerprint)) fail("owner_confirmation_invalid");
  return {
    verified: true,
    request_bound: true,
    owner_subject_fingerprint,
    consent_nonce: text(confirmation.consent_nonce, "owner_confirmation_invalid", 300),
    confirmation_reference: text(confirmation.confirmation_reference, "owner_confirmation_invalid", 1_000),
  };
}

function ownerNonceKey(tenantId, confirmation) {
  return `${tenantId}\u0000${confirmation.owner_subject_fingerprint}\u0000${confirmation.consent_nonce}`;
}

function validatePlanAgents(agents) {
  if (!Array.isArray(agents) || agents.length < 1 || agents.length > 3) fail("agents_invalid");
  const byId = new Map();
  for (const agent of agents) {
    if (!agent || typeof agent !== "object") fail("agents_invalid");
    const agent_id = text(agent.agent_id, "agents_invalid", 160);
    if (byId.has(agent_id)) fail("agents_invalid");
    byId.set(agent_id, {
      agent_id,
      role: text(agent.role, "agents_invalid", 160),
      task: text(agent.task, "agents_invalid", 4_000),
      depends_on: Array.isArray(agent.depends_on) ? agent.depends_on.map((entry) => text(entry, "agents_invalid", 160)) : [],
      capabilities: Array.isArray(agent.capabilities) ? agent.capabilities.map((entry) => text(entry, "agents_invalid", 160)) : [],
    });
  }
  for (const agent of byId.values()) {
    if (agent.depends_on.some((dependency) => !byId.has(dependency) || dependency === agent.agent_id)) {
      fail("dependency_invalid");
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) fail("dependency_cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).depends_on) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  return [...byId.values()];
}

export function buildHostNativeWorkPlan(input = {}) {
  exactKeys(input, new Set([
    "tenant_id", "work_id", "intent_anchor_digest", "repository", "objective", "required_checks", "max_parallel", "agents", "base_branch",
  ]));
  const agents = validatePlanAgents(input.agents);
  const max_parallel = input.max_parallel === undefined ? Math.min(2, agents.length) : positiveInteger(input.max_parallel, "max_parallel_invalid", 2);
  if (max_parallel > 2) fail("max_parallel_invalid");
  const unsigned = {
    schema_version: "host_native_work_plan_v1",
    tenant_id: text(input.tenant_id, "tenant_id_invalid", 160),
    work_id: text(input.work_id, "work_id_invalid", 240),
    intent_anchor_digest: digest(input.intent_anchor_digest),
    repository: text(input.repository, "repository_invalid", 300),
    base_branch: input.base_branch === undefined ? null : text(input.base_branch, "base_branch_invalid", 240),
    objective: text(input.objective, "objective_invalid", 8_000),
    required_checks: stableStrings(input.required_checks, "required_checks_invalid", 50),
    max_parallel,
    agents,
    execution_adapter: "host_native",
    provider_execution: false,
    provider_api_key_required: false,
    server_model_calls: 0,
    host_materialization_required: true,
    materialization_status: "planned_not_spawned",
    host_policy_override: false,
    host_policy_must_allow: true,
  };
  return buildPolicyBoundWorkPlan(unsigned, null);
}

function policyText(value) {
  return text(value, "required_checks_policy_invalid", 2_000);
}

function policySha256(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA256.test(normalized)) fail("required_checks_policy_invalid");
  return normalized;
}

function normalizedRequiredChecksPolicy(policy, plan) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    fail("required_checks_policy_unavailable");
  }
  exactKeys(policy, new Set([
    "schema_version", "tenant_id", "repository", "base_branch", "required_checks", "check_app", "workflow", "allowed_events",
  ]));
  if (
    policy.schema_version !== "host_native_required_checks_policy_v1" ||
    policyText(policy.tenant_id) !== plan.tenant_id ||
    policyText(policy.repository) !== plan.repository ||
    policyText(policy.base_branch) !== plan.base_branch
  ) {
    fail("required_checks_policy_mismatch");
  }
  const required_checks = stableStrings(
    policy.required_checks,
    "required_checks_policy_invalid",
    50,
  );
  if (!sameStrings(required_checks, plan.required_checks)) {
    fail("required_checks_policy_mismatch");
  }
  const checkApp = policy.check_app;
  exactKeys(checkApp, new Set(["id", "slug", "owner"]), "required_checks_policy_invalid");
  const checkAppId = Number(checkApp?.id);
  if (!Number.isSafeInteger(checkAppId) || checkAppId <= 0) {
    fail("required_checks_policy_invalid");
  }
  const workflow = policy.workflow;
  exactKeys(workflow, new Set(["id", "name", "path", "sha256", "candidate_sha256"]), "required_checks_policy_invalid");
  const workflowId = Number(workflow?.id);
  const workflowPath = policyText(workflow?.path);
  if (
    !Number.isSafeInteger(workflowId) || workflowId <= 0 ||
    !/^\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/.test(workflowPath)
  ) {
    fail("required_checks_policy_invalid");
  }
  const workflowSha256 = policySha256(workflow?.sha256);
  const candidateSha256 = workflow?.candidate_sha256 == null
    ? null
    : policySha256(workflow.candidate_sha256);
  if (candidateSha256 === workflowSha256) fail("required_checks_policy_invalid");
  const allowed_events = stableStrings(
    policy.allowed_events,
    "required_checks_policy_invalid",
    4,
  );
  if (allowed_events.some((event) => !["push", "pull_request"].includes(event))) {
    fail("required_checks_policy_invalid");
  }
  return {
    schema_version: "host_native_required_checks_policy_v1",
    tenant_id: plan.tenant_id,
    repository: plan.repository,
    base_branch: plan.base_branch,
    required_checks,
    check_app: {
      id: checkAppId,
      slug: policyText(checkApp?.slug),
      owner: policyText(checkApp?.owner),
    },
    workflow: {
      id: workflowId,
      name: policyText(workflow?.name),
      path: workflowPath,
      sha256: workflowSha256,
      candidate_sha256: candidateSha256,
    },
    allowed_events,
  };
}

function buildPolicyBoundWorkPlan(plan, requiredChecksPolicyDigest) {
  const builders = plan.agents.filter((agent) => agent.role === "builder");
  const verifier_agent_ids = plan.agents
    .filter((agent) => agent.role === "verifier")
    .map((agent) => agent.agent_id)
    .sort();
  if (builders.length !== 1 || verifier_agent_ids.length < 1) {
    fail("independent_verifier_required");
  }
  const payload = {
    tenant_id: plan.tenant_id,
    work_id: plan.work_id,
    intent_anchor_digest: plan.intent_anchor_digest,
    repository: plan.repository,
    ...(plan.base_branch ? { base_branch: plan.base_branch } : {}),
    objective: plan.objective,
    required_checks: plan.required_checks,
    ...(requiredChecksPolicyDigest
      ? { required_checks_policy_digest: requiredChecksPolicyDigest }
      : {}),
    builder_agent_id: builders[0].agent_id,
    verifier_agent_ids,
    agents: plan.agents,
    maximum_parallel_agents: plan.max_parallel,
  };
  const plan_digest = hostNativeDigest(payload);
  return Object.freeze({
    schema_version: plan.schema_version,
    plan_id: `hnp_${plan_digest.slice(0, 40)}`,
    plan_digest,
    ...payload,
    // Preserve the legacy response field for host clients while keeping the
    // V2 canonical digest bound to its unambiguous field name above.
    max_parallel: plan.max_parallel,
    execution_adapter: plan.execution_adapter,
    provider_execution: false,
    provider_api_key_required: false,
    server_model_calls: 0,
    host_materialization_required: true,
    materialization_status: "planned_not_spawned",
    host_policy_override: false,
    host_policy_must_allow: true,
    child_can_issue_action_ticket: false,
    join_authority: "universal_core",
    release_mode: "external_ticket_required",
  });
}

function normalizeService(service) {
  exactKeys(service, new Set([
    "service_id", "environment", "expected_previous_commit", "target_commit", "target_resolution", "health_contract_digest", "origin",
  ]));
  const targetRaw = service.target_commit;
  const target_commit = targetRaw === null || targetRaw === undefined || targetRaw === ""
    ? null
    : commit(targetRaw);
  const target_resolution = service.target_resolution === undefined || service.target_resolution === null
    ? null
    : text(service.target_resolution, "service_target_resolution_invalid", 100);
  return {
    service_id: text(service.service_id, "service_id_invalid", 160),
    environment: text(service.environment, "environment_invalid", 120),
    expected_previous_commit: commit(service.expected_previous_commit),
    target_commit,
    ...(target_resolution ? { target_resolution } : {}),
    health_contract_digest: digest(service.health_contract_digest),
    ...(service.origin === undefined ? {} : { origin: validRenderOrigin(service.origin) }),
  };
}

function normalizeManifest(input, { allowDigest = false } = {}) {
  const allowed = new Set([
    "schema_version", "manifest_id", "tenant_id", "work_id", "intent_anchor_digest", "repository",
    "base_branch", "delivery_branch", "base_commit", "head_commit", "tree_sha", "diff_digest", "changed_files",
    "verification", "delivery", "rollback", ...(allowDigest ? ["manifest_digest"] : []),
  ]);
  exactKeys(input, allowed);
  if (input.schema_version !== HOST_RELEASE_MANIFEST_VERSION) fail("manifest_schema_invalid");
  const verificationInput = input.verification;
  exactKeys(verificationInput, new Set([
    "builder_agent_id", "verifier_agent_ids", "required_checks", "checks_commit", "checks_digest", "evidence_digest", "core_join_verdict_id",
  ]));
  const builder_agent_id = text(verificationInput.builder_agent_id, "builder_agent_invalid", 240);
  const verifier_agent_ids = stableStrings(verificationInput.verifier_agent_ids, "verifier_agents_invalid", 20);
  if (verifier_agent_ids.includes(builder_agent_id)) fail("self_verification_denied");
  const deliveryInput = input.delivery;
  exactKeys(deliveryInput, new Set(["method", "services"]));
  if (!Array.isArray(deliveryInput.services) || deliveryInput.services.length < 1 || deliveryInput.services.length > 20) {
    fail("delivery_services_invalid");
  }
  const services = deliveryInput.services.map(normalizeService);
  const serviceKeys = new Set();
  for (const service of services) {
    const key = `${service.service_id}\u0000${service.environment}`;
    if (serviceKeys.has(key)) fail("delivery_services_invalid");
    serviceKeys.add(key);
    if (service.health_contract_digest !== HOST_NATIVE_HEALTH_CONTRACT_DIGEST) {
      fail("health_contract_unsupported");
    }
  }
  const rollbackInput = input.rollback;
  exactKeys(rollbackInput, new Set(["mode", "target_commit", "health_contract_digest", "ready"]));
  const result = {
    schema_version: HOST_RELEASE_MANIFEST_VERSION,
    manifest_id: text(input.manifest_id, "manifest_id_invalid", 240),
    tenant_id: text(input.tenant_id, "tenant_id_invalid", 160),
    work_id: text(input.work_id, "work_id_invalid", 240),
    intent_anchor_digest: digest(input.intent_anchor_digest),
    repository: text(input.repository, "repository_invalid", 300),
    base_branch: text(input.base_branch, "base_branch_invalid", 240),
    delivery_branch: text(input.delivery_branch, "delivery_branch_invalid", 240),
    base_commit: commit(input.base_commit),
    head_commit: commit(input.head_commit),
    tree_sha: commit(input.tree_sha, "tree_sha_invalid"),
    diff_digest: digest(input.diff_digest),
    changed_files: stableStrings(input.changed_files, "changed_files_invalid", 5_000),
    verification: {
      builder_agent_id,
      verifier_agent_ids,
      required_checks: stableStrings(verificationInput.required_checks, "required_checks_invalid", 100),
      checks_commit: commit(verificationInput.checks_commit),
      checks_digest: digest(verificationInput.checks_digest),
      evidence_digest: digest(verificationInput.evidence_digest),
      core_join_verdict_id: text(verificationInput.core_join_verdict_id, "core_join_verdict_invalid", 240),
    },
    delivery: {
      method: text(deliveryInput.method, "delivery_method_invalid", 160),
      services,
    },
    rollback: {
      mode: text(rollbackInput.mode, "rollback_mode_invalid", 160),
      target_commit: commit(rollbackInput.target_commit),
      health_contract_digest: digest(rollbackInput.health_contract_digest),
      ready: rollbackInput.ready === true,
    },
  };
  if (result.verification.checks_commit !== result.head_commit) fail("checks_commit_mismatch");
  if (result.rollback.target_commit !== result.base_commit) fail("rollback_previous_commit_mismatch");
  if (result.rollback.health_contract_digest !== HOST_NATIVE_HEALTH_CONTRACT_DIGEST) {
    fail("rollback_health_contract_unsupported");
  }
  if (result.rollback.ready !== true) fail("rollback_not_ready");
  const expectedDiff = hostNativeGithubDiffDigest({
    repository: result.repository,
    base_commit: result.base_commit,
    head_commit: result.head_commit,
    tree_sha: result.tree_sha,
    changed_files: result.changed_files,
  });
  if (result.diff_digest !== expectedDiff) fail("diff_digest_mismatch");
  if (allowDigest) result.manifest_digest = digest(input.manifest_digest);
  return result;
}

export function buildHostReleaseManifestV2(input = {}) {
  const unsigned = normalizeManifest(input);
  return Object.freeze({ ...unsigned, manifest_digest: hostNativeDigest(unsigned) });
}

export function validateHostReleaseManifestV2(manifest, context = null) {
  const normalized = normalizeManifest(manifest, { allowDigest: true });
  const { manifest_digest, ...unsigned } = normalized;
  if (manifest_digest !== hostNativeDigest(unsigned)) fail("digest_mismatch");
  if (context) {
    for (const field of ["tenant_id", "work_id", "intent_anchor_digest", "repository"]) {
      if (context[field] !== undefined && normalized[field] !== context[field]) {
        fail(`manifest_${field}_mismatch`);
      }
    }
  }
  return Object.freeze(normalized);
}

function releaseIntentUnsigned(manifest) {
  return {
    schema_version: "host_release_intent_v1",
    tenant_id: manifest.tenant_id,
    work_id: manifest.work_id,
    intent_anchor_digest: manifest.intent_anchor_digest,
    repository: manifest.repository,
    base_branch: manifest.base_branch,
    delivery_branch: manifest.delivery_branch,
    base_commit: manifest.base_commit,
    head_commit: manifest.head_commit,
    tree_sha: manifest.tree_sha,
    diff_digest: manifest.diff_digest,
    changed_files: manifest.changed_files,
    delivery: manifest.delivery,
    rollback: manifest.rollback,
    verification: {
      builder_agent_id: manifest.verification.builder_agent_id,
      verifier_agent_ids: manifest.verification.verifier_agent_ids,
      required_checks: manifest.verification.required_checks,
      checks_commit: manifest.verification.checks_commit,
      checks_digest: manifest.verification.checks_digest,
      evidence_digest: manifest.verification.evidence_digest,
    },
  };
}

function normalizeReleaseIntentRequest(input = {}) {
  exactKeys(input, new Set([
    "tenant_id", "work_id", "intent_anchor_digest", "repository", "base_branch", "delivery_branch",
    "base_commit", "head_commit", "tree_sha", "diff_digest", "changed_files", "verification", "delivery", "rollback",
  ]));
  const verification = input.verification;
  exactKeys(verification, new Set([
    "builder_agent_id", "verifier_agent_ids", "required_checks", "checks_commit", "checks_digest", "evidence_digest",
  ]));
  // A release intent is deliberately created before a Core-join verdict
  // exists.  Validate it through the same full-manifest rules while keeping
  // the synthetic identifiers entirely internal and out of its digest.
  const proposedDiffDigest = digest(input.diff_digest);
  const validationDiffDigest = hostNativeGithubDiffDigest({
    repository: input.repository,
    base_commit: input.base_commit,
    head_commit: input.head_commit,
    tree_sha: input.tree_sha,
    changed_files: input.changed_files,
  });
  const normalized = normalizeManifest({
    schema_version: HOST_RELEASE_MANIFEST_VERSION,
    manifest_id: "host-release-intent-pending-core-join",
    ...input,
    // A manifestless intent is a proposed release binding, not proof of a
    // remotely-read Git diff.  Validate every structural manifest invariant
    // with the deterministic local binding; the supplied evidence digest is
    // preserved for the later independently-attested Core join.
    diff_digest: validationDiffDigest,
    verification: {
      ...verification,
      core_join_verdict_id: "pending-core-join",
    },
  });
  return releaseIntentUnsigned({ ...normalized, diff_digest: proposedDiffDigest });
}

export function buildHostReleaseIntentV1(input = {}) {
  const fullManifest = Boolean(
    input && typeof input === "object" && (
      input.schema_version !== undefined ||
      input.manifest_id !== undefined ||
      input.manifest_digest !== undefined
    ),
  );
  const unsigned = fullManifest
    ? releaseIntentUnsigned(
      input.manifest_digest
        ? validateHostReleaseManifestV2(input)
        : buildHostReleaseManifestV2(input),
    )
    : normalizeReleaseIntentRequest(input);
  return Object.freeze({ ...unsigned, release_intent_digest: hostNativeDigest(unsigned) });
}

export function deriveHostReleaseIntentV1(manifest) {
  return buildHostReleaseIntentV1(manifest);
}

function normalizeDelegation(input, now) {
  exactKeys(input, new Set([
    "tenant_id", "work_id", "intent_anchor_digest", "repository", "owner_confirmation", "audience",
    "allowed_branches", "protected_branches", "allowed_path_prefixes", "allowed_actions", "budget", "release_policy", "expires_at", "idempotency_key",
  ]));
  const expires = Date.parse(input.expires_at);
  if (!Number.isFinite(expires) || expires <= now || expires > now + MAX_DELEGATION_MS) {
    fail("delegation_expiry_invalid");
  }
  const allowed_actions = stableStrings(input.allowed_actions, "allowed_actions_invalid", 50);
  if (allowed_actions.some((action) => HOST_NATIVE_ABSOLUTE_DENY_ACTIONS.includes(action))) {
    fail("absolute_deny_action");
  }
  const budgetInput = input.budget;
  exactKeys(budgetInput, new Set([
    "max_agents", "max_parallel", "max_commits", "max_pushes", "max_deploys", "max_total_actions",
  ]));
  const budget = {
    max_agents: positiveInteger(budgetInput.max_agents, "delegation_budget_invalid", 3),
    max_parallel: positiveInteger(budgetInput.max_parallel, "delegation_budget_invalid", 2),
    max_commits: positiveInteger(budgetInput.max_commits, "delegation_budget_invalid", 100),
    max_pushes: positiveInteger(budgetInput.max_pushes, "delegation_budget_invalid", 100),
    max_deploys: positiveInteger(budgetInput.max_deploys, "delegation_budget_invalid", 100),
    max_total_actions: positiveInteger(budgetInput.max_total_actions, "delegation_budget_invalid", 1_000),
  };
  const releasePolicy = input.release_policy;
  exactKeys(releasePolicy, new Set([
    "manifest_required_for_protected_push", "manifest_required_for_induced_deploy", "manifest_required_for_deploy", "independent_verifier_required", "rollback_required", "required_checks",
  ]));
  return {
    tenant_id: text(input.tenant_id, "tenant_id_invalid", 160),
    work_id: text(input.work_id, "work_id_invalid", 240),
    intent_anchor_digest: digest(input.intent_anchor_digest),
    repository: text(input.repository, "repository_invalid", 300),
    owner_confirmation: checkOwnerConfirmation(input.owner_confirmation),
    audience: stableStrings(input.audience, "audience_invalid", 10),
    allowed_branches: stableStrings(input.allowed_branches, "allowed_branches_invalid", 30),
    protected_branches: stableStrings(input.protected_branches, "protected_branches_invalid", 30),
    allowed_path_prefixes: stableStrings(input.allowed_path_prefixes, "allowed_paths_invalid", 100),
    allowed_actions,
    budget,
    release_policy: {
      manifest_required_for_protected_push: releasePolicy.manifest_required_for_protected_push === true,
      manifest_required_for_induced_deploy: releasePolicy.manifest_required_for_induced_deploy === true,
      manifest_required_for_deploy: releasePolicy.manifest_required_for_deploy === true,
      independent_verifier_required: releasePolicy.independent_verifier_required === true,
      rollback_required: releasePolicy.rollback_required === true,
      required_checks: stableStrings(releasePolicy.required_checks, "required_checks_invalid", 100),
    },
    expires_at: iso(expires),
  };
}

function delegationUnsigned(grant, delegationId, issuedAt) {
  return {
    schema_version: "host_native_delegation_v1",
    tenant_id: grant.tenant_id,
    delegation_id: delegationId,
    issued_at: issuedAt,
    state: "active",
    grant,
    usage: { commits: 0, pushes: 0, deploys: 0, total_actions: 0 },
  };
}

function delegationActive(record, now) {
  return record?.state === "active" && Date.parse(record.grant.expires_at) > now;
}

function validateActionShape(action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) fail("action_invalid");
  const kind = text(action.kind, "action_invalid", 160);
  if (action.provider_execution === true) fail("provider_execution_denied");
  if (action.force === true || action.delete_ref === true || action.tags === true) fail("absolute_deny_action");
  if (HOST_NATIVE_ABSOLUTE_DENY_ACTIONS.includes(kind)) fail("absolute_deny_action");
  const repository = text(action.repository, "action_repository_invalid", 300);
  return { ...clone(action), kind, repository, provider_execution: false };
}

function ensureActionBound(action, delegation) {
  if (action.repository !== delegation.grant.repository) fail("delegation_repository_mismatch");
  const branch = actionBranch(action);
  if (branch && !branchAllowed(branch, delegation.grant.allowed_branches)) fail("branch_not_allowed");
  if (!delegation.grant.allowed_actions.includes(action.kind)) fail("action_not_allowed");
  if (action.kind === "github.merge" && !delegation.grant.protected_branches.includes(action.base_branch)) {
    fail("protected_base_required");
  }
  if (action.kind === "git.push.protected" && !delegation.grant.protected_branches.includes(action.branch)) {
    fail("protected_base_required");
  }
  const changed = Array.isArray(action.changed_files) ? action.changed_files : [];
  if (changed.some((file) => !delegation.grant.allowed_path_prefixes.some((prefix) => (
    String(file).startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) || String(file) === prefix
  )))) {
    fail("path_not_allowed");
  }
}

function ensureBudget(delegation, usage) {
  const next = {
    commits: delegation.usage.commits + usage.commits,
    pushes: delegation.usage.pushes + usage.pushes,
    deploys: delegation.usage.deploys + usage.deploys,
    total_actions: delegation.usage.total_actions + usage.total_actions,
  };
  if (next.commits > delegation.grant.budget.max_commits) fail("delegation_commits_budget_exhausted");
  if (next.pushes > delegation.grant.budget.max_pushes) fail("delegation_pushes_budget_exhausted");
  if (next.deploys > delegation.grant.budget.max_deploys) fail("delegation_deploys_budget_exhausted");
  if (next.total_actions > delegation.grant.budget.max_total_actions) fail("delegation_total_actions_budget_exhausted");
  return next;
}

function validateClosureAttestation(input, secret) {
  const attestation = input.closure_attestation;
  exactKeys(attestation, new Set([
    "schema_version", "tenant_id", "work_id", "repository", "core_plan_id", "core_plan_digest", "local_plan_id", "local_plan_digest", "evaluation_digest", "target_commit", "checks_digest", "acceptance_criteria", "report_bindings", "provider_execution", "signature",
  ]));
  if (attestation.schema_version !== "host_native_closure_attestation_v1" || attestation.provider_execution !== false) {
    fail("closure_attestation_invalid");
  }
  const { signature, ...unsigned } = attestation;
  const expected = hmac(
    "hnca",
    secret,
    `host-native-closure-attestation-v1\u0000${JSON.stringify(canonicalObject(unsigned))}`,
  );
  // The format was valid, but its authenticated contents were altered.  Keep
  // this distinct from a malformed attestation so the HTTP layer can deny it
  // as an authorization failure without leaking any verification detail.
  if (!safeEqual(signature, expected)) {
    fail("core_join_closure_attestation_signature_invalid");
  }
  return clone(attestation);
}

function coreJoinClaim(input, manifest, closure, requiredChecksPolicyDigest = null) {
  const checksCommit = commit(input.checks?.commit, "checks_commit_invalid");
  if (checksCommit !== manifest.verification.checks_commit) fail("reviewed_commit_mismatch");
  if (!sameStrings(input.checks?.required_checks, manifest.verification.required_checks)) {
    fail("required_checks_policy_mismatch");
  }
  if (digest(input.checks?.checks_digest) !== manifest.verification.checks_digest) fail("checks_digest_mismatch");
  if (input.provider_execution !== false) fail("provider_execution_denied");
  const core_plan_digest = digest(input.core_plan_digest);
  const core_plan_id = text(input.core_plan_id, "core_plan_binding_mismatch", 240);
  if (core_plan_id !== `hnp_${core_plan_digest.slice(0, 40)}`) fail("core_plan_binding_mismatch");
  if (!Array.isArray(input.acceptance_criteria) || input.acceptance_criteria.length < 1) fail("acceptance_criteria_invalid");
  for (const criterion of input.acceptance_criteria) {
    if (criterion?.proven !== true) fail("criterion_unproven");
  }
  const builder = input.builder_report || {};
  if (text(builder.agent_id, "builder_report_invalid", 240) !== manifest.verification.builder_agent_id ||
      commit(builder.target_commit, "reviewed_commit_mismatch") !== checksCommit) {
    fail("reviewed_commit_mismatch");
  }
  if (!Array.isArray(input.verifier_reports) || input.verifier_reports.length !== manifest.verification.verifier_agent_ids.length) {
    fail("verifier_reports_invalid");
  }
  const seen = new Set();
  for (const report of input.verifier_reports) {
    const agent = text(report?.agent_id, "verifier_reports_invalid", 240);
    if (agent === builder.agent_id) fail("self_verification_denied");
    if (!manifest.verification.verifier_agent_ids.includes(agent) || seen.has(agent) || report?.approved !== true ||
        commit(report?.reviewed_commit, "reviewed_commit_mismatch") !== checksCommit) {
      fail("reviewed_commit_mismatch");
    }
    seen.add(agent);
  }
  const intent = input.release_intent || {};
  const release_intent_digest = text(
    intent.release_intent_digest,
    "core_join_verdict_binding_mismatch",
    100,
  );
  if (!SHA256.test(release_intent_digest)) fail("core_join_verdict_binding_mismatch");
  const claim = {
    schema_version: "host_native_core_join_claim_v1",
    tenant_id: manifest.tenant_id,
    work_id: manifest.work_id,
    intent_anchor_digest: manifest.intent_anchor_digest,
    repository: manifest.repository,
    base_branch: text(manifest.base_branch, "base_branch_invalid", 240),
    core_plan_id,
    core_plan_digest,
    local_plan_id: text(input.local_plan_id, "local_plan_invalid", 240),
    local_plan_digest: digest(input.local_plan_digest),
    evaluation_digest: digest(input.evaluation_digest),
    acceptance_criteria: clone(input.acceptance_criteria),
    builder_report: clone(builder),
    verifier_reports: clone(input.verifier_reports),
    checks: {
      commit: checksCommit,
      required_checks: stableStrings(input.checks.required_checks, "required_checks_invalid", 100),
      checks_digest: digest(input.checks.checks_digest),
      evidence_digest: digest(input.checks.evidence_digest),
    },
    closure_attestation: closure,
    release_intent_digest,
    ...(requiredChecksPolicyDigest
      ? { required_checks_policy_digest: requiredChecksPolicyDigest }
      : {}),
    provider_execution: false,
  };
  return claim;
}

function ticketSignature(secret, ticket) {
  const { signature, ...unsigned } = ticket;
  return hmac("hnt", secret, canonical(unsigned));
}

function verifyReadbackDigest(record) {
  const github = record?.github;
  const services = record?.services;
  if (!record || record.trusted !== true || record.provider_execution !== false || !github || !Array.isArray(services)) {
    fail("trusted_readback_invalid");
  }
  const githubUnsigned = { ...github };
  delete githubUnsigned.readback_digest;
  if (github.readback_digest !== hostNativeDigest(githubUnsigned)) fail("trusted_readback_github_digest_mismatch");
  for (const service of services) {
    const unsigned = { ...service };
    delete unsigned.readback_digest;
    if (service.readback_digest !== hostNativeDigest(unsigned)) fail("trusted_readback_service_mismatch");
  }
}

export function createHostNativeGovernance({
  store: suppliedStore,
  signingSecret,
  closureAttestationSigningSecret,
  externalReadbackVerifier = null,
  releaseJoinVerdictResolver = null,
  renderServiceOriginResolver = null,
  requiredChecksPolicyResolver = null,
  unreservedEffectVerifier = null,
  now = () => Date.now(),
  idFactory = () => crypto.randomBytes(16).toString("hex"),
  ticketTtlMs = DEFAULT_TICKET_TTL_MS,
  reservationLeaseMs = DEFAULT_RESERVATION_LEASE_MS,
  coreJoinTtlMs = DEFAULT_CORE_JOIN_TTL_MS,
} = {}) {
  const store = requireStore(suppliedStore);
  const signing = String(signingSecret || "");
  const closureSecret = String(closureAttestationSigningSecret || "");
  if (signing.length < 32) fail("host_native_signing_secret_invalid");
  if (closureSecret.length < 32) fail("closure_attestation_signing_secret_invalid");
  const ticketTtl = Math.max(1_000, Math.min(60 * 60_000, Number(ticketTtlMs) || DEFAULT_TICKET_TTL_MS));
  const leaseMs = Math.max(1_000, Math.min(60 * 60_000, Number(reservationLeaseMs) || DEFAULT_RESERVATION_LEASE_MS));
  const coreJoinTtl = Math.max(1_000, Math.min(60 * 60_000, Number(coreJoinTtlMs) || DEFAULT_CORE_JOIN_TTL_MS));

  function makeId(prefix, seed) {
    const suffix = String(idFactory?.() || hostNativeDigest(seed).slice(0, 32)).replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80);
    return `${prefix}_${suffix || hostNativeDigest(seed).slice(0, 32)}`;
  }

  function readDelegationRecord(tenantId, delegationId) {
    const record = store.readState().delegations[String(delegationId || "")];
    if (!record) fail("delegation_not_found");
    if (record.grant.tenant_id !== tenantId) fail("cross_tenant_delegation_denied");
    return clone(record);
  }

  function readTicketRecord(tenantId, ticketId) {
    const record = store.readState().tickets[String(ticketId || "")];
    if (!record) fail("action_ticket_not_found");
    if (record.ticket.tenant_id !== tenantId) fail("cross_tenant_action_ticket_denied");
    return clone(record);
  }

  async function resolveCoreJoinRequiredChecksPolicyDigest(input, manifest) {
    const supplied = input.required_checks_policy_digest;
    if (typeof requiredChecksPolicyResolver !== "function") {
      if (supplied !== undefined) fail("required_checks_policy_unavailable");
      return null;
    }
    const plan = {
      tenant_id: manifest.tenant_id,
      repository: manifest.repository,
      base_branch: text(manifest.base_branch, "base_branch_invalid", 240),
      required_checks: manifest.verification.required_checks,
    };
    let policy;
    try {
      policy = await requiredChecksPolicyResolver({
        tenant_id: plan.tenant_id,
        repository: plan.repository,
        base_branch: plan.base_branch,
      });
    } catch {
      fail("required_checks_policy_unavailable");
    }
    const resolved = hostNativeDigest(normalizedRequiredChecksPolicy(policy, plan));
    if (supplied !== undefined && policySha256(supplied) !== resolved) {
      fail("required_checks_policy_mismatch");
    }
    return resolved;
  }

  const governance = {
    storage: Object.freeze({
      kind: store.kind,
      restart_durable: store.restart_durable === true,
      distributed: store.distributed === true,
    }),
    trusted_readback_configured: typeof externalReadbackVerifier === "function",
    release_join_verdict_resolver_configured: typeof releaseJoinVerdictResolver === "function",
    required_checks_policy_resolver_configured: typeof requiredChecksPolicyResolver === "function",
    closure_attestation_verifier_configured: true,
    render_service_origin_resolver_configured: typeof renderServiceOriginResolver === "function",

    async buildWorkPlan(input) {
      const plan = buildHostNativeWorkPlan(input);
      if (typeof requiredChecksPolicyResolver !== "function") return plan;
      if (!plan.base_branch) fail("base_branch_invalid");
      let policy;
      try {
        policy = await requiredChecksPolicyResolver({
          tenant_id: plan.tenant_id,
          repository: plan.repository,
          base_branch: plan.base_branch,
        });
      } catch {
        fail("required_checks_policy_unavailable");
      }
      const normalizedPolicy = normalizedRequiredChecksPolicy(policy, plan);
      return buildPolicyBoundWorkPlan(plan, hostNativeDigest(normalizedPolicy));
    },

    async issueDelegation(input = {}) {
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "issueDelegation", input);
      if (replay?.result) return replay.result;
      const nowValue = nowMillis(now);
      const grant = normalizeDelegation(input, nowValue);
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "issueDelegation", input);
        if (descriptor?.result) return descriptor.result;
        const nonce = ownerNonceKey(tenantId, grant.owner_confirmation);
        if (state.owner_nonces[nonce]) fail("owner_confirmation_replayed");
        const delegationId = `hnd_${hostNativeDigest({ grant, issued_at: iso(nowValue) }).slice(0, 40)}`;
        const unsigned = delegationUnsigned({
          ...grant,
          host_policy_override: false,
          host_policy_must_allow: true,
          provider_execution: false,
          absolute_deny_actions: [...HOST_NATIVE_ABSOLUTE_DENY_ACTIONS],
        }, delegationId, iso(nowValue));
        const record = {
          ...unsigned,
          signature: hmac("hnd", signing, canonical(unsigned)),
        };
        state.owner_nonces[nonce] = { delegation_id: delegationId, used_at: iso(nowValue) };
        state.delegations[delegationId] = record;
        return saveIdempotent(state, descriptor, record);
      });
    },

    async readDelegation({ tenant_id, delegation_id } = {}) {
      const record = readDelegationRecord(text(tenant_id, "tenant_id_invalid", 160), delegation_id);
      return {
        ...record,
        effective_state: delegationActive(record, nowMillis(now)) ? "active" :
          record.state === "revoked" ? "revoked" : "expired",
      };
    },

    verifyDelegation(record) {
      try {
        const { signature, ...unsigned } = record || {};
        return safeEqual(signature, hmac("hnd", signing, canonical(unsigned)));
      } catch { return false; }
    },

    async revokeDelegation(input = {}) {
      exactKeys(input, new Set(["tenant_id", "delegation_id", "owner_confirmation", "idempotency_key"]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "revokeDelegation", input);
      if (replay?.result) return replay.result;
      const confirmation = checkOwnerConfirmation(input.owner_confirmation);
      const nowValue = nowMillis(now);
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "revokeDelegation", input);
        if (descriptor?.result) return descriptor.result;
        const record = state.delegations[String(input.delegation_id || "")];
        if (!record) fail("delegation_not_found");
        if (record.grant.tenant_id !== tenantId) fail("cross_tenant_delegation_denied");
        const nonce = ownerNonceKey(tenantId, confirmation);
        if (state.owner_nonces[nonce]) fail("owner_confirmation_replayed");
        state.owner_nonces[nonce] = { delegation_id: record.delegation_id, used_at: iso(nowValue) };
        record.state = "revoked";
        record.revoked_at = iso(nowValue);
        record.revocation = { owner_subject_fingerprint: confirmation.owner_subject_fingerprint };
        const { signature: _signature, ...unsigned } = record;
        record.signature = hmac("hnd", signing, canonical(unsigned));
        return saveIdempotent(state, descriptor, record);
      });
    },

    async issueCoreJoinVerdict(input = {}) {
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "issueCoreJoinVerdict", input);
      if (replay?.result) return replay.result;
      if (input.provider_execution !== false) fail("provider_execution_denied");
      const releaseIntent = input.release_intent;
      if (!releaseIntent || typeof releaseIntent !== "object") fail("release_intent_invalid");
      // Reconstruct a synthetic manifest-free context from the intent.  The
      // closure and report validation below binds every field that can later
      // be consumed by a release ticket.
      const manifestLike = {
        tenant_id: text(input.tenant_id, "tenant_id_invalid", 160),
        work_id: text(input.work_id, "work_id_invalid", 240),
        intent_anchor_digest: digest(input.intent_anchor_digest),
        repository: text(input.repository, "repository_invalid", 300),
        verification: {
          builder_agent_id: text(input.builder_report?.agent_id, "builder_report_invalid", 240),
          verifier_agent_ids: stableStrings((input.verifier_reports || []).map((report) => report?.agent_id), "verifier_agents_invalid", 20),
          required_checks: stableStrings(input.checks?.required_checks, "required_checks_invalid", 100),
          checks_commit: commit(input.checks?.commit, "checks_commit_invalid"),
          checks_digest: digest(input.checks?.checks_digest),
          evidence_digest: digest(input.evaluation_digest),
        },
      };
      const closure = validateClosureAttestation(input, closureSecret);
      const expectedIntentFields = ["tenant_id", "work_id", "intent_anchor_digest", "repository"];
      for (const field of expectedIntentFields) {
        if (releaseIntent[field] !== manifestLike[field]) fail("core_join_verdict_binding_mismatch");
      }
      // Build a lightweight manifest facade for shared strict validation. The
      // HNJ itself compares the full release intent digest below.
      const intentDigest = text(releaseIntent.release_intent_digest, "release_intent_invalid", 100);
      if (!SHA256.test(intentDigest)) fail("release_intent_invalid");
      const checksCommit = manifestLike.verification.checks_commit;
      if (closure.tenant_id !== manifestLike.tenant_id || closure.work_id !== manifestLike.work_id ||
          closure.repository !== manifestLike.repository || closure.target_commit !== checksCommit ||
          closure.core_plan_id !== input.core_plan_id || closure.core_plan_digest !== input.core_plan_digest ||
          closure.local_plan_id !== input.local_plan_id || closure.local_plan_digest !== input.local_plan_digest ||
          closure.evaluation_digest !== input.evaluation_digest || closure.checks_digest !== input.checks.checks_digest) {
        fail("closure_attestation_invalid");
      }
      const requiredChecksPolicyDigest =
        await resolveCoreJoinRequiredChecksPolicyDigest(input, {
          ...manifestLike,
          base_branch: releaseIntent.base_branch,
        });
      const pseudoManifest = {
        ...manifestLike,
        verification: {
          ...manifestLike.verification,
          builder_agent_id: input.builder_report.agent_id,
          verifier_agent_ids: stableStrings((input.verifier_reports || []).map((report) => report.agent_id), "verifier_agents_invalid", 20),
        },
      };
      const claim = coreJoinClaim(input, {
        ...pseudoManifest,
        delivery: releaseIntent.delivery,
        rollback: releaseIntent.rollback,
        base_branch: releaseIntent.base_branch,
        delivery_branch: releaseIntent.delivery_branch,
        base_commit: releaseIntent.base_commit,
        head_commit: releaseIntent.head_commit,
        tree_sha: releaseIntent.tree_sha,
        diff_digest: releaseIntent.diff_digest,
        changed_files: releaseIntent.changed_files,
      }, closure, requiredChecksPolicyDigest);
      const claim_digest = hostNativeDigest(claim);
      const verdictId = `hnj_${claim_digest.slice(0, 40)}`;
      const nowValue = nowMillis(now);
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "issueCoreJoinVerdict", input);
        if (descriptor?.result) return descriptor.result;
        const existing = state.core_join_verdicts[verdictId];
        if (existing) return saveIdempotent(state, descriptor, clone(existing));
        const { schema_version: _claimSchemaVersion, ...claimFields } = claim;
        const verdictUnsigned = {
          schema_version: "host_native_core_join_v1",
          verdict_id: verdictId,
          claim_digest,
          ...claimFields,
          authority: "universal_core",
          allowed: true,
          provider_execution: false,
          issued_at: iso(nowValue),
          expires_at: iso(nowValue + coreJoinTtl),
        };
        const verdict = { ...verdictUnsigned, signature: hmac("hnj", signing, canonical(verdictUnsigned)) };
        const record = {
          schema_version: "host_native_core_join_record_v1",
          state: "active",
          uses: 0,
          tenant_id: tenantId,
          verdict_id: verdictId,
          claim_digest,
          claim,
          verdict,
          issued_at: iso(nowValue),
          expires_at: verdict.expires_at,
        };
        state.core_join_verdicts[verdictId] = record;
        return saveIdempotent(state, descriptor, clone(record));
      });
    },

    async readCoreJoinVerdict({ tenant_id, verdict_id } = {}) {
      const tenantId = text(tenant_id, "tenant_id_invalid", 160);
      const record = store.readState().core_join_verdicts[String(verdict_id || "")];
      if (!record) fail("core_join_verdict_not_found");
      if (record.tenant_id !== tenantId) fail("cross_tenant_core_join_verdict_denied");
      return clone(record);
    },

    verifyCoreJoinVerdict(record) {
      try {
        const verdict = record?.verdict;
        const { signature, ...unsigned } = verdict || {};
        const issuedAt = Date.parse(verdict?.issued_at || "");
        const expiresAt = Date.parse(verdict?.expires_at || "");
        return verdict?.allowed === true && verdict?.provider_execution === false &&
          verdict?.claim_digest === record?.claim_digest &&
          Number.isFinite(issuedAt) && Number.isFinite(expiresAt) &&
          issuedAt < expiresAt && expiresAt > nowMillis(now) &&
          safeEqual(signature, hmac("hnj", signing, canonical(unsigned)));
      } catch { return false; }
    },

    async issueActionTicket(input = {}) {
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "issueActionTicket", input);
      if (replay?.result) return replay.result;
      const action = validateActionShape(input.action);
      const nowValue = nowMillis(now);
      const delegation = initial.delegations[String(input.delegation_id || "")];
      if (!delegation) fail("delegation_not_found");
      if (delegation.grant.tenant_id !== tenantId) fail("cross_tenant_delegation_denied");
      if (!delegationActive(delegation, nowValue)) fail("delegation_not_active");
      if (text(input.work_id, "work_id_invalid", 240) !== delegation.grant.work_id) fail("delegation_work_mismatch");
      if (digest(input.intent_anchor_digest) !== delegation.grant.intent_anchor_digest) fail("delegation_intent_mismatch");
      if (text(input.repository, "repository_invalid", 300) !== delegation.grant.repository) fail("delegation_repository_mismatch");
      const host_kind = text(input.host_kind, "host_kind_invalid", 120);
      if (!delegation.grant.audience.includes(host_kind)) fail("host_not_allowed");
      const host_session_fingerprint = text(input.host_session_fingerprint, "host_session_invalid", 300);
      ensureActionBound(action, delegation);
      const evidence_digest = digest(input.evidence_digest);
      let release_manifest = null;
      let release_intent_digest = null;
      let release_join_resolution = null;
      let coreJoin = null;
      let predecessor = null;
      if (input.predecessor_ticket_id) {
        const parent = initial.tickets[String(input.predecessor_ticket_id)];
        const parentMayContinue = parent && (
          parent.state === "completed" ||
          parent.state === "reconciled" ||
          (parent.state === "observed_unreserved_effect" &&
            parent.protocol_deviation?.classification === "RECONCILED_WITH_EXCEPTION" &&
            parent.protocol_deviation?.continuation_authorized === true)
        );
        if (!parentMayContinue || parent.ticket.tenant_id !== tenantId) {
          fail("predecessor_ticket_invalid");
        }
        predecessor = {
          ticket_id: parent.ticket.ticket_id,
          ticket_digest: hostNativeDigest(parent.ticket),
          result_commit: parent.result_commit || null,
        };
      }
      if (isReleaseAction(action.kind)) {
        if (!input.release_manifest) fail("release_manifest_required");
        release_manifest = validateHostReleaseManifestV2(input.release_manifest, {
          tenant_id: tenantId,
          work_id: delegation.grant.work_id,
          intent_anchor_digest: delegation.grant.intent_anchor_digest,
          repository: delegation.grant.repository,
        });
        // Render origins are materialized below and intentionally are not part
        // of the signed manifest digest.  Capture the immutable release intent
        // before adding that server-resolved runtime detail.
        release_intent_digest = deriveHostReleaseIntentV1(release_manifest).release_intent_digest;
        if (!sameStrings(release_manifest.verification.required_checks, delegation.grant.release_policy.required_checks)) {
          fail("required_checks_policy_mismatch");
        }
        if (action.kind === "github.merge") {
          if (action.base_branch !== release_manifest.delivery_branch || action.head_commit !== release_manifest.head_commit ||
              action.expected_base_commit !== release_manifest.base_commit) fail("release_manifest_action_mismatch");
          if (release_manifest.delivery.services.some((service) =>
            service.target_commit !== null || service.target_resolution !== "post_merge_readback")) {
            fail("github_merge_post_merge_readback_required");
          }
          const induced = Array.isArray(action.induced_effects) ? action.induced_effects : [];
          if (induced.length < 1) fail("induced_deploy_required");
          const expected = release_manifest.delivery.services.map((service) => `${service.service_id}\u0000${service.environment}`).sort();
          const actual = induced.map((service) => `${service?.service_id}\u0000${service?.environment}`).sort();
          if (!sameStrings(expected, actual)) fail("induced_effect_mismatch");
        }
        if (action.kind === "git.push.protected") {
          if (action.branch !== release_manifest.delivery_branch || action.source_commit !== release_manifest.head_commit ||
              action.expected_remote_commit !== release_manifest.base_commit) fail("release_manifest_action_mismatch");
          const induced = Array.isArray(action.induced_effects) ? action.induced_effects : [];
          const expected = release_manifest.delivery.services.map((service) => `${service.service_id}\u0000${service.environment}`).sort();
          const actual = induced.map((service) => `${service?.service_id}\u0000${service?.environment}`).sort();
          if (!sameStrings(expected, actual)) fail("induced_effect_mismatch");
        }
        if (["render.deploy", "render.rollback"].includes(action.kind)) {
          const service = release_manifest.delivery.services.find((entry) =>
            entry.service_id === action.service_id && entry.environment === action.environment);
          if (!service || service.target_commit !== action.target_commit || service.expected_previous_commit !== action.expected_live_commit) {
            fail("release_manifest_action_mismatch");
          }
          if (action.kind === "render.deploy" && action.environment === "staging" && (
            !Number.isSafeInteger(Number(action.pull_request)) || Number(action.pull_request) < 1 ||
            action.branch !== release_manifest.delivery_branch ||
            action.source_commit !== release_manifest.head_commit ||
            action.base_branch !== release_manifest.base_branch ||
            action.expected_base_commit !== release_manifest.base_commit
          )) fail("release_manifest_action_mismatch");
        }
        if (action.kind === "render.observe") {
          const parent = initial.tickets[String(action.parent_release_ticket_id || "")];
          if (!parent?.finalize_authorization || parent.ticket.tenant_id !== tenantId ||
              action.parent_release_ticket_digest !== hostNativeDigest(parent.ticket) ||
              action.release_manifest_digest !== parent.ticket.release_manifest_digest) {
            fail("predecessor_ticket_invalid");
          }
          coreJoin = initial.core_join_verdicts[parent.ticket.core_join_verdict_id];
          release_join_resolution = parent.ticket.release_join_resolution;
          release_intent_digest = parent.ticket.release_intent_digest;
          predecessor = {
            ticket_id: parent.ticket.ticket_id,
            ticket_digest: hostNativeDigest(parent.ticket),
            result_commit: parent.result_commit || action.target_commit,
          };
        } else {
          coreJoin = initial.core_join_verdicts[release_manifest.verification.core_join_verdict_id];
          if (!coreJoin) fail("core_join_verdict_not_found");
          if (coreJoin.tenant_id !== tenantId) fail("cross_tenant_core_join_verdict_denied");
          if (coreJoin.state !== "active") fail("core_join_verdict_consumed");
          const coreJoinExpiresAt = Date.parse(coreJoin.verdict?.expires_at || "");
          if (!Number.isFinite(coreJoinExpiresAt) || coreJoinExpiresAt <= nowValue) {
            fail("core_join_verdict_expired");
          }
          if (coreJoin.claim.release_intent_digest !== release_intent_digest) {
            fail("core_join_verdict_binding_mismatch");
          }
          if (typeof releaseJoinVerdictResolver !== "function") fail("release_join_verdict_unavailable");
          const resolvedServices = [];
          for (const service of release_manifest.delivery.services) {
            let origin = service.origin;
            if (typeof renderServiceOriginResolver === "function") {
              origin = await renderServiceOriginResolver({
                tenant_id: tenantId,
                repository: delegation.grant.repository,
                service_id: service.service_id,
                environment: service.environment,
              });
            }
            origin = validRenderOrigin(origin || `https://${service.service_id}.onrender.com`);
            resolvedServices.push({ ...service, origin });
          }
          release_manifest = {
            ...release_manifest,
            delivery: { ...release_manifest.delivery, services: resolvedServices },
          };
          const resolutionInput = {
            core_join_verified: governance.verifyCoreJoinVerdict(coreJoin),
            core_join_issued_at: coreJoin.verdict.issued_at,
            core_join_expires_at: coreJoin.verdict.expires_at,
            verdict_id: coreJoin.verdict_id,
            tenant_id: tenantId,
            work_id: delegation.grant.work_id,
            intent_anchor_digest: delegation.grant.intent_anchor_digest,
            repository: delegation.grant.repository,
            checks_commit: release_manifest.verification.checks_commit,
            required_checks: release_manifest.verification.required_checks,
            evidence_digest,
            source_evidence: {
              base_commit: release_manifest.base_commit,
              head_commit: release_manifest.head_commit,
              tree_sha: release_manifest.tree_sha,
              diff_digest: release_manifest.diff_digest,
              changed_files: release_manifest.changed_files,
            },
            delivery_services: resolvedServices.map((service) => ({
              service_id: service.service_id,
              environment: service.environment,
              origin: service.origin,
              expected_previous_commit: service.expected_previous_commit,
              health_contract_digest: service.health_contract_digest,
            })),
            rollback: release_manifest.rollback,
            action,
          };
          release_join_resolution = await releaseJoinVerdictResolver(resolutionInput);
          if (
            !release_join_resolution || release_join_resolution.trusted !== true ||
            release_join_resolution.allowed !== true || release_join_resolution.provider_execution !== false ||
            release_join_resolution.verdict_id !== coreJoin.verdict_id ||
            release_join_resolution.tenant_id !== tenantId ||
            release_join_resolution.repository !== delegation.grant.repository
          ) {
            fail("release_join_verdict_untrusted");
          }
        }
      }
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "issueActionTicket", input);
        if (descriptor?.result) return descriptor.result;
        const currentDelegation = state.delegations[String(input.delegation_id || "")];
        if (!currentDelegation || !delegationActive(currentDelegation, nowValue)) fail("delegation_not_active");
        let releaseJoin = null;
        let supersededTicket = null;
        if (isReleaseAction(action.kind) && action.kind !== "render.observe") {
          releaseJoin = state.core_join_verdicts[release_manifest.verification.core_join_verdict_id];
          if (!releaseJoin || releaseJoin.state !== "active") fail("core_join_verdict_consumed");
          const joinExpiresAt = Date.parse(releaseJoin.verdict?.expires_at || "");
          if (!Number.isFinite(joinExpiresAt) || joinExpiresAt <= nowValue) {
            fail("core_join_verdict_expired");
          }
          const priorTicket = state.tickets[String(releaseJoin.authorized_ticket_id || "")];
          if (
            priorTicket?.state === "issued" &&
            priorTicket.uses === 0 &&
            Date.parse(priorTicket.ticket?.expires_at || "") > nowValue
          ) {
            fail("core_join_ticket_active");
          }
          if (priorTicket) {
            if (
              priorTicket.state !== "issued" ||
              priorTicket.uses !== 0 ||
              Date.parse(priorTicket.ticket?.expires_at || "") > nowValue ||
              priorTicket.ticket.host_session_fingerprint !== host_session_fingerprint ||
              priorTicket.ticket.evidence_digest !== evidence_digest ||
              priorTicket.ticket.release_manifest_digest !== release_manifest.manifest_digest ||
              priorTicket.ticket.release_intent_digest !== release_intent_digest ||
              hostNativeDigest(priorTicket.ticket.action) !== hostNativeDigest(action)
            ) {
              fail("core_join_ticket_replacement_binding_mismatch");
            }
            supersededTicket = priorTicket;
          }
        }
        const usage = actionUsage(action.kind, action);
        ensureBudget(currentDelegation, usage);
        const ticketId = makeId("hnt", { input, issued_at: iso(nowValue) });
        if (releaseJoin) {
          releaseJoin.authorized_ticket_id = ticketId;
          releaseJoin.authorized_at = iso(nowValue);
        }
        if (supersededTicket) {
          supersededTicket.state = "superseded";
          supersededTicket.superseded_by_ticket_id = ticketId;
          supersededTicket.superseded_at = iso(nowValue);
        }
        const expiresAt = Math.min(Date.parse(currentDelegation.grant.expires_at), nowValue + ticketTtl);
        const ticketUnsigned = {
          schema_version: "host_native_action_ticket_v1",
          ticket_id: ticketId,
          delegation_id: currentDelegation.delegation_id,
          tenant_id: tenantId,
          work_id: currentDelegation.grant.work_id,
          intent_anchor_digest: currentDelegation.grant.intent_anchor_digest,
          repository: currentDelegation.grant.repository,
          host_kind,
          host_session_fingerprint,
          action,
          evidence_digest,
          issued_at: iso(nowValue),
          expires_at: iso(expiresAt),
          max_uses: 1,
          host_policy_override: false,
          host_policy_must_allow: true,
          provider_execution: false,
          ...(predecessor ? { predecessor, predecessor_chain_digest: hostNativeDigest(predecessor) } : {}),
          ...(release_manifest ? {
            release_manifest_digest: release_manifest.manifest_digest,
            release_manifest_binding: ticketReleaseBinding(release_manifest),
            release_intent_digest,
            core_join_verdict_id: coreJoin?.verdict_id,
            core_join_verdict_digest: coreJoin?.claim_digest,
            release_join_resolution,
            release_join_resolution_digest: hostNativeDigest(release_join_resolution),
          } : {}),
        };
        const ticket = { ...ticketUnsigned, signature: ticketSignature(signing, ticketUnsigned) };
        const record = { state: "issued", uses: 0, ticket };
        state.tickets[ticketId] = record;
        return saveIdempotent(state, descriptor, record);
      });
    },

    async readActionTicket({ tenant_id, ticket_id } = {}) {
      return readTicketRecord(text(tenant_id, "tenant_id_invalid", 160), ticket_id);
    },

    verifyActionTicket(ticket) {
      try { return safeEqual(ticket?.signature, ticketSignature(signing, ticket)); }
      catch { return false; }
    },

    async reserveActionTicket(input = {}) {
      exactKeys(input, new Set(["tenant_id", "ticket_id", "host_session_fingerprint", "idempotency_key"]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "reserveActionTicket", input);
      if (replay?.result) return replay.result;
      const nowValue = nowMillis(now);
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "reserveActionTicket", input);
        if (descriptor?.result) return descriptor.result;
        const record = state.tickets[String(input.ticket_id || "")];
        if (!record) fail("action_ticket_not_found");
        if (record.ticket.tenant_id !== tenantId) fail("cross_tenant_action_ticket_denied");
        if (record.ticket.host_session_fingerprint !== text(input.host_session_fingerprint, "host_session_mismatch", 300)) fail("host_session_mismatch");
        if (record.state !== "issued") fail("replayed");
        if (Date.parse(record.ticket.expires_at) <= nowValue) fail("action_ticket_expired");
        const delegation = state.delegations[record.ticket.delegation_id];
        if (!delegationActive(delegation, nowValue)) fail("delegation_not_active");
        const usage = actionUsage(record.ticket.action.kind, record.ticket.action);
        delegation.usage = ensureBudget(delegation, usage);
        if (isReleaseAction(record.ticket.action.kind) && record.ticket.action.kind !== "render.observe") {
          const join = state.core_join_verdicts[record.ticket.core_join_verdict_id];
          if (!join || join.tenant_id !== tenantId) fail("core_join_verdict_not_found");
          if (join.state !== "active") fail("core_join_verdict_consumed");
          if (join.authorized_ticket_id !== record.ticket.ticket_id) {
            fail("core_join_ticket_superseded");
          }
          const joinExpiresAt = Date.parse(join.verdict?.expires_at || "");
          if (!Number.isFinite(joinExpiresAt) || joinExpiresAt <= nowValue) {
            fail("core_join_verdict_expired");
          }
          if (
            join.claim_digest !== record.ticket.core_join_verdict_digest ||
            join.claim?.release_intent_digest !== record.ticket.release_intent_digest
          ) {
            fail("core_join_verdict_binding_mismatch");
          }
          join.state = "consumed";
          join.uses = 1;
          join.consumed_by_ticket_id = record.ticket.ticket_id;
        }
        record.state = "reserved";
        record.uses = 1;
        record.reservation_id = makeId("hnr", { ticket_id: record.ticket.ticket_id, nowValue });
        record.reserved_at = iso(nowValue);
        record.reservation_expires_at = iso(nowValue + leaseMs);
        return saveIdempotent(state, descriptor, record);
      });
    },

    async completeActionTicket(input = {}) {
      exactKeys(input, new Set([
        "tenant_id", "ticket_id", "reservation_id", "host_session_fingerprint", "outcome", "result_digest", "result_commit", "readback_digest", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "completeActionTicket", input);
      if (replay?.result) return replay.result;
      const nowValue = nowMillis(now);
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "completeActionTicket", input);
        if (descriptor?.result) return descriptor.result;
        const record = state.tickets[String(input.ticket_id || "")];
        if (!record || record.ticket.tenant_id !== tenantId) fail("action_ticket_not_found");
        if (record.state !== "reserved") fail("not_completable");
        if (record.reservation_id !== input.reservation_id || record.ticket.host_session_fingerprint !== input.host_session_fingerprint) fail("host_session_mismatch");
        if (Date.parse(record.reservation_expires_at) <= nowValue) fail("action_ticket_reservation_expired");
        const outcome = text(input.outcome, "outcome_invalid", 40);
        if (!["success", "failure", "unknown"].includes(outcome)) fail("outcome_invalid");
        record.result_digest = digest(input.result_digest);
        record.host_readback_digest = input.readback_digest ? digest(input.readback_digest) : null;
        record.result_commit = input.result_commit ? commit(input.result_commit) : null;
        // A host-reported result is evidence, not independent verification.
        // `authorizeFinalize` is the sole transition that can establish this.
        record.result_commit_verified = false;
        if (record.ticket.action.kind === "github.merge" && outcome === "success") {
          if (!record.result_commit || !record.host_readback_digest) fail("commit_result_evidence_required");
        }
        record.outcome = outcome;
        record.completed_at = iso(nowValue);
        record.state = outcome === "unknown" ? "reconciliation_required" : "completed";
        return saveIdempotent(state, descriptor, record);
      });
    },

    async reconcileActionTicket(input = {}) {
      exactKeys(input, new Set([
        "tenant_id", "ticket_id", "reservation_id", "host_session_fingerprint", "observed_outcome", "observed_commit", "readback_digest", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "reconcileActionTicket", input);
      if (replay?.result) return replay.result;
      const nowValue = nowMillis(now);
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "reconcileActionTicket", input);
        if (descriptor?.result) return descriptor.result;
        const record = state.tickets[String(input.ticket_id || "")];
        if (!record || record.ticket.tenant_id !== tenantId) fail("action_ticket_not_found");
        if (!["reconciliation_required", "reserved"].includes(record.state)) fail("not_reconcilable");
        if (record.reservation_id !== input.reservation_id || record.ticket.host_session_fingerprint !== input.host_session_fingerprint) fail("host_session_mismatch");
        if (Date.parse(record.reservation_expires_at) <= nowValue) fail("action_ticket_reservation_expired");
        if (input.observed_outcome !== "success") fail("observed_outcome_invalid");
        const observedCommit = commit(input.observed_commit);
        if (record.result_commit && record.result_commit !== observedCommit) fail("observed_commit_mismatch");
        record.observed_outcome = "success";
        record.observed_commit = observedCommit;
        record.result_commit = observedCommit;
        record.host_readback_digest = digest(input.readback_digest);
        record.reconciled_at = iso(nowValue);
        record.state = "reconciled";
        return saveIdempotent(state, descriptor, record);
      });
    },

    // This is deliberately not a reservation recovery path. It records an
    // independently observed effect that occurred after a valid ticket was
    // issued but before the host reserved it. The original ticket timestamps
    // and reservation fields remain untouched; the default verdict is BLOCKED.
    async observeUnreservedActionEffect(input = {}) {
      exactKeys(input, new Set([
        "tenant_id", "ticket_id", "host_session_fingerprint", "observed_outcome",
        "observed_commit", "readback_digest", "verifier_evidence_digest",
        "deviation_reason", "idempotency_key",
      ]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const initial = store.readState();
      const replay = getIdempotent(initial, tenantId, "observeUnreservedActionEffect", input);
      if (replay?.result) return replay.result;
      const nowValue = nowMillis(now);
      const initialRecord = initial.tickets[String(input.ticket_id || "")];
      if (!initialRecord || initialRecord.ticket.tenant_id !== tenantId) fail("action_ticket_not_found");
      if (initialRecord.ticket.host_session_fingerprint !== text(input.host_session_fingerprint, "host_session_mismatch", 300)) fail("host_session_mismatch");
      if (initialRecord.state !== "issued" || initialRecord.reservation_id) fail("unreserved_effect_not_eligible");
      if (Date.parse(initialRecord.ticket.expires_at) <= nowValue) fail("action_ticket_expired");
      if (input.observed_outcome !== "success") fail("observed_outcome_invalid");
      const observedCommit = commit(input.observed_commit);
      const expectedCommit = initialRecord.ticket.action.source_commit || initialRecord.ticket.action.target_commit;
      if (!expectedCommit || observedCommit !== commit(expectedCommit)) fail("observed_commit_mismatch");
      const readbackDigest = digest(input.readback_digest);
      const verifierEvidenceDigest = digest(input.verifier_evidence_digest);
      const deviationReason = text(input.deviation_reason, "protocol_deviation_reason_invalid", 500);
      if (!deviationReason) fail("protocol_deviation_reason_invalid");
      let decision = { classification: "BLOCKED", continuation_authorized: false, reason: "unreserved_effect_verifier_unavailable" };
      if (typeof unreservedEffectVerifier === "function") {
        try {
          decision = await unreservedEffectVerifier({
            tenant_id: tenantId,
            ticket: clone(initialRecord.ticket),
            observed_commit: observedCommit,
            readback_digest: readbackDigest,
            verifier_evidence_digest: verifierEvidenceDigest,
            deviation_reason: deviationReason,
          }) || decision;
        } catch {
          decision = { classification: "BLOCKED", continuation_authorized: false, reason: "unreserved_effect_verifier_failed" };
        }
      }
      const classification = text(decision.classification, "unreserved_effect_classification_invalid", 80);
      if (!["RECONCILED_WITH_EXCEPTION", "REQUIRES_REMEDIATION", "BLOCKED"].includes(classification)) {
        fail("unreserved_effect_classification_invalid");
      }
      const continuationAuthorized = classification === "RECONCILED_WITH_EXCEPTION" && decision.continuation_authorized === true;
      return store.mutate((state) => {
        const descriptor = getIdempotent(state, tenantId, "observeUnreservedActionEffect", input);
        if (descriptor?.result) return descriptor.result;
        const record = state.tickets[String(input.ticket_id || "")];
        if (!record || record.ticket.tenant_id !== tenantId) fail("action_ticket_not_found");
        if (record.state !== "issued" || record.reservation_id) fail("unreserved_effect_not_eligible");
        const receiptUnsigned = {
          schema_version: "host_native_observed_unreserved_effect_v1",
          receipt_id: makeId("hnue", { ticket_id: record.ticket.ticket_id, observed_commit: observedCommit, nowValue }),
          ticket_id: record.ticket.ticket_id,
          action_type: record.ticket.action.kind,
          target: clone(record.ticket.action),
          observed_at: iso(nowValue),
          observed_outcome: "success",
          observed_commit: observedCommit,
          effect_digest: hostNativeDigest({ ticket_id: record.ticket.ticket_id, observed_commit: observedCommit, readback_digest: readbackDigest }),
          readback_digest: readbackDigest,
          verifier_evidence_digest: verifierEvidenceDigest,
          reservation_id: null,
          deviation_reason: deviationReason,
          classification,
          continuation_authorized: continuationAuthorized,
          reason: text(decision.reason || "", "unreserved_effect_reason_invalid", 500),
        };
        const receipt = { ...receiptUnsigned, signature: hmac("hnue", signing, canonical(receiptUnsigned)) };
        record.protocol_deviation = receipt;
        record.observed_outcome = "success";
        record.observed_commit = observedCommit;
        record.host_readback_digest = readbackDigest;
        record.state = "observed_unreserved_effect";
        return saveIdempotent(state, descriptor, record);
      });
    },

    async authorizeFinalize(input = {}) {
      exactKeys(input, new Set(["tenant_id", "ticket_id", "host_session_fingerprint"]));
      const tenantId = text(input.tenant_id, "tenant_id_invalid", 160);
      const nowValue = nowMillis(now);
      const current = readTicketRecord(tenantId, input.ticket_id);
      if (current.ticket.host_session_fingerprint !== text(input.host_session_fingerprint, "host_session_mismatch", 300)) fail("host_session_mismatch");
      const previousAuthorization = current.finalize_authorization || null;
      if (
        previousAuthorization &&
        Date.parse(previousAuthorization.expires_at || 0) > nowValue
      ) {
        return clone(current.finalize_authorization);
      }
      if (
        !["completed", "reconciled"].includes(current.state) &&
        Date.parse(current.reservation_expires_at || 0) <= nowValue
      ) {
        fail("action_ticket_reservation_expired");
      }
      if (!["completed", "reconciled"].includes(current.state) || (current.outcome !== "success" && current.observed_outcome !== "success")) {
        fail("successful_outcome_required");
      }
      if (!isReleaseAction(current.ticket.action.kind)) fail("release_manifest_required");
      if (typeof externalReadbackVerifier !== "function") fail("trusted_readback_unavailable");
      const targetCommit = commit(current.result_commit || current.ticket.action.target_commit || current.ticket.release_manifest_binding.head_commit);
      let external;
      try { external = await externalReadbackVerifier({ ticket: current.ticket, target_commit: targetCommit }); }
      catch (cause) {
        if (String(cause?.message || "").startsWith("trusted_readback_")) throw cause;
        fail("trusted_readback_invalid");
      }
      verifyReadbackDigest(external);
      const github = external.github;
      const verifiedAt = Date.parse(external.verified_at);
      const previousAuthorizationExpiresAt = previousAuthorization
        ? Date.parse(previousAuthorization.expires_at || "")
        : null;
      if (
        !Number.isFinite(verifiedAt) ||
        verifiedAt < Date.parse(current.reserved_at) ||
        verifiedAt > nowValue + 60_000 ||
        (
          previousAuthorization &&
          (!Number.isFinite(previousAuthorizationExpiresAt) ||
            verifiedAt <= previousAuthorizationExpiresAt)
        )
      ) {
        fail("trusted_readback_stale");
      }
      if (
        github.repository !== current.ticket.repository || github.target_commit !== targetCommit ||
        github.checks_passed !== true || !sameStrings(github.required_checks, current.ticket.release_manifest_binding.verification.required_checks)
      ) {
        fail("trusted_readback_github_mismatch");
      }
      if (!Array.isArray(github.observed_checks) || github.observed_checks.some((check) => (
        check?.status !== "completed" || check?.conclusion !== "success" ||
        check?.head_commit !== current.ticket.release_manifest_binding.verification.checks_commit
      ))) {
        fail("trusted_readback_checks_not_ready");
      }
      const expectedServices = current.ticket.release_manifest_binding.delivery.services;
      if (external.services.length !== expectedServices.length) fail("trusted_readback_service_set_mismatch");
      for (const expected of expectedServices) {
        const observed = external.services.find((service) =>
          service.service_id === expected.service_id && service.environment === expected.environment);
        if (!observed || observed.origin !== expected.origin || observed.live_commit !== targetCommit ||
            observed.health_contract_digest !== expected.health_contract_digest ||
            observed.rollback_commit !== current.ticket.release_manifest_binding.rollback.target_commit ||
            observed.rollback_status !== "previous_live_attested") {
          fail("trusted_readback_service_mismatch");
        }
      }
      return store.mutate((state) => {
        const record = state.tickets[String(input.ticket_id || "")];
        if (!record || record.ticket.tenant_id !== tenantId) fail("action_ticket_not_found");
        const receiptNow = nowMillis(now);
        if (record.finalize_authorization) {
          const storedExpiresAt = Date.parse(record.finalize_authorization.expires_at || 0);
          if (storedExpiresAt > receiptNow) {
            return record.finalize_authorization;
          }
          if (
            !previousAuthorization ||
            record.finalize_authorization.authorization_digest !==
              previousAuthorization.authorization_digest ||
            !Number.isFinite(storedExpiresAt) ||
            verifiedAt <= storedExpiresAt
          ) {
            fail("trusted_readback_stale");
          }
        }
        const receiptUnsigned = {
          schema_version: "host_native_finalize_authorization_v1",
          trusted: true,
          allowed: true,
          decision: "ALLOW_FINALIZE",
          decision_id: record.ticket.ticket_id,
          tenant_id: tenantId,
          work_id: record.ticket.work_id,
          repository: record.ticket.repository,
          target_commit: targetCommit,
          action_ticket_id: record.ticket.ticket_id,
          action_ticket_digest: hostNativeDigest(record.ticket),
          release_manifest_digest: record.ticket.release_manifest_digest,
          release_intent_digest: record.ticket.release_intent_digest,
          core_join_verdict_id: record.ticket.core_join_verdict_id,
          core_join_verdict_digest: record.ticket.core_join_verdict_digest,
          core_join_resolution_digest: record.ticket.release_join_resolution_digest,
          changed_files: record.ticket.release_manifest_binding.changed_files,
          predecessor: record.ticket.predecessor || null,
          predecessor_chain_digest: record.ticket.predecessor_chain_digest || null,
          evidence_digest: record.ticket.evidence_digest,
          host_kind: record.ticket.host_kind,
          host_session_fingerprint: record.ticket.host_session_fingerprint,
          ...(record.result_digest
            ? { host_result_digest: record.result_digest }
            : {}),
          host_readback_digest: record.host_readback_digest,
          external_readback_digest: hostNativeDigest(external),
          readback_digest: hostNativeDigest(external),
          result_commit_verified: true,
          github_readback: github,
          live_services: external.services,
          outcome_source: record.state === "reconciled" ? "reconciled_readback" : "verified_completion",
          readback_source: external.verifier_id,
          issued_at: iso(receiptNow),
          expires_at: iso(receiptNow + leaseMs),
          ...(record.finalize_authorization
            ? {
              previous_authorization_digest:
                record.finalize_authorization.authorization_digest,
            }
            : {}),
          host_policy_override: false,
          host_policy_must_allow: true,
          external_execution_allowed: false,
          host_execution_required: true,
          provider_execution: false,
        };
        const authorization_digest = hostNativeDigest(receiptUnsigned);
        const receipt = {
          ...receiptUnsigned,
          authorization_digest,
          signature: hmac("hnf", signing, canonical({ ...receiptUnsigned, authorization_digest })),
        };
        if (record.finalize_authorization) {
          const historicalAuthorization = record.finalize_authorization;
          const history = Array.isArray(record.finalize_authorization_history)
            ? record.finalize_authorization_history
            : [];
          record.finalize_authorization_history = [
            ...history,
            {
              authorization_digest: historicalAuthorization.authorization_digest,
              external_readback_digest:
                historicalAuthorization.external_readback_digest,
              issued_at: historicalAuthorization.issued_at,
              expires_at: historicalAuthorization.expires_at,
            },
          ].slice(-MAX_FINALIZE_AUTHORIZATION_HISTORY);
        }
        record.finalize_authorization = receipt;
        return receipt;
      });
    },
  };
  // Deliberately leave the facade extensible: callers wrap lifecycle methods
  // to supply a request idempotency key, while all authoritative state stays
  // inside the store and the closure above.
  return governance;
}
