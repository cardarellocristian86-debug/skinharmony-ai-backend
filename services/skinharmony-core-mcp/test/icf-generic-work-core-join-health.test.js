import assert from "node:assert/strict";
import test from "node:test";
import {
  createCoreHandlers,
  projectIcfGenericWorkCoreJoinAttestation,
} from "../src/core-handlers.js";

const readyJoin = Object.freeze({
  enabled: true,
  state: "ready",
  ready: true,
  backend: "postgres_append_only_v1",
  restart_durable: true,
  distributed: true,
  signer_mode: "hmac_icf",
  signer_state: "configured",
  signer_configured: true,
  reason: null,
});

const attestation = (join = readyJoin) => ({
  ok: true,
  schema: "nyra.icf.runtime-attestation/1.0",
  generic_work_core_join: join,
});

test("core_health replaces only Generic Join with authenticated ICF readiness", async () => {
  const calls = [];
  const remoteEd25519 = {
    enabled: true,
    state: "signer_unavailable",
    ready: false,
    signer_mode: "disabled",
    signer_state: "unconfigured",
  };
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
  }, {
    fetchImpl: async (url, init) => {
      calls.push({ path: new URL(url).pathname, authorization: init.headers.authorization });
      const payload = new URL(url).pathname === "/healthz"
        ? { ok: true, service: "universal-core-service", generic_work_core_join: remoteEd25519 }
        : attestation();
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await handlers.core_health({}, { tenantId: "tenant-a" });
  assert.deepEqual(result.structuredContent.generic_work_core_join, readyJoin);
  assert.deepEqual(
    result.structuredContent.generic_work_core_join_remote_ed25519,
    remoteEd25519,
  );
  assert.equal(result.structuredContent.service, "universal-core-service");
  assert.deepEqual(calls, [
    { path: "/healthz", authorization: "Bearer tenant-a-key" },
    { path: "/v1/icf/runtime/attestation", authorization: "Bearer tenant-a-key" },
  ]);
  assert.equal(result.content[0].text.includes("private"), false);
});

test("ICF attestation projection preserves explicit fail-closed blockers", () => {
  const cases = [
    ["signer", {
      ...readyJoin,
      enabled: false,
      state: "signer_unavailable",
      ready: false,
      signer_state: "unconfigured",
      signer_configured: false,
      reason: "generic_work_core_join_signer_unconfigured",
    }],
    ["ledger", {
      ...readyJoin,
      enabled: false,
      state: "unavailable",
      ready: false,
      backend: "unavailable",
      restart_durable: false,
      distributed: false,
      reason: "generic_work_core_join_postgres_unavailable",
    }],
    ["restart durability", {
      ...readyJoin,
      enabled: false,
      state: "durability_or_signing_unavailable",
      ready: false,
      restart_durable: false,
      reason: "generic_work_core_join_durable_store_unavailable",
    }],
    ["distributed", {
      ...readyJoin,
      enabled: false,
      state: "durability_or_signing_unavailable",
      ready: false,
      distributed: false,
      reason: "generic_work_core_join_distributed_store_unavailable",
    }],
  ];
  for (const [name, join] of cases) {
    const projected = projectIcfGenericWorkCoreJoinAttestation(attestation(join));
    assert.equal(projected.enabled, false, name);
    assert.equal(projected.ready, false, name);
    assert.equal(projected.reason, join.reason, name);
  }
});

test("core_health fails closed when ICF attestation is unavailable", async () => {
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
  }, {
    fetchImpl: async (url) => {
      if (new URL(url).pathname === "/healthz") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error("network unavailable");
    },
  });

  const result = await handlers.core_health({}, { tenantId: "tenant-a" });
  assert.equal(result.structuredContent.generic_work_core_join.enabled, false);
  assert.equal(result.structuredContent.generic_work_core_join.ready, false);
  assert.equal(
    result.structuredContent.generic_work_core_join.signer_state,
    "unavailable",
  );
  assert.equal(
    result.structuredContent.generic_work_core_join.reason,
    "generic_work_core_join_attestation_unavailable",
  );
});

test("core_health fails closed when ICF attestation is malformed", async () => {
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.test",
    universalCoreKeys: { "tenant-a": "tenant-a-key" },
  }, {
    fetchImpl: async (url) => new Response(JSON.stringify(
      new URL(url).pathname === "/healthz"
        ? { ok: true }
        : attestation({ ...readyJoin, signer_mode: "remote", ready: true }),
    ), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });

  const result = await handlers.core_health({}, { tenantId: "tenant-a" });
  assert.equal(result.structuredContent.generic_work_core_join.enabled, false);
  assert.equal(result.structuredContent.generic_work_core_join.ready, false);
  assert.equal(
    result.structuredContent.generic_work_core_join.reason,
    "generic_work_core_join_attestation_invalid",
  );
});
