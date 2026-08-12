import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  NYRA_POLICY_PRIMARY_SOURCES,
  POLICY_PACK_SCHEMA_VERSION,
  compilePolicySnapshot,
  createPolicyPackCandidate,
  policyPackDigest,
} from "../src/nyraPolicyRegistry.js";
import {
  createNyraPolicyRegistryCompilerProvenanceVerifier,
} from "../src/nyraPolicyRegistryCompilerProvenance.js";

const NOW = new Date("2026-08-02T12:00:00.000Z");
const BUILD_COMMIT = "2e0b93b74ae5a1b53cda56f902ac29edf7ac9145";
const coreKeys = crypto.generateKeyPairSync("ed25519");
const nyraKeys = crypto.generateKeyPairSync("ed25519");

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fingerprint(publicKey) {
  return sha256(publicKey.export({ type: "spki", format: "der" }));
}

function publicDer(publicKey) {
  return publicKey.export({ type: "spki", format: "der" }).toString("base64");
}

function source(sourceId) {
  const registered = NYRA_POLICY_PRIMARY_SOURCES.find((entry) => entry.source_id === sourceId);
  return {
    source_id: sourceId,
    url: registered.url,
    claim: `Primary evidence for ${sourceId}`,
    reviewed_at: "2026-08-02",
  };
}

function makeCorePack() {
  const pack = {
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
    artifact_digest: "0".repeat(64),
  };
  pack.artifact_digest = policyPackDigest(pack);
  return pack;
}

function makeCandidate(corePack, {
  packId = "tenant/codexai/action/new-action",
  action = "new.action",
} = {}) {
  return createPolicyPackCandidate({
    pack_id: packId,
    version: "1.0.0",
    scope: { kind: "action", value: action, tenant_id: "codexai" },
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
      allow_actions: [action],
      deny_actions: [`${action}.dangerous`],
      required_gates: ["core_allow"],
    },
    tests: [{ id: "positive", expected: "ALLOW" }, { id: "negative", expected: "DENY" }],
    sources: [source("cedar_authorization")],
    freshness_sla_days: 365,
    valid_from: "2026-08-02T00:00:00.000Z",
    expires_at: "2027-08-02T00:00:00.000Z",
  });
}

function activate(candidate) {
  const signable = { ...candidate, status: "active", signatures: [] };
  const payload = Buffer.from(policyPackDigest(signable), "utf8");
  const active = {
    ...signable,
    signatures: [
      {
        issuer_id: "core",
        algorithm: "Ed25519",
        signature: crypto.sign(null, payload, coreKeys.privateKey).toString("base64url"),
      },
      {
        issuer_id: "nyra",
        algorithm: "Ed25519",
        signature: crypto.sign(null, payload, nyraKeys.privateKey).toString("base64url"),
      },
    ],
  };
  active.artifact_digest = policyPackDigest(active);
  return active;
}

function makeTrustCatalog(corePack, overrides = {}) {
  return {
    schema_version: "nyra_policy_pack_trust_catalog_v1",
    issuers: [
      {
        issuer_id: "core",
        key_id: "core-policy-key-v1",
        role: "core",
        algorithm: "Ed25519",
        public_key: publicDer(coreKeys.publicKey),
        public_key_fingerprint: fingerprint(coreKeys.publicKey),
      },
      {
        issuer_id: "nyra",
        key_id: "nyra-policy-key-v1",
        role: "nyra",
        algorithm: "Ed25519",
        public_key: publicDer(nyraKeys.publicKey),
        public_key_fingerprint: fingerprint(nyraKeys.publicKey),
      },
    ],
    trusted_core_pack_digests: [policyPackDigest(corePack)],
    known_core_branch_ids: ["nyra_policy_registry"],
    known_nyra_branch_ids: ["risk_governance"],
    known_domain_pack_ids: ["generic"],
    ...overrides,
  };
}

