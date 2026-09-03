BEGIN;

ALTER TABLE tenant_work_task
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;
ALTER TABLE tenant_work_precommit_ticket_gate
  ADD COLUMN IF NOT EXISTS v2_scope_snapshot_digest char(64),
  ADD COLUMN IF NOT EXISTS v2_scope_tasks jsonb;
ALTER TABLE tenant_work_precommit_ticket_gate_supersession
  ADD COLUMN IF NOT EXISTS v2_scope_snapshot_digest char(64),
  ADD COLUMN IF NOT EXISTS v2_scope_tasks jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='tenant_work_task_revision_positive'
      AND conrelid='tenant_work_task'::regclass
  ) THEN
    ALTER TABLE tenant_work_task
      ADD CONSTRAINT tenant_work_task_revision_positive CHECK (revision > 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION tenant_work_task_advance_revision() RETURNS trigger AS $$
DECLARE release_frozen boolean := false;
DECLARE material_change boolean := true;
DECLARE target_tenant varchar(64);
DECLARE target_work uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.tenant_id,NEW.task_id,NEW.work_id)
        IS DISTINCT FROM ROW(OLD.tenant_id,OLD.task_id,OLD.work_id) THEN
      RAISE EXCEPTION 'tenant_work_task_identity_immutable';
    END IF;
    material_change := ROW(NEW.title,NEW.weight,NEW.required,NEW.status,
      NEW.acceptance_verified,NEW.completed_at)
      IS DISTINCT FROM ROW(OLD.title,OLD.weight,OLD.required,OLD.status,
        OLD.acceptance_verified,OLD.completed_at);
  END IF;

  IF material_change THEN
    IF TG_OP = 'INSERT' THEN
      target_tenant := NEW.tenant_id;
      target_work := NEW.work_id;
    ELSE
      target_tenant := OLD.tenant_id;
      target_work := OLD.work_id;
    END IF;
    IF to_regclass('public.core_continuity_release_joins') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (
        SELECT 1 FROM public.core_continuity_release_joins
        WHERE tenant_id=$1 AND work_id=$2
      )' INTO release_frozen USING target_tenant,target_work;
      IF release_frozen THEN
        RAISE EXCEPTION 'tenant_work_task_release_frozen';
      END IF;
    END IF;
    IF to_regclass('public.tenant_work_precommit_scope_freeze') IS NOT NULL AND
       to_regclass('public.tenant_work_precommit_ticket_gate_claim_fulfillment') IS NOT NULL AND
       to_regclass('public.tenant_work_precommit_ticket_gate_claim_abandonment') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (
        SELECT 1 FROM public.tenant_work_precommit_scope_freeze f
        LEFT JOIN public.tenant_work_precommit_ticket_gate_claim_fulfillment u
          ON u.tenant_id=f.tenant_id AND u.work_id=f.work_id
            AND u.gate_projection_digest=f.gate_projection_digest
            AND u.claim_id=f.claim_id
        LEFT JOIN public.tenant_work_precommit_ticket_gate_claim_abandonment a
          ON a.tenant_id=f.tenant_id AND a.work_id=f.work_id
            AND a.gate_projection_digest=f.gate_projection_digest
            AND a.claim_id=f.claim_id
        WHERE f.tenant_id=$1 AND f.work_id=$2 AND f.task_id=$3
          AND u.claim_id IS NULL AND a.claim_id IS NULL
      )' INTO release_frozen USING target_tenant,target_work,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.task_id ELSE OLD.task_id END;
      IF release_frozen THEN
        RAISE EXCEPTION 'tenant_work_task_precommit_scope_frozen';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.revision := 1;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF material_change THEN
      NEW.revision := OLD.revision + 1;
    ELSE
      NEW.revision := OLD.revision;
    END IF;
    RETURN NEW;
  ELSE
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_work_task_revision_guard ON tenant_work_task;
CREATE TRIGGER tenant_work_task_revision_guard
BEFORE INSERT OR UPDATE OR DELETE ON tenant_work_task
FOR EACH ROW EXECUTE FUNCTION tenant_work_task_advance_revision();

CREATE TABLE IF NOT EXISTS tenant_work_precommit_ticket_gate_claim_abandonment (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL,
  gate_projection_digest char(64) NOT NULL, claim_id uuid NOT NULL,
  delegation_id varchar(160) NOT NULL,
  delegation_effective_state varchar(16) NOT NULL,
  delegation_expires_at timestamptz NOT NULL, delegation_revoked_at timestamptz,
  core_readback_digest char(64) NOT NULL, abandonment_digest char(64) NOT NULL,
  abandoned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,work_id,gate_projection_digest),
  UNIQUE (tenant_id,claim_id),
  CHECK (delegation_effective_state IN ('expired','revoked')),
  FOREIGN KEY (tenant_id,work_id,gate_projection_digest)
    REFERENCES tenant_work_precommit_ticket_gate_claim(tenant_id,work_id,gate_projection_digest)
);

DROP TRIGGER IF EXISTS tenant_work_precommit_claim_abandonment_no_mutation
  ON tenant_work_precommit_ticket_gate_claim_abandonment;
CREATE TRIGGER tenant_work_precommit_claim_abandonment_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_precommit_ticket_gate_claim_abandonment
FOR EACH ROW EXECUTE FUNCTION tenant_work_precommit_reconciliation_append_only();

CREATE TABLE IF NOT EXISTS tenant_work_precommit_scope_freeze (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL,
  gate_projection_digest char(64) NOT NULL, claim_id uuid NOT NULL,
  task_id uuid NOT NULL, revision bigint NOT NULL CHECK (revision > 0),
  v2_task_digest char(64) NOT NULL, scope_snapshot_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,work_id,claim_id,task_id),
  FOREIGN KEY (tenant_id,work_id,gate_projection_digest)
    REFERENCES tenant_work_precommit_ticket_gate_claim(tenant_id,work_id,gate_projection_digest),
  FOREIGN KEY (tenant_id,work_id,task_id)
    REFERENCES tenant_work_task(tenant_id,work_id,task_id)
);

DROP TRIGGER IF EXISTS tenant_work_precommit_scope_freeze_no_mutation
  ON tenant_work_precommit_scope_freeze;
CREATE TRIGGER tenant_work_precommit_scope_freeze_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_precommit_scope_freeze
FOR EACH ROW EXECUTE FUNCTION tenant_work_precommit_reconciliation_append_only();

INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260903_native_v2_task_revision_v1')
ON CONFLICT DO NOTHING;

COMMIT;
