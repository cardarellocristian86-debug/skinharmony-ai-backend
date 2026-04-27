import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput } from "../packages/contracts/src/index.ts";
import { deriveNyraFinancialMathFeatures } from "./nyra-financial-math-filter.ts";
import { applyHealthyBaselineGate } from "./nyra-healthy-baseline-gate.ts";

export type NyraFinancialAdvisoryOutput = {
  core: ReturnType<typeof runUniversalCore>;
  advisory: {
    euphoria: number;
    deterioration: number;
    break: number;
    regime: number;
    policy: number;
    baseline_state: "healthy" | "watch" | "deteriorating";
    notes: string[];
    output: {
      alert: "watch" | "high" | "critical";
      message: string;
      strategy: string;
      intensity: "low" | "moderate" | "high";
    };
  };
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}

function deriveRawSignalMap(input: UniversalCoreInput): Record<string, number> {
  return Object.fromEntries(
    input.signals.map((signal) => [
      signal.category,
      clamp(Number(signal.value ?? signal.normalized_score / 100 ?? 0)),
    ]),
  );
}

export function runNyraFinancialWithAdvisory(
  input: UniversalCoreInput,
): NyraFinancialAdvisoryOutput {
  const rawSignalMap = deriveRawSignalMap(input);
  const coreResult = runUniversalCore(input);
  const features = deriveNyraFinancialMathFeatures(rawSignalMap);

  const policy = Math.max(
    clamp(Number(rawSignalMap.policy_support ?? 0)),
    clamp(Number(rawSignalMap.policy_response ?? 0)),
    clamp(Number(rawSignalMap.liquidity_intervention ?? 0)),
  );
  const notes: string[] = [];
  const baselineGate = applyHealthyBaselineGate({
    growth: Math.max(
      clamp(Number(rawSignalMap.growth_signal ?? 0)),
      clamp(1 - Number(rawSignalMap.growth_shock ?? 0)),
    ),
    liquidity: Math.max(
      clamp(Number(rawSignalMap.liquidity ?? 0)),
      policy,
      clamp(1 - Number(rawSignalMap.liquidity_stress ?? 0)),
    ),
    default_rate: Math.max(
      clamp(Number(rawSignalMap.default_rate ?? 0)),
      clamp(Number(rawSignalMap.delinquency_trend ?? 0)),
      clamp(Number(rawSignalMap.subprime_deterioration ?? 0)),
    ),
    volatility: Math.max(
      clamp(Number(rawSignalMap.volatility ?? 0)),
      clamp(Number(rawSignalMap.volatility_shock ?? 0)),
      clamp(Number(rawSignalMap.market_stress ?? 0)),
    ),
    policy_support: policy,
  });

  if (features.bubble_pressure > 0.45 && features.deterioration_velocity < 0.2) {
    notes.push("Possibile fase di euforia: bolla in formazione senza rottura evidente.");
  }

  if (features.deterioration_velocity > 0.3) {
    notes.push("Segnali di deterioramento in aumento.");
  }

  if (features.systemic_contagion > 0.15) {
    notes.push("Rischio di contagio sistemico elevato.");
  }

  if (features.regime_instability > 0.12) {
    notes.push("Possibile cambio di regime in corso.");
  }

  if (policy > 0.65) {
    notes.push("Supporto di policy presente: attenua l'intensita del rischio.");
  }

  notes.push(...baselineGate.notes);

  if (notes.length === 0) {
    notes.push("Nessun segnale advisory dominante oltre la lettura del Core.");
  }

  const policySupportHigh = policy >= 0.7;
  const policySupportLow = policy < 0.5;
  const coreCritical = coreResult.state === "critical" || coreResult.state === "protection" || coreResult.state === "blocked";

  let output: NyraFinancialAdvisoryOutput["advisory"]["output"] = {
    alert: "watch",
    message: "Rischio presente ma non dominante.",
    strategy: "Monitora il contesto e evita aumenti di rischio non necessari.",
    intensity: "low",
  };

  if (coreCritical && policySupportHigh) {
    output = {
      alert: "high",
      message: "Stress elevato, parzialmente attenuato da policy.",
      strategy: "Riduci esposizione progressivamente. Evita rientri aggressivi.",
      intensity: "moderate",
    };
  } else if (
    features.bubble_pressure > 0.45 &&
    features.deterioration_velocity < 0.2 &&
    features.systemic_contagion < 0.12
  ) {
    output = {
      alert: "watch",
      message: "Euforia presente, ma senza rottura evidente.",
      strategy: "Non inseguire il rimbalzo. Evita ingressi aggressivi e monitora il deterioramento.",
      intensity: "low",
    };
  } else if (coreCritical && policySupportLow) {
    output = {
      alert: "critical",
      message: "Rischio sistemico in accelerazione.",
      strategy: "Riduci esposizione rapidamente e proteggi capitale.",
      intensity: "high",
    };
  } else if (coreCritical) {
    output = {
      alert: "high",
      message: "Stress elevato e ancora instabile.",
      strategy: "Riduci rischio e mantieni disciplina senza inseguire il rimbalzo.",
      intensity: "moderate",
    };
  } else if (features.bubble_pressure > 0.45 && features.deterioration_velocity < 0.2) {
    output = {
      alert: "watch",
      message: "Euforia di mercato presente, ma senza rottura evidente.",
      strategy: "Evita ingressi aggressivi e monitora i segnali di deterioramento.",
      intensity: "low",
    };
  }

  if (baselineGate.baseline_state === "healthy" && output.alert === "high" && output.intensity === "moderate") {
    output = {
      alert: "watch",
      message: "Base ancora sana, ma con segnali da monitorare.",
      strategy: "Non aumentare rischio. Monitora il deterioramento senza rientri aggressivi.",
      intensity: "low",
    };
  }

  return {
    core: coreResult,
    advisory: {
      euphoria: features.bubble_pressure,
      deterioration: features.deterioration_velocity,
      break: features.systemic_contagion,
      regime: features.regime_instability,
      policy,
      baseline_state: baselineGate.baseline_state,
      notes,
      output,
    },
  };
}
