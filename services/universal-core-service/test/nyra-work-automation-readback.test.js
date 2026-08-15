import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { createNyraWorkAutomationReadback } from "../src/nyraWorkAutomationReadback.js";
import { createNyraWorkAutomationReceiptService } from "../src/nyraWorkAutomationReceipt.js";

function response(body) { return { ok: true, headers: { get: () => "application/json" }, text: async () => JSON.stringify(body) }; }

test("intent readback derives the immutable objective from a signed Core anchor", async () => {
  const receipts = createNyraWorkAutomationReceiptService({ secret: "s".repeat(64) });
  const anchor = receipts.intentAnchor({ tenant_id: "tenant", work_id: "work", intent_objective: "Immutable objective" });
  const readback = createNyraWorkAutomationReadback({ intentAnchorResolver: async ({ tenant_id, work_id, intent_anchor_receipt }) => receipts.verify(intent_anchor_receipt, { expectedSchemaVersion: "nyra_immutable_intent_anchor_v1", expected: { tenant_id, work_id } }) });
  assert.equal((await readback.intent({ tenant_id: "tenant", work_id: "work", intent_anchor_receipt: anchor })).intent_objective, "Immutable objective");
  await assert.rejects(readback.intent({ tenant_id: "tenant", work_id: "other", intent_anchor_receipt: anchor }), /binding_mismatch/);
});

test("commit readback binds parent and tree", async () => {
  const commit = "a".repeat(40); const parent = "b".repeat(40); const tree = "c".repeat(40);
  const readback = createNyraWorkAutomationReadback({ fetchImpl: async () => response({ sha: commit, commit: { tree: { sha: tree } }, parents: [{ sha: parent }], files: [{ filename: "services/a.js", status: "modified", sha: "d".repeat(40), additions: 2, deletions: 1, changes: 3 }] }) });
  const result = await readback.commit({ tenant_id: "tenant", repository: "owner/repo", branch: "agent/work", commit, parent_commit: parent, tree_sha: tree });
  assert.equal(result.commit, commit);
  assert.match(result.readback_digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.changed_files, ["services/a.js"]);
});

test("commit readback rejects caller file and diff claims that differ from GitHub", async () => {
  const commit = "a".repeat(40); const parent = "b".repeat(40); const tree = "c".repeat(40);
  const readback = createNyraWorkAutomationReadback({ fetchImpl: async () => response({ sha: commit, commit: { tree: { sha: tree } }, parents: [{ sha: parent }], files: [{ filename: "smartdesk-live/a.js", status: "added", sha: "d".repeat(40), additions: 1, deletions: 0, changes: 1 }] }) });
  await assert.rejects(readback.commit({ tenant_id: "tenant", repository: "owner/repo", branch: "agent/work", commit, changed_files: ["services/a.js"] }), /files_mismatch/);
  await assert.rejects(readback.commit({ tenant_id: "tenant", repository: "owner/repo", branch: "agent/work", commit, diff_digest: "e".repeat(64) }), /diff_mismatch/);
});

test("required checks bind workflow identity, event, app and SHA", async () => {
  const head = "a".repeat(40);
  const workflowBytes = Buffer.from("name: CI\n");
  const workflowDigest = crypto.createHash("sha256").update(workflowBytes).digest("hex");
  const policy = { tenant_id: "tenant", repository: "owner/repo", base_branch: "main", required_checks: ["core"], check_app: { id: 1, slug: "github-actions", owner: "github" }, workflow: { id: 9, name: "CI", path: ".github/workflows/ci.yml", sha256: workflowDigest } };
  const replies = [
    { state: "open", draft: false, head: { sha: head, repo: { full_name: "owner/repo" } }, base: { ref: "main", repo: { full_name: "owner/repo" } } },
    { id: 9, name: "CI", path: ".github/workflows/ci.yml", state: "active" },
    { encoding: "base64", path: ".github/workflows/ci.yml", size: workflowBytes.length, content: workflowBytes.toString("base64") },
    { workflow_runs: [{ head_sha: head, event: "pull_request", conclusion: "success", path: ".github/workflows/ci.yml" }] },
    { check_runs: [{ id: 5, name: "core", head_sha: head, status: "completed", conclusion: "success", app: { id: 1, slug: "github-actions", owner: { login: "github" } } }] },
  ];
  const readback = createNyraWorkAutomationReadback({ fetchImpl: async () => response(replies.shift()), requiredChecksPolicyResolver: async () => policy });
  const result = await readback.requiredChecks({ tenant_id: "tenant", repository: "owner/repo", pull_request: 2, head_commit: head, base_branch: "main", required_checks: ["core"] });
  assert.deepEqual(result.required_checks, ["core"]);
  assert.equal(result.workflow.content_sha256, workflowDigest);
});

test("required checks reject workflow bytes whose digest is not policy-bound", async () => {
  const head = "a".repeat(40);
  const policy = { tenant_id: "tenant", repository: "owner/repo", base_branch: "main", required_checks: ["core"], check_app: { id: 1, slug: "github-actions", owner: "github" }, workflow: { id: 9, name: "CI", path: ".github/workflows/ci.yml", sha256: "f".repeat(64) } };
  const replies = [{ state: "open", draft: false, head: { sha: head, repo: { full_name: "owner/repo" } }, base: { ref: "main", repo: { full_name: "owner/repo" } } }, { id: 9, name: "CI", path: ".github/workflows/ci.yml", state: "active" }, { encoding: "base64", path: ".github/workflows/ci.yml", size: 1, content: Buffer.from("x").toString("base64") }];
  const readback = createNyraWorkAutomationReadback({ fetchImpl: async () => response(replies.shift()), requiredChecksPolicyResolver: async () => policy });
  await assert.rejects(readback.requiredChecks({ tenant_id: "tenant", repository: "owner/repo", pull_request: 2, head_commit: head, base_branch: "main" }), /workflow_content_mismatch/);
});
