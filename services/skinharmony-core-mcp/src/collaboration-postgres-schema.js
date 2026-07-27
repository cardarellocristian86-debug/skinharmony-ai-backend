import crypto from "node:crypto";
import { COLLABORATION_AGENT_SCHEMA_SQL } from "./collaboration-postgres-store.js";
import {
  collaborationSharedMemorySchemaSql,
  COLLABORATION_RECEIPT_FUNCTION_BODY,
} from "./shared-memory-postgres-store.js";
import { DECISION_LEDGER_SCHEMA_SQL } from "./decision-ledger.js";
import {
  collaborationTrustPinSchemaSql,
  COLLABORATION_TRUST_PIN_FUNCTION_BODY,
} from "./collaboration-trust-pins.js";
import {
  canonicalBootstrapControlSchemaSql,
} from "../../mcp-staging-canonical-bootstrap/src/index.js";

export const COLLABORATION_SCHEMA_VERSION = 3;
export const COLLABORATION_SCHEMA_MIGRATION_ID =
  "0003_canonical_shared_memory_bootstrap";

const ADVISORY_LOCK_KEY = "skinharmony-mcp-collaboration-schema-v1";
const CANONICAL_BOOTSTRAP_SCHEMA_SQL = canonicalBootstrapControlSchemaSql();
const CANONICAL_BOOTSTRAP_FUNCTION_BODY =
  CANONICAL_BOOTSTRAP_SCHEMA_SQL.match(
    /AS \$canonical_bootstrap_append_only\$([\s\S]*?)\$canonical_bootstrap_append_only\$;/,
  )?.[1] || "";
const REQUIRED_RELATIONS = Object.freeze([
  "agent_presence",
  "agent_tasks",
  "agent_messages",
  "agent_message_quarantines",
  "mcp_workspace_documents",
  "mcp_workspace_document_versions",
  "mcp_workspace_lock_leases",
  "mcp_memory_records",
  "mcp_memory_handoffs",
  "mcp_collaboration_control.consumed_receipts",
  "mcp_collaboration_control.trusted_issuer_keys",
  "mcp_collaboration_control.canonical_bootstrap_consumptions",
  "mcp_coordination_events",
  "core_ai_work_sessions",
  "core_decision_events",
]);

const MUTABLE_TABLES = Object.freeze([
  "public.agent_sessions", "public.agent_presence", "public.agent_message_deliveries", "public.agent_tasks",
  "public.agent_task_leases", "public.mcp_workspace_heads", "public.mcp_workspace_folders",
  "public.mcp_workspace_documents", "public.mcp_workspace_lock_leases", "public.mcp_memory_heads",
  "public.mcp_memory_stream_heads", "public.mcp_memory_handoffs", "public.mcp_memory_handoff_deliveries",
  "public.mcp_collaboration_idempotency", "public.core_ai_work_sessions", "public.core_verified_outcomes",
]);
const APPEND_TABLES = Object.freeze([
  "public.agent_messages", "public.agent_message_quarantines", "public.agent_handoffs", "public.agent_events",
  "public.mcp_workspace_document_versions", "public.mcp_memory_records", "public.mcp_memory_events",
  "public.mcp_coordination_events", "public.core_decision_events",
]);
const RUNTIME_SEQUENCES = Object.freeze([
  "public.agent_task_fencing_seq", "public.agent_events_id_seq", "public.mcp_workspace_fencing_seq",
  "public.mcp_coordination_events_id_seq",
]);
const TENANT_TABLES = Object.freeze([...new Set([...MUTABLE_TABLES, ...APPEND_TABLES])]);
const READONLY_RELATIONS = Object.freeze([
  "public.mcp_collaboration_schema_migrations",
  "public.core_decision_daily_metrics",
]);
const DESTRUCTIVE_GUARDED_RELATIONS = Object.freeze([
  ...TENANT_TABLES,
  ...READONLY_RELATIONS,
  "mcp_collaboration_control.trusted_issuer_keys",
  "mcp_collaboration_control.canonical_bootstrap_consumptions",
]);
const OWNED_RELATIONS = Object.freeze([
  ...TENANT_TABLES,
  ...RUNTIME_SEQUENCES,
  ...READONLY_RELATIONS,
  "mcp_collaboration_control.trusted_issuer_keys",
  "mcp_collaboration_control.canonical_bootstrap_consumptions",
]);

function tenantIsolationSql() {
  const policies = TENANT_TABLES.map((table) => `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_codexai_tenant_scope ON ${table};
CREATE POLICY mcp_codexai_tenant_scope ON ${table} TO PUBLIC
  USING ((tenant_id)::text = 'codexai'::text)
  WITH CHECK ((tenant_id)::text = 'codexai'::text);`).join("\n");
  return `${policies}
ALTER VIEW public.core_decision_daily_metrics SET (security_invoker=true);
ALTER FUNCTION public.core_decision_events_append_only() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.core_decision_events_append_only() FROM PUBLIC;`;
}

export const COLLABORATION_SCHEMA_SQL = Object.freeze([
  COLLABORATION_AGENT_SCHEMA_SQL,
  collaborationSharedMemorySchemaSql(),
  DECISION_LEDGER_SCHEMA_SQL,
  tenantIsolationSql(),
  collaborationTrustPinSchemaSql(),
  CANONICAL_BOOTSTRAP_SCHEMA_SQL,
]).join("\n");

export const COLLABORATION_SCHEMA_CHECKSUM = crypto.createHash("sha256")
  .update(`mcp-collaboration-schema-v3\0${COLLABORATION_SCHEMA_SQL}`)
  .digest("hex");
