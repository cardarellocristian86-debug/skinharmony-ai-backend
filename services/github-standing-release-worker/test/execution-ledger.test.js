import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFileExecutionLedger } from "../src/executionLedger.js";

const secret = "ledger-signing-secret-at-least-32-bytes-long";
const claim = Object.freeze({
  nonce: "a".repeat(64), tenant_id: "customer-a", repository: "customer/example",
  ticket_id: "ticket-1", reservation_id: "reservation-1", action_digest: "b".repeat(64),
});

test("ledger is durable, idempotent and never retries an in-progress effect", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "github-worker-ledger-"));
  const ledger = createFileExecutionLedger({ root, signing_secret: secret, now: () => 1_700_000_000_000 });
  assert.equal(ledger.accept(claim).state, "accepted");
  assert.equal(ledger.accept(claim).state, "accepted");
  assert.equal(ledger.begin(claim).state, "in_progress");
  const restarted = createFileExecutionLedger({ root, signing_secret: secret, now: () => 1_700_000_001_000 });
  assert.equal(restarted.begin(claim).state, "outcome_unknown");
  assert.equal(restarted.read(claim.nonce).state, "outcome_unknown");
  assert.equal(restarted.reconcile(claim, { state: "failed", result: { reconciled: true } }).state, "failed");
  assert.throws(() => restarted.accept({ ...claim, repository: "other/repo" }), /replay_conflict/);
});

test("successful execution persists an exact terminal result", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "github-worker-ledger-"));
  const ledger = createFileExecutionLedger({ root, signing_secret: secret, now: () => 1_700_000_000_000 });
  ledger.accept(claim);
  ledger.begin(claim);
  const record = ledger.finish(claim, { state: "succeeded", result: { commit: "c".repeat(40) } });
  assert.equal(record.result.commit, "c".repeat(40));
  assert.equal(ledger.begin(claim).state, "succeeded");
});

test("tampered ledger fails closed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "github-worker-ledger-"));
  const ledger = createFileExecutionLedger({ root, signing_secret: secret });
  ledger.accept(claim);
  const file = path.join(root, "github-worker-executions.json");
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  state.records[claim.nonce].repository = "attacker/repo";
  fs.writeFileSync(file, JSON.stringify(state));
  assert.throws(() => ledger.read(claim.nonce), /ledger_corrupt/);
});
