# Test matrix: Nyra Causal Continuity and Reality Closure v1

## Test layers

| Layer | Coverage |
| --- | --- |
| Unit | canonical JSON/digest, Project state, revision classification, state machines, CAL, context validation, drift/impact/rebase, receipt/capsule |
| Contract | Universal Core APIs, MCP capabilities, Nyra semantics, Gallery projection, branch wrapper, legacy compatibility |
| PostgreSQL 16 | migrations, composite FK, append-only triggers, locks, CAS, idempotency, replay, restart and rollback compatibility |
| Concurrency | duplicate project/change/binding, nonce consume race, state snapshot race, projection outbox race |
| Property/fuzz | revision chains, obligation DAG, digest order, event reconstruction, reopening and bounded resume |
| Security | tenant isolation, replay, tamper, authority, constraint inheritance, observer independence, orphan quarantine |
| E2E | session resume, Gallery outage/recovery, governed action, real observation, reconciliation, provisional closure and reopening |
| Performance | large bounded ledger, snapshot/rebuild, context validation latency, resume memory bound and endpoint regression |
| Release | exact CI jobs, GitHub tree/blob readback, Render commit/health/readiness, rollback availability |

## Mandatory outcomes

1. Work without Project ID: `BLOCK`.
2. Work without Intent Revision: `BLOCK`.
3. Change without Work ID: `BLOCK`.
4. Governed action without Change ID: `BLOCK`.
5. Expired Context Envelope: `BLOCK`.
6. Reused nonce: `BLOCK`.
7. Cross-tenant evidence: absolute `BLOCK`.
8. Orphan Gallery ticket: `QUARANTINE/BLOCK`.
9. Delegation loses a constraint: `BLOCK`.
10. Stale state digest: `REBASE_REQUIRED`.
11. Compatible new revision: `CONTINUE`.
12. Incompatible new revision: `BLOCK + REBASE`.
13. Strategic pivot without owner approval: `BLOCK`.
14. Purpose change: `NEW_PROJECT_REQUIRED`.
15. Concurrent identical binding: one idempotent result.
16. CI green, wrong production commit: `NOT VERIFIED`.
17. Health green, user path broken: `PARTIAL` or `CONTRADICTED`.
18. Executor is only high-risk evidence: closure `BLOCK`.
19. Observer unavailable: `UNKNOWN`.
20. Delayed contradiction: automatic reopening.
21. Rollback with original problem open: obligation remains open.
22. New-session resume: reconstruct what/why/how/state.
23. Agent/model change: identity and constraints unchanged.
24. Branch tries to change Project ID: `BLOCK`.
25. Gallery unavailable: Core truth retained and later synchronized idempotently.
26. Evidence digest mismatch: closure `BLOCK`.
27. Action lease replay: `BLOCK`.
28. Historical Intent Revision update: `BLOCK`; create a new revision.
29. Ambiguous legacy binding: `UNRESOLVED`, no invented causality.
30. Negative evidence after `VERIFIED_PROVISIONAL`: `REOPEN`.

## Additional baseline gates

- Production Core and MCP commits match GitHub `main` baseline.
- Airlock remains enforced and tenant isolation tests stay green.
- All 72 Branch Registry entries receive the causal defaults and pass the shared wrapper.
- Required jobs are exactly `core-mcp`, `deployment-parity`, `universal-core`.
- PostgreSQL 16 CI passes while production major 18 remains healthy.
- Existing Work Continuity, DTT, Deep V2, host-native readback and Research Airlock suites do not regress.
- Staging limitations are reported instead of being treated as parity.

## Benchmark acceptance

- Ledger reads are tenant/project scoped and paginated; no full-history load for normal resume.
- Capsule reconstruction is deterministic from a bounded snapshot plus indexed events.
- Context validation performs indexed lookups and one atomic nonce consume for mutating hops.
- No global locks, unbounded payload copies or aggressive polling.
- Any material regression on critical endpoints requires a measured, documented exception and Core review.

Quantitative gates use a deterministic seed and a checked-in benchmark command:

- 100 projects, 1,000 Work bindings, 10,000 Changes/obligations and 100,000 ledger events.
- p95 context validation below 25 ms in-process and no query reading more than the bound Project/context rows.
- p95 capsule resume below 250 ms with at most 200 bounded timeline events.
- event append throughput regression no worse than 15% versus the same-commit legacy Work append baseline.
- resident memory growth below 64 MiB while resuming 100 projects sequentially.

Every automated case records file, test name, command, fixed seed, expected structured code and evidence artifact. PostgreSQL cases run against majors 16 and 18. Concurrency uses at least 32 contenders; fuzz/property suites use a recorded seed and at least 1,000 generated revision/DAG/digest/reopening examples. Crash tests inject failures at pre-commit, post-commit/pre-delivery and post-delivery/pre-ack boundaries.

Commands introduced by the implementation include targeted unit/contract runs, both service suites, PostgreSQL migration/rollback/concurrency runs, the branch coverage generator, the E2E scenario and the deterministic benchmark. Production smoke evidence is recorded separately from automated acceptance and cannot be replaced by local mocks.

## Production proof scenario

After exact deploy readback, use non-sensitive reversible data to resolve Project, create a non-strategic revision, Work binding, Change and Obligation, issue/delegate context, bind Gallery, perform a benign action, record independent evidence, reconcile to provisional, resume from a fresh session, inject a controlled contradiction, observe reopening, remediate, re-verify and generate an Outcome Receipt. Temporal maturity is reported separately from immediate verification.
