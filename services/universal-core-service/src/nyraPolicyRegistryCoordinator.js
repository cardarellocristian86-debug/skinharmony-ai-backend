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
const POLICY_HEALTH_FIELDS = Object.freeze([
  "enabled", "required", "mode", "configuration_valid", "configured", "ready", "state",
  "render_gate_required", "service_key_configured", "signer_state", "replay_state",
  "replay_backend", "restart_durable", "distributed", "algorithm", "custody",
  "signer_service", "signer_target_commit", "signer_purpose", "core_key_id", "nyra_key_id",
  "core_public_key_fingerprint", "nyra_public_key_fingerprint", "error",
]);
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
    if (body?.ok !== true || body?.service !== config.expected.service ||
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
    .update(`nyra-policy-registry-owner-approval-v2\0${canonical({
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
    .update(`nyra-policy-registry-intent-v1\0${canonical(input)}`)
    .digest("hex");
}

export function createNyraPolicyRegistryCoordinator({
  proofService,
  registryStore,
  nyraClient,
} = {}) {
  if (!proofService?.prepare || !proofService?.issue || !proofService?.reconcile ||
    !registryStore?.activate || !registryStore?.rollback || !registryStore?.reconcile ||
    !nyraClient?.attest || !nyraClient?.probe) {
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
    authorization_digest,
    owner_subject_fingerprint,
    owner_binding_hash,
    confirmation_reference,
    owner_request_binding,
  }) {
    if (!SHA256.test(String(authorization_digest || ""))) {
      throw new Error("policy_registry_authorization_digest_invalid");
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
      owner_approval_hash: ownerApprovalHash,
    });
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
      proofBinding: proofBindingFromEnvelope(challenge.envelope),
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
    const proof = await proofForMutation({
      ...input,
      action: "policy.snapshot.activate",
      snapshot_digest: input.snapshot.snapshot_digest,
    });
    const result = await registryStore.activate({
      tenant_id: input.tenant_id,
      operation_id: input.operation_id,
      snapshot: input.snapshot,
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
      proof_status: "consumed",
    };
  }

  async function rollback(input) {
    const proof = await proofForMutation({
      ...input,
      action: "policy.snapshot.rollback",
      snapshot_digest: input.target_snapshot_digest,
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
      proof_status: "consumed",
    };
  }

  async function reconcile({ tenant_id, operation_id, expected_work_id }) {
    const state = await proofService.reconcile({ tenant_id, operation_id });
    if (!expected_work_id || state.binding.work_id !== expected_work_id) {
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
      operation: state.binding.operation,
      snapshot_digest: state.binding.snapshot_digest,
      core_receipt: state.receipt,
      consumption_proof: consumptionProof,
      proof_binding: state.binding,
    });
    return {
      ...result,
      operation_id: state.binding.operation_id,
      work_id: state.binding.work_id,
      preflight_id: state.binding.preflight_id,
      intent_digest: state.binding.intent_digest,
      proof_status: "consumed",
    };
  }

  return {
    activate,
    rollback,
    reconcile,
    status: async () => {
      const [proof, store, upstreamProbe] = await Promise.all([
        proofService.status(),
        registryStore.status(),
        nyraClient.probe(),
      ]);
      const upstream = nyraClient.status();
      return {
        ready: proof.ready === true && store.ready === true && upstreamProbe === true && upstream.ready === true,
        proof,
        store: {
          ready: store.ready === true,
          backend: store.backend,
          restart_durable: store.restart_durable === true,
          distributed: store.distributed === true,
        },
        upstream,
        e2e_verified: upstreamProbe === true && upstream.upstream_verified === true,
      };
    },
  };
}

export { NYRA_POLICY_REGISTRY_ATTESTATION_PATH };
