# Nyra/Core Governed Continuity & Context Consolidation V1 — Delta Manifest

Frozen against current `main` commit `fa65f16966fc45fc9971a0cd3e27ee0533c8dd0` on 2026-09-08. The candidate was first developed on `0918a338220f181c407628981419d1a7a6551325`, then rebased by fast-forward plus preserved WIP reapplication when PRs #498–#503 advanced `main` during the mission.

This manifest separates implementation, validation, distribution and activation. A row marked present is not automatically live or accepted.

## Recovery and execution identity

- Repository: `cardarellocristian86-debug/skinharmony-ai-backend`.
- Isolated branch: `feat/nyra-governed-continuity-context-v1`.
- Isolated worktree: `/Users/cristiancardarello/skinharmony-ai-backend-continuity-context-v1`.
- Production build read back before the latest main advance: `25f56f1470be72f8ebea9140aeee258f9c32ff63`. Deployment of `fa65f16966fc45fc9971a0cd3e27ee0533c8dd0` was not inferred and requires a fresh provider readback.
- Post-rollout MCP transport-derived presence: agent `agent_b4b43a599b31b92d0d32`, session fingerprint `c792300ee6d49fb97e2efd74d3a175483f1bdf49bd7e95bb751c239fafa4e90c`. Explicit stale logical presence declarations were rejected with `agent_presence_conflict`; no authority was inherited across the restart.
- Historical Entity360 Work `91e82640-9edc-5424-a3e8-eb7853b0d8dd` is a dependency only. It is narrower, blocked, and has a foreign active lease. It must not be mutated by this mission.
- `Multi-AI Durable Coordination V1` (`194eeced-3ed3-54b2-9953-370b784f64cb`) and Causal Continuity (`52cf629b-ec5d-4a5b-ab84-08eb35afd8ea`) are completed reusable predecessors.
- Canonical new Work: not yet created. Production catalog revision
  `1c259c7ab450ffa728c2bf3a3aa8754eec57fcf22d1195be9bc04ac556632216` exposes the
  duplicate review and V2 creation capability. Reviews R5 and R6 both found no visible
  candidate, required `CONTINUE_NEW_WORK`, and preserved the historical Entity360 Work.
  Both exact Owner-confirmed V2 create attempts returned the real non-retryable server
  response `403 core_owner_authorization_required`. The authenticated host is a
  `legacy_codex_bearer_v1` principal; production elevates fresh confirmation only for
  `identity.kind === "oauth"` (or an explicit server-side Good Mode delegation). This is
  an authorization-binding limitation, not a GitHub, Render, MCP-discovery, or review
  failure. The owner authorized a narrow PR-publication exception while this defect is
  investigated; merge and deploy remain governed.

## Baseline evidence

| Evidence | Result | Scope/limit |
| --- | --- | --- |
| Core MCP suite | 1,099 pass, 0 fail, 10 skip; 5.76 s | PostgreSQL integration tests skipped because no integration URL was configured |
| Universal Core suite | 1,430 pass, 0 fail, 16 skip; 16.83 s | Existing suite on exact candidate base |
| Entity360 benchmark | 250/250 independently verified; p50 0.863 ms, p95 0.998 ms | In-process synthetic benchmark, not network or database latency |
| Software Cognition benchmark | 250 files, 1,000 nodes, 750 edges; index 31.865 ms | In-process; database query count reported as zero |
| Live Core health | p50 535 ms, p95 934 ms, 5/5 success | Connector + network + service |
| Live Work V2 read | p50 1,357 ms, p95 1,451 ms, 5/5 success | Connector + network + persistence + Core/MCP path |
| Live Entity360 metrics | p50 1,713 ms, p95 2,853 ms, 5/5 success | Same end-to-end boundary |
| Live precommit projection read | p50 1,178 ms, p95 1,719 ms, 5/5 success | Same end-to-end boundary |
| Live complex intelligence workflow | p50 1,449 ms, p95 1,868 ms, 5/5 success | Four hypotheses, four failure events, scenarios, counterfactuals and three decisions through the published production capability; outputs were deterministic across runs |
| Live probabilistic boundary rejection | malformed identifiers and probability `1.2` rejected with `422 dynamic_capability_arguments_invalid` | Server response, not host/tool unavailability |
| Live source-flood adversarial probe | one source produced posterior 0.7419; 20 copies of that source produced 0.999 | Production defect found: deployed `transparent_log_odds_update_v2` counts correlated copies independently |
| Live Nyra interpretation layer | 0/5 interpreted; Core analysis 5/5; `nyra_interpretation_unavailable` | Probabilistic Core remained available and non-authorizing; generative interpretation was not available on this path |

