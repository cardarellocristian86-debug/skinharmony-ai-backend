-- Nyra/Core 0.16 Agentic Efficiency
-- Additive only. Run with the isolated GOVERNED_AGENT_DATABASE_URL role.
-- Static release migration owns DDL/grants; runtime performs verification only.

BEGIN;

DO $role$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname='nyra_agentic_runtime_v016'
  ) THEN
    CREATE ROLE nyra_agentic_runtime_v016 NOLOGIN;
  END IF;
END
$role$;

GRANT nyra_agentic_runtime_v016 TO CURRENT_USER;

CREATE SCHEMA IF NOT EXISTS agentic_governance;

CREATE TABLE IF NOT EXISTS agentic_governance.agentic_schema_migration_audit (
  migration_version TEXT NOT NULL,
  state TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL,
  actor_provenance TEXT NOT NULL,
  rollback_reference TEXT NOT NULL,
  PRIMARY KEY (migration_version, state, applied_at)
);

CREATE TABLE IF NOT EXISTS agentic_governance.agentic_run_budget (
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  budget JSONB NOT NULL,
  policy_expires_at TIMESTAMPTZ NOT NULL,
  actor_provenance TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, run_id)
);

CREATE TABLE IF NOT EXISTS agentic_governance.agentic_usage_ledger (
  ledger_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  usage_kind TEXT NOT NULL CHECK (usage_kind IN ('actual','estimated')),
  usage JSONB NOT NULL,
  usage_source TEXT NOT NULL,
  rate_card_version TEXT NOT NULL,
  receipt_digest TEXT,
  actor_provenance TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS agentic_usage_ledger_tenant_run_idx
  ON agentic_governance.agentic_usage_ledger (tenant_id, run_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS agentic_usage_ledger_receipt_unique_idx
  ON agentic_governance.agentic_usage_ledger (tenant_id, receipt_digest)
  WHERE receipt_digest IS NOT NULL;

CREATE TABLE IF NOT EXISTS agentic_governance.agentic_work_capsule (
  capsule_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  capsule_hash TEXT NOT NULL,
  capsule JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  actor_provenance TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, capsule_id)
);

ALTER TABLE agentic_governance.agentic_work_capsule
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE agentic_governance.agentic_work_capsule
SET expires_at=(capsule->>'expires_at')::timestamptz
WHERE expires_at IS NULL;

ALTER TABLE agentic_governance.agentic_work_capsule
  ALTER COLUMN expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS agentic_work_capsule_expiry_idx
  ON agentic_governance.agentic_work_capsule
  (tenant_id, expires_at);

CREATE TABLE IF NOT EXISTS agentic_governance.agentic_artifact_reuse (
  tenant_id TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  artifact_version TEXT NOT NULL,
  provenance_digest TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  security_checks_verified BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  actor_provenance TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, artifact_hash, artifact_version)
);

CREATE TABLE IF NOT EXISTS agentic_governance.agentic_efficiency_baseline (
  tenant_id TEXT NOT NULL,
  baseline_id TEXT NOT NULL,
  repository_snapshot TEXT NOT NULL,
  rubric_digest TEXT NOT NULL,
  metrics JSONB NOT NULL,
  usage_kind TEXT NOT NULL CHECK (usage_kind IN ('actual','estimated')),
  actor_provenance TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, baseline_id)
);

CREATE TABLE IF NOT EXISTS agentic_governance.agentic_efficiency_comparison (
  tenant_id TEXT NOT NULL,
  comparison_id TEXT NOT NULL,
  baseline_id TEXT NOT NULL,
  optimized_run_id TEXT NOT NULL,
  metrics JSONB NOT NULL,
  usage_kind TEXT NOT NULL CHECK (usage_kind IN ('actual','estimated')),
  quality_floor_preserved BOOLEAN NOT NULL,
  safety_preserved BOOLEAN NOT NULL,
  actor_provenance TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, comparison_id)
);

CREATE TABLE IF NOT EXISTS agentic_governance.agentic_savings_claim (
  tenant_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  comparison_id TEXT NOT NULL,
  claim_kind TEXT NOT NULL CHECK (claim_kind IN ('actual','estimated')),
  reconciled BOOLEAN NOT NULL DEFAULT FALSE,
  amount JSONB NOT NULL,
  quality_delta JSONB NOT NULL,
  actor_provenance TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, claim_id)
);

CREATE TABLE IF NOT EXISTS agentic_governance.agentic_rate_card_snapshot (
  tenant_id TEXT NOT NULL,
  rate_card_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  rates JSONB NOT NULL,
  source_reference TEXT NOT NULL,
  provenance_digest TEXT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  actor_provenance TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, rate_card_version)
);

GRANT USAGE ON SCHEMA agentic_governance
  TO nyra_agentic_runtime_v016;
GRANT SELECT,INSERT,UPDATE ON agentic_governance.agentic_work_capsule
  TO nyra_agentic_runtime_v016;
GRANT SELECT,INSERT,UPDATE ON agentic_governance.agentic_artifact_reuse
  TO nyra_agentic_runtime_v016;
GRANT SELECT,INSERT ON agentic_governance.agentic_usage_ledger
  TO nyra_agentic_runtime_v016;
GRANT SELECT,INSERT ON agentic_governance.agentic_efficiency_comparison
  TO nyra_agentic_runtime_v016;

INSERT INTO agentic_governance.agentic_schema_migration_audit
  (migration_version, state, applied_at, actor_provenance, rollback_reference)
VALUES
  ('0.16.0-agentic-efficiency-v1', 'active', NOW(), 'universal-core:migration', 'git:pre-v0.16');

COMMIT;
