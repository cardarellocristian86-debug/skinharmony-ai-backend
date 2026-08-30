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
  objective text,
  next_action text,
  acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  project_id varchar(128),
  owner_user_id varchar(128), created_by_user_id varchar(128), team_id varchar(128),
  assigned_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  supervising_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  agent_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  visibility_scope varchar(32) NOT NULL DEFAULT 'private',
  created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz, cancelled_at timestamptz, archived_at timestamptz,
  status varchar(24) NOT NULL DEFAULT 'PLANNED',
  progress_bp integer NOT NULL DEFAULT 0 CHECK (progress_bp BETWEEN 0 AND 10000),
  progress_version varchar(64) NOT NULL DEFAULT 'work_progress_v1', progress_source varchar(64) NOT NULL DEFAULT 'server_derived',
  priority varchar(8) NOT NULL DEFAULT 'P2', priority_score integer NOT NULL DEFAULT 0,
  priority_version varchar(64) NOT NULL DEFAULT 'work_priority_v1',
  intent_digest char(64), parent_work_id uuid, successor_work_id uuid, superseded_by_work_id uuid,
  closure_type varchar(64), closure_reason text, final_evidence_digest char(64),
  PRIMARY KEY (tenant_id, work_id), UNIQUE (tenant_id, work_code),
  CHECK (status IN ('PLANNED','ACTIVE','PAUSED','BLOCKED','HANDOFF','COMPLETED','CANCELLED','SUPERSEDED','ARCHIVED')),
  CHECK (visibility_scope IN ('private','shared','team','tenant')),
  CHECK (priority IN ('P0','P1','P2','P3','P4'))
);
CREATE INDEX IF NOT EXISTS tenant_work_operational_idx ON tenant_work (tenant_id, status, priority_score DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS tenant_work_project_idx ON tenant_work (tenant_id, project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS tenant_work_code_sequence (
  tenant_id varchar(64) NOT NULL,
  project_id varchar(128) NOT NULL,
  code_date date NOT NULL,
  next_sequence integer NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, code_date)
);

CREATE TABLE IF NOT EXISTS tenant_work_task (
  tenant_id varchar(64) NOT NULL, task_id uuid NOT NULL, work_id uuid NOT NULL, title text NOT NULL,
  weight integer NOT NULL DEFAULT 1 CHECK (weight > 0), required boolean NOT NULL DEFAULT true,
  status varchar(24) NOT NULL DEFAULT 'planned',
  acceptance_verified boolean NOT NULL DEFAULT false, completed_at timestamptz,
  PRIMARY KEY (tenant_id, task_id), FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id)
);
CREATE TABLE IF NOT EXISTS tenant_work_evidence (
  tenant_id varchar(64) NOT NULL, evidence_id uuid NOT NULL, work_id uuid NOT NULL, kind varchar(80) NOT NULL,
  digest char(64) NOT NULL, weight integer NOT NULL DEFAULT 1 CHECK (weight > 0),
  required boolean NOT NULL DEFAULT true, independently_verified boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, evidence_id), FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id)
);
-- A positive native-verifier terminal report may be reflected into V2 only by
-- the server-side bridge. The immutable link preserves exact native-plan,
-- report and receipt provenance; generic evidence writes never gain it.
CREATE TABLE IF NOT EXISTS tenant_work_native_verifier_evidence (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, plan_id uuid NOT NULL,
  task_id varchar(120) NOT NULL, task_digest char(64) NOT NULL,
  verifier_agent_id varchar(120) NOT NULL, verifier_session_fingerprint varchar(128) NOT NULL,
  native_receipt_id uuid NOT NULL, native_receipt_digest char(64) NOT NULL,
  report_digest char(64) NOT NULL, evidence_id uuid NOT NULL, evidence_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, plan_id, task_id),
  UNIQUE (tenant_id, native_receipt_id),
  UNIQUE (tenant_id, evidence_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id),
  FOREIGN KEY (tenant_id, evidence_id) REFERENCES tenant_work_evidence(tenant_id, evidence_id)
);
CREATE OR REPLACE FUNCTION tenant_work_native_verifier_evidence_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'tenant_work_native_verifier_evidence_append_only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tenant_work_native_verifier_evidence_no_mutation
  ON tenant_work_native_verifier_evidence;
CREATE TRIGGER tenant_work_native_verifier_evidence_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_native_verifier_evidence
FOR EACH ROW EXECUTE FUNCTION tenant_work_native_verifier_evidence_append_only();

