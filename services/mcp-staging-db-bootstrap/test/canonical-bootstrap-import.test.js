import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  canonicalBootstrapImportContract,
  createCanonicalBootstrapLiveApprovalVerifier,
  executeCanonicalBootstrapImport,
} from "../src/canonical-bootstrap-import.js";
import {
  canonicalBootstrapCommandContract,
  readCanonicalBootstrapBundle,
} from "../src/canonical-bootstrap-command.js";
import {
  CANONICAL_BOOTSTRAP_PATHS,
  createCanonicalBootstrapBundle,
} from "../../mcp-staging-canonical-bootstrap/src/index.js";

const COMMIT = "a".repeat(40);
const NOW = Date.parse("2026-07-23T12:00:05.000Z");
const EXPECTED = Object.freeze({
  schema_version: "mcp_staging_canonical_bootstrap_approval_request_v1",
  tenant_id: "codexai",
  executor_service: "skinharmony-mcp-staging-db-bootstrap",
  control_role: "mcp_staging_gate_control",
  target_service: "skinharmony-core-mcp-staging",
  target_environment: "staging",
  target_database: "skinharmony_mcp_staging_db",
  target_commit: COMMIT,
  bootstrap_id: "mcpboot_0123456789abcdefghijkl",
  bundle_sha256: "b".repeat(64),
  canonical_paths_sha256: "c".repeat(64),
  document_count: 8,
});

function trust() {
  return {
    core: {
      kid: `ed25519-sha256:${"1".repeat(64)}`,
      jwkJson: "{}",
    },
    nyra: {
      kid: `ed25519-sha256:${"2".repeat(64)}`,
      jwkJson: "{}",
    },
  };
}

function config() {
  return {
    targetCommit: COMMIT,
    coreKey: "core-service-key-that-never-appears-in-results",
    coreIssuerToken: "core-issuer-token-that-never-appears-in-results",
    nyraIssuerToken: "nyra-issuer-token-that-never-appears-in-results",
  };
}

