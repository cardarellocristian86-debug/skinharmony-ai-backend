# Codex Shared Inbox

Questa inbox contiene richieste locali per altri Codex.

## Regola

Una richiesta in inbox non autorizza produzione, deploy, chiavi o dati cliente.

Ogni richiesta deve essere convertita in micro-blocco locale con Core 2.0 lab prima di modificare file.

## Formato task

Creare un file:

```text
SHARED_MEMORY/inbox/<timestamp>-<slug>.json
```

Schema minimo:

```json
{
  "task_id": "2026-05-18-core2-preflight",
  "created_at": "2026-05-18T11:30:00+02:00",
  "created_by": "Cristian Cardarello|codex",
  "area": "core-2|connector|smartdesk|site-suite|wordpress|docs",
  "goal": "obiettivo concreto",
  "scope": "local_only",
  "allowed_paths": ["path/consentito"],
  "forbidden": ["deploy", "production", "keys", "tenant_write", "customer_data"],
  "required_reads": [
    "SHARED_MEMORY/INDEX.md",
    "SHARED_MEMORY/snapshots/STATE_SNAPSHOT.md"
  ],
  "acceptance_tests": ["comando test locale"],
  "status": "open|claimed|done|blocked",
  "claimed_by": null,
  "report_path": null
}
```

## Stati

- `open`: pronto per essere preso.
- `claimed`: un Codex sta lavorando.
- `done`: chiuso con test e report.
- `blocked`: bloccato, serve owner o nuovo contesto.

Non cancellare task chiusi: archiviarli in `SHARED_MEMORY/archive/` solo quando non servono piu.
