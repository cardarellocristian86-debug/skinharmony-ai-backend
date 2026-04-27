import type {
  NyraRiskInput,
  NyraRiskOutput,
} from "./nyra-risk-confidence-core.ts";
import { computeNyraRisk } from "./nyra-risk-confidence-core.ts";

import {
  adaptMailSendToRisk,
  adaptRuntimeBatchToRisk,
  adaptMacActionToRisk,
  adaptRenderCheckToRisk,
  adaptWordpressWorkflowToRisk,
} from "./nyra-risk-confidence-adapters.ts";
import {
  validateMailResult,
  validateRuntimeBatchResult,
  validateMacActionResult,
  validateRenderCheckResult,
  validateWordpressWorkflowResult,
} from "./nyra-validation-adapters.ts";
import type {
  MailTaskResult,
  MacActionTaskResult,
  RenderCheckTaskResult,
  RuntimeBatchTaskResult,
  WordpressWorkflowTaskResult,
} from "./nyra-task-result-contracts.ts";

export type NyraGovernorInput<TAdapter> = {
  task_type:
    | "mail_send"
    | "runtime_batch"
    | "mac_action"
    | "render_check"
    | "wordpress_workflow";
  adapter_input: TAdapter;
  expected?: Record<string, unknown>;
  actual?: Record<string, unknown>;
};

export type NyraGovernorOutput = {
  risk: {
    score: number;
    band: "low" | "medium" | "high" | "blocked";
  };
  validation?: {
    status: "pass" | "retry" | "fallback" | "escalate";
    gap_score: number;
  };
  decision: "allow" | "retry" | "fallback" | "escalate" | "block";
  reason: string;
};

function mapAdapterToRiskInput(
  taskType: NyraGovernorInput<unknown>["task_type"],
  adapterInput: unknown,
): NyraRiskInput {
  switch (taskType) {
    case "mail_send":
      return adaptMailSendToRisk(adapterInput as Parameters<typeof adaptMailSendToRisk>[0]);
    case "runtime_batch":
      return adaptRuntimeBatchToRisk(adapterInput as Parameters<typeof adaptRuntimeBatchToRisk>[0]);
    case "mac_action":
      return adaptMacActionToRisk(adapterInput as Parameters<typeof adaptMacActionToRisk>[0]);
    case "render_check":
      return adaptRenderCheckToRisk(adapterInput as Parameters<typeof adaptRenderCheckToRisk>[0]);
    case "wordpress_workflow":
      return adaptWordpressWorkflowToRisk(adapterInput as Parameters<typeof adaptWordpressWorkflowToRisk>[0]);
  }
}

function validateByTaskType(
  taskType: NyraGovernorInput<unknown>["task_type"],
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): {
  status: "pass" | "retry" | "fallback" | "escalate";
  gap_score: number;
} {
  switch (taskType) {
    case "mail_send":
      return validateMailResult(expected as MailTaskResult, actual as MailTaskResult);
    case "runtime_batch":
      return validateRuntimeBatchResult(expected as RuntimeBatchTaskResult, actual as RuntimeBatchTaskResult);
    case "mac_action":
      return validateMacActionResult(expected as MacActionTaskResult, actual as MacActionTaskResult);
    case "render_check":
      return validateRenderCheckResult(expected as RenderCheckTaskResult, actual as RenderCheckTaskResult);
    case "wordpress_workflow":
      return validateWordpressWorkflowResult(expected as WordpressWorkflowTaskResult, actual as WordpressWorkflowTaskResult);
  }
}

function deriveDecision(
  risk: NyraRiskOutput,
  riskInput: NyraRiskInput,
  validation?: {
    status: "pass" | "retry" | "fallback" | "escalate";
    gap_score: number;
  },
): {
  decision: NyraGovernorOutput["decision"];
  reason: string;
} {
  if (risk.band === "blocked") {
    return {
      decision: "block",
      reason: "Risk score in blocked band",
    };
  }

  if (validation?.status === "escalate") {
    return {
      decision: "escalate",
      reason: "Validation escalation",
    };
  }

  if (
    risk.band === "high" &&
    riskInput.impact > 0.7 &&
    riskInput.reversibility < 0.3
  ) {
    return {
      decision: "escalate",
      reason: "High risk with high impact and low reversibility",
    };
  }

  if (
    validation?.status === "fallback" ||
    (risk.band === "high" && riskInput.reversibility >= 0.3) ||
    risk.should_fallback
  ) {
    return {
      decision: "fallback",
      reason: "Fallback triggered by risk or validation",
    };
  }

  if (risk.should_retry || validation?.status === "retry") {
    return {
      decision: "retry",
      reason: "Retry condition met",
    };
  }

  return {
    decision: "allow",
    reason: "Risk acceptable and validation passed",
  };
}

export function runNyraActionGovernor<TAdapter>(
  input: NyraGovernorInput<TAdapter>,
): NyraGovernorOutput {
  const riskInput = mapAdapterToRiskInput(
    input.task_type,
    input.adapter_input,
  );

  const riskResult = computeNyraRisk(riskInput);

  let validation:
    | {
        status: "pass" | "retry" | "fallback" | "escalate";
        gap_score: number;
      }
    | undefined;

  if (input.expected && input.actual) {
    validation = validateByTaskType(input.task_type, input.expected, input.actual);
  }

  const { decision, reason } = deriveDecision(riskResult, riskInput, validation);

  return {
    risk: {
      score: riskResult.risk_score,
      band: riskResult.band,
    },
    validation,
    decision,
    reason,
  };
}
