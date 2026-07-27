# MCP staging canonical bootstrap

This package implements the local, fail-closed protocol for the one-time
bootstrap of the eight canonical `SHARED_MEMORY` documents into a new staging
collaboration database.

It is deliberately not wired into an HTTP server or runtime startup. A caller
must provide:

1. a reviewed, redacted bundle containing exactly the eight canonical paths;
2. the exact bootstrap executor, control role, target
   service/database/environment/commit binding;
3. an opaque Core+Nyra approval artifact;
4. a verifier that converts that artifact into the exact public verified
   evidence contract; and
5. the PostgreSQL consumer created by this package.

The verifier receives only the expected bundle digest and target binding, not
the document contents. Before approval, the protocol parses the four canonical
JSON documents and enforces the same tenant, collection-count, and active-count
invariants used by the MCP shared-memory bootstrap. The PostgreSQL consumer:

- takes a transaction-scoped advisory lock;
- verifies the exact staging database name and requires both `current_user` and
  `session_user` to be the isolated `mcp_staging_gate_control` role;
- rejects a replay or any non-empty `codexai` data plane;
- creates the three required folders and eight documents;
- appends a redacted coordination audit event; and
- appends a unique one-time consumption record.

All writes commit together. A failure rolls back every write. The consumption
record stores only hashes and public target metadata. It never stores the
approval artifact, document contents, credentials, URLs, or keys.

`canonicalBootstrapControlSchemaSql()` is migration SQL for the control-plane
role. It revokes public access and intentionally grants no runtime role. The
integration must install it through the governed database migration and must
keep the runtime MCP role unable to call this package directly.

## Integration status

The exported control SQL is part of collaboration migration v3. The private
staging importer obtains an exact Core gate, a Nyra attestation, and a Core
grant, verifies both Ed25519 authorities, and consumes both receipt rows in the
same serializable PostgreSQL transaction as the eight-document import.

The command is intentionally available only over Render-native SSH with bounded
JSON on stdin. It has no HTTP route, writes no local bundle, and returns only a
sanitized result. A successful consumption permanently closes the write path
for the same bootstrap identity, and a non-empty tenant data plane closes it for
any different identity.

Live activation still requires the separately governed sequence:

1. validate the exact reviewed commit and provider resource identities;
2. obtain explicit owner confirmation for the exact recurring cost;
3. create the managed `mcp_collaboration_runtime` credential provider-natively;
4. let the initial control-plane service apply and verify migration v3;
5. sync the final Blueprint so `fromDatabase.connectionString` resolves to the
   new default runtime credential;
6. stream the reviewed canonical bundle directly to the private importer; and
7. verify the MCP staging health and bounded first-session canary.

No canonical local files are copied by this package. Bundle creation is an
explicit offline step and rejects common credential material before a digest is
computed.
