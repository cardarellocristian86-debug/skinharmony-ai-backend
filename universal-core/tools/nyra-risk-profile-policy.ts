import type { NyraFinancialAdvisoryOutput } from "./nyra-financial-advisory-overlay.ts";

type AssetSymbol = "SPY" | "QQQ" | "BTC" | "GLD" | "TLT" | "CASH";
type Allocation = Record<AssetSymbol, number>;

export type NyraRiskProfile = "capital_protection" | "balanced_growth" | "aggressive_growth" | "hard_growth";

type HistoryMap = Record<AssetSymbol, number[]>;

type ProfileConfig = {
  highRiskReentryCap: number;
  forbidRiskIncreaseOnWatch: boolean;
  euphoriaBtcCap: number;
  euphoriaCashBump: number;
  critical: Allocation;
  high: Allocation;
  watch: Allocation;
};

const PROFILE_CONFIG: Record<NyraRiskProfile, ProfileConfig> = {
  capital_protection: {
    highRiskReentryCap: 0.08,
    forbidRiskIncreaseOnWatch: true,
    euphoriaBtcCap: 0.05,
    euphoriaCashBump: 0.05,
    critical: { SPY: 0.12, QQQ: 0.08, BTC: 0, GLD: 0.24, TLT: 0.24, CASH: 0.32 },
    high: { SPY: 0.28, QQQ: 0.23, BTC: 0.05, GLD: 0.15, TLT: 0.15, CASH: 0.14 },
    watch: { SPY: 0.35, QQQ: 0.3, BTC: 0.1, GLD: 0.1, TLT: 0.08, CASH: 0.07 },
  },
  balanced_growth: {
    highRiskReentryCap: 0.14,
    forbidRiskIncreaseOnWatch: false,
    euphoriaBtcCap: 0.07,
    euphoriaCashBump: 0.03,
    critical: { SPY: 0.18, QQQ: 0.12, BTC: 0.02, GLD: 0.22, TLT: 0.2, CASH: 0.26 },
    high: { SPY: 0.33, QQQ: 0.27, BTC: 0.07, GLD: 0.12, TLT: 0.1, CASH: 0.11 },
    watch: { SPY: 0.35, QQQ: 0.35, BTC: 0.12, GLD: 0.08, TLT: 0.05, CASH: 0.05 },
  },
  aggressive_growth: {
    highRiskReentryCap: 0.24,
    forbidRiskIncreaseOnWatch: false,
    euphoriaBtcCap: 0.1,
    euphoriaCashBump: 0.02,
    critical: { SPY: 0.22, QQQ: 0.18, BTC: 0.02, GLD: 0.18, TLT: 0.16, CASH: 0.24 },
    high: { SPY: 0.35, QQQ: 0.33, BTC: 0.1, GLD: 0.08, TLT: 0.05, CASH: 0.09 },
    watch: { SPY: 0.33, QQQ: 0.35, BTC: 0.15, GLD: 0.07, TLT: 0.03, CASH: 0.07 },
  },
  hard_growth: {
    highRiskReentryCap: 0.35,
    forbidRiskIncreaseOnWatch: false,
    euphoriaBtcCap: 0.13,
    euphoriaCashBump: 0,
    critical: { SPY: 0.32, QQQ: 0.28, BTC: 0.08, GLD: 0.1, TLT: 0.07, CASH: 0.15 },
    high: { SPY: 0.35, QQQ: 0.35, BTC: 0.15, GLD: 0.04, TLT: 0.02, CASH: 0.09 },
    watch: { SPY: 0.35, QQQ: 0.35, BTC: 0.15, GLD: 0.03, TLT: 0.02, CASH: 0.1 },
  },
};

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function normalizeAllocation(input: Partial<Allocation>): Allocation {
  const full: Allocation = {
    SPY: input.SPY ?? 0,
    QQQ: input.QQQ ?? 0,
    BTC: input.BTC ?? 0,
    GLD: input.GLD ?? 0,
    TLT: input.TLT ?? 0,
    CASH: input.CASH ?? 0,
  };

  full.BTC = Math.min(full.BTC, 0.15);
  for (const asset of ["SPY", "QQQ", "GLD", "TLT", "CASH"] as const) {
    full[asset] = Math.min(full[asset], 0.35);
  }

  let sum = Object.values(full).reduce((acc, value) => acc + value, 0);
  if (sum <= 0) {
    return { SPY: 0.25, QQQ: 0.2, BTC: 0.05, GLD: 0.15, TLT: 0.15, CASH: 0.2 };
  }

  if (sum !== 1) {
    for (const key of Object.keys(full) as AssetSymbol[]) {
      full[key] /= sum;
    }
  }

  let excess = 0;
  for (const key of ["SPY", "QQQ", "GLD", "TLT", "CASH"] as const) {
    if (full[key] > 0.35) {
      excess += full[key] - 0.35;
      full[key] = 0.35;
    }
  }
  if (full.BTC > 0.15) {
    excess += full.BTC - 0.15;
    full.BTC = 0.15;
  }
  full.CASH += excess;

  sum = Object.values(full).reduce((acc, value) => acc + value, 0);
  for (const key of Object.keys(full) as AssetSymbol[]) {
    full[key] /= sum;
  }

  return full;
}