function fixture({ initialTime = NOW.getTime(), traversalBudget = 256 } = {}) {
  const corePack = makeCorePack();
  const leafPack = activate(makeCandidate(corePack));
  const trustCatalog = makeTrustCatalog(corePack);
  const trustedIssuers = {
    core: { public_key: coreKeys.publicKey, role: "core" },
    nyra: { public_key: nyraKeys.publicKey, role: "nyra" },
  };
  const compilerInput = {
    schema_version: "nyra_policy_compiler_input_v1",
    leaf_pack_ids: [`${leafPack.pack_id}@${leafPack.version}`],
    packs: [corePack, leafPack],
  };
  const snapshot = compilePolicySnapshot({
    tenant_id: "codexai",
    domain_pack_id: "generic",
    leaf_pack_ids: compilerInput.leaf_pack_ids,
    packs: compilerInput.packs,
    traversal_budget: traversalBudget,
    trusted_issuers: trustedIssuers,
    trusted_core_pack_digests: trustCatalog.trusted_core_pack_digests,
    known_core_branch_ids: trustCatalog.known_core_branch_ids,
    known_nyra_branch_ids: trustCatalog.known_nyra_branch_ids,
    known_domain_pack_ids: trustCatalog.known_domain_pack_ids,
    now: NOW,
  });
  let currentTime = initialTime;
  const verifier = createNyraPolicyRegistryCompilerProvenanceVerifier({
    trust_catalog: trustCatalog,
    build_commit: BUILD_COMMIT,
    traversal_budget: traversalBudget,
    now: () => currentTime,
  });
  const request = {
    tenant_id: "codexai",
    domain_pack_id: "generic",
    snapshot: structuredClone(snapshot),
    compiler_input: structuredClone(compilerInput),
  };
  return {
    corePack,
    leafPack,
    trustCatalog,
    verifier,
    request,
    setClock(value) { currentTime = value; },
  };
}

function recomputeSnapshotDigest(snapshot) {
  const body = structuredClone(snapshot);
  delete body.snapshot_digest;
  return { ...body, snapshot_digest: sha256(canonical(body)) };
}

function recomputeProvenanceDigest(record) {
  delete record.provenance_digest;
  record.provenance_digest = sha256(canonical(record));
  return record;
}

test("deterministic server-side recompile emits exact non-authorizing provenance", () => {
  const { verifier, request } = fixture();
  const first = verifier.verify(request);
  const second = verifier.verify(request);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first), [
    "schema_version", "compiler_mode", "compiler_algorithm", "tenant_id", "domain_pack_id",
    "snapshot_digest", "leaf_pack_digests", "ordered_pack_evidence", "core_root_digest",
    "catalog_digest", "trust_catalog_digest", "compiler_build_commit", "validity",
    "resolution", "execution_authorized", "provenance_digest",
  ]);
  assert.equal(first.schema_version, "nyra_policy_compiler_provenance_v1");
  assert.equal(first.compiler_mode, "core_deterministic_recompile");
  assert.equal(first.compiler_algorithm, "nyra_policy_registry_v1");
  assert.equal(first.execution_authorized, false);
  assert.deepEqual(first.ordered_pack_evidence.map((entry) => entry.verification_kind), [
    "trusted_core_digest", "ed25519_quorum",
  ]);
  assert.deepEqual(first.ordered_pack_evidence[1].verified_roles, ["core", "nyra"]);
  assert.deepEqual(
    {
      record_integrity_verified: verifier.verifyRecord(first, request).record_integrity_verified,
      derivation_reverified: verifier.verifyRecord(first, request).derivation_reverified,
    },
    { record_integrity_verified: true, derivation_reverified: true },
  );
});

test("an exact-shape snapshot with a recomputed self-digest is denied", () => {
  const { verifier, request } = fixture();
  const forged = structuredClone(request.snapshot);
  forged.policy.allow_actions = ["forged.action"];
  request.snapshot = recomputeSnapshotDigest(forged);
  assert.throws(() => verifier.verify(request), /policy_compiler_snapshot_mismatch/);
});

