import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createPostgresBootstrapAuthorityStore } from "../src/bootstrapAuthorityPostgresStore.js";

const D = (value) => crypto.createHash("sha256").update(value).digest("hex");
const DB_NOW = new Date("2026-08-10T10:00:00.000Z");
const POSTGRES_TEST_URL = process.env.BOOTSTRAP_AUTHORITY_TEST_DATABASE_URL || "";
const SERVICE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function registryColumns() { return [{ column_name: "migration_id", data_type: "character varying", character_maximum_length: 160, is_nullable: "NO", column_default: null }, { column_name: "applied_at", data_type: "timestamp with time zone", character_maximum_length: null, is_nullable: "NO", column_default: "now()" }, { column_name: "sql_digest", data_type: "character", character_maximum_length: 64, is_nullable: "YES", column_default: null }, { column_name: "application_state", data_type: "text", character_maximum_length: null, is_nullable: "YES", column_default: null }, { column_name: "checkpoint", data_type: "text", character_maximum_length: null, is_nullable: "YES", column_default: null }, { column_name: "started_at", data_type: "timestamp with time zone", character_maximum_length: null, is_nullable: "NO", column_default: "clock_timestamp()" }, { column_name: "completed_at", data_type: "timestamp with time zone", character_maximum_length: null, is_nullable: "YES", column_default: null }, { column_name: "verifier_evidence", data_type: "jsonb", character_maximum_length: null, is_nullable: "NO", column_default: "'{}'::jsonb" }]; }
function poolWith(handler, convergence = {}) {
  const calls = [];
  const converged = {
    missing_columns: [], missing_indexes: [], missing_triggers: [], missing_constraints: [],
    attestation_columns_converged: true, active_key_index_converged: true,
    column_semantics_converged: true, check_constraints_converged: true,
    legacy_state_constraint_converged: true, foreign_keys_converged: true,
    trigger_definitions_converged: true, ...convergence,
  };
  const normalize = (sql, params) => sql && typeof sql === "object"
    ? { sql: sql.text, params: sql.values || [] }
    : { sql, params };
  const client = {
    async query(sql, params = []) {
      ({ sql, params } = normalize(sql, params));
      calls.push({ sql, params });
      if (String(sql).includes("FROM information_schema.columns") &&
          String(sql).includes("core_schema_migrations")) return { rows: registryColumns() };
      if (String(sql).includes("FROM pg_constraint constraint_row")) {
        return { rows: [{ column_name: "migration_id" }] };
      }
      return handler(String(sql).replace(/\s+/g, " ").trim(), params, calls);
    },
    release() { calls.push({ sql: "RELEASE", params: [] }); },
  };
  return {
    calls,
    pool: {
      async query(sql, params = []) {
        ({ sql, params } = normalize(sql, params));
        calls.push({ sql, params, migration: true });
        if (String(sql).includes("required_columns(table_name,column_name)")) {
          return { rowCount: 1, rows: [converged] };
        }
        return { rowCount: 0, rows: [] };
      },
      async connect() { return client; },
    },
  };
}
function receipt(tenant = "tenant-a") { return { schema_version: "bootstrap_release_exception_v1", allowed_action: "github.merge", authority_assertion: {}, authority_key_id: "local-pin-key-001", authority_provider: "local_pin", consumed_at: null, core_policy_classification: "BOOTSTRAP_DEADLOCK_VERIFIED", core_policy_verdict_digest: D("policy"), exception_id: "exception-001", expires_at: "2026-08-10T10:10:00.000Z", head_sha: "a".repeat(40), issued_at: "2026-08-10T09:59:00.000Z", max_uses: 1, nonce: "nonce-001", owner_confirmation_digest: D("owner"), post_deploy_obligations_digest: D("post"), pr_number: 223, repository: "owner/repo", required_checks_digest: D("checks"), required_checks_results_digest: D("results"), revoked_at: null, rollback_obligations_digest: D("rollback"), tenant_id: tenant, work_id: "work-001" }; }
function candidate(value) { const receipt_digest = D(JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))))); return { verification_status: "verified_non_authorizing_candidate", candidate: true, action_authorized: false, execution_authorized: false, host_action_authorized: false, core_join_authorized: false, consumption_authorized: false, receipt_digest, tenant_id: value.tenant_id, exception_id: value.exception_id, work_id: value.work_id, repository: value.repository, pr_number: value.pr_number, head_sha: value.head_sha, allowed_action: value.allowed_action, authority_provider: value.authority_provider, authority_key_id: value.authority_key_id }; }
function consumeArgs(value = receipt()) { return { tenant_id: value.tenant_id, exception_id: value.exception_id, work_id: value.work_id, repository: value.repository, pr_number: value.pr_number, head_sha: value.head_sha, allowed_action: value.allowed_action, authority_key_id: value.authority_key_id, required_checks_digest: value.required_checks_digest, required_checks_results_digest: value.required_checks_results_digest, owner_confirmation_digest: value.owner_confirmation_digest, core_policy_verdict_digest: value.core_policy_verdict_digest, rollback_obligations_digest: value.rollback_obligations_digest, post_deploy_obligations_digest: value.post_deploy_obligations_digest, receipt_digest: D("receipt"), action_request_digest: D("action"), consumed_by: "core-release-gate", target: { repository: value.repository, pr_number: value.pr_number, head_sha: value.head_sha, allowed_action: value.allowed_action } }; }

