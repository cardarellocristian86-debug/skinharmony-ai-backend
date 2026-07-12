import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SENSITIVE_ACTIONS, validateGovernanceRequest } from "./governance.js";

const SERVICE_VERSION = "0.4.8-live-node-readiness";
const DEFAULT_MAX_EVENTS_PER_NODE = 250;
const DEFAULT_NODE_STALE_AFTER_MS = 15 * 60 * 1000;
const NODE_STALE_AFTER_MS = Math.max(
  60 * 1000,
  Number(process.env.SUITE_NODE_STALE_AFTER_MS || DEFAULT_NODE_STALE_AFTER_MS),
);
const GOOGLE_CONNECTOR_SCOPES = [
  "google_ads.readonly",
  "analytics.readonly",
];
const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/adwords",
  "https://www.googleapis.com/auth/analytics.readonly",
];
const GOOGLE_CONNECTOR_REQUIRED_PROVIDER_FIELDS = [
  "client_id",
  "client_secret",
  "developer_token",
  "redirect_uri",
];
const GOOGLE_CONNECTOR_REQUIRED_TENANT_FIELDS = [
  "tenant_id",
  "google_user_authorized",
  "ads_customer_id",
  "ga4_property_id",
];
const SUITE_RUNTIME_WORDPRESS_KEEPS = [
  { area: "ui_suite", label: "UI Suite", rule: "WordPress resta pannello cliente, contenuti e WooCommerce." },
  { area: "template_registry", label: "Template, tecnologie e card", rule: "Dati runtime modificabili e persistenti nel sito; esportabili in JSON." },
  { area: "crm_inventory_base", label: "CRM e magazzino base", rule: "Restano in WP finche manuali e leggeri; Render legge snapshot/eventi." },
  { area: "checkout", label: "WooCommerce / checkout", rule: "Pagamento e ordine restano nel sito; Render non cattura pagamenti." },
];
const SUITE_RUNTIME_RENDER_MOVES = [
  { area: "analytics_funnel", label: "Analytics WaaS e funnel", priority: "first", rule: "Sessioni, eventi, Ads, conversioni e report crescono fuori dal plugin." },
  { area: "event_spine", label: "Event Spine", priority: "first", rule: "Page view, click, CTA, form, carrello e checkout diventano eventi tenant-scoped." },
  { area: "core_insight", label: "Core Insight e report", priority: "first", rule: "Diagnosi e azioni consigliate devono essere auditabili e non pesare su WordPress." },
  { area: "google_sync", label: "Google Ads / GA4 sync", priority: "first", rule: "Token, refresh e letture periodiche vivono su Render." },
  { area: "crm_inventory_scoring", label: "CRM/magazzino scoring", priority: "later", rule: "Si sposta quando servono storico, AI, multi-sede o Smart Desk condiviso." },
];
const GOOGLE_PROVIDER_CONFIG_FIELDS = [
  "client_id",
  "client_secret",
  "developer_token",
  "redirect_uri",
];
const GOOGLE_OAUTH_CLIENT_ID = "1062915832418-t1i2r823u06ohuri3efhi5l92bm7oc4f.apps.googleusercontent.com";
const NYRA_SUITE_BRANCH_MAP_PATH = path.resolve(process.cwd(), "config", "nyra-suite-branch-map.json");
const DEFAULT_NYRA_SUITE_BRANCH_MAP = {
  schema: "nyra_suite_branch_map_v1",
  version: "2026-06-01",
  mode: "read_only_owner_confirmed",
  source: "suite-control-plane/default",
  render_role: "reference_contract_for_suite_control_plane_and_core_bridge",
  branch_keys: [
    "analytics_insight",
    "google_ads_ga4",
    "marketing_recall",
    "crm_sales",
    "commerce_checkout",
    "product_registry",
    "technology_registry",
    "pricing_margin",
    "claim_content",
    "license_waas",
    "customer_success",
    "render_operations",
    "support_risk",
    "visual_content",
  ],
  guardrails: {
    execution_allowed: false,
    owner_confirmation_required: true,
    core_required_for_sensitive_actions: true,
    nyra_read_only: true,
    no_raw_customer_data_without_scoped_policy: true,
  },
};
const RUNBOOK_CATALOG = [
  {
    id: "site_clone_readiness",
    label: "Template clone readiness",
    category: "provisioning",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Verifica se un nodo WordPress e pronto per clone template, senza clonare o modificare il sito.",
  },
  {
    id: "plugin_update_preflight",
    label: "Plugin update preflight",
    category: "release",
    risk: "high",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Prepara controlli per aggiornamento plugin: versione, manifest, rollback e stato nodo.",
  },
  {
    id: "claim_price_guard_scan",
    label: "Claim and price guard scan",
    category: "governance",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Richiede una scansione controllata di claim, prezzi e policy commerciali.",
  },
  {
    id: "smartdesk_bridge_check",
    label: "Smart Desk bridge check",
    category: "integration",
    risk: "low",
    owner_confirmation_required: false,
    execution_mode: "proposal_only",
    description: "Controlla readiness bridge Smart Desk e produce prossime azioni senza inviare dati cliente raw.",
  },
  {
    id: "clone_waas_site",
    label: "Clone sito WaaS",
    category: "provisioning",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Prepara il piano controllato per clone template WaaS senza creare o modificare siti.",
  },
  {
    id: "setup_site_suite",
    label: "Setup Suite cliente",
    category: "configuration",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Prepara checklist e bozza setup Suite per cliente, senza scrivere configurazioni sul nodo.",
  },
  {
    id: "claim_price_audit",
    label: "Verifica claim/prezzi",
    category: "governance",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Accetta il runbook Suite locale per verifica claim e prezzi, come richiesta controllata read-only.",
  },
  {
    id: "customer_report",
    label: "Report cliente",
    category: "reporting",
    risk: "low",
    owner_confirmation_required: false,
    execution_mode: "proposal_only",
    description: "Accoda la generazione di un report cliente controllato usando solo summary e stato nodo.",
  },
  {
    id: "smartdesk_gold_customer_intelligence_sync",
    label: "Smart Desk Gold Customer Intelligence",
    category: "smartdesk_gold",
    risk: "low",
    owner_confirmation_required: false,
    execution_mode: "proposal_only",
    description: "Verifica contratto Customer Intelligence, consensi e readiness Gold senza inviare messaggi o modificare dati cliente.",
  },
  {
    id: "customer_360_profile_review",
    label: "Customer 360 profile review",
    category: "customer_intelligence",
    risk: "low",
    owner_confirmation_required: false,
    execution_mode: "proposal_only",
    description: "Prepara una revisione profilo cliente leggendo solo summary e readiness Core.",
  },
  {
    id: "journey_builder_guarded_draft",
    label: "Journey builder controllato",
    category: "marketing_governance",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Prepara bozze journey marketing governate da Core; nessun invio automatico e conferma owner/operatore obbligatoria.",
  },
];

function nowIso() {
  return new Date().toISOString();
}

function readSecret(req) {
  const auth = req.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.get("x-sh-suite-key") || req.get("x-api-key") || "";
}

function publicError(res, status, code, message = code) {
  return res.status(status).json({ ok: false, error: code, message });
}

function hasRuntimeValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return String(value ?? "").trim() !== "";
}

function normalizeBaseUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function sanitizeId(value, fallbackPrefix) {
  const raw = String(value || "").trim();
  const cleaned = raw.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120);
  return cleaned || `${fallbackPrefix}_${crypto.randomUUID()}`;
}

function sanitizeGoogleAccountValue(value = "") {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_.:/-]/g, "_").slice(0, 160);
}

function isGovernanceSensitiveAction(action = {}) {
  return Boolean(action?.scope?.sensitive_action) || SENSITIVE_ACTIONS.has(action?.action_type);
}


function uniqueValues(values) {
  return [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))];
}

function nodeHeartbeatFresh(node, now = Date.now()) {
  const heartbeatAt = Date.parse(node?.latest_heartbeat?.received_at || node?.last_seen_at || "");
  return Number.isFinite(heartbeatAt) && now - heartbeatAt <= NODE_STALE_AFTER_MS;
}

function nodeStatus(node) {
  const status = String(node?.status || "registered");
  return status === "online" && !nodeHeartbeatFresh(node) ? "stale" : status;
}

function loadNyraSuiteBranchMap() {
  try {
    if (fs.existsSync(NYRA_SUITE_BRANCH_MAP_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(NYRA_SUITE_BRANCH_MAP_PATH, "utf8"));
      const branchKeys = Array.isArray(parsed.branch_keys)
        ? parsed.branch_keys.map(String).filter(Boolean)
        : DEFAULT_NYRA_SUITE_BRANCH_MAP.branch_keys;
      return {
        ...DEFAULT_NYRA_SUITE_BRANCH_MAP,
        ...parsed,
        branch_keys: uniqueValues(branchKeys),
        guardrails: {
          ...DEFAULT_NYRA_SUITE_BRANCH_MAP.guardrails,
          ...(parsed.guardrails && typeof parsed.guardrails === "object" ? parsed.guardrails : {}),
        },
      };
    }
  } catch (error) {
    return {
      ...DEFAULT_NYRA_SUITE_BRANCH_MAP,
      load_warning: error instanceof Error ? error.message : "nyra_suite_branch_map_load_failed",
    };
  }
  return DEFAULT_NYRA_SUITE_BRANCH_MAP;
}

function nodeReadiness(node) {
  const capabilities = Array.isArray(node?.latest_heartbeat?.capabilities) ? node.latest_heartbeat.capabilities : [];
  const validation = node?.latest_snapshot?.validation || {};
  const controlPlane = node?.latest_snapshot?.control_plane || {};
  const checks = {
    heartbeat: Boolean(node?.latest_heartbeat),
    heartbeat_fresh: nodeHeartbeatFresh(node),
    snapshot: Boolean(node?.latest_snapshot),
    evidence: Number(node?.evidence_count || 0) > 0,
    change_impact_contract: Boolean(node?.latest_snapshot?.change_impact_orchestration),
    manifest_integrity: validation.manifest_integrity_ready === true,
    runbook_receiver: capabilities.includes("runbook_receiver") || controlPlane.runbook_receiver_ready === true,
    core_bridge: capabilities.includes("control_plane") || controlPlane.core_bridge_ready === true,
  };
  const missing = Object.entries(checks)
    .filter(([, ready]) => !ready)
    .map(([key]) => key);
  const criticalIssues = Array.isArray(validation.critical_issues)
    ? validation.critical_issues.map(String).filter(Boolean)
    : [];

  return {
    status: criticalIssues.length ? "blocked" : missing.length ? "warning" : "ready",
    score: Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100),
    checks,
    missing,
    critical_issues: criticalIssues,
    next_actions: [
      ...(checks.heartbeat && checks.heartbeat_fresh ? [] : ["send_node_heartbeat"]),
      ...(checks.snapshot ? [] : ["send_node_snapshot"]),
      ...(checks.change_impact_contract ? [] : ["attach_change_impact_contract"]),
      ...(checks.manifest_integrity ? [] : ["verify_release_manifest_integrity"]),
      ...(checks.runbook_receiver ? [] : ["enable_runbook_receiver_capability"]),
      ...(checks.core_bridge ? [] : ["verify_core_bridge_capability"]),
      ...(checks.evidence ? [] : ["write_first_core_evidence"]),
    ],
  };
}

function summarizeEvidence(events = []) {
  const byType = {};
  const byDecision = {};
  const byRisk = {};
  for (const event of events) {
    byType[event.evidence_type] = (byType[event.evidence_type] || 0) + 1;
    if (event.decision) byDecision[event.decision] = (byDecision[event.decision] || 0) + 1;
    if (event.risk) byRisk[event.risk] = (byRisk[event.risk] || 0) + 1;
  }
  return {
    total: events.length,
    by_type: byType,
    by_decision: byDecision,
    by_risk: byRisk,
    latest: events.slice(0, 10),
  };
}

function sanitizeSiteEvent(payload = {}) {
  const eventType = sanitizeId(payload.event_type || "page_view", "event").slice(0, 60);
  const allowed = new Set(["page_view", "cta_click", "form_submit", "engaged_visit", "scroll_depth", "active_time_ping"]);
  return {
    id: `site_event_${crypto.randomUUID()}`,
    received_at: nowIso(),
    schema_version: "suite_site_event_v1",
    tenant_id: sanitizeId(payload.tenant_id, "tenant"),
    node_id: sanitizeId(payload.node_id, "node"),
    source: sanitizeId(payload.source || "wordpress_site_suite", "source"),
    suite_version: String(payload.suite_version || "").slice(0, 40),
    site_url: normalizeBaseUrl(payload.site_url || ""),
    event_type: allowed.has(eventType) ? eventType : "page_view",
    event_label: String(payload.event_label || "none").replace(/\s+/g, " ").trim().slice(0, 100) || "none",
    event_section: sanitizeId(payload.event_section || "body", "body").slice(0, 100),
    click_kind: sanitizeId(payload.click_kind || "altro", "altro").slice(0, 60),
    target_url: String(payload.target_url || "none").replace(/\s+/g, " ").trim().slice(0, 180) || "none",
    session_hash: String(payload.session_hash || "").replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 80),
    path: String(payload.path || "home").replace(/[^\w./:-]/g, "_").slice(0, 180) || "home",
    referrer: String(payload.referrer || "direct").replace(/\s+/g, " ").trim().slice(0, 120) || "direct",
    utm_source: sanitizeId(payload.utm_source || "none", "none").slice(0, 80),
    utm_medium: sanitizeId(payload.utm_medium || "none", "none").slice(0, 80),
    utm_campaign: String(payload.utm_campaign || "none").replace(/\s+/g, " ").trim().slice(0, 140) || "none",
    browser_language: String(payload.browser_language || "unknown").replace(/\s+/g, " ").trim().slice(0, 40),
    browser_timezone: String(payload.browser_timezone || "unknown").replace(/\s+/g, " ").trim().slice(0, 80),
    estimated_country: String(payload.estimated_country || "non stimato").replace(/\s+/g, " ").trim().slice(0, 80),
    elapsed_seconds: Math.max(0, Math.min(3600, Number(payload.elapsed_seconds || 0))),
    scroll_depth: Math.max(0, Math.min(100, Number(payload.scroll_depth || 0))),
    event_day: String(payload.event_day || "").replace(/[^0-9-]/g, "").slice(0, 10),
    privacy: {
      ip_address_sent: false,
      raw_session_id_sent: false,
      personal_data_payload: false,
    },
  };
}

function incrementBucket(bucket, key) {
  const value = String(key || "unknown").trim() || "unknown";
  bucket[value] = (bucket[value] || 0) + 1;
}

function topBucket(bucket, limit = 20) {
  return Object.fromEntries(
    Object.entries(bucket)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit),
  );
}

