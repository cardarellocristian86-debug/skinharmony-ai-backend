import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  NYRA_POLICY_PRIMARY_SOURCES,
  POLICY_PACK_SCHEMA_VERSION,
  assessPolicyCandidate,
  compilePolicySnapshot,
  createPolicyPackCandidate,
  describeNyraPolicyRegistry,
  evaluatePolicySnapshot,
  policyPackDigest,
  proposeMissingPolicyBranch,
  validatePolicyPack,
  verifyPolicyPackSignature,
} from "../src/nyraPolicyRegistry.js";
import {
  composeBranchContext,
  deterministicBranchRegistry,
} from "../branches/index.js";

const TEST_NOW = new Date("2026-07-28T12:00:00.000Z");
const CORE_SIGNING_KEYS = crypto.generateKeyPairSync("ed25519");
const NYRA_SIGNING_KEYS = crypto.generateKeyPairSync("ed25519");
const TRUSTED_ISSUERS = {
  "core-test": { public_key: CORE_SIGNING_KEYS.publicKey, role: "core" },
  "nyra-test": { public_key: NYRA_SIGNING_KEYS.publicKey, role: "nyra" },
};

function source(source_id = "cedar_authorization") {
  const record = NYRA_POLICY_PRIMARY_SOURCES.find((item) => item.source_id === source_id);
  return {
    source_id,
    url: record.url,
    claim: `Primary evidence for ${source_id}`,
    reviewed_at: "2026-07-28",
  };
}

const CORE_PACK = {
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
  tests: [
    { id: "core-allow", expected: "ALLOW" },
    { id: "core-deny", expected: "DENY" },
  ],
  sources: [source("nist_zero_trust")],
  freshness_sla_days: 365,
  provenance: { builder: "universal-core-binary" },
  valid_from: "2026-07-28T00:00:00.000Z",
  expires_at: "2027-07-28T00:00:00.000Z",
  rollback_to: null,
  compatibility: {},
  trust_mode: "compiled_core",
  signatures: [],
};
CORE_PACK.artifact_digest = policyPackDigest(CORE_PACK);
const TRUSTED_CORE_DIGESTS = [policyPackDigest(CORE_PACK)];

function coreParentRef() {
  return {
    pack_id: CORE_PACK.pack_id,
    version: CORE_PACK.version,
    digest: policyPackDigest(CORE_PACK),
  };
}

function evaluateBound(snapshot, input) {
  return evaluatePolicySnapshot(snapshot, {
    core_branch_id: "nyra_policy_registry",
    nyra_branch_id: "risk_governance",
    now: TEST_NOW,
    ...input,
  });
}

function candidate(overrides = {}) {
  return createPolicyPackCandidate({
    pack_id: overrides.pack_id || "tenant/demo/work/deploy",
    version: overrides.version || "1.0.0",
    scope: overrides.scope || { kind: "work_type", value: "deploy", tenant_id: "tenant-a" },
    parent_refs: overrides.parent_refs ?? [coreParentRef()],
    policy: overrides.policy || {
      allow_actions: ["deploy_staging", "read_health"],
      deny_actions: ["deploy_production"],
      required_gates: ["core_allow"],
    },
    tests: overrides.tests || [
      { id: "allow-staging", expected: "ALLOW" },
      { id: "deny-production", expected: "DENY" },
    ],
    sources: overrides.sources || [source()],
    bindings: overrides.bindings,
    privacy: overrides.privacy,
    freshness_sla_days: overrides.freshness_sla_days,
    provenance: { source_commit: "abc123", builder: "local-test" },
    valid_from: overrides.valid_from || "2026-07-28T00:00:00.000Z",
    expires_at: overrides.expires_at || "2027-07-28T00:00:00.000Z",
  });
}

function activate(pack) {
  const signable = {
    ...pack,
    status: "active",
    signatures: [],
  };
  const payload = Buffer.from(policyPackDigest(signable), "utf8");
  const active = {
    ...signable,
    signatures: [
      {
        issuer_id: "core-test",
        algorithm: "Ed25519",
        signature: crypto.sign(null, payload, CORE_SIGNING_KEYS.privateKey).toString("base64"),
      },
      {
        issuer_id: "nyra-test",
        algorithm: "Ed25519",
        signature: crypto.sign(null, payload, NYRA_SIGNING_KEYS.privateKey).toString("base64"),
      },
    ],
  };
  active.artifact_digest = policyPackDigest(active);
  return active;
}

