BEGIN;

-- Extend Work Continuity receipts; do not create a second decision authority.
ALTER TABLE core_continuity_native_receipts
  ADD COLUMN IF NOT EXISTS chain_sequence bigint,
  ADD COLUMN IF NOT EXISTS parent_payload_digest char(64),
  ADD COLUMN IF NOT EXISTS request_digest char(64),
  ADD COLUMN IF NOT EXISTS signer_key_id varchar(128),
  ADD COLUMN IF NOT EXISTS signature_algorithm varchar(32),
  ADD COLUMN IF NOT EXISTS signature text,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS authority_scope varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS core_continuity_precore_chain_idx
  ON core_continuity_native_receipts(tenant_id,work_id,plan_id,chain_sequence)
  WHERE receipt_type='software_precore_decision';
CREATE UNIQUE INDEX IF NOT EXISTS core_continuity_precore_request_idx
  ON core_continuity_native_receipts(tenant_id,work_id,plan_id,request_digest)
  WHERE receipt_type='software_precore_decision';
CREATE UNIQUE INDEX IF NOT EXISTS core_continuity_precore_idempotency_idx
  ON core_continuity_native_receipts(tenant_id,work_id,plan_id,(payload->>'idempotency_key'))
  WHERE receipt_type='software_precore_decision';
CREATE INDEX IF NOT EXISTS core_continuity_precore_scope_idx
  ON core_continuity_native_receipts(tenant_id,work_id,plan_id,
    (payload->'scope'->>'project_id'),(payload->'scope'->>'repository_id'),
    (payload->'scope'->>'change_id'),chain_sequence DESC)
  WHERE receipt_type='software_precore_decision';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='core_continuity_precore_receipt_contract_ck'
      AND conrelid='core_continuity_native_receipts'::regclass) THEN
    ALTER TABLE core_continuity_native_receipts ADD CONSTRAINT core_continuity_precore_receipt_contract_ck CHECK (
      receipt_type <> 'software_precore_decision' OR (
        chain_sequence IS NOT NULL AND chain_sequence > 0
        AND request_digest ~ '^[0-9a-f]{64}$'
        AND signer_key_id IS NOT NULL
        AND signature_algorithm='Ed25519'
        AND signature IS NOT NULL
        AND signed_at IS NOT NULL
        AND authority_scope='ADVISORY_NON_EXECUTABLE'
        AND ((chain_sequence=1 AND parent_payload_digest IS NULL)
          OR (chain_sequence>1 AND parent_payload_digest ~ '^[0-9a-f]{64}$'))
        AND payload->>'schema_version'='nyra_precore_decision_v1'
        AND payload->>'nsct_version'='1.1'
        AND payload ? 'execution_authorized'
        AND (payload->>'execution_authorized')::boolean=false
        AND payload->>'authority_scope'='ADVISORY_NON_EXECUTABLE'
        AND payload->'decision'->>'kind' IN ('PROPOSE','CHALLENGE','ABSTAIN','RECOMMEND_BLOCK')
      )
    );
  END IF;
END $$;

-- The existing append-only trigger on core_continuity_native_receipts remains
-- the physical mutation guard. No UPDATE/DELETE path is added here.
COMMIT;