function summarizeSiteEvents(events = [], days = 30) {
  const period = Math.max(1, Number(days || 30));
  const cutoff = Date.now() - period * 24 * 60 * 60 * 1000;
  const filtered = events.filter((event) => {
    const ts = Date.parse(event.received_at || "");
    return Number.isFinite(ts) && ts >= cutoff;
  });
  const byType = {};
  const byPath = {};
  const byReferrer = {};
  const byUtmSource = {};
  const byTarget = {};
  const byLabel = {};
  const byClickKind = {};
  const byClickSection = {};
  const byClickDetail = {};
  const bySourcePathClick = {};
  const byScrollMilestone = {};
  const activeSecondsByPath = {};
  const daily = {};
  const sessions = new Set();
  let engaged = 0;
  let activeSecondsTotal = 0;

  for (const event of filtered) {
    incrementBucket(byType, event.event_type);
    incrementBucket(byPath, event.path);
    incrementBucket(byReferrer, event.referrer);
    incrementBucket(byUtmSource, event.utm_source);
    if (event.target_url && event.target_url !== "none") incrementBucket(byTarget, event.target_url);
    if (event.event_label && event.event_label !== "none") incrementBucket(byLabel, event.event_label);
    if (event.event_type === "cta_click") {
      incrementBucket(byClickKind, event.click_kind || "altro");
      incrementBucket(byClickSection, event.event_section || "body");
      incrementBucket(byClickDetail, `${event.path} | ${event.event_section || "body"} | ${event.click_kind || "altro"} | ${event.event_label || "none"}`);
      incrementBucket(bySourcePathClick, `${event.utm_source && event.utm_source !== "none" ? event.utm_source : event.referrer} | ${event.path} | ${event.click_kind || "altro"}`);
    }
    if (event.event_type === "scroll_depth") {
      incrementBucket(byScrollMilestone, `${event.path} | ${event.event_label || `${event.scroll_depth}%`}`);
    }
    if (event.event_type === "active_time_ping") {
      const seconds = Math.max(0, Math.min(60, Number(event.elapsed_seconds || 0)));
      activeSecondsTotal += seconds;
      activeSecondsByPath[event.path] = (activeSecondsByPath[event.path] || 0) + seconds;
    }
    incrementBucket(daily, event.event_day || String(event.received_at || "").slice(0, 10));
    if (event.session_hash) sessions.add(event.session_hash);
    if (event.event_type === "engaged_visit") engaged += 1;
  }

  const pageViews = byType.page_view || 0;
  return {
    schema_version: "suite_site_event_summary_v1",
    generated_at: nowIso(),
    period_days: period,
    events_total: filtered.length,
    page_views: pageViews,
    unique_sessions: sessions.size,
    engaged_visits: engaged,
    engagement_rate_pct: pageViews > 0 ? Math.round((engaged / pageViews) * 1000) / 10 : 0,
    active_seconds_total: Math.round(activeSecondsTotal),
    avg_active_seconds_per_session: sessions.size > 0 ? Math.round((activeSecondsTotal / sessions.size) * 10) / 10 : 0,
    by_event_type: topBucket(byType),
    by_path: topBucket(byPath),
    by_referrer: topBucket(byReferrer),
    by_utm_source: topBucket(byUtmSource),
    by_target: topBucket(byTarget),
    by_event_label: topBucket(byLabel),
    click_intelligence: {
      by_kind: topBucket(byClickKind),
      by_section: topBucket(byClickSection),
      by_detail: topBucket(byClickDetail),
      by_source_path: topBucket(bySourcePathClick),
      scroll_milestones: topBucket(byScrollMilestone),
      active_seconds_by_path: topBucket(activeSecondsByPath),
    },
    daily: topBucket(daily, 45),
    privacy: {
      aggregate_only: true,
      raw_ip_stored: false,
      raw_session_id_stored: false,
    },
  };
}

function firstBucketKey(bucket = {}) {
  return Object.keys(bucket || {})[0] || "";
}

function buildAnalyticsActionPlan(summary = {}) {
  const eventTypes = summary.by_event_type || {};
  const clickIntel = summary.click_intelligence || {};
  const topPath = firstBucketKey(summary.by_path);
  const topSource = firstBucketKey(summary.by_referrer) || firstBucketKey(summary.by_utm_source) || "non chiara";
  const pageViews = Number(summary.page_views || 0);
  const ctaClicks = Number(eventTypes.cta_click || 0);
  const formSubmits = Number(eventTypes.form_submit || 0);
  const scrollEvents = Number(eventTypes.scroll_depth || 0);
  const activeSeconds = Number(summary.active_seconds_total || 0);
  const uniqueSessions = Number(summary.unique_sessions || 0);
  const ctaRate = pageViews > 0 ? roundNumber((ctaClicks / pageViews) * 100, 1) : 0;
  const formRate = pageViews > 0 ? roundNumber((formSubmits / pageViews) * 100, 1) : 0;
  const avgActiveSeconds = Number(summary.avg_active_seconds_per_session || 0);
  const topClickKind = firstBucketKey(clickIntel.by_kind);
  const topClickSection = firstBucketKey(clickIntel.by_section);
  const topActivePath = firstBucketKey(clickIntel.active_seconds_by_path);
  const topScroll = firstBucketKey(clickIntel.scroll_milestones);
  const actions = [];

  if (pageViews === 0) {
    actions.push({
      id: "tracking_no_visits",
      priority: "alta",
      area: "tracking",
      title: "Prima verifica: il sito non sta ancora arrivando a Render",
      what_happens: "Render non vede visite nel periodo selezionato.",
      why_it_matters: "Senza visite su Render, la diagnosi non puo distinguere traffico reale, test e problemi della pagina.",
      do_this: "Genera una visita pubblica non loggata e controlla che WordPress inoltri gli eventi al Control Plane.",
      check_success: "Render deve mostrare almeno una visita e una pagina nella sintesi eventi.",
      avoid: "Non giudicare Ads, pagina o checkout finche il tracciamento non e verificato.",
      evidence: { page_views: pageViews, events_total: Number(summary.events_total || 0) },
    });
  }

  if (pageViews > 0 && ctaClicks === 0) {
    actions.push({
      id: "no_primary_clicks",
      priority: "alta",
      area: "pagina",
      title: "Le persone arrivano ma non cliccano l'azione principale",
      what_happens: `La pagina piu vista e ${topPath || "non chiara"}, ma Render non vede click utili.`,
      why_it_matters: "Se non parte il click verso richiesta, form, carrello o contatto, il traffico resta solo visita.",
      do_this: "Metti l'azione principale visibile nel primo schermo, usa un testo diretto e riduci le alternative vicine.",
      check_success: "Il tasso click deve salire almeno sopra il 2-3% sulle pagine piu viste.",
      avoid: "Non aggiungere altro testo lungo prima di chiarire cosa deve fare il visitatore.",
      evidence: { page_views: pageViews, cta_clicks: ctaClicks, top_path: topPath },
    });
  }

  if (ctaClicks > 0 && formSubmits === 0) {
    actions.push({
      id: "clicks_without_leads",
      priority: "alta",
      area: "percorso",
      title: "I click ci sono, ma non diventano richieste",
      what_happens: `Render vede ${ctaClicks} click, ma nessuna richiesta completata.`,
      why_it_matters: "Il problema probabile e dopo il click: form, checkout, chiarezza dell'offerta o troppi passaggi.",
      do_this: "Apri il percorso dal pulsante piu cliccato e fai un test completo fino a richiesta o checkout.",
      check_success: "Deve comparire almeno un invio form, lead o checkout test partendo dalla stessa pagina.",
      avoid: "Non aumentare budget Ads finche il passaggio click -> richiesta non e provato.",
      evidence: { cta_clicks: ctaClicks, form_submits: formSubmits, top_click_kind: topClickKind, top_click_section: topClickSection },
    });
  }

  if (pageViews > 20 && avgActiveSeconds > 0 && avgActiveSeconds < 12) {
    actions.push({
      id: "low_attention_time",
      priority: "media",
      area: "lettura",
      title: "Le visite durano poco",
      what_happens: `Tempo attivo medio: ${avgActiveSeconds}s per sessione.`,
      why_it_matters: "Se il valore e basso, molte persone non leggono abbastanza per capire offerta e prova.",
      do_this: "Rendi il primo blocco piu concreto: cosa vendi, per chi, beneficio immediato e una prova visiva o numerica.",
      check_success: "Tempo attivo medio sopra 20s sulle pagine principali e click piu coerenti.",
      avoid: "Non misurare solo la permanenza grezza: usa tempo attivo, scroll e click insieme.",
      evidence: { avg_active_seconds_per_session: avgActiveSeconds, active_seconds_total: activeSeconds, top_active_path: topActivePath },
    });
  }

  if (pageViews > 20 && scrollEvents === 0) {
    actions.push({
      id: "scroll_not_detected",
      priority: "media",
      area: "lettura",
      title: "Manca il segnale di lettura della pagina",
      what_happens: "Render non vede soglie di scroll nel periodo.",
      why_it_matters: "Senza scroll non sappiamo se gli utenti leggono o si fermano al primo schermo.",
      do_this: "Verifica che il tracker Suite invii scroll 25/50/75/100 e poi testa una visita pubblica.",
      check_success: "La sintesi deve mostrare almeno una soglia scroll per le pagine piu viste.",
      avoid: "Non concludere che il copy non funziona se prima manca il dato di lettura.",
      evidence: { scroll_depth_events: scrollEvents, top_scroll: topScroll },
    });
  }

  if (formSubmits > 0 && formRate < 3) {
    actions.push({
      id: "lead_rate_low",
      priority: "media",
      area: "conversione",
      title: "Le richieste arrivano, ma il tasso e ancora prudente",
      what_happens: `Tasso richiesta stimato: ${formRate}%.`,
      why_it_matters: "Il sito non e fermo, ma puo perdere utenti tra promessa, prova e modulo.",
      do_this: "Crea una landing dedicata alla fonte migliore e testa un solo invito all'azione.",
      check_success: "Richieste sopra 3% su 30 giorni o su campagna dedicata.",
      avoid: "Non cambiare dieci sezioni insieme: una modifica alla volta rende il dato leggibile.",
      evidence: { form_submits: formSubmits, form_rate_pct: formRate, top_source: topSource },
    });
  }

  if (!actions.length) {
    actions.push({
      id: "monitor_stable",
      priority: "bassa",
      area: "monitoraggio",
      title: "Il percorso e leggibile, ora serve confronto nel tempo",
      what_happens: "Render vede visite, click e richieste in modo coerente.",
      why_it_matters: "Quando il tracciamento e stabile, le decisioni possono passare da correzione a ottimizzazione.",
      do_this: "Mantieni il tracciamento e confronta pagina, fonte e azione ogni 7 giorni.",
      check_success: "Trend stabile o in crescita su click, richieste e tempo attivo.",
      avoid: "Non fare grandi redesign se i dati stanno migliorando.",
      evidence: { page_views: pageViews, cta_rate_pct: ctaRate, form_rate_pct: formRate, unique_sessions: uniqueSessions },
    });
  }

  return {
    schema_version: "suite_analytics_action_plan_v1",
    generated_at: nowIso(),
    period_days: Number(summary.period_days || 30),
    source: "suite_control_plane_render",
    mode: "read_only_recommendations",
    headline: actions[0]?.title || "Piano operativo analytics",
    summary_metrics: {
      page_views: pageViews,
      unique_sessions: uniqueSessions,
      events_total: Number(summary.events_total || 0),
      cta_clicks: ctaClicks,
      form_submits: formSubmits,
      cta_rate_pct: ctaRate,
      form_rate_pct: formRate,
      avg_active_seconds_per_session: avgActiveSeconds,
      top_path: topPath,
      top_source: topSource,
    },
    next_actions: actions.slice(0, 6),
    rules: [
      "Render legge eventi aggregati e non modifica pagine, budget, form o checkout.",
      "Prima si verifica tracking e percorso; poi si decide cosa cambiare.",
      "Ogni azione richiede conferma owner o operatore.",
    ],
  };
}

function sanitizeCommerceSnapshot(payload = {}) {
  const snapshot = payload.snapshot && typeof payload.snapshot === "object"
    ? payload.snapshot
    : payload.commerce_snapshot && typeof payload.commerce_snapshot === "object"
      ? payload.commerce_snapshot
      : payload;
  const tenantId = sanitizeId(payload.tenant_id || snapshot.tenant_id || "unknown", "tenant");
  const nodeId = sanitizeId(payload.node_id || snapshot.node_id || `${tenantId}_wordpress`, "node");
  const summary = snapshot.summary && typeof snapshot.summary === "object" ? snapshot.summary : {};
  const sections = Array.isArray(snapshot.sections) ? snapshot.sections : [];
  return {
    id: `commerce_snapshot_${crypto.randomUUID()}`,
    received_at: nowIso(),
    schema_version: String(snapshot.schema_version || "suite_commerce_snapshot_v1"),
    tenant_id: tenantId,
    node_id: nodeId,
    source: String(snapshot.source || payload.source || "wordpress_site_suite").slice(0, 80),
    suite_version: String(snapshot.suite_version || payload.suite_version || "").slice(0, 40),
    mode: "read_only_summary",
    execution_allowed: false,
    owner_confirmation_required: true,
    summary: {
      crm_contacts: Math.max(0, Number(summary.crm_contacts || summary.contacts || 0) || 0),
      crm_companies: Math.max(0, Number(summary.crm_companies || summary.companies || 0) || 0),
      product_items: Math.max(0, Number(summary.product_items || summary.products || 0) || 0),
      technology_items: Math.max(0, Number(summary.technology_items || summary.technologies || 0) || 0),
      orders_count: Math.max(0, Number(summary.orders_count || summary.orders || 0) || 0),
      order_value: Math.max(0, Number(summary.order_value || 0) || 0),
      open_leads: Math.max(0, Number(summary.open_leads || 0) || 0),
      active_licenses: Math.max(0, Number(summary.active_licenses || 0) || 0),
    },
    sections: sections.slice(0, 30).map((section) => ({
      key: sanitizeId(section?.key || section?.id || "section", "section"),
      status: sanitizeId(section?.status || "unknown", "status"),
      count: Math.max(0, Number(section?.count || 0) || 0),
    })),
    privacy: {
      aggregate_only: true,
      raw_customer_records_stored: false,
      personal_data_payload: false,
    },
  };
}

function summarizeCommerceSnapshots(snapshots = []) {
  const latest = snapshots[0] || null;
  const totals = {
    snapshots: snapshots.length,
    crm_contacts: latest?.summary?.crm_contacts || 0,
    crm_companies: latest?.summary?.crm_companies || 0,
    product_items: latest?.summary?.product_items || 0,
    technology_items: latest?.summary?.technology_items || 0,
    orders_count: latest?.summary?.orders_count || 0,
    order_value: latest?.summary?.order_value || 0,
    open_leads: latest?.summary?.open_leads || 0,
    active_licenses: latest?.summary?.active_licenses || 0,
  };
  const readiness = latest
    ? (totals.crm_contacts || totals.product_items || totals.technology_items || totals.orders_count ? "ready" : "empty")
    : "missing";
  return {
    schema_version: "suite_commerce_summary_v1",
    generated_at: nowIso(),
    mode: "read_only_summary",
    readiness,
    execution_allowed: false,
    owner_confirmation_required: true,
    totals,
    latest,
    next_actions: readiness === "missing"
      ? ["send_first_commerce_snapshot"]
      : readiness === "empty"
        ? ["populate_crm_inventory_or_orders_before_scoring"]
        : ["keep_wordpress_as_ui_and_use_render_for_history_scoring"],
    policy: {
      wordpress_keeps_ui_and_checkout: true,
      render_reads_aggregate_snapshot: true,
      no_payment_capture: true,
      no_stock_mutation: true,
      no_customer_records_in_code: true,
    },
  };
}

function getRunbook(runbookId) {
  const id = sanitizeId(runbookId, "runbook");
  return RUNBOOK_CATALOG.find((runbook) => runbook.id === id) || null;
}

