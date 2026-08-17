# Nyra Software Cognition — Verification v1

## Evidenza corrente

Il test `services/universal-core-service/test/software-cognition.test.js` verifica
il motore puro; `services/skinharmony-core-mcp/test/software-cognition.test.js`
verifica schema e trasporto tenant/DTT. Il test PostgreSQL 16 verifica migration
idempotente, readback, FK composite, tombstone, revision CAS, idempotency e race
di challenge resolution. Deploy e acceptance live restano evidenze separate.

## Matrice unitaria implementata

| Area | Evidenza |
| --- | --- |
| ID | stabilita nello stesso scope e separazione tenant/project |
| Graph | stale revision, foreign node/edge, endpoint mancante |
| Indexer | AST JS/TS, export/call/import/env/route, false positive e tombstone |
| Atlas | singolo writer, reverse traversal, edge filter, revision vector |
| Traceability | provenance e hard-block authority solo per link verified |
| Architecture | assertion observed/inferred/verified e coupling |
| Event routing | contesto bounded e capability advisory |
| Calibration | esclusione outcome non verificati |
| Scenario A | funzione isolata, small impact, unit check |
| Scenario B | API condivisa, test/runtime e obligation API/runtime |
| Scenario C | migration, rollback e runtime obligation |
| Scenario D | scope sottostimato apre challenge critical |
| Scenario E | completion senza runtime evidence negata |
| Scenario F | unplanned change rilevato |
| Scenario G | evidenza contraddittoria riapre COC/closure |
| COC | pesi, categorie e caller coverage ignorata |
| Plan | digest deterministico e timestamp-free |
| Challenge | CAS e rebuttal evidence required |
| Learning | cross-tenant/unverified promotion negata |
| Closure | critical gap, self-verification, same session, challenge, ICF/Intent stale |
| Positive | `RELEASE_READY` resta advisory, nessuna transition |

## Comando locale

```bash
node --test services/universal-core-service/test/software-cognition.test.js
```

Il suite gate completo resta:

```bash
npm test --prefix services/universal-core-service
npm test --prefix services/skinharmony-core-mcp
```

Questi comandi devono essere eseguiti dal repository root con dipendenze gia
installate. Il risultato deve essere registrato come evidence, non descritto a
memoria.

Il test PostgreSQL 16 usa un database isolato:

```bash
SOFTWARE_COGNITION_DATABASE_URL='<postgresql-16-url>' \
  node --test services/universal-core-service/test/software-cognition-postgres16.test.js
```

## Gate di promozione ENFORCED

Le sezioni seguenti sono la checklist di regressione continua e live acceptance,
non funzionalita delegate a una futura autorita parallela.

### Pure-engine hardening

- piu edge dello stesso tipo nello stesso file;
- symbol/edge removal per file modificato e rimosso;
- duplicate node con payload confliggente;
- node ID fornito non coerente col deterministic ID;
- parser false positive in commenti/stringhe/template;
- export, method, call, DB reference e route dinamica;
- traversal consumer/incoming edge;
- max-depth/max-nodes invalidi o eccessivi;
- empty/oversized diff e byte budget;
- traceability state e confidence/provenance.

### Persistence e migration live

- migration additive su PostgreSQL 16 e readback schema;
- rollback migration non distruttivo;
- composite FK tenant/project/node/edge;
- append-only artifacts e challenge resolutions;
- deterministic digest e DB-time boundary;
- restart durability;
- legacy Work Atlas e Native Plan compatibility.

### Negative security

- cross-tenant node reference e edge;
- foreign Work e Change;
- forged evidence e forged diff/commit;
- builder self-verification e reused session;
- replayed challenge resolution/idempotency key;
- stale graph, impact e project state;
- fake completion e missing critical obligation;
- unverified learning promotion;
- plan rewrite after execution;
- context identity mutation;
- ICF bypass e implicit Genesis reinterpretation.

### Concurrency

- concurrent graph updates con una sola CAS winner;
- concurrent obligation expansion senza duplicati;
- duplicate event/outbox retry;
- conflicting plan versions;
- parallel builders denial;
- builder/verifier race;
- stale impact calculation;
- no lost update e no duplicate authoritative transition.

### Route/MCP/Core gate live

- autenticazione e scope per ogni capability;
- schema con `additionalProperties:false`;
- READ/PROPOSE/MUTATE/TRANSITION separation;
- DTT actor provenance;
- Work Atlas bounded select e byte metrics;
- Causal Continuity/ICF/Genesis lookup server-side;
- Native Plan/Bind/Report independent verifier;
- software closure digest nel Core Join material;
- Generic Core Join denial per challenge/COC/reconciliation/runtime gap;
- Gallery/Decision Ledger projection.

## Benchmark richiesti

Misurare su fixture repository realistica:

- durata bootstrap e incremental index;
- graph select latency;
- deterministic impact phase;
- obligation expansion e COC;
- query count per operazione;
- selected bytes, avoided bytes e total bytes;
- comportamento a max nodes/depth/bytes.

Definire soglie nel CI solo dopo una baseline ripetibile; non trasformare una
singola misura locale in policy production.

## Acceptance live

Dopo merge, migration e deploy dell'integrazione completa, eseguire un Work
controllato:

1. positive path fino a release-ready e Core Join;
2. critical obligation mancante, atteso block;
3. worker `completed` senza conseguenza/runtime, atteso false-completion block;
4. diff non pianificato, attesa reconciliation failure;
5. evidenza successiva contraddittoria, atteso reopen.

Registrare exact commit per Universal Core e Core MCP, migration readback,
health/readiness, request/response digests, verifier receipt e rollback proof.
Senza queste evidenze lo stato non e `PRODUCTION VERIFIED`.

## Matrice aggiuntiva V1.1

- rilevamento evidence-first e profili completi per Rust, JS/TS, Python, Go, Java/Kotlin, .NET, Ruby, PHP, Swift e C/C++;
- rifiuto di hint sconosciuti e fonti fuori dai domini ufficiali autorizzati;
- almeno due domini indipendenti in rischio normale e tre in rischio alto/security;
- presenza obbligatoria di fonte primaria e advisory security quando richiesta;
- firma capsula, scope tenant/project/Work, piano, freshness e anti-tamper;
- ricevute complete di compiler/type checker, test, lint/static analysis, manifest e dependency inventory;
- evidenza adapter accettata solo con observation Causal indipendente sul subject digest esatto;
- `ABSTAIN` o `RECOMMEND_BLOCK` senza ricerca/adapter sufficienti;
- `CHALLENGE` con ICF/Intent non verificati e block con security challenge critica;
- decisione pre-Core sempre non autorizzativa e closure bloccata senza evidence V1.1 fresca.
