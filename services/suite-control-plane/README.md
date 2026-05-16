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
POST /api/suite/nodes/heartbeat
POST /api/suite/nodes/snapshot
POST /api/suite/evidence
GET  /api/suite/runbooks
GET  /api/suite/customer-intelligence/contract
POST /api/suite/customer-intelligence/readiness
POST /api/suite/runbooks/preview
POST /api/suite/runbooks/dispatch
POST /api/suite/runbooks/artifacts
GET  /api/suite/nodes/:nodeId/runbook-artifacts
GET  /api/suite/nodes/:nodeId/dashboard
```

`/api/suite/ecosystem/tracks` tiene separati i due binari del prodotto:

- `suite_provider_track`: nodi WordPress/Suite, provisioning, update, runbook, evidence e audit;
- `smartdesk_gold_track`: Smart Desk Gold, Customer Intelligence, consenso, marketing governato e journey controllati.

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

Health check:

```text
GET /health
```

## Test

```bash
npm --prefix services/suite-control-plane test
```
