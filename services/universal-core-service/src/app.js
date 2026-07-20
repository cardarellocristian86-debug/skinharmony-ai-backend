Warning: truncated output (original token count: 78336)
Total output lines: 6010

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
import { createKeyStore, isProviderSetupLinkServiceRecord } from "./keyStore.js";
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
import {
  isProviderSetupLinkBindingAttempt,
  providerSetupLinkBindingApprovalDigest,
  providerSetupLinkBindingAuditFields,
} from "./providerSetupLinkBinding.js";
import { createCoreRuntimeWorker } from "./coreRuntimeWorker.js";
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
import { createGenericAgentRuntime } from "./genericAgentRuntime.js";
import { createGenericAgentCheckpointStore } from "./genericAgentCheckpointStore.js";
import { evaluateGenericAgentRun } from "./genericAgentEvaluation.js";
import { createGenericAgentOrchestrator } from "./genericAgentOrchestrator.js";
import { createGenericAgentOrchestrationStore } from "./genericAgentOrchestrationStore.js";
import { buildGovernedResearchWorkers, createGovernedAgentRegistry } from "./governedAgentRegistry.js";
import { createGovernedAgentActivationStore } from "./governedAgentActivationStore.js";
import { createGovernedAgentBudgetStore } from "./governedAgentBudgetStore.js";
import { createGovernedAgentQueueStore } from "./governedAgentQueueStore.js";
import { createGovernedAgentPostgresQueueStore } from "./governedAgentPostgresQueueStore.js";
import { createGovernedAgentDryRunRunner } from "./governedAgentDryRunRunner.js";
import { createTenantProviderCredentialStore } from "./tenantProviderCredentialStore.js";
import { createTenantProviderSetupLinkStore } from "./tenantProviderSetupLinkStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORAGE_ROOT = path.resolve(__dirname, "../storage");
const SERVICE_VERSION = "0.10.3-governed-outcomes";
const SERVICE_NAME = String(process.env.CORE_SERVICE_NAME || "universal-core-service").trim();
const OWNER_CONTEXT_ASSERTION_VERSION = "owner_context_assertion_v1";
const BUILD_ID = String(process.env.CORE_SERVICE_BUILD_ID || process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "unavailable").trim();
const BUILD_COMMIT_SHA = String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "").trim() || null;
const PROVIDER_SETUP_LINK_ISSUER_KIND = "provider_setup_link";
const PROVIDER_SETUP_LINK_OWNER_SUBJECT_PATTERN = /^osf_[a-f0-9]{64}$/;
const TRUSTED_PROVIDER_SETUP_ORIGIN = "https://skinharmony-universal-core.onrender.com";

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
    owner_subject_fingerprint: context.owner_subject_fingerprint,
    issued_at: context.issued_at,
    binding_version: context.binding_version,
    binding_hash: context.binding_hash,
    approval_digest: context.approval_digest,
  });
}

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableCanonical(value[key]);
    return result;
  }, {});
}

function ownerRequestBinding(purpose, body = {}) {
  const { owner_context: _ownerContext, ...payload } = body;
  return `${purpose}\u0000${JSON.stringify(stableCanonical(payload))}`;
}

