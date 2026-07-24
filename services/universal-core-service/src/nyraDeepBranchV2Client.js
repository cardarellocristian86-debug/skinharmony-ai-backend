import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ENVELOPE_AUDIENCE,
  ENVELOPE_ISSUER,
  ENVELOPE_SCHEMA_VERSION,
  RESPONSE_SCHEMA_VERSION,
  EVALUATION_RESPONSE_SCHEMA_VERSION,
  canonicalJson,
  coreEnvelopeBindingHash,
  signCoreEnvelope,
} = require("../../../personal-control-center/lib/nyra-deep-branch-v2-federation.js");

const VALID_MODES = new Set(["shadow", "preview", "active"]);
const VALID_OPERATIONAL_MODES = new Set(["shadow", "advisory"]);
const ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,160}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_TIMEOUT_MS = 8_000;
const MIN_TIMEOUT_MS = 250;
const MAX_CIRCUIT_FAILURES = 5;
const MAX_CIRCUIT_COOLDOWN_MS = 5 * 60_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const TRUSTED_PRODUCTION_NYRA_ORIGIN = "https://skinharmony-nyra-core.onrender.com";

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function parseList(value, maxItems = 20) {
  const seen = new Set();
  return String(value || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item) || seen.size >= maxItems) return false;
      seen.add(item);
      return true;
    });
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function sha256(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function safeString(value, max = 256) {
  const text = String(value || "").trim();
  return text && text.length <= max ? text : null;
}

function normalizedBranchIds(value, maxItems = 20) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item?.id || item || "").trim())
    .filter((item) => ID_PATTERN.test(item)))]
    .slice(0, maxItems);
}

function operationalPreflightReady(workPreflight) {
  return workPreflight?.mandatory === true
    && workPreflight?.state === "ready_read_only"
    && workPreflight?.governance?.execution_allowed_by_preflight === true
    && workPreflight?.memory_first?.status === "recalled";
}

