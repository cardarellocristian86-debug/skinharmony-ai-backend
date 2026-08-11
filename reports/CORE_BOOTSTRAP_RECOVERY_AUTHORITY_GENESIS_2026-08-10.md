# Core Bootstrap / Recovery Authority Genesis

Data: 2026-08-10  
Stato: architettura definitiva post-security  
Provider Genesis attivo: `local_pin`  
Algoritmo: `ECDSA_P256_SHA256_P1363`  
Custodia: `UNATTESTED_LOCAL_SOFTWARE`

## A. Decisione definitiva

La Bootstrap / Recovery Authority risolve esclusivamente deadlock strutturali
nei quali il normale release gate Universal Core non puo rilasciare il codice
necessario a ripristinare il proprio percorso ordinario.

La root attiva e una authority locale PIN separata da Nyra, MCP, Work
Continuity, Universal Core runtime e host worker. La private key rimane cifrata
sul dispositivo owner. Production riceve solo materiale pubblico e provenance.

AWS, GCP, Azure, WebAuthn, TPM, Secure Enclave, PKCS#11, HSM e Vault non sono
percorsi attivi. Restano adapter futuri.

## B. Trust boundaries

| Boundary | Responsabilita | Divieto |
| --- | --- | --- |
| Owner-local signer | Generazione, PIN unlock, exact receipt signature | Nessuna esposizione PIN/private key |
| Offline DB ceremony | Verifica pubblica e installazione Genesis | Nessuna installazione runtime |
| PostgreSQL | Trust, receipts, consumption, outbox, ledger | Nessuna private key |
| Universal Core | Policy, readback, verifica, consumo | Nessuna auto-authority |
| Host worker | Effetto esatto e independent readback | Nessuna emissione receipt |
| Core Join | Attestazione ordinaria post-deploy | Non sostituibile dal bootstrap |

Nyra e gli agenti possono preparare evidenza, ma non possono installare trust,
leggere la chiave, conoscere il PIN, ampliare la policy o produrre Core Join.

## C. Genesis offline e runtime pin-only

Procedura:

1. Inizializzare il signer su loopback.
2. Generare P-256 e cifrare PKCS#8 con AES-256-GCM/scrypt.
3. Esportare solo SPKI pubblico, digest e Genesis record.
4. Eseguire verifica dual-control fuori dal runtime.
5. Applicare la migration PostgreSQL.
6. Usare offline `installTrustKey` con:
   `local_pin`, `ECDSA_P256_SHA256_P1363`,
   `UNATTESTED_LOCAL_SOFTWARE`,
   `provider_attestation_digest=null`.
7. Verificare `bootstrap_trust_key_installed`.
8. Configurare lo stesso pin pubblico e verificare DB/runtime readback.

Il runtime non auto-installa trust. `initialize()` verifica schema convergence;
la risoluzione accetta soltanto il record ACTIVE gia installato e pin-matched.

## D. Custodia e attestation

`local_pin` e software custody, non hardware attestation:

```text
attestation_status=UNATTESTED_LOCAL_SOFTWARE
provider_attestation_digest=null
```

Un digest locale auto-dichiarato non viene presentato come prova. PIN e private
key sono vietati in CLI, env, chat, MCP, database e log.

## E. Single ACTIVE key

Indice autorevole:

```sql
UNIQUE (tenant_id) WHERE status='ACTIVE'
```

Transizioni:

```text
ACTIVE -> RETIRED -> REVOKED
ACTIVE ------------> REVOKED
```

La convergence verifica tabella, unicita, validita, singola key column
`tenant_id` e predicato esatto. Una key ritirata/revocata non viene riattivata.

## F. Structural deadlock policy

La allowlist e posseduta dal codice Core versionato. Env e caller non possono
allargarla. Il normale path deve essere tentato e risultare strutturalmente
impossibile. Classificazione obbligatoria:

```text
BOOTSTRAP_DEADLOCK_VERIFIED
```

Red CI, policy deny ordinario, mismatch PR/SHA, owner confirmation mancante o
normal path disponibile restano deny.

## G. Prepare API e readback

Endpoint:

```text
POST /v1/host-native/bootstrap/release-exceptions/prepare
```

Input esatto:

```text
normal_action_request
owner_confirmation
requested_ttl_seconds
```

Flusso:

```text
tenant/owner auth
-> normal release attempt
-> code-owned deadlock verdict
-> required-check and PR/SHA readback
-> ACTIVE local_pin readback
-> request-bound owner confirmation
-> exact unsigned receipt
```

Output: `prepared_non_authorizing`; action, merge, deploy e Core Join sono
false.

## H. Receipt e firma locale

Il receipt vincola exception, tenant, Work, repository, PR, head SHA,
`github.merge`, `max_uses=1`, TTL massimo 15 minuti, check policy/result,
owner digest, Core verdict digest, rollback/post-deploy obligations, nonce,
authority key/provider e stato iniziale non consumato/non revocato.

L'owner firma il payload canonico domain-separated sul signer loopback. Core
verifica P1363 contro la public key DB-pinned e registra un candidate immutabile
non autorizzante.

## I. Consumo, reservation e recovery

Il consumo usa `SERIALIZABLE`, advisory lock e timestamp DB. Lo stesso commit
scrive:

1. consumption one-shot;
2. outbox `PENDING`;
3. evento hash-chained `bootstrap_exception_consumed`.

Consumption e outbox sono invarianti dello stesso commit e costituiscono la
reservation per l'azione futura, mai una reservation retroattiva.

