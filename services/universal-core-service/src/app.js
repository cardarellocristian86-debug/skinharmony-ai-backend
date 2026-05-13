import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { runUniversalCore } from "../../../universal-core/packages/core/src/index.ts";
import { mapFlowCoreToUniversal } from "../../../universal-core/packages/branches/flowcore/src/index.ts";
import { runTextBranch } from "../../../universal-core/packages/branches/ramo-testo/src/index.ts";
import { createAudit, ensureDir } from "./audit.js";
import { createKeyStore } from "./keyStore.js";
import { hasScope, requireTenantAccess, KEY_PRESETS, SCOPES } from "./scope.js";
import {
  BRANCH_PACKAGES,
  composeBranchContext,
  deterministicBranchRegistry,
  resolveBranchesForKey,
} from "../branches/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORAGE_ROOT = path.resolve(__dirname, "../storage");
const SERVICE_VERSION = "0.3.1-ramo-testo";

function nowIso() {
  return new Date().toISOString();
}

function readSecret(req) {
  const auth = req.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.get("x-sh-core-key") || req.get("x-api-key") || "";
}

function publicError(res, status, code, message = code) {
  return res.status(status).json({ ok: false, error: code, message });
}

function safeTenantId(req, keyRecord) {
  const tenantFromBody = req.body?.tenant_id || req.body?.context?.tenant_id || req.body?.core_input?.context?.tenant_id;
  const tenantFromQuery = req.query?.tenant_id;
  const tenantFromHeader = req.get("x-sh-tenant-id");
  return String(tenantFromBody || tenantFromQuery || tenantFromHeader || keyRecord?.tenant_id || "").trim();
}

function normalizeSignal(input = {}) {
  const score = Number(input.normalized_score ?? input.score ?? input.value ?? 50);
  return {
    id: String(input.id || input.key || `signal_${crypto.randomUUID()}`),
    source: String(input.source || "universal_core_service"),
    category: String(input.category || "custom"),
    label: String(input.label || input.id || "Segnale operativo"),
    value: Number(input.value ?? score),
    normalized_score: Math.max(0, Math.min(100, score)),
    severity_hint: input.severity_hint === undefined ? Math.max(0, Math.min(100, score)) : Number(input.severity_hint),
    confidence_hint: input.confidence_hint === undefined ? 70 : Number(input.confidence_hint),
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
  };
}

function buildCoreInput(req, keyRecord) {
  if (req.body?.core_input) {
    const input = req.body.core_input;
    return {
      ...input,
      context: {
        ...(input.context || {}),
        tenant_id: safeTenantId(req, keyRecord),
      },
      constraints: safeConstraints(input.constraints, keyRecord, req.body?.owner_confirmed === true),
    };
  }

  const signals = Array.isArray(req.body?.signals) ? req.body.signals.map(normalizeSignal) : [];
  return {
    request_id: req.body?.request_id || `req_${crypto.randomUUID()}`,
    generated_at: nowIso(),
    domain: req.body?.domain || "custom",
    context: {
      tenant_id: safeTenantId(req, keyRecord),
      actor_id: req.body?.actor_id || undefined,
      plan: req.body?.plan || undefined,
      locale: req.body?.locale || "it",
      metadata: typeof req.body?.metadata === "object" && req.body.metadata ? req.body.metadata : {},
    },
    signals,
    data_quality: {
      score: Number(req.body?.data_quality?.score ?? req.body?.data_quality_score ?? 70),
      completeness: req.body?.data_quality?.completeness,
      freshness: req.body?.data_quality?.freshness,
      consistency: req.body?.data_quality?.consistency,
      reliability: req.body?.data_quality?.reliability,
      missing_fields: Array.isArray(req.body?.data_quality?.missing_fields) ? req.body.data_quality.missing_fields : [],
    },
    constraints: safeConstraints(req.body?.constraints, keyRecord, req.body?.owner_confirmed === true),
  };
}

function safeConstraints(raw = {}, keyRecord, ownerConfirmed) {
  const automationAllowed = Boolean(
    raw.allow_automation === true &&
      ownerConfirmed &&
      hasScope(keyRecord, SCOPES.AUTOMATION_CODEX)
  );

  return {
    allow_automation: automationAllowed,
    require_confirmation: raw.require_confirmation !== false,
    max_control_level: automationAllowed ? raw.max_control_level || "confirm" : "confirm",
    min_control_level: raw.min_control_level,
    state_floor: raw.state_floor,
    risk_floor: raw.risk_floor,
    blocked_actions: Array.isArray(raw.blocked_actions) ? raw.blocked_actions : [],
    blocked_action_rules: Array.isArray(raw.blocked_action_rules) ? raw.blocked_action_rules : [],
    allowed_actions: Array.isArray(raw.allowed_actions) ? raw.allowed_actions : [],
    permissions: Array.isArray(raw.permissions) ? raw.permissions : keyRecord?.allowed_scopes || [],
    safety_mode: raw.safety_mode !== false,
  };
}

function requireAdmin(req, res, next) {
  const configured = process.env.CORE_SERVICE_ADMIN_KEY;
  const devKey = process.env.NODE_ENV === "production" ? "" : "dev-core-admin-key";
  const adminKey = configured || devKey;
  if (!adminKey) return publicError(res, 503, "admin_key_not_configured");
  if (readSecret(req) !== adminKey) return publicError(res, 401, "admin_key_invalid");
  return next();
}

function createAuth(keyStore, audit, requiredScope) {
  return (req, res, next) => {
    const auth = keyStore.authenticate(readSecret(req));
    if (!auth.ok) {
      audit.append("core_auth_failed", { error: auth.error, path: req.path });
      return publicError(res, 401, auth.error);
    }

    const tenantId = safeTenantId(req, auth.record);
    if (!requireTenantAccess(auth.record, tenantId)) {
      audit.append("core_tenant_scope_denied", { key_id: auth.record.key_id, requested_tenant: tenantId, path: req.path });
      return publicError(res, 403, "tenant_scope_denied");
    }

    if (requiredScope && !hasScope(auth.record, requiredScope)) {
      audit.append("core_scope_denied", { key_id: auth.record.key_id, required_scope: requiredScope, path: req.path });
      return publicError(res, 403, "scope_denied", `Required scope: ${requiredScope}`);
    }

    req.coreKey = auth.record;
    req.tenantId = tenantId || auth.record.tenant_id;
    return next();
  };
}

