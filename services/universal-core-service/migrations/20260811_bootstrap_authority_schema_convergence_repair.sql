-- Bootstrap Authority schema convergence repair, PostgreSQL 16 compatible.
--
-- Additive and idempotent: retain the historical constraints while adding
-- stable, explicitly named constraints whose semantics can be verified from
-- PostgreSQL catalogs without depending on auto-generated/truncated names.
BEGIN;

CREATE TABLE IF NOT EXISTS core_schema_migrations (
  migration_id varchar(160) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

SELECT pg_advisory_xact_lock(
  hashtextextended('20260811_bootstrap_authority_schema_convergence_repair_v1', 0)
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'core_bootstrap_trust_keys'
      AND c.conname = 'core_bootstrap_local_attestation_v2_ck'
  ) THEN
    ALTER TABLE core_bootstrap_trust_keys
      ADD CONSTRAINT core_bootstrap_local_attestation_v2_ck CHECK (
        (authority_provider = 'local_pin'
          AND attestation_status = 'UNATTESTED_LOCAL_SOFTWARE'
          AND (
            (legacy_local_pin = false AND provider_attestation_digest IS NULL)
            OR
            (legacy_local_pin = true AND provider_attestation_digest ~ '^[0-9a-f]{64}$')
          ))
        OR
        (authority_provider <> 'local_pin'
          AND attestation_status <> 'UNATTESTED_LOCAL_SOFTWARE'
          AND provider_attestation_digest ~ '^[0-9a-f]{64}$')
      ) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'core_bootstrap_release_receipts'
      AND c.conname = 'core_bootstrap_receipt_single_use_v2_ck'
  ) THEN
    ALTER TABLE core_bootstrap_release_receipts
      ADD CONSTRAINT core_bootstrap_receipt_single_use_v2_ck CHECK (
        max_uses = 1
        AND core_policy_classification = 'BOOTSTRAP_DEADLOCK_VERIFIED'
      ) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'core_bootstrap_trust_key_state'
      AND c.conname = 'core_bootstrap_trust_state_legacy_v2_ck'
  ) THEN
    ALTER TABLE core_bootstrap_trust_key_state
      ADD CONSTRAINT core_bootstrap_trust_state_legacy_v2_ck CHECK (
        legacy_unattested = false
        OR status = 'RETIRED'
        OR status = 'REVOKED'
      ) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'core_bootstrap_trust_key_state'
      AND c.conname = 'core_bootstrap_state_key_v2_fk'
  ) THEN
    ALTER TABLE core_bootstrap_trust_key_state
      ADD CONSTRAINT core_bootstrap_state_key_v2_fk
      FOREIGN KEY (tenant_id, authority_key_id)
      REFERENCES core_bootstrap_trust_keys (tenant_id, authority_key_id)
      NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'core_bootstrap_release_consumptions'
      AND c.conname = 'core_bootstrap_consumption_receipt_v2_fk'
  ) THEN
    ALTER TABLE core_bootstrap_release_consumptions
      ADD CONSTRAINT core_bootstrap_consumption_receipt_v2_fk
      FOREIGN KEY (tenant_id, exception_id, receipt_digest)
      REFERENCES core_bootstrap_release_receipts
        (tenant_id, exception_id, receipt_digest)
      NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'core_bootstrap_action_outbox'
      AND c.conname = 'core_bootstrap_outbox_consumption_v2_fk'
  ) THEN
    ALTER TABLE core_bootstrap_action_outbox
      ADD CONSTRAINT core_bootstrap_outbox_consumption_v2_fk
      FOREIGN KEY (consumption_id)
      REFERENCES core_bootstrap_release_consumptions (consumption_id)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE core_bootstrap_trust_keys
  VALIDATE CONSTRAINT core_bootstrap_local_attestation_v2_ck;
ALTER TABLE core_bootstrap_release_receipts
  VALIDATE CONSTRAINT core_bootstrap_receipt_single_use_v2_ck;
ALTER TABLE core_bootstrap_trust_key_state
  VALIDATE CONSTRAINT core_bootstrap_trust_state_legacy_v2_ck;
ALTER TABLE core_bootstrap_trust_key_state
  VALIDATE CONSTRAINT core_bootstrap_state_key_v2_fk;
ALTER TABLE core_bootstrap_release_consumptions
  VALIDATE CONSTRAINT core_bootstrap_consumption_receipt_v2_fk;
ALTER TABLE core_bootstrap_action_outbox
  VALIDATE CONSTRAINT core_bootstrap_outbox_consumption_v2_fk;

INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260811_bootstrap_authority_schema_convergence_repair_v1')
ON CONFLICT DO NOTHING;

COMMIT;