function normalizedUrl(raw, allowedOrigin) {
  try {
    const parsed = new URL(String(raw || "").trim());
    const allowed = new URL(String(allowedOrigin || "").trim());
    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || !["", "/"].includes(parsed.pathname)
      || allowed.protocol !== "https:"
      || allowed.username
      || allowed.password
      || allowed.search
      || allowed.hash
      || !["", "/"].includes(allowed.pathname)
      || parsed.origin !== allowed.origin
    ) return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function sanitizeReason(value, fallbackReason) {
  const text = String(value || "").trim();
  return /^[a-zA-Z0-9_.:-]{1,160}$/.test(text) ? text : fallbackReason;
}

function fallback({
  tenantId,
  requestId,
  state = "disabled_v1_authoritative",
  reason = "nyra_deep_branch_v2_disabled",
  circuit = null,
} = {}) {
  return {
    schema_version: RESPONSE_SCHEMA_VERSION,
    state,
    mode: "disabled",
    tenant_id: tenantId || null,
    request_id: requestId || null,
    reason: sanitizeReason(reason, "nyra_deep_branch_v2_unavailable"),
    selected_branches: [],
    evaluation: {
      state: "not_requested_v1_authoritative",
      evaluated_node_count: 0,
    },
    ...(circuit ? { circuit } : {}),
    execution_authorized: false,
    core_final_authority: true,
    fallback: "nyra_neural_branch_network_v1",
  };
}

function corePolicyHash({ selectedByCore, openedBranchIds, workPreflight }) {
  return sha256({
    selected_by_core: {
      state: selectedByCore?.state || null,
      risk_band: selectedByCore?.risk_band || null,
      control_level: selectedByCore?.control_level || null,
      execution_allowed: false,
    },
    opened_branch_ids: openedBranchIds,
    preflight: {
      preflight_id: workPreflight?.preflight_id || null,
      state: workPreflight?.state || null,
      mandatory: workPreflight?.mandatory === true,
      execution_allowed_by_preflight: workPreflight?.governance?.execution_allowed_by_preflight === true,
    },
  });
}

function compactCatalog(value) {
  if (!value || typeof value !== "object") return null;
  if (!SHA256_PATTERN.test(String(value.fingerprint || "")) || !SHA256_PATTERN.test(String(value.root_binding_hash || ""))) return null;
  return {
    ...(safeString(value.version, 128) ? { version: safeString(value.version, 128) } : {}),
    fingerprint: String(value.fingerprint),
    root_binding_hash: String(value.root_binding_hash),
  };
}

function compactValidation(value) {
  if (!value || typeof value !== "object") return null;
  const count = (item) => Number.isFinite(Number(item)) && Number(item) >= 0 ? Math.floor(Number(item)) : 0;
  return {
    ok: value.ok === true,
    branch_count: count(value.branch_count),
    subbranch_count: count(value.subbranch_count),
    node_count: count(value.node_count),
    shard_count: count(value.shard_count),
    checked_shards: count(value.checked_shards),
    unchecked_shards: count(value.unchecked_shards),
  };
}

function compactPreviewBranches(values) {
  if (!Array.isArray(values)) return null;
  const output = [];
  for (const branch of values.slice(0, 20)) {
    const id = safeString(branch?.id, 64);
    if (!id || !ID_PATTERN.test(id)) return null;
    const subbranches = Array.isArray(branch?.subbranches) ? branch.subbranches : [];
    output.push({
      id,
      ...(safeString(branch?.label, 160) ? { label: safeString(branch.label, 160) } : {}),
      ...(safeString(branch?.work_phase, 80) ? { work_phase: safeString(branch.work_phase, 80) } : {}),
      subbranch_count: Number.isFinite(Number(branch?.subbranch_count)) ? Math.max(0, Math.floor(Number(branch.subbranch_count))) : 0,
      subbranches: subbranches.slice(0, 20).map((subbranch) => ({
        id: safeString(subbranch?.id, 64),
        specialized_capability_count: Number.isFinite(Number(subbranch?.specialized_capability_count))
          ? Math.max(0, Math.floor(Number(subbranch.specialized_capability_count)))
          : 0,
      })).filter((subbranch) => subbranch.id && ID_PATTERN.test(subbranch.id)),
    });
  }
  return output;
}

function compactOperationalNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length !== 6) return null;
  const output = [];
  for (const node of nodes) {
    const nodeId = safeString(node?.node_id, 384);
    const parentId = safeString(node?.parent_id, 384);
    const state = safeString(node?.state, 120);
    const nodeType = safeString(node?.node_type, 80);
    const level = Number(node?.level);
    if (!nodeId || !parentId || !state || !nodeType || !Number.isInteger(level) || level < 2 || level > 4) return null;
    const reasonCodes = Array.isArray(node?.reason_codes)
      ? node.reason_codes.slice(0, 6).map((item) => sanitizeReason(item, "invalid_reason")).filter(Boolean)
      : [];
    const compact = { node_id: nodeId, parent_id: parentId, level, node_type: nodeType, state, reason_codes: reasonCodes };
    if (Number.isFinite(Number(node?.confidence))) compact.confidence = Number(node.confidence);
    if (Number.isFinite(Number(node?.confidence_threshold))) compact.confidence_threshold = Number(node.confidence_threshold);
    if (safeString(node?.fallback_node, 384)) compact.fallback_node = safeString(node.fallback_node, 384);
    output.push(compact);
  }
  const levels = output.map((node) => node.level);
  if (levels.filter((level) => level === 2).length !== 1 || levels.filter((level) => level === 3).length !== 1 || levels.filter((level) => level === 4).length !== 4) return null;
  return output;
}

function baseResponseValid(data, { tenantId, requestId, config, policyHash }) {
  if (!data || typeof data !== "object" || data.ok !== true) return { ok: false, reason: "nyra_deep_branch_v2_invalid_response" };
  if (data.schema_version !== RESPONSE_SCHEMA_VERSION) return { ok: false, reason: "nyra_deep_branch_v2_schema_mismatch" };
  if (data.tenant_id !== tenantId || data.request_id !== requestId) return { ok: false, reason: "nyra_deep_branch_v2_tenant_or_request_mismatch" };
  if (data.execution_authorized !== false || data.core_final_authority !== true) return { ok: false, reason: "nyra_deep_branch_v2_authority_violation" };
  if (data.catalog?.fingerprint !== config.catalog_fingerprint || data.catalog?.root_binding_hash !== config.root_binding_hash) {
    return { ok: false, reason: "nyra_deep_branch_v2_catalog_binding_mismatch" };
  }
  if (data.validation?.ok !== true || Number(data.validation?.unchecked_shards || 0) !== 0) {
    return { ok: false, reason: "nyra_deep_branch_v2_validation_incomplete" };
  }
  if (data.provenance?.core_policy_hash !== policyHash) return { ok: false, reason: "nyra_deep_branch_v2_policy_binding_mismatch" };
  return { ok: true };
}

