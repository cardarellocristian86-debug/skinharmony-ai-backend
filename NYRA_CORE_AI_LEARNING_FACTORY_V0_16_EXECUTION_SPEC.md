# Nyra/Core AI Learning Factory 0.16

## Release contract

- Version: `0.16.0-ai-learning-factory`
- Tenant used for release verification: `codexai`
- Repository: `cardarellocristian86-debug/skinharmony-ai-backend`
- Base: `main`, after `0.15.0-stable-dynamic-capabilities`
- Runtime mode at first deployment: `NYRA_AI_LEARNING_FACTORY_MODE=shadow`
- Core remains the final policy, audit, revocation and rollback authority.
- `execution_enabled=false` remains unchanged.
- The learning factory measures, evaluates and proposes. It never trains, promotes,
  deploys, contacts providers or performs external actions autonomously.
- The MCP connector remains a compact surface of exactly 13 top-level tools. New
  functions are exposed only through the authenticated dynamic catalog.

OAuth settings, callback URLs, issuers, audiences, client identifiers and secrets
are outside this release. Site Suite, WordPress and Smart Desk application code are
also outside its scope.

## Server-side branch exposure

Every branch contract MUST define all of these fields:

- `exposure_class`: one of `chatgpt_horizontal`, `codex_internal`,
  `software_adjacent`, `admin_only`, `test_only`;
- `allowed_client_types`;
- `allowed_audiences`;
- `required_entitlements`;
- `discoverable_in_connector`;
- `semantic_select_allowed`.

Missing, malformed or incomplete metadata fails closed. Authenticated workload
identity determines the effective client type, audience and entitlements on the
server. Request payloads can narrow but cannot broaden that identity.

ChatGPT, including a session with `owner_root`, can discover, select and invoke only
authorized `chatgpt_horizontal` branches. SkinHarmony vertical branches are not
visible, selectable or invocable from ChatGPT. Software-adjacent clients can see
only their explicitly mapped vertical branches:

- Smart Desk: authorized Smart Desk operations and protocol branches;
- Analyzer and Tricocamera: Analyzer, Scalp and their guards;
- Suite and WaaS: Suite, CRM, catalog and network branches;
- Admin Control Room: administrative visibility through a distinct authenticated
  client and audience, never through the ChatGPT connector.

There are no wildcard cross-tenant grants and no client-side branch-pack override.

## New Nyra branches

All new branches are advisory unless explicitly marked `test_only`. Every
subbranch has a bounded contract containing input, output, activation,
non-activation, required evidence, metrics, fallback and rollback.

### `ai_evaluation_intelligence`

Production status: `advisory`.

Subbranches:

1. `evaluation_intake`
2. `dataset_registry`
3. `golden_case_versioning`
4. `trace_capture_contract`
5. `branch_selection_accuracy`
6. `tool_selection_accuracy`
7. `handoff_accuracy`
8. `final_output_quality`
9. `safety_compliance_score`
10. `judge_calibration`
11. `human_annotation_agreement`
12. `regression_detection`
13. `benchmark_segmentation`
14. `contamination_guard`
15. `eval_replay`
16. `release_scorecard`

Output: versioned scorecard, evidence, regressions, confidence, limitations and a
proposal. It cannot promote a candidate.

### `learning_data_governance`

Production status: `advisory`.

Subbranches:

1. `outcome_event_normalization`
2. `label_provenance`
3. `consent_eligibility`
4. `tenant_scope_validation`
5. `secret_pii_redaction`
6. `data_quality_gate`
7. `deduplication`
8. `hard_negative_mining`
9. `active_learning_sampling`
10. `replay_buffer`
11. `train_eval_separation`
12. `poisoning_detection`
13. `retention_expiry`
14. `dataset_versioning`
15. `learning_candidate_promotion`
16. `deletion_reconciliation`

Output: a tenant-scoped, versioned dataset candidate with provenance and policy.
Automatic training is prohibited.

### `ai_runtime_performance_intelligence`

Production status: `advisory`.

Subbranches:

1. `run_latency_decomposition`
2. `time_to_first_token`
3. `branch_router_latency`
4. `tool_call_latency`
5. `handoff_latency`
6. `token_efficiency`
7. `cost_per_success`
8. `retry_fallback_efficiency`
9. `cache_hit_quality`
10. `queue_backpressure`
11. `concurrency_saturation`
12. `provider_model_comparison`
13. `quality_cost_pareto`
14. `slo_breach_detection`
15. `capacity_forecast`
16. `performance_release_score`

