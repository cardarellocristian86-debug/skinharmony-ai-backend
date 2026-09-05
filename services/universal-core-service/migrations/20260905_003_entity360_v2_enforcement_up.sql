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
