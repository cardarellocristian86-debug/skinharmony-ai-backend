-- Entity360 v2 keeps OFF and SHADOW as rollback-safe states while allowing a
-- tenant to enter ENFORCED only with both exact policy and Core authority
-- digests. ADVISORY remains unsupported and no existing row is rewritten.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM core_entity360_feature_flags
     WHERE mode NOT IN ('OFF','SHADOW')
        OR (mode = 'OFF' AND (
          enabled IS DISTINCT FROM false
          OR policy_digest IS NOT NULL
          OR enforcement_authority_digest IS NOT NULL))
        OR (mode = 'SHADOW' AND (
          enabled IS DISTINCT FROM true
          OR policy_digest IS NULL
          OR enforcement_authority_digest IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'ENTITY360_V2_ENFORCEMENT_MIGRATION_REFUSED_INVALID_EXISTING_FLAGS';
  END IF;
END $$;

ALTER TABLE core_entity360_feature_flags
  DROP CONSTRAINT core_entity360_feature_shadow_only_check;

ALTER TABLE core_entity360_feature_flags
  ADD CONSTRAINT core_entity360_feature_v2_mode_check CHECK (
    (mode = 'OFF'
      AND enabled = false
      AND policy_digest IS NULL
      AND enforcement_authority_digest IS NULL)
    OR
    (mode = 'SHADOW'
      AND enabled = true
      AND policy_digest IS NOT NULL
      AND enforcement_authority_digest IS NULL)
    OR
    (mode = 'ENFORCED'
      AND enabled = true
      AND policy_digest IS NOT NULL
      AND enforcement_authority_digest IS NOT NULL)
  );

-- Every enforced context reference must resolve to an exact, tenant-scoped,
-- append-only receipt. The snapshot foreign key and JSON bindings prevent a
-- digest-only reference from outliving the material that Core verified.
CREATE TABLE IF NOT EXISTS core_entity360_enforcement_context_receipts (
  tenant_id varchar(120) NOT NULL,
  receipt_digest char(64) NOT NULL,
  work_id varchar(240) NOT NULL,
  entity_id varchar(160) NOT NULL,
  snapshot_version bigint NOT NULL,
  snapshot_digest char(64) NOT NULL,
  action_digest char(64) NOT NULL,
  phase varchar(20) NOT NULL,
  receipt jsonb NOT NULL,
  created_by varchar(240) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, receipt_digest),
  FOREIGN KEY (tenant_id, entity_id, snapshot_version)
    REFERENCES core_entity360_snapshots (tenant_id, entity_id, snapshot_version)
    ON DELETE RESTRICT,
  CONSTRAINT core_entity360_enforcement_context_receipt_digest_check
    CHECK (receipt_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_enforcement_context_snapshot_digest_check
    CHECK (snapshot_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_enforcement_context_action_digest_check
    CHECK (action_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT core_entity360_enforcement_context_phase_check
    CHECK (phase IN ('ISSUE','RESERVATION')),
  CONSTRAINT core_entity360_enforcement_context_receipt_binding_check CHECK (
    jsonb_typeof(receipt) = 'object'
    AND receipt ?& ARRAY[
      'schema_version','tenant_id','work_id','entity_id','snapshot_version',
      'snapshot_digest','policy_version','policy_digest','enforcement_policy_version',
      'enforcement_policy_digest','enforcement_authority_digest','ontology_version',
      'ontology_digest','adapter_registry_version','as_of_valid_time','as_of_knowledge_time',
      'tenant_feature_revision','action_digest','phase','authority_owner','decision_authority',
      'decision_receipt_schema_version','entity360_self_approval','provider_mutation',
      'execution_authorized','receipt_digest'
    ]::text[]
    AND (receipt - ARRAY[
      'schema_version','tenant_id','work_id','entity_id','snapshot_version',
      'snapshot_digest','policy_version','policy_digest','enforcement_policy_version',
      'enforcement_policy_digest','enforcement_authority_digest','ontology_version',
      'ontology_digest','adapter_registry_version','as_of_valid_time','as_of_knowledge_time',
      'tenant_feature_revision','action_digest','phase','authority_owner','decision_authority',
      'decision_receipt_schema_version','entity360_self_approval','provider_mutation',
      'execution_authorized','receipt_digest'
    ]::text[]) = '{}'::jsonb
    AND receipt->>'schema_version' IS NOT DISTINCT FROM
      'entity_360_core_context_receipt_v2'
    AND receipt->>'tenant_id' IS NOT DISTINCT FROM tenant_id
    AND receipt->>'work_id' IS NOT DISTINCT FROM work_id
    AND receipt->>'entity_id' IS NOT DISTINCT FROM entity_id
    AND (receipt->>'snapshot_version')::bigint IS NOT DISTINCT FROM snapshot_version
    AND receipt->>'snapshot_digest' IS NOT DISTINCT FROM snapshot_digest
    AND receipt->>'ontology_version' IS NOT NULL
    AND receipt->>'ontology_digest' ~ '^[a-f0-9]{64}$'
    AND receipt->>'action_digest' IS NOT DISTINCT FROM action_digest
    AND receipt->>'phase' IS NOT DISTINCT FROM phase
    AND receipt->>'receipt_digest' IS NOT DISTINCT FROM receipt_digest
    AND receipt->>'authority_owner' IS NOT DISTINCT FROM 'UNIVERSAL_CORE'
    AND receipt->>'decision_authority' IS NOT DISTINCT FROM 'UNIVERSAL_CORE'
    AND (receipt->>'entity360_self_approval')::boolean IS NOT DISTINCT FROM false
    AND (receipt->>'provider_mutation')::boolean IS NOT DISTINCT FROM false
    AND (receipt->>'execution_authorized')::boolean IS NOT DISTINCT FROM false
  )
);

CREATE INDEX IF NOT EXISTS core_entity360_enforcement_context_work_idx
  ON core_entity360_enforcement_context_receipts
    (tenant_id, work_id, created_at DESC);

DROP TRIGGER IF EXISTS core_entity360_enforcement_context_receipts_append_only
  ON core_entity360_enforcement_context_receipts;
CREATE TRIGGER core_entity360_enforcement_context_receipts_append_only
  BEFORE UPDATE OR DELETE ON core_entity360_enforcement_context_receipts
  FOR EACH ROW EXECUTE FUNCTION core_entity360_reject_mutation();
DROP TRIGGER IF EXISTS core_entity360_enforcement_context_receipts_truncate_guard
  ON core_entity360_enforcement_context_receipts;
CREATE TRIGGER core_entity360_enforcement_context_receipts_truncate_guard
  BEFORE TRUNCATE ON core_entity360_enforcement_context_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION core_entity360_reject_mutation();
