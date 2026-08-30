# Runbook — Entity 360 rollout e rollback v1

## Stato e regola di verità

La candidata è collegata al Work canonico `Entità 360`, Work Identity
`91e82640-9edc-5424-a3e8-eb7853b0d8dd`.

Questo runbook non attesta commit, push, PR, merge, deploy, migration o stato
live. Il Blueprint che richiede `CORE_ENTITY360_MODE=SHADOW` descrive il target,
non prova che sia stato distribuito. V1 è shadow-only, non è un global readiness
gate, non modifica decisioni production e non autorizza execution.

## Authority e release gate

Ogni commit, push, PR, ready-for-review, merge, deploy o rollback richiede
l'exact bounded Universal Core ticket previsto per l'azione e tutte le approval
del host. Il ticket deve essere riservato prima e completato/reconciled soltanto
da evidence del connector. Test verdi, chat approval o worker report non sono
deleghe.

Stop fail-closed se manca una capability governata. Non usare GitHub, Render o
SQL diretto per aggirare Core.

La release SHADOW non è chiusa senza:

- test/acceptance evidence e verifier distinto dal builder;
- exact Core closure/release receipts;
- exact live commit di Universal Core e Core MCP;
- PostgreSQL 16 migration/readback;
- automatic Work-preflight shadow observation evidence;
- health/readiness e rollback proof.

## Configurazione e secret

Il runtime accetta soltanto:

```text
CORE_ENTITY360_MODE=OFF
CORE_ENTITY360_MODE=SHADOW
```

Default: `OFF`. Un altro valore è invalid e non abilita le route.

`CORE_HOST_NATIVE_SIGNING_SECRET` è obbligatorio in SHADOW, deve avere almeno 32
byte e deve essere fornito dal secret store del servizio. Non stamparlo, non
inserirlo in test output e non copiarlo tra ambienti. Esso alimenta il dominio
HMAC-SHA-256 host-native per tre purpose separati:

- `entity360-qualified-context-v1`;
- `entity360-current-path-observation-v1`;
- `entity360-shadow-comparison-v1`.

Una signature valida per un purpose non deve verificare negli altri. Lo Store
riceve solo una capability `verify`; una configurazione Store che espone `sign`
è invalida.

Ogni attestazione persiste l'exact `key_id`. Se
`CORE_HOST_NATIVE_SIGNING_KEY_ID` non è configurato, il runtime deriva un
identificatore non segreto e stabile dal secret attivo. Il materiale delle
chiavi precedenti deve essere conservato, per la retention degli snapshot, nel
secret owner-custodied `CORE_ENTITY360_HOST_NATIVE_VERIFY_KEYRING_JSON`, oggetto
JSON bounded `key_id -> old secret` (massimo 32 chiavi). Non stamparlo e non
inserirlo nel Blueprint come valore. Array, primitive JSON e oggetti non-plain
sono configurazioni invalide e devono lasciare Entity 360
`signer_unavailable` prima del merge con la chiave attiva.

Rotazione governata:

1. leggere i `key_id` ancora referenziati dagli snapshot/receipt in retention;
2. aggiungere il secret attivo corrente al keyring retained con il suo exact
   `key_id` prima di cambiarlo;
3. validare in shadow la verifica di snapshot old-key e new-key, più unknown-key
   e cross-purpose negative;
4. ruotare il signer; le nuove write usano solo la chiave attiva;
5. eseguire readback storico e rollback al signer precedente se una prova non
   verifica.

Keyring assente durante una rotazione, key id sconosciuto o collisione tra
active key e retained material sono stop condition. Nessuna chiave può essere
rimossa finché esistono snapshot/receipt in retention che la referenziano.

## Tenant feature flag e kill switch

`CORE_ENTITY360_MODE` è il ceiling di processo e `OFF` è il kill switch globale.
Con ceiling SHADOW, la row tenant `flag_id=entity360` funziona così:

