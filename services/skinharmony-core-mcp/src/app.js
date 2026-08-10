import crypto from "node:crypto";
import express from "express";
import {
  createAuthenticator,
  isCodexGoodModeDelegation,
  ownerRequestBinding,
  requireScopes,
} from "./auth.js";
import { TOOLS } from "./tool-definitions.js";
import { createAgentPresence } from "./agent-presence.js";
import { validateToolArguments } from "./schema-validation.js";
import { compactMcpTools } from "./dynamic-capability-router.js";
import {
  HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  HOST_NATIVE_HEALTH_CONTRACT_VERSION,
} from "./host-native-health-contract.js";
import {
  normalizePostgresMajorVerification,
} from "../../shared/postgres-major-version.js";
import { signEnvironmentDelegation, verifyEnvironmentDelegation } from "./environment-delegation.js";

const SERVER_VERSION = "0.16.0-governed-continuity-fabric";
const SERVER_INSTRUCTIONS = [
  "SkinHarmony Nyra & Core is installed as a ChatGPT connector. IMPORTANT: the MCP address is technical and must never be opened in Safari or pasted as a normal web link.",
  "FIRST INSTALLATION ONLY: in ChatGPT open Settings > Apps & connectors > Advanced settings, enable Developer Mode, choose Create app / Add MCP server, name it SkinHarmony Nyra & Core, paste exactly https://skinharmony-core-mcp.onrender.com/mcp as the server URL, select OAuth and tap Connect. If the connector is already present, use it from a new normal chat.",
  "WHAT IT DOES: the first host-supplied request becomes a redacted immutable Intent Anchor when continuity capture is enabled. Nyra interprets it, plans bounded specialist work, supervises evidence and asks for correction until the closure criteria are met. Universal Core remains the final policy authority for tenant isolation, budgets, delegation, audit, release and rollback.",
  "HOST-NATIVE MULTI-AGENT: when the user asks for multi-agent work, Nyra/Core returns a bounded host-native plan. The root ChatGPT or Codex coordinator must create the real children with its native agent capability, then register assignment and result receipts. The server makes zero provider model calls for this path: provider_execution=false, provider_api_key_required=false and server_model_calls=0. A child never inherits owner authority, cannot mint a delegation, and cannot approve its own work. A distinct verifier and a Core closure verdict are required.",
  "DELEGATED ACTIONS: Nyra may request a bounded, expiring, revocable delegation for exact work, repository, branch, action, evidence and rollback. Core may issue a short one-shot action ticket, but host_policy_override is always false and host_policy_must_allow is always true. Nyra/Core cannot click, bypass or replace ChatGPT/Codex approval, sandbox or auto-review controls.",
  "CONTINUITY: use the Work Atlas for targeted context, record only verified incident runbooks, checkpoint every blocker with a clear next action, and resume only after digest and drift verification. Do not close work from a caller-provided supervisor boolean.",
  "OPENAI PROVIDER DISABLED: Nyra and Universal Core operate without an OpenAI API key. Never ask for or accept an API key in chat or a tool argument. Never call provider tools, open setup panels or direct the user to /connect/openai, /agents or /mobile/agents. Old provider links are retired.",
  "RESEARCH DISTILLATION: for current external evidence, call nyra_research_plan, use the host ChatGPT or Codex web tool, then ingest and distill reviewed evidence in the tenant-isolated shadow workspace. Research never invokes a server-side model provider.",
  "HOW TO BUILD AN AGENT: define a narrow role, bounded task digest, dependencies, acceptance criteria, budget, cancellation and a host assignment receipt.",
  "AUTOMATIC: generic flows use preflight, shared memory and continuity; host-native flows use the host coordinator plus Nyra/Core supervision.",
  "NOT AUTOMATIC: host permission grants, unbounded deployment, browsing or external actions.",
  "PRIVACY: Never include secrets, raw customer data or full pages; identity comes only from OAuth or the configured Codex bearer, and only redacted reviewed evidence enters memory.",
].join(" ");

const CONNECTOR_TOOL_NAMESPACE = "skinharmony_nyra_core";
const GENERIC_WORK_CORE_JOIN_TOOL = "work_continuity_generic_core_join";
const GENERIC_WORK_CORE_JOIN_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const BUILD_COMMIT_HEX = /^[a-f0-9]{40}$/;
const MCP_DEFAULT_REQUEST_LIMIT_BYTES = 1024 * 1024;
const MCP_POLICY_ACTIVATE_REQUEST_LIMIT_BYTES = 2 * 1024 * 1024;
const MCP_JSON_BODY_BYTES = Symbol("mcp_json_body_bytes");
export const POLICY_REGISTRY_LIFECYCLE_TOOLS = new Set([
  "nyra_policy_registry_activate",
  "nyra_policy_registry_rollback",
  "nyra_policy_registry_reconcile",
]);
const POLICY_REGISTRY_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const POLICY_REGISTRY_UPSTREAM_PATH = "/api/nyra/policy-registry/attestations";
const POLICY_REGISTRY_HEALTH_BUILD_FIELDS = Object.freeze([
  "build_id", "commit_sha", "commit_verifiable",
]);
const POLICY_REGISTRY_HEALTH_REGISTRY_FIELDS = Object.freeze([
  "configuration_valid", "evaluation", "enforcement", "configured", "backend",
  "restart_durable", "distributed", "compiler_provenance_persistence",
  "compiler_input_persisted", "state", "ready", "compiler_provenance",
  "proof_lifecycle", "proof", "proof_e2e",
]);
const POLICY_REGISTRY_HEALTH_COMPILER_FIELDS = Object.freeze([
  "enabled", "required", "mode", "configuration_valid", "configured", "ready", "state",
  "render_gate_required", "schema_version", "provenance_schema_version", "compiler_algorithm",
  "verification_algorithm", "traversal_budget", "compiler_build_commit", "catalog_digest",
  "trust_catalog_digest", "compiler_input_persisted", "execution_authorized", "error",
]);
const POLICY_REGISTRY_HEALTH_PROOF_LIFECYCLE_FIELDS = Object.freeze([
  "enabled", "required", "mode", "configuration_valid", "state", "ready",
  "render_gate_required", "error",
]);
const POLICY_REGISTRY_HEALTH_PROOF_FIELDS = Object.freeze([
  "ready", "backend", "algorithm", "proof_schema_version", "attestation_schema_version",
  "receipt_schema_version", "compiler_provenance_binding_required", "core_key_id", "nyra_key_id",
  "core_public_key_fingerprint", "nyra_public_key_fingerprint", "signer",
]);
const POLICY_REGISTRY_HEALTH_SIGNER_FIELDS = Object.freeze([
  "ready", "state", "custody", "target_commit",
]);
const POLICY_REGISTRY_HEALTH_E2E_FIELDS = Object.freeze([
  "ready", "proof", "store", "compiler_provenance", "upstream", "e2e_verified",
]);
const POLICY_REGISTRY_HEALTH_STORE_FIELDS = Object.freeze([
  "ready", "backend", "restart_durable", "distributed",
  "compiler_provenance_persistence", "compiler_input_persisted",
]);
const POLICY_REGISTRY_HEALTH_E2E_COMPILER_FIELDS = Object.freeze([
  "ready", "schema_version", "status_schema_version", "mode", "compiler_algorithm",
  "compiler_input_persisted", "execution_authorized",
]);
const POLICY_REGISTRY_HEALTH_UPSTREAM_FIELDS = Object.freeze([
  "configured", "ready", "state", "origin", "path", "redirect_policy",
  "upstream_verified", "probe_attempts", "operation_in_flight", "last_success_at",
  "last_failure_at", "last_failure",
]);

function ownEnumerableDataValue(value, field) {
  try {
    if (!value || typeof value !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value")
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function exactOwnEnumerableDataRecord(value, fields) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== fields.length || keys.some((key) =>
      typeof key !== "string" || !fields.includes(key))) return null;
    const record = {};
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, "value")) return null;
      record[field] = descriptor.value;
    }
    return record;
  } catch {
    return null;
  }
}

function mcpRequestTooLargeError() {
  const error = new Error("Request body too large");
  error.type = "entity.too.large";
  error.status = 413;
  return error;
}

function oversizedMcpRequestTargetsPolicyActivate(buffer) {
  try {
    const body = JSON.parse(buffer.toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      body.method !== "tools/call" || !body.params ||
      typeof body.params !== "object" || Array.isArray(body.params)) return false;
    return resolveConnectorToolName(body.params.name, TOOLS) ===
      "nyra_policy_registry_activate";
  } catch {
    return false;
  }
}

function exactHttpsOrigin(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" && !parsed.username && !parsed.password &&
      !parsed.search && !parsed.hash && ["", "/"].includes(parsed.pathname) &&
      parsed.origin === String(value || "").replace(/\/$/, "");
  } catch {
    return false;
  }
}

