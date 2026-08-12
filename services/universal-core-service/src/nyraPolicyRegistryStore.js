import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { evaluatePolicySnapshot, validatePolicySnapshot } from "./nyraPolicyRegistry.js";

const SCHEMA_VERSION = "nyra_policy_registry_store_v1";
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_COMMIT = /^[a-f0-9]{40}$/;
const PROOF_BINDING_FIELDS = Object.freeze([
  "tenant_id", "operation_id", "action", "operation", "work_id", "preflight_id",
  "intent_digest", "domain_pack_id", "snapshot_digest", "owner_approval_hash",
  "core_key_id", "nyra_key_id", "core_public_key_fingerprint",
  "nyra_public_key_fingerprint", "compiler_provenance_digest",
]);
const PERSISTED_ENTRY_FIELDS = Object.freeze([
  "snapshot", "attestation", "compiler_provenance",
]);
const PROPOSED_STATE_FIELDS = Object.freeze([
  "active_snapshot", "active_attestation", "active_compiler_provenance",
  "history", "public_result",
]);
const COMPILER_PROVENANCE_VERIFICATION_FIELDS = Object.freeze([
  "ok", "record_integrity_verified", "derivation_reverified", "tenant_id",
  "domain_pack_id", "snapshot_digest", "compiler_provenance_digest",
  "compiler_build_commit", "catalog_digest", "trust_catalog_digest",
  "execution_authorized", "error",
]);
const ACTIVATION_PUBLIC_RESULT_FIELDS = Object.freeze([
  "tenant_id", "snapshot_digest", "activated",
]);
const ROLLBACK_PUBLIC_RESULT_FIELDS = Object.freeze([
  "tenant_id", "snapshot_digest", "rolled_back", "activation_generation",
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash("sha256").update(stable(value)).digest("hex");
}

function emptyState() {
  return { schema_version: SCHEMA_VERSION, revision: 0, tenants: {}, operations: {} };
}

function load(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return emptyState();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed?.schema_version === SCHEMA_VERSION ? parsed : emptyState();
  } catch {
    return emptyState();
  }
}

function persist(filePath, state) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function required(value, code) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function normalizeProofBinding(value, { tenantId, operationId, operation, snapshotDigest }) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== [...PROOF_BINDING_FIELDS].sort().join("\0")) {
    throw new Error("policy_proof_binding_invalid");
  }
  const action = operation === "activate_policy_snapshot"
    ? "policy.snapshot.activate"
    : operation === "rollback_policy_snapshot"
      ? "policy.snapshot.rollback"
      : null;
  const valid = value.tenant_id === tenantId && value.operation_id === operationId &&
    value.action === action && value.operation === operation && value.snapshot_digest === snapshotDigest &&
    ["work_id", "preflight_id", "domain_pack_id", "core_key_id", "nyra_key_id"]
      .every((field) => typeof value[field] === "string" && value[field].length >= 3) &&
    ["intent_digest", "owner_approval_hash", "core_public_key_fingerprint", "nyra_public_key_fingerprint",
      "compiler_provenance_digest"]
      .every((field) => SHA256.test(String(value[field] || ""))) &&
    value.core_key_id !== value.nyra_key_id &&
    value.core_public_key_fingerprint !== value.nyra_public_key_fingerprint;
  if (!valid) throw new Error("policy_proof_binding_invalid");
  return clone(value);
}

function exactKeys(value, fields) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string") ||
      keys.sort().join("\0") !== [...fields].sort().join("\0")) return false;
    return fields.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      return descriptor && Object.hasOwn(descriptor, "value") &&
        !Object.hasOwn(descriptor, "get") && !Object.hasOwn(descriptor, "set");
    });
  } catch {
    return false;
  }
}

function provenanceBinding(snapshot, proofBinding, domainPackId) {
  return {
    tenant_id: proofBinding.tenant_id,
    domain_pack_id: domainPackId,
    snapshot_digest: snapshot?.snapshot_digest,
    compiler_provenance_digest: proofBinding.compiler_provenance_digest,
  };
}

function missingProvenanceError(entry, missingCode) {
  if (missingCode === "policy_rollback_compiler_provenance_missing") return missingCode;
  return SHA256.test(String(entry?.attestation?.binding?.compiler_provenance_digest || ""))
    ? "policy_registry_state_corrupt"
    : missingCode;
}

function verifyCompilerProvenance({
  snapshot,
  compilerProvenance,
  proofBinding,
  domainPackId,
  verifyCompilerProvenanceRecord,
  missingCode = "policy_registry_compiler_provenance_missing",
}) {
  if (!compilerProvenance) throw new Error(missingCode);
  if (typeof verifyCompilerProvenanceRecord !== "function") {
    throw new Error("policy_registry_compiler_provenance_invalid");
  }
  const binding = provenanceBinding(snapshot, proofBinding, domainPackId);
  let verified = null;
  try {
    verified = verifyCompilerProvenanceRecord(clone(compilerProvenance), clone(binding));
  } catch {
    verified = null;
  }
  let valid = false;
  try {
    valid = exactKeys(verified, COMPILER_PROVENANCE_VERIFICATION_FIELDS) &&
      verified.ok === true &&
      verified.record_integrity_verified === true &&
      verified.derivation_reverified === false &&
      verified.tenant_id === binding.tenant_id &&
      verified.domain_pack_id === binding.domain_pack_id &&
      verified.snapshot_digest === binding.snapshot_digest &&
      verified.compiler_provenance_digest === binding.compiler_provenance_digest &&
      GIT_COMMIT.test(verified.compiler_build_commit) &&
      SHA256.test(verified.catalog_digest) &&
      SHA256.test(verified.trust_catalog_digest) &&
      verified.execution_authorized === false &&
      verified.error === null &&
      compilerProvenance?.tenant_id === binding.tenant_id &&
      compilerProvenance?.domain_pack_id === binding.domain_pack_id &&
      compilerProvenance?.snapshot_digest === binding.snapshot_digest &&
      compilerProvenance?.provenance_digest === binding.compiler_provenance_digest &&
      compilerProvenance?.execution_authorized === false &&
      !Object.hasOwn(compilerProvenance, "compiler_input");
  } catch {
    valid = false;
  }
  if (!valid) throw new Error("policy_registry_compiler_provenance_invalid");
  return clone(compilerProvenance);
}

