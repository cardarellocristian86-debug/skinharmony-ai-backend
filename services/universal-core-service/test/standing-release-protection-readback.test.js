import assert from "node:assert/strict";
import test from "node:test";

import { hostNativeDigest } from "../src/hostNativeGovernance.js";
import { createHostNativeBranchProtectionResolver } from "../src/hostNativeExternalReadback.js";

const G = (value) => String(value).repeat(40);

function policy() {
  return {
    schema_version: "host_native_required_checks_policy_v1",
    tenant_id: "tenant-a",
    repository: "owner/repo",
    base_branch: "main",
    required_checks: ["core-mcp", "deployment-parity", "universal-core"],
    check_app: { id: 15368, slug: "github-actions", owner: "github" },
    workflow: {
      id: 312527659,
      name: "Nyra Core Intelligence",
      path: ".github/workflows/nyra-core-intelligence.yml",
      sha256: "a".repeat(64),
    },
    allowed_events: ["pull_request", "push"],
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchProtection(overrides = {}) {
  return async (url, init) => {
    assert.equal(init.headers.authorization, "Bearer github-installation-token");
    const pathname = new URL(url).pathname;
    if (pathname.endsWith("/branches/main")) {
      return json({ name: "main", protected: true, commit: { sha: G("1") }, ...overrides.branch });
    }
    if (pathname.endsWith("/branches/main/protection")) {
      return json({
        required_status_checks: {
          strict: true,
          checks: policy().required_checks.map((context) => ({ context, app_id: 15368 })),
        },
        enforce_admins: { enabled: true },
        required_pull_request_reviews: {
          required_approving_review_count: 1,
          bypass_pull_request_allowances: { users: [], teams: [], apps: [] },
        },
        allow_force_pushes: { enabled: false },
        allow_deletions: { enabled: false },
        ...overrides.protection,
      });
    }
    throw new Error(`unexpected_url:${url}`);
  };
}

function resolver(overrides = {}) {
  const requiredPolicy = policy();
  return {
    requiredPolicy,
    resolve: createHostNativeBranchProtectionResolver({
      fetchImpl: fetchProtection(overrides),
      githubTokenResolver: async () => "github-installation-token",
      requiredChecksPolicyResolver: async () => requiredPolicy,
      now: () => Date.parse("2026-08-14T10:00:00.000Z"),
    }),
  };
}

function request(requiredPolicy) {
  return {
    tenant_id: "tenant-a",
    repository: "owner/repo",
    base_branch: "main",
    required_checks: requiredPolicy.required_checks,
    required_checks_policy_digest: hostNativeDigest(requiredPolicy),
  };
}

test("branch protection is read from GitHub and binds exact checks/app/base commit", async () => {
  const subject = resolver();
  const receipt = await subject.resolve(request(subject.requiredPolicy));
  assert.equal(subject.resolve.trusted, true);
  assert.equal(receipt.trusted, true);
  assert.equal(receipt.repository, "owner/repo");
  assert.equal(receipt.branch, "main");
  assert.equal(receipt.base_commit, G("1"));
  assert.equal(receipt.direct_push_allowed, false);
  assert.equal(receipt.force_push_allowed, false);
  assert.deepEqual(receipt.required_checks, subject.requiredPolicy.required_checks.slice().sort());
  assert.match(receipt.evidence_digest, /^[a-f0-9]{64}$/);
});

test("unprotected, bypassed, wrong-app and policy-drift branches fail closed", async () => {
  for (const [overrides, expected] of [
    [{ branch: { protected: false } }, /standing_release_base_protection_not_ready/],
    [{ protection: {
      required_pull_request_reviews: {
        required_approving_review_count: 1,
        bypass_pull_request_allowances: { users: [{ login: "admin" }], teams: [], apps: [] },
      },
    } }, /standing_release_base_protection_not_ready/],
    [{ protection: {
      required_status_checks: {
        strict: true,
        checks: policy().required_checks.map((context) => ({ context, app_id: 1 })),
      },
    } }, /standing_release_base_protection_not_ready/],
    [{ protection: {
      required_status_checks: {
        strict: true,
        contexts: policy().required_checks,
      },
    } }, /standing_release_base_protection_not_ready/],
  ]) {
    const subject = resolver(overrides);
    await assert.rejects(subject.resolve(request(subject.requiredPolicy)), expected);
  }
  const subject = resolver();
  await assert.rejects(subject.resolve({
    ...request(subject.requiredPolicy),
    required_checks_policy_digest: "f".repeat(64),
  }), /standing_release_checks_policy_drift/);
});
