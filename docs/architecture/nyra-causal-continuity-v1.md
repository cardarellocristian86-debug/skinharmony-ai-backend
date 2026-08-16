# Nyra Causal Continuity and Reality Closure v1

Status: corrected architecture contract after independent red-team rejection; implementation remains unverified until the reviewer accepts the exact revision and Core records it.

## Governed identity

- Tenant: `codexai`
- Legacy project alias: `skinharmony-ai-backend`
- Governed Work: `52cf629b-ec5d-4a5b-ab84-08eb35afd8ea`
- Intent Anchor digest: `3b31a80ee4ae67d3625399bd017c63ea03d85ffa74faed3fd01cb664f4d6e02d`
- Native plan: `f7fb7649-1dd4-5943-a2e4-b1b35ced3ac4`
- Baseline repository commit: `19eb2b42b1a116f146b7c3264a0a1fdd036e3066`
- Baseline tree: `be32906c5fa47787260439897be144ce0d9ad862`
- Delivery branch: `feat/nyra-causal-continuity-reality-closure-v1`

`skinharmony-ai-backend` is an existing legacy alias, not the new authoritative Project ID. Universal Core must generate the authoritative UUID and persist the alias binding after the migration is deployed. Existing Work rows keep their legacy `project_id`; no historical relationship is inferred.

## Genesis Intent and approved refinement

The immutable project Genesis Intent is:

> Costruire un’infrastruttura AI governata, multi-tenant, multiagente, persistente e verificabile, capace di mantenere sicurezza, continuità del lavoro, memoria affidabile, controllo delle azioni e responsabilità operativa tra sessioni, agenti, modelli e strumenti differenti.

The owner-approved revision alias is `causal-continuity-and-reality-closure-v1`. It is a `REFINEMENT` plus `SCOPE_CHANGE`, not a purpose change. The revision extends continuity to stable project identity, verified state, intent lineage, decisions, Work, Change, obligations, evidence, real consequences, temporal checks and reopening.

## Baseline reality

Initial production readback on 2026-08-09 used `19eb2b42...`. A later
readback in the same governed Work detected and recorded
`STALE_PROJECT_STATE_UPSTREAM_MAIN_ADVANCED` (Core incident fingerprint
`647ec41144849f4dd486f6cda7664642b4ec953aa6f251b27a9b6aac0db4939a`,
event sequence 63). The current release baseline is therefore:

| Surface | Exact observation |
| --- | --- |
| Universal Core | service `srv-d82c9j3tqb8s73cgriag`; healthy; exact build `3a0370875a0adc090a3e8c71e363dd36725e1808`; host-native governance ready; PostgreSQL-backed DTT; Airlock enforced |
| Core MCP | service `srv-d99ef1mcjfls73857m40`; healthy; exact build `3a0370875a0adc090a3e8c71e363dd36725e1808`; Work Continuity v2 and Decision Ledger ready; PostgreSQL major 18 |
| Nyra Core | service `srv-d7npri57vvec739alhog`; healthy on tracked branch `codex/nyra-autonomy-render-20260727`; exact live commit `efe306e12138e134ba97aac1b197975737b26b9f`; horizontal runtime and durable replay ready |
| GitHub `main` | exact `3a0370875a0adc090a3e8c71e363dd36725e1808`, matching Universal Core and MCP production |
| Staging Universal Core | service `srv-d9l37i3l550s73fgr0sg`; branch `feature/nyra-defensive-hardening-v1-1`; exact live commit `80b28a23c4f95af3ee9e4447af80c32beea7d5a2` |
| Staging MCP | service `srv-d9l37ir7uimc738ffpr0`; same branch/commit; public health reports legacy `0.8.0` and lacks the current continuity readiness contract |
| Staging Nyra | service `srv-d9qfeqk9v7es73esvsqg`; same branch/commit; existing rollback deployment is visible |
| Staging PostgreSQL | service `dpg-d9cdeie1a83c73ca5l10-a`; PostgreSQL major 18 |
| Research Airlock | `enforced`, PostgreSQL, distributed, fail-closed; fresh-session status succeeded |
| Nyra Policy Registry | runtime ready, but proof `ready:false` because key material is missing; secret remediation is out of scope |

The staging gap is a rollout constraint, not permission to bypass production governance.

