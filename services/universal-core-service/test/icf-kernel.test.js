import test from "node:test";
import assert from "node:assert/strict";
import { createIcfKernel } from "../src/icfKernel.js";

test("ICF conserva gli obblighi e blocca la chiusura finché sono aperti", () => {
  const kernel = createIcfKernel();
  assert.equal(kernel.putCovenant("t1", "w1", { outcomes: ["deploy"] }).ok, true);
  const compiled = kernel.compile("t1", "w1", [{ claim: "commit autorizzato live" }, { kind: "prohibition", claim: "nessun secret modificato" }]);
  assert.equal(compiled.obligations.length, 2);
  assert.equal(kernel.status("t1", "w1").closure.decision, "BLOCK");
  kernel.resolve("t1", "w1", compiled.obligations[0].obligation_id, "satisfied");
  kernel.resolve("t1", "w1", compiled.obligations[1].obligation_id, "satisfied");
  const status = kernel.status("t1", "w1");
  assert.equal(status.closure.decision, "ALLOW_CLOSE");
  assert.equal(status.ledger_head.seq, 4);
});

test("un covenant sigillato non viene riscritto", () => {
  const kernel = createIcfKernel();
  assert.equal(kernel.putCovenant("t1", "w2", {}).ok, true);
  assert.deepEqual(kernel.putCovenant("t1", "w2", {}).error, "covenant_sealed");
});
