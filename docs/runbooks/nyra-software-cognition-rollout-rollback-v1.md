# Runbook — Nyra Software Cognition rollout e rollback v1

## Stato corrente

Motore, migration Atlas/Native Plan, route Universal Core, capability MCP,
branch Nyra e gate Core Join sono wired nel branch. Il default operativo resta
**OFF**; nessun merge, deploy o readback live e implicato dal codice locale.

Non dichiarare SHADOW, ADVISORY, ENFORCED o production verification finche non
esiste readback del runtime distribuito.

## Controlli V1.1 pre-Core e ricerca

Prima di abilitare i tool V1.1, Research Airlock deve riportare `ready=true` in
modalita enforced, con store PostgreSQL durevole e chiave di firma. NSCT deve
restare `ADVISORY` durante la prima finestra di osservazione in produzione. La
pre-decisione accetta separatamente soltanto `OFF` o `ADVISORY`:

```text
SOFTWARE_COGNITION_MODE=ADVISORY
NYRA_PRECORE_DECISION_MODE=ADVISORY
```

Un valore sconosciuto disabilita fail-closed il relativo runtime. Non esiste
una modalita pre-Core `ENFORCED`.

Il Blueprint mantiene inizialmente `NYRA_PRECORE_DECISION_MODE=OFF`. Prima di
portarlo ad `ADVISORY`, il percorso di firma Nyra gia esistente deve fornire a
Universal Core, senza creare o copiare chiavi, queste binding operative:

```text
CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_ORIGIN
CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_PATH
CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_SERVICE
CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_TARGET_COMMIT
CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_SERVICE_TOKEN
CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_ED25519_PUBLIC_KEY
CORE_NYRA_POLICY_REGISTRY_NYRA_KEY_ID
CORE_NYRA_PRECORE_VERIFY_KEYRING_JSON
```

Il purpose ammesso deve essere esattamente `nyra.precore.decision.v1`; readiness,
firma di prova e verifica locale della chiave pubblica devono risultare verdi.
Il keyring è un oggetto JSON owner-custodied `key_id -> public PEM/JWK`, separato
dal signer attivo, con massimo 32 chiavi totali inclusa l’attiva e 65.536 byte.
La chiave attiva non deve essere duplicata nel retained set. Array, primitive,
ID duplicati/confliggenti, materiale privato, chiavi non Ed25519 e input oltre i
limiti lasciano NSCT `signer_unavailable`. La rimozione di una chiave retained è
consentita soltanto dopo la scadenza della retention di ogni receipt che la usa.

Smoke test per un Work governato:

1. creare un `software_cognition_research_plan` bounded e verificare che le fonti corrispondano alla tecnologia osservata;
2. usare il flusso Airlock open/discover/seal/private-enter per ogni fonte richiesta;
3. verificare il digest Research Cortex nel piano Airlock, legare la capsula firmata e verificare classi e lineage indipendenti;
4. eseguire in sandbox gli adapter del `technology_profile_v1`, attestare i risultati con evidenza Causal indipendente e invocare `software_cognition_technology_verify`;
5. richiedere `nyra_precore_decision_generate`, poi `read/list/verify`, e verificare firma, sequence/parent/record digest, `authority_scope=ADVISORY_NON_EXECUTABLE` ed `execution_authorized=false`;
6. verificare receipt firmate con chiave attiva e retained, più unknown/removed
   key id, duplicate/conflict/array/oversize negativi;
7. verificare il rifiuto di capsule o ricevute tecniche mancanti, duplicate, scadute, cross-tenant o alterate;
8. verificare che la ricevuta provvisoria non emetta host action, publish, deploy o Core Join.

Il rollback non richiede migration distruttive: impostare
`NYRA_PRECORE_DECISION_MODE=OFF` disabilita la generazione firmata;
`SOFTWARE_COGNITION_MODE=OFF` disabilita tutte le route NSCT. In alternativa,
mantenere `ADVISORY` e sospendere l'invocazione dei tool V1.1. Le ricevute
append-only restano disponibili per audit.

## Prerequisiti

- branch isolato e baseline `origin/main` registrata;
- Work Identity, Genesis/Intent e ICF binding validi;
- schema additive verificato su PostgreSQL 16;
- Atlas e Causal Continuity riusati, senza store paralleli;
- route/MCP autenticati e tenant scoped;
- DTT builder/verifier separation;
- event ledger/outbox e idempotency durable;
- full unit/integration/negative/concurrency suites green;
- rollback provato su staging;
- required checks e exact deploy targets letti server-side.

## Progressione

### OFF

- nessuna chiamata runtime al motore;
- schema non applicato oppure feature flag disabilitata;
- nessun effetto su closure o Core Join.

Exit criteria: schema/API implementati e testati, senza impatto legacy.

