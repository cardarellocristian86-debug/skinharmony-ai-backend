# SkinHarmony Shared Memory

Questa cartella e la memoria condivisa locale per piu sessioni Codex/assistant.

Regola operativa:
1. Leggi sempre `INDEX.md`, `snapshots/MAP_SNAPSHOT.md`, `snapshots/STATE_SNAPSHOT.md` e `snapshots/WORK_SNAPSHOT.md` prima di lavorare.
2. Non riscrivere eventi storici. Gli eventi sono append-only in `events/EVENTS.jsonl`.
3. Le decisioni Core importanti vanno in `decisions/DECISIONS.jsonl`.
4. Aggiorna gli snapshot solo quando cambia davvero stato, mappa o prossimo lavoro.
5. Ogni agente puo scrivere un handoff in `handoffs/`, ma deve lasciare chiaro cosa ha fatto, cosa resta e dove verificare.
6. Non mettere segreti/API key nei file di memoria condivisa. Usa solo path sicuri o report redatti.
7. Prima di modifiche sensibili usa il Core gate, salvo `core off` esplicito dell'owner per quella singola attivita.
8. Se Core non e raggiungibile, limita il lavoro a documentazione/analisi locale o chiedi conferma owner prima di scrivere codice operativo.
8a. Regola strict loop Core per blocchi Suite/Smart Desk/Core/WordPress: chiamare Core prima della modifica, durante il lavoro e dopo test/zip. Se Core non risponde, diagnosticare il motivo, riprovare e non interpretare il verdetto a mano. Per blocchi sensibili il report finale deve indicare report/audit Core e prove eseguite.
9. Se tocchi una delle aree coperte da failure report, leggilo prima di agire:
   - `reports/CORE_2_0_FAILURE_READ_REPORT.md`
   - `reports/SMARTDESK_FAILURE_READ_REPORT.md`
   - `reports/SITE_SUITE_FAILURE_READ_REPORT.md`
   - `reports/WORDPRESS_PLUGIN_RELEASE_FAILURE_READ_REPORT.md`
10. I failure report servono a evitare errori inventati: se trovi un problema nuovo, aggiungilo o aggiorna il report corrispondente.
11. Quando usi Core 2.0/Core Codex come gate, aggiorna anche `reports/codex-core/CORE_2_0_CODEX_USAGE_REPORT.md` con verdetto, latenza, beneficio, errore/limite e prossima azione.
12. Ogni programma deve avere mappa e manuale aggiornati in `SHARED_MEMORY/programs/`. Se tocchi Suite, SkinHarmony Core/traduttore, Universal Core, Smart Desk o connector devi leggere la relativa cartella programma e aggiornare almeno uno tra `PROGRAM.md`, `ARCHITECTURE.md`, `USER_MANUAL.md`, `OPERATIONS.md` quando cambia comportamento, architettura, server/runtime, UI, API, vendita o workflow.
13. Prima di chiudere un lavoro esegui `node scripts/program_registry_check.js`. Se dichiari file modificati nel connector, `finalize` blocca quando tocchi un programma senza aggiornare la relativa mappa.

## Accesso rapido per altri Codex
Per aprire un nuovo Codex gia collegato al Core Codex Connector usare lo script stabile, non incollare comandi lunghi con `packages/core-codex-connector` perche il terminale puo spezzarli.

Formato:

```sh
cd /Users/cristiancardarello/skinharmony-codex && ./scripts/start-codex-agent.sh <agent_id> <scope>
```

Esempi:

```sh
cd /Users/cristiancardarello/skinharmony-codex && ./scripts/start-codex-agent.sh codex_04 suite
```

```sh
cd /Users/cristiancardarello/skinharmony-codex && ./scripts/start-codex-agent.sh codex_05 smartdesk
```

```sh
cd /Users/cristiancardarello/skinharmony-codex && ./scripts/start-codex-agent.sh codex_06 wordpress
```

Lo script fa automaticamente:

- `workspace-init` se la struttura condivisa non esiste ancora;
- `work-start`;
- sessione, lock, intent, `task contract`, `trace_id`, checkpoint preflight e pulse iniziale;
- `core2-watch --once`;
- apertura di `codex`.

Se il controllo termina con:

```text
Pulse written | verdict=on_track | flags=0
Core2 watch | verdict=on_track | flags=-
```

la sessione e collegata correttamente.

Regola: il primo avvio deve passare da `work-start` o dallo script `start-codex-agent.sh`; cosi Codex non parte senza contratto, trace e scope.

All'avvio di una nuova sessione, incollare questo comando operativo:

```text
Lavora nel repo /Users/cristiancardarello/skinharmony-codex. Prima di fare qualunque modifica leggi SHARED_MEMORY/INDEX.md, SHARED_MEMORY/snapshots/MAP_SNAPSHOT.md, SHARED_MEMORY/snapshots/STATE_SNAPSHOT.md e SHARED_MEMORY/snapshots/WORK_SNAPSHOT.md. Usa Universal Core come gate per azioni sensibili tramite /Users/cristiancardarello/Desktop/SkinHarmony_Core_Codex_Connector/runtime/bin/sh-core-codex. Non salvare segreti nella memoria condivisa. A fine lavoro appendi un evento in SHARED_MEMORY/events/EVENTS.jsonl e, se serve, lascia un handoff in SHARED_MEMORY/handoffs/.
```

## Vincolo operativo
Gli altri Codex non devono lavorare "a memoria". Devono:
- leggere snapshot prima di agire;
- leggere `SHARED_MEMORY/programs/PROGRAM_REGISTRY.json` e la cartella programma collegata al proprio scope;
- dichiarare quale area stanno toccando;
- usare Core gate per update/deploy/publish/release/chiavi/tenant/clienti;
- aggiornare la mappa programma quando cambiano funzioni, architettura, server, workflow o manuale;
- registrare il risultato;
- non sovrascrivere lavoro parallelo senza leggere prima lo stato corrente.

Fonti architetturali usate: pattern 2026 su shared context, event log, durable state, semantic/episodic memory, namespace isolation e single-writer/merge esplicito.
