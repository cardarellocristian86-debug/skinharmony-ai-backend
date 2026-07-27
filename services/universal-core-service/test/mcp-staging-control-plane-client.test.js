import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createMcpStagingIssuerReplayClientFromEnv,
  createMcpStagingReceiptConsumerClientFromEnv,
  mcpStagingControlPlaneClientContract,
} from "../src/mcpStagingControlPlaneClient.js";

const CORE_TOKEN = "control-plane-core-nonce-token-test-only-0123456789abcdef";
const NYRA_TOKEN = "control-plane-nyra-nonce-token-test-only-0123456789abcdef";
const CONSUMER_TOKEN = "control-plane-receipt-consumer-test-only-0123456789abcdef";
const TARGET_COMMIT = crypto.randomBytes(20).toString("hex");
const CONTROL_PLANE_HOST = "skinharmony-mcp-staging-db-bootstrap-a1b2";
const CONTROL_PLANE_HOSTPORT = `${CONTROL_PLANE_HOST}:10001`;
const CONTROL_PLANE_BASE_URL = `http://${CONTROL_PLANE_HOSTPORT}`;

function issuerEnv(mode, token, overrides = {}) {
  return {
    MCP_STAGING_CONTROL_PLANE_INTERNAL_HOSTPORT: CONTROL_PLANE_HOSTPORT,
    MCP_STAGING_ISSUER_MODE: mode,
    MCP_STAGING_ISSUER_NONCE_API_TOKEN: token,
    ...overrides,
  };
}

function consumerEnv(overrides = {}) {
  return {
    MCP_STAGING_CONTROL_PLANE_INTERNAL_HOSTPORT: CONTROL_PLANE_HOSTPORT,
    MCP_STAGING_RECEIPT_CONSUMER_API_TOKEN: CONSUMER_TOKEN,
    ...overrides,
  };
}

function receiptConsumer(options = {}) {
  return createMcpStagingReceiptConsumerClientFromEnv({
    ...options,
    targetCommit: TARGET_COMMIT,
  });
}

