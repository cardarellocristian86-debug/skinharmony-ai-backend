-- migration: 20260809_001_causal_continuity_v1
-- PostgreSQL 16+; additive and legacy-compatible.
-- causal-migration:transactional
CREATE TABLE IF NOT EXISTS core_schema_migrations (
  migration_id TEXT PRIMARY KEY,
  sql_digest CHAR(64) NOT NULL,
  application_state TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  verifier_evidence JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS core_projects (
  tenant_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  derived_from_project_id UUID,
  canonical_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','TERMINATED')),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  active_state_digest CHAR(64),
  active_intent_revision_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_id),
  UNIQUE (tenant_id, canonical_name),
  FOREIGN KEY (tenant_id, derived_from_project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_project_aliases (
  tenant_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  project_id UUID NOT NULL,
  provenance JSONB NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, alias),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_project_scope_resources (
  tenant_id TEXT NOT NULL,
  resource_id UUID NOT NULL,
  project_id UUID NOT NULL,
  resource_type TEXT NOT NULL,
  canonical_identifier TEXT NOT NULL,
  environment TEXT NOT NULL,
  ownership JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  provenance JSONB NOT NULL,
  resource_digest CHAR(64),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_verified_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, resource_id),
  UNIQUE (tenant_id, project_id, resource_type, canonical_identifier, environment),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_project_state_snapshots (
  tenant_id TEXT NOT NULL,
  snapshot_id UUID NOT NULL,
  project_id UUID NOT NULL,
  canonicalization_version TEXT NOT NULL,
  canonical_state JSONB NOT NULL,
  state_digest CHAR(64) NOT NULL,
  ledger_sequence BIGINT NOT NULL CHECK (ledger_sequence > 0),
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, snapshot_id),
  UNIQUE (tenant_id, project_id, state_digest),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_genesis_intents (
  tenant_id TEXT NOT NULL,
  genesis_intent_id UUID NOT NULL,
  project_id UUID NOT NULL,
  intent_text TEXT NOT NULL,
  author_id TEXT NOT NULL,
  canonical_digest CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, genesis_intent_id),
  UNIQUE (tenant_id, project_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_intent_revisions (
  tenant_id TEXT NOT NULL,
  intent_revision_id UUID NOT NULL,
  project_id UUID NOT NULL,
  genesis_intent_id UUID NOT NULL,
  parent_revision_id UUID,
  alias TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('REFINEMENT','SCOPE_CHANGE','STRATEGIC_PIVOT','PURPOSE_CHANGE','ROLLBACK','TERMINATION')),
  state TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (state IN ('PROPOSED','APPROVED','REJECTED')),
  revision_payload JSONB NOT NULL,
  author_id TEXT NOT NULL,
  authorized_by TEXT,
  canonical_digest CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  decided_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, intent_revision_id),
  UNIQUE (tenant_id, project_id, alias),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, genesis_intent_id) REFERENCES core_genesis_intents (tenant_id, genesis_intent_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, parent_revision_id) REFERENCES core_intent_revisions (tenant_id, intent_revision_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_intent_revision_edges (
  tenant_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  parent_revision_id UUID NOT NULL,
  child_revision_id UUID NOT NULL,
  relation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, parent_revision_id, child_revision_id),
  CHECK (parent_revision_id <> child_revision_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, parent_revision_id) REFERENCES core_intent_revisions (tenant_id, intent_revision_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, child_revision_id) REFERENCES core_intent_revisions (tenant_id, intent_revision_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_decision_records (
  tenant_id TEXT NOT NULL,
  decision_id UUID NOT NULL,
  project_id UUID NOT NULL,
  intent_revision_id UUID NOT NULL,
  problem TEXT NOT NULL,
  chosen_alternative TEXT NOT NULL,
  rationale TEXT NOT NULL,
  invariants JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  canonical_digest CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, decision_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, intent_revision_id) REFERENCES core_intent_revisions (tenant_id, intent_revision_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_decision_alternatives (
  tenant_id TEXT NOT NULL,
  alternative_id UUID NOT NULL,
  decision_id UUID NOT NULL,
  label TEXT NOT NULL,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, alternative_id),
  FOREIGN KEY (tenant_id, decision_id) REFERENCES core_decision_records (tenant_id, decision_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_work_causal_bindings (
  tenant_id TEXT NOT NULL,
  work_id UUID NOT NULL,
  project_id UUID NOT NULL,
  genesis_intent_id UUID NOT NULL,
  intent_revision_id UUID NOT NULL,
  base_state_digest CHAR(64),
  legacy_binding_state TEXT NOT NULL DEFAULT 'VERIFIED' CHECK (legacy_binding_state IN ('VERIFIED','UNRESOLVED_LEGACY_BINDING')),
  provenance JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, work_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, genesis_intent_id) REFERENCES core_genesis_intents (tenant_id, genesis_intent_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, intent_revision_id) REFERENCES core_intent_revisions (tenant_id, intent_revision_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_work_relationships (
  tenant_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  parent_work_id UUID NOT NULL,
  child_work_id UUID NOT NULL,
  relation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, parent_work_id, child_work_id),
  CHECK (parent_work_id <> child_work_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, parent_work_id) REFERENCES core_work_causal_bindings (tenant_id, work_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, child_work_id) REFERENCES core_work_causal_bindings (tenant_id, work_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_changes (
  tenant_id TEXT NOT NULL,
  change_id UUID NOT NULL,
  project_id UUID NOT NULL,
  work_id UUID NOT NULL,
  intent_revision_id UUID NOT NULL,
  parent_change_id UUID,
  alias TEXT,
  reason TEXT NOT NULL,
  scope JSONB NOT NULL,
  expected_effects JSONB NOT NULL,
  forbidden_effects JSONB NOT NULL,
  base_state_digest CHAR(64) NOT NULL,
  expected_target_state JSONB NOT NULL,
  observed_target_state JSONB,
  state TEXT NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','MODELED','AUTHORIZED','EXECUTED','OBSERVING','VERIFIED_PROVISIONAL','VERIFIED_FINAL','PARTIAL','CONTRADICTED','HARMFUL','UNKNOWN','REMEDIATING','ROLLED_BACK','ESCALATED','CLOSED')),
  request_digest CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, change_id),
  UNIQUE (tenant_id, project_id, work_id, request_digest),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_work_causal_bindings (tenant_id, work_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, intent_revision_id) REFERENCES core_intent_revisions (tenant_id, intent_revision_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, parent_change_id) REFERENCES core_changes (tenant_id, change_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_change_artifacts (
  tenant_id TEXT NOT NULL,
  artifact_id UUID NOT NULL,
  change_id UUID NOT NULL,
  artifact_type TEXT NOT NULL,
  canonical_identifier TEXT NOT NULL,
  artifact_digest CHAR(64),
  provenance JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, artifact_id),
  UNIQUE (tenant_id, change_id, artifact_type, canonical_identifier),
  FOREIGN KEY (tenant_id, change_id) REFERENCES core_changes (tenant_id, change_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_change_state_transitions (
  tenant_id TEXT NOT NULL,
  transition_id UUID NOT NULL,
  change_id UUID NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_provenance JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, transition_id),
  FOREIGN KEY (tenant_id, change_id) REFERENCES core_changes (tenant_id, change_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_causal_obligations (
  tenant_id TEXT NOT NULL,
  obligation_id UUID NOT NULL,
  project_id UUID NOT NULL,
  intent_revision_id UUID NOT NULL,
  work_id UUID NOT NULL,
  change_id UUID NOT NULL,
  claim TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  delegated_owners JSONB NOT NULL DEFAULT '[]'::jsonb,
  expected_effects JSONB NOT NULL,
  forbidden_effects JSONB NOT NULL,
  assurance_level TEXT NOT NULL CHECK (assurance_level IN ('CAL-0','CAL-1','CAL-2','CAL-3','CAL-4')),
  verification_horizons JSONB NOT NULL,
  rollback_plan JSONB NOT NULL,
  residual_obligations JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_verification_at TIMESTAMPTZ,
  state TEXT NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','MODELED','AUTHORIZED','EXECUTED','OBSERVING','VERIFIED_PROVISIONAL','VERIFIED_FINAL','PARTIAL','CONTRADICTED','HARMFUL','UNKNOWN','REMEDIATING','ROLLED_BACK','ESCALATED','CLOSED')),
  obligation_digest CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, obligation_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, intent_revision_id) REFERENCES core_intent_revisions (tenant_id, intent_revision_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_work_causal_bindings (tenant_id, work_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, change_id) REFERENCES core_changes (tenant_id, change_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_obligation_state_transitions (
  tenant_id TEXT NOT NULL,
  transition_id UUID NOT NULL,
  obligation_id UUID NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_provenance JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, transition_id),
  FOREIGN KEY (tenant_id, obligation_id) REFERENCES core_causal_obligations (tenant_id, obligation_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_obligation_edges (
  tenant_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  parent_obligation_id UUID NOT NULL,
  child_obligation_id UUID NOT NULL,
  relation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, parent_obligation_id, child_obligation_id),
  CHECK (parent_obligation_id <> child_obligation_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, parent_obligation_id) REFERENCES core_causal_obligations (tenant_id, obligation_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, child_obligation_id) REFERENCES core_causal_obligations (tenant_id, obligation_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_evidence_contracts (
  tenant_id TEXT NOT NULL,
  evidence_contract_id UUID NOT NULL,
  obligation_id UUID NOT NULL,
  required_sources JSONB NOT NULL,
  minimum_independence TEXT NOT NULL,
  minimum_independent_observers INTEGER NOT NULL DEFAULT 1 CHECK (minimum_independent_observers >= 0 AND minimum_independent_observers <= 32),
  freshness_seconds BIGINT NOT NULL CHECK (freshness_seconds >= 0),
  minimum_assurance_level TEXT NOT NULL CHECK (minimum_assurance_level IN ('CAL-0','CAL-1','CAL-2','CAL-3','CAL-4')),
  horizons JSONB NOT NULL,
  falsification_conditions JSONB NOT NULL,
  forbidden_effect_observers JSONB NOT NULL,
  contract_digest CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, evidence_contract_id),
  UNIQUE (tenant_id, obligation_id),
  FOREIGN KEY (tenant_id, obligation_id) REFERENCES core_causal_obligations (tenant_id, obligation_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_action_lease_bindings (
  tenant_id TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  work_id UUID NOT NULL,
  change_id UUID NOT NULL,
  obligation_id UUID NOT NULL,
  obligation_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  authority_scope JSONB NOT NULL,
  lease_purpose TEXT NOT NULL DEFAULT 'legacy_unproven',
  lease_surfaces JSONB NOT NULL DEFAULT '[]'::jsonb,
  authority_binding_digest CHAR(64),
  verification_digest CHAR(64) NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, lease_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_work_causal_bindings (tenant_id, work_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, change_id) REFERENCES core_changes (tenant_id, change_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, obligation_id) REFERENCES core_causal_obligations (tenant_id, obligation_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_causal_contexts (
  tenant_id TEXT NOT NULL,
  context_id UUID NOT NULL,
  project_id UUID NOT NULL,
  work_id UUID NOT NULL,
  change_id UUID NOT NULL,
  context_digest CHAR(64) NOT NULL,
  envelope JSONB NOT NULL,
  signature JSONB NOT NULL,
  enforcement_mode TEXT NOT NULL CHECK (enforcement_mode IN ('SHADOW','ENFORCE_NEW_WORK','ENFORCE_ALL_COMPATIBLE')),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, context_id),
  UNIQUE (tenant_id, context_digest),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_work_causal_bindings (tenant_id, work_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, change_id) REFERENCES core_changes (tenant_id, change_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_consumed_nonces (
  tenant_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  context_id UUID NOT NULL,
  issuer_id TEXT NOT NULL,
  nonce_digest CHAR(64) NOT NULL,
  context_digest CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, issuer_id, nonce_digest),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, context_id) REFERENCES core_causal_contexts (tenant_id, context_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_reality_observations (
  tenant_id TEXT NOT NULL,
  observation_id UUID NOT NULL,
  project_id UUID NOT NULL,
  intent_revision_id UUID NOT NULL,
  work_id UUID NOT NULL,
  change_id UUID NOT NULL,
  obligation_id UUID NOT NULL,
  source TEXT NOT NULL,
  observer_identity TEXT NOT NULL,
  observer_role TEXT NOT NULL,
  provenance JSONB NOT NULL,
  independence TEXT NOT NULL CHECK (independence IN ('EXECUTOR','INDEPENDENT_SYSTEM','INDEPENDENT_HUMAN','FORMAL')),
  baseline JSONB NOT NULL,
  freshness_seconds BIGINT NOT NULL CHECK (freshness_seconds >= 0),
  observed_at TIMESTAMPTZ NOT NULL,
  evidence_digest CHAR(64) NOT NULL,
  causal_relation TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  contradiction_status TEXT NOT NULL CHECK (contradiction_status IN ('NONE','POTENTIAL','CONFIRMED')),
  observation_digest CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, observation_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, intent_revision_id) REFERENCES core_intent_revisions (tenant_id, intent_revision_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_work_causal_bindings (tenant_id, work_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, change_id) REFERENCES core_changes (tenant_id, change_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, obligation_id) REFERENCES core_causal_obligations (tenant_id, obligation_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_causal_reconciliations (
  tenant_id TEXT NOT NULL,
  reconciliation_id UUID NOT NULL,
  project_id UUID NOT NULL,
  intent_revision_id UUID NOT NULL,
  work_id UUID NOT NULL,
  change_id UUID NOT NULL,
  obligation_id UUID NOT NULL,
  observation_ids JSONB NOT NULL,
  reconciliation_payload JSONB NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('VERIFIED_PROVISIONAL','VERIFIED_FINAL','PARTIAL','CONTRADICTED','HARMFUL','UNKNOWN')),
  achieved_assurance_level TEXT NOT NULL CHECK (achieved_assurance_level IN ('CAL-0','CAL-1','CAL-2','CAL-3','CAL-4')),
  reconciliation_digest CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, reconciliation_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, obligation_id) REFERENCES core_causal_obligations (tenant_id, obligation_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_temporal_checks (
  tenant_id TEXT NOT NULL,
  temporal_check_id UUID NOT NULL,
  obligation_id UUID NOT NULL,
  horizon TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','SATISFIED','FAILED','CANCELLED')),
  observation_id UUID,
  checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, temporal_check_id),
  FOREIGN KEY (tenant_id, obligation_id) REFERENCES core_causal_obligations (tenant_id, obligation_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, observation_id) REFERENCES core_reality_observations (tenant_id, observation_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_outcome_receipts (
  tenant_id TEXT NOT NULL,
  outcome_receipt_id UUID NOT NULL,
  project_id UUID NOT NULL,
  obligation_id UUID NOT NULL,
  reconciliation_id UUID NOT NULL,
  receipt_payload JSONB NOT NULL,
  receipt_digest CHAR(64) NOT NULL,
  closure_state TEXT NOT NULL,
  invalidated_by_observation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, outcome_receipt_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, obligation_id) REFERENCES core_causal_obligations (tenant_id, obligation_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, reconciliation_id) REFERENCES core_causal_reconciliations (tenant_id, reconciliation_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, invalidated_by_observation_id) REFERENCES core_reality_observations (tenant_id, observation_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_gallery_entity_bindings (
  tenant_id TEXT NOT NULL,
  binding_id UUID NOT NULL,
  project_id UUID NOT NULL,
  project_state_digest CHAR(64) NOT NULL,
  genesis_intent_id UUID NOT NULL,
  intent_revision_id UUID NOT NULL,
  work_id UUID NOT NULL,
  change_id UUID,
  obligation_ids JSONB NOT NULL,
  entity_type TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  parent_ticket_id TEXT,
  core_event_sequence BIGINT NOT NULL,
  context_digest CHAR(64) NOT NULL,
  provenance JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','ACTIVE','INACTIVE','ORPHAN_GALLERY_ITEM','QUARANTINED')),
  binding_digest CHAR(64) NOT NULL,
  last_readback_digest CHAR(64),
  first_verified_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, binding_id),
  UNIQUE (tenant_id, entity_type, ticket_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_work_causal_bindings (tenant_id, work_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, change_id) REFERENCES core_changes (tenant_id, change_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_causal_continuity_capsules (
  tenant_id TEXT NOT NULL,
  capsule_id UUID NOT NULL,
  project_id UUID NOT NULL,
  work_id UUID NOT NULL,
  generated_from_event_sequence BIGINT NOT NULL,
  capsule_payload JSONB NOT NULL,
  capsule_digest CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, capsule_id),
  UNIQUE (tenant_id, project_id, work_id, capsule_digest),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_work_causal_bindings (tenant_id, work_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_conflict_records (
  tenant_id TEXT NOT NULL,
  conflict_id UUID NOT NULL,
  project_id UUID NOT NULL,
  work_id UUID,
  change_id UUID,
  conflict_type TEXT NOT NULL,
  details JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','RESOLVED','ESCALATED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  resolved_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, conflict_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_causal_feature_flags (
  tenant_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('SHADOW','ENFORCE_NEW_WORK','ENFORCE_ALL_COMPATIBLE')),
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_legacy_binding_resolutions (
  tenant_id TEXT NOT NULL,
  resolution_id UUID NOT NULL,
  legacy_type TEXT NOT NULL,
  legacy_identifier TEXT NOT NULL,
  project_id UUID,
  work_id UUID,
  state TEXT NOT NULL CHECK (state IN ('VERIFIED','UNRESOLVED_LEGACY_BINDING','REJECTED')),
  evidence JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, resolution_id),
  UNIQUE (tenant_id, legacy_type, legacy_identifier),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_causal_event_ledger (
  tenant_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  event_id UUID NOT NULL,
  sequence_number BIGINT NOT NULL CHECK (sequence_number > 0),
  event_type TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest CHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  payload_digest CHAR(64) NOT NULL,
  actor_provenance JSONB NOT NULL,
  actor_provenance_digest CHAR(64) NOT NULL,
  previous_event_hash CHAR(64),
  event_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, project_id, event_id),
  UNIQUE (tenant_id, project_id, sequence_number),
  UNIQUE (tenant_id, project_id, operation, idempotency_key),
  FOREIGN KEY (tenant_id, project_id) REFERENCES core_projects (tenant_id, project_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS core_causal_projection_outbox (
  tenant_id TEXT NOT NULL,
  outbox_id UUID NOT NULL,
  project_id UUID NOT NULL,
  event_id UUID NOT NULL,
  projection_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_digest CHAR(64) NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','CLAIMED','DELIVERED','RETRY_WAIT','QUARANTINED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  claimed_by TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  lease_expires_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  delivered_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, outbox_id),
  UNIQUE (tenant_id, project_id, event_id, projection_type),
  FOREIGN KEY (tenant_id, project_id, event_id) REFERENCES core_causal_event_ledger (tenant_id, project_id, event_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS core_project_scope_active_idx ON core_project_scope_resources (tenant_id, project_id, resource_type) WHERE active;
CREATE INDEX IF NOT EXISTS core_project_state_latest_idx ON core_project_state_snapshots (tenant_id, project_id, ledger_sequence DESC);
CREATE INDEX IF NOT EXISTS core_intent_revision_project_idx ON core_intent_revisions (tenant_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS core_change_work_state_idx ON core_changes (tenant_id, work_id, state);
CREATE INDEX IF NOT EXISTS core_change_transition_read_idx ON core_change_state_transitions (tenant_id, change_id, created_at DESC);
CREATE INDEX IF NOT EXISTS core_obligation_work_state_idx ON core_causal_obligations (tenant_id, work_id, state);
CREATE INDEX IF NOT EXISTS core_obligation_transition_read_idx ON core_obligation_state_transitions (tenant_id, obligation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS core_observation_obligation_idx ON core_reality_observations (tenant_id, obligation_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS core_temporal_due_idx ON core_temporal_checks (tenant_id, state, due_at) WHERE state = 'PENDING';
CREATE INDEX IF NOT EXISTS core_causal_ledger_read_idx ON core_causal_event_ledger (tenant_id, project_id, sequence_number DESC);
CREATE INDEX IF NOT EXISTS core_gallery_binding_project_sequence_idx ON core_gallery_entity_bindings (tenant_id, project_id, core_event_sequence DESC);
CREATE INDEX IF NOT EXISTS core_gallery_binding_tenant_ticket_idx ON core_gallery_entity_bindings (tenant_id, ticket_id);
CREATE INDEX IF NOT EXISTS core_conflict_project_work_idx ON core_conflict_records (tenant_id, project_id, work_id, created_at DESC);
CREATE INDEX IF NOT EXISTS core_causal_outbox_claim_idx ON core_causal_projection_outbox (tenant_id, state, available_at) WHERE state IN ('PENDING','RETRY_WAIT');

CREATE OR REPLACE FUNCTION core_causal_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CAUSAL_APPEND_ONLY_VIOLATION:%', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION core_causal_intent_revision_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CAUSAL_APPEND_ONLY_VIOLATION:%', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'PROPOSED'
     AND NEW.state IN ('APPROVED','REJECTED')
     AND NEW.tenant_id = OLD.tenant_id
     AND NEW.intent_revision_id = OLD.intent_revision_id
     AND NEW.project_id = OLD.project_id
     AND NEW.genesis_intent_id = OLD.genesis_intent_id
     AND NEW.parent_revision_id IS NOT DISTINCT FROM OLD.parent_revision_id
     AND NEW.alias = OLD.alias
     AND NEW.classification = OLD.classification
     AND NEW.revision_payload = OLD.revision_payload
     AND NEW.author_id = OLD.author_id
     AND NEW.canonical_digest = OLD.canonical_digest
     AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'CAUSAL_INTENT_REVISION_IMMUTABLE' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS core_intent_revisions_immutable ON core_intent_revisions;
CREATE TRIGGER core_intent_revisions_immutable
BEFORE UPDATE OR DELETE ON core_intent_revisions
FOR EACH ROW EXECUTE FUNCTION core_causal_intent_revision_guard();

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'core_genesis_intents','core_intent_revision_edges','core_decision_records',
    'core_decision_alternatives','core_change_state_transitions','core_obligation_state_transitions',
    'core_reality_observations','core_causal_reconciliations',
    'core_outcome_receipts','core_causal_continuity_capsules','core_causal_event_ledger','core_consumed_nonces'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', table_name || '_append_only', table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION core_causal_append_only_guard()', table_name || '_append_only', table_name);
  END LOOP;
END;
$$;

ALTER TABLE IF EXISTS core_continuity_works ADD COLUMN IF NOT EXISTS project_uuid UUID NULL;

DO $$
BEGIN
  IF to_regclass('core_continuity_works') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'core_continuity_works_tenant_project_uuid_fk') THEN
    ALTER TABLE core_continuity_works
      ADD CONSTRAINT core_continuity_works_tenant_project_uuid_fk
      FOREIGN KEY (tenant_id, project_uuid)
      REFERENCES core_projects (tenant_id, project_id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END;
$$;

-- causal-migration:nontransactional
CREATE INDEX CONCURRENTLY IF NOT EXISTS core_continuity_works_tenant_project_uuid_idx
  ON core_continuity_works (tenant_id, project_uuid)
  WHERE project_uuid IS NOT NULL;

-- causal-migration:transactional
DO $$
BEGIN
  IF to_regclass('core_continuity_works') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'core_continuity_works_tenant_project_uuid_fk'
          AND NOT convalidated
     ) THEN
    ALTER TABLE core_continuity_works
      VALIDATE CONSTRAINT core_continuity_works_tenant_project_uuid_fk;
  END IF;
END;
$$;