DROP TRIGGER IF EXISTS tenant_work_native_verifier_evidence_no_truncate
  ON tenant_work_native_verifier_evidence;
CREATE TRIGGER tenant_work_native_verifier_evidence_no_truncate
BEFORE TRUNCATE ON tenant_work_native_verifier_evidence
FOR EACH STATEMENT EXECUTE FUNCTION tenant_work_native_verifier_evidence_append_only();

-- Composite identities make every precommit relation tenant/work-bound at the
-- database layer as well as in the transactional validation below.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_work_task_work_identity_uidx
  ON tenant_work_task(tenant_id, work_id, task_id);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_work_evidence_work_identity_uidx
  ON tenant_work_evidence(tenant_id, work_id, evidence_id);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_work_native_receipt_work_identity_uidx
  ON tenant_work_native_verifier_evidence(tenant_id, work_id, native_receipt_id);

CREATE TABLE IF NOT EXISTS tenant_work_precommit_ticket_gate (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, task_id uuid NOT NULL,
  plan_id uuid NOT NULL, evaluation_id uuid NOT NULL,
  evaluation_digest char(64) NOT NULL, workspace_digest char(64) NOT NULL,
  supersession_digest char(64) NOT NULL, reconciliation_digest char(64) NOT NULL,
  action_kind varchar(40) NOT NULL DEFAULT 'git.commit',
  gate_kind varchar(40) NOT NULL DEFAULT 'ticket_acquisition',
  created_by_user_id varchar(128) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, task_id),
  UNIQUE (tenant_id, work_id, action_kind, gate_kind),
  CHECK (action_kind='git.commit'), CHECK (gate_kind='ticket_acquisition'),
  FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id),
  FOREIGN KEY (tenant_id, work_id, task_id)
    REFERENCES tenant_work_task(tenant_id, work_id, task_id)
);
CREATE TABLE IF NOT EXISTS tenant_work_precommit_evidence_reconciliation (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL,
  legacy_evidence_id uuid NOT NULL, replacement_evidence_id uuid NOT NULL,
  task_id uuid NOT NULL, plan_id uuid NOT NULL, evaluation_id uuid NOT NULL,
  native_receipt_id uuid NOT NULL, native_receipt_digest char(64) NOT NULL,
  replacement_evidence_digest char(64) NOT NULL,
  evaluation_digest char(64) NOT NULL, workspace_digest char(64) NOT NULL,
  supersession_digest char(64) NOT NULL, reconciliation_digest char(64) NOT NULL,
  created_by_user_id varchar(128) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, legacy_evidence_id),
  UNIQUE (tenant_id, work_id, replacement_evidence_id),
  CHECK (legacy_evidence_id<>replacement_evidence_id),
  FOREIGN KEY (tenant_id, work_id, task_id)
    REFERENCES tenant_work_precommit_ticket_gate(tenant_id, work_id, task_id),
  FOREIGN KEY (tenant_id, work_id, legacy_evidence_id)
    REFERENCES tenant_work_evidence(tenant_id, work_id, evidence_id),
  FOREIGN KEY (tenant_id, work_id, replacement_evidence_id)
    REFERENCES tenant_work_evidence(tenant_id, work_id, evidence_id),
  FOREIGN KEY (tenant_id, work_id, native_receipt_id)
    REFERENCES tenant_work_native_verifier_evidence(tenant_id, work_id, native_receipt_id)
);
CREATE TABLE IF NOT EXISTS tenant_work_precommit_ticket_fulfillment (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, task_id uuid NOT NULL,
  ticket_id varchar(160) NOT NULL, ticket_digest char(64) NOT NULL,
  gate_projection_digest char(64) NOT NULL, fulfillment_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, task_id),
  UNIQUE (tenant_id, ticket_id),
  FOREIGN KEY (tenant_id, work_id, task_id)
    REFERENCES tenant_work_precommit_ticket_gate(tenant_id, work_id, task_id)
);
CREATE OR REPLACE FUNCTION tenant_work_precommit_reconciliation_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'tenant_work_precommit_reconciliation_append_only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tenant_work_precommit_ticket_gate_no_mutation
  ON tenant_work_precommit_ticket_gate;
CREATE TRIGGER tenant_work_precommit_ticket_gate_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_precommit_ticket_gate
FOR EACH ROW EXECUTE FUNCTION tenant_work_precommit_reconciliation_append_only();
DROP TRIGGER IF EXISTS tenant_work_precommit_evidence_reconciliation_no_mutation
  ON tenant_work_precommit_evidence_reconciliation;