function nonceResponse() {
  return jsonResponse({
    schema_version: "mcp_staging_nonce_claim_result_v1",
    ok: true,
    claimed: true,
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(label, value) {
  return crypto.createHash("sha256")
    .update(`${label}\u0000${canonicalJson(value)}`, "utf8")
    .digest("hex");
}

function receiptRequest() {
  const actionDigest = "6".repeat(64);
  return {
    credential_receipt: {
      claims: { receipt_id: "mcpstg_receipt_0123456789abcdef" },
      signature: "synthetic-local-fixture",
    },
    owner_confirmation: {},
    core_grant: {},
    nyra_attestation: {},
    consumption: {
      execution_id: "skinharmony-core-mcp-staging-render-create-v1",
      attempt_id: "mcpstg_attempt-12345678",
      action_digest: actionDigest,
      executor_contract_id: `domain_action_${actionDigest.slice(0, 20)}`,
      deployment_spec_digest: "7".repeat(64),
      preflight_digest: "8".repeat(64),
      credential_grant_digest: "4".repeat(64),
      core_grant_digest: "9".repeat(64),
      nyra_attestation_digest: "a".repeat(64),
      owner_confirmation_digest: "b".repeat(64),
    },
  };
}

function receiptResponse(request, overrides = {}) {
  const receiptId = request.credential_receipt.claims.receipt_id;
  const evidenceDigest = overrides.evidence_digest || "1".repeat(64);
  const idempotencyKey = `mcpstg-consume-${digest("mcp-staging-receipt-consumption-v1", {
    receipt_id: receiptId,
    evidence_digest: evidenceDigest,
    ...request.consumption,
    tenant_id: "codexai",
    target_service: "skinharmony-core-mcp-staging",
    target_commit: TARGET_COMMIT,
    operation: "create_only",
  })}`;
  return jsonResponse({
    ok: true,
    status: "consumed",
    idempotent: false,
    receipt_id: receiptId,
    evidence_digest: evidenceDigest,
    execution_id: request.consumption.execution_id,
    idempotency_key: idempotencyKey,
    secrets_exposed: false,
    ...overrides,
  });
}

test("Core and Nyra replay clients are claim-only and locally mode-scoped", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return nonceResponse();
  };
  const coreSource = issuerEnv("core", CORE_TOKEN, { UNRELATED: "keep" });
  const core = createMcpStagingIssuerReplayClientFromEnv({ env: coreSource, fetchImpl });
  assert.deepEqual(Object.keys(core), ["issuerReplayStore"]);
  assert.deepEqual(Object.keys(core.issuerReplayStore).sort(), ["claim", "durable"]);
  assert.equal(core.verifyAndConsumeReceipt, undefined);
  assert.deepEqual(coreSource, { MCP_STAGING_ISSUER_MODE: "core", UNRELATED: "keep" });

  const now = Date.now();
  assert.equal(await core.issuerReplayStore.claim({
    mode: "core", nonce: "c".repeat(32), now_ms: now, expires_at: now + 20_000,
  }), true);
  await assert.rejects(
    core.issuerReplayStore.claim({
      mode: "nyra", nonce: "x".repeat(32), now_ms: now, expires_at: now + 20_000,
    }),
    (error) => error.code === "control_plane_nonce_claim_mode_forbidden",
  );

  const nyraSource = issuerEnv("nyra", NYRA_TOKEN);
  const nyra = createMcpStagingIssuerReplayClientFromEnv({ env: nyraSource, fetchImpl });
  assert.equal(nyra.verifyAndConsumeReceipt, undefined);
  assert.equal(await nyra.issuerReplayStore.claim({
    mode: "nyra", nonce: "n".repeat(32), now_ms: now, expires_at: now + 20_000,
  }), true);
  await assert.rejects(
    nyra.issuerReplayStore.claim({
      mode: "core", nonce: "y".repeat(32), now_ms: now, expires_at: now + 20_000,
    }),
    (error) => error.code === "control_plane_nonce_claim_mode_forbidden",
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.authorization, `Bearer ${CORE_TOKEN}`);
  assert.equal(calls[1].options.headers.authorization, `Bearer ${NYRA_TOKEN}`);
  assert(calls.every(({ url }) => url === `${CONTROL_PLANE_BASE_URL}/v1/issuer-nonces/claim`));
  assert(calls.every(({ options }) => options.redirect === "error"));
});

test("receipt consumer has only the consume capability and cannot claim issuer nonces", async () => {
  const calls = [];
  const request = receiptRequest();
  const source = consumerEnv({ UNRELATED: "keep" });
  const consumer = receiptConsumer({
    env: source,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return receiptResponse(request);
    },
  });
  assert.deepEqual(Object.keys(consumer), ["verifyAndConsumeReceipt"]);
  assert.equal(consumer.issuerReplayStore, undefined);
  assert.deepEqual(source, { UNRELATED: "keep" });
  const consumed = await consumer.verifyAndConsumeReceipt(request);
  assert.equal(consumed.status, "consumed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${CONTROL_PLANE_BASE_URL}/v1/credential-receipts/consume`);
  assert.equal(calls[0].options.headers.authorization, `Bearer ${CONSUMER_TOKEN}`);
  assert.equal(JSON.stringify(consumed).includes(CONSUMER_TOKEN), false);
});

test("receipt consumer rejects response mixups and validates the request before network access", async (t) => {
  const request = receiptRequest();
  const cases = [
    ["receipt", { receipt_id: "mcpstg_receipt_fedcba9876543210" }],
    ["execution", { execution_id: "wrong-staging-execution" }],
    ["idempotency", { idempotency_key: `mcpstg-consume-${"f".repeat(64)}` }],
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
      const consumer = receiptConsumer({
        env: consumerEnv(),
        fetchImpl: async () => receiptResponse(request, overrides),
      });
      await assert.rejects(
        consumer.verifyAndConsumeReceipt(request),
        (error) => error.code === "control_plane_receipt_consume_invalid",
      );
    });
  }

  let calls = 0;
  const consumer = receiptConsumer({
    env: consumerEnv(),
    fetchImpl: async () => { calls += 1; return receiptResponse(request); },
  });
  await assert.rejects(
    consumer.verifyAndConsumeReceipt({ ...request, consumption: {} }),
    (error) => error.code === "control_plane_receipt_consume_request_invalid",
  );
  assert.equal(calls, 0);
});

test("separate clients allow only the provider-native private host contract", async (t) => {
  assert.deepEqual(mcpStagingControlPlaneClientContract, {
    endpoint_env_key: "MCP_STAGING_CONTROL_PLANE_INTERNAL_HOSTPORT",
    private_service_name: "skinharmony-mcp-staging-db-bootstrap",
    private_protocol: "http",
    private_port: 10001,
    issuer_token_env_key: "MCP_STAGING_ISSUER_NONCE_API_TOKEN",
    consumer_token_env_key: "MCP_STAGING_RECEIPT_CONSUMER_API_TOKEN",
  });
  const unsafeEndpoints = [
    "https://attacker.invalid",
    `http://${CONTROL_PLANE_HOSTPORT}`,
    CONTROL_PLANE_HOST,
    "skinharmony-mcp-staging-db-bootstrap:10001",
    "skinharmony-mcp-staging-db-bootstrap-a1b2:10000",
    "skinharmony-mcp-staging-db-bootstrap-a1b2.onrender.com:10001",
    "127.0.0.1:10001",
    "user@skinharmony-mcp-staging-db-bootstrap-a1b2:10001",
    "skinharmony-mcp-staging-db-bootstrap-a1b2:10001/path",
    "skinharmony-mcp-staging-db-bootstrap-a1b2:10001?query=1",
    "skinharmony-mcp-staging-db-bootstrap-a1b2:10001#fragment",
  ];
  for (const [index, endpoint] of unsafeEndpoints.entries()) {
    await t.test(`rejects-${index}`, () => {
      const unsafeIssuer = issuerEnv("core", CORE_TOKEN, {
        MCP_STAGING_CONTROL_PLANE_INTERNAL_HOSTPORT: endpoint,
      });
      assert.throws(
        () => createMcpStagingIssuerReplayClientFromEnv({ env: unsafeIssuer }),
        /control_plane_issuer_client_config_invalid/,
      );
      assert.deepEqual(unsafeIssuer, { MCP_STAGING_ISSUER_MODE: "core" });

      const unsafeConsumer = consumerEnv({ MCP_STAGING_CONTROL_PLANE_INTERNAL_HOSTPORT: endpoint });
      assert.throws(
        () => receiptConsumer({ env: unsafeConsumer }),
        /control_plane_consumer_client_config_invalid/,
      );
      assert.deepEqual(unsafeConsumer, {});
    });
  }
});

