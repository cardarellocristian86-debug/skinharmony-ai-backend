import {
  buildRequirementTraceability, calculateCausalObligationCoverage, calibrateSoftwareSupervision, createWorkerPlanContract, evaluateSoftwareClosure, expandSoftwareObligations,
  indexSoftwareDiff, predictSoftwareImpact, reconcileSoftwareImpact, resolveSupervisoryChallenge, softwareDigest,
  recoverSoftwareArchitecture, routeSoftwareCognitionEvent, softwareAuthoritySnapshotDigest, superviseWorkerPlan, validateGraphMutation, validateLearningPromotion,
} from "./softwareCognition.js";
import {
  bindSoftwareResearchEvidence, buildSoftwareResearchPlan, buildTechnologyProfiles, createNyraPrecoreDecision, validateTechnologyEvidence,
} from "./softwareCognitionResearch.js";

function fail(code) { const error = new Error(code); error.code = code; throw error; }
const PRECORE_AUTHORITY_LOCK = Symbol("precore_authority_lock");
export function normalizeSoftwareCognitionMode(value = "OFF") {
  const mode = String(value || "OFF").trim().toUpperCase();
  if (!["OFF", "SHADOW", "ADVISORY", "ENFORCED"].includes(mode)) fail("software_cognition_mode_invalid");
  return mode;
}
function resultId(prefix, value) { return `${prefix}_${softwareDigest(value).slice(0, 48)}`; }
function graphShape(graph) {
  if (!graph) return { revision: 0, nodes: [], edges: [] };
  return { revision: graph.revision, source_digest: graph.source_digest, repository_id: graph.repository_id || null,
    base_revision: graph.base_revision || null, candidate_revision: graph.candidate_revision || null,
    nodes: graph.nodes.map((n) => ({ ...n, kind: n.kind || n.node_kind, source_ref: n.source_ref || n.locator })), edges: graph.edges };
}
function softwareObligations(rows) {
  const stateMap = { VERIFIED_PROVISIONAL: "verified", VERIFIED_FINAL: "verified", CLOSED: "closed", CONTRADICTED: "contradicted", PARTIAL: "blocked", HARMFUL: "contradicted", UNKNOWN: "blocked", ESCALATED: "blocked", ROLLED_BACK: "reopened" };
  return rows.map((item) => ({ obligation_id: item.obligation_id, type: String(item.claim || "causal").toLowerCase(),
    criticality: item.assurance_level === "CAL-4" ? "critical" : item.assurance_level === "CAL-3" ? "required" : "normal",
    required: true, blocking: true, status: stateMap[item.state] || "discovered", rollback_plan: item.rollback_plan }));
}

function missingPrecoreAuthorityRef(name, identity, input) {
  return { id: `missing:${name}`, revision: "missing", digest: softwareDigest({ name, state: "MISSING",
    tenant_id: identity.tenant_id, project_id: input.project_id, work_id: input.work_id, change_id: input.change_id }) };
}

function boundPrecoreRepositoryId(snapshot) {
  const graphRepository = String(snapshot.graph?.repository_id || "");
  const resourceId = String(snapshot.repository?.resource_id || "");
  const canonicalIdentifier = String(snapshot.repository?.canonical_identifier || "");
  if (!graphRepository || !resourceId || ![resourceId, canonicalIdentifier].includes(graphRepository)) {
    fail("nyra_precore_repository_graph_binding_mismatch");
  }
  return resourceId;
}

function currentPrecoreAuthorityState(snapshot, identity, input) {
  const dbNowMs = snapshot.db_now instanceof Date ? snapshot.db_now.getTime() : Date.parse(snapshot.db_now);
  const researchPlan = snapshot.artifacts?.research_plan?.at(-1) || null;
  const researchEvidence = snapshot.artifacts?.research_evidence
    ?.filter((item) => item.research_plan_digest === researchPlan?.research_plan_digest).at(-1) || null;
  const technologyEvidence = snapshot.artifacts?.technical_evidence
    ?.filter((item) => item.research_plan_digest === researchPlan?.research_plan_digest).at(-1) || null;
  const securityChallenges = (snapshot.challenges || []).filter((item) =>
    (item.challenge_type === "security_gap" || item.type === "security_gap")
    && item.status !== "verified_resolved" && item.status !== "rejected_by_core");
  const securityAssessment = (snapshot.evidence || []).filter((item) => item.independence !== "EXECUTOR"
    && item.contradiction_status === "NONE"
    && Date.parse(item.observed_at) + Number(item.freshness_seconds || 0) * 1000 >= dbNowMs
    && (item.baseline?.schema_version === "software_security_assessment_v1"
      || item.baseline?.subject_kind === "software_security_assessment_v1"))
    .findLast((item) => item.baseline?.graph_digest === snapshot.graph?.source_digest
      && item.baseline?.change_id === input.change_id) || null;
  const seal = snapshot.icf?.state?.core_seal;
  const missing = (name) => missingPrecoreAuthorityRef(name, identity, input);
  const refs = {
    genesis: snapshot.project?.genesis_intent_id && snapshot.project?.genesis_digest
      ? { id: snapshot.project.genesis_intent_id, revision: "immutable", digest: snapshot.project.genesis_digest } : missing("genesis"),
    intent: snapshot.work?.intent_revision_id && snapshot.project?.intent_digest
      ? { id: snapshot.work.intent_revision_id, revision: snapshot.work.intent_revision_id, digest: snapshot.project.intent_digest } : missing("intent"),
    icf: (seal?.digest || snapshot.icf?.ledger_head_digest)
      ? { id: seal?.seal_id || `icf:${input.work_id}`, revision: String(snapshot.icf?.version || "unknown"),
        digest: seal?.digest || snapshot.icf.ledger_head_digest } : missing("icf"),
    software_reality_graph: snapshot.graph
      ? { id: String(snapshot.graph.work_id || input.work_id), revision: String(snapshot.graph.revision), digest: snapshot.graph.source_digest }
      : missing("software_reality_graph"),
    native_plan: snapshot.native_plan?.plan_id && snapshot.native_plan?.plan_digest
      ? { id: snapshot.native_plan.plan_id, revision: String(snapshot.native_plan.plan_version || 1), digest: snapshot.native_plan.plan_digest }
      : missing("native_plan"),
    security_assessment: securityAssessment
      ? { id: securityAssessment.observation_id, revision: String(securityAssessment.observed_at), digest: securityAssessment.evidence_digest }
      : missing("security_assessment"),
    research_evidence_bundle: researchEvidence?.research_evidence_bundle_digest
      ? { id: researchEvidence.research_evidence_bundle?.bundle_digest || researchEvidence.research_evidence_bundle_digest,
        revision: researchEvidence.capsule_id || "capsule", digest: researchEvidence.research_evidence_bundle_digest }
      : missing("research_evidence_bundle"),
    authority_snapshot: { id: `snapshot:${input.work_id}:${input.plan_id}`, revision: String(snapshot.graph?.revision || "missing"),
      digest: softwareAuthoritySnapshotDigest(snapshot) },
  };
  return { researchPlan, researchEvidence, technologyEvidence, securityChallenges, securityAssessment, seal, refs, dbNowMs };
}