function buildRunbookPreview(runbook, node) {
  const nodeOnline = node && nodeStatus(node) === "online";
  const hasSnapshot = Boolean(node && node.latest_snapshot);
  const blocking = [];
  if (!node) blocking.push("node_not_registered");
  if (node && !nodeOnline) blocking.push("node_not_online");
  if (node && !hasSnapshot) blocking.push("snapshot_missing");

  const state = blocking.length === 0 ? "ready_for_owner_confirmation" : "blocked_until_node_ready";
  return {
    runbook_id: runbook.id,
    label: runbook.label,
    category: runbook.category,
    risk: runbook.risk,
    execution_mode: runbook.execution_mode,
    owner_confirmation_required: runbook.owner_confirmation_required,
    state,
    blocking,
    next_action: blocking.length === 0
      ? "Chiedere conferma owner e inviare al nodo solo come richiesta controllata."
      : "Registrare heartbeat/snapshot del nodo prima di preparare dispatch.",
  };
}

function buildEcosystemTracks(overview, runbooks, coreStatus) {
  const list = Array.isArray(runbooks) ? runbooks : [];
  const nodes = Array.isArray(overview?.nodes) ? overview.nodes : [];
  const suiteRunbooks = list.filter((runbook) => [
    "provisioning",
    "configuration",
    "release",
    "governance",
    "reporting",
  ].includes(runbook.category));
  const smartDeskRunbooks = list.filter((runbook) => [
    "integration",
    "smartdesk_gold",
    "customer_intelligence",
    "marketing_governance",
  ].includes(runbook.category));

  return {
    schema_version: "suite_ecosystem_tracks_v1",
    generated_at: nowIso(),
    core: {
      configured: Boolean(coreStatus?.configured),
      tenant_id: coreStatus?.tenant_id || "",
      provider_url: coreStatus?.provider_url || "",
    },
    suite_provider_track: {
      purpose: "vendere, configurare e governare nodi WordPress/Suite, tenant, runbook, audit e update controllati.",
      status: nodes.length ? "active" : "waiting_for_first_node",
      nodes_total: overview?.nodes_total || 0,
      nodes_online: overview?.nodes_online || 0,
      runbooks: suiteRunbooks.map((runbook) => ({
        id: runbook.id,
        label: runbook.label,
        category: runbook.category,
        risk: runbook.risk,
        owner_confirmation_required: runbook.owner_confirmation_required,
      })),
      next_actions: nodes.length
        ? ["verificare snapshot nodi", "accodare runbook solo con conferma quando richiesto", "salvare evidence/artifact"]
        : ["collegare primo nodo Suite/WordPress", "registrare heartbeat", "inviare snapshot readiness"],
    },
    smartdesk_gold_track: {
      purpose: "leggere operativita centro, profilazione cliente, consenso, marketing Gold e Customer Intelligence tramite Core.",
      status: coreStatus?.configured ? "core_ready" : "core_not_configured",
      runbooks: smartDeskRunbooks.map((runbook) => ({
        id: runbook.id,
        label: runbook.label,
        category: runbook.category,
        risk: runbook.risk,
        owner_confirmation_required: runbook.owner_confirmation_required,
      })),
      guardrails: [
        "nessun invio automatico",
        "consenso marketing obbligatorio",
        "operatore conferma sempre",
        "Core decide readiness/rischio",
      ],
      next_actions: [
        "mostrare stato Customer Intelligence Gold in Suite",
        "collegare report readiness per tenant",
        "preparare Customer 360 e journey controllato come runbook",
      ],
    },
  };
}

function normalizeGoogleProviderConfig(input = {}, previous = {}) {
  const next = { ...(previous && typeof previous === "object" ? previous : {}) };
  for (const field of GOOGLE_PROVIDER_CONFIG_FIELDS) {
    if (hasRuntimeValue(input[field])) {
      next[field] = String(input[field]).trim();
    }
  }
  next.updated_at = nowIso();
  return next;
}

function maskSecretValue(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length <= 8) return "***";
  return `${raw.slice(0, 4)}***${raw.slice(-4)}`;
}

function maskGoogleProviderConfig(config = {}) {
  return {
    client_id_present: hasRuntimeValue(config.client_id),
    client_secret_present: hasRuntimeValue(config.client_secret),
    developer_token_present: hasRuntimeValue(config.developer_token),
    redirect_uri_present: hasRuntimeValue(config.redirect_uri),
    client_id_masked: maskSecretValue(config.client_id),
    redirect_uri: hasRuntimeValue(config.redirect_uri) ? String(config.redirect_uri) : "",
    updated_at: config.updated_at || "",
  };
}

function addSecondsIso(seconds = 0) {
  return new Date(Date.now() + Number(seconds || 0) * 1000).toISOString();
}

function isIsoAfterNow(value = "") {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) && time > Date.now() + 30000;
}

function buildGoogleOAuthState(tenantId = "") {
  return `${sanitizeId(tenantId || "tenant_demo", "tenant")}.${crypto.randomBytes(24).toString("base64url")}`;
}

function maskGoogleTenantConnection(connection = {}) {
  const selected = connection.selected_accounts && typeof connection.selected_accounts === "object"
    ? connection.selected_accounts
    : {};
  const token = connection.token && typeof connection.token === "object" ? connection.token : {};
  const diagnostics = Array.isArray(connection.last_diagnostics) ? connection.last_diagnostics : [];
  return {
    tenant_id: sanitizeId(connection.tenant_id || "tenant_demo", "tenant"),
    connected: connection.connected === true,
    authorized_at: connection.authorized_at || "",
    updated_at: connection.updated_at || "",
    token: {
      access_token_present: hasRuntimeValue(token.access_token),
      refresh_token_present: hasRuntimeValue(token.refresh_token),
      token_type: token.token_type || "",
      scope: token.scope || "",
      expires_at: token.expires_at || "",
    },
    selected_accounts: {
      google_ads_customer_id: selected.google_ads_customer_id || "",
      ga4_property_id: selected.ga4_property_id || "",
    },
    available_accounts: {
      google_ads_customers: Array.isArray(connection.available_accounts?.google_ads_customers)
        ? connection.available_accounts.google_ads_customers
        : [],
      ga4_properties: Array.isArray(connection.available_accounts?.ga4_properties)
        ? connection.available_accounts.ga4_properties
        : [],
    },
    last_error: connection.last_error || "",
    last_diagnostics: diagnostics.slice(0, 6),
  };
}

function safeGoogleApiDiagnostic(source, response = {}, payload = {}) {
  const googleError = payload && typeof payload.error === "object" ? payload.error : {};
  const details = Array.isArray(googleError.details) ? googleError.details : [];
  const message = String(googleError.message || payload?.error_description || payload?.error || "").slice(0, 260);
  return {
    source: sanitizeId(source || "google_api", "google_api"),
    http_status: Number(response.status || googleError.code || 0),
    google_status: String(googleError.status || ""),
    google_code: Number(googleError.code || response.status || 0),
    message,
    detail_types: details
      .map((detail) => String(detail?.["@type"] || detail?.type || ""))
      .filter(Boolean)
      .slice(0, 6),
  };
}

function safeGoogleExceptionDiagnostic(source, error) {
  return {
    source: sanitizeId(source || "google_api", "google_api"),
    http_status: 0,
    google_status: "NETWORK_OR_RUNTIME_ERROR",
    google_code: 0,
    message: String(error?.message || "request_failed").slice(0, 180),
    detail_types: [],
  };
}

function googleAdsApiVersion() {
  const configured = String(process.env.GOOGLE_ADS_API_VERSION || "v24").trim();
  return /^v\d+$/.test(configured) ? configured : "v24";
}

function toFiniteNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(toFiniteNumber(value) * factor) / factor;
}

function dateLabels(days = 30) {
  const count = Math.max(7, Math.min(90, Number(days || 30)));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.now() - (count - index - 1) * 86400000);
    return date.toISOString().slice(0, 10);
  });
}

function googleDateRange(days = 30) {
  const count = Math.max(7, Math.min(90, Number(days || 30)));
  if (count <= 7) return "LAST_7_DAYS";
  if (count <= 30) return "LAST_30_DAYS";
  return "LAST_90_DAYS";
}

async function googleJsonRequest(url, options = {}, source = "google_api") {
  try {
    const response = await fetch(url, options);
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, status: response.status, body: json, diagnostic: safeGoogleApiDiagnostic(source, response, json) };
    }
    return { ok: true, status: response.status, body: json };
  } catch (error) {
    return { ok: false, status: 0, body: {}, diagnostic: safeGoogleExceptionDiagnostic(source, error) };
  }
}

