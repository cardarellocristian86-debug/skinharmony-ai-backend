-- Server-owned bridge from a transport-bound native verifier report to V2
-- Work evidence. This migration is additive and deliberately gives no
-- client-facing mutation path to the derived independent evidence.
BEGIN;

CREATE TABLE IF NOT EXISTS tenant_work_native_verifier_evidence (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, plan_id uuid NOT NULL,
  task_id varchar(120) NOT NULL, task_digest char(64) NOT NULL,
  verifier_agent_id varchar(120) NOT NULL, verifier_session_fingerprint varchar(128) NOT NULL,
  native_receipt_id uuid NOT NULL, native_receipt_digest char(64) NOT NULL,
  report_digest char(64) NOT NULL, evidence_id uuid NOT NULL, evidence_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, plan_id, task_id),
  UNIQUE (tenant_id, native_receipt_id),
  UNIQUE (tenant_id, evidence_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id),
  FOREIGN KEY (tenant_id, evidence_id) REFERENCES tenant_work_evidence(tenant_id, evidence_id)
);

CREATE OR REPLACE FUNCTION tenant_work_native_verifier_evidence_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'tenant_work_native_verifier_evidence_append_only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tenant_work_native_verifier_evidence_no_mutation
  ON tenant_work_native_verifier_evidence;
CREATE TRIGGER tenant_work_native_verifier_evidence_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_native_verifier_evidence
FOR EACH ROW EXECUTE FUNCTION tenant_work_native_verifier_evidence_append_only();

INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260826_native_verifier_evidence_bridge_v1')
ON CONFLICT DO NOTHING;

COMMIT;
