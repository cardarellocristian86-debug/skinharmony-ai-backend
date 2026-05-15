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
import { detectLanguageGuardIssues, supportedLanguageGuardLocales } from "./languageGuard.js";
import { hasScope, requireTenantAccess, KEY_PRESETS, SCOPES } from "./scope.js";
import { buildCodexGuardResponse, normalizeDecisionContract } from "./decisionContract.js";
import {
  BRANCH_PACKAGES,
  composeBranchContext,
  deterministicBranchRegistry,
  resolveBranchesForKey,
} from "../branches/index.js";
import { buildSuitePolicy } from "./suitePolicy.js";
import { getTenantPolicy } from "./tenantRegistry.js";
import {
  AI_GATEWAY_ADAPTERS,
  AI_GATEWAY_MODES,
  AI_GATEWAY_SCHEMA_VERSION,
  buildAiGatewayCoreInput,
  buildAiGatewayVerdict,
  validateAiGatewayPayload,
} from "./aiGateway.js";
import {
  AI_GATEWAY_PAYLOAD_SCHEMA,
  AI_GATEWAY_VERDICT_SCHEMA,
} from "./gatewaySchema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORAGE_ROOT = path.resolve(__dirname, "../storage");
const SERVICE_VERSION = "0.3.6-action-mediation";

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

function buildActionEvaluatorInput(req, keyRecord) {
  const body = req.body || {};
  const actionType = String(body.action_type || body.action?.type || body.domain || "workflow_decision");
  const actionLabel = String(body.action_label || body.action?.label || body.task || actionType);
  const riskHint = Number(body.risk_hint ?? body.action?.risk_hint ?? 45);
  const confidenceHint = Number(body.confidence_hint ?? body.action?.confidence_hint ?? 75);
  const publishIntent = body.publish_intent === true || actionType === "publish";
  const sensitive =
    publishIntent ||
    ["publish", "approve", "change_state", "pricing", "claim_validation", "workflow_decision", "sync", "send", "delete", "write", "deploy", "update", "codex_automation"].includes(actionType);

  return {
    request_id: body.request_id || `action_${crypto.randomUUID()}`,
    generated_at: nowIso(),
    domain: body.domain || "action_evaluator",
    context: {
      tenant_id: safeTenantId(req, keyRecord),
      actor_id: body.actor_id || undefined,
      plan: body.plan || undefined,
      locale: body.locale || "it",
      metadata: {
        action_type: actionType,
        publish_intent: publishIntent ? "true" : "false",
        source: "action_evaluator",
        ...(typeof body.metadata === "object" && body.metadata ? body.metadata : {}),
      },
    },
    signals: [
      normalizeSignal({
        id: `action:${actionType}`,
        category: "action",
        label: actionLabel,
        normalized_score: sensitive ? Math.max(45, riskHint) : riskHint,
        severity_hint: sensitive ? Math.max(45, riskHint) : riskHint,
        confidence_hint: confidenceHint,
        risk_hint: riskHint,
        evidence: Array.isArray(body.evidence) ? body.evidence : [{ label: "Azione richiesta dal client", value: actionType }],
        tags: ["action_gate", actionType],
      }),
    ],
    data_quality: {
      score: Number(body.data_quality?.score ?? body.data_quality_score ?? 70),
      missing_fields: Array.isArray(body.data_quality?.missing_fields) ? body.data_quality.missing_fields : [],
    },
    constraints: safeConstraints({
      ...(typeof body.constraints === "object" && body.constraints ? body.constraints : {}),
      require_confirmation: true,
      max_control_level: "confirm",
      blocked_action_rules: [
        ...(Array.isArray(body.constraints?.blocked_action_rules) ? body.constraints.blocked_action_rules : []),
        ...(publishIntent
          ? [{
              action_id: `action:${actionType}`,
              reason_code: "publish_requires_owner_review",
              severity: 80,
              blocks_execution: false,
            }]
          : []),
      ],
    }, keyRecord, body.owner_confirmed === true),
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

function evidenceStore(storageRoot) {
  const file = path.join(storageRoot, "evidence", "events.jsonl");
  ensureDir(path.dirname(file));
  const signingSecret = process.env.CORE_EVIDENCE_SIGNING_SECRET || "dev-evidence-signing-secret";

  function sign(record) {
    return crypto.createHmac("sha256", signingSecret).update(JSON.stringify(record)).digest("hex");
  }

  function append(tenantId, eventType, payload = {}) {
    const record = {
      evidence_id: `ev_${crypto.randomUUID()}`,
      tenant_id: tenantId,
      event_type: eventType,
      created_at: nowIso(),
      payload,
    };
    const signature = sign(record);
    const signed = { ...record, signature, signature_alg: "hmac-sha256" };
    fs.appendFileSync(file, `${JSON.stringify(signed)}\n`, "utf8");
    return signed;
  }

  function recent(tenantId, limit = 50) {
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(200, Number(limit) || 50)))
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { event_type: "evidence_parse_error", raw: line };
        }
      })
      .filter((event) => !tenantId || event.tenant_id === tenantId);
  }

  return { append, recent };
}

