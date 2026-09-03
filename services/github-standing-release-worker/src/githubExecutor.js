import crypto from "node:crypto";
import { boundedJsonRequest } from "../../shared/bounded-json-request.js";
import {
  createWorkerRequestDeadline,
  remainingWorkerRequestTimeout,
} from "./requestDeadline.js";

const SHA = /^[a-f0-9]{40}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const PULL_RECONCILIATION_PAGE_SIZE = 20;
const PULL_RECONCILIATION_MAX_PAGES = 5;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

class GitHubExecutionAttemptError extends Error {
  constructor(cause, effect) {
    const candidate = String(cause?.code || cause?.message || "");
    const code = /^github_(?:api|app|worker)_[a-z0-9_]{1,120}$/.test(candidate)
      ? candidate
      : "github_worker_execution_failed";
    super(code, { cause });
    this.name = "GitHubExecutionAttemptError";
    this.code = code;
    this.status = Number.isSafeInteger(cause?.status) ? cause.status : 409;
    this.statusCode = this.status;
    this.mutation_dispatched = effect.mutation_dispatched;
    this.provider_response_received = effect.provider_response_received;
    // Conservative effect policy: after the mutation fetch boundary, an HTTP
    // status or response body is not proof that an intermediary did not apply
    // the provider effect. No post-dispatch error is terminal until an exact
    // reconciliation read proves success or failure. This includes every 4xx,
    // 408/429 and 5xx response and deliberately performs no automatic retry.
    this.execution_outcome = effect.mutation_dispatched ? "unknown" : "failure";
  }
}

export function githubExecutionErrorOutcome(error) {
  return error instanceof GitHubExecutionAttemptError
    ? error.execution_outcome
    : "failure";
}

export function githubExecutionErrorCode(error) {
  return error instanceof GitHubExecutionAttemptError
    ? error.code
    : "github_worker_execution_failed";
}

export function githubExecutionMutationDispatched(error) {
  return error instanceof GitHubExecutionAttemptError &&
    error.mutation_dispatched === true;
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

async function json(request, code) {
  const { response, payload: body } = await request;
  if (!response.ok) fail(code);
  return body;
}

function githubRequest(fetchImpl, requestTimeoutMs, responseLimitBytes, deadline, url, options = {}) {
  return boundedJsonRequest(url, options, {
    fetchImpl,
    timeoutMs: remainingWorkerRequestTimeout(deadline, requestTimeoutMs),
    maxResponseBytes: responseLimitBytes,
    errorCodes: {
      timeout: "github_api_request_timeout",
      too_large: "github_api_response_too_large",
      invalid: "github_api_response_invalid",
      unavailable: "github_api_unavailable",
    },
  });
}

export function createGitHubExecutor({
  installation_token,
  fetch_impl = fetch,
  request_timeout_ms = 8_000,
  request_deadline_ms = 18_000,
  response_limit_bytes = 1024 * 1024,
  deadline_now,
} = {}) {
  if (typeof installation_token !== "function" || typeof fetch_impl !== "function") fail("github_worker_executor_invalid");

  return async function execute(claim, { materialization = null, deadline = null } = {}) {
    const effect = {
      mutation_dispatched: false,
      provider_response_received: false,
      provider_response_ok: null,
    };
    try {
      const requestDeadline = deadline || createWorkerRequestDeadline({
        timeout_ms: request_deadline_ms,
        ...(deadline_now ? { now: deadline_now } : {}),
      });
      const action = claim.action;
      if (action?.kind === "github.merge") fail("github_worker_manual_merge_only");
      safeAction(action);
      const token = await installation_token(
        { tenant_id: claim.tenant_id, repository: claim.repository },
        { deadline: requestDeadline },
      );
      const root = `https://api.github.com/repos/${claim.repository}`;
      const headers = {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "skinharmony-standing-release-worker/1",
        "x-github-api-version": "2022-11-28",
      };
      const call = (url, options = {}) => githubRequest(
        fetch_impl,
        request_timeout_ms,
        response_limit_bytes,
        requestDeadline,
        url,
        { ...options, headers: { ...headers, ...(options.headers || {}) } },
      );
      const mutate = async (url, options, code) => {
        const request = call(url, options);
        // Reaching the fetch boundary is the point after which a transport
        // failure cannot prove whether GitHub applied the mutation.
        effect.mutation_dispatched = true;
        const { response, payload } = await request;
        effect.provider_response_received = true;
        effect.provider_response_ok = response.ok;
        if (!response.ok) fail(code);
        return payload;
      };

      if (action.kind === "git.push.branch") {
        exactKeys(materialization || {}, new Set(), "github_worker_materialization_invalid");
        const branchName = branch(action.branch);
        const source = sha(action.source_commit, "github_worker_source_commit_invalid");
        const expected = sha(action.expected_remote_commit, "github_worker_remote_commit_invalid");
        const current = await json(call(`${root}/git/ref/heads/${encodeURIComponent(branchName)}`), "github_worker_ref_read_failed");
        const currentSha = sha(current?.object?.sha, "github_worker_ref_read_failed");
        if (currentSha === source) return { outcome: "success", result_commit: source, idempotent: true };
        if (currentSha !== expected) fail("github_worker_remote_head_drift");
        const updated = await mutate(`${root}/git/refs/heads/${encodeURIComponent(branchName)}`, {
          method: "PATCH", body: JSON.stringify({ sha: source, force: false }),
        }, "github_worker_push_failed");
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
        const created = await mutate(`${root}/pulls`, {
          method: "POST",
          body: JSON.stringify({
            title: materialization.title,
            body: materialization.body,
            head: branch(action.head_branch),
            base: branch(action.base_branch),
            draft: true,
          }),
        }, "github_worker_draft_pr_failed");
        if (!Number.isSafeInteger(created?.number) || created?.draft !== true || created?.head?.sha !== action.head_commit ||
            created?.base?.sha !== action.expected_base_commit) fail("github_worker_draft_pr_readback_mismatch");
        return { outcome: "success", result_pull_request: created.number };
      }

      const pullNumber = Number(action.pull_request);
      if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) fail("github_worker_pull_request_invalid");
      const pull = await json(call(`${root}/pulls/${pullNumber}`), "github_worker_pull_request_read_failed");
      if (pull?.head?.sha !== action.head_commit || pull?.base?.sha !== action.expected_base_commit ||
          pull?.head?.ref !== action.head_branch || pull?.base?.ref !== action.base_branch) {
        fail("github_worker_pull_request_drift");
      }

      if (action.kind === "github.ready") {
        exactKeys(materialization || {}, new Set(), "github_worker_materialization_invalid");
        if (pull.draft === false) return { outcome: "success", result_pull_request: pullNumber, idempotent: true };
        if (pull.draft !== true || typeof pull.node_id !== "string") fail("github_worker_pull_request_drift");
        const ready = await mutate("https://api.github.com/graphql", {
          method: "POST",
          body: JSON.stringify({
            query: "mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{number isDraft headRefOid}}}",
            variables: { id: pull.node_id },
          }),
        }, "github_worker_ready_failed");
        const result = ready?.data?.markPullRequestReadyForReview?.pullRequest;
        if (result?.number !== pullNumber || result?.isDraft !== false || result?.headRefOid !== action.head_commit) {
          fail("github_worker_ready_readback_mismatch");
        }
        return { outcome: "success", result_pull_request: pullNumber, idempotent: false };
      }

      fail("github_worker_action_not_supported");
    } catch (error) {
      throw new GitHubExecutionAttemptError(error, effect);
    }
  };
}

