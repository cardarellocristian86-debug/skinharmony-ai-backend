/**
 * Exact, server-side resolver registries for the host-native control plane.
 *
 * Registries deliberately describe references and public origins only.  A
 * GitHub credential itself is read from the supplied environment inside a
 * resolver closure and is never included in the returned registry object.
 */

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,239}$/;
const TOKEN_ENV = /^CORE_HOST_NATIVE_GITHUB_TOKEN_[A-Z0-9_]{3,160}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const WORKFLOW_PATH = /^\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/;
const RENDER_ORIGIN = /^https:\/\/[a-z0-9][a-z0-9-]*\.onrender\.com$/;

// Keep this literal synchronized with the CI workflow.  CI reads this small
// provenance anchor without evaluating server code, so it remains useful even
// when a configuration error keeps the runtime fail-closed.
export const HOST_NATIVE_GITHUB_WORKFLOW = Object.freeze({
  sha256: "139bf3efeeda714cfa6c295bcbef4dcd3db278bf33a946b50b8d08a2ebec8bc6",
  candidate_sha256: "f671a1f420691405a55db58e6cdfefa4426ac8c773f059cd6f30086f93dbaa4b",
});

function fail(code) {
  throw new Error(code);
}

function object(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}

function exactKeys(value, keys, code = "unknown_field") {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) fail(code);
  }
}

function text(value, code, { pattern = IDENTIFIER, max = 240 } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max || !pattern.test(normalized)) fail(code);
  return normalized;
}

function sha256(value, code) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA256.test(normalized)) fail(code);
  return normalized;
}

function parseRegistry(raw, schemaVersion, codePrefix) {
  const source = String(raw || "").trim();
  if (!source) return null;
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail(`${codePrefix}_json_invalid`);
  }
  object(parsed, `${codePrefix}_shape_invalid`);
  exactKeys(parsed, new Set(["schema_version", "bindings"]));
  if (parsed.schema_version !== schemaVersion) fail(`${codePrefix}_schema_invalid`);
  if (!Array.isArray(parsed.bindings) || parsed.bindings.length < 1 || parsed.bindings.length > 1_000) {
    fail(`${codePrefix}_bindings_invalid`);
  }
  return parsed.bindings;
}

function noDuplicate(bindings, key, code = "binding_duplicate") {
  const seen = new Set();
  for (const binding of bindings) {
    const fingerprint = key(binding);
    if (seen.has(fingerprint)) fail(code);
    seen.add(fingerprint);
  }
}

function registryResolver(records, lookup, missingCode) {
  return async (scope = {}) => {
    const record = records.get(lookup(scope));
    if (!record) fail(missingCode);
    return structuredClone(record);
  };
}

function parseGithubBindings(environment) {
  const bindings = parseRegistry(
    environment.CORE_HOST_NATIVE_GITHUB_CREDENTIAL_REGISTRY_JSON,
    "host_native_github_credential_registry_v1",
    "github_credential_registry",
  );
  if (!bindings) return null;
  const normalized = bindings.map((entry) => {
    object(entry, "github_credential_binding_invalid");
    exactKeys(entry, new Set(["tenant_id", "repository", "token_env"]));
    const tenant_id = text(entry.tenant_id, "tenant_id_invalid");
    const repository = text(entry.repository, "repository_invalid");
    const token_env = String(entry.token_env || "").trim();
    if (!TOKEN_ENV.test(token_env)) fail("token_reference_invalid");
    const token = String(environment[token_env] || "").trim();
    if (!token || token.length > 4_096) fail("credential_unavailable");
    return { tenant_id, repository, token_env, token };
  });
  noDuplicate(normalized, (entry) => `${entry.tenant_id}\u0000${entry.repository}`);
  const records = new Map(normalized.map((entry) => [
    `${entry.tenant_id}\u0000${entry.repository}`,
    entry,
  ]));
  return {
    state: "exact_registry_ready",
    binding_count: normalized.length,
    resolver: async (scope = {}) => {
      const tenant_id = text(scope.tenant_id, "credential_not_bound");
      const repository = text(scope.repository, "credential_not_bound");
      const record = records.get(`${tenant_id}\u0000${repository}`);
      if (!record) fail("credential_not_bound");
      return record.token;
    },
  };
}

function parseRenderBindings(environment) {
  const bindings = parseRegistry(
    environment.CORE_HOST_NATIVE_RENDER_ORIGIN_REGISTRY_JSON,
    "host_native_render_origin_registry_v1",
    "render_origin_registry",
  );
  if (!bindings) return null;
  const normalized = bindings.map((entry) => {
    object(entry, "render_origin_binding_invalid");
    exactKeys(entry, new Set([
      "tenant_id", "repository", "service_id", "environment", "origin",
    ]));
    const tenant_id = text(entry.tenant_id, "tenant_id_invalid");
    const repository = text(entry.repository, "repository_invalid");
    const service_id = text(entry.service_id, "service_id_invalid");
    const environmentName = text(entry.environment, "environment_invalid");
    const origin = String(entry.origin || "").trim().toLowerCase();
    if (!RENDER_ORIGIN.test(origin)) fail("origin_invalid");
    return { tenant_id, repository, service_id, environment: environmentName, origin };
  });
  noDuplicate(
    normalized,
    (entry) => `${entry.tenant_id}\u0000${entry.repository}\u0000${entry.service_id}\u0000${entry.environment}`,
  );
  const records = new Map(normalized.map((entry) => [
    `${entry.tenant_id}\u0000${entry.repository}\u0000${entry.service_id}\u0000${entry.environment}`,
    entry.origin,
  ]));
  return {
    state: "exact_registry_ready",
    binding_count: normalized.length,
    resolver: async (scope = {}) => {
      let tenant_id;
      let repository;
      let service_id;
      let environmentName;
      try {
        tenant_id = text(scope.tenant_id, "origin_not_bound");
        repository = text(scope.repository, "origin_not_bound");
        service_id = text(scope.service_id, "origin_not_bound");
        environmentName = text(scope.environment, "origin_not_bound");
      } catch {
        fail("origin_not_bound");
      }
      const origin = records.get(
        `${tenant_id}\u0000${repository}\u0000${service_id}\u0000${environmentName}`,
      );
      if (!origin) fail("origin_not_bound");
      return origin;
    },
  };
}

