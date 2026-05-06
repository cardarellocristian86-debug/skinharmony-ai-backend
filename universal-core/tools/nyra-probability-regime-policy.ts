export type NyraProbabilityRegime =
  | "bull_clean"
  | "bull_dirty"
  | "bubble"
  | "pre_break"
  | "crash"
  | "lateral"
  | "recovery";

export type NyraProbabilityEvBand = "negative" | "low" | "medium" | "high" | "uncertain";

export type NyraProbabilityRegimeAction =
  | "enter"
  | "enter_reduced"
  | "overdrive"
  | "avoid"
  | "reduce"
  | "exit"
  | "cash"
  | "hold"
  | "progressive_reentry";

export type NyraProbabilityRegimeDecision = {
  regime: NyraProbabilityRegime;
  ev_band: NyraProbabilityEvBand;
  quality_score: number;
  action: NyraProbabilityRegimeAction;
  max_risk_exposure: number;
  overdrive_allowed: boolean;
  reason: string;
};

export type NyraProbabilityRegimeInput = {
  regime: NyraProbabilityRegime;
  expected_value: number;
  quality_score: number;
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(Math.max(value, min), max);
}

export function classifyNyraExpectedValue(expectedValue: number, qualityScore: number): NyraProbabilityEvBand {
  if (qualityScore < 0.45) return "uncertain";
  if (expectedValue < 0) return "negative";
  if (expectedValue < 0.01) return "low";
  if (expectedValue < 0.04) return "medium";
  return "high";
}

export function chooseNyraProbabilityRegimeAction(input: NyraProbabilityRegimeInput): NyraProbabilityRegimeDecision {
  const quality = clamp(input.quality_score);
  const evBand = classifyNyraExpectedValue(input.expected_value, quality);
  const lowQuality = quality < 0.58;
  const veryLowQuality = quality < 0.45;

  if (input.regime === "bull_clean") {
    if (evBand === "high") {
      return {
        regime: input.regime,
        ev_band: evBand,
        quality_score: quality,
        action: "overdrive",
        max_risk_exposure: 0.92,
        overdrive_allowed: true,
        reason: "Bull clean: EV alto e qualita buona, overdrive permesso.",
      };
    }
    if (evBand === "medium") {
      return {
        regime: input.regime,
        ev_band: evBand,
        quality_score: quality,
        action: "enter",
        max_risk_exposure: 0.78,
        overdrive_allowed: false,
        reason: "Bull clean: EV medio, entra senza overdrive.",
      };
    }
  }

  if (input.regime === "bull_dirty") {
    if (evBand === "medium" || evBand === "high") {
      return {
        regime: input.regime,
        ev_band: evBand,
        quality_score: quality,
        action: "enter_reduced",
        max_risk_exposure: lowQuality ? 0.38 : 0.55,
        overdrive_allowed: false,
        reason: "Bull dirty: entra solo ridotto, perche il segnale e sporco.",
      };
    }
    return {
      regime: input.regime,
      ev_band: evBand,
      quality_score: quality,
      action: "avoid",
      max_risk_exposure: 0.18,
      overdrive_allowed: false,
      reason: "Bull dirty: EV incerto o basso, evita inseguimento.",
    };
  }

  if (input.regime === "bubble") {
    if (evBand === "high" && lowQuality) {
      return {
        regime: input.regime,
        ev_band: evBand,
        quality_score: quality,
        action: "avoid",
        max_risk_exposure: 0.28,
        overdrive_allowed: false,
        reason: "Bubble: EV alto ma qualita bassa, non spingere.",
      };
    }
    return {
      regime: input.regime,
      ev_band: evBand,
      quality_score: quality,
      action: "reduce",
      max_risk_exposure: 0.42,
      overdrive_allowed: false,
      reason: "Bubble: anche con EV medio si riduce, perche euforia e fragilita possono falsare l edge.",
    };
  }

  if (input.regime === "pre_break") {
    if ((evBand === "high" || evBand === "medium") && quality >= 0.62) {
      return {
        regime: input.regime,
        ev_band: evBand,
        quality_score: quality,
        action: "enter_reduced",
        max_risk_exposure: evBand === "high" ? 0.46 : 0.36,
        overdrive_allowed: false,
        reason: "Pre-break: segnale ancora da trattare con rispetto, ma EV e qualita consentono un ingresso ridotto invece del taglio automatico.",
      };
    }
    if (evBand === "low" && quality >= 0.68) {
      return {
        regime: input.regime,
        ev_band: evBand,
        quality_score: quality,
        action: "hold",
        max_risk_exposure: 0.28,
        overdrive_allowed: false,
        reason: "Pre-break: EV basso ma non deteriorato, mantiene disciplina senza ridurre automaticamente.",
      };
    }
    return {
      regime: input.regime,
      ev_band: evBand,
      quality_score: quality,
      action: "reduce",
      max_risk_exposure: 0.24,
      overdrive_allowed: false,
      reason: "Pre-break: anche EV positivo non basta, riduce comunque.",
    };
  }

  if (input.regime === "crash") {
    return {
      regime: input.regime,
      ev_band: evBand,
      quality_score: quality,
      action: evBand === "negative" ? "exit" : "cash",
      max_risk_exposure: 0.08,
      overdrive_allowed: false,
      reason: evBand === "negative" ? "Crash: EV negativo, esci." : "Crash: EV incerto, cash.",
    };
  }

  if (input.regime === "lateral") {
    return {
      regime: input.regime,
      ev_band: evBand,
      quality_score: quality,
      action: evBand === "high" && !veryLowQuality ? "enter_reduced" : "hold",
      max_risk_exposure: evBand === "high" && !veryLowQuality ? 0.28 : 0.12,
      overdrive_allowed: false,
      reason: evBand === "high" && !veryLowQuality ? "Laterale: solo probe ridotto su edge forte." : "Laterale: EV basso, non fare niente.",
    };
  }

  if (input.regime === "recovery") {
    if (evBand === "medium" || evBand === "high") {
      return {
        regime: input.regime,
        ev_band: evBand,
        quality_score: quality,
        action: "progressive_reentry",
        max_risk_exposure: evBand === "high" ? 0.68 : 0.5,
        overdrive_allowed: false,
        reason: "Recovery: EV migliora, rientro progressivo.",
      };
    }
    return {
      regime: input.regime,
      ev_band: evBand,
      quality_score: quality,
      action: "hold",
      max_risk_exposure: 0.18,
      overdrive_allowed: false,
      reason: "Recovery: EV non ancora abbastanza chiaro, aspetta conferma.",
    };
  }

  return {
    regime: input.regime,
    ev_band: evBand,
    quality_score: quality,
    action: "hold",
    max_risk_exposure: 0.2,
    overdrive_allowed: false,
    reason: "Regime non deciso: resta in hold.",
  };
}
