-- Work Continuity V2. Additive, idempotent, PostgreSQL 16 compatible.
-- Migration id: 20260808_work_continuity_v2_runtime
-- The migration registry intentionally records only the immutable migration id;
-- evidence and closure digests remain in their domain tables.
BEGIN;

CREATE TABLE IF NOT EXISTS tenant_work (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  work_code varchar(128) NOT NULL,
  work_name text NOT NULL,
  work_type varchar(80) NOT NULL,
  project_id varchar(128),
  owner_user_id varchar(128),
  created_by_user_id varchar(128),
  team_id varchar(128),
  assigned_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supervising_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  agent_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  visibility_scope varchar(32) NOT NULL DEFAULT 'private',
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  cancelled_at timestamptz,
  status varchar(24) NOT NULL DEFAULT 'PLANNED',
  progress_bp integer NOT NULL DEFAULT 0 CHECK (progress_bp BETWEEN 0 AND 10000),
  progress_version varchar(64) NOT NULL DEFAULT 'work_progress_v1',
  progress_source varchar(64) NOT NULL DEFAULT 'server_derived',
  priority varchar(8) NOT NULL DEFAULT 'P2',
  priority_score integer NOT NULL DEFAULT 0,
  intent_digest char(64),
  parent_work_id uuid,
  successor_work_id uuid,
  superseded_by_work_id uuid,
  closure_type varchar(64),
  closure_reason text,
  final_evidence_digest char(64),
  PRIMARY KEY (tenant_id, work_id),
  UNIQUE (tenant_id, work_code),
  CHECK (status IN ('PLANNED','ACTIVE','PAUSED','BLOCKED','HANDOFF','COMPLETED','CANCELLED','SUPERSEDED','ARCHIVED')),
  CHECK (visibility_scope IN ('private','shared','team','tenant')),
  CHECK (priority IN ('P0','P1','P2','P3','P4'))
);

CREATE INDEX IF NOT EXISTS tenant_work_operational_idx
  ON tenant_work (tenant_id, status, priority_score DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS tenant_work_project_idx
  ON tenant_work (tenant_id, project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS tenant_work_task (
  tenant_id varchar(64) NOT NULL,
  task_id uuid NOT NULL,
  work_id uuid NOT NULL,
  title text NOT NULL,
  weight integer NOT NULL DEFAULT 1 CHECK (weight > 0),
  status varchar(24) NOT NULL DEFAULT 'planned',
  acceptance_verified boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, task_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id)
);

CREATE TABLE IF NOT EXISTS tenant_work_evidence (
  tenant_id varchar(64) NOT NULL,
  evidence_id uuid NOT NULL,
  work_id uuid NOT NULL,
  kind varchar(80) NOT NULL,
  digest char(64) NOT NULL,
  required boolean NOT NULL DEFAULT true,
  independently_verified boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, evidence_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id)
);

CREATE TABLE IF NOT EXISTS tenant_work_closure_receipt (
  tenant_id varchar(64) NOT NULL,
  receipt_id uuid NOT NULL,
  work_id uuid NOT NULL,
  adapter varchar(64) NOT NULL,
  core_join_digest char(64) NOT NULL,
  final_evidence_digest char(64) NOT NULL,
  receipt_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, receipt_id),
  UNIQUE (tenant_id, work_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id)
);

CREATE TABLE IF NOT EXISTS tenant_work_final_report (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  report jsonb NOT NULL,
  report_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id)
);

ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS legacy_work_id uuid;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS objective text;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS next_action text;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS created_by_agent_id varchar(128);
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS created_by_session_fingerprint varchar(128);
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS priority_version varchar(64) NOT NULL DEFAULT 'work_priority_v1';
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS priority_context jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE tenant_work_task ADD COLUMN IF NOT EXISTS required boolean NOT NULL DEFAULT true;
ALTER TABLE tenant_work_evidence ADD COLUMN IF NOT EXISTS weight integer NOT NULL DEFAULT 1 CHECK (weight > 0);
ALTER TABLE tenant_work_evidence ADD COLUMN IF NOT EXISTS verified_by_agent_id varchar(128);
ALTER TABLE tenant_work_evidence ADD COLUMN IF NOT EXISTS verified_by_session_fingerprint varchar(128);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_work_legacy_identity_idx
  ON tenant_work (tenant_id, legacy_work_id) WHERE legacy_work_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenant_work_code_sequence (
  tenant_id varchar(64) NOT NULL,
  project_id varchar(64) NOT NULL,
  code_date date NOT NULL,
  next_sequence integer NOT NULL DEFAULT 0 CHECK (next_sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, code_date)
);

