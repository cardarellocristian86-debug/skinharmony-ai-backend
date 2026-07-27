import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { createMcpStagingIssuerRuntime } from "../../mcp-staging-issuer/src/issuerRuntime.js";
import { createMcpStagingIssuerServiceRuntime } from "../../mcp-staging-issuer/server.js";
import { createHealthServer } from "../../mcp-staging-db-bootstrap/src/server.js";
import {
  createMcpStagingIssuerReplayClientFromEnv,
  createMcpStagingReceiptConsumerClientFromEnv,
} from "../src/mcpStagingControlPlaneClient.js";
import {
  createMcpStagingSignedIssuerGateClientFromEnv,
} from "../src/mcpStagingSignedIssuerClients.js";
import {
  createMcpStagingCredentialReceiptVerifier,
  createMcpStagingIssuerEvidenceVerifier,
  createMcpStagingOwnerConfirmationVerifier,
  issueMcpStagingCredentialReceipt,
  issueMcpStagingOwnerConfirmation,
  mcpStagingEvidenceDigest,
} from "../src/mcpStagingEvidence.js";
import {
  createMcpStagingPostgresControlPlaneFromEnv,
  mcpStagingPostgresControlPlaneContract,
} from "../src/mcpStagingPostgresControlPlane.js";
import { createMcpStagingConsumptionEvidenceVerifier } from
  "../src/mcpStagingConsumptionEvidence.js";

const NOW = Date.parse("2026-07-19T15:00:00.000Z");
const TARGET_COMMIT = crypto.randomBytes(20).toString("hex");
const CONTROL_PLANE_CATALOG = mcpStagingPostgresControlPlaneContract.catalog(TARGET_COMMIT);
const ROLE = "mcp_staging_gate_control";
const DATABASE = "skinharmony_mcp_staging";
const CORE_TOKEN = "core-issuer-token-test-only-0123456789abcdef";
const NYRA_TOKEN = "nyra-issuer-token-test-only-0123456789abcdef";
const CORE_SIGNING_SECRET = "core-signing-secret-test-only-0123456789abcdef";
const NYRA_SIGNING_SECRET = "nyra-signing-secret-test-only-0123456789abcdef";
const CONTROL_PLANE_HOSTPORT = "skinharmony-mcp-staging-db-bootstrap-a1b2:10001";
const ISSUER_HOSTPORTS = Object.freeze({
  core: "skinharmony-core-staging-issuer-a1b2:8789",
  nyra: "skinharmony-nyra-staging-issuer-c3d4:8789",
});
const ISSUER_URLS = Object.freeze({
  core: `http://${ISSUER_HOSTPORTS.core}/v1/mcp-staging/core-grant`,
  nyra: `http://${ISSUER_HOSTPORTS.nyra}/v1/mcp-staging/nyra-attest`,
});

function trustDescriptor(publicKey) {
  const key = publicKey instanceof crypto.KeyObject ? publicKey : crypto.createPublicKey(publicKey);
  const exported = key.export({ format: "jwk" });
  const kid = `ed25519-sha256:${crypto.createHash("sha256")
    .update(key.export({ format: "der", type: "spki" })).digest("hex")}`;
  return {
    jwkJson: JSON.stringify({ alg: "EdDSA", crv: "Ed25519", kid, kty: "OKP", use: "sig", x: exported.x }),
    expectedKid: kid,
  };
}

function runtimeTrustDescriptor(jwk) {
  return { jwkJson: JSON.stringify(jwk), expectedKid: jwk.kid };
}

function providerEnv() {
  return {
    MCP_STAGING_GATE_PG_HOST: "internal-staging-db.invalid",
    MCP_STAGING_GATE_PG_PORT: "5432",
    MCP_STAGING_GATE_PG_DATABASE: DATABASE,
    MCP_STAGING_GATE_PG_USER: ROLE,
    MCP_STAGING_GATE_PG_PASSWORD: "provider-password-test-only-0123456789abcdef",
    MCP_STAGING_CONTROL_PLANE_ENVIRONMENT: "staging",
  };
}

