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
import { buildDeepNyraRuntime } from "./deepNyraRuntime.js";
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
  deterministicBranchTaxonomy,
  resolveBranchesForKey,
} from "../branches/index.js";
import { buildSuitePolicy } from "./suitePolicy.js";
import { getTenantPolicy } from "./tenantRegistry.js";
import { checkDomainPackRequest, listDomainPacks, publicDomainPack, resolveDomainPackForKey } from "./domainPacks.js";
import { nyraBranchCatalog, routeNyraBranches } from "./nyraBranchNetwork.js";
import { multiAgentRegistry, planMultiAgentRun } from "./multiAgentArchitecture.js";
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
import { buildWorkPreflight } from "./workPreflight.js";
import {
  analyzeScenarios,
  evaluateCounterfactuals,
  evaluateEvents,
  rankHypotheses,
  runIntelligenceWorkflow,
  selectDecision,
  summarizeCalibration,
  verifyOutcome,
} from "./intelligenceEngine.js";
import { buildActionAuthorization } from "./actionAuthorization.js";
import { applyActionRiskProfile, classifyActionRisk } from "./actionRisk.js";
import { createCoreRuntimeWorker } from "./coreRuntimeWorker.js";
import { createIcfKernel } from "./icfKernel.js";
import { coreRuntimeHierarchyStatus, evaluateCoreRuntimeHierarchy } from "./coreRuntimeHierarchy.js";
import {
  analyzeEmbeddedSoftwareArtifact,
  embeddedComponentManifest,
  MAX_EMBEDDED_ARTIFACT_BYTES,
} from "./embeddedSoftwareIntelligence.js";
import { buildResearchPlan, validateResearchEvidence } from "./researchCortex.js";
import {
  createUniversalSoftwareJobManager,
  issueSoftwareAuthorizationEnvelope,
  universalSoftwareComponentManifest,
} from "./universalSoftwareIntelligence.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORAGE_ROOT = path.resolve(__dirname, "../storage");
const SERVICE_VERSION = "0.10.2-nyra-live-validation";
const SERVICE_NAME = String(process.env.CORE_SERVICE_NAME || "universal-core-service").trim();
const OWNER_CONTEXT_ASSERTION_VERSION = "owner_context_assertion_v1";

function nowIso() {
  return new Date().toISOString();
}

function ownerContextCanonical(context) {
  return JSON.stringify({
    version: context.assertion_version,
    audience: context.audience,
    tenant_id: context.tenant_id,
    access_mode: context.access_mode,
    role: context.role,
    delegated_actor: context.delegated_actor,
    owner_verified: context.owner_verified,
    issued_at: context.issued_at,
  });
}

