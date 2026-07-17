import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function requireText(value, field, max = 160) { const normalized = String(value || "").trim(); if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`); return normalized; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function fileFor(root, tenantId, day) { return path.join(root, crypto.createHash("sha256").update(tenantId).digest("hex"), `${day}.json`); }
function read(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null; }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`; fs.writeFileSync(temp, JSON.stringify(value), { encoding: "utf8", mode: 0o600 }); fs.renameSync(temp, file); }

export function createGovernedAgentBudgetStore({ root, now = () => new Date() } = {}) {
  const storageRoot = requireText(root, "root", 2_000);
  const limits = { max_workflows_per_day: 24, max_workers_per_day: 72, max_retries_per_worker: 1, max_deadline_ms: 300_000 };
  return {
    reserveWorkflow({ tenant_id, worker_count, deadline_ms = 120_000 }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120); const workers = Number(worker_count); const deadline = Number(deadline_ms);
      if (!Number.isInteger(workers) || workers < 1 || workers > limits.max_workers_per_day) throw new Error("workflow_worker_count_invalid");
      if (!Number.isInteger(deadline) || deadline < 1_000 || deadline > limits.max_deadline_ms) throw new Error("workflow_deadline_invalid");
      const timestamp = now(); const day = timestamp.toISOString().slice(0, 10); const file = fileFor(storageRoot, tenantId, day);
      const current = read(file) || { tenant_id: tenantId, day, workflows: 0, workers: 0, retry_events: 0, timeout_events: 0, cancellation_events: 0 };
      if (current.workflows + 1 > limits.max_workflows_per_day || current.workers + workers > limits.max_workers_per_day) throw new Error("daily_workflow_budget_exceeded");
      const next = { ...current, workflows: current.workflows + 1, workers: current.workers + workers, updated_at: timestamp.toISOString() }; write(file, next);
      return { ...clone(next), limits: clone(limits), deadline_at: new Date(timestamp.getTime() + deadline).toISOString(), deadline_ms: deadline };
    },
    get({ tenant_id }) { const tenantId = requireText(tenant_id, "tenant_id", 120); const day = now().toISOString().slice(0, 10); const current = read(fileFor(storageRoot, tenantId, day)) || { tenant_id: tenantId, day, workflows: 0, workers: 0, retry_events: 0, timeout_events: 0, cancellation_events: 0 }; return { ...clone(current), limits: clone(limits) }; },
  };
}
