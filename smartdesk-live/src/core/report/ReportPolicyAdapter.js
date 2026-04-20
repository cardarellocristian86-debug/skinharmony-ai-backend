const REPORT_POLICY_ADAPTER_WEIGHTS = Object.freeze({
  revenue: 0.30,
  appointments: 0.30,
  ticket: 0.20,
  activeClients: 0.20
});

function finiteNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round(value = 0, decimals = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
}

function relError(left = 0, right = 0) {
  const a = Number(left || 0);
  const b = Number(right || 0);
  return Math.abs(a - b) / Math.max(1, Math.max(Math.abs(a), Math.abs(b)));
}

function bandFromAgreement(score = null) {
  if (!Number.isFinite(Number(score))) return "N/A";
  if (score >= 0.90) return "ALIGNED";
  if (score >= 0.75) return "WATCH";
  return "DRIFT";
}

function adaptReportAppointmentScope(operationalSnapshot = {}, legacySnapshot = {}) {
  const legacyAppointments = finiteNumber(legacySnapshot.appointments);
  if (legacyAppointments !== null) {
    return {
      value: Math.max(0, Math.round(legacyAppointments)),
      method: "legacy_gold_state_counter",
      policyFlags: ["report_policy:appointments_from_legacy_state_counter"]
    };
  }
  return {
    value: Math.max(0, Math.round(finiteNumber(operationalSnapshot.appointments, 0))),
    method: "operational_fallback",
    policyFlags: ["report_policy:appointments_operational_fallback"]
  };
}

function adaptReportRevenuePolicy(operationalSnapshot = {}, legacySnapshot = {}) {
  const cash = finiteNumber(operationalSnapshot.cash);
  const legacyRevenue = finiteNumber(legacySnapshot.revenue);
  if (cash !== null && legacyRevenue !== null) {
    return {
      value: Math.max(0, Math.round(cash)),
      method: "cash_like_revenue",
      policyFlags: ["report_policy:revenue_cash_like", "report_policy:operational_revenue_preserved"]
    };
  }
  return {
    value: Math.max(0, Math.round(finiteNumber(operationalSnapshot.revenue, 0))),
    method: "operational_revenue_fallback",
    policyFlags: ["report_policy:revenue_operational_fallback"]
  };
}

function adaptReportTicketPolicy(operationalSnapshot = {}, legacySnapshot = {}, comparableRevenue = 0, comparableAppointments = 0) {
  const legacyTicket = finiteNumber(legacySnapshot.ticket);
  if (legacyTicket !== null) {
    return {
      value: Math.max(0, Math.round(legacyTicket)),
      method: "legacy_gold_ticket_component",
      policyFlags: ["report_policy:ticket_from_legacy_component"]
    };
  }
  return {
    value: Math.round(Number(comparableRevenue || 0) / Math.max(1, Number(comparableAppointments || 0))),
    method: "cash_like_denominator",
    policyFlags: ["report_policy:ticket_from_comparable_revenue_over_comparable_appointments"]
  };
}

function adaptReportActiveClientPolicy(operationalSnapshot = {}, legacySnapshot = {}) {
  const legacyActive = finiteNumber(legacySnapshot.activeClients);
  if (legacyActive !== null) {
    return {
      value: Math.max(0, Math.round(legacyActive)),
      method: "legacy_gold_active_clients_counter",
      policyFlags: ["report_policy:active_clients_from_legacy_state_counter"]
    };
  }
  return {
    value: Math.max(0, Math.round(finiteNumber(operationalSnapshot.activeClients, 0))),
    method: "operational_active_clients_fallback",
    policyFlags: ["report_policy:active_clients_operational_fallback"]
  };
}

function buildReportPolicyDelta(operationalSnapshot = {}, comparableSnapshot = {}, legacySnapshot = {}) {
  const metrics = ["revenue", "appointments", "ticket", "activeClients"];
  const deltas = {};
  const rawDeltas = {};
  const relativeErrorsComparable = {};
  const relativeErrorsRaw = {};
  metrics.forEach((metric) => {
    const legacyValue = legacySnapshot[metric];
    const comparableValue = comparableSnapshot[metric];
    const operationalValue = operationalSnapshot[metric];
    deltas[metric] = finiteNumber(comparableValue) !== null && finiteNumber(legacyValue) !== null
      ? Number(comparableValue || 0) - Number(legacyValue || 0)
      : null;
    rawDeltas[metric] = finiteNumber(operationalValue) !== null && finiteNumber(legacyValue) !== null
      ? Number(operationalValue || 0) - Number(legacyValue || 0)
      : null;
    relativeErrorsComparable[metric] = deltas[metric] === null ? null : round(relError(comparableValue, legacyValue));
    relativeErrorsRaw[metric] = rawDeltas[metric] === null ? null : round(relError(operationalValue, legacyValue));
  });
  return {
    deltas,
    rawDeltas,
    relativeErrorsComparable,
    relativeErrorsRaw
  };
}

