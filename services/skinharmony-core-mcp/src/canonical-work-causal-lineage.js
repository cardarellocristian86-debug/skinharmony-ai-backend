import crypto from "node:crypto";

function payload(value) {
  const structured = value?.structuredContent && typeof value.structuredContent === "object"
    ? value.structuredContent : value;
  return structured?.ok === true && structured.result && typeof structured.result === "object"
    ? structured.result : structured;
}
function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function fail(code) { const error = new Error(code); error.code = code; error.status = 409; throw error; }

export async function ensureCanonicalWorkCausalLineage({ handlers, identity, work } = {}) {
  if (!handlers || !identity || !work) fail("canonical_work_causal_lineage_dependencies_invalid");
  const projectAlias = String(work.project_id || "").trim();
  const workId = String(work.work_id || "").trim();
  if (!projectAlias || !workId) fail("canonical_work_causal_lineage_source_invalid");
  let project;
  try { project = payload(await handlers.project_identity_resolve({ alias: projectAlias }, identity)); }
  catch { fail("canonical_work_causal_project_missing"); }
  const projectId = String(project?.project_id || "").trim();
  if (!projectId) fail("canonical_work_causal_project_missing");
  let decisionPath;
  try { decisionPath = payload(await handlers.project_decision_path_read({ project_id: projectId }, identity)); }
  catch { fail("canonical_work_causal_intent_missing"); }
  if (!decisionPath?.genesis_intent) fail("canonical_work_causal_genesis_missing");
  const activeIntentRevisionId = String(project.active_intent_revision_id
    || decisionPath?.project?.active_intent_revision_id || "").trim();
  const revision = (decisionPath.intent_revisions || []).find((item) =>
    item?.state === "APPROVED" && item.intent_revision_id === activeIntentRevisionId);
  if (!revision?.intent_revision_id) fail("canonical_work_causal_active_intent_missing");
  const workIntentDigest = String(work.intent_digest || "").trim().toLowerCase();
  const activeIntentDigest = String(revision.canonical_digest || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(workIntentDigest)
    || activeIntentDigest !== workIntentDigest) fail("canonical_work_causal_intent_binding_mismatch");
  const key = `canonical-work-lineage:${digest({ tenant_id: identity.tenantId,
    project_id: projectId, work_id: workId, intent_revision_id: revision.intent_revision_id }).slice(0, 48)}`;
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
    intent_revision_id: revision.intent_revision_id, state_digest: state.state_digest });
}
