import assert from "node:assert/strict";
import test from "node:test";
import { createCollaborationIssuerClient } from "../src/collaboration-issuer-client.js";
import { collaborationDigest } from "../src/collaboration-receipt.js";

const config = {
  collaborationCoreIssuerHostport: "skinharmony-core-staging-issuer:8789",
  collaborationNyraIssuerHostport: "skinharmony-nyra-staging-issuer:8789",
  collaborationCoreIssuerToken: "core-transient-token-value",
  collaborationNyraIssuerToken: "nyra-transient-token-value",
  collaborationIssuerTimeoutMs: 1_000,
  collaborationReceiptTtlMs: 20_000,
};

const coreGate = Object.freeze({
  claims: Object.freeze({ schema_version: "mcp_collaboration_core_gate_v1" }),
  signature: "a".repeat(43),
});

test("requests Nyra before Core on fixed private endpoints without returning tokens", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body, authorization_present: typeof options.headers.authorization === "string" });
    const authority = url.includes("nyra-attest") ? "nyra" : "core";
    return new Response(JSON.stringify({
      ok: true,
      envelope: { claims: { authority, jti: body.jti }, signature: `${authority}-signature-placeholder` },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = createCollaborationIssuerClient(config, {
    fetchImpl,
    now: () => Date.parse("2026-07-22T20:00:00.000Z"),
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
    randomBytes: () => Buffer.alloc(24, 7),
  });
  const binding = { schema_version: "test-binding" };
  const receipt = await client.issue(binding, { coreDecision: {
    binding_digest: collaborationDigest("mcp-collaboration-binding-v1", binding),
    decision: "authorized",
    mediation: "allow",
    confirmation_satisfied: true,
  }, coreGate });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "http://skinharmony-nyra-staging-issuer:8789/v1/mcp-staging/collaboration/nyra-attest");
  assert.equal(calls[1].url, "http://skinharmony-core-staging-issuer:8789/v1/mcp-staging/collaboration/core-grant");
  assert.equal(calls.every((call) => call.authorization_present), true);
  assert.deepEqual(calls[1].body.nyra_attestation, receipt.nyra);
  assert.equal("issued_at" in calls[0].body, false);
  assert.equal("expires_at" in calls[1].body, false);
  assert.equal(calls[1].body.decision.binding_digest, receipt.decision.binding_digest);
  assert.deepEqual(calls[1].body.core_gate, coreGate);
  assert.equal(receipt.core.claims.authority, "core");
  assert.equal(JSON.stringify(receipt).includes("transient-token"), false);
});

test("requires an allowed Core decision bound to the exact collaboration binding", async () => {
  const client = createCollaborationIssuerClient(config, {
    fetchImpl: async () => { throw new Error("must_not_call"); },
  });
  await assert.rejects(client.issue({ schema_version: "binding" }), /collaboration_core_decision_invalid/);
  await assert.rejects(client.issue({ schema_version: "binding" }, { coreDecision: {
    binding_digest: "0".repeat(64),
    decision: "authorized",
    mediation: "allow",
    confirmation_satisfied: true,
  } }), /collaboration_core_decision_invalid/);
  const binding = { schema_version: "binding" };
  await assert.rejects(client.issue(binding, { coreDecision: {
    binding_digest: collaborationDigest("mcp-collaboration-binding-v1", binding),
    decision: "authorized",
    mediation: "allow",
    confirmation_satisfied: true,
  } }), /collaboration_core_gate_invalid/);
});

test("rejects shared credentials and non-private endpoint hostnames", () => {
  assert.throws(() => createCollaborationIssuerClient({
    ...config,
    collaborationNyraIssuerToken: config.collaborationCoreIssuerToken,
  }), /collaboration_independent_issuer_tokens_required/);
  assert.throws(() => createCollaborationIssuerClient({
    ...config,
    collaborationCoreIssuerHostport: "issuer.example.com:8787",
  }), /core_collaboration_issuer_hostport_invalid/);
  assert.throws(() => createCollaborationIssuerClient({
    ...config,
    collaborationCoreIssuerHostport: "unrelated-internal:8789",
  }), /core_collaboration_issuer_hostport_invalid/);
  assert.throws(() => createCollaborationIssuerClient({
    ...config,
    collaborationNyraIssuerHostport: "skinharmony-core-staging-issuer:8789",
  }), /nyra_collaboration_issuer_hostport_invalid/);
});

