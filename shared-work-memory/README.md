# SkinHarmony Shared Work Memory

Memoria di lavoro condivisa per ChatGPT, Nyra e Universal Core, indipendente dal vecchio connettore locale.

- `archive/connector-memory/`: copia storica non distruttiva della precedente `SHARED_MEMORY`.
- `manifests/`: inventario con dimensione e SHA-256 di ogni file importato.
- `views/nyra/`: futura vista redatta e distillata per Nyra.
- `views/core/`: futura vista di decisioni, policy ed evidenze per Universal Core.
- `runtime/`: stato remoto corrente; non contiene segreti.

La memoria grezza non deve essere esposta direttamente come tool ChatGPT. L’accesso remoto dovrà passare da tool autenticati, scope per tenant, redazione dei segreti, limiti di dimensione e audit. La directory `locks/` del connettore non viene importata perché contiene stato locale transitorio.

## Stato sicurezza import

L'import iniziale conserva integralmente i dati di lavoro ma resta quarantinato in `archive/`. Una scansione euristica ha rilevato file con termini potenzialmente sensibili (anche esempi e documentazione): prima dell'esposizione remota devono essere classificati e redatti nella vista `views/nyra/`. Nessun file dell'archivio viene restituito direttamente dai tool MCP.
