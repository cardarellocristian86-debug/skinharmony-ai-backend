import {
  buildAgenticEfficiencyCorpus,
  buildAgenticEfficiencyManifest,
  evaluateAgenticEfficiency,
} from "./aiAgenticEfficiencyBenchmark.js";
import { benchmarkDigest } from "./aiLearningFactoryBenchmark.js";
import { buildAgenticEfficiencyPlan } from "./agenticEfficiencyRuntime.js";
import { createGenericAgentOrchestrator } from "./genericAgentOrchestrator.js";

export const AI_AGENTIC_INTEGRATED_BENCHMARK_VERSION =
  "ai_agentic_integrated_replay_benchmark_v0_16";

const GENERIC_AGENT_TASK_LIMIT_BYTES = 3_900;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function estimatedTokens(value) {
  if (value === null || value === undefined || value === "") return 0;
  return Math.max(1, Math.ceil(Buffer.byteLength(
    typeof value === "string" ? value : JSON.stringify(value),
    "utf8",
  ) / 4));
}

function elapsedMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function serializeBoundedPayload(payload) {
  const bounded = clone(payload);
  const originalHistoryCount = Array.isArray(bounded.legacy_history)
    ? bounded.legacy_history.length
    : 0;
  while (
    Buffer.byteLength(JSON.stringify(bounded), "utf8") > GENERIC_AGENT_TASK_LIMIT_BYTES
    && Array.isArray(bounded.legacy_history)
    && bounded.legacy_history.length > 0
  ) {
    bounded.legacy_history.pop();
  }
  const serialized = JSON.stringify(bounded);
  if (Buffer.byteLength(serialized, "utf8") > GENERIC_AGENT_TASK_LIMIT_BYTES) {
    throw new Error("agentic_benchmark_worker_context_exceeds_runtime_limit");
  }
  return {
    serialized,
    history_events_included: Array.isArray(bounded.legacy_history)
      ? bounded.legacy_history.length
      : 0,
    history_events_total: originalHistoryCount,
    runtime_limit_truncated: Array.isArray(bounded.legacy_history)
      ? bounded.legacy_history.length < originalHistoryCount
      : false,
  };
}

function assignedFiles(task, workerIndex, workerCount) {
  return task.relevant_files.filter((_, index) => index % workerCount === workerIndex);
}

function baselineWorkerPayload(task, workerIndex, workerCount) {
  return serializeBoundedPayload({
    schema_version: "generic_agent_worker_context_v0_15",
    role: "worker",
    workstream: `workstream-${workerIndex + 1}`,
    assigned_files: assignedFiles(task, workerIndex, workerCount),
    goal: task.goal,
    scope: task.scope,
    success_criteria: task.success_criteria,
    decisions: task.decisions,
    completed: task.completed,
    open_risks: task.open_risks,
    relevant_files: task.relevant_files,
    changed_files: task.changed_files,
    diff_summary: task.diff_summary,
    test_state: task.test_state,
    artifact_hashes: task.artifact_hashes,
    reusable_results: task.reusable_results,
    next_action: task.next_action,
    required_tools: task.required_tools,
    available_tools: task.available_tools,
    checkpoint: task.checkpoint,
    retry_count: task.retry_count,
    legacy_history: task.legacy_history,
  });
}

function baselineReviewerPayload(task) {
  return serializeBoundedPayload({
    schema_version: "generic_agent_reviewer_context_v0_15",
    role: "independent_reviewer",
    goal: task.goal,
    success_criteria: task.success_criteria,
    relevant_files: task.relevant_files,
    changed_files: task.changed_files,
    diff_summary: task.diff_summary,
    test_state: task.test_state,
    evidence: task.acceptance_evidence,
    open_risks: task.open_risks,
    required_tools: task.required_tools,
    available_tools: task.available_tools,
    legacy_history: task.legacy_history,
  });
}

function optimizedWorkerPayload(plan, workerIndex, workerCount) {
  return serializeBoundedPayload({
    schema_version: "agentic_worker_delta_context_v0_16",
    role: "worker",
    workstream: `workstream-${workerIndex + 1}`,
    work_capsule_hash: plan.work_capsule.capsule_hash,
    goal: plan.work_capsule.capsule.goal,
    success_criteria: plan.work_capsule.capsule.success_criteria,
    completed: plan.work_capsule.capsule.completed,
    open_risks: plan.work_capsule.capsule.open_risks,
    assigned_files: plan.plan.context.relevant_files.filter(
      (_, index) => index % workerCount === workerIndex,
    ),
    changed_files: plan.work_capsule.capsule.changed_files,
    next_action: plan.work_capsule.capsule.next_action,
    selected_tools: plan.plan.tools.selected,
    checkpoint_resume: plan.plan.retry.resume_from_checkpoint,
    legacy_history: [],
  });
}

