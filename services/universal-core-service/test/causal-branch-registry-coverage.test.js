import assert from "node:assert/strict";
import test from "node:test";
import { deterministicBranchRegistry } from "../branches/index.js";
import { extendCausalBranchRegistry } from "../src/causalBranchContract.js";
import { causalDigest } from "../src/causalContinuityCanonical.js";

test("all registered logical branches inherit the shared causal contract", () => {
  const registry = extendCausalBranchRegistry(deterministicBranchRegistry());
  const ids = Object.keys(registry).sort();
  assert.equal(ids.length, 72);
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
  assert.equal(digest, "c01a0f659a048d175758f9273123f7ba52b2835ec32aae6707f41d10a8632656");
});
