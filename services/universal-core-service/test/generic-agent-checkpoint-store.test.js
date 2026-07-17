import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGenericAgentCheckpointStore } from "../src/genericAgentCheckpointStore.js";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "generic-agent-store-"));
  return { root, store: createGenericAgentCheckpointStore({ root, now: () => "2026-07-17T08:00:00.000Z" }) };
}

test("durable checkpoint store persists atomically with optimistic concurrency", () => {
  const { root, store } = fixture();
  try {
    const first = store.save({ tenant_id: "tenant_a", run_id: "run_1", checkpoint: { cursor: "one" }, expected_revision: 0 });
    assert.equal(first.revision, 1);
    const second = store.save({ tenant_id: "tenant_a", run_id: "run_1", checkpoint: { cursor: "two" }, expected_revision: 1 });
    assert.equal(second.revision, 2);
    assert.equal(store.load({ tenant_id: "tenant_a", run_id: "run_1" }).checkpoint.cursor, "two");
    assert.throws(() => store.save({ tenant_id: "tenant_a", run_id: "run_1", checkpoint: {}, expected_revision: 1 }), /checkpoint_revision_conflict/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("durable checkpoint store isolates tenant paths", () => {
  const { root, store } = fixture();
  try {
    store.save({ tenant_id: "tenant_a", run_id: "run_1", checkpoint: { cursor: "a" } });
    assert.equal(store.load({ tenant_id: "tenant_b", run_id: "run_1" }), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
