# Nyra Causal Continuity V1 — Preliminary Integration Proof

Status: builder evidence only; not a release, live verification, or mission acceptance.

## Governed identity

- Project alias: `skinharmony-ai-backend`
- Work ID: `52cf629b-ec5d-4a5b-ab84-08eb35afd8ea`
- Integration plan ID: `5977e8f7-1110-507f-91ff-21de0008c498`
- Integration task: `causal_integration_benchmark_builder`
- Benchmark contract plan ID: `c12d4b41-e960-5c2b-ac04-5997c98d3d58`
- Benchmark contract task: `causal_benchmark_contract_builder`
- Isolated branch merge base: `3a0370875a0adc090a3e8c71e363dd36725e1808`
- Isolated working-tree HEAD: `70782ceae1e05c2d723b5e1eccd0ae2381f90911`
- Observed live/main baseline: `3a0370875a0adc090a3e8c71e363dd36725e1808`

The lane intentionally was not rebased while concurrent causal-continuity surfaces were being written. A controlled rebase and complete integration rerun are required.

## Adapter and boundary evidence

The Core MCP adapter exposes strict schemas and exact route mappings for the Gallery projection lifecycle and metrics:

- `gallery_binding_project`
- `gallery_projection_claim`
- `gallery_projection_complete`
- `gallery_projection_fail`
- `gallery_causal_view_read`
- `causal_metrics_snapshot`

The MCP transport derives tenant identity from the authenticated identity, requires a signed DTT agent-presence receipt, and propagates it through `x-sh-dtt-agent-context`. The decision ledger accepts causal lineage only from successful, known Universal Core capability results. Nyra's interpreter remains proposal-only and forces owner approval to false at its HTTP boundary.

Universal Core's causal route adapter maps authenticated platform scopes to explicit causal transport scopes. Caller-supplied authority is not used by that adapter. Two separate authority follow-ups remain blocked on authoritative runtime contracts and are listed below.

## Bounded benchmark evidence

The hardened benchmark executes the documented fixed-seed workload: 100 projects, 1,000 Works, 10,000 Changes, 10,000 obligations, and 100,000 hash-chained events. It reads and discards one 200-event project window at a time. The production PostgreSQL query probe separately proves a tenant/project/cursor-scoped `ORDER BY sequence_number DESC LIMIT $4` query returns exactly 200 rows without application full-history materialization.

Memory is a cold RSS delta in an isolated `--expose-gc` process. Each already-read 200-event project window is explicitly collected before the next project; this measures the bounded-resume design rather than retaining all project histories in the benchmark process. The append comparison invokes the public legacy Work Continuity append and causal append paths imported from the same checkout, hashes both source files, warms each path equally, and computes the measured p95 regression. It does not use a synthetic pass flag.

Two independent CLI runs were green and produced the same deterministic fingerprint, `145042e332f0a75e76a588f15acaa39c0048a1ef49ac3cf9ae56d6abbd5cd10d`:

| Gate | Threshold | Run 1 | Run 2 |
| --- | ---: | ---: | ---: |
| Context validation p95, 1,000 samples | < 25 ms | 0.040459 ms | 0.039458 ms |
| Capsule resume p95, 100 projects / 200 events | < 250 ms | 0.042000 ms | 0.041791 ms |
| Cold 100-project RSS delta | < 64 MiB | 29.734 MiB | 29.344 MiB |
| Same-checkout legacy append p95 regression | <= 15% | -94.942% | -95.374% |

Additional measured readback:

- all seven gates were `true` in both runs;
- ledger generation was 859.105 ms and 858.108 ms respectively;
- 100,000 events were generated, 20,000 bounded rows were read across all resumes, and peak materialization was 200 event rows;
- the production query contract returned 200 rows with one query and verified tenant, project, cursor, descending order, and limit bindings;
- the contract test itself performs two full workload runs and passed in 1.899 seconds locally.

## Test evidence

- Core MCP complete suite outside the restricted network sandbox: 346 tests, 345 passed, 0 failed, 1 skipped. The skipped PostgreSQL 16 integration required `WORK_CONTINUITY_DATABASE_URL`, which was not present.
- Core MCP causal/decision-ledger/handler/schema focus: 40 passed, 0 failed.
- Universal Core causal integration focus: 65 passed, 0 failed.
- Nyra causal semantics: 7 passed, 0 failed; `personal-control-center/server.js` syntax check passed.
- Universal Core full-suite attempt was interrupted after it stopped producing output with 26 tests still reported as running; no green full-suite claim is made.
- Universal Core smoke opened its loopback server outside the sandbox, passed health and multiple control-plane checks, then failed at the pre-existing translation extractor status check. No causal-continuity smoke success is claimed.

## Controlled-rebase overlaps

`origin/main` advanced over files changed by this mission. Reconcile these symbols/hunks deliberately:

- `services/universal-core-service/src/app.js`: causal imports; causal store/runtime/enforcer initialization; authenticated causal scope adapter; route registration; health/readiness; branch analysis/enforcement integration.
- `services/skinharmony-core-mcp/src/core-handlers.js`: the non-enumerable internal `causalCoreRequest` seam returned by `createCoreHandlers`.
- `services/skinharmony-core-mcp/src/server.js`: causal adapter imports; `TOOLS` registration; DTT agent-context issuer injection; handler-map spread.

## Open integration blockers

1. The action-lease verifier adapter must stop echoing `input.authority_scope`. After the persisted lease policy lands, it must return the DB-read purpose, project/change/obligation surfaces, persisted authority scope, authority source and binding digest, plus lease identity/status/expiry. Runtime must use requested ∩ actor ∩ persisted authority.
2. Route identity must never let a signed delegated receipt amplify authenticated platform authority. Use platform scopes only, or a strict receipt/platform intersection when delegated scope is present. Add a regression proving `intent:approve:strategic` cannot appear without authenticated `OWNER_ASSERTION`.
3. MCP lifecycle transition capabilities remain pending until the authoritative Universal Core route names and runtime shapes exist; no speculative route was added.
4. A controlled rebase onto `3a0370875a0adc090a3e8c71e363dd36725e1808`, complete suites, PostgreSQL integration, CI, staging, production, temporal verification, and final Outcome Receipt are still required.

## Verdict

This package is preliminary builder evidence. `EXECUTED != VERIFIED != CLOSED`. `live_verified=false`; the mission acceptance criterion is not attested.