export function buildPolicyRegistryLifecycleHealth(config = {}, options = {}, upstream = {}) {
  const enabled = config.policyRegistryLifecycleEnabled === true;
  const required = config.policyRegistryLifecycleRequired === true;
  const configuredError = String(config.policyRegistryLifecycleConfigurationError || "");
  const knownConfigurationErrors = new Set([
    "nyra_policy_registry_lifecycle_enabled_flag_invalid",
    "nyra_policy_registry_lifecycle_required_flag_invalid",
    "nyra_policy_registry_lifecycle_required_without_enabled",
    "nyra_policy_registry_lifecycle_core_origin_invalid",
  ]);
  const configurationError = knownConfigurationErrors.has(configuredError)
    ? configuredError
    : (enabled || required) && config.policyRegistryLifecycleConfigurationValid !== true
      ? "nyra_policy_registry_lifecycle_configuration_invalid"
      : required && !enabled
        ? "nyra_policy_registry_lifecycle_required_without_enabled"
        : enabled && config.policyRegistryLifecycleCoreOriginValid !== true
          ? "nyra_policy_registry_lifecycle_core_origin_invalid"
          : null;
  const strong = (value) => Buffer.byteLength(String(value || "").trim(), "utf8") >= 32;
  const local = {
    host_native_enabled: config.hostNativeAgentProtocolEnabled === true,
    mandatory_presence_enabled: config.mandatoryAgentPresenceEnabled === true,
    continuity_configured: Boolean(String(config.databaseUrl || "").trim()),
    continuity_initialized: options.readiness?.continuityInitialized === true,
    tenant_gateway_configured: strong(config.tenantGatewayKey),
    tenant_context_signing_configured: strong(config.tenantContextSigningSecret),
    owner_context_signing_configured: strong(config.ownerContextSigningSecret),
    dtt_identity_signing_configured: strong(config.dttAgentIdentitySigningSecret),
    agent_presence_signing_configured: strong(config.agentSignatureSecret),
    agent_presence_signing_independent: config.agentSignatureSecretReused !== true,
  };
  const localReady = Object.values(local).every(Boolean);
  const responseOk = ownEnumerableDataValue(upstream, "responseOk") === true;
  const payload = ownEnumerableDataValue(upstream, "payload");
  const build = exactOwnEnumerableDataRecord(
    ownEnumerableDataValue(payload, "build"),
    POLICY_REGISTRY_HEALTH_BUILD_FIELDS,
  );
  const registry = exactOwnEnumerableDataRecord(
    ownEnumerableDataValue(payload, "nyra_policy_registry"),
    POLICY_REGISTRY_HEALTH_REGISTRY_FIELDS,
  );
  const compiler = exactOwnEnumerableDataRecord(
    registry?.compiler_provenance,
    POLICY_REGISTRY_HEALTH_COMPILER_FIELDS,
  );
  const lifecycle = exactOwnEnumerableDataRecord(
    registry?.proof_lifecycle,
    POLICY_REGISTRY_HEALTH_PROOF_LIFECYCLE_FIELDS,
  );
  const proof = exactOwnEnumerableDataRecord(
    registry?.proof,
    POLICY_REGISTRY_HEALTH_PROOF_FIELDS,
  );
  const proofSigner = exactOwnEnumerableDataRecord(
    proof?.signer,
    POLICY_REGISTRY_HEALTH_SIGNER_FIELDS,
  );
  const e2e = exactOwnEnumerableDataRecord(
    registry?.proof_e2e,
    POLICY_REGISTRY_HEALTH_E2E_FIELDS,
  );
  const e2eProof = exactOwnEnumerableDataRecord(
    e2e?.proof,
    POLICY_REGISTRY_HEALTH_PROOF_FIELDS,
  );
  const e2eProofSigner = exactOwnEnumerableDataRecord(
    e2eProof?.signer,
    POLICY_REGISTRY_HEALTH_SIGNER_FIELDS,
  );
  const e2eStore = exactOwnEnumerableDataRecord(
    e2e?.store,
    POLICY_REGISTRY_HEALTH_STORE_FIELDS,
  );
  const e2eCompiler = exactOwnEnumerableDataRecord(
    e2e?.compiler_provenance,
    POLICY_REGISTRY_HEALTH_E2E_COMPILER_FIELDS,
  );
  const e2eUpstream = exactOwnEnumerableDataRecord(
    e2e?.upstream,
    POLICY_REGISTRY_HEALTH_UPSTREAM_FIELDS,
  );
  const keyIdsValid = POLICY_REGISTRY_KEY_ID.test(String(proof?.core_key_id || "")) &&
    POLICY_REGISTRY_KEY_ID.test(String(proof?.nyra_key_id || "")) &&
    proof.core_key_id !== proof.nyra_key_id;
  const fingerprintsValid = SHA256_HEX.test(String(proof?.core_public_key_fingerprint || "")) &&
    SHA256_HEX.test(String(proof?.nyra_public_key_fingerprint || "")) &&
    proof.core_public_key_fingerprint !== proof.nyra_public_key_fingerprint;
  const proofMatchesE2e = e2eProof?.ready === true &&
    e2eProof?.backend === proof?.backend && e2eProof?.algorithm === proof?.algorithm &&
    e2eProof?.core_key_id === proof?.core_key_id && e2eProof?.nyra_key_id === proof?.nyra_key_id &&
    e2eProof?.core_public_key_fingerprint === proof?.core_public_key_fingerprint &&
    e2eProof?.nyra_public_key_fingerprint === proof?.nyra_public_key_fingerprint &&
    e2eProof?.proof_schema_version === proof?.proof_schema_version &&
    e2eProof?.attestation_schema_version === proof?.attestation_schema_version &&
    e2eProof?.receipt_schema_version === proof?.receipt_schema_version &&
    e2eProof?.compiler_provenance_binding_required === true &&
    e2eProofSigner?.ready === true && e2eProofSigner?.state === "ready" &&
    e2eProofSigner?.custody === "external_remote_signer" &&
    e2eProofSigner?.target_commit === proofSigner?.target_commit;
  const buildConsistent = BUILD_COMMIT_HEX.test(String(build?.commit_sha || "")) &&
    build?.commit_verifiable === true && compiler?.compiler_build_commit === build.commit_sha &&
    proofSigner?.target_commit === build.commit_sha;
  const registryReady = responseOk &&
    registry?.configuration_valid === true && registry?.evaluation === "active" &&
    registry?.enforcement === "mandatory" && registry?.configured === true &&
    registry?.backend === "postgresql" && registry?.restart_durable === true &&
    registry?.distributed === true && registry?.compiler_provenance_persistence === true &&
    registry?.compiler_input_persisted === false && registry?.state === "ready" &&
    registry?.ready === true;
  const compilerReady = compiler?.enabled === true && compiler?.required === true &&
    compiler?.mode === "core_deterministic_recompile" &&
    compiler?.configuration_valid === true && compiler?.configured === true &&
    compiler?.ready === true && compiler?.state === "ready" &&
    compiler?.render_gate_required === true &&
    compiler?.schema_version === "nyra_policy_compiler_provenance_status_v1" &&
    compiler?.provenance_schema_version === "nyra_policy_compiler_provenance_v1" &&
    compiler?.compiler_algorithm === "nyra_policy_registry_v1" &&
    compiler?.verification_algorithm === "sha256_canonical_json+ed25519" &&
    Number.isInteger(compiler?.traversal_budget) && compiler.traversal_budget >= 1 &&
    compiler.traversal_budget <= 256 && BUILD_COMMIT_HEX.test(String(compiler?.compiler_build_commit || "")) &&
    SHA256_HEX.test(String(compiler?.catalog_digest || "")) &&
    SHA256_HEX.test(String(compiler?.trust_catalog_digest || "")) &&
    compiler?.compiler_input_persisted === false && compiler?.execution_authorized === false &&
    compiler?.error === null && buildConsistent;
  const proofReady = lifecycle?.enabled === true && lifecycle?.required === true &&
    lifecycle?.mode === "remote" &&
    lifecycle?.configuration_valid === true && lifecycle?.state === "ready" &&
    lifecycle?.ready === true && lifecycle?.render_gate_required === true && lifecycle?.error === null &&
    proof?.ready === true && proof?.backend === "postgresql" &&
    proof?.algorithm === "Ed25519+HMAC-SHA256" && proofSigner?.ready === true &&
    proofSigner?.state === "ready" && proofSigner?.custody === "external_remote_signer" &&
    BUILD_COMMIT_HEX.test(String(proofSigner?.target_commit || "")) &&
    proof?.proof_schema_version === "nyra_policy_registry_proof_v3" &&
    proof?.attestation_schema_version === "nyra_policy_activation_attestation_v3" &&
    proof?.receipt_schema_version === "core_policy_activation_receipt_v3" &&
    proof?.compiler_provenance_binding_required === true &&
    keyIdsValid && fingerprintsValid;
  const e2eCompilerReady = e2eCompiler?.ready === true &&
    e2eCompiler?.schema_version === "nyra_policy_compiler_provenance_v1" &&
    e2eCompiler?.status_schema_version === "nyra_policy_compiler_provenance_status_v1" &&
    e2eCompiler?.mode === "core_deterministic_recompile" &&
    e2eCompiler?.compiler_algorithm === "nyra_policy_registry_v1" &&
    e2eCompiler?.compiler_input_persisted === false &&
    e2eCompiler?.execution_authorized === false &&
    e2eCompiler.schema_version === compiler?.provenance_schema_version &&
    e2eCompiler.status_schema_version === compiler?.schema_version &&
    e2eCompiler.mode === compiler?.mode &&
    e2eCompiler.compiler_algorithm === compiler?.compiler_algorithm;
  const e2eReady = e2e?.ready === true && e2e?.e2e_verified === true && proofMatchesE2e &&
    e2eStore?.ready === true && e2eStore?.backend === "postgresql" &&
    e2eStore?.restart_durable === true && e2eStore?.distributed === true &&
    e2eStore?.compiler_provenance_persistence === true &&
    e2eStore?.compiler_input_persisted === false && e2eCompilerReady &&
    e2eUpstream?.configured === true && e2eUpstream?.ready === true &&
    e2eUpstream?.state === "ready" && exactHttpsOrigin(e2eUpstream?.origin) &&
    e2eUpstream?.path === POLICY_REGISTRY_UPSTREAM_PATH &&
    e2eUpstream?.redirect_policy === "error" && e2eUpstream?.upstream_verified === true &&
    Number.isInteger(e2eUpstream?.probe_attempts) && e2eUpstream.probe_attempts >= 1 &&
    e2eUpstream?.operation_in_flight === false &&
    Number.isFinite(Date.parse(String(e2eUpstream?.last_success_at || ""))) &&
    (e2eUpstream?.last_failure_at === null ||
      Number.isFinite(Date.parse(String(e2eUpstream.last_failure_at)))) &&
    e2eUpstream?.last_failure === null;
  let state = "disabled";
  let reason = "nyra_policy_registry_lifecycle_disabled";
  let ready = false;
  if (configurationError) {
    state = "configuration_invalid";
    reason = configurationError;
  } else if (enabled && !localReady) {
    state = "local_prerequisites_unavailable";
    reason = "nyra_policy_registry_lifecycle_local_prerequisites_unavailable";
  } else if (enabled && !responseOk) {
    state = "upstream_unavailable";
    reason = "nyra_policy_registry_lifecycle_upstream_unavailable";
  } else if (enabled && !registryReady) {
    state = "registry_not_ready";
    reason = "nyra_policy_registry_lifecycle_registry_not_ready";
  } else if (enabled && !proofReady) {
    state = "proof_not_ready";
    reason = "nyra_policy_registry_lifecycle_proof_not_ready";
  } else if (enabled && !compilerReady) {
    state = "compiler_not_ready";
    reason = "nyra_policy_registry_lifecycle_compiler_not_ready";
  } else if (enabled && !e2eReady) {
    state = "e2e_not_ready";
    reason = "nyra_policy_registry_lifecycle_e2e_not_ready";
  } else if (enabled) {
    state = "ready";
    reason = null;
    ready = true;
  }
  return Object.freeze({
    enabled,
    required,
    configuration_valid: configurationError === null,
    configuration_error: configurationError,
    configured: enabled && configurationError === null && localReady,
    ready,
    usable: ready,
    state,
    reason,
    local,
    upstream_ready: registryReady,
    compiler_ready: compilerReady,
    proof_ready: proofReady,
    e2e_ready: e2eReady,
    build_consistent: buildConsistent,
    key_ids_distinct: keyIdsValid,
    public_key_fingerprints_distinct: fingerprintsValid,
    execution_authorized: false,
    provider_execution_authorized: false,
  });
}

