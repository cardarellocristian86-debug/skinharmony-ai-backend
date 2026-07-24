import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

const PURPOSE = "tenant_openai_project_review";

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableCanonical(value[key]);
    return result;
  }, {});
}

function ownerRequestBinding(purpose, body) {
  return `${purpose}\u0000${JSON.stringify(stableCanonical(body))}`;
}

function signedOwnerContext({ tenantId, signingSecret, body, issuedAt = new Date().toISOString(), delegatedActor = "oauth" }) {
  const context = {
    assertion_version: "owner_context_assertion_v1",
    audience: "nira_core_bridge",
    tenant_id: tenantId,
    access_mode: "tenant_owner",
    role: "tenant_owner",
    delegated_actor: delegatedActor,
    owner_verified: true,
    owner_subject_fingerprint: `osf_${"c".repeat(64)}`,
    issued_at: issuedAt,
    binding_version: "owner_request_binding_v1",
    binding_hash: crypto.createHash("sha256").update(ownerRequestBinding(PURPOSE, body)).digest("hex"),
    approval_digest: "project-review-test-owner-approval",
  };
  const canonical = JSON.stringify({
    version: context.assertion_version,
    audience: context.audience,
    tenant_id: context.tenant_id,
    access_mode: context.access_mode,
    role: context.role,
    delegated_actor: context.delegated_actor,
    owner_verified: context.owner_verified,
    owner_subject_fingerprint: context.owner_subject_fingerprint,
    issued_at: context.issued_at,
    binding_version: context.binding_version,
    binding_hash: context.binding_hash,
    approval_digest: context.approval_digest,
  });
  return {
    ...context,
    assertion: `ocs_${crypto.createHmac("sha256", signingSecret)
      .update(`owner-context\u0000${canonical}`)
      .digest("hex")}`,
  };
}

function canonicalReviewBody({
  tenantId = "tenant-review-a",
  projectId = "project-review-safe",
  runId = "run_review_safe_001",
  expectedRevision = "a".repeat(64),
  disposition = "accept_selected",
  reviewDigest = "b".repeat(64),
  decisionCount = 2,
  evidenceCount = 1,
  idempotencyKey = "review_project-review-safe_run-review-safe-001",
  ownerConfirmed = true,
} = {}) {
  return {
    tenant_id: tenantId,
    project_id: projectId,
    run_id: runId,
    expected_revision: expectedRevision,
    disposition,
    review_digest_sha256: reviewDigest,
    decision_count: decisionCount,
    evidence_count: evidenceCount,
    idempotency_key: idempotencyKey,
    owner_confirmed: ownerConfirmed,
  };
}

function reviewRequest({ signingSecret, issuedAt, delegatedActor, ...overrides } = {}) {
  const body = canonicalReviewBody(overrides);
  return {
    ...body,
    owner_context: signedOwnerContext({
      tenantId: body.tenant_id,
      signingSecret,
      body,
      issuedAt,
      delegatedActor,
    }),
  };
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function request(base, method, pathname, body, key) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

async function createFixture({ ownerContextSigningSecret = "project-review-owner-context-signing-secret-32", tenantProviderCredentials } = {}) {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "project-review-authorization-admin";
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "core-project-review-authorization-"));
  const service = createUniversalCoreService({
    storageRoot,
    ownerContextSigningSecret,
    tenantProviderCredentials,
  });
  const listener = await listen(service.app);
  const keyA = await request(listener.base, "POST", "/v1/keys/generate", {
    tenant_id: "tenant-review-a",
    preset: "codex_automation",
  }, "project-review-authorization-admin");
  const keyB = await request(listener.base, "POST", "/v1/keys/generate", {
    tenant_id: "tenant-review-b",
    preset: "codex_automation",
  }, "project-review-authorization-admin");
  assert.equal(keyA.status, 201);
  assert.equal(keyB.status, 201);
  return {
    base: listener.base,
    storageRoot,
    signingSecret: ownerContextSigningSecret,
    keyA: keyA.json.key,
    keyB: keyB.json.key,
    async close() {
      await new Promise((resolve) => listener.server.close(resolve));
      if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
      else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
    },
  };
}