## Candidate evidence before publication

| Evidence | Result | Scope/limit |
| --- | --- | --- |
| Core MCP full suite | 1,137 pass, 0 fail, 12 skip; 6.36 s | 1,149 tests on the exact local candidate after main #503; skips are environment-dependent cases exercised separately where pertinent |
| Universal Core full Node suite | 1,435 pass, 0 fail, 16 skip; 17.20 s | 1,451 tests on the exact local candidate after main #503 |
| Universal Core smoke | pass | Real compiled Rust extractor and native Core runtime |
| PostgreSQL 16 governed state + transaction regression | 62 pass, 0 fail, 0 skip; 210.17 ms | Ephemeral PostgreSQL 16.14 on the rebased candidate, with production-order legacy runtime initialization; real persistence, not a mock |
| Focused persistence/legacy regression | 92 pass, 0 fail | Includes Core Join, precommit, Gallery and stale reconciliation |
| Governed deterministic benchmark | context p95 0.187 ms; full 64-event fold p95 0.027 ms; incremental fold p95 0.007 ms; Owner view p95 0.029 ms | 2,000 samples each, Node v26, in-process only |
| Dependency audit | MCP: 1 moderate, 0 high/critical; Universal Core: 1 low + 1 moderate, 0 high/critical | `npm audit --audit-level=high`; advisories are pre-existing transitive findings, no unrelated forced upgrade |

Token counts, model cost, database query counts and cache hits are not exposed on these live paths and are **not available**, not zero.

## Requirement matrix

Legend: implementation `ABSENT/PARTIAL/PRESENT`; validation `UNVERIFIED/TESTED`; distribution `NOT_DEPLOYED/DEPLOYED`; activation `OFF/SHADOW/ENFORCED/NOT_APPLICABLE`.

