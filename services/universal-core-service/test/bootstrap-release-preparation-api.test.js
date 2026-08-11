import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createUniversalCoreService } from "../src/app.js";

test("bootstrap preparation API uses authenticated tenant and injected non-authorizing preparation service", async () => {
  let received = null;
  const previousAdminKey = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "bootstrap-release-preparation-api-admin";
  const { app } = createUniversalCoreService({
    hostNativeGovernance: {
      required_checks_policy_resolver_configured: true,
      closure_attestation_verifier_configured: true,
      issueActionTicket: async () => ({ ok: true }),
    },
    bootstrapReleasePreparationService: {
      prepare: async (input) => {
        received = input;
        return {
          preparation_status: "prepared_non_authorizing",
          action_authorized: false,
          merge_authorized: false,
          deploy_authorized: false,
          core_join_authorized: false,
          unsigned_receipt: { work_id: input.normal_action_request.work_id, exception_id: "bootstrap-test-001" },
        };
      },
    },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const keyResponse = await fetch(`${base}/v1/keys/generate`, {
      method: "POST",
      headers: {
        authorization: "Bearer bootstrap-release-preparation-api-admin",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        tenant_id: "tenant-bootstrap-api",
        key_type: "automation",
        allowed_scopes: ["automation:codex", "owner:assertion"],
      }),
    });
    assert.equal(keyResponse.status, 201);
    const scopedKey = (await keyResponse.json()).key;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/host-native/bootstrap/release-exceptions/prepare`, {
      method: "POST",
      headers: { authorization: `Bearer ${scopedKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        owner_confirmation: { owner_subject_fingerprint: "osf_test_owner" },
        normal_action_request: {
          request_id: "bootstrap-test-request", tenant_id: "tenant-bootstrap-api", work_id: "bootstrap-test-work",
          repository: "owner/repository", pr_number: 1, head_sha: "a".repeat(40), allowed_action: "github.merge",
        },
        requested_ttl_seconds: 60,
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.action_authorized, false);
    assert.equal(body.core_join_authorized, false);
    assert.equal(received.authenticated_tenant_id, "tenant-bootstrap-api");
    assert.equal(received.normal_action_request.tenant_id, "tenant-bootstrap-api");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdminKey === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdminKey;
  }
});

test("health reports an unpinned bootstrap authority without bootstrap authorization", async () => {
  const { app } = createUniversalCoreService();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    const body = await response.json();
    assert.equal(body.bootstrap_release_exception.pinned, false);
    assert.equal(body.bootstrap_release_exception.attestation_status, "unavailable");
    assert.equal(body.bootstrap_release_exception.host_action_authorized, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("health preserves the local software un-attested trust state", async () => {
  const { app } = createUniversalCoreService({
    bootstrapAuthorityTrustPinJson: JSON.stringify({
      schema_version: "bootstrap_authority_trust_pin_v1",
      tenant_id: "tenant-bootstrap-api",
      authority_key_id: "local-pin-key-001",
      public_key_sha256: "a".repeat(64),
      genesis_record_digest: "b".repeat(64),
    }),
    bootstrapReleaseExceptionStore: {
      initialize: async () => ({}),
      resolveActiveTrustKey: async () => ({
        authority_key_id: "local-pin-key-001",
        authority_provider: "local_pin",
        algorithm: "ECDSA_P256_SHA256_P1363",
        attestation_status: "UNATTESTED_LOCAL_SOFTWARE",
        provider_attestation_digest: null,
        public_key_sha256: "a".repeat(64),
        genesis_record_digest: "b".repeat(64),
      }),
    },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    const body = await response.json();
    assert.equal(body.bootstrap_release_exception.pinned, true);
    assert.equal(body.bootstrap_release_exception.attestation_status, "UNATTESTED_LOCAL_SOFTWARE");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
