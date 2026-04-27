import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalCoreOutput, UniversalDomain, UniversalSignal } from "../packages/contracts/src/index.ts";
import { runNyraActionGovernor, type NyraGovernorOutput } from "./nyra-action-governor.ts";

export type NormalizedSignal = {
  source: "erp" | "finance" | "sensor";
  severity: number;
  urgency: number;
  reliability: number;
  payload: Record<string, unknown>;
};

export type DomainAction =
  | "continue_workflow"
  | "review_order"
  | "hold_order"
  | "approve_transaction"
  | "review_transaction"
  | "block_payment"
  | "monitor_sensor"
  | "reduce_load"
  | "stop_machine";

export type DomainExecutionResult = {
  executed: boolean;
  action: DomainAction;
  target: string;
};

export interface DomainAdapter<TInput> {
  normalize(input: TInput): NormalizedSignal;
  execute(action: DomainAction, input: TInput, governor: NyraGovernorOutput): Promise<DomainExecutionResult>;
}

export type DomainRuntimeResult = {
  signal: NormalizedSignal;
  core_input: UniversalCoreInput;
  core_output: UniversalCoreOutput;
  governor_output: NyraGovernorOutput;
  action: DomainAction;
  execution: DomainExecutionResult;
};

type ErpInput = {
  overdue_days: number;
  client_value: number;
  workflow_blocked: boolean;
  record_id: string;
};

type FinanceInput = {
  amount: number;
  anomaly_score: number;
  confirmed: boolean;
  transaction_id: string;
};

