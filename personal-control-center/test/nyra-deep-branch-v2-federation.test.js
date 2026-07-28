"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  EVALUATION_ATTESTATION_SCHEMA_VERSION,
  EVALUATION_RESPONSE_SCHEMA_VERSION,
  ENVELOPE_AUDIENCE,
  ENVELOPE_ISSUER,
  canonicalJson,
  coreEnvelopeBindingHash,
  createNyraDeepBranchV2Federation,
  createPersistentReplayGuard,
  encodeOpaqueNodeContext,
  operationalLineageFromShard,
  signEvaluationAttestation,
  signCoreEnvelope,
} = require("../lib/nyra-deep-branch-v2-federation");
const { loadCatalog, loadRuntimeShard } = require("../lib/nyra-deep-branch-v2");

const serviceKey = "nyra-deep-branch-v2-federation-test-service-key-0123456789";
const replayLockSchemaVersion = "nyra_deep_branch_v2_replay_lock_v1";
const branchAllowlist = ["context_intelligence", "work_intake", "research_evidence", "quality_verification"];
const loaded = loadCatalog({ runtimeMode: "lazy" });
const testCatalogPath = path.resolve(
  process.env.NYRA_DEEP_V2_TEST_CATALOG_PATH
    || path.resolve(__dirname, "../data/nyra-deep-branch-v2.catalog.json")
);
const fixtureBundlePath = path.resolve(
  process.env.NYRA_DEEP_V2_TEST_FIXTURES_PATH
    || path.resolve(__dirname, "../data/nyra-deep-branch-v2.fixtures.json")
);

function resolveFixture(bundle, fixtureId, seen = new Set()) {
  const descriptor = bundle.fixtures[fixtureId];
  if (!descriptor) throw new Error(`fixture_missing:${fixtureId}`);
  if (seen.has(fixtureId)) throw new Error(`fixture_cycle:${fixtureId}`);
  seen.add(fixtureId);
  const { base_fixture: baseFixture, ...own } = descriptor;
  return baseFixture
    ? { ...resolveFixture(bundle, baseFixture, seen), ...structuredClone(own) }
    : structuredClone(own);
}

function env(overrides = {}) {
  return {
    NYRA_DEEP_BRANCH_V2_ENABLED: "true",
    NYRA_DEEP_BRANCH_V2_MODE: "shadow",
    NYRA_DEEP_BRANCH_V2_BRANCHES: branchAllowlist.join(","),
    NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST: "codexai",
    NYRA_DEEP_BRANCH_V2_FEDERATION_ENABLED: "true",
    NYRA_DEEP_BRANCH_V2_FEDERATION_TENANT_ALLOWLIST: "codexai",
    NYRA_DEEP_BRANCH_V2_CORE_SHARED_SECRET: serviceKey,
    ...overrides,
  };
}

function envelope(overrides = {}) {
  const now = Date.now();
  const value = {
    schema_version: "nyra_deep_branch_v2_core_envelope_v1",
    issuer: "skinharmony-universal-core",
    audience: "skinharmony-nyra-core",
    tenant_id: "codexai",
    request_id: "federation-test-request",
    domain_pack: "skinharmony",
    catalog_scope: "skinharmony",
    entitlement_domain_pack: "generic",
    opened_branch_ids: branchAllowlist,
    branch_allowlist: branchAllowlist,
    preflight_id: "preflight-federation-test",
    core_policy_hash: "a".repeat(64),
    catalog_fingerprint: loaded.catalog.catalog_fingerprint,
    root_binding_hash: loaded.manifest.root_binding_hash,
    nonce: "b".repeat(64),
    issued_at: new Date(now - 100).toISOString(),
    expires_at: new Date(now + 30_000).toISOString(),
    ...overrides,
  };
  value.signature = signCoreEnvelope(value, serviceKey);
  return value;
}