function snapshotStore(storageRoot) {
  const dir = path.join(storageRoot, "snapshots");
  ensureDir(dir);
  const fileForTenant = (tenantId) => path.join(dir, `${tenantId}.json`);

  return {
    append(tenantId, source, payload) {
      const file = fileForTenant(tenantId);
      const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
      const record = { snapshot_id: `snap_${crypto.randomUUID()}`, tenant_id: tenantId, source, created_at: nowIso(), payload };
      current.push(record);
      fs.writeFileSync(file, JSON.stringify(current.slice(-200), null, 2), "utf8");
      return record;
    },
    latest(tenantId) {
      const file = fileForTenant(tenantId);
      if (!fs.existsSync(file)) return null;
      const current = JSON.parse(fs.readFileSync(file, "utf8"));
      return current[current.length - 1] || null;
    },
  };
}

function reviewStore(storageRoot) {
  const file = path.join(storageRoot, "reviews", "queue.json");
  ensureDir(path.dirname(file));
  const read = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : []);
  const write = (rows) => fs.writeFileSync(file, JSON.stringify(rows, null, 2), "utf8");
  return {
    pending(tenantId) {
      return read().filter((row) => row.tenant_id === tenantId && row.status === "pending");
    },
    action(tenantId, action) {
      const rows = read();
      const record = rows.find((row) => row.tenant_id === tenantId && row.review_id === action.review_id);
      if (!record) return null;
      record.status = action.status === "approved" ? "approved" : action.status === "rejected" ? "rejected" : "pending";
      record.owner_note = action.owner_note || "";
      record.updated_at = nowIso();
      write(rows);
      return record;
    },
    enqueue(tenantId, payload) {
      const rows = read();
      const record = { review_id: `review_${crypto.randomUUID()}`, tenant_id: tenantId, status: "pending", created_at: nowIso(), payload };
      rows.push(record);
      write(rows);
      return record;
    },
  };
}

function defaultClaimTerms() {
  return [
    "cura",
    "guarisce",
    "guarigione",
    "terapeutico",
    "terapia",
    "medicale",
    "elimina definitivamente",
    "risultato garantito",
  ];
}

function claimGuardCheck(payload = {}) {
  const text = String(payload.text || payload.content || "");
  const terms = Array.isArray(payload.forbidden_terms) && payload.forbidden_terms.length ? payload.forbidden_terms : defaultClaimTerms();
  const issues = terms
    .map(String)
    .filter((term) => term && text.toLowerCase().includes(term.toLowerCase()))
    .map((term) => ({
      term,
      severity: ["medicale", "terapia", "terapeutico", "guarisce", "guarigione"].includes(term.toLowerCase()) ? "critical" : "warning",
      message: `Claim da verificare: ${term}`,
      suggested_action: "Rivedere il testo con formula prudente e approvazione owner.",
    }));

  const critical = issues.some((issue) => issue.severity === "critical");
  return {
    status: issues.length ? (critical ? "critical" : "warning") : "ok",
    issue_count: issues.length,
    issues,
    hard_block: false,
    recommended_action: issues.length ? "revision_required_before_publication" : "no_action_required",
  };
}

function pricingGuardCheck(payload = {}) {
  const official = Array.isArray(payload.official_prices) ? payload.official_prices : [];
  const observed = Array.isArray(payload.observed_prices) ? payload.observed_prices : [];
  if (!official.length || !observed.length) {
    return {
      status: "unknown",
      issue_count: 0,
      issues: [],
      hard_block: false,
      recommended_action: "Caricare listino ufficiale e prezzi osservati. Il Core non inventa prezzi.",
    };
  }

  const officialMap = new Map(official.map((row) => [String(row.sku || row.name || row.id), Number(row.price)]));
  const issues = observed.flatMap((row) => {
    const key = String(row.sku || row.name || row.id);
    const expected = officialMap.get(key);
    if (!Number.isFinite(expected)) return [{ key, severity: "warning", message: "Voce prezzo non presente nel listino ufficiale.", observed_price: row.price }];
    const observedPrice = Number(row.price);
    if (!Number.isFinite(observedPrice)) return [{ key, severity: "warning", message: "Prezzo osservato non valido.", expected_price: expected }];
    const delta = observedPrice - expected;
    if (Math.abs(delta) < 0.01) return [];
    return [{ key, severity: "warning", message: "Prezzo non allineato al listino ufficiale.", expected_price: expected, observed_price: observedPrice, delta }];
  });

  return {
    status: issues.length ? "warning" : "ok",
    issue_count: issues.length,
    issues,
    hard_block: false,
    recommended_action: issues.length ? "review_price_alignment" : "no_action_required",
  };
}

function buildFlowCoreBranchInput(payload = {}) {
  const metrics = payload.metrics || payload.snapshot || payload;
  return {
    request_id: String(payload.request_id || `flow_${crypto.randomUUID()}`),
    pressure_score: Number(metrics.pressure_score ?? metrics.pressure ?? metrics.cpu_pressure ?? 0),
    continuity_risk_score: Number(metrics.continuity_risk_score ?? metrics.continuity_risk ?? 0),
    memory_stress_score: Number(metrics.memory_stress_score ?? metrics.memory_pressure ?? metrics.memory_stress ?? 0),
    process_opportunity_score: Number(metrics.process_opportunity_score ?? metrics.process_opportunity ?? 0),
    persistent_signal: Boolean(metrics.persistent_signal),
    process_legitimacy_score:
      metrics.process_legitimacy_score === undefined ? undefined : Number(metrics.process_legitimacy_score),
    data_quality_score: Number(metrics.data_quality_score ?? metrics.data_quality?.score ?? 70),
    temporal_stability_score: Number(metrics.temporal_stability_score ?? metrics.stability_score ?? 70),
  };
}

