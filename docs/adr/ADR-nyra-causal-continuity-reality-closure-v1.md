# ADR: Nyra Causal Continuity and Reality Closure v1

Status: Accepted for implementation, subject to Core gates and independent verification.

## Context

The existing Governed Continuity Fabric already provides durable Work identity, immutable Work intent, hash-chained Work events, Gallery participation/leases, native-agent receipts, Core Join, exact GitHub/Render readback and rollback evidence. It does not provide a stable Project Aggregate, project-scoped intent lineage, Change/Obligation identity, a general causal context or temporal reality closure.

Authority is fragmented: Core MCP owns operational Work/Gallery PostgreSQL state, Universal Core owns policy and release tickets with part of its state in a local atomic file, and Nyra maintains a separate replay ledger. A new independent registry inside MCP or Gallery would deepen the split.

## Decision

Universal Core becomes the sole authority for new causal transitions on the PostgreSQL database already shared with Core MCP. Core MCP is the authenticated adapter and Gallery projection. Nyra proposes semantic interpretations but cannot approve strategic changes or closure. The existing Work runtime remains backward compatible and receives nullable causal bindings instead of being copied.

The new aggregate uses Core-generated UUIDs for Project, Genesis Intent, Intent Revision, Change, Obligation, observations, reconciliation and receipts. Legacy readable project values are aliases only. No automatic historical causal mapping is permitted.

Closure is split into execution, observation, provisional verification, final verification and revocable closure. Contradictory or delayed evidence reopens the obligation automatically.

## Alternatives considered

### Extend only Work Continuity in Core MCP

Rejected because Universal Core would remain unable to enforce the authoritative state it is expected to judge, and Gallery/MCP would continue to be both register and projection.

### Make Gallery the source of truth

Rejected because operational availability and ticket UX must not control policy truth; temporary Gallery failure must not lose causal state.

### Reuse `tenant_work` as the new aggregate

Rejected because a separate operational Work model already exists. Promoting it would create a third competing Work identity and reinterpret legacy data.

### Replace all existing continuity tables

Rejected as destructive, rollout-incompatible and causally dishonest. Existing Work, timestamps and evidence must remain unchanged.

### Event-only store without projections

Rejected because resume and validation must be bounded on lightweight infrastructure. Incremental projections and indexed snapshots are required.

## Consequences

- Universal Core must initialize additive migrations against the shared DB with an advisory migration lock.
- MCP action paths must call Core to issue/validate/consume context and then update projections idempotently.
- Existing Work IDs remain stable; new causal binding is nullable for legacy Work.
- GitHub/CI/Render metadata binds to Change and Obligation IDs, not to branch identity.
- Gallery downtime does not block Core recording; an outbox retries projection safely.
- All new code is feature-flagged `SHADOW`, `ENFORCE_NEW_WORK` or `ENFORCE_ALL_COMPATIBLE`.
- The Nyra policy proof key-material gap remains outside this ADR and cannot be fixed by code or secret access in this mission.

## Invariants

- `EXECUTED != VERIFIED != CLOSED`.
- No lease or action authorization for enforced new Work without an obligation.
- No high-risk self-attestation, replay, cross-tenant evidence or silent authority expansion.
- No mutation of Genesis Intent or historical revisions.
- Purpose change requires a new Project ID with `derived_from`.
- No final closure while temporal checks remain unsatisfied.

## Validation

The ADR is satisfied only when migrations, APIs, MCP propagation, Nyra semantics, Gallery projection, Branch Registry coverage, tests, exact live deploy readback, a production E2E and an independently verified Outcome Receipt all exist.