test("migration is additive, immutable, and supports one un-attested local P1363 key", async () => { const state = poolWith(() => ({ rowCount: 0, rows: [] })); const store = createPostgresBootstrapAuthorityStore({ pool: state.pool }); const ready = await store.initialize(); const migrationIndex = state.calls.findIndex((entry) => String(entry.sql).includes("core_bootstrap_trust_keys")); const registryIndex = state.calls.findIndex((entry) => String(entry.sql).includes("FROM information_schema.columns") && String(entry.sql).includes("core_schema_migrations")); const sql = state.calls[migrationIndex].sql; const convergence = state.calls.find((entry) => String(entry.sql).includes("required_columns(table_name,column_name)")).sql; assert.ok(registryIndex >= 0 && registryIndex < migrationIndex, "shared migration registry is reconciled before Bootstrap markers"); assert.match(sql, /local_pin/); assert.match(sql, /ECDSA_P256_SHA256_P1363/); assert.match(sql, /UNATTESTED_LOCAL_SOFTWARE/); assert.match(sql, /core_bootstrap_one_active_key_per_tenant_idx/); assert.match(sql, /WHERE status = 'ACTIVE'/); assert.match(convergence, /i\.indnkeyatts=1 AND i\.indnatts=1/); assert.match(convergence, /a\.attname='tenant_id'/); assert.match(convergence, /= 'status=''ACTIVE'''/); assert.equal(ready.automatic_trust_installation, false); assert.equal(state.calls.some((entry) => String(entry.sql).startsWith("INSERT INTO core_bootstrap_trust_keys")), false); assert.doesNotMatch(sql, /private_key/i); });

test("migration preserves populated legacy local-pin digest and backfills it as retired legacy-unattested", async () => {
  const state = poolWith(() => ({ rowCount: 0, rows: [] }));
  await createPostgresBootstrapAuthorityStore({ pool: state.pool }).initialize();
  const sql = state.calls.find((entry) => String(entry.sql).includes("core_bootstrap_trust_keys")).sql;
  const legacyRow = { authority_provider: "local_pin", provider_attestation_digest: D("historic-attestation"), attestation_status: null, legacy_local_pin: null };
  assert.equal(legacyRow.provider_attestation_digest, D("historic-attestation"));
  assert.match(sql, /ADD COLUMN IF NOT EXISTS legacy_local_pin boolean/);
  assert.match(sql, /SET legacy_local_pin = \(authority_provider = 'local_pin' AND provider_attestation_digest IS NOT NULL\)/);
  assert.match(sql, /WHEN authority_provider = 'local_pin' THEN 'UNATTESTED_LOCAL_SOFTWARE'/);
  assert.match(sql, /CASE WHEN legacy_local_pin THEN 'RETIRED' ELSE 'ACTIVE' END/);
  assert.match(sql, /legacy_unattested = false OR status IN \('RETIRED','REVOKED'\)/);
  assert.match(sql, /core_bootstrap_legacy_unattested_activation_denied/);
  assert.doesNotMatch(sql, /SET provider_attestation_digest = NULL/);
});

