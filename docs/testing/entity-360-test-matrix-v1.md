# Entity 360 test matrix v1

## Scope e stato dell'evidence

Matrice della candidata collegata al Work canonico `Entità 360`, Work Identity
`91e82640-9edc-5424-a3e8-eb7853b0d8dd`.

La presenza di un test source non attesta esecuzione CI, commit o live state.
Ogni gate deve registrare exact commit/tree, command, exit code, pass/fail/skip,
duration e output digest redatto. Un test PostgreSQL skipped non è evidence DB.

V1 valida un context/evidence layer SHADOW. Nessun test può convertire snapshot,
completeness, attestation o comparison in authorization.

## Comandi

### Suite mirata Universal Core

```bash
node --test \
  services/universal-core-service/test/entity360.test.js \
  services/universal-core-service/test/entity360-adapters.test.js \
  services/universal-core-service/test/entity360-app.test.js \
  services/universal-core-service/test/entity360-routes.test.js \
  services/universal-core-service/test/entity360-shadow-observation.test.js \
  services/universal-core-service/test/entity360-store.test.js
```

### MCP

```bash
node --test services/skinharmony-core-mcp/test/entity-360.test.js
```

### PostgreSQL 16 isolato

```bash
ENTITY360_DATABASE_URL='<isolated-postgresql-16-url>' \
  node --test services/universal-core-service/test/entity360-postgres16.test.js
```

### Benchmark e regressione completa

```bash
npm run benchmark:entity360 --prefix services/universal-core-service
npm test --prefix services/universal-core-service
npm test --prefix services/skinharmony-core-mcp
```

Il benchmark puro deve mantenere `deterministic_digest_count=1`, ma non misura
route, adapter o database e non definisce da solo una production threshold.

## Coverage source corrente

| Test source | Boundary coperta |
| --- | --- |
| `entity360.test.js` | kernel, ontology/policy, resolver, occupancy, time/supersession, corroboration/completeness, exact verifier schemas, qualification attestation, runtime, flags e shadow runtime |
| `entity360-adapters.test.js` | Work/Component adapters, canonical/legacy identity, slug/UUID linkage, source-specific digests, same-cut query, Security quarantine e optional-query recovery |
| `entity360-store.test.js` | migration source, CAS/idempotency/identity, Store verify-only, forged snapshot/receipt rejection |
| `entity360-routes.test.js` | nine Core routes, DTT identity, operator-only configuration e bounded error redaction |
| `entity360-shadow-observation.test.js` | signed current-path observation, signed release-scope comparison, tamper/cross-Work/preflight rejection |
| `entity360-app.test.js` | health/readiness and non-authority/global-gate markers |
| `entity360-postgres16.test.js` | real migration/CAS/tenant/immutability behavior when the DB URL is supplied |
| MCP `entity-360.test.js` | eight strict tools, real DTT issuer/verifier, exact Work binding, Core error propagation and recursive context-only guard |

## Requirement-to-test matrix

Legend:

- **source covered**: targeted test exists;
- **conditional**: requires external PostgreSQL 16 execution;
- **release readback**: cannot be closed by local test source.

