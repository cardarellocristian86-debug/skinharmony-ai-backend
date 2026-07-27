const EXACT_COMMIT = /^[a-f0-9]{40}$/;

export class McpStagingTargetCommitError extends Error {
  constructor(code = "mcp_staging_target_commit_invalid") {
    super(code);
    this.name = "McpStagingTargetCommitError";
    this.code = code;
  }
}

export function requireMcpStagingTargetCommit(value) {
  if (typeof value !== "string" || !EXACT_COMMIT.test(value)) {
    throw new McpStagingTargetCommitError();
  }
  return value;
}
