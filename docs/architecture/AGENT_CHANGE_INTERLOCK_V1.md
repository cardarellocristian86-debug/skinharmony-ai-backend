# Agent Change Interlock V1

## Purpose

Agent Change Interlock (ACI) prevents uncoordinated, incompatible changes by humans or AI agents in the same authenticated tenant. It is an additive coordination layer: it does not replace Universal Core, Tenant Work Gallery, leases, the decision ledger, or Work Continuity.

The protocol is adapter-neutral. GitHub and Render are examples only; it also applies to database objects, business records, documents and approved external resources.

## Authority model

```text
worker or human -> Change Intent -> Gallery conflict projection -> Nyra advisory plan
                                                        -> Universal Core revalidation -> adapter receipt
```

- The authenticated server supplies `tenant_id`; callers cannot switch it.
- Nyra explains conflicts, dependency order and handoff. It cannot issue a lease, set `execution_allowed`, emit `ALLOW`, or execute an adapter action.
- A plan is advisory. A fresh Universal Core decision, durable CAS lease, drift check and one-shot execution receipt are required immediately before an external mutation.

## Data and persistence

`change_intent_v1` is immutable and bound to `tenant_id`, `work_id`, canonical assets, operation class, evidence/rollback digests and a `scope_digest`. A physical asset collision wins even when work or project IDs differ. The Gallery remains the single durable source of truth.

Planned PostgreSQL projections, all tenant-scoped and append-only/versioned:

- `core_continuity_change_intents`
- `core_continuity_interlocks`
- `core_continuity_interlock_edges`
- `core_continuity_interlock_receipts`

They reuse Gallery events, idempotency, Postgres CAS, leases, checkpoint capsules and decision ledger. No parallel database, file lock or raw-chat store is permitted for active mode.

## Conflict rules

Assets use canonical `adapter:kind:reference` keys. Unknown, ambiguous or credential-bearing references fail closed. The server—not an LLM—compares exact and parent/child assets.

Plans may be `parallel_safe`, `exclusive_lease_required`, `ordered_handoff_required`, `new_decision_required`, or `manual_review`. Every plan has `execution_allowed=false`.

Any material change to tenant, adapter, environment, asset set, operation, expected effect, evidence or rollback creates a new intent and decision. It cannot patch a prior approval.

## Gallery checklist

1. Search/resume an existing work before creating one.
2. Register a redacted immutable Change Intent.
3. Canonicalize assets and calculate overlap server-side.
4. Acquire or wait for a durable, bounded lease.
5. Publish a structured Gallery blocker, decision or handoff capsule.
6. Revalidate tenant, intent digest, lease, current state and Core decision immediately before an external action.
7. Consume one atomic execution receipt; persist outcome or reconciliation-needed state.
8. Checkpoint the result, release the lease idempotently and retain the append-only audit trail.

## Security invariants

- Cross-tenant reads, writes and conflict inference fail closed.
- Same idempotency key with a different payload is rejected.
- Leases and execution receipts are one-shot, time-bounded, durable and atomically consumed.
- No prompt, credential, authenticated URL, raw evidence or raw chat is stored. Only redacted metadata and digests/references may persist.
- Restart, provider timeout or stale lease results in reconciliation; never automatic duplicate execution.

## Delivery phases

1. **This branch:** pure canonical contract, Nyra advisory subbranch, architecture/checklist and unit tests. It is not an active enforcement path and cannot validate a lease, consume a receipt or authorize an adapter.
2. **Durable Gallery MVP:** PostgreSQL projections, dynamic capabilities and Gallery blocker/read model.
3. **Adapter enforcement:** Core revalidation and one-shot receipts for approved adapters, then race/restart tests.

No phase changes production behavior without a distinct Core and owner authorization.

## Nyra catalog depth

Nyra may catalogue up to 60 subbranches per branch. This expands the taxonomy,
not execution: runtime routing remains bounded, advisory and subject to Core
validation. A large catalog can never cause a large parallel agent fan-out.
