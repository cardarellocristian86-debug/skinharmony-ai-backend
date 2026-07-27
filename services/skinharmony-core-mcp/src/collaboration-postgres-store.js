import crypto from "node:crypto";
import { redactMemoryText } from "./cloud-memory-store.js";
import { publicQuarantineReceipt, scanInterAgentHandoff } from "../../shared/handoff-injection-guard.mjs";
import { createCollaborationPostgresPool } from "./collaboration-postgres-pool.js";
import { consumeCollaborationReceipt } from "./collaboration-receipt.js";

const TTL_MS = 5 * 60 * 1_000;
const TASK_STATUSES = new Set(["open", "claimed", "in_progress", "blocked", "completed", "cancelled"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const id = (value, name) => {
  const result = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(result)) throw new Error(`${name}_invalid`);
  return result;
};
const text = (value, name, max = 20_000) => {
  const result = String(value || "").trim();
  if (!result || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) throw new Error(`${name}_invalid`);
  return redactMemoryText(result).text;
};
const optionalText = (value, name, max = 20_000) => value === undefined || value === null || value === "" ? "" : text(value, name, max);
const uuid = (value, name) => {
  const normalized = String(value || "").trim();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(normalized)) throw new Error(`${name}_invalid`);
  return normalized;
};
const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;
const requestDigest = (value) => crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const idempotencyKeyDigest = (value) => {
  const normalized = String(value || "").trim();
  return normalized ? crypto.createHash("sha256").update(normalized).digest("hex") : null;
};
const publicTask = (row) => {
  const { request_sha256: _requestSha, created: _created, ...safe } = row || {};
  return safe;
};
const publicMessage = (row) => {
  const { request_sha256: _requestSha, created: _created, ...safe } = row || {};
  return safe;
};
const result = (payload) => ({ structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] });
const governanceTrace = (identity) => {
  const value = String(identity?.governanceContext?.trace_id || "");
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
    ? value
    : null;
};
const actorSubject = (identity) => {
  const value = String(identity?.subject || identity?.kind || "").trim();
  if (!value || value.length > 500 || /[\u0000-\u001f]/.test(value)) throw new Error("actor_subject_invalid");
  return value;
};

function boundedCollaborationAction(action) {
  return {
    ...action,
    external_side_effect: false,
    contains_customer_data: false,
    contains_secret: false,
    secret_value_transmitted: false,
    cross_tenant: false,
    configuration_changes: false,
    destructive: false,
    bypass_orchestrator: false,
    provider_execution: false,
    bounded_scope: true,
    low_impact: true,
    idempotent_or_compensable: true,
    rollback_ready: false,
    audit_ready: true,
    target_authority_verified: true,
    actor_authorized_for_target: true,
    ...action,
  };
}

