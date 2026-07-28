import { benchmarkDigest } from "./aiLearningFactoryBenchmark.js";

export const AI_AGENTIC_EFFICIENCY_COUNTS = Object.freeze({
  short: 25,
  medium: 30,
  long: 25,
  true_multi_agent: 10,
  critical: 10,
});

const GENERIC_TOOLS = Object.freeze([
  "checkpoint_read",
  "search_files",
  "read_file",
  "inspect_diff",
  "write_patch",
  "run_tests",
  "security_scan",
  "artifact_read",
  "review_evidence",
  "benchmark_read",
]);

function taskShape(category, ordinal) {
  const profile = {
    short: { files: 2, criteria: 2, requestedAgents: 1, workstreams: 1, requiredTools: 2, history: 6 },
    medium: { files: 8, criteria: 4, requestedAgents: 1, workstreams: 1, requiredTools: 4, history: 20 },
    long: { files: 30, criteria: 8, requestedAgents: 1, workstreams: 1, requiredTools: 5, history: 80 },
    true_multi_agent: { files: 16, criteria: 6, requestedAgents: 3, workstreams: 3, requiredTools: 5, history: 45 },
    critical: { files: 12, criteria: 6, requestedAgents: 2, workstreams: 2, requiredTools: 6, history: 40 },
  }[category];
  const files = Array.from(
    { length: profile.files },
    (_, index) => `src/generic/module-${String(index + 1).padStart(2, "0")}.js`,
  );
  const successCriteria = Array.from(
    { length: profile.criteria },
    (_, index) => `criterion-${category}-${ordinal}-${index + 1}`,
  );
  const checkpointed = ordinal % 3 === 0;
  const completed = ordinal % 5 === 0 ? [...successCriteria] : successCriteria.slice(0, Math.floor(successCriteria.length / 2));
  const normalized = {
    goal: `Verify bounded ${category.replaceAll("_", " ")} workload ${ordinal}`,
    scope: files,
    success_criteria: successCriteria,
    decisions: [`reuse-checkpoint-${checkpointed}`, "preserve-quality-and-security"],
    completed,
    open_risks: category === "critical" ? ["independent-review-required"] : ["verify-regression-coverage"],
    relevant_files: files,
    changed_files: files.slice(0, Math.max(1, Math.ceil(files.length / 5))),
    diff_summary: `Bounded generic diff ${category}-${ordinal}`,
    test_state: { passed: 4 + ordinal, failed: 0, pending: completed.length === successCriteria.length ? 0 : 1 },
    artifact_hashes: [],
    reusable_results: checkpointed ? [`verified-checkpoint-${category}-${ordinal}`] : [],
    next_action: completed.length === successCriteria.length ? "stop-after-verification" : "continue-bounded-work",
    budget: {
      token_limit: category === "long" ? 80_000 : 30_000,
      invocation_limit: 20,
      retry_limit: 3,
    },
    risk: category === "critical" ? "critical" : category === "long" ? "high" : "medium",
    reversibility: category === "critical" ? "difficult" : "bounded",
    separable: category === "true_multi_agent" || category === "critical",
    independent_workstreams: profile.workstreams,
    requested_agent_count: profile.requestedAgents,
    required_tools: GENERIC_TOOLS.slice(0, profile.requiredTools),
    available_tools: [...GENERIC_TOOLS],
    checkpoint: checkpointed ? { checkpoint_id: `checkpoint-${category}-${ordinal}`, verified: true } : null,
    retry_count: checkpointed ? 1 : 0,
    reviewer_required: category === "critical",
    security_tests_required: true,
    security_tests_passed: true,
    acceptance_evidence: [`evidence-${category}-${ordinal}`],
    quality_baseline: 1,
    quality_prediction: 1,
    critical: category === "critical",
    legacy_history: Array.from(
      { length: profile.history },
      (_, index) => `verified-history-event-${category}-${ordinal}-${index + 1}`,
    ),
  };
  return normalized;
}