function operationalFixture({
  branchId = "context_intelligence",
  subbranchId = "request_normalization",
  privateKey,
} = {}) {
  const shard = loadRuntimeShard({
    loaded,
    tenantId: "codexai",
    branchId,
    subbranchId,
  });
  assert.equal(shard.ok, true, shard.errors?.join(",") || "runtime_shard_load_failed");
  const lineage = operationalLineageFromShard(shard);
  assert.equal(lineage?.length, 6);
  const fullCatalog = loadCatalog({
    catalogPath: testCatalogPath,
    runtimeMode: "legacy",
  }).catalog;
  const nodeIndex = new Map(fullCatalog.nodes.map((node) => [node.id, node]));
  const fixtureBundle = JSON.parse(fs.readFileSync(fixtureBundlePath, "utf8"));
  const observedAt = [];
  const nodeContexts = lineage.map((lineageNode, index) => {
    const node = nodeIndex.get(lineageNode.node_id);
    const fixture = resolveFixture(fixtureBundle, node.positive_tests[0].input_fixture);
    observedAt.push(fixture.observed_at);
    const opaque = encodeOpaqueNodeContext({
      node_id: node.id,
      capability_input: fixture.capability_input,
      evidence: fixture.evidence,
      evidence_manifest: fixture.core_payload.result.evidence_manifest,
      policy_decisions: fixture.core_payload.result.policy_decisions,
    });
    return {
      schema_version: "nyra_deep_branch_v2_opaque_node_context_v1",
      node_id: node.id,
      context_id: `opaque-context-${index}`,
      ...opaque,
    };
  });
  assert.equal(new Set(observedAt).size, 1);
  const coreEnvelope = envelope({
    opened_branch_ids: [branchId],
    branch_allowlist: [branchId],
    nonce: "d".repeat(64),
  });
  const now = Date.now();
  const attestation = {
    schema_version: EVALUATION_ATTESTATION_SCHEMA_VERSION,
    issuer: ENVELOPE_ISSUER,
    audience: ENVELOPE_AUDIENCE,
    key_id: "core-v2-test-k1",
    tenant_id: coreEnvelope.tenant_id,
    request_id: coreEnvelope.request_id,
    domain_pack: coreEnvelope.domain_pack,
    catalog_scope: coreEnvelope.catalog_scope,
    entitlement_domain_pack: coreEnvelope.entitlement_domain_pack,
    branch_id: branchId,
    subbranch_id: subbranchId,
    preflight_id: coreEnvelope.preflight_id,
    core_policy_hash: coreEnvelope.core_policy_hash,
    envelope_binding_hash: coreEnvelopeBindingHash(coreEnvelope),
    catalog_fingerprint: loaded.manifest.root_binding.catalog_fingerprint,
    root_binding_hash: loaded.manifest.root_binding_hash,
    function_registry_hash: loaded.manifest.root_binding.function_registry_hash,
    package_hash: shard.descriptor.uncompressed_sha256,
    lineage,
    node_contexts: nodeContexts,
    nonce: "e".repeat(64),
    issued_at: new Date(now - 100).toISOString(),
    expires_at: new Date(now + 30_000).toISOString(),
    observed_at: observedAt[0],
  };
  attestation.signature = signEvaluationAttestation(attestation, privateKey);
  coreEnvelope.operational_attestation = attestation;
  coreEnvelope.signature = signCoreEnvelope(coreEnvelope, serviceKey);
  return { coreEnvelope, attestation, lineage };
}

function operationalEnv(publicKey, overrides = {}) {
  return env({
    NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED: "true",
    NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_TENANT_ALLOWLIST: "codexai",
    NYRA_DEEP_BRANCH_V2_CORE_ATTESTATION_KEY_ID_ALLOWLIST: "core-v2-test-k1",
    NYRA_DEEP_BRANCH_V2_CORE_ATTESTATION_PUBLIC_KEYS: JSON.stringify({
      "core-v2-test-k1": publicKey.export({ type: "spki", format: "pem" }),
    }),
    ...overrides,
  });
}

function replayLockMetadata({
  ownerId = "1".repeat(32),
  ownerPid = process.pid,
  ownerHostHash = crypto.createHash("sha256").update(os.hostname()).digest("hex"),
  acquiredAt,
  expiresAt,
}) {
  return {
    schema_version: replayLockSchemaVersion,
    owner_id: ownerId,
    owner_pid: ownerPid,
    owner_host_hash: ownerHostHash,
    acquired_at: acquiredAt,
    expires_at: expiresAt,
  };
}