export const COLLABORATION_AGENT_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS agent_sessions (tenant_id varchar(64) NOT NULL, session_id varchar(240) NOT NULL, agent_id varchar(64) NOT NULL, actor_subject text NOT NULL, session_fingerprint varchar(64), trace_id uuid NOT NULL DEFAULT gen_random_uuid(), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, session_id));
    CREATE TABLE IF NOT EXISTS agent_presence (tenant_id varchar(64) NOT NULL, agent_id varchar(64) NOT NULL, actor_subject text NOT NULL, signature text NOT NULL, client_type varchar(32) NOT NULL, display_name text NOT NULL, capabilities jsonb NOT NULL DEFAULT '[]'::jsonb, last_seen_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, version integer NOT NULL DEFAULT 1, PRIMARY KEY (tenant_id, agent_id));
    CREATE TABLE IF NOT EXISTS agent_messages (tenant_id varchar(64) NOT NULL, id uuid NOT NULL, thread_id varchar(80) NOT NULL, from_agent_id varchar(64) NOT NULL, to_agent_id varchar(64) NOT NULL, body text NOT NULL, idempotency_key varchar(120), request_sha256 char(64), trace_id uuid NOT NULL DEFAULT gen_random_uuid(), correlation_id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, from_agent_id, idempotency_key));
    CREATE TABLE IF NOT EXISTS agent_message_quarantines (tenant_id varchar(64) NOT NULL, id uuid NOT NULL, thread_id varchar(80), from_agent_id varchar(64) NOT NULL, to_agent_id varchar(64) NOT NULL, content_digest varchar(64) NOT NULL, scanner_version varchar(80) NOT NULL, matched_rules jsonb NOT NULL DEFAULT '[]'::jsonb, provenance jsonb NOT NULL DEFAULT '{}'::jsonb, idempotency_key varchar(120), request_sha256 char(64), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, from_agent_id, idempotency_key));
    CREATE TABLE IF NOT EXISTS agent_message_deliveries (tenant_id varchar(64) NOT NULL, message_id uuid NOT NULL, agent_id varchar(64) NOT NULL, state varchar(20) NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz, PRIMARY KEY (tenant_id, message_id, agent_id));
    CREATE TABLE IF NOT EXISTS agent_tasks (tenant_id varchar(64) NOT NULL, id uuid NOT NULL, title text NOT NULL, description text NOT NULL DEFAULT '', priority varchar(20) NOT NULL, status varchar(20) NOT NULL DEFAULT 'open', claimed_by varchar(64), version integer NOT NULL DEFAULT 1, idempotency_key varchar(120), request_sha256 char(64), last_note text NOT NULL DEFAULT '', last_note_at timestamptz, last_note_by varchar(64), trace_id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, idempotency_key));
    CREATE SEQUENCE IF NOT EXISTS agent_task_fencing_seq AS bigint NO CYCLE;
    CREATE TABLE IF NOT EXISTS agent_task_leases (tenant_id varchar(64) NOT NULL, task_id uuid NOT NULL, agent_id varchar(64) NOT NULL, lease_token uuid NOT NULL DEFAULT gen_random_uuid(), owner_session_fingerprint varchar(64), owner_signature text, fencing_token bigint NOT NULL DEFAULT nextval('agent_task_fencing_seq'), expires_at timestamptz NOT NULL, renewed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, task_id));
    CREATE TABLE IF NOT EXISTS agent_handoffs (tenant_id varchar(64) NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), from_agent_id varchar(64) NOT NULL, to_agent_id varchar(64), summary text NOT NULL, trace_id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, id));
    CREATE TABLE IF NOT EXISTS agent_events (tenant_id varchar(64) NOT NULL, id bigserial NOT NULL, event_type varchar(80) NOT NULL, trace_id uuid, correlation_id uuid, actor_agent_id varchar(64), metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id,id));
    CREATE INDEX IF NOT EXISTS agent_presence_tenant_expiry_idx ON agent_presence (tenant_id, expires_at);
    CREATE INDEX IF NOT EXISTS agent_messages_inbox_idx ON agent_messages (tenant_id, to_agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS agent_tasks_tenant_status_idx ON agent_tasks (tenant_id, status, updated_at DESC);
    ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS session_fingerprint varchar(64);
    ALTER TABLE agent_presence ADD COLUMN IF NOT EXISTS session_fingerprint varchar(64);
    ALTER TABLE agent_messages ADD COLUMN IF NOT EXISTS request_sha256 char(64);
    ALTER TABLE agent_message_quarantines ADD COLUMN IF NOT EXISTS request_sha256 char(64);
    ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS request_sha256 char(64);
    ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS last_note text NOT NULL DEFAULT '';
    ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS last_note_at timestamptz;
    ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS last_note_by varchar(64);
    ALTER TABLE agent_task_leases ADD COLUMN IF NOT EXISTS owner_session_fingerprint varchar(64);
    ALTER TABLE agent_task_leases ADD COLUMN IF NOT EXISTS owner_signature text;
    ALTER TABLE agent_task_leases ADD COLUMN IF NOT EXISTS fencing_token bigint;
    ALTER TABLE agent_task_leases ALTER COLUMN fencing_token SET DEFAULT nextval('agent_task_fencing_seq');
    UPDATE agent_task_leases SET fencing_token=nextval('agent_task_fencing_seq') WHERE fencing_token IS NULL;
    ALTER TABLE agent_task_leases ALTER COLUMN fencing_token SET NOT NULL;
  `;

export function createCollaborationPostgresStore(config, options = {}) {
  const govern = options.govern;
  const pool = createCollaborationPostgresPool(config, options);
  if (!pool) return null;
  const ownsPool = !options.pool;
  const idempotencyRequired = config.collaborationIdempotencyRequired !== false;
  const collaborationReceiptVerifier = options.collaborationReceiptVerifier;
  const receiptEnforcement = config.collaborationReceiptEnforcement === true;
  let ready;
  const initialize = () => ready ||= options.schemaReady
    ? Promise.resolve(options.schemaReady)
    : pool.query(COLLABORATION_AGENT_SCHEMA_SQL);
  const event = async (client, identity, action, metadata = {}) => {
    const governance = identity?.governanceContext || {};
    return client.query(
      `INSERT INTO agent_events (tenant_id,event_type,trace_id,actor_agent_id,metadata)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        identity.tenantId,
        action.action_type,
        governanceTrace(identity),
        identity.agentPresence?.agent_id || null,
        JSON.stringify({
          ...metadata,
          target: action.target || null,
          payload_sha256: action.payload_sha256 || null,
          preflight_id: governance.preflight_id || null,
          task_contract_id: governance.task_contract_id || null,
          task_trace_id: governance.task_trace_id || null,
          coordination_lock: governance.coordination_lock || null,
          shared_memory_checksum: governance.shared_memory_checksum || null,
        }),
      ],
    );
  };
  const tenantTransaction = (client, tenantId) => client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`skinharmony-mcp-collaboration:${tenantId}`],
  );
  const governed = async (identity, requestedAction, callback) => {
    const action = boundedCollaborationAction(requestedAction);
    if (receiptEnforcement && !collaborationReceiptVerifier?.ready) throw new Error("collaboration_signed_receipt_verifier_required");
    if (typeof govern !== "function") throw new Error("governance_unavailable");
    const gate = await govern(action, identity);
    if (!gate?.allowed) throw new Error("core_gate_denied");
    const receiptEvidence = receiptEnforcement
      ? await collaborationReceiptVerifier.verify(gate.coordination_receipt, { config, action, identity })
      : null;
    await initialize();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (receiptEnforcement) await tenantTransaction(client, identity.tenantId);
      const receiptAudit = receiptEnforcement
        ? await consumeCollaborationReceipt(client, identity, receiptEvidence)
        : null;
      const payload = await callback(client);
      await event(client, identity, action, receiptAudit ? { collaboration_receipt: receiptAudit } : {});
      await client.query("COMMIT");
      return result({
        ...payload,
        gate: {
          allowed: true,
          decision: gate.decision,
          mediation: gate.mediation,
          confirmation_satisfied: gate.confirmation_satisfied === true,
        },
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  };
  const boundPresence = (args, identity) => {
    const presence = identity.agentPresence;
    if (!presence?.signature || !presence?.session_fingerprint || !presence?.agent_id) throw new Error("agent_presence_required");
    const requestedAgentId = args.agent_id || args.from_agent_id;
    if (requestedAgentId && requestedAgentId !== presence.agent_id) throw new Error("agent_presence_conflict");
    return presence;
  };
  const requireOwnedPresence = async (client, args, identity) => {
    const presence = boundPresence(args, identity);
    const row = await client.query(
      `SELECT 1 FROM agent_presence
       WHERE tenant_id=$1 AND agent_id=$2 AND actor_subject=$3
         AND signature=$4 AND session_fingerprint=$5 AND expires_at>now()`,
      [identity.tenantId, presence.agent_id, actorSubject(identity), presence.signature, presence.session_fingerprint],
    );
    if (!row.rowCount) throw new Error("agent_not_registered");
    return presence;
  };
  return {
    async heartbeat(args, identity) {
      const agentId = id(args.agent_id, "agent");
      const sessionId = String(args.session_id || "").slice(0, 240);
      if (!sessionId) throw new Error("session_id_invalid");
      const bound = boundPresence(args, identity);
      if (bound.agent_id !== agentId) throw new Error("agent_presence_conflict");
      const displayName = optionalText(args.display_name, "display_name", 120) || agentId;
      if (!Array.isArray(args.capabilities || [])) throw new Error("capabilities_invalid");
      const capabilities = [...new Set((args.capabilities || []).map((value) => id(value, "capability")))].slice(0, 20);
      const clientType = bound.client_type || args.client_type || "other";
      const digest = requestDigest({ agent_id: agentId, session_id: sessionId, client_type: clientType, display_name: displayName, capabilities });
      const customMetadata = displayName !== agentId || capabilities.length > 0;
      return governed(identity, {
        action_type: "agent.heartbeat",
        ...(customMetadata ? { operation_class: "owner_confirmed_governed_action", contains_customer_data: true } : {}),
        action_label: `Register agent ${agentId}`,
        target: agentId,
        payload_sha256: digest,
      }, async (client) => {
        const expires = new Date(Date.now() + TTL_MS);
        const actor = actorSubject(identity);
        const session = await client.query(
          `INSERT INTO agent_sessions (tenant_id,session_id,agent_id,actor_subject,session_fingerprint,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (tenant_id,session_id) DO UPDATE
             SET agent_id=EXCLUDED.agent_id,actor_subject=EXCLUDED.actor_subject,
                 session_fingerprint=EXCLUDED.session_fingerprint,
                 expires_at=EXCLUDED.expires_at,updated_at=now()
             WHERE (agent_sessions.agent_id=EXCLUDED.agent_id
                    AND agent_sessions.actor_subject=EXCLUDED.actor_subject
                    AND (agent_sessions.session_fingerprint IS NULL
                         OR agent_sessions.session_fingerprint=EXCLUDED.session_fingerprint))
                OR agent_sessions.expires_at<=now()
           RETURNING session_id`,
          [identity.tenantId, sessionId, agentId, actor, bound.session_fingerprint, expires],
        );
        if (!session.rowCount) throw new Error("agent_session_conflict");
        const row = await client.query(
          `INSERT INTO agent_presence
             (tenant_id,agent_id,actor_subject,signature,session_fingerprint,client_type,display_name,capabilities,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
           ON CONFLICT (tenant_id,agent_id) DO UPDATE SET
             signature=EXCLUDED.signature,session_fingerprint=EXCLUDED.session_fingerprint,
             client_type=EXCLUDED.client_type,display_name=EXCLUDED.display_name,
             capabilities=EXCLUDED.capabilities,last_seen_at=now(),expires_at=EXCLUDED.expires_at,
             version=agent_presence.version+1
           WHERE agent_presence.actor_subject=EXCLUDED.actor_subject
             AND (agent_presence.session_fingerprint IS NULL
                  OR agent_presence.session_fingerprint=EXCLUDED.session_fingerprint
                  OR agent_presence.expires_at<=now())
           RETURNING agent_id,signature,session_fingerprint,client_type,display_name,capabilities,last_seen_at,expires_at,version`,
          [identity.tenantId, agentId, actor, bound.signature, bound.session_fingerprint, clientType, displayName, JSON.stringify(capabilities), expires],
        );
        if (!row.rows[0]) throw new Error("agent_identity_conflict");
        return { agent: { ...row.rows[0], id: row.rows[0].agent_id, active: true, status: "online" }, agent_id: agentId };
      });
    },
    async listAgents(identity) {
      await initialize();
      const rows = await pool.query("SELECT agent_id,client_type,display_name,capabilities,last_seen_at,expires_at,version, CASE WHEN expires_at > now() THEN 'online' ELSE 'offline' END AS status FROM agent_presence WHERE tenant_id=$1 ORDER BY last_seen_at DESC", [identity.tenantId]);
      return result({ agents: rows.rows.map((row) => ({ ...row, id: row.agent_id, active: row.status === "online" })) });
    },
    async createTask(args, identity) {
      const title = text(args.title, "task_title", 240);
      const description = optionalText(args.description, "task_description", 20_000);
      const priority = String(args.priority || "normal");
      if (!PRIORITIES.has(priority)) throw new Error("task_priority_invalid");
      const key = optionalText(args.idempotency_key, "idempotency_key", 120) || null;
      if (idempotencyRequired && !key) throw new Error("idempotency_key_required");
      const digest = requestDigest({ title, description, priority });
      return governed(identity, {
        action_type: "task.create",
        operation_class: "owner_confirmed_governed_action",
        contains_customer_data: true,
        action_label: `Create shared task ${title}`,
        target: title,
        payload_sha256: digest,
        idempotency_key_sha256: idempotencyKeyDigest(key),
      }, async (client) => {
        await requireOwnedPresence(client, args, identity);
        const taskId = crypto.randomUUID();
        const traceId = governanceTrace(identity) || crypto.randomUUID();
        const row = await client.query(
          `INSERT INTO agent_tasks (tenant_id,id,title,description,priority,idempotency_key,request_sha256,trace_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (tenant_id,idempotency_key) DO UPDATE SET id=agent_tasks.id
           RETURNING *,(id=$2) AS created`,
          [identity.tenantId, taskId, title, description, priority, key, digest, traceId],
        );
        if (key && row.rows[0].request_sha256 !== digest) throw new Error("idempotency_key_reused");
        const created = row.rows[0].created === true;
        return { task: publicTask(row.rows[0]), created, idempotent_replay: !created };
      });
    },
    async listTasks(args, identity) {
      await initialize();
      const status = args.status ? String(args.status) : null;
      if (status && !TASK_STATUSES.has(status)) throw new Error("task_status_invalid");
      const rows = await pool.query("SELECT * FROM agent_tasks WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY updated_at DESC LIMIT $3", [identity.tenantId, status, Math.min(Math.max(Number(args.limit) || 50, 1), 100)]);
      return result({ tasks: rows.rows.map(publicTask) });
    },
    async claimTask(args, identity) {
      const taskId = uuid(args.task_id, "task_id");
      const agentId = id(args.agent_id, "agent");
      const digest = requestDigest({ task_id: taskId, agent_id: agentId, expected_version: Number(args.expected_version) });
      return governed(identity, {
        action_type: "task.claim",
        action_label: `Claim shared task ${taskId}`,
        target: taskId,
        payload_sha256: digest,
        expected_version: Number(args.expected_version),
      }, async (client) => {
        const presence = await requireOwnedPresence(client, args, identity);
        const competingLease = await client.query(
          `SELECT task_id
           FROM agent_task_leases
           WHERE tenant_id=$1 AND agent_id=$2 AND task_id<>$3
             AND owner_session_fingerprint=$4 AND owner_signature=$5
             AND expires_at>now()
           LIMIT 1
           FOR UPDATE`,
          [identity.tenantId, agentId, taskId, presence.session_fingerprint, presence.signature],
        );
        if (competingLease.rowCount) throw new Error("task_agent_active_lease_conflict");
        const row = await client.query(
          `UPDATE agent_tasks SET claimed_by=$3,status=CASE WHEN status='open' THEN 'claimed' ELSE status END,version=version+1,updated_at=now()
           WHERE tenant_id=$1 AND id=$2 AND version=$4
             AND status NOT IN ('completed','cancelled')
             AND (claimed_by IS NULL OR claimed_by=$3 OR NOT EXISTS (
               SELECT 1 FROM agent_task_leases lease
               WHERE lease.tenant_id=$1 AND lease.task_id=$2 AND lease.expires_at>now()
             ))
           RETURNING *`,
          [identity.tenantId, taskId, agentId, Number(args.expected_version)],
        );
        if (!row.rowCount) throw new Error("task_claim_conflict");
        const lease = await client.query(
          `INSERT INTO agent_task_leases
             (tenant_id,task_id,agent_id,owner_session_fingerprint,owner_signature,expires_at)
           VALUES ($1,$2,$3,$4,$5,now()+interval '5 minutes')
           ON CONFLICT (tenant_id,task_id) DO UPDATE SET
             agent_id=EXCLUDED.agent_id,owner_session_fingerprint=EXCLUDED.owner_session_fingerprint,
             owner_signature=EXCLUDED.owner_signature,lease_token=gen_random_uuid(),
             fencing_token=nextval('agent_task_fencing_seq'),expires_at=EXCLUDED.expires_at,renewed_at=now()
           WHERE agent_task_leases.expires_at<=now()
              OR (agent_task_leases.agent_id=EXCLUDED.agent_id
                  AND agent_task_leases.owner_session_fingerprint=EXCLUDED.owner_session_fingerprint
                  AND agent_task_leases.owner_signature=EXCLUDED.owner_signature)
           RETURNING lease_token,fencing_token,expires_at`,
          [identity.tenantId, taskId, agentId, presence.session_fingerprint, presence.signature],
        );
        if (!lease.rowCount) throw new Error("task_lease_conflict");
        return { task: publicTask(row.rows[0]), lease: lease.rows[0] };
      });
    },
    async updateTask(args, identity) {
      const taskId = uuid(args.task_id, "task_id");
      const agentId = id(args.agent_id, "agent");
      const status = String(args.status);
      if (!["claimed", "in_progress", "blocked", "completed", "cancelled"].includes(status)) throw new Error("task_status_invalid");
      const leaseToken = String(args.lease_token || "");
      const fencingToken = Number(args.fencing_token);
      if (!/^[a-f0-9-]{36}$/i.test(leaseToken) || !Number.isSafeInteger(fencingToken) || fencingToken < 1) throw new Error("task_lease_required");
      const note = optionalText(args.note, "task_note", 10_000);
      const digest = requestDigest({ task_id: taskId, agent_id: agentId, status, lease_token: leaseToken, fencing_token: fencingToken, expected_version: Number(args.expected_version), note });
      return governed(identity, {
        action_type: "task.update",
        ...(note ? { operation_class: "owner_confirmed_governed_action", contains_customer_data: true } : {}),
        action_label: `Update shared task ${taskId} to ${status}`,
        target: taskId,
        payload_sha256: digest,
        expected_version: Number(args.expected_version),
        lock_id: leaseToken,
        fencing_token: fencingToken,
      }, async (client) => {
        const presence = await requireOwnedPresence(client, args, identity);
        const lease = await client.query(
          `SELECT 1 FROM agent_task_leases
           WHERE tenant_id=$1 AND task_id=$2 AND agent_id=$3 AND lease_token=$4
             AND fencing_token=$5 AND owner_session_fingerprint=$6 AND owner_signature=$7
             AND expires_at>now() FOR UPDATE`,
          [identity.tenantId, taskId, agentId, leaseToken, fencingToken, presence.session_fingerprint, presence.signature],
        );
        if (!lease.rowCount) throw new Error("task_lease_stale_or_not_owned");
        const row = await client.query(
          `UPDATE agent_tasks
           SET status=$4,version=version+1,updated_at=now(),
               last_note=CASE WHEN $6='' THEN last_note ELSE $6 END,last_note_at=CASE WHEN $6='' THEN last_note_at ELSE now() END,
               last_note_by=CASE WHEN $6='' THEN last_note_by ELSE $3 END
           WHERE tenant_id=$1 AND id=$2 AND claimed_by=$3 AND version=$5 RETURNING *`,
          [identity.tenantId, taskId, agentId, status, Number(args.expected_version), note],
        );
        if (!row.rowCount) throw new Error("task_version_or_owner_conflict");
        const terminal = ["completed", "cancelled"].includes(status);
        const renewed = await client.query(
          `UPDATE agent_task_leases
           SET expires_at=CASE WHEN $8::boolean THEN now() ELSE now()+interval '5 minutes' END,renewed_at=now()
           WHERE tenant_id=$1 AND task_id=$2 AND agent_id=$3 AND lease_token=$4
             AND fencing_token=$5 AND owner_session_fingerprint=$6 AND owner_signature=$7
           RETURNING lease_token,fencing_token,expires_at`,
          [identity.tenantId, taskId, agentId, leaseToken, fencingToken, presence.session_fingerprint, presence.signature, terminal],
        );
        return { task: publicTask(row.rows[0]), lease: renewed.rows[0] };
      });
    },
    async postMessage(args, identity) {
      const sender = id(args.from_agent_id, "agent");
      const recipient = args.to_agent_id === "all" ? "all" : id(args.to_agent_id, "agent");
      const rawBody = String(args.body || "").trim();
      if (!rawBody || rawBody.length > 20_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(rawBody)) {
        throw new Error("message_body_invalid");
      }
      const body = redactMemoryText(rawBody).text;
      const key = optionalText(args.idempotency_key, "idempotency_key", 120) || null;
      if (idempotencyRequired && !key) throw new Error("idempotency_key_required");
      const requestedThread = optionalText(args.thread_id, "thread_id", 80);
      const threadId = requestedThread || crypto.randomUUID();
      const digest = requestDigest({ sender, recipient, body: rawBody, thread_id: requestedThread || null });
      const scan = scanInterAgentHandoff({
        tenant_id: identity.tenantId,
        from_agent_id: sender,
        to_agent_id: recipient,
        from_agent_signature: identity.agentPresence?.signature,
        from_client_type: identity.agentPresence?.client_type,
        thread_id: threadId,
        body: rawBody,
      });
      return governed(identity, {
        action_type: "message.post",
        operation_class: "owner_confirmed_governed_action",
        contains_customer_data: true,
        action_label: `Post agent message from ${sender} to ${recipient}`,
        target: recipient,
        payload_sha256: digest,
        idempotency_key_sha256: idempotencyKeyDigest(key),
      }, async (client) => {
        await requireOwnedPresence(client, args, identity);
        if (recipient !== "all") {
          const registered = await client.query("SELECT 1 FROM agent_presence WHERE tenant_id=$1 AND agent_id=$2 AND expires_at>now()", [identity.tenantId, recipient]);
          if (!registered.rowCount) throw new Error("recipient_not_registered");
        }
        if (key) {
          const existingQuarantine = await client.query(
            `SELECT id,content_digest,scanner_version,matched_rules,provenance,request_sha256,created_at
             FROM agent_message_quarantines
             WHERE tenant_id=$1 AND from_agent_id=$2 AND idempotency_key=$3
             FOR UPDATE`,
            [identity.tenantId, sender, key],
          );
          if (existingQuarantine.rowCount) {
            const stored = existingQuarantine.rows[0];
            if (stored.request_sha256 && stored.request_sha256 !== digest) throw new Error("idempotency_key_reused");
            return {
              quarantined: true,
              created: false,
              quarantine: publicQuarantineReceipt({
                ...scan,
                content_digest: stored.content_digest,
                scanner_version: stored.scanner_version,
                matched_rules: stored.matched_rules,
                provenance: stored.provenance,
              }, {
                quarantine_id: stored.id,
                created_at: stored.created_at,
                idempotent_replay: true,
              }),
            };
          }
        }
        if (scan.suspicious) {
          if (key) {
            const existingMessage = await client.query(
              "SELECT request_sha256 FROM agent_messages WHERE tenant_id=$1 AND from_agent_id=$2 AND idempotency_key=$3 FOR UPDATE",
              [identity.tenantId, sender, key],
            );
            if (existingMessage.rowCount) throw new Error("idempotency_key_reused");
          }
          const quarantineId = crypto.randomUUID();
          const stored = await client.query(
            `INSERT INTO agent_message_quarantines
             (tenant_id,id,thread_id,from_agent_id,to_agent_id,content_digest,scanner_version,matched_rules,provenance,idempotency_key,request_sha256)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
             ON CONFLICT (tenant_id,from_agent_id,idempotency_key) DO NOTHING
             RETURNING id,content_digest,scanner_version,matched_rules,provenance,request_sha256,created_at,true AS created`,
            [
              identity.tenantId,
              quarantineId,
              threadId,
              sender,
              recipient,
              scan.content_digest,
              scan.scanner_version,
              JSON.stringify(scan.matched_rules),
              JSON.stringify(scan.provenance),
              key,
              digest,
            ],
          );
          const row = stored.rows[0] || (await client.query(
            `SELECT id,content_digest,scanner_version,matched_rules,provenance,request_sha256,created_at,
                    false AS created
             FROM agent_message_quarantines
             WHERE tenant_id=$1 AND from_agent_id=$2 AND idempotency_key=$3`,
            [identity.tenantId, sender, key],
          )).rows[0];
          if (!row) throw new Error("message_quarantine_conflict");
          if (key && row.request_sha256 !== digest) throw new Error("idempotency_key_reused");
          const created = row.created === true;
          return {
            quarantined: true,
            created,
            quarantine: publicQuarantineReceipt({
              ...scan,
              content_digest: row.content_digest || scan.content_digest,
              scanner_version: row.scanner_version || scan.scanner_version,
              matched_rules: row.matched_rules || scan.matched_rules,
              provenance: row.provenance || scan.provenance,
            }, {
              quarantine_id: row.id,
              created_at: row.created_at,
              idempotent_replay: !created,
            }),
          };
        }
        const messageId = crypto.randomUUID();
        const traceId = governanceTrace(identity) || crypto.randomUUID();
        const row = await client.query(
          `INSERT INTO agent_messages (tenant_id,id,thread_id,from_agent_id,to_agent_id,body,idempotency_key,request_sha256,trace_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (tenant_id,from_agent_id,idempotency_key) DO UPDATE SET id=agent_messages.id
           RETURNING *,(id=$2) AS created`,
          [identity.tenantId, messageId, threadId, sender, recipient, body, key, digest, traceId],
        );
        if (key && row.rows[0].request_sha256 !== digest) throw new Error("idempotency_key_reused");
        if (recipient !== "all") await client.query("INSERT INTO agent_message_deliveries (tenant_id,message_id,agent_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [identity.tenantId, row.rows[0].id, recipient]);
        const created = row.rows[0].created === true;
        return { message: publicMessage(row.rows[0]), created, idempotent_replay: !created };
      });
    },
    async inbox(args, identity) {
      const agentId = id(args.agent_id, "agent");
      await initialize();
      const client = await pool.connect();
      try {
        await requireOwnedPresence(client, args, identity);
        const rows = await client.query("SELECT m.*,coalesce(d.state,'pending') AS delivery_state,coalesce(d.attempts,0) AS attempts FROM agent_messages m LEFT JOIN agent_message_deliveries d ON d.tenant_id=m.tenant_id AND d.message_id=m.id AND d.agent_id=$2 WHERE m.tenant_id=$1 AND (m.to_agent_id=$2 OR m.to_agent_id='all') AND ($3::boolean=false OR coalesce(d.state,'pending')<>'acknowledged') ORDER BY m.created_at DESC LIMIT $4", [identity.tenantId, agentId, args.unread_only === true, Math.min(Math.max(Number(args.limit) || 50, 1), 100)]);
        return result({ messages: rows.rows.map(publicMessage) });
      } finally {
        client.release();
      }
    },
    async acknowledge(args, identity) {
      const agentId = id(args.agent_id, "agent");
      const messageId = uuid(args.message_id, "message_id");
      const digest = requestDigest({ message_id: messageId, agent_id: agentId });
      return governed(identity, { action_type: "message.acknowledge", action_label: `Acknowledge agent message ${messageId}`, target: messageId, payload_sha256: digest }, async (client) => {
        const presence = await requireOwnedPresence(client, args, identity);
        const message = await client.query("SELECT id,to_agent_id FROM agent_messages WHERE tenant_id=$1 AND id=$2 AND (to_agent_id=$3 OR to_agent_id='all') FOR UPDATE", [identity.tenantId, messageId, agentId]);
        if (!message.rowCount) throw new Error("message_not_found");
        await client.query("INSERT INTO agent_message_deliveries (tenant_id,message_id,agent_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [identity.tenantId, messageId, agentId]);
        const row = await client.query("UPDATE agent_message_deliveries SET state='acknowledged',acknowledged_at=coalesce(acknowledged_at,now()) WHERE tenant_id=$1 AND message_id=$2 AND agent_id=$3 RETURNING *", [identity.tenantId, messageId, agentId]);
        return { message_id: messageId, acknowledged_by: agentId, acknowledged_by_signature: presence.signature, delivery: row.rows[0] };
      });
    },
    initialize,
    close: () => ownsPool ? pool.end() : Promise.resolve(),
  };
}