function clampScore(value, fallback = 50) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, number));
}

function textValue(value, fallback = "") {
  return String(value === undefined || value === null ? fallback : value).trim();
}

function arrayValue(value, max = 20) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((item) => textValue(item)).filter(Boolean);
}

function branchRegistry() {
  return {
    ...deterministicBranchRegistry(),
    beauty_market: {
      label: "Beauty Market Intelligence",
      domain: "market",
      tier: "network",
      production_status: "advisory",
      description: "Legge segnali mercato beauty/wellness e produce postura commerciale, senza trading e senza dati finanziari sensibili.",
    },
    marketing_copy: {
      label: "Nyra Marketing Copy",
      domain: "marketing",
      tier: "network",
      production_status: "advisory",
      description: "Prepara brief copywriting e testi da revisionare con Claim Guard, non pubblica automaticamente.",
    },
    cosmetic_chemistry: {
      label: "Cosmetic Chemistry Positioning",
      domain: "product",
      tier: "network",
      production_status: "advisory",
      description: "Aiuta a posizionare attivi cosmetici in modo prudente, senza claim medici o terapeutici.",
    },
    technology_market: {
      label: "Technology Trend Intelligence",
      domain: "technology",
      tier: "network",
      production_status: "advisory",
      description: "Valuta domanda, maturita e messaggio commerciale per tecnologie beauty/wellness.",
    },
    business_strategy: {
      label: "Business Strategy",
      domain: "strategy",
      tier: "network",
      production_status: "advisory",
      description: "Ordina priorita commerciali, canale, CRM e prossime azioni per owner/manager.",
    },
    translation_governance: {
      label: "Translation Governance",
      domain: "translation",
      tier: "network",
      production_status: "advisory",
      description: "Valuta payload traducibili, readiness e rischio di traduzione. Non traduce HTML finale.",
    },
    ramo_testo: {
      label: "Ramo Testo / Content Guard",
      domain: "content_guard",
      tier: "network",
      production_status: "advisory",
      description: "Valuta qualita testo, traduzioni, claim risk, brand tone e publish safety. Non pubblica automaticamente.",
    },
    nyra_finance_beauty_test: {
      label: "Nyra Finance Beauty Test",
      domain: "market_test",
      tier: "internal",
      production_status: "test_only",
      description: "Area separata per correlare segnali finanziari/mercato beauty. Non entra nel prodotto operativo.",
    },
  };
}

function normalizeTextGuardSeverity(value) {
  const severity = String(value || "").toLowerCase();
  return ["low", "medium", "high", "blocker"].includes(severity) ? severity : "medium";
}

function normalizeTextGuardType(value) {
  const type = String(value || "").toLowerCase();
  const allowed = [
    "spelling",
    "accent",
    "grammar",
    "punctuation",
    "style",
    "readability",
    "glossary",
    "translation_mismatch",
    "claim_risk",
    "brand_tone",
    "publish_safety",
  ];
  return allowed.includes(type) ? type : "style";
}

function normalizeTextGuardIssues(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((issue, index) => {
    const original = textValue(issue?.original || issue?.term || issue?.text || "");
    return {
      id: textValue(issue?.id, `issue_${index + 1}`),
      type: normalizeTextGuardType(issue?.type),
      severity: normalizeTextGuardSeverity(issue?.severity),
      start: Number.isFinite(Number(issue?.start)) ? Number(issue.start) : 0,
      end: Number.isFinite(Number(issue?.end)) ? Number(issue.end) : original.length,
      original,
      suggestions: Array.isArray(issue?.suggestions) ? issue.suggestions.slice(0, 5).map((item) => textValue(item)).filter(Boolean) : [],
      message: textValue(issue?.message, "Elemento da revisionare"),
      reason: textValue(issue?.reason, "Controllo Content Guard"),
      safe_to_auto_apply: Boolean(issue?.safe_to_auto_apply) && normalizeTextGuardType(issue?.type) !== "claim_risk" && normalizeTextGuardType(issue?.type) !== "publish_safety",
    };
  });
}

function buildTextGuardIssuesFromClaimShield(text, data = {}) {
  const claimResult = claimShieldCheck({ text, context: data.context || {} });
  if (!claimResult.issues?.length) return [];
  return claimResult.issues.map((issue, index) => ({
    id: `claim_${index + 1}`,
    type: issue.severity === "critical" ? "publish_safety" : "claim_risk",
    severity: issue.severity === "critical" ? "blocker" : issue.severity === "high" ? "high" : "medium",
    start: Math.max(0, text.toLowerCase().indexOf(String(issue.term || "").toLowerCase())),
    end: Math.max(0, text.toLowerCase().indexOf(String(issue.term || "").toLowerCase())) + String(issue.term || "").length,
    original: String(issue.term || ""),
    suggestions: ["Riformulare con linguaggio prudente e approvazione owner."],
    message: issue.message || "Claim da revisionare",
    reason: "Claim Shield ha rilevato un rischio prima della pubblicazione.",
    safe_to_auto_apply: false,
  }));
}

function buildTextBranchInput(req, payload = {}) {
  const data = typeof payload.data === "object" && payload.data ? payload.data : payload;
  const text = textValue(data.text || data.content || data.copy || data.draft);
  const providedIssues = normalizeTextGuardIssues(data.issues);
  const issues = providedIssues.length ? providedIssues : buildTextGuardIssuesFromClaimShield(text, data);
  return {
    request_id: textValue(data.request_id || payload.request_id, `text_guard_${crypto.randomUUID()}`),
    generated_at: textValue(data.generated_at || payload.generated_at, nowIso()),
    locale: textValue(data.locale || payload.locale, "it"),
    tenant_id: req.tenantId,
    actor_id: textValue(data.actor_id || payload.actor_id),
    context: textValue(data.context || payload.context, "manual_review"),
    domain: textValue(data.domain || payload.domain, "manual"),
    object_id: data.object_id ?? payload.object_id,
    key_path: textValue(data.key_path || payload.key_path),
    text,
    source_text: textValue(data.source_text || payload.source_text),
    issues,
  };
}