| Requirement | Positive | Negative/adversarial | State |
| --- | --- | --- | --- |
| Context/authority separation | READY snapshot remains non-executable | nested authority/mutation marker rejected | source covered |
| Work 360 | Gallery canonical Work plus Genesis/Intent/ICF/current state | missing authoritative binding stays incomplete | source covered |
| Software/Component 360 | verified Atlas node + revision history | future/missing history or invalid node digest produces no contribution | source covered |
| Ontology extensibility | future vertical registered declaratively | unregistered type/breaking contract rejected by compile/runtime | source covered |
| Deterministic resolver | same tenant/type/identity -> same ID | ambiguity, cross-tenant and no-match fail closed | source covered |
| Canonical/legacy Work | exact legacy UUID resolves canonical identity | continuity-only or arbitrary alias cannot bootstrap Work | source covered |
| DTT Work binding | exact tenant/Work/principal preserved issuer-to-verifier | missing/mismatched Work/presence/receipt rejected | source covered |
| Project namespaces | slug-to-slug and UUID-to-UUID agreement | slug conflict vs UUID mismatch remain distinct; conflation rejected | source covered |
| Consistent cut | resolution/discovery in one RR read-only transaction | non-schema DB fault aborts; cross-tenant row rejected | source covered |
| Source fact contract | allowed source/version/prefix admitted | source impersonation, revoked/future source rejected | source covered |
| Intent/Genesis digest | exact anchor/causal digests and binding event admitted | anchor/revision swap, event/hash/predecessor/provenance mismatch rejected | source covered |
| ICF digest canonical v2 | recursive key-sorted payload/event digest = versioned head; jsonb `zeta/alpha` reorder and forward legacy re-anchor | legacy-only, unsupported metadata, malformed/missing/mismatched event or head cannot synthesize evidence | unit + conditional PG16 |
| Architecture/Event digest | bounded source payload recomputes exact digest | mismatched stored digest rejected | source covered |
| Security digest/freshness/admission | valid independent canonical observation and evidence admitted | `EXECUTOR`, spoofed/empty provenance or poisoned row quarantines batch; expiry stays stale | source covered |
| Atlas digest/history | verified node digest/context bytes/history at `as_of` | invalid digest or future history yields gap/rejection | source covered |
| Bounded occupancy | mandatory requirements admitted within policy | advisory memory cannot displace them; overflow limited/rejected | source covered |
| Raw retrieval occupancy | aggregate global/source/source-class/trust-class bytes stay bounded before Node egress; PostgreSQL storage pre-gate precedes serialization | oversized Gallery/Architecture JSON and multi-source class/trust flooding quarantine the complete source | unit + conditional PG16 required |
| Corroboration | eligible-trust independent quorum or verified authoritative alternative | two advisory lineages, including advisory-`authoritative`, stay incomplete with trust gap | source covered |
| Provenance non-authority | rich provenance remains context | advisory source cannot self-declare blocking governed fact | source covered |
| Current/historical/stale | correct temporal buckets at `as_of`; ICF freshness uses event `created_at` | stale mandatory evidence not promoted current; snapshot `as_of` cannot refresh an old ICF head | source covered |
| Supersession | current effective same-fact chain classifies old state | cross-fact, cycle, future/stale/expired superseder are blocking contradictions and preserve target | source covered |
| Conflicting evidence | same value converges | concurrent current values and confirmed Security conflict force HOLD | source covered |
| Completeness | all mandatory requirements yield READY | high-impact cannot be optional; missing/stale/conflict/corroboration gaps are machine-readable | source covered |
| Deterministic digest | input order and creation wall clock do not alter semantic digest | NaN/cycle/prototype/tamper rejected | source covered |
| Runtime-only latency | assembly metrics record latency outside persisted snapshot | injected `assembly_latency_ms` in snapshot is schema-invalid | source covered |
| Qualification HMAC | purpose `entity360-qualified-context-v1` binds exact cut/snapshot | missing/extra/wrong-purpose/digest/signature/replay/re-digest rejected | source covered |
| Store separation | verify-only qualification capability accepted | missing verifier or verifier exposing `sign` rejected | source covered |
| Exact snapshot schema | canonical root/nested schemas verify | arbitrary root/manifest/source-discovery field rejected after re-digest | source covered |
| Source-discovery binding | accepted/stale report bound to same-source evidence | unrelated/forbidden state or metadata rejected | source covered |
| Relationships/dependencies | canonical in-tenant bounded graph | cross-tenant/type/depth/entity/evidence/byte/token flooding rejected | source covered |
| Exact request replay | retry returns original persisted version before assembly | same key/different request conflicts; source is not reread | source covered |
| Historical definitions | old snapshot uses exact policy/ontology | missing/drift/wrong digest fails closed | source covered |
| Feature mode | OFF/SHADOW normalized | ADVISORY/ENFORCED/invalid state rejected; absent/OFF tenant performs zero resolver/observer adapter reads | source covered |
| Feature authority | exact Core operator writes server-bound flag | DTT/caller policy/flag/enforcement fields rejected | source covered |
| Shadow pre-gate flood | per-tenant singleflight/cache, caller timeout and PostgreSQL `statement_timeout` preserve SHADOW progress | OFF flood, global backstop and timed-out caller retries cannot start duplicate source probes; slot releases only when the source settles | source covered; PostgreSQL 16 execution remains CI gate |
| Manual comparison | signed receipt persisted for diagnostics | remains unverified/non-release and cannot inflate Core correlations | source covered |
| Automatic observation | signed Work-preflight observation creates SHADOW_EVALUATION_ONLY receipt | tamper/cross-Work/noncanonical Gallery/state mismatch rejected | source covered |
| Backward compatibility | observer leaves current preflight authoritative | observer failure cannot mutate response/global readiness | source covered; live readback required |
| Metrics semantics | resolver and Core-correlation totals produce rates in `[0,1]` | ambiguity without assembly cannot exceed 1; persisted metrics never invent a resolver denominator | source covered |
| MCP surface | exactly eight tenant-free strict tools | extra field, tenant injection and authority response rejected | source covered |
| Core route surface | nine bounded routes including admin flag | internal error redacted; config identity separated from DTT | source covered |
| Snapshot CAS/append-only | one next-version writer and immutable rows | identity collision, broken predecessor, update/delete/TRUNCATE rejected | source + conditional PG16 |
| Trusted DB time | persisted verification time comes from DB | caller/future created time cannot establish trust | source + conditional PG16 |
| Migration/backfill | additive exact-catalog readback, terminal registry state and non-destructive state | nonterminal registry, column/default/constraint/FK namespace/index/trigger/function namespace drift, down/delete/truncate/race rejected | source + conditional PG16 |
| Rollout/rollback | SHADOW -> OFF preserves evidence | no enforcement and no destructive down migration | release readback |