function optimizedReviewerPayload(plan) {
  return serializeBoundedPayload({
    schema_version: "agentic_selective_reviewer_context_v0_16",
    role: "independent_reviewer",
    reviewer_context: plan.plan.reviewer.context,
    selected_tools: plan.plan.tools.selected,
    legacy_history: [],
  });
}

function createProductionGenericPlan({
  benchmarkCase,
  phase,
  workerPayloads,
  reviewerPayload = null,
  now,
}) {
  if (workerPayloads.length === 0 && reviewerPayload === null) {
    return {
      plan: null,
      payloads: [],
      worker_count: 0,
      reviewer_count: 0,
    };
  }
  let idSequence = 0;
  const orchestrator = createGenericAgentOrchestrator({
    maxConcurrent: 6,
    now: () => new Date(now).toISOString(),
    idFactory: () => `${benchmarkCase.case_id}-${phase}-${++idSequence}`,
  });
  const workerIds = workerPayloads.map((_, index) => `${phase}-worker-${index + 1}`);
  const workers = workerPayloads.map((payload, index) => ({
    worker_id: workerIds[index],
    agent_id: `${phase}-agent-${index + 1}`,
    task: payload.serialized,
    dependencies: [],
    branch_depth: 0,
  }));
  if (reviewerPayload) {
    workers.push({
      worker_id: `${phase}-reviewer`,
      agent_id: `${phase}-independent-reviewer`,
      task: reviewerPayload.serialized,
      dependencies: workerIds,
      branch_depth: 0,
    });
  }
  const plan = orchestrator.createPlan({
    tenant_id: "tenant-agentic-benchmark",
    run_id: `${benchmarkCase.case_id}-${phase}`,
    workers,
  });
  return {
    plan,
    payloads: reviewerPayload ? [...workerPayloads, reviewerPayload] : workerPayloads,
    worker_count: workerPayloads.length,
    reviewer_count: reviewerPayload ? 1 : 0,
  };
}

function taskPayloads(planResult) {
  return planResult.plan?.workers?.map((worker) => worker.task) || [];
}

function repeatedTaskUnits(planResult) {
  const payloads = taskPayloads(planResult)
    .map((serialized) => {
      const parsed = JSON.parse(serialized);
      if (parsed.role !== "worker") return null;
      return benchmarkDigest({
        ...parsed,
        workstream: null,
      });
    })
    .filter(Boolean);
  return payloads.length - new Set(payloads).size;
}

function phaseMetrics(planResult, latencyMs, { earlyStopped = false } = {}) {
  const payloads = taskPayloads(planResult);
  const contextTokens = payloads.reduce((sum, payload) => sum + estimatedTokens(payload), 0);
  const truncations = planResult.payloads.filter((payload) => payload.runtime_limit_truncated);
  return {
    usage_source: "estimated",
    estimation_method: "production_generic_orchestrator_serialized_context_v1",
    input_tokens: contextTokens,
    output_tokens: 0,
    cached_tokens: 0,
    invocations: planResult.worker_count + planResult.reviewer_count,
    context_resent_tokens: contextTokens,
    duplicate_work_units: repeatedTaskUnits(planResult),
    agent_count: planResult.worker_count,
    reviewer_count: planResult.reviewer_count,
    tool_calls: 0,
    tool_calls_measured: false,
    provider_calls: 0,
    latency_ms: latencyMs,
    early_stopped: earlyStopped,
    generic_orchestrator_invoked: planResult.plan !== null,
    history_events_included: planResult.payloads.reduce(
      (sum, payload) => sum + payload.history_events_included,
      0,
    ),
    history_events_total: planResult.payloads.reduce(
      (sum, payload) => sum + payload.history_events_total,
      0,
    ),
    runtime_limit_truncation_count: truncations.length,
  };
}

