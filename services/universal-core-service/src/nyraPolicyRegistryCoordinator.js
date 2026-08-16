import crypto from "node:crypto";

import { validatePolicySnapshot } from "./nyraPolicyRegistry.js";
import {
  ATTESTATION_SCHEMA,
  canonical,
  proofBindingFromEnvelope,
} from "./nyraPolicyRegistryProofService.js";

const NYRA_POLICY_REGISTRY_ATTESTATION_PATH = "/api/nyra/policy-registry/attestations";
const NYRA_POLICY_REGISTRY_HEALTH_PATH = "/healthz";
const OWNER_SUBJECT = /^osf_[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const TARGET_COMMIT = /^[a-f0-9]{40}$/;
const COMPILER_PROVENANCE_SCHEMA = "nyra_policy_compiler_provenance_v1";
const COMPILER_PROVENANCE_STATUS_SCHEMA = "nyra_policy_compiler_provenance_status_v1";
const COMPILER_MODE = "core_deterministic_recompile";
const COMPILER_ALGORITHM = "nyra_policy_registry_v1";
const PROOF_SCHEMA = "nyra_policy_registry_proof_v3";
const RECEIPT_SCHEMA = "core_policy_activation_receipt_v3";
const VERIFICATION_ALGORITHM = "sha256_canonical_json+ed25519";
const NYRA_HEALTH_FIELDS = Object.freeze([
  "ok", "service", "version", "runtime_kind", "domain_pack_resolution",
  "auth_required", "auth_configured", "storage_persistent", "suite_bridge_configured",
  "deep_branch_v2_federation", "policy_registry_attestation", "work_automation",
]);
const WORK_AUTOMATION_HEALTH_FIELDS = Object.freeze([
  "schema_version", "role", "core_final_authority", "maximum_advisory_capabilities",
  "maximum_parallel_builders", "system_verifier_required", "smart_desk_automation_enabled",
  "automatic_customer_contact", "provider_execution",
]);
const POLICY_HEALTH_FIELDS = Object.freeze([
  "enabled", "required", "mode", "configuration_valid", "configured", "ready", "state",
  "render_gate_required", "service_key_configured", "signer_state", "replay_state",
  "replay_backend", "restart_durable", "distributed", "algorithm", "custody",
  "signer_service", "signer_target_commit", "signer_purpose", "core_key_id", "nyra_key_id",
  "core_public_key_fingerprint", "nyra_public_key_fingerprint", "error",
  "attestation_schema_version", "compiler_provenance_binding_required",
]);
const COMPILER_PROVENANCE_FIELDS = Object.freeze([
  "schema_version", "compiler_mode", "compiler_algorithm", "tenant_id",
  "domain_pack_id", "snapshot_digest", "leaf_pack_digests",
  "ordered_pack_evidence", "core_root_digest", "catalog_digest",
  "trust_catalog_digest", "compiler_build_commit", "validity", "resolution",
  "execution_authorized", "provenance_digest",
]);
const COMPILER_STATUS_FIELDS = Object.freeze([
  "schema_version", "ready", "clock_ready", "mode", "compiler_algorithm",
  "verification_algorithm", "traversal_budget", "compiler_build_commit",
  "catalog_digest", "trust_catalog_digest", "issuer_count", "independent_key_count",
  "trusted_core_pack_digest_count", "known_core_branch_count", "known_nyra_branch_count",
  "known_domain_pack_count", "execution_authorized", "error",
]);
const COMPILER_RECORD_VERIFICATION_FIELDS = Object.freeze([
  "ok", "record_integrity_verified", "derivation_reverified", "tenant_id",
  "domain_pack_id", "snapshot_digest", "compiler_provenance_digest",
  "compiler_build_commit", "catalog_digest", "trust_catalog_digest",
  "execution_authorized", "error",
]);
const PROOF_BINDING_FIELDS = Object.freeze([
  "tenant_id", "operation_id", "action", "operation", "work_id", "preflight_id",
  "intent_digest", "domain_pack_id", "snapshot_digest", "compiler_provenance_digest",
  "owner_approval_hash", "core_key_id", "nyra_key_id", "core_public_key_fingerprint",
  "nyra_public_key_fingerprint",
]);
const PROOF_OPERATIONS = Object.freeze({
  "policy.snapshot.activate": "activate_policy_snapshot",
  "policy.snapshot.rollback": "rollback_policy_snapshot",
});
const CLIENT_ERRORS = new Set([
  "policy_registry_nyra_busy",
  "policy_registry_nyra_challenge_invalid",
  "policy_registry_nyra_client_unavailable",
  "policy_registry_nyra_content_type_invalid",
  "policy_registry_nyra_health_binding_invalid",
  "policy_registry_nyra_redirect_denied",
  "policy_registry_nyra_rejected",
  "policy_registry_nyra_response_binding_invalid",
  "policy_registry_nyra_response_json_invalid",
  "policy_registry_nyra_response_too_large",
  "policy_registry_nyra_timeout",
  "policy_registry_nyra_unavailable",
]);

function exactFields(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return required.every((key) => value[key] !== undefined) &&
    keys.every((key) => allowed.has(key)) && keys.length >= required.length;
}

function exactRecord(value, fields) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).sort().join("\0") === [...fields].sort().join("\0");
}

