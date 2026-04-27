export type NyraExpectedOutcome = {
  task: string;
  expected_state: "shadow_active" | "pending_confirmation" | "rejected";
  expected_target_device?: "phone" | "tablet" | "pc";
  expected_auto_entry?: boolean;
};

export type NyraActualOutcome = {
  actual_state?: "shadow_active" | "pending_confirmation" | "rejected";
  actual_target_device?: "phone" | "tablet" | "pc";
  actual_auto_entry?: boolean;
  device_attached?: boolean;
  shadow_runtime_active?: boolean;
};

export type NyraExecutionValidation = {
  version: "nyra_execution_validation_v1";
  gap_score: number;
  status: "pass" | "retry" | "fallback" | "escalate";
  checks: {
    state_match: boolean;
    target_match: boolean;
    auto_entry_match: boolean;
    attachment_ok: boolean;
    shadow_ok: boolean;
  };
  reasons: string[];
};

function boolPenalty(ok: boolean, penalty: number): number {
  return ok ? 0 : penalty;
}

export function validateNyraExecution(
  expected: NyraExpectedOutcome,
  actual: NyraActualOutcome,
): NyraExecutionValidation {
  const stateMatch = actual.actual_state === expected.expected_state;
  const targetMatch = !expected.expected_target_device || actual.actual_target_device === expected.expected_target_device;
  const autoEntryMatch = expected.expected_auto_entry === undefined || actual.actual_auto_entry === expected.expected_auto_entry;
  const attachmentOk = actual.device_attached !== false;
  const shadowOk =
    expected.expected_state !== "shadow_active" ||
    actual.shadow_runtime_active === true ||
    actual.actual_state === "shadow_active";

  const reasons: string[] = [];
  if (!stateMatch) reasons.push("state_mismatch");
  if (!targetMatch) reasons.push("target_device_mismatch");
  if (!autoEntryMatch) reasons.push("auto_entry_mismatch");
  if (!attachmentOk) reasons.push("device_not_attached");
  if (!shadowOk) reasons.push("shadow_not_active");

  const gapScore =
    boolPenalty(stateMatch, 36) +
    boolPenalty(targetMatch, 18) +
    boolPenalty(autoEntryMatch, 14) +
    boolPenalty(attachmentOk, 22) +
    boolPenalty(shadowOk, 30);

  const status =
    gapScore === 0 ? "pass" :
    gapScore <= 36 ? "retry" :
    gapScore <= 68 ? "fallback" :
    "escalate";

  return {
    version: "nyra_execution_validation_v1",
    gap_score: gapScore,
    status,
    checks: {
      state_match: stateMatch,
      target_match: targetMatch,
      auto_entry_match: autoEntryMatch,
      attachment_ok: attachmentOk,
      shadow_ok: shadowOk,
    },
    reasons,
  };
}
