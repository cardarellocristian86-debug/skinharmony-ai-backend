-- Governed task contracts, committed state and incremental Work projection.
-- Additive, PostgreSQL 16+, mixed-version safe. No destructive down migration.
BEGIN;

SELECT pg_advisory_xact_lock(hashtextextended('skinharmony:postgres-migration:v1',0));

CREATE TABLE IF NOT EXISTS tenant_work_task_contract (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  task_id uuid NOT NULL,
  contract_revision bigint NOT NULL CHECK (contract_revision > 0),
  intent_digest char(64) NOT NULL,
  contract jsonb NOT NULL,
  contract_digest char(64) NOT NULL,
  created_by_user_id varchar(128) NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,work_id,task_id,contract_revision),
  UNIQUE (tenant_id,work_id,task_id,contract_digest),
  FOREIGN KEY (tenant_id,work_id,task_id)
    REFERENCES tenant_work_task(tenant_id,work_id,task_id)
);

CREATE TABLE IF NOT EXISTS tenant_work_task_commit (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  task_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  contract_revision bigint NOT NULL CHECK (contract_revision > 0),
  input_digest char(64) NOT NULL,
  output_ref varchar(500) NOT NULL,
  output_digest char(64) NOT NULL,
  evidence_refs jsonb NOT NULL,
  effect_lineage_refs jsonb NOT NULL,
  validation_ref varchar(500) NOT NULL,
  ledger_position bigint NOT NULL CHECK (ledger_position > 0),
  committed_state jsonb NOT NULL,
  commit_digest char(64) NOT NULL,
  idempotency_key varchar(160) NOT NULL,
  request_digest char(64) NOT NULL,
  committed_by_user_id varchar(128) NOT NULL,
  committed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,work_id,task_id,revision),
  UNIQUE (tenant_id,work_id,ledger_position),
  UNIQUE (tenant_id,work_id,task_id,idempotency_key),
  FOREIGN KEY (tenant_id,work_id,task_id,contract_revision)
    REFERENCES tenant_work_task_contract(tenant_id,work_id,task_id,contract_revision)
);

CREATE TABLE IF NOT EXISTS tenant_work_state_projection (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  work_revision bigint NOT NULL CHECK (work_revision >= 0),
  intent_digest char(64) NOT NULL,
  projection_version integer NOT NULL CHECK (projection_version > 0),
  ledger_watermark bigint NOT NULL CHECK (ledger_watermark >= 0),
  projection jsonb NOT NULL,
  projection_digest char(64) NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,work_id),
  FOREIGN KEY (tenant_id,work_id) REFERENCES tenant_work(tenant_id,work_id)
);

CREATE TABLE IF NOT EXISTS tenant_work_effect_observation (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  effect_ref varchar(160) NOT NULL,
  observation_revision bigint NOT NULL CHECK (observation_revision > 0),
  state varchar(24) NOT NULL CHECK (state IN ('SUCCEEDED','KNOWN_NO_EFFECT','AMBIGUOUS','RECONCILING')),
  provider_receipt_digest char(64),
  observation jsonb NOT NULL,
  observation_digest char(64) NOT NULL,
  ledger_position bigint NOT NULL CHECK (ledger_position > 0),
  idempotency_key varchar(160) NOT NULL,
  request_digest char(64) NOT NULL,
  observed_by_user_id varchar(128) NOT NULL,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,work_id,effect_ref,observation_revision),
  UNIQUE (tenant_id,work_id,ledger_position),
  UNIQUE (tenant_id,work_id,effect_ref,idempotency_key),
  FOREIGN KEY (tenant_id,work_id) REFERENCES tenant_work(tenant_id,work_id)
);

CREATE TABLE IF NOT EXISTS tenant_work_task_invalidation (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  task_id uuid NOT NULL,
  invalidation_id uuid NOT NULL,
  prior_commit_revision bigint NOT NULL CHECK (prior_commit_revision > 0),
  changed_dependency_refs jsonb NOT NULL,
  reason varchar(500) NOT NULL,
  ledger_position bigint NOT NULL CHECK (ledger_position > 0),
  idempotency_key varchar(160) NOT NULL,
  request_digest char(64) NOT NULL,
  invalidated_by_user_id varchar(128) NOT NULL,
  invalidated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,invalidation_id),
  UNIQUE (tenant_id,work_id,ledger_position),
  UNIQUE (tenant_id,work_id,task_id,idempotency_key),
  FOREIGN KEY (tenant_id,work_id,task_id,prior_commit_revision)
    REFERENCES tenant_work_task_commit(tenant_id,work_id,task_id,revision)
);