## Exact MCP error acceptance

The real bridge must preserve a valid bounded Core `entity360_*` rejection code
and HTTP status. Required local error cases:

| Condition | Exact code |
| --- | --- |
| no agent presence | `agent_presence_session_required` |
| missing/malformed Work UUID | `entity360_dtt_work_id_required` |
| top-level vs identity/linkage mismatch | `entity360_dtt_work_binding_mismatch` |
| required identity Work missing | `entity360_dtt_work_identity_required` |
| DTT context unavailable | `dtt_agent_identity_not_ready` |
| upstream authority marker | `entity360_authority_boundary_violation` |
| cyclic response | `entity360_response_cycle_invalid` |
| response scan bound exceeded | `entity360_response_boundary_scan_exceeded` |
| Core ambiguity example | `entity360_entity_resolution_ambiguous` with HTTP 409 |

Unknown/unbounded internal route errors must become
`entity360_request_failed` with the fixed redacted message.

## Qualification attestation scenarios

The positive fixture must prove:

- exact canonical snapshot, manifest and source-discovery binding;
- `qualification_attestation.purpose=entity360-qualified-context-v1`;
- signature generated by the host-native domain sourced in production from
  `CORE_HOST_NATIVE_SIGNING_SECRET`;
- Store receives `{verify}` without `{sign}`;
- verification uses trusted verification/persistence time.

Negative fixtures must independently modify:

- attestation root fields, schema, purpose, semantic/payload digest or signature;
- tenant, entity, canonical identity, Work linkage or snapshot version;
- previous digest, `as_of`, `created_at`, policy/ontology or adapter registry;
- consistent-cut/source-discovery/manifest digest;
- derived context/completeness/review envelope after a full attacker re-digest;
- a signature replayed onto another snapshot/version/Work.
- retained keyring supplied as an array, primitive, unknown key id, conflicting
  active key or over-budget object.