const endpoint = "/v1/generic-agents/providers/openai/project-reviews/authorize";

test("project review authorization is owner-bound, content-free, one-use, and does not require a configured provider or runner", async () => {
  const fixture = await createFixture();
  try {
    const body = reviewRequest({ signingSecret: fixture.signingSecret });
    const authorized = await request(fixture.base, "POST", endpoint, body, fixture.keyA);
    assert.equal(authorized.status, 200);
    assert.equal(authorized.json.ok, true);
    assert.equal(authorized.json.allowed, true);
    assert.equal(authorized.json.tenant_id, "tenant-review-a");
    assert.match(authorized.json.authorization.authorization_id, /^pra_[0-9a-f-]{36}$/);
    assert.equal(authorized.json.authorization.allowed, true);
    assert.equal(authorized.json.authorization.purpose, PURPOSE);
    assert.equal(authorized.json.authorization.owner_confirmation_satisfied, true);
    assert.deepEqual(authorized.json.authorization.binding, {
      binding_version: "owner_request_binding_v1",
      binding_hash: body.owner_context.binding_hash,
      tenant_id: "tenant-review-a",
      project_id: body.project_id,
      run_id: body.run_id,
      expected_revision: body.expected_revision,
      disposition: body.disposition,
      review_digest_sha256: body.review_digest_sha256,
      decision_count: body.decision_count,
      evidence_count: body.evidence_count,
      idempotency_key: body.idempotency_key,
    });
    const serialized = JSON.stringify(authorized.json);
    assert.equal(serialized.includes("decision_items"), false);
    assert.equal(serialized.includes("evidence_items"), false);
    assert.equal(serialized.includes("owner_context"), false);
    assert.equal(serialized.includes(body.owner_context.assertion), false);

    const replay = await request(fixture.base, "POST", endpoint, body, fixture.keyA);
    assert.equal(replay.status, 409);
    assert.equal(replay.json.error, "owner_confirmation_replayed");

    const auditLog = fs.readFileSync(path.join(fixture.storageRoot, "audit", "events.jsonl"), "utf8");
    assert.match(auditLog, /tenant_openai_project_review_authorized/);
    assert.match(auditLog, /tenant_openai_project_review_denied/);
    assert.equal(auditLog.includes(body.owner_context.assertion), false);
  } finally {
    await fixture.close();
  }
});