- row assente: `OFF`, nessuna retrieval o write shadow;
- `mode=SHADOW`, `enabled=true`: assembly permesso, con exact policy pin;
- `mode=OFF`, `enabled=false`: assembly negato;
- altre combinazioni: fail-closed.

Il gate è applicato prima di resolver, source discovery e observer automatico:
row assente/OFF deve produrre zero letture adapter e zero write shadow.

Una row SHADOW deve avere il `policy_digest` del compiled policy. Mismatch:
`entity360_tenant_policy_binding_mismatch`.

La scrittura esiste, ma non è pubblicata in MCP. Usare esclusivamente la route
Core `/v1/entity-360/admin/feature-flag` con identity server-owned:

```text
actor_role=universal_core_operator
actor_provenance=universal_core_platform_auth
authority_scope=[entity360:feature-flag:write]
```

Il body governato contiene solo `mode`, `enabled`, `config`,
`expected_revision` e `idempotency_key`. Non inviare `flag_id`, `policy_digest`
o `enforcement_authority_digest`: il server li lega e rifiuta il caller
override. DTT non conferisce mai authority di configurazione.

Rollback tenant-scoped: `OFF` + `enabled=false`, exact revision CAS e nuova
idempotency key. Se l'identity Core operator o la route non sono disponibili,
usare il kill switch globale tramite deploy governato e registrare il gap; non
modificare la tabella manualmente.

## Prerequisiti

- Work Identity canonica e tenant verificati in Tenant Work Gallery;
- canonical Work UUID o exact registered legacy UUID, mai alias;
- base/head/tree e target service registrati senza drift;
- ADR, architecture model, threat model e test matrix revisionati;
- policy/ontology compilabili e historical definitions append-only;
- signer host-native attivo e retained verification keyring secret-custodied;
- PostgreSQL condiviso e isolated PostgreSQL 16 CI gate;
- Core auth, DTT issuer/verifier e exact Work binding configurati;
- migration registry e bounded advisory lock funzionanti;
- test kernel/adapter/store/route/MCP/shadow/negative verdi;
- verifier indipendente con finding risolti o dissent visibile;
- exact Core ticket per ogni azione esterna.

## Verifica della candidata

Dal repository root:

```bash
node --test \
  services/universal-core-service/test/entity360.test.js \
  services/universal-core-service/test/entity360-adapters.test.js \
  services/universal-core-service/test/entity360-app.test.js \
  services/universal-core-service/test/entity360-routes.test.js \
  services/universal-core-service/test/entity360-shadow-observation.test.js \
  services/universal-core-service/test/entity360-store.test.js

node --test services/skinharmony-core-mcp/test/entity-360.test.js
npm run benchmark:entity360 --prefix services/universal-core-service

npm test --prefix services/universal-core-service
npm test --prefix services/skinharmony-core-mcp
```

PostgreSQL 16 isolato:

```bash
ENTITY360_DATABASE_URL='<isolated-postgresql-16-url>' \
  node --test services/universal-core-service/test/entity360-postgres16.test.js
```

Senza `ENTITY360_DATABASE_URL` il test è skipped e non prova migration,
tenant-isolation, CAS, trusted DB time o append-only. Nei receipt conservare
command, exit code, test count, duration, commit/tree e digest redatti; mai URL o
credential.

## Migration preflight

Migration `20260825_001_entity360_v1` è additive, registry-governed e applicata
da `initialize()` in SHADOW. Il readback deve provare:

- otto tabelle `core_entity360_*`;
- exact migration SQL digest e stato `COMPLETED`/`READBACK_VERIFIED`;
- append-only `UPDATE`/`DELETE` e statement-level `TRUNCATE` guard;
- tenant/entity composite keys e receipt/snapshot bindings;
- entity-head exact next-version CAS e predecessor chain;
- feature flag revision/policy binding;
- idempotency exact-request binding;
- non-destructive backfill constraint/checkpoint/events;
- Store trusted database verification/persistence time.
- exact catalog manifest di colonne/default/nullability, constraint, FK verso
  lo schema locale, indici, trigger e funzioni trigger locali;
