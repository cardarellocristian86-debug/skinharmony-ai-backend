import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";
import { SCOPES } from "../src/scope.js";

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

const OWNER_SUBJECT_FINGERPRINT = `osf_${"b".repeat(64)}`;

function signedOwnerContext(tenantId, signingSecret, issuedAt = new Date().toISOString()) {
  const context = {
    assertion_version: "owner_context_assertion_v1",
    audience: "nira_core_bridge",
    tenant_id: tenantId,
    access_mode: "god_mode",
    role: "owner_root",
    delegated_actor: "oauth",
    owner_verified: true,
    owner_subject_fingerprint: OWNER_SUBJECT_FINGERPRINT,
    issued_at: issuedAt,
    approval_digest: "",
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
    approval_digest: context.approval_digest,
  });
  return {
    ...context,
    assertion: `ocs_${crypto.createHmac("sha256", signingSecret)
      .update(`owner-context\u0000${canonical}`)
      .digest("hex")}`,
  };
}

test("provider setup-link bootstrap seeds one opaque, tenant-scoped key without expanding its authority", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "provider-bootstrap-admin";
  const storageRoot = path.join(os.tmpdir(), `provider-setup-bootstrap-${Date.now()}-${Math.random()}`);
  const providerSetupLinkKey = "render-generated-provider-setup-test-key";
  const ownerContextSigningSecret = "provider-bootstrap-owner-context-signing-secret";
  const issued = [];
  const tenantProviderSetupLinks = {
    async issue(input) {
      issued.push(input);
      return {
        token: "local_bootstrap_setup_token_abcdefghijklmnopqrstuvwxyz",
        proof: "local_bootstrap_setup_proof_abcdefghijklmnopqrstuvwxyz",
        link_id: "psl_local_bootstrap_setup_link",
        expires_at: "2026-07-19T20:00:00.000Z",
      };
    },
  };
  const service = createUniversalCoreService({
    storageRoot,
    providerSetupLinkBootstrapKey: providerSetupLinkKey,
    providerSetupLinkTenantId: "codexai",
    tenantProviderSetupLinks,
    ownerContextSigningSecret,
  });
  const { server, base } = await listen(service.app);

  try {
    const keys = await request(base, "GET", "/v1/keys?tenant_id=codexai", undefined, "provider-bootstrap-admin");
    assert.equal(keys.status, 200);
    assert.equal(keys.json.keys.length, 1);
    const [record] = keys.json.keys;
    assert.equal(record.tenant_id, "codexai");
    assert.equal(record.key_type, "connector");
    assert.deepEqual(record.allowed_scopes, [SCOPES.WRITE_PROVIDER_SETUP_LINK]);
    assert.equal(record.metadata.bootstrap_kind, "provider_setup_link");
    assert.equal(Object.hasOwn(record, "key_hash"), false);

    const health = await fetch(`${base}/healthz`);
    const healthJson = await health.json();
    assert.equal(health.status, 200);
    assert.equal(healthJson.provider_setup_link_bootstrap_configured, true);
    assert.equal(healthJson.provider_setup_link_bootstrap_state, "ready");
    assert.equal(Object.hasOwn(healthJson, "provider_setup_link_bootstrap_error"), false);

    const setupPage = await fetch(`${base}/v1/generic-agents/providers/openai/setup/local_bootstrap_setup_token_abcdefghijklmnopqrstuvwxyz`);
    assert.equal(setupPage.status, 200);
    assert.equal(setupPage.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(setupPage.headers.get("referrer-policy"), "no-referrer");
    assert.match(setupPage.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);

    const issuedLink = await request(base, "POST", "/v1/generic-agents/providers/openai/setup-links", {
      tenant_id: "codexai",
      ttl_minutes: 15,
      owner_context: signedOwnerContext("codexai", ownerContextSigningSecret),
    }, providerSetupLinkKey);
    assert.equal(issuedLink.status, 201);
    assert.equal(issuedLink.json.tenant_id, "codexai");
    assert.equal(issuedLink.json.execution_enabled, false);
    assert.equal(issuedLink.json.setup_proof, "local_bootstrap_setup_proof_abcdefghijklmnopqrstuvwxyz");
    assert.deepEqual(issued, [{
      tenant_id: "codexai",
      owner_subject_fingerprint: OWNER_SUBJECT_FINGERPRINT,
      ttl_minutes: 15,
    }]);

    const crossTenant = await request(base, "POST", "/v1/generic-agents/providers/openai/setup-links", {
      tenant_id: "another-tenant",
      owner_context: signedOwnerContext("another-tenant", ownerContextSigningSecret),
    }, providerSetupLinkKey);
    assert.equal(crossTenant.status, 403);
    assert.equal(crossTenant.json.error, "tenant_scope_denied");

    const unrelatedWrite = await request(base, "POST", "/v1/generic-agents/runs", {
      tenant_id: "codexai",
      agent_id: "must-not-start",
      task: "The setup-link key cannot run agents.",
    }, providerSetupLinkKey);
    assert.equal(unrelatedWrite.status, 403);
    assert.equal(unrelatedWrite.json.error, "scope_denied");

    const keysFile = fs.readFileSync(path.join(storageRoot, "keys", "keys.json"), "utf8");
    const auditFile = fs.readFileSync(path.join(storageRoot, "audit", "events.jsonl"), "utf8");
    assert.equal(keysFile.includes(providerSetupLinkKey), false);
    assert.equal(auditFile.includes(providerSetupLinkKey), false);
    assert.match(auditFile, /core_provider_setup_link_key_seeded/);

    const repeated = createUniversalCoreService({
      storageRoot,
      providerSetupLinkBootstrapKey: providerSetupLinkKey,
      providerSetupLinkTenantId: "codexai",
      tenantProviderSetupLinks,
    });
    const { server: repeatedServer, base: repeatedBase } = await listen(repeated.app);
    try {
      const repeatedKeys = await request(repeatedBase, "GET", "/v1/keys?tenant_id=codexai", undefined, "provider-bootstrap-admin");
      assert.equal(repeatedKeys.status, 200);
      assert.equal(repeatedKeys.json.keys.length, 1);
      assert.equal(repeatedKeys.json.keys[0].key_id, record.key_id);
    } finally {
      await new Promise((resolve) => repeatedServer.close(resolve));
    }

    const conflicted = createUniversalCoreService({
      storageRoot,
      providerSetupLinkBootstrapKey: "rotated-provider-setup-test-key",
      providerSetupLinkTenantId: "codexai",
      tenantProviderSetupLinks,
    });
    const { server: conflictedServer, base: conflictedBase } = await listen(conflicted.app);
    try {
      const conflictedHealth = await fetch(`${conflictedBase}/healthz`);
      const conflictedHealthJson = await conflictedHealth.json();
      assert.equal(conflictedHealth.status, 200);
      assert.equal(conflictedHealthJson.provider_setup_link_bootstrap_configured, false);
      assert.equal(conflictedHealthJson.provider_setup_link_bootstrap_state, "binding_conflict");
    } finally {
      await new Promise((resolve) => conflictedServer.close(resolve));
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});

test("provider setup-link bootstrap fails closed without taking down Core when its tenant binding is absent", async () => {
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `provider-setup-bootstrap-missing-tenant-${Date.now()}-${Math.random()}`),
    providerSetupLinkBootstrapKey: "bootstrap-key-without-a-tenant",
  });
  const { server, base } = await listen(service.app);
  try {
    const health = await fetch(`${base}/healthz`);
    const healthJson = await health.json();
    assert.equal(health.status, 200);
    assert.equal(healthJson.provider_setup_link_bootstrap_configured, false);
    assert.equal(healthJson.provider_setup_link_bootstrap_state, "incomplete");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("provider setup-link bootstrap reports a missing target key without exposing binding details", async () => {
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `provider-setup-bootstrap-missing-key-${Date.now()}-${Math.random()}`),
    providerSetupLinkTenantId: "codexai",
  });
  const { server, base } = await listen(service.app);
  try {
    const health = await fetch(`${base}/healthz`);
    const healthJson = await health.json();
    assert.equal(health.status, 200);
    assert.equal(healthJson.provider_setup_link_bootstrap_configured, false);
    assert.equal(healthJson.provider_setup_link_bootstrap_state, "binding_missing");
    assert.equal(Object.hasOwn(healthJson, "provider_setup_link_bootstrap_error"), false);
    assert.equal(Object.hasOwn(healthJson, "provider_setup_link_bootstrap_tenant"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("provider setup-link bootstrap reports incomplete when no target binding is configured", async () => {
  const service = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `provider-setup-bootstrap-unconfigured-${Date.now()}-${Math.random()}`),
  });
  const { server, base } = await listen(service.app);
  try {
    const health = await fetch(`${base}/healthz`);
    const healthJson = await health.json();
    assert.equal(health.status, 200);
    assert.equal(healthJson.provider_setup_link_bootstrap_configured, false);
    assert.equal(healthJson.provider_setup_link_bootstrap_state, "incomplete");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
