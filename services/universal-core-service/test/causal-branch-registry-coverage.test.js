import assert from "node:assert/strict";
import test from "node:test";
import { deterministicBranchRegistry } from "../branches/index.js";
import { extendCausalBranchRegistry } from "../src/causalBranchContract.js";
import { causalDigest } from "../src/causalContinuityCanonical.js";

test("all registered logical branches inherit the shared causal contract", () => {
  const registry = extendCausalBranchRegistry(deterministicBranchRegistry());
  const ids = Object.keys(registry).sort();
  assert.equal(ids.length, 76);
  for (const id of ids) {
    const contract = registry[id];
    assert.equal(contract.requires_causal_context, true, id);
    assert.equal(contract.context_schema_version, "causal_context_envelope_v1", id);
    assert(Array.isArray(contract.authority_scope) === false, `${id}: authority is received from the envelope, never stored on the branch`);
    assert(Array.isArray(contract.allowed_environments) && contract.allowed_environments.length > 0, id);
    assert(Array.isArray(contract.required_observers), id);
    assert(Array.isArray(contract.inherited_constraints), id);
  }
  const digest = causalDigest(ids.map((id) => ({ id, ...registry[id] })));
  assert.equal(digest, "466bbcb2ba21fcfecc49bafe2caf198af0c72fe76442d2f38a4e86c7d7872f17");
});

test("the 74 active-advisory candidates retain evidence-only causal authority", () => {
  const registry = extendCausalBranchRegistry(deterministicBranchRegistry());
  const advisory = Object.entries(registry).filter(([, contract]) => contract.production_status === "advisory");
  assert.equal(advisory.length, 74);
  for (const [id, contract] of advisory) {
    assert.equal(contract.can_propose_intent_revision, false, id);
    assert.equal(contract.can_approve_intent_revision, false, id);
    assert.equal(contract.can_create_change, false, id);
    assert.equal(contract.can_execute_change, false, id);
    assert.equal(contract.can_produce_evidence, true, id);
    assert.equal(contract.can_reconcile_outcome, false, id);
    assert.equal(contract.can_close_obligation, false, id);
  }
});
