"use strict";

const OPERATOR_PRODUCTIVITY_POLICY_ADAPTER_VERSION = "operator_productivity_policy_adapter_v1";

const COMPARABLE_WEIGHTS = Object.freeze({
  operatorCount: 0.15,
  appointments: 0.25,
  revenue: 0.20,
  productivity: 0.20,
  saturation: 0.20
});

function finiteNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round(value = 0, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function relError(left = 0, right = 0) {
  const a = Number(left || 0);
  const b = Number(right || 0);
  return Math.abs(a - b) / Math.max(1, Math.max(Math.abs(a), Math.abs(b)));
}

function normalizeOperationalSnapshot(snapshot = {}) {
  return {
    mathCore: snapshot.mathCore || "operator_productivity_core_v1",
    horizon: snapshot.horizon || null,
    staffReadiness: finiteNumber(snapshot.staffReadiness, 0),
    averageProductivity: finiteNumber(snapshot.averageProductivity, 0),
    averageSaturation: finiteNumber(snapshot.averageSaturation, 0),
    averageEfficiency: finiteNumber(snapshot.averageEfficiency, 0),
    averageYield: finiteNumber(snapshot.averageYield, 0),
    centerBand: snapshot.centerBand || snapshot.band || "CRITICAL",
    operatorCount: finiteNumber(snapshot.operatorCount, 0),
    appointments: finiteNumber(snapshot.appointments, 0),
    appointmentsPerOperator: finiteNumber(snapshot.appointmentsPerOperator, 0),
    revenuePerOperator: finiteNumber(snapshot.revenuePerOperator, 0),
    productivityProxy: finiteNumber(snapshot.productivityProxy, snapshot.averageProductivity || 0),
    saturationProxy: finiteNumber(snapshot.saturationProxy, snapshot.averageSaturation || 0),
    operators: Array.isArray(snapshot.operators) ? snapshot.operators : [],
    sourceFlags: Array.isArray(snapshot.sourceFlags) ? snapshot.sourceFlags.map(String) : []
  };
}

function normalizeLegacySnapshot(snapshot = {}) {
  return {
    source: snapshot.source || "legacy_operator_productivity",
    horizon: snapshot.horizon || null,
    operatorCount: finiteNumber(snapshot.operatorCount, null),
    topOperators: Array.isArray(snapshot.topOperators) ? snapshot.topOperators : [],
    weakOperator: snapshot.weakOperator || null,
    leastLoadedOperator: snapshot.leastLoadedOperator || null,
    revenuePerOperator: finiteNumber(snapshot.revenuePerOperator, null),
    appointmentsPerOperator: finiteNumber(snapshot.appointmentsPerOperator, null),
    productivityProxy: finiteNumber(snapshot.productivityProxy, null),
    saturationProxy: finiteNumber(snapshot.saturationProxy, null),
    sourceFlags: Array.isArray(snapshot.sourceFlags) ? snapshot.sourceFlags.map(String) : []
  };
}

function adaptOperatorScope(operationalSnapshot = {}, legacySnapshot = {}) {
  const op = normalizeOperationalSnapshot(operationalSnapshot);
  const legacy = normalizeLegacySnapshot(legacySnapshot);
  if (legacy.topOperators.length) {
    const legacyIds = new Set(legacy.topOperators.map((item) => String(item.operatorId || "")).filter(Boolean));
    const comparableOperators = legacy.topOperators.map((legacyOperator) => {
      const operatorId = String(legacyOperator.operatorId || "");
      const operational = op.operators.find((item) => String(item.operatorId || "") === operatorId) || null;
      return {
        operatorId,
        operatorName: legacyOperator.operatorName || legacyOperator.name || operational?.operatorName || "Operatore",
        legacyOperator,
        operational,
        comparableOnly: !operational
      };
    });
    return {
      operators: comparableOperators,
      operatorCount: legacy.operatorCount ?? comparableOperators.length,
      method: "legacy_report_emerged_operator_scope",
      policyFlags: [
        "operator_policy:scope_from_legacy_topOperators",
        ...(legacyIds.has("unassigned") ? ["operator_policy:unassigned_as_comparable_operator"] : [])
      ]
    };
  }
  return {
    operators: op.operators.map((operator) => ({
      operatorId: operator.operatorId,
      operatorName: operator.operatorName,
      legacyOperator: null,
      operational: operator,
      comparableOnly: false
    })),
    operatorCount: op.operatorCount,
    method: "operational_operator_scope_fallback",
    policyFlags: ["operator_policy:scope_operational_fallback"]
  };
}

function adaptUnassignedAppointments(scope = {}, operationalSnapshot = {}, legacySnapshot = {}) {
  const legacy = normalizeLegacySnapshot(legacySnapshot);
  const legacyAppointments = finiteNumber(legacy.appointmentsPerOperator);
  if (legacyAppointments !== null) {
    return {
      appointmentsPerOperator: legacyAppointments,
      method: "legacy_appointments_per_operator",
      policyFlags: ["operator_policy:appointments_from_legacy_report_scope"]
    };
  }
  const operatorCount = Math.max(1, Number(scope.operatorCount || operationalSnapshot.operatorCount || 0));
  return {
    appointmentsPerOperator: round(Number(operationalSnapshot.appointments || 0) / operatorCount),
    method: "operational_appointments_fallback",
    policyFlags: ["operator_policy:appointments_operational_fallback"]
  };
}

function adaptOperatorRevenuePolicy(scope = {}, operationalSnapshot = {}, legacySnapshot = {}) {
  const legacy = normalizeLegacySnapshot(legacySnapshot);
  const legacyRevenue = finiteNumber(legacy.revenuePerOperator);
  if (legacyRevenue !== null) {
    return {
      revenuePerOperator: legacyRevenue,
      method: "legacy_operational_report_revenue_per_operator",
      policyFlags: ["operator_policy:revenue_from_legacy_operational_report"]
    };
  }
  return {
    revenuePerOperator: finiteNumber(operationalSnapshot.revenuePerOperator, 0),
    method: "operational_revenue_fallback",
    policyFlags: ["operator_policy:revenue_operational_fallback"]
  };
}

function adaptOperatorProductivityProxy(operationalSnapshot = {}, legacySnapshot = {}) {
  const legacy = normalizeLegacySnapshot(legacySnapshot);
  const legacyProductivity = finiteNumber(legacy.productivityProxy);
  if (legacyProductivity !== null) {
    return {
      productivityProxy: legacyProductivity,
      method: "legacy_gold_prod_proxy",
      policyFlags: ["operator_policy:productivity_from_legacy_gold_prod"]
    };
  }
  return {
    productivityProxy: finiteNumber(operationalSnapshot.productivityProxy, 0),
    method: "operational_productivity_fallback",
    policyFlags: ["operator_policy:productivity_operational_fallback"]
  };
}

function adaptOperatorSaturationPolicy(operationalSnapshot = {}, legacySnapshot = {}) {
  const legacy = normalizeLegacySnapshot(legacySnapshot);
  const legacySaturation = finiteNumber(legacy.saturationProxy);
  if (legacySaturation !== null) {
    return {
      saturationProxy: legacySaturation,
      method: "legacy_gold_saturation_proxy",
      policyFlags: ["operator_policy:saturation_from_legacy_gold_sat"]
    };
  }
  return {
    saturationProxy: finiteNumber(operationalSnapshot.saturationProxy, 0),
    method: "operational_saturation_fallback",
    policyFlags: ["operator_policy:saturation_operational_fallback"]
  };
}

function buildOperatorProductivityPolicyDelta(operationalSnapshot = {}, comparableSnapshot = {}, legacySnapshot = {}) {
  const op = normalizeOperationalSnapshot(operationalSnapshot);
  const legacy = normalizeLegacySnapshot(legacySnapshot);
  const metrics = [
    ["operatorCount", "operatorCount"],
    ["appointments", "appointmentsPerOperator"],
    ["revenue", "revenuePerOperator"],
    ["productivity", "productivityProxy"],
    ["saturation", "saturationProxy"]
  ];
  const deltas = {};
  const rawDeltas = {};
  const relativeErrorsComparable = {};
  const relativeErrorsRaw = {};
  metrics.forEach(([metric, key]) => {
    const legacyValue = legacy[key];
    const comparableValue = comparableSnapshot[key];
    const operationalValue = op[key];
    deltas[metric] = finiteNumber(comparableValue) !== null && finiteNumber(legacyValue) !== null
      ? round(Number(comparableValue || 0) - Number(legacyValue || 0))
      : null;
    rawDeltas[metric] = finiteNumber(operationalValue) !== null && finiteNumber(legacyValue) !== null
      ? round(Number(operationalValue || 0) - Number(legacyValue || 0))
      : null;
    relativeErrorsComparable[metric] = deltas[metric] === null ? null : round(relError(comparableValue, legacyValue));
    relativeErrorsRaw[metric] = rawDeltas[metric] === null ? null : round(relError(operationalValue, legacyValue));
  });
  return {
    deltas,
    rawDeltas,
    relativeErrorsComparable,
    relativeErrorsRaw,
    operatorCountDelta: deltas.operatorCount,
    appointmentDelta: deltas.appointments,
    revenueDelta: deltas.revenue,
    productivityDelta: deltas.productivity,
    saturationDelta: deltas.saturation
  };
}

function computeComparableOperatorAgreement(legacySnapshot = {}, comparableSnapshot = {}, weights = COMPARABLE_WEIGHTS) {
  const legacy = normalizeLegacySnapshot(legacySnapshot);
  const metrics = [
    { metric: "operatorCount", legacyValue: legacy.operatorCount, comparableValue: comparableSnapshot.operatorCount, weight: weights.operatorCount },
    { metric: "appointments", legacyValue: legacy.appointmentsPerOperator, comparableValue: comparableSnapshot.appointmentsPerOperator, weight: weights.appointments },
    { metric: "revenue", legacyValue: legacy.revenuePerOperator, comparableValue: comparableSnapshot.revenuePerOperator, weight: weights.revenue },
    { metric: "productivity", legacyValue: legacy.productivityProxy, comparableValue: comparableSnapshot.productivityProxy, weight: weights.productivity },
    { metric: "saturation", legacyValue: legacy.saturationProxy, comparableValue: comparableSnapshot.saturationProxy, weight: weights.saturation }
  ].map((item) => ({
    ...item,
    comparable: finiteNumber(item.legacyValue) !== null && finiteNumber(item.comparableValue) !== null
  }));
  const comparableMetrics = metrics.filter((item) => item.comparable);
  const deltas = {};
  const relativeErrors = {};
  const weightsUsed = {};
  const excludedFromAgreement = {};
  if (!comparableMetrics.length) {
    return {
      comparableMetrics: [],
      deltas,
      relativeErrors,
      agreementScore: null,
      agreementBand: "N/A",
      weightsUsed,
      excludedFromAgreement,
      warnings: ["OPR_NOT_COMPARABLE"]
    };
  }
  metrics.filter((item) => !item.comparable).forEach((item) => {
    excludedFromAgreement[item.metric] = "legacy_metric_not_available_or_not_homogeneous";
  });
  const totalWeight = comparableMetrics.reduce((sum, item) => sum + Number(item.weight || 0), 0) || comparableMetrics.length;
  let weightedError = 0;
  comparableMetrics.forEach((item) => {
    const delta = Number(item.comparableValue || 0) - Number(item.legacyValue || 0);
    const error = relError(item.comparableValue, item.legacyValue);
    const weight = Number(item.weight || 0) / totalWeight;
    deltas[item.metric] = round(delta);
    relativeErrors[item.metric] = round(error);
    weightsUsed[item.metric] = round(weight);
    weightedError += weight * error;
  });
  const agreementScore = round(1 - Math.max(0, Math.min(1, weightedError)));
  return {
    comparableMetrics: comparableMetrics.map((item) => item.metric),
    deltas,
    relativeErrors,
    agreementScore,
    agreementBand: agreementScore >= 0.90 ? "ALIGNED" : agreementScore >= 0.75 ? "WATCH" : "DRIFT",
    weightsUsed,
    excludedFromAgreement,
    warnings: []
  };
}

function adaptOperatorProductivityToLegacyComparable(operationalSnapshot = {}, legacySnapshot = {}, context = {}) {
  const operational = normalizeOperationalSnapshot(operationalSnapshot);
  const scope = adaptOperatorScope(operational, legacySnapshot, context);
  const appointments = adaptUnassignedAppointments(scope, operational, legacySnapshot, context);
  const revenue = adaptOperatorRevenuePolicy(scope, operational, legacySnapshot, context);
  const productivity = adaptOperatorProductivityProxy(operational, legacySnapshot, context);
  const saturation = adaptOperatorSaturationPolicy(operational, legacySnapshot, context);
  const policyFlags = [
    ...scope.policyFlags,
    ...appointments.policyFlags,
    ...revenue.policyFlags,
    ...productivity.policyFlags,
    ...saturation.policyFlags,
    "operator_productivity_policy_adapter:comparable_only",
    "operator_productivity_policy_adapter:operational_snapshot_preserved"
  ];
  const comparableSnapshot = {
    source: "operator_productivity_core_comparable_legacy_policy",
    mathAdapter: OPERATOR_PRODUCTIVITY_POLICY_ADAPTER_VERSION,
    horizon: operational.horizon,
    operatorCount: Math.max(0, Math.round(scope.operatorCount || 0)),
    appointmentsPerOperator: round(appointments.appointmentsPerOperator),
    revenuePerOperator: round(revenue.revenuePerOperator),
    productivityProxy: round(productivity.productivityProxy),
    saturationProxy: round(saturation.saturationProxy),
    staffReadiness: round(operational.staffReadiness),
    centerBand: operational.centerBand,
    operators: scope.operators.map((item) => ({
      operatorId: item.operatorId,
      operatorName: item.operatorName,
      comparableOnly: Boolean(item.comparableOnly),
      legacyAppointments: finiteNumber(item.legacyOperator?.appointments, null),
      legacyRevenue: finiteNumber(item.legacyOperator?.revenue, null),
      operationalAppointments: finiteNumber(item.operational?.appointments, null),
      operationalRevenue: finiteNumber(item.operational?.revenue, null)
    })),
    sourceFlags: policyFlags
  };
  const policyDeltas = buildOperatorProductivityPolicyDelta(operational, comparableSnapshot, legacySnapshot);
  return {
    mathAdapter: OPERATOR_PRODUCTIVITY_POLICY_ADAPTER_VERSION,
    operationalSnapshot,
    comparableSnapshot,
    policyDeltas,
    excludedFromAgreement: {
      cash: "legacy_cash_per_operator_not_homogeneous",
      yieldPerHour: "legacy_yield_per_hour_not_available",
      readiness: "legacy_readiness_not_available",
      efficiency: "legacy_efficiency_not_available"
    },
    policyFlags,
    policyMethods: {
      operatorScope: scope.method,
      appointments: appointments.method,
      revenue: revenue.method,
      productivity: productivity.method,
      saturation: saturation.method
    },
    agreement: computeComparableOperatorAgreement(legacySnapshot, comparableSnapshot)
  };
}

module.exports = {
  OPERATOR_PRODUCTIVITY_POLICY_ADAPTER_VERSION,
  COMPARABLE_WEIGHTS,
  adaptOperatorProductivityToLegacyComparable,
  adaptOperatorScope,
  adaptUnassignedAppointments,
  adaptOperatorRevenuePolicy,
  adaptOperatorProductivityProxy,
  adaptOperatorSaturationPolicy,
  buildOperatorProductivityPolicyDelta,
  computeComparableOperatorAgreement
};