CREATE TRIGGER tenant_work_precommit_evidence_reconciliation_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_precommit_evidence_reconciliation
FOR EACH ROW EXECUTE FUNCTION tenant_work_precommit_reconciliation_append_only();
DROP TRIGGER IF EXISTS tenant_work_precommit_ticket_fulfillment_no_mutation
  ON tenant_work_precommit_ticket_fulfillment;
CREATE TRIGGER tenant_work_precommit_ticket_fulfillment_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_precommit_ticket_fulfillment
FOR EACH ROW EXECUTE FUNCTION tenant_work_precommit_reconciliation_append_only();

-- A stale v1 gate remains immutable.  Fresh native plan/evaluation evidence
-- advances through this append-only version chain instead of rewriting it.
CREATE TABLE IF NOT EXISTS tenant_work_precommit_ticket_gate_supersession (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, gate_version integer NOT NULL,
  task_id uuid NOT NULL, plan_id uuid NOT NULL, evaluation_id uuid NOT NULL,
  evaluation_digest char(64) NOT NULL, workspace_digest char(64) NOT NULL,
  supersession_digest char(64) NOT NULL, reconciliation_digest char(64) NOT NULL,
  supersedes_reconciliation_digest char(64) NOT NULL,
  action_kind varchar(40) NOT NULL DEFAULT 'git.commit',
  gate_kind varchar(40) NOT NULL DEFAULT 'ticket_acquisition',
  created_by_user_id varchar(128) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, gate_version),
  UNIQUE (tenant_id, work_id, reconciliation_digest),
  CHECK (gate_version>1), CHECK (action_kind='git.commit'),
  CHECK (gate_kind='ticket_acquisition'),
  CHECK (reconciliation_digest<>supersedes_reconciliation_digest),
  FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id),
  FOREIGN KEY (tenant_id, work_id, task_id)
    REFERENCES tenant_work_task(tenant_id, work_id, task_id)
);
CREATE TABLE IF NOT EXISTS tenant_work_precommit_evidence_reconciliation_supersession (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, gate_version integer NOT NULL,
  legacy_evidence_id uuid NOT NULL, replacement_evidence_id uuid NOT NULL,
  task_id uuid NOT NULL, plan_id uuid NOT NULL, evaluation_id uuid NOT NULL,
  native_receipt_id uuid NOT NULL, native_receipt_digest char(64) NOT NULL,
  replacement_evidence_digest char(64) NOT NULL,
  evaluation_digest char(64) NOT NULL, workspace_digest char(64) NOT NULL,
  supersession_digest char(64) NOT NULL, reconciliation_digest char(64) NOT NULL,
  created_by_user_id varchar(128) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, gate_version, legacy_evidence_id),
  UNIQUE (tenant_id, work_id, gate_version, replacement_evidence_id),
  CHECK (legacy_evidence_id<>replacement_evidence_id),
  FOREIGN KEY (tenant_id, work_id, gate_version)
    REFERENCES tenant_work_precommit_ticket_gate_supersession(tenant_id, work_id, gate_version),
  FOREIGN KEY (tenant_id, work_id, legacy_evidence_id)
    REFERENCES tenant_work_evidence(tenant_id, work_id, evidence_id),
  FOREIGN KEY (tenant_id, work_id, replacement_evidence_id)
    REFERENCES tenant_work_evidence(tenant_id, work_id, evidence_id),
  FOREIGN KEY (tenant_id, work_id, native_receipt_id)
    REFERENCES tenant_work_native_verifier_evidence(tenant_id, work_id, native_receipt_id)
);
CREATE TABLE IF NOT EXISTS tenant_work_precommit_ticket_fulfillment_supersession (
  tenant_id varchar(64) NOT NULL, work_id uuid NOT NULL, gate_version integer NOT NULL,
  task_id uuid NOT NULL, ticket_id varchar(160) NOT NULL, ticket_digest char(64) NOT NULL,
  gate_projection_digest char(64) NOT NULL, fulfillment_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, gate_version),
  UNIQUE (tenant_id, ticket_id),
  FOREIGN KEY (tenant_id, work_id, gate_version)
    REFERENCES tenant_work_precommit_ticket_gate_supersession(tenant_id, work_id, gate_version)
);
DROP TRIGGER IF EXISTS tenant_work_precommit_ticket_gate_supersession_no_mutation
  ON tenant_work_precommit_ticket_gate_supersession;
