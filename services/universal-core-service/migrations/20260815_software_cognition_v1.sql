BEGIN;

-- The Software Reality Graph extends the existing Work Atlas. These ALTERs
-- intentionally fail if Work Continuity has not initialized its authority
-- tables first; Universal Core must never create a parallel graph fallback.
ALTER TABLE core_continuity_atlas_nodes
  ADD COLUMN IF NOT EXISTS project_id varchar(64),
  ADD COLUMN IF NOT EXISTS source_kind varchar(80),
  ADD COLUMN IF NOT EXISTS source_ref text,
  ADD COLUMN IF NOT EXISTS source_digest char(64),
  ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS verification_state varchar(32) NOT NULL DEFAULT 'observed',
  ADD COLUMN IF NOT EXISTS confidence double precision NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS tombstoned_at timestamptz;
ALTER TABLE core_continuity_atlas_edges
  ADD COLUMN IF NOT EXISTS project_id varchar(64),
  ADD COLUMN IF NOT EXISTS edge_id varchar(64),
  ADD COLUMN IF NOT EXISTS edge_digest char(64),
  ADD COLUMN IF NOT EXISTS source varchar(120),
  ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS verification_state varchar(32) NOT NULL DEFAULT 'observed',
  ADD COLUMN IF NOT EXISTS confidence double precision NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tombstoned_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT clock_timestamp();

UPDATE core_continuity_atlas_nodes
   SET project_id=COALESCE(core_continuity_atlas_nodes.project_id,s.project_id),
       source_kind=COALESCE(source_kind,'work_atlas'),
       source_ref=COALESCE(source_ref,NULLIF(path,''),node_id),
       source_digest=COALESCE(source_digest,node_digest)
  FROM core_continuity_atlas_state s
 WHERE s.tenant_id=core_continuity_atlas_nodes.tenant_id AND s.work_id=core_continuity_atlas_nodes.work_id
   AND (core_continuity_atlas_nodes.project_id IS NULL OR source_kind IS NULL OR source_ref IS NULL OR source_digest IS NULL);
UPDATE core_continuity_atlas_edges
   SET project_id=COALESCE(core_continuity_atlas_edges.project_id,s.project_id),
       edge_id=COALESCE(edge_id,'sce_' || md5(core_continuity_atlas_edges.tenant_id || ':' || core_continuity_atlas_edges.work_id::text || ':' || from_node_id || ':' || to_node_id || ':' || edge_type)),
       edge_digest=COALESCE(edge_digest,md5(core_continuity_atlas_edges.tenant_id || ':' || core_continuity_atlas_edges.work_id::text || ':' || from_node_id || ':' || to_node_id || ':' || edge_type) || md5(edge_type || ':' || to_node_id)),
       source=COALESCE(source,'work_atlas')
  FROM core_continuity_atlas_state s
 WHERE s.tenant_id=core_continuity_atlas_edges.tenant_id AND s.work_id=core_continuity_atlas_edges.work_id
   AND (core_continuity_atlas_edges.project_id IS NULL OR edge_id IS NULL OR edge_digest IS NULL OR source IS NULL);
ALTER TABLE core_continuity_atlas_nodes
  ALTER COLUMN project_id SET NOT NULL,
  ALTER COLUMN source_kind SET NOT NULL,
  ALTER COLUMN source_ref SET NOT NULL,
  ALTER COLUMN source_digest SET NOT NULL;
