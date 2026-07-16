# SkinHarmony Suite Control Plane

Runtime remoto separabile per `SkinHarmony Site Suite`.

Questo servizio sposta fuori da WordPress le parti che diventano pesanti quando aumentano i nodi:

- registry nodi Suite;
- heartbeat dei siti WordPress;
- snapshot di stato;
- raccolta evidence/audit;
- catalogo runbook controllati;
- storage artifact runbook;
- dashboard remota per nodo.
- Cockpit 360 tenant-scoped con copertura moduli, rami, priorita e conflitti;
- idratazione server-side del contesto Nyra senza profili cliente raw.

Il plugin resta UI locale + receiver controllato. Universal Core resta il gate decisionale. Il Control Plane prepara solo preview/dispatch controllati: nessuna esecuzione remota cieca.

## Endpoint

```text
GET  /livez
GET  /health
GET  /readyz
GET  /api/suite/overview
GET  /api/suite/ecosystem/tracks
GET  /api/suite/control-plane/dashboard
GET  /api/suite/tenants/:tenantId/dashboard
GET  /api/suite/tenants/:tenantId/cockpit-360
GET  /api/suite/cockpit-360
POST /api/suite/nodes/heartbeat
POST /api/suite/nodes/snapshot
POST /api/suite/evidence
POST /api/suite/events/ingest
GET  /api/suite/tenants/:tenantId/events/summary
GET  /api/suite/tenants/:tenantId/analytics/action-plan
POST /api/suite/commerce/snapshot
GET  /api/suite/tenants/:tenantId/commerce/summary
GET  /api/suite/runbooks
GET  /api/suite/runbooks/catalog-spec
GET  /api/suite/nyra/branch-map
GET  /api/suite/nyra/core/status
GET  /api/suite/nyra/customer-intelligence/contract
POST /api/suite/nyra/decision-preview
POST /api/suite/core/nira-bridge
GET  /api/suite/customer-intelligence/contract
POST /api/suite/customer-intelligence/readiness
GET  /api/suite/integrations/google/status
GET  /api/suite/integrations/google/connect
POST /api/suite/integrations/google/validate
POST /api/suite/governance/validate
POST /api/suite/core/action-mediation
POST /api/suite/runbooks/preview
POST /api/suite/runbooks/dispatch
POST /api/suite/runbooks/artifacts
GET  /api/suite/nodes/:nodeId/runbook-artifacts
GET  /api/suite/nodes/:nodeId/dashboard
```

`/api/suite/control-plane/dashboard` e `/api/suite/tenants/:tenantId/dashboard` sono viste read-only per chiudere la slice `control_plane_first`: stato tenant, nodi, readiness, bridge Core, evidence e prossime azioni. Non eseguono automazioni e non modificano chiavi, tenant o produzione.

`/api/suite/ecosystem/tracks` tiene separati i due binari del prodotto:

- `suite_provider_track`: nodi WordPress/Suite, provisioning, update, runbook, evidence e audit;
- `smartdesk_gold_track`: Smart Desk Gold, Customer Intelligence, consenso, marketing governato e journey controllati.

`/api/suite/governance/validate` valida il manifest Suite/Core/Codex prima di azioni sensibili. `/api/suite/core/action-mediation` blocca `deploy`, `release`, `publish`, `update`, scritture produzione, pricing, claim, cross-tenant e automazioni Codex se il manifest governance manca o non passa.

`/api/suite/events/ingest`, `/events/summary` e `/analytics/action-plan`
spostano Analytics WaaS su Render: WordPress raccoglie eventi leggeri, Render
conserva storico tenant-scoped e genera raccomandazioni read-only.

`/api/suite/commerce/snapshot` e `/commerce/summary` sono il secondo blocco di
estrazione: WordPress invia solo un riepilogo aggregato di CRM, magazzino,
ordini, licenze e lead. Render conserva storico e readiness, senza salvare
record cliente grezzi, catturare pagamenti o modificare stock.

`/api/suite/nyra/branch-map` espone il contratto read-only dei rami Nyra/Suite:
Analytics, Google Ads/GA4, Marketing, CRM, Commerce, registry, pricing, claim,
licenze, Customer Success, Render operations, support risk e visual content. Il
contratto serve a orientare Core/Nyra; non abilita esecuzione automatica e
richiede conferma owner per qualsiasi scrittura.

La versione `nyra_suite_branch_architecture_v2` descrive per ciascuno dei 14
rami: scopo, fonti di evidence, segnali, dipendenze hard/soft, regole e soglie,
output, runbook, SLA di freshness, privacy, guardrail, fallback ed
explainability. Le dipendenze hard propagano `blocked` e `insufficient_data`;
claim, pricing, licenza, tenant e safety hanno precedenza sui suggerimenti di
crescita.

`/api/suite/tenants/:tenantId/cockpit-360` restituisce
`cockpit_360_summary_v1`: snapshot aggregato, `revision_hash` deterministico,
copertura attesa dei 50 moduli Suite, stato dei rami, priorita e conflitti.
Render conserva soltanto campi whitelistati: non persiste profili cliente raw,
email, telefono, token, password o chiavi contenuti nel payload WordPress.

