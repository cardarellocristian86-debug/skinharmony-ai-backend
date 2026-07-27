function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function parseDatabaseUrl(value, requiredCode, invalidCode) {
  const raw = String(value || "").trim();
  if (!raw) fail(requiredCode);
  let parsed;
  try { parsed = new URL(raw); } catch { fail(invalidCode); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.hash || parsed.search) fail(invalidCode);
  return { raw, parsed };
}

function loopbackLiteral(hostname) {
  if (hostname === "::1" || hostname === "[::1]") return true;
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return Boolean(match) && match.slice(1).every((part) => Number(part) <= 255) && Number(match[1]) === 127;
}

function databaseName(parsed) {
  let name;
  try { name = decodeURIComponent(parsed.pathname.replace(/^\//, "")); } catch { fail("collaboration_test_database_url_invalid"); }
  return name;
}

export function loadCollaborationTestDatabaseUrl(env = process.env) {
  const { raw, parsed } = parseDatabaseUrl(
    env?.MCP_COLLABORATION_TEST_DATABASE_URL,
    "collaboration_test_database_url_required",
    "collaboration_test_database_url_invalid",
  );
  const generic = String(env?.DATABASE_URL || "").trim();
  const runtime = String(env?.MCP_COLLABORATION_DATABASE_URL || "").trim();
  const name = databaseName(parsed);
  if (raw === generic || raw === runtime || !loopbackLiteral(parsed.hostname) ||
      !/^[a-zA-Z0-9_-]{1,63}$/.test(name) || !/(^|[_-])test([_-]|$)/i.test(name)) {
    fail("collaboration_test_database_url_invalid");
  }
  return raw;
}

export function loadCollaborationMigrationDatabaseUrl(env = process.env) {
  const { raw } = parseDatabaseUrl(
    env?.MCP_COLLABORATION_MIGRATION_DATABASE_URL,
    "collaboration_migration_database_url_required",
    "collaboration_migration_database_url_invalid",
  );
  if (raw === String(env?.DATABASE_URL || "").trim() ||
      raw === String(env?.MCP_COLLABORATION_DATABASE_URL || "").trim()) {
    fail("collaboration_migration_database_url_invalid");
  }
  return raw;
}
