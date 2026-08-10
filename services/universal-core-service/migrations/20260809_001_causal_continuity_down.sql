-- migration: 20260809_001_causal_continuity_v1
-- Destructive rollback is refused after authoritative causal facts exist.
-- causal-migration:transactional
DO $$
DECLARE has_authoritative_rows BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM core_causal_event_ledger LIMIT 1)
      OR EXISTS (SELECT 1 FROM core_projects LIMIT 1)
    INTO has_authoritative_rows;
  IF has_authoritative_rows THEN
    RAISE EXCEPTION 'CAUSAL_DOWN_MIGRATION_REFUSED_AUTHORITATIVE_ROWS' USING ERRCODE = '55000';
  END IF;
END;
$$;

-- causal-migration:nontransactional
DROP INDEX CONCURRENTLY IF EXISTS core_continuity_works_tenant_project_uuid_idx;

-- causal-migration:transactional
ALTER TABLE IF EXISTS core_continuity_works DROP CONSTRAINT IF EXISTS core_continuity_works_tenant_project_uuid_fk;
ALTER TABLE IF EXISTS core_continuity_works DROP COLUMN IF EXISTS project_uuid;

DROP TABLE IF EXISTS core_causal_projection_outbox;
DROP TABLE IF EXISTS core_causal_event_ledger;
DROP TABLE IF EXISTS core_legacy_binding_resolutions;
DROP TABLE IF EXISTS core_causal_feature_flags;
DROP TABLE IF EXISTS core_conflict_records;
DROP TABLE IF EXISTS core_causal_continuity_capsules;
DROP TABLE IF EXISTS core_gallery_entity_bindings;
DROP TABLE IF EXISTS core_outcome_receipts;
DROP TABLE IF EXISTS core_temporal_checks;
DROP TABLE IF EXISTS core_causal_reconciliations;
DROP TABLE IF EXISTS core_reality_observations;
DROP TABLE IF EXISTS core_consumed_nonces;
DROP TABLE IF EXISTS core_causal_contexts;
DROP TABLE IF EXISTS core_action_lease_bindings;
DROP TABLE IF EXISTS core_evidence_contracts;
DROP TABLE IF EXISTS core_obligation_edges;
DROP TABLE IF EXISTS core_obligation_state_transitions;
DROP TABLE IF EXISTS core_causal_obligations;
DROP TABLE IF EXISTS core_change_state_transitions;
DROP TABLE IF EXISTS core_change_artifacts;
DROP TABLE IF EXISTS core_changes;
DROP TABLE IF EXISTS core_work_relationships;
DROP TABLE IF EXISTS core_work_causal_bindings;
DROP TABLE IF EXISTS core_decision_alternatives;
DROP TABLE IF EXISTS core_decision_records;
DROP TABLE IF EXISTS core_intent_revision_edges;
DROP TABLE IF EXISTS core_intent_revisions;
DROP TABLE IF EXISTS core_genesis_intents;
DROP TABLE IF EXISTS core_project_state_snapshots;
DROP TABLE IF EXISTS core_project_scope_resources;
DROP TABLE IF EXISTS core_project_aliases;
DROP TABLE IF EXISTS core_projects;
DROP FUNCTION IF EXISTS core_causal_intent_revision_guard();
DROP FUNCTION IF EXISTS core_causal_append_only_guard();

DELETE FROM core_schema_migrations WHERE migration_id='20260809_001_causal_continuity_v1';
