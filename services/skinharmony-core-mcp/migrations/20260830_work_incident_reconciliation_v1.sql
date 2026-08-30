-- Make incident lifecycle exact to one tenant Work while retaining the
-- project-scoped runbook as a reusable recipe. Historical blockers are not
-- backfilled at startup: an authorized exact-Work reconciliation validates
-- the immutable ledger and Gallery readback before adopting one.
BEGIN;

-- The V2 runtime bootstrap already declares these additive projection cursor
-- fields. Register them in the deployable migration as well so a rolling
-- deploy cannot run the incident projector against an older tenant_work
-- shape.
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS legacy_projection_sequence bigint NOT NULL DEFAULT 0;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS legacy_projection_event_hash char(64);
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS legacy_projection_updated_at timestamptz;
ALTER TABLE core_continuity_works
  ADD COLUMN IF NOT EXISTS block_source varchar(64),
  ADD COLUMN IF NOT EXISTS block_reference varchar(160),
  ADD COLUMN IF NOT EXISTS block_epoch bigint NOT NULL DEFAULT 0;

-- Verification remains authoritative only while both the native receipt and
-- its PR357 Gallery bridge remain durable. Existing row guards did not cover
-- a table-wide TRUNCATE, so converge statement-level guards here as part of
-- the incident lifecycle migration.
DROP TRIGGER IF EXISTS core_continuity_native_receipts_no_truncate
  ON core_continuity_native_receipts;
CREATE TRIGGER core_continuity_native_receipts_no_truncate
BEFORE TRUNCATE ON core_continuity_native_receipts
FOR EACH STATEMENT EXECUTE FUNCTION core_continuity_native_receipts_append_only();
DROP TRIGGER IF EXISTS tenant_work_native_verifier_evidence_no_truncate
  ON tenant_work_native_verifier_evidence;
CREATE TRIGGER tenant_work_native_verifier_evidence_no_truncate
BEFORE TRUNCATE ON tenant_work_native_verifier_evidence
FOR EACH STATEMENT EXECUTE FUNCTION tenant_work_native_verifier_evidence_append_only();
DROP TRIGGER IF EXISTS core_continuity_events_no_truncate ON core_continuity_events;
CREATE TRIGGER core_continuity_events_no_truncate
BEFORE TRUNCATE ON core_continuity_events
FOR EACH STATEMENT EXECUTE FUNCTION core_continuity_events_append_only();

CREATE UNIQUE INDEX IF NOT EXISTS core_continuity_works_tenant_work_project_uidx
  ON core_continuity_works (tenant_id,work_id,project_id);
