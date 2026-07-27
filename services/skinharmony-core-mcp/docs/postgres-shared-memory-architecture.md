# PostgreSQL shared-memory architecture

Status: local implementation and verification only. This document does not authorize Git, Render, a deploy, or a remote database change.

## Goal

ChatGPT, Codex, and bounded worker agents use one tenant-scoped MCP API and one PostgreSQL source of truth. The local `SHARED_MEMORY` directory remains a projection, audit handoff, and controlled import/export source; it is not a second writable authority once cloud coordination is activated.

```text
ChatGPT / Codex / workers
          |
          | authenticated MCP call + server-signed agent presence
          v
 skinharmony-core-mcp-staging
          |
          | exact action binding
          +----> Nyra staging issuer: advisory veto, Ed25519
          |                |
          +----> Core staging issuer: final grant, Ed25519
          |                |
          | dual receipt verified before SQL
          v
 skinharmony-mcp-staging-db
   |-- canonical documents and immutable versions
   |-- hierarchical lock leases and fencing tokens
   |-- agents, tasks, messages, checkpoints, handoffs
   |-- append-only decision and coordination ledgers
   `-- control schema: atomic receipt replay ledger
```

## Trust and isolation boundaries

1. `MCP_COLLABORATION_DATABASE_URL` is the only runtime database reference accepted for collaboration. `DATABASE_URL` cannot enable, replace, or fall back for this state.
2. The collaboration database is hard-pinned to tenant `codexai`, service `skinharmony-core-mcp-staging`, environment `staging`, and an exact 40-character build commit.
3. Core and Nyra use distinct Ed25519 trust anchors, private Render host references, and distinct bearer tokens. A shared key, shared endpoint, public hostname, redirect, or incomplete configuration fails startup.
4. Every signed action binds audience, tenant, service, environment, build commit, actor hash, signed agent/session identity, ledger trace, preflight, task contract, coordination lock, canonical memory checksum, tool, action, target, payload digest, optimistic version, lock/fence, and idempotency-key digest.
5. Nyra signs `no_objection` first. Core then binds its final grant to both the exact Core decision digest and the exact Nyra envelope digest. Issuer clocks, not the MCP client, mint validity timestamps.
6. The runtime verifies both signatures before opening the mutation path. PostgreSQL consumes both authorities through one `SECURITY DEFINER` function in the same transaction as the write.
7. Generic service secrets, Auth0, production credentials, and unrelated database references are never inputs to this flow.

The cryptographic trust boundary is explicit: Ed25519 verification happens in the trusted MCP runtime. The database function independently enforces the pinned tenant and issuer order, database-time validity, atomic two-row consumption, and replay protection, but it does not itself verify Ed25519 signatures. Raw runtime database access is therefore privileged infrastructure access and must never be exposed to AI clients. Moving cryptographic enforcement behind the database boundary would require a separate transaction-owning broker or a reviewed database-side signature verifier.

## PostgreSQL control plane

The runtime never creates or repairs its schema. A separate migration reference and control-plane role must:

- apply one checksum-bound migration under a database advisory lock;
- own the migration marker, receipt schema, receipt table, and receipt function;
- provision a distinct `LOGIN NOINHERIT` runtime role without superuser, role creation, database creation, replication, bypass-RLS, or memberships;
- revoke legacy privileges before granting only enumerated `SELECT`, `INSERT`, and required `UPDATE` rights;
- deny runtime `DELETE`, `TRUNCATE`, `TRIGGER`, `REFERENCES`, schema creation, and direct receipt-table DML;
- expose only execution of the receipt consumer function;
- enable and force a single `codexai` row-level-security policy on every tenant table;
- make the decision metrics view security-invoker so it cannot bypass RLS.

The current DDL requires PostgreSQL 15 or newer because it relies on `security_invoker` views. Runtime connections pin `search_path` to `pg_catalog,public,pg_temp`; readiness verifies that setting, rejects non-owner `CREATE` grants on the guarded schemas, and rejects any runtime privilege carrying a grant option.

At startup and on every health probe, the service rechecks migration version/checksum, exact runtime and session user, required relations, receipt-table columns and primary key, trigger state/function, receipt function owner/security/search path, ACLs, RLS, view security, and receipt execution privileges. Drift makes `/healthz` return 503.

## Mutation transaction

Every receipted coordination mutation follows this order:

```text
BEGIN
  -> tenant advisory lock
  -> tenant+jti advisory lock inside receipt consumer
  -> database-time TTL and scope validation
  -> insert exactly two issuer rows or RAISE
  -> idempotency reservation / lease and fence checks
  -> tenant-scoped mutation
  -> append-only audit
  -> idempotency completion
