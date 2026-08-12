-- Causal Continuity foundation v1. Additive and PostgreSQL 16 compatible.
-- Canonical runtime SQL: CAUSAL_CONTINUITY_SCHEMA_SQL in causal-continuity-store.js.
-- This migration deliberately performs no legacy backfill: causality must be explicit.
BEGIN;

CREATE TABLE IF NOT EXISTS causal_project (
  tenant_id varchar(64) NOT NULL, project_id varchar(128) NOT NULL,
  project_name text NOT NULL, project_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, project_id)
);
CREATE TABLE IF NOT EXISTS causal_genesis_intent (
  tenant_id varchar(64) NOT NULL, project_id varchar(128) NOT NULL, genesis_id uuid NOT NULL,
  intent_digest char(64) NOT NULL, intent_document jsonb NOT NULL,
  source_kind varchar(32) NOT NULL DEFAULT 'explicit', created_by_actor_id varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, genesis_id),
  UNIQUE (tenant_id, project_id), UNIQUE (tenant_id, project_id, genesis_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES causal_project (tenant_id, project_id),
  CHECK (source_kind = 'explicit')
);
CREATE TABLE IF NOT EXISTS causal_intent_revision (
  tenant_id varchar(64) NOT NULL, project_id varchar(128) NOT NULL, revision_id uuid NOT NULL,
  genesis_id uuid NOT NULL, revision_number integer NOT NULL CHECK (revision_number > 0),
  previous_revision_digest char(64), revision_digest char(64) NOT NULL,
  revision_document jsonb NOT NULL, change_reason text NOT NULL,
  authorized_by_actor_id varchar(160) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, revision_id), UNIQUE (tenant_id, project_id, revision_number),
  UNIQUE (tenant_id, project_id, revision_id),
  FOREIGN KEY (tenant_id, project_id, genesis_id)
    REFERENCES causal_genesis_intent (tenant_id, project_id, genesis_id),
  CHECK ((revision_number = 1 AND previous_revision_digest IS NULL) OR
         (revision_number > 1 AND previous_revision_digest IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS causal_operation (
  tenant_id varchar(64) NOT NULL, project_id varchar(128) NOT NULL, operation_id uuid NOT NULL,
  operation_kind varchar(32) NOT NULL, operation_ref varchar(240) NOT NULL,
  intent_revision_id uuid NOT NULL, request_digest char(64) NOT NULL,
  lifecycle_state varchar(24) NOT NULL DEFAULT 'DECLARED', declared_by_actor_id varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, operation_id),
  UNIQUE (tenant_id, project_id, operation_ref), UNIQUE (tenant_id, project_id, operation_id),
  FOREIGN KEY (tenant_id, project_id, intent_revision_id)
    REFERENCES causal_intent_revision (tenant_id, project_id, revision_id),
  CHECK (operation_kind IN ('WORK','CHANGE')),
  CHECK (lifecycle_state IN ('DECLARED','EXECUTED','VERIFIED','CLOSED','REOPENED'))
);
CREATE TABLE IF NOT EXISTS causal_record (
  tenant_id varchar(64) NOT NULL, project_id varchar(128) NOT NULL, record_id uuid NOT NULL,
  operation_id uuid, sequence_number bigint NOT NULL CHECK (sequence_number > 0),
  record_type varchar(64) NOT NULL, subject_type varchar(32) NOT NULL,
  subject_id varchar(240) NOT NULL, payload jsonb NOT NULL, payload_digest char(64) NOT NULL,
  previous_record_hash char(64), record_hash char(64) NOT NULL, actor_id varchar(160) NOT NULL,
  actor_kind varchar(32) NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, record_id), UNIQUE (tenant_id, project_id, sequence_number),
  UNIQUE (tenant_id, project_id, record_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES causal_project (tenant_id, project_id),
  FOREIGN KEY (tenant_id, project_id, operation_id)
    REFERENCES causal_operation (tenant_id, project_id, operation_id),
  CHECK (actor_kind IN ('owner','core','agent','system'))
);
CREATE INDEX IF NOT EXISTS causal_record_operation_idx
  ON causal_record (tenant_id, project_id, operation_id, sequence_number);
CREATE TABLE IF NOT EXISTS causal_idempotency (
  tenant_id varchar(64) NOT NULL, project_id varchar(128) NOT NULL,
  scope_kind varchar(16) NOT NULL, scope_id varchar(240) NOT NULL,
  operation_id uuid, idempotency_key varchar(160) NOT NULL,
  request_digest char(64) NOT NULL, response_document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, scope_kind, scope_id, idempotency_key),
  FOREIGN KEY (tenant_id, project_id) REFERENCES causal_project (tenant_id, project_id),
  FOREIGN KEY (tenant_id, project_id, operation_id)
    REFERENCES causal_operation (tenant_id, project_id, operation_id),
  CHECK ((scope_kind = 'PROJECT' AND operation_id IS NULL AND scope_id = project_id) OR
         (scope_kind = 'OPERATION' AND operation_id IS NOT NULL AND scope_id = operation_id::text))
);
CREATE UNIQUE INDEX IF NOT EXISTS causal_operation_idempotency_idx
  ON causal_idempotency (tenant_id, project_id, operation_id, idempotency_key)
  WHERE operation_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS causal_outbox (
  tenant_id varchar(64) NOT NULL, project_id varchar(128) NOT NULL, outbox_id uuid NOT NULL,
  record_id uuid NOT NULL, topic varchar(120) NOT NULL, payload jsonb NOT NULL,
  payload_digest char(64) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz, publish_attempts integer NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  PRIMARY KEY (tenant_id, outbox_id), UNIQUE (tenant_id, project_id, record_id, topic),
  FOREIGN KEY (tenant_id, project_id, record_id)
    REFERENCES causal_record (tenant_id, project_id, record_id)
);
CREATE INDEX IF NOT EXISTS causal_outbox_pending_idx
  ON causal_outbox (tenant_id, created_at) WHERE published_at IS NULL;