- verifier pubblico terminale: solo `COMPLETED`/`READBACK_VERIFIED`.

Una row migration `APPLYING`/`FAILED`, digest drift, trigger/FK mancante o
readback timeout è stop condition. Non marcare `COMPLETED` manualmente e non
eseguire la down migration.

## Rollout

### 1. Pre-release OFF

- provare `CORE_ENTITY360_MODE=OFF` come default/kill switch;
- confermare current decision path invariato;
- health Entity 360 disabled e non required;
- verificare exact release e rollback targets;
- ottenere ticket/approval per ogni azione.

### 2. Staging SHADOW

- configurare process mode SHADOW e host-native signing secret sul target;
- applicare/readback migration PostgreSQL 16;
- verificare `/livez`, `/readyz`, `/healthz` e exact build commit;
- abilitare un tenant solo con la route Core operator e exact policy pin;
- smoke-test Work 360 e Software/Component 360;
- eseguire un vero `/v1/work/preflight` Work-bound e leggere il receipt automatico;
- verificare rollback SHADOW -> OFF senza cancellare evidence.

Exit: tenant isolation, signer purpose separation, Store verify-only, restart
durability, automatic comparison and rollback evidence.

### 3. Production SHADOW

V1 può arrivare solo a SHADOW. Il live readback deve continuare a mostrare:

```text
current_path_authoritative=true
production_required=false
global_readiness_gate=false
production_decision_mutation=false
execution_authorized=false
```

Non promuovere ad ADVISORY/ENFORCED. Un enforcement futuro richiede nuova major
architecture/policy, threat model, test, rollout e Universal Core release gate.

## Live readback

### Universal Core

Verificare `/livez`, `/readyz` e `/healthz` sull'exact authorized origin. In
`healthz.entity_360` devono comparire almeno:

- `configured=true`, `state=ready`, `mode=SHADOW`, `ok=true`, `ready=true`;
- policy/ontology version e digest attesi;
- canonicalization/snapshot/adapter versions;
- PostgreSQL append-only backend e migration `READBACK_VERIFIED`;
- `qualification_attestation_required=true`;
- `core_independent_verification_required=true`;
- `shadow_non_mutating=true`;
- non-authority/global-gate marker sopra elencati.

Il `build_commit_sha` deve coincidere con l'exact merged/deployed release
commit. Health su un commit diverso produce `HOLD`.

### Core MCP

Il catalog deve esporre esattamente otto tool Entity 360 (la config flag non è
MCP). Verificare schema strict tenant-free, top-level Work UUID, Work-bound DTT,
tenant stripping e recursive response authority guard.

Errori MCP attesi e machine-readable:

| Failure | Code |
| --- | --- |
| agent presence assente | `agent_presence_session_required` |
| Work UUID assente/malformato | `entity360_dtt_work_id_required` |
| Work mismatch | `entity360_dtt_work_binding_mismatch` |
| identity Work obbligatoria assente | `entity360_dtt_work_identity_required` |
| DTT receipt non emesso | `dtt_agent_identity_not_ready` |
| authority marker upstream | `entity360_authority_boundary_violation` |
| response cycle | `entity360_response_cycle_invalid` |
| response scan overflow | `entity360_response_boundary_scan_exceeded` |

Un Core error valido resta exact, ad esempio
`entity360_entity_resolution_ambiguous` HTTP 409; dettagli interni non bounded
diventano `entity360_request_failed`.

## Smoke test governato

Per il Work canonico nel suo tenant autenticato:

1. `entity_360_resolve` con top-level
   `work_id=91e82640-9edc-5424-a3e8-eb7853b0d8dd`, `entity_type=work` e
   `identity.work_id` uguale;