CREATE TABLE IF NOT EXISTS tenant_work_core_join (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  core_join_digest char(64) NOT NULL,
  core_join_context jsonb NOT NULL,
  persisted_by_user_id varchar(128),
  persisted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id)
);

CREATE TABLE IF NOT EXISTS core_schema_migrations (
  migration_id varchar(160) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_work_open_review (
  tenant_id varchar(64) NOT NULL,
  review_id uuid NOT NULL,
  subject_user_id varchar(128),
  request_id varchar(160),
  project_id varchar(128),
  intent_digest char(64),
  request_digest char(64) NOT NULL,
  review_digest char(64) NOT NULL,
  review_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_required boolean NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by_user_id varchar(128),
  decision varchar(48),
  decision_digest char(64),
  consumed_work_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, review_id)
);

ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS subject_user_id varchar(128);
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS request_id varchar(160);
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS project_id varchar(128);
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS intent_digest char(64);
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS review_result jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS decision_digest char(64);
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS consumed_work_id uuid;

CREATE TABLE IF NOT EXISTS tenant_work_bootstrap_request (
  tenant_id varchar(64) NOT NULL,
  subject_user_id varchar(128) NOT NULL,
  request_id varchar(160) NOT NULL,
  request_digest char(64) NOT NULL,
  review_id uuid NOT NULL,
  consumed_work_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subject_user_id, request_id),
  UNIQUE (tenant_id, review_id)
);

CREATE INDEX IF NOT EXISTS tenant_work_open_review_request_identity_idx
  ON tenant_work_open_review (tenant_id, subject_user_id, request_id)
  INCLUDE (request_digest, consumed_work_id)
  WHERE subject_user_id IS NOT NULL AND request_id IS NOT NULL;

-- Backfill only request identities whose historical review/digest/work
-- binding is unambiguous. Conflicting legacy duplicates remain available for
-- audit and are rejected fail-closed by the runtime. The ledger gate and
-- transaction-scoped advisory lock make the scan one-shot across replicas.
DO $work_bootstrap_backfill$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('20260825_work_bootstrap_request_backfill_v2', 0));
  IF NOT EXISTS (
    SELECT 1 FROM core_schema_migrations
    WHERE migration_id = '20260825_work_bootstrap_request_backfill_v2'
  ) THEN
    INSERT INTO tenant_work_bootstrap_request
  (tenant_id,subject_user_id,request_id,request_digest,review_id,consumed_work_id)
SELECT DISTINCT ON (r.tenant_id,r.subject_user_id,r.request_id)
  r.tenant_id,r.subject_user_id,r.request_id,r.request_digest,r.review_id,r.consumed_work_id
FROM tenant_work_open_review r
WHERE r.subject_user_id IS NOT NULL AND r.request_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM tenant_work_open_review other_review
    WHERE other_review.tenant_id=r.tenant_id
      AND other_review.subject_user_id=r.subject_user_id
      AND other_review.request_id=r.request_id
      AND (
        other_review.request_digest<>r.request_digest OR
        (other_review.consumed_work_id IS NOT NULL AND r.consumed_work_id IS NOT NULL
          AND other_review.consumed_work_id<>r.consumed_work_id)
      )
  )
ORDER BY r.tenant_id,r.subject_user_id,r.request_id,
  (r.consumed_work_id IS NOT NULL) DESC,r.consumed_at DESC NULLS LAST,r.created_at ASC
ON CONFLICT DO NOTHING;
    INSERT INTO core_schema_migrations (migration_id)
    VALUES ('20260825_work_bootstrap_request_backfill_v2');
  END IF;
END;
$work_bootstrap_backfill$;

CREATE TABLE IF NOT EXISTS tenant_work_event (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  event_id uuid NOT NULL,
  sequence_number integer NOT NULL,
  event_type varchar(80) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_event_hash char(64),
  event_hash char(64) NOT NULL,
  created_by_user_id varchar(128),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id),
  UNIQUE (tenant_id, work_id, sequence_number),
  FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id)
);

INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260808_work_continuity_v2_runtime')
ON CONFLICT DO NOTHING;

INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260825_work_bootstrap_request_v1')
ON CONFLICT DO NOTHING;

COMMIT;