export async function verifyCurrentNyraPrecoreDecision({ store, precoreStore, record } = {}) {
  if (!record || !store?.readClosureSnapshot || !precoreStore?.verify) {
    return { valid: false, reasons: ["DECISION_UNAVAILABLE"], record: record || null };
  }
  const scope = record.scope || {};
  const input = { project_id: scope.project_id, work_id: scope.work_id, change_id: scope.change_id, plan_id: scope.plan_id };
  const identity = { tenant_id: scope.tenant_id };
  const snapshot = await store.readClosureSnapshot({ tenant_id: scope.tenant_id, project_id: scope.project_id,
    work_id: scope.work_id, change_id: scope.change_id, plan_id: scope.plan_id });
  const repositoryId = boundPrecoreRepositoryId(snapshot);
  const authority = currentPrecoreAuthorityState(snapshot, identity, input);
  const expected = {
    "scope.tenant_id": scope.tenant_id,
    "scope.project_id": scope.project_id,
    "scope.repository_id": String(repositoryId),
    "scope.work_id": scope.work_id,
    "scope.change_id": scope.change_id,
    "scope.plan_id": scope.plan_id,
    "subject.base_revision": snapshot.graph?.base_revision,
    "subject.candidate_revision": snapshot.graph?.candidate_revision,
    "subject.change_digest": snapshot.change?.request_digest,
    "authority_refs.genesis.digest": authority.refs.genesis.digest,
    "authority_refs.intent.digest": authority.refs.intent.digest,
    "authority_refs.icf.digest": authority.refs.icf.digest,
    "authority_refs.software_reality_graph.digest": authority.refs.software_reality_graph.digest,
    "authority_refs.native_plan.digest": authority.refs.native_plan.digest,
    "authority_refs.security_assessment.digest": authority.refs.security_assessment.digest,
    "authority_refs.research_evidence_bundle.digest": authority.refs.research_evidence_bundle.digest,
    "authority_refs.authority_snapshot.digest": authority.refs.authority_snapshot.digest,
  };
  return precoreStore.verify({ ...scope, repository_id: String(repositoryId) }, record.decision_id, expected);
}

export function alignNyraPrecoreWithCore({ verification, core_allowed } = {}) {
  if (!verification?.record) return { schema_version: "nyra_precore_alignment_v1", status: "UNAVAILABLE",
    decision_id: null, decision_digest: null, reason_codes: ["NO_CURRENT_PRECORE_DECISION"], execution_authorized: false };
  if (verification.valid !== true) return { schema_version: "nyra_precore_alignment_v1", status: "INVALID",
    decision_id: verification.record.decision_id, decision_digest: verification.record.chain?.record_digest || null,
    reason_codes: verification.reasons || ["PRECORE_VERIFICATION_FAILED"], execution_authorized: false };
  const nyraSupports = verification.record.decision?.kind === "PROPOSE";
  const agrees = Boolean(core_allowed) === nyraSupports;
  return { schema_version: "nyra_precore_alignment_v1", status: agrees ? "AGREES" : "OVERRIDES",
    decision_id: verification.record.decision_id, decision_digest: verification.record.chain.record_digest,
    reason_codes: agrees ? ["CORE_AND_NYRA_DIRECTION_MATCH"]
      : [`CORE_${core_allowed ? "ALLOWED" : "DENIED"}_NYRA_${verification.record.decision?.kind || "UNKNOWN"}`],
    core_independent_decision: true, execution_authorized: false };
}

export async function requireCurrentSoftwareClosure({ store, tenant_id, work_id }) {
  if (!store || typeof store.readReleaseReadyClosure !== "function") fail("software_cognition_closure_unavailable");
  const closure = await store.readReleaseReadyClosure({ tenant_id, work_id });
  if (!closure?.payload || closure.payload.verdict !== "RELEASE_READY" || closure.payload.authoritative_transition_performed !== false) {
    fail("software_cognition_closure_required");
  }
  const graph = await store.readGraph(tenant_id, closure.project_id, work_id);
  if (!graph || graph.revision !== closure.payload.graph_revision || graph.source_digest !== closure.payload.graph_digest) {
    fail("software_cognition_closure_stale");
  }
  const snapshot = await store.readClosureSnapshot({ tenant_id, project_id: closure.project_id, work_id,
    change_id: closure.payload.change_id, plan_id: closure.payload.plan_id });
  const snapshotNowMs = snapshot.db_now instanceof Date ? snapshot.db_now.getTime() : Date.parse(snapshot.db_now);
  if (softwareAuthoritySnapshotDigest(snapshot) !== closure.payload.authority_snapshot_digest ||
      !closure.payload.evidence_fresh_until || Date.parse(closure.payload.evidence_fresh_until) < snapshotNowMs) {
    fail("software_cognition_closure_authority_changed");
  }
  return closure;
}

