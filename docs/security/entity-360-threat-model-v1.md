# Threat model — Entity 360 context/evidence layer v1

## Stato e scope

Threat model del Work canonico `Entità 360`, Work Identity
`91e82640-9edc-5424-a3e8-eb7853b0d8dd`. Descrive la candidata locale e non
prova che codice, schema, secret o configurazione siano live.

V1 è `OFF`/`SHADOW` only. Entity 360 qualifica context; Nyra ragiona; Universal
Core decide; execution richiede authority separata; Evidence/Event Ledger
chiudono il ciclo. Nessuno snapshot, attestation o shadow receipt può
autorizzare execution, merge, deploy o publish.

## Asset protetti

- tenant, canonical/legacy Work, project ed entity identity;
- separazione project slug vs causal project UUID;
- Genesis/Intent/ICF/policy/ontology/adapter bindings;
- current, historical, superseded, stale e conflicting state;
- source registry, validity/revocation, trust/independence e fact-prefix policy;
- evidence refs/digests, watermarks e source-specific canonical digest rules;
- occupancy, corroboration e completeness policy;
- qualification manifest, semantic/envelope digest e predecessor chain;
- snapshot, registry, idempotency, feature flag, receipt e backfill history;
- DTT tenant/Work/principal binding e Core operator config authority;
- `CORE_HOST_NATIVE_SIGNING_SECRET` e purpose-separated HMAC attestations;
- current production preflight outcome e Universal Core authority boundary;
- raw source data, che resta presso il sistema owner.

## Trust boundaries

| Boundary | Input | Controllo |
| --- | --- | --- |
| Client/Nyra -> MCP | strict tenant-free tool args | authenticated agent presence, exact Work UUID, no source/authority material |
| MCP -> Universal Core | Core request + signed DTT context | exact tenant/Work/principal verification; bounded error propagation |
| Core operator -> config route | OFF/SHADOW flag update | server-owned operator identity, exact configure scope, CAS/idempotency |
| Runtime -> adapters | tenant/entity/as_of selector | one repeatable-read read-only cut; source/version/fact contracts |
| Adapters -> kernel | normalized claims/evidence | tenant, digest, time, provenance, occupancy and source-discovery binding |
| Kernel -> Store | compact snapshot + qualification attestation | verify-only HMAC capability, exact schema/digest/chain/trusted DB time |
| Work preflight -> shadow observer | server-built preflight | canonical Gallery Work, server identity, signed observation |
| Entity 360 -> Nyra/Core | context/review envelope | non-authority markers and recursive MCP response guard |

## Invarianti

- `Context != Reasoning != Authority != Execution != Evidence`.
- `provenance != truth`, `confidence != authorization`,
  `completeness != authorization`.
- Entity 360 always emits `execution_authorized=false`.
- Tenant Work Gallery owns canonical Work Identity.
- Only canonical Work UUID or exact registered legacy UUID is accepted.
- Project slugs and project UUIDs are separate namespaces.
- Ambiguous/unresolved identity does not persist a pseudo-entity.
- A derived or repeated lineage cannot self-corroborate.
- Stale/historical/superseded evidence never wins by rank.
- Contradictions and invalid supersession remain visible.
- Caller source/evidence/authority never enters assembly.
- Limited/rejected raw `fact.value` never enters the compact manifest.
- Existing definitions, snapshots and receipts are not rewritten.
- Store verifies but does not sign qualification artifacts.
- Manual shadow input is never release-grade evidence.
- Shadow failure never mutates or blocks the current preflight response.

## Threats and controls

### Memory poisoning and context poisoning

**Threat.** Repeated or manipulated memory, caller facts, or forged confidence
steer the context.

**Controls.** Caller source material is forbidden. Shared Memory is declared
derived/advisory and not wired in v1. Source/version/fact-prefix contracts,
validity/revocation and exact nested schemas reject impersonation. The compact
manifest omits raw limited/rejected values. Required-context policy, not a
source's self-declared criticality, controls admission priority.

**Residual.** A future memory adapter requires lineage, origin, anti-replay,
poisoning and occupancy tests before activation.

### Adversarial retrieval and malicious source concentration