CREATE TABLE IF NOT EXISTS causal_projection_cursor (
  tenant_id varchar(64) NOT NULL, projection_name varchar(120) NOT NULL,
  project_id varchar(128) NOT NULL, last_sequence_number bigint NOT NULL DEFAULT 0
    CHECK (last_sequence_number >= 0), last_record_hash char(64),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, projection_name, project_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES causal_project (tenant_id, project_id)
);
COMMENT ON TABLE causal_projection_cursor IS
  'Reserved schema foundation; cursor advance is unavailable in causal_continuity_foundation_v1';
CREATE OR REPLACE FUNCTION deny_causal_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'causal_history_append_only'; END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'causal_genesis_intent_append_only'
      AND tgrelid = 'causal_genesis_intent'::regclass) THEN
    CREATE TRIGGER causal_genesis_intent_append_only BEFORE UPDATE OR DELETE ON causal_genesis_intent
      FOR EACH ROW EXECUTE FUNCTION deny_causal_history_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'causal_intent_revision_append_only'
      AND tgrelid = 'causal_intent_revision'::regclass) THEN
    CREATE TRIGGER causal_intent_revision_append_only BEFORE UPDATE OR DELETE ON causal_intent_revision
      FOR EACH ROW EXECUTE FUNCTION deny_causal_history_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'causal_record_append_only'
      AND tgrelid = 'causal_record'::regclass) THEN
    CREATE TRIGGER causal_record_append_only BEFORE UPDATE OR DELETE ON causal_record
      FOR EACH ROW EXECUTE FUNCTION deny_causal_history_mutation();
  END IF;
END;
$$;
CREATE TABLE IF NOT EXISTS core_schema_migrations (
  migration_id varchar(160) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260810_causal_continuity_foundation_v1') ON CONFLICT DO NOTHING;

COMMIT;