function scaleRiskyIncrease(previous: Allocation, target: Allocation, maxIncrease: number): Allocation {
  const riskyAssets: AssetSymbol[] = ["SPY", "QQQ", "BTC"];
  const prevRisky = riskyAssets.reduce((sum, asset) => sum + previous[asset], 0);
  const targetRisky = riskyAssets.reduce((sum, asset) => sum + target[asset], 0);
  if (targetRisky <= prevRisky + maxIncrease) return target;

  const allowedRisky = prevRisky + maxIncrease;
  const reduction = targetRisky - allowedRisky;
  const safeAssets: AssetSymbol[] = ["GLD", "TLT", "CASH"];
  const adjusted = { ...target };
  const riskyWeight = targetRisky || 1;

  for (const asset of riskyAssets) {
    adjusted[asset] = target[asset] - reduction * (target[asset] / riskyWeight);
  }
  const safeWeight = safeAssets.reduce((sum, asset) => sum + target[asset], 0) || 1;
  for (const asset of safeAssets) {
    adjusted[asset] = target[asset] + reduction * (target[asset] / safeWeight);
  }

  return normalizeAllocation(adjusted);
}

function allocationTurnover(previous: Allocation, target: Allocation): number {
  return (Object.keys(previous) as AssetSymbol[]).reduce(
    (sum, asset) => sum + Math.abs(previous[asset] - target[asset]),
    0,
  );
}

function blendAllocation(previous: Allocation, target: Allocation, targetWeight: number): Allocation {
  const previousWeight = 1 - targetWeight;
  return normalizeAllocation({
    SPY: previous.SPY * previousWeight + target.SPY * targetWeight,
    QQQ: previous.QQQ * previousWeight + target.QQQ * targetWeight,
    BTC: previous.BTC * previousWeight + target.BTC * targetWeight,
    GLD: previous.GLD * previousWeight + target.GLD * targetWeight,
    TLT: previous.TLT * previousWeight + target.TLT * targetWeight,
    CASH: previous.CASH * previousWeight + target.CASH * targetWeight,
  });
}

function strengthenMomentumTilt(target: Allocation, strongerEquity: "SPY" | "QQQ", strongerDefensive: "GLD" | "TLT"): Allocation {
  return normalizeAllocation({
    ...target,
    [strongerEquity]: Math.min(target[strongerEquity] + 0.03, 0.35),
    [strongerEquity === "SPY" ? "QQQ" : "SPY"]: Math.max(target[strongerEquity === "SPY" ? "QQQ" : "SPY"] - 0.03, 0),
    [strongerDefensive]: Math.min(target[strongerDefensive] + 0.02, 0.35),
    [strongerDefensive === "GLD" ? "TLT" : "GLD"]: Math.max(target[strongerDefensive === "GLD" ? "TLT" : "GLD"] - 0.02, 0),
  });
}

