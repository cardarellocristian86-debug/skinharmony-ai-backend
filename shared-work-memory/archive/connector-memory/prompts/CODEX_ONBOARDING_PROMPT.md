# Prompt Onboarding Altri Codex

Usa questo testo quando apri un altro Codex/assistente sul progetto.

```text
Sei dentro il progetto SkinHarmony.

Repo locale:
/Users/cristiancardarello/skinharmony-codex

Prima di lavorare devi leggere:
- SHARED_MEMORY/INDEX.md
- SHARED_MEMORY/snapshots/MAP_SNAPSHOT.md
- SHARED_MEMORY/snapshots/STATE_SNAPSHOT.md
- SHARED_MEMORY/snapshots/WORK_SNAPSHOT.md
- SHARED_MEMORY/programs/README.md
- SHARED_MEMORY/programs/PROGRAM_REGISTRY.json
- la cartella `SHARED_MEMORY/programs/<programma>/` collegata allo scope che tocchi
- ultime righe di SHARED_MEMORY/events/EVENTS.jsonl
- ultime righe di SHARED_MEMORY/decisions/DECISIONS.jsonl

Regole:
- non inventare prezzi, claim, stato tecnico o specifiche;
- non salvare segreti/API key/password nella memoria condivisa;
- in lavoro multi-Codex, se sei `codex-correttore-codici`, leggi `SHARED_MEMORY/policies/CODEX_CODE_CORRECTOR_SHARED_WORK_MODE_V1.md`: devi leggere il lavoro degli altri Codex, usare i risultati del ricercatore analista, correggere errori reali di codice quando scope/lock/Core lo permettono, verificare e scrivere esito;
- in lavoro multi-Codex, se sei `codex-ricercatore-analista`, leggi `SHARED_MEMORY/policies/CODEX_RESEARCH_ANALYST_MODE_V1.md`: devi fare ricerca parallela, misure, probabilita, rischi e passare risultati concreti al correttore/implementatore;
- per update, deploy, release, publish, chiavi, tenant, clienti, pagamenti o automazioni usa Universal Core gate;
- per esecuzione locale di azioni sensibili usa il wrapper:
  `bash /Users/cristiancardarello/skinharmony-codex/scripts/codex-guarded-exec.sh <comando ...>`
- Core connector:
  /Users/cristiancardarello/Desktop/SkinHarmony_Core_Codex_Connector/runtime/bin/sh-core-codex
- se Core blocca, fermati e riporta audit/reason;
- se Core chiede conferma owner, attendi conferma esplicita;
- se Cristian scrive "core off", vale solo per quella singola attivita e va riportato nel log;
- a fine lavoro aggiorna solo gli snapshot necessari e appendi un evento in SHARED_MEMORY/events/EVENTS.jsonl;
- se tocchi Suite, SkinHarmony Core/traduttore, Universal Core, Smart Desk o connector, aggiorna anche la mappa programma:
  - `SHARED_MEMORY/programs/<programma>/PROGRAM.md`
  - `SHARED_MEMORY/programs/<programma>/ARCHITECTURE.md`
  - `SHARED_MEMORY/programs/<programma>/USER_MANUAL.md`
  - `SHARED_MEMORY/programs/<programma>/OPERATIONS.md`
- prima di dichiarare finito esegui `node scripts/program_registry_check.js` oppure `sh-core-codex program-map-check --file <file-modificato>`;
- se lasci lavoro a meta, crea un file in SHARED_MEMORY/handoffs/.

Regola per pagine/nodi SkinHarmony:
template madre -> clone completo layout/CSS -> modifica contenuti -> Core check -> verifica rendering -> publish/update.
```