function signCandidate(pack) {
  const signable = { ...pack, status: "signed", signatures: [] };
  const payload = Buffer.from(policyPackDigest(signable), "utf8");
  const signed = {
    ...signable,
    signatures: [
      {
        issuer_id: "core-test",
        algorithm: "Ed25519",
        signature: crypto.sign(null, payload, CORE_SIGNING_KEYS.privateKey).toString("base64"),
      },
      {
        issuer_id: "nyra-test",
        algorithm: "Ed25519",
        signature: crypto.sign(null, payload, NYRA_SIGNING_KEYS.privateKey).toString("base64"),
      },
    ],
  };
  signed.artifact_digest = policyPackDigest(signed);
  return signed;
}

test("registry describes deep logical hierarchy with bounded evaluation and visitable primary sources", () => {
  const description = describeNyraPolicyRegistry();
  assert.equal(description.depth.catalog, "recursive_without_static_ceiling");
  assert.match(description.depth.resolution, /^bounded_/);
  assert.equal(description.dtt.activation_authority, "universal_core");
  assert(NYRA_POLICY_PRIMARY_SOURCES.length >= 12);
  for (const item of NYRA_POLICY_PRIMARY_SOURCES) {
    assert.match(item.url, /^https:\/\//);
    assert(item.supports.length > 0);
  }
});

test("canonical Core registry exposes the policy branch and passes its source catalog to Nyra context", () => {
  const branch = deterministicBranchRegistry().nyra_policy_registry;
  assert(branch);
  assert.equal(branch.policy_registry.dtt.activation_authority, "universal_core");
  const context = composeBranchContext({
    keyRecord: { tenant_id: "tenant-a", metadata: { tier: "base" } },
    requestedBranches: ["nyra_policy_registry"],
    task: "review policy",
  });
  assert.equal(context.policy_registry.primary_sources.length, NYRA_POLICY_PRIMARY_SOURCES.length);
  assert(context.policy_registry.primary_sources.every((item) => item.url.startsWith("https://")));
});

test("candidate requires positive and negative tests and exact tenant scope", () => {
  const pack = candidate();
  assert.equal(pack.schema_version, POLICY_PACK_SCHEMA_VERSION);
  assert.equal(pack.status, "candidate");
  assert.equal(Object.isFrozen(pack.policy), true);
  assert.equal(validatePolicyPack(pack, { tenant_id: "tenant-a", now: TEST_NOW }).ok, true);
  assert.deepEqual(validatePolicyPack(pack, { tenant_id: "tenant-b", now: TEST_NOW }).errors, [
    "cross_tenant_pack_denied",
  ]);
  assert.throws(
    () => candidate({ tests: [{ id: "allow-only", expected: "ALLOW" }] }),
    /positive_and_negative_tests_required/,
  );
  assert.throws(
    () => candidate({ sources: [{ ...source(), url: "https://example.com/substitution" }] }),
    /source_url_registry_mismatch/,
  );
});

test("Ed25519 verification checks the actual pack digest", () => {
  assert.equal(verifyPolicyPackSignature(CORE_PACK).ok, false);
  assert.equal(verifyPolicyPackSignature(CORE_PACK, {
    trusted_core_pack_digests: TRUSTED_CORE_DIGESTS,
  }).ok, true);
  const coreKeys = crypto.generateKeyPairSync("ed25519");
  const nyraKeys = crypto.generateKeyPairSync("ed25519");
  const unsigned = candidate();
  const signable = {
    ...unsigned,
    status: "signed",
    signatures: [],
  };
  const payload = Buffer.from(policyPackDigest(signable), "utf8");
  const signed = {
    ...signable,
    signatures: [
      {
        issuer_id: "core-staging",
        algorithm: "Ed25519",
        signature: crypto.sign(null, payload, coreKeys.privateKey).toString("base64"),
      },
      {
        issuer_id: "nyra-staging",
        algorithm: "Ed25519",
        signature: crypto.sign(null, payload, nyraKeys.privateKey).toString("base64"),
      },
    ],
  };
  signed.artifact_digest = policyPackDigest(signed);
  assert.equal(verifyPolicyPackSignature(signed, {
    trusted_issuers: {
      "core-staging": { public_key: coreKeys.publicKey, role: "core" },
      "nyra-staging": { public_key: nyraKeys.publicKey, role: "nyra" },
    },
  }).ok, true);
  assert.equal(verifyPolicyPackSignature({ ...signed, policy: { ...signed.policy, allow_actions: ["tampered"] } }, {
    trusted_issuers: {
      "core-staging": { public_key: coreKeys.publicKey, role: "core" },
      "nyra-staging": { public_key: nyraKeys.publicKey, role: "nyra" },
    },
  }).ok, false);
  assert.equal(verifyPolicyPackSignature({ ...signed, status: "active" }, {
    trusted_issuers: {
      "core-staging": { public_key: coreKeys.publicKey, role: "core" },
      "nyra-staging": { public_key: nyraKeys.publicKey, role: "nyra" },
    },
  }).ok, false);
  assert.equal(verifyPolicyPackSignature(signed, {
    trusted_issuers: {
      "core-staging": { public_key: coreKeys.publicKey, role: "core" },
    },
  }).error, "policy_pack_signature_quorum_unsatisfied");
  const sameKeySigned = {
    ...signable,
    signatures: [
      {
        issuer_id: "core-staging",
        algorithm: "Ed25519",
        signature: crypto.sign(null, payload, coreKeys.privateKey).toString("base64"),
      },
      {
        issuer_id: "nyra-staging",
        algorithm: "Ed25519",
        signature: crypto.sign(null, payload, coreKeys.privateKey).toString("base64"),
      },
    ],
  };
  assert.equal(verifyPolicyPackSignature(sameKeySigned, {
    trusted_issuers: {
      "core-staging": { public_key: coreKeys.publicKey, role: "core" },
      "nyra-staging": { public_key: coreKeys.publicKey, role: "nyra" },
    },
  }).error, "policy_pack_signature_quorum_unsatisfied");
});

test("snapshot resolves arbitrary catalog depth within a request budget", () => {
  const packs = [];
  let parent = null;
  for (let index = 0; index < 40; index += 1) {
    const pack = candidate({
      pack_id: `tenant/a/deep/level-${index}`,
      scope: { kind: index === 0 ? "tenant" : "policy", value: `level-${index}`, tenant_id: "tenant-a" },
      parent_refs: parent
        ? [{ pack_id: parent.pack_id, version: parent.version, digest: policyPackDigest(parent) }]
        : [coreParentRef()],
      policy: {
        allow_actions: ["read_health"],
        deny_actions: index === 39 ? ["delete_resource"] : [],
        required_gates: ["core_allow"],
      },
    });
    parent = activate(pack);
    packs.push(parent);
  }
  const snapshot = compilePolicySnapshot({
    tenant_id: "tenant-a",
    leaf_pack_ids: [`${parent.pack_id}@${parent.version}`],
    packs: [CORE_PACK, ...packs],
    domain_pack_id: "generic",
    traversal_budget: 64,
    trusted_issuers: TRUSTED_ISSUERS,
    trusted_core_pack_digests: TRUSTED_CORE_DIGESTS,
    now: TEST_NOW,
  });
  assert.equal(snapshot.resolution.logical_depth, 41);
  assert.equal(Object.isFrozen(snapshot.policy), true);
  assert.equal(snapshot.policy.deny_actions.includes("delete_resource"), true);
  assert.throws(() => compilePolicySnapshot({
    tenant_id: "tenant-a",
    leaf_pack_ids: [`${parent.pack_id}@${parent.version}`],
    packs: [CORE_PACK, ...packs],
    domain_pack_id: "generic",
    traversal_budget: 20,
    trusted_issuers: TRUSTED_ISSUERS,
    trusted_core_pack_digests: TRUSTED_CORE_DIGESTS,
    now: TEST_NOW,
  }), /policy_traversal_budget_exceeded/);
});

test("snapshot is default-deny, deny-wins and diagnostics fail closed", () => {
  const active = activate(candidate());
  assert.throws(() => compilePolicySnapshot({
    tenant_id: "tenant-a",
    leaf_pack_ids: [`${active.pack_id}@${active.version}`],
    packs: [CORE_PACK, active],
    domain_pack_id: "generic",
    trusted_core_pack_digests: TRUSTED_CORE_DIGESTS,
    trusted_issuers: {
      "core-test": TRUSTED_ISSUERS["core-test"],
    },
    now: TEST_NOW,
  }), /policy_pack_unverified/);
  const snapshot = compilePolicySnapshot({
    tenant_id: "tenant-a",
    leaf_pack_ids: [`${active.pack_id}@${active.version}`],
    packs: [CORE_PACK, active],
    domain_pack_id: "generic",
    trusted_issuers: TRUSTED_ISSUERS,
    trusted_core_pack_digests: TRUSTED_CORE_DIGESTS,
    now: TEST_NOW,
  });
  assert.equal(evaluateBound(snapshot, {
    tenant_id: "tenant-a",
    action: "read_health",
    satisfied_gates: ["core_allow"],
  }).verdict, "ALLOW");
  assert.deepEqual(evaluateBound(snapshot, {
    tenant_id: "tenant-a",
    action: "deploy_production",
    satisfied_gates: ["core_allow"],
  }).reasons, ["explicit_deny", "default_deny"]);
  assert.deepEqual(evaluateBound(snapshot, {
    tenant_id: "tenant-a",
    action: "read_health",
    satisfied_gates: ["core_allow"],
    diagnostics: ["cedar_policy_error"],
  }).reasons, ["policy_diagnostics_present"]);
  assert.equal(evaluatePolicySnapshot(snapshot, {
    tenant_id: "tenant-a",
    action: "read_health",
    core_branch_id: "another_branch",
    nyra_branch_id: "risk_governance",
    satisfied_gates: ["core_allow"],
    now: TEST_NOW,
  }).verdict, "DENY");
  const tampered = JSON.parse(JSON.stringify(snapshot));
  tampered.policy.allow_actions.push("deploy_production");
  assert.equal(evaluateBound(tampered, {
    tenant_id: "tenant-a",
    action: "deploy_production",
    satisfied_gates: ["core_allow"],
  }).verdict, "DENY");
  assert(evaluateBound(tampered, {
    tenant_id: "tenant-a",
    action: "deploy_production",
    satisfied_gates: ["core_allow"],
  }).reasons.includes("invalid_policy_snapshot"));
});

test("an empty restrictive child allowlist narrows its parent to deny all", () => {
  const parent = activate(candidate({
    pack_id: "tenant/a/parent",
    scope: { kind: "tenant", value: "tenant-a", tenant_id: "tenant-a" },
    policy: {
      allow_mode: "restrict",
      allow_actions: ["deploy_staging"],
      deny_actions: [],
      required_gates: [],
    },
  }));
  const child = activate(candidate({
    pack_id: "tenant/a/child",
    scope: { kind: "policy", value: "deny-all", tenant_id: "tenant-a" },
    parent_refs: [{ pack_id: parent.pack_id, version: parent.version, digest: policyPackDigest(parent) }],
    policy: {
      allow_mode: "restrict",
      allow_actions: [],
      deny_actions: [],
      required_gates: [],
    },
  }));
  const snapshot = compilePolicySnapshot({
    tenant_id: "tenant-a",
    domain_pack_id: "generic",
    leaf_pack_ids: [`${child.pack_id}@${child.version}`],
    packs: [CORE_PACK, parent, child],
    trusted_issuers: TRUSTED_ISSUERS,
    trusted_core_pack_digests: TRUSTED_CORE_DIGESTS,
    now: TEST_NOW,
  });
  assert.deepEqual(snapshot.policy.allow_actions, []);
  assert.equal(evaluateBound(snapshot, {
    tenant_id: "tenant-a",
    action: "deploy_staging",
  }).verdict, "DENY");
});

test("cross-tenant snapshot replay fails closed", () => {
  const active = activate(candidate());
  const snapshot = compilePolicySnapshot({
    tenant_id: "tenant-a",
    leaf_pack_ids: [`${active.pack_id}@${active.version}`],
    packs: [CORE_PACK, active],
    domain_pack_id: "generic",
    trusted_issuers: TRUSTED_ISSUERS,
    trusted_core_pack_digests: TRUSTED_CORE_DIGESTS,
    now: TEST_NOW,
  });
  assert.equal(evaluateBound(snapshot, {
    tenant_id: "tenant-b",
    action: "read_health",
    satisfied_gates: ["core_allow"],
  }).verdict, "DENY");
});

test("missing ancestry and roots without Core invariants are rejected", () => {
  const broken = activate(candidate({
    parent_refs: [{ pack_id: "missing/parent", version: "1.0.0", digest: "a".repeat(64) }],
  }));
  assert.throws(() => compilePolicySnapshot({
    tenant_id: "tenant-a",
    leaf_pack_ids: [`${broken.pack_id}@${broken.version}`],
    packs: [broken],
    domain_pack_id: "generic",
    trusted_issuers: TRUSTED_ISSUERS,
    trusted_core_pack_digests: TRUSTED_CORE_DIGESTS,
    now: TEST_NOW,
  }), /policy_parent_missing/);
  const orphan = activate(candidate({ parent_refs: [] }));
  assert.throws(() => compilePolicySnapshot({
    tenant_id: "tenant-a",
    leaf_pack_ids: [`${orphan.pack_id}@${orphan.version}`],
    packs: [orphan],
    domain_pack_id: "generic",
    trusted_issuers: TRUSTED_ISSUERS,
    trusted_core_pack_digests: TRUSTED_CORE_DIGESTS,
    now: TEST_NOW,
  }), /core_invariant_ancestry_required/);
  const valid = activate(candidate({ pack_id: "tenant/a/valid-root" }));
  assert.throws(() => compilePolicySnapshot({
    tenant_id: "tenant-a",
    leaf_pack_ids: [`${valid.pack_id}@${valid.version}`, `${orphan.pack_id}@${orphan.version}`],
    packs: [CORE_PACK, valid, orphan],
    domain_pack_id: "generic",
    trusted_issuers: TRUSTED_ISSUERS,
    trusted_core_pack_digests: TRUSTED_CORE_DIGESTS,
    now: TEST_NOW,
  }), /core_invariant_ancestry_required/);
  const secondCore = {
    ...CORE_PACK,
    pack_id: "core/invariants-secondary",
    artifact_digest: null,
  };
  secondCore.artifact_digest = policyPackDigest(secondCore);
  const secondLeaf = activate(candidate({
    pack_id: "tenant/a/second-core-leaf",
    parent_refs: [{
      pack_id: secondCore.pack_id,
      version: secondCore.version,
      digest: policyPackDigest(secondCore),
    }],
  }));
  assert.throws(() => compilePolicySnapshot({
    tenant_id: "tenant-a",
    leaf_pack_ids: [`${valid.pack_id}@${valid.version}`, `${secondLeaf.pack_id}@${secondLeaf.version}`],
    packs: [CORE_PACK, secondCore, valid, secondLeaf],
    domain_pack_id: "generic",
    trusted_issuers: TRUSTED_ISSUERS,
    trusted_core_pack_digests: [policyPackDigest(CORE_PACK), policyPackDigest(secondCore)],
    now: TEST_NOW,
  }), /multiple_core_invariant_roots_across_leaves/);
});

test("unknown branch bindings, raw customer data and domain-pack leakage fail closed", () => {
  const base = candidate({
    bindings: {
      core_branch_ids: ["unknown_core_branch"],
      nyra_branch_ids: ["risk_governance"],
      domain_pack_ids: ["generic"],
    },
  });
  assert.deepEqual(validatePolicyPack(base, {
    tenant_id: "tenant-a",
    now: TEST_NOW,
    known_core_branch_ids: ["nyra_policy_registry"],
  }).errors, ["unknown_core_branch_binding"]);

  const unsafe = { ...candidate(), privacy: { raw_customer_data_allowed: true } };
  unsafe.artifact_digest = policyPackDigest(unsafe);
  assert.deepEqual(validatePolicyPack(unsafe, { tenant_id: "tenant-a", now: TEST_NOW }).errors, [
    "raw_customer_data_forbidden",
  ]);

  const active = activate(candidate());
  assert.throws(() => compilePolicySnapshot({
    tenant_id: "tenant-a",
    domain_pack_id: "skinharmony",
    leaf_pack_ids: [`${active.pack_id}@${active.version}`],
    packs: [CORE_PACK, active],
    trusted_issuers: TRUSTED_ISSUERS,
    trusted_core_pack_digests: TRUSTED_CORE_DIGESTS,
    now: TEST_NOW,
  }), /policy_domain_pack_leakage/);

  const disjoint = activate(candidate({
    bindings: {
      core_branch_ids: ["another_core_branch"],
      nyra_branch_ids: ["another_nyra_branch"],
      domain_pack_ids: ["generic"],
    },
  }));
  assert.throws(() => compilePolicySnapshot({
    tenant_id: "tenant-a",
    domain_pack_id: "generic",
    leaf_pack_ids: [`${disjoint.pack_id}@${disjoint.version}`],
    packs: [CORE_PACK, disjoint],
    trusted_issuers: TRUSTED_ISSUERS,
    trusted_core_pack_digests: TRUSTED_CORE_DIGESTS,
    now: TEST_NOW,
  }), /policy_binding_intersection_empty/);
});

test("authority expansion requires both request-bound Core receipt and owner proof", () => {
  const parent = activate(candidate({
    pack_id: "tenant/a/expansion-parent",
    scope: { kind: "tenant", value: "tenant-a", tenant_id: "tenant-a" },
    policy: {
      allow_actions: ["read_health"],
      deny_actions: [],
      required_gates: ["core_allow"],
    },
  }));
  const parentSnapshot = compilePolicySnapshot({
    tenant_id: "tenant-a",
    domain_pack_id: "generic",
    leaf_pack_ids: [`${parent.pack_id}@${parent.version}`],
    packs: [CORE_PACK, parent],
    trusted_issuers: TRUSTED_ISSUERS,
    trusted_core_pack_digests: TRUSTED_CORE_DIGESTS,
    now: TEST_NOW,
  });
  const expandedCandidate = candidate({
    parent_refs: [{ pack_id: parent.pack_id, version: parent.version, digest: policyPackDigest(parent) }],
    policy: {
    allow_actions: ["read_health", "deploy_staging"],
    deny_actions: [],
    required_gates: ["core_allow"],
    },
  });
  const expanded = signCandidate(expandedCandidate);
  const tests = [
    { expected: "ALLOW", passed: true },
    { expected: "DENY", passed: true },
  ];
  const consumedProof = (expected, {
    proof_kind,
    issuer_role,
    consumption_id,
    transaction_id,
  }) => ({
    ok: true,
    signature_verified: true,
    tenant_id: expected.tenant_id,
    candidate_digest: expected.candidate_digest,
    action: expected.action,
    expires_at: "2026-07-28T13:00:00.000Z",
    single_use: true,
    consumed: true,
    consumption_receipt_verified: true,
    replay_state: "consumed_now",
    proof_kind,
    issuer_role,
    consumption_id,
    transaction_id,
    consumed_at: "2026-07-28T12:00:00.000Z",
    verdict: "ALLOW",
  });
  const consumeProofs = (_proofs, expected) => {
    const transactionId = "tx_consume_1234567890";
    return {
      ok: true,
      atomic: true,
      transaction_id: transactionId,
      core: consumedProof(expected, {
        proof_kind: "core_receipt",
        issuer_role: "universal_core",
        consumption_id: "consume_core_123456",
        transaction_id: transactionId,
      }),
      owner: expected.owner_proof_required
        ? consumedProof(expected, {
            proof_kind: "owner_proof",
            issuer_role: "tenant_owner",
            consumption_id: "consume_owner_12345",
            transaction_id: transactionId,
          })
        : null,
    };
  };
  const verifyParent = (snapshot, expected) => ({
    ok: true,
    signature_verified: true,
    tenant_id: expected.tenant_id,
    snapshot_digest: snapshot.snapshot_digest,
  });
  const denied = assessPolicyCandidate({
    candidate: expanded,
    parent_snapshot: parentSnapshot,
    test_results: tests,
    trusted_issuers: TRUSTED_ISSUERS,
    core_receipt: { opaque: "core-receipt" },
    consume_activation_proofs: consumeProofs,
    verify_parent_snapshot: verifyParent,
    now: TEST_NOW,
  });
  assert.equal(denied.ready_for_activation, false);
  assert.deepEqual(denied.capability_expansion, ["deploy_staging"]);
  const ready = assessPolicyCandidate({
    candidate: expanded,
    parent_snapshot: parentSnapshot,
    test_results: tests,
    trusted_issuers: TRUSTED_ISSUERS,
    core_receipt: { opaque: "core-receipt" },
    owner_proof: { opaque: "owner-proof" },
    consume_activation_proofs: consumeProofs,
    verify_parent_snapshot: verifyParent,
    now: TEST_NOW,
  });
  assert.equal(ready.ready_for_activation, true);
  assert.equal(ready.activation_performed, false);
  const duplicatedConsumption = assessPolicyCandidate({
    candidate: expanded,
    parent_snapshot: parentSnapshot,
    test_results: tests,
    trusted_issuers: TRUSTED_ISSUERS,
    core_receipt: { opaque: "core-receipt-duplicate" },
    owner_proof: { opaque: "owner-proof-duplicate" },
    consume_activation_proofs: (proofs, expected) => {
      const result = consumeProofs(proofs, expected);
      return { ...result, owner: { ...result.core } };
    },
    verify_parent_snapshot: verifyParent,
    now: TEST_NOW,
  });
  assert.equal(duplicatedConsumption.ready_for_activation, false);
  const skippedParentCandidate = candidate({
    parent_refs: [coreParentRef()],
    policy: expandedCandidate.policy,
  });
  const skippedParent = signCandidate(skippedParentCandidate);
  const skippedResult = assessPolicyCandidate({
    candidate: skippedParent,
    parent_snapshot: parentSnapshot,
    test_results: tests,
    trusted_issuers: TRUSTED_ISSUERS,
    core_receipt: { opaque: "core-receipt-2" },
    owner_proof: { opaque: "owner-proof-2" },
    consume_activation_proofs: consumeProofs,
    verify_parent_snapshot: verifyParent,
    now: TEST_NOW,
  });
  assert.equal(skippedResult.checks.parent_snapshot_valid, false);
  assert.equal(skippedResult.ready_for_activation, false);
  const booleansOnly = assessPolicyCandidate({
    candidate: expanded,
    parent_snapshot: parentSnapshot,
    test_results: tests,
    trusted_issuers: TRUSTED_ISSUERS,
    core_receipt: { verdict: "ALLOW", request_bound: true },
    owner_proof: { request_bound: true },
    verify_parent_snapshot: verifyParent,
    now: TEST_NOW,
  });
  assert.equal(booleansOnly.ready_for_activation, false);
});

test("expired and future candidates cannot become activation-ready", () => {
  const baseCandidate = candidate();
  const expiredBase = {
    ...baseCandidate,
    valid_from: "2020-01-01T00:00:00.000Z",
    expires_at: "2020-02-01T00:00:00.000Z",
  };
  const expired = signCandidate(expiredBase);
  const result = assessPolicyCandidate({
    candidate: expired,
    parent_snapshot: { policy: { allow_actions: expired.policy.allow_actions } },
    test_results: [
      { expected: "ALLOW", passed: true },
      { expected: "DENY", passed: true },
    ],
    trusted_issuers: TRUSTED_ISSUERS,
    now: TEST_NOW,
  });
  assert.equal(result.ready_for_activation, false);
  assert(result.reasons.includes("policy_source_stale") || result.reasons.includes("pack_expired"));
});

test("DTT missing-branch discovery is a tenant-bound candidate and never activates policy", () => {
  const proposal = proposeMissingPolicyBranch({
    tenant_id: "tenant-a",
    desired_path: ["sector/retail", "tenant/acme", "work/refund"],
    research_plan_id: "rp_local_001",
    source_ids: ["nist_abac", "cedar_validation"],
  });
  assert.equal(proposal.status, "candidate");
  assert.equal(proposal.execution.authorized, false);
  assert.equal(proposal.execution.policy_activation, false);
  assert.equal(proposal.execution.core_promotion_required, true);
});