function verifyConsumedReceipt(receipt, binding) {
  const valid = receipt?.ok === true &&
    receipt?.consumed === true &&
    receipt?.single_use === true &&
    receipt?.signature_verified === true &&
    receipt?.issuer_role === "universal_core" &&
    PROOF_BINDING_FIELDS.every((field) => receipt?.[field] === binding[field]) &&
    typeof receipt?.consumption_id === "string" && receipt.consumption_id.length >= 16;
  if (!valid) throw new Error("policy_activation_core_receipt_invalid");
}

function verifyProposedPublicResult(proposed, {
  tenantId,
  operation,
  expectedRevision,
}) {
  const result = proposed?.public_result;
  const snapshotDigest = proposed?.active_snapshot?.snapshot_digest;
  const activation = operation === "activate_policy_snapshot";
  const rollback = operation === "rollback_policy_snapshot";
  const exact = activation
    ? exactKeys(result, ACTIVATION_PUBLIC_RESULT_FIELDS)
    : rollback
      ? exactKeys(result, ROLLBACK_PUBLIC_RESULT_FIELDS)
      : false;
  const valid = exact && result.tenant_id === tenantId &&
    result.snapshot_digest === snapshotDigest &&
    (activation
      ? result.activated === true
      : result.rolled_back === true && Number.isInteger(expectedRevision) &&
        result.activation_generation === expectedRevision);
  if (!valid) throw new Error("policy_registry_state_corrupt");
}