ALTER TABLE core_continuity_atlas_edges
  ALTER COLUMN project_id SET NOT NULL,
  ALTER COLUMN edge_id SET NOT NULL,
  ALTER COLUMN edge_digest SET NOT NULL,
  ALTER COLUMN source SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='core_continuity_atlas_nodes_verification_check') THEN
    ALTER TABLE core_continuity_atlas_nodes ADD CONSTRAINT core_continuity_atlas_nodes_verification_check CHECK(verification_state IN ('observed','inferred_candidate','verified','contradicted','stale'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='core_continuity_atlas_nodes_confidence_check') THEN
    ALTER TABLE core_continuity_atlas_nodes ADD CONSTRAINT core_continuity_atlas_nodes_confidence_check CHECK(confidence>=0 AND confidence<=1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='core_continuity_atlas_edges_verification_check') THEN
    ALTER TABLE core_continuity_atlas_edges ADD CONSTRAINT core_continuity_atlas_edges_verification_check CHECK(verification_state IN ('observed','inferred_candidate','verified','contradicted','stale'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='core_continuity_atlas_edges_confidence_check') THEN
    ALTER TABLE core_continuity_atlas_edges ADD CONSTRAINT core_continuity_atlas_edges_confidence_check CHECK(confidence>=0 AND confidence<=1);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS core_continuity_atlas_edges_id_idx
  ON core_continuity_atlas_edges(tenant_id,work_id,edge_id);
CREATE UNIQUE INDEX IF NOT EXISTS core_continuity_atlas_state_project_work_idx
  ON core_continuity_atlas_state(tenant_id,project_id,work_id);
CREATE UNIQUE INDEX IF NOT EXISTS core_continuity_atlas_nodes_project_work_node_idx
  ON core_continuity_atlas_nodes(tenant_id,project_id,work_id,node_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='core_continuity_atlas_edges_from_fk') THEN
    ALTER TABLE core_continuity_atlas_edges ADD CONSTRAINT core_continuity_atlas_edges_from_fk
      FOREIGN KEY(tenant_id,project_id,work_id,from_node_id) REFERENCES core_continuity_atlas_nodes(tenant_id,project_id,work_id,node_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='core_continuity_atlas_edges_to_fk') THEN
    ALTER TABLE core_continuity_atlas_edges ADD CONSTRAINT core_continuity_atlas_edges_to_fk
      FOREIGN KEY(tenant_id,project_id,work_id,to_node_id) REFERENCES core_continuity_atlas_nodes(tenant_id,project_id,work_id,node_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS core_continuity_atlas_revision_history (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, project_id varchar(64) NOT NULL,
  revision bigint NOT NULL, source_digest char(64) NOT NULL, base_commit varchar(64), head_commit varchar(64),
  node_count bigint NOT NULL, edge_count bigint NOT NULL, provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,work_id,revision),
  FOREIGN KEY(tenant_id,work_id) REFERENCES core_continuity_atlas_state(tenant_id,work_id) ON DELETE RESTRICT
);

ALTER TABLE core_continuity_native_plans
  ADD COLUMN IF NOT EXISTS change_id uuid,
  ADD COLUMN IF NOT EXISTS base_state_digest char(64),
  ADD COLUMN IF NOT EXISTS contract_schema varchar(80) NOT NULL DEFAULT 'native_agent_plan_v1',
  ADD COLUMN IF NOT EXISTS plan_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_plan_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS core_continuity_native_plans_work_plan_idx
  ON core_continuity_native_plans(tenant_id,work_id,plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS core_changes_work_change_idx
  ON core_changes(tenant_id,work_id,change_id);
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='core_continuity_native_plans_change_fk'
      AND conrelid='core_continuity_native_plans'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE 'FOREIGN KEY (tenant_id, work_id, change_id)%'
  ) THEN
    ALTER TABLE core_continuity_native_plans DROP CONSTRAINT core_continuity_native_plans_change_fk;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='core_continuity_native_plans_change_fk' AND conrelid='core_continuity_native_plans'::regclass) THEN
    ALTER TABLE core_continuity_native_plans ADD CONSTRAINT core_continuity_native_plans_change_fk
      FOREIGN KEY(tenant_id,work_id,change_id) REFERENCES core_changes(tenant_id,work_id,change_id) ON DELETE RESTRICT;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='core_continuity_native_plans_supersedes_fk'
      AND conrelid='core_continuity_native_plans'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE 'FOREIGN KEY (tenant_id, work_id, supersedes_plan_id)%'
  ) THEN
    ALTER TABLE core_continuity_native_plans DROP CONSTRAINT core_continuity_native_plans_supersedes_fk;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='core_continuity_native_plans_supersedes_fk' AND conrelid='core_continuity_native_plans'::regclass) THEN
    ALTER TABLE core_continuity_native_plans ADD CONSTRAINT core_continuity_native_plans_supersedes_fk
      FOREIGN KEY(tenant_id,work_id,supersedes_plan_id) REFERENCES core_continuity_native_plans(tenant_id,work_id,plan_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS core_continuity_supervisory_challenges (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, plan_id uuid NOT NULL,
  change_id uuid NOT NULL, challenge_id varchar(64) NOT NULL, payload jsonb NOT NULL,
  payload_digest char(64) NOT NULL, severity varchar(16) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'open', version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,challenge_id),
  FOREIGN KEY(tenant_id,work_id,plan_id) REFERENCES core_continuity_native_plans(tenant_id,work_id,plan_id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,change_id) REFERENCES core_changes(tenant_id,change_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS core_continuity_supervisory_challenges_work_idx
  ON core_continuity_supervisory_challenges(tenant_id,work_id,plan_id,status,severity);
CREATE TABLE IF NOT EXISTS core_continuity_supervisory_challenge_resolutions (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, plan_id uuid NOT NULL,
  challenge_id varchar(64) NOT NULL, resolution_id uuid NOT NULL,
  expected_version bigint NOT NULL, new_version bigint NOT NULL,
  payload jsonb NOT NULL, payload_digest char(64) NOT NULL,
  created_by varchar(240) NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,resolution_id), UNIQUE(tenant_id,challenge_id,new_version),
  FOREIGN KEY(tenant_id,challenge_id) REFERENCES core_continuity_supervisory_challenges(tenant_id,challenge_id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,work_id,plan_id) REFERENCES core_continuity_native_plans(tenant_id,work_id,plan_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION core_software_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'core_software_append_only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS core_continuity_atlas_revision_history_no_mutation ON core_continuity_atlas_revision_history;
CREATE TRIGGER core_continuity_atlas_revision_history_no_mutation BEFORE UPDATE OR DELETE ON core_continuity_atlas_revision_history FOR EACH ROW EXECUTE FUNCTION core_software_append_only();
DROP TRIGGER IF EXISTS core_continuity_supervisory_challenge_resolutions_no_mutation ON core_continuity_supervisory_challenge_resolutions;
CREATE TRIGGER core_continuity_supervisory_challenge_resolutions_no_mutation BEFORE UPDATE OR DELETE ON core_continuity_supervisory_challenge_resolutions FOR EACH ROW EXECUTE FUNCTION core_software_append_only();

COMMIT;
