import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  boundedPostgresPoolOptions,
  POSTGRES_POOL_TIMEOUT_DEFAULTS,
  postgresPoolTimeoutOptions,
} from "../src/postgresPoolConfig.js";

const SERVICE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = path.resolve(SERVICE_ROOT, "../..");
const HELPER_PATH = "src/postgresPoolConfig.js";
const EXPECTED_HELPER_USERS = [
  "server.js",
  "src/app.js",
  "src/causalContinuityMigration.js",
  "src/causalContinuityStore.js",
  "src/dynamicTaskTreeJoinVerdictStore.js",
  "src/dynamicTaskTreeStateStore.js",
  "src/governedAgentPostgresQueueStore.js",
  "src/projectScopeRenderOriginMigration.js",
  "src/researchAirlockStore.js",
  "src/tenantProviderCredentialStore.js",
  "src/tenantProviderSetupLinkStore.js",
];

function productionJavaScriptFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "test") continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...productionJavaScriptFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(absolute);
  }
  return files;
}

function relativeServicePath(absolute) {
  return path.relative(SERVICE_ROOT, absolute).split(path.sep).join("/");
}

function blueprintService(text, serviceName, nextServiceName = null) {
  const start = text.indexOf(`    name: ${serviceName}`);
  assert.notEqual(start, -1, `${serviceName} missing from Blueprint`);
  const end = nextServiceName ? text.indexOf(`    name: ${nextServiceName}`, start + 1) : -1;
  return text.slice(start, end === -1 ? undefined : end);
}

test("PostgreSQL timeout options use finite defaults and preserve pool sizing", () => {
  assert.deepEqual(postgresPoolTimeoutOptions({}), POSTGRES_POOL_TIMEOUT_DEFAULTS);
  assert.deepEqual(
    boundedPostgresPoolOptions(
      {
        connectionString: "postgres://example.test/core",
        max: 7,
        idleTimeoutMillis: 9_000,
        query_timeout: 0,
      },
      { env: {} },
    ),
    {
      connectionString: "postgres://example.test/core",
      max: 7,
      idleTimeoutMillis: 9_000,
      ...POSTGRES_POOL_TIMEOUT_DEFAULTS,
    },
  );
});

test("PostgreSQL timeout environment values are configurable within safe bounds", () => {
  assert.deepEqual(postgresPoolTimeoutOptions({
    DATABASE_CONNECTION_TIMEOUT_MS: "2500",
    DATABASE_QUERY_TIMEOUT_MS: "9000",
    DATABASE_STATEMENT_TIMEOUT_MS: "8000",
    DATABASE_LOCK_TIMEOUT_MS: "1500",
    DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: "12000",
  }), {
    connectionTimeoutMillis: 2_500,
    query_timeout: 9_000,
    statement_timeout: 8_000,
    lock_timeout: 1_500,
    idle_in_transaction_session_timeout: 12_000,
  });

  assert.deepEqual(postgresPoolTimeoutOptions({
    DATABASE_CONNECTION_TIMEOUT_MS: "1",
    DATABASE_QUERY_TIMEOUT_MS: "9999999",
    DATABASE_STATEMENT_TIMEOUT_MS: "not-a-number",
    DATABASE_LOCK_TIMEOUT_MS: "0",
    DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: "9999999",
  }), {
    connectionTimeoutMillis: 100,
    query_timeout: 120_000,
    statement_timeout: 5_000,
    lock_timeout: 100,
    idle_in_transaction_session_timeout: 300_000,
  });
});

test("every production PostgreSQL pool is constructed by the bounded helper", () => {
  const files = productionJavaScriptFiles(SERVICE_ROOT);
  const helperUsers = [];
  for (const absolute of files) {
    const relative = relativeServicePath(absolute);
    const source = fs.readFileSync(absolute, "utf8");
    if (relative !== HELPER_PATH) {
      assert.doesNotMatch(source, /from\s+["']pg["']/u, `${relative} imports pg directly`);
      assert.doesNotMatch(source, /require\s*\(\s*["']pg["']\s*\)/u, `${relative} requires pg directly`);
      assert.doesNotMatch(source, /new\s+(?:pg\.)?Pool\s*\(/u, `${relative} constructs an unbounded pool`);
    }
    if (source.includes("createBoundedPostgresPool(")) helperUsers.push(relative);
  }

  assert.deepEqual(helperUsers.sort(), [HELPER_PATH, ...EXPECTED_HELPER_USERS].sort());
  const helper = fs.readFileSync(path.join(SERVICE_ROOT, HELPER_PATH), "utf8");
  assert.match(helper, /return new Pool\(boundedPostgresPoolOptions\(options\)\)/u);
});

test("Universal Core production and TWG staging Blueprints pin the bounded defaults", () => {
  const expected = {
    DATABASE_CONNECTION_TIMEOUT_MS: "2000",
    DATABASE_QUERY_TIMEOUT_MS: "5000",
    DATABASE_STATEMENT_TIMEOUT_MS: "5000",
    DATABASE_LOCK_TIMEOUT_MS: "2000",
    DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: "15000",
  };
  const production = blueprintService(
    fs.readFileSync(path.join(REPOSITORY_ROOT, "render-universal-core.yaml"), "utf8"),
    "skinharmony-universal-core",
  );
  const staging = blueprintService(
    fs.readFileSync(path.join(REPOSITORY_ROOT, "render-tenant-work-gallery-staging.yaml"), "utf8"),
    "skinharmony-universal-core-twg-staging",
    "skinharmony-core-mcp-twg-staging",
  );
  for (const [name, value] of Object.entries(expected)) {
    const pattern = new RegExp(`- key: ${name}\\n\\s+value: ["']?${value}["']?`, "u");
    assert.match(production, pattern, `production ${name}`);
    assert.match(staging, pattern, `staging ${name}`);
  }
});
