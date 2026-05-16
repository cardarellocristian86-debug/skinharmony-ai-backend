import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSuiteControlPlane } from "../src/app.js";

const { app } = createSuiteControlPlane();
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;
const headers = {
  "content-type": "application/json",
  "x-sh-suite-key": "dev-suite-control-plane-key",
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

try {
  const health = await request("/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.service, "skinharmony-suite-control-plane");

  const unauthorized = await request("/api/suite/overview");
  assert.equal(unauthorized.response.status, 401);

  const heartbeat = await request("/api/suite/nodes/heartbeat", {
    method: "POST",
    headers,
    body: JSON.stringify({
      node_id: "wp_test_node",
      tenant_id: "tenant_demo",
      plugin_version: "5.1.12",
      status: "online",
      capabilities: ["control_plane", "runbook_receiver", "evidence"],
    }),
  });
  assert.equal(heartbeat.response.status, 200);
  assert.equal(heartbeat.body.accepted, true);
  assert.equal(heartbeat.body.node_id, "wp_test_node");

  const snapshot = await request("/api/suite/nodes/snapshot", {
    method: "POST",
    headers,
    body: JSON.stringify({
      node_id: "wp_test_node",
      tenant_id: "tenant_demo",
      summary: { plugin_version: "5.1.12", runtime_mode: "shared_render" },
      validation: { manifest_integrity_ready: true },
    }),
  });
  assert.equal(snapshot.response.status, 200);
  assert.equal(snapshot.body.snapshot_count, 1);

  const evidence = await request("/api/suite/evidence", {
    method: "POST",
    headers,
    body: JSON.stringify({
      node_id: "wp_test_node",
      tenant_id: "tenant_demo",
      evidence_type: "core_gate",
      decision: "confirm",
      risk: "medium",
      audit_id: "audit_test",
    }),
  });
  assert.equal(evidence.response.status, 200);
  assert.match(evidence.body.evidence_id, /^evidence_/);

  const dashboard = await request("/api/suite/nodes/wp_test_node/dashboard", { headers });
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.dashboard.node.node_id, "wp_test_node");
  assert.equal(dashboard.body.dashboard.node.evidence_count, 1);

  const overview = await request("/api/suite/overview", { headers });
  assert.equal(overview.response.status, 200);
  assert.equal(overview.body.overview.nodes_total, 1);

  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sh-suite-control-"));
  process.env.SUITE_CONTROL_STORAGE_ROOT = storageRoot;
  const persistedOne = createSuiteControlPlane();
  persistedOne.storage.heartbeat({
    node_id: "wp_persisted_node",
    tenant_id: "tenant_demo",
    plugin_version: "5.1.13",
  });
  const persistedTwo = createSuiteControlPlane();
  const persistedOverview = persistedTwo.storage.overview();
  assert.equal(persistedTwo.storage.mode, "file");
  assert.equal(persistedOverview.nodes_total, 1);
  assert.equal(persistedOverview.nodes[0].node_id, "wp_persisted_node");
  delete process.env.SUITE_CONTROL_STORAGE_ROOT;

  console.log("Suite Control Plane smoke OK");
} finally {
  server.close();
}