## Architecture map

```text
ChatGPT / Codex host
  -> Core MCP (authenticated tenant gateway)
       -> Universal Core (authoritative causal aggregate and policy)
            -> shared PostgreSQL
                 - Project / state / intent / decision
                 - Work binding / Change / Obligation
                 - Causal Event Ledger / nonce / context
                 - Observation / reconciliation / temporal checks / receipt
                 - Gallery projection and outbox
            -> existing DTT evidence trust
            -> existing action authorization and host-native release tickets
            -> existing Research Airlock
       -> Nyra Core (semantic proposer; never final authority)
            -> intent compiler / drift / impact / rebase / continuity brief
            -> branch dispatcher with immutable causal identity
       -> Tenant Work Gallery (operational projection)
       -> GitHub / CI / Render / observer readback
```

## Reuse map

The implementation extends these verified primitives:

- `createWorkContinuityRuntime`, advisory locks, row locks, idempotency and `appendEvent` in `services/skinharmony-core-mcp/src/work-continuity-runtime.js`.
- Immutable Work Intent Anchor and acceptance contract builders in the same runtime. The anchor remains Work-scoped and is not renamed Genesis Intent.
- Participant presence, bounded surface leases, overlap detection and Gallery coordination.
- Native builder/verifier binding, one-task capabilities, receipts, Core Join and exact external readback.
- `createHostNativeGovernance`, action tickets, reserve/complete/reconcile and rollback readback in Universal Core.
- DTT verification evidence, independent observer checks and self-verification blocks.
- Research Airlock PostgreSQL nonce/TTL/atomic-consume patterns.
- Deep Branch v2 issuer/audience/digest/anti-replay envelope; cryptography and secrets are not duplicated.
- `deterministicBranchRegistry`, `composeBranchContext` and the common branch analyzer route.
- Nyra scenario, counterfactual, calibration and horizontal intent interpretation.
- Existing PostgreSQL 16 CI service and concurrency harness.

## Gap analysis

1. Work/Gallery truth currently lives in Core MCP while host-native ticket truth is partly file-backed in Universal Core.
2. `core_continuity_works` and `tenant_work` are separate Work models; neither may become a third causal Work registry.
3. Decision Ledger creates trace Work IDs per tool call instead of binding the governed Work.
4. No authoritative Project Aggregate, scope manifest or deterministic Project State Digest exists.
5. Intent Anchor exists only per Work; Genesis Intent and append-only revisions do not.
6. Change, Causal Obligation, CAL, observations, reconciliation, temporal checks and causal receipts do not exist.
7. Current closure goes directly to `completed`; provisional/final verification and reopening are missing.
8. Branch Registry has 72 branches and zero coverage for all required causal contract fields.
9. Gallery lacks typed causal bindings, orphan quarantine and causal views.
10. The generic Causal Context Envelope is not propagated across MCP, Nyra, branches, Git, CI, deploy and observation.
11. Project-wide stale state and canonical state snapshots are absent.
12. Ledgers are fragmented across Work, Decision, DTT, Airlock and Nyra replay stores.

## Data model

Universal Core owns the additive schema on the PostgreSQL database already shared with Core MCP. New tables use composite tenant keys and restrictive foreign keys:

- `core_projects`, `core_project_aliases`, `core_project_scope_resources`, `core_project_state_snapshots`
- `core_genesis_intents`, `core_intent_revisions`, `core_intent_revision_edges`
- `core_decision_records`, `core_decision_alternatives`
- `core_work_causal_bindings`, `core_work_relationships`
- `core_changes`, `core_change_artifacts`, `core_change_state_transitions`
- `core_causal_obligations`, `core_obligation_edges`, `core_evidence_contracts`
- `core_action_lease_bindings`, `core_causal_contexts`, `core_consumed_nonces`
- `core_reality_observations`, `core_causal_reconciliations`, `core_temporal_checks`
- `core_outcome_receipts`, `core_gallery_entity_bindings`
- `core_causal_continuity_capsules`, `core_conflict_records`
- `core_causal_event_ledger`, `core_causal_feature_flags`
- `core_legacy_binding_resolutions`, `core_schema_migrations`, `core_causal_projection_outbox`

