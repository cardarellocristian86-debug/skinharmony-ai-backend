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

test("draft PR reconciliation searches bounded pages before proving the exact effect", async () => {
  const calls = [];
  const exactPull = {
    number: 42,
    head: { sha: "a".repeat(40) },
    base: { sha: "b".repeat(40) },
  };
  const reconciler = createGitHubReconciler({
    installation_token: async () => "temporary-installation-token",
    fetch_impl: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("page=1")) {
        return response(Array.from({ length: 20 }, (_, index) => ({
          number: index + 1,
          head: { sha: "c".repeat(40) },
          base: { sha: "b".repeat(40) },
        })));
      }
      return response([exactPull]);
    },
  });
  const outcome = await reconciler({ ...base, action: {
    ...common,
    kind: "github.draft_pr",
    head_branch: "agent/change",
    base_branch: "main",
    head_commit: "a".repeat(40),
    expected_base_commit: "b".repeat(40),
  }});
  assert.equal(outcome.state, "succeeded");
  assert.equal(outcome.result.result_pull_request, 42);
  assert.equal(calls.length, 2);
  assert(calls.every(({ options }) => options.method === "GET"));
});

test("draft PR reconciliation never proves absence from a full bounded result set", async () => {
  const calls = [];
  const reconciler = createGitHubReconciler({
    installation_token: async () => "temporary-installation-token",
    fetch_impl: async (url, options) => {
      calls.push({ url, options });
      return response(Array.from({ length: 20 }, (_, index) => ({
        number: index + 1,
        head: { sha: "c".repeat(40) },
        base: { sha: "b".repeat(40) },
      })));
    },
  });
  await assert.rejects(reconciler({ ...base, action: {
    ...common,
    kind: "github.draft_pr",
    head_branch: "agent/change",
    base_branch: "main",
    head_commit: "a".repeat(40),
    expected_base_commit: "b".repeat(40),
  }}), (error) => error.code === "github_worker_reconciliation_ambiguous");
  assert.equal(calls.length, 5);
  assert(calls.every(({ options }) => options.method === "GET"));
});

test("a timed-out GitHub mutation is aborted once and never retried", async () => {
  const calls = [];
  let mutationSignal = null;
  const execute = createGitHubExecutor({
    installation_token: async () => "temporary-installation-token",
    request_timeout_ms: 10,
    fetch_impl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return response({ object: { sha: "b".repeat(40) } });
      mutationSignal = options.signal;
      return new Promise(() => {});
    },
  });
  await assert.rejects(execute({ ...base, action: {
    ...common, kind: "git.push.branch", branch: "agent/change", source_commit: "a".repeat(40),
    expected_remote_commit: "b".repeat(40), changed_files: ["src/app.js"], induced_effects: [],
  }}), (error) => error.code === "github_api_request_timeout" && error.status === 504);
  assert.equal(calls.length, 2);
  assert.equal(mutationSignal?.aborted, true);
});

test("the cold token-read-mutation path shares one shrinking request deadline", async () => {
  let clock = 0;
  let tokenBudget = null;
  let mutationSignal = null;
  const calls = [];
  const execute = createGitHubExecutor({
    request_timeout_ms: 30,
    request_deadline_ms: 35,
    deadline_now: () => clock,
    installation_token: async (_binding, { deadline }) => {
      tokenBudget = deadline.remainingTimeoutMs(30);
      clock += 10;
      return "temporary-installation-token";
    },
    fetch_impl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        clock += 20;
        return response({ object: { sha: "b".repeat(40) } });
      }
      mutationSignal = options.signal;
      return new Promise(() => {});
    },
  });
  const started = Date.now();
  await assert.rejects(execute({ ...base, action: {
    ...common, kind: "git.push.branch", branch: "agent/change", source_commit: "a".repeat(40),
    expected_remote_commit: "b".repeat(40), changed_files: ["src/app.js"], induced_effects: [],
  }}), (error) => error.code === "github_api_request_timeout" &&
    error.execution_outcome === "unknown" && error.mutation_dispatched === true);
  assert.equal(tokenBudget, 30);
  assert.equal(calls.length, 2);
  assert.equal(mutationSignal?.aborted, true);
  assert(Date.now() - started < 200, "global residual budget must end the cold path promptly");
});

test("reconciliation rejects an oversized GitHub read without performing a mutation", async () => {
  const calls = [];
  const reconciler = createGitHubReconciler({
    installation_token: async () => "temporary-installation-token",
    response_limit_bytes: 64,
    fetch_impl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ payload: "x".repeat(256) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await assert.rejects(reconciler({ ...base, action: {
    ...common, kind: "git.push.branch", branch: "agent/change", source_commit: "a".repeat(40),
    expected_remote_commit: "b".repeat(40), changed_files: ["src/app.js"], induced_effects: [],
  }}), (error) => error.code === "github_api_response_too_large" && error.status === 502);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
});
