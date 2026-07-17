import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test("generic agent run restores from durable checkpoint after service restart", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "generic-recovery-admin";
  const storageRoot = path.join(os.tmpdir(), `core-generic-recovery-${Date.now()}-${Math.random()}`);
  let first;
  let second;
  try {
    first = await listen(createUniversalCoreService({ storageRoot }).app);
    const request = async (base, method, pathname, body, key = "generic-recovery-admin") => {
      const response = await fetch(`${base}${pathname}`, {
        method,
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, json: await response.json() };
    };
    const generated = await request(first.base, "POST", "/v1/keys/generate", { tenant_id: "tenant-recovery", preset: "codex_automation" });
    const key = generated.json.key;
    const started = await request(first.base, "POST", "/v1/generic-agents/runs", { agent_id: "planner", task: "Persist this run" }, key);
    const runId = started.json.run.run_id;
    const checkpointed = await request(first.base, "POST", `/v1/generic-agents/runs/${runId}/checkpoint`, {
      checkpoint: { state: { stage: "checkpointed" }, cursor: "resume-here" },
      expected_revision: 0,
    }, key);
    assert.equal(checkpointed.status, 200);
    await new Promise((resolve) => first.server.close(resolve));
    first = null;

    second = await listen(createUniversalCoreService({ storageRoot }).app);
    const recovered = await request(second.base, "GET", `/v1/generic-agents/runs/${runId}`, undefined, key);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.json.restored_from_checkpoint, true);
    assert.equal(recovered.json.run.run_id, runId);
    assert.equal(recovered.json.durable_checkpoint.revision, 1);
  } finally {
    if (first) await new Promise((resolve) => first.server.close(resolve));
    if (second) await new Promise((resolve) => second.server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});
