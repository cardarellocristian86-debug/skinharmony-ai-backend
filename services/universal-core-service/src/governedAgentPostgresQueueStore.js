import crypto from "node:crypto";
import { Pool } from "pg";

function text(value, field, max = 160) { const normalized = String(value || "").trim(); if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`); return normalized; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function normalizeWorkers(workers) { if (!Array.isArray(workers) || !workers.length || workers.length > 200) throw new Error("queue_workers_invalid"); return workers.map((worker) => ({ worker_id: text(worker.worker_id, "worker_id", 120), agent_id: text(worker.agent_id, "agent_id", 120), task: text(worker.task, "task", 4_000), dependencies: Array.isArray(worker.dependencies) ? worker.dependencies.map((dependency) => text(dependency, "dependency", 120)) : [] })); }
function publicJob(row) { return row ? { ...row, dependencies: Array.isArray(row.dependencies) ? row.dependencies : [], result: row.result || null } : null; }

export function createGovernedAgentPostgresQueueStore({ connectionString, pool = null, now = () => new Date() } = {}) {
  const url = text(connectionString, "governed_agent_database_url", 4_000);
  const db = pool || new Pool({ connectionString: url, max: 4, idleTimeoutMillis: 10_000 }); let initialized = false;
  async function init() { if (initialized) return; await db.query(`CREATE TABLE IF NOT EXISTS governed_agent_queue_jobs (
    job_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, activation_id TEXT NOT NULL, plan_id TEXT NOT NULL, worker_id TEXT NOT NULL, agent_id TEXT NOT NULL, task TEXT NOT NULL,
    dependencies JSONB NOT NULL DEFAULT '[]'::jsonb, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, max_retries INTEGER NOT NULL DEFAULT 1,
    available_at TIMESTAMPTZ NOT NULL, deadline_at TIMESTAMPTZ NOT NULL, claimed_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, expired_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL, result JSONB,
    UNIQUE (tenant_id, activation_id, worker_id)
  )`); await db.query("CREATE INDEX IF NOT EXISTS governed_agent_queue_claim_idx ON governed_agent_queue_jobs (tenant_id, status, available_at, deadline_at)"); initialized = true; }
  async function rows(query, values) { await init(); return (await db.query(query, values)).rows.map(publicJob); }
  return {
    async enqueue({ tenant_id, activation_id, plan_id, workers, deadline_at, max_retries = 1 }) {
      const tenantId=text(tenant_id,"tenant_id",120), activationId=text(activation_id,"activation_id",160), planId=text(plan_id,"plan_id",160), deadline=new Date(deadline_at);
      if (Number.isNaN(deadline.getTime()) || deadline <= now()) throw new Error("queue_deadline_invalid");
      const normalizedWorkers=normalizeWorkers(workers), retries=Math.max(0,Math.min(3,Number(max_retries)||0)), client=await db.connect();
      try { await init(); await client.query("BEGIN"); for (const worker of normalizedWorkers) await client.query(`INSERT INTO governed_agent_queue_jobs (job_id,tenant_id,activation_id,plan_id,worker_id,agent_id,task,dependencies,status,attempts,max_retries,available_at,deadline_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'queued',0,$9,$10,$11,$10) ON CONFLICT (tenant_id,activation_id,worker_id) DO NOTHING`,[`queue_${crypto.randomUUID()}`,tenantId,activationId,planId,worker.worker_id,worker.agent_id,worker.task,JSON.stringify(worker.dependencies),retries,now().toISOString(),deadline.toISOString()]); await client.query("COMMIT"); } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      return rows("SELECT * FROM governed_agent_queue_jobs WHERE tenant_id=$1 AND activation_id=$2 ORDER BY worker_id",[tenantId,activationId]);
    },
    async claim({ tenant_id }) { const tenantId=text(tenant_id,"tenant_id",120); await init(); const result=await db.query(`WITH candidate AS (
      SELECT q.job_id FROM governed_agent_queue_jobs q WHERE q.tenant_id=$1 AND q.status IN ('queued','retry_wait') AND q.available_at<=NOW() AND q.deadline_at>NOW()
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(q.dependencies) AS dependency(worker_id) WHERE NOT EXISTS (SELECT 1 FROM governed_agent_queue_jobs done WHERE done.tenant_id=q.tenant_id AND done.activation_id=q.activation_id AND done.worker_id=dependency.worker_id AND done.status='completed'))
      ORDER BY q.available_at,q.job_id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE governed_agent_queue_jobs q SET status='claimed',claimed_at=NOW(),updated_at=NOW() FROM candidate WHERE q.job_id=candidate.job_id RETURNING q.*`,[tenantId]); return publicJob(result.rows[0]); },
    async complete({ tenant_id, job_id, result = {} }) { const tenantId=text(tenant_id,"tenant_id",120),jobId=text(job_id,"job_id",160); const found=await rows("UPDATE governed_agent_queue_jobs SET status='completed',completed_at=NOW(),updated_at=NOW(),result=$3::jsonb WHERE tenant_id=$1 AND job_id=$2 AND status='claimed' RETURNING *",[tenantId,jobId,JSON.stringify(result&&typeof result==="object"?result:{})]); if(!found[0]) throw new Error("queue_job_not_claimed"); return found[0]; },
    async fail({ tenant_id, job_id }) { const tenantId=text(tenant_id,"tenant_id",120),jobId=text(job_id,"job_id",160); await init(); const client=await db.connect(); try { await client.query("BEGIN"); const current=(await client.query("SELECT * FROM governed_agent_queue_jobs WHERE tenant_id=$1 AND job_id=$2 FOR UPDATE",[tenantId,jobId])).rows[0]; if(!current||current.status!=="claimed") throw new Error("queue_job_not_claimed"); const attempts=current.attempts+1,next=attempts<=current.max_retries?"retry_wait":"failed",available=new Date(now().getTime()+1000*(2**attempts)).toISOString(); const updated=(await client.query("UPDATE governed_agent_queue_jobs SET attempts=$3,status=$4,available_at=$5,updated_at=NOW() WHERE tenant_id=$1 AND job_id=$2 RETURNING *",[tenantId,jobId,attempts,next,available])).rows[0]; await client.query("COMMIT"); return publicJob(updated); } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } },
    async expire({ tenant_id }) { const tenantId=text(tenant_id,"tenant_id",120); await init(); const result=await db.query("UPDATE governed_agent_queue_jobs SET status='expired',expired_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND status IN ('queued','retry_wait','claimed') AND deadline_at<=NOW()",[tenantId]); return {expired:result.rowCount}; },
    async cancelActivation({ tenant_id, activation_id }) { const tenantId=text(tenant_id,"tenant_id",120),activationId=text(activation_id,"activation_id",160); await init(); const result=await db.query("UPDATE governed_agent_queue_jobs SET status='cancelled',updated_at=NOW() WHERE tenant_id=$1 AND activation_id=$2 AND status IN ('queued','retry_wait','claimed')",[tenantId,activationId]); return {cancelled:result.rowCount}; },
    async metrics({ tenant_id }) { const tenantId=text(tenant_id,"tenant_id",120); await init(); const result=await db.query("SELECT status,count(*)::int AS count FROM governed_agent_queue_jobs WHERE tenant_id=$1 GROUP BY status",[tenantId]); const status_counts=Object.fromEntries(result.rows.map((row)=>[row.status,row.count])); const zombies=await db.query("SELECT count(*)::int AS count FROM governed_agent_queue_jobs WHERE tenant_id=$1 AND status='claimed' AND deadline_at<=NOW()",[tenantId]); return {tenant_id:tenantId,job_count:Object.values(status_counts).reduce((sum,count)=>sum+count,0),status_counts,zombie_branches:zombies.rows[0].count}; },
    async close() { if (!pool) await db.end(); },
  };
}