export function createGitHubReconciler({
  installation_token,
  fetch_impl = fetch,
  request_timeout_ms = 8_000,
  request_deadline_ms = 18_000,
  response_limit_bytes = 1024 * 1024,
  deadline_now,
} = {}) {
  if (typeof installation_token !== "function" || typeof fetch_impl !== "function") fail("github_worker_reconciler_invalid");
  return async function reconcile(claim, { deadline = null } = {}) {
    const requestDeadline = deadline || createWorkerRequestDeadline({
      timeout_ms: request_deadline_ms,
      ...(deadline_now ? { now: deadline_now } : {}),
    });
    const action = claim.action;
    safeAction(action);
    const token = await installation_token(
      { tenant_id: claim.tenant_id, repository: claim.repository },
      { deadline: requestDeadline },
    );
    const root = `https://api.github.com/repos/${claim.repository}`;
    const headers = {
      accept: "application/vnd.github+json", authorization: `Bearer ${token}`,
      "user-agent": "skinharmony-standing-release-worker/1", "x-github-api-version": "2022-11-28",
    };
    const read = (url, code) => json(githubRequest(
      fetch_impl,
      request_timeout_ms,
      response_limit_bytes,
      requestDeadline,
      url,
      { method: "GET", headers },
    ), code);
    if (action.kind === "git.push.branch") {
      const ref = await read(`${root}/git/ref/heads/${encodeURIComponent(branch(action.branch))}`, "github_worker_ref_read_failed");
      const current = sha(ref?.object?.sha, "github_worker_ref_read_failed");
      if (current === action.source_commit) return { state: "succeeded", result: { outcome: "success", result_commit: current, reconciled: true } };
      if (current === action.expected_remote_commit) return { state: "failed", result: { outcome: "failure", reconciled: true } };
      fail("github_worker_reconciliation_ambiguous");
    }
    if (action.kind === "github.draft_pr") {
      const owner = claim.repository.split("/")[0];
      const exact = [];
      for (let page = 1; page <= PULL_RECONCILIATION_MAX_PAGES; page += 1) {
        let pulls;
        try {
          pulls = await read(`${root}/pulls?state=all&head=${encodeURIComponent(`${owner}:${action.head_branch}`)}&base=${encodeURIComponent(action.base_branch)}&per_page=${PULL_RECONCILIATION_PAGE_SIZE}&page=${page}`, "github_worker_pull_request_read_failed");
        } catch (error) {
          if (error?.code === "github_worker_request_deadline_exceeded" || error?.code === "github_api_request_timeout") {
            fail("github_worker_reconciliation_ambiguous");
          }
          throw error;
        }
        if (!Array.isArray(pulls) || pulls.length > PULL_RECONCILIATION_PAGE_SIZE) {
          fail("github_worker_pull_request_read_failed");
        }
        exact.push(...pulls.filter((pull) => pull?.head?.sha === action.head_commit && pull?.base?.sha === action.expected_base_commit));
        if (exact.length > 1) fail("github_worker_reconciliation_ambiguous");
        if (pulls.length < PULL_RECONCILIATION_PAGE_SIZE) {
          if (exact.length === 1) return { state: "succeeded", result: { outcome: "success", result_pull_request: exact[0].number, reconciled: true } };
          return { state: "failed", result: { outcome: "failure", reconciled: true } };
        }
      }
      // A full final page means the filtered result set was not exhausted. It
      // cannot prove either absence or uniqueness, so the ledger must remain
      // outcome_unknown until a later bounded reconciliation can prove it.
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
