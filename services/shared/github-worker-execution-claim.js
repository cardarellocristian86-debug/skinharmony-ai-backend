import crypto from "node:crypto";

export const GITHUB_WORKER_EXECUTION_CLAIM_VERSION = "github_worker_execution_claim_v1";

const SHA256 = /^[a-f0-9]{64}$/;
const REPOSITORY = /^[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ALLOWED_ACTIONS = new Set([
  "git.push.branch",
  "github.draft_pr",
  "github.ready",
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  if (Object.keys(value).some((key) => !keys.has(key))) fail(code);
}

function text(value, code, max = 240) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > max) fail(code);
  return value;
}

function digest(value, code) {
  const result = text(value, code, 64);
  if (!SHA256.test(result)) fail(code);
  return result;
}

function timestamp(value, code) {
  const result = text(value, code, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result) || !Number.isFinite(Date.parse(result))) fail(code);
  return result;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function secret(value) {
  const result = text(value, "github_worker_execution_secret_invalid", 8_000);
  if (Buffer.byteLength(result, "utf8") < 32) fail("github_worker_execution_secret_invalid");
  return result;
}

function unsignedClaim(value) {
  exactKeys(value, new Set([
    "schema_version", "tenant_id", "work_id", "repository", "ticket_id", "reservation_id",
    "action", "action_digest", "issued_at", "expires_at", "nonce", "provider_execution",
  ]), "github_worker_execution_claim_invalid");
  if (value.schema_version !== GITHUB_WORKER_EXECUTION_CLAIM_VERSION || value.provider_execution !== false) {
    fail("github_worker_execution_claim_invalid");
  }
  const tenantId = text(value.tenant_id, "github_worker_execution_tenant_invalid", 120);
  const workId = text(value.work_id, "github_worker_execution_work_invalid", 80);
  if (!UUID.test(workId)) fail("github_worker_execution_work_invalid");
  const repository = text(value.repository, "github_worker_execution_repository_invalid", 202);
  if (!REPOSITORY.test(repository)) fail("github_worker_execution_repository_invalid");
  const action = value.action;
  if (!action || typeof action !== "object" || Array.isArray(action) || !ALLOWED_ACTIONS.has(action.kind) ||
      action.provider_execution !== false || action.repository !== repository) {
    fail("github_worker_execution_action_invalid");
  }
  if (value.action_digest !== crypto.createHash("sha256").update(canonical(action)).digest("hex")) {
    fail("github_worker_execution_action_digest_mismatch");
  }
  return Object.freeze({
    schema_version: value.schema_version,
    tenant_id: tenantId,
    work_id: workId,
    repository,
    ticket_id: text(value.ticket_id, "github_worker_execution_ticket_invalid"),
    reservation_id: text(value.reservation_id, "github_worker_execution_reservation_invalid"),
    action: structuredClone(action),
    action_digest: digest(value.action_digest, "github_worker_execution_action_digest_invalid"),
    issued_at: timestamp(value.issued_at, "github_worker_execution_time_invalid"),
    expires_at: timestamp(value.expires_at, "github_worker_execution_time_invalid"),
    nonce: digest(value.nonce, "github_worker_execution_nonce_invalid"),
    provider_execution: false,
  });
}

export function signGitHubWorkerExecutionClaim(value, { signing_secret } = {}) {
  const claim = unsignedClaim(value);
  const signature = `gwe_${crypto.createHmac("sha256", secret(signing_secret)).update(canonical(claim)).digest("hex")}`;
  return Object.freeze({ ...claim, signature });
}

export function verifyGitHubWorkerExecutionClaim(value, {
  signing_secret,
  now = Date.now(),
  allow_expired_for_reconciliation = false,
} = {}) {
  exactKeys(value, new Set([
    "schema_version", "tenant_id", "work_id", "repository", "ticket_id", "reservation_id",
    "action", "action_digest", "issued_at", "expires_at", "nonce", "provider_execution", "signature",
  ]), "github_worker_execution_claim_invalid");
  const { signature, ...unsigned } = value;
  const claim = unsignedClaim(unsigned);
  const expected = `gwe_${crypto.createHmac("sha256", secret(signing_secret)).update(canonical(claim)).digest("hex")}`;
  if (!safeEqual(signature, expected)) fail("github_worker_execution_claim_signature_invalid");
  const current = Number(typeof now === "function" ? now() : now);
  const issued = Date.parse(claim.issued_at);
  const expires = Date.parse(claim.expires_at);
  const expiredInvalid = allow_expired_for_reconciliation
    ? current - issued > 24 * 60 * 60_000
    : expires <= current;
  if (!Number.isFinite(current) || issued > current + 5_000 || expiredInvalid || expires - issued > 5 * 60_000) {
    fail("github_worker_execution_claim_expired");
  }
  return Object.freeze({ ...claim, signature });
}

export function githubWorkerActionDigest(action) {
  return crypto.createHash("sha256").update(canonical(action)).digest("hex");
}
