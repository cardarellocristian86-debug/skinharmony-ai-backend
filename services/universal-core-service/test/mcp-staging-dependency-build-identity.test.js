import assert from "node:assert/strict";
import test from "node:test";
import {
  loadMcpStagingDependencyBuildIdentity,
  loadMcpStagingProviderBuildIdentity,
  McpStagingDependencyBuildIdentityError,
  mcpStagingDependencyBuildIdentityContract,
} from "../src/mcpStagingDependencyBuildIdentity.js";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

function matchingEnv(overrides = {}) {
  return {
    RENDER_GIT_COMMIT: COMMIT,
    MCP_STAGING_DEPENDENCY_BUILD_COMMIT: COMMIT,
    ...overrides,
  };
}

test("accepts only identical canonical Render and approved dependency commits", () => {
  const env = matchingEnv();
  const identity = loadMcpStagingDependencyBuildIdentity(env);

  assert.deepEqual(identity, {
    schema_version: "mcp_staging_dependency_build_identity_v1",
    verified: true,
    provider: "render",
    commit: COMMIT,
    commit_redacted: "01234567...01234567",
    secrets_exposed: false,
  });
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(env.RENDER_GIT_COMMIT, COMMIT);
  assert.equal(env.MCP_STAGING_DEPENDENCY_BUILD_COMMIT, COMMIT);
  assert.deepEqual(mcpStagingDependencyBuildIdentityContract, {
    render_commit_env_key: "RENDER_GIT_COMMIT",
    approved_commit_env_key: "MCP_STAGING_DEPENDENCY_BUILD_COMMIT",
  });
});

test("initial provider hold identity needs only Render's immutable runtime commit", () => {
  let approvedCommitReads = 0;
  const env = { RENDER_GIT_COMMIT: COMMIT };
  Object.defineProperty(env, "MCP_STAGING_DEPENDENCY_BUILD_COMMIT", {
    enumerable: true,
    get() {
      approvedCommitReads += 1;
      throw new Error("approved-commit-must-not-be-read");
    },
  });
  const identity = loadMcpStagingProviderBuildIdentity(env);
  assert.deepEqual(identity, {
    schema_version: "mcp_staging_provider_build_identity_v1",
    verified: true,
    provider: "render",
    commit: COMMIT,
    commit_redacted: "01234567...01234567",
    secrets_exposed: false,
  });
  assert.equal(approvedCommitReads, 0);
  assert.equal(Object.isFrozen(identity), true);
});

test("fails closed when either required commit is absent or non-canonical", () => {
  const cases = [
    {},
    { RENDER_GIT_COMMIT: COMMIT },
    { MCP_STAGING_DEPENDENCY_BUILD_COMMIT: COMMIT },
    matchingEnv({ RENDER_GIT_COMMIT: COMMIT.toUpperCase() }),
    matchingEnv({ MCP_STAGING_DEPENDENCY_BUILD_COMMIT: ` ${COMMIT}` }),
    matchingEnv({ RENDER_GIT_COMMIT: COMMIT.slice(0, 39) }),
  ];

  for (const env of cases) {
    assert.throws(
      () => loadMcpStagingDependencyBuildIdentity(env),
      (error) => error instanceof McpStagingDependencyBuildIdentityError &&
        error.code === "dependency_build_identity_invalid" &&
        error.message === "dependency_build_identity_invalid",
    );
  }
});

test("rejects a build mismatch without reflecting either commit", () => {
  const otherCommit = "abcdef0123456789abcdef0123456789abcdef01";
  assert.throws(
    () => loadMcpStagingDependencyBuildIdentity(matchingEnv({
      MCP_STAGING_DEPENDENCY_BUILD_COMMIT: otherCommit,
    })),
    (error) => error instanceof McpStagingDependencyBuildIdentityError &&
      error.code === "dependency_build_identity_mismatch" &&
      !error.message.includes(COMMIT) && !error.message.includes(otherCommit),
  );
});

test("has no fallback to unrelated commit variables and returns no unrelated environment data", () => {
  const secretMarker = "secret-marker-must-not-escape";
  assert.throws(
    () => loadMcpStagingDependencyBuildIdentity({
      GIT_COMMIT: COMMIT,
      COMMIT_SHA: COMMIT,
      SECRET_VALUE: secretMarker,
    }),
    /dependency_build_identity_invalid/,
  );

  const identity = loadMcpStagingDependencyBuildIdentity({
    ...matchingEnv(),
    SECRET_VALUE: secretMarker,
  });
  assert.equal(JSON.stringify(identity).includes(secretMarker), false);
});

test("redacts hostile environment access failures with a constant error", () => {
  const env = Object.create(null, {
    RENDER_GIT_COMMIT: {
      enumerable: true,
      get() { throw new Error("sensitive-provider-detail"); },
    },
  });
  assert.throws(
    () => loadMcpStagingDependencyBuildIdentity(env),
    (error) => error instanceof McpStagingDependencyBuildIdentityError &&
      error.code === "dependency_build_identity_unavailable" &&
      error.message === "dependency_build_identity_unavailable",
  );
  assert.throws(
    () => loadMcpStagingDependencyBuildIdentity(null),
    /dependency_build_identity_unavailable/,
  );
});
