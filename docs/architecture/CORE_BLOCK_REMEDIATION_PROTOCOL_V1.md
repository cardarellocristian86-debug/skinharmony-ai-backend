# Core Block Remediation Protocol V1

`core_block_remediation_v1` mediates a non-ALLOW Universal Core decision without
changing Core authority. The final decision contract remains immutable. Nyra
explains and reviews; a connected worker may diagnose and propose; Universal
Core evaluates every resubmission through the normal action evaluator.

## Runtime flow

1. `core_gate_action` receives a final non-ALLOW decision.
2. The interceptor classifies the exact block code and creates one tenant-scoped
   remediation contract for the original decision.
3. A deterministic Nyra explanation exposes only the permitted continuation
   scope. In `shadow` mode this is observational and preserves the legacy path.
4. In `active` mode a worker may submit a bounded proposal. The store enforces
   idempotency, optimistic concurrency, tenant identity, scope binding, attempt
   limits, expiry, redaction and the remediation state machine.
5. Nyra may return `approve_for_core`, `request_revision` or `reject`; it cannot
   create an ALLOW verdict.
6. Approved proposals are resubmitted to Universal Core with immutable decision,
   proposal, review and scope digests. Only the new Core decision can allow work.
7. The decision ledger and shared remediation store retain the linked decisions,
   attempts, reviews, outcome and Gallery blocker state.

## Block classes

- `correctable`: bounded diagnosis and same-action remediation are possible.
- `confirmation_required`: analysis and request-bound owner confirmation only.
- `absolute`: the original action stays denied; only a safe alternative may
  start a new decision contract.
- `transient`: bounded retries with current lease, identity and policy checks.
- `manual_review`: unknown codes fail closed.

## Dynamic capabilities

The existing MCP catalog exposes `core_block_remediation_status`,
`core_block_remediation_explain`, `core_block_remediation_propose`,
`core_block_remediation_review`, `core_block_remediation_resubmit` and
`core_block_remediation_cancel`. Existing clients continue to receive
`allowed=false`; remediation data is an additive response field.

## Persistence and rollback

The service reuses the tenant-scoped shared-memory root and the append-only
decision ledger. Records remain readable after restart. Set
`CORE_BLOCK_REMEDIATION_MODE=disabled` to restore legacy behavior without
deleting remediation or ledger history. The code default is `shadow`.