function writeReplayLock(filePath, metadata) {
  const lockPath = `${filePath}.lock`;
  fs.mkdirSync(lockPath, { recursive: false, mode: 0o700 });
  fs.writeFileSync(
    path.join(lockPath, "owner.json"),
    JSON.stringify(metadata),
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  return lockPath;
}

function ageReplayLock(lockPath, timestamp) {
  const ownerPath = path.join(lockPath, "owner.json");
  if (fs.existsSync(ownerPath)) fs.utimesSync(ownerPath, timestamp, timestamp);
  fs.utimesSync(lockPath, timestamp, timestamp);
}

function processKillWithDeadPid(deadPid, calls = []) {
  return (pid, signal) => {
    calls.push(pid);
    if (pid === deadPid) {
      const error = new Error("process_not_found");
      error.code = "ESRCH";
      throw error;
    }
    return process.kill(pid, signal);
  };
}

function consumeReplayInFreshProcess({
  filePath,
  tenantId,
  nonce,
  nowMs,
  expiresAt,
}) {
  const modulePath = require.resolve("../lib/nyra-deep-branch-v2-federation");
  const script = `
    const { createPersistentReplayGuard } = require(process.argv[1]);
    const [filePath, tenantId, nonce, nowMs, expiresAt] = process.argv.slice(2);
    const guard = createPersistentReplayGuard({
      filePath,
      now: () => Number(nowMs),
    });
    process.stdout.write(String(guard.consume({
      tenantId,
      nonce,
      expiresAt: Number(expiresAt),
    })));
  `;
  const child = spawnSync(process.execPath, [
    "-e",
    script,
    modulePath,
    filePath,
    tenantId,
    nonce,
    String(nowMs),
    String(expiresAt),
  ], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr || "replay_guard_child_failed");
  return child.stdout.trim() === "true";
}

test("persistent replay guard survives restart and stores no raw tenant or nonce", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-v2-replay-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "replay-store.json");
  const nonce = "9".repeat(64);
  const nowMs = Date.now();
  const expiresAt = nowMs + 30_000;
  assert.equal(consumeReplayInFreshProcess({
    filePath,
    tenantId: "codexai",
    nonce,
    nowMs,
    expiresAt,
  }), true);
  const serialized = fs.readFileSync(filePath, "utf8");
  assert.equal(serialized.includes("codexai"), false);
  assert.equal(serialized.includes(nonce), false);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);

  assert.equal(consumeReplayInFreshProcess({
    filePath,
    tenantId: "codexai",
    nonce,
    nowMs,
    expiresAt,
  }), false);
  assert.equal(fs.readFileSync(filePath, "utf8"), serialized);
  assert.deepEqual(
    fs.readdirSync(directory).filter((name) => name !== path.basename(filePath)),
    [],
  );

  fs.writeFileSync(filePath, "{invalid", "utf8");
  const afterRestart = createPersistentReplayGuard({ filePath, now: () => nowMs });
  assert.equal(afterRestart.consume({
    tenantId: "codexai",
    nonce: "8".repeat(64),
    expiresAt,
  }), false);
  assert.equal(fs.readFileSync(filePath, "utf8"), "{invalid");
});

test("persistent replay guard fails closed on an aged lock without verifiable owner metadata", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-v2-replay-crash-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "replay-store.json");
  const lockPath = `${filePath}.lock`;
  const nowMs = Date.now();
  fs.mkdirSync(lockPath, { mode: 0o700 });
  const staleTime = new Date(nowMs - 5_000);
  fs.utimesSync(lockPath, staleTime, staleTime);

  const guard = createPersistentReplayGuard({
    filePath,
    now: () => nowMs,
    lockTtlMs: 1_000,
  });
  assert.equal(guard.consume({
    tenantId: "codexai",
    nonce: "1".repeat(64),
    expiresAt: nowMs + 30_000,
  }), false);
  assert.deepEqual(guard.probe(), { ok: false, ready: false, durable: false });
  assert.equal(fs.existsSync(lockPath), true);
  assert.equal(fs.existsSync(filePath), false);
});

test("persistent replay guard recovers only an aged local lock whose PID is dead", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-v2-replay-stale-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "replay-store.json");
  const nowMs = Date.now();
  const deadPid = 2_000_000_000;
  const lockPath = writeReplayLock(filePath, replayLockMetadata({
    ownerId: "2".repeat(32),
    ownerPid: deadPid,
    acquiredAt: nowMs - 5_000,
    expiresAt: nowMs - 4_000,
  }));
  ageReplayLock(lockPath, new Date(nowMs - 5_000));
  const killCalls = [];

  const guard = createPersistentReplayGuard({
    filePath,
    now: () => nowMs,
    lockTtlMs: 1_000,
    processKill: processKillWithDeadPid(deadPid, killCalls),
  });
  assert.equal(guard.consume({
    tenantId: "codexai",
    nonce: "2".repeat(64),
    expiresAt: nowMs + 30_000,
  }), true);
  assert.ok(killCalls.length >= 2);
  assert.ok(killCalls.every((pid) => pid === deadPid));
  assert.equal(fs.existsSync(lockPath), false);
  assert.deepEqual(
    fs.readdirSync(directory).filter((name) => name !== path.basename(filePath)),
    [],
  );
});

