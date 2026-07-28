import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  requireGenericAgentDurableIdentifier,
  sanitizeGenericAgentPlanSnapshot,
} from "./genericAgentDurableSnapshot.js";

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
      const tenantId = requireGenericAgentDurableIdentifier(tenant_id, "tenant_id", 120);
      if (!plan_snapshot || typeof plan_snapshot !== "object" || Array.isArray(plan_snapshot)) throw new Error("plan_snapshot_invalid");
      const planId = requireGenericAgentDurableIdentifier(plan_snapshot.plan_id, "plan_id", 160);
      if (plan_snapshot.tenant_id !== tenantId) throw new Error("cross_tenant_plan_denied");
      const durablePlan = sanitizeGenericAgentPlanSnapshot(plan_snapshot, tenantId);
      const record = {
        schema_version: "generic_agent_orchestration_store_v2",
        tenant_id: tenantId,
        plan_id: planId,
        plan_snapshot: durablePlan,
        raw_content_persisted: false,
        updated_at: now(),
      };
      writeAtomic(fileFor(storageRoot, tenantId, planId), record);
      return clone(record);
    },
    load({ tenant_id, plan_id }) {
      const tenantId = requireGenericAgentDurableIdentifier(tenant_id, "tenant_id", 120);
      const planId = requireGenericAgentDurableIdentifier(plan_id, "plan_id", 160);
      const file = fileFor(storageRoot, tenantId, planId);
      if (!fs.existsSync(file)) return null;
      const record = JSON.parse(fs.readFileSync(file, "utf8"));
      if (record.tenant_id !== tenantId || record.plan_id !== planId) {
        throw new Error("orchestration_snapshot_scope_invalid");
      }
      const sanitized = {
        schema_version: "generic_agent_orchestration_store_v2",
        tenant_id: tenantId,
        plan_id: planId,
        plan_snapshot: sanitizeGenericAgentPlanSnapshot(record.plan_snapshot, tenantId),
        raw_content_persisted: false,
        updated_at: record.updated_at || now(),
      };
      if (JSON.stringify(record) !== JSON.stringify(sanitized)) writeAtomic(file, sanitized);
      return clone(sanitized);
    },
  };
}
