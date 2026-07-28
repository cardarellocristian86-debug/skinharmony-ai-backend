-- Nyra/Core AI Learning Factory v0.16.
-- Additive only. Uses the existing isolated GOVERNED_AGENT_DATABASE_URL.
-- The static release migration owns all DDL and least-privilege grants.
-- Runtime code only verifies and SET ROLE; it never creates roles or tables.

BEGIN;

DO $role$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname='nyra_ai_learning_runtime_v016'
  ) THEN
    CREATE ROLE nyra_ai_learning_runtime_v016 NOLOGIN;
  END IF;
END
$role$;

GRANT nyra_ai_learning_runtime_v016 TO CURRENT_USER;

CREATE SCHEMA IF NOT EXISTS ai_learning_governance;

CREATE TABLE IF NOT EXISTS ai_learning_governance.schema_migration_audit (
  migration_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active','disabled')),
  applied_at TIMESTAMPTZ NOT NULL,
  actor_provenance TEXT NOT NULL,
  rollback_reference TEXT NOT NULL,
  PRIMARY KEY (migration_version,state,applied_at)
);

CREATE TABLE IF NOT EXISTS ai_learning_governance.learning_record (
  tenant_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  record_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  record JSONB NOT NULL,
  record_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id,collection,record_id)
);

CREATE INDEX IF NOT EXISTS ai_learning_record_tenant_collection_updated_idx
  ON ai_learning_governance.learning_record
  (tenant_id,collection,updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_learning_governance.learning_record_history (
  tenant_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  record_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  record JSONB NOT NULL,
  record_digest TEXT NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id,collection,record_id,revision)
);

CREATE TABLE IF NOT EXISTS ai_learning_governance.runtime_telemetry (
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  record JSONB NOT NULL,
  record_digest TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id,run_id)
);

CREATE INDEX IF NOT EXISTS ai_runtime_telemetry_tenant_recorded_idx
  ON ai_learning_governance.runtime_telemetry
  (tenant_id,recorded_at DESC);

CREATE TABLE IF NOT EXISTS ai_learning_governance.idempotency_receipt (
  tenant_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_digest TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  record_id TEXT NOT NULL,
  result_revision INTEGER NOT NULL CHECK (result_revision > 0),
  result_record JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id,operation,idempotency_digest)
);

GRANT USAGE ON SCHEMA ai_learning_governance
  TO nyra_ai_learning_runtime_v016;
GRANT SELECT,INSERT,UPDATE ON ai_learning_governance.learning_record
  TO nyra_ai_learning_runtime_v016;
GRANT SELECT,INSERT ON ai_learning_governance.learning_record_history
  TO nyra_ai_learning_runtime_v016;
GRANT SELECT,INSERT ON ai_learning_governance.runtime_telemetry
  TO nyra_ai_learning_runtime_v016;
GRANT SELECT,INSERT ON ai_learning_governance.idempotency_receipt
  TO nyra_ai_learning_runtime_v016;

INSERT INTO ai_learning_governance.schema_migration_audit
  (migration_version,state,applied_at,actor_provenance,rollback_reference)
VALUES
  ('0.16.0-ai-learning-factory-v1','active',NOW(),'universal-core:migration','git:pre-v0.16');

COMMIT;