La same-ticket recovery usa inner `JOIN` fail-closed e `FOR UPDATE` su
consumption, receipt e outbox. Devono coincidere receipt, authority key, scope,
owner/Core/rollback/post-deploy digest, ticket-derived action digest e target
canonico. Il risultato riusa lo stesso record con
`idempotent_recovery=true`, senza nuovo evento o uso. Ogni differenza e replay
deny.

## J. Outbox ed external effect

GitHub non e atomicamente committable con PostgreSQL:

```text
consumption
-> PENDING outbox
-> worker claim
-> exact GitHub merge
-> independent readback
-> EFFECT_OBSERVED / COMPLETED oppure remediation
```

Dopo crash il worker legge l'effetto prima di riprovare.

## K. Core Join separation

Il bootstrap autorizza solo la merge esatta. Non autorizza deploy manuale,
secret change, altra PR/SHA, release manifest o Core Join.

Post-deploy restano obbligatori exact live commit, health Core MCP/Universal
Core, reconciliation, Nyra plan, builder, independent verifier, evidence,
normale Core Join, release manifest e Work checkpoint/closure.

## L. Migration e schema

Migration:

```text
services/universal-core-service/migrations/20260810_bootstrap_authority_registry.sql
```

| Tabella | Ruolo |
| --- | --- |
| `core_bootstrap_trust_keys` | Public trust immutabile |
| `core_bootstrap_trust_key_state` | ACTIVE/RETIRED/REVOKED |
| `core_bootstrap_release_receipts` | Receipt immutabili |
| `core_bootstrap_release_revocations` | Revoche append-only |
| `core_bootstrap_release_consumptions` | Uso one-shot |
| `core_bootstrap_action_outbox` | Recovery effetto |
| `core_bootstrap_events` | Ledger hash-chain |

Schema parziale, indice errato, trigger o constraint mancanti falliscono chiuso.

## M. Environment

Public pin/readback configuration:

```text
CORE_BOOTSTRAP_AUTHORITY_TRUST_BUNDLE_JSON
CORE_HOST_NATIVE_REQUIRED_CHECKS_REGISTRY_JSON
CORE_HOST_NATIVE_RENDER_ORIGIN_REGISTRY_JSON
```

Il trust bundle env e un equality pin verso il DB gia installato. Non installa
trust. Database URL e service credentials restano server-only. Nessuna env puo
contenere PIN/private key o ampliare la structural deadlock policy.

## N. Rotation, revocation e rollback

Rotation:

1. sospendere prepare;
2. chiudere/revocare receipt pendenti;
3. ritirare offline la key ACTIVE;
4. installare la nuova public key;
5. aggiornare il pin;
6. verificare DB/runtime;
7. riabilitare prepare.

Revocation e terminale e auditata. Nessun hard delete. Rollback applicativo non
rimuove migration, trust, consumi, outbox o ledger. Effetti incerti ripartono da
outbox/readback.

## O. Portabilita

Windows TPM/Hello, Secure Enclave, WebAuthn, PKCS#11/HSM, cloud KMS e Company
Node enterprise sono adapter futuri con attestation e rotation proprie. Nessuno
e fallback attivo di `local_pin`.

## P. Test

Risultato finale locale registrato:

```text
Targeted Genesis/security: 86/86 pass
Full Node:                 586 pass, 0 fail, 4 skip
Rust sidecar smoke:        ok=true
PostgreSQL:                16.14
```

Lo smoke e stato eseguito dopo la build del sidecar Rust.

La migration e stata verificata su PostgreSQL 16.14 in tre condizioni:

1. database fresh;
2. seconda applicazione idempotente;
3. schema legacy reale con backfill additive.

Nel caso legacy il digest pubblico `local_pin` e stato preservato, la key
legacy e stata portata a `RETIRED` e il tentativo di riattivazione e stato
negato dalla transizione monotona.

E stato generato il public trust pin locale destinato alla cerimonia Genesis
offline. Non contiene private key, PIN o secret.

### Caveat build Rust locale

`~/.rustup` sulla workstation e un broken symlink. La build e riuscita senza
modificarlo usando:

```text
RUSTUP_HOME=<directory rustup isolata nel worktree>
CARGO_HOME=~/.cargo
```

Questa configurazione e un workaround locale isolato. Non definisce il
toolchain production o CI.

### Stato production

Nessun deploy production e stato eseguito. Nessuna migration e stata applicata
al PostgreSQL production. Il trust pin pubblico esiste soltanto localmente e
non risulta ancora installato/attivato nel runtime production. Ogni effetto
production resta subordinato ai normali gate Core e owner.

## Q. Rischi residui

- Custodia local PIN software, non hardware-attested.
- Compromissione workstation/processo sbloccato puo compromettere la firma.
- Firma owner intenzionalmente manuale.
- Rotation single-ACTIVE richiede quiescenza.
- GitHub/PostgreSQL non condividono una transazione: outbox/readback obbligatori.
- DB administrator privilegiato resta una trust boundary dual-control.
- 86/86 targeted, 586 pass Node e smoke Rust positivo non sostituiscono
  migration/readiness production, exact live commit e normale Core Join
  post-deploy.
- Il trust pin pubblico locale non e ancora un trust record production.

## R. Esito

L'architettura elimina il bootstrap circolare senza introdurre un bypass
generale. La root locale puo autorizzare una sola merge esatta dopo deadlock
strutturale verificato, ma non puo attestare la release. Universal Core conserva
l'autorita ordinaria e Core Join resta il gate finale.
