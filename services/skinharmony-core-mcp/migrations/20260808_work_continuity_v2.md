# 20260808 Work Continuity V2

Migration id: `20260808_work_continuity_v2_runtime`.

The production migration is the idempotent PostgreSQL statement exported as
`ADDITIVE_SCHEMA_SQL` by `src/work-continuity-v2-store.js`. Startup applies it
through the existing primary pool and records the migration in
`core_schema_migrations`. It contains only `CREATE ... IF NOT EXISTS`,
`ALTER ... ADD COLUMN IF NOT EXISTS`, indexes, and the migration-ledger insert.

There are no drops, deletes, legacy status rewrites, automatic closures, or
historical backfills. Legacy rows are projected only on an explicit,
owner-authorized V2 read/create path.
