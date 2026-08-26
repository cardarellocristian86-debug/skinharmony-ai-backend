# ADR: Entity 360 context/evidence layer v1

Status: accepted for implementation in the candidate branch. Release and live
activation remain gated by an exact bounded Universal Core ticket, the host
approvals required for each external action, independent verification and live
readback.

Canonical Work: `Entità 360`, Work Identity
`91e82640-9edc-5424-a3e8-eb7853b0d8dd`.

This ADR describes repository state only. It does not attest a commit, push,
PR, merge, deployment, migration application or live health result.

## Context

Nyra needs a bounded, temporal and evidence-backed view of an entity before it
reasons. The relevant material remains owned by Genesis, Intent, ICF, NSCT,
Architecture Map, Impact Map, Event Ledger, Work Continuity, Shared Memory,
Security Intelligence and runtime providers. Copying or replacing those
systems would split authority and make provenance, relevance or confidence
look like permission.

The context path is exposed to ambiguous identity, cross-tenant leakage,
memory/retrieval poisoning, stale or contradictory evidence, source
concentration, semantic domination and flooding. A highly ranked source must
not monopolize the context and a high provenance score must not be treated as
truth.

## Decision

Entity 360 is a general-purpose, domain-neutral, tenant-scoped context/evidence
layer inside Universal Core and before Nyra reasoning. It resolves one entity,
discovers source material through versioned adapters, bounds contributions,
reconciles time, qualifies provenance/trust, evaluates corroboration and
completeness, and persists an immutable snapshot.

The separation is invariant:

```text
Context -> Reasoning -> Authority -> Execution -> Evidence
```

- Entity 360 constructs and qualifies context.
- Nyra performs reasoning and emits a preliminary proposal.
- Universal Core remains the independent final authority.
- Execution requires a separate bounded authorization.
- Evidence/Event Ledger close the loop and can feed a later snapshot without
  rewriting an older one.

Entity 360 cannot issue an execution, merge, deploy, publish or mutation ticket.
All v1 results carry `execution_authorized=false` and no production decision
mutation.

The target sequence is:

```text
Request / Intent
  -> Entity Resolution
  -> Source Discovery
  -> Bounded Context Assembly
  -> Temporal Reconciliation
  -> Provenance and Trust Validation
  -> Cross-Source Corroboration
  -> Conflict and Completeness Evaluation
  -> Entity 360 Snapshot
  -> Nyra Reasoning and Impact Analysis
  -> Preliminary Proposal
  -> Universal Core Independent Verification
  -> ALLOW / HOLD / BLOCK / INSUFFICIENT_CONTEXT
  -> separately authorized bounded execution, if any
  -> Evidence / Event Ledger
  -> next Entity 360 snapshot
```

## V1 mode and shadow comparison

The runtime accepts only `OFF` and `SHADOW`. `SHADOW` may assemble snapshots
and comparison receipts, but the current path remains authoritative and its
response is returned unchanged. An unknown mode fails closed. There is no v1
enforcement transition.

Universal Core automatically observes an eligible, canonical Work-bound
`/v1/work/preflight` result. The server derives the current-path outcome from
the trusted preflight state, binds it to exactly one Tenant Work Gallery Work,
signs the observation, assembles the corresponding snapshot and persists a
signed comparison. That receipt is release-grade only for
`SHADOW_EVALUATION_ONLY`; it is never enforcement or authorization evidence.
The observer is asynchronous and failures are audited without altering the
preflight response, Core verdict, global readiness or execution state.

The public `entity_360_shadow_compare` remains a diagnostic path. Its legacy
digest/outcome are caller observations, so the receipt is explicitly
`UNVERIFIED_CALLER_OBSERVATION`, `release_evidence_eligible=false`, and cannot
increase release-grade Core HOLD/INSUFFICIENT_CONTEXT correlation.

## Ontology and domain-neutral kernel

Each snapshot binds versioned contracts:

- `entity_360_snapshot_v1`;
- `entity_360_ontology_v1`;
- `entity_360_context_policy_v1`;
- `entity_360_kernel_v1`;
- `entity_360_canonical_json_v1`;
- SHA-256 semantic and envelope digests.

The first projections are `work_360` and `software_component_360`. Entity
types, relationships, states, transitions, dependency classes, policy
bindings, evidence/source classes, trust boundaries and temporal semantics are
declarative. Future Agent, Customer, Case, Order, Machine/Asset or other
verticals extend the ontology and adapter registry without changing the kernel
while the compatibility contract remains additive.

