import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function requireText(value, field, max = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fileFor(root, tenantId, planId) {
  const tenant = crypto.createHash("sha256").update(tenantId).digest("hex");
  const plan = crypto.createHash("sha256").update(planId).digest("hex");
  return path.join(root, tenant, `${plan}.json`);
}

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, file);
}

export function createGenericAgentOrchestrationStore({ root, now = () => new Date().toISOString() } = {}) {
  const storageRoot = requireText(root, "root", 2_000);
  return {
    save({ tenant_id, plan_snapshot }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      if (!plan_snapshot || typeof plan_snapshot !== "object" || Array.isArray(plan_snapshot)) throw new Error("plan_snapshot_invalid");
      const planId = requireText(plan_snapshot.plan_id, "plan_id", 160);
      if (plan_snapshot.tenant_id !== tenantId) throw new Error("cross_tenant_plan_denied");
      const record = {
        schema_version: "generic_agent_orchestration_store_v1",
        tenant_id: tenantId,
        plan_id: planId,
        plan_snapshot: clone(plan_snapshot),
        updated_at: now(),
      };
      writeAtomic(fileFor(storageRoot, tenantId, planId), record);
      return clone(record);
    },
    load({ tenant_id, plan_id }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const planId = requireText(plan_id, "plan_id", 160);
      const file = fileFor(storageRoot, tenantId, planId);
      if (!fs.existsSync(file)) return null;
      return clone(JSON.parse(fs.readFileSync(file, "utf8")));
    },
  };
}