const COLLABORATION_RECEIPT_FUNCTION_BODY_MD5 = crypto.createHash("md5")
  .update(COLLABORATION_RECEIPT_FUNCTION_BODY)
  .digest("hex");
const COLLABORATION_TRUST_PIN_FUNCTION_BODY_MD5 = crypto.createHash("md5")
  .update(COLLABORATION_TRUST_PIN_FUNCTION_BODY)
  .digest("hex");
const CANONICAL_BOOTSTRAP_FUNCTION_BODY_MD5 = crypto.createHash("md5")
  .update(CANONICAL_BOOTSTRAP_FUNCTION_BODY)
  .digest("hex");

export class CollaborationSchemaError extends Error {
  constructor(code) {
    super(code);
    this.name = "CollaborationSchemaError";
    this.code = code;
  }
}

function fail(code) {
  throw new CollaborationSchemaError(code);
}

function validQueryable(pool) {
  return Boolean(pool) && typeof pool.query === "function";
}

function validPool(pool) {
  return validQueryable(pool) && typeof pool.connect === "function";
}

function markerMatches(row) {
  return row?.version === COLLABORATION_SCHEMA_VERSION &&
    row?.migration_id === COLLABORATION_SCHEMA_MIGRATION_ID &&
    row?.checksum === COLLABORATION_SCHEMA_CHECKSUM &&
    typeof row?.owner_role === "string" && /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(row.owner_role);
}

