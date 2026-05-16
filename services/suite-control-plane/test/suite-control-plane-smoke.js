import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSuiteControlPlane } from "../src/app.js";

const mockCoreClient = {
  status: () => ({ configured: true, provider_url: "mock://universal-core", tenant_id: "tenant_demo" }),
  async customerIntelligenceContract(tenantId) {
    return {
      success: true,
      contract: {
        schema_version: "customer_intelligence_contract_v1",
        tenant_id: tenantId,
        automation_limits: { automatic_send_allowed: false },
        data_contract: {
          event_taxonomy: [{ id: "appointment.completed" }],
          consent_registry: { valid_statuses: ["unknown", "granted", "revoked", "expired"] },
        },
      },
    };
  },
  async customerIntelligenceReadiness(payload) {
    return {
      success: true,
      readiness: {
        schema_version: "customer_intelligence_readiness_v1",
        event_count: Array.isArray(payload.events) ? payload.events.length : 0,
        granted_consent_count: 1,
        can_send_automatically: false,
        next_step: "prepare_draft_for_operator_confirmation",
      },
      rule: "Readiness e solo valutazione: nessun invio automatico e nessuna modifica dati cliente.",
    };
  },
};

const { app } = createSuiteControlPlane({ coreClient: mockCoreClient });
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

  const runbooks = await request("/api/suite/runbooks", { headers });
  assert.equal(runbooks.response.status, 200);
  assert.ok(runbooks.body.runbooks.length >= 11);
  assert.ok(runbooks.body.runbooks.some((runbook) => runbook.id === "customer_report"));
  assert.ok(runbooks.body.runbooks.some((runbook) => runbook.id === "setup_site_suite"));
  assert.ok(runbooks.body.runbooks.some((runbook) => runbook.id === "clone_waas_site"));
  assert.ok(runbooks.body.runbooks.some((runbook) => runbook.id === "claim_price_audit"));
  assert.ok(runbooks.body.runbooks.some((runbook) => runbook.id === "smartdesk_gold_customer_intelligence_sync"));
  assert.ok(runbooks.body.runbooks.some((runbook) => runbook.id === "customer_360_profile_review"));
  assert.ok(runbooks.body.runbooks.some((runbook) => runbook.id === "journey_builder_guarded_draft"));

  const tracks = await request("/api/suite/ecosystem/tracks", { headers });
  assert.equal(tracks.response.status, 200);
  assert.equal(tracks.body.tracks.schema_version, "suite_ecosystem_tracks_v1");
  assert.equal(tracks.body.tracks.core.configured, true);
  assert.ok(tracks.body.tracks.suite_provider_track.runbooks.some((runbook) => runbook.id === "setup_site_suite"));
  assert.ok(tracks.body.tracks.smartdesk_gold_track.runbooks.some((runbook) => runbook.id === "smartdesk_gold_customer_intelligence_sync"));
  assert.ok(tracks.body.tracks.smartdesk_gold_track.guardrails.includes("nessun invio automatico"));

  const customerContract = await request("/api/suite/customer-intelligence/contract?tenant_id=tenant_demo", { headers });
  assert.equal(customerContract.response.status, 200);
  assert.equal(customerContract.body.source, "universal_core");
  assert.equal(customerContract.body.contract.schema_version, "customer_intelligence_contract_v1");
  assert.equal(customerContract.body.contract.automation_limits.automatic_send_allowed, false);

  const customerReadiness = await request("/api/suite/customer-intelligence/readiness", {
    method: "POST",
    headers,
    body: JSON.stringify({
      tenant_id: "tenant_demo",
      events: [{ type: "appointment.completed" }],
      consents: [{ status: "granted", channel: "email", purpose: "recall" }],
      customer_profile: { customer_id: "client_demo" },
    }),
  });
  assert.equal(customerReadiness.response.status, 200);
  assert.equal(customerReadiness.body.readiness.can_send_automatically, false);
  assert.equal(customerReadiness.body.readiness.next_step, "prepare_draft_for_operator_confirmation");

  const preview = await request("/api/suite/runbooks/preview", {
    method: "POST",
    headers,
    body: JSON.stringify({
      runbook_id: "plugin_update_preflight",
      node_id: "wp_test_node",
    }),
  });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.preview.state, "ready_for_owner_confirmation");
  assert.equal(preview.body.preview.owner_confirmation_required, true);

  const rejectedDispatch = await request("/api/suite/runbooks/dispatch", {
    method: "POST",
    headers,
    body: JSON.stringify({
      runbook_id: "plugin_update_preflight",
      node_id: "wp_test_node",
    }),
  });
  assert.equal(rejectedDispatch.response.status, 409);
  assert.equal(rejectedDispatch.body.accepted, false);

  const dispatch = await request("/api/suite/runbooks/dispatch", {
    method: "POST",
    headers,
    body: JSON.stringify({
      runbook_id: "plugin_update_preflight",
      node_id: "wp_test_node",
      owner_confirmed: true,
      payload: { release: "5.1.14" },
    }),
  });
  assert.equal(dispatch.response.status, 202);
  assert.equal(dispatch.body.accepted, true);
  assert.equal(dispatch.body.dispatch.state, "queued_for_node_pull");

  const customerReportDispatch = await request("/api/suite/runbooks/dispatch", {
    method: "POST",
    headers,
    body: JSON.stringify({
      runbook_id: "customer_report",
      node_id: "wp_test_node",
      payload: { source: "suite_local_catalog_alignment" },
    }),
  });
  assert.equal(customerReportDispatch.response.status, 202);
  assert.equal(customerReportDispatch.body.accepted, true);
  assert.equal(customerReportDispatch.body.dispatch.state, "queued_for_node_pull");

  const artifact = await request("/api/suite/runbooks/artifacts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      node_id: "wp_test_node",
      tenant_id: "tenant_demo",
      runbook_id: "plugin_update_preflight",
      artifact_type: "preflight_report",
      signature: "sig_test",
      payload: { ok: true, release: "5.1.14" },
    }),
  });
  assert.equal(artifact.response.status, 201);
  assert.equal(artifact.body.accepted, true);
  assert.match(artifact.body.artifact_id, /^artifact_/);

  const artifactList = await request("/api/suite/nodes/wp_test_node/runbook-artifacts", { headers });
  assert.equal(artifactList.response.status, 200);
  assert.equal(artifactList.body.artifacts.length, 1);
  assert.equal(artifactList.body.artifacts[0].runbook_id, "plugin_update_preflight");

  const dashboard = await request("/api/suite/nodes/wp_test_node/dashboard", { headers });
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.dashboard.node.node_id, "wp_test_node");
  assert.equal(dashboard.body.dashboard.node.evidence_count, 1);
  assert.equal(dashboard.body.dashboard.dispatches.length, 3);
  assert.equal(dashboard.body.dashboard.runbook_artifacts.length, 1);

  const overview = await request("/api/suite/overview", { headers });
  assert.equal(overview.response.status, 200);
  assert.equal(overview.body.overview.nodes_total, 1);
  assert.equal(overview.body.overview.runbooks_total, runbooks.body.runbooks.length);
  assert.equal(overview.body.overview.dispatches_total, 3);
  assert.equal(overview.body.overview.runbook_artifacts_total, 1);

  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sh-suite-control-"));
  process.env.SUITE_CONTROL_STORAGE_ROOT = storageRoot;
  const persistedOne = createSuiteControlPlane();
  persistedOne.storage.heartbeat({
    node_id: "wp_persisted_node",
    tenant_id: "tenant_demo",
    plugin_version: "5.1.13",
  });
  persistedOne.storage.snapshot({
    node_id: "wp_persisted_node",
    tenant_id: "tenant_demo",
    summary: { runtime_mode: "shared_render" },
  });
  persistedOne.storage.runbookDispatch({
    runbook_id: "smartdesk_bridge_check",
    node_id: "wp_persisted_node",
  });
  persistedOne.storage.runbookArtifact({
    node_id: "wp_persisted_node",
    tenant_id: "tenant_demo",
    runbook_id: "smartdesk_bridge_check",
    artifact_type: "bridge_report",
    signature: "persisted_sig",
    payload: { ok: true },
  });
  const persistedTwo = createSuiteControlPlane();
  const persistedOverview = persistedTwo.storage.overview();
  assert.equal(persistedTwo.storage.mode, "file");
  assert.equal(persistedOverview.nodes_total, 1);
  assert.equal(persistedOverview.nodes[0].node_id, "wp_persisted_node");
  assert.equal(persistedOverview.dispatches_total, 1);
  assert.equal(persistedOverview.runbook_artifacts_total, 1);
  delete process.env.SUITE_CONTROL_STORAGE_ROOT;

  console.log("Suite Control Plane smoke OK");
} finally {
  server.close();
}
