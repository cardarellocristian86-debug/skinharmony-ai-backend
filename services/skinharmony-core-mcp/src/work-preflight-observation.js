export function attachObservedContinuity(preflightResult, args = {}, projectId = null) {
  const structured = preflightResult?.structuredContent;
  const preflight = structured?.work_preflight;
  if (!preflight || typeof preflight !== "object") return preflightResult;
  const gallery = structured.tenant_work_gallery || preflight.tenant_work_gallery || {};
  const works = Array.isArray(gallery.works) ? gallery.works : [];
  const coreWorkId = String(
    preflight.continuity?.work_id || preflight.canonical_intent_binding?.work_id || "",
  ).trim();
  const requestedWorkId = String(args.work_id || "").trim();
  const observedWorkId = coreWorkId || requestedWorkId || (works.length === 1
    ? String(works[0]?.work_id || "").trim()
    : "");
  if (!observedWorkId) return preflightResult;
  const work = works.find((candidate) => String(candidate?.work_id || "") === observedWorkId) || {};
  preflightResult.structuredContent = {
    ...structured,
    work_preflight: {
      ...preflight,
      continuity: {
        ...(preflight.continuity && typeof preflight.continuity === "object"
          ? preflight.continuity
          : {}),
        tenant_id: structured.tenant_id,
        work_id: observedWorkId,
        project_id: String(work.project_id || projectId || "") || null,
        state: work.status || preflight.continuity?.state || "observed",
        current_version: Number(work.current_version || preflight.continuity?.current_version || 0),
        next_action: work.next_action || preflight.continuity?.next_action || null,
        observation_only: true,
        materialized: false,
        read_binding: {
          state: "observed_only",
          session_bound: false,
          participant_joined: false,
          lease_acquired: false,
          heartbeat_recorded: false,
          control_context_persisted: false,
        },
      },
    },
  };
  return preflightResult;
}
