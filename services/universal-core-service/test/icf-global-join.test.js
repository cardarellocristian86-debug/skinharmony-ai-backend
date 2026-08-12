import test from "node:test";
import assert from "node:assert/strict";
import { recomputeGlobalIntentJoin } from "../src/icfGlobalJoin.js";

function base() {
  return {
    snapshot_at: new Date().toISOString(),
    covenant: { clauses: [{ clause_id: "c1" }] },
    obligations: new Map([["o1", { obligation_id: "o1", status: "satisfied", clause_refs: ["c1"] }]]),
    evidence: new Map([["e1", { truth_state: "TRUE", verified: true, fresh_until: new Date(Date.now() + 60_000).toISOString() }]]),
    warrants: new Map(),
    events: [{ digest: "h1", previous_digest: null }],
  };
}

test("global join chiude solo con stato completo e fresco", () => {
  const result = recomputeGlobalIntentJoin(base());
  assert.equal(result.join_decision, "close");
  assert.match(result.join_digest, /^sha256:/);
});

test("obbligo aperto o evidence stale bloccano", () => {
  const work = base();
  work.obligations.get("o1").status = "open";
  work.evidence.get("e1").truth_state = "STALE";
  assert.equal(recomputeGlobalIntentJoin(work).join_decision, "block");
});

test("snapshot stale e ledger divergente bloccano", () => {
  const work = base();
  work.snapshot_at = new Date(Date.now() - 600_000).toISOString();
  work.events[0].previous_digest = "tampered";
  const result = recomputeGlobalIntentJoin(work);
  assert.equal(result.snapshot_fresh, false);
  assert.equal(result.ledger_head_consistent, false);
  assert.equal(result.join_decision, "block");
});
