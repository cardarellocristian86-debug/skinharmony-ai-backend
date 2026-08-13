import test from "node:test";
import assert from "node:assert/strict";
import { createIcfKernel } from "../src/icfKernel.js";

test("ICF conserva gli obblighi e blocca la chiusura finché sono aperti", () => {
  const kernel = createIcfKernel();
  const covenant = kernel.putCovenant("t1", "w1", { outcomes: ["deploy"] }).covenant;
  const compiled = kernel.compile("t1", "w1", [{ claim: "commit autorizzato live", clause_refs: [covenant.clauses[0].clause_id] }, { kind: "prohibition", claim: "nessun secret modificato" }]);
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

test("coverage, frontier, warrant e residual conservano la catena causale", () => {
  const kernel = createIcfKernel();
  kernel.putCovenant("t2", "w1", { outcomes: ["release"] });
  const root = kernel.compile("t2", "w1", [{ claim: "release autorizzato", criticality: "critical" }]).obligations[0];
  const split = kernel.decompose("t2", "w1", root.obligation_id, [{ claim: "commit verified" }, { claim: "health verified" }], { predicates: ["release autorizzato"], invariants: [], prohibitions: [] });
  assert.equal(split.ok, true);
  const cell = kernel.registerCell("t2", "w1", { obligation_ids: [split.obligations[0].obligation_id], action: { capability_id: "readback" } }).cell;
  assert.equal(kernel.frontier("t2", "w1").cells.length, 1);
  const warrant = kernel.requestWarrant("t2", "w1", cell.cell_id, { capability_id: "readback" }).warrant;
  assert.equal(kernel.reserveWarrant("t2", "w1", warrant.warrant_id).ok, true);
  const reconciliation = kernel.reconcile("t2", "w1", { cell_id: cell.cell_id, expected_delta: { commit: "a" }, observed_delta: { commit: "b" }, obligation_ids: [split.obligations[0].obligation_id] });
  assert.equal(reconciliation.result.truth_state, "CONFLICTING");
  assert.ok(reconciliation.result.residual_obligation_id);
  assert.equal(kernel.status("t2", "w1").closure.decision, "BLOCK");
});

test("waiver senza autorità è rifiutato", () => {
  const kernel = createIcfKernel();
  kernel.putCovenant("t3", "w1", {});
  const obligation = kernel.compile("t3", "w1", [{ claim: "x" }]).obligations[0];
  assert.equal(kernel.resolve("t3", "w1", obligation.obligation_id, "waived").error, "waiver_authority_required");
});

test("il Work sopravvive al restart e il drift invalida la prova", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-icf-"));
  let kernel = createIcfKernel({ storageRoot: root });
  kernel.putCovenant("t4", "w1", {});
  const obligation = kernel.compile("t4", "w1", [{ claim: "readback" }]).obligations[0];
  kernel.addEvidence("t4", "w1", { obligation_id: obligation.obligation_id, truth_state: "TRUE", source_identity: "source-a", subject_digest: "subject-a", oracle_digest: "oracle-a" });
  kernel = createIcfKernel({ storageRoot: root });
  assert.equal(kernel.status("t4", "w1").evidence.length, 1);
  kernel.invalidateEvidence("t4", "w1", { subject_digest: "subject-a", reason: "artifact_changed" });
  assert.equal(kernel.status("t4", "w1").evidence[0].truth_state, "STALE");
  fs.rmSync(root, { recursive: true, force: true });
});

test("closure barrier richiede doppio join e produce CoreSeal", () => {
  const kernel = createIcfKernel();
  const covenant = kernel.putCovenant("t5", "w1", { outcomes: ["release"], anti_goals: ["secret_changed"] }).covenant;
  const compiled = kernel.compile("t5", "w1", [{ claim: "release", clause_refs: [covenant.clauses[0].clause_id], criticality: "high" }, { claim: "secret unchanged", kind: "prohibition", clause_refs: [covenant.clauses[1].clause_id] }]);
  for (const obligation of compiled.obligations) kernel.resolve("t5", "w1", obligation.obligation_id, "satisfied");
  const begin = kernel.beginClosure("t5", "w1");
  assert.equal(begin.ok, true);
  assert.equal(kernel.localJoin("t5", "w1", begin.snapshot).ok, true);
  assert.equal(kernel.globalJoin("t5", "w1", begin.snapshot, { result: "release", secret_changed: false }).ok, true);
  const seal = kernel.issueCoreSeal("t5", "w1");
  assert.equal(seal.ok, true);
  assert.equal(seal.seal.closure_class, "SEALED_COMPLETE");
});

test("warrant idempotente e crash dopo reservation producono UNKNOWN", () => {
  const kernel = createIcfKernel();
  kernel.putCovenant("t6", "w1", {});
  const obligation = kernel.compile("t6", "w1", [{ claim: "effect" }]).obligations[0];
  const cell = kernel.registerCell("t6", "w1", { obligation_id: obligation.obligation_id, retry_budget: 1 }).cell;
  const first = kernel.requestWarrant("t6", "w1", cell.cell_id, { idempotency_key: "same-op" }).warrant;
  const replay = kernel.requestWarrant("t6", "w1", cell.cell_id, { idempotency_key: "same-op" });
  assert.equal(replay.idempotent_replay, true);
  kernel.reserveWarrant("t6", "w1", first.warrant_id);
  assert.equal(kernel.reserveWarrant("t6", "w1", first.warrant_id).idempotent_replay, true);
  const report = kernel.reportExecution("t6", "w1", first.warrant_id, { status: "unknown" });
  assert.equal(report.warrant.status, "unknown");
  assert.equal(kernel.retryCell("t6", "w1", cell.cell_id).error, "retry_blocked_unknown_effect");
});

test("una prova TRUE richiede provenance e verifier indipendente", () => {
  const kernel = createIcfKernel();
  kernel.putCovenant("t7", "w1", {});
  const obligation = kernel.compile("t7", "w1", [{ claim: "readback" }]).obligations[0];
  const evidence = kernel.addEvidence("t7", "w1", { obligation_id: obligation.obligation_id, truth_state: "TRUE", source_identity: "executor", source_authority: "runtime_readback", subject_digest: "subject", oracle_digest: "oracle" }).evidence;
  assert.equal(kernel.verifyEvidence("t7", "w1", evidence.evidence_id, { verifier_identity: "executor" }).error, "independent_verifier_required");
  assert.equal(kernel.verifyEvidence("t7", "w1", evidence.evidence_id, { verifier_identity: "release-verifier" }).ok, true);
  assert.equal(kernel.status("t7", "w1").evidence[0].verified, true);
});

test("Coverage Certificate rifiuta split semanticamente incompleto e supporta merge", () => {
  const kernel = createIcfKernel();
  const covenant = kernel.putCovenant("t8", "w1", { outcomes: ["a"] }).covenant;
  const root = kernel.compile("t8", "w1", [{ claim: "a", clause_refs: [covenant.clauses[0].clause_id] }]).obligations[0];
  assert.equal(kernel.decompose("t8", "w1", root.obligation_id, [{ claim: "partial", clause_refs: [] }], { predicates: ["a"] }).error, "coverage_incomplete");
  const children = kernel.compile("t8", "w1", [{ claim: "a1", clause_refs: [covenant.clauses[0].clause_id] }, { claim: "a2", clause_refs: [covenant.clauses[0].clause_id] }]).obligations;
  assert.equal(kernel.merge("t8", "w1", children.map((item) => item.obligation_id), { claim: "a merged" }).ok, true);
});

test("il drift a monte invalida obblighi, celle e prove discendenti", () => {
  const kernel = createIcfKernel();
  kernel.putCovenant("t9", "w1", {});
  const root = kernel.compile("t9", "w1", [{ claim: "root" }]).obligations[0];
  const child = kernel.compile("t9", "w1", [{ claim: "child", parent_ids: [root.obligation_id] }]).obligations[0];
  const cell = kernel.registerCell("t9", "w1", { obligation_id: child.obligation_id }).cell;
  const evidence = kernel.addEvidence("t9", "w1", { obligation_id: child.obligation_id, cell_id: cell.cell_id, source_identity: "runtime", source_authority: "readback", subject_digest: "s", oracle_digest: "o", truth_state: "TRUE" }).evidence;
  kernel.invalidateGraph("t9", "w1", { obligation_id: root.obligation_id, reason: "artifact_changed" });
  const status = kernel.status("t9", "w1");
  assert.equal(status.cells.find((item) => item.cell_id === cell.cell_id).status, "stale");
  assert.equal(status.evidence.find((item) => item.evidence_id === evidence.evidence_id).truth_state, "STALE");
});

test("report duplicati sono idempotenti e il ledger resta verificabile", () => {
  const kernel = createIcfKernel();
  kernel.putCovenant("t10", "w1", {});
  const obligation = kernel.compile("t10", "w1", [{ claim: "effect" }]).obligations[0];
  const cell = kernel.registerCell("t10", "w1", { obligation_id: obligation.obligation_id }).cell;
  const warrant = kernel.requestWarrant("t10", "w1", cell.cell_id, {}).warrant;
  kernel.reserveWarrant("t10", "w1", warrant.warrant_id);
  assert.equal(kernel.reportExecution("t10", "w1", warrant.warrant_id, { status: "effect_confirmed" }).ok, true);
  assert.equal(kernel.reportExecution("t10", "w1", warrant.warrant_id, { status: "effect_confirmed" }).idempotent_replay, true);
  assert.equal(kernel.verifyLedger("t10", "w1").valid, true);
});