Historical policy and ontology definitions are tenant-scoped and append-only.
A historical verification loads the exact version and digest bound by the
snapshot; it does not reinterpret old data with the current definition.

## Identity and Work binding

Resolution is deterministic and fail-closed. Multiple compatible candidates
produce `AMBIGUOUS` and only `HOLD`; no candidate with
`require_existing=true` produces `UNRESOLVED` and only
`INSUFFICIENT_CONTEXT`/`HOLD`. Neither path persists a pseudo-entity.

Tenant Work Gallery is the canonical Work identity owner. A request may use the
canonical Work UUID or its exact registered legacy Work UUID; no alias,
semantic match or continuity-only row may create a candidate. MCP issues a DTT
agent context bound to the exact requested UUID. Universal Core verifies that
same tenant/Work/principal binding and the runtime then proves that the UUID is
either the resolved canonical Work or its exact legacy binding.

Project namespaces remain distinct:

- Gallery and Work Continuity `project_id` are logical project slugs and are
  compared only with each other;
- Work Continuity `project_uuid` and the Genesis/Intent causal graph project
  UUID are checked only against each other.

A slug divergence emits `WORK_PROJECT_LINKAGE_CONFLICT` and leaves
`project_work_linkage.project_id=null`. A UUID divergence emits
`WORK_PROJECT_UUID_BINDING_MISMATCH` and withholds the authoritative causal
binding. A slug is never compared with or coerced into a UUID.

## Source qualification

Only server-discovered contributions enter assembly. Caller-supplied sources,
evidence, confidence, completeness, snapshot version or authority material are
rejected. Resolution and discovery run in one tenant-bound, `as_of`-bounded
PostgreSQL `REPEATABLE READ READ ONLY` transaction. Optional source schema
queries use a savepoint; only missing table/column errors become
`SOURCE_SCHEMA_UNAVAILABLE`, while other database faults abort the cut.

Each policy source contract binds source ID, adapter-version allowlist,
fact-prefix allowlist, validity/revocation, source/trust class and independence
group. Source-specific verification is required before an authoritative
contribution is emitted:

- Intent anchor and causal Genesis/Intent revision digests are recomputed in
  their owning canonical domains and must match the exact append-only
  `WORK_OPENED/work_bind_intent` event, predecessor and actor provenance hash;
- ICF requires an exact recomputed event digest equal to the versioned ledger
  head; a synthetic digest fallback is forbidden;
- Architecture Map and Event Ledger hashes are recomputed from their bounded
  records;
- Security Intelligence uses the Project Scope observation digest, evidence
  digest, canonical writer provenance and source freshness boundary; only
  independently authenticated observations are admitted, while `EXECUTOR`
  self-reports quarantine the bounded source batch;
- Software/Component Atlas requires `verification_state=verified`, revision
  history at `as_of`, exact node digest and context-byte binding; it never
  fabricates evidence from an invalid node digest.

Invalid or missing proof becomes a machine-readable missing/rejected/stale gap,
not an inferred fact. NSCT v1 is owner-verified, temporally bounded, minimized,
derived and advisory; multiple plan heads remain an explicit set/conflict and
never become authority. Shared Memory and runtime state remain declared but not
wired in the v1 PostgreSQL adapter; Universal Core is excluded from
self-corroboration.

## Bounded occupancy, time and completeness

Occupancy is versioned policy data, not a universal percentage. The policy can
budget source/entity/evidence count, relationship depth, retrieval bytes,
context tokens, and contribution/evidence/byte/token volume per source, source
class and trust class. Admission is deterministic and mandatory facts are
prioritized by the required-context policy rather than by a source's
self-declared criticality. Limited/rejected contributions retain bounded reason
codes but no rejected raw `fact.value`.

Corroboration counts independent non-derived lineages. Policy may require a
quorum or one verified authoritative source for a fact. Provenance, trust and
confidence alone never satisfy truth or authority. High-impact requirements are
necessarily mandatory and their quorum/authoritative alternative counts only
policy-allowlisted trust classes; `advisory` is compile-time forbidden. A gap
records observed versus eligible lineage counts and excluded trust classes,
then produces `INSUFFICIENT_CONTEXT`/`HOLD`.

Claims are anchored to `as_of` and classified `current`, `historical`,
`superseded`, `stale` or `conflicting`. Invalid supersession, cycles,
cross-fact low-trust supersession, or a future/stale/expired superseder and
concurrent current values remain explicit contradictions. Old or stale
evidence is never promoted over current state.

