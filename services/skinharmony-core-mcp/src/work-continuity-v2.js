import crypto from "node:crypto";

export const WORK_CONTINUITY_V2_SCHEMA_VERSION = "work_continuity_v2";
export const WORK_STATUSES = Object.freeze(["PLANNED", "ACTIVE", "PAUSED", "BLOCKED", "HANDOFF", "COMPLETED", "CANCELLED", "SUPERSEDED", "ARCHIVED"]);
export const OPERATIONAL_STATUSES = new Set(["PLANNED", "ACTIVE", "PAUSED", "BLOCKED", "HANDOFF"]);
export const ARCHIVE_STATUSES = new Set(["COMPLETED", "CANCELLED", "SUPERSEDED", "ARCHIVED"]);
export const CLOSURE_ADAPTERS = Object.freeze(["software_git", "software_non_git", "deployment", "research", "document", "commercial_crm", "hardware", "generic"]);
export const PRIORITIES = Object.freeze(["P0", "P1", "P2", "P3", "P4"]);
const MIN_OVERLAP_SCORE = 16;

export const WORK_CONTINUITY_V2_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tenant_work (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  work_code varchar(128) NOT NULL,
  work_name text NOT NULL,
  work_type varchar(80) NOT NULL,
  project_id varchar(128),
  owner_user_id varchar(128), created_by_user_id varchar(128), team_id varchar(128),
  assigned_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supervising_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  agent_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  visibility_scope varchar(32) NOT NULL DEFAULT 'private',
  created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz, cancelled_at timestamptz,
  status varchar(24) NOT NULL DEFAULT 'PLANNED',
  progress_bp integer NOT NULL DEFAULT 0 CHECK (progress_bp BETWEEN 0 AND 10000),
  progress_version varchar(64) NOT NULL DEFAULT 'work_progress_v1', progress_source varchar(64) NOT NULL DEFAULT 'server_derived',
  priority varchar(8) NOT NULL DEFAULT 'P2', priority_score integer NOT NULL DEFAULT 0,
  intent_digest char(64), parent_work_id uuid, successor_work_id uuid, superseded_by_work_id uuid,
  closure_type varchar(64), closure_reason text, final_evidence_digest char(64),
  PRIMARY KEY (tenant_id, work_id), UNIQUE (tenant_id, work_code),
  CHECK (status IN ('PLANNED','ACTIVE','PAUSED','BLOCKED','HANDOFF','COMPLETED','CANCELLED','SUPERSEDED','ARCHIVED')),
  CHECK (visibility_scope IN ('private','shared','team','tenant')),
  CHECK (priority IN ('P0','P1','P2','P3','P4'))
);
CREATE INDEX IF NOT EXISTS tenant_work_operational_idx ON tenant_work (tenant_id, status, priority_score DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS tenant_work_project_idx ON tenant_work (tenant_id, project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS tenant_work_task (
  tenant_id varchar(64) NOT NULL, task_id uuid NOT NULL, work_id uuid NOT NULL, title text NOT NULL,
  weight integer NOT NULL DEFAULT 1 CHECK (weight > 0), status varchar(24) NOT NULL DEFAULT 'planned',
  acceptance_verified boolean NOT NULL DEFAULT false, completed_at timestamptz,
  PRIMARY KEY (tenant_id, task_id), FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id)
);
CREATE TABLE IF NOT EXISTS tenant_work_evidence (
  tenant_id varchar(64) NOT NULL, evidence_id uuid NOT NULL, work_id uuid NOT NULL, kind varchar(80) NOT NULL,
  digest char(64) NOT NULL, required boolean NOT NULL DEFAULT true, independently_verified boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, evidence_id), FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id)
);
CREATE TABLE IF NOT EXISTS tenant_work_closure_receipt (
  tenant_id varchar(64) NOT NULL, receipt_id uuid NOT NULL, work_id uuid NOT NULL, adapter varchar(64) NOT NULL,
  core_join_digest char(64) NOT NULL, final_evidence_digest char(64) NOT NULL, receipt_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, receipt_id),
  UNIQUE (tenant_id, work_id), FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id)
);
CREATE TABLE IF NOT EXISTS tenant_work_final_report (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, report jsonb NOT NULL, report_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, work_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id)
);
`;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function clampBp(value) {
  return Math.max(0, Math.min(10000, Math.floor(Number(value) || 0)));
}

function authorized(work, actor = {}) {
  if (actor.is_super_admin || actor.is_tenant_owner) return true;
  const userId = String(actor.user_id || "");
  if (!userId) return false;
  return work.owner_user_id === userId || work.created_by_user_id === userId ||
    work.assigned_user_ids?.includes(userId) || work.supervising_user_ids?.includes(userId) ||
    work.visibility_scope === "tenant" || (work.visibility_scope === "team" && actor.team_ids?.includes(work.team_id));
}

export function deriveProgress(tasks = [], evidence = [], closure = {}) {
  const requiredTasks = tasks.filter((task) => task.required !== false);
  const totalTaskWeight = requiredTasks.reduce((sum, task) => sum + Math.max(1, Number(task.weight) || 1), 0);
  const completedWeight = requiredTasks.filter((task) => task.status === "completed" && task.acceptance_verified === true)
    .reduce((sum, task) => sum + Math.max(1, Number(task.weight) || 1), 0);
  const requiredEvidence = evidence.filter((item) => item.required !== false);
  const evidenceWeight = requiredEvidence.reduce((sum, item) => sum + Math.max(1, Number(item.weight) || 1), 0);
  const verifiedWeight = requiredEvidence.filter((item) => item.independently_verified === true)
    .reduce((sum, item) => sum + Math.max(1, Number(item.weight) || 1), 0);
  const task_progress_bp = totalTaskWeight ? Math.round(10000 * completedWeight / totalTaskWeight) : 0;
  const verification_progress_bp = evidenceWeight ? Math.round(10000 * verifiedWeight / evidenceWeight) : 0;
  const closure_progress_bp = closure.core_join_received ? 10000 : closure.independent_verification_passed ? 7000 : closure.evaluated ? 4000 : 0;
  const overall_progress_bp = clampBp((5000 * task_progress_bp + 3500 * verification_progress_bp + 1500 * closure_progress_bp) / 10000);
  return { progress_version: "work_progress_v1", progress_source: "server_derived", task_progress_bp, verification_progress_bp, closure_progress_bp, overall_progress_bp };
}

export function derivePriority(input = {}) {
  const impact = Number(input.business_impact || 0) + Number(input.security_impact || 0) + Number(input.cost_of_delay || 0);
  const score = Math.max(0, Math.min(1000, Math.round(
    3 * Number(input.severity || 0) + 2 * Number(input.urgency || 0) + 2 * impact +
    2 * Number(input.blocking_dependencies || 0) + Number(input.dependent_work_count || 0) +
    Number(input.stale_duration || 0) + Number(input.near_closure_state || 0) - Number(input.duplication_risk || 0),
  )));
  const priority = score >= 700 ? "P0" : score >= 500 ? "P1" : score >= 300 ? "P2" : score >= 100 ? "P3" : "P4";
  return { priority_version: "work_priority_v1", priority, priority_score: score };
}

export function resolveWorkRequest(request, works, actor, options = {}) {
  const normalized = String(request || "").toLowerCase();
  const candidates = works.filter((work) => work.tenant_id === actor.tenant_id && OPERATIONAL_STATUSES.has(work.status))
    .map((work) => {
      const visible = authorized(work, actor);
      const tokens = `${work.work_code || ""} ${work.work_name || ""} ${work.project_id || ""} ${work.next_action || ""}`.toLowerCase();
      const lexical = normalized.split(/\W+/).filter(Boolean).reduce((score, token) => score + (tokens.includes(token) ? 8 : 0), 0);
      const project = options.project_id && work.project_id === options.project_id ? 30 : 0;
      const intent = options.intent_digest && work.intent_digest === options.intent_digest ? 60 : 0;
      const stale = classifyStaleWork(work, options.now).classification === "STALE" ? -15 : 0;
      return { work, visible, score: lexical + project + intent + stale + Math.min(20, Number(work.priority_score || 0) / 50), reasons: { lexical, project, intent, stale } };
    }).sort((a, b) => b.score - a.score);
  const top = candidates[0];
  const second = candidates[1];
  const ambiguous = Boolean(top && second && top.score >= MIN_OVERLAP_SCORE && Math.abs(top.score - second.score) < 10);
  const selected = top && top.score >= MIN_OVERLAP_SCORE && !ambiguous ? top : null;
  return {
    classification: selected ? "CONTINUE_EXISTING" : candidates.some((item) => item.score >= MIN_OVERLAP_SCORE) ? "POSSIBLE_DUPLICATE" : "NO_CONFLICT",
    selected_work_id: selected?.visible ? selected.work.work_id : null,
    requires_owner_decision: Boolean(ambiguous || (!selected && candidates.some((item) => item.score >= 25))),
    candidates: candidates.slice(0, 5).map((item) => item.visible ? { work_id: item.work.work_id, work_code: item.work.work_code, work_name: item.work.work_name, status: item.work.status, score: item.score, reasons: item.reasons } : { invisible_conflict: item.score >= MIN_OVERLAP_SCORE }),
  };
}

export function classifyStaleWork(work, now = new Date()) {
  const at = new Date(now).getTime();
  if (work.successor_work_id || work.superseded_by_work_id || work.status === "SUPERSEDED") return { classification: "SUPERSEDED", reasons: ["successor_or_superseded_relation"] };
  if (work.status === "COMPLETED" && work.closed_at) return { classification: "ACTIVE_VALID", reasons: ["closed"] };
  const effectiveParticipants = (work.participants || []).filter((item) => item.active === true && new Date(item.expires_at).getTime() > at);
  const effectiveLeases = (work.leases || []).filter((item) => item.status === "active" && new Date(item.expires_at).getTime() > at);
  const ageMs = at - new Date(work.updated_at || work.created_at || at).getTime();
  if (OPERATIONAL_STATUSES.has(work.status) && !effectiveParticipants.length && !effectiveLeases.length && ageMs > 24 * 60 * 60 * 1000) return { classification: "STALE", reasons: ["no_effective_presence_or_lease", "stale_update"] };
  if (work.status === "BLOCKED") return { classification: "BLOCKED_VALID", reasons: ["persisted_blocker"] };
  return { classification: "ACTIVE_VALID", reasons: ["effective_presence_or_recent_update"] };
}

export function finalizeGenericClosure(work, input = {}) {
  if (work.status === "COMPLETED" && work.closure_receipt && work.final_report) {
    return { work, receipt: work.closure_receipt, final_report: work.final_report, archive_status: "ARCHIVED", idempotent_replay: true };
  }
  if (!CLOSURE_ADAPTERS.includes(input.adapter)) throw new Error("work_closure_adapter_invalid");
  if (input.independent_verification !== true || input.core_join_received !== true || !input.final_evidence_digest) throw new Error("work_closure_gate_unsatisfied");
  const receipt = { receipt_id: crypto.randomUUID(), work_id: work.work_id, adapter: input.adapter, core_join_digest: input.core_join_digest, final_evidence_digest: input.final_evidence_digest, issued_at: new Date().toISOString() };
  const receipt_digest = digest(receipt);
  const closed_at = new Date().toISOString();
  const final_report = {
    schema_version: "tenant_work_final_report_v1", work_id: work.work_id, work_code: work.work_code, work_name: work.work_name, work_type: work.work_type,
    tenant_id: work.tenant_id, project_id: work.project_id, owner_user_id: work.owner_user_id, team_id: work.team_id,
    intent_digest: work.intent_digest, created_at: work.created_at, started_at: work.started_at, closed_at,
    final_status: "COMPLETED", progress_bp: work.progress_bp, priority: work.priority, objective: work.objective,
    acceptance_criteria: input.acceptance_criteria || [], evidence_summary: input.evidence_summary || [], core_join_digest: input.core_join_digest,
    closure_receipt: { ...receipt, receipt_digest }, final_evidence_digest: input.final_evidence_digest,
  };
  const closure_receipt = { ...receipt, receipt_digest };
  return { work: { ...work, status: "COMPLETED", closed_at, final_evidence_digest: input.final_evidence_digest, closure_type: input.adapter, closure_reason: input.closure_reason || "acceptance_criteria_verified", closure_receipt, final_report }, receipt: closure_receipt, final_report, archive_status: "ARCHIVED", idempotent_replay: false };
}