function suiteRunbookCatalog() {
  return [
    {
      id: "provision_customer_node",
      label: "Provision cliente",
      action_type: "codex_automation",
      risk_hint: 46,
      required_confirmation: true,
      steps: ["validate_tenant_scope", "generate_scoped_key", "prepare_site_clone", "write_evidence"],
    },
    {
      id: "clone_waas_template",
      label: "Clone template WaaS",
      action_type: "suite_sync",
      risk_hint: 42,
      required_confirmation: true,
      steps: ["select_template", "check_license", "prepare_clone_plan", "write_evidence"],
    },
    {
      id: "sync_site_content",
      label: "Sync contenuti sito",
      action_type: "publish",
      risk_hint: 58,
      required_confirmation: true,
      steps: ["content_guard", "claim_guard", "owner_review", "write_evidence"],
    },
    {
      id: "update_plugin_manifest",
      label: "Update plugin manifest",
      action_type: "release",
      risk_hint: 70,
      required_confirmation: true,
      steps: ["verify_checksum", "verify_channel", "prepare_rollback", "write_evidence"],
    },
    {
      id: "price_claim_audit",
      label: "Audit prezzi/claim",
      action_type: "claim_validation",
      risk_hint: 55,
      required_confirmation: false,
      steps: ["pricing_guard", "claim_guard", "policy_check", "write_evidence"],
    },
    {
      id: "bridge_crm_report",
      label: "Bridge CRM report",
      action_type: "sync",
      risk_hint: 38,
      required_confirmation: true,
      steps: ["validate_connector_scope", "read_snapshot", "prepare_report", "write_evidence"],
    },
  ];
}

function buildConnectorSdkManifest() {
  return {
    manifest_version: "core_connector_sdk_v1",
    positioning: "AI Governance + Automation Control Plane per PMI e verticali premium",
    rule: "AI e automazioni possono agire solo passando da Core, policy, audit, tenant isolation e conferma quando serve.",
    transports: ["rest_json", "mcp_ready_schema"],
    auth: {
      header: "Authorization: Bearer <SHX key>",
      key_types: ["connector", "automation", "user_session"],
      tenant_scoped: true,
    },
    adapters: ["wordpress", "site_suite", "smart_desk", "crm", "ecommerce", "files", "external_api"],
    required_client_behaviour: [
      "send_tenant_id_on_every_request",
      "never_execute_when_executionAllowed_false",
      "ask_owner_when_requiresOwnerConfirmation_true",
      "store_evidence_id_for_sensitive_actions",
    ],
    core_routes: {
      gate: "/v1/ai-gateway/evaluate",
      control_plane: "/v1/control-plane/overview",
      runbooks: "/v1/runbooks",
      runbook_evaluate: "/v1/runbooks/evaluate",
      release_check: "/v1/releases/manifest/check",
      evidence: "/v1/evidence/recent",
    },
  };
}

