import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

async function fixture(run) {
  const { app } = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `core-system-endpoints-${Date.now()}-${Math.random()}`),
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (pathname) => {
    const response = await fetch(`${base}${pathname}`);
    return { status: response.status, json: await response.json() };
  };
  try {
    await run(request);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health, readiness and capabilities are exposed", async () => {
  await fixture(async (request) => {
    const health = await request("/healthz");
    assert.equal(health.status, 200);
    assert.equal(health.json.ok, true);
    const readiness = await request("/readiness");
    assert.equal(readiness.status, 200);
    assert.equal(readiness.json.ok, true);
    assert.equal(readiness.json.ready, true);
    const capabilities = await request("/capabilities");
    assert.equal(capabilities.status, 200);
    assert.equal(capabilities.json.ok, true);
    assert(Array.isArray(capabilities.json.capabilities));
    assert(capabilities.json.capabilities.some((entry) => entry.id === "healthz"));
    assert(capabilities.json.capabilities.some((entry) => entry.id === "runtime_status"));
  });
});

