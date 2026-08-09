# Work Continuity V2 - Implementation and Release Report

Date: 2026-08-08

Status: implementation verified locally; production release pending normal Core and owner gates.

## Scope

This change integrates Work Continuity V2 into the existing Core MCP and Universal Core runtimes without replacing the legacy continuity fabric. It adds generic non-Git closure, server-derived progress and priority, authoritative ACL views, durable Open Work Review, stale-work dry-run reconciliation, logical Report Archive, an ambiguity-safe resolver, and a signed Generic Core Join.

Genesis Bootstrap Authority, Nyra Self Model, Capability Graph, DTT Autopilot, and high-throughput scenario APIs are deliberately excluded. They remain blocked until this release is live and its governed production lifecycle has completed.

## Source of truth and baseline

- Repository: `cardarellocristian86-debug/skinharmony-ai-backend`
- Branch: `feat/work-continuity-v2-completion-20260808`
- Baseline: `50086f81bc4f69ae726434c6f5184a755fc143a6`
- Runtime services: `services/skinharmony-core-mcp` and `services/universal-core-service`
- Database target: PostgreSQL 16 or later

## Work Identity V2

The additive identity layer preserves the immutable legacy `work_id` and projects legacy work without inventing closure, ownership, or status. New identities support tenant-scoped human codes, names, types, owner/creator/assignment/supervision/team/agent relations, visibility, server timestamps, status, parent/successor/supersession, priority, progress, intent digest, and closure evidence.

Canonical statuses are `PLANNED`, `ACTIVE`, `PAUSED`, `BLOCKED`, `HANDOFF`, `COMPLETED`, `CANCELLED`, `SUPERSEDED`, and `ARCHIVED`. Closed states remain persisted and audit-searchable but are hidden from the operational Gallery by default.

## PostgreSQL changes

The migration `services/skinharmony-core-mcp/migrations/20260808_work_continuity_v2.sql` is additive and idempotent. It creates or extends V2 identity, relations, task/evidence, event, Open Work Review, final report, and archive state while retaining the existing V1 work and event records.

The runtime schema and migration contract are tested for parity and repeated application. Creation coordinates Open Review consumption, legacy V1 creation, V2 identity, tasks, events, and linking in one caller-owned transaction. Failure injection verifies full rollback after every phase and deterministic retry.

Universal Core adds durable Generic Core Join tables and append-only ledger state. Tenant-bound verifier nonce uniqueness, idempotency uniqueness, and transaction advisory locking provide restart-safe replay denial.

## ACL and tenant isolation

Authorization is derived from verified server-side membership, never caller-provided role claims.

- My Gallery: owner, assigned, explicitly shared, or otherwise authorized work.
- Team Gallery: authorized manager scope only.
- Tenant Gallery: tenant owner scope.
- Super Admin: explicit verified authority only.
- Shared or tenant visibility grants read access only; mutation and closure require narrower roles.
- Core Conflict Index can return an anonymous conflict signal for inaccessible work without leaking title, owner, content, count, or evidence.
- Cross-tenant access, cross-user unauthorized reads, role escalation, and caller-supplied tenant identity fail closed.

## Progress and priority

Progress is server-derived, deterministic, versioned, and bounded to `0..10000` basis points. Task, verification, and closure components produce the overall value from persisted task/evidence/gate state. Callers cannot declare completion. `overall_progress_bp = 10000` does not close a work; explicit Generic Core Join and closure remain mandatory.

Priority uses `P0` through `P4` plus a versioned server-derived numeric score. Caller-provided priority context is ignored. Inputs are bounded persisted signals such as severity, urgency, dependencies, impact, stale duration, near-closure state, owner priority, duplication risk, and cost of delay.

## Open Work Review and resolver

Mandatory Open Work Review runs only for an actual create operation, not for a new chat or resume. Significant duplicate, overlap, stale, P0/P1, dependency, or incompatible-lease findings require an explicit owner/admin decision bound to tenant, subject, request digest, review digest, expiry, and one-time consumption.

The resolver scores authorized candidates using project, work code/name, Intent Anchor, semantic similarity, status, recency, relations, next action, and priority. Git branch metadata is optional. Comparable candidates produce an ambiguity response instead of automatic resume.

## Generic closure and Report Archive

Supported adapters are `software_git`, `software_non_git`, `deployment`, `research`, `document`, `commercial_crm`, `hardware`, and `generic`. The selected adapter must match the persisted work type.

Closure requires acceptance criteria, completed required tasks, persisted evidence, a completed independent native verifier binding, and a valid Universal Core Generic Join verdict. The verdict is Ed25519-signed, tenant/work/adapter/evidence/idempotency-bound, durable, and non-host-authorizing. Core MCP verifies the pinned key, key ID, signature algorithm, canonical digest, and signed payload before persisting the immutable receipt.

Successful explicit closure sets `COMPLETED`, persists `closed_at` and `final_evidence_digest`, generates the authoritative server-side final report, emits closure events, and moves the work logically to Report Archive. There is no hard delete and no automatic closure of historical work.

## Stale reconciliation

