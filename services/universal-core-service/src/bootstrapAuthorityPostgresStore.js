import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureCoreSchemaMigrationRegistry } from "./coreSchemaMigrationRegistry.js";

const MIGRATION_SQL = [
  "../migrations/20260810_bootstrap_authority_registry.sql",
  "../migrations/20260811_bootstrap_authority_schema_convergence_repair.sql",
].map((migration) => fs.readFileSync(fileURLToPath(new URL(migration, import.meta.url)), "utf8")).join("\n");
const DIGEST = /^[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const TENANT = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const FORBIDDEN = /(^|_)(private(?:_key)?|secret|password|passphrase|credential_secret|token|seed|mnemonic|hmac|shared_key|api_key|access_key|client_secret)(_|$)/i;
const PROVIDERS = new Set(["local_pin", "webauthn_platform", "apple_secure_enclave", "windows_tpm", "pkcs11_hsm", "cloud_kms", "hashicorp_vault", "enterprise_external"]);
const ALGORITHMS = new Set(["ECDSA_P256_SHA256_P1363", "ECDSA-P256-SHA256", "Ed25519"]);
const ATTESTATION_STATUSES = new Set(["UNATTESTED_LOCAL_SOFTWARE", "PROVIDER_ATTESTED", "HARDWARE_ATTESTED", "EXTERNAL_ATTESTED"]);
const SCHEMA_CONVERGENCE_SQL = `
WITH required_columns(table_name,column_name) AS (VALUES
  ('core_bootstrap_trust_keys','attestation_status'),
  ('core_bootstrap_trust_keys','legacy_local_pin'),
  ('core_bootstrap_trust_keys','provider_attestation_digest'),
  ('core_bootstrap_trust_key_state','status'),
  ('core_bootstrap_release_receipts','receipt_digest'),
  ('core_bootstrap_release_consumptions','action_request_digest'),
  ('core_bootstrap_action_outbox','target'),
  ('core_bootstrap_events','event_hash')
), required_indexes(index_name) AS (VALUES
  ('core_bootstrap_one_active_key_per_tenant_idx'),
  ('core_bootstrap_receipt_target_idx')
), required_triggers(table_name,trigger_name) AS (VALUES
  ('core_bootstrap_trust_keys','core_bootstrap_trust_keys_no_mutation'),
  ('core_bootstrap_release_receipts','core_bootstrap_receipts_no_mutation'),
  ('core_bootstrap_release_revocations','core_bootstrap_revocations_no_mutation'),
  ('core_bootstrap_release_consumptions','core_bootstrap_consumptions_no_mutation'),
  ('core_bootstrap_events','core_bootstrap_events_no_mutation'),
  ('core_bootstrap_trust_key_state','core_bootstrap_trust_state_guard'),
  ('core_bootstrap_trust_key_state','core_bootstrap_trust_state_no_delete'),
  ('core_bootstrap_action_outbox','core_bootstrap_outbox_no_delete')
), required_constraints(table_name,constraint_name) AS (VALUES
  ('core_bootstrap_trust_keys','core_bootstrap_local_attestation_v2_ck'),
  ('core_bootstrap_release_receipts','core_bootstrap_receipt_single_use_v2_ck'),
  ('core_bootstrap_trust_key_state','core_bootstrap_trust_state_legacy_v2_ck')
)
SELECT
  ARRAY(SELECT table_name || '.' || column_name FROM required_columns r WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c WHERE c.table_schema=current_schema() AND c.table_name=r.table_name AND c.column_name=r.column_name
  )) AS missing_columns,
  ARRAY(SELECT index_name FROM required_indexes r WHERE to_regclass(current_schema() || '.' || r.index_name) IS NULL) AS missing_indexes,
  ARRAY(SELECT trigger_name FROM required_triggers r WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname=r.table_name
      AND t.tgname=r.trigger_name AND NOT t.tgisinternal
  )) AS missing_triggers,
  ARRAY(SELECT constraint_name FROM required_constraints r WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=current_schema() AND t.relname=r.table_name AND c.conname=r.constraint_name
  )) AS missing_constraints,
  NOT EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname='core_bootstrap_trust_keys'
      AND ((a.attname='attestation_status' AND a.attnotnull=false)
        OR (a.attname='provider_attestation_digest' AND a.attnotnull=true))
  ) AS attestation_columns_converged,
  EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class x ON x.oid=i.indexrelid
    JOIN pg_class t ON t.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=i.indkey[0]
    WHERE n.nspname=current_schema()
      AND t.relname='core_bootstrap_trust_key_state'
      AND x.relname='core_bootstrap_one_active_key_per_tenant_idx'
      AND i.indisunique AND i.indisvalid AND i.indisready
      AND i.indnkeyatts=1 AND i.indnatts=1 AND i.indexprs IS NULL
      AND a.attname='tenant_id'
      AND regexp_replace(
        pg_get_expr(i.indpred,t.oid),
        '[[:space:]()]|::text|::character varying',
        '',
        'g'
      ) = 'status=''ACTIVE'''
  ) AS active_key_index_converged,
  NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('core_bootstrap_trust_keys','tenant_id','character varying','varchar','NO'),
      ('core_bootstrap_trust_keys','authority_key_id','character varying','varchar','NO'),
      ('core_bootstrap_trust_keys','attestation_status','USER-DEFINED','core_bootstrap_attestation_status','NO'),
      ('core_bootstrap_trust_keys','provider_attestation_digest','character','bpchar','YES'),
      ('core_bootstrap_trust_keys','legacy_local_pin','boolean','bool','NO'),
      ('core_bootstrap_trust_keys','public_key_spki_der','bytea','bytea','NO'),
      ('core_bootstrap_release_receipts','receipt_digest','character','bpchar','NO'),
      ('core_bootstrap_release_receipts','receipt','jsonb','jsonb','NO'),
      ('core_bootstrap_release_consumptions','consumption_id','uuid','uuid','NO'),
      ('core_bootstrap_release_consumptions','action_request_digest','character','bpchar','NO'),
      ('core_bootstrap_action_outbox','target','jsonb','jsonb','NO'),
      ('core_bootstrap_events','event_hash','character','bpchar','NO')
    ) AS expected(table_name,column_name,data_type,udt_name,is_nullable)
    LEFT JOIN information_schema.columns c ON c.table_schema=current_schema()
      AND c.table_name=expected.table_name AND c.column_name=expected.column_name
    WHERE c.column_name IS NULL OR c.data_type<>expected.data_type OR c.udt_name<>expected.udt_name
      OR c.is_nullable<>expected.is_nullable
  ) AS column_semantics_converged,
  (
    EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE n.nspname=current_schema() AND c.conname='core_bootstrap_local_attestation_v2_ck'
        AND c.contype='c' AND c.convalidated AND NOT c.connoinherit
        AND c.conrelid=to_regclass(format('%I.%I',current_schema(),'core_bootstrap_trust_keys'))
        AND encode(sha256(convert_to(regexp_replace(regexp_replace(lower(pg_get_constraintdef(c.oid)),'::(text|character varying|core_bootstrap_attestation_status)','','g'),'[[:space:]()]','','g'),'UTF8')),'hex')
          = '9b5a206e99449d04c295e478119785891896752e24594c60efb406465be776a8')
    AND EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE n.nspname=current_schema() AND c.conname='core_bootstrap_receipt_single_use_v2_ck'
        AND c.contype='c' AND c.convalidated AND NOT c.connoinherit
        AND c.conrelid=to_regclass(format('%I.%I',current_schema(),'core_bootstrap_release_receipts'))
        AND encode(sha256(convert_to(regexp_replace(regexp_replace(lower(pg_get_constraintdef(c.oid)),'::(text|character varying|core_bootstrap_attestation_status)','','g'),'[[:space:]()]','','g'),'UTF8')),'hex')
          = 'a62982bfc760aa45156382981e4a968a47d2986d7e843399a98ff8be1a08d687')
  ) AS check_constraints_converged,
  EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
    WHERE n.nspname=current_schema() AND c.conname='core_bootstrap_trust_state_legacy_v2_ck'
      AND c.contype='c' AND c.convalidated AND NOT c.connoinherit
      AND c.conrelid=to_regclass(format('%I.%I',current_schema(),'core_bootstrap_trust_key_state'))
      AND encode(sha256(convert_to(regexp_replace(regexp_replace(lower(pg_get_constraintdef(c.oid)),'::(text|character varying|core_bootstrap_attestation_status)','','g'),'[[:space:]()]','','g'),'UTF8')),'hex')
        = '2fbe0796d982b5c4c1177a10a67be54f287266ff453a59d0eb823e10c38fc2c0') AS legacy_state_constraint_converged,
  (
    EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE n.nspname=current_schema() AND c.conname='core_bootstrap_state_key_v2_fk'
        AND c.contype='f' AND c.convalidated AND NOT c.condeferrable
        AND c.confupdtype='a' AND c.confdeltype='a'
        AND c.conrelid=to_regclass(format('%I.%I',current_schema(),'core_bootstrap_trust_key_state'))
        AND c.confrelid=to_regclass(format('%I.%I',current_schema(),'core_bootstrap_trust_keys'))
        AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord)
          = ARRAY['tenant_id','authority_key_id']::text[]
        AND ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.ord)
          = ARRAY['tenant_id','authority_key_id']::text[])
    AND EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE n.nspname=current_schema() AND c.conname='core_bootstrap_consumption_receipt_v2_fk'
        AND c.contype='f' AND c.convalidated AND NOT c.condeferrable
        AND c.confupdtype='a' AND c.confdeltype='a'
        AND c.conrelid=to_regclass(format('%I.%I',current_schema(),'core_bootstrap_release_consumptions'))
        AND c.confrelid=to_regclass(format('%I.%I',current_schema(),'core_bootstrap_release_receipts'))
        AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord)
          = ARRAY['tenant_id','exception_id','receipt_digest']::text[]
        AND ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.ord)
          = ARRAY['tenant_id','exception_id','receipt_digest']::text[])
    AND EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE n.nspname=current_schema() AND c.conname='core_bootstrap_outbox_consumption_v2_fk'
        AND c.contype='f' AND c.convalidated AND NOT c.condeferrable
        AND c.confupdtype='a' AND c.confdeltype='a'
        AND c.conrelid=to_regclass(format('%I.%I',current_schema(),'core_bootstrap_action_outbox'))
        AND c.confrelid=to_regclass(format('%I.%I',current_schema(),'core_bootstrap_release_consumptions'))
        AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord)
          = ARRAY['consumption_id']::text[]
        AND ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord)
          JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum ORDER BY k.ord)
          = ARRAY['consumption_id']::text[])
  ) AS foreign_keys_converged,
  (
    EXISTS (SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
      WHERE n.nspname=current_schema() AND pn.nspname=current_schema()
        AND c.relname='core_bootstrap_trust_keys' AND t.tgname='core_bootstrap_trust_keys_no_mutation'
        AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=27 AND t.tgnargs=0 AND t.tgqual IS NULL
        AND p.proname='core_bootstrap_forbid_mutation' AND p.pronargs=0 AND p.prorettype='trigger'::regtype)
    AND EXISTS (SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
      WHERE n.nspname=current_schema() AND pn.nspname=current_schema()
        AND c.relname='core_bootstrap_release_receipts' AND t.tgname='core_bootstrap_receipts_no_mutation'
        AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=27 AND t.tgnargs=0 AND t.tgqual IS NULL
        AND p.proname='core_bootstrap_forbid_mutation' AND p.pronargs=0 AND p.prorettype='trigger'::regtype)
    AND EXISTS (SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
      WHERE n.nspname=current_schema() AND pn.nspname=current_schema()
        AND c.relname='core_bootstrap_release_revocations' AND t.tgname='core_bootstrap_revocations_no_mutation'
        AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=27 AND t.tgnargs=0 AND t.tgqual IS NULL
        AND p.proname='core_bootstrap_forbid_mutation' AND p.pronargs=0 AND p.prorettype='trigger'::regtype)
    AND EXISTS (SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
      WHERE n.nspname=current_schema() AND pn.nspname=current_schema()
        AND c.relname='core_bootstrap_release_consumptions' AND t.tgname='core_bootstrap_consumptions_no_mutation'
        AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=27 AND t.tgnargs=0 AND t.tgqual IS NULL
        AND p.proname='core_bootstrap_forbid_mutation' AND p.pronargs=0 AND p.prorettype='trigger'::regtype)
    AND EXISTS (SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
      WHERE n.nspname=current_schema() AND pn.nspname=current_schema()
        AND c.relname='core_bootstrap_events' AND t.tgname='core_bootstrap_events_no_mutation'
        AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=27 AND t.tgnargs=0 AND t.tgqual IS NULL
        AND p.proname='core_bootstrap_forbid_mutation' AND p.pronargs=0 AND p.prorettype='trigger'::regtype)
    AND EXISTS (SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
      WHERE n.nspname=current_schema() AND pn.nspname=current_schema()
        AND c.relname='core_bootstrap_trust_key_state' AND t.tgname='core_bootstrap_trust_state_guard'
        AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=19 AND t.tgnargs=0 AND t.tgqual IS NULL
        AND p.proname='core_bootstrap_trust_state_transition' AND p.pronargs=0 AND p.prorettype='trigger'::regtype)
    AND EXISTS (SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
      WHERE n.nspname=current_schema() AND pn.nspname=current_schema()
        AND c.relname='core_bootstrap_trust_key_state' AND t.tgname='core_bootstrap_trust_state_no_delete'
        AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=11 AND t.tgnargs=0 AND t.tgqual IS NULL
        AND p.proname='core_bootstrap_forbid_mutation' AND p.pronargs=0 AND p.prorettype='trigger'::regtype)
    AND EXISTS (SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
      WHERE n.nspname=current_schema() AND pn.nspname=current_schema()
        AND c.relname='core_bootstrap_action_outbox' AND t.tgname='core_bootstrap_outbox_no_delete'
        AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgtype=11 AND t.tgnargs=0 AND t.tgqual IS NULL
        AND p.proname='core_bootstrap_forbid_mutation' AND p.pronargs=0 AND p.prorettype='trigger'::regtype)
    AND EXISTS (SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
      WHERE n.nspname=current_schema() AND p.proname='core_bootstrap_forbid_mutation'
        AND p.prokind='f' AND l.lanname='plpgsql' AND p.pronargs=0 AND p.pronargdefaults=0
        AND p.prorettype='trigger'::regtype AND NOT p.proretset AND NOT p.prosecdef
        AND NOT p.proleakproof AND NOT p.proisstrict AND p.provolatile='v' AND p.proparallel='u'
        AND p.proconfig IS NULL
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f480f069070eb7422ac7fedec4a3546772b75ab65b4e0e81c38d0f7a2c01af37')
    AND EXISTS (SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
      WHERE n.nspname=current_schema() AND p.proname='core_bootstrap_trust_state_transition'
        AND p.prokind='f' AND l.lanname='plpgsql' AND p.pronargs=0 AND p.pronargdefaults=0
        AND p.prorettype='trigger'::regtype AND NOT p.proretset AND NOT p.prosecdef
        AND NOT p.proleakproof AND NOT p.proisstrict AND p.provolatile='v' AND p.proparallel='u'
        AND p.proconfig IS NULL
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='1cbc99f0f8c6a49b96a03a3e9bc042940c7e43d02a8250bebc974fd0294629ed')
  ) AS trigger_definitions_converged`;

function fail(code) { throw new Error(code); }
function plain(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function text(value, pattern, code) { if (typeof value !== "string" || !pattern.test(value)) fail(code); return value; }
function digest(value, code) { return text(value, DIGEST, code); }
function tenant(value) { return text(value, TENANT, "bootstrap_authority_tenant_invalid"); }
function identifier(value, code = "bootstrap_authority_identifier_invalid") { return text(value, ID, code); }
function repository(value) { const result = text(value, REPOSITORY, "bootstrap_authority_repository_invalid"); if (result.includes("..") || result.endsWith(".git")) fail("bootstrap_authority_repository_invalid"); return result; }
function integer(value, code) { if (!Number.isSafeInteger(value) || value < 1) fail(code); return value; }
function clone(value) { return structuredClone(value); }
function canonical(value) { if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value); if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (!plain(value)) fail("bootstrap_authority_canonical_value_invalid"); return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; }
function hash(value, domain = "") { return crypto.createHash("sha256").update(domain, "utf8").update(canonical(value), "utf8").digest("hex"); }
function dbTimestamp(value) { const date = value instanceof Date ? value : new Date(value); if (!Number.isFinite(date.getTime())) fail("bootstrap_authority_database_timestamp_invalid"); return date.toISOString(); }
function assertPublicData(value, seen = new WeakSet()) { if (value === null || ["string", "boolean"].includes(typeof value) || (typeof value === "number" && Number.isFinite(value))) return; if (Buffer.isBuffer(value)) return; if (Array.isArray(value)) { if (seen.has(value)) fail("bootstrap_authority_input_invalid"); seen.add(value); for (const entry of value) assertPublicData(entry, seen); return; } if (!plain(value) || seen.has(value)) fail("bootstrap_authority_input_invalid"); seen.add(value); for (const [key, entry] of Object.entries(value)) { if (FORBIDDEN.test(key)) fail("bootstrap_authority_private_material_forbidden"); assertPublicData(entry, seen); } }
function normalizedReceipt(receipt) {
  if (!plain(receipt)) fail("bootstrap_release_exception_receipt_invalid"); assertPublicData(receipt);
  if (receipt.allowed_action !== "github.merge" || receipt.max_uses !== 1 || receipt.core_policy_classification !== "BOOTSTRAP_DEADLOCK_VERIFIED" || receipt.consumed_at !== null || receipt.revoked_at !== null) fail("bootstrap_release_exception_receipt_invalid");
  tenant(receipt.tenant_id); identifier(receipt.exception_id); identifier(receipt.work_id); repository(receipt.repository); integer(receipt.pr_number, "bootstrap_release_exception_pr_invalid"); text(receipt.head_sha, SHA, "bootstrap_release_exception_sha_invalid"); identifier(receipt.authority_key_id); identifier(receipt.nonce);
  if (!PROVIDERS.has(receipt.authority_provider)) fail("bootstrap_release_exception_authority_provider_invalid");
  for (const field of ["required_checks_digest", "required_checks_results_digest", "owner_confirmation_digest", "core_policy_verdict_digest", "rollback_obligations_digest", "post_deploy_obligations_digest"]) digest(receipt[field], `bootstrap_release_exception_${field}_invalid`);
  const issued = Date.parse(receipt.issued_at); const expires = Date.parse(receipt.expires_at); if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued || expires - issued > 15 * 60 * 1000) fail("bootstrap_release_exception_time_invalid");
  return receipt;
}
function consumeInput(input) {
  if (!plain(input)) fail("bootstrap_release_exception_consume_invalid"); assertPublicData(input);
  const result = { ...input, tenant_id: tenant(input.tenant_id), exception_id: identifier(input.exception_id), work_id: identifier(input.work_id), repository: repository(input.repository), pr_number: integer(input.pr_number, "bootstrap_release_exception_pr_invalid"), head_sha: text(input.head_sha, SHA, "bootstrap_release_exception_sha_invalid"), authority_key_id: identifier(input.authority_key_id), consumed_by: identifier(input.consumed_by) };
  if (result.allowed_action !== "github.merge") fail("bootstrap_release_exception_action_invalid");
  for (const field of ["required_checks_digest", "required_checks_results_digest", "owner_confirmation_digest", "core_policy_verdict_digest", "rollback_obligations_digest", "post_deploy_obligations_digest", "receipt_digest", "action_request_digest"]) digest(result[field], `bootstrap_release_exception_${field}_invalid`);
  if (!plain(result.target) || result.target.repository !== result.repository || result.target.pr_number !== result.pr_number || result.target.head_sha !== result.head_sha || result.target.allowed_action !== result.allowed_action) fail("bootstrap_release_exception_target_invalid");
  return result;
}

