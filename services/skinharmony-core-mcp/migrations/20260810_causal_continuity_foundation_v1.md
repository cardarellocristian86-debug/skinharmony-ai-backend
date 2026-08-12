# 20260810 Causal Continuity foundation v1

Migration id: `20260810_causal_continuity_foundation_v1`.

The migration adds tenant-scoped Project, explicit Genesis Intent, Intent
Revision, Operation, append-only Causal Record, idempotency, transactional
outbox, and a reserved projection-cursor table. Every relationship that crosses a table
uses the tenant plus the domain identifier, so a foreign-tenant object cannot
be bound by identifier alone.

No legacy work is backfilled or assigned inferred causality. Existing Work
Continuity V1/V2 contracts and tables are unchanged. Lifecycle columns reserve
the distinct states `DECLARED`, `EXECUTED`, `VERIFIED`, `CLOSED`, and `REOPENED`,
but this first slice exposes only declaration operations; later slices must add
their own independently verified transition contracts.

Cursor advancement is not operational in this slice. The store advertises
`projection_cursor_advance: false`; a later slice must add a guarded monotonic
compare-and-update contract before a projection consumer may use the table.

Rollback is a code revert. The additive nullable data and tables remain in
place for audit and safe forward recovery; the rollback does not drop tables,
delete records, or rewrite history.