function adaptReportSnapshotToLegacyComparable(operationalSnapshot = {}, legacySnapshot = {}, context = {}) {
  const appointmentPolicy = adaptReportAppointmentScope(operationalSnapshot, legacySnapshot, context);
  const revenuePolicy = adaptReportRevenuePolicy(operationalSnapshot, legacySnapshot, context);
  const ticketPolicy = adaptReportTicketPolicy(operationalSnapshot, legacySnapshot, revenuePolicy.value, appointmentPolicy.value, context);
  const activePolicy = adaptReportActiveClientPolicy(operationalSnapshot, legacySnapshot, context);
  const comparableSnapshot = {
    source: "core_comparable",
    mathAdapter: "report_policy_adapter_v1",
    revenue: revenuePolicy.value,
    cash: finiteNumber(operationalSnapshot.cash),
    gap: null,
    margin: null,
    ticket: ticketPolicy.value,
    appointments: appointmentPolicy.value,
    activeClients: activePolicy.value,
    saturation: finiteNumber(operationalSnapshot.saturation),
    dataQuality: finiteNumber(operationalSnapshot.dataQuality),
    noShowRate: finiteNumber(operationalSnapshot.noShowRate),
    productivity: finiteNumber(operationalSnapshot.productivity),
    readiness: finiteNumber(operationalSnapshot.readiness),
    healthBand: operationalSnapshot.healthBand || "",
    sourceFlags: [
      "report_policy_adapter:comparable_only",
      "report_policy_adapter:operational_snapshot_preserved",
      ...revenuePolicy.policyFlags,
      ...appointmentPolicy.policyFlags,
      ...ticketPolicy.policyFlags,
      ...activePolicy.policyFlags
    ]
  };
  const policyDeltas = buildReportPolicyDelta(operationalSnapshot, comparableSnapshot, legacySnapshot);
  return {
    mathAdapter: "report_policy_adapter_v1",
    operationalSnapshot,
    comparableSnapshot,
    policyDeltas,
    excludedFromAgreement: {
      cash: "legacy_cash_not_homogeneous_in_report_snapshot",
      gap: "legacy_gap_not_available_in_report_snapshot",
      margin: "legacy_margin_not_available_in_report_snapshot",
      saturation: "legacy_saturation_not_in_required_comparable_set",
      dataQuality: "legacy_report_dq_is_supporting_context",
      noShowRate: "legacy_noshow_not_available_in_report_snapshot",
      productivity: "legacy_productivity_not_in_required_comparable_set",
      readiness: "legacy_readiness_not_available_in_report_snapshot",
      healthBand: "legacy_health_band_not_available_in_report_snapshot"
    },
    policyFlags: [
      "report_policy:legacy_revenue_is_cash_like",
      "report_policy:legacy_appointments_are_state_counter_scope",
      "report_policy:legacy_ticket_is_gold_component",
      "report_policy:legacy_active_clients_are_state_counter_scope"
    ],
    policyMethods: {
      revenue: revenuePolicy.method,
      appointments: appointmentPolicy.method,
      ticket: ticketPolicy.method,
      activeClients: activePolicy.method
    }
  };
}

function computeComparableReportAgreement(legacySnapshot = {}, comparableSnapshot = {}) {
  const metrics = Object.keys(REPORT_POLICY_ADAPTER_WEIGHTS).filter((metric) => (
    finiteNumber(legacySnapshot[metric]) !== null && finiteNumber(comparableSnapshot[metric]) !== null
  ));
  if (!metrics.length) {
    return {
      comparableMetrics: [],
      deltas: {},
      relativeErrors: {},
      agreementScore: null,
      agreementBand: "N/A",
      weightsUsed: {},
      warnings: ["REPORT_NOT_COMPARABLE"]
    };
  }
  const totalWeight = metrics.reduce((sum, metric) => sum + REPORT_POLICY_ADAPTER_WEIGHTS[metric], 0) || 1;
  const deltas = {};
  const relativeErrors = {};
  const weightsUsed = {};
  let weightedError = 0;
  metrics.forEach((metric) => {
    const legacyValue = Number(legacySnapshot[metric] || 0);
    const comparableValue = Number(comparableSnapshot[metric] || 0);
    const error = relError(comparableValue, legacyValue);
    const weight = REPORT_POLICY_ADAPTER_WEIGHTS[metric] / totalWeight;
    deltas[metric] = comparableValue - legacyValue;
    relativeErrors[metric] = round(error);
    weightsUsed[metric] = round(weight);
    weightedError += weight * error;
  });
  const agreementScore = round(Math.max(0, Math.min(1, 1 - weightedError)));
  return {
    comparableMetrics: metrics,
    deltas,
    relativeErrors,
    agreementScore,
    agreementBand: bandFromAgreement(agreementScore),
    weightsUsed,
    warnings: agreementScore >= 0.90 ? [] : ["REPORT_POLICY_COMPARABLE_DRIFT"]
  };
}

module.exports = {
  REPORT_POLICY_ADAPTER_WEIGHTS,
  adaptReportSnapshotToLegacyComparable,
  adaptReportAppointmentScope,
  adaptReportRevenuePolicy,
  adaptReportTicketPolicy,
  adaptReportActiveClientPolicy,
  buildReportPolicyDelta,
  computeComparableReportAgreement
};