function planQuality({
  benchmarkCase,
  agenticPlan,
  genericPlan,
  phase,
}) {
  const task = benchmarkCase.task_snapshot;
  const earlyStopped = phase === "optimized"
    && agenticPlan?.plan?.early_stop?.allowed === true;
  const parsed = taskPayloads(genericPlan).map((payload) => JSON.parse(payload));
  const workers = parsed.filter((payload) => payload.role === "worker");
  const reviewers = parsed.filter((payload) => payload.role === "independent_reviewer");
  const toolsPreserved = earlyStopped || workers.every((payload) => {
    const available = new Set(payload.available_tools || payload.selected_tools || []);
    return task.required_tools.every((tool) => available.has(tool));
  });
  const independentWorkPreserved = earlyStopped
    || benchmarkCase.category !== "true_multi_agent"
    || workers.length >= benchmarkCase.workload.minimum_independent_agents;
  const criticalReviewPreserved = benchmarkCase.category !== "critical"
    || (earlyStopped
      ? agenticPlan.plan.early_stop.critical_review_satisfied === true
      : reviewers.length === 1);
  const criteriaPreserved = earlyStopped || workers.every((payload) => {
    const criteria = payload.success_criteria || payload.capsule?.success_criteria || [];
    return task.success_criteria.every((criterion) => criteria.includes(criterion));
  });
  const noExecution = genericPlan.plan === null
    || genericPlan.plan.workers.every((worker) => worker.status === "pending");
  const safeAgenticBoundary = phase === "baseline"
    || (
      agenticPlan.execution_authorized === false
      && agenticPlan.audit.raw_prompt_stored === false
      && agenticPlan.audit.secret_stored === false
    );
  const all = toolsPreserved
    && independentWorkPreserved
    && criticalReviewPreserved
    && criteriaPreserved
    && noExecution
    && safeAgenticBoundary;
  return {
    score: all ? 1 : 0.75,
    guardrails_preserved: all,
    evidence_kind: "structural_replay_estimated",
    checks: {
      tools_preserved: toolsPreserved,
      independent_work_preserved: independentWorkPreserved,
      critical_review_preserved: criticalReviewPreserved,
      success_criteria_preserved: criteriaPreserved,
      no_execution: noExecution,
      safe_agentic_boundary: safeAgenticBoundary,
      early_stop_verified: earlyStopped
        ? agenticPlan.plan.early_stop.trusted_acceptance_verified === true
        : null,
    },
  };
}

function categoryReport(rows, category) {
  const selected = rows.filter((row) => row.category === category);
  const total = (field, phase) => selected.reduce((sum, row) => sum + row[phase][field], 0);
  const reduction = (field) => {
    const baseline = total(field, "baseline");
    const optimized = total(field, "optimized");
    return baseline === 0 ? null : Number((((baseline - optimized) / baseline) * 100).toFixed(2));
  };
  return {
    case_count: selected.length,
    task_success_rate: selected.length
      ? Number((
        selected.filter((row) => (
          row.baseline_quality_evidence.guardrails_preserved
          && row.optimized_quality_evidence.guardrails_preserved
        )).length / selected.length
      ).toFixed(4))
      : 0,
    input_token_estimate_reduction_percent: reduction("input_tokens"),
    context_resend_reduction_percent: reduction("context_resent_tokens"),
    invocation_reduction_percent: reduction("invocations"),
    duplicate_work_reduction_percent: reduction("duplicate_work_units"),
    tool_call_reduction_percent: reduction("tool_calls"),
    baseline_latency_ms: Number(
      selected.reduce((sum, row) => sum + row.baseline.latency_ms, 0).toFixed(4),
    ),
    optimized_latency_ms: Number(
      selected.reduce((sum, row) => sum + row.optimized.latency_ms, 0).toFixed(4),
    ),
  };
}

