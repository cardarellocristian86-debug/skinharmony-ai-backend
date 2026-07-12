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
MCP_SUPPORTED_SCOPES=core:read,core:govern
UNIVERSAL_CORE_URL=https://your-universal-core.example.com
UNIVERSAL_CORE_KEY=<server-side scoped Core key>
UNIVERSAL_CORE_KEYS_JSON={"tenant-a":"server-side-key-a","tenant-b":"server-side-key-b"}
MCP_DEFAULT_TENANT_ID=owner-private
MCP_TENANT_CLAIM=https://skinharmony.it/tenant_id
SHARED_WORK_MEMORY_ROOT=/app/shared-work-memory
```

Configure the Auth0 application as a public OAuth client for ChatGPT, allow only approved callback URLs, enable authorization code with PKCE, and disable password/implicit grants. Do not commit secrets. Auth0 must issue RS256 access tokens containing `scope` or `permissions`.

## Local verification

```bash
npm test --prefix services/skinharmony-core-mcp
MCP_PUBLIC_URL=http://localhost:8790 CODEX_BEARER_KEYS=local-test-key npm start --prefix services/skinharmony-core-mcp
```

For MCP Inspector, connect to `http://localhost:8790/mcp` and set `Authorization: Bearer local-test-key`. OAuth discovery can be validated without Auth0 credentials; an end-to-end ChatGPT login requires a separately configured Auth0 development tenant.

## Production boundary

The MCP service calls Universal Core server-to-server with `UNIVERSAL_CORE_KEY`; it never forwards the ChatGPT OAuth token to Core. The exposed tools only read, interpret, or evaluate. They do not merge, deploy, publish, modify customer data, or grant cross-tenant access.

## Multi-tenant boundary

OAuth identities must contain the namespaced custom claim configured by `MCP_TENANT_CLAIM`. Requests without it are rejected. Tool inputs never accept a tenant override: the MCP derives `tenant_id` only from the verified identity and forwards it to Core. `UNIVERSAL_CORE_KEYS_JSON` maps each tenant to a separate server-side scoped Core key; an unmapped tenant is rejected. Legacy Codex bearer access is pinned to `MCP_DEFAULT_TENANT_ID` and may use `UNIVERSAL_CORE_KEY` as its compatibility key.
