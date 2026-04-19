const DEFAULT_BASE_URL = "https://skinharmony-smartdesk-live.onrender.com";

const AGREEMENT_RULE = Object.freeze({
  aligned: 0.90,
  watch: 0.75
});

const CAUSE_BY_METRIC = Object.freeze({
  crmQuality: {
    positive: "CORE_STRICTER_CRM_POLICY",
    negative: "LEGACY_OVERESTIMATES_CRM",
    warning: "DQ_CRM_DRIFT"
  },
  appointmentQuality: {
    positive: "CORE_STRICTER_APPOINTMENT_POLICY",
    negative: "LEGACY_OVERESTIMATES_APPOINTMENTS",
    warning: "DQ_APPOINTMENT_DRIFT"
  },
  paymentQuality: {
    positive: "CORE_STRICTER_PAYMENT_POLICY",
    negative: "LEGACY_OVERESTIMATES_PAYMENTS",
    warning: "DQ_PAYMENT_DRIFT"
  },
  costQuality: {
    positive: "CORE_STRICTER_COST_POLICY",
    negative: "LEGACY_OVERESTIMATES_COST_COMPLETENESS",
    warning: "DQ_COST_DRIFT"
  },
  linkQuality: {
    positive: "CORE_STRICTER_LINK_POLICY",
    negative: "CORE_STRICTER_LINK_POLICY",
    warning: "DQ_LINK_DRIFT"
  },
  consistencyQuality: {
    positive: "GOLD_STATE_MAPPING_MISMATCH",
    negative: "GOLD_STATE_MAPPING_MISMATCH",
    warning: "DQ_CONSISTENCY_DRIFT"
  },
  temporalQuality: {
    positive: "CORE_STRICTER_TEMPORAL_POLICY",
    negative: "CORE_STRICTER_TEMPORAL_POLICY",
    warning: "DQ_TEMPORAL_DRIFT"
  },
  dataQualityScore: {
    positive: "DQ_TOTAL_POLICY_DIFFERENCE",
    negative: "DQ_TOTAL_POLICY_DIFFERENCE",
    warning: "DQ_TOTAL_DRIFT"
  }
});

function round(value = 0, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function euro(cents = 0) {
  return round(Number(cents || 0) / 100, 2);
}

function clean(value = "") {
  return String(value || "").trim();
}

function pct(value = 0) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${path}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

function userLabel(user = {}) {
  return clean(user.centerName || user.businessName || user.username || user.id);
}

function planOf(user = {}) {
  return String(user.subscriptionPlan || user.plan || "").toLowerCase();
}

function chooseTenants(users = []) {
  const normalized = users.filter((user) => planOf(user) === "gold");
  const privilege = normalized.find((user) => /privilege/i.test(userLabel(user))) || normalized.find((user) => /privilege/i.test(user.username || ""));
  const centro073 = normalized
    .filter((user) => user.id !== privilege?.id)
    .find((user) => /073|centro.*73|gold.*073|gold100_gold_073/i.test([userLabel(user), user.username, user.centerId].join(" ")));
  const medium = centro073
    || normalized.filter((user) => user.id !== privilege?.id).find((user) => /gold100_gold_0(2[5-9]|[3-7][0-9])|gold_0(2[5-9]|[3-7][0-9])/i.test([user.username, user.centerId].join(" ")))
    || normalized.find((user) => user.id !== privilege?.id);
  const centro001 = normalized
    .filter((user) => ![privilege?.id, medium?.id].includes(user.id))
    .find((user) => /001|centro.*1|gold.*001|gold100_gold_001/i.test([userLabel(user), user.username, user.centerId].join(" ")));
  const fragile = normalized
    .filter((user) => ![privilege?.id, medium?.id, centro001?.id].includes(user.id))
    .reverse()
    .find((user) => /100|fragile|incomplet|gold100_gold_100/i.test([userLabel(user), user.username, user.centerId].join(" ")))
    || normalized.find((user) => ![privilege?.id, medium?.id, centro001?.id].includes(user.id));
  return [privilege, medium, centro001, fragile].filter(Boolean);
}

function normalizeEndpointRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.clients)) return data.clients;
  if (Array.isArray(data?.appointments)) return data.appointments;
  if (Array.isArray(data?.payments)) return data.payments;
  if (Array.isArray(data?.services)) return data.services;
  if (Array.isArray(data?.staff)) return data.staff;
  if (Array.isArray(data?.resources)) return data.resources;
  return [];
}