export function executePairedAgenticEfficiencyBenchmark({
  corpus = buildAgenticEfficiencyCorpus(),
  repositorySnapshot,
  rateCard,
  now = new Date("2026-07-27T20:00:00.000Z"),
} = {}) {
  if (!/^sha256:[a-f0-9]{64}$/.test(String(repositorySnapshot || ""))) {
    throw new Error("agentic_benchmark_repository_snapshot_invalid");
  }
  const rubricDigest = benchmarkDigest({
    version: "agentic_orchestrator_replay_quality_rubric_v2",
    checks: [
      "required_tools_preserved",
      "independent_work_preserved",
      "critical_review_preserved",
      "success_criteria_preserved",
      "security_and_no_execution_preserved",
    ],
  });
  const rows = [];
  for (const benchmarkCase of corpus) {
    const task = clone(benchmarkCase.task_snapshot);
    const { legacy_history: _legacyHistory, ...plannerTask } = task;
    const context = {
      tenantId: "tenant-agentic-benchmark",
      clientType: "codex",
      audience: "codex_internal",
      actorId: "evaluation-performance-agent",
    };
    const verification = {
      receiptDigest: benchmarkDigest({
        case_id: benchmarkCase.case_id,
        repository_snapshot: repositorySnapshot,
        rubric_digest: rubricDigest,
      }),
      acceptanceVerified: true,
      testsVerified: true,
      evidenceVerified: true,
      securityTestsVerified: true,
      humanReviewVerified: benchmarkCase.category === "critical",
      criticalTaskVerified: benchmarkCase.category === "critical",
      hostModelControlVerified: false,
    };
    let baselineResult;
    let optimizedResult;
    let baseline;
    let optimized;
    let agenticPlan;
    const runBaseline = () => {
      const startedAt = process.hrtime.bigint();
      const workerPayloads = Array.from(
        { length: task.requested_agent_count },
        (_, index) => baselineWorkerPayload(task, index, task.requested_agent_count),
      );
      baselineResult = createProductionGenericPlan({
        benchmarkCase,
        phase: "baseline",
        workerPayloads,
        reviewerPayload: task.reviewer_required ? baselineReviewerPayload(task) : null,
        now,
      });
      baseline = phaseMetrics(baselineResult, elapsedMs(startedAt));
    };
    const runOptimized = () => {
      const startedAt = process.hrtime.bigint();
      agenticPlan = buildAgenticEfficiencyPlan({
        trustedContext: context,
        trustedVerification: verification,
        request: plannerTask,
        now,
        mode: "active",
      });
      const earlyStopped = agenticPlan.plan.early_stop.allowed === true;
      const workerPayloads = earlyStopped
        ? []
        : Array.from(
          { length: agenticPlan.plan.agent_count },
          (_, index) => optimizedWorkerPayload(
            agenticPlan,
            index,
            agenticPlan.plan.agent_count,
          ),
        );
      optimizedResult = createProductionGenericPlan({
        benchmarkCase,
        phase: "optimized",
        workerPayloads,
        reviewerPayload: !earlyStopped && agenticPlan.plan.reviewer.mandatory
          ? optimizedReviewerPayload(agenticPlan)
          : null,
        now,
      });
      optimized = phaseMetrics(
        optimizedResult,
        elapsedMs(startedAt),
        { earlyStopped },
      );
      optimized.suppressed_agent_count = agenticPlan.plan.suppressed_agent_count;
    };
    if (benchmarkCase.measurement_contract.baseline_first_alternation) {
      runBaseline();
      runOptimized();
    } else {
      runOptimized();
      runBaseline();
    }
    const baselineQuality = planQuality({
      benchmarkCase,
      agenticPlan: null,
      genericPlan: baselineResult,
      phase: "baseline",
    });
    const optimizedQuality = planQuality({
      benchmarkCase,
      agenticPlan,
      genericPlan: optimizedResult,
      phase: "optimized",
    });
    rows.push({
      case_id: benchmarkCase.case_id,
      category: benchmarkCase.category,
      repository_snapshot: repositorySnapshot,
      rubric_digest: rubricDigest,
      baseline,
      optimized,
      baseline_quality: baselineQuality.score,
      optimized_quality: optimizedQuality.score,
      critical_guardrails_preserved: optimizedQuality.guardrails_preserved,
      baseline_quality_evidence: baselineQuality,
      optimized_quality_evidence: optimizedQuality,
      orchestration_evidence: {
        baseline_pipeline: "createGenericAgentOrchestrator",
        optimized_pipeline: optimizedResult.plan
          ? "buildAgenticEfficiencyPlan+createGenericAgentOrchestrator"
          : "buildAgenticEfficiencyPlan:verified_early_stop",
        same_task_snapshot: true,
        same_acceptance_rubric: true,
      },
    });
  }
  const scorecard = evaluateAgenticEfficiency({
    corpus,
    measurements: rows,
    rate_card: rateCard,
  });
  const categories = Object.fromEntries(
    Object.keys(buildAgenticEfficiencyManifest(corpus).categories)
      .map((category) => [category, categoryReport(rows, category)]),
  );
  return {
    schema_version: AI_AGENTIC_INTEGRATED_BENCHMARK_VERSION,
    evidence_kind: "integrated_replay_estimated",
    usage_kind: "estimated",
    quality_evidence_kind: "structural_replay_estimated",
    provider_calls_executed: 0,
    actual_provider_credits_observed: false,
    actual_savings_claimed: false,
    release_economic_targets_verified: false,
    shadow_required: true,
    repository_snapshot: repositorySnapshot,
    corpus_digest: buildAgenticEfficiencyManifest(corpus).corpus_digest,
    rubric_digest: rubricDigest,
    paired_case_count: rows.length,
    same_snapshot_for_every_pair: rows.every(
      (row) => row.repository_snapshot === repositorySnapshot,
    ),
    same_rubric_for_every_pair: rows.every((row) => row.rubric_digest === rubricDigest),
    quality_non_degradation: rows.every(
      (row) => (
        row.baseline_quality_evidence.guardrails_preserved
        && row.optimized_quality_evidence.guardrails_preserved
      ),
    ),
    measurement_limits: [
      "No provider model or agent execution was performed.",
      "Token and cost values are serialized-context estimates, not provider usage.",
      "Quality evidence covers structural orchestration invariants, not semantic output quality.",
      "Duplicate-work and tool-call savings are not claimed when no execution was observed.",
    ],
    categories,
    scorecard,
    measurements: rows,
  };
}