function baseContext(overrides = {}) {
  const actionDigest = overrides.action_digest || "6".repeat(64);
  const credentialActionDigest = overrides.credential_action_digest || "4".repeat(64);
  return {
    schema_version: "mcp_staging_executor_context_v1",
    tenant_id: "codexai",
    domain_pack_id: "skinharmony",
    target_service: "skinharmony-core-mcp-staging",
    target_environment: "staging",
    target_region: "oregon",
    target_commit: TARGET_COMMIT,
    attempt_id: "mcpstg_11111111-2222-4333-8444-555555555555",
    deployment_spec_digest: "1".repeat(64),
    preflight_digest: "2".repeat(64),
    credential_grant_digest: overrides.credential_grant_digest || "3".repeat(64),
    credential_execution_id: "mcp-staging-credentials-20260719-01",
    credential_action_digest: credentialActionDigest,
    credential_executor_contract_id: `domain_action_${credentialActionDigest.slice(0, 20)}`,
    action_digest: actionDigest,
    executor_contract_id: `domain_action_${actionDigest.slice(0, 20)}`,
    ...overrides,
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
    const responseHeaders = {};
    const res = {
      statusCode: 200,
      setHeader(key, value) { responseHeaders[String(key).toLowerCase()] = value; },
      end(body = "") {
        try {
          resolve({ status: this.statusCode, body: body ? JSON.parse(String(body)) : null, headers: responseHeaders });
        } catch (error) {
          reject(error);
        }
      },
    };
    Promise.resolve(runtime.handle(req, res)).catch(reject);
  });
}

