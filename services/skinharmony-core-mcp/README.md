# SkinHarmony Core MCP

Remote MCP endpoint compatible with existing scoped Codex bearer tokens and ChatGPT OAuth 2.1 clients backed by Auth0. Authentication never accepts an owner-confirmation field and never derives tenant access from client input.

## Authentication

- Codex: `Authorization: Bearer <key>` from `CODEX_BEARER_KEYS`; scopes come only from trusted server configuration.
- ChatGPT: Auth0 RS256 access token verified against JWKS, exact issuer, audience, expiry and optional `nbf`.
- OAuth discovery: `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` advertise authorization-code flow with PKCE `S256` only.
- MCP tools expose OAuth and bearer `securitySchemes` plus their required scopes.

Required configuration:

```text
MCP_PUBLIC_URL=https://mcp.example.com
AUTH0_ISSUER=https://YOUR_TENANT.auth0.com
AUTH0_AUDIENCE=https://mcp.example.com/mcp
CODEX_BEARER_KEYS=<comma-separated secrets>
CODEX_BEARER_SCOPES=core:read,core:govern
MCP_SUPPORTED_SCOPES=core:read,core:govern
```

Configure the Auth0 application as a public OAuth client for ChatGPT, allow only approved callback URLs, enable authorization code with PKCE, and disable password/implicit grants. Do not commit secrets. Auth0 must issue RS256 access tokens containing `scope` or `permissions`.

## Local verification

```bash
npm test --prefix services/skinharmony-core-mcp
MCP_PUBLIC_URL=http://localhost:8790 CODEX_BEARER_KEYS=local-test-key npm start --prefix services/skinharmony-core-mcp
```

For MCP Inspector, connect to `http://localhost:8790/mcp` and set `Authorization: Bearer local-test-key`. OAuth discovery can be validated without Auth0 credentials; an end-to-end ChatGPT login requires a separately configured Auth0 development tenant.

## Production boundary

This service is configuration only until separately reviewed and deployed. The implementation does not merge, deploy, publish, modify customer data, or grant cross-tenant access. Tool handlers must be injected by the host and remain subject to Universal Core governance.
