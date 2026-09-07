# Nyra Core — recovery, enforcement e verifica end-to-end governata

Data: 2026-09-05

Tenant operativo: `[REDACTED — binding conservato nel registro evidenze governato]`

Work governato: `[REDACTED — riferimento canonico conservato nel registro evidenze governato]`

Branch di rilascio: `fix/nyra-enforcement-readiness-20260905`

## Obiettivo

Ridurre i passaggi inutili e i blocchi del percorso conversazionale, preservando i controlli che impediscono mutazioni non autorizzate; rendere affidabili lettura Work, Gallery, checkpoint e chiusura; portare Entity360, Semantic Scope Guard, Software Cognition e Policy Registry da stati dichiarativi a enforcement operativo verificabile; integrare il piano software con effetto a cascata; distribuire lo stesso commit sui tre runtime Render e chiudere i Work Gallery solo con evidenza reale.

## Difetti riprodotti

- richieste informative convertite in `WORK_BOOTSTRAP`;
- richieste `READ_ONLY` inoltrate al gate di mutazione/precommit;
- perdita del `work_id` nel dialogo;
- lettura di Work validi bloccata da errori 409;
- UUID inesistente restituito come `ok:true` anziché `WORK_NOT_FOUND`;
- elenco delle funzioni attive non materializzato;
- stato Work privo di progresso, blocker e checkpoint utilizzabili;
- rami mostrati come aperti anche durante una semplice lettura;
- Gallery legacy impossibile da riconciliare in modo onesto;
- timestamp PostgreSQL `Date` non canonici nella chiusura generica;
- Entity360 e Semantic Scope presenti ma non realmente fail-closed in enforcement;
- Software Cognition poteva propagare dettagli grezzi di inizializzazione;
- blueprint Policy Registry non coerenti fra Nyra, MCP e Universal Core;
- superficie MCP compatta oltre il limite di importazione del connettore.
- due ricevute pre-Core create nello stesso millisecondo potevano rendere non esatto il readback temporale `as_of`.

## Correzioni implementate

### Dialogue, Work e Gallery

- Il piano read-only resta nel read plane e non apre rami esecutivi: `opened_branch_count = 0`.
- Il binding canonico del Work conserva `project_id`, `work_id`, revisione e intent/context digest.
- La risposta fattuale espone progresso deterministico, blocker, disponibilità checkpoint e stato della closure.
- Un UUID inesistente produce un errore esplicito e non viene confuso con un Work privo di dati.
- Le domande sul modello operativo e sulle funzioni attive sono materializzate senza creare Work.
- La chiusura generica converte veri oggetti `Date` in ISO prima di digest, JSONB e readback; timestamp invalidi sono rifiutati.
- La riconciliazione `BLOCKED_VALID` consente soltanto `SUPERSEDE`, richiede conferma Owner, assenza di attività, successore nello stesso progetto, stato terminale del successore, `tenant_work_closure_receipt` e final report server-side. Il Work storico non viene dichiarato `COMPLETED`.
- Il fallback basato sul solo evento legacy `closure_finalized` è vietato per `BLOCKED_VALID`.

### Entity360 v2 e Semantic Scope Guard

- Policy v2 esatta, registry adapter read-only, store/migrazione additiva e snapshot bitemporale.
- Autorità esclusiva Universal Core: Entity360 non può auto-approvare, cambiare provider o concedersi capacità.
- Il resolver lega tenant, Work, policy, receipt, action digest, fase e freshness.
- In `ENFORCE` procede solo `ALLOW`; `BLOCK`, `HOLD`, `REVALIDATE` e `REDACT` falliscono chiusi.
- Snapshot scaduti, futuri, manomessi o incoerenti vengono respinti.
- Rollback per tenant verso `SHADOW` o `OFF` preservato.
- Aggiunta una capability amministrativa dinamica `entity_360_enforce_enable`: il chiamante non può scegliere il mode, perché `ENFORCED`/`enabled:true` sono fissati server-side; servono `CORE_OPERATE`, conferma Owner, CAS sulla revisione e readback esatto dell'autorità Universal Core. La capability non viene aggiunta alla superficie compatta quotidiana.

### Software Cognition e piano a cascata

