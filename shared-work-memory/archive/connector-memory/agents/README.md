# Codex Agents Shared Registry

Questa cartella serve a coordinare piu sessioni Codex locali senza sovrascriversi.

## Regola di ingresso

Ogni Codex deve leggere prima:

1. `SHARED_MEMORY/INDEX.md`
2. `SHARED_MEMORY/README_FOR_CODEX.md`
3. `SHARED_MEMORY/snapshots/MAP_SNAPSHOT.md`
4. `SHARED_MEMORY/snapshots/STATE_SNAPSHOT.md`
5. `SHARED_MEMORY/snapshots/WORK_SNAPSHOT.md`
6. ultime righe di `SHARED_MEMORY/events/EVENTS.jsonl`

Poi deve eseguire:

```bash
npm run codex:shared-preflight
```

## File agenti

Ogni Codex puo creare un file:

```text
SHARED_MEMORY/agents/<agent-id>.json
```

Formato minimo:

```json
{
  "agent_id": "codex-local-001",
  "started_at": "2026-05-18T11:30:00+02:00",
  "owner": "Cristian Cardarello",
  "scope": "local_only",
  "area": "smartdesk|site-suite|wordpress|core-2|connector|docs",
  "current_task": "descrizione breve",
  "allowed_writes": ["path/o/cartella"],
  "forbidden": ["deploy", "production", "keys", "tenant_write", "customer_data"],
  "core_mode": "SH_CORE_LAB_2_0=1",
  "status": "active|paused|done",
  "last_report": "path/report.md"
}
```

## Regole anti conflitto

- Non modificare file gia dichiarati in `allowed_writes` da un altro agente `active`, salvo conferma owner.
- Se il lavoro tocca produzione, fermarsi: questo registry e solo locale.
- Se manca il Core 2.0 locale, lavorare solo in lettura o chiedere conferma.
- Ogni chiusura deve lasciare evento in `SHARED_MEMORY/events/EVENTS.jsonl`.
