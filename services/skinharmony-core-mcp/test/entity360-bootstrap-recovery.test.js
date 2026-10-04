import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const wrapper = source.slice(source.indexOf("async function bootstrapCanonicalWorkEntity360Context"),
  source.indexOf("function canonicalWorkEntity360ContextReady"));
const work = { work_id: "25790eaa-4180-5d36-b84e-1df53b498a2f", created_at: "2026-09-23T00:00:00Z" };
const identity = { tenantId: "tenant-recovery-test" };
const entityId = `e360_${"a".repeat(48)}`;
const reply = (result) => ({ structuredContent: { ok: true, result } });

function fixture({ changeHead = true, verificationValid = true, mutateSnapshot } = {}) {
  let snapshot = {
    tenant_scope: identity.tenantId, entity_id: entityId, entity_type: "work",
    project_work_linkage: { work_id: work.work_id }, context_status: "INCOMPLETE",
    snapshot_version: 3, deterministic_immutable_digest: "b".repeat(64),
    execution_authorized: false, production_decision_mutation: false,
    missing_context: [{ fact_id: "governance.icf.binding", mandatory: true,
      high_impact: true, reason_codes: ["CURRENT_FACT_MISSING", "ONLY_STALE_EVIDENCE_AVAILABLE"] }],
  };
  if (mutateSnapshot) mutateSnapshot(snapshot);
  const calls = [];
  const handlers = {
    entity_360_policy_read: async () => reply({ schema_version: "entity_360_policy_read_v1",
      tenant_scope: identity.tenantId, execution_authorized: false,
      feature_flag: { mode: "ENFORCED", enabled: true, revision: 1 } }),
    entity_360_resolve: async () => reply({ status: "RESOLVED", entity_id: entityId }),
    entity_360_snapshot_latest: async () => { calls.push(`read:${snapshot.snapshot_version}`); return reply(snapshot); },
    entity_360_snapshot_verify: async (input) => {
      calls.push(`verify:${input.snapshot_version}`);
      return reply({ valid: verificationValid, tenant_scope: identity.tenantId,
        snapshot_digest: input.snapshot_digest,
        independently_recomputed_by: "universal_core_entity360_verifier" });
    },
    entity_360_work_snapshot_bootstrap: async () => { throw new Error("unexpected_initial_bootstrap"); },
  };
  const recover = async (input, caller) => {
    assert.equal(caller, identity);
    assert.deepEqual(input, { work_id: work.work_id, expected_snapshot_version: 3,
      expected_snapshot_digest: "b".repeat(64) });
    calls.push("recover:3");
    if (changeHead) snapshot = { ...snapshot, context_status: "READY", snapshot_version: 4,
      deterministic_immutable_digest: "c".repeat(64), missing_context: [] };
  };
  // Execute the production orchestration, mocking only authenticated transport.
  const bootstrap = new Function("crypto", "stableCanonical", "ensureNyraReadBinding",
    "workContinuityRuntime", "requireCanonicalWorkRead", "entity360Handlers",
    "recoverExistingIncompleteWorkContext", `${wrapper}\nreturn bootstrapCanonicalWorkEntity360Context;`)(
    crypto, (value) => value, async () => ({ work_id: work.work_id, state: "active",
      execution_authorized: false, external_action_authorized: false }), {}, async () => {}, handlers, recover);
  return { run: () => bootstrap(identity, work), calls };
}

test("MCP bootstrap verifies stale revision before recovery and rereads the verified successor", async () => {
  const { run, calls } = fixture();
  const context = await run();
  assert.equal(context.state, "READY");
  assert.equal(context.snapshot_version, 4);
  assert.equal(context.snapshot_digest, "c".repeat(64));
  assert.equal(context.execution_authorized, false);
  assert.equal(context.gate_digest, undefined);
  assert.deepEqual(calls, ["read:3", "verify:3", "recover:3", "read:4", "verify:4"]);
});

test("MCP bootstrap stops after one recovery attempt when the incomplete head persists", async () => {
  const { run, calls } = fixture({ changeHead: false });
  await assert.rejects(run(), /entity360_work_snapshot_readback_invalid/);
  assert.deepEqual(calls, ["read:3", "verify:3", "recover:3", "read:3", "verify:3"]);
});

test("MCP bootstrap rejects invalid integrity, tenant binding and unrelated missing context before recovery", async () => {
  for (const config of [
    { verificationValid: false },
    { mutateSnapshot: (value) => { value.tenant_scope = "other-tenant"; } },
    { mutateSnapshot: (value) => { value.missing_context.push({ fact_id: "intent" }); } },
    { mutateSnapshot: (value) => { value.context_status = "CONFLICTED"; } },
  ]) {
    const { run, calls } = fixture(config);
    await assert.rejects(run());
    assert.equal(calls.some((call) => call.startsWith("recover:")), false);
  }
});