function canonicalSignature(value) {
  const encoded = String(value || "");
  if (!BASE64URL_SIGNATURE.test(encoded)) return false;
  try {
    const decoded = Buffer.from(encoded, "base64url");
    return decoded.length === 64 && decoded.toString("base64url") === encoded;
  } catch {
    return false;
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const raw = value ?? fallback;
  if (typeof raw === "string" && !/^(?:0|[1-9]\d*)$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function strictBoolean(value) {
  return value === "true" ? true : value === "false" ? false : null;
}

function safeClientError(error, fallback = "policy_registry_nyra_unavailable") {
  const code = error?.name === "AbortError"
    ? "policy_registry_nyra_timeout"
    : String(error?.message || "");
  return CLIENT_ERRORS.has(code) ? code : fallback;
}

function clientConfiguration(env) {
  const rawOrigin = String(env.CORE_NYRA_POLICY_REGISTRY_NYRA_ORIGIN || "");
  const serviceKey = String(env.CORE_NYRA_POLICY_REGISTRY_NYRA_SERVICE_KEY || "");
  const timeoutMs = boundedInteger(env.CORE_NYRA_POLICY_REGISTRY_NYRA_TIMEOUT_MS, 2_500, 100, 10_000);
  const maximumResponseBytes = boundedInteger(
    env.CORE_NYRA_POLICY_REGISTRY_NYRA_MAX_RESPONSE_BYTES,
    65_536,
    1_024,
    262_144,
  );
  const probeCooldownMs = boundedInteger(
    env.CORE_NYRA_POLICY_REGISTRY_NYRA_PROBE_COOLDOWN_MS,
    5_000,
    100,
    60_000,
  );
  const required = strictBoolean(env.CORE_NYRA_POLICY_REGISTRY_PROOF_REQUIRED ?? "false");
  const expected = Object.freeze({
    service: String(env.CORE_NYRA_POLICY_REGISTRY_NYRA_SERVICE || "nyra-horizontal-runtime"),
    core_key_id: String(env.CORE_NYRA_POLICY_REGISTRY_CORE_KEY_ID || ""),
    nyra_key_id: String(env.CORE_NYRA_POLICY_REGISTRY_NYRA_KEY_ID || ""),
    core_public_key_fingerprint: String(
      env.CORE_NYRA_POLICY_REGISTRY_CORE_PUBLIC_KEY_FINGERPRINT || "",
    ),
    nyra_public_key_fingerprint: String(
      env.CORE_NYRA_POLICY_REGISTRY_NYRA_PUBLIC_KEY_FINGERPRINT || "",
    ),
    signer_service: String(env.CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_SERVICE || ""),
    signer_target_commit: String(env.CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_TARGET_COMMIT || ""),
    signer_purpose: String(env.CORE_NYRA_POLICY_REGISTRY_NYRA_SIGNER_PURPOSE || ""),
  });
  let origin = null;
  let error = null;
  try {
    const parsed = new URL(rawOrigin);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search ||
      parsed.hash || !["", "/"].includes(parsed.pathname) || parsed.origin !== rawOrigin) {
      throw new Error("policy_registry_nyra_origin_invalid");
    }
    origin = parsed.origin;
    if (serviceKey.length < 32 || serviceKey.length > 4_096 || serviceKey !== serviceKey.trim() ||
      /[\u0000-\u001f\u007f]/.test(serviceKey) || timeoutMs === null ||
      maximumResponseBytes === null || probeCooldownMs === null || required === null ||
      !/^[a-z][a-z0-9._-]{2,63}$/.test(expected.service) ||
      !ID.test(expected.core_key_id) || !ID.test(expected.nyra_key_id) ||
      expected.core_key_id === expected.nyra_key_id ||
      !SHA256.test(expected.core_public_key_fingerprint) ||
      !SHA256.test(expected.nyra_public_key_fingerprint) ||
      expected.core_public_key_fingerprint === expected.nyra_public_key_fingerprint ||
      !/^[a-z][a-z0-9._-]{2,63}$/.test(expected.signer_service) ||
      !TARGET_COMMIT.test(expected.signer_target_commit) ||
      !/^[a-z][a-z0-9._-]{2,127}$/.test(expected.signer_purpose)) {
      throw new Error("policy_registry_nyra_client_configuration_invalid");
    }
  } catch (configurationError) {
    const code = String(configurationError?.message || "");
    error = code === "policy_registry_nyra_origin_invalid"
      ? code
      : "policy_registry_nyra_client_configuration_invalid";
  }
  return { origin, serviceKey, timeoutMs, maximumResponseBytes, probeCooldownMs, required, expected, error };
}

async function readBoundedJson(response, maximumBytes) {
  const contentType = String(response.headers?.get?.("content-type") || "").trim();
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    throw new Error("policy_registry_nyra_content_type_invalid");
  }
  const declaredRaw = String(response.headers?.get?.("content-length") || "");
  if (declaredRaw && (!/^\d+$/.test(declaredRaw) || Number(declaredRaw) > maximumBytes)) {
    throw new Error(/^\d+$/.test(declaredRaw)
      ? "policy_registry_nyra_response_too_large"
      : "policy_registry_nyra_response_json_invalid");
  }
  let bytes;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        try { await reader.cancel(); } catch { /* the size error wins */ }
        throw new Error("policy_registry_nyra_response_too_large");
      }
      chunks.push(Buffer.from(value));
    }
    bytes = Buffer.concat(chunks, length);
  } else {
    const raw = await response.arrayBuffer();
    bytes = Buffer.from(raw);
    if (bytes.length > maximumBytes) throw new Error("policy_registry_nyra_response_too_large");
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("policy_registry_nyra_response_json_invalid");
  }
}

