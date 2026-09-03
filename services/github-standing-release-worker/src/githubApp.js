import { createSign } from "node:crypto";
import { boundedJsonRequest } from "../../shared/bounded-json-request.js";
import { remainingWorkerRequestTimeout } from "./requestDeadline.js";

const TENANT = /^[a-z0-9][a-z0-9_-]{1,63}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactKeys(value, allowed, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(code);
}

function integer(value, code) {
  if (!Number.isSafeInteger(value) || value < 1) fail(code);
  return value;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function canonicalRepository(value) {
  const repository = String(value || "");
  if (!REPOSITORY.test(repository) || repository !== repository.toLowerCase()) {
    fail("github_app_repository_invalid");
  }
  return repository;
}

export function parseGitHubAppBindings(value) {
  let input;
  try {
    input = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    fail("github_app_bindings_invalid");
  }
  exactKeys(input, new Set(["schema_version", "bindings"]), "github_app_bindings_invalid");
  if (input.schema_version !== "github_app_tenant_bindings_v1" ||
      !Array.isArray(input.bindings) || input.bindings.length < 1 || input.bindings.length > 500) {
    fail("github_app_bindings_invalid");
  }
  const seenTenants = new Set();
  const seenInstallations = new Set();
  const bindings = input.bindings.map((binding) => {
    exactKeys(binding, new Set(["tenant_id", "installation_id", "repositories"]), "github_app_binding_invalid");
    const tenantId = String(binding.tenant_id || "");
    if (!TENANT.test(tenantId)) fail("github_app_tenant_invalid");
    const installationId = integer(binding.installation_id, "github_app_installation_invalid");
    if (!Array.isArray(binding.repositories) || binding.repositories.length < 1 || binding.repositories.length > 100) {
      fail("github_app_repositories_invalid");
    }
    const repositories = [...new Set(binding.repositories.map(canonicalRepository))].sort();
    if (repositories.length !== binding.repositories.length) fail("github_app_repositories_invalid");
    if (seenTenants.has(tenantId) || seenInstallations.has(installationId)) fail("github_app_binding_duplicate");
    seenTenants.add(tenantId);
    seenInstallations.add(installationId);
    return Object.freeze({ tenant_id: tenantId, installation_id: installationId, repositories: Object.freeze(repositories) });
  });
  return Object.freeze({ schema_version: input.schema_version, bindings: Object.freeze(bindings) });
}

export function resolveGitHubAppBinding(registry, { tenant_id, repository }) {
  const tenantId = String(tenant_id || "");
  if (!TENANT.test(tenantId)) fail("github_app_tenant_invalid");
  const repo = canonicalRepository(repository);
  const binding = registry.bindings.find((candidate) => candidate.tenant_id === tenantId);
  if (!binding || !binding.repositories.includes(repo)) fail("github_app_repository_not_authorized");
  return Object.freeze({ tenant_id: tenantId, installation_id: binding.installation_id, repository: repo });
}

export function createGitHubAppJwt({ app_id, private_key, now = Date.now() }) {
  const appId = integer(app_id, "github_app_id_invalid");
  if (typeof private_key !== "string" || !private_key.includes("BEGIN") || private_key.length > 20_000) {
    fail("github_app_private_key_invalid");
  }
  const nowSeconds = Math.floor(Number(now) / 1000);
  if (!Number.isSafeInteger(nowSeconds)) fail("github_app_clock_invalid");
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: nowSeconds - 30, exp: nowSeconds + 540, iss: String(appId) }));
  const signingInput = `${header}.${payload}`;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    return `${signingInput}.${signer.sign(private_key).toString("base64url")}`;
  } catch {
    fail("github_app_private_key_invalid");
  }
}

export function createGitHubInstallationTokenResolver({
  app_id,
  private_key,
  bindings,
  fetch_impl = fetch,
  now = Date.now,
  request_timeout_ms = 8_000,
  response_limit_bytes = 1024 * 1024,
}) {
  if (typeof fetch_impl !== "function" || typeof now !== "function") fail("github_app_resolver_invalid");
  const registry = parseGitHubAppBindings(bindings);
  const cache = new Map();
  return async function installationToken({ tenant_id, repository }, { deadline = null } = {}) {
    const binding = resolveGitHubAppBinding(registry, { tenant_id, repository });
    const cacheKey = `${binding.tenant_id}\u0000${binding.installation_id}\u0000${binding.repository}`;
    const cached = cache.get(cacheKey);
    const current = Number(now());
    if (cached && cached.expires_at_ms - current > 60_000) return cached.token;
    const jwt = createGitHubAppJwt({ app_id, private_key, now: current });
    const { response, payload: body } = await boundedJsonRequest(
      `https://api.github.com/app/installations/${binding.installation_id}/access_tokens`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
          "user-agent": "skinharmony-standing-release-worker/1",
          "x-github-api-version": "2022-11-28",
        },
        body: JSON.stringify({ repositories: [binding.repository.split("/")[1]], permissions: {} }),
      },
      {
        fetchImpl: fetch_impl,
        timeoutMs: remainingWorkerRequestTimeout(deadline, request_timeout_ms),
        maxResponseBytes: response_limit_bytes,
        errorCodes: {
          timeout: "github_api_request_timeout",
          too_large: "github_api_response_too_large",
          invalid: "github_api_response_invalid",
          unavailable: "github_api_unavailable",
        },
      },
    );
    if (!response?.ok) fail("github_app_installation_token_unavailable");
    if (!body || typeof body.token !== "string" || body.token.length < 20 ||
        typeof body.expires_at !== "string" || !Number.isFinite(Date.parse(body.expires_at)) ||
        Date.parse(body.expires_at) <= current + 60_000) {
      fail("github_app_installation_token_invalid");
    }
    if (Array.isArray(body.repositories) &&
        !body.repositories.some((entry) => String(entry?.full_name || "").toLowerCase() === binding.repository)) {
      fail("github_app_installation_repository_mismatch");
    }
    cache.set(cacheKey, { token: body.token, expires_at_ms: Date.parse(body.expires_at) });
    return body.token;
  };
}

export function validateExecutionClaimShape(claim) {
  exactKeys(claim, new Set([
    "schema_version", "tenant_id", "repository", "ticket_id", "action_digest", "expires_at",
  ]), "github_worker_claim_invalid");
  if (claim.schema_version !== "standing_release_execution_claim_v1" ||
      !TENANT.test(String(claim.tenant_id || "")) ||
      !SHA256.test(String(claim.action_digest || "")) ||
      typeof claim.ticket_id !== "string" || claim.ticket_id.length < 8 || claim.ticket_id.length > 220 ||
      !Number.isFinite(Date.parse(claim.expires_at))) fail("github_worker_claim_invalid");
  canonicalRepository(claim.repository);
  return Object.freeze({ ...claim });
}
