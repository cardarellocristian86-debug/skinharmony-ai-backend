# 20260808 Work Continuity V2

Migration ids: `20260808_work_continuity_v2_runtime` and the additive upgrade
checkpoint `20260825_work_bootstrap_request_v1`.

The production migration is the idempotent PostgreSQL statement exported as
`ADDITIVE_SCHEMA_SQL` by `src/work-continuity-v2-store.js`. Startup applies it
through the existing primary pool and records the migration in
`core_schema_migrations`. It contains only `CREATE ... IF NOT EXISTS`,
`ALTER ... ADD COLUMN IF NOT EXISTS`, indexes, and the migration-ledger insert.

There are no drops, deletes, legacy status rewrites, or automatic closures.
The upgrade performs one narrow, non-destructive backfill of unambiguous
open-review request bindings into `tenant_work_bootstrap_request`. A historical
request with conflicting digests or more than one consumed Work is deliberately
left unmapped and fails closed for operator review. Legacy Work rows themselves
are projected only on an explicit, owner-authorized V2 read/create path.
