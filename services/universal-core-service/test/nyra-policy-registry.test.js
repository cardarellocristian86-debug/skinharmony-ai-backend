import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  NYRA_POLICY_PRIMARY_SOURCES,
  POLICY_PACK_SCHEMA_VERSION,
  compilePolicySnapshot,
  createPolicyPackCandidate,
  describeNyraPolicyRegistry,
  evaluatePolicySnapshot,
  policyPackDigest,
  validatePolicyPack,
} from "../src/nyraPolicyRegistry.js";
import { composeBranchContext, deterministicBranchRegistry } from "../branches/index.js";

const NOW = new Date("2026-08-02T12:00:00.000Z");
const coreKeys = crypto.generateKeyPairSync("ed25519");
const nyraKeys = crypto.generateKeyPairSync("ed25519");
const trustedIssuers = {
  core: { public_key: coreKeys.publicKey, role: "core" },
  nyra: { public_key: nyraKeys.publicKey, role: "nyra" },
};

function source(sourceId = "cedar_authorization") {
  const registered = NYRA_POLICY_PRIMARY_SOURCES.find((item) => item.source_id === sourceId);
  return {
    source_id: sourceId,
    url: registered.url,
    claim: `Primary evidence for ${sourceId}`,
    reviewed_at: "2026-08-02",
  };
}

const corePack = {
  schema_version: POLICY_PACK_SCHEMA_VERSION,
  pack_id: "core/invariants",
  version: "1.0.0",
  status: "active",
  scope: { kind: "core", value: "universal-core", tenant_id: null },
  parent_refs: [],
  bindings: {
    core_branch_ids: ["nyra_policy_registry"],
    nyra_branch_ids: ["risk_governance"],
    domain_pack_ids: ["generic"],
  },
  privacy: { raw_customer_data_allowed: false, data_classification: "policy_metadata_only" },
  policy: {
    allow_mode: "inherit",
    allow_actions: [],
    deny_actions: ["cross_tenant_access"],
    required_gates: ["core_allow"],
    constraints: {},
  },
  tests: [{ id: "allow", expected: "ALLOW" }, { id: "deny", expected: "DENY" }],
  sources: [source("nist_zero_trust")],
  freshness_sla_days: 365,
  provenance: { builder: "universal-core-binary" },
  valid_from: "2026-08-02T00:00:00.000Z",
  expires_at: "2027-08-02T00:00:00.000Z",
  rollback_to: null,
  compatibility: {},
  trust_mode: "compiled_core",
  signatures: [],
};
corePack.artifact_digest = policyPackDigest(corePack);

function candidate() {
  return createPolicyPackCandidate({
    pack_id: "tenant/codexai/action/new-action",
    version: "1.0.0",
    scope: { kind: "action", value: "new.action", tenant_id: "codexai" },
    parent_refs: [{
      pack_id: corePack.pack_id,
      version: corePack.version,
      digest: policyPackDigest(corePack),
    }],
    bindings: {
      core_branch_ids: ["nyra_policy_registry"],
      nyra_branch_ids: ["risk_governance"],
      domain_pack_ids: ["generic"],
    },
    policy: {
      allow_actions: ["new.action"],
      deny_actions: ["new.action.dangerous"],
      required_gates: ["core_allow"],
    },
    tests: [{ id: "positive", expected: "ALLOW" }, { id: "negative", expected: "DENY" }],
    sources: [source()],
    freshness_sla_days: 365,
    valid_from: "2026-08-02T00:00:00.000Z",
    expires_at: "2027-08-02T00:00:00.000Z",
  });
}

function activate(pack) {
  const signable = { ...pack, status: "active", signatures: [] };
  const payload = Buffer.from(policyPackDigest(signable), "utf8");
  const active = {
    ...signable,
    signatures: [
      { issuer_id: "core", algorithm: "Ed25519", signature: crypto.sign(null, payload, coreKeys.privateKey).toString("base64") },
      { issuer_id: "nyra", algorithm: "Ed25519", signature: crypto.sign(null, payload, nyraKeys.privateKey).toString("base64") },
    ],
  };
  active.artifact_digest = policyPackDigest(active);
  return active;
}

test("policy registry is exposed as an advisory horizontal branch", () => {
  const branch = deterministicBranchRegistry().nyra_policy_registry;
  assert.equal(branch.production_status, "advisory");
  assert.equal(branch.policy_registry.dtt.activation_authority, "universal_core");
  const context = composeBranchContext({
    keyRecord: { tenant_id: "codexai", metadata: { tier: "base" } },
    requestedBranches: ["nyra_policy_registry"],
  });
  assert.equal(context.policy_registry.primary_sources.length, NYRA_POLICY_PRIMARY_SOURCES.length);
});

test("candidate validation is tenant scoped and requires positive and negative tests", () => {
  const pack = candidate();
  assert.equal(validatePolicyPack(pack, { tenant_id: "codexai", now: NOW }).ok, true);
  assert.deepEqual(validatePolicyPack(pack, { tenant_id: "other", now: NOW }).errors, ["cross_tenant_pack_denied"]);
  assert.throws(() => createPolicyPackCandidate({
    ...pack,
    tests: [{ id: "positive", expected: "ALLOW" }],
  }), /positive_and_negative_tests_required/);
});

test("compiled snapshot is immutable, deny-wins and default-deny", () => {
  const snapshot = compilePolicySnapshot({
    tenant_id: "codexai",
    leaf_pack_ids: ["tenant/codexai/action/new-action@1.0.0"],
    packs: [corePack, activate(candidate())],
    trusted_issuers: trustedIssuers,
    trusted_core_pack_digests: [policyPackDigest(corePack)],
    domain_pack_id: "generic",
    now: NOW,
  });
  const evaluate = (action) => evaluatePolicySnapshot(snapshot, {
    tenant_id: "codexai",
    action,
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    satisfied_gates: ["core_allow"],
    now: NOW,
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(evaluate("new.action").verdict, "ALLOW");
  assert.deepEqual(evaluate("unknown.action").reasons, ["default_deny"]);
  assert.deepEqual(evaluate("new.action.dangerous").reasons, ["explicit_deny", "default_deny"]);
});

test("registry description forbids autonomous activation", () => {
  const description = describeNyraPolicyRegistry();
  assert.equal(description.dtt.activation_authority, "universal_core");
  assert.equal(description.dtt.missing_branch_mode, "candidate_only");
  assert(description.update_policy.gated.includes("activation"));
});
