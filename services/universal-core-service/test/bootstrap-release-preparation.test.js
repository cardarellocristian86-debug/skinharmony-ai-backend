import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  BOOTSTRAP_RELEASE_EXCEPTION_SCHEMA_VERSION,
  BOOTSTRAP_RELEASE_PREPARATION_SCHEMA_VERSION,
  createBootstrapReleasePreparationService,
} from "../src/bootstrapReleasePreparation.js";

const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const TENANT_ID = "tenant-owner-private";
const OWNER_ID = "owner-primary-001";
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function request(overrides = {}) {
  return {
    request_id: "release-request-pr229-v1",
    tenant_id: TENANT_ID,
    work_id: "work-continuity-v2-release",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
    pr_number: 229,
    head_sha: "a".repeat(40),
    allowed_action: "github.merge",
    ...overrides,
  };
}

function fixtures(overrides = {}) {
  const calls = { normal: 0, checks: 0, verdict: 0, owner: 0 };
  const dependencies = {
    allowedFailureCodes: new Set(["release_manifest_required"]),
    now: () => NOW,
    idFactory: (kind) => kind === "exception_id"
      ? "bootstrap-exception-pr229-v1"
      : "bootstrap-nonce-pr229-v1",
    ownerConfirmationVerifier: async ({ expected }) => {
      calls.owner += 1;
      return {
        verified: true,
        tenant_id: expected.tenant_id,
        owner_id: expected.owner_id,
        request_digest: expected.request_digest,
        owner_confirmation_digest: digest("owner-confirmation-pr229"),
      };
    },
    normalPathAttempt: async () => {
      calls.normal += 1;
      const error = new Error("normal path deadlock");
      error.failure_code = "release_manifest_required";
      throw error;
    },
    requiredChecksReadback: async ({ normal_action_request }) => {
      calls.checks += 1;
      return {
        tenant_id: normal_action_request.tenant_id,
        work_id: normal_action_request.work_id,
        repository: normal_action_request.repository,
        pr_number: normal_action_request.pr_number,
        head_sha: normal_action_request.head_sha,
        policy_revision: "required-checks-policy-v3",
        checks: [
          { name: "core-mcp", status: "completed", conclusion: "success" },
          { name: "deployment-parity", status: "completed", conclusion: "success" },
          { name: "universal-core", status: "completed", conclusion: "success" },
        ],
      };
    },
    activeTrustKeyResolver: async () => ({
      status: "active",
      authority_provider: "local_pin",
      authority_key_id: "local-pin-p256:authority-key-pr229",
    }),
    deadlockVerdictStore: {
      issue: async (scope) => {
        calls.verdict += 1;
        return {
          classification: "BOOTSTRAP_DEADLOCK_VERIFIED",
          verdict_digest: digest("deadlock-verdict-pr229"),
          exception_id: scope.exception_id,
          tenant_id: scope.tenant_id,
          work_id: scope.work_id,
          repository: scope.repository,
          pr_number: scope.pr_number,
          head_sha: scope.head_sha,
          allowed_action: scope.allowed_action,
          failure_code: scope.failure_code,
          required_checks_digest: scope.required_checks_digest,
          required_checks_results_digest: scope.required_checks_results_digest,
        };
      },
    },
    ...overrides,
  };
  return { calls, service: createBootstrapReleasePreparationService(dependencies) };
}

function input(overrides = {}) {
  return {
    authenticated_tenant_id: TENANT_ID,
    authenticated_owner_id: OWNER_ID,
    owner_confirmation: { confirmation_id: "owner-confirmation-pr229" },
    normal_action_request: request(),
    requested_ttl_seconds: 300,
    ...overrides,
  };
}