async function fetchGoogleAdsFunnel(providerConfig = {}, token = {}, customerId = "", days = 30) {
  const query = `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions
    FROM campaign
    WHERE segments.date DURING ${googleDateRange(days)}
    ORDER BY segments.date
  `;
  const request = await googleJsonRequest(
    `https://googleads.googleapis.com/${googleAdsApiVersion()}/customers/${encodeURIComponent(customerId)}/googleAds:searchStream`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.access_token}`,
        "developer-token": String(providerConfig.developer_token || ""),
        "content-type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
    "google_ads_funnel",
  );
  if (!request.ok) {
    return { ok: false, rows: [], summary: {}, campaigns: [], daily: {}, diagnostics: [request.diagnostic].filter(Boolean) };
  }

  const batches = Array.isArray(request.body) ? request.body : [request.body];
  const rows = batches.flatMap((batch) => Array.isArray(batch.results) ? batch.results : []);
  const daily = {};
  const campaigns = {};
  const summary = { impressions: 0, clicks: 0, cost: 0, conversions: 0 };

  for (const row of rows) {
    const date = String(row?.segments?.date || "");
    const campaignId = String(row?.campaign?.id || "");
    const campaignName = String(row?.campaign?.name || campaignId || "Campagna");
    const metrics = row?.metrics || {};
    const impressions = toFiniteNumber(metrics.impressions);
    const clicks = toFiniteNumber(metrics.clicks);
    const cost = toFiniteNumber(metrics.costMicros) / 1000000;
    const conversions = toFiniteNumber(metrics.conversions);

    if (!daily[date]) daily[date] = { date, impressions: 0, clicks: 0, cost: 0, conversions: 0 };
    daily[date].impressions += impressions;
    daily[date].clicks += clicks;
    daily[date].cost += cost;
    daily[date].conversions += conversions;

    if (!campaigns[campaignId]) {
      campaigns[campaignId] = { id: campaignId, name: campaignName, status: String(row?.campaign?.status || ""), impressions: 0, clicks: 0, cost: 0, conversions: 0 };
    }
    campaigns[campaignId].impressions += impressions;
    campaigns[campaignId].clicks += clicks;
    campaigns[campaignId].cost += cost;
    campaigns[campaignId].conversions += conversions;

    summary.impressions += impressions;
    summary.clicks += clicks;
    summary.cost += cost;
    summary.conversions += conversions;
  }

  summary.ctr = summary.impressions > 0 ? roundNumber((summary.clicks / summary.impressions) * 100, 2) : 0;
  summary.cpc = summary.clicks > 0 ? roundNumber(summary.cost / summary.clicks, 2) : 0;
  summary.conversion_rate = summary.clicks > 0 ? roundNumber((summary.conversions / summary.clicks) * 100, 2) : 0;

  return {
    ok: true,
    rows_count: rows.length,
    summary: {
      impressions: Math.round(summary.impressions),
      clicks: Math.round(summary.clicks),
      cost: roundNumber(summary.cost, 2),
      conversions: roundNumber(summary.conversions, 2),
      ctr: summary.ctr,
      cpc: summary.cpc,
      conversion_rate: summary.conversion_rate,
    },
    campaigns: Object.values(campaigns).map((campaign) => ({
      ...campaign,
      impressions: Math.round(campaign.impressions),
      clicks: Math.round(campaign.clicks),
      cost: roundNumber(campaign.cost, 2),
      conversions: roundNumber(campaign.conversions, 2),
      ctr: campaign.impressions > 0 ? roundNumber((campaign.clicks / campaign.impressions) * 100, 2) : 0,
      cpc: campaign.clicks > 0 ? roundNumber(campaign.cost / campaign.clicks, 2) : 0,
    })).sort((a, b) => b.cost - a.cost).slice(0, 12),
    daily,
    diagnostics: [],
  };
}

async function fetchGa4Funnel(token = {}, propertyId = "", days = 30) {
  const propertyPath = String(propertyId || "").replace(/^properties\//, "");
  const baseBody = {
    dateRanges: [{ startDate: `${Math.max(7, Math.min(90, Number(days || 30)))}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "date" }],
    metrics: [
      { name: "sessions" },
      { name: "totalUsers" },
      { name: "screenPageViews" },
      { name: "eventCount" },
    ],
  };
  const dailyRequest = await googleJsonRequest(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyPath)}:runReport`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      body: JSON.stringify(baseBody),
    },
    "ga4_daily_funnel",
  );
  if (!dailyRequest.ok) {
    return { ok: false, summary: {}, daily: {}, top_pages: [], top_sources: [], diagnostics: [dailyRequest.diagnostic].filter(Boolean) };
  }

  const summary = { sessions: 0, users: 0, page_views: 0, event_count: 0 };
  const daily = {};
  for (const row of dailyRequest.body.rows || []) {
    const rawDate = String(row.dimensionValues?.[0]?.value || "");
    const date = rawDate.length === 8 ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : rawDate;
    const values = row.metricValues || [];
    const item = {
      date,
      sessions: toFiniteNumber(values[0]?.value),
      users: toFiniteNumber(values[1]?.value),
      page_views: toFiniteNumber(values[2]?.value),
      event_count: toFiniteNumber(values[3]?.value),
    };
    daily[date] = item;
    summary.sessions += item.sessions;
    summary.users += item.users;
    summary.page_views += item.page_views;
    summary.event_count += item.event_count;
  }

  const pageRequest = await googleJsonRequest(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyPath)}:runReport`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({
        dateRanges: baseBody.dateRanges,
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }, { name: "eventCount" }],
        limit: 10,
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      }),
    },
    "ga4_pages_funnel",
  );

  const sourceRequest = await googleJsonRequest(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyPath)}:runReport`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({
        dateRanges: baseBody.dateRanges,
        dimensions: [{ name: "sessionSourceMedium" }],
        metrics: [{ name: "sessions" }, { name: "eventCount" }],
        limit: 10,
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      }),
    },
    "ga4_sources_funnel",
  );

  const diagnostics = [pageRequest.diagnostic, sourceRequest.diagnostic].filter(Boolean);
  return {
    ok: true,
    summary: {
      sessions: Math.round(summary.sessions),
      users: Math.round(summary.users),
      page_views: Math.round(summary.page_views),
      event_count: Math.round(summary.event_count),
      pages_per_session: summary.sessions > 0 ? roundNumber(summary.page_views / summary.sessions, 2) : 0,
      events_per_session: summary.sessions > 0 ? roundNumber(summary.event_count / summary.sessions, 2) : 0,
    },
    daily,
    top_pages: (pageRequest.body?.rows || []).map((row) => ({
      path: String(row.dimensionValues?.[0]?.value || ""),
      page_views: Math.round(toFiniteNumber(row.metricValues?.[0]?.value)),
      event_count: Math.round(toFiniteNumber(row.metricValues?.[1]?.value)),
    })).filter((row) => row.path),
    top_sources: (sourceRequest.body?.rows || []).map((row) => ({
      source_medium: String(row.dimensionValues?.[0]?.value || ""),
      sessions: Math.round(toFiniteNumber(row.metricValues?.[0]?.value)),
      event_count: Math.round(toFiniteNumber(row.metricValues?.[1]?.value)),
    })).filter((row) => row.source_medium),
    diagnostics,
  };
}

function buildGoogleFunnelDiagnosis(ads = {}, ga4 = {}) {
  const adsSummary = ads.summary || {};
  const ga4Summary = ga4.summary || {};
  const findings = [];
  const actions = [];

  if (!ads.ok) {
    findings.push({ severity: "warning", area: "ads", message: "Google Ads non e leggibile in questo momento." });
    actions.push("Verificare token, developer token e permessi account Ads prima di giudicare le campagne.");
  }
  if (!ga4.ok) {
    findings.push({ severity: "warning", area: "ga4", message: "GA4 non e leggibile in questo momento." });
    actions.push("Verificare Analytics Data API e accesso alla proprieta GA4 prima di valutare comportamento sito.");
  }
  if (adsSummary.impressions > 0 && adsSummary.ctr < 1) {
    findings.push({ severity: "attention", area: "annuncio", message: "Le impressioni ci sono, ma il CTR e basso: il messaggio o il target potrebbero non agganciare abbastanza." });
    actions.push("Controllare headline, query e coerenza promessa-annuncio prima di aumentare budget.");
  }
  if (adsSummary.clicks > 0 && ga4Summary.sessions === 0) {
    findings.push({ severity: "critical", area: "tracking", message: "Ads registra clic, ma GA4 non registra sessioni collegate nel periodo: possibile problema di tracciamento o attribuzione." });
    actions.push("Verificare tag GA4, consenso cookie e landing page prima di leggere il funnel come affidabile.");
  }
  if (adsSummary.clicks > 0 && adsSummary.conversions === 0) {
    findings.push({ severity: "attention", area: "conversione", message: "Ci sono clic ma nessuna conversione Ads rilevata: il collo puo essere tracking conversioni, pagina o offerta." });
    actions.push("Controllare evento lead/form e conversion action Google Ads prima di scalare.");
  }
  if (ga4Summary.sessions > 0 && ga4Summary.pages_per_session < 1.25) {
    findings.push({ severity: "attention", area: "landing", message: "Le pagine per sessione sono basse: il traffico potrebbe non approfondire dopo l arrivo." });
    actions.push("Rivedere above-the-fold, CTA e continuita tra annuncio e pagina.");
  }
  if (!findings.length) {
    findings.push({ severity: "ok", area: "funnel", message: "Il funnel e leggibile: Ads e GA4 restituiscono dati utilizzabili per diagnosi operativa." });
    actions.push("Monitorare campagne e pagine migliori, poi decidere eventuale ottimizzazione solo su dati stabili.");
  }

  return {
    status: findings.some((item) => item.severity === "critical") ? "critical" : (findings.some((item) => item.severity === "attention" || item.severity === "warning") ? "needs_attention" : "readable"),
    principle: "Google/GA4 dicono cosa succede; Core ordina le priorita; Nyra traduce in azioni operative da confermare.",
    findings,
    recommended_actions: uniqueValues(actions),
    do_not_do: [
      "Non aumentare budget se conversion tracking o GA4 non sono affidabili.",
      "Non modificare campagne automaticamente dal connector.",
      "Non attribuire qualita lead se il lead non e collegato a fonte/campagna.",
    ],
  };
}

function buildGoogleFunnelCharts(days, ads = {}, ga4 = {}) {
  const labels = dateLabels(days);
  const adsDaily = ads.daily || {};
  const ga4Daily = ga4.daily || {};
  const adsSummary = ads.summary || {};
  const ga4Summary = ga4.summary || {};
  return {
    daily: {
      labels,
      impressions: labels.map((date) => Math.round(toFiniteNumber(adsDaily[date]?.impressions))),
      clicks: labels.map((date) => Math.round(toFiniteNumber(adsDaily[date]?.clicks))),
      cost: labels.map((date) => roundNumber(adsDaily[date]?.cost || 0, 2)),
      sessions: labels.map((date) => Math.round(toFiniteNumber(ga4Daily[date]?.sessions))),
      page_views: labels.map((date) => Math.round(toFiniteNumber(ga4Daily[date]?.page_views))),
      events: labels.map((date) => Math.round(toFiniteNumber(ga4Daily[date]?.event_count))),
    },
    funnel_steps: [
      { label: "Impressioni", value: Math.round(toFiniteNumber(adsSummary.impressions)) },
      { label: "Clic", value: Math.round(toFiniteNumber(adsSummary.clicks)) },
      { label: "Sessioni sito", value: Math.round(toFiniteNumber(ga4Summary.sessions)) },
      { label: "Eventi sito", value: Math.round(toFiniteNumber(ga4Summary.event_count)) },
      { label: "Conversioni Ads", value: roundNumber(adsSummary.conversions || 0, 2) },
    ],
    campaign_cost: (ads.campaigns || []).map((campaign) => ({ label: campaign.name, value: campaign.cost })),
    top_pages: (ga4.top_pages || []).map((page) => ({ label: page.path, value: page.page_views })),
    top_sources: (ga4.top_sources || []).map((source) => ({ label: source.source_medium, value: source.sessions })),
  };
}

function normalizeGoogleTokenResponse(tokenResponse = {}) {
  const expiresIn = Number(tokenResponse.expires_in || 0);
  return {
    access_token: String(tokenResponse.access_token || ""),
    refresh_token: String(tokenResponse.refresh_token || ""),
    token_type: String(tokenResponse.token_type || ""),
    scope: String(tokenResponse.scope || ""),
    expires_at: expiresIn > 0 ? addSecondsIso(expiresIn) : "",
  };
}

async function exchangeGoogleOAuthCode(providerConfig = {}, code = "") {
  const body = new URLSearchParams({
    code: String(code || ""),
    client_id: String(providerConfig.client_id || ""),
    client_secret: String(providerConfig.client_secret || ""),
    redirect_uri: String(providerConfig.redirect_uri || ""),
    grant_type: "authorization_code",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: json.error || "google_token_exchange_failed",
      error_description: json.error_description || "",
    };
  }
  return { ok: true, token: normalizeGoogleTokenResponse(json) };
}

async function refreshGoogleAccessToken(providerConfig = {}, connection = {}) {
  const token = connection.token && typeof connection.token === "object" ? connection.token : {};
  if (hasRuntimeValue(token.access_token) && isIsoAfterNow(token.expires_at)) {
    return { ok: true, token, refreshed: false };
  }
  if (!hasRuntimeValue(token.refresh_token)) {
    return { ok: false, error: "google_refresh_token_missing" };
  }
  const body = new URLSearchParams({
    client_id: String(providerConfig.client_id || ""),
    client_secret: String(providerConfig.client_secret || ""),
    refresh_token: String(token.refresh_token || ""),
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: json.error || "google_token_refresh_failed",
      diagnostics: [safeGoogleApiDiagnostic("google_token_refresh", response, json)],
    };
  }
  return {
    ok: true,
    refreshed: true,
    token: {
      ...token,
      ...normalizeGoogleTokenResponse(json),
      refresh_token: token.refresh_token,
    },
  };
}

async function fetchGoogleAccountOptions(providerConfig = {}, connection = {}) {
  const access = await refreshGoogleAccessToken(providerConfig, connection);
  if (!access.ok) {
    return {
      ok: false,
      token: connection.token || {},
      accounts: { google_ads_customers: [], ga4_properties: [] },
      error: access.error,
      diagnostics: access.diagnostics || [],
    };
  }
  const headers = { authorization: `Bearer ${access.token.access_token}` };
  const adsHeaders = {
    ...headers,
    "developer-token": String(providerConfig.developer_token || ""),
  };
  const accounts = { google_ads_customers: [], ga4_properties: [] };
  const errors = [];
  const diagnostics = [];

  try {
    const response = await fetch(`https://googleads.googleapis.com/${googleAdsApiVersion()}/customers:listAccessibleCustomers`, { headers: adsHeaders });
    const json = await response.json().catch(() => ({}));
    if (response.ok && Array.isArray(json.resourceNames)) {
      accounts.google_ads_customers = json.resourceNames.map((name) => String(name).replace(/^customers\//, ""));
    } else {
      errors.push("google_ads_customers_unavailable");
      diagnostics.push(safeGoogleApiDiagnostic("google_ads_customers", response, json));
    }
  } catch (error) {
    errors.push("google_ads_customers_unavailable");
    diagnostics.push(safeGoogleExceptionDiagnostic("google_ads_customers", error));
  }

  try {
    const response = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", { headers });
    const json = await response.json().catch(() => ({}));
    if (response.ok && Array.isArray(json.accountSummaries)) {
      accounts.ga4_properties = json.accountSummaries.flatMap((account) => (
        Array.isArray(account.propertySummaries)
          ? account.propertySummaries.map((property) => ({
            property: String(property.property || ""),
            display_name: String(property.displayName || ""),
            parent_account: String(account.account || ""),
          }))
          : []
      )).filter((property) => property.property);
    } else {
      errors.push("ga4_properties_unavailable");
      diagnostics.push(safeGoogleApiDiagnostic("ga4_properties", response, json));
    }
  } catch (error) {
    errors.push("ga4_properties_unavailable");
    diagnostics.push(safeGoogleExceptionDiagnostic("ga4_properties", error));
  }

  return { ok: errors.length === 0, token: access.token, accounts, errors, diagnostics, refreshed: access.refreshed };
}

function resolveGoogleProviderConfig(storedConfig = {}) {
  const publicBaseUrl = normalizeBaseUrl(process.env.SUITE_CONTROL_PLANE_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "");
  return {
    client_id: GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || storedConfig.client_id || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || storedConfig.client_secret || "",
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || storedConfig.developer_token || "",
    redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI || storedConfig.redirect_uri || (publicBaseUrl ? `${publicBaseUrl}/api/suite/integrations/google/oauth/callback` : ""),
    updated_at: storedConfig.updated_at || "",
  };
}

function buildSuiteRuntimeMapContract() {
  return {
    schema_version: "suite_runtime_map_contract_v1",
    service_version: SERVICE_VERSION,
    mode: "read_only_runtime_map",
    positioning: "WordPress Site Suite resta pannello cliente e nodo sito; Render Suite Control Plane diventa Data Engine per eventi, analytics, Core insight, code e multi-tenant.",
    render_routes: {
      contract: "/api/suite/runtime-map/contract",
      control_plane_dashboard: "/api/suite/control-plane/dashboard",
      tenant_dashboard: "/api/suite/tenants/:tenantId/dashboard",
      node_heartbeat: "/api/suite/nodes/heartbeat",
      node_snapshot: "/api/suite/nodes/snapshot",
      evidence: "/api/suite/evidence",
    },
    wordpress_keeps: SUITE_RUNTIME_WORDPRESS_KEEPS,
    render_moves: SUITE_RUNTIME_RENDER_MOVES,
    available_now: [
      "control_plane_dashboard",
      "tenant_dashboard",
      "node_heartbeat",
      "node_snapshot",
      "evidence_ledger",
      "core_bridge_status",
      "google_connector_contract",
      "runtime_map_contract",
    ],
    first_real_migration: {
      id: "analytics_event_spine",
      label: "Analytics WaaS + Event Spine + Core Insight",
      wordpress_role: "raccoglie eventi leggeri e mostra UI",
      render_role: "ordina eventi, conserva storico tenant-scoped, prepara dataset Core",
      core_role: "legge dataset e produce diagnosi/priorita/azioni da confermare",
      execution_allowed: false,
    },
    safety_policy: {
      no_customer_data_in_code: true,
      no_cross_tenant_read: true,
      no_automatic_checkout: true,
      no_automatic_campaign_write: true,
      owner_confirmation_required_for_actions: true,
      scoped_key_required: true,
    },
  };
}

function buildGoogleConnectorContract(storedProviderConfig = {}) {
  const resolvedProviderConfig = resolveGoogleProviderConfig(storedProviderConfig);
  const publicBaseUrl = normalizeBaseUrl(process.env.SUITE_CONTROL_PLANE_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "");
  const redirectUri = resolvedProviderConfig.redirect_uri || (publicBaseUrl ? `${publicBaseUrl}/api/suite/integrations/google/oauth/callback` : "");
  const provider = {
    client_id_configured: hasRuntimeValue(resolvedProviderConfig.client_id),
    client_secret_configured: hasRuntimeValue(resolvedProviderConfig.client_secret),
    developer_token_configured: hasRuntimeValue(resolvedProviderConfig.developer_token),
    redirect_uri: redirectUri,
    source: process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_ADS_DEVELOPER_TOKEN
      ? "render_environment"
      : (hasRuntimeValue(storedProviderConfig.client_id) || hasRuntimeValue(storedProviderConfig.client_secret) || hasRuntimeValue(storedProviderConfig.developer_token)
        ? "suite_provider_config"
        : "not_configured"),
  };
  const missingProviderFields = [
    ...(provider.client_id_configured ? [] : ["client_id"]),
    ...(provider.client_secret_configured ? [] : ["client_secret"]),
    ...(provider.developer_token_configured ? [] : ["developer_token"]),
    ...(provider.redirect_uri ? [] : ["redirect_uri"]),
  ];

  return {
    schema_version: "suite_google_connector_contract_v1",
    service_version: SERVICE_VERSION,
    mode: "oauth_ready_no_campaign_mutation",
    render_routes: {
      status: "/api/suite/integrations/google/status",
      connect: "/api/suite/integrations/google/connect",
      validate: "/api/suite/integrations/google/validate",
      callback: "/api/suite/integrations/google/oauth/callback",
    },
    provider,
    provider_ready: missingProviderFields.length === 0,
    missing_provider_fields: missingProviderFields,
    required_provider_fields: GOOGLE_CONNECTOR_REQUIRED_PROVIDER_FIELDS,
    required_tenant_fields: GOOGLE_CONNECTOR_REQUIRED_TENANT_FIELDS,
    customer_flow: [
      "click_connect_google",
      "google_login",
      "owner_or_tenant_admin_consent",
      "select_google_ads_customer",
      "select_ga4_property",
      "suite_reads_metrics",
      "core_ranks_actions",
    ],
    data_contract: {
      reads: [
        "campaign_name",
        "campaign_status",
        "cost",
        "clicks",
        "impressions",
        "conversions",
        "cost_per_lead",
        "ga4_sessions",
        "ga4_events",
        "landing_page_path",
      ],
      writes: [],
      normalized_output: {
        campaign_id: "string",
        source: "google_ads",
        landing_page_path: "string",
        spend: "number",
        clicks: "number",
        leads: "number",
        conversion_rate: "number",
        core_recommended_action: "hold|review|scale|pause|fix_page",
      },
    },
    safety_policy: {
      no_campaign_creation: true,
      no_budget_change: true,
      no_keyword_mutation: true,
      no_auto_publish: true,
      owner_confirmation_required_for_any_write: true,
      core_required_for_scale_or_pause: true,
      suite_is_ui_only: true,
    },
    scopes: GOOGLE_CONNECTOR_SCOPES,
    branches: [
      "paid_ads_guard",
      "funnel_conversion_guard",
      "customer_behavior_analysis",
      "claim_guard",
      "pricing_guard",
      "business_governance",
    ],
    next_action: missingProviderFields.length
      ? "Configurare credenziali provider Google dal pannello Suite Provider o da Render; il cliente vedra comunque il flusso semplice Collega Google."
      : "Abilitare OAuth reale e selezione account/proprieta per tenant.",
  };
}

