import crypto from "node:crypto";

const BINDING_SCHEMA = "mcp_collaboration_action_binding_v1";
const CORE_SCHEMA = "mcp_collaboration_core_grant_v1";
const NYRA_SCHEMA = "mcp_collaboration_nyra_attestation_v1";
const DEFAULT_MAX_TTL_MS = 30_000;
const DEFAULT_CLOCK_SKEW_MS = 5_000;

const BINDING_KEYS = Object.freeze([
  "schema_version", "audience", "target_service", "target_environment", "target_commit",
  "tenant_id", "actor_subject_sha256", "agent_id", "session_id", "session_fingerprint",
  "agent_signature_sha256", "trace_id", "preflight_id", "task_contract_id", "task_trace_id",
  "coordination_lock", "shared_memory_checksum", "tool_name", "action_type", "target",
  "payload_sha256", "expected_version", "lock_id", "fencing_token", "idempotency_key_sha256",
]);
const NYRA_CLAIM_KEYS = Object.freeze([
  "schema_version", "issuer", "audience", "kid", "role", "decision", "execution_allowed",
  "binding_digest", "jti", "issued_at", "expires_at", "nonce",
]);
const CORE_CLAIM_KEYS = Object.freeze([
  "schema_version", "issuer", "audience", "kid", "role", "decision", "execution_allowed",
  "binding_digest", "core_decision_digest", "nyra_attestation_digest", "jti", "issued_at", "expires_at", "nonce",
]);
const DECISION_KEYS = Object.freeze([
  "schema_version", "binding_digest", "allowed", "decision", "mediation", "confirmation_satisfied",
]);
const JWK_KEYS = Object.freeze(["alg", "crv", "kid", "kty", "use", "x"]);
const RECEIPTED_ACTION_TYPES = new Set([
  "agent.heartbeat",
  "task.create", "task.claim", "task.update",
  "message.post", "message.acknowledge",
  "workspace.create_folder", "workspace.write_document",
  "workspace.lock_acquire", "workspace.lock_renew", "workspace.lock_release",
  "memory.append", "memory.checkpoint", "memory.handoff", "memory.handoff_acknowledge",
  "canonical.bootstrap",
]);

export class CollaborationReceiptError extends Error {
  constructor(code) {
    super(code);
    this.name = "CollaborationReceiptError";
    this.code = code;
  }
}

