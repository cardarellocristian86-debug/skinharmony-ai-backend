import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { createBootstrapRequiredChecksReadback } from "../src/bootstrapRequiredChecksReadback.js";

const SHA = "a".repeat(40);
const BASE_SHA = "c".repeat(40);
const WORKFLOW_PATH = ".github/workflows/nyra-core.yml";
const BASE_WORKFLOW = Buffer.from("name: Nyra Core Intelligence\non: pull_request\n");
const CANDIDATE_WORKFLOW = Buffer.from("name: Nyra Core Intelligence\non: [pull_request, push]\n");
const sourceDigest = (source) => crypto.createHash("sha256").update(source).digest("hex");
const policy = () => ({
  schema_version: "host_native_required_checks_policy_v1", tenant_id: "tenant-a", repository: "owner/repo", base_branch: "main", required_checks: ["core-mcp", "universal-core"],
  check_app: { id: 17, slug: "nyra-core", owner: "cardarellocristian86-debug" },
  workflow: { id: 18, name: "Nyra Core Intelligence", path: WORKFLOW_PATH, sha256: sourceDigest(BASE_WORKFLOW), candidate_sha256: sourceDigest(CANDIDATE_WORKFLOW) }, allowed_events: ["pull_request"],
});
function response(value) { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
function fetchFixture({ pr = null, checks = null, baseWorkflow = BASE_WORKFLOW, headWorkflow = CANDIDATE_WORKFLOW } = {}) {
  const validPr = pr || { state: "open", draft: false, head: { sha: SHA, repo: { full_name: "owner/repo" } }, base: { ref: "main", sha: BASE_SHA, repo: { full_name: "owner/repo" } } };
  const validChecks = checks || { check_runs: ["core-mcp", "universal-core"].map((name, index) => ({ id: index + 1, name, head_sha: SHA, status: "completed", conclusion: "success", app: { id: 17, slug: "nyra-core", owner: { login: "cardarellocristian86-debug" } } })) };
  return async (url) => {
    if (url.includes("/pulls/")) return response(validPr);
    if (url.includes("/check-runs")) return response(validChecks);
    if (url.includes(`/contents/${WORKFLOW_PATH}?ref=${BASE_SHA}`)) {
      return response({ type: "file", encoding: "base64", path: WORKFLOW_PATH, content: baseWorkflow.toString("base64") });
    }
    if (url.includes(`/contents/${WORKFLOW_PATH}?ref=${SHA}`)) {
      return response({ type: "file", encoding: "base64", path: WORKFLOW_PATH, content: headWorkflow.toString("base64") });
    }
    throw new Error(`unexpected:${url}`);
  };
}
function reader(overrides = {}) { return createBootstrapRequiredChecksReadback({ fetchImpl: fetchFixture(overrides), githubTokenResolver: async ({ tenant_id }) => ({ tenant_id, token: "github-token" }), requiredChecksPolicyResolver: async () => policy() }); }
const input = { tenant_id: "tenant-a", repository: "owner/repo", pr_number: 232, head_sha: SHA };

test("attests bounded server-side PR and required-check readback", async () => {
  const result = await reader().attest(input);
  assert.deepEqual(result.required_checks, ["core-mcp", "universal-core"]);
  assert.match(result.required_checks_digest, /^[a-f0-9]{64}$/);
  assert.match(result.required_checks_results_digest, /^[a-f0-9]{64}$/);
  assert.equal(result.checks.length, 2);
  assert.equal(result.base_branch, "main");
  assert.equal(result.base_sha, BASE_SHA);
  assert.deepEqual(result.workflow_sources.map(({ role, sha256 }) => ({ role, sha256 })), [
    { role: "base", sha256: sourceDigest(BASE_WORKFLOW) },
    { role: "head", sha256: sourceDigest(CANDIDATE_WORKFLOW) },
  ]);
});

test("fails closed for PR, policy, checks, tenant credential, and unavailable dependencies", async () => {
  await assert.rejects(reader({ pr: { state: "open", draft: true, head: { sha: SHA, repo: { full_name: "owner/repo" } }, base: { ref: "main", sha: BASE_SHA, repo: { full_name: "owner/repo" } } } }).attest(input), /bootstrap_required_checks_pr_mismatch/);
  await assert.rejects(reader({ checks: { check_runs: [] } }).attest(input), /bootstrap_required_checks_not_ready/);
  const crossTenant = createBootstrapRequiredChecksReadback({ fetchImpl: fetchFixture(), githubTokenResolver: async () => ({ tenant_id: "tenant-b", token: "github-token" }), requiredChecksPolicyResolver: async () => policy() });
  await assert.rejects(crossTenant.attest(input), /bootstrap_required_checks_cross_tenant_credential_denied/);
  const mismatch = createBootstrapRequiredChecksReadback({ fetchImpl: fetchFixture(), githubTokenResolver: async () => "github-token", requiredChecksPolicyResolver: async () => ({ ...policy(), tenant_id: "tenant-b" }) });
  await assert.rejects(mismatch.attest(input), /bootstrap_required_checks_policy_mismatch/);
  const unavailable = createBootstrapRequiredChecksReadback({ fetchImpl: fetchFixture(), githubTokenResolver: null, requiredChecksPolicyResolver: null });
  await assert.rejects(unavailable.attest(input), /bootstrap_required_checks_github_credential_unavailable/);
});

test("binds registry workflow digests to exact GitHub base and head bytes", async () => {
  const baseMismatch = createBootstrapRequiredChecksReadback({
    fetchImpl: fetchFixture(),
    githubTokenResolver: async () => "github-token",
    requiredChecksPolicyResolver: async () => ({
      ...policy(),
      workflow: { ...policy().workflow, sha256: "f".repeat(64) },
    }),
  });
  await assert.rejects(baseMismatch.attest(input), /bootstrap_required_checks_workflow_source_mismatch/);
  const headMismatch = createBootstrapRequiredChecksReadback({
    fetchImpl: fetchFixture(),
    githubTokenResolver: async () => "github-token",
    requiredChecksPolicyResolver: async () => ({
      ...policy(),
      workflow: { ...policy().workflow, candidate_sha256: "e".repeat(64) },
    }),
  });
  await assert.rejects(headMismatch.attest(input), /bootstrap_required_checks_workflow_source_mismatch/);

  const promotedCandidate = createBootstrapRequiredChecksReadback({
    fetchImpl: fetchFixture({ baseWorkflow: CANDIDATE_WORKFLOW }),
    githubTokenResolver: async () => "github-token",
    requiredChecksPolicyResolver: async () => policy(),
  });
  const promoted = await promotedCandidate.attest(input);
  assert.deepEqual(promoted.workflow_sources.map((entry) => entry.sha256), [
    sourceDigest(CANDIDATE_WORKFLOW),
    sourceDigest(CANDIDATE_WORKFLOW),
  ]);

  const reversedRotation = createBootstrapRequiredChecksReadback({
    fetchImpl: fetchFixture({ baseWorkflow: CANDIDATE_WORKFLOW, headWorkflow: BASE_WORKFLOW }),
    githubTokenResolver: async () => "github-token",
    requiredChecksPolicyResolver: async () => policy(),
  });
  await assert.rejects(reversedRotation.attest(input), /bootstrap_required_checks_workflow_source_mismatch/);
});

test("fails closed when registry or server-owned GitHub dependencies are missing", async () => {
  await assert.rejects(createBootstrapRequiredChecksReadback({
    fetchImpl: fetchFixture(), githubTokenResolver: null,
    requiredChecksPolicyResolver: async () => policy(),
  }).attest(input), /bootstrap_required_checks_github_credential_unavailable/);
  await assert.rejects(createBootstrapRequiredChecksReadback({
    fetchImpl: fetchFixture(), githubTokenResolver: async () => "github-token",
    requiredChecksPolicyResolver: null,
  }).attest(input), /bootstrap_required_checks_policy_unavailable/);
});
