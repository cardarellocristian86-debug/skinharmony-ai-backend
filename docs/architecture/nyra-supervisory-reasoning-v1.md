# Nyra Supervisory Reasoning v1

## Stato

La supervisione e implementata nel motore puro e nel runtime governato. Le route
richiedono identita DTT, leggono Native Plan/Atlas/Causal state e persistono
receipt Native Plan e challenge queryable. Non costituisce una decisione
Universal Core e non prova alcuna attivazione production.

## Confine di autorita

Nyra puo:

- confrontare piano, impact graph, obligation e binding;
- produrre claim, hypothesis, risk, confidence e recommended action;
- aprire challenge deterministici;
- valutare un ACCEPT o un REBUT evidence-bound;
- proporre `RELEASE_READY` o `CLOSURE_DENIED`.

Nyra non puo:

- approvare il proprio output;
- verificare il Builder;
- cambiare Genesis Intent o ICF;
- marcare un'obbligazione come verificata;
- autorizzare esecuzione, merge, deploy o closure;
- consolidare learning non verificato;
- modificare policy o pesi del modello.

Le transizioni autoritative restano a Causal Continuity, ICF, Native
Plan/Bind/Report, Generic Core Join e Universal Core.

## Worker Plan Contract

`createWorkerPlanContract` richiede:

```text
goal, hypotheses, assumptions, affected_components, planned_changes,
expected_effects, expected_non_effects, risks, tests, rollback, unknowns
```

Il contratto include tenant/project, plan/work/change ID, actor provenance,
base-state digest, versione e plan digest. Il digest e deterministico e non
include timestamp non semantici.

Il contratto e incorporato sotto `software_contract` nello stesso JSON immutabile
di `core_continuity_native_plans` e partecipa al digest Native Plan. Change,
base-state, versione e supersession sono colonne additive; non esiste una
seconda autorita `agent_plan` parallela.

## Analisi supervisoria

`superviseWorkerPlan` riceve piano, impact, obligations e binding Intent/ICF. I
controlli correnti aprono challenge per:

- scope sottostimato;
- test mancanti;
- rollback mancante;
- assumption senza evidence refs;
- Intent binding mancante;
- ICF binding mancante quando richiesto;
- obligation richieste assenti dai planned changes.

Ogni challenge contiene work/change/plan, tipo, worker claim, supervisor
hypothesis, evidence refs, severity, confidence, status e versione. L'artefatto
reasoning pubblico contiene claim, hypothesis, evidence refs, risk, confidence e
azione raccomandata. Non contiene chain-of-thought privata.

Dependency, architecture, runtime, completion e counterfactual gap sono
espressi come regole deterministiche bounded, con claim, evidenza, rischio e
confidence; nessuna chain-of-thought privata viene persistita.

## Challenge e rebuttal

`resolveSupervisoryChallenge` accetta soltanto challenge `open` e applica CAS su
`expected_version`. Le azioni ammesse sono:

- `ACCEPT`, che porta lo stato ad `accepted`;
- `REBUT`, che richiede almeno un evidence ref e porta a `rebutted`.

Nessuno dei due stati chiude autoritativamente una challenge critica. Per la
closure, una challenge critica e non bloccante soltanto se un percorso Core
successivo la porta a `verified_resolved` o `rejected_by_core`.

Il layer runtime autentica l'attore tramite DTT, risolve i riferimenti contro
evidenze causali indipendenti e fresh, applica CAS in transazione e registra una
resolution append-only. ACCEPT/REBUT da soli non equivalgono a risoluzione Core.

## Reconciliation

`reconcileSoftwareImpact` confronta graph revision prevista con
`actual.base_graph_revision`; una mismatch produce `stale_impact_calculation`.
Genera delta:

```text
UNPLANNED_CHANGE, MISSING_CHANGE, UNEXPECTED_DEPENDENCY,
ARCHITECTURE_DRIFT, INTENT_DRIFT, ICF_DRIFT, TEST_GAP, RUNTIME_GAP
```

Una lista non vuota rende `reconciled=false`. L'Actual Change Graph e accettato
soltanto se una Reality Observation indipendente attesta il digest esatto
dell'oggetto actual; la reconciliation e legata al receipt impact e alla
revision Atlas persistita.

## Closure contract

`evaluateSoftwareClosure` ricalcola COC e richiede:

- Intent binding verificato;
- ICF binding verificato quando richiesto;
- acceptance criteria verificati;
- COC eleggibile;
- nessun challenge critical aperto/non risolto da Core;
- predicted/actual reconciliation;
- architecture constraints, test e runtime verificati;
- runtime evidence fresh;
- rollback verificato;
- verifier indipendente per agent ID e session fingerprint;
- Core Join valido.

Una condizione mancante produce `CLOSURE_DENIED`. Un risultato positivo produce
`RELEASE_READY`, `authoritative_transition_performed=false` e un closure digest.
Questa scelta e intenzionale: solo il Core Join esistente puo effettuare la
transizione.

## State projection proposta

Gli stati software possono essere una projection, senza alterare in modo
incompatibile gli state machine esistenti:

```text
UNDERSTANDING -> MODELING -> IMPACT_ANALYSIS -> PLAN_CHALLENGE
-> READY_TO_EXECUTE -> EXECUTING -> RECONCILING -> VERIFYING
-> OBSERVING -> RELEASE_READY -> VERIFIED_FINAL -> CLOSED
```

Gli stati di errore sono `BLOCKED`, `CONTRADICTED`, `SCOPE_DRIFT`,
`ARCHITECTURE_DRIFT`, `OBLIGATION_GAP`, `REOPENED`. La projection deve essere
derivata da eventi Core; il worker non puo impostarla direttamente.

## Event-driven supervision

`routeSoftwareCognitionEvent` reagisce a diff, plan, completion, runtime,
obligation e challenge, seleziona un contesto Atlas bounded per edge type,
profondita e numero nodi e propone la capability successiva. Il flusso e:

```text
evento verificato -> trigger deterministico -> selezione Atlas bounded
-> reasoning soltanto se rilevante -> challenge/obligation proposal
-> decisione Universal Core
```

Il router e deterministico e non invoca un LLM per ogni evento.