- Modalità produzione `ENFORCED` con readiness fail-closed e signer remoto vincolato.
- `/healthz` e `/readyz` restituiscono soltanto codici allowlisted; DSN ed errori grezzi non vengono esposti.
- I timestamp delle decisioni pre-Core sono conservati a sei cifre decimali, avanzano strettamente rispetto al parent e vengono confrontati senza troncare i microsecondi; il readback `as_of` non anticipa più il successore.
- Le funzioni native di merge preview, grafo scalabile, allineamento sicuro dello stato e rivalutazione della closure canonica provenienti dai PR 479–482 sono incluse e verificate contro ancestry mancante, cicli, overflow, conflitti, cross-tenant e receipt drift.

### Policy Registry

- Universal Core: enforcement, proof v3 e compiler provenance deterministico/Core-only richiesti.
- Nyra: attestation richiesta con signer remoto.
- MCP: lifecycle richiesto dopo l'attivazione coordinata dello snapshot.
- Nessuna chiave privata è aggiunta ai blueprint; restano soltanto riferimenti e materiale pubblico.
- Tutti i runtime devono usare lo stesso commit per evitare signer target mismatch.

## Evidenza pre-deploy

- MCP completo dopo integrazione PR 482 e adapter di attivazione ENFORCED: 1.097 test, 1.087 PASS, 0 FAIL, 10 SKIP condizionali.
- Universal Core completo dopo integrazione PR 482, incluso lo smoke test: PASS, exit code 0; il conteggio definitivo viene acquisito dalla CI del commit di rilascio.
- Verifica indipendente mirata: 655 PASS, 0 FAIL; 8 SKIP PostgreSQL perché l'URL d'integrazione non è presente localmente.
- PostgreSQL 16 locale isolato e ripetuto su database pulito dopo PR 482: matrice completa 48/48 PASS, zero skip; include migrazioni Entity360, Policy Registry, Research Airlock, Generic Core Join, ICF e Software Cognition. Un primo tentativo su database riusato ha correttamente evidenziato un nonce Airlock preesistente ed è stato escluso come contaminazione del fixture, non come esito del codice.
- Race pre-Core PostgreSQL: 10/10 ripetizioni PASS; il cut esatto sul timestamp del parent esclude il superseder creato nello stesso millisecondo.
- Entity360/Semantic mirati: 315/315 PASS; benchmark 250/250, p95 1,0085 ms, p99 1,2625 ms.
- PR 479–482, piano software, cascata, status alignment e closure rebind: integrati sulla base `9046a55e` e ricertificati dalle suite complete.
- `BLOCKED_VALID`: 15/15 PASS, incluso evento legacy-only negato e cross-ledger project drift negato.
- MCP compact surface dopo PR 482: 16 tool e payload 65.041 byte, inferiore al limite di 64 KiB (65.536 byte), con 495 byte di margine.
- `git diff --check`: PASS.
- Verificatore indipendente: PASS sul codice, rollout operativo condizionato alle attivazioni governate descritte sotto.

## Sequenza di rollout obbligatoria

1. Commit, push, PR e merge con ticket Universal Core e verifica CI.
2. Distribuzione dello stesso commit su Core MCP, Nyra e Universal Core, rispettando i pin dei signer.
3. Canary PostgreSQL della migrazione Entity360 v2.
4. Attivazione governata Entity360 `ENFORCED` per il tenant operativo autorizzato tramite feature flag tenant con revisione attesa.
5. Attivazione governata di uno snapshot Policy Registry v3 firmato e provenance-bound.
6. Attivazione del lifecycle Policy Registry MCP dopo il readback dello snapshot.
7. Test live completi: Dialogue, read-only, Gallery, paginazione, Work valido/inesistente/finalizzato, checkpoint, concorrenza, Entity360, Semantic Scope, Policy Registry, Research Airlock, Software Cognition e piano a cascata.
8. Chiusura del Work di recovery con verifica indipendente e Core Join.
9. Riconciliazione degli altri Work Gallery solo se le condizioni server-side lo consentono; nessuna chiusura cosmetica.

## Stato del documento

Checkpoint pre-deploy completato. La sezione seguente viene aggiornata con commit, PR, deploy, attivazioni, test live e stato finale della Gallery dopo il rollout governato.

## Evidenza post-deploy

`PENDING_GOVERNED_ROLLOUT`