test("persistent replay guard never bypasses an active lease, live PID, or foreign host", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-v2-replay-active-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "replay-store.json");
  const nowMs = Date.now();
  const deadPid = 2_000_000_000;
  const killCalls = [];
  const guard = createPersistentReplayGuard({
    filePath,
    now: () => nowMs,
    lockTtlMs: 1_000,
    processKill: processKillWithDeadPid(deadPid, killCalls),
  });
  const activeLockPath = writeReplayLock(filePath, replayLockMetadata({
    ownerId: "3".repeat(32),
    ownerPid: deadPid,
    acquiredAt: nowMs - 500,
    expiresAt: nowMs + 500,
  }));
  const activeLockBefore = fs.readFileSync(path.join(activeLockPath, "owner.json"), "utf8");
  assert.deepEqual(guard.probe(), { ok: false, ready: false, durable: false });
  assert.equal(guard.consume({
    tenantId: "codexai",
    nonce: "3".repeat(64),
    expiresAt: nowMs + 30_000,
  }), false);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(fs.readFileSync(path.join(activeLockPath, "owner.json"), "utf8"), activeLockBefore);

  fs.rmSync(activeLockPath, { recursive: true, force: false });
  writeReplayLock(filePath, replayLockMetadata({
    ownerId: "4".repeat(32),
    ownerPid: process.pid,
    acquiredAt: nowMs - 5_000,
    expiresAt: nowMs - 4_000,
  }));
  ageReplayLock(activeLockPath, new Date(nowMs - 5_000));
  assert.equal(guard.consume({
    tenantId: "codexai",
    nonce: "4".repeat(64),
    expiresAt: nowMs + 30_000,
  }), false);
  assert.equal(fs.existsSync(filePath), false);

  fs.rmSync(activeLockPath, { recursive: true, force: false });
  writeReplayLock(filePath, replayLockMetadata({
    ownerId: "5".repeat(32),
    ownerPid: deadPid,
    ownerHostHash: "e".repeat(64),
    acquiredAt: nowMs - 5_000,
    expiresAt: nowMs - 4_000,
  }));
  ageReplayLock(activeLockPath, new Date(nowMs - 5_000));
  const callsBeforeForeignLock = killCalls.length;
  assert.equal(guard.consume({
    tenantId: "codexai",
    nonce: "5".repeat(64),
    expiresAt: nowMs + 30_000,
  }), false);
  assert.equal(killCalls.length, callsBeforeForeignLock);
  assert.equal(fs.existsSync(filePath), false);
});