export function createNyraPolicyRegistryClient({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  const config = clientConfiguration(env);
  let lastSuccessAt = null;
  let lastFailureAt = null;
  let lastFailure = null;
  let healthVerified = false;
  let attestUnderlyingInFlight = null;
  let probeUnderlyingInFlight = null;
  let probeInFlight = null;
  let probeAttempts = 0;
  let probeCooldownUntil = Number.NEGATIVE_INFINITY;

  async function boundedOperation(operation, controller, timeoutCode) {
    let timer;
    let deadlineWon = false;
    const deadline = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        deadlineWon = true;
        controller.abort();
        reject(new Error(timeoutCode));
      }, config.timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([operation, deadline]);
    } catch (error) {
      if (deadlineWon) throw new Error(timeoutCode);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function attest(challenge) {
    if (config.error || typeof fetchImpl !== "function") {
      throw new Error("policy_registry_nyra_client_unavailable");
    }
    if (attestUnderlyingInFlight) throw new Error("policy_registry_nyra_busy");
    if (!exactFields(challenge,
      ["schema_version", "envelope", "core_signature"],
      ["idempotent_replay"]) ||
      challenge.schema_version !== ATTESTATION_SCHEMA ||
      !canonicalSignature(challenge.core_signature)) {
      throw new Error("policy_registry_nyra_challenge_invalid");
    }
    const controller = new AbortController();
    const endpoint = `${config.origin}${NYRA_POLICY_REGISTRY_ATTESTATION_PATH}`;
    const operation = (async () => {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-nyra-policy-registry-service-key": config.serviceKey,
        },
        body: JSON.stringify({
          envelope: challenge.envelope,
          core_signature: challenge.core_signature,
        }),
        signal: controller.signal,
        redirect: "error",
      });
      if (!response || typeof response.status !== "number" || response.redirected === true ||
        response.url !== endpoint || (response.status >= 300 && response.status < 400)) {
        throw new Error("policy_registry_nyra_redirect_denied");
      }
      const body = await readBoundedJson(response, config.maximumResponseBytes);
      if (!response.ok) throw new Error(response.status >= 500
        ? "policy_registry_nyra_unavailable"
        : "policy_registry_nyra_rejected");
      if (!exactFields(body, ["ok", "attestation"]) || body.ok !== true ||
        !exactFields(body.attestation,
          ["schema_version", "envelope", "core_signature", "nyra_signature"],
          ["idempotent_replay"]) ||
        body.attestation.schema_version !== ATTESTATION_SCHEMA ||
        canonical(body.attestation.envelope) !== canonical(challenge.envelope) ||
        body.attestation.core_signature !== challenge.core_signature ||
        !canonicalSignature(body.attestation.nyra_signature)) {
        throw new Error("policy_registry_nyra_response_binding_invalid");
      }
      return body.attestation;
    })();
    attestUnderlyingInFlight = operation;
    void operation.then(
      () => { if (attestUnderlyingInFlight === operation) attestUnderlyingInFlight = null; },
      () => { if (attestUnderlyingInFlight === operation) attestUnderlyingInFlight = null; },
    );
    try {
      const attestation = await boundedOperation(operation, controller, "policy_registry_nyra_timeout");
      lastSuccessAt = new Date(now()).toISOString();
      lastFailure = null;
      return attestation;
    } catch (error) {
      lastFailureAt = new Date(now()).toISOString();
      lastFailure = safeClientError(error);
      healthVerified = false;
      throw new Error(lastFailure);
    }
  }

  function validateHealth(body) {
    const policy = body?.policy_registry_attestation;
    const workAutomation = body?.work_automation;
    if (!exactRecord(body, NYRA_HEALTH_FIELDS) || body.ok !== true ||
      body.service !== config.expected.service ||
      typeof body.version !== "string" || body.version.length < 1 || body.version.length > 120 ||
      body.version !== body.version.trim() ||
      body.runtime_kind !== "horizontal_neural_branch_runtime" ||
      body.domain_pack_resolution !== "universal_core_key_metadata_only" ||
      typeof body.auth_required !== "boolean" || typeof body.auth_configured !== "boolean" ||
      typeof body.storage_persistent !== "boolean" ||
      typeof body.suite_bridge_configured !== "boolean" ||
      !body.deep_branch_v2_federation ||
      typeof body.deep_branch_v2_federation !== "object" ||
      Array.isArray(body.deep_branch_v2_federation) ||
      !exactRecord(workAutomation, WORK_AUTOMATION_HEALTH_FIELDS) ||
      workAutomation.schema_version !== "nyra_work_automation_v3" ||
      workAutomation.role !== "host_native_advisory_selection" ||
      workAutomation.core_final_authority !== true ||
      workAutomation.maximum_advisory_capabilities !== 6 ||
      workAutomation.maximum_parallel_builders !== 1 ||
      workAutomation.system_verifier_required !== true ||
      workAutomation.smart_desk_automation_enabled !== false ||
      workAutomation.automatic_customer_contact !== false ||
      workAutomation.provider_execution !== false ||
      !exactRecord(policy, POLICY_HEALTH_FIELDS) || policy.enabled !== true ||
      policy.required !== config.required || policy.mode !== "remote" ||
      policy.configuration_valid !== true || policy.configured !== true || policy.ready !== true ||
      policy.state !== "ready" || policy.render_gate_required !== config.required ||
      policy.service_key_configured !== true || policy.signer_state !== "ready" ||
      policy.replay_state !== "ready" || policy.replay_backend !== "postgresql" ||
      policy.restart_durable !== true || policy.distributed !== true ||
      policy.algorithm !== "Ed25519" || policy.custody !== "external_remote_signer" ||
      policy.signer_service !== config.expected.signer_service ||
      policy.signer_target_commit !== config.expected.signer_target_commit ||
      policy.signer_purpose !== config.expected.signer_purpose ||
      policy.core_key_id !== config.expected.core_key_id ||
      policy.nyra_key_id !== config.expected.nyra_key_id ||
      policy.core_public_key_fingerprint !== config.expected.core_public_key_fingerprint ||
      policy.nyra_public_key_fingerprint !== config.expected.nyra_public_key_fingerprint ||
      policy.attestation_schema_version !== ATTESTATION_SCHEMA ||
      policy.compiler_provenance_binding_required !== true ||
      policy.error !== null) {
      throw new Error("policy_registry_nyra_health_binding_invalid");
    }
  }

  async function probe({ force = false } = {}) {
    if (config.error || typeof fetchImpl !== "function") return false;
    if (probeInFlight) return probeInFlight;
    const timestamp = Number(now());
    if (!Number.isFinite(timestamp) || probeUnderlyingInFlight) return false;
    if (!force && timestamp < probeCooldownUntil) return healthVerified;
    probeAttempts += 1;
    const controller = new AbortController();
    const endpoint = `${config.origin}${NYRA_POLICY_REGISTRY_HEALTH_PATH}`;
    const operation = (async () => {
      const response = await fetchImpl(endpoint, {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { accept: "application/json" },
        signal: controller.signal,
        redirect: "error",
      });
      if (!response || typeof response.status !== "number" || response.redirected === true ||
        response.url !== endpoint || (response.status >= 300 && response.status < 400)) {
        throw new Error("policy_registry_nyra_redirect_denied");
      }
      const body = await readBoundedJson(response, config.maximumResponseBytes);
      if (!response.ok) throw new Error("policy_registry_nyra_unavailable");
      validateHealth(body);
      return true;
    })();
    probeUnderlyingInFlight = operation;
    void operation.then(
      () => {
        if (probeUnderlyingInFlight === operation) {
          probeUnderlyingInFlight = null;
          probeCooldownUntil = Number(now()) + config.probeCooldownMs;
        }
      },
      () => {
        if (probeUnderlyingInFlight === operation) {
          probeUnderlyingInFlight = null;
          probeCooldownUntil = Number(now()) + config.probeCooldownMs;
        }
      },
    );
    const current = boundedOperation(operation, controller, "policy_registry_nyra_timeout")
      .then(() => {
        healthVerified = true;
        lastSuccessAt = new Date(now()).toISOString();
        lastFailure = null;
        return true;
      }, (error) => {
        healthVerified = false;
        lastFailureAt = new Date(now()).toISOString();
        lastFailure = safeClientError(error);
        return false;
      });
    probeInFlight = current;
    void current.finally(() => { if (probeInFlight === current) probeInFlight = null; });
    return current;
  }

  return {
    attest,
    probe,
    status() {
      return {
        configured: !config.error,
        ready: !config.error && healthVerified && lastFailure === null,
        state: config.error
          ? "configuration_invalid"
          : lastFailure
            ? "unavailable"
            : healthVerified ? "ready" : "configured_unverified",
        origin: config.origin,
        path: NYRA_POLICY_REGISTRY_ATTESTATION_PATH,
        redirect_policy: "error",
        upstream_verified: healthVerified,
        probe_attempts: probeAttempts,
        operation_in_flight: Boolean(attestUnderlyingInFlight || probeUnderlyingInFlight),
        last_success_at: lastSuccessAt,
        last_failure_at: lastFailureAt,
        last_failure: lastFailure || config.error,
      };
    },
  };
}

