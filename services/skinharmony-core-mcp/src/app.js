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
  "Nyra/Core is a persistent work coordinator: reuse the Work Identity, compact checkpoint and next action returned by the gateway. Do not rescan the repository, recreate the intent, or ask the user to restate known work.",
  "A bound Work automatically carries Nyra's persistent operational dialogue: use its next action, checkpoint/Intent references, self-diagnosis and assignment before requesting more context. Do not make the AI rediscover or explicitly call Nyra for ordinary Work orchestration. When the user specifically addresses Nyra conversationally, use the read-only nyra_converse capability; it reuses the persisted context when it is current and falls back to Core only when it is stale.",
  "Generic tools receive tenant memory, Work selection and preflight automatically. Do not call work_preflight before a normal action. If one operational Work matches the project, it is resumed automatically; ask the owner to choose only when the gateway reports multiple works.",
  "Treat one verified owner confirmation as the authorization for its exact bounded intent. Continue its approved preparation, verification and ticketed release path without requesting duplicate confirmations. Ask again only when Core reports a new scope, expiry, drift, or an action outside that intent.",
  "For a recoverable connector/OAuth failure, checkpoint the exact blocker and state the one real recovery action. After the user reconnects, resume the same Work and ticket path; never say that a reconnect alone completed a push, merge or deploy.",
  "For current research, use nyra_research_plan then the host ChatGPT or Codex web tool; never include secrets in evidence. Nyra and Universal Core operate without an OpenAI API key. Never ask for or accept an API key in chat. Never call provider tools, open setup panels or old provider links. Old provider links are retired.",
  "Nyra/Core is installed as a ChatGPT connector. Nyra coordinates and Core decides. Neither bypasses ChatGPT/Codex host approvals, sandbox, OAuth, GitHub or Render. Keep prompts and receipts free of secrets and raw customer data; use only host-native agents and no provider API key.",
  "HOST-NATIVE MULTI-AGENT: HOW TO BUILD AN AGENT: use a narrow role, bounded task, dependencies, acceptance criteria and a host assignment receipt; provider_execution=false and provider_api_key_required=false. AUTOMATIC: preflight, continuity and compact memory. NOT AUTOMATIC: external actions or host approvals; Nyra/Core cannot click, bypass or replace ChatGPT/Codex approval. RESEARCH DISTILLATION uses the tenant-isolated shadow workspace and never invokes a server-side model provider.",
].join(" ");

const CONNECTOR_TOOL_NAMESPACE = "skinharmony_nyra_core";
const GENERIC_WORK_CORE_JOIN_TOOL = "work_continuity_generic_core_join";
const GENERIC_WORK_CORE_JOIN_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const BUILD_COMMIT_HEX = /^[a-f0-9]{40}$/;
const MCP_DEFAULT_REQUEST_LIMIT_BYTES = 1024 * 1024;
const MCP_POLICY_ACTIVATE_REQUEST_LIMIT_BYTES = 2 * 1024 * 1024;
const MCP_JSON_BODY_BYTES = Symbol("mcp_json_body_bytes");
const RESEARCH_AIRLOCK_BOOTSTRAP_GUARD_SCHEMA = "research_airlock_bootstrap_guard_v1";
const RESEARCH_AIRLOCK_BOOTSTRAP_GUARD_PURPOSE = "causal_initialization_liveness";
const RESEARCH_AIRLOCK_POLICY_VERSION = "nyra_core_research_airlock_policy_v1";
const MAX_CORE_HEALTH_RESPONSE_BYTES = 64 * 1024;
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

function canonicalHealthValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) return value.map(canonicalHealthValue);
  if (!value || typeof value !== "object") throw new Error("health_canonical_value_invalid");
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalHealthValue(value[key])]),
  );
}

