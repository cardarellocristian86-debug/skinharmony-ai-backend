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

function fileFor(root, tenantId, runId) {
  const safeTenant = crypto.createHash("sha256").update(tenantId).digest("hex");
  const safeRun = crypto.createHash("sha256").update(runId).digest("hex");
  return path.join(root, safeTenant, `${safeRun}.json`);
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

export function createGenericAgentCheckpointStore({ root, now = () => new Date().toISOString() } = {}) {
  const storageRoot = requireText(root, "root", 2_000);

  return {
    save({ tenant_id, run_id, checkpoint, expected_revision = null }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const runId = requireText(run_id, "run_id", 160);
      if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) throw new Error("checkpoint_invalid");
      const file = fileFor(storageRoot, tenantId, runId);
      const current = readJson(file);
      const currentRevision = current?.revision || 0;
      if (expected_revision !== null && expected_revision !== currentRevision) throw new Error("checkpoint_revision_conflict");
      const record = {
        schema_version: "generic_agent_checkpoint_store_v1",
        tenant_id: tenantId,
        run_id: runId,
        revision: currentRevision + 1,
        checkpoint: clone(checkpoint),
        updated_at: now(),
      };
      atomicWrite(file, record);
      return clone(record);
    },

    load({ tenant_id, run_id }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const runId = requireText(run_id, "run_id", 160);
      const record = readJson(fileFor(storageRoot, tenantId, runId));
      return record ? clone(record) : null;
    },
  };
}