test("persistent replay guard detects an inode replacement during stale recovery", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-v2-replay-inode-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "replay-store.json");
  const lockPath = `${filePath}.lock`;
  const displacedPath = `${lockPath}.displaced-by-test`;
  const nowMs = Date.now();
  const deadPid = 2_000_000_000;
  writeReplayLock(filePath, replayLockMetadata({
    ownerId: "6".repeat(32),
    ownerPid: deadPid,
    acquiredAt: nowMs - 5_000,
    expiresAt: nowMs - 4_000,
  }));
  ageReplayLock(lockPath, new Date(nowMs - 5_000));
  let swapped = false;
  const swappingFs = new Proxy(fs, {
    get(target, property, receiver) {
      if (property === "renameSync") {
        return (source, destination) => {
          if (
            !swapped
            && source === lockPath
            && String(destination).startsWith(`${lockPath}.stale-`)
          ) {
            target.renameSync(lockPath, displacedPath);
            writeReplayLock(filePath, replayLockMetadata({
              ownerId: "7".repeat(32),
              ownerPid: process.pid,
              acquiredAt: nowMs - 5_000,
              expiresAt: nowMs - 4_000,
            }));
            ageReplayLock(lockPath, new Date(nowMs - 5_000));
            swapped = true;
          }
          return target.renameSync(source, destination);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const guard = createPersistentReplayGuard({
    filePath,
    now: () => nowMs,
    lockTtlMs: 1_000,
    fsImpl: swappingFs,
    processKill: processKillWithDeadPid(deadPid),
  });

  assert.equal(guard.consume({
    tenantId: "codexai",
    nonce: "6".repeat(64),
    expiresAt: nowMs + 30_000,
  }), false);
  assert.equal(swapped, true);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8")).owner_id,
    "7".repeat(32),
  );
});

test("persistent replay health probe verifies private atomic fsync writes without consuming a nonce", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-v2-replay-health-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "replay-store.json");
  const nonce = "5".repeat(64);
  const nowMs = Date.now();
  const fsyncKinds = [];
  const lockModes = [];
  const observedFs = new Proxy(fs, {
    get(target, property, receiver) {
      if (property === "fsyncSync") {
        return (descriptor) => {
          fsyncKinds.push(target.fstatSync(descriptor).isDirectory() ? "directory" : "file");
          return target.fsyncSync(descriptor);
        };
      }
      if (property === "linkSync") {
        return (source, destination) => {
          target.linkSync(source, destination);
          lockModes.push(target.statSync(destination).mode & 0o777);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const guard = createPersistentReplayGuard({
    filePath,
    now: () => nowMs,
    fsImpl: observedFs,
  });

  const emptyProbe = guard.probe();
  assert.deepEqual(emptyProbe, { ok: true, ready: true, durable: true });
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(JSON.stringify(emptyProbe).includes(directory), false);
  assert.equal(guard.consume({
    tenantId: "codexai",
    nonce,
    expiresAt: nowMs + 30_000,
  }), true);
  const beforeProbe = fs.readFileSync(filePath, "utf8");
  assert.deepEqual(guard.probe(), { ok: true, ready: true, durable: true });
  assert.equal(fs.readFileSync(filePath, "utf8"), beforeProbe);
  assert.equal(beforeProbe.includes("codexai"), false);
  assert.equal(beforeProbe.includes(nonce), false);
  assert.ok(fsyncKinds.includes("file"));
  assert.ok(fsyncKinds.includes("directory"));
  assert.ok(lockModes.length >= 3);
  assert.ok(lockModes.every((mode) => mode === 0o600));
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);

  fs.writeFileSync(filePath, "{invalid", "utf8");
  assert.deepEqual(guard.probe(), { ok: false, ready: false, durable: false });
  assert.equal(guard.consume({
    tenantId: "codexai",
    nonce: "6".repeat(64),
    expiresAt: nowMs + 30_000,
  }), false);
  assert.equal(fs.readFileSync(filePath, "utf8"), "{invalid");
});

test("persistent replay guard fails closed on permission, symlink, and capacity tampering", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-v2-replay-tamper-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const nowMs = Date.now();
  const expiresAt = nowMs + 30_000;
  const filePath = path.join(directory, "replay-store.json");
  const guard = createPersistentReplayGuard({
    filePath,
    now: () => nowMs,
    maxEntries: 1,
  });
  assert.equal(guard.consume({
    tenantId: "codexai",
    nonce: "8".repeat(64),
    expiresAt,
  }), true);
  const atCapacity = fs.readFileSync(filePath, "utf8");
  assert.deepEqual(guard.probe(), { ok: false, ready: false, durable: true });
  assert.equal(guard.consume({
    tenantId: "codexai",
    nonce: "9".repeat(64),
    expiresAt,
  }), false);
  assert.equal(fs.readFileSync(filePath, "utf8"), atCapacity);

  const overCapacity = JSON.parse(atCapacity);
  overCapacity.entries["a".repeat(64)] = expiresAt;
  fs.writeFileSync(filePath, JSON.stringify(overCapacity), "utf8");
  const overCapacitySerialized = fs.readFileSync(filePath, "utf8");
  assert.deepEqual(guard.probe(), { ok: false, ready: false, durable: false });
  assert.equal(guard.consume({
    tenantId: "codexai",
    nonce: "a".repeat(64),
    expiresAt,
  }), false);
  assert.equal(fs.readFileSync(filePath, "utf8"), overCapacitySerialized);

  fs.writeFileSync(filePath, atCapacity, "utf8");
  fs.chmodSync(filePath, 0o644);
  assert.deepEqual(guard.probe(), { ok: false, ready: false, durable: false });
  assert.equal(fs.readFileSync(filePath, "utf8"), atCapacity);

  const symlinkPath = path.join(directory, "symlink-store.json");
  const symlinkTarget = path.join(directory, "symlink-target.json");
  fs.writeFileSync(symlinkTarget, atCapacity, { encoding: "utf8", mode: 0o600 });
  fs.symlinkSync(symlinkTarget, symlinkPath);
  const symlinkGuard = createPersistentReplayGuard({
    filePath: symlinkPath,
    now: () => nowMs,
  });
  assert.deepEqual(symlinkGuard.probe(), { ok: false, ready: false, durable: false });
  assert.equal(symlinkGuard.consume({
    tenantId: "codexai",
    nonce: "b".repeat(64),
    expiresAt,
  }), false);
  assert.equal(fs.readFileSync(symlinkTarget, "utf8"), atCapacity);
});

test("federation evaluates only Core-opened topology and never leaks contracts", () => {
  const federation = createNyraDeepBranchV2Federation({ env: env() });
  assert.equal(federation.authenticate(serviceKey).ok, true);
  const result = federation.evaluate(envelope());
  assert.equal(result.ok, true);
  assert.equal(result.state, "shadow_v1_authoritative");
  assert.equal(result.execution_authorized, false);
  assert.equal(result.core_final_authority, true);
  assert.equal(result.validation.shard_count, loaded.manifest.shards.length);
  assert.equal(result.validation.unchecked_shards, 0);
  assert.deepEqual(result.selected_branches.map((branch) => branch.id), branchAllowlist);
  assert.equal(result.evaluation.state, "not_requested_core_evidence_contract_unavailable");
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("input_schema"), false);
  assert.equal(serialized.includes("semantic_contract"), false);
  assert.equal(serialized.includes("method_program"), false);
});

test("federation accepts the combined SkinHarmony entitlement for all vertical branches", () => {
  const verticalBranches = ["suite_domain", "smartdesk_domain", "analyzer_domain"];
  const federation = createNyraDeepBranchV2Federation({
    env: env({
      NYRA_DEEP_BRANCH_V2_BRANCHES: verticalBranches.join(","),
    }),
  });
  const result = federation.evaluate(envelope({
    entitlement_domain_pack: "skinharmony",
    opened_branch_ids: verticalBranches,
    branch_allowlist: verticalBranches,
    nonce: "c".repeat(64),
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.selected_branches.map((branch) => branch.id),
    verticalBranches,
  );
  assert.equal(result.execution_authorized, false);
});

test("federation rejects a replayed or tampered Core envelope", () => {
  const federation = createNyraDeepBranchV2Federation({ env: env() });
  const original = envelope();
  assert.equal(federation.evaluate(original).ok, true);
  const replay = federation.evaluate(original);
  assert.equal(replay.ok, false);
  assert.equal(replay.error, "nyra_deep_branch_v2_envelope_replayed");

  const tampered = envelope({ nonce: "c".repeat(64), tenant_id: "tenant_other" });
  tampered.signature = signCoreEnvelope(tampered, serviceKey);
  const rejected = federation.evaluate(tampered);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, "nyra_deep_branch_v2_tenant_denied");
});

test("federation is an immediate V1 fallback when its own gate is off", () => {
  const federation = createNyraDeepBranchV2Federation({
    env: env({ NYRA_DEEP_BRANCH_V2_FEDERATION_ENABLED: "false" }),
  });
  const result = federation.evaluate(envelope());
  assert.equal(result.ok, true);
  assert.equal(result.state, "federation_disabled_v1_authoritative");
  assert.equal(result.execution_authorized, false);
  assert.deepEqual(result.selected_branches, []);
});

test("federation requires an explicit tenant federation allowlist and a signed envelope subset", () => {
  const unscoped = createNyraDeepBranchV2Federation({
    env: env({ NYRA_DEEP_BRANCH_V2_FEDERATION_TENANT_ALLOWLIST: "" }),
  });
  assert.equal(unscoped.evaluate(envelope()).state, "federation_disabled_v1_authoritative");

  const federation = createNyraDeepBranchV2Federation({ env: env() });
  const invalid = envelope({
    opened_branch_ids: ["context_intelligence", "research_evidence"],
    branch_allowlist: ["context_intelligence"],
    nonce: "f".repeat(64),
  });
  invalid.signature = signCoreEnvelope(invalid, serviceKey);
  const rejected = federation.evaluate(invalid);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, "nyra_deep_branch_v2_envelope_opened_branch_not_allowlisted");

  const now = Date.now();
  const invertedTtl = envelope({
    nonce: "a".repeat(63) + "b",
    issued_at: new Date(now + 10_000).toISOString(),
    expires_at: new Date(now + 5_000).toISOString(),
  });
  invertedTtl.signature = signCoreEnvelope(invertedTtl, serviceKey);
  const temporalResult = createNyraDeepBranchV2Federation({ env: env() }).evaluate(invertedTtl);
  assert.equal(temporalResult.ok, false);
  assert.equal(temporalResult.error, "nyra_deep_branch_v2_envelope_expired");
});

test("federation evaluates an Ed25519-attested exact six-node lineage without leaking opaque Core context", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const { coreEnvelope, lineage } = operationalFixture({ privateKey });
  const federation = createNyraDeepBranchV2Federation({ env: operationalEnv(publicKey) });
  const result = federation.evaluate(coreEnvelope);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state, "operational_advisory_verified_v1_authoritative");
  assert.equal(result.execution_authorized, false);
  assert.equal(result.core_final_authority, true);
  assert.deepEqual(result.selected_branches, []);
  assert.equal(result.evaluation.schema_version, EVALUATION_RESPONSE_SCHEMA_VERSION);
  assert.equal(result.evaluation.state, "operational_advisory_verified");
  assert.equal(result.evaluation.evaluated_node_count, 6);
  assert.equal(result.evaluation.all_nodes_verified, true);
  assert.deepEqual(result.evaluation.lineage.nodes.map((node) => node.node_id), lineage.map((node) => node.node_id));
  assert(result.evaluation.lineage.nodes.every((node) => node.state === "advisory_verified"));

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "opaque_payload",
    "capability_input",
    "evidence_manifest",
    "policy_decisions",
    "semantic_observation",
    "problem_statement",
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);

  const replay = federation.evaluate(coreEnvelope);
  assert.equal(replay.ok, false);
  assert.equal(replay.error, "nyra_deep_branch_v2_envelope_replayed");

  const attestationReplay = structuredClone(coreEnvelope);
  attestationReplay.request_id = "federation-test-request-2";
  attestationReplay.nonce = "f".repeat(64);
  attestationReplay.operational_attestation.request_id = attestationReplay.request_id;
  attestationReplay.operational_attestation.envelope_binding_hash = coreEnvelopeBindingHash(attestationReplay);
  attestationReplay.operational_attestation.signature = signEvaluationAttestation(
    attestationReplay.operational_attestation,
    privateKey
  );
  attestationReplay.signature = signCoreEnvelope(attestationReplay, serviceKey);
  const attestationReplayResult = federation.evaluate(attestationReplay);
  assert.equal(attestationReplayResult.ok, false);
  assert.equal(attestationReplayResult.error, "nyra_deep_branch_v2_operational_attestation_replayed");
});