async function transaction(pool, operation, isolation = "SERIALIZABLE") {
  const client = await pool.connect();
  try { await client.query(`BEGIN TRANSACTION ISOLATION LEVEL ${isolation}`); const value = await operation(client); await client.query("COMMIT"); return value; }
  catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}
async function lock(client, tenantId, streamType, streamId) { await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || E'\\x1f' || $2 || E'\\x1f' || $3, 0))", [tenantId, streamType, streamId]); }
async function databaseNow(client) { const result = await client.query("SELECT transaction_timestamp() AS database_now"); return dbTimestamp(result.rows[0]?.database_now); }
async function appendEvent(client, { tenant_id, stream_type, stream_id, event_type, payload, occurred_at }) {
  await lock(client, tenant_id, stream_type, stream_id);
  const previous = await client.query("SELECT sequence_number,event_hash FROM core_bootstrap_events WHERE tenant_id=$1 AND stream_type=$2 AND stream_id=$3 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE", [tenant_id, stream_type, stream_id]);
  const sequence_number = Number(previous.rows[0]?.sequence_number || 0) + 1; const previous_event_hash = previous.rows[0]?.event_hash || null;
  const envelope = { tenant_id, stream_type, stream_id, sequence_number, event_type, payload, previous_event_hash, occurred_at };
  const event_hash = hash(envelope, "core_bootstrap_event_v1\0"); const event_id = crypto.randomUUID();
  await client.query("INSERT INTO core_bootstrap_events (tenant_id,stream_type,stream_id,sequence_number,event_id,event_type,payload,previous_event_hash,event_hash,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)", [tenant_id, stream_type, stream_id, sequence_number, event_id, event_type, JSON.stringify(payload), previous_event_hash, event_hash, occurred_at]);
  return Object.freeze({ event_id, sequence_number, event_hash, previous_event_hash, occurred_at });
}

