import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runUniversalCore } from "../../../universal-core/packages/core/src/index.ts";
import { mapFlowCoreToUniversal } from "../../../universal-core/packages/branches/flowcore/src/index.ts";
import { runTextBranch } from "../../../universal-core/packages/branches/ramo-testo/src/index.ts";
import { runNiraUniversalCoreBridge } from "../../../universal-core/tools/nira-universal-core-bridge.ts";
import { createAudit, ensureDir } from "./audit.js";
import { createKeyStore } from "./keyStore.js";
import { createSetupTokenStore } from "./setupTokenStore.js";
import { detectLanguageGuardIssues, supportedLanguageGuardLocales } from "./languageGuard.js";
import { hasScope, requireTenantAccess, KEY_PRESETS, SCOPES } from "./scope.js";
import { buildCodexGuardResponse, normalizeDecisionContract } from "./decisionContract.js";
import {
  BRANCH_PACKAGES,
  composeBranchContext,
  deterministicBranchGroups,
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
import {
  buildCustomerIntelligenceContract,
  summarizeCustomerIntelligenceReadiness,
} from "./customerIntelligenceContract.js";
import { selectSemanticCandidates } from "./semanticSelection.js";
import {
  SOFTWARE_LANGUAGE_GATE_VERSION,
  evaluateSoftwareLanguageGate,
} from "./softwareLanguageGate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORAGE_ROOT = path.resolve(__dirname, "../storage");
const SERVICE_VERSION = "0.3.17-software-language-gate";

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

function readJsonFile(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function normalizeList(value, max = 100) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((item) => String(item || "").trim()).filter(Boolean);
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

function tenantRegistryStore(storageRoot) {
  const file = path.join(storageRoot, "tenants", "registry.json");
  const read = () => readJsonFile(file, []);
  const write = (rows) => writeJsonFile(file, rows);

  function normalizeTenant(input = {}) {
    const tenantId = String(input.tenant_id || input.id || "").trim();
    if (!tenantId) throw new Error("tenant_id_required");
    return {
      tenant_id: tenantId,
      label: String(input.label || input.name || tenantId).trim(),
      sector: String(input.sector || input.industry || "generic").trim(),
      lifecycle_state: String(input.lifecycle_state || input.status || "active").trim(),
      environment: String(input.environment || "production").trim(),
      brand_scope: String(input.brand_scope || "").trim(),
      parent_tenant_id: String(input.parent_tenant_id || "").trim() || null,
      allowed_domains: normalizeList(input.allowed_domains || input.domains, 50),
      active_branch_groups: normalizeList(input.active_branch_groups || input.branch_groups, 50),
      active_branches: normalizeList(input.active_branches || input.branches, 100),
      policy_profile: String(input.policy_profile || "default").trim(),
      notes: String(input.notes || "").trim(),
      updated_at: nowIso(),
    };
  }

  return {
    list() {
      return read();
    },
    get(tenantId) {
      return read().find((row) => row.tenant_id === tenantId) || null;
    },
    upsert(input = {}) {
      const normalized = normalizeTenant(input);
      const rows = read();
      const index = rows.findIndex((row) => row.tenant_id === normalized.tenant_id);
      if (index >= 0) {
        rows[index] = { ...rows[index], ...normalized, created_at: rows[index].created_at || nowIso() };
      } else {
        rows.push({ ...normalized, created_at: nowIso() });
      }
      write(rows);
      return rows.find((row) => row.tenant_id === normalized.tenant_id);
    },
  };
}

function entityGraphStore(storageRoot) {
  const file = path.join(storageRoot, "entity-graph", "graph.json");
  const empty = () => ({ entities: [], relations: [] });
  const read = () => readJsonFile(file, empty());
  const write = (graph) => writeJsonFile(file, {
    entities: Array.isArray(graph.entities) ? graph.entities : [],
    relations: Array.isArray(graph.relations) ? graph.relations : [],
  });

  function normalizeEntity(input = {}, tenantId = "") {
    const id = String(input.entity_id || input.id || "").trim() || `ent_${crypto.randomUUID()}`;
    return {
      entity_id: id,
      tenant_id: String(input.tenant_id || tenantId || "").trim(),
      entity_type: String(input.entity_type || input.type || "generic_entity").trim(),
      label: String(input.label || input.name || id).trim(),
      lifecycle_state: String(input.lifecycle_state || input.status || "active").trim(),
      risk_band: String(input.risk_band || "low").trim(),
      value_score: Number(input.value_score ?? 0),
      metadata: typeof input.metadata === "object" && input.metadata ? input.metadata : {},
      updated_at: nowIso(),
    };
  }

  function normalizeRelation(input = {}, tenantId = "") {
    const id = String(input.relation_id || input.id || "").trim() || `rel_${crypto.randomUUID()}`;
    return {
      relation_id: id,
      tenant_id: String(input.tenant_id || tenantId || "").trim(),
      from_entity_id: String(input.from_entity_id || input.from || "").trim(),
      to_entity_id: String(input.to_entity_id || input.to || "").trim(),
      relation_type: String(input.relation_type || input.type || "linked_to").trim(),
      policy_scope: String(input.policy_scope || "tenant").trim(),
      metadata: typeof input.metadata === "object" && input.metadata ? input.metadata : {},
      updated_at: nowIso(),
    };
  }

  return {
    readTenant(tenantId) {
      const graph = read();
      return {
        entities: graph.entities.filter((entity) => entity.tenant_id === tenantId),
        relations: graph.relations.filter((relation) => relation.tenant_id === tenantId),
      };
    },
    upsert(tenantId, payload = {}) {
      const graph = read();
      const entities = Array.isArray(payload.entities) ? payload.entities : payload.entity ? [payload.entity] : [];
      const relations = Array.isArray(payload.relations) ? payload.relations : payload.relation ? [payload.relation] : [];
      for (const rawEntity of entities) {
        const entity = normalizeEntity(rawEntity, tenantId);
        const index = graph.entities.findIndex((row) => row.tenant_id === entity.tenant_id && row.entity_id === entity.entity_id);
        if (index >= 0) graph.entities[index] = { ...graph.entities[index], ...entity };
        else graph.entities.push({ ...entity, created_at: nowIso() });
      }
      for (const rawRelation of relations) {
        const relation = normalizeRelation(rawRelation, tenantId);
        const index = graph.relations.findIndex((row) => row.tenant_id === relation.tenant_id && row.relation_id === relation.relation_id);
        if (index >= 0) graph.relations[index] = { ...graph.relations[index], ...relation };
        else graph.relations.push({ ...relation, created_at: nowIso() });
      }
      write(graph);
      return this.readTenant(tenantId);
    },
  };
}

function branchMaturityReport() {
  const registry = branchRegistry();
  const groups = deterministicBranchGroups();
  const statuses = {};
  for (const [branchId, profile] of Object.entries(registry)) {
    const productionStatus = profile.production_status || "unknown";
    const maturity =
      productionStatus === "test_only"
        ? "test"
        : productionStatus === "advisory"
          ? "advisory"
          : productionStatus === "production"
            ? "production"
            : "pilot";
    statuses[branchId] = {
      branch_id: branchId,
      label: profile.label,
      domain: profile.domain,
      production_status: productionStatus,
      maturity,
      execution_default: maturity === "production" ? "confirm" : maturity === "advisory" ? "advisory_only" : "test_only",
      promotion_required: maturity === "production" ? [] : ["benchmark_pass", "owner_approval", "regression_test", "audit_sample"],
    };
  }
  return {
    schema_version: "branch_maturity_v1",
    statuses,
    groups: Object.fromEntries(
      Object.entries(groups).map(([groupId, group]) => [
        groupId,
        {
          ...group,
          maturity_summary: group.branches.reduce((acc, branchId) => {
            const maturity = statuses[branchId]?.maturity || "unknown";
            acc[maturity] = (acc[maturity] || 0) + 1;
            return acc;
          }, {}),
        },
      ]),
    ),
  };
}

function buildEntitlement(keyRecord, branchResolution) {
  const metadata = keyRecord?.metadata && typeof keyRecord.metadata === "object" ? keyRecord.metadata : {};
  const limits = metadata.suite_limits && typeof metadata.suite_limits === "object" ? metadata.suite_limits : {};
  return {
    schema_version: "core_entitlement_v1",
    tenant_id: keyRecord?.tenant_id || "",
    key_id: keyRecord?.key_id || "",
    key_type: keyRecord?.key_type || "",
    tier: branchResolution.tier,
    status: keyRecord?.status || "unknown",
    expires_at: keyRecord?.expires_at || null,
    branch_groups: metadata.active_branch_groups || branchResolution.allowed_groups || [],
    branches: branchResolution.allowed_branches,
    scopes: keyRecord?.allowed_scopes || [],
    limits: {
      monthly_core_calls: Number(limits.monthly_core_calls ?? limits.core_calls ?? 0),
      codex_automation_runs: Number(limits.codex_automation_runs ?? 0),
      smartdesk_seats: Number(limits.smartdesk_seats ?? limits.seat_limit ?? 0),
      wordpress_nodes: Number(limits.wordpress_nodes ?? 1),
      runbook_executions: Number(limits.runbook_executions ?? 0),
    },
    environments: normalizeList(metadata.environments || ["production"], 10),
    soft_gate: metadata.suite_policy?.soft_gate !== false,
    hard_block: metadata.suite_policy?.hard_block === true,
    rule: "La key abilita perimetro, non proprieta globale: ogni azione resta scoped, auditata e mediata dal Core.",
  };
}

function buildBootstrapProfile({ keyRecord, tenant = null, tenantPolicy = null, branchResolution = null, entitlement = null }) {
  const metadata = keyRecord?.metadata && typeof keyRecord.metadata === "object" ? keyRecord.metadata : {};
  const resolvedBranches = branchResolution || resolveBranchesForKey(keyRecord);
  const resolvedEntitlement = entitlement || buildEntitlement(keyRecord, resolvedBranches);
  const resolvedTenantPolicy = tenantPolicy || getTenantPolicy(keyRecord?.tenant_id, metadata.tier || metadata.suite_tier);
  const maturity = branchMaturityReport();
  const registry = branchRegistry();
  const branchProfiles = Object.fromEntries(
    resolvedBranches.allowed_branches
      .map((branchId) => [branchId, registry[branchId]])
      .filter(([, profile]) => Boolean(profile)),
  );

  return {
    ok: true,
    schema_version: "core_bootstrap_profile_v1",
    generated_at: nowIso(),
    tenant: {
      tenant_id: keyRecord?.tenant_id || tenant?.tenant_id || "",
      label: tenant?.label || keyRecord?.tenant_id || "",
      sector: tenant?.sector || "generic",
      environment: tenant?.environment || metadata.environments?.[0] || "production",
      brand_scope: keyRecord?.brand_scope || tenant?.brand_scope || "",
      domains: Array.isArray(tenant?.domains) ? tenant.domains : [],
      nodes: Array.isArray(tenant?.nodes) ? tenant.nodes : [],
    },
    plan: {
      tier: resolvedEntitlement.tier,
      suite_tier: metadata.suite_tier || resolvedEntitlement.tier,
      modules: Array.isArray(metadata.suite_modules) ? metadata.suite_modules : [],
      status: keyRecord?.status || "unknown",
      expires_at: keyRecord?.expires_at || null,
    },
    branches: {
      selected: resolvedBranches.allowed_branches,
      denied: resolvedBranches.denied_branches || [],
      groups: resolvedEntitlement.branch_groups,
      profiles: branchProfiles,
      maturity: Object.fromEntries(
        resolvedBranches.allowed_branches
          .map((branchId) => [branchId, maturity.statuses[branchId]])
          .filter(([, status]) => Boolean(status)),
      ),
    },
    policy: {
      source: resolvedTenantPolicy.source,
      sensitive_domains: resolvedTenantPolicy.sensitive_domains || [],
      blocked_actions: resolvedTenantPolicy.blocked_actions || [],
      confirm_actions: resolvedTenantPolicy.confirm_actions || [],
      sandbox_actions: resolvedTenantPolicy.sandbox_actions || [],
      action_mediation_states: ["allow", "rewrite", "confirm", "defer", "sandbox", "block", "rollback_required"],
      rule: "AI e automazioni possono agire solo passando da Core, policy, audit, tenant isolation e conferma quando serve.",
    },
    limits: resolvedEntitlement.limits,
    recommended_folders: {
      config: ".skinharmony-core/config",
      key: ".skinharmony-core/keys",
      memory: ".skinharmony-core/memory",
      reports: "reports/codex-core",
      policies: ".skinharmony-core/policies",
      logs: ".skinharmony-core/logs",
      snapshots: ".skinharmony-core/snapshots",
      ...(typeof metadata.recommended_folders === "object" && metadata.recommended_folders ? metadata.recommended_folders : {}),
    },
    scope: {
      key_id: keyRecord?.key_id || "",
      key_type: keyRecord?.key_type || "",
      role: metadata.role || keyRecord?.preset || keyRecord?.key_type || "connector",
      allowed_scopes: keyRecord?.allowed_scopes || [],
      tenant_scoped: true,
      cross_tenant_block_default: true,
      revocation_supported: true,
    },
    gate_mode: metadata.gate_mode || "hard_gating",
    connector_contract: {
      init_command: "sh-core-codex init --setup-token SHX-SETUP-...",
      profile_endpoint: "GET /v1/bootstrap/profile",
      sensitive_actions_require_core: true,
      local_doctor_required: true,
    },
  };
}

function inferNiraBranchRequest(body = {}) {
  const explicit = normalizeList(body.branches || body.branch_ids || body.branch_groups, 80);
  if (explicit.length) return explicit;

  const target = String(body.target_system || "").toLowerCase();
  const text = String(body.text || body.request || body.task || "").toLowerCase();
  const requested = ["automation_control"];

  if (target === "suite" || target === "wordpress" || /(suite|wordpress|wp|plugin|waas|sito|template)/.test(text)) {
    requested.push("platform_engineering", "site_factory");
  }
  if (target === "smartdesk" || /(smartdesk|smart desk|crm|agenda|gestionale)/.test(text)) {
    requested.push("business_governance", "data_integration_orchestration");
  }
  if (/(marketing|campagn|ads|sponsorizzat|copy|testi|recall|email|clienti|segment|funnel|conversion|comportament|localizzaz|traduzion)/.test(text)) {
    requested.push("marketing_intelligence", "content_intelligence");
  }
  if (target === "universal_core" || /(core|policy|gate|rami|branch|tenant|key|entitlement)/.test(text)) {
    requested.push("security_defense");
  }
  if (/(privacy|gdpr|audit|tenant|cross tenant|chiav|api key)/.test(text)) {
    requested.push("security_defense");
  }
  if (/(render|deploy|release|runtime|server|nodi|node|update|rollback)/.test(text)) {
    requested.push("runtime_deployment_scaling_guard", "observability_roi_guard");
  }

  return [...new Set(requested)];
}

function evaluatePolicyEngine({ tenantPolicy, entitlement, action = {}, policy = {}, context = {} }) {
  const actionType = String(action.action_type || action.type || policy.action_type || "advisory").toLowerCase();
  const mode = String(policy.mode || policy.gateway_mode || "hard-gating");
  const riskHint = Number(action.risk_hint ?? policy.risk_hint ?? 25);
  const branchRequired = normalizeList(policy.required_branches || action.required_branches, 50);
  const missingBranches = branchRequired.filter((branchId) => !entitlement.branches.includes(branchId));
  const sensitiveDomain = tenantPolicy.sensitive_domains?.some((domain) => actionType.includes(String(domain).toLowerCase())) || false;
  const destructive = ["delete", "drop", "reset", "payment", "charge", "publish", "deploy", "update"].some((token) => actionType.includes(token));
  const ownerConfirmed = context.owner_confirmed === true || action.owner_confirmed === true || policy.owner_confirmed === true;
  const sandbox = context.sandbox === true || action.sandbox === true || policy.sandbox === true;
  const rollbackReady = context.rollback_ready === true || action.rollback_ready === true || policy.rollback_ready === true;
  const crossTenant = context.cross_tenant === true || action.cross_tenant === true || policy.cross_tenant === true;
  const pii = context.contains_pii === true || action.contains_pii === true || policy.contains_pii === true;
  const missingAudit = context.audit_ready === false || action.audit_ready === false;

  let mediation = "allow";
  const reasons = [];
  if (crossTenant) {
    mediation = "block";
    reasons.push("cross_tenant_denied");
  } else if (destructive && !ownerConfirmed) {
    mediation = "confirm";
    reasons.push("owner_confirmation_required");
  } else if (destructive && !rollbackReady && !sandbox) {
    mediation = "rollback_required";
    reasons.push("rollback_or_sandbox_required");
  } else if (pii && !policy.consent_collected) {
    mediation = "defer";
    reasons.push("privacy_consent_required");
  } else if (missingBranches.length) {
    mediation = "defer";
    reasons.push("missing_required_branches");
  } else if (riskHint >= 70 || sensitiveDomain) {
    mediation = ownerConfirmed ? "sandbox" : "confirm";
    reasons.push("sensitive_or_high_risk_action");
  } else if (mode === "rewrite") {
    mediation = "rewrite";
    reasons.push("rewrite_mode_requested");
  }
  if (missingAudit) {
    mediation = mediation === "block" ? "block" : "defer";
    reasons.push("audit_required");
  }

  return {
    schema_version: "policy_engine_v1",
    tenant_id: entitlement.tenant_id,
    action_type: actionType,
    decision: mediation === "block" ? "blocked" : mediation === "allow" ? "ready" : "attention",
    action_mediation: {
      state: mediation,
      execution_allowed: mediation === "allow" || mediation === "rewrite" || mediation === "sandbox",
      owner_confirmation_required: mediation === "confirm" || mediation === "rollback_required",
      sandbox_required: mediation === "sandbox",
      rollback_required: mediation === "rollback_required",
      rewrite_allowed: mediation === "rewrite",
      blocked: mediation === "block",
      next_step:
        mediation === "allow"
          ? "execute_with_audit"
          : mediation === "rewrite"
            ? "rewrite_then_review"
            : mediation === "confirm"
              ? "ask_owner_confirmation"
              : mediation === "sandbox"
                ? "run_in_sandbox"
                : mediation === "rollback_required"
                  ? "prepare_rollback_before_execution"
                  : mediation === "defer"
                    ? "complete_missing_policy_or_data"
                    : "stop_and_redesign",
    },
    risk: {
      band: mediation === "block" ? "high" : riskHint >= 70 ? "high" : riskHint >= 35 ? "medium" : "low",
      score: Math.max(0, Math.min(100, riskHint + (destructive ? 15 : 0) + (crossTenant ? 50 : 0))),
      reasons: reasons,
    },
    policy_flags: {
      missing_required_branches: missingBranches,
      sensitive_domain: sensitiveDomain,
      destructive_action: destructive,
      cross_tenant: crossTenant,
      pii,
      tenant_policy_source: tenantPolicy.source,
    },
  };
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
      software_language_gate: "/v1/software-language-gate/evaluate",
      control_plane: "/v1/control-plane/overview",
      translator_extractor_status: "/v1/translator/extractor/status",
      translator_extractor_catalog: "/v1/translator/extractor/catalog",
      runbooks: "/v1/runbooks",
      runbook_evaluate: "/v1/runbooks/evaluate",
      release_check: "/v1/releases/manifest/check",
      evidence: "/v1/evidence/recent",
      customer_intelligence_contract: "/v1/customer-intelligence/contract",
      customer_intelligence_readiness: "/v1/customer-intelligence/readiness",
    },
  };
}

