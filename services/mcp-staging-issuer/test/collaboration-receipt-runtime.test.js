import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import {
  collaborationReceiptCanonicalJson,
  collaborationReceiptDigest,
  collaborationReceiptIssuerContract,
} from "../src/collaborationReceiptRuntime.js";
import { createMcpStagingIssuerServiceRuntime } from "../server.js";
import { createCollaborationCoreGateIssuer } from
  "../../universal-core-service/src/collaborationCoreGateEvidence.js";

const NOW = Date.parse("2026-07-23T18:00:00.000Z");

test("canonical bootstrap maps only to its provider-native importer", () => {
  assert.equal(
    collaborationReceiptIssuerContract.action_to_tool["canonical.bootstrap"],
    "canonical_bootstrap_import",
  );
});

function secret() {
  return crypto.randomBytes(48).toString("base64url");
}

function issuerEnv(mode, {
  audience,
  targetCommit,
  token,
  signingSecret,
  coreGateSecret,
} = {}) {
  return {
    MCP_STAGING_ENVIRONMENT: "staging",
    MCP_STAGING_ISSUER_MODE: mode,
    MCP_STAGING_ISSUER_PROTOCOL: "collaboration",
    MCP_STAGING_ISSUER_STARTUP_MODE: "full",
    MCP_STAGING_ISSUER_SIGNING_SECRET: signingSecret,
    MCP_STAGING_ISSUER_AUTH_TOKEN: token,
    MCP_STAGING_COLLABORATION_AUDIENCE: audience,
    MCP_STAGING_COLLABORATION_TARGET_COMMIT: targetCommit,
    ...(coreGateSecret ? { MCP_STAGING_CORE_GATE_VERIFY_SECRET: coreGateSecret } : {}),
  };
}

function discoveredNyraTrust(runtime, targetCommit) {
  return Object.freeze({
    authority: "nyra",
    issuer: "nyra-staging",
    kid: runtime.jwk.kid,
    jwk: runtime.jwk,
    targetCommit,
  });
}

function durableReplayStore() {
  const claims = new Set();
  return Object.freeze({
    durable: true,
    async claim({ mode, nonce }) {
      const key = `${mode}:${nonce}`;
      if (claims.has(key)) return false;
      claims.add(key);
      return true;
    },
  });
}

function actionBinding({ audience, targetCommit }) {
  return {
    schema_version: "mcp_collaboration_action_binding_v1",
    audience,
    target_service: "skinharmony-core-mcp-staging",
    target_environment: "staging",
    target_commit: targetCommit,
    tenant_id: "codexai",
    actor_subject_sha256: crypto.randomBytes(32).toString("hex"),
    agent_id: "collaboration_test_agent",
    session_id: "collaboration_test_session",
    session_fingerprint: crypto.randomBytes(24).toString("base64url"),
    agent_signature_sha256: crypto.randomBytes(32).toString("hex"),
    trace_id: crypto.randomUUID(),
    preflight_id: `preflight_${crypto.randomUUID()}`,
    task_contract_id: `task_${crypto.randomUUID()}`,
    task_trace_id: `trace_${crypto.randomUUID()}`,
    coordination_lock: `lock_${crypto.randomUUID()}`,
    shared_memory_checksum: crypto.randomBytes(32).toString("hex"),
    tool_name: "memory_checkpoint",
    action_type: "memory.checkpoint",
    target: "tenant/codexai/project/mcp-shared-memory",
    payload_sha256: crypto.randomBytes(32).toString("hex"),
    expected_version: null,
    lock_id: null,
    fencing_token: null,
    idempotency_key_sha256: crypto.randomBytes(32).toString("hex"),
  };
}

function canonicalActionBinding(scope) {
  return {
    ...actionBinding(scope),
    tool_name: "canonical_bootstrap_import",
    action_type: "canonical.bootstrap",
    target: "skinharmony_mcp_staging_db/SHARED_MEMORY",
  };
}

function directRequest(runtime, {
  path = runtime.endpoint,
  method = "POST",
  token,
  body,
} = {}) {
  const payload = body === undefined
    ? Buffer.alloc(0)
    : Buffer.from(JSON.stringify(body), "utf8");
  const req = Readable.from(payload.length ? [payload] : []);
  req.method = method;
  req.url = path;
  req.headers = {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(body === undefined ? {} : {
      "content-type": "application/json",
      "content-length": String(payload.length),
    }),
  };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[String(name).toLowerCase()] = value;
      },
      end(value = "") {
        try {
          resolve({
            status: this.statusCode,
            headers: this.headers,
            body: value ? JSON.parse(String(value)) : null,
          });
        } catch (error) {
          reject(error);
        }
      },
    };
    Promise.resolve(runtime.handle(req, res)).catch(reject);
  });
}

function verifyEnvelope(envelope, jwk) {
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  return crypto.verify(
    null,
    Buffer.from(collaborationReceiptCanonicalJson(envelope.claims), "utf8"),
    publicKey,
    Buffer.from(envelope.signature, "base64url"),
  );
}

