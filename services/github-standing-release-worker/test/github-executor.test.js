import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createGitHubExecutor, createGitHubReconciler } from "../src/githubExecutor.js";

const h = (value) => crypto.createHash("sha256").update(value).digest("hex");
const base = {
  tenant_id: "customer-a", repository: "customer/example",
};
const common = { repository: "customer/example", force: false, delete_ref: false, tags: false, provider_execution: false };

function response(body, ok = true) { return { ok, async json() { return body; } }; }

test("push verifies the remote head and cannot force, delete or tag", async () => {
  const calls = [];
  const execute = createGitHubExecutor({
    installation_token: async () => "temporary-installation-token",
    fetch_impl: async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1 ? response({ object: { sha: "b".repeat(40) } }) : response({ object: { sha: "a".repeat(40) } });
    },
  });
  const result = await execute({ ...base, action: {
    ...common, kind: "git.push.branch", branch: "agent/change", source_commit: "a".repeat(40),
    expected_remote_commit: "b".repeat(40), changed_files: ["src/app.js"], induced_effects: [],
  }});
  assert.equal(result.result_commit, "a".repeat(40));
  assert.deepEqual(JSON.parse(calls[1].options.body), { sha: "a".repeat(40), force: false });
  await assert.rejects(
    execute({ ...base, action: { ...common, kind: "git.push.branch", branch: "agent/change", force: true } }),
    /safety_invalid/,
  );
});

test("draft PR accepts only title and body bound by the Core digests", async () => {
  const title = "Bounded change";
  const body = "Exact standing release body";
  const execute = createGitHubExecutor({
    installation_token: async () => "temporary-installation-token",
    fetch_impl: async () => response({ number: 12, draft: true, head: { sha: "a".repeat(40) }, base: { sha: "b".repeat(40) } }),
  });
  const action = {
    ...common, kind: "github.draft_pr", head_branch: "agent/change", base_branch: "main",
    head_commit: "a".repeat(40), expected_base_commit: "b".repeat(40), changed_files: ["src/app.js"],
    title_digest: h(title), body_digest: h(body), draft: true,
  };
  assert.equal((await execute({ ...base, action }, { materialization: { title, body } })).result_pull_request, 12);
  await assert.rejects(execute({ ...base, action }, { materialization: { title: "changed", body } }), /digest_mismatch/);
});

test("ready stays bound to the exact PR head while merge is manual-only", async () => {
  const pull = { number: 12, node_id: "PR_node", draft: true, merged: false, head: { sha: "a".repeat(40), ref: "agent/change" }, base: { sha: "b".repeat(40), ref: "main" } };
  let calls = 0;
  const execute = createGitHubExecutor({
    installation_token: async () => "temporary-installation-token",
    fetch_impl: async (_url, options) => {
      calls += 1;
      if (calls === 1) return response(pull);
      if (options?.body?.includes("markPullRequestReadyForReview")) return response({ data: { markPullRequestReadyForReview: { pullRequest: { number: 12, isDraft: false, headRefOid: "a".repeat(40) } } } });
      return response({ merged: true, sha: "c".repeat(40) });
    },
  });
  const readyAction = { ...common, kind: "github.ready", head_branch: "agent/change", base_branch: "main", pull_request: 12, head_commit: "a".repeat(40), expected_base_commit: "b".repeat(40), draft_before: true, ready_for_review: true };
  assert.equal((await execute({ ...base, action: readyAction })).result_pull_request, 12);

  const mergeAction = { ...common, kind: "github.merge", head_branch: "agent/change", base_branch: "main", pull_request: 12, head_commit: "a".repeat(40), expected_base_commit: "b".repeat(40), checks_commit: "a".repeat(40), checks_verified: true, merge_method: "merge", induced_effects: [] };
  let mergeTokenCalls = 0;
  let mergeFetchCalls = 0;
  const mergeExecutor = createGitHubExecutor({
    installation_token: async () => { mergeTokenCalls += 1; return "must-not-run"; },
    fetch_impl: async () => { mergeFetchCalls += 1; return response({ merged: true }); },
  });
  await assert.rejects(mergeExecutor({ ...base, action: mergeAction }), /github_worker_manual_merge_only/);
  assert.equal(mergeTokenCalls, 0);
  assert.equal(mergeFetchCalls, 0);
});

test("reconciliation proves an exact effect without repeating it", async () => {
  const reconciler = createGitHubReconciler({
    installation_token: async () => "temporary-installation-token",
    fetch_impl: async () => response({ object: { sha: "a".repeat(40) } }),
  });
  const outcome = await reconciler({ ...base, action: {
    ...common, kind: "git.push.branch", branch: "agent/change", source_commit: "a".repeat(40),
    expected_remote_commit: "b".repeat(40), changed_files: ["src/app.js"], induced_effects: [],
  }});
  assert.equal(outcome.state, "succeeded");
  assert.equal(outcome.result.reconciled, true);
});
