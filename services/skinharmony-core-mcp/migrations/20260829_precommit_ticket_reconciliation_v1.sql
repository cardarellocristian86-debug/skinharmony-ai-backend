-- Governed precommit ticket reconciliation. Additive and idempotent.
BEGIN;

-- These redundant unique identities allow the new foreign keys to bind every
-- referenced task, evidence and native receipt to the exact Work.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_work_task_work_identity_uidx
  ON tenant_work_task(tenant_id, work_id, task_id);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_work_evidence_work_identity_uidx
  ON tenant_work_evidence(tenant_id, work_id, evidence_id);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_work_native_receipt_work_identity_uidx
  ON tenant_work_native_verifier_evidence(tenant_id, work_id, native_receipt_id);

CREATE TABLE IF NOT EXISTS tenant_work_precommit_ticket_gate (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, task_id uuid NOT NULL,
  plan_id uuid NOT NULL, evaluation_id uuid NOT NULL,
  evaluation_digest char(64) NOT NULL, workspace_digest char(64) NOT NULL,
  supersession_digest char(64) NOT NULL, reconciliation_digest char(64) NOT NULL,
  action_kind varchar(40) NOT NULL DEFAULT 'git.commit',
  gate_kind varchar(40) NOT NULL DEFAULT 'ticket_acquisition',
  created_by_user_id varchar(128) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, task_id),
  UNIQUE (tenant_id, work_id, action_kind, gate_kind),
  CHECK (action_kind='git.commit'), CHECK (gate_kind='ticket_acquisition'),
  FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id),
  FOREIGN KEY (tenant_id, work_id, task_id)
    REFERENCES tenant_work_task(tenant_id, work_id, task_id)
);

CREATE TABLE IF NOT EXISTS tenant_work_precommit_evidence_reconciliation (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL,
  legacy_evidence_id uuid NOT NULL, replacement_evidence_id uuid NOT NULL,
  task_id uuid NOT NULL, plan_id uuid NOT NULL, evaluation_id uuid NOT NULL,
  native_receipt_id uuid NOT NULL, native_receipt_digest char(64) NOT NULL,
  replacement_evidence_digest char(64) NOT NULL,
  evaluation_digest char(64) NOT NULL, workspace_digest char(64) NOT NULL,
  supersession_digest char(64) NOT NULL, reconciliation_digest char(64) NOT NULL,
  created_by_user_id varchar(128) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, legacy_evidence_id),
  UNIQUE (tenant_id, work_id, replacement_evidence_id),
  CHECK (legacy_evidence_id<>replacement_evidence_id),
  FOREIGN KEY (tenant_id, work_id, task_id)
    REFERENCES tenant_work_precommit_ticket_gate(tenant_id, work_id, task_id),
  FOREIGN KEY (tenant_id, work_id, legacy_evidence_id)
    REFERENCES tenant_work_evidence(tenant_id, work_id, evidence_id),
  FOREIGN KEY (tenant_id, work_id, replacement_evidence_id)
    REFERENCES tenant_work_evidence(tenant_id, work_id, evidence_id),
  FOREIGN KEY (tenant_id, work_id, native_receipt_id)
    REFERENCES tenant_work_native_verifier_evidence(tenant_id, work_id, native_receipt_id)
);

CREATE TABLE IF NOT EXISTS tenant_work_precommit_ticket_fulfillment (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, task_id uuid NOT NULL,
  ticket_id varchar(160) NOT NULL, ticket_digest char(64) NOT NULL,
  gate_projection_digest char(64) NOT NULL, fulfillment_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, task_id),
  UNIQUE (tenant_id, ticket_id),
  FOREIGN KEY (tenant_id, work_id, task_id)
    REFERENCES tenant_work_precommit_ticket_gate(tenant_id, work_id, task_id)
);

CREATE OR REPLACE FUNCTION tenant_work_precommit_reconciliation_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'tenant_work_precommit_reconciliation_append_only'; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_work_precommit_ticket_gate_no_mutation
  ON tenant_work_precommit_ticket_gate;
CREATE TRIGGER tenant_work_precommit_ticket_gate_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_precommit_ticket_gate
FOR EACH ROW EXECUTE FUNCTION tenant_work_precommit_reconciliation_append_only();

DROP TRIGGER IF EXISTS tenant_work_precommit_evidence_reconciliation_no_mutation
  ON tenant_work_precommit_evidence_reconciliation;
CREATE TRIGGER tenant_work_precommit_evidence_reconciliation_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_precommit_evidence_reconciliation
FOR EACH ROW EXECUTE FUNCTION tenant_work_precommit_reconciliation_append_only();

DROP TRIGGER IF EXISTS tenant_work_precommit_ticket_fulfillment_no_mutation
  ON tenant_work_precommit_ticket_fulfillment;
CREATE TRIGGER tenant_work_precommit_ticket_fulfillment_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_precommit_ticket_fulfillment
FOR EACH ROW EXECUTE FUNCTION tenant_work_precommit_reconciliation_append_only();

INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260829_precommit_ticket_reconciliation_v1')
ON CONFLICT DO NOTHING;

COMMIT;
