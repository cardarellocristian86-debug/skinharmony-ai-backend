import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createNyraPersistentSelfModelStore } from "../src/nyraPersistentSelfModel.js";

const catalog = {
  schema_version: "nyra_neural_branch_network_v1",
  branches: ["planning_prioritization", "execution_planning", "ai_orchestration", "agent_orchestration", "learning_memory", "adaptive_learning", "risk_governance", "delegated_authority", "software_cognition"].map((id) => ({ id })),
};

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

test("Nyra persistent self-model is signed, tenant-scoped and refreshed only by a mutation", () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-self-model-test-"));
  const store = createNyraPersistentSelfModelStore({ storageRoot, signingSecret: "x".repeat(32) });
  const authorizedBranchIds = catalog.branches.map(({ id }) => id);
  assert.equal(store.read({ tenantId: "tenant-a", catalog, authorizedBranchIds }), null);
  const first = store.refresh({ tenantId: "tenant-a", catalog, authorizedBranchIds });
  // A later read has no short-lived owner assertion. It verifies the signed
  // persisted record instead of rebuilding a different profile from the
  // reader's transient branch resolution.
  const second = store.read({ tenantId: "tenant-a", catalog });
  assert.equal(first.schema_version, "nyra_persistent_self_model_v1");
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 1);
  assert.equal(first.signature, second.signature);
  assert.equal(first.execution_allowed, false);
  assert.equal(first.cognitive_engine_contract.reasoning_owner, "nyra_core");
  assert.equal(first.cognitive_engine_contract.connected_ai_role, "interchangeable_cognitive_and_linguistic_engine");
  assert.equal(first.cognitive_engine_contract.final_authority, "universal_core");
  assert.equal(first.structural_autonomy_requirement.id, "software_architecture_atlas");
  assert.equal(first.structural_autonomy_requirement.current_state_source, "work_scoped_operational_dialogue");
  assert.equal(first.structural_autonomy_requirement.bootstrap_capability, "software_cognition_repository_bootstrap");
  assert.match(first.structural_autonomy_requirement.required_coverage.join(","), /components,files,dependencies,services,apis,events,databases,changes,impacts/);
  assert.equal(second.next_recommended_capability, "software_architecture_atlas");
  assert.ok(fs.existsSync(store.fileFor("tenant-a")));
  assert.notEqual(store.fileFor("tenant/a"), store.fileFor("tenant_a"));
  assert.equal(first.capabilities.find((capability) => capability.id === "software_cognition")?.state, "available");
});

test("Nyra persistent self-model survives a fresh store instance without owner context", () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-self-model-test-"));
  const signingSecret = "x".repeat(32);
  const writer = createNyraPersistentSelfModelStore({ storageRoot, signingSecret });
  const authorizedBranchIds = catalog.branches.map(({ id }) => id);
  const written = writer.refresh({ tenantId: "tenant-a", catalog, authorizedBranchIds });

  const reader = createNyraPersistentSelfModelStore({ storageRoot, signingSecret });
  const persisted = reader.read({ tenantId: "tenant-a", catalog });
  assert.equal(persisted.revision, written.revision);
  assert.equal(persisted.payload_digest, written.payload_digest);
  assert.equal(persisted.signature, written.signature);
  assert.equal(persisted.capabilities.find((capability) => capability.id === "connected_ai_orchestration")?.state, "available");
  assert.equal(reader.read({ tenantId: "tenant-b", catalog }), null);
});

test("Nyra persistent self-model reads and owner-migrates the previous signed envelope", () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-self-model-test-"));
  const signingSecret = "x".repeat(32);
  const store = createNyraPersistentSelfModelStore({ storageRoot, signingSecret });
  const authorizedBranchIds = catalog.branches.map(({ id }) => id);
  const current = store.refresh({ tenantId: "tenant-a", catalog, authorizedBranchIds });
  const { revision, generated_at, payload_digest: _payloadDigest, signature: _signature, ...profile } = current;
  const legacy = {
    ...profile,
    revision,
    generated_at,
    payload_digest: sha256(canonical(profile)),
    signature: crypto.createHmac("sha256", signingSecret).update(canonical(profile)).digest("hex"),
  };
  fs.writeFileSync(store.fileFor("tenant-a"), JSON.stringify(legacy));

  const compatibleRead = store.read({ tenantId: "tenant-a", catalog });
  assert.equal(compatibleRead.payload_digest, legacy.payload_digest);
  assert.equal(compatibleRead.signature, legacy.signature);

  const migrated = store.refresh({ tenantId: "tenant-a", catalog, authorizedBranchIds });
  assert.equal(migrated.revision, legacy.revision + 1);
  assert.notEqual(migrated.payload_digest, legacy.payload_digest);
  assert.notEqual(migrated.signature, legacy.signature);
  const { payload_digest: _migratedDigest, signature: _migratedSignature, ...unsigned } = migrated;
  assert.equal(migrated.payload_digest, sha256(canonical(unsigned)));
  assert.equal(
    migrated.signature,
    crypto.createHmac("sha256", signingSecret).update(canonical(unsigned)).digest("hex"),
  );
});