test("signature, root pin, key fingerprint, tenant and domain failures are fail-closed", () => {
  const signatureCase = fixture();
  const signature = signatureCase.request.compiler_input.packs[1].signatures[0];
  signature.signature = `${signature.signature[0] === "A" ? "B" : "A"}${signature.signature.slice(1)}`;
  assert.throws(() => signatureCase.verifier.verify(signatureCase.request), /policy_pack_unverified/);

  const rootCase = fixture();
  const rootVerifier = createNyraPolicyRegistryCompilerProvenanceVerifier({
    trust_catalog: makeTrustCatalog(rootCase.corePack, { trusted_core_pack_digests: ["f".repeat(64)] }),
    build_commit: BUILD_COMMIT,
  });
  assert.throws(() => rootVerifier.verify(rootCase.request), /compiled_core_digest_untrusted/);

  const keyCase = fixture();
  const badFingerprint = structuredClone(keyCase.trustCatalog);
  badFingerprint.issuers[0].public_key_fingerprint = "e".repeat(64);
  assert.throws(() => createNyraPolicyRegistryCompilerProvenanceVerifier({
    trust_catalog: badFingerprint,
    build_commit: BUILD_COMMIT,
  }), /fingerprint/);

  const tenantCase = fixture();
  tenantCase.request.tenant_id = "attacker";
  assert.throws(() => tenantCase.verifier.verify(tenantCase.request), /cross_tenant_pack_denied/);
  const domainCase = fixture();
  domainCase.request.domain_pack_id = "other";
  assert.throws(() => domainCase.verifier.verify(domainCase.request), /domain_untrusted/);
});

test("caller trust, extras, prototypes, sparse arrays and noncanonical order are denied", () => {
  const extra = fixture();
  extra.request.compiler_input.trusted_issuers = {};
  assert.throws(() => extra.verifier.verify(extra.request), /policy_compiler_input_invalid/);

  for (const [field, value] of [["now", NOW], ["traversal_budget", 32]]) {
    const callerControl = fixture();
    callerControl.request[field] = value;
    assert.throws(() => callerControl.verifier.verify(callerControl.request), /verify_input_invalid/);
  }

  const prototype = fixture();
  prototype.request.snapshot = Object.assign(Object.create(null), prototype.request.snapshot);
  assert.throws(() => prototype.verifier.verify(prototype.request), /snapshot_invalid/);

  const sparse = fixture();
  sparse.request.compiler_input.packs = [sparse.request.compiler_input.packs[0], , sparse.request.compiler_input.packs[1]];
  assert.throws(() => sparse.verifier.verify(sparse.request), /policy_compiler_input_invalid/);

  const order = fixture();
  order.request.compiler_input.packs.reverse();
  assert.throws(() => order.verifier.verify(order.request), /noncanonical/);

  const encodings = [
    (signature) => `${signature}==`,
    () => Buffer.alloc(64, 0xff).toString("base64").replace(/=+$/, ""),
    (signature) => ` ${signature}`,
  ];
  for (const encode of encodings) {
    const invalidEncoding = fixture();
    const signature = invalidEncoding.request.compiler_input.packs[1].signatures[0];
    signature.signature = encode(signature.signature);
    assert.throws(() => invalidEncoding.verifier.verify(invalidEncoding.request), /signature_invalid/);
  }
});

test("duplicate and unused pack keys are denied", () => {
  const duplicate = fixture();
  duplicate.request.compiler_input.packs.splice(1, 0, structuredClone(duplicate.request.compiler_input.packs[0]));
  assert.throws(() => duplicate.verifier.verify(duplicate.request), /noncanonical/);

  const unused = fixture();
  const unusedPack = activate(makeCandidate(unused.corePack, {
    packId: "tenant/codexai/action/unused",
    action: "unused.action",
  }));
  unused.request.compiler_input.packs.push(unusedPack);
  assert.throws(() => unused.verifier.verify(unused.request), /pack_set_mismatch/);
});