function componentDeltasAgainst(legacy = {}, core = {}) {
  const metrics = [
    "dataQualityScore",
    "crmQuality",
    "appointmentQuality",
    "paymentQuality",
    "costQuality",
    "linkQuality",
    "consistencyQuality",
    "temporalQuality"
  ];
  return metrics.reduce((acc, metric) => {
    if (core[metric] === null || core[metric] === undefined) return acc;
    if (legacy[metric] === null || legacy[metric] === undefined) {
      acc[metric] = { legacy: null, core: round(core[metric]), delta: null, comparable: false };
      return acc;
    }
    const legacyValue = Number(legacy[metric] || 0);
    const coreValue = Number(core[metric] || 0);
    acc[metric] = {
      legacy: round(legacyValue),
      core: round(coreValue),
      delta: round(coreValue - legacyValue),
      abs: round(Math.abs(coreValue - legacyValue)),
      comparable: true
    };
    return acc;
  }, {});
}

function componentDeltas(parallel = {}) {
  return componentDeltasAgainst(parallel.legacySnapshot || {}, parallel.coreSnapshot || {});
}

function comparableComponentDeltas(parallel = {}) {
  return componentDeltasAgainst(parallel.legacySnapshot || {}, parallel.comparableSnapshot || {});
}

function weakExamples(rows = [], predicate, mapper) {
  return rows.filter(predicate).slice(0, 2).map(mapper);
}

function explainCauses({ deltas, diffSnapshot = {}, raw = {} }) {
  const warnings = new Set(diffSnapshot.warnings || []);
  const causes = [];
  Object.entries(deltas || {}).forEach(([metric, value]) => {
    if (!value || value.delta === null || Math.abs(value.delta) < 0.15) return;
    const causeMap = CAUSE_BY_METRIC[metric];
    if (!causeMap) return;
    const cause = value.delta > 0 ? causeMap.positive : causeMap.negative;
    const examples = [];
    if (metric === "crmQuality") {
      examples.push(...weakExamples(raw.clients, (client) => !client.phone || !client.email, (client) => ({
        id: client.id,
        name: [client.firstName, client.lastName].filter(Boolean).join(" ") || client.name || "Cliente",
        missing: [!client.phone ? "phone" : "", !client.email ? "email" : ""].filter(Boolean)
      })));
    }
    if (metric === "appointmentQuality") {
      examples.push(...weakExamples(raw.appointments, (item) => !item.clientId || !item.serviceId || !item.startAt, (item) => ({
        id: item.id,
        status: item.status || "",
        missing: [!item.clientId ? "clientId" : "", !item.serviceId ? "serviceId" : "", !item.startAt ? "startAt" : ""].filter(Boolean)
      })));
    }
    if (metric === "paymentQuality") {
      examples.push(...weakExamples(raw.payments, (item) => !item.clientId || !item.appointmentId || !item.method || Number(item.amountCents || 0) <= 0, (item) => ({
        id: item.id,
        amount: euro(item.amountCents),
        missing: [!item.clientId ? "clientId" : "", !item.appointmentId ? "appointmentId" : "", !item.method ? "method" : ""].filter(Boolean)
      })));
    }
    if (metric === "costQuality") {
      examples.push(...weakExamples(raw.services, (item) => !item.productLinks?.length && !item.technologyLinks?.length && !item.estimatedProductCostCents && !item.productCostCents && !item.technologyCostCents, (item) => ({
        id: item.id,
        name: item.name || "Servizio",
        issue: "missing product/technology/cost links"
      })));
    }
    causes.push({
      category: cause,
      metric,
      contribution: round(Math.abs(value.delta)),
      warning: warnings.has(causeMap.warning) ? causeMap.warning : "",
      examples
    });
  });
  if (!causes.length && warnings.size) {
    causes.push(...Array.from(warnings).map((warning) => ({
      category: warning.includes("CONSISTENCY") ? "GOLD_STATE_MAPPING_MISMATCH" : warning.includes("TEMPORAL") ? "CORE_STRICTER_TEMPORAL_POLICY" : "DQ_TOTAL_POLICY_DIFFERENCE",
      metric: warning,
      contribution: null,
      warning,
      examples: []
    })));
  }
  return causes.sort((a, b) => Number(b.contribution || 0) - Number(a.contribution || 0));
}

