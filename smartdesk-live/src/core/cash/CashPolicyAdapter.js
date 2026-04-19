"use strict";

const LEGACY_BILLED_DUE_STATUSES = Object.freeze(["completed", "ready_checkout"]);
const OPERATIONAL_EXCLUDED_STATUSES = Object.freeze(["cancelled", "no_show", "deleted"]);

function cents(value) {
  return Math.round(Number(value || 0));
}

function positive(value) {
  return Math.max(0, cents(value));
}

function ratio(value, total) {
  return Number(total || 0) > 0 ? Number(value || 0) / Number(total || 0) : 0;
}

function lower(value) {
  return String(value || "").toLowerCase();
}

function paymentIsLegacyComparableUnlinked(payment = {}) {
  const status = lower(payment.rawStatus || payment.status || "");
  if (["free", "ignored"].includes(status)) return false;
  return !payment.appointmentId || !payment.clientId;
}

function buildComparableCashSnapshot(operationalSnapshot = {}, options = {}) {
  const legacyStatuses = new Set((options.legacyBilledDueStatuses || LEGACY_BILLED_DUE_STATUSES).map(lower));
  const obligations = Array.isArray(operationalSnapshot.obligationBreakdown) ? operationalSnapshot.obligationBreakdown : [];
  const payments = Array.isArray(operationalSnapshot.paymentBreakdown) ? operationalSnapshot.paymentBreakdown : [];
  const comparableObligations = obligations.filter((item) => legacyStatuses.has(lower(item.statusRaw)));
  const billedDueCents = comparableObligations.reduce((sum, item) => sum + positive(item.dueCents), 0);
  const recordedCashCents = positive(operationalSnapshot.recordedCashCents);
  // Legacy treats all recorded cash as the closest comparable cash figure.
  const reconciledCashCents = recordedCashCents;
  const missingLinkPayments = payments.filter(paymentIsLegacyComparableUnlinked);
  const ambiguousPayments = payments.filter((item) => lower(item.status) === "ambiguous");
  const unlinkedCashCents = missingLinkPayments.reduce((sum, item) => sum + positive(item.unallocatedCents || item.amountCents), 0);
  const ambiguousCashCents = ambiguousPayments.reduce((sum, item) => sum + positive(item.unallocatedCents || item.amountCents), 0);
  const gapCents = billedDueCents - reconciledCashCents;
  const openResidualCents = Math.max(0, gapCents);
  return {
    mathCore: operationalSnapshot.mathCore || "cash_core_v1",
    mathAdapter: "cash_policy_adapter_v1",
    sourceUsed: "core_comparable",
    billedDueCents,
    reconciledCashCents,
    recordedCashCents,
    unlinkedCashCents,
    ambiguousCashCents,
    overdueCents: null,
    openResidualCents,
    gapCents,
    collectionRatio: ratio(reconciledCashCents, billedDueCents),
    reconciliationRatio: ratio(Math.max(0, recordedCashCents - unlinkedCashCents), recordedCashCents),
    ambiguityRatio: ratio(unlinkedCashCents, recordedCashCents),
    overdueRatio: null,
    confidence: operationalSnapshot.confidence || "INCOMPLETE",
    confidenceScore: Number(operationalSnapshot.confidenceScore || 0),
    confidenceBreakdown: operationalSnapshot.confidenceBreakdown || null,
    sourceFlags: [
      "cash_policy_adapter:legacy_comparable_projection",
      "cash_policy_adapter:status_policy_legacy_completed_ready_checkout",
      "cash_policy_adapter:overdue_excluded_from_agreement",
      "cash_policy_adapter:recorded_cash_used_as_cash_equivalent"
    ],
    policyBreakdown: {
      legacyBilledDueStatuses: Array.from(legacyStatuses),
      operationalExcludedStatuses: OPERATIONAL_EXCLUDED_STATUSES,
      futureOpenDueCents: Math.max(0, positive(operationalSnapshot.billedDueCents) - billedDueCents),
      operationalOverdueCents: positive(operationalSnapshot.overdueCents),
      ambiguousCashExcludedFromComparableUnlinkedCents: ambiguousCashCents,
      comparableObligationCount: comparableObligations.length,
      totalObligationCount: obligations.length,
      legacyComparableUnlinkedPaymentCount: missingLinkPayments.length,
      ambiguousPaymentCount: ambiguousPayments.length
    }
  };
}

