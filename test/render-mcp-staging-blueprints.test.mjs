import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  readMcpStagingBlueprints,
  validateMcpStagingBlueprints,
} from "../scripts/render-mcp-staging-blueprint-policy.mjs";
import {
  skinHarmonyMcpStagingTopology,
} from "../services/universal-core-service/src/domainAdapters/skinharmonyMcpStagingTopologyAction.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function documents() {
  return structuredClone(readMcpStagingBlueprints(repositoryRoot));
}

function services(document) {
  return document.projects[0].environments[0].services;
}

function service(document, name) {
  return services(document).find((item) => item.name === name);
}

function env(serviceValue, key) {
  return serviceValue.envVars.find((entry) => entry.key === key);
}

test("the three Blueprint documents satisfy the closed static staging policy", () => {
  const report = validateMcpStagingBlueprints(documents());
  assert.equal(report.static_policy_ok, true);
  assert.equal(report.deploy_ready, false);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.blockers, [
    "blueprint_phase_resource_adoption_requires_provider_validation",
    "private_service_recurring_cost_requires_exact_owner_confirmation",
    "runtime_database_role_requires_provider_native_creation",
  ]);
  assert.deepEqual(report.risks, [
    "staging_environment_network_isolation_not_enabled",
  ]);
  assert.equal(report.secrets_exposed, false);
});