Output: p50, p95 and p99 latency, token and cost per successful verified outcome,
bottlenecks and bounded recommendations.

### `experiment_causal_learning`

Production status: `advisory`.

Subbranches:

1. `experiment_intake`
2. `hypothesis_definition`
3. `baseline_control`
4. `assignment_integrity`
5. `shadow_experiment`
6. `canary_experiment`
7. `ab_experiment`
8. `guardrail_metrics`
9. `uplift_estimation`
10. `sequential_stopping`
11. `novelty_interference_guard`
12. `causal_attribution`
13. `rollback_trigger`
14. `experiment_registry`
15. `promotion_recommendation`
16. `post_promotion_monitoring`

Output: causal evidence and a promotion or rollback proposal. Activation is never
automatic.

### `model_adaptation_lab`

Production status and exposure class: `test_only`.

Subbranches:

1. `prompt_version_registry`
2. `prompt_candidate_generation`
3. `router_candidate`
4. `model_candidate`
5. `reasoning_effort_candidate`
6. `tool_surface_candidate`
7. `distillation_candidate`
8. `fine_tune_candidate`
9. `offline_eval`
10. `shadow_eval`
11. `risk_review`
12. `cost_review`
13. `promotion_proposal`
14. `rollback_snapshot`
15. `drift_revalidation`
16. `candidate_deprecation`

The branch is never exposed to ChatGPT and cannot mutate live prompts, routing,
models or weights.

## Existing Nyra branch extensions

The additions MUST respect the maximum of 20 direct subbranches per branch. When a
branch is already at its limit, additions live in a bounded capability catalog
rather than inflating the direct tree.

- `agent_orchestration`: `skill_candidate_extraction`,
  `skill_contract_compilation`, `skill_sandbox_replay`, `skill_certification`,
  `skill_versioning`, `skill_reuse_telemetry`, `skill_failure_detection`,
  `skill_deprecation`, `skill_rollback`.
- `adaptive_learning_intelligence`: `hard_case_prioritization`,
  `negative_example_replay`, `feedback_bias_detection`, `reviewer_disagreement`,
  `learning_value_estimation`.
- `learning_knowledge_intelligence`: `retrieval_precision_recall`,
  `chunking_strategy_evaluation`, `embedding_version_registry`,
  `reranking_quality`, `freshness_expiry`, `citation_coverage`,
  `knowledge_poisoning_detection`, `index_rebuild_policy`.
- `ai_orchestration`: `universal_abstention_policy`,
  `confidence_to_autonomy_mapping`, `task_difficulty_classifier`,
  `quality_cost_router`, `model_snapshot_registry`, `prompt_budget_enforcement`,
  `tool_surface_minimization`.

## Core governance

### `ai_learning_governance_guard`

Production status: `advisory`.

Subbranches:

`learning_candidate_intake`, `evidence_completeness`, `eval_threshold_policy`,
`human_review_requirement`, `promotion_authority`, `rollback_binding`,
`expiry_revalidation`, `shadow_canary_gate`, `model_prompt_version_binding`,
`experiment_lineage`, `audit_commit`, `post_promotion_watch`, `emergency_stop`.

### `ai_data_integrity_guard`

Production status: `advisory`.

Subbranches:

`tenant_scope_enforcement`, `client_audience_boundary`, `consent_binding`,
`pii_secret_redaction`, `provenance_required`, `label_integrity`,
`dataset_version_lock`, `train_eval_separation`,
`poisoning_injection_quarantine`, `retention_deletion`, `export_restriction`,
`incident_revocation`.

### Existing Core extensions

- `workload_identity_delegation_guard`: bind client, audience and entitlements to
  the allowed branch set.
- `agent_orchestration_guard`: reject handoff injection, synthetic quorum, empty
  evidence and non-independent attestations.
- `quality_verification_intelligence`: trace grading, routing/tool/handoff
  accuracy, regression detection and scorecards.
- `decision_provenance_intelligence`: lineage for datasets, prompts, models,
  experiments, decisions and rollback references.
- `runtime_deployment_scaling_guard`: SLO and budget checks, shadow/canary policy,
  saturation and rollback.
- `observability_roi_guard`: verified cost per successful outcome and measurable
  value.

Promotion is blocked without a version-locked dataset, evaluation, human review,
lineage and a valid rollback binding. Live weight mutation and automatic training
remain blocked.

## Redacted telemetry contract

The canonical trace schema accepts only these metadata fields:

- identity: `tenant_id`, `client_type`, `audience`, `agent_id`, `session_id`;
- trace: `run_id`, `trace_id`, `parent_trace_id`, `branch_id`, `subbranch_id`,
  `route_reason`, `route_confidence`;
