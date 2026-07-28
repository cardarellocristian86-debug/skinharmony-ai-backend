import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGenericAgentCheckpointStore } from "../src/genericAgentCheckpointStore.js";
import { createGenericAgentRuntime } from "../src/genericAgentRuntime.js";

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

test("durable checkpoints persist only digest-safe state and run metadata", () => {
  const { root, store } = fixture();
  const email = "mario.rossi@example.test";
  const phone = "+39 333 1234567";
  const secret = "ghp_abcdefghijklmnopqrstuv";
  try {
    const saved = store.save({
      tenant_id: "tenant_a",
      run_id: "run_private",
      checkpoint: {
        schema_version: "generic_agent_checkpoint_v1",
        cursor: `resume ${email}`,
        idempotency_key: "checkpoint-private",
        state: {
          raw_prompt: `Contact ${email}`,
          phone,
          secret,
        },
      },
      run_snapshot: {
        schema_version: "generic_agent_run_v1",
        run_id: "run_private",
        tenant_id: "tenant_a",
        agent_id: "agent_private",
        session_id: "session_private",
        parent_run_id: null,
        task: `Analyze ${email} ${phone} ${secret}`,
        tools: ["read_file"],
        metadata: {
          raw_prompt: `Contact ${email}`,
          agentic_control: {
            applied: false,
            reviewer_required: true,
            selected_tools: ["read_file"],
            execution_authorized: false,
          },
        },
        learning_mode: "governed_read_only",
        model_budget: { max_model_calls: 0, max_total_tokens: 0 },
        status: "running",
        created_at: "2026-07-17T08:00:00.000Z",
        updated_at: "2026-07-17T08:00:00.000Z",
        checkpoint: {
          schema_version: "generic_agent_checkpoint_v1",
          cursor: `resume ${email}`,
          idempotency_key: "checkpoint-private",
          state: { raw_prompt: secret },
        },
        model_usage: { model_calls: 0, reserved_tokens: 0 },
        trace: [{
          id: "trace_private",
          at: "2026-07-17T08:00:00.000Z",
          event: "run_completed",
          data: { result: { content: `Result ${email} ${secret}` } },
        }],
      },
      expected_revision: 0,
    });
    assert.equal(saved.schema_version, "generic_agent_checkpoint_store_v2");
    assert.match(saved.checkpoint.state.state_digest, /^sha256:[a-f0-9]{64}$/);
    assert.match(saved.run_snapshot.task, /^task_digest:sha256:[a-f0-9]{64}$/);
    assert.equal(saved.raw_content_persisted, false);

    const files = fs.readdirSync(root, { recursive: true })
      .filter((entry) => String(entry).endsWith(".json"));
    assert.equal(files.length, 1);
    const disk = fs.readFileSync(path.join(root, files[0]), "utf8");
    for (const raw of [email, phone, secret, "raw_prompt", "Analyze ", "Result "]) {
      assert.equal(disk.includes(raw), false, `checkpoint disk must not contain ${raw}`);
    }
    const loaded = store.load({ tenant_id: "tenant_a", run_id: "run_private" });
    assert.deepEqual(loaded, saved);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("server-generated numeric UUID identifiers are not mistaken for phone numbers", () => {
  const { root, store } = fixture();
  const generated = "12345678-1234-1234-1234-123456789012";
  try {
    const runtime = createGenericAgentRuntime({
      idFactory: () => generated,
      now: () => "2026-07-17T08:00:00.000Z",
    });
    const run = runtime.startRun({
      tenant_id: "tenant_a",
      agent_id: "agent_a",
      task: "Bounded task",
    });
    const checkpointed = runtime.checkpointRun({
      tenant_id: "tenant_a",
      run_id: run.run_id,
      checkpoint: {
        state: { ready: true },
        cursor: "ready",
        idempotency_key: "checkpoint-numeric-uuid",
      },
    });
    assert.doesNotThrow(() => store.save({
      tenant_id: "tenant_a",
      run_id: run.run_id,
      checkpoint: checkpointed.checkpoint,
      run_snapshot: checkpointed,
    }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("durable checkpoint store rejects sensitive identifiers even without a run snapshot", () => {
  const { root, store } = fixture();
  try {
    assert.throws(() => store.save({
      tenant_id: "mario.rossi@example.test",
      run_id: "run_safe",
      checkpoint: { cursor: "ready" },
    }), /tenant_id_invalid/);
    assert.throws(() => store.save({
      tenant_id: "tenant_a",
      run_id: "run:+39-333-1234567",
      checkpoint: { cursor: "ready" },
    }), /run_id_invalid/);
    assert.throws(() => store.load({
      tenant_id: "tenant_a",
      run_id: "mario.rossi@example.test",
    }), /run_id_invalid/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