`core_continuity_works` receives only a nullable `project_uuid` binding. `tenant_work` remains a compatibility projection. Ambiguous records are marked `UNRESOLVED_LEGACY_BINDING`.

### Relational and concurrency contract

- Every authoritative primary key is `(tenant_id, entity_id)`. Every relationship uses a composite foreign key containing the same `tenant_id`; no application-only cross-tenant join is accepted.
- A Project row has a monotonic `version`. Project state, revision activation, Work binding, Change authorization and closure use `SELECT ... FOR UPDATE` plus compare-and-swap on that version.
- The event ledger owns `UNIQUE (tenant_id, project_id, sequence_number)`, `UNIQUE (tenant_id, project_id, event_id)` and `UNIQUE (tenant_id, project_id, operation, idempotency_key)`. Its canonical payload digest and previous hash are written in the same transaction as the projection change.
- The projection outbox is inserted in the authoritative transaction. Workers claim rows with `FOR UPDATE SKIP LOCKED`, bounded batches and leases; poison rows become `QUARANTINED` after a bounded attempt count without rolling back Core truth.
- Context nonces have a unique tenant/issuer/nonce digest and are consumed atomically with the authorized transition. Validation that does not authorize a mutation is side-effect free.
- DAG edges reject self-edges and cycles under a project advisory transaction lock. Idempotent creation returns the existing row only when the canonical request digest is identical; otherwise it returns `IDEMPOTENCY_CONFLICT`.
- Timestamps, retry counters and observer-local fields never enter deterministic state digests. Database time is authoritative for TTL and temporal boundaries.
- Append-only rows (`genesis`, historical revisions, decisions, observations, ledger events and receipts) deny `UPDATE`/`DELETE` through privileges and defensive triggers. Corrective facts are new rows/events.

### Transaction boundaries

One transaction covers state comparison, policy decision reference, projection mutation, causal event append and outbox enqueue. External Gallery/GitHub/Render calls never occur inside that transaction. Their exact readback is appended later as an observation. Crash recovery can therefore replay an outbox item, but cannot duplicate an authoritative transition.

## Project State Digest

Canonicalization is versioned as `causal_canonical_json_v1` and uses the repository's SHA-256 convention. The canonical payload contains sorted, tenant-bound active scope resources and verified resource digests, but excludes timestamps and observer-local metadata. The snapshot row stores `observed_at` and the causal ledger sequence outside the canonical payload.

Every governed Change declares `base_state_digest`, `expected_target_state` and later `observed_target_state`. A mismatch returns `STALE_PROJECT_STATE` and requires logical rebase plus impact analysis.

## State machines

Intent revisions are append-only:

```text
PROPOSED -> APPROVED | REJECTED
APPROVED -> a new child revision, never UPDATE
PURPOSE_CHANGE -> NEW_PROJECT_REQUIRED with derived_from
```

Causal Obligation:

```text
DRAFT -> MODELED -> AUTHORIZED -> EXECUTED -> OBSERVING
OBSERVING -> VERIFIED_PROVISIONAL -> VERIFIED_FINAL -> CLOSED
OBSERVING -> PARTIAL | CONTRADICTED | HARMFUL | UNKNOWN | ESCALATED
PARTIAL | CONTRADICTED | HARMFUL -> REMEDIATING
REMEDIATING -> OBSERVING | ROLLED_BACK | ESCALATED
VERIFIED_PROVISIONAL | VERIFIED_FINAL | CLOSED -> CONTRADICTED
```

`CLOSED` is a revocable projection. Contradictory evidence appends `CLOSURE_REOPENED`; history is never deleted.

## Causal Context Envelope

The envelope includes the required tenant, project, state, Genesis, revision, Work, Change, obligations, Gallery bindings, actor/delegation, environment, base state, authority, risk, TTL, nonce, digest, lease and event sequence fields. Identity fields are immutable across delegation. Each mutating hop obtains a derived single-use envelope; read-only validation does not consume the nonce.

Core reuses existing signing and anti-replay infrastructure. No new secret or custom cryptography is introduced.

