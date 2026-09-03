import { performance } from "node:perf_hooks";

const DEADLINE_BRAND = Symbol("github_worker_request_deadline");

function deadlineError() {
  const error = new Error("github_worker_request_deadline_exceeded");
  error.code = "github_worker_request_deadline_exceeded";
  error.kind = "timeout";
  error.status = 504;
  error.statusCode = 504;
  return error;
}

function positiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 1) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  return value;
}

export function createWorkerRequestDeadline({
  timeout_ms = 18_000,
  now = () => performance.now(),
} = {}) {
  const timeoutMs = positiveInteger(timeout_ms, "github_worker_request_deadline_invalid");
  if (typeof now !== "function") {
    const error = new Error("github_worker_request_deadline_clock_invalid");
    error.code = "github_worker_request_deadline_clock_invalid";
    throw error;
  }
  const startedAt = Number(now());
  if (!Number.isFinite(startedAt)) {
    const error = new Error("github_worker_request_deadline_clock_invalid");
    error.code = "github_worker_request_deadline_clock_invalid";
    throw error;
  }
  const expiresAt = startedAt + timeoutMs;
  let lastObservedAt = startedAt;
  return Object.freeze({
    [DEADLINE_BRAND]: true,
    timeout_ms: timeoutMs,
    remainingTimeoutMs(perRequestMaximumMs) {
      const maximum = positiveInteger(
        perRequestMaximumMs,
        "github_api_request_timeout_invalid",
      );
      const observedAt = Number(now());
      if (!Number.isFinite(observedAt)) {
        const error = new Error("github_worker_request_deadline_clock_invalid");
        error.code = "github_worker_request_deadline_clock_invalid";
        throw error;
      }
      // A wall clock moving backwards must never extend an execution budget.
      lastObservedAt = Math.max(lastObservedAt, observedAt);
      const remaining = Math.floor(expiresAt - lastObservedAt);
      if (remaining < 1) throw deadlineError();
      return Math.min(maximum, remaining);
    },
  });
}

export function remainingWorkerRequestTimeout(deadline, perRequestMaximumMs) {
  if (deadline === null || deadline === undefined) return perRequestMaximumMs;
  if (deadline?.[DEADLINE_BRAND] !== true ||
      typeof deadline.remainingTimeoutMs !== "function") {
    const error = new Error("github_worker_request_deadline_invalid");
    error.code = "github_worker_request_deadline_invalid";
    throw error;
  }
  return deadline.remainingTimeoutMs(perRequestMaximumMs);
}