function repoRoot() {
  return path.resolve(__dirname, "../../..");
}

function extractorBinaryPath() {
  return process.env.SH_EXTRACTOR_BIN || path.join(repoRoot(), "skinharmony-rust-extractor-governor", "target", "release", "skinharmony-extract");
}

function extractorCandidatePaths() {
  return [
    extractorBinaryPath(),
    path.join(process.cwd(), "skinharmony-rust-extractor-governor", "target", "release", "skinharmony-extract"),
    path.join(repoRoot(), "target", "release", "skinharmony-extract"),
  ];
}

function resolveExtractorBinaryPath({ allowBuild = false } = {}) {
  for (const candidate of extractorCandidatePaths()) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  if (allowBuild && process.env.SH_EXTRACTOR_DISABLE_LAZY_BUILD !== "1") {
    const buildScript = path.join(repoRoot(), "scripts", "build-rust-extractor-render.sh");
    if (fs.existsSync(buildScript)) {
      execFileSync("bash", [buildScript], {
        cwd: repoRoot(),
        env: process.env,
        stdio: "ignore",
        timeout: Number(process.env.SH_EXTRACTOR_BUILD_TIMEOUT_MS || 180_000),
      });
      for (const candidate of extractorCandidatePaths()) {
        if (candidate && fs.existsSync(candidate)) return candidate;
      }
    }
  }

  return null;
}

function safeRelativeExtractorPath(value, fallbackIndex = 0) {
  const raw = String(value || `input_${fallbackIndex}.txt`).replaceAll("\\", "/").trim();
  if (!raw || path.isAbsolute(raw)) return `input_${fallbackIndex}.txt`;
  const clean = raw
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return clean || `input_${fallbackIndex}.txt`;
}

function writeExtractorInputFiles(inputDir, files = []) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("extractor_files_required");
  }

  const maxFiles = Number(process.env.SH_EXTRACTOR_MAX_FILES || 250);
  const maxFileBytes = Number(process.env.SH_EXTRACTOR_MAX_FILE_BYTES || 900_000);
  const maxTotalBytes = Number(process.env.SH_EXTRACTOR_MAX_TOTAL_BYTES || 8_000_000);
  if (files.length > maxFiles) throw new Error("extractor_too_many_files");

  const root = path.resolve(inputDir);
  let totalBytes = 0;
  const written = [];

  files.forEach((file, index) => {
    const rel = safeRelativeExtractorPath(file?.path || file?.name, index);
    const target = path.resolve(root, rel);
    if (!target.startsWith(`${root}${path.sep}`) && target !== root) {
      throw new Error("extractor_invalid_file_path");
    }

    const content = String(file?.content ?? file?.text ?? "");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > maxFileBytes) throw new Error("extractor_file_too_large");
    totalBytes += bytes;
    if (totalBytes > maxTotalBytes) throw new Error("extractor_payload_too_large");

    ensureDir(path.dirname(target));
    fs.writeFileSync(target, content, "utf8");
    written.push({ path: rel, bytes });
  });

  return { files: written, total_bytes: totalBytes };
}

function readJsonFileSafe(file, fallback = null) {
  try {
    return readJsonFile(file, fallback);
  } catch {
    return fallback;
  }
}

