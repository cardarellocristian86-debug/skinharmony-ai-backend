import assert from "node:assert/strict";
import test from "node:test";

import { HOST_NATIVE_NYRA_WORK_AUTOMATION, HOST_NATIVE_TOOLS } from "../src/host-native-tools.js";

test("host-native work automation remains zero-provider and single-builder", () => {
  assert.equal(HOST_NATIVE_NYRA_WORK_AUTOMATION.schema_version, "nyra_work_automation_v3");
  assert.equal(HOST_NATIVE_NYRA_WORK_AUTOMATION.maximum_parallel_builders, 1);
  assert.equal(HOST_NATIVE_NYRA_WORK_AUTOMATION.provider_execution, false);
  assert.ok(HOST_NATIVE_TOOLS.some((tool) => tool.name === "host_native_action_reconcile"));
  const quarantine = HOST_NATIVE_TOOLS.find(
    (tool) => tool.name === "host_native_action_quarantine_expired",
  );
  assert.ok(quarantine);
  assert.deepEqual(quarantine.inputSchema.required, [
    "ticket_id", "reservation_id", "readback_digest", "idempotency_key",
  ]);
  const manualMerge = HOST_NATIVE_TOOLS.find(
    (tool) => tool.name === "host_native_owner_manual_merge_readback",
  );
  assert.ok(manualMerge);
  assert.deepEqual(manualMerge.inputSchema.required, [
    "work_id", "intent_anchor_digest", "repository", "core_join_verdict_id",
    "pull_request", "idempotency_key",
  ]);
  assert.equal(manualMerge.inputSchema.additionalProperties, false);
  assert.equal(manualMerge._meta["skinharmony/ownerConfirmationRequired"], true);
  assert.equal(manualMerge.annotations.destructiveHint, false);
  for (const callerFact of [
    "head_commit", "merge_commit", "main_head_commit", "merged", "checks",
    "health", "healthz", "live_commit",
  ]) {
    assert.equal(Object.hasOwn(manualMerge.inputSchema.properties, callerFact), false,
      `${callerFact} must be resolved by Core rather than accepted from the caller`);
  }
  const postRelease = HOST_NATIVE_TOOLS.find(
    (tool) => tool.name === "host_native_post_release_readback_attest",
  );
  assert.ok(postRelease);
  assert.deepEqual(postRelease.inputSchema.required, [
    "work_id", "intent_anchor_digest", "repository", "core_join_verdict_id",
    "pull_request", "idempotency_key",
  ]);
  assert.equal(postRelease.inputSchema.additionalProperties, false);
  assert.equal(postRelease._meta["skinharmony/ownerConfirmationRequired"], true);
  assert.equal(postRelease.annotations.destructiveHint, false);
  for (const internalFact of [
    "post_release_attestation", "software_closure_digest",
    "software_closure_fresh_until", "merge_commit", "checks", "health",
  ]) {
    assert.equal(Object.hasOwn(postRelease.inputSchema.properties, internalFact), false,
      `${internalFact} must remain server-derived`);
  }
  const closureReceipt = HOST_NATIVE_TOOLS.find(
    (tool) => tool.name === "host_native_action_closure_receipt",
  );
  const galleryFinalize = HOST_NATIVE_TOOLS.find(
    (tool) => tool.name === "host_native_owner_manual_merge_finalize_gallery",
  );
  assert.equal(closureReceipt.annotations.readOnlyHint, true);
  assert.equal(galleryFinalize.annotations.readOnlyHint, false);
  assert.equal(
    galleryFinalize._meta["skinharmony/ownerConfirmationRequired"],
    true,
  );
  assert.deepEqual(galleryFinalize.inputSchema.required, ["ticket_id"]);
  for (const callerFact of ["head_commit", "merged", "health", "live_commit"]) {
    assert.equal(Object.hasOwn(galleryFinalize.inputSchema.properties, callerFact), false);
  }
  const authorize = HOST_NATIVE_TOOLS.find(
    (tool) => tool.name === "host_native_action_authorize",
  );
  assert.equal(
    authorize.inputSchema.properties.manual_merge_readback_id.pattern,
    "^hnmmr_[a-f0-9]{40}$",
  );
});