- model: `model_provider`, `model_id`, `model_snapshot`, `prompt_version`;
- tool/handoff: `tool_id`, `tool_result_status`, `retry_count`, `fallback_path`,
  `handoff_from`, `handoff_to`, `handoff_verified`;
- consumption: `input_tokens`, `output_tokens`, `cached_tokens`,
  `estimated_cost`, `ttft_ms`, `latency_ms`, `queue_ms`;
- outcome/governance: `outcome_status`, `outcome_verified`,
  `human_review_status`, `evidence_digest`, `policy_snapshot`,
  `rollback_reference`.

Raw prompts, binary payloads, customer content, secrets and sensitive content are
not stored by default. Tenant filtering occurs before pagination and aggregation.

## Dynamic capabilities

The dynamic catalog adds exactly these capabilities without adding top-level MCP
tools:

- `ai_eval_scorecard_read`
- `ai_eval_dataset_read`
- `ai_eval_trace_read`
- `ai_performance_scorecard_read`
- `ai_experiment_read`
- `ai_learning_candidate_read`
- `ai_learning_candidate_review`
- `ai_learning_outcome_record`

Mutating capabilities require `core:govern`, explicit owner confirmation,
idempotency or optimistic concurrency, and an audit record.

## Benchmark and release gates

The deterministic, internally generated golden benchmark contains at least 240
cases:

- 60 routing and branch-selection cases;
- 40 tool-selection and output-schema cases;
- 40 handoff, quorum, evidence and prompt-injection cases;
- 40 output-quality, claims, citations and abstention cases;
- 30 tenant, client and audience isolation cases;
- 30 performance, retry, fallback and queue-pressure cases.

Non-compensable gates:

- ChatGPT vertical leakage: 0;
- cross-tenant violations: 0;
- unauthorized external executions: 0;
- accepted handoff injections: 0;
- branch-selection accuracy: at least 95%;
- tool-selection accuracy: at least 95%;
- existing-suite failures: 0;
- top-level MCP tools: exactly 13;
- p95 guardrail overhead: no more than 15% over the paired baseline, unless an
  explicit reviewed exception is recorded.

Required tests include unit, contract, client/audience/tenant isolation, injection,
dataset poisoning and quarantine, train/eval separation, DTT with non-empty
evidence/provenance/independent quorum/Core join, regression and performance.

## Release, deployment and rollback

The release updates the changelog and a machine-readable release manifest, opens a
bounded PR, waits for green CI and uses protected merge without force-push.
Services are deployed only if their code changed, in this order:

1. `skinharmony-universal-core`;
2. `skinharmony-nyra-core`;
3. `skinharmony-core-mcp`.

Live verification checks exact commit, health/readiness, additive migrations,
filtered registry/catalog/semantic selection, readable baseline scorecard, absence
of provider execution and the exact 13-tool connector surface.

Rollback consists of:

- setting `NYRA_AI_LEARNING_FACTORY_MODE=off` or retaining `shadow`;
- restoring the versioned prior exposure policy;
- deploying the recorded pre-release Git commit;
- repeating health, registry, connector and isolation smoke tests.

Dataset metadata, audit and redacted trace metadata are not deleted by rollback.

## Closure evidence

The supervisor may close the release only with:

- final commit and PR;
- modified files grouped by service;
- added and extended branch/subbranch counts;
- client/audience exposure matrix;
- complete test and benchmark results;
- deployment identifiers and exact live commits;
- live smoke evidence;
- residual risks;
- verified rollback point and rollback rehearsal.

## Binding addendum: Agentic Efficiency

This section extends the same `0.16.0-ai-learning-factory` release. It does not
replace any requirement above and does not create a second branch or PR.

### Outcome

Nyra and Core MUST change agent planning, not merely report cost. They select the
minimum useful number of agents, compact and delta-package context, reuse verified
tenant-bound artifacts, suppress duplicate work, minimize tool/file/memory scope,
give reviewers only relevant diffs and evidence, resume from checkpoints and stop
when acceptance criteria are already satisfied.

Model routing is applied only where the host exposes a reliable control. Otherwise
it is `recommendation_only`; no model-switch or saving may be claimed as real.
Actual provider usage and estimated usage are always distinct.

The vertical exposure policy above remains unchanged.

### Nyra branch: `agentic_efficiency_intelligence`

Production status is `advisory`, exposure class is `chatgpt_horizontal`, and no
external execution or vertical access is allowed.

Required logical subbranch capabilities:

