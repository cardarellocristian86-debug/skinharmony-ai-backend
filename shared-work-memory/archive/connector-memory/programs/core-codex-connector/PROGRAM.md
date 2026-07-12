# Core Codex Connector

## Cos'e

Il connettore che vincola Codex/assistenti a Universal Core/Core 2.0, memoria condivisa, sessioni, lock, task contract, checklist progressiva, trace end-to-end, checkpoint, supervisione, cleanup, report e Program Registry.

## Cosa Fa

- Avvia sessioni Codex tracciate.
- Richiede intent, pulse e checkpoint.
- Crea un `task contract` per ogni lavoro governato: obiettivo, criteri di chiusura, scope permessi, percorsi vietati e regole di cleanup.
- Crea una checklist progressiva per ogni `work-start`; Codex deve spuntare i punti con evidenza mentre li chiude.
- Inizializza workspace nuovi con `workspace-init`, creando cartelle, snapshot minimi, events log, Program Registry vuoto e runtime workflow senza richiedere cartelle preesistenti.
- Assegna un `trace_id` end-to-end per collegare richiesta, intent, pulse, checkpoint, supervision, cleanup e final report.
- Blocca azioni mutanti senza preflight.
- Blocca azioni mutanti senza checklist attiva.
- Blocca pulse/finalize quando i file dichiarati escono dallo scope del task contract.
- Esegue `cleanup-check` per evitare file temporanei/scarti, file dichiarati inesistenti, test mancanti e chiusure incomplete.
- Blocca `finalize` se restano punti required aperti/bloccati o se un punto `done` non ha evidenza.
- Passa decisioni a Core.
- Tiene report e dashboard.
- Integra metadata Mission Control multi-Codex in `session-start`, `work-start`, `intent-start`, `pulse`, `finalize` e dashboard: ruolo normalizzato, livello autonomia, policy attiva, registry artifact e regola owner.
- Mostra nella dashboard timeline end-to-end e task contract attivi.
- Mostra nella dashboard le checklist e quelle ancora bloccate.
- Verifica che ogni programma abbia mappa/manuale aggiornati.
- Blocca la chiusura se un file dichiarato appartiene a Suite/Core/Smart Desk/traduttore/connector ma non viene aggiornata la relativa mappa programma.
- Aggiorna automaticamente il sidecar Nyra locale su `work-start`, `checkpoint` e `finalize`, senza cambiare la firma dei comandi Codex e restando no-op se `universal-core-2.0` non e disponibile.
- Espone anche `local-agent`: comando nativo del connector per interrogare Ollama locale come agente coding subordinato, con snapshot workspace, memoria Nyra e ultimo report Core locale allegati come contesto.
- Fornisce un `Semantic Selection Layer` locale per Codex: i candidati di localizzazione/audit software passano da `V2` come filtro veloce, `V1` come governance e `V0` come giudice finale sui casi ambigui/tecnici/protetti.
- Mantiene il `Metodo SkinHarmony` verticale interno tramite `skinharmony-method-check`: registra correzioni operative ricorrenti, evidenze e regole anti-ripetizione in memoria condivisa senza inserirle nel pacchetto vendibile delle automazioni.

## Per Chi E

- Owner.
- Codex multipli.
- Assistenti futuri.
- Team che lavora su Suite/Core/Smart Desk.

## Cosa Non Fa

- Non deve contenere segreti.
- Non deve sostituire Core.
- Non deve permettere lavoro non tracciato su aree critiche.

## Stato

- Operativo in locale.
- Va usato da ogni Codex prima/durante/dopo modifiche.
- Dal 2026-05-24 include Program Registry enforcement.
- Dal 2026-05-28 include enforcement end-to-end con task contract, trace, cleanup-check, `work-start` e self-test dedicato.
- Dal 2026-05-29 `finalize` supporta anche chiusura limitata documentata quando un E2E completo non e tecnicamente applicabile: `--e2e-not-applicable "motivo"` + `--evidence "prova"`. Non indebolisce il gate normale: restano obbligatori sessione, intent, task contract, pulse, preflight, after, file dichiarati, cleanup e mappa programma. Sono derogabili solo `during`/test/Core report mancanti, e solo con prove sostitutive esplicite.
- Dal 2026-05-29 include checklist enforcement: `work-start` genera la lista, `checklist-item` spunta i punti con evidenza, `checklist-check` verifica lo stato e `finalize` blocca finche la checklist required non e chiusa.
- Dal 2026-05-30 include Nyra sidecar locale: refresh automatico di `universal-core-2.0/runtime/nyra-learning/nyra_codex_work_memory_latest.json` e report `reports/codex-core/nyra_sidecar_latest.json` sui comandi lifecycle.
- Dal 2026-05-31 include `semantic-selection-worker.mjs`: layer locale riusabile `V2 -> V1 -> V0` integrato nel workflow `localize-ui-audit` / `localize-ui-fix`, con decisioni `keep`, `discard` e `blocked` per ridurre rumore tecnico prima delle patch.
- Dal 2026-06-02 include Mission Control multi-Codex: ruoli `orchestrator`, `worker`, `researcher`, `support`, `code_corrector`, `tester`; livelli `allow_auto`, `allow_with_audit`, `review_required`, `owner_required`, `blocked`; owner richiesto solo per `owner_required` o blocco esplicito Core/Nyra.
- Dal 2026-06-05 include Metodo SkinHarmony verticale interno: policy `SHARED_MEMORY/policies/SKINHARMONY_VERTICAL_WORK_METHOD_LEARNING_POLICY_V1.md`, comando `skinharmony-method-check`, log correzioni `SHARED_MEMORY/method-learning/skinharmony_method_corrections.jsonl` e report `reports/codex-core/skinharmony_method_check_latest.json`. Non e automazione cliente e non e pacchetto vendibile.
- Dal 2026-06-24 include `local-agent`: bridge nativo verso Ollama locale per usare `qwen2.5-coder:7b` o altro modello compatibile come assistente coding subordinato a Core/Nyra, con report in `reports/codex-core/local_agent_latest.json` e storico in `SHARED_MEMORY/reports/local-agent/`.