function coreResponse(overrides = {}) {
  return new Response(JSON.stringify({
    ok: true,
    tenant_id: "codexai",
    authorization: {
      allowed: true,
      state: "authorized_after_confirmation",
      mediation: "confirmed",
      confirmation_satisfied: true,
    },
    collaboration_core_gate: {
      claims: { schema_version: "mcp_collaboration_core_gate_v1" },
      signature: "d".repeat(43),
    },
    ...overrides,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function canonicalBundle() {
  return createCanonicalBootstrapBundle({
    bootstrap_id: EXPECTED.bootstrap_id,
    target_commit: COMMIT,
    created_at: "2026-07-23T11:59:30.000Z",
    documents: CANONICAL_BOOTSTRAP_PATHS.map((documentPath) => ({
      title: documentPath.split("/").at(-1),
      content: documentPath === "SHARED_MEMORY/STATE.json"
        ? JSON.stringify({
            tenant: "codexai",
            active_task_count: 0,
            active_lock_count: 0,
          })
        : documentPath === "SHARED_MEMORY/TASKS.json"
          ? JSON.stringify({ tenant: "codexai", count: 0, tasks: [] })
          : documentPath === "SHARED_MEMORY/LOCKS.json"
            ? JSON.stringify({ tenant: "codexai", count: 0, locks: [] })
            : documentPath === "SHARED_MEMORY/ARTIFACTS.json"
              ? JSON.stringify({ tenant: "codexai", count: 0, artifacts: [] })
              : "# Reviewed and redacted\n",
      redaction_count: 0,
      redaction_status: "reviewed_redacted",
    })),
  });
}

class ImportPool {
  constructor() {
    this.ended = 0;
    this.commands = [];
  }

  async connect() {
    const pool = this;
    return {
      async query(input) {
        const name = typeof input === "string" ? input : input.name;
        pool.commands.push(name);
        if (name === "canonical-bootstrap-database-and-role-binding-v2") {
          return {
            rowCount: 1,
            rows: [{
              database_name: "skinharmony_mcp_staging_db",
              current_user: "mcp_staging_gate_control",
              session_user: "mcp_staging_gate_control",
            }],
          };
        }
        if (name === "canonical-bootstrap-existing-consumption-v1") {
          return { rowCount: 0, rows: [] };
        }
        if (name === "canonical-bootstrap-empty-data-plane-v1") {
          return { rowCount: 1, rows: [{ tenant_row_count: 0 }] };
        }
        if (name === "canonical-bootstrap-consume-receipt-pair-v1") {
          return {
            rowCount: 2,
            rows: [
              { issuer: "universal-core-staging" },
              { issuer: "nyra-staging" },
            ],
          };
        }
        if (name === "canonical-bootstrap-database-time-v1") {
          return { rowCount: 1, rows: [{ consumed_at: new Date(NOW) }] };
        }
        return { rowCount: 1, rows: [{}] };
      },
      release() {},
    };
  }

  async end() {
    this.ended += 1;
  }
}

test("binds the canonical import to Core, Nyra, the exact commit, and a verified receipt", async () => {
  const calls = [];
  let issued;
  let verified;
  const receipt = Object.freeze({
    schema_version: "mcp_collaboration_verified_receipt_v1",
    tenant_id: "codexai",
    jti: "mcpcr_0123456789abcdefghijkl",
    binding_digest: "e".repeat(64),
    receipt_digest: "f".repeat(64),
    issued_at: "2026-07-23T12:00:00.000Z",
    expires_at: "2026-07-23T12:00:20.000Z",
    authorities: Object.freeze([
      Object.freeze({
        issuer: "universal-core-staging",
        kid: trust().core.kid,
        receipt_digest: "3".repeat(64),
      }),
      Object.freeze({
        issuer: "nyra-staging",
        kid: trust().nyra.kid,
        receipt_digest: "4".repeat(64),
      }),
    ]),
  });
  const verifier = createCanonicalBootstrapLiveApprovalVerifier({
    config: config(),
    trust: trust(),
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return coreResponse();
    },
    issuerClientFactory: (issuerConfig) => ({
      ready: true,
      async issue(binding, options) {
        issued = { issuerConfig, binding, options };
        return { binding, decision: options.coreDecision, core: {}, nyra: {} };
      },
    }),
    receiptVerifierFactory: () => ({
      ready: true,
      async verify(bundle, context) {
        verified = { bundle, context };
        return receipt;
      },
    }),
  });

  const result = await verifier.verify(Object.freeze({ opaque: true }), EXPECTED);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://skinharmony-universal-core-staging:8787/v1/action-evaluator");
  assert.equal(calls[0].init.signal instanceof AbortSignal, true);
  assert.equal(calls[0].init.headers["x-sh-tenant-id"], "codexai");
  const coreBody = JSON.parse(calls[0].init.body);
  assert.equal(coreBody.action_type, "canonical.bootstrap");
  assert.equal(coreBody.target, "skinharmony_mcp_staging_db/SHARED_MEMORY");
  assert.equal(coreBody.payload_sha256, EXPECTED.bundle_sha256);
  assert.equal(coreBody.collaboration_target_commit, COMMIT);
  assert.equal(coreBody.operation_class, "reversible_internal_collaboration_write");
  assert.equal(coreBody.owner_confirmed, true);
  assert.equal(coreBody.cross_tenant, false);
  assert.equal(coreBody.contains_secret, false);
  assert.equal(issued.binding.tool_name, "canonical_bootstrap_import");
  assert.equal(issued.binding.action_type, "canonical.bootstrap");
  assert.equal(issued.binding.target_commit, COMMIT);
  assert.equal(issued.binding.trace_id, "11111111-1111-4111-8111-111111111111");
  assert.match(issued.binding.idempotency_key_sha256, /^[a-f0-9]{64}$/);
  assert.equal(issued.options.coreGate.signature, "d".repeat(43));
  assert.equal(verified.context.action.action_type, "canonical.bootstrap");
  assert.equal(verified.context.identity.tenantId, "codexai");
  assert.equal(result.approval.approval_jti, receipt.jti);
  assert.equal(result.approval.authorities[0].role, "final_authority");
  assert.equal(result.approval.authorities[1].role, "advisory_veto");
  assert.equal(result.receipt_evidence, receipt);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(config().coreKey), false);
  assert.equal(serialized.includes(config().coreIssuerToken), false);
  assert.equal(serialized.includes(config().nyraIssuerToken), false);
});

test("fails closed before issuer invocation when Core denies the exact binding", async () => {
  let issuerCalls = 0;
  const verifier = createCanonicalBootstrapLiveApprovalVerifier({
    config: config(),
    trust: trust(),
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    fetchImpl: async () => coreResponse({
      authorization: {
        allowed: false,
        state: "blocked",
        mediation: "hard_block",
        confirmation_satisfied: false,
      },
    }),
    issuerClientFactory: () => ({
      ready: true,
      async issue() {
        issuerCalls += 1;
      },
    }),
    receiptVerifierFactory: () => ({
      ready: true,
      async verify() {},
    }),
  });
  await assert.rejects(
    verifier.verify(Object.freeze({ opaque: true }), EXPECTED),
    /canonical_bootstrap_core_denied/,
  );
  assert.equal(issuerCalls, 0);
});

test("rejects a non-JSON Core response before issuer invocation", async () => {
  let issuerCalls = 0;
  const verifier = createCanonicalBootstrapLiveApprovalVerifier({
    config: config(),
    trust: trust(),
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    fetchImpl: async () => new Response("not-json", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }),
    issuerClientFactory: () => ({
      ready: true,
      async issue() {
        issuerCalls += 1;
      },
    }),
    receiptVerifierFactory: () => ({
      ready: true,
      async verify() {},
    }),
  });
  await assert.rejects(
    verifier.verify(Object.freeze({ opaque: true }), EXPECTED),
    /canonical_bootstrap_core_response_invalid/,
  );
  assert.equal(issuerCalls, 0);
});

test("command accepts only bounded stdin JSON and exposes a sanitized contract", async () => {
  assert.deepEqual(
    await readCanonicalBootstrapBundle(Readable.from([Buffer.from('{"ok":true}')])),
    { ok: true },
  );
  await assert.rejects(
    readCanonicalBootstrapBundle(Readable.from([])),
    /canonical_bootstrap_stdin_required/,
  );
  await assert.rejects(
    readCanonicalBootstrapBundle(Readable.from([Buffer.alloc(
      canonicalBootstrapCommandContract.max_stdin_bytes + 1,
      0x61,
    )])),
    /canonical_bootstrap_stdin_too_large/,
  );
  assert.equal(canonicalBootstrapCommandContract.provider_transfer, "render_native_ssh");
  assert.equal(canonicalBootstrapCommandContract.secrets_in_input, false);
  assert.equal(canonicalBootstrapImportContract.tenant_id, "codexai");
});

test("executes with a control-role URL in memory and scrubs every provider reference", async () => {
  const env = {
    PG_ADMIN_DATABASE_URL:
      "postgresql://mcp_collaboration_runtime:runtime-private-value@staging-db.internal:5432/skinharmony_mcp_staging_db",
    PG_EXPECTED_DATABASE_NAME: "skinharmony_mcp_staging_db",
    MCP_STAGING_GATE_CONTROL_PASSWORD: "control-password-value-012345678901",
    MCP_STAGING_UNIVERSAL_CORE_HOSTPORT: "skinharmony-universal-core-staging:8787",
    MCP_STAGING_UNIVERSAL_CORE_KEY: "core-service-key-that-never-appears-in-results",
    MCP_STAGING_CORE_ISSUER_HOSTPORT: "skinharmony-core-staging-issuer:8789",
    MCP_STAGING_NYRA_ISSUER_HOSTPORT: "skinharmony-nyra-staging-issuer:8789",
    MCP_STAGING_CORE_ISSUER_TOKEN: "core-issuer-token-that-never-appears-in-results",
    MCP_STAGING_NYRA_ISSUER_TOKEN: "nyra-issuer-token-that-never-appears-in-results",
    MCP_STAGING_DEPENDENCY_BUILD_COMMIT: COMMIT,
  };
  const pool = new ImportPool();
  let poolUrl;
  let trustInput;
  let issuedBinding;
  const result = await executeCanonicalBootstrapImport({
    bundle: canonicalBundle(),
    env,
    now: () => NOW,
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    fetchImpl: async () => coreResponse(),
    poolFactory: async (connectionString) => {
      poolUrl = new URL(connectionString);
      return pool;
    },
    trustDiscoverer: async (input) => {
      trustInput = input;
      return trust();
    },
    issuerClientFactory: () => ({
      ready: true,
      async issue(binding, options) {
        issuedBinding = binding;
        return { binding, decision: options.coreDecision, core: {}, nyra: {} };
      },
    }),
    receiptVerifierFactory: () => ({
      ready: true,
      async verify() {
        return {
          schema_version: "mcp_collaboration_verified_receipt_v1",
          tenant_id: "codexai",
          jti: "mcpcr_0123456789abcdefghijkl",
          binding_digest: "e".repeat(64),
          receipt_digest: "f".repeat(64),
          issued_at: "2026-07-23T12:00:00.000Z",
          expires_at: "2026-07-23T12:00:20.000Z",
          authorities: [
            {
              issuer: "universal-core-staging",
              kid: trust().core.kid,
              receipt_digest: "3".repeat(64),
            },
            {
              issuer: "nyra-staging",
              kid: trust().nyra.kid,
              receipt_digest: "4".repeat(64),
            },
          ],
        };
      },
    }),
  });

  assert.equal(result.bootstrapped, true);
  assert.equal(result.target_commit, COMMIT);
  assert.equal(poolUrl.username, "mcp_staging_gate_control");
  assert.equal(decodeURIComponent(poolUrl.password), "control-password-value-012345678901");
  assert.equal(poolUrl.pathname, "/skinharmony_mcp_staging_db");
  assert.equal(trustInput.coreHostport, "skinharmony-core-staging-issuer:8789");
  assert.equal(trustInput.nyraHostport, "skinharmony-nyra-staging-issuer:8789");
  assert.equal(issuedBinding.target_commit, COMMIT);
  assert.equal(pool.commands.at(-1), "COMMIT");
  assert.equal(pool.ended, 1);
  assert.deepEqual(Object.keys(env), []);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("runtime-private-value"), false);
  assert.equal(serialized.includes("control-password-value"), false);
  assert.equal(serialized.includes("issuer-token"), false);
});
