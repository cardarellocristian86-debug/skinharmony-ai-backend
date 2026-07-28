# Work Continuity Runtime — piano e rollback

## Componenti riusati

- Universal Core: autenticazione tenant, `work_preflight`, audit e gate.
- Dynamic Task Tree: rami e verifiche proposal-only.
- Generic Agent checkpoint/handoff: pattern di persistenza, idempotenza e isolamento.
- Nyra: interpretazione e ricostruzione del contesto; non diventa autorità.

## File introdotti

- `src/workContinuityRuntime.js`: identità, mappa/impact, DTT snapshot, ledger, capsule, resume, drift e memoria verificata.
- `test/work-continuity-runtime.test.js`: persistenza, idempotenza, tenant isolation, drift e gate memoria.
- `src/app.js`: API Core tenant-scoped sotto `/v1/work-continuity`.

## Rollback

La modifica è isolata: rimuovere i sei endpoint e l'istanza `workContinuity` da `src/app.js`, quindi rimuovere il runtime e il test. Nessun dato esistente viene migrato o riscritto; i record nuovi restano sotto la radice separata `work-continuity`.

## Gate

- `READ_DECISION` per lettura/ripresa; `WRITE_DECISION` per creare, eventi, checkpoint e memoria.
- Ogni identità è tenant-bound; l'accesso cross-tenant fallisce.
- Resume richiede capsule integra e segnala `revalidation_required`; non autorizza esecuzione.
- Memoria solo con test positivo e Supervisor approval.
