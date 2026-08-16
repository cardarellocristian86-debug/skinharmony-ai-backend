# Nyra Software Cognitive Twin v1

## Stato del documento

Questo documento descrive la V1 implementata: motore deterministico, estensione
additiva del Work Atlas, receipt Native Plan, route Universal Core, trasporto MCP, ramo semantico Nyra
e gate software del Generic Core Join quando `SOFTWARE_COGNITION_MODE=ENFORCED`.
La closure rilegge in uno snapshot repeatable-read Work/Change, Intent, obblighi,
evidenze causali, ICF e artefatti software. Questo documento non attesta ancora
merge, deploy o verifica live: tali stati richiedono evidenza esterna separata.

## Scopo

Il Nyra Software Cognitive Twin (NSCT) rappresenta una vista strutturata e
bounded del software per supportare:

- indicizzazione incrementale di file JavaScript/TypeScript cambiati;
- identificatori deterministici tenant/project scoped;
- grafo di nodi ed edge software;
- previsione dell'impatto di una modifica;
- espansione delle obbligazioni causali;
- confronto tra impatto previsto e cambiamento effettivo;
- gating fail-closed della chiusura software.

NSCT non e un IDE, un vector database, un nuovo CI o un nuovo sistema di
monitoring. Non registra chain-of-thought. Gli artefatti trattati sono piani,
dipendenze, evidenze, obbligazioni, osservazioni e challenge espliciti.

## Primitive implementate

Il modulo esporta:

- `SOFTWARE_NODE_KINDS` e `SOFTWARE_EDGE_TYPES`, gli allowlist del grafo;
- `softwareDigest`, digest SHA-256 su JSON con chiavi ordinate;
- `deterministicSoftwareId`, ID derivato da tenant, project, kind e source ref;
- `validateGraphMutation`, validazione di scope, revision CAS ed endpoint;
- `indexSoftwareDiff`, estrazione incrementale da una lista di file cambiati;
- `analyzeJavaScriptTypeScript`, analisi syntax-only tramite TypeScript Compiler API;
- `predictSoftwareImpact`, espansione bounded del grafo;
- `expandSoftwareObligations`, creazione deterministica di obbligazioni;
- `calculateCausalObligationCoverage`, COC pesata e per categoria;
- `createWorkerPlanContract`, contratto piano con digest deterministico;
- `reconcileSoftwareImpact`, confronto predicted/actual;
- `validateLearningPromotion`, gate per learning verificato;
- `buildRequirementTraceability`, `recoverSoftwareArchitecture`,
  `routeSoftwareCognitionEvent` e `calibrateSoftwareSupervision`;
- `evaluateSoftwareClosure`, valutazione advisory di release readiness.

## Modello del grafo

I kind e gli edge supportati corrispondono agli allowlist esportati dal modulo.
Ogni nodo validato contiene almeno:

```text
tenant_id, project_id, node_id, kind, source_ref,
source_kind, provenance, payload, version, tombstoned, digest
```

Ogni edge validato contiene almeno:

```text
tenant_id, project_id, edge_id, edge_type,
from_node_id, to_node_id, provenance, digest
```

L'ID deterministico e riusabile soltanto nello stesso tenant, progetto, kind e
source reference. I path sono normalizzati da backslash a slash. Il digest non
include timestamp impliciti.

`validateGraphMutation` applica optimistic concurrency: `expected_revision`
deve coincidere con la revision corrente persistita. Una
revision stale produce `stale_graph_revision`. Nodi/edge che dichiarano tenant o
project diversi sono rifiutati; gli edge sono ammessi solo se entrambi gli
endpoint sono presenti nella mutation o nell'insieme trusted degli ID esistenti.

## Indicizzazione incrementale

`indexSoftwareDiff` riceve repository, base commit, head commit, graph revision e
`changed_files`. Il mutation path lo accetta soltanto quando una Reality
Observation indipendente e fresca attesta il digest esatto di repository,
commit e diff. Per i file non rimossi produce nodi file e, con una passata
syntax-only bounded del TypeScript Compiler API 6.0.3, rileva:

- classi, metodi, funzioni, tipi, costanti ed export;
- import ES, re-export, `require` e call site osservabili sintatticamente;
- riferimenti `process.env`;
- binding Express `app/router.get|post|put|patch|delete`;
- classificazione di migration, test e configurazione dal path.