function buildBranchPayload(branch, payload = {}) {
  const registry = branchRegistry();
  const profile = registry[branch];
  if (!profile) return null;

  const data = typeof payload.data === "object" && payload.data ? payload.data : payload;
  const missing = [];
  const warnings = [];
  const signals = [];
  let branchOutput = {};

  const addSignal = (id, label, score, category = profile.domain, tags = []) => {
    signals.push(normalizeSignal({
      id: `${branch}:${id}`,
      label,
      category,
      normalized_score: clampScore(score),
      confidence_hint: clampScore(data.confidence ?? data.data_quality_score ?? 72, 72),
      tags: [branch, ...tags],
    }));
  };

  if (branch === "beauty_market") {
    const trend = clampScore(data.trend_strength ?? data.market_trend_score ?? 50);
    const pressure = clampScore(data.pricing_pressure ?? data.price_pressure_score ?? 40);
    const channel = clampScore(data.channel_opportunity ?? data.channel_score ?? 55);
    addSignal("trend_strength", "Forza trend beauty/wellness", trend, "market", ["trend"]);
    addSignal("pricing_pressure", "Pressione prezzo nel canale", pressure, "pricing", ["price"]);
    addSignal("channel_opportunity", "Opportunita canale commerciale", channel, "market", ["channel"]);
    branchOutput = {
      market_posture: pressure >= 70 ? "defensive_margin_guard" : trend >= 65 ? "selective_growth" : "monitor",
      recommended_use: "Usare per orientare campagne, pricing advisory e priorita CRM; non come motore trading.",
      research_required: data.sources_provided ? false : true,
    };
  } else if (branch === "marketing_copy") {
    const offer = textValue(data.offer || data.product || data.service);
    const target = textValue(data.target || data.audience || data.customer_type);
    if (!offer) missing.push("offer");
    if (!target) missing.push("target");
    const claimResult = claimShieldCheck({ text: textValue(data.draft || data.claims || data.copy || ""), context: data.context || {} });
    addSignal("claim_risk", "Rischio claim nel copy marketing", claimResult.risk_score, "claim", ["claim_guard"]);
    addSignal("brief_completeness", "Completezza brief marketing", 100 - missing.length * 25, "marketing", ["brief"]);
    branchOutput = {
      copy_mode: "brief_first_owner_review",
      offer,
      target,
      safe_angle: "benefici estetici, esperienza, metodo, controllo e servizio; evitare promesse mediche o risultati garantiti.",
      blocked_claims: claimResult.issues.map((issue) => issue.term),
      owner_review_required: true,
    };
  } else if (branch === "cosmetic_chemistry") {
    const active = textValue(data.active || data.ingredient || data.hero_ingredient);
    const functionText = textValue(data.function || data.cosmetic_function);
    if (!active) missing.push("active");
    if (!functionText) missing.push("cosmetic_function");
    const evidenceScore = clampScore(data.evidence_score ?? (data.sources_provided ? 75 : 35));
    const claimResult = claimShieldCheck({ text: `${active} ${functionText} ${textValue(data.claims)}`, context: data.context || {} });
    addSignal("evidence_quality", "Qualita supporto attivo cosmetico", evidenceScore, "product", ["cosmetic"]);
    addSignal("claim_risk", "Rischio claim su attivo cosmetico", claimResult.risk_score, "claim", ["claim_guard"]);
    branchOutput = {
      active,
      cosmetic_function: functionText,
      positioning_rule: "Posizionare come supporto cosmetico/beauty, non come cura, terapia o effetto medico.",
      web_research_required: !data.sources_provided,
      owner_review_required: true,
    };
  } else if (branch === "technology_market") {
    const technology = textValue(data.technology || data.device || data.protocol);
    if (!technology) missing.push("technology");
    const demand = clampScore(data.demand_score ?? data.trend_strength ?? 50);
    const maturity = clampScore(data.maturity_score ?? data.protocol_readiness ?? 50);
    const compliance = clampScore(data.compliance_readiness ?? 60);
    addSignal("demand", "Domanda tecnologia", demand, "market", ["technology"]);
    addSignal("maturity", "Maturita protocollo/uso", maturity, "technology", ["readiness"]);
    addSignal("compliance", "Prudenza claim tecnologia", 100 - compliance, "claim", ["claim_guard"]);
    branchOutput = {
      technology,
      suggested_positioning: demand >= 65 && maturity >= 60 ? "priority_offer" : "education_first",
      publish_rule: "Prima education e proof controllata, poi CTA. Nessun claim terapeutico.",
    };
  } else if (branch === "business_strategy") {
    const revenue = clampScore(data.revenue_health ?? data.mrr_health ?? 50);
    const churn = clampScore(data.churn_risk ?? data.inactivity_risk ?? 45);
    const pipeline = clampScore(data.pipeline_quality ?? data.forecast_quality ?? 50);
    const ops = clampScore(data.operational_readiness ?? data.readiness ?? 55);
    addSignal("revenue_health", "Salute revenue/MRR", 100 - revenue, "finance", ["revenue"]);
    addSignal("churn_risk", "Rischio churn/inattivita", churn, "crm", ["churn"]);
    addSignal("pipeline_quality", "Qualita pipeline commerciale", 100 - pipeline, "crm", ["pipeline"]);
    addSignal("operational_readiness", "Readiness operativa", 100 - ops, "operations", ["readiness"]);
    branchOutput = {
      next_best_focus: churn >= 65 ? "retention_first" : pipeline < 55 ? "pipeline_cleanup" : "controlled_growth",
      manager_view: "Mostrare prima rischi e prossime azioni, poi numeri.",
    };
  } else if (branch === "translation_governance") {
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) missing.push("items");
    const unstableKeys = items.filter((item) => !textValue(item.key_path) || !textValue(item.source_text)).length;
    const readiness = Math.max(0, 100 - missing.length * 35 - unstableKeys * 12);
    addSignal("payload_readiness", "Readiness payload traduzioni strutturate", readiness, "translation", ["core_translation"]);
    addSignal("unstable_keys", "Key path instabili o stringhe mancanti", Math.min(100, unstableKeys * 18), "translation", ["key_path"]);
    branchOutput = {
      translation_mode: "structured_strings_only",
      source_lang: textValue(data.source_lang, "it"),
      target_lang: textValue(data.target_lang, "en"),
      item_count: items.length,
      unstable_item_count: unstableKeys,
      fallback_policy: "fallback_to_it",
    };
  } else if (branch === "ramo_testo") {
    const text = textValue(data.text || data.content || data.copy || data.draft);
    const providedIssues = normalizeTextGuardIssues(data.issues);
    const issues = providedIssues.length ? providedIssues : buildTextGuardIssuesFromClaimShield(text, data);
    if (!text) missing.push("text");
    const highIssues = issues.filter((issue) => issue.severity === "high" || issue.severity === "blocker").length;
    const claimIssues = issues.filter((issue) => issue.type === "claim_risk" || issue.type === "publish_safety").length;
    addSignal("issue_severity", "Gravita problemi testo/content guard", Math.min(100, highIssues * 32 + claimIssues * 24), "content_guard", ["text"]);
    addSignal("publish_safety", "Sicurezza pubblicazione testo", claimIssues ? 88 : 20, "content_guard", ["publish_safety"]);
    branchOutput = {
      text_context: textValue(data.context, "manual_review"),
      issue_count: issues.length,
      claim_issue_count: claimIssues,
      publish_safe_advisory: issues.every((issue) => issue.type !== "claim_risk" && issue.type !== "publish_safety" && issue.severity !== "blocker"),
      rule: "Ramo Testo produce review e suggested action; non salva, non pubblica e non corregge automaticamente.",
    };
  } else if (branch === "nyra_finance_beauty_test") {
    const beta = clampScore(data.beauty_market_correlation ?? data.correlation_score ?? 40);
    const volatility = clampScore(data.volatility ?? data.market_volatility ?? 50);
    const commercial = clampScore(data.commercial_relevance ?? 45);
    addSignal("beauty_market_correlation", "Correlazione mercato beauty test", beta, "market_test", ["nyra_finance"]);
    addSignal("volatility", "Volatilita segnale finanziario test", volatility, "market_test", ["finance_test"]);
    addSignal("commercial_relevance", "Rilevanza commerciale beauty", commercial, "market_test", ["beauty"]);
    branchOutput = {
      test_area: true,
      production_connected: false,
      rule: "Nyra finanza resta area test separata; nessuna decisione prodotto o trading automatico.",
    };
  }

  if (missing.length) warnings.push(`Dati mancanti: ${missing.join(", ")}`);
  if (profile.production_status === "test_only") warnings.push("Ramo test-only: non usare per automazioni prodotto.");

  return {
    profile,
    core_input: {
      request_id: String(payload.request_id || `${branch}_${crypto.randomUUID()}`),
      generated_at: nowIso(),
      domain: profile.domain,
      context: {
        tenant_id: textValue(payload.tenant_id || data.tenant_id),
        actor_id: textValue(payload.actor_id || data.actor_id) || undefined,
        plan: textValue(payload.plan || data.plan) || undefined,
        locale: textValue(payload.locale || data.locale, "it"),
        metadata: {
          branch,
          production_status: profile.production_status,
          source: "universal_core_branch_router",
        },
      },
      signals: signals.length ? signals : [normalizeSignal({ id: `${branch}:empty`, label: "Payload ramo senza segnali sufficienti", normalized_score: 20, tags: [branch] })],
      data_quality: {
        score: clampScore(data.data_quality_score ?? (missing.length ? 55 : 78)),
        missing_fields: missing,
      },
      constraints: {
        allow_automation: false,
        require_confirmation: true,
        safety_mode: true,
        blocked_actions: ["publish_without_owner_review", "send_without_consent", "change_price_without_owner_confirmation"],
      },
    },
    branch_output: branchOutput,
    warnings,
  };
}

