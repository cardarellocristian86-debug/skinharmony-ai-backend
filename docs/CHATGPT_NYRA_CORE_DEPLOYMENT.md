# ChatGPT → Nyra → Universal Core deployment

## Services

- ChatGPT calls `https://skinharmony-core-mcp.onrender.com/mcp`.
- The MCP validates Auth0 OAuth tokens and derives the tenant from `https://skinharmony.it/tenant_id`.
- The MCP selects the tenant-specific Core key from `UNIVERSAL_CORE_KEYS_JSON`.
- Universal Core remains the decision and governance boundary.
- Static shared documents remain available under `shared-work-memory/tenants/<tenant>/documents`.
- The server-side tenant memory fabric stores redacted journal events, explicit memories, checkpoints and AI handoffs on persistent storage.
- Governed research uses host-managed ChatGPT/Codex browsing first, then stores only reviewed tenant evidence.

## Auth0

Create a public/native OAuth application with Authorization Code + PKCE S256. Configure the ChatGPT callback URL shown during app creation. Add a post-login Action that writes the authorized tenant ID to the namespaced access-token claim `https://skinharmony.it/tenant_id`. Do not accept a tenant supplied by the browser.

Create the API audience `https://skinharmony-core-mcp.onrender.com/mcp` and permissions `core:read` and `core:govern`. Tokens must use RS256.

## Render secrets

Set these in the `skinharmony-core-mcp` service dashboard:

- `AUTH0_ISSUER`
- `UNIVERSAL_CORE_KEYS_JSON`
- `CORE_MCP_KEY` for the tenant bound by `MCP_CHATGPT_TENANT_ID`, or a tenant-specific key in `UNIVERSAL_CORE_KEYS_JSON`
- optionally `UNIVERSAL_CORE_KEY` for the `owner-private` compatibility path
- `AGENT_WORKSPACE_ROOT` and `MEMORY_FABRIC_ROOT`, both pointing to the persistent Render disk
- `RESEARCH_CORTEX_ROOT`, pointing to the same persistent Render disk
- `OPENAI_API_KEY` only for the optional fallback; keep `NYRA_OPENAI_RESEARCH_ENABLED=false` by default

Never commit their values.

The server-to-server key used by this MCP must have the existing read and guard
scopes plus `write:intelligence_outcome` for verified outcome persistence and
`owner:assertion` for request-bound owner proofs.
Do not grant `write:snapshot`, `write:decision`, `automation:codex` or an admin
scope merely to enable `outcome_record`. Rotate by creating a new tenant-bound
key, replacing only the Render secret reference, running the canary, and keeping
the old key active until rollback is no longer needed.

## Governed cross-service rollout

Use this order so every intermediate state fails closed:

1. Deploy Universal Core `0.10.3-governed-outcomes` and verify its health,
   version, commit and authorization tests.
2. Create a new tenant-bound MCP key with the current read/guard scopes plus
   exactly `write:intelligence_outcome` and `owner:assertion`. Do not modify or
   revoke the old key.
3. Ask the newly deployed Core to authorize the exact, owner-confirmed key
   rotation envelope. Stop if the verdict is not `ALLOW`.
4. Replace only the MCP service's `CORE_MCP_KEY` (and the matching tenant-map
   entry when used), then deploy/restart MCP `0.11.3-governed-outcomes`.
5. Verify health, version, commit and the expected tool count; record one unique
   `outcome_record` canary and confirm that the decision ledger closes on both a
   successful tool call and a rejected preflight.
6. Refresh the existing ChatGPT app metadata without changing its MCP URL,
   OAuth settings, scopes or tenant binding. Validate from a new chat.
7. Keep the old Core key active through the observation window. Roll back by
   restoring the old MCP secret reference and forward-reverting the release;
   revoke the replacement key only after rollback or final acceptance.

## Smoke checks

```bash
curl https://skinharmony-core-mcp.onrender.com/healthz
curl https://skinharmony-core-mcp.onrender.com/.well-known/oauth-protected-resource/mcp
```

An unauthenticated MCP request must return `401` and a `WWW-Authenticate` header pointing to protected-resource metadata.

## ChatGPT

Enable Developer mode, create a developer app, and use `https://skinharmony-core-mcp.onrender.com/mcp` as the MCP URL. After Auth0 login, test health, Nyra interpretation, Core governance, tenant memory context/search, an explicit checkpoint and an AI handoff. Confirm that a second tenant cannot retrieve the first tenant's records.

After a server deploy that changes tools or their metadata, open ChatGPT
Settings, select the installed SkinHarmony app and choose **Refresh**. Keep the
same MCP URL, OAuth configuration and tenant binding; do not recreate or
reconnect the app. Start a new chat and verify the refreshed tool catalog before
the production canary. Rollback is a forward revert of the release commit plus
restoring the previous `CORE_MCP_KEY` reference.

For research, call `work_preflight`, `nyra_research_plan`, use the host web tool,
then call `nyra_research_ingest` with the returned plan policy and a stable
idempotency key. Verify candidate status, authorized feedback, validated
`search`/`fetch`, and tenant isolation. Do not enable the optional API fallback
for this smoke test.
