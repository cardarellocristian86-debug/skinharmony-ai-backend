# Architettura Universal Core

## Dove Vive

- Core Render: servizio centrale per produzione/tenant.
- Core 2.0 locale: `universal-core-2.0`.
- Core precedente/frozen: `universal-core` e servizi collegati.

## Componenti

- Decision engine.
- Policy packs.
- Branch/routing.
- Audit/report.
- Connector/API.
- Nyra interpretation layer quando collegata.
- Nyra dialogue runtime con validator anti-generico e guarded repair per bozze non abbastanza concrete.
- Nyra Chat Rich locale/generativa: `universal-core-2.0/tools/nyra-rich-chat.ts`, recupero selettivo snapshot/learning pack, composer locale, provider opzionale `universal-core-2.0/tools/nyra-generative-provider.ts`, fallback offline, repair e validazione anti-pattern.
- Nyra Local Governance per Codex: `universal-core-2.0/tools/nyra-local-governance.ts`, overlay rami, guida Codex e eventi locali redatti.
- Nyra Developer Code Branch: `universal-core-2.0/tools/nyra-branch-overlay.ts` espone il ramo `developer_code`; `nyra-action-router.ts` lo traduce in lavoro locale dry-run/core-gated e `nyra-codex-guidance.ts` impone lettura file mirati, patch piccola e test.
- Nyra Smart Desk Code Overlay Scan: `universal-core-2.0/tools/nyra-smartdesk-code-overlay-scan.ts` legge codice Smart Desk locale/mirror Render in read-only, esclude dati/runtime sensibili, crea memoria volatile e sovrappone route/API/import/asset/simboli; produce report JSON/Markdown e evento shared memory con conteggi e severita.
- Smart Desk vertical branch package: il connector Smart Desk usa i branch Core come layer verticale di piano. Silver passa da `front_desk_base`, `operations_silver`, `smartdesk_operations_guard` in sola lettura; Gold passa anche da `executive_gold`, `customer_360_guard`, `consent_ledger_guard` e `beauty_protocol_guard`. Nyra usa questi output come `core_branch_learning`, non come autorizzazione a eseguire.
- Nyra Action Router: `universal-core-2.0/tools/nyra-action-router.ts`, classifica comando naturale in route con rischio, gate, conferme, tool ammessi/bloccati e verifiche.
- Nyra Action Router Negation Guard: i token sensibili come `deploy`, `Render`, `produzione`, `chiavi`, `prezzi`, `tenant` contano come azione solo se non sono negati o dichiarati fuori scope; il confine resta visibile nel branch overlay ma non diventa automaticamente blocco operativo.
- Nyra Codex Memory Importer: `universal-core-2.0/tools/nyra-codex-memory-importer.ts`, distilla `SHARED_MEMORY` in `runtime/nyra-learning/nyra_codex_work_memory_latest.json` con redazione segreti e senza sync remoto.
- Nyra Connector Sidecar: il Core Codex Connector richiama lo stesso importer con root `universal-core-2.0` durante `work-start`, `checkpoint` e `finalize`, aggiornando il pack senza cambiare la CLI di Codex.
- Nyra Codex Work Supervisor: `universal-core-2.0/tools/nyra-codex-work-supervisor.ts`, legge `SHARED_MEMORY` per valutare se Codex e allineato al task contract, se sta lavorando in superficie, se mancano test/evidenze, se ci sono file fuori scope, se un test dichiara failure (`test_failure_reported`) o se serve correzione.
- Nyra Owner Private Memory: `universal-core-2.0/tools/nyra-owner-private-memory.ts`, vault locale privato e redatto in `universal-core-2.0/runtime/nyra-owner-private/`, non sincronizzato.
- Nyra Operational Diagnosis: `universal-core-2.0/tools/nyra-operational-diagnosis.ts`, esplicita lacune, apprendimenti, test e promesse da non fare.

## Flussi

1. Client invia contesto, richiesta, output AI, ruolo e runtime state.
2. Core valuta rischio e policy.
3. Core restituisce verdict, control level, action mediation e spiegazione.
4. Client esegue solo entro limiti del verdict.

## Flusso Nyra Chat Rich Locale

1. La domanda utente seleziona solo il contesto rilevante: profilo voce, learning summary, map/state/work o financial pack.
2. Il dialogue engine/Core produce punto, prima mossa, limite e motivo.
3. Se configurato, il provider generativo scrive una bozza usando solo il contratto Core + memoria selezionata.
4. Il validator blocca vecchie formule, raw report, pattern simili a segreti e risposte troppo povere.
5. Se la bozza fallisce, viene tentato un repair controllato; se fallisce ancora, torna il fallback locale.
6. Il comando resta read-only: non scrive memoria owner e non tocca produzione.

## Flusso Nyra Local Governance Per Codex

1. Core 2.0 locale seleziona la variante di lavoro quando il blocco non e banale.
2. Nyra Chat Rich produce risposta locale validata.
3. Branch Overlay identifica rami sovrapposti: Core, Codex, voce, memoria, eventi, Render boundary e domini prodotto.
4. Se la richiesta riguarda codice/debug/patch/test, Branch Overlay attiva `developer_code`; Action Router decide se la richiesta e `reply_only`, `dry_run`, `confirm_required` o `blocked`.
5. Codex Memory Importer aggiorna il pack locale da `SHARED_MEMORY`, filtrando eventi, task contract, report finali, snapshot e programmi.
6. Il Connector Sidecar puo eseguire lo stesso refresh automaticamente durante il lifecycle Codex.
7. Codex Work Supervisor puo leggere contract/checkpoint/checklist e produrre `on_track`, `attention`, `recover` o `blocked`; se trova errori test dichiarati mette Codex in `recover`.
8. Se serve codice correttivo, Nyra produce solo `core_required_patch_proposal`: Codex applica solo dopo Core gate/decisione e test.
9. Codex Guidance restituisce scope consentiti, scope bloccati, gate richiesti e test minimi.
10. Operational Diagnosis dice cosa manca, cosa apprendere, come provarlo e cosa non promettere.
11. Local Event Emitter scrive `universal-core-2.0/runtime/nyra/events/NYRA_EVENTS.jsonl` con payload redatto.
12. Per Smart Desk/Render, il code overlay scan produce report/eventi read-only su collegamenti mancanti; non legge `data/`, non chiama Render e non modifica il mirror. Il ciclo verificato include test fixture con route/import/script mancanti, scan reale mirror e controllo sintattico JS separato.
13. Render/produzione restano fuori dal flusso finche non esiste una fase separata con gate/conferma.

## Su Server / Non Su Server

- Render: tenant/clienti, API key, decisioni prodotto.
- Locale: Core 2.0 per Codex e ricerca.
- WordPress: adapter/bridge, non giudice finale quando Core remoto e attivo.
