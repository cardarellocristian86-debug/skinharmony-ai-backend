# Architettura Core Codex Connector

## Dove Vive

- Codice: `packages/core-codex-connector`.
- Memoria: `SHARED_MEMORY`.
- Workflow: `runtime/codex-core-workflow`.
- Report: `reports/codex-core`, `SHARED_MEMORY/reports/codex-orchestrator`.

## Componenti

- CLI `sh-core-codex`.
- Workspace initializer: `workspace-init` crea struttura minima idempotente per nuovi repo/cliente.
- Session manager.
- Lock manager.
- Intent/pulse/checkpoint/finalize.
- Task contract manager: salva contratto operativo per sessione con `trace_id`, scope permessi, percorsi vietati, prove richieste e regole anti-deriva.
- Mission Control metadata layer: legge `SHARED_MEMORY/policies/CODEX_MISSION_CONTROL_AUTONOMY_POLICY_V1.md`, normalizza il ruolo Codex e allega livello autonomia/owner rule a sessioni, intent, task contract, pulse, finalize e dashboard.
- Checklist manager: salva lista progressiva per sessione in `SHARED_MEMORY/checklists`, consente aggiornamento item con evidenza e blocca la chiusura incompleta.
- Cleanup gate: verifica file dichiarati, scope, test, scarti temporanei e stato del lavoro prima della chiusura.
- Core gate/decision.
- Semantic Selection Layer locale: `packages/core-codex-connector/src/semantic-selection-worker.mjs` costruisce segnali semantici dai candidati, usa `universal-core-2.0` quando disponibile e applica pipeline `V2 prefilter -> V1 governance -> V0 final decision`; se il laboratorio non e importabile resta su fallback locale prudente.
- Program registry validator.
- Dashboard control room: espone KPI, agenti attivi, timeline end-to-end, checklist, task contract, eventi, lock e spiegazione Core/Nyra.
- Nyra local sidecar: hook interno opzionale su `work-start`, `checkpoint` e `finalize` che richiama l importer locale `universal-core-2.0/tools/nyra-codex-memory-importer.ts`, aggiorna memoria Codex distillata e scrive `reports/codex-core/nyra_sidecar_latest.json`.
- Local agent bridge: comando `local-agent` nel CLI che parla con Ollama locale via `/api/chat`, costruisce contesto da snapshot workspace, memoria Nyra e ultimo report Core locale, e salva report in `reports/codex-core/local_agent_latest.json` + storico in `SHARED_MEMORY/reports/local-agent/`.
- SkinHarmony Method Learning: comando interno `skinharmony-method-check` che legge la policy verticale SkinHarmony, registra correzioni di metodo in `SHARED_MEMORY/method-learning/skinharmony_method_corrections.jsonl` e produce `reports/codex-core/skinharmony_method_check_latest.json`.

## Flussi

1. `workspace-init` automatico o manuale sul primo avvio.
2. `work-start` oppure flusso manuale `session-start -> lock -> intent-start`.
3. Creazione task contract, checklist e `trace_id`.
4. Applicazione metadata Mission Control: ruolo, livello autonomia, policy, artifact registry e owner rule.
5. Preflight checkpoint e pulse iniziale.
6. Nyra sidecar locale aggiorna memoria distillata se `universal-core-2.0` e disponibile; se manca, no-op.
7. Core decision/gate prima di azioni sensibili.
7b. Se il Codex vuole usare un assistente locale, `local-agent` richiama prima il sidecar Nyra, poi passa a Ollama un contesto composto da snapshot workspace, memoria Nyra e ultimo report Core locale; il risultato resta advisory e non autorizza mutazioni.
7c. Per audit/localizzazione software, il worker genera candidati e li passa al Semantic Selection Layer: solo `keep` entra nelle proposte di fix; `discard` resta evidenza; `blocked` segnala rumore tecnico/branch non target/termine protetto o caso da non patchare.
8. Modifica dentro scope.
9. Pulse, checklist-item e supervise durante il lavoro.
10. Checkpoint richiama sidecar, poi test e checkpoint `during/after`.
11. Se emerge una correzione di metodo ripetibile, `skinharmony-method-check --correction ... --evidence ... --prevent-repeat ...` la registra nella memoria verticale SkinHarmony.
12. Cleanup-check e Program Registry quando necessario.
13. Finalize solo con checklist chiusa e prove complete; finalize richiama sidecar dopo il report.

## Enforcement End-to-End

- `exec` blocca azioni mutanti senza sessione, lock, intent, task contract, checklist, pulse fresco e checkpoint preflight.
- `pulse` marca `recover` se i file dichiarati sono fuori scope o vietati dal task contract.
- `supervise` confronta intento, pulse, file osservati e task contract; se i file cambiano dopo l ultimo pulse genera `recover`.
- `finalize` blocca se mancano fasi, checklist chiusa, test, file, report Core, task contract, cleanup o mappa programma.
- `checklist-check` blocca se restano item required aperti/bloccati, se un item `done` non ha evidenza o se `not_applicable` non ha motivo/evidenza.
- `cleanup-check` e comando separato per verificare chiusura pulita prima del report finale.
- Mission Control non esegue automaticamente azioni nuove: classifica il perimetro operativo. `allow_auto` e `allow_with_audit` non richiedono Cristian; `owner_required` e blocchi Core/Nyra richiedono escalation.

## Program Registry Enforcement

- Registry: `SHARED_MEMORY/programs/PROGRAM_REGISTRY.json`.
- Mappe programma: `SHARED_MEMORY/programs/<programma>/`.
- Script standalone: `scripts/program_registry_check.js`.
- Comando connector: `sh-core-codex program-map-check --file <file>`.
- Gate di chiusura: `finalize` usa i file dichiarati con `--file`; se toccano un programma senza una mappa aggiornata, blocca.

## Confini

- Il connettore controlla processo e audit.
- Core decide rischio/direzione.
- Codex implementa.
- Nyra legge memoria distillata e guida quando integrata; il sidecar e locale, non tocca Render/produzione/chiavi/clienti/prezzi e puo essere disattivato con `SH_CODEX_NYRA_SIDECAR=0`.
- Il bridge `local-agent` e solo lettura/consiglio locale: non esegue deploy, non scrive produzione, non scavalca Core e non sostituisce Codex.
- Il Semantic Selection Layer non sostituisce il traduttore prodotto o Core Render: localmente aiuta Codex a pulire rumore; su Render va esposto in futuro come endpoint governato separato.
- Il Metodo SkinHarmony e memoria operativa interna: non e automazione cliente, non va nel catalogo vendibile e non autorizza deploy, pubblicazioni, prezzi, tenant, dati cliente o claim.
