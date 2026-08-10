import assert from "node:assert/strict";
import test from "node:test";

import { createBootstrapRequiredChecksReadback } from "../src/bootstrapRequiredChecksReadback.js";

const SHA = "a".repeat(40);
const policy = () => ({
  schema_version: "host_native_required_checks_policy_v1", tenant_id: "tenant-a", repository: "owner/repo", base_branch: "main", required_checks: ["core-mcp", "universal-core"],
  check_app: { id: 17, slug: "nyra-core", owner: "cardarellocristian86-debug" },
  workflow: { id: 18, name: "Nyra Core Intelligence", path: ".github/workflows/nyra-core.yml", sha256: "b".repeat(64), candidate_sha256: null }, allowed_events: ["pull_request"],
});
function response(value) { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
function fetchFixture({ pr = null, checks = null } = {}) {
  const validPr = pr || { state: "open", draft: false, head: { sha: SHA, repo: { full_name: "owner/repo" } }, base: { ref: "main", repo: { full_name: "owner/repo" } } };
  const validChecks = checks || { check_runs: ["core-mcp", "universal-core"].map((name, index) => ({ id: index + 1, name, head_sha: SHA, status: "completed", conclusion: "success", app: { id: 17, slug: "nyra-core", owner: { login: "cardarellocristian86-debug" } } })) };
  return async (url) => url.includes("/pulls/") ? response(validPr) : response(validChecks);
}
function reader(overrides = {}) { return createBootstrapRequiredChecksReadback({ fetchImpl: fetchFixture(overrides), githubTokenResolver: async ({ tenant_id }) => ({ tenant_id, token: "github-token" }), requiredChecksPolicyResolver: async () => policy() }); }
const input = { tenant_id: "tenant-a", repository: "owner/repo", pr_number: 232, head_sha: SHA, base_branch: "main" };

test("attests bounded server-side PR and required-check readback", async () => {
  const result = await reader().attest(input);
  assert.deepEqual(result.required_checks, ["core-mcp", "universal-core"]);
  assert.match(result.required_checks_digest, /^[a-f0-9]{64}$/);
  assert.match(result.required_checks_results_digest, /^[a-f0-9]{64}$/);
  assert.equal(result.checks.length, 2);
});

test("fails closed for PR, policy, checks, tenant credential, and unavailable dependencies", async () => {
  await assert.rejects(reader({ pr: { state: "open", draft: true, head: { sha: SHA, repo: { full_name: "owner/repo" } }, base: { ref: "main", repo: { full_name: "owner/repo" } } } }).attest(input), /bootstrap_required_checks_pr_mismatch/);
  await assert.rejects(reader({ checks: { check_runs: [] } }).attest(input), /bootstrap_required_checks_not_ready/);
  const crossTenant = createBootstrapRequiredChecksReadback({ fetchImpl: fetchFixture(), githubTokenResolver: async () => ({ tenant_id: "tenant-b", token: "github-token" }), requiredChecksPolicyResolver: async () => policy() });
  await assert.rejects(crossTenant.attest(input), /bootstrap_required_checks_cross_tenant_credential_denied/);
  const mismatch = createBootstrapRequiredChecksReadback({ fetchImpl: fetchFixture(), githubTokenResolver: async () => "github-token", requiredChecksPolicyResolver: async () => ({ ...policy(), tenant_id: "tenant-b" }) });
  await assert.rejects(mismatch.attest(input), /bootstrap_required_checks_policy_mismatch/);
  const unavailable = createBootstrapRequiredChecksReadback({ fetchImpl: fetchFixture(), githubTokenResolver: null, requiredChecksPolicyResolver: null });
  await assert.rejects(unavailable.attest(input), /bootstrap_required_checks_policy_unavailable/);
});
