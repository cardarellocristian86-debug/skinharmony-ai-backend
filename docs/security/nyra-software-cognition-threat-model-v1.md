# Threat Model — Nyra Software Cognition v1

## Stato e trust boundary

La V1 attraversa MCP, Universal Core e PostgreSQL. Tenant e attore derivano da
auth e DTT receipt; Work/Change sono verificati contro Causal Continuity. La
closure ignora booleani di completamento e rilegge lo stato autoritativo in una
transazione repeatable-read. Commit, diff e actual graph sono accettati nel path
governato soltanto con Reality Observation indipendente, fresca e legata al
digest esatto del subject.

## Asset protetti

- Genesis Intent, Intent Revision e ICF digest;
- identita tenant/project/Work/Change;
- graph revision, nodi, edge e provenance;
- piani, claim, assumption e challenge;
- obligation, evidence contracts e coverage;
- osservazioni runtime e reconciliation;
- verifier independence e Core Join;
- event ledger, outbox e learning verificato.

## Attori e autorita

- Il Builder propone piano, cambiamenti e prove; non certifica se stesso.
- Il Verifier produce evidenza indipendente e work-bound.
- Nyra produce reasoning/challenge advisory.
- Universal Core verifica identita, policy, freshness, replay e transizioni.
- Owner authority resta richiesta dove previsto dalle policy esistenti.

## Minacce principali e controlli correnti

### Cross-tenant o cross-project graph injection

`validateGraphMutation` rifiuta tenant/project espliciti discordanti e edge con
endpoint sconosciuti. Gli ID deterministici includono tenant e project.

Un `node_id` caller-supplied deve coincidere con la derivazione server-side da
tenant, project, kind e source ref. Le FK composite impediscono inoltre edge
cross-tenant/project/Work a livello DB.

### Stale write e lost update

Graph mutation riusa il lock Work Atlas, revision CAS e idempotency durable.
Challenge resolution serializza sul challenge ID e ammette una sola risoluzione.

### Forged repository evidence

L'indexer normalizza `changed_files`, base/head commit e contenuto ricevuti dal
trusted adapter MCP. Universal Core autorizza la mutation soltanto se una
Reality Observation indipendente e fresh contiene lo stesso `subject_digest`;
un payload differente non puo riusare l'evidenza.

### Forged completion e caller-supplied coverage

La closure ignora i campi `completion` e `coverage` del chiamante e ricalcola la
COC. Mancanze critical/blocking, runtime stale, reconciliation incompleta o
Core Join invalido bloccano.

Il runtime carica obligation/challenge/evidence dal DB in uno snapshot; la
funzione pura resta intenzionalmente priva di confine di sicurezza.

### Builder self-verification

La closure deriva Builder e Verifier dalle righe Native Plan/Bind/Report e
rifiuta stesso agent ID o session fingerprint. Identita nel body non hanno
autorita.

### Rebuttal senza evidenza e replay

REBUT richiede evidence refs e versione corretta; in closure i riferimenti sono
risolti solo contro Reality Observations indipendenti dello stesso Work. La
risoluzione e append-only, serializzata e atomica con l'evento Work Continuity.

### ICF o Intent bypass

Binding mancanti/stale bloccano closure. Il runtime ottiene ID/digest da Causal
Continuity e richiede un ICF seal `ALLOW_CLOSE` non development. Un purpose
change non muta Genesis e richiede l'autorita Core prevista.

### Unverified learning promotion

La route learning ignora attestazioni di outcome del chiamante e richiede una
Reality Observation indipendente legata a un'obbligazione causale verificata
dello stesso tenant/project/Work. Restituisce sempre
`policy_mutation_authorized=false` e `model_weight_mutation_authorized=false`.
La consolidazione deve riusare Decision Ledger/adaptive learning governato.

### Resource exhaustion

Impact e Atlas selection applicano massimi server-side a depth, nodes, bytes ed
edge types. Gli schemi MCP limitano file, node, edge, stringhe e payload.

### Parser confusion

Il TypeScript Compiler API evita i false positive lessicali in commenti e
stringhe, ma una passata syntax-only non risolve semantica dinamica o moduli. I
risultati restano `observed` o `inferred_candidate`, mai `verified` senza prova.

## Controlli richiesti prima di promuovere ENFORCED in production

- autenticazione Core e scope separati READ/PROPOSE/MUTATE/TRANSITION;
- DTT identity e foreign Work/Change rejection;
- prova PostgreSQL 16 delle composite FK e delle race;
- causal event ledger/outbox atomico;
- commit/diff subject attestation tramite Reality Observation indipendente;
- plan append-only/supersession, nessun rewrite post execution;
- stale project state e stale graph rejection;
- anti-replay challenge resolution;
- bounded input/query selection;
- audit senza secret o raw chain-of-thought;
- negative test e Postgres concurrency test.

## Fail-closed conditions

Sono blocker: impossibilita di provare tenant isolation, source commit, ICF/Intent
binding, independent verification, obligation coverage, runtime freshness,
rollback o Core Join. In questi casi il sistema deve restare OFF/SHADOW o
restituire `CLOSURE_DENIED`; non deve degradare silenziosamente ad allow.
