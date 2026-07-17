# Nyra / Core — Governed Agent Program

Status date: 2026-07-17. Automatic activation is introduced only as a bounded, auditable dry-run before any model provider or external action is enabled.

## Non-negotiable controls

- [x] Core remains the final policy and authorization authority.
- [x] Nyra is a supervisor/planner, never an unrestricted executor.
- [x] Branch depth, worker fan-out, cancellation propagation, durable recovery, tool allowlists and tenant isolation are covered by the existing generic-agent runtime.
- [x] A model call is fail-closed until a run has an explicit model budget.
- [x] Learning is frozen for performance and automation evaluation runs.
- [x] Any external action, publishing, deployment, credential use, or live mutation requires a separate owner-confirmed Core decision.

## Phase A — registry and safe activation

- [x] Define a catalog of four non-overlapping roles: Nyra supervisor, research scout, evidence critic, governance watchdog.
- [x] Restrict each role to explicit trigger types and capabilities.
- [x] Require idempotency keys for event and scheduled activations.
- [x] Expose the catalog through an authenticated API.
- [x] Create only a frozen, zero-budget dry-run run from an activation.
- [x] Test idempotency, forbidden role/trigger combinations, no model spend, and tenant isolation.
- [ ] Merge and deploy only after CI and owner approval.

## Phase B — governed research workflow

- [x] Persist activation records and idempotent schedule keys with optimistic concurrency.
- [x] Let Nyra propose a bounded research → critic → supervisor plan in dry-run.
- [ ] Require source provenance, freshness window, prompt-injection quarantine, and contradiction reporting.
- [ ] Apply per-tenant daily run, worker, tool, token, and deadline budgets.
- [ ] Add cancellation, timeout and retry telemetry at each handoff.
- [ ] Add complex multi-agent evaluation fixtures with deterministic frozen learning.

## Phase C — execution adapters

- [ ] Introduce a provider adapter interface; no provider is implicit.
- [ ] Keep the default adapter disabled and zero-cost.
- [ ] Require a server-side credential reference and an explicit Core-approved model budget before a provider call.
- [ ] Keep ChatGPT/Codex subscription-assisted work separate from server-side API workers.
- [ ] Add circuit breakers, quota alarms and provider error classification.

## Phase D — production operations

- [ ] Schedule only approved activation rules; prohibit self-trigger loops.
- [ ] Add a dashboard for activation state, queue delay, context-build latency, tool/model spend, branch depth, cancellations and zombie-branch detection.
- [ ] Add build SHA and release version to health/readiness output for Render verification.
- [ ] Define SLOs and alert thresholds; rehearse kill-switch and recovery.
- [ ] Run staged load tests before increasing worker or token limits.

## Release gates for every phase

- [ ] Focused new tests pass.
- [ ] Full unit/API suite passes or existing failures are explicitly isolated and tracked.
- [ ] CI is green for the exact PR commit.
- [ ] PR is reviewed and owner authorizes merge of that exact PR.
- [ ] Render deployment is triggered from the merged commit and health is verified.
