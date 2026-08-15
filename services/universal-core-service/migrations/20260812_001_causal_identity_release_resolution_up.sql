-- migration: 20260812_001_causal_identity_release_resolution_v1
-- Additive, restart-safe PostgreSQL 16+ authority projection.
ALTER TABLE core_projects
  ADD COLUMN IF NOT EXISTS derived_from_intent_revision_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='core_projects_derived_from_intent_revision_fk'
       AND conrelid=to_regclass('core_projects')
  ) THEN
    ALTER TABLE core_projects
      ADD CONSTRAINT core_projects_derived_from_intent_revision_fk
      FOREIGN KEY (tenant_id, derived_from_intent_revision_id)
      REFERENCES core_intent_revisions (tenant_id, intent_revision_id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END;
$$;

ALTER TABLE core_projects
  VALIDATE CONSTRAINT core_projects_derived_from_intent_revision_fk;

CREATE TABLE IF NOT EXISTS core_release_tuple_resolutions (
  tenant_id TEXT NOT NULL,
  resolution_id UUID NOT NULL,
  project_id UUID NOT NULL,
  project_state_digest CHAR(64) NOT NULL,
  genesis_intent_id UUID NOT NULL,
  intent_revision_id UUID NOT NULL,
  work_id UUID NOT NULL,
  change_id UUID NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('PRE_ACTION','POST_ACTION')),
  pull_request BIGINT NOT NULL CHECK (pull_request > 0),
  lookup_key JSONB NOT NULL,
  lookup_digest CHAR(64) NOT NULL,
  release_tuple JSONB NOT NULL,
  release_tuple_digest CHAR(64) NOT NULL,
  provenance JSONB NOT NULL,
  provenance_digest CHAR(64) NOT NULL,
  event_sequence BIGINT NOT NULL CHECK (event_sequence > 0),
  observed_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > observed_at),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, resolution_id),
  UNIQUE (tenant_id, project_id, work_id, change_id, phase, lookup_digest),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, genesis_intent_id)
    REFERENCES core_genesis_intents (tenant_id, genesis_intent_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, intent_revision_id)
    REFERENCES core_intent_revisions (tenant_id, intent_revision_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, work_id)
    REFERENCES core_work_causal_bindings (tenant_id, work_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, change_id)
    REFERENCES core_changes (tenant_id, change_id) ON DELETE RESTRICT,
  CHECK (jsonb_typeof(lookup_key) = 'object'),
  CHECK (jsonb_typeof(release_tuple) = 'object'),
  CHECK (jsonb_typeof(provenance) = 'object')
);

CREATE INDEX IF NOT EXISTS core_release_tuple_resolution_read_idx
  ON core_release_tuple_resolutions
  (tenant_id, project_id, work_id, change_id, phase, event_sequence DESC);

DROP TRIGGER IF EXISTS core_release_tuple_resolutions_append_only
  ON core_release_tuple_resolutions;
CREATE TRIGGER core_release_tuple_resolutions_append_only
BEFORE UPDATE OR DELETE ON core_release_tuple_resolutions
FOR EACH ROW EXECUTE FUNCTION core_causal_append_only_guard();