function promotionDecision(parallel = {}) {
  const score = Number(parallel.agreementScore || 0);
  const coreBand = parallel.coreSnapshot?.band || "INCOMPLETE";
  if (score >= AGREEMENT_RULE.aligned && ["REAL", "STANDARD"].includes(coreBand)) return "YES";
  if (score >= AGREEMENT_RULE.watch) return "WATCH";
  return "NO";
}

function finalJudgement(decision) {
  if (decision === "YES") return "pronto per fonte primaria";
  if (decision === "WATCH") return "quasi pronto / osservare";
  return "non pronto";
}

async function auditTenant(baseUrl, adminToken, tenant) {
  const support = await request(baseUrl, `/api/auth/users/${tenant.id}/support-session`, { method: "POST", token: adminToken, body: {} });
  const token = support.token;
  const [
    state,
    legacyQuality,
    pial,
    clients,
    appointments,
    payments,
    services,
    staff,
    inventory,
    resources
  ] = await Promise.all([
    request(baseUrl, "/api/ai-gold/state", { token }),
    request(baseUrl, "/api/data-quality", { token }),
    request(baseUrl, "/api/ai-gold/progressive-intelligence", { token }),
    request(baseUrl, "/api/clients?summary=1&limit=5000", { token }).catch(() => []),
    request(baseUrl, "/api/appointments?view=all", { token }).catch(() => []),
    request(baseUrl, "/api/payments", { token }).catch(() => []),
    request(baseUrl, "/api/catalog/services", { token }).catch(() => []),
    request(baseUrl, "/api/catalog/staff", { token }).catch(() => []),
    request(baseUrl, "/api/inventory/items", { token }).catch(() => []),
    request(baseUrl, "/api/catalog/resources", { token }).catch(() => [])
  ]);
  const parallel = state.dataQualityParallel || {};
  const selection = state.dataQualitySelection || {};
  const primarySnapshot = state.dataQualityPrimarySnapshot || {};
  const shadowSnapshot = state.dataQualityShadowSnapshot || {};
  const rawDeltas = componentDeltas(parallel);
  const comparableDeltas = comparableComponentDeltas(parallel);
  const raw = {
    clients: normalizeEndpointRows(clients),
    appointments: normalizeEndpointRows(appointments),
    payments: normalizeEndpointRows(payments),
    services: normalizeEndpointRows(services),
    staff: normalizeEndpointRows(staff),
    inventory: normalizeEndpointRows(inventory),
    resources: normalizeEndpointRows(resources)
  };
  const decision = promotionDecision(parallel);
  return {
    tenantId: tenant.id,
    username: tenant.username,
    centerId: tenant.centerId,
    centerName: userLabel(tenant),
    selectedReason: /privilege/i.test(userLabel(tenant)) ? "tenant obbligatorio Privilege" : "tenant Gold reale scelto per confronto medio/fragile",
    rawCounts: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value.length])),
    legacyEndpoint: {
      score: round(Number(legacyQuality.score || 0) / 100),
      status: legacyQuality.status || "",
      alerts: (legacyQuality.alerts || []).slice(0, 5)
    },
    dataQualityParallel: {
      status: parallel.status || "missing",
      legacyScore: parallel.legacySnapshot?.dataQualityScore ?? null,
      coreScore: parallel.coreSnapshot?.dataQualityScore ?? null,
      comparableScore: parallel.comparableSnapshot?.dataQualityScore ?? null,
      legacyBand: parallel.legacySnapshot?.band || "N/A",
      coreBand: parallel.coreSnapshot?.band || "N/A",
      comparableBand: parallel.comparableSnapshot?.band || "N/A",
      rawAgreementScore: parallel.rawAgreementScore ?? parallel.rawDiffSnapshot?.agreementScore ?? null,
      rawAgreementBand: parallel.rawAgreementBand || parallel.rawDiffSnapshot?.agreementBand || "N/A",
      agreementScore: parallel.agreementScore ?? null,
      agreementBand: parallel.agreementBand || "N/A",
      comparableMetrics: parallel.diffSnapshot?.comparableMetrics || [],
      warnings: parallel.diffSnapshot?.warnings || [],
      rawDeltas,
      comparableDeltas,
      policyAdapter: parallel.policyAdapter || null,
      coreGate: parallel.coreSnapshot?.gate || {},
      sourceFlags: parallel.sourceFlags || []
    },
    dataQualitySelection: {
      primarySource: selection.primarySource || "missing",
      previousSource: selection.previousSource || "",
      shadowSource: selection.shadowSource || "",
      switchEligible: selection.switchEligible ?? null,
      reliabilityScore: selection.reliabilityScore ?? null,
      agreementScore: selection.agreementScore ?? null,
      agreementBand: selection.agreementBand || "N/A",
      coreScore: selection.coreScore ?? null,
      coreBand: selection.coreBand || "N/A",
      switchReason: selection.switchReason || "",
      fallbackReason: selection.fallbackReason || "",
      primarySnapshot: {
        sourceUsed: primarySnapshot.sourceUsed || "",
        dataQualityScore: primarySnapshot.dataQualityScore ?? null,
        band: primarySnapshot.band || "N/A"
      },
      shadowSnapshot: {
        sourceUsed: shadowSnapshot.sourceUsed || "",
        dataQualityScore: shadowSnapshot.dataQualityScore ?? null,
        band: shadowSnapshot.band || "N/A"
      },
      comparableSnapshot: {
        sourceUsed: state.dataQualityComparableSnapshot?.sourceUsed || "",
        dataQualityScore: state.dataQualityComparableSnapshot?.dataQualityScore ?? null,
        band: state.dataQualityComparableSnapshot?.band || "N/A"
      }
    },
    pialDataQualityComparison: pial.pialDataQualityComparison || null,
    causes: explainCauses({ deltas: rawDeltas, diffSnapshot: parallel.rawDiffSnapshot || parallel.diffSnapshot || {}, raw }),
    promoteToCoreDQ: decision,
    judgement: finalJudgement(decision)
  };
}

