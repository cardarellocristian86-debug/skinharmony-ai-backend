import crypto from "node:crypto";
import { Pool } from "pg";
import { guardInterAgentEnvelope } from "../../shared/handoff-injection-guard.mjs";
import { digest, WORK_CONTINUITY_SCHEMA_SQL } from "./work-continuity-runtime.js";
import { compileNyraAutopilotPlan } from "./nyra-autopilot-plan.js";

export const NYRA_AUTOPILOT_SCHEMA_VERSION = "nyra_work_autopilot_v1";
export const NYRA_AUTOPILOT_ACTIVE_WORK_ADOPTION_LIMIT = 100;
const CLIENT_TYPES = new Set(["chatgpt", "codex", "api_agent", "other"]);
const ACTIVE_ASSIGNMENT_STATES = new Set(["offered", "claimed", "submitted", "verified", "quarantined", "cancelled", "expired"]);

const CREATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS core_nyra_autopilot_tenants (
  tenant_id varchar(64) PRIMARY KEY,
  status varchar(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  policy_version varchar(80) NOT NULL,
  max_active_specialists integer NOT NULL DEFAULT 3 CHECK (max_active_specialists BETWEEN 1 AND 3),
  max_parallel_assignments integer NOT NULL DEFAULT 2 CHECK (max_parallel_assignments BETWEEN 1 AND 2),
  enabled_by varchar(120) NOT NULL,
  enable_idempotency_key varchar(160) NOT NULL UNIQUE,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core_nyra_autopilot_runs (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  run_id uuid NOT NULL,
  project_id varchar(64) NOT NULL,
  trigger_type varchar(40) NOT NULL CHECK (trigger_type IN ('work_created','work_changed','work_resumed','reconcile')),
  architecture_version integer NOT NULL CHECK (architecture_version >= 1),
  intent_digest char(64) NOT NULL,
  plan jsonb NOT NULL,
  plan_digest char(64) NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','materialized','blocked','completed','cancelled')),
  created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, run_id),
  UNIQUE (tenant_id, work_id, architecture_version, plan_digest),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);
CREATE INDEX IF NOT EXISTS core_nyra_autopilot_runs_scope_idx
  ON core_nyra_autopilot_runs(tenant_id, project_id, work_id, created_at DESC);

CREATE TABLE IF NOT EXISTS core_nyra_autopilot_assignments (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  run_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  assignment_key varchar(80) NOT NULL,
  agent_instance_id uuid NOT NULL,
  blueprint_id varchar(80) NOT NULL,
  role varchar(80) NOT NULL,
  task_contract jsonb NOT NULL,
  dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  eligible_client_types jsonb NOT NULL DEFAULT '["chatgpt","codex","api_agent","other"]'::jsonb,
  status varchar(40) NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','claimed','submitted','verified','quarantined','cancelled','expired')),
  claimed_agent_id varchar(120),
  claimed_client_type varchar(40),
  claimed_presence_signature varchar(80),
  claimed_session_fingerprint varchar(80),
  claim_expires_at timestamptz,
  submitted_result jsonb,
  quarantine jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, assignment_id),
  UNIQUE (tenant_id, run_id, assignment_key),
  FOREIGN KEY (tenant_id, work_id, run_id) REFERENCES core_nyra_autopilot_runs(tenant_id, work_id, run_id),
  FOREIGN KEY (tenant_id, work_id, agent_instance_id) REFERENCES core_nyra_agent_instances(tenant_id, work_id, agent_instance_id)
);
CREATE INDEX IF NOT EXISTS core_nyra_autopilot_assignment_scope_idx
  ON core_nyra_autopilot_assignments(tenant_id, work_id, run_id, status, created_at);

CREATE TABLE IF NOT EXISTS core_nyra_autopilot_receipts (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  sequence_number bigint NOT NULL,
  event_type varchar(80) NOT NULL,
  payload jsonb NOT NULL,
  previous_receipt_hash char(64),
  receipt_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, receipt_id),
  UNIQUE (tenant_id, work_id, sequence_number),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);