test("schema repair is additive, restart-safe, and validates stable constraints", async () => {
  const state = poolWith(() => ({ rowCount: 0, rows: [] }));
  await createPostgresBootstrapAuthorityStore({ pool: state.pool }).initialize();
  const sql = state.calls.find((entry) => String(entry.sql).includes("core_bootstrap_trust_keys")).sql;
  const repair = sql.slice(sql.indexOf("-- Bootstrap Authority schema convergence repair"));
  assert.match(sql, /20260811_bootstrap_authority_schema_convergence_repair_v1/);
  for (const name of [
    "core_bootstrap_local_attestation_v2_ck",
    "core_bootstrap_receipt_single_use_v2_ck",
    "core_bootstrap_trust_state_legacy_v2_ck",
    "core_bootstrap_state_key_v2_fk",
    "core_bootstrap_consumption_receipt_v2_fk",
    "core_bootstrap_outbox_consumption_v2_fk",
  ]) {
    assert.match(sql, new RegExp(`ADD CONSTRAINT ${name}`));
    assert.match(sql, new RegExp(`VALIDATE CONSTRAINT ${name}`));
  }
  assert.match(repair, /NOT VALID/);
  assert.match(repair, /pg_advisory_xact_lock/);
  assert.doesNotMatch(repair, /DROP CONSTRAINT/);
  assert.doesNotMatch(repair, /DELETE FROM core_schema_migrations/);
});

test("initialize rejects a partially converged schema", async () => { const state = poolWith(() => ({ rowCount: 0, rows: [] }), { missing_indexes: ["core_bootstrap_one_active_key_per_tenant_idx"] }); const store = createPostgresBootstrapAuthorityStore({ pool: state.pool }); await assert.rejects(() => store.initialize(), /schema_not_converged/); });

test("initialize rejects semantic index, column, constraint, FK, and trigger drift", async () => {
  for (const field of ["active_key_index_converged", "column_semantics_converged", "check_constraints_converged", "legacy_state_constraint_converged", "foreign_keys_converged", "trigger_definitions_converged"]) {
    const state = poolWith(() => ({ rowCount: 0, rows: [] }), { [field]: false });
    await assert.rejects(() => createPostgresBootstrapAuthorityStore({ pool: state.pool }).initialize(), /schema_not_converged/);
    const query = state.calls.find((entry) => String(entry.sql).includes("required_columns(table_name,column_name)")).sql;
    assert.match(query, /pg_get_constraintdef/);
    assert.match(query, /t\.tgtype=27/);
    assert.match(query, /t\.tgtype=19/);
    assert.match(query, /p\.proname='core_bootstrap_forbid_mutation'/);
    assert.match(query, /c\.convalidated/);
    assert.match(query, /unnest\(c\.conkey\) WITH ORDINALITY/);
    assert.match(query, /unnest\(c\.confkey\) WITH ORDINALITY/);
    assert.match(query, /NOT c\.condeferrable/);
    assert.match(query, /c\.confupdtype='a' AND c\.confdeltype='a'/);
    assert.match(query, /core_bootstrap_release_consumptions/);
    assert.match(query, /core_bootstrap_one_active_key_per_tenant_idx/);
  }
});

