import crypto from "node:crypto";
import { Pool } from "pg";
import { redactMemoryText } from "./cloud-memory-store.js";

export const WORK_CONTINUITY_SCHEMA_VERSION = "work_continuity_v1";
export const WORK_EVENT_TYPES = new Set([
  "work_created", "branch_opened", "function_added", "function_changed",
  "dependency_changed", "checkpoint_created", "handoff_created",
  "test_completed", "defect_found", "correction_verified", "work_resumed",
  "drift_detected", "rollback_prepared", "memory_verified",
]);

function tenant(value) {
  const id = String(value || "");
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(id)) throw new Error("tenant_invalid");
  return id;
}

function uuid(value, name = "id") {
  const id = String(value || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`${name}_invalid`);
  }
  return id;
}

function safeText(value, max = 4_000) {
  return redactMemoryText(String(value || "").replaceAll("\u0000", "")).text.slice(0, max);
}

export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function cleanJson(value, maxBytes = 200_000) {
  const cleaned = JSON.parse(redactMemoryText(JSON.stringify(value ?? {})).text);
  if (Buffer.byteLength(JSON.stringify(cleaned)) > maxBytes) throw new Error("continuity_payload_too_large");
  return cleaned;
}

export function buildImpactMap(architecture = {}, change = {}) {
  const functions = Array.isArray(architecture.functions) ? architecture.functions : [];
  const components = Array.isArray(architecture.components) ? architecture.components : [];
  const dependencies = Array.isArray(architecture.dependencies) ? architecture.dependencies : [];
  const links = Array.isArray(architecture.links) ? architecture.links : [];
  const functionId = String(change.function_id || "");
  const affectedDependencies = dependencies.filter((item) =>
    JSON.stringify(item).includes(functionId) || (change.dependencies || []).includes(item?.id));
  const affectedLinks = links.filter((item) =>
    JSON.stringify(item).includes(functionId) || (change.links || []).includes(item?.id));
  return {
    schema_version: "work_impact_map_v1",
    change: cleanJson(change, 40_000),
    affected_functions: functions.filter((item) => JSON.stringify(item).includes(functionId)),
    affected_components: components.filter((item) =>
      JSON.stringify(item).includes(functionId) || (change.components || []).includes(item?.id)),
    affected_dependencies: affectedDependencies,
    affected_links: affectedLinks,
    regression_targets: [...new Set([
      ...(change.regression_targets || []),
      ...affectedDependencies.map((item) => item?.id).filter(Boolean),
      ...affectedLinks.map((item) => item?.id).filter(Boolean),
    ])],
    depth_delta: Number(change.depth_delta || 0),
    reason: safeText(change.reason, 2_000),
  };
}

const CREATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS core_continuity_works (
  tenant_id varchar(64) NOT NULL, project_id varchar(64) NOT NULL, work_id uuid NOT NULL,
  session_id varchar(64) NOT NULL, parent_work_id uuid, idea text NOT NULL, objective text NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'active', current_version bigint NOT NULL DEFAULT 1,
  repository_hash char(64), policy_hash char(64), live_state_hash char(64),
  next_action text NOT NULL DEFAULT '', created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id)
);
CREATE INDEX IF NOT EXISTS core_continuity_works_project_idx
  ON core_continuity_works (tenant_id, project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS core_continuity_architecture_versions (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, version bigint NOT NULL,
  architecture jsonb NOT NULL, impact_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  architecture_digest char(64) NOT NULL, reason text NOT NULL, created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, version),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);

CREATE TABLE IF NOT EXISTS core_continuity_events (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, event_id uuid NOT NULL,
  sequence_number bigint NOT NULL, event_type varchar(80) NOT NULL, payload jsonb NOT NULL,
  previous_event_hash char(64), event_hash char(64) NOT NULL, created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id), UNIQUE (tenant_id, work_id, sequence_number),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);
