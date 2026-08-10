import crypto from "node:crypto";
import {
  ARCHIVE_STATUSES,
  CLOSURE_ADAPTERS,
  OPERATIONAL_STATUSES,
  WORK_CONTINUITY_V2_SCHEMA_SQL,
  buildGenericClosureArtifacts,
  classifyStaleWork,
  derivePriority,
  deriveProgress,
  resolveWorkRequest,
} from "./work-continuity-v2.js";

const ADDITIVE_SCHEMA_SQL = `
${WORK_CONTINUITY_V2_SCHEMA_SQL}
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS legacy_work_id uuid;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS objective text;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS next_action text;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS created_by_agent_id varchar(128);
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS created_by_session_fingerprint varchar(128);
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS priority_version varchar(64) NOT NULL DEFAULT 'work_priority_v1';
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS priority_context jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tenant_work_task ADD COLUMN IF NOT EXISTS required boolean NOT NULL DEFAULT true;
ALTER TABLE tenant_work_evidence ADD COLUMN IF NOT EXISTS weight integer NOT NULL DEFAULT 1 CHECK (weight > 0);
ALTER TABLE tenant_work_evidence ADD COLUMN IF NOT EXISTS verified_by_agent_id varchar(128);
ALTER TABLE tenant_work_evidence ADD COLUMN IF NOT EXISTS verified_by_session_fingerprint varchar(128);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_work_legacy_identity_idx
  ON tenant_work (tenant_id, legacy_work_id) WHERE legacy_work_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS tenant_work_core_join (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  core_join_digest char(64) NOT NULL,
  core_join_context jsonb NOT NULL,
  persisted_by_user_id varchar(128),
  persisted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES tenant_work(tenant_id, work_id)
);
CREATE TABLE IF NOT EXISTS core_schema_migrations (
  migration_id varchar(160) PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tenant_work ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE TABLE IF NOT EXISTS tenant_work_open_review (
  tenant_id varchar(64) NOT NULL, review_id uuid NOT NULL, request_digest char(64) NOT NULL,
  review_digest char(64) NOT NULL, decision_required boolean NOT NULL, expires_at timestamptz NOT NULL,
  consumed_at timestamptz, consumed_by_user_id varchar(128), decision varchar(48), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,review_id)
);
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS subject_user_id varchar(128);
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS request_id varchar(160);
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS project_id varchar(128);
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS intent_digest char(64);
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS review_result jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS decision_digest char(64);
ALTER TABLE tenant_work_open_review ADD COLUMN IF NOT EXISTS consumed_work_id uuid;
CREATE TABLE IF NOT EXISTS tenant_work_event (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  event_id uuid NOT NULL,
  sequence_number integer NOT NULL,
  event_type varchar(80) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_event_hash char(64),
  event_hash char(64) NOT NULL,
  created_by_user_id varchar(128),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,event_id),
  UNIQUE (tenant_id,work_id,sequence_number),
  FOREIGN KEY (tenant_id,work_id) REFERENCES tenant_work(tenant_id,work_id)
);
INSERT INTO core_schema_migrations (migration_id)
VALUES ('20260808_work_continuity_v2_runtime') ON CONFLICT DO NOTHING;
`;

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code) { throw new Error(code); }
function text(value, code, max = 8_000) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) fail(code);
  return normalized;
}
function uuid(value, code = "work_id_invalid") {
  const normalized = text(value, code, 36);
  if (!UUID.test(normalized)) fail(code);
  return normalized;
}
function digest(value, code = "digest_invalid") {
  const normalized = text(value, code, 64);
  if (!HASH.test(normalized)) fail(code);
  return normalized;
}
function projectCode(projectId) {
  return text(projectId, "project_id_invalid", 128)
    .toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "WORK";
}
function stringArray(value, code, maxItems = 100) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) fail(code);
  return [...new Set(value.map((item) => text(item, code, 128)))];
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function objectDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function deterministicWorkId(tenantId, reviewId, requestDigest) {
  const bytes = crypto.createHash("sha256")
    .update(`tenant-work-v2\0${tenantId}\0${reviewId}\0${requestDigest}`)
    .digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
function canonicalCreateRequest(input = {}) {
  const source = input.create_request && typeof input.create_request === "object" && !Array.isArray(input.create_request)
    ? input.create_request : input;
  const tasks = Array.isArray(source.tasks) ? source.tasks.map((task) => ({
    title: String(task?.title || "").trim(),
    weight: Math.max(1, Number(task?.weight) || 1),
    required: task?.required !== false,
  })) : [];
  return stable({
    intent_type: "CREATE_WORK",
    request_id: String(source.request_id || source.session_id || "").trim(),
    project_id: String(source.project_id || "").trim(),
    session_id: String(source.session_id || "").trim(),
    work_name: String(source.work_name || "").trim(),
    work_type: String(source.work_type || "").trim(),
    objective: String(source.objective || "").trim(),
    next_action: String(source.next_action || "").trim(),
    intent_digest: String(source.intent_digest || "").trim() || null,
    parent_work_id: String(source.parent_work_id || "").trim() || null,
    team_id: String(source.team_id || "").trim() || null,
    visibility_scope: String(source.visibility_scope || "private").trim(),
    acceptance_criteria: Array.isArray(source.acceptance_criteria)
      ? source.acceptance_criteria.map((item) => String(item || "").trim()) : [],
    assigned_user_ids: Array.isArray(source.assigned_user_ids) ? [...source.assigned_user_ids].map(String).sort() : [],
    supervising_user_ids: Array.isArray(source.supervising_user_ids) ? [...source.supervising_user_ids].map(String).sort() : [],
    tasks,
  });
}
function createRequestDigest(input) {
  return objectDigest(canonicalCreateRequest(input));
}
export function deriveAuthenticatedTenantWorkAcl(identity = {}, now = Date.now()) {
  const binding = identity.authenticatedTenantMembership;
  if (!binding || typeof binding !== "object" || Array.isArray(binding) ||
      binding.schema_version !== "tenant_membership_binding_v1" || binding.authenticated !== true) {
    fail("tenant_work_membership_binding_required");
  }
  const tenantId = text(identity.tenantId || identity.tenant_id, "tenant_identity_required", 64);
  const subject = text(identity.subject, "work_actor_identity_required", 128);
  if (text(binding.tenant_id, "tenant_work_membership_binding_invalid", 64) !== tenantId ||
      text(binding.subject, "tenant_work_membership_binding_invalid", 128) !== subject) {
    fail("tenant_work_membership_binding_scope_mismatch");
  }
  const expiresAt = Date.parse(String(binding.expires_at || ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= now) fail("tenant_work_membership_binding_expired");
  const role = String(binding.role || "");
  if (!["member", "team_manager", "tenant_owner", "super_admin"].includes(role)) {
    fail("tenant_work_membership_role_invalid");
  }
  const teamIds = stringArray(binding.team_ids, "tenant_work_membership_binding_invalid");
  const managedTeamIds = stringArray(binding.managed_team_ids, "tenant_work_membership_binding_invalid");
  if (role === "team_manager" && !managedTeamIds.length) fail("tenant_work_membership_manager_scope_required");
  return Object.freeze({
    server_derived: true,
    version: "tenant_work_acl_v1",
    tenant_id: tenantId,
    user_id: subject,
    role,
    team_ids: teamIds,
    managed_team_ids: managedTeamIds,
    assigned_work_ids: stringArray(binding.assigned_work_ids, "tenant_work_membership_binding_invalid"),
    is_tenant_owner: role === "tenant_owner" || role === "super_admin",
    is_super_admin: role === "super_admin",
    expires_at: new Date(expiresAt).toISOString(),
  });
}
function actorFromIdentity(identity = {}) {
  const acl = identity.tenant_work_acl;
  if (!acl || typeof acl !== "object" || Array.isArray(acl) || acl.server_derived !== true) {
    fail("work_server_acl_required");
  }
  const userId = String(identity.userId || identity.user_id || identity.subject || "").trim();
  if (!userId) fail("work_actor_identity_required");
  if (String(acl.user_id || "") !== userId) fail("work_server_acl_subject_mismatch");
  const tenantId = text(identity.tenantId || identity.tenant_id, "tenant_identity_required", 64);
  if (String(acl.tenant_id || "") !== tenantId) fail("work_server_acl_tenant_mismatch");
  const agentId = String(identity.agentPresence?.agent_id || identity.agentId || "").trim() || null;
  const teamIds = acl.team_ids || [];
  const managedTeamIds = acl.managed_team_ids || [];
  if (!Array.isArray(teamIds) || teamIds.some((item) => !String(item || "").trim())) fail("work_actor_team_identity_invalid");
  if (!Array.isArray(managedTeamIds) || managedTeamIds.some((item) => !String(item || "").trim())) fail("work_actor_team_identity_invalid");
  const sessionFingerprint = String(identity.agentPresence?.session_fingerprint || "").trim() || null;
  return {
    tenant_id: tenantId,
    user_id: userId,
    agent_id: agentId,
    session_fingerprint: sessionFingerprint,
    team_ids: [...new Set(teamIds.map((item) => String(item).trim()))],
    managed_team_ids: [...new Set(managedTeamIds.map((item) => String(item).trim()))],
    is_tenant_owner: acl.is_tenant_owner === true,
    is_super_admin: acl.is_super_admin === true,
    core_join_trusted: identity.coreJoinTrusted === true,
  };
}
function isAdmin(actor) {
  return actor.is_super_admin || actor.is_tenant_owner;
}
function sameTenant(work, actor) {
  return Boolean(actor?.tenant_id) && String(work?.tenant_id || "") === actor.tenant_id;
}
function isNamedPrincipal(work, actor) {
  return [work.owner_user_id, work.created_by_user_id]
    .concat(work.assigned_user_ids || [], work.supervising_user_ids || [])
    .filter(Boolean).includes(actor.user_id);
}
export function canRead(work, actor) {
  if (!sameTenant(work, actor)) return false;
  if (isAdmin(actor)) return true;
  if (work.visibility_scope === "tenant" || work.visibility_scope === "shared") return true;
  if (work.visibility_scope === "team" && work.team_id &&
      (actor.team_ids.includes(work.team_id) || actor.managed_team_ids.includes(work.team_id))) return true;
  return isNamedPrincipal(work, actor);
}
export function canRecordTask(work, actor) {
  return sameTenant(work, actor) && (isAdmin(actor) || work.owner_user_id === actor.user_id ||
    (work.assigned_user_ids || []).includes(actor.user_id));
}
export function canContributeEvidence(work, actor) {
  return sameTenant(work, actor) && (canRecordTask(work, actor) || (work.supervising_user_ids || []).includes(actor.user_id));
}
export function canClose(work, actor) {
  return sameTenant(work, actor) && (isAdmin(actor) || work.owner_user_id === actor.user_id ||
    (work.supervising_user_ids || []).includes(actor.user_id));
}
export function canAdminister(work, actor) {
  return sameTenant(work, actor) && (isAdmin(actor) || work.owner_user_id === actor.user_id);
}
function assertPermission(predicate, work, actor) {
  if (!predicate(work, actor)) fail("work_acl_denied");
}
function normalizeWork(row) {
  return {
    ...row,
    assigned_user_ids: Array.isArray(row.assigned_user_ids) ? row.assigned_user_ids : [],
    supervising_user_ids: Array.isArray(row.supervising_user_ids) ? row.supervising_user_ids : [],
    agent_ids: Array.isArray(row.agent_ids) ? row.agent_ids : [],
  };
}
function mapLegacyStatus(status) {
  const value = String(status || "active").toLowerCase();
  if (value === "active") return "ACTIVE";
  if (value === "completed") return "COMPLETED";
  if (value === "blocked" || value === "failed") return "BLOCKED";
  if (value === "release_ready") return "HANDOFF";
  return null;
}
function mapV2StatusToLegacy(status) {
  if (["PLANNED", "ACTIVE", "PAUSED"].includes(status)) return "active";
  if (status === "BLOCKED") return "blocked";
  if (status === "HANDOFF") return "release_ready";
  if (["COMPLETED", "ARCHIVED"].includes(status)) return "completed";
  if (["CANCELLED", "SUPERSEDED"].includes(status)) return "completed";
  return "blocked";
}

export function verifyGenericCoreJoinVerdict(verdict, { publicKey, keyId } = {}) {
  if (!publicKey || !keyId || !verdict || verdict.signature_algorithm !== "ed25519" || verdict.key_id !== keyId ||
      !HASH.test(String(verdict.verdict_digest || "")) || typeof verdict.signature !== "string") return false;
  const { signature, verdict_digest, ...unsigned } = verdict;
  if (objectDigest(unsigned) !== verdict.verdict_digest) return false;
  try { return crypto.verify(null, Buffer.from(`generic_work_core_join_v1\0${verdict.verdict_digest}`), crypto.createPublicKey(publicKey), Buffer.from(signature, "base64url")); } catch { return false; }
}

export function createWorkContinuityV2Store({
  pool,
  now = () => new Date(),
  verifierReceiptSigningSecret = "",
  coreJoinVerifier = null,
  legacyRuntime = null,
  failureInjector = null,
} = {}) {
  if (!pool || typeof pool.query !== "function") fail("work_v2_pool_required");
  let ready;
  const initialize = () => ready ||= pool.query(ADDITIVE_SCHEMA_SQL);
  const query = (...args) => pool.query(...args);
  async function transaction(fn) {
    const client = typeof pool.connect === "function" ? await pool.connect() : pool;
    const transactional = client !== pool;
    try {
      if (transactional) await client.query("BEGIN");
      const result = await fn(client);
      if (transactional) await client.query("COMMIT");
      return result;
    } catch (error) {
      if (transactional) await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release?.(); }
  }
  async function injectFailure(phase, context) {
    if (typeof failureInjector === "function") await failureInjector(phase, context);
  }
  async function loadWork(client, actor, workId, lock = false) {
    const result = await client.query(`SELECT * FROM tenant_work WHERE tenant_id=$1 AND work_id=$2${lock ? " FOR UPDATE" : ""}`,
      [actor.tenant_id, uuid(workId)]);
    const work = result.rows[0] && normalizeWork(result.rows[0]);
    if (!work) fail("tenant_work_not_found");
    return work;
  }
  async function allocateCode(client, actor, projectId) {
    const project = projectCode(projectId);
    const allocated = await client.query(`INSERT INTO tenant_work_code_sequence
      (tenant_id,project_id,code_date,next_sequence)
      VALUES ($1,$2,(now() AT TIME ZONE 'UTC')::date,1)
      ON CONFLICT (tenant_id,project_id,code_date) DO UPDATE
      SET next_sequence=tenant_work_code_sequence.next_sequence+1,updated_at=now()
      RETURNING to_char(code_date,'YYYYMMDD') AS day,next_sequence AS sequence`,
    [actor.tenant_id, project]);
    const day = String(allocated.rows[0]?.day || "");
    const sequence = Number(allocated.rows[0]?.sequence || 0);
    if (!/^\d{8}$/.test(day) || sequence < 1) fail("work_code_allocation_failed");
    return `${project}-${day}-${String(sequence).padStart(4, "0")}`;
  }
  async function appendV2Event(client, actor, workId, eventType, payload = {}) {
    const previous = await client.query(`SELECT sequence_number,event_hash FROM tenant_work_event
      WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`,
    [actor.tenant_id, workId]);
    const sequence = Number(previous.rows[0]?.sequence_number || 0) + 1;
    const event = { tenant_id: actor.tenant_id, work_id: workId, sequence_number: sequence,
      event_type: eventType, payload: stable(payload), previous_event_hash: previous.rows[0]?.event_hash || null };
    const eventHash = objectDigest(event);
    await client.query(`INSERT INTO tenant_work_event
      (tenant_id,work_id,event_id,sequence_number,event_type,payload,previous_event_hash,event_hash,created_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`, [actor.tenant_id, workId, crypto.randomUUID(),
      sequence, eventType, JSON.stringify(event.payload), event.previous_event_hash, eventHash, actor.user_id]);
    return { sequence_number: sequence, event_type: eventType, event_hash: eventHash };
  }
  async function derivePersistedPriorityFacts(client, actor, work) {
    const relations = await client.query(`SELECT
        count(*) FILTER (WHERE parent_work_id=$2 AND status = ANY($3))::int AS dependent_work_count,
        count(*) FILTER (WHERE work_id=$4 AND status = ANY($3))::int AS blocking_dependencies
      FROM tenant_work WHERE tenant_id=$1`, [actor.tenant_id, work.work_id, [...OPERATIONAL_STATUSES], work.parent_work_id]);
    const ageSeconds = Math.max(0, Math.floor((now().getTime() - new Date(work.updated_at || now()).getTime()) / 1000));
    return {
      dependent_work_count: Number(relations.rows[0]?.dependent_work_count || 0),
      blocking_dependencies: Number(relations.rows[0]?.blocking_dependencies || 0),
      stale_duration: Math.min(100, Math.floor(ageSeconds / 86_400)),
      near_closure_state: Math.min(100, Math.floor(Number(work.progress_bp || 0) / 100)),
    };
  }
  async function createWorkWithClient(client, actor, input = {}, { legacyWorkId = null } = {}) {
    const workId = input.work_id ? uuid(input.work_id) : crypto.randomUUID();
    const projectId = text(input.project_id, "project_id_invalid", 128);
    const workName = text(input.work_name, "work_name_invalid", 1_000);
    const workType = text(input.work_type, "work_type_invalid", 80);
    const visibilityScope = ["private", "shared", "team", "tenant"].includes(input.visibility_scope) ? input.visibility_scope : "private";
    if (visibilityScope === "team" && !text(input.team_id, "team_id_required", 128)) fail("team_id_required");
    const priorityFacts = { dependent_work_count: 0, blocking_dependencies: 0, stale_duration: 0, near_closure_state: 0 };
    const priority = derivePriority(priorityFacts);
    const acceptanceCriteria = stringArray(input.acceptance_criteria, "acceptance_criteria_invalid", 250);
    if (!acceptanceCriteria.length) fail("acceptance_criteria_required");
    const assignedUserIds = stringArray(input.assigned_user_ids, "assigned_user_ids_invalid");
    const supervisingUserIds = stringArray(input.supervising_user_ids, "supervising_user_ids_invalid");
    const tasks = Array.isArray(input.tasks) ? input.tasks : [];
    if (!tasks.length || tasks.length > 250) fail("work_tasks_required");
    const existing = await client.query("SELECT * FROM tenant_work WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]);
    if (existing.rows[0]) {
      const row = normalizeWork(existing.rows[0]);
      if (legacyWorkId && row.legacy_work_id !== legacyWorkId) fail("tenant_work_legacy_link_conflict");
      return { work: row, created: false };
    }
      const workCode = await allocateCode(client, actor, projectId);
      await client.query(`INSERT INTO tenant_work
        (tenant_id,work_id,legacy_work_id,work_code,work_name,work_type,project_id,owner_user_id,created_by_user_id,team_id,
         assigned_user_ids,supervising_user_ids,agent_ids,visibility_scope,started_at,status,priority,priority_score,priority_version,priority_context,intent_digest,objective,next_action,created_by_agent_id,created_by_session_fingerprint,acceptance_criteria)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,now(),'ACTIVE',$14,$15,$16,$17::jsonb,$18,$19,$20,$21,$22,$23::jsonb)`,
      [actor.tenant_id, workId, legacyWorkId, workCode, workName, workType, projectId, actor.user_id, input.team_id || null,
        JSON.stringify(assignedUserIds), JSON.stringify(supervisingUserIds), JSON.stringify(actor.agent_id ? [actor.agent_id] : []), visibilityScope,
        priority.priority, priority.priority_score, priority.priority_version, JSON.stringify(priorityFacts),
        input.intent_digest ? digest(input.intent_digest, "intent_digest_invalid") : null,
        String(input.objective || "").slice(0, 8_000) || null, String(input.next_action || "").slice(0, 4_000) || null,
        actor.agent_id, actor.session_fingerprint, JSON.stringify(acceptanceCriteria)]);
      await injectFailure("v2_work_created", { tenant_id: actor.tenant_id, work_id: workId });
      for (const task of tasks) {
        await client.query(`INSERT INTO tenant_work_task
          (tenant_id,task_id,work_id,title,weight,status,required,acceptance_verified)
          VALUES ($1,$2,$3,$4,$5,'planned',$6,false)`, [actor.tenant_id,
          task.task_id ? uuid(task.task_id, "task_id_invalid") : crypto.randomUUID(), workId,
          text(task.title, "task_title_invalid", 2_000), Math.max(1, Number(task.weight) || 1), task.required !== false]);
      }
      await injectFailure("v2_tasks_created", { tenant_id: actor.tenant_id, work_id: workId });
      return { work: await loadWork(client, actor, workId), created: true };
  }
  async function createWork(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    return transaction(async (client) => {
      const created = await createWorkWithClient(client, actor, input, { legacyWorkId: input.legacy_work_id || null });
      if (created.created) await appendV2Event(client, actor, created.work.work_id, "work_v2_created", {
        legacy_work_id: created.work.legacy_work_id || null, request_digest: createRequestDigest(input),
      });
      return created.work;
    });
  }
  async function consumeOpenReviewWithClient(client, actor, input, workId) {
    const reviewId = uuid(input.review_id, "open_work_review_id_required");
    const reviewDigest = digest(input.review_digest, "open_work_review_digest_required");
    const requestDigest = createRequestDigest(input);
    const result = await client.query(`SELECT * FROM tenant_work_open_review
      WHERE tenant_id=$1 AND review_id=$2 FOR UPDATE`, [actor.tenant_id, reviewId]);
    const review = result.rows[0];
    if (!review) fail("open_work_review_not_found");
    if (review.review_digest !== reviewDigest || review.request_digest !== requestDigest ||
        review.subject_user_id !== actor.user_id || (review.project_id && review.project_id !== input.project_id) ||
        (review.intent_digest || null) !== (input.intent_digest || null)) fail("open_work_review_binding_mismatch");
    if (Date.parse(review.expires_at) <= now().getTime()) fail("open_work_review_expired");
    const requestedDecision = String(input.review_decision || "").trim();
    const effectiveDecision = review.decision_required
      ? requestedDecision : (requestedDecision || "NO_CONFLICT_PROCEED");
    if (review.decision_required) {
      if (!isAdmin(actor)) fail("open_work_review_owner_decision_required");
      if (!["CONTINUE_NEW_WORK", "PARALLEL_VALID"].includes(effectiveDecision)) {
        fail("open_work_review_proceed_decision_required");
      }
    }
    const decisionDigest = objectDigest({ tenant_id: actor.tenant_id, review_id: reviewId,
      review_digest: reviewDigest, request_digest: requestDigest, subject_user_id: actor.user_id,
      decision: effectiveDecision, work_id: workId });
    if (review.consumed_at) {
      if (review.consumed_work_id !== workId || review.decision !== effectiveDecision ||
          review.decision_digest !== decisionDigest) fail("open_work_review_replay_denied");
      return { review, decision: effectiveDecision, decision_digest: decisionDigest, idempotent_replay: true };
    }
    const consumed = await client.query(`UPDATE tenant_work_open_review SET
        consumed_at=now(),consumed_by_user_id=$3,decision=$4,decision_digest=$5,consumed_work_id=$6
      WHERE tenant_id=$1 AND review_id=$2 AND consumed_at IS NULL
      RETURNING *`, [actor.tenant_id, reviewId, actor.user_id, effectiveDecision, decisionDigest, workId]);
    if (!consumed.rows[0]) fail("open_work_review_replay_denied");
    return { review: consumed.rows[0], decision: effectiveDecision, decision_digest: decisionDigest, idempotent_replay: false };
  }
  async function createNewWork(identity, input = {}) {
    if (!legacyRuntime || typeof legacyRuntime.ensureWithClient !== "function") fail("legacy_work_transaction_bridge_unavailable");
    await Promise.all([initialize(), legacyRuntime.initialize()]);
    const actor = actorFromIdentity(identity);
    if (!isAdmin(actor)) fail("work_creation_owner_required");
    if (String(input.intent_type || "CREATE_WORK") !== "CREATE_WORK" || input.resume_existing === true) {
      fail("open_work_review_create_intent_required");
    }
    const requestDigest = createRequestDigest(input);
    const reviewId = uuid(input.review_id, "open_work_review_id_required");
    const workId = input.work_id ? uuid(input.work_id) : deterministicWorkId(actor.tenant_id, reviewId, requestDigest);
    return transaction(async (client) => {
      const review = await consumeOpenReviewWithClient(client, actor, input, workId);
      await injectFailure("review_consumed", { tenant_id: actor.tenant_id, work_id: workId, review_id: reviewId });
      const legacy = await legacyRuntime.ensureWithClient(client, identity, { ...input, work_id: workId }, {
        creationAuthorized: true,
      });
      if (legacy.work_id !== workId) fail("legacy_work_identity_mismatch");
      await injectFailure("legacy_created", { tenant_id: actor.tenant_id, work_id: workId, review_id: reviewId });
      const v2 = await createWorkWithClient(client, actor, { ...input, work_id: workId }, { legacyWorkId: workId });
      if (v2.created) {
        await appendV2Event(client, actor, workId, "open_work_review_consumed", {
          review_id: reviewId, review_digest: review.review.review_digest,
          request_digest: requestDigest, decision: review.decision,
          decision_digest: review.decision_digest,
        });
        await appendV2Event(client, actor, workId, "work_v2_created", {
          legacy_work_id: workId, intent_digest: legacy.intent_digest || input.intent_digest || null,
          legacy_event_hash: legacy.event?.event_hash || null,
        });
        await injectFailure("v2_events_created", { tenant_id: actor.tenant_id, work_id: workId, review_id: reviewId });
      }
      return {
        schema_version: "work_continuity_v2",
        work: v2.work,
        legacy_work_id: workId,
        review: { review_id: reviewId, decision: review.decision, consumed: true },
        idempotent_replay: review.idempotent_replay && !v2.created,
      };
    });
  }
  async function projectLegacyWorkWithClient(client, actor, legacyId, suppliedRow = null) {
      const existing = await client.query("SELECT * FROM tenant_work WHERE tenant_id=$1 AND legacy_work_id=$2", [actor.tenant_id, legacyId]);
      if (existing.rows[0]) return normalizeWork(existing.rows[0]);
      const legacy = suppliedRow ? { rows: [suppliedRow] } : await client.query(`SELECT work_id,project_id,parent_work_id,idea,objective,status,created_at,updated_at,next_action
        FROM core_continuity_works WHERE tenant_id=$1 AND work_id=$2`, [actor.tenant_id, legacyId]);
      const row = legacy.rows[0];
      if (!row) fail("legacy_work_not_found");
      const status = mapLegacyStatus(row.status);
      if (!status) fail("legacy_work_status_not_projectable");
      const workCode = await allocateCode(client, actor, row.project_id || "LEGACY");
      await client.query(`INSERT INTO tenant_work
        (tenant_id,work_id,legacy_work_id,work_code,work_name,work_type,project_id,owner_user_id,created_by_user_id,
         assigned_user_ids,supervising_user_ids,agent_ids,visibility_scope,created_at,started_at,updated_at,status,objective,next_action,parent_work_id)
        VALUES ($1,$2,$2,$3,$4,'legacy',$5,NULL,NULL,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'private',$6,$6,$7,$8,$9,$10,$11)`,
      [actor.tenant_id, legacyId, workCode, String(row.idea || row.objective || "Legacy work").slice(0, 1_000), row.project_id || null,
        row.created_at || now(), row.updated_at || now(), status, row.objective || null, row.next_action || null, row.parent_work_id || null]);
      const projected = await loadWork(client, actor, legacyId);
      await appendV2Event(client, actor, legacyId, "legacy_work_projected", {
        legacy_status: row.status, projected_status: status, ownership_invented: false,
      });
      return projected;
  }
  async function projectLegacyWork(identity, { legacy_work_id }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    if (!isAdmin(actor)) fail("legacy_projection_owner_required");
    const legacyId = uuid(legacy_work_id, "legacy_work_id_invalid");
    return transaction(async (client) => {
      return projectLegacyWorkWithClient(client, actor, legacyId);
    });
  }
  async function readWork(identity, { work_id }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    let result = await query("SELECT * FROM tenant_work WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, uuid(work_id)]);
    if (!result.rows[0] && isAdmin(actor)) {
      await projectLegacyWork(identity, { legacy_work_id: work_id });
      result = await query("SELECT * FROM tenant_work WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, uuid(work_id)]);
    }
    const work = result.rows[0] && normalizeWork(result.rows[0]);
    if (!work) fail("tenant_work_not_found");
    assertPermission(canRead, work, actor);
    const [tasks, evidence, receipt, report] = await Promise.all([
      query("SELECT * FROM tenant_work_task WHERE tenant_id=$1 AND work_id=$2 ORDER BY task_id", [actor.tenant_id, work.work_id]),
      query("SELECT * FROM tenant_work_evidence WHERE tenant_id=$1 AND work_id=$2 ORDER BY created_at,evidence_id", [actor.tenant_id, work.work_id]),
      query("SELECT * FROM tenant_work_closure_receipt WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, work.work_id]),
      query("SELECT report,report_digest,created_at FROM tenant_work_final_report WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, work.work_id]),
    ]);
    return { schema_version: "work_continuity_v2", work, tasks: tasks.rows, evidence: evidence.rows,
      closure_receipt: receipt.rows[0] || null, final_report: report.rows[0] || null };
  }
  async function listWorks(identity, { view = "operational", project_id } = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    if (!["my", "team", "tenant", "operational", "archive"].includes(view)) fail("work_gallery_view_invalid");
    if (view === "tenant" && !isAdmin(actor)) fail("tenant_gallery_forbidden");
    if (view === "team" && !actor.team_ids.length && !actor.managed_team_ids.length) fail("team_gallery_forbidden");
    const values = [actor.tenant_id];
    const where = ["tenant_id=$1"];
    if (project_id) { values.push(text(project_id, "project_id_invalid", 128)); where.push(`project_id=$${values.length}`); }
    const rows = await query(`SELECT * FROM tenant_work WHERE ${where.join(" AND ")} ORDER BY priority_score DESC,updated_at DESC`, values);
    const visible = rows.rows.map(normalizeWork).filter((work) => {
      if (view === "archive") return ARCHIVE_STATUSES.has(work.status) && canRead(work, actor);
      if (view === "operational") return OPERATIONAL_STATUSES.has(work.status) && canRead(work, actor);
      if (view === "my") return isNamedPrincipal(work, actor);
      if (view === "team") return work.team_id && (actor.team_ids.includes(work.team_id) || actor.managed_team_ids.includes(work.team_id)) && canRead(work, actor);
      return canRead(work, actor);
    });
    if (view !== "archive" || !visible.length) return visible;
    const reportRows = await query(`SELECT work_id,report_digest,created_at,
        report->>'final_status' AS final_status,
        report->>'closed_at' AS report_closed_at,
        report->>'final_evidence_digest' AS report_final_evidence_digest
      FROM tenant_work_final_report WHERE tenant_id=$1 AND work_id = ANY($2::uuid[])`,
    [actor.tenant_id, visible.map((work) => work.work_id)]);
    const summaries = new Map(reportRows.rows.map((row) => [String(row.work_id), {
      report_digest: row.report_digest,
      created_at: row.created_at,
      final_status: row.final_status || null,
      closed_at: row.report_closed_at || null,
      final_evidence_digest: row.report_final_evidence_digest || null,
    }]));
    return visible.map((work) => ({ ...work, final_report_summary: summaries.get(String(work.work_id)) || null }));
  }
  async function openWorkReview(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    if (String(input.intent_type || "") !== "CREATE_WORK") fail("open_work_review_create_intent_required");
    const proposed = canonicalCreateRequest(input);
    const projectId = text(proposed.project_id, "project_id_invalid", 128);
    const requestId = text(proposed.request_id, "open_work_review_request_id_required", 160);
    const intentDigest = proposed.intent_digest ? digest(proposed.intent_digest, "intent_digest_invalid") : null;
    const works = await listWorks(identity, { view: "operational", project_id: projectId });
    const all = await query("SELECT * FROM tenant_work WHERE tenant_id=$1 AND status = ANY($2)", [actor.tenant_id, [...OPERATIONAL_STATUSES]]);
    const normalizedWorks = all.rows.map(normalizeWork);
    const review = resolveWorkRequest(text(input.request || `${proposed.work_name} ${proposed.objective}`, "work_review_request_invalid", 8_000), normalizedWorks, actor, {
      project_id: projectId, intent_digest: intentDigest, now: now(),
    });
    const visibleIds = new Set(works.map((work) => work.work_id));
    const related = normalizedWorks.filter((work) => work.project_id === projectId);
    const staleConflict = related.some((work) => ["STALE", "ABANDONED", "COMPLETED_BUT_UNCLOSED"]
      .includes(classifyStaleWork(work, now()).classification));
    const priorityConflict = related.some((work) => ["P0", "P1"].includes(work.priority));
    const dependencyConflict = Boolean(proposed.parent_work_id && related.some((work) =>
      work.work_id === proposed.parent_work_id && OPERATIONAL_STATUSES.has(work.status)));
    const significantOverlap = review.classification !== "NO_CONFLICT" || review.hidden_conflict === true;
    const conflictFlags = {
      significant_overlap: significantOverlap,
      stale: staleConflict,
      priority: priorityConflict,
      dependency: dependencyConflict,
      invisible_conflict: review.hidden_conflict === true,
    };
    const result = { ...review,
      requires_owner_decision: Object.values(conflictFlags).some(Boolean),
      candidates: review.candidates.filter((candidate) => visibleIds.has(candidate.work_id)),
      conflict_flags: conflictFlags,
      hidden_conflict: review.hidden_conflict === true,
    };
    const requestDigest = createRequestDigest(input);
    const reviewId = crypto.randomUUID(); const expiresAt = new Date(now().getTime() + 10 * 60_000).toISOString();
    const reviewDigest = objectDigest({ tenant_id: actor.tenant_id, subject_user_id: actor.user_id,
      review_id: reviewId, request_id: requestId, request_digest: requestDigest, result, expires_at: expiresAt });
    await query(`INSERT INTO tenant_work_open_review
      (tenant_id,review_id,subject_user_id,request_id,project_id,intent_digest,request_digest,review_digest,review_result,decision_required,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`, [actor.tenant_id, reviewId, actor.user_id,
      requestId, projectId, intentDigest, requestDigest, reviewDigest, JSON.stringify(result), result.requires_owner_decision, expiresAt]);
    return { ...result, review_id: reviewId, review_digest: reviewDigest, request_digest: requestDigest,
      subject_user_id: actor.user_id, request_id: requestId, expires_at: expiresAt };
  }
  async function projectLegacyCatalog(identity, { project_id, limit = 50 } = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    if (!isAdmin(actor)) return { projected: 0 };
    const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const legacy = await query(`SELECT w.work_id,w.project_id,w.parent_work_id,w.idea,w.objective,w.status,w.created_at,w.updated_at,w.next_action
      FROM core_continuity_works w
      LEFT JOIN tenant_work tw ON tw.tenant_id=w.tenant_id AND tw.legacy_work_id=w.work_id
      WHERE w.tenant_id=$1 AND ($2::varchar IS NULL OR w.project_id=$2) AND tw.work_id IS NULL
      ORDER BY w.updated_at DESC LIMIT $3`, [actor.tenant_id, project_id || null, boundedLimit]);
    let projected = 0;
    await transaction(async (client) => {
      for (const row of legacy.rows) {
        if (!mapLegacyStatus(row.status)) continue;
        await projectLegacyWorkWithClient(client, actor, row.work_id, row);
        projected += 1;
      }
    });
    return { projected };
  }
  async function preflightGallery(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    await projectLegacyCatalog(identity, { project_id: input.project_id, limit: input.limit || 50 });
    const works = await listWorks(identity, { view: "operational", project_id: input.project_id });
    const limited = works.slice(0, Math.max(1, Math.min(200, Number(input.limit) || 20)));
    const rows = [];
    for (const work of limited) {
      const sourceId = work.legacy_work_id || work.work_id;
      const activity = await query(`SELECT
          count(DISTINCT p.session_id) FILTER (WHERE p.status='active' AND p.expires_at>now())::int AS active_participants,
          count(DISTINCT l.lease_id) FILTER (WHERE l.status='active' AND l.expires_at>now())::int AS active_leases,
          count(DISTINCT b.branch_id) FILTER (WHERE b.status='active')::int AS active_branches
        FROM core_continuity_works w
        LEFT JOIN core_continuity_participants p ON p.tenant_id=w.tenant_id AND p.work_id=w.work_id
        LEFT JOIN core_continuity_leases l ON l.tenant_id=w.tenant_id AND l.work_id=w.work_id
        LEFT JOIN core_continuity_branches b ON b.tenant_id=w.tenant_id AND b.work_id=w.work_id
        WHERE w.tenant_id=$1 AND w.work_id=$2`, [actor.tenant_id, sourceId]);
      rows.push({
        tenant_id: actor.tenant_id, project_id: work.project_id, work_id: sourceId,
        parent_work_id: work.parent_work_id || null, idea: work.work_name, objective: work.objective,
        status: mapV2StatusToLegacy(work.status), current_version: 2, next_action: work.next_action || "",
        updated_at: work.updated_at, active_participants: Number(activity.rows[0]?.active_participants || 0),
        active_leases: Number(activity.rows[0]?.active_leases || 0),
        active_branches: Number(activity.rows[0]?.active_branches || 0), blockers: [], blocker_count: 0,
        work_code: work.work_code, work_name: work.work_name, work_type: work.work_type,
        progress_bp: work.progress_bp, priority: work.priority, priority_score: work.priority_score,
        continuity_v2: true,
      });
    }
    return { schema_version: "tenant_work_gallery_v1", source_schema_version: "work_continuity_v2",
      tenant_id: actor.tenant_id, filters: { project_id: input.project_id || null, status: "active", query: null }, works: rows };
  }
  async function recordTask(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id);
    const taskId = input.task_id ? uuid(input.task_id, "task_id_invalid") : crypto.randomUUID();
    await transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canRecordTask, work, actor);
      await client.query(`INSERT INTO tenant_work_task (tenant_id,task_id,work_id,title,weight,status,required,acceptance_verified,completed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,false,CASE WHEN $6='completed' THEN now() ELSE NULL END)
        ON CONFLICT (tenant_id,task_id) DO UPDATE SET title=EXCLUDED.title,weight=EXCLUDED.weight,status=EXCLUDED.status,required=EXCLUDED.required,completed_at=EXCLUDED.completed_at`,
      [actor.tenant_id, taskId, workId, text(input.title, "task_title_invalid", 2_000), Math.max(1, Number(input.weight) || 1),
        input.status === "completed" ? "completed" : "planned", input.required !== false]);
    });
    return refreshDerived(identity, { work_id: workId });
  }
  async function recordEvidence(identity, input = {}) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(input.work_id);
    const evidenceId = input.evidence_id ? uuid(input.evidence_id, "evidence_id_invalid") : crypto.randomUUID();
    await transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canContributeEvidence, work, actor);
      const nativeVerifier = actor.agent_id && actor.session_fingerprint
        ? await client.query(`SELECT task_id FROM core_continuity_native_agents
          WHERE tenant_id=$1 AND work_id=$2 AND agent_id=$3 AND task_kind='verifier'
            AND status='completed' AND native_session_fingerprint=$4 LIMIT 1`,
        [actor.tenant_id, work.legacy_work_id || workId, actor.agent_id, actor.session_fingerprint])
        : { rows: [] };
      const independentlyVerified = Boolean(nativeVerifier.rows[0] &&
        actor.agent_id && actor.session_fingerprint && actor.agent_id !== work.created_by_agent_id &&
        actor.session_fingerprint !== work.created_by_session_fingerprint);
      await client.query(`INSERT INTO tenant_work_evidence (tenant_id,evidence_id,work_id,kind,digest,required,independently_verified,verified_by_agent_id,verified_by_session_fingerprint,weight,metadata)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
        ON CONFLICT (tenant_id,evidence_id) DO NOTHING`,
      [actor.tenant_id, evidenceId, workId, text(input.kind, "evidence_kind_invalid", 80), digest(input.digest, "evidence_digest_invalid"),
        input.required !== false, independentlyVerified, independentlyVerified ? actor.agent_id : null,
        independentlyVerified ? actor.session_fingerprint : null, Math.max(1, Number(input.weight) || 1), JSON.stringify(input.metadata || {})]);
      if (independentlyVerified && input.metadata?.task_id) {
        await client.query(`UPDATE tenant_work_task SET acceptance_verified=true
          WHERE tenant_id=$1 AND work_id=$2 AND task_id=$3 AND status='completed'`,
        [actor.tenant_id, workId, uuid(input.metadata.task_id, "task_id_invalid")]);
      }
    });
    return refreshDerived(identity, { work_id: workId });
  }
  async function persistCoreJoin(identity, { work_id, core_join_digest, core_join_context }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    if (actor.core_join_trusted !== true) fail("core_join_trust_required");
    if (!coreJoinVerifier || !verifyGenericCoreJoinVerdict(core_join_context, coreJoinVerifier)) fail("generic_core_join_signature_invalid");
    const workId = uuid(work_id);
    await transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canClose, work, actor);
      const joinDigest = digest(core_join_digest, "core_join_digest_invalid");
      const context = core_join_context || {};
      if (context.tenant_id !== actor.tenant_id || context.work_id !== workId || context.adapter !== work.work_type ||
          context.verdict_digest !== joinDigest || context.authority !== "universal_core" ||
          context.decision !== "GENERIC_WORK_CORE_JOIN_ELIGIBLE" || typeof context.signature !== "string" || context.signature.length < 16) {
        fail("generic_core_join_context_invalid");
      }
      const existing = await client.query("SELECT core_join_digest,core_join_context FROM tenant_work_core_join WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE", [actor.tenant_id, workId]);
      if (existing.rows[0]) {
        if (existing.rows[0].core_join_digest !== joinDigest || objectDigest(existing.rows[0].core_join_context) !== objectDigest(context)) fail("generic_core_join_conflict");
        return;
      }
      await client.query(`INSERT INTO tenant_work_core_join (tenant_id,work_id,core_join_digest,core_join_context,persisted_by_user_id)
        VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [actor.tenant_id, workId, joinDigest, JSON.stringify(context), actor.user_id]);
    });
    return refreshDerived(identity, { work_id: workId });
  }
  async function refreshDerived(identity, { work_id }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(work_id);
    return transaction(async (client) => {
      const work = await loadWork(client, actor, workId, true);
      assertPermission(canRead, work, actor);
      const [tasks, evidence, join] = await Promise.all([
        client.query("SELECT title,weight,status,required,acceptance_verified FROM tenant_work_task WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]),
        client.query("SELECT weight,required,independently_verified FROM tenant_work_evidence WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]),
        client.query("SELECT core_join_digest FROM tenant_work_core_join WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]),
      ]);
      const progress = deriveProgress(tasks.rows, evidence.rows, { evaluated: false, independent_verification_passed: evidence.rows.length > 0 && evidence.rows.every((item) => item.independently_verified), core_join_received: Boolean(join.rows[0]) });
      const priorityFacts = await derivePersistedPriorityFacts(client, actor, { ...work, progress_bp: progress.overall_progress_bp });
      const priority = derivePriority(priorityFacts);
      await client.query(`UPDATE tenant_work SET progress_bp=$3,progress_version=$4,progress_source=$5,priority=$6,priority_score=$7,priority_version=$8,priority_context=$9::jsonb,updated_at=now()
        WHERE tenant_id=$1 AND work_id=$2`, [actor.tenant_id, workId, progress.overall_progress_bp, progress.progress_version, progress.progress_source,
        priority.priority, priority.priority_score, priority.priority_version, JSON.stringify(priorityFacts)]);
      return { ...progress, ...priority, work: await loadWork(client, actor, workId) };
    });
  }
  async function reconcileStaleDryRun(identity, { project_id } = {}) {
    const actor = actorFromIdentity(identity);
    if (!isAdmin(actor)) fail("stale_reconciliation_forbidden");
    const works = await listWorks(identity, { view: "tenant", project_id });
    const result = [];
    for (const work of works) {
      const sourceId = work.legacy_work_id || work.work_id;
      const [participants, leases] = await Promise.all([
        query("SELECT status,expires_at FROM core_continuity_participants WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, sourceId]),
        query("SELECT status,expires_at FROM core_continuity_leases WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, sourceId]),
      ]);
      result.push({ work_id: work.work_id, work_code: work.work_code,
        parent_work_id: work.parent_work_id || null, successor_work_id: work.successor_work_id || null,
        superseded_by_work_id: work.superseded_by_work_id || null,
        ...classifyStaleWork({ ...work, participants: participants.rows.map((row) => ({ ...row, active: row.status === "active" })), leases: leases.rows }) });
    }
    return { dry_run: true, classifications: result };
  }
  async function closureState(client, actor, workId, lock = false) {
    const work = await loadWork(client, actor, workId, lock);
    const [evidence, join, receipt] = await Promise.all([
      client.query("SELECT * FROM tenant_work_evidence WHERE tenant_id=$1 AND work_id=$2 AND required=true", [actor.tenant_id, workId]),
      client.query("SELECT * FROM tenant_work_core_join WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]),
      client.query("SELECT * FROM tenant_work_closure_receipt WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]),
    ]);
    return { work, evidence: evidence.rows, join: join.rows[0] || null, receipt: receipt.rows[0] || null };
  }
  async function evaluateGenericClosure(identity, { work_id, adapter }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(work_id);
    if (!CLOSURE_ADAPTERS.includes(adapter)) fail("work_closure_adapter_invalid");
    const state = await transaction((client) => closureState(client, actor, workId, false));
    assertPermission(canRead, state.work, actor);
    if (state.work.work_type !== adapter) fail("work_closure_adapter_mismatch");
    const independent = state.evidence.length > 0 && state.evidence.every((item) => item.independently_verified === true && item.verified_by_agent_id !== state.work.created_by_agent_id);
    return { work_id: workId, adapter, ready: Boolean(independent && state.join), independent_verification_persisted: independent, core_join_persisted: Boolean(state.join), idempotent_receipt: Boolean(state.receipt) };
  }
  async function buildGenericCoreJoinRequest(identity, { work_id, adapter, idempotency_key }) {
    await initialize();
    if (String(verifierReceiptSigningSecret).length < 32) fail("generic_verifier_receipt_signing_unavailable");
    if (!CLOSURE_ADAPTERS.includes(adapter)) fail("work_closure_adapter_invalid");
    const actor = actorFromIdentity(identity);
    if (!actor.agent_id || !actor.session_fingerprint) fail("generic_core_join_requester_presence_required");
    const state = await transaction(async (client) => {
      const work = await loadWork(client, actor, uuid(work_id), false);
      assertPermission(canClose, work, actor);
      if (work.work_type !== adapter) fail("work_closure_adapter_mismatch");
      const tasks = await client.query("SELECT * FROM tenant_work_task WHERE tenant_id=$1 AND work_id=$2 AND required=true ORDER BY task_id", [actor.tenant_id, work.work_id]);
      const evidence = await client.query("SELECT * FROM tenant_work_evidence WHERE tenant_id=$1 AND work_id=$2 AND required=true ORDER BY created_at,evidence_id", [actor.tenant_id, work.work_id]);
      return { work, tasks: tasks.rows, evidence: evidence.rows };
    });
    if (!state.tasks.length || state.tasks.some((task) => task.status !== "completed" || task.acceptance_verified !== true)) fail("generic_core_join_tasks_incomplete");
    if (!state.evidence.length || state.evidence.some((item) => item.independently_verified !== true)) fail("generic_core_join_evidence_incomplete");
    const verifier = state.evidence.find((item) => item.verified_by_agent_id && item.verified_by_session_fingerprint);
    if (!verifier || verifier.verified_by_agent_id === state.work.created_by_agent_id || verifier.verified_by_session_fingerprint === state.work.created_by_session_fingerprint) fail("generic_core_join_verifier_not_independent");
    const evidenceDigests = state.evidence.map((item) => item.digest).sort();
    const evidenceDigest = objectDigest(evidenceDigests);
    const acceptanceCriteria = (state.work.acceptance_criteria || []).map((criterion, index) => ({
      criterion_id: `criterion-${String(index + 1).padStart(3, "0")}`,
      criterion_digest: objectDigest(criterion), evidence_digest: evidenceDigest,
      verification_digest: verifier.digest,
    }));
    const taskState = state.tasks.map((task) => ({ task_id: task.task_id,
      task_state_digest: objectDigest({ status: task.status, acceptance_verified: task.acceptance_verified }),
      completion_evidence_digest: evidenceDigest, verification_digest: verifier.digest }));
    const issuedAt = now();
    const receipt = {
      schema_version: "generic_work_independent_verifier_receipt_v1", tenant_id: actor.tenant_id,
      work_id: state.work.work_id, adapter, acceptance_criteria_digest: objectDigest(acceptanceCriteria),
      task_state_digest: objectDigest(taskState), evidence_digest: objectDigest(evidenceDigests),
      verification_digest: verifier.digest, verifier_identity: verifier.verified_by_agent_id,
      session_id: verifier.verified_by_session_fingerprint, nonce: crypto.randomUUID(),
      issued_at: issuedAt.toISOString(), expires_at: new Date(issuedAt.getTime() + 5 * 60_000).toISOString(),
    };
    receipt.signature = crypto.createHmac("sha256", verifierReceiptSigningSecret)
      .update(`generic_work_verifier_receipt_v1\0${objectDigest(receipt)}`).digest("base64url");
    return { tenant_id: actor.tenant_id, work_id: state.work.work_id, adapter,
      requester_identity: actor.agent_id, requester_session_id: actor.session_fingerprint,
      idempotency_digest: objectDigest({ work_id: state.work.work_id, adapter, idempotency_key }),
      acceptance_criteria: acceptanceCriteria, task_state: taskState, evidence_digests: evidenceDigests,
      independent_verifier_receipt: receipt };
  }
  async function finalizeGenericClosure(identity, { work_id, adapter }) {
    await initialize();
    const actor = actorFromIdentity(identity);
    const workId = uuid(work_id);
    if (!CLOSURE_ADAPTERS.includes(adapter)) fail("work_closure_adapter_invalid");
    return transaction(async (client) => {
      const state = await closureState(client, actor, workId, true);
      assertPermission(canClose, state.work, actor);
      if (state.work.work_type !== adapter) fail("work_closure_adapter_mismatch");
      if (state.receipt) {
        const report = await client.query("SELECT report FROM tenant_work_final_report WHERE tenant_id=$1 AND work_id=$2", [actor.tenant_id, workId]);
        return { receipt: state.receipt, final_report: report.rows[0]?.report || null, idempotent_replay: true, archive_status: "ARCHIVED" };
      }
      const tasks = await client.query("SELECT status,acceptance_verified FROM tenant_work_task WHERE tenant_id=$1 AND work_id=$2 AND required=true", [actor.tenant_id, workId]);
      const independent = state.evidence.length > 0 && state.evidence.every((item) => item.independently_verified === true && item.verified_by_agent_id !== state.work.created_by_agent_id);
      const completeTasks = tasks.rows.length > 0 && tasks.rows.every((item) => item.status === "completed" && item.acceptance_verified === true);
      if (!independent || !completeTasks || !state.join) fail("work_closure_gate_unsatisfied");
      const finalEvidenceDigest = crypto.createHash("sha256").update(JSON.stringify(state.evidence.map((item) => item.digest).sort())).digest("hex");
      const finalized = buildGenericClosureArtifacts({ ...state.work, progress_bp: state.work.progress_bp }, {
        adapter, server_verified_closure_context: { schema_version: "work_closure_context_v1",
          server_verified: true, independent_verification: { passed: true },
          core_join: { received: true, digest: state.join.core_join_digest }, final_evidence_digest: finalEvidenceDigest,
          evidence_summary: state.evidence.map((item) => ({ kind: item.kind, digest: item.digest })) },
      });
      await client.query(`INSERT INTO tenant_work_closure_receipt (tenant_id,receipt_id,work_id,adapter,core_join_digest,final_evidence_digest,receipt_digest)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [actor.tenant_id, finalized.receipt.receipt_id, workId, adapter, state.join.core_join_digest, finalEvidenceDigest, finalized.receipt.receipt_digest]);
      await client.query(`INSERT INTO tenant_work_final_report (tenant_id,work_id,report,report_digest) VALUES ($1,$2,$3::jsonb,$4)`,
        [actor.tenant_id, workId, JSON.stringify(finalized.final_report), crypto.createHash("sha256").update(JSON.stringify(finalized.final_report)).digest("hex")]);
      await client.query(`UPDATE tenant_work SET status='COMPLETED',closed_at=now(),archived_at=now(),final_evidence_digest=$3,closure_type=$4,closure_reason='acceptance_criteria_verified',progress_bp=10000,updated_at=now()
        WHERE tenant_id=$1 AND work_id=$2`, [actor.tenant_id, workId, finalEvidenceDigest, adapter]);
      if (state.work.legacy_work_id) {
        await client.query(`UPDATE core_continuity_works SET status='completed',next_action='',updated_at=now()
          WHERE tenant_id=$1 AND work_id=$2`, [actor.tenant_id, state.work.legacy_work_id]);
        const previous = await client.query(`SELECT sequence_number,event_hash FROM core_continuity_events
          WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`,
        [actor.tenant_id, state.work.legacy_work_id]);
        const sequence = Number(previous.rows[0]?.sequence_number || 0) + 1;
        const payload = { adapter, closure_receipt_digest: finalized.receipt.receipt_digest,
          final_evidence_digest: finalEvidenceDigest, report_digest: objectDigest(finalized.final_report), archived: true };
        const event = { tenant_id: actor.tenant_id, work_id: state.work.legacy_work_id,
          sequence_number: sequence, event_type: "generic_closure_finalized", payload,
          previous_event_hash: previous.rows[0]?.event_hash || null };
        await client.query(`INSERT INTO core_continuity_events
          (tenant_id,work_id,event_id,sequence_number,event_type,payload,previous_event_hash,event_hash,created_by)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`, [actor.tenant_id, state.work.legacy_work_id,
          crypto.randomUUID(), sequence, event.event_type, JSON.stringify(payload), event.previous_event_hash,
          objectDigest(event), actor.agent_id || actor.user_id]);
      }
      return { receipt: finalized.receipt, final_report: finalized.final_report, idempotent_replay: false, archive_status: "ARCHIVED" };
    });
  }
  return Object.freeze({ initialize, createWork, createNewWork, projectLegacyWork, projectLegacyCatalog,
    readWork, listWorks, preflightGallery, openWorkReview,
    recordTask, recordEvidence, persistCoreJoin, refreshDerived, reconcileStaleDryRun,
    evaluateGenericClosure, buildGenericCoreJoinRequest, finalizeGenericClosure,
    verifyCoreJoinVerdict: (verdict) => Boolean(coreJoinVerifier && verifyGenericCoreJoinVerdict(verdict, coreJoinVerifier)) });
}

export { ADDITIVE_SCHEMA_SQL, actorFromIdentity };