I file modificati o rimossi invalidano deterministicamente nodi source-owned ed
edge obsoleti; le projection Atlas usano tombstone, non cancellazioni fisiche.
L'output contiene revision successiva, nodi/edge aggiunti, tombstone,
`edges_removed`, affected seeds e source digest. L'analisi non esegue codice e
non effettua module resolution: le relazioni dinamiche restano
`inferred_candidate` fino a evidenza indipendente.

## Impact e obligation

`predictSoftwareImpact` parte da seed espliciti ed espande consumer e dipendenze
su edge entranti e uscenti fino
a `max_depth` e `max_nodes`. Produce impatti diretti/transitivi, flag API, schema,
configuration, security, test, deployment, runtime, intent/ICF e architecture,
insieme a check richiesti, rischio, blast radius, unknowns e confidence.

L'espansione e deterministica e bounded; le inferenze non verificate mantengono
confidence e provenance esplicite. Gli schemi MCP applicano ceiling a file,
nodi, edge, tipi di edge, profondita e byte.

`expandSoftwareObligations` crea sempre implementation, test e rollback. Aggiunge
obbligazioni API, migration, configuration, security, deployment e runtime in
base all'impatto. Gli ID sono deterministici; la funzione non persiste ne
autorizza le obbligazioni.

La Causal Obligation Coverage pesa advisory 0.25, normal 1, required 3 e critical
8. `critical_missing > 0`, `blocking_missing > 0` o una contraddizione rendono
`closure_eligible=false`. I valori sono ricalcolati dagli oggetti passati alla
funzione; diventano autoritativi solo quando gli oggetti provengono dal Core
store verificato.

## Integrazione con le primitive esistenti

La direzione architetturale e estendere, non sostituire:

- Work Atlas e lo SRG autoritativo: la migration estende
  `core_continuity_atlas_{state,nodes,edges}` e aggiunge soltanto history Atlas;
  non esistono tabelle parallele `core_software_nodes/edges/graph_revisions`;
- `core_projects`, Genesis Intent, Intent Revision, Work e Change restano in
  Causal Continuity;
- `core_causal_obligations`, Evidence Contracts e Reality Observations restano
  le entita autoritative;
- Native Plan/Bind/Report resta il piano e la separazione builder/verifier;
- ICF resta l'autorita per covenant e constraint;
- Generic Core Join e Universal Core restano l'unica autorita di transizione;
- Decision Ledger resta il ledger di decisione/telemetria;
- gli strumenti software binari/Ghidra/Frida restano fonti di evidenza, non un
  graph store alternativo.

## Persistenza e API: stato corrente

La migration `20260815_software_cognition_v1.sql` estende Atlas e Native Plan,
crea history Atlas append-only e le sole projection queryable challenge con
resolution append-only. Gli edge hanno FK composite su entrambi gli endpoint
nello stesso tenant/project/Work. Graph update riusa l'unico writer Atlas con
lock, revision CAS, idempotency ed evento `atlas_updated` atomico. Gli artefatti
software sono receipt del Native Plan; il software plan e lo stesso record
Native Plan. Diciotto route Universal Core richiedono auth e DTT receipt, e
diciotto tool MCP derivano il tenant soltanto dall'identita autenticata.

Il rollout predefinito resta `OFF` e non registra le route NSCT; valori rollout
non riconosciuti falliscono chiusi. `ADVISORY` produce artefatti senza transizione;
`ENFORCED` richiede una closure `RELEASE_READY` fresca sia nel Native sia nel
Generic Core Join e rivalida Atlas, Intent, ICF seal, obblighi, evidenze,
challenge e receipt in uno snapshot corrente. La rivalidazione e l'emissione
avvengono sotto lo stesso lock di autorita: il Native Join firma il
`software_closure_digest` nel claim/verdict v2; il Generic Join richiede lo
stesso digest in `evidence_digests`, quindi il relativo digest aggregato e il
receipt del verificatore indipendente lo vincolano nel verdetto firmato. Prima
di restituire il verdetto, Core confronta inoltre `issued_at` e il clock
PostgreSQL post-emissione con `evidence_fresh_until`.
Ogni consumer autoritativo ripete lo stesso controllo: Work Automation e il
ciclo dei release action ticket rifiutano quindi verdict v1 o ticket emessi
prima della promozione a `ENFORCED`, inclusi reserve, complete, reconcile e
finalize.

## Vincoli operativi

Il parser e syntax-only e non trasforma costrutti dinamici in fatti verificati.
Diff, actual graph, runtime e learning richiedono Reality Observation
indipendenti, fresh e subject-bound. La migration e stata provata su PostgreSQL
16 isolato; merge, deploy e live acceptance restano stati esterni separati.
