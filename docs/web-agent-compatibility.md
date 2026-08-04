# Governed Web Agent Compatibility

This branch adds the tenant-scoped `web_compatibility` architecture to Core MCP.

## Branches

- `browser_transport`: allowlisted HTTP transport with cookie-jar continuity and GET/POST/PUT/PATCH/DELETE support.
- `structured_ingest`: extracts HTML text, metadata and JSON-LD before Nyra/model synthesis; records body and preservation digests.
- `url_continuity`: canonicalizes URLs and creates stable bounded `url_ref` values for long URLs.

Every transport call is gated by Universal Core, requires a configured origin allowlist, and returns a tenant-bound audit envelope. Unknown origins fail closed.

## Configuration

Set `WEB_AGENT_ALLOWED_ORIGINS` on the Core MCP Render service as a comma-separated list, for example:

`https://skinharmony.it,https://www.skinharmony.it`

The capability is exposed through the dynamic catalog as:

- `web_compatibility_manifest`
- `web_compatibility_execute`

JavaScript page execution is intentionally fail-closed until a host browser/CDP runtime is bound. The HTTP adapter does not pretend to execute arbitrary page scripts.