| Requirement | Existing component reused | Implementation | Validation | Distribution | Activation | Frozen gap / action |
| --- | --- | --- | --- | --- | --- | --- |
| Canonical Work review/create/resume | Work Continuity V2, Nyra continuation, Gallery | PRESENT locally | TESTED + production failure reproduced | NOT_DEPLOYED | SHADOW planned | Queue now sends the exact host-bound request used by review; flat continuation schema retains operation/idempotency. Production remains blocked on the old defect until governed release. |
| Work/Agent/Harness separation and fencing | Agent Presence, tenant participants, leases, DTT receipts | PRESENT | TESTED + live presence read | NOT_DEPLOYED delta | SHADOW planned | Added read-only execution-constraints projection with DECLARED/OBSERVED/VERIFIED/UNKNOWN and no invented remote-host facts. |
| TaskStateContract | `tenant_work_task` and native task binding | PRESENT locally | TESTED + PostgreSQL 16 | NOT_DEPLOYED | SHADOW planned | Versioned append-only contracts bind Intent, inputs, dependencies, claims, effects, recovery and budgets. |
| CommittedTaskState | task/evidence and append-only Work events | PRESENT locally | TESTED + PostgreSQL 16 | NOT_DEPLOYED | SHADOW planned | Independently verified evidence, dependency manifest and effect lineage are checked before one CAS transaction commits task/event/projection. |
| Incremental WorkStateProjection | Work Ledger and canonical Gallery | PRESENT locally | TESTED + replay parity | NOT_DEPLOYED | SHADOW planned | Bounded catch-up after watermark, gap/out-of-order detection, deterministic full replay and role-specific authorized views. |
| Recovery and dependency invalidation | checkpoint/capsule, leases, precommit reconciliation | PRESENT locally | TESTED + fault cases | NOT_DEPLOYED | SHADOW planned | Relevant dependency invalidation is append-only; completed history is retained; ambiguous effects survive restart and forbid blind retry. |
| Memory/context cannot grant authority | Core gate, Owner context, Entity360 | PRESENT | TESTED | NOT_DEPLOYED delta | Security invariant | Common bitemporal provenance and monotone scope/classification transformation; every derived context explicitly grants no authority. |
| Authorization before retrieval | Core dynamic ACL, E360 and Atlas | PRESENT | TESTED | NOT_DEPLOYED delta | Security invariant | Source authorization binds principal/tenant/Work/namespace/query/policy/revocation and expiry before admission. |
| Semantic substrate catalog and bounded routing | Entity360 adapter registry, Atlas, memory/search | PRESENT by reuse + bounded admission | TESTED | NOT_DEPLOYED delta | SHADOW planned | Existing registries/storage retained; deterministic admission adds source/token/candidate/latency budgets and mandatory-source failure. |
| Bitemporal Entity360 | Entity360 v2 store, adapters, replay | PRESENT | TESTED + local benchmark | DEPLOYED | ENFORCED | Reuse. Add tests that replay excludes future knowledge and legacy records never receive invented `known_from`. |
| Context admission and common-source dedupe | E360 corroboration/occupancy, bounded Atlas, Intelligence Engine | PRESENT locally | TESTED unit + MCP/Core integration + live defect reproduced | NOT_DEPLOYED delta | SHADOW planned | Live v2 inflated posterior from 0.7419 to 0.999 under 20-source-copy flooding. Candidate v3 groups by provenance/root origin/direction, canonicalizes common URL trackers, retains only the strongest correlated contribution, and exposes the collapsed IDs/count. Mandatory sources cannot be ranked away. |
| DependencyManifest | Software Cognition plan/impact artifacts; precommit | PRESENT locally | TESTED + PostgreSQL 16 | NOT_DEPLOYED | SHADOW planned | Server validates task/Intent revision, mandatory dependency IDs, source versions, predicates, evidence and policy revision. |
| Cumulative trajectory | Semantic Scope Guard | PRESENT locally | TESTED + PostgreSQL 16 | NOT_DEPLOYED | SHADOW planned | Persistent CAS state accumulates scopes/recipients/effects/egress across agent and harness changes; HOLD is non-authorizing and appears in Gallery. |
| Effect reservation/revalidation/reconciliation | Host Native Governance, Standing Release, Work Automation v3 | PRESENT by reuse + lineage projection | TESTED | NOT_DEPLOYED delta | Existing AEC ENFORCED; new projection SHADOW planned | SUCCEEDED/KNOWN_NO_EFFECT/AMBIGUOUS/RECONCILING are persisted; no universal exactly-once claim. |
| ECT/evidence lock | Verification Evidence Contract v2, DTT trust store, Core Join | PRESENT locally | TESTED | NOT_DEPLOYED | Explicit API enforced | Existing ECT now binds claims, revisions, environment, dependency/context/policy/verifier versions and effect lineage; route is authenticated, lease/Work-bound and restart-durable. |
| Portable Verification Bundle | Existing ECT + Node crypto | PRESENT locally | TESTED positive/negative + CLI | NOT_DEPLOYED | OFF until release | Versioned `nyra_stable_json_v1`, domain-separated Ed25519 signature, embedded evidence, external trust anchor and revocation as-of semantics. No invented cryptography or RFC-conformance claim. |
| Governed learning | distilled failures, Research Distillation, Software Cognition promotion | PRESENT by reuse | TESTED | DEPLOYED existing | SHADOW/bounded | Existing pipeline keeps `automatic_promotion: false`, rejects self-promotion and keeps counterfactuals sandbox-only. No duplicate learning engine added. |
| Interoperability contract | existing DTT/registry federation, context/evidence contracts | PRESENT internally by reuse | TESTED internally | DEPLOYED existing + bundle delta not deployed | NOT_APPLICABLE externally | No OKF/AuthZEN/TRACE conformance claim: no verified primary/version/license adapter was needed for this delta. External PDP cannot override local DENY. |
| Gallery/MCP truthful readback | V2 Gallery, Control Room, dynamic capabilities | PRESENT locally | TESTED + production MCP defect reproduced | NOT_DEPLOYED delta | SHADOW planned | Canonical watermark/current task/blockers/unresolved effects/trajectory now appear in existing Gallery. Model-facing seed excludes untrusted titles; consequential requests cannot fall through to read-only Gallery. |
| Release evidence | Host Native tickets, Core Join, Render readback | PRESENT | TESTED | DEPLOYED | ENFORCED | Reuse exact ticket/reservation/reconcile flow. GitHub branch-protection endpoint returned connector 403; required policy must be read through the configured Core resolver before merge. |