export function createNyraPolicyRegistryStore({
  filePath = "",
  consumeCoreReceipt,
  verifyActivationSnapshot,
  verifyCompilerProvenanceRecord,
} = {}) {
  let state = load(filePath);
  let mutating = false;

  function mutate(tenantId, operationId, payload, callback) {
    if (mutating) throw new Error("policy_registry_concurrent_mutation");
    const id = required(operationId, "policy_operation_id_required");
    const operationKey = `${tenantId}:${id}`;
    const payloadDigest = digest(payload);
    const replay = state.operations[operationKey];
    if (replay) {
      if (replay.payload_digest !== payloadDigest) throw new Error("policy_operation_idempotency_conflict");
      return { ...clone(replay.result), idempotent_replay: true };
    }
    mutating = true;
    try {
      const next = clone(state);
      const result = callback(next);
      next.revision += 1;
      next.operations[operationKey] = { payload_digest: payloadDigest, result: clone(result) };
      persist(filePath, next);
      state = next;
      return { ...clone(result), idempotent_replay: false };
    } finally {
      mutating = false;
    }
  }

  function consume(receipt, binding) {
    const consumed = typeof consumeCoreReceipt === "function"
      ? consumeCoreReceipt(receipt, binding)
      : null;
    verifyConsumedReceipt(consumed, binding);
    return consumed;
  }

  function verifyAttestation(snapshot, compilerProvenance, attestation, binding, now) {
    let verified = null;
    try {
      verified = typeof verifyActivationSnapshot === "function"
        ? verifyActivationSnapshot(snapshot, clone(compilerProvenance), {
            ...clone(binding),
            binding: clone(binding),
            activation_attestation: clone(attestation?.policy_registry_attestation || attestation),
            persisted_attestation: clone(attestation),
            now,
          })
        : null;
    } catch {
      verified = null;
    }
    const verifiedRoles = new Set(verified?.verified_roles || []);
    if (verified?.ok !== true || verified?.signature_verified !== true ||
      verified?.tenant_id !== binding.tenant_id ||
      verified?.snapshot_digest !== snapshot?.snapshot_digest ||
      verified?.compiler_provenance_digest !== binding.compiler_provenance_digest ||
      verified?.compiler_provenance_bound !== true ||
      verified?.execution_authorized !== false ||
      !verifiedRoles.has("core") || !verifiedRoles.has("nyra") ||
      Number(verified?.independent_key_count || 0) < 2) {
      throw new Error("policy_snapshot_signature_quorum_invalid");
    }
    return {
      ...clone(verified),
      binding: clone(binding),
      policy_registry_attestation: clone(
        verified?.policy_registry_attestation || attestation?.policy_registry_attestation || attestation,
      ),
    };
  }

  function verifyEntry(entry, {
    tenantId,
    coreBranchId,
    nyraBranchId,
    domainPackId,
    now,
    missingCode = "policy_registry_compiler_provenance_missing",
    requireCurrent = true,
  }) {
    if (!exactKeys(entry, PERSISTED_ENTRY_FIELDS)) {
      if (entry && !Object.hasOwn(entry, "compiler_provenance")) {
        throw new Error(missingProvenanceError(entry, missingCode));
      }
      throw new Error("policy_registry_state_corrupt");
    }
    const resolvedCoreBranchId = coreBranchId || entry.snapshot?.bindings?.core_branch_ids?.[0];
    const resolvedNyraBranchId = nyraBranchId || entry.snapshot?.bindings?.nyra_branch_ids?.[0];
    const resolvedDomainPackId = domainPackId || entry.snapshot?.domain_pack_id;
    const verificationNow = now || new Date();
    const rawBinding = entry.attestation?.binding;
    const binding = normalizeProofBinding(rawBinding, {
      tenantId,
      operationId: rawBinding?.operation_id,
      operation: rawBinding?.operation,
      snapshotDigest: entry.snapshot?.snapshot_digest,
    });
    if (binding.domain_pack_id !== resolvedDomainPackId ||
      entry.snapshot?.domain_pack_id !== resolvedDomainPackId) {
      throw new Error("policy_registry_state_corrupt");
    }
    const structural = validatePolicySnapshot(entry.snapshot, {
      tenant_id: tenantId,
      core_branch_id: resolvedCoreBranchId,
      nyra_branch_id: resolvedNyraBranchId,
      domain_pack_id: resolvedDomainPackId,
      now: verificationNow,
    });
    const invalidReasons = structural.reasons.filter((reason) =>
      requireCurrent || reason !== "policy_snapshot_not_current");
    if (invalidReasons.length) throw new Error("policy_registry_state_corrupt");
    const compilerProvenance = verifyCompilerProvenance({
      snapshot: entry.snapshot,
      compilerProvenance: entry.compiler_provenance,
      proofBinding: binding,
      domainPackId: resolvedDomainPackId,
      verifyCompilerProvenanceRecord,
      missingCode: entry.compiler_provenance
        ? missingCode
        : missingProvenanceError(entry, missingCode),
    });
    verifyAttestation(
      entry.snapshot,
      compilerProvenance,
      entry.attestation,
      binding,
      verificationNow,
    );
    return clone(entry);
  }

  function rollbackTarget(sourceState, {
    tenantId,
    targetDigest,
    coreBranchId,
    nyraBranchId,
    domainPackId,
    now,
  }) {
    const tenant = sourceState.tenants[tenantId];
    const index = tenant?.history?.findIndex((entry) => entry?.snapshot?.snapshot_digest === targetDigest) ?? -1;
    if (index < 0) throw new Error("policy_rollback_snapshot_not_found");
    const target = tenant.history[index];
    if (!target?.compiler_provenance) {
      throw new Error("policy_rollback_compiler_provenance_missing");
    }
    return {
      index,
      entry: verifyEntry(target, {
        tenantId,
        coreBranchId,
        nyraBranchId,
        domainPackId,
        now,
        missingCode: "policy_rollback_compiler_provenance_missing",
      }),
    };
  }

  return {
    kind: filePath ? "file" : "memory",
    restart_durable: Boolean(filePath),
    activate({
      tenant_id,
      operation_id,
      snapshot,
      compiler_provenance,
      activation_attestation,
      proof_binding,
      core_receipt,
      core_branch_id,
      nyra_branch_id,
      domain_pack_id,
      now = new Date(),
    }) {
      const tenantId = required(tenant_id, "tenant_id_required");
      const operationId = required(operation_id, "policy_operation_id_required");
      const validation = validatePolicySnapshot(snapshot, {
        tenant_id: tenantId,
        core_branch_id,
        nyra_branch_id,
        domain_pack_id,
        now,
      });
      if (!validation.ok) throw new Error(`policy_snapshot_invalid:${validation.reasons.join(",")}`);
      const binding = normalizeProofBinding(proof_binding, {
        tenantId, operationId, operation: "activate_policy_snapshot", snapshotDigest: snapshot.snapshot_digest,
      });
      if (binding.domain_pack_id !== domain_pack_id) throw new Error("policy_proof_binding_invalid");
      const compilerProvenance = verifyCompilerProvenance({
        snapshot,
        compilerProvenance: compiler_provenance,
        proofBinding: binding,
        domainPackId: domain_pack_id,
        verifyCompilerProvenanceRecord,
      });
      const attestation = verifyAttestation(
        snapshot,
        compilerProvenance,
        activation_attestation,
        binding,
        now,
      );
      const payload = {
        tenant_id: tenantId,
        snapshot_digest: snapshot.snapshot_digest,
        operation: "activate_policy_snapshot",
        proof_binding: binding,
        receipt_digest: digest(core_receipt || null),
      };
      return mutate(tenantId, operationId, payload, (next) => {
        const current = next.tenants[tenantId]?.active || null;
        const history = next.tenants[tenantId]?.history || [];
        if (current) {
          verifyEntry(current, {
            tenantId,
            coreBranchId: core_branch_id,
            nyraBranchId: nyra_branch_id,
            domainPackId: domain_pack_id,
            now,
            requireCurrent: false,
          });
          history.push(current);
        }
        consume(core_receipt, binding);
        next.tenants[tenantId] = {
          active: { snapshot: clone(snapshot), attestation, compiler_provenance: compilerProvenance },
          history,
        };
        return { tenant_id: tenantId, snapshot_digest: snapshot.snapshot_digest, activated: true };
      });
    },
    rollback({
      tenant_id,
      operation_id,
      target_snapshot_digest,
      activation_attestation,
      proof_binding,
      core_receipt,
      core_branch_id,
      nyra_branch_id,
      domain_pack_id,
      now = new Date(),
    }) {
      const tenantId = required(tenant_id, "tenant_id_required");
      const operationId = required(operation_id, "policy_operation_id_required");
      const targetDigest = required(target_snapshot_digest, "target_snapshot_digest_required");
      const binding = normalizeProofBinding(proof_binding, {
        tenantId, operationId, operation: "rollback_policy_snapshot", snapshotDigest: targetDigest,
      });
      if (binding.domain_pack_id !== domain_pack_id) throw new Error("policy_proof_binding_invalid");
      const payload = {
        tenant_id: tenantId,
        snapshot_digest: targetDigest,
        operation: "rollback_policy_snapshot",
        proof_binding: binding,
        receipt_digest: digest(core_receipt || null),
      };
      return mutate(tenantId, operationId, payload, (next) => {
        const tenant = next.tenants[tenantId];
        const resolved = rollbackTarget(next, {
          tenantId,
          targetDigest,
          coreBranchId: core_branch_id,
          nyraBranchId: nyra_branch_id,
          domainPackId: domain_pack_id,
          now,
        });
        const { index, entry: target } = resolved;
        if (binding.compiler_provenance_digest !== target.compiler_provenance.provenance_digest) {
          throw new Error("policy_proof_binding_invalid");
        }
        const provenance = verifyAttestation(
          target.snapshot,
          target.compiler_provenance,
          target.attestation,
          target.attestation?.binding,
          now,
        );
        const rollbackProof = verifyAttestation(
          target.snapshot,
          target.compiler_provenance,
          activation_attestation,
          binding,
          now,
        );
        consume(core_receipt, binding);
        tenant.history = [...tenant.history.slice(0, index), ...tenant.history.slice(index + 1), tenant.active];
        tenant.active = {
          snapshot: target.snapshot,
          attestation: {
            ...provenance,
            activation_kind: "rollback",
            rollback_policy_registry_attestation: rollbackProof.policy_registry_attestation,
            rollback_binding: binding,
          },
          compiler_provenance: target.compiler_provenance,
        };
        return { tenant_id: tenantId, snapshot_digest: targetDigest, rolled_back: true };
      });
    },
    resolveRollbackTarget({
      tenant_id,
      target_snapshot_digest,
      core_branch_id,
      nyra_branch_id,
      domain_pack_id,
      now = new Date(),
    }) {
      const tenantId = required(tenant_id, "tenant_id_required");
      const targetDigest = required(target_snapshot_digest, "target_snapshot_digest_required");
      return rollbackTarget(state, {
        tenantId,
        targetDigest,
        coreBranchId: core_branch_id,
        nyraBranchId: nyra_branch_id,
        domainPackId: domain_pack_id,
        now,
      }).entry;
    },
    evaluate({ tenant_id, action, core_branch_id, nyra_branch_id, domain_pack_id, satisfied_gates, diagnostics, context, now }) {
      const tenantId = required(tenant_id, "tenant_id_required");
      const active = state.tenants[tenantId]?.active || null;
      const snapshot = active?.snapshot || null;
      if (!snapshot) return {
        verdict: "DENY",
        reasons: ["policy_snapshot_missing"],
        fail_closed: true,
        snapshot_digest: null,
        snapshot_present: false,
        snapshot_verified: false,
      };
      if (!active?.compiler_provenance) return {
        verdict: "DENY",
        reasons: [missingProvenanceError(active, "policy_registry_compiler_provenance_missing")],
        fail_closed: true,
        snapshot_digest: snapshot.snapshot_digest,
        snapshot_present: true,
        snapshot_verified: false,
      };
      if (!active?.attestation?.binding) return {
        verdict: "DENY", reasons: ["policy_registry_state_corrupt"], fail_closed: true,
        snapshot_digest: snapshot.snapshot_digest, snapshot_present: true, snapshot_verified: false,
      };
      try {
        verifyEntry(active, {
          tenantId,
          coreBranchId: core_branch_id,
          nyraBranchId: nyra_branch_id,
          domainPackId: domain_pack_id,
          now: now || new Date(),
        });
      } catch {
        return {
          verdict: "DENY", reasons: ["policy_registry_state_corrupt"], fail_closed: true,
          snapshot_digest: snapshot.snapshot_digest, snapshot_present: true, snapshot_verified: false,
        };
      }
      const structural = validatePolicySnapshot(snapshot, {
        tenant_id: tenantId,
        core_branch_id,
        nyra_branch_id,
        domain_pack_id,
        now,
      });
      const result = evaluatePolicySnapshot(snapshot, {
        tenant_id: tenantId,
        action,
        core_branch_id,
        nyra_branch_id,
        satisfied_gates,
        diagnostics,
        context,
        now,
      });
      if (domain_pack_id && snapshot.domain_pack_id !== domain_pack_id) {
        return {
          ...result,
          verdict: "DENY",
          reasons: [...new Set([...result.reasons, "domain_pack_binding_denied"])],
          snapshot_present: true,
          snapshot_verified: false,
        };
      }
      return {
        ...result,
        snapshot_present: true,
        snapshot_verified: structural.ok,
      };
    },
    status() {
      return {
        configured: true,
        backend: filePath ? "file" : "memory",
        restart_durable: Boolean(filePath),
        distributed: false,
        state: "ready",
        ready: true,
        revision: state.revision,
        compiler_provenance_persistence: true,
        compiler_input_persisted: false,
      };
    },
  };
}