function evaluateReleaseManifest(payload = {}) {
  const manifest = typeof payload.manifest === "object" && payload.manifest ? payload.manifest : payload;
  const version = textValue(manifest.version || manifest.stable_version);
  const channel = textValue(manifest.channel || manifest.release_channel, "stable");
  const packageUrl = textValue(manifest.package_url || manifest.package || manifest.zip_url);
  const checksum = textValue(manifest.checksum_sha256 || manifest.sha256 || manifest.checksum);
  const rollbackUrl = textValue(manifest.rollback_url);
  const signed = Boolean(manifest.signature || manifest.signed === true);
  const issues = [];

  if (!version) issues.push({ code: "missing_version", severity: "critical" });
  if (!["stable", "beta", "canary"].includes(channel)) issues.push({ code: "invalid_channel", severity: "critical", channel });
  if (!packageUrl) issues.push({ code: "missing_package_url", severity: "critical" });
  if (!checksum || !/^[a-f0-9]{64}$/i.test(checksum)) issues.push({ code: "missing_or_invalid_sha256", severity: "critical" });
  if (!signed) issues.push({ code: "missing_manifest_signature", severity: "high" });
  if (!rollbackUrl) issues.push({ code: "missing_rollback_url", severity: "high" });
  if (manifest.skip_integrity_check === true || manifest.bypass_checksum === true) issues.push({ code: "integrity_bypass_requested", severity: "critical" });

  const critical = issues.some((issue) => issue.severity === "critical");
  return {
    status: critical ? "blocked" : issues.length ? "review_required" : "ready",
    execution_allowed: false,
    owner_confirmation_required: true,
    manifest: { version, channel, package_url: packageUrl, checksum_sha256: checksum || null, rollback_url: rollbackUrl || null, signed },
    issues,
    required_next_step: critical ? "fix_manifest_before_release" : issues.length ? "owner_review_before_release" : "staging_canary_then_owner_confirmation",
  };
}