function parseRequiredCheckBindings(environment) {
  const bindings = parseRegistry(
    environment.CORE_HOST_NATIVE_REQUIRED_CHECKS_REGISTRY_JSON,
    "host_native_required_checks_registry_v1",
    "required_checks_registry",
  );
  if (!bindings) return null;
  const normalized = bindings.map((entry) => {
    object(entry, "required_checks_binding_invalid");
    exactKeys(entry, new Set([
      "tenant_id", "repository", "base_branch", "required_checks", "check_app", "workflow", "allowed_events",
    ]));
    const tenant_id = text(entry.tenant_id, "tenant_id_invalid");
    const repository = text(entry.repository, "repository_invalid");
    const base_branch = text(entry.base_branch, "base_branch_invalid");
    if (!Array.isArray(entry.required_checks) || entry.required_checks.length < 1 || entry.required_checks.length > 40) {
      fail("required_checks_invalid");
    }
    const required_checks = [...new Set(entry.required_checks.map((name) =>
      text(name, "required_check_invalid", { max: 240 }),
    ))].sort();
    if (required_checks.length !== entry.required_checks.length) fail("required_checks_duplicate");
    const checkApp = object(entry.check_app, "check_app_invalid");
    exactKeys(checkApp, new Set(["id", "slug", "owner"]));
    const appId = Number(checkApp.id);
    if (!Number.isSafeInteger(appId) || appId <= 0) fail("check_app_invalid");
    const check_app = {
      id: appId,
      slug: text(checkApp.slug, "check_app_invalid"),
      owner: text(checkApp.owner, "check_app_invalid"),
    };
    const workflowInput = object(entry.workflow, "workflow_invalid");
    exactKeys(workflowInput, new Set(["id", "name", "path", "sha256", "candidate_sha256"]));
    const workflowId = Number(workflowInput.id);
    if (!Number.isSafeInteger(workflowId) || workflowId <= 0) fail("workflow_invalid");
    const workflowPath = String(workflowInput.path || "").trim();
    if (!WORKFLOW_PATH.test(workflowPath)) fail("workflow_path_invalid");
    const candidate = workflowInput.candidate_sha256 === undefined || workflowInput.candidate_sha256 === null
      ? null
      : sha256(workflowInput.candidate_sha256, "workflow_digest_invalid");
    const workflow = {
      id: workflowId,
      name: text(workflowInput.name, "workflow_invalid", {
        pattern: /^[\x20-\x7e]+$/,
        max: 360,
      }),
      path: workflowPath,
      sha256: sha256(workflowInput.sha256, "workflow_digest_invalid"),
      candidate_sha256: candidate,
    };
    if (workflow.candidate_sha256 === workflow.sha256) {
      fail("workflow_digest_rotation_invalid");
    }
    if (!Array.isArray(entry.allowed_events) || entry.allowed_events.length < 1 || entry.allowed_events.length > 4) {
      fail("allowed_events_invalid");
    }
    const allowed_events = [...new Set(entry.allowed_events.map((event) => String(event || "").trim()))].sort();
    if (allowed_events.length !== entry.allowed_events.length || allowed_events.some((event) => !["push", "pull_request"].includes(event))) {
      fail("allowed_events_invalid");
    }
    return {
      schema_version: "host_native_required_checks_policy_v1",
      tenant_id,
      repository,
      base_branch,
      required_checks,
      check_app,
      workflow,
      allowed_events,
    };
  });
  noDuplicate(
    normalized,
    (entry) => `${entry.tenant_id}\u0000${entry.repository}\u0000${entry.base_branch}`,
  );
  const records = new Map(normalized.map((entry) => [
    `${entry.tenant_id}\u0000${entry.repository}\u0000${entry.base_branch}`,
    entry,
  ]));
  return {
    state: "exact_registry_ready",
    binding_count: normalized.length,
    resolver: registryResolver(
      records,
      (scope = {}) => `${String(scope.tenant_id || "").trim()}\u0000${String(scope.repository || "").trim()}\u0000${String(scope.base_branch || "").trim()}`,
      "policy_not_bound",
    ),
  };
}

/**
 * Parse all configured registries.  The function throws when configuration is
 * present but invalid: callers should turn that into a non-ready health state
 * instead of silently dropping a security boundary.
 */
export function loadHostNativeResolverRegistryFromEnvironment(environment = process.env) {
  const env = environment && typeof environment === "object" ? environment : {};
  const github = parseGithubBindings(env) || {
    state: "not_configured",
    binding_count: 0,
    resolver: null,
  };
  const render = parseRenderBindings(env) || {
    state: "project_scope_fallback_required",
    binding_count: 0,
    resolver: null,
  };
  const required_checks = parseRequiredCheckBindings(env) || {
    state: "not_configured",
    binding_count: 0,
    resolver: null,
  };
  return Object.freeze({
    configuration_valid: true,
    github: Object.freeze(github),
    render: Object.freeze(render),
    required_checks: Object.freeze(required_checks),
  });
}
