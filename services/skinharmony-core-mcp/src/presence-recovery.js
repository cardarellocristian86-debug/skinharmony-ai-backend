export const PRESENCE_RECOVERY_AUTHORITY = "agent:presence:recover";
export const PRESENCE_RECOVERY_MAX_TTL_MS = 10 * 60 * 1_000;

const REQUIRED_CONSTRAINTS = Object.freeze([
  "presence_only",
  "no_host_action",
  "no_publish",
  "no_deploy",
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, code) {
  if (!plain(value)) fail(code);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    fail(code);
  }
}

function unwrapValidation(value) {
  const structured = value?.structuredContent || value;
  return structured?.result || structured;
}

export async function authorizePresenceRecovery({
  recoveryContext,
  identity,
  agentId,
  environment,
  customMetadata = false,
  validateContext,
  now = () => new Date(),
} = {}) {
  if (customMetadata) fail("presence_recovery_metadata_denied");
  if (typeof validateContext !== "function") fail("presence_recovery_verifier_unavailable");
  exactKeys(recoveryContext, ["envelope", "signature"], "presence_recovery_context_invalid");
  const envelope = recoveryContext.envelope;
  if (!plain(envelope) || envelope.schema_version !== "causal_context_envelope_v1") {
    fail("presence_recovery_context_invalid");
  }
  const tenantId = String(identity?.tenantId || "");
  const expectedEnvironment = String(environment || "");
  if (!tenantId || envelope.tenant_id !== tenantId || envelope.actor_id !== agentId ||
      !expectedEnvironment || envelope.environment !== expectedEnvironment) {
    fail("presence_recovery_binding_mismatch");
  }
  if (!Array.isArray(envelope.authority_scope) || envelope.authority_scope.length !== 1 ||
      envelope.authority_scope[0] !== PRESENCE_RECOVERY_AUTHORITY) {
    fail("presence_recovery_authority_invalid");
  }
  const constraints = new Set(Array.isArray(envelope.inherited_constraints)
    ? envelope.inherited_constraints.map(String)
    : []);
  if (REQUIRED_CONSTRAINTS.some((constraint) => !constraints.has(constraint))) {
    fail("presence_recovery_constraints_missing");
  }
  if (Array.isArray(envelope.gallery_ticket_ids) && envelope.gallery_ticket_ids.length > 0) {
    fail("presence_recovery_ticket_binding_denied");
  }
  if (!envelope.work_id || !envelope.change_id || !envelope.genesis_intent_id ||
      !envelope.intent_revision_id || !envelope.context_digest) {
    fail("presence_recovery_causal_binding_missing");
  }
  const issuedAt = Date.parse(envelope.issued_at || "");
  const expiresAt = Date.parse(envelope.expires_at || "");
  const nowValue = now().getTime();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > nowValue ||
      expiresAt <= nowValue || expiresAt - issuedAt > PRESENCE_RECOVERY_MAX_TTL_MS) {
    fail("presence_recovery_expired");
  }
  const validation = unwrapValidation(await validateContext({
    envelope,
    signature: recoveryContext.signature,
    consume: true,
    expected_environment: expectedEnvironment,
    required_authority: PRESENCE_RECOVERY_AUTHORITY,
  }, identity));
  if (!plain(validation) || validation.valid !== true || validation.consumed !== true ||
      validation.context_digest !== envelope.context_digest ||
      validation.work_id !== envelope.work_id || validation.change_id !== envelope.change_id ||
      validation.project_id !== envelope.project_id) {
    fail("presence_recovery_verification_failed");
  }
  return {
    allowed: true,
    decision: "allow_causal_presence_recovery",
    mediation: "consumed_causal_context",
    confirmation_satisfied: true,
    recovery_context_digest: envelope.context_digest,
    recovery_work_id: envelope.work_id,
    recovery_change_id: envelope.change_id,
  };
}