function severityToScore(status) {
  if (status === "critical") return 95;
  if (status === "high") return 78;
  if (status === "warning") return 55;
  if (status === "unknown") return 35;
  return 10;
}

function summarizeAuditPulse(auditEvents = []) {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const last24h = auditEvents.filter((event) => {
    const ts = new Date(event.created_at || 0).getTime();
    return Number.isFinite(ts) && ts >= since;
  });

  const byType = last24h.reduce((acc, event) => {
    acc[event.event_type] = (acc[event.event_type] || 0) + 1;
    return acc;
  }, {});

  return {
    total_events_24h: last24h.length,
    guardrail_events_24h:
      (byType.core_claim_checked || 0) +
      (byType.core_pricing_checked || 0) +
      (byType.core_policy_checked || 0),
    auth_failures_24h: byType.core_auth_failed || 0,
    scope_denied_24h: byType.core_scope_denied || 0,
    by_type: byType,
  };
}

function buildEcosystemPulse({ tenantId, keyRecord, snapshot, auditEvents }) {
  const payload = snapshot?.payload || {};
  const health = payload.health || payload.enterprise_health || {};
  const analytics = payload.analytics || payload.stats || {};
  const nyra = payload.nyra || payload.market || {};
  const auditPulse = summarizeAuditPulse(auditEvents);

  const technicalScore = Number(health.readiness_score ?? health.score ?? 80);
  const pricingPressure = String(nyra.pricing_pressure || nyra.market_posture || analytics.pricing_pressure || "unknown");
  const nodeStatus = String(health.node_status || health.status || "local_snapshot");
  const guardrailLoad = Math.min(100, auditPulse.guardrail_events_24h * 8 + auditPulse.auth_failures_24h * 15 + auditPulse.scope_denied_24h * 12);
  const riskScore = Math.max(0, Math.min(100, 100 - technicalScore + guardrailLoad));

  return {
    tenant_id: tenantId,
    brand_scope: keyRecord?.brand_scope || "",
    generated_at: nowIso(),
    source_snapshot_id: snapshot?.snapshot_id || null,
    mode: "read_only_command_center",
    nyra_weather: {
      market_posture: pricingPressure,
      advisory: "Nyra legge segnali aggregati e suggerisce priorita; non esegue azioni automatiche.",
    },
    infrastructure: {
      node_status: nodeStatus,
      service_version: SERVICE_VERSION,
      render_ready: true,
      uptime_seconds: Math.round(process.uptime()),
    },
    guardrails: {
      ...auditPulse,
      hard_block: false,
      owner_confirmation_required: true,
    },
    score: {
      technical_score: Math.max(0, Math.min(100, technicalScore)),
      risk_score: riskScore,
      risk_status: riskScore >= 80 ? "critical" : riskScore >= 55 ? "high" : riskScore >= 25 ? "warning" : "ok",
    },
    recommended_action:
      riskScore >= 55
        ? "Aprire Control Room, verificare guardrail recenti e confermare manualmente le azioni critiche."
        : "Continuare monitoraggio, mantenendo audit e conferma owner sulle azioni operative.",
  };
}

