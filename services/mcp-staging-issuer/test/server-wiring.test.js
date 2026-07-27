import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import {
  createMcpStagingIssuerServiceRuntime,
  loadIssuerPrivatePort,
} from "../server.js";
import {
  createMcpStagingSignedIssuerClients,
} from "../../universal-core-service/src/mcpStagingSignedIssuerClients.js";
import {
  issueMcpStagingCredentialReceipt,
  issueMcpStagingOwnerConfirmation,
  mcpStagingEvidenceDigest,
} from "../../universal-core-service/src/mcpStagingEvidence.js";

const NOW = Date.parse("2026-07-19T16:00:00.000Z");
const TARGET_COMMIT = "f435aafb709a26c77e82e2688056d73056d69c82";
const CORE_TOKEN = "core-service-token-test-only-0123456789abcdef";
const NYRA_TOKEN = "nyra-service-token-test-only-0123456789abcdef";
const ISSUER_HOSTPORTS = Object.freeze({
  core: "skinharmony-core-staging-issuer-a1b2:8789",
  nyra: "skinharmony-nyra-staging-issuer-c3d4:8789",
});
const ISSUER_URLS = Object.freeze({
  core: `http://${ISSUER_HOSTPORTS.core}/v1/mcp-staging/core-grant`,
  nyra: `http://${ISSUER_HOSTPORTS.nyra}/v1/mcp-staging/nyra-attest`,
});

test("issuer private port is exact and getter failures are redacted", () => {
  assert.equal(loadIssuerPrivatePort({ PORT: "8789" }), 8_789);
  for (const env of [{}, { PORT: "10000" }, { PORT: "10001" }, { PORT: 8_789 }]) {
    assert.throws(() => loadIssuerPrivatePort(env), /issuer_private_port_invalid/);
  }
  const marker = "issuer-port-getter-marker";
  assert.throws(
    () => loadIssuerPrivatePort(new Proxy({}, { get() { throw new Error(marker); } })),
    (error) => error.message === "issuer_private_port_invalid" && !String(error).includes(marker),
  );
});

function publicJwk(publicKey) {
  const exported = publicKey.export({ format: "jwk" });
  const kid = `ed25519-sha256:${crypto.createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("hex")}`;
  return { alg: "EdDSA", crv: "Ed25519", kid, kty: "OKP", use: "sig", x: exported.x };
}

function anchorEnv(prefix, publicKey) {
  const jwk = publicJwk(publicKey);
  return {
    [`${prefix}_PUBLIC_JWK`]: JSON.stringify(jwk),
    [`${prefix}_KID`]: jwk.kid,
  };
}

function issuerEnv(mode, authToken, anchors = {}) {
  return {
    MCP_STAGING_ENVIRONMENT: "staging",
    MCP_STAGING_ISSUER_MODE: mode,
    MCP_STAGING_ISSUER_SIGNING_SECRET: `${mode}-service-signing-secret-test-only-0123456789abcdef`,
    MCP_STAGING_ISSUER_AUTH_TOKEN: authToken,
    ...anchors,
  };
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

function baseContext(credentialGrantDigest) {
  return {
    schema_version: "mcp_staging_executor_context_v1",
    tenant_id: "codexai",
    domain_pack_id: "skinharmony",
    target_service: "skinharmony-core-mcp-staging",
    target_environment: "staging",
    target_region: "oregon",
    target_commit: TARGET_COMMIT,
    attempt_id: "mcpstg_server-wiring-20260719",
    deployment_spec_digest: "1".repeat(64),
    preflight_digest: "2".repeat(64),
    credential_grant_digest: credentialGrantDigest,
    credential_execution_id: "mcp-staging-credentials-20260719-02",
    credential_action_digest: "4".repeat(64),
    credential_executor_contract_id: "domain_action_44444444444444444444",
    action_digest: "6".repeat(64),
    executor_contract_id: "domain_action_66666666666666666666",
  };
}

function directPost(runtime, request) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(request.body), "utf8");
    const req = Readable.from([payload]);
    req.method = "POST";
    req.url = new URL(request.url).pathname;
    req.headers = {
      authorization: request.headers.authorization,
      "content-type": "application/json",
      "content-length": String(payload.length),
    };
    req.socket = { remoteAddress: "127.0.0.1" };
    const res = {
      statusCode: 200,
      setHeader() {},
      end(body = "") {
        try {
          resolve({ status: this.statusCode, body: body ? JSON.parse(String(body)) : null });
        } catch (error) {
          reject(error);
        }
      },
    };
    Promise.resolve(runtime.handle(req, res)).catch(reject);
  });
}

