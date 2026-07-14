import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

async function fixture(run) {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "intel-test-admin";
  const { app } = createUniversalCoreService({ storageRoot: path.join(os.tmpdir(), `core-intel-${Date.now()}-${Math.random()}`) });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, pathname, body, key = "intel-test-admin") => {
    const response = await fetch(`${base}${pathname}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  };
  try { await run(request); } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY; else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
}

test("intelligence API is tenant scoped and records idempotent outcomes", async () => fixture(async (request) => {
  const generated = await request("POST", "/v1/keys/generate", { tenant_id: "tenant-intel", preset: "nyra_core_360_connector" });
  const key = generated.json.key;
  const workflow = await request("POST", "/v1/intelligence/workflow", { request: "Evaluate", generate_scenarios: true }, key);
  assert.equal(workflow.status, 200);
  assert.equal(workflow.json.tenant_id, "tenant-intel");
  assert.equal(workflow.json.execution_allowed, false);

  const payload = { outcome_id: "stable-outcome", prediction_id: "p1", predicted_probability: 0.8, actual_outcome: true };
  const first = await request("POST", "/v1/intelligence/outcomes/record", payload, key);
  const second = await request("POST", "/v1/intelligence/outcomes/record", payload, key);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.json.duplicate, true);
  const conflict = await request("POST", "/v1/intelligence/outcomes/record", { ...payload, actual_outcome: false }, key);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error, "outcome_id_conflict");
  const missingId = await request("POST", "/v1/intelligence/outcomes/record", { predicted_probability: 0.8, actual_outcome: true }, key);
  assert.equal(missingId.status, 400);
  assert.equal(missingId.json.error, "outcome_id_required");
  const calibration = await request("GET", "/v1/intelligence/calibration", undefined, key);
  assert.equal(calibration.json.calibration.sample_size, 1);
  assert.equal(calibration.json.tenant_id, "tenant-intel");
}));

test("intelligence API validates required collections", async () => fixture(async (request) => {
  const generated = await request("POST", "/v1/keys/generate", { tenant_id: "tenant-invalid", preset: "nyra_core_360_connector" });
  const response = await request("POST", "/v1/intelligence/decisions/select", { options: [{ id: "only" }] }, generated.json.key);
  assert.equal(response.status, 400);
  assert.equal(response.json.error, "at_least_two_options_required");
}));
