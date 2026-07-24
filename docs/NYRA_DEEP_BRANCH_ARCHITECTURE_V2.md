# Nyra Deep Branch Architecture V2

## Scope and authority

Nyra Deep Branch V2 is an additive, tenant-scoped advisory runtime for
`skinharmony-nyra-core`. It does not move branch opening, policy decisions, join authority or
execution authorization out of Universal Core.

The authenticated live response from `GET /v1/nira/branches` is the V1 source of truth. The
captured `codexai` catalogue contains 18 branches and 239 Level-1 subbranches. V2 adds one
research-approved specialized capability and one independently testable micro-capability under
each live subbranch. Every micro-capability owns four operational Level-4 primitives with
capability-specific identifiers and contracts: method, selection strategy, result verifier and
metric.

The approved topology is therefore:

- 18 branches;
- 239 V1-compatible Level-1 subbranches;
- 239 Level-2 specialized capabilities;
- 239 Level-3 micro-capabilities;
- 956 Level-4 operational primitives;
- 1,434 independent Level-2–4 contracts.

The complete mapping is generated in `docs/NYRA_DEEP_BRANCH_V2_MAP.md`.
The complete executable contracts live in the authoritative catalog JSON. The generated YAML is a
human-review index containing every node, semantic-function binding and JSON Pointer; the separate
function-registry JSON contains the full plaintext assertion and execution specifications.

## Runtime flow

1. The existing horizontal runtime interprets the request and proposes V1 branch IDs.
2. Nyra calls Universal Core `POST /v1/nira/core-bridge`.
3. V2 can consider only branch IDs explicitly opened by that authenticated Core response.
4. Server-side feature flags enforce the global kill switch, rollout mode, branch allowlist and
   authenticated tenant allowlist. Client input cannot select a tenant or domain pack.
5. When a bounded `deep_branch_context` is present, the contract engine evaluates the matching
   L2→L3→L4 lineage in topological order.
6. Each node is bound to one separately hashed function-registry entry compiled from the Research
   row and operational role. It validates that immutable function, its closed recursive input
   schema, Core-open state, parent result, tenant, capability input digest and exact Core evidence
   manifest.
7. Evidence claims bind the node semantic hash, subject, records, claim, freshness, authority,
   payload hash and provenance hash. Policy decisions bind the same manifest and are accepted only
   when their full Core snapshot recomputes exactly.
8. Confidence uses one executable formula: 50% evidence coverage, 20% authority compliance, 15%
   freshness compliance and 15% input validity. The seven-vector calibration set is hash-pinned.
9. Free narrative records are not accepted. The engine joins structured problem, evidence,
   failure-absence and boundary-preservation assertions to accepted Core evidence, then executes
   the registry-derived method, four-case selection strategy, eleven independent verifier checks,
   assertion-population metric and every declared failure detector.
10. Every result remains advisory: `execution_authorized` is always `false`, and Universal Core is
   always the final authority.

Without a deep context, shadow mode returns only a compact ID topology for Core-opened branches.
The full immutable contracts are available through the authenticated catalogue endpoint.

## Interfaces

- `GET /api/nyra/runtime/contract` advertises the optional V2 capability and its feature gates.
- `GET /api/nyra/runtime/v2/catalog` returns the immutable catalogue, validation result and
  server-derived tenant gate.
- `GET /api/nyra/runtime/v2/validation` returns topology, integrity and admission status without
  accepting client authority.
- `POST /api/nyra/runtime/interpret` preserves the V1 Core bridge and adds `deep_branch_v2` only
  when the server-side V2 gate is effective.

All `/api` endpoints use the existing Nyra authentication middleware. The tenant comes from
`NYRA_CORE_TENANT_ID` and the authenticated Core key, never the body, query or headers supplied by
the caller.

## Feature gates

The Render blueprint keeps V2 disabled:

```text
NYRA_DEEP_BRANCH_V2_ENABLED=false
NYRA_DEEP_BRANCH_V2_MODE=shadow
NYRA_DEEP_BRANCH_V2_BRANCHES=<explicit live branch IDs>
NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST=codexai
```