function fail(code) {
  throw new CollaborationReceiptError(code);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function collaborationCanonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("collaboration_receipt_non_canonical_value");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(collaborationCanonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => {
      if (value[key] === undefined) fail("collaboration_receipt_non_canonical_value");
      return `${JSON.stringify(key)}:${collaborationCanonicalJson(value[key])}`;
    }).join(",")}}`;
  }
  fail("collaboration_receipt_non_canonical_value");
}

export function collaborationDigest(label, value) {
  return crypto.createHash("sha256")
    .update(String(label))
    .update("\0")
    .update(collaborationCanonicalJson(value))
    .digest("hex");
}

export function collaborationReceiptRequired(config, action) {
  return config?.collaborationReceiptEnforcement === true && RECEIPTED_ACTION_TYPES.has(String(action?.action_type || ""));
}

function requiredString(value, code, maxLength = 240, pattern = null) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength || (pattern && !pattern.test(normalized))) fail(code);
  return normalized;
}

function nullableString(value, code, maxLength = 240, pattern = null) {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, code, maxLength, pattern);
}

function exactDigest(value, code) {
  return requiredString(value, code, 64, /^[a-f0-9]{64}$/);
}

function exactUuid(value, code) {
  return requiredString(value, code, 36, /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
}

function publicKeyFingerprint(key) {
  const spki = key.export({ format: "der", type: "spki" });
  return `ed25519-sha256:${crypto.createHash("sha256").update(spki).digest("hex")}`;
}

function parseTrustAnchor(value, expectedKid, authority) {
  let jwk = value;
  if (typeof value === "string") {
    try { jwk = JSON.parse(value); } catch { fail(`${authority}_collaboration_jwk_invalid`); }
  }
  if (!exactKeys(jwk, JWK_KEYS) || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" ||
      jwk.alg !== "EdDSA" || jwk.use !== "sig" || jwk.kid !== expectedKid ||
      !/^[A-Za-z0-9_-]{43}$/.test(String(jwk.x || ""))) {
    fail(`${authority}_collaboration_jwk_invalid`);
  }
  let key;
  try { key = crypto.createPublicKey({ key: jwk, format: "jwk" }); }
  catch { fail(`${authority}_collaboration_jwk_invalid`); }
  if (publicKeyFingerprint(key) !== expectedKid) fail(`${authority}_collaboration_kid_mismatch`);
  return key;
}

function normalizeVersion(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail("collaboration_receipt_expected_version_invalid");
  return parsed;
}

function normalizeFence(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail("collaboration_receipt_fencing_token_invalid");
  return parsed;
}

export function createCollaborationActionBinding(config, action, identity) {
  const governance = identity?.governanceContext || {};
  const presence = identity?.agentPresence || {};
  const subject = requiredString(identity?.subject, "collaboration_receipt_subject_required", 500);
  const binding = {
    schema_version: BINDING_SCHEMA,
    audience: requiredString(config.collaborationReceiptAudience || config.resource, "collaboration_receipt_audience_required", 500),
    target_service: requiredString(config.collaborationTargetService, "collaboration_receipt_target_service_required", 120, /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,119}$/),
    target_environment: requiredString(config.collaborationTargetEnvironment, "collaboration_receipt_target_environment_required", 40, /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,39}$/),
    target_commit: requiredString(config.collaborationBuildCommit, "collaboration_receipt_target_commit_required", 40, /^[a-f0-9]{40}$/i).toLowerCase(),
    tenant_id: requiredString(identity?.tenantId, "collaboration_receipt_tenant_required", 64, /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/),
    actor_subject_sha256: crypto.createHash("sha256").update(subject).digest("hex"),
    agent_id: requiredString(presence.agent_id, "collaboration_receipt_agent_required", 64, /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/),
    session_id: requiredString(presence.session_id, "collaboration_receipt_session_required", 64, /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/),
    session_fingerprint: requiredString(presence.session_fingerprint, "collaboration_receipt_session_fingerprint_required", 128, /^[a-zA-Z0-9_-]{16,128}$/),
    agent_signature_sha256: crypto.createHash("sha256")
      .update(requiredString(presence.signature, "collaboration_receipt_agent_signature_required", 500))
      .digest("hex"),
    trace_id: exactUuid(governance.trace_id, "collaboration_receipt_trace_required"),
    preflight_id: requiredString(governance.preflight_id, "collaboration_receipt_preflight_required", 160, /^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,159}$/),
    task_contract_id: requiredString(governance.task_contract_id, "collaboration_receipt_task_contract_required", 240),
    task_trace_id: requiredString(governance.task_trace_id, "collaboration_receipt_task_trace_required", 240),
    coordination_lock: requiredString(governance.coordination_lock, "collaboration_receipt_coordination_lock_required", 240),
    shared_memory_checksum: exactDigest(governance.shared_memory_checksum, "collaboration_receipt_shared_memory_checksum_required"),
    tool_name: requiredString(governance.tool_name, "collaboration_receipt_tool_required", 120, /^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,119}$/),
    action_type: requiredString(action?.action_type, "collaboration_receipt_action_type_required", 120, /^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,119}$/),
    target: requiredString(action?.target, "collaboration_receipt_target_required", 500),
    payload_sha256: exactDigest(action?.payload_sha256, "collaboration_receipt_payload_digest_required"),
    expected_version: normalizeVersion(action?.expected_version),
    lock_id: action?.lock_id == null || action.lock_id === ""
      ? null
      : exactUuid(action.lock_id, "collaboration_receipt_lock_id_invalid"),
    fencing_token: normalizeFence(action?.fencing_token),
    idempotency_key_sha256: action?.idempotency_key_sha256 == null
      ? null
      : exactDigest(action.idempotency_key_sha256, "collaboration_receipt_idempotency_digest_invalid"),
  };
  if ((binding.lock_id === null) !== (binding.fencing_token === null)) fail("collaboration_receipt_lock_fence_mismatch");
  return Object.freeze(binding);
}

function verifyEnvelope(envelope, anchor, claimKeys, code) {
  if (!exactKeys(envelope, ["claims", "signature"]) || !exactKeys(envelope.claims, claimKeys) ||
      typeof envelope.signature !== "string") fail(code);
  let signature;
  try {
    signature = Buffer.from(envelope.signature, "base64url");
    if (signature.length !== 64 || signature.toString("base64url") !== envelope.signature) fail(code);
  } catch { fail(code); }
  const valid = crypto.verify(null, Buffer.from(collaborationCanonicalJson(envelope.claims), "utf8"), anchor, signature);
  if (!valid) fail(code);
  return envelope.claims;
}

function validateTimes(claims, nowMs, maxTtlMs, clockSkewMs, code) {
  const issuedAt = Date.parse(claims.issued_at);
  const expiresAt = Date.parse(claims.expires_at);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
      new Date(issuedAt).toISOString() !== claims.issued_at || new Date(expiresAt).toISOString() !== claims.expires_at ||
      issuedAt > nowMs + clockSkewMs || expiresAt <= nowMs || expiresAt <= issuedAt || expiresAt - issuedAt > maxTtlMs) {
    fail(code);
  }
  return { issuedAt, expiresAt };
}

function validateSharedClaims(claims, expected, bindingDigest, issuer, kid, nowMs, maxTtlMs, clockSkewMs, code) {
  if (claims.issuer !== issuer || claims.audience !== expected.audience || claims.kid !== kid ||
      claims.binding_digest !== bindingDigest ||
      !/^mcpcr_[A-Za-z0-9_-]{16,128}$/.test(String(claims.jti || "")) ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(String(claims.nonce || ""))) fail(code);
  return validateTimes(claims, nowMs, maxTtlMs, clockSkewMs, code);
}

export function createCollaborationReceiptVerifier(options = {}) {
  const coreKid = requiredString(options.coreKid, "core_collaboration_kid_required", 96);
  const nyraKid = requiredString(options.nyraKid, "nyra_collaboration_kid_required", 96);
  if (coreKid === nyraKid) fail("collaboration_receipt_independent_keys_required");
  const coreAnchor = parseTrustAnchor(options.coreJwk, coreKid, "core");
  const nyraAnchor = parseTrustAnchor(options.nyraJwk, nyraKid, "nyra");
  const coreIssuer = requiredString(options.coreIssuer || "universal-core-staging", "core_collaboration_issuer_required", 120);
  const nyraIssuer = requiredString(options.nyraIssuer || "nyra-staging", "nyra_collaboration_issuer_required", 120);
  if (coreIssuer === nyraIssuer) fail("collaboration_receipt_independent_issuers_required");
  const expectedScope = Object.freeze({
    tenant_id: requiredString(options.expectedTenantId, "collaboration_receipt_expected_tenant_required", 64, /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/),
    target_service: requiredString(options.expectedTargetService, "collaboration_receipt_expected_service_required", 120, /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,119}$/),
    target_environment: requiredString(options.expectedTargetEnvironment, "collaboration_receipt_expected_environment_required", 40, /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,39}$/),
    target_commit: requiredString(options.expectedTargetCommit, "collaboration_receipt_expected_commit_required", 40, /^[a-f0-9]{40}$/i).toLowerCase(),
  });
  const maxTtlMs = Math.min(Math.max(Number(options.maxTtlMs || DEFAULT_MAX_TTL_MS), 1_000), DEFAULT_MAX_TTL_MS);
  const clockSkewMs = Math.min(Math.max(Number(options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS), 0), 10_000);
  const now = typeof options.now === "function" ? options.now : Date.now;

  return Object.freeze({
    ready: true,
    async verify(bundle, { config, action, identity } = {}) {
      if (!exactKeys(bundle, ["binding", "decision", "core", "nyra"]) ||
          !exactKeys(bundle.binding, BINDING_KEYS) || !exactKeys(bundle.decision, DECISION_KEYS)) {
        fail("collaboration_receipt_bundle_invalid");
      }
      const expected = createCollaborationActionBinding(config, action, identity);
      if (expected.tenant_id !== expectedScope.tenant_id ||
          expected.target_service !== expectedScope.target_service ||
          expected.target_environment !== expectedScope.target_environment ||
          expected.target_commit !== expectedScope.target_commit) {
        fail("collaboration_receipt_scope_mismatch");
      }
      if (collaborationCanonicalJson(bundle.binding) !== collaborationCanonicalJson(expected)) {
        fail("collaboration_receipt_binding_mismatch");
      }
      const bindingDigest = collaborationDigest("mcp-collaboration-binding-v1", bundle.binding);
      if (bundle.decision.schema_version !== "mcp_collaboration_core_decision_v1" ||
          bundle.decision.binding_digest !== bindingDigest || bundle.decision.allowed !== true ||
          typeof bundle.decision.decision !== "string" || !bundle.decision.decision ||
          typeof bundle.decision.mediation !== "string" || !bundle.decision.mediation ||
          typeof bundle.decision.confirmation_satisfied !== "boolean" ||
          (["block", "blocked", "denied"].includes(bundle.decision.decision) ||
           ["hard_block", "block", "denied"].includes(bundle.decision.mediation))) {
        fail("collaboration_receipt_core_decision_invalid");
      }
      const coreDecisionDigest = collaborationDigest("mcp-collaboration-core-decision-v1", bundle.decision);
      const timestamp = Number(now());
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) fail("collaboration_receipt_clock_invalid");

      const nyra = verifyEnvelope(bundle.nyra, nyraAnchor, NYRA_CLAIM_KEYS, "nyra_collaboration_signature_invalid");
      const nyraTimes = validateSharedClaims(
        nyra, expected, bindingDigest, nyraIssuer, nyraKid, timestamp, maxTtlMs, clockSkewMs,
        "nyra_collaboration_claims_invalid",
      );
      if (nyra.schema_version !== NYRA_SCHEMA || nyra.role !== "advisory_veto" ||
          nyra.decision !== "no_objection" || nyra.execution_allowed !== false) {
        fail("nyra_collaboration_claims_invalid");
      }
      const nyraDigest = collaborationDigest("mcp-collaboration-nyra-envelope-v1", bundle.nyra);

      const core = verifyEnvelope(bundle.core, coreAnchor, CORE_CLAIM_KEYS, "core_collaboration_signature_invalid");
      const coreTimes = validateSharedClaims(
        core, expected, bindingDigest, coreIssuer, coreKid, timestamp, maxTtlMs, clockSkewMs,
        "core_collaboration_claims_invalid",
      );
      if (core.schema_version !== CORE_SCHEMA || core.role !== "final_authority" || core.decision !== "allow" ||
          core.execution_allowed !== true || core.core_decision_digest !== coreDecisionDigest ||
          core.nyra_attestation_digest !== nyraDigest || core.jti !== nyra.jti) {
        fail("core_collaboration_claims_invalid");
      }

      return Object.freeze({
        schema_version: "mcp_collaboration_verified_receipt_v1",
        tenant_id: expected.tenant_id,
        jti: core.jti,
        binding_digest: bindingDigest,
        receipt_digest: collaborationDigest("mcp-collaboration-receipt-v1", bundle),
        issued_at: new Date(Math.max(coreTimes.issuedAt, nyraTimes.issuedAt)).toISOString(),
        expires_at: new Date(Math.min(coreTimes.expiresAt, nyraTimes.expiresAt)).toISOString(),
        authorities: Object.freeze([
          Object.freeze({ issuer: core.issuer, kid: core.kid, receipt_digest: collaborationDigest("mcp-collaboration-core-envelope-v1", bundle.core) }),
          Object.freeze({ issuer: nyra.issuer, kid: nyra.kid, receipt_digest: nyraDigest }),
        ]),
      });
    },
  });
}

export async function consumeCollaborationReceipt(client, identity, evidence) {
  if (!exactKeys(evidence, [
    "schema_version", "tenant_id", "jti", "binding_digest", "receipt_digest",
    "issued_at", "expires_at", "authorities",
  ]) || evidence.schema_version !== "mcp_collaboration_verified_receipt_v1" ||
      evidence.tenant_id !== identity?.tenantId || !Array.isArray(evidence.authorities) || evidence.authorities.length !== 2) {
    fail("collaboration_receipt_evidence_invalid");
  }
  const [first, second] = evidence.authorities;
  const issuedAt = Date.parse(evidence.issued_at);
  const expiresAt = Date.parse(evidence.expires_at);
  if (!exactKeys(first, ["issuer", "kid", "receipt_digest"]) ||
      !exactKeys(second, ["issuer", "kid", "receipt_digest"]) ||
      !/^mcpcr_[A-Za-z0-9_-]{16,128}$/.test(String(evidence.jti || "")) ||
      !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt ||
      expiresAt - issuedAt > DEFAULT_MAX_TTL_MS ||
      new Date(issuedAt).toISOString() !== evidence.issued_at ||
      new Date(expiresAt).toISOString() !== evidence.expires_at) {
    fail("collaboration_receipt_evidence_invalid");
  }
  exactDigest(evidence.receipt_digest, "collaboration_receipt_digest_invalid");
  if (first.issuer === second.issuer || first.kid === second.kid) fail("collaboration_receipt_independent_authorities_required");
  const result = await client.query(
    `SELECT consumed_issuer AS issuer
     FROM mcp_collaboration_control.consume_receipt_pair(
       $1::varchar,$2::varchar,$3::char(64),$4::timestamptz,$5::timestamptz,
       $6::varchar,$7::char(64),$8::varchar,$9::char(64)
     )`,
    [
      evidence.tenant_id,
      evidence.jti,
      exactDigest(evidence.binding_digest, "collaboration_receipt_binding_digest_invalid"),
      evidence.issued_at,
      evidence.expires_at,
      first.issuer,
      exactDigest(first.receipt_digest, "collaboration_receipt_digest_invalid"),
      second.issuer,
      exactDigest(second.receipt_digest, "collaboration_receipt_digest_invalid"),
    ],
  );
  if (result.rowCount !== 2) fail("collaboration_receipt_expired_or_replayed");
  return {
    jti_sha256: crypto.createHash("sha256").update(evidence.jti).digest("hex"),
    receipt_digest: evidence.receipt_digest,
    binding_digest: evidence.binding_digest,
    authorities: evidence.authorities.map(({ issuer, kid }) => ({ issuer, kid })),
  };
}

export const collaborationReceiptContract = Object.freeze({
  binding_schema: BINDING_SCHEMA,
  core_schema: CORE_SCHEMA,
  nyra_schema: NYRA_SCHEMA,
  max_ttl_ms: DEFAULT_MAX_TTL_MS,
  action_types: Object.freeze([...RECEIPTED_ACTION_TYPES]),
});