Reconciliation is dry-run only and classifies work as `ACTIVE_VALID`, `BLOCKED_VALID`, `STALE`, `SUPERSEDED`, `COMPLETED_BUT_UNCLOSED`, `ABANDONED`, or `UNKNOWN`. It considers effective lease/participant expiry, heartbeat, successors, objective/evidence, and closure state. It never rewrites status or fabricates closure evidence.

## V1/V2 to V0 hierarchy

The existing fail-closed hierarchy is preserved. V1/V2 parity mismatch, high uncertainty, evidence gaps, contradictions, and high-impact decisions escalate to V0 final authority. V1/V2 remain digest/prefilter paths and cannot replace V0 where escalation criteria apply.

## Capability surface

Core MCP registers V2 create/read/gallery/Open Review/task/evidence/stale reconciliation/Generic Join/closure-evaluate/closure-finalize capabilities while retaining every legacy continuity capability. Preflight uses the V2 operational Gallery through a legacy-compatible shape.

Universal Core exposes the canonical Generic Work Core Join endpoint and a compatibility alias through the same awaited durable issuance path. Readiness reports initialization state, durable backend, signing algorithm, key ID, public-key fingerprint, and custody class without exposing private material.

## Production configuration required

Universal Core requires a protected Ed25519 signing key and key identifier:

- `CORE_GENERIC_WORK_CORE_JOIN_ED25519_PRIVATE_KEY`
- `CORE_GENERIC_WORK_CORE_JOIN_ED25519_KEY_ID`

Core MCP requires only matching verifier material:

- `GENERIC_WORK_CORE_JOIN_ED25519_PUBLIC_KEY`
- `GENERIC_WORK_CORE_JOIN_ED25519_KEY_ID`

The private key must remain outside agent-readable configuration and must never be stored in the repository. Production database bindings must point both services to the governed PostgreSQL fabric. Missing durability or key material leaves Generic Join non-ready and fail-closed.

This key is normal Generic Work Core Join authority. It is not the future Bootstrap/Recovery Genesis root.

## Verification evidence

- Core MCP full suite on PostgreSQL 16.14: 366 tests, 366 passed, 0 failed, 0 skipped.
- Universal Core full suite with localhost and PostgreSQL access: 544 tests, 541 passed, 0 failed, 3 optional unrelated skips.
- Universal Core smoke: passed.
- Generic Core Join targeted: 8 passed, 0 failed.
- Generic Core Join PostgreSQL 16 integration: 1 passed, 0 failed.
- Cross-service Generic Join endpoint/bridge/V2 persistence: passed.
- Migration idempotency and runtime parity: passed.
- Transaction rollback and deterministic retry: passed.
- Independent verifier verdict: `ALLOW`.
- Patch whitespace validation: passed.

The three Universal Core skips are pre-existing optional integrations: two Policy Registry PostgreSQL tests without their dedicated URL and one optional PostgreSQL Research Airlock race test.

## Production acceptance sequence

1. Pass required GitHub checks and normal Core release gate.
2. Provision matching signing/verifier material through the infrastructure secret boundary.
3. Merge without force and use normal auto-deploy only.
4. Verify exact live commit and service health for Core MCP and Universal Core.
5. Verify PostgreSQL migration and Generic Join readiness.
6. Execute Nyra native plan, builder bind/report, independent verifier bind/report, evidence, and Core Join.
7. Execute a generic non-Git lifecycle through explicit closure and Report Archive.
8. Verify replay denial, cross-tenant denial, cross-user ACL, lease/participant expiry, resolver ambiguity, and archive visibility.
9. Persist Work checkpoint, final evidence, final report, and closure only after every gate succeeds.

## Known production anomaly

The previously observed current Work identifier `7e07ba3a-907d-49fa-b445-a46ae1023bd3` later returned `continuity_work_not_found` from the production continuity read path for tenant `codexai`. No replacement Work was created and no production record was changed. This indicates a production connector/runtime binding or catalog consistency issue that must be reconciled during post-deploy verification. The release must not fabricate a Work, successor, checkpoint, or closure to hide this discrepancy.

## Residual risks

- Production signing material and database bindings have not yet been provisioned or verified.
- Production migration and native-agent end-to-end behavior remain unproven until auto-deploy.
- The current Work identity discrepancy may prevent checkpoint/closure and must fail closed.
- Legacy data without explicit V2 ownership remains conservatively projected and may require owner-governed migration decisions.
- Genesis Bootstrap Authority and Self-Aware Nyra are not part of this release.

## Rollback

1. Roll back services to the prior verified image/commit through the normal Render/Core remediation path.
2. Disable V2 capability exposure while retaining legacy continuity capabilities.
3. Keep all additive tables and columns; do not drop or delete historical data.
4. Revoke or rotate the Generic Join signing key if compromise is suspected; keep previous verifier metadata for audit.
5. Mark incomplete post-deploy work as blocked and preserve ledger/evidence.
6. Do not convert a bootstrap exception, progress value, or deployment readback into a Core Join.

Rollback never rewrites existing event history, closes work automatically, or removes final reports.
