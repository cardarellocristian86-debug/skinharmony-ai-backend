const CASH_CONFIDENCE = Object.freeze({
  REAL: "REAL",
  STANDARD: "STANDARD",
  ESTIMATED: "ESTIMATED",
  INCOMPLETE: "INCOMPLETE"
});

const OBLIGATION_STATUS = Object.freeze({
  PAID: "PAID",
  PARTIAL: "PARTIAL",
  UNPAID: "UNPAID",
  OVERDUE: "OVERDUE",
  OVERPAID: "OVERPAID",
  CANCELLED: "CANCELLED",
  WRITEOFF: "WRITEOFF",
  REFUNDED: "REFUNDED"
});

const PAYMENT_STATUS = Object.freeze({
  MATCHED: "MATCHED",
  PARTIALLY_MATCHED: "PARTIALLY_MATCHED",
  UNLINKED: "UNLINKED",
  AMBIGUOUS: "AMBIGUOUS",
  REFUND: "REFUND",
  VOID: "VOID"
});

const CASH_ACTION = Object.freeze({
  MATCH_PAYMENT_REVIEW: "MATCH_PAYMENT_REVIEW",
  SOLLECITA_RESIDUO: "SOLLECITA_RESIDUO",
  VERIFICA_PARTIAL: "VERIFICA_PARTIAL",
  VERIFICA_OVERPAYMENT: "VERIFICA_OVERPAYMENT",
  CONTROLLA_REFUND: "CONTROLLA_REFUND",
  CORREGGI_DATI_CASH: "CORREGGI_DATI_CASH"
});

// Centralized formal thresholds for cash_core_v1. Keep these explicit so tuning is auditable.
const CASH_RECONCILIATION_THRESHOLDS = Object.freeze({
  thetaReal: 0.9,
  thetaStandard: 0.78,
  thetaReview: 0.48,
  ambiguityEpsilon: 0.03,
  strongDateWindowDays: 3,
  standardDateWindowDays: 7
});

const CASH_CONFIDENCE_WEIGHTS = Object.freeze({
  reconciliationRatio: 0.35,
  inverseAmbiguityRatio: 0.25,
  dataCompleteness: 0.25,
  inverseLegacyFriction: 0.15
});

const CASH_CONFIDENCE_THRESHOLDS = Object.freeze({
  realScore: 0.9,
  realMinRR: 0.95,
  realMaxAR: 0.05,
  standardScore: 0.75,
  standardMinRR: 0.8,
  standardMaxAR: 0.15,
  estimatedScore: 0.5
});

function cents(value = 0) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function positive(value = 0) {
  return Math.max(0, cents(value));
}

