# Threat model: Nyra Causal Continuity and Reality Closure v1

## Assets and trust boundaries

Protected assets are tenant identity, Project/Intent/Work/Change/Obligation lineage, state digests, single-use contexts, evidence provenance, event ordering, release tickets, observations and closure receipts.

Trust boundaries exist between the native host, Core MCP, Universal Core, Nyra Core, branch handlers, Gallery, PostgreSQL, GitHub, CI, Render and independent observers. Universal Core is the final authority. Connected tools and health endpoints provide evidence, not authority.

## Threats and controls

| Threat | Required control | Failure result |
| --- | --- | --- |
| Cross-tenant binding/evidence | composite tenant FKs, tenant-scoped queries, signed context and projection validation | absolute block |
| Reused or forged nonce | PostgreSQL unique nonce digest, TTL, atomic consume, issuer/audience binding | `CONTEXT_REPLAYED` block |
| Expired context or lease | server clock and bounded expiry; no caller override | block |
| Stale Project State | compare verified `base_state_digest` with current snapshot under project lock | `STALE_PROJECT_STATE`, rebase required |
| Orphan Gallery item | verify Core binding/event sequence/context digest before action | quarantine as `ORPHAN_GALLERY_ITEM` |
| Branch changes Project/Work/Change identity | immutable input/output identity comparison in common dispatcher | block and security event |
| Delegation loses constraints | inherited constraint digest and parent context digest | block |
| Agent expands authority | branch contract allowlist and Core authorization | block |
| Strategic pivot self-approval | owner/Core approval matrix and intent classification | block |
| Purpose change in-place | `NEW_PROJECT_REQUIRED` | block current project mutation |
| Evidence digest tampering | canonical digest readback, append-only evidence and observer binding | block closure |
| Executor is sole high-risk observer | CAL minimum and independent observer policy | block closure |
| Proxy/health treated as reality | explicit evidence contract and causal reconciliation | `PARTIAL`/`UNKNOWN` |
| Delayed negative evidence | temporal checks and observation trigger | automatic reopening |
| Wrong production commit | exact service commit readback | `CONTRADICTED`, rollback/remediation |
| Gallery outage | Core transaction plus idempotent projection outbox | truth retained, projection pending |
| Ledger mutation/truncation | append-only triggers, project sequence and hash-chain verification | readiness failure and escalation |
| Duplicate concurrent creation | unique constraints, advisory lock and idempotency request digest | one result, no duplicate |
| Legacy causal fabrication | explicit verified alias/binding provenance | `UNRESOLVED_LEGACY_BINDING` |
| Secret leakage or crypto confusion | reuse server-owned signing domains; no new secret; structured redaction | fail closed |

## Red-team cases

The adversarial suite must cover all thirty mandated cases plus fuzzing of revision chains, obligation DAGs, digest canonicalization, replay, concurrent binding, event reconstruction and reopening. It must also test:

- same nonce with a changed payload;
- correct tenant but wrong project;
- child envelope with altered identity and unchanged digest;
- evidence observer identity reused by executor;
- Gallery ticket sequence ahead of the Core ledger;
- forged final state from CI green but Render commit mismatch;
- closed obligation receiving a fresh high-confidence contradiction;
- mutation attempts on Genesis/revision/decision/receipt rows;
- projection replay after Gallery recovery;
- feature-flag downgrade during an in-flight authorization.

## Additional abuse and fault cases

- TOCTOU: issue a valid envelope, then advance Project State before consume; consume must return `STALE_PROJECT_STATE` without authorizing an action.
- Actor provenance: reuse an otherwise valid envelope from a different authenticated agent/session; absolute block.
- Clock boundaries: test just before and exactly at expiry using database time, including caller clock skew.
- Resource exhaustion: bound context obligations/tickets, DAG fan-out/depth, capsule history, API page sizes and outbox batches; reject oversized canonical payloads before hashing or persistence.
- Poison projection: a permanently failing Gallery item is quarantined after bounded retries while later tenant/project items continue.
- Feature downgrade: the enforcement mode captured at authorization remains the minimum mode through consume; `ENFORCE_NEW_WORK` cannot become `SHADOW` mid-flight.
- Crash injection: stop after projection mutation but before commit, after commit but before outbox delivery, and after delivery but before acknowledgement; authoritative state remains exactly-once and projection delivery remains idempotent.
- Isolation timing: cross-tenant misses use the same not-found response class as absent IDs and do not expose resource existence.

## Residual risks

- Legacy staging does not exercise the current production host-native contract.
- The Nyra Policy Registry proof is not ready because external key material is missing; this mission cannot access or rotate it.
- Universal Core host-native ticket storage is currently file-backed and non-distributed. Causal DB ownership reduces but does not silently migrate historical ticket state.
- Production PostgreSQL is major 18, while required compatibility tests target PostgreSQL 16; both need evidence.

These risks prevent false finality but do not justify weakening Airlock, tenant isolation or release gates.