2. richiedere un solo `RESOLVED`; fermarsi su `AMBIGUOUS`/`UNRESOLVED`;
3. assemblare con exact expected revision, `as_of` e idempotency key;
4. leggere exact version/digest e verificare snapshot;
5. ripetere exact caller request e provare replay pre-assembly dello stesso
   persisted envelope;
6. chiamare `/v1/work/preflight` con Gallery context contenente esattamente il
   Work canonico;
7. leggere automatic observation/snapshot/comparison receipt e verificarne le
   attestazioni purpose-separated;
8. provare che il preflight response/current outcome non è cambiato;
9. leggere metrics, inclusi verified vs unverified comparisons;
10. riavviare in staging e rileggere snapshot/receipt.

Ripetere una resolution con l'exact legacy Work UUID se presente: deve arrivare
alla stessa persistent canonical identity, non crearne una nuova.

Verificare separatamente i namespace project: slug Gallery/Continuity e UUID
Continuity/causal graph. Non confrontare slug con UUID. Un slug conflict rende
`project_id=null`; un UUID mismatch rende il causal binding non-authoritative.

Per ICF mancante/digest invalido aspettarsi `ICF_BINDING_MISSING` o
`ICF_EVENT_DIGEST_MISMATCH`, mai un digest sintetico. Un head legacy privo dei
metadata canonical v2 deve produrre
`ICF_EVENT_DIGEST_CONTRACT_LEGACY_REANCHOR_REQUIRED`: non ricostruire il digest
da `jsonb` e non riscrivere eventi. Applicare la migration additive
`20260825_002_icf_event_digest_v2.sql`, poi aggiungere un evento forward-only
`DIGEST_CONTRACT_REANCHORED` con payload
`nyra.icf.event-digest-reanchor/2.0`, `previous_digest` uguale all'head legacy e
`previous_digest_contract=nyra.icf.event-digest/json-stringify-v1`. Solo il
nuovo head canonical v2 ricalcolabile è ammissibile; la storia legacy resta
immutata e auditabile. Per Component Atlas,
history futura/mancante o node digest invalido deve produrre gap/rejection, mai
evidence ricostruita localmente.

## Shadow evidence

Il percorso automatico è l'unico confronto release-grade v1:

- observation producer `universal_core_work_preflight`;
- exact tenant/canonical Gallery Work/preflight binding;
- purpose `entity360-current-path-observation-v1`;
- comparison purpose `entity360-shadow-comparison-v1`;
- `comparison_evidence_state=VERIFIED_UNIVERSAL_CORE_CURRENT_PATH_OBSERVATION`;
- `release_evidence_eligible=true` soltanto con
  `release_evidence_scope=SHADOW_EVALUATION_ONLY`;
- `enforcement_evidence_eligible=false` e `authorization_effect=NONE`.

`entity_360_shadow_compare` è manuale/diagnostico. Il caller digest/outcome non
diventa trusted perché il receipt è firmato: deve restare
`UNVERIFIED_CALLER_OBSERVATION`, non-release e fuori dalle correlation metric
release-grade.

L'observer automatico è best-effort asincrono. Il completamento/fallimento deve
apparire in audit. Una failure non deve ritardare o mutare la current preflight
response, ma è una gap di shadow evidence da investigare.

Il pre-gate usa singleflight per tenant, cache negativa OFF/assente, backstop
globale e `gate_timeout_ms` definiti nella policy. Monitorare timeout e backstop:
la risposta applicativa scade fail-closed, ma il probe sorgente resta conteggiato
e singleflight fino al suo completamento. Il read PostgreSQL applica lo stesso
limite come `statement_timeout`, così un probe bloccato non libera capacità per
avviare query duplicate.

## Observability

Monitorare per tenant/finestra:

