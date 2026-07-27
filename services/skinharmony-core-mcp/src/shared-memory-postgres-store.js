import crypto from "node:crypto";
import { createCollaborationPostgresPool } from "./collaboration-postgres-pool.js";
import { redactMemoryText } from "./cloud-memory-store.js";
import { consumeCollaborationReceipt } from "./collaboration-receipt.js";

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/i;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MEMORY_ID_PATTERN = /^mem_[a-f0-9-]{36}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function safeId(value, name, { optional = false } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized && optional) return "";
  if (!ID_PATTERN.test(normalized)) fail(`${name}_invalid`);
  return normalized;
}

function safeUuid(value, name) {
  const normalized = String(value || "").trim();
  if (!UUID_PATTERN.test(normalized)) fail(`${name}_invalid`);
  return normalized;
}

function requiredText(value, name, max = 20_000) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(normalized)) fail(`${name}_invalid`);
  return normalized;
}

function optionalText(value, name, max = 20_000) {
  if (value === undefined || value === null || value === "") return "";
  return requiredText(value, name, max);
}

function logicalPath(value, { folder = false } = {}) {
  const raw = String(value || "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const normalized = folder ? raw.replace(/\/+$/, "") : raw;
  if (!normalized || normalized.length > 240 || normalized.startsWith("/") || normalized.includes("//")) fail("workspace_path_invalid");
  const parts = normalized.split("/");
  if (parts.length > 16 || parts.some((part) => !part || part === "." || part === ".." || part.length > 80 || /[\u0000-\u001f]/.test(part))) {
    fail("workspace_path_invalid");
  }
  return parts.join("/");
}

function actor(identity) {
  const value = String(identity?.subject || identity?.kind || "").trim();
  if (!value || value.length > 500 || /[\u0000-\u001f]/.test(value)) fail("actor_subject_invalid");
  return value;
}

function tenant(identityOrId) {
  const value = typeof identityOrId === "string" ? identityOrId : identityOrId?.tenantId;
  return safeId(value, "tenant");
}

function agentPresence(identity, args = {}) {
  const presence = identity?.agentPresence;
  if (!presence?.agent_id || !presence?.signature || !presence?.session_fingerprint) fail("agent_presence_required");
  const requestedAgent = args.agent_id || args.from_agent_id;
  if (requestedAgent && requestedAgent !== presence.agent_id) fail("agent_presence_conflict");
  return {
    agent_id: safeId(presence.agent_id, "agent"),
    signature: requiredText(presence.signature, "agent_signature", 120),
    session_fingerprint: safeId(presence.session_fingerprint, "session_fingerprint"),
    client_type: safeId(presence.client_type || "other", "client_type"),
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function requestDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function idempotencyKeyDigest(value) {
  const normalized = String(value || "").trim();
  return normalized ? crypto.createHash("sha256").update(normalized).digest("hex") : null;
}

function subjectDigest(identity) {
  return crypto.createHash("sha256").update(actor(identity)).digest("hex");
}

function textResult(payload) {
  return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function gateSummary(gate) {
  return {
    allowed: true,
    decision: String(gate?.decision || "unknown"),
    mediation: String(gate?.mediation || "unknown"),
    owner_confirmation_required: gate?.owner_confirmation_required === true,
    confirmation_satisfied: gate?.confirmation_satisfied === true,
  };
}

function publicDocument(row, includeContent = false) {
  const document = {
    id: row.id,
    path: row.path,
    title: row.title,
    version: Number(row.current_version ?? row.version),
    content_sha256: row.current_content_sha256 || row.content_sha256,
    redaction_count: Number(row.redaction_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by_subject || row.created_by,
    updated_by: row.updated_by_subject || row.updated_by,
  };
  if (includeContent) document.content = row.content;
  return document;
}

function publicLock(row) {
  return {
    lock_id: row.lock_id,
    path: row.resource_path,
    mode: row.mode,
    owner_agent_id: row.owner_agent_id,
    fencing_token: Number(row.fencing_token),
    version: Number(row.version),
    acquired_at: row.acquired_at,
    renewed_at: row.renewed_at,
    expires_at: row.lease_expires_at,
    released_at: row.released_at,
    active: !row.released_at && new Date(row.lease_expires_at).getTime() > Date.now(),
  };
}

function publicMemoryRecord(record) {
  const { actor_subject: _actor, idempotency_key: _key, ...safe } = record || {};
  return safe;
}

function memoryIdempotencyPayload(record) {
  return {
    kind: record.kind,
    title: record.title,
    summary: record.summary,
    facts: record.facts,
    decisions: record.decisions,
    actions: record.actions,
    outcomes: record.outcomes,
    next_steps: record.next_steps,
    tags: record.tags,
    importance: record.importance,
    data_classification: record.data_classification,
    consent_reference: record.consent_reference,
    project_id: record.project_id,
    session_id: record.session_id,
    agent_id: record.agent_id,
    logical_agent_id: record.logical_agent_id,
    to_agent_id: record.to_agent_id || null,
    source: record.source,
  };
}

export function pathsOverlap(left, right) {
  const a = logicalPath(left, { folder: true });
  const b = logicalPath(right, { folder: true });
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export const COLLABORATION_RECEIPT_FUNCTION_BODY = `
    DECLARE
      receipt_now timestamptz;
      inserted_count integer;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended(
        'mcp-collaboration-receipt:' || p_tenant_id || ':' || p_jti,
        0
      ));
      receipt_now := clock_timestamp();
      IF p_tenant_id <> 'codexai' OR
         p_tenant_id !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$' OR
         p_jti IS NULL OR p_jti !~ '^mcpcr_[A-Za-z0-9_-]{16,128}$' OR
         p_action_digest IS NULL OR p_action_digest !~ '^[a-f0-9]{64}$' OR
         p_issued_at IS NULL OR p_expires_at IS NULL OR
         p_first_issuer IS NULL OR p_first_issuer = '' OR
         p_second_issuer IS NULL OR p_second_issuer = '' OR
         p_first_issuer <> 'universal-core-staging' OR
         p_second_issuer <> 'nyra-staging' OR
         p_first_receipt_digest IS NULL OR p_first_receipt_digest !~ '^[a-f0-9]{64}$' OR
         p_second_receipt_digest IS NULL OR p_second_receipt_digest !~ '^[a-f0-9]{64}$' OR
         p_issued_at > receipt_now + interval '5 seconds' OR
         p_expires_at <= receipt_now OR
         p_expires_at > receipt_now + interval '35 seconds' OR
         p_expires_at <= p_issued_at OR
         p_expires_at - p_issued_at > interval '30 seconds' THEN
        RAISE EXCEPTION 'collaboration_receipt_invalid';
      END IF;
      RETURN QUERY
      WITH candidate(tenant_id,issuer,jti,receipt_digest,action_digest) AS (
        VALUES
          (p_tenant_id,p_first_issuer,p_jti,p_first_receipt_digest,p_action_digest),
          (p_tenant_id,p_second_issuer,p_jti,p_second_receipt_digest,p_action_digest)
      )
      INSERT INTO mcp_collaboration_control.consumed_receipts AS receipt_rows
        (tenant_id,issuer,jti,receipt_digest,action_digest)
      SELECT tenant_id,issuer,jti,receipt_digest,action_digest FROM candidate
      ON CONFLICT DO NOTHING
      RETURNING receipt_rows.issuer;
      GET DIAGNOSTICS inserted_count = ROW_COUNT;
      IF inserted_count <> 2 THEN
        RAISE EXCEPTION 'collaboration_receipt_expired_or_replayed';
      END IF;
    END;
    `;

export function collaborationSharedMemorySchemaSql() {
  return `
    CREATE TABLE IF NOT EXISTS mcp_workspace_heads (
      tenant_id varchar(64) PRIMARY KEY,
      revision bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS mcp_workspace_folders (
      tenant_id varchar(64) NOT NULL,
      id uuid NOT NULL,
      path varchar(240) NOT NULL,
      parent_path varchar(240),
      name varchar(80) NOT NULL,
      version integer NOT NULL DEFAULT 1,
      created_by_subject text NOT NULL,
      created_by_agent_id varchar(64),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      UNIQUE (tenant_id, path)
    );
    CREATE TABLE IF NOT EXISTS mcp_workspace_documents (
      tenant_id varchar(64) NOT NULL,
      id uuid NOT NULL,
      path varchar(240) NOT NULL,
      title text NOT NULL,
      current_version integer NOT NULL,
      current_content_sha256 char(64) NOT NULL,
      redaction_count integer NOT NULL DEFAULT 0,
      last_fencing_token bigint,
      created_by_subject text NOT NULL,
      updated_by_subject text NOT NULL,
      created_by_agent_id varchar(64),
      updated_by_agent_id varchar(64),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id),
      UNIQUE (tenant_id, path)
    );
    CREATE TABLE IF NOT EXISTS mcp_workspace_document_versions (
      tenant_id varchar(64) NOT NULL,
      document_id uuid NOT NULL,
      version integer NOT NULL,
      title text NOT NULL,
      content text NOT NULL,
      content_sha256 char(64) NOT NULL,
      redaction_count integer NOT NULL DEFAULT 0,
      actor_subject text NOT NULL,
      agent_id varchar(64),
      session_fingerprint varchar(64),
      agent_signature text,
      fencing_token bigint,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, document_id, version),
      FOREIGN KEY (tenant_id, document_id)
        REFERENCES mcp_workspace_documents (tenant_id, id) ON DELETE RESTRICT
    );
    CREATE SEQUENCE IF NOT EXISTS mcp_workspace_fencing_seq AS bigint NO CYCLE;
    CREATE TABLE IF NOT EXISTS mcp_workspace_lock_leases (
      tenant_id varchar(64) NOT NULL,
      lock_id uuid NOT NULL,
      resource_path varchar(240) NOT NULL,
      mode varchar(12) NOT NULL DEFAULT 'exclusive' CHECK (mode IN ('exclusive')),
      owner_agent_id varchar(64) NOT NULL,
      owner_session_fingerprint varchar(64) NOT NULL,
      owner_signature text NOT NULL,
      fencing_token bigint NOT NULL DEFAULT nextval('mcp_workspace_fencing_seq'),
      lease_expires_at timestamptz NOT NULL,
      acquired_at timestamptz NOT NULL DEFAULT now(),
      renewed_at timestamptz NOT NULL DEFAULT now(),
      released_at timestamptz,
      version integer NOT NULL DEFAULT 1,
      trace_id uuid NOT NULL DEFAULT gen_random_uuid(),
      PRIMARY KEY (tenant_id, lock_id),
      UNIQUE (fencing_token)
    );
    CREATE INDEX IF NOT EXISTS mcp_workspace_lock_active_idx
      ON mcp_workspace_lock_leases (tenant_id, lease_expires_at, resource_path)
      WHERE released_at IS NULL;
    CREATE TABLE IF NOT EXISTS mcp_memory_heads (
      tenant_id varchar(64) PRIMARY KEY,
      revision bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS mcp_memory_stream_heads (
      tenant_id varchar(64) NOT NULL,
      stream_key varchar(180) NOT NULL,
      revision bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, stream_key)
    );
    CREATE TABLE IF NOT EXISTS mcp_memory_records (
      tenant_id varchar(64) NOT NULL,
      id varchar(80) NOT NULL,
      kind varchar(32) NOT NULL,
      stream_key varchar(180),
      stream_revision bigint,
      project_id varchar(64),
      session_id varchar(64),
      agent_id varchar(64),
      source varchar(64) NOT NULL,
      importance integer NOT NULL,
      data_classification varchar(32) NOT NULL,
      payload jsonb NOT NULL,
      expires_at timestamptz,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE INDEX IF NOT EXISTS mcp_memory_records_scope_idx
      ON mcp_memory_records (tenant_id, project_id, session_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS mcp_memory_handoffs (
      tenant_id varchar(64) NOT NULL,
      id varchar(80) NOT NULL,
      from_agent_id varchar(64),
      from_agent_signature text,
      to_agent_id varchar(64) NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'pending',
      payload jsonb NOT NULL,
      project_id varchar(64),
      session_id varchar(64),
      expires_at timestamptz,
      created_at timestamptz NOT NULL,
      acknowledged_at timestamptz,
      acknowledged_by_agent_id varchar(64),
      acknowledged_by_signature text,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE INDEX IF NOT EXISTS mcp_memory_handoffs_pending_idx
      ON mcp_memory_handoffs (tenant_id, to_agent_id, status, created_at DESC);
    CREATE TABLE IF NOT EXISTS mcp_memory_handoff_deliveries (
      tenant_id varchar(64) NOT NULL,
      handoff_id varchar(80) NOT NULL,
      agent_id varchar(64) NOT NULL,
      agent_signature text NOT NULL,
      acknowledged_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, handoff_id, agent_id),
      FOREIGN KEY (tenant_id, handoff_id)
        REFERENCES mcp_memory_handoffs (tenant_id, id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS mcp_memory_events (
      tenant_id varchar(64) NOT NULL,
      id uuid NOT NULL,
      kind varchar(32) NOT NULL,
      project_id varchar(64),
      session_id varchar(64),
      agent_id varchar(64),
      payload jsonb NOT NULL,
      expires_at timestamptz,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE INDEX IF NOT EXISTS mcp_memory_events_scope_idx
      ON mcp_memory_events (tenant_id, project_id, session_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS mcp_collaboration_idempotency (
      tenant_id varchar(64) NOT NULL,
      operation varchar(80) NOT NULL,
      actor_subject_sha256 char(64) NOT NULL,
      idempotency_key varchar(120) NOT NULL,
      request_sha256 char(64) NOT NULL,
      state varchar(16) NOT NULL CHECK (state IN ('pending','completed')),
      result_ref jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      PRIMARY KEY (tenant_id, operation, actor_subject_sha256, idempotency_key)
    );
    CREATE SCHEMA IF NOT EXISTS mcp_collaboration_control;
    ALTER SCHEMA mcp_collaboration_control OWNER TO CURRENT_USER;
    REVOKE ALL ON SCHEMA mcp_collaboration_control FROM PUBLIC;
    CREATE TABLE IF NOT EXISTS mcp_collaboration_control.consumed_receipts (
      tenant_id varchar(64) NOT NULL,
      issuer varchar(120) NOT NULL,
      jti varchar(160) NOT NULL,
      receipt_digest char(64) NOT NULL,
      action_digest char(64) NOT NULL,
      consumed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, issuer, jti)
    );
    ALTER TABLE mcp_collaboration_control.consumed_receipts OWNER TO CURRENT_USER;
    REVOKE ALL ON TABLE mcp_collaboration_control.consumed_receipts FROM PUBLIC;
    CREATE OR REPLACE FUNCTION mcp_collaboration_control.consume_receipt_pair(
      p_tenant_id varchar(64),
      p_jti varchar(160),
      p_action_digest char(64),
      p_issued_at timestamptz,
      p_expires_at timestamptz,
      p_first_issuer varchar(120),
      p_first_receipt_digest char(64),
      p_second_issuer varchar(120),
      p_second_receipt_digest char(64)
    ) RETURNS TABLE(consumed_issuer varchar(120))
    LANGUAGE plpgsql
    SECURITY DEFINER
    STRICT
    SET search_path = pg_catalog, mcp_collaboration_control, pg_temp
    AS $mcp_collaboration_receipt$${COLLABORATION_RECEIPT_FUNCTION_BODY}$mcp_collaboration_receipt$;
    ALTER FUNCTION mcp_collaboration_control.consume_receipt_pair(
      varchar,varchar,char,timestamptz,timestamptz,varchar,char,varchar,char
    ) OWNER TO CURRENT_USER;
    REVOKE ALL ON FUNCTION mcp_collaboration_control.consume_receipt_pair(
      varchar,varchar,char,timestamptz,timestamptz,varchar,char,varchar,char
    ) FROM PUBLIC;
    CREATE TABLE IF NOT EXISTS mcp_coordination_events (
      tenant_id varchar(64) NOT NULL,
      id bigserial NOT NULL,
      event_type varchar(80) NOT NULL,
      actor_subject_sha256 char(64) NOT NULL,
      actor_agent_id varchar(64),
      target text,
      action_sha256 char(64) NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id)
    );
    CREATE INDEX IF NOT EXISTS mcp_coordination_events_tenant_idx
      ON mcp_coordination_events (tenant_id, created_at DESC);
    CREATE OR REPLACE FUNCTION mcp_reject_append_only_mutation() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'mcp_append_only'; END;
    $$ LANGUAGE plpgsql;
    ALTER FUNCTION public.mcp_reject_append_only_mutation() OWNER TO CURRENT_USER;
    REVOKE ALL ON FUNCTION public.mcp_reject_append_only_mutation() FROM PUBLIC;
    DO $$
    DECLARE table_name text;
    BEGIN
      FOREACH table_name IN ARRAY ARRAY[
        'mcp_workspace_document_versions',
        'mcp_memory_records',
        'mcp_memory_events',
        'mcp_coordination_events'
      ] LOOP
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname=('no_mutation_' || table_name) AND tgrelid=to_regclass(table_name)
        ) THEN
          EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION mcp_reject_append_only_mutation()',
            'no_mutation_' || table_name,
            table_name
          );
        END IF;
      END LOOP;
    END $$;
    DROP TRIGGER IF EXISTS no_mutation_consumed_receipts
      ON mcp_collaboration_control.consumed_receipts;
    CREATE TRIGGER no_mutation_consumed_receipts
      BEFORE UPDATE OR DELETE ON mcp_collaboration_control.consumed_receipts
      FOR EACH ROW EXECUTE FUNCTION mcp_reject_append_only_mutation();
  `;
}

export function createSharedMemoryPostgresStore(config, options = {}) {
  const pool = createCollaborationPostgresPool(config, options);
  if (!pool) return null;
  const govern = options.govern;
  const collaborationReceiptVerifier = options.collaborationReceiptVerifier;
  const receiptEnforcement = config.collaborationReceiptEnforcement === true;
  const ownsPool = !options.pool;
  const locksRequired = config.collaborationLocksRequired !== false;
  const idempotencyRequired = config.collaborationIdempotencyRequired !== false;
  const defaultLeaseSeconds = Number(config.collaborationLockLeaseSeconds || 60);
  let ready;

  const initialize = () => ready ||= options.schemaReady
    ? Promise.resolve(options.schemaReady)
    : pool.query(collaborationSharedMemorySchemaSql());

  async function authorize(identity, action) {
    if (receiptEnforcement && !collaborationReceiptVerifier?.ready) fail("collaboration_signed_receipt_verifier_required");
    if (typeof govern !== "function") fail("governance_unavailable");
    const gate = await govern(action, identity);
    if (!gate?.allowed) fail("core_gate_denied");
    if (!receiptEnforcement) return gate;
    const receiptEvidence = await collaborationReceiptVerifier.verify(gate.coordination_receipt, { config, action, identity });
    return { ...gate, receiptEvidence };
  }

  async function tenantTransaction(client, tenantId) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`skinharmony-mcp-collaboration:${tenantId}`],
    );
  }

  async function appendAudit(client, identity, action, metadata = {}) {
    const presence = identity?.agentPresence || {};
    const governance = identity?.governanceContext || {};
    await client.query(
      `INSERT INTO mcp_coordination_events
         (tenant_id,event_type,actor_subject_sha256,actor_agent_id,target,action_sha256,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        tenant(identity),
        action.action_type,
        subjectDigest(identity),
        presence.agent_id || null,
        String(action.target || "").slice(0, 500) || null,
        requestDigest(action),
        JSON.stringify({
          ...metadata,
          preflight_id: governance.preflight_id || null,
          trace_id: governance.trace_id || null,
          shared_memory_checksum: governance.shared_memory_checksum || null,
          task_contract_id: governance.task_contract_id || null,
          task_trace_id: governance.task_trace_id || null,
          coordination_lock: governance.coordination_lock || null,
          payload_sha256: action.payload_sha256 || null,
        }),
      ],
    );
  }

  async function requireOwnedPresence(client, identity, args = {}) {
    const presence = agentPresence(identity, args);
    const registered = await client.query(
      `SELECT 1 FROM agent_presence
       WHERE tenant_id=$1 AND agent_id=$2 AND actor_subject=$3
         AND signature=$4 AND session_fingerprint=$5 AND expires_at>now()`,
      [tenant(identity), presence.agent_id, actor(identity), presence.signature, presence.session_fingerprint],
    );
    if (!registered.rowCount) fail("agent_not_registered");
    return presence;
  }

  async function runGoverned(identity, action, mutate) {
    const gate = await authorize(identity, action);
    await initialize();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (receiptEnforcement) await tenantTransaction(client, tenant(identity));
      const receiptAudit = receiptEnforcement
        ? await consumeCollaborationReceipt(client, identity, gate.receiptEvidence)
        : null;
      const payload = await mutate(client, gate);
      await appendAudit(client, identity, action, {
        ...(payload.audit || {}),
        ...(receiptAudit ? { collaboration_receipt: receiptAudit } : {}),
      });
      await client.query("COMMIT");
      const { audit: _audit, ...safePayload } = payload;
      return { ...safePayload, gate: gateSummary(gate) };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async function reserveIdempotency(client, identity, operation, key, request) {
    const normalizedKey = optionalText(key, "idempotency_key", 120);
    if (!normalizedKey) {
      if (idempotencyRequired) fail("idempotency_key_required");
      return { replay: false, key: "", request_sha256: requestDigest(request) };
    }
    const tenantId = tenant(identity);
    const actorHash = subjectDigest(identity);
    const digest = requestDigest(request);
    const inserted = await client.query(
      `INSERT INTO mcp_collaboration_idempotency
         (tenant_id,operation,actor_subject_sha256,idempotency_key,request_sha256,state)
       VALUES ($1,$2,$3,$4,$5,'pending')
       ON CONFLICT DO NOTHING
       RETURNING state`,
      [tenantId, operation, actorHash, normalizedKey, digest],
    );
    if (inserted.rowCount) return { replay: false, key: normalizedKey, request_sha256: digest };
    const existing = await client.query(
      `SELECT request_sha256,state,result_ref
       FROM mcp_collaboration_idempotency
       WHERE tenant_id=$1 AND operation=$2 AND actor_subject_sha256=$3 AND idempotency_key=$4
       FOR UPDATE`,
      [tenantId, operation, actorHash, normalizedKey],
    );
    const row = existing.rows[0];
    if (!row) fail("idempotency_state_missing");
    if (row.request_sha256 !== digest) fail("idempotency_key_reused");
    if (row.state !== "completed" || !row.result_ref) fail("idempotency_incomplete");
    return { replay: true, key: normalizedKey, request_sha256: digest, result: row.result_ref };
  }

  async function completeIdempotency(client, identity, operation, reservation, result) {
    if (!reservation.key || reservation.replay) return;
    const updated = await client.query(
      `UPDATE mcp_collaboration_idempotency
       SET state='completed',result_ref=$5::jsonb,completed_at=now()
       WHERE tenant_id=$1 AND operation=$2 AND actor_subject_sha256=$3 AND idempotency_key=$4
         AND request_sha256=$6 AND state='pending'`,
      [tenant(identity), operation, subjectDigest(identity), reservation.key, JSON.stringify(result), reservation.request_sha256],
    );
    if (updated.rowCount !== 1) fail("idempotency_completion_conflict");
  }

  async function bumpWorkspaceRevision(client, tenantId) {
    const row = await client.query(
      `INSERT INTO mcp_workspace_heads (tenant_id,revision) VALUES ($1,1)
       ON CONFLICT (tenant_id) DO UPDATE SET revision=mcp_workspace_heads.revision+1,updated_at=now()
       RETURNING revision`,
      [tenantId],
    );
    return Number(row.rows[0].revision);
  }

  async function bumpMemoryRevision(client, tenantId) {
    const row = await client.query(
      `INSERT INTO mcp_memory_heads (tenant_id,revision) VALUES ($1,1)
       ON CONFLICT (tenant_id) DO UPDATE SET revision=mcp_memory_heads.revision+1,updated_at=now()
       RETURNING revision`,
      [tenantId],
    );
    return Number(row.rows[0].revision);
  }

  async function nextStreamRevision(client, tenantId, record) {
    const streamKey = record.project_id
      ? `project:${record.project_id}`
      : record.session_id
        ? `session:${record.session_id}`
        : `tenant:${tenantId}`;
    await client.query(
      `INSERT INTO mcp_memory_stream_heads (tenant_id,stream_key,revision)
       VALUES ($1,$2,0) ON CONFLICT DO NOTHING`,
      [tenantId, streamKey],
    );
    const row = await client.query(
      `UPDATE mcp_memory_stream_heads
       SET revision=revision+1,updated_at=now()
       WHERE tenant_id=$1 AND stream_key=$2
       RETURNING revision`,
      [tenantId, streamKey],
    );
    return { stream_key: streamKey, stream_revision: Number(row.rows[0].revision) };
  }

  async function insertMemoryEvent(client, tenantId, record, overrides = {}) {
    const event = {
      ...record,
      ...overrides,
      id: overrides.id || `evt_${crypto.randomUUID()}`,
    };
    await client.query(
      `INSERT INTO mcp_memory_events
         (tenant_id,id,kind,project_id,session_id,agent_id,payload,expires_at,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      [
        tenantId,
        crypto.randomUUID(),
        event.kind,
        event.project_id || null,
        event.session_id || null,
        event.agent_id || null,
        JSON.stringify(event),
        event.expires_at || null,
        event.created_at,
      ],
    );
  }

  async function listWorkspace(args, identity) {
    await initialize();
    const tenantId = tenant(identity);
    const prefix = args.prefix ? logicalPath(args.prefix, { folder: true }) : "";
    const [head, folders, documents] = await Promise.all([
      pool.query("SELECT revision FROM mcp_workspace_heads WHERE tenant_id=$1", [tenantId]),
      pool.query(
        `SELECT id,path,version,created_at,created_by_subject AS created_by
         FROM mcp_workspace_folders
         WHERE tenant_id=$1 AND ($2='' OR path=$2 OR left(path,length($2)+1)=$2||'/')
         ORDER BY path ASC`,
        [tenantId, prefix],
      ),
      pool.query(
        `SELECT id,path,title,current_version,current_content_sha256,redaction_count,
                created_at,updated_at,created_by_subject,updated_by_subject
         FROM mcp_workspace_documents
         WHERE tenant_id=$1 AND ($2='' OR path=$2 OR left(path,length($2)+1)=$2||'/')
         ORDER BY path ASC`,
        [tenantId, prefix],
      ),
    ]);
    return textResult({
      revision: Number(head.rows[0]?.revision || 0),
      folders: folders.rows,
      documents: documents.rows.map((row) => publicDocument(row)),
      backend: "postgres",
    });
  }

  async function createFolder(args, identity) {
    const folderPath = logicalPath(args.path, { folder: true });
    const declaredPresence = agentPresence(identity, args);
    const lockId = args.lock_id ? safeUuid(args.lock_id, "lock_id") : "";
    const fencingProvided = args.fencing_token !== undefined && args.fencing_token !== null && args.fencing_token !== "";
    const fencingToken = Number(args.fencing_token || 0);
    if (Boolean(lockId) !== fencingProvided || (fencingProvided && (!Number.isSafeInteger(fencingToken) || fencingToken < 1))) fail("workspace_lock_pair_required");
    if (locksRequired && (!lockId || !Number.isSafeInteger(fencingToken) || fencingToken < 1)) fail("workspace_lock_required");
    const request = { path: folderPath, lock_id: lockId || null, fencing_token: fencingToken || null, agent_signature: declaredPresence.signature };
    const result = await runGoverned(
      identity,
      {
        action_type: "workspace.create_folder",
        action_label: `Create shared folder ${folderPath}`,
        target: folderPath,
        payload_sha256: requestDigest(request),
        lock_id: lockId || null,
        fencing_token: fencingToken || null,
        idempotency_key_sha256: idempotencyKeyDigest(args.idempotency_key),
      },
      async (client) => {
        const tenantId = tenant(identity);
        await tenantTransaction(client, tenantId);
        const presence = await requireOwnedPresence(client, identity, args);
        const reservation = await reserveIdempotency(client, identity, "workspace.create_folder", args.idempotency_key, request);
        if (reservation.replay) return { ...reservation.result, idempotent_replay: true, audit: { path: folderPath, idempotent_replay: true } };
        if (lockId) {
          const owned = await client.query(
            `SELECT 1 FROM mcp_workspace_lock_leases
             WHERE tenant_id=$1 AND lock_id=$2
               AND (resource_path=$3 OR left($3,length(resource_path)+1)=resource_path||'/')
               AND owner_agent_id=$4 AND owner_session_fingerprint=$5 AND owner_signature=$6
               AND fencing_token=$7 AND released_at IS NULL AND lease_expires_at>now()
             FOR UPDATE`,
            [tenantId, lockId, folderPath, presence.agent_id, presence.session_fingerprint, presence.signature, fencingToken],
          );
          if (!owned.rowCount) fail("workspace_lock_stale_or_not_owned");
        }
        const conflicting = await client.query(
          `SELECT lock_id FROM mcp_workspace_lock_leases
           WHERE tenant_id=$1 AND released_at IS NULL AND lease_expires_at>now()
             AND (resource_path=$2 OR left(resource_path,length($2)+1)=$2||'/' OR left($2,length(resource_path)+1)=resource_path||'/')
             AND ($3::uuid IS NULL OR lock_id<>$3)
           LIMIT 1 FOR UPDATE`,
          [tenantId, folderPath, lockId || null],
        );
        if (conflicting.rowCount) fail("workspace_lock_conflict");
        const documentCollision = await client.query(
          `SELECT 1 FROM mcp_workspace_documents
           WHERE tenant_id=$1 AND (path=$2 OR left($2,length(path)+1)=path||'/') FOR UPDATE`,
          [tenantId, folderPath],
        );
        if (documentCollision.rowCount) fail("workspace_path_type_conflict");
        const folderId = crypto.randomUUID();
        const parentPath = folderPath.includes("/") ? folderPath.split("/").slice(0, -1).join("/") : null;
        const row = await client.query(
          `INSERT INTO mcp_workspace_folders
             (tenant_id,id,path,parent_path,name,created_by_subject,created_by_agent_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (tenant_id,path) DO UPDATE SET path=mcp_workspace_folders.path
           RETURNING id,path,version,created_at,created_by_subject AS created_by,(id=$2) AS created`,
          [tenantId, folderId, folderPath, parentPath, folderPath.split("/").at(-1), actor(identity), presence?.agent_id || null],
        );
        const created = row.rows[0].created === true;
        const revision = created ? await bumpWorkspaceRevision(client, tenantId) : Number((await client.query("SELECT revision FROM mcp_workspace_heads WHERE tenant_id=$1", [tenantId])).rows[0]?.revision || 0);
        const payload = { folder: row.rows[0], created, idempotent_replay: false, workspace_revision: revision };
        await completeIdempotency(client, identity, "workspace.create_folder", reservation, payload);
        return { ...payload, audit: { path: folderPath, created, fencing_token: fencingToken } };
      },
    );
    return textResult(result);
  }

  async function readDocument(args, identity) {
    if ((!args.id && !args.path) || (args.id && args.path)) fail("document_selector_invalid");
    await initialize();
    const tenantId = tenant(identity);
    const params = [tenantId];
    let selector;
    if (args.id) {
      params.push(safeUuid(args.id, "document_id"));
      selector = "d.id=$2";
    } else {
      params.push(logicalPath(args.path));
      selector = "d.path=$2";
    }
    const row = await pool.query(
      `SELECT d.id,d.path,d.title,d.current_version,d.current_content_sha256,d.redaction_count,
              d.created_at,d.updated_at,d.created_by_subject,d.updated_by_subject,v.content
       FROM mcp_workspace_documents d
       JOIN mcp_workspace_document_versions v
         ON v.tenant_id=d.tenant_id AND v.document_id=d.id AND v.version=d.current_version
       WHERE d.tenant_id=$1 AND ${selector}`,
      params,
    );
    if (!row.rows[0]) fail("document_not_found");
    const head = await pool.query("SELECT revision FROM mcp_workspace_heads WHERE tenant_id=$1", [tenantId]);
    return textResult({ document: publicDocument(row.rows[0], true), revision: Number(head.rows[0]?.revision || 0), backend: "postgres" });
  }

  function normalizeSourcePaths(values) {
    return [...new Set((values || []).map((value) => logicalPath(value)))].slice(0, 50);
  }

  async function inspectBySourcePaths(tenantIdValue, values) {
    await initialize();
    const paths = normalizeSourcePaths(values);
    if (!paths.length) return [];
    const rows = await pool.query(
      `SELECT path AS source_path,current_content_sha256 AS content_sha256,updated_at
       FROM mcp_workspace_documents
       WHERE tenant_id=$1 AND path=ANY($2::text[])
       ORDER BY path ASC`,
      [tenant(tenantIdValue), paths],
    );
    return rows.rows;
  }

  async function fetchBySourcePaths(tenantIdValue, values) {
    await initialize();
    const paths = normalizeSourcePaths(values);
    if (!paths.length) return [];
    const rows = await pool.query(
      `SELECT d.id,d.path AS source_path,d.title,v.content,
              d.current_content_sha256 AS content_sha256,d.redaction_count,d.updated_at
       FROM mcp_workspace_documents d
       JOIN mcp_workspace_document_versions v
         ON v.tenant_id=d.tenant_id AND v.document_id=d.id AND v.version=d.current_version
       WHERE d.tenant_id=$1 AND d.path=ANY($2::text[])
       ORDER BY d.path ASC`,
      [tenant(tenantIdValue), paths],
    );
    return rows.rows;
  }

  async function writeDocument(args, identity) {
    const documentPath = logicalPath(args.path);
    const rawTitle = optionalText(args.title, "document_title", 200) || documentPath.split("/").at(-1);
    const rawContent = requiredText(args.content, "document_content", 100_000);
    const titleRedaction = redactMemoryText(rawTitle);
    const contentRedaction = redactMemoryText(rawContent);
    const title = titleRedaction.text.slice(0, 200);
    const content = contentRedaction.text.slice(0, 100_000);
    const contentSha = crypto.createHash("sha256").update(content).digest("hex");
    const expectedVersion = Number(args.expected_version);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) fail("document_expected_version_required");
    const presence = agentPresence(identity, args);
    const lockId = args.lock_id ? safeUuid(args.lock_id, "lock_id") : "";
    const fencingProvided = args.fencing_token !== undefined && args.fencing_token !== null && args.fencing_token !== "";
    const fencingToken = Number(args.fencing_token || 0);
    if (Boolean(lockId) !== fencingProvided || (fencingProvided && (!Number.isSafeInteger(fencingToken) || fencingToken < 1))) fail("workspace_lock_pair_required");
    if (locksRequired && (!lockId || !Number.isSafeInteger(fencingToken) || fencingToken < 1)) fail("workspace_lock_required");
    const request = {
      path: documentPath,
      title,
      content_sha256: contentSha,
      expected_version: expectedVersion,
      lock_id: lockId || null,
      fencing_token: fencingToken || null,
      agent_signature: presence.signature,
    };
    const result = await runGoverned(
      identity,
      {
        action_type: "workspace.write_document",
        action_label: `Write shared document ${documentPath}`,
        target: documentPath,
        payload_sha256: requestDigest(request),
        expected_version: expectedVersion,
        lock_id: lockId || null,
        fencing_token: fencingToken || null,
        idempotency_key_sha256: idempotencyKeyDigest(args.idempotency_key),
      },
      async (client) => {
        const tenantId = tenant(identity);
        await tenantTransaction(client, tenantId);
        const presence = await requireOwnedPresence(client, identity, args);
        const reservation = await reserveIdempotency(client, identity, "workspace.write_document", args.idempotency_key, request);
        if (reservation.replay) return { ...reservation.result, idempotent_replay: true, audit: { path: documentPath, idempotent_replay: true } };

        if (lockId) {
          const owned = await client.query(
            `SELECT 1 FROM mcp_workspace_lock_leases
             WHERE tenant_id=$1 AND lock_id=$2
               AND (resource_path=$3 OR left($3,length(resource_path)+1)=resource_path||'/')
               AND owner_agent_id=$4 AND owner_session_fingerprint=$5 AND owner_signature=$6
               AND fencing_token=$7 AND released_at IS NULL AND lease_expires_at>now()
             FOR UPDATE`,
            [tenantId, lockId, documentPath, presence.agent_id, presence.session_fingerprint, presence.signature, fencingToken],
          );
          if (!owned.rowCount) fail("workspace_lock_stale_or_not_owned");
        }
        const conflicting = await client.query(
          `SELECT lock_id FROM mcp_workspace_lock_leases
           WHERE tenant_id=$1 AND released_at IS NULL AND lease_expires_at>now()
             AND (resource_path=$2 OR left(resource_path,length($2)+1)=$2||'/' OR left($2,length(resource_path)+1)=resource_path||'/')
             AND ($3::uuid IS NULL OR lock_id<>$3)
           LIMIT 1 FOR UPDATE`,
          [tenantId, documentPath, lockId || null],
        );
        if (conflicting.rowCount) fail("workspace_lock_conflict");

        const folderCollision = await client.query(
          `SELECT 1 FROM mcp_workspace_folders
           WHERE tenant_id=$1 AND (path=$2 OR left(path,length($2)+1)=$2||'/') FOR UPDATE`,
          [tenantId, documentPath],
        );
        if (folderCollision.rowCount) fail("workspace_path_type_conflict");

        const existing = await client.query(
          `SELECT * FROM mcp_workspace_documents WHERE tenant_id=$1 AND path=$2 FOR UPDATE`,
          [tenantId, documentPath],
        );
        const current = existing.rows[0];
        if (!current && expectedVersion !== 0) fail("document_version_conflict");
        if (current && Number(current.current_version) !== expectedVersion) fail("document_version_conflict");
        if (current?.last_fencing_token && !lockId) fail("workspace_lock_required_for_fenced_document");
        if (current?.last_fencing_token && (!fencingToken || fencingToken < Number(current.last_fencing_token))) fail("workspace_fencing_token_stale");

        const timestamp = new Date().toISOString();
        const documentId = current?.id || crypto.randomUUID();
        const version = current ? Number(current.current_version) + 1 : 1;
        const redactionCount = titleRedaction.redactions + contentRedaction.redactions;
        if (current) {
          await client.query(
            `UPDATE mcp_workspace_documents
             SET title=$3,current_version=$4,current_content_sha256=$5,redaction_count=$6,
                 last_fencing_token=$7,updated_by_subject=$8,updated_by_agent_id=$9,updated_at=$10
             WHERE tenant_id=$1 AND id=$2`,
            [tenantId, documentId, title, version, contentSha, redactionCount, lockId ? fencingToken : current.last_fencing_token, actor(identity), presence.agent_id, timestamp],
          );
        } else {
          await client.query(
            `INSERT INTO mcp_workspace_documents
               (tenant_id,id,path,title,current_version,current_content_sha256,redaction_count,last_fencing_token,
                created_by_subject,updated_by_subject,created_by_agent_id,updated_by_agent_id,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$10,$11,$11)`,
            [tenantId, documentId, documentPath, title, version, contentSha, redactionCount, lockId ? fencingToken : null, actor(identity), presence.agent_id, timestamp],
          );
        }
        await client.query(
          `INSERT INTO mcp_workspace_document_versions
             (tenant_id,document_id,version,title,content,content_sha256,redaction_count,actor_subject,
              agent_id,session_fingerprint,agent_signature,fencing_token,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [tenantId, documentId, version, title, content, contentSha, redactionCount, actor(identity), presence.agent_id, presence.session_fingerprint, presence.signature, lockId ? fencingToken : null, timestamp],
        );
        const revision = await bumpWorkspaceRevision(client, tenantId);
        const payload = {
          document: publicDocument({
            id: documentId,
            path: documentPath,
            title,
            current_version: version,
            current_content_sha256: contentSha,
            redaction_count: redactionCount,
            created_at: current?.created_at || timestamp,
            updated_at: timestamp,
            created_by_subject: current?.created_by_subject || actor(identity),
            updated_by_subject: actor(identity),
          }),
          created: !current,
          idempotent_replay: false,
          workspace_revision: revision,
        };
        await completeIdempotency(client, identity, "workspace.write_document", reservation, payload);
        return { ...payload, audit: { path: documentPath, version, fencing_token: fencingToken || null, redaction_count: redactionCount } };
      },
    );
    return textResult(result);
  }

  async function acquireLock(args, identity) {
    const resourcePath = logicalPath(args.path, { folder: true });
    const declaredPresence = agentPresence(identity, args);
    const leaseSeconds = Math.min(Math.max(Number(args.lease_seconds) || defaultLeaseSeconds, 30), 300);
    const request = { path: resourcePath, lease_seconds: leaseSeconds, agent_signature: declaredPresence.signature };
    const result = await runGoverned(
      identity,
      {
        action_type: "workspace.lock_acquire",
        action_label: `Acquire workspace lock ${resourcePath}`,
        target: resourcePath,
        payload_sha256: requestDigest(request),
        idempotency_key_sha256: idempotencyKeyDigest(args.idempotency_key),
      },
      async (client) => {
        const tenantId = tenant(identity);
        await tenantTransaction(client, tenantId);
        const presence = await requireOwnedPresence(client, identity, args);
        const reservation = await reserveIdempotency(client, identity, "workspace.lock_acquire", args.idempotency_key, request);
        if (reservation.replay) return { ...reservation.result, idempotent_replay: true, audit: { path: resourcePath, idempotent_replay: true } };
        const taskLease = await client.query(
          `SELECT task.trace_id::text AS trace_id
           FROM agent_task_leases lease
           JOIN agent_tasks task
             ON task.tenant_id=lease.tenant_id AND task.id=lease.task_id
           WHERE lease.tenant_id=$1 AND lease.agent_id=$2
             AND lease.owner_session_fingerprint=$3 AND lease.owner_signature=$4
             AND task.claimed_by=lease.agent_id
             AND task.status IN ('claimed','in_progress','blocked')
             AND lease.expires_at>now()
           ORDER BY task.updated_at DESC
           LIMIT 2
           FOR UPDATE OF lease,task`,
          [tenantId, presence.agent_id, presence.session_fingerprint, presence.signature],
        );
        if (taskLease.rowCount !== 1) fail("workspace_lock_task_lease_required");
        const conflict = await client.query(
          `SELECT lock_id,resource_path,owner_agent_id,lease_expires_at
           FROM mcp_workspace_lock_leases
           WHERE tenant_id=$1 AND released_at IS NULL AND lease_expires_at>now()
             AND (resource_path=$2 OR left(resource_path,length($2)+1)=$2||'/' OR left($2,length(resource_path)+1)=resource_path||'/')
           LIMIT 1 FOR UPDATE`,
          [tenantId, resourcePath],
        );
        if (conflict.rowCount) fail("workspace_lock_conflict");
        const lockId = crypto.randomUUID();
        const row = await client.query(
          `INSERT INTO mcp_workspace_lock_leases
             (tenant_id,lock_id,resource_path,owner_agent_id,owner_session_fingerprint,owner_signature,lease_expires_at,trace_id)
           VALUES ($1,$2,$3,$4,$5,$6,now()+($7::text||' seconds')::interval,$8::uuid)
           RETURNING *`,
          [tenantId, lockId, resourcePath, presence.agent_id, presence.session_fingerprint, presence.signature, leaseSeconds, taskLease.rows[0].trace_id],
        );
        const payload = { lock: publicLock(row.rows[0]), acquired: true, idempotent_replay: false };
        await completeIdempotency(client, identity, "workspace.lock_acquire", reservation, payload);
        return { ...payload, audit: { path: resourcePath, lock_id: lockId, fencing_token: Number(row.rows[0].fencing_token) } };
      },
    );
    return textResult(result);
  }

  async function renewLock(args, identity) {
    const lockId = safeUuid(args.lock_id, "lock_id");
    const fencingToken = Number(args.fencing_token);
    if (!Number.isSafeInteger(fencingToken) || fencingToken < 1) fail("fencing_token_invalid");
    const declaredPresence = agentPresence(identity, args);
    const leaseSeconds = Math.min(Math.max(Number(args.lease_seconds) || defaultLeaseSeconds, 30), 300);
    const request = { lock_id: lockId, fencing_token: fencingToken, lease_seconds: leaseSeconds, agent_signature: declaredPresence.signature };
    const result = await runGoverned(
      identity,
      {
        action_type: "workspace.lock_renew",
        action_label: `Renew workspace lock ${lockId}`,
        target: lockId,
        payload_sha256: requestDigest(request),
        lock_id: lockId,
        fencing_token: fencingToken,
        idempotency_key_sha256: idempotencyKeyDigest(args.idempotency_key),
      },
      async (client) => {
        await tenantTransaction(client, tenant(identity));
        const presence = await requireOwnedPresence(client, identity, args);
        const reservation = await reserveIdempotency(client, identity, "workspace.lock_renew", args.idempotency_key, request);
        if (reservation.replay) return { ...reservation.result, idempotent_replay: true, audit: { lock_id: lockId, idempotent_replay: true } };
        const row = await client.query(
          `UPDATE mcp_workspace_lock_leases
           SET lease_expires_at=now()+($7::text||' seconds')::interval,renewed_at=now(),version=version+1
           WHERE tenant_id=$1 AND lock_id=$2 AND owner_agent_id=$3
             AND owner_session_fingerprint=$4 AND owner_signature=$5 AND fencing_token=$6
             AND released_at IS NULL AND lease_expires_at>now()
           RETURNING *`,
          [tenant(identity), lockId, presence.agent_id, presence.session_fingerprint, presence.signature, fencingToken, leaseSeconds],
        );
        if (!row.rowCount) fail("workspace_lock_stale_or_not_owned");
        const payload = { lock: publicLock(row.rows[0]), renewed: true, idempotent_replay: false };
        await completeIdempotency(client, identity, "workspace.lock_renew", reservation, payload);
        return { ...payload, audit: { lock_id: lockId, fencing_token: fencingToken } };
      },
    );
    return textResult(result);
  }

  async function releaseLock(args, identity) {
    const lockId = safeUuid(args.lock_id, "lock_id");
    const fencingToken = Number(args.fencing_token);
    if (!Number.isSafeInteger(fencingToken) || fencingToken < 1) fail("fencing_token_invalid");
    const declaredPresence = agentPresence(identity, args);
    const request = { lock_id: lockId, fencing_token: fencingToken, agent_signature: declaredPresence.signature };
    const result = await runGoverned(
      identity,
      {
        action_type: "workspace.lock_release",
        action_label: `Release workspace lock ${lockId}`,
        target: lockId,
        payload_sha256: requestDigest(request),
        lock_id: lockId,
        fencing_token: fencingToken,
        idempotency_key_sha256: idempotencyKeyDigest(args.idempotency_key),
      },
      async (client) => {
        await tenantTransaction(client, tenant(identity));
        const presence = await requireOwnedPresence(client, identity, args);
        const row = await client.query(
          `UPDATE mcp_workspace_lock_leases
           SET released_at=coalesce(released_at,now()),version=CASE WHEN released_at IS NULL THEN version+1 ELSE version END
           WHERE tenant_id=$1 AND lock_id=$2 AND owner_agent_id=$3
             AND owner_session_fingerprint=$4 AND owner_signature=$5 AND fencing_token=$6
           RETURNING *`,
          [tenant(identity), lockId, presence.agent_id, presence.session_fingerprint, presence.signature, fencingToken],
        );
        if (!row.rowCount) fail("workspace_lock_stale_or_not_owned");
        return { lock: publicLock(row.rows[0]), released: true, audit: { lock_id: lockId, fencing_token: fencingToken } };
      },
    );
    return textResult(result);
  }

  async function listLocks(args, identity) {
    await initialize();
    const prefix = args.prefix ? logicalPath(args.prefix, { folder: true }) : "";
    const rows = await pool.query(
      `SELECT * FROM mcp_workspace_lock_leases
       WHERE tenant_id=$1
         AND ($2='' OR resource_path=$2 OR left(resource_path,length($2)+1)=$2||'/' OR left($2,length(resource_path)+1)=resource_path||'/')
         AND ($3::boolean=true OR (released_at IS NULL AND lease_expires_at>now()))
       ORDER BY acquired_at DESC LIMIT $4`,
      [tenant(identity), prefix, args.include_inactive === true, Math.min(Math.max(Number(args.limit) || 50, 1), 100)],
    );
    return textResult({ locks: rows.rows.map(publicLock), backend: "postgres" });
  }

  async function findCoordinationBinding(identity) {
    await initialize();
    const tenantId = tenant(identity);
    const presence = agentPresence(identity);
    const sessionId = requiredText(identity?.agentPresence?.session_id, "session_id", 240);
    const tasks = await pool.query(
      `SELECT task.id::text AS contract_id,task.trace_id::text AS trace_id,
              lease.agent_id,sessions.session_id,presence.signature,
              presence.session_fingerprint,task.title,task.updated_at
       FROM agent_task_leases lease
       JOIN agent_tasks task
         ON task.tenant_id=lease.tenant_id AND task.id=lease.task_id
       JOIN agent_presence presence
         ON presence.tenant_id=lease.tenant_id AND presence.agent_id=lease.agent_id
       JOIN agent_sessions sessions
         ON sessions.tenant_id=lease.tenant_id AND sessions.agent_id=lease.agent_id
       WHERE lease.tenant_id=$1 AND lease.agent_id=$2
         AND lease.owner_session_fingerprint=$3 AND lease.owner_signature=$4
         AND task.claimed_by=lease.agent_id
         AND task.status IN ('claimed','in_progress','blocked')
         AND presence.actor_subject=$5 AND presence.signature=$4
         AND presence.session_fingerprint=$3
         AND sessions.actor_subject=$5 AND sessions.session_id=$6
         AND lease.expires_at>now() AND presence.expires_at>now()
         AND sessions.expires_at>now()
       ORDER BY task.updated_at DESC
       LIMIT 2`,
      [tenantId, presence.agent_id, presence.session_fingerprint, presence.signature, actor(identity), sessionId],
    );
    if (tasks.rowCount > 1) fail("coordination_task_binding_ambiguous");
    const task = tasks.rows[0];
    if (!task) return { taskContract: null, coordinationLock: null };
    const locks = await pool.query(
      `SELECT resource_path AS name,trace_id::text AS trace_id,owner_agent_id AS agent_id,
              $6::text AS session_id,owner_signature AS agent_signature,
              owner_session_fingerprint AS session_fingerprint,acquired_at
       FROM mcp_workspace_lock_leases
       WHERE tenant_id=$1 AND owner_agent_id=$2
         AND owner_session_fingerprint=$3 AND owner_signature=$4
         AND trace_id=$5::uuid AND released_at IS NULL AND lease_expires_at>now()
       ORDER BY renewed_at DESC
       LIMIT 2`,
      [tenantId, presence.agent_id, presence.session_fingerprint, presence.signature, task.trace_id, sessionId],
    );
    if (locks.rowCount > 1) fail("coordination_lock_binding_ambiguous");
    const lock = locks.rows[0];
    return {
      taskContract: {
        contract_id: task.contract_id,
        trace_id: task.trace_id,
        agent_id: task.agent_id,
        session_id: task.session_id,
        agent_signature: task.signature,
        session_fingerprint: task.session_fingerprint,
        title: task.title,
        status: "current",
        updated_at: task.updated_at,
        source: "postgres:agent_tasks",
      },
      coordinationLock: lock ? {
        ...lock,
        source: "postgres:mcp_workspace_lock_leases",
      } : null,
    };
  }

  async function appendMemory(record, identity, { kind = "memory", action } = {}) {
    const operation = kind === "checkpoint" ? "memory.checkpoint" : "memory.append";
    return runGoverned(identity, action, async (client) => {
      const tenantId = tenant(identity);
      if (record.agent_id) await requireOwnedPresence(client, identity, { agent_id: record.agent_id });
      const reservation = await reserveIdempotency(client, identity, operation, record.idempotency_key, memoryIdempotencyPayload(record));
      if (reservation.replay) return { ...reservation.result, idempotent_replay: true, audit: { idempotent_replay: true } };
      const stream = kind === "checkpoint" ? await nextStreamRevision(client, tenantId, record) : { stream_key: null, stream_revision: null };
      const stored = { ...record, ...stream };
      await client.query(
        `INSERT INTO mcp_memory_records
           (tenant_id,id,kind,stream_key,stream_revision,project_id,session_id,agent_id,source,importance,
            data_classification,payload,expires_at,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`,
        [tenantId, stored.id, stored.kind, stored.stream_key, stored.stream_revision, stored.project_id, stored.session_id,
          stored.agent_id, stored.source, stored.importance, stored.data_classification, JSON.stringify(stored), stored.expires_at, stored.created_at],
      );
      await insertMemoryEvent(client, tenantId, stored, kind === "checkpoint" ? { checkpoint_id: stored.id } : { memory_id: stored.id });
      const revision = await bumpMemoryRevision(client, tenantId);
      const payload = kind === "checkpoint"
        ? { checkpoint: publicMemoryRecord(stored), created: true, revision }
        : { memory: publicMemoryRecord(stored), created: true, idempotent_replay: false, revision };
      await completeIdempotency(client, identity, operation, reservation, payload);
      return { ...payload, audit: { record_id: stored.id, kind: stored.kind, revision } };
    });
  }

  async function createHandoff(record, identity, action) {
    return runGoverned(identity, action, async (client) => {
      const tenantId = tenant(identity);
      const presence = await requireOwnedPresence(client, identity, { agent_id: record.agent_id });
      if (record.agent_id !== presence.agent_id || record.agent_signature !== presence.signature) fail("agent_presence_conflict");
      if (record.to_agent_id !== "all") {
        const recipient = await client.query(
          "SELECT 1 FROM agent_presence WHERE tenant_id=$1 AND agent_id=$2 AND expires_at>now()",
          [tenantId, record.to_agent_id],
        );
        if (!recipient.rowCount) fail("recipient_not_registered");
      }
      const reservation = await reserveIdempotency(client, identity, "memory.handoff", record.idempotency_key, memoryIdempotencyPayload(record));
      if (reservation.replay) return { ...reservation.result, idempotent_replay: true, audit: { idempotent_replay: true } };
      await client.query(
        `INSERT INTO mcp_memory_handoffs
           (tenant_id,id,from_agent_id,from_agent_signature,to_agent_id,status,payload,project_id,session_id,expires_at,created_at)
         VALUES ($1,$2,$3,$4,$5,'pending',$6::jsonb,$7,$8,$9,$10)`,
        [tenantId, record.id, record.agent_id, record.agent_signature, record.to_agent_id, JSON.stringify(record), record.project_id, record.session_id, record.expires_at, record.created_at],
      );
      await insertMemoryEvent(client, tenantId, {
        kind: "handoff",
        project_id: record.project_id,
        session_id: record.session_id,
        agent_id: record.agent_id,
        source: record.source,
        status: "pending",
        created_at: record.created_at,
        expires_at: record.expires_at,
      }, { handoff_id: record.id, to_agent_id: record.to_agent_id });
      const revision = await bumpMemoryRevision(client, tenantId);
      const payload = { handoff: publicMemoryRecord(record), created: true, revision };
      await completeIdempotency(client, identity, "memory.handoff", reservation, payload);
      return { ...payload, audit: { handoff_id: record.id, to_agent_id: record.to_agent_id, revision } };
    });
  }

  async function acknowledgeHandoff(args, identity, action) {
    const handoffId = String(args.handoff_id || "").trim();
    if (!MEMORY_ID_PATTERN.test(handoffId)) fail("handoff_id_invalid");
    const presence = agentPresence(identity, args);
    return runGoverned(identity, action, async (client) => {
      const tenantId = tenant(identity);
      await requireOwnedPresence(client, identity, args);
      const selected = await client.query(
        `SELECT * FROM mcp_memory_handoffs
         WHERE tenant_id=$1 AND id=$2 AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE`,
        [tenantId, handoffId],
      );
      const row = selected.rows[0];
      if (!row) fail("handoff_not_found");
      if (row.to_agent_id !== "all" && row.to_agent_id !== presence.agent_id) fail("handoff_recipient_mismatch");
      let changed = false;
      let acknowledgedAt = row.acknowledged_at;
      let acknowledgedBy = row.acknowledged_by_agent_id;
      if (row.to_agent_id === "all") {
        const delivery = await client.query(
          `INSERT INTO mcp_memory_handoff_deliveries
             (tenant_id,handoff_id,agent_id,agent_signature)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING
           RETURNING acknowledged_at`,
          [tenantId, handoffId, presence.agent_id, presence.signature],
        );
        changed = delivery.rowCount === 1;
        const persisted = changed ? delivery.rows[0] : (await client.query(
          `SELECT acknowledged_at FROM mcp_memory_handoff_deliveries
           WHERE tenant_id=$1 AND handoff_id=$2 AND agent_id=$3 AND agent_signature=$4`,
          [tenantId, handoffId, presence.agent_id, presence.signature],
        )).rows[0];
        acknowledgedAt = persisted?.acknowledged_at || null;
        acknowledgedBy = presence.agent_id;
      } else if (row.status === "pending") {
        const updated = await client.query(
          `UPDATE mcp_memory_handoffs
           SET status='acknowledged',acknowledged_at=now(),acknowledged_by_agent_id=$3,acknowledged_by_signature=$4
           WHERE tenant_id=$1 AND id=$2
           RETURNING acknowledged_at,acknowledged_by_agent_id`,
          [tenantId, handoffId, presence.agent_id, presence.signature],
        );
        changed = updated.rowCount === 1;
        acknowledgedAt = updated.rows[0]?.acknowledged_at || null;
        acknowledgedBy = updated.rows[0]?.acknowledged_by_agent_id || presence.agent_id;
      } else if (row.acknowledged_by_agent_id !== presence.agent_id || row.acknowledged_by_signature !== presence.signature) {
        fail("handoff_already_acknowledged");
      }
      const revision = changed
        ? await bumpMemoryRevision(client, tenantId)
        : Number((await client.query("SELECT revision FROM mcp_memory_heads WHERE tenant_id=$1", [tenantId])).rows[0]?.revision || 0);
      const handoff = { ...row.payload, status: "acknowledged", acknowledged_at: acknowledgedAt, acknowledged_by: acknowledgedBy };
      return { handoff: publicMemoryRecord(handoff), revision, idempotent_replay: !changed, audit: { handoff_id: handoffId, acknowledged_by: presence.agent_id, revision, idempotent_replay: !changed } };
    });
  }

  async function readMemoryState(tenantIdValue, { agentId = "", identity = null } = {}) {
    await initialize();
    const tenantId = tenant(tenantIdValue);
    let handoffAgentId = "";
    if (agentId && identity && tenant(identity) === tenantId) {
      const presence = agentPresence(identity, { agent_id: agentId });
      const registered = await pool.query(
        `SELECT 1 FROM agent_presence
         WHERE tenant_id=$1 AND agent_id=$2 AND actor_subject=$3
           AND signature=$4 AND session_fingerprint=$5 AND expires_at>now()`,
        [tenantId, presence.agent_id, actor(identity), presence.signature, presence.session_fingerprint],
      );
      if (registered.rowCount) handoffAgentId = presence.agent_id;
    }
    const [head, records, handoffs, events] = await Promise.all([
      pool.query("SELECT revision FROM mcp_memory_heads WHERE tenant_id=$1", [tenantId]),
      pool.query(
        `SELECT payload FROM (
           SELECT payload,created_at FROM mcp_memory_records
           WHERE tenant_id=$1 AND (expires_at IS NULL OR expires_at>now())
           ORDER BY created_at DESC LIMIT 5000
         ) recent ORDER BY created_at ASC`,
        [tenantId],
      ),
      pool.query(
        `SELECT * FROM (
           SELECT h.payload,h.status,h.acknowledged_at,h.acknowledged_by_agent_id,h.created_at,
                  d.acknowledged_at AS delivery_acknowledged_at,
                  CASE WHEN h.to_agent_id='all' AND d.agent_id IS NOT NULL THEN true ELSE false END AS broadcast_acknowledged
           FROM mcp_memory_handoffs h
           LEFT JOIN mcp_memory_handoff_deliveries d
             ON d.tenant_id=h.tenant_id AND d.handoff_id=h.id AND d.agent_id=$2
           WHERE h.tenant_id=$1 AND $2<>''
             AND (h.to_agent_id='all' OR h.to_agent_id=$2)
             AND (h.expires_at IS NULL OR h.expires_at>now())
           ORDER BY h.created_at DESC LIMIT 1000
         ) recent ORDER BY created_at ASC`,
        [tenantId, handoffAgentId],
      ),
      pool.query(
        `SELECT payload FROM (
           SELECT payload,created_at FROM mcp_memory_events
           WHERE tenant_id=$1 AND (expires_at IS NULL OR expires_at>now())
           ORDER BY created_at DESC LIMIT 5000
         ) recent ORDER BY created_at ASC`,
        [tenantId],
      ),
    ]);
    const values = records.rows.map((row) => row.payload);
    return {
      schema_version: "tenant_memory_fabric_v1",
      revision: Number(head.rows[0]?.revision || 0),
      memories: values.filter((record) => record.kind !== "checkpoint"),
      checkpoints: values.filter((record) => record.kind === "checkpoint"),
      handoffs: handoffs.rows.map((row) => ({
        ...row.payload,
        status: row.broadcast_acknowledged ? "acknowledged" : row.status,
        acknowledged_at: row.delivery_acknowledged_at || row.acknowledged_at,
        acknowledged_by: row.broadcast_acknowledged ? handoffAgentId : row.acknowledged_by_agent_id,
      })),
      events: events.rows.map((row) => row.payload),
      audit: [],
    };
  }

  async function recordAutomatic({ checkpoint, event }, identity) {
    const action = {
      action_type: "memory.checkpoint",
      action_label: "Record connected AI lifecycle",
      target: checkpoint.project_id || checkpoint.session_id || checkpoint.id,
      payload_sha256: requestDigest({ checkpoint, event }),
      idempotency_key_sha256: idempotencyKeyDigest(checkpoint.idempotency_key),
    };
    const journalIdentity = {
      ...identity,
      governanceContext: {
        ...(identity?.governanceContext || {}),
        tool_name: "memory_checkpoint",
      },
    };
    return runGoverned(journalIdentity, action, async (client) => {
      const tenantId = tenant(journalIdentity);
      const reservation = await reserveIdempotency(
        client,
        journalIdentity,
        "memory.lifecycle_record",
        checkpoint.idempotency_key,
        { checkpoint: memoryIdempotencyPayload(checkpoint), event },
      );
      if (reservation.replay) return { ...reservation.result, idempotent_replay: true, audit: { checkpoint_id: checkpoint.id, idempotent_replay: true } };
      let checkpointCreated = false;
      const stream = await nextStreamRevision(client, tenantId, checkpoint);
      const stored = { ...checkpoint, ...stream };
      await client.query(
          `INSERT INTO mcp_memory_records
             (tenant_id,id,kind,stream_key,stream_revision,project_id,session_id,agent_id,source,importance,
              data_classification,payload,expires_at,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`,
          [tenantId, stored.id, stored.kind, stored.stream_key, stored.stream_revision, stored.project_id, stored.session_id,
            stored.agent_id, stored.source, stored.importance, stored.data_classification, JSON.stringify(stored), stored.expires_at, stored.created_at],
      );
      await insertMemoryEvent(client, tenantId, stored, { checkpoint_id: stored.id });
      checkpointCreated = true;
      await insertMemoryEvent(client, tenantId, event);
      const revision = await bumpMemoryRevision(client, tenantId);
      const payload = { recorded: true, checkpoint_created: checkpointCreated, revision };
      await completeIdempotency(client, journalIdentity, "memory.lifecycle_record", reservation, payload);
      return { ...payload, audit: { checkpoint_id: checkpoint.id, checkpoint_created: checkpointCreated, revision } };
    });
  }

  return {
    backend: "postgres",
    persistent: true,
    initialize,
    listWorkspace,
    createFolder,
    readDocument,
    inspectBySourcePaths,
    fetchBySourcePaths,
    writeDocument,
    acquireLock,
    renewLock,
    releaseLock,
    listLocks,
    findCoordinationBinding,
    appendMemory,
    createHandoff,
    acknowledgeHandoff,
    readMemoryState,
    recordAutomatic,
    close: () => ownsPool ? pool.end() : Promise.resolve(),
  };
}

export { canonicalize, logicalPath, requestDigest };