test("provider failures are redacted after private endpoint validation", async () => {

  const marker = "remote-provider-secret-marker";
  const client = createMcpStagingIssuerReplayClientFromEnv({
    env: issuerEnv("nyra", NYRA_TOKEN),
    fetchImpl: async () => { throw new Error(marker); },
  });
  const now = Date.now();
  await assert.rejects(
    client.issuerReplayStore.claim({
      mode: "nyra", nonce: "z".repeat(32), now_ms: now, expires_at: now + 20_000,
    }),
    (error) => error.code === "control_plane_nonce_claim_unavailable" &&
      !String(error).includes(marker) && !JSON.stringify(error).includes(marker),
  );
});

test("a stalled response body is bounded and fails with a redacted unavailable error", async () => {
  const marker = "stalled-control-plane-body-secret-marker";
  const body = new ReadableStream({
    pull() { return new Promise(() => {}); },
  });
  const client = createMcpStagingIssuerReplayClientFromEnv({
    env: issuerEnv("core", CORE_TOKEN),
    timeoutMs: 100,
    fetchImpl: async () => {
      void marker;
      return new Response(body, { status: 200 });
    },
  });
  const now = Date.now();
  const startedAt = Date.now();
  await assert.rejects(
    client.issuerReplayStore.claim({
      mode: "core", nonce: "q".repeat(32), now_ms: now, expires_at: now + 20_000,
    }),
    (error) => error.code === "control_plane_nonce_claim_unavailable" &&
      !String(error).includes(marker) && !JSON.stringify(error).includes(marker),
  );
  assert(Date.now() - startedAt < 750);
});

test("a chunked JSON response larger than 64 KiB is rejected without exposing its body", async () => {
  const marker = "oversize-control-plane-body-secret-marker";
  const bytes = new TextEncoder().encode(JSON.stringify({
    schema_version: "mcp_staging_nonce_claim_result_v1",
    ok: true,
    claimed: true,
    padding: `${marker}${"x".repeat(200_000)}`,
  }));
  let cancelled = false;
  let offset = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(offset, offset + 8_192));
      offset += 8_192;
    },
    cancel() { cancelled = true; },
  });
  const client = createMcpStagingIssuerReplayClientFromEnv({
    env: issuerEnv("core", CORE_TOKEN),
    fetchImpl: async () => new Response(body, { status: 200 }),
  });
  const now = Date.now();
  await assert.rejects(
    client.issuerReplayStore.claim({
      mode: "core", nonce: "r".repeat(32), now_ms: now, expires_at: now + 20_000,
    }),
    (error) => error.code === "control_plane_nonce_claim_invalid" &&
      !String(error).includes(marker) && !JSON.stringify(error).includes(marker),
  );
  assert.equal(cancelled, true);
});

test("hostile environment getters fail closed with constant redacted config errors", () => {
  const marker = "hostile-control-plane-env-secret-marker";
  const hostileIssuer = new Proxy(issuerEnv("core", CORE_TOKEN), {
    get(target, key, receiver) {
      if (key === "MCP_STAGING_ISSUER_NONCE_API_TOKEN") throw new Error(marker);
      return Reflect.get(target, key, receiver);
    },
  });
  assert.throws(
    () => createMcpStagingIssuerReplayClientFromEnv({ env: hostileIssuer }),
    (error) => error.code === "control_plane_issuer_client_config_invalid" &&
      !String(error).includes(marker) && !JSON.stringify(error).includes(marker),
  );

  const hostileConsumer = new Proxy(consumerEnv(), {
    get(target, key, receiver) {
      if (key === "MCP_STAGING_CONTROL_PLANE_INTERNAL_HOSTPORT") throw new Error(marker);
      return Reflect.get(target, key, receiver);
    },
  });
  assert.throws(
    () => receiptConsumer({ env: hostileConsumer }),
    (error) => error.code === "control_plane_consumer_client_config_invalid" &&
      !String(error).includes(marker) && !JSON.stringify(error).includes(marker),
  );
});