`/api/suite/nyra/decision-preview` carica il Cockpit e i contratti dei rami dal
server prima di chiamare Nyra. Il body del chiamante non puo sostituire tenant,
scope o fatti del Cockpit. `/api/suite/core/nira-bridge` e un alias di
compatibilita; la route canonica resta quella Nyra. Entrambe producono solo
preview con `execution_allowed=false`.

`/api/suite/runbooks/catalog-spec` chiude il contratto atteso dal plugin. Il
dispatch rimane una coda di proposte. Un envelope Core/owner opzionale viene
accettato solo se lega tenant, nodo, runbook, action id, decision id e scadenza;
non trasforma mai la proposta in esecuzione.

`/api/suite/integrations/google/*` prepara il connettore Google Ads/Analytics
con flusso semplice per il cliente: click su `Collega Google`, login Google,
consenso OAuth, scelta account Ads/proprieta GA4 e lettura metriche. Il servizio
non crea campagne, non cambia budget, non modifica keyword e non pubblica
azioni.

Tutti gli endpoint `/api/suite/*` richiedono:

```text
Authorization: Bearer <SUITE_CONTROL_PLANE_API_KEY>
```

oppure:

```text
x-sh-suite-key: <SUITE_CONTROL_PLANE_API_KEY>
```

La modalita a chiave singola resta compatibile, ma la chiave viene legata
server-side a `SUITE_CONTROL_PLANE_TENANT_ID` e agli scope dichiarati in
`SUITE_CONTROL_PLANE_SCOPES`. Header, path e body con tenant differenti vengono
rifiutati. Per piu tenant usare un registro JSON segreto lato Render:

```json
[
  {
    "key_id": "wp-node-a",
    "secret": "<secret>",
    "tenant_id": "tenant-a",
    "scopes": ["suite:read", "suite:ingest", "suite:preview", "suite:dispatch"]
  }
]
```

Il registro va salvato in `SUITE_CONTROL_PLANE_KEYS_JSON`; non viene mai
restituito dalle API. Gli scope disponibili sono `suite:read`, `suite:ingest`,
`suite:preview`, `suite:govern`, `suite:dispatch` e `suite:admin`.

## Render

Variabili minime:

```text
NODE_ENV=production
SUITE_CONTROL_PLANE_API_KEY=<chiave lunga scoped>
SUITE_CONTROL_PLANE_TENANT_ID=skinharmony-suite
SUITE_CONTROL_PLANE_SCOPES=suite:read,suite:ingest,suite:preview,suite:dispatch
SUITE_REQUIRE_PERSISTENT_STORAGE=true
SUITE_READINESS_PROBE_REMOTE=true
SUITE_READINESS_PROBE_CACHE_MS=30000
```

Variabili Google opzionali:

```text
GOOGLE_CLIENT_ID=<oauth client id>
GOOGLE_CLIENT_SECRET=<oauth client secret>
GOOGLE_ADS_DEVELOPER_TOKEN=<developer token>
GOOGLE_OAUTH_REDIRECT_URI=https://<servizio>/api/suite/integrations/google/oauth/callback
```

Per leggere il contratto Customer Intelligence da Universal Core:

```text
UNIVERSAL_CORE_URL=https://skinharmony-universal-core.onrender.com
UNIVERSAL_CORE_KEY=<chiave Core scoped>
UNIVERSAL_CORE_TENANT_ID=<tenant default>
```

Bridge Nyra Suite tenant-scoped:

```text
NYRA_SUITE_URL=https://skinharmony-nyra-core.onrender.com
NYRA_SUITE_BRIDGE_KEY=<chiave dedicata solo alle route /api/nyra/suite/*>
NYRA_SUITE_TENANT_ID=skinharmony-suite
```

Il Control Plane usa Nyra solo per stato Core, contratto Customer Intelligence e preview decisionale. Nessuna route abilita invii, scritture cliente o esecuzione automatica.

Storage persistente richiesto in produzione:

```text
SUITE_CONTROL_STORAGE_ROOT=/var/data/suite-control-plane
```

Se `SUITE_CONTROL_STORAGE_ROOT` non è presente, il servizio usa memoria volatile
e `/readyz` fallisce in produzione. Con disco Render montato su `/var/data`,
nodi, snapshot, evidence, dispatch runbook e artifact restano disponibili dopo
restart. I nodi sono indicizzati con chiave composta `tenant_id::node_id`, quindi
lo stesso `node_id` in tenant differenti non condivide dashboard o artifact.

Liveness nodi:

```text
SUITE_NODE_STALE_AFTER_MS=900000
```

Un nodo con ultimo heartbeat più vecchio della soglia viene esposto come `stale`, abbassa la readiness e blocca i preview/dispatch dei runbook finché non arriva un nuovo heartbeat. L'attività storica, uno snapshot o un artifact non sostituiscono il heartbeat.

Health e readiness:

```text
GET /livez
GET /health
GET /readyz
```

`/livez` verifica soltanto che il processo risponda. `/health` espone stato
locale senza dipendere dalla rete. `/readyz` e fail-closed: verifica auth e
tenant binding, architettura rami, storage persistente/scrivibile, scope
Core/Nyra e, in produzione, esegue probe GET read-only. I probe sono conservati
per 30 secondi (configurabile) per evitare una chiamata remota a ogni health
poll; scaduta la cache, una dipendenza non raggiungibile rende il servizio non
ready ma non non-live.

## Test

```bash
npm --prefix services/suite-control-plane test
```
