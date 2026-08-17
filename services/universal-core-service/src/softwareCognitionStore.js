import crypto from "node:crypto";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { softwareDigest } from "./softwareCognition.js";

const MIGRATION = fileURLToPath(new URL("../migrations/20260815_software_cognition_v1.sql", import.meta.url));
const ARTIFACT_KINDS = new Set(["impact", "coverage", "reconciliation", "runtime_observation", "learning", "closure", "traceability", "architecture", "calibration", "supervision",
  "research_plan", "research_evidence", "technical_evidence", "precore_decision"]);
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function receiptUuid(value) { const hex = crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`; }

export function createPostgresSoftwareCognitionStore({ pool } = {}) {
  if (!pool || typeof pool.query !== "function") fail("software_cognition_postgres_required");
  async function initialize() { await pool.query(await fs.readFile(MIGRATION, "utf8")); return { schema_version: "software_cognition_atlas_extension_v1", ready: true }; }
  async function withTransaction(fn, { readOnly = false } = {}) {
    const client = typeof pool.connect === "function" ? await pool.connect() : pool;
    try { await client.query("BEGIN"); if (readOnly) await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"); const result = await fn(client); await client.query("COMMIT"); return result; }
    catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; } finally { client.release?.(); }
  }
  async function appendContinuityEvent(client, { tenant_id, work_id, event_type, payload, actor_id }) {
    await client.query("SELECT work_id FROM core_continuity_works WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE", [tenant_id, work_id]);
    const previous = await client.query(`SELECT sequence_number,event_hash FROM core_continuity_events
      WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`, [tenant_id, work_id]);
    const sequence = Number(previous.rows[0]?.sequence_number || 0) + 1;
    const event = { tenant_id, work_id, sequence_number: sequence, event_type, payload,
      previous_event_hash: previous.rows[0]?.event_hash || null };
    const eventHash = softwareDigest(event);
    await client.query(`INSERT INTO core_continuity_events
      (tenant_id,work_id,event_id,sequence_number,event_type,payload,previous_event_hash,event_hash,created_by)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`, [tenant_id, work_id, crypto.randomUUID(), sequence,
      event_type, JSON.stringify(payload), event.previous_event_hash, eventHash, actor_id]);
    return eventHash;
  }
  async function readGraph(tenantId, projectId, workId, db = pool) {
    const state = await db.query(`SELECT project_id,revision,total_nodes,total_context_bytes,source_hash
      FROM core_continuity_atlas_state WHERE tenant_id=$1 AND work_id=$2`, [tenantId, workId]);
    if (!state.rows[0]) return null;
    if (String(state.rows[0].project_id) !== String(projectId)) fail("software_atlas_project_scope_mismatch");
    const [nodes, edges, revisionBinding] = await Promise.all([
      db.query(`SELECT node_id,node_kind,path,symbol,summary,node_digest,context_bytes,metadata,revision,
        source_kind,source_ref,source_digest,provenance FROM core_continuity_atlas_nodes
        WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND active=true ORDER BY node_id`, [tenantId, projectId, workId]),
      db.query(`SELECT edge_id,from_node_id,to_node_id,edge_type,edge_digest,source,provenance,revision
        FROM core_continuity_atlas_edges WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND active=true ORDER BY edge_id`, [tenantId, projectId, workId]),
      db.query(`SELECT base_commit,head_commit,provenance FROM core_continuity_atlas_revision_history
        WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND revision=$4`, [tenantId, projectId, workId, state.rows[0].revision]),
    ]);
    const binding = revisionBinding.rows[0] || {};
    return { schema_version: "nyra_software_cognition_v1", tenant_id: tenantId, project_id: projectId, work_id: workId,
      revision: Number(state.rows[0].revision), source_digest: state.rows[0].source_hash,
      repository_id: binding.provenance?.repository || binding.provenance?.repository_id || null,
      base_revision: binding.base_commit || null, candidate_revision: binding.head_commit || null,
      nodes: nodes.rows.map((row) => ({ tenant_id: tenantId, project_id: projectId, work_id: workId, node_id: row.node_id,
        kind: row.node_kind, source_ref: row.source_ref || row.path, source_kind: row.source_kind, provenance: row.provenance,
        payload: row.metadata, digest: row.source_digest || row.node_digest, version: Number(row.revision), tombstoned: false })),
      edges: edges.rows.map((row) => ({ tenant_id: tenantId, project_id: projectId, work_id: workId, edge_id: row.edge_id,
        from_node_id: row.from_node_id, to_node_id: row.to_node_id, edge_type: row.edge_type,
        digest: row.edge_digest, source: row.source, provenance: row.provenance })) };
  }
  async function writeGraph() { fail("software_atlas_single_writer_required"); }
  async function verifyCausalBinding({ tenant_id, project_id, work_id, change_id }, db = pool) {
    const result = await db.query(`SELECT w.work_id,c.change_id FROM core_work_causal_bindings w
      LEFT JOIN core_changes c ON c.tenant_id=w.tenant_id AND c.work_id=w.work_id AND c.change_id=$4
      WHERE w.tenant_id=$1 AND w.project_id=$2 AND w.work_id=$3`, [tenant_id, project_id, work_id, change_id || null]);
    if (!result.rows[0] || (change_id && !result.rows[0].change_id)) fail("software_causal_binding_not_found");
    return result.rows[0];
  }
  async function readCausalObligations({ tenant_id, project_id, work_id, change_id }, db = pool) {
    const result = await db.query(`SELECT obligation_id,claim,assurance_level,state,obligation_digest,rollback_plan
      FROM core_causal_obligations WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND change_id=$4 ORDER BY obligation_id`,
    [tenant_id, project_id, work_id, change_id]);
    return result.rows;
  }
  async function readSupervisionBindings({ tenant_id, project_id, work_id }, db = pool) {
    const result = await db.query(`SELECT p.active_intent_revision_id AS intent_id,i.canonical_digest AS intent_digest,
        w.intent_revision_id AS work_intent_id,icf.version AS icf_version,icf.ledger_head_digest,icf.state AS icf_state
      FROM core_projects p JOIN core_work_causal_bindings w ON w.tenant_id=p.tenant_id AND w.project_id=p.project_id AND w.work_id=$3
      LEFT JOIN core_intent_revisions i ON i.tenant_id=p.tenant_id AND i.intent_revision_id=p.active_intent_revision_id
      LEFT JOIN core_icf_work icf ON icf.tenant_id=p.tenant_id AND icf.work_id=w.work_id::text
      WHERE p.tenant_id=$1 AND p.project_id=$2`, [tenant_id, project_id, work_id]);
    if (!result.rows[0]) fail("software_causal_binding_not_found");
    const row = result.rows[0]; const seal = row.icf_state?.core_seal;
    return { intent_id: row.intent_id === row.work_intent_id ? row.intent_id : null,
      intent_digest: row.intent_id === row.work_intent_id ? row.intent_digest : null, icf_required: true,
      icf_id: row.icf_state?.closure === "SEALED" && seal?.decision === "ALLOW_CLOSE" ? seal.seal_id : null,
      icf_digest: row.icf_state?.closure === "SEALED" && seal?.decision === "ALLOW_CLOSE" ? seal.digest : null };
  }
  async function readNativePlan({ tenant_id, work_id, plan_id }, db = pool) {
    const plan = await db.query(`SELECT plan_id,plan,plan_digest,status,change_id,base_state_digest,contract_schema,plan_version
      FROM core_continuity_native_plans WHERE tenant_id=$1 AND work_id=$2 AND ($3::uuid IS NULL OR plan_id=$3)
      ORDER BY created_at DESC LIMIT 1`, [tenant_id, work_id, plan_id || null]);
    if (!plan.rows[0]) fail("software_native_plan_not_found");
    const agents = await db.query(`SELECT agent_id,task_id,task_kind,status,report,report_digest,native_session_fingerprint,native_presence_signature
      FROM core_continuity_native_agents WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3 ORDER BY task_id`, [tenant_id, work_id, plan.rows[0].plan_id]);
    return { ...plan.rows[0], agents: agents.rows };
  }
  async function writeArtifact({ tenant_id, project_id, work_id, change_id, plan_id, kind, id, digest, payload, actor_id }) {
    if (!ARTIFACT_KINDS.has(kind)) fail("software_artifact_kind_invalid");
    const receiptId = receiptUuid(`${tenant_id}:${work_id}:${plan_id}:${kind}:${id}`);
    const receiptType = `software_${kind}`.slice(0, 40);
    const canonicalPayload = { ...payload, project_id, work_id, change_id, plan_id };
    const receiptDigest = softwareDigest(canonicalPayload);
    return withTransaction(async (client) => {
      await client.query("SELECT work_id FROM core_continuity_works WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE", [tenant_id, work_id]);
      await verifyCausalBinding({ tenant_id, project_id, work_id, change_id }, client);
      await readNativePlan({ tenant_id, work_id, plan_id }, client);
      const prior = await client.query(`SELECT payload_digest,payload FROM core_continuity_native_receipts
        WHERE tenant_id=$1 AND receipt_id=$2 FOR UPDATE`, [tenant_id, receiptId]);
      if (prior.rows[0]) { if (prior.rows[0].payload_digest !== receiptDigest) fail("software_artifact_idempotency_conflict"); return prior.rows[0].payload; }
      const result = await client.query(`INSERT INTO core_continuity_native_receipts
        (tenant_id,work_id,plan_id,receipt_id,receipt_type,payload,payload_digest,created_by)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING payload`,
      [tenant_id, work_id, plan_id, receiptId, receiptType, JSON.stringify(canonicalPayload), receiptDigest, actor_id]);
      await appendContinuityEvent(client, { tenant_id, work_id, event_type: "software_receipt_recorded",
        payload: { plan_id, change_id, receipt_id: receiptId, receipt_type: receiptType, payload_digest: receiptDigest }, actor_id });
      return result.rows[0].payload;
    });
  }
  async function readArtifacts({ tenant_id, project_id, work_id, change_id, plan_id, kind }, db = pool) {
    if (!ARTIFACT_KINDS.has(kind)) fail("software_artifact_kind_invalid");
    const result = await db.query(`SELECT payload FROM core_continuity_native_receipts
      WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3 AND receipt_type=$4
        AND payload->>'project_id'=$5 AND payload->>'change_id'=$6 ORDER BY created_at,receipt_id`,
    [tenant_id, work_id, plan_id, `software_${kind}`.slice(0, 40), project_id, change_id]);
    return result.rows.map((row) => row.payload);
  }
  async function writeChallenge({ tenant_id, work_id, plan_id, change_id, challenge, digest, actor_id = "software-supervisor" }) {
    return withTransaction(async (client) => {
      await client.query("SELECT work_id FROM core_continuity_works WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE", [tenant_id, work_id]);
      const prior = await client.query(`SELECT payload_digest,payload FROM core_continuity_supervisory_challenges
        WHERE tenant_id=$1 AND challenge_id=$2 FOR UPDATE`, [tenant_id, challenge.challenge_id]);
      if (prior.rows[0]) { if (prior.rows[0].payload_digest !== digest) fail("software_challenge_idempotency_conflict"); return prior.rows[0].payload; }
      const result = await client.query(`INSERT INTO core_continuity_supervisory_challenges
        (tenant_id,work_id,plan_id,change_id,challenge_id,payload,payload_digest,severity,status,version)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'open',1) RETURNING payload`,
      [tenant_id, work_id, plan_id, change_id, challenge.challenge_id, JSON.stringify(challenge), digest, challenge.severity]);
      await appendContinuityEvent(client, { tenant_id, work_id, event_type: "software_challenge_opened",
        payload: { plan_id, change_id, challenge_id: challenge.challenge_id, challenge_digest: digest }, actor_id });
      return result.rows[0].payload;
    });
  }
  async function readChallenges({ tenant_id, work_id, plan_id }, db = pool) {
    const result = await db.query(`SELECT payload,status,version FROM core_continuity_supervisory_challenges
      WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3 ORDER BY created_at,challenge_id`, [tenant_id, work_id, plan_id]);
    return result.rows.map((row) => ({ ...row.payload, status: row.status, version: Number(row.version) }));
  }
  async function writeChallengeResolution({ tenant_id, work_id, plan_id, challenge_id, expected_version, payload, digest, actor_id }) {
    return withTransaction(async (client) => {
      await client.query("SELECT work_id FROM core_continuity_works WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE", [tenant_id, work_id]);
      const current = await client.query(`SELECT version,status FROM core_continuity_supervisory_challenges
        WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3 AND challenge_id=$4 FOR UPDATE`, [tenant_id, work_id, plan_id, challenge_id]);
      if (!current.rows[0] || current.rows[0].status !== "open") fail("challenge_not_open");
      if (Number(current.rows[0].version) !== Number(expected_version)) fail("stale_challenge_revision");
      const nextStatus = payload.status;
      await client.query(`UPDATE core_continuity_supervisory_challenges SET status=$5,version=$6,payload=$7::jsonb,
        payload_digest=$8,updated_at=clock_timestamp() WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3 AND challenge_id=$4`,
      [tenant_id, work_id, plan_id, challenge_id, nextStatus, payload.version, JSON.stringify(payload), digest]);
      await client.query(`INSERT INTO core_continuity_supervisory_challenge_resolutions
        (tenant_id,work_id,plan_id,challenge_id,resolution_id,expected_version,new_version,payload,payload_digest,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`, [tenant_id, work_id, plan_id, challenge_id,
        receiptUuid(`${tenant_id}:${challenge_id}:${payload.version}`), expected_version, payload.version, JSON.stringify(payload), digest, actor_id]);
      await appendContinuityEvent(client, { tenant_id, work_id, event_type: "software_challenge_resolved",
        payload: { plan_id, challenge_id, expected_version, new_version: payload.version, resolution_digest: digest }, actor_id });
      return payload;
    });
  }
  async function readClosureSnapshot(input, db = null) {
    const { tenant_id, project_id, work_id, change_id, plan_id } = input;
    const load = async (client) => {
      const [project, repository, work, change, obligations, evidence, icf, graph, nativePlan, nativePlanHead, nativeClosure, clock] = await Promise.all([
        client.query(`SELECT p.project_id,p.active_state_digest,p.active_intent_revision_id,i.genesis_intent_id,i.state AS intent_state,i.canonical_digest AS intent_digest,g.canonical_digest AS genesis_digest
          FROM core_projects p LEFT JOIN core_intent_revisions i ON i.tenant_id=p.tenant_id AND i.intent_revision_id=p.active_intent_revision_id
          LEFT JOIN core_genesis_intents g ON g.tenant_id=p.tenant_id AND g.genesis_intent_id=i.genesis_intent_id WHERE p.tenant_id=$1 AND p.project_id=$2`, [tenant_id, project_id]),
        client.query(`SELECT resource_id,canonical_identifier,resource_digest,last_verified_at FROM core_project_scope_resources
          WHERE tenant_id=$1 AND project_id=$2 AND active=true AND lower(resource_type) IN ('repository','source_repository','git_repository')
          ORDER BY last_verified_at DESC NULLS LAST,first_seen_at DESC`, [tenant_id, project_id]),
        client.query(`SELECT * FROM core_work_causal_bindings WHERE tenant_id=$1 AND work_id=$2 AND project_id=$3`, [tenant_id, work_id, project_id]),
        client.query(`SELECT * FROM core_changes WHERE tenant_id=$1 AND change_id=$2 AND work_id=$3 AND project_id=$4`, [tenant_id, change_id, work_id, project_id]),
        client.query(`SELECT obligation_id,claim,assurance_level,state,obligation_digest,rollback_plan FROM core_causal_obligations WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND change_id=$4 ORDER BY obligation_id`, [tenant_id, project_id, work_id, change_id]),
        client.query(`SELECT observation_id,obligation_id,source,observer_identity,observer_role,independence,evidence_digest,observed_at,freshness_seconds,contradiction_status,observation_digest,baseline FROM core_reality_observations WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND change_id=$4 ORDER BY observed_at,observation_id`, [tenant_id, project_id, work_id, change_id]),
        client.query(`SELECT version,ledger_head_digest,state FROM core_icf_work WHERE tenant_id=$1 AND work_id=$2`, [tenant_id, work_id]),
        readGraph(tenant_id, project_id, work_id, client), readNativePlan({ tenant_id, work_id, plan_id }, client),
        client.query(`SELECT plan_id,plan_version FROM core_continuity_native_plans WHERE tenant_id=$1 AND work_id=$2
          ORDER BY plan_version DESC,created_at DESC,plan_id DESC LIMIT 1`, [tenant_id, work_id]),
        client.query(`SELECT evaluation,evaluation_digest FROM core_continuity_closure_evaluations
          WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3 ORDER BY created_at DESC LIMIT 1`, [tenant_id, work_id, plan_id]),
        client.query("SELECT clock_timestamp() AS db_now"),
      ]);
      const artifacts = {};
      for (const kind of ARTIFACT_KINDS) artifacts[kind] = await readArtifacts({ tenant_id, project_id, work_id, change_id, plan_id, kind }, client);
      const graphRepositoryId = String(graph?.repository_id || "");
      const repositoryMatches = graphRepositoryId ? repository.rows.filter((row) =>
        String(row.resource_id) === graphRepositoryId || String(row.canonical_identifier) === graphRepositoryId) : [];
      if (repositoryMatches.length > 1) fail("software_repository_graph_binding_ambiguous");
      return { project: project.rows[0] || null, repository: repositoryMatches[0] || null, work: work.rows[0] || null, change: change.rows[0] || null,
        obligations: obligations.rows, evidence: evidence.rows, icf: icf.rows[0] || null, graph, native_plan: nativePlan,
        latest_native_plan_id: nativePlanHead.rows[0]?.plan_id || null,
        native_closure: nativeClosure.rows[0] || null,
        challenges: await readChallenges({ tenant_id, work_id, plan_id }, client), artifacts, db_now: clock.rows[0].db_now };
    };
    return db ? load(db) : withTransaction(load, { readOnly: true });
  }
  async function readVerifiedLearningEvidence({ tenant_id, project_id, work_id, evidence_digest, subject_digest = null }) {
    const result = await pool.query(`SELECT o.obligation_id,r.observation_id,r.observed_at,r.freshness_seconds,
        r.observed_at + make_interval(secs => r.freshness_seconds) AS fresh_until FROM core_causal_obligations o
      JOIN core_reality_observations r ON r.tenant_id=o.tenant_id AND r.obligation_id=o.obligation_id
      WHERE o.tenant_id=$1 AND o.project_id=$2 AND o.work_id=$3 AND o.state IN ('VERIFIED_PROVISIONAL','VERIFIED_FINAL','CLOSED')
        AND r.evidence_digest=$4 AND ($5::text IS NULL OR r.baseline->>'subject_digest'=$5)
        AND r.independence<>'EXECUTOR' AND r.contradiction_status='NONE'
        AND r.observed_at + make_interval(secs => r.freshness_seconds) >= clock_timestamp() LIMIT 1`, [tenant_id, project_id, work_id, evidence_digest, subject_digest]);
    return result.rows[0] || null;
  }
  async function readReleaseReadyClosure({ tenant_id, work_id }, db = pool) {
    const result = await db.query(`SELECT r.payload->>'project_id' AS project_id,r.payload_digest AS artifact_digest,r.payload
      FROM core_continuity_native_receipts r JOIN core_continuity_native_plans p
        ON p.tenant_id=r.tenant_id AND p.work_id=r.work_id AND p.plan_id=r.plan_id
      WHERE r.tenant_id=$1 AND r.work_id=$2 AND r.receipt_type='software_closure' AND r.payload->>'verdict'='RELEASE_READY'
        AND NOT EXISTS (SELECT 1 FROM core_continuity_native_plans newer
          WHERE newer.tenant_id=p.tenant_id AND newer.work_id=p.work_id
            AND (newer.plan_version>p.plan_version OR
              (newer.plan_version=p.plan_version AND (newer.created_at>p.created_at OR (newer.created_at=p.created_at AND newer.plan_id>p.plan_id)))))
      ORDER BY r.created_at DESC LIMIT 1`, [tenant_id, work_id]);
    return result.rows[0] || null;
  }
  async function withClosureAuthorityLock({ tenant_id, work_id }, operation) {
    if (typeof operation !== "function") fail("software_closure_operation_required");
    return withTransaction(async (client) => {
      const work = await client.query(`SELECT project_id FROM core_continuity_works
        WHERE tenant_id=$1 AND work_id=$2`, [tenant_id, work_id]);
      if (!work.rows[0]) fail("software_causal_binding_not_found");
      const projectId = String(work.rows[0].project_id);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [`causal:${tenant_id}`, projectId]);
      const lockedWork = await client.query(`SELECT project_id FROM core_continuity_works
        WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [tenant_id, work_id]);
      if (!lockedWork.rows[0] || String(lockedWork.rows[0].project_id) !== projectId) fail("software_causal_binding_not_found");
      await client.query("SELECT 1 FROM core_icf_work WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE", [tenant_id, work_id]);
      const lockedStore = {
        readReleaseReadyClosure: (input) => readReleaseReadyClosure(input, client),
        readGraph: (lockedTenant, lockedProject, lockedWork) => readGraph(lockedTenant, lockedProject, lockedWork, client),
        readClosureSnapshot: (input) => readClosureSnapshot(input, client),
        assertClosureFresh: async ({ fresh_until, issued_at }) => {
          const dbNow = (await client.query("SELECT clock_timestamp() AS db_now")).rows[0]?.db_now;
          const freshUntilMs = Date.parse(fresh_until || "");
          const issuedAtMs = Date.parse(issued_at || "");
          const dbNowMs = dbNow instanceof Date ? dbNow.getTime() : Date.parse(dbNow);
          if (!Number.isFinite(freshUntilMs) || !Number.isFinite(issuedAtMs) || !Number.isFinite(dbNowMs) ||
              issuedAtMs > freshUntilMs || dbNowMs > freshUntilMs) fail("software_cognition_closure_expired_during_issuance");
          return true;
        },
      };
      return operation(lockedStore);
    });
  }
  async function withPrecoreAuthorityLock({ tenant_id, project_id, work_id, plan_id }, operation) {
    if (typeof operation !== "function") fail("software_precore_operation_required");
    return withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [`causal:${tenant_id}`, String(project_id)]);
      const work = await client.query(`SELECT project_id FROM core_continuity_works
        WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [tenant_id, work_id]);
      if (!work.rows[0] || String(work.rows[0].project_id) !== String(project_id)) fail("software_causal_binding_not_found");
      await client.query("SELECT project_id FROM core_projects WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE", [tenant_id, project_id]);
      await client.query("SELECT revision FROM core_continuity_atlas_state WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE", [tenant_id, work_id]);
      await client.query("SELECT plan_id FROM core_continuity_native_plans WHERE tenant_id=$1 AND work_id=$2 AND plan_id=$3 FOR UPDATE",
        [tenant_id, work_id, plan_id]);
      await client.query("SELECT 1 FROM core_icf_work WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE", [tenant_id, work_id]);
      await client.query(`SELECT resource_id FROM core_project_scope_resources
        WHERE tenant_id=$1 AND project_id=$2 AND active=true AND lower(resource_type) IN ('repository','source_repository','git_repository')
        FOR SHARE`, [tenant_id, project_id]);
      return operation({ readClosureSnapshot: (input) => readClosureSnapshot(input, client), transaction: client });
    });
  }
  return Object.freeze({ initialize, readGraph, writeGraph, verifyCausalBinding, readCausalObligations, readSupervisionBindings, readNativePlan, writeArtifact, readArtifacts,
    writeChallenge, readChallenges, writeChallengeResolution, readClosureSnapshot, readVerifiedLearningEvidence, readReleaseReadyClosure,
    withClosureAuthorityLock, withPrecoreAuthorityLock });
}