function inProcessIssuerFetch({ core, nyra }) {
  return async function fetchIssuer(url, options) {
    const runtime = url === ISSUER_URLS.core ? core
      : url === ISSUER_URLS.nyra ? nyra : null;
    if (!runtime) throw new Error("endpoint_not_allowed");
    const response = await directPost(runtime, {
      url,
      headers: options.headers,
      body: JSON.parse(String(options.body || "")),
    });
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
}

function inProcessFetch(server) {
  return async function fetchControlPlane(url, options) {
    const payload = Buffer.from(String(options.body || ""), "utf8");
    const req = Readable.from(payload.length ? [payload] : []);
    req.method = options.method;
    req.url = new URL(url).pathname;
    req.headers = Object.fromEntries(Object.entries(options.headers).map(([key, value]) =>
      [key.toLowerCase(), value]));
    return new Promise((resolve) => {
      const res = {
        statusCode: 200,
        writeHead(status) { this.statusCode = status; },
        end(body = "") {
          const parsed = body ? JSON.parse(String(body)) : null;
          resolve(new Response(JSON.stringify(parsed), {
            status: this.statusCode,
            headers: { "content-type": "application/json" },
          }));
        },
      };
      server.emit("request", req, res);
    });
  };
}

class TransactionalReceiptPool {
  constructor() {
    this.calls = [];
    this.meta = null;
    this.receipt = null;
    this.consumptionInserts = 0;
    this.transactions = 0;
    this.issuerNonces = new Set();
  }

  async connect() {
    return {
      query: (sql, values = []) => this.query(sql, values),
      release() {},
    };
  }

  async query(sql, values = []) {
    this.calls.push({ sql, values });
    if (sql.startsWith("BEGIN")) {
      this.transactions += 1;
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("SELECT current_user")) {
      return { rows: [{
        current_user: ROLE,
        database_name: DATABASE,
        schema_owner: ROLE,
        schema_usage: true,
        schema_create: true,
        unexpected_schema_acl_grantee: false,
      }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO mcp_staging_gate.control_plane_store_meta")) {
      this.meta ||= { schema_version: values[0], schema_checksum: values[1] };
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("SELECT schema_version, schema_checksum")) {
      return { rows: this.meta ? [this.meta] : [], rowCount: this.meta ? 1 : 0 };
    }
    if (sql.includes("SELECT schema_object.relname")) {
      return { rows: Object.keys(CONTROL_PLANE_CATALOG).sort()
        .map((relname) => ({ relname, relkind: "r" })), rowCount: 5 };
    }
    if (sql.includes("AS column_contract")) {
      const base = { table_owner: ROLE, unexpected_acl_grantee: false, user_trigger_count: 0 };
      const rows = Object.entries(CONTROL_PLANE_CATALOG).map(([relname, contract]) => ({
        ...base,
        relname,
        relkind: "r",
        relpersistence: "p",
        relrowsecurity: false,
        relforcerowsecurity: false,
        column_contract: structuredClone(contract.columns),
        constraint_contract: structuredClone(contract.constraints),
      }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("DELETE FROM mcp_staging_gate.issuer_nonce_claims AS claimed")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("INSERT INTO mcp_staging_gate.issuer_nonce_claims")) {
      const key = `${values[0]}:${values[1]}`;
      if (this.issuerNonces.has(key)) return { rows: [], rowCount: 0 };
      this.issuerNonces.add(key);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO mcp_staging_gate.credential_receipts")) {
      if (!this.receipt) {
        this.receipt = {
          receipt_id: values[0], evidence_digest: values[1], issuer: values[2], kid: values[3],
          verification_method: values[4], signature_digest: values[5], payload_digest: values[6],
          binding_digest: values[7], credential_execution_id: values[8], tenant_id: values[9],
          target_service: values[10], target_environment: values[11], target_commit: values[12],
          operation: values[13], issued_at: values[14], expires_at: values[15],
          core_key_handle_digest: values[16], codex_bearer_mode: values[17], signature_verified: true,
          secret_values_present: false, secret_values_persisted: false, consumed_at: null,
          consumed_by_execution_id: null, consumed_by_idempotency_key: null,
        };
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM mcp_staging_gate.credential_receipts WHERE receipt_id")) {
      return {
        rows: this.receipt ? [{ ...this.receipt, currently_valid: true }] : [],
        rowCount: this.receipt ? 1 : 0,
      };
    }
    if (sql.includes("INSERT INTO mcp_staging_gate.receipt_consumptions")) {
      this.consumptionInserts += 1;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE mcp_staging_gate.credential_receipts")) {
      if (!this.receipt || this.receipt.consumed_at !== null) return { rows: [], rowCount: 0 };
      this.receipt.consumed_at = new Date(NOW).toISOString();
      this.receipt.consumed_by_execution_id = values[1];
      this.receipt.consumed_by_idempotency_key = values[2];
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  async end() {}
}

function signedInputs() {
  const receiptKeys = crypto.generateKeyPairSync("ed25519");
  const ownerKeys = crypto.generateKeyPairSync("ed25519");
  const credentialReceipt = issueMcpStagingCredentialReceipt({
    receipt_id: "mcpstg_receipt_0123456789abcdef",
    credential_execution_id: "mcp-staging-credentials-20260719-01",
    issued_at: new Date(NOW - 1_000).toISOString(),
    expires_at: new Date(NOW + 60_000).toISOString(),
    core_key_handle_digest: "5".repeat(64),
  }, receiptKeys.privateKey, { targetCommit: TARGET_COMMIT });
  const ownerConfirmation = issueMcpStagingOwnerConfirmation({
    confirmation_reference: "owner_mcp_staging_dependencies_20260719",
    authorization_text_digest: "7".repeat(64),
    attempt_id: "mcpstg_11111111-2222-4333-8444-555555555555",
    deployment_spec_digest: "1".repeat(64),
    preflight_digest: "2".repeat(64),
    credential_grant_digest: credentialReceipt.claims.binding_digest,
    action_digest: "6".repeat(64),
    executor_contract_id: "domain_action_66666666666666666666",
    issued_at: new Date(NOW - 1_000).toISOString(),
    expires_at: new Date(NOW + 60_000).toISOString(),
    nonce: "owner_confirmation_nonce_20260719",
  }, ownerKeys.privateKey, { targetCommit: TARGET_COMMIT });
  return {
    credentialReceipt,
    ownerConfirmation,
    receiptTrust: trustDescriptor(receiptKeys.publicKey),
    ownerTrust: trustDescriptor(ownerKeys.publicKey),
    receiptVerifier: createMcpStagingCredentialReceiptVerifier({
      publicKey: receiptKeys.publicKey,
      now: () => NOW,
      targetCommit: TARGET_COMMIT,
    }),
    ownerVerifier: createMcpStagingOwnerConfirmationVerifier({
      publicKey: ownerKeys.publicKey,
      now: () => NOW,
      targetCommit: TARGET_COMMIT,
    }),
  };
}

test("signed receipt -> Nyra -> Core -> atomic PostgreSQL consumption is one closed local chain", async () => {
  const signed = signedInputs();
  const context = baseContext({ credential_grant_digest: signed.credentialReceipt.claims.binding_digest });
  const keyProbeReplayStore = Object.freeze({ durable: true, claim: async () => true });
  const nyraKeyProbe = createMcpStagingIssuerRuntime({
    mode: "nyra", signingSecret: NYRA_SIGNING_SECRET, authToken: NYRA_TOKEN,
    now: () => NOW, replayStore: keyProbeReplayStore, evidenceVerifier: async () => ({}),
    targetCommit: TARGET_COMMIT,
  });
  const coreKeyProbe = createMcpStagingIssuerRuntime({
    mode: "core", signingSecret: CORE_SIGNING_SECRET, authToken: CORE_TOKEN,
    now: () => NOW, replayStore: keyProbeReplayStore, evidenceVerifier: async () => ({}),
    targetCommit: TARGET_COMMIT,
  });
  const consumptionEvidenceVerifier = createMcpStagingConsumptionEvidenceVerifier({
    receipt: signed.receiptTrust,
    owner: signed.ownerTrust,
    core: runtimeTrustDescriptor(coreKeyProbe.jwk),
    nyra: runtimeTrustDescriptor(nyraKeyProbe.jwk),
    now: () => NOW,
    targetCommit: TARGET_COMMIT,
  });
  const pool = new TransactionalReceiptPool();
  const env = providerEnv();
  const controlPlane = await createMcpStagingPostgresControlPlaneFromEnv({
    env,
    poolFactory: async () => pool,
    consumptionEvidenceVerifier,
    targetCommit: TARGET_COMMIT,
  });
  assert.deepEqual(env, {});
  const apiTokens = {
    coreNonce: "core-nonce-e2e-token-test-only-0123456789abcdef",
    nyraNonce: "nyra-nonce-e2e-token-test-only-0123456789abcdef",
    receiptConsumer: "receipt-consumer-e2e-token-test-only-0123456789abcdef",
  };
  const controlPlaneServer = createHealthServer({
    ok: true,
    status: "ready",
    environment: "staging",
    schema_version: 2,
    role_count: 1,
    isolation: "verified",
    control_plane: "ready",
    secrets_exposed: false,
  }, { controlPlane, apiTokens });
  const coreReplayClient = createMcpStagingIssuerReplayClientFromEnv({
    env: {
      MCP_STAGING_CONTROL_PLANE_INTERNAL_HOSTPORT: CONTROL_PLANE_HOSTPORT,
      MCP_STAGING_ISSUER_MODE: "core",
      MCP_STAGING_ISSUER_NONCE_API_TOKEN: apiTokens.coreNonce,
    },
    fetchImpl: inProcessFetch(controlPlaneServer),
  });
  const nyraReplayClient = createMcpStagingIssuerReplayClientFromEnv({
    env: {
      MCP_STAGING_CONTROL_PLANE_INTERNAL_HOSTPORT: CONTROL_PLANE_HOSTPORT,
      MCP_STAGING_ISSUER_MODE: "nyra",
      MCP_STAGING_ISSUER_NONCE_API_TOKEN: apiTokens.nyraNonce,
    },
    fetchImpl: inProcessFetch(controlPlaneServer),
  });
  const receiptConsumerClient = createMcpStagingReceiptConsumerClientFromEnv({
    env: {
      MCP_STAGING_CONTROL_PLANE_INTERNAL_HOSTPORT: CONTROL_PLANE_HOSTPORT,
      MCP_STAGING_RECEIPT_CONSUMER_API_TOKEN: apiTokens.receiptConsumer,
    },
    fetchImpl: inProcessFetch(controlPlaneServer),
    targetCommit: TARGET_COMMIT,
  });
  const nyraIssuerEnv = {
    MCP_STAGING_ENVIRONMENT: "staging",
    MCP_STAGING_ISSUER_MODE: "nyra",
    MCP_STAGING_ISSUER_SIGNING_SECRET: NYRA_SIGNING_SECRET,
    MCP_STAGING_ISSUER_AUTH_TOKEN: NYRA_TOKEN,
    MCP_STAGING_RECEIPT_AUTHORITY_PUBLIC_JWK: signed.receiptTrust.jwkJson,
    MCP_STAGING_RECEIPT_AUTHORITY_KID: signed.receiptTrust.expectedKid,
    MCP_STAGING_OWNER_AUTHORITY_PUBLIC_JWK: signed.ownerTrust.jwkJson,
    MCP_STAGING_OWNER_AUTHORITY_KID: signed.ownerTrust.expectedKid,
  };
  const nyraRuntime = createMcpStagingIssuerServiceRuntime({
    env: nyraIssuerEnv,
    now: () => NOW,
    replayStore: nyraReplayClient.issuerReplayStore,
    targetCommit: TARGET_COMMIT,
  });
  const coreIssuerEnv = {
    MCP_STAGING_ENVIRONMENT: "staging",
    MCP_STAGING_ISSUER_MODE: "core",
    MCP_STAGING_ISSUER_SIGNING_SECRET: CORE_SIGNING_SECRET,
    MCP_STAGING_ISSUER_AUTH_TOKEN: CORE_TOKEN,
    MCP_STAGING_RECEIPT_AUTHORITY_PUBLIC_JWK: signed.receiptTrust.jwkJson,
    MCP_STAGING_RECEIPT_AUTHORITY_KID: signed.receiptTrust.expectedKid,
    MCP_STAGING_OWNER_AUTHORITY_PUBLIC_JWK: signed.ownerTrust.jwkJson,
    MCP_STAGING_OWNER_AUTHORITY_KID: signed.ownerTrust.expectedKid,
    MCP_STAGING_NYRA_AUTHORITY_PUBLIC_JWK: JSON.stringify(nyraKeyProbe.jwk),
    MCP_STAGING_NYRA_AUTHORITY_KID: nyraKeyProbe.jwk.kid,
  };
  const coreRuntime = createMcpStagingIssuerServiceRuntime({
    env: coreIssuerEnv,
    now: () => NOW,
    replayStore: coreReplayClient.issuerReplayStore,
    targetCommit: TARGET_COMMIT,
  });
  assert.equal(nyraRuntime.jwk.kid, nyraKeyProbe.jwk.kid);
  assert.equal(coreRuntime.jwk.kid, coreKeyProbe.jwk.kid);
  const gateEnv = {
    MCP_STAGING_CORE_ISSUER_INTERNAL_HOSTPORT: ISSUER_HOSTPORTS.core,
    MCP_STAGING_NYRA_ISSUER_INTERNAL_HOSTPORT: ISSUER_HOSTPORTS.nyra,
    MCP_STAGING_CORE_ISSUER_PUBLIC_JWK: JSON.stringify(coreRuntime.jwk),
    MCP_STAGING_CORE_ISSUER_KID: coreRuntime.jwk.kid,
    MCP_STAGING_CORE_ISSUER_AUTH_TOKEN: CORE_TOKEN,
    MCP_STAGING_NYRA_ISSUER_PUBLIC_JWK: JSON.stringify(nyraRuntime.jwk),
    MCP_STAGING_NYRA_ISSUER_KID: nyraRuntime.jwk.kid,
    MCP_STAGING_NYRA_ISSUER_AUTH_TOKEN: NYRA_TOKEN,
  };
  let nyraEnvelope;
  const clients = createMcpStagingSignedIssuerGateClientFromEnv({
    env: gateEnv,
    fetchImpl: inProcessIssuerFetch({ core: coreRuntime, nyra: nyraRuntime }),
    now: () => NOW,
    targetCommit: TARGET_COMMIT,
    evidenceProvider: async (issuer) => issuer === "nyra"
      ? {
          credential_receipt: signed.credentialReceipt,
          owner_confirmation: signed.ownerConfirmation,
        }
      : {
          credential_receipt: signed.credentialReceipt,
          nyra_attestation: nyraEnvelope,
          owner_confirmation: signed.ownerConfirmation,
        },
  });

  nyraEnvelope = await clients.requestNyraAttestation(context);
  const nyraAttestationDigest = mcpStagingEvidenceDigest("mcp-staging-nyra-attestation-v1", nyraEnvelope);
  const coreContext = { ...context, nyra_attestation_digest: nyraAttestationDigest };
  const coreEnvelope = await clients.requestCoreGrant(coreContext);
  const coreGrantDigest = mcpStagingEvidenceDigest("mcp-staging-core-grant-v1", coreEnvelope);

  const consumption = {
    execution_id: "skinharmony-core-mcp-staging-render-create-v1",
    attempt_id: context.attempt_id,
    action_digest: context.action_digest,
    executor_contract_id: context.executor_contract_id,
    deployment_spec_digest: context.deployment_spec_digest,
    preflight_digest: context.preflight_digest,
    credential_grant_digest: context.credential_grant_digest,
    core_grant_digest: coreGrantDigest,
    nyra_attestation_digest: nyraAttestationDigest,
    owner_confirmation_digest: signed.ownerConfirmation.claims.owner_confirmation_digest,
  };
  const consumed = await receiptConsumerClient.verifyAndConsumeReceipt({
    credential_receipt: signed.credentialReceipt,
    owner_confirmation: signed.ownerConfirmation,
    nyra_attestation: nyraEnvelope,
    core_grant: coreEnvelope,
    consumption,
  });
  const replay = await receiptConsumerClient.verifyAndConsumeReceipt({
    credential_receipt: signed.credentialReceipt,
    owner_confirmation: signed.ownerConfirmation,
    nyra_attestation: nyraEnvelope,
    core_grant: coreEnvelope,
    consumption,
  });

  assert.equal(nyraEnvelope.claims.decision, "no_objection");
  assert.equal(coreEnvelope.claims.decision, "allow");
  assert.equal(coreEnvelope.claims.credential_receipt_verified, true);
  assert.equal(coreEnvelope.claims.confirmation_satisfied, true);
  assert.equal(coreEnvelope.claims.nyra_attestation_digest, nyraAttestationDigest);
  assert.equal(consumed.status, "consumed");
  assert.equal(consumed.idempotent, false);
  assert.equal(replay.idempotent, true);
  assert.equal(pool.consumptionInserts, 1);
  assert.equal(pool.transactions, 5);
  assert.equal(JSON.stringify({ nyraEnvelope, coreEnvelope, consumed, replay }).includes("test-only"), false);
  await controlPlane.close();
});

test("tampered receipt and a changed atomic binding fail before mutation", async () => {
  const signed = signedInputs();
  const tampered = structuredClone(signed.credentialReceipt);
  tampered.claims.target_environment = "production";
  await assert.rejects(signed.receiptVerifier(tampered), /credential_receipt_signature_invalid/);

  const pool = new TransactionalReceiptPool();
  const controlPlane = await createMcpStagingPostgresControlPlaneFromEnv({
    env: providerEnv(),
    poolFactory: async () => pool,
    consumptionEvidenceVerifier: async () => {
      throw new Error("complete_signed_evidence_rejected");
    },
    targetCommit: TARGET_COMMIT,
  });
  const actionDigest = "6".repeat(64);
  await assert.rejects(controlPlane.verifyAndConsumeReceipt({
    credential_receipt: signed.credentialReceipt,
    owner_confirmation: signed.ownerConfirmation,
    nyra_attestation: {},
    core_grant: {},
    consumption: {
      execution_id: "skinharmony-core-mcp-staging-render-create-v1",
      attempt_id: "mcpstg_11111111-2222-4333-8444-555555555555",
      action_digest: actionDigest,
      executor_contract_id: `domain_action_${actionDigest.slice(0, 20)}`,
      deployment_spec_digest: "1".repeat(64),
      preflight_digest: "2".repeat(64),
      credential_grant_digest: "0".repeat(64),
      core_grant_digest: "9".repeat(64),
      nyra_attestation_digest: "a".repeat(64),
      owner_confirmation_digest: "b".repeat(64),
    },
  }), /control_plane_consumption_evidence_verification_failed/);
  assert.equal(pool.transactions, 1);
  assert.equal(pool.receipt, null);
  await controlPlane.close();
});

test("a signed owner confirmation cannot be replayed for a different action", async () => {
  const signed = signedInputs();
  const changedAction = "f".repeat(64);
  const context = baseContext({
    credential_grant_digest: signed.credentialReceipt.claims.binding_digest,
    action_digest: changedAction,
    executor_contract_id: `domain_action_${changedAction.slice(0, 20)}`,
  });
  const verify = createMcpStagingIssuerEvidenceVerifier({
    mode: "nyra",
    receiptVerifier: signed.receiptVerifier,
    ownerConfirmationVerifier: signed.ownerVerifier,
    now: () => NOW,
    targetCommit: TARGET_COMMIT,
  });
  await assert.rejects(verify({
    schema_version: "mcp_staging_issuer_evidence_verification_request_v1",
    mode: "nyra",
    request_kind: "issue",
    request_nonce: "n".repeat(32),
    context,
    artifacts: {
      credential_receipt: signed.credentialReceipt,
      owner_confirmation: signed.ownerConfirmation,
    },
  }), /issuer_evidence_binding_invalid/);
});