test("compiler input enforces byte, graph, signature, source, test and constraint budgets", () => {
  const mutations = [
    (input) => { input.traversal_budget = 32; },
    (input) => { input.leaf_pack_ids = Array.from({ length: 17 }, (_, index) => `leaf/${String(index).padStart(2, "0")}@1.0.0`); },
    (input) => { input.packs = Array.from({ length: 65 }, () => structuredClone(input.packs[0])); },
    (input) => { input.packs[1].parent_refs = Array.from({ length: 9 }, () => structuredClone(input.packs[1].parent_refs[0])); },
    (input) => { input.packs[1].signatures = Array.from({ length: 5 }, () => structuredClone(input.packs[1].signatures[0])); },
    (input) => { input.packs[1].sources = Array.from({ length: 17 }, () => structuredClone(input.packs[1].sources[0])); },
    (input) => { input.packs[1].tests = Array.from({ length: 33 }, () => ({ id: "x", expected: "ALLOW" })); },
    (input) => { input.packs[1].policy.constraints = { padding: "x".repeat(66_000) }; },
    (input) => { input.packs[1].provenance = { padding: "x".repeat(525_000) }; },
  ];
  for (const mutate of mutations) {
    const current = fixture();
    mutate(current.request.compiler_input);
    assert.throws(() => current.verifier.verify(current.request), /policy_compiler_/);
  }

  const depth = fixture();
  let nested = {};
  for (let index = 0; index < 18; index += 1) nested = { child: nested };
  depth.request.compiler_input.packs[1].policy.constraints = nested;
  assert.throws(() => depth.verifier.verify(depth.request), /constraints_invalid/);

  const genericDepth = fixture();
  nested = {};
  for (let index = 0; index < 66; index += 1) nested = { child: nested };
  genericDepth.request.compiler_input.packs[1].provenance = nested;
  assert.throws(() => genericDepth.verifier.verify(genericDepth.request), /input_invalid/);

  const genericNodes = fixture();
  genericNodes.request.compiler_input.packs[1].provenance = {
    nodes: Array.from({ length: 100_001 }, () => ({})),
  };
  assert.throws(() => genericNodes.verifier.verify(genericNodes.request), /input_invalid/);
});

test("pack status and temporal validity are enforced with server-owned controls", () => {
  for (const packIndex of [0, 1]) {
    for (const status of ["candidate", "revoked", "quarantined", "canary"]) {
      const current = fixture();
      current.request.compiler_input.packs[packIndex].status = status;
      assert.throws(() => current.verifier.verify(current.request), /pack_status_invalid/);
    }
  }

  const temporal = fixture({ initialTime: Date.parse("2026-08-01T23:59:59.999Z") });
  assert.throws(() => temporal.verifier.verify(temporal.request), /pack_not_yet_valid/);
  temporal.setClock(Date.parse("2026-08-02T00:00:00.000Z"));
  assert.equal(temporal.verifier.verify(temporal.request).snapshot_digest, temporal.request.snapshot.snapshot_digest);
  temporal.setClock(Date.parse("2027-08-01T23:59:59.999Z"));
  assert.equal(temporal.verifier.verify(temporal.request).snapshot_digest, temporal.request.snapshot.snapshot_digest);
  temporal.setClock(Date.parse("2027-08-02T00:00:00.000Z"));
  assert.throws(() => temporal.verifier.verify(temporal.request), /pack_expired/);

  const configuration = fixture();
  assert.throws(() => createNyraPolicyRegistryCompilerProvenanceVerifier({
    trust_catalog: configuration.trustCatalog,
    build_commit: BUILD_COMMIT,
    traversal_budget: 257,
  }), /traversal_budget_invalid/);
  const badClock = createNyraPolicyRegistryCompilerProvenanceVerifier({
    trust_catalog: configuration.trustCatalog,
    build_commit: BUILD_COMMIT,
    now: () => Number.NaN,
  });
  assert.throws(() => badClock.verify(configuration.request), /clock_unavailable/);

  const recovery = fixture();
  assert.deepEqual(
    { ready: recovery.verifier.status().ready, clock_ready: recovery.verifier.status().clock_ready },
    { ready: true, clock_ready: true },
  );
  recovery.setClock(Number.NaN);
  assert.deepEqual(
    {
      ready: recovery.verifier.status().ready,
      clock_ready: recovery.verifier.status().clock_ready,
      error: recovery.verifier.status().error,
    },
    { ready: false, clock_ready: false, error: "policy_compiler_clock_unavailable" },
  );
  assert.throws(() => recovery.verifier.verify(recovery.request), /clock_unavailable/);
  recovery.setClock(NOW.getTime());
  assert.deepEqual(
    {
      ready: recovery.verifier.status().ready,
      clock_ready: recovery.verifier.status().clock_ready,
      error: recovery.verifier.status().error,
    },
    { ready: true, clock_ready: true, error: null },
  );
  assert.equal(recovery.verifier.verify(recovery.request).snapshot_digest, recovery.request.snapshot.snapshot_digest);
});

