# Nyra/Core Intent Router v1

## Purpose and trust boundary

The router classifies natural-language clauses deterministically before any conversational orchestration. Classification is evidence, never authority: it cannot confirm owner intent, invoke a capability, create a ticket, or authorize execution. Authenticated tenant identity and the current session fingerprint scope its telemetry digest; raw prompts and secrets are never recorded.

The server routes each turn through one of three bounded paths:

- `CORE_CATALOG_READ`: an exact slash command or catalog question reads the existing identity-filtered dynamic capability catalog. Natural aliases remain ranked proposals only. Invocation requires a fresh catalog revision, normal authorization/preflight, owner confirmation where required, and a fresh idempotency key.
- `CORE_CONTEXT_THEN_NYRA`: chat, analysis, exact resume, Work creation, and one explicit consequential action use the existing authenticated Work context path. Fresh turns perform exactly one Work preflight and one Core/Nyra interpretation; exact resume may reuse the already verified persisted Work context.
- `CORE_HOLD_THEN_NYRA`: quoted, hypothetical, conditional, or multiple affirmative actions require clarification. The route creates no ticket candidate and never opens a continuation.

No route accepts caller-provided preflight, Intent/ICF/Entity360/Ramy context, owner authority, or execution claims. The original server-issued `work_preflight` envelope is forwarded to Core unchanged.

## Clause artifact

Each bounded clause records polarity, modality, condition and quote scope, all mentioned action candidates, affirmative action candidates, imperative/diagnostic state, and Work-create candidacy. One positive action with explicit negative non-effects remains one action (for example, commit without push). `authorize deploy` is one semantic authorization request. Diagnostics with no positive imperative are advisory; a diagnostic followed by a separate affirmative action, multiple positive actions, quoted actions, and conditional actions hold for clarification.

## Context references

Intent continuity may be represented only by the verified preflight/persisted Work digest already emitted by the runtime. ICF and Entity360 remain unavailable in this response until their existing authoritative runtimes expose tenant/work-bound, digest-verified adapters. Ramy is hard-coded `unavailable_no_verified_adapter`; caller content cannot make it available. Past variants are bounded to eight references when a verified adapter exists.

## Catalog and telemetry budgets

Catalog reads reuse `core_capability_catalog`; the router validates schema, tenant, revision continuity, pagination, unique capability IDs, access mode/read-only consistency, and a maximum of 24 visible commands over three pages. The response never claims identity filtering from caller input—the claim follows from direct execution of the authorized handler with the authenticated identity.

Telemetry contains only the tenant/session-scoped input digest, route, intent, preflight flag, counts, and bounded elapsed milliseconds. It records no prompt, model reasoning, memory body, secret, or capability arguments.

## Failure and rollout

Catalog validation, stale revision, Core outage, cross-tenant binding, caller authority injection, and ambiguity fail closed. Catalog errors return `UNAVAILABLE` with no fallback invocation. Consequential Core errors create no external write. Release requires governed CI, a canary conversation matrix, exact-commit health/schema readback, and negative verification of HOLD and catalog-only paths. Rollback is a single revert of the router integration; existing `nyra_converse`, dynamic catalog, preflight, continuation, and Core gates remain authoritative.

Two confirmed performance gaps are intentionally separate changes:

1. Work-choice pagination currently loads the complete tenant catalog before slicing. Preferred Variant A is an ACL-aware SQL keyset page (`LIMIT 9`) with an opaque tenant/project/sort-revision cursor and minimal columns. Variant B is an ACL-aware offset query with a database `LIMIT`; Variant C is a strict server-side catalog ceiling that fails closed before unbounded materialization. Rollback is a feature flag to the current read.
2. Fresh converse currently obtains one preflight plus one Core bridge while the bridge can recompute memory context. Preferred Variant A is a tenant/request/memory-revision/gallery-revision-bound preflight receipt that Core reuses and reloads only when stale; Variant B is a request-scoped cache. Required tests cover one context-provider call, stale/altered/expired/cross-tenant receipts, and parallel calls.

After schema deploys, health and tools-list should expose catalog revision and schema digest. A stale client must receive an explicit `catalog_revision_stale`, reconnect with a new session, and never fall back to an older descriptor.