function previewResponseValid(data, context) {
  const base = baseResponseValid(data, context);
  if (!base.ok) return base;
  const allowed = new Set(context.config.branch_allowlist);
  const opened = new Set(context.opened_branch_ids);
  const selected = normalizedBranchIds(data.selected_branches);
  if ((data.selected_branches || []).length !== selected.length) return { ok: false, reason: "nyra_deep_branch_v2_invalid_branch_response" };
  if (selected.some((branchId) => !opened.has(branchId) || !allowed.has(branchId))) {
    return { ok: false, reason: "nyra_deep_branch_v2_branch_containment_violation" };
  }
  const compacted = compactPreviewBranches(data.selected_branches);
  if (!compacted) return { ok: false, reason: "nyra_deep_branch_v2_preview_response_invalid" };
  return { ok: true, selected_branches: compacted };
}

function operationalResponseValid(data, context) {
  const base = baseResponseValid(data, context);
  if (!base.ok) return base;
  const evaluation = data.evaluation;
  const lineage = evaluation?.lineage;
  const nodes = compactOperationalNodes(lineage?.nodes);
  const operationalState = String(evaluation?.state || "");
  if (
    evaluation?.schema_version !== EVALUATION_RESPONSE_SCHEMA_VERSION
    || !["operational_advisory_verified", "operational_advisory_fallback"].includes(operationalState)
    || Number(evaluation?.evaluated_node_count) !== 6
    || typeof evaluation?.all_nodes_verified !== "boolean"
    || !nodes
    || lineage?.branch_id !== context.branch_id
    || lineage?.subbranch_id !== context.subbranch_id
    || !SHA256_PATTERN.test(String(lineage?.package_hash || ""))
    || !SHA256_PATTERN.test(String(data.provenance?.attestation_hash || ""))
    || !SHA256_PATTERN.test(String(data.provenance?.envelope_hash || ""))
    || !safeString(data.provenance?.key_id, 64)
  ) return { ok: false, reason: "nyra_deep_branch_v2_operational_response_invalid" };
  if (nodes.some((node) => !node.node_id.startsWith(`${context.branch_id}.${context.subbranch_id}.`))) {
    return { ok: false, reason: "nyra_deep_branch_v2_operational_lineage_scope_invalid" };
  }
  if (evaluation.all_nodes_verified !== nodes.every((node) => node.state === "advisory_verified")) {
    return { ok: false, reason: "nyra_deep_branch_v2_operational_state_inconsistent" };
  }
  return { ok: true, nodes };
}

function safePreviewResponse(data, context, validation) {
  return {
    schema_version: RESPONSE_SCHEMA_VERSION,
    state: sanitizeReason(data.state, "shadow_v1_authoritative"),
    mode: sanitizeReason(data.mode, "shadow"),
    rollout_mode: context.config.mode,
    tenant_id: context.tenant_id,
    request_id: context.request_id,
    ...(safeString(data.reason, 160) ? { reason: sanitizeReason(data.reason, "nyra_deep_branch_v2_preview") } : {}),
    catalog: compactCatalog(data.catalog),
    validation: compactValidation(data.validation),
    selected_branches: validation.selected_branches,
    evaluation: {
      state: sanitizeReason(data.evaluation?.state, "not_requested_v1_authoritative"),
      evaluated_node_count: Number.isFinite(Number(data.evaluation?.evaluated_node_count))
        ? Math.max(0, Math.floor(Number(data.evaluation.evaluated_node_count)))
        : 0,
    },
    provenance: {
      ...(SHA256_PATTERN.test(String(data.provenance?.envelope_hash || "")) ? { envelope_hash: String(data.provenance.envelope_hash) } : {}),
      core_policy_hash: context.policy_hash,
    },
    execution_authorized: false,
    core_final_authority: true,
    fallback: "nyra_neural_branch_network_v1",
  };
}

