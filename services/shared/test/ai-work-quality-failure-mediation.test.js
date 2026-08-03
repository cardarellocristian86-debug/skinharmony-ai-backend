import assert from "node:assert/strict";
import test from "node:test";
import {
  FAILURE_CODES,
  QUALITY_SECURITY_CONTRACT,
  buildFailureReceipt,
  classifyFailure,
  observeFailure,
  sanitizeObservation,
  verifyWorkEvidence,
} from "../ai-work-quality-failure-mediation.mjs";

test("uses exact failure codes and fails closed for unknown codes", () => {
  assert.equal(classifyFailure("PROMPT_INJECTION_DETECTED").action, "block");
  assert.equal(classifyFailure("PROMPT_INJECTION").action, "manual_review");
  assert.equal(classifyFailure("WRONG_BRANCH").retry_allowed, false);
  assert(FAILURE_CODES.includes("FALSE_COMPLETION_CLAIM"));
});

test("sanitizes observations and preserves tenant-scoped evidence only", () => {
  const result = sanitizeObservation({
    code: "SECRET_EXPOSURE_RISK",
    scope: { tenant_id: "codexai", repository: "owner/repo", branch: "main" },
    summary: "token=sk-proj-very-secret-value",
    evidence: [{ kind: "test", digest: "a".repeat(64), verified: true }],
  });
  assert.equal(result.tenant_id, "codexai");
  assert(!result.summary.includes("very-secret-value"));
  assert.equal(result.evidence[0].digest, "a".repeat(64));
});

test("blocks false completion without deterministic receipt", () => {
  const result = verifyWorkEvidence({
    worker_id: "worker-a",
    verifier_id: "verifier-b",
    scope: { tenant_id: "codexai", repository: "owner/repo", branch: "main" },
    expected: { completion: true, tests_required: true },
    actual: { tenant_id: "codexai", repository: "owner/repo", branch: "main" },
    evidence: { completion_receipt: false, tests_passed: false },
  });
  assert.equal(result.verified, false);
  assert(result.codes.includes("FALSE_COMPLETION_CLAIM"));
  assert(result.codes.includes("TEST_EVIDENCE_MISSING"));
});

test("blocks wrong branch and same-agent self verification", () => {
  const result = verifyWorkEvidence({
    worker_id: "agent-a",
    verifier_id: "agent-a",
    scope: { tenant_id: "codexai", repository: "owner/repo", branch: "main" },
    actual: { tenant_id: "codexai", repository: "owner/repo", branch: "feature" },
    evidence: {},
  });
  assert(result.codes.includes("WRONG_BRANCH"));
  assert(result.codes.includes("UNSUPPORTED_CLAIM"));
});

test("absolute failures quarantine and never execute", () => {
  const result = observeFailure({
    code: "PROMPT_INJECTION_DETECTED",
    scope: { tenant_id: "codexai", work_id: "w1" },
    attempt: 1,
  });
  assert.equal(result.quarantine, true);
  assert.equal(result.execution_allowed, false);
  assert.equal(result.core_verdict_required, true);
});

test("retry is bounded and becomes manual review", () => {
  const result = observeFailure({
    code: "STALE_LEASE",
    scope: { tenant_id: "codexai", work_id: "w1" },
    attempt: 3,
    attempt_limit: 3,
  });
  assert.equal(result.action, "manual_review");
});

test("contract is fail closed", () => {
  assert.equal(QUALITY_SECURITY_CONTRACT.default_execution_allowed, false);
  assert.equal(QUALITY_SECURITY_CONTRACT.core_is_final_authority, true);
});
