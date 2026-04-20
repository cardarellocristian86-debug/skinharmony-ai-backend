const MARKETING_POLICY_ADAPTER_VERSION = "marketing_policy_adapter_v1";

const WA_CONTACT_WEIGHTS = Object.freeze({
  consent: 0.30,
  phoneValid: 0.25,
  cooldownOk: 0.20,
  noOpenThread: 0.10,
  channelQuality: 0.15
});

const LEGACY_CANDIDATE_THRESHOLD = Object.freeze({
  minOpportunity: 0.35,
  minContactability: 0.55,
  maxSpamPressure: 0.45
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

function average(values = [], fallback = 0) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return fallback;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function stddev(values = []) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (clean.length < 2) return 0;
  const mean = average(clean, 0);
  const variance = average(clean.map((value) => (value - mean) ** 2), 0);
  return Math.sqrt(variance);
}

function safeRatio(value = 0, total = 0) {
  const denominator = Number(total || 0);
  if (!denominator) return 0;
  return clamp01(Number(value || 0) / denominator);
}

function idOf(item = {}) {
  return String(item.clientId || item.id || "");
}

function dedupeCandidates(candidates = []) {
  const byId = new Map();
  candidates.filter(Boolean).forEach((candidate) => {
    const clientId = idOf(candidate);
    if (!clientId) return;
    const previous = byId.get(clientId);
    if (!previous || Number(candidate.opportunityScore || 0) > Number(previous.opportunityScore || 0)) {
      byId.set(clientId, {
        ...previous,
        ...candidate,
        clientId
      });
    }
  });
  return Array.from(byId.values());
}

function collectOperationalCandidates(operationalSnapshot = {}) {
  const breakdown = operationalSnapshot.breakdown || {};
  return dedupeCandidates([
    ...(operationalSnapshot.topCandidates || []),
    ...(breakdown.suppressed || []),
    ...(breakdown.reactivation || []),
    ...(breakdown.retention || []),
    ...(breakdown.upsell || []),
    ...(breakdown.monitor || [])
  ]);
}

function legacyCandidateIds(legacySnapshot = {}) {
  return (legacySnapshot.topCandidates || [])
    .map((item) => idOf(item))
    .filter(Boolean);
}

function adaptMarketingContactability(candidate = {}) {
  const generic = clamp01(candidate.contactability);
  const components = candidate.breakdown?.contactability || {};
  const consent = clamp01(components.consent ?? ((candidate.reasonCodes || []).includes("NO_VALID_CONSENT") ? 0 : generic));
  const phoneValid = clamp01(components.reach ?? components.channel ?? generic);
  const cooldownOk = (candidate.reasonCodes || []).includes("SPAM_PRESSURE_TOO_HIGH") ? 0 : clamp01(1 - Number(candidate.spamPressure || 0));
  const noOpenThread = (candidate.reasonCodes || []).includes("OPEN_CONVERSATION") ? 0 : 1;
  const channelQuality = clamp01(components.quality ?? generic);
  const whatsappLike = clamp01(
    (WA_CONTACT_WEIGHTS.consent * consent)
    + (WA_CONTACT_WEIGHTS.phoneValid * phoneValid)
    + (WA_CONTACT_WEIGHTS.cooldownOk * cooldownOk)
    + (WA_CONTACT_WEIGHTS.noOpenThread * noOpenThread)
    + (WA_CONTACT_WEIGHTS.channelQuality * channelQuality)
  );
  return {
    generic: round(generic),
    whatsappLike: round(whatsappLike),
    comparable: round(Math.min(generic || whatsappLike, whatsappLike)),
    components: {
      consent: round(consent),
      phoneValid: round(phoneValid),
      cooldownOk: round(cooldownOk),
      noOpenThread: round(noOpenThread),
      channelQuality: round(channelQuality)
    }
  };
}

function adaptMarketingCandidateUniverse(candidates = [], legacySnapshot = {}) {
  const legacyIds = legacyCandidateIds(legacySnapshot);
  const legacyIdSet = new Set(legacyIds);
  if (legacyIds.length) {
    return {
      candidates: candidates.filter((candidate) => legacyIdSet.has(idOf(candidate))),
      mode: "legacy_generated_action_ids",
      legacyIds
    };
  }
  return {
    candidates: candidates.filter((candidate) => {
      const reasons = new Set(candidate.reasonCodes || []);
      const contact = adaptMarketingContactability(candidate);
      const recallLike = reasons.has("RECALL_WINDOW_OPEN") || reasons.has("REACTIVATION_OPPORTUNITY");
      return recallLike
        && Number(candidate.opportunityScore || 0) >= LEGACY_CANDIDATE_THRESHOLD.minOpportunity
        && contact.comparable >= LEGACY_CANDIDATE_THRESHOLD.minContactability
        && Number(candidate.spamPressure || 0) <= LEGACY_CANDIDATE_THRESHOLD.maxSpamPressure;
    }),
    mode: "legacy_signal_proxy",
    legacyIds
  };
}

function compressMarketingOpportunity(candidates = [], legacySnapshot = {}) {
  const legacyScores = (legacySnapshot.topCandidates || [])
    .map((item) => Number(item.opportunityScore ?? item.score ?? 0))
    .filter(Number.isFinite);
  const opScores = candidates
    .map((item) => Number(item.opportunityScore || 0))
    .filter(Number.isFinite);
  const legacyAverage = Number(legacySnapshot.averageOpportunity);
  const hasLegacyScale = legacyScores.length || Number.isFinite(legacyAverage);
  if (!hasLegacyScale || !opScores.length) {
    return {
      method: "power_compression_no_legacy_scale",
      values: new Map(candidates.map((candidate) => [idOf(candidate), round(clamp01(Number(candidate.opportunityScore || 0) ** 1.15))])),
      scale: {
        legacyMean: null,
        operationalMean: round(average(opScores, 0)),
        legacyStd: null,
        operationalStd: round(stddev(opScores))
      }
    };
  }
  const legacyMean = Number.isFinite(legacyAverage) ? legacyAverage : average(legacyScores, 0);
  const operationalMean = average(opScores, 0);
  const legacyStd = stddev(legacyScores);
  const operationalStd = stddev(opScores);
  const ratio = legacyStd > 0 && operationalStd > 0 ? legacyStd / Math.max(0.000001, operationalStd) : 1;
  return {
    method: "affine_legacy_mean_std",
    values: new Map(candidates.map((candidate) => {
      const score = Number(candidate.opportunityScore || 0);
      return [idOf(candidate), round(clamp01(legacyMean + (ratio * (score - operationalMean))))];
    })),
    scale: {
      legacyMean: round(legacyMean),
      operationalMean: round(operationalMean),
      legacyStd: round(legacyStd),
      operationalStd: round(operationalStd),
      ratio: round(ratio)
    }
  };
}

function adaptMarketingSuppression(candidate = {}, inLegacyUniverse = false) {
  const reasons = new Set(candidate.reasonCodes || []);
  const contact = adaptMarketingContactability(candidate);
  const noConsent = reasons.has("NO_VALID_CONSENT") ? 1 : 0;
  const channelMissing = reasons.has("CONTACT_DATA_TOO_WEAK") || contact.comparable < LEGACY_CANDIDATE_THRESHOLD.minContactability ? 1 : 0;
  const cooldown = Number(candidate.spamPressure || 0) > LEGACY_CANDIDATE_THRESHOLD.maxSpamPressure ? 1 : 0;
  const spamHigh = reasons.has("SPAM_PRESSURE_TOO_HIGH") ? 1 : 0;
  const openConversation = reasons.has("OPEN_CONVERSATION") ? 1 : 0;
  const historyWeak = (candidate.sourceFlags || []).includes("marketing_core:marketing_history_missing_or_empty") ? 0.5 : 0;
  const notInLegacyUniverse = inLegacyUniverse ? 0 : 1;
  const suppression = Math.max(noConsent, channelMissing, cooldown, spamHigh, openConversation, historyWeak, notInLegacyUniverse);
  return {
    score: round(clamp01(suppression)),
    components: {
      noConsent,
      channelMissing,
      cooldown,
      spamHigh,
      openConversation,
      historyWeak,
      notInLegacyUniverse
    }
  };
}

function adaptMarketingRanking(candidates = [], legacySnapshot = {}, compressed = new Map()) {
  const legacyIds = legacyCandidateIds(legacySnapshot);
  const legacyRank = new Map(legacyIds.map((clientId, index) => [clientId, index + 1]));
  return [...candidates]
    .map((candidate) => {
      const clientId = idOf(candidate);
      const contact = adaptMarketingContactability(candidate);
      const comparableOpportunity = compressed.get(clientId) ?? round(clamp01(candidate.opportunityScore));
      const inLegacyUniverse = legacyIds.length ? legacyRank.has(clientId) : true;
      const suppression = adaptMarketingSuppression(candidate, inLegacyUniverse);
      const goalFit = clamp01(candidate.goalFit ?? 0.5);
      const reactivationBoost = (candidate.reasonCodes || []).includes("REACTIVATION_OPPORTUNITY") ? 0.03 : 0;
      const legacyTieBreaker = legacyRank.has(clientId) ? Math.max(0, 0.08 - (legacyRank.get(clientId) - 1) * 0.01) : 0;
      const priorityScoreComparable = clamp01(
        (0.62 * comparableOpportunity)
        + (0.18 * contact.comparable)
        + (0.10 * goalFit)
        + reactivationBoost
        + legacyTieBreaker
        - (0.18 * suppression.score)
      );
      const eligibleComparable = inLegacyUniverse && suppression.score < 1 && contact.comparable >= LEGACY_CANDIDATE_THRESHOLD.minContactability;
      return {
        clientId,
        clientName: candidate.clientName || candidate.name || "Cliente",
        value: candidate.value ?? null,
        churnRisk: candidate.churnRisk ?? null,
        frequency: candidate.frequency ?? null,
        timingOpportunity: candidate.timingOpportunity ?? null,
        contactabilityGeneric: contact.generic,
        contactabilityWhatsapp: contact.whatsappLike,
        contactabilityComparable: contact.comparable,
        spamPressure: round(candidate.spamPressure || 0),
        goalFit: round(goalFit),
        dataQuality: candidate.dataQuality ?? null,
        opportunityScoreOperational: round(candidate.opportunityScore || 0),
        opportunityScoreComparable: round(comparableOpportunity),
        priorityScoreComparable: round(priorityScoreComparable),
        actionBandOperational: candidate.actionBand || "MONITOR",
        actionBandComparable: eligibleComparable ? (priorityScoreComparable >= 0.80 ? "ACT_NOW" : priorityScoreComparable >= 0.60 ? "SUGGEST" : "MONITOR") : "STOP",
        eligibleComparable,
        suppressionComparable: suppression.score,
        suppressionComponents: suppression.components,
        reasonCodes: candidate.reasonCodes || [],
        sourceFlags: candidate.sourceFlags || []
      };
    })
    .sort((a, b) => Number(b.priorityScoreComparable || 0) - Number(a.priorityScoreComparable || 0));
}

function buildComparableData(operationalSnapshot = {}, legacySnapshot = {}, context = {}) {
  const totalClients = Number(operationalSnapshot.counts?.clients ?? legacySnapshot.clients ?? context.clients ?? 0);
  const candidates = collectOperationalCandidates(operationalSnapshot);
  const universe = adaptMarketingCandidateUniverse(candidates, legacySnapshot);
  const compressed = compressMarketingOpportunity(universe.candidates, legacySnapshot);
  const comparableCandidates = adaptMarketingRanking(universe.candidates, legacySnapshot, compressed.values);
  const contactableCandidates = comparableCandidates.filter((candidate) => candidate.eligibleComparable && candidate.contactabilityComparable >= LEGACY_CANDIDATE_THRESHOLD.minContactability);
  const eligibleCandidates = comparableCandidates.filter((candidate) => candidate.eligibleComparable);
  const eligibleClientsComparable = eligibleCandidates.length;
  const contactableClientsComparable = contactableCandidates.length;
  const suppressedClientsComparable = Math.max(0, totalClients - eligibleClientsComparable);
  const averageOpportunityComparable = comparableCandidates.length
    ? round(average(comparableCandidates.map((candidate) => Number(candidate.opportunityScoreComparable || 0)), 0))
    : null;
  const readinessComparable = operationalSnapshot.scores?.marketingReadiness === undefined
    ? null
    : round(clamp01(Number(operationalSnapshot.scores.marketingReadiness || 0) * (universe.mode === "legacy_generated_action_ids" ? 1 : 0.85)));
  return {
    totalClients,
    candidates,
    universe,
    compressed,
    comparableCandidates,
    comparableSnapshot: {
      source: "core_comparable",
      mathAdapter: MARKETING_POLICY_ADAPTER_VERSION,
      readinessComparable,
      readiness: readinessComparable,
      averageOpportunityComparable,
      averageOpportunity: averageOpportunityComparable,
      eligibleClientsComparable,
      eligibleClients: eligibleClientsComparable,
      contactableClientsComparable,
      contactableClients: contactableClientsComparable,
      suppressedClientsComparable,
      suppressedClients: suppressedClientsComparable,
      clients: totalClients,
      eligibleRatioComparable: totalClients ? safeRatio(eligibleClientsComparable, totalClients) : null,
      eligibleRatio: totalClients ? safeRatio(eligibleClientsComparable, totalClients) : null,
      contactableRatioComparable: totalClients ? safeRatio(contactableClientsComparable, totalClients) : null,
      contactableRatio: totalClients ? safeRatio(contactableClientsComparable, totalClients) : null,
      suppressedRatioComparable: totalClients ? safeRatio(suppressedClientsComparable, totalClients) : null,
      suppressedRatio: totalClients ? safeRatio(suppressedClientsComparable, totalClients) : null,
      topCandidatesComparable: comparableCandidates.slice(0, 20),
      topCandidates: comparableCandidates.slice(0, 20).map((candidate) => ({
        clientId: candidate.clientId,
        clientName: candidate.clientName,
        opportunityScore: candidate.opportunityScoreComparable,
        priorityScoreComparable: candidate.priorityScoreComparable,
        actionBand: candidate.actionBandComparable,
        contactability: candidate.contactabilityComparable,
        spamPressure: candidate.spamPressure,
        reasonCodes: candidate.reasonCodes,
        sourceFlags: [
          ...(candidate.sourceFlags || []),
          "marketing_policy_adapter:legacy_comparable_candidate"
        ]
      })),
      sourceFlags: [
        "marketing_policy_adapter:comparable_only",
        `marketing_policy_adapter:universe_${universe.mode}`,
        compressed.method === "affine_legacy_mean_std"
          ? "marketing_policy_adapter:opportunity_affine_legacy_scale"
          : "marketing_policy_adapter:opportunity_power_compression"
      ]
    }
  };
}

function buildMarketingPolicyDelta(operationalSnapshot = {}, comparableSnapshot = {}, data = {}) {
  const opCounts = operationalSnapshot.counts || {};
  const opScores = operationalSnapshot.scores || {};
  const deltas = {
    eligibleClientsDelta: Number(comparableSnapshot.eligibleClientsComparable || 0) - Number(opCounts.eligibleClients || 0),
    contactableClientsDelta: Number(comparableSnapshot.contactableClientsComparable || 0) - Number(opCounts.contactableClients || 0),
    suppressedClientsDelta: Number(comparableSnapshot.suppressedClientsComparable || 0) - Number(opCounts.suppressedClients || 0),
    averageOpportunityDelta: comparableSnapshot.averageOpportunityComparable === null
      ? null
      : round(Number(comparableSnapshot.averageOpportunityComparable || 0) - Number(opScores.averageOpportunity || 0))
  };
  return {
    deltas,
    universe: {
      mode: data.universe?.mode || "unknown",
      operationalCandidates: data.candidates?.length || 0,
      comparableCandidates: data.comparableCandidates?.length || 0,
      legacyCandidateIds: data.universe?.legacyIds || []
    },
    opportunityScale: data.compressed?.scale || {}
  };
}

function explainMarketingPolicyDifferences(operationalSnapshot = {}, legacySnapshot = {}, comparableSnapshot = {}, data = {}) {
  const flags = [
    "candidate_universe_legacy_comparable",
    "contactability_whatsapp_like",
    "suppression_legacy_universe",
    `opportunity_scale_${data.compressed?.method || "unknown"}`
  ];
  if (!(legacySnapshot.topCandidates || []).length) flags.push("legacy_top_candidates_missing");
  if ((operationalSnapshot.sourceFlags || []).includes("marketing_core:marketing_history_missing_or_empty")) flags.push("marketing_history_missing");
  return flags;
}

function adaptMarketingSnapshotToLegacyComparable(operationalSnapshot = {}, legacySnapshot = {}, context = {}) {
  const data = buildComparableData(operationalSnapshot, legacySnapshot, context);
  const excludedFromAgreement = {
    averageChurnRisk: "legacy_has_no_homogeneous_churn_risk_metric",
    averageContactability: "legacy_contactability_is_action_gated_not_generic",
    averageSpamPressure: "legacy_has_no_direct_spam_pressure_metric",
    readiness: "legacy_readiness_not_available_or_not_homogeneous"
  };
  const policyFlags = explainMarketingPolicyDifferences(operationalSnapshot, legacySnapshot, data.comparableSnapshot, data);
  return {
    mathAdapter: MARKETING_POLICY_ADAPTER_VERSION,
    operationalSnapshot,
    comparableSnapshot: data.comparableSnapshot,
    policyDeltas: buildMarketingPolicyDelta(operationalSnapshot, data.comparableSnapshot, data),
    excludedFromAgreement,
    policyFlags,
    policyMethods: {
      candidateUniverse: data.universe.mode,
      contactability: "min_generic_whatsapp_like",
      suppression: "legacy_universe_max_suppression",
      opportunityScale: data.compressed.method,
      ranking: "compressed_opportunity_contactability_suppression_legacy_tiebreak"
    }
  };
}

module.exports = {
  MARKETING_POLICY_ADAPTER_VERSION,
  WA_CONTACT_WEIGHTS,
  LEGACY_CANDIDATE_THRESHOLD,
  adaptMarketingSnapshotToLegacyComparable,
  adaptMarketingCandidateUniverse,
  adaptMarketingContactability,
  adaptMarketingSuppression,
  compressMarketingOpportunity,
  adaptMarketingRanking,
  buildMarketingPolicyDelta,
  explainMarketingPolicyDifferences
};
