import crypto from "node:crypto";
import { Pool } from "pg";
import { redactMemoryText } from "./cloud-memory-store.js";

export const DECISION_LEDGER_SCHEMA_VERSION = "core_decision_ledger_v1";

const EVENT_TYPES = new Set([
  "work_received", "preflight_completed", "tool_completed", "tool_failed",
  "core_accepted_ai_proposal", "core_corrected_ai_proposal", "core_changed_decision",
  "core_denied_action", "core_hard_blocked_action", "core_deferred_decision",
  "core_requested_evidence", "core_requested_confirmation", "core_required_sandbox",
  "core_required_rollback", "core_fallback_applied", "core_parity_mismatch", "core_runtime_error",
  "confirmation_granted", "confirmation_denied", "capability_issued", "capability_denied",
  "capability_consumed", "execution_completed", "execution_failed", "execution_rolled_back",
  "outcome_submitted", "outcome_verified", "outcome_rejected", "decision_confirmed_correct",
  "decision_confirmed_wrong", "learning_proposed", "learning_approved", "learning_rejected",
]);

function tenant(value) {
  const id = String(value || "");
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(id)) throw new Error("tenant_invalid");
  return id;
}

function safeText(value, max = 2_000) {
  return redactMemoryText(String(value || "").replaceAll("\u0000", "")).text.slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function decisionPayload(result = {}) {
  const structured = result?.structuredContent || {};
  const contract = structured.decision_contract || structured.result?.decision_contract || structured.gate?.decision_contract || {};
  const gate = structured.authorization || structured.gate || structured.result?.authorization || {};
  const output = structured.output || structured.result?.output || {};
  const risk = contract.risk_classification || structured.risk_classification || output.risk || {};
  return { structured, contract, gate, output, risk };
}

export function classifyLedgerEvent(toolName, result, error) {
  if (error) return "tool_failed";
  if (toolName === "outcome_record") return result?.isError ? "outcome_rejected" : "outcome_verified";
  const { structured, contract, gate } = decisionPayload(result);
  const mediation = String(gate.mediation || structured.action_mediation?.state || contract.control_level || "");
  const state = String(gate.state || contract.state || structured.state || "");
  if (gate.allowed === true || gate.execution_allowed === true) return gate.confirmation_satisfied ? "confirmation_granted" : "core_accepted_ai_proposal";
  if (/hard_block|blocked/.test(mediation) || state === "blocked") return "core_hard_blocked_action";
  if (/rewrite/.test(mediation)) return "core_corrected_ai_proposal";
  if (/confirm|attention/.test(mediation) || contract.control_level === "confirm") return "core_requested_confirmation";
  if (/defer/.test(mediation)) return "core_deferred_decision";
  if (/sandbox/.test(mediation)) return "core_required_sandbox";
  if (/rollback/.test(mediation)) return "core_required_rollback";
  if (structured.ok === false || result?.isError) return "core_denied_action";
  return "tool_completed";
}

function extractDecisionMetadata(result = {}) {
  const { structured, contract, gate, output, risk } = decisionPayload(result);
  const reasonCodes = contract.blocked_reasons || risk.reason_codes || output.blocked_reasons || [];
  return {
    decision_id: structured.decision_id || structured.core_operational?.envelope?.decision_id || gate.decision_id || null,
    preflight_id: structured.work_preflight?.preflight_id || result?._meta?.["skinharmony/preflight_id"] || null,
    decision_state: gate.state || contract.state || structured.state || null,
    control_level: gate.control_level || contract.control_level || null,
    risk_band: risk.risk_band || risk.band || contract.risk_band || null,
    risk_score: Number.isFinite(Number(risk.risk_score ?? risk.score)) ? Number(risk.risk_score ?? risk.score) : null,
    execution_allowed: gate.allowed === true || gate.execution_allowed === true,
    reason_codes: Array.isArray(reasonCodes) ? reasonCodes.map((item) => safeText(item, 120)).slice(0, 30) : [],
    core_version: output.diagnostics?.core_version || structured.core_version || null,
    policy_version: contract.contract_version || structured.schema_version || null,
  };
}

const CREATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS core_ai_work_sessions (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  trace_id uuid NOT NULL,
  project_id varchar(64), session_id varchar(64), agent_id varchar(120),
  agent_type varchar(80), provider varchar(80), model varchar(160), client_application varchar(120),
  request_type varchar(120) NOT NULL, request_summary text NOT NULL,
  input_hash char(64) NOT NULL, status varchar(40) NOT NULL DEFAULT 'started',
  preflight_id varchar(120), decision_id varchar(120),
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  PRIMARY KEY (tenant_id, work_id)
);
CREATE INDEX IF NOT EXISTS core_ai_work_sessions_tenant_started_idx ON core_ai_work_sessions (tenant_id, started_at DESC);

CREATE TABLE IF NOT EXISTS core_decision_events (
  tenant_id varchar(64) NOT NULL, event_id uuid NOT NULL, work_id uuid NOT NULL,
  sequence_number bigint NOT NULL, event_type varchar(80) NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
  agent_id varchar(120), tool_name varchar(120), preflight_id varchar(120), decision_id varchar(120),
  core_version varchar(120), policy_version varchar(120), risk_band varchar(24), risk_score numeric(7,3),
  control_level varchar(40), decision_state varchar(80), execution_allowed boolean NOT NULL DEFAULT false,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb, reason_summary text NOT NULL DEFAULT '',
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_event_hash char(64), event_hash char(64) NOT NULL,
  PRIMARY KEY (tenant_id, event_id), UNIQUE (tenant_id, work_id, sequence_number),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_ai_work_sessions(tenant_id, work_id)
);
CREATE INDEX IF NOT EXISTS core_decision_events_tenant_time_idx ON core_decision_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS core_decision_events_tenant_type_idx ON core_decision_events (tenant_id, event_type, occurred_at DESC);

CREATE OR REPLACE FUNCTION core_decision_events_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'core_decision_events_append_only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS core_decision_events_no_mutation ON core_decision_events;
CREATE TRIGGER core_decision_events_no_mutation BEFORE UPDATE OR DELETE ON core_decision_events
FOR EACH ROW EXECUTE FUNCTION core_decision_events_append_only();

CREATE TABLE IF NOT EXISTS core_verified_outcomes (
  tenant_id varchar(64) NOT NULL, outcome_id varchar(120) NOT NULL, decision_id varchar(120), work_id uuid,
  actual_outcome boolean, predicted_probability numeric(8,6), verification_source varchar(120),
  verified_by varchar(120), lessons jsonb NOT NULL DEFAULT '[]'::jsonb, evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, outcome_id)
);

