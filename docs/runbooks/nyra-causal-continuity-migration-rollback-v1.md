# Runbook: causal continuity migration, rollout and rollback

## Preconditions

- Exact baseline `main` and live service commits are read back.
- Work `52cf629b-ec5d-4a5b-ab84-08eb35afd8ea` is resumed with the immutable intent digest.
- Required checks are `core-mcp`, `deployment-parity`, `universal-core`.
- Independent verifier is bound and Core allows the implementation/release step.
- No secret, DNS, billing or destructive database operation is included.

## Additive migration

1. Acquire a PostgreSQL advisory migration lock.
2. Create `core_schema_migrations` and verify the migration digest/idempotency record.
3. Create project, scope, state, intent and decision tables.
4. Create Change, Obligation, evidence, context and nonce tables.
5. Create observation, reconciliation, temporal, receipt and causal ledger tables.
6. Create Gallery binding/projection outbox, capsule, conflict, feature-flag and legacy-resolution tables.
7. Add nullable `project_uuid` to `core_continuity_works`; do not rewrite `project_id`.
8. Add composite tenant FKs, unique idempotency constraints, indexes and append-only triggers.
9. Read back schema objects and migration digest in the same environment.
10. Leave all existing legacy Works unbound unless evidence proves the mapping.

The online legacy-binding sequence is exact: add `core_continuity_works.project_uuid UUID NULL` without a default; create `CREATE INDEX CONCURRENTLY IF NOT EXISTS core_continuity_works_tenant_project_uuid_idx ON core_continuity_works (tenant_id, project_uuid) WHERE project_uuid IS NOT NULL` outside the DDL transaction and record its checkpoint; add `FOREIGN KEY (tenant_id, project_uuid) REFERENCES core_projects (tenant_id, project_id) NOT VALID`; validate the constraint in a later bounded step; read back column nullability/type, index validity/predicate and FK columns/actions from `pg_catalog`; never backfill an ambiguous row. Application versions before and after the migration accept null.

Each step is restart-safe. `core_schema_migrations` stores migration ID, SQL digest, application state, start/completion timestamps and verifier evidence. DDL uses `IF NOT EXISTS` only where the existing object definition is subsequently read back and compared to the expected catalog. One pinned database session takes a session-level advisory lock before the first checkpoint and holds it across DDL transactions and every `CREATE INDEX CONCURRENTLY` phase; disconnect releases it automatically. Concurrent application instances either observe the verified completed digest or wait; a differing digest fails readiness.

Before accepting the index checkpoint, the lock-owning session reads `pg_class`, `pg_index` and `pg_get_indexdef`. If the migration-owned name exists with the exact expected table, columns and predicate but `indisvalid=false`, and no dependency references it, recovery runs `DROP INDEX CONCURRENTLY core_continuity_works_tenant_project_uuid_idx` and recreates it concurrently before readback. A differing definition or uncertain ownership fails closed for operator review and is never dropped. The migration never advances merely because `IF NOT EXISTS` returned successfully.

PostgreSQL 16 and 18 test runs inspect constraints and indexes from the catalog, restart during backfill, rerun from every checkpoint, and prove that no duplicate project, event, nonce or outbox item appears. Backfills are keyset-paginated and bounded; there is no full-table lock or unbounded transaction.

## Rollout

### SHADOW

- Emit IDs, lineage, contexts and comparison metrics without blocking legacy Work.
- Project Gallery from Core while comparing existing reads.
- Run deterministic snapshot, ledger and resume benchmarks.

### ENFORCE_NEW_WORK

- Enable only for the owner tenant after staging/production verification.
- Require Project/Revision/Change/Obligation/context for newly governed Work.
- Bind this mission Work using verified alias/repository/commit evidence.

### ENFORCE_ALL_COMPATIBLE

- Promote only surfaces with unambiguous bindings and complete tests.
- Keep ambiguous legacy rows unresolved.

## Application rollback

1. Record `CONTRADICTED` or `HARMFUL`; stop promotion.
2. Switch the tenant feature flag back to `SHADOW` or disabled.
3. Use the existing Core-governed release ticket for an append-only application rollback to the last verified commit; never force-update.
4. Verify exact rollback commit on every affected service, health/readiness and the original critical path.
5. Append `ROLLBACK_EXECUTED`; keep the original obligation open.
6. Create a child remediation Change under the same Work and repeat the full pipeline.

## Schema rollback

The normal rollback preserves additive tables and events. A down migration may disable new triggers/routes and remove only constraints that prevent the previous application from running. It must not drop production data, delete ledger history or fabricate old bindings. Destructive table removal is not authorized.

Rollback readback verifies feature mode, exact application commit, schema compatibility, worker quiescence and legacy endpoint behavior. If an additive table contains authoritative rows, rollback is application/flag-only and the schema stays dormant. A down migration may remove only unused empty objects and must refuse once authoritative causal rows exist.

## Staging caveat

The project staging trio (Universal Core `srv-d9l37i3l550s73fgr0sg`, Core MCP
`srv-d9l37ir7uimc738ffpr0`, Nyra `srv-d9qfeqk9v7es73esvsqg`) currently runs
exact commit `80b28a23c4f95af3ee9e4447af80c32beea7d5a2` from
`feature/nyra-defensive-hardening-v1-1`; its MCP health still reports legacy
`0.8.0`. The attached staging database is PostgreSQL 18
(`dpg-d9cdeie1a83c73ca5l10-a`). This does not provide current production
host-native parity. A green staging health response is insufficient. Release
verification must deploy the exact candidate commit to all three existing
staging services, record each deploy ID and rollback target, and state which
contracts were exercised or remained production-only.

## Re-deploy loop

For a correctable code, test, schema, concurrency, integration, CI or deploy error:

1. append an incident event;
2. classify and find the root cause;
3. update the existing Change or create a child remediation Change;
4. apply the minimum complete correction;
5. rerun targeted then full suites;
6. update ADR/docs if architecture changed;
7. commit/push/readback;
8. wait for exact CI and deploy readback;
9. repeat without closing the Work.

Transient infrastructure retries are bounded and do not create code commits.