1. `task_complexity_estimation`
2. `single_vs_multi_agent_selection`
3. `context_compaction`
4. `delta_context_packaging`
5. `semantic_memory_reuse`
6. `stable_prompt_prefix`
7. `tool_surface_minimization`
8. `relevant_file_selection`
9. `duplicate_work_suppression`
10. `agent_result_reuse`
11. `verified_artifact_reuse`
12. `adaptive_review_depth`
13. `selective_reviewer_context`
14. `retry_budget_optimization`
15. `early_stop_policy`
16. `model_cost_quality_routing`
17. `provider_capability_detection`
18. `credit_forecast`
19. `credit_savings_attribution`
20. `quality_cost_pareto`
21. `invocation_reduction`
22. `work_capsule_compilation`
23. `agent_context_expiry`
24. `efficiency_drift_detection`

The network-wide maximum of 20 direct subbranches remains valid. Capabilities over
that direct-tree limit are represented as versioned, bounded capability facets of
the same branch; they retain their exact IDs and complete contracts.

Every capability defines function, input, structured output, activation,
non-activation, evidence, metrics, fallback, abstention, audit, rollback, Core
binding and positive/negative tests.

### Core guard: `agentic_budget_governance_guard`

Required logical subbranch capabilities:

1. `per_run_credit_budget`
2. `per_project_credit_budget`
3. `per_agent_budget`
4. `token_budget`
5. `invocation_budget`
6. `retry_budget`
7. `reviewer_budget`
8. `model_escalation_gate`
9. `quality_floor`
10. `safety_non_degradation`
11. `budget_override_audit`
12. `provider_rate_card_version`
13. `actual_vs_estimated_usage`
14. `missing_usage_fail_safe`
15. `cost_provenance`
16. `duplicate_execution_block`
17. `stale_context_block`
18. `cache_integrity`
19. `work_capsule_integrity`
20. `budget_policy_expiry`
21. `savings_claim_guard`
22. `critical_task_cost_override`

Capabilities over the 20-node direct limit are bounded facets of this guard. Core
never authorizes savings that degrade the quality floor, skip safety, weaken
tenant/client/audience isolation, remove mandatory critical reviewers, reuse
unverified or expired artifacts, misrepresent estimates as actuals, or stop a
critical task solely because its budget expired. A critical budget event produces
an escalation, renewed confirmation or a safe degraded mode, never an incomplete
result presented as final.

### Existing branch additions

Add only missing functions and deduplicate aliases:

- `agent_orchestration`: `skill_extraction`, `skill_contract_compilation`,
  `skill_replay_verification`, `skill_certification`, `skill_versioning`,
  `skill_reuse_telemetry`, `skill_deprecation`, `skill_rollback`;
- `ai_orchestration`: `task_difficulty_classifier`, `quality_cost_router`,
  `universal_abstention_policy`, `confidence_to_autonomy_mapping`,
  `prompt_budget_enforcement`, `tool_schema_budget`,
  `stable_prefix_compilation`, `model_snapshot_registry`,
  `provider_usage_normalization`;
- `adaptive_learning_intelligence`: `active_learning`,
  `hard_case_prioritization`, `negative_example_replay`,
  `feedback_bias_detection`, `reviewer_disagreement`,
  `learning_value_estimation`, `savings_outcome_validation`;
- `learning_knowledge_intelligence`: `retrieval_precision_recall`,
  `context_relevance_scoring`, `chunking_strategy_evaluation`,
  `embedding_version_registry`, `reranking_quality`, `freshness_expiry`,
  `citation_coverage`, `knowledge_poisoning_detection`,
  `index_rebuild_policy`;
- `observability_roi_guard`: `cost_per_verified_outcome`,
  `tokens_per_verified_outcome`, `invocations_per_verified_outcome`,
  `duplicate_work_cost`, `retry_cost`, `reviewer_cost`, `cache_savings`,
  `context_compaction_savings`, `model_routing_savings`,
  `quality_adjusted_savings`;
- `decision_provenance_intelligence`: `baseline_run_reference`,
  `optimized_run_reference`, `usage_source`, `rate_card_reference`,
  `savings_calculation`, `quality_delta`, `approval_and_expiry`,
  `rollback_reference`.

### Mandatory agent protocol and work capsule

Applicable `AGENTS.md` contracts require each task to:

1. find existing task state, checkpoint, handoff, reports and artifacts;
2. detect completed or partial work;
3. estimate complexity, risk, reversibility and budget;
4. choose the minimum number of agents;
5. request only relevant files, capabilities and memory;
6. create or update a compact work capsule.