function buildControlPlaneOverview({ tenantId, keyRecord, keyStore, snapshot, auditEvents, evidenceEvents }) {
  const branchResolution = resolveBranchesForKey(keyRecord);
  const suitePolicy = buildSuitePolicy(keyRecord, branchResolution);
  const tenantKeys = keyStore.listKeys({ tenant_id: tenantId });
  const auditPulse = summarizeAuditPulse(auditEvents);
  const activeKeys = tenantKeys.filter((key) => key.status === "active").length;
  const suspendedKeys = tenantKeys.filter((key) => key.status === "suspended").length;
  const revokedKeys = tenantKeys.filter((key) => key.status === "revoked").length;

  return {
    tenant_id: tenantId,
    generated_at: nowIso(),
    positioning: "AI Governance + Automation Control Plane per PMI e verticali premium",
    control_plane: {
      api_keys: { total: tenantKeys.length, active: activeKeys, suspended: suspendedKeys, revoked: revokedKeys },
      licenses: { tier: branchResolution.tier, suite_policy: suitePolicy },
      versions: { service_version: SERVICE_VERSION, connector_sdk_manifest: "core_connector_sdk_v1" },
      update: { release_manifest_check: "/v1/releases/manifest/check", automatic_update_allowed: false },
      gate: { ai_gateway: "/v1/ai-gateway/evaluate", policy_check: "/v1/policy/check" },
      automations: { runbook_count: suiteRunbookCatalog().length, execution_default: "confirm_or_block" },
      errors: { auth_failures_24h: auditPulse.auth_failures_24h, scope_denied_24h: auditPulse.scope_denied_24h },
      audit: { events_24h: auditPulse.total_events_24h, evidence_events: evidenceEvents.length },
    },
    tenant_isolation: {
      mode: "tenant_scoped_keys",
      current_key_id: keyRecord.key_id,
      admin_scope: hasScope(keyRecord, SCOPES.ADMIN_TENANT),
      cross_tenant_block_default: true,
      staging_production_separation_required: true,
    },
    latest_snapshot: snapshot ? { snapshot_id: snapshot.snapshot_id, source: snapshot.source, created_at: snapshot.created_at } : null,
    next_missing_blocks: [
      "external_ui_dashboard",
      "customer_connector_packages",
      "production_signature_secret_rotation",
      "enterprise_agnostic_demo",
    ],
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

function baselineAiDecision(payload = {}) {
  const action = String(payload.requested_action?.type || payload.action_type || payload.domain || "advisory").toLowerCase();
  const llmOutput = String(payload.llm_output || payload.output || "");
  const sensitive =
    ["publish", "approve", "delete", "deploy", "update", "sync", "send", "write", "pricing", "claim_validation"].includes(action) ||
    /password|secret|token|api key|private key|reset --hard|drop table/i.test(llmOutput);
  return {
    model: "baseline_without_core",
    decision: sensitive ? "likely_allow_with_prompt_warning" : "allow",
    executionAllowed: true,
    ownerConfirmationEnforced: false,
    auditRequired: false,
    risk: sensitive ? "uncontrolled" : "unknown",
  };
}

function gatewayBenchmark(payload = {}, verdict = {}) {
  const baseline = baselineAiDecision(payload);
  return {
    baseline,
    gateway: {
      model: "universal_core_ai_gateway",
      decision: verdict.decision,
      executionAllowed: verdict.executionAllowed,
      ownerConfirmationEnforced: verdict.requiresOwnerConfirmation,
      auditRequired: true,
      risk: verdict.risk?.band || "unknown",
    },
    delta: {
      execution_hardened: baseline.executionAllowed === true && verdict.executionAllowed === false,
      owner_confirmation_added: baseline.ownerConfirmationEnforced === false && verdict.requiresOwnerConfirmation === true,
      audit_added: true,
      verdict_schema: AI_GATEWAY_SCHEMA_VERSION,
    },
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

async function buildTextBranchInput(req, payload = {}) {
  const data = typeof payload.data === "object" && payload.data ? payload.data : payload;
  const text = textValue(data.text || data.content || data.copy || data.draft);
  const providedIssues = normalizeTextGuardIssues(data.issues);
  const claimIssues = buildTextGuardIssuesFromClaimShield(text, data);
  const issues = await detectLanguageGuardIssues({
    text,
    locale: data.locale || payload.locale || "it",
    existingIssues: [...providedIssues, ...claimIssues],
    options: {
      useLanguageTool: data.use_languagetool ?? payload.use_languagetool,
    },
  });
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
  const evidence = evidenceStore(storageRoot);
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
    const suitePolicy = buildSuitePolicy(req.coreKey, branchResolution);
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
      suite_policy: suitePolicy,
    });
  });

  app.get("/v1/control-plane/overview", createAuth(keyStore, audit, SCOPES.READ_CONTROL_PLANE), (req, res) => {
    const overview = buildControlPlaneOverview({
      tenantId: req.tenantId,
      keyRecord: req.coreKey,
      keyStore,
      snapshot: snapshots.latest(req.tenantId),
      auditEvents: audit.recent(200),
      evidenceEvents: evidence.recent(req.tenantId, 50),
    });
    audit.append("core_control_plane_overview_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id });
    res.json({ ok: true, overview });
  });

  app.get("/v1/connectors/sdk/manifest", createAuth(keyStore, audit, SCOPES.READ_CONTROL_PLANE), (req, res) => {
    audit.append("core_connector_sdk_manifest_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id });
    res.json({ ok: true, tenant_id: req.tenantId, sdk: buildConnectorSdkManifest() });
  });

  app.get("/v1/runbooks", createAuth(keyStore, audit, SCOPES.READ_CONTROL_PLANE), (req, res) => {
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      runbooks: suiteRunbookCatalog(),
      rule: "I runbook preparano e valutano automazioni. L'esecuzione resta bloccata finche Core non consente e l'owner conferma quando richiesto.",
    });
  });

  app.post("/v1/runbooks/evaluate", createAuth(keyStore, audit, SCOPES.WRITE_RUNBOOK), (req, res) => {
    const runbookId = textValue(req.body?.runbook_id || req.body?.id);
    const runbook = suiteRunbookCatalog().find((item) => item.id === runbookId);
    if (!runbook) return publicError(res, 404, "runbook_not_found");

    const coreInput = {
      request_id: req.body?.request_id || `runbook_${crypto.randomUUID()}`,
      generated_at: nowIso(),
      domain: "core_automation_suite",
      context: {
        tenant_id: req.tenantId,
        actor_id: req.body?.actor_id || undefined,
        locale: req.body?.locale || "it",
        metadata: {
          action_type: runbook.action_type,
          runbook_id: runbook.id,
          source: "suite_runbook_marketplace",
        },
      },
      signals: [
        normalizeSignal({
          id: `runbook:${runbook.id}`,
          label: runbook.label,
          category: "automation_runbook",
          normalized_score: runbook.risk_hint,
          severity_hint: runbook.risk_hint,
          confidence_hint: 82,
          evidence: [
            { label: "Runbook approvato in catalogo", value: runbook.id },
            { label: "Esecuzione reale non inclusa in questo endpoint", value: true },
          ],
          tags: ["runbook", runbook.action_type],
        }),
      ],
      data_quality: {
        score: Number(req.body?.data_quality_score ?? 75),
        missing_fields: [],
      },
      constraints: safeConstraints({
        require_confirmation: true,
        max_control_level: "confirm",
        allow_automation: false,
        safety_mode: true,
        blocked_actions: ["execute_without_evidence", "cross_tenant_execution", "release_without_checksum"],
      }, req.coreKey, false),
    };
    const output = runUniversalCore(coreInput);
    const decisionContract = normalizeDecisionContract(output, { action_type: runbook.action_type, publish_intent: ["publish", "release"].includes(runbook.action_type) });
    const evidenceRecord = evidence.append(req.tenantId, "runbook_evaluated", {
      runbook,
      request: req.body || {},
      decision_contract: decisionContract,
      execution_allowed: false,
      rollback_possible: true,
    });
    audit.append("core_runbook_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      runbook_id: runbook.id,
      control_level: decisionContract.control_level,
      evidence_id: evidenceRecord.evidence_id,
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      runbook,
      decision_contract: decisionContract,
      output,
      evidence: evidenceRecord,
      guardrail: {
        execution_allowed: false,
        owner_confirmation_required: true,
        mode: "evaluate_only_no_side_effects",
      },
    });
  });

  app.post("/v1/releases/manifest/check", createAuth(keyStore, audit, SCOPES.POLICY_CHECK), (req, res) => {
    const result = evaluateReleaseManifest(req.body || {});
    const evidenceRecord = evidence.append(req.tenantId, "release_manifest_checked", {
      result,
      rollback_possible: Boolean(result.manifest.rollback_url),
    });
    audit.append("core_release_manifest_checked", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      status: result.status,
      evidence_id: evidenceRecord.evidence_id,
    });
    res.json({ ok: true, tenant_id: req.tenantId, result, evidence: evidenceRecord });
  });

  app.get("/v1/evidence/recent", createAuth(keyStore, audit, SCOPES.READ_EVIDENCE), (req, res) => {
    res.json({ ok: true, tenant_id: req.tenantId, evidence: evidence.recent(req.tenantId, Number(req.query.limit || 50)) });
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
    const decisionContract = normalizeDecisionContract(output, {
      action_type: req.body?.action_type || req.body?.domain || input.domain,
      publish_intent: req.body?.publish_intent === true,
    });
    audit.append("core_decision_run", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, request_id: input.request_id, state: output.state, risk: output.risk?.band });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      output,
      decision_contract: decisionContract,
      guardrail: {
        destructive_automation: false,
        publish_requires_owner_confirmation: true,
        execution_from_api_allowed: output.execution_profile.can_execute === true && hasScope(req.coreKey, SCOPES.AUTOMATION_CODEX),
      },
    });
  });

  app.post("/v1/action-evaluator", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const input = buildActionEvaluatorInput(req, req.coreKey);
    const output = runUniversalCore(input);
    const decisionContract = normalizeDecisionContract(output, {
      action_type: req.body?.action_type || input.context.metadata.action_type,
      publish_intent: req.body?.publish_intent === true,
    });
    audit.append("core_action_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      request_id: input.request_id,
      action_type: input.context.metadata.action_type,
      state: decisionContract.state,
      control_level: decisionContract.control_level,
      publish_safe: decisionContract.publish_safe,
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      decision_contract: decisionContract,
      output,
      guardrail: {
        destructive_automation: false,
        execution_allowed: false,
        owner_confirmation_required: decisionContract.control_level !== "observe",
        mode: "core_action_gate",
      },
    });
  });

  app.get("/v1/ai-gateway/schema", (req, res) => {
    res.json({
      ok: true,
      schema_version: AI_GATEWAY_SCHEMA_VERSION,
      payload_schema: AI_GATEWAY_PAYLOAD_SCHEMA,
      verdict_schema: AI_GATEWAY_VERDICT_SCHEMA,
      modes: [...AI_GATEWAY_MODES],
      adapters: [...AI_GATEWAY_ADAPTERS],
      required_fields: ["user_request"],
      recommended_fields: [
        "llm_output",
        "context",
        "requested_action",
        "runtime_state",
        "role_scope",
        "flow_pressure",
        "variants",
      ],
      verdict_fields: [
        "decision",
        "risk",
        "confidence",
        "warnings",
        "policyFlags",
        "executionAllowed",
        "recommendedVariant",
        "requiresOwnerConfirmation",
        "action_mediation",
        "explainability",
        "commercial_explanation",
      ],
      rule: "ChatGPT/Codex propongono; AI Gateway invia al Core; Universal Core decide; Nyra/adapter spiegano; i client eseguono solo entro verdict.",
    });
  });
  app.get("/api/v1/ai-gateway/schema", (req, res) => {
    res.redirect(307, "/v1/ai-gateway/schema");
  });

  function handleAiGateway(req, res, adapterOverride = "") {
    const validation = validateAiGatewayPayload(req.body || {});
    if (!validation.ok) {
      audit.append("core_ai_gateway_validation_failed", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        errors: validation.errors,
        adapter: adapterOverride || req.body?.adapter || "generic",
      });
      return publicError(res, 400, "ai_gateway_payload_invalid", validation.errors.join(", "));
    }

    const input = buildAiGatewayCoreInput({
      payload: req.body || {},
      tenantId: req.tenantId,
      keyRecord: req.coreKey,
      adapterOverride,
    });
    const output = runUniversalCore(input);
    const verdict = buildAiGatewayVerdict({
      payload: req.body || {},
      tenantId: req.tenantId,
      keyRecord: req.coreKey,
      coreOutput: output,
      adapterOverride,
    });
    const benchmark = req.body?.include_benchmark === true ? gatewayBenchmark(req.body || {}, verdict) : undefined;
    audit.append("core_ai_gateway_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      request_id: input.request_id,
      adapter: verdict.adapter,
      mode: verdict.mode,
      decision: verdict.decision,
      mediation_state: verdict.action_mediation?.state,
      risk: verdict.risk?.band,
      execution_allowed: verdict.executionAllowed,
      owner_confirmation_required: verdict.requiresOwnerConfirmation,
      next_step: verdict.action_mediation?.next_step,
    });
    return res.json({
      ok: true,
      gateway: {
        schema_version: AI_GATEWAY_SCHEMA_VERSION,
        core_centralized: true,
        adapters_separated: true,
        no_duplicated_logic: true,
        openai_call_executed: false,
        audit_event: "core_ai_gateway_evaluated",
      },
      verdict,
      benchmark,
    });
  }

  app.post("/v1/ai-gateway/evaluate", createAuth(keyStore, audit, SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res);
  });
  app.post("/api/v1/ai-gateway/evaluate", createAuth(keyStore, audit, SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res);
  });

  app.post("/v1/adapters/codex/gateway", createAuth(keyStore, audit, SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res, "codex");
  });
  app.post("/api/v1/adapters/codex/gateway", createAuth(keyStore, audit, SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res, "codex");
  });

  app.post("/v1/adapters/site-suite/gateway", createAuth(keyStore, audit, SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res, "site_suite");
  });
  app.post("/api/v1/adapters/site-suite/gateway", createAuth(keyStore, audit, SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res, "site_suite");
  });

  app.post("/v1/adapters/smart-desk/gateway", createAuth(keyStore, audit, SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res, "smart_desk");
  });
  app.post("/api/v1/adapters/smart-desk/gateway", createAuth(keyStore, audit, SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res, "smart_desk");
  });

  app.post("/v1/adapters/skinharmony-core/gateway", createAuth(keyStore, audit, SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res, "skinharmony_core");
  });
  app.post("/api/v1/adapters/skinharmony-core/gateway", createAuth(keyStore, audit, SCOPES.AI_GATEWAY), (req, res) => {
    return handleAiGateway(req, res, "skinharmony_core");
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
    const tenantPolicy = getTenantPolicy(req.tenantId, req.body?.plan || req.coreKey?.metadata?.tier);
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
      tenant_policy: tenantPolicy,
      decision_contract: normalizeDecisionContract(runUniversalCore({
        request_id: req.body?.request_id || `codex_context_${crypto.randomUUID()}`,
        generated_at: nowIso(),
        domain: "codex",
        context: {
          tenant_id: req.tenantId,
          locale: req.body?.locale || "it",
          metadata: {
            action_type: "codex_automation",
            source: "codex_context",
          },
        },
        signals: [
          normalizeSignal({
            id: "codex:context_request",
            label: req.body?.task || "Contesto Codex richiesto",
            category: "codex",
            normalized_score: context.selected_branches.length ? 35 : 45,
            confidence_hint: 80,
            evidence: [{ label: context.selected_branches.length ? "Rami specializzati disponibili" : "Nessun ramo richiesto/autorizzato: uso guardiano generico", value: true }],
            tags: ["codex", context.selected_branches.length ? "branch_context" : "generic_guard"],
          }),
        ],
        data_quality: { score: 75, missing_fields: [] },
        constraints: safeConstraints({ require_confirmation: true, max_control_level: "confirm" }, req.coreKey, false),
      }), { action_type: "codex_automation" }),
      guardrail: {
        destructive_automation: false,
        execution_allowed: false,
        openai_call_executed: false,
        mode: "context_composition_only",
      },
    });
  });

  app.post("/v1/codex/guard", createAuth(keyStore, audit, SCOPES.AUTOMATION_CODEX), (req, res) => {
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
    const tenantPolicy = getTenantPolicy(req.tenantId, req.body?.plan || req.coreKey?.metadata?.tier);
    const evaluatorInput = buildActionEvaluatorInput({
      get: () => "",
      body: {
        ...(req.body || {}),
        tenant_id: req.tenantId,
        domain: "codex",
        action_type: req.body?.action_type || "codex_automation",
        action_label: req.body?.task || "Codex AI controlled work",
        risk_hint: req.body?.risk_hint ?? (context.selected_branches.length ? 35 : 45),
        evidence: [
          { label: context.selected_branches.length ? "Rami Core disponibili per il task" : "Nessun ramo disponibile: guardiano generico Core attivo", value: context.selected_branches.length },
          { label: tenantPolicy.source === "tenant_registry" ? "Tenant policy specifica caricata" : "Policy tenant generica caricata", value: tenantPolicy.source },
          ...(Array.isArray(req.body?.evidence) ? req.body.evidence : []),
        ],
      },
    }, req.coreKey);
    const output = runUniversalCore(evaluatorInput);
    const response = buildCodexGuardResponse({
      tenantId: req.tenantId,
      keyRecord: req.coreKey,
      coreOutput: output,
      branchContext: context,
      requestedBranches,
      task: req.body?.task || "",
      actionType: req.body?.action_type || "codex_automation",
    });
    response.tenant_policy = tenantPolicy;
    audit.append("core_codex_guard_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      task: req.body?.task || "",
      mode: response.codex_guard.mode,
      state: response.decision_contract.state,
      control_level: response.decision_contract.control_level,
      selected_branches: response.codex_guard.selected_branches,
      denied_branches: response.codex_guard.denied_branches,
    });
    res.json({ ok: true, ...response });
  });

  app.post("/v1/content-guard/check", createAuth(keyStore, audit, SCOPES.READ_DECISION), async (req, res) => {
    const resolution = resolveBranchesForKey(req.coreKey, ["ramo_testo"]);
    if (!resolution.selected_branches.includes("ramo_testo")) {
      audit.append("core_branch_denied", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, branch: "ramo_testo" });
      return publicError(res, 403, "branch_not_allowed", `Branch not allowed for tier ${resolution.tier}`);
    }

    const input = await buildTextBranchInput(req, req.body || {});
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
      language_guard: {
        supported_locales: supportedLanguageGuardLocales(),
        local_dictionary_enabled: true,
        languagetool_enabled: process.env.LANGUAGETOOL_DISABLED === "1" || process.env.NODE_ENV === "test" ? false : true,
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