The v1 field contract is: `schema_version` string constant; `tenant_id`, `actor_id`, `actor_role`, `environment`, `lease_id` bounded strings; `project_id`, `genesis_intent_id`, `intent_revision_id`, `work_id`, `change_id` UUID; `project_state_digest`, `base_state_digest`, `context_digest` lowercase SHA-256 hex; `obligation_ids` UUID array; `gallery_ticket_ids` bounded string array; `delegated_from` nullable object containing parent actor/context digests; `authority_scope` sorted bounded string array; `risk_budget` object with level and numeric limits; `issued_at`/`expires_at` RFC3339 UTC instants; `single_use_nonce` opaque random identifier whose digest alone is persisted; and `event_ledger_sequence` positive integer. The canonical context digest covers every field except `context_digest` itself and transport signature material, using `causal_canonical_json_v1`.

Issue validates a current state digest, active revision, Work/Change/Obligation binding, lease, authority, environment and branch contract. Consume repeats every validation under the state lock and compares actor provenance with the authenticated transport identity, closing the TOCTOU window. Boundary rules are explicit: `issued_at <= database_now < expires_at`; equality with `expires_at` is expired. Child contexts may narrow authority, TTL, risk and obligations but may not change identity or inherited constraints.

Structured failures include `CAUSAL_CONTEXT_REQUIRED`, `CONTEXT_EXPIRED`, `CONTEXT_REPLAYED`, `CONTEXT_DIGEST_MISMATCH`, `CAUSAL_IDENTITY_MISMATCH`, `STALE_PROJECT_STATE`, `AUTHORITY_SCOPE_VIOLATION`, `OBLIGATION_REQUIRED`, `LEASE_INVALID` and `ENVIRONMENT_MISMATCH`.

## Branch contract

The common registry and dispatcher add the causal fields once. All 72 registered branches must be covered by generated defaults, with stricter explicit policies for privileged branches. Branch output returns the same Project/Revision/Work/Change identity, input state digest, output digest, evidence and residual risk. Identity mutation, authority expansion, lost constraints and cross-tenant artifacts are absolute blocks.

Every Branch Registry row adds: `requires_causal_context` boolean; `can_propose_intent_revision`, `can_approve_intent_revision`, `can_create_change`, `can_execute_change`, `can_produce_evidence`, `can_reconcile_outcome`, `can_close_obligation` booleans; `minimum_assurance_level` enum `CAL-0..CAL-4`; `allowed_environments` sorted string array; `required_observers` sorted observer-role array; `inherited_constraints` sorted string array; and `context_schema_version` string. The Branch Contract digest covers all these fields plus branch ID/version. The dispatcher output digest covers returned identity, decision/proposal, evidence references, residual risks and obligation state.

## Reality Closure

An obligation binds claim, owners, expected/forbidden effects, evidence contract, CAL, horizons, rollback and residual obligations. Core selects minimum CAL from risk. High-risk closure requires independent evidence; an executor's statement alone is CAL-0 and cannot close.

Observations preserve provenance, independence, baseline, freshness, evidence digest, causal relation, confidence and contradiction. Reconciliation compares intent, prediction, action, baseline, outcome, alternatives, side effects and residual obligations. The Outcome Receipt is an append-only causal chain, not a health response.

Closure is a Core-owned transition. The evidence contract declares required sources, minimum independence, freshness, CAL, horizons, falsification conditions and forbidden-effect observers. `VERIFIED_FINAL` requires every required horizon to mature successfully. A later valid contradiction atomically appends `CLOSURE_REOPENED`, invalidates the current receipt projection and moves the obligation to `CONTRADICTED`; the historical receipt remains immutable.

Reality Observation v1 fields are UUID identity/bindings, `source` and `observer_identity` bounded strings, `provenance` object, `independence` enum, `baseline` JSON object, `freshness_seconds` non-negative integer, database `observed_at`, SHA-256 `evidence_digest`, `causal_relation` enum, confidence number in `[0,1]`, `contradiction_status` enum and observation digest. Its digest excludes ingestion time but covers the observed timestamp and all evidentiary fields.

Causal Reconciliation v1 binds the same tenant/project/revision/Work/Change/Obligation, sorted observation IDs/digests, intent/prediction/action/baseline/result JSON, alternative causes, side effects, forbidden effects, residual risks, open obligation IDs, verdict enum, achieved CAL and reconciliation digest. Outcome Receipt v1 contains the immutable IDs/digests for human intent, revision, obligation, prediction, authorization, action, observations, reconciliation, residual risks, temporal checks, closure state, ledger sequence and receipt digest. Both use canonical JSON v1 and exclude projection timestamps.

