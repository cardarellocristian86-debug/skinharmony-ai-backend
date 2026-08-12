# Migration and rollback: causal identity release resolution v1

Apply after the base causal migration. The additive migration creates
`core_release_tuple_resolutions`, its exact bounded read index and append-only
guard under a dedicated advisory lock, then verifies table, five composite
tenant foreign keys, ordinary trigger enablement, exact index and migration SQL
digest.

Rollback order is release resolution, Project Scope auxiliary indexes, then the
base causal schema. The down migration removes only objects owned by this
migration and deletes its migration registry row so apply-after-down is safe.
Application rollback can disable the new resolver/capabilities without deleting
records. Never backfill ambiguous release or intent history.