export function chooseNyraRiskProfileAllocation(
  profile: NyraRiskProfile,
  advisory: NyraFinancialAdvisoryOutput["advisory"],
  previous: Allocation | null,
  history: HistoryMap,
): { allocation: Allocation; reason: string } {
  const config = PROFILE_CONFIG[profile];
  const spy3m = average(history.SPY.slice(-3));
  const spy6m = average(history.SPY.slice(-6));
  const qqq3m = average(history.QQQ.slice(-3));
  const qqq6m = average(history.QQQ.slice(-6));
  const gld3m = average(history.GLD.slice(-3));
  const tlt3m = average(history.TLT.slice(-3));
  const btc3m = average(history.BTC.slice(-3));
  const btc6m = average(history.BTC.slice(-6));
  const spy1m = history.SPY.at(-1) ?? 0;
  const qqq1m = history.QQQ.at(-1) ?? 0;
  const btc1m = history.BTC.at(-1) ?? 0;
  const strongerEquity: "SPY" | "QQQ" = qqq3m > spy3m ? "QQQ" : "SPY";
  const strongerDefensive: "GLD" | "TLT" = tlt3m > gld3m ? "TLT" : "GLD";
  const rapidBreak = advisory.break > 0.24 || advisory.regime > 0.28 || (spy1m < -6 && qqq1m < -7);
  const positiveImpulse = spy3m > 0 && qqq3m > 0;
  const cryptoImpulse = btc3m > 0 && btc1m > -4;
  const enoughLongHistory = history.SPY.length >= 4;
  const longPeriodStrength =
    Math.max(spy6m, 0) * 0.35 +
    Math.max(qqq6m, 0) * 0.45 +
    Math.max(btc6m, 0) * 0.2;
  const longPeriodHealthy = longPeriodStrength > 2.6;
  const lateralChop =
    profile === "hard_growth" &&
    enoughLongHistory &&
    Math.abs(qqq3m) <= 1.2 &&
    Math.abs(qqq6m) <= 2.2 &&
    Math.abs(spy3m) <= 1.0 &&
    advisory.break < 0.12 &&
    advisory.regime < 0.1 &&
    !rapidBreak;
  const longPeriodWeakening =
    profile === "hard_growth" &&
    enoughLongHistory &&
    (
      (qqq1m < -1.5 && qqq3m > 0 && qqq3m < qqq6m) ||
      (spy1m < -1.25 && spy3m > 0 && spy3m < spy6m) ||
      (btc1m < -5 && btc3m > 0 && btc3m < btc6m) ||
      (advisory.regime > 0.1 && advisory.break > 0.08) ||
      advisory.notes.some((note) => /deterioramento|regime/i.test(note))
    );
  const hardContinuation =
    profile === "hard_growth" &&
    positiveImpulse &&
    advisory.policy >= 0.6 &&
    advisory.break < 0.2 &&
    longPeriodHealthy &&
    !longPeriodWeakening;

  let target: Allocation;
  let reason = `[${profile}] ${advisory.output.message} ${advisory.output.strategy}`;

  if (advisory.output.alert === "critical") {
    target = normalizeAllocation(config.critical);
    if ((profile === "aggressive_growth" || profile === "hard_growth") && !rapidBreak && advisory.policy >= 0.7 && positiveImpulse) {
      target = normalizeAllocation({
        ...target,
        SPY: target.SPY + (profile === "hard_growth" ? 0.04 : 0.03),
        QQQ: target.QQQ + (profile === "hard_growth" ? 0.05 : 0.04),
        BTC: profile === "hard_growth" && cryptoImpulse ? Math.min(target.BTC + 0.03, 0.15) : target.BTC,
        CASH: Math.max(target.CASH - (profile === "hard_growth" ? 0.08 : 0.05), 0),
        GLD: Math.max(target.GLD - 0.01, 0),
        TLT: Math.max(target.TLT - 0.01, 0),
      });
      reason += profile === "hard_growth"
        ? " Policy forte e impulso ancora presente: hard mode mantiene attacco in profitto."
        : " Policy forte e impulso ancora presente: difesa rapida ma non totale.";
    }
    if (profile === "hard_growth" && hardContinuation) {
      target = normalizeAllocation({
        ...target,
        SPY: Math.min(target.SPY + 0.02, 0.35),
        QQQ: Math.min(target.QQQ + 0.03, 0.35),
        BTC: cryptoImpulse ? Math.min(target.BTC + 0.02, 0.15) : target.BTC,
        GLD: Math.max(target.GLD - 0.03, 0),
        TLT: Math.max(target.TLT - 0.02, 0),
        CASH: Math.max(target.CASH - 0.02, 0),
      });
      reason += " Core severo ma break non confermato: hard mode tiene il profitto ancora vivo.";
    }
  } else if (advisory.output.alert === "high") {
    target = normalizeAllocation(config.high);
    if ((profile === "aggressive_growth" || profile === "hard_growth") && advisory.intensity === "moderate" && advisory.policy >= 0.7) {
      target = normalizeAllocation({
        ...target,
        SPY: target.SPY + (profile === "hard_growth" ? 0.03 : 0.02),
        QQQ: target.QQQ + (profile === "hard_growth" ? 0.03 : 0.02),
        BTC: cryptoImpulse ? Math.min(target.BTC + (profile === "hard_growth" ? 0.03 : 0.02), 0.15) : target.BTC,
        CASH: Math.max(target.CASH - (profile === "hard_growth" ? 0.06 : 0.04), 0),
      });
      reason += profile === "hard_growth"
        ? " Stress attenuato: hard mode resta esposto per spremere il trend."
        : " Stress attenuato: la modalita aggressiva mantiene esposizione per sfruttare la gamba di profitto.";
    }
    if (profile === "hard_growth" && hardContinuation) {
      target = normalizeAllocation({
        ...target,
        SPY: Math.min(target.SPY + 0.01, 0.35),
        QQQ: Math.min(target.QQQ + 0.02, 0.35),
        BTC: cryptoImpulse ? Math.min(target.BTC + 0.02, 0.15) : target.BTC,
        CASH: Math.max(target.CASH - 0.03, 0),
      });
      reason += " High alert ma nessuna rottura piena: hard mode continua a spremere il trend.";
    }
    if (profile === "hard_growth" && longPeriodWeakening && !rapidBreak) {
      target = normalizeAllocation({
        ...target,
        BTC: Math.min(target.BTC, 0.06),
        QQQ: Math.max(target.QQQ - 0.05, 0),
        SPY: Math.max(target.SPY - 0.02, 0),
        CASH: target.CASH + 0.04,
        GLD: target.GLD + 0.02,
        TLT: target.TLT + 0.01,
      });
      reason += " Il ciclo lungo si sta indebolendo: hard mode riduce prima della rottura piena.";
    }
  } else {
    target = normalizeAllocation(config.watch);
    if ((profile === "aggressive_growth" || profile === "hard_growth") && positiveImpulse && !(profile === "hard_growth" && longPeriodWeakening)) {
      target = normalizeAllocation({
        ...target,
        SPY: target.SPY + (profile === "hard_growth" ? 0.02 : 0.01),
        QQQ: target.QQQ + (profile === "hard_growth" ? 0.03 : 0.02),
        BTC: cryptoImpulse ? Math.min(target.BTC + (profile === "hard_growth" ? 0.02 : 0.01), 0.15) : target.BTC,
        CASH: Math.max(target.CASH - (profile === "hard_growth" ? 0.06 : 0.04), 0),
      });
      reason += profile === "hard_growth"
        ? " Recovery/healthy confermata: hard mode accelera il rientro risk-on in bull strutturale."
        : " Recovery/healthy confermata: aumento del profilo risk-on.";
    }
    if (profile === "hard_growth" && positiveImpulse && !rapidBreak) {
      if (longPeriodWeakening) {
        target = normalizeAllocation({
          ...target,
          BTC: Math.min(target.BTC, 0.06),
          QQQ: Math.max(target.QQQ - 0.05, 0),
          SPY: Math.max(target.SPY - 0.01, 0),
          CASH: target.CASH + 0.04,
          GLD: target.GLD + 0.01,
          TLT: target.TLT + 0.01,
        });
        reason += " Momentum locale ancora vivo ma ciclo lungo in indebolimento: hard mode evita il re-risk precoce.";
      } else {
        target = normalizeAllocation({
          ...target,
          SPY: Math.min(target.SPY + 0.01, 0.35),
          QQQ: Math.min(target.QQQ + 0.01, 0.35),
          BTC: cryptoImpulse ? Math.min(target.BTC + 0.01, 0.15) : target.BTC,
          GLD: Math.max(target.GLD - 0.01, 0),
          TLT: Math.max(target.TLT - 0.01, 0),
        });
        reason += " Momentum pulito: hard mode massimizza l'esposizione risk-on.";
      }
    }
  }

  target = strengthenMomentumTilt(target, strongerEquity, strongerDefensive);

  if (advisory.notes.some((note) => note.toLowerCase().includes("euforia"))) {
    target = normalizeAllocation({
      ...target,
      BTC: Math.min(target.BTC, config.euphoriaBtcCap),
      CASH: target.CASH + config.euphoriaCashBump,
      QQQ: Math.max(target.QQQ - 0.02, 0),
      SPY: Math.max(target.SPY - 0.01, 0),
    });
    reason += " Euforia senza deterioramento: rischio tenuto alto ma senza inseguire il top.";
  }

  if (previous && /Evita rientri aggressivi/i.test(advisory.output.strategy)) {
    target = scaleRiskyIncrease(previous, target, config.highRiskReentryCap);
    reason += ` Bull trap / recovery: rientro limitato a ${Math.round(config.highRiskReentryCap * 100)}% di rischio aggiuntivo.`;
  }

  if (previous && config.forbidRiskIncreaseOnWatch && /Non aumentare rischio/i.test(advisory.output.strategy)) {
    const previousRisky = previous.SPY + previous.QQQ + previous.BTC;
    const targetRisky = target.SPY + target.QQQ + target.BTC;
    if (targetRisky > previousRisky) {
      target = scaleRiskyIncrease(previous, target, 0);
      reason += " Base sana ma nessun aumento di rischio autorizzato nel profilo prudente.";
    }
  }

  if ((profile === "aggressive_growth" || profile === "hard_growth") && rapidBreak) {
    target = normalizeAllocation({
      ...target,
      BTC: profile === "hard_growth" ? Math.min(target.BTC, 0.03) : 0,
      QQQ: Math.max(target.QQQ - (profile === "hard_growth" ? 0.1 : 0.05), 0),
      SPY: Math.max(target.SPY - (profile === "hard_growth" ? 0.06 : 0), 0),
      CASH: target.CASH + (profile === "hard_growth" ? 0.1 : 0.03),
      GLD: target.GLD + (profile === "hard_growth" ? 0.03 : 0.02),
      TLT: target.TLT + (profile === "hard_growth" ? 0.03 : 0.02),
    });
    reason += profile === "hard_growth"
      ? " Break rapido rilevato: hard mode scarica rischio tardi ma con uscita molto rapida."
      : " Break rapido rilevato: uscita accelerata dal rischio piu fragile.";
  }

  if (profile === "hard_growth" && lateralChop) {
    target = normalizeAllocation({
      SPY: 0.25,
      QQQ: 0.27,
      BTC: 0.03,
      GLD: 0.09,
      TLT: 0.08,
      CASH: 0.28,
    });
    reason += " Regime laterale/choppy rilevato: hard mode comprime il rischio e limita il churn operativo.";
    if (previous) {
      target = scaleRiskyIncrease(previous, target, 0.04);
      reason += " In laterale il rientro/addensamento rischio resta stretto.";
      const turnover = allocationTurnover(previous, target);
      if (turnover <= 0.08) {
        target = previous;
        reason += " Auto-regolazione laterale: il delta e troppo piccolo, mantiene la posizione invece di pagare churn.";
      } else if (turnover <= 0.18) {
        target = blendAllocation(previous, target, 0.2);
        reason += " Auto-regolazione laterale: il cambio non e abbastanza forte, si muove solo a piccoli passi.";
      }
    }
  }

  return {
    allocation: normalizeAllocation(target),
    reason,
  };
}