function buildCashPolicyDelta(operationalSnapshot = {}, comparableSnapshot = {}) {
  return {
    billedDueCents: positive(operationalSnapshot.billedDueCents) - positive(comparableSnapshot.billedDueCents),
    reconciledCashCents: positive(operationalSnapshot.reconciledCashCents) - positive(comparableSnapshot.reconciledCashCents),
    unlinkedCashCents: positive(operationalSnapshot.unlinkedCashCents) + positive(operationalSnapshot.ambiguousCashCents)
      - positive(comparableSnapshot.unlinkedCashCents) - positive(comparableSnapshot.ambiguousCashCents),
    gapCents: cents(operationalSnapshot.gapCents) - cents(comparableSnapshot.gapCents),
    overdueCents: positive(operationalSnapshot.overdueCents)
  };
}

function explainCashPolicyDifferences(operationalSnapshot = {}, comparableSnapshot = {}) {
  const policy = comparableSnapshot.policyBreakdown || {};
  const differences = [];
  if (positive(policy.futureOpenDueCents) > 0) {
    differences.push({
      code: "STATUS_POLICY_MISMATCH",
      amountCents: positive(policy.futureOpenDueCents),
      explanation: "CashCore operativo include obbligazioni aperte/non cancellate che il legacy non conta in billed due."
    });
  }
  if (positive(policy.operationalOverdueCents) > 0) {
    differences.push({
      code: "OVERDUE_EXCLUDED_FROM_AGREEMENT",
      amountCents: positive(policy.operationalOverdueCents),
      explanation: "Overdue operativo mantenuto nel core ma escluso dall'accordo per assenza di metrica legacy equivalente."
    });
  }
  if (positive(policy.ambiguousCashExcludedFromComparableUnlinkedCents) > 0) {
    differences.push({
      code: "AMBIGUOUS_SEPARATED_FROM_LEGACY_UNLINKED",
      amountCents: positive(policy.ambiguousCashExcludedFromComparableUnlinkedCents),
      explanation: "Pagamenti ambigui separati dal confronto unlinked legacy."
    });
  }
  return differences;
}

function adaptCashSnapshotToLegacyComparable(operationalSnapshot = {}, options = {}) {
  const comparableSnapshot = buildComparableCashSnapshot(operationalSnapshot, options);
  const policyDeltas = buildCashPolicyDelta(operationalSnapshot, comparableSnapshot);
  return {
    mathAdapter: "cash_policy_adapter_v1",
    operationalSnapshot,
    comparableSnapshot,
    policyDeltas,
    excludedFromAgreement: {
      overdueCents: {
        value: positive(operationalSnapshot.overdueCents),
        reason: "legacy_has_no_real_overdue_metric"
      },
      futureOpenDueCents: {
        value: positive(comparableSnapshot.policyBreakdown?.futureOpenDueCents),
        reason: "legacy_billed_due_counts_completed_ready_checkout_only"
      }
    },
    policyFlags: [
      "legacy_status_policy:completed_ready_checkout",
      "operational_status_policy:all_non_cancelled",
      "overdue:operational_only",
      "service_shape:preserve_core_operational_snapshot"
    ],
    explanations: explainCashPolicyDifferences(operationalSnapshot, comparableSnapshot)
  };
}

module.exports = {
  LEGACY_BILLED_DUE_STATUSES,
  OPERATIONAL_EXCLUDED_STATUSES,
  adaptCashSnapshotToLegacyComparable,
  buildComparableCashSnapshot,
  buildCashPolicyDelta,
  explainCashPolicyDifferences
};
