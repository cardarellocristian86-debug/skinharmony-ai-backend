-- Audit-preserving rollback for AI Learning Factory v0.16.
-- Runtime flags are returned to shadow/off. Tables and record history remain
-- intact so rollback never erases audit, telemetry or tenant evidence.

BEGIN;

INSERT INTO ai_learning_governance.schema_migration_audit
  (migration_version,state,applied_at,actor_provenance,rollback_reference)
VALUES
  ('0.16.0-ai-learning-factory-v1','disabled',NOW(),'universal-core:rollback','git:pre-v0.16');

COMMIT;
