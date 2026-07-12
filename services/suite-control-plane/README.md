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

Il plugin resta UI locale + receiver controllato. Universal Core resta il gate decisionale. Il Control Plane prepara solo preview/dispatch controllati: nessuna esecuzione remota cieca.

## Endpoint

```text
GET  /health
GET  /api/suite/overview
GET  /api/suite/ecosystem/tracks
GET  /api/suite/control-plane/dashboard
GET  /api/suite/tenants/:tenantId/dashboard
POST /api/suite/nodes/heartbeat
POST /api/suite/nodes/snapshot
POST /api/suite/evidence
POST /api/suite/events/ingest
GET  /api/suite/tenants/:tenantId/events/summary
GET  /api/suite/tenants/:tenantId/analytics/action-plan
POST /api/suite/commerce/snapshot
GET  /api/suite/tenants/:tenantId/commerce/summary
GET  /api/suite/runbooks
GET  /api/suite/nyra/branch-map
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

## Render

Variabili minime:

```text
NODE_ENV=production
SUITE_CONTROL_PLANE_API_KEY=<chiave lunga scoped>
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

Storage persistente opzionale:

```text
SUITE_CONTROL_STORAGE_ROOT=/var/data/suite-control-plane
```

Se `SUITE_CONTROL_STORAGE_ROOT` non è presente, il servizio usa memoria volatile. Con disco Render montato su `/var/data`, nodi, snapshot, evidence, dispatch runbook e artifact restano disponibili dopo restart.

Liveness nodi:

```text
SUITE_NODE_STALE_AFTER_MS=900000
```

Un nodo con ultimo heartbeat più vecchio della soglia viene esposto come `stale`, abbassa la readiness e blocca i preview/dispatch dei runbook finché non arriva un nuovo heartbeat. L'attività storica, uno snapshot o un artifact non sostituiscono il heartbeat.

Health check:

```text
GET /health
```

## Test

```bash
npm --prefix services/suite-control-plane test
```