test("private, RSA, wrapper and non-independent trust keys are rejected", () => {
  const { corePack, trustCatalog } = fixture();
  const variants = [];
  const privateCatalog = structuredClone(trustCatalog);
  privateCatalog.issuers[0].public_key = coreKeys.privateKey.export({
    type: "pkcs8", format: "pem",
  });
  variants.push(privateCatalog);

  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rsaCatalog = structuredClone(trustCatalog);
  rsaCatalog.issuers[0].public_key = publicDer(rsa.publicKey);
  rsaCatalog.issuers[0].public_key_fingerprint = fingerprint(rsa.publicKey);
  variants.push(rsaCatalog);

  const wrapperCatalog = structuredClone(trustCatalog);
  wrapperCatalog.issuers[0].public_key = { pem: publicDer(coreKeys.publicKey) };
  variants.push(wrapperCatalog);

  const sharedCatalog = structuredClone(trustCatalog);
  sharedCatalog.issuers[1].public_key = publicDer(coreKeys.publicKey);
  sharedCatalog.issuers[1].public_key_fingerprint = fingerprint(coreKeys.publicKey);
  variants.push(sharedCatalog);

  for (const catalog of variants) {
    assert.throws(() => createNyraPolicyRegistryCompilerProvenanceVerifier({
      trust_catalog: catalog,
      build_commit: BUILD_COMMIT,
    }), /policy_trust_catalog/);
  }
  assert.throws(() => createNyraPolicyRegistryCompilerProvenanceVerifier({
    trust_catalog: makeTrustCatalog(corePack),
    build_commit: "not-a-commit",
  }), /build_commit_invalid/);
});

test("legacy input and a full table of self-digested provenance tampering are denied", () => {
  const legacy = fixture();
  const { compiler_input: compilerInput, ...requestWithoutInput } = legacy.request;
  assert.throws(() => legacy.verifier.verify({
    ...requestWithoutInput,
    bundle: compilerInput,
  }), /verify_input_invalid/);

  const tamperCases = [
    (record) => { record.tenant_id = "attacker"; },
    (record) => { record.ordered_pack_evidence[1].verified_key_ids[0] = "core-policy-key-v9"; },
    (record) => { record.leaf_pack_digests[0].digest = "f".repeat(64); },
    (record) => { record.validity.expires_at = "2027-08-01T00:00:00.000Z"; },
    (record) => { record.resolution.traversed += 1; },
    (record) => {
      const forgedRoot = "f".repeat(64);
      record.core_root_digest = forgedRoot;
      record.ordered_pack_evidence[0].pack_digest = forgedRoot;
    },
  ];
  for (const mutate of tamperCases) {
    const recordCase = fixture();
    const record = structuredClone(recordCase.verifier.verify(recordCase.request));
    mutate(record);
    recomputeProvenanceDigest(record);
    const result = recordCase.verifier.verifyRecord(record, recordCase.request);
    assert.equal(result.ok, false);
    assert.equal(result.record_integrity_verified, false);
    assert.equal(result.derivation_reverified, false);
  }
  const digestCase = fixture();
  const digestRecord = structuredClone(digestCase.verifier.verify(digestCase.request));
  digestRecord.provenance_digest = "f".repeat(64);
  assert.equal(digestCase.verifier.verifyRecord(digestRecord, digestCase.request).ok, false);
});