function safeOperationalResponse(data, context, validation) {
  const evaluation = data.evaluation;
  return {
    schema_version: RESPONSE_SCHEMA_VERSION,
    state: sanitizeReason(data.state, "operational_advisory_fallback_v1_authoritative"),
    mode: sanitizeReason(data.mode, "shadow"),
    rollout_mode: context.config.operational_mode,
    tenant_id: context.tenant_id,
    request_id: context.request_id,
    catalog: compactCatalog(data.catalog),
    validation: compactValidation(data.validation),
    selected_branches: [],
    evaluation: {
      schema_version: EVALUATION_RESPONSE_SCHEMA_VERSION,
      state: String(evaluation.state),
      evaluated_node_count: 6,
      all_nodes_verified: evaluation.all_nodes_verified === true,
      lineage: {
        branch_id: context.branch_id,
        subbranch_id: context.subbranch_id,
        package_hash: String(evaluation.lineage.package_hash),
        nodes: validation.nodes,
      },
    },
    provenance: {
      envelope_hash: String(data.provenance.envelope_hash),
      attestation_hash: String(data.provenance.attestation_hash),
      key_id: safeString(data.provenance.key_id, 64),
      core_policy_hash: context.policy_hash,
      ...(safeString(data.provenance.preflight_id, 160) ? { preflight_id: safeString(data.provenance.preflight_id, 160) } : {}),
    },
    execution_authorized: false,
    core_final_authority: true,
    fallback: "nyra_neural_branch_network_v1",
  };
}

