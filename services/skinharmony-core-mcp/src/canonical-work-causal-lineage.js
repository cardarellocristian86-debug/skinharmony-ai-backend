import crypto from "node:crypto";

function payload(value) {
  const structured = value?.structuredContent && typeof value.structuredContent === "object"
    ? value.structuredContent : value;
  return structured?.ok === true && structured.result && typeof structured.result === "object"
    ? structured.result : structured;
}
function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function fail(code) { const error = new Error(code); error.code = code; error.status = 409; throw error; }
function isCausalNotFound(error) {
  const code = String(error?.code || error?.message || "").toLowerCase();
  return code === "causal_not_found" || code === "causal_causal_not_found";
}

function lineageKey(identity, projectAlias, suffix) {
  return `canonical-work-${suffix}-${digest({
    tenant_id: identity.tenantId,
    project_alias: projectAlias,
  }).slice(0, 48)}`;
}

function approvedRevision(decisionPath, project) {
  const activeIntentRevisionId = String(project?.active_intent_revision_id
    || decisionPath?.project?.active_intent_revision_id || "").trim();
  return (decisionPath?.intent_revisions || []).find((item) =>
    item?.state === "APPROVED" && item.intent_revision_id === activeIntentRevisionId) || null;
}

function bootstrapInitialProposal(revision, work, projectAlias) {
  const revisionPayload = revision?.revision_payload && typeof revision.revision_payload === "object"
    ? revision.revision_payload : {};
  return revision?.state === "PROPOSED" && revision.parent_revision_id == null &&
    revision.alias === "canonical-work-bootstrap-initial" &&
    revision.classification === "REFINEMENT" &&
    revisionPayload.motivation === "Establish the initial approved causal decision path for canonical Work lineage." &&
    revisionPayload.problem === String(work.objective || work.idea || projectAlias).slice(0, 8_000) &&
    JSON.stringify(revisionPayload.scope_added || []) === JSON.stringify([projectAlias]) &&
    JSON.stringify(revisionPayload.invariants || []) === JSON.stringify([
      "Canonical Work lineage remains server-derived and effect-free at bootstrap.",
    ]);
}

async function readGenesisOrMaterialize({ handlers, identity, work, projectAlias, projectId }) {
  try {
    return payload(await handlers.genesis_intent_read({ project_id: projectId }, identity));
  } catch (error) {
    if (!isCausalNotFound(error)) fail("canonical_work_causal_intent_missing");
  }
  try {
    await handlers.genesis_intent_create({
      project_id: projectId,
      intent_text: String(work.objective || work.idea || projectAlias).slice(0, 20_000),
      idempotency_key: lineageKey(identity, projectAlias, "genesis"),
    }, identity);
  } catch {
    // A concurrent bootstrap can have committed the immutable Genesis first.
  }
  try {
    return payload(await handlers.genesis_intent_read({ project_id: projectId }, identity));
  } catch {
    fail("canonical_work_causal_genesis_materialization_failed");
  }
}

async function materializeProjectDecisionPath({ handlers, identity, work, projectAlias, project }) {
  const projectKey = lineageKey(identity, projectAlias, "project");
  let resolvedProject = project;
  if (!resolvedProject) {
    try {
      resolvedProject = payload(await handlers.project_identity_create({
        alias: projectAlias,
        canonical_name: projectAlias,
        provenance: {
          source: "canonical_work_bootstrap_v1",
          server_derived: true,
          ...(String(work?.work_id || "").trim()
            ? { work_id: String(work.work_id).trim() }
            : {}),
        },
        idempotency_key: projectKey,
      }, identity));
    } catch (error) {
      // A concurrent bootstrap may have won the idempotent project creation.
      // Re-read it; any other failure stays fail-closed.
      if (!isCausalNotFound(error)) {
        try { resolvedProject = payload(await handlers.project_identity_resolve({ alias: projectAlias }, identity)); }
        catch { fail("canonical_work_causal_project_materialization_failed"); }
      } else {
        fail("canonical_work_causal_project_materialization_failed");
      }
    }
  }
  const projectId = String(resolvedProject?.project_id || "").trim();
  if (!projectId) fail("canonical_work_causal_project_missing");
  await readGenesisOrMaterialize({ handlers, identity, work, projectAlias, projectId });
  let decisionPath;
  try { decisionPath = payload(await handlers.project_decision_path_read({ project_id: projectId }, identity)); }
  catch { fail("canonical_work_causal_intent_missing"); }
  if (!decisionPath?.genesis_intent) fail("canonical_work_causal_genesis_missing");
  if (!approvedRevision(decisionPath, resolvedProject)) {
    const drafts = (decisionPath.intent_revisions || []).filter((revision) =>
      bootstrapInitialProposal(revision, work, projectAlias));
    if ((decisionPath.intent_revisions || []).length !== 0 && drafts.length !== 1) {
      fail("canonical_work_causal_active_intent_missing");
    }
    if (!drafts[0]) {
      try {
        await handlers.intent_revision_propose({
          project_id: projectId,
          alias: "canonical-work-bootstrap-initial",
          classification: "REFINEMENT",
          motivation: "Establish the initial approved causal decision path for canonical Work lineage.",
          problem: String(work.objective || work.idea || projectAlias).slice(0, 8_000),
          scope_added: [projectAlias],
          invariants: ["Canonical Work lineage remains server-derived and effect-free at bootstrap."],
          risks: [],
          affected_work_ids: [],
          idempotency_key: lineageKey(identity, projectAlias, "initial-revision"),
        }, identity);
      } catch {
        // The deterministic proposal may have committed while its response was lost.
      }
    }
    try {
      decisionPath = payload(await handlers.project_decision_path_read({ project_id: projectId }, identity));
      resolvedProject = decisionPath?.project || resolvedProject;
    } catch { fail("canonical_work_causal_intent_missing"); }
    if (!approvedRevision(decisionPath, resolvedProject)) {
      const resumable = (decisionPath.intent_revisions || []).filter((revision) =>
        bootstrapInitialProposal(revision, work, projectAlias));
      if (resumable.length !== 1 || !resumable[0]?.intent_revision_id) {
        fail("canonical_work_causal_active_intent_missing");
      }
      try {
        await handlers.intent_revision_approve({
          project_id: projectId,
          intent_revision_id: resumable[0].intent_revision_id,
          approved: true,
          expected_no_active_intent: true,
          idempotency_key: lineageKey(identity, projectAlias, "initial-approval"),
        }, identity);
      } catch {
        // The final authoritative readback below distinguishes an exact retry
        // or concurrent approval from a genuinely unavailable decision path.
      }
    }
    try {
      decisionPath = payload(await handlers.project_decision_path_read({ project_id: projectId }, identity));
      resolvedProject = decisionPath?.project || resolvedProject;
    } catch { fail("canonical_work_causal_intent_missing"); }
  }
  return { project: resolvedProject, decisionPath };
}