function clamp01(value = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function ratio(numerator = 0, denominator = 0) {
  const den = Number(denominator || 0);
  if (!den) return null;
  return Number(numerator || 0) / den;
}

function toDateOnly(value = "") {
  return String(value || "").slice(0, 10);
}

function dayTime(value = "") {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function daysBetween(a = "", b = "") {
  const aTime = dayTime(`${toDateOnly(a)}T00:00:00`);
  const bTime = dayTime(`${toDateOnly(b)}T00:00:00`);
  if (!aTime || !bTime) return null;
  return Math.round((aTime - bTime) / 86400000);
}

function inPeriod(value = "", period = {}) {
  const date = toDateOnly(value || "");
  if (!date) return false;
  if (period.startDate && date < period.startDate) return false;
  if (period.endDate && date > period.endDate) return false;
  return true;
}

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function mapById(items = []) {
  return new Map((Array.isArray(items) ? items : []).map((item) => [String(item.id || ""), item]));
}

function clientDisplayName(client = {}) {
  return `${client.firstName || ""} ${client.lastName || ""}`.trim() || client.name || "";
}

function serviceIdsForAppointment(appointment = {}) {
  const ids = Array.isArray(appointment.serviceIds)
    ? appointment.serviceIds
    : (appointment.serviceId ? [appointment.serviceId] : []);
  return ids.map((id) => String(id || "")).filter(Boolean);
}

function computeAppointmentDueCents(appointment = {}, servicesById = new Map()) {
  const explicit = positive(appointment.dueCents || appointment.amountCents || appointment.priceCents || 0);
  if (explicit > 0) return { dueCents: explicit, sourceFlags: [appointment.dueCents ? "due:appointment_due" : "due:appointment_amount"] };
  const serviceIds = serviceIdsForAppointment(appointment);
  const servicesTotal = serviceIds.reduce((sum, id) => sum + positive(servicesById.get(String(id))?.priceCents || 0), 0);
  if (servicesTotal > 0) return { dueCents: servicesTotal, sourceFlags: ["due:service_prices"] };
  return { dueCents: 0, sourceFlags: ["due_missing"] };
}

function buildObligations(appointments = [], services = [], options = {}) {
  const servicesById = options.servicesById || mapById(services);
  const today = toDateOnly(options.today || new Date().toISOString());
  return (Array.isArray(appointments) ? appointments : []).map((appointment) => {
    const status = String(appointment.status || "").toLowerCase();
    const { dueCents, sourceFlags } = computeAppointmentDueCents(appointment, servicesById);
    const dueDate = toDateOnly(appointment.dueAt || appointment.startAt || appointment.createdAt || "");
    const cancelled = ["cancelled", "no_show", "deleted"].includes(status);
    return {
      id: String(appointment.id || ""),
      sourceType: "appointment",
      sourceId: String(appointment.id || ""),
      clientId: String(appointment.clientId || ""),
      clientName: appointment.clientName || appointment.walkInName || "",
      dueDate,
      dueCents: cancelled ? 0 : dueCents,
      rawDueCents: dueCents,
      cancelled,
      writeoff: status === "writeoff" || appointment.writeoff === true,
      refunded: status === "refunded" || appointment.refunded === true,
      statusRaw: status,
      overdueDays: dueDate && dueDate < today ? Math.max(0, -daysBetween(dueDate, today)) : 0,
      sourceFlags
    };
  });
}

function normalizePayment(payment = {}) {
  const amountCents = cents(payment.amountCents || payment.amount || 0);
  const status = String(payment.status || payment.reconciliationStatus || "").toLowerCase();
  const refund = amountCents < 0 || ["refund", "refunded", "storno"].includes(status) || payment.refund === true;
  const voided = ["void", "voided", "cancelled", "ignored"].includes(status);
  return {
    id: String(payment.id || ""),
    sourceId: String(payment.id || ""),
    clientId: String(payment.clientId || ""),
    clientName: payment.walkInName || payment.clientName || "",
    appointmentId: String(payment.appointmentId || ""),
    amountCents: Math.abs(amountCents),
    signedAmountCents: amountCents,
    method: payment.method || "",
    paidAt: payment.paidAt || payment.createdAt || "",
    date: toDateOnly(payment.paidAt || payment.createdAt || ""),
    description: payment.description || payment.note || "",
    refund,
    voided,
    rawStatus: status
  };
}

function matchCandidateScore(payment = {}, obligation = {}, options = {}) {
  const sourceFlags = [];
  if (!payment.id || !obligation.id) return null;
  if (payment.appointmentId && payment.appointmentId === obligation.sourceId) {
    return {
      obligationId: obligation.id,
      paymentId: payment.id,
      matchConfidence: 1,
      matchBand: CASH_CONFIDENCE.REAL,
      level: "explicit_link",
      sourceFlags: ["match:explicit_appointment_id"]
    };
  }
  const sameClient = payment.clientId && obligation.clientId && payment.clientId === obligation.clientId;
  const exactAmount = positive(payment.amountCents) === positive(obligation.dueCents);
  const residualCompatible = positive(payment.amountCents) <= positive(obligation.dueCents) || exactAmount;
  const dateDistance = payment.date && obligation.dueDate ? Math.abs(daysBetween(payment.date, obligation.dueDate) ?? 999) : 999;
  const dateCompatible = dateDistance <= Number(options.strongDateWindowDays ?? CASH_RECONCILIATION_THRESHOLDS.strongDateWindowDays);
  const standardDateCompatible = dateDistance <= Number(options.standardDateWindowDays ?? CASH_RECONCILIATION_THRESHOLDS.standardDateWindowDays);
  if (sameClient) sourceFlags.push("match:same_client");
  if (exactAmount) sourceFlags.push("match:exact_amount");
  if (residualCompatible) sourceFlags.push("match:residual_compatible");
  if (dateCompatible) sourceFlags.push("match:date_compatible");
  if (sameClient && exactAmount && dateCompatible) {
    return {
      obligationId: obligation.id,
      paymentId: payment.id,
      matchConfidence: 0.96,
      matchBand: CASH_CONFIDENCE.REAL,
      level: "strong",
      sourceFlags
    };
  }
  const amountDiff = Math.abs(positive(payment.amountCents) - positive(obligation.dueCents));
  const amountReference = Math.max(positive(payment.amountCents), positive(obligation.dueCents), 1);
  const amountCompatibility = 1 - clamp01(amountDiff / amountReference);
  const methodConsistency = payment.method ? 1 : 0.5;
  const standardScore = (sameClient ? 0.38 : 0)
    + (amountCompatibility * 0.3)
    + (residualCompatible ? 0.12 : 0)
    + (standardDateCompatible ? 0.14 : 0)
    + (methodConsistency * 0.06);
  if (standardScore >= Number(options.thetaStandard ?? CASH_RECONCILIATION_THRESHOLDS.thetaStandard)) {
    return {
      obligationId: obligation.id,
      paymentId: payment.id,
      matchConfidence: Number(standardScore.toFixed(3)),
      matchBand: CASH_CONFIDENCE.STANDARD,
      level: "standard",
      sourceFlags: [...sourceFlags, "match:standard_candidate"]
    };
  }
  if (standardScore >= Number(options.thetaReview ?? CASH_RECONCILIATION_THRESHOLDS.thetaReview)) {
    return {
      obligationId: obligation.id,
      paymentId: payment.id,
      matchConfidence: Number(standardScore.toFixed(3)),
      matchBand: CASH_CONFIDENCE.ESTIMATED,
      level: "weak_review",
      sourceFlags: [...sourceFlags, "match:weak_review"]
    };
  }
  return null;
}

function reconcilePayments({ obligations = [], payments = [], options = {} } = {}) {
  const allocationThreshold = Number(options.autoAllocateThreshold ?? CASH_RECONCILIATION_THRESHOLDS.thetaReal);
  const ambiguityEpsilon = Number(options.ambiguityEpsilon ?? CASH_RECONCILIATION_THRESHOLDS.ambiguityEpsilon);
  const allowStandardSimulation = Boolean(options.allowStandardSimulation);
  const obligationResiduals = new Map(obligations.map((obligation) => [obligation.id, positive(obligation.dueCents)]));
  const paymentAllocated = new Map(payments.map((payment) => [payment.id, 0]));
  const allocations = [];
  const ambiguousAllocations = [];
  const eligibleObligations = obligations.filter((item) => !item.cancelled && !item.writeoff && !item.refunded && positive(item.dueCents) > 0);

  payments.forEach((payment) => {
    if (payment.voided || payment.refund || positive(payment.amountCents) <= 0) return;
    const candidates = eligibleObligations
      .map((obligation) => matchCandidateScore(payment, obligation, options))
      .filter(Boolean)
      .sort((a, b) => b.matchConfidence - a.matchConfidence);
    if (!candidates.length) return;
    const top = candidates[0];
    const tied = candidates.filter((item) => Math.abs(item.matchConfidence - top.matchConfidence) < ambiguityEpsilon);
    const canAllocate = top.matchConfidence >= allocationThreshold
      || (allowStandardSimulation && top.matchBand === CASH_CONFIDENCE.STANDARD);
    if (tied.length > 1 || !canAllocate) {
      ambiguousAllocations.push({
        paymentId: payment.id,
        candidateObligationIds: candidates.slice(0, 5).map((item) => item.obligationId),
        amountCents: positive(payment.amountCents),
        matchConfidence: top.matchConfidence,
        matchBand: top.matchBand,
        sourceFlags: [...top.sourceFlags, tied.length > 1 ? "ambiguous:multiple_candidates" : "ambiguous:below_auto_threshold"]
      });
      return;
    }
    const residual = Number(obligationResiduals.get(top.obligationId) || 0);
    const available = positive(payment.amountCents) - positive(paymentAllocated.get(payment.id));
    const allocatedCents = top.level === "explicit_link" ? available : Math.min(available, Math.max(0, residual));
    if (allocatedCents <= 0) return;
    obligationResiduals.set(top.obligationId, residual - allocatedCents);
    paymentAllocated.set(payment.id, positive(paymentAllocated.get(payment.id)) + allocatedCents);
    allocations.push({
      paymentId: payment.id,
      obligationId: top.obligationId,
      amountCents: allocatedCents,
      matchConfidence: top.matchConfidence,
      matchBand: top.matchBand,
      level: top.level,
      allocationPolicy: top.matchBand === CASH_CONFIDENCE.STANDARD ? "standard_simulated_traced" : "strong_simulated",
      simulated: true,
      persisted: false,
      sourceFlags: [...top.sourceFlags, "allocation:simulated_not_persisted"]
    });
  });

  return {
    allocations,
    ambiguousAllocations,
    obligationResiduals,
    paymentAllocated
  };
}

function classifyObligation(obligation = {}, allocatedCents = 0, today = new Date().toISOString()) {
  if (obligation.cancelled) return OBLIGATION_STATUS.CANCELLED;
  if (obligation.writeoff) return OBLIGATION_STATUS.WRITEOFF;
  if (obligation.refunded) return OBLIGATION_STATUS.REFUNDED;
  const due = positive(obligation.dueCents);
  const allocated = positive(allocatedCents);
  if (allocated > due) return OBLIGATION_STATUS.OVERPAID;
  const residual = Math.max(0, due - allocated);
  if (due > 0 && residual === 0) return OBLIGATION_STATUS.PAID;
  if (allocated > 0 && residual > 0) return OBLIGATION_STATUS.PARTIAL;
  if (residual > 0 && obligation.dueDate && obligation.dueDate < toDateOnly(today)) return OBLIGATION_STATUS.OVERDUE;
  return OBLIGATION_STATUS.UNPAID;
}

function classifyPayment(payment = {}, allocatedCents = 0, ambiguous = false) {
  if (payment.voided) return PAYMENT_STATUS.VOID;
  if (payment.refund) return PAYMENT_STATUS.REFUND;
  if (ambiguous) return PAYMENT_STATUS.AMBIGUOUS;
  const amount = positive(payment.amountCents);
  const allocated = positive(allocatedCents);
  if (allocated >= amount && amount > 0) return PAYMENT_STATUS.MATCHED;
  if (allocated > 0 && allocated < amount) return PAYMENT_STATUS.PARTIALLY_MATCHED;
  return PAYMENT_STATUS.UNLINKED;
}

function buildCashLedger({ appointments = [], payments = [], services = [], period = {}, options = {} } = {}) {
  const today = options.today || new Date().toISOString();
  const obligations = buildObligations(appointments, services, { ...options, today })
    .filter((item) => !period.startDate && !period.endDate ? true : inPeriod(item.dueDate || "", period));
  const normalizedPayments = (Array.isArray(payments) ? payments : [])
    .map(normalizePayment)
    .filter((item) => !period.startDate && !period.endDate ? true : inPeriod(item.date || item.paidAt || "", period));
  const reconciliation = reconcilePayments({ obligations, payments: normalizedPayments, options });
  const ambiguousPaymentIds = new Set(reconciliation.ambiguousAllocations.map((item) => item.paymentId));
  const allocatedByObligation = new Map();
  reconciliation.allocations.forEach((allocation) => {
    allocatedByObligation.set(allocation.obligationId, positive(allocatedByObligation.get(allocation.obligationId)) + positive(allocation.amountCents));
  });
  const obligationBreakdown = obligations.map((obligation) => {
    const allocatedCents = positive(allocatedByObligation.get(obligation.id));
    const excessCents = Math.max(0, allocatedCents - positive(obligation.dueCents));
    const residualCents = Math.max(0, positive(obligation.dueCents) - allocatedCents);
    return {
      ...obligation,
      allocatedCents,
      excessCents,
      residualCents,
      status: classifyObligation(obligation, allocatedCents, today)
    };
  });
  const paymentBreakdown = normalizedPayments.map((payment) => {
    const allocatedCents = positive(reconciliation.paymentAllocated.get(payment.id));
    const unallocatedCents = Math.max(0, positive(payment.amountCents) - allocatedCents);
    return {
      ...payment,
      allocatedCents,
      unallocatedCents,
      status: classifyPayment(payment, allocatedCents, ambiguousPaymentIds.has(payment.id)),
      sourceFlags: [
        payment.appointmentId ? "payment:has_appointment_id" : "payment:missing_appointment_id",
        payment.clientId ? "payment:has_client_id" : "payment:missing_client_id",
        payment.method ? "payment:has_method" : "payment:missing_method"
      ]
    };
  });
  return {
    mathCore: "cash_core_v1",
    period,
    generatedAt: new Date().toISOString(),
    obligations: obligationBreakdown,
    payments: paymentBreakdown,
    allocations: reconciliation.allocations,
    ambiguousAllocations: reconciliation.ambiguousAllocations,
    sourceFlags: ["cash_ledger:simulated_allocations", "cash_ledger:no_persistence"]
  };
}

function computeCashKPIs(ledger = {}) {
  const obligations = ledger.obligations || [];
  const payments = ledger.payments || [];
  const billedDueCents = obligations.reduce((sum, item) => sum + positive(item.dueCents), 0);
  const reconciledCashCents = payments.reduce((sum, item) => sum + positive(item.allocatedCents), 0);
  const recordedCashCents = payments.filter((item) => item.status !== PAYMENT_STATUS.VOID && item.status !== PAYMENT_STATUS.REFUND)
    .reduce((sum, item) => sum + positive(item.amountCents), 0);
  const refundsCents = payments.filter((item) => item.status === PAYMENT_STATUS.REFUND)
    .reduce((sum, item) => sum + positive(item.amountCents), 0);
  const ambiguousCashCents = payments.filter((item) => item.status === PAYMENT_STATUS.AMBIGUOUS)
    .reduce((sum, item) => sum + positive(item.unallocatedCents || item.amountCents), 0);
  const unlinkedCashCents = payments.filter((item) => item.status === PAYMENT_STATUS.UNLINKED)
    .reduce((sum, item) => sum + positive(item.unallocatedCents || item.amountCents), 0);
  const overdueCents = obligations.filter((item) => item.status === OBLIGATION_STATUS.OVERDUE)
    .reduce((sum, item) => sum + positive(item.residualCents), 0);
  const openResidualCents = obligations
    .filter((item) => [OBLIGATION_STATUS.PARTIAL, OBLIGATION_STATUS.UNPAID, OBLIGATION_STATUS.OVERDUE].includes(item.status))
    .reduce((sum, item) => sum + positive(item.residualCents), 0);
  const totalDueOpen = openResidualCents;
  return {
    billedDueCents,
    reconciledCashCents,
    recordedCashCents,
    unlinkedCashCents,
    ambiguousCashCents,
    refundsCents,
    netReconciledCashCents: reconciledCashCents - refundsCents,
    overdueCents,
    openResidualCents,
    gapCents: billedDueCents - reconciledCashCents,
    collectionRatio: ratio(reconciledCashCents, billedDueCents),
    reconciliationRatio: ratio(reconciledCashCents, recordedCashCents),
    ambiguityRatio: ratio(ambiguousCashCents + unlinkedCashCents, recordedCashCents),
    overdueRatio: ratio(overdueCents, totalDueOpen)
  };
}

function bucketForDays(days = 0) {
  if (days <= 0) return "current";
  if (days <= 7) return "1_7";
  if (days <= 30) return "8_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "over_90";
}

function emptyAgingBucket(bucket) {
  return { bucket, count: 0, dueCents: 0, paidCents: 0, residualCents: 0, overdueResidualCents: 0 };
}

function computeCashAging(ledger = {}, options = {}) {
  const today = toDateOnly(options.today || new Date().toISOString());
  const buckets = ["current", "1_7", "8_30", "31_60", "61_90", "over_90"].reduce((acc, bucket) => {
    acc[bucket] = emptyAgingBucket(bucket);
    return acc;
  }, {});
  (ledger.obligations || []).forEach((obligation) => {
    const overdueDays = obligation.dueDate && obligation.dueDate < today ? Math.max(0, -daysBetween(obligation.dueDate, today)) : 0;
    const bucket = bucketForDays(overdueDays);
    buckets[bucket].count += 1;
    buckets[bucket].dueCents += positive(obligation.dueCents);
    buckets[bucket].paidCents += positive(obligation.allocatedCents);
    buckets[bucket].residualCents += positive(obligation.residualCents);
    if (overdueDays > 0) buckets[bucket].overdueResidualCents += positive(obligation.residualCents);
  });
  return Object.values(buckets);
}

function computeCashConfidence(kpis = {}, ledger = {}) {
  const rr = kpis.reconciliationRatio == null ? 0 : clamp01(kpis.reconciliationRatio);
  const ar = kpis.ambiguityRatio == null ? 1 : clamp01(kpis.ambiguityRatio);
  const payments = ledger.payments || [];
  const obligations = ledger.obligations || [];
  const completeRows = payments.filter((item) => item.amountCents > 0 && item.date && (item.clientId || item.clientName || item.appointmentId) && item.method).length;
  const completeObligations = obligations.filter((item) => item.dueCents > 0 && item.dueDate && (item.clientId || item.clientName) && !item.sourceFlags?.includes("due_missing")).length;
  const paymentCompleteness = payments.length ? completeRows / payments.length : 0;
  const obligationCompleteness = obligations.length ? completeObligations / obligations.length : 0;
  const completeness = payments.length || obligations.length ? (paymentCompleteness * 0.6) + (obligationCompleteness * 0.4) : 0;
  const legacyFallbacks = [
    ...payments.filter((item) => item.sourceFlags?.some((flag) => String(flag).includes("missing"))),
    ...obligations.filter((item) => item.sourceFlags?.some((flag) => String(flag).includes("missing")))
  ].length;
  const fallbackDenominator = payments.length + obligations.length;
  const fallbackRatio = fallbackDenominator ? legacyFallbacks / fallbackDenominator : 1;
  const confidenceScore = clamp01(
    (CASH_CONFIDENCE_WEIGHTS.reconciliationRatio * rr)
    + (CASH_CONFIDENCE_WEIGHTS.inverseAmbiguityRatio * (1 - ar))
    + (CASH_CONFIDENCE_WEIGHTS.dataCompleteness * completeness)
    + (CASH_CONFIDENCE_WEIGHTS.inverseLegacyFriction * (1 - fallbackRatio))
  );
  let confidence = CASH_CONFIDENCE.INCOMPLETE;
  if (payments.length === 0 && obligations.length === 0) {
    confidence = CASH_CONFIDENCE.INCOMPLETE;
  } else if (confidenceScore >= CASH_CONFIDENCE_THRESHOLDS.realScore && rr >= CASH_CONFIDENCE_THRESHOLDS.realMinRR && ar <= CASH_CONFIDENCE_THRESHOLDS.realMaxAR) {
    confidence = CASH_CONFIDENCE.REAL;
  } else if (confidenceScore >= CASH_CONFIDENCE_THRESHOLDS.standardScore && rr >= CASH_CONFIDENCE_THRESHOLDS.standardMinRR && ar <= CASH_CONFIDENCE_THRESHOLDS.standardMaxAR) {
    confidence = CASH_CONFIDENCE.STANDARD;
  } else if (confidenceScore >= CASH_CONFIDENCE_THRESHOLDS.estimatedScore) {
    confidence = CASH_CONFIDENCE.ESTIMATED;
  }
  return {
    confidence,
    confidenceScore: Number(confidenceScore.toFixed(3)),
    confidenceBreakdown: {
      reconciliationRatio: rr,
      ambiguityRatio: ar,
      dataCompleteness: Number(completeness.toFixed(3)),
      legacyFriction: Number(fallbackRatio.toFixed(3)),
      weights: CASH_CONFIDENCE_WEIGHTS
    }
  };
}

function amountWeight(amountCents = 0, maxAmountCents = 1) {
  return clamp01(positive(amountCents) / Math.max(positive(maxAmountCents), 1));
}

function computeCashPriorityQueue(ledger = {}, options = {}) {
  const obligations = ledger.obligations || [];
  const payments = ledger.payments || [];
  const maxAmount = Math.max(1, ...obligations.map((item) => positive(item.residualCents)), ...payments.map((item) => positive(item.unallocatedCents || item.amountCents)));
  const today = toDateOnly(options.today || new Date().toISOString());
  const queue = [];
  obligations.forEach((item) => {
    if (![OBLIGATION_STATUS.OVERDUE, OBLIGATION_STATUS.PARTIAL, OBLIGATION_STATUS.OVERPAID].includes(item.status)) return;
    const delay = item.dueDate && item.dueDate < today ? Math.max(0, -daysBetween(item.dueDate, today)) : 0;
    const severityOverdue = clamp01(delay / 30);
    const ambiguityWeight = item.status === OBLIGATION_STATUS.OVERPAID ? 0.7 : 0.2;
    const confidencePenalty = item.sourceFlags?.includes("due_missing") ? 1 : 0.15;
    const priority = (0.35 * severityOverdue)
      + (0.25 * amountWeight(item.residualCents || item.dueCents, maxAmount))
      + (0.20 * ambiguityWeight)
      + (0.10 * 0)
      + (0.10 * confidencePenalty);
    queue.push({
      type: item.status === OBLIGATION_STATUS.OVERPAID ? CASH_ACTION.VERIFICA_OVERPAYMENT : item.status === OBLIGATION_STATUS.PARTIAL ? CASH_ACTION.VERIFICA_PARTIAL : CASH_ACTION.SOLLECITA_RESIDUO,
      label: item.status === OBLIGATION_STATUS.OVERPAID ? "Controlla eccedenza / overpayment" : item.status === OBLIGATION_STATUS.PARTIAL ? "Verifica pagamento parziale" : "Sollecita residuo cliente",
      entityType: "obligation",
      entityId: item.id,
      amountCents: positive(item.residualCents || item.dueCents),
      priority: Number(clamp01(priority).toFixed(3)),
      status: item.status,
      sourceFlags: item.sourceFlags || []
    });
  });
  payments.forEach((item) => {
    if (![PAYMENT_STATUS.UNLINKED, PAYMENT_STATUS.AMBIGUOUS, PAYMENT_STATUS.PARTIALLY_MATCHED, PAYMENT_STATUS.REFUND].includes(item.status)) return;
    const ageDays = item.date ? Math.max(0, -daysBetween(item.date, today)) : 0;
    const severityOverdue = clamp01(ageDays / 30);
    const ambiguityWeight = item.status === PAYMENT_STATUS.AMBIGUOUS ? 1 : item.status === PAYMENT_STATUS.UNLINKED ? 0.85 : 0.45;
    const confidencePenalty = item.sourceFlags?.some((flag) => String(flag).includes("missing")) ? 0.75 : 0.25;
    const priority = (0.35 * severityOverdue)
      + (0.25 * amountWeight(item.unallocatedCents || item.amountCents, maxAmount))
      + (0.20 * ambiguityWeight)
      + (0.10 * 0)
      + (0.10 * confidencePenalty);
    queue.push({
      type: item.status === PAYMENT_STATUS.AMBIGUOUS
        ? CASH_ACTION.MATCH_PAYMENT_REVIEW
        : item.status === PAYMENT_STATUS.REFUND
          ? CASH_ACTION.CONTROLLA_REFUND
          : item.status === PAYMENT_STATUS.PARTIALLY_MATCHED
            ? CASH_ACTION.VERIFICA_PARTIAL
            : CASH_ACTION.CORREGGI_DATI_CASH,
      label: item.status === PAYMENT_STATUS.AMBIGUOUS
        ? "Collega pagamento ambiguo"
        : item.status === PAYMENT_STATUS.REFUND
          ? "Controlla rimborso / storno"
          : item.status === PAYMENT_STATUS.PARTIALLY_MATCHED
            ? "Verifica pagamento parziale"
            : "Correggi dati cash",
      entityType: "payment",
      entityId: item.id,
      amountCents: positive(item.unallocatedCents || item.amountCents),
      priority: Number(clamp01(priority).toFixed(3)),
      status: item.status,
      sourceFlags: item.sourceFlags || []
    });
  });
  return queue.sort((a, b) => b.priority - a.priority || b.amountCents - a.amountCents);
}

function computeCashSnapshot({ appointments = [], payments = [], services = [], period = {}, options = {} } = {}) {
  const ledger = buildCashLedger({ appointments, payments, services, period, options });
  const kpis = computeCashKPIs(ledger);
  const agingBuckets = computeCashAging(ledger, options);
  const confidence = computeCashConfidence(kpis, ledger);
  const priorityQueue = computeCashPriorityQueue(ledger, options);
  return {
    mathCore: "cash_core_v1",
    period,
    generatedAt: ledger.generatedAt,
    ...kpis,
    ...confidence,
    sourceFlags: [...ledger.sourceFlags],
    agingBuckets,
    paymentBreakdown: ledger.payments,
    obligationBreakdown: ledger.obligations,
    allocations: ledger.allocations,
    ambiguousAllocations: ledger.ambiguousAllocations,
    priorityQueue
  };
}

module.exports = {
  CASH_ACTION,
  CASH_CONFIDENCE,
  CASH_CONFIDENCE_THRESHOLDS,
  CASH_CONFIDENCE_WEIGHTS,
  CASH_RECONCILIATION_THRESHOLDS,
  OBLIGATION_STATUS,
  PAYMENT_STATUS,
  buildCashLedger,
  reconcilePayments,
  computeCashSnapshot,
  computeCashKPIs,
  computeCashAging,
  computeCashConfidence,
  computeCashPriorityQueue
};