test("convergence pins ordinary triggers, exact function bodies, tables, and CHECK digests", async () => {
  const state = poolWith(() => ({ rowCount: 0, rows: [] }));
  await createPostgresBootstrapAuthorityStore({ pool: state.pool }).initialize();
  const query = state.calls.find((entry) => String(entry.sql).includes("required_columns(table_name,column_name)")).sql;
  assert.match(query, /t\.tgenabled='O'/);
  assert.doesNotMatch(query, /t\.tgenabled<>'D'/);
  for (const [table, trigger] of [
    ["core_bootstrap_trust_keys", "core_bootstrap_trust_keys_no_mutation"],
    ["core_bootstrap_release_receipts", "core_bootstrap_receipts_no_mutation"],
    ["core_bootstrap_release_revocations", "core_bootstrap_revocations_no_mutation"],
    ["core_bootstrap_release_consumptions", "core_bootstrap_consumptions_no_mutation"],
    ["core_bootstrap_events", "core_bootstrap_events_no_mutation"],
    ["core_bootstrap_trust_key_state", "core_bootstrap_trust_state_guard"],
    ["core_bootstrap_trust_key_state", "core_bootstrap_trust_state_no_delete"],
    ["core_bootstrap_action_outbox", "core_bootstrap_outbox_no_delete"],
  ]) {
    assert.match(query, new RegExp(`\\('${table}','${trigger}'\\)`));
    assert.match(query, new RegExp(`c\\.relname='${table}' AND t\\.tgname='${trigger}'`));
  }
  assert.match(query, /t\.tgtype=27/);
  assert.match(query, /t\.tgtype=19/);
  assert.match(query, /t\.tgtype=11/);
  assert.match(query, /p\.prokind='f'/);
  assert.match(query, /l\.lanname='plpgsql'/);
  assert.match(query, /NOT p\.prosecdef/);
  assert.match(query, /p\.prorettype='trigger'::regtype/);
  assert.match(query, /encode\(sha256\(convert_to\(p\.prosrc,'UTF8'\)\),'hex'\)='f480f069070eb7422ac7fedec4a3546772b75ab65b4e0e81c38d0f7a2c01af37'/);
  assert.match(query, /encode\(sha256\(convert_to\(p\.prosrc,'UTF8'\)\),'hex'\)='1cbc99f0f8c6a49b96a03a3e9bc042940c7e43d02a8250bebc974fd0294629ed'/);
  for (const digest of [
    "9b5a206e99449d04c295e478119785891896752e24594c60efb406465be776a8",
    "a62982bfc760aa45156382981e4a968a47d2986d7e843399a98ff8be1a08d687",
    "2fbe0796d982b5c4c1177a10a67be54f287266ff453a59d0eb823e10c38fc2c0",
  ]) assert.match(query, new RegExp(digest));
  assert.doesNotMatch(query, /pg_get_constraintdef\(c\.oid\).*LIKE/);
});

