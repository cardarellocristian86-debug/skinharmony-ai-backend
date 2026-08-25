BEGIN;

-- Existing rows remain byte-for-byte untouched. NULL metadata identifies the
-- legacy JSON.stringify digest contract, which cannot be reconstructed from
-- jsonb after insertion-order information has been discarded.
ALTER TABLE core_icf_work
  ADD COLUMN IF NOT EXISTS ledger_head_digest_contract text;

ALTER TABLE core_icf_event
  ADD COLUMN IF NOT EXISTS digest_contract text,
  ADD COLUMN IF NOT EXISTS canonicalization_version text,
  ADD COLUMN IF NOT EXISTS digest_algorithm text,
  ADD COLUMN IF NOT EXISTS payload_digest char(64),
  ADD COLUMN IF NOT EXISTS previous_digest_contract text;

DO $icf_digest_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='core_icf_event_digest_contract_v2_ck'
      AND conrelid='core_icf_event'::regclass) THEN
    ALTER TABLE core_icf_event ADD CONSTRAINT core_icf_event_digest_contract_v2_ck CHECK (
      (digest_contract IS NULL AND canonicalization_version IS NULL
        AND digest_algorithm IS NULL AND payload_digest IS NULL
        AND previous_digest_contract IS NULL)
      OR
      (digest_contract='nyra.icf.event-digest/canonical-json-v2'
        AND canonicalization_version='nyra.icf.canonical-json/2.0'
        AND digest_algorithm='sha256' AND payload_digest ~ '^[a-f0-9]{64}$'
        AND ((previous_digest IS NULL AND previous_digest_contract IS NULL)
          OR (previous_digest IS NOT NULL AND previous_digest_contract IN
            ('nyra.icf.event-digest/json-stringify-v1',
             'nyra.icf.event-digest/canonical-json-v2'))))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='core_icf_work_head_digest_contract_v2_ck'
      AND conrelid='core_icf_work'::regclass) THEN
    ALTER TABLE core_icf_work ADD CONSTRAINT core_icf_work_head_digest_contract_v2_ck CHECK (
      ledger_head_digest_contract IS NULL
      OR ledger_head_digest_contract='nyra.icf.event-digest/canonical-json-v2'
    );
  END IF;
END
$icf_digest_constraints$;

COMMENT ON COLUMN core_icf_event.digest_contract IS
  'NULL=legacy unverifiable json-stringify-v1; new rows use canonical-json-v2';
COMMENT ON COLUMN core_icf_work.ledger_head_digest_contract IS
  'Digest contract of the current append-only ICF head; legacy heads remain NULL';

COMMIT;