test("persisted record integrity is binding-exact and never overclaims derivation", () => {
  const current = fixture();
  const record = current.verifier.verify(current.request);
  const binding = {
    tenant_id: record.tenant_id,
    domain_pack_id: record.domain_pack_id,
    snapshot_digest: record.snapshot_digest,
    compiler_provenance_digest: record.provenance_digest,
  };
  assert.deepEqual(current.verifier.verifyPersistedRecord(record, binding), {
    ok: true,
    record_integrity_verified: true,
    derivation_reverified: false,
    tenant_id: record.tenant_id,
    domain_pack_id: record.domain_pack_id,
    snapshot_digest: record.snapshot_digest,
    compiler_provenance_digest: record.provenance_digest,
    compiler_build_commit: BUILD_COMMIT,
    catalog_digest: record.catalog_digest,
    trust_catalog_digest: record.trust_catalog_digest,
    execution_authorized: false,
    error: null,
  });

  const bindingMutations = [
    (value) => { value.tenant_id = "attacker"; },
    (value) => { value.domain_pack_id = "other"; },
    (value) => { value.snapshot_digest = "f".repeat(64); },
    (value) => { value.compiler_provenance_digest = "f".repeat(64); },
    (value) => { value.extra = true; },
  ];
  for (const mutate of bindingMutations) {
    const forgedBinding = structuredClone(binding);
    mutate(forgedBinding);
    assert.deepEqual(current.verifier.verifyPersistedRecord(record, forgedBinding), {
      ok: false,
      record_integrity_verified: false,
      derivation_reverified: false,
      execution_authorized: false,
      error: "compiled_policy_snapshot_provenance_invalid",
    });
  }
  const forgedRecord = structuredClone(record);
  forgedRecord.snapshot_digest = "f".repeat(64);
  recomputeProvenanceDigest(forgedRecord);
  assert.equal(current.verifier.verifyPersistedRecord(forgedRecord, binding).ok, false);
});

test("catalog normalization is deterministic and status never exposes raw key material", () => {
  const first = fixture();
  const pemCatalog = structuredClone(first.trustCatalog);
  pemCatalog.issuers[0].public_key = coreKeys.publicKey.export({ type: "spki", format: "pem" });
  pemCatalog.issuers[1].public_key = nyraKeys.publicKey.export({ type: "spki", format: "pem" });
  const second = createNyraPolicyRegistryCompilerProvenanceVerifier({
    trust_catalog: pemCatalog,
    build_commit: BUILD_COMMIT,
  });
  assert.equal(first.verifier.status().catalog_digest, second.status().catalog_digest);
  assert.equal(first.verifier.status().trust_catalog_digest, second.status().trust_catalog_digest);
  const status = first.verifier.status();
  assert.deepEqual(Object.keys(status), [
    "schema_version", "ready", "clock_ready", "mode", "compiler_algorithm", "verification_algorithm",
    "traversal_budget", "compiler_build_commit", "catalog_digest", "trust_catalog_digest",
    "issuer_count", "independent_key_count", "trusted_core_pack_digest_count",
    "known_core_branch_count", "known_nyra_branch_count", "known_domain_pack_count",
    "execution_authorized", "error",
  ]);
  assert.equal(status.schema_version, "nyra_policy_compiler_provenance_status_v1");
  assert.equal(status.compiler_algorithm, "nyra_policy_registry_v1");
  assert.equal(status.verification_algorithm, "sha256_canonical_json+ed25519");
  assert.equal(status.traversal_budget, 256);
  assert.equal(status.ready, true);
  assert.equal(status.clock_ready, true);
  assert.equal(status.error, null);
  const statusText = JSON.stringify(status);
  assert.equal(statusText.includes("public_key"), false);
  assert.equal(statusText.includes("BEGIN PUBLIC KEY"), false);
  assert.equal(statusText.includes(publicDer(coreKeys.publicKey)), false);
  assert.equal(status.execution_authorized, false);
});
