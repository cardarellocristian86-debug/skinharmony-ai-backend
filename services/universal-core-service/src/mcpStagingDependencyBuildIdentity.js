const RENDER_COMMIT_ENV_KEY = "RENDER_GIT_COMMIT";
const APPROVED_COMMIT_ENV_KEY = "MCP_STAGING_DEPENDENCY_BUILD_COMMIT";
const EXACT_COMMIT = /^[a-f0-9]{40}$/;

export class McpStagingDependencyBuildIdentityError extends Error {
  constructor(code) {
    super(code);
    this.name = "McpStagingDependencyBuildIdentityError";
    this.code = code;
  }
}

function fail(code) {
  throw new McpStagingDependencyBuildIdentityError(code);
}

function readCommit(env, key) {
  let value;
  try {
    value = env[key];
  } catch {
    fail("dependency_build_identity_unavailable");
  }
  if (typeof value !== "string" || !EXACT_COMMIT.test(value)) {
    fail("dependency_build_identity_invalid");
  }
  return value;
}

function redactCommit(commit) {
  return `${commit.slice(0, 8)}...${commit.slice(-8)}`;
}

export function loadMcpStagingDependencyBuildIdentity(env = process.env) {
  if (!env || (typeof env !== "object" && typeof env !== "function")) {
    fail("dependency_build_identity_unavailable");
  }
  const renderCommit = readCommit(env, RENDER_COMMIT_ENV_KEY);
  const approvedCommit = readCommit(env, APPROVED_COMMIT_ENV_KEY);
  if (renderCommit !== approvedCommit) {
    fail("dependency_build_identity_mismatch");
  }
  return Object.freeze({
    schema_version: "mcp_staging_dependency_build_identity_v1",
    verified: true,
    provider: "render",
    commit: renderCommit,
    commit_redacted: redactCommit(renderCommit),
    secrets_exposed: false,
  });
}

export function loadMcpStagingProviderBuildIdentity(env = process.env) {
  if (!env || (typeof env !== "object" && typeof env !== "function")) {
    fail("dependency_build_identity_unavailable");
  }
  const renderCommit = readCommit(env, RENDER_COMMIT_ENV_KEY);
  return Object.freeze({
    schema_version: "mcp_staging_provider_build_identity_v1",
    verified: true,
    provider: "render",
    commit: renderCommit,
    commit_redacted: redactCommit(renderCommit),
    secrets_exposed: false,
  });
}

export const mcpStagingDependencyBuildIdentityContract = Object.freeze({
  render_commit_env_key: RENDER_COMMIT_ENV_KEY,
  approved_commit_env_key: APPROVED_COMMIT_ENV_KEY,
});