The Causal Continuity Capsule v1 fields are `project_identity`, `project_scope`, `current_project_state_digest`, `genesis_intent`, `active_intent_revision`, `decision_path`, `active_work`, `open_changes`, `completed_changes`, `open_obligations`, `closed_obligations`, `gallery_bindings`, `artifacts`, `latest_verified_state`, `known_conflicts`, `blocker`, `residual_risks`, `next_safe_action`, `forbidden_actions`, `pending_temporal_checks`, `capsule_version`, `capsule_digest` and `generated_from_event_sequence`. IDs/digests are typed as above; collections are deterministically sorted and bounded. The capsule digest covers every field except itself and generation timestamp.

## Versioned API and event contract

Universal Core exposes `/v1/causal/*`; Core MCP publishes equivalent capability IDs without caller-selected routes. Mutations obtain tenant identity from authentication and never accept it as authority from the payload.

| Aggregate | Read capabilities | Mutating capabilities |
| --- | --- | --- |
| Project/state | `project_identity_resolve`, `project_scope_read`, `project_state_verify`, `project_timeline_read` | `project_identity_create`, `project_scope_bind`, `project_state_snapshot` |
| Intent/decision | `genesis_intent_read`, `intent_revision_impact`, `project_decision_path_read` | `genesis_intent_create`, `intent_revision_propose`, `intent_revision_approve` |
| Work/change | `change_read` | `work_bind_intent`, `change_create` |
| Context | `causal_context_validate` | `causal_context_issue` and atomic consume on governed action |
| Reality | `causal_obligation_read` | `causal_obligation_create`, `causal_observation_record`, `causal_reconcile`, `causal_close`, `causal_reopen` |
| Continuity/Gallery | `continuity_capsule_resume`, `project_timeline_read`, `gallery_binding_verify` | `continuity_capsule_build` and Core-to-Gallery outbox projection |

`continuity_capsule_build` is mutating: under the Project state lock it builds from bounded authoritative projections, persists the immutable capsule/digest, appends `CONTINUITY_CAPSULE_BUILT` and enqueues projection in one transaction. `continuity_capsule_resume` is read-only: it verifies digest, event sequence, current state and drift, returning the continuity brief or `REBASE_REQUIRED`; it does not alter Work state. A later explicit rebase is a separate governed transition.

Required events are `PROJECT_REGISTERED`, `PROJECT_SCOPE_CHANGED`, `PROJECT_STATE_SNAPSHOTTED`, `GENESIS_INTENT_CREATED`, `INTENT_REVISION_PROPOSED`, `INTENT_REVISION_APPROVED`, `INTENT_REVISION_REJECTED`, `WORK_OPENED`, `WORK_REBASED`, `CHANGE_OPENED`, `CHANGE_EXECUTED`, `OBLIGATION_CREATED`, `CONTEXT_ISSUED`, `CONTEXT_CONSUMED`, `ACTION_AUTHORIZED`, `ACTION_EXECUTED`, `GALLERY_ITEM_BOUND`, `EVIDENCE_RECORDED`, `OUTCOME_RECONCILED`, `CONTINUITY_CAPSULE_BUILT`, `CLOSURE_PROVISIONAL`, `CLOSURE_FINAL`, `CLOSURE_REOPENED`, `REMEDIATION_STARTED`, `ROLLBACK_EXECUTED` and `WORK_CLOSED`. Every event contains schema version, tenant, project, operation, sequence, IDs relevant to the transition, actor provenance, request/idempotency digest, canonical payload digest, previous hash, event hash and database timestamp. `ACTION_EXECUTED` is never synthesized from CI, deploy or health evidence; those are separately typed observations.

## Nyra, Gallery and common branch payloads

Nyra returns a typed semantic proposal containing classification, confidence, considered alternatives, invariants, forbidden effects, affected Work and required owner authority. It cannot write an approved revision or a closure verdict.

Gallery bindings contain Core event sequence and context digest. A readback mismatch or missing Core row quarantines the item as `ORPHAN_GALLERY_ITEM`; it cannot authorize work. Resume views are generated from bounded Core projections plus the latest capsule, not by scanning the entire ledger.