test("federation rejects a signed tamper or signed cross-branch operational attestation", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const valid = operationalFixture({ privateKey });
  const tampered = structuredClone(valid.coreEnvelope);
  tampered.operational_attestation.node_contexts[0].opaque_payload = `${tampered.operational_attestation.node_contexts[0].opaque_payload}A`;
  tampered.signature = signCoreEnvelope(tampered, serviceKey);
  const tamperResult = createNyraDeepBranchV2Federation({ env: operationalEnv(publicKey) }).evaluate(tampered);
  assert.equal(tamperResult.ok, false);
  assert.equal(tamperResult.error, "nyra_deep_branch_v2_operational_attestation_signature_invalid");

  const crossBranch = structuredClone(valid.coreEnvelope);
  crossBranch.opened_branch_ids = ["research_evidence"];
  crossBranch.branch_allowlist = ["research_evidence"];
  crossBranch.operational_attestation.branch_id = "research_evidence";
  crossBranch.operational_attestation.envelope_binding_hash = coreEnvelopeBindingHash(crossBranch);
  crossBranch.operational_attestation.signature = signEvaluationAttestation(crossBranch.operational_attestation, privateKey);
  crossBranch.signature = signCoreEnvelope(crossBranch, serviceKey);
  const crossBranchResult = createNyraDeepBranchV2Federation({ env: operationalEnv(publicKey) }).evaluate(crossBranch);
  assert.equal(crossBranchResult.ok, false);
  assert.match(crossBranchResult.error, /^nyra_deep_branch_v2_operational_(shard_rejected|lineage_binding_invalid)$/);
});
