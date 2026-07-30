"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  featureFlags,
  loadCatalog,
  loadRuntimeShard,
  route,
} = require("./nyra-deep-branch-v2");

const ENVELOPE_SCHEMA_VERSION = "nyra_deep_branch_v2_core_envelope_v1";
const RESPONSE_SCHEMA_VERSION = "nyra_deep_branch_v2_federation_response_v1";
const OPERATIONAL_ATTESTATION_SCHEMA_VERSION = "nyra_deep_branch_v2_operational_attestation_v1";
const OPAQUE_NODE_CONTEXT_SCHEMA_VERSION = "nyra_deep_branch_v2_opaque_node_context_v1";
const EVALUATION_ATTESTATION_SCHEMA_VERSION = OPERATIONAL_ATTESTATION_SCHEMA_VERSION;
const EVALUATION_RESPONSE_SCHEMA_VERSION = "nyra_deep_branch_v2_operational_evaluation_response_v1";
const ENVELOPE_ISSUER = "skinharmony-universal-core";
const ENVELOPE_AUDIENCE = "skinharmony-nyra-core";
const MAX_ENVELOPE_AGE_MS = 60_000;
const MAX_FUTURE_SKEW_MS = 15_000;
const MAX_BRANCHES = 64;
const MAX_REPLAY_NONCES = 2_048;
const MAX_REPLAY_STORE_BYTES = 512 * 1024;
const MAX_REPLAY_LOCK_BYTES = 4 * 1024;
const DEFAULT_REPLAY_LOCK_TTL_MS = 30_000;
const MAX_REPLAY_LOCK_TTL_MS = 5 * 60_000;
const REPLAY_STORE_SCHEMA_VERSION = "nyra_deep_branch_v2_replay_store_v1";
const REPLAY_LOCK_SCHEMA_VERSION = "nyra_deep_branch_v2_replay_lock_v1";
const MAX_OPAQUE_NODE_CONTEXT_BYTES = 64 * 1024;
const MAX_OPAQUE_CONTEXT_TOTAL_BYTES = 384 * 1024;
const ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const NODE_ID_PATTERN = /^[a-z][a-z0-9_.-]{2,384}$/;
const KEY_ID_PATTERN = /^[a-z][a-z0-9_.-]{1,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,160}$/;
const NONCE_PATTERN = /^[a-f0-9]{32,128}$/i;
const LOCK_OWNER_PATTERN = /^[a-f0-9]{32}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const NYRA_DEEP_V2_CATALOG_SCOPE = "skinharmony";
const NYRA_DEEP_V2_ENTITLEMENT_PACKS = new Set([
  "generic",
  "suite",
  "smartdesk",
  "analyzer",
  "skinharmony",
]);
const NYRA_DEEP_V2_DOMAIN_BRANCH_PACK = Object.freeze({
  suite_domain: "suite",
  smartdesk_domain: "smartdesk",
  analyzer_domain: "analyzer",
});
const OPAQUE_CONTEXT_FORBIDDEN_KEYS = new Set([
  "raw_text",
  "raw_evidence",
  "raw_message",
  "message",
  "messages",
  "prompt",
  "system_prompt",
  "user_prompt",
  "source_text",
  "original_text",
  "chat_history",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function branchAllowedForEntitlement(branchId, entitlementDomainPack) {
  const requiredPack = NYRA_DEEP_V2_DOMAIN_BRANCH_PACK[String(branchId || "")];
  return !requiredPack
    || entitlementDomainPack === NYRA_DEEP_V2_CATALOG_SCOPE
    || requiredPack === entitlementDomainPack;
}

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!isPlainObject(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableCanonical(value[key]);
    return result;
  }, {});
}

