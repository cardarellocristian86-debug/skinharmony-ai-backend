import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { softwareAuthoritySnapshotDigest } from "../src/softwareCognition.js";
import { hostNativeDigest } from "../src/hostNativeGovernance.js";

const H = (value) => String(value).repeat(64);

test("ENFORCED consumers reject persisted pre-enforcement v1 Core Join and action tickets", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "software-rollout-consumer-admin";
  const { createUniversalCoreService } = await import(`../src/app.js?rollout-consumer=${Date.now()}`);
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "software-rollout-consumer-"));
  const graph = { revision: 4, source_digest: H("a"), nodes: [], edges: [] };
  const snapshot = {
    project: { digest: "project" }, work: { digest: "work" }, change: { digest: "change" },
    obligations: [], evidence: [], icf: { digest: "icf" }, graph,
    native_plan: { digest: "plan" }, latest_native_plan_id: "plan-current",
    native_closure: { digest: "native" }, challenges: [], artifacts: {},
    db_now: new Date().toISOString(),
  };
  const closure = {
    project_id: "project-a",
    payload: {
      verdict: "RELEASE_READY", authoritative_transition_performed: false,
      graph_revision: graph.revision, graph_digest: graph.source_digest,
      change_id: "change-a", plan_id: "plan-current",
      authority_snapshot_digest: softwareAuthoritySnapshotDigest(snapshot),
      evidence_fresh_until: new Date(Date.now() + 60_000).toISOString(),
      closure_digest: H("c"),
    },
  };
  let actionIssueCalls = 0;
  let reserveCalls = 0;
  let coreJoinReadCalls = 0;
  let manualMergeTicket = false;
  let manualMergeReadbackId = `hnmmr_${"a".repeat(40)}`;
  let currentRecord = {
    tenant_id: "tenant-a", verdict_id: "join-v1", state: "active",
    claim: { schema_version: "host_native_core_join_claim_v1", work_id: "work-a" },
    verdict: { schema_version: "host_native_core_join_v1", issued_at: new Date().toISOString() },
  };
  let coreJoinSignatureValid = true;
  const governance = {
    required_checks_policy_resolver_configured: true,
    closure_attestation_verifier_configured: true,
    readCoreJoinVerdict: async () => {
      coreJoinReadCalls += 1;
      return currentRecord;
    },
    verifyCoreJoinVerdict: () => coreJoinSignatureValid,
    verifyActionTicket: () => true,
    issueActionTicket: async () => {
      actionIssueCalls += 1;
      return { ticket: {
        ticket_id: "issued-manual-observation",
        delegation_id: "manual-observation-delegation",
        action: { kind: "render.observe" },
        issued_at: new Date().toISOString(),
      } };
    },
    readActionTicket: async () => ({ ticket: {
      ticket_id: "ticket-v1", tenant_id: "tenant-a", work_id: "work-a",
      core_join_verdict_id: "join-v1", issued_at: new Date().toISOString(),
      ...(manualMergeTicket ? {
        action: { kind: "render.observe" },
        predecessor: {
          predecessor_type: "owner_manual_github_merge_readback",
          manual_merge_readback_id: manualMergeReadbackId,
        },
      } : {}),
    } }),
    reserveActionTicket: async () => { reserveCalls += 1; return {}; },
  };
  const softwareStore = {
    async withClosureAuthorityLock(_scope, operation) {
      return operation({
        readReleaseReadyClosure: async () => closure,
        readGraph: async () => graph,
        readClosureSnapshot: async () => snapshot,
        assertClosureFresh: async () => true,
      });
    },
  };
  const softwareRuntime = { initialize: async () => ({ ready: true }), invoke: async () => ({}) };
  const { app } = createUniversalCoreService({
    storageRoot, hostNativeGovernance: governance, softwareCognitionMode: "ENFORCED",
    softwareCognitionStore: softwareStore, softwareCognitionRuntime: softwareRuntime,
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = async (pathname, payload, key = "software-rollout-consumer-admin") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${pathname}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: response.status, json: await response.json() };
  };
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const health = await (await fetch(`http://127.0.0.1:${server.address().port}/healthz`)).json();
      if (health.software_cognition.state === "ready") break;
      await new Promise((resolve) => setImmediate(resolve));
    }
    const automationKey = await request("/v1/keys/generate", {
      tenant_id: "tenant-a", key_type: "automation",
      allowed_scopes: ["read:decision", "automation:codex"],
    });
    assert.equal(automationKey.status, 201, JSON.stringify(automationKey.json));
    const issue = await request("/v1/host-native/actions/authorize", {
      tenant_id: "tenant-a", work_id: "work-a",
      release_manifest: { verification: { core_join_verdict_id: "join-v1" } },
    }, automationKey.json.key);
    assert.equal(issue.status, 400, JSON.stringify(issue.json));
    assert.equal(issue.json.error, "software_cognition_core_join_binding_mismatch");
    assert.equal(actionIssueCalls, 0);

    const reserve = await request("/v1/host-native/actions/ticket-v1/reserve", {}, automationKey.json.key);
    assert.equal(reserve.status, 400, JSON.stringify(reserve.json));
    assert.equal(reserve.json.error, "software_cognition_core_join_binding_mismatch");
    assert.equal(reserveCalls, 0);

    currentRecord = {
      tenant_id: "tenant-a", verdict_id: "join-v1", state: "active",
      claim_digest: H("d"),
      claim: {
        schema_version: "host_native_core_join_claim_v2", tenant_id: "tenant-a",
        work_id: "work-a", verdict_id: "join-v1",
        software_closure_digest: closure.payload.closure_digest,
        software_closure_fresh_until: closure.payload.evidence_fresh_until,
      },
      verdict: {
        schema_version: "host_native_core_join_v2", tenant_id: "tenant-a",
        work_id: "work-a", verdict_id: "join-v1", claim_digest: H("d"),
        software_closure_digest: closure.payload.closure_digest,
        software_closure_fresh_until: closure.payload.evidence_fresh_until,
        issued_at: new Date().toISOString(),
      },
    };
    coreJoinSignatureValid = false;
    const tampered = await request("/v1/host-native/actions/authorize", {
      tenant_id: "tenant-a", work_id: "work-a",
      release_manifest: { verification: { core_join_verdict_id: "join-v1" } },
    }, automationKey.json.key);
    assert.equal(tampered.status, 400, JSON.stringify(tampered.json));
    assert.equal(tampered.json.error, "software_cognition_core_join_binding_mismatch");
    assert.equal(actionIssueCalls, 0);

    coreJoinSignatureValid = true;
    const manualMergeIssue = (manual_merge_readback_id) => request(
      "/v1/host-native/actions/authorize",
      {
        tenant_id: "tenant-a",
        work_id: "work-a",
        action: { kind: "render.observe" },
        manual_merge_readback_id,
        release_manifest: { verification: { core_join_verdict_id: "join-v1" } },
      },
      automationKey.json.key,
    );
    const missingIssueResolver = await manualMergeIssue(manualMergeReadbackId);
    assert.equal(missingIssueResolver.status, 400, JSON.stringify(missingIssueResolver.json));
    assert.equal(missingIssueResolver.json.error,
      "software_cognition_manual_merge_refresh_resolver_unavailable");
    assert.equal(actionIssueCalls, 0);

    manualMergeTicket = true;
    const missingLifecycleResolver = await request(
      "/v1/host-native/actions/ticket-v1/reserve",
      {},
      automationKey.json.key,
    );
    assert.equal(missingLifecycleResolver.status, 400,
      JSON.stringify(missingLifecycleResolver.json));
    assert.equal(missingLifecycleResolver.json.error,
      "software_cognition_manual_merge_refresh_resolver_unavailable");
    assert.equal(reserveCalls, 0);

    governance.resolveManualMergeRefreshAuthority = async () => {
      throw new Error("owner_manual_merge_authority_invalid");
    };
    const rejectedIssueResolver = await manualMergeIssue(manualMergeReadbackId);
    assert.equal(rejectedIssueResolver.status, 400,
      JSON.stringify(rejectedIssueResolver.json));
    assert.equal(rejectedIssueResolver.json.error,
      "software_cognition_manual_merge_refresh_resolution_failed");
    const rejectedLifecycleResolver = await request(
      "/v1/host-native/actions/ticket-v1/reserve",
      {},
      automationKey.json.key,
    );
    assert.equal(rejectedLifecycleResolver.status, 400,
      JSON.stringify(rejectedLifecycleResolver.json));
    assert.equal(rejectedLifecycleResolver.json.error,
      "software_cognition_manual_merge_refresh_resolution_failed");
    assert.equal(actionIssueCalls, 0);
    assert.equal(reserveCalls, 0);

    governance.resolveManualMergeRefreshAuthority = async () => ({ trusted: true });
    const booleanOnlyIssueResolver = await manualMergeIssue(manualMergeReadbackId);
    assert.equal(booleanOnlyIssueResolver.status, 400,
      JSON.stringify(booleanOnlyIssueResolver.json));
    assert.equal(booleanOnlyIssueResolver.json.error,
      "software_cognition_manual_merge_refresh_resolution_invalid");
    const booleanOnlyLifecycleResolver = await request(
      "/v1/host-native/actions/ticket-v1/reserve",
      {},
      automationKey.json.key,
    );
    assert.equal(booleanOnlyLifecycleResolver.status, 400,
      JSON.stringify(booleanOnlyLifecycleResolver.json));
    assert.equal(booleanOnlyLifecycleResolver.json.error,
      "software_cognition_manual_merge_refresh_resolution_invalid");
    assert.equal(actionIssueCalls, 0);
    assert.equal(reserveCalls, 0);

    governance.resolveManualMergeRefreshAuthority = async (binding) => {
      const unsigned = {
        schema_version: "host_native_manual_merge_authority_resolution_v1",
        authority_mode: "refresh_closure_only",
        tenant_id: binding.tenant_id,
        work_id: binding.work_id,
        core_join_verdict_id: binding.core_join_verdict_id,
        manual_merge_readback_id: binding.manual_merge_readback_id,
        manual_merge_readback_digest: H("e"),
        refresh_lineage_digest: H("f"),
        ...(binding.ticket_id ? { ticket_id: binding.ticket_id } : {}),
      };
      return { ...unsigned, authority_digest: hostNativeDigest(unsigned) };
    };
    const coreJoinReadsBeforeRefresh = coreJoinReadCalls;
    const acceptedIssueResolver = await manualMergeIssue(manualMergeReadbackId);
    assert.equal(acceptedIssueResolver.status, 201,
      JSON.stringify(acceptedIssueResolver.json));
    assert.equal(actionIssueCalls, 1);
    const acceptedLifecycleResolver = await request(
      "/v1/host-native/actions/ticket-v1/reserve",
      {},
      automationKey.json.key,
    );
    assert.equal(acceptedLifecycleResolver.status, 200,
      JSON.stringify(acceptedLifecycleResolver.json));
    assert.equal(reserveCalls, 1);
    assert.equal(coreJoinReadCalls, coreJoinReadsBeforeRefresh);

    manualMergeReadbackId = `hnmmr_${"b".repeat(40)}`;
    governance.resolveManualMergeRefreshAuthority = async (binding) => {
      const unsigned = {
        schema_version: "host_native_manual_merge_authority_resolution_v1",
        authority_mode: "core_join",
        tenant_id: binding.tenant_id,
        work_id: binding.work_id,
        core_join_verdict_id: binding.core_join_verdict_id,
        manual_merge_readback_id: binding.manual_merge_readback_id,
        manual_merge_readback_digest: H("d"),
        ...(binding.ticket_id ? { ticket_id: binding.ticket_id } : {}),
      };
      return { ...unsigned, authority_digest: hostNativeDigest(unsigned) };
    };
    currentRecord.claim_digest = hostNativeDigest(currentRecord.claim);
    currentRecord.verdict.claim_digest = currentRecord.claim_digest;
    const coreJoinReadsBeforeOrdinary = coreJoinReadCalls;
    const acceptedOrdinaryIssue = await manualMergeIssue(manualMergeReadbackId);
    assert.equal(acceptedOrdinaryIssue.status, 201,
      JSON.stringify(acceptedOrdinaryIssue.json));
    assert.equal(actionIssueCalls, 2);
    assert.equal(coreJoinReadCalls, coreJoinReadsBeforeOrdinary + 1);
    const acceptedOrdinaryLifecycle = await request(
      "/v1/host-native/actions/ticket-v1/reserve",
      {},
      automationKey.json.key,
    );
    assert.equal(acceptedOrdinaryLifecycle.status, 200,
      JSON.stringify(acceptedOrdinaryLifecycle.json));
    assert.equal(reserveCalls, 2);
    assert.equal(coreJoinReadCalls, coreJoinReadsBeforeOrdinary + 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(storageRoot, { recursive: true, force: true });
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});
