CREATE TABLE IF NOT EXISTS core_entity360_registry (
  tenant_id varchar(120) NOT NULL,
  registry_kind varchar(40) NOT NULL,
  registry_id varchar(160) NOT NULL,
  registry_version varchar(160) NOT NULL,
  payload jsonb NOT NULL,
  payload_digest char(64) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'ACTIVE',
  created_by varchar(240) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, registry_kind, registry_id, registry_version),
  CONSTRAINT core_entity360_registry_kind_check
    CHECK (registry_kind IN ('SCHEMA','ONTOLOGY','ADAPTER','POLICY','SOURCE')),
  CONSTRAINT core_entity360_registry_status_check
    CHECK (status IN ('ACTIVE','DEPRECATED','REVOKED')),
  CONSTRAINT core_entity360_registry_digest_check
    CHECK (payload_digest ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS core_entity360_registry_lookup_idx
  ON core_entity360_registry (tenant_id, registry_kind, registry_id, created_at DESC);

CREATE TABLE IF NOT EXISTS core_entity360_feature_flags (
  tenant_id varchar(120) NOT NULL,
  flag_id varchar(160) NOT NULL,
  mode varchar(20) NOT NULL DEFAULT 'OFF',
  enabled boolean NOT NULL DEFAULT false,
  policy_digest char(64),
  enforcement_authority_digest char(64),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_digest char(64) NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  updated_by varchar(240) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, flag_id),
  CONSTRAINT core_entity360_feature_mode_check
    CHECK (mode IN ('OFF','SHADOW','ADVISORY','ENFORCED')),
  CONSTRAINT core_entity360_feature_policy_digest_check
    CHECK (policy_digest IS NULL OR policy_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_feature_authority_digest_check
    CHECK (enforcement_authority_digest IS NULL OR enforcement_authority_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_feature_config_digest_check
    CHECK (config_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_feature_enforcement_check
    CHECK (mode <> 'ENFORCED' OR enabled = false OR enforcement_authority_digest IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS core_entity360_entity_heads (
  tenant_id varchar(120) NOT NULL,
  entity_id varchar(160) NOT NULL,
  entity_type varchar(80) NOT NULL,
  identity_digest char(64) NOT NULL,
  current_snapshot_version bigint NOT NULL DEFAULT 0,
  current_snapshot_digest char(64),
  revision bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, entity_id),
  CONSTRAINT core_entity360_head_identity_digest_check
    CHECK (identity_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_head_snapshot_digest_check
    CHECK (current_snapshot_digest IS NULL OR current_snapshot_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_head_version_check
    CHECK (current_snapshot_version >= 0 AND revision >= 0),
  CONSTRAINT core_entity360_head_empty_check
    CHECK ((current_snapshot_version = 0 AND current_snapshot_digest IS NULL)
      OR (current_snapshot_version > 0 AND current_snapshot_digest IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS core_entity360_snapshots (
  tenant_id varchar(120) NOT NULL,
  entity_id varchar(160) NOT NULL,
  entity_type varchar(80) NOT NULL,
  snapshot_version bigint NOT NULL,
  snapshot_digest char(64) NOT NULL,
  envelope_digest char(64) NOT NULL,
  previous_snapshot_digest char(64),
  schema_version varchar(160) NOT NULL,
  ontology_version varchar(160) NOT NULL,
  ontology_digest char(64) NOT NULL,
  policy_version varchar(160) NOT NULL,
  policy_digest char(64) NOT NULL,
  context_status varchar(24) NOT NULL,
  as_of timestamptz NOT NULL,
  snapshot jsonb NOT NULL,
  created_by varchar(240) NOT NULL,
  persisted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, entity_id, snapshot_version),
  UNIQUE (tenant_id, entity_id, snapshot_digest),
  FOREIGN KEY (tenant_id, entity_id)
    REFERENCES core_entity360_entity_heads (tenant_id, entity_id) ON DELETE RESTRICT,
  CONSTRAINT core_entity360_snapshot_version_check CHECK (snapshot_version > 0),
  CONSTRAINT core_entity360_snapshot_digest_check CHECK (snapshot_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_snapshot_envelope_digest_check CHECK (envelope_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_snapshot_previous_digest_check
    CHECK (previous_snapshot_digest IS NULL OR previous_snapshot_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_snapshot_chain_check
    CHECK ((snapshot_version = 1 AND previous_snapshot_digest IS NULL)
      OR (snapshot_version > 1 AND previous_snapshot_digest IS NOT NULL)),
  CONSTRAINT core_entity360_snapshot_ontology_digest_check CHECK (ontology_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_snapshot_policy_digest_check CHECK (policy_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_snapshot_context_status_check
    CHECK (context_status IN ('READY','INCOMPLETE','CONFLICTED','AMBIGUOUS','INVALID')),
  CONSTRAINT core_entity360_snapshot_scope_binding_check CHECK (
    (snapshot->>'tenant_scope') IS NOT DISTINCT FROM tenant_id
    AND (snapshot->>'entity_id') IS NOT DISTINCT FROM entity_id
    AND (snapshot->>'entity_type') IS NOT DISTINCT FROM entity_type
    AND (snapshot->>'snapshot_version')::bigint IS NOT DISTINCT FROM snapshot_version
    AND (snapshot->>'deterministic_immutable_digest') IS NOT DISTINCT FROM snapshot_digest
    AND (snapshot->>'envelope_digest') IS NOT DISTINCT FROM envelope_digest
    AND (snapshot->>'previous_snapshot_digest') IS NOT DISTINCT FROM previous_snapshot_digest
    AND (snapshot->>'schema_version') IS NOT DISTINCT FROM schema_version
    AND (snapshot->>'ontology_version') IS NOT DISTINCT FROM ontology_version
    AND (snapshot->>'ontology_digest') IS NOT DISTINCT FROM ontology_digest
    AND (snapshot->>'policy_version') IS NOT DISTINCT FROM policy_version
    AND (snapshot->>'policy_digest') IS NOT DISTINCT FROM policy_digest
    AND (snapshot->>'context_status') IS NOT DISTINCT FROM context_status
    AND ((snapshot->>'as_of')::timestamptz) IS NOT DISTINCT FROM as_of
  )
);

CREATE INDEX IF NOT EXISTS core_entity360_snapshots_as_of_idx
  ON core_entity360_snapshots (tenant_id, entity_id, as_of DESC, snapshot_version DESC);
CREATE INDEX IF NOT EXISTS core_entity360_snapshots_work_idx
  ON core_entity360_snapshots
    (tenant_id, ((snapshot->'project_work_linkage'->>'work_id')), snapshot_version DESC)
  WHERE snapshot->'project_work_linkage'->>'work_id' IS NOT NULL;

CREATE TABLE IF NOT EXISTS core_entity360_shadow_receipts (
  tenant_id varchar(120) NOT NULL,
  entity_id varchar(160) NOT NULL,
  snapshot_version bigint NOT NULL,
  comparison_digest char(64) NOT NULL,
  snapshot_digest char(64) NOT NULL,
  receipt jsonb NOT NULL,
  created_by varchar(240) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, entity_id, snapshot_version, comparison_digest),
  FOREIGN KEY (tenant_id, entity_id, snapshot_version)
    REFERENCES core_entity360_snapshots (tenant_id, entity_id, snapshot_version) ON DELETE RESTRICT,
  CONSTRAINT core_entity360_shadow_comparison_digest_check
    CHECK (comparison_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_shadow_snapshot_digest_check
    CHECK (snapshot_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_shadow_receipt_binding_check CHECK (
    (receipt->>'comparison_digest') IS NOT DISTINCT FROM comparison_digest
    AND (receipt->>'snapshot_digest') IS NOT DISTINCT FROM snapshot_digest
  )
);

CREATE INDEX IF NOT EXISTS core_entity360_shadow_receipts_metrics_idx
  ON core_entity360_shadow_receipts (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS core_entity360_idempotency (
  tenant_id varchar(120) NOT NULL,
  operation varchar(80) NOT NULL,
  idempotency_key varchar(240) NOT NULL,
  payload_digest char(64) NOT NULL,
  result_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, operation, idempotency_key),
  CONSTRAINT core_entity360_idempotency_digest_check
    CHECK (payload_digest ~ '^[a-f0-9]{64}$')
);

CREATE TABLE IF NOT EXISTS core_entity360_backfill_checkpoints (
  tenant_id varchar(120) NOT NULL,
  job_id varchar(160) NOT NULL,
  target_entity_type varchar(80) NOT NULL,
  source_binding jsonb NOT NULL,
  source_binding_digest char(64) NOT NULL,
  cursor_payload jsonb NOT NULL DEFAULT
    '{"schema_version":"entity360_backfill_cursor_v1","position":0,"keyset":{},"previous_cursor_digest":null}'::jsonb,
  cursor_digest char(64) NOT NULL,
  cursor_position bigint NOT NULL DEFAULT 0,
  previous_cursor_digest char(64),
  processed_count bigint NOT NULL DEFAULT 0,
  rejected_count bigint NOT NULL DEFAULT 0,
  state varchar(24) NOT NULL DEFAULT 'PENDING',
  revision bigint NOT NULL DEFAULT 0,
  read_only_source boolean NOT NULL DEFAULT true,
  destructive_action boolean NOT NULL DEFAULT false,
  created_by varchar(240) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, job_id),
  CONSTRAINT core_entity360_backfill_binding_digest_check
    CHECK (source_binding_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_backfill_source_scope_check CHECK (
    jsonb_typeof(source_binding) = 'object'
    AND source_binding ?& ARRAY['schema_version','tenant_scope','source_id','selector']::text[]
    AND (source_binding - ARRAY['schema_version','tenant_scope','source_id','selector']::text[]) = '{}'::jsonb
    AND source_binding->>'schema_version' = 'entity360_backfill_source_binding_v1'
    AND source_binding->>'tenant_scope' = tenant_id
    AND source_binding->>'source_id' ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'
    AND jsonb_typeof(source_binding->'selector') = 'object'
  ),
  CONSTRAINT core_entity360_backfill_cursor_digest_check
    CHECK (cursor_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_backfill_previous_cursor_digest_check
    CHECK (previous_cursor_digest IS NULL OR previous_cursor_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_backfill_cursor_binding_check CHECK (
    jsonb_typeof(cursor_payload) = 'object'
    AND cursor_payload ?& ARRAY['schema_version','position','keyset','previous_cursor_digest']::text[]
    AND cursor_payload - ARRAY['schema_version','position','keyset','previous_cursor_digest']::text[] = '{}'::jsonb
    AND cursor_payload->>'schema_version' = 'entity360_backfill_cursor_v1'
    AND jsonb_typeof(cursor_payload->'position') = 'number'
    AND cursor_payload->>'position' ~ '^(0|[1-9][0-9]*)$'
    AND (cursor_payload->>'position')::bigint = cursor_position
    AND jsonb_typeof(cursor_payload->'keyset') = 'object'
    AND (cursor_payload->'previous_cursor_digest' = 'null'::jsonb
      OR jsonb_typeof(cursor_payload->'previous_cursor_digest') = 'string')
    AND (cursor_payload->>'previous_cursor_digest') IS NOT DISTINCT FROM previous_cursor_digest
  ),
  CONSTRAINT core_entity360_backfill_state_check
    CHECK (state IN ('PENDING','RUNNING','PAUSED','COMPLETED','FAILED','CANCELLED')),
  CONSTRAINT core_entity360_backfill_progress_check
    CHECK (processed_count >= 0 AND rejected_count >= 0 AND cursor_position >= 0
      AND cursor_position = processed_count + rejected_count AND revision >= 0),
  CONSTRAINT core_entity360_backfill_non_destructive_check
    CHECK (read_only_source = true AND destructive_action = false)
);

CREATE TABLE IF NOT EXISTS core_entity360_backfill_events (
  tenant_id varchar(120) NOT NULL,
  job_id varchar(160) NOT NULL,
  sequence_number bigint NOT NULL,
  expected_revision bigint NOT NULL,
  new_revision bigint NOT NULL,
  state varchar(24) NOT NULL,
  cursor_digest char(64) NOT NULL,
  cursor_position bigint NOT NULL,
  previous_cursor_digest char(64),
  processed_count bigint NOT NULL,
  rejected_count bigint NOT NULL,
  progress_payload jsonb NOT NULL,
  progress_digest char(64) NOT NULL,
  created_by varchar(240) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, job_id, sequence_number),
  UNIQUE (tenant_id, job_id, new_revision),
  FOREIGN KEY (tenant_id, job_id)
    REFERENCES core_entity360_backfill_checkpoints (tenant_id, job_id) ON DELETE RESTRICT,
  CONSTRAINT core_entity360_backfill_event_revision_check
    CHECK (expected_revision >= 0 AND new_revision = expected_revision + 1
      AND sequence_number = new_revision),
  CONSTRAINT core_entity360_backfill_event_cursor_digest_check
    CHECK (cursor_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_backfill_event_previous_cursor_digest_check
    CHECK (previous_cursor_digest IS NULL OR previous_cursor_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_backfill_event_state_check
    CHECK (state IN ('RUNNING','PAUSED','COMPLETED','FAILED','CANCELLED')),
  CONSTRAINT core_entity360_backfill_event_progress_check
    CHECK (cursor_position >= 0 AND processed_count >= 0 AND rejected_count >= 0
      AND cursor_position = processed_count + rejected_count),
  CONSTRAINT core_entity360_backfill_event_progress_binding_check CHECK (
    jsonb_typeof(progress_payload) = 'object'
    AND progress_payload ?& ARRAY['cursor_payload','cursor_position','previous_cursor_digest',
      'processed_count','rejected_count','state']::text[]
    AND progress_payload - ARRAY['cursor_payload','cursor_position','previous_cursor_digest',
      'processed_count','rejected_count','state']::text[] = '{}'::jsonb
    AND jsonb_typeof(progress_payload->'cursor_position') = 'number'
    AND progress_payload->>'cursor_position' ~ '^(0|[1-9][0-9]*)$'
    AND (progress_payload->>'cursor_position')::bigint = cursor_position
    AND (progress_payload->'previous_cursor_digest' = 'null'::jsonb
      OR jsonb_typeof(progress_payload->'previous_cursor_digest') = 'string')
    AND (progress_payload->>'previous_cursor_digest') IS NOT DISTINCT FROM previous_cursor_digest
    AND jsonb_typeof(progress_payload->'processed_count') = 'number'
    AND progress_payload->>'processed_count' ~ '^(0|[1-9][0-9]*)$'
    AND (progress_payload->>'processed_count')::bigint = processed_count
    AND jsonb_typeof(progress_payload->'rejected_count') = 'number'
    AND progress_payload->>'rejected_count' ~ '^(0|[1-9][0-9]*)$'
    AND (progress_payload->>'rejected_count')::bigint = rejected_count
    AND jsonb_typeof(progress_payload->'state') = 'string'
    AND progress_payload->>'state' = state
    AND jsonb_typeof(progress_payload->'cursor_payload') = 'object'
    AND (progress_payload->'cursor_payload')
      ?& ARRAY['schema_version','position','keyset','previous_cursor_digest']::text[]
    AND ((progress_payload->'cursor_payload')
      - ARRAY['schema_version','position','keyset','previous_cursor_digest']::text[]) = '{}'::jsonb
    AND progress_payload->'cursor_payload'->>'schema_version' = 'entity360_backfill_cursor_v1'
    AND jsonb_typeof(progress_payload->'cursor_payload'->'position') = 'number'
    AND progress_payload->'cursor_payload'->>'position' ~ '^(0|[1-9][0-9]*)$'
    AND (progress_payload->'cursor_payload'->>'position')::bigint = cursor_position
    AND jsonb_typeof(progress_payload->'cursor_payload'->'keyset') = 'object'
    AND (progress_payload->'cursor_payload'->'previous_cursor_digest' = 'null'::jsonb
      OR jsonb_typeof(progress_payload->'cursor_payload'->'previous_cursor_digest') = 'string')
    AND (progress_payload->'cursor_payload'->>'previous_cursor_digest')
      IS NOT DISTINCT FROM previous_cursor_digest
  ),
  CONSTRAINT core_entity360_backfill_event_progress_digest_check
    CHECK (progress_digest ~ '^[a-f0-9]{64}$')
);

CREATE OR REPLACE FUNCTION core_entity360_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'core_entity360_append_only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION core_entity360_guard_backfill_checkpoint() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'core_entity360_backfill_checkpoint_immutable';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NEW.target_entity_type IS DISTINCT FROM OLD.target_entity_type
     OR NEW.source_binding IS DISTINCT FROM OLD.source_binding
     OR NEW.source_binding_digest IS DISTINCT FROM OLD.source_binding_digest
     OR NEW.read_only_source IS DISTINCT FROM true
     OR NEW.destructive_action IS DISTINCT FROM false
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'core_entity360_backfill_checkpoint_immutable';
  END IF;
  IF OLD.state IN ('COMPLETED','FAILED','CANCELLED') THEN
    RAISE EXCEPTION 'core_entity360_backfill_terminal';
  END IF;
  IF NOT (
    (OLD.state = 'PENDING' AND NEW.state IN ('RUNNING','FAILED','CANCELLED'))
    OR (OLD.state = 'RUNNING' AND NEW.state IN ('RUNNING','PAUSED','COMPLETED','FAILED','CANCELLED'))
    OR (OLD.state = 'PAUSED' AND NEW.state IN ('RUNNING','FAILED','CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'core_entity360_backfill_transition_invalid';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'core_entity360_backfill_revision_non_monotonic';
  END IF;
  IF NEW.processed_count < OLD.processed_count
     OR NEW.rejected_count < OLD.rejected_count
     OR NEW.cursor_position < OLD.cursor_position
     OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'core_entity360_backfill_progress_regression';
  END IF;
  IF NEW.cursor_position = OLD.cursor_position THEN
    IF NEW.cursor_payload IS DISTINCT FROM OLD.cursor_payload
       OR NEW.cursor_digest IS DISTINCT FROM OLD.cursor_digest
       OR NEW.previous_cursor_digest IS DISTINCT FROM OLD.previous_cursor_digest
       OR NEW.processed_count IS DISTINCT FROM OLD.processed_count
       OR NEW.rejected_count IS DISTINCT FROM OLD.rejected_count THEN
      RAISE EXCEPTION 'core_entity360_backfill_cursor_non_monotonic';
    END IF;
    IF NEW.state = OLD.state THEN
      RAISE EXCEPTION 'core_entity360_backfill_noop_checkpoint';
    END IF;
  ELSIF NEW.previous_cursor_digest IS DISTINCT FROM OLD.cursor_digest THEN
    RAISE EXCEPTION 'core_entity360_backfill_cursor_chain_mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION core_entity360_guard_backfill_checkpoint_create() RETURNS trigger AS $$
BEGIN
  IF NEW.state <> 'PENDING' OR NEW.revision <> 0 OR NEW.cursor_position <> 0
     OR NEW.processed_count <> 0 OR NEW.rejected_count <> 0
     OR NEW.previous_cursor_digest IS NOT NULL
     OR NEW.cursor_payload->'keyset' IS DISTINCT FROM '{}'::jsonb
     OR NEW.read_only_source IS DISTINCT FROM true
     OR NEW.destructive_action IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'core_entity360_backfill_initial_state_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION core_entity360_require_backfill_event() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM core_entity360_backfill_events event_row
     WHERE event_row.tenant_id = NEW.tenant_id
       AND event_row.job_id = NEW.job_id
       AND event_row.sequence_number = NEW.revision
       AND event_row.expected_revision = OLD.revision
       AND event_row.new_revision = NEW.revision
       AND event_row.state = NEW.state
       AND event_row.cursor_digest = NEW.cursor_digest
       AND event_row.cursor_position = NEW.cursor_position
       AND event_row.previous_cursor_digest IS NOT DISTINCT FROM NEW.previous_cursor_digest
       AND event_row.processed_count = NEW.processed_count
       AND event_row.rejected_count = NEW.rejected_count
       AND event_row.progress_payload->'cursor_payload' = NEW.cursor_payload
  ) THEN
    RAISE EXCEPTION 'core_entity360_backfill_event_required';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION core_entity360_require_backfill_checkpoint() RETURNS trigger AS $$
DECLARE
  head core_entity360_backfill_checkpoints%ROWTYPE;
  previous_event core_entity360_backfill_events%ROWTYPE;
BEGIN
  SELECT * INTO head FROM core_entity360_backfill_checkpoints
   WHERE tenant_id = NEW.tenant_id AND job_id = NEW.job_id;
  IF NOT FOUND OR head.revision <> NEW.new_revision OR head.state <> NEW.state
     OR head.cursor_digest <> NEW.cursor_digest OR head.cursor_position <> NEW.cursor_position
     OR head.previous_cursor_digest IS DISTINCT FROM NEW.previous_cursor_digest
     OR head.processed_count <> NEW.processed_count OR head.rejected_count <> NEW.rejected_count
     OR head.cursor_payload IS DISTINCT FROM NEW.progress_payload->'cursor_payload' THEN
    RAISE EXCEPTION 'core_entity360_backfill_checkpoint_required';
  END IF;
  IF NEW.expected_revision > 0 THEN
    SELECT * INTO previous_event FROM core_entity360_backfill_events
     WHERE tenant_id = NEW.tenant_id AND job_id = NEW.job_id
       AND sequence_number = NEW.expected_revision;
    IF NOT FOUND OR previous_event.new_revision <> NEW.expected_revision
       OR NEW.processed_count < previous_event.processed_count
       OR NEW.rejected_count < previous_event.rejected_count
       OR NEW.cursor_position < previous_event.cursor_position
       OR (NEW.cursor_position = previous_event.cursor_position AND (
         NEW.cursor_digest IS DISTINCT FROM previous_event.cursor_digest
         OR NEW.processed_count IS DISTINCT FROM previous_event.processed_count
         OR NEW.rejected_count IS DISTINCT FROM previous_event.rejected_count
       ))
       OR (NEW.cursor_position > previous_event.cursor_position
         AND NEW.previous_cursor_digest IS DISTINCT FROM previous_event.cursor_digest) THEN
      RAISE EXCEPTION 'core_entity360_backfill_event_chain_invalid';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS core_entity360_registry_append_only ON core_entity360_registry;
CREATE TRIGGER core_entity360_registry_append_only
  BEFORE UPDATE OR DELETE ON core_entity360_registry
  FOR EACH ROW EXECUTE FUNCTION core_entity360_reject_mutation();
DROP TRIGGER IF EXISTS core_entity360_registry_truncate_guard ON core_entity360_registry;
CREATE TRIGGER core_entity360_registry_truncate_guard
  BEFORE TRUNCATE ON core_entity360_registry
  FOR EACH STATEMENT EXECUTE FUNCTION core_entity360_reject_mutation();

DROP TRIGGER IF EXISTS core_entity360_snapshots_append_only ON core_entity360_snapshots;
CREATE TRIGGER core_entity360_snapshots_append_only
  BEFORE UPDATE OR DELETE ON core_entity360_snapshots
  FOR EACH ROW EXECUTE FUNCTION core_entity360_reject_mutation();
DROP TRIGGER IF EXISTS core_entity360_snapshots_truncate_guard ON core_entity360_snapshots;
CREATE TRIGGER core_entity360_snapshots_truncate_guard
  BEFORE TRUNCATE ON core_entity360_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION core_entity360_reject_mutation();

DROP TRIGGER IF EXISTS core_entity360_idempotency_append_only ON core_entity360_idempotency;
CREATE TRIGGER core_entity360_idempotency_append_only
  BEFORE UPDATE OR DELETE ON core_entity360_idempotency
  FOR EACH ROW EXECUTE FUNCTION core_entity360_reject_mutation();
DROP TRIGGER IF EXISTS core_entity360_idempotency_truncate_guard ON core_entity360_idempotency;
CREATE TRIGGER core_entity360_idempotency_truncate_guard
  BEFORE TRUNCATE ON core_entity360_idempotency
  FOR EACH STATEMENT EXECUTE FUNCTION core_entity360_reject_mutation();

DROP TRIGGER IF EXISTS core_entity360_shadow_receipts_append_only ON core_entity360_shadow_receipts;
CREATE TRIGGER core_entity360_shadow_receipts_append_only
  BEFORE UPDATE OR DELETE ON core_entity360_shadow_receipts
  FOR EACH ROW EXECUTE FUNCTION core_entity360_reject_mutation();
DROP TRIGGER IF EXISTS core_entity360_shadow_receipts_truncate_guard ON core_entity360_shadow_receipts;
CREATE TRIGGER core_entity360_shadow_receipts_truncate_guard
  BEFORE TRUNCATE ON core_entity360_shadow_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION core_entity360_reject_mutation();

DROP TRIGGER IF EXISTS core_entity360_backfill_events_append_only ON core_entity360_backfill_events;
CREATE TRIGGER core_entity360_backfill_events_append_only
  BEFORE UPDATE OR DELETE ON core_entity360_backfill_events
  FOR EACH ROW EXECUTE FUNCTION core_entity360_reject_mutation();
DROP TRIGGER IF EXISTS core_entity360_backfill_events_truncate_guard ON core_entity360_backfill_events;
CREATE TRIGGER core_entity360_backfill_events_truncate_guard
  BEFORE TRUNCATE ON core_entity360_backfill_events
  FOR EACH STATEMENT EXECUTE FUNCTION core_entity360_reject_mutation();

DROP TRIGGER IF EXISTS core_entity360_backfill_checkpoints_state_guard
  ON core_entity360_backfill_checkpoints;
CREATE TRIGGER core_entity360_backfill_checkpoints_state_guard
  BEFORE UPDATE OR DELETE ON core_entity360_backfill_checkpoints
  FOR EACH ROW EXECUTE FUNCTION core_entity360_guard_backfill_checkpoint();
DROP TRIGGER IF EXISTS core_entity360_backfill_checkpoints_create_guard
  ON core_entity360_backfill_checkpoints;
CREATE TRIGGER core_entity360_backfill_checkpoints_create_guard
  BEFORE INSERT ON core_entity360_backfill_checkpoints
  FOR EACH ROW EXECUTE FUNCTION core_entity360_guard_backfill_checkpoint_create();
DROP TRIGGER IF EXISTS core_entity360_backfill_checkpoints_truncate_guard
  ON core_entity360_backfill_checkpoints;
CREATE TRIGGER core_entity360_backfill_checkpoints_truncate_guard
  BEFORE TRUNCATE ON core_entity360_backfill_checkpoints
  FOR EACH STATEMENT EXECUTE FUNCTION core_entity360_guard_backfill_checkpoint();

DROP TRIGGER IF EXISTS core_entity360_backfill_checkpoint_event_pair_guard
  ON core_entity360_backfill_checkpoints;
CREATE CONSTRAINT TRIGGER core_entity360_backfill_checkpoint_event_pair_guard
  AFTER UPDATE ON core_entity360_backfill_checkpoints
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION core_entity360_require_backfill_event();

DROP TRIGGER IF EXISTS core_entity360_backfill_event_checkpoint_pair_guard
  ON core_entity360_backfill_events;
CREATE CONSTRAINT TRIGGER core_entity360_backfill_event_checkpoint_pair_guard
  AFTER INSERT ON core_entity360_backfill_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION core_entity360_require_backfill_checkpoint();