test("Nyra signs the exact canonical bootstrap action but rejects a substituted tool", async () => {
  const audience = `https://mcp-staging-${crypto.randomUUID()}.invalid/mcp`;
  const targetCommit = crypto.randomBytes(20).toString("hex");
  const token = secret();
  const runtime = createMcpStagingIssuerServiceRuntime({
    env: issuerEnv("nyra", {
      audience,
      targetCommit,
      token,
      signingSecret: secret(),
    }),
    now: () => NOW,
    replayStore: durableReplayStore(),
    targetCommit,
  });
  const binding = canonicalActionBinding({ audience, targetCommit });
  const request = {
    request_kind: "issue",
    binding,
    jti: `mcpcr_${crypto.randomUUID().replaceAll("-", "")}`,
    requested_ttl_ms: 20_000,
    nonce: crypto.randomBytes(24).toString("base64url"),
  };
  assert.equal((await directRequest(runtime, { token, body: request })).status, 201);
  assert.equal((await directRequest(runtime, {
    token,
    body: {
      ...request,
      jti: `mcpcr_${crypto.randomUUID().replaceAll("-", "")}`,
      nonce: crypto.randomBytes(24).toString("base64url"),
      binding: { ...binding, tool_name: "workspace_write_document" },
    },
  })).status, 400);
});

test("full collaboration profile signs a real independent Nyra -> Core Ed25519 chain", async () => {
  const audience = `https://mcp-staging-${crypto.randomUUID()}.invalid/mcp`;
  const targetCommit = crypto.randomBytes(20).toString("hex");
  const nyraToken = secret();
  const coreToken = secret();
  const nyraSigningSecret = secret();
  const coreSigningSecret = secret();
  const coreGateSecret = secret();
  assert.notEqual(nyraToken, coreToken);
  assert.notEqual(nyraSigningSecret, coreSigningSecret);

  const replayStore = durableReplayStore();
  const nyraEnv = issuerEnv("nyra", {
    audience,
    targetCommit,
    token: nyraToken,
    signingSecret: nyraSigningSecret,
  });
  const nyra = createMcpStagingIssuerServiceRuntime({
    env: nyraEnv,
    now: () => NOW,
    replayStore,
    targetCommit,
  });
  const coreEnv = issuerEnv("core", {
    audience,
    targetCommit,
    token: coreToken,
    signingSecret: coreSigningSecret,
    coreGateSecret,
  });
  const core = createMcpStagingIssuerServiceRuntime({
    env: coreEnv,
    now: () => NOW,
    replayStore,
    targetCommit,
    nyraTrust: discoveredNyraTrust(nyra, targetCommit),
  });

  assert.equal(nyra.endpoint, "/v1/mcp-staging/collaboration/nyra-attest");
  assert.equal(core.endpoint, "/v1/mcp-staging/collaboration/core-grant");
  assert.equal(nyra.issuer, "nyra-staging");
  assert.equal(core.issuer, "universal-core-staging");
  assert.notEqual(nyra.jwk.kid, core.jwk.kid);
  assert.equal(nyra.readiness().issuer, nyra.issuer);
  assert.equal(core.readiness().issuer, core.issuer);
  assert.equal(nyra.readiness().collaboration_receipt_ready, true);
  assert.equal(core.readiness().collaboration_receipt_ready, true);
  assert.equal((await directRequest(nyra, {
    path: "/.well-known/jwks.json",
    method: "GET",
  })).status, 401);
  const privateJwks = await directRequest(nyra, {
    path: "/.well-known/jwks.json",
    method: "GET",
    token: nyraToken,
  });
  assert.equal(privateJwks.status, 200);
  assert.deepEqual(Object.keys(privateJwks.body).sort(), [
    "issuer", "keys", "schema_version", "target_commit", "target_environment",
    "target_service",
  ]);
  assert.deepEqual(privateJwks.body.keys, [nyra.jwk]);
  assert.equal(privateJwks.body.target_commit, targetCommit);

  const binding = actionBinding({ audience, targetCommit });
  const bindingDigest = collaborationReceiptDigest(
    "mcp-collaboration-binding-v1",
    binding,
  );
  const jti = `mcpcr_${crypto.randomUUID().replaceAll("-", "")}`;
  const nyraResponse = await directRequest(nyra, {
    token: nyraToken,
    body: {
      request_kind: "issue",
      binding,
      jti,
      requested_ttl_ms: 20_000,
      nonce: crypto.randomBytes(24).toString("base64url"),
    },
  });
  assert.equal(nyraResponse.status, 201);
  assert.equal(verifyEnvelope(nyraResponse.body.envelope, nyra.jwk), true);
  assert.equal(nyraResponse.body.envelope.claims.binding_digest, bindingDigest);

  const decision = {
    schema_version: "mcp_collaboration_core_decision_v1",
    binding_digest: bindingDigest,
    allowed: true,
    decision: "authorized_after_confirmation",
    mediation: "confirmed",
    confirmation_satisfied: true,
  };
  const coreGate = createCollaborationCoreGateIssuer({
    secret: coreGateSecret,
    targetCommit,
    now: () => NOW,
  }).issue({
    tenantId: "codexai",
    body: {
      action_type: binding.action_type,
      target: binding.target,
      payload_sha256: binding.payload_sha256,
      expected_version: binding.expected_version,
      lock_id: binding.lock_id,
      fencing_token: binding.fencing_token,
      idempotency_key_sha256: binding.idempotency_key_sha256,
      collaboration_audience: binding.audience,
      collaboration_target_service: binding.target_service,
      collaboration_target_environment: binding.target_environment,
      collaboration_target_commit: binding.target_commit,
      collaboration_binding_digest: bindingDigest,
    },
    authorization: {
      allowed: true,
      state: decision.decision,
      mediation: decision.mediation,
      confirmation_satisfied: decision.confirmation_satisfied,
      scope: "reversible_internal_collaboration_write",
    },
  });
  const coreResponse = await directRequest(core, {
    token: coreToken,
    body: {
      request_kind: "issue",
      binding,
      decision,
      jti,
      requested_ttl_ms: 20_000,
      nonce: crypto.randomBytes(24).toString("base64url"),
      nyra_attestation: nyraResponse.body.envelope,
      core_gate: coreGate,
    },
  });
  assert.equal(coreResponse.status, 201);
  assert.equal(verifyEnvelope(coreResponse.body.envelope, core.jwk), true);
  assert.equal(coreResponse.body.envelope.claims.binding_digest, bindingDigest);
  assert.equal(
    coreResponse.body.envelope.claims.nyra_attestation_digest,
    collaborationReceiptDigest(
      "mcp-collaboration-nyra-envelope-v1",
      nyraResponse.body.envelope,
    ),
  );
  assert.equal(
    coreResponse.body.envelope.claims.core_decision_digest,
    collaborationReceiptDigest("mcp-collaboration-core-decision-v1", decision),
  );
  const forgedGateResponse = await directRequest(core, {
    token: coreToken,
    body: {
      request_kind: "issue",
      binding,
      decision,
      jti,
      requested_ttl_ms: 20_000,
      nonce: crypto.randomBytes(24).toString("base64url"),
      nyra_attestation: nyraResponse.body.envelope,
      core_gate: {
        ...coreGate,
        signature: `${coreGate.signature[0] === "A" ? "B" : "A"}${coreGate.signature.slice(1)}`,
      },
    },
  });
  assert.equal(forgedGateResponse.status, 400);

  assert.equal(
    (await directRequest(core, {
      path: collaborationReceiptIssuerContract.endpoints.nyra,
      token: coreToken,
      body: {},
    })).status,
    404,
  );
  assert.equal("MCP_STAGING_ISSUER_SIGNING_SECRET" in nyraEnv, false);
  assert.equal("MCP_STAGING_ISSUER_AUTH_TOKEN" in coreEnv, false);
  assert.equal("MCP_STAGING_CORE_GATE_VERIFY_SECRET" in coreEnv, false);
});