function calibrationStatus() {
  return {
    status: "advisory_ready",
    mode: "monthly_auto_tuning_candidate",
    live_mutation_enabled: false,
    hard_block: false,
    recommended_cadence: "monthly",
    last_run_at: null,
    next_step: "Raccogliere snapshot reali, confrontare varianti e salvare solo raccomandazioni approvabili dall'owner.",
    guardrails: [
      "nessuna modifica automatica ai pesi live",
      "nessuna pubblicazione automatica",
      "owner confirmation obbligatoria",
      "audit di ogni valutazione",
    ],
  };
}

function calibrationEvaluate(payload = {}) {
  const variants = Array.isArray(payload.variants) && payload.variants.length ? payload.variants : [];
  const metrics = typeof payload.metrics === "object" && payload.metrics ? payload.metrics : {};
  const baseline = Number(metrics.baseline_accuracy ?? metrics.baseline_score ?? 0);
  const scored = variants.map((variant, index) => {
    const accuracy = Number(variant.accuracy ?? variant.score ?? baseline);
    const risk = Number(variant.risk ?? variant.regression_risk ?? 20);
    const coverage = Number(variant.coverage ?? 70);
    const final_score = Math.max(0, Math.min(100, accuracy * 0.55 + coverage * 0.25 + (100 - risk) * 0.2));
    return {
      id: String(variant.id || `variant_${index + 1}`),
      label: String(variant.label || variant.id || `Variante ${index + 1}`),
      final_score,
      accuracy,
      coverage,
      risk,
      selected: false,
    };
  });
  scored.sort((a, b) => b.final_score - a.final_score);
  if (scored[0]) scored[0].selected = true;

  return {
    status: scored.length ? "candidate_selected" : "insufficient_data",
    advisory_only: true,
    live_mutation_enabled: false,
    selected_variant: scored[0] || null,
    ranking: scored,
    recommended_action: scored[0]
      ? "Salvare la variante come proposta, testarla in staging e applicarla solo dopo conferma owner."
      : "Aggiungere varianti, metriche reali e dati di regressione prima di calibrare.",
  };
}

function claimShieldSources() {
  return [
    {
      id: "eu_cosmetics_reg_1223_2009",
      label: "Regolamento cosmetici UE CE n. 1223/2009",
      scope: "cosmetic_claim_governance_reference",
      status: "reference_registry",
      legal_review_required: true,
    },
    {
      id: "internal_brand_claim_policy",
      label: "Policy claim approvati dal brand",
      scope: "brand_specific_claims",
      status: "tenant_policy_required",
      legal_review_required: true,
    },
  ];
}

function claimShieldCheck(payload = {}) {
  const lexical = claimGuardCheck(payload);
  const statusScore = severityToScore(lexical.status);
  const contextRisk = payload.context?.medical_context === true || payload.context?.before_after_promise === true ? 20 : 0;
  const riskScore = Math.max(0, Math.min(100, statusScore + contextRisk));
  return {
    ...lexical,
    shield_status: riskScore >= 80 ? "critical_review" : riskScore >= 50 ? "legal_review_recommended" : "watch",
    risk_score: riskScore,
    sources: claimShieldSources(),
    legal_guarantee: false,
    compliance_note:
      "Supporto di governance e pre-review: non sostituisce validazione legale, regolatoria o responsabilita del brand.",
    owner_confirmation_required: lexical.issue_count > 0,
  };
}

