-- Discriminate server-owned native closure gates from legacy evidence reconciliation gates.
BEGIN;

ALTER TABLE tenant_work_precommit_ticket_gate
  ADD COLUMN IF NOT EXISTS gate_source varchar(48) NOT NULL DEFAULT 'legacy_evidence_reconciliation';
ALTER TABLE tenant_work_precommit_ticket_gate_supersession
  ADD COLUMN IF NOT EXISTS gate_source varchar(48) NOT NULL DEFAULT 'legacy_evidence_reconciliation';

DO $native_gate_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='tenant_work_precommit_ticket_gate_source_check'
      AND conrelid='tenant_work_precommit_ticket_gate'::regclass) THEN
    ALTER TABLE tenant_work_precommit_ticket_gate
      ADD CONSTRAINT tenant_work_precommit_ticket_gate_source_check
      CHECK (gate_source IN ('legacy_evidence_reconciliation','native_closure_evaluation'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='tenant_work_precommit_ticket_gate_supersession_source_check'
      AND conrelid='tenant_work_precommit_ticket_gate_supersession'::regclass) THEN
    ALTER TABLE tenant_work_precommit_ticket_gate_supersession
      ADD CONSTRAINT tenant_work_precommit_ticket_gate_supersession_source_check
      CHECK (gate_source IN ('legacy_evidence_reconciliation','native_closure_evaluation'));
  END IF;
END;
$native_gate_constraints$;

INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260901_native_precommit_ticket_gate_v2') ON CONFLICT DO NOTHING;

COMMIT;
