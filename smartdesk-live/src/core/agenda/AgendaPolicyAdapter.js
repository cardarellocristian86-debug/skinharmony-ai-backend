const AGENDA_POLICY_ADAPTER_VERSION = "agenda_policy_adapter_v1";

const COMPARABLE_WEIGHTS = Object.freeze({
  saturation: 0.25,
  pressure: 0.30,
  need: 0.25,
  band: 0.20
});

function clamp01(value = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function round(value = 0, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function scoresOf(snapshot = {}) {
  return snapshot.scores || snapshot;
}

function agendaBandScore(band = "") {
  const normalized = String(band || "").toUpperCase();
  if (normalized === "CRITICAL" || normalized === "INTERVENTO_ORA") return 0.9;
  if (normalized === "STRESSED") return 0.7;
  if (normalized === "WATCH" || normalized === "ATTENZIONE") return 0.45;
  if (normalized === "CALM" || normalized === "GIORNATA_EQUILIBRATA") return 0.2;
  return 0.2;
}

function legacyBandFromComparable({ pressure = 0, need = 0 } = {}) {
  const signal = Math.max(clamp01(pressure), clamp01(need));
  if (signal >= 0.70) return "intervento_ora";
  if (signal >= 0.50) return "attenzione";
  return "giornata_equilibrata";
}

function normalizeOperationalSnapshot(snapshot = {}) {
  const scores = scoresOf(snapshot);
  return {
    mathCore: snapshot.mathCore || "agenda_core_v1",
    horizon: snapshot.horizon || null,
    saturation: clamp01(scores.saturation),
    pressure: clamp01(scores.pressure),
    fragility: clamp01(scores.fragility),
    noShowRisk: clamp01(scores.noShowRisk),
    slotValue: clamp01(scores.slotValue),
    urgency: clamp01(scores.urgency),
    readiness: clamp01(scores.readiness),
    agendaScore: clamp01(scores.agendaScore),
    band: snapshot.band || "CALM",
    bandProxy: agendaBandScore(snapshot.band || "CALM"),
    counts: snapshot.counts || {},
    sourceFlags: Array.isArray(snapshot.sourceFlags) ? snapshot.sourceFlags.map(String) : [],
    breakdown: snapshot.breakdown || null
  };
}

function legacyValue(snapshot = {}, key = "", fallback = null) {
  const value = Number(snapshot?.[key]);
  return Number.isFinite(value) ? clamp01(value) : fallback;
}

function adaptAgendaCapacityPolicy(operational = {}, legacy = {}) {
  const op = normalizeOperationalSnapshot(operational);
  const legacySaturation = legacyValue(legacy, "saturation", null);
  if (legacySaturation !== null) {
    return {
      saturation: legacySaturation,
      method: "legacy_counter_capacity_proxy",
      sourceFlags: ["agenda_policy_adapter:capacity_uses_legacy_saturation_proxy"]
    };
  }
  return {
    saturation: op.saturation,
    method: "operational_capacity_fallback",
    sourceFlags: ["agenda_policy_adapter:capacity_fallback_to_operational"]
  };
}

function adaptAgendaPressurePolicy(operational = {}, legacy = {}) {
  const op = normalizeOperationalSnapshot(operational);
  const legacyPressure = legacyValue(legacy, "pressure", null);
  if (legacyPressure !== null) {
    return {
      pressure: legacyPressure,
      method: "legacy_phi_pressure_proxy",
      sourceFlags: ["agenda_policy_adapter:pressure_uses_legacy_phi_proxy"]
    };
  }
  return {
    pressure: round(Math.sqrt(op.pressure)),
    method: "sqrt_compression_operational_pressure",
    sourceFlags: ["agenda_policy_adapter:pressure_sqrt_compression"]
  };
}

function adaptAgendaNeedPolicy(operational = {}, legacy = {}) {
  const op = normalizeOperationalSnapshot(operational);
  const legacyNeed = legacyValue(legacy, "need", null);
  if (legacyNeed !== null) {
    return {
      need: legacyNeed,
      method: "legacy_max_item_need_proxy",
      sourceFlags: ["agenda_policy_adapter:need_uses_legacy_max_item_need"]
    };
  }
  return {
    need: round(Math.max(op.urgency * 0.65, op.fragility * 0.20, op.noShowRisk * 0.15)),
    method: "operational_urgency_to_legacy_need",
    sourceFlags: ["agenda_policy_adapter:need_from_operational_urgency"]
  };
}

function adaptAgendaBandPolicy(operational = {}, comparable = {}, legacy = {}) {
  const legacyBand = String(legacy?.band || "");
  const derivedBand = legacyBandFromComparable(comparable);
  const band = legacyBand || derivedBand;
  return {
    band,
    bandProxy: agendaBandScore(band),
    method: legacyBand ? "legacy_summary_band_policy" : "derived_from_comparable_pressure_need",
    sourceFlags: [legacyBand ? "agenda_policy_adapter:band_uses_legacy_summary_policy" : "agenda_policy_adapter:band_derived_from_comparable"]
  };
}

function buildAgendaPolicyDelta(operational = {}, comparable = {}) {
  const op = normalizeOperationalSnapshot(operational);
  return {
    saturationDelta: round(comparable.saturation - op.saturation),
    pressureDelta: round(comparable.pressure - op.pressure),
    needDelta: round(comparable.need - op.urgency),
    bandDelta: round(comparable.bandProxy - op.bandProxy),
    excludedOperationalMetrics: {
      fragility: op.fragility,
      noShowRisk: op.noShowRisk,
      slotValue: op.slotValue,
      readiness: op.readiness,
      agendaScore: op.agendaScore
    }
  };
}

function adaptAgendaSnapshotToLegacyComparable(operationalSnapshot = {}, legacySnapshot = {}, context = {}) {
  const operational = normalizeOperationalSnapshot(operationalSnapshot);
  const capacity = adaptAgendaCapacityPolicy(operationalSnapshot, legacySnapshot, context);
  const pressure = adaptAgendaPressurePolicy(operationalSnapshot, legacySnapshot, context);
  const need = adaptAgendaNeedPolicy(operationalSnapshot, legacySnapshot, context);
  const comparableBase = {
    saturation: capacity.saturation,
    pressure: pressure.pressure,
    need: need.need
  };
  const band = adaptAgendaBandPolicy(operationalSnapshot, comparableBase, legacySnapshot, context);
  const comparableSnapshot = {
    mathAdapter: AGENDA_POLICY_ADAPTER_VERSION,
    source: "agenda_core_comparable_legacy_policy",
    horizon: operational.horizon,
    saturation: round(comparableBase.saturation),
    pressure: round(comparableBase.pressure),
    need: round(comparableBase.need),
    urgency: round(comparableBase.need),
    band: band.band,
    bandProxy: round(band.bandProxy),
    agendaScoreComparable: round(
      (COMPARABLE_WEIGHTS.saturation * comparableBase.saturation)
      + (COMPARABLE_WEIGHTS.pressure * comparableBase.pressure)
      + (COMPARABLE_WEIGHTS.need * comparableBase.need)
      + (COMPARABLE_WEIGHTS.band * band.bandProxy)
    ),
    operationalMetrics: {
      saturation: operational.saturation,
      pressure: operational.pressure,
      fragility: operational.fragility,
      noShowRisk: operational.noShowRisk,
      slotValue: operational.slotValue,
      urgency: operational.urgency,
      readiness: operational.readiness,
      agendaScore: operational.agendaScore,
      band: operational.band
    },
    sourceFlags: Array.from(new Set([
      ...capacity.sourceFlags,
      ...pressure.sourceFlags,
      ...need.sourceFlags,
      ...band.sourceFlags,
      "agenda_policy_adapter:comparison_only",
      "agenda_policy_adapter:operational_snapshot_unchanged"
    ]))
  };
  return {
    mathAdapter: AGENDA_POLICY_ADAPTER_VERSION,
    operationalSnapshot: operational,
    comparableSnapshot,
    policyDeltas: buildAgendaPolicyDelta(operationalSnapshot, comparableSnapshot),
    excludedFromAgreement: {
      fragility: "legacy_has_no_homogeneous_metric",
      noShowRisk: "legacy_has_no_homogeneous_metric",
      slotValue: "legacy_has_no_homogeneous_metric",
      readiness: "legacy_has_no_homogeneous_metric",
      load: "legacy_load_is_not_a_distinct_metric"
    },
    policyFlags: comparableSnapshot.sourceFlags,
    policyMethods: {
      capacity: capacity.method,
      pressure: pressure.method,
      need: need.method,
      band: band.method
    }
  };
}

module.exports = {
  AGENDA_POLICY_ADAPTER_VERSION,
  COMPARABLE_WEIGHTS,
  adaptAgendaSnapshotToLegacyComparable,
  adaptAgendaCapacityPolicy,
  adaptAgendaPressurePolicy,
  adaptAgendaNeedPolicy,
  adaptAgendaBandPolicy,
  buildAgendaPolicyDelta,
  agendaBandScore
};