export function derivePolicyRegistryOwnerApprovalHash({
  tenantId,
  workId,
  operationId,
  action,
  ownerSubjectFingerprint,
  bindingHash,
  confirmationReference,
  requestBinding,
}) {
  const binding = String(requestBinding || "");
  const expectedBindingHash = crypto.createHash("sha256").update(binding).digest("hex");
  if (!ID.test(String(tenantId || "")) || !ID.test(String(workId || "")) ||
    !ID.test(String(operationId || "")) || !["policy.snapshot.activate", "policy.snapshot.rollback"].includes(action) ||
    !OWNER_SUBJECT.test(String(ownerSubjectFingerprint || "")) ||
    !SHA256.test(String(bindingHash || "")) || bindingHash !== expectedBindingHash ||
    typeof confirmationReference !== "string" || confirmationReference.length < 1 ||
    confirmationReference.length > 512 || confirmationReference !== confirmationReference.trim()) {
    throw new Error("policy_registry_owner_binding_invalid");
  }
  return crypto.createHash("sha256")
    .update(`nyra-policy-registry-owner-approval-v3\0${canonical({
      tenant_id: tenantId,
      work_id: workId,
      operation_id: operationId,
      action,
      owner_subject_fingerprint: ownerSubjectFingerprint,
      binding_hash: bindingHash,
      confirmation_reference: confirmationReference,
      request_binding: binding,
    })}`)
    .digest("hex");
}

