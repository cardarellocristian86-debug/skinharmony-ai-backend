DROP TRIGGER IF EXISTS core_release_tuple_resolutions_append_only
  ON core_release_tuple_resolutions;
DROP INDEX IF EXISTS core_release_tuple_resolution_read_idx;
DROP TABLE IF EXISTS core_release_tuple_resolutions;
ALTER TABLE core_projects
  DROP CONSTRAINT IF EXISTS core_projects_derived_from_intent_revision_fk;
ALTER TABLE core_projects
  DROP COLUMN IF EXISTS derived_from_intent_revision_id;
DELETE FROM core_schema_migrations
 WHERE migration_id='20260812_001_causal_identity_release_resolution_v1';
