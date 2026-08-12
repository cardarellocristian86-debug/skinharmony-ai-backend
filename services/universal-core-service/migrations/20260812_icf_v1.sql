BEGIN;

CREATE TABLE IF NOT EXISTS core_icf_work (
  tenant_id text NOT NULL,
  work_id text NOT NULL,
  version bigint NOT NULL DEFAULT 0,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ledger_head_digest text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id)
);

CREATE TABLE IF NOT EXISTS core_icf_event (
  tenant_id text NOT NULL,
  work_id text NOT NULL,
  seq bigint NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  previous_digest text,
  digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, seq),
  UNIQUE (tenant_id, work_id, digest)
);

CREATE INDEX IF NOT EXISTS core_icf_event_head_idx
  ON core_icf_event (tenant_id, work_id, seq DESC);

COMMIT;