function intentDigest(input) {
  return crypto.createHash("sha256")
    .update(`nyra-policy-registry-intent-v2\0${canonical(input)}`)
    .digest("hex");
}

function compilerStatusReady(status) {
  const boundedIntegerValue = (value, minimum, maximum) =>
    Number.isInteger(value) && value >= minimum && value <= maximum;
  return exactRecord(status, COMPILER_STATUS_FIELDS) && status.ready === true &&
    status.clock_ready === true &&
    status.schema_version === COMPILER_PROVENANCE_STATUS_SCHEMA &&
    status.mode === COMPILER_MODE &&
    status.compiler_algorithm === COMPILER_ALGORITHM &&
    status.verification_algorithm === VERIFICATION_ALGORITHM &&
    Number.isInteger(status.traversal_budget) && status.traversal_budget >= 1 &&
    status.traversal_budget <= 256 && TARGET_COMMIT.test(status.compiler_build_commit) &&
    SHA256.test(status.catalog_digest) && SHA256.test(status.trust_catalog_digest) &&
    boundedIntegerValue(status.issuer_count, 2, 32) &&
    boundedIntegerValue(status.independent_key_count, 2, 32) &&
    status.independent_key_count === status.issuer_count &&
    boundedIntegerValue(status.trusted_core_pack_digest_count, 1, 64) &&
    boundedIntegerValue(status.known_core_branch_count, 1, 256) &&
    boundedIntegerValue(status.known_nyra_branch_count, 1, 256) &&
    boundedIntegerValue(status.known_domain_pack_count, 1, 256) &&
    status.execution_authorized === false &&
    status.error === null;
}

function validateProofBinding(binding) {
  if (!exactRecord(binding, PROOF_BINDING_FIELDS) ||
    !ID.test(String(binding.tenant_id || "")) ||
    !ID.test(String(binding.operation_id || "")) ||
    !ID.test(String(binding.work_id || "")) ||
    !ID.test(String(binding.preflight_id || "")) ||
    !ID.test(String(binding.domain_pack_id || "")) ||
    !ID.test(String(binding.core_key_id || "")) ||
    !ID.test(String(binding.nyra_key_id || "")) ||
    binding.core_key_id === binding.nyra_key_id ||
    PROOF_OPERATIONS[binding.action] !== binding.operation ||
    !SHA256.test(String(binding.intent_digest || "")) ||
    !SHA256.test(String(binding.snapshot_digest || "")) ||
    !SHA256.test(String(binding.compiler_provenance_digest || "")) ||
    !SHA256.test(String(binding.owner_approval_hash || "")) ||
    !SHA256.test(String(binding.core_public_key_fingerprint || "")) ||
    !SHA256.test(String(binding.nyra_public_key_fingerprint || "")) ||
    binding.core_public_key_fingerprint === binding.nyra_public_key_fingerprint) {
    throw new Error("policy_proof_legacy_schema_unsupported");
  }
  return binding;
}

