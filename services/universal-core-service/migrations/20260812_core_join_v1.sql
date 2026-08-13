-- Generic Work Core Join: append-only signed ledger and CAS head.
CREATE TABLE IF NOT EXISTS core_icf_join_head (
  tenant_id text NOT NULL, work_id text NOT NULL, version bigint NOT NULL DEFAULT 0,
  head_digest text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id)
);
CREATE TABLE IF NOT EXISTS core_icf_join_event (
  tenant_id text NOT NULL, work_id text NOT NULL, seq bigint NOT NULL,
  join_type text NOT NULL, statement jsonb NOT NULL, previous_digest text,
  digest text NOT NULL, signature text NOT NULL, key_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, seq),
  UNIQUE (tenant_id, work_id, digest)
);
CREATE INDEX IF NOT EXISTS core_icf_join_event_head_idx
  ON core_icf_join_event (tenant_id, work_id, seq DESC);
