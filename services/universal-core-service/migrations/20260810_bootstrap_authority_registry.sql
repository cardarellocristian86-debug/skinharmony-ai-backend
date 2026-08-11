-- Bootstrap / Recovery Authority registry, PostgreSQL 16 compatible.
-- Additive and idempotent. Contains public verifier material only.
BEGIN;

CREATE TABLE IF NOT EXISTS core_schema_migrations (
  migration_id varchar(160) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE core_bootstrap_attestation_status AS ENUM (
    'UNATTESTED_LOCAL_SOFTWARE',
    'PROVIDER_ATTESTED',
    'HARDWARE_ATTESTED',
    'EXTERNAL_ATTESTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS core_bootstrap_trust_keys (
  tenant_id varchar(128) NOT NULL,
  authority_key_id varchar(128) NOT NULL,
  authority_provider varchar(64) NOT NULL,
  algorithm varchar(64) NOT NULL,
  attestation_status core_bootstrap_attestation_status NOT NULL,
  credential_id text,
  public_key_spki_der bytea NOT NULL,
  public_key_sha256 char(64) NOT NULL,
  trust_bundle_digest char(64) NOT NULL,
  provider_attestation_digest char(64),
  legacy_local_pin boolean NOT NULL DEFAULT false,
  rp_id varchar(253),
  origin text,
  genesis_record_digest char(64) NOT NULL,
  genesis_record jsonb NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, authority_key_id),
  UNIQUE (tenant_id, public_key_sha256),
  UNIQUE (tenant_id, trust_bundle_digest),
  CHECK (authority_provider IN ('local_pin','webauthn_platform','apple_secure_enclave','windows_tpm','pkcs11_hsm','cloud_kms','hashicorp_vault','enterprise_external')),
  CHECK (algorithm IN ('ECDSA_P256_SHA256_P1363','ECDSA-P256-SHA256','Ed25519')),
  CHECK (public_key_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (trust_bundle_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT core_bootstrap_local_attestation_ck CHECK (
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
  ),
  CHECK (genesis_record_digest ~ '^[0-9a-f]{64}$'),
  CHECK (octet_length(public_key_spki_der) BETWEEN 32 AND 4096),
  CHECK (jsonb_typeof(genesis_record) = 'object')
);

ALTER TABLE core_bootstrap_trust_keys
  ADD COLUMN IF NOT EXISTS attestation_status core_bootstrap_attestation_status;
ALTER TABLE core_bootstrap_trust_keys
  ADD COLUMN IF NOT EXISTS legacy_local_pin boolean;
ALTER TABLE core_bootstrap_trust_keys
  ALTER COLUMN provider_attestation_digest DROP NOT NULL;
UPDATE core_bootstrap_trust_keys
SET legacy_local_pin = (authority_provider = 'local_pin' AND provider_attestation_digest IS NOT NULL)
WHERE legacy_local_pin IS NULL;
UPDATE core_bootstrap_trust_keys
SET attestation_status = CASE
  WHEN authority_provider = 'local_pin' THEN 'UNATTESTED_LOCAL_SOFTWARE'::core_bootstrap_attestation_status
  WHEN provider_attestation_digest IS NOT NULL THEN 'EXTERNAL_ATTESTED'::core_bootstrap_attestation_status
  ELSE attestation_status
END
WHERE attestation_status IS NULL;
ALTER TABLE core_bootstrap_trust_keys
  ALTER COLUMN legacy_local_pin SET DEFAULT false;
ALTER TABLE core_bootstrap_trust_keys
  ALTER COLUMN legacy_local_pin SET NOT NULL;
ALTER TABLE core_bootstrap_trust_keys
  ALTER COLUMN attestation_status SET NOT NULL;

ALTER TABLE core_bootstrap_trust_keys
  DROP CONSTRAINT IF EXISTS core_bootstrap_local_attestation_ck;
ALTER TABLE core_bootstrap_trust_keys
  ADD CONSTRAINT core_bootstrap_local_attestation_ck CHECK (
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
  );

CREATE UNIQUE INDEX IF NOT EXISTS core_bootstrap_trust_credential_idx
  ON core_bootstrap_trust_keys (tenant_id, credential_id)
  WHERE credential_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS core_bootstrap_trust_key_state (
  tenant_id varchar(128) NOT NULL,
  authority_key_id varchar(128) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE',
  version bigint NOT NULL DEFAULT 1,
  activated_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  revoked_at timestamptz,
  reason_digest char(64),
  updated_at timestamptz NOT NULL DEFAULT now(),
  legacy_unattested boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, authority_key_id),
  FOREIGN KEY (tenant_id, authority_key_id)
    REFERENCES core_bootstrap_trust_keys (tenant_id, authority_key_id),
  CHECK (status IN ('ACTIVE','RETIRED','REVOKED')),
  CHECK (version > 0),
  CHECK (reason_digest IS NULL OR reason_digest ~ '^[0-9a-f]{64}$'),
  CHECK (
    (status = 'ACTIVE' AND retired_at IS NULL AND revoked_at IS NULL) OR
    (status = 'RETIRED' AND retired_at IS NOT NULL AND revoked_at IS NULL) OR
    (status = 'REVOKED' AND revoked_at IS NOT NULL)
  )
);

ALTER TABLE core_bootstrap_trust_key_state
  ADD COLUMN IF NOT EXISTS legacy_unattested boolean;
UPDATE core_bootstrap_trust_key_state s
SET legacy_unattested = k.legacy_local_pin,
    status = CASE WHEN k.legacy_local_pin THEN 'RETIRED' ELSE s.status END,
    retired_at = CASE WHEN k.legacy_local_pin THEN COALESCE(s.retired_at, now()) ELSE s.retired_at END
FROM core_bootstrap_trust_keys k
WHERE s.tenant_id=k.tenant_id AND s.authority_key_id=k.authority_key_id
  AND s.legacy_unattested IS NULL;
ALTER TABLE core_bootstrap_trust_key_state
  ALTER COLUMN legacy_unattested SET DEFAULT false;
ALTER TABLE core_bootstrap_trust_key_state
  ALTER COLUMN legacy_unattested SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE core_bootstrap_trust_key_state
    ADD CONSTRAINT core_bootstrap_trust_state_legacy_unattested_ck CHECK (
      legacy_unattested = false OR status IN ('RETIRED','REVOKED')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO core_bootstrap_trust_key_state
  (tenant_id,authority_key_id,status,activated_at,retired_at,updated_at,legacy_unattested)
SELECT tenant_id,authority_key_id,
  CASE WHEN legacy_local_pin THEN 'RETIRED' ELSE 'ACTIVE' END,
  now(),CASE WHEN legacy_local_pin THEN now() ELSE NULL END,now(),legacy_local_pin
FROM core_bootstrap_trust_keys
ON CONFLICT (tenant_id,authority_key_id) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS core_bootstrap_one_active_key_per_tenant_idx
  ON core_bootstrap_trust_key_state (tenant_id)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS core_bootstrap_release_receipts (
  tenant_id varchar(128) NOT NULL,
  exception_id varchar(128) NOT NULL,
  work_id varchar(128) NOT NULL,
  repository varchar(201) NOT NULL,
  pr_number bigint NOT NULL,
  head_sha char(40) NOT NULL,
  allowed_action varchar(64) NOT NULL,
  max_uses integer NOT NULL,
  authority_provider varchar(64) NOT NULL,
  authority_key_id varchar(128) NOT NULL,
  nonce varchar(128) NOT NULL,
  core_policy_classification varchar(64) NOT NULL,
  required_checks_digest char(64) NOT NULL,
  required_checks_results_digest char(64) NOT NULL,
  owner_confirmation_digest char(64) NOT NULL,
  core_policy_verdict_digest char(64) NOT NULL,
  rollback_obligations_digest char(64) NOT NULL,
  post_deploy_obligations_digest char(64) NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  receipt_digest char(64) NOT NULL,
  receipt jsonb NOT NULL,
  verifier_candidate jsonb NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, exception_id),
  UNIQUE (tenant_id, exception_id, receipt_digest),
  UNIQUE (tenant_id, receipt_digest),
  UNIQUE (tenant_id, authority_key_id, nonce),
  FOREIGN KEY (tenant_id, authority_key_id)
    REFERENCES core_bootstrap_trust_keys (tenant_id, authority_key_id),
  CHECK (pr_number > 0),
  CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  CHECK (allowed_action = 'github.merge'),
  CONSTRAINT core_bootstrap_receipt_single_use_ck CHECK (
    max_uses = 1
    AND core_policy_classification = 'BOOTSTRAP_DEADLOCK_VERIFIED'
  ),
  CHECK (expires_at > issued_at),
  CHECK (expires_at <= issued_at + interval '15 minutes'),
  CHECK (required_checks_digest ~ '^[0-9a-f]{64}$'),
  CHECK (required_checks_results_digest ~ '^[0-9a-f]{64}$'),
  CHECK (owner_confirmation_digest ~ '^[0-9a-f]{64}$'),
  CHECK (core_policy_verdict_digest ~ '^[0-9a-f]{64}$'),
  CHECK (rollback_obligations_digest ~ '^[0-9a-f]{64}$'),
  CHECK (post_deploy_obligations_digest ~ '^[0-9a-f]{64}$'),
  CHECK (receipt_digest ~ '^[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(receipt) = 'object'),
  CHECK (jsonb_typeof(verifier_candidate) = 'object')
);

DO $$ BEGIN
  ALTER TABLE core_bootstrap_release_receipts
    ADD CONSTRAINT core_bootstrap_receipt_single_use_ck CHECK (
      max_uses = 1
      AND core_policy_classification = 'BOOTSTRAP_DEADLOCK_VERIFIED'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS core_bootstrap_receipt_target_idx
  ON core_bootstrap_release_receipts (tenant_id, repository, pr_number, head_sha, allowed_action);

CREATE TABLE IF NOT EXISTS core_bootstrap_release_revocations (
  tenant_id varchar(128) NOT NULL,
  exception_id varchar(128) NOT NULL,
  receipt_digest char(64) NOT NULL,
  reason_digest char(64) NOT NULL,
  revoked_by varchar(128) NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, exception_id),
  FOREIGN KEY (tenant_id, exception_id, receipt_digest)
    REFERENCES core_bootstrap_release_receipts (tenant_id, exception_id, receipt_digest),
  CHECK (receipt_digest ~ '^[0-9a-f]{64}$'),
  CHECK (reason_digest ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS core_bootstrap_release_consumptions (
  tenant_id varchar(128) NOT NULL,
  exception_id varchar(128) NOT NULL,
  consumption_id uuid NOT NULL,
  receipt_digest char(64) NOT NULL,
  work_id varchar(128) NOT NULL,
  repository varchar(201) NOT NULL,
  pr_number bigint NOT NULL,
  head_sha char(40) NOT NULL,
  allowed_action varchar(64) NOT NULL,
  required_checks_digest char(64) NOT NULL,
  required_checks_results_digest char(64) NOT NULL,
  action_request_digest char(64) NOT NULL,
  consumed_by varchar(128) NOT NULL,
  consumed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, exception_id),
  UNIQUE (consumption_id),
  UNIQUE (tenant_id, receipt_digest),
  UNIQUE (tenant_id, action_request_digest),
  FOREIGN KEY (tenant_id, exception_id, receipt_digest)
    REFERENCES core_bootstrap_release_receipts (tenant_id, exception_id, receipt_digest),
  CHECK (receipt_digest ~ '^[0-9a-f]{64}$'),
  CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  CHECK (required_checks_digest ~ '^[0-9a-f]{64}$'),
  CHECK (required_checks_results_digest ~ '^[0-9a-f]{64}$'),
  CHECK (action_request_digest ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS core_bootstrap_action_outbox (
  consumption_id uuid PRIMARY KEY,
  tenant_id varchar(128) NOT NULL,
  exception_id varchar(128) NOT NULL,
  allowed_action varchar(64) NOT NULL,
  target jsonb NOT NULL,
  action_request_digest char(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  claimed_by varchar(128),
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  effect_readback_digest char(64),
  last_error_digest char(64),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (consumption_id)
    REFERENCES core_bootstrap_release_consumptions (consumption_id),
  FOREIGN KEY (tenant_id, exception_id)
    REFERENCES core_bootstrap_release_consumptions (tenant_id, exception_id),
  UNIQUE (tenant_id, action_request_digest),
  CHECK (allowed_action = 'github.merge'),
  CHECK (status IN ('PENDING','CLAIMED','EFFECT_OBSERVED','COMPLETED','FAILED','REQUIRES_RECONCILIATION')),
  CHECK (attempt_count >= 0),
  CHECK (action_request_digest ~ '^[0-9a-f]{64}$'),
  CHECK (effect_readback_digest IS NULL OR effect_readback_digest ~ '^[0-9a-f]{64}$'),
  CHECK (last_error_digest IS NULL OR last_error_digest ~ '^[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(target) = 'object')
);

CREATE TABLE IF NOT EXISTS core_bootstrap_events (
  tenant_id varchar(128) NOT NULL,
  stream_type varchar(32) NOT NULL,
  stream_id varchar(128) NOT NULL,
  sequence_number bigint NOT NULL,
  event_id uuid NOT NULL,
  event_type varchar(80) NOT NULL,
  payload jsonb NOT NULL,
  previous_event_hash char(64),
  event_hash char(64) NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, event_id),
  UNIQUE (tenant_id, stream_type, stream_id, sequence_number),
  UNIQUE (tenant_id, event_hash),
  CHECK (stream_type IN ('TRUST_KEY','RELEASE_EXCEPTION')),
  CHECK (sequence_number > 0),
  CHECK (previous_event_hash IS NULL OR previous_event_hash ~ '^[0-9a-f]{64}$'),
  CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(payload) = 'object')
);

CREATE OR REPLACE FUNCTION core_bootstrap_forbid_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'core_bootstrap_append_only_violation'; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION core_bootstrap_trust_state_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.authority_key_id <> OLD.authority_key_id THEN
    RAISE EXCEPTION 'core_bootstrap_trust_identity_immutable';
  END IF;
  IF OLD.legacy_unattested = true AND NEW.legacy_unattested <> true THEN
    RAISE EXCEPTION 'core_bootstrap_legacy_unattested_immutable';
  END IF;
  IF NEW.legacy_unattested = true AND NEW.status NOT IN ('RETIRED','REVOKED') THEN
    RAISE EXCEPTION 'core_bootstrap_legacy_unattested_activation_denied';
  END IF;
  IF OLD.status = 'REVOKED'
     OR (OLD.status = 'RETIRED' AND NEW.status <> 'REVOKED')
     OR (OLD.status = 'ACTIVE' AND NEW.status NOT IN ('RETIRED','REVOKED')) THEN
    RAISE EXCEPTION 'core_bootstrap_trust_transition_invalid';
  END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS core_bootstrap_trust_keys_no_mutation ON core_bootstrap_trust_keys;
CREATE TRIGGER core_bootstrap_trust_keys_no_mutation BEFORE UPDATE OR DELETE ON core_bootstrap_trust_keys
FOR EACH ROW EXECUTE FUNCTION core_bootstrap_forbid_mutation();
DROP TRIGGER IF EXISTS core_bootstrap_receipts_no_mutation ON core_bootstrap_release_receipts;
CREATE TRIGGER core_bootstrap_receipts_no_mutation BEFORE UPDATE OR DELETE ON core_bootstrap_release_receipts
FOR EACH ROW EXECUTE FUNCTION core_bootstrap_forbid_mutation();
DROP TRIGGER IF EXISTS core_bootstrap_revocations_no_mutation ON core_bootstrap_release_revocations;
CREATE TRIGGER core_bootstrap_revocations_no_mutation BEFORE UPDATE OR DELETE ON core_bootstrap_release_revocations
FOR EACH ROW EXECUTE FUNCTION core_bootstrap_forbid_mutation();
DROP TRIGGER IF EXISTS core_bootstrap_consumptions_no_mutation ON core_bootstrap_release_consumptions;
CREATE TRIGGER core_bootstrap_consumptions_no_mutation BEFORE UPDATE OR DELETE ON core_bootstrap_release_consumptions
FOR EACH ROW EXECUTE FUNCTION core_bootstrap_forbid_mutation();
DROP TRIGGER IF EXISTS core_bootstrap_events_no_mutation ON core_bootstrap_events;
CREATE TRIGGER core_bootstrap_events_no_mutation BEFORE UPDATE OR DELETE ON core_bootstrap_events
FOR EACH ROW EXECUTE FUNCTION core_bootstrap_forbid_mutation();
DROP TRIGGER IF EXISTS core_bootstrap_trust_state_guard ON core_bootstrap_trust_key_state;
CREATE TRIGGER core_bootstrap_trust_state_guard BEFORE UPDATE ON core_bootstrap_trust_key_state
FOR EACH ROW EXECUTE FUNCTION core_bootstrap_trust_state_transition();
DROP TRIGGER IF EXISTS core_bootstrap_trust_state_no_delete ON core_bootstrap_trust_key_state;
CREATE TRIGGER core_bootstrap_trust_state_no_delete BEFORE DELETE ON core_bootstrap_trust_key_state
FOR EACH ROW EXECUTE FUNCTION core_bootstrap_forbid_mutation();
DROP TRIGGER IF EXISTS core_bootstrap_outbox_no_delete ON core_bootstrap_action_outbox;
CREATE TRIGGER core_bootstrap_outbox_no_delete BEFORE DELETE ON core_bootstrap_action_outbox
FOR EACH ROW EXECUTE FUNCTION core_bootstrap_forbid_mutation();

INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260810_bootstrap_authority_registry_v2_security')
ON CONFLICT DO NOTHING;

COMMIT;