export function createUniversalCoreService(options = {}) {
  const storageRoot = options.storageRoot || process.env.CORE_SERVICE_STORAGE_ROOT || DEFAULT_STORAGE_ROOT;
  ensureDir(storageRoot);

  const audit = createAudit(storageRoot);
  const keyStore = createKeyStore(storageRoot, audit);
  const snapshots = snapshotStore(storageRoot);
  const reviews = reviewStore(storageRoot);
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

  app.get("/healthz", (req, res) => {
    res.json({
      ok: true,
      service: "skinharmony-universal-core-service",
      version: SERVICE_VERSION,
      mode: process.env.NODE_ENV || "development",
      render_ready: true,
      storage_root_configured: Boolean(process.env.CORE_SERVICE_STORAGE_ROOT),
      uptime_seconds: Math.round(process.uptime()),
    });
  });

  app.get("/v1/scopes", (req, res) => {
    res.json({ ok: true, scopes: Object.values(SCOPES), presets: KEY_PRESETS });
  });

  app.get("/v1/keys/presets", (req, res) => {
    res.json({ ok: true, presets: KEY_PRESETS });
  });

  app.post("/v1/keys/generate", requireAdmin, (req, res) => {
    try {
      const result = keyStore.createKey(req.body || {});
      res.status(201).json({ ok: true, ...result, warning: "La key in chiaro viene mostrata solo ora." });
    } catch (error) {
      publicError(res, 400, error.message || "key_generation_failed");
    }
  });

  app.get("/v1/keys", requireAdmin, (req, res) => {
    res.json({ ok: true, keys: keyStore.listKeys({ tenant_id: req.query.tenant_id }) });
  });

  app.post("/v1/keys/revoke", requireAdmin, (req, res) => {
    const record = keyStore.revokeKey(String(req.body?.key_id || ""), req.body?.status);
    if (!record) return publicError(res, 404, "key_not_found");
    return res.json({ ok: true, key: record });
  });

  app.get("/v1/tenant/status", createAuth(keyStore, audit), (req, res) => {
    const branchResolution = resolveBranchesForKey(req.coreKey);
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      brand_scope: req.coreKey.brand_scope,
      key_id: req.coreKey.key_id,
      key_type: req.coreKey.key_type,
      tier: branchResolution.tier,
      active_branches: branchResolution.allowed_branches,
      allowed_scopes: req.coreKey.allowed_scopes,
      status: req.coreKey.status,
      expires_at: req.coreKey.expires_at,
      last_used_at: req.coreKey.last_used_at,
      mode: "local_first_render_ready",
    });
  });

  app.get("/v1/ecosystem-pulse", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const pulse = buildEcosystemPulse({
      tenantId: req.tenantId,
      keyRecord: req.coreKey,
      snapshot: snapshots.latest(req.tenantId),
      auditEvents: audit.recent(200),
    });
    audit.append("core_ecosystem_pulse_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, risk_status: pulse.score.risk_status });
    res.json({ ok: true, pulse });
  });

  app.get("/v1/calibration/status", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    res.json({ ok: true, calibration: calibrationStatus() });
  });

  app.post("/v1/calibration/evaluate", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const result = calibrationEvaluate(req.body || {});
    audit.append("core_calibration_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      status: result.status,
      selected_variant: result.selected_variant?.id || null,
    });
    res.json({ ok: true, result });
  });

  app.get("/v1/compliance/claim-shield/status", createAuth(keyStore, audit, SCOPES.CLAIM_CHECK), (req, res) => {
    res.json({
      ok: true,
      claim_shield: {
        status: "advisory_ready",
        mode: "reference_registry_plus_brand_policy",
        hard_block: false,
        sources: claimShieldSources(),
        legal_guarantee: false,
        recommended_action: "Caricare policy claim del brand e usare check strutturato prima della pubblicazione.",
      },
    });
  });

  app.post("/v1/compliance/claim-shield/check", createAuth(keyStore, audit, SCOPES.CLAIM_CHECK), (req, res) => {
    const result = claimShieldCheck(req.body || {});
    audit.append("core_claim_shield_checked", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, status: result.status, shield_status: result.shield_status });
    res.json({ ok: true, result });
  });

  app.post("/v1/decision", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const input = buildCoreInput(req, req.coreKey);
    if (!input.signals.length) {
      input.signals.push(normalizeSignal({ id: "core:no_signal", label: "Nessun segnale operativo fornito", normalized_score: 10, tags: ["system"] }));
    }
    const output = runUniversalCore(input);
    audit.append("core_decision_run", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, request_id: input.request_id, state: output.state, risk: output.risk?.band });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      output,
      guardrail: {
        destructive_automation: false,
        publish_requires_owner_confirmation: true,
        execution_from_api_allowed: output.execution_profile.can_execute === true && hasScope(req.coreKey, SCOPES.AUTOMATION_CODEX),
      },
    });
  });

  app.post("/v1/flowcore/decision", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const branchInput = buildFlowCoreBranchInput(req.body || {});
    const input = mapFlowCoreToUniversal(branchInput);
    input.context = {
      ...(input.context || {}),
      tenant_id: req.tenantId,
      actor_id: req.body?.actor_id || undefined,
      plan: req.body?.plan || undefined,
      locale: req.body?.locale || "it",
      metadata: {
        ...(input.context?.metadata || {}),
        source: "flowcore_branch_endpoint",
      },
    };
    input.constraints = safeConstraints(input.constraints, req.coreKey, false);
    const output = runUniversalCore(input);
    audit.append("core_flowcore_decision_run", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      request_id: input.request_id,
      state: output.state,
      risk: output.risk?.band,
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      branch: "flowcore",
      input: branchInput,
      output,
      guardrail: {
        destructive_automation: false,
        execution_allowed: false,
        mode: "suggest_only",
      },
    });
  });

  app.get("/v1/branches", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const resolution = resolveBranchesForKey(req.coreKey);
    res.json({
      ok: true,
      branches: branchRegistry(),
      packages: BRANCH_PACKAGES,
      tenant_package: resolution,
      rule: "Ogni ramo produce decisioni advisory/read-only. Azioni operative e pubblicazione richiedono conferma owner.",
    });
  });

  app.get("/v1/branches/authorized", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const requested = typeof req.query.branches === "string" && req.query.branches.trim()
      ? req.query.branches.split(",").map((item) => item.trim()).filter(Boolean)
      : [];
    const resolution = resolveBranchesForKey(req.coreKey, requested);
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      branch_package: resolution,
      branches: Object.fromEntries(resolution.selected_branches.map((id) => [id, branchRegistry()[id]]).filter(([, value]) => Boolean(value))),
    });
  });

  app.post("/v1/codex/context", createAuth(keyStore, audit, SCOPES.AUTOMATION_CODEX), (req, res) => {
    const requestedBranches = Array.isArray(req.body?.branches)
      ? req.body.branches
      : Array.isArray(req.body?.requested_branches)
        ? req.body.requested_branches
        : [];
    const context = composeBranchContext({
      keyRecord: req.coreKey,
      requestedBranches,
      task: req.body?.task || "",
      userInput: req.body?.user_input || req.body?.input || "",
      locale: req.body?.locale || "it",
    });
    audit.append("core_codex_context_composed", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      tier: context.tier,
      selected_branches: context.selected_branches,
      denied_branches: context.denied_branches,
    });
    res.json({
      ok: true,
      context,
      guardrail: {
        destructive_automation: false,
        execution_allowed: false,
        openai_call_executed: false,
        mode: "context_composition_only",
      },
    });
  });

  app.post("/v1/content-guard/check", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const resolution = resolveBranchesForKey(req.coreKey, ["ramo_testo"]);
    if (!resolution.selected_branches.includes("ramo_testo")) {
      audit.append("core_branch_denied", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, branch: "ramo_testo" });
      return publicError(res, 403, "branch_not_allowed", `Branch not allowed for tier ${resolution.tier}`);
    }

    const input = buildTextBranchInput(req, req.body || {});
    const decision = runTextBranch(input);
    audit.append("core_content_guard_checked", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      issue_count: input.issues.length,
      state: decision.state,
      risk: decision.risk_band,
      publish_safe: decision.publish_safe,
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      branch: "ramo_testo",
      decision,
      issue_count: input.issues.length,
      issues: input.issues.map((issue) => ({
        id: issue.id,
        type: issue.type,
        severity: issue.severity,
        start: issue.start,
        end: issue.end,
        original: issue.original,
        suggestions: issue.suggestions,
        message: issue.message,
        reason: issue.reason,
        safe_to_auto_apply: issue.safe_to_auto_apply,
      })),
      guardrail: {
        destructive_automation: false,
        execution_allowed: false,
        publish_requires_owner_confirmation: true,
        mode: "content_guard_review_only",
      },
    });
  });

  app.post("/v1/branches/:branch/analyze", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const branch = String(req.params.branch || "").trim();
    const resolution = resolveBranchesForKey(req.coreKey, [branch]);
    if (!resolution.selected_branches.includes(branch)) {
      audit.append("core_branch_denied", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, branch });
      return publicError(res, 403, "branch_not_allowed", `Branch not allowed for tier ${resolution.tier}`);
    }
    const payload = buildBranchPayload(branch, { ...(req.body || {}), tenant_id: req.tenantId });
    if (!payload) return publicError(res, 404, "branch_not_found");
    payload.core_input.context.tenant_id = req.tenantId;
    payload.core_input.constraints = safeConstraints(payload.core_input.constraints, req.coreKey, false);
    const output = runUniversalCore(payload.core_input);
    audit.append("core_branch_analyzed", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      branch,
      state: output.state,
      risk: output.risk?.band,
      production_status: payload.profile.production_status,
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      branch,
      profile: payload.profile,
      branch_output: payload.branch_output,
      warnings: payload.warnings,
      output,
      guardrail: {
        destructive_automation: false,
        execution_allowed: false,
        publish_requires_owner_confirmation: true,
        mode: payload.profile.production_status === "test_only" ? "test_only" : "advisory_only",
      },
    });
  });

  app.post("/v1/snapshot", createAuth(keyStore, audit, SCOPES.WRITE_SNAPSHOT), (req, res) => {
    const record = snapshots.append(req.tenantId, req.body?.source || "unknown", req.body?.payload || req.body || {});
    audit.append("core_snapshot_written", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, snapshot_id: record.snapshot_id });
    res.status(201).json({ ok: true, snapshot: record });
  });

  app.get("/v1/snapshot", createAuth(keyStore, audit, SCOPES.READ_SNAPSHOT), (req, res) => {
    res.json({ ok: true, snapshot: snapshots.latest(req.tenantId) });
  });

  app.post("/v1/sync/suite", createAuth(keyStore, audit, SCOPES.WRITE_SYNC_SUITE), (req, res) => {
    const record = snapshots.append(req.tenantId, "suite", req.body || {});
    audit.append("core_suite_sync_received", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, snapshot_id: record.snapshot_id });
    res.json({ ok: true, sync_status: "received", snapshot_id: record.snapshot_id });
  });

  app.post("/v1/sync/wordpress", createAuth(keyStore, audit, SCOPES.WRITE_SYNC_WORDPRESS), (req, res) => {
    const record = snapshots.append(req.tenantId, "wordpress", req.body || {});
    audit.append("core_wordpress_sync_received", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, snapshot_id: record.snapshot_id });
    res.json({ ok: true, sync_status: "received", snapshot_id: record.snapshot_id });
  });

  app.post("/v1/policy/check", createAuth(keyStore, audit, SCOPES.POLICY_CHECK), (req, res) => {
    const policy = req.body?.policy || {};
    const result = {
      status: policy.approval_required ? "approval_required" : "ok",
      hard_block: false,
      owner_confirmation_required: Boolean(policy.approval_required),
      recommended_action: policy.approval_required ? "owner_review_before_execution" : "continue_with_audit",
    };
    audit.append("core_policy_checked", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, status: result.status });
    res.json({ ok: true, result });
  });

  app.post("/v1/claim-guard/check", createAuth(keyStore, audit, SCOPES.CLAIM_CHECK), (req, res) => {
    const result = claimGuardCheck(req.body || {});
    audit.append("core_claim_checked", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, status: result.status, issue_count: result.issue_count });
    res.json({ ok: true, result });
  });

  app.post("/v1/pricing-guard/check", createAuth(keyStore, audit, SCOPES.PRICING_CHECK), (req, res) => {
    const result = pricingGuardCheck(req.body || {});
    audit.append("core_pricing_checked", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, status: result.status, issue_count: result.issue_count });
    res.json({ ok: true, result });
  });

  app.get("/v1/review/pending", createAuth(keyStore, audit, SCOPES.READ_REVIEW), (req, res) => {
    res.json({ ok: true, reviews: reviews.pending(req.tenantId) });
  });

  app.post("/v1/review/action", createAuth(keyStore, audit, SCOPES.WRITE_REVIEW), (req, res) => {
    const record = reviews.action(req.tenantId, req.body || {});
    if (!record) return publicError(res, 404, "review_not_found");
    audit.append("core_review_action", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, review_id: record.review_id, status: record.status });
    res.json({ ok: true, review: record });
  });

  app.get("/v1/audit/recent", createAuth(keyStore, audit, SCOPES.ADMIN_TENANT), (req, res) => {
    res.json({ ok: true, audit: audit.recent(Number(req.query.limit || 50)).filter((event) => !req.tenantId || event.tenant_id === req.tenantId) });
  });

  app.use((req, res) => publicError(res, 404, "route_not_found"));

  return { app, storageRoot };
}