function canonicalHealthDigest(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalHealthValue(value)))
    .digest("hex");
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function sameDigest(left, right) {
  if (!/^[a-f0-9]{64}$/.test(String(left || "")) || !/^[a-f0-9]{64}$/.test(String(right || ""))) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function verifyResearchAirlockBootstrapGuard({ payload, responseUrl, responseRedirected, configuredCoreUrl }) {
  const guard = payload?.research_airlock?.bootstrap_guard;
  if (!exactKeys(guard, [
    "accepting_new_work", "build_commit_sha", "causal_production_required", "causal_state",
    "distributed", "guard_digest", "health_contract_digest", "initialization_elapsed_ms",
    "liveness_window_ms", "mode", "policy_version", "purpose", "readiness_verified",
    "restart_durable", "runtime_verified", "schema_version", "static_guard_ready", "store_backend",
  ])) return false;
  let expectedHealthUrl;
  let observedUrl;
  try {
    const configured = new URL(configuredCoreUrl);
    if (configured.protocol !== "https:" || configured.username || configured.password) return false;
    expectedHealthUrl = new URL("/healthz", configured);
    observedUrl = new URL(responseUrl);
  } catch {
    return false;
  }
  if (responseRedirected !== false
    || observedUrl.protocol !== "https:"
    || observedUrl.origin !== expectedHealthUrl.origin
    || observedUrl.pathname !== expectedHealthUrl.pathname
    || observedUrl.search !== ""
    || observedUrl.hash !== "") return false;
  if (guard.schema_version !== RESEARCH_AIRLOCK_BOOTSTRAP_GUARD_SCHEMA
    || guard.purpose !== RESEARCH_AIRLOCK_BOOTSTRAP_GUARD_PURPOSE
    || guard.policy_version !== RESEARCH_AIRLOCK_POLICY_VERSION
    || guard.static_guard_ready !== true
    || guard.mode !== "enforced"
    || guard.store_backend !== "postgresql"
    || guard.restart_durable !== true
    || guard.distributed !== true
    || guard.accepting_new_work !== false
    || guard.runtime_verified !== false
    || guard.readiness_verified !== false
    || payload.mode !== "production"
    || guard.build_commit_sha !== payload.build?.commit_sha
    || guard.build_commit_sha !== payload.build?.build_id
    || guard.health_contract_digest !== payload.health_contract_digest
    || guard.health_contract_digest !== HOST_NATIVE_HEALTH_CONTRACT_DIGEST
    || !/^[a-f0-9]{40}$/.test(guard.build_commit_sha)
    || payload.build?.commit_verifiable !== true
    || payload.readiness_verified !== false
    || guard.readiness_verified !== payload.readiness_verified
    || payload.readiness !== false
    || payload.ok !== false
    || payload.render_ready !== false
    || payload.liveness_degraded !== true
    || guard.causal_state !== payload.causal_continuity?.state
    || guard.causal_state !== "initializing"
    || guard.causal_production_required !== true
    || payload.causal_continuity?.production_required !== true
    || payload.causal_continuity?.error != null
    || guard.mode !== payload.research_airlock?.mode
    || guard.policy_version !== payload.research_airlock?.policy_version
    || guard.store_backend !== payload.research_airlock?.state_backend
    || guard.restart_durable !== payload.research_airlock?.restart_durable
    || guard.distributed !== payload.research_airlock?.distributed
    || !Number.isSafeInteger(guard.liveness_window_ms)
    || guard.liveness_window_ms < 1
    || guard.liveness_window_ms > 60 * 60 * 1_000
    || !Number.isSafeInteger(guard.initialization_elapsed_ms)
    || guard.initialization_elapsed_ms < 0
    || guard.initialization_elapsed_ms > guard.liveness_window_ms
    || payload.research_airlock?.ready !== false
    || payload.research_airlock?.operational_safe !== false
    || payload.research_airlock?.accepting_new_work !== false
    || Object.hasOwn(payload.research_airlock, "runtime")
    || Object.hasOwn(payload.research_airlock, "runtime_ready")
    || Object.hasOwn(payload.research_airlock, "readiness")
  ) return false;
  const { guard_digest: digest, ...unsigned } = guard;
  return sameDigest(digest, canonicalHealthDigest(unsigned));
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
  // nyra_converse owns a strict cache-or-one-preflight protocol. Letting the
  // generic hook preflight it as well duplicates Core calls on stale context.
  "nyra_converse",
  "core_health",
  "nyra_branch_catalog",
  "core_capability_catalog",
  "core_branch_registry",
  "core_capability_read",
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
  const requestedTool = String(toolName || "");
  const heartbeatArgs = requestedTool === "core_capability_invoke"
    ? args?.arguments
    : args;
  const metadataFreeHeartbeatBootstrap =
    (requestedTool === "agent_heartbeat" ||
      (requestedTool === "core_capability_invoke" && String(args?.capability_id || "") === "agent_heartbeat")) &&
    heartbeatArgs && typeof heartbeatArgs === "object" && !Array.isArray(heartbeatArgs) &&
    !Object.hasOwn(heartbeatArgs, "display_name") &&
    !Object.hasOwn(heartbeatArgs, "capabilities") &&
    !Object.hasOwn(heartbeatArgs, "recovery_context");
  if (requestedTool === "agent_heartbeat") return !metadataFreeHeartbeatBootstrap;
  if (requestedTool === "core_capability_invoke") {
    // A dynamic mutation must always enter through the server-issued Work
    // Preflight. The only exception is the metadata-free heartbeat bootstrap,
    // which establishes the signed presence needed by later work operations.
    // Any heartbeat that changes metadata or recovers prior state is routed
    // through Work Preflight like every other dynamic mutation.
    return !metadataFreeHeartbeatBootstrap;
  }
  if (
    requestedTool === "core_capability_read" &&
    GENERIC_PREFLIGHT_CAPABILITIES.has(String(args?.capability_id || ""))
  ) return true;
  return !GENERIC_PREFLIGHT_EXEMPT_TOOLS.has(requestedTool);
}

function serverIssuedWorkPreflight(preflight, identity) {
  const envelope = preflight?.work_preflight
    || preflight?.result?.work_preflight
    || (preflight?.schema_version === "skinharmony_work_preflight_v1" ? preflight : null);
  if (
    !envelope || typeof envelope !== "object" || Array.isArray(envelope) ||
    envelope.schema_version !== "skinharmony_work_preflight_v1" ||
    typeof envelope.preflight_id !== "string" || envelope.preflight_id.trim().length < 3 ||
    envelope.mandatory !== true ||
    typeof envelope.tenant_id !== "string" || envelope.tenant_id !== identity?.tenantId ||
    envelope.operational_surface !== "tenant_work_gallery"
  ) {
    const error = new Error("work_preflight_binding_invalid");
    error.code = "work_preflight_binding_invalid";
    error.status = 422;
    throw error;
  }
  return envelope;
}

export function buildGenericWorkCoreJoinHealth(config = {}, options = {}, upstream = {}) {
  const connectorEnabled = config.genericWorkCoreJoinEnabled === true;
  const required = config.genericWorkCoreJoinRequired === true;
  const configurationCodes = new Set([
    "generic_work_core_join_enabled_flag_invalid",
    "generic_work_core_join_required_flag_invalid",
    "generic_work_core_join_required_without_enabled",
  ]);
  const configuredError = String(config.genericWorkCoreJoinConfigurationError || "");
  const configurationError = configurationCodes.has(configuredError)
    ? configuredError
    : (connectorEnabled || required) && config.genericWorkCoreJoinConfigurationValid !== true
      ? "generic_work_core_join_configuration_invalid"
      : required && !connectorEnabled
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
  const upstreamAvailable = upstream?.responseOk === true && coreHealth !== null && typeof coreHealth === "object";
  const upstreamEnabled = upstreamAvailable && coreHealth.enabled === true;
  const upstreamBackend = coreHealth?.backend === "postgresql" ? "postgresql" : "unavailable";
  const upstreamRestartDurable = coreHealth?.restart_durable === true;
  const upstreamDistributed = coreHealth?.distributed === true;
  const upstreamSignerState = new Set([
    "configured", "forbidden", "invalid", "ready", "rejected", "unavailable", "unconfigured",
  ]).has(String(coreHealth?.signer_state || ""))
    ? String(coreHealth.signer_state)
    : "unavailable";
  const upstreamState = new Set([
    "configuration_invalid", "disabled", "durability_or_signing_unavailable", "failed", "initializing",
    "ready", "signer_not_yet_verified", "signer_unavailable", "unavailable",
  ]).has(String(coreHealth?.state || ""))
    ? String(coreHealth.state)
    : "unavailable";
  const upstreamReason = /^generic_work_core_join_[a-z0-9_]+$/.test(String(coreHealth?.reason || ""))
    ? String(coreHealth.reason)
    : null;
  const upstreamKeyId = GENERIC_WORK_CORE_JOIN_KEY_ID.test(String(coreHealth?.key_id || ""))
    ? String(coreHealth.key_id)
    : null;
  const upstreamFingerprint = SHA256_HEX.test(String(coreHealth?.public_key_fingerprint || ""))
    ? String(coreHealth.public_key_fingerprint)
    : null;
  const upstreamReady = upstreamAvailable
    && upstreamEnabled
    && coreHealth?.configuration_valid === true
    && coreHealth?.algorithm === "Ed25519"
    && coreHealth?.required === required
    && coreHealth?.ready === true
    && upstreamBackend === "postgresql"
    && upstreamRestartDurable
    && upstreamDistributed
    && upstreamSignerState === "ready";
  const keyIdMatches = Boolean(verifierMetadata && upstreamKeyId === verifierMetadata.key_id);
  const fingerprintMatches = Boolean(
    verifierMetadata && upstreamFingerprint === verifierMetadata.public_key_fingerprint,
  );
  let state = connectorEnabled ? "unavailable" : "disabled";
  let reason = "generic_work_core_join_disabled";
  let ready = false;
  if (configurationError) {
    state = "configuration_invalid";
    reason = configurationError;
  } else if (!connectorEnabled) {
    state = "disabled";
    reason = "generic_work_core_join_disabled";
  } else if (!upstreamAvailable) {
    state = "unavailable";
    reason = "generic_work_core_join_upstream_unavailable";
  } else if (!upstreamEnabled) {
    state = upstreamState;
    reason = upstreamReason || "generic_work_core_join_disabled";
  } else if (upstreamBackend !== "postgresql") {
    state = "durability_or_signing_unavailable";
    reason = upstreamReason || "generic_work_core_join_postgres_unavailable";
  } else if (!upstreamRestartDurable) {
    state = "durability_or_signing_unavailable";
    reason = upstreamReason || "generic_work_core_join_durable_store_unavailable";
  } else if (!upstreamDistributed) {
    state = "durability_or_signing_unavailable";
    reason = upstreamReason || "generic_work_core_join_distributed_store_unavailable";
  } else if (upstreamSignerState !== "ready") {
    state = upstreamState;
    reason = upstreamReason || "generic_work_core_join_signer_unavailable";
  } else if (coreHealth.ready !== true) {
    state = upstreamState;
    reason = upstreamReason || "generic_work_core_join_upstream_not_ready";
  } else if (!storeConfigured) {
    state = "store_unavailable";
    reason = "generic_work_core_join_store_unavailable";
  } else if (storeInitializationFailed) {
    state = "store_unavailable";
    reason = "generic_work_core_join_store_unavailable";
  } else if (!storeInitialized) {
    state = "initializing";
    reason = "generic_work_core_join_store_initializing";
  } else if (!verifierMetadata) {
    state = "verifier_unavailable";
    reason = "generic_work_core_join_verifier_unavailable";
  } else if (!upstreamReady) {
    state = "upstream_not_ready";
    reason = "generic_work_core_join_upstream_not_ready";
  } else if (!keyIdMatches) {
    state = "trust_mismatch";
    reason = "generic_work_core_join_key_id_mismatch";
  } else if (!fingerprintMatches) {
    state = "trust_mismatch";
    reason = "generic_work_core_join_public_key_fingerprint_mismatch";
  } else {
    state = "ready";
    reason = null;
    ready = true;
  }
  return Object.freeze({
    enabled: ready,
    required,
    configuration_valid: configurationError === null,
    configuration_error: configurationError,
    configured: connectorEnabled && configurationError === null && storeConfigured && Boolean(verifierMetadata),
    ready,
    usable: ready,
    state,
    reason,
    store_configured: storeConfigured,
    store_initialized: storeInitialized,
    store_initialization_failed: storeInitializationFailed,
    backend: upstreamBackend,
    restart_durable: upstreamRestartDurable,
    distributed: upstreamDistributed,
    signer_state: upstreamSignerState,
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
  "tenant_work_legacy_reconcile_close",
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

export function resolveHostTransportPresence({
  identity,
  toolName,
  capabilityId,
  declaredSessionId,
  agentPresence,
  transportAgentPresence,
} = {}) {
  if (transportAgentPresence) {
    return Object.freeze({
      presence: transportAgentPresence,
      binding_source: "transport",
    });
  }
  const membership = identity?.authenticatedTenantMembership;
  const oauthNativePlanCall =
    toolName === "work_continuity_native_plan" ||
    (toolName === "core_capability_invoke" && capabilityId === "work_continuity_native_plan");
  const oauthLogicalSessionBound = Boolean(
    oauthNativePlanCall &&
    declaredSessionId &&
    agentPresence &&
    identity?.kind === "oauth" &&
    identity?.oauthOwnerBound === true &&
    membership?.authenticated === true &&
    membership?.tenant_id === identity?.tenantId &&
    membership?.role === "tenant_owner",
  );
  return Object.freeze({
    presence: oauthLogicalSessionBound ? agentPresence : null,
    binding_source: oauthLogicalSessionBound ? "oauth_declared" : null,
  });
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

// Whitelist the durable Nyra briefing field-by-field. It is enough for a new
// AI to continue the Work, while raw Intent, evidence, Gallery records and
// Atlas nodes remain server-side.
function projectNyraDialogue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const work = value.work && typeof value.work === "object" ? value.work : {};
  const checkpoint = work.checkpoint && typeof work.checkpoint === "object" ? work.checkpoint : {};
  const gallery = work.gallery && typeof work.gallery === "object" ? work.gallery : {};
  const software = work.software && typeof work.software === "object" ? work.software : {};
  const diagnosis = value.self_diagnosis && typeof value.self_diagnosis === "object" ? value.self_diagnosis : {};
  const manual = value.manual && typeof value.manual === "object" ? value.manual : {};
  const learning = value.learning && typeof value.learning === "object" ? value.learning : {};
  return {
    schema_version: value.schema_version,
    dialogue_id: value.dialogue_id || null,
    mode: value.mode,
    persistent: value.persistent === true,
    session_strategy: value.session_strategy,
    activation: value.activation,
    manual: { version: manual.version || null, digest: manual.digest || null },
    work: {
      work_id: work.work_id || null,
      project_id: work.project_id || null,
      work_revision: Number.isSafeInteger(Number(work.work_revision)) ? Number(work.work_revision) : null,
      intent_digest: work.intent_digest || null,
      checkpoint: { capsule_id: checkpoint.capsule_id || null, capsule_digest: checkpoint.capsule_digest || null, available: checkpoint.available === true },
      gallery: { state: gallery.state || "unknown", work_count: Number(gallery.work_count || 0) },
      software: {
        state: software.state || "not_indexed",
        atlas_revision: Number.isSafeInteger(Number(software.atlas_revision)) ? Number(software.atlas_revision) : null,
        source_hash: software.source_hash || null,
        context_digest: software.context_digest || null,
        discovery_required: software.discovery_required === true,
      },
    },
    self_diagnosis: {
      schema_version: diagnosis.schema_version,
      state: diagnosis.state || "unknown",
      source: diagnosis.source || "unknown",
      local_action: diagnosis.local_action || "Refresh the bounded Nyra context.",
      core_action: diagnosis.core_action || "Consult Core only when a policy or integrity decision is needed.",
      automatic_correction: diagnosis.automatic_correction || "context_refreshed",
      ...(diagnosis.remaining_action ? { remaining_action: diagnosis.remaining_action } : {}),
    },
    connected_ai_instruction: Array.isArray(value.connected_ai_instruction) ? value.connected_ai_instruction.slice(0, 3) : [],
    learning: {
      mode: learning.mode || "local_verified_evidence",
      update_on: learning.update_on || "verified_outcome_or_incident_verification",
      model_weight_training: false,
    },
    operation: value.operation || "continue",
    dialogue_digest: value.dialogue_digest || null,
    execution_authorized: false,
    external_action_authorized: false,
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
    // The server-owned compact context is the contract for Nyra and connected
    // AIs. It is intentionally separate from the complete audit envelope.
    nyra_control_context: resolvedPayload.nyra_control_context
      ? {
        schema_version: resolvedPayload.nyra_control_context.schema_version,
        context_digest: resolvedPayload.nyra_control_context.context_digest,
        work_id: resolvedPayload.nyra_control_context.work_id,
        project_id: resolvedPayload.nyra_control_context.project_id,
        work_state: resolvedPayload.nyra_control_context.work_state,
        next_action: resolvedPayload.nyra_control_context.next_action,
        assignment: resolvedPayload.nyra_control_context.assignment,
        connector: resolvedPayload.nyra_control_context.connector,
        // This is the compact, server-issued Nyra briefing for a newly
        // connected AI. Do not replace it with the full Work/Gallery/Atlas.
        nyra_dialogue: projectNyraDialogue(resolvedPayload.nyra_control_context.nyra_dialogue),
        execution_authorized: false,
        external_action_authorized: false,
      }
      : undefined,
    tool_routing: resolvedPayload.tool_routing?.preferred_route
      ? { preferred_route: resolvedPayload.tool_routing.preferred_route }
      : resolvedPayload.tool_routing,
    operational_surface: resolvedPayload.operational_surface,
    gallery_version: resolvedPayload.gallery_version,
    // The full Gallery is retained by Core. Repeating every Work summary to
    // every connected AI makes fresh chats spend tokens rediscovering the
    // same state; the compact control context above identifies the selected
    // Work and next action instead.
    tenant_work_gallery: resolvedPayload.tenant_work_gallery
      ? {
        schema_version: resolvedPayload.tenant_work_gallery.schema_version,
        tenant_id: resolvedPayload.tenant_work_gallery.tenant_id,
        available: resolvedPayload.tenant_work_gallery.available === true,
        state: resolvedPayload.tenant_work_gallery.state,
        generated_at: resolvedPayload.tenant_work_gallery.generated_at,
        tenant_isolated: true,
        work_count: resolvedPayload.tenant_work_gallery.work_count,
      }
      : undefined,
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
      control_context_id: payload.nyra_control_context?.context_digest,
      next_action: payload.nyra_control_context?.next_action,
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
  let upstreamHealthCache = {
    responseOk: false,
    responseStatus: null,
    responseUrl: null,
    responseRedirected: null,
    payload: null,
    checkedAt: 0,
    expiresAt: 0,
  };
  let upstreamHealthInFlight = null;

  async function probeUniversalCoreHealth({ force = false } = {}) {
    const now = Date.now();
    if (!force && upstreamHealthCache.expiresAt > now) return upstreamHealthCache;
    if (upstreamHealthInFlight) return upstreamHealthInFlight;
    const controller = new AbortController();
    let reader = null;
    let timer;
    const upstreamOperation = (async () => {
        const endpoint = new URL("/healthz", config.universalCoreUrl).toString();
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
        const maximumBytes = MAX_CORE_HEALTH_RESPONSE_BYTES;
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
          responseStatus: response.status,
          responseUrl: response.url,
          responseRedirected: response.redirected,
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
          responseStatus: null,
          responseUrl: null,
          responseRedirected: null,
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
    // Readiness is an admission gate, so it must not accept a cached liveness
    // observation.  The public liveness probe keeps the bounded cache used by
    // Policy Registry tool discovery, while /readyz forces the same bounded,
    // single-flight and deadline-protected upstream probe to refresh.
    const upstreamHealth = await probeUniversalCoreHealth({ force: strictReadiness });
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
    const bootstrapGuardVerified = upstreamHealth.responseStatus === 200
      && validPayload
      && verifyResearchAirlockBootstrapGuard({
        payload,
        responseUrl: upstreamHealth.responseUrl,
        responseRedirected: upstreamHealth.responseRedirected,
        configuredCoreUrl: config.universalCoreUrl,
      });
    const upstreamBootstrapInitializing = upstreamHealth.responseOk
      && validPayload
      && payload.ok === false
      && payload.render_ready === false
      && payload.liveness_degraded === true
      && payload.build.commit_verifiable === true
      && payload.causal_continuity?.production_required === true
      && payload.causal_continuity?.state === "initializing"
      && bootstrapGuardVerified;
    const researchAirlock = validPayload ? {
      core_ready: coreReady,
      upstream_bootstrap_initializing: upstreamBootstrapInitializing,
      mode: payload?.research_airlock?.mode || "unknown",
      state_backend: payload?.research_airlock?.state_backend || "unavailable",
      operational_safe: payload?.research_airlock?.operational_safe === true,
      build_commit_sha: payload?.build?.commit_sha || null,
      bootstrap_guard_verified: bootstrapGuardVerified,
    } : {
      core_ready: false,
      upstream_bootstrap_initializing: false,
      mode: "unavailable",
      state_backend: "unavailable",
      bootstrap_guard_verified: false,
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

  // Render deployment liveness must not wait on downstream Core readiness.
  // Keep /healthz and /readyz as the governed dependency/readiness views.
  app.get("/livez", (_req, res) => res.status(200).json({
    ok: true,
    service: "skinharmony-core-mcp",
    liveness: "process_running",
  }));
  app.get("/healthz", (req, res) => serveHealth(req, res));
  app.get("/readyz", (req, res) => serveHealth(req, res, { strictReadiness: true }));

  const protectedResourceMetadata = (_req, res) => res.json({
    // Keep one canonical OAuth resource/audience across versioned transport
    // paths. The versioned path exists only to give MCP clients a fresh
    // connector identity; Auth0 tokens are still issued for config.resource.
    resource: config.resource,
    authorization_servers: config.auth0Issuer ? [config.auth0Issuer] : [],
    // Advertise `offline_access` without treating it as a Core authorization
    // entitlement.  OAuth clients need this scope to obtain a refresh token.
    scopes_supported: [...new Set([
      ...((config.oauthScopesSupported || config.supportedScopes || [])
        .filter((scope) => scope !== "offline_access")),
      "offline_access",
    ])],
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
            // The gateway executes this preflight itself immediately before a
            // generic tool.  Advertising it as a first manual tool caused
            // hosts to pay for the same preflight twice (once visibly, then
            // once again during protected execution).
            ...(genericPreflightRequired ? { "skinharmony/automatic_preflight": true } : {}),
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
        const hostTransportPresence = resolveHostTransportPresence({
          identity,
          toolName: tool.name,
          capabilityId: rawArgs.capability_id,
          declaredSessionId,
          agentPresence,
          transportAgentPresence,
        });
        const attestedAgentPresence = {
          ...agentPresence,
          // Keep the opaque logical session only on the server-side identity.
          // The mandatory presence hook needs it to renew the exact signed
          // session, while the public response can continue to omit it.
          session_id: sessionId,
          transport_bound: Boolean(hostTransportPresence.presence),
          host_transport_session_fingerprint:
            hostTransportPresence.presence?.session_fingerprint || null,
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
          binding_source: transportPresence?.binding_source ||
            hostTransportPresence.binding_source ||
            (declaredSessionId ? "declared" : transportSessionId ? "transport" : "server_bootstrap"),
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
        // Dynamic invocations receive only an envelope emitted by the local
        // preflight hook. If that hook is unavailable or malformed, reject
        // before any dynamic handler or Core gate can be reached.
        const resolvedPreflight = preflight?.work_preflight
          || preflight?.result?.work_preflight
          || (preflight?.schema_version === "skinharmony_work_preflight_v1" ? preflight : null);
        const serverIssuedPreflight = tool.name === "core_capability_invoke" &&
          requiresGenericWorkPreflight(tool.name, args)
          ? serverIssuedWorkPreflight(preflight, callIdentity)
          : resolvedPreflight;
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

export { attachWorkPreflight, buildIdentity, inferClientType, resolveConnectorToolName, resolveWorkPreflight, securitySchemes, serverIssuedBootstrapSession, serverIssuedWorkPreflight, toolFailure, TOOLS };