Gallery entity binding v1 contains `tenant_id`, Project UUID, state digest, Genesis/Revision/Work UUIDs, nullable Change UUID, obligation UUID array, entity/ticket type enum, ticket ID, nullable parent ticket ID, Core event sequence, context digest, provenance object, status enum, first/last verified database timestamps and binding digest. Supported entity types are `PROJECT_GENESIS`, `INTENT_REVISION`, `ARCHITECTURE_DECISION`, `WORK`, `CHANGE`, `BLOCKER`, `CONFLICT`, `EVIDENCE`, `VERIFICATION`, `REMEDIATION`, `ROLLBACK`, `OUTCOME`, `CLOSURE` and `REOPENING`. Incremental views are Project Timeline, Intent Evolution, Decision History, Work Graph, Change Timeline, Obligation Dashboard, Evidence, Closure/Reopening and Resume.

The branch dispatcher accepts `{causal_context, branch_contract, input_digest, expected_output, required_evidence, forbidden_effects}` and returns the unchanged causal IDs, output digest, proposal/decision, evidence references, residual risks and obligation state. Registry defaults are generated for every branch and fail closed when `requires_causal_context` is true.

## Genesis-bound presence recovery

Genesis continuity does not grant commit, publish, host-action or deployment authority. During a healthy control-plane period, Core may instead issue a single-use Causal Context whose only authority is `agent:presence:recover`. The envelope is bound to the exact tenant, Project, Genesis Intent, approved Intent Revision, Work, Change, actor provenance and environment; its lifetime cannot exceed ten minutes.

Core MCP accepts that envelope only on the sessionless `agent_heartbeat` bootstrap surface and only after Universal Core validates and consumes it. Required inherited constraints are `presence_only`, `no_host_action`, `no_publish` and `no_deploy`. Recovery cannot set a custom display name or capabilities, cannot carry Gallery/action tickets, and cannot add any other authority scope. A successful recovery registers presence only; every later commit, push, merge or deployment still requires the ordinary Core verdict, action ticket, audit and rollback path.

## Required metrics

Counters/histograms cover registered projects, Work with complete lineage, open Changes, issued/rejected envelopes, stale states, blocked replays, blocked cross-tenant attempts, orphan Gallery items, intent drift, Work requiring rebase, open/verified obligations, reopened closures, evidence mismatches, resume latency, context-validation latency, errors by component, migration outcomes and reconciliation verdicts. Labels are bounded to environment/component/reason/mode; IDs and tenant values are not metric labels.

## Planned Change aliases

Core will generate authoritative Change UUIDs after the new registry is live. Until then these are aliases only:

1. Project Identity Spine
2. Project Scope Manifest and Project State Digest
3. Genesis Intent and Intent Lineage
4. Decision Records and Intent Drift Detection
5. Work/Change/Obligation Graph
6. Causal Context Envelope
7. Core MCP Context Propagation
8. Gallery Graph Binding
9. Causal Continuity Capsule
10. Branch Registry Contract
11. Reality Closure and Evidence Contract
12. Outcome Receipt and Temporal Reopening
13. Database Migration and Legacy Compatibility
14. Observability, Metrics and Release

## Release plan

1. Add schema/runtime behind tenant-scoped `SHADOW`.
2. Run unit, contract, PostgreSQL 16, concurrency, fuzz, security, E2E and benchmark suites.
3. Independent verifier reviews the exact diff and evidence.
4. Core release manifest and Work closure evaluation must allow the exact head.
5. Push and open one draft PR through authenticated git plus GitHub Connected App.
6. Require `core-mcp`, `deployment-parity` and `universal-core` checks.
7. Verify staging where current infrastructure is compatible; do not infer parity from legacy staging health.
8. Merge and let existing `checksPass` Render services deploy.
9. Verify exact live commits and a governed benign E2E with controlled contradiction/reopening.
10. Promote `ENFORCE_NEW_WORK` only after positive production evidence. Keep a temporal obligation open until its configured horizon matures.

## Open baseline incidents

- `8fc99f5f...`: first native plan used non-policy check labels; corrected with exact job names and independently verified by Core event 14.
- `85e5775d...`: DTT plan rejected because verifier allowlist was insufficient; bind and attest a distinct verifier, then retry.
