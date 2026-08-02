-- Audit-preserving rollback for Nyra/Core 0.16 Agentic Efficiency.
-- Runtime flags are returned to shadow/off by the release runbook. The additive
-- tables remain available for audit, restart recovery and a later reactivation.
-- No customer content or raw prompt is stored in these tables.

BEGIN;

INSERT INTO agentic_governance.agentic_schema_migration_audit
  (migration_version, state, applied_at, actor_provenance, rollback_reference)
VALUES
  (
    '0.16.0-agentic-efficiency-v1',
    'disabled',
    NOW(),
    'universal-core:rollback',
    'manifest:docs/releases/0.16.0-ai-learning-factory-rollback-point.json'
  );

REVOKE SELECT,INSERT,UPDATE ON agentic_governance.agentic_work_capsule
  FROM nyra_agentic_runtime_v016;
REVOKE SELECT,INSERT,UPDATE ON agentic_governance.agentic_artifact_reuse
  FROM nyra_agentic_runtime_v016;
REVOKE SELECT,INSERT ON agentic_governance.agentic_usage_ledger
  FROM nyra_agentic_runtime_v016;
REVOKE SELECT,INSERT ON agentic_governance.agentic_efficiency_comparison
  FROM nyra_agentic_runtime_v016;
REVOKE SELECT,INSERT,UPDATE ON agentic_governance.agentic_run_budget
  FROM nyra_agentic_runtime_v016;
REVOKE SELECT,INSERT ON agentic_governance.agentic_efficiency_baseline
  FROM nyra_agentic_runtime_v016;
REVOKE SELECT,INSERT ON agentic_governance.agentic_savings_claim
  FROM nyra_agentic_runtime_v016;
REVOKE SELECT,INSERT ON agentic_governance.agentic_rate_card_snapshot
  FROM nyra_agentic_runtime_v016;
REVOKE USAGE ON SCHEMA agentic_governance
  FROM nyra_agentic_runtime_v016;
REVOKE nyra_agentic_runtime_v016 FROM CURRENT_USER;

COMMIT;