export function createSoftwareCognitionRuntime({ store, researchAirlock = null, precoreStore = null, precoreMode = "OFF", now = () => Date.now() } = {}) {
  if (!store || typeof store.readGraph !== "function") fail("software_cognition_store_required");
  async function persist(identity, input, kind, payload, digest, id = resultId(kind, payload)) {
    return store.writeArtifact({ tenant_id: identity.tenant_id, project_id: input.project_id, work_id: input.work_id,
      change_id: input.change_id, plan_id: input.plan_id, kind, id, digest, payload, actor_id: identity.actor_id });
  }
  async function graphRequired(identity, projectId, workId) { const graph = await store.readGraph(identity.tenant_id, projectId, workId); if (!graph) fail("software_graph_not_found"); return graphShape(graph); }

  async function invoke(capability, identity, input = {}) {
    if (!identity?.tenant_id || !identity?.actor_id || !identity?.provenance?.session_fingerprint) fail("software_dtt_identity_required");
    const scope = { tenant_id: identity.tenant_id, project_id: input.project_id };
    if (input.tenant_id !== undefined && input.tenant_id !== identity.tenant_id) fail("cross_tenant_software_request");
    if (input.work_id) {
      if (typeof store.verifyCausalBinding !== "function") fail("software_causal_binding_verifier_required");
      await store.verifyCausalBinding({ ...scope, work_id: input.work_id, change_id: input.change_id });
    }
    if (["software_cognition_precore_decide", "nyra_precore_decision_generate"].includes(capability)
      && !input[PRECORE_AUTHORITY_LOCK]) {
      if (typeof store.withPrecoreAuthorityLock !== "function") fail("software_precore_authority_lock_required");
      return store.withPrecoreAuthorityLock({ ...scope, work_id: input.work_id, plan_id: input.plan_id },
        (locked) => invoke(capability, identity, { ...input, [PRECORE_AUTHORITY_LOCK]: locked }));
    }
    if (["software_cognition_graph_upsert", "software_cognition_index_diff"].includes(capability)) {
      const evidenceDigest = input.diff_evidence_digest || input.source_evidence_digest;
      const subject = capability === "software_cognition_index_diff"
        ? { repository: input.repository, base_commit: input.base_commit, head_commit: input.head_commit, changed_files: input.changed_files }
        : { expected_revision: input.expected_revision, nodes: input.nodes, edges: input.edges };
      const subjectDigest = softwareDigest(subject);
      const authority = evidenceDigest && await store.readVerifiedLearningEvidence({ ...scope, work_id: input.work_id,
        evidence_digest: evidenceDigest, subject_digest: subjectDigest });
      if (!authority) fail("software_diff_evidence_not_authorized");
      return { schema_version: "software_atlas_mutation_authorization_v1", authorized: true,
        tenant_id: identity.tenant_id, project_id: input.project_id, work_id: input.work_id, change_id: input.change_id,
        request_digest: softwareDigest(input), subject_digest: subjectDigest, evidence_digest: evidenceDigest, atlas_single_writer: "work_continuity_runtime" };
    }
    if (capability === "software_cognition_graph_select") {
      const graph = await graphRequired(identity, input.project_id, input.work_id); const seeds = new Set(input.seed_node_ids || []); const selected = new Set(seeds);
      const edgeTypes = input.edge_types?.length ? new Set(input.edge_types) : null;
      for (let depth = 0; depth < Number(input.max_depth ?? 2); depth += 1) for (const edge of graph.edges) {
        if (edgeTypes && !edgeTypes.has(edge.edge_type)) continue;
        if (selected.has(edge.from_node_id) || selected.has(edge.to_node_id)) { selected.add(edge.from_node_id); selected.add(edge.to_node_id); }
      }
      const nodes = graph.nodes.filter((node) => selected.has(node.node_id)).slice(0, Number(input.max_nodes || 200));
      let bytes = Buffer.byteLength(JSON.stringify(nodes)); while (nodes.length && bytes > Number(input.max_bytes || 128000)) { nodes.pop(); bytes = Buffer.byteLength(JSON.stringify(nodes)); }
      return { schema_version: "software_bounded_context_v1", ...scope, graph_revision: graph.revision, nodes, selected_nodes: nodes.length, selected_bytes: bytes,
        avoided_bytes: Math.max(0, Buffer.byteLength(JSON.stringify(graph.nodes)) - bytes), selection_provenance: { seed_node_ids: [...seeds], max_depth: input.max_depth ?? 2 } };
    }
    if (capability === "software_cognition_traceability_build") {
      const graph = await graphRequired(identity, input.project_id, input.work_id);
      const links = [];
      for (const link of input.links || []) {
        if (link.state === "verified") {
          if (!link.evidence_refs?.length) fail("traceability_verification_evidence_not_authorized");
          const subjectDigest = softwareDigest({ from_node_id: link.from_node_id, to_node_id: link.to_node_id, relation: link.relation });
          for (const evidenceDigest of link.evidence_refs) if (!await store.readVerifiedLearningEvidence({ ...scope, work_id: input.work_id,
            evidence_digest: evidenceDigest, subject_digest: subjectDigest })) fail("traceability_verification_evidence_not_authorized");
        }
        links.push(link);
      }
      const output = buildRequirementTraceability({ ...scope, graph, links });
      await persist(identity, input, "traceability", output, output.traceability_digest); return output;
    }
    if (capability === "software_cognition_architecture_recover") {
      const graph = await graphRequired(identity, input.project_id, input.work_id);
      const verified = [];
      for (const proof of input.verification_evidence || []) {
        const authority = proof.evidence_digest && await store.readVerifiedLearningEvidence({ ...scope, work_id: input.work_id,
          evidence_digest: proof.evidence_digest, subject_digest: softwareDigest({ assertion_id: proof.assertion_id }) });
        if (authority) verified.push(proof);
      }
      const output = recoverSoftwareArchitecture({ ...scope, graph, verification_evidence: verified });
      await persist(identity, input, "architecture", output, output.architecture_digest); return output;
    }
    if (capability === "software_cognition_event_route") {
      const graph = await graphRequired(identity, input.project_id, input.work_id);
      const output = routeSoftwareCognitionEvent({ ...scope, graph, event: input.event, max_nodes: input.max_nodes, max_depth: input.max_depth });
      await persist(identity, input, "supervision", output, output.route_digest); return output;
    }
    if (capability === "software_cognition_calibration_update") {
      const cases = [];
      for (const item of input.cases || []) {
        const { evidence_digest: evidenceDigest, ...caseSubject } = item;
        const authority = evidenceDigest && await store.readVerifiedLearningEvidence({ ...scope, work_id: item.source_work_id || input.work_id,
          evidence_digest: evidenceDigest, subject_digest: softwareDigest(caseSubject) });
        cases.push({ ...item, tenant_id: identity.tenant_id, project_id: input.project_id,
          outcome_state: authority ? "verified" : "unverified", independently_verified: Boolean(authority) });
      }
      const output = calibrateSoftwareSupervision({ ...scope, cases });
      await persist(identity, input, "calibration", output, output.calibration_digest); return output;
    }
    if (capability === "software_cognition_impact_predict") {
      const graph = await graphRequired(identity, input.project_id, input.work_id); if (Number(input.expected_revision) !== graph.revision) fail("stale_graph_revision");
      const impact = predictSoftwareImpact({ ...scope, change_id: input.change_id, graph, seed_node_ids: input.seed_node_ids, max_depth: input.max_depth, max_nodes: input.max_nodes });
      await persist(identity, input, "impact", impact, impact.impact_digest); return impact;
    }
    if (capability === "software_cognition_obligation_expand") {
      const impacts = await store.readArtifacts({ ...scope, work_id: input.work_id, change_id: input.change_id, plan_id: input.plan_id, kind: "impact" }); const impact = impacts.at(-1); if (!impact) fail("software_impact_not_found");
      const existing = typeof store.readCausalObligations === "function" ? softwareObligations(await store.readCausalObligations({ ...scope, work_id: input.work_id, change_id: input.change_id })) : [];
      return expandSoftwareObligations({ ...scope, work_id: input.work_id, change_id: input.change_id, impact, existing });
    }
    if (capability === "software_cognition_obligation_coverage") {
      if (typeof store.readCausalObligations !== "function") fail("software_causal_obligation_reader_required");
      const obligations = softwareObligations(await store.readCausalObligations({ ...scope, work_id: input.work_id, change_id: input.change_id }));
      const coverage = calculateCausalObligationCoverage(obligations); const payload = { ...coverage, ...scope, work_id: input.work_id, coverage_digest: softwareDigest({ ...coverage, ...scope, work_id: input.work_id }) };
      await persist(identity, input, "coverage", payload, payload.coverage_digest); return payload;
    }
    if (capability === "software_cognition_plan_record") {
      const graph = await graphRequired(identity, input.project_id, input.work_id); if (input.base_state_digest !== graph.source_digest) fail("stale_project_state");
      const native = await store.readNativePlan({ tenant_id: identity.tenant_id, work_id: input.work_id, plan_id: input.plan_id });
      if (native.status !== "planned" || !native.plan?.software_contract) fail("software_native_plan_contract_required");
      if (native.plan.software_contract.change_id !== input.change_id || native.plan.software_contract.base_state_digest !== graph.source_digest) fail("software_native_plan_binding_mismatch");
      return { ...native.plan.software_contract, plan_id: native.plan_id, plan_digest: native.plan_digest, authority: "core_continuity_native_plans" };
    }
    if (capability === "software_cognition_supervise") {
      const native = await store.readNativePlan({ tenant_id: identity.tenant_id, work_id: input.work_id, plan_id: input.plan_id });
      const impacts = await store.readArtifacts({ ...scope, work_id: input.work_id, change_id: input.change_id, plan_id: input.plan_id, kind: "impact" });
      const plan = { ...native.plan.software_contract, plan_id: native.plan_id, work_id: input.work_id, change_id: input.change_id };
      if (typeof store.readCausalObligations !== "function" || typeof store.readSupervisionBindings !== "function") fail("software_supervision_authority_reader_required");
      const obligations = softwareObligations(await store.readCausalObligations({ ...scope, work_id: input.work_id, change_id: input.change_id }));
      const bindings = await store.readSupervisionBindings({ ...scope, work_id: input.work_id });
      const output = superviseWorkerPlan({ ...scope, work_id: input.work_id, change_id: input.change_id, plan, impact: impacts.at(-1), obligations, bindings });
      for (const challenge of output.challenges) await store.writeChallenge({ tenant_id: identity.tenant_id, work_id: input.work_id,
        plan_id: input.plan_id, change_id: input.change_id, challenge, digest: softwareDigest(challenge), actor_id: identity.actor_id }); return output;
    }
    if (capability === "software_cognition_challenge_read") return store.readChallenges({ tenant_id: identity.tenant_id, work_id: input.work_id, plan_id: input.plan_id });
    if (capability === "software_cognition_challenge_resolve") {
      const challenges = await store.readChallenges({ tenant_id: identity.tenant_id, work_id: input.work_id, plan_id: input.plan_id }); const challenge = challenges.find((item) => item.challenge_id === input.challenge_id); if (!challenge) fail("challenge_not_found");
      const resolution = resolveSupervisoryChallenge(challenge, { ...input.resolution, actor_provenance: { authenticated_actor_id: identity.actor_id, session_fingerprint: identity.provenance.session_fingerprint } });
      if (resolution.status === "rebutted") for (const evidenceDigest of resolution.resolution.evidence_refs) {
        const authority = await store.readVerifiedLearningEvidence({ ...scope, work_id: input.work_id,
          evidence_digest: evidenceDigest, subject_digest: resolution.resolution.evidence_subject_digest });
        if (!authority) fail("challenge_rebuttal_evidence_not_authorized");
      }
      if (typeof store.writeChallengeResolution !== "function") fail("software_challenge_cas_required");
      await store.writeChallengeResolution({ tenant_id: identity.tenant_id, work_id: input.work_id, plan_id: input.plan_id,
        challenge_id: input.challenge_id, expected_version: input.resolution.expected_version, payload: resolution,
        digest: resolution.resolution_digest, actor_id: identity.actor_id }); return resolution;
    }
    if (capability === "software_cognition_impact_reconcile") {
      const { evidence_digest: actualEvidenceDigest, ...actualSubject } = input.actual || {};
      const actualEvidence = actualEvidenceDigest && await store.readVerifiedLearningEvidence({ ...scope, work_id: input.work_id,
        evidence_digest: actualEvidenceDigest, subject_digest: softwareDigest(actualSubject) });
      if (!actualEvidence) fail("actual_change_evidence_not_authorized");
      const impacts = await store.readArtifacts({ ...scope, work_id: input.work_id, change_id: input.change_id, plan_id: input.plan_id, kind: "impact" }); const reconciliation = reconcileSoftwareImpact({ ...scope, predicted: impacts.at(-1), actual: input.actual });
      await persist(identity, input, "reconciliation", reconciliation, reconciliation.reconciliation_digest); return reconciliation;
    }
    if (capability === "software_cognition_runtime_observe") {
      const graph = await graphRequired(identity, input.project_id, input.work_id); if (input.graph_digest !== graph.source_digest) fail("stale_runtime_observation");
      const evidenceDigest = input.verification?.evidence_digest;
      const runtimeAuthority = evidenceDigest && await store.readVerifiedLearningEvidence({ ...scope, work_id: input.work_id,
        evidence_digest: evidenceDigest, subject_digest: softwareDigest({ graph_digest: graph.source_digest, observation: input.observation }) });
      if (!runtimeAuthority) fail("runtime_observation_evidence_not_authorized");
      const payload = { schema_version: "software_runtime_observation_v1", ...scope, work_id: input.work_id, graph_digest: graph.source_digest, observation: input.observation,
        verification: { evidence_digest: evidenceDigest }, verified: true, fresh_until: runtimeAuthority.fresh_until, observer_id: identity.actor_id };
      payload.observation_digest = softwareDigest(payload); await persist(identity, input, "runtime_observation", payload, payload.observation_digest); return payload;
    }
    if (capability === "software_cognition_learning_promote") {
      if (typeof store.readVerifiedLearningEvidence !== "function") fail("software_learning_evidence_verifier_required");
      const authority = await store.readVerifiedLearningEvidence({ ...scope, work_id: input.work_id, evidence_digest: input.evidence_digest,
        subject_digest: softwareDigest({ source_work_id: input.work_id, candidate: input.candidate || {} }) });
      if (!authority) fail("unverified_learning_promotion");
      const learning = validateLearningPromotion({ ...input, ...scope, outcome_state: "verified", independently_verified: true,
        evidence_tenant_id: identity.tenant_id, source_work_id: input.work_id });
      await persist(identity, input, "learning", learning, learning.learning_digest); return learning;
    }
    if (capability === "software_cognition_research_plan") {
      if (!researchAirlock?.ready || typeof researchAirlock.createPlan !== "function") fail("software_research_airlock_not_ready");
      const graph = await graphRequired(identity, input.project_id, input.work_id);
      if (input.expected_revision !== undefined && Number(input.expected_revision) !== Number(graph.revision)) fail("stale_graph_revision");
      const plan = buildSoftwareResearchPlan({ ...scope, work_id: input.work_id, change_id: input.change_id, plan_id: input.plan_id,
        graph, question: input.question, risk_tier: input.risk_tier, technology_hints: input.technology_hints,
        version_context: input.version_context, additional_source_urls: input.additional_source_urls,
        repository_id: graph.repository_id, base_revision: graph.base_revision, candidate_revision: graph.candidate_revision });
      if (!plan.technologies.length) return { ...plan, advisory_disposition: "ABSTAIN" };
      const airlock = await researchAirlock.createPlan({ work_binding: { tenant_id: identity.tenant_id, project_id: input.project_id,
        work_id: input.work_id, session_id: identity.provenance.session_fingerprint }, source_urls: plan.sources.map((item) => item.url),
        research_cortex_plan_digest: plan.research_cortex_plan_digest },
      { tenantId: identity.tenant_id, actor: identity.actor_id });
      if (airlock?.verdict !== "ALLOW" || !airlock.plan?.plan_digest || !airlock.plan_capability) fail("software_research_airlock_plan_denied");
      const payload = { ...plan, airlock_plan_digest: airlock.plan.plan_digest, airlock_policy_enforced: true };
      payload.research_plan_digest = softwareDigest({ ...payload, research_plan_digest: undefined });
      await persist(identity, input, "research_plan", payload, payload.research_plan_digest);
      return { ...payload, airlock_plan_capability: airlock.plan_capability, airlock_plan_expires_at: airlock.plan.expires_at };
    }
    if (capability === "software_cognition_technology_profile") {
      const graph = await graphRequired(identity, input.project_id, input.work_id);
      const profiles = buildTechnologyProfiles({ graph, technology_hints: input.technology_hints });
      return { schema_version: "software_technology_profiles_v1", ...scope, work_id: input.work_id,
        graph_revision: graph.revision, graph_digest: graph.source_digest, profiles,
        knowledge_gap: profiles.length === 0, execution_authorized: false, authoritative_transition_performed: false };
    }
    if (capability === "software_cognition_research_bind") {
      if (!researchAirlock?.ready || typeof researchAirlock.verifyEvidenceCapsule !== "function"
        || typeof researchAirlock.readSealedEvidence !== "function") fail("software_research_airlock_not_ready");
      const plans = await store.readArtifacts({ ...scope, work_id: input.work_id, change_id: input.change_id, plan_id: input.plan_id, kind: "research_plan" });
      const plan = plans.findLast((item) => item.research_plan_digest === input.research_plan_digest);
      if (!plan) fail("software_research_plan_not_found");
      const sealedEvidence = await researchAirlock.readSealedEvidence(input.capsule, { tenantId: identity.tenant_id, actor: identity.actor_id });
      const output = bindSoftwareResearchEvidence({ plan, capsule: input.capsule, sealed_evidence: sealedEvidence,
        verified: researchAirlock.verifyEvidenceCapsule(input.capsule), now: Number(now()) });
      await persist(identity, input, "research_evidence", output, output.research_evidence_digest); return output;
    }
    if (capability === "software_cognition_technology_verify") {
      const plans = await store.readArtifacts({ ...scope, work_id: input.work_id, change_id: input.change_id, plan_id: input.plan_id, kind: "research_plan" });
      const plan = plans.findLast((item) => item.research_plan_digest === input.research_plan_digest);
      if (!plan) fail("software_research_plan_not_found");
      const subjectDigest = softwareDigest({ research_plan_digest: input.research_plan_digest, profile_results: input.profile_results || [] });
      const authority = input.evidence_digest && await store.readVerifiedLearningEvidence({ ...scope, work_id: input.work_id,
        evidence_digest: input.evidence_digest, subject_digest: subjectDigest });
      if (!authority) fail("software_technology_evidence_not_authorized");
      const output = validateTechnologyEvidence({ plan, profile_results: input.profile_results,
        evidence_authority: { ...authority, evidence_digest: input.evidence_digest } });
      await persist(identity, input, "technical_evidence", output, output.technology_evidence_digest); return output;
    }
    if (["software_cognition_precore_decide", "nyra_precore_decision_generate"].includes(capability)) {
      if (precoreMode !== "ADVISORY" || !precoreStore || typeof precoreStore.generate !== "function") fail("nyra_precore_decision_not_ready");
      if (typeof store.readClosureSnapshot !== "function") fail("software_authority_snapshot_required");
      const authorityLock = input[PRECORE_AUTHORITY_LOCK];
      if (!authorityLock?.readClosureSnapshot || !authorityLock?.transaction) fail("software_precore_authority_lock_required");
      const snapshot = await authorityLock.readClosureSnapshot({ ...scope, work_id: input.work_id, change_id: input.change_id, plan_id: input.plan_id });
      if (!snapshot.project || !snapshot.work || !snapshot.change || !snapshot.graph || !snapshot.native_plan?.plan?.software_contract) fail("software_causal_binding_not_found");
      const native = snapshot.native_plan; const contract = native.plan.software_contract;
      if (native.status !== "planned" || String(snapshot.latest_native_plan_id) !== String(input.plan_id)
        || String(native.change_id) !== String(input.change_id) || String(contract.change_id) !== String(input.change_id)
        || native.base_state_digest !== snapshot.graph.source_digest || contract.base_state_digest !== snapshot.graph.source_digest) fail("software_native_plan_binding_mismatch");
      const authorityState = currentPrecoreAuthorityState(snapshot, identity, input);
      const { researchPlan, researchEvidence, technologyEvidence, securityChallenges, securityAssessment, seal, refs } = authorityState;
      const issuedAt = new Date(Number(now())).toISOString();
      const evidenceExpiries = [researchEvidence?.fresh_until, technologyEvidence?.fresh_until].filter((value) => Date.parse(value || "") >= Date.parse(issuedAt));
      const latestExpiry = evidenceExpiries.length ? new Date(Math.min(...evidenceExpiries.map(Date.parse))).toISOString() : new Date(Number(now()) + 10 * 60_000).toISOString();
      const intentVerified = snapshot.project.active_intent_revision_id === snapshot.work.intent_revision_id
        && snapshot.work.intent_revision_id === snapshot.change.intent_revision_id && snapshot.project.intent_state === "APPROVED";
      const icfVerified = snapshot.icf?.state?.closure === "SEALED" && seal?.decision === "ALLOW_CLOSE" && seal?.signature_key_id !== "development-only";
      const allowedEvidence = new Set([snapshot.graph.source_digest, snapshot.project.intent_digest, seal?.digest,
        researchEvidence?.research_evidence_digest, researchEvidence?.evidence_digest, technologyEvidence?.technology_evidence_digest,
        technologyEvidence?.causal_evidence_digest, ...snapshot.evidence.map((item) => item.evidence_digest)].filter(Boolean));
      for (const ref of input.evidence_refs || []) if (!allowedEvidence.has(ref)) fail("nyra_precore_evidence_not_authorized");
      let disposition = input.disposition;
      if (securityChallenges.some((item) => item.severity === "critical")) disposition = "RECOMMEND_BLOCK";
      else if (!intentVerified || !icfVerified || !securityAssessment) disposition = "CHALLENGE";
      const output = createNyraPrecoreDecision({ ...scope, work_id: input.work_id, change_id: input.change_id, plan_id: input.plan_id,
        disposition, recommendation: input.recommendation, rationale: input.rationale, uncertainties: input.uncertainties,
        repository_id: snapshot.graph.repository_id, base_revision: snapshot.graph.base_revision, candidate_revision: snapshot.graph.candidate_revision,
        change_digest: snapshot.change.change_digest || snapshot.change.canonical_digest || null,
        claim_ids: researchEvidence?.claim_ids || [], tool_result_ids: technologyEvidence?.verified_profiles?.flatMap((item) => Object.values(item.adapter_receipts || {}).flat()) || [],
        evidence_refs: [...new Set([...(input.evidence_refs || []), snapshot.graph.source_digest, researchEvidence?.research_evidence_digest].filter(Boolean))],
        research_plan: researchPlan, research_evidence: researchEvidence, technology_evidence: technologyEvidence, issued_at: issuedAt, fresh_until: latestExpiry,
        bindings: { genesis: { id: snapshot.project.genesis_intent_id, digest: snapshot.project.genesis_digest },
          intent: { id: snapshot.work.intent_revision_id, digest: snapshot.project.intent_digest, verified: intentVerified },
          icf: { id: seal?.seal_id || (snapshot.icf ? `icf:${input.work_id}` : null), digest: seal?.digest || snapshot.icf?.ledger_head_digest || null,
            ledger_head_digest: snapshot.icf?.ledger_head_digest || null, verified: icfVerified },
          security: { id: securityAssessment?.observation_id || null, digest: securityAssessment?.evidence_digest || null,
            status: securityAssessment && !securityChallenges.length ? "verified_no_critical_gap" : "challenged",
            critical: securityChallenges.some((item) => item.severity === "critical") || securityAssessment?.baseline?.critical === true,
            challenge_ids: securityChallenges.map((item) => item.challenge_id) },
          graph: { revision: snapshot.graph.revision, digest: snapshot.graph.source_digest },
          native_plan: { id: native.plan_id, digest: native.plan_digest }, authority_snapshot_digest: softwareAuthoritySnapshotDigest(snapshot) } });
      const repositoryId = boundPrecoreRepositoryId(snapshot);
      const baseRevision = snapshot.graph.base_revision;
      const candidateRevision = snapshot.graph.candidate_revision;
      const changeDigest = snapshot.change.request_digest;
      if (!repositoryId || !baseRevision || !candidateRevision || !changeDigest) fail("nyra_precore_repository_revision_binding_required");
      return precoreStore.generate({
        scope: { tenant_id: identity.tenant_id, project_id: input.project_id, repository_id: String(repositoryId),
          work_id: input.work_id, change_id: input.change_id, plan_id: input.plan_id },
        subject: { base_revision: baseRevision, candidate_revision: candidateRevision, change_digest: changeDigest }, authority_refs: refs,
        decision: { kind: output.disposition, proposed_next_step: output.disposition === "PROPOSE" ? "PROPOSE_TO_CORE_REVIEW"
          : output.disposition === "CHALLENGE" ? "COLLECT_EVIDENCE" : output.disposition === "RECOMMEND_BLOCK" ? "STOP_AND_REVIEW" : "COLLECT_EVIDENCE",
          summary: output.recommendation, risks: input.risks || [], conditions: input.conditions || [],
          rollback_requirements: input.rollback_requirements || [], open_challenges: securityChallenges.map((item) => item.challenge_id),
          knowledge_gaps: output.uncertainties },
        evidence: { claim_ids: output.evidence.claim_ids, tool_result_ids: output.evidence.tool_result_ids,
          coverage: { state: output.evidence.coverage_state, research_evidence_digest: output.research_evidence_digest,
            technology_evidence_digest: output.technology_evidence_digest }, freshness_evaluated_at: issuedAt,
          fresh_until: latestExpiry, evidence_digest: output.evidence.evidence_digest }, agent_instance_id: identity.actor_id,
        expected_sequence: Number(input.expected_sequence || 0), expected_parent_digest: input.expected_parent_digest || null,
        supersedes_decision_id: input.supersedes_decision_id || null,
        idempotency_key: input.idempotency_key || `precore:${input.change_id}:${candidateRevision}:${output.disposition}`,
      }, { transaction: authorityLock.transaction });
    }
    if (["software_cognition_precore_read", "nyra_precore_decision_list"].includes(capability)) {
      if (precoreMode !== "ADVISORY" || !precoreStore) fail("nyra_precore_decision_not_ready");
      const snapshot = await store.readClosureSnapshot({ ...scope, work_id: input.work_id, change_id: input.change_id, plan_id: input.plan_id });
      const repositoryId = boundPrecoreRepositoryId(snapshot);
      return precoreStore.list({ ...scope, repository_id: String(repositoryId), work_id: input.work_id, change_id: input.change_id, plan_id: input.plan_id },
        { limit: input.limit, before_sequence: input.before_sequence });
    }
    if (capability === "nyra_precore_decision_read") {
      if (precoreMode !== "ADVISORY" || !precoreStore) fail("nyra_precore_decision_not_ready");
      const snapshot = await store.readClosureSnapshot({ ...scope, work_id: input.work_id, change_id: input.change_id, plan_id: input.plan_id });
      const repositoryId = boundPrecoreRepositoryId(snapshot);
      return precoreStore.read({ ...scope, repository_id: String(repositoryId || ""), work_id: input.work_id, change_id: input.change_id, plan_id: input.plan_id }, input.decision_id);
    }
    if (capability === "nyra_precore_decision_verify") {
      if (precoreMode !== "ADVISORY" || !precoreStore) fail("nyra_precore_decision_not_ready");
      const snapshot = await store.readClosureSnapshot({ ...scope, work_id: input.work_id, change_id: input.change_id, plan_id: input.plan_id });
      const repositoryId = boundPrecoreRepositoryId(snapshot);
      const authorityState = currentPrecoreAuthorityState(snapshot, identity, input);
      const expected = { "scope.tenant_id": identity.tenant_id, "scope.project_id": input.project_id,
        "scope.repository_id": String(repositoryId || ""), "scope.work_id": input.work_id, "scope.change_id": input.change_id,
        "scope.plan_id": input.plan_id, "subject.base_revision": snapshot.graph?.base_revision,
        "subject.candidate_revision": snapshot.graph?.candidate_revision, "subject.change_digest": snapshot.change?.request_digest,
        "authority_refs.genesis.digest": snapshot.project?.genesis_digest, "authority_refs.intent.digest": snapshot.project?.intent_digest,
        "authority_refs.icf.digest": authorityState.refs.icf.digest,
        "authority_refs.software_reality_graph.digest": snapshot.graph?.source_digest,
        "authority_refs.native_plan.digest": authorityState.refs.native_plan.digest,
        "authority_refs.security_assessment.digest": authorityState.refs.security_assessment.digest,
        "authority_refs.research_evidence_bundle.digest": authorityState.refs.research_evidence_bundle.digest,
        "authority_refs.authority_snapshot.digest": authorityState.refs.authority_snapshot.digest };
      return precoreStore.verify({ ...scope, repository_id: String(repositoryId || ""), work_id: input.work_id,
        change_id: input.change_id, plan_id: input.plan_id }, input.decision_id, expected);
    }
    if (capability === "software_cognition_closure_evaluate") {
      if (typeof store.readClosureSnapshot !== "function") fail("software_authority_snapshot_required");
      const snapshot = await store.readClosureSnapshot({ ...scope, work_id: input.work_id, change_id: input.change_id, plan_id: input.plan_id });
      const graph = snapshot.graph; if (!graph) fail("software_graph_not_found");
      const { reconciliation: reconciliations = [], runtime_observation: observations = [] } = snapshot.artifacts;
      const challenges = snapshot.challenges || [];
      const latestPlan = snapshot.native_plan; if (!latestPlan?.plan?.software_contract) fail("software_native_plan_contract_required");
      if (!snapshot.project || !snapshot.work || !snapshot.change) fail("software_causal_binding_not_found");
      const softwareContract = latestPlan.plan.software_contract;
      const sameValue = (left, right) => String(left ?? "").trim() === String(right ?? "").trim();
      if (latestPlan.status !== "planned" || !sameValue(snapshot.latest_native_plan_id, latestPlan.plan_id) ||
          !sameValue(latestPlan.change_id, input.change_id) ||
          !sameValue(latestPlan.base_state_digest, graph.source_digest) ||
          !sameValue(softwareContract.change_id, input.change_id) ||
          !sameValue(softwareContract.base_state_digest, graph.source_digest)) {
        fail("software_native_plan_binding_mismatch");
      }
      const evidenceByDigest = new Map(snapshot.evidence.map((item) => [item.evidence_digest, item]));
      const dbNowMs = snapshot.db_now instanceof Date ? snapshot.db_now.getTime() : Date.parse(snapshot.db_now);
      const independentEvidence = snapshot.evidence.filter((item) => item.independence !== "EXECUTOR" && item.contradiction_status === "NONE" &&
        Date.parse(item.observed_at) + Number(item.freshness_seconds || 0) * 1000 >= dbNowMs);
      const verifiedEvidenceRefs = new Set(independentEvidence.map((item) => item.evidence_digest));
      const effectiveChallenges = challenges.map((item) => item.status === "rebutted" && item.resolution?.evidence_refs?.length > 0 &&
        item.resolution.evidence_subject_digest && item.resolution.evidence_refs.every((ref) =>
          verifiedEvidenceRefs.has(ref) && evidenceByDigest.get(ref)?.baseline?.subject_digest === item.resolution.evidence_subject_digest)
        ? { ...item, status: "verified_resolved" } : item);
      const obligations = softwareObligations(snapshot.obligations);
      const intentVerified = snapshot.project.active_intent_revision_id === snapshot.work.intent_revision_id && snapshot.work.intent_revision_id === snapshot.change.intent_revision_id && snapshot.project.intent_state === "APPROVED";
      const authoritativeIntent = { id: snapshot.work.intent_revision_id, digest: snapshot.project.intent_digest, state: intentVerified ? "verified" : "contradicted" };
      const icfRequired = true;
      const icfSeal = snapshot.icf?.state?.core_seal;
      const icfSealVerified = snapshot.icf?.state?.closure === "SEALED" && icfSeal?.decision === "ALLOW_CLOSE" &&
        icfSeal?.digest && icfSeal?.signature && icfSeal?.signature_key_id && icfSeal.signature_key_id !== "development-only";
      const authoritativeIcf = icfSealVerified ? { id: icfSeal.seal_id, digest: icfSeal.digest, state: "verified",
        ledger_head_digest: snapshot.icf.ledger_head_digest, version: snapshot.icf.version } : null;
      const latestReconciliation = reconciliations.at(-1);
      const reconciliationEvidenceValid = latestReconciliation?.actual_change_digest && verifiedEvidenceRefs.has(latestReconciliation.actual_evidence_digest);
      const runtimeObservation = observations.filter((item) => item.graph_digest === graph.source_digest && item.verified === true &&
        Date.parse(item.fresh_until) >= dbNowMs && verifiedEvidenceRefs.has(item.verification?.evidence_digest || item.evidence_digest)).at(-1);
      const verifierEvidence = runtimeObservation ? evidenceByDigest.get(runtimeObservation.verification?.evidence_digest || runtimeObservation.evidence_digest) : null;
      const claims = snapshot.obligations.map((item) => String(item.claim || "").toLowerCase());
      const verifiedClaim = (pattern) => snapshot.obligations.some((item, index) => pattern.test(claims[index]) && ["VERIFIED_PROVISIONAL", "VERIFIED_FINAL", "CLOSED"].includes(item.state));
      const closure = evaluateSoftwareClosure({ work_id: input.work_id, change_id: input.change_id, obligations, intent_binding: authoritativeIntent,
        icf_required: icfRequired, icf_binding: authoritativeIcf, acceptance_criteria_verified: verifiedClaim(/acceptance|criteri|requirement/),
        challenges: effectiveChallenges, reconciliation: latestReconciliation && reconciliationEvidenceValid ? latestReconciliation : null,
        architecture_constraints_verified: verifiedClaim(/architect|constraint|invariant/), tests_verified: verifiedClaim(/test|regression|quality/),
        runtime_observation: runtimeObservation ? { ...runtimeObservation, fresh: true } : null,
        rollback: { verified: verifiedClaim(/rollback|recovery/) }, verifier: (() => { const agent = latestPlan.agents.find((item) => item.task_kind === "verifier" && item.status === "completed" && item.report?.verdict === "approved"); return agent ? { independently_verified: true, agent_id: agent.agent_id, session_fingerprint: agent.native_session_fingerprint } : null; })(),
        builder: (() => { const agent = latestPlan.agents.find((item) => item.task_kind === "builder"); return agent ? { agent_id: agent.agent_id, session_fingerprint: agent.native_session_fingerprint } : {}; })() });
      if (input.intent_binding && (input.intent_binding.id !== authoritativeIntent.id || input.intent_binding.digest !== authoritativeIntent.digest)) closure.reasons.push("intent_binding_substitution");
      if (input.icf_binding && (!authoritativeIcf || input.icf_binding.digest !== authoritativeIcf.digest)) closure.reasons.push("icf_binding_substitution");
      if (snapshot.native_closure?.evaluation?.closed !== true) closure.reasons.push("native_closure_not_verified");
      const researchPlan = snapshot.artifacts.research_plan?.at(-1);
      if (researchPlan?.research_required === true) {
        const researchEvidence = snapshot.artifacts.research_evidence?.filter((item) => item.research_plan_digest === researchPlan.research_plan_digest).at(-1);
        const technologyEvidence = snapshot.artifacts.technical_evidence?.filter((item) => item.research_plan_digest === researchPlan.research_plan_digest).at(-1);
        if (!researchEvidence?.verified || Date.parse(researchEvidence.fresh_until || "") < dbNowMs) closure.reasons.push("technical_research_evidence_missing");
        if ((researchEvidence?.contradictions || []).length) closure.reasons.push("technical_research_contradiction");
        if (researchPlan.technical_verification_required === true
          && (!technologyEvidence?.verified || Date.parse(technologyEvidence.fresh_until || "") < dbNowMs)) closure.reasons.push("technology_adapter_evidence_missing");
      }
      closure.graph_revision = graph.revision;
      closure.graph_digest = graph.source_digest;
      closure.project_id = input.project_id;
      closure.plan_id = input.plan_id;
      closure.authority_snapshot_digest = softwareAuthoritySnapshotDigest(snapshot);
      closure.evidence_fresh_until = independentEvidence.length ? new Date(Math.min(...independentEvidence.map((item) => Date.parse(item.observed_at) + Number(item.freshness_seconds || 0) * 1000))).toISOString() : null;
      closure.verdict = closure.reasons.length ? "CLOSURE_DENIED" : closure.verdict; closure.authoritative_transition_performed = false;
      closure.closure_digest = softwareDigest({ ...closure, closure_digest: undefined }); await persist(identity, input, "closure", closure, closure.closure_digest); return closure;
    }
    fail("software_cognition_capability_unknown");
  }
  return Object.freeze({ initialize: () => store.initialize(), invoke });
}