function validateCompilerRecordVerification(result, record) {
  if (!exactRecord(result, COMPILER_RECORD_VERIFICATION_FIELDS) ||
    result.ok !== true || result.record_integrity_verified !== true ||
    result.derivation_reverified !== false || result.execution_authorized !== false ||
    result.error !== null || result.tenant_id !== record.tenant_id ||
    result.domain_pack_id !== record.domain_pack_id ||
    result.snapshot_digest !== record.snapshot_digest ||
    result.compiler_provenance_digest !== record.provenance_digest ||
    result.compiler_build_commit !== record.compiler_build_commit ||
    result.catalog_digest !== record.catalog_digest ||
    result.trust_catalog_digest !== record.trust_catalog_digest) {
    throw new Error("policy_compiler_provenance_invalid");
  }
  return result;
}

function validateCompilerProvenance(record, {
  tenant_id,
  domain_pack_id,
  snapshot_digest,
} = {}) {
  const provenanceBody = record && typeof record === "object" && !Array.isArray(record)
    ? { ...record }
    : null;
  if (provenanceBody) delete provenanceBody.provenance_digest;
  const expectedDigest = provenanceBody
    ? crypto.createHash("sha256").update(canonical(provenanceBody)).digest("hex")
    : null;
  if (!exactRecord(record, COMPILER_PROVENANCE_FIELDS) ||
    record.schema_version !== COMPILER_PROVENANCE_SCHEMA ||
    record.compiler_mode !== COMPILER_MODE ||
    record.compiler_algorithm !== COMPILER_ALGORITHM ||
    record.tenant_id !== tenant_id || record.domain_pack_id !== domain_pack_id ||
    record.snapshot_digest !== snapshot_digest ||
    !SHA256.test(String(record.provenance_digest || "")) ||
    record.provenance_digest !== expectedDigest ||
    record.execution_authorized !== false) {
    throw new Error("policy_compiler_provenance_invalid");
  }
  return record;
}