test("PostgreSQL readback rejects trigger modes, body tamper, decoys, and permissive CHECKs", {
  skip: !POSTGRES_TEST_URL,
}, () => {
  const target = new URL(POSTGRES_TEST_URL);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(target.hostname), "test database must be loopback-only");
  const schema = `bootstrap_authority_verify_${process.pid}_${crypto.randomBytes(4).toString("hex")}`;
  const env = { ...process.env, PGOPTIONS: `-c search_path=${schema} -c client_min_messages=warning` };
  const run = (sql) => execFileSync("psql", ["-X", "--dbname", POSTGRES_TEST_URL, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], { encoding: "utf8", env });
  const apply = (file) => execFileSync("psql", ["-X", "--dbname", POSTGRES_TEST_URL, "-v", "ON_ERROR_STOP=1", "-f", path.join(SERVICE_ROOT, "migrations", file)], { encoding: "utf8", env });
  const source = fs.readFileSync(path.join(SERVICE_ROOT, "src", "bootstrapAuthorityPostgresStore.js"), "utf8");
  const marker = "const SCHEMA_CONVERGENCE_SQL = `";
  const start = source.indexOf(marker) + marker.length;
  const convergenceSql = source.slice(start, source.indexOf("`;", start));
  const read = () => JSON.parse(run(`SELECT row_to_json(convergence) FROM (${convergenceSql}) convergence`).trim());
  const restoreHistorical = () => {
    apply("20260810_bootstrap_authority_registry.sql");
    apply("20260811_bootstrap_authority_schema_convergence_repair.sql");
  };
  execFileSync("psql", ["-X", "--dbname", POSTGRES_TEST_URL, "-v", "ON_ERROR_STOP=1", "-c", `CREATE SCHEMA ${schema}`], { encoding: "utf8" });
  try {
    restoreHistorical();
    assert.equal(read().trigger_definitions_converged, true);
    for (const mode of ["REPLICA", "ALWAYS", "DISABLE"]) {
      run(`ALTER TABLE core_bootstrap_events ${mode === "DISABLE" ? "DISABLE" : `ENABLE ${mode}`} TRIGGER core_bootstrap_events_no_mutation`);
      assert.equal(read().trigger_definitions_converged, false, mode);
      run("ALTER TABLE core_bootstrap_events ENABLE TRIGGER core_bootstrap_events_no_mutation");
    }

    run("CREATE OR REPLACE FUNCTION core_bootstrap_forbid_mutation() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql");
    assert.equal(read().trigger_definitions_converged, false, "forbid function body");
    restoreHistorical();
    run("CREATE OR REPLACE FUNCTION core_bootstrap_trust_state_transition() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql");
    assert.equal(read().trigger_definitions_converged, false, "transition function body");
    restoreHistorical();

    run("CREATE TABLE core_bootstrap_events_decoy (id integer); DROP TRIGGER core_bootstrap_events_no_mutation ON core_bootstrap_events; CREATE TRIGGER core_bootstrap_events_no_mutation BEFORE UPDATE OR DELETE ON core_bootstrap_events_decoy FOR EACH ROW EXECUTE FUNCTION core_bootstrap_forbid_mutation()");
    const decoy = read();
    assert.deepEqual(decoy.missing_triggers, ["core_bootstrap_events_no_mutation"]);
    assert.equal(decoy.trigger_definitions_converged, false);
    restoreHistorical();

    run("ALTER TABLE core_bootstrap_trust_keys DROP CONSTRAINT core_bootstrap_local_attestation_v2_ck; ALTER TABLE core_bootstrap_trust_keys ADD CONSTRAINT core_bootstrap_local_attestation_v2_ck CHECK (true OR authority_provider = 'local_pin')");
    assert.equal(read().check_constraints_converged, false, "permissive OR");
    run("ALTER TABLE core_bootstrap_trust_keys DROP CONSTRAINT core_bootstrap_local_attestation_v2_ck");
    apply("20260811_bootstrap_authority_schema_convergence_repair.sql");

    run("ALTER TABLE core_bootstrap_release_receipts DROP CONSTRAINT core_bootstrap_receipt_single_use_v2_ck; ALTER TABLE core_bootstrap_release_receipts ADD CONSTRAINT core_bootstrap_receipt_single_use_v2_ck CHECK (max_uses = 1)");
    assert.equal(read().check_constraints_converged, false, "AND loss");
  } finally {
    execFileSync("psql", ["-X", "--dbname", POSTGRES_TEST_URL, "-v", "ON_ERROR_STOP=1", "-c", `DROP SCHEMA ${schema} CASCADE`], { encoding: "utf8" });
  }
});

test("offline trust installation labels local software as un-attested", async () => { const state = poolWith((sql) => { if (sql.startsWith("SELECT k.*,s.status")) return { rowCount: 0, rows: [] }; if (sql.startsWith("SELECT transaction_timestamp")) return { rowCount: 1, rows: [{ database_now: DB_NOW }] }; if (sql.startsWith("INSERT INTO core_bootstrap_trust_keys")) return { rowCount: 1, rows: [{ tenant_id: "tenant-a", authority_key_id: "local-pin-key-001", attestation_status: "UNATTESTED_LOCAL_SOFTWARE" }] }; if (sql.startsWith("SELECT sequence_number")) return { rowCount: 0, rows: [] }; return { rowCount: 1, rows: [] }; }); const store = createPostgresBootstrapAuthorityStore({ pool: state.pool }); await store.installTrustKey({ tenant_id: "tenant-a", authority_key_id: "local-pin-key-001", authority_provider: "local_pin", algorithm: "ECDSA_P256_SHA256_P1363", attestation_status: "UNATTESTED_LOCAL_SOFTWARE", public_key_spki_der: Buffer.alloc(91, 1), public_key_sha256: D("public"), trust_bundle_digest: D("bundle"), provider_attestation_digest: null, genesis_record_digest: D("genesis"), genesis_record: { ceremony: "external_local_pin" } }); const insert = state.calls.find((entry) => entry.sql.startsWith("INSERT INTO core_bootstrap_trust_keys")); assert.ok(insert.params.includes("UNATTESTED_LOCAL_SOFTWARE")); assert.ok(insert.params.includes(null)); });