An empty tenant or branch allowlist fails closed. Unknown modes fail closed. `active` mode exposes
verified advisory results but still cannot authorize execution.

## Validation and executable tests

Every admitted node contains closed JSON input and output schemas, activation and non-activation
conditions, dependencies, evidence requirements, Core policy bindings, tenant scope, risk,
confidence, method, strategy, verifier, metric, routing, fallback, review trigger, audit,
provenance, positive/negative/adversarial/regression tests, V1 compatibility, rollback and an
independent `semantic_contract`. The latter binds the problem, purpose, capability spec, record
claim, evidence claims, failure signatures, operation, strategy, verifier, metric and Core policy
set. Each evidence gate, method, strategy, verifier and metric also carries a closed executable
program. The 1,434-entry function registry binds real plaintext assertions, role-specific
projections, decision cases, oracle sets and metric populations; node IDs and opaque hashes are
excluded from the function identity. Recomputing descriptive hashes cannot turn an altered
program into an admitted one. All 1,434 semantic and function hashes must be distinct.

`personal-control-center/data/nyra-deep-branch-v2.fixtures.json` contains the 5,736 referenced
fixtures. The test and verification runners execute:

- 1,434 positive contract cases;
- 1,434 missing-evidence/fallback cases;
- 1,434 cross-tenant adversarial cases;
- 1,434 kill-switch/V1 regression references backed by executable full V1 input/output goldens;
- 37,284 independent semantic mutation probes covering the extended Pass-4 failure classes;
- 15,774 exact-envelope and coherently rebound probes covering the 11 Pass-6 failure classes;
- 17,208 Supervisor Pass-7 operation, registry, donor and structured-observation probes across all
  1,434 nodes;
- 7,170 function-registry and structured-observation probes repeated by the repository runtime
  suite;
- full topology, fingerprint and Supervisor admission checks;
- deep topological routing under an authentic Core-open result;
- tenant and branch allowlist isolation;
- catalog tamper rejection;
- route performance and confidence calibration benchmarks;
- rollback to V1.

## Final local verification

The Supervisor admitted the immutable V21 candidate with 1,434 approvals and zero rejections.
Controlled promotion produced catalog fingerprint
`fbb0c0982dd963c8e3bab9cd70d8d63b07c7e170b39d85844ccae8c119482b19`.

- Nyra runtime suite: 17/17 tests passed, followed by tenant-isolation and authenticated server
  smoke tests.
- Executable contract verification: 5,736/5,736 fixtures passed.
- Universal Core regression suite: 203/203 tests passed on the rebased `origin/main`.
- Universal Core integration smoke: passed with the existing local Rust extractor binary.
- Route benchmark: p50 26.897 ms, p95 28.336 ms, 100 ms p95 budget passed.
- Rollback verification: passed with V1 authoritative and
  `NYRA_DEEP_BRANCH_V2_ENABLED=false`.

The machine-readable results are in `reports/nyra-deep-v2/validation_report.json`,
`benchmark.json`, `rollback-verification.json` and `supervisor_decisions.json`.

## V1 compatibility

V1 remains the first and authoritative branch route. When the global flag is false, the existing
interpret response does not receive a V2 namespace. V2 does not rename or remove a V1 branch or
subbranch, cannot select a client-provided product pack, and every contract has an exact
`v1:<branch>/<subbranch>` fallback. Regression fixtures execute the disabled horizontal runtime,
the complete SkinHarmony V1 catalog and 18 full Core route inputs/outputs; hashes are secondary
integrity checks, not substitutes for deep equality.

## Rollback and release gate

The primary rollback is the global kill switch:

1. set `NYRA_DEEP_BRANCH_V2_ENABLED=false`;
2. verify `disabled_v1_authoritative`;
3. verify the fallback is `nyra_neural_branch_network_v1`;
4. verify `execution_authorized=false`;
5. retain the immutable V2 build checkpoint and audit evidence.

This implementation prepares source and evidence only. It does not change the Render service,
merge the PR or deploy. Release remains blocked until CI is green, Universal Core returns
`ALLOW`, and the owner explicitly confirms the exact release action.
