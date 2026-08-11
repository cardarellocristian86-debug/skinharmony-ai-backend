-- Shared core_schema_migrations compatibility, PostgreSQL 16+.
-- Bootstrap authority historically owns only migration_id/applied_at, while
-- causal continuity needs state fields. Preserve existing rows and support
-- either initialization order.
BEGIN;

SELECT pg_advisory_xact_lock(
  hashtextextended('20260812_core_schema_migrations_compatibility_v1', 0)
);

CREATE TABLE IF NOT EXISTS core_schema_migrations (
  migration_id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  sql_digest CHAR(64),
  application_state TEXT,
  checkpoint TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  verifier_evidence JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE core_schema_migrations
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS sql_digest CHAR(64),
  ADD COLUMN IF NOT EXISTS application_state TEXT,
  ADD COLUMN IF NOT EXISTS checkpoint TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verifier_evidence JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
