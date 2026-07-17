import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const clone = (v) => JSON.parse(JSON.stringify(v));
const text = (v, f, m = 160) => { const s = String(v || "").trim(); if (!s || s.length > m) throw new Error(`${f}_invalid`); return s; };
const fileFor = (r, t) => path.join(r, crypto.createHash("sha256").update(t).digest("hex"), "queue.json");
const read = (f) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : { jobs: [] };
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const q = `${f}.${process.pid}.${crypto.randomUUID()}.tmp`; fs.writeFileSync(q, JSON.stringify(v), { encoding: "utf8", mode: 0o600 }); fs.renameSync(q, f); };

export function createGovernedAgentQueueStore({ root, now = () => new Date() } = {}) {
  const storageRoot = text(root, "root", 2000), load = (t) => read(fileFor(storageRoot, t)), save = (t, v) => write(fileFor(storageRoot, t), v), iso = () => now().toISOString();
  return {
    enqueue({ tenant_id, activation_id, plan_id, workers, deadline_at, max_retries = 1 }) {
      const t = text(tenant_id, "tenant_id", 120), a = text(activation_id, "activation_id", 160), p = text(plan_id, "plan_id", 160), d = new Date(deadline_at);
      if (!Array.isArray(workers) || !workers.length || workers.length > 200) throw new Error("queue_workers_invalid");
      if (Number.isNaN(d.getTime()) || d <= now()) throw new Error("queue_deadline_invalid");
      const q = load(t), existing = q.jobs.filter((j) => j.activation_id === a); if (existing.length) return clone(existing);
      const jobs = workers.map((w) => ({ job_id: `queue_${crypto.randomUUID()}`, tenant_id:t, activation_id:a, plan_id:p, worker_id:text(w.worker_id,"worker_id",120), agent_id:text(w.agent_id,"agent_id",120), task:text(w.task,"task",4000), dependencies:Array.isArray(w.dependencies)?w.dependencies:[], status:"queued", attempts:0, max_retries:Math.max(0,Math.min(3,Number(max_retries)||0)), available_at:iso(), deadline_at:d.toISOString(), claimed_at:null, completed_at:null, updated_at:iso(), result:null }));
      q.jobs.push(...jobs); save(t,q); return clone(jobs);
    },
    claim({ tenant_id }) { const t=text(tenant_id,"tenant_id",120),q=load(t),n=now(); for(const j of q.jobs) if(["queued","retry_wait"].includes(j.status)&&new Date(j.available_at)<=n&&new Date(j.deadline_at)>n&&j.dependencies.every((d)=>q.jobs.some((x)=>x.worker_id===d&&x.status==="completed"))){j.status="claimed";j.claimed_at=iso();j.updated_at=j.claimed_at;save(t,q);return clone(j);} return null; },
    complete({ tenant_id, job_id, result = {} }) { const t=text(tenant_id,"tenant_id",120),q=load(t),j=q.jobs.find((x)=>x.job_id===text(job_id,"job_id",160)); if(!j||j.status!=="claimed") throw new Error("queue_job_not_claimed");j.status="completed";j.completed_at=iso();j.updated_at=j.completed_at;j.result=result&&typeof result==="object"?clone(result):{};save(t,q);return clone(j); },
    fail({ tenant_id, job_id }) { const t=text(tenant_id,"tenant_id",120),q=load(t),j=q.jobs.find((x)=>x.job_id===text(job_id,"job_id",160));if(!j||j.status!=="claimed")throw new Error("queue_job_not_claimed");j.attempts+=1;j.updated_at=iso();if(j.attempts<=j.max_retries){j.status="retry_wait";j.available_at=new Date(now().getTime()+1000*(2**j.attempts)).toISOString();}else j.status="failed";save(t,q);return clone(j); },
    expire({ tenant_id }) { const t=text(tenant_id,"tenant_id",120),q=load(t);let expired=0;for(const j of q.jobs)if(["queued","retry_wait","claimed"].includes(j.status)&&new Date(j.deadline_at)<=now()){j.status="expired";j.updated_at=iso();j.expired_at=j.updated_at;expired+=1;}if(expired)save(t,q);return {expired}; },
    cancelActivation({ tenant_id, activation_id }) { const t=text(tenant_id,"tenant_id",120),q=load(t);let count=0;for(const j of q.jobs)if(j.activation_id===text(activation_id,"activation_id",160)&&["queued","retry_wait","claimed"].includes(j.status)){j.status="cancelled";j.updated_at=iso();count++;}save(t,q);return {cancelled:count}; },
    metrics({ tenant_id }) { const t=text(tenant_id,"tenant_id",120),jobs=load(t).jobs,status_counts={};for(const j of jobs)status_counts[j.status]=(status_counts[j.status]||0)+1;return {tenant_id:t,job_count:jobs.length,status_counts,zombie_branches:jobs.filter((j)=>j.status==="claimed"&&new Date(j.deadline_at)<=now()).length}; },
  };
}
