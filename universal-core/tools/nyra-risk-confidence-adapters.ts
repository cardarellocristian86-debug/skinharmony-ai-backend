import type {
  NyraRiskInput,
  NyraRiskOutput,
} from "./nyra-risk-confidence-core.ts";

export type MailSendInput = {
  has_error: boolean;
  retry_count: number;
  recipient_count: number;
  confirmed: boolean;
};

export type RuntimeBatchInput = {
  success_rate: number;
  avg_latency: number;
  error_rate: number;
  semantic_intent?:
    | "generic"
    | "basic_need"
    | "economic_danger"
    | "relational_simple"
    | "open_help";
  semantic_mode?: string;
  urgency_hint?: number;
};

export type MacActionConfirmedInput = {
  confirmed: boolean;
  destructive: boolean;
  system_level: boolean;
};

export type RenderCheckInput = {
  status: "ok" | "degraded" | "down";
  response_time: number;
};

export type WordpressWorkflowInput = {
  step: "draft" | "publish" | "deploy";
  success: boolean;
  retries: number;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function adaptMailSendToRisk(input: MailSendInput): NyraRiskInput {
  return {
    confidence: input.confirmed ? 0.9 : 0.6,
    error_probability: input.has_error ? 0.7 : 0.2,
    impact: clamp(input.recipient_count / 50),
    reversibility: 0.6,
    uncertainty: input.retry_count > 0 ? 0.5 : 0.2,
  };
}

export function adaptRuntimeBatchToRisk(input: RuntimeBatchInput): NyraRiskInput {
  const semanticIntent = input.semantic_intent ?? "generic";
  const semanticMode = input.semantic_mode ?? "";
  const urgencyHint = clamp(input.urgency_hint ?? 0);

  let impact = clamp(input.avg_latency / 2000);
  let reversibility = 0.8;
  let uncertainty = clamp(1 - input.success_rate);

  if (semanticIntent === "basic_need") {
    impact = Math.max(impact, 0.55);
    reversibility = semanticMode === "pain_need" ? 0.35 : 0.75;
    uncertainty = Math.min(uncertainty, 0.35);
  }

  if (semanticIntent === "economic_danger") {
    impact = Math.max(impact, semanticMode === "cost_coverage_pressure" ? 0.82 : 0.74);
    reversibility = semanticMode === "resource_exhaustion" ? 0.4 : 0.55;
    uncertainty = Math.max(uncertainty, urgencyHint * 0.5);
  }

  if (semanticIntent === "relational_simple") {
    impact = Math.max(impact, 0.42);
    reversibility = 0.7;
    uncertainty = Math.min(uncertainty, 0.4);
  }

  if (semanticIntent === "open_help") {
    impact = Math.max(impact, semanticMode === "financial_reflection" ? 0.64 : 0.45);
    reversibility = semanticMode === "financial_reflection" ? 0.58 : 0.72;
    uncertainty =
      semanticMode === "financial_reflection"
        ? Math.max(uncertainty, urgencyHint * 0.4)
        : Math.min(uncertainty, 0.42);
  }

  return {
    confidence: clamp(input.success_rate),
    error_probability: clamp(input.error_rate),
    impact,
    reversibility,
    uncertainty,
  };
}

export function adaptMacActionToRisk(input: MacActionConfirmedInput): NyraRiskInput {
  const baseImpact = input.destructive ? 0.9 : 0.4;

  return {
    confidence: input.confirmed ? 0.95 : 0.5,
    error_probability: input.confirmed ? 0.2 : 0.6,
    impact: input.system_level ? 1 : baseImpact,
    reversibility: input.destructive ? 0.1 : 0.7,
    uncertainty: input.confirmed ? 0.2 : 0.6,
  };
}

export function adaptRenderCheckToRisk(input: RenderCheckInput): NyraRiskInput {
  let errorProbability = 0.1;
  let impact = 0.3;

  if (input.status === "degraded") {
    errorProbability = 0.4;
    impact = 0.5;
  }

  if (input.status === "down") {
    errorProbability = 0.8;
    impact = 0.9;
  }

  return {
    confidence: input.status === "ok" ? 0.9 : 0.5,
    error_probability: errorProbability,
    impact,
    reversibility: 0.7,
    uncertainty: clamp(input.response_time / 3000),
  };
}

export function adaptWordpressWorkflowToRisk(input: WordpressWorkflowInput): NyraRiskInput {
  const impactMap = {
    draft: 0.2,
    publish: 0.6,
    deploy: 0.9,
  } as const;

  return {
    confidence: input.success ? 0.9 : 0.5,
    error_probability: input.success ? 0.2 : 0.7,
    impact: impactMap[input.step],
    reversibility: input.step === "draft" ? 0.9 : 0.5,
    uncertainty: clamp(input.retries * 0.2),
  };
}

export function evaluateWithRiskCore(
  adapterInput: NyraRiskInput,
  riskCore: (input: NyraRiskInput) => NyraRiskOutput,
): NyraRiskOutput {
  return riskCore(adapterInput);
}
