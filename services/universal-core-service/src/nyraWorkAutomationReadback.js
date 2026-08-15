import crypto from "node:crypto";

import { nyraDigest } from "../../shared/nyra-work-automation-receipts.js";

const GITHUB = "https://api.github.com";
const SHA = /^[a-f0-9]{40}$/;
const MAX_BYTES = 256_000;

function fail(code) { throw new Error(code); }
function text(value, code, maximum = 500) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maximum || normalized.includes("\u0000")) fail(code);
  return normalized;
}
function sha(value, code) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SHA.test(normalized)) fail(code);
  return normalized;
}
function stable(values) { return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))].sort(); }
function same(left, right) { const a = stable(left); const b = stable(right); return a.length === b.length && a.every((value, index) => value === b[index]); }

async function json(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response?.ok) fail("nyra_readback_unavailable");
    const type = String(response.headers?.get?.("content-type") || "");
    if (!type.includes("json")) fail("nyra_readback_response_invalid");
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_BYTES) fail("nyra_readback_response_too_large");
    try { return JSON.parse(body); } catch { fail("nyra_readback_response_invalid"); }
  } catch (error) {
    if (String(error?.message || "").startsWith("nyra_readback_")) throw error;
    fail("nyra_readback_unavailable");
  } finally { clearTimeout(timeout); }
}

