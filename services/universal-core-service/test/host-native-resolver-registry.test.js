import assert from "node:assert/strict";
import test from "node:test";

import {
  HOST_NATIVE_GITHUB_WORKFLOW,
  loadHostNativeResolverRegistryFromEnvironment,
} from "../src/hostNativeResolverRegistry.js";

const TOKEN = `github_pat_${"A".repeat(40)}`;

test("workflow rotation binds the current main and reconstructed v3 candidate", () => {
  assert.equal(HOST_NATIVE_GITHUB_WORKFLOW.sha256, "139bf3efeeda714cfa6c295bcbef4dcd3db278bf33a946b50b8d08a2ebec8bc6");
  assert.equal(HOST_NATIVE_GITHUB_WORKFLOW.candidate_sha256, "4247a8711b7cc2ec12304d141dde51477ee5c8ba5e359a4cffdf5a3ffa1c1b49");
});
const GITHUB_REGISTRY = JSON.stringify({
  schema_version: "host_native_github_credential_registry_v1",
  bindings: [{
    tenant_id: "codexai",
    repository: "owner/repo",
    token_env: "CORE_HOST_NATIVE_GITHUB_TOKEN_CODEXAI_OWNER_REPO",
  }],
});
const RENDER_REGISTRY = JSON.stringify({
  schema_version: "host_native_render_origin_registry_v1",
  bindings: [{
    tenant_id: "codexai",
    repository: "owner/repo",
    service_id: "srv-core",
    environment: "production",
    origin: "https://mapped-core.onrender.com",
  }],
});
const REQUIRED_CHECKS_BINDING = {
  tenant_id: "codexai",
  repository: "cardarellocristian86-debug/skinharmony-ai-backend",
  base_branch: "main",
  required_checks: ["universal-core", "core-mcp", "deployment-parity"],
  check_app: { id: 15368, slug: "github-actions", owner: "github" },
  workflow: {
    id: 312527659,
    name: "Nyra Core Intelligence",
    path: ".github/workflows/nyra-core-intelligence.yml",
    sha256: "7".repeat(64),
  },
  allowed_events: ["push", "pull_request"],
};
const REQUIRED_CHECKS_REGISTRY = JSON.stringify({
  schema_version: "host_native_required_checks_registry_v1",
  bindings: [
    REQUIRED_CHECKS_BINDING,
    {
      tenant_id: "tenant-b",
      repository: "other/product",
      base_branch: "release",
      required_checks: ["product-contract", "product-unit"],
      check_app: { id: 9001, slug: "product-actions", owner: "other" },
      workflow: {
        id: 987654,
        name: "Product Release",
        path: ".github/workflows/product-release.yaml",
        sha256: "8".repeat(64),
      },
      allowed_events: ["push"],
    },
  ],
});

test("empty resolver registry keeps public/default mode without inventing credentials", () => {
  const registry = loadHostNativeResolverRegistryFromEnvironment({});
  assert.equal(registry.configuration_valid, true);
  assert.equal(registry.github.state, "not_configured");
  assert.equal(registry.github.resolver, null);
  assert.equal(registry.render.state, "project_scope_fallback_required");
  assert.equal(registry.render.resolver, null);
  assert.equal(registry.required_checks.state, "not_configured");
  assert.equal(registry.required_checks.resolver, null);
});

test("required-check policies are isolated exact tenant/repository/base bindings", async () => {
  const environment = {
    CORE_HOST_NATIVE_REQUIRED_CHECKS_REGISTRY_JSON: REQUIRED_CHECKS_REGISTRY,
  };
  const first = loadHostNativeResolverRegistryFromEnvironment(environment);
  const afterRestart = loadHostNativeResolverRegistryFromEnvironment(environment);
  assert.equal(first.required_checks.state, "exact_registry_ready");
  assert.equal(first.required_checks.binding_count, 2);
  const codexai = await first.required_checks.resolver({
    tenant_id: "codexai",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
    base_branch: "main",
  });
  const other = await first.required_checks.resolver({
    tenant_id: "tenant-b",
    repository: "other/product",
    base_branch: "release",
  });
  const restarted = await afterRestart.required_checks.resolver({
    tenant_id: "codexai",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
    base_branch: "main",
  });
  assert.deepEqual(codexai.required_checks, [
    "core-mcp",
    "deployment-parity",
    "universal-core",
  ]);
  assert.deepEqual(codexai.check_app, {
    id: 15368,
    slug: "github-actions",
    owner: "github",
  });
  assert.deepEqual(codexai.workflow, {
    id: 312527659,
    name: "Nyra Core Intelligence",
    path: ".github/workflows/nyra-core-intelligence.yml",
    sha256: "7".repeat(64),
    candidate_sha256: null,
  });
  assert.deepEqual(other.required_checks, ["product-contract", "product-unit"]);
  assert.equal(other.workflow.id, 987654);
  assert.deepEqual(restarted, codexai);
  await assert.rejects(first.required_checks.resolver({
    tenant_id: "tenant-b",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
    base_branch: "main",
  }), /policy_not_bound/);
  await assert.rejects(first.required_checks.resolver({
    tenant_id: "codexai",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
    base_branch: "release",
  }), /policy_not_bound/);
});