CREATE OR REPLACE VIEW core_decision_daily_metrics AS
SELECT tenant_id, date_trunc('day', occurred_at) AS day, count(*) AS event_count,
  count(*) FILTER (WHERE event_type='core_corrected_ai_proposal') AS corrections,
  count(*) FILTER (WHERE event_type IN ('core_denied_action','core_hard_blocked_action')) AS denials,
  count(*) FILTER (WHERE event_type='core_requested_confirmation') AS confirmations_requested,
  count(*) FILTER (WHERE event_type='confirmation_granted') AS confirmations_granted,
  count(*) FILTER (WHERE event_type='outcome_verified') AS verified_outcomes,
  count(*) FILTER (WHERE event_type='decision_confirmed_correct') AS confirmed_correct,
  count(*) FILTER (WHERE event_type='decision_confirmed_wrong') AS confirmed_wrong
FROM core_decision_events GROUP BY tenant_id, date_trunc('day', occurred_at);
`;

export function createDecisionLedger(config, options = {}) {
  if (!config.databaseUrl && !options.pool) return null;
  const pool = options.pool || new Pool({ connectionString: config.databaseUrl, ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined, max: config.databasePoolMax || 5 });
  let ready;
  const initialize = () => ready ||= pool.query(CREATE_SCHEMA_SQL);

  async function startWork(identity, toolName, args = {}) {
    await initialize();
    const tenantId = tenant(identity.tenantId);
    const workId = crypto.randomUUID();
    const traceId = crypto.randomUUID();
    const summary = safeText(args.request || args.message || args.action_label || args.question || args.title || `MCP ${toolName}`, 2_000);
    await pool.query(`INSERT INTO core_ai_work_sessions
      (tenant_id,work_id,trace_id,project_id,session_id,agent_id,agent_type,provider,model,client_application,request_type,request_summary,input_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [tenantId, workId, traceId, args.project_id || null, args.session_id || null, args.agent_id || identity.subject || "connected_ai",
      identity.kind || "connected_ai", identity.issuer || null, safeText(args.model, 160) || null, identity.clientId || null,
      safeText(toolName, 120), summary, hash({ toolName, args: stable(args), tenantId })]);
    const context = { tenantId, workId, traceId, toolName, agentId: args.agent_id || identity.subject || "connected_ai" };
    await append(context, "work_received", { reason_summary: summary, metadata: { input_redacted: true } });
    return context;
  }

  async function append(context, eventType, input = {}) {
    await initialize();
    if (!EVENT_TYPES.has(eventType)) throw new Error("decision_ledger_event_type_invalid");
    const client = typeof pool.connect === "function" ? await pool.connect() : pool;
    try {
      if (client.query !== pool.query) await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [context.tenantId, context.workId]);
      const previous = await client.query(`SELECT sequence_number,event_hash FROM core_decision_events
        WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`, [context.tenantId, context.workId]);
      const sequence = Number(previous.rows[0]?.sequence_number || 0) + 1;
      const occurredAt = new Date().toISOString();
      const payload = {
        tenant_id: context.tenantId, work_id: context.workId, sequence_number: sequence, event_type: eventType,
        occurred_at: occurredAt, tool_name: context.toolName, decision_id: input.decision_id || null,
        reason_codes: input.reason_codes || [], reason_summary: safeText(input.reason_summary, 2_000),
        preflight_id: input.preflight_id || null, core_version: input.core_version || null,
        policy_version: input.policy_version || null, risk_band: input.risk_band || null,
        risk_score: input.risk_score ?? null, control_level: input.control_level || null,
        decision_state: input.decision_state || null, execution_allowed: input.execution_allowed === true,
        evidence_refs: input.evidence_refs || [], metadata: input.metadata || {},
        previous_event_hash: previous.rows[0]?.event_hash || null,
      };
      const eventHash = hash(payload);
      await client.query(`INSERT INTO core_decision_events
        (tenant_id,event_id,work_id,sequence_number,event_type,occurred_at,agent_id,tool_name,preflight_id,decision_id,
         core_version,policy_version,risk_band,risk_score,control_level,decision_state,execution_allowed,reason_codes,
         reason_summary,evidence_refs,metadata,previous_event_hash,event_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20::jsonb,$21::jsonb,$22,$23)`,
      [context.tenantId, crypto.randomUUID(), context.workId, sequence, eventType, occurredAt, context.agentId, context.toolName,
        input.preflight_id || null, input.decision_id || null, input.core_version || null, input.policy_version || null,
        input.risk_band || null, input.risk_score ?? null, input.control_level || null, input.decision_state || null,
        input.execution_allowed === true, JSON.stringify(input.reason_codes || []), safeText(input.reason_summary, 2_000),
        JSON.stringify(input.evidence_refs || []), JSON.stringify(input.metadata || {}), payload.previous_event_hash, eventHash]);
      if (client.query !== pool.query) await client.query("COMMIT");
      return { schema_version: DECISION_LEDGER_SCHEMA_VERSION, work_id: context.workId, trace_id: context.traceId, sequence_number: sequence, event_type: eventType, event_hash: eventHash };
    } catch (error) {
      if (client.query !== pool.query) await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release?.(); }
  }

  async function finishWork(context, { result, error, preflight, args = {} } = {}) {
    const type = classifyLedgerEvent(context.toolName, result, error);
    const metadata = extractDecisionMetadata(result);
    metadata.preflight_id ||= preflight?.work_preflight?.preflight_id || preflight?.preflight_id || null;
    const event = await append(context, type, { ...metadata, reason_summary: error ? safeText(error.message, 500) : metadata.reason_codes.join(", "), metadata: { success: !error, response_content_stored: false } });
    if (type === "outcome_verified" && args.outcome_id) {
      const actual = args.actual_outcome === true || args.actual_outcome === "occurred";
      const probability = Number(args.predicted_probability);
      await pool.query(`INSERT INTO core_verified_outcomes
        (tenant_id,outcome_id,decision_id,work_id,actual_outcome,predicted_probability,verification_source,verified_by,lessons,evidence_refs)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb) ON CONFLICT (tenant_id,outcome_id) DO NOTHING`,
      [context.tenantId, safeText(args.outcome_id, 120), args.prediction_id || metadata.decision_id, context.workId, actual,
        Number.isFinite(probability) ? probability : null, "mcp_outcome_record", context.agentId,
        JSON.stringify(Array.isArray(args.lessons) ? args.lessons.map((item) => safeText(item, 1_000)).slice(0, 20) : []), "[]"]);
      if (Number.isFinite(probability)) {
        const predicted = probability >= 0.5;
        await append(context, predicted === actual ? "decision_confirmed_correct" : "decision_confirmed_wrong", {
          decision_id: args.prediction_id || metadata.decision_id,
          reason_summary: predicted === actual ? "verified_outcome_matches_prediction" : "verified_outcome_differs_from_prediction",
          metadata: { predicted_probability: probability, actual_outcome: actual },
        });
      }
    }
    await pool.query(`UPDATE core_ai_work_sessions SET status=$3, completed_at=now(), preflight_id=$4, decision_id=$5
      WHERE tenant_id=$1 AND work_id=$2`, [context.tenantId, context.workId, error ? "failed" : "completed", metadata.preflight_id, metadata.decision_id]);
    return event;
  }

  async function report(tenantId, days = 30) {
    await initialize();
    const result = await pool.query(`SELECT event_type,count(*)::integer AS count FROM core_decision_events
      WHERE tenant_id=$1 AND occurred_at >= now() - ($2::integer * interval '1 day') GROUP BY event_type ORDER BY event_type`, [tenant(tenantId), Math.min(Math.max(Number(days) || 30, 1), 365)]);
    const sessions = await pool.query(`SELECT count(*)::integer AS works, count(*) FILTER (WHERE status='completed')::integer AS completed
      FROM core_ai_work_sessions WHERE tenant_id=$1 AND started_at >= now() - ($2::integer * interval '1 day')`, [tenant(tenantId), Math.min(Math.max(Number(days) || 30, 1), 365)]);
    const events = Object.fromEntries(result.rows.map((row) => [row.event_type, row.count]));
    const completed = Number(sessions.rows[0]?.completed || 0);
    const corrections = Number(events.core_corrected_ai_proposal || 0);
    const denials = Number(events.core_denied_action || 0) + Number(events.core_hard_blocked_action || 0);
    const confirmations = Number(events.core_requested_confirmation || 0);
    const correct = Number(events.decision_confirmed_correct || 0);
    const wrong = Number(events.decision_confirmed_wrong || 0);
    const verified = correct + wrong;
    const percent = (value, total) => total ? Number(((value / total) * 100).toFixed(2)) : 0;
    return {
      schema_version: DECISION_LEDGER_SCHEMA_VERSION, tenant_id: tenantId, days,
      sessions: sessions.rows[0], events,
      metrics: {
        core_intervention_rate_percent: percent(corrections + denials + confirmations, completed),
        correction_rate_percent: percent(corrections, completed),
        denial_rate_percent: percent(denials, completed),
        confirmation_rate_percent: percent(confirmations, completed),
        verified_decision_accuracy_percent: percent(correct, verified),
        verified_decision_sample_size: verified,
      },
    };
  }

  return { initialize, startWork, append, finishWork, report, close: () => pool.end(), schemaSql: CREATE_SCHEMA_SQL };
}