CREATE TABLE IF NOT EXISTS core_continuity_work_incidents (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, project_id varchar(64) NOT NULL,
  fingerprint char(64) NOT NULL, scope_digest char(64) NOT NULL, runbook_digest char(64) NOT NULL,
  error_code varchar(120) NOT NULL, reason varchar(500) NOT NULL, reason_digest char(64) NOT NULL,
  source_operation varchar(120) NOT NULL, source_plan_id uuid, source_agent_id varchar(120) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'candidate', blocks_work boolean NOT NULL DEFAULT true,
  created_by varchar(120) NOT NULL, verified_by varchar(120),
  verification_evidence jsonb, verification_digest char(64),
  verification_count integer NOT NULL DEFAULT 0, failure_count integer NOT NULL DEFAULT 0,
  state_version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, fingerprint),
  CHECK (status IN ('candidate','verified','quarantined')),
  CHECK (state_version = verification_count::bigint + failure_count::bigint),
  CHECK (status <> 'candidate' OR (verification_count=0 AND failure_count < 2)),
  CHECK (status <> 'quarantined' OR (verification_count=0 AND failure_count >= 2)),
  CHECK (status <> 'verified' OR (verification_count=1 AND verified_by IS NOT NULL AND
    verification_evidence IS NOT NULL AND verification_digest IS NOT NULL)),
  FOREIGN KEY (tenant_id, work_id, project_id)
    REFERENCES core_continuity_works(tenant_id, work_id, project_id),
  FOREIGN KEY (tenant_id, project_id, fingerprint)
    REFERENCES core_continuity_incident_runbooks(tenant_id, project_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS core_continuity_work_incidents_status_idx
  ON core_continuity_work_incidents (tenant_id, work_id, status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS core_continuity_work_incidents_project_binding_uidx
  ON core_continuity_work_incidents (tenant_id, work_id, project_id, fingerprint);
CREATE OR REPLACE FUNCTION core_continuity_work_incidents_monotone() RETURNS trigger AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
      NEW.work_id IS DISTINCT FROM OLD.work_id OR
      NEW.project_id IS DISTINCT FROM OLD.project_id OR
      NEW.fingerprint IS DISTINCT FROM OLD.fingerprint OR
      NEW.scope_digest IS DISTINCT FROM OLD.scope_digest OR
      NEW.runbook_digest IS DISTINCT FROM OLD.runbook_digest OR
      NEW.error_code IS DISTINCT FROM OLD.error_code OR
      NEW.reason IS DISTINCT FROM OLD.reason OR
      NEW.reason_digest IS DISTINCT FROM OLD.reason_digest OR
      NEW.source_operation IS DISTINCT FROM OLD.source_operation OR
      NEW.source_plan_id IS DISTINCT FROM OLD.source_plan_id OR
      NEW.source_agent_id IS DISTINCT FROM OLD.source_agent_id OR
      NEW.blocks_work IS DISTINCT FROM OLD.blocks_work OR
      NEW.created_by IS DISTINCT FROM OLD.created_by OR
      NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'core_continuity_work_incident_binding_immutable';
  END IF;
  IF OLD.status='verified' THEN
    RAISE EXCEPTION 'core_continuity_work_incident_verified_immutable';
  END IF;
  IF NEW.state_version <> OLD.state_version + 1 THEN
    RAISE EXCEPTION 'core_continuity_work_incident_version_cas_required';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'core_continuity_work_incident_timestamp_regression';
  END IF;
  IF OLD.status='candidate' AND NEW.status='candidate' THEN
    IF NEW.failure_count <> OLD.failure_count + 1 OR
        NEW.verification_count <> OLD.verification_count OR
        NEW.verified_by IS NOT NULL OR NEW.verification_evidence IS NULL OR
        NEW.verification_digest IS NULL OR
        NEW.verification_digest IS NOT DISTINCT FROM OLD.verification_digest THEN
      RAISE EXCEPTION 'core_continuity_work_incident_failed_transition_invalid';
    END IF;
  ELSIF OLD.status='candidate' AND NEW.status='quarantined' THEN
    IF NEW.failure_count <> OLD.failure_count + 1 OR NEW.failure_count < 2 OR
        NEW.verification_count <> OLD.verification_count OR
        NEW.verified_by IS NOT NULL OR NEW.verification_evidence IS NULL OR
        NEW.verification_digest IS NULL OR
        NEW.verification_digest IS NOT DISTINCT FROM OLD.verification_digest THEN
      RAISE EXCEPTION 'core_continuity_work_incident_quarantine_transition_invalid';
    END IF;
  ELSIF OLD.status IN ('candidate','quarantined') AND NEW.status='verified' THEN
    IF NEW.verification_count <> OLD.verification_count + 1 OR
        NEW.failure_count <> OLD.failure_count OR NEW.verified_by IS NULL OR
        NEW.verification_evidence IS NULL OR NEW.verification_digest IS NULL OR
        NEW.verification_digest IS NOT DISTINCT FROM OLD.verification_digest THEN
      RAISE EXCEPTION 'core_continuity_work_incident_verification_transition_invalid';
    END IF;
  ELSE
    RAISE EXCEPTION 'core_continuity_work_incident_terminal_regression';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS core_continuity_work_incidents_monotone_guard
  ON core_continuity_work_incidents;
CREATE TRIGGER core_continuity_work_incidents_monotone_guard
BEFORE UPDATE ON core_continuity_work_incidents
FOR EACH ROW EXECUTE FUNCTION core_continuity_work_incidents_monotone();
CREATE OR REPLACE FUNCTION core_continuity_work_incidents_no_removal()
RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'core_continuity_work_incidents_append_only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS core_continuity_work_incidents_no_delete
  ON core_continuity_work_incidents;
CREATE TRIGGER core_continuity_work_incidents_no_delete
BEFORE DELETE ON core_continuity_work_incidents
FOR EACH ROW EXECUTE FUNCTION core_continuity_work_incidents_no_removal();
DROP TRIGGER IF EXISTS core_continuity_work_incidents_no_truncate
  ON core_continuity_work_incidents;
CREATE TRIGGER core_continuity_work_incidents_no_truncate
BEFORE TRUNCATE ON core_continuity_work_incidents
FOR EACH STATEMENT EXECUTE FUNCTION core_continuity_work_incidents_no_removal();

CREATE OR REPLACE FUNCTION core_continuity_work_block_provenance_guard()
RETURNS trigger AS $$
BEGIN
  IF OLD.status='completed' THEN
    RAISE EXCEPTION 'core_continuity_work_completed_immutable';
  END IF;
  IF OLD.status='blocked' AND OLD.block_source IS NULL AND
      NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'core_continuity_work_legacy_block_reconciliation_required';
  END IF;
  IF NEW.block_epoch < OLD.block_epoch THEN
    RAISE EXCEPTION 'core_continuity_work_block_epoch_regression';
  END IF;
  IF (NEW.block_source IS DISTINCT FROM OLD.block_source OR
      NEW.block_reference IS DISTINCT FROM OLD.block_reference) AND
      NEW.block_epoch <= OLD.block_epoch THEN
    RAISE EXCEPTION 'core_continuity_work_block_provenance_required';
  END IF;
  IF OLD.status='blocked' AND NEW.status='blocked' AND
      OLD.block_source IS NOT NULL AND
      NEW.block_source IS DISTINCT FROM OLD.block_source AND NOT (
        OLD.block_source='native_agent_lease' AND
        NEW.block_source='work_incident' AND EXISTS (
          SELECT 1 FROM core_continuity_work_incidents i
          WHERE i.tenant_id=NEW.tenant_id AND i.work_id=NEW.work_id
            AND i.fingerprint=NEW.block_reference
            AND i.source_plan_id::text=OLD.block_reference
            AND i.source_operation IN (
              'work_continuity_native_bind','work_continuity_native_report'
            )
            AND i.blocks_work=true AND i.status IN ('candidate','quarantined')
        )
      ) THEN
    RAISE EXCEPTION 'core_continuity_work_block_provenance_conflict';
  END IF;
  IF NEW.status='blocked' AND
      (OLD.status IS DISTINCT FROM 'blocked' OR
        NEW.next_action IS DISTINCT FROM OLD.next_action OR
        NEW.block_source IS DISTINCT FROM OLD.block_source OR
        NEW.block_reference IS DISTINCT FROM OLD.block_reference) AND
      (NEW.block_source IS NULL OR NEW.block_reference IS NULL OR
        NEW.block_epoch <= OLD.block_epoch) THEN
    RAISE EXCEPTION 'core_continuity_work_block_provenance_required';
  END IF;
  IF OLD.status='blocked' AND NEW.status IS DISTINCT FROM 'blocked' AND
      (NEW.block_source IS NOT NULL OR NEW.block_reference IS NOT NULL OR
        NEW.block_epoch <= OLD.block_epoch) THEN
    RAISE EXCEPTION 'core_continuity_work_block_release_provenance_invalid';
  END IF;
  IF NEW.status<>'blocked' AND
      (NEW.block_source IS NOT NULL OR NEW.block_reference IS NOT NULL) THEN
    RAISE EXCEPTION 'core_continuity_work_block_provenance_outside_blocked';
  END IF;
  IF NEW.status IN ('active','verified','release_ready','completed') AND EXISTS (
    SELECT 1 FROM core_continuity_work_incidents i
    WHERE i.tenant_id=NEW.tenant_id AND i.work_id=NEW.work_id
      AND i.blocks_work=true AND i.status IN ('candidate','quarantined')
  ) THEN
    RAISE EXCEPTION 'core_continuity_work_incident_blocker_unresolved';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS core_continuity_work_block_provenance_guard
  ON core_continuity_works;
CREATE TRIGGER core_continuity_work_block_provenance_guard
BEFORE UPDATE ON core_continuity_works
FOR EACH ROW EXECUTE FUNCTION core_continuity_work_block_provenance_guard();

-- Rolling replicas that predate Work-scoped incident associations must fail
-- closed.  A lifecycle event is committable only after the exact association
-- and resulting Work state have been written in the same transaction.
CREATE OR REPLACE FUNCTION core_continuity_incident_event_binding_guard()
RETURNS trigger AS $$
DECLARE
  association_status varchar(32);
  association_version bigint;
  persisted_work_status varchar(32);
  persisted_next_action text;
BEGIN
  IF NEW.event_type NOT IN ('incident_recorded','incident_runbook_verified',
      'incident_runbook_verification_failed','incident_runbook_quarantined') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.payload->>'fingerprint','') !~ '^[a-f0-9]{64}$' OR
      COALESCE(NEW.payload->>'project_id','') = '' OR
      COALESCE(NEW.payload->>'status','') NOT IN ('candidate','verified','quarantined') OR
      COALESCE(NEW.payload->>'state_version','') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'core_continuity_incident_event_binding_invalid';
  END IF;
  SELECT i.status,i.state_version
    INTO association_status,association_version
  FROM core_continuity_work_incidents i
  WHERE i.tenant_id=NEW.tenant_id AND i.work_id=NEW.work_id
    AND i.project_id=NEW.payload->>'project_id'
    AND i.fingerprint=NEW.payload->>'fingerprint';
  IF association_status IS NULL OR
      association_status IS DISTINCT FROM NEW.payload->>'status' OR
      association_version IS DISTINCT FROM (NEW.payload->>'state_version')::bigint THEN
    RAISE EXCEPTION 'core_continuity_incident_event_association_required';
  END IF;
  SELECT w.status,w.next_action INTO persisted_work_status,persisted_next_action
  FROM core_continuity_works w
  WHERE w.tenant_id=NEW.tenant_id AND w.work_id=NEW.work_id;
  IF persisted_work_status IS NULL OR
      persisted_work_status IS DISTINCT FROM NEW.payload->>'work_status' OR
      persisted_next_action IS DISTINCT FROM NEW.payload->>'next_action' THEN
    RAISE EXCEPTION 'core_continuity_incident_event_work_state_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS core_continuity_incident_event_binding_guard
  ON core_continuity_events;
CREATE TRIGGER core_continuity_incident_event_binding_guard
BEFORE INSERT ON core_continuity_events
FOR EACH ROW EXECUTE FUNCTION core_continuity_incident_event_binding_guard();

CREATE TABLE IF NOT EXISTS core_continuity_work_incident_verifications (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, project_id varchar(64) NOT NULL,
  fingerprint char(64) NOT NULL, evidence_digest char(64) NOT NULL,
  native_receipt_id uuid NOT NULL, resolved boolean NOT NULL, evidence jsonb NOT NULL,
  result_status varchar(32) NOT NULL, created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, fingerprint, evidence_digest),
  UNIQUE (tenant_id, work_id, fingerprint, native_receipt_id),
  CHECK ((resolved=true AND result_status='verified') OR
    (resolved=false AND result_status IN ('candidate','quarantined'))),
  FOREIGN KEY (tenant_id, work_id, project_id, fingerprint)
    REFERENCES core_continuity_work_incidents(tenant_id, work_id, project_id, fingerprint)
);
CREATE OR REPLACE FUNCTION core_continuity_work_incident_verifications_append_only()
RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'core_continuity_work_incident_verifications_append_only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS core_continuity_work_incident_verifications_no_mutation
  ON core_continuity_work_incident_verifications;
CREATE TRIGGER core_continuity_work_incident_verifications_no_mutation
BEFORE UPDATE OR DELETE ON core_continuity_work_incident_verifications
FOR EACH ROW EXECUTE FUNCTION core_continuity_work_incident_verifications_append_only();
DROP TRIGGER IF EXISTS core_continuity_work_incident_verifications_no_truncate
  ON core_continuity_work_incident_verifications;
CREATE TRIGGER core_continuity_work_incident_verifications_no_truncate
BEFORE TRUNCATE ON core_continuity_work_incident_verifications
FOR EACH STATEMENT EXECUTE FUNCTION core_continuity_work_incident_verifications_append_only();

CREATE TABLE IF NOT EXISTS core_continuity_runtime_migrations (
  migration_id varchar(120) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO core_continuity_runtime_migrations (migration_id)
VALUES ('20260830_work_incident_reconciliation_v1')
ON CONFLICT DO NOTHING;

INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260830_work_incident_reconciliation_v1')
ON CONFLICT DO NOTHING;

COMMIT;
