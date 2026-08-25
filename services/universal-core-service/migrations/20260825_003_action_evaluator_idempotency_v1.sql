BEGIN;

CREATE TABLE IF NOT EXISTS core_action_evaluator_receipts (
  tenant_id varchar(120) NOT NULL,
  action_type varchar(160) NOT NULL,
  idempotency_key_digest char(64) NOT NULL,
  request_digest char(64) NOT NULL,
  owner_subject_fingerprint varchar(80) NOT NULL,
  authorization_id varchar(64) NOT NULL,
  authority_response jsonb NOT NULL,
  response_digest char(64) NOT NULL,
  receipt jsonb NOT NULL,
  authorization_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, action_type, idempotency_key_digest),
  CHECK (idempotency_key_digest ~ '^[a-f0-9]{64}$'),
  CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  CHECK (response_digest ~ '^[a-f0-9]{64}$'),
  CHECK (jsonb_typeof(authority_response) = 'object'),
  CHECK (jsonb_typeof(receipt) = 'object')
);

CREATE TABLE IF NOT EXISTS core_action_evaluator_owner_approvals (
  tenant_id varchar(120) NOT NULL,
  approval_hash varchar(80) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, approval_hash)
);

CREATE INDEX IF NOT EXISTS core_action_evaluator_receipts_expiry_idx
  ON core_action_evaluator_receipts (authorization_expires_at);

CREATE TABLE IF NOT EXISTS core_action_evaluator_schema_manifest (
  component text PRIMARY KEY,
  schema_version varchar(80) NOT NULL,
  schema_digest char(64) NOT NULL,
  append_only boolean NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION core_action_evaluator_deny_mutation()
RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  RAISE EXCEPTION 'core_action_evaluator_append_only_violation'
    USING ERRCODE = '55000';
END;
$guard$;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='core_action_evaluator_receipts'::regclass
      AND tgname='core_action_evaluator_receipts_append_only') THEN
    CREATE TRIGGER core_action_evaluator_receipts_append_only
      BEFORE UPDATE OR DELETE ON core_action_evaluator_receipts
      FOR EACH ROW EXECUTE FUNCTION core_action_evaluator_deny_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='core_action_evaluator_owner_approvals'::regclass
      AND tgname='core_action_evaluator_owner_approvals_append_only') THEN
    CREATE TRIGGER core_action_evaluator_owner_approvals_append_only
      BEFORE UPDATE OR DELETE ON core_action_evaluator_owner_approvals
      FOR EACH ROW EXECUTE FUNCTION core_action_evaluator_deny_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='core_action_evaluator_schema_manifest'::regclass
      AND tgname='core_action_evaluator_schema_manifest_append_only') THEN
    CREATE TRIGGER core_action_evaluator_schema_manifest_append_only
      BEFORE UPDATE OR DELETE ON core_action_evaluator_schema_manifest
      FOR EACH ROW EXECUTE FUNCTION core_action_evaluator_deny_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='core_action_evaluator_receipts'::regclass
      AND tgname='core_action_evaluator_receipts_truncate_guard') THEN
    CREATE TRIGGER core_action_evaluator_receipts_truncate_guard
      BEFORE TRUNCATE ON core_action_evaluator_receipts
      FOR EACH STATEMENT EXECUTE FUNCTION core_action_evaluator_deny_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='core_action_evaluator_owner_approvals'::regclass
      AND tgname='core_action_evaluator_owner_approvals_truncate_guard') THEN
    CREATE TRIGGER core_action_evaluator_owner_approvals_truncate_guard
      BEFORE TRUNCATE ON core_action_evaluator_owner_approvals
      FOR EACH STATEMENT EXECUTE FUNCTION core_action_evaluator_deny_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid='core_action_evaluator_schema_manifest'::regclass
      AND tgname='core_action_evaluator_schema_manifest_truncate_guard') THEN
    CREATE TRIGGER core_action_evaluator_schema_manifest_truncate_guard
      BEFORE TRUNCATE ON core_action_evaluator_schema_manifest
      FOR EACH STATEMENT EXECUTE FUNCTION core_action_evaluator_deny_mutation();
  END IF;
END;
$guard$;

INSERT INTO core_action_evaluator_schema_manifest
  (component,schema_version,schema_digest,append_only)
VALUES ('core_action_evaluator_idempotency','action_evaluator_idempotency_v1',
  'a529814c76f3786aea3963514be20d3ea216a96c6d47e23a484d1cc8a15b2760',true)
ON CONFLICT (component) DO NOTHING;

COMMIT;