**Threat.** Retrieval selects hostile/out-of-scope records or many aliases of
one controller and presents them as independent.

**Controls.** Resolution/discovery share one tenant-bound, `as_of`-bounded
PostgreSQL `REPEATABLE READ READ ONLY` cut. Adapter output resolution/linkage is
checked against runtime derivation. Corroboration counts registered independent
non-derived lineage groups, not source IDs. Optional queries recover only
missing table/column under savepoint; other faults abort the cut. The adapter
tracks raw retrieval consumption across global, source, source-class and
trust-class budgets. PostgreSQL applies a `pg_column_size` pre-gate before JSON
serialization and an exact encoded-byte gate before egress; overflow
quarantines the entire source batch.

**Residual.** Registry governance is a supply-chain boundary. A false
independence group or compromised allowlisted adapter can still emit plausible
data and requires independent review. The egress gate does not by itself bound
all planner, TOAST or owner-side query cost; source projections, row limits,
indexes and PostgreSQL resource/statement controls remain required and are
verified in the isolated database gate.

### Semantic domination and context flooding

**Threat.** A relevant/high-confidence source consumes evidence, byte or token
capacity and suppresses minority/mandatory facts.

**Controls.** Versioned policy budgets source/entity/evidence count,
relationship depth, retrieval bytes, context tokens and contribution/evidence/
byte/token occupancy at source, source-class and trust-class levels. Admission
is deterministic, mandatory requirements are prioritized, and limited/rejected
reason codes and metrics remain visible. Raw retrieval uses the same aggregate
class/trust counters, so splitting a flood over multiple registered sources
does not reset capacity.

**Residual.** Policy values need repeatable workload calibration; pure-kernel
benchmark alone does not prove route/database/provider performance.

### Source digest substitution or synthesis

**Threat.** An adapter accepts a formatted digest without verifying owner
payload, invents a fallback digest, or reuses one source's canonical domain for
another.

**Controls.** The adapter recomputes source-specific domains: Intent/Genesis
causal digests, ICF event-chain digest, Architecture/Event Ledger records,
Project Scope Security observation and Atlas node/context bytes. ICF requires
the exact verified event digest to equal the versioned ledger head. Component
Atlas requires verified state and revision history at `as_of`. Invalid ICF or
Atlas proof emits a gap/rejection; no synthetic hash fallback exists.

Genesis/Intent qualification additionally binds the mutable Work projection to
the exact append-only `WORK_OPENED/work_bind_intent` event and predecessor
hash. Security observations pass a versioned canonical-writer admission
contract: non-independent `EXECUTOR` reports, spoofed observer bindings or
empty source provenance quarantine the entire bounded Security batch.

**Residual.** Work-record and Impact Map digests are normalized local evidence
bindings, not external signatures. A valid digest proves payload integrity
under its domain, not factual truth or execution authority. V1 has no separate
persisted owner registry for Security `source`/`observer_role` allowlists; it
relies on the authenticated canonical writer's independence and provenance
bindings and remains non-authoritative context.

### Stale evidence, temporal rollback and supersession poisoning

**Threat.** Old/future evidence appears current, or a low-trust/cross-fact/cycle
supersession deletes a valid fact.

**Controls.** Canonical RFC3339 time, `as_of`, observed/recorded/valid times,
source freshness, bounded clock skew, declared state, supersession and tombstone
are explicit. Historical/stale/superseded claims are separated. Unknown,
self/cyclic, cross-fact low-trust supersession and concurrent current values are
blocking contradictions rather than silent removal.

**Residual.** Owner clock/watermark and retention remain external trust. An
old mutable row already deleted cannot be reconstructed; safe output is a gap
or `INSUFFICIENT_CONTEXT`.

### Contradictory evidence

**Threat.** The system chooses the higher trust/confidence value and hides an
active conflict.

**Controls.** Different current value digests remain `CONFLICTED` and only
`HOLD` is admissible. Confirmed `security.signal.*` conflict is policy-blocking.
Resolution requires new evidence and a new snapshot; old snapshots stay
immutable.

### Entity collision, ambiguity and cross-Work access

**Threat.** Two identities share an entity ID, a partial identity is guessed,
or a DTT lease for Work A reads Work B.