test("private material is rejected before database mutation", async () => { const state = poolWith(() => ({ rowCount: 0, rows: [] })); const store = createPostgresBootstrapAuthorityStore({ pool: state.pool }); await assert.rejects(() => store.installTrustKey({ tenant_id: "tenant-a", authority_key_id: "local-pin-key-001", private_key: "forbidden" }), /private_material_forbidden/); assert.equal(state.calls.filter((entry) => !entry.migration).length, 0); });

test("consume serializes, uses database time, writes consumption outbox and hash-chain before commit", async () => { const previousHash = D("previous"); const state = poolWith((sql) => { if (sql.startsWith("SELECT c.*,to_jsonb")) return { rowCount: 0, rows: [] }; if (sql.startsWith("SELECT r.receipt_digest")) return { rowCount: 1, rows: [{ receipt_digest: D("receipt") }] }; if (sql.startsWith("SELECT transaction_timestamp")) return { rowCount: 1, rows: [{ database_now: DB_NOW }] }; if (sql.startsWith("INSERT INTO core_bootstrap_release_consumptions")) return { rowCount: 1, rows: [{ consumption_id: "generated", consumed_at: DB_NOW }] }; if (sql.startsWith("INSERT INTO core_bootstrap_action_outbox")) return { rowCount: 1, rows: [{ status: "PENDING" }] }; if (sql.startsWith("SELECT sequence_number")) return { rowCount: 1, rows: [{ sequence_number: 3, event_hash: previousHash }] }; return { rowCount: 1, rows: [] }; }); const store = createPostgresBootstrapAuthorityStore({ pool: state.pool, now: () => 0 }); const result = await store.consume(consumeArgs()); assert.equal(result.idempotent_recovery, false); assert.equal(result.event.previous_event_hash, previousHash); const statements = state.calls.map((entry) => entry.sql); assert.ok(statements.findIndex((sql) => sql.startsWith("INSERT INTO core_bootstrap_release_consumptions")) < statements.findIndex((sql) => sql.startsWith("INSERT INTO core_bootstrap_events"))); });

test("identical consumed request recovers the same locked receipt and outbox without new use or event", async () => { const input = consumeArgs(); const consumptionId = crypto.randomUUID(); const outbox = { consumption_id: consumptionId, action_request_digest: input.action_request_digest, target: input.target, status: "PENDING" }; const persisted = { consumption_id: consumptionId, tenant_id: input.tenant_id, exception_id: input.exception_id, receipt_digest: input.receipt_digest, work_id: input.work_id, repository: input.repository, pr_number: input.pr_number, head_sha: input.head_sha, allowed_action: input.allowed_action, required_checks_digest: input.required_checks_digest, required_checks_results_digest: input.required_checks_results_digest, action_request_digest: input.action_request_digest, persisted_authority_key_id: input.authority_key_id, persisted_owner_confirmation_digest: input.owner_confirmation_digest, persisted_core_policy_verdict_digest: input.core_policy_verdict_digest, persisted_rollback_obligations_digest: input.rollback_obligations_digest, persisted_post_deploy_obligations_digest: input.post_deploy_obligations_digest, outbox }; const state = poolWith((sql) => sql.startsWith("SELECT c.*,to_jsonb") ? { rowCount: 1, rows: [persisted] } : { rowCount: 1, rows: [] }); const store = createPostgresBootstrapAuthorityStore({ pool: state.pool }); const recovered = await store.consume(input); assert.equal(recovered.idempotent_recovery, true); assert.equal(recovered.consumption.consumption_id, consumptionId); assert.equal(recovered.event, null); const recoveryQuery = state.calls.find((entry) => entry.sql.startsWith("SELECT c.*,to_jsonb")).sql; assert.match(recoveryQuery, /JOIN core_bootstrap_action_outbox/); assert.doesNotMatch(recoveryQuery, /LEFT JOIN core_bootstrap_action_outbox/); assert.match(recoveryQuery, /FOR UPDATE OF c,r,o/); assert.equal(state.calls.some((entry) => entry.sql.startsWith("INSERT INTO core_bootstrap_release_consumptions") || entry.sql.startsWith("INSERT INTO core_bootstrap_events")), false); });

