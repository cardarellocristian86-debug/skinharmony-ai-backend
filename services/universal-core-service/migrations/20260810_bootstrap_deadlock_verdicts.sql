-- Server-derived Bootstrap Deadlock verdicts, PostgreSQL 16 compatible.
-- Additive and idempotent. Verdicts, revocations and ledger events are immutable.
BEGIN;

CREATE TABLE IF NOT EXISTS core_schema_migrations (
  migration_id varchar(160) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS core_bootstrap_deadlock_verdicts (
  tenant_id varchar(128) NOT NULL,
  verdict_digest char(64) NOT NULL,
  verdict_id varchar(80) NOT NULL,
  exception_id varchar(128) NOT NULL,
  work_id varchar(128) NOT NULL,
  repository varchar(201) NOT NULL,
  pr_number bigint NOT NULL,
  head_sha char(40) NOT NULL,
  action varchar(64) NOT NULL,
  failure_code varchar(128) NOT NULL,
  classification varchar(64) NOT NULL,
  required_checks_digest char(64) NOT NULL,
  required_checks_results_digest char(64) NOT NULL,
  evidence_digest char(64) NOT NULL,
  remediation_digest char(64) NOT NULL,
  owner_confirmation_digest char(64) NOT NULL,
  failure_policy_digest char(64) NOT NULL,
  normal_path_available boolean NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  ttl_seconds integer NOT NULL,
  verdict jsonb NOT NULL,
  PRIMARY KEY (tenant_id, verdict_digest),
  UNIQUE (tenant_id, verdict_id),
  UNIQUE (tenant_id, exception_id),
  CHECK (verdict_digest ~ '^[0-9a-f]{64}$'),
  CHECK (verdict_id ~ '^bdv_[0-9a-f]{40}$'),
  CHECK (repository ~ '^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$'),
  CHECK (pr_number > 0),
  CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  CHECK (action = 'github.merge'),
  CHECK (classification = 'BOOTSTRAP_DEADLOCK_VERIFIED'),
  CHECK (normal_path_available = false),
  CHECK (required_checks_digest ~ '^[0-9a-f]{64}$'),
  CHECK (required_checks_results_digest ~ '^[0-9a-f]{64}$'),
  CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
  CHECK (remediation_digest ~ '^[0-9a-f]{64}$'),
  CHECK (owner_confirmation_digest ~ '^[0-9a-f]{64}$'),
  CHECK (failure_policy_digest ~ '^[0-9a-f]{64}$'),
  CHECK (ttl_seconds BETWEEN 1 AND 900),
  CHECK (expires_at > issued_at),
  CHECK (expires_at <= issued_at + interval '15 minutes'),
  CHECK (jsonb_typeof(verdict) = 'object'),
  CHECK (verdict->>'schema_version' = 'bootstrap_deadlock_verdict_v1'),
  CHECK (verdict->>'classification' = 'BOOTSTRAP_DEADLOCK_VERIFIED'),
  CHECK ((verdict->>'execution_authorized')::boolean = false),
  CHECK ((verdict->>'host_action_authorized')::boolean = false)
);

CREATE INDEX IF NOT EXISTS core_bootstrap_deadlock_verdict_scope_idx
  ON core_bootstrap_deadlock_verdicts
  (tenant_id, work_id, repository, pr_number, head_sha, exception_id, action);

CREATE TABLE IF NOT EXISTS core_bootstrap_deadlock_verdict_revocations (
  tenant_id varchar(128) NOT NULL,
  verdict_digest char(64) NOT NULL,
  exception_id varchar(128) NOT NULL,
  reason_digest char(64) NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, verdict_digest),
  FOREIGN KEY (tenant_id, verdict_digest)
    REFERENCES core_bootstrap_deadlock_verdicts (tenant_id, verdict_digest),
  CHECK (verdict_digest ~ '^[0-9a-f]{64}$'),
  CHECK (reason_digest ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS core_bootstrap_deadlock_verdict_events (
  tenant_id varchar(128) NOT NULL,
  stream_id char(64) NOT NULL,
  sequence_number integer NOT NULL,
  event_type varchar(80) NOT NULL,
  event_digest char(64) NOT NULL,
  previous_event_digest char(64),
  event jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, stream_id, sequence_number),
  UNIQUE (tenant_id, event_digest),
  FOREIGN KEY (tenant_id, stream_id)
    REFERENCES core_bootstrap_deadlock_verdicts (tenant_id, verdict_digest),
  CHECK (sequence_number > 0),
  CHECK (event_type IN ('bootstrap_deadlock_verdict_issued','bootstrap_deadlock_verdict_revoked')),
  CHECK (event_digest ~ '^[0-9a-f]{64}$'),
  CHECK (previous_event_digest IS NULL OR previous_event_digest ~ '^[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(event) = 'object')
);

CREATE OR REPLACE FUNCTION core_bootstrap_deadlock_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'core_bootstrap_deadlock_append_only_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS core_bootstrap_deadlock_verdicts_no_mutation ON core_bootstrap_deadlock_verdicts;
CREATE TRIGGER core_bootstrap_deadlock_verdicts_no_mutation
BEFORE UPDATE OR DELETE ON core_bootstrap_deadlock_verdicts
FOR EACH ROW EXECUTE FUNCTION core_bootstrap_deadlock_forbid_mutation();

DROP TRIGGER IF EXISTS core_bootstrap_deadlock_revocations_no_mutation ON core_bootstrap_deadlock_verdict_revocations;
CREATE TRIGGER core_bootstrap_deadlock_revocations_no_mutation
BEFORE UPDATE OR DELETE ON core_bootstrap_deadlock_verdict_revocations
FOR EACH ROW EXECUTE FUNCTION core_bootstrap_deadlock_forbid_mutation();

DROP TRIGGER IF EXISTS core_bootstrap_deadlock_events_no_mutation ON core_bootstrap_deadlock_verdict_events;
CREATE TRIGGER core_bootstrap_deadlock_events_no_mutation
BEFORE UPDATE OR DELETE ON core_bootstrap_deadlock_verdict_events
FOR EACH ROW EXECUTE FUNCTION core_bootstrap_deadlock_forbid_mutation();

INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260810_bootstrap_deadlock_verdicts_v1')
ON CONFLICT DO NOTHING;

COMMIT;