function canonicalJson(value) {
  return JSON.stringify(stableCanonical(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalHash(value) {
  return sha256(canonicalJson(value));
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function parseList(value, maxItems = MAX_BRANCHES) {
  const seen = new Set();
  return String(value || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item) || seen.size >= maxItems) return false;
      seen.add(item);
      return true;
    });
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function envelopePayload(envelope = {}) {
  const { signature: _signature, ...payload } = envelope;
  return payload;
}

function envelopeBindingPayload(envelope = {}) {
  const {
    signature: _signature,
    operational_attestation: _operationalAttestation,
    ...payload
  } = envelope;
  return payload;
}

function coreEnvelopeBindingHash(envelope = {}) {
  return sha256(canonicalJson(envelopeBindingPayload(envelope)));
}

function signCoreEnvelope(envelope, sharedSecret) {
  if (!sharedSecret) throw new Error("nyra_deep_branch_v2_shared_secret_required");
  return crypto
    .createHmac("sha256", String(sharedSecret))
    .update(`nyra-deep-branch-v2-envelope\u0000${canonicalJson(envelopePayload(envelope))}`)
    .digest("hex");
}

function operationalAttestationPayload(attestation = {}) {
  const { signature: _signature, ...payload } = attestation;
  return payload;
}

function signOperationalEvaluationAttestation(attestation, privateKey) {
  if (!privateKey) throw new Error("nyra_deep_branch_v2_operational_private_key_required");
  return crypto
    .sign(
      null,
      Buffer.from(
        `nyra-deep-branch-v2-operational-attestation\u0000${canonicalJson(operationalAttestationPayload(attestation))}`,
        "utf8"
      ),
      privateKey
    )
    .toString("base64url");
}

function verifyOperationalEvaluationAttestation(attestation, publicKey) {
  if (!publicKey || !BASE64URL_PATTERN.test(String(attestation?.signature || ""))) return false;
  try {
    return crypto.verify(
      null,
      Buffer.from(
        `nyra-deep-branch-v2-operational-attestation\u0000${canonicalJson(operationalAttestationPayload(attestation))}`,
        "utf8"
      ),
      publicKey,
      Buffer.from(String(attestation.signature), "base64url")
    );
  } catch {
    return false;
  }
}

const signEvaluationAttestation = signOperationalEvaluationAttestation;
const verifyEvaluationAttestation = verifyOperationalEvaluationAttestation;

function encodeOpaqueNodeContext(payload) {
  const raw = Buffer.from(canonicalJson(payload), "utf8");
  const encoded = raw.toString("base64url");
  return {
    payload_encoding: "base64url_canonical_json",
    payload_sha256: sha256Bytes(raw),
    opaque_payload: encoded,
  };
}

function createReplayGuard({ now = () => Date.now(), maxEntries = MAX_REPLAY_NONCES } = {}) {
  const seen = new Map();

  function purge(nowMs) {
    for (const [key, expiresAt] of seen) {
      if (expiresAt <= nowMs) seen.delete(key);
    }
    while (seen.size > maxEntries) seen.delete(seen.keys().next().value);
  }

  return {
    consume({ tenantId, nonce, expiresAt, scope = "envelope" }) {
      const nowMs = now();
      purge(nowMs);
      const key = `${scope}:${tenantId}:${nonce}`;
      if (seen.has(key)) return false;
      seen.set(key, expiresAt);
      purge(nowMs);
      return true;
    },
  };
}

function createPersistentReplayGuard({
  filePath,
  now = () => Date.now(),
  maxEntries = MAX_REPLAY_NONCES,
  lockTtlMs = DEFAULT_REPLAY_LOCK_TTL_MS,
  fsImpl = fs,
  processKill = process.kill.bind(process),
} = {}) {
  const resolvedPath = path.resolve(String(filePath || ""));
  if (!String(filePath || "").trim() || resolvedPath === path.parse(resolvedPath).root) {
    throw new TypeError("nyra_deep_branch_v2_replay_store_path_invalid");
  }
  const requestedCapacity = Number(maxEntries);
  const capacity = Number.isSafeInteger(requestedCapacity) && requestedCapacity > 0
    ? Math.min(MAX_REPLAY_NONCES, requestedCapacity)
    : MAX_REPLAY_NONCES;
  const requestedLockTtl = Number(lockTtlMs);
  const lockTtl = Math.max(
    1_000,
    Math.min(
      MAX_REPLAY_LOCK_TTL_MS,
      Number.isSafeInteger(requestedLockTtl) && requestedLockTtl > 0
        ? requestedLockTtl
        : DEFAULT_REPLAY_LOCK_TTL_MS,
    ),
  );
  const parentPath = path.dirname(resolvedPath);
  const lockPath = `${resolvedPath}.lock`;
  const ownerHostHash = sha256(os.hostname());

  function replayStoreError(code = "nyra_deep_branch_v2_replay_store_unavailable") {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function syncDirectory(directoryPath) {
    let directoryFd = null;
    try {
      directoryFd = fsImpl.openSync(directoryPath, "r");
      fsImpl.fsyncSync(directoryFd);
    } finally {
      if (directoryFd !== null) fsImpl.closeSync(directoryFd);
    }
  }

  function ensureParentDirectory() {
    fsImpl.mkdirSync(parentPath, { recursive: true, mode: 0o700 });
    const parentStat = fsImpl.lstatSync(parentPath);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw replayStoreError("nyra_deep_branch_v2_replay_store_invalid");
    }
  }

  function readBoundedFile(targetPath, maximumBytes) {
    let descriptor = null;
    try {
      const linkStat = fsImpl.lstatSync(targetPath);
      if (
        !linkStat.isFile()
        || linkStat.isSymbolicLink()
        || linkStat.size > maximumBytes
        || (linkStat.mode & 0o077) !== 0
      ) {
        throw replayStoreError("nyra_deep_branch_v2_replay_store_invalid");
      }
      const noFollow = Number(fsImpl.constants?.O_NOFOLLOW || 0);
      const readOnly = Number(fsImpl.constants?.O_RDONLY || 0);
      descriptor = fsImpl.openSync(targetPath, readOnly | noFollow);
      const descriptorStat = fsImpl.fstatSync(descriptor);
      if (
        !descriptorStat.isFile()
        || descriptorStat.size > maximumBytes
        || (descriptorStat.mode & 0o077) !== 0
        || (linkStat.dev !== descriptorStat.dev || linkStat.ino !== descriptorStat.ino)
      ) {
        throw replayStoreError("nyra_deep_branch_v2_replay_store_invalid");
      }
      const serialized = fsImpl.readFileSync(descriptor, "utf8");
      const finalStat = fsImpl.fstatSync(descriptor);
      if (
        descriptorStat.dev !== finalStat.dev
        || descriptorStat.ino !== finalStat.ino
        || descriptorStat.size !== finalStat.size
        || Buffer.byteLength(serialized, "utf8") !== finalStat.size
        || finalStat.size > maximumBytes
      ) {
        throw replayStoreError("nyra_deep_branch_v2_replay_store_invalid");
      }
      return { serialized, stat: finalStat };
    } finally {
      if (descriptor !== null) fsImpl.closeSync(descriptor);
    }
  }

  function readEntries() {
    try {
      fsImpl.lstatSync(resolvedPath);
    } catch (error) {
      if (error?.code === "ENOENT") return {};
      throw error;
    }
    const { serialized } = readBoundedFile(resolvedPath, MAX_REPLAY_STORE_BYTES);
    let parsed;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      throw replayStoreError("nyra_deep_branch_v2_replay_store_invalid");
    }
    if (
      !isPlainObject(parsed)
      || parsed.schema_version !== REPLAY_STORE_SCHEMA_VERSION
      || !isPlainObject(parsed.entries)
      || Object.keys(parsed).some((key) => !["schema_version", "entries"].includes(key))
    ) throw replayStoreError("nyra_deep_branch_v2_replay_store_invalid");
    if (Object.keys(parsed.entries).length > capacity) {
      throw replayStoreError("nyra_deep_branch_v2_replay_store_invalid");
    }
    const entries = Object.create(null);
    for (const [key, expiresAt] of Object.entries(parsed.entries)) {
      if (
        !SHA256_PATTERN.test(key)
        || !Number.isSafeInteger(expiresAt)
        || expiresAt <= 0
      ) {
        throw replayStoreError("nyra_deep_branch_v2_replay_store_invalid");
      }
      entries[key] = expiresAt;
    }
    return entries;
  }

  function writeEntries(entries) {
    if (!isPlainObject(entries) || Object.keys(entries).length > capacity) {
      throw replayStoreError("nyra_deep_branch_v2_replay_store_capacity_exceeded");
    }
    for (const [key, expiresAt] of Object.entries(entries)) {
      if (!SHA256_PATTERN.test(key) || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
        throw replayStoreError("nyra_deep_branch_v2_replay_store_invalid");
      }
    }
    const serialized = JSON.stringify({
      schema_version: REPLAY_STORE_SCHEMA_VERSION,
      entries,
    });
    if (Buffer.byteLength(serialized, "utf8") > MAX_REPLAY_STORE_BYTES) {
      throw replayStoreError("nyra_deep_branch_v2_replay_store_capacity_exceeded");
    }
    ensureParentDirectory();
    const temporaryPath = `${resolvedPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let temporaryFd = null;
    let renamed = false;
    try {
      temporaryFd = fsImpl.openSync(temporaryPath, "wx", 0o600);
      fsImpl.writeFileSync(temporaryFd, serialized, "utf8");
      fsImpl.fchmodSync(temporaryFd, 0o600);
      fsImpl.fsyncSync(temporaryFd);
      fsImpl.closeSync(temporaryFd);
      temporaryFd = null;
      fsImpl.renameSync(temporaryPath, resolvedPath);
      renamed = true;
      const finalStat = fsImpl.lstatSync(resolvedPath);
      if (
        !finalStat.isFile()
        || finalStat.isSymbolicLink()
        || (finalStat.mode & 0o077) !== 0
      ) {
        throw replayStoreError("nyra_deep_branch_v2_replay_store_invalid");
      }
      syncDirectory(parentPath);
    } finally {
      if (temporaryFd !== null) {
        try { fsImpl.closeSync(temporaryFd); } catch {}
      }
      if (!renamed) {
        try { fsImpl.unlinkSync(temporaryPath); } catch {}
      }
    }
  }

  function lockMetadata(ownerId, nowMs) {
    return {
      schema_version: REPLAY_LOCK_SCHEMA_VERSION,
      owner_id: ownerId,
      owner_pid: process.pid,
      owner_host_hash: ownerHostHash,
      acquired_at: nowMs,
      expires_at: nowMs + lockTtl,
    };
  }

  function parseLockMetadata(value) {
    const expectedKeys = new Set([
      "schema_version",
      "owner_id",
      "owner_pid",
      "owner_host_hash",
      "acquired_at",
      "expires_at",
    ]);
    if (
      !isPlainObject(value)
      || value.schema_version !== REPLAY_LOCK_SCHEMA_VERSION
      || Object.keys(value).some((key) => !expectedKeys.has(key))
      || !LOCK_OWNER_PATTERN.test(String(value.owner_id || ""))
      || !Number.isSafeInteger(value.owner_pid)
      || value.owner_pid <= 0
      || value.owner_pid > 0x7fffffff
      || !SHA256_PATTERN.test(String(value.owner_host_hash || ""))
      || !Number.isSafeInteger(value.acquired_at)
      || value.acquired_at < 0
      || !Number.isSafeInteger(value.expires_at)
      || value.expires_at <= value.acquired_at
      || value.expires_at - value.acquired_at < 1_000
      || value.expires_at - value.acquired_at > MAX_REPLAY_LOCK_TTL_MS
    ) return null;
    return value;
  }

  function readLockSnapshot(targetPath = lockPath) {
    const lockStat = fsImpl.lstatSync(targetPath);
    let serialized = "";
    let metadataStat = null;
    let metadata = null;
    const privateLock = (lockStat.mode & 0o077) === 0;
    if (lockStat.isDirectory() && !lockStat.isSymbolicLink() && privateLock) {
      try {
        const read = readBoundedFile(
          path.join(targetPath, "owner.json"),
          MAX_REPLAY_LOCK_BYTES,
        );
        serialized = read.serialized;
        metadataStat = read.stat;
        metadata = parseLockMetadata(JSON.parse(serialized));
      } catch (error) {
        if (
          error?.code !== "ENOENT"
          && error?.code !== "nyra_deep_branch_v2_replay_store_invalid"
          && !(error instanceof SyntaxError)
        ) throw error;
      }
    } else if (
      lockStat.isFile()
      && !lockStat.isSymbolicLink()
      && privateLock
      && lockStat.size <= MAX_REPLAY_LOCK_BYTES
    ) {
      try {
        const read = readBoundedFile(targetPath, MAX_REPLAY_LOCK_BYTES);
        serialized = read.serialized;
        metadataStat = read.stat;
        metadata = parseLockMetadata(JSON.parse(serialized));
      } catch (error) {
        if (
          error?.code !== "nyra_deep_branch_v2_replay_store_invalid"
          && !(error instanceof SyntaxError)
        ) throw error;
      }
    }
    const identity = sha256(canonicalJson({
      device: String(lockStat.dev),
      inode: String(lockStat.ino),
      metadata_device: metadataStat ? String(metadataStat.dev) : "",
      metadata_inode: metadataStat ? String(metadataStat.ino) : "",
      modified_at: Number(lockStat.mtimeMs),
      metadata_modified_at: metadataStat ? Number(metadataStat.mtimeMs) : null,
      size: Number(lockStat.size),
      serialized_hash: sha256(serialized),
    }));
    return {
      device: String(lockStat.dev),
      identity,
      inode: String(lockStat.ino),
      is_directory: lockStat.isDirectory(),
      metadata,
      modified_at: Math.max(
        Number(lockStat.mtimeMs),
        metadataStat ? Number(metadataStat.mtimeMs) : 0,
      ),
    };
  }

  function sameLockIdentity(left, right) {
    return Boolean(left)
      && Boolean(right)
      && left.device === right.device
      && left.inode === right.inode
      && left.identity === right.identity;
  }

  function ownerProcessIsDead(metadata) {
    if (!metadata || metadata.owner_host_hash !== ownerHostHash) return false;
    try {
      processKill(metadata.owner_pid, 0);
      return false;
    } catch (error) {
      return error?.code === "ESRCH";
    }
  }

  function lockRecoveryIsSafe(snapshot, nowMs) {
    if (
      !snapshot?.metadata
      || snapshot.metadata.owner_host_hash !== ownerHostHash
      || !Number.isFinite(snapshot.modified_at)
      || snapshot.metadata.expires_at > nowMs
      || nowMs - snapshot.metadata.acquired_at < lockTtl
      || nowMs - snapshot.modified_at < lockTtl
    ) return false;
    return ownerProcessIsDead(snapshot.metadata);
  }

  function restoreMovedLock(movedPath) {
    try {
      fsImpl.renameSync(movedPath, lockPath);
      syncDirectory(parentPath);
      return true;
    } catch {
      return false;
    }
  }

  function retireLockIfUnchanged(expected, label) {
    const movedPath = `${lockPath}.${label}-${crypto.randomUUID()}`;
    try {
      const current = readLockSnapshot();
      if (!sameLockIdentity(current, expected)) return false;
      fsImpl.renameSync(lockPath, movedPath);
      let moved;
      try {
        moved = readLockSnapshot(movedPath);
      } catch {
        restoreMovedLock(movedPath);
        return false;
      }
      if (!sameLockIdentity(moved, expected)) {
        restoreMovedLock(movedPath);
        return false;
      }
      syncDirectory(parentPath);
      if (moved.is_directory) {
        fsImpl.rmSync(movedPath, { recursive: true, force: false });
      } else {
        fsImpl.unlinkSync(movedPath);
      }
      syncDirectory(parentPath);
      return true;
    } catch (error) {
      if (["EEXIST", "ENOENT", "ENOTEMPTY"].includes(error?.code)) return false;
      throw error;
    }
  }

  function recoverStaleLock(snapshot, nowMs) {
    if (!lockRecoveryIsSafe(snapshot, nowMs)) return false;
    const current = readLockSnapshot();
    if (
      !sameLockIdentity(current, snapshot)
      || !lockRecoveryIsSafe(current, nowMs)
    ) return false;
    return retireLockIfUnchanged(current, "stale");
  }

  function tryCreateLock(nowMs) {
    const ownerId = crypto.randomBytes(16).toString("hex");
    const candidatePath = `${lockPath}.candidate-${process.pid}-${ownerId}`;
    let candidateFd = null;
    let candidateExists = false;
    let linked = false;
    let candidateSnapshot = null;
    try {
      candidateFd = fsImpl.openSync(candidatePath, "wx", 0o600);
      candidateExists = true;
      fsImpl.writeFileSync(
        candidateFd,
        JSON.stringify(lockMetadata(ownerId, nowMs)),
        "utf8",
      );
      fsImpl.fchmodSync(candidateFd, 0o600);
      fsImpl.fsyncSync(candidateFd);
      fsImpl.closeSync(candidateFd);
      candidateFd = null;
      candidateSnapshot = readLockSnapshot(candidatePath);
      if (candidateSnapshot.metadata?.owner_id !== ownerId) {
        throw replayStoreError("nyra_deep_branch_v2_replay_lock_invalid");
      }
      try {
        fsImpl.linkSync(candidatePath, lockPath);
        linked = true;
      } catch (error) {
        if (error?.code === "EEXIST") return { contended: true, lock: null };
        throw error;
      }
      const installed = readLockSnapshot();
      if (
        !sameLockIdentity(installed, candidateSnapshot)
        || installed.metadata?.owner_id !== ownerId
      ) {
        throw replayStoreError("nyra_deep_branch_v2_replay_lock_invalid");
      }
      fsImpl.unlinkSync(candidatePath);
      candidateExists = false;
      syncDirectory(parentPath);
      return {
        contended: false,
        lock: {
          owner_id: ownerId,
          snapshot: installed,
        },
      };
    } catch (error) {
      if (linked && candidateSnapshot) {
        try { retireLockIfUnchanged(candidateSnapshot, "aborted"); } catch {}
      }
      throw error;
    } finally {
      if (candidateFd !== null) {
        try { fsImpl.closeSync(candidateFd); } catch {}
      }
      if (candidateExists) {
        try { fsImpl.unlinkSync(candidatePath); } catch {}
      }
    }
  }

  function acquireLock(nowMs) {
    ensureParentDirectory();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const created = tryCreateLock(nowMs);
      if (created.lock) return created.lock;
      if (created.contended) {
        let snapshot;
        try {
          snapshot = readLockSnapshot();
        } catch (snapshotError) {
          if (snapshotError?.code === "ENOENT") continue;
          throw snapshotError;
        }
        if (!recoverStaleLock(snapshot, nowMs)) return null;
      }
    }
    return null;
  }

  function releaseLock(lock) {
    if (!lock) return true;
    try {
      const snapshot = readLockSnapshot();
      if (
        snapshot.metadata?.owner_id !== lock.owner_id
        || !sameLockIdentity(snapshot, lock.snapshot)
      ) return false;
      return retireLockIfUnchanged(snapshot, `released-${lock.owner_id}`);
    } catch {
      return false;
    }
  }

  function probeWritability() {
    const probePrefix = `${resolvedPath}.${process.pid}.${crypto.randomUUID()}.probe`;
    const createdPath = `${probePrefix}.new`;
    const renamedPath = `${probePrefix}.ready`;
    let probeFd = null;
    let currentPath = null;
    try {
      probeFd = fsImpl.openSync(createdPath, "wx", 0o600);
      currentPath = createdPath;
      fsImpl.writeFileSync(probeFd, `${REPLAY_STORE_SCHEMA_VERSION}\n`, "utf8");
      fsImpl.fchmodSync(probeFd, 0o600);
      fsImpl.fsyncSync(probeFd);
      fsImpl.closeSync(probeFd);
      probeFd = null;
      fsImpl.renameSync(createdPath, renamedPath);
      currentPath = renamedPath;
      syncDirectory(parentPath);
      fsImpl.unlinkSync(renamedPath);
      currentPath = null;
      syncDirectory(parentPath);
      return true;
    } finally {
      if (probeFd !== null) {
        try { fsImpl.closeSync(probeFd); } catch {}
      }
      if (currentPath) {
        try { fsImpl.unlinkSync(currentPath); } catch {}
      }
    }
  }

  return {
    consume({ tenantId, nonce, expiresAt, scope = "envelope" }) {
      let lock = null;
      let accepted = false;
      try {
        const nowMs = Number(now());
        const expiry = Number(expiresAt);
        if (
          !Number.isSafeInteger(nowMs)
          || !Number.isSafeInteger(expiry)
          || expiry <= nowMs
          || !ID_PATTERN.test(String(tenantId || ""))
          || !NONCE_PATTERN.test(String(nonce || ""))
          || !/^[a-z][a-z0-9_-]{1,63}$/.test(String(scope || ""))
        ) return false;
        lock = acquireLock(nowMs);
        if (!lock) return false;
        const entries = readEntries();
        for (const [key, storedExpiry] of Object.entries(entries)) {
          if (storedExpiry <= nowMs) delete entries[key];
        }
        const replayKey = crypto
          .createHash("sha256")
          .update(`${scope}\u0000${tenantId}\u0000${nonce}`)
          .digest("hex");
        if (Object.prototype.hasOwnProperty.call(entries, replayKey)) return false;
        if (Object.keys(entries).length >= capacity) return false;
        entries[replayKey] = expiry;
        writeEntries(entries);
        accepted = true;
      } catch {
        accepted = false;
      } finally {
        if (lock && !releaseLock(lock)) accepted = false;
      }
      return accepted;
    },
    probe() {
      let lock = null;
      let ready = false;
      let durable = false;
      try {
        const nowMs = Number(now());
        if (!Number.isSafeInteger(nowMs)) {
          throw replayStoreError("nyra_deep_branch_v2_replay_store_invalid");
        }
        lock = acquireLock(nowMs);
        if (!lock) throw replayStoreError("nyra_deep_branch_v2_replay_store_locked");
        const entries = readEntries();
        ready = Object.values(entries)
          .filter((expiresAt) => expiresAt > nowMs)
          .length < capacity;
        durable = probeWritability();
      } catch {
        ready = false;
        durable = false;
      } finally {
        if (lock && !releaseLock(lock)) {
          ready = false;
          durable = false;
        }
      }
      return {
        ok: ready && durable,
        ready,
        durable,
      };
    },
  };
}

function federationConfig(env = process.env) {
  const rawPublicKeys = String(env.NYRA_DEEP_BRANCH_V2_CORE_ATTESTATION_PUBLIC_KEYS || "").trim();
  let operationalPublicKeys = {};
  try {
    const parsed = rawPublicKeys ? JSON.parse(rawPublicKeys) : {};
    if (isPlainObject(parsed)) {
      operationalPublicKeys = Object.fromEntries(
        Object.entries(parsed)
          .filter(([keyId, publicKey]) => KEY_ID_PATTERN.test(String(keyId))
            && typeof publicKey === "string"
            && publicKey.length > 0
            && publicKey.length <= 16 * 1024)
      );
    }
  } catch {
    operationalPublicKeys = {};
  }
  return {
    enabled: truthy(env.NYRA_DEEP_BRANCH_V2_FEDERATION_ENABLED),
    shared_secret: String(env.NYRA_DEEP_BRANCH_V2_CORE_SHARED_SECRET || "").trim(),
    // Federation must be explicitly scoped. It may not inherit the broader V2 tenant flag.
    tenant_allowlist: parseList(env.NYRA_DEEP_BRANCH_V2_FEDERATION_TENANT_ALLOWLIST),
    maximum_envelope_age_ms: Math.max(
      5_000,
      Math.min(MAX_ENVELOPE_AGE_MS, Number(env.NYRA_DEEP_BRANCH_V2_ENVELOPE_MAX_AGE_MS) || MAX_ENVELOPE_AGE_MS)
    ),
    operational_evaluation_enabled: truthy(env.NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED),
    operational_tenant_allowlist: parseList(env.NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_TENANT_ALLOWLIST),
    operational_key_allowlist: parseList(env.NYRA_DEEP_BRANCH_V2_CORE_ATTESTATION_KEY_ID_ALLOWLIST),
    operational_public_keys: operationalPublicKeys,
    maximum_operational_attestation_age_ms: Math.max(
      5_000,
      Math.min(MAX_ENVELOPE_AGE_MS, Number(env.NYRA_DEEP_BRANCH_V2_OPERATIONAL_ATTESTATION_MAX_AGE_MS) || MAX_ENVELOPE_AGE_MS)
    ),
  };
}

function compactBranch(branch) {
  const subbranches = Array.isArray(branch?.subbranches) ? branch.subbranches : [];
  return {
    id: branch.id,
    label: branch.label,
    work_phase: branch.work_phase,
    subbranch_count: subbranches.length,
    subbranches: subbranches.map((subbranch) => ({
      id: subbranch.id,
      specialized_capability_count: Array.isArray(subbranch.specialized_capabilities)
        ? subbranch.specialized_capabilities.length
        : 0,
    })),
  };
}

function compactValidation(loaded) {
  const validation = loaded?.validation || {};
  const integrity = validation.integrity || {};
  const checkedShards = Number(integrity.checked_shards || 0);
  const uncheckedShards = Number(integrity.unchecked_shards || 0);
  // The low-level integrity report deliberately tracks checked/unchecked
  // descriptors; it does not carry a redundant shard_count field. Expose the
  // exact total in the federation contract so consumers can audit the full
  // lazy runtime without inferring it themselves.
  const shardCount = Number.isFinite(Number(integrity.shard_count))
    ? Number(integrity.shard_count)
    : checkedShards + uncheckedShards;
  return {
    ok: validation.ok === true,
    branch_count: Number(validation.metrics?.branch_count || 0),
    subbranch_count: Number(validation.metrics?.subbranch_count || 0),
    node_count: Number(validation.metrics?.node_count || 0),
    shard_count: shardCount,
    checked_shards: checkedShards,
    unchecked_shards: uncheckedShards,
    errors: Array.isArray(validation.errors) ? validation.errors.slice(0, 12) : [],
  };
}

function v1AuthoritativeResponse({
  tenantId,
  requestId,
  state,
  reason,
  validation,
  envelopeHash,
} = {}) {
  return {
    ok: true,
    schema_version: RESPONSE_SCHEMA_VERSION,
    state,
    mode: "disabled",
    tenant_id: tenantId || null,
    request_id: requestId || null,
    reason: reason || null,
    validation: validation || null,
    selected_branches: [],
    evaluation: {
      state: "not_requested_v1_authoritative",
      evaluated_node_count: 0,
    },
    provenance: envelopeHash ? { envelope_hash: envelopeHash } : undefined,
    execution_authorized: false,
    core_final_authority: true,
    fallback: "nyra_neural_branch_network_v1",
  };
}

function envelopeFailure(code, status = 403) {
  return { ok: false, status, error: code, execution_allowed: false, core_final_authority: true };
}

function validateEnvelope(envelope, config, { now = () => Date.now() } = {}) {
  if (!isPlainObject(envelope)) return envelopeFailure("nyra_deep_branch_v2_envelope_required", 400);
  const required = [
    "schema_version",
    "issuer",
    "audience",
    "tenant_id",
    "request_id",
    "domain_pack",
    "catalog_scope",
    "entitlement_domain_pack",
    "opened_branch_ids",
    "branch_allowlist",
    "preflight_id",
    "core_policy_hash",
    "catalog_fingerprint",
    "root_binding_hash",
    "nonce",
    "issued_at",
    "expires_at",
    "signature",
  ];
  if (required.some((field) => envelope[field] === undefined)) return envelopeFailure("nyra_deep_branch_v2_envelope_fields_required", 400);
  if (Object.keys(envelope).some((field) => !required.includes(field) && field !== "operational_attestation")) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_schema_invalid", 400);
  }
  if (envelope.schema_version !== ENVELOPE_SCHEMA_VERSION) return envelopeFailure("nyra_deep_branch_v2_envelope_schema_invalid", 400);
  if (envelope.issuer !== ENVELOPE_ISSUER || envelope.audience !== ENVELOPE_AUDIENCE) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_audience_invalid");
  }
  if (!ID_PATTERN.test(String(envelope.tenant_id || ""))) return envelopeFailure("nyra_deep_branch_v2_envelope_tenant_invalid", 400);
  if (!REQUEST_ID_PATTERN.test(String(envelope.request_id || ""))) return envelopeFailure("nyra_deep_branch_v2_envelope_request_invalid", 400);
  if (envelope.domain_pack !== NYRA_DEEP_V2_CATALOG_SCOPE
    || envelope.catalog_scope !== NYRA_DEEP_V2_CATALOG_SCOPE
    || envelope.domain_pack !== envelope.catalog_scope) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_catalog_scope_invalid");
  }
  if (!NYRA_DEEP_V2_ENTITLEMENT_PACKS.has(String(envelope.entitlement_domain_pack || ""))) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_entitlement_pack_invalid");
  }
  if (!Array.isArray(envelope.opened_branch_ids) || envelope.opened_branch_ids.length === 0 || envelope.opened_branch_ids.length > MAX_BRANCHES) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_opened_branches_invalid", 400);
  }
  if (!Array.isArray(envelope.branch_allowlist) || envelope.branch_allowlist.length === 0 || envelope.branch_allowlist.length > MAX_BRANCHES) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_branch_allowlist_invalid", 400);
  }
  const opened = envelope.opened_branch_ids.map(String);
  const allowlist = envelope.branch_allowlist.map(String);
  if (opened.some((id) => !ID_PATTERN.test(id)) || allowlist.some((id) => !ID_PATTERN.test(id))) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_branch_id_invalid", 400);
  }
  if (new Set(opened).size !== opened.length || new Set(allowlist).size !== allowlist.length) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_branch_duplicates", 400);
  }
  if (opened.some((id) => !allowlist.includes(id))) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_opened_branch_not_allowlisted");
  }
  if (opened.some((id) => !branchAllowedForEntitlement(id, envelope.entitlement_domain_pack))) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_branch_outside_entitlement_pack");
  }
  if (!SHA256_PATTERN.test(String(envelope.core_policy_hash || ""))
    || !SHA256_PATTERN.test(String(envelope.catalog_fingerprint || ""))
    || !SHA256_PATTERN.test(String(envelope.root_binding_hash || ""))) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_hash_invalid", 400);
  }
  if (!NONCE_PATTERN.test(String(envelope.nonce || ""))) return envelopeFailure("nyra_deep_branch_v2_envelope_nonce_invalid", 400);
  const issuedAt = Date.parse(String(envelope.issued_at || ""));
  const expiresAt = Date.parse(String(envelope.expires_at || ""));
  const nowMs = now();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
    || issuedAt > nowMs + MAX_FUTURE_SKEW_MS
    || expiresAt <= nowMs
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > config.maximum_envelope_age_ms) {
    return envelopeFailure("nyra_deep_branch_v2_envelope_expired");
  }
  if (!config.tenant_allowlist.includes(String(envelope.tenant_id))) {
    return envelopeFailure("nyra_deep_branch_v2_tenant_denied");
  }
  const expectedSignature = signCoreEnvelope(envelope, config.shared_secret);
  if (!safeEqual(expectedSignature, envelope.signature)) return envelopeFailure("nyra_deep_branch_v2_envelope_signature_invalid");
  return {
    ok: true,
    issued_at: issuedAt,
    expires_at: expiresAt,
    envelope_hash: sha256(canonicalJson(envelopePayload(envelope))),
  };
}

function exactKeys(value, expected) {
  return isPlainObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function containsForbiddenOpaqueField(value, depth = 0) {
  if (depth > 24) return true;
  if (typeof value === "string") return Buffer.byteLength(value, "utf8") > 16 * 1024;
  if (Array.isArray(value)) return value.some((item) => containsForbiddenOpaqueField(item, depth + 1));
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, item]) => (
    OPAQUE_CONTEXT_FORBIDDEN_KEYS.has(String(key).toLowerCase())
    || containsForbiddenOpaqueField(item, depth + 1)
  ));
}

function decodeOpaqueNodeContext(context) {
  if (!exactKeys(context, [
    "schema_version",
    "node_id",
    "context_id",
    "payload_encoding",
    "payload_sha256",
    "opaque_payload",
  ])) return envelopeFailure("nyra_deep_branch_v2_opaque_context_schema_invalid", 400);
  if (context.schema_version !== OPAQUE_NODE_CONTEXT_SCHEMA_VERSION
    || !NODE_ID_PATTERN.test(String(context.node_id || ""))
    || !REQUEST_ID_PATTERN.test(String(context.context_id || ""))
    || context.payload_encoding !== "base64url_canonical_json"
    || !SHA256_PATTERN.test(String(context.payload_sha256 || ""))
    || !BASE64URL_PATTERN.test(String(context.opaque_payload || ""))) {
    return envelopeFailure("nyra_deep_branch_v2_opaque_context_fields_invalid", 400);
  }
  if (Buffer.byteLength(String(context.opaque_payload), "utf8") > Math.ceil(MAX_OPAQUE_NODE_CONTEXT_BYTES * 4 / 3)) {
    return envelopeFailure("nyra_deep_branch_v2_opaque_context_too_large", 400);
  }
  let raw;
  let payload;
  try {
    raw = Buffer.from(String(context.opaque_payload), "base64url");
    if (raw.length === 0 || raw.length > MAX_OPAQUE_NODE_CONTEXT_BYTES
      || !safeEqual(sha256Bytes(raw), context.payload_sha256)) {
      return envelopeFailure("nyra_deep_branch_v2_opaque_context_hash_invalid");
    }
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return envelopeFailure("nyra_deep_branch_v2_opaque_context_decode_invalid", 400);
  }
  if (canonicalJson(payload) !== raw.toString("utf8")) {
    return envelopeFailure("nyra_deep_branch_v2_opaque_context_canonical_invalid", 400);
  }
  if (!exactKeys(payload, [
    "node_id",
    "capability_input",
    "evidence",
    "evidence_manifest",
    "policy_decisions",
  ])
    || payload.node_id !== context.node_id
    || !isPlainObject(payload.capability_input)
    || !Array.isArray(payload.evidence)
    || !isPlainObject(payload.evidence_manifest)
    || !Array.isArray(payload.policy_decisions)
    || containsForbiddenOpaqueField(payload)) {
    return envelopeFailure("nyra_deep_branch_v2_opaque_context_payload_invalid", 400);
  }
  return { ok: true, payload, bytes: raw.length };
}

function compactLineageNode(node) {
  return {
    node_id: node.id,
    parent_id: node.parent_id,
    level: node.level,
    node_type: node.node_type,
    function_binding_hash: sha256(canonicalJson(node.function_binding || {})),
    semantic_function_hash: node.function_binding?.semantic_function_hash || null,
  };
}

function operationalLineageFromShard(shard) {
  const nodeIndex = new Map((shard?.nodes || []).map((node) => [node.id, node]));
  const nodeIds = shard?.descriptor?.node_ids || [];
  if (nodeIds.length !== 6 || new Set(nodeIds).size !== 6) return null;
  const nodes = nodeIds.map((nodeId) => nodeIndex.get(nodeId));
  if (nodes.some((node) => !node)) return null;
  const [level2, level3, ...level4] = nodes;
  if (level2.level !== 2 || level2.node_type !== "specialized_capability"
    || level3.level !== 3 || level3.node_type !== "micro_capability"
    || level3.parent_id !== level2.id
    || level4.length !== 4
    || level4.some((node) => node.level !== 4 || node.parent_id !== level3.id)
    || JSON.stringify(level4.map((node) => node.node_type).sort())
      !== JSON.stringify(["method", "metric", "strategy", "verifier"])) {
    return null;
  }
  return nodes.map(compactLineageNode);
}

function validateOperationalEvaluationAttestation({
  attestation,
  envelope,
  envelopeValidation,
  config,
  loaded,
  env = process.env,
  now = () => Date.now(),
} = {}) {
  if (!config?.operational_evaluation_enabled) {
    return envelopeFailure("nyra_deep_branch_v2_operational_evaluation_disabled");
  }
  if (!isPlainObject(attestation)) return envelopeFailure("nyra_deep_branch_v2_operational_attestation_required", 400);
  const required = [
    "schema_version",
    "issuer",
    "audience",
    "key_id",
    "tenant_id",
    "request_id",
    "domain_pack",
    "catalog_scope",
    "entitlement_domain_pack",
    "branch_id",
    "subbranch_id",
    "preflight_id",
    "core_policy_hash",
    "envelope_binding_hash",
    "catalog_fingerprint",
    "root_binding_hash",
    "function_registry_hash",
    "package_hash",
    "lineage",
    "node_contexts",
    "nonce",
    "issued_at",
    "expires_at",
    "observed_at",
    "signature",
  ];
  if (!exactKeys(attestation, required)) return envelopeFailure("nyra_deep_branch_v2_operational_attestation_schema_invalid", 400);
  if (attestation.schema_version !== OPERATIONAL_ATTESTATION_SCHEMA_VERSION
    || attestation.issuer !== ENVELOPE_ISSUER
    || attestation.audience !== ENVELOPE_AUDIENCE
    || !KEY_ID_PATTERN.test(String(attestation.key_id || ""))
    || !ID_PATTERN.test(String(attestation.tenant_id || ""))
    || !REQUEST_ID_PATTERN.test(String(attestation.request_id || ""))
    || attestation.domain_pack !== NYRA_DEEP_V2_CATALOG_SCOPE
    || attestation.catalog_scope !== NYRA_DEEP_V2_CATALOG_SCOPE
    || attestation.domain_pack !== attestation.catalog_scope
    || !NYRA_DEEP_V2_ENTITLEMENT_PACKS.has(String(attestation.entitlement_domain_pack || ""))
    || !ID_PATTERN.test(String(attestation.branch_id || ""))
    || !ID_PATTERN.test(String(attestation.subbranch_id || ""))
    || !NONCE_PATTERN.test(String(attestation.nonce || ""))
    || !Number.isFinite(Number(attestation.observed_at))) {
    return envelopeFailure("nyra_deep_branch_v2_operational_attestation_fields_invalid", 400);
  }
  const requiredHashes = [
    "core_policy_hash",
    "envelope_binding_hash",
    "catalog_fingerprint",
    "root_binding_hash",
    "function_registry_hash",
    "package_hash",
  ];
  if (requiredHashes.some((field) => !SHA256_PATTERN.test(String(attestation[field] || "")))) {
    return envelopeFailure("nyra_deep_branch_v2_operational_attestation_hash_invalid", 400);
  }
  if (!config.operational_tenant_allowlist.includes(attestation.tenant_id)
    || !config.operational_key_allowlist.includes(attestation.key_id)
    || !Object.hasOwn(config.operational_public_keys, attestation.key_id)) {
    return envelopeFailure("nyra_deep_branch_v2_operational_attestation_not_allowlisted");
  }
  if (attestation.tenant_id !== envelope?.tenant_id
    || attestation.request_id !== envelope?.request_id
    || attestation.domain_pack !== envelope?.domain_pack
    || attestation.catalog_scope !== envelope?.catalog_scope
    || attestation.entitlement_domain_pack !== envelope?.entitlement_domain_pack
    || attestation.preflight_id !== envelope?.preflight_id
    || attestation.core_policy_hash !== envelope?.core_policy_hash
    || attestation.catalog_fingerprint !== envelope?.catalog_fingerprint
    || attestation.root_binding_hash !== envelope?.root_binding_hash
    || attestation.envelope_binding_hash !== coreEnvelopeBindingHash(envelope)
    || !envelope?.opened_branch_ids?.includes(attestation.branch_id)
    || !envelope?.branch_allowlist?.includes(attestation.branch_id)) {
    return envelopeFailure("nyra_deep_branch_v2_operational_attestation_envelope_binding_invalid");
  }
  const issuedAt = Date.parse(String(attestation.issued_at || ""));
  const expiresAt = Date.parse(String(attestation.expires_at || ""));
  const nowMs = now();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
    || issuedAt > nowMs + MAX_FUTURE_SKEW_MS
    || expiresAt <= nowMs
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > config.maximum_operational_attestation_age_ms) {
    return envelopeFailure("nyra_deep_branch_v2_operational_attestation_expired");
  }
  let publicKey;
  try {
    publicKey = crypto.createPublicKey(config.operational_public_keys[attestation.key_id]);
  } catch {
    return envelopeFailure("nyra_deep_branch_v2_operational_attestation_public_key_invalid");
  }
  if (publicKey.asymmetricKeyType !== "ed25519"
    || !verifyOperationalEvaluationAttestation(attestation, publicKey)) {
    return envelopeFailure("nyra_deep_branch_v2_operational_attestation_signature_invalid");
  }
  const shard = loadRuntimeShard({
    loaded,
    tenantId: envelope.tenant_id,
    branchId: attestation.branch_id,
    subbranchId: attestation.subbranch_id,
    env,
  });
  if (!shard.ok) return envelopeFailure("nyra_deep_branch_v2_operational_shard_rejected");
  const expectedLineage = operationalLineageFromShard(shard);
  if (!expectedLineage
    || attestation.catalog_fingerprint !== loaded?.manifest?.root_binding?.catalog_fingerprint
    || attestation.root_binding_hash !== loaded?.manifest?.root_binding_hash
    || attestation.function_registry_hash !== loaded?.manifest?.root_binding?.function_registry_hash
    || attestation.package_hash !== shard.descriptor?.uncompressed_sha256
    || !Array.isArray(attestation.lineage)
    || canonicalJson(attestation.lineage) !== canonicalJson(expectedLineage)) {
    return envelopeFailure("nyra_deep_branch_v2_operational_lineage_binding_invalid");
  }
  if (!Array.isArray(attestation.node_contexts)
    || attestation.node_contexts.length !== expectedLineage.length) {
    return envelopeFailure("nyra_deep_branch_v2_operational_context_coverage_invalid", 400);
  }
  const seenContextIds = new Set();
  const seenEvidenceIds = new Set();
  let totalBytes = 0;
  const contexts = [];
  for (const [index, opaqueContext] of attestation.node_contexts.entries()) {
    const expected = expectedLineage[index];
    const decoded = decodeOpaqueNodeContext(opaqueContext);
    if (!decoded.ok) return decoded;
    if (opaqueContext.node_id !== expected.node_id
      || seenContextIds.has(opaqueContext.context_id)) {
      return envelopeFailure("nyra_deep_branch_v2_operational_context_lineage_invalid");
    }
    seenContextIds.add(opaqueContext.context_id);
    totalBytes += decoded.bytes;
    if (totalBytes > MAX_OPAQUE_CONTEXT_TOTAL_BYTES) {
      return envelopeFailure("nyra_deep_branch_v2_operational_context_budget_exceeded", 400);
    }
    for (const evidence of decoded.payload.evidence) {
      const evidenceId = String(evidence?.evidence_id || "");
      if (!evidenceId || seenEvidenceIds.has(evidenceId)) {
        return envelopeFailure("nyra_deep_branch_v2_operational_evidence_identity_invalid");
      }
      seenEvidenceIds.add(evidenceId);
    }
    contexts.push(decoded.payload);
  }
  return {
    ok: true,
    issued_at: issuedAt,
    expires_at: expiresAt,
    observed_at: Number(attestation.observed_at),
    attestation_hash: sha256(canonicalJson(operationalAttestationPayload(attestation))),
    branch_id: attestation.branch_id,
    subbranch_id: attestation.subbranch_id,
    package_hash: attestation.package_hash,
    key_id: attestation.key_id,
    lineage: expectedLineage,
    contexts,
  };
}

function hydrateOperationalEvaluationContext({ envelope, attestation }) {
  const nodeInputs = {};
  const evidenceManifests = {};
  const evidence = [];
  const policyDecisions = [];
  for (const context of attestation.contexts || []) {
    nodeInputs[context.node_id] = context.capability_input;
    evidenceManifests[context.node_id] = context.evidence_manifest;
    evidence.push(...context.evidence);
    policyDecisions.push(...context.policy_decisions);
  }
  return {
    corePayload: {
      tenant_id: envelope.tenant_id,
      domain_pack: { id: envelope.entitlement_domain_pack },
      result: {
        nyra_neural_network: {
          opened_by: "universal_core",
          opened_branches: [{ id: attestation.branch_id, status: "opened" }],
          execution_authorized: false,
        },
        evidence_manifests: evidenceManifests,
        policy_decisions: policyDecisions,
      },
    },
    evaluationContext: {
      subbranch_id: attestation.subbranch_id,
      evidence,
      // The Ed25519 attestation authenticates the otherwise opaque, bounded atoms.
      evidence_source: "authenticated_core",
      node_inputs: nodeInputs,
      request_id: envelope.request_id,
      observed_at: attestation.observed_at,
    },
  };
}

function compactOperationalNodeEvaluation(evaluation, lineage) {
  const result = {
    node_id: lineage.node_id,
    parent_id: lineage.parent_id,
    level: lineage.level,
    node_type: lineage.node_type,
    state: String(evaluation?.state || "not_evaluated"),
  };
  if (Number.isFinite(evaluation?.confidence)) result.confidence = evaluation.confidence;
  if (Number.isFinite(evaluation?.confidence_threshold)) result.confidence_threshold = evaluation.confidence_threshold;
  if (typeof evaluation?.fallback_node === "string") result.fallback_node = evaluation.fallback_node;
  if (Array.isArray(evaluation?.reason_codes)) result.reason_codes = evaluation.reason_codes.slice(0, 6).map(String);
  return result;
}

function createNyraDeepBranchV2Federation({
  env = process.env,
  now = () => Date.now(),
  loadCatalogImpl = loadCatalog,
  routeImpl = route,
  replayGuard = createReplayGuard({ now }),
} = {}) {
  function config() {
    return federationConfig(env);
  }

  function authenticate(sharedSecret) {
    const current = config();
    if (!current.enabled || !current.shared_secret || current.tenant_allowlist.length === 0) {
      return { ok: false, error: "nyra_deep_branch_v2_federation_unavailable" };
    }
    return safeEqual(current.shared_secret, sharedSecret)
      ? { ok: true }
      : { ok: false, error: "nyra_deep_branch_v2_service_auth_invalid" };
  }

  function evaluate(envelope) {
    const current = config();
    if (!current.enabled || !current.shared_secret || current.tenant_allowlist.length === 0) {
      return v1AuthoritativeResponse({
        tenantId: envelope?.tenant_id,
        requestId: envelope?.request_id,
        state: "federation_disabled_v1_authoritative",
        reason: "nyra_deep_branch_v2_federation_disabled",
      });
    }
    const validation = validateEnvelope(envelope, current, { now });
    if (!validation.ok) return validation;
    if (!replayGuard.consume({
      tenantId: envelope.tenant_id,
      nonce: envelope.nonce,
      expiresAt: validation.expires_at,
    })) return envelopeFailure("nyra_deep_branch_v2_envelope_replayed");

    const loaded = loadCatalogImpl({ runtimeMode: "lazy" });
    const compactedValidation = compactValidation(loaded);
    if (!loaded.ok) {
      return v1AuthoritativeResponse({
        tenantId: envelope.tenant_id,
        requestId: envelope.request_id,
        state: "catalog_rejected_v1_authoritative",
        reason: "nyra_deep_branch_v2_catalog_rejected",
        validation: compactedValidation,
        envelopeHash: validation.envelope_hash,
      });
    }
    if (loaded.catalog.catalog_fingerprint !== envelope.catalog_fingerprint
      || loaded.manifest?.root_binding_hash !== envelope.root_binding_hash) {
      return envelopeFailure("nyra_deep_branch_v2_catalog_binding_mismatch");
    }

    const flags = featureFlags(env, envelope.tenant_id);
    const serviceAllowlist = new Set(flags.branch_allowlist);
    if (envelope.branch_allowlist.some((branchId) => !serviceAllowlist.has(branchId))) {
      return envelopeFailure("nyra_deep_branch_v2_core_allowlist_exceeds_service_allowlist");
    }
    if (envelope.operational_attestation !== undefined) {
      if (!current.operational_evaluation_enabled
        || current.operational_tenant_allowlist.length === 0
        || current.operational_key_allowlist.length === 0) {
        return v1AuthoritativeResponse({
          tenantId: envelope.tenant_id,
          requestId: envelope.request_id,
          state: "operational_evaluation_disabled_v1_authoritative",
          reason: "nyra_deep_branch_v2_operational_evaluation_disabled_or_unscoped",
          validation: compactedValidation,
          envelopeHash: validation.envelope_hash,
        });
      }
      const operational = validateOperationalEvaluationAttestation({
        attestation: envelope.operational_attestation,
        envelope,
        envelopeValidation: validation,
        config: current,
        loaded,
        env,
        now,
      });
      if (!operational.ok) return operational;
      if (!replayGuard.consume({
        tenantId: envelope.tenant_id,
        nonce: envelope.operational_attestation.nonce,
        expiresAt: operational.expires_at,
        scope: "operational_attestation",
      })) return envelopeFailure("nyra_deep_branch_v2_operational_attestation_replayed");
      const hydrated = hydrateOperationalEvaluationContext({ envelope, attestation: operational });
      const evaluated = routeImpl({
        tenantId: envelope.tenant_id,
        domainPackId: envelope.catalog_scope,
        corePayload: hydrated.corePayload,
        requestedBranches: [operational.branch_id],
        evaluationContext: hydrated.evaluationContext,
        env,
        runtimeMode: "lazy",
      });
      const evaluations = Array.isArray(evaluated.evaluations) ? evaluated.evaluations : [];
      const evaluationsByNodeId = new Map(evaluations.map((item) => [item?.node_id, item]));
      if (evaluations.length !== operational.lineage.length
        || evaluationsByNodeId.size !== operational.lineage.length
        || operational.lineage.some((lineage) => !evaluationsByNodeId.has(lineage.node_id))) {
        return envelopeFailure("nyra_deep_branch_v2_operational_runtime_lineage_invalid");
      }
      const nodeResults = operational.lineage.map((lineage) => (
        compactOperationalNodeEvaluation(evaluationsByNodeId.get(lineage.node_id), lineage)
      ));
      const allVerified = nodeResults.every((item) => item.state === "advisory_verified");
      return {
        ok: true,
        schema_version: RESPONSE_SCHEMA_VERSION,
        state: allVerified
          ? "operational_advisory_verified_v1_authoritative"
          : "operational_advisory_fallback_v1_authoritative",
        mode: evaluated.mode,
        tenant_id: envelope.tenant_id,
        request_id: envelope.request_id,
        catalog: {
          version: evaluated.catalog_version || loaded.catalog.version,
          fingerprint: evaluated.catalog_fingerprint || loaded.catalog.catalog_fingerprint,
          root_binding_hash: loaded.manifest?.root_binding_hash || null,
        },
        validation: compactedValidation,
        selected_branches: [],
        evaluation: {
          schema_version: EVALUATION_RESPONSE_SCHEMA_VERSION,
          state: allVerified ? "operational_advisory_verified" : "operational_advisory_fallback",
          evaluated_node_count: nodeResults.length,
          all_nodes_verified: allVerified,
          lineage: {
            branch_id: operational.branch_id,
            subbranch_id: operational.subbranch_id,
            package_hash: operational.package_hash,
            nodes: nodeResults,
          },
        },
        provenance: {
          envelope_hash: validation.envelope_hash,
          attestation_hash: operational.attestation_hash,
          key_id: operational.key_id,
          core_policy_hash: envelope.core_policy_hash,
          preflight_id: envelope.preflight_id,
        },
        execution_authorized: false,
        core_final_authority: true,
        fallback: "nyra_neural_branch_network_v1",
      };
    }
    const deepBranchV2 = routeImpl({
      tenantId: envelope.tenant_id,
      domainPackId: envelope.catalog_scope,
      corePayload: {
        result: {
          nyra_neural_network: {
            opened_by: "universal_core",
            opened_branches: envelope.opened_branch_ids.map((id) => ({ id, status: "opened" })),
          },
          work_preflight: {
            preflight_id: envelope.preflight_id,
          },
        },
      },
      requestedBranches: envelope.opened_branch_ids,
      env,
      runtimeMode: "lazy",
    });
    const selectedBranches = (deepBranchV2.selected_branches || []).map(compactBranch);
    return {
      ok: true,
      schema_version: RESPONSE_SCHEMA_VERSION,
      state: deepBranchV2.state,
      mode: deepBranchV2.mode,
      tenant_id: envelope.tenant_id,
      request_id: envelope.request_id,
      catalog: {
        version: deepBranchV2.catalog_version || loaded.catalog.version,
        fingerprint: deepBranchV2.catalog_fingerprint || loaded.catalog.catalog_fingerprint,
        root_binding_hash: loaded.manifest?.root_binding_hash || null,
      },
      validation: compactedValidation,
      selected_branches: selectedBranches,
      evaluation: {
        state: "not_requested_core_evidence_contract_unavailable",
        evaluated_node_count: 0,
        reason: "preview_routes_only_core_opened_branches_until_core_attests_node_evidence_and_policy",
      },
      provenance: {
        envelope_hash: validation.envelope_hash,
        core_policy_hash: envelope.core_policy_hash,
        preflight_id: envelope.preflight_id,
      },
      execution_authorized: false,
      core_final_authority: true,
      fallback: "nyra_neural_branch_network_v1",
    };
  }

  return {
    authenticate,
    config,
    evaluate,
  };
}

module.exports = {
  ENVELOPE_AUDIENCE,
  ENVELOPE_ISSUER,
  ENVELOPE_SCHEMA_VERSION,
  EVALUATION_ATTESTATION_SCHEMA_VERSION,
  EVALUATION_RESPONSE_SCHEMA_VERSION,
  OPAQUE_NODE_CONTEXT_SCHEMA_VERSION,
  OPERATIONAL_ATTESTATION_SCHEMA_VERSION,
  RESPONSE_SCHEMA_VERSION,
  canonicalHash,
  canonicalJson,
  coreEnvelopeBindingHash,
  createNyraDeepBranchV2Federation,
  createPersistentReplayGuard,
  createReplayGuard,
  encodeOpaqueNodeContext,
  federationConfig,
  hydrateOperationalEvaluationContext,
  operationalLineageFromShard,
  signCoreEnvelope,
  signEvaluationAttestation,
  signOperationalEvaluationAttestation,
  validateOperationalEvaluationAttestation,
  verifyEvaluationAttestation,
  verifyOperationalEvaluationAttestation,
};
