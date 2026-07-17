import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

test("health exposes a non-secret build identity and commit-verification state", async () => {
  const { app } = createUniversalCoreService({ storageRoot: path.join(os.tmpdir(), `health-build-${Date.now()}-${Math.random()}`) });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    const health = await response.json();
    assert.equal(response.status, 200);
    assert.equal(health.ok, true);
    assert.equal(typeof health.build.build_id, "string");
    assert.equal(typeof health.build.commit_verifiable, "boolean");
    assert.ok(health.build.commit_sha === null || /^[a-f0-9]{7,}$/i.test(health.build.commit_sha));
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