function buildGoogleConnectorStatus(tenantId = "", storedProviderConfig = {}, tenantConnection = {}) {
  const contract = buildGoogleConnectorContract(storedProviderConfig);
  const tenantKey = sanitizeId(tenantId || "tenant_demo", "tenant");
  const simulatedAuthorized = String(process.env.GOOGLE_CONNECTOR_DEMO_CONNECTED || "").toLowerCase() === "true";
  const adsCustomerId = process.env.GOOGLE_ADS_CUSTOMER_ID || "";
  const ga4PropertyId = process.env.GA4_PROPERTY_ID || "";
  const maskedConnection = maskGoogleTenantConnection({
    tenant_id: tenantKey,
    ...(tenantConnection && typeof tenantConnection === "object" ? tenantConnection : {}),
  });
  const selectedAdsCustomerId = maskedConnection.selected_accounts.google_ads_customer_id || adsCustomerId;
  const selectedGa4PropertyId = maskedConnection.selected_accounts.ga4_property_id || ga4PropertyId;
  const tenantConnected = maskedConnection.connected || (simulatedAuthorized && Boolean(adsCustomerId || ga4PropertyId));
  const hasSelection = Boolean(selectedAdsCustomerId || selectedGa4PropertyId);

  return {
    ok: true,
    schema_version: "suite_google_connector_status_v1",
    service_version: SERVICE_VERSION,
    tenant_id: tenantKey,
    mode: contract.mode,
    provider_ready: contract.provider_ready,
    connected: tenantConnected,
    state: tenantConnected
      ? (hasSelection ? "connected" : "authorized_needs_account_selection")
      : (contract.provider_ready ? "ready_to_connect" : "provider_setup_required"),
    connect_url: `/api/suite/integrations/google/connect?tenant_id=${encodeURIComponent(tenantKey)}`,
    selected_accounts: {
      google_ads_customer_id_present: Boolean(selectedAdsCustomerId),
      ga4_property_id_present: Boolean(selectedGa4PropertyId),
      google_ads_customer_id: selectedAdsCustomerId,
      ga4_property_id: selectedGa4PropertyId,
    },
    capability: {
      can_read_google_ads: tenantConnected && Boolean(selectedAdsCustomerId),
      can_read_ga4: tenantConnected && Boolean(selectedGa4PropertyId),
      can_change_campaigns: false,
      can_change_budget: false,
    },
    owner_visible_copy: tenantConnected
      ? "Google collegato. Suite puo leggere campagne e Analytics; Core decide priorita e azioni consigliate."
      : "Google non collegato. Il cliente clicca Collega Google, accede e autorizza SkinHarmony.",
    missing_provider_fields: contract.missing_provider_fields,
    provider_config: maskGoogleProviderConfig(resolveGoogleProviderConfig(storedProviderConfig)),
    tenant_connection: maskedConnection,
    contract,
  };
}