**Controls.** Entity ID derives from tenant/type/canonical identity; head stores
identity digest/type. Candidate list is tenant-bound and exact. Ambiguous and
unresolved results stop writes. MCP top-level `work_id`, optional identity/linkage,
DTT receipt, Gallery resolution and snapshot linkage must all identify the
canonical Work or its exact registered legacy UUID.

**Residual.** New vertical aliases need explicit negative cases; no semantic
alias matching is allowed by default.

### Project namespace conflation

**Threat.** A logical slug is compared with a UUID and a false conflict or
false causal authority is produced.

**Controls.** Gallery/Continuity `project_id` are validated as non-UUID slugs and
compared together. Continuity `project_uuid` is compared only with causal
binding/Genesis/Intent UUID. Slug conflict and UUID mismatch have different
reason codes and consequences.

### Cross-tenant leakage

**Threat.** Caller body, adapter row, snapshot or receipt crosses tenant scope.

**Controls.** MCP has no tenant field; tenant derives from authenticated
context. Universal Core verifies DTT tenant and strips aliases. All adapter/store
queries use tenant, composite keys/FKs bind receipts/snapshots, and foreign rows
fail closed.

**Residual.** V1 relies on scoped queries/keys rather than PostgreSQL RLS. A
future privileged multi-service writer should reassess RLS/tenant-scoped DB
credentials.

### Provenance laundering and authority confusion

**Threat.** Consumers treat authoritative source, completeness, HMAC or shadow
receipt as ALLOW/action ticket.

**Controls.** Authoritative is source/fact-prefix/time bound and only affects
corroboration. Kernel, Store, routes and MCP require non-authority markers. MCP
recursively scans responses for positive authority/mutation fields with bounded
depth/node count. Health keeps the current path authoritative and Entity 360
outside the global readiness gate.

### Qualification attestation forgery or key misuse

**Threat.** An attacker re-digests a forged READY snapshot, replays an
attestation across Work/version/purpose, steals the signer, or gives the Store
signing power.

**Controls.** `CORE_HOST_NATIVE_SIGNING_SECRET` feeds HMAC-SHA-256 with exact
purpose `entity360-qualified-context-v1`. The payload binds tenant, entity,
canonical identity, snapshot chain/times, policy/ontology, adapter registry,
consistent cut, manifest/source discovery, project/Work linkage and semantic
digest. Exact attestation schema, payload digest and signature are verified.
Store initialization rejects missing verifier or any verifier exposing `sign`.
Snapshot verification uses trusted database persistence/verification time.
Attestation v2 binds an exact key id; the verifier selects only that key from a
bounded retained keyring and never falls back across keys. Old-key/new-key,
unknown-key and cross-purpose tests are mandatory before rotation. Removing old
verification material while referenced artifacts remain in retention is a
release stop condition.
The retained input must be a bounded plain JSON object before it is combined
with the active key; arrays and primitives fail configuration closed.

NSCT receipt verification uses an independent verify-only Ed25519 dispatcher.
`CORE_NYRA_PRECORE_VERIFY_KEYRING_JSON` is bounded to 32 total keys including
the active key and 65.536 bytes. Exact `key_id` dispatch forbids fallback;
unknown or removed ids, duplicate/conflicting active ids, arrays, malformed
public material and oversized input fail closed. The verifier exposes no
signing method and cannot expand `ADVISORY_NON_EXECUTABLE` authority.

**Residual.** HMAC verification uses the same symmetric secret domain, so
compromise of a process holding it permits forgery. Secret custody, rotation,
environment separation and audit are critical. Store verify-only is a software
capability boundary, not asymmetric cryptographic separation.

The verifier is deliberately not described as evidence-independent: it
recomputes deterministic derivations from compact persisted material and checks
the keyed proof, but does not re-query every source or recover omitted raw
values. The attestation proves trusted assembly binding, not truth or authority.

### Shadow observation poisoning and comparison laundering

**Threat.** A caller supplies a favorable legacy outcome, tampers with a
preflight, replays a qualification signature as observation, or uses a shadow
receipt as enforcement evidence.

