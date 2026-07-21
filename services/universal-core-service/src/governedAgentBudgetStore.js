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
      const current = read(file) || { tenant_id: tenantId, day, workflows: 0, workers: 0, retry_events: 0, timeout_events: 0, cancellation_events: 0, reservations: {} };
      if (!current.reservations || typeof current.reservations !== "object" || Array.isArray(current.reservations)) current.reservations = {};
      if (current.workflows + 1 > limits.max_workflows_per_day || current.workers + workers > limits.max_workers_per_day) throw new Error("daily_workflow_budget_exceeded");
      const reservation_id = `budget_${crypto.randomUUID()}`;
      const next = {
        ...current,
        workflows: current.workflows + 1,
        workers: current.workers + workers,
        reservations: {
          ...current.reservations,
          [reservation_id]: { worker_count: workers, reserved_at: timestamp.toISOString() },
        },
        updated_at: timestamp.toISOString(),
      };
      write(file, next);
      return { ...clone(next), reservation_id, limits: clone(limits), deadline_at: new Date(timestamp.getTime() + deadline).toISOString(), deadline_ms: deadline };
    },
    // A reservation is released only before the provider request starts. This
    // compensates failed local initialization without ever refunding a run
    // that could have consumed model capacity.
    releaseWorkflow({ tenant_id, reservation_id }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const reservationId = requireText(reservation_id, "reservation_id", 160);
      const timestamp = now();
      const day = timestamp.toISOString().slice(0, 10);
      const file = fileFor(storageRoot, tenantId, day);
      const current = read(file);
      if (!current || !current.reservations || typeof current.reservations !== "object") return { released: false };
      const reservation = current.reservations[reservationId];
      if (!reservation) return { released: false };
      const workers = Number(reservation.worker_count || 0);
      delete current.reservations[reservationId];
      current.workflows = Math.max(0, Number(current.workflows || 0) - 1);
      current.workers = Math.max(0, Number(current.workers || 0) - Math.max(0, workers));
      current.updated_at = timestamp.toISOString();
      write(file, current);
      return { released: true, workflows: current.workflows, workers: current.workers };
    },
    get({ tenant_id }) { const tenantId = requireText(tenant_id, "tenant_id", 120); const day = now().toISOString().slice(0, 10); const current = read(fileFor(storageRoot, tenantId, day)) || { tenant_id: tenantId, day, workflows: 0, workers: 0, retry_events: 0, timeout_events: 0, cancellation_events: 0, reservations: {} }; return { ...clone(current), limits: clone(limits) }; },
  };
}
