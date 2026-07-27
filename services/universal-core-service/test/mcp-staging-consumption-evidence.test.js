import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createMcpStagingConsumptionEvidenceVerifier,
} from "../src/mcpStagingConsumptionEvidence.js";
import {
  issueMcpStagingCredentialReceipt,
  issueMcpStagingOwnerConfirmation,
  mcpStagingCanonicalJson,
  mcpStagingEvidenceDigest,
} from "../src/mcpStagingEvidence.js";

const NOW = Date.parse("2026-07-19T15:00:00.000Z");
const TARGET_COMMIT = crypto.randomBytes(20).toString("hex");

function keyMaterial() {
  const pair = crypto.generateKeyPairSync("ed25519");
  const kid = `ed25519-sha256:${crypto.createHash("sha256")
    .update(pair.publicKey.export({ format: "der", type: "spki" })).digest("hex")}`;
  const exported = pair.publicKey.export({ format: "jwk" });
  return {
    ...pair,
    descriptor: {
      jwkJson: JSON.stringify({
        alg: "EdDSA", crv: "Ed25519", kid, kty: "OKP", use: "sig", x: exported.x,
      }),
      expectedKid: kid,
    },
  };
}

function signedEnvelope(claims, privateKey) {
  return {
    claims,
    signature: crypto.sign(
      null,
      Buffer.from(mcpStagingCanonicalJson(claims), "utf8"),
      privateKey,
    ).toString("base64url"),
  };
}

function fixture({ expired = false, future = false } = {}) {
  const keys = {
    receipt: keyMaterial(),
    owner: keyMaterial(),
    core: keyMaterial(),
    nyra: keyMaterial(),
  };
  const issuedMs = future ? NOW + 1_000 : expired ? NOW - 31_000 : NOW - 1_000;
  const expiresMs = future ? NOW + 20_000 : expired ? NOW - 1_000 : NOW + 20_000;
  const longIssuedMs = future ? NOW + 1_000 : expired ? NOW - 60_000 : NOW - 1_000;
  const longExpiresMs = future ? NOW + 60_000 : expired ? NOW - 1_000 : NOW + 60_000;
  const actionDigest = "6".repeat(64);
  const credentialActionDigest = "8".repeat(64);
  const binding = {
    execution_id: "skinharmony-core-mcp-staging-render-create-v1",
    attempt_id: "mcpstg_11111111-2222-4333-8444-555555555555",
    action_digest: actionDigest,
    executor_contract_id: `domain_action_${actionDigest.slice(0, 20)}`,
    deployment_spec_digest: "1".repeat(64),
    preflight_digest: "2".repeat(64),
    credential_grant_digest: "",
    core_grant_digest: "",
    nyra_attestation_digest: "",
    owner_confirmation_digest: "",
  };
  const credentialReceipt = issueMcpStagingCredentialReceipt({
    receipt_id: "mcpstg_receipt_0123456789abcdef",
    credential_execution_id: "mcp-staging-credentials-20260719-01",
    issued_at: new Date(longIssuedMs).toISOString(),
    expires_at: new Date(longExpiresMs).toISOString(),
    core_key_handle_digest: "5".repeat(64),
  }, keys.receipt.privateKey, { targetCommit: TARGET_COMMIT });
  binding.credential_grant_digest = credentialReceipt.claims.binding_digest;
  const ownerConfirmation = issueMcpStagingOwnerConfirmation({
    confirmation_reference: "owner_mcp_staging_dependencies_20260719",
    authorization_text_digest: "7".repeat(64),
    attempt_id: binding.attempt_id,
    deployment_spec_digest: binding.deployment_spec_digest,
    preflight_digest: binding.preflight_digest,
    credential_grant_digest: binding.credential_grant_digest,
    action_digest: binding.action_digest,
    executor_contract_id: binding.executor_contract_id,
    issued_at: new Date(longIssuedMs).toISOString(),
    expires_at: new Date(longExpiresMs).toISOString(),
    nonce: "owner_confirmation_nonce_20260719",
  }, keys.owner.privateKey, { targetCommit: TARGET_COMMIT });
  binding.owner_confirmation_digest = ownerConfirmation.claims.owner_confirmation_digest;
  const common = {
    audience: "mcp-staging-render-executor",
    request_kind: "issue",
    tenant_id: "codexai",
    domain_pack_id: "skinharmony",
    target_service: "skinharmony-core-mcp-staging",
    target_environment: "staging",
    target_commit: TARGET_COMMIT,
    attempt_id: binding.attempt_id,
    deployment_spec_digest: binding.deployment_spec_digest,
    preflight_digest: binding.preflight_digest,
    credential_grant_digest: binding.credential_grant_digest,
    action_digest: binding.action_digest,
    executor_contract_id: binding.executor_contract_id,
    issued_at: new Date(issuedMs).toISOString(),
    expires_at: new Date(expiresMs).toISOString(),
  };
  const nyraAttestation = signedEnvelope({
    schema_version: "nyra_mcp_staging_deploy_attestation_v1",
    issuer: "nyra",
    ...common,
    decision: "no_objection",
    role: "advisory_veto",
    execution_allowed: false,
    risk_band: "bounded_staging",
    nonce: "N".repeat(32),
  }, keys.nyra.privateKey);
  binding.nyra_attestation_digest = mcpStagingEvidenceDigest(
    "mcp-staging-nyra-attestation-v1",
    nyraAttestation,
  );
  const coreGrant = signedEnvelope({
    schema_version: "core_mcp_staging_render_grant_v1",
    issuer: "universal-core",
    ...common,
    decision: "allow",
    state: "authorized_after_confirmation",
    scope: "reversible_owner_confirmed_mcp_staging_service",
    domain_action_id: "skinharmony_mcp_staging_render_create_v1",
    core_key_id: `key_staging-${credentialReceipt.claims.core_key_handle_digest.slice(0, 16)}`,
    core_key_type: "staging_executor",
    core_key_scope: "mcp_staging_render_create",
    credential_execution_id: credentialReceipt.claims.credential_execution_id,
    credential_action_digest: credentialActionDigest,
    credential_executor_contract_id: `domain_action_${credentialActionDigest.slice(0, 20)}`,
    credential_receipt_verified: true,
    nyra_attestation_digest: binding.nyra_attestation_digest,
    confirmation_reference: ownerConfirmation.claims.confirmation_reference,
    owner_confirmation_digest: ownerConfirmation.claims.owner_confirmation_digest,
    confirmation_satisfied: true,
    revalidation_required: true,
    nyra_available: true,
    nonce: "C".repeat(32),
  }, keys.core.privateKey);
  binding.core_grant_digest = mcpStagingEvidenceDigest("mcp-staging-core-grant-v1", coreGrant);
  const options = {
    receipt: keys.receipt.descriptor,
    owner: keys.owner.descriptor,
    core: keys.core.descriptor,
    nyra: keys.nyra.descriptor,
    now: () => NOW,
    targetCommit: TARGET_COMMIT,
  };
  return {
    keys,
    options,
    input: {
      credential_receipt: credentialReceipt,
      owner_confirmation: ownerConfirmation,
      core_grant: coreGrant,
      nyra_attestation: nyraAttestation,
      consumption: binding,
    },
  };
}