The completeness evaluator returns `completeness`, `confidence`,
`missing_context[]`, `stale_sources[]`, `contradictions[]`,
`corroboration_gaps[]` and `authoritative_sources_missing[]`. These qualify
context only. Missing mandatory/high-impact context constrains the Core review
envelope to `INSUFFICIENT_CONTEXT`/`HOLD`; Nyra must not silently invent it.

## Qualification attestation and verifier boundary

The snapshot persists a compact `entity_360_qualification_manifest_v1` with
fact/evidence digests and admission decisions, not full raw source payloads.
During the trusted consistent-cut assembly, Universal Core signs an exact
qualification payload with the HMAC-SHA-256 host-native signing domain rooted in
`CORE_HOST_NATIVE_SIGNING_SECRET` and purpose
`entity360-qualified-context-v1`. The payload binds tenant, entity, canonical
identity, snapshot chain, time, policy/ontology, adapter registry, consistent
cut, manifest, source discovery, project/Work linkage and semantic digest.
The v2 attestation also binds the exact host-native `key_id`. New writes use
only the active key; a bounded verify-only retained keyring preserves old
snapshot verification through governed rotation. Unknown key ids fail closed.

The PostgreSQL store receives a verify-only capability: it must expose
`verify`, must not expose `sign`, and rejects a missing, wrong-purpose,
replayed, tampered or invalid attestation. The verifier also enforces exact
schemas and recomputes deterministic derivations and digests from the persisted
compact material.

This is not an evidence-independent oracle: the store does not re-query every
source and cannot recover raw values deliberately omitted from the compact
snapshot. The keyed attestation proves that the manifest and derived snapshot
were bound to the trusted server-side adapter cut. It does not turn provenance,
completeness or the HMAC into truth, authority or an action ticket. Universal
Core must still independently apply every authority and execution gate.

The same host-native domain signs shadow artifacts with distinct purposes:

- `entity360-current-path-observation-v1`;
- `entity360-shadow-comparison-v1`.

Purpose separation prevents a qualification, observation or comparison
signature from being replayed in another domain.

## Persistence and configuration

The additive migration creates tenant-scoped registry, feature-flag, entity
head, snapshot, shadow receipt, idempotency and backfill tables. Definitions,
snapshots, receipts, idempotency and backfill events are append-only, including
`TRUNCATE` guards. Heads and flags use exact revision CAS. Snapshot version 1
has no predecessor; later versions bind the exact current semantic digest.
Snapshot verification uses trusted database persistence time rather than a
caller timestamp.

Migration readiness is an exact PostgreSQL catalog contract, not a table-name
probe. The verifier compares columns/defaults/nullability, constraints,
same-schema foreign-key targets, indexes, trigger definitions and same-schema
trigger functions with a transaction-local reference schema built from the
canonical migration SQL. Public verification additionally requires the
registry row to be exactly `COMPLETED`/`READBACK_VERIFIED`; nonterminal states
fail closed.

Exact caller-request replay is checked before definition registration,
resolution or discovery. An exact replay returns the original persisted
version/envelope; reuse with a different request digest conflicts.

`CORE_ENTITY360_MODE` is the process ceiling. The tenant `entity360` flag can
only be `OFF`/disabled or `SHADOW`/enabled and a SHADOW row pins the server's
compiled `policy_digest`. The Core route
`/v1/entity-360/admin/feature-flag` is the only v1 write surface: it requires an
independently authenticated `universal_core_operator` with the exact
`entity360:feature-flag:write` scope, server-binds flag ID/policy digest and uses
CAS/idempotency. It is deliberately absent from MCP and DTT never grants this
configuration authority.
An absent or OFF tenant row gates public resolution and the automatic observer
before source discovery, so the kill switch performs zero adapter reads and
zero shadow writes.

## Consequences and release gates

- Context assembly becomes more explainable and may expose additional HOLD or
  INSUFFICIENT_CONTEXT recommendations in shadow.
- Raw owner data is not duplicated unnecessarily; reconstructability is bounded
  by owner retention and evidence references.
- Qualification and shadow signatures make secret custody, rotation and
  purpose separation release-critical.
- `CORE_ENTITY360_MODE=SHADOW` in source configuration is not deployment proof.
- PostgreSQL 16 migration, CAS, append-only and trusted-time behavior must pass
  the isolated CI gate.
- Shared Memory and runtime state adapter gaps remain explicit. NSCT remains an
  advisory-only integration and fails closed when its owner verification path is
  unavailable.
- Commit, push, PR, merge, deploy, publish and rollback remain prohibited
  without the exact bounded Universal Core ticket and every host approval.
- A release is not complete without exact live commit, migration/readiness,
  automatic shadow observation, health and rollback readback.