function resolveConnectorToolName(value, tools = []) {
  const requested = String(value || "");
  const visibleNames = new Set(tools.map((tool) => tool.name));
  if (visibleNames.has(requested)) return requested;
  const prefix = `${CONNECTOR_TOOL_NAMESPACE}.`;
  if (!requested.startsWith(prefix)) return null;
  const candidate = requested.slice(prefix.length);
  return visibleNames.has(candidate) ? candidate : null;
}

export const GENERIC_PREFLIGHT_EXEMPT_TOOLS = new Set([
  "work_preflight",
  "core_health",
  "nyra_branch_catalog",
  "core_capability_catalog",
  "core_branch_registry",
  "core_capability_read",
  "core_capability_invoke",
  "orchestration_dtt_core_join",
  "nyra_research_airlock_status",
  "nyra_research_airlock_bootstrap",
  "nyra_research_airlock_plan",
  "nyra_research_airlock_open",
  "nyra_research_airlock_discover",
  "nyra_research_airlock_seal",
  "nyra_research_airlock_private_enter",
  "nyra_research_airlock_tool_authorize",
  "nyra_research_airlock_complete",
]);

const GENERIC_PREFLIGHT_CAPABILITIES = new Set([
  "core_action_mediation_evaluate",
  "core_branch_analyze",
]);

export function requiresGenericWorkPreflight(toolName, args = {}) {
  if (
    String(toolName || "") === "core_capability_read" &&
    GENERIC_PREFLIGHT_CAPABILITIES.has(String(args?.capability_id || ""))
  ) return true;
  return !GENERIC_PREFLIGHT_EXEMPT_TOOLS.has(String(toolName || ""));
}

export function buildGenericWorkCoreJoinHealth(config = {}, options = {}, upstream = {}) {
  const enabled = config.genericWorkCoreJoinEnabled === true;
  const required = config.genericWorkCoreJoinRequired === true;
  const configurationCodes = new Set([
    "generic_work_core_join_enabled_flag_invalid",
    "generic_work_core_join_required_flag_invalid",
    "generic_work_core_join_required_without_enabled",
  ]);
  const configuredError = String(config.genericWorkCoreJoinConfigurationError || "");
  const configurationError = configurationCodes.has(configuredError)
    ? configuredError
    : (enabled || required) && config.genericWorkCoreJoinConfigurationValid !== true
      ? "generic_work_core_join_configuration_invalid"
      : required && !enabled
      ? "generic_work_core_join_required_without_enabled"
      : null;
  const suppliedMetadata = options.genericWorkCoreJoin?.verifier?.metadata;
  const verifierMetadata = suppliedMetadata &&
    GENERIC_WORK_CORE_JOIN_KEY_ID.test(String(suppliedMetadata.key_id || "")) &&
    SHA256_HEX.test(String(suppliedMetadata.public_key_fingerprint || "")) &&
    options.genericWorkCoreJoin?.verifier?.algorithm === "Ed25519"
    ? {
        ...suppliedMetadata,
        algorithm: options.genericWorkCoreJoin.verifier.algorithm,
      }
    : null;
  const storeConfigured = options.genericWorkCoreJoin?.storeConfigured === true;
  const storeInitialized = options.readiness?.genericWorkCoreJoinStoreInitialized === true;
  const storeInitializationFailed =
    options.readiness?.genericWorkCoreJoinStoreInitializationFailed === true;
  const coreHealth = upstream?.payload?.generic_work_core_join;
  const upstreamKeyId = GENERIC_WORK_CORE_JOIN_KEY_ID.test(String(coreHealth?.key_id || ""))
    ? String(coreHealth.key_id)
    : null;
  const upstreamFingerprint = SHA256_HEX.test(String(coreHealth?.public_key_fingerprint || ""))
    ? String(coreHealth.public_key_fingerprint)
    : null;
  const upstreamReady = upstream?.responseOk === true
    && coreHealth?.enabled === true
    && coreHealth?.configuration_valid === true
    && coreHealth?.algorithm === "Ed25519"
    && coreHealth?.required === required
    && coreHealth?.ready === true;
  const keyIdMatches = Boolean(verifierMetadata && upstreamKeyId === verifierMetadata.key_id);
  const fingerprintMatches = Boolean(
    verifierMetadata && upstreamFingerprint === verifierMetadata.public_key_fingerprint,
  );
  let state = "disabled";
  let reason = "generic_work_core_join_disabled";
  let ready = false;
  if (configurationError) {
    state = "configuration_invalid";
    reason = configurationError;
  } else if (enabled && !storeConfigured) {
    state = "store_unavailable";
    reason = "generic_work_core_join_store_unavailable";
  } else if (enabled && storeInitializationFailed) {
    state = "store_unavailable";
    reason = "generic_work_core_join_store_unavailable";
  } else if (enabled && !storeInitialized) {
    state = "initializing";
    reason = "generic_work_core_join_store_initializing";
  } else if (enabled && !verifierMetadata) {
    state = "verifier_unavailable";
    reason = "generic_work_core_join_verifier_unavailable";
  } else if (enabled && upstream?.responseOk !== true) {
    state = "upstream_unavailable";
    reason = "generic_work_core_join_upstream_unavailable";
  } else if (enabled && !upstreamReady) {
    state = "upstream_not_ready";
    reason = "generic_work_core_join_upstream_not_ready";
  } else if (enabled && !keyIdMatches) {
    state = "trust_mismatch";
    reason = "generic_work_core_join_key_id_mismatch";
  } else if (enabled && !fingerprintMatches) {
    state = "trust_mismatch";
    reason = "generic_work_core_join_public_key_fingerprint_mismatch";
  } else if (enabled) {
    state = "ready";
    reason = null;
    ready = true;
  }
  return Object.freeze({
    enabled,
    required,
    configuration_valid: configurationError === null,
    configuration_error: configurationError,
    configured: enabled && configurationError === null && storeConfigured && Boolean(verifierMetadata),
    ready,
    usable: ready,
    state,
    reason,
    store_configured: storeConfigured,
    store_initialized: storeInitialized,
    store_initialization_failed: storeInitializationFailed,
    verifier_configured: Boolean(verifierMetadata),
    algorithm: verifierMetadata?.algorithm || null,
    key_id: verifierMetadata?.key_id || null,
    public_key_fingerprint: verifierMetadata?.public_key_fingerprint || null,
    upstream_ready: upstreamReady,
    upstream_key_id_matches: keyIdMatches,
    upstream_public_key_fingerprint_matches: fingerprintMatches,
    host_action_authorized: false,
  });
}
const SESSIONLESS_BOOTSTRAP_TOOLS = new Set([
  "agent_heartbeat",
  "work_preflight",
  "core_health",
  "nyra_branch_catalog",
  "core_capability_catalog",
  "core_branch_registry",
  "core_semantic_select",
  "core_capability_read",
]);

function isAgentPresenceBootstrapCall(toolName, args = {}) {
  return toolName === "agent_heartbeat" ||
    ((toolName === "core_capability_catalog" || toolName === "core_capability_invoke") &&
      args?.capability_id === "agent_heartbeat");
}
const OAUTH_OWNER_ELEVATION_TOOLS = new Set([
  "core_capability_invoke",
  "host_native_delegation_issue",
  "host_native_delegation_revoke",
  ...POLICY_REGISTRY_LIFECYCLE_TOOLS,
  "work_continuity_create",
  "work_continuity_start_or_resume",
  "core_block_remediation_resubmit",
]);

function inferClientType(identity) {
  const kind = String(identity?.kind || "").toLowerCase();
  // This gateway reserves verified OAuth identities for the ChatGPT connector;
  // Codex uses its scoped server-side bearer path below. The distinction is
  // correlation metadata only and never changes scopes or authorization.
  if (kind === "oauth" || kind.includes("chatgpt")) return "chatgpt";
  if (kind.includes("codex")) return "codex";
  return "api_agent";
}

