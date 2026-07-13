# ChatGPT → Nyra → Universal Core deployment

## Services

- ChatGPT calls `https://skinharmony-core-mcp.onrender.com/mcp`.
- The MCP validates Auth0 OAuth tokens and derives the tenant from `https://skinharmony.it/tenant_id`.
- The MCP selects the tenant-specific Core key from `UNIVERSAL_CORE_KEYS_JSON`.
- Universal Core remains the decision and governance boundary.
- Static shared documents remain available under `shared-work-memory/tenants/<tenant>/documents`.
- The server-side tenant memory fabric stores redacted journal events, explicit memories, checkpoints and AI handoffs on persistent storage.

## Auth0

Create a public/native OAuth application with Authorization Code + PKCE S256. Configure the ChatGPT callback URL shown during app creation. Add a post-login Action that writes the authorized tenant ID to the namespaced access-token claim `https://skinharmony.it/tenant_id`. Do not accept a tenant supplied by the browser.

Create the API audience `https://skinharmony-core-mcp.onrender.com/mcp` and permissions `core:read` and `core:govern`. Tokens must use RS256.

## Render secrets

Set these in the `skinharmony-core-mcp` service dashboard:

- `AUTH0_ISSUER`
- `UNIVERSAL_CORE_KEYS_JSON`
- optionally `UNIVERSAL_CORE_KEY` for the `owner-private` compatibility path
- `AGENT_WORKSPACE_ROOT` and `MEMORY_FABRIC_ROOT`, both pointing to the persistent Render disk

Never commit their values.

## Smoke checks

```bash
curl https://skinharmony-core-mcp.onrender.com/healthz
curl https://skinharmony-core-mcp.onrender.com/.well-known/oauth-protected-resource/mcp
```

An unauthenticated MCP request must return `401` and a `WWW-Authenticate` header pointing to protected-resource metadata.

## ChatGPT

Enable Developer mode, create a developer app, and use `https://skinharmony-core-mcp.onrender.com/mcp` as the MCP URL. After Auth0 login, test health, Nyra interpretation, Core governance, tenant memory context/search, an explicit checkpoint and an AI handoff. Confirm that a second tenant cannot retrieve the first tenant's records.