CREATE TRIGGER tenant_work_precommit_ticket_gate_supersession_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_precommit_ticket_gate_supersession
FOR EACH ROW EXECUTE FUNCTION tenant_work_precommit_reconciliation_append_only();
DROP TRIGGER IF EXISTS tenant_work_precommit_evidence_supersession_no_mutation
  ON tenant_work_precommit_evidence_reconciliation_supersession;
CREATE TRIGGER tenant_work_precommit_evidence_supersession_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_precommit_evidence_reconciliation_supersession
FOR EACH ROW EXECUTE FUNCTION tenant_work_precommit_reconciliation_append_only();
DROP TRIGGER IF EXISTS tenant_work_precommit_fulfillment_supersession_no_mutation
  ON tenant_work_precommit_ticket_fulfillment_supersession;
CREATE TRIGGER tenant_work_precommit_fulfillment_supersession_no_mutation
BEFORE UPDATE OR DELETE ON tenant_work_precommit_ticket_fulfillment_supersession
FOR EACH ROW EXECUTE FUNCTION tenant_work_precommit_reconciliation_append_only();
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

export function deriveActorAcl(actor = {}) {
  const tenant_id = String(actor.tenant_id || "");
  const user_id = String(actor.user_id || "");
  const team_ids = [...new Set(Array.isArray(actor.team_ids) ? actor.team_ids.map(String).filter(Boolean) : [])].sort();
  const is_super_admin = actor.is_super_admin === true;
  const is_tenant_owner = actor.is_tenant_owner === true;
  const is_team_manager = actor.is_team_manager === true || Array.isArray(actor.managed_team_ids);
  const managed_team_ids = [...new Set(Array.isArray(actor.managed_team_ids) ? actor.managed_team_ids.map(String).filter(Boolean) : [])].sort();
  return { tenant_id, user_id, team_ids, managed_team_ids, is_super_admin, is_tenant_owner, is_team_manager };
}

export function canActorAccessWork(work = {}, actor = {}) {
  const acl = deriveActorAcl(actor);
  if (!acl.tenant_id || String(work.tenant_id || "") !== acl.tenant_id) return false;
  if (acl.is_super_admin || acl.is_tenant_owner) return true;
  if (!acl.user_id) return false;
  const assigned = Array.isArray(work.assigned_user_ids) ? work.assigned_user_ids.map(String) : [];
  const supervisors = Array.isArray(work.supervising_user_ids) ? work.supervising_user_ids.map(String) : [];
  if ([work.owner_user_id, work.created_by_user_id, ...assigned, ...supervisors].map(String).includes(acl.user_id)) return true;
  if (work.visibility_scope === "tenant" || work.visibility_scope === "shared") return true;
  return work.visibility_scope === "team" && (acl.team_ids.includes(String(work.team_id || "")) ||
    (acl.is_team_manager && acl.managed_team_ids.includes(String(work.team_id || ""))));
}

export function galleryScopeForActor(actor = {}) {
  const acl = deriveActorAcl(actor);
  if (acl.is_super_admin) return "SUPER_ADMIN";
  if (acl.is_tenant_owner) return "TENANT_GALLERY";
  if (acl.is_team_manager) return "TEAM_GALLERY";
  return "MY_GALLERY";
}

function authorized(work, actor = {}) {
  return canActorAccessWork(work, actor);
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
  const visibleCandidates = candidates.filter((item) => item.visible).slice(0, 5).map((item) => ({
    work_id: item.work.work_id, work_code: item.work.work_code, work_name: item.work.work_name,
    status: item.work.status, score: item.score, reasons: item.reasons,
  }));
  const hiddenConflict = candidates.some((item) => !item.visible && item.score >= MIN_OVERLAP_SCORE);
  return {
    classification: selected ? "CONTINUE_EXISTING" : candidates.some((item) => item.score >= MIN_OVERLAP_SCORE) ? "POSSIBLE_DUPLICATE" : "NO_CONFLICT",
    selected_work_id: selected?.visible ? selected.work.work_id : null,
    requires_owner_decision: Boolean(ambiguous || (!selected && candidates.some((item) => item.score >= 25))),
    candidates: visibleCandidates,
    hidden_conflict: hiddenConflict,
  };
}

