-- Entity 360 v1 is observational only. Existing rows must already conform;
-- do not rewrite history or silently coerce a tenant into SHADOW.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM core_entity360_feature_flags
     WHERE mode NOT IN ('OFF','SHADOW')
        OR (mode = 'OFF' AND enabled IS DISTINCT FROM false)
        OR (mode = 'SHADOW' AND enabled IS DISTINCT FROM true)
        OR (mode = 'OFF' AND policy_digest IS NOT NULL)
        OR (mode = 'SHADOW' AND policy_digest IS NULL)
        OR enforcement_authority_digest IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ENTITY360_SHADOW_MODE_MIGRATION_REFUSED_INVALID_EXISTING_FLAGS';
  END IF;
END $$;

ALTER TABLE core_entity360_feature_flags
  ADD CONSTRAINT core_entity360_feature_shadow_only_check CHECK (
    (mode = 'OFF'
      AND enabled = false
      AND policy_digest IS NULL
      AND enforcement_authority_digest IS NULL)
    OR
    (mode = 'SHADOW'
      AND enabled = true
      AND policy_digest IS NOT NULL
      AND enforcement_authority_digest IS NULL)
  );