test("changed persisted receipt policy digest remains replay deny", async () => { const input = consumeArgs(); const outbox = { action_request_digest: input.action_request_digest, target: input.target, status: "PENDING" }; const state = poolWith((sql) => sql.startsWith("SELECT c.*,to_jsonb") ? { rowCount: 1, rows: [{ receipt_digest: input.receipt_digest, work_id: input.work_id, repository: input.repository, pr_number: input.pr_number, head_sha: input.head_sha, allowed_action: input.allowed_action, required_checks_digest: input.required_checks_digest, required_checks_results_digest: input.required_checks_results_digest, action_request_digest: input.action_request_digest, persisted_authority_key_id: input.authority_key_id, persisted_owner_confirmation_digest: input.owner_confirmation_digest, persisted_core_policy_verdict_digest: D("different-core-verdict"), persisted_rollback_obligations_digest: input.rollback_obligations_digest, persisted_post_deploy_obligations_digest: input.post_deploy_obligations_digest, outbox }] } : { rowCount: 1, rows: [] }); const store = createPostgresBootstrapAuthorityStore({ pool: state.pool }); await assert.rejects(() => store.consume(input), /replayed/); });

test("changed action digest remains replay deny", async () => { const input = consumeArgs(); const state = poolWith((sql) => sql.startsWith("SELECT c.*,to_jsonb") ? { rowCount: 1, rows: [{ receipt_digest: input.receipt_digest, work_id: input.work_id, repository: input.repository, pr_number: input.pr_number, head_sha: input.head_sha, allowed_action: input.allowed_action, required_checks_digest: input.required_checks_digest, required_checks_results_digest: input.required_checks_results_digest, action_request_digest: D("different-ticket"), outbox: { action_request_digest: D("different-ticket"), target: input.target } }] } : { rowCount: 1, rows: [] }); const store = createPostgresBootstrapAuthorityStore({ pool: state.pool }); await assert.rejects(() => store.consume(input), /replayed/); assert.ok(state.calls.some((entry) => entry.sql === "ROLLBACK")); });

test("cross-tenant consume fails closed without disclosing the other tenant", async () => { const state = poolWith((sql) => { if (sql.startsWith("SELECT c.*,to_jsonb") || sql.startsWith("SELECT r.receipt_digest")) return { rowCount: 0, rows: [] }; return { rowCount: 1, rows: [] }; }); const store = createPostgresBootstrapAuthorityStore({ pool: state.pool }); await assert.rejects(() => store.consume(consumeArgs(receipt("tenant-b"))), /not_eligible/); const eligibility = state.calls.find((entry) => entry.sql.startsWith("SELECT r.receipt_digest")); assert.equal(eligibility.params[0], "tenant-b"); });

test("read is tenant scoped and returns no cross-tenant record", async () => { const state = poolWith((sql) => sql.startsWith("SELECT * FROM core_bootstrap_release_receipts") ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [] }); const store = createPostgresBootstrapAuthorityStore({ pool: state.pool }); assert.equal(await store.read({ tenant_id: "tenant-b", exception_id: "exception-001" }), null); const query = state.calls.find((entry) => entry.sql.startsWith("SELECT * FROM core_bootstrap_release_receipts")); assert.deepEqual(query.params, ["tenant-b", "exception-001"]); });
