import type { UniversalCoreInput, UniversalSignal } from "../../../contracts/src/index.ts";

export type FlowCoreBranchInput = {
  request_id: string;
  pressure_score: number;
  continuity_risk_score: number;
  memory_stress_score: number;
  process_opportunity_score: number;
  persistent_signal?: boolean;
  process_legitimacy_score?: number;
  data_quality_score: number;
  temporal_stability_score: number;
};

export function mapFlowCoreToUniversal(input: FlowCoreBranchInput): UniversalCoreInput {
  const memorySignalScore = Math.min(input.memory_stress_score, Math.max(input.pressure_score, input.continuity_risk_score) + 10);
  const processSignalFloor = input.persistent_signal && input.process_legitimacy_score !== undefined && input.process_legitimacy_score < 55
    ? 35
    : 0;
  const processOpportunitySignalScore = Math.max(processSignalFloor, Math.min(input.process_opportunity_score, input.pressure_score + 20));
  const processRiskHint = input.persistent_signal && input.process_legitimacy_score !== undefined && input.process_legitimacy_score < 55
    ? Math.max(42, input.process_opportunity_score)
    : input.process_opportunity_score;
  const signals: UniversalSignal[] = [
    {
      id: "flowcore:pressure",
      source: "flowcore",
      category: "resource_pressure",
      label: "Pressione sistema",
      value: input.pressure_score,
      normalized_score: input.pressure_score,
      confidence_hint: input.data_quality_score,
      reliability_hint: 82,
      friction_hint: 20,
      reversibility_hint: 85,
      expected_value_hint: input.pressure_score,
      trend: {
        stability_score: input.temporal_stability_score,
      },
    },
    {
      id: "flowcore:continuity",
      source: "flowcore",
      category: "continuity_risk",
      label: "Rischio continuita'",
      value: input.continuity_risk_score,
      normalized_score: input.continuity_risk_score,
      confidence_hint: input.data_quality_score,
      reliability_hint: 80,
      friction_hint: 30,
      reversibility_hint: 80,
      expected_value_hint: input.continuity_risk_score,
    },
    {
      id: "flowcore:process_opportunity",
      source: "flowcore",
      category: "containment_opportunity",
      label: "Opportunita alleggerimento processi",
      value: input.process_opportunity_score,
      normalized_score: processOpportunitySignalScore,
      confidence_hint: input.data_quality_score,
      reliability_hint: 74,
      friction_hint: 25,
      risk_hint: processRiskHint,
      reversibility_hint: 85,
      expected_value_hint: input.process_opportunity_score,
      trend: {
        consecutive_count: input.persistent_signal ? 3 : 1,
        stability_score: input.temporal_stability_score,
      },
      evidence: [
        {
          label: "Segnale persistente",
          value: Boolean(input.persistent_signal),
          weight: 0.35,
        },
        {
          label: "Legittimita processo",
          value: input.process_legitimacy_score ?? 60,
          weight: 0.35,
        },
      ],
    },
    {
      id: "flowcore:memory",
      source: "flowcore",
      category: "memory_pressure",
      label: "Pressione memoria",
      value: input.memory_stress_score,
      normalized_score: memorySignalScore,
      confidence_hint: input.data_quality_score,
      reliability_hint: 78,
      friction_hint: 30,
      reversibility_hint: 80,
      expected_value_hint: input.memory_stress_score,
    },
  ];

  return {
    request_id: input.request_id,
    generated_at: new Date().toISOString(),
    domain: "flowcore",
    context: {
      mode: "mvp",
      time_window: {
        seconds: 60,
      },
    },
    signals,
    data_quality: {
      score: input.data_quality_score,
      reliability: input.data_quality_score,
    },
    constraints: {
      allow_automation: false,
      require_confirmation: true,
      max_control_level: "suggest",
      safety_mode: true,
    },
  };
}