type SensorInput = {
  temperature_c: number;
  rate_of_change: number;
  sensor_quality: number;
  line_id: string;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function scale100(value: number): number {
  return Math.round(clamp01(value) * 100);
}

function signal(
  id: string,
  category: string,
  label: string,
  value: number,
  extras: Partial<UniversalSignal> = {},
): UniversalSignal {
  return {
    id,
    source: "nyra_domain_runtime",
    category,
    label,
    value,
    normalized_score: value,
    severity_hint: value,
    confidence_hint: 80,
    reliability_hint: 80,
    friction_hint: value,
    risk_hint: value,
    reversibility_hint: 70,
    expected_value_hint: Math.max(0, 100 - value),
    ...extras,
  };
}

function deriveCoreDomain(source: NormalizedSignal["source"]): UniversalDomain {
  if (source === "erp") return "crm";
  return "assistant";
}

function buildCoreInput(signalInput: NormalizedSignal): UniversalCoreInput {
  const severity = scale100(signalInput.severity);
  const urgency = scale100(signalInput.urgency);
  const reliability = scale100(signalInput.reliability);
  const uncertainty = Math.max(0, 100 - reliability);

  return {
    request_id: `nyra-domain-runtime:${signalInput.source}:${Date.now()}`,
    generated_at: new Date().toISOString(),
    domain: deriveCoreDomain(signalInput.source),
    context: {
      actor_id: "nyra_domain_runtime",
      mode: "deterministic_domain_loop",
      metadata: {
        source: signalInput.source,
        payload: signalInput.payload,
      },
    },
    signals: [
      signal(`${signalInput.source}:severity`, "severity", "Domain severity", severity, {
        confidence_hint: reliability,
        reliability_hint: reliability,
        reversibility_hint: Math.max(20, 100 - urgency),
      }),
      signal(`${signalInput.source}:urgency`, "urgency", "Domain urgency", urgency, {
        confidence_hint: reliability,
        reliability_hint: reliability,
        reversibility_hint: Math.max(20, 100 - urgency),
      }),
      signal(`${signalInput.source}:reliability`, "reliability", "Signal reliability", reliability, {
        severity_hint: uncertainty,
        friction_hint: uncertainty,
        risk_hint: uncertainty,
        expected_value_hint: reliability,
      }),
    ],
    data_quality: {
      score: reliability,
      completeness: reliability,
      consistency: reliability,
      reliability,
      missing_fields: [],
    },
    constraints: {
      allow_automation: reliability >= 55,
      require_confirmation: severity >= 65 || urgency >= 70 || reliability < 60,
      max_control_level: "confirm",
      risk_floor: 20,
      safety_mode: signalInput.source !== "erp",
    },
  };
}

function buildGovernorInput(signalInput: NormalizedSignal) {
  return {
    task_type: "runtime_batch" as const,
    adapter_input: {
      success_rate: clamp01(signalInput.reliability),
      avg_latency: 200 + Math.round(signalInput.urgency * 1200),
      error_rate: clamp01((signalInput.severity * 0.45) + ((1 - signalInput.reliability) * 0.55)),
    },
  };
}

function deriveAction(source: NormalizedSignal["source"], core: UniversalCoreOutput): DomainAction {
  if (source === "sensor") {
    if (core.state === "blocked" || core.state === "critical" || core.state === "protection") return "stop_machine";
    if (core.state === "attention") return "reduce_load";
    return "monitor_sensor";
  }

  if (source === "finance") {
    if (core.state === "blocked" || core.state === "critical" || core.state === "protection" || core.risk.band === "high" || core.risk.band === "blocked") {
      return "block_payment";
    }
    if (core.state === "attention") return "review_transaction";
    return "approve_transaction";
  }

  if (core.state === "blocked" || core.state === "critical" || core.state === "protection") return "hold_order";
  if (core.state === "attention") return "review_order";
  return "continue_workflow";
}

const erpAdapter: DomainAdapter<ErpInput> = {
  normalize(input) {
    return {
      source: "erp",
      severity: clamp01((input.workflow_blocked ? 0.6 : 0.2) + Math.min(input.overdue_days, 30) / 60),
      urgency: clamp01((input.workflow_blocked ? 0.7 : 0.2) + Math.min(input.overdue_days, 14) / 28),
      reliability: 0.92,
      payload: input,
    };
  },
  async execute(action, input, governor) {
    return {
      executed: governor.decision === "allow" || governor.decision === "retry" || governor.decision === "fallback",
      action,
      target: input.record_id,
    };
  },
};

const financeAdapter: DomainAdapter<FinanceInput> = {
  normalize(input) {
    return {
      source: "finance",
      severity: clamp01((input.amount / 10000) * 0.35 + input.anomaly_score * 0.65),
      urgency: clamp01(input.anomaly_score * 0.7 + (input.confirmed ? 0.2 : 0.45)),
      reliability: input.confirmed ? 0.95 : 0.72,
      payload: input,
    };
  },
  async execute(action, input, governor) {
    return {
      executed: governor.decision === "allow" || governor.decision === "fallback",
      action,
      target: input.transaction_id,
    };
  },
};

const sensorAdapter: DomainAdapter<SensorInput> = {
  normalize(input) {
    const temperaturePressure = clamp01((input.temperature_c - 40) / 50);
    return {
      source: "sensor",
      severity: clamp01(temperaturePressure * 0.75 + clamp01(input.rate_of_change) * 0.25),
      urgency: clamp01(clamp01(input.rate_of_change) * 0.6 + temperaturePressure * 0.4),
      reliability: clamp01(input.sensor_quality),
      payload: input,
    };
  },
  async execute(action, input, governor) {
    return {
      executed: governor.decision === "allow" || governor.decision === "fallback",
      action,
      target: input.line_id,
    };
  },
};

export const domainRegistry = {
  erp: erpAdapter,
  finance: financeAdapter,
  sensor: sensorAdapter,
} as const;

export type DomainRegistry = typeof domainRegistry;

export async function handleDomainEvent<K extends keyof DomainRegistry>(
  domain: K,
  input: Parameters<DomainRegistry[K]["normalize"]>[0],
): Promise<DomainRuntimeResult> {
  const adapter = domainRegistry[domain];
  const signalInput = adapter.normalize(input as never);
  const coreInput = buildCoreInput(signalInput);
  const coreOutput = runUniversalCore(coreInput);
  const governorOutput = runNyraActionGovernor(buildGovernorInput(signalInput));
  const action = deriveAction(signalInput.source, coreOutput);
  const execution = await adapter.execute(action, input as never, governorOutput);

  return {
    signal: signalInput,
    core_input: coreInput,
    core_output: coreOutput,
    governor_output: governorOutput,
    action,
    execution,
  };
}
