BEGIN;
CREATE TABLE IF NOT EXISTS tenant_work_precommit_ticket_gate_claim (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, gate_projection_digest char(64) NOT NULL,
  claim_id uuid NOT NULL, continuation_ref varchar(240) NOT NULL, request_digest char(64) NOT NULL,
  delegation_id varchar(160) NOT NULL, action_digest char(64) NOT NULL,
  host_session_fingerprint varchar(128) NOT NULL, idempotency_key varchar(160) NOT NULL,
  claim_digest char(64) NOT NULL, state varchar(16) NOT NULL DEFAULT 'CLAIMED', ticket_id varchar(160),
  claimed_by_user_id varchar(128) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,work_id,gate_projection_digest), UNIQUE (tenant_id,claim_id),
  UNIQUE (tenant_id,work_id,idempotency_key), CHECK (state='CLAIMED'), CHECK (ticket_id IS NULL),
  FOREIGN KEY (tenant_id,work_id) REFERENCES tenant_work(tenant_id,work_id)
);
CREATE TABLE IF NOT EXISTS tenant_work_precommit_ticket_gate_claim_fulfillment (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, gate_projection_digest char(64) NOT NULL,
  claim_id uuid NOT NULL, claim_digest char(64) NOT NULL, ticket_id varchar(160) NOT NULL,
  fulfilled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,work_id,gate_projection_digest), UNIQUE (tenant_id,claim_id),
  FOREIGN KEY (tenant_id,work_id,gate_projection_digest)
    REFERENCES tenant_work_precommit_ticket_gate_claim(tenant_id,work_id,gate_projection_digest)
);
CREATE TABLE IF NOT EXISTS tenant_work_precommit_ticket_gate_claim_reconciliation (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, claim_id uuid NOT NULL,
  reconciliation_id uuid NOT NULL, gate_projection_digest char(64) NOT NULL,
  stage varchar(40) NOT NULL, ticket_id varchar(160), error_code varchar(160) NOT NULL,
  request_digest char(64) NOT NULL, continuation_ref varchar(240) NOT NULL,
  idempotency_key varchar(160) NOT NULL, reconciliation_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id,reconciliation_id),
  UNIQUE (tenant_id,work_id,claim_id,stage),
  FOREIGN KEY (tenant_id,claim_id) REFERENCES tenant_work_precommit_ticket_gate_claim(tenant_id,claim_id)
);
CREATE OR REPLACE FUNCTION tenant_work_precommit_claim_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'tenant_work_precommit_claim_append_only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tenant_work_precommit_claim_no_mutation ON tenant_work_precommit_ticket_gate_claim;
CREATE TRIGGER tenant_work_precommit_claim_no_mutation BEFORE UPDATE OR DELETE
  ON tenant_work_precommit_ticket_gate_claim FOR EACH ROW EXECUTE FUNCTION tenant_work_precommit_claim_append_only();
DROP TRIGGER IF EXISTS tenant_work_precommit_claim_fulfillment_no_mutation ON tenant_work_precommit_ticket_gate_claim_fulfillment;
CREATE TRIGGER tenant_work_precommit_claim_fulfillment_no_mutation BEFORE UPDATE OR DELETE
  ON tenant_work_precommit_ticket_gate_claim_fulfillment FOR EACH ROW EXECUTE FUNCTION tenant_work_precommit_claim_append_only();
DROP TRIGGER IF EXISTS tenant_work_precommit_claim_reconciliation_no_mutation ON tenant_work_precommit_ticket_gate_claim_reconciliation;
CREATE TRIGGER tenant_work_precommit_claim_reconciliation_no_mutation BEFORE UPDATE OR DELETE
  ON tenant_work_precommit_ticket_gate_claim_reconciliation FOR EACH ROW EXECUTE FUNCTION tenant_work_precommit_claim_append_only();
INSERT INTO core_schema_migrations (migration_id) VALUES ('20260901_precommit_ticket_gate_claim_v1')
ON CONFLICT DO NOTHING;
COMMIT;