The expected result is invalid/rejected. The test does not claim that HMAC
proves factual truth; it proves trusted assembly binding.

## Shadow acceptance scenarios

### Automatic verified path

Create a server-format `skinharmony_work_preflight_v1` with:

- exact tenant and canonical Work binding;
- exactly one matching ready Gallery Work;
- consistent project and allowed preflight state;
- execution-state mapping consistent with the current path.

Expected:

- observation purpose `entity360-current-path-observation-v1`;
- receipt purpose `entity360-shadow-comparison-v1`;
- snapshot exact tenant/canonical Work binding;
- `VERIFIED_UNIVERSAL_CORE_CURRENT_PATH_OBSERVATION`;
- `release_evidence_eligible=true` only for `SHADOW_EVALUATION_ONLY`;
- `enforcement_evidence_eligible=false`, `authorization_effect=NONE`;
- current response and production decision unchanged;
- verified HOLD/INSUFFICIENT_CONTEXT correlation updated when applicable.

Tamper, wrong Work, multiple/no Gallery match, invalid state or execution
inconsistency must fail closed.

### Manual diagnostic path

Call `entity_360_shadow_compare` with caller legacy digest/outcome. Expected:

- signed comparison receipt for integrity;
- `comparison_evidence_state=UNVERIFIED_CALLER_OBSERVATION`;
- `release_evidence_eligible=false`;
- unverified comparison counter increments;
- Core release-grade HOLD/INSUFFICIENT_CONTEXT correlation does not increment;
- no production decision mutation.

## PostgreSQL 16 acceptance

The isolated gate must prove against the applied migration:

1. registry/migration exact digest, `COMPLETED`/`READBACK_VERIFIED` and full
   catalog readback, including local FK/function namespaces;
2. tenant-scoped snapshot write/read absence across tenants;
3. only one CAS winner for the same head revision;
4. predecessor and identity binding;
5. append-only `UPDATE`/`DELETE`/`TRUNCATE` rejection;
6. receipt and snapshot same-tenant/entity/version binding;
7. Store trusted DB persistence time;
8. restart-durable rows.

An absent `ENTITY360_DATABASE_URL` is a skip, not a pass for these criteria.

## Acceptance staging/live

After governed deployment, verify on the exact same release lineage:

1. exact deployed commit for Universal Core and Core MCP;
2. `/livez`, `/readyz`, `/healthz.entity_360`;
3. `configured=true`, `state=ready`, `mode=SHADOW`;
4. PostgreSQL migration `READBACK_VERIFIED`;
5. exact policy/ontology/adapter versions and digest;
6. `shadow_non_mutating=true`, current path authoritative and no global gate;
7. Work-bound DTT smoke test for canonical and exact legacy Work UUID;
8. automatic signed preflight observation and persisted comparison;
9. manual comparison remains non-release;
10. restart durability, metrics and SHADOW -> OFF rollback evidence.

## Real remaining gates

- executed PostgreSQL 16 CI receipt;
- full CI result on the exact candidate commit;
- independent verifier/acceptance evidence;
- exact bounded Universal Core ticket and all host approvals for each external
  action;
- exact merge/deploy/migration/health/automatic-shadow/rollback readback.

NSCT unit and PostgreSQL-conditional coverage verifies owner signatures,
row/payload/request digests, complete per-plan chains, future-superseder cuts,
freshness, non-selecting multi-head conflicts, minimized output and owner-side
count/byte gates. Retained Ed25519 verification covers active/old exact-key
dispatch, removed/unknown ids, duplicate active conflicts, malformed arrays,
duplicate JSON ids and key/count/byte overflow. Shared Memory and runtime state
remain declared but unwired.
No local test or document is proof of a live release.
