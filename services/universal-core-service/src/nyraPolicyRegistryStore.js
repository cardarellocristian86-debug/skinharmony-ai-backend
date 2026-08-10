import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { evaluatePolicySnapshot, validatePolicySnapshot } from "./nyraPolicyRegistry.js";

const SCHEMA_VERSION = "nyra_policy_registry_store_v1";
const SHA256 = /^[a-f0-9]{64}$/;
const PROOF_BINDING_FIELDS = Object.freeze([
  "tenant_id", "operation_id", "action", "operation", "work_id", "preflight_id",
  "intent_digest", "domain_pack_id", "snapshot_digest", "owner_approval_hash",
  "core_key_id", "nyra_key_id", "core_public_key_fingerprint",
  "nyra_public_key_fingerprint",
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
    ["intent_digest", "owner_approval_hash", "core_public_key_fingerprint", "nyra_public_key_fingerprint"]
      .every((field) => SHA256.test(String(value[field] || ""))) &&
    value.core_key_id !== value.nyra_key_id &&
    value.core_public_key_fingerprint !== value.nyra_public_key_fingerprint;
  if (!valid) throw new Error("policy_proof_binding_invalid");
  return clone(value);
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

export function createNyraPolicyRegistryStore({ filePath = "", consumeCoreReceipt, verifyActivationSnapshot } = {}) {
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

  function verifyAttestation(snapshot, attestation, binding, now) {
    let verified = null;
    try {
      verified = typeof verifyActivationSnapshot === "function"
        ? verifyActivationSnapshot(snapshot, {
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

  return {
    kind: filePath ? "file" : "memory",
    restart_durable: Boolean(filePath),
    activate({
      tenant_id,
      operation_id,
      snapshot,
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
      const attestation = verifyAttestation(snapshot, activation_attestation, binding, now);
      const payload = {
        tenant_id: tenantId,
        snapshot_digest: snapshot.snapshot_digest,
        operation: "activate_policy_snapshot",
        proof_binding: binding,
        receipt_digest: digest(core_receipt || null),
      };
      return mutate(tenantId, operationId, payload, (next) => {
        consume(core_receipt, binding);
        const current = next.tenants[tenantId]?.active || null;
        const history = next.tenants[tenantId]?.history || [];
        if (current) history.push(current);
        next.tenants[tenantId] = { active: { snapshot: clone(snapshot), attestation }, history };
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
        const index = tenant?.history?.findIndex((entry) => entry?.snapshot?.snapshot_digest === targetDigest) ?? -1;
        if (index < 0) throw new Error("policy_rollback_snapshot_not_found");
        const target = tenant.history[index];
        const validation = validatePolicySnapshot(target.snapshot, {
          tenant_id: tenantId, core_branch_id, nyra_branch_id, domain_pack_id, now,
        });
        if (!validation.ok) throw new Error(`policy_rollback_snapshot_invalid:${validation.reasons.join(",")}`);
        const provenance = verifyAttestation(target.snapshot, target.attestation, target.attestation?.binding, now);
        const rollbackProof = verifyAttestation(target.snapshot, activation_attestation, binding, now);
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
        };
        return { tenant_id: tenantId, snapshot_digest: targetDigest, rolled_back: true };
      });
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
      if (!active?.attestation?.binding) return {
        verdict: "DENY", reasons: ["policy_registry_state_corrupt"], fail_closed: true,
        snapshot_digest: snapshot.snapshot_digest, snapshot_present: true, snapshot_verified: false,
      };
      verifyAttestation(snapshot, active.attestation, active.attestation.binding, now || new Date());
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
      };
    },
  };
}

export function createPostgresNyraPolicyRegistryStore({
  pool,
  consumeCoreReceipt,
  verifyActivationSnapshot,
} = {}) {
  if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function") {
    throw new Error("policy_registry_postgres_pool_required");
  }
  const schemaSql = `CREATE TABLE IF NOT EXISTS nyra_policy_registry_state (
    tenant_id TEXT PRIMARY KEY,
    revision BIGINT NOT NULL DEFAULT 0,
    active_snapshot JSONB,
    active_attestation JSONB,
    history JSONB NOT NULL DEFAULT '[]'::jsonb,
    state_status TEXT NOT NULL DEFAULT 'ready',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  ); CREATE TABLE IF NOT EXISTS nyra_policy_registry_operations (
    tenant_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    receipt_digest TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    proposed_state JSONB,
    consumption_proof JSONB,
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, operation_id)
  )`;
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

  function verifyAttestation(snapshot, attestation, proofBinding, now = new Date()) {
    let verified = null;
    try {
      verified = typeof verifyActivationSnapshot === "function"
        ? verifyActivationSnapshot(snapshot, {
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
  }) {
    await ready();
    const requestDigest = digest(request);
    const receiptDigest = digest(receipt || null);
    let proposed;
    const claim = await pool.connect();
    try {
      await claim.query("BEGIN");
      await claim.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [tenantId, "nyra-policy-registry"]);
      const replay = await claim.query(
        "SELECT request_digest, receipt_digest, status, result, proposed_state FROM nyra_policy_registry_operations WHERE tenant_id=$1 AND operation_id=$2 FOR UPDATE",
        [tenantId, operationId],
      );
      if (replay.rowCount) {
        const row = replay.rows[0];
        if (row.request_digest !== requestDigest || row.receipt_digest !== receiptDigest) {
          throw new Error("policy_operation_idempotency_conflict");
        }
        if (row.status === "completed") {
          await claim.query("COMMIT");
          return { ...clone(row.result), idempotent_replay: true };
        }
        proposed = row.proposed_state;
      } else {
        await claim.query(
          "INSERT INTO nyra_policy_registry_state(tenant_id) VALUES($1) ON CONFLICT (tenant_id) DO NOTHING",
          [tenantId],
        );
        const selected = await claim.query(
          "SELECT revision, active_snapshot, active_attestation, history, state_status FROM nyra_policy_registry_state WHERE tenant_id=$1 FOR UPDATE",
          [tenantId],
        );
        const row = selected.rows[0];
        if (!row || !["ready", "pending"].includes(row.state_status)) throw new Error("policy_registry_state_corrupt");
        if (row.state_status === "pending") throw new Error("policy_registry_reconciliation_required");
        proposed = await callback({
          revision: Number(row.revision), active_snapshot: row.active_snapshot,
          active_attestation: row.active_attestation, history: Array.isArray(row.history) ? row.history : [],
        });
        await claim.query(
          `INSERT INTO nyra_policy_registry_operations
           (tenant_id, operation_id, request_digest, receipt_digest, status, proposed_state, result)
           VALUES($1,$2,$3,$4,'pending',$5::jsonb,'{}'::jsonb)`,
          [tenantId, operationId, requestDigest, receiptDigest, JSON.stringify(proposed)],
        );
        await claim.query(
          "UPDATE nyra_policy_registry_state SET state_status='pending', updated_at=NOW() WHERE tenant_id=$1 AND revision=$2",
          [tenantId, row.revision],
        );
      }
      await claim.query("COMMIT");
    } catch (error) {
      try { await claim.query("ROLLBACK"); } catch { /* original error wins */ }
      throw error;
    } finally {
      claim.release();
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
    try {
      await finalize.query("BEGIN");
      await finalize.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [tenantId, "nyra-policy-registry"]);
      const operationRow = await finalize.query(
        "SELECT request_digest, receipt_digest, status, result, proposed_state FROM nyra_policy_registry_operations WHERE tenant_id=$1 AND operation_id=$2 FOR UPDATE",
        [tenantId, operationId],
      );
      const op = operationRow.rows[0];
      if (!op || op.request_digest !== requestDigest || op.receipt_digest !== receiptDigest) throw new Error("policy_operation_binding_invalid");
      if (op.status === "completed") {
        await finalize.query("COMMIT");
        return { ...clone(op.result), idempotent_replay: true };
      }
      proposed = op.proposed_state;
      proposed.active_attestation = { ...proposed.active_attestation, core_receipt_consumption: consumed };
      const selected = await finalize.query(
        "SELECT revision, state_status FROM nyra_policy_registry_state WHERE tenant_id=$1 FOR UPDATE",
        [tenantId],
      );
      const current = selected.rows[0];
      if (!current || current.state_status !== "pending") throw new Error("policy_registry_reconciliation_required");
      const updated = await finalize.query(
        `UPDATE nyra_policy_registry_state
         SET revision=revision+1, active_snapshot=$2::jsonb, active_attestation=$3::jsonb,
             history=$4::jsonb, state_status='ready', updated_at=NOW()
         WHERE tenant_id=$1 AND revision=$5`,
        [tenantId, JSON.stringify(proposed.active_snapshot), JSON.stringify(proposed.active_attestation), JSON.stringify(proposed.history), current.revision],
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
      throw error;
    } finally {
      finalize.release();
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
      const attestation = verifyAttestation(snapshot, activation_attestation, proofBinding, now);
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
        callback: async (current) => {
        const history = [...current.history];
        if (current.active_snapshot) history.push({ snapshot: current.active_snapshot, attestation: current.active_attestation });
        return {
          active_snapshot: clone(snapshot),
          active_attestation: attestation,
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
        callback: async (current) => {
        const index = current.history.findIndex((entry) => entry?.snapshot?.snapshot_digest === targetDigest);
        if (index < 0) throw new Error("policy_rollback_snapshot_not_found");
        const target = current.history[index];
        const validation = validatePolicySnapshot(target.snapshot, {
          tenant_id: tenantId, core_branch_id, nyra_branch_id, domain_pack_id, now,
        });
        if (!validation.ok) throw new Error(`policy_rollback_snapshot_invalid:${validation.reasons.join(",")}`);
        const provenanceBinding = target.attestation?.binding;
        if (!provenanceBinding) throw new Error("policy_snapshot_signature_quorum_invalid");
        const attestation = verifyAttestation(target.snapshot, target.attestation, provenanceBinding, now);
        const rollbackAttestation = verifyAttestation(
          target.snapshot,
          activation_attestation,
          proofBinding,
          now,
        );
        const history = [...current.history.slice(0, index), ...current.history.slice(index + 1)];
        if (current.active_snapshot) history.push({ snapshot: current.active_snapshot, attestation: current.active_attestation });
        return {
          active_snapshot: clone(target.snapshot),
          active_attestation: {
            ...attestation,
            activation_kind: "rollback",
            rollback_policy_registry_attestation: rollbackAttestation.policy_registry_attestation,
            rollback_binding: proofBinding,
          },
          history,
          public_result: { tenant_id: tenantId, snapshot_digest: targetDigest, rolled_back: true, activation_generation: current.revision + 1 },
        };
      } });
    },
    async reconcile({
      tenant_id,
      operation_id,
      operation,
      snapshot_digest,
      core_receipt,
      consumption_proof,
      proof_binding,
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
        callback: async () => { throw new Error("policy_reconciliation_claim_missing"); },
      });
    },
    async evaluate(input = {}) {
      const tenantId = required(input.tenant_id, "tenant_id_required");
      try {
        await ready();
        const selected = await pool.query(
          "SELECT active_snapshot, active_attestation, state_status FROM nyra_policy_registry_state WHERE tenant_id=$1",
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
        let persistedBinding;
        try {
          const rawBinding = row.active_attestation?.binding;
          persistedBinding = normalizeProofBinding(rawBinding, {
            tenantId,
            operationId: rawBinding?.operation_id,
            operation: rawBinding?.operation,
            snapshotDigest: row.active_snapshot?.snapshot_digest,
          });
        } catch {
          throw new Error("policy_registry_state_corrupt");
        }
        if (persistedBinding.domain_pack_id !== row.active_snapshot?.domain_pack_id) {
          throw new Error("policy_registry_state_corrupt");
        }
        const structural = validatePolicySnapshot(row.active_snapshot, input);
        if (structural.reasons.some((reason) => [
          "invalid_policy_snapshot",
          "cross_tenant_snapshot_denied",
        ].includes(reason))) {
          throw new Error("policy_registry_state_corrupt");
        }
        verifyAttestation(
          row.active_snapshot,
          row.active_attestation,
          persistedBinding,
          input.now || new Date(),
        );
        const evaluated = evaluatePolicySnapshot(row.active_snapshot, input);
        return { ...evaluated, snapshot_present: true, snapshot_verified: structural.ok };
      } catch (error) {
        const persistedCorruption = new Set([
          "policy_registry_state_corrupt",
          "policy_snapshot_signature_quorum_invalid",
        ]).has(error?.message);
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
      return { configured: true, backend: "postgresql", restart_durable: true, distributed: true, state, ready: state === "ready", reason: state === "ready" ? null : stateReason };
    },
  };
}