function verifyOwnerContextAssertion(context, secret, tenantId, expectedBinding, now = Date.now()) {
  if (!context || typeof context !== "object" || !secret) return false;
  if (context.assertion_version !== OWNER_CONTEXT_ASSERTION_VERSION) return false;
  if (context.audience !== "nira_core_bridge" || context.tenant_id !== tenantId) return false;
  const tenantOwner = context.role === "tenant_owner" && context.access_mode === "tenant_owner";
  const globalOwner = context.role === "owner_root" && context.access_mode === "god_mode";
  if (context.owner_verified !== true || (!tenantOwner && !globalOwner)) return false;
  const issuedAt = Date.parse(String(context.issued_at || ""));
  if (!Number.isFinite(issuedAt) || issuedAt > now + 30_000 || now - issuedAt > 120_000) return false;
  const supplied = String(context.assertion || "");
  if (!/^ocs_[a-f0-9]{64}$/i.test(supplied)) return false;
  if (expectedBinding !== undefined) {
    if (context.binding_version !== "owner_request_binding_v1") return false;
    const suppliedBindingHash = String(context.binding_hash || "");
    const expectedBindingHash = crypto.createHash("sha256").update(String(expectedBinding)).digest("hex");
    if (!/^[a-f0-9]{64}$/i.test(suppliedBindingHash)) return false;
    if (!crypto.timingSafeEqual(Buffer.from(suppliedBindingHash), Buffer.from(expectedBindingHash))) return false;
  }
  const expected = `ocs_${crypto.createHmac("sha256", secret)
    .update(`owner-context\u0000${ownerContextCanonical(context)}`)
    .digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function hasProviderSetupOwnerContext(context) {
  return context?.delegated_actor === "oauth" &&
    PROVIDER_SETUP_LINK_OWNER_SUBJECT_PATTERN.test(String(context?.owner_subject_fingerprint || ""));
}

function isDedicatedProviderSetupLinkIssuer(keyRecord, tenantId) {
  return Boolean(
    keyRecord &&
    keyRecord.tenant_id === tenantId &&
    keyRecord.key_type === "connector" &&
    keyRecord.status === "active" &&
    keyRecord.expires_at === null &&
    keyRecord.preset === null &&
    keyRecord.brand_scope === "" &&
    keyRecord.metadata?.bootstrap_kind === PROVIDER_SETUP_LINK_ISSUER_KIND &&
    Array.isArray(keyRecord.allowed_scopes) &&
    keyRecord.allowed_scopes.length === 1 &&
    keyRecord.allowed_scopes[0] === SCOPES.WRITE_PROVIDER_SETUP_LINK
  );
}

function isProviderSetupLinkIssuer(keyRecord, tenantId) {
  return isDedicatedProviderSetupLinkIssuer(keyRecord, tenantId) || isProviderSetupLinkServiceRecord(keyRecord);
}

function trustedProviderSetupBaseUrl(value) {
  const raw = String(value || TRUSTED_PROVIDER_SETUP_ORIGIN).trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("provider_setup_public_url_invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== TRUSTED_PROVIDER_SETUP_ORIGIN ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("provider_setup_public_url_invalid");
  }
  return parsed.origin;
}

function sameDigest(left, right) {
  const actual = String(left || "");
  const expected = String(right || "");
  if (!/^pslb_[a-f0-9]{64}$/i.test(actual) || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function readSecret(req) {
  const auth = req.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.get("x-sh-core-key") || req.get("x-api-key") || "";
}

function publicError(res, status, code, message = code) {
  return res.status(status).json({ ok: false, error: code, message });
}

function providerSetupHtml(res, status, html, { scriptNonce = "" } = {}) {
  const scriptPolicy = scriptNonce ? `; script-src 'nonce-${scriptNonce}'` : "";
  return res
    .status(status)
    .set({
      "cache-control": "no-store, max-age=0",
      pragma: "no-cache",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-security-policy": `default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; style-src 'unsafe-inline'${scriptPolicy}`,
    })
    .type("html")
    .send(html);
}

function providerSetupFormHtml(scriptNonce) {
  return `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Collega OpenAI</title><body style="font-family:system-ui;max-width:560px;margin:48px auto;padding:24px"><h1>Collega OpenAI</h1><p>Inserisci una API key personale. Non è il tuo abbonamento ChatGPT. Verrà cifrata e non mostrata di nuovo.</p><form method="post" id="provider-setup-form"><input type="hidden" name="setup_proof" id="setup-proof"><label>API key<input name="api_key" type="password" autocomplete="new-password" required style="display:block;width:100%;margin:8px 0 16px;padding:12px"></label><button type="submit" id="submit">Collega in modo sicuro</button></form><p id="link-error" role="alert"></p><script nonce="${scriptNonce}">(function(){const proof=new URLSearchParams(location.hash.slice(1)).get("proof")||"";const input=document.getElementById("setup-proof");const button=document.getElementById("submit");const error=document.getElementById("link-error");if(!/^[A-Za-z0-9_-]{32,120}$/.test(proof)){input.disabled=true;button.disabled=true;error.textContent="Link incompleto. Torna a ChatGPT e apri di nuovo il collegamento sicuro.";return;}input.value=proof;history.replaceState(null,document.title,location.pathname);})();</script></body></html>`;
}

function providerSetupLinkBootstrapErrorCode(error) {
  const code = error instanceof Error ? error.message : "";
  return new Set([
    "provider_setup_link_key_required",
    "provider_setup_link_tenant_required",
    "provider_setup_link_key_conflict",
    "provider_setup_link_key_rotation_required",
  ]).has(code)
    ? code
    : "provider_setup_link_bootstrap_unavailable";
}

// This status is intentionally coarse because /healthz is public. It is only
// enough to distinguish an absent binding from a persistent-key conflict; it
// never includes a tenant id, secret, hash, or the underlying storage error.
function getProviderSetupLinkBootstrapState({ key, tenantId, configured, error } = {}) {
  if (configured === true) return "ready";
  const hasKey = Boolean(key);
  const hasTenant = Boolean(tenantId);
  if (!hasKey && !hasTenant) return "incomplete";
  if (!hasKey && hasTenant) return "binding_missing";
  if (hasKey && !hasTenant) return "incomplete";

  const code = providerSetupLinkBootstrapErrorCode(error);
  if (code === "provider_setup_link_key_conflict" || code === "provider_setup_link_key_rotation_required") {
    return "binding_conflict";
  }
  if (code === "provider_setup_link_key_required") return "binding_missing";
  if (code === "provider_setup_link_tenant_required") return "incomplete";
  return "unavailable";
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

function outcomeContainsSensitiveContent(body = {}) {
  if (body.contains_secret === true || body.contains_customer_data === true) return true;
  const values = [body.outcome_id, body.prediction_id, body.domain, body.horizon, body.notes, ...(Array.isArray(body.lessons) ? body.lessons : [])];
  return values.some((value) => {
    const raw = String(value ?? "");
    return raw.length > 2_000 || sanitizeMemoryText(raw, 2_000) !== raw;
  });
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

function createAuth(keyStore, audit, requiredScope, { allowProviderSetupService = false } = {}) {
  return (req, res, next) => {
    const auth = keyStore.authenticate(readSecret(req));
    if (!auth.ok) {
      audit.append("core_auth_failed", { error: auth.error, path: req.path });
      return publicError(res, 401, auth.error);
    }

    const tenantId = safeTenantId(req, auth.record);
    const serviceIssuer = allowProviderSetupService === true && isProviderSetupLinkServiceRecord(auth.record);
    if (!tenantId || (!serviceIssuer && !requireTenantAccess(auth.record, tenantId))) {
      audit.append("core_tenant_scope_denied", { key_id: auth.record.key_id, requested_tenant: tenantId, path: req.path });
      return publicError(res, 403, "tenant_scope_denied");
    }

    const requiredScopes = Array.isArray(requiredScope) ? requiredScope : [requiredScope].filter(Boolean);
    if (requiredScopes.length && !requiredScopes.some((scope) => hasScope(auth.record, scope))) {
      audit.append("core_scope_denied", { key_id: auth.record.key_id, required_scopes: requiredScopes, path: req.path });
      return publicError(res, 403, "scope_denied", `Required scope: ${requiredScopes.join(" or ")}`);
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
    key_type: keyRecord?.k…58336 tokens truncated…  errors: validation.errors,
        adapter: adapterOverride || req.body?.adapter || "generic",
      });
      return publicError(res, 400, "ai_gateway_payload_invalid", validation.errors.join(", "));
    }

    const domainPackAccess = checkDomainPackRequest(req.coreKey, req.body?.domain_pack || req.body?.domain_pack_id);
    if (!domainPackAccess.ok) return publicError(res, 403, domainPackAccess.error);
    const memoryContext = normalizeTenantMemoryContext(req.body?.memory_context, req.tenantId);
    if (!memoryContext.ok) return publicError(res, 403, memoryContext.error);
    const workPreflight = composeMandatoryWorkPreflight(req, {
      domainPack: domainPackAccess.pack,
      memoryContext: memoryContext.value,
    });

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
      preflight_id: workPreflight.preflight_id,
    });
    return res.json({
      ok: true,
      gateway: {
        schema_version: AI_GATEWAY_SCHEMA_VERSION,
        core_centralized: true,
        adapters_separated: true,
        no_duplicated_logic: true,
        openai_call_executed: false,
        mandatory_preflight_completed: true,
        audit_event: "core_ai_gateway_evaluated",
      },
      work_preflight: workPreflight,
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
      taxonomy: deterministicBranchTaxonomy(),
      packages: BRANCH_PACKAGES,
      tenant_package: resolution,
      rule: "Ogni ramo produce decisioni advisory/read-only. Azioni operative e pubblicazione richiedono conferma owner.",
    });
  });

  app.get("/v1/branches/taxonomy", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    res.json({
      ok: true,
      taxonomy: deterministicBranchTaxonomy(),
      groups: deterministicBranchGroups(),
      packages: BRANCH_PACKAGES,
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
      taxonomy: deterministicBranchTaxonomy(),
      branches: Object.fromEntries(resolution.selected_branches.map((id) => [id, branchRegistry()[id]]).filter(([, value]) => Boolean(value))),
    });
  });

  app.get("/v1/agents/registry", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const pack = resolveDomainPackForKey(req.coreKey);
    audit.append("multi_agent_registry_read", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, domain_pack_id: pack.id });
    res.json({ ok: true, ...multiAgentRegistry({ domainPackId: pack.id }) });
  });

  app.post("/v1/agents/plan", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const domainPackAccess = checkDomainPackRequest(req.coreKey, req.body?.domain_pack || req.body?.domain_pack_id);
    if (!domainPackAccess.ok) return publicError(res, 403, domainPackAccess.error);
    const memoryContext = normalizeTenantMemoryContext(req.body?.memory_context, req.tenantId);
    if (!memoryContext.ok) return publicError(res, 403, memoryContext.error);
    const plan = planMultiAgentRun({
      domainPackId: domainPackAccess.pack.id,
      tenantId: req.tenantId,
      input: req.body || {},
      requestedAgents: req.body?.requested_agents,
    });
    audit.append("multi_agent_plan_created", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      domain_pack_id: domainPackAccess.pack.id,
      selected_agents: plan.selection.map((item) => item.id),
      model_calls_budget: plan.credit_control.model_calls_budget,
    });
    res.json({ ok: true, ...plan });
  });

  app.post("/v1/codex/context", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const domainPackAccess = checkDomainPackRequest(req.coreKey, req.body?.domain_pack || req.body?.domain_pack_id);
    if (!domainPackAccess.ok) return publicError(res, 403, domainPackAccess.error);
    const memoryContext = normalizeTenantMemoryContext(req.body?.memory_context, req.tenantId);
    if (!memoryContext.ok) return publicError(res, 403, memoryContext.error);
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
    const tenantPolicy = getTenantPolicy(req.tenantId, req.body?.plan || req.coreKey?.metadata?.tier, {
      brandScope: req.coreKey?.brand_scope,
      metadata: req.coreKey?.metadata,
    });
    const workPreflight = composeMandatoryWorkPreflight(req, {
      domainPack: domainPackAccess.pack,
      memoryContext: memoryContext.value,
      branchContext: context,
    });
    audit.append("core_codex_context_composed", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      tier: context.tier,
      selected_branches: context.selected_branches,
      denied_branches: context.denied_branches,
      memory_revision: memoryContext.value?.revision || 0,
      preflight_id: workPreflight.preflight_id,
    });
    res.json({
      ok: true,
      domain_pack: publicDomainPack(domainPackAccess.pack),
      context,
      memory_context: memoryContext.value,
      work_preflight: workPreflight,
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
            evidence: [
              { label: context.selected_branches.length ? "Rami specializzati disponibili" : "Nessun ramo richiesto/autorizzato: uso guardiano generico", value: true },
              { label: "Memorie tenant rilevanti", value: memoryContext.value?.relevant_memories.length || 0 },
              { label: "Handoff AI pendenti", value: memoryContext.value?.pending_handoffs.length || 0 },
            ],
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
        mandatory_preflight_completed: true,
        mode: "context_composition_only",
      },
    });
  });

  app.post("/v1/codex/guard", createAuth(keyStore, audit, SCOPES.AUTOMATION_CODEX), (req, res) => {
    const domainPackAccess = checkDomainPackRequest(req.coreKey, req.body?.domain_pack || req.body?.domain_pack_id);
    if (!domainPackAccess.ok) return publicError(res, 403, domainPackAccess.error);
    const memoryContext = normalizeTenantMemoryContext(req.body?.memory_context, req.tenantId);
    if (!memoryContext.ok) return publicError(res, 403, memoryContext.error);
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
    const tenantPolicy = getTenantPolicy(req.tenantId, req.body?.plan || req.coreKey?.metadata?.tier, {
      brandScope: req.coreKey?.brand_scope,
      metadata: req.coreKey?.metadata,
    });
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
          { label: tenantPolicy.source === "domain_pack_registry" ? "Domain pack tenant specifico caricato" : "Policy tenant generica caricata", value: tenantPolicy.source },
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
    response.work_preflight = composeMandatoryWorkPreflight(req, {
      domainPack: domainPackAccess.pack,
      memoryContext: memoryContext.value,
      branchContext: context,
    });
    audit.append("core_codex_guard_evaluated", {
      tenant_id: req.tenantId,
      key_id: req.coreKey.key_id,
      task: req.body?.task || "",
      mode: response.codex_guard.mode,
      state: response.decision_contract.state,
      control_level: response.decision_contract.control_level,
      selected_branches: response.codex_guard.selected_branches,
      denied_branches: response.codex_guard.denied_branches,
      preflight_id: response.work_preflight.preflight_id,
    });
    res.json({ ok: true, ...response });
  });

  app.post("/v1/nira/core-bridge", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const domainPackAccess = checkDomainPackRequest(req.coreKey, req.body?.domain_pack || req.body?.domain_pack_id);
    if (!domainPackAccess.ok) return publicError(res, 403, domainPackAccess.error);
    const memoryContext = normalizeTenantMemoryContext(req.body?.memory_context, req.tenantId);
    if (!memoryContext.ok) return publicError(res, 403, memoryContext.error);
    const niraText = String(req.body?.text || req.body?.request || req.body?.task || "").trim();
    if (!niraText) return publicError(res, 400, "nira_text_required");
    if (niraText.length > 20_000) return publicError(res, 413, "nira_text_too_long");
    const requestedNyraBranches = req.body?.nyra_branches;
    if (requestedNyraBranches !== undefined && !Array.isArray(requestedNyraBranches)) {
      return publicError(res, 400, "nyra_branches_must_be_array");
    }
    if (Array.isArray(requestedNyraBranches) && requestedNyraBranches.length > 20) {
      return publicError(res, 400, "nyra_branch_request_limit_exceeded");
    }
    if (Array.isArray(requestedNyraBranches) && requestedNyraBranches.some((id) => !/^[a-z][a-z0-9_]{1,63}$/.test(String(id || "")))) {
      return publicError(res, 400, "invalid_nyra_branch_id");
    }
    const ownerContext = req.body?.owner_context && typeof req.body.owner_context === "object"
      ? req.body.owner_context
      : {};
    const trustedOwnerContext = verifyOwnerContextAssertion(ownerContext, ownerContextSigningSecret, req.tenantId);
    const explicitOwnerConfirmation = req.body?.owner_confirmed === true || req.body?.owner_confirmation === true;
    const ownerConfirmed = explicitOwnerConfirmation || trustedOwnerContext;
    const requestedGodMode = req.body?.mode === "god_mode_owner_only"
      || req.body?.god_mode === true
      || trustedOwnerContext;
    const ownerVerified = Boolean(trustedOwnerContext || (explicitOwnerConfirmation && hasScope(req.coreKey, SCOPES.AUTOMATION_CODEX)));
    const requestedBranches = [...new Set(["work_cortex", ...inferNiraBranchRequest(req.body || {})])];
    const branchContext = composeBranchContext({
      keyRecord: req.coreKey,
      requestedBranches,
      task: String(req.body?.task || req.body?.request || req.body?.text || ""),
      userInput: String(req.body?.text || req.body?.request || req.body?.task || ""),
      locale: req.body?.locale || "it",
    });
    const nyraNetwork = routeNyraBranches({
      text: niraText,
      requestedBranches: [
        ...MANDATORY_NYRA_WORK_BRANCHES,
        ...(Array.isArray(requestedNyraBranches) ? requestedNyraBranches : []),
      ],
      domainPackId: domainPackAccess.pack.id,
    });
    const workPreflight = composeMandatoryWorkPreflight(req, {
      domainPack: domainPackAccess.pack,
      memoryContext: memoryContext.value,
      branchContext,
      nyraNetwork,
    });
    const result = runNiraUniversalCoreBridge({
      request_id: req.body?.request_id || `nira_service_${crypto.randomUUID()}`,
      text: niraText,
      tenant_id: req.tenantId,
      domain: domainPackAccess.pack.domain,
      domain_pack: domainPackAccess.pack.id,
      owner_verified: ownerVerified,
      access_scope: ownerVerified ? "owner_full" : "limited",
      mode: requestedGodMode ? "god_mode_owner_only" : "standard",
      target_system: req.body?.target_system || "universal_core",
      memory_context: memoryContext.value || undefined,
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
    const deepNyraRuntime = buildDeepNyraRuntime({
      text: niraText,
      ownerVerified,
      godModeActive: result.god_mode_active,
      selectedByCore: result.selected_by_core,
      nyraNetwork,
      memoryContext: memoryContext.value,
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
        next_step: result.automation_plan.owner_confirmation_required
          ? "Preparare runbook/evidence e chiedere conferma owner prima di ogni scrittura reale."
          : "Procedere soltanto in lettura, analisi o proposta nel perimetro tenant.",
      },
      core_branch_diagnostics: {
        ...(result.core_branch_diagnostics || {}),
        branch_router_used: true,
        actual_selected_branches: branchContext.selected_branches,
        actual_denied_branches: branchContext.denied_branches,
        actual_selected_groups: branchContext.selected_groups,
        actual_denied_groups: branchContext.denied_groups,
      },
      domain_pack: publicDomainPack(domainPackAccess.pack),
      nyra_neural_network: nyraNetwork,
      memory_context: memoryContext.value,
      work_preflight: workPreflight,
      deep_nyra_runtime: deepNyraRuntime,
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
      nyra_opened_branches: nyraNetwork.opened_branches.map((item) => item.id),
      memory_revision: memoryContext.value?.revision || 0,
      preflight_id: workPreflight.preflight_id,
      deep_runtime_mode: deepNyraRuntime.mode,
      deep_runtime_hard_block: deepNyraRuntime.owner_protection?.hard_block === true,
    });
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      domain_pack: publicDomainPack(domainPackAccess.pack),
      result: guardedResult,
      memory_context: memoryContext.value,
      work_preflight: workPreflight,
      branch_context: {
        selected_branches: branchContext.selected_branches,
        denied_branches: branchContext.denied_branches,
        selected_groups: branchContext.selected_groups,
        denied_groups: branchContext.denied_groups,
        tier: branchContext.tier,
      },
      guardrail: {
        execution_allowed: false,
        mandatory_preflight_completed: true,
        owner_confirmation_required: guardedResult.automation_plan.owner_confirmation_required,
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

  app.get("/v1/software-intelligence/components", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const resolution = resolveBranchesForKey(req.coreKey, ["software_binary_intelligence"]);
    if (!resolution.selected_branches.includes("software_binary_intelligence")) {
      audit.append("core_branch_denied", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        branch: "software_binary_intelligence",
      });
      return publicError(res, 403, "branch_not_allowed", `Branch not allowed for tier ${resolution.tier}`);
    }
    res.json({
      ok: true,
      tenant_id: req.tenantId,
      branch: "software_binary_intelligence",
      maximum_artifact_bytes: MAX_EMBEDDED_ARTIFACT_BYTES,
      manifest: universalSoftwareComponentManifest({ configuredWorkers: Object.keys(options.softwareWorkerAdapters || {}) }),
      authorization_required: true,
      execution_supported: false,
    });
  });

  app.post("/v1/software-intelligence/jobs", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const resolution = resolveBranchesForKey(req.coreKey, ["software_binary_intelligence"]);
    if (!resolution.selected_branches.includes("software_binary_intelligence")) return publicError(res, 403, "branch_not_allowed");
    try {
      const verifiedGovernance = typeof options.softwareAuthorizationVerifier === "function"
        ? options.softwareAuthorizationVerifier({ tenant_id: req.tenantId, request: req.body, key: req.coreKey })
        : null;
      const job = softwareJobs.submit(req.body || {}, {
        tenant_id: req.tenantId,
        requested_tenant_id: req.body?.tenant_id,
        memory_available: options.memoryAvailable !== false,
        core_available: options.coreAvailable !== false,
        core_authorized: verifiedGovernance?.authorized === true,
        target_allowlist: verifiedGovernance?.target_allowlist || [],
      });
      audit.append("core_software_job_submitted", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        job_id: job.job_id,
        mode: job.mode,
        raw_artifact_persisted: false,
      });
      return res.status(202).json({ ok: true, job });
    } catch (error) {
      const code = String(error?.message || "software_job_rejected");
      const status = code === "software_artifact_too_large" ? 413 : 400;
      return publicError(res, status, code);
    }
  });

  app.post("/v1/software-intelligence/authorize", createAuth(keyStore, audit, SCOPES.WRITE_RUNBOOK), (req, res) => {
    if (!options.softwareAuthorizationSecret) return publicError(res, 503, "software_authorization_issuer_unavailable");
    if (!req.body?.memory_context || typeof req.body.memory_context !== "object") return publicError(res, 400, "software_memory_required");
    const memoryContext = normalizeTenantMemoryContext(req.body.memory_context, req.tenantId);
    if (!memoryContext.ok) return publicError(res, 403, memoryContext.error);
    const input = buildActionEvaluatorInput(req, req.coreKey);
    const output = runUniversalCore(input);
    const decisionContract = normalizeDecisionContract(output, { action_type: "software_analysis", publish_intent: false });
    const authorization = buildActionAuthorization(decisionContract, { ...req.body, action_type: "software_analysis", operation_class: "governed_deep_software_analysis" });
    if (!authorization.allowed) return res.status(403).json({ ok: false, error: authorization.state, authorization, decision_contract: decisionContract });
    try {
      const coreGovernance = issueSoftwareAuthorizationEnvelope({ secret: options.softwareAuthorizationSecret, tenantId: req.tenantId, allowedModes: req.body.allowed_modes, targetAllowlist: req.body.target_allowlist || [] });
      audit.append("core_software_authorization_issued", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, modes: req.body.allowed_modes, target_count: req.body.target_allowlist?.length || 0 });
      return res.status(201).json({ ok: true, tenant_id: req.tenantId, authorization, core_governance: coreGovernance });
    } catch (error) { return publicError(res, 400, error.message || "software_authorization_failed"); }
  });

  app.get("/v1/software-intelligence/jobs", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    res.json({ ok: true, tenant_id: req.tenantId, jobs: softwareJobs.list(req.tenantId) });
  });

  app.get("/v1/software-intelligence/jobs/:jobId", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const job = softwareJobs.get(req.params.jobId, req.tenantId);
    if (!job) return publicError(res, 404, "software_job_not_found");
    return res.json({ ok: true, job });
  });

  app.post("/v1/software-intelligence/correlate", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    try {
      const correlation = softwareJobs.correlate(req.body?.job_ids, req.tenantId);
      audit.append("core_software_evidence_correlated", { tenant_id: req.tenantId, key_id: req.coreKey.key_id, source_job_ids: correlation.source_job_ids, raw_content_persisted: false });
      return res.json({ ok: true, correlation });
    } catch (error) { return publicError(res, 400, error.message || "software_correlation_failed"); }
  });

  app.post("/v1/software-intelligence/analyze", createAuth(keyStore, audit, SCOPES.READ_DECISION), (req, res) => {
    const resolution = resolveBranchesForKey(req.coreKey, ["software_binary_intelligence"]);
    if (!resolution.selected_branches.includes("software_binary_intelligence")) {
      audit.append("core_branch_denied", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        branch: "software_binary_intelligence",
      });
      return publicError(res, 403, "branch_not_allowed", `Branch not allowed for tier ${resolution.tier}`);
    }

    try {
      const analysis = analyzeEmbeddedSoftwareArtifact({
        artifact: req.body?.artifact,
        authorization: req.body?.authorization,
        options: req.body?.options,
      });
      audit.append("core_software_artifact_analyzed", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        branch: "software_binary_intelligence",
        analysis_id: analysis.analysis_id,
        artifact_sha256: analysis.artifact.sha256,
        artifact_bytes: analysis.artifact.byte_length,
        artifact_format: analysis.executable.format,
        artifact_architecture: analysis.executable.architecture,
        authorization_basis: analysis.authorization.basis,
        purpose: analysis.authorization.purpose,
        raw_content_persisted: false,
      });
      return res.json({
        ok: true,
        tenant_id: req.tenantId,
        branch: "software_binary_intelligence",
        analysis,
        guardrail: {
          execution_allowed: false,
          static_observation_only: true,
          raw_content_persisted: false,
          patch_requires_separate_core_verdict: true,
          mode: "embedded_authorized_static_analysis",
        },
      });
    } catch (error) {
      const code = String(error?.message || "software_analysis_failed");
      const status = code === "software_artifact_too_large" ? 413 : 400;
      audit.append("core_software_artifact_analysis_rejected", {
        tenant_id: req.tenantId,
        key_id: req.coreKey.key_id,
        branch: "software_binary_intelligence",
        reason: code,
      });
      return publicError(res, status, code);
    }
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
    const tenantPolicy = getTenantPolicy(req.tenantId, req.body?.plan || req.coreKey?.metadata?.tier, {
      brandScope: req.coreKey?.brand_scope,
      metadata: req.coreKey?.metadata,
    });
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
    const tenantPolicy = getTenantPolicy(req.tenantId, req.body?.plan || req.coreKey?.metadata?.tier, {
      brandScope: req.coreKey?.brand_scope,
      metadata: req.coreKey?.metadata,
    });
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

  return { app, storageRoot, coreRuntime };
}
