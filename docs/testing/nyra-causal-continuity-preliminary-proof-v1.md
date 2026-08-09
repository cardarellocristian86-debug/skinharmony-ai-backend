# Nyra Causal Continuity V1 — Preliminary Integration Proof

Status: builder evidence only; not a release, live verification, or mission acceptance.

## Governed identity

- Project alias: `skinharmony-ai-backend`
- Work ID: `52cf629b-ec5d-4a5b-ab84-08eb35afd8ea`
- Integration plan ID: `5977e8f7-1110-507f-91ff-21de0008c498`
- Integration task: `causal_integration_benchmark_builder`
- Isolated branch baseline: `19eb2b42b1a116f146b7c3264a0a1fdd036e3066`
- Observed live/main baseline during this task: `3a0370875a0adc090a3e8c71e363dd36725e1808`

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

The benchmark separates an in-memory deterministic fingerprint fixture from the production PostgreSQL bounded-query contract. It does not claim that the in-memory fixture avoids scanning its event map.

Measured fixture:

- ledger events: 10,000
- scope resources: 32
- context validations: 1,000
- requested and returned production-query rows: 200
- production SQL contract: tenant/project/cursor scoped, `ORDER BY sequence_number DESC LIMIT $4`
- application full-history materialization in production query probe: not observed
- in-memory fixture scans map before slicing: yes, explicitly reported
- ledger head: `b6b59967a553ef5a2a677b45ccd379d59b6a947165925aaf92cc86f3a2336923`
- capsule digest: `01762e6a4069fa43c67f524f18a7d9e78893d50b02eb3fa56ec6f2de6e35c7aa`
- context digest: `7a242ac3f2067e8c9539653c27e06fbf247c284c899d9e29b0c769a0c8fd9225`
- deterministic fingerprint: `4324e810fb18d724f78f5c5abaedb66aca0aba5a1c6e68b31d192dbd6606086d`

One local timing sample, informative rather than deterministic:

- ledger generation: 73.164 ms
- bounded timeline: 0.452 ms
- capsule build: 8.526 ms
- resume: 0.112 ms
- 1,000 context validations: 22.341 ms total; 0.022341 ms mean

The benchmark test runs two 2,500-event fixtures and asserts equal deterministic fingerprints, a bounded 200-row SQL result, and the exact SQL limit/cursor contract.

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
