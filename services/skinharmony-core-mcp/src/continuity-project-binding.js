import { continuityProjectId } from "./continuity-project-id.js";

export async function resolveContinuityProjectBinding(identity, args = {}, workContinuityRuntime = null) {
  const fallbackProjectId = continuityProjectId(args);
  if (args.project_id || !args.work_id || typeof workContinuityRuntime?.readIntent !== "function") {
    return {
      projectId: fallbackProjectId,
      continuityArgs: args,
    };
  }

  // A repository is a release target, not the authoritative Work project.
  // Resolve the tenant-scoped immutable Work binding before preflight without
  // adding derived metadata to the dynamic capability argument digest.
  const intent = await workContinuityRuntime.readIntent(identity, { work_id: args.work_id });
  const persistedProjectId = String(intent?.project_id || "").trim();
  const projectId = continuityProjectId({ project_id: persistedProjectId });
  if (!persistedProjectId || projectId !== persistedProjectId) {
    const error = new Error("continuity_project_binding_invalid");
    error.code = "continuity_project_binding_invalid";
    throw error;
  }

  return {
    projectId,
    continuityArgs: { ...args, project_id: projectId },
  };
}
