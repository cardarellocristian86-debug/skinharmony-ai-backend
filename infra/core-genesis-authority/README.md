# Core Bootstrap / Recovery Authority Genesis

This directory defines the exceptional root-of-trust path used only when the
normal Universal Core release path is structurally deadlocked. The active
Genesis provider is `local_pin` with `ECDSA_P256_SHA256_P1363`.

The local PIN authority is software custody. It is recorded as
`UNATTESTED_LOCAL_SOFTWARE`; it is not a hardware, platform or cloud
attestation. AWS/GCP/Azure KMS, WebAuthn, TPM, Secure Enclave, PKCS#11 and Vault
are future provider adapters, not active Genesis paths.

## Trust boundaries

1. The owner-local signer runs on `127.0.0.1`, holds only an encrypted local
   private key, and receives the PIN only through its local page.
2. The offline database ceremony installs public verifier material and Genesis
   provenance into PostgreSQL.
3. Production resolves and pins an already-installed ACTIVE trust key. Runtime
   startup cannot install, replace or reactivate trust.
4. Universal Core owns structural-deadlock policy, required-check readback,
   receipt verification and atomic consumption.
5. The host worker executes only the outbox action produced by a valid
   consumption and independently verifies the external effect.

Nyra, Codex, MCP, Work Continuity and the production runtime never receive the
PIN, plaintext private key or encrypted private-key file.

## Local PIN custody

The local authority:

- listens only on `127.0.0.1`;
- generates an ECDSA P-256 key locally;
- encrypts PKCS#8 private material with AES-256-GCM;
- derives the encryption key from an owner PIN/passphrase with scrypt;
- never accepts the PIN through arguments, environment, chat, MCP or network;
- signs only exact `bootstrap_release_exception_v1` receipts;
- supports only `github.merge`, `max_uses=1` and a 15-minute maximum TTL;
- stores public metadata and receipt digests, never PIN or plaintext key, in its
  local audit log.

Default owner-local files:

```text
~/.config/nyra-core-genesis/local-pin-authority.json
~/.config/nyra-core-genesis/local-pin-audit.jsonl
```

The authority file contains encrypted private material and must never be
uploaded, committed, pasted into chat or installed in production.

Start it with:

```sh
infra/core-genesis-authority/local-pin/run.sh
```

Then open `http://127.0.0.1:8788` manually. `NYRA_GENESIS_HOME` may select an
owner-controlled encrypted volume and `PORT` may change the loopback port.
Neither variable may contain the PIN.

## Offline Genesis installation

Trust installation is an explicit offline database ceremony, not application
startup behavior.

1. Generate the local key and export only the public trust bundle.
2. Independently verify SPKI and Genesis provenance digests.
3. Authenticate platform owner and security owner outside the governed runtime.
4. Apply the versioned PostgreSQL migration.
5. Invoke the offline `installTrustKey` primitive with:
   `authority_provider=local_pin`,
   `algorithm=ECDSA_P256_SHA256_P1363`,
   `attestation_status=UNATTESTED_LOCAL_SOFTWARE` and
   `provider_attestation_digest=null`.
6. Verify the append-only `bootstrap_trust_key_installed` ledger event.
7. Pin the same public bundle in runtime configuration and verify readback.

The runtime is trust-pin-only. `initialize()` checks schema convergence but
does not install a key. Missing, partial, conflicting or non-ACTIVE trust keeps
bootstrap preparation unavailable.

## Single ACTIVE key and rotation

PostgreSQL enforces one ACTIVE key per tenant with an exact unique partial
index:

```sql
UNIQUE (tenant_id) WHERE status = 'ACTIVE'
```

Transitions are monotonic:

```text
ACTIVE -> RETIRED -> REVOKED
ACTIVE ------------> REVOKED
```

RETIRED and REVOKED keys cannot become ACTIVE again. Rotation is an offline,
quiesced ceremony: stop new preparation, resolve or revoke pending receipts,
retire the old key, install the new public key, update the runtime pin, verify
DB/runtime readback, and resume.

## Code-owned structural-deadlock policy

Bootstrap is denied unless Core first attempts the normal release path and
proves a structural deadlock classified as:

```text
BOOTSTRAP_DEADLOCK_VERIFIED
```

The failure-code allowlist belongs to versioned Core code. Environment and
caller payloads cannot widen it. Red CI, ordinary policy denial, SHA drift,
missing owner confirmation, insufficient security or an available normal path
are not bootstrap deadlocks.

## Prepare API and readback

Owner-scoped endpoint:

```text
POST /v1/host-native/bootstrap/release-exceptions/prepare
```

Exact top-level input:

```text
normal_action_request
owner_confirmation
requested_ttl_seconds
```

Preparation performs:

```text
authenticated tenant/owner
-> normal-path attempt
-> code-owned structural-deadlock classification
-> server-side required-check and PR/SHA readback
-> ACTIVE local_pin trust-key resolution
-> request-bound owner confirmation
-> Core deadlock verdict
-> exact unsigned receipt
```

The result is `prepared_non_authorizing`; action, merge, deploy and Core Join
remain false.

## Exact receipt and local signature

The receipt binds:

```text
exception_id
tenant_id
work_id
repository
pr_number
head_sha
allowed_action=github.merge
max_uses=1
issued_at / expires_at
required_checks_digest
required_checks_results_digest
owner_confirmation_digest
core_policy_verdict_digest
rollback_obligations_digest
post_deploy_obligations_digest
nonce
authority_key_id
authority_provider=local_pin
consumed_at=null
revoked_at=null
```

The owner reviews the exact target and signs the canonical, domain-separated
payload on loopback. Only the P1363 signature assertion returns to Core. Core
verifies it against the DB-pinned public key and stores an immutable,
non-authorizing candidate.