test("collaboration profile fails closed on unknown protocol or incomplete scope", () => {
  const common = {
    audience: `https://mcp-staging-${crypto.randomUUID()}.invalid/mcp`,
    targetCommit: crypto.randomBytes(20).toString("hex"),
    token: secret(),
    signingSecret: secret(),
  };
  const replayStore = durableReplayStore();
  const unknown = issuerEnv("nyra", common);
  unknown.MCP_STAGING_ISSUER_PROTOCOL = "unknown";
  assert.throws(
    () => createMcpStagingIssuerServiceRuntime({
      env: unknown,
      replayStore,
      targetCommit: common.targetCommit,
    }),
    /issuer_protocol_invalid/,
  );
  const production = issuerEnv("nyra", common);
  production.MCP_STAGING_ENVIRONMENT = "production";
  assert.throws(
    () => createMcpStagingIssuerServiceRuntime({
      env: production,
      replayStore,
      targetCommit: common.targetCommit,
    }),
    /issuer_staging_confirmation_required/,
  );

  const missingAudience = issuerEnv("nyra", { ...common, audience: undefined });
  assert.throws(
    () => createMcpStagingIssuerServiceRuntime({
      env: missingAudience,
      replayStore,
      targetCommit: common.targetCommit,
    }),
    /collaboration_receipt_audience_invalid/,
  );
  const missingNyraAnchor = issuerEnv("core", common);
  assert.throws(
    () => createMcpStagingIssuerServiceRuntime({
      env: missingNyraAnchor,
      replayStore,
      targetCommit: common.targetCommit,
    }),
    /collaboration_nyra_private_trust_required/,
  );
});