export function createPostgresNyraPolicyRegistryStore({
  pool,
  consumeCoreReceipt,
  verifyActivationSnapshot,
  verifyCompilerProvenanceRecord,
} = {}) {
  if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function") {
    throw new Error("policy_registry_postgres_pool_required");
  }
  const schemaSql = `CREATE TABLE IF NOT EXISTS nyra_policy_registry_state (
    tenant_id TEXT PRIMARY KEY,
    revision BIGINT NOT NULL DEFAULT 0,
    active_snapshot JSONB,
    active_attestation JSONB,
    active_compiler_provenance JSONB,
    history JSONB NOT NULL DEFAULT '[]'::jsonb,
    state_status TEXT NOT NULL DEFAULT 'ready',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  ); CREATE TABLE IF NOT EXISTS nyra_policy_registry_operations (
    tenant_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    receipt_digest TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    proposed_state JSONB,
    consumption_proof JSONB,
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, operation_id)
  ); ALTER TABLE nyra_policy_registry_state
    ADD COLUMN IF NOT EXISTS active_compiler_provenance JSONB;
  ALTER TABLE nyra_policy_registry_operations
    ADD COLUMN IF NOT EXISTS operation TEXT`;
  let state = "initializing";
  let stateReason = null;
  let schemaReady = false;
  let schemaInFlight = null;
  let backendProbeInFlight = null;

  async function ensureSchema() {
    if (schemaReady) return;
    if (schemaInFlight) return schemaInFlight;
    state = "initializing";
    stateReason = null;
    const current = Promise.resolve().then(() => pool.query(schemaSql));
    schemaInFlight = current;
    try {
      await current;
      schemaReady = true;
      state = "ready";
    } catch {
      state = "unavailable";
      stateReason = "policy_registry_schema_initialization_failed";
      throw new Error("policy_registry_postgres_unavailable");
    } finally {
      if (schemaInFlight === current) schemaInFlight = null;
    }
  }

  async function probeBackend() {
    if (state === "corrupt") throw new Error("policy_registry_state_corrupt");
    if (backendProbeInFlight) return backendProbeInFlight;
    const current = Promise.resolve().then(() => pool.query("SELECT 1"));
    backendProbeInFlight = current;
    try {
      await current;
      if (state !== "corrupt") {
        state = "ready";
        stateReason = null;
      }
    } catch {
      if (state !== "corrupt") {
        state = "unavailable";
        stateReason = "policy_registry_postgres_unavailable";
      }
      throw new Error("policy_registry_postgres_unavailable");
    } finally {
      if (backendProbeInFlight === current) backendProbeInFlight = null;
    }
  }

  async function ready({ verifyBackend = false } = {}) {
    await ensureSchema();
    if (state === "corrupt") throw new Error("policy_registry_state_corrupt");
    if (verifyBackend || state !== "ready") await probeBackend();
    if (state !== "ready") throw new Error("policy_registry_postgres_unavailable");
  }

  function verifyAttestation(
    snapshot,
    compilerProvenance,
    attestation,
    proofBinding,
    now = new Date(),
  ) {
    let verified = null;
    try {
      verified = typeof verifyActivationSnapshot === "function"
        ? verifyActivationSnapshot(snapshot, clone(compilerProvenance), {
            ...clone(proofBinding),
            binding: clone(proofBinding),
            activation_attestation: clone(attestation?.policy_registry_attestation || attestation),
            persisted_attestation: clone(attestation),
            now,
          })
        : null;
    } catch {
      verified = null;
    }
    const roles = new Set(verified?.verified_roles || []);
    const valid = verified?.ok === true && verified?.signature_verified === true &&
      verified?.tenant_id === proofBinding.tenant_id &&
      verified?.snapshot_digest === snapshot?.snapshot_digest &&
      verified?.compiler_provenance_digest === proofBinding.compiler_provenance_digest &&
      verified?.compiler_provenance_bound === true &&
      verified?.execution_authorized === false &&
      roles.has("core") && roles.has("nyra") && Number(verified?.independent_key_count || 0) >= 2;
    if (!valid) throw new Error("policy_snapshot_signature_quorum_invalid");
    return {
      ...clone(verified),
      binding: clone(proofBinding),
      policy_registry_attestation: clone(
        verified?.policy_registry_attestation || attestation?.policy_registry_attestation || attestation,
      ),
    };
  }

  function verifyEntry(entry, {
    tenantId,
    coreBranchId,
    nyraBranchId,
    domainPackId,
    now,
    missingCode = "policy_registry_compiler_provenance_missing",
    requireCurrent = true,
  }) {
    if (!exactKeys(entry, PERSISTED_ENTRY_FIELDS)) {
      if (entry && !Object.hasOwn(entry, "compiler_provenance")) {
        throw new Error(missingProvenanceError(entry, missingCode));
      }
      throw new Error("policy_registry_state_corrupt");
    }
    const resolvedCoreBranchId = coreBranchId || entry.snapshot?.bindings?.core_branch_ids?.[0];
    const resolvedNyraBranchId = nyraBranchId || entry.snapshot?.bindings?.nyra_branch_ids?.[0];
    const resolvedDomainPackId = domainPackId || entry.snapshot?.domain_pack_id;
    const verificationNow = now || new Date();
    const rawBinding = entry.attestation?.binding;
    let binding;
    try {
      binding = normalizeProofBinding(rawBinding, {
        tenantId,
        operationId: rawBinding?.operation_id,
        operation: rawBinding?.operation,
        snapshotDigest: entry.snapshot?.snapshot_digest,
      });
    } catch {
      throw new Error("policy_registry_state_corrupt");
    }
    if (binding.domain_pack_id !== resolvedDomainPackId ||
      entry.snapshot?.domain_pack_id !== resolvedDomainPackId) {
      throw new Error("policy_registry_state_corrupt");
    }
    const structural = validatePolicySnapshot(entry.snapshot, {
      tenant_id: tenantId,
      core_branch_id: resolvedCoreBranchId,
      nyra_branch_id: resolvedNyraBranchId,
      domain_pack_id: resolvedDomainPackId,
      now: verificationNow,
    });
    const invalidReasons = structural.reasons.filter((reason) =>
      requireCurrent || reason !== "policy_snapshot_not_current");
    if (invalidReasons.length) throw new Error("policy_registry_state_corrupt");
    const compilerProvenance = verifyCompilerProvenance({
      snapshot: entry.snapshot,
      compilerProvenance: entry.compiler_provenance,
      proofBinding: binding,
      domainPackId: resolvedDomainPackId,
      verifyCompilerProvenanceRecord,
      missingCode: entry.compiler_provenance
        ? missingCode
        : missingProvenanceError(entry, missingCode),
    });
    verifyAttestation(
      entry.snapshot,
      compilerProvenance,
      entry.attestation,
      binding,
      verificationNow,
    );
    return clone(entry);
  }

  function verifyProposedState(proposed, {
    tenantId,
    coreBranchId,
    nyraBranchId,
    domainPackId,
    now,
    operation,
    expectedRevision,
  }) {
    if (!exactKeys(proposed, PROPOSED_STATE_FIELDS) || !Array.isArray(proposed.history)) {
      throw new Error("policy_registry_state_corrupt");
    }
    const active = {
      snapshot: proposed.active_snapshot,
      attestation: proposed.active_attestation,
      compiler_provenance: proposed.active_compiler_provenance,
    };
    verifyEntry(active, {
      tenantId,
      coreBranchId,
      nyraBranchId,
      domainPackId,
      now,
    });
    for (const historical of proposed.history) {
      verifyEntry(historical, {
        tenantId,
        coreBranchId,
        nyraBranchId,
        domainPackId,
        now,
        requireCurrent: false,
      });
    }
    verifyProposedPublicResult(proposed, { tenantId, operation, expectedRevision });
    return clone(proposed);
  }

  function isPersistedCorruption(error) {
    return new Set([
      "policy_registry_state_corrupt",
      "policy_snapshot_signature_quorum_invalid",
      "policy_registry_compiler_provenance_invalid",
    ]).has(error?.message);
  }

  async function latchCorrupt(tenantId) {
    state = "corrupt";
    stateReason = "policy_registry_state_corrupt";
    try {
      await pool.query(
        "UPDATE nyra_policy_registry_state SET state_status='corrupt', updated_at=NOW() WHERE tenant_id=$1",
        [tenantId],
      );
    } catch {
      // The in-process latch remains fail-closed even if the backend is unavailable.
    }
  }

  async function consume(receipt, binding) {
    const consumed = typeof consumeCoreReceipt === "function"
      ? await consumeCoreReceipt(receipt, binding)
      : null;
    verifyConsumedReceipt(consumed, binding);
    return clone(consumed);
  }

  async function mutate({
    tenantId,
    operationId,
    request,
    receipt,
    operation,
    proofBinding,
    callback,
    consumptionProof = null,
    validation,
  }) {
    await ready();
    const requestDigest = digest(request);
    const receiptDigest = digest(receipt || null);
    let proposed;
    let proposedValidation;
    const claim = await pool.connect();
    let claimError = null;
    try {
      await claim.query("BEGIN");
      await claim.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [tenantId, "nyra-policy-registry"]);
      const replay = await claim.query(
        `SELECT operation, request_digest, receipt_digest, status, result, proposed_state
         FROM nyra_policy_registry_operations
         WHERE tenant_id=$1 AND operation_id=$2 FOR UPDATE`,
        [tenantId, operationId],
      );
      if (replay.rowCount) {
        const row = replay.rows[0];
        if (row.operation !== operation) throw new Error("policy_registry_state_corrupt");
        if (row.request_digest !== requestDigest || row.receipt_digest !== receiptDigest) {
          throw new Error("policy_operation_idempotency_conflict");
        }
        if (row.status === "completed") {
          await claim.query("COMMIT");
          return { ...clone(row.result), idempotent_replay: true };
        }
        proposed = row.proposed_state;
        const selected = await claim.query(
          "SELECT revision, state_status FROM nyra_policy_registry_state WHERE tenant_id=$1 FOR UPDATE",
          [tenantId],
        );
        const persistedState = selected.rows[0];
        if (!persistedState || persistedState.state_status !== "pending") {
          throw new Error("policy_registry_reconciliation_required");
        }
        proposedValidation = {
          ...validation,
          operation: row.operation,
          expectedRevision: Number(persistedState.revision) + 1,
        };
      } else {
        await claim.query(
          "INSERT INTO nyra_policy_registry_state(tenant_id) VALUES($1) ON CONFLICT (tenant_id) DO NOTHING",
          [tenantId],
        );
        const selected = await claim.query(
          `SELECT revision, active_snapshot, active_attestation, active_compiler_provenance,
                  history, state_status
           FROM nyra_policy_registry_state WHERE tenant_id=$1 FOR UPDATE`,
          [tenantId],
        );
        const row = selected.rows[0];
        if (!row || !["ready", "pending"].includes(row.state_status)) throw new Error("policy_registry_state_corrupt");
        if (row.state_status === "pending") throw new Error("policy_registry_reconciliation_required");
        proposed = await callback({
          revision: Number(row.revision), active_snapshot: row.active_snapshot,
          active_attestation: row.active_attestation,
          active_compiler_provenance: row.active_compiler_provenance,
          history: Array.isArray(row.history) ? row.history : [],
        });
        proposedValidation = {
          ...validation,
          operation,
          expectedRevision: Number(row.revision) + 1,
        };
        verifyProposedState(proposed, proposedValidation);
        await claim.query(
          `INSERT INTO nyra_policy_registry_operations
           (tenant_id, operation_id, operation, request_digest, receipt_digest, status, proposed_state, result)
           VALUES($1,$2,$3,$4,$5,'pending',$6::jsonb,'{}'::jsonb)`,
          [tenantId, operationId, operation, requestDigest, receiptDigest, JSON.stringify(proposed)],
        );
        await claim.query(
          "UPDATE nyra_policy_registry_state SET state_status='pending', updated_at=NOW() WHERE tenant_id=$1 AND revision=$2",
          [tenantId, row.revision],
        );
      }
      await claim.query("COMMIT");
    } catch (error) {
      try { await claim.query("ROLLBACK"); } catch { /* original error wins */ }
      claimError = error;
    } finally {
      claim.release();
    }
    if (claimError) {
      if (isPersistedCorruption(claimError)) await latchCorrupt(tenantId);
      throw claimError;
    }

    try {
      verifyProposedState(proposed, proposedValidation);
    } catch (error) {
      if (isPersistedCorruption(error)) await latchCorrupt(tenantId);
      throw error;
    }

    // Cross-store boundary: the durable pending claim exists before the
    // one-use Core receipt is consumed. A crash afterwards is reconcilable.
    const receiptBinding = normalizeProofBinding(proofBinding, {
      tenantId,
      operationId,
      operation,
      snapshotDigest: request.snapshot_digest,
    });
    let consumed;
    if (consumptionProof) {
      verifyConsumedReceipt(consumptionProof, receiptBinding);
      consumed = clone(consumptionProof);
    } else {
      consumed = await consume(receipt, receiptBinding);
    }

    const finalize = await pool.connect();
    let finalizeError = null;
    try {
      await finalize.query("BEGIN");
      await finalize.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [tenantId, "nyra-policy-registry"]);
      const operationRow = await finalize.query(
        `SELECT operation, request_digest, receipt_digest, status, result, proposed_state
         FROM nyra_policy_registry_operations
         WHERE tenant_id=$1 AND operation_id=$2 FOR UPDATE`,
        [tenantId, operationId],
      );
      const op = operationRow.rows[0];
      if (!op) throw new Error("policy_operation_binding_invalid");
      if (op.operation !== operation) throw new Error("policy_registry_state_corrupt");
      if (op.request_digest !== requestDigest || op.receipt_digest !== receiptDigest) {
        throw new Error("policy_operation_binding_invalid");
      }
      if (op.status === "completed") {
        await finalize.query("COMMIT");
        return { ...clone(op.result), idempotent_replay: true };
      }
      proposed = op.proposed_state;
      const selected = await finalize.query(
        "SELECT revision, state_status FROM nyra_policy_registry_state WHERE tenant_id=$1 FOR UPDATE",
        [tenantId],
      );
      const current = selected.rows[0];
      if (!current || current.state_status !== "pending") throw new Error("policy_registry_reconciliation_required");
      verifyProposedState(proposed, {
        ...validation,
        operation: op.operation,
        expectedRevision: Number(current.revision) + 1,
      });
      proposed.active_attestation = { ...proposed.active_attestation, core_receipt_consumption: consumed };
      const updated = await finalize.query(
        `UPDATE nyra_policy_registry_state
         SET revision=revision+1, active_snapshot=$2::jsonb, active_attestation=$3::jsonb,
             active_compiler_provenance=$4::jsonb, history=$5::jsonb,
             state_status='ready', updated_at=NOW()
         WHERE tenant_id=$1 AND revision=$6`,
        [tenantId, JSON.stringify(proposed.active_snapshot), JSON.stringify(proposed.active_attestation),
          JSON.stringify(proposed.active_compiler_provenance), JSON.stringify(proposed.history), current.revision],
      );
      if (updated.rowCount !== 1) throw new Error("policy_registry_cas_conflict");
      await finalize.query(
        `UPDATE nyra_policy_registry_operations SET status='completed', result=$3::jsonb, consumption_proof=$4::jsonb
         WHERE tenant_id=$1 AND operation_id=$2 AND status='pending'`,
        [tenantId, operationId, JSON.stringify(proposed.public_result), JSON.stringify(consumed)],
      );
      await finalize.query("COMMIT");
      return { ...clone(proposed.public_result), idempotent_replay: false };
    } catch (error) {
      try { await finalize.query("ROLLBACK"); } catch { /* original error wins */ }
      finalizeError = error;
    } finally {
      finalize.release();
    }
    if (finalizeError) {
      if (isPersistedCorruption(finalizeError)) await latchCorrupt(tenantId);
      throw finalizeError;
    }
  }

  return {
    kind: "postgresql",
    restart_durable: true,
    distributed: true,
    async activate({
      tenant_id,
      operation_id,
      snapshot,
      compiler_provenance,
      activation_attestation,
      proof_binding,
      core_receipt,
      core_branch_id,
      nyra_branch_id,
      domain_pack_id,
      now = new Date(),
    }) {
      const tenantId = required(tenant_id, "tenant_id_required");
      const operationId = required(operation_id, "policy_operation_id_required");
      const validation = validatePolicySnapshot(snapshot, { tenant_id: tenantId, core_branch_id, nyra_branch_id, domain_pack_id, now });
      if (!validation.ok) throw new Error(`policy_snapshot_invalid:${validation.reasons.join(",")}`);
      const proofBinding = normalizeProofBinding(proof_binding, {
        tenantId, operationId, operation: "activate_policy_snapshot", snapshotDigest: snapshot.snapshot_digest,
      });
      if (proofBinding.domain_pack_id !== domain_pack_id) throw new Error("policy_proof_binding_invalid");
      const compilerProvenance = verifyCompilerProvenance({
        snapshot,
        compilerProvenance: compiler_provenance,
        proofBinding,
        domainPackId: domain_pack_id,
        verifyCompilerProvenanceRecord,
      });
      const attestation = verifyAttestation(
        snapshot,
        compilerProvenance,
        activation_attestation,
        proofBinding,
        now,
      );
      const request = {
        tenant_id: tenantId,
        operation: "activate_policy_snapshot",
        snapshot_digest: snapshot.snapshot_digest,
        proof_binding: proofBinding,
      };
      return mutate({
        tenantId,
        operationId,
        request,
        receipt: core_receipt,
        operation: request.operation,
        proofBinding,
        validation: {
          tenantId,
          coreBranchId: core_branch_id,
          nyraBranchId: nyra_branch_id,
          domainPackId: domain_pack_id,
          now,
        },
        callback: async (current) => {
        const history = [...current.history];
        if (current.active_snapshot) history.push({
          snapshot: current.active_snapshot,
          attestation: current.active_attestation,
          compiler_provenance: current.active_compiler_provenance,
        });
        return {
          active_snapshot: clone(snapshot),
          active_attestation: attestation,
          active_compiler_provenance: compilerProvenance,
          history,
          public_result: { tenant_id: tenantId, snapshot_digest: snapshot.snapshot_digest, activated: true },
        };
      } });
    },
    async rollback({
      tenant_id,
      operation_id,
      target_snapshot_digest,
      activation_attestation,
      proof_binding,
      core_receipt,
      core_branch_id,
      nyra_branch_id,
      domain_pack_id,
      now = new Date(),
    }) {
      const tenantId = required(tenant_id, "tenant_id_required");
      const operationId = required(operation_id, "policy_operation_id_required");
      const targetDigest = required(target_snapshot_digest, "target_snapshot_digest_required");
      const proofBinding = normalizeProofBinding(proof_binding, {
        tenantId, operationId, operation: "rollback_policy_snapshot", snapshotDigest: targetDigest,
      });
      if (proofBinding.domain_pack_id !== domain_pack_id) throw new Error("policy_proof_binding_invalid");
      const request = {
        tenant_id: tenantId,
        operation: "rollback_policy_snapshot",
        snapshot_digest: targetDigest,
        proof_binding: proofBinding,
      };
      return mutate({
        tenantId,
        operationId,
        request,
        receipt: core_receipt,
        operation: request.operation,
        proofBinding,
        validation: {
          tenantId,
          coreBranchId: core_branch_id,
          nyraBranchId: nyra_branch_id,
          domainPackId: domain_pack_id,
          now,
        },
        callback: async (current) => {
        const index = current.history.findIndex((entry) => entry?.snapshot?.snapshot_digest === targetDigest);
        if (index < 0) throw new Error("policy_rollback_snapshot_not_found");
        if (!current.history[index]?.compiler_provenance) {
          throw new Error("policy_rollback_compiler_provenance_missing");
        }
        const target = verifyEntry(current.history[index], {
          tenantId,
          coreBranchId: core_branch_id,
          nyraBranchId: nyra_branch_id,
          domainPackId: domain_pack_id,
          now,
          missingCode: "policy_rollback_compiler_provenance_missing",
        });
        if (proofBinding.compiler_provenance_digest !== target.compiler_provenance.provenance_digest) {
          throw new Error("policy_proof_binding_invalid");
        }
        const provenanceBinding = target.attestation.binding;
        const attestation = verifyAttestation(
          target.snapshot,
          target.compiler_provenance,
          target.attestation,
          provenanceBinding,
          now,
        );
        const rollbackAttestation = verifyAttestation(
          target.snapshot,
          target.compiler_provenance,
          activation_attestation,
          proofBinding,
          now,
        );
        const history = [...current.history.slice(0, index), ...current.history.slice(index + 1)];
        if (current.active_snapshot) history.push({
          snapshot: current.active_snapshot,
          attestation: current.active_attestation,
          compiler_provenance: current.active_compiler_provenance,
        });
        return {
          active_snapshot: clone(target.snapshot),
          active_attestation: {
            ...attestation,
            activation_kind: "rollback",
            rollback_policy_registry_attestation: rollbackAttestation.policy_registry_attestation,
            rollback_binding: proofBinding,
          },
          active_compiler_provenance: target.compiler_provenance,
          history,
          public_result: { tenant_id: tenantId, snapshot_digest: targetDigest, rolled_back: true, activation_generation: current.revision + 1 },
        };
      } });
    },
    async resolveRollbackTarget({
      tenant_id,
      target_snapshot_digest,
      core_branch_id,
      nyra_branch_id,
      domain_pack_id,
      now = new Date(),
    }) {
      const tenantId = required(tenant_id, "tenant_id_required");
      const targetDigest = required(target_snapshot_digest, "target_snapshot_digest_required");
      const domainPackId = required(domain_pack_id, "domain_pack_id_required");
      try {
        await ready();
        const selected = await pool.query(
          "SELECT history, state_status FROM nyra_policy_registry_state WHERE tenant_id=$1",
          [tenantId],
        );
        if (!selected.rowCount) throw new Error("policy_rollback_snapshot_not_found");
        const row = selected.rows[0];
        if (row.state_status === "pending") throw new Error("policy_registry_reconciliation_required");
        if (row.state_status !== "ready" || !Array.isArray(row.history)) {
          throw new Error("policy_registry_state_corrupt");
        }
        const target = row.history.find((entry) => entry?.snapshot?.snapshot_digest === targetDigest);
        if (!target) throw new Error("policy_rollback_snapshot_not_found");
        if (!target.compiler_provenance) {
          throw new Error("policy_rollback_compiler_provenance_missing");
        }
        return verifyEntry(target, {
          tenantId,
          coreBranchId: core_branch_id,
          nyraBranchId: nyra_branch_id,
          domainPackId,
          now,
          missingCode: "policy_rollback_compiler_provenance_missing",
        });
      } catch (error) {
        if (isPersistedCorruption(error)) await latchCorrupt(tenantId);
        throw error;
      }
    },
    async reconcile({
      tenant_id,
      operation_id,
      operation,
      snapshot_digest,
      core_receipt,
      consumption_proof,
      proof_binding,
      core_branch_id,
      nyra_branch_id,
      domain_pack_id,
      now = new Date(),
    }) {
      const tenantId = required(tenant_id, "tenant_id_required");
      const operationId = required(operation_id, "policy_operation_id_required");
      const operationName = required(operation, "policy_operation_required");
      if (!["activate_policy_snapshot", "rollback_policy_snapshot"].includes(operationName)) {
        throw new Error("policy_operation_invalid");
      }
      const snapshotDigest = required(snapshot_digest, "snapshot_digest_required");
      const proofBinding = normalizeProofBinding(proof_binding, {
        tenantId, operationId, operation: operationName, snapshotDigest,
      });
      const domainPackId = domain_pack_id || proofBinding.domain_pack_id;
      if (domainPackId !== proofBinding.domain_pack_id) throw new Error("policy_proof_binding_invalid");
      const request = {
        tenant_id: tenantId,
        operation: operationName,
        snapshot_digest: snapshotDigest,
        proof_binding: proofBinding,
      };
      return mutate({
        tenantId, operationId, request, receipt: core_receipt, operation: operationName,
        proofBinding,
        consumptionProof: consumption_proof,
        validation: {
          tenantId,
          coreBranchId: core_branch_id,
          nyraBranchId: nyra_branch_id,
          domainPackId,
          now,
        },
        callback: async () => { throw new Error("policy_reconciliation_claim_missing"); },
      });
    },
    async evaluate(input = {}) {
      const tenantId = required(input.tenant_id, "tenant_id_required");
      try {
        await ready();
        const selected = await pool.query(
          `SELECT active_snapshot, active_attestation, active_compiler_provenance, state_status
           FROM nyra_policy_registry_state WHERE tenant_id=$1`,
          [tenantId],
        );
        if (selected.rowCount && selected.rows[0].state_status === "pending") return {
          verdict: "DENY", reasons: ["policy_registry_reconciliation_required"], fail_closed: true,
          snapshot_digest: selected.rows[0].active_snapshot?.snapshot_digest || null,
          snapshot_present: Boolean(selected.rows[0].active_snapshot), snapshot_verified: false,
        };
        if (!selected.rowCount || !selected.rows[0].active_snapshot) return {
          verdict: "DENY", reasons: ["policy_snapshot_missing"], fail_closed: true,
          snapshot_digest: null, snapshot_present: false, snapshot_verified: false,
        };
        const row = selected.rows[0];
        if (row.state_status !== "ready") throw new Error("policy_registry_state_corrupt");
        if (!row.active_compiler_provenance) {
          const missingReason = missingProvenanceError({
            attestation: row.active_attestation,
          }, "policy_registry_compiler_provenance_missing");
          if (missingReason === "policy_registry_state_corrupt") {
            throw new Error(missingReason);
          }
          return {
            verdict: "DENY",
            reasons: [missingReason],
            fail_closed: true,
            snapshot_digest: row.active_snapshot.snapshot_digest,
            snapshot_present: true,
            snapshot_verified: false,
          };
        }
        verifyEntry({
          snapshot: row.active_snapshot,
          attestation: row.active_attestation,
          compiler_provenance: row.active_compiler_provenance,
        }, {
          tenantId,
          coreBranchId: input.core_branch_id,
          nyraBranchId: input.nyra_branch_id,
          domainPackId: input.domain_pack_id,
          now: input.now || new Date(),
        });
        const structural = validatePolicySnapshot(row.active_snapshot, input);
        const evaluated = evaluatePolicySnapshot(row.active_snapshot, input);
        return { ...evaluated, snapshot_present: true, snapshot_verified: structural.ok };
      } catch (error) {
        const persistedCorruption = isPersistedCorruption(error);
        if (persistedCorruption) await latchCorrupt(tenantId);
        state = state === "corrupt" || persistedCorruption ? "corrupt" : "unavailable";
        stateReason = state === "corrupt"
          ? "policy_registry_state_corrupt"
          : "policy_registry_unavailable";
        return {
          verdict: "DENY", reasons: [state === "corrupt" ? "policy_registry_state_corrupt" : "policy_registry_unavailable"],
          fail_closed: true, snapshot_digest: null, snapshot_present: true, snapshot_verified: false,
        };
      }
    },
    async status() {
      try { await ready({ verifyBackend: true }); }
      catch { state = state === "corrupt" ? state : "unavailable"; }
      return {
        configured: true,
        backend: "postgresql",
        restart_durable: true,
        distributed: true,
        state,
        ready: state === "ready",
        reason: state === "ready" ? null : stateReason,
        compiler_provenance_persistence: true,
        compiler_input_persisted: false,
      };
    },
  };
}
