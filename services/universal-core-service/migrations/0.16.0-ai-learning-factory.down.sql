-- Audit-preserving rollback for AI Learning Factory v0.16.
-- Runtime flags are returned to shadow/off. Tables and record history remain
-- intact so rollback never erases audit, telemetry or tenant evidence.

BEGIN;

INSERT INTO ai_learning_governance.schema_migration_audit
  (migration_version,state,applied_at,actor_provenance,rollback_reference)
VALUES
  (
    '0.16.0-ai-learning-factory-v1',
    'disabled',
    NOW(),
    'universal-core:rollback',
    'manifest:docs/releases/0.16.0-ai-learning-factory-rollback-point.json'
  );

REVOKE SELECT,INSERT,UPDATE ON ai_learning_governance.learning_record
  FROM nyra_ai_learning_runtime_v016;
REVOKE SELECT,INSERT ON ai_learning_governance.learning_record_history
  FROM nyra_ai_learning_runtime_v016;
REVOKE SELECT,INSERT ON ai_learning_governance.runtime_telemetry
  FROM nyra_ai_learning_runtime_v016;
REVOKE SELECT,INSERT ON ai_learning_governance.idempotency_receipt
  FROM nyra_ai_learning_runtime_v016;
REVOKE USAGE ON SCHEMA ai_learning_governance
  FROM nyra_ai_learning_runtime_v016;
REVOKE nyra_ai_learning_runtime_v016 FROM CURRENT_USER;

COMMIT;