test("allowlisted induced deadlock prepares exact unsigned local-PIN receipt without authorization", async () => {
  const { calls, service } = fixtures();
  const prepared = await service.prepare(input());

  assert.equal(prepared.schema_version, BOOTSTRAP_RELEASE_PREPARATION_SCHEMA_VERSION);
  assert.equal(prepared.preparation_status, "prepared_non_authorizing");
  assert.equal(prepared.action_authorized, false);
  assert.equal(prepared.host_action_authorized, false);
  assert.equal(prepared.core_join_authorized, false);
  assert.equal(prepared.merge_authorized, false);
  assert.equal(prepared.deploy_authorized, false);
  assert.equal(prepared.unsigned_receipt.schema_version, BOOTSTRAP_RELEASE_EXCEPTION_SCHEMA_VERSION);
  assert.equal(prepared.unsigned_receipt.authority_provider, "local_pin");
  assert.equal(prepared.unsigned_receipt.core_policy_classification, "BOOTSTRAP_DEADLOCK_VERIFIED");
  assert.equal(prepared.unsigned_receipt.authority_key_id, "local-pin-p256:authority-key-pr229");
  assert.equal(prepared.unsigned_receipt.consumed_at, null);
  assert.equal(prepared.unsigned_receipt.revoked_at, null);
  assert.equal(Object.hasOwn(prepared.unsigned_receipt, "authority_assertion"), false);
  assert.equal(Object.hasOwn(prepared.unsigned_receipt, "signature"), false);
  assert.deepEqual(prepared.authority_assertion_requirements, {
    algorithm: "ECDSA-P256-SHA256-P1363",
    authority_provider: "local_pin",
    signature_field: "signature_p1363_base64url",
  });
  for (const field of [
    "required_checks_digest",
    "required_checks_results_digest",
    "owner_confirmation_digest",
    "core_policy_verdict_digest",
    "rollback_obligations_digest",
    "post_deploy_obligations_digest",
  ]) assert.match(prepared.unsigned_receipt[field], /^[a-f0-9]{64}$/);
  assert.deepEqual(calls, { normal: 1, checks: 1, verdict: 1, owner: 1 });
});

test("non-allowlisted induced normal-path failure is denied before readback and verdict", async () => {
  const { calls, service } = fixtures({
    normalPathAttempt: async () => {
      calls.normal += 1;
      const error = new Error("ordinary policy denial");
      error.failure_code = "ordinary_policy_denied";
      throw error;
    },
  });
  await assert.rejects(() => service.prepare(input()), /failure_not_allowlisted/);
  assert.equal(calls.checks, 0);
  assert.equal(calls.verdict, 0);
});

test("green normal path denies bootstrap preparation", async () => {
  const { calls, service } = fixtures({
    normalPathAttempt: async () => {
      calls.normal += 1;
      return { ok: true };
    },
  });
  await assert.rejects(() => service.prepare(input()), /bootstrap_normal_path_available/);
  assert.equal(calls.checks, 0);
  assert.equal(calls.verdict, 0);
});

test("red required check denies preparation and no deadlock verdict is issued", async () => {
  const { calls, service } = fixtures({
    requiredChecksReadback: async ({ normal_action_request }) => {
      calls.checks += 1;
      return {
        tenant_id: normal_action_request.tenant_id,
        work_id: normal_action_request.work_id,
        repository: normal_action_request.repository,
        pr_number: normal_action_request.pr_number,
        head_sha: normal_action_request.head_sha,
        policy_revision: "required-checks-policy-v3",
        checks: [{ name: "universal-core", status: "completed", conclusion: "failure" }],
      };
    },
  });
  await assert.rejects(() => service.prepare(input()), /required_checks_not_green/);
  assert.equal(calls.verdict, 0);
});

test("deadlock verdict must bind the server-side required-check readback", async () => {
  const { service } = fixtures({
    deadlockVerdictStore: {
      issue: async (scope) => ({
        classification: "BOOTSTRAP_DEADLOCK_VERIFIED",
        verdict_digest: digest("deadlock-verdict-pr229"),
        exception_id: scope.exception_id,
        tenant_id: scope.tenant_id,
        work_id: scope.work_id,
        repository: scope.repository,
        pr_number: scope.pr_number,
        head_sha: scope.head_sha,
        allowed_action: scope.allowed_action,
        failure_code: scope.failure_code,
        required_checks_digest: digest("different-required-checks"),
        required_checks_results_digest: scope.required_checks_results_digest,
      }),
    },
  });
  await assert.rejects(() => service.prepare(input()), /verdict_required_checks_digest_mismatch/);
});

test("cross-tenant request is denied before owner verification or normal action", async () => {
  const { calls, service } = fixtures();
  await assert.rejects(() => service.prepare(input({
    normal_action_request: request({ tenant_id: "tenant-other" }),
  })), /cross_tenant_denied/);
  assert.deepEqual(calls, { normal: 0, checks: 0, verdict: 0, owner: 0 });
});

test("missing owner confirmation is denied before any dependency is called", async () => {
  const { calls, service } = fixtures();
  await assert.rejects(() => service.prepare(input({ owner_confirmation: null })),
    /owner_confirmation_required/);
  assert.deepEqual(calls, { normal: 0, checks: 0, verdict: 0, owner: 0 });
});
