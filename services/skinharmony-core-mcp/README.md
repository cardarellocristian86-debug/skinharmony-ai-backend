# SkinHarmony Core MCP

Remote MCP endpoint compatible with existing scoped Codex bearer tokens and ChatGPT OAuth 2.1 clients backed by Auth0. Authentication never accepts an owner-confirmation field and never derives tenant access from client input.

## Authentication

- Codex: `Authorization: Bearer <key>` from `CODEX_BEARER_KEYS`; scopes come only from trusted server configuration.
- ChatGPT: Auth0 RS256 access token verified against JWKS, exact issuer, audience, expiry and optional `nbf`.
- OAuth discovery: `/.well-known/oauth-protected-resource` and the RFC 9728 path-specific `/.well-known/oauth-protected-resource/mcp` advertise the protected resource. The compatibility authorization-server endpoint advertises authorization-code flow with PKCE `S256` only.
- MCP tools expose OAuth `securitySchemes`, minimum per-tool scopes, titles, descriptions and read-only/idempotent impact annotations. Preconfigured Codex bearer tokens remain supported at the transport layer without advertising an unsupported tool-level scheme.

Required configuration:

```text
MCP_PUBLIC_URL=https://mcp.example.com
AUTH0_ISSUER=https://YOUR_TENANT.auth0.com
AUTH0_AUDIENCE=https://mcp.example.com/mcp
CODEX_BEARER_KEYS=<comma-separated secrets>
CODEX_BEARER_SCOPES=core:read,core:govern
MCP_SUPPORTED_SCOPES=core:read,core:govern,workspace:read,workspace:write,task:read,task:write,agent:coordinate
UNIVERSAL_CORE_URL=https://your-universal-core.example.com
UNIVERSAL_CORE_KEY=<server-side scoped Core key>
UNIVERSAL_CORE_KEYS_JSON={"tenant-a":"server-side-key-a","tenant-b":"server-side-key-b"}
MCP_CHATGPT_TENANT_ID=tenant-a
CORE_MCP_KEY=<server-side scoped Core key for MCP_CHATGPT_TENANT_ID>
MCP_DEFAULT_TENANT_ID=owner-private
MCP_TENANT_CLAIM=https://skinharmony.it/tenant_id
SHARED_WORK_MEMORY_ROOT=/app/shared-work-memory
AGENT_WORKSPACE_ROOT=/var/data/skinharmony-core-mcp
MEMORY_FABRIC_ROOT=/var/data/skinharmony-core-mcp
MEMORY_RETENTION_DAYS=365
MEMORY_PERSONAL_RETENTION_DAYS=90
```

`CORE_BASE_URL` is also accepted as a compatibility fallback when
`UNIVERSAL_CORE_URL` is not set.

Configure the Auth0 application as a public OAuth client for ChatGPT, allow only approved callback URLs, enable authorization code with PKCE, and disable password/implicit grants. Do not commit secrets. Auth0 must issue RS256 access tokens containing `scope` or `permissions`.

## Local verification

```bash
npm test --prefix services/skinharmony-core-mcp
MCP_PUBLIC_URL=http://localhost:8790 CODEX_BEARER_KEYS=local-test-key npm start --prefix services/skinharmony-core-mcp
```

For MCP Inspector, connect to `http://localhost:8790/mcp` and set `Authorization: Bearer local-test-key`. OAuth discovery can be validated without Auth0 credentials; an end-to-end ChatGPT login requires a separately configured Auth0 development tenant.

## Tenant agent workspace

Agent collaboration is fail-closed and opt-in. The collaboration tools are not
advertised until `AGENT_WORKSPACE_ROOT` is configured. In production this path
must point to persistent storage; do not point it at the deploy filesystem.

Available collaboration capabilities:

- logical shared folders and versioned documents;
- optimistic task creation, claim and status updates;
- registered agent heartbeats and tenant-scoped discovery;
- direct or broadcast agent messages with acknowledgements;
- atomic state updates, idempotency keys and a bounded audit trail.

All collaboration state is stored below
`AGENT_WORKSPACE_ROOT/tenants/<tenant_id>/agent-workspace`. The tenant is always
derived from the verified identity. Agent identifiers are additionally bound to
the Auth0 subject that registered them, preventing intra-tenant impersonation.

Write tools require both their resource scope and `core:govern`. Before changing
state they call Universal Core's action evaluator. Hard-block verdicts fail
closed. Documents and tasks use expected versions to prevent lost updates.

## Tenant AI memory fabric

The memory fabric is fail-closed and is advertised only when
`MEMORY_FABRIC_ROOT` (or the fallback `AGENT_WORKSPACE_ROOT`) is configured.
Each tenant gets an isolated journal, durable memories, checkpoints and AI
handoffs under `tenants/<tenant_id>/memory-fabric`.

`memory_context` and `memory_search` require `core:read`. Explicit writes through
`memory_append`, `memory_checkpoint`, `memory_handoff` and acknowledgement require
`core:govern` and pass through Universal Core. Nyra context and interpretation
automatically read this memory. Successful and failed MCP tool calls append only
redacted operational metadata; raw prompts and raw tool arguments are never
automatically persisted.

Restricted records are rejected. `customer_personal` records require a consent
reference and use the shorter personal retention ceiling. Known credentials,
tokens and email addresses are redacted before the atomic write.

## Production boundary

The MCP service calls Universal Core server-to-server with a tenant-scoped key; it never forwards the ChatGPT OAuth token to Core. Explicit memory and collaboration writes affect only the authenticated tenant's internal server-side state and require Core governance. They do not merge, deploy, publish, modify customer systems, or grant cross-tenant access.

## Multi-tenant boundary

OAuth identities must contain the namespaced custom claim configured by `MCP_TENANT_CLAIM`. Requests without it are rejected. Tool inputs never accept a tenant override: the MCP derives `tenant_id` only from the verified identity and forwards it to Core. `UNIVERSAL_CORE_KEYS_JSON` maps each tenant to a separate server-side scoped Core key; an unmapped tenant is rejected. Legacy Codex bearer access is pinned to `MCP_DEFAULT_TENANT_ID` and may use `UNIVERSAL_CORE_KEY` as its compatibility key.

For a single ChatGPT tenant, `MCP_CHATGPT_TENANT_ID` can associate the existing `CORE_MCP_KEY` secret with that exact tenant. An explicit entry in `UNIVERSAL_CORE_KEYS_JSON` always takes precedence.