/**
 * Establishes the project-side causal decision path before a V2 Work is
 * persisted.  It deliberately accepts server-owned bootstrap material without
 * a work_id, so a failure cannot leave a newly-created Work non-operational.
 */
export async function ensureCanonicalWorkProjectDecisionPath({ handlers, identity, work } = {}) {
  if (!handlers || !identity || !work) fail("canonical_work_causal_lineage_dependencies_invalid");
  const projectAlias = String(work.project_id || "").trim();
  if (!projectAlias) fail("canonical_work_causal_lineage_source_invalid");
  let project = null;
  try { project = payload(await handlers.project_identity_resolve({ alias: projectAlias }, identity)); }
  catch (error) { if (!isCausalNotFound(error)) fail("canonical_work_causal_project_missing"); }
  const materialized = await materializeProjectDecisionPath({ handlers, identity, work, projectAlias, project });
  project = materialized.project;
  const decisionPath = materialized.decisionPath;
  const projectId = String(project?.project_id || "").trim();
  if (!projectId) fail("canonical_work_causal_project_missing");
  const revision = approvedRevision(decisionPath, project);
  if (!revision?.intent_revision_id) fail("canonical_work_causal_active_intent_missing");
  return Object.freeze({
    project_id: projectId,
    intent_revision_id: revision.intent_revision_id,
    project_intent_digest: String(revision.canonical_digest || "").trim().toLowerCase(),
  });
}

export async function ensureCanonicalWorkCausalLineage({ handlers, identity, work } = {}) {
  if (!handlers || !identity || !work) fail("canonical_work_causal_lineage_dependencies_invalid");
  const workId = String(work.work_id || "").trim();
  if (!workId) fail("canonical_work_causal_lineage_source_invalid");
  const projectDecision = await ensureCanonicalWorkProjectDecisionPath({ handlers, identity, work });
  const projectId = projectDecision.project_id;
  const revision = {
    intent_revision_id: projectDecision.intent_revision_id,
    canonical_digest: projectDecision.project_intent_digest,
  };
  const workIntentDigest = String(work.intent_digest || "").trim().toLowerCase();
  const activeIntentDigest = String(revision.canonical_digest || "").trim().toLowerCase();
  // Work Continuity and Causal Continuity intentionally use distinct intent
  // domains: the Work digest anchors its bounded execution contract, while
  // the active project revision anchors the wider project decision path.
  // Equating them deadlocked every additional Work in an existing project.
  if (!/^[a-f0-9]{64}$/u.test(workIntentDigest) || !/^[a-f0-9]{64}$/u.test(activeIntentDigest)) {
    fail("canonical_work_causal_intent_binding_mismatch");
  }
  const governedBootstrapIntentDigest = String(work.architecture?.host_binding
    ?.canonical_intent_binding?.canonical_intent_digest || "").trim().toLowerCase();
  // A conversational bootstrap intent is a third, request-scoped domain. It
  // must remain a valid immutable digest, but it is not a project revision.
  if (governedBootstrapIntentDigest && !/^[a-f0-9]{64}$/u.test(governedBootstrapIntentDigest)) {
    fail("canonical_work_causal_intent_binding_mismatch");
  }
  const key = `canonical-work-lineage:${digest({ tenant_id: identity.tenantId,
    project_id: projectId, work_id: workId, intent_revision_id: revision.intent_revision_id,
    work_intent_digest: workIntentDigest, project_intent_digest: activeIntentDigest }).slice(0, 48)}`;
  const state = payload(await handlers.project_state_snapshot({ project_id: projectId,
    idempotency_key: `${key}:state` }, identity));
  if (!state?.state_digest) fail("canonical_work_causal_project_state_missing");
  const bound = payload(await handlers.work_bind_intent({ project_id: projectId,
    work_id: workId, intent_revision_id: revision.intent_revision_id,
    base_state_digest: state.state_digest, legacy_binding_state: "VERIFIED",
    provenance: { source: "canonical_work_bootstrap_v1", server_derived: true },
    idempotency_key: `${key}:work-bind` }, identity));
  if (bound?.work_id !== workId || bound?.project_id !== projectId) {
    fail("canonical_work_causal_binding_readback_invalid");
  }
  return Object.freeze({ project_id: projectId, work_id: workId,
    intent_revision_id: revision.intent_revision_id, work_intent_digest: workIntentDigest,
    project_intent_digest: activeIntentDigest, state_digest: state.state_digest });
}
