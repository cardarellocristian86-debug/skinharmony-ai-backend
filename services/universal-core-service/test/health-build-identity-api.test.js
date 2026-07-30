import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";
import {
  createPostgresMajorVersionProbe,
} from "../../shared/postgres-major-version.js";

const READY_HOST_NATIVE_GOVERNANCE = Object.freeze({
  storage: Object.freeze({
    kind: "test_persistent",
    restart_durable: true,
    distributed: true,
  }),
  trusted_readback_configured: true,
  release_join_verdict_resolver_configured: true,
  required_checks_policy_resolver_configured: true,
  closure_attestation_verifier_configured: true,
});

function postgresMajorProbe(serverVersionNum) {
  return createPostgresMajorVersionProbe({
    query: async () => {
      if (serverVersionNum instanceof Error) throw serverVersionNum;
      return {
        rows: [{ server_version_num: String(serverVersionNum) }],
      };
    },
    cacheTtlMs: 0,
  });
}

async function withEnv(values, run) {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function readHealth(options = {}) {
  const storageRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "host-native-readiness-"),
  );
  const { app } = createUniversalCoreService({ storageRoot, ...options });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/healthz`,
    );
    return { response, health: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
}

test("health exposes a non-secret build identity and commit-verification state", async () => {
  const ownerContextSigningSecret = "health-owner-context-signing-secret";
  const { app } = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `health-build-${Date.now()}-${Math.random()}`),
    ownerContextSigningSecret,
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    const health = await response.json();
    assert.equal(response.status, 200);
    assert.equal(health.ok, true);
    assert.equal(typeof health.build.build_id, "string");
    assert.equal(typeof health.build.commit_verifiable, "boolean");
    assert.ok(health.build.commit_sha === null || /^[a-f0-9]{7,}$/i.test(health.build.commit_sha));
    assert.equal(health.owner_context_signing_configured, true);
    assert.equal(JSON.stringify(health).includes(ownerContextSigningSecret), false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("production host-native readiness requires gateway, separated signing, DTT, and PostgreSQL", async () => {
  await withEnv({
    NODE_ENV: "production",
    CORE_EVIDENCE_SIGNING_SECRET: "e".repeat(32),
    CORE_HOST_NATIVE_GOVERNANCE_ENABLED: "true",
    CORE_MCP_TENANT_GATEWAY_KEY: undefined,
    CORE_MCP_TENANT_CONTEXT_SIGNING_SECRET: undefined,
    CORE_OWNER_CONTEXT_SIGNING_SECRET: undefined,
    DTT_AGENT_IDENTITY_SIGNING_SECRET: undefined,
    GOVERNED_AGENT_DATABASE_URL: undefined,
  }, async () => {
    const { response, health } = await readHealth({
      hostNativeGovernance: READY_HOST_NATIVE_GOVERNANCE,
    });
    assert.equal(response.status, 503);
    assert.equal(
      health.host_native_governance.production_readiness_required,
      true,
    );
    assert.equal(
      health.host_native_governance.production_readiness_ready,
      false,
    );
    assert.deepEqual(
      health.host_native_governance.production_readiness_reasons,
      [
        "mcp_tenant_gateway_not_configured",
        "tenant_context_signing_not_configured",
        "owner_context_signing_not_configured",
        "dtt_closure_signing_not_configured",
        "governed_agent_postgres_not_configured",
      ],
    );
    assert.equal(
      JSON.stringify(health).includes("e".repeat(32)),
      false,
    );
  });
});

test("PostgreSQL 18 clears complete host-native production readiness blockers", async () => {
  await withEnv({
    NODE_ENV: "production",
    CORE_EVIDENCE_SIGNING_SECRET: "e".repeat(32),
    CORE_HOST_NATIVE_GOVERNANCE_ENABLED: "true",
    GOVERNED_AGENT_DATABASE_URL: "postgresql://core.test/governance",
  }, async () => {
    const { health } = await readHealth({
      hostNativeGovernance: READY_HOST_NATIVE_GOVERNANCE,
      mcpTenantGatewayKey: "g".repeat(32),
      tenantContextSigningSecret: "t".repeat(32),
      ownerContextSigningSecret: "o".repeat(32),
      dttAgentIdentitySigningSecret: "d".repeat(32),
      governedAgentPostgresVersionProbe: postgresMajorProbe(180_004),
    });
    assert.equal(
      health.host_native_governance.production_readiness_required,
      true,
    );
    assert.equal(
      health.host_native_governance.production_readiness_ready,
      true,
    );
    assert.deepEqual(
      health.host_native_governance.production_readiness_reasons,
      [],
    );
    assert.equal(
      health.host_native_governance.mcp_tenant_gateway_configured,
      true,
    );
    assert.equal(
      health.host_native_governance.tenant_context_signing_configured,
      true,
    );
    assert.equal(
      health.host_native_governance.owner_context_signing_configured,
      true,
    );
    assert.equal(
      health.host_native_governance.dtt_closure_signing_configured,
      true,
    );
    assert.equal(
      health.host_native_governance.governed_agent_postgres_configured,
      true,
    );
    assert.deepEqual(
      health.host_native_governance.governed_agent_postgres_version,
      { major: 18, verified: true },
    );
    assert.equal(
      JSON.stringify(health).includes("postgresql://"),
      false,
    );
  });
});

test("Core production readiness rejects PostgreSQL 15 and probe errors", async () => {
  await withEnv({
    NODE_ENV: "production",
    CORE_EVIDENCE_SIGNING_SECRET: "e".repeat(32),
    CORE_HOST_NATIVE_GOVERNANCE_ENABLED: "true",
    GOVERNED_AGENT_DATABASE_URL: "postgresql://core.test/governance",
  }, async () => {
    for (const [serverVersion, expectedMajor] of [
      [150_014, 15],
      [new Error("postgresql://user:secret@example.test/private"), null],
    ]) {
      const { response, health } = await readHealth({
        hostNativeGovernance: READY_HOST_NATIVE_GOVERNANCE,
        mcpTenantGatewayKey: "g".repeat(32),
        tenantContextSigningSecret: "t".repeat(32),
        ownerContextSigningSecret: "o".repeat(32),
        dttAgentIdentitySigningSecret: "d".repeat(32),
        governedAgentPostgresVersionProbe:
          postgresMajorProbe(serverVersion),
      });
      assert.equal(response.status, 503);
      assert.deepEqual(
        health.host_native_governance.production_readiness_reasons,
        ["governed_agent_postgres_major_16_not_verified"],
      );
      assert.deepEqual(
        health.host_native_governance.governed_agent_postgres_version,
        { major: expectedMajor, verified: false },
      );
      assert.equal(JSON.stringify(health).includes("postgres://"), false);
      assert.equal(JSON.stringify(health).includes("postgresql://"), false);
      assert.equal(
        JSON.stringify(health).includes("server_version_num"),
        false,
      );
    }
  });
});

test("development host-native health does not enforce production prerequisites", async () => {
  await withEnv({
    NODE_ENV: "test",
    CORE_HOST_NATIVE_GOVERNANCE_ENABLED: "true",
    CORE_MCP_TENANT_GATEWAY_KEY: undefined,
    CORE_MCP_TENANT_CONTEXT_SIGNING_SECRET: undefined,
    CORE_OWNER_CONTEXT_SIGNING_SECRET: undefined,
    DTT_AGENT_IDENTITY_SIGNING_SECRET: undefined,
    GOVERNED_AGENT_DATABASE_URL: undefined,
  }, async () => {
    const { response, health } = await readHealth({
      hostNativeGovernance: READY_HOST_NATIVE_GOVERNANCE,
    });
    assert.equal(response.status, 200);
    assert.equal(
      health.host_native_governance.production_readiness_required,
      false,
    );
    assert.equal(
      health.host_native_governance.production_readiness_ready,
      true,
    );
    assert.deepEqual(
      health.host_native_governance.production_readiness_reasons,
      [],
    );
  });
});