test("required-check registry rejects invalid shape, duplicate binding, and unsafe workflow", () => {
  assert.throws(
    () => loadHostNativeResolverRegistryFromEnvironment({
      CORE_HOST_NATIVE_REQUIRED_CHECKS_REGISTRY_JSON: JSON.stringify({
        schema_version: "host_native_required_checks_registry_v1",
        bindings: [{
          ...REQUIRED_CHECKS_BINDING,
          required_checks: ["core-mcp"],
          caller_token: "forbidden",
        }],
      }),
    }),
    /unknown_field/,
  );
  assert.throws(
    () => loadHostNativeResolverRegistryFromEnvironment({
      CORE_HOST_NATIVE_REQUIRED_CHECKS_REGISTRY_JSON: JSON.stringify({
        schema_version: "host_native_required_checks_registry_v1",
        bindings: [REQUIRED_CHECKS_BINDING, REQUIRED_CHECKS_BINDING],
      }),
    }),
    /binding_duplicate/,
  );
  assert.throws(
    () => loadHostNativeResolverRegistryFromEnvironment({
      CORE_HOST_NATIVE_REQUIRED_CHECKS_REGISTRY_JSON: JSON.stringify({
        schema_version: "host_native_required_checks_registry_v1",
        bindings: [{
          ...REQUIRED_CHECKS_BINDING,
          workflow: {
            ...REQUIRED_CHECKS_BINDING.workflow,
            path: ".github/workflows/../spoof.yml",
          },
        }],
      }),
    }),
    /workflow_path_invalid/,
  );
});

test("GitHub credential registry resolves only an exact tenant/repository secret reference", async () => {
  const environment = {
    CORE_HOST_NATIVE_GITHUB_CREDENTIAL_REGISTRY_JSON: GITHUB_REGISTRY,
    CORE_HOST_NATIVE_GITHUB_TOKEN_CODEXAI_OWNER_REPO: TOKEN,
  };
  const registry = loadHostNativeResolverRegistryFromEnvironment(environment);
  assert.equal(registry.github.state, "exact_registry_ready");
  assert.equal(registry.github.binding_count, 1);
  assert.equal(await registry.github.resolver({
    tenant_id: "codexai",
    repository: "owner/repo",
  }), TOKEN);
  await assert.rejects(registry.github.resolver({
    tenant_id: "other",
    repository: "owner/repo",
  }), /credential_not_bound/);
  await assert.rejects(registry.github.resolver({
    tenant_id: "codexai",
    repository: "owner/other",
  }), /credential_not_bound/);
  assert.equal(JSON.stringify(registry).includes(TOKEN), false);
  assert.equal(GITHUB_REGISTRY.includes(TOKEN), false);
});

test("GitHub registry fails closed on missing secret, unsafe reference, or duplicate binding", () => {
  assert.throws(
    () => loadHostNativeResolverRegistryFromEnvironment({
      CORE_HOST_NATIVE_GITHUB_CREDENTIAL_REGISTRY_JSON: GITHUB_REGISTRY,
    }),
    /credential_unavailable/,
  );
  assert.throws(
    () => loadHostNativeResolverRegistryFromEnvironment({
      CORE_HOST_NATIVE_GITHUB_CREDENTIAL_REGISTRY_JSON: JSON.stringify({
        schema_version: "host_native_github_credential_registry_v1",
        bindings: [{
          tenant_id: "codexai",
          repository: "owner/repo",
          token_env: "GITHUB_TOKEN",
        }],
      }),
      GITHUB_TOKEN: TOKEN,
    }),
    /token_reference_invalid/,
  );
  const binding = JSON.parse(GITHUB_REGISTRY).bindings[0];
  assert.throws(
    () => loadHostNativeResolverRegistryFromEnvironment({
      CORE_HOST_NATIVE_GITHUB_CREDENTIAL_REGISTRY_JSON: JSON.stringify({
        schema_version: "host_native_github_credential_registry_v1",
        bindings: [binding, binding],
      }),
      CORE_HOST_NATIVE_GITHUB_TOKEN_CODEXAI_OWNER_REPO: TOKEN,
    }),
    /binding_duplicate/,
  );
});

test("Render registry resolves one exact service origin and rejects unbound or hostile origins", async () => {
  const registry = loadHostNativeResolverRegistryFromEnvironment({
    CORE_HOST_NATIVE_RENDER_ORIGIN_REGISTRY_JSON: RENDER_REGISTRY,
  });
  assert.equal(registry.render.state, "exact_registry_ready");
  assert.equal(await registry.render.resolver({
    tenant_id: "codexai",
    repository: "owner/repo",
    service_id: "srv-core",
    environment: "production",
  }), "https://mapped-core.onrender.com");
  await assert.rejects(registry.render.resolver({
    tenant_id: "codexai",
    repository: "owner/repo",
    service_id: "srv-other",
    environment: "production",
  }), /origin_not_bound/);
  assert.throws(
    () => loadHostNativeResolverRegistryFromEnvironment({
      CORE_HOST_NATIVE_RENDER_ORIGIN_REGISTRY_JSON: JSON.stringify({
        schema_version: "host_native_render_origin_registry_v1",
        bindings: [{
          tenant_id: "codexai",
          repository: "owner/repo",
          service_id: "srv-core",
          environment: "production",
          origin: "https://attacker.example.com",
        }],
      }),
    }),
    /origin_invalid/,
  );
  assert.throws(
    () => loadHostNativeResolverRegistryFromEnvironment({
      CORE_HOST_NATIVE_RENDER_ORIGIN_REGISTRY_JSON: JSON.stringify({
        schema_version: "host_native_render_origin_registry_v1",
        bindings: [{
          tenant_id: "codexai",
          repository: "owner/repo",
          service_id: "srv-core",
          environment: "production",
          origin: "https://mapped-core.onrender.com:443",
        }],
      }),
    }),
    /origin_invalid/,
  );
});
