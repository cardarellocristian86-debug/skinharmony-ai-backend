const DEFAULT_PROJECT_ID = "skinharmony-ai-backend";
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,63}$/;
const REPOSITORY_SEGMENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

function normalizedProjectId(value) {
  const raw = String(value || DEFAULT_PROJECT_ID)
    .trim()
    .replace(/[^a-zA-Z0-9_.:/-]+/g, "-")
    .slice(0, 64);
  return PROJECT_ID_PATTERN.test(raw) ? raw : DEFAULT_PROJECT_ID;
}

function repositoryProjectId(value) {
  const repository = String(value || "").trim();
  const segments = repository.split("/");
  if (segments.length < 1 || segments.length > 2) return DEFAULT_PROJECT_ID;
  if (segments.some((segment) => !REPOSITORY_SEGMENT_PATTERN.test(segment))) {
    return DEFAULT_PROJECT_ID;
  }

  const basename = segments.at(-1);
  return PROJECT_ID_PATTERN.test(basename) ? basename : DEFAULT_PROJECT_ID;
}

export function continuityProjectId(args = {}) {
  if (args.project_id) return normalizedProjectId(args.project_id);
  if (args.repository) return repositoryProjectId(args.repository);
  return normalizedProjectId(args.target_system || DEFAULT_PROJECT_ID);
}