function buildCasesForCategory(category, count, offset) {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1;
    return {
      schema_version: "ai_agentic_efficiency_case_v0_16",
      case_id: `efficiency-${category}-${String(ordinal).padStart(3, "0")}`,
      category,
      sequence: offset + ordinal,
      benchmark_evidence_kind: "synthetic_estimated",
      workload: {
        objective: `Generic ${category.replaceAll("_", " ")} governed workload ${ordinal}`,
        external_actions_allowed: false,
        autonomous_execution_allowed: false,
        tenant_scoped: true,
        evidence_required: category === "critical" || category === "true_multi_agent",
        minimum_independent_agents: category === "true_multi_agent" ? 2 : 1,
      },
      task_snapshot: taskShape(category, ordinal),
      measurement_contract: {
        paired_same_input: true,
        baseline_first_alternation: ordinal % 2 === 1,
        actual_or_estimated_label_required: true,
        rate_card_provenance_required: true,
        quality_score_required: true,
      },
    };
  });
}

export function buildAgenticEfficiencyCorpus() {
  let offset = 0;
  const corpus = [];
  for (const [category, count] of Object.entries(AI_AGENTIC_EFFICIENCY_COUNTS)) {
    corpus.push(...buildCasesForCategory(category, count, offset));
    offset += count;
  }
  return corpus;
}