### SHADOW

- indicizzazione e calcoli eseguiti su eventi verificati;
- artefatti persistiti come non autoritativi;
- nessun block o cambiamento del verdict Core;
- registrare worker scope vs Nyra scope vs actual scope, obligation e completion.

Monitorare error rate, stale rate, parser false positive, latency, query count,
selected/avoided bytes e mismatch predicted/actual.

Exit criteria: tenant isolation e replay test verdi, nessuna regressione,
calibration evidence sufficiente e rollback testato.

### ADVISORY

- Nyra mostra challenge e COC al worker/verifier;
- Universal Core continua a decidere con i gate legacy autoritativi;
- i nuovi risultati possono richiedere revisione ma non effettuano da soli una
  transizione o un host action;
- critical challenge deve essere visibile e auditata.

ADVISORY e il massimo target sicuro iniziale. Un periodo di osservazione puo
essere richiesto dalla policy prima di ENFORCED.

Exit criteria: acceptance A-G, false-completion negative path, production
readback, verifier indipendente e nessun blocker aperto.

### ENFORCED

- software closure gate e obbligatorio prima del Core Join;
- critical/blocking obligation, challenge critical, stale reconciliation,
  Intent/ICF gap, missing runtime o rollback negano closure;
- il worker non puo fornire coverage o completion autoritativi.
- la promozione invalida al consumo i Core Join v1 e i release action ticket
  privi del binding v2 alla closure software corrente; non esiste un periodo di
  drain in cui authority emessa in ADVISORY possa essere riutilizzata.

Abilitare soltanto tramite policy/version CAS e solo dopo evidenza production.
Non saltare direttamente da OFF a ENFORCED.

## Procedura di rollout

1. Leggere `origin/main`, commit/tree e drift.
2. Verificare migration registry e applicare schema additive.
3. Verificare composite FK, indici, trigger append-only e outbox.
4. Deployare Universal Core/Core MCP con auto-deploy esistente dopo CI verde.
5. Verificare exact commit su ogni servizio, `/livez`, `/healthz`, `/readyz` e
   migration readback.
6. Attivare SHADOW con version CAS.
7. Eseguire scenari A-G e confrontare predicted/actual.
8. Attivare ADVISORY solo dopo evidenza indipendente.
9. Eseguire positive, negative e false-completion live acceptance.
10. Prima di ENFORCED verificare che Core Join v1 e release ticket preesistenti
    vengano negati a issue, reserve, complete, reconcile e finalize.
11. Conservare rollback proof e richiedere Core Join/closure soltanto dopo tutti
    i gate richiesti.

## Segnali di stop/rollback

Rollback immediato del livello di enforcement se si osserva:

- cross-tenant/cross-project visibility;
- graph corruption o lost update;
- closure consentita con obligation critical/blocking mancante;
- self-verification o replay accettato;
- commit/diff non verificato trattato come authority;
- ICF/Genesis bypass;
- regressione latency/error rate che rende Core non disponibile;
- migration state incerto;
- mismatch tra commit atteso e live.

## Rollback applicativo

1. Portare il feature mode a OFF (o SHADOW se la sola lettura e sicura) tramite
   la policy governata, con expected version.
2. Non cancellare graph revision, challenge, obligation, event o evidence.
3. Confermare che il Core Join legacy resta healthy e fail-closed.
4. Se il codice ha causato regressione, usare il normale rollback del servizio
   al precedente exact healthy commit; evitare deploy duplicati.
5. Verificare `/livez`, `/healthz`, `/readyz`, DB connectivity, ICF e Generic
   Core Join sul commit precedente.
6. Registrare failure e lasciare il Work `BLOCKED`, `CONTRADICTED` o `REOPENED`.
7. Applicare un forward fix nel medesimo Work se causalmente nello scope.

## Rollback database

Le migration devono essere additive. Il rollback preferito e disabilitare le
letture/scritture NSCT mantenendo dati e ledger. Drop di tabelle/colonne o
cancellazione di evidenza richiedono un'autorizzazione distinta e non fanno
parte del rollback ordinario.

Se una migration parziale non puo essere provata sicura:

- fermare l'enforcement;
- impedire nuove authoritative transition;
- leggere migration registry e catalog PostgreSQL;
- ripristinare la compatibilita con una migration forward additive;
- non marcare il Work closed.

## Verifica post-rollback

- precedente commit esatto live;
- servizi healthy e ready;
- nessuna nuova closure NSCT;
- Work Atlas/legacy clients ancora leggibili;
- Causal Continuity, ICF, DTT e Generic Core Join integri;
- event/evidence history preservata;
- incident e next action registrati.

Il verdetto finale resta un exact blocker finche la causa non e corretta e
riverificata; non usare `PRODUCTION VERIFIED` per un rollback solamente riuscito.