**Controls.** Automatic observation accepts only server-built
`skinharmony_work_preflight_v1`, exact tenant/Work, one canonical Gallery match,
consistent project and mapped current-path state. The observer has a server-only
identity/scope. Observation and receipt use distinct purposes
`entity360-current-path-observation-v1` and
`entity360-shadow-comparison-v1`. Verified receipt is release-eligible only for
`SHADOW_EVALUATION_ONLY`, with `enforcement_evidence_eligible=false` and
`authorization_effect=NONE`.

Manual comparison is signed for integrity but remains
`UNVERIFIED_CALLER_OBSERVATION`, non-release and excluded from release-grade
Core outcome correlations. Automatic observer failures are audited and cannot
mutate/block the current preflight response.

Pre-gate work is tenant-singleflight with bounded negative cache, global probe
backstop and policy timeout. OFF/absent floods do not reserve observation
capacity. A stalled caller response times out fail-closed, while the actual
source probe remains counted and singleflight until it settles; the PostgreSQL
feature read has the same policy-bound `statement_timeout`.

**Residual.** Asynchronous observation or an underlying database query can fail,
race or outlive the application timeout and create a coverage/resource gap.
Monitor caller timeouts and source-probe completion/failure separately, and do
not infer parity from missing receipts.

### Feature flag authority escalation

**Threat.** DTT agent or caller enables SHADOW, injects a policy digest or
attempts ENFORCED.

**Controls.** Configure route is absent from MCP and uses an independently
authenticated `universal_core_operator`, provenance
`universal_core_platform_auth`, with exact sole scope
`entity360:feature-flag:write`. Server owns `flag_id`, policy digest and null
enforcement digest; only consistent OFF/SHADOW states are accepted with CAS and
idempotency.

### Replay, race and immutable-history abuse

**Threat.** Same idempotency key changes payload, two writers win, or snapshot/
receipt/history is updated/deleted/truncated.

**Controls.** Canonical request replay lookup precedes adapter access. Different
payload conflicts. Entity-head advisory lock and exact revision/predecessor CAS
allow one winner. Registry/snapshot/receipt/idempotency/backfill events are
append-only with `UPDATE`, `DELETE` and `TRUNCATE` guards. Down migration is
disabled; rollback is feature OFF, never evidence deletion.

## Fail-closed conditions

Entity 360 stays OFF/not-ready or returns only bounded
`HOLD`/`INSUFFICIENT_CONTEXT` when it cannot prove:

- tenant, DTT principal and exact canonical/legacy Work binding;
- non-ambiguous deterministic entity resolution;
- separate project slug/UUID consistency;
- source/adapter/fact/version and source-specific digest binding;
- policy/ontology historical definitions and exact digests;
- feature-flag exact policy pin and Core operator authority;
- time, freshness, supersession and contradictions;
- required evidence class, eligible-trust corroboration or verified
  authoritative source; advisory lineages cannot satisfy high-impact context;
- compact manifest, qualification attestation, semantic/envelope digest;
- PostgreSQL migration/CAS/append-only/trusted time;
- non-authority boundary and rollback path.

## Security release gate

Before production SHADOW, require:

- kernel poisoning/flooding/occupancy/corroboration/temporal negative tests;
- source-specific Intent/Genesis/ICF/Architecture/Event/Security/Atlas digest tests;
- supersession cross-fact/cycle/future/stale/expired/conflict tests;
- exact Work/legacy/DTT and cross-tenant tests;
- qualification missing/extra/wrong-purpose/replay/tamper tests;
- Store verify-only and forged shadow receipt tests;
- automatic signed preflight observation and manual non-release comparison tests;
- Core operator-only feature flag tests;
- real MCP error propagation and recursive authority guard tests;
- PostgreSQL 16 migration, one-CAS-winner, trusted-time and immutable-table gate;
- verifier report, exact Universal Core tickets and host approvals;
- exact live commit, migration, health, automatic shadow and rollback readback.

Without these receipts the state remains implementation candidate, not
`PRODUCTION VERIFIED`. NSCT is admitted only through its owner-verified,
as-of-bounded advisory adapter; Shared Memory and runtime state stay unwired in
v1.