test("entrypoints compose independent pinned authorities into a real Nyra -> Core chain", async () => {
  const receiptKeys = crypto.generateKeyPairSync("ed25519");
  const ownerKeys = crypto.generateKeyPairSync("ed25519");
  const commonAnchors = {
    ...anchorEnv("MCP_STAGING_RECEIPT_AUTHORITY", receiptKeys.publicKey),
    ...anchorEnv("MCP_STAGING_OWNER_AUTHORITY", ownerKeys.publicKey),
  };
  const replayStore = durableReplayStore();
  const nyraEnv = issuerEnv("nyra", NYRA_TOKEN, commonAnchors);
  const nyraRuntime = createMcpStagingIssuerServiceRuntime({
    env: nyraEnv,
    now: () => NOW,
    replayStore,
    targetCommit: TARGET_COMMIT,
  });
  assert.equal("MCP_STAGING_ISSUER_SIGNING_SECRET" in nyraEnv, false);
  assert.equal("MCP_STAGING_RECEIPT_AUTHORITY_PUBLIC_JWK" in nyraEnv, false);

  const coreEnv = issuerEnv("core", CORE_TOKEN, {
    ...commonAnchors,
    MCP_STAGING_NYRA_AUTHORITY_PUBLIC_JWK: JSON.stringify(nyraRuntime.jwk),
    MCP_STAGING_NYRA_AUTHORITY_KID: nyraRuntime.jwk.kid,
  });
  const coreRuntime = createMcpStagingIssuerServiceRuntime({
    env: coreEnv,
    now: () => NOW,
    replayStore,
    targetCommit: TARGET_COMMIT,
  });
  assert.equal("MCP_STAGING_ISSUER_AUTH_TOKEN" in coreEnv, false);
  assert.equal("MCP_STAGING_NYRA_AUTHORITY_PUBLIC_JWK" in coreEnv, false);

  const credentialReceipt = issueMcpStagingCredentialReceipt({
    receipt_id: "mcpstg_receipt_serverwiring012345",
    credential_execution_id: "mcp-staging-credentials-20260719-02",
    issued_at: new Date(NOW - 1_000).toISOString(),
    expires_at: new Date(NOW + 60_000).toISOString(),
    core_key_handle_digest: "5".repeat(64),
  }, receiptKeys.privateKey, { targetCommit: TARGET_COMMIT });
  const context = baseContext(credentialReceipt.claims.binding_digest);
  const ownerConfirmation = issueMcpStagingOwnerConfirmation({
    confirmation_reference: "owner_server_wiring_20260719",
    authorization_text_digest: "7".repeat(64),
    attempt_id: context.attempt_id,
    deployment_spec_digest: context.deployment_spec_digest,
    preflight_digest: context.preflight_digest,
    credential_grant_digest: context.credential_grant_digest,
    action_digest: context.action_digest,
    executor_contract_id: context.executor_contract_id,
    issued_at: new Date(NOW - 1_000).toISOString(),
    expires_at: new Date(NOW + 60_000).toISOString(),
    nonce: "owner_server_wiring_nonce_20260719",
  }, ownerKeys.privateKey, { targetCommit: TARGET_COMMIT });

  let nyraEnvelope;
  const clients = createMcpStagingSignedIssuerClients({
    transport: {
      post(request) {
        if (request.url === ISSUER_URLS.nyra) return directPost(nyraRuntime, request);
        if (request.url === ISSUER_URLS.core) return directPost(coreRuntime, request);
        throw new Error("endpoint_not_allowed");
      },
    },
    endpoints: ISSUER_HOSTPORTS,
    corePublicKey: crypto.createPublicKey({ key: coreRuntime.jwk, format: "jwk" }),
    nyraPublicKey: crypto.createPublicKey({ key: nyraRuntime.jwk, format: "jwk" }),
    evidenceProvider: async (issuer) => issuer === "nyra"
      ? { credential_receipt: credentialReceipt, owner_confirmation: ownerConfirmation }
      : {
          credential_receipt: credentialReceipt,
          nyra_attestation: nyraEnvelope,
          owner_confirmation: ownerConfirmation,
        },
    now: () => NOW,
    targetCommit: TARGET_COMMIT,
  });
  nyraEnvelope = await clients.requestNyraAttestation(context, async () => NYRA_TOKEN);
  const coreContext = {
    ...context,
    nyra_attestation_digest: mcpStagingEvidenceDigest("mcp-staging-nyra-attestation-v1", nyraEnvelope),
  };
  const coreEnvelope = await clients.requestCoreGrant(coreContext, async () => CORE_TOKEN);
  assert.equal(nyraEnvelope.claims.request_kind, "issue");
  assert.equal(coreEnvelope.claims.request_kind, "issue");
  assert.equal(coreEnvelope.claims.confirmation_satisfied, true);
});