function readJsonlCatalog(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function extractorCatalogStats(segments = []) {
  const riskCounts = {};
  const radarCounts = {};
  const categoryCounts = {};
  for (const segment of segments) {
    const risk = segment?.risk?.level || "unknown";
    const radar = segment?.radar?.level || "unknown";
    const category = segment?.category || "unknown";
    riskCounts[risk] = (riskCounts[risk] || 0) + 1;
    radarCounts[radar] = (radarCounts[radar] || 0) + 1;
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  }
  return {
    total: segments.length,
    risk: riskCounts,
    radar: radarCounts,
    categories: categoryCounts,
    high_or_block: (riskCounts.high || 0) + (riskCounts.block || 0),
    critical_radar: radarCounts.critical || 0,
  };
}

function runRustExtractorGovernor(storageRoot, payload = {}) {
  const binary = resolveExtractorBinaryPath({ allowBuild: true });
  if (!binary) throw new Error("extractor_binary_missing");

  const jobId = `extract_${crypto.randomUUID()}`;
  const jobRoot = path.join(storageRoot, "extractor", "jobs", jobId);
  const inputDir = path.join(jobRoot, "input");
  const outputDir = path.join(jobRoot, "out");
  ensureDir(inputDir);
  ensureDir(outputDir);

  const written = writeExtractorInputFiles(inputDir, payload.files);
  const outFile = path.join(outputDir, "catalog.jsonl");
  const policyFile = path.join(outputDir, "policy.json");
  const radarFile = path.join(outputDir, "radar.json");
  const noiseFile = path.join(outputDir, "noise.json");

  const args = [
    inputDir,
    "--source-lang",
    textValue(payload.source_lang, "it"),
    "--target-lang",
    textValue(payload.target_lang, "en"),
    "--out",
    outFile,
    "--format",
    "jsonl",
    "--min-confidence",
    String(Number(payload.min_confidence ?? 0.62)),
    "--min-quality",
    String(Number(payload.min_quality ?? 0.58)),
    "--emit-policy-report",
    policyFile,
    "--emit-radar-report",
    radarFile,
    "--emit-noise-report",
    noiseFile,
  ];

  if (payload.scan_bundles === true) args.push("--scan-bundles");
  if (payload.use_sourcemaps === true) args.push("--use-sourcemaps");
  if (payload.stats !== false) args.push("--stats");
  for (const include of Array.isArray(payload.include) ? payload.include.slice(0, 20) : []) args.push("--include", String(include));
  for (const exclude of Array.isArray(payload.exclude) ? payload.exclude.slice(0, 20) : []) args.push("--exclude", String(exclude));

  const stdout = execFileSync(binary, args, {
    encoding: "utf8",
    timeout: Number(process.env.SH_EXTRACTOR_TIMEOUT_MS || 75_000),
    maxBuffer: Number(process.env.SH_EXTRACTOR_MAX_BUFFER || 12_000_000),
  });

  const segments = readJsonlCatalog(outFile);
  return {
    job_id: jobId,
    binary,
    input: written,
    stdout,
    catalog_file: outFile,
    policy_file: policyFile,
    radar_file: radarFile,
    noise_file: noiseFile,
    segments,
    stats: extractorCatalogStats(segments),
    policy: readJsonFileSafe(policyFile, null),
    radar: readJsonFileSafe(radarFile, null),
    noise: readJsonFileSafe(noiseFile, null),
  };
}

function buildExtractorCoreInput(req, extraction) {
  const stats = extraction.stats || {};
  const policySafe = extraction.policy?.publish_safe === true;
  return {
    request_id: `extractor_${extraction.job_id}`,
    generated_at: nowIso(),
    domain: "translation_extraction_governance",
    context: {
      tenant_id: req.tenantId,
      actor_id: req.body?.actor_id || "translator_connector",
      locale: req.body?.locale || "it",
      metadata: {
        source: "rust_extractor_governor",
        source_lang: textValue(req.body?.source_lang, "it"),
        target_lang: textValue(req.body?.target_lang, "en"),
        job_id: extraction.job_id,
      },
    },
    signals: [
      normalizeSignal({
        id: "extractor:catalog_size",
        label: "Segmenti traducibili trovati",
        category: "translation",
        normalized_score: Math.min(100, Number(stats.total || 0) * 2),
        confidence_hint: 88,
        tags: ["extractor", "catalog"],
      }),
      normalizeSignal({
        id: "extractor:risk",
        label: "Segmenti high/block da validare",
        category: "risk",
        normalized_score: Math.min(100, Number(stats.high_or_block || 0) * 22),
        severity_hint: Math.min(100, Number(stats.high_or_block || 0) * 28),
        confidence_hint: 86,
        tags: ["extractor", "publish_safe"],
      }),
      normalizeSignal({
        id: "extractor:radar",
        label: "Segmenti critical radar",
        category: "visibility",
        normalized_score: Math.min(100, Number(stats.critical_radar || 0) * 18),
        confidence_hint: 84,
        tags: ["extractor", "radar"],
      }),
      normalizeSignal({
        id: "extractor:policy",
        label: policySafe ? "Policy catalogo senza blocchi" : "Policy catalogo richiede validazione",
        category: "policy",
        normalized_score: policySafe ? 10 : 72,
        severity_hint: policySafe ? 10 : 72,
        confidence_hint: 90,
        evidence: [{ label: "publish_safe", value: policySafe }],
        tags: ["core_nyra_gate", "translation"],
      }),
    ],
    data_quality: {
      score: stats.total ? 82 : 45,
      missing_fields: stats.total ? [] : ["translatable_segments"],
    },
    constraints: safeConstraints({
      require_confirmation: true,
      max_control_level: "confirm",
      allow_automation: false,
      safety_mode: true,
      blocked_actions: ["publish_without_translation_validation", "publish_high_risk_untranslated"],
    }, req.coreKey, false),
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
    const proof = textValue(data.proof || data.evidence || data.source);
    const cta = textValue(data.cta || data.call_to_action);
    if (!offer) missing.push("offer");
    if (!target) missing.push("target");
    if (!proof && data.public_copy === true) missing.push("proof_or_source");
    if (!cta) missing.push("cta");
    const claimResult = claimShieldCheck({ text: textValue(data.draft || data.claims || data.copy || ""), context: data.context || {} });
    const unsupportedTrend = Boolean(data.trend_claim) && !data.sources_provided;
    const inventedProof = Boolean(data.case_study || data.testimonial) && data.proof_verified !== true;
    addSignal("claim_risk", "Rischio claim nel copy marketing", claimResult.risk_score, "claim", ["claim_guard"]);
    addSignal("brief_completeness", "Completezza brief marketing", 100 - missing.length * 18, "marketing", ["brief"]);
    addSignal("unsupported_proof", "Rischio prova/trend non supportati", unsupportedTrend || inventedProof ? 82 : 12, "marketing", ["proof"]);
    branchOutput = {
      copy_mode: "brief_first_owner_review",
      offer,
      target,
      proof_required: !proof,
      cta_required: !cta,
      safe_angle: "benefici estetici, esperienza, metodo, controllo e servizio; evitare promesse mediche o risultati garantiti.",
      blocked_claims: claimResult.issues.map((issue) => issue.term),
      unsupported_proof_risk: unsupportedTrend || inventedProof,
      owner_review_required: true,
    };
  } else if (branch === "paid_ads_guard") {
    const campaignGoal = textValue(data.campaign_goal || data.goal || data.objective);
    const audience = textValue(data.audience || data.target || data.customer_segment);
    const budget = Number(data.budget ?? data.daily_budget ?? 0);
    const landingReady = data.landing_ready === true || data.landing_page_ready === true;
    const consentReady = data.consent_ready === true || data.tracking_consent === true;
    const sensitiveTargeting = data.sensitive_targeting === true || data.health_targeting === true || data.body_insecurity_targeting === true;
    const autoPublish = data.auto_publish === true || data.publish_now === true;
    const autoBudget = data.auto_increase_budget === true || data.budget_auto_scale === true;
    const inventedPerformance = data.invented_roas === true || data.invented_cac === true || data.performance_source === "invented";
    const claimResult = claimShieldCheck({ text: textValue(data.ad_copy || data.copy || data.draft || ""), context: data.context || {} });
    if (!campaignGoal) missing.push("campaign_goal");
    if (!audience) missing.push("audience");
    if (!landingReady) missing.push("landing_page");
    addSignal("claim_risk", "Rischio claim ads", claimResult.risk_score, "claim", ["ads"]);
    addSignal("targeting_safety", "Targeting e categorie sensibili", sensitiveTargeting ? 92 : 12, "privacy", ["targeting"]);
    addSignal("budget_control", "Budget e auto-scale controllati", autoBudget || budget <= 0 ? 68 : 16, "ads", ["budget"]);
    addSignal("performance_proof", "Performance non inventata", inventedPerformance ? 90 : 10, "ads", ["proof"]);
    addSignal("publish_safety", "Pubblicazione campagna controllata", autoPublish ? 96 : 8, "ads", ["publish"]);
    branchOutput = {
      ads_mode: "draft_review_only",
      campaign_goal: campaignGoal,
      audience,
      budget,
      owner_review_required: true,
      publish_allowed: false,
      required_checks: ["Claim Guard", "landing pronta", "tracking/consenso", "budget owner-approved", "policy piattaforma ads"],
      blocked_if: { sensitive_targeting: sensitiveTargeting, auto_publish: autoPublish, auto_budget_scale: autoBudget, invented_performance: inventedPerformance },
    };
  } else if (branch === "lifecycle_crm_guard" || branch === "email_recall_guard") {
    const customerState = textValue(data.customer_state || data.lifecycle_state || data.status);
    const lastActivityDays = Number(data.last_activity_days ?? data.days_since_last_visit ?? 0);
    const consent = data.marketing_consent === true || data.consent === true;
    const channel = textValue(data.channel || data.preferred_channel);
    const autoSend = data.auto_send === true || data.send_now === true;
    const hasReason = Boolean(textValue(data.reason || data.contact_reason || data.next_action_reason));
    const isLost = customerState === "lost" || lastActivityDays >= 180;
    if (!customerState) missing.push("customer_state");
    if (!channel && branch === "email_recall_guard") missing.push("channel");
    if (!hasReason) missing.push("contact_reason");
    addSignal("consent_readiness", "Consenso marketing e canale", consent ? 8 : 88, "privacy", ["consent"]);
    addSignal("recall_priority", "Priorita recall/lifecycle", isLost ? 72 : lastActivityDays >= 60 ? 58 : 24, "crm_marketing", ["lifecycle"]);
    addSignal("message_safety", "Invio manuale e tono non aggressivo", autoSend ? 96 : 10, "crm_marketing", ["message"]);
    addSignal("brief_completeness", "Completezza motivo e prossima azione", hasReason ? 12 : 54, "crm_marketing", ["brief"]);
    branchOutput = {
      crm_marketing_mode: branch === "email_recall_guard" ? "message_draft_only" : "lifecycle_priority_advisory",
      customer_state: customerState,
      last_activity_days: Number.isFinite(lastActivityDays) ? lastActivityDays : null,
      channel,
      can_prepare_message: consent && hasReason,
      send_allowed: false,
      owner_review_required: true,
      required_checks: ["consenso", "motivo contatto", "canale", "stato cliente", "nessun invio automatico"],
      blocked_if: { missing_consent: !consent, auto_send: autoSend },
    };
  } else if (branch === "customer_behavior_analysis") {
    const profile = typeof payload.customer_profile === "object" && payload.customer_profile ? payload.customer_profile : {};
    const observedEvents = normalizeList(payload.observed_events || data.observed_events || data.events, 50);
    const requestedAction = textValue(payload.requested_action || data.requested_action || data.action);
    const sampleSize = Number(data.sample_size ?? data.customer_count ?? profile.sample_size ?? profile.customer_count ?? (profile.purchase_history_count ? 12 : 0));
    const hasRecency = data.has_recency === true || data.last_activity_available === true || Number.isFinite(Number(profile.last_visit_days)) || Number.isFinite(Number(data.last_visit_days));
    const hasFrequency = data.has_frequency === true || data.frequency_available === true || Number.isFinite(Number(profile.visit_frequency_days)) || Number.isFinite(Number(data.visit_frequency_days)) || observedEvents.includes("recurring_visits");
    const hasValue = data.has_value === true || data.value_available === true || Number.isFinite(Number(profile.average_ticket_eur)) || Number.isFinite(Number(data.average_ticket_eur)) || observedEvents.includes("high_ticket");
    const consentKnown = data.marketing_consent === true || data.consent === true || profile.marketing_consent === true;
    const autoContact = data.auto_contact === true || data.auto_send === true || data.send_now === true || requestedAction.includes("automatico") || requestedAction.includes("auto");
    const sensitiveProfiling =
      data.sensitive_profiling === true ||
      data.infers_health === true ||
      data.infers_psychology === true ||
      data.infers_sensitive_category === true ||
      observedEvents.includes("sensitive_profiling") ||
      requestedAction.includes("salute") ||
      requestedAction.includes("psicolog") ||
      requestedAction.includes("categoria protetta");
    const dataCompleteness = [hasRecency, hasFrequency, hasValue].filter(Boolean).length;
    addSignal("data_completeness", "Dati comportamento disponibili", 100 - dataCompleteness * 30, "customer_intelligence", ["data"]);
    addSignal("sample_quality", "Campione dati sufficiente", sampleSize >= 50 ? 12 : sampleSize >= 10 ? 38 : 74, "customer_intelligence", ["sample"]);
    addSignal("sensitive_inference", "Profilazione sensibile evitata", sensitiveProfiling ? 98 : 8, "privacy", ["profiling"]);
    addSignal("consent_for_contact", "Consenso prima di contatto diretto", !autoContact || consentKnown ? 10 : 92, "privacy", ["consent"]);
    branchOutput = {
      behavior_mode: "observed_patterns_only",
      confidence: sampleSize >= 50 && dataCompleteness >= 2 ? "medium_high" : "low_or_partial",
      allowed_outputs: ["segmenti operativi", "clienti da seguire", "rischio churn prudente", "next best action manuale"],
      blocked_outputs: ["diagnosi sensibili", "profilazione salute", "decisioni automatiche irreversibili"],
      owner_review_required: sensitiveProfiling || (autoContact && !consentKnown),
      blocked_if: {
        sensitive_profiling: sensitiveProfiling,
        auto_contact_without_consent: autoContact && !consentKnown,
      },
      detected_inputs: {
        nested_profile: Object.keys(profile).length > 0,
        observed_events_count: observedEvents.length,
        data_completeness: dataCompleteness,
      },
    };
  } else if (branch === "consent_ledger_guard") {
    const channels = normalizeList(data.channels || data.allowed_channels || data.channel, 20);
    const consentSource = textValue(data.consent_source || data.source);
    const revoked = data.revoked === true || data.opt_out === true;
    const profiling = data.profiling === true || data.behavioral_marketing === true;
    const autoContact = data.auto_contact === true || data.auto_send === true || data.send_now === true;
    const hasConsent = data.consent === true || data.marketing_consent === true || data.privacy_consent === true;
    addSignal("consent_state", "Consenso canale disponibile", hasConsent && !revoked ? 8 : 92, "consent_governance", ["consent"]);
    addSignal("consent_source", "Fonte consenso tracciata", consentSource ? 10 : 72, "consent_governance", ["audit"]);
    addSignal("channel_scope", "Canale consentito e separato", channels.length ? 12 : 58, "consent_governance", ["channel"]);
    addSignal("profiling_basis", "Base consenso profilazione", !profiling || hasConsent ? 12 : 88, "privacy", ["profiling"]);
    branchOutput = {
      consent_mode: "ledger_required_before_contact",
      channels,
      can_contact: hasConsent && !revoked && channels.length > 0,
      owner_review_required: revoked || autoContact || profiling,
      blocked_if: { missing_consent: !hasConsent, revoked, missing_source: !consentSource, auto_contact_without_consent: autoContact && (!hasConsent || revoked) },
    };
  } else if (branch === "event_taxonomy_guard") {
    const eventType = textValue(data.event_type || data.type);
    const source = textValue(data.source || data.system);
    const timestamp = textValue(data.timestamp || data.created_at || data.occurred_at);
    const subject = textValue(data.subject_id || data.customer_id || data.account_id);
    const tenantScope = textValue(data.tenant_id || payload.tenant_id);
    const idempotencyKey = textValue(data.idempotency_key || data.event_id);
    const crossTenant = data.cross_tenant === true || data.mixed_tenant === true;
    addSignal("event_shape", "Tipo evento e soggetto", eventType && subject ? 10 : 82, "event_taxonomy", ["shape"]);
    addSignal("event_source", "Fonte e timestamp", source && timestamp ? 10 : 74, "event_taxonomy", ["source"]);
    addSignal("event_idempotency", "Idempotenza webhook/sync", idempotencyKey ? 12 : 56, "event_taxonomy", ["idempotency"]);
    addSignal("tenant_scope", "Evento nello stesso tenant", crossTenant || !tenantScope ? 94 : 8, "tenant", ["scope"]);
    branchOutput = {
      event_mode: "normalized_event_contract",
      event_type: eventType,
      source,
      subject_id: subject,
      ready_for_ingest: Boolean(eventType && source && timestamp && subject && !crossTenant),
      blocked_if: { missing_event_type: !eventType, missing_source: !source, missing_timestamp: !timestamp, cross_tenant_event: crossTenant },
    };
  } else if (branch === "customer_360_guard") {
    const identityMatch = data.identity_match === true || data.customer_id || data.account_id;
    const hasHistory = data.has_history === true || Number(data.history_events ?? data.event_count ?? 0) > 0;
    const hasConsent = data.marketing_consent === true || data.consent === true;
    const hasOrders = data.has_orders === true || Number(data.order_count ?? 0) > 0;
    const crossScope = data.cross_scope === true || data.cross_tenant === true;
    const autoAction = data.auto_action === true || data.auto_send === true;
    addSignal("identity_match", "Identita cliente/account collegata", identityMatch ? 10 : 82, "customer_360", ["identity"]);
    addSignal("history_depth", "Storico cliente disponibile", hasHistory ? 14 : 68, "customer_360", ["history"]);
    addSignal("consent_context", "Consenso visibile in scheda", hasConsent ? 12 : 54, "consent_governance", ["consent"]);
    addSignal("scope_safety", "Vista nel perimetro tenant/brand", crossScope ? 96 : 8, "tenant", ["scope"]);
    branchOutput = {
      customer_360_mode: "single_operational_profile",
      ready_for_next_action: Boolean(identityMatch && hasHistory && !crossScope),
      owner_review_required: crossScope || autoAction,
      blocked_if: { missing_identity: !identityMatch, missing_history: !hasHistory, cross_scope: crossScope, auto_action_without_review: autoAction, missing_consent: !hasConsent },
      visible_sections: ["identity", "history", "orders", "consent", "support", "licenses", "next_action"].filter((section) => section !== "orders" || hasOrders),
    };
  } else if (branch === "journey_orchestration_guard") {
    const trigger = textValue(data.trigger || data.event_type);
    const goal = textValue(data.goal || data.journey_goal);
    const channel = textValue(data.channel || data.preferred_channel);
    const consent = data.consent === true || data.marketing_consent === true;
    const ownerApproved = data.owner_approved === true || data.owner_confirmed === true;
    const autoExecute = data.auto_execute === true || data.auto_send === true || data.send_now === true;
    const rollbackReady = data.rollback_ready === true || data.cancel_step_ready === true;
    addSignal("journey_contract", "Trigger, obiettivo e canale", trigger && goal && channel ? 10 : 80, "journey_orchestration", ["contract"]);
    addSignal("consent_gate", "Consenso per journey", consent ? 10 : 88, "privacy", ["consent"]);
    addSignal("execution_control", "Esecuzione confermata e reversibile", autoExecute && !ownerApproved ? 96 : rollbackReady ? 14 : 52, "automation", ["execution"]);
    branchOutput = {
      journey_mode: "draft_review_then_execute",
      trigger,
      goal,
      channel,
      can_prepare: Boolean(trigger && goal),
      execution_allowed: false,
      owner_review_required: true,
      blocked_if: { missing_consent: !consent, missing_trigger: !trigger, auto_execute_without_owner: autoExecute && !ownerApproved, missing_rollback: autoExecute && !rollbackReady },
    };
  } else if (branch === "billing_contract_guard") {
    const plan = textValue(data.plan || data.tier);
    const commercialEvent = data.payment_confirmed === true || data.contract_signed === true || data.trial_active === true || data.owner_override === true;
    const officialPrice = data.official_price === true || data.price_source === "official" || data.price_source === "contract";
    const expiry = textValue(data.expires_at || data.renewal_at);
    const keyLimit = Number(data.api_key_limit ?? data.seat_limit ?? data.smartdesk_seats ?? 0);
    const activate = data.activate_module === true || data.generate_key === true || data.provision_node === true;
    addSignal("commercial_event", "Evento commerciale valido", commercialEvent ? 8 : 92, "billing_contract", ["commercial"]);
    addSignal("price_source", "Prezzo/condizione ufficiale", officialPrice ? 10 : 80, "billing_contract", ["price"]);
    addSignal("expiry_policy", "Scadenza o rinnovo definito", expiry ? 12 : 56, "billing_contract", ["renewal"]);
    addSignal("limit_policy", "Limiti seat/API configurati", keyLimit > 0 ? 12 : 48, "billing_contract", ["limits"]);
    branchOutput = {
      billing_mode: "commercial_event_before_activation",
      plan,
      key_limit: keyLimit,
      can_activate: Boolean(commercialEvent && officialPrice && (!activate || keyLimit > 0)),
      owner_review_required: activate,
      blocked_if: { missing_commercial_event: !commercialEvent, invented_terms: !officialPrice, missing_limits_for_key_generation: activate && keyLimit <= 0 },
    };
  } else if (branch === "support_success_guard") {
    const ticketType = textValue(data.ticket_type || data.type || data.category);
    const blocked = data.blocked === true || data.customer_blocked === true;
    const renewalDays = Number(data.renewal_days ?? data.days_to_renewal ?? 999);
    const hasOwner = Boolean(textValue(data.owner || data.assignee || data.support_owner));
    const promisedSla = data.promise_sla === true || data.uncontracted_sla === true;
    const evidence = data.evidence_ready === true || data.logs_attached === true || data.context_ready === true;
    addSignal("support_impact", "Impatto supporto/onboarding", blocked ? 88 : renewalDays <= 30 ? 64 : 22, "support_success", ["impact"]);
    addSignal("ownership", "Owner support assegnato", hasOwner ? 10 : 70, "support_success", ["owner"]);
    addSignal("evidence", "Prove/log per chiusura", evidence ? 12 : 58, "support_success", ["evidence"]);
    addSignal("sla_integrity", "SLA non promesso fuori contratto", promisedSla ? 90 : 8, "support_success", ["sla"]);
    branchOutput = {
      support_mode: "success_priority_queue",
      ticket_type: ticketType,
      priority: blocked ? "high" : renewalDays <= 30 ? "medium" : "normal",
      owner_review_required: promisedSla || blocked,
      blocked_if: { promised_uncontracted_sla: promisedSla, close_without_evidence: data.close_ticket === true && !evidence, missing_owner: !hasOwner },
    };
  } else if (branch === "beauty_value_chain_guard") {
    const factoryCost = Number(data.factory_cost ?? data.C ?? 0);
    const listPrice = Number(data.list_price ?? data.L ?? 0);
    const distributorPrice = Number(data.distributor_price ?? data.PD ?? 0);
    const operatorPrice = Number(data.operator_price ?? data.PE ?? 0);
    const leakMargin = data.show_upstream_margin_to_downstream === true || data.leak_margin === true;
    const mandatoryPrice = data.mandatory_resale_price === true || data.price_imposed === true;
    const breaksChain = Boolean(distributorPrice && operatorPrice && operatorPrice <= distributorPrice);
    addSignal("chain_data", "Costo/listino/prezzi filiera presenti", [factoryCost, listPrice, distributorPrice, operatorPrice].filter((value) => value > 0).length >= 3 ? 16 : 74, "beauty_value_chain", ["pricing"]);
    addSignal("margin_chain", "Margine passaggio successivo sostenibile", breaksChain ? 92 : 18, "pricing", ["margin"]);
    addSignal("legal_positioning", "Prezzo finale non imposto", mandatoryPrice ? 96 : 8, "legal_privacy_compliance", ["pricing"]);
    addSignal("visibility_scope", "Margini riservati protetti", leakMargin ? 94 : 8, "tenant", ["scope"]);
    branchOutput = {
      value_chain_mode: "advisory_margin_guard",
      snapshot_required: true,
      owner_review_required: breaksChain || mandatoryPrice || leakMargin,
      blocked_if: { margin_chain_break: breaksChain, mandatory_resale_price: mandatoryPrice, upstream_margin_leak: leakMargin },
    };
  } else if (branch === "brand_distributor_network_guard") {
    const role = textValue(data.role || data.node_role);
    const brandScope = textValue(data.brand_scope || payload.brand_scope);
    const distributorId = textValue(data.distributor_id);
    const multiBrand = data.multi_brand === true;
    const crossBrand = data.cross_brand_data === true || data.scan_unowned_brand === true;
    const territory = textValue(data.territory || data.area || data.country);
    addSignal("node_identity", "Ruolo e brand scope nodo", role && brandScope ? 10 : 78, "network_governance", ["identity"]);
    addSignal("distributor_relation", "Relazione distributore/territorio", distributorId || territory ? 18 : 56, "network_governance", ["relation"]);
    addSignal("brand_scope_safety", "Dati brand isolati", crossBrand ? 96 : multiBrand ? 38 : 8, "tenant", ["brand_scope"]);
    branchOutput = {
      network_mode: "brand_scoped_relation_graph",
      role,
      brand_scope: brandScope,
      distributor_id: distributorId,
      owner_review_required: crossBrand,
      blocked_if: { missing_brand_scope: !brandScope, cross_brand_data_leak: crossBrand, unscoped_multi_brand: multiBrand && !brandScope },
    };
  } else if (branch === "product_inventory_guard") {
    const sku = textValue(data.sku || data.barcode || data.product_id);
    const quantity = Number(data.quantity ?? data.stock ?? 0);
    const movementType = textValue(data.movement_type || data.causal || data.event_type);
    const source = textValue(data.source || data.order_id || data.operator_id);
    const sellUnavailable = data.sell_unavailable === true || data.allow_backorder === true;
    const backorderPolicy = data.backorder_policy === true || data.order_on_request === true;
    const decrement = data.stock_decrement === true || movementType === "decrement";
    addSignal("sku_identity", "SKU/barcode/prodotto identificato", sku ? 10 : 82, "product_inventory", ["sku"]);
    addSignal("movement_trace", "Movimento stock tracciato", movementType && source ? 12 : 70, "product_inventory", ["movement"]);
    addSignal("stock_policy", "Disponibilita o backorder governato", quantity > 0 || !sellUnavailable || backorderPolicy ? 14 : 88, "commerce_fulfillment", ["stock"]);
    branchOutput = {
      inventory_mode: "audited_stock_movement",
      sku,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      owner_review_required: decrement || sellUnavailable,
      blocked_if: { missing_sku: !sku, decrement_without_source: decrement && !source, sell_unavailable_without_policy: sellUnavailable && !backorderPolicy && quantity <= 0 },
    };
  } else if (branch === "smartdesk_operations_guard") {
    const module = textValue(data.module || data.area);
    const plan = textValue(data.plan || data.tier);
    const sector = textValue(data.sector || data.center_type || data.industry, "beauty_center");
    const dataQualityScore = clampScore(data.data_quality_score ?? data.data_quality?.score ?? 0);
    const todayAppointments = Number(data.today_appointments ?? data.appointments_today ?? 0);
    const servicesMissingCosts = Number(data.services_missing_costs ?? data.missing_service_costs ?? 0);
    const clientsMissingContact = Number(data.clients_missing_contact ?? data.missing_client_contacts ?? 0);
    const unlinkedPayments = Number(data.unlinked_payments ?? data.payments_unlinked ?? 0);
    const operatorConfirmed = data.operator_confirmed === true || data.owner_confirmed === true;
    const aiChangesNumbers = data.ai_changes_numbers === true || data.correct_real_data === true;
    const autoSend = data.auto_send === true || data.send_now === true;
    const medicalClaim = data.medical_claim === true || data.protocol_medical === true;
    const missingData = [];
    if (dataQualityScore > 0 && dataQualityScore < 75) missingData.push("affidabilita dati sotto soglia");
    if (servicesMissingCosts > 0) missingData.push(`${servicesMissingCosts} costi servizio mancanti`);
    if (clientsMissingContact > 0) missingData.push(`${clientsMissingContact} clienti senza contatto completo`);
    if (unlinkedPayments > 0) missingData.push(`${unlinkedPayments} pagamenti da collegare`);
    const nextActions = [];
    if (servicesMissingCosts > 0) nextActions.push("apri servizi/operatori e completa i costi prima di leggere la redditivita");
    if (unlinkedPayments > 0) nextActions.push("apri cassa e collega pagamenti/appuntamenti prima del report");
    if (todayAppointments <= 2) nextActions.push("apri agenda e controlla slot scoperti o clienti da richiamare");
    if (clientsMissingContact > 0) nextActions.push("apri clienti e completa telefono/consenso per recall manuale o Gold");
    if (!nextActions.length) nextActions.push(plan === "gold" ? "leggi priorita Gold e scegli la prima azione da confermare" : "continua controllo manuale su agenda, cassa e report");
    addSignal("module_scope", "Modulo e piano definiti", module && plan ? 12 : 60, "smartdesk_operations", ["plan"]);
    addSignal("plan_boundary", "Differenza Silver/Gold rispettata", plan === "gold" || plan === "silver" || plan === "base" ? 10 : 58, "smartdesk_operations", ["tier"]);
    addSignal("data_completion", "Dati sufficienti per priorita utile", missingData.length ? 70 : 18, "smartdesk_operations", ["data_quality"]);
    addSignal("ai_boundary", "AI non corregge numeri reali", aiChangesNumbers ? 96 : 8, "smartdesk_operations", ["ai_gold"]);
    addSignal("operator_confirmation", "Conferma operatore per azioni", operatorConfirmed ? 14 : 52, "smartdesk_operations", ["confirm"]);
    addSignal("message_and_protocol_safety", "Messaggi/protocolli prudenti", autoSend || medicalClaim ? 94 : 8, "smartdesk_operations", ["safety"]);
    branchOutput = {
      smartdesk_mode: "operator_confirmed_actions",
      module,
      plan,
      sector,
      readout_mode: plan === "gold" ? "executive_priority" : plan === "silver" ? "readonly_operational_control" : "manual_assist",
      missing_data: missingData,
      next_actions: nextActions.slice(0, 4),
      communication_contract: plan === "gold"
        ? "dire cosa fare, perche conta, cosa manca e quale azione confermare"
        : "mostrare cosa controllare e dove intervenire manualmente",
      execution_allowed: false,
      owner_review_required: true,
      blocked_if: { ai_changes_real_numbers: aiChangesNumbers, auto_send_message: autoSend, medical_protocol_claim: medicalClaim, missing_operator_confirmation: !operatorConfirmed },
    };
  } else if (branch === "beauty_protocol_guard") {
    const objective = textValue(data.objective || data.goal || data.client_need);
    const area = textValue(data.area || data.zone);
    const technologies = normalizeList(data.technologies || data.devices, 20);
    const operatorConfirmed = data.operator_confirmed === true;
    const medical = data.medical_diagnosis === true || data.therapy_claim === true || data.guaranteed_result === true;
    const dataReady = Boolean(objective && area && technologies.length);
    addSignal("protocol_brief", "Dati protocollo completi", dataReady ? 12 : 72, "beauty_protocol", ["brief"]);
    addSignal("non_medical_boundary", "Confine non medicale rispettato", medical ? 98 : 8, "claim", ["protocol"]);
    addSignal("operator_review", "Conferma operatore", operatorConfirmed ? 12 : 64, "beauty_protocol", ["confirm"]);
    branchOutput = {
      protocol_mode: "non_medical_draft",
      objective,
      area,
      technologies,
      draft_allowed: true,
      execution_allowed: false,
      owner_review_required: true,
      blocked_if: { missing_brief: !dataReady, medical_or_guaranteed_claim: medical, missing_operator_confirmation: !operatorConfirmed },
    };
  } else if (branch === "segmentation_offer_guard") {
    const segment = textValue(data.segment || data.customer_segment || data.audience);
    const pricePolicyReady = data.price_policy_ready === true || data.price_guard_ready === true;
    const marginReady = data.margin_checked === true || data.margin_guard_ready === true;
    const officialPrice = data.has_official_price === true || data.price_source === "official";
    const inventedOffer = data.invented_offer === true || data.invented_discount === true || data.price_source === "invented";
    const crossTenantOffer = data.cross_tenant_offer === true || data.cross_tenant === true;
    if (!segment) missing.push("segment");
    if (!pricePolicyReady) missing.push("price_policy");
    addSignal("price_policy", "Listino e policy prezzo pronti", pricePolicyReady && officialPrice ? 10 : 82, "pricing", ["price_guard"]);
    addSignal("margin_policy", "Margine e sconto sostenibili", marginReady ? 12 : 62, "pricing", ["margin"]);
    addSignal("offer_integrity", "Offerta non inventata e scoped", inventedOffer || crossTenantOffer ? 96 : 12, "offer_strategy", ["scope"]);
    branchOutput = {
      offer_mode: "draft_with_price_guard",
      segment,
      price_guard_required: true,
      owner_review_required: true,
      publish_allowed: false,
      blocked_if: { invented_offer: inventedOffer, cross_tenant_offer: crossTenantOffer, missing_price_policy: !pricePolicyReady },
    };
  } else if (branch === "funnel_conversion_guard") {
    const funnelGoal = textValue(data.funnel_goal || data.goal || data.conversion_event);
    const cta = textValue(data.cta || data.call_to_action);
    const trackingReady = data.tracking_ready === true || data.consent_tracking_ready === true;
    const checkoutChange = data.checkout_change === true || data.checkout_modification === true;
    const inventedConversion = data.invented_conversion_rate === true || data.claim_guaranteed_growth === true;
    if (!funnelGoal) missing.push("funnel_goal");
    if (!cta) missing.push("cta");
    addSignal("funnel_completeness", "Obiettivo, CTA e tracking funnel", 100 - [funnelGoal, cta, trackingReady].filter(Boolean).length * 28, "conversion", ["funnel"]);
    addSignal("tracking_privacy", "Tracking privacy-safe", trackingReady ? 12 : 70, "privacy", ["tracking"]);
    addSignal("checkout_safety", "Checkout non modificato senza owner", checkoutChange ? 84 : 10, "commerce", ["checkout"]);
    addSignal("proof_integrity", "Conversioni non inventate", inventedConversion ? 92 : 10, "conversion", ["proof"]);
    branchOutput = {
      funnel_mode: "conversion_plan_review",
      funnel_goal: funnelGoal,
      cta,
      publish_allowed: false,
      owner_review_required: checkoutChange || inventedConversion,
      blocked_if: { checkout_change_without_owner: checkoutChange, invented_conversion_rate: inventedConversion, tracking_missing: !trackingReady },
    };
  } else if (branch === "content_localization_guard") {
    const sourceLocale = textValue(data.source_locale || "it");
    const targetLocale = textValue(data.target_locale || data.locale || "");
    const stableKeyPath = data.stable_key_path === true || Boolean(textValue(data.key_path));
    const htmlBlob = data.html_blob === true || data.translate_html === true;
    const glossaryReady = data.glossary_ready === true || data.tenant_glossary_ready === true;
    const claimRecheck = data.claim_recheck_ready === true || data.claim_guard_ready === true;
    if (!targetLocale) missing.push("target_locale");
    if (!stableKeyPath) missing.push("key_path");
    addSignal("atomic_strings", "Stringhe atomiche e key_path stabili", stableKeyPath && !htmlBlob ? 10 : 86, "localization", ["key_path"]);
    addSignal("glossary_readiness", "Glossario e tono tenant", glossaryReady ? 12 : 48, "translation", ["glossary"]);
    addSignal("claim_recheck", "Claim ricontrollati dopo localizzazione", claimRecheck ? 12 : 72, "claim", ["translation"]);
    branchOutput = {
      localization_mode: "structured_strings_only",
      source_locale: sourceLocale,
      target_locale: targetLocale,
      publish_allowed: false,
      fallback_locale: sourceLocale,
      owner_review_required: !claimRecheck || htmlBlob,
      blocked_if: { html_blob_translation: htmlBlob, unstable_key_path: !stableKeyPath, missing_claim_recheck: !claimRecheck },
    };
  } else if (branch === "codex_site_factory_guard") {
    const sourceUrl = textValue(data.source_url || data.source_site || data.clone_source);
    const targetTenant = textValue(data.target_tenant || data.tenant_target || payload.tenant_id || data.tenant_id);
    const sourceTenant = textValue(data.source_tenant || data.tenant_source);
    const contentScope = arrayValue(data.content_scope || data.pages || data.modules, 50);
    const hasBackup = data.has_backup === true || data.backup_ready === true;
    const stagingMode = data.staging_mode === true || data.mode === "staging" || data.publish_mode === "staging";
    const publishIntent = data.publish_intent === true || data.live_overwrite === true || data.mode === "live";
    const credentialsIncluded = data.credentials_included === true || data.copy_credentials === true || data.has_secrets === true;
    const privateDataIncluded = data.contains_private_data === true || data.copy_customer_data === true || data.copy_orders === true;
    const trackingClone = data.copy_tracking_ids === true || data.tracking_ids_included === true;
    const legalPagesIncluded = data.legal_pages_included === true || data.privacy_cookie_terms_ready === true;
    const claimPriceGuard = data.claim_price_guard_enabled === true || (data.claim_guard_enabled === true && data.price_guard_enabled === true);
    const coreConnector = data.core_connector_enabled === true || data.core_ready === true;
    if (!sourceUrl) missing.push("source_url");
    if (!targetTenant) missing.push("target_tenant");
    if (!contentScope.length) missing.push("content_scope");
    if (!legalPagesIncluded) missing.push("legal_pages");
    const tenantMismatch = Boolean(sourceTenant && targetTenant && sourceTenant !== targetTenant && data.cross_tenant_approved !== true);
    const cloneLeakRisk = credentialsIncluded || privateDataIncluded || trackingClone;
    const liveOverwriteRisk = publishIntent && (!hasBackup || !stagingMode);
    const governanceMissing = [legalPagesIncluded, claimPriceGuard, coreConnector].filter(Boolean).length;
    addSignal("missing_clone_inputs", "Input clonazione sito mancanti", missing.length * 18, "site_factory", ["clone_plan"]);
    addSignal("tenant_scope_risk", "Rischio scope tenant nella clonazione", tenantMismatch ? 95 : 10, "tenant", ["tenant_isolation"]);
    addSignal("data_leak_risk", "Rischio copia credenziali/dati privati/tracking", cloneLeakRisk ? 96 : 8, "security", ["privacy"]);
    addSignal("live_overwrite_risk", "Rischio sovrascrittura sito live", liveOverwriteRisk ? 90 : 12, "release", ["staging"]);
    addSignal("governance_readiness", "Readiness Core, claim, price e pagine legali", 100 - governanceMissing * 28, "governance", ["guardrails"]);
    branchOutput = {
      clone_mode: "staging_plan_only",
      source_url: sourceUrl,
      target_tenant: targetTenant,
      source_tenant: sourceTenant || null,
      content_scope_count: contentScope.length,
      publish_allowed: false,
      required_steps: [
        "mappa pagine, menu, form, media, prodotti/offerte e shortcode",
        "escludi credenziali, gateway, tracking ID, ordini, clienti e segreti",
        "crea staging o bozza prima del live",
        "collega Core, licenza, update policy, Claim Guard e Price Guard",
        "verifica legal pages, SEO, redirect e traduzioni strutturate",
        "richiedi owner confirmation prima di pubblicare o sovrascrivere",
      ],
      blocked_if: {
        tenant_mismatch: tenantMismatch,
        clone_leak_risk: cloneLeakRisk,
        live_overwrite_risk: liveOverwriteRisk,
      },
    };
  } else if (branch === "codex_website_visual_guard") {
    const tenant = textValue(payload.tenant_id || data.tenant_id);
    const brandKitReady = data.brand_tokens_ready === true || data.brand_kit_ready === true || data.uses_skinharmony_palette === true;
    const responsiveReady = data.responsive === true || data.mobile_verified === true;
    const textOverflow = data.text_overflow === true || data.overflowing_text === true;
    const deadButtons = Number(data.dead_buttons ?? 0);
    const nestedCards = data.nested_cards === true || data.card_inside_card === true;
    const technicalLabels = data.technical_labels === true || data.internal_labels_public === true;
    const mediaReady = data.has_media_assets === true || data.media_assets_ready === true;
    const assetRights = data.asset_rights === true || data.asset_policy === "approved";
    const buttonTargets = data.button_targets_verified === true || data.cta_links_verified === true;
    const contrast = clampScore(data.contrast_score ?? 78, 78);
    if (!brandKitReady) missing.push("brand_tokens");
    if (!responsiveReady) missing.push("mobile_responsive_check");
    if (!mediaReady) missing.push("media_assets");
    if (!buttonTargets) missing.push("button_targets");
    const brandRisk = brandKitReady ? 10 : 78;
    const layoutRisk = (textOverflow ? 45 : 0) + (nestedCards ? 25 : 0) + (!responsiveReady ? 30 : 0);
    const interactionRisk = Math.min(100, deadButtons * 25 + (buttonTargets ? 0 : 45));
    const assetRisk = mediaReady && assetRights ? 10 : mediaReady ? 45 : 70;
    const publicLabelRisk = technicalLabels ? 82 : 10;
    addSignal("brand_system_mismatch", "Brand kit o palette non pronti", brandRisk, "visual", ["brand"]);
    addSignal("layout_integrity", "Integrita layout, card e responsive", layoutRisk, "ux", ["layout"]);
    addSignal("interaction_readiness", "Pulsanti e CTA verificati", interactionRisk, "ux", ["buttons"]);
    addSignal("asset_readiness", "Asset visuali pertinenti e autorizzati", assetRisk, "visual", ["assets"]);
    addSignal("public_language", "Etichette tecniche esposte al pubblico", publicLabelRisk, "ux", ["copy"]);
    addSignal("contrast", "Contrasto e leggibilita", 100 - contrast, "accessibility", ["readability"]);
    branchOutput = {
      visual_mode: "premium_site_review",
      tenant,
      publish_allowed: false,
      skinharmony_palette: tenant.includes("skin") || data.uses_skinharmony_palette === true ? "#4FB6D6" : "tenant_brand_tokens_required",
      required_checks: [
        "desktop e mobile senza testo fuori contenitore",
        "card con dimensioni stabili e senza nesting inutile",
        "ogni pulsante collegato a pagina, dialog, salvataggio o feedback",
        "brand kit o palette SkinHarmony applicati",
        "media pertinenti con diritti/sorgente approvati",
        "nessuna etichetta tecnica interna nella UI pubblica",
      ],
      blocked_if: {
        text_overflow: textOverflow,
        dead_buttons: deadButtons > 0,
        nested_cards: nestedCards,
        technical_labels_public: technicalLabels,
        missing_asset_rights: mediaReady && !assetRights,
      },
    };
  } else if (branch === "codex_wordpress_platform_guard") {
    const platform = textValue(data.platform || data.cms || "wordpress").toLowerCase();
    const pluginType = textValue(data.plugin_type || data.module_type || "plugin");
    const usesWooCommerce = data.uses_woocommerce === true || data.woocommerce === true;
    const hasNonce = data.has_nonce === true || data.nonce === true;
    const hasCapability = data.has_capability_check === true || data.capability_check === true;
    const sanitizesInput = data.sanitizes_input === true || data.sanitize_input === true;
    const escapesOutput = data.escapes_output === true || data.escape_output === true;
    const configInZip = data.config_in_zip === true || data.writes_runtime_data_to_zip === true;
    const shortcodeMutates = data.shortcode_mutates_state === true || data.shortcode_writes_data === true;
    const assumesDependency = data.assumes_dependency === true || data.fatal_if_dependency_missing === true;
    const hardcodedSecret = data.hardcoded_secret === true || data.secret_in_code === true || data.logs_secret === true;
    const bypassCheckout = data.bypass_checkout === true || data.custom_checkout_without_woocommerce === true;
    const autoUpdate = data.auto_update_without_preflight === true || data.aggressive_auto_update === true;
    const crossTenant = data.cross_tenant_data_access === true || data.cross_tenant === true;
    const hasRestPermission = data.rest_permission_callback === true || data.rest_permissions === true || data.uses_rest !== true;
    const hasAdminFeedback = data.admin_feedback === true || data.buttons_have_feedback === true;
    const hasTests = data.has_tests === true || data.smoke_test === true || data.tested === true;
    const hasRollback = data.has_rollback === true || data.rollback_ready === true || data.update_touched !== true;
    const securityMissing = [hasNonce, hasCapability, sanitizesInput, escapesOutput, hasRestPermission].filter(Boolean).length;
    const structuralRisk = configInZip || shortcodeMutates || assumesDependency || bypassCheckout || autoUpdate || crossTenant;
    if (!platform.includes("wordpress")) warnings.push("Ramo ottimizzato per WordPress/WooCommerce: verificare adapter se piattaforma diversa.");
    if (usesWooCommerce && bypassCheckout) warnings.push("WooCommerce presente: evitare checkout parallelo non governato.");
    addSignal("wp_security_baseline", "Nonce, capability, sanitize, escape e REST permission", 100 - securityMissing * 18, "security", ["wordpress"]);
    addSignal("runtime_data_location", "Configurazione/dati runtime fuori dallo zip", configInZip ? 92 : 8, "architecture", ["plugin_data"]);
    addSignal("shortcode_contract", "Shortcode senza mutazioni di stato", shortcodeMutates ? 88 : 8, "wordpress", ["shortcode"]);
    addSignal("dependency_safety", "Feature detection e fallback dipendenze", assumesDependency ? 82 : 12, "compatibility", ["dependency"]);
    addSignal("secret_handling", "Segreti non hardcoded e non loggati", hardcodedSecret ? 98 : 6, "security", ["secret"]);
    addSignal("woocommerce_contract", "Checkout WooCommerce rispettato", bypassCheckout ? 86 : 10, "commerce", ["woocommerce"]);
    addSignal("update_safety", "Update con preflight, manifest e rollback", autoUpdate || !hasRollback ? 72 : 12, "release", ["update"]);
    addSignal("admin_operability", "Admin UI con feedback e test", hasAdminFeedback && hasTests ? 12 : 46, "ux", ["admin"]);
    branchOutput = {
      platform_mode: "wordpress_plugin_engineering_guard",
      platform,
      plugin_type: pluginType,
      publish_allowed: false,
      required_checks: [
        "verifica nonce, capability, sanitize input ed escape output",
        "usa option/post meta/CPT/storage controllato per dati runtime, non lo zip",
        "shortcode solo render/read; mutazioni tramite REST/admin-post/AJAX autorizzati",
        "WooCommerce tramite product/order meta, status hook e thank-you flow",
        "feature detection per dipendenze opzionali e fallback senza fatal error",
        "manifest/update con checksum, preflight, rollback e owner confirmation",
        "admin UI con pulsanti collegati, feedback visibile e test smoke",
      ],
      blocked_if: {
        missing_security_baseline: securityMissing < 5,
        config_inside_zip: configInZip,
        shortcode_mutates_state: shortcodeMutates,
        fatal_dependency_assumption: assumesDependency,
        hardcoded_secret: hardcodedSecret,
        checkout_bypass: bypassCheckout,
        unsafe_update: autoUpdate,
        cross_tenant_data_access: crossTenant,
      },
      recommended_architecture: {
        data_layer: "options/post_meta/cpt/custom_tables_if_needed",
        render_layer: "shortcodes_blocks_templates_read_only",
        mutation_layer: "rest_admin_post_ajax_with_nonce_capability",
        commerce_layer: usesWooCommerce ? "woocommerce_hooks_order_meta_license_gate" : "adapter_or_quote_first",
        external_layer: "adapter_timeout_retry_audit_no_secret_logs",
      },
      structural_risk: structuralRisk,
    };
  } else if (branch === "data_integration_orchestration") {
    const sourceSystems = arrayValue(data.source_systems || data.sources || data.source_system, 20);
    const targetSystems = arrayValue(data.target_systems || data.targets || data.target_system, 20);
    const hasSchemaMapping = data.has_schema_mapping === true || data.schema_mapping_ready === true;
    const idempotent = data.idempotent === true || data.idempotency_key === true;
    const retryReady = data.retry_policy === true || data.has_retry_policy === true;
    const timeoutReady = data.timeout_ready === true || data.has_timeout === true;
    const dedupReady = data.deduplication === true || data.has_deduplication === true;
    const webhookSigned = data.webhook_signature === true || data.signed_webhook === true || data.webhook !== true;
    const containsPii = data.contains_pii === true || data.personal_data === true;
    const directDb = data.direct_db_access === true || data.direct_cross_tenant_db_access === true;
    const crossTenant = data.cross_tenant === true || data.cross_tenant_data_access === true;
    const secretsInPayload = data.secrets_in_payload === true || data.logs_secret === true || data.secret_in_payload === true;
    const bulkSync = data.bulk_sync === true || data.sync_mode === "bulk";
    if (!sourceSystems.length) missing.push("source_systems");
    if (!targetSystems.length) missing.push("target_systems");
    if (!hasSchemaMapping) missing.push("schema_mapping");
    const reliabilityReady = [idempotent, retryReady, timeoutReady, dedupReady, webhookSigned].filter(Boolean).length;
    addSignal("mapping_readiness", "Readiness mapping dati sorgente/destinazione", hasSchemaMapping ? 12 : 78, "data_integration", ["mapping"]);
    addSignal("idempotency_reliability", "Idempotenza, retry, timeout, deduplica e firma webhook", 100 - reliabilityReady * 18, "data_integration", ["sync"]);
    addSignal("tenant_data_risk", "Rischio cross-tenant o accesso DB diretto", directDb || crossTenant ? 96 : 8, "tenant", ["tenant_isolation"]);
    addSignal("payload_sensitivity", "PII o segreti nel payload/log", secretsInPayload ? 98 : containsPii ? 58 : 8, "privacy", ["payload"]);
    addSignal("bulk_sync_risk", "Sync massivo senza controlli completi", bulkSync && reliabilityReady < 4 ? 78 : 14, "data_integration", ["bulk_sync"]);
    branchOutput = {
      integration_mode: "adapter_snapshot_sync",
      source_systems: sourceSystems,
      target_systems: targetSystems,
      required_checks: [
        "mappa schema, owner del dato e tenant scope",
        "usa idempotency key, retry bounded, timeout e deduplica",
        "firma/verifica webhook e niente segreti nei log",
        "usa snapshot minimali o aggregati per PII e dati cliente",
        "audit per import/export/sync e dead-letter manuale se fallisce",
      ],
      blocked_if: {
        missing_schema_mapping: !hasSchemaMapping,
        direct_db_access: directDb,
        cross_tenant_scope: crossTenant,
        secrets_in_payload: secretsInPayload,
        non_idempotent_bulk_sync: bulkSync && !idempotent,
      },
    };
  } else if (branch === "commerce_fulfillment_guard") {
    const hasOfficialPrice = data.has_official_price === true || data.official_price === true || data.price_source === "official";
    const checkoutConfirmed = data.checkout_confirmed === true || data.payment_status === "paid" || data.order_status === "paid";
    const contractOrTrial = data.contract_approved === true || data.trial_authorized === true || data.owner_override === true;
    const idempotency = data.order_idempotency_key === true || Boolean(textValue(data.idempotency_key));
    const stockPolicy = data.stock_policy_ready === true || data.stock_policy === "configured";
    const licensePolicy = data.license_policy_ready === true || data.license_policy === "configured";
    const refundPolicy = data.refund_policy_ready === true || data.refund_policy === "configured";
    const settlementPolicy = data.settlement_policy_ready === true || data.settlement_policy === "configured" || data.settlement_required !== true;
    const inventedPrice = data.invented_price === true || data.price_source === "invented";
    const licenseWithoutPayment = data.license_without_payment === true || (data.generate_license === true && !checkoutConfirmed && !contractOrTrial);
    const chargeWithoutCheckout = data.charge_without_checkout === true || data.manual_charge === true;
    const oversellStock = data.oversell_stock === true || data.stock_negative_allowed === true;
    const doubleFulfillment = data.double_fulfillment === true || data.duplicate_order_processing === true;
    if (!hasOfficialPrice) missing.push("official_price");
    if (!idempotency) missing.push("idempotency_key");
    const policyReady = [stockPolicy, licensePolicy, refundPolicy, settlementPolicy].filter(Boolean).length;
    addSignal("price_source", "Prezzo da listino ufficiale/contratto", inventedPrice ? 98 : hasOfficialPrice ? 8 : 64, "commerce", ["price"]);
    addSignal("fulfillment_auth", "Evento commerciale prima di licenza/seat/key", licenseWithoutPayment || chargeWithoutCheckout ? 94 : 12, "commerce", ["license"]);
    addSignal("idempotency", "Fulfillment idempotente", idempotency && !doubleFulfillment ? 10 : 76, "commerce", ["order"]);
    addSignal("policy_readiness", "Policy stock/licenze/refund/settlement", 100 - policyReady * 22, "commerce", ["policy"]);
    addSignal("stock_risk", "Stock e riserva merce coerenti", oversellStock ? 84 : 12, "stock", ["warehouse"]);
    branchOutput = {
      fulfillment_mode: "quote_or_checkout_first",
      activation_allowed: false,
      policy_ready_count: policyReady,
      required_checks: [
        "usa prezzo ufficiale, contratto o preventivo approvato",
        "ordine/pagamento/trial/override owner prima di licenza o App Key",
        "idempotency key per ordini, seat, stock e chiavi",
        "stock, acconto/saldo e settlement configurabili per azienda",
        "refund e chargeback con audit e nessun payout automatico non autorizzato",
      ],
      blocked_if: {
        invented_price: inventedPrice,
        license_without_commercial_event: licenseWithoutPayment,
        charge_without_checkout: chargeWithoutCheckout,
        double_fulfillment: doubleFulfillment,
        oversell_stock: oversellStock,
      },
    };
  } else if (branch === "observability_roi_guard") {
    const hasAudit = data.has_audit_id === true || Boolean(textValue(data.audit_id));
    const hasTrace = data.has_trace_id === true || Boolean(textValue(data.trace_id));
    const metricsDefined = data.metrics_defined === true || Array.isArray(data.metrics);
    const evidenceEnabled = data.evidence_enabled === true || data.audit_evidence === true;
    const healthcheck = data.health_check === true || data.healthcheck_ready === true;
    const logsPii = data.logs_pii === true || data.pii_in_logs === true;
    const logsSecret = data.logs_secret === true || data.secret_in_logs === true;
    const roiMetrics = arrayValue(data.roi_metrics || data.value_metrics, 20);
    const budget = Number(data.performance_budget_ms ?? data.latency_budget_ms ?? 0);
    const latency = Number(data.latency_ms ?? 0);
    const budgetExceeded = budget > 0 && latency > budget;
    if (!hasAudit) missing.push("audit_id");
    if (!metricsDefined) missing.push("metrics_defined");
    if (!healthcheck) missing.push("health_check");
    const observabilityReady = [hasAudit, hasTrace, metricsDefined, evidenceEnabled, healthcheck].filter(Boolean).length;
    addSignal("audit_traceability", "Audit, trace ed evidence layer", 100 - observabilityReady * 18, "observability", ["audit"]);
    addSignal("roi_measurability", "Metriche ROI e valore operativo", roiMetrics.length ? 12 : 68, "roi", ["telemetry"]);
    addSignal("log_safety", "PII o segreti nei log", logsSecret ? 98 : logsPii ? 82 : 8, "privacy", ["logs"]);
    addSignal("performance_budget", "Budget performance e health", budgetExceeded ? 72 : healthcheck ? 12 : 52, "performance", ["health"]);
    branchOutput = {
      observability_mode: "audit_evidence_roi",
      roi_metrics: roiMetrics,
      required_checks: [
        "audit_id e trace_id per ogni automazione",
        "log senza PII/segreti e con dati mascherati",
        "metriche ROI: tempo risparmiato, errori evitati, lead recuperati, costi ridotti",
        "health check, latency budget e stato degradato leggibile",
      ],
      blocked_if: {
        automation_without_audit: !hasAudit,
        pii_in_logs: logsPii,
        secret_in_logs: logsSecret,
        no_healthcheck: !healthcheck,
        roi_claim_without_metrics: data.roi_claim === true && !roiMetrics.length,
      },
    };
  } else if (branch === "legal_privacy_compliance_guard") {
    const consentRequired = data.consent_required === true || data.contains_personal_data === true || data.contains_sensitive_data === true;
    const consentCollected = data.consent_collected === true || data.consent_status === "collected";
    const sensitive = data.contains_sensitive_data === true || data.health_data === true || data.images === true || data.payment_data === true;
    const retention = data.retention_policy === true || data.retention_policy_ready === true;
    const dpaReady = data.dpa_ready === true || data.processor_agreement_ready === true || data.external_processor !== true;
    const claimReviewed = data.claim_reviewed === true || data.owner_claim_approval === true || data.publish_claim !== true;
    const deleteExportReady = data.delete_export_ready === true || data.data_subject_request_ready === true;
    const legalGuarantee = data.legal_guarantee_claimed === true || /compliance assoluta|garantito per legge|legalmente garantito/i.test(textValue(data.text || data.claim || data.copy));
    const crossBrand = data.cross_brand_policy_leak === true || data.cross_tenant === true;
    const privacyRisk = consentRequired && !consentCollected;
    if (consentRequired && !consentCollected) missing.push("consent");
    if (!retention) missing.push("retention_policy");
    addSignal("consent_readiness", "Consenso e finalita dati", privacyRisk ? 92 : 10, "privacy", ["gdpr"]);
    addSignal("sensitive_data_scope", "Dati sensibili, immagini, pagamenti o salute", sensitive && !dpaReady ? 84 : sensitive ? 48 : 8, "privacy", ["sensitive"]);
    addSignal("claim_review", "Claim/revisione owner prima della pubblicazione", claimReviewed ? 12 : 82, "compliance", ["claim"]);
    addSignal("tenant_policy_isolation", "Isolamento policy brand/tenant", crossBrand ? 96 : 8, "tenant", ["brand_scope"]);
    addSignal("legal_language", "Promesse legali/compliance assoluta", legalGuarantee ? 94 : 8, "legal", ["wording"]);
    branchOutput = {
      compliance_mode: "advisory_with_owner_review",
      legal_advice_replacement: false,
      required_checks: [
        "consenso, finalita, minimizzazione e retention",
        "DPA/processor agreement se dati passano da fornitori esterni",
        "claim pubblici e pricing come governance/advisory, non imposizione",
        "data export/delete request con audit",
        "nessuna garanzia legale automatica nel copy pubblico",
      ],
      blocked_if: {
        personal_data_without_consent: privacyRisk,
        sensitive_data_without_scope: sensitive && !dpaReady,
        unreviewed_claim_publish: !claimReviewed,
        cross_brand_policy_leak: crossBrand,
        legal_guarantee_claim: legalGuarantee,
        missing_retention_policy: !retention,
      },
      delete_export_ready: deleteExportReady,
    };
  } else if (branch === "agent_orchestration_guard") {
    const actionType = textValue(data.action_type || payload.action_type, "advisory");
    const gatewayMode = textValue(data.gateway_mode || payload.gateway_mode, "advisory");
    const ownerConfirmation = data.owner_confirmation === true || data.owner_confirmed === true || data.owner_confirmation_received === true;
    const sandbox = data.sandbox === true || data.dry_run === true || data.local_only === true;
    const rollback = data.rollback === true || data.rollback_ready === true || data.undo_ready === true;
    const runbookId = textValue(data.runbook_id || data.workflow_id);
    const autonomous = data.autonomous_execution === true || data.agent_auto_execute === true;
    const destructive = data.destructive_action === true || ["delete", "git_reset_hard", "drop_database"].includes(actionType);
    const publish = data.publish_intent === true || actionType === "publish";
    const payment = data.payment_action === true || actionType === "payment" || actionType === "charge";
    const crossTenant = data.cross_tenant === true || data.cross_tenant_data_access === true;
    const sensitive = destructive || publish || payment || crossTenant || actionType === "update" || actionType === "deploy";
    if (sensitive && !ownerConfirmation) missing.push("owner_confirmation");
    if (sensitive && !rollback && !sandbox) missing.push("rollback_or_sandbox");
    addSignal("action_sensitivity", "Sensibilita azione agente", destructive ? 98 : payment ? 88 : publish || crossTenant ? 76 : actionType === "update" || actionType === "deploy" ? 58 : 18, "agent_orchestration", ["action"]);
    addSignal("owner_confirmation", "Conferma owner tracciata", sensitive && !ownerConfirmation ? 86 : 8, "agent_orchestration", ["confirm"]);
    addSignal("rollback_sandbox", "Sandbox, dry-run o rollback", sensitive && !rollback && !sandbox ? 76 : 10, "agent_orchestration", ["rollback"]);
    addSignal("prompt_only_decision", "Decisione non affidata solo al prompt", autonomous && !runbookId ? 74 : 10, "agent_orchestration", ["runbook"]);
    branchOutput = {
      orchestration_mode: "core_decides_agent_executes",
      action_type: actionType,
      gateway_mode: gatewayMode,
      mediation_states: ["allow", "rewrite", "confirm", "defer", "sandbox", "block", "rollback_required"],
      execution_allowed_advisory: false,
      required_checks: [
        "decision contract prima di scrivere, pubblicare, deployare, pagare o modificare tenant",
        "owner confirmation esplicita e limitata allo scope",
        "dry-run/sandbox o rollback per azioni sensibili",
        "audit con input, verdict, branch usato, azione, esito",
      ],
      blocked_if: {
        destructive_without_owner: destructive && !ownerConfirmation,
        autonomous_sensitive_action: autonomous && sensitive,
        cross_tenant_write: crossTenant,
        no_rollback_or_sandbox: sensitive && !rollback && !sandbox,
      },
    };
  } else if (branch === "runtime_deployment_scaling_guard") {
    const targetRuntime = textValue(data.target_runtime || data.runtime_mode || "local");
    const envReady = data.env_vars_configured === true || data.environment_ready === true;
    const secretsInEnv = data.secrets_in_env === true || data.secret_store_ready === true || data.has_secrets !== true;
    const secretLeak = data.secret_in_repo === true || data.secret_in_zip === true || data.secret_in_logs === true;
    const migrationPlan = data.migration_plan === true || data.migration_plan_ready === true || data.database_migration !== true;
    const backupReady = data.backup_ready === true || data.has_backup === true || data.database_migration !== true;
    const rollbackReady = data.rollback_ready === true || data.has_rollback === true;
    const healthcheckReady = data.healthcheck_ready === true || data.health_check === true;
    const canary = data.canary_enabled === true || data.rollout_strategy === "canary" || data.deploy_to_production !== true;
    const preflight = data.preflight_passed === true || data.preflight_ready === true || data.deploy_to_production !== true;
    const queueRequired = data.queue_required === true || data.high_volume === true;
    const queueReady = data.queue_ready === true || queueRequired === false;
    const storageReady = data.storage_ready === true || data.database_ready === true || targetRuntime === "local";
    const productionDeploy = data.deploy_to_production === true || data.environment === "production";
    const unsafeProduction = productionDeploy && (!preflight || !rollbackReady || !healthcheckReady);
    if (!envReady && targetRuntime !== "local") missing.push("env_vars");
    if (!healthcheckReady) missing.push("healthcheck");
    if (productionDeploy && !rollbackReady) missing.push("rollback");
    addSignal("runtime_readiness", "Runtime, env e storage pronti", envReady && storageReady ? 12 : 66, "runtime", ["render"]);
    addSignal("secret_handling", "Segreti fuori da repo/zip/log", secretLeak ? 98 : secretsInEnv ? 8 : 62, "security", ["secret"]);
    addSignal("migration_safety", "Migrazione con piano e backup", migrationPlan && backupReady ? 12 : 82, "deployment", ["migration"]);
    addSignal("release_safety", "Preflight, healthcheck, rollback e canary", unsafeProduction ? 92 : productionDeploy ? 38 : 12, "release", ["deploy"]);
    addSignal("scaling_readiness", "Queue/cache/rate limit per carico alto", queueRequired && !queueReady ? 76 : 10, "scaling", ["queue"]);
    branchOutput = {
      deployment_mode: "local_shared_dedicated_runtime_guard",
      target_runtime: targetRuntime,
      production_deploy: productionDeploy,
      required_checks: [
        "segreti solo in env/secret store",
        "preflight, healthcheck, rollback e canary prima del live",
        "backup e migration plan per cambio schema/storage",
        "queue/cache/rate limit se high-volume",
        "degrade-safe se Core remoto non risponde",
      ],
      blocked_if: {
        production_deploy_without_preflight: productionDeploy && !preflight,
        migration_without_backup: !migrationPlan || !backupReady,
        secret_leak: secretLeak,
        missing_rollback: productionDeploy && !rollbackReady,
        missing_healthcheck: !healthcheckReady,
        queue_required_not_ready: queueRequired && !queueReady,
      },
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
    const sourceLang = textValue(data.source_lang, "it");
    const targetLang = textValue(data.target_lang, "en");
    const supportedLanguages = ["it", "en", "fr", "es"];
    const unsupportedLanguage = !supportedLanguages.includes(sourceLang) || !supportedLanguages.includes(targetLang);
    const htmlBlob = items.some((item) => /<\/?[a-z][\s\S]*>/i.test(textValue(item.source_text)));
    const alteredProtectedTokens = items.filter((item) => {
      const source = textValue(item.source_text);
      const translated = textValue(item.translated_text || item.target_text);
      if (!translated) return false;
      const tokens = source.match(/(\[[^\]]+\]|\{[^}]+\}|%[a-zA-Z0-9_$]+%|https?:\/\/\S+|\b\d+[,.]?\d*\s?(?:€|EUR|%))/g) || [];
      return tokens.some((token) => !translated.includes(token));
    }).length;
    const readiness = Math.max(0, 100 - missing.length * 35 - unstableKeys * 12 - (unsupportedLanguage ? 25 : 0) - (htmlBlob ? 30 : 0) - alteredProtectedTokens * 18);
    addSignal("payload_readiness", "Readiness payload traduzioni strutturate", readiness, "translation", ["core_translation"]);
    addSignal("unstable_keys", "Key path instabili o stringhe mancanti", Math.min(100, unstableKeys * 18), "translation", ["key_path"]);
    addSignal("protected_tokens", "Placeholder, shortcode, URL, prezzi o variabili alterati", Math.min(100, alteredProtectedTokens * 30), "translation", ["protected_tokens"]);
    addSignal("html_blob", "HTML intero inviato alla traduzione", htmlBlob ? 86 : 6, "translation", ["html"]);
    branchOutput = {
      translation_mode: "structured_strings_only",
      source_lang: sourceLang,
      target_lang: targetLang,
      item_count: items.length,
      unstable_item_count: unstableKeys,
      altered_protected_token_count: alteredProtectedTokens,
      html_blob_detected: htmlBlob,
      supported_languages: supportedLanguages,
      fallback_policy: "fallback_to_it",
      review_required: unsupportedLanguage || htmlBlob || alteredProtectedTokens > 0 || unstableKeys > 0,
    };
  } else if (branch === "ramo_testo") {
    const text = textValue(data.text || data.content || data.copy || data.draft);
    const providedIssues = normalizeTextGuardIssues(data.issues);
    const issues = providedIssues.length ? providedIssues : buildTextGuardIssuesFromClaimShield(text, data);
    if (!text) missing.push("text");
    const locale = textValue(data.locale || payload.locale, "it");
    const publicText = data.public_text === true || data.publish_intent === true || data.context === "page_copy";
    const hasKeyPath = Boolean(textValue(data.key_path || payload.key_path));
    const hasDomain = Boolean(textValue(data.domain || payload.domain));
    const hasTarget = Boolean(textValue(data.target || data.audience));
    const hasCta = Boolean(textValue(data.cta || data.call_to_action)) || publicText === false;
    const mixedLanguage = locale === "it"
      ? /\b(the|and|with|for|results|guaranteed)\b/i.test(text)
      : locale === "en"
        ? /\b(che|con|per|risultati|garantiti|paggina)\b/i.test(text)
        : false;
    const unsupportedProof = (data.mentions_study === true || data.mentions_trend === true || /studio|study|clinicamente|clinically|trend/i.test(text)) && data.sources_provided !== true;
    const highIssues = issues.filter((issue) => issue.severity === "high" || issue.severity === "blocker").length;
    const claimIssues = issues.filter((issue) => issue.type === "claim_risk" || issue.type === "publish_safety").length;
    const structureMissing = [hasKeyPath, hasDomain, hasTarget, hasCta].filter(Boolean).length;
    addSignal("issue_severity", "Gravita problemi testo/content guard", Math.min(100, highIssues * 32 + claimIssues * 24), "content_guard", ["text"]);
    addSignal("publish_safety", "Sicurezza pubblicazione testo", claimIssues ? 88 : 20, "content_guard", ["publish_safety"]);
    addSignal("text_structure", "Contesto, domain, key_path, target e CTA", 100 - structureMissing * 22, "content_guard", ["structure"]);
    addSignal("language_consistency", "Coerenza lingua del testo", mixedLanguage ? 68 : 8, "content_guard", ["language"]);
    addSignal("unsupported_proof", "Studio, trend o prova non supportati", unsupportedProof ? 84 : 8, "content_guard", ["proof"]);
    branchOutput = {
      text_context: textValue(data.context, "manual_review"),
      locale,
      issue_count: issues.length,
      claim_issue_count: claimIssues,
      structure_missing: {
        key_path: !hasKeyPath,
        domain: !hasDomain,
        target: !hasTarget,
        cta: !hasCta,
      },
      mixed_language: mixedLanguage,
      unsupported_proof: unsupportedProof,
      publish_safe_advisory: issues.every((issue) => issue.type !== "claim_risk" && issue.type !== "publish_safety" && issue.severity !== "blocker") && !unsupportedProof && !mixedLanguage,
      rule: "Ramo Testo produce review e suggested action; non salva, non pubblica e non corregge automaticamente.",
    };
  } else if (branch === "change_impact_orchestration") {
    const changeType = textValue(data.change_type || data.action_type || data.type, "code_change");
    const targetSystem = textValue(data.target_system || data.system || data.target, "unknown");
    const affectedSurfaces = arrayValue(data.affected_surfaces || data.surfaces || data.modules, 50);
    const changedFiles = arrayValue(data.changed_files || data.files, 100);
    const declaredTests = arrayValue(data.tests_declared || data.tests || data.verification, 50);
    const declaredDocs = arrayValue(data.docs_declared || data.docs || data.documentation, 50);
    const hasRollbackPlan = data.rollback_plan === true || Boolean(textValue(data.rollback_plan_text || data.rollback));
    const ownerConfirmed = data.owner_confirmation === true || data.owner_confirmed === true;
    const touchesUi = affectedSurfaces.some((item) => /ui|panel|dashboard|card|frontend|wordpress_admin/i.test(item)) || changedFiles.some((item) => /\.(tsx?|jsx?|css|php)$/i.test(item) && /admin|view|page|component|suite/i.test(item));
    const touchesRest = affectedSurfaces.some((item) => /rest|api|endpoint|route|payload|schema/i.test(item)) || changedFiles.some((item) => /src\/app|api|route|controller|rest/i.test(item));
    const touchesSnapshot = affectedSurfaces.some((item) => /snapshot|registry|manual|state/i.test(item));
    const touchesRelease = affectedSurfaces.some((item) => /zip|version|release|manifest|render|health|package/i.test(item)) || /release|version|zip|render/i.test(changeType);
    const touchesTenant = affectedSurfaces.some((item) => /tenant|scope|key|permission|policy|role|plan|license/i.test(item));
    const touchesConnector = affectedSurfaces.some((item) => /connector|codex|smart.?desk|suite|mcp|sdk|webhook/i.test(item));
    const touchesData = affectedSurfaces.some((item) => /data|customer|client|order|payment|lead|consent/i.test(item));
    const requiredActions = new Set(["record_core_audit", "declare_affected_surfaces"]);
    const testsRequired = new Set(["smoke_test"]);
    const docsRequired = new Set();
    const blockedUntil = new Set();

    if (!affectedSurfaces.length) blockedUntil.add("affected_surfaces_declared");
    if (touchesUi) {
      requiredActions.add("update_ui_contract");
      requiredActions.add("verify_rest_snapshot_pairing");
      testsRequired.add("ui_smoke_or_panel_preflight");
      docsRequired.add("manual_how_to_use");
    }
    if (touchesRest) {
      requiredActions.add("verify_api_contract");
      testsRequired.add("endpoint_contract_test");
      blockedUntil.add("connector_contract_review");
    }
    if (touchesSnapshot) {
      requiredActions.add("update_snapshot_map");
      docsRequired.add("map_snapshot");
      testsRequired.add("snapshot_readiness_check");
    }
    if (touchesRelease) {
      requiredActions.add("prepare_versioned_artifact");
      requiredActions.add("verify_health_after_publish");
      testsRequired.add("package_preflight");
      blockedUntil.add("rollback_plan");
    }
    if (touchesTenant) {
      requiredActions.add("verify_tenant_policy");
      requiredActions.add("verify_key_scope");
      testsRequired.add("permission_scope_test");
      blockedUntil.add("owner_confirmation");
    }
    if (touchesConnector) {
      requiredActions.add("verify_connector_payload");
      requiredActions.add("run_connector_doctor");
      testsRequired.add("connector_doctor");
    }
    if (touchesData) {
      requiredActions.add("verify_data_isolation");
      requiredActions.add("verify_consent_or_scope");
      blockedUntil.add("tenant_scope_check");
    }
    if (!declaredTests.length) blockedUntil.add("tests_declared");
    if (!hasRollbackPlan && (touchesRelease || touchesRest || touchesTenant || touchesData)) blockedUntil.add("rollback_plan");
    if (!ownerConfirmed && (touchesRelease || touchesTenant || touchesData)) blockedUntil.add("owner_confirmation");
    if (docsRequired.size && !declaredDocs.length) blockedUntil.add("docs_impact_declared");

    const impactScore = Math.min(100, affectedSurfaces.length * 7 + changedFiles.length * 2 + blockedUntil.size * 10 + (touchesTenant ? 15 : 0) + (touchesData ? 15 : 0) + (touchesRelease ? 12 : 0));
    const readinessScore = clampScore(100 - impactScore + declaredTests.length * 5 + declaredDocs.length * 4 + (hasRollbackPlan ? 10 : 0) + (ownerConfirmed ? 8 : 0), 50);
    addSignal("cascade_impact", "Ampiezza impatto a cascata", impactScore, "change_impact", ["cascade"]);
    addSignal("readiness", "Readiness modifica controllata", readinessScore, "change_impact", ["readiness"]);
    addSignal("blocked_until", "Blocchi prima dell'esecuzione", Math.min(100, blockedUntil.size * 18), "governance", ["blockers"]);
    branchOutput = {
      mode: "impact_plan_only",
      change_type: changeType,
      target_system: targetSystem,
      affected_surfaces: affectedSurfaces,
      subbranches_used: [
        "dependency_impact_scan",
        "compatibility_guard",
        "documentation_impact",
        "test_impact",
        "release_impact",
        "tenant_policy_impact",
        "connector_contract_impact",
        "rollback_impact",
        "audit_evidence_impact",
      ],
      required_actions: [...requiredActions],
      tests_required: [...testsRequired],
      docs_required: [...docsRequired],
      blocked_until: [...blockedUntil],
      release_required: touchesRelease,
      rollback_required: touchesRelease || touchesRest || touchesTenant || touchesData,
      owner_confirmation_required: touchesRelease || touchesTenant || touchesData,
      audit_required: true,
      execution_allowed: false,
      nyra_explanation_contract: "Spiegare in linguaggio umano cosa cambia, perche serve, cosa blocca e quale primo passo sblocca il lavoro.",
      rule: "Questo ramo non esegue modifiche: produce il piano di impatto che Codex deve rispettare prima di implementare.",
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
  const setupTokens = createSetupTokenStore(storageRoot, audit);
  const snapshots = snapshotStore(storageRoot);
  const reviews = reviewStore(storageRoot);
  const evidence = evidenceStore(storageRoot);
  const tenants = tenantRegistryStore(storageRoot);
  const entityGraph = entityGraphStore(storageRoot);
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: process.env.CORE_SERVICE_JSON_LIMIT || "10mb" }));

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

  app.post("/v1/setup-token/create", requireAdmin, (req, res) => {
    try {
      const body = req.body || {};
      const tenantInput = body.tenant && typeof body.tenant === "object" ? body.tenant : null;
      let tenant = null;
      if (tenantInput) {
        tenant = tenants.upsert({
          ...tenantInput,
          tenant_id: tenantInput.tenant_id || body.tenant_id,
          brand_scope: tenantInput.brand_scope || body.brand_scope,
          environment: tenantInput.environment || body.environment,
          active_branch_groups: tenantInput.active_branch_groups || body.branch_groups || body.active_branch_groups,
          active_branches: tenantInput.active_branches || body.branches || body.active_branches,
        });
        audit.append("core_tenant_upserted", { tenant_id: tenant.tenant_id, sector: tenant.sector, environment: tenant.environment, source: "setup_token_create" });
      }
      const result = setupTokens.create({
        ...body,
        tenant: tenant || tenantInput || body.tenant,
        tenant_id: body.tenant_id || tenant?.tenant_id,
        brand_scope: body.brand_scope || tenant?.brand_scope,
        environment: body.environment || tenant?.environment,
      });
      res.status(201).json({
        ok: true,
        setup_token: result.setup_token,
        token: result.record,
        tenant,
        warning: "Il setup token in chiaro viene mostrato solo ora e puo essere consumato una sola volta.",
      });
    } catch (error) {
      publicError(res, 400, error.message || "setup_token_create_failed");
    }
  });

  app.post("/v1/setup-token/consume", (req, res) => {
    const body = req.body || {};
    const consumed = setupTokens.consume(body.setup_token || body.token, {
      actor_id: body.actor_id,
      connector: body.connector || body.client,
      host: body.host,
    });
    if (!consumed.ok) return publicError(res, consumed.status || 400, consumed.error);

    try {
      const setupRecord = consumed.record;
      const keyResult = keyStore.createKey({
        tenant_id: setupRecord.tenant_id,
        brand_scope: setupRecord.brand_scope,
        key_type: setupRecord.key_type,
        preset: setupRecord.preset,
        label: setupRecord.label,
        tier: setupRecord.plan,
        suite_tier: setupRecord.plan,
        allowed_scopes: setupRecord.scopes,
        active_branches: setupRecord.branches,
        suite_modules: setupRecord.modules,
        suite_limits: setupRecord.limits,
        expires_at: setupRecord.key_expires_at,
        metadata: {
          tier: setupRecord.plan,
          suite_tier: setupRecord.plan,
          role: setupRecord.role,
          setup_token_id: setupRecord.token_id,
          active_branch_groups: setupRecord.branch_groups,
          active_branches: setupRecord.branches,
          suite_modules: setupRecord.modules,
          suite_limits: setupRecord.limits,
          environments: [setupRecord.environment].filter(Boolean),
          gate_mode: setupRecord.gate_mode,
          recommended_folders: setupRecord.recommended_folders,
          setup_policy: setupRecord.policy,
          setup_metadata: setupRecord.metadata,
        },
      });
      const tenant = tenants.get(setupRecord.tenant_id);
      const branchResolution = resolveBranchesForKey(keyResult.record);
      const entitlement = buildEntitlement(keyResult.record, branchResolution);
      const tenantPolicy = getTenantPolicy(setupRecord.tenant_id, setupRecord.plan);
      const profile = buildBootstrapProfile({
        keyRecord: keyResult.record,
        tenant,
        tenantPolicy,
        branchResolution,
        entitlement,
      });
      audit.append("core_bootstrap_profile_issued", {
        tenant_id: setupRecord.tenant_id,
        key_id: keyResult.record.key_id,
        setup_token_id: setupRecord.token_id,
      });
      return res.json({
        ok: true,
        api_key: keyResult.key,
        key: keyResult.record,
        setup_token: setupRecord,
        profile,
        warning: "La API key in chiaro viene mostrata solo ora. Salvarla nel connector, non nel plugin pubblico.",
      });
    } catch (error) {
      audit.append("core_setup_token_consume_failed", {
        tenant_id: consumed.record?.tenant_id,
        token_id: consumed.record?.token_id,
        error: error.message || "key_generation_failed",
      });
      return publicError(res, 400, error.message || "setup_token_consume_failed");
    }
  });

  app.post("/v1/setup-token/revoke", requireAdmin, (req, res) => {
    const record = setupTokens.revoke(req.body?.token_id || req.body?.setup_token || req.body?.token, req.body?.reason);
    if (!record) return publicError(res, 404, "setup_token_not_found");
    return res.json({ ok: true, token: record });
  });

  app.get("/v1/setup-token/list", requireAdmin, (req, res) => {
    res.json({ ok: true, tokens: setupTokens.list({ tenant_id: req.query.tenant_id }) });
  });

  app.get("/v1/bootstrap/profile", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const branchResolution = resolveBranchesForKey(req.coreKey);
    const entitlement = buildEntitlement(req.coreKey, branchResolution);
    const tenant = tenants.get(req.tenantId);
    const tenantPolicy = getTenantPolicy(req.tenantId, req.coreKey?.metadata?.tier);
    const profile = buildBootstrapProfile({
      keyRecord: req.coreKey,
      tenant,
      tenantPolicy,
      branchResolution,
      entitlement,
    });
    audit.append("core_bootstrap_profile_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id });
    return res.json(profile);
  });

  app.get("/v1/tenants/registry", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const all = tenants.list();
    const visible = hasScope(req.coreKey, SCOPES.ADMIN_TENANT)
      ? all
      : all.filter((tenant) => tenant.tenant_id === req.tenantId);
    audit.append("core_tenant_registry_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, count: visible.length });
    res.json({
      ok: true,
      tenants: visible,
      schema_version: "tenant_registry_v1",
      rule: "Universal Core resta agnostico: settore, dizionario e policy entrano dal tenant registry.",
    });
  });

  app.post("/v1/tenants/upsert", requireAdmin, (req, res) => {
    try {
      const tenant = tenants.upsert(req.body || {});
      audit.append("core_tenant_upserted", { tenant_id: tenant.tenant_id, sector: tenant.sector, environment: tenant.environment });
      res.status(201).json({ ok: true, tenant, schema_version: "tenant_registry_v1" });
    } catch (error) {
      publicError(res, 400, error.message || "tenant_upsert_failed");
    }
  });

  app.get("/v1/tenant/status", createAuth(keyStore, audit), (req, res) => {
    const branchResolution = resolveBranchesForKey(req.coreKey);
    const suitePolicy = buildSuitePolicy(req.coreKey, branchResolution);
    const entitlement = buildEntitlement(req.coreKey, branchResolution);
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
      entitlement,
      suite_policy: suitePolicy,
    });
  });

  app.get("/v1/entitlements/current", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const branchResolution = resolveBranchesForKey(req.coreKey);
    const entitlement = buildEntitlement(req.coreKey, branchResolution);
    audit.append("core_entitlement_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, tier: entitlement.tier });
    res.json({ ok: true, entitlement });
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

  app.get("/v1/control-plane/dashboard", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const branchResolution = resolveBranchesForKey(req.coreKey);
    const entitlement = buildEntitlement(req.coreKey, branchResolution);
    const graph = entityGraph.readTenant(req.tenantId);
    const maturity = branchMaturityReport();
    const overview = buildControlPlaneOverview({
      tenantId: req.tenantId,
      keyRecord: req.coreKey,
      keyStore,
      snapshot: snapshots.latest(req.tenantId),
      auditEvents: audit.recent(200),
      evidenceEvents: evidence.recent(req.tenantId, 50),
    });
    const riskEntities = graph.entities.filter((entity) => ["medium", "high", "critical"].includes(entity.risk_band));
    audit.append("core_control_plane_dashboard_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id });
    res.json({
      ok: true,
      schema_version: "horizontal_control_plane_dashboard_v1",
      tenant_id: req.tenantId,
      overview,
      entitlement,
      network_graph_summary: {
        entity_count: graph.entities.length,
        relation_count: graph.relations.length,
        risk_entity_count: riskEntities.length,
        entity_types: graph.entities.reduce((acc, entity) => {
          acc[entity.entity_type] = (acc[entity.entity_type] || 0) + 1;
          return acc;
        }, {}),
      },
      branch_maturity_summary: Object.values(maturity.statuses).reduce((acc, item) => {
        acc[item.maturity] = (acc[item.maturity] || 0) + 1;
        return acc;
      }, {}),
      action_mediation_states: ["allow", "rewrite", "confirm", "defer", "sandbox", "block", "rollback_required"],
      next_missing_blocks: [
        "external_enterprise_ui",
        "usage_metering_billing_webhook",
        "customer_self_service_connector_install",
        "tenant_policy_editor_ui",
      ],
    });
  });

  app.get("/v1/connectors/sdk/manifest", createAuth(keyStore, audit, SCOPES.READ_CONTROL_PLANE), (req, res) => {
    audit.append("core_connector_sdk_manifest_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id });
    res.json({ ok: true, tenant_id: req.tenantId, sdk: buildConnectorSdkManifest() });
  });

  app.get("/v1/translator/extractor/status", createAuth(keyStore, audit, SCOPES.EXTRACT_CATALOG), (req, res) => {
    const binary = resolveExtractorBinaryPath({ allowBuild: false });
    audit.append("core_translation_extractor_status_read", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      binary_available: Boolean(binary),
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      extractor: {
        status: binary ? "ready" : "missing_binary",
        mode: "core_sidecar_process",
        binary: binary || extractorBinaryPath(),
        candidate_paths: extractorCandidatePaths(),
        lazy_build_enabled: process.env.SH_EXTRACTOR_DISABLE_LAZY_BUILD !== "1",
        route: "/v1/translator/extractor/catalog",
        does_translate: false,
        publish_default: false,
      },
    });
  });

  app.post("/v1/translator/extractor/catalog", createAuth(keyStore, audit, SCOPES.EXTRACT_CATALOG), (req, res) => {
    try {
      const extraction = runRustExtractorGovernor(storageRoot, req.body || {});
      const coreInput = buildExtractorCoreInput(req, extraction);
      const output = runUniversalCore(coreInput);
      const decisionContract = normalizeDecisionContract(output, {
        action_type: "translation_catalog_extraction",
        publish_intent: false,
      });
      const evidenceRecord = evidence.append(req.tenantId, "translation_catalog_extracted", {
        job_id: extraction.job_id,
        source_lang: textValue(req.body?.source_lang, "it"),
        target_lang: textValue(req.body?.target_lang, "en"),
        stats: extraction.stats,
        catalog_file: extraction.catalog_file,
        policy_file: extraction.policy_file,
        radar_file: extraction.radar_file,
        noise_file: extraction.noise_file,
        decision_contract: decisionContract,
        publish_allowed: false,
      });
      audit.append("core_translation_catalog_extracted", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        job_id: extraction.job_id,
        segment_count: extraction.stats.total,
        high_or_block: extraction.stats.high_or_block,
        evidence_id: evidenceRecord.evidence_id,
      });
      res.json({
        ok: true,
        tenant_id: req.tenantId,
        extractor: {
          job_id: extraction.job_id,
          mode: "rust_governor_inside_universal_core",
          does_translate: false,
          stdout: extraction.stdout,
          input: extraction.input,
          stats: extraction.stats,
        },
        catalog: {
          format: "jsonl",
          total: extraction.segments.length,
          segments: extraction.segments,
        },
        policy: extraction.policy,
        radar: extraction.radar,
        noise: extraction.noise,
        output,
        decision_contract: decisionContract,
        evidence: evidenceRecord,
        guardrail: {
          publish_allowed: false,
          execution_allowed: false,
          owner_confirmation_required: true,
          mode: "catalog_only_then_core_nyra_publish_safe_gate",
        },
      });
    } catch (error) {
      const code = error.message || "extractor_failed";
      const status = code === "extractor_binary_missing" ? 503 : code.includes("too_large") ? 413 : 400;
      audit.append("core_translation_extractor_failed", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        error: code,
      });
      publicError(res, status, code);
    }
  });

  app.get("/v1/customer-intelligence/contract", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const branchResolution = resolveBranchesForKey(req.coreKey);
    const contract = buildCustomerIntelligenceContract({
      tenantId: req.tenantId,
      plan: req.coreKey?.metadata?.tier || req.coreKey?.preset || "",
      branches: branchResolution.selected_branches || [],
      scopes: req.coreKey?.allowed_scopes || [],
    });
    audit.append("core_customer_intelligence_contract_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id });
    res.json({ ok: true, contract });
  });

  app.post("/v1/customer-intelligence/readiness", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const readiness = summarizeCustomerIntelligenceReadiness(req.body || {});
    audit.append("core_customer_intelligence_readiness_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      event_count: readiness.event_count,
      consent_count: readiness.consent_count,
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      readiness,
      rule: "Readiness e solo valutazione: nessun invio automatico e nessuna modifica dati cliente.",
    });
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

  function handleSemanticSelection(req, res) {
    const body = req.body || {};
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    if (!candidates.length) {
      return publicError(res, 400, "semantic_selection_candidates_missing", "Provide candidates array.");
    }
    const result = selectSemanticCandidates(candidates, {
      tenant_id: req.tenantId,
      target_language: body.target_language || body.locale || "it",
      adapter: body.adapter || "generic",
      intent: body.intent || "semantic_selection",
      limit: Number(body.limit || 200),
    });
    audit.append("core_semantic_selection_run", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      adapter: body.adapter || "generic",
      candidate_count: candidates.length,
      summary: result.summary,
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      schema_version: "semantic_selection_v1",
      read_only: true,
      result,
    });
  }

  app.post("/v1/semantic-selection", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    return handleSemanticSelection(req, res);
  });

  app.post("/api/v1/semantic-selection", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    return handleSemanticSelection(req, res);
  });

  app.get("/v1/software-language-gate/schema", (req, res) => {
    res.json({
      ok: true,
      schema_version: SOFTWARE_LANGUAGE_GATE_VERSION,
      mandatory: true,
      horizontal: true,
      applies_to: ["skinharmony_core_translator", "smartdesk", "ai_gold", "site_suite", "future_core_nyra_software"],
      required_pipeline: ["v2_semantic_filter", "v1_writing_policy_filter", "v0_final_visible_risk_gate"],
      blocking_radars: ["cta", "errors", "onboarding_trial", "ai_gold_copy", "legal_privacy", "pricing_payment"],
      rule: "No software language/runtime/AI copy is ready until horizontal radars plus V2/V1/V0 plus Core/Nyra governance pass.",
    });
  });

  app.get("/api/v1/software-language-gate/schema", (req, res) => {
    res.redirect(307, "/v1/software-language-gate/schema");
  });

  function handleSoftwareLanguageGate(req, res) {
    const result = evaluateSoftwareLanguageGate({
      ...(req.body || {}),
      tenant_id: req.tenantId,
    });
    audit.append("core_software_language_gate_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      app: result.app,
      target_lang: result.target_lang,
      language_ready: result.language_ready,
      decision: result.decision,
      entries: result.summary.entries,
      raw_findings_before_noise: result.summary.raw_findings_before_noise,
      noise_removed: result.summary.noise_removed,
      findings: result.summary.findings,
      blocking_high: result.summary.blocking_high,
    });
    return res.json({
      ...result,
      audit_event: "core_software_language_gate_evaluated",
      source: "universal_core_render",
    });
  }

  app.post("/v1/software-language-gate/evaluate", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    return handleSoftwareLanguageGate(req, res);
  });

  app.post("/api/v1/software-language-gate/evaluate", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    return handleSoftwareLanguageGate(req, res);
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
      groups: deterministicBranchGroups(),
      packages: BRANCH_PACKAGES,
      tenant_package: resolution,
      rule: "Ogni ramo produce decisioni advisory/read-only. Azioni operative e pubblicazione richiedono conferma owner.",
    });
  });

  app.get("/v1/branches/maturity", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const report = branchMaturityReport();
    audit.append("core_branch_maturity_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id });
    res.json({ ok: true, ...report });
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
      groups: deterministicBranchGroups(),
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

  app.post("/v1/nira/core-bridge", createAuth(keyStore, audit, SCOPES.AUTOMATION_CODEX), (req, res) => {
    const ownerConfirmed = req.body?.owner_confirmed === true || req.body?.owner_confirmation === true;
    const requestedGodMode = req.body?.mode === "god_mode_owner_only" || req.body?.god_mode === true;
    const ownerVerified = Boolean(ownerConfirmed && hasScope(req.coreKey, SCOPES.AUTOMATION_CODEX));
    const requestedBranches = inferNiraBranchRequest(req.body || {});
    const branchContext = composeBranchContext({
      keyRecord: req.coreKey,
      requestedBranches,
      task: String(req.body?.task || req.body?.request || req.body?.text || ""),
      userInput: String(req.body?.text || req.body?.request || req.body?.task || ""),
      locale: req.body?.locale || "it",
    });
    const result = runNiraUniversalCoreBridge({
      request_id: req.body?.request_id || `nira_service_${crypto.randomUUID()}`,
      text: String(req.body?.text || req.body?.request || req.body?.task || ""),
      tenant_id: req.tenantId,
      owner_verified: ownerVerified,
      access_scope: ownerVerified ? "owner_full" : "limited",
      mode: requestedGodMode ? "god_mode_owner_only" : "standard",
      target_system: req.body?.target_system || "universal_core",
      scenario_candidates: Array.isArray(req.body?.scenario_candidates)
        ? req.body.scenario_candidates
        : (Array.isArray(req.body?.scenarios) ? req.body.scenarios : undefined),
      minimum_uniqueness_ratio: typeof req.body?.minimum_uniqueness_ratio === "number"
        ? req.body.minimum_uniqueness_ratio
        : undefined,
      core_branch_context: {
        tier: branchContext.tier,
        selected_branches: branchContext.selected_branches,
        denied_branches: branchContext.denied_branches,
        selected_groups: branchContext.selected_groups,
        denied_groups: branchContext.denied_groups,
        branch_profiles: branchContext.branch_profiles,
      },
    });
    const guardedResult = {
      ...result,
      selected_by_core: {
        ...result.selected_by_core,
        can_execute: false,
      },
      automation_plan: {
        ...result.automation_plan,
        execution_allowed: false,
        next_step: "Preparare runbook/evidence e chiedere conferma owner prima di ogni scrittura reale.",
      },
      core_branch_diagnostics: {
        ...(result.core_branch_diagnostics || {}),
        branch_router_used: true,
        actual_selected_branches: branchContext.selected_branches,
        actual_denied_branches: branchContext.denied_branches,
        actual_selected_groups: branchContext.selected_groups,
        actual_denied_groups: branchContext.denied_groups,
      },
    };
    audit.append("core_nira_bridge_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      mode: guardedResult.mode,
      god_mode_active: guardedResult.god_mode_active,
      control_level: guardedResult.selected_by_core.control_level,
      risk_band: guardedResult.selected_by_core.risk_band,
      execution_allowed: guardedResult.automation_plan.execution_allowed,
      selected_branches: guardedResult.core_branch_diagnostics.actual_selected_branches,
      denied_branches: guardedResult.core_branch_diagnostics.actual_denied_branches,
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      result: guardedResult,
      branch_context: {
        selected_branches: branchContext.selected_branches,
        denied_branches: branchContext.denied_branches,
        selected_groups: branchContext.selected_groups,
        denied_groups: branchContext.denied_groups,
        tier: branchContext.tier,
      },
      guardrail: {
        execution_allowed: false,
        owner_confirmation_required: true,
        audit_required: true,
        mode: "nira_prepare_core_select_no_auto_execute",
      },
    });
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

  app.get("/v1/entity-graph", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const graph = entityGraph.readTenant(req.tenantId);
    audit.append("core_entity_graph_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, entities: graph.entities.length, relations: graph.relations.length });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      schema_version: "generic_entity_graph_v1",
      graph,
      primitive_types: ["tenant", "entity", "relation", "transaction", "policy", "event", "document", "product", "user", "license", "node"],
      rule: "Il Core resta orizzontale: i verticali sono dizionari/policy sopra il grafo generico.",
    });
  });

  app.post("/v1/entity-graph/upsert", createAuth(keyStore, audit, SCOPES.WRITE_SNAPSHOT), (req, res) => {
    const graph = entityGraph.upsert(req.tenantId, req.body || {});
    const evidenceRecord = evidence.append(req.tenantId, "entity_graph_upserted", {
      key_id: req.coreKey.key_id,
      entity_count: graph.entities.length,
      relation_count: graph.relations.length,
    });
    audit.append("core_entity_graph_upserted", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, entities: graph.entities.length, relations: graph.relations.length });
    res.status(201).json({ ok: true, tenant_id: req.tenantId, graph, evidence: evidenceRecord });
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
    const branchResolution = resolveBranchesForKey(req.coreKey);
    const entitlement = buildEntitlement(req.coreKey, branchResolution);
    const tenantPolicy = getTenantPolicy(req.tenantId, req.body?.plan || req.coreKey?.metadata?.tier);
    const mediation = evaluatePolicyEngine({
      tenantPolicy,
      entitlement,
      action: req.body?.action || req.body || {},
      policy,
      context: req.body?.context || {},
    });
    const result = {
      status: policy.approval_required ? "approval_required" : "ok",
      hard_block: false,
      owner_confirmation_required: Boolean(policy.approval_required),
      recommended_action: policy.approval_required ? "owner_review_before_execution" : "continue_with_audit",
      policy_engine: mediation,
    };
    audit.append("core_policy_checked", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, status: result.status, mediation: mediation.action_mediation.state });
    res.json({ ok: true, result });
  });

  app.post("/v1/action-mediation/evaluate", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const branchResolution = resolveBranchesForKey(req.coreKey);
    const entitlement = buildEntitlement(req.coreKey, branchResolution);
    const tenantPolicy = getTenantPolicy(req.tenantId, req.body?.plan || req.coreKey?.metadata?.tier);
    const result = evaluatePolicyEngine({
      tenantPolicy,
      entitlement,
      action: req.body?.action || req.body || {},
      policy: req.body?.policy || {},
      context: req.body?.context || {},
    });
    const evidenceRecord = evidence.append(req.tenantId, "action_mediation_evaluated", {
      request: req.body || {},
      result,
      key_id: req.coreKey.key_id,
    });
    audit.append("core_action_mediation_evaluated", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, state: result.action_mediation.state, evidence_id: evidenceRecord.evidence_id });
    res.json({ ok: true, result, evidence: evidenceRecord });
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