async function main() {
  const baseUrl = process.env.SMARTDESK_LIVE_URL || DEFAULT_BASE_URL;
  const username = process.env.SMARTDESK_ADMIN_USER;
  const password = process.env.SMARTDESK_ADMIN_PASSWORD;
  if (!username || !password) throw new Error("Set SMARTDESK_ADMIN_USER and SMARTDESK_ADMIN_PASSWORD");
  const health = await request(baseUrl, "/health");
  const login = await request(baseUrl, "/api/auth/login", { method: "POST", body: { username, password } });
  const users = await request(baseUrl, "/api/auth/users", { token: login.token });
  const tenants = chooseTenants(users);
  if (!tenants.length) throw new Error("No Gold tenants found");
  const audits = [];
  for (const tenant of tenants) {
    audits.push(await auditTenant(baseUrl, login.token, tenant));
  }
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl,
    health,
    tenantsAnalyzed: audits.map((item) => item.centerName),
    audits,
    confirmations: {
      readOnly: true,
      dataQualityCorePrimary: false,
      uiChanged: false,
      publicApiChanged: false,
      realDataModified: false
    }
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  componentDeltas,
  componentDeltasAgainst,
  comparableComponentDeltas,
  explainCauses,
  promotionDecision,
  chooseTenants
};
