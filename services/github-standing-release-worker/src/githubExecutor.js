import crypto from "node:crypto";

const SHA = /^[a-f0-9]{40}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactKeys(value, allowed, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${code}:${key}`);
}

function sha(value, code) {
  if (typeof value !== "string" || !SHA.test(value)) fail(code);
  return value;
}

function branch(value) {
  if (typeof value !== "string" || !BRANCH.test(value) || value.includes("..") || value.endsWith("/")) fail("github_worker_branch_invalid");
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeAction(action) {
  if (action.provider_execution !== false || action.force !== false || action.delete_ref !== false || action.tags !== false) {
    fail("github_worker_action_safety_invalid");
  }
  branch(action.head_branch || action.branch);
  if (action.base_branch !== undefined) branch(action.base_branch);
}

async function json(response, code) {
  let body;
  try { body = await response.json(); } catch { fail(code); }
  if (!response.ok) fail(code);
  return body;
}

export function createGitHubExecutor({ installation_token, fetch_impl = fetch } = {}) {
  if (typeof installation_token !== "function" || typeof fetch_impl !== "function") fail("github_worker_executor_invalid");

  return async function execute(claim, { materialization = null } = {}) {
    const action = claim.action;
    if (action?.kind === "github.merge") fail("github_worker_manual_merge_only");
    safeAction(action);
    const token = await installation_token({ tenant_id: claim.tenant_id, repository: claim.repository });
    const root = `https://api.github.com/repos/${claim.repository}`;
    const headers = {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "skinharmony-standing-release-worker/1",
      "x-github-api-version": "2022-11-28",
    };
    const call = (url, options = {}) => fetch_impl(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });

    if (action.kind === "git.push.branch") {
      exactKeys(materialization || {}, new Set(), "github_worker_materialization_invalid");
      const branchName = branch(action.branch);
      const source = sha(action.source_commit, "github_worker_source_commit_invalid");
      const expected = sha(action.expected_remote_commit, "github_worker_remote_commit_invalid");
      const current = await json(await call(`${root}/git/ref/heads/${encodeURIComponent(branchName)}`), "github_worker_ref_read_failed");
      const currentSha = sha(current?.object?.sha, "github_worker_ref_read_failed");
      if (currentSha === source) return { outcome: "success", result_commit: source, idempotent: true };
      if (currentSha !== expected) fail("github_worker_remote_head_drift");
      const updated = await json(await call(`${root}/git/refs/heads/${encodeURIComponent(branchName)}`, {
        method: "PATCH", body: JSON.stringify({ sha: source, force: false }),
      }), "github_worker_push_failed");
      if (updated?.object?.sha !== source) fail("github_worker_push_readback_mismatch");
      return { outcome: "success", result_commit: source, idempotent: false };
    }

    if (action.kind === "github.draft_pr") {
      exactKeys(materialization, new Set(["title", "body"]), "github_worker_materialization_invalid");
      if (typeof materialization.title !== "string" || typeof materialization.body !== "string" ||
          materialization.title.length < 1 || materialization.title.length > 256 || materialization.body.length > 20_000 ||
          sha256(materialization.title) !== action.title_digest || sha256(materialization.body) !== action.body_digest) {
        fail("github_worker_materialization_digest_mismatch");
      }
      const created = await json(await call(`${root}/pulls`, {
        method: "POST",
        body: JSON.stringify({
          title: materialization.title,
          body: materialization.body,
          head: branch(action.head_branch),
          base: branch(action.base_branch),
          draft: true,
        }),
      }), "github_worker_draft_pr_failed");
      if (!Number.isSafeInteger(created?.number) || created?.draft !== true || created?.head?.sha !== action.head_commit ||
          created?.base?.sha !== action.expected_base_commit) fail("github_worker_draft_pr_readback_mismatch");
      return { outcome: "success", result_pull_request: created.number };
    }

    const pullNumber = Number(action.pull_request);
    if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) fail("github_worker_pull_request_invalid");
    const pull = await json(await call(`${root}/pulls/${pullNumber}`), "github_worker_pull_request_read_failed");
    if (pull?.head?.sha !== action.head_commit || pull?.base?.sha !== action.expected_base_commit ||
        pull?.head?.ref !== action.head_branch || pull?.base?.ref !== action.base_branch) {
      fail("github_worker_pull_request_drift");
    }

    if (action.kind === "github.ready") {
      exactKeys(materialization || {}, new Set(), "github_worker_materialization_invalid");
      if (pull.draft === false) return { outcome: "success", result_pull_request: pullNumber, idempotent: true };
      if (pull.draft !== true || typeof pull.node_id !== "string") fail("github_worker_pull_request_drift");
      const ready = await json(await call("https://api.github.com/graphql", {
        method: "POST",
        body: JSON.stringify({
          query: "mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{number isDraft headRefOid}}}",
          variables: { id: pull.node_id },
        }),
      }), "github_worker_ready_failed");
      const result = ready?.data?.markPullRequestReadyForReview?.pullRequest;
      if (result?.number !== pullNumber || result?.isDraft !== false || result?.headRefOid !== action.head_commit) {
        fail("github_worker_ready_readback_mismatch");
      }
      return { outcome: "success", result_pull_request: pullNumber, idempotent: false };
    }

    fail("github_worker_action_not_supported");
  };
}