## Regression surface

- Work Continuity V2 additive migration and transaction ordering.
- MCP compact descriptor budget: Nyra + status is 39,436 bytes (26,100-byte margin); with continuation it is 50,012 bytes (15,524-byte minimum margin below 65,536). New functionality remains behind typed dynamic capabilities.
- OAuth logical-session rebinding and Codex transport identity.
- Entity360/Semantic Scope enforced readiness and tenant ACLs.
- Host-native ticket one-shot/idempotency/reconciliation state machines.
- Existing Gallery projections, stale reconciliation and closure gates.
- Mixed application versions during three-service rollout.

## Fixed acceptance thresholds

These thresholds are frozen before optimization and may not be weakened to pass the release.

- Exact full suites: zero failures; only pre-existing environment-dependent skips are permitted and must be replaced by isolated PostgreSQL runs for affected persistence paths.
- New focused unit/contract/adversarial suite: zero failures and zero skips.
- Real PostgreSQL integration: zero failures/skips for migration, task commit, projection fold, concurrency, tenant isolation, replay and rollback-compatibility cases.
- Deterministic projection: full replay digest equals incremental digest for every fixture; duplicate and out-of-order inputs are rejected or idempotently ignored according to contract.
- Concurrent writers: exactly one incompatible CAS commit succeeds.
- Effect ambiguity: zero blind retries; equivalent effects remain blocked until reconciled or an independently verified idempotent provider contract applies.
- Unsupported completion: zero accepted wrong-tenant, wrong-revision, stale, substituted or tampered evidence fixtures.
- Context scope: zero privilege amplification and zero cross-tenant metadata/cache/query result exposure in the adversarial matrix.
- Performance regression: new local deterministic read/projection p95 no worse than 20% over its frozen baseline at equal fixture size; live end-to-end p95 no worse than 25% over the baseline above after warm-up, otherwise HOLD with diagnosis. Network samples are reported separately from service-local measurements.
- MCP compact import payload: below 65,536 bytes with a minimum 256-byte margin, or release is blocked.

## Release sequence

1. R0 complete locally: bootstrap/connector and PR-497 regressions repaired.
2. R1 complete locally: additive contracts/commit/projection persistence and PostgreSQL 16 tests.
3. R2 complete locally: common provenance/admission, execution constraints and role views; Entity360/Atlas reused.
4. R3 complete locally: dependency and cumulative trajectory persistence; AEC/reconciliation reused.
5. R4 complete locally: ECT evidence-lock extension, persistent API, bundle and external CLI.
6. R5 complete by verified reuse: existing governed learning/federation retained; no speculative provider adapter added.
7. R6: canonical Work creation is blocked by the production Owner-binding limitation. The owner authorized a narrow exception for commit/PR publication while the defect is investigated; merge, deploy, live acceptance and closure remain governed and **not performed**.

Rollback is application-first: deploy the previous verified commit and use feature flags where present; additive schema/data remain. No destructive down migration or ledger deletion is allowed.

## Checkpoints

- R0 — initial branch base `0918a338...`, rebased without a mission commit onto `fa65f169...`; production descriptor and queue binding defects reproduced; concurrent PRs #502–#503 integrated.
- R1 — additive migration `20260908_governed_task_state_projection_v1`; real PostgreSQL 16 upgrade, replay, concurrency and restart green.
- R2 — provenance/admission and execution-constraint contracts integrated; four authorized projection views; no authority amplification.
- R3 — dependency/trajectory/effect lineage stored atomically with Ledger and deterministic Gallery projection.
- R4 — existing ECT extended and persisted through DTT; portable bundle/CLI positive and adversarial fixtures green.
- R5 — full suites, native smoke and real PostgreSQL 16 green; live intelligence latency measured; source-flooding defect reproduced and fixed in the candidate with end-to-end regression coverage. Feature deployment state is `NOT_DEPLOYED`, intended activation `SHADOW`.
- R6 — two digest-bound Owner confirmations and V2 create attempts were made. Both received `403 core_owner_authorization_required`. Source inspection confirms bearer transport cannot be elevated by a user-supplied flag; only OAuth-bound confirmation or a configured Good Mode delegation can satisfy the normal path. Owner authorized a narrow PR-publication exception; no merge/deploy effect has been attempted.
