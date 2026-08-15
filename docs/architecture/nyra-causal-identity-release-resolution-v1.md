# Nyra causal identity and release resolution v1

Status: Phase A implementation contract, frozen before MCP integration.

## Architecture and reuse map

Universal Core remains authoritative. `causalContinuityStore.js` supplies the
tenant/project transaction, project advisory lock, idempotency key, hash-chained
event ledger and projection outbox. `causalContinuityRuntime.js` already owns
Project, Genesis Intent, append-only Intent Revision, Work and Change bindings.
The new `causalIdentityReleaseResolution.js` adds only the missing release
authority boundary; it does not create another project or intent registry.

The Project identity spine is:

`tenant -> stable project UUID -> deterministic state digest -> immutable genesis -> append-only revision graph -> work -> change -> release resolution event`.

`project_identity_spine_read` reconstructs this bounded spine and returns a
deterministic `spine_digest`. A `PURPOSE_CHANGE` remains unapprovable in place.
A derived Project can be created only with owner authority and an exact
same-tenant proposed purpose-change revision on the parent Project.

## Server-owned release resolution

The caller supplies only `causal_release_tuple_lookup_v1`: exact Project state,
Genesis, revision, Work, Change and a positive pull-request number. Universal
Core re-derives Genesis/revision from its stores and passes an immutable lookup
to a resolver constructed by `createServerOwnedReleaseTupleResolver`. Runtime
accepts only resolver functions held in the module-private trusted registry.

The observer supplies GitHub, Project Scope, Render/Core health and receipt
readbacks. Universal Core validates exact causal bindings, independent/fresh
provenance, source/target/rollback commit coherence, strict HTTPS service
origins, complete service coverage and deterministic digests. No caller tuple
field is forwarded or used as fallback.

The result is persisted in `core_release_tuple_resolutions` and committed by
`RELEASE_TUPLE_RESOLVED` in the existing ledger/outbox transaction. Records are
append-only; reads are bounded by tenant/project/work/change/phase and event
sequence.

## Structured failures

Important fail-closed outcomes include `RELEASE_RESOLVER_UNAVAILABLE`,
`RELEASE_CAUSAL_BINDING_MISMATCH`, `STALE_PROJECT_STATE`, `RELEASE_PARTIAL`,
`RELEASE_OBSERVATION_UNVERIFIED`, `RELEASE_OBSERVATION_STALE`,
`RELEASE_ROLLBACK_MISMATCH`, `RELEASE_TUPLE_DIGEST_MISMATCH` and
`RELEASE_TUPLE_CONFLICT`.

The frozen machine-readable Phase A contract is
`docs/architecture/nyra-causal-identity-release-resolution-v1.contract.json`.
