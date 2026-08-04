import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { evaluatePolicySnapshot, validatePolicySnapshot } from "./nyraPolicyRegistry.js";

const SCHEMA_VERSION = "nyra_policy_registry_store_v1";

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

function verifyConsumedReceipt(receipt, { tenantId, operation, snapshotDigest }) {
  const valid = receipt?.ok === true &&
    receipt?.consumed === true &&
    receipt?.single_use === true &&
    receipt?.signature_verified === true &&
    receipt?.issuer_role === "universal_core" &&
    receipt?.tenant_id === tenantId &&
    receipt?.action === operation &&
    receipt?.snapshot_digest === snapshotDigest &&
    typeof receipt?.consumption_id === "string" && receipt.consumption_id.length >= 16;
  if (!valid) throw new Error("policy_activation_core_receipt_invalid");
}

export function createNyraPolicyRegistryStore({ filePath = "", consumeCoreReceipt, verifyActivationSnapshot } = {}) {
  let state = load(filePath);
  let mutating = false;

  function mutate(operationId, payload, callback) {
    if (mutating) throw new Error("policy_registry_concurrent_mutation");
    const id = required(operationId, "policy_operation_id_required");
    const payloadDigest = digest(payload);
    const replay = state.operations[id];
    if (replay) {
      if (replay.payload_digest !== payloadDigest) throw new Error("policy_operation_idempotency_conflict");
      return { ...clone(replay.result), idempotent_replay: true };
    }
    mutating = true;
    try {
      const next = clone(state);
      const result = callback(next);
      next.revision += 1;
      next.operations[id] = { payload_digest: payloadDigest, result: clone(result) };
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

  return {
    kind: filePath ? "file" : "memory",
    restart_durable: Boolean(filePath),
    activate({ tenant_id, operation_id, snapshot, core_receipt, core_branch_id, nyra_branch_id, domain_pack_id, now = new Date() }) {
      const tenantId = required(tenant_id, "tenant_id_required");
      const validation = validatePolicySnapshot(snapshot, {
        tenant_id: tenantId,
        core_branch_id,
        nyra_branch_id,
        domain_pack_id,
        now,
      });
      if (!validation.ok) throw new Error(`policy_snapshot_invalid:${validation.reasons.join(",")}`);
      const signatureProof = typeof verifyActivationSnapshot === "function"
        ? verifyActivationSnapshot(snapshot, { tenant_id: tenantId, now })
        : null;
      const verifiedRoles = new Set(signatureProof?.verified_roles || []);
      if (
        signatureProof?.ok !== true ||
        signatureProof?.signature_verified !== true ||
        signatureProof?.tenant_id !== tenantId ||
        signatureProof?.snapshot_digest !== snapshot.snapshot_digest ||
        !verifiedRoles.has("core") ||
        !verifiedRoles.has("nyra") ||
        Number(signatureProof?.independent_key_count || 0) < 2
      ) throw new Error("policy_snapshot_signature_quorum_invalid");
      const payload = { tenant_id: tenantId, snapshot_digest: snapshot.snapshot_digest, operation: "activate_policy_snapshot" };
      return mutate(operation_id, payload, (next) => {
        consume(core_receipt, {
          tenantId,
          operation: "activate_policy_snapshot",
          snapshotDigest: snapshot.snapshot_digest,
        });
        const current = next.tenants[tenantId]?.active || null;
        const history = next.tenants[tenantId]?.history || [];
        if (current) history.push(current);
        next.tenants[tenantId] = { active: clone(snapshot), history };
        return { tenant_id: tenantId, snapshot_digest: snapshot.snapshot_digest, activated: true };
      });
    },
    rollback({ tenant_id, operation_id, target_snapshot_digest, core_receipt }) {
      const tenantId = required(tenant_id, "tenant_id_required");
      const targetDigest = required(target_snapshot_digest, "target_snapshot_digest_required");
      const payload = { tenant_id: tenantId, snapshot_digest: targetDigest, operation: "rollback_policy_snapshot" };
      return mutate(operation_id, payload, (next) => {
        consume(core_receipt, {
          tenantId,
          operation: "rollback_policy_snapshot",
          snapshotDigest: targetDigest,
        });
        const tenant = next.tenants[tenantId];
        const index = tenant?.history?.findIndex((snapshot) => snapshot.snapshot_digest === targetDigest) ?? -1;
        if (index < 0) throw new Error("policy_rollback_snapshot_not_found");
        const target = tenant.history[index];
        tenant.history = [...tenant.history.slice(0, index), ...tenant.history.slice(index + 1), tenant.active];
        tenant.active = target;
        return { tenant_id: tenantId, snapshot_digest: targetDigest, rolled_back: true };
      });
    },
    evaluate({ tenant_id, action, core_branch_id, nyra_branch_id, domain_pack_id, satisfied_gates, diagnostics, context, now }) {
      const tenantId = required(tenant_id, "tenant_id_required");
      const snapshot = state.tenants[tenantId]?.active || null;
      if (!snapshot) return {
        verdict: "DENY",
        reasons: ["policy_snapshot_missing"],
        fail_closed: true,
        snapshot_digest: null,
        snapshot_present: false,
        snapshot_verified: false,
      };
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
  const schema = pool.query(`CREATE TABLE IF NOT EXISTS nyra_policy_registry_state (
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
  )`);
  let state = "initializing";
  let stateReason = null;
  schema.then(() => { state = "ready"; }, (error) => {
    state = "unavailable";
    stateReason = String(error?.message || "schema_initialization_failed").slice(0, 120);
  });

  async function ready() {
    await schema;
    if (state !== "ready") throw new Error("policy_registry_postgres_unavailable");
  }

  function verifyAttestation(snapshot, attestation, tenantId, now = new Date()) {
    let verified = null;
    try {
      verified = typeof verifyActivationSnapshot === "function"
        ? verifyActivationSnapshot(snapshot, { tenant_id: tenantId, now, persisted_attestation: clone(attestation) })
        : null;
    } catch {
      verified = null;
    }
    const roles = new Set(verified?.verified_roles || []);
    const valid = verified?.ok === true && verified?.signature_verified === true &&
      verified?.tenant_id === tenantId && verified?.snapshot_digest === snapshot?.snapshot_digest &&
      roles.has("core") && roles.has("nyra") && Number(verified?.independent_key_count || 0) >= 2;
    if (!valid) throw new Error("policy_snapshot_signature_quorum_invalid");
    return clone(verified);
  }

  async function consume(receipt, binding) {
    const consumed = typeof consumeCoreReceipt === "function"
      ? await consumeCoreReceipt(receipt, binding)
      : null;
    verifyConsumedReceipt(consumed, binding);
    return clone(consumed);
  }

  async function mutate({ tenantId, operationId, request, receipt, operation, callback, consumptionProof = null }) {
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
    const receiptBinding = { tenantId, operation, snapshotDigest: request.snapshot_digest };
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
    async activate({ tenant_id, operation_id, snapshot, core_receipt, core_branch_id, nyra_branch_id, domain_pack_id, now = new Date() }) {
      const tenantId = required(tenant_id, "tenant_id_required");
      const operationId = required(operation_id, "policy_operation_id_required");
      const validation = validatePolicySnapshot(snapshot, { tenant_id: tenantId, core_branch_id, nyra_branch_id, domain_pack_id, now });
      if (!validation.ok) throw new Error(`policy_snapshot_invalid:${validation.reasons.join(",")}`);
      const attestation = verifyAttestation(snapshot, null, tenantId, now);
      const request = { tenant_id: tenantId, operation: "activate_policy_snapshot", snapshot_digest: snapshot.snapshot_digest };
      return mutate({ tenantId, operationId, request, receipt: core_receipt, operation: request.operation, callback: async (current) => {
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
    async rollback({ tenant_id, operation_id, target_snapshot_digest, core_receipt, core_branch_id, nyra_branch_id, domain_pack_id, now = new Date() }) {
      const tenantId = required(tenant_id, "tenant_id_required");
      const operationId = required(operation_id, "policy_operation_id_required");
      const targetDigest = required(target_snapshot_digest, "target_snapshot_digest_required");
      const request = { tenant_id: tenantId, operation: "rollback_policy_snapshot", snapshot_digest: targetDigest };
      return mutate({ tenantId, operationId, request, receipt: core_receipt, operation: request.operation, callback: async (current) => {
        const index = current.history.findIndex((entry) => entry?.snapshot?.snapshot_digest === targetDigest);
        if (index < 0) throw new Error("policy_rollback_snapshot_not_found");
        const target = current.history[index];
        const validation = validatePolicySnapshot(target.snapshot, {
          tenant_id: tenantId, core_branch_id, nyra_branch_id, domain_pack_id, now,
        });
        if (!validation.ok) throw new Error(`policy_rollback_snapshot_invalid:${validation.reasons.join(",")}`);
        const attestation = verifyAttestation(target.snapshot, target.attestation, tenantId, now);
        const history = [...current.history.slice(0, index), ...current.history.slice(index + 1)];
        if (current.active_snapshot) history.push({ snapshot: current.active_snapshot, attestation: current.active_attestation });
        return {
          active_snapshot: clone(target.snapshot),
          active_attestation: { ...attestation, activation_kind: "rollback" },
          history,
          public_result: { tenant_id: tenantId, snapshot_digest: targetDigest, rolled_back: true, activation_generation: current.revision + 1 },
        };
      } });
    },
    async reconcile({ tenant_id, operation_id, operation, snapshot_digest, core_receipt, consumption_proof }) {
      const tenantId = required(tenant_id, "tenant_id_required");
      const operationId = required(operation_id, "policy_operation_id_required");
      const operationName = required(operation, "policy_operation_required");
      if (!["activate_policy_snapshot", "rollback_policy_snapshot"].includes(operationName)) {
        throw new Error("policy_operation_invalid");
      }
      const snapshotDigest = required(snapshot_digest, "snapshot_digest_required");
      const request = { tenant_id: tenantId, operation: operationName, snapshot_digest: snapshotDigest };
      return mutate({
        tenantId, operationId, request, receipt: core_receipt, operation: operationName,
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
        verifyAttestation(row.active_snapshot, row.active_attestation, tenantId, input.now || new Date());
        const structural = validatePolicySnapshot(row.active_snapshot, input);
        const evaluated = evaluatePolicySnapshot(row.active_snapshot, input);
        return { ...evaluated, snapshot_present: true, snapshot_verified: structural.ok };
      } catch (error) {
        state = error?.message === "policy_registry_state_corrupt" ? "corrupt" : "unavailable";
        stateReason = String(error?.message || "policy_registry_unavailable").slice(0, 120);
        return {
          verdict: "DENY", reasons: [state === "corrupt" ? "policy_registry_state_corrupt" : "policy_registry_unavailable"],
          fail_closed: true, snapshot_digest: null, snapshot_present: true, snapshot_verified: false,
        };
      }
    },
    async status() {
      try { await ready(); await pool.query("SELECT 1"); }
      catch { state = state === "corrupt" ? state : "unavailable"; }
      return { configured: true, backend: "postgresql", restart_durable: true, distributed: true, state, ready: state === "ready", reason: state === "ready" ? null : stateReason };
    },
  };
}
