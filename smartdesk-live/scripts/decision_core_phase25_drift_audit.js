const DEFAULT_BASE_URL = "https://skinharmony-smartdesk-live.onrender.com";

const CAUSE = Object.freeze({
  PRIMARY_ACTION_MISMATCH: "PRIMARY_ACTION_MISMATCH",
  ACTION_BAND_MISMATCH: "ACTION_BAND_MISMATCH",
  TONE_POLICY_MISMATCH: "TONE_POLICY_MISMATCH",
  SECONDARY_RANKING_MISMATCH: "SECONDARY_RANKING_MISMATCH",
  PRIORITY_SCALE_MISMATCH: "PRIORITY_SCALE_MISMATCH",
  ELIGIBILITY_POLICY_MISMATCH: "ELIGIBILITY_POLICY_MISMATCH",
  LEGACY_SCORE_COMPRESSION: "LEGACY_SCORE_COMPRESSION",
  CORE_SCORE_EXPANSION: "CORE_SCORE_EXPANSION",
  DOMAIN_WEIGHT_MISMATCH: "DOMAIN_WEIGHT_MISMATCH",
  FRAGILE_TENANT_GATING_MISMATCH: "FRAGILE_TENANT_GATING_MISMATCH"
});

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
  if (!response.ok) throw new Error(`${response.status} ${path}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

function round(value = 0, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function clean(value = "") {
  return String(value || "").trim();
}

function label(user = {}) {
  return clean(user.centerName || user.businessName || user.username || user.id);
}

function chooseTenants(users = []) {
  const gold = users.filter((user) => String(user.subscriptionPlan || user.plan || "").toLowerCase() === "gold");
  const privilege = gold.find((user) => /privilege/i.test(label(user))) || gold[0];
  const centro073 = gold.find((user) => user.id !== privilege?.id && /gold100_gold_073|centro 073|centro.*73/i.test([label(user), user.username, user.centerId].join(" ")))
    || gold.find((user) => user.id !== privilege?.id);
  const centro100 = gold.find((user) => ![privilege?.id, centro073?.id].includes(user.id) && /gold100_gold_100|centro 100|centro.*100|fragile|incomplet/i.test([label(user), user.username, user.centerId].join(" ")))
    || gold.find((user) => ![privilege?.id, centro073?.id].includes(user.id));
  return [privilege, centro073, centro100].filter(Boolean);
}

function actionKey(action = {}) {
  return String(action.actionKey || action.domain || action.entityId || "");
}

function compactAction(action = {}) {
  if (!action) return null;
  return {
    actionKey: actionKey(action),
    domain: action.domain || "",
    label: action.label || "",
    actionBand: action.actionBand || "",
    tone: action.tone || "",
    priorityScore: round(action.priorityScore || 0),
    priorityScoreComparable: action.priorityScoreComparable === undefined ? undefined : round(action.priorityScoreComparable || 0),
    eligible: action.eligible ?? null,
    blockReasons: action.blockReasons || []
  };
}

function topKeys(snapshot = {}, k = 3) {
  return (snapshot.actions || []).slice(0, k).map(actionKey).filter(Boolean);
}

function mapByAction(snapshot = {}) {
  return new Map((snapshot.actions || []).map((action) => [actionKey(action), action]));
}

function driftVector(diff = {}) {
  const primary = round(1 - Number(diff.primaryActionMatch || 0));
  const band = round(1 - Number(diff.actionBandMatch || 0));
  const tone = round(1 - Number(diff.toneMatch || 0));
  const topk = round(1 - Number(diff.top3Overlap || 0));
  const priority = round(1 - Number(diff.priorityDistance || 0));
  const values = {
    primary,
    band,
    tone,
    topk,
    priority
  };
  const dominant = Object.entries(values).sort((a, b) => b[1] - a[1])[0] || ["none", 0];
  return {
    deltaPrimary: primary,
    deltaBand: band,
    deltaTone: tone,
    deltaTopk: topk,
    deltaPriority: priority,
    dominantDrift: dominant[0],
    dominantDriftValue: dominant[1]
  };
}

function classifyCauses({ legacy = {}, core = {}, diff = {}, vector = {}, tenant = "" }) {
  const causes = [];
  const legacyPrimary = legacy.primaryAction || {};
  const corePrimary = core.primaryAction || {};
  const legacyByKey = mapByAction(legacy);
  const coreByKey = mapByAction(core);
  const common = [...legacyByKey.keys()].filter((key) => coreByKey.has(key));

  if (!diff.primaryActionMatch) {
    causes.push({
      code: CAUSE.PRIMARY_ACTION_MISMATCH,
      contribution: vector.deltaPrimary,
      actions: [actionKey(legacyPrimary), actionKey(corePrimary)].filter(Boolean),
      explanation: "Legacy e DecisionCore scelgono domini primari diversi."
    });
  }
  if (vector.deltaBand > 0) {
    causes.push({
      code: CAUSE.ACTION_BAND_MISMATCH,
      contribution: vector.deltaBand,
      actions: [actionKey(legacyPrimary), actionKey(corePrimary)].filter(Boolean),
      explanation: "La band primaria non ha la stessa severità decisionale."
    });
  }
  if (vector.deltaTone > 0) {
    causes.push({
      code: CAUSE.TONE_POLICY_MISMATCH,
      contribution: vector.deltaTone,
      actions: [actionKey(legacyPrimary), actionKey(corePrimary)].filter(Boolean),
      explanation: "La policy del tono non coincide tra legacy e core."
    });
  }
  if (vector.deltaTopk > 0) {
    causes.push({
      code: CAUSE.SECONDARY_RANKING_MISMATCH,
      contribution: vector.deltaTopk,
      actions: [...new Set([...topKeys(legacy), ...topKeys(core)])],
      explanation: "Le prime tre azioni coincidono solo parzialmente."
    });
  }
  if (vector.deltaPriority > 0.2) {
    const actionDeltas = common.map((key) => ({
      actionKey: key,
      legacyPriority: round(legacyByKey.get(key)?.priorityScore || 0),
      corePriority: round(coreByKey.get(key)?.priorityScore || 0),
      delta: round(Math.abs(Number(legacyByKey.get(key)?.priorityScore || 0) - Number(coreByKey.get(key)?.priorityScore || 0)))
    })).sort((a, b) => b.delta - a.delta).slice(0, 5);
    causes.push({
      code: CAUSE.PRIORITY_SCALE_MISMATCH,
      contribution: vector.deltaPriority,
      actions: actionDeltas.map((item) => item.actionKey),
      actionDeltas,
      explanation: "La scala del priority score non è ancora omogenea tra legacy e core."
    });
  }
  if ((legacy.actions || []).some((item) => item.eligible !== coreByKey.get(actionKey(item))?.eligible && coreByKey.has(actionKey(item)))) {
    causes.push({
      code: CAUSE.ELIGIBILITY_POLICY_MISMATCH,
      contribution: 0.15,
      actions: common.filter((key) => legacyByKey.get(key)?.eligible !== coreByKey.get(key)?.eligible),
      explanation: "Eligible/blocked non coincide su alcune azioni confrontabili."
    });
  }

  const legacyPriorities = (legacy.actions || []).map((item) => Number(item.priorityScore || 0));
  const corePriorities = (core.actions || []).map((item) => Number(item.priorityScore || 0));
  const legacySpread = legacyPriorities.length ? Math.max(...legacyPriorities) - Math.min(...legacyPriorities) : 0;
  const coreSpread = corePriorities.length ? Math.max(...corePriorities) - Math.min(...corePriorities) : 0;
  if (legacySpread < coreSpread * 0.65 && vector.deltaPriority > 0.15) {
    causes.push({
      code: CAUSE.LEGACY_SCORE_COMPRESSION,
      contribution: round(vector.deltaPriority * 0.5),
      actions: common,
      explanation: "Il legacy comprime maggiormente i punteggi rispetto al core."
    });
  }
  if (coreSpread > legacySpread * 1.35 && vector.deltaPriority > 0.15) {
    causes.push({
      code: CAUSE.CORE_SCORE_EXPANSION,
      contribution: round(vector.deltaPriority * 0.5),
      actions: common,
      explanation: "DecisionCore espande di più le distanze tra azioni."
    });
  }
  if (diff.primaryActionMatch === 0 && topKeys(legacy).includes(actionKey(corePrimary)) && topKeys(core).includes(actionKey(legacyPrimary))) {
    causes.push({
      code: CAUSE.DOMAIN_WEIGHT_MISMATCH,
      contribution: 0.25,
      actions: [actionKey(legacyPrimary), actionKey(corePrimary)],
      explanation: "I domini sono entrambi in top3, ma pesati in ordine diverso."
    });
  }
  if (/100|fragile|incomplet/i.test(tenant) && (diff.primaryActionMatch === 0 || vector.deltaPriority > 0.3)) {
    causes.push({
      code: CAUSE.FRAGILE_TENANT_GATING_MISMATCH,
      contribution: Math.max(vector.deltaPrimary, vector.deltaPriority),
      actions: [actionKey(legacyPrimary), actionKey(corePrimary)].filter(Boolean),
      explanation: "Sul tenant fragile il gating prudenziale del core pesa diversamente da legacy."
    });
  }

  return causes.sort((a, b) => Number(b.contribution || 0) - Number(a.contribution || 0));
}

function promotePrimaryOnly({ diff = {}, vector = {} }) {
  if (diff.primaryActionMatch === 1 && Number(diff.actionBandMatch || 0) >= 1 && vector.dominantDrift !== "primary") return "YES";
  if (diff.primaryActionMatch === 1 && Number(diff.actionBandMatch || 0) >= 0.75) return "WATCH";
  return "NO";
}

function recommendation(audits = []) {
  const strong = audits.filter((item) => /privilege|073/i.test(item.tenant));
  const primaryStable = strong.every((item) => item.after?.diff?.primaryActionMatch === 1 && Number(item.after?.diff?.actionBandMatch || 0) >= 1);
  const comparableAligned = strong.every((item) => Number(item.after?.agreementScore || 0) >= 0.9);
  const anyFragileDrift = audits.some((item) => /100|fragile/i.test(item.tenant) && item.after?.agreementBand === "DRIFT");
  if (primaryStable && comparableAligned && anyFragileDrift) {
    return {
      selected: "SELECTOR_A_DUE_LIVELLI",
      reason: "Adapter allinea i tenant forti, ma il tenant fragile deve restare protetto da fallback/selector."
    };
  }
  if (primaryStable && comparableAligned && !anyFragileDrift) {
    return {
      selected: "FASE_3_DIRETTA",
      reason: "Primary, band e confronto comparabile sono stabili anche dopo normalizzazione."
    };
  }
  return {
    selected: "DECISION_POLICY_ADAPTER",
    reason: "Il confronto comparabile non è ancora abbastanza stabile per uno switch."
  };
}

async function auditTenant(baseUrl, adminToken, tenant) {
  const support = await request(baseUrl, `/api/auth/users/${tenant.id}/support-session`, { method: "POST", token: adminToken, body: {} });
  const state = await request(baseUrl, "/api/ai-gold/state", { token: support.token });
  const parallel = state.decisionParallel || {};
  const legacy = parallel.legacySnapshot || {};
  const core = parallel.coreSnapshot || {};
  const comparable = parallel.comparableSnapshot || {};
  const rawDiff = parallel.rawDiffSnapshot || parallel.diffSnapshot || {};
  const diff = parallel.diffSnapshot || {};
  const selection = state.decisionSelection || {};
  const vectorRaw = driftVector(rawDiff);
  const vectorCmp = driftVector(diff);
  const causesRaw = classifyCauses({ legacy, core, diff: rawDiff, vector: vectorRaw, tenant: label(tenant) });
  const causesCmp = classifyCauses({ legacy, core: comparable, diff, vector: vectorCmp, tenant: label(tenant) });
  return {
    tenant: label(tenant),
    username: tenant.username || "",
    centerId: tenant.centerId || "",
    status: parallel.status || "missing",
    policyAdapter: parallel.policyAdapter?.mathAdapter || "",
    before: {
      agreementScore: parallel.rawAgreementScore ?? rawDiff.agreementScore ?? null,
      agreementBand: parallel.rawAgreementBand || rawDiff.agreementBand || "N/A",
      diff: rawDiff,
      driftVector: vectorRaw,
      dominantDrift: vectorRaw.dominantDrift,
      causes: causesRaw
    },
    after: {
      agreementScore: parallel.agreementScore ?? diff.agreementScore ?? null,
      agreementBand: parallel.agreementBand || diff.agreementBand || "N/A",
      diff,
      driftVector: vectorCmp,
      dominantDrift: vectorCmp.dominantDrift,
      causes: causesCmp
    },
    agreementScore: parallel.agreementScore ?? null,
    agreementBand: parallel.agreementBand || "N/A",
    legacyDecision: {
      primary: compactAction(legacy.primaryAction),
      top3: (legacy.actions || []).slice(0, 3).map(compactAction)
    },
    coreDecision: {
      primary: compactAction(core.primaryAction),
      top3: (core.actions || []).slice(0, 3).map(compactAction)
    },
    comparableDecision: {
      primary: compactAction(comparable.primaryAction),
      top3: (comparable.actions || []).slice(0, 3).map(compactAction)
    },
    metrics: {
      raw: {
        PA: rawDiff.primaryActionMatch ?? null,
        AB: rawDiff.actionBandMatch ?? null,
        TM: rawDiff.toneMatch ?? null,
        TK_3: rawDiff.top3Overlap ?? null,
        PD: rawDiff.priorityDistance ?? null,
        A_dec: parallel.rawAgreementScore ?? rawDiff.agreementScore ?? null
      },
      comparable: {
        PA: diff.primaryActionMatch ?? null,
        AB: diff.actionBandMatch ?? null,
        TM: diff.toneMatch ?? null,
        TK_3: diff.top3Overlap ?? null,
        PD: diff.priorityDistance ?? null,
        A_dec: parallel.agreementScore ?? diff.agreementScore ?? null
      }
    },
    improvement: round((Number(parallel.agreementScore ?? diff.agreementScore ?? 0) - Number(parallel.rawAgreementScore ?? rawDiff.agreementScore ?? 0))),
    decisionSelection: {
      primarySource: selection.primarySource || "",
      secondarySource: selection.secondarySource || "",
      primaryReliability: selection.primaryReliability ?? null,
      secondaryReliability: selection.secondaryReliability ?? null,
      switchReasonPrimary: selection.switchReasonPrimary || "",
      switchReasonSecondary: selection.switchReasonSecondary || "",
      fallbackReasonPrimary: selection.fallbackReasonPrimary || "",
      fallbackReasonSecondary: selection.fallbackReasonSecondary || "",
      diagnostics: selection.diagnostics || null
    },
    driftVector: vectorCmp,
    dominantDrift: vectorCmp.dominantDrift,
    causes: causesCmp,
    promotePrimaryOnly: promotePrimaryOnly({ diff, vector: vectorCmp }),
    finalDecision: Number(parallel.agreementScore ?? diff.agreementScore ?? 0) >= 0.9 && diff.primaryActionMatch === 1
      ? "pronto per Fase 3 controllata"
      : Number(parallel.agreementScore ?? diff.agreementScore ?? 0) >= 0.75
        ? "quasi pronto"
        : "non pronto",
    decisionSource: state.decision?.source || "",
    decisionParallelPresent: Boolean(state.decisionParallel)
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
  const audits = [];
  for (const tenant of tenants) audits.push(await auditTenant(baseUrl, login.token, tenant));
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl,
    health,
    tenantsAnalyzed: audits.map((item) => item.tenant),
    audits,
    globalCauses: audits.flatMap((item) => item.causes.map((cause) => ({
      tenant: item.tenant,
      code: cause.code,
      contribution: cause.contribution,
      actions: cause.actions
    }))),
    recommendedStrategy: recommendation(audits),
    confirmations: {
      readOnly: true,
      decisionCorePrimary: false,
      uiChanged: false,
      publicApiChanged: false,
      realDataModified: false,
      actionExecutedOrPersisted: false
    }
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