test("project review authorization fails closed for stale, mismatched, non-OAuth, unconfirmed, and cross-tenant owner assertions", async () => {
  const fixture = await createFixture();
  try {
    const stale = reviewRequest({
      signingSecret: fixture.signingSecret,
      issuedAt: new Date(Date.now() - 121_000).toISOString(),
      idempotencyKey: "review_stale-owner-context",
    });
    const staleResponse = await request(fixture.base, "POST", endpoint, stale, fixture.keyA);
    assert.equal(staleResponse.status, 403);
    assert.equal(staleResponse.json.error, "owner_context_required");

    const mismatched = reviewRequest({
      signingSecret: fixture.signingSecret,
      idempotencyKey: "review_request-binding-mismatch",
    });
    mismatched.review_digest_sha256 = "d".repeat(64);
    const mismatchedResponse = await request(fixture.base, "POST", endpoint, mismatched, fixture.keyA);
    assert.equal(mismatchedResponse.status, 403);
    assert.equal(mismatchedResponse.json.error, "owner_context_required");

    const nonOauth = reviewRequest({
      signingSecret: fixture.signingSecret,
      delegatedActor: "codex",
      idempotencyKey: "review_non-oauth-owner-context",
    });
    const nonOauthResponse = await request(fixture.base, "POST", endpoint, nonOauth, fixture.keyA);
    assert.equal(nonOauthResponse.status, 403);
    assert.equal(nonOauthResponse.json.error, "owner_context_required");

    const unconfirmed = reviewRequest({
      signingSecret: fixture.signingSecret,
      ownerConfirmed: false,
      idempotencyKey: "review_explicit-confirmation-required",
    });
    const unconfirmedResponse = await request(fixture.base, "POST", endpoint, unconfirmed, fixture.keyA);
    assert.equal(unconfirmedResponse.status, 403);
    assert.equal(unconfirmedResponse.json.error, "owner_confirmation_required");

    const crossTenant = reviewRequest({
      signingSecret: fixture.signingSecret,
      tenantId: "tenant-review-b",
      idempotencyKey: "review_cross-tenant-attempt",
    });
    const crossTenantResponse = await request(fixture.base, "POST", endpoint, crossTenant, fixture.keyA);
    assert.equal(crossTenantResponse.status, 403);
    assert.equal(crossTenantResponse.json.error, "tenant_scope_denied");

    const auditLog = fs.readFileSync(path.join(fixture.storageRoot, "audit", "events.jsonl"), "utf8");
    assert.match(auditLog, /tenant_openai_project_review_denied/);
    assert.match(auditLog, /core_tenant_scope_denied/);
  } finally {
    await fixture.close();
  }
});

test("project review authorization validates the canonical metadata envelope and rejects review content", async () => {
  const fixture = await createFixture();
  try {
    const invalidCases = [
      ["expected_revision_invalid", { expected_revision: "not-a-revision" }],
      ["project_review_disposition_invalid", { disposition: "accept_all" }],
      ["review_digest_sha256_invalid", { review_digest_sha256: "not-a-digest" }],
      ["project_review_decision_count_invalid", { decision_count: 11 }],
      ["project_review_evidence_count_invalid", { evidence_count: -1 }],
      ["project_review_idempotency_key_invalid", { idempotency_key: "1234567" }],
      ["project_review_idempotency_key_invalid", { idempotency_key: "r".repeat(121) }],
      ["project_review_idempotency_key_invalid", { idempotency_key: "bad key with spaces" }],
      ["project_review_body_invalid", { decision_items: ["must never reach Core"] }],
    ];
    for (const [expectedError, patch] of invalidCases) {
      const canonical = canonicalReviewBody();
      const response = await request(fixture.base, "POST", endpoint, { ...canonical, ...patch }, fixture.keyA);
      assert.equal(response.status, 400, expectedError);
      assert.equal(response.json.error, expectedError);
    }
  } finally {
    await fixture.close();
  }
});

test("project review authorization accepts idempotency keys at the 8 and 120 character boundaries", async () => {
  const fixture = await createFixture();
  try {
    for (const idempotencyKey of ["review01", `r${"a".repeat(119)}`]) {
      const body = reviewRequest({
        signingSecret: fixture.signingSecret,
        idempotencyKey,
      });
      const response = await request(fixture.base, "POST", endpoint, body, fixture.keyA);
      assert.equal(response.status, 200, `expected ${idempotencyKey.length}-character key to be accepted`);
      assert.equal(response.json.authorization.binding.idempotency_key, idempotencyKey);
    }
  } finally {
    await fixture.close();
  }
});

test("project review authorization remains unavailable without a valid owner-context signing secret", async () => {
  const fixture = await createFixture({ ownerContextSigningSecret: "" });
  try {
    const body = reviewRequest({
      signingSecret: "caller-controlled-signing-material-that-Core-must-not-trust",
      idempotencyKey: "review_missing-core-signing-secret",
    });
    const response = await request(fixture.base, "POST", endpoint, body, fixture.keyA);
    assert.equal(response.status, 403);
    assert.equal(response.json.error, "owner_context_required");
  } finally {
    await fixture.close();
  }
});