export function classifyStaleWork(work, now = new Date()) {
  const at = new Date(now).getTime();
  if (work.successor_work_id || work.superseded_by_work_id || work.status === "SUPERSEDED") return { classification: "SUPERSEDED", reasons: ["successor_or_superseded_relation"] };
  if (work.status === "COMPLETED" && !work.closed_at) return { classification: "COMPLETED_BUT_UNCLOSED", reasons: ["completed_without_closed_at"] };
  if (work.status === "COMPLETED" && work.closed_at) return { classification: "ACTIVE_VALID", reasons: ["closed"] };
  if (["CANCELLED", "ARCHIVED"].includes(work.status)) return { classification: "ACTIVE_VALID", reasons: ["terminal_status"] };
  const updatedAt = new Date(work.updated_at || work.created_at || "").getTime();
  if (!Number.isFinite(updatedAt)) return { classification: "UNKNOWN", reasons: ["work_timestamp_missing"] };
  const effectiveParticipants = (work.participants || []).filter((item) => item.active === true && new Date(item.expires_at).getTime() > at);
  const effectiveLeases = (work.leases || []).filter((item) => item.status === "active" && new Date(item.expires_at).getTime() > at);
  const ageMs = at - updatedAt;
  if (ageMs < 0) return { classification: "UNKNOWN", reasons: ["work_timestamp_in_future"] };
  if (OPERATIONAL_STATUSES.has(work.status) && !effectiveParticipants.length && !effectiveLeases.length && ageMs > 30 * 24 * 60 * 60 * 1000) return { classification: "ABANDONED", reasons: ["no_effective_presence_or_lease", "abandoned_update"] };
  if (OPERATIONAL_STATUSES.has(work.status) && !effectiveParticipants.length && !effectiveLeases.length && ageMs > 24 * 60 * 60 * 1000) return { classification: "STALE", reasons: ["no_effective_presence_or_lease", "stale_update"] };
  if (work.status === "BLOCKED") return { classification: "BLOCKED_VALID", reasons: ["persisted_blocker"] };
  return { classification: "ACTIVE_VALID", reasons: ["effective_presence_or_recent_update"] };
}

function verifiedClosureContext(input = {}) {
  const context = input.server_verified_closure_context;
  if (!context || typeof context !== "object" || Array.isArray(context) ||
      context.schema_version !== "work_closure_context_v1" ||
      context.server_verified !== true ||
      context.independent_verification?.passed !== true ||
      context.core_join?.received !== true ||
      !/^[a-f0-9]{64}$/i.test(String(context.core_join?.digest || "")) ||
      !/^[a-f0-9]{64}$/i.test(String(context.final_evidence_digest || ""))) {
    throw new Error("work_closure_verified_context_required");
  }
  return context;
}

export function buildGenericClosureArtifacts(work, input = {}) {
  const context = verifiedClosureContext(input);
  if (!CLOSURE_ADAPTERS.includes(input.adapter)) throw new Error("work_closure_adapter_invalid");
  const receipt = {
    receipt_id: crypto.randomUUID(), work_id: work.work_id, adapter: input.adapter,
    core_join_digest: context.core_join.digest, final_evidence_digest: context.final_evidence_digest,
    issued_at: new Date().toISOString(),
  };
  const receipt_digest = digest(receipt);
  const closed_at = new Date().toISOString();
  const final_report = {
    schema_version: "tenant_work_final_report_v1", work_id: work.work_id, work_code: work.work_code, work_name: work.work_name, work_type: work.work_type,
    tenant_id: work.tenant_id, project_id: work.project_id, owner_user_id: work.owner_user_id, team_id: work.team_id,
    intent_digest: work.intent_digest, created_at: work.created_at, started_at: work.started_at, closed_at,
    final_status: "COMPLETED", progress_bp: work.progress_bp, priority: work.priority, objective: work.objective,
    acceptance_criteria: work.acceptance_criteria || [], evidence_summary: context.evidence_summary || [], core_join_digest: context.core_join.digest,
    closure_receipt: { ...receipt, receipt_digest }, final_evidence_digest: context.final_evidence_digest,
  };
  return { receipt: { ...receipt, receipt_digest }, final_report, closed_at };
}

export function finalizeGenericClosure(work, input = {}) {
  if (work.status === "COMPLETED" && work.closure_receipt && work.final_report) {
    return { work, receipt: work.closure_receipt, final_report: work.final_report, archive_status: "ARCHIVED", idempotent_replay: true };
  }
  const { receipt, final_report, closed_at } = buildGenericClosureArtifacts(work, input);
  return { work: { ...work, status: "COMPLETED", closed_at, final_evidence_digest: receipt.final_evidence_digest, closure_type: input.adapter, closure_reason: input.closure_reason || "acceptance_criteria_verified", closure_receipt: receipt, final_report }, receipt, final_report, archive_status: "ARCHIVED", idempotent_replay: false };
}
