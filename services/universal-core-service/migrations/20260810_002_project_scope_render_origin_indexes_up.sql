-- migration: 20260810_002_project_scope_render_origin_indexes_v1
-- Additive exact lookup indexes for the host-native Project Scope resolver.
-- causal-migration:nontransactional
CREATE INDEX CONCURRENTLY IF NOT EXISTS core_project_scope_render_lookup_idx
  ON core_project_scope_resources
  (tenant_id, resource_type, canonical_identifier, environment, project_id, resource_id)
  WHERE active IS TRUE;

CREATE INDEX CONCURRENTLY IF NOT EXISTS core_reality_observation_project_lookup_idx
  ON core_reality_observations (tenant_id, project_id, observation_id);