## Consumption, reservation, recovery and outbox

Consumption uses PostgreSQL `SERIALIZABLE` isolation and an advisory lock. One
commit:

- locks receipt, trust state and prior consumption;
- verifies tenant, Work, repository, PR, SHA, action and all policy/check and
  obligation digests;
- denies expired, revoked, mismatched or untrusted receipts;
- inserts the one-use consumption;
- creates its `PENDING` host-action outbox;
- appends the hash-chained `bootstrap_exception_consumed` event.

Consumption and outbox are invariants of the same commit and form the governed
reservation for this exact future action. They never fabricate a reservation
for an effect already observed.

Crash recovery is valid only for the same consumed request. Tenant, exception,
receipt, authority key, ticket-derived action-request digest, complete scope,
owner/Core/rollback/post-deploy digests and canonical outbox target must match.
Core returns the same consumption/outbox with `idempotent_recovery=true`,
without a new use or event. A changed ticket, digest, target or scope is replay
and fails closed.

PostgreSQL cannot atomically commit a GitHub effect. The worker must consume the
outbox, perform independent readback and reconcile an already-observed effect
instead of blindly repeating it.

## Core Join separation and post-deploy obligations

A consumed bootstrap receipt authorizes only its exact `github.merge`. It is
not a Core Join, release manifest, deploy authorization or release attestation.

After normal auto-deploy all obligations remain mandatory:

1. Verify the exact live commit.
2. Verify Core MCP health.
3. Verify Universal Core health.
4. Reconcile governed observed effects.
5. Execute the Nyra native plan.
6. Bind and run the builder, then submit its report.
7. Bind an identity-distinct verifier, then submit report and evidence.
8. Obtain normal Universal Core Join.
9. Produce the normal release manifest.
10. Record Work checkpoint/evidence and close only when every gate passes.

Failure blocks closure and activates existing remediation/rollback policy.

## PostgreSQL migration

Authoritative migration:

```text
services/universal-core-service/migrations/20260810_bootstrap_authority_registry.sql
```

Tables:

```text
core_bootstrap_trust_keys
core_bootstrap_trust_key_state
core_bootstrap_release_receipts
core_bootstrap_release_revocations
core_bootstrap_release_consumptions
core_bootstrap_action_outbox
core_bootstrap_events
```

Trust material and receipts are immutable. Revocations, consumptions and ledger
events are append-only. Startup checks essential columns, nullability,
constraints, triggers and the semantic definition of the ACTIVE-key index.
Partial schema fails closed.

## Environment

Public/non-secret runtime configuration may contain:

```text
CORE_BOOTSTRAP_AUTHORITY_TRUST_BUNDLE_JSON
CORE_HOST_NATIVE_REQUIRED_CHECKS_REGISTRY_JSON
CORE_HOST_NATIVE_RENDER_ORIGIN_REGISTRY_JSON
```

The trust bundle is an equality pin for an offline-installed DB row, not an
installation instruction. Database credentials, owner-context signing material
and host credentials remain server-only. No production environment variable may
contain the Genesis PIN, plaintext key, encrypted authority file or configurable
deadlock-policy expansion.

## Revocation and rollback

Receipt revocation is append-only and blocks an unconsumed receipt. Key
revocation is terminal. There is no hard delete or automatic reactivation.

Application rollback preserves migration records, trust history, consumptions,
outbox and ledger events. Uncertain effects resume from outbox/readback; they do
not create a second receipt use or retroactive reservation.

## Portability

Windows TPM/Hello, Secure Enclave, WebAuthn, PKCS#11/HSM, cloud KMS and
enterprise control planes may implement future adapters with their own verified
attestation and rotation ceremonies. None is an active fallback for
`local_pin`.

## Verification status

Final local verification evidence:

```text
Targeted Genesis/security suite: 86/86 pass
Full Node suite:                 586 pass, 0 fail, 4 skip
Rust sidecar smoke:              ok=true
PostgreSQL:                      16.14
```

The PostgreSQL migration passed against a fresh PostgreSQL 16.14 database and
passed a second idempotent application. A real legacy-schema exercise also
verified the additive backfill path. The legacy `local_pin` public digest was
preserved; the legacy key was moved to `RETIRED`; attempted reactivation was
denied by the monotonic transition guard.

A local public trust pin was generated for the offline Genesis ceremony. It is
public verifier material only and is not evidence that production has installed
or activated the trust record.

No production deployment or production database migration has been performed
for this Genesis work yet. Production remains unchanged until the normal Core,
owner and release gates authorize those effects.

### Local Rust build caveat

The workstation's `~/.rustup` path is a broken symbolic link. The Rust sidecar
build succeeded without repairing or replacing that owner-level path by using:

```text
RUSTUP_HOME=<worktree-isolated rustup directory>
CARGO_HOME=~/.cargo
```

This isolation is a local build workaround, not a production runtime
configuration. CI and release environments must use their own governed Rust
toolchain installation.

## Residual risk

Residual risks:

- local PIN custody is software protection, not hardware attestation;
- compromise of the owner workstation or unlocked signer can compromise
  signing authority;
- owner signing is intentionally manual and availability-dependent;
- single-ACTIVE-key rotation requires controlled quiescence;
- GitHub effects are not transactionally atomic with PostgreSQL, so outbox and
  independent readback remain mandatory;
- a privileged DB administrator remains an infrastructure trust boundary;
- the 86/86 targeted, 586-pass Node and successful Rust smoke results do not
  replace production migration/readiness readback, exact live commit
  verification or post-deploy Core Join;
- the public trust pin exists locally but is not yet installed in production.