CREATE TABLE IF NOT EXISTS tenant_work_dependency_manifest (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  task_id uuid NOT NULL,
  manifest_revision bigint NOT NULL CHECK (manifest_revision > 0),
  manifest jsonb NOT NULL,
  manifest_digest char(64) NOT NULL,
  idempotency_key varchar(160) NOT NULL,
  request_digest char(64) NOT NULL,
  ledger_position bigint NOT NULL CHECK (ledger_position > 0),
  recorded_by_user_id varchar(128) NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,work_id,task_id,manifest_revision),
  UNIQUE (tenant_id,work_id,task_id,manifest_digest),
  UNIQUE (tenant_id,work_id,task_id,idempotency_key),
  UNIQUE (tenant_id,work_id,ledger_position),
  FOREIGN KEY (tenant_id,work_id,task_id)
    REFERENCES tenant_work_task(tenant_id,work_id,task_id)
);

CREATE TABLE IF NOT EXISTS tenant_work_trajectory_event (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  trajectory_revision bigint NOT NULL CHECK (trajectory_revision > 0),
  agent_id varchar(128) NOT NULL,
  harness_digest char(64) NOT NULL,
  proposal jsonb NOT NULL,
  policy jsonb NOT NULL,
  trajectory jsonb NOT NULL,
  trajectory_digest char(64) NOT NULL,
  idempotency_key varchar(160) NOT NULL,
  request_digest char(64) NOT NULL,
  ledger_position bigint NOT NULL CHECK (ledger_position > 0),
  recorded_by_user_id varchar(128) NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,work_id,trajectory_revision),
  UNIQUE (tenant_id,work_id,idempotency_key),
  UNIQUE (tenant_id,work_id,ledger_position),
  FOREIGN KEY (tenant_id,work_id) REFERENCES tenant_work(tenant_id,work_id)
);

CREATE TABLE IF NOT EXISTS tenant_work_trajectory_state (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  trajectory_revision bigint NOT NULL CHECK (trajectory_revision > 0),
  trajectory jsonb NOT NULL,
  trajectory_digest char(64) NOT NULL,
  ledger_watermark bigint NOT NULL CHECK (ledger_watermark > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,work_id),
  FOREIGN KEY (tenant_id,work_id) REFERENCES tenant_work(tenant_id,work_id)
);

CREATE INDEX IF NOT EXISTS tenant_work_task_commit_latest_idx
  ON tenant_work_task_commit(tenant_id,work_id,task_id,revision DESC);
CREATE INDEX IF NOT EXISTS tenant_work_task_invalidation_task_idx
  ON tenant_work_task_invalidation(tenant_id,work_id,task_id,invalidated_at DESC);
CREATE INDEX IF NOT EXISTS tenant_work_effect_observation_latest_idx
  ON tenant_work_effect_observation(tenant_id,work_id,effect_ref,observation_revision DESC);
CREATE INDEX IF NOT EXISTS tenant_work_dependency_manifest_latest_idx
  ON tenant_work_dependency_manifest(tenant_id,work_id,task_id,manifest_revision DESC);
CREATE INDEX IF NOT EXISTS tenant_work_trajectory_event_latest_idx
  ON tenant_work_trajectory_event(tenant_id,work_id,trajectory_revision DESC);

CREATE OR REPLACE FUNCTION tenant_work_governed_state_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'tenant_work_governed_state_append_only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_work_task_contract_no_mutation ON tenant_work_task_contract;
CREATE TRIGGER tenant_work_task_contract_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_task_contract
FOR EACH ROW EXECUTE FUNCTION tenant_work_governed_state_append_only();

DROP TRIGGER IF EXISTS tenant_work_task_commit_no_mutation ON tenant_work_task_commit;
CREATE TRIGGER tenant_work_task_commit_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_task_commit
FOR EACH ROW EXECUTE FUNCTION tenant_work_governed_state_append_only();

DROP TRIGGER IF EXISTS tenant_work_task_invalidation_no_mutation ON tenant_work_task_invalidation;
CREATE TRIGGER tenant_work_task_invalidation_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_task_invalidation
FOR EACH ROW EXECUTE FUNCTION tenant_work_governed_state_append_only();

DROP TRIGGER IF EXISTS tenant_work_effect_observation_no_mutation ON tenant_work_effect_observation;
CREATE TRIGGER tenant_work_effect_observation_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_effect_observation
FOR EACH ROW EXECUTE FUNCTION tenant_work_governed_state_append_only();

DROP TRIGGER IF EXISTS tenant_work_dependency_manifest_no_mutation ON tenant_work_dependency_manifest;
CREATE TRIGGER tenant_work_dependency_manifest_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_dependency_manifest
FOR EACH ROW EXECUTE FUNCTION tenant_work_governed_state_append_only();

DROP TRIGGER IF EXISTS tenant_work_trajectory_event_no_mutation ON tenant_work_trajectory_event;
CREATE TRIGGER tenant_work_trajectory_event_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_trajectory_event
FOR EACH ROW EXECUTE FUNCTION tenant_work_governed_state_append_only();

INSERT INTO core_schema_migrations(migration_id)
VALUES ('20260908_governed_task_state_projection_v1') ON CONFLICT DO NOTHING;

COMMIT;
