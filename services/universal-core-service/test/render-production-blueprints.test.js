import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const runtime = require("../../../personal-control-center/lib/nyra-deep-branch-v2.js");
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8");
}

function envValue(blueprint, key) {
  const match = blueprint.match(new RegExp(`- key: ${key}\\n\\s+value: ["']?([^"'\\n]+)["']?`));
  return match?.[1]?.trim() || null;
}

test("production blueprints pause automatic deploys and bound monorepo builds", () => {
  const expectedRustMode = new Map([
    ["render-core-mcp.yaml", "none"],
    ["render-universal-core.yaml", "all"],
    ["render-nyra.yaml", "none"],
    ["render-github-standing-release-worker.yaml", "none"],
  ]);

  for (const [blueprintPath, rustMode] of expectedRustMode) {
    const blueprint = read(blueprintPath);
    assert.match(blueprint, /^    autoDeployTrigger: off$/m, blueprintPath);
    assert.match(blueprint, /^    buildFilter:\n      paths:\n(?:        - .+\n)+      ignoredPaths:\n(?:        - .+\n)+/m, blueprintPath);
    assert.equal(envValue(blueprint, "SKINHARMONY_BUILD_RUST_COMPONENTS"), rustMode, blueprintPath);
  }

  assert.match(read("render-universal-core.yaml"), /^    buildCommand: npm ci$/m);
  for (const blueprintPath of [
    "render-core-mcp.yaml",
    "render-universal-core.yaml",
    "render-github-standing-release-worker.yaml",
  ]) {
    const blueprint = read(blueprintPath);
    assert.match(blueprint, /services\/shared\//, `${blueprintPath} must rebuild for shared runtime changes`);
    assert.doesNotMatch(blueprint, /^        - shared\//m, `${blueprintPath} uses a nonexistent root path`);
  }
});

test("Rust postinstall supports an early non-Rust service exit", () => {
  const script = read("scripts/build-rust-extractor-render.sh");
  const modeGuard = script.indexOf("SKINHARMONY_BUILD_RUST_COMPONENTS:-all");
  const disabledExit = script.indexOf("exit 0");
  const rustup = script.indexOf("command -v rustup");
  const curl = script.indexOf("curl https://sh.rustup.rs");
  assert(modeGuard > 0);
  assert(disabledExit > modeGuard);
  assert(rustup > disabledExit);
  assert(curl > disabledExit);
});

test("Deep V2 stabilization pins the current artifact without widening branch authority", () => {
  const loaded = runtime.loadCatalog({ runtimeMode: "lazy", forceReload: true });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.validation.metrics.branch_count, 24);
  assert.equal(loaded.validation.metrics.subbranch_count, 337);
  const catalogBranches = loaded.catalog.branches.map((branch) => branch.id);
  const expectedAuthorizedBranches = catalogBranches.filter((branchId) =>
    !["agent_change_interlock", "software_cognition"].includes(branchId)).join(",");

  const universal = read("render-universal-core.yaml");
  const nyra = read("render-nyra.yaml");
  assert.equal(envValue(universal, "CORE_NYRA_DEEP_BRANCH_V2_ENABLED"), "false");
  assert.equal(envValue(universal, "CORE_NYRA_DEEP_BRANCH_V2_MODE"), "shadow");
  assert.equal(envValue(universal, "CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_MODE"), "shadow");
  assert.equal(envValue(universal, "CORE_NYRA_DEEP_BRANCH_V2_TIMEOUT_MS"), "750");
  assert.equal(envValue(universal, "CORE_NYRA_DEEP_BRANCH_V2_CIRCUIT_FAILURE_THRESHOLD"), "1");
  assert.equal(envValue(universal, "CORE_NYRA_DEEP_BRANCH_V2_BRANCHES"), expectedAuthorizedBranches);
  assert.equal(envValue(nyra, "NYRA_DEEP_BRANCH_V2_MODE"), "shadow");
  assert.equal(envValue(nyra, "NYRA_DEEP_BRANCH_V2_BRANCHES"), expectedAuthorizedBranches);
  assert.equal(
    envValue(universal, "CORE_NYRA_DEEP_BRANCH_V2_EXPECTED_CATALOG_FINGERPRINT"),
    loaded.catalog.catalog_fingerprint,
  );
  assert.equal(
    envValue(universal, "CORE_NYRA_DEEP_BRANCH_V2_EXPECTED_ROOT_BINDING_HASH"),
    loaded.manifest.root_binding_hash,
  );
});

test("Core MCP production blueprint enables bounded nonblocking deadlines", () => {
  const blueprint = read("render-core-mcp.yaml");
  const expected = {
    NYRA_FAST_READ_PATH_ENABLED: "true",
    UNIVERSAL_CORE_REQUEST_TIMEOUT_MS: "8000",
    UNIVERSAL_CORE_LONG_REQUEST_TIMEOUT_MS: "30000",
    UNIVERSAL_CORE_RESPONSE_LIMIT_BYTES: "524288",
    DATABASE_CONNECTION_TIMEOUT_MS: "2000",
    DATABASE_QUERY_TIMEOUT_MS: "5000",
    DATABASE_STATEMENT_TIMEOUT_MS: "5000",
    DATABASE_LOCK_TIMEOUT_MS: "2000",
    DATABASE_MIGRATION_STATEMENT_TIMEOUT_MS: "30000",
    DATABASE_MIGRATION_LOCK_TIMEOUT_MS: "5000",
    DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: "15000",
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(envValue(blueprint, key), value, key);
  }
  assert(Number(envValue(blueprint, "DATABASE_STATEMENT_TIMEOUT_MS")) <
    Number(envValue(blueprint, "DATABASE_MIGRATION_STATEMENT_TIMEOUT_MS")));
  assert.match(read("services/skinharmony-core-mcp/src/core-handlers.js"),
    /core_request_outcome_unknown/u,
    "a dispatched mutation timeout must require reconciliation instead of replay");
});