export async function verifyCollaborationPostgresSchema(pool, options = {}) {
  if (!validQueryable(pool)) fail("collaboration_schema_pool_invalid");
  try {
    const result = await pool.query(
      `SELECT migration.version,migration.migration_id,migration.checksum,migration.owner_role,current_user,session_user,
              to_regclass('public.agent_presence') IS NOT NULL AND
              to_regclass('public.agent_tasks') IS NOT NULL AND
              to_regclass('public.agent_messages') IS NOT NULL AND
              to_regclass('public.agent_message_quarantines') IS NOT NULL AND
              to_regclass('public.mcp_workspace_documents') IS NOT NULL AND
              to_regclass('public.mcp_workspace_document_versions') IS NOT NULL AND
              to_regclass('public.mcp_workspace_lock_leases') IS NOT NULL AND
              to_regclass('public.mcp_memory_records') IS NOT NULL AND
              to_regclass('public.mcp_memory_handoffs') IS NOT NULL AND
              to_regclass('mcp_collaboration_control.consumed_receipts') IS NOT NULL AND
              to_regclass('mcp_collaboration_control.trusted_issuer_keys') IS NOT NULL AND
              to_regclass('mcp_collaboration_control.canonical_bootstrap_consumptions') IS NOT NULL AND
              to_regclass('public.mcp_coordination_events') IS NOT NULL AND
              to_regclass('public.core_ai_work_sessions') IS NOT NULL AND
              to_regclass('public.core_decision_events') IS NOT NULL AS relations_ready,
              (SELECT count(*)=6 AND
                 count(*) FILTER (WHERE attname='tenant_id' AND format_type(atttypid,atttypmod)='character varying(64)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='issuer' AND format_type(atttypid,atttypmod)='character varying(120)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='jti' AND format_type(atttypid,atttypmod)='character varying(160)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='receipt_digest' AND format_type(atttypid,atttypmod)='character(64)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='action_digest' AND format_type(atttypid,atttypmod)='character(64)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='consumed_at' AND format_type(atttypid,atttypmod)='timestamp with time zone' AND attnotnull)=1
               FROM pg_attribute
               WHERE attrelid=receipt_table.oid AND attnum>0 AND NOT attisdropped) AS receipt_shape_ready,
              (SELECT count(*)=6 AND
                 count(*) FILTER (WHERE attname='authority' AND format_type(atttypid,atttypmod)='character varying(16)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='issuer' AND format_type(atttypid,atttypmod)='character varying(120)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='kid' AND format_type(atttypid,atttypmod)='character varying(96)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='jwk_digest' AND format_type(atttypid,atttypmod)='character(64)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='pinned_build_commit' AND format_type(atttypid,atttypmod)='character(40)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='pinned_at' AND format_type(atttypid,atttypmod)='timestamp with time zone' AND attnotnull)=1
               FROM pg_attribute
               WHERE attrelid=trust_table.oid AND attnum>0 AND NOT attisdropped) AS trust_shape_ready,
              (SELECT count(*)=18 AND
                 count(*) FILTER (WHERE attname='tenant_id' AND format_type(atttypid,atttypmod)='character varying(64)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='consumption_id' AND format_type(atttypid,atttypmod)='character varying(108)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='bootstrap_id' AND format_type(atttypid,atttypmod)='character varying(96)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='bundle_sha256' AND format_type(atttypid,atttypmod)='character(64)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='canonical_paths_sha256' AND format_type(atttypid,atttypmod)='character(64)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='approval_jti_sha256' AND format_type(atttypid,atttypmod)='character(64)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='approval_evidence_sha256' AND format_type(atttypid,atttypmod)='character(64)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='core_receipt_digest' AND format_type(atttypid,atttypmod)='character(64)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='nyra_receipt_digest' AND format_type(atttypid,atttypmod)='character(64)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='executor_service' AND format_type(atttypid,atttypmod)='character varying(120)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='control_role' AND format_type(atttypid,atttypmod)='name' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='target_service' AND format_type(atttypid,atttypmod)='character varying(120)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='target_environment' AND format_type(atttypid,atttypmod)='character varying(40)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='target_database' AND format_type(atttypid,atttypmod)='character varying(120)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='target_commit' AND format_type(atttypid,atttypmod)='character(40)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='document_count' AND format_type(atttypid,atttypmod)='smallint' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='audit_sha256' AND format_type(atttypid,atttypmod)='character(64)' AND attnotnull)=1 AND
                 count(*) FILTER (WHERE attname='consumed_at' AND format_type(atttypid,atttypmod)='timestamp with time zone' AND attnotnull)=1
               FROM pg_attribute
               WHERE attrelid=canonical_table.oid AND attnum>0 AND NOT attisdropped) AS canonical_shape_ready,
              EXISTS (
                SELECT 1 FROM pg_constraint receipt_pk
                CROSS JOIN LATERAL (
                  SELECT array_agg(attribute.attname::text ORDER BY key_column.ordinality) AS key_names
                  FROM unnest(receipt_pk.conkey) WITH ORDINALITY AS key_column(attnum,ordinality)
                  JOIN pg_attribute attribute
                    ON attribute.attrelid=receipt_pk.conrelid AND attribute.attnum=key_column.attnum
                ) primary_key_columns
                WHERE receipt_pk.conrelid=receipt_table.oid AND receipt_pk.contype='p'
                  AND primary_key_columns.key_names=ARRAY['tenant_id','issuer','jti']::text[]
              ) AS receipt_primary_key_ready,
              (SELECT count(*)=5 AND
                 count(*) FILTER (
                   WHERE canonical_constraint.contype='p' AND
                     canonical_key_columns.key_names=ARRAY['tenant_id']::text[]
                 )=1 AND
                 count(*) FILTER (
                   WHERE canonical_constraint.contype='u' AND
                     canonical_key_columns.key_names=ARRAY['consumption_id']::text[]
                 )=1 AND
                 count(*) FILTER (
                   WHERE canonical_constraint.contype='u' AND
                     canonical_key_columns.key_names=ARRAY['bootstrap_id']::text[]
                 )=1 AND
                 count(*) FILTER (
                   WHERE canonical_constraint.contype='u' AND
                     canonical_key_columns.key_names=ARRAY['bundle_sha256']::text[]
                 )=1 AND
                 count(*) FILTER (
                   WHERE canonical_constraint.contype='u' AND
                     canonical_key_columns.key_names=ARRAY['approval_jti_sha256']::text[]
                 )=1
               FROM pg_constraint canonical_constraint
               CROSS JOIN LATERAL (
                 SELECT array_agg(attribute.attname::text ORDER BY key_column.ordinality) AS key_names
                 FROM unnest(canonical_constraint.conkey) WITH ORDINALITY AS key_column(attnum,ordinality)
                 JOIN pg_attribute attribute
                   ON attribute.attrelid=canonical_constraint.conrelid AND attribute.attnum=key_column.attnum
               ) canonical_key_columns
               WHERE canonical_constraint.conrelid=canonical_table.oid
                 AND canonical_constraint.contype IN ('p','u')) AS canonical_keys_ready,
              (SELECT count(*)=1 AND bool_and(
                 tgname='no_mutation_consumed_receipts' AND tgenabled='O' AND tgtype=27 AND
                 tgfoid=to_regprocedure('public.mcp_reject_append_only_mutation()')
               ) FROM pg_trigger
               WHERE tgrelid=to_regclass('mcp_collaboration_control.consumed_receipts')
                 AND NOT tgisinternal) AS receipt_append_only,
              (SELECT count(*)=1 AND bool_and(
                 tgname='no_mutation_trusted_issuer_keys' AND tgenabled='O' AND tgtype=58 AND
                 tgfoid=to_regprocedure('public.mcp_reject_append_only_mutation()')
               ) FROM pg_trigger
               WHERE tgrelid=to_regclass('mcp_collaboration_control.trusted_issuer_keys')
                 AND NOT tgisinternal) AS trust_append_only,
              (SELECT count(*)=1 AND bool_and(
                 tgname='core_decision_events_no_mutation' AND tgenabled='O' AND tgtype=27 AND
                 tgfoid=to_regprocedure('public.core_decision_events_append_only()')
               ) FROM pg_trigger
               WHERE tgrelid=to_regclass('public.core_decision_events')
                 AND NOT tgisinternal) AS ledger_append_only,
              (SELECT count(*)=1 AND bool_and(
                 tgname='canonical_bootstrap_consumptions_no_mutation' AND
                 tgenabled='O' AND tgtype=58 AND
                 tgfoid=to_regprocedure('mcp_collaboration_control.reject_canonical_bootstrap_mutation()')
               ) FROM pg_trigger
               WHERE tgrelid=canonical_table.oid AND NOT tgisinternal) AS canonical_append_only,
              receipt_function.prosecdef=true AND
                receipt_function.proisstrict=true AND receipt_function.provolatile='v' AND
                receipt_function.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND
                receipt_function.proconfig=ARRAY['search_path=pg_catalog, mcp_collaboration_control, pg_temp']::text[] AND
                md5(receipt_function.prosrc)=$5 AS receipt_function_hardened,
              trust_function.prosecdef=true AND
                trust_function.proisstrict=true AND trust_function.provolatile='v' AND
                trust_function.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND
                trust_function.proconfig=ARRAY['search_path=pg_catalog, mcp_collaboration_control, pg_temp']::text[] AND
                md5(trust_function.prosrc)=$12 AS trust_function_hardened,
              canonical_function.prosecdef=false AND
                canonical_function.proisstrict=false AND canonical_function.provolatile='v' AND
                canonical_function.pronargs=0 AND
                canonical_function.prorettype=to_regtype('trigger') AND
                canonical_function.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND
                canonical_function.proconfig=ARRAY['search_path=pg_catalog, mcp_collaboration_control, pg_temp']::text[] AND
                md5(canonical_function.prosrc)=$13 AS canonical_function_hardened,
              NOT EXISTS (
                SELECT 1 FROM aclexplode(COALESCE(receipt_function.proacl,acldefault('f',receipt_function.proowner))) acl
                WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
              ) AS receipt_public_execute_denied,
              NOT EXISTS (
                SELECT 1 FROM aclexplode(COALESCE(trust_function.proacl,acldefault('f',trust_function.proowner))) acl
                WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
              ) AS trust_public_execute_denied,
              NOT EXISTS (
                SELECT 1 FROM aclexplode(COALESCE(canonical_function.proacl,acldefault('f',canonical_function.proowner))) acl
                WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
              ) AS canonical_public_execute_denied,
              NOT EXISTS (
                SELECT 1 FROM aclexplode(COALESCE(receipt_table.relacl,acldefault('r',receipt_table.relowner))) acl
                WHERE acl.grantee NOT IN (
                  receipt_table.relowner,
                  (SELECT oid FROM pg_roles WHERE rolname=current_user)
                )
              ) AND NOT EXISTS (
                SELECT 1 FROM aclexplode(COALESCE(receipt_function.proacl,acldefault('f',receipt_function.proowner))) acl
                WHERE acl.grantee NOT IN (
                  receipt_function.proowner,
                  (SELECT oid FROM pg_roles WHERE rolname=current_user)
                )
              ) AS receipt_acl_exclusive,
              NOT EXISTS (
                SELECT 1 FROM aclexplode(COALESCE(trust_table.relacl,acldefault('r',trust_table.relowner))) acl
                WHERE acl.grantee NOT IN (
                  trust_table.relowner,
                  (SELECT oid FROM pg_roles WHERE rolname=current_user)
                )
              ) AND NOT EXISTS (
                SELECT 1 FROM aclexplode(COALESCE(trust_function.proacl,acldefault('f',trust_function.proowner))) acl
                WHERE acl.grantee NOT IN (
                  trust_function.proowner,
                  (SELECT oid FROM pg_roles WHERE rolname=current_user)
                )
              ) AS trust_acl_exclusive,
              NOT EXISTS (
                SELECT 1 FROM aclexplode(COALESCE(canonical_table.relacl,acldefault('r',canonical_table.relowner))) acl
                WHERE acl.grantee<>canonical_table.relowner
              ) AND NOT EXISTS (
                SELECT 1 FROM aclexplode(COALESCE(canonical_function.proacl,acldefault('f',canonical_function.proowner))) acl
                WHERE acl.grantee<>canonical_function.proowner
              ) AS canonical_acl_exclusive,
              current_user=migration.owner_role AND session_user=migration.owner_role AS control_plane_identity_ready,
              pg_get_userbyid(control_schema.nspowner)=migration.owner_role AND
                pg_get_userbyid(receipt_table.relowner)=migration.owner_role AND
                pg_get_userbyid(receipt_function.proowner)=migration.owner_role AND
                pg_get_userbyid(trust_table.relowner)=migration.owner_role AND
                pg_get_userbyid(trust_function.proowner)=migration.owner_role AND
                pg_get_userbyid(canonical_table.relowner)=migration.owner_role AND
                pg_get_userbyid(canonical_function.proowner)=migration.owner_role AND
                pg_get_userbyid(migration_table.relowner)=migration.owner_role AND
                (SELECT count(*)=$10::integer
                 FROM pg_class owned_relation
                 JOIN pg_namespace owned_schema ON owned_schema.oid=owned_relation.relnamespace
                 WHERE owned_schema.nspname || '.' || owned_relation.relname=ANY($9::text[])
                   AND pg_get_userbyid(owned_relation.relowner)=migration.owner_role) AND
                (SELECT count(*)=5 FROM pg_proc owned_function
                 WHERE owned_function.oid=ANY(ARRAY[
                   to_regprocedure('mcp_collaboration_control.consume_receipt_pair(character varying,character varying,character,timestamp with time zone,timestamp with time zone,character varying,character,character varying,character)'),
                   to_regprocedure('mcp_collaboration_control.pin_or_verify_issuer_pair(character varying,character,character varying,character,character)'),
                   to_regprocedure('mcp_collaboration_control.reject_canonical_bootstrap_mutation()'),
                   to_regprocedure('public.mcp_reject_append_only_mutation()'),
                   to_regprocedure('public.core_decision_events_append_only()')
                 ]::oid[]) AND pg_get_userbyid(owned_function.proowner)=migration.owner_role)
                AS trusted_ownership_ready,
              pg_get_userbyid(receipt_table.relowner) <> current_user AS runtime_role_separated,
              pg_get_userbyid(receipt_function.proowner) <> current_user AS receipt_function_owner_separated,
              pg_get_userbyid(trust_table.relowner) <> current_user AND
                pg_get_userbyid(trust_function.proowner) <> current_user AS trust_owner_separated,
              pg_get_userbyid(canonical_table.relowner) <> current_user AND
                pg_get_userbyid(canonical_function.proowner) <> current_user AS canonical_owner_separated,
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.consumed_receipts','SELECT') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.consumed_receipts','INSERT') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.consumed_receipts','UPDATE') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.consumed_receipts','DELETE') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.consumed_receipts','TRUNCATE') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.consumed_receipts','TRIGGER') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.consumed_receipts','REFERENCES') AS receipt_direct_dml_denied,
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.trusted_issuer_keys','SELECT') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.trusted_issuer_keys','INSERT') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.trusted_issuer_keys','UPDATE') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.trusted_issuer_keys','DELETE') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.trusted_issuer_keys','TRUNCATE') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.trusted_issuer_keys','TRIGGER') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.trusted_issuer_keys','REFERENCES') AS trust_direct_dml_denied,
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.canonical_bootstrap_consumptions','SELECT') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.canonical_bootstrap_consumptions','INSERT') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.canonical_bootstrap_consumptions','UPDATE') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.canonical_bootstrap_consumptions','DELETE') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.canonical_bootstrap_consumptions','TRUNCATE') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.canonical_bootstrap_consumptions','TRIGGER') AND
              NOT has_table_privilege(current_user,
                'mcp_collaboration_control.canonical_bootstrap_consumptions','REFERENCES') AS canonical_direct_access_denied,
              NOT has_function_privilege(
                current_user,
                to_regprocedure('mcp_collaboration_control.reject_canonical_bootstrap_mutation()'),
                'EXECUTE'
              ) AS canonical_function_execute_denied,
              NOT has_schema_privilege(current_user,'public','CREATE') AND
                NOT has_schema_privilege(current_user,'mcp_collaboration_control','CREATE') AS runtime_schema_create_denied,
              pg_catalog.regexp_replace(
                pg_catalog.current_setting('search_path'),'[[:space:]]+','','g'
              )='pg_catalog,public,pg_temp' AS runtime_search_path_ready,
              NOT EXISTS (
                SELECT 1
                FROM pg_namespace guarded_schema
                CROSS JOIN LATERAL pg_catalog.aclexplode(
                  COALESCE(guarded_schema.nspacl,pg_catalog.acldefault('n',guarded_schema.nspowner))
                ) acl
                WHERE guarded_schema.nspname IN ('public','mcp_collaboration_control')
                  AND acl.privilege_type='CREATE'
                  AND acl.grantee<>guarded_schema.nspowner
              ) AS schema_create_acl_exclusive,
              current_setting('row_security')='on' AS runtime_row_security_on,
              EXISTS (
                SELECT 1 FROM pg_roles runtime_role
                WHERE runtime_role.rolname=current_user AND runtime_role.rolcanlogin=true AND
                  runtime_role.rolsuper=false AND runtime_role.rolcreatedb=false AND
                  runtime_role.rolcreaterole=false AND runtime_role.rolreplication=false AND
                  runtime_role.rolbypassrls=false AND runtime_role.rolinherit=false AND
                  NOT EXISTS (
                    SELECT 1 FROM pg_auth_members membership
                    WHERE membership.member=runtime_role.oid OR membership.roleid=runtime_role.oid
                  )
              ) AS runtime_role_safe,
              NOT EXISTS (
                SELECT 1 FROM unnest($4::text[]) AS guarded_relation(relation_name)
                WHERE has_table_privilege(current_user,guarded_relation.relation_name,'DELETE')
                   OR has_table_privilege(current_user,guarded_relation.relation_name,'TRUNCATE')
                   OR has_table_privilege(current_user,guarded_relation.relation_name,'TRIGGER')
                   OR has_table_privilege(current_user,guarded_relation.relation_name,'REFERENCES')
              ) AS destructive_privileges_denied,
              NOT EXISTS (
                SELECT 1 FROM unnest($6::text[]) AS mutable_relation(relation_name)
                WHERE NOT has_table_privilege(current_user,mutable_relation.relation_name,'SELECT')
                   OR NOT has_table_privilege(current_user,mutable_relation.relation_name,'INSERT')
                   OR NOT has_table_privilege(current_user,mutable_relation.relation_name,'UPDATE')
              ) AND NOT EXISTS (
                SELECT 1 FROM unnest($7::text[]) AS append_relation(relation_name)
                WHERE NOT has_table_privilege(current_user,append_relation.relation_name,'SELECT')
                   OR NOT has_table_privilege(current_user,append_relation.relation_name,'INSERT')
                   OR has_table_privilege(current_user,append_relation.relation_name,'UPDATE')
              ) AND NOT EXISTS (
                SELECT 1 FROM unnest($8::text[]) AS runtime_sequence(relation_name)
                WHERE NOT has_sequence_privilege(current_user,runtime_sequence.relation_name,'USAGE')
                   OR NOT has_sequence_privilege(current_user,runtime_sequence.relation_name,'SELECT')
                   OR has_sequence_privilege(current_user,runtime_sequence.relation_name,'UPDATE')
              ) AND NOT EXISTS (
                SELECT 1 FROM unnest($11::text[]) AS readonly_relation(relation_name)
                WHERE NOT has_table_privilege(current_user,readonly_relation.relation_name,'SELECT')
                   OR has_table_privilege(current_user,readonly_relation.relation_name,'INSERT')
                   OR has_table_privilege(current_user,readonly_relation.relation_name,'UPDATE')
                   OR has_table_privilege(current_user,readonly_relation.relation_name,'DELETE')
                   OR has_table_privilege(current_user,readonly_relation.relation_name,'TRUNCATE')
                   OR has_table_privilege(current_user,readonly_relation.relation_name,'TRIGGER')
                   OR has_table_privilege(current_user,readonly_relation.relation_name,'REFERENCES')
              ) AS runtime_privileges_exact,
              NOT EXISTS (
                SELECT 1 FROM pg_class guarded_object
                JOIN pg_namespace guarded_schema ON guarded_schema.oid=guarded_object.relnamespace
                CROSS JOIN LATERAL aclexplode(COALESCE(guarded_object.relacl,ARRAY[]::aclitem[])) acl
                WHERE guarded_schema.nspname || '.' || guarded_object.relname=ANY($9::text[])
                  AND acl.grantee NOT IN (
                    guarded_object.relowner,
                    (SELECT oid FROM pg_roles WHERE rolname=current_user)
                  )
              ) AS runtime_acl_exclusive,
              NOT EXISTS (
                SELECT 1
                FROM pg_class guarded_object
                JOIN pg_namespace guarded_schema ON guarded_schema.oid=guarded_object.relnamespace
                CROSS JOIN LATERAL pg_catalog.aclexplode(
                  COALESCE(guarded_object.relacl,ARRAY[]::aclitem[])
                ) acl
                WHERE guarded_schema.nspname || '.' || guarded_object.relname=ANY($9::text[])
                  AND acl.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user)
                  AND acl.is_grantable
              ) AND NOT EXISTS (
                SELECT 1
                FROM pg_namespace guarded_schema
                CROSS JOIN LATERAL pg_catalog.aclexplode(
                  COALESCE(guarded_schema.nspacl,ARRAY[]::aclitem[])
                ) acl
                WHERE guarded_schema.nspname IN ('public','mcp_collaboration_control')
                  AND acl.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user)
                  AND acl.is_grantable
              ) AND NOT EXISTS (
                SELECT 1
                FROM pg_proc guarded_function
                CROSS JOIN LATERAL pg_catalog.aclexplode(
                  COALESCE(guarded_function.proacl,ARRAY[]::aclitem[])
                ) acl
                WHERE guarded_function.oid=to_regprocedure(
                  'mcp_collaboration_control.consume_receipt_pair(character varying,character varying,character,timestamp with time zone,timestamp with time zone,character varying,character,character varying,character)'
                )
                  AND acl.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user)
                  AND acl.is_grantable
              ) AND NOT EXISTS (
                SELECT 1
                FROM pg_proc guarded_function
                CROSS JOIN LATERAL pg_catalog.aclexplode(
                  COALESCE(guarded_function.proacl,ARRAY[]::aclitem[])
                ) acl
                WHERE guarded_function.oid=to_regprocedure(
                  'mcp_collaboration_control.pin_or_verify_issuer_pair(character varying,character,character varying,character,character)'
                )
                  AND acl.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user)
                  AND acl.is_grantable
              ) AS runtime_grant_options_denied,
              has_function_privilege(current_user,
                to_regprocedure('mcp_collaboration_control.consume_receipt_pair(character varying,character varying,character,timestamp with time zone,timestamp with time zone,character varying,character,character varying,character)'),
                'EXECUTE') AS receipt_consumer_executable,
              has_function_privilege(current_user,
                to_regprocedure('mcp_collaboration_control.pin_or_verify_issuer_pair(character varying,character,character varying,character,character)'),
                'EXECUTE') AS trust_pin_executable,
              (SELECT count(*)=$2::integer
               FROM pg_class tenant_table
               JOIN pg_namespace tenant_schema ON tenant_schema.oid=tenant_table.relnamespace
               WHERE tenant_schema.nspname || '.' || tenant_table.relname=ANY($3::text[])
                 AND tenant_table.relrowsecurity AND tenant_table.relforcerowsecurity
                 AND (SELECT count(*) FROM pg_policy WHERE polrelid=tenant_table.oid)=1
                 AND EXISTS (
                   SELECT 1 FROM pg_policy
                   WHERE polrelid=tenant_table.oid AND polname='mcp_codexai_tenant_scope'
                     AND polcmd='*' AND polpermissive=true AND polroles=ARRAY[0]::oid[]
                     AND regexp_replace(pg_get_expr(polqual,polrelid),'[[:space:]]+','','g')=
                       '((tenant_id)::text=''codexai''::text)'
                     AND regexp_replace(pg_get_expr(polwithcheck,polrelid),'[[:space:]]+','','g')=
                       '((tenant_id)::text=''codexai''::text)'
                 )) AS tenant_isolation_ready,
              EXISTS (
                SELECT 1 FROM pg_class decision_view
                WHERE decision_view.oid=to_regclass('public.core_decision_daily_metrics')
                  AND decision_view.relkind='v'
                  AND decision_view.reloptions @> ARRAY['security_invoker=true']::text[]
              ) AS decision_view_security_invoker
       FROM public.mcp_collaboration_schema_migrations migration
       JOIN pg_class migration_table
         ON migration_table.oid=to_regclass('public.mcp_collaboration_schema_migrations')
       JOIN pg_class receipt_table
         ON receipt_table.oid=to_regclass('mcp_collaboration_control.consumed_receipts')
       JOIN pg_class trust_table
         ON trust_table.oid=to_regclass('mcp_collaboration_control.trusted_issuer_keys')
       JOIN pg_class canonical_table
         ON canonical_table.oid=to_regclass('mcp_collaboration_control.canonical_bootstrap_consumptions')
       JOIN pg_namespace control_schema
         ON control_schema.oid=to_regnamespace('mcp_collaboration_control')
       JOIN pg_proc receipt_function
         ON receipt_function.oid=to_regprocedure('mcp_collaboration_control.consume_receipt_pair(character varying,character varying,character,timestamp with time zone,timestamp with time zone,character varying,character,character varying,character)')
       JOIN pg_proc trust_function
         ON trust_function.oid=to_regprocedure('mcp_collaboration_control.pin_or_verify_issuer_pair(character varying,character,character varying,character,character)')
       JOIN pg_proc canonical_function
         ON canonical_function.oid=to_regprocedure('mcp_collaboration_control.reject_canonical_bootstrap_mutation()')
       WHERE migration.version=$1`,
      [
        COLLABORATION_SCHEMA_VERSION,
        TENANT_TABLES.length,
        TENANT_TABLES,
        DESTRUCTIVE_GUARDED_RELATIONS,
        COLLABORATION_RECEIPT_FUNCTION_BODY_MD5,
        MUTABLE_TABLES,
        APPEND_TABLES,
        RUNTIME_SEQUENCES,
        OWNED_RELATIONS,
        OWNED_RELATIONS.length,
        READONLY_RELATIONS,
        COLLABORATION_TRUST_PIN_FUNCTION_BODY_MD5,
        CANONICAL_BOOTSTRAP_FUNCTION_BODY_MD5,
      ],
    );
    const row = result.rows?.[0];
    if (result.rowCount !== 1 || !markerMatches(row) ||
        row.relations_ready !== true || row.receipt_shape_ready !== true ||
        row.trust_shape_ready !== true ||
        row.canonical_shape_ready !== true ||
        row.receipt_primary_key_ready !== true || row.receipt_append_only !== true ||
        row.canonical_keys_ready !== true ||
        row.trust_append_only !== true ||
        row.ledger_append_only !== true || row.canonical_append_only !== true ||
        row.receipt_function_hardened !== true ||
        row.trust_function_hardened !== true ||
        row.canonical_function_hardened !== true ||
        row.receipt_public_execute_denied !== true ||
        row.trust_public_execute_denied !== true ||
        row.canonical_public_execute_denied !== true ||
        row.tenant_isolation_ready !== true ||
        row.decision_view_security_invoker !== true || row.trusted_ownership_ready !== true ||
        row.schema_create_acl_exclusive !== true ||
        row.canonical_acl_exclusive !== true ||
        (options.controlPlane === true
          ? row.control_plane_identity_ready !== true
          : (row.current_user !== options.expectedRuntimeRole || row.session_user !== options.expectedRuntimeRole ||
          row.runtime_role_separated !== true ||
          row.receipt_function_owner_separated !== true ||
          row.trust_owner_separated !== true ||
          row.canonical_owner_separated !== true ||
          row.receipt_direct_dml_denied !== true ||
          row.trust_direct_dml_denied !== true ||
          row.canonical_direct_access_denied !== true ||
          row.canonical_function_execute_denied !== true ||
          row.runtime_schema_create_denied !== true || row.runtime_search_path_ready !== true ||
          row.runtime_row_security_on !== true ||
          row.runtime_role_safe !== true || row.destructive_privileges_denied !== true ||
          row.runtime_privileges_exact !== true || row.runtime_acl_exclusive !== true ||
          row.runtime_grant_options_denied !== true ||
          row.receipt_consumer_executable !== true ||
          row.trust_pin_executable !== true ||
          row.receipt_acl_exclusive !== true ||
          row.trust_acl_exclusive !== true))) {
      fail("collaboration_schema_not_ready");
    }
    return Object.freeze({
      ready: true,
      version: COLLABORATION_SCHEMA_VERSION,
      migration_id: COLLABORATION_SCHEMA_MIGRATION_ID,
      checksum: COLLABORATION_SCHEMA_CHECKSUM,
    });
  } catch (error) {
    if (error instanceof CollaborationSchemaError) throw error;
    fail("collaboration_schema_not_ready");
  }
}