export function createNyraPolicyRegistryCoordinator({
  proofService,
  registryStore,
  nyraClient,
  compilerProvenanceVerifier,
} = {}) {
  if (!proofService?.prepare || !proofService?.issue || !proofService?.reconcile ||
    !registryStore?.activate || !registryStore?.rollback || !registryStore?.reconcile ||
    !registryStore?.resolveRollbackTarget || !nyraClient?.attest || !nyraClient?.probe ||
    !compilerProvenanceVerifier?.verify || !compilerProvenanceVerifier?.verifyPersistedRecord ||
    !compilerProvenanceVerifier?.status) {
    throw new Error("policy_registry_coordinator_dependencies_invalid");
  }

  async function proofForMutation({
    tenant_id,
    operation_id,
    action,
    work_id,
    preflight_id,
    domain_pack_id,
    snapshot_digest,
    compiler_provenance_digest,
    authorization_digest,
    owner_subject_fingerprint,
    owner_binding_hash,
    confirmation_reference,
    owner_request_binding,
  }) {
    if (!SHA256.test(String(authorization_digest || ""))) {
      throw new Error("policy_registry_authorization_digest_invalid");
    }
    if (!SHA256.test(String(compiler_provenance_digest || ""))) {
      throw new Error("policy_compiler_provenance_invalid");
    }
    const ownerApprovalHash = derivePolicyRegistryOwnerApprovalHash({
      tenantId: tenant_id,
      workId: work_id,
      operationId: operation_id,
      action,
      ownerSubjectFingerprint: owner_subject_fingerprint,
      bindingHash: owner_binding_hash,
      confirmationReference: confirmation_reference,
      requestBinding: owner_request_binding,
    });
    const derivedIntentDigest = intentDigest({
      tenant_id,
      operation_id,
      action,
      work_id,
      preflight_id,
      domain_pack_id,
      snapshot_digest,
      compiler_provenance_digest,
      owner_approval_hash: ownerApprovalHash,
      authorization_digest,
      owner_request_binding_digest: crypto.createHash("sha256")
        .update(String(owner_request_binding))
        .digest("hex"),
    });
    const challenge = await proofService.prepare({
      tenant_id,
      operation_id,
      action,
      work_id,
      preflight_id,
      intent_digest: derivedIntentDigest,
      domain_pack_id,
      snapshot_digest,
      compiler_provenance_digest,
      owner_approval_hash: ownerApprovalHash,
    });
    if (challenge?.schema_version !== ATTESTATION_SCHEMA ||
      challenge?.envelope?.schema_version !== ATTESTATION_SCHEMA) {
      throw new Error("policy_proof_legacy_schema_unsupported");
    }
    const proofBinding = validateProofBinding(proofBindingFromEnvelope(challenge.envelope));
    const expectedBinding = {
      tenant_id,
      operation_id,
      action,
      operation: PROOF_OPERATIONS[action],
      work_id,
      preflight_id,
      intent_digest: derivedIntentDigest,
      domain_pack_id,
      snapshot_digest,
      compiler_provenance_digest,
      owner_approval_hash: ownerApprovalHash,
    };
    if (Object.entries(expectedBinding).some(([field, value]) => proofBinding[field] !== value)) {
      throw new Error("policy_proof_binding_invalid");
    }
    const activationAttestation = await nyraClient.attest(challenge);
    const receipt = await proofService.issue({
      tenant_id,
      operation_id,
      attestation: activationAttestation,
    });
    const { idempotent_replay: _receiptReplay, ...stableReceipt } = receipt;
    return {
      activationAttestation,
      receipt: stableReceipt,
      proofBinding,
    };
  }

  async function activate(input) {
    const validation = validatePolicySnapshot(input.snapshot, {
      tenant_id: input.tenant_id,
      core_branch_id: input.core_branch_id,
      nyra_branch_id: input.nyra_branch_id,
      domain_pack_id: input.domain_pack_id,
      now: input.now || new Date(),
    });
    if (!validation.ok) throw new Error("policy_registry_snapshot_invalid");
    const compilerStatus = await compilerProvenanceVerifier.status();
    if (!compilerStatusReady(compilerStatus)) {
      throw new Error("policy_compiler_unavailable");
    }
    const compilerProvenance = validateCompilerProvenance(
      await compilerProvenanceVerifier.verify({
        tenant_id: input.tenant_id,
        domain_pack_id: input.domain_pack_id,
        snapshot: input.snapshot,
        compiler_input: input.compiler_input,
      }),
      {
        tenant_id: input.tenant_id,
        domain_pack_id: input.domain_pack_id,
        snapshot_digest: input.snapshot.snapshot_digest,
      },
    );
    validateCompilerRecordVerification(
      await compilerProvenanceVerifier.verifyPersistedRecord(compilerProvenance, {
        tenant_id: input.tenant_id,
        domain_pack_id: input.domain_pack_id,
        snapshot_digest: input.snapshot.snapshot_digest,
        compiler_provenance_digest: compilerProvenance.provenance_digest,
      }),
      compilerProvenance,
    );
    const proof = await proofForMutation({
      ...input,
      action: "policy.snapshot.activate",
      snapshot_digest: input.snapshot.snapshot_digest,
      compiler_provenance_digest: compilerProvenance.provenance_digest,
    });
    const result = await registryStore.activate({
      tenant_id: input.tenant_id,
      operation_id: input.operation_id,
      snapshot: input.snapshot,
      compiler_provenance: compilerProvenance,
      core_receipt: proof.receipt,
      activation_attestation: proof.activationAttestation,
      proof_binding: proof.proofBinding,
      core_branch_id: input.core_branch_id,
      nyra_branch_id: input.nyra_branch_id,
      domain_pack_id: input.domain_pack_id,
      now: input.now,
    });
    return {
      ...result,
      operation_id: proof.proofBinding.operation_id,
      work_id: proof.proofBinding.work_id,
      preflight_id: proof.proofBinding.preflight_id,
      intent_digest: proof.proofBinding.intent_digest,
      compiler_provenance_digest: proof.proofBinding.compiler_provenance_digest,
      proof_status: "consumed",
    };
  }

  async function rollback(input) {
    if (Object.hasOwn(input, "compiler_input") || Object.hasOwn(input, "compiler_provenance") ||
      Object.hasOwn(input, "compiler_provenance_digest")) {
      throw new Error("policy_registry_rollback_caller_provenance_denied");
    }
    const target = await registryStore.resolveRollbackTarget({
      tenant_id: input.tenant_id,
      target_snapshot_digest: input.target_snapshot_digest,
      domain_pack_id: input.domain_pack_id,
      core_branch_id: input.core_branch_id,
      nyra_branch_id: input.nyra_branch_id,
      now: input.now,
    });
    if (!exactRecord(target, ["snapshot", "attestation", "compiler_provenance"]) ||
      target.snapshot?.snapshot_digest !== input.target_snapshot_digest) {
      throw new Error("policy_registry_rollback_target_invalid");
    }
    const validation = validatePolicySnapshot(target.snapshot, {
      tenant_id: input.tenant_id,
      core_branch_id: input.core_branch_id,
      nyra_branch_id: input.nyra_branch_id,
      domain_pack_id: input.domain_pack_id,
      now: input.now || new Date(),
    });
    if (!validation.ok) throw new Error("policy_registry_rollback_target_invalid");
    const compilerProvenance = validateCompilerProvenance(target.compiler_provenance, {
      tenant_id: input.tenant_id,
      domain_pack_id: input.domain_pack_id,
      snapshot_digest: input.target_snapshot_digest,
    });
    const proof = await proofForMutation({
      ...input,
      action: "policy.snapshot.rollback",
      snapshot_digest: input.target_snapshot_digest,
      compiler_provenance_digest: compilerProvenance.provenance_digest,
    });
    const result = await registryStore.rollback({
      tenant_id: input.tenant_id,
      operation_id: input.operation_id,
      target_snapshot_digest: input.target_snapshot_digest,
      core_receipt: proof.receipt,
      activation_attestation: proof.activationAttestation,
      proof_binding: proof.proofBinding,
      core_branch_id: input.core_branch_id,
      nyra_branch_id: input.nyra_branch_id,
      domain_pack_id: input.domain_pack_id,
      now: input.now,
    });
    return {
      ...result,
      operation_id: proof.proofBinding.operation_id,
      work_id: proof.proofBinding.work_id,
      preflight_id: proof.proofBinding.preflight_id,
      intent_digest: proof.proofBinding.intent_digest,
      compiler_provenance_digest: proof.proofBinding.compiler_provenance_digest,
      proof_status: "consumed",
    };
  }

  async function reconcile({ tenant_id, operation_id, expected_work_id }) {
    const state = await proofService.reconcile({ tenant_id, operation_id });
    const proofBinding = validateProofBinding(state?.binding);
    if (proofBinding.tenant_id !== tenant_id || proofBinding.operation_id !== operation_id ||
      (Object.hasOwn(state, "tenant_id") && state.tenant_id !== tenant_id) ||
      (Object.hasOwn(state, "operation_id") && state.operation_id !== operation_id)) {
      throw new Error("policy_proof_reconciliation_scope_invalid");
    }
    if (!expected_work_id || proofBinding.work_id !== expected_work_id) {
      throw new Error("policy_proof_work_binding_invalid");
    }
    if (!state.receipt || !["issued", "consumed"].includes(state.status)) {
      throw new Error("policy_proof_reconciliation_not_ready");
    }
    const consumptionProof = state.status === "consumed"
      ? await proofService.reconcileConsumption({ tenant_id, operation_id })
      : null;
    const result = await registryStore.reconcile({
      tenant_id,
      operation_id,
      operation: proofBinding.operation,
      snapshot_digest: proofBinding.snapshot_digest,
      core_receipt: state.receipt,
      consumption_proof: consumptionProof,
      proof_binding: proofBinding,
    });
    return {
      ...result,
      operation_id: proofBinding.operation_id,
      work_id: proofBinding.work_id,
      preflight_id: proofBinding.preflight_id,
      intent_digest: proofBinding.intent_digest,
      compiler_provenance_digest: proofBinding.compiler_provenance_digest,
      proof_status: "consumed",
    };
  }

  return {
    activate,
    rollback,
    reconcile,
    status: async () => {
      const [proof, store, compilerStatus, upstreamProbe] = await Promise.all([
        proofService.status(),
        registryStore.status(),
        compilerProvenanceVerifier.status(),
        nyraClient.probe(),
      ]);
      const upstream = nyraClient.status();
      const proofReady = proof.ready === true && proof.proof_schema_version === PROOF_SCHEMA &&
        proof.attestation_schema_version === ATTESTATION_SCHEMA &&
        proof.receipt_schema_version === RECEIPT_SCHEMA &&
        proof.compiler_provenance_binding_required === true;
      const compilerReady = compilerStatusReady(compilerStatus);
      const storeReady = store.ready === true && store.backend === "postgresql" &&
        store.restart_durable === true && store.distributed === true &&
        store.compiler_provenance_persistence === true &&
        store.compiler_input_persisted === false;
      return {
        ready: proofReady && storeReady && compilerReady &&
          upstreamProbe === true && upstream.ready === true,
        proof,
        store: {
          ready: store.ready === true,
          backend: store.backend,
          restart_durable: store.restart_durable === true,
          distributed: store.distributed === true,
          compiler_provenance_persistence: store.compiler_provenance_persistence === true,
          compiler_input_persisted: store.compiler_input_persisted === true,
        },
        compiler_provenance: {
          ready: compilerReady,
          schema_version: COMPILER_PROVENANCE_SCHEMA,
          status_schema_version: compilerStatus?.schema_version || null,
          mode: compilerStatus?.mode || null,
          compiler_algorithm: compilerStatus?.compiler_algorithm || null,
          compiler_input_persisted: store.compiler_input_persisted === true,
          execution_authorized: false,
        },
        upstream,
        e2e_verified: proofReady && storeReady && compilerReady && upstreamProbe === true &&
          upstream.ready === true && upstream.upstream_verified === true,
      };
    },
  };
}

export { NYRA_POLICY_REGISTRY_ATTESTATION_PATH };