- assembly latency, source count/occupancy/diversity;
- corroboration coverage;
- rejected/limited contributions e reason codes;
- completeness, stale, contradiction e missing-context count;
- resolver attempt/ambiguity count, ambiguity rate bounded e snapshot rebuild;
- verified/unverified comparison count e divergence;
- Core HOLD/INSUFFICIENT_CONTEXT total, correlated total e rate soltanto da
  verified observation;
- automatic observer completion/failure audit;
- Store/CAS/migration errors.

Non derivare threshold di enforcement da una singola misura o da un manual
comparison.

## Stop e rollback signals

Portare a `OFF` se si osserva:

- cross-tenant, cross-Work o identity collision;
- canonical/legacy Work non exact o continuity-only candidate;
- slug/UUID project namespace conflation;
- caller evidence/authority accepted;
- invalid source digest trasformato in contribution;
- ICF/Atlas synthetic digest fallback;
- poisoning, flooding o source concentration non bounded;
- mandatory fact displaced da self-declared advisory criticality;
- stale/superseded claim promosso current o contradiction nascosta;
- qualification signature missing/wrong-purpose/tampered/replayed accettata;
- Store configurato con signing capability;
- forged/re-digested READY accettato;
- più CAS winner, chain broken o append-only mutation/TRUNCATE;
- manual comparison conteggiato come release evidence;
- automatic observer che muta/blocka current path;
- SHADOW flag senza exact policy pin o configurato via DTT/MCP;
- live commit, migration, health o rollback mismatch.

## Rollback applicativo

1. Ottenere exact Core rollback ticket e host approval.
2. Per tenant rollback, usare la Core operator route con `OFF`,
   `enabled=false`, exact expected revision e idempotency.
3. Per rollback globale, distribuire/restartare con
   `CORE_ENTITY360_MODE=OFF` tramite percorso governato.
4. Readback: tenant assembly negato oppure process Entity 360 disabled/OFF;
   current path e global readiness invariati.
5. Non cancellare registry, snapshot, receipts, idempotency o backfill history.
6. Verificare Causal Continuity, Intent/ICF, DTT, Core Join e MCP health.
7. Reconcile ticket da provider evidence e registra incident/next action nello
   stesso Work.

Il rollback database è forward-only. La down migration è disabilitata e non si
droppano tabelle/evidence. In caso di schema parziale: runtime OFF, blocco nuove
write, catalog readback, migration forward additive e nuovo ticket.

La route tenant `OFF` non dipende dalla readiness del runtime snapshot: deve
restare invocabile quando il runtime costruito entra in
`initialization_failed` o `store_verification_failed`. Il percorso continua a
richiedere Core operator, conferma owner fresca, CAS e idempotenza. Se il
feature-flag Store non è costruibile o non è raggiungibile, il rollback tenant
fallisce chiuso e si usa il rollback globale governato del punto 3.

## Release anchor

Il rilascio E360 è ancorato al merge su `main`
`d181b5a515fb9481e9e0e85f79f42ad7c82bf2bf`, con tree
`2fa228eccdb191bfed93ff2f598fca9d9f3b9fc5`. La CI post-merge è il run GitHub
Actions `33333015717`: `core-mcp`, `deployment-parity`, `universal-core` e
`smartdesk` risultano tutti completati con successo sul commit esatto.

Il readback di produzione dei servizi `skinharmony-universal-core` e
`skinharmony-core-mcp` espone `ok=true`, `render_ready=true` e
`build.commit_sha=d181b5a515fb9481e9e0e85f79f42ad7c82bf2bf`. La valutazione Core
post-merge `6592c880-6e8d-49c6-850d-3dfa7d50ce03` prova l'obiettivo e tutti i
16 criteri di accettazione e ha emesso il Core Join
`hnj_1e6bb40524cd06eb8affef111525b8aec345cbaa`.

Restano invarianti operativi, non gap di release: NSCT è solo advisory,
owner-verified e fail-closed; la retention storica resta responsabilità dei
sistemi owner. I receipt finali e il loro stato corrente sono mantenuti nel
ledger Core e non vengono duplicati in questo documento.