export function createGitHubReconciler({ installation_token, fetch_impl = fetch } = {}) {
  if (typeof installation_token !== "function" || typeof fetch_impl !== "function") fail("github_worker_reconciler_invalid");
  return async function reconcile(claim) {
    const action = claim.action;
    safeAction(action);
    const token = await installation_token({ tenant_id: claim.tenant_id, repository: claim.repository });
    const root = `https://api.github.com/repos/${claim.repository}`;
    const headers = {
      accept: "application/vnd.github+json", authorization: `Bearer ${token}`,
      "user-agent": "skinharmony-standing-release-worker/1", "x-github-api-version": "2022-11-28",
    };
    const read = async (url, code) => json(await fetch_impl(url, { method: "GET", headers }), code);
    if (action.kind === "git.push.branch") {
      const ref = await read(`${root}/git/ref/heads/${encodeURIComponent(branch(action.branch))}`, "github_worker_ref_read_failed");
      const current = sha(ref?.object?.sha, "github_worker_ref_read_failed");
      if (current === action.source_commit) return { state: "succeeded", result: { outcome: "success", result_commit: current, reconciled: true } };
      if (current === action.expected_remote_commit) return { state: "failed", result: { outcome: "failure", reconciled: true } };
      fail("github_worker_reconciliation_ambiguous");
    }
    if (action.kind === "github.draft_pr") {
      const owner = claim.repository.split("/")[0];
      const pulls = await read(`${root}/pulls?state=all&head=${encodeURIComponent(`${owner}:${action.head_branch}`)}&base=${encodeURIComponent(action.base_branch)}&per_page=20`, "github_worker_pull_request_read_failed");
      if (!Array.isArray(pulls)) fail("github_worker_pull_request_read_failed");
      const exact = pulls.filter((pull) => pull?.head?.sha === action.head_commit && pull?.base?.sha === action.expected_base_commit);
      if (exact.length === 1) return { state: "succeeded", result: { outcome: "success", result_pull_request: exact[0].number, reconciled: true } };
      if (exact.length === 0) return { state: "failed", result: { outcome: "failure", reconciled: true } };
      fail("github_worker_reconciliation_ambiguous");
    }
    const pullNumber = Number(action.pull_request);
    if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) fail("github_worker_pull_request_invalid");
    const pull = await read(`${root}/pulls/${pullNumber}`, "github_worker_pull_request_read_failed");
    if (pull?.head?.sha !== action.head_commit || pull?.base?.sha !== action.expected_base_commit ||
        pull?.head?.ref !== action.head_branch || pull?.base?.ref !== action.base_branch) fail("github_worker_pull_request_drift");
    if (action.kind === "github.ready") {
      return pull.draft === false
        ? { state: "succeeded", result: { outcome: "success", result_pull_request: pullNumber, reconciled: true } }
        : { state: "failed", result: { outcome: "failure", reconciled: true } };
    }
    if (action.kind === "github.merge") {
      return pull.merged === true
        ? { state: "succeeded", result: { outcome: "success", result_commit: sha(pull.merge_commit_sha, "github_worker_merge_readback_mismatch"), reconciled: true } }
        : { state: "failed", result: { outcome: "failure", reconciled: true } };
    }
    fail("github_worker_action_not_supported");
  };
}
