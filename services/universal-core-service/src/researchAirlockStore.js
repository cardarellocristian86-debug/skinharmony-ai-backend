import crypto from "node:crypto";
import { Pool } from "pg";

const STATES = new Set([
  "DISCOVERY_OPEN",
  "EVIDENCE_SEALED",
  "PRIVATE_SYNTHESIS",
  "CLOSED",
  "QUARANTINED",
  "EXPIRED",
]);
const ACTIVE_STATES = new Set(["DISCOVERY_OPEN", "EVIDENCE_SEALED", "PRIVATE_SYNTHESIS"]);

function required(value, name, maximum = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${name}_invalid`);
  return normalized;
}

function json(value, fallback) {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return fallback;
}

function publicWork(row) {
  if (!row) return null;
  return {
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    work_id: row.work_id,
    session_id: row.session_id,
    state: row.state,
    version: Number(row.version),
    allowed_domains: json(row.allowed_domains, []),
    allowed_urls: json(row.allowed_urls, []),
    plan_digest: row.plan_digest,
    policy_snapshot_digest: row.policy_snapshot_digest,
    evidence: json(row.evidence, []),
    evidence_digest: row.evidence_digest,
    capsule: json(row.capsule, null),
    quarantine_reason: row.quarantine_reason,
    release_commit_sha: row.release_commit_sha,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    expires_at: new Date(row.expires_at).toISOString(),
  };
}

function publicCapability(row) {
  if (!row) return null;
  return {
    capability_id: row.capability_id,
    purpose: row.purpose,
    request_digest: row.request_digest,
    issued_at: new Date(row.issued_at).toISOString(),
    expires_at: new Date(row.expires_at).toISOString(),
    consumed_at: row.consumed_at ? new Date(row.consumed_at).toISOString() : null,
    key_version: row.key_version,
  };
}

export function createPostgresResearchAirlockStore({ connectionString, pool = null } = {}) {
  const url = required(connectionString, "research_airlock_database_url", 4_000);
  const db = pool || new Pool({
    connectionString: url,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
    query_timeout: 5_000,
  });
  let initialized = false;

  async function init() {
    if (initialized) return;
    await db.query(`CREATE TABLE IF NOT EXISTS research_airlock_work (
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      work_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      state TEXT NOT NULL,
      version BIGINT NOT NULL DEFAULT 0,
      allowed_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
      allowed_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
      plan_digest TEXT NOT NULL,
      policy_snapshot_digest TEXT NOT NULL,
      evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
      evidence_digest TEXT,
      capsule JSONB,
      quarantine_reason TEXT,
      release_commit_sha TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (tenant_id, project_id, work_id, session_id),
      CHECK (state IN ('DISCOVERY_OPEN','EVIDENCE_SEALED','PRIVATE_SYNTHESIS','CLOSED','QUARANTINED','EXPIRED'))
    )`);
    await db.query("ALTER TABLE research_airlock_work ADD COLUMN IF NOT EXISTS allowed_urls JSONB NOT NULL DEFAULT '[]'::jsonb");
    await db.query(`CREATE TABLE IF NOT EXISTS research_airlock_capability (
      capability_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      work_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      nonce_digest TEXT NOT NULL UNIQUE,
      issued_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      key_version TEXT NOT NULL,
      FOREIGN KEY (tenant_id, project_id, work_id, session_id)
        REFERENCES research_airlock_work (tenant_id, project_id, work_id, session_id) ON DELETE CASCADE
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS research_airlock_session_guard (
      tenant_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      tainted_at TIMESTAMPTZ,
      taint_reason TEXT,
      taint_tool_digest TEXT,
      taint_actor_digest TEXT,
      taint_request_digest TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (tenant_id, session_id)
    )`);
    await db.query("ALTER TABLE research_airlock_session_guard ADD COLUMN IF NOT EXISTS taint_tool_digest TEXT");
    await db.query("ALTER TABLE research_airlock_session_guard ADD COLUMN IF NOT EXISTS taint_actor_digest TEXT");
    await db.query("ALTER TABLE research_airlock_session_guard ADD COLUMN IF NOT EXISTS taint_request_digest TEXT");
    await db.query(`CREATE TABLE IF NOT EXISTS research_airlock_plan (
      plan_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      work_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      allowed_domains JSONB NOT NULL,
      allowed_urls JSONB NOT NULL,
      plan_digest TEXT NOT NULL,
      policy_snapshot_digest TEXT NOT NULL,
      nonce_digest TEXT NOT NULL UNIQUE,
      key_version TEXT NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS research_airlock_fetch (
      fetch_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      work_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      normalized_url_digest TEXT NOT NULL,
      resolved_ip_digest TEXT NOT NULL,
      redirect_chain_digest TEXT NOT NULL,
      response_digest TEXT NOT NULL,
      typed_evidence_digest TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_count INTEGER NOT NULL,
      status_code INTEGER NOT NULL,
      sanitizer_version TEXT NOT NULL,
      injection_verdict TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      FOREIGN KEY (tenant_id, project_id, work_id, session_id)
        REFERENCES research_airlock_work (tenant_id, project_id, work_id, session_id) ON DELETE CASCADE
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS research_airlock_event (
      event_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      work_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      previous_state TEXT,
      next_state TEXT,
      operation TEXT NOT NULL,
      verdict TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      actor_digest TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    )`);
    await db.query("CREATE INDEX IF NOT EXISTS research_airlock_work_tenant_state_idx ON research_airlock_work (tenant_id, state, expires_at)");
    await db.query("CREATE UNIQUE INDEX IF NOT EXISTS research_airlock_work_tenant_session_idx ON research_airlock_work (tenant_id, session_id)");
    await db.query("CREATE INDEX IF NOT EXISTS research_airlock_capability_work_idx ON research_airlock_capability (tenant_id, project_id, work_id, session_id, purpose, expires_at)");
    await db.query("CREATE INDEX IF NOT EXISTS research_airlock_plan_session_idx ON research_airlock_plan (tenant_id, session_id, expires_at)");
    await db.query("CREATE UNIQUE INDEX IF NOT EXISTS research_airlock_plan_unconsumed_session_idx ON research_airlock_plan (tenant_id, session_id) WHERE consumed_at IS NULL");
    await db.query("CREATE INDEX IF NOT EXISTS research_airlock_fetch_work_idx ON research_airlock_fetch (tenant_id, project_id, work_id, session_id, created_at)");
    await db.query("CREATE INDEX IF NOT EXISTS research_airlock_event_work_idx ON research_airlock_event (tenant_id, project_id, work_id, session_id, created_at)");
    initialized = true;
  }

  async function transaction(work, callback) {
    await init();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [work.tenant_id, `${work.project_id}:${work.work_id}:${work.session_id}`]);
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function sessionTransaction(tenantId, sessionId, callback) {
    await init();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [tenantId, `research-airlock-session:${sessionId}`]);
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function lockedWork(client, work) {
    const result = await client.query(`SELECT * FROM research_airlock_work
      WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND session_id=$4 FOR UPDATE`,
    [work.tenant_id, work.project_id, work.work_id, work.session_id]);
    return publicWork(result.rows[0]);
  }

  async function event(client, work, input) {
    await client.query(`INSERT INTO research_airlock_event
      (event_id,tenant_id,project_id,work_id,session_id,previous_state,next_state,operation,verdict,reason_code,actor_digest,request_digest,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
      `rae_${crypto.randomUUID()}`, work.tenant_id, work.project_id, work.work_id, work.session_id,
      input.previous_state || null, input.next_state || null, input.operation, input.verdict,
      input.reason_code, input.actor_digest, input.request_digest, input.created_at,
    ]);
  }

  async function expireLockedWork(client, work, current, input) {
    if (!current || !input.created_at || !ACTIVE_STATES.has(current.state) || new Date(current.expires_at) > new Date(input.created_at)) return current;
    const result = await client.query(`UPDATE research_airlock_work SET state='EXPIRED',version=version+1,updated_at=$5
      WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND session_id=$4 RETURNING *`, [
      work.tenant_id, work.project_id, work.work_id, work.session_id, input.created_at,
    ]);
    await event(client, work, {
      ...input,
      previous_state: current.state,
      next_state: "EXPIRED",
      operation: "ttl_expired",
      verdict: "BLOCK",
      reason_code: "research_airlock_work_expired",
    });
    return publicWork(result.rows[0]);
  }

  async function authorizeUnopenedLocked(client, input) {
    await client.query(`INSERT INTO research_airlock_session_guard
      (tenant_id,session_id,created_at,updated_at) VALUES ($1,$2,$3,$3)
      ON CONFLICT (tenant_id,session_id) DO NOTHING`, [input.tenant_id, input.session_id, input.created_at]);
    const guardResult = await client.query(`SELECT * FROM research_airlock_session_guard
      WHERE tenant_id=$1 AND session_id=$2 FOR UPDATE`, [input.tenant_id, input.session_id]);
    const guard = guardResult.rows[0];
    if (input.safe_preopen === true) {
      if (guard.tainted_at) return { verdict: "BLOCK", reason: "research_airlock_session_preopen_tainted", state: "PREOPEN_TAINTED" };
      return { verdict: "ALLOW", state: "PREOPEN_CLEAN", nyra_core_boundary_only: true };
    }
    await client.query(`UPDATE research_airlock_session_guard SET tainted_at=COALESCE(tainted_at,$3),
      taint_reason=COALESCE(taint_reason,$4),taint_tool_digest=COALESCE(taint_tool_digest,$5),
      taint_actor_digest=COALESCE(taint_actor_digest,$6),taint_request_digest=COALESCE(taint_request_digest,$7),
      updated_at=$3 WHERE tenant_id=$1 AND session_id=$2`, [
      input.tenant_id, input.session_id, input.created_at,
      "research_airlock_private_or_unclassified_tool_before_plan",
      crypto.createHash("sha256").update(String(input.tool_name || "unclassified")).digest("hex"),
      input.actor_digest, input.request_digest,
    ]);
    return { verdict: "ALLOW", state: "PREOPEN_TAINTED", nyra_core_boundary_only: true };
  }

  return {
    kind: "postgresql",
    restart_durable: true,
    distributed: true,
    async init() { await init(); return { ready: true, kind: "postgresql" }; },
    async authorizeUnopenedSession(input) {
      return sessionTransaction(input.tenant_id, input.session_id, (client) => authorizeUnopenedLocked(client, input));
    },
    async resolveSessionAuthorization(input) {
      return sessionTransaction(input.tenant_id, input.session_id, async (client) => {
        const result = await client.query(`SELECT * FROM research_airlock_work
          WHERE tenant_id=$1 AND session_id=$2 ORDER BY created_at DESC LIMIT 2 FOR UPDATE`, [input.tenant_id, input.session_id]);
        if (result.rows.length > 1) throw new Error("research_airlock_session_ambiguous");
        const current = publicWork(result.rows[0]);
        if (current) {
          const resolved = await expireLockedWork(client, current, current, input);
          return { work: resolved, decision: null };
        }
        return { work: null, decision: await authorizeUnopenedLocked(client, input) };
      });
    },
    async issuePlan(input) {
      return sessionTransaction(input.tenant_id, input.session_id, async (client) => {
        await client.query(`INSERT INTO research_airlock_session_guard
          (tenant_id,session_id,created_at,updated_at) VALUES ($1,$2,$3,$3)
          ON CONFLICT (tenant_id,session_id) DO NOTHING`, [input.tenant_id, input.session_id, input.created_at]);
        const guard = await client.query(`SELECT * FROM research_airlock_session_guard
          WHERE tenant_id=$1 AND session_id=$2 FOR UPDATE`, [input.tenant_id, input.session_id]);
        if (guard.rows[0]?.tainted_at) throw new Error("research_airlock_session_preopen_tainted");
        const existingWork = await client.query("SELECT 1 FROM research_airlock_work WHERE tenant_id=$1 AND session_id=$2", [input.tenant_id, input.session_id]);
        if (existingWork.rows[0]) throw new Error("research_airlock_session_already_used");
        await client.query(`INSERT INTO research_airlock_plan
          (plan_id,tenant_id,project_id,work_id,session_id,allowed_domains,allowed_urls,plan_digest,policy_snapshot_digest,nonce_digest,key_version,issued_at,expires_at)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13)`, [
          input.plan_id, input.tenant_id, input.project_id, input.work_id, input.session_id,
          JSON.stringify(input.allowed_domains), JSON.stringify(input.allowed_urls), input.plan_digest,
          input.policy_snapshot_digest, input.nonce_digest, input.key_version, input.issued_at, input.expires_at,
        ]);
        return input.plan_id;
      });
    },
    async consumePlanAndCreateWork(input) {
      return sessionTransaction(input.tenant_id, input.session_id, async (client) => {
        const guard = await client.query(`SELECT * FROM research_airlock_session_guard
          WHERE tenant_id=$1 AND session_id=$2 FOR UPDATE`, [input.tenant_id, input.session_id]);
        if (!guard.rows[0] || guard.rows[0].tainted_at) throw new Error("research_airlock_session_preopen_tainted");
        const planResult = await client.query(`UPDATE research_airlock_plan SET consumed_at=$7
          WHERE plan_id=$1 AND tenant_id=$2 AND project_id=$3 AND work_id=$4 AND session_id=$5
          AND nonce_digest=$6 AND consumed_at IS NULL AND expires_at>$7 RETURNING *`, [
          input.plan_id, input.tenant_id, input.project_id, input.work_id, input.session_id,
          input.nonce_digest, input.created_at,
        ]);
        const plan = planResult.rows[0];
        if (!plan) throw new Error("research_airlock_plan_capability_invalid_or_replayed");
        const result = await client.query(`INSERT INTO research_airlock_work
          (tenant_id,project_id,work_id,session_id,state,version,allowed_domains,allowed_urls,plan_digest,policy_snapshot_digest,evidence,created_at,updated_at,expires_at,release_commit_sha)
          VALUES ($1,$2,$3,$4,'DISCOVERY_OPEN',0,$5::jsonb,$6::jsonb,$7,$8,'[]'::jsonb,$9,$9,$10,$11)
          ON CONFLICT DO NOTHING RETURNING *`, [
          input.tenant_id, input.project_id, input.work_id, input.session_id,
          JSON.stringify(json(plan.allowed_domains, [])), JSON.stringify(json(plan.allowed_urls, [])),
          plan.plan_digest, plan.policy_snapshot_digest, input.created_at, input.expires_at, input.release_commit_sha || null,
        ]);
        if (!result.rows[0]) throw new Error("research_airlock_work_exists");
        await event(client, input, { ...input, previous_state: null, next_state: "DISCOVERY_OPEN", operation: "consume_plan_create", verdict: "ALLOW", reason_code: "research_airlock_plan_consumed_work_created" });
        return publicWork(result.rows[0]);
      });
    },
    async createWork(input) {
      return transaction(input, async (client) => {
        const session = await client.query("SELECT 1 FROM research_airlock_work WHERE tenant_id=$1 AND session_id=$2 FOR UPDATE", [input.tenant_id, input.session_id]);
        if (session.rows[0]) throw new Error("research_airlock_session_already_used");
        const result = await client.query(`INSERT INTO research_airlock_work
          (tenant_id,project_id,work_id,session_id,state,version,allowed_domains,allowed_urls,plan_digest,policy_snapshot_digest,evidence,created_at,updated_at,expires_at,release_commit_sha)
          VALUES ($1,$2,$3,$4,'DISCOVERY_OPEN',0,$5::jsonb,$6::jsonb,$7,$8,'[]'::jsonb,$9,$9,$10,$11)
          ON CONFLICT DO NOTHING RETURNING *`, [
          input.tenant_id, input.project_id, input.work_id, input.session_id, JSON.stringify(input.allowed_domains),
          JSON.stringify(input.allowed_urls), input.plan_digest, input.policy_snapshot_digest, input.created_at, input.expires_at, input.release_commit_sha || null,
        ]);
        if (!result.rows[0]) throw new Error("research_airlock_work_exists");
        await event(client, input, { ...input, previous_state: null, next_state: "DISCOVERY_OPEN", operation: "create", verdict: "ALLOW", reason_code: "research_airlock_work_created" });
        return publicWork(result.rows[0]);
      });
    },
    async getWork(work, input = {}) {
      return transaction(work, async (client) => {
        const current = await lockedWork(client, work);
        return expireLockedWork(client, work, current, input);
      });
    },
    async findActiveWork({ tenant_id, session_id, ...input }) {
      await init();
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(`SELECT * FROM research_airlock_work
          WHERE tenant_id=$1 AND session_id=$2 ORDER BY created_at DESC LIMIT 2 FOR UPDATE`, [tenant_id, session_id]);
        if (result.rows.length > 1) throw new Error("research_airlock_session_ambiguous");
        const current = publicWork(result.rows[0]);
        const resolved = await expireLockedWork(client, current || { tenant_id, project_id: "unknown", work_id: "unknown", session_id }, current, input);
        await client.query("COMMIT");
        return resolved;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async issueCapability(work, input) {
      const outcome = await transaction(work, async (client) => {
        const current = await lockedWork(client, work);
        if (!current) throw new Error("research_airlock_work_not_found");
        const resolved = await expireLockedWork(client, work, current, input);
        if (resolved.state === "EXPIRED") return { expired: true };
        if (resolved.state !== input.required_state) throw new Error("research_airlock_state_denied");
        await client.query(`INSERT INTO research_airlock_capability
          (capability_id,tenant_id,project_id,work_id,session_id,purpose,request_digest,nonce_digest,issued_at,expires_at,key_version)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
          input.capability_id, work.tenant_id, work.project_id, work.work_id, work.session_id,
          input.purpose, input.request_digest, input.nonce_digest, input.issued_at, input.expires_at, input.key_version,
        ]);
        await event(client, work, { ...input, previous_state: resolved.state, next_state: resolved.state, operation: "issue_capability", verdict: "ALLOW", reason_code: `research_airlock_${input.purpose.toLowerCase()}_issued` });
        return { capability_id: input.capability_id };
      });
      if (outcome.expired) throw new Error("research_airlock_work_expired");
      return outcome.capability_id;
    },
    async consumeDiscoveryCapability(work, input) {
      const outcome = await transaction(work, async (client) => {
        const current = await lockedWork(client, work);
        if (!current || current.state !== "DISCOVERY_OPEN") throw new Error("research_airlock_discovery_closed");
        const resolved = await expireLockedWork(client, work, current, input);
        if (resolved.state === "EXPIRED") return { expired: true };
        const capability = await client.query(`UPDATE research_airlock_capability SET consumed_at=$6
          WHERE capability_id=$1 AND tenant_id=$2 AND project_id=$3 AND work_id=$4 AND session_id=$5
          AND purpose='DISCOVERY_FETCH' AND consumed_at IS NULL AND expires_at>$6 AND nonce_digest=$7 AND request_digest=$8 RETURNING *`, [
          input.capability_id, work.tenant_id, work.project_id, work.work_id, work.session_id,
          input.created_at, input.nonce_digest, input.request_digest,
        ]);
        if (!capability.rows[0]) throw new Error("research_airlock_capability_invalid_or_replayed");
        await client.query(`INSERT INTO research_airlock_fetch
          (fetch_id,tenant_id,project_id,work_id,session_id,capability_id,normalized_url_digest,resolved_ip_digest,redirect_chain_digest,response_digest,typed_evidence_digest,content_type,byte_count,status_code,sanitizer_version,injection_verdict,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [
          input.fetch_id, work.tenant_id, work.project_id, work.work_id, work.session_id, input.capability_id,
          input.normalized_url_digest, input.resolved_ip_digest, input.redirect_chain_digest, input.response_digest,
          input.typed_evidence_digest, input.content_type, input.byte_count, input.status_code, input.sanitizer_version,
          input.injection_verdict, input.created_at,
        ]);
        if (input.injection_verdict !== "ALLOW") {
          await client.query(`UPDATE research_airlock_work SET state='QUARANTINED',version=version+1,quarantine_reason=$5,updated_at=$6
            WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND session_id=$4`, [
            work.tenant_id, work.project_id, work.work_id, work.session_id, input.reason_code, input.created_at,
          ]);
          await event(client, work, { ...input, previous_state: current.state, next_state: "QUARANTINED", operation: "discover", verdict: "BLOCK" });
          return { state: "QUARANTINED", evidence: [] };
        }
        const evidence = [...resolved.evidence, input.evidence];
        await client.query(`UPDATE research_airlock_work SET evidence=$5::jsonb,version=version+1,updated_at=$6
          WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND session_id=$4`, [
          work.tenant_id, work.project_id, work.work_id, work.session_id, JSON.stringify(evidence), input.created_at,
        ]);
        await event(client, work, { ...input, previous_state: resolved.state, next_state: resolved.state, operation: "discover", verdict: "ALLOW", reason_code: "research_airlock_fetch_verified" });
        return { state: resolved.state, evidence };
      });
      if (outcome.expired) throw new Error("research_airlock_work_expired");
      return outcome;
    },
    async sealAndIssuePrivateCapability(work, input) {
      const outcome = await transaction(work, async (client) => {
        const current = await lockedWork(client, work);
        if (!current || current.state !== "DISCOVERY_OPEN" || !current.evidence.length) throw new Error("research_airlock_not_sealable");
        const resolved = await expireLockedWork(client, work, current, input);
        if (resolved.state === "EXPIRED") return { expired: true };
        const result = await client.query(`UPDATE research_airlock_work SET state='EVIDENCE_SEALED',version=version+1,
          evidence_digest=$5,capsule=$6::jsonb,updated_at=$7 WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND session_id=$4 RETURNING *`, [
          work.tenant_id, work.project_id, work.work_id, work.session_id, input.evidence_digest, JSON.stringify(input.capsule), input.created_at,
        ]);
        const capability = input.capability;
        await client.query(`INSERT INTO research_airlock_capability
          (capability_id,tenant_id,project_id,work_id,session_id,purpose,request_digest,nonce_digest,issued_at,expires_at,key_version)
          VALUES ($1,$2,$3,$4,$5,'PRIVATE_ENTRY',$6,$7,$8,$9,$10)`, [
          capability.capability_id, work.tenant_id, work.project_id, work.work_id, work.session_id,
          capability.request_digest, capability.nonce_digest, capability.issued_at, capability.expires_at, capability.key_version,
        ]);
        await event(client, work, { ...input, previous_state: resolved.state, next_state: "EVIDENCE_SEALED", operation: "seal_evidence", verdict: "ALLOW", reason_code: "research_airlock_evidence_sealed" });
        await event(client, work, { ...capability, previous_state: "EVIDENCE_SEALED", next_state: "EVIDENCE_SEALED", operation: "issue_capability", verdict: "ALLOW", reason_code: "research_airlock_private_entry_issued" });
        return { work: publicWork(result.rows[0]) };
      });
      if (outcome.expired) throw new Error("research_airlock_work_expired");
      return outcome.work;
    },
    async enterPrivate(work, input) {
      const outcome = await transaction(work, async (client) => {
        const current = await lockedWork(client, work);
        if (!current || current.state !== "EVIDENCE_SEALED") throw new Error("research_airlock_private_entry_denied");
        const resolved = await expireLockedWork(client, work, current, input);
        if (resolved.state === "EXPIRED") return { expired: true };
        const capability = await client.query(`UPDATE research_airlock_capability SET consumed_at=$6
          WHERE capability_id=$1 AND tenant_id=$2 AND project_id=$3 AND work_id=$4 AND session_id=$5
          AND purpose='PRIVATE_ENTRY' AND consumed_at IS NULL AND expires_at>$6 AND nonce_digest=$7 AND request_digest=$8 RETURNING *`, [
          input.capability_id, work.tenant_id, work.project_id, work.work_id, work.session_id,
          input.created_at, input.nonce_digest, input.request_digest,
        ]);
        if (!capability.rows[0]) throw new Error("research_airlock_capability_invalid_or_replayed");
        const result = await client.query(`UPDATE research_airlock_work SET state='PRIVATE_SYNTHESIS',version=version+1,updated_at=$5
          WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND session_id=$4 RETURNING *`, [
          work.tenant_id, work.project_id, work.work_id, work.session_id, input.created_at,
        ]);
        await event(client, work, { ...input, previous_state: resolved.state, next_state: "PRIVATE_SYNTHESIS", operation: "consume_private_cap", verdict: "ALLOW", reason_code: "research_airlock_private_entry_consumed" });
        return { work: publicWork(result.rows[0]) };
      });
      if (outcome.expired) throw new Error("research_airlock_work_expired");
      return outcome.work;
    },
    async closeWork(work, input) {
      const outcome = await transaction(work, async (client) => {
        const current = await lockedWork(client, work);
        if (!current || current.state !== "PRIVATE_SYNTHESIS") throw new Error("research_airlock_close_denied");
        const resolved = await expireLockedWork(client, work, current, input);
        if (resolved.state === "EXPIRED") return { expired: true };
        const result = await client.query(`UPDATE research_airlock_work SET state='CLOSED',version=version+1,updated_at=$5
          WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND session_id=$4 RETURNING *`, [
          work.tenant_id, work.project_id, work.work_id, work.session_id, input.created_at,
        ]);
        await event(client, work, { ...input, previous_state: resolved.state, next_state: "CLOSED", operation: "complete", verdict: "ALLOW", reason_code: "research_airlock_closed" });
        return { work: publicWork(result.rows[0]) };
      });
      if (outcome.expired) throw new Error("research_airlock_work_expired");
      return outcome.work;
    },
    async metrics(tenantId) {
      await init();
      const states = await db.query("SELECT state,count(*)::int AS count FROM research_airlock_work WHERE tenant_id=$1 GROUP BY state", [tenantId]);
      const verdicts = await db.query("SELECT verdict,count(*)::int AS count FROM research_airlock_event WHERE tenant_id=$1 GROUP BY verdict", [tenantId]);
      const guards = await db.query("SELECT count(*)::int AS count FROM research_airlock_session_guard WHERE tenant_id=$1 AND tainted_at IS NOT NULL", [tenantId]);
      const plans = await db.query(`SELECT
        count(*)::int AS issued,
        count(*) FILTER (WHERE consumed_at IS NOT NULL)::int AS consumed,
        count(*) FILTER (WHERE consumed_at IS NULL AND expires_at<=now())::int AS expired_unconsumed
        FROM research_airlock_plan WHERE tenant_id=$1`, [tenantId]);
      return {
        state_counts: Object.fromEntries(states.rows.map((row) => [row.state, row.count])),
        verdict_counts: Object.fromEntries(verdicts.rows.map((row) => [row.verdict, row.count])),
        preopen_tainted_sessions: guards.rows[0]?.count || 0,
        plan_counts: plans.rows[0] || { issued: 0, consumed: 0, expired_unconsumed: 0 },
      };
    },
    async close() { if (!pool) await db.end(); },
  };
}

export function createMemoryResearchAirlockStore() {
  const works = new Map();
  const sessionGuards = new Map();
  const plans = new Map();
  const capabilities = new Map();
  const events = [];
  const key = (work) => [work.tenant_id, work.project_id, work.work_id, work.session_id].join("\u0000");
  const sessionKey = (input) => [input.tenant_id, input.session_id].join("\u0000");
  const clone = (value) => structuredClone(value);
  const expire = (current, input = {}) => {
    if (!current || !input.created_at || !ACTIVE_STATES.has(current.state) || new Date(current.expires_at) > new Date(input.created_at)) return current;
    current.state = "EXPIRED";
    current.version += 1;
    current.updated_at = input.created_at;
    events.push({ tenant_id: current.tenant_id, verdict: "BLOCK", reason_code: "research_airlock_work_expired" });
    return current;
  };
  const authorizeUnopened = (input) => {
    const id = sessionKey(input);
    const guard = sessionGuards.get(id) || {
      tenant_id: input.tenant_id,
      session_id: input.session_id,
      tainted_at: null,
      taint_reason: null,
      taint_tool_digest: null,
      taint_actor_digest: null,
      taint_request_digest: null,
      created_at: input.created_at,
      updated_at: input.created_at,
    };
    sessionGuards.set(id, guard);
    if (input.safe_preopen === true) {
      if (guard.tainted_at) return { verdict: "BLOCK", reason: "research_airlock_session_preopen_tainted", state: "PREOPEN_TAINTED" };
      return { verdict: "ALLOW", state: "PREOPEN_CLEAN", nyra_core_boundary_only: true };
    }
    guard.tainted_at ||= input.created_at;
    guard.taint_reason ||= "research_airlock_private_or_unclassified_tool_before_plan";
    guard.taint_tool_digest ||= crypto.createHash("sha256").update(String(input.tool_name || "unclassified")).digest("hex");
    guard.taint_actor_digest ||= input.actor_digest;
    guard.taint_request_digest ||= input.request_digest;
    guard.updated_at = input.created_at;
    return { verdict: "ALLOW", state: "PREOPEN_TAINTED", nyra_core_boundary_only: true };
  };
  return {
    kind: "memory_test_only", restart_durable: false, distributed: false,
    async init() { return { ready: true, kind: "memory_test_only" }; },
    async authorizeUnopenedSession(input) { return clone(authorizeUnopened(input)); },
    async resolveSessionAuthorization({ tenant_id, session_id, ...input }) {
      const matches = [...works.values()].filter((work) => work.tenant_id === tenant_id && work.session_id === session_id);
      if (matches.length > 1) throw new Error("research_airlock_session_ambiguous");
      const current = expire(matches[0] || null, input);
      if (current) return { work: clone(current), decision: null };
      return { work: null, decision: clone(authorizeUnopened({ tenant_id, session_id, ...input })) };
    },
    async issuePlan(input) {
      const guardId = sessionKey(input);
      const guard = sessionGuards.get(guardId) || {
        tenant_id: input.tenant_id,
        session_id: input.session_id,
        tainted_at: null,
        taint_reason: null,
        taint_tool_digest: null,
        taint_actor_digest: null,
        taint_request_digest: null,
        created_at: input.created_at,
        updated_at: input.created_at,
      };
      sessionGuards.set(guardId, guard);
      if (guard.tainted_at) throw new Error("research_airlock_session_preopen_tainted");
      if ([...works.values()].some((work) => work.tenant_id === input.tenant_id && work.session_id === input.session_id)) {
        throw new Error("research_airlock_session_already_used");
      }
      if ([...plans.values()].some((plan) => plan.tenant_id === input.tenant_id && plan.session_id === input.session_id && !plan.consumed_at)) {
        throw new Error("research_airlock_plan_already_issued");
      }
      plans.set(input.plan_id, { ...input, consumed_at: null });
      return input.plan_id;
    },
    async consumePlanAndCreateWork(input) {
      const guard = sessionGuards.get(sessionKey(input));
      if (!guard || guard.tainted_at) throw new Error("research_airlock_session_preopen_tainted");
      const plan = plans.get(input.plan_id);
      if (!plan
        || plan.tenant_id !== input.tenant_id
        || plan.project_id !== input.project_id
        || plan.work_id !== input.work_id
        || plan.session_id !== input.session_id
        || plan.nonce_digest !== input.nonce_digest
        || plan.consumed_at
        || new Date(plan.expires_at) <= new Date(input.created_at)) {
        throw new Error("research_airlock_plan_capability_invalid_or_replayed");
      }
      if ([...works.values()].some((work) => work.tenant_id === input.tenant_id && work.session_id === input.session_id)) {
        throw new Error("research_airlock_session_already_used");
      }
      const id = key(input);
      if (works.has(id)) throw new Error("research_airlock_work_exists");
      plan.consumed_at = input.created_at;
      const work = {
        ...input,
        allowed_domains: clone(plan.allowed_domains),
        allowed_urls: clone(plan.allowed_urls),
        plan_digest: plan.plan_digest,
        policy_snapshot_digest: plan.policy_snapshot_digest,
        state: "DISCOVERY_OPEN",
        version: 0,
        evidence: [],
        evidence_digest: null,
        capsule: null,
        quarantine_reason: null,
        updated_at: input.created_at,
      };
      works.set(id, work);
      events.push({ tenant_id: input.tenant_id, verdict: "ALLOW" });
      return clone(work);
    },
    async createWork(input) {
      const id = key(input);
      if ([...works.values()].some((work) => work.tenant_id === input.tenant_id && work.session_id === input.session_id)) throw new Error("research_airlock_session_already_used");
      if (works.has(id)) throw new Error("research_airlock_work_exists");
      const work = { ...input, state: "DISCOVERY_OPEN", version: 0, evidence: [], evidence_digest: null, capsule: null, quarantine_reason: null, updated_at: input.created_at };
      works.set(id, work); events.push({ tenant_id: input.tenant_id, verdict: "ALLOW" }); return clone(work);
    },
    async getWork(work, input = {}) { return clone(expire(works.get(key(work)) || null, input)); },
    async findActiveWork({ tenant_id, session_id, ...input }) {
      const matches = [...works.values()].filter((work) => work.tenant_id === tenant_id && work.session_id === session_id);
      if (matches.length > 1) throw new Error("research_airlock_session_ambiguous");
      return clone(expire(matches[0] || null, input));
    },
    async issueCapability(work, input) {
      const current = expire(works.get(key(work)), input);
      if (current?.state === "EXPIRED") throw new Error("research_airlock_work_expired");
      if (!current || current.state !== input.required_state) throw new Error("research_airlock_state_denied");
      capabilities.set(input.capability_id, { ...input, ...work, consumed_at: null });
      return input.capability_id;
    },
    async consumeDiscoveryCapability(work, input) {
      const current = expire(works.get(key(work)), input); const cap = capabilities.get(input.capability_id);
      if (current?.state === "EXPIRED") throw new Error("research_airlock_work_expired");
      if (!current || current.state !== "DISCOVERY_OPEN") throw new Error("research_airlock_discovery_closed");
      if (!cap || cap.consumed_at || cap.nonce_digest !== input.nonce_digest || cap.request_digest !== input.request_digest || new Date(cap.expires_at) <= new Date(input.created_at)) throw new Error("research_airlock_capability_invalid_or_replayed");
      cap.consumed_at = input.created_at;
      if (input.injection_verdict !== "ALLOW") { current.state = "QUARANTINED"; current.quarantine_reason = input.reason_code; current.version += 1; events.push({ tenant_id: work.tenant_id, verdict: "BLOCK" }); return { state: current.state, evidence: [] }; }
      current.evidence.push(input.evidence); current.version += 1; current.updated_at = input.created_at; events.push({ tenant_id: work.tenant_id, verdict: "ALLOW" }); return { state: current.state, evidence: clone(current.evidence) };
    },
    async sealAndIssuePrivateCapability(work, input) {
      const current = expire(works.get(key(work)), input);
      if (current?.state === "EXPIRED") throw new Error("research_airlock_work_expired");
      if (!current || current.state !== "DISCOVERY_OPEN" || !current.evidence.length) throw new Error("research_airlock_not_sealable");
      current.state = "EVIDENCE_SEALED";
      current.version += 1;
      current.evidence_digest = input.evidence_digest;
      current.capsule = input.capsule;
      current.updated_at = input.created_at;
      capabilities.set(input.capability.capability_id, { ...input.capability, ...work, consumed_at: null });
      events.push({ tenant_id: work.tenant_id, verdict: "ALLOW" });
      return clone(current);
    },
    async enterPrivate(work, input) {
      const current = expire(works.get(key(work)), input); const cap = capabilities.get(input.capability_id);
      if (current?.state === "EXPIRED") throw new Error("research_airlock_work_expired");
      if (!current || current.state !== "EVIDENCE_SEALED") throw new Error("research_airlock_private_entry_denied");
      if (!cap || cap.consumed_at || cap.nonce_digest !== input.nonce_digest || cap.request_digest !== input.request_digest || new Date(cap.expires_at) <= new Date(input.created_at)) throw new Error("research_airlock_capability_invalid_or_replayed");
      cap.consumed_at = input.created_at; current.state = "PRIVATE_SYNTHESIS"; current.version += 1; current.updated_at = input.created_at; events.push({ tenant_id: work.tenant_id, verdict: "ALLOW" }); return clone(current);
    },
    async closeWork(work, input) {
      const current = expire(works.get(key(work)), input);
      if (current?.state === "EXPIRED") throw new Error("research_airlock_work_expired");
      if (!current || current.state !== "PRIVATE_SYNTHESIS") throw new Error("research_airlock_close_denied");
      current.state = "CLOSED"; current.version += 1; current.updated_at = input.created_at; events.push({ tenant_id: work.tenant_id, verdict: "ALLOW" }); return clone(current);
    },
    async metrics(tenantId){return{
      state_counts:[...works.values()].filter((work)=>work.tenant_id===tenantId).reduce((a,w)=>(a[w.state]=(a[w.state]||0)+1,a),{}),
      verdict_counts:events.filter((event)=>event.tenant_id===tenantId).reduce((a,e)=>(a[e.verdict]=(a[e.verdict]||0)+1,a),{}),
      preopen_tainted_sessions:[...sessionGuards.values()].filter((guard)=>guard.tenant_id===tenantId&&guard.tainted_at).length,
      plan_counts:[...plans.values()].filter((plan)=>plan.tenant_id===tenantId).reduce((counts,plan)=>{
        counts.issued+=1;
        if(plan.consumed_at) counts.consumed+=1;
        else if(new Date(plan.expires_at)<=new Date()) counts.expired_unconsumed+=1;
        return counts;
      },{issued:0,consumed:0,expired_unconsumed:0}),
    };},
  };
}

export function validateResearchAirlockState(value) {
  return STATES.has(String(value || ""));
}