function validateGoogleConnectorSetup(input = {}) {
  const errors = [];
  const warnings = [];
  const provider = input?.provider && typeof input.provider === "object" ? input.provider : {};
  const tenant = input?.tenant && typeof input.tenant === "object" ? input.tenant : {};

  for (const field of GOOGLE_CONNECTOR_REQUIRED_PROVIDER_FIELDS) {
    if (!hasRuntimeValue(provider[field])) {
      errors.push({ code: "google_provider_field_missing", field: `provider.${field}` });
    }
  }
  for (const field of GOOGLE_CONNECTOR_REQUIRED_TENANT_FIELDS) {
    if (!hasRuntimeValue(tenant[field])) {
      warnings.push({ code: "google_tenant_field_missing", field: `tenant.${field}` });
    }
  }
  if (input?.campaign_write_enabled === true || input?.budget_write_enabled === true) {
    errors.push({ code: "google_ads_write_not_allowed", field: "campaign_write_enabled" });
  }

  const allowed = errors.length === 0;
  return {
    schema: "suite_google_connector_validation_v1",
    allowed,
    status: allowed ? (warnings.length ? "review" : "allow") : "block",
    errors,
    warnings,
    execution_allowed: false,
  };
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderGoogleConnectPage(payload) {
  const missing = Array.isArray(payload.missing_provider_fields) ? payload.missing_provider_fields : [];
  const chips = missing.length
    ? missing.map((field) => `<span>${escapeHtml(field)}</span>`).join("")
    : "<span>provider_ready</span>";
  const stateLabel = payload.connected ? "Collegato" : (payload.provider_ready ? "Pronto per OAuth" : "Setup provider richiesto");
  const stateClass = payload.connected || payload.provider_ready ? "ok" : "wait";
  const cta = payload.oauth_url && !payload.connected
    ? `<p><a class="button" href="${escapeHtml(payload.oauth_url)}">Collega Google</a></p>`
    : "";

  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SkinHarmony Google Connector</title>
  <style>
    body{margin:0;background:#f6f8fb;color:#172033;font-family:Inter,Arial,sans-serif}
    main{min-height:100vh;display:grid;place-items:center;padding:32px}
    .panel{width:min(920px,100%);background:#fff;border:1px solid #dbe7f3;border-radius:18px;box-shadow:0 24px 80px rgba(23,32,51,.10);overflow:hidden}
    .head{padding:34px 38px;background:linear-gradient(135deg,#eef9fd,#ffffff 55%,#f6f0ff)}
    .kicker{font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#4b82bd}
    h1{margin:12px 0 10px;font-size:34px;line-height:1.05}
    p{margin:0;color:#5b6b80;font-size:16px;line-height:1.55}
    .body{padding:30px 38px;display:grid;gap:22px}
    .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
    .card{border:1px solid #dbe7f3;border-radius:14px;padding:18px;background:#fbfdff}
    .label{display:block;color:#728197;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px}
    .value{font-size:20px;font-weight:800;color:#1d365c}
    .value.ok{color:#257d55}.value.wait{color:#af6b00}
    .chips{display:flex;gap:8px;flex-wrap:wrap}
    .chips span{border:1px solid #cfe0f2;border-radius:999px;padding:8px 10px;background:#fff;color:#42566f;font-size:13px;font-weight:700}
    .notice{border:1px solid #f2d7a8;background:#fff8ea;border-radius:14px;padding:18px;color:#65470d}
    .button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:10px;background:#1d365c;color:#fff;text-decoration:none;font-weight:800;margin-top:14px}
    .rules{display:grid;gap:8px;margin:0;padding:0;list-style:none}
    .rules li{padding:10px 12px;border:1px solid #dbe7f3;border-radius:12px;background:#fff}
    .foot{display:flex;justify-content:space-between;gap:14px;align-items:center;padding:20px 38px;background:#f8fbfe;border-top:1px solid #dbe7f3}
    code{background:#eef3f8;border-radius:8px;padding:4px 7px}
    @media(max-width:760px){.grid{grid-template-columns:1fr}.head,.body,.foot{padding-left:22px;padding-right:22px}.foot{display:block}h1{font-size:28px}}
  </style>
</head>
<body>
<main>
  <section class="panel">
    <div class="head">
      <div class="kicker">SkinHarmony Suite Control Plane</div>
      <h1>Google Connector</h1>
      <p>${escapeHtml(payload.customer_action)}</p>
    </div>
    <div class="body">
      <div class="grid">
        <div class="card"><span class="label">Tenant</span><div class="value">${escapeHtml(payload.tenant_id)}</div></div>
        <div class="card"><span class="label">Stato</span><div class="value ${stateClass}">${stateLabel}</div></div>
        <div class="card"><span class="label">Esecuzione</span><div class="value wait">Solo setup</div></div>
      </div>
      <div class="notice">${escapeHtml(payload.next_action)}${cta}</div>
      <div>
        <span class="label">Campi provider mancanti</span>
        <div class="chips">${chips}</div>
      </div>
      <ul class="rules">
        <li>Nessuna API key Google viene chiesta al cliente.</li>
        <li>Nessuna campagna, budget o keyword viene modificata automaticamente.</li>
        <li>Le metriche verranno lette solo dopo OAuth e consenso.</li>
        <li>Core decide priorita e azioni consigliate; l owner conferma le azioni sensibili.</li>
      </ul>
    </div>
    <div class="foot">
      <span>Versione <code>${escapeHtml(payload.version)}</code></span>
      <span>Endpoint read-only</span>
    </div>
  </section>
</main>
</body>
</html>`;
}

function createMemoryStorage(options = {}) {
  const nodes = new Map((options.nodes || []).map((node) => [node.node_id, node]));
  const evidence = Array.isArray(options.evidence) ? options.evidence : [];
  const siteEvents = Array.isArray(options.siteEvents) ? options.siteEvents : [];
  const commerceSnapshots = Array.isArray(options.commerceSnapshots) ? options.commerceSnapshots : [];
  const dispatches = Array.isArray(options.dispatches) ? options.dispatches : [];
  const artifacts = Array.isArray(options.artifacts) ? options.artifacts : [];
  const googleTenantConnections = new Map(Object.entries(
    options.googleTenantConnections && typeof options.googleTenantConnections === "object"
      ? options.googleTenantConnections
      : {},
  ));
  const googleOAuthStates = new Map(Object.entries(
    options.googleOAuthStates && typeof options.googleOAuthStates === "object"
      ? options.googleOAuthStates
      : {},
  ));
  let googleProviderConfig = options.googleProviderConfig && typeof options.googleProviderConfig === "object"
    ? options.googleProviderConfig
    : {};
  const onChange = typeof options.onChange === "function" ? options.onChange : () => {};

  function emitChange() {
    onChange({
      nodes: Array.from(nodes.values()),
      evidence,
      siteEvents,
      commerceSnapshots,
      dispatches,
      artifacts,
      googleProviderConfig,
      googleTenantConnections: Object.fromEntries(googleTenantConnections),
      googleOAuthStates: Object.fromEntries(googleOAuthStates),
    });
  }

  function getOrCreateNode(nodeId, tenantId = "unknown") {
    const id = sanitizeId(nodeId, "node");
    if (!nodes.has(id)) {
      nodes.set(id, {
        node_id: id,
        tenant_id: sanitizeId(tenantId, "tenant"),
        first_seen_at: nowIso(),
        last_seen_at: null,
        status: "registered",
        runtime_mode: "remote",
        topology: "shared",
        heartbeat_count: 0,
        snapshot_count: 0,
        evidence_count: 0,
        latest_heartbeat: null,
        latest_snapshot: null,
        events: [],
      });
    }
    return nodes.get(id);
  }

  function appendNodeEvent(node, type, payload) {
    node.events.unshift({
      id: `${type}_${crypto.randomUUID()}`,
      type,
      created_at: nowIso(),
      payload,
    });

    if (node.events.length > DEFAULT_MAX_EVENTS_PER_NODE) {
      node.events.length = DEFAULT_MAX_EVENTS_PER_NODE;
    }
  }

  return {
    mode: "memory",
    heartbeat(payload) {
      const node = getOrCreateNode(payload.node_id, payload.tenant_id);
      node.tenant_id = sanitizeId(payload.tenant_id || node.tenant_id, "tenant");
      node.last_seen_at = nowIso();
      node.status = payload.status || "online";
      node.runtime_mode = payload.runtime_mode || node.runtime_mode;
      node.topology = payload.topology || node.topology;
      node.heartbeat_count += 1;
      node.latest_heartbeat = {
        received_at: node.last_seen_at,
        plugin_version: payload.plugin_version || null,
        wp_version: payload.wp_version || null,
        site_url: payload.site_url || null,
        capabilities: Array.isArray(payload.capabilities) ? payload.capabilities.map(String) : [],
        health: payload.health && typeof payload.health === "object" ? payload.health : {},
      },
      appendNodeEvent(node, "heartbeat", node.latest_heartbeat);
      emitChange();
      return node;
    },
    snapshot(payload) {
      const node = getOrCreateNode(payload.node_id, payload.tenant_id);
      node.snapshot_count += 1;
      node.last_seen_at = nowIso();
      node.latest_snapshot = {
        received_at: node.last_seen_at,
        summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
        control_plane: payload.control_plane && typeof payload.control_plane === "object" ? payload.control_plane : {},
        validation: payload.validation && typeof payload.validation === "object" ? payload.validation : {},
        change_impact_orchestration: payload.change_impact_orchestration && typeof payload.change_impact_orchestration === "object" ? payload.change_impact_orchestration : null,
      };
      appendNodeEvent(node, "snapshot", node.latest_snapshot);
      emitChange();
      return node;
    },
    evidence(payload) {
      const node = getOrCreateNode(payload.node_id, payload.tenant_id);
      const event = {
        id: `evidence_${crypto.randomUUID()}`,
        received_at: nowIso(),
        node_id: node.node_id,
        tenant_id: node.tenant_id,
        evidence_type: String(payload.evidence_type || "suite_event"),
        decision: payload.decision || null,
        risk: payload.risk || null,
        audit_id: payload.audit_id || null,
        payload: payload.payload && typeof payload.payload === "object" ? payload.payload : {},
      };
      evidence.unshift(event);
      node.evidence_count += 1;
      node.last_seen_at = event.received_at;
      appendNodeEvent(node, "evidence", event);
      emitChange();
      return { node, event };
    },
    siteEvent(payload) {
      const event = sanitizeSiteEvent(payload);
      const node = getOrCreateNode(event.node_id, event.tenant_id);
      event.node_id = node.node_id;
      event.tenant_id = node.tenant_id;
      siteEvents.unshift(event);
      if (siteEvents.length > 5000) siteEvents.length = 5000;
      node.last_seen_at = event.received_at;
      appendNodeEvent(node, "site_event", {
        id: event.id,
        received_at: event.received_at,
        event_type: event.event_type,
        path: event.path,
      });
      emitChange();
      return { node, event };
    },
    siteEventsSummary(tenantId, days = 30) {
      const tenantKey = sanitizeId(tenantId, "tenant");
      return summarizeSiteEvents(siteEvents.filter((event) => event.tenant_id === tenantKey), days);
    },
    commerceSnapshot(payload) {
      const snapshot = sanitizeCommerceSnapshot(payload);
      const node = getOrCreateNode(snapshot.node_id, snapshot.tenant_id);
      snapshot.node_id = node.node_id;
      snapshot.tenant_id = node.tenant_id;
      commerceSnapshots.unshift(snapshot);
      if (commerceSnapshots.length > 1000) commerceSnapshots.length = 1000;
      node.last_seen_at = snapshot.received_at;
      node.commerce_snapshot_count = (node.commerce_snapshot_count || 0) + 1;
      node.latest_commerce_snapshot = snapshot;
      appendNodeEvent(node, "commerce_snapshot", {
        id: snapshot.id,
        received_at: snapshot.received_at,
        summary: snapshot.summary,
      });
      emitChange();
      return { node, snapshot };
    },
    commerceSummary(tenantId) {
      const tenantKey = sanitizeId(tenantId, "tenant");
      return summarizeCommerceSnapshots(commerceSnapshots.filter((snapshot) => snapshot.tenant_id === tenantKey));
    },
    runbookCatalog() {
      return RUNBOOK_CATALOG;
    },
    googleProviderConfig() {
      return googleProviderConfig;
    },
    googleProviderConfigMasked() {
      return maskGoogleProviderConfig(resolveGoogleProviderConfig(googleProviderConfig));
    },
    saveGoogleProviderConfig(payload = {}) {
      const next = normalizeGoogleProviderConfig(payload, googleProviderConfig);
      googleProviderConfig = next;
      const event = {
        id: `google_provider_config_${crypto.randomUUID()}`,
        received_at: nowIso(),
        evidence_type: "google_provider_config_saved",
        decision: "provider_config_updated",
        risk: "medium",
        audit_id: null,
        payload: {
          provider_config: maskGoogleProviderConfig(resolveGoogleProviderConfig(next)),
          source: "suite_provider_panel",
        },
      };
      evidence.unshift(event);
      if (evidence.length > 1000) evidence.length = 1000;
      emitChange();
      return {
        saved: true,
        saved_at: next.updated_at,
        provider_config: maskGoogleProviderConfig(resolveGoogleProviderConfig(next)),
        evidence_id: event.id,
      };
    },
    createGoogleOAuthState(tenantId, payload = {}) {
      const tenantKey = sanitizeId(tenantId || "tenant_demo", "tenant");
      const state = buildGoogleOAuthState(tenantKey);
      googleOAuthStates.set(state, {
        state,
        tenant_id: tenantKey,
        created_at: nowIso(),
        expires_at: addSecondsIso(600),
        payload: payload && typeof payload === "object" ? payload : {},
      });
      emitChange();
      return googleOAuthStates.get(state);
    },
    consumeGoogleOAuthState(state) {
      const key = String(state || "");
      const record = googleOAuthStates.get(key);
      if (!record) return null;
      googleOAuthStates.delete(key);
      emitChange();
      if (!isIsoAfterNow(record.expires_at)) {
        return null;
      }
      return record;
    },
    googleTenantConnection(tenantId) {
      const tenantKey = sanitizeId(tenantId || "tenant_demo", "tenant");
      return googleTenantConnections.get(tenantKey) || null;
    },
    saveGoogleTenantConnection(tenantId, payload = {}) {
      const tenantKey = sanitizeId(tenantId || "tenant_demo", "tenant");
      const previous = googleTenantConnections.get(tenantKey) || {};
      const token = payload.token && typeof payload.token === "object" ? payload.token : previous.token || {};
      const selectedAccounts = payload.selected_accounts && typeof payload.selected_accounts === "object"
        ? payload.selected_accounts
        : previous.selected_accounts || {};
      const availableAccounts = payload.available_accounts && typeof payload.available_accounts === "object"
        ? payload.available_accounts
        : previous.available_accounts || {};
      const connection = {
        ...previous,
        tenant_id: tenantKey,
        connected: payload.connected !== undefined ? payload.connected === true : previous.connected === true,
        authorized_at: payload.authorized_at || previous.authorized_at || nowIso(),
        updated_at: nowIso(),
        token,
        selected_accounts: selectedAccounts,
        available_accounts: availableAccounts,
        last_error: payload.last_error || "",
        last_diagnostics: Array.isArray(payload.last_diagnostics) ? payload.last_diagnostics.slice(0, 6) : [],
      };
      googleTenantConnections.set(tenantKey, connection);
      const event = {
        id: `google_tenant_connection_${crypto.randomUUID()}`,
        received_at: nowIso(),
        evidence_type: "google_tenant_connection_saved",
        tenant_id: tenantKey,
        decision: "tenant_google_connected",
        risk: "medium",
        audit_id: null,
        payload: maskGoogleTenantConnection(connection),
      };
      evidence.unshift(event);
      if (evidence.length > 1000) evidence.length = 1000;
      emitChange();
      return maskGoogleTenantConnection(connection);
    },
    selectGoogleAccounts(tenantId, selection = {}) {
      const tenantKey = sanitizeId(tenantId || "tenant_demo", "tenant");
      const previous = googleTenantConnections.get(tenantKey);
      if (!previous) return null;
      const adsCustomerId = String(selection.google_ads_customer_id || selection.ads_customer_id || previous.selected_accounts?.google_ads_customer_id || "").trim();
      const ga4PropertyId = String(selection.ga4_property_id || selection.property_id || previous.selected_accounts?.ga4_property_id || "").trim();
      return this.saveGoogleTenantConnection(tenantKey, {
        ...previous,
        selected_accounts: {
          google_ads_customer_id: sanitizeGoogleAccountValue(adsCustomerId),
          ga4_property_id: sanitizeGoogleAccountValue(ga4PropertyId),
        },
      });
    },
    runbookPreview(payload) {
      const runbook = getRunbook(payload.runbook_id);
      if (!runbook) return null;
      const node = nodes.get(sanitizeId(payload.node_id, "node")) || null;
      return buildRunbookPreview(runbook, node);
    },
    runbookDispatch(payload) {
      const runbook = getRunbook(payload.runbook_id);
      if (!runbook) return null;
      const node = nodes.get(sanitizeId(payload.node_id, "node")) || null;
      const preview = buildRunbookPreview(runbook, node);
      const ownerConfirmed = payload.owner_confirmed === true || payload.owner_confirmed === "true" || payload.owner_confirmed === "yes";
      const accepted = preview.state === "ready_for_owner_confirmation"
        && (!runbook.owner_confirmation_required || ownerConfirmed);
      const dispatch = {
        id: `dispatch_${crypto.randomUUID()}`,
        created_at: nowIso(),
        runbook_id: runbook.id,
        node_id: node ? node.node_id : sanitizeId(payload.node_id, "node"),
        tenant_id: node ? node.tenant_id : sanitizeId(payload.tenant_id, "tenant"),
        state: accepted ? "queued_for_node_pull" : "not_queued",
        accepted,
        owner_confirmed: ownerConfirmed,
        execution_mode: runbook.execution_mode,
        risk: runbook.risk,
        preview,
        payload: payload.payload && typeof payload.payload === "object" ? payload.payload : {},
      };
      dispatches.unshift(dispatch);
      if (dispatches.length > 1000) dispatches.length = 1000;
      if (node) {
        appendNodeEvent(node, "runbook_dispatch", dispatch);
      }
      emitChange();
      return dispatch;
    },
    marketingJourneyDispatch(payload) {
      const node = getOrCreateNode(payload.node_id, payload.tenant_id);
      const body = payload.payload && typeof payload.payload === "object" ? payload.payload : {};
      const approvalQueue = Array.isArray(body.approval_queue) ? body.approval_queue : [];
      const ownerConfirmed = payload.owner_confirmed === true || payload.owner_confirmed === "true" || payload.owner_confirmed === "yes";
      const dispatch = {
        id: `marketing_dispatch_${crypto.randomUUID()}`,
        created_at: nowIso(),
        received_at: nowIso(),
        dispatch_type: sanitizeId(payload.dispatch_type || "marketing_journey_queue", "dispatch"),
        node_id: node.node_id,
        tenant_id: node.tenant_id,
        state: "queued_for_marketing_pull",
        accepted: true,
        owner_confirmed: ownerConfirmed,
        execution_allowed: false,
        execution_mode: "draft_approve_only",
        risk: "medium",
        source: sanitizeId(body.source || "wordpress_site_suite", "source"),
        suite_version: String(body.suite_version || "").slice(0, 40),
        schema_version: sanitizeId(body.schema_version || "suite_marketing_journey_builder_v1", "schema"),
        mode: sanitizeId(body.mode || "draft_approve_only", "mode"),
        source_event: sanitizeId(body.source_event || "manual_sync", "source_event"),
        core_branch_group: sanitizeId(body.core_branch_group || "marketing_intelligence", "branch"),
        journeys_count: Number.isFinite(Number(body.journeys_count)) ? Number(body.journeys_count) : 0,
        approval_queue_count: Number.isFinite(Number(body.approval_queue_count)) ? Number(body.approval_queue_count) : approvalQueue.length,
        approval_queue: approvalQueue.slice(0, 50).map((item) => ({
          id: sanitizeId(item?.id || "", "approval"),
          journey_id: sanitizeId(item?.journey_id || "", "journey"),
          label: String(item?.label || "").slice(0, 160),
          priority: sanitizeId(item?.priority || "media", "priority"),
          required_gate: sanitizeId(item?.required_gate || "core_marketing_intelligence_gate", "gate"),
          requires_owner_confirmation: true,
          execution_allowed: false,
        })),
        policy: {
          no_auto_send: true,
          no_ads_launch: true,
          owner_confirmation_required: true,
          raw_customer_records_stored: false,
          personal_data_payload: false,
        },
      };
      dispatches.unshift(dispatch);
      if (dispatches.length > 1000) dispatches.length = 1000;
      node.last_seen_at = dispatch.received_at;
      appendNodeEvent(node, "marketing_journey_dispatch", {
        id: dispatch.id,
        received_at: dispatch.received_at,
        dispatch_type: dispatch.dispatch_type,
        state: dispatch.state,
        journeys_count: dispatch.journeys_count,
        approval_queue_count: dispatch.approval_queue_count,
        execution_allowed: false,
      });
      emitChange();
      return { node, dispatch };
    },
    runbookArtifact(payload) {
      const node = getOrCreateNode(payload.node_id, payload.tenant_id);
      const artifact = {
        id: `artifact_${crypto.randomUUID()}`,
        received_at: nowIso(),
        node_id: node.node_id,
        tenant_id: node.tenant_id,
        runbook_id: sanitizeId(payload.runbook_id, "runbook"),
        artifact_type: sanitizeId(payload.artifact_type || "runbook_execution_record", "artifact_type"),
        signature: String(payload.signature || ""),
        source: String(payload.source || "wordpress_node"),
        payload: payload.payload && typeof payload.payload === "object" ? payload.payload : {},
      };
      artifacts.unshift(artifact);
      if (artifacts.length > 1000) artifacts.length = 1000;
      node.last_seen_at = artifact.received_at;
      node.runbook_artifact_count = (node.runbook_artifact_count || 0) + 1;
      appendNodeEvent(node, "runbook_artifact", artifact);
      emitChange();
      return { node, artifact };
    },
    runbookArtifacts(nodeId, limit = 50) {
      const id = sanitizeId(nodeId, "node");
      return artifacts.filter((item) => item.node_id === id).slice(0, limit);
    },
    dashboard(nodeId) {
      const node = nodes.get(sanitizeId(nodeId, "node"));
      if (!node) return null;
      return {
        node: {
          ...node,
          status: nodeStatus(node),
          heartbeat_fresh: nodeHeartbeatFresh(node),
        },
        recent_events: node.events.slice(0, 50),
        evidence: evidence.filter((item) => item.node_id === node.node_id).slice(0, 50),
        dispatches: dispatches.filter((item) => item.node_id === node.node_id).slice(0, 50),
        runbook_artifacts: artifacts.filter((item) => item.node_id === node.node_id).slice(0, 50),
      };
    },
    overview() {
      const allNodes = Array.from(nodes.values());
      return {
        nodes_total: allNodes.length,
        nodes_online: allNodes.filter((node) => nodeStatus(node) === "online").length,
        evidence_total: evidence.length,
        dispatches_total: dispatches.length,
        runbook_artifacts_total: artifacts.length,
        runbooks_total: RUNBOOK_CATALOG.length,
        nodes: allNodes
          .map((node) => ({
            node_id: node.node_id,
            tenant_id: node.tenant_id,
            status: nodeStatus(node),
            heartbeat_fresh: nodeHeartbeatFresh(node),
            last_seen_at: node.last_seen_at,
            heartbeat_count: node.heartbeat_count,
            snapshot_count: node.snapshot_count,
            evidence_count: node.evidence_count,
            runbook_artifact_count: node.runbook_artifact_count || 0,
          }))
          .sort((a, b) => String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || ""))),
      };
    },
    tenantDashboard(tenantId) {
      const tenantKey = sanitizeId(tenantId, "tenant");
      const tenantNodes = Array.from(nodes.values()).filter((node) => node.tenant_id === tenantKey);
      const tenantEvidence = evidence.filter((item) => item.tenant_id === tenantKey);
      const readiness = tenantNodes.map((node) => ({
        node_id: node.node_id,
        tenant_id: node.tenant_id,
        status: nodeStatus(node),
        heartbeat_fresh: nodeHeartbeatFresh(node),
        runtime_mode: node.runtime_mode,
        topology: node.topology,
        last_seen_at: node.last_seen_at,
        heartbeat_count: node.heartbeat_count,
        snapshot_count: node.snapshot_count,
        evidence_count: node.evidence_count,
        runbook_artifact_count: node.runbook_artifact_count || 0,
        commerce_snapshot_count: node.commerce_snapshot_count || 0,
        readiness: nodeReadiness(node),
      }));
      const blocked = readiness.filter((item) => item.readiness.status === "blocked").length;
      const warnings = readiness.filter((item) => item.readiness.status === "warning").length;
      const ready = readiness.filter((item) => item.readiness.status === "ready").length;
      return {
        tenant_id: tenantKey,
        generated_at: nowIso(),
        nodes_total: tenantNodes.length,
        nodes_online: tenantNodes.filter((node) => nodeStatus(node) === "online").length,
        site_events: this.siteEventsSummary(tenantKey, 30),
        commerce: this.commerceSummary(tenantKey),
        readiness_status: blocked ? "blocked" : warnings || !tenantNodes.length ? "warning" : "ready",
        readiness_summary: {
          ready,
          warning: warnings,
          blocked,
          average_score: readiness.length
            ? Math.round(readiness.reduce((sum, item) => sum + item.readiness.score, 0) / readiness.length)
            : 0,
        },
        next_actions: uniqueValues(readiness.flatMap((item) => item.readiness.next_actions)),
        nodes: readiness.sort((a, b) => String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || ""))),
        evidence: summarizeEvidence(tenantEvidence),
      };
    },
    controlPlaneDashboard() {
      const tenantIds = uniqueValues(Array.from(nodes.values()).map((node) => node.tenant_id));
      const tenants = tenantIds.map((tenantId) => this.tenantDashboard(tenantId));
      const blocked = tenants.filter((tenant) => tenant.readiness_status === "blocked").length;
      const warnings = tenants.filter((tenant) => tenant.readiness_status === "warning").length;
      const ready = tenants.filter((tenant) => tenant.readiness_status === "ready").length;
      return {
        generated_at: nowIso(),
        mode: "control_plane_first",
        execution_allowed: false,
        positioning: "Suite Control Plane read-only: stato tenant, nodi, Core bridge, evidence e readiness senza esecuzione automatica.",
        totals: {
          tenants: tenants.length,
          nodes: Array.from(nodes.values()).length,
          evidence: evidence.length,
          ready,
          warning: warnings,
          blocked,
        },
        next_actions: uniqueValues(tenants.flatMap((tenant) => tenant.next_actions)),
        tenants,
      };
    }

  };
}

function createSuiteControlStorage() {
  const storageRoot = process.env.SUITE_CONTROL_STORAGE_ROOT || "";
  if (!storageRoot) return createMemoryStorage();

  fs.mkdirSync(storageRoot, { recursive: true });
  const stateFile = path.join(storageRoot, "suite-control-state.json");
  let initialState = {
    nodes: [],
    evidence: [],
    site_events: [],
    commerce_snapshots: [],
    dispatches: [],
    artifacts: [],
    google_provider_config: {},
    google_tenant_connections: {},
    google_oauth_states: {},
  };
  if (fs.existsSync(stateFile)) {
    try {
      initialState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
      initialState = {
        nodes: [],
        evidence: [],
        site_events: [],
        commerce_snapshots: [],
        dispatches: [],
        artifacts: [],
        google_provider_config: {},
        google_tenant_connections: {},
        google_oauth_states: {},
      };
    }
  }

  const storage = createMemoryStorage({
    nodes: Array.isArray(initialState.nodes) ? initialState.nodes : [],
    evidence: Array.isArray(initialState.evidence) ? initialState.evidence : [],
    siteEvents: Array.isArray(initialState.site_events) ? initialState.site_events : [],
    commerceSnapshots: Array.isArray(initialState.commerce_snapshots) ? initialState.commerce_snapshots : [],
    dispatches: Array.isArray(initialState.dispatches) ? initialState.dispatches : [],
    artifacts: Array.isArray(initialState.artifacts) ? initialState.artifacts : [],
    googleProviderConfig: initialState.google_provider_config && typeof initialState.google_provider_config === "object" ? initialState.google_provider_config : {},
    googleTenantConnections: initialState.google_tenant_connections && typeof initialState.google_tenant_connections === "object" ? initialState.google_tenant_connections : {},
    googleOAuthStates: initialState.google_oauth_states && typeof initialState.google_oauth_states === "object" ? initialState.google_oauth_states : {},
    onChange(state) {
      const tmpFile = `${stateFile}.tmp`;
      fs.writeFileSync(tmpFile, `${JSON.stringify({
        saved_at: nowIso(),
        nodes: state.nodes,
        evidence: state.evidence.slice(0, 1000),
        site_events: state.siteEvents.slice(0, 5000),
        commerce_snapshots: state.commerceSnapshots.slice(0, 1000),
        dispatches: state.dispatches.slice(0, 1000),
        artifacts: state.artifacts.slice(0, 1000),
        google_provider_config: state.googleProviderConfig || {},
        google_tenant_connections: state.googleTenantConnections || {},
        google_oauth_states: state.googleOAuthStates || {},
      }, null, 2)}\n`);
      fs.renameSync(tmpFile, stateFile);
    },
  });
  storage.mode = "file";
  storage.state_file = stateFile;
  return storage;
}

function createAuth() {
  const configuredKey = process.env.SUITE_CONTROL_PLANE_API_KEY || "";
  const devKey = process.env.NODE_ENV === "production" ? "" : "dev-suite-control-plane-key";
  const expected = configuredKey || devKey;

  return (req, res, next) => {
    if (!expected) return publicError(res, 503, "suite_control_plane_key_not_configured");
    if (readSecret(req) !== expected) return publicError(res, 401, "suite_control_plane_key_invalid");
    return next();
  };
}

function createUniversalCoreClient(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.UNIVERSAL_CORE_URL);
  const apiKey = String(options.apiKey || process.env.UNIVERSAL_CORE_KEY || "").trim();
  const defaultTenantId = sanitizeId(options.tenantId || process.env.UNIVERSAL_CORE_TENANT_ID || "suite-control-plane", "tenant");
  const timeoutMs = Number(options.timeoutMs || process.env.UNIVERSAL_CORE_TIMEOUT_MS || 8000);

  async function request(method, route, body, tenantId = defaultTenantId) {
    if (!baseUrl || !apiKey) {
      return { success: false, code: "universal_core_not_configured", core_route_path: route };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}${route}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          "x-sh-tenant-id": tenantId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text };
      }
      return {
        success: response.ok && json.ok !== false,
        http_status: response.status,
        provider_url: baseUrl,
        core_route_path: route,
        ...json,
      };
    } catch (error) {
      return {
        success: false,
        code: error?.name === "AbortError" ? "universal_core_timeout" : "universal_core_unreachable",
        provider_url: baseUrl,
        core_route_path: route,
        message: error instanceof Error ? error.message : "Universal Core non raggiungibile.",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function shouldTryLegacyRoute(result = {}) {
    const status = Number(result.http_status || 0);
    return [404, 405, 410, 501].includes(status) || ["not_found", "route_not_found", "endpoint_not_found"].includes(String(result.code || result.error || ""));
  }

  function toActionEvaluatorPayload(payload = {}, tenantId = defaultTenantId) {
    const action = payload.action && typeof payload.action === "object" ? payload.action : payload;
    return {
      tenant_id: sanitizeId(payload.tenant_id || action.tenant_id || tenantId, "tenant"),
      action_type: sanitizeId(action.action_type || payload.action_type || "workflow_decision", "action"),
      action_label: String(action.label || action.action_label || payload.action_label || action.id || "Suite action mediation").slice(0, 180),
      risk_hint: Number(action.risk_hint ?? payload.risk_hint ?? 45),
      publish_intent: payload.publish_intent === true || action.publish_intent === true,
      context: {
        ...(payload.context && typeof payload.context === "object" ? payload.context : {}),
        suite_policy: payload.policy || {},
        original_action: action,
      },
    };
  }

  async function requestWithFallback(method, routes, body, tenantId = defaultTenantId) {
    const attempts = [];
    let lastResult = null;
    for (const route of routes) {
      const candidate = typeof route === "string" ? { label: route, path: route, payload: body } : route;
      const result = await request(method, candidate.path, candidate.payload === undefined ? body : candidate.payload, tenantId);
      const attempt = {
        label: candidate.label || candidate.path,
        path: candidate.path,
        success: result.success === true,
        http_status: result.http_status || 0,
        code: result.code || result.error || "",
      };
      attempts.push(attempt);
      lastResult = {
        ...result,
        core_route: candidate.label || candidate.path,
        core_route_path: candidate.path,
        core_route_attempts: attempts,
      };
      if (result.success || !shouldTryLegacyRoute(result)) {
        return lastResult;
      }
    }
    return lastResult || { success: false, code: "universal_core_route_unavailable", core_route_attempts: attempts };
  }

  return {
    isConfigured: () => Boolean(baseUrl && apiKey),
    status: () => ({
      configured: Boolean(baseUrl && apiKey),
      provider_url: baseUrl,
      tenant_id: defaultTenantId,
      routes: {
        action_evaluator: "/v1/action-evaluator",
        action_mediation: "/v1/action-evaluator",
        legacy_action_mediation: "/v1/action-mediation/evaluate",
      },
    }),
    customerIntelligenceContract: (tenantId = defaultTenantId) => request("GET", `/v1/customer-intelligence/contract?tenant_id=${encodeURIComponent(tenantId)}`, undefined, tenantId),
    customerIntelligenceReadiness: (payload = {}, tenantId = defaultTenantId) => request("POST", "/v1/customer-intelligence/readiness", {
      tenant_id: tenantId,
      events: Array.isArray(payload.events) ? payload.events : [],
      consents: Array.isArray(payload.consents) ? payload.consents : [],
      customer_profile: payload.customer_profile || payload.customerProfile || {},
    }, tenantId),
    actionMediation: (tenantId = defaultTenantId, payload = {}) => requestWithFallback("POST", [
      { label: "action_evaluator", path: "/v1/action-evaluator", payload: toActionEvaluatorPayload(payload, tenantId) },
      { label: "legacy_action_mediation", path: "/v1/action-mediation/evaluate", payload },
    ], payload, tenantId),
  };
}

export function createSuiteControlPlane(options = {}) {
  const app = express();
  const storage = options.storage || createSuiteControlStorage();
  const coreClient = options.coreClient || createUniversalCoreClient(options.universalCore || {});
  const auth = createAuth();

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      service: "skinharmony-suite-control-plane",
      version: SERVICE_VERSION,
      storage_mode: storage.mode,
      storage_persistent: storage.mode === "file",
      node_liveness: {
        stale_after_ms: NODE_STALE_AFTER_MS,
        stale_after_minutes: Number((NODE_STALE_AFTER_MS / 60000).toFixed(1)),
      },
      universal_core: coreClient.status(),
      generated_at: nowIso(),
    });
  });

  app.get("/api/suite/overview", auth, (req, res) => {
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      overview: storage.overview(),
    });
  });


  app.get("/api/suite/control-plane/dashboard", auth, (req, res) => {
    const dashboard = storage.controlPlaneDashboard();
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      dashboard: {
        ...dashboard,
        tenants: dashboard.tenants.map((tenant) => ({
          ...tenant,
          core_bridge: coreClient.status(),
        })),
      },
    });
  });

  app.get("/api/suite/tenants/:tenantId/dashboard", auth, (req, res) => {
    const dashboard = storage.tenantDashboard(req.params.tenantId);
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      dashboard: {
        ...dashboard,
        core_bridge: coreClient.status(),
      },
    });
  });

  app.get("/api/suite/runtime-map/contract", auth, (req, res) => {
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      contract: buildSuiteRuntimeMapContract(),
    });
  });

  app.get("/api/suite/nyra/branch-map", auth, (req, res) => {
    const branchMap = loadNyraSuiteBranchMap();
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "nyra_suite_branch_map_read_only",
      execution_allowed: false,
      owner_confirmation_required: true,
      branch_count: branchMap.branch_keys.length,
      branch_keys: branchMap.branch_keys,
      branch_map: branchMap,
      safety_policy: {
        no_auto_execute: true,
        no_customer_raw_data_required: true,
        core_required_for_sensitive_actions: true,
        owner_confirmation_required_for_writes: true,
      },
    });
  });

  app.get("/api/suite/ecosystem/tracks", auth, (req, res) => {
    const overview = storage.overview();
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      tracks: buildEcosystemTracks(overview, storage.runbookCatalog(), coreClient.status()),
    });
  });

  app.post("/api/suite/nodes/heartbeat", auth, (req, res) => {
    const node = storage.heartbeat(req.body || {});
    res.json({
      ok: true,
      accepted: true,
      node_id: node.node_id,
      tenant_id: node.tenant_id,
      status: node.status,
      received_at: node.last_seen_at,
    });
  });

  app.post("/api/suite/nodes/snapshot", auth, (req, res) => {
    const node = storage.snapshot(req.body || {});
    res.json({
      ok: true,
      accepted: true,
      node_id: node.node_id,
      tenant_id: node.tenant_id,
      snapshot_count: node.snapshot_count,
      received_at: node.last_seen_at,
    });
  });

  app.post("/api/suite/evidence", auth, (req, res) => {
    const { node, event } = storage.evidence(req.body || {});
    res.json({
      ok: true,
      accepted: true,
      node_id: node.node_id,
      tenant_id: node.tenant_id,
      evidence_id: event.id,
      received_at: event.received_at,
    });
  });

  app.post("/api/suite/events/ingest", auth, (req, res) => {
    const { node, event } = storage.siteEvent(req.body || {});
    res.json({
      ok: true,
      accepted: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      tenant_id: node.tenant_id,
      node_id: node.node_id,
      event_id: event.id,
      event_type: event.event_type,
      received_at: event.received_at,
      privacy: event.privacy,
    });
  });

  app.get("/api/suite/tenants/:tenantId/events/summary", auth, (req, res) => {
    const days = Math.max(1, Math.min(90, Number(req.query.days || 30)));
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      tenant_id: sanitizeId(req.params.tenantId, "tenant"),
      summary: storage.siteEventsSummary(req.params.tenantId, days),
    });
  });

  app.get("/api/suite/tenants/:tenantId/analytics/action-plan", auth, (req, res) => {
    const days = Math.max(1, Math.min(90, Number(req.query.days || 30)));
    const summary = storage.siteEventsSummary(req.params.tenantId, days);
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      tenant_id: sanitizeId(req.params.tenantId, "tenant"),
      action_plan: buildAnalyticsActionPlan(summary),
    });
  });

  app.post("/api/suite/commerce/snapshot", auth, (req, res) => {
    const { node, snapshot } = storage.commerceSnapshot(req.body || {});
    res.json({
      ok: true,
      accepted: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "commerce_snapshot_receiver",
      execution_allowed: false,
      tenant_id: node.tenant_id,
      node_id: node.node_id,
      snapshot_id: snapshot.id,
      received_at: snapshot.received_at,
      privacy: snapshot.privacy,
    });
  });

  app.post("/api/suite/marketing/journeys/dispatch", auth, (req, res) => {
    const { node, dispatch } = storage.marketingJourneyDispatch(req.body || {});
    res.json({
      ok: true,
      accepted: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "marketing_journey_dispatch_receiver",
      execution_allowed: false,
      tenant_id: node.tenant_id,
      node_id: node.node_id,
      dispatch,
      received_at: dispatch.received_at,
      privacy: {
        aggregate_only: true,
        raw_customer_records_stored: false,
        personal_data_payload: false,
      },
      safety_policy: {
        no_auto_send: true,
        no_ads_launch: true,
        owner_confirmation_required: true,
      },
    });
  });

  app.get("/api/suite/tenants/:tenantId/commerce/summary", auth, (req, res) => {
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      tenant_id: sanitizeId(req.params.tenantId, "tenant"),
      summary: storage.commerceSummary(req.params.tenantId),
    });
  });

  app.get("/api/suite/runbooks", auth, (req, res) => {
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      runbooks: storage.runbookCatalog(),
    });
  });

  app.get("/api/suite/integrations/google/status", auth, (req, res) => {
    const tenantId = req.query.tenant_id || req.get("x-sh-tenant-id") || "";
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      google: buildGoogleConnectorStatus(tenantId, storage.googleProviderConfig(), storage.googleTenantConnection(tenantId)),
    });
  });

  app.get("/api/suite/integrations/google/provider-config", auth, (req, res) => {
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      provider_config: storage.googleProviderConfigMasked(),
      required_fields: GOOGLE_PROVIDER_CONFIG_FIELDS,
      message: "Configurazione provider salvata lato Suite Control Plane. I segreti non vengono restituiti.",
    });
  });

  app.post("/api/suite/integrations/google/provider-config", auth, (req, res) => {
    const provider = req.body?.provider && typeof req.body.provider === "object" ? req.body.provider : req.body || {};
    const validation = validateGoogleConnectorSetup({
      provider,
      tenant: {
        tenant_id: "provider_config",
        google_user_authorized: true,
        ads_customer_id: "provider_setup",
        ga4_property_id: "provider_setup",
      },
    });
    if (!validation.allowed) {
      return res.status(409).json({
        ok: false,
        service: "suite_control_plane",
        version: SERVICE_VERSION,
        error: "google_provider_config_invalid",
        validation,
      });
    }
    const saved = storage.saveGoogleProviderConfig(provider);
    return res.status(201).json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "google_provider_config_saved",
      execution_allowed: false,
      ...saved,
    });
  });

  app.get("/api/suite/integrations/google/connect", (req, res) => {
    const tenantId = sanitizeId(req.query.tenant_id || req.get("x-sh-tenant-id") || "tenant_demo", "tenant");
    const status = buildGoogleConnectorStatus(tenantId, storage.googleProviderConfig(), storage.googleTenantConnection(tenantId));
    const payload = {
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "google_oauth_connect",
      tenant_id: tenantId,
      customer_action: "Il cliente clicca Collega Google, fa login e autorizza SkinHarmony. Nessuna API key viene chiesta al cliente.",
      provider_ready: status.provider_ready,
      connected: status.connected,
      state: status.state,
      oauth_start_ready: status.provider_ready,
      oauth_url: status.provider_ready ? `/api/suite/integrations/google/oauth/start?tenant_id=${encodeURIComponent(tenantId)}` : "",
      missing_provider_fields: status.missing_provider_fields,
      execution_allowed: false,
      next_action: status.provider_ready
        ? (status.connected ? "Google autorizzato. Selezionare account Google Ads e proprieta GA4 dal pannello protetto." : "Cliccare Collega Google per avviare OAuth reale.")
        : "Configurare Google Client ID, Client Secret, Developer Token e Redirect URI dal pannello Suite Provider.",
    };
    const acceptsHtml = String(req.get("accept") || "").includes("text/html");
    if (acceptsHtml) {
      return res.type("html").send(renderGoogleConnectPage(payload));
    }
    return res.json(payload);
  });

  app.get("/api/suite/integrations/google/oauth/start", (req, res) => {
    const tenantId = sanitizeId(req.query.tenant_id || req.get("x-sh-tenant-id") || "tenant_demo", "tenant");
    const provider = resolveGoogleProviderConfig(storage.googleProviderConfig());
    const status = buildGoogleConnectorStatus(tenantId, storage.googleProviderConfig(), storage.googleTenantConnection(tenantId));
    if (!status.provider_ready) {
      return publicError(res, 409, "google_provider_not_ready", "Configurazione provider Google incompleta.");
    }
    const stateRecord = storage.createGoogleOAuthState(tenantId, {
      source: "google_oauth_start",
      user_agent: String(req.get("user-agent") || "").slice(0, 180),
    });
    const oauthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    oauthUrl.searchParams.set("client_id", provider.client_id);
    oauthUrl.searchParams.set("redirect_uri", provider.redirect_uri);
    oauthUrl.searchParams.set("response_type", "code");
    oauthUrl.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
    oauthUrl.searchParams.set("access_type", "offline");
    oauthUrl.searchParams.set("prompt", "consent");
    oauthUrl.searchParams.set("include_granted_scopes", "true");
    oauthUrl.searchParams.set("state", stateRecord.state);

    if (req.query.format === "json") {
      return res.json({
        ok: true,
        service: "suite_control_plane",
        version: SERVICE_VERSION,
        tenant_id: tenantId,
        redirect_url: oauthUrl.toString(),
        expires_at: stateRecord.expires_at,
      });
    }
    return res.redirect(302, oauthUrl.toString());
  });

  app.get("/api/suite/integrations/google/oauth/callback", async (req, res) => {
    const stateRecord = storage.consumeGoogleOAuthState(req.query.state);
    const wantsJson = String(req.get("accept") || "").includes("application/json") || req.query.format === "json";
    if (!stateRecord) {
      const payload = { ok: false, error: "google_oauth_state_invalid_or_expired" };
      return wantsJson ? res.status(400).json(payload) : res.status(400).type("html").send(renderGoogleConnectPage({
        ...payload,
        version: SERVICE_VERSION,
        tenant_id: "unknown",
        customer_action: "OAuth Google non completato: sessione scaduta o non valida.",
        provider_ready: true,
        connected: false,
        missing_provider_fields: [],
        oauth_url: "/api/suite/integrations/google/connect?tenant_id=tenant_demo",
        next_action: "Tornare in Suite e riavviare Collega Google.",
      }));
    }
    if (req.query.error) {
      const payload = { ok: false, error: "google_oauth_denied", google_error: String(req.query.error || "") };
      return wantsJson ? res.status(400).json(payload) : res.status(400).type("html").send(renderGoogleConnectPage({
        ...payload,
        version: SERVICE_VERSION,
        tenant_id: stateRecord.tenant_id,
        customer_action: "OAuth Google non autorizzato.",
        provider_ready: true,
        connected: false,
        missing_provider_fields: [],
        oauth_url: `/api/suite/integrations/google/oauth/start?tenant_id=${encodeURIComponent(stateRecord.tenant_id)}`,
        next_action: "Autorizzare l accesso Google per collegare Ads e Analytics.",
      }));
    }
    const provider = resolveGoogleProviderConfig(storage.googleProviderConfig());
    const exchange = await exchangeGoogleOAuthCode(provider, req.query.code);
    if (!exchange.ok) {
      const payload = { ok: false, error: exchange.error || "google_token_exchange_failed" };
      return wantsJson ? res.status(502).json(payload) : res.status(502).type("html").send(renderGoogleConnectPage({
        ...payload,
        version: SERVICE_VERSION,
        tenant_id: stateRecord.tenant_id,
        customer_action: "OAuth Google ricevuto, ma lo scambio token non e riuscito.",
        provider_ready: true,
        connected: false,
        missing_provider_fields: [],
        oauth_url: `/api/suite/integrations/google/oauth/start?tenant_id=${encodeURIComponent(stateRecord.tenant_id)}`,
        next_action: "Verificare redirect URI e credenziali provider Google, poi riprovare.",
      }));
    }
    const connection = {
      connected: true,
      authorized_at: nowIso(),
      token: exchange.token,
      selected_accounts: {},
      available_accounts: { google_ads_customers: [], ga4_properties: [] },
    };
    const accountOptions = await fetchGoogleAccountOptions(provider, connection);
    const saved = storage.saveGoogleTenantConnection(stateRecord.tenant_id, {
      ...connection,
      token: accountOptions.token || connection.token,
      available_accounts: accountOptions.accounts || connection.available_accounts,
      last_error: accountOptions.ok ? "" : uniqueValues(accountOptions.errors || [accountOptions.error]).join(","),
      last_diagnostics: accountOptions.diagnostics || [],
    });
    const payload = {
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "google_oauth_callback_completed",
      tenant_id: stateRecord.tenant_id,
      connection: saved,
      execution_allowed: false,
      next_action: "Selezionare account Google Ads e proprieta GA4 dal pannello protetto.",
    };
    return wantsJson ? res.status(201).json(payload) : res.type("html").send(renderGoogleConnectPage({
      ...payload,
      customer_action: "Google autorizzato per SkinHarmony Suite.",
      provider_ready: true,
      connected: true,
      missing_provider_fields: [],
    }));
  });

  app.get("/api/suite/integrations/google/accounts", auth, async (req, res) => {
    const tenantId = sanitizeId(req.query.tenant_id || req.get("x-sh-tenant-id") || "tenant_demo", "tenant");
    const connection = storage.googleTenantConnection(tenantId);
    if (!connection || connection.connected !== true) {
      return publicError(res, 409, "google_tenant_not_connected", "Tenant Google non ancora collegato.");
    }
    const provider = resolveGoogleProviderConfig(storage.googleProviderConfig());
    const accountOptions = await fetchGoogleAccountOptions(provider, connection);
    const saved = storage.saveGoogleTenantConnection(tenantId, {
      ...connection,
      token: accountOptions.token || connection.token,
      available_accounts: accountOptions.accounts || connection.available_accounts,
      last_error: accountOptions.ok ? "" : uniqueValues(accountOptions.errors || [accountOptions.error]).join(","),
      last_diagnostics: accountOptions.diagnostics || [],
    });
    return res.status(accountOptions.ok ? 200 : 207).json({
      ok: accountOptions.ok,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      tenant_id: tenantId,
      accounts: saved.available_accounts,
      connection: saved,
      errors: accountOptions.errors || (accountOptions.error ? [accountOptions.error] : []),
      diagnostics: accountOptions.diagnostics || [],
    });
  });

  app.post("/api/suite/integrations/google/accounts/select", auth, (req, res) => {
    const tenantId = sanitizeId(req.body?.tenant_id || req.query.tenant_id || req.get("x-sh-tenant-id") || "tenant_demo", "tenant");
    const saved = storage.selectGoogleAccounts(tenantId, req.body || {});
    if (!saved) {
      return publicError(res, 409, "google_tenant_not_connected", "Tenant Google non ancora collegato.");
    }
    return res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "google_accounts_selected",
      tenant_id: tenantId,
      connection: saved,
      google: buildGoogleConnectorStatus(tenantId, storage.googleProviderConfig(), storage.googleTenantConnection(tenantId)),
      execution_allowed: false,
    });
  });

  app.get("/api/suite/integrations/google/funnel/overview", auth, async (req, res) => {
    const tenantId = sanitizeId(req.query.tenant_id || req.get("x-sh-tenant-id") || "tenant_demo", "tenant");
    const days = Math.max(7, Math.min(90, Number(req.query.days || 30)));
    const connection = storage.googleTenantConnection(tenantId);
    if (!connection || connection.connected !== true) {
      return publicError(res, 409, "google_tenant_not_connected", "Tenant Google non ancora collegato.");
    }
    const selected = connection.selected_accounts && typeof connection.selected_accounts === "object" ? connection.selected_accounts : {};
    const adsCustomerId = sanitizeGoogleAccountValue(selected.google_ads_customer_id || "");
    const ga4PropertyId = sanitizeGoogleAccountValue(selected.ga4_property_id || "");
    if (!adsCustomerId && !ga4PropertyId) {
      return publicError(res, 409, "google_accounts_not_selected", "Selezionare almeno account Google Ads o proprieta GA4.");
    }

    const provider = resolveGoogleProviderConfig(storage.googleProviderConfig());
    const access = await refreshGoogleAccessToken(provider, connection);
    if (!access.ok) {
      return res.status(502).json({
        ok: false,
        service: "suite_control_plane",
        version: SERVICE_VERSION,
        tenant_id: tenantId,
        error: access.error || "google_token_refresh_failed",
        diagnostics: access.diagnostics || [],
      });
    }

    const ads = adsCustomerId
      ? await fetchGoogleAdsFunnel(provider, access.token, adsCustomerId, days)
      : { ok: false, skipped: true, summary: {}, campaigns: [], daily: {}, diagnostics: [] };
    const ga4 = ga4PropertyId
      ? await fetchGa4Funnel(access.token, ga4PropertyId, days)
      : { ok: false, skipped: true, summary: {}, daily: {}, top_pages: [], top_sources: [], diagnostics: [] };
    const diagnosis = buildGoogleFunnelDiagnosis(ads, ga4);
    const charts = buildGoogleFunnelCharts(days, ads, ga4);

    storage.saveGoogleTenantConnection(tenantId, {
      ...connection,
      token: access.token,
      last_error: ads.ok || ga4.ok ? "" : "google_funnel_unavailable",
      last_diagnostics: [...(ads.diagnostics || []), ...(ga4.diagnostics || [])],
    });

    return res.status(ads.ok || ga4.ok ? 200 : 207).json({
      ok: ads.ok || ga4.ok,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      schema_version: "suite_google_funnel_overview_v1",
      mode: "read_only_marketing_funnel_intelligence",
      tenant_id: tenantId,
      generated_at: nowIso(),
      period: { days, google_ads_range: googleDateRange(days), ga4_start_date: `${days}daysAgo`, ga4_end_date: "today" },
      selected_accounts: {
        google_ads_customer_id: adsCustomerId,
        ga4_property_id: ga4PropertyId,
      },
      summary: {
        ads: ads.summary || {},
        ga4: ga4.summary || {},
      },
      campaigns: ads.campaigns || [],
      top_pages: ga4.top_pages || [],
      top_sources: ga4.top_sources || [],
      charts,
      diagnosis,
      diagnostics: [...(ads.diagnostics || []), ...(ga4.diagnostics || [])],
      safety_policy: {
        read_only: true,
        automatic_campaign_changes: false,
        automatic_budget_changes: false,
        owner_confirmation_required_for_actions: true,
      },
    });
  });

  app.post("/api/suite/integrations/google/validate", auth, (req, res) => {
    const validation = validateGoogleConnectorSetup(req.body || {});
    res.status(validation.allowed ? 200 : 409).json({
      ok: validation.allowed,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "google_connector_setup_validation",
      validation,
      contract: buildGoogleConnectorContract(storage.googleProviderConfig()),
    });
  });

  app.post("/api/suite/governance/validate", auth, (req, res) => {
    const manifest = req.body?.governance_manifest || req.body?.manifest || req.body || {};
    const validation = validateGovernanceRequest(manifest);
    res.status(validation.allowed ? 200 : 409).json({
      ok: validation.allowed,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "suite_core_codex_governance_runtime",
      execution_allowed: validation.allowed && validation.status === "allow",
      validation,
    });
  });

  app.get("/api/suite/customer-intelligence/contract", auth, async (req, res) => {
    const tenantId = sanitizeId(req.query.tenant_id || req.get("x-sh-tenant-id") || coreClient.status().tenant_id || "suite-control-plane", "tenant");
    const result = await coreClient.customerIntelligenceContract(tenantId);
    if (!result.success) {
      return publicError(res, result.http_status || 503, result.code || "customer_intelligence_contract_unavailable", result.message || "Contratto Customer Intelligence non disponibile.");
    }
    return res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      source: "universal_core",
      tenant_id: tenantId,
      contract: result.contract,
    });
  });

  app.post("/api/suite/customer-intelligence/readiness", auth, async (req, res) => {
    const tenantId = sanitizeId(req.body?.tenant_id || req.get("x-sh-tenant-id") || coreClient.status().tenant_id || "suite-control-plane", "tenant");
    const result = await coreClient.customerIntelligenceReadiness(req.body || {}, tenantId);
    if (!result.success) {
      return publicError(res, result.http_status || 503, result.code || "customer_intelligence_readiness_unavailable", result.message || "Readiness Customer Intelligence non disponibile.");
    }
    return res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      source: "universal_core",
      tenant_id: tenantId,
      readiness: result.readiness,
      rule: result.rule,
    });
  });

  app.post("/api/suite/core/action-mediation", auth, async (req, res) => {
    const tenantId = sanitizeId(req.body?.tenant_id || req.get("x-sh-tenant-id") || coreClient.status().tenant_id || "suite-control-plane", "tenant");
    const action = req.body?.action || req.body || {};
    const governanceManifest = req.body?.governance_manifest || req.body?.manifest || null;

    if (governanceManifest || isGovernanceSensitiveAction(action)) {
      const validation = validateGovernanceRequest(governanceManifest || {});
      if (!validation.allowed) {
        return res.status(409).json({
          ok: false,
          service: "suite_control_plane",
          version: SERVICE_VERSION,
          mode: "suite_core_codex_governance_runtime",
          execution_allowed: false,
          error: "suite_governance_manifest_blocked",
          message: "Governance manifest mancante o non valido per azione sensibile.",
          validation,
        });
      }
    }

    const result = await coreClient.actionMediation(tenantId, {
      action,
      policy: req.body?.policy || {},
      context: {
        source: "suite_control_plane",
        no_auto_execute: true,
        governance_runtime_checked: Boolean(governanceManifest || isGovernanceSensitiveAction(action)),
        ...(req.body?.context && typeof req.body.context === "object" ? req.body.context : {}),
      },
    });
    res.status(result.http_status || (result.success ? 200 : 424)).json({
      ok: result.success,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "core_action_mediation_proxy",
      execution_allowed: false,
      core_route: result.core_route || result.core_route_path || "",
      core: coreClient.status(),
      result,
    });
  });

  app.post("/api/suite/runbooks/preview", auth, (req, res) => {
    const preview = storage.runbookPreview(req.body || {});
    if (!preview) return publicError(res, 404, "suite_runbook_not_found");
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      preview,
    });
  });

  app.post("/api/suite/runbooks/dispatch", auth, (req, res) => {
    const dispatch = storage.runbookDispatch(req.body || {});
    if (!dispatch) return publicError(res, 404, "suite_runbook_not_found");
    res.status(dispatch.accepted ? 202 : 409).json({
      ok: dispatch.accepted,
      accepted: dispatch.accepted,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      dispatch,
    });
  });

  app.post("/api/suite/runbooks/artifacts", auth, (req, res) => {
    const { node, artifact } = storage.runbookArtifact(req.body || {});
    res.status(201).json({
      ok: true,
      accepted: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      node_id: node.node_id,
      tenant_id: node.tenant_id,
      artifact_id: artifact.id,
      received_at: artifact.received_at,
    });
  });

  app.get("/api/suite/nodes/:nodeId/runbook-artifacts", auth, (req, res) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50)));
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      node_id: sanitizeId(req.params.nodeId, "node"),
      artifacts: storage.runbookArtifacts(req.params.nodeId, limit),
    });
  });

  app.get("/api/suite/nodes/:nodeId/dashboard", auth, (req, res) => {
    const dashboard = storage.dashboard(req.params.nodeId);
    if (!dashboard) return publicError(res, 404, "suite_node_not_found");
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      dashboard,
    });
  });

  return { app, storage };
}