Minimum capsule fields:

```json
{
  "goal": "",
  "scope": [],
  "success_criteria": [],
  "decisions": [],
  "completed": [],
  "open_risks": [],
  "relevant_files": [],
  "changed_files": [],
  "diff_summary": "",
  "test_state": { "passed": 0, "failed": 0, "pending": 0 },
  "artifact_hashes": [],
  "reusable_results": [],
  "next_action": "",
  "budget": { "token_limit": 0, "invocation_limit": 0, "retry_limit": 0 },
  "created_at": "",
  "expires_at": ""
}
```

History, repository, branch registry and memory are never resent when a smaller
capsule is sufficient. Reusable artifacts require matching hash, provenance,
version, tenant, verification state and expiry. Claim/lease/lock prevents
concurrent duplicate work. Retry resumes from the latest valid checkpoint.
Reviewer input is limited to criteria, diff, tests, evidence, risks and
uncertainties. Early stop applies only after every criterion is satisfied.

### Agentic dynamic capabilities

Add through the dynamic catalog, with no new top-level tools:

- `agentic_efficiency_plan`
- `agentic_efficiency_status`
- `agentic_efficiency_report`
- `agentic_budget_preview`
- `agentic_budget_status`
- `agentic_work_capsule_read`
- `agentic_savings_compare`
- `agentic_artifact_reuse_check`

Arbitrary route invocation remains disabled, `execution_authorized=false`, and no
live prompt/model/weight mutation is permitted.

### Persistence and telemetry

No new database or Render service is created. Additive, rollback-safe storage uses
the already configured governance PostgreSQL through Core. Equivalent structures
cover run budgets, usage ledger, work capsules, artifact reuse, baselines,
comparisons, savings claims and rate-card snapshots. ChatGPT and Codex never
receive direct database access.

In addition to the redacted trace contract above, agentic runs record when
available: logical task, number of agents, new invocations, reused artifacts,
avoided context, actual usage, estimated usage, usage source, rate-card version,
quality and human verification. When the host does not provide actual usage,
`usage_kind=estimated`, formula and rate-card provenance are required. Unsupported
precision and unreconciled estimates cannot be labeled real savings.

Raw prompts, credentials, tokens, entire repository contents and unnecessary
personal/customer data are not persisted by default.

### Paired efficiency benchmark

Add at least 100 same-snapshot baseline-versus-optimized cases:

- 25 short deterministic tasks;
- 30 medium file/tool/checkpoint tasks;
- 25 long multi-turn tasks;
- 10 genuinely separable multi-agent tasks;
- 10 critical tasks with mandatory reviewer/supervisor.

Both variants use identical repository snapshots, acceptance criteria and quality
rubrics. Report success, quality, total/input-cached/output tokens, agent count,
new invocations, tool calls, retries, duplicates, latency, usage kind, cost or
credit per verified outcome and savings percentage.

Targets are evidence gates, not assumed constants:

- long-task median consumption reduction: at least 40%;
- overall median reduction: at least 25%;
- resent-context reduction: at least 60%;
- duplicate-work reduction: at least 70%;
- equivalent ChatGPT Agent new-invocation reduction: at least 30% where measurable;
- quality loss: no more than 2%;
- zero vertical leakage, cross-tenant violation, budget/exposure bypass,
  unauthorized external execution or false actual-savings claim.

If the economic targets are missed, the feature stays in shadow, real results and
a corrective plan are published, and quality/security are never weakened to make
the metric pass.

Negative tests include excessive fan-out, concurrent claims, reviewer rework,
expired/tampered capsules, hash mismatch, cross-tenant reuse, false cached-token or
cost claims, injection in handoff/capsule, retry loops, unauthorized model
escalation, unaudited budget override, skipped security tests, critical task budget
exhaustion, owner-root vertical access, checkpoint recovery after restart and
migration rollback without audit loss.

### Flags and rollout

First deployment:

- `NYRA_AI_LEARNING_FACTORY_MODE=shadow`
- `NYRA_AGENTIC_EFFICIENCY_MODE=shadow`
- `CORE_AGENTIC_BUDGET_MODE=observe`
- `AGENTIC_HARD_BUDGET_STOP=false`

After a green staging benchmark, only deterministic and reversible optimizations
may become active: context compaction, delta packaging, duplicate suppression,
verified artifact reuse, tool minimization, selective reviewer context, checkpoint
resume and valid early stop. Model routing without host control, hard budget stop,
autonomous prompt/model/weight changes and automatic removal of critical reviewers
remain advisory or disabled.