export function deepBranchV2Config(env = process.env) {
  const rawMode = String(env.CORE_NYRA_DEEP_BRANCH_V2_MODE || "disabled").trim().toLowerCase();
  const mode = VALID_MODES.has(rawMode) ? rawMode : "disabled";
  const tenants = parseList(env.CORE_NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST);
  const branches = parseList(env.CORE_NYRA_DEEP_BRANCH_V2_BRANCHES).filter((branch) => ID_PATTERN.test(branch));
  const catalogFingerprint = String(env.CORE_NYRA_DEEP_BRANCH_V2_EXPECTED_CATALOG_FINGERPRINT || "").trim();
  const rootBindingHash = String(env.CORE_NYRA_DEEP_BRANCH_V2_EXPECTED_ROOT_BINDING_HASH || "").trim();
  const rawUrl = String(env.CORE_NYRA_DEEP_BRANCH_V2_URL || "").trim();
  const configuredOrigin = String(env.CORE_NYRA_DEEP_BRANCH_V2_ALLOWED_ORIGIN || "").trim();
  const allowedOrigin = configuredOrigin || (String(env.NODE_ENV || "").toLowerCase() === "production"
    ? TRUSTED_PRODUCTION_NYRA_ORIGIN
    : (() => { try { return new URL(rawUrl).origin; } catch { return ""; } })());
  const url = normalizedUrl(rawUrl, allowedOrigin);
  const serviceKey = String(env.CORE_NYRA_DEEP_BRANCH_V2_SERVICE_KEY || "").trim();
  const requestedEnabled = truthy(env.CORE_NYRA_DEEP_BRANCH_V2_ENABLED);
  const configurationValid = Boolean(
    requestedEnabled
    && mode !== "disabled"
    && url
    && serviceKey.length >= 32
    && tenants.length > 0
    && branches.length > 0
    && SHA256_PATTERN.test(catalogFingerprint)
    && SHA256_PATTERN.test(rootBindingHash)
  );
  const rawOperationalMode = String(env.CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_MODE || "shadow").trim().toLowerCase();
  const operationalMode = VALID_OPERATIONAL_MODES.has(rawOperationalMode) ? rawOperationalMode : "shadow";
  const operationalTenantAllowlist = parseList(env.CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_TENANT_ALLOWLIST);
  const requestedOperationalEnabled = truthy(env.CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED);
  return {
    enabled: configurationValid,
    requested_enabled: requestedEnabled,
    mode,
    url,
    allowed_origin: allowedOrigin || null,
    service_key: serviceKey,
    tenant_allowlist: tenants,
    branch_allowlist: branches,
    catalog_fingerprint: catalogFingerprint,
    root_binding_hash: rootBindingHash,
    timeout_ms: clampInteger(env.CORE_NYRA_DEEP_BRANCH_V2_TIMEOUT_MS, 2_500, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    circuit_failure_threshold: clampInteger(env.CORE_NYRA_DEEP_BRANCH_V2_CIRCUIT_FAILURE_THRESHOLD, 3, 1, MAX_CIRCUIT_FAILURES),
    circuit_cooldown_ms: clampInteger(env.CORE_NYRA_DEEP_BRANCH_V2_CIRCUIT_COOLDOWN_MS, 30_000, 1_000, MAX_CIRCUIT_COOLDOWN_MS),
    operational_enabled: configurationValid && requestedOperationalEnabled && operationalTenantAllowlist.length > 0,
    operational_requested_enabled: requestedOperationalEnabled,
    operational_mode: operationalMode,
    operational_tenant_allowlist: operationalTenantAllowlist,
  };
}

export function createNyraDeepBranchV2Client({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  const circuit = { failures: 0, open_until: 0, last_reason: null };

  function circuitState(nowMs = now()) {
    return {
      open: circuit.open_until > nowMs,
      failures: circuit.failures,
      open_until: circuit.open_until > nowMs ? new Date(circuit.open_until).toISOString() : null,
      last_reason: circuit.last_reason,
    };
  }

  function recordFailure(reason, config) {
    circuit.failures += 1;
    circuit.last_reason = reason;
    if (circuit.failures >= config.circuit_failure_threshold) circuit.open_until = now() + config.circuit_cooldown_ms;
  }

  function recordSuccess() {
    circuit.failures = 0;
    circuit.open_until = 0;
    circuit.last_reason = null;
  }

  function envelopeContext({
    tenantId,
    requestId,
    selectedByCore = {},
    nyraNetwork = {},
    workPreflight = {},
    branchId = null,
    subbranchId = null,
    operational = false,
  } = {}) {
    const config = deepBranchV2Config(env);
    if (!config.enabled) return { ok: false, response: fallback({ tenantId, requestId, reason: "nyra_deep_branch_v2_core_configuration_disabled" }) };
    if (operational && !config.operational_enabled) {
      return { ok: false, response: fallback({ tenantId, requestId, reason: "nyra_deep_branch_v2_operational_configuration_disabled" }) };
    }
    if (!config.tenant_allowlist.includes(tenantId) || (operational && !config.operational_tenant_allowlist.includes(tenantId))) {
      return { ok: false, response: fallback({ tenantId, requestId, state: "tenant_denied_v1_authoritative", reason: "nyra_deep_branch_v2_tenant_denied" }) };
    }
    if (!REQUEST_ID_PATTERN.test(String(requestId || ""))) {
      return { ok: false, response: fallback({ tenantId, requestId, state: "request_rejected_v1_authoritative", reason: "nyra_deep_branch_v2_request_id_invalid" }) };
    }
    const nowMs = now();
    if (circuit.open_until > nowMs) {
      return { ok: false, response: fallback({ tenantId, requestId, state: "circuit_open_v1_authoritative", reason: "nyra_deep_branch_v2_circuit_open", circuit: circuitState(nowMs) }) };
    }
    const preflightId = safeString(workPreflight?.preflight_id, 160);
    if (!preflightId || workPreflight?.mandatory !== true || /denied|blocked/i.test(String(workPreflight?.state || ""))) {
      return { ok: false, response: fallback({ tenantId, requestId, state: "core_preflight_absent_v1_authoritative", reason: "nyra_deep_branch_v2_core_preflight_required" }) };
    }
    if (operational && !operationalPreflightReady(workPreflight)) {
      return {
        ok: false,
        response: fallback({
          tenantId,
          requestId,
          state: "core_preflight_not_ready_v1_authoritative",
          reason: "nyra_deep_branch_v2_operational_preflight_not_ready",
        }),
      };
    }
    const openedBranchIds = normalizedBranchIds(nyraNetwork?.opened_branches).filter((branch) => config.branch_allowlist.includes(branch));
    if (openedBranchIds.length === 0) {
      return { ok: false, response: fallback({ tenantId, requestId, state: "core_route_absent_v1_authoritative", reason: "nyra_deep_branch_v2_no_core_opened_allowlisted_branch" }) };
    }
    if (branchId && (!ID_PATTERN.test(String(branchId)) || !openedBranchIds.includes(branchId))) {
      return { ok: false, response: fallback({ tenantId, requestId, state: "core_route_absent_v1_authoritative", reason: "nyra_deep_branch_v2_requested_branch_not_core_opened" }) };
    }
    const policyHash = corePolicyHash({ selectedByCore, openedBranchIds, workPreflight });
    const issuedAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + Math.min(45_000, Math.max(5_000, config.timeout_ms * 4))).toISOString();
    const envelope = {
      schema_version: ENVELOPE_SCHEMA_VERSION,
      issuer: ENVELOPE_ISSUER,
      audience: ENVELOPE_AUDIENCE,
      tenant_id: tenantId,
      request_id: String(requestId),
      domain_pack: "skinharmony",
      opened_branch_ids: openedBranchIds,
      branch_allowlist: config.branch_allowlist,
      preflight_id: preflightId,
      core_policy_hash: policyHash,
      catalog_fingerprint: config.catalog_fingerprint,
      root_binding_hash: config.root_binding_hash,
      nonce: crypto.randomBytes(32).toString("hex"),
      issued_at: issuedAt,
      expires_at: expiresAt,
    };
    return {
      ok: true,
      config,
      envelope,
      envelope_binding_hash: coreEnvelopeBindingHash(envelope),
      policy_hash: policyHash,
      // Camel-case aliases keep validators independent of the wire envelope
      // spelling; neither alias is returned to an external caller.
      policyHash,
      tenant_id: tenantId,
      tenantId,
      request_id: String(requestId),
      requestId: String(requestId),
      opened_branch_ids: openedBranchIds,
      branch_id: branchId || null,
      subbranch_id: subbranchId || null,
      issued_at: issuedAt,
      expires_at: expiresAt,
    };
  }

  async function send(context, operationalAttestation = null) {
    const envelope = { ...context.envelope };
    if (operationalAttestation) envelope.operational_attestation = operationalAttestation;
    envelope.signature = signCoreEnvelope(envelope, context.config.service_key);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), context.config.timeout_ms);
    try {
      const response = await fetchImpl(`${context.config.url}/api/nyra/runtime/v2/evaluate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Nyra-Deep-V2-Service-Key": context.config.service_key,
        },
        body: JSON.stringify({ envelope }),
        signal: controller.signal,
        redirect: "error",
      });
      const raw = await response.text();
      if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) {
        return { ok: false, reason: "nyra_deep_branch_v2_response_too_large" };
      }
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { return { ok: false, reason: "nyra_deep_branch_v2_invalid_json" }; }
      if (!response.ok) return { ok: false, reason: `nyra_deep_branch_v2_http_${response.status}` };
      return { ok: true, data };
    } catch (error) {
      return { ok: false, reason: error?.name === "AbortError" ? "nyra_deep_branch_v2_timeout" : "nyra_deep_branch_v2_unreachable" };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function evaluate({ requested = false, ...input } = {}) {
    if (!requested) return fallback({ tenantId: input.tenantId, requestId: input.requestId, state: "not_requested_v1_authoritative", reason: "nyra_deep_branch_v2_preview_not_requested" });
    const context = envelopeContext(input);
    if (!context.ok) return context.response;
    const sent = await send(context);
    if (!sent.ok) {
      recordFailure(sent.reason, context.config);
      return fallback({ tenantId: context.tenant_id, requestId: context.request_id, state: "unavailable_v1_authoritative", reason: sent.reason, circuit: circuitState() });
    }
    const validation = previewResponseValid(sent.data, context);
    if (!validation.ok) {
      recordFailure(validation.reason, context.config);
      return fallback({ tenantId: context.tenant_id, requestId: context.request_id, state: "unavailable_v1_authoritative", reason: validation.reason, circuit: circuitState() });
    }
    recordSuccess();
    return safePreviewResponse(sent.data, context, validation);
  }

  function beginOperational(input = {}) {
    return envelopeContext({
      ...input,
      operational: true,
      branchId: input.branchId,
      subbranchId: input.subbranchId,
    });
  }

  async function evaluateOperational({ context, operationalAttestation } = {}) {
    if (!context?.ok) return context?.response || fallback({ state: "request_rejected_v1_authoritative", reason: "nyra_deep_branch_v2_operational_context_invalid" });
    if (!operationalAttestation || typeof operationalAttestation !== "object") {
      return fallback({ tenantId: context.tenant_id, requestId: context.request_id, state: "request_rejected_v1_authoritative", reason: "nyra_deep_branch_v2_operational_attestation_required" });
    }
    const sent = await send(context, operationalAttestation);
    if (!sent.ok) {
      recordFailure(sent.reason, context.config);
      return fallback({ tenantId: context.tenant_id, requestId: context.request_id, state: "unavailable_v1_authoritative", reason: sent.reason, circuit: circuitState() });
    }
    const validation = operationalResponseValid(sent.data, context);
    if (!validation.ok) {
      recordFailure(validation.reason, context.config);
      return fallback({ tenantId: context.tenant_id, requestId: context.request_id, state: "unavailable_v1_authoritative", reason: validation.reason, circuit: circuitState() });
    }
    recordSuccess();
    return safeOperationalResponse(sent.data, context, validation);
  }

  return {
    beginOperational,
    circuitState,
    evaluate,
    evaluateOperational,
  };
}