test("verifies four independently pinned signatures and returns only redacted normalized evidence", async () => {
  const value = fixture();
  const verified = await createMcpStagingConsumptionEvidenceVerifier(value.options)(value.input);
  assert.equal(verified.temporally_current, true);
  assert.equal(verified.receipt_evidence.signature_verified, true);
  assert.equal(verified.consumption.core_grant_digest,
    mcpStagingEvidenceDigest("mcp-staging-core-grant-v1", value.input.core_grant));
  assert.equal(verified.consumption.nyra_attestation_digest,
    mcpStagingEvidenceDigest("mcp-staging-nyra-attestation-v1", value.input.nyra_attestation));
  assert.equal(verified.consumption.owner_confirmation_digest,
    value.input.owner_confirmation.claims.owner_confirmation_digest);
  assert.deepEqual(Object.keys(verified).sort(), ["consumption", "receipt_evidence", "temporally_current"]);
  assert.equal(JSON.stringify(verified).includes("signature"), true);
  assert.equal(JSON.stringify(verified).includes(value.input.core_grant.signature), false);
  assert.equal(JSON.stringify(verified).includes(value.input.owner_confirmation.claims.authorization_text_digest), false);
});

test("rejects non-independent anchors, tamper, readiness grants and changed cross-bindings", async () => {
  const value = fixture();
  assert.throws(() => createMcpStagingConsumptionEvidenceVerifier({
    ...value.options,
    nyra: value.options.core,
  }), /consumption_trust_anchors_not_independent/);

  const verify = createMcpStagingConsumptionEvidenceVerifier(value.options);
  const tampered = structuredClone(value.input);
  tampered.core_grant.claims.target_environment = "production";
  await assert.rejects(verify(tampered), /core_grant_signature_invalid/);

  const readiness = fixture();
  readiness.input.nyra_attestation.claims.request_kind = "readiness_probe";
  readiness.input.nyra_attestation = signedEnvelope(
    readiness.input.nyra_attestation.claims,
    readiness.keys.nyra.privateKey,
  );
  readiness.input.consumption.nyra_attestation_digest = mcpStagingEvidenceDigest(
    "mcp-staging-nyra-attestation-v1",
    readiness.input.nyra_attestation,
  );
  await assert.rejects(
    createMcpStagingConsumptionEvidenceVerifier(readiness.options)(readiness.input),
    /nyra_grant_binding_invalid/,
  );

  const rebound = fixture();
  rebound.input.consumption.preflight_digest = "9".repeat(64);
  await assert.rejects(
    createMcpStagingConsumptionEvidenceVerifier(rebound.options)(rebound.input),
    /consumption_cross_binding_invalid/,
  );
});

test("allows expired signed evidence only as a non-current idempotent replay candidate and rejects future issue", async () => {
  const expired = fixture({ expired: true });
  const result = await createMcpStagingConsumptionEvidenceVerifier(expired.options)(expired.input);
  assert.equal(result.temporally_current, false);

  const future = fixture({ future: true });
  await assert.rejects(
    createMcpStagingConsumptionEvidenceVerifier(future.options)(future.input),
    /consumption_base_evidence_invalid/,
  );
});
