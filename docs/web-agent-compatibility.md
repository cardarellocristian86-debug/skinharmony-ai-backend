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


## Browser runtime completo

Per eseguire pagine dinamiche con Chromium/Playwright, configurare uno dei due ingressi:

- `WEB_AGENT_BROWSER_WS_URL`: endpoint CDP/WebSocket di un browser Chromium isolato;
- `WEB_AGENT_BROWSER_EXECUTABLE_PATH`: percorso di un Chromium installato nel servizio.

La chiamata `web_compatibility_execute` può includere `browser` con azioni `click`, `fill`, `type`, `press`, `wait`, `wait_for_load`, `evaluate` e `screenshot`. Il runtime mantiene contesti e cookie separati per tenant, supporta DOM dinamico, moduli caricati dalla pagina e service worker osservabili. Il Core continua a governare origin, tenant e autorizzazione prima dell’apertura della pagina.

### Configurazione Render consigliata

Distribuire `services/skinharmony-browser-runtime` come servizio Docker separato usando il Dockerfile incluso. Configurare:

- browser gateway: `BROWSER_GATEWAY_KEY`;
- Core: `WEB_AGENT_BROWSER_GATEWAY_URL`;
- Core: `WEB_AGENT_BROWSER_GATEWAY_KEY`;
- entrambi: `WEB_AGENT_ALLOWED_ORIGINS`.

Il gateway non è pubblico senza la chiave, mantiene contesti Chromium separati per tenant e chiude ogni tab dopo l’operazione. Core resta il punto di autorizzazione: il gateway non sostituisce il Core.