export function createNyraWorkAutomationReadback({
  fetchImpl = globalThis.fetch,
  githubTokenResolver = null,
  requiredChecksPolicyResolver = null,
  intentAnchorResolver = null,
  timeoutMs = 5_000,
} = {}) {
  if (typeof fetchImpl !== "function") fail("nyra_readback_fetch_unavailable");
  async function scope(input) {
    const tenant_id = text(input.tenant_id, "nyra_readback_tenant_invalid", 240);
    const repository = text(input.repository, "nyra_readback_repository_invalid", 240);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) fail("nyra_readback_repository_invalid");
    let token = "";
    if (githubTokenResolver) token = String(await githubTokenResolver({ tenant_id, repository }) || "").trim();
    return { tenant_id, repository, headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "skinharmony-nyra-work-automation-v3", ...(token ? { authorization: `Bearer ${token}` } : {}) } };
  }
  return Object.freeze({
    async intent(input) {
      if (typeof intentAnchorResolver !== "function") fail("nyra_readback_intent_authority_unavailable");
      const tenant_id = text(input.tenant_id, "nyra_readback_tenant_invalid", 240);
      const work_id = text(input.work_id, "nyra_readback_work_invalid", 240);
      const anchor = await intentAnchorResolver({ tenant_id, work_id, intent_anchor_receipt: input.intent_anchor_receipt });
      if (anchor?.schema_version !== "nyra_immutable_intent_anchor_v1" || anchor.tenant_id !== tenant_id || anchor.work_id !== work_id || anchor.immutable !== true || !["universal_core_intent_authority", "mcp_work_continuity_postgres"].includes(anchor.source) || !/^[a-f0-9]{64}$/.test(String(anchor.intent_anchor_digest || "")) || !String(anchor.intent_objective || "").trim()) fail("nyra_readback_intent_anchor_invalid");
      return Object.freeze({ ...anchor, readback_digest: nyraDigest(anchor) });
    },
    async commit(input) {
      const bound = await scope(input);
      const commit = sha(input.commit, "nyra_readback_commit_invalid");
      const payload = await json(fetchImpl, `${GITHUB}/repos/${bound.repository}/commits/${commit}?per_page=100`, { method: "GET", redirect: "error", headers: bound.headers }, timeoutMs);
      if (!Array.isArray(payload?.files) || payload.files.length < 1 || payload.files.length >= 100) fail("nyra_readback_commit_files_incomplete");
      const changed_files = stable(payload.files.map((file) => file?.filename));
      if (changed_files.length !== payload.files.length) fail("nyra_readback_commit_files_invalid");
      const diff = payload.files.map((file) => ({
        filename: text(file.filename, "nyra_readback_commit_files_invalid", 800),
        status: text(file.status, "nyra_readback_commit_files_invalid", 40),
        sha: sha(file.sha, "nyra_readback_commit_file_sha_invalid"),
        additions: Number(file.additions), deletions: Number(file.deletions), changes: Number(file.changes),
        ...(file.previous_filename ? { previous_filename: text(file.previous_filename, "nyra_readback_commit_files_invalid", 800) } : {}),
      })).sort((a, b) => a.filename.localeCompare(b.filename));
      if (diff.some((file) => !Number.isSafeInteger(file.additions) || !Number.isSafeInteger(file.deletions) || !Number.isSafeInteger(file.changes) || file.additions < 0 || file.deletions < 0 || file.changes < 0)) fail("nyra_readback_commit_diff_invalid");
      const observed = {
        schema_version: "nyra_authoritative_commit_readback_v1", tenant_id: bound.tenant_id,
        repository: bound.repository, branch: text(input.branch, "nyra_readback_branch_invalid", 240),
        commit: sha(payload?.sha, "nyra_readback_commit_mismatch"),
        tree_sha: sha(payload?.commit?.tree?.sha, "nyra_readback_tree_invalid"),
        parent_commit: sha(payload?.parents?.[0]?.sha, "nyra_readback_parent_invalid"),
        changed_files,
        changed_files_digest: nyraDigest(changed_files),
        diff_digest: nyraDigest(diff),
      };
      if (observed.commit !== commit || (input.parent_commit && observed.parent_commit !== sha(input.parent_commit, "nyra_readback_parent_invalid")) || (input.tree_sha && observed.tree_sha !== sha(input.tree_sha, "nyra_readback_tree_invalid"))) fail("nyra_readback_commit_mismatch");
      if (input.changed_files && !same(input.changed_files, observed.changed_files)) fail("nyra_readback_commit_files_mismatch");
      if (input.diff_digest && input.diff_digest !== observed.diff_digest) fail("nyra_readback_commit_diff_mismatch");
      return Object.freeze({ ...observed, readback_digest: nyraDigest(observed) });
    },
    async requiredChecks(input) {
      const bound = await scope(input);
      if (typeof requiredChecksPolicyResolver !== "function") fail("nyra_readback_required_checks_policy_unavailable");
      const head = sha(input.head_commit, "nyra_readback_head_invalid");
      const baseBranch = text(input.base_branch, "nyra_readback_base_invalid", 240);
      const policy = await requiredChecksPolicyResolver({ tenant_id: bound.tenant_id, repository: bound.repository, base_branch: baseBranch });
      if (!policy || policy.repository !== bound.repository || policy.tenant_id !== bound.tenant_id || policy.base_branch !== baseBranch) fail("nyra_readback_required_checks_policy_mismatch");
      const prNumber = Number(input.pull_request);
      if (!Number.isSafeInteger(prNumber) || prNumber < 1) fail("nyra_readback_pull_request_invalid");
      const pr = await json(fetchImpl, `${GITHUB}/repos/${bound.repository}/pulls/${prNumber}`, { method: "GET", redirect: "error", headers: bound.headers }, timeoutMs);
      if (pr?.state !== "open" || pr?.draft === true || sha(pr?.head?.sha, "nyra_readback_pr_mismatch") !== head || pr?.base?.ref !== baseBranch || pr?.head?.repo?.full_name !== bound.repository || pr?.base?.repo?.full_name !== bound.repository) fail("nyra_readback_pr_mismatch");
      const workflow = await json(fetchImpl, `${GITHUB}/repos/${bound.repository}/actions/workflows/${Number(policy.workflow?.id)}`, { method: "GET", redirect: "error", headers: bound.headers }, timeoutMs);
      if (Number(workflow?.id) !== Number(policy.workflow?.id) || workflow?.name !== policy.workflow?.name || workflow?.path !== policy.workflow?.path || workflow?.state !== "active") fail("nyra_readback_workflow_mismatch");
      const workflowContent = await json(fetchImpl, `${GITHUB}/repos/${bound.repository}/contents/${policy.workflow.path}?ref=${head}`, { method: "GET", redirect: "error", headers: bound.headers }, timeoutMs);
      if (workflowContent?.encoding !== "base64" || workflowContent?.path !== policy.workflow.path || typeof workflowContent?.content !== "string") fail("nyra_readback_workflow_content_invalid");
      const workflowBytes = Buffer.from(workflowContent.content.replace(/\s/g, ""), "base64");
      if (!workflowBytes.length || workflowBytes.length > MAX_BYTES || workflowContent.size !== workflowBytes.length) fail("nyra_readback_workflow_content_invalid");
      const workflowContentDigest = crypto.createHash("sha256").update(workflowBytes).digest("hex");
      const allowedWorkflowDigests = [policy.workflow.sha256, policy.workflow.candidate_sha256].filter(Boolean);
      if (!allowedWorkflowDigests.includes(workflowContentDigest)) fail("nyra_readback_workflow_content_mismatch");
      const runs = await json(fetchImpl, `${GITHUB}/repos/${bound.repository}/actions/workflows/${Number(policy.workflow.id)}/runs?head_sha=${head}&event=pull_request&per_page=20`, { method: "GET", redirect: "error", headers: bound.headers }, timeoutMs);
      if (!(runs?.workflow_runs || []).some((run) => run?.head_sha === head && run?.event === "pull_request" && run?.conclusion === "success" && run?.path === policy.workflow.path)) fail("nyra_readback_workflow_run_mismatch");
      const checksPayload = await json(fetchImpl, `${GITHUB}/repos/${bound.repository}/commits/${head}/check-runs?per_page=100`, { method: "GET", redirect: "error", headers: bound.headers }, timeoutMs);
      const required = stable(policy.required_checks);
      const checks = required.map((name) => {
        const selected = (checksPayload?.check_runs || []).filter((run) => run?.name === name && run?.head_sha === head && run?.status === "completed" && run?.conclusion === "success" && Number(run?.app?.id) === Number(policy.check_app?.id) && run?.app?.slug === policy.check_app?.slug && run?.app?.owner?.login === policy.check_app?.owner).sort((a, b) => Number(b.id) - Number(a.id))[0];
        if (!selected) fail("nyra_readback_checks_not_ready");
        return { id: Number(selected.id), name, status: "completed", conclusion: "success", head_sha: head, app: { id: Number(selected.app.id), slug: selected.app.slug, owner: selected.app.owner.login } };
      });
      if (input.required_checks && !same(input.required_checks, required)) fail("nyra_readback_required_checks_mismatch");
      const result = { schema_version: "nyra_required_checks_readback_v1", tenant_id: bound.tenant_id, repository: bound.repository, pull_request: prNumber, head_commit: head, base_branch: baseBranch, required_checks: required, required_checks_policy_digest: nyraDigest(policy), checks, workflow: { id: Number(workflow.id), name: workflow.name, path: workflow.path, content_sha256: workflowContentDigest } };
      return Object.freeze({ ...result, readback_digest: nyraDigest(result) });
    },
    async pullRequest(input) {
      const bound = await scope(input);
      const pullRequest = Number(input.pull_request);
      const headCommit = sha(input.head_commit, "nyra_readback_head_invalid");
      const baseCommit = sha(input.base_commit, "nyra_readback_base_commit_invalid");
      if (!Number.isSafeInteger(pullRequest) || pullRequest < 1) fail("nyra_readback_pull_request_invalid");
      const payload = await json(fetchImpl, `${GITHUB}/repos/${bound.repository}/pulls/${pullRequest}`, { method: "GET", redirect: "error", headers: bound.headers }, timeoutMs);
      const result = {
        schema_version: "nyra_authoritative_pull_request_readback_v1",
        tenant_id: bound.tenant_id, repository: bound.repository, pull_request: pullRequest,
        head_branch: text(input.head_branch, "nyra_readback_head_branch_invalid", 240),
        base_branch: text(input.base_branch, "nyra_readback_base_invalid", 240),
        head_commit: headCommit, base_commit: baseCommit,
        draft: payload?.draft === true, ready_for_review: payload?.draft === false,
      };
      if (payload?.state !== "open" || payload?.draft !== false || sha(payload?.head?.sha, "nyra_readback_pr_mismatch") !== headCommit || sha(payload?.base?.sha, "nyra_readback_pr_mismatch") !== baseCommit || payload?.head?.ref !== result.head_branch || payload?.base?.ref !== result.base_branch || payload?.head?.repo?.full_name !== bound.repository || payload?.base?.repo?.full_name !== bound.repository) fail("nyra_readback_pr_mismatch");
      return Object.freeze({ ...result, readback_digest: nyraDigest(result) });
    },
  });
}