function verifyOwnerContextAssertion(context, secret, tenantId, now = Date.now()) {
  if (!context || typeof context !== "object" || !secret) return false;
  if (context.assertion_version !== OWNER_CONTEXT_ASSERTION_VERSION) return false;
  if (context.audience !== "nira_core_bridge" || context.tenant_id !== tenantId) return false;
  if (context.owner_verified !== true || context.role !== "owner_root" || context.access_mode !== "god_mode") return false;
  const issuedAt = Date.parse(String(context.issued_at || ""));
  if (!Number.isFinite(issuedAt) || issuedAt > now + 30_000 || now - issuedAt > 120_000) return false;
  const supplied = String(context.assertion || "");
  if (!/^ocs_[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = `ocs_${crypto.createHmac("sha256", secret)
    .update(`owner-context\u0000${ownerContextCanonical(context)}`)
    .digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
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
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporary, file);
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

function sanitizeMemoryText(value, max = 2_000) {
  return String(value || "")
    .slice(0, max)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[REDACTED_SECRET]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_SECRET]")
    .replace(/\b(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED_SECRET]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
}

function normalizeTenantMemoryContext(raw, tenantId) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "memory_context_invalid" };
  if (String(raw.tenant_id || "") !== tenantId) return { ok: false, error: "memory_context_tenant_mismatch" };
  const list = (value, max) => Array.isArray(value) ? value.slice(0, max).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    return {
      id: sanitizeMemoryText(item.id, 100),
      kind: sanitizeMemoryText(item.kind, 40),
      title: sanitizeMemoryText(item.title, 240),
      summary: sanitizeMemoryText(item.summary ?? item.value, 2_000),
      direction: ["support", "against"].includes(String(item.direction || "").toLowerCase())
        ? String(item.direction).toLowerCase()
        : undefined,
      strength: Number.isFinite(Number(item.strength)) ? Math.max(0, Math.min(1, Number(item.strength))) : undefined,
      reliability: Number.isFinite(Number(item.reliability)) ? Math.max(0, Math.min(1, Number(item.reliability))) : undefined,
      verified: item.verified === true || item.status === "verified",
      source: item.source ? sanitizeMemoryText(item.source, 240) : undefined,
      decisions: normalizeList(item.decisions, 10).map((entry) => sanitizeMemoryText(entry, 500)),
      outcomes: normalizeList(item.outcomes, 10).map((entry) => sanitizeMemoryText(entry, 500)),
      next_steps: normalizeList(item.next_steps, 10).map((entry) => sanitizeMemoryText(entry, 500)),
      project_id: item.project_id ? sanitizeMemoryText(item.project_id, 64) : null,
      session_id: item.session_id ? sanitizeMemoryText(item.session_id, 64) : null,
      to_agent_id: item.to_agent_id ? sanitizeMemoryText(item.to_agent_id, 64) : undefined,
      status: item.status ? sanitizeMemoryText(item.status, 40) : undefined,
      created_at: sanitizeMemoryText(item.created_at, 40),
    };
  }).filter(Boolean) : [];
  const latest = list(raw.latest_checkpoint ? [raw.latest_checkpoint] : [], 1)[0] || null;
  return {
    ok: true,
    value: {
      schema_version: "tenant_memory_context_v1",
      tenant_id: tenantId,
      revision: Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
      project_id: raw.project_id ? sanitizeMemoryText(raw.project_id, 64) : null,
      session_id: raw.session_id ? sanitizeMemoryText(raw.session_id, 64) : null,
      latest_checkpoint: latest,
      relevant_memories: list(raw.relevant_memories, 10),
      pending_handoffs: list(raw.pending_handoffs, 10),
      recent_activity: list(raw.recent_activity, 20),
      policy: {
        tenant_isolated: true,
        raw_prompts_stored_automatically: false,
        secrets_storable: false,
      },
    },
  };
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
  const riskClassification = classifyActionRisk(body);
  const riskHint = Number(body.risk_hint ?? body.action?.risk_hint ?? riskClassification.risk_score);
  const confidenceHint = Number(body.confidence_hint ?? body.action?.confidence_hint ?? 85);
  const publishIntent = body.publish_intent === true || actionType === "publish";
  const blockedActionRules = [
    ...(Array.isArray(body.constraints?.blocked_action_rules) ? body.constraints.blocked_action_rules : []),
    ...riskClassification.reason_codes.map((reasonCode) => ({
      action_id: `action:${actionType}`,
      reason_code: reasonCode,
      severity: riskClassification.risk_score,
      blocks_execution: riskClassification.hard_block,
    })),
  ];

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
        action_classification: riskClassification.classification,
        operation_class: riskClassification.operation_class,
        publish_intent: publishIntent ? "true" : "false",
        source: "action_evaluator",
        ...(typeof body.metadata === "object" && body.metadata ? body.metadata : {}),
      },
    },
    signals: [
      normalizeSignal({
        id: `action:${actionType}`,
        category: riskClassification.classification,
        label: actionLabel,
        normalized_score: riskClassification.risk_score,
        severity_hint: riskClassification.risk_score,
        confidence_hint: confidenceHint,
        evidence: Array.isArray(body.evidence) ? body.evidence : [
          { label: "Azione richiesta dal client", value: actionType },
          { label: "Classificazione deterministica", value: riskClassification.classification },
        ],
        tags: ["action_gate", actionType, riskClassification.classification],
      }),
    ],
    data_quality: {
      score: Number(body.data_quality?.score ?? body.data_quality_score ?? 80),
      missing_fields: Array.isArray(body.data_quality?.missing_fields) ? body.data_quality.missing_fields : [],
    },
    constraints: safeConstraints({
      ...(typeof body.constraints === "object" && body.constraints ? body.constraints : {}),
      require_confirmation: riskClassification.confirmation_required,
      max_control_level: riskClassification.control_level,
      risk_floor: riskClassification.risk_band,
      passive_only: ["tenant_scoped_read", "sandboxed_scoped_work"].includes(riskClassification.operation_class),
      blocked_action_rules: blockedActionRules,
      safety_mode: riskClassification.control_level !== "observe",
    }, keyRecord, body.owner_confirmed === true),
  };
}

function safeConstraints(raw = {}, keyRecord, ownerConfirmed) {
  const automationAllowed = Boolean(
    raw.allow_automation === true &&
      ownerConfirmed &&
      hasScope(keyRecord, SCOPES.AUTOMATION_CODEX)
  );
  const passiveOnly = raw.passive_only === true && raw.allow_automation !== true;

  return {
    allow_automation: automationAllowed,
    require_confirmation: raw.require_confirmation !== false,
    max_control_level: automationAllowed ? raw.max_control_level || "confirm" : passiveOnly ? "observe" : "confirm",
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

function intelligenceOutcomeStore(storageRoot) {
  const dir = path.join(storageRoot, "intelligence", "outcomes");
  ensureDir(dir);
  const tenantHash = (tenantId) => crypto.createHash("sha256").update(String(tenantId)).digest("hex");
  const legacyFile = (tenantId) => path.join(dir, `${tenantHash(tenantId)}.json`);
  const tenantDir = (tenantId) => path.join(dir, tenantHash(tenantId));
  const recordFile = (tenantId, outcomeId) => path.join(
    tenantDir(tenantId),
    `${crypto.createHash("sha256").update(String(outcomeId)).digest("hex")}.json`,
  );
  const compare = (existing, candidate) => {
    const fields = ["prediction_id", "predicted_probability", "actual_outcome", "domain", "horizon"];
    return fields.some((field) => String(existing[field] ?? "") !== String(candidate[field] ?? ""));
  };
  const read = (tenantId) => {
    const legacy = readJsonFile(legacyFile(tenantId), []);
    const currentDir = tenantDir(tenantId);
    const current = fs.existsSync(currentDir)
      ? fs.readdirSync(currentDir).filter((name) => name.endsWith(".json")).map((name) =>
        readJsonFile(path.join(currentDir, name), null)).filter(Boolean)
      : [];
    const byOutcome = new Map();
    for (const record of [...legacy, ...current]) byOutcome.set(record.outcome_id, record);
    return [...byOutcome.values()].sort((a, b) => String(a.verified_at).localeCompare(String(b.verified_at))).slice(-10_000);
  };
  return {
    append(tenantId, record) {
      const storedRecord = { ...record, tenant_id: tenantId };
      const legacyDuplicate = readJsonFile(legacyFile(tenantId), []).find((item) => item.outcome_id === record.outcome_id);
      if (legacyDuplicate) {
        const conflict = compare(legacyDuplicate, storedRecord);
        return { record: legacyDuplicate, duplicate: !conflict, conflict };
      }
      const file = recordFile(tenantId, record.outcome_id);
      ensureDir(path.dirname(file));
      try {
        fs.writeFileSync(file, JSON.stringify(storedRecord, null, 2), { encoding: "utf8", flag: "wx" });
        return { record: storedRecord, duplicate: false, conflict: false };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = readJsonFile(file, null);
        if (!existing) throw error;
        const conflict = compare(existing, storedRecord);
        return { record: existing, duplicate: !conflict, conflict };
      }
    },
    recent(tenantId, limit = 100) {
      return read(tenantId).slice(-Math.max(1, Math.min(1000, Number(limit) || 100)));
    },
    calibration(tenantId) {
      return summarizeCalibration(read(tenantId));
    },
  };
}

function evidenceStore(storageRoot) {
  const file = path.join(storageRoot, "evidence", "events.jsonl");
  ensureDir(path.dirname(file));
  const configuredSigningSecret = String(process.env.CORE_EVIDENCE_SIGNING_SECRET || "").trim();
  if (!configuredSigningSecret && process.env.NODE_ENV === "production") {
    throw new Error("CORE_EVIDENCE_SIGNING_SECRET is required in production");
  }
  const signingSecret = configuredSigningSecret || "dev-evidence-signing-secret";

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
  const resolvedTenantPolicy = tenantPolicy || getTenantPolicy(keyRecord?.tenant_id, metadata.tier || metadata.suite_tier, {
    brandScope: keyRecord?.brand_scope,
    metadata,
  });
  const domainPack = resolveDomainPackForKey(keyRecord);
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
    domain_pack: publicDomainPack(domainPack),
    nyra_neural_network: {
      schema_version: "nyra_neural_branch_network_v1",
      governance: "core_opens_nyra_branches",
      catalog_endpoint: "GET /v1/nira/branches",
      maximum_subbranches_per_branch: 20,
      maximum_parallel_branches: 6,
      parallel_mode: "bounded_parallel_advisory",
      learning_mode: "tenant_scoped_verify_before_consolidate",
    },
    limits: resolvedEntitlement.limits,
    recommended_folders: {
      config: domainPack.id === "skinharmony" ? ".skinharmony-core/config" : ".universal-core/config",
      key: domainPack.id === "skinharmony" ? ".skinharmony-core/keys" : ".universal-core/keys",
      memory: domainPack.id === "skinharmony" ? ".skinharmony-core/memory" : ".universal-core/memory",
      reports: "reports/codex-core",
      policies: domainPack.id === "skinharmony" ? ".skinharmony-core/policies" : ".universal-core/policies",
      logs: domainPack.id === "skinharmony" ? ".skinharmony-core/logs" : ".universal-core/logs",
      snapshots: domainPack.id === "skinharmony" ? ".skinharmony-core/snapshots" : ".universal-core/snapshots",
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
  const requested = ["automation_control", "work_intake_intelligence"];

  if (/(software|codice|binari|eseguibil|debug|disassembl|decompil|ghidra|frida|reverse engineering|interoperabil|personalizz)/.test(`${target} ${text}`)) {
    requested.push("software_intelligence_lab");
  }

  if (/(ricerca|fonti|evidenz|documentazione|paper|benchmark|source|dati verificati)/.test(text)) {
    requested.push("research_evidence_intelligence");
  }
  if (/(pianifica|piano|priorit|roadmap|sequenza|milestone|dipenden|stima)/.test(text)) {
    requested.push("planning_priority_intelligence");
  }
  if (/(parallelo|coordina|delega|agenti|handoff|concorren|sincron|collabora|esegui|implementa)/.test(text)) {
    requested.push("execution_coordination_intelligence");
  }
  if (/(test|qualita|verifica|collaudo|accettazione|regression|evidence|qa)/.test(text)) {
    requested.push("quality_verification_intelligence");
  }
  if (/(apprendi|impara|migliora|retrospettiva|outcome|feedback|lezione|pattern|memoria)/.test(text)) {
    requested.push("adaptive_learning_intelligence");
  }

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
  if (/(delega|agente|workload|identita|identity|oauth|token|scope|audience|revoca|impersona)/.test(`${target} ${text}`)) {
    requested.push("identity_delegation");
  }
  if (/(provenienza|provenance|verdict|decisione|conferma|approvazione|audit|rollback|tracciabil)/.test(text)) {
    requested.push("decision_provenance");
  }
  if (/(render|deploy|release|runtime|server|nodi|node|update|rollback)/.test(text)) {
    requested.push("runtime_deployment_scaling_guard", "observability_roi_guard");
  }

  return [...new Set(requested)];
}

const MANDATORY_NYRA_WORK_BRANCHES = Object.freeze([
  "context_intelligence",
  "work_intake",
  "research_evidence",
  "decision_reasoning",
  "planning_prioritization",
  "risk_governance",
  "execution_planning",
  "parallel_coordination",
  "quality_verification",
  "learning_memory",
  "adaptive_learning",
]);

function composeMandatoryWorkPreflight(req, { domainPack, memoryContext = null, branchContext = null, nyraNetwork = null } = {}) {
  const body = req.body || {};
  const requestText = String(
    body.request || body.message || body.text || body.task || body.user_request || body.user_input || body.input || body.action_label ||
    body.requested_action?.label || body.requested_action?.type ||
    `Core controlled ${body.action_type || body.operation_type || "work"}`,
  ).trim();
  const requestedCoreBranches = [...new Set(["work_cortex", ...inferNiraBranchRequest(body)])];
  const mandatoryBranchContext = composeBranchContext({
    keyRecord: req.coreKey,
    requestedBranches: requestedCoreBranches,
    task: String(body.task || body.action_label || requestText),
    userInput: requestText,
    locale: body.locale || "it",
  });
  const resolvedBranchContext = branchContext ? {
    ...mandatoryBranchContext,
    selected_branches: [...new Set([...(mandatoryBranchContext.selected_branches || []), ...(branchContext.selected_branches || [])])],
    denied_branches: [...new Set([...(mandatoryBranchContext.denied_branches || []), ...(branchContext.denied_branches || [])])]
      .filter((id) => !(mandatoryBranchContext.selected_branches || []).includes(id) && !(branchContext.selected_branches || []).includes(id)),
    selected_groups: [...new Set([...(mandatoryBranchContext.selected_groups || []), ...(branchContext.selected_groups || [])])],
  } : mandatoryBranchContext;
  const requestedNyraBranches = [
    ...MANDATORY_NYRA_WORK_BRANCHES,
    ...normalizeList(body.nyra_branches, 20),
  ];
  const resolvedNyraNetwork = nyraNetwork || routeNyraBranches({
    text: requestText,
    requestedBranches: requestedNyraBranches,
    domainPackId: domainPack.id,
  });
  return buildWorkPreflight({
    tenantId: req.tenantId,
    requestText,
    targetSystem: body.target_system || "universal_core",
    operationType: body.operation_type || body.action_type || body.requested_action?.type || "advisory_work",
    toolName: body.source_tool || body.tool_name || "",
    availableCapabilities: body.available_capabilities || body.available_tools || body.connected_capabilities || [],
    memoryContext,
    branchContext: resolvedBranchContext,
    nyraNetwork: resolvedNyraNetwork,
    domainPack: publicDomainPack(domainPack),
    ownerConfirmed: body.owner_confirmed === true,
  });
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
      "call_work_preflight_before_any_ai_work",
      "recall_tenant_memory_before_planning",
      "send_tenant_id_on_every_request",
      "never_execute_when_executionAllowed_false",
      "ask_owner_when_requiresOwnerConfirmation_true",
      "store_evidence_id_for_sensitive_actions",
    ],
    core_routes: {
      work_preflight: "/v1/work/preflight",
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
      intelligence_workflow: "/v1/intelligence/workflow",
      intelligence_scenarios: "/v1/intelligence/scenarios",
      intelligence_hypotheses: "/v1/intelligence/hypotheses/rank",
      intelligence_events: "/v1/intelligence/events/evaluate",
      intelligence_counterfactuals: "/v1/intelligence/counterfactuals/evaluate",
      intelligence_decision: "/v1/intelligence/decisions/select",
      intelligence_outcome_verify: "/v1/intelligence/outcomes/verify",
      intelligence_outcome_record: "/v1/intelligence/outcomes/record",
      intelligence_calibration: "/v1/intelligence/calibration",
      software_intelligence_components: "/v1/software-intelligence/components",
      software_intelligence_authorize: "/v1/software-intelligence/authorize",
      software_intelligence_analyze: "/v1/software-intelligence/analyze",
      software_intelligence_jobs_submit: "/v1/software-intelligence/jobs",
      software_intelligence_jobs_list: "/v1/software-intelligence/jobs",
      software_intelligence_job_get: "/v1/software-intelligence/jobs/:jobId",
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

  const lazyBuildAllowed = process.env.SH_EXTRACTOR_ENABLE_LAZY_BUILD === "1" || (process.env.NODE_ENV !== "production" && process.env.SH_EXTRACTOR_DISABLE_LAZY_BUILD !== "1");
  if (allowBuild && lazyBuildAllowed) {
    const buildScript = path.join(repoRoot(), "scripts", "build-rust-extractor-render.sh");
    if (fs.existsSync(buildScript)) {
      try {
        execFileSync("bash", [buildScript], {
          cwd: repoRoot(),
          env: process.env,
          encoding: "utf8",
          timeout: Number(process.env.SH_EXTRACTOR_BUILD_TIMEOUT_MS || 180_000),
        });
      } catch (error) {
        const output = `${error.stdout || ""}\n${error.stderr || ""}`.trim();
        const snippet = output
          .replace(/(api[_-]?key|token|secret|password)=\\S+/gi, "$1=[redacted]")
          .slice(0, Number(process.env.SH_EXTRACTOR_BUILD_ERROR_BYTES || 1200));
        throw new Error(`extractor_build_failed:${snippet || error.message || "unknown"}`);
      }
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