test("rejects oversized or rejected issuer responses with bounded public errors", async () => {
  const binding = { schema_version: "test-binding" };
  const options = { coreDecision: {
    binding_digest: collaborationDigest("mcp-collaboration-binding-v1", binding),
    decision: "authorized",
    mediation: "allow",
    confirmation_satisfied: true,
  }, coreGate };
  const oversized = createCollaborationIssuerClient(config, {
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, envelope: { padding: "x".repeat(70_000) } }), { status: 200 }),
  });
  await assert.rejects(oversized.issue(binding, options), /nyra_collaboration_issuer_response_too_large/);

  const rejected = createCollaborationIssuerClient(config, {
    fetchImpl: async () => new Response("upstream private detail", { status: 403 }),
  });
  await assert.rejects(rejected.issue(binding, options), (error) => {
    assert.equal(error.message, "nyra_collaboration_issuer_forbidden");
    assert.equal(error.status, 403);
    assert.equal(error.retryable, false);
    assert.equal(error.message.includes("private detail"), false);
    return true;
  });
});

test("classifies issuer authentication, throttling and outages without exposing response bodies", async () => {
  const binding = { schema_version: "test-binding" };
  const options = { coreDecision: {
    binding_digest: collaborationDigest("mcp-collaboration-binding-v1", binding),
    decision: "authorized",
    mediation: "allow",
    confirmation_satisfied: true,
  }, coreGate };
  for (const [upstreamStatus, expected] of [
    [401, ["nyra_collaboration_issuer_auth_required", 403, false]],
    [429, ["nyra_collaboration_issuer_rate_limited", 429, true]],
    [503, ["nyra_collaboration_issuer_unavailable", 503, true]],
  ]) {
    const client = createCollaborationIssuerClient(config, {
      fetchImpl: async () => new Response("sensitive upstream detail", { status: upstreamStatus }),
    });
    await assert.rejects(client.issue(binding, options), (error) => {
      assert.deepEqual([error.code, error.status, error.retryable], expected);
      assert.equal(error.message.includes("sensitive"), false);
      return true;
    });
  }
});

test("health probe requires both independent issuer runtimes to advertise collaboration readiness", async () => {
  const healthyFetch = async (url, options) => {
    assert.equal(options.method, "GET");
    const mode = url.includes("core-staging") ? "core" : "nyra";
    return new Response(JSON.stringify({
      ok: true,
      mode,
      issuer: mode === "core" ? "universal-core-staging" : "nyra-staging",
      evidence_verifier_configured: true,
      replay_store_durable: true,
      collaboration_receipt_ready: true,
      core_gate_verifier_configured: mode === "core",
    }), { status: 200 });
  };
  assert.equal(await createCollaborationIssuerClient(config, { fetchImpl: healthyFetch }).probe(), true);

  const degradedFetch = async (url, options) => {
    const response = await healthyFetch(url, options);
    if (url.includes("nyra-staging")) {
      const payload = await response.json();
      return new Response(JSON.stringify({ ...payload, collaboration_receipt_ready: false }), { status: 200 });
    }
    return response;
  };
  assert.equal(await createCollaborationIssuerClient(config, { fetchImpl: degradedFetch }).probe(), false);
});

test("health probe rejects production issuer identities on staging endpoints", async () => {
  const fetchImpl = async (url) => {
    const mode = url.includes("core-staging") ? "core" : "nyra";
    return new Response(JSON.stringify({
      ok: true,
      mode,
      issuer: mode === "core" ? "universal-core" : "nyra",
      evidence_verifier_configured: true,
      replay_store_durable: true,
      collaboration_receipt_ready: true,
    }), { status: 200 });
  };
  assert.equal(await createCollaborationIssuerClient(config, { fetchImpl }).probe(), false);
});