export async function applyCollaborationPostgresMigration(pool, options = {}) {
  if (options.controlPlane !== true) fail("collaboration_schema_control_plane_required");
  if (!validPool(pool)) fail("collaboration_schema_pool_invalid");
  const client = await pool.connect();
  let verified;
  try {
    await client.query("BEGIN");
    // The canonical DDL intentionally creates its unqualified application objects
    // in public. Runtime connections use pg_catalog first; this control-plane
    // transaction needs public as the current creation schema.
    await client.query("SET LOCAL search_path = public, pg_catalog, pg_temp");
    await client.query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))", [ADVISORY_LOCK_KEY]);
    await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await client.query(`CREATE TABLE IF NOT EXISTS public.mcp_collaboration_schema_migrations (
      version integer PRIMARY KEY CHECK (version > 0),
      migration_id varchar(120) NOT NULL UNIQUE,
      checksum char(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
      owner_role name NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
    await client.query("ALTER TABLE public.mcp_collaboration_schema_migrations OWNER TO CURRENT_USER");
    const existing = await client.query(
      `SELECT version,migration_id,checksum,owner_role
       FROM public.mcp_collaboration_schema_migrations
       WHERE version=$1 OR migration_id=$2
       FOR UPDATE`,
      [COLLABORATION_SCHEMA_VERSION, COLLABORATION_SCHEMA_MIGRATION_ID],
    );
    if (existing.rowCount > 0) {
      if (existing.rowCount !== 1 || !markerMatches(existing.rows[0])) fail("collaboration_schema_checksum_mismatch");
    } else {
      await client.query(COLLABORATION_SCHEMA_SQL);
      await client.query(
        `INSERT INTO public.mcp_collaboration_schema_migrations (version,migration_id,checksum,owner_role)
         VALUES ($1,$2,$3,current_user)`,
        [COLLABORATION_SCHEMA_VERSION, COLLABORATION_SCHEMA_MIGRATION_ID, COLLABORATION_SCHEMA_CHECKSUM],
      );
    }
    verified = await verifyCollaborationPostgresSchema(client, { controlPlane: true });
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    if (error instanceof CollaborationSchemaError) throw error;
    fail("collaboration_schema_migration_failed");
  } finally {
    client.release();
  }
  return verified;
}

function quoteIdentifier(value) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(normalized)) fail("collaboration_runtime_role_invalid");
  return `"${normalized.replaceAll('"', '""')}"`;
}