COMMIT
```

Any conflict, expiry, replay, partial receipt pair, stale version, stale fence, or SQL error rolls back receipt consumption and the mutation together. Deterministic conflicts are returned as non-retryable 409 responses; invalid authorization evidence is non-retryable; only bounded outages and throttling are retryable.

The decision ledger also inserts the work session and its first hash-chained event in one transaction, preventing orphan `started` sessions.

## Coordination semantics

- Documents use optimistic versions and immutable content-version rows.
- Equal, parent, and child paths conflict. Reacquisition always advances a monotonic fencing token.
- Idempotency keys are bound to canonical request digests; reuse with different input fails.
- Agent presence is server-signed and bound to the authenticated actor and logical session.
- Tasks use optimistic versions plus leased claims and fencing.
- Messages, checkpoints, memories, and handoffs are durable and tenant-scoped.
- Direct handoffs are readable only by a matching durable non-expired presence.
- Events and decision records are append-only and store redacted metadata, never credentials, authorization headers, or chain-of-thought.
- PostgreSQL failure never falls back to local files.

## Readiness

Readiness is true only when all three conditions are true:

1. the complete PostgreSQL schema/role/ACL/RLS gate passes at probe time;
2. both public trust anchors are loaded and independent;
3. both private issuer health endpoints are reachable and explicitly report durable replay protection plus collaboration-receipt readiness.

Configured-but-unreachable issuers are therefore visible as unavailable, not healthy.

## Activation status

As of 2026-07-23, the local implementation includes:

- checksum-bound collaboration migration v3, including the canonical bootstrap
  control schema;
- independent Core and Nyra Ed25519 issuers, private JWK discovery, exact
  build-commit binding, and durable nonce replay protection;
- atomic dual-receipt consumption in the same transaction as every governed
  write;
- the one-time, provider-native canonical import command with bounded stdin and
  no HTTP or filesystem transfer path;
- progressive first-session enrollment followed by strict task/lock-bound
  coordination; and
- fail-closed health checks for PostgreSQL, both issuers, trust pins, roles,
  ACLs, RLS, schema checksum, and receipt readiness.

The local unit and contract suites are green. A real PostgreSQL integration test
has not run on this workstation because no dedicated loopback test database is
available. The initial staging control-plane phase is therefore also the first
real-PostgreSQL proof: it must verify database identity, an empty collaboration
data plane, migration v3, both roles, ACL/RLS and runtime least privilege before
the final Blueprint is allowed to sync.

The live release remains closed until all of these operational gates succeed:

- exact owner confirmation of the recurring cost;
- read-only reconciliation of the intended Render project/environment,
  existing staging database, region, availability and absence of schema drift;
- provider-native creation of `mcp_collaboration_runtime`, which becomes the
  database default credential without exposing its value;
- successful initial Blueprint adoption and control-plane health;
- final Blueprint sync, followed by the canonical import and a bounded staging
  canary; and
- a separate explicit gate before restart-based persistence testing.

All Render services deliberately omit `rootDir`: the bootstrap and issuer
entrypoints import reviewed modules from sibling service directories, and
Render excludes files outside a configured root directory from both build and
runtime. Build and start commands instead use repository-root
`npm --prefix services/...` paths.

## Test commands

- `npm test` runs the normal local suite.
- `npm run test:postgres` requires only `MCP_COLLABORATION_TEST_DATABASE_URL`, accepts only a literal loopback host and a database name delimited with `test`, and never falls back to runtime or generic database variables.
- `npm run migrate:collaboration` requires only the separate control-plane migration reference and does not print it.

## Rollout gates

1. Complete pure local tests and the gated real-PostgreSQL bootstrap proof.
2. Review and freeze the exact application and dependency commits.
3. Approve the provider-native opaque role/reference transfer and one-time canonical bootstrap separately.
4. Apply the migration through the staging control plane.
5. Attach only the collaboration database, two public anchors, two private issuer references/tokens, exact build identity, and runtime-role name to the MCP staging service.
6. Deploy and test only `skinharmony-core-mcp-staging`.
7. Request another explicit gate for restart/persistence verification.

## Explicit exclusions

- No production, Auth0, merge, deletion, cross-tenant access, or reuse of an existing database.
- No secret value in source, logs, test output, reports, Git, or shared-memory projections.
- No persistent-disk filesystem as the cloud source of truth.
- No automatic Render changes from this local implementation.