CREATE OR REPLACE FUNCTION core_continuity_events_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'core_continuity_events_append_only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGGER IF EXISTS core_continuity_events_no_mutation ON core_continuity_events;
CREATE TRIGGER core_continuity_events_no_mutation BEFORE UPDATE OR DELETE ON core_continuity_events
FOR EACH ROW EXECUTE FUNCTION core_continuity_events_append_only();

CREATE TABLE IF NOT EXISTS core_continuity_capsules (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, capsule_id uuid NOT NULL,
  architecture_version bigint NOT NULL, capsule jsonb NOT NULL, capsule_digest char(64) NOT NULL,
  supervisor_approved boolean NOT NULL DEFAULT false, verified_memory boolean NOT NULL DEFAULT false,
  created_by varchar(120) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, capsule_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);
CREATE INDEX IF NOT EXISTS core_continuity_capsules_work_idx
  ON core_continuity_capsules (tenant_id, work_id, created_at DESC);

CREATE TABLE IF NOT EXISTS core_continuity_idempotency (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, idempotency_key varchar(160) NOT NULL,
  operation varchar(120) NOT NULL, request_digest char(64) NOT NULL, result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, idempotency_key)
);
`;

export function createWorkContinuityRuntime(config, options = {}) {
  if (!config.databaseUrl && !options.pool) return null;
  const pool = options.pool || new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: config.databasePoolMax || 5,
  });
  let ready;
  const initialize = () => ready ||= pool.query(CREATE_SCHEMA_SQL);

  async function appendEvent(client, context, eventType, payload = {}) {
    if (!WORK_EVENT_TYPES.has(eventType)) throw new Error("continuity_event_type_invalid");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [context.tenantId, context.workId]);
    const previous = await client.quert(`SELECT sequence_number,event_hash FROM core_continuity_events
      WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`,
    [context.tenantId, context.workId]);
    const sequence = Number(previous.rows[0]?.sequence_number || 0) + 1;
    const cleanPayload = cleanSon(payload);
    const event = {
      tenant_id: context.tenantId, work_id: context.workId, sequence_number: sequence,
      event_type: eventType, payload: cleanPayload, previous_event_hash: previous.rows[0]?.event_hash || null,
    };
    const eventHash = digest(event);
    const eventId = crypto.randomUUID();
    await client.query(`INSERT INTO core_continuity_events
      (tenant_id,work_id,event_id,sequence_number,event_type,payload,previous_event_hash,event_hash,created_by)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
    [context.tenantId, context.workId, eventId, sequence, eventType, JSON.stringify(cleanPayload),
      event.previous_event_hash, eventHash, context.actor]);
    return { event_id: eventId, sequence_number: sequence, event_type: eventType, event_hash: eventHash };
  }

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

  async function withIdempotency(client, context, key, operation, request, perform) {
    const idempotencyKey = safeText(key, 160);
    if (!idempotencyKey) throw new Error("idempotency_key_required");
    const requestDigest = digest(request);
    const existing = await client.query(`SELECT request_digest,result FROM core_continuity_idempotency
      WHERE tenant_id=$1 AND work_id=$2 AND idempotency_key=$3`,
    [context.tenantId, context.workId, idempotencyKey]);
    if (existing.rows[0]) {
      if (existing.rows[0].request_digest !== requestDigest) throw new Error("idempotency_key_conflict");
      return { ...existing.rows[0].result, idempotent_replay: true };
    }
    const result = await perform();
    await client.query(`INSERT INTO core_continuity_idempotency
      (tenant_id,work_id,idempotency_key,operation,request_digest,result)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [context.tenantId, context.workId, idempotencyKey, operation, requestDigest, JSON.stringify(result)]);
    return result;
  }

  async function create(identity, input) {
    const tenantId = tenant(identity.tenantId);
    const workId = input.work_id ? uuid(input.work_id, "work_id") : crypto.randomUUID();
    const context = { tenantId, workId, actor: safeText(input.agent_id || identity.subject || "connected_ai", 120) };
    return transaction(async (client) => {
      const architecture = cleanJson(input.architecture || {});
      const architectureDigest = digest(architecture);
      await client.query(`INSERT INTO core_continuity_works
        (tenant_id,project_id,work_id,session_id,parent_work_id,idea,objective,status,current_version,
         repository_hash,policy_hash,live_state_hash,next_action,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'active',1,$8,$9,$10,$11,$12)`,
      [tenantId, safeText(input.project_id, 64), workId, safeText(input.session_id, 64),
        input.parent_work_id ? uuid(input.parent_work_id, "parent_work_id") : null,
        safeText(input.idea, 8_000), safeText(input.objective, 8_000), input.repository_hash || null,
        input.policy_hash || null, input.live_state_hash || null, safeText(input.next_action, 4_000), context.actor]);
      await client.query(`INSERT INTO core_continuity_architecture_versions
        (tenant_id,work_id,version,architecture,impact_map,architecture_digest,reason,created_by)
        VALUES ($1,$2,1,$3::jsonb,'{}'::jsonb,$4,$5,$6)`,
      [tenantId, workId, JSON.stringify(architecture), architectureDigest, "initial_architecture", context.actor]);
      const event = await appendEvent(client, context, "work_created", {
        project_id: input.project_id, session_id: input.session_id, parent_work_id: input.parent_work_id || null,
        architecture_digest: architectureDigest,
      });
      return { schema_version: WORK_CONTINUITY_SCHEMA_VERSION, tenant_id: tenantId, work_id: workId,
        architecture_version: 1, architecture_digest: architectureDigest, event };
    });
  }

  async function recordChange(identity, input) {
    const context = { tenantId: tenant(identity.tenantId), workId: uuid(input.work_id, "work_id"),
      actor: safeText(input.agent_id || identity.subject || "connected_ai", 120) };
    return transaction(async (client) => withIdempotency(client, context, input.idempotency_key, "record_change", input,
      async () => {
        const current = await client.query(`SELECT w.current_version,v.architecture FROM core_continuity_works w
          JOIN core_continuity_architecture_versions v ON v.tenant_id=w.tenant_id AND v.work_id=w.work_id AND v.version=w.current_version
          WHERE w.tenant_id=$1 AND w.work_id=$2 FOR UPDATE`, [context.tenantId, context.workId]);
        if (!current.rows[0]) throw new Error("continuity_work_not_found");
        if (Number(input.expected_version) !== Number(current.rows[0].current_version)) throw new Error("continuity_version_conflict");
        const architecture = cleanJson(input.architecture);
        const impactMap = buildImpactMap(current.rows[0].architecture, input.change);
        const version = Number(current.rows[0].current_version) + 1;
        const architectureDigest = digest(architecture);
        await client.query(`INSERT INTO core_continuity_architecture_versions
          (tenant_id,work_id,version,architecture,impact_map,architecture_digest,reason,created_by)
          VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)`,
        [context.tenantId, context.workId, version, JSON.stringify(architecture), JSON.stringify(impactMap),
          architectureDigest, safeText(input.change?.reason, 2_000), context.actor]);
        await client.query(`UPDATE core_continuity_works SET current_version=$3,next_action=$4,updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2`,
        [context.tenantId, context.workId, version, safeText(input.next_action, 4_000)]);
        const eventType = input.event_type || (input.change?.function_id ? "function_changed" : "dependency_changed");
        const event = await appendEvent(client, context, eventType, { version, architecture_digest: architectureDigest, impact_map: impactMap });
        return { schema_version: WORK_CONTINUITY_SCHEMA_VERSION, tenant_id: context.tenantId,
          work_id: context.workId, architecture_version: version, architecture_digest: architectureDigest, impact_map: impactMap, event };
      }));
  }

  async function checkpoint(identity, input) {
    const context = { tenantId: tenant(identity.tenantId), workId: uuid(input.work_id, "work_id"),
      actor: safeText(input.agent_id || identity.subject || "connected_ai", 120) };
    return transaction(async (client) => withIdempotency(client, context, input.idempotency_key, "checkpoint", input,
      async () => {
        const current = await client.query(`SELECT current_version,repository_hash,policy_hash,live_state_hash,next_action
          FROM core_continuity_works WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`,
        [context.tenantId, context.workId]);
        if (!current.rows[0]) throw new Error("continuity_work_not_found");
        const architecture = await client.query(`SELECT architecture,architecture_digest FROM core_continuity_architecture_versions
          WHERE tenant_id=$1 AND work_id=$2 AND version=$3`,
        [context.tenantId, context.workId, current.rows[0].current_version]);
        const capsule = cleanJson({
          schema_version: "continuity_capsule_v1",
          snapshot: architecture.rows[0]?.architecture || {},
          architecture_digest: architecture.rows[0]?.architecture_digest,
          evidence: input.evidence || [], commit_patch: input.commit_patch || {},
          tests: input.tests || [], authorizations: input.authorizations || [],
          rollback: input.rollback || {}, next_action: input.next_action || current.rows[0].next_action,
          provenance: input.provenance || {}, state_hashes: {
            repository_hash: input.repository_hash || current.rows[0].repository_hash,
            policy_hash: input.policy_hash || current.rows[0].policy_hash,
            live_state_hash: input.live_state_hash || current.rows[0].live_state_hash,
          },
        });
        const capsuleId = crypto.randomUUID();
        const capsuleDigest = digest(capsule);
        await client.query(`INSERT INTO core_continuity_capsules
          (tenant_id,work_id,capsule_id,architecture_version,capsule,capsule_digest,supervisor_approved,verified_memory,created_by)
          VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,false,$8)`,
        [context.tenantId, context.workId, capsuleId, current.rows[0].current_version, JSON.stringify(capsule),
          capsuleDigest, input.supervisor_approved === true, context.actor]);
        await client.query(`UPDATE core_continuity_works SET repository_hash=$3,policy_hash=$4,live_state_hash=$5,
          next_action=$6,updated_at=now() WHERE tenant_id=$1 AND work_id=$2`,
        [context.tenantId, context.workId, capsule.state_hashes.repository_hash, capsule.state_hashes.policy_hash,
          capsule.state_hashes.live_state_hash, safeText(capsule.next_action, 4_000)]);
        const event = await appendEvent(client, context, input.handoff_to ? "handoff_created" : "checkpoint_created",
          { capsule_id: capsuleId, capsule_digest: capsuleDigest, supervisor_approved: input.supervisor_approved === true,
            handoff_to: input.handoff_to || null });
        return { schema_version: WORK_CONTINUITY_SCHEMA_VERSION, tenant_id: context.tenantId,
          work_id: context.workId, capsule_id: capsuleId, capsule_digest: capsuleDigest,
          supervisor_approved: input.supervisor_approved === true, event };
      }));
  }

  async function read(identity, input) {
    await initialize();
    const tenantId = tenant(identity.tenantId);
    const workId = uuid(input.work_id, "work_id");
    const work = await pool.query(`SELECT * FROM core_continuity_works WHERE tenant_id=$1 AND work_id=$2`, [tenantId, workId]);
    if (!work.rows[0]) throw new Error("continuity_work_not_found");
    const architecture = await pool.query(`SELECT version,architecture,impact_map,architecture_digest,reason,created_at
      FROM core_continuity_architecture_versions WHERE tenant_id=$1 AND work_id=$2 ORDER BY version DESC LIMIT 1`, [tenantId, workId]);
    const capsule = await pool.query(`SELECT capsule_id,architecture_version,capsule,capsule_digest,supervisor_approved,verified_memory,created_at
      FROM core_continuity_capsules WHERE tenant_id=$1 AND work_id=$2 ORDER BY created_at DESC LIMIT 1`, [tenantId, workId]);
    const events = await pool.query(`SELECT event_id,sequence_number,event_type,payload,previous_event_hash,event_hash,created_at
      FROM core_continuity_events WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number DESC LIMIT $3`,
    [tenantId, workId, Math.min(Math.max(Number(input.event_limit) || 50, 1), 200)]);
    return { schema_version: WORK_CONTINUITY_SCHEMA_VERSION, tenant_id: tenantId, work: work.rows[0],
      architecture: architecture.rows[0] || null, latest_capsule: capsule.rows[0] || null, events: events.rows.reverse() };
  }

  async function resume(identity, input, authorization) {
    const context = { tenantId: tenant(identity.tenantId), workId: uuid(input.work_id, "work_id"),
      actor: safeText(input.agent_id || identity.subject || "connected_ai", 120) };
    return transaction(async (client) => withIdempotency(client, context, input.idempotency_key, "resume", input,
      async () => {
        const result = await client.query(`SELECT w.*,c.capsule_id,c.capsule,c.capsule_digest,c.supervisor_approved
          FROM core_continuity_works w LEFT JOIN LATERAL (
            SELECT * FROM core_continuity_capsules WHERE tenant_id=w.tenant_id AND work_id=w.work_id
            ORDER BY created_at DESC LIMIT 1
          ) c ON true WHERE w.tenant_id=$1 AND w.work_id=$2 FOR UPDATE`, [context.tenantId, context.workId]);
        const state = result.rows[0];
        if (!state) throw new Error("continuity_work_not_found");
        if (!state.capsule_id) throw new Error("continuity_capsule_required");
        if (digest(state.capsule) !== state.capsule_digest) throw new Error("continuity_capsule_digest_mismatch");
        const expected = state.capsule.state_hashes || {};
        const actual = input.current_state_hashes || {};
        const drift = ["repository_hash", "policy_hash", "live_state_hash"].filter((key) =>
          expected[key] && expected[key] !== actual[key]);
        if (drift.length) {
          const event = await appendEvent(client, context, "drift_detected", { fields: drift, capsule_id: state.capsule_id });
          return { schema_version: WORK_CONTINUITY_SCHEMA_VERSION, tenant_id: context.tenantId,
            work_id: context.workId, resumed: false, blocked_reason: "continuity_drift_detected", drift, event };
        }
        if (authorization?.allowed !== true) throw new Error("continuity_core_revalidation_denied");
        await client.query(`UPDATE core_continuity_works SET session_id=$3,status='active',updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2`, [context.tenantId, context.workId, safeText(input.session_id, 64)]);
        const event = await appendEvent(client, context, "work_resumed", {
          capsule_id: state.capsule_id, core_decision_id: authorization.decision_id || null,
          session_id: input.session_id,
        });
        return { schema_version: WORK_CONTINUITY_SCHEMA_VERSION, tenant_id: context.tenantId,
          work_id: context.workId, capsule_id: state.capsule_id, next_action: state.capsule.next_action,
          architecture: state.capsule.snapshot, authorization, resumed: true, event };
      }));
  }

  async function verifyMemory(identity, input) {
    const context = { tenantId: tenant(identity.tenantId), workId: uuid(input.work_id, "work_id"),
      actor: safeText(input.agent_id || identity.subject || "connected_ai", 120) };
    return transaction(async (client) => withIdempotency(client, context, input.idempotency_key, "verify_memory", input,
      async () => {
        const capsuleId = uuid(input.capsule_id, "capsule_id");
        const result = await client.query(`UPDATE core_continuity_capsules SET verified_memory=true
          WHERE tenant_id=$1 AND work_id=$2 AND capsule_id=$3 AND supervisor_approved=true
          RETURNING capsule_digest`, [context.tenantId, context.workId, capsuleId]);
        if (!result.rows[0]) throw new Error("continuity_supervisor_approval_required");
        const event = await appendEvent(client, context, "memory_verified", {
          capsule_id: capsuleId, capsule_digest: result.rows[0].capsule_digest,
          test_evidence: input.test_evidence, verifier: context.actor,
        });
        return { schema_version: WORK_CONTINUITY_SCHEMA_VERSION, tenant_id: context.tenantId,
          work_id: context.workId, capsule_id: capsuleId, verified_memory: true, event };
      }));
  }

  return { initialize, create, recordChange, checkpoint, read, resume, verifyMemory,
    close: () => pool.end(), schemaSql: CREATE_SCHEMA_SQL };
}