test("Nyra persistent self-model revision stays signed and monotonic across catalog changes", () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-self-model-test-"));
  const store = createNyraPersistentSelfModelStore({ storageRoot, signingSecret: "x".repeat(32) });
  const authorizedBranchIds = catalog.branches.map(({ id }) => id);
  const first = store.refresh({ tenantId: "tenant-a", catalog, authorizedBranchIds });
  const nextCatalog = { ...catalog, schema_version: "nyra_neural_branch_network_v2" };
  const second = store.refresh({ tenantId: "tenant-a", catalog: nextCatalog, authorizedBranchIds });

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.notEqual(second.payload_digest, first.payload_digest);
  assert.notEqual(second.signature, first.signature);
  assert.equal(store.read({ tenantId: "tenant-a", catalog }), null);
  assert.equal(store.read({ tenantId: "tenant-a", catalog: nextCatalog })?.revision, 2);
});

test("Nyra persistent self-model fails closed when revision metadata is altered", () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-self-model-test-"));
  const store = createNyraPersistentSelfModelStore({ storageRoot, signingSecret: "x".repeat(32) });
  const authorizedBranchIds = catalog.branches.map(({ id }) => id);
  store.refresh({ tenantId: "tenant-a", catalog, authorizedBranchIds });
  const corrupted = JSON.parse(fs.readFileSync(store.fileFor("tenant-a"), "utf8"));
  corrupted.revision = 999;
  fs.writeFileSync(store.fileFor("tenant-a"), JSON.stringify(corrupted));

  assert.equal(store.read({ tenantId: "tenant-a", catalog }), null);
  assert.throws(
    () => store.refresh({ tenantId: "tenant-a", catalog, authorizedBranchIds }),
    /nyra_self_model_integrity_invalid/,
  );

  corrupted.generated_at = "not-a-timestamp";
  fs.writeFileSync(store.fileFor("tenant-a"), JSON.stringify(corrupted));
  assert.equal(store.read({ tenantId: "tenant-a", catalog }), null);
});

test("Nyra persistent self-model never replaces an unreadable persisted record", () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-self-model-test-"));
  const store = createNyraPersistentSelfModelStore({ storageRoot, signingSecret: "x".repeat(32) });
  const authorizedBranchIds = catalog.branches.map(({ id }) => id);
  store.refresh({ tenantId: "tenant-a", catalog, authorizedBranchIds });
  fs.writeFileSync(store.fileFor("tenant-a"), "{invalid json");

  assert.equal(store.read({ tenantId: "tenant-a", catalog }), null);
  assert.throws(
    () => store.refresh({ tenantId: "tenant-a", catalog, authorizedBranchIds }),
    /nyra_self_model_integrity_invalid/,
  );
  assert.equal(fs.readFileSync(store.fileFor("tenant-a"), "utf8"), "{invalid json");
});

test("Nyra persistent self-model rejects altered nested payloads and unauthorized branches", () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-self-model-test-"));
  const store = createNyraPersistentSelfModelStore({ storageRoot, signingSecret: "x".repeat(32) });
  const authorizedBranchIds = ["planning_prioritization", "execution_planning"];
  const record = store.refresh({ tenantId: "tenant-a", catalog, authorizedBranchIds });
  assert.equal(record.capabilities.find((capability) => capability.id === "connected_ai_orchestration")?.state, "unavailable");
  const corrupted = JSON.parse(fs.readFileSync(store.fileFor("tenant-a"), "utf8"));
  corrupted.required_infrastructure[0].reason = "altered";
  fs.writeFileSync(store.fileFor("tenant-a"), JSON.stringify(corrupted));
  assert.equal(store.read({ tenantId: "tenant-a", catalog }), null);
});
