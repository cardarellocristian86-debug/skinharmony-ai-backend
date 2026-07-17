import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireText(value, field, max = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function activationFile(root, tenantId, activationId) {
  return path.join(root, digest(tenantId), "activations", `${digest(activationId)}.json`);
}

function idempotencyFile(root, tenantId, idempotencyKey) {
  return path.join(root, digest(tenantId), "idempotency", `${digest(idempotencyKey)}.json`);
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function createGovernedAgentActivationStore({ root, now = () => new Date().toISOString() } = {}) {
  const storageRoot = requireText(root, "root", 2_000);

  return {
    save({ tenant_id, activation, run_snapshot, workflow = null, expected_revision = null }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      if (!activation || typeof activation !== "object" || Array.isArray(activation)) throw new Error("activation_invalid");
      const activationId = requireText(activation.activation_id, "activation_id", 160);
      if (activation.tenant_id !== tenantId) throw new Error("cross_tenant_activation_denied");
      const file = activationFile(storageRoot, tenantId, activationId);
      const current = readJson(file);
      const revision = current?.revision || 0;
      if (expected_revision !== null && expected_revision !== revision) throw new Error("activation_revision_conflict");
      const record = {
        schema_version: "governed_agent_activation_store_v1",
        tenant_id: tenantId,
        activation: clone(activation),
        run_snapshot: run_snapshot && typeof run_snapshot === "object" && !Array.isArray(run_snapshot) ? clone(run_snapshot) : current?.run_snapshot || null,
        workflow: workflow && typeof workflow === "object" && !Array.isArray(workflow) ? clone(workflow) : current?.workflow || null,
        revision: revision + 1,
        updated_at: now(),
      };
      atomicWrite(file, record);
      if (activation.idempotency_key) {
        atomicWrite(idempotencyFile(storageRoot, tenantId, activation.idempotency_key), {
          schema_version: "governed_agent_activation_idempotency_v1",
          tenant_id: tenantId,
          idempotency_key: activation.idempotency_key,
          activation_id: activationId,
          updated_at: record.updated_at,
        });
      }
      return clone(record);
    },

    load({ tenant_id, activation_id }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const activationId = requireText(activation_id, "activation_id", 160);
      const record = readJson(activationFile(storageRoot, tenantId, activationId));
      return record ? clone(record) : null;
    },

    findByIdempotency({ tenant_id, idempotency_key }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const key = requireText(idempotency_key, "idempotency_key", 160);
      const index = readJson(idempotencyFile(storageRoot, tenantId, key));
      if (!index) return null;
      if (index.tenant_id !== tenantId) throw new Error("cross_tenant_activation_denied");
      return this.load({ tenant_id: tenantId, activation_id: index.activation_id });
    },
  };
}
