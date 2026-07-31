import crypto from "node:crypto";
import { Pool } from "pg";
import { redactMemoryText } from "./cloud-memory-store.js";
import { publicQuarantineReceipt, scanInterAgentHandoff } from "../../shared/handoff-injection-guard.mjs";

const TTL_MS = 5 * 60 * 1_000;
const id = (value, name) => {
  const result = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(result)) throw new Error(`${name}_invalid`);
  return result;
};
const text = (value, name, max = 20_000) => {
  const result = String(value || "").trim();
  if (!result || result.length > max || /[\u0000-\u001f]/.test(result)) throw new Error(`${name}_invalid`);
  return redactMemoryText(result).text;
};
const result = (payload) => ({ structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] });

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

async function requireOwnedAgentSession(client, identity, agentId) {
  const actorSubject = String(identity.subject || identity.kind || "unknown");
  const signature = String(identity.agentPresence?.signature || "");
  const fingerprint = String(identity.agentPresence?.session_fingerprint || "");
  if (!signature || !fingerprint) throw new Error("agent_presence_session_required");
  const owned = await client.query(
    "SELECT agent_id,signature,session_fingerprint,client_type FROM agent_presence WHERE tenant_id=$1 AND agent_id=$2 AND actor_subject=$3 AND signature=$4 AND session_fingerprint=$5 AND expires_at>now()",
    [identity.tenantId, agentId, actorSubject, signature, fingerprint]
  );
  if (!owned.rowCount) throw new Error("agent_not_registered");
  return owned.rows[0];
}