export function createPostgresBootstrapAuthorityStore({ pool, now = Date.now } = {}) {
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function" || typeof now !== "function") fail("bootstrap_authority_postgres_unavailable");
  let initialized;
  const initialize = () => initialized ||= (async () => {
    // The marker table is shared with Causal Continuity. Reconcile its
    // additive superset before Bootstrap writes one-column historical markers.
    const client = await pool.connect();
    try {
      await ensureCoreSchemaMigrationRegistry(client);
    } finally {
      client.release();
    }
    await pool.query(MIGRATION_SQL);
    const convergence = await pool.query(SCHEMA_CONVERGENCE_SQL);
    const row = convergence.rows[0];
    if (!row || ["missing_columns", "missing_indexes", "missing_triggers", "missing_constraints"].some((field) => !Array.isArray(row[field]) || row[field].length) || ["attestation_columns_converged", "active_key_index_converged", "column_semantics_converged", "check_constraints_converged", "legacy_state_constraint_converged", "foreign_keys_converged", "trigger_definitions_converged"].some((field) => row[field] !== true)) fail("bootstrap_authority_schema_not_converged");
    return Object.freeze({ backend: "postgres_bootstrap_authority_v2", durable: true, distributed: true, automatic_trust_installation: false });
  })();

  async function installTrustKey(record = {}) {
    assertPublicData(record); await initialize(); const tenantId = tenant(record.tenant_id); const keyId = identifier(record.authority_key_id); if (!PROVIDERS.has(record.authority_provider)) fail("bootstrap_trust_provider_invalid"); if (!ALGORITHMS.has(record.algorithm)) fail("bootstrap_trust_algorithm_invalid"); if (!ATTESTATION_STATUSES.has(record.attestation_status)) fail("bootstrap_trust_attestation_status_invalid");
    if (!Buffer.isBuffer(record.public_key_spki_der) || record.public_key_spki_der.length < 32 || record.public_key_spki_der.length > 4096) fail("bootstrap_trust_public_key_invalid");
    for (const field of ["public_key_sha256", "trust_bundle_digest", "genesis_record_digest"]) digest(record[field], `bootstrap_trust_${field}_invalid`); if (record.authority_provider === "local_pin") { if (record.attestation_status !== "UNATTESTED_LOCAL_SOFTWARE" || record.provider_attestation_digest != null) fail("bootstrap_trust_local_attestation_invalid"); } else { if (record.attestation_status === "UNATTESTED_LOCAL_SOFTWARE") fail("bootstrap_trust_attestation_status_invalid"); digest(record.provider_attestation_digest, "bootstrap_trust_provider_attestation_digest_invalid"); } if (!plain(record.genesis_record)) fail("bootstrap_trust_genesis_record_invalid");
    return transaction(pool, async (client) => {
      await lock(client, tenantId, "TRUST_KEY", keyId);
      const existing = await client.query("SELECT k.*,s.status,s.version FROM core_bootstrap_trust_keys k JOIN core_bootstrap_trust_key_state s USING (tenant_id,authority_key_id) WHERE k.tenant_id=$1 AND k.authority_key_id=$2 FOR UPDATE OF k,s", [tenantId, keyId]);
      if (existing.rowCount) { const row = existing.rows[0]; if (row.public_key_sha256 !== record.public_key_sha256 || row.trust_bundle_digest !== record.trust_bundle_digest || row.authority_provider !== record.authority_provider || row.algorithm !== record.algorithm || row.attestation_status !== record.attestation_status || row.provider_attestation_digest !== (record.provider_attestation_digest ?? null)) fail("bootstrap_trust_key_immutable_conflict"); return clone(row); }
      const installedAt = await databaseNow(client);
      const inserted = await client.query("INSERT INTO core_bootstrap_trust_keys (tenant_id,authority_key_id,authority_provider,algorithm,attestation_status,credential_id,public_key_spki_der,public_key_sha256,trust_bundle_digest,provider_attestation_digest,rp_id,origin,genesis_record_digest,genesis_record,installed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15) RETURNING *", [tenantId, keyId, record.authority_provider, record.algorithm, record.attestation_status, record.credential_id || null, record.public_key_spki_der, record.public_key_sha256, record.trust_bundle_digest, record.provider_attestation_digest ?? null, record.rp_id || null, record.origin || null, record.genesis_record_digest, JSON.stringify(record.genesis_record), installedAt]);
      await client.query("INSERT INTO core_bootstrap_trust_key_state (tenant_id,authority_key_id,status,activated_at,updated_at) VALUES ($1,$2,'ACTIVE',$3,$3)", [tenantId, keyId, installedAt]);
      const event = await appendEvent(client, { tenant_id: tenantId, stream_type: "TRUST_KEY", stream_id: keyId, event_type: "bootstrap_trust_key_installed", payload: { authority_provider: record.authority_provider, algorithm: record.algorithm, attestation_status: record.attestation_status, public_key_sha256: record.public_key_sha256, trust_bundle_digest: record.trust_bundle_digest, genesis_record_digest: record.genesis_record_digest }, occurred_at: installedAt });
      return Object.freeze({ ...clone(inserted.rows[0]), status: "ACTIVE", event });
    });
  }

  async function resolveActiveTrustKey(input = {}) {
    await initialize(); const tenantId = tenant(input.tenant_id); const keyId = identifier(input.authority_key_id);
    const result = await pool.query("SELECT k.*,s.status,s.version,s.activated_at FROM core_bootstrap_trust_keys k JOIN core_bootstrap_trust_key_state s USING (tenant_id,authority_key_id) WHERE k.tenant_id=$1 AND k.authority_key_id=$2 AND s.status='ACTIVE'", [tenantId, keyId]);
    if (result.rowCount !== 1) fail("bootstrap_trust_key_unavailable"); return clone(result.rows[0]);
  }

  async function recordVerifiedCandidate({ receipt, candidate } = {}) {
    await initialize(); normalizedReceipt(receipt); if (!plain(candidate)) fail("bootstrap_release_exception_candidate_invalid"); assertPublicData(candidate);
    const receiptDigest = hash(receipt); if (candidate.receipt_digest !== receiptDigest || candidate.verification_status !== "verified_non_authorizing_candidate" || candidate.candidate !== true || candidate.action_authorized !== false || candidate.execution_authorized !== false || candidate.host_action_authorized !== false || candidate.core_join_authorized !== false || candidate.consumption_authorized !== false) fail("bootstrap_release_exception_candidate_invalid");
    for (const field of ["tenant_id", "exception_id", "work_id", "repository", "pr_number", "head_sha", "allowed_action", "authority_provider", "authority_key_id"]) if (candidate[field] !== receipt[field]) fail("bootstrap_release_exception_candidate_binding_mismatch");
    return transaction(pool, async (client) => {
      await lock(client, receipt.tenant_id, "RELEASE_EXCEPTION", receipt.exception_id);
      const trust = await client.query("SELECT k.authority_provider,k.algorithm,k.attestation_status,k.provider_attestation_digest,s.status FROM core_bootstrap_trust_keys k JOIN core_bootstrap_trust_key_state s USING (tenant_id,authority_key_id) WHERE k.tenant_id=$1 AND k.authority_key_id=$2 AND s.status='ACTIVE' FOR UPDATE OF k,s", [receipt.tenant_id, receipt.authority_key_id]);
      if (trust.rowCount !== 1 || trust.rows[0].authority_provider !== receipt.authority_provider || (receipt.authority_provider === "local_pin" && (trust.rows[0].attestation_status !== "UNATTESTED_LOCAL_SOFTWARE" || trust.rows[0].provider_attestation_digest != null))) fail("bootstrap_trust_key_unavailable");
      const verifiedAt = await databaseNow(client); const dbMs = Date.parse(verifiedAt); if (Date.parse(receipt.issued_at) > dbMs + 30000 || Date.parse(receipt.expires_at) <= dbMs) fail("bootstrap_release_exception_expired");
      const inserted = await client.query("INSERT INTO core_bootstrap_release_receipts (tenant_id,exception_id,work_id,repository,pr_number,head_sha,allowed_action,max_uses,authority_provider,authority_key_id,nonce,core_policy_classification,required_checks_digest,required_checks_results_digest,owner_confirmation_digest,core_policy_verdict_digest,rollback_obligations_digest,post_deploy_obligations_digest,issued_at,expires_at,receipt_digest,receipt,verifier_candidate,verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23::jsonb,$24) ON CONFLICT DO NOTHING RETURNING *", [receipt.tenant_id, receipt.exception_id, receipt.work_id, receipt.repository, receipt.pr_number, receipt.head_sha, receipt.allowed_action, receipt.max_uses, receipt.authority_provider, receipt.authority_key_id, receipt.nonce, receipt.core_policy_classification, receipt.required_checks_digest, receipt.required_checks_results_digest, receipt.owner_confirmation_digest, receipt.core_policy_verdict_digest, receipt.rollback_obligations_digest, receipt.post_deploy_obligations_digest, receipt.issued_at, receipt.expires_at, receiptDigest, JSON.stringify(receipt), JSON.stringify(candidate), verifiedAt]);
      if (!inserted.rowCount) { const existing = await client.query("SELECT * FROM core_bootstrap_release_receipts WHERE tenant_id=$1 AND exception_id=$2 FOR UPDATE", [receipt.tenant_id, receipt.exception_id]); if (existing.rows[0]?.receipt_digest !== receiptDigest) fail("bootstrap_release_exception_immutable_conflict"); return clone(existing.rows[0]); }
      const event = await appendEvent(client, { tenant_id: receipt.tenant_id, stream_type: "RELEASE_EXCEPTION", stream_id: receipt.exception_id, event_type: "bootstrap_exception_registered", payload: { receipt_digest: receiptDigest, work_id: receipt.work_id, repository: receipt.repository, pr_number: receipt.pr_number, head_sha: receipt.head_sha, allowed_action: receipt.allowed_action, authority_key_id: receipt.authority_key_id }, occurred_at: verifiedAt });
      return Object.freeze({ ...clone(inserted.rows[0]), event });
    });
  }

  async function revoke(input = {}) {
    await initialize(); assertPublicData(input); const tenantId = tenant(input.tenant_id); const exceptionId = identifier(input.exception_id); const reasonDigest = digest(input.reason_digest, "bootstrap_release_exception_revocation_reason_invalid"); const revokedBy = identifier(input.revoked_by);
    return transaction(pool, async (client) => {
      await lock(client, tenantId, "RELEASE_EXCEPTION", exceptionId);
      const receipt = await client.query("SELECT receipt_digest FROM core_bootstrap_release_receipts WHERE tenant_id=$1 AND exception_id=$2 FOR UPDATE", [tenantId, exceptionId]); if (receipt.rowCount !== 1) fail("bootstrap_release_exception_not_found");
      const consumed = await client.query("SELECT 1 FROM core_bootstrap_release_consumptions WHERE tenant_id=$1 AND exception_id=$2 FOR UPDATE", [tenantId, exceptionId]); if (consumed.rowCount) fail("bootstrap_release_exception_already_consumed");
      const revokedAt = await databaseNow(client); const inserted = await client.query("INSERT INTO core_bootstrap_release_revocations (tenant_id,exception_id,receipt_digest,reason_digest,revoked_by,revoked_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING *", [tenantId, exceptionId, receipt.rows[0].receipt_digest, reasonDigest, revokedBy, revokedAt]);
      if (!inserted.rowCount) { const existing = await client.query("SELECT * FROM core_bootstrap_release_revocations WHERE tenant_id=$1 AND exception_id=$2", [tenantId, exceptionId]); if (existing.rows[0]?.reason_digest !== reasonDigest) fail("bootstrap_release_exception_revocation_conflict"); return clone(existing.rows[0]); }
      const event = await appendEvent(client, { tenant_id: tenantId, stream_type: "RELEASE_EXCEPTION", stream_id: exceptionId, event_type: "bootstrap_exception_revoked", payload: { receipt_digest: receipt.rows[0].receipt_digest, reason_digest: reasonDigest, revoked_by: revokedBy }, occurred_at: revokedAt });
      return Object.freeze({ ...clone(inserted.rows[0]), event });
    });
  }

  async function consume(raw = {}) {
    await initialize(); const input = consumeInput(raw); const consumptionId = crypto.randomUUID();
    return transaction(pool, async (client) => {
      await client.query("SET LOCAL lock_timeout = '3s'"); await client.query("SET LOCAL statement_timeout = '8s'"); await lock(client, input.tenant_id, "RELEASE_EXCEPTION", input.exception_id);
      const prior = await client.query("SELECT c.*,to_jsonb(o) AS outbox,r.authority_key_id AS persisted_authority_key_id,r.owner_confirmation_digest AS persisted_owner_confirmation_digest,r.core_policy_verdict_digest AS persisted_core_policy_verdict_digest,r.rollback_obligations_digest AS persisted_rollback_obligations_digest,r.post_deploy_obligations_digest AS persisted_post_deploy_obligations_digest FROM core_bootstrap_release_consumptions c JOIN core_bootstrap_release_receipts r ON r.tenant_id=c.tenant_id AND r.exception_id=c.exception_id AND r.receipt_digest=c.receipt_digest JOIN core_bootstrap_action_outbox o ON o.consumption_id=c.consumption_id WHERE c.tenant_id=$1 AND c.exception_id=$2 FOR UPDATE OF c,r,o", [input.tenant_id, input.exception_id]);
      if (prior.rowCount) {
        const row = prior.rows[0]; const outbox = typeof row.outbox === "string" ? JSON.parse(row.outbox) : row.outbox;
        const identical = row.receipt_digest === input.receipt_digest && row.work_id === input.work_id && row.repository === input.repository && Number(row.pr_number) === input.pr_number && row.head_sha === input.head_sha && row.allowed_action === input.allowed_action && row.required_checks_digest === input.required_checks_digest && row.required_checks_results_digest === input.required_checks_results_digest && row.action_request_digest === input.action_request_digest && row.persisted_authority_key_id === input.authority_key_id && row.persisted_owner_confirmation_digest === input.owner_confirmation_digest && row.persisted_core_policy_verdict_digest === input.core_policy_verdict_digest && row.persisted_rollback_obligations_digest === input.rollback_obligations_digest && row.persisted_post_deploy_obligations_digest === input.post_deploy_obligations_digest && outbox && outbox.action_request_digest === input.action_request_digest && canonical(outbox.target) === canonical(input.target);
        if (!identical) fail("bootstrap_release_exception_replayed");
        const { outbox: _outbox, persisted_authority_key_id: _authorityKey, persisted_owner_confirmation_digest: _ownerDigest, persisted_core_policy_verdict_digest: _coreDigest, persisted_rollback_obligations_digest: _rollbackDigest, persisted_post_deploy_obligations_digest: _postDeployDigest, ...consumption } = row;
        return Object.freeze({ consumption: clone(consumption), outbox: clone(outbox), event: null, action_authorized: true, core_join_authorized: false, idempotent_recovery: true });
      }
      const eligible = await client.query("SELECT r.receipt_digest FROM core_bootstrap_release_receipts r JOIN core_bootstrap_trust_key_state s ON s.tenant_id=r.tenant_id AND s.authority_key_id=r.authority_key_id WHERE r.tenant_id=$1 AND r.exception_id=$2 AND r.work_id=$3 AND r.repository=$4 AND r.pr_number=$5 AND r.head_sha=$6 AND r.allowed_action=$7 AND r.required_checks_digest=$8 AND r.required_checks_results_digest=$9 AND r.owner_confirmation_digest=$10 AND r.core_policy_verdict_digest=$11 AND r.rollback_obligations_digest=$12 AND r.post_deploy_obligations_digest=$13 AND r.receipt_digest=$14 AND r.authority_key_id=$15 AND r.max_uses=1 AND r.core_policy_classification='BOOTSTRAP_DEADLOCK_VERIFIED' AND r.issued_at<=statement_timestamp()+interval '30 seconds' AND r.expires_at>statement_timestamp() AND s.status='ACTIVE' AND NOT EXISTS (SELECT 1 FROM core_bootstrap_release_revocations x WHERE x.tenant_id=r.tenant_id AND x.exception_id=r.exception_id) FOR UPDATE OF r,s", [input.tenant_id, input.exception_id, input.work_id, input.repository, input.pr_number, input.head_sha, input.allowed_action, input.required_checks_digest, input.required_checks_results_digest, input.owner_confirmation_digest, input.core_policy_verdict_digest, input.rollback_obligations_digest, input.post_deploy_obligations_digest, input.receipt_digest, input.authority_key_id]);
      if (eligible.rowCount !== 1) fail("bootstrap_release_exception_not_eligible");
      const consumedAt = await databaseNow(client);
      const consumed = await client.query("INSERT INTO core_bootstrap_release_consumptions (tenant_id,exception_id,consumption_id,receipt_digest,work_id,repository,pr_number,head_sha,allowed_action,required_checks_digest,required_checks_results_digest,action_request_digest,consumed_by,consumed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING RETURNING *", [input.tenant_id, input.exception_id, consumptionId, input.receipt_digest, input.work_id, input.repository, input.pr_number, input.head_sha, input.allowed_action, input.required_checks_digest, input.required_checks_results_digest, input.action_request_digest, input.consumed_by, consumedAt]);
      if (consumed.rowCount !== 1) fail("bootstrap_release_exception_replayed");
      const outbox = await client.query("INSERT INTO core_bootstrap_action_outbox (consumption_id,tenant_id,exception_id,allowed_action,target,action_request_digest,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,'PENDING',$7,$7) RETURNING *", [consumptionId, input.tenant_id, input.exception_id, input.allowed_action, JSON.stringify(input.target), input.action_request_digest, consumedAt]);
      const event = await appendEvent(client, { tenant_id: input.tenant_id, stream_type: "RELEASE_EXCEPTION", stream_id: input.exception_id, event_type: "bootstrap_exception_consumed", payload: { consumption_id: consumptionId, receipt_digest: input.receipt_digest, work_id: input.work_id, repository: input.repository, pr_number: input.pr_number, head_sha: input.head_sha, allowed_action: input.allowed_action, required_checks_digest: input.required_checks_digest, required_checks_results_digest: input.required_checks_results_digest, action_request_digest: input.action_request_digest, consumed_by: input.consumed_by }, occurred_at: consumedAt });
      return Object.freeze({ consumption: clone(consumed.rows[0]), outbox: clone(outbox.rows[0]), event, action_authorized: true, core_join_authorized: false, idempotent_recovery: false });
    });
  }

  async function read(input = {}) {
    await initialize(); const tenantId = tenant(input.tenant_id); const exceptionId = identifier(input.exception_id);
    return transaction(pool, async (client) => {
      const receipt = await client.query("SELECT * FROM core_bootstrap_release_receipts WHERE tenant_id=$1 AND exception_id=$2", [tenantId, exceptionId]); if (!receipt.rowCount) return null;
      const revocation = await client.query("SELECT * FROM core_bootstrap_release_revocations WHERE tenant_id=$1 AND exception_id=$2", [tenantId, exceptionId]); const consumption = await client.query("SELECT * FROM core_bootstrap_release_consumptions WHERE tenant_id=$1 AND exception_id=$2", [tenantId, exceptionId]); const outbox = consumption.rowCount ? await client.query("SELECT * FROM core_bootstrap_action_outbox WHERE consumption_id=$1", [consumption.rows[0].consumption_id]) : { rows: [] }; const events = await client.query("SELECT * FROM core_bootstrap_events WHERE tenant_id=$1 AND stream_type='RELEASE_EXCEPTION' AND stream_id=$2 ORDER BY sequence_number", [tenantId, exceptionId]);
      return Object.freeze({ receipt: clone(receipt.rows[0]), revocation: clone(revocation.rows[0] || null), consumption: clone(consumption.rows[0] || null), outbox: clone(outbox.rows[0] || null), events: clone(events.rows) });
    }, "REPEATABLE READ READ ONLY");
  }

  return Object.freeze({ initialize, installTrustKey, resolveActiveTrustKey, recordVerifiedCandidate, revoke, consume, read });
}
