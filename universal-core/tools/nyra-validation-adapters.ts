import type {
  MailTaskResult,
  MacActionTaskResult,
  RenderCheckTaskResult,
  RuntimeBatchTaskResult,
  WordpressWorkflowTaskResult,
} from "./nyra-task-result-contracts.ts";

export type ValidationResult = {
  status: "pass" | "retry" | "fallback" | "escalate";
  gap_score: number;
  details?: Record<string, unknown>;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function deriveStatus(gap: number): ValidationResult["status"] {
  if (gap < 0.1) return "pass";
  if (gap < 0.3) return "retry";
  if (gap < 0.6) return "fallback";
  return "escalate";
}

function compareFields(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  weights?: Record<string, number>,
): number {
  let totalWeight = 0;
  let mismatchWeight = 0;

  for (const key of Object.keys(expected)) {
    const weight = weights?.[key] ?? 1;
    totalWeight += weight;

    if (expected[key] !== actual[key]) {
      mismatchWeight += weight;
    }
  }

  if (totalWeight === 0) return 0;
  return clamp(mismatchWeight / totalWeight);
}

function normalizedDelta(expected: number, actual: number, tolerance: number): number {
  if (!Number.isFinite(expected) || !Number.isFinite(actual) || tolerance <= 0) return 1;
  return clamp(Math.abs(expected - actual) / tolerance);
}

export function validateMailResult(
  expected: MailTaskResult,
  actual: MailTaskResult,
): ValidationResult {
  const weights = {
    delivered: 3,
    recipient_count: 2,
    error: 3,
  };

  const gap = compareFields(expected as Record<string, unknown>, actual as Record<string, unknown>, weights);

  return {
    status: deriveStatus(gap),
    gap_score: gap,
    details: { domain: "mail" },
  };
}

export function validateRuntimeBatchResult(
  expected: RuntimeBatchTaskResult,
  actual: RuntimeBatchTaskResult,
): ValidationResult {
  const successPenalty = expected.success === actual.success ? 0 : 0.22;
  const successRateDelta = normalizedDelta(expected.success_rate, actual.success_rate, 0.1);
  const errorRateDelta = normalizedDelta(expected.error_rate, actual.error_rate, 0.1);
  const latencyDelta = normalizedDelta(expected.avg_latency, actual.avg_latency, 500);
  const failedJobsDelta = normalizedDelta(expected.failed_jobs, actual.failed_jobs, 20);

  let changedSignals = 0;
  if (successRateDelta > 0.2) changedSignals += 1;
  if (errorRateDelta > 0.2) changedSignals += 1;
  if (latencyDelta > 0.2) changedSignals += 1;
  if (failedJobsDelta > 0.2) changedSignals += 1;

  const consistencyPenalty = changedSignals >= 3 ? 0.06 : changedSignals === 2 ? 0.03 : 0;

  const gap = clamp(
    successPenalty +
      successRateDelta * 0.25 +
      errorRateDelta * 0.2 +
      latencyDelta * 0.15 +
      failedJobsDelta * 0.05 +
      consistencyPenalty,
  );

  return {
    status: deriveStatus(gap),
    gap_score: gap,
    details: {
      domain: "runtime_batch",
      success_penalty: successPenalty,
      consistency_penalty: consistencyPenalty,
      changed_signals: changedSignals,
    },
  };
}

export function validateMacActionResult(
  expected: MacActionTaskResult,
  actual: MacActionTaskResult,
): ValidationResult {
  const weights = {
    confirmed: 3,
    executed: 3,
    error: 3,
  };

  const gap = compareFields(expected as Record<string, unknown>, actual as Record<string, unknown>, weights);

  return {
    status: deriveStatus(gap),
    gap_score: gap,
    details: { domain: "mac_action" },
  };
}

export function validateRenderCheckResult(
  expected: RenderCheckTaskResult,
  actual: RenderCheckTaskResult,
): ValidationResult {
  const successPenalty = expected.success === actual.success ? 0 : 0.18;
  const statusPenalty = expected.status === actual.status ? 0 : 0.22;
  const latencyDelta = normalizedDelta(expected.response_time, actual.response_time, 700);
  const severeLatencyPenalty =
    expected.status === actual.status &&
    actual.status === "degraded" &&
    actual.response_time >= expected.response_time + 220
      ? 0.14
      : 0;

  const gap = clamp(successPenalty + statusPenalty + latencyDelta * 0.22 + severeLatencyPenalty);

  return {
    status: deriveStatus(gap),
    gap_score: gap,
    details: {
      domain: "render",
      success_penalty: successPenalty,
      status_penalty: statusPenalty,
      severe_latency_penalty: severeLatencyPenalty,
    },
  };
}

export function validateWordpressWorkflowResult(
  expected: WordpressWorkflowTaskResult,
  actual: WordpressWorkflowTaskResult,
): ValidationResult {
  const weights = {
    step: 2,
    success: 3,
    retries: 2,
  };

  const gap = compareFields(expected as Record<string, unknown>, actual as Record<string, unknown>, weights);

  return {
    status: deriveStatus(gap),
    gap_score: gap,
    details: { domain: "wordpress" },
  };
}
