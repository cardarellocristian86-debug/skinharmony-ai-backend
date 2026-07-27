# AI Learning Factory v0.16 runtime primitives

These modules are horizontal, tenant-scoped and advisory-only. They do not
start training, mutate live prompts/models, invoke providers, promote a
candidate or execute an external action.

## Integration hooks

Create one process-level instance of:

- `createAiRuntimeTelemetryStore({ adapter })`
- `createAiLearningFactoryStore({ adapter })`

The optional adapters must implement `load`, `save` and `list`. Every adapter
call receives `tenant_id`; a returned record with another tenant is rejected.
Memory-only mode is deterministic but not restart durable.

Mount `mountAiLearningFactoryRoutes` after Core authentication/store setup and
before the final 404 handler. Inject:

- the existing read authorization middleware;
- a `core:govern` middleware for mutations;
- a server-side `resolveGovernanceProof(req)` function;
- the telemetry and learning stores;
- the Core audit store.

The resolver must derive its proof from authenticated Core state. It must never
copy `req.body.authorization`. The route module deliberately ignores that
field. Candidate review and outcome recording require Core `ALLOW`, owner
confirmation, `core:govern`, an idempotency key, an expected revision, an audit
reference and a rollback reference.

The exact dynamic capability routes are:

| Capability | Method and path |
| --- | --- |
| `ai_eval_scorecard_read` | `GET /v1/ai-learning/eval/scorecards` |
| `ai_eval_dataset_read` | `GET /v1/ai-learning/eval/datasets` |
| `ai_eval_trace_read` | `GET /v1/ai-learning/eval/traces` |
| `ai_performance_scorecard_read` | `GET /v1/ai-learning/performance/scorecards` |
| `ai_experiment_read` | `GET /v1/ai-learning/experiments` |
| `ai_learning_candidate_read` | `GET /v1/ai-learning/candidates` |
| `ai_learning_candidate_review` | `POST /v1/ai-learning/candidates/review` |
| `ai_learning_outcome_record` | `POST /v1/ai-learning/outcomes` |

These are catalog capabilities, not MCP top-level tools.
`AI_LEARNING_FACTORY_ROUTE_CONTRACTS` is the machine-readable frozen contract.
Read queries reject unknown fields and accept:

- scorecards: `scorecard_id`, `release_version`, `limit`, `cursor`;
- datasets: `dataset_id`, `version`, `limit`, `cursor`;
- traces: `trace_id`, `run_id`, `limit`, `cursor`;
- performance: `scorecard_id`, `release_version`, `limit`, `cursor`;
- experiments: `experiment_id`, `state`, `limit`, `cursor`;
- candidates: `candidate_id`, `state`, `limit`, `cursor`.

`limit` is an integer from 1 to 100. The only cursor representation is
`offset:<non-negative-integer>`; responses return `next_cursor` or `null`.
Performance `scorecard_id` maps server-side to the stored
`performance_scorecard_id`.

Candidate review accepts
`{candidate_id, decision, review_note, expected_revision, idempotency_key}`.
`decision` is one of `approved_for_shadow`, `deferred` or `rejected`.
Outcome recording accepts
`{outcome, expected_revision, idempotency_key}`. The nested outcome requires
`outcome_id`, `run_id`, `outcome_status`, `outcome_verified`,
`human_review_status`, `evidence_digest`, `policy_snapshot`, `observed_at` and
`learning_value`; `candidate_id` is optional. Exact enum values are exported in
the machine-readable contract. A connector adapter may rename fields or create
the required nesting, but it must not invent missing outcome evidence.

## Audit aggregate isolation

`createAudit` now exposes `recentForTenant(tenantId, limit)`. Replace the three
control-plane/ecosystem aggregate inputs that currently use
`audit.recent(200)` with:

```js
audit.recentForTenant(req.tenantId, 200)
```

Filtering happens before the limit, so activity from a noisy second tenant
cannot remove older events belonging to the authenticated tenant.

## Benchmarks

`aiLearningFactoryBenchmark.js` produces a pinned 240-case synthetic corpus:

- 60 routing/branch selection;
- 40 tool selection/schema;
- 40 handoff/quorum/evidence/injection;
- 40 output quality/claims/citations/abstention;
- 30 tenant/client/audience isolation;
- 30 performance/retry/fallback/queue.

The checked-in manifest fixes corpus and category digests. Hard invariant
violations are non-compensable. `buildReferenceBenchmarkResults` verifies only
the corpus/scorer contract and always produces a shadow candidate, never a
release scorecard. The supervisor must inject the six real integration adapter
functions through `executeAiLearningFactoryIntegratedBenchmark`.
`measurePairedGuardrailOverhead` measures real baseline and guarded functions
over the same case sequence with `hrtime`; a custom/fake clock is marked
`unit_fixture` and cannot satisfy the release gate.

`aiAgenticEfficiencyBenchmark.js` adds 100 paired cases:

- 25 short;
- 30 medium;
- 25 long;
- 10 true multi-agent;
- 10 critical.

It treats caller usage labels and quality scores as untrusted, rejects
caller-supplied cost totals, and computes candidate cost only from token usage
plus a provenance-bound rate card. An `actual` classification requires a
server-supplied usage resolver bound to the exact token digest. Quality requires
an independent server-supplied outcome/quality resolver. The deterministic
corpus is always `synthetic_estimated`, so its scorecard remains
`shadow_candidate` even if its caller labels every sample as actual. Savings
claims remain disabled until all 100 provider workloads and quality outcomes
are independently attested, quality loss is at most 2%, and every efficiency
threshold is met.
