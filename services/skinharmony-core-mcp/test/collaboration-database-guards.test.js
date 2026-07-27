import assert from "node:assert/strict";
import test from "node:test";
import {
  loadCollaborationMigrationDatabaseUrl,
  loadCollaborationTestDatabaseUrl,
} from "../src/collaboration-database-guards.js";

test("test database guard accepts only an explicit loopback database marked test", () => {
  assert.equal(
    loadCollaborationTestDatabaseUrl({
      MCP_COLLABORATION_TEST_DATABASE_URL: "postgresql://tester:opaque@127.0.0.1:5432/mcp_collaboration_test",
    }),
    "postgresql://tester:opaque@127.0.0.1:5432/mcp_collaboration_test",
  );
  assert.equal(
    loadCollaborationTestDatabaseUrl({
      MCP_COLLABORATION_TEST_DATABASE_URL: "postgres://[::1]:5432/test_mcp",
    }),
    "postgres://[::1]:5432/test_mcp",
  );
});

test("test database guard never falls back or accepts DNS, query overrides, or runtime databases", () => {
  assert.throws(() => loadCollaborationTestDatabaseUrl({
    DATABASE_URL: "postgresql://127.0.0.1/service_test",
  }), /collaboration_test_database_url_required/);
  for (const value of [
    "postgresql://localhost/mcp_test",
    "postgresql://db.internal/mcp_test",
    "postgresql://127.0.0.1/production",
    "postgresql://127.0.0.1/mcp_test?host=remote",
    "postgresql://127.0.0.1/mcp_test#fragment",
  ]) {
    assert.throws(() => loadCollaborationTestDatabaseUrl({
      MCP_COLLABORATION_TEST_DATABASE_URL: value,
    }), /collaboration_test_database_url_invalid/);
  }
  const shared = "postgresql://127.0.0.1/mcp_test";
  assert.throws(() => loadCollaborationTestDatabaseUrl({
    MCP_COLLABORATION_TEST_DATABASE_URL: shared,
    MCP_COLLABORATION_DATABASE_URL: shared,
  }), /collaboration_test_database_url_invalid/);
});

test("migration database guard requires a separate explicit control-plane reference", () => {
  const migration = "postgresql://control@private-db:5432/staging";
  assert.equal(loadCollaborationMigrationDatabaseUrl({
    MCP_COLLABORATION_MIGRATION_DATABASE_URL: migration,
  }), migration);
  assert.throws(() => loadCollaborationMigrationDatabaseUrl({}), /collaboration_migration_database_url_required/);
  assert.throws(() => loadCollaborationMigrationDatabaseUrl({
    MCP_COLLABORATION_MIGRATION_DATABASE_URL: migration,
    MCP_COLLABORATION_DATABASE_URL: migration,
  }), /collaboration_migration_database_url_invalid/);
});
