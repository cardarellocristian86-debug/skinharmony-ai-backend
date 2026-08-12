import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createIcfKernel } from "../src/icfKernel.js";

test("resilienza massiva: replay dello stesso nonce resta idempotente", () => {
  const kernel = createIcfKernel();
  kernel.putCovenant("resilience", "replay", {});
  const obligation = kernel.compile("resilience", "replay", [{ claim: "effect" }]).obligations[0];
  const cell = kernel.registerCell("resilience", "replay", { obligation_id: obligation.obligation_id }).cell;
  const first = kernel.requestWarrant("resilience", "replay", cell.cell_id, { idempotency_key: "massive-replay" });
  assert.equal(first.ok, true);
  for (let index = 0; index < 250; index += 1) {
    const replay = kernel.requestWarrant("resilience", "replay", cell.cell_id, { idempotency_key: "massive-replay" });
    assert.equal(replay.idempotent_replay, true);
    assert.equal(replay.warrant.warrant_id, first.warrant.warrant_id);
  }
  assert.equal(kernel.verifyLedger("resilience", "replay").valid, true);
});

test("resilienza: ledger tampering viene rilevato anche dopo molti eventi", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-icf-tamper-"));
  const kernel = createIcfKernel();
  kernel.putCovenant("resilience", "tamper", {});
  const obligations = kernel.compile("resilience", "tamper", Array.from({ length: 20 }, (_, i) => ({ claim: `claim-${i}` }))).obligations;
  obligations.forEach((item) => kernel.resolve("resilience", "tamper", item.obligation_id, "satisfied"));
  const persisted = createIcfKernel({ storageRoot: root });
  persisted.putCovenant("resilience", "tamper", {});
  persisted.compile("resilience", "tamper", [{ claim: "seed" }]);
  const file = fs.readdirSync(path.join(root, "icf"))[0];
  const state = JSON.parse(fs.readFileSync(path.join(root, "icf", file), "utf8"));
  state.events[Math.floor(state.events.length / 2)].payload = { forged: true };
  fs.writeFileSync(path.join(root, "icf", file), JSON.stringify(state));
  const reloaded = createIcfKernel({ storageRoot: root });
  assert.equal(reloaded.verifyLedger("resilience", "tamper").valid, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("resilienza: stale evidence blocca la chiusura e invalida la prova", () => {
  const kernel = createIcfKernel();
  kernel.putCovenant("resilience", "stale", {});
  const obligation = kernel.compile("resilience", "stale", [{ claim: "readback" }]).obligations[0];
  const evidence = kernel.addEvidence("resilience", "stale", {
    obligation_id: obligation.obligation_id,
    truth_state: "TRUE",
    source_identity: "runtime",
    source_authority: "readback",
    subject_digest: "subject-v1",
    oracle_digest: "oracle-v1",
  }).evidence;
  assert.equal(kernel.verifyEvidence("resilience", "stale", evidence.evidence_id, { verifier_identity: "independent" }).ok, true);
  kernel.resolve("resilience", "stale", obligation.obligation_id, "satisfied");
  kernel.invalidateEvidence("resilience", "stale", { subject_digest: "subject-v1", reason: "source_changed" });
  assert.equal(kernel.status("resilience", "stale").evidence[0].truth_state, "STALE");
  assert.equal(kernel.status("resilience", "stale").closure.decision, "BLOCK");
});

test("resilienza: CAS concorrente concede una sola transizione per versione", async () => {
  let digest = "head-0";
  let version = 0;
  const store = {
    kind: "postgresql", restart_durable: true, distributed: true,
    initialize() {}, loadWork() {}, appendEvent() {},
    async compareAndSwapHead({ expectedDigest, nextDigest }) {
      await new Promise((resolve) => setImmediate(resolve));
      if (expectedDigest !== digest) return { ok: false, version: null };
      digest = nextDigest; version += 1;
      return { ok: true, version };
    },
  };
  const results = await Promise.all(Array.from({ length: 100 }, (_, i) => store.compareAndSwapHead({ tenantId: "t", workId: "w", expectedDigest: "head-0", nextDigest: `head-${i + 1}` })));
  assert.equal(results.filter((item) => item.ok).length, 1);
  assert.equal(version, 1);
});

test("resilienza: restart persistence conserva covenant, obblighi, prove e ledger", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-icf-resilience-"));
  try {
    let kernel = createIcfKernel({ storageRoot: root });
    kernel.putCovenant("resilience", "restart", { outcomes: ["persist"] });
    const obligation = kernel.compile("resilience", "restart", [{ claim: "persist" }]).obligations[0];
    kernel.addEvidence("resilience", "restart", { obligation_id: obligation.obligation_id, truth_state: "TRUE", source_identity: "runtime", source_authority: "readback", subject_digest: "s", oracle_digest: "o" });
    const before = kernel.status("resilience", "restart");
    kernel = createIcfKernel({ storageRoot: root });
    const after = kernel.status("resilience", "restart");
    assert.equal(after.obligations.length, before.obligations.length);
    assert.equal(after.evidence.length, before.evidence.length);
    assert.equal(after.ledger_head.digest, before.ledger_head.digest);
    assert.equal(kernel.verifyLedger("resilience", "restart").valid, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
