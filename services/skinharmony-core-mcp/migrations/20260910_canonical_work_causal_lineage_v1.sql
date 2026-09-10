BEGIN;
ALTER TABLE tenant_work
  ADD COLUMN IF NOT EXISTS causal_lineage_state varchar(16) NOT NULL DEFAULT 'READY',
  ADD COLUMN IF NOT EXISTS causal_lineage_reason varchar(160),
  ADD COLUMN IF NOT EXISTS causal_lineage_digest char(64);
ALTER TABLE tenant_work DROP CONSTRAINT IF EXISTS tenant_work_causal_lineage_state_ck;
ALTER TABLE tenant_work ADD CONSTRAINT tenant_work_causal_lineage_state_ck
  CHECK (causal_lineage_state IN ('PENDING','READY'));
COMMIT;