export async function configureCollaborationRuntimeRole(pool, runtimeRole, options = {}) {
  if (options.controlPlane !== true) fail("collaboration_schema_control_plane_required");
  if (!validPool(pool)) fail("collaboration_schema_pool_invalid");
  const role = String(runtimeRole || "").trim();
  const quotedRole = quoteIdentifier(role);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = pg_catalog, public, pg_temp");
    await client.query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))", [ADVISORY_LOCK_KEY]);
    const roleState = await client.query(
      `SELECT current_user,role.rolname,role.rolcanlogin,role.rolsuper,role.rolcreatedb,
              role.rolcreaterole,role.rolreplication,role.rolbypassrls,role.rolinherit,
              (SELECT count(*)::integer FROM pg_auth_members membership
               WHERE membership.member=role.oid OR membership.roleid=role.oid) AS membership_count
       FROM pg_roles role WHERE role.rolname=$1`,
      [role],
    );
    const row = roleState.rows?.[0];
    if (roleState.rowCount !== 1 || row.current_user === role || row.rolcanlogin !== true ||
        row.rolsuper !== false || row.rolcreatedb !== false || row.rolcreaterole !== false ||
        row.rolreplication !== false || row.rolbypassrls !== false || row.rolinherit !== false ||
        row.membership_count !== 0) {
      fail("collaboration_runtime_role_unsafe");
    }
    await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await client.query(`REVOKE ALL ON SCHEMA public,mcp_collaboration_control FROM ${quotedRole}`);
    await client.query(`GRANT USAGE ON SCHEMA public,mcp_collaboration_control TO ${quotedRole}`);
    await client.query(`REVOKE ALL ON TABLE ${[...MUTABLE_TABLES, ...APPEND_TABLES,
      "public.mcp_collaboration_schema_migrations", "public.core_decision_daily_metrics"].join(",")} FROM ${quotedRole}`);
    await client.query(`REVOKE ALL ON SEQUENCE ${RUNTIME_SEQUENCES.join(",")} FROM ${quotedRole}`);
    await client.query(`REVOKE ALL ON FUNCTION mcp_collaboration_control.consume_receipt_pair(
      varchar,varchar,char,timestamptz,timestamptz,varchar,char,varchar,char
    ) FROM ${quotedRole}`);
    await client.query(`REVOKE ALL ON TABLE mcp_collaboration_control.trusted_issuer_keys FROM ${quotedRole}`);
    await client.query(`REVOKE ALL ON FUNCTION mcp_collaboration_control.pin_or_verify_issuer_pair(
      varchar,char,varchar,char,char
    ) FROM ${quotedRole}`);
    await client.query(`REVOKE ALL ON TABLE mcp_collaboration_control.canonical_bootstrap_consumptions FROM ${quotedRole}`);
    await client.query(`REVOKE ALL ON FUNCTION mcp_collaboration_control.reject_canonical_bootstrap_mutation()
      FROM ${quotedRole}`);
    await client.query(`GRANT SELECT,INSERT,UPDATE ON TABLE ${MUTABLE_TABLES.join(",")} TO ${quotedRole}`);
    await client.query(`GRANT SELECT,INSERT ON TABLE ${APPEND_TABLES.join(",")} TO ${quotedRole}`);
    await client.query(`GRANT SELECT ON TABLE public.mcp_collaboration_schema_migrations,public.core_decision_daily_metrics TO ${quotedRole}`);
    await client.query(`GRANT USAGE,SELECT ON SEQUENCE ${RUNTIME_SEQUENCES.join(",")} TO ${quotedRole}`);
    await client.query(`REVOKE ALL ON TABLE mcp_collaboration_control.consumed_receipts FROM ${quotedRole}`);
    await client.query(`GRANT EXECUTE ON FUNCTION mcp_collaboration_control.consume_receipt_pair(
      varchar,varchar,char,timestamptz,timestamptz,varchar,char,varchar,char
    ) TO ${quotedRole}`);
    await client.query(`GRANT EXECUTE ON FUNCTION mcp_collaboration_control.pin_or_verify_issuer_pair(
      varchar,char,varchar,char,char
    ) TO ${quotedRole}`);
    await client.query(`ALTER ROLE ${quotedRole} SET search_path = pg_catalog, public, pg_temp`);
    await client.query(`ALTER ROLE ${quotedRole} SET row_security = on`);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    if (error instanceof CollaborationSchemaError) throw error;
    fail("collaboration_runtime_role_configuration_failed");
  } finally {
    client.release();
  }
  return Object.freeze({ configured: true, role });
}

export const collaborationSchemaContract = Object.freeze({
  version: COLLABORATION_SCHEMA_VERSION,
  migration_id: COLLABORATION_SCHEMA_MIGRATION_ID,
  checksum: COLLABORATION_SCHEMA_CHECKSUM,
  required_relations: REQUIRED_RELATIONS,
});