test("declares only the exact bootstrap, control and final service sets", () => {
  const value = documents();
  assert.deepEqual(services(value.bootstrap).map(({ name }) => name).sort(), [
    "skinharmony-core-staging-issuer",
    "skinharmony-mcp-staging-db-bootstrap",
    "skinharmony-nyra-staging-issuer",
  ]);
  assert.deepEqual(services(value.control).map(({ name }) => name).sort(), [
    "skinharmony-core-staging-issuer",
    "skinharmony-mcp-staging-db-bootstrap",
    "skinharmony-nyra-staging-issuer",
  ]);
  assert.deepEqual(services(value.final).map(({ name }) => name).sort(), [
    "skinharmony-core-mcp-staging",
    "skinharmony-core-staging-issuer",
    "skinharmony-mcp-staging-db-bootstrap",
    "skinharmony-nyra-staging-issuer",
    "skinharmony-universal-core-staging",
  ]);
  for (const document of Object.values(value)) {
    assert.deepEqual(Object.keys(document), ["projects"]);
    assert.equal(document.projects.length, 1);
    assert.deepEqual(Object.keys(document.projects[0]).sort(), ["environments", "name"]);
    assert.equal(document.projects[0].name, "My project");
    assert.equal(document.projects[0].environments.length, 1);
    assert.deepEqual(
      Object.keys(document.projects[0].environments[0]).sort(),
      ["name", "services"],
    );
    assert.equal(document.projects[0].environments[0].name, "staging");
    for (const item of services(document)) {
      assert.equal(item.region, "oregon");
      assert.equal(
        item.repo,
        "https://github.com/cardarellocristian86-debug/skinharmony-ai-backend",
      );
      assert.equal(item.branch, "agent/mcp-staging-shared-memory-release");
      assert.equal(item.autoDeployTrigger, "off");
      assert.equal(item.runtime, "node");
      assert.equal("rootDir" in item, false);
      assert.match(item.buildCommand, /^npm ci --prefix services\//);
      assert.match(item.startCommand, /^npm --prefix services\/.+ start$/);
    }
  }
});

test("matches the topology reserved by the Universal Core domain gate", () => {
  const value = documents();
  const reserved = skinHarmonyMcpStagingTopology();
  const manifestServices = services(value.final).map(({ name, type, plan }) => ({
    name,
    resource_type: type === "pserv" ? "private_service" : "web_service",
    plan,
    lifecycle: "create_only",
  }));
  assert.deepEqual(
    manifestServices.sort((left, right) => left.name.localeCompare(right.name)),
    structuredClone(reserved.services).sort((left, right) => left.name.localeCompare(right.name)),
  );
  assert.equal(reserved.database.name, "skinharmony-mcp-staging-db");
  assert.equal(reserved.database.lifecycle, "existing_only");
  assert.equal(reserved.database.required_status, "available");
  assert.equal(reserved.environment, "staging");
  assert.equal(reserved.region, "Oregon");
  assert.deepEqual(reserved.rollout_contract, {
    dependency_manifest: "render-mcp-staging-bootstrap.yaml",
    control_plane_manifest: "render-mcp-staging-control-plane.yaml",
    runtime_manifest: "render-mcp-staging.yaml",
    database_bootstrap_modes: ["hold", "initialize", "steady"],
    initial_database_reference: false,
    provider_managed_runtime_role: "mcp_collaboration_runtime",
  });
});

test("references the existing PostgreSQL only and never declares or aliases DATABASE_URL", () => {
  const value = documents();
  const references = [];
  for (const document of Object.values(value)) {
    assert.equal("databases" in document, false);
    assert.equal("databases" in document.projects[0], false);
    assert.equal("databases" in document.projects[0].environments[0], false);
    for (const item of services(document)) {
      for (const entry of item.envVars) {
        assert.notEqual(entry.key, "DATABASE_URL");
        if (entry.fromDatabase) references.push([item.name, entry.key, entry.fromDatabase]);
      }
    }
  }
  assert.deepEqual(references, [
    [
      "skinharmony-mcp-staging-db-bootstrap",
      "PG_ADMIN_DATABASE_URL",
      { name: "skinharmony-mcp-staging-db", property: "connectionString" },
    ],
    [
      "skinharmony-mcp-staging-db-bootstrap",
      "PG_EXPECTED_DATABASE_NAME",
      { name: "skinharmony-mcp-staging-db", property: "database" },
    ],
    [
      "skinharmony-mcp-staging-db-bootstrap",
      "PG_ADMIN_DATABASE_URL",
      { name: "skinharmony-mcp-staging-db", property: "connectionString" },
    ],
    [
      "skinharmony-mcp-staging-db-bootstrap",
      "PG_EXPECTED_DATABASE_NAME",
      { name: "skinharmony-mcp-staging-db", property: "database" },
    ],
    [
      "skinharmony-core-mcp-staging",
      "MCP_COLLABORATION_DATABASE_URL",
      { name: "skinharmony-mcp-staging-db", property: "connectionString" },
    ],
  ]);
});

test("uses only generated or provider-copied secret values and no Auth0 surface", () => {
  const value = documents();
  for (const document of Object.values(value)) {
    for (const item of services(document)) {
      for (const entry of item.envVars) {
        assert.equal(entry.key.startsWith("AUTH0_"), false);
        if (/(?:SECRET|TOKEN|PASSWORD|(?:^|_)KEYS?$|DATABASE_URL$)/.test(entry.key)) {
          assert.equal(
            entry.generateValue === true ||
              Boolean(entry.fromService) ||
              Boolean(entry.fromDatabase),
            true,
            `${item.name}:${entry.key}`,
          );
          assert.equal("value" in entry, false);
          assert.equal("sync" in entry, false);
        }
      }
    }
  }
});

test("discovers issuer trust dynamically and originates Universal Core shared values at MCP", () => {
  const value = documents();
  const finalMcp = service(value.final, "skinharmony-core-mcp-staging");
  const finalCore = service(value.final, "skinharmony-universal-core-staging");
  const finalBootstrap = service(value.final, "skinharmony-mcp-staging-db-bootstrap");
  for (const document of Object.values(value)) {
    for (const item of services(document)) {
      assert.equal(env(item, "NODE_ENV")?.value, "production");
      assert.equal(
        item.envVars.some(({ key }) =>
          /^MCP_COLLABORATION_(?:CORE|NYRA)_(?:JWK|KID)$/.test(key)),
        false,
      );
    }
  }
  assert.deepEqual(env(finalMcp, "UNIVERSAL_CORE_KEY"), {
    key: "UNIVERSAL_CORE_KEY",
    generateValue: true,
  });
  assert.deepEqual(env(finalCore, "CORE_MCP_STAGING_SERVICE_KEY"), {
    key: "CORE_MCP_STAGING_SERVICE_KEY",
    fromService: {
      type: "web",
      name: "skinharmony-core-mcp-staging",
      envVarKey: "UNIVERSAL_CORE_KEY",
    },
  });
  assert.equal(env(finalCore, "CORE_SERVICE_ADMIN_KEY"), undefined);
  assert.deepEqual(env(finalBootstrap, "MCP_STAGING_UNIVERSAL_CORE_KEY"), {
    key: "MCP_STAGING_UNIVERSAL_CORE_KEY",
    fromService: {
      type: "web",
      name: "skinharmony-core-mcp-staging",
      envVarKey: "UNIVERSAL_CORE_KEY",
    },
  });
  assert.deepEqual(env(finalBootstrap, "MCP_STAGING_CORE_ISSUER_TOKEN"), {
    key: "MCP_STAGING_CORE_ISSUER_TOKEN",
    fromService: {
      type: "pserv",
      name: "skinharmony-core-staging-issuer",
      envVarKey: "MCP_STAGING_ISSUER_AUTH_TOKEN",
    },
  });
  assert.deepEqual(env(finalBootstrap, "MCP_STAGING_NYRA_ISSUER_TOKEN"), {
    key: "MCP_STAGING_NYRA_ISSUER_TOKEN",
    fromService: {
      type: "pserv",
      name: "skinharmony-nyra-staging-issuer",
      envVarKey: "MCP_STAGING_ISSUER_AUTH_TOKEN",
    },
  });
  assert.equal(
    env(finalMcp, "UNIVERSAL_CORE_URL")?.value,
    "http://skinharmony-universal-core-staging:8787",
  );
});

test("pins phase transitions without hardcoding the provider build commit", () => {
  const value = documents();
  const bootstrapHold = service(value.bootstrap, "skinharmony-mcp-staging-db-bootstrap");
  const controlInitialize = service(value.control, "skinharmony-mcp-staging-db-bootstrap");
  const finalControl = service(value.final, "skinharmony-mcp-staging-db-bootstrap");
  assert.equal(env(bootstrapHold, "MCP_STAGING_DB_BOOTSTRAP_MODE").value, "hold");
  assert.equal(
    bootstrapHold.envVars.some((entry) => Boolean(entry.fromDatabase)),
    false,
  );
  for (const item of services(value.bootstrap)) {
    assert.equal(env(item, "MCP_STAGING_DEPENDENCY_BUILD_COMMIT"), undefined);
  }
  assert.equal(
    env(controlInitialize, "MCP_STAGING_DB_BOOTSTRAP_MODE").value,
    "initialize",
  );
  assert.equal(env(finalControl, "MCP_STAGING_DB_BOOTSTRAP_MODE").value, "steady");
  for (const document of Object.values(value)) {
    for (const item of services(document)) {
      assert.equal(env(item, "RENDER_GIT_COMMIT"), undefined);
      const approved = env(item, "MCP_STAGING_DEPENDENCY_BUILD_COMMIT");
      if (approved) assert.deepEqual(approved, {
        key: "MCP_STAGING_DEPENDENCY_BUILD_COMMIT",
        fromService: {
          type: item.type,
          name: item.name,
          envVarKey: "RENDER_GIT_COMMIT",
        },
      });
    }
  }
  assert.deepEqual(
    env(service(value.final, "skinharmony-core-mcp-staging"), "MCP_COLLABORATION_BUILD_COMMIT"),
    {
      key: "MCP_COLLABORATION_BUILD_COMMIT",
      fromService: {
        type: "web",
        name: "skinharmony-core-mcp-staging",
        envVarKey: "RENDER_GIT_COMMIT",
      },
    },
  );
});

test("fails closed on extra services, production, main, Auth0, generic DB and literal secrets", () => {
  const mutations = [
    (value) => services(value.final).push(structuredClone(services(value.final)[0])),
    (value) => { value.final.projects[0].name = "Another project"; },
    (value) => { value.final.projects[0].environments[0].name = "production"; },
    (value) => { services(value.final)[0].region = "frankfurt"; },
    (value) => { services(value.final)[0].repo = "https://github.com/example/other"; },
    (value) => { services(value.final)[0].branch = "main"; },
    (value) => { services(value.final)[0].autoDeployTrigger = "commit"; },
    (value) => { services(value.final)[0].rootDir = "services/mcp-staging-db-bootstrap"; },
    (value) => {
      service(value.final, "skinharmony-core-mcp-staging").envVars.push({
        key: "AUTH0_ISSUER",
        value: "https://auth.invalid",
      });
    },
    (value) => {
      service(value.final, "skinharmony-core-mcp-staging").envVars.push({
        key: "DATABASE_URL",
        fromDatabase: { name: "skinharmony-mcp-staging-db", property: "connectionString" },
      });
    },
    (value) => {
      env(
        service(value.final, "skinharmony-core-staging-issuer"),
        "MCP_STAGING_ISSUER_AUTH_TOKEN",
      ).value = "literal-forbidden";
      delete env(
        service(value.final, "skinharmony-core-staging-issuer"),
        "MCP_STAGING_ISSUER_AUTH_TOKEN",
      ).generateValue;
    },
    (value) => {
      env(
        service(value.final, "skinharmony-core-mcp-staging"),
        "MCP_COLLABORATION_DATABASE_URL",
      ).fromDatabase.name = "skinharmony-db";
    },
    (value) => {
      env(
        service(value.final, "skinharmony-core-staging-issuer"),
        "MCP_STAGING_ISSUER_NONCE_API_TOKEN",
      ).fromService.envVarKey = "MCP_STAGING_NYRA_NONCE_API_TOKEN";
    },
    (value) => {
      value.final.projects[0].environments[0].databases = [
        { name: "skinharmony-mcp-staging-db" },
      ];
    },
  ];
  for (const mutate of mutations) {
    const value = documents();
    mutate(value);
    const report = validateMcpStagingBlueprints(value);
    assert.equal(report.static_policy_ok, false);
    assert.equal(report.deploy_ready, false);
    assert(report.errors.length > 0);
  }
});

test("the CLI exits nonzero with a redacted blocker report", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/validate-render-mcp-staging-blueprints.mjs"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.static_policy_ok, true);
  assert.equal(report.deploy_ready, false);
  assert.equal(report.secrets_exposed, false);
  assert.equal(/postgres(?:ql)?:\/\/[^"\s]+@/i.test(result.stdout), false);
  assert.equal(/(?:srv|dpg|env|prj)-[a-z0-9]+/i.test(result.stdout), false);
});