export function createCollaborationPostgresStore(config, options = {}) {
  if (!config.collaborationDatabaseUrl) return null;
  const { govern, pool: providedPool } = options;
  const pool = providedPool || new Pool({ connectionString: config.collaborationDatabaseUrl, ssl: config.collaborationDatabaseSsl ? { rejectUnauthorized: false } : undefined, max: config.databasePoolMax || 5 });
  let ready;
  const initialize = () => ready ||= pool.query(`
    CREATE TABLE IF NOT EXISTS agent_sessions (tenant_id varchar(64) NOT NULL, session_id varchar(240) NOT NULL, agent_id varchar(64) NOT NULL, actor_subject text NOT NULL, session_fingerprint varchar(64), trace_id uuid NOT NULL DEFAULT gen_random_uuid(), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, session_id));
    ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS session_fingerprint varchar(64);
    CREATE TABLE IF NOT EXISTS agent_presence (tenant_id varchar(64) NOT NULL, agent_id varchar(64) NOT NULL, actor_subject text NOT NULL, signature text NOT NULL, session_fingerprint varchar(64), client_type varchar(32) NOT NULL, display_name text NOT NULL, capabilities jsonb NOT NULL DEFAULT '[]'::jsonb, last_seen_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, version integer NOT NULL DEFAULT 1, PRIMARY KEY (tenant_id, agent_id));
    ALTER TABLE agent_presence ADD COLUMN IF NOT EXISTS session_fingerprint varchar(64);
    CREATE TABLE IF NOT EXISTS agent_messages (tenant_id varchar(64) NOT NULL, id uuid NOT NULL, thread_id varchar(80) NOT NULL, from_agent_id varchar(64) NOT NULL, to_agent_id varchar(64) NOT NULL, body text NOT NULL, idempotency_key varchar(120), trace_id uuid NOT NULL DEFAULT gen_random_uuid(), correlation_id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, from_agent_id, idempotency_key));
    CREATE TABLE IF NOT EXISTS agent_message_quarantines (tenant_id varchar(64) NOT NULL, id uuid NOT NULL, thread_id varchar(80), from_agent_id varchar(64) NOT NULL, to_agent_id varchar(64) NOT NULL, content_digest varchar(64) NOT NULL, scanner_version varchar(80) NOT NULL, matched_rules jsonb NOT NULL DEFAULT '[]'::jsonb, provenance jsonb NOT NULL DEFAULT '{}'::jsonb, idempotency_key varchar(120), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, from_agent_id, idempotency_key));
    CREATE TABLE IF NOT EXISTS agent_message_deliveries (tenant_id varchar(64) NOT NULL, message_id uuid NOT NULL, agent_id varchar(64) NOT NULL, state varchar(20) NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz, PRIMARY KEY (tenant_id, message_id, agent_id));
    CREATE TABLE IF NOT EXISTS agent_tasks (tenant_id varchar(64) NOT NULL, id uuid NOT NULL, title text NOT NULL, description text NOT NULL DEFAULT '', priority varchar(20) NOT NULL, status varchar(20) NOT NULL DEFAULT 'open', claimed_by varchar(64), version integer NOT NULL DEFAULT 1, idempotency_key varchar(120), trace_id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, idempotency_key));
    CREATE TABLE IF NOT EXISTS agent_task_leases (tenant_id varchar(64) NOT NULL, task_id uuid NOT NULL, agent_id varchar(64) NOT NULL, lease_token uuid NOT NULL DEFAULT gen_random_uuid(), expires_at timestamptz NOT NULL, renewed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, task_id));
    CREATE TABLE IF NOT EXISTS agent_handoffs (tenant_id varchar(64) NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), from_agent_id varchar(64) NOT NULL, to_agent_id varchar(64), summary text NOT NULL, trace_id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, id));
    CREATE TABLE IF NOT EXISTS agent_events (tenant_id varchar(64) NOT NULL, id bigserial PRIMARY KEY, event_type varchar(80) NOT NULL, trace_id uuid, correlation_id uuid, actor_agent_id varchar(64), metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS agent_presence_tenant_expiry_idx ON agent_presence (tenant_id, expires_at);
    CREATE INDEX IF NOT EXISTS agent_messages_inbox_idx ON agent_messages (tenant_id, to_agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS agent_tasks_tenant_status_idx ON agent_tasks (tenant_id, status, updated_at DESC);
  `);
  const event = async (client, tenantId, type, agentId, metadata = {}) => client.query("INSERT INTO agent_events (tenant_id,event_type,actor_agent_id,metadata) VALUES ($1,$2,$3,$4::jsonb)", [tenantId, type, agentId || null, JSON.stringify(metadata)]);
  const governed = async (identity, action, callback) => {
    if (typeof govern !== "function") throw new Error("governance_unavailable");
    const gate = await govern(action, identity);
    if (!gate?.allowed) throw new Error("core_gate_denied");
    await initialize();
    const client = await pool.connect();
    try { await client.query("BEGIN"); const payload = await callback(client); await event(client, identity.tenantId, action.action_type, payload.agent_id, { target: action.target }); await client.query("COMMIT"); return result({ ...payload, gate: { allowed: true, decision: gate.decision, mediation: gate.mediation, confirmation_satisfied: gate.confirmation_satisfied === true } }); }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  };
  return {
    async heartbeat(args, identity) {
      const agentId = id(args.agent_id, "agent"); const sessionId = String(args.session_id || "").slice(0, 240); if (!sessionId) throw new Error("session_id_invalid");
      const customMetadata = (String(args.display_name || "").trim() && String(args.display_name).trim() !== agentId) ||
        (Array.isArray(args.capabilities) && args.capabilities.length > 0);
      return governed(identity, boundedCollaborationAction({ action_type: "agent.heartbeat", ...(customMetadata ? { operation_class: "owner_confirmed_governed_action", contains_customer_data: true } : {}), action_label: `Register agent ${agentId}`, target: agentId }), async (client) => {
        const expires = new Date(Date.now() + TTL_MS); const actor = String(identity.subject || identity.kind || "unknown");
        const signature = String(identity.agentPresence?.signature || "");
        const fingerprint = String(identity.agentPresence?.session_fingerprint || "");
        if (!signature || !fingerprint) throw new Error("agent_presence_session_required");
        const session = await client.query("INSERT INTO agent_sessions (tenant_id,session_id,agent_id,actor_subject,session_fingerprint,expires_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id,session_id) DO UPDATE SET agent_id=EXCLUDED.agent_id,actor_subject=EXCLUDED.actor_subject,expires_at=EXCLUDED.expires_at,updated_at=now(),session_fingerprint=EXCLUDED.session_fingerprint WHERE (agent_sessions.agent_id=EXCLUDED.agent_id AND agent_sessions.actor_subject=EXCLUDED.actor_subject AND (agent_sessions.session_fingerprint IS NULL OR agent_sessions.session_fingerprint=EXCLUDED.session_fingerprint)) OR agent_sessions.expires_at<=now() RETURNING session_id", [identity.tenantId, sessionId, agentId, actor, fingerprint, expires]);
        if (!session.rowCount) throw new Error("agent_session_conflict");
        const row = await client.query("INSERT INTO agent_presence (tenant_id,agent_id,actor_subject,signature,session_fingerprint,client_type,display_name,capabilities,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT (tenant_id,agent_id) DO UPDATE SET signature=EXCLUDED.signature,session_fingerprint=EXCLUDED.session_fingerprint,client_type=EXCLUDED.client_type,display_name=EXCLUDED.display_name,capabilities=EXCLUDED.capabilities,last_seen_at=now(),expires_at=EXCLUDED.expires_at,version=agent_presence.version+1 WHERE agent_presence.actor_subject=EXCLUDED.actor_subject AND (agent_presence.session_fingerprint IS NULL OR agent_presence.session_fingerprint=EXCLUDED.session_fingerprint OR agent_presence.expires_at<=now()) RETURNING agent_id,signature,session_fingerprint,client_type,display_name,capabilities,last_seen_at,expires_at,version", [identity.tenantId, agentId, actor, signature, fingerprint, args.client_type || "other", String(args.display_name || agentId).slice(0,120), JSON.stringify(args.capabilities || []), expires]);
        if (!row.rows[0]) throw new Error("agent_identity_conflict"); return { agent: { ...row.rows[0], id: row.rows[0].agent_id, active: true, status: "online" }, agent_id: agentId };
      });
    },
    async listAgents(identity) { await initialize(); const rows = await pool.query("SELECT agent_id,client_type,display_name,capabilities,last_seen_at,expires_at,version, CASE WHEN expires_at > now() THEN 'online' ELSE 'offline' END AS status FROM agent_presence WHERE tenant_id=$1 ORDER BY last_seen_at DESC", [identity.tenantId]); return result({ agents: rows.rows.map((row) => ({ ...row, id: row.agent_id, active: row.status === "online" })) }); },
    async createTask(args, identity) { const title = text(args.title, "task_title", 240); const key = String(args.idempotency_key || "").slice(0,120) || null; return governed(identity, boundedCollaborationAction({ action_type:"task.create", operation_class:"owner_confirmed_governed_action", contains_customer_data:true, action_label:`Create shared task ${title}`, target:title }), async (client) => { const row = await client.query("INSERT INTO agent_tasks (tenant_id,id,title,description,priority,idempotency_key) VALUES ($1,gen_random_uuid(),$2,$3,$4,$5) ON CONFLICT (tenant_id,idempotency_key) DO UPDATE SET id=agent_tasks.id RETURNING *", [identity.tenantId,title,String(args.description||"").slice(0,20000),args.priority||"normal",key]); return { task: row.rows[0] }; }); },
    async listTasks(args, identity) { await initialize(); const status = args.status ? String(args.status) : null; const rows = await pool.query("SELECT * FROM agent_tasks WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY updated_at DESC LIMIT $3",[identity.tenantId,status,Math.min(Math.max(Number(args.limit)||50,1),100)]); return result({tasks:rows.rows}); },
    async claimTask(args, identity) { const taskId=String(args.task_id); const agentId=id(args.agent_id,"agent"); return governed(identity,boundedCollaborationAction({action_type:"task.claim",action_label:`Claim shared task ${taskId}`,target:taskId}),async(client)=>{ await requireOwnedAgentSession(client,identity,agentId); const row=await client.query("UPDATE agent_tasks SET claimed_by=$3,status=CASE WHEN status='open' THEN 'claimed' ELSE status END,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND version=$4 AND (claimed_by IS NULL OR claimed_by=$3) AND status NOT IN ('completed','cancelled') RETURNING *",[identity.tenantId,taskId,agentId,Number(args.expected_version)]); if(!row.rowCount) throw new Error("task_claim_conflict"); await client.query("INSERT INTO agent_task_leases (tenant_id,task_id,agent_id,expires_at) VALUES ($1,$2,$3,now()+interval '5 minutes') ON CONFLICT (tenant_id,task_id) DO UPDATE SET agent_id=EXCLUDED.agent_id,expires_at=EXCLUDED.expires_at,renewed_at=now()",[identity.tenantId,taskId,agentId]); return {task:row.rows[0]};}); },
    async updateTask(args, identity) { const taskId=String(args.task_id), agentId=id(args.agent_id,"agent"), status=String(args.status), note=String(args.note||"").trim(); if(!["claimed","in_progress","blocked","completed","cancelled"].includes(status)) throw new Error("task_status_invalid"); return governed(identity,boundedCollaborationAction({action_type:"task.update",...(note?{operation_class:"owner_confirmed_governed_action",contains_customer_data:true}:{}),action_label:`Update shared task ${taskId} to ${status}`,target:taskId}),async(client)=>{await requireOwnedAgentSession(client,identity,agentId);const row=await client.query("UPDATE agent_tasks SET status=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND claimed_by=$3 AND version=$5 RETURNING *",[identity.tenantId,taskId,agentId,status,Number(args.expected_version)]);if(!row.rowCount)throw new Error("task_version_or_owner_conflict");await client.query("UPDATE agent_task_leases SET expires_at=now()+interval '5 minutes',renewed_at=now() WHERE tenant_id=$1 AND task_id=$2 AND agent_id=$3",[identity.tenantId,taskId,agentId]);return {task:row.rows[0]};});},
    async postMessage(args, identity) {
      const sender=id(args.from_agent_id,"agent"), recipient=args.to_agent_id === "all" ? "all" : id(args.to_agent_id,"agent");
      const rawBody=String(args.body||"").trim(); if(!rawBody||rawBody.length>20_000||/[\u0000-\u001f]/.test(rawBody))throw new Error("message_body_invalid");
      const body=redactMemoryText(rawBody).text, key=String(args.idempotency_key||"").slice(0,120)||null, thread=String(args.thread_id||crypto.randomUUID()).slice(0,80);
      const scan=scanInterAgentHandoff({tenant_id:identity.tenantId,from_agent_id:sender,to_agent_id:recipient,from_agent_signature:identity.agentPresence?.signature,from_client_type:identity.agentPresence?.client_type,thread_id:thread,body:rawBody});
      return governed(identity,boundedCollaborationAction({action_type:"message.post",operation_class:"owner_confirmed_governed_action",contains_customer_data:true,action_label:`Post agent message from ${sender} to ${recipient}`,target:recipient}),async(client)=>{
        await requireOwnedAgentSession(client,identity,sender);
        if(scan.suspicious){
          const row=await client.query("INSERT INTO agent_message_quarantines (tenant_id,id,thread_id,from_agent_id,to_agent_id,content_digest,scanner_version,matched_rules,provenance,idempotency_key) VALUES ($1,gen_random_uuid(),$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) ON CONFLICT (tenant_id,from_agent_id,idempotency_key) DO UPDATE SET id=agent_message_quarantines.id RETURNING id,content_digest,scanner_version,matched_rules,provenance,created_at,(xmax=0) AS created",[identity.tenantId,thread,sender,recipient,scan.content_digest,scan.scanner_version,JSON.stringify(scan.matched_rules),JSON.stringify(scan.provenance),key]);
          const stored=row.rows[0];
          const created=stored.created!==false;
          return {quarantined:true,created,quarantine:publicQuarantineReceipt({...scan,content_digest:stored.content_digest||scan.content_digest,scanner_version:stored.scanner_version||scan.scanner_version,matched_rules:stored.matched_rules||scan.matched_rules,provenance:stored.provenance||scan.provenance},{quarantine_id:stored.id,created_at:stored.created_at,idempotent_replay:!created})};
        }
        const row=await client.query("INSERT INTO agent_messages (tenant_id,id,thread_id,from_agent_id,to_agent_id,body,idempotency_key) VALUES ($1,gen_random_uuid(),$2,$3,$4,$5,$6) ON CONFLICT (tenant_id,from_agent_id,idempotency_key) DO UPDATE SET id=agent_messages.id RETURNING *",[identity.tenantId,thread,sender,recipient,body,key]);
        if(recipient!=="all")await client.query("INSERT INTO agent_message_deliveries (tenant_id,message_id,agent_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",[identity.tenantId,row.rows[0].id,recipient]);
        return {message:row.rows[0]};
      });
    },
    async inbox(args, identity) { const agentId=id(args.agent_id,"agent"); await initialize(); await requireOwnedAgentSession(pool,identity,agentId); const rows=await pool.query("SELECT m.*,coalesce(d.state,'pending') AS delivery_state,d.attempts FROM agent_messages m LEFT JOIN agent_message_deliveries d ON d.tenant_id=m.tenant_id AND d.message_id=m.id AND d.agent_id=$2 WHERE m.tenant_id=$1 AND (m.to_agent_id=$2 OR m.to_agent_id='all') AND ($3::boolean=false OR coalesce(d.state,'pending')<>'acknowledged') ORDER BY m.created_at DESC LIMIT $4",[identity.tenantId,agentId,args.unread_only===true,Math.min(Math.max(Number(args.limit)||50,1),100)]); return result({messages:rows.rows}); },
    async acknowledge(args, identity) { const agentId=id(args.agent_id,"agent"), messageId=String(args.message_id); return governed(identity,boundedCollaborationAction({action_type:"message.acknowledge",action_label:`Acknowledge agent message ${messageId}`,target:messageId}),async(client)=>{const owned=await requireOwnedAgentSession(client,identity,agentId);const row=await client.query("UPDATE agent_message_deliveries SET state='acknowledged',acknowledged_at=coalesce(acknowledged_at,now()) WHERE tenant_id=$1 AND message_id=$2 AND agent_id=$3 RETURNING *",[identity.tenantId,messageId,agentId]);if(!row.rowCount)throw new Error("message_not_found");return {message_id:messageId,acknowledged_by:agentId,acknowledged_by_signature:owned.signature};});},
    close: () => pool.end(),
  };
}
