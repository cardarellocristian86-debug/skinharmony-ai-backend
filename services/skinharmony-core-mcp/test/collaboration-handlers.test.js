import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCollaborationHandlers } from "../src/collaboration-handlers.js";

function payload(result) {
  return result.structuredContent || JSON.parse(result.content[0].text);
}

function fixture(t, govern = async () => ({ allowed: true, decision: "allow_controlled", mediation: "allow" })) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-collaboration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, handlers: createCollaborationHandlers({ agentWorkspaceRoot: root }, { govern }) };
}

test("workspace folders and versioned documents stay inside the authenticated tenant", async (t) => {
  const { handlers } = fixture(t);
  const tenantA = { tenantId: "tenant-a", subject: "auth0|alice" };
  const tenantB = { tenantId: "tenant-b", subject: "auth0|bob" };

  const folder = payload(await handlers.workspace_create_folder({ path: "smart-desk/reports" }, tenantA));
  assert.equal(folder.created, true);
  const replay = payload(await handlers.workspace_create_folder({ path: "smart-desk/reports" }, tenantA));
  assert.equal(replay.created, false);

  const created = payload(await handlers.workspace_write_document({
    path: "smart-desk/reports/status.md", content: "ready", expected_version: 0, idempotency_key: "doc-create-1"
  }, tenantA));
  assert.equal(created.document.version, 1);

  await assert.rejects(
    handlers.workspace_write_document({ path: "smart-desk/reports/status.md", content: "unsafe overwrite" }, tenantA),
    /document_expected_version_required/
  );
  const updated = payload(await handlers.workspace_write_document({
    path: "smart-desk/reports/status.md", content: "verified", expected_version: 1
  }, tenantA));
  assert.equal(updated.document.version, 2);
  assert.equal(payload(await handlers.workspace_read_document({ id: updated.document.id }, tenantA)).document.content, "verified");
  assert.equal(payload(await handlers.workspace_list({}, tenantB)).documents.length, 0);
  await assert.rejects(handlers.workspace_create_folder({ path: "../tenant-b" }, tenantA), /workspace_path_invalid/);
});

test("tasks use optimistic claims and cannot be claimed twice", async (t) => {
  const { handlers } = fixture(t);
  const identity = { tenantId: "tenant-a", subject: "auth0|owner" };
  await handlers.agent_heartbeat({ agent_id: "codex-one" }, identity);
  await handlers.agent_heartbeat({ agent_id: "codex-two" }, identity);
  const created = payload(await handlers.task_create({ title: "Verify Nyra", priority: "high", idempotency_key: "task-1" }, identity));
  const replay = payload(await handlers.task_create({ title: "Verify Nyra", priority: "high", idempotency_key: "task-1" }, identity));
  assert.equal(replay.idempotent_replay, true);

  const claimed = payload(await handlers.task_claim({ task_id: created.task.id, agent_id: "codex-one", expected_version: 1 }, identity));
  assert.equal(claimed.task.claimed_by, "codex-one");
  await assert.rejects(
    handlers.task_claim({ task_id: created.task.id, agent_id: "codex-two", expected_version: 1 }, identity),
    /task_version_conflict/
  );
  const completed = payload(await handlers.task_update({ task_id: created.task.id, agent_id: "codex-one", status: "completed", expected_version: 2, note: "done" }, identity));
  assert.equal(completed.task.status, "completed");
});

test("registered agents exchange tenant-scoped messages", async (t) => {
  const { handlers } = fixture(t);
  const identity = { tenantId: "tenant-a", subject: "auth0|owner" };
  const outsider = { tenantId: "tenant-b", subject: "auth0|owner" };
  await handlers.agent_heartbeat({ agent_id: "codex-one", capabilities: ["analysis"] }, identity);
  await handlers.agent_heartbeat({ agent_id: "codex-two", capabilities: ["review"] }, identity);
  const posted = payload(await handlers.message_post({ from_agent_id: "codex-one", to_agent_id: "codex-two", body: "Review task 42", idempotency_key: "msg-1" }, identity));
  const inbox = payload(await handlers.message_inbox({ agent_id: "codex-two", unread_only: true }, identity));
  assert.equal(inbox.messages.length, 1);
  assert.equal(inbox.messages[0].body, "Review task 42");
  await handlers.message_acknowledge({ message_id: posted.message.id, agent_id: "codex-two" }, identity);
  assert.equal(payload(await handlers.message_inbox({ agent_id: "codex-two", unread_only: true }, identity)).messages.length, 0);
  await assert.rejects(handlers.message_inbox({ agent_id: "codex-two" }, outsider), /agent_not_registered/);
});

test("a blocked Core verdict fails closed before writing", async (t) => {
  const { root, handlers } = fixture(t, async () => ({ allowed: false, decision: "block", mediation: "hard_block" }));
  const identity = { tenantId: "tenant-a", subject: "auth0|owner" };
  await assert.rejects(handlers.task_create({ title: "Forbidden write" }, identity), /core_gate_denied/);
  assert.equal(fs.existsSync(path.join(root, "tenants", "tenant-a", "agent-workspace", "state.json")), false);
});

test("agent identities cannot be impersonated inside the same tenant", async (t) => {
  const { handlers } = fixture(t);
  const alice = { tenantId: "tenant-a", subject: "auth0|alice" };
  const bob = { tenantId: "tenant-a", subject: "auth0|bob" };
  await handlers.agent_heartbeat({ agent_id: "alice-agent" }, alice);
  const task = payload(await handlers.task_create({ title: "Private assignment" }, alice)).task;
  await assert.rejects(
    handlers.task_claim({ task_id: task.id, agent_id: "alice-agent", expected_version: 1 }, bob),
    /agent_not_registered/
  );
  await assert.rejects(handlers.message_inbox({ agent_id: "alice-agent" }, bob), /agent_not_registered/);
});