export function buildAgenticEfficiencyManifest(corpus = buildAgenticEfficiencyCorpus()) {
  const normalized = {
    schema_version: "ai_agentic_efficiency_manifest_v0_16",
    total_cases: corpus.length,
    categories: Object.fromEntries(Object.entries(AI_AGENTIC_EFFICIENCY_COUNTS).map(([category, expected]) => {
      const cases = corpus.filter((item) => item.category === category);
      return [category, { case_count: cases.length, expected, digest: benchmarkDigest(cases) }];
    })),
    corpus_digest: benchmarkDigest(corpus),
    targets: {
      quality_loss_maximum: 0.02,
      median_overall_savings_percent_minimum: 25,
      median_long_savings_percent_minimum: 40,
      context_resend_reduction_percent_minimum: 60,
      duplicate_work_reduction_percent_minimum: 70,
      invocation_reduction_percent_minimum_when_measurable: 30,
    },
    cost_policy: {
      actual_cost_must_not_be_invented: true,
      usage_source_must_be_actual_or_estimated: true,
      costs_computed_from_provenanced_rate_card: true,
    },
    contains_customer_data: false,
    contains_secrets: false,
  };
  return normalized;
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field}_invalid`);
  return value;
}

function number(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < minimum || normalized > maximum || (integer && !Number.isInteger(normalized))) {
    throw new Error(`${field}_invalid`);
  }
  return normalized;
}

function reference(value, field, max = 240) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max || !/^[a-z0-9][a-z0-9._:@/-]*$/i.test(normalized)) {
    throw new Error(`${field}_invalid`);
  }
  return normalized;
}

function digestReference(value, field) {
  const normalized = String(value || "").trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) throw new Error(`${field}_invalid`);
  return normalized;
}

function rateCard(value) {
  const source = requireObject(value, "rate_card");
  const sourceUrl = String(source.source_url || "").trim();
  if (!/^https:\/\//i.test(sourceUrl)) throw new Error("rate_card_source_url_invalid");
  const effectiveAt = new Date(source.effective_at);
  const retrievedAt = new Date(source.retrieved_at);
  if (Number.isNaN(effectiveAt.getTime()) || Number.isNaN(retrievedAt.getTime())) throw new Error("rate_card_timestamp_invalid");
  const normalized = {
    provider: String(source.provider || "").trim(),
    model_id: String(source.model_id || "").trim(),
    currency: String(source.currency || "").trim().toUpperCase(),
    effective_at: effectiveAt.toISOString(),
    retrieved_at: retrievedAt.toISOString(),
    source_url: sourceUrl,
    provenance_digest: String(source.provenance_digest || "").trim(),
    input_per_million: number(source.input_per_million, "input_per_million"),
    cached_input_per_million: number(source.cached_input_per_million, "cached_input_per_million"),
    output_per_million: number(source.output_per_million, "output_per_million"),
  };
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized.provenance_digest)) {
    throw new Error("rate_card_provenance_digest_invalid");
  }
  return normalized;
}

function usage(value, field) {
  const source = requireObject(value, field);
  const usageSource = String(source.usage_source || "").trim();
  if (!["actual", "estimated"].includes(usageSource)) throw new Error(`${field}_usage_source_invalid`);
  const inputTokens = number(source.input_tokens, `${field}_input_tokens`, { integer: true });
  const cachedTokens = number(source.cached_tokens, `${field}_cached_tokens`, { integer: true });
  if (cachedTokens > inputTokens) throw new Error(`${field}_cached_tokens_invalid`);
  return {
    claimed_usage_source: usageSource,
    input_tokens: inputTokens,
    output_tokens: number(source.output_tokens, `${field}_output_tokens`, { integer: true }),
    cached_tokens: cachedTokens,
    invocations: number(source.invocations, `${field}_invocations`, { integer: true }),
    context_resent_tokens: number(source.context_resent_tokens, `${field}_context_resent_tokens`, { integer: true }),
    duplicate_work_units: number(source.duplicate_work_units, `${field}_duplicate_work_units`),
    claimed_estimation_method: usageSource === "estimated"
      ? reference(source.estimation_method, `${field}_estimation_method`)
      : null,
  };
}

export function agenticUsageDigest(usageRecord) {
  return benchmarkDigest({
    input_tokens: usageRecord.input_tokens,
    output_tokens: usageRecord.output_tokens,
    cached_tokens: usageRecord.cached_tokens,
    invocations: usageRecord.invocations,
    context_resent_tokens: usageRecord.context_resent_tokens,
    duplicate_work_units: usageRecord.duplicate_work_units,
  });
}

export function agenticQualityDigest({ case_id, baseline_quality, optimized_quality, critical_guardrails_preserved }) {
  return benchmarkDigest({
    case_id,
    baseline_quality,
    optimized_quality,
    critical_guardrails_preserved,
  });
}

function classifyUsage({ benchmarkCase, phase, usageRecord, trustedUsageResolver }) {
  const usageDigest = agenticUsageDigest(usageRecord);
  const eligibleForActual = (
    benchmarkCase.benchmark_evidence_kind === "provider_actual"
    && usageRecord.claimed_usage_source === "actual"
    && typeof trustedUsageResolver === "function"
  );
  if (eligibleForActual) {
    const attestation = trustedUsageResolver({
      case_id: benchmarkCase.case_id,
      phase,
      usage_digest: usageDigest,
    });
    if (
      attestation?.verified === true
      && attestation.usage_digest === usageDigest
    ) {
      return {
        ...usageRecord,
        usage_source: "actual",
        provider_usage_reference: reference(attestation.provider_usage_reference, `${phase}_provider_usage_reference`),
        provider_usage_digest: digestReference(attestation.provider_usage_digest, `${phase}_provider_usage_digest`),
        attestation_id: reference(attestation.attestation_id, `${phase}_attestation_id`),
        estimation_method: null,
      };
    }
  }
  return {
    ...usageRecord,
    usage_source: "estimated",
    provider_usage_reference: null,
    provider_usage_digest: null,
    attestation_id: null,
    estimation_method: usageRecord.claimed_usage_source === "estimated"
      ? usageRecord.claimed_estimation_method
      : "unverified_actual_claim",
  };
}

function computedCost(usageRecord, card) {
  const uncachedInput = usageRecord.input_tokens - usageRecord.cached_tokens;
  const cost = (
    uncachedInput * card.input_per_million
    + usageRecord.cached_tokens * card.cached_input_per_million
    + usageRecord.output_tokens * card.output_per_million
  ) / 1_000_000;
  return Number(cost.toFixed(8));
}

function reduction(baseline, optimized) {
  if (baseline <= 0) return null;
  return Number((((baseline - optimized) / baseline) * 100).toFixed(4));
}

function median(values) {
  const usable = values.filter((value) => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!usable.length) return null;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 === 0 ? Number(((usable[middle - 1] + usable[middle]) / 2).toFixed(4)) : usable[middle];
}

function aggregateReduction(rows, field) {
  const baseline = rows.reduce((sum, row) => sum + row.baseline[field], 0);
  const optimized = rows.reduce((sum, row) => sum + row.optimized[field], 0);
  return reduction(baseline, optimized);
}

/**
 * Evaluates paired measurements without accepting caller-supplied cost totals.
 * Cost is always derived from token usage and a provenance-bound rate card.
 */
export function evaluateAgenticEfficiency({
  corpus = buildAgenticEfficiencyCorpus(),
  measurements,
  rate_card,
  trusted_usage_resolver = null,
  trusted_quality_resolver = null,
} = {}) {
  if (!Array.isArray(measurements)) throw new Error("efficiency_measurements_invalid");
  if (measurements.length !== corpus.length) throw new Error("efficiency_measurement_count_invalid");
  const measurementIds = measurements.map((measurement) => measurement?.case_id);
  if (new Set(measurementIds).size !== measurementIds.length) throw new Error("efficiency_measurement_duplicate");
  const card = rateCard(rate_card);
  if (!card.provider || !card.model_id || !card.currency || !card.provenance_digest) throw new Error("rate_card_provenance_incomplete");
  const byId = new Map(measurements.map((measurement) => [measurement?.case_id, measurement]));
  const evaluated = corpus.map((benchmarkCase) => {
    const measurement = requireObject(byId.get(benchmarkCase.case_id), `measurement_${benchmarkCase.case_id}`);
    if ("actual_cost" in measurement || "baseline_cost" in measurement || "optimized_cost" in measurement) {
      throw new Error("caller_supplied_cost_forbidden");
    }
    const baseline = classifyUsage({
      benchmarkCase,
      phase: "baseline",
      usageRecord: usage(measurement.baseline, "baseline"),
      trustedUsageResolver: trusted_usage_resolver,
    });
    const optimized = classifyUsage({
      benchmarkCase,
      phase: "optimized",
      usageRecord: usage(measurement.optimized, "optimized"),
      trustedUsageResolver: trusted_usage_resolver,
    });
    const baselineCost = computedCost(baseline, card);
    const optimizedCost = computedCost(optimized, card);
    const baselineQuality = number(measurement.baseline_quality, "baseline_quality", { maximum: 1 });
    const optimizedQuality = number(measurement.optimized_quality, "optimized_quality", { maximum: 1 });
    const qualityLoss = Number(Math.max(0, baselineQuality - optimizedQuality).toFixed(4));
    const criticalPreserved = benchmarkCase.category !== "critical" || measurement.critical_guardrails_preserved === true;
    const qualityDigest = agenticQualityDigest({
      case_id: benchmarkCase.case_id,
      baseline_quality: baselineQuality,
      optimized_quality: optimizedQuality,
      critical_guardrails_preserved: criticalPreserved,
    });
    const qualityAttestation = (
      benchmarkCase.benchmark_evidence_kind === "provider_actual"
      && typeof trusted_quality_resolver === "function"
    ) ? trusted_quality_resolver({
      case_id: benchmarkCase.case_id,
      quality_digest: qualityDigest,
    }) : null;
    const qualityVerified = (
      qualityAttestation?.verified === true
      && qualityAttestation.quality_digest === qualityDigest
    );
    return {
      case_id: benchmarkCase.case_id,
      category: benchmarkCase.category,
      baseline,
      optimized,
      usage_classification: baseline.usage_source === "actual" && optimized.usage_source === "actual" ? "actual" : "estimated",
      baseline_computed_cost: baselineCost,
      optimized_computed_cost: optimizedCost,
      savings_percent: reduction(baselineCost, optimizedCost),
      quality_loss: qualityLoss,
      quality_target_met: qualityLoss <= 0.02,
      quality_evidence_kind: qualityVerified ? "provider_actual" : "synthetic_estimated",
      quality_attestation_id: qualityVerified
        ? reference(qualityAttestation.attestation_id, "quality_attestation_id")
        : null,
      critical_guardrails_preserved: criticalPreserved,
    };
  });

  const actualCount = evaluated.filter((row) => row.usage_classification === "actual").length;
  const medianOverall = median(evaluated.map((row) => row.savings_percent));
  const medianLong = median(evaluated.filter((row) => row.category === "long").map((row) => row.savings_percent));
  const contextReduction = aggregateReduction(evaluated, "context_resent_tokens");
  const duplicateReduction = aggregateReduction(evaluated, "duplicate_work_units");
  const invocationMeasurable = evaluated.filter((row) => row.baseline.invocations > 0);
  const invocationReduction = invocationMeasurable.length ? aggregateReduction(invocationMeasurable, "invocations") : null;
  const qualityTargetMet = evaluated.every((row) => row.quality_target_met && row.critical_guardrails_preserved);
  const qualityEvidenceComplete = evaluated.every((row) => row.quality_evidence_kind === "provider_actual");
  const efficiencyTargetsMet = (
    medianOverall >= 25
    && medianLong >= 40
    && contextReduction >= 60
    && duplicateReduction >= 70
    && (invocationReduction === null || invocationReduction >= 30)
  );
  const productionEvidenceComplete = actualCount === corpus.length;
  const benchmarkEvidenceKind = (
    productionEvidenceComplete
    && qualityEvidenceComplete
    && corpus.every((item) => item.benchmark_evidence_kind === "provider_actual")
  ) ? "provider_actual" : "synthetic_estimated";
  const productionSavingsClaimAllowed = (
    qualityTargetMet
    && qualityEvidenceComplete
    && efficiencyTargetsMet
    && productionEvidenceComplete
    && benchmarkEvidenceKind === "provider_actual"
  );

  return {
    schema_version: "ai_agentic_efficiency_scorecard_v0_16",
    corpus_digest: buildAgenticEfficiencyManifest(corpus).corpus_digest,
    rate_card: card,
    case_count: evaluated.length,
    actual_usage_case_count: actualCount,
    estimated_usage_case_count: evaluated.length - actualCount,
    benchmark_evidence_kind: benchmarkEvidenceKind,
    scorecard_status: productionSavingsClaimAllowed ? "provider_verified" : "shadow_candidate",
    median_overall_savings_percent: medianOverall,
    median_long_savings_percent: medianLong,
    context_resend_reduction_percent: contextReduction,
    duplicate_work_reduction_percent: duplicateReduction,
    invocation_reduction_percent: invocationReduction,
    maximum_quality_loss: Math.max(...evaluated.map((row) => row.quality_loss)),
    quality_target_met: qualityTargetMet,
    quality_evidence_complete: qualityEvidenceComplete,
    efficiency_targets_met: efficiencyTargetsMet,
    production_evidence_complete: productionEvidenceComplete,
    production_savings_claim_allowed: productionSavingsClaimAllowed,
    real_savings_verified: productionSavingsClaimAllowed,
    report_note: productionSavingsClaimAllowed
      ? "Provider usage and quality attestations reconciled."
      : "Estimated potential only; no real Codex or ChatGPT credit saving is claimed.",
    actual_costs_invented: false,
    evaluated,
  };
}
