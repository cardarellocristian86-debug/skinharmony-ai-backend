-- Bind a native builder/verifier pair to one exact V2 task before evidence
-- can promote acceptance.  Existing assignments intentionally remain NULL:
-- they may report normally but cannot be retroactively reinterpreted.
BEGIN;

ALTER TABLE core_continuity_native_agents
  ADD COLUMN IF NOT EXISTS v2_task_id uuid;

ALTER TABLE tenant_work_native_verifier_evidence
  ADD COLUMN IF NOT EXISTS v2_task_id uuid;

CREATE INDEX IF NOT EXISTS tenant_work_native_verifier_evidence_v2_task_idx
  ON tenant_work_native_verifier_evidence (tenant_id, work_id, v2_task_id)
  WHERE v2_task_id IS NOT NULL;

INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260828_native_verifier_task_acceptance_v1')
ON CONFLICT DO NOTHING;

COMMIT;
