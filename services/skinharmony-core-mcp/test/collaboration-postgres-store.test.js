import assert from "node:assert/strict";
import test from "node:test";
import { createCollaborationPostgresStore } from "../src/collaboration-postgres-store.js";

class FakePool {
  constructor({ sessionConflict = false, presenceConflict = false } = {}) {
    this.mutations = [];
    this.queries = [];
    this.sessionConflict = sessionConflict;
    this.presenceConflict = presenceConflict;
  }

  async connect() {
    return this;
  }

  release() {}

  async end() {}

  async query(sql, params = []) {
    this.queries.push(sql);
    if (/CREATE TABLE IF NOT EXISTS/.test(sql) || ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
      return { rowCount: 0, rows: [] };
    }
    if (/SELECT agent_id,signature,session_fingerprint,client_type FROM agent_presence/.test(sql)) {
      const [, agentId, actor, signature, fingerprint] = params;
      const owned = agentId === "agent-one" &&
        actor === "auth0|owner" &&
        signature === "ags_current" &&
        fingerprint === "fp_current";
      return {
        rowCount: owned ? 1 : 0,
        rows: owned ? [{ agent_id: agentId, signature, session_fingerprint: fingerprint, client_type: "codex" }] : [],
      };
    }
    if (/INSERT INTO agent_sessions/.test(sql)) {
      return { rowCount: this.sessionConflict ? 0 : 1, rows: this.sessionConflict ? [] : [{ session_id: params[1] }] };
    }
    if (/INSERT INTO agent_presence/.test(sql)) {
      return {
        rowCount: this.presenceConflict ? 0 : 1,
        rows: this.presenceConflict ? [] : [{
          agent_id: params[1],
          signature: params[3],
          session_fingerprint: params[4],
          client_type: params[5],
          display_name: params[6],
          capabilities: [],
          version: 1,
        }],
      };
    }
    if (/UPDATE agent_tasks SET status=/.test(sql)) {
      this.mutations.push("task.update");
      return { rowCount: 1, rows: [{ id: params[1], claimed_by: params[2], status: params[3], version: params[4] + 1 }] };
    }
    if (/UPDATE agent_task_leases/.test(sql)) return { rowCount: 1, rows: [] };
    if (/UPDATE agent_message_deliveries/.test(sql)) {
      this.mutations.push("message.acknowledge");
      return { rowCount: 1, rows: [{ message_id: params[1], agent_id: params[2] }] };
    }
    if (/SELECT m\.\*/.test(sql)) return { rowCount: 0, rows: [] };
    if (/INSERT INTO agent_events/.test(sql)) return { rowCount: 1, rows: [] };
    throw new Error(`unexpected_query:${sql.slice(0, 80)}`);
  }
}

const govern = async () => ({
  allowed: true,
  decision: "authorized",
  mediation: "allow",
  confirmation_satisfied: false,
});

function identity(overrides = {}) {
  return {
    tenantId: "tenant-a",
    subject: "auth0|owner",
    agentPresence: {
      signature: "ags_current",
      session_fingerprint: "fp_current",
    },
    ...overrides,
  };
}

test("Postgres heartbeat binds session ids and permits only expired-session recovery", async () => {
  const pool = new FakePool();
  const store = createCollaborationPostgresStore(
    { collaborationDatabaseUrl: "postgres://test" },
    { govern, pool }
  );
  await store.heartbeat({
    agent_id: "agent-one",
    session_id: "session-one",
    client_type: "codex",
    display_name: "Agent One",
    capabilities: ["coordination"],
  }, identity());
  const sessionQuery = pool.queries.find((sql) => /INSERT INTO agent_sessions/.test(sql));
  const presenceQuery = pool.queries.find((sql) => /INSERT INTO agent_presence/.test(sql));
  assert.match(sessionQuery, /agent_sessions\.agent_id=EXCLUDED\.agent_id/);
  assert.match(sessionQuery, /agent_sessions\.actor_subject=EXCLUDED\.actor_subject/);
  assert.match(sessionQuery, /agent_sessions\.expires_at<=now\(\)/);
  assert.match(presenceQuery, /agent_presence\.expires_at<=now\(\)/);

  const conflicted = createCollaborationPostgresStore(
    { collaborationDatabaseUrl: "postgres://test" },
    { govern, pool: new FakePool({ sessionConflict: true }) }
  );
  await assert.rejects(
    conflicted.heartbeat({
      agent_id: "agent-one",
      session_id: "session-one",
      client_type: "codex",
    }, identity()),
    /agent_session_conflict/
  );
});

test("Postgres task updates require the active owned agent session", async () => {
  const pool = new FakePool();
  const store = createCollaborationPostgresStore(
    { collaborationDatabaseUrl: "postgres://test" },
    { govern, pool }
  );
  await store.updateTask({
    task_id: "11111111-1111-4111-8111-111111111111",
    agent_id: "agent-one",
    status: "completed",
    expected_version: 2,
  }, identity());
  assert.deepEqual(pool.mutations, ["task.update"]);

  for (const unsafeIdentity of [
    identity({ subject: "auth0|other" }),
    identity({ agentPresence: { signature: "ags_other", session_fingerprint: "fp_current" } }),
    identity({ agentPresence: { signature: "ags_current", session_fingerprint: "fp_other" } }),
    identity({ agentPresence: null }),
  ]) {
    await assert.rejects(
      store.updateTask({
        task_id: "11111111-1111-4111-8111-111111111111",
        agent_id: "agent-one",
        status: "completed",
        expected_version: 2,
      }, unsafeIdentity),
      /agent_not_registered|agent_presence_session_required/
    );
  }
  assert.deepEqual(pool.mutations, ["task.update"]);
});

test("Postgres inbox and acknowledgements cannot impersonate another agent session", async () => {
  const pool = new FakePool();
  const store = createCollaborationPostgresStore(
    { collaborationDatabaseUrl: "postgres://test" },
    { govern, pool }
  );
  const acknowledged = await store.acknowledge({
    message_id: "22222222-2222-4222-8222-222222222222",
    agent_id: "agent-one",
  }, identity());
  assert.equal(acknowledged.structuredContent.acknowledged_by_signature, "ags_current");
  await store.inbox({ agent_id: "agent-one", unread_only: true, limit: 10 }, identity());

  await assert.rejects(
    store.acknowledge({
      message_id: "22222222-2222-4222-8222-222222222222",
      agent_id: "agent-two",
    }, identity()),
    /agent_not_registered/
  );
  await assert.rejects(
    store.inbox({ agent_id: "agent-two", unread_only: true, limit: 10 }, identity()),
    /agent_not_registered/
  );
  assert.deepEqual(pool.mutations, ["message.acknowledge"]);
});
