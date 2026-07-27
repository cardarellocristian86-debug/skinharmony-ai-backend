import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../server.js", import.meta.url));
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const OTHER_COMMIT = "abcdef0123456789abcdef0123456789abcdef01";

function run(env) {
  return spawnSync(process.execPath, [SERVER], {
    encoding: "utf8",
    env,
    timeout: 5_000,
  });
}

test("issuer entrypoint rejects missing or mismatched dependency build identity before startup", () => {
  for (const env of [
    {},
    { RENDER_GIT_COMMIT: COMMIT, MCP_STAGING_DEPENDENCY_BUILD_COMMIT: OTHER_COMMIT },
  ]) {
    const result = run(env);
    assert.equal(result.status, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "mcp_staging_issuer_startup_failed\n");
    assert.equal(result.stderr.includes(COMMIT), false);
    assert.equal(result.stderr.includes(OTHER_COMMIT), false);
  }
});
