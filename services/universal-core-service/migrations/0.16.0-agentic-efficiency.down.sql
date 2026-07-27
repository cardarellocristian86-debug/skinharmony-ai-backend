-- Audit-preserving rollback for Nyra/Core 0.16 Agentic Efficiency.
-- Runtime flags are returned to shadow/off by the release runbook. The additive
-- tables remain available for audit, restart recovery and a later reactivation.
-- No customer content or raw prompt is stored in these tables.

BEGIN;

INSERT INTO agentic_governance.agentic_schema_migration_audit
  (migration_version, state, applied_at, actor_provenance, rollback_reference)
VALUES
  ('0.16.0-agentic-efficiency-v1', 'disabled', NOW(), 'universal-core:rollback', 'git:pre-v0.16');

COMMIT;
