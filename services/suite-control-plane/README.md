# SkinHarmony Suite Control Plane

Runtime remoto separabile per `SkinHarmony Site Suite`.

Questo servizio sposta fuori da WordPress le parti che diventano pesanti quando aumentano i nodi:

- registry nodi Suite;
- heartbeat dei siti WordPress;
- snapshot di stato;
- raccolta evidence/audit;
- catalogo runbook controllati;
- dashboard remota per nodo.

Il plugin resta UI locale + receiver controllato. Universal Core resta il gate decisionale. Il Control Plane prepara solo preview/dispatch controllati: nessuna esecuzione remota cieca.

## Endpoint

```text
GET  /health
GET  /api/suite/overview
POST /api/suite/nodes/heartbeat
POST /api/suite/nodes/snapshot
POST /api/suite/evidence
GET  /api/suite/runbooks
POST /api/suite/runbooks/preview
POST /api/suite/runbooks/dispatch
GET  /api/suite/nodes/:nodeId/dashboard
```

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

Storage persistente opzionale:

```text
SUITE_CONTROL_STORAGE_ROOT=/var/data/suite-control-plane
```

Se `SUITE_CONTROL_STORAGE_ROOT` non è presente, il servizio usa memoria volatile. Con disco Render montato su `/var/data`, nodi, snapshot, evidence e dispatch runbook restano disponibili dopo restart.

Health check:

```text
GET /health
```

## Test

```bash
npm --prefix services/suite-control-plane test
```
