-- migration: 20260810_002_project_scope_render_origin_indexes_v1
-- causal-migration:nontransactional
DROP INDEX CONCURRENTLY IF EXISTS core_reality_observation_project_lookup_idx;
DROP INDEX CONCURRENTLY IF EXISTS core_project_scope_render_lookup_idx;