CREATE OR REPLACE FUNCTION core_nyra_autopilot_receipts_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'core_nyra_autopilot_receipts_append_only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS core_nyra_autopilot_receipts_no_mutation ON core_nyra_autopilot_receipts;
CREATE TRIGGER core_nyra_autopilot_receipts_no_mutation BEFORE UPDATE OR DELETE ON core_nyra_autopilot_receipts
FOR EACH ROW EXECUTE FUNCTION core_nyra_autopilot_receipts_append_only();
`;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function tenant(value) {
  const id = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(id)) throw new Error("tenant_invalid");
  return id;
}
function identifier(value, field, max = 120) {
  const id = String(value || "").trim();
  if (!new RegExp(`^[a-zA-Z0-9][a-zA-Z0-9_-]{1,${Math.max(1, max - 1)}}$`).test(id)) throw new Error(`${field}_invalid`);
  return id;
}
function uuid(value, field = "id") {
  const id = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error(`${field}_invalid`);
  return id;
}
function text(value, max = 4_000) { return String(value || "").replaceAll("\u0000", " ").trim().slice(0, max); }
function idempotency(value) { return identifier(value, "idempotency_key", 160); }
function actor(identity, fallback = "nyra_autopilot") {
  const candidate = String(identity?.agentPresence?.agent_id || identity?.subject || fallback).trim();
  if (/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,119}$/.test(candidate)) return candidate;
  return `agent_${digest(candidate || fallback).slice(0, 32)}`;
}
function shortKey(prefix, value) { return `${prefix}_${digest(value).slice(0, 48)}`; }

function publicAssignment(row) {
  return {
    assignment_id: row.assignment_id,
    run_id: row.run_id,
    assignment_key: row.assignment_key,
    blueprint_id: row.blueprint_id,
    role: row.role,
    task_contract: clone(row.task_contract || {}),
    dependencies: Array.isArray(row.dependencies) ? row.dependencies : [],
    eligible_client_types: Array.isArray(row.eligible_client_types) ? row.eligible_client_types : [],
    status: row.status,
    claim_expires_at: row.claim_expires_at || null,
    submitted: Boolean(row.submitted_result),
    quarantined: Boolean(row.quarantine),
    execution_authorized: false,
  };
}

function assignmentSpecs(plan) {
  const ids = new Set(plan.required_roles.map((item) => item.blueprint_id));
  const specs = [];
  const add = (key, blueprintId, role, summary, dependencies = []) => specs.push({ key, blueprintId, role, summary, dependencies });
  if (ids.has("planner")) add("plan", "planner", "planner", "Compila una scomposizione del Work e criteri di uscita strettamente nel suo perimetro.");
  if (ids.has("memory_curator")) add("memory", "memory_curator", "memory_curator", "Prepara capsule e handoff strutturati; non promuovere memoria né modificare dati.");
  if (ids.has("researcher")) add("research", "researcher", "researcher", "Raccogli evidenze con fonti, limiti e incertezza dichiarati.", ["plan"]);
  if (ids.has("executor_specialist")) add("execute", "executor_specialist", "executor_specialist", "Prepara un artefatto delimitato e riporta solo evidenze verificabili.", ["plan"]);
  if (ids.has("release_operations")) add("release_prepare", "release_operations", "release_operations", "Prepara checklist di rilascio e rollback; non eseguire merge, deploy o pubblicazioni.", ["plan"]);
  if (ids.has("independent_verifier")) {
    const dependencies = specs.filter((item) => ["research", "execute", "release_prepare"].includes(item.key)).map((item) => item.key);
    add("verify", "independent_verifier", "independent_verifier", "Verifica in modo indipendente evidenze, regressioni e limiti; non correggere né autorizzare azioni. Per un verdetto approvato usa lo scope Work e il contratto di evidenza restituiti da Nyra al claim.", dependencies.length ? dependencies : ["plan"]);
  }
  return specs;
}

function presence(identity) {
  const value = identity?.agentPresence || {};
  const clientType = String(value.client_type || "").toLowerCase();
  if (value.transport_bound !== true || !CLIENT_TYPES.has(clientType) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,119}$/.test(String(value.agent_id || "")) ||
      !/^ags_[a-f0-9]{32}$/.test(String(value.signature || "")) || !/^[a-f0-9]{16,64}$/i.test(String(value.host_transport_session_fingerprint || ""))) {
    throw new Error("nyra_autopilot_claim_presence_required");
  }
  return { agent_id: value.agent_id, client_type: clientType, signature: value.signature, session_fingerprint: value.host_transport_session_fingerprint };
}

export function createNyraAutopilotRuntime(config = {}, { pool: suppliedPool, teamRuntime } = {}) {
  if ((!config.databaseUrl && !suppliedPool) || !teamRuntime) return null;
  const pool = suppliedPool || new Pool({ connectionString: config.databaseUrl, ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined, max: config.databasePoolMax || 5 });
  let ready;
  const initialize = () => ready ||= (async () => {
    await pool.query(WORK_CONTINUITY_SCHEMA_SQL);
    await pool.query(teamRuntime.schemaSql || "");
    await pool.query(CREATE_SCHEMA_SQL);
  })();
  async function transaction(fn) {
    await initialize();
    const client = typeof pool.connect === "function" ? await pool.connect() : pool;
    try {
      if (client.query !== pool.query) await client.query("BEGIN");
      const result = await fn(client);
      if (client.query !== pool.query) await client.query("COMMIT");
      return result;
    } catch (error) {
      if (client.query !== pool.query) await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release?.(); }
  }
  async function appendReceipt(client, tenantId, workId, eventType, payload) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [tenantId, `nyra-autopilot:${workId}`]);
    const previous = await client.query(`SELECT sequence_number,receipt_hash FROM core_nyra_autopilot_receipts
      WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`, [tenantId, workId]);
    const receipt = { tenant_id: tenantId, work_id: workId, sequence_number: Number(previous.rows[0]?.sequence_number || 0) + 1,
      event_type: eventType, payload: clone(payload), previous_receipt_hash: previous.rows[0]?.receipt_hash || null };
    const receiptHash = digest(receipt);
    const receiptId = crypto.randomUUID();
    await client.query(`INSERT INTO core_nyra_autopilot_receipts
      (tenant_id,work_id,receipt_id,sequence_number,event_type,payload,previous_receipt_hash,receipt_hash)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`, [tenantId, workId, receiptId, receipt.sequence_number, eventType,
      JSON.stringify(receipt.payload), receipt.previous_receipt_hash, receiptHash]);
    return { receipt_id: receiptId, sequence_number: receipt.sequence_number, event_type: eventType, receipt_hash: receiptHash };
  }
  async function settingsFor(client, tenantId) {
    const result = await client.query(`SELECT tenant_id,status,policy_version,max_active_specialists,max_parallel_assignments,enabled_at
      FROM core_nyra_autopilot_tenants WHERE tenant_id=$1`, [tenantId]);
    return result.rows[0] || null;
  }
  async function expireClaims(client, tenantId, workId) {
    return client.query(`UPDATE core_nyra_autopilot_assignments
      SET status='expired',updated_at=now() WHERE tenant_id=$1 AND work_id=$2 AND status='claimed'
      AND claim_expires_at IS NOT NULL AND claim_expires_at<=now()`, [tenantId, workId]);
  }

  async function materializeRun(identity, run) {
    const plan = run.plan;
    const materialization = await teamRuntime.materializeForWork(identity, {
      project_id: run.project_id,
      work_id: run.work_id,
      agent_id: "nyra_autopilot",
      blueprint_ids: plan.required_roles.map((item) => item.blueprint_id),
      idempotency_key: shortKey("nyraauto", { tenant: run.tenant_id, work: run.work_id, version: run.architecture_version, digest: run.plan_digest }),
      receipt_event_type: "nyra_autopilot_team_materialized",
    });
    return transaction(async (client) => {
      const current = await client.query(`SELECT status FROM core_nyra_autopilot_runs
        WHERE tenant_id=$1 AND work_id=$2 AND run_id=$3 FOR UPDATE`, [run.tenant_id, run.work_id, run.run_id]);
      if (!current.rows[0]) throw new Error("nyra_autopilot_run_not_found");
      if (current.rows[0].status === "materialized") return { materialization, idempotent_replay: true };
      const instances = new Map(materialization.instances.map((item) => [item.blueprint_id, item]));
      for (const spec of assignmentSpecs(plan)) {
        const instance = instances.get(spec.blueprintId);
        if (!instance) throw new Error("nyra_autopilot_materialization_incomplete");
        const contract = {
          schema_version: "nyra_autopilot_assignment_v1", summary: spec.summary,
          work_scope: { tenant_id: run.tenant_id, project_id: run.project_id, work_id: run.work_id },
          plan_digest: run.plan_digest, execution_authorized: false, tool_allowlist: [], model_invocation_allowed: false,
          external_action_allowed: false, core_gate_required: true,
        };
        await client.query(`INSERT INTO core_nyra_autopilot_assignments
          (tenant_id,work_id,run_id,assignment_id,assignment_key,agent_instance_id,blueprint_id,role,task_contract,dependencies)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb) ON CONFLICT (tenant_id,run_id,assignment_key) DO NOTHING`,
        [run.tenant_id, run.work_id, run.run_id, crypto.randomUUID(), spec.key, instance.agent_instance_id, spec.blueprintId,
          spec.role, JSON.stringify(contract), JSON.stringify(spec.dependencies)]);
      }
      await client.query(`UPDATE core_nyra_autopilot_runs SET status='materialized',updated_at=now()
        WHERE tenant_id=$1 AND work_id=$2 AND run_id=$3`, [run.tenant_id, run.work_id, run.run_id]);
      const receipt = await appendReceipt(client, run.tenant_id, run.work_id, "nyra_autopilot_materialized", {
        run_id: run.run_id, plan_digest: run.plan_digest, selected_blueprint_ids: plan.required_roles.map((item) => item.blueprint_id),
        assignment_keys: assignmentSpecs(plan).map((item) => item.key), execution_authorized: false,
      });
      return { materialization, receipt, idempotent_replay: false };
    });
  }

  const runtime = {
    schemaSql: CREATE_SCHEMA_SQL,
    initialize,
    async enable(identity, input = {}) {
      const tenantId = tenant(identity?.tenantId);
      const key = idempotency(input.idempotency_key);
      const enabledBy = actor(identity);
      const teamStatus = await teamRuntime.status(identity);
      if (!teamStatus.package.enabled) {
        await teamRuntime.enable(identity, { agent_id: enabledBy, idempotency_key: shortKey("autoteam", { tenantId, key }) });
      }
      const activation = await transaction(async (client) => {
        const existing = await settingsFor(client, tenantId);
        if (existing) {
          if (existing.status !== "active") throw new Error("nyra_autopilot_disabled");
          return { tenant_id: tenantId, status: "active", policy_version: existing.policy_version, idempotent_replay: true,
            execution_authorized: false, model_invocation_allowed: false, external_action_allowed: false };
        }
        await client.query(`INSERT INTO core_nyra_autopilot_tenants
          (tenant_id,status,policy_version,max_active_specialists,max_parallel_assignments,enabled_by,enable_idempotency_key)
          VALUES ($1,'active',$2,3,2,$3,$4)`, [tenantId, NYRA_AUTOPILOT_SCHEMA_VERSION, enabledBy, key]);
        return { tenant_id: tenantId, status: "active", policy_version: NYRA_AUTOPILOT_SCHEMA_VERSION, idempotent_replay: false,
          execution_authorized: false, model_invocation_allowed: false, external_action_allowed: false };
      });
      // The first tenant activation also adopts persisted active Work records.
      // This makes the change safe for work already in progress at deployment
      // time. Reconcile is idempotent, so a retried activation only repairs a
      // prior transient failure and never duplicates a team or an offer.
      const works = await pool.query(`SELECT work_id,project_id FROM core_continuity_works
        WHERE tenant_id=$1 AND status='active' ORDER BY updated_at DESC LIMIT $2`, [tenantId, NYRA_AUTOPILOT_ACTIVE_WORK_ADOPTION_LIMIT]);
      const adoption = [];
      for (const work of works.rows) {
        try {
          const outcome = await runtime.reconcile(identity, {
            work_id: work.work_id,
            project_id: work.project_id,
            trigger_type: "reconcile",
          });
          adoption.push({ work_id: work.work_id, project_id: work.project_id, status: outcome.status, run_id: outcome.run_id || null });
        } catch (error) {
          // Activation remains durable even if a legacy Work has corrupt or
          // unavailable continuity data. The bounded recovery can retry it.
          adoption.push({ work_id: work.work_id, project_id: work.project_id, status: "deferred", code: text(error?.message || "nyra_autopilot_adoption_failed", 160) });
        }
      }
      return {
        ...activation,
        active_work_adoption: {
          attempted: adoption.length,
          limit: NYRA_AUTOPILOT_ACTIVE_WORK_ADOPTION_LIMIT,
          results: adoption,
          execution_authorized: false,
        },
      };
    },
    async status(identity) {
      const tenantId = tenant(identity?.tenantId);
      await initialize();
      const setting = await settingsFor(pool, tenantId);
      return { schema_version: NYRA_AUTOPILOT_SCHEMA_VERSION, tenant_id: tenantId,
        enabled: setting?.status === "active", status: setting?.status || "disabled", policy_version: setting?.policy_version || NYRA_AUTOPILOT_SCHEMA_VERSION,
        limits: { max_active_specialists: Number(setting?.max_active_specialists || 3), max_parallel_assignments: Number(setting?.max_parallel_assignments || 2) },
        execution_authorized: false, model_invocation_allowed: false, external_action_allowed: false };
    },
    async reconcile(identity, input = {}) {
      const tenantId = tenant(identity?.tenantId);
      const workId = uuid(input.work_id, "work_id");
      const requestedProjectId = input.project_id ? identifier(input.project_id, "project_id", 64) : null;
      const triggerType = ["work_created", "work_changed", "work_resumed", "reconcile"].includes(input.trigger_type) ? input.trigger_type : "reconcile";
      await initialize();
      const setting = await settingsFor(pool, tenantId);
      if (setting?.status !== "active") return { tenant_id: tenantId, work_id: workId, status: "skipped_not_enabled", execution_authorized: false };
      const run = await transaction(async (client) => {
        const work = await client.query(`SELECT w.project_id,w.idea,w.objective,w.current_version,a.anchor,a.intent_digest
          FROM core_continuity_works w JOIN core_continuity_intent_anchors a ON a.tenant_id=w.tenant_id AND a.work_id=w.work_id
          WHERE w.tenant_id=$1 AND w.work_id=$2 FOR UPDATE`, [tenantId, workId]);
        const row = work.rows[0];
        if (!row) throw new Error("continuity_work_not_found");
        if (requestedProjectId && row.project_id !== requestedProjectId) throw new Error("nyra_autopilot_project_mismatch");
        const plan = compileNyraAutopilotPlan({ tenant_id: tenantId, project_id: row.project_id, work_id: workId,
          idea: row.idea, objective: row.objective, work: row.anchor || {} });
        const existing = await client.query(`SELECT tenant_id,work_id,run_id,project_id,architecture_version,intent_digest,plan,plan_digest,status
          FROM core_nyra_autopilot_runs WHERE tenant_id=$1 AND work_id=$2 AND architecture_version=$3 AND plan_digest=$4 FOR UPDATE`,
        [tenantId, workId, Number(row.current_version), plan.plan_digest]);
        if (existing.rows[0]) return { ...existing.rows[0], idempotent_replay: true };
        // A newer Work version invalidates every not-yet-submitted offer from
        // prior versions. Evidence remains in the ledger, but stale context
        // can never be claimed after an architecture change.
        await client.query(`UPDATE core_nyra_autopilot_assignments SET status='cancelled',updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2 AND status IN ('offered','claimed') AND run_id IN (
            SELECT run_id FROM core_nyra_autopilot_runs
            WHERE tenant_id=$1 AND work_id=$2 AND architecture_version<$3
          )`, [tenantId, workId, Number(row.current_version)]);
        await client.query(`UPDATE core_nyra_autopilot_runs SET status='cancelled',updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2 AND architecture_version<$3 AND status<>'cancelled'`,
        [tenantId, workId, Number(row.current_version)]);
        const runId = crypto.randomUUID();
        await client.query(`INSERT INTO core_nyra_autopilot_runs
          (tenant_id,work_id,run_id,project_id,trigger_type,architecture_version,intent_digest,plan,plan_digest,status,created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'pending',$10)`,
        [tenantId, workId, runId, row.project_id, triggerType, Number(row.current_version), row.intent_digest, JSON.stringify(plan), plan.plan_digest, actor(identity)]);
        await appendReceipt(client, tenantId, workId, "nyra_autopilot_planned", { run_id: runId, trigger_type: triggerType,
          architecture_version: Number(row.current_version), intent_digest: row.intent_digest, plan_digest: plan.plan_digest,
          selected_blueprint_ids: plan.required_roles.map((item) => item.blueprint_id), execution_authorized: false });
        return { tenant_id: tenantId, work_id: workId, run_id: runId, project_id: row.project_id, architecture_version: Number(row.current_version),
          intent_digest: row.intent_digest, plan, plan_digest: plan.plan_digest, status: "pending", idempotent_replay: false };
      });
      try {
        const materialized = await materializeRun(identity, run);
        return { tenant_id: tenantId, work_id: workId, run_id: run.run_id, status: "materialized", plan: run.plan,
          plan_digest: run.plan_digest, materialization: materialized.materialization, execution_authorized: false,
          idempotent_replay: run.idempotent_replay === true && materialized.idempotent_replay === true };
      } catch (error) {
        await transaction(async (client) => {
          await client.query(`UPDATE core_nyra_autopilot_runs SET status='blocked',updated_at=now()
            WHERE tenant_id=$1 AND work_id=$2 AND run_id=$3 AND status<>'materialized'`, [tenantId, workId, run.run_id]);
          await appendReceipt(client, tenantId, workId, "nyra_autopilot_blocked", { run_id: run.run_id, code: text(error?.message || "nyra_autopilot_materialization_failed", 160) });
        });
        return { tenant_id: tenantId, work_id: workId, run_id: run.run_id, status: "deferred", retryable: true,
          code: text(error?.message || "nyra_autopilot_materialization_failed", 160), execution_authorized: false };
      }
    },
    async readWork(identity, input = {}) {
      const tenantId = tenant(identity?.tenantId);
      const workId = uuid(input.work_id, "work_id");
      await initialize();
      const runs = await pool.query(`SELECT tenant_id,work_id,run_id,project_id,trigger_type,architecture_version,intent_digest,plan,plan_digest,status,created_at,updated_at
        FROM core_nyra_autopilot_runs WHERE tenant_id=$1 AND work_id=$2 ORDER BY architecture_version DESC,created_at DESC`, [tenantId, workId]);
      const assignments = await pool.query(`SELECT assignment_id,run_id,assignment_key,agent_instance_id,blueprint_id,role,task_contract,dependencies,eligible_client_types,status,claim_expires_at,submitted_result,quarantine
        FROM core_nyra_autopilot_assignments WHERE tenant_id=$1 AND work_id=$2 ORDER BY created_at,assignment_key`, [tenantId, workId]);
      return { schema_version: NYRA_AUTOPILOT_SCHEMA_VERSION, tenant_id: tenantId, work_id: workId,
        runs: runs.rows.map((row) => ({ ...row, execution_authorized: false })), assignments: assignments.rows.map(publicAssignment), execution_authorized: false };
    },
    async inbox(identity, input = {}) {
      const tenantId = tenant(identity?.tenantId);
      const claimant = presence(identity);
      const workId = input.work_id ? uuid(input.work_id, "work_id") : null;
      await initialize();
      const parameters = [tenantId, claimant.client_type];
      const predicate = ["tenant_id=$1", "status='offered'", "eligible_client_types ? $2"];
      if (workId) { parameters.push(workId); predicate.push(`work_id=$${parameters.length}`); }
      const result = await pool.query(`SELECT assignment_id,run_id,assignment_key,agent_instance_id,blueprint_id,role,task_contract,dependencies,eligible_client_types,status,claim_expires_at,submitted_result,quarantine
        FROM core_nyra_autopilot_assignments WHERE ${predicate.join(" AND ")} ORDER BY created_at,assignment_key LIMIT 50`, parameters);
      return { tenant_id: tenantId, agent_id: claimant.agent_id, assignments: result.rows.map(publicAssignment), execution_authorized: false };
    },
    async claim(identity, input = {}) {
      const tenantId = tenant(identity?.tenantId);
      const workId = uuid(input.work_id, "work_id");
      const assignmentId = uuid(input.assignment_id, "assignment_id");
      idempotency(input.idempotency_key);
      const claimant = presence(identity);
      const ttl = Math.min(Math.max(Number(input.ttl_seconds || 900), 60), 3_600);
      return transaction(async (client) => {
        await expireClaims(client, tenantId, workId);
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [tenantId, `nyra-assignment:${assignmentId}`]);
        const selected = await client.query(`SELECT a.*,r.plan FROM core_nyra_autopilot_assignments a JOIN core_nyra_autopilot_runs r
          ON r.tenant_id=a.tenant_id AND r.work_id=a.work_id AND r.run_id=a.run_id
          WHERE a.tenant_id=$1 AND a.work_id=$2 AND a.assignment_id=$3 FOR UPDATE`, [tenantId, workId, assignmentId]);
        const row = selected.rows[0];
        if (!row) throw new Error("nyra_assignment_not_found");
        if (!Array.isArray(row.eligible_client_types) || !row.eligible_client_types.includes(claimant.client_type)) throw new Error("nyra_assignment_client_type_denied");
        if (row.status === "claimed") {
          if (row.claimed_presence_signature !== claimant.signature || row.claimed_agent_id !== claimant.agent_id) throw new Error("nyra_assignment_claimed_by_other");
          return { tenant_id: tenantId, work_id: workId, assignment: publicAssignment(row), idempotent_replay: true, execution_authorized: false };
        }
        if (row.status !== "offered") throw new Error("nyra_assignment_not_claimable");
        const all = await client.query(`SELECT assignment_key,status FROM core_nyra_autopilot_assignments WHERE tenant_id=$1 AND work_id=$2 AND run_id=$3 FOR UPDATE`, [tenantId, workId, row.run_id]);
        const states = new Map(all.rows.map((item) => [item.assignment_key, item.status]));
        if ((row.dependencies || []).some((dependency) => !["submitted", "verified"].includes(states.get(dependency)))) throw new Error("nyra_assignment_dependency_not_ready");
        if (all.rows.filter((item) => item.status === "claimed").length >= Number(row.plan?.activation?.max_parallel || 2)) throw new Error("nyra_assignment_parallel_limit_reached");
        const expiresAt = new Date(Date.now() + ttl * 1_000).toISOString();
        const updated = await client.query(`UPDATE core_nyra_autopilot_assignments SET status='claimed',claimed_agent_id=$4,claimed_client_type=$5,
          claimed_presence_signature=$6,claimed_session_fingerprint=$7,claim_expires_at=$8,updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2 AND assignment_id=$3 RETURNING *`, [tenantId, workId, assignmentId, claimant.agent_id,
          claimant.client_type, claimant.signature, claimant.session_fingerprint, expiresAt]);
        const receipt = await appendReceipt(client, tenantId, workId, "nyra_assignment_claimed", { assignment_id: assignmentId,
          assignment_key: row.assignment_key, agent_id: claimant.agent_id, client_type: claimant.client_type, expires_at: expiresAt, execution_authorized: false });
        return { tenant_id: tenantId, work_id: workId, assignment: publicAssignment(updated.rows[0]), receipt, execution_authorized: false };
      });
    },
    async submit(identity, input = {}, { validateSubmission = null } = {}) {
      const tenantId = tenant(identity?.tenantId);
      const workId = uuid(input.work_id, "work_id");
      const assignmentId = uuid(input.assignment_id, "assignment_id");
      idempotency(input.idempotency_key);
      const claimant = presence(identity);
      const body = input.result && typeof input.result === "object" && !Array.isArray(input.result) ? input.result : null;
      if (!body) throw new Error("nyra_assignment_result_invalid");
      return transaction(async (client) => {
        await expireClaims(client, tenantId, workId);
        const selected = await client.query(`SELECT * FROM core_nyra_autopilot_assignments WHERE tenant_id=$1 AND work_id=$2 AND assignment_id=$3 FOR UPDATE`,
          [tenantId, workId, assignmentId]);
        const row = selected.rows[0];
        if (!row) throw new Error("nyra_assignment_not_found");
        if (row.status === "submitted" && row.claimed_presence_signature === claimant.signature) return { tenant_id: tenantId, work_id: workId, assignment: publicAssignment(row), idempotent_replay: true, execution_authorized: false };
        if (row.status !== "claimed" || row.claimed_presence_signature !== claimant.signature || row.claimed_agent_id !== claimant.agent_id) throw new Error("nyra_assignment_submission_denied");
        const guarded = guardInterAgentEnvelope({ tenant_id: tenantId, from_agent_id: claimant.agent_id, to_agent_id: row.blueprint_id,
          from_agent_signature: claimant.signature, from_client_type: claimant.client_type, thread_id: row.assignment_id, body });
        if (!guarded.allowed) {
          const quarantined = await client.query(`UPDATE core_nyra_autopilot_assignments SET status='quarantined',quarantine=$4::jsonb,updated_at=now()
            WHERE tenant_id=$1 AND work_id=$2 AND assignment_id=$3 RETURNING *`, [tenantId, workId, assignmentId, JSON.stringify(guarded.quarantine)]);
          const receipt = await appendReceipt(client, tenantId, workId, "nyra_assignment_quarantined", { assignment_id: assignmentId, quarantine: guarded.quarantine });
          return { tenant_id: tenantId, work_id: workId, assignment: publicAssignment(quarantined.rows[0]), receipt, execution_authorized: false };
        }
        const serialized = JSON.stringify(guarded.value);
        if (Buffer.byteLength(serialized) > 100_000) throw new Error("nyra_assignment_result_too_large");
        // The Runtime owns persistence, but Nyra's Work projection owns the
        // semantic acceptance contract.  Invoke that server-supplied check
        // before committing a verifier result so an invalid verdict cannot
        // leave an irreversible `submitted` assignment behind.
        if (typeof validateSubmission === "function") {
          await validateSubmission({
            tenant_id: tenantId,
            work_id: workId,
            assignment: {
              ...publicAssignment(row),
              claimed_agent_id: row.claimed_agent_id,
              claimed_session_fingerprint: row.claimed_session_fingerprint,
            },
            result: guarded.value,
          });
        }
        const updated = await client.query(`UPDATE core_nyra_autopilot_assignments SET status='submitted',submitted_result=$4::jsonb,updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2 AND assignment_id=$3 RETURNING *`, [tenantId, workId, assignmentId, serialized]);
        const receipt = await appendReceipt(client, tenantId, workId, "nyra_assignment_submitted", { assignment_id: assignmentId,
          assignment_key: row.assignment_key, result_digest: digest(guarded.value), execution_authorized: false });
        return { tenant_id: tenantId, work_id: workId, assignment: publicAssignment(updated.rows[0]), receipt, execution_authorized: false };
      });
    },
  };
  return runtime;
}