function normalizeTransportSession(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(raw)) return raw;
  return `mcp_${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}

function serverIssuedBootstrapSession() {
  return `mcp_bootstrap_${crypto.randomBytes(16).toString("hex")}`;
}

function buildIdentity(env = process.env) {
  const commitSha = String(env.RENDER_GIT_COMMIT || env.GIT_COMMIT || "").trim();
  if (!/^[a-f0-9]{40}$/i.test(commitSha)) return null;
  return { commit_sha: commitSha, commit_verifiable: true };
}

function normalizedBuildIdentity(value) {
  if (
    value?.commit_verifiable !== true ||
    !/^[a-f0-9]{40}$/i.test(String(value.commit_sha || ""))
  ) {
    return null;
  }
  return {
    commit_sha: String(value.commit_sha).toLowerCase(),
    commit_verifiable: true,
  };
}

function sameConfiguredSecret(left, right) {
  const leftBuffer = Buffer.from(String(left || "").trim(), "utf8");
  const rightBuffer = Buffer.from(String(right || "").trim(), "utf8");
  return (
    leftBuffer.length > 0 &&
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function buildReadiness(config = {}, options = {}) {
  const environment = String(
    config.environment ||
    (config.production === true ? "production" : process.env.NODE_ENV) ||
    "development",
  ).toLowerCase();
  const enforced = environment === "production";
  const configuredBuild = config.runtimeBuildCommit
    ? { commit_sha: config.runtimeBuildCommit, commit_verifiable: true }
    : buildIdentity();
  const build = normalizedBuildIdentity(
    options.buildIdentity === undefined ? configuredBuild : options.buildIdentity,
  );
  const authConfigured = Boolean(
    config.auth0Issuer ||
    (Array.isArray(config.codexKeys) && config.codexKeys.length),
  );
  const hostNativeTenantGatewayConfigured =
    Buffer.byteLength(String(config.tenantGatewayKey || "").trim(), "utf8") >= 32;
  const coreCredentialConfigured = [
    config.universalCoreKey,
    hostNativeTenantGatewayConfigured ? config.tenantGatewayKey : "",
    ...Object.values(config.universalCoreKeys || {}),
  ].some((credential) =>
    typeof credential === "string" && credential.trim().length > 0);
  const coreConfigured = Boolean(config.universalCoreUrl && coreCredentialConfigured);
  const continuityRequired =
    config.hostNativeAgentProtocolEnabled === true ||
    config.workContinuityAutoCaptureEnabled === true;
  const continuityConfigured = Boolean(config.databaseUrl);
  const continuityInitialized = options.readiness?.continuityInitialized === true;
  const ledgerRequired = config.decisionLedgerRequired === true;
  const ledgerConfigured = Boolean(config.databaseUrl);
  const ledgerInitialized = options.readiness?.decisionLedgerInitialized === true;
  const postgresMajorVersion = normalizePostgresMajorVerification(
    options.readiness?.postgresMajorVersion,
  );
  const postgresMajorVersionRequired = enforced && Boolean(config.databaseUrl);
  const hostNativeSecurityRequired =
    enforced && config.hostNativeAgentProtocolEnabled === true;
  const hostNativeOwnerContextSigningConfigured =
    Buffer.byteLength(String(config.ownerContextSigningSecret || ""), "utf8") >= 32;
  const hostNativeTenantContextSigningConfigured =
    Buffer.byteLength(
      String(config.tenantContextSigningSecret || ""),
      "utf8",
    ) >= 32;
  const hostNativeDttIdentitySigningConfigured =
    Buffer.byteLength(
      String(config.dttAgentIdentitySigningSecret || ""),
      "utf8",
    ) >= 32;
  const hostNativeAgentSignatureConfigured =
    Buffer.byteLength(
      String(config.agentSignatureSecret || "").trim(),
      "utf8",
    ) >= 32;
  const hostNativeAgentSignatureReused =
    hostNativeAgentSignatureConfigured &&
    (
      config.agentSignatureSecretReused === true ||
      [
        config.universalCoreKey,
        ...Object.values(config.universalCoreKeys || {}),
        config.tenantGatewayKey,
        config.ownerContextSigningSecret,
        config.tenantContextSigningSecret,
        config.dttAgentIdentitySigningSecret,
        config.nyraDeepV2McpRequestSigningSecret,
        ...(Array.isArray(config.codexKeys) ? config.codexKeys : []),
      ].some((secret) =>
        sameConfiguredSecret(config.agentSignatureSecret, secret))
    );
  const hostNativeAgentSignatureIndependent =
    hostNativeAgentSignatureConfigured && !hostNativeAgentSignatureReused;
  const components = {
    build_identity: {
      required: true,
      configured: build !== null,
      ready: build !== null,
      commit_verifiable: build?.commit_verifiable === true,
    },
    authentication: {
      required: true,
      configured: authConfigured,
      ready: authConfigured,
    },
    universal_core: {
      required: true,
      configured: coreConfigured,
      ready: coreConfigured,
      reachability_checked: false,
    },
    host_native_security: {
      required: hostNativeSecurityRequired,
      tenant_gateway_configured: hostNativeTenantGatewayConfigured,
      owner_context_signing_configured:
        hostNativeOwnerContextSigningConfigured,
      tenant_context_signing_configured:
        hostNativeTenantContextSigningConfigured,
      dtt_identity_signing_configured:
        hostNativeDttIdentitySigningConfigured,
      agent_signature_configured:
        hostNativeAgentSignatureConfigured,
      agent_signature_independent:
        hostNativeAgentSignatureIndependent,
      ready:
        !hostNativeSecurityRequired ||
        (
          hostNativeTenantGatewayConfigured &&
          hostNativeOwnerContextSigningConfigured &&
          hostNativeTenantContextSigningConfigured &&
          hostNativeDttIdentitySigningConfigured &&
          hostNativeAgentSignatureIndependent
        ),
    },
    postgresql_version: {
      required: postgresMajorVersionRequired,
      ready: !postgresMajorVersionRequired || postgresMajorVersion.verified,
      major: postgresMajorVersion.major,
      verified: postgresMajorVersion.verified,
    },
    work_continuity: {
      required: continuityRequired,
      configured: continuityConfigured,
      initialized: continuityInitialized,
      initialization_failed:
        options.readiness?.continuityInitializationFailed === true,
      ready: !continuityRequired ||
        (continuityConfigured && continuityInitialized),
    },
    decision_ledger: {
      required: ledgerRequired,
      configured: ledgerConfigured,
      initialized: ledgerInitialized,
      initialization_failed:
        options.readiness?.decisionLedgerInitializationFailed === true,
      ready: !ledgerRequired || (ledgerConfigured && ledgerInitialized),
    },
  };
  const reasons = [];
  if (!components.build_identity.ready) reasons.push("build_identity_unverifiable");
  if (!components.authentication.ready) reasons.push("authentication_not_configured");
  if (!components.universal_core.ready) reasons.push("universal_core_not_configured");
  if (
    hostNativeSecurityRequired &&
    !hostNativeTenantGatewayConfigured
  ) {
    reasons.push("host_native_tenant_gateway_not_configured");
  }
  if (
    hostNativeSecurityRequired &&
    !hostNativeOwnerContextSigningConfigured
  ) {
    reasons.push("host_native_owner_context_signing_not_configured");
  }
  if (
    hostNativeSecurityRequired &&
    !hostNativeTenantContextSigningConfigured
  ) {
    reasons.push("host_native_tenant_context_signing_not_configured");
  }
  if (
    hostNativeSecurityRequired &&
    !hostNativeDttIdentitySigningConfigured
  ) {
    reasons.push("host_native_dtt_identity_signing_not_configured");
  }
  if (
    hostNativeSecurityRequired &&
    !hostNativeAgentSignatureConfigured
  ) {
    reasons.push("host_native_agent_signature_not_configured");
  } else if (
    hostNativeSecurityRequired &&
    hostNativeAgentSignatureReused
  ) {
    reasons.push("host_native_agent_signature_reused");
  }
  if (
    postgresMajorVersionRequired &&
    !postgresMajorVersion.verified
  ) {
    reasons.push("postgres_major_16_not_verified");
  }
  if (continuityRequired && !continuityConfigured) {
    reasons.push("continuity_postgres_not_configured");
  } else if (continuityRequired && !continuityInitialized) {
    reasons.push("continuity_not_initialized");
  }
  if (ledgerRequired && !ledgerConfigured) {
    reasons.push("decision_ledger_not_configured");
  } else if (ledgerRequired && !ledgerInitialized) {
    reasons.push("decision_ledger_not_initialized");
  }
  return {
    environment,
    enforced,
    ready: reasons.length === 0,
    reasons,
    components,
    build,
  };
}

async function resolvePostgresMajorVersion(config, options) {
  const configured = normalizePostgresMajorVerification(
    options.readiness?.postgresMajorVersion,
  );
  const environment = String(
    config.environment ||
    (config.production === true ? "production" : process.env.NODE_ENV) ||
    "development",
  ).toLowerCase();
  if (environment !== "production" || !config.databaseUrl) return configured;
  const probe = options.postgresMajorVersionProbe;
  const check = typeof probe === "function"
    ? probe
    : typeof probe?.check === "function"
      ? () => probe.check()
      : null;
  if (!check) return configured;
  try {
    return normalizePostgresMajorVerification(await check());
  } catch {
    return normalizePostgresMajorVerification(null);
  }
}

function setBounded(map, key, value, maximum = 5_000) {
  if (map.has(key)) map.delete(key);
  while (map.size >= maximum) map.delete(map.keys().next().value);
  map.set(key, value);
}

function attachAgentPresence(result, presence) {
  if (!presence) return result;
  const structured = result?.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent)
    ? { ...result.structuredContent, agent_presence: presence }
    : { result: result?.structuredContent, agent_presence: presence };
  return {
    ...(result || {}),
    structuredContent: structured,
    _meta: {
      ...(result?._meta || {}),
      "skinharmony/agent_signature": presence.signature,
      "skinharmony/agent_signature_version": presence.signature_version,
    },
  };
}

function resolveWorkPreflight(result, payload) {
  const gate = result?.structuredContent?.gate;
  const authorizedByCoreGate = gate?.allowed === true;
  const allowedByPreflight = payload?.governance?.execution_allowed_by_preflight === true;
  if (!authorizedByCoreGate && !allowedByPreflight) return payload;
  return {
    ...payload,
    state: authorizedByCoreGate ? "completed_after_core_gate" : "completed_read_only",
    gate: gate ? {
      allowed: gate.allowed === true,
      decision: gate.decision || "unknown",
      mediation: gate.mediation || "unknown",
      owner_confirmation_required: gate.owner_confirmation_required === true,
      confirmation_satisfied: gate.confirmation_satisfied === true,
    } : payload?.gate,
    governance: {
      ...(payload?.governance || {}),
      execution_authorized_by_core_gate: authorizedByCoreGate,
      owner_confirmation_required: authorizedByCoreGate
        ? gate?.owner_confirmation_required === true && gate?.confirmation_satisfied !== true
        : payload?.governance?.owner_confirmation_required === true,
    },
  };
}

function attachWorkPreflight(result, preflight) {
  const originalPayload = preflight?.work_preflight || preflight;
  if (!originalPayload || result?.structuredContent?.work_preflight) return result;
  const resolvedPayload = resolveWorkPreflight(result, originalPayload);
  const payload = {
    schema_version: resolvedPayload.schema_version,
    preflight_id: resolvedPayload.preflight_id,
    tenant_id: resolvedPayload.tenant_id,
    state: resolvedPayload.state,
    mandatory: resolvedPayload.mandatory === true,
    core_runtime: resolvedPayload.core_runtime,
    governance: resolvedPayload.governance,
    gate: resolvedPayload.gate || result?.structuredContent?.gate,
    continuity: resolvedPayload.continuity
      ? {
        schema_version: resolvedPayload.continuity.schema_version,
        work_id: resolvedPayload.continuity.work_id,
        project_id: resolvedPayload.continuity.project_id,
        intent_digest: resolvedPayload.continuity.intent_digest,
        architecture_version: resolvedPayload.continuity.architecture_version,
        resumed: resolvedPayload.continuity.idempotent_replay === true,
      }
      : undefined,
    tool_routing: resolvedPayload.tool_routing?.preferred_route
      ? { preferred_route: resolvedPayload.tool_routing.preferred_route }
      : resolvedPayload.tool_routing,
    operational_surface: resolvedPayload.operational_surface,
    gallery_version: resolvedPayload.gallery_version,
    tenant_work_gallery: resolvedPayload.tenant_work_gallery,
    shared_memory_bootstrap: resolvedPayload.shared_memory_bootstrap
      ? {
        loaded: resolvedPayload.shared_memory_bootstrap.loaded === true,
        tenant_id: resolvedPayload.shared_memory_bootstrap.tenant_id,
        generated_at: resolvedPayload.shared_memory_bootstrap.generated_at,
        active_task_count: resolvedPayload.shared_memory_bootstrap.active_task_count,
        active_lock_count: resolvedPayload.shared_memory_bootstrap.active_lock_count,
        artifact_count: resolvedPayload.shared_memory_bootstrap.artifact_count,
      }
      : undefined,
  };
  const executionAllowed = payload?.governance?.execution_allowed_by_preflight === true ||
    payload?.governance?.execution_authorized_by_core_gate === true;
  const structured = result?.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent)
    ? { ...result.structuredContent, work_preflight: payload }
    : { result: result?.structuredContent, work_preflight: payload };
  const summary = {
    mandatory_work_preflight: {
      preflight_id: payload.preflight_id,
      state: payload.state,
      preferred_route: payload.tool_routing?.preferred_route?.id,
      execution_allowed: executionAllowed,
      operational_surface: payload.operational_surface,
      gallery_state: payload.tenant_work_gallery?.state,
      shared_memory_bootstrap_loaded: payload.shared_memory_bootstrap?.loaded === true,
      work_id: payload.continuity?.work_id,
    },
  };
  return {
    ...(result || {}),
    structuredContent: structured,
    content: [
      ...(Array.isArray(result?.content) ? result.content : []),
      { type: "text", text: JSON.stringify(summary) },
    ],
    _meta: {
      ...(result?._meta || {}),
      "skinharmony/preflight_id": payload.preflight_id,
      "skinharmony/preflight_mandatory": true,
    },
  };
}

function securitySchemes(scopes) {
  return [{ type: "oauth2", scopes }];
}

function challenge(
  config,
  error = "invalid_token",
  scope = "",
  description = "Authentication is required to use this MCP resource",
  metadataPath = "/.well-known/oauth-protected-resource",
) {
  const metadata = `${config.publicUrl}${metadataPath}`;
  const safeDescription = String(description).replace(/["\\\r\n]/g, " ").slice(0, 160);
  return `Bearer resource_metadata="${metadata}", error="${error}", error_description="${safeDescription}"${scope ? `, scope="${scope}"` : ""}`;
}

const TOOL_FAILURE_STATUS_BY_CODE = Object.freeze({
  dynamic_capability_arguments_invalid: 422,
  dynamic_capability_query_required: 422,
  dynamic_capability_candidates_empty: 422,
  dynamic_capability_id_invalid: 422,
  dynamic_capability_reserved_argument: 422,
  dynamic_capability_arguments_too_large: 413,
  dynamic_capability_arguments_too_deep: 413,
  dynamic_capability_catalog_revision_mismatch: 409,
  dynamic_capability_unavailable: 404,
  dynamic_capability_read_only_required: 409,
  dynamic_capability_mutation_required: 409,
  dynamic_capability_not_authorized: 403,
  owner_confirmation_required: 403,
  idempotency_key_required: 422,
  continuity_capture_not_authorized: 403,
  generic_work_core_join_disabled: 503,
  generic_work_core_join_store_unavailable: 503,
  generic_work_core_join_store_initializing: 503,
  generic_work_core_join_verifier_unavailable: 503,
  generic_work_core_join_upstream_unavailable: 503,
  generic_work_core_join_response_invalid: 502,
  generic_work_core_join_signature_invalid: 502,
  policy_registry_core_timeout: 504,
  policy_registry_core_unavailable: 503,
  policy_registry_core_redirect_denied: 502,
  policy_registry_core_content_type_invalid: 502,
  policy_registry_core_content_length_invalid: 502,
  policy_registry_core_response_too_large: 502,
  policy_registry_core_response_json_invalid: 502,
  policy_registry_core_response_invalid: 502,
});

function inferredToolFailureStatus(code) {
  if (/_not_found$/.test(code)) return 404;
  if (/_(?:conflict|replayed|expired|revoked|closed|exhausted|limit_reached)$/.test(code)) return 409;
  if (/_(?:not_authorized|forbidden|denied)$/.test(code) ||
      /_(?:authorization|owner|host_policy)_required$/.test(code)) return 403;
  if (/_(?:invalid|required|mismatch|missing)$/.test(code)) return 422;
  return undefined;
}

function toolFailure(error) {
  const raw = String(error?.code || error?.message || "tool_execution_failed");
  const core = raw.match(/^core_request_failed:(\d{3}):([a-zA-Z0-9_-]+)$/);
  const mappedStatus = TOOL_FAILURE_STATUS_BY_CODE[raw];
  const status = Number(
    error?.status ?? error?.statusCode ??
      (core ? core[1] : mappedStatus ?? inferredToolFailureStatus(raw) ?? 500),
  );
  const code = core?.[2] || (/^[a-zA-Z0-9_-]{3,80}$/.test(raw) ? raw : "tool_execution_failed");
  const retryable = error?.retryable === true ||
    status === 429 ||
    [502, 503, 504].includes(status) ||
    (Boolean(core) && status >= 500);
  const message = code === "dynamic_capability_arguments_invalid"
    ? "The capability arguments failed schema validation."
    : retryable
      ? "The governed backend is temporarily unavailable."
      : status >= 500
        ? "The governed request failed."
        : "The governed request was rejected.";
  const payload = {
    ok: false,
    error: {
      code,
      message,
      retryable,
      ...(Number.isFinite(status) ? { status } : {}),
    },
  };
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: true,
  };
}

function configureToolForRuntime(tool, config) {
  if (config.environmentRoutingRequired !== true ||
    POLICY_REGISTRY_LIFECYCLE_TOOLS.has(tool.name)) return tool;
  return {
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: { ...(tool.inputSchema?.properties || {}), environment: { type: "string", enum: ["production", "staging"], description: "Explicit target environment; the gateway never defaults or falls back." } },
      required: [...new Set([...(tool.inputSchema?.required || []), "environment"])],
    },
  };
}

export function createApp(config, options = {}) {
  const app = express();
  const authenticate = createAuthenticator(config, options);
  const handlers = options.handlers || {};
  const beforeToolCall = options.beforeToolCall;
  const afterToolCall = options.afterToolCall;
  const policyRegistryLocallyEligible = config.policyRegistryLifecycleEnabled === true &&
    config.policyRegistryLifecycleConfigurationValid === true &&
    config.policyRegistryLifecycleCoreOriginValid === true;
  const availableTools = TOOLS.filter((tool) =>
    typeof handlers[tool.name] === "function" &&
    (tool.name !== GENERIC_WORK_CORE_JOIN_TOOL || (
      config.genericWorkCoreJoinEnabled === true &&
      config.genericWorkCoreJoinConfigurationValid === true
    )) &&
    (!POLICY_REGISTRY_LIFECYCLE_TOOLS.has(tool.name) || policyRegistryLocallyEligible)
  ).map((tool) => configureToolForRuntime(tool, config));
  const baseVisibleTools = options.toolSurface === "compact"
    ? compactMcpTools(availableTools, handlers).map((tool) => configureToolForRuntime(tool, config))
    : availableTools;
  const upstreamHealthCacheTtlMs = Math.min(Math.max(
    Number(options.policyRegistryHealthCacheTtlMs || 2_000),
    50,
  ), 5_000);
  const upstreamHealthTimeoutMs = Math.min(Math.max(
    Number(options.policyRegistryHealthTimeoutMs || 3_000),
    10,
  ), 3_000);
  let upstreamHealthCache = { responseOk: false, payload: null, checkedAt: 0, expiresAt: 0 };
  let upstreamHealthInFlight = null;

  async function probeUniversalCoreHealth({ force = false } = {}) {
    const now = Date.now();
    if (!force && upstreamHealthCache.expiresAt > now) return upstreamHealthCache;
    if (upstreamHealthInFlight) return upstreamHealthInFlight;
    const endpoint = `${config.universalCoreUrl}/healthz`;
    const controller = new AbortController();
    let reader = null;
    let timer;
    const upstreamOperation = (async () => {
        const response = await (options.fetchImpl || globalThis.fetch)(endpoint, {
          method: "GET",
          headers: { accept: "application/json" },
          redirect: "error",
          signal: controller.signal,
        });
        if (!response || response.redirected === true || (response.url && response.url !== endpoint)) {
          throw new Error("core_health_redirect_denied");
        }
        const contentType = String(response.headers?.get?.("content-type") || "").trim().toLowerCase();
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/.test(contentType)) {
          throw new Error("core_health_content_type_invalid");
        }
        const maximumBytes = 256 * 1024;
        const rawLength = response.headers?.get?.("content-length");
        if (rawLength !== null && rawLength !== undefined && rawLength !== "") {
          if (!/^\d+$/.test(String(rawLength))) throw new Error("core_health_content_length_invalid");
          const declaredLength = Number(rawLength);
          if (!Number.isSafeInteger(declaredLength) || declaredLength > maximumBytes) {
            throw new Error("core_health_response_too_large");
          }
        }
        const chunks = [];
        let received = 0;
        if (response.body && typeof response.body.getReader === "function") {
          reader = response.body.getReader();
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            const chunk = Buffer.from(part.value);
            received += chunk.byteLength;
            if (received > maximumBytes) {
              void reader.cancel().catch(() => {});
              throw new Error("core_health_response_too_large");
            }
            chunks.push(chunk);
          }
        } else if (typeof response.arrayBuffer === "function") {
          const bytes = Buffer.from(await response.arrayBuffer());
          received = bytes.byteLength;
          if (received > maximumBytes) throw new Error("core_health_response_too_large");
          chunks.push(bytes);
        } else {
          throw new Error("core_health_response_invalid");
        }
        const payload = JSON.parse(Buffer.concat(chunks, received).toString("utf8"));
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new Error("core_health_response_invalid");
        }
        return {
          responseOk: response.ok === true,
          payload,
        };
    })();
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        if (reader) void reader.cancel().catch(() => {});
        reject(new Error("core_health_timeout"));
      }, upstreamHealthTimeoutMs);
    });
    const operation = (async () => {
      try {
        const result = await Promise.race([upstreamOperation, deadline]);
        const checkedAt = Date.now();
        upstreamHealthCache = {
          ...result,
          checkedAt,
          expiresAt: checkedAt + upstreamHealthCacheTtlMs,
        };
      } catch {
        const checkedAt = Date.now();
        upstreamHealthCache = {
          responseOk: false,
          payload: null,
          checkedAt,
          expiresAt: checkedAt + Math.min(upstreamHealthCacheTtlMs, 500),
        };
      } finally {
        clearTimeout(timer);
      }
      return upstreamHealthCache;
    })();
    upstreamHealthInFlight = operation;
    try {
      return await operation;
    } finally {
      if (upstreamHealthInFlight === operation) upstreamHealthInFlight = null;
    }
  }

  function policyRegistryHealth(upstream = upstreamHealthCache) {
    return buildPolicyRegistryLifecycleHealth(config, options, upstream);
  }

  async function visibleToolsForRequest({ forcePolicyProbe = false } = {}) {
    if (!policyRegistryLocallyEligible) {
      return baseVisibleTools.filter((tool) => !POLICY_REGISTRY_LIFECYCLE_TOOLS.has(tool.name));
    }
    const upstream = await probeUniversalCoreHealth({ force: forcePolicyProbe });
    const lifecycle = policyRegistryHealth(upstream);
    return lifecycle.ready
      ? baseVisibleTools
      : baseVisibleTools.filter((tool) => !POLICY_REGISTRY_LIFECYCLE_TOOLS.has(tool.name));
  }
  // A host can rotate the MCP transport between tool calls from one logical chat.
  // Keep the transport binding for anti-switch protection, while correlating the
  // server-signed presence through the explicitly declared logical session id.
  // Client-provided ids are correlation data only and never grant authorization.
  const logicalSessionPresences = new Map();
  const transportPresenceBindings = new Map();
  const consumedEnvironmentDelegations = new Map();
  app.use(express.json({
    limit: MCP_POLICY_ACTIVATE_REQUEST_LIMIT_BYTES,
    verify(req, _res, buffer) {
      const bytes = buffer.byteLength;
      if (bytes > MCP_DEFAULT_REQUEST_LIMIT_BYTES &&
        !oversizedMcpRequestTargetsPolicyActivate(buffer)) {
        throw mcpRequestTooLargeError();
      }
      req[MCP_JSON_BODY_BYTES] = bytes;
    },
  }));
  app.use((error, req, res, next) => {
    if (error?.type !== "entity.too.large") return next(error);
    if (Object.hasOwn(error, "body")) delete error.body;
    req.body = undefined;
    return res.status(413).json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32602, message: "Request body too large" },
    });
  });
  app.use((req, res, next) => {
    const bytes = Number(req[MCP_JSON_BODY_BYTES] || 0);
    const requestedTool = req.body?.method === "tools/call"
      ? resolveConnectorToolName(req.body?.params?.name, TOOLS)
      : null;
    const maximum = requestedTool === "nyra_policy_registry_activate"
      ? MCP_POLICY_ACTIVATE_REQUEST_LIMIT_BYTES
      : MCP_DEFAULT_REQUEST_LIMIT_BYTES;
    if (bytes <= maximum) return next();
    return res.status(413).json({
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: { code: -32602, message: "Request body too large" },
    });
  });
  app.use((_req, res, next) => {
    res.set("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
    next();
  });

  const serveHealth = async (_req, res, { strictReadiness = false } = {}) => {
    const postgresMajorVersion = await resolvePostgresMajorVersion(
      config,
      options,
    );
    const readiness = buildReadiness(config, {
      ...options,
      readiness: {
        ...options.readiness,
        postgresMajorVersion,
      },
    });
    const upstreamHealth = await probeUniversalCoreHealth();
    const payload = upstreamHealth.payload;
    const validPayload = payload !== null
      && typeof payload === "object"
      && typeof payload.ok === "boolean"
      && typeof payload.render_ready === "boolean"
      && payload.build !== null
      && typeof payload.build === "object"
      && payload.research_airlock !== null
      && typeof payload.research_airlock === "object";
    const airlockSafe = validPayload && (
      payload.research_airlock.ready === true
      || (payload.research_airlock.mode === "shadow" && payload.research_airlock.operational_safe === true)
    );
    const coreReady = upstreamHealth.responseOk
      && validPayload
      && payload.ok === true
      && payload.render_ready === true
      && airlockSafe;
    const upstreamBootstrapInitializing = upstreamHealth.responseOk
      && validPayload
      && payload.ok === false
      && payload.render_ready === false
      && payload.liveness_degraded === true
      && payload.build.commit_verifiable === true
      && payload.causal_continuity?.production_required === true
      && payload.causal_continuity?.state === "initializing"
      && airlockSafe;
    const researchAirlock = validPayload ? {
      core_ready: coreReady,
      upstream_bootstrap_initializing: upstreamBootstrapInitializing,
      mode: payload?.research_airlock?.mode || "unknown",
      state_backend: payload?.research_airlock?.state_backend || "unavailable",
      operational_safe: payload?.research_airlock?.operational_safe === true,
      build_commit_sha: payload?.build?.commit_sha || null,
    } : {
      core_ready: false,
      upstream_bootstrap_initializing: false,
      mode: "unavailable",
      state_backend: "unavailable",
    };
    const genericWorkCoreJoin = buildGenericWorkCoreJoinHealth(
      config,
      options,
      upstreamHealth,
    );
    const policyRegistryLifecycle = policyRegistryHealth(upstreamHealth);
    // Production MCP readiness must not depend on a mode value supplied by an
    // unreachable upstream. Once deployed, Core Airlock is a hard dependency:
    // unknown/unavailable is therefore unready, never an implicit opt-out.
    const airlockRequired = readiness.environment === "production";
    const combinedReady = readiness.ready
      && (!airlockRequired || researchAirlock.core_ready)
      && (!genericWorkCoreJoin.required || genericWorkCoreJoin.ready)
      && (!policyRegistryLifecycle.required || policyRegistryLifecycle.ready);
    const requiredLifecycleUnavailable = policyRegistryLifecycle.required
      && !policyRegistryLifecycle.ready;
    const degradedLivenessReady = readiness.ready
      && airlockRequired
      && researchAirlock.upstream_bootstrap_initializing === true
      && (!genericWorkCoreJoin.required || genericWorkCoreJoin.ready)
      && (!policyRegistryLifecycle.required || policyRegistryLifecycle.ready);
    const healthReady = combinedReady
      || (!strictReadiness && degradedLivenessReady);
    const status = (readiness.enforced && !healthReady) || requiredLifecycleUnavailable ? 503 : 200;
    return res.status(status).json({
    ok: (!readiness.enforced || combinedReady) && !requiredLifecycleUnavailable,
    service: "skinharmony-core-mcp",
    version: SERVER_VERSION,
    build: readiness.build,
    mode: readiness.environment,
    render_ready: combinedReady,
    research_airlock: {
      ...researchAirlock,
      production_required: airlockRequired,
    },
    generic_work_core_join: genericWorkCoreJoin,
    nyra_policy_registry_lifecycle: policyRegistryLifecycle,
    readiness: {
      enforced: readiness.enforced,
      ready: readiness.ready,
      reasons: readiness.reasons,
      components: readiness.components,
    },
    health_contract_version: HOST_NATIVE_HEALTH_CONTRACT_VERSION,
    health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
    auth_configured: readiness.components.authentication.configured,
    tenant_membership_bindings: Object.keys(config.oauthTenantMemberships || {}).length,
    core_configured: readiness.components.universal_core.configured,
    owner_context_signing_configured: Boolean(config.ownerContextSigningSecret),
    tenant_context_signing_configured:
      readiness.components.host_native_security.tenant_context_signing_configured,
    postgresql: {
      major: readiness.components.postgresql_version.major,
      verified: readiness.components.postgresql_version.verified,
    },
    shared_memory_configured: Boolean(config.sharedMemoryRoot),
    cloud_memory: {
      configured: Boolean(config.databaseUrl),
      backend: config.databaseUrl ? "postgres" : "filesystem",
      persistent: Boolean(config.databaseUrl),
      tenant_isolated: true,
    },
    decision_ledger: {
      configured: Boolean(config.databaseUrl),
      required: config.decisionLedgerRequired === true,
      backend: config.databaseUrl ? "postgres_append_only" : "disabled",
      tenant_isolated: true,
      raw_prompts_stored: false,
    },
    work_continuity: {
      configured: Boolean(config.databaseUrl),
      enabled: Boolean(config.databaseUrl),
      backend: config.databaseUrl ? "postgres" : "disabled",
      persistent: Boolean(config.databaseUrl),
      schema_version: "work_continuity_v2",
      gallery_schema_version: "tenant_work_gallery_v1",
      auto_capture_enabled: config.workContinuityAutoCaptureEnabled === true,
      intent_anchor_redacted: true,
      raw_prompts_stored: false,
      tenant_isolated: true,
      bounded_leases: true,
      agent_ownership_allowed: false,
    },
    host_native_agents: {
      enabled: config.hostNativeAgentProtocolEnabled === true,
      readiness_required:
        readiness.components.host_native_security.required,
      tenant_gateway_configured:
        readiness.components.host_native_security.tenant_gateway_configured,
      owner_context_signing_configured:
        readiness.components.host_native_security.owner_context_signing_configured,
      tenant_context_signing_configured:
        readiness.components.host_native_security.tenant_context_signing_configured,
      dtt_identity_signing_configured:
        readiness.components.host_native_security.dtt_identity_signing_configured,
      agent_signature_configured:
        readiness.components.host_native_security.agent_signature_configured,
      agent_signature_independent:
        readiness.components.host_native_security.agent_signature_independent,
      ready: readiness.components.host_native_security.ready,
      provider_execution: false,
      provider_api_key_required: false,
      server_model_calls: 0,
      host_spawn_required: true,
      host_policy_override: false,
    },
    agent_workspace_configured: Boolean(config.agentWorkspaceRoot),
    memory_fabric_configured: Boolean(config.memoryFabricRoot),
    research_cortex_configured: Boolean(config.researchCortexRoot),
    suite_control_plane: {
      configured: Boolean(config.suiteControlPlaneUrl && Object.keys(config.suiteControlPlaneKeys || {}).length),
      tenant_bindings: Object.keys(config.suiteControlPlaneKeys || {}).length,
      execution_allowed: false,
    },
    nyra_god_mode: {
      configured: config.godModeEnabled === true,
      active: config.godModeEnabled === true && config.godModeEmergencyStop !== true,
      tenant_isolated: true,
      emergency_stop: config.godModeEmergencyStop === true
    }
  });
  };

  app.get("/healthz", (req, res) => serveHealth(req, res));
  app.get("/readyz", (req, res) => serveHealth(req, res, { strictReadiness: true }));

  const protectedResourceMetadata = (_req, res) => res.json({
    // Keep one canonical OAuth resource/audience across versioned transport
    // paths. The versioned path exists only to give MCP clients a fresh
    // connector identity; Auth0 tokens are still issued for config.resource.
    resource: config.resource,
    authorization_servers: config.auth0Issuer ? [config.auth0Issuer] : [],
    scopes_supported: config.supportedScopes,
    bearer_methods_supported: ["header"],
    resource_documentation: `${config.publicUrl}/docs/auth`
  });
  app.get("/.well-known/oauth-protected-resource", protectedResourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp-v015", protectedResourceMetadata);
  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    if (!config.auth0Issuer) return res.status(404).json({ error: "oauth_not_configured" });
    return res.json({
      issuer: config.auth0Issuer,
      authorization_endpoint: `${config.auth0Issuer}/authorize`,
      token_endpoint: `${config.auth0Issuer}/oauth/token`,
      jwks_uri: config.jwksUri,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"]
    });
  });

  app.post(["/mcp", "/mcp-v015"], async (req, res) => {
    const resourceMetadataPath = req.path === "/mcp-v015"
      ? "/.well-known/oauth-protected-resource/mcp-v015"
      : "/.well-known/oauth-protected-resource";
    let identity;
    try {
      const delegation = req.headers["x-skinharmony-environment-delegation"];
      if (delegation) {
        if (config.environmentDelegationReceiverEnabled !== true) throw new Error("environment_delegation_disabled");
        const verified = verifyEnvironmentDelegation(delegation, { key: config.environmentDelegationKey, consumed: consumedEnvironmentDelegations });
        const delegatedToolName = resolveConnectorToolName(req.body?.params?.name, baseVisibleTools);
        if (req.body?.method === "tools/call" && verified.toolName !== delegatedToolName) throw new Error("environment_delegation_invalid");
        identity = verified.identity;
      } else identity = await authenticate(req.headers.authorization);
    } catch {
      res.set("WWW-Authenticate", challenge(
        config,
        "invalid_token",
        "",
        "Authentication is required to use this MCP resource",
        resourceMetadataPath,
      ));
      return res.status(401).json({ jsonrpc: "2.0", id: req.body?.id ?? null, error: { code: -32001, message: "Unauthorized" } });
    }
    const { id = null, method, params = {} } = req.body || {};
    const requestedBaseTool = method === "tools/call"
      ? resolveConnectorToolName(params.name, baseVisibleTools)
      : null;
    const requestVisibleTools = ["tools/list", "tools/call"].includes(method)
      ? await visibleToolsForRequest({
          forcePolicyProbe: POLICY_REGISTRY_LIFECYCLE_TOOLS.has(requestedBaseTool),
        })
      : baseVisibleTools;
    let activeToolCall = null;
    let afterToolCallAttempted = false;
    try {
      if (method === "initialize") {
        const sessionId = normalizeTransportSession(req.headers["mcp-session-id"]) || `mcp_${crypto.randomBytes(16).toString("hex")}`;
        res.set("Mcp-Session-Id", sessionId);
        return res.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "skinharmony-core-mcp", version: SERVER_VERSION }, instructions: SERVER_INSTRUCTIONS } });
      }
      if (method === "notifications/initialized") return res.status(202).end();
      if (method === "resources/list") return res.json({ jsonrpc: "2.0", id, result: { resources: [] } });
      if (method === "resources/read") return res.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown resource" } });
      if (method === "tools/list") return res.json({ jsonrpc: "2.0", id, result: { tools: requestVisibleTools.map(({ scopes, ...tool }) => {
        const schemes = securitySchemes(scopes);
        const genericPreflightRequired = requiresGenericWorkPreflight(tool.name);
        return {
          ...tool,
          securitySchemes: schemes,
          _meta: {
            ...(tool._meta || {}),
            securitySchemes: schemes,
            "skinharmony/scopes": scopes,
            ...(genericPreflightRequired ? { "skinharmony/mandatory_first_tool": "work_preflight" } : {}),
            ...(!genericPreflightRequired ? { "skinharmony/native_governance": "authenticated_tenant_control_plane" } : {}),
            "skinharmony/preflight_entrypoint": tool.name === "work_preflight",
            "skinharmony/shared_memory_lifecycle": "automatic_task_contract_and_checkpoint",
            "skinharmony/research_entrypoint": tool.name === "nyra_research_plan",
            "skinharmony/research_sequence": "plan -> host web -> ingest -> query -> feedback",
          },
        };
      }) } });
      if (method === "tools/call") {
        const canonicalToolName = resolveConnectorToolName(params.name, requestVisibleTools);
        const tool = requestVisibleTools.find((item) => item.name === canonicalToolName);
        if (!tool) return res.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown tool" } });
        requireScopes(identity, tool.scopes);
        if (!handlers[tool.name]) return res.json({ jsonrpc: "2.0", id, error: { code: -32603, message: "Tool backend unavailable" } });
        const rawArgs = params.arguments || {};
        const validationErrors = validateToolArguments(tool.inputSchema, rawArgs);
        if (validationErrors.length) {
          return res.json({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message: "Invalid tool arguments",
              data: { tool: tool.name, violations: validationErrors.slice(0, 20) },
            },
          });
        }
        if (identity.kind === "oauth" && identity.oauthOwnerBound === true &&
          OAUTH_OWNER_ELEVATION_TOOLS.has(tool.name) && rawArgs.owner_confirmed === true) {
          identity = authenticate.elevateOAuthOwner(identity, {
            confirmed: true,
            confirmationReference: rawArgs.confirmation_reference,
            requestBinding: ownerRequestBinding(tool.name, rawArgs),
          });
        }
        if (config.environmentRoutingRequired === true && rawArgs.environment === "staging") {
          const forwardedArgs = { ...rawArgs };
          delete forwardedArgs.environment;
          let upstream;
          try {
            upstream = await fetch(`${config.stagingMcpUrl}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "x-skinharmony-environment-delegation": signEnvironmentDelegation({ identity, toolName: tool.name, key: config.environmentDelegationKey }), ...(req.headers["mcp-session-id"] ? { "mcp-session-id": String(req.headers["mcp-session-id"]) } : {}) }, body: JSON.stringify({ ...req.body, params: { ...params, name: tool.name, arguments: forwardedArgs } }) });
          } catch {
            const error = new Error("staging_delegation_unavailable"); error.code = "staging_delegation_unavailable"; throw error;
          }
          const body = await upstream.json().catch(() => null);
          if (!body) { const error = new Error("staging_delegation_unavailable"); error.code = "staging_delegation_unavailable"; throw error; }
          const upstreamSession = upstream.headers.get("mcp-session-id");
          if (upstreamSession) res.set("Mcp-Session-Id", upstreamSession);
          return res.status(upstream.status).json(body);
        }
        const transportSessionId = normalizeTransportSession(req.headers["mcp-session-id"]);
        const declaredSessionId = normalizeTransportSession(rawArgs.session_id);
        const transportPresence = transportSessionId
          ? transportPresenceBindings.get(transportSessionId)
          : null;
        // Some MCP hosts omit the optional transport session header on the first
        // call. Permit only bootstrap/diagnostic tools and issue a fresh opaque
        // session that the host can reuse. Stateful tools still fail closed, and
        // concurrent chats never collapse into one identity-derived session.
        const needsBootstrapSession = !transportSessionId && !declaredSessionId;
        if (needsBootstrapSession &&
          !SESSIONLESS_BOOTSTRAP_TOOLS.has(tool.name) &&
          !isAgentPresenceBootstrapCall(tool.name, rawArgs)) {
          const presenceError = new Error("agent_presence_session_required");
          presenceError.code = "agent_presence_session_required";
          throw presenceError;
        }
        const serverIssuedSessionId = needsBootstrapSession
          ? serverIssuedBootstrapSession()
          : "";
        if (
          transportPresence?.binding_source === "declared" &&
          declaredSessionId &&
          transportPresence.session_id !== declaredSessionId
        ) {
          const presenceError = new Error("agent_presence_conflict");
          presenceError.code = "agent_presence_conflict";
          throw presenceError;
        }
        const sessionId = transportPresence?.session_id || declaredSessionId || transportSessionId || serverIssuedSessionId;
        const serverIssuedBootstrap = Boolean(serverIssuedSessionId);
        const hostNativeReporterAgentId = tool.name === "work_continuity_native_report"
          ? rawArgs.native_agent_id
          : null;
        const requestedAgentId = (!serverIssuedBootstrap && (
          rawArgs.agent_id ||
          rawArgs.from_agent_id ||
          hostNativeReporterAgentId
        )) || transportPresence?.agent_id ||
          `agent_${crypto.createHash("sha256").update(`${identity.subject || identity.kind || "client"}\u0000${sessionId}`).digest("hex").slice(0, 20)}`;
        const presenceInput = {
          agent_id: requestedAgentId,
          client_type: (!serverIssuedBootstrap && rawArgs.client_type) || transportPresence?.client_type || inferClientType(identity),
          session_id: sessionId,
        };
        const agentPresence = createAgentPresence(config, identity, presenceInput);
        const transportAgentPresence = transportSessionId
          ? createAgentPresence(config, identity, {
              ...presenceInput,
              session_id: transportSessionId,
            })
          : null;
        const attestedAgentPresence = {
          ...agentPresence,
          // Keep the opaque logical session only on the server-side identity.
          // The mandatory presence hook needs it to renew the exact signed
          // session, while the public response can continue to omit it.
          session_id: sessionId,
          transport_bound: Boolean(transportAgentPresence),
          host_transport_session_fingerprint:
            transportAgentPresence?.session_fingerprint || null,
        };
        const logicalPresence = logicalSessionPresences.get(agentPresence.session_fingerprint);
        if (
          (transportPresence && transportPresence.signature !== agentPresence.signature) ||
          (logicalPresence && logicalPresence.signature !== agentPresence.signature)
        ) {
          const presenceError = new Error("agent_presence_conflict");
          presenceError.code = "agent_presence_conflict";
          throw presenceError;
        }
        const presenceBinding = {
          ...attestedAgentPresence,
          session_id: sessionId,
          binding_source: transportPresence?.binding_source || (declaredSessionId ? "declared" : transportSessionId ? "transport" : "server_bootstrap"),
        };
        setBounded(logicalSessionPresences, agentPresence.session_fingerprint, presenceBinding);
        if (transportSessionId || serverIssuedSessionId) {
          setBounded(transportPresenceBindings, sessionId, presenceBinding);
        }
        if (serverIssuedSessionId) res.set("Mcp-Session-Id", serverIssuedSessionId);
        const args = { ...rawArgs, ...presenceInput };
        delete args.environment;
        // A request flag is never an identity assertion. Generic Core writes
        // still require verified owner-root confirmation; the two explicit
        // continuity bootstrap tools additionally accept a fresh, server-bound
        // OAuth tenant-owner elevation.
        const explicitOAuthOwnerConfirmation =
          OAUTH_OWNER_ELEVATION_TOOLS.has(tool.name) &&
          identity.oauthOwnerElevated === true &&
          args.owner_confirmed === true;
        const codexGoodModeHostNativeDelegation =
          ["host_native_delegation_issue", "host_native_delegation_revoke"].includes(tool.name) &&
          isCodexGoodModeDelegation(identity, config);
        const explicitOwnerConfirmation = (
          codexGoodModeHostNativeDelegation ||
          identity.godMode === true ||
          explicitOAuthOwnerConfirmation
        ) &&
          (codexGoodModeHostNativeDelegation || args.owner_confirmed === true);
        const callIdentity = {
          ...identity,
          agentPresence: presenceBinding,
          ownerConfirmed: explicitOwnerConfirmation,
          confirmationReference: explicitOwnerConfirmation
            ? (codexGoodModeHostNativeDelegation
              ? "god_mode_codex"
              : String(args.confirmation_reference || "").slice(0, 240))
            : "",
        };
        activeToolCall = { identity: callIdentity, toolName: tool.name, args, hookContext: null, preflight: null };
        let hookContext = null;
        if (typeof beforeToolCall === "function") {
          try {
            hookContext = await beforeToolCall({ identity: callIdentity, toolName: tool.name, args });
          } catch (error) {
            if (error?.hookContext) activeToolCall.hookContext = error.hookContext;
            throw error;
          }
        }
        const preflight = requiresGenericWorkPreflight(tool.name, args)
          ? (hookContext?.preflight ?? hookContext)
          : null;
        activeToolCall = { ...activeToolCall, hookContext, preflight };
        // The compact dynamic router accepts a preflight only at its wrapper
        // boundary. Resolve the server-issued envelope across the two valid
        // handler shapes and never inspect caller-supplied nested arguments.
        const serverIssuedPreflight = preflight?.work_preflight
          || preflight?.result?.work_preflight
          || (preflight?.schema_version === "skinharmony_work_preflight_v1" ? preflight : null);
        const handlerArgs = serverIssuedPreflight
          ? { ...args, work_preflight: serverIssuedPreflight }
          : args;
        const rawResult = await handlers[tool.name](handlerArgs, callIdentity);
        const preflightResult = attachWorkPreflight(rawResult, preflight);
        const result = attachAgentPresence(preflightResult, agentPresence);
        if (typeof afterToolCall === "function") {
          afterToolCallAttempted = true;
          try {
            await afterToolCall({ identity: callIdentity, toolName: tool.name, args, result, preflight, hookContext });
          } catch (hookError) {
            if (tool.annotations?.readOnlyHint !== true) throw hookError;
          }
        }
        return res.json({ jsonrpc: "2.0", id, result });
      }
      return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    } catch (error) {
      if (["agent_presence_session_required", "agent_presence_conflict", "agent_presence_registration_required", "agent_presence_registration_failed"].includes(error.code)) {
        return res.status(error.code === "agent_presence_conflict" ? 409 : error.code === "agent_presence_registration_failed" ? 503 : 400).json({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: error.code },
        });
      }
      if (typeof afterToolCall === "function" && method === "tools/call" && !afterToolCallAttempted) {
        try {
          await afterToolCall(activeToolCall
            ? { ...activeToolCall, error }
            : { identity, toolName: params.name, args: params.arguments || {}, error });
        } catch {}
      }
      if (error.message === "insufficient_scope") {
        res.set("WWW-Authenticate", challenge(
          config,
          "insufficient_scope",
          error.missing.join(" "),
          "Authentication is required to use this MCP resource",
          resourceMetadataPath,
        ));
        return res.status(403).json({ jsonrpc: "2.0", id, error: { code: -32003, message: "Insufficient scope" } });
      }
      if (error.message === "owner_authentication_stale") {
        res.set("WWW-Authenticate", challenge(
          config,
          "invalid_token",
          "",
          "Fresh owner authentication is required; reconnect the OAuth session",
          resourceMetadataPath,
        ));
        return res.status(401).json({
          jsonrpc: "2.0",
          id,
          error: { code: -32001, message: "Fresh owner authentication is required" },
        });
      }
      if (error.message === "memory_checksum_mismatch") {
        return res.status(400).json({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "memory_checksum_mismatch" },
        });
      }
      if (method === "tools/call") return res.json({ jsonrpc: "2.0", id, result: toolFailure(error) });
      return res.status(500).json({ jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error" } });
    }
  });
  return app;
}

export { attachWorkPreflight, buildIdentity, inferClientType, resolveConnectorToolName, resolveWorkPreflight, securitySchemes, serverIssuedBootstrapSession, toolFailure, TOOLS };
