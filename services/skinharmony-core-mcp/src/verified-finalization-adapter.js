function nonEmpty(value) {
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

function hasRepositoryBinding(value) {
  if (Array.isArray(value)) return value.some(hasRepositoryBinding);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    const normalized = String(key).toLowerCase();
    if (["repository", "repository_url", "repository_hash", "repo"].includes(normalized)) {
      return nonEmpty(child);
    }
    return hasRepositoryBinding(child);
  });
}

/**
 * A typed bootstrap may conservatively label an operational proof Work as
 * software_git before any repository/effect contract exists. Native closure
 * must remain mandatory as soon as any server-persisted software binding is
 * present; otherwise the Work has no software effect to attest and closes
 * through the generic evidence-only adapter.
 */
export function verifiedFinalizationAdapter(state = {}) {
  const declared = String(state?.work?.work_type || "generic");
  if (declared !== "software_git") return declared;
  const architecture = state?.work?.architecture || {};
  const softwareBound = hasRepositoryBinding(architecture) ||
    (state.task_contracts || []).length > 0 ||
    (state.committed_task_states || []).length > 0 ||
    (state.dependency_manifests || []).length > 0 ||
    (state.work_state_projection?.unresolved_effects || []).length > 0;
  return softwareBound ? declared : "generic";
}