test("entrypoint aborts and scrubs when public authorities are missing or not independent", () => {
  const shared = crypto.generateKeyPairSync("ed25519");
  const anchors = {
    ...anchorEnv("MCP_STAGING_RECEIPT_AUTHORITY", shared.publicKey),
    ...anchorEnv("MCP_STAGING_OWNER_AUTHORITY", shared.publicKey),
  };
  const duplicateEnv = issuerEnv("nyra", NYRA_TOKEN, anchors);
  assert.throws(
    () => createMcpStagingIssuerServiceRuntime({
      env: duplicateEnv,
      now: () => NOW,
      replayStore: durableReplayStore(),
      targetCommit: TARGET_COMMIT,
    }),
    /issuer_trust_anchors_not_independent/,
  );
  assert.equal("MCP_STAGING_ISSUER_SIGNING_SECRET" in duplicateEnv, false);
  assert.equal("MCP_STAGING_OWNER_AUTHORITY_PUBLIC_JWK" in duplicateEnv, false);

  const missingEnv = issuerEnv("core", CORE_TOKEN);
  assert.throws(
    () => createMcpStagingIssuerServiceRuntime({
      env: missingEnv,
      now: () => NOW,
      replayStore: durableReplayStore(),
      targetCommit: TARGET_COMMIT,
    }),
    /public_trust_anchor_invalid/,
  );
  assert.equal("MCP_STAGING_ISSUER_AUTH_TOKEN" in missingEnv, false);

  const noReplayEnv = issuerEnv("nyra", NYRA_TOKEN, anchors);
  assert.throws(
    () => createMcpStagingIssuerServiceRuntime({
      env: noReplayEnv,
      now: () => NOW,
      targetCommit: TARGET_COMMIT,
    }),
    /issuer_durable_replay_store_required/,
  );
  assert.equal("MCP_STAGING_ISSUER_SIGNING_SECRET" in noReplayEnv, false);
});

test("jwks_only entrypoint needs no auth, anchors or control plane and scrubs issuer secrets", () => {
  const env = {
    MCP_STAGING_ENVIRONMENT: "staging",
    MCP_STAGING_ISSUER_MODE: "core",
    MCP_STAGING_ISSUER_STARTUP_MODE: "jwks_only",
    MCP_STAGING_ISSUER_SIGNING_SECRET: "core-bootstrap-signing-secret-test-only-0123456789abcdef",
    MCP_STAGING_ISSUER_AUTH_TOKEN: "unused",
    MCP_STAGING_CONTROL_PLANE_INTERNAL_HOSTPORT: "unused.invalid:10001",
    MCP_STAGING_ISSUER_NONCE_API_TOKEN: "unused-capability",
  };
  const runtime = createMcpStagingIssuerServiceRuntime({
    env,
    now: () => NOW,
    targetCommit: TARGET_COMMIT,
  });
  assert.equal(runtime.mode, "core");
  assert.equal(runtime.startupMode, "jwks_only");
  assert.equal(runtime.issuanceReady, false);
  assert.equal("MCP_STAGING_ISSUER_SIGNING_SECRET" in env, false);
  assert.equal("MCP_STAGING_ISSUER_AUTH_TOKEN" in env, false);
  assert.equal("MCP_STAGING_CONTROL_PLANE_INTERNAL_HOSTPORT" in env, false);
  assert.equal("MCP_STAGING_ISSUER_NONCE_API_TOKEN" in env, false);
  assert.equal("MCP_STAGING_RECEIPT_AUTHORITY_PUBLIC_JWK" in env, false);

  const invalidEnv = {
    MCP_STAGING_ENVIRONMENT: "staging",
    MCP_STAGING_ISSUER_MODE: "nyra",
    MCP_STAGING_ISSUER_STARTUP_MODE: "unsafe",
    MCP_STAGING_ISSUER_SIGNING_SECRET: "nyra-bootstrap-signing-secret-test-only-0123456789abcdef",
    MCP_STAGING_ISSUER_AUTH_TOKEN: "unused",
  };
  assert.throws(
    () => createMcpStagingIssuerServiceRuntime({
      env: invalidEnv,
      now: () => NOW,
      targetCommit: TARGET_COMMIT,
    }),
    /issuer_startup_mode_invalid/,
  );
  assert.equal("MCP_STAGING_ISSUER_SIGNING_SECRET" in invalidEnv, false);
  assert.equal("MCP_STAGING_ISSUER_AUTH_TOKEN" in invalidEnv, false);
});
