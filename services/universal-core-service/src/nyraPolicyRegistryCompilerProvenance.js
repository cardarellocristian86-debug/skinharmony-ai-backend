import crypto from "node:crypto";

import {
  NYRA_POLICY_PRIMARY_SOURCES,
  compilePolicySnapshot,
  policyPackDigest,
  verifyPolicyPackSignature,
} from "./nyraPolicyRegistry.js";

const TRUST_CATALOG_SCHEMA = "nyra_policy_pack_trust_catalog_v1";
const COMPILER_INPUT_SCHEMA = "nyra_policy_compiler_input_v1";
const PROVENANCE_SCHEMA = "nyra_policy_compiler_provenance_v1";
const STATUS_SCHEMA = "nyra_policy_compiler_provenance_status_v1";
const COMPILER_MODE = "core_deterministic_recompile";
const COMPILER_ALGORITHM = "nyra_policy_registry_v1";
const VERIFICATION_ALGORITHM = "sha256_canonical_json+ed25519";
const MAX_INPUT_BYTES = 524_288;
const MAX_PACKS = 64;
const MAX_LEAVES = 16;
const MAX_PARENTS_PER_PACK = 8;
const MAX_SIGNATURES_PER_PACK = 4;
const MAX_SOURCES_PER_PACK = 16;
const MAX_TESTS_PER_PACK = 32;
const MAX_TRAVERSAL_BUDGET = 256;
const MAX_CONSTRAINT_BYTES = 65_536;
const MAX_CONSTRAINT_DEPTH = 16;
const MAX_CONSTRAINT_NODES = 4_096;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 100_000;
const SHA256 = /^[a-f0-9]{64}$/;
const BUILD_COMMIT = /^[a-f0-9]{40}$/;
const ID = /^[a-z0-9][a-z0-9._/-]{1,159}$/;
const PACK_REFERENCE = /^[a-z0-9][a-z0-9._/-]{1,159}@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ROLES = new Set(["core", "nyra"]);

const TRUST_CATALOG_FIELDS = Object.freeze([
  "schema_version",
  "issuers",
  "trusted_core_pack_digests",
  "known_core_branch_ids",
  "known_nyra_branch_ids",
  "known_domain_pack_ids",
]);
const TRUST_ISSUER_FIELDS = Object.freeze([
  "issuer_id",
  "key_id",
  "role",
  "algorithm",
  "public_key",
  "public_key_fingerprint",
]);
const COMPILER_INPUT_FIELDS = Object.freeze([
  "schema_version",
  "leaf_pack_ids",
  "packs",
]);
const PACK_FIELDS = Object.freeze([
  "schema_version",
  "pack_id",
  "version",
  "status",
  "scope",
  "parent_refs",
  "bindings",
  "privacy",
  "policy",
  "tests",
  "sources",
  "freshness_sla_days",
  "provenance",
  "valid_from",
  "expires_at",
  "rollback_to",
  "compatibility",
  "trust_mode",
  "signatures",
  "artifact_digest",
]);
const SCOPE_FIELDS = Object.freeze(["kind", "value", "tenant_id"]);
const PARENT_FIELDS = Object.freeze(["pack_id", "version", "digest"]);
const BINDING_FIELDS = Object.freeze([
  "core_branch_ids",
  "nyra_branch_ids",
  "domain_pack_ids",
]);
const PRIVACY_FIELDS = Object.freeze([
  "raw_customer_data_allowed",
  "data_classification",
]);
const POLICY_FIELDS = Object.freeze([
  "allow_mode",
  "allow_actions",
  "deny_actions",
  "required_gates",
  "constraints",
]);
const SOURCE_FIELDS = Object.freeze([
  "source_id",
  "url",
  "claim",
  "reviewed_at",
]);
const SIGNATURE_FIELDS = Object.freeze(["issuer_id", "algorithm", "signature"]);
const PROVENANCE_FIELDS = Object.freeze([
  "schema_version",
  "compiler_mode",
  "compiler_algorithm",
  "tenant_id",
  "domain_pack_id",
  "snapshot_digest",
  "leaf_pack_digests",
  "ordered_pack_evidence",
  "core_root_digest",
  "catalog_digest",
  "trust_catalog_digest",
  "compiler_build_commit",
  "validity",
  "resolution",
  "execution_authorized",
  "provenance_digest",
]);
const LEAF_DIGEST_FIELDS = Object.freeze(["pack_id", "version", "digest"]);
const PACK_EVIDENCE_FIELDS = Object.freeze([
  "pack_id",
  "version",
  "pack_digest",
  "scope_kind",
  "verification_kind",
  "verified_key_ids",
  "verified_public_key_fingerprints",
  "verified_roles",
]);
const VALIDITY_FIELDS = Object.freeze(["valid_from", "expires_at"]);
const RESOLUTION_FIELDS = Object.freeze([
  "logical_depth",
  "traversal_budget",
  "traversed",
  "catalog_depth_policy",
  "runtime_policy",
]);
const VERIFY_INPUT_FIELDS = Object.freeze([
  "tenant_id",
  "domain_pack_id",
  "snapshot",
  "compiler_input",
]);
const PERSISTED_BINDING_FIELDS = Object.freeze([
  "tenant_id",
  "domain_pack_id",
  "snapshot_digest",
  "compiler_provenance_digest",
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digestCanonical(value) {
  return crypto.createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function isDensePlainArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const keys = Object.keys(value);
  const keySet = new Set(keys);
  return keys.length === value.length && keys.every((key, index) => key === String(index)) &&
    Reflect.ownKeys(value).every((key) => key === "length" || keySet.has(key));
}

function isExactPlainObject(value, fields) {
  if (!isPlainObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && keys.every((key) => typeof key === "string") &&
    fields.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
    });
}

function assertPlainJson(value, code, {
  maxDepth = MAX_JSON_DEPTH,
  maxNodes = MAX_JSON_NODES,
  maxBytes = Number.POSITIVE_INFINITY,
  budgetCode = code,
} = {}, state = { seen: new Set(), nodes: 0, bytes: 0 }, depth = 0) {
  const addBytes = (bytes) => {
    state.bytes += bytes;
    if (state.bytes > maxBytes) throw new Error(budgetCode);
  };
  if (value === null) {
    addBytes(4);
    return;
  }
  if (typeof value === "string") {
    addBytes(Buffer.byteLength(value, "utf8") + 2);
    return;
  }
  if (typeof value === "boolean") {
    addBytes(value ? 4 : 5);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new Error(code);
    addBytes(Buffer.byteLength(JSON.stringify(value), "utf8"));
    return;
  }
  if (typeof value !== "object" || state.seen.has(value) || depth >= maxDepth) {
    throw new Error(code);
  }
  state.nodes += 1;
  if (state.nodes > maxNodes) throw new Error(code);
  if (Array.isArray(value) ? !isDensePlainArray(value) : !isPlainObject(value)) throw new Error(code);
  addBytes(2);
  state.seen.add(value);
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (Array.isArray(value) && key === "length") continue;
    if (typeof key !== "string") throw new Error(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error(code);
    if (!Array.isArray(value)) addBytes(Buffer.byteLength(key, "utf8") + 2);
    assertPlainJson(descriptor.value, code, {
      maxDepth,
      maxNodes,
      maxBytes,
      budgetCode,
    }, state, depth + 1);
  }
  state.seen.delete(value);
}

function requireExactText(value, pattern, code) {
  if (typeof value !== "string" || value !== value.trim() || !pattern.test(value)) {
    throw new Error(code);
  }
  return value;
}

function requireSortedUnique(values, {
  pattern = ID,
  min = 1,
  max = 256,
  code = "compiler_configuration_invalid",
} = {}) {
  if (!isDensePlainArray(values) || values.length < min || values.length > max) throw new Error(code);
  let previous = null;
  for (const value of values) {
    requireExactText(value, pattern, code);
    if (previous !== null && previous >= value) throw new Error(code);
    previous = value;
  }
  return [...values];
}

function canonicalBase64(value, code) {
  if (typeof value !== "string" || value !== value.trim() ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(code);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== value) throw new Error(code);
  return decoded;
}

function canonicalBase64url(value, code) {
  if (typeof value !== "string" || value !== value.trim() ||
    !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(code);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== value) throw new Error(code);
  return decoded;
}

function importEd25519PublicKey(value) {
  if (typeof value !== "string") throw new Error("policy_trust_catalog_key_invalid");
  const raw = value.replaceAll("\\n", "\n").replaceAll("\r\n", "\n").trim();
  if (!raw || /PRIVATE KEY|BEGIN RSA|BEGIN EC/.test(raw)) {
    throw new Error("policy_trust_catalog_key_invalid");
  }
  let key;
  if (raw.startsWith("-----BEGIN")) {
    if (!raw.startsWith("-----BEGIN PUBLIC KEY-----") ||
      !raw.endsWith("-----END PUBLIC KEY-----")) {
      throw new Error("policy_trust_catalog_key_invalid");
    }
    key = crypto.createPublicKey(`${raw}\n`);
  } else {
    const spki = canonicalBase64(raw, "policy_trust_catalog_key_invalid");
    key = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
  }
  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
    throw new Error("policy_trust_catalog_key_invalid");
  }
  const spki = key.export({ type: "spki", format: "der" });
  return {
    key,
    fingerprint: crypto.createHash("sha256").update(spki).digest("hex"),
  };
}

function normalizeTrustCatalog(catalog) {
  assertPlainJson(catalog, "policy_trust_catalog_invalid", {
    maxBytes: MAX_INPUT_BYTES,
    budgetCode: "policy_trust_catalog_invalid",
  });
  if (!isExactPlainObject(catalog, TRUST_CATALOG_FIELDS) ||
    catalog.schema_version !== TRUST_CATALOG_SCHEMA ||
    !isDensePlainArray(catalog.issuers) || catalog.issuers.length < 2 ||
    catalog.issuers.length > 32) {
    throw new Error("policy_trust_catalog_invalid");
  }

  const trustedIssuers = Object.create(null);
  const publicIssuers = [];
  const issuerIds = new Set();
  const keyIds = new Set();
  const fingerprints = new Set();
  const roles = new Set();
  let previousIssuer = null;
  for (const issuer of catalog.issuers) {
    if (!isExactPlainObject(issuer, TRUST_ISSUER_FIELDS) || issuer.algorithm !== "Ed25519") {
      throw new Error("policy_trust_catalog_issuer_invalid");
    }
    const issuerId = requireExactText(issuer.issuer_id, ID, "policy_trust_catalog_issuer_invalid");
    const keyId = requireExactText(issuer.key_id, ID, "policy_trust_catalog_issuer_invalid");
    if (!ROLES.has(issuer.role)) throw new Error("policy_trust_catalog_issuer_invalid");
    const issuerOrder = `${issuerId}\0${keyId}`;
    if (previousIssuer !== null && previousIssuer >= issuerOrder) {
      throw new Error("policy_trust_catalog_noncanonical");
    }
    previousIssuer = issuerOrder;
    if (issuerIds.has(issuerId) || keyIds.has(keyId)) {
      throw new Error("policy_trust_catalog_issuer_invalid");
    }
    const imported = importEd25519PublicKey(issuer.public_key);
    const pinnedFingerprint = requireExactText(
      issuer.public_key_fingerprint,
      SHA256,
      "policy_trust_catalog_fingerprint_invalid",
    );
    if (pinnedFingerprint !== imported.fingerprint || fingerprints.has(imported.fingerprint)) {
      throw new Error("policy_trust_catalog_fingerprint_invalid");
    }
    issuerIds.add(issuerId);
    keyIds.add(keyId);
    fingerprints.add(imported.fingerprint);
    roles.add(issuer.role);
    trustedIssuers[issuerId] = Object.freeze({ public_key: imported.key, role: issuer.role });
    publicIssuers.push({
      issuer_id: issuerId,
      key_id: keyId,
      role: issuer.role,
      algorithm: "Ed25519",
      public_key_fingerprint: imported.fingerprint,
    });
  }
  if (!["core", "nyra"].every((role) => roles.has(role)) || fingerprints.size < 2) {
    throw new Error("policy_trust_catalog_quorum_invalid");
  }

  const trustedCorePackDigests = requireSortedUnique(catalog.trusted_core_pack_digests, {
    pattern: SHA256,
    max: MAX_PACKS,
    code: "policy_trust_catalog_core_digest_invalid",
  });
  const knownCoreBranchIds = requireSortedUnique(catalog.known_core_branch_ids, {
    code: "policy_trust_catalog_binding_invalid",
  });
  const knownNyraBranchIds = requireSortedUnique(catalog.known_nyra_branch_ids, {
    code: "policy_trust_catalog_binding_invalid",
  });
  const knownDomainPackIds = requireSortedUnique(catalog.known_domain_pack_ids, {
    code: "policy_trust_catalog_binding_invalid",
  });
  const trustProjection = {
    schema_version: TRUST_CATALOG_SCHEMA,
    issuers: publicIssuers,
    trusted_core_pack_digests: trustedCorePackDigests,
  };
  const catalogProjection = {
    schema_version: "nyra_policy_compiler_catalog_v1",
    known_core_branch_ids: knownCoreBranchIds,
    known_nyra_branch_ids: knownNyraBranchIds,
    known_domain_pack_ids: knownDomainPackIds,
    source_registry: NYRA_POLICY_PRIMARY_SOURCES,
  };
  return {
    trustedIssuers,
    trustedCorePackDigests,
    knownCoreBranchIds,
    knownNyraBranchIds,
    knownDomainPackIds,
    publicIssuers,
    catalogDigest: digestCanonical(catalogProjection),
    trustCatalogDigest: digestCanonical(trustProjection),
  };
}

function assertPackStructure(pack) {
  if (!isExactPlainObject(pack, PACK_FIELDS) ||
    !isExactPlainObject(pack.scope, SCOPE_FIELDS) ||
    !isDensePlainArray(pack.parent_refs) || pack.parent_refs.length > MAX_PARENTS_PER_PACK ||
    !pack.parent_refs.every((parent) => isExactPlainObject(parent, PARENT_FIELDS)) ||
    !isExactPlainObject(pack.bindings, BINDING_FIELDS) ||
    !isExactPlainObject(pack.privacy, PRIVACY_FIELDS) ||
    !isExactPlainObject(pack.policy, POLICY_FIELDS) ||
    !isDensePlainArray(pack.tests) || pack.tests.length > MAX_TESTS_PER_PACK ||
    !isDensePlainArray(pack.sources) || pack.sources.length > MAX_SOURCES_PER_PACK ||
    !pack.sources.every((source) => isExactPlainObject(source, SOURCE_FIELDS)) ||
    !isDensePlainArray(pack.signatures) || pack.signatures.length > MAX_SIGNATURES_PER_PACK ||
    !pack.signatures.every((signature) => isExactPlainObject(signature, SIGNATURE_FIELDS))) {
    throw new Error("policy_compiler_input_pack_invalid");
  }
  requireExactText(pack.pack_id, ID, "policy_compiler_input_pack_invalid");
  requireExactText(pack.artifact_digest, SHA256, "policy_compiler_input_pack_invalid");
  if (pack.status !== "active") throw new Error("policy_compiler_input_pack_status_invalid");
  assertPlainJson(pack.policy.constraints, "policy_compiler_constraints_invalid", {
    maxDepth: MAX_CONSTRAINT_DEPTH,
    maxNodes: MAX_CONSTRAINT_NODES,
  });
  if (Buffer.byteLength(canonical(pack.policy.constraints), "utf8") > MAX_CONSTRAINT_BYTES) {
    throw new Error("policy_compiler_constraints_invalid");
  }
  const signatureIssuers = new Set();
  for (const signature of pack.signatures) {
    requireExactText(signature.issuer_id, ID, "policy_compiler_input_signature_invalid");
    if (signature.algorithm !== "Ed25519" || signatureIssuers.has(signature.issuer_id)) {
      throw new Error("policy_compiler_input_signature_invalid");
    }
    signatureIssuers.add(signature.issuer_id);
    const signatureBytes = canonicalBase64url(
      signature.signature,
      "policy_compiler_input_signature_invalid",
    );
    if (signatureBytes.length !== 64) throw new Error("policy_compiler_input_signature_invalid");
  }
}

function normalizeCompilerInput(compilerInput) {
  assertPlainJson(compilerInput, "policy_compiler_input_invalid", {
    maxBytes: MAX_INPUT_BYTES,
    budgetCode: "policy_compiler_input_oversize",
  });
  if (!isExactPlainObject(compilerInput, COMPILER_INPUT_FIELDS) ||
    compilerInput.schema_version !== COMPILER_INPUT_SCHEMA ||
    !isDensePlainArray(compilerInput.packs) || compilerInput.packs.length < 1 ||
    compilerInput.packs.length > MAX_PACKS) {
    throw new Error("policy_compiler_input_invalid");
  }
  const leafPackIds = requireSortedUnique(compilerInput.leaf_pack_ids, {
    pattern: PACK_REFERENCE,
    max: MAX_LEAVES,
    code: "policy_compiler_input_leaf_invalid",
  });
  let previousPack = null;
  const packReferences = new Set();
  for (const pack of compilerInput.packs) {
    assertPackStructure(pack);
    const reference = `${pack.pack_id}@${pack.version}`;
    if (!PACK_REFERENCE.test(reference) ||
      (previousPack !== null && previousPack >= reference) || packReferences.has(reference)) {
      throw new Error("policy_compiler_input_noncanonical");
    }
    previousPack = reference;
    packReferences.add(reference);
  }
  if (leafPackIds.some((reference) => !packReferences.has(reference))) {
    throw new Error("policy_compiler_input_leaf_invalid");
  }
  const inputBytes = canonical(compilerInput);
  if (Buffer.byteLength(inputBytes, "utf8") > MAX_INPUT_BYTES) {
    throw new Error("policy_compiler_input_oversize");
  }
  return {
    value: JSON.parse(inputBytes),
    canonical: inputBytes,
  };
}

function normalizeVerifyInput(input) {
  if (!isExactPlainObject(input, VERIFY_INPUT_FIELDS)) {
    throw new Error("policy_compiler_verify_input_invalid");
  }
  const tenantId = requireExactText(input.tenant_id, ID, "policy_compiler_tenant_invalid");
  const domainPackId = requireExactText(
    input.domain_pack_id,
    ID,
    "policy_compiler_domain_invalid",
  );
  assertPlainJson(input.snapshot, "policy_compiler_snapshot_invalid", {
    maxBytes: MAX_INPUT_BYTES,
    budgetCode: "policy_compiler_snapshot_invalid",
  });
  const snapshotCanonical = canonical(input.snapshot);
  if (Buffer.byteLength(snapshotCanonical, "utf8") > MAX_INPUT_BYTES) {
    throw new Error("policy_compiler_snapshot_invalid");
  }
  const normalizedCompilerInput = normalizeCompilerInput(input.compiler_input);
  return {
    tenantId,
    domainPackId,
    snapshotCanonical,
    snapshot: JSON.parse(snapshotCanonical),
    compilerInput: normalizedCompilerInput.value,
  };
}

function safeEqual(left, right) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function exactIsoTimestamp(value) {
  if (typeof value !== "string" || value !== value.trim()) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function exactProvenanceRecord(record, buildCommit, catalogDigest, trustCatalogDigest) {
  try {
    assertPlainJson(record, "nyra_policy_compiler_provenance_invalid", {
      maxBytes: MAX_INPUT_BYTES,
      budgetCode: "nyra_policy_compiler_provenance_invalid",
    });
    if (!isExactPlainObject(record, PROVENANCE_FIELDS) ||
      record.schema_version !== PROVENANCE_SCHEMA ||
      record.compiler_mode !== COMPILER_MODE ||
      record.compiler_algorithm !== COMPILER_ALGORITHM ||
      typeof record.tenant_id !== "string" || !ID.test(record.tenant_id) ||
      typeof record.domain_pack_id !== "string" || !ID.test(record.domain_pack_id) ||
      record.compiler_build_commit !== buildCommit ||
      record.catalog_digest !== catalogDigest ||
      record.trust_catalog_digest !== trustCatalogDigest ||
      ![
        record.snapshot_digest,
        record.core_root_digest,
        record.catalog_digest,
        record.trust_catalog_digest,
        record.provenance_digest,
      ].every((value) => typeof value === "string" && SHA256.test(value)) ||
      record.execution_authorized !== false) {
      return false;
    }
    if (!isDensePlainArray(record.leaf_pack_digests) ||
      record.leaf_pack_digests.length < 1 || record.leaf_pack_digests.length > MAX_LEAVES ||
      !record.leaf_pack_digests.every((leaf) => isExactPlainObject(leaf, LEAF_DIGEST_FIELDS) &&
        typeof leaf.pack_id === "string" && ID.test(leaf.pack_id) &&
        typeof leaf.version === "string" &&
        PACK_REFERENCE.test(`${leaf.pack_id}@${leaf.version}`) && SHA256.test(leaf.digest)) ||
      !isDensePlainArray(record.ordered_pack_evidence) ||
      record.ordered_pack_evidence.length < 2 || record.ordered_pack_evidence.length > MAX_PACKS ||
      !isExactPlainObject(record.validity, VALIDITY_FIELDS) ||
      !exactIsoTimestamp(record.validity.valid_from) ||
      !exactIsoTimestamp(record.validity.expires_at) ||
      Date.parse(record.validity.valid_from) >= Date.parse(record.validity.expires_at) ||
      !isExactPlainObject(record.resolution, RESOLUTION_FIELDS) ||
      !Number.isInteger(record.resolution.logical_depth) ||
      record.resolution.logical_depth !== record.ordered_pack_evidence.length ||
      !Number.isInteger(record.resolution.traversal_budget) ||
      record.resolution.traversal_budget < 1 ||
      record.resolution.traversal_budget > MAX_TRAVERSAL_BUDGET ||
      !Number.isInteger(record.resolution.traversed) ||
      record.resolution.traversed < record.resolution.logical_depth ||
      record.resolution.traversed > record.resolution.traversal_budget ||
      record.resolution.catalog_depth_policy !== "no_static_ceiling" ||
      record.resolution.runtime_policy !== "bounded_fail_closed") return false;

    let coreRootCount = 0;
    for (const evidence of record.ordered_pack_evidence) {
      if (!isExactPlainObject(evidence, PACK_EVIDENCE_FIELDS) ||
        typeof evidence.pack_id !== "string" || !ID.test(evidence.pack_id) ||
        typeof evidence.version !== "string" ||
        !PACK_REFERENCE.test(`${evidence.pack_id}@${evidence.version}`) ||
        typeof evidence.pack_digest !== "string" || !SHA256.test(evidence.pack_digest) ||
        typeof evidence.scope_kind !== "string" || !ID.test(evidence.scope_kind) ||
        !new Set(["trusted_core_digest", "ed25519_quorum"]).has(evidence.verification_kind)) {
        return false;
      }
      requireSortedUnique(evidence.verified_key_ids, {
        min: evidence.verification_kind === "trusted_core_digest" ? 0 : 2,
        max: MAX_SIGNATURES_PER_PACK,
        code: "nyra_policy_compiler_provenance_invalid",
      });
      requireSortedUnique(evidence.verified_public_key_fingerprints, {
        pattern: SHA256,
        min: evidence.verification_kind === "trusted_core_digest" ? 0 : 2,
        max: MAX_SIGNATURES_PER_PACK,
        code: "nyra_policy_compiler_provenance_invalid",
      });
      requireSortedUnique(evidence.verified_roles, {
        min: evidence.verification_kind === "trusted_core_digest" ? 1 : 2,
        max: 2,
        code: "nyra_policy_compiler_provenance_invalid",
      });
      if (evidence.verification_kind === "trusted_core_digest") {
        coreRootCount += 1;
        if (evidence.scope_kind !== "core" || evidence.pack_digest !== record.core_root_digest ||
          evidence.verified_key_ids.length !== 0 ||
          evidence.verified_public_key_fingerprints.length !== 0 ||
          canonical(evidence.verified_roles) !== canonical(["core"])) return false;
      } else if (canonical(evidence.verified_roles) !== canonical(["core", "nyra"])) {
        return false;
      }
    }
    if (coreRootCount !== 1) return false;
    const body = { ...record };
    delete body.provenance_digest;
    return digestCanonical(body) === record.provenance_digest;
  } catch {
    return false;
  }
}

export function createNyraPolicyRegistryCompilerProvenanceVerifier({
  trust_catalog,
  build_commit,
  traversal_budget = MAX_TRAVERSAL_BUDGET,
  now = () => Date.now(),
} = {}) {
  const buildCommit = requireExactText(
    build_commit,
    BUILD_COMMIT,
    "policy_compiler_build_commit_invalid",
  );
  if (!Number.isInteger(traversal_budget) || traversal_budget < 1 ||
    traversal_budget > MAX_TRAVERSAL_BUDGET) {
    throw new Error("policy_compiler_traversal_budget_invalid");
  }
  if (typeof now !== "function") throw new Error("policy_compiler_clock_invalid");
  const traversalBudget = traversal_budget;
  const trust = normalizeTrustCatalog(trust_catalog);

  function serverClock() {
    try {
      const timestamp = now();
      const currentTime = typeof timestamp === "number" ? new Date(timestamp) : null;
      return currentTime && Number.isFinite(currentTime.getTime()) ? currentTime : null;
    } catch {
      return null;
    }
  }

  function verify(input) {
    const normalized = normalizeVerifyInput(input);
    if (!trust.knownDomainPackIds.includes(normalized.domainPackId)) {
      throw new Error("policy_compiler_domain_untrusted");
    }
    const currentTime = serverClock();
    if (!currentTime) {
      throw new Error("policy_compiler_clock_unavailable");
    }
    const compiled = compilePolicySnapshot({
      tenant_id: normalized.tenantId,
      domain_pack_id: normalized.domainPackId,
      leaf_pack_ids: normalized.compilerInput.leaf_pack_ids,
      packs: normalized.compilerInput.packs,
      traversal_budget: traversalBudget,
      trusted_issuers: trust.trustedIssuers,
      trusted_core_pack_digests: trust.trustedCorePackDigests,
      known_core_branch_ids: trust.knownCoreBranchIds,
      known_nyra_branch_ids: trust.knownNyraBranchIds,
      known_domain_pack_ids: trust.knownDomainPackIds,
      now: currentTime,
    });
    const compiledCanonical = canonical(compiled);
    if (!safeEqual(normalized.snapshotCanonical, compiledCanonical)) {
      throw new Error("policy_compiler_snapshot_mismatch");
    }

    const packsByReference = new Map(normalized.compilerInput.packs.map((pack) => [
      `${pack.pack_id}@${pack.version}`,
      pack,
    ]));
    const usedReferences = new Set();
    const verifiedRoles = new Set();
    const verifiedFingerprints = new Set();
    const compiledCoreRoots = [];
    const orderedPackEvidence = [];
    for (const ancestry of compiled.ancestry) {
      const reference = `${ancestry.pack_id}@${ancestry.version}`;
      const pack = packsByReference.get(reference);
      if (!pack || policyPackDigest(pack) !== ancestry.digest || pack.artifact_digest !== ancestry.digest) {
        throw new Error("policy_compiler_pack_set_mismatch");
      }
      usedReferences.add(reference);
      const signature = verifyPolicyPackSignature(pack, {
        trusted_issuers: trust.trustedIssuers,
        trusted_core_pack_digests: trust.trustedCorePackDigests,
      });
      let verificationKind;
      let verifiedKeyIds = [];
      let packFingerprints = [];
      let packRoles = [];
      if (pack.trust_mode === "compiled_core") {
        if (pack.scope.kind !== "core" || signature.ok !== true ||
          signature.mode !== "compiled_core" || signature.trusted_core_digest !== true) {
          throw new Error("policy_compiler_root_unverified");
        }
        compiledCoreRoots.push(ancestry.digest);
        verificationKind = "trusted_core_digest";
        packRoles = ["core"];
      } else {
        if (signature.ok !== true || signature.mode !== "ed25519" ||
          signature.independent_key_count < 2 ||
          !["core", "nyra"].every((role) => signature.verified_roles?.includes(role))) {
          throw new Error("policy_compiler_signature_quorum_invalid");
        }
        const verifiedIssuers = (signature.verified_issuer_ids || []).map((issuerId) =>
          trust.publicIssuers.find((candidate) => candidate.issuer_id === issuerId));
        if (verifiedIssuers.some((issuer) => !issuer)) {
          throw new Error("policy_compiler_signature_quorum_invalid");
        }
        verificationKind = "ed25519_quorum";
        verifiedKeyIds = [...new Set(verifiedIssuers.map((issuer) => issuer.key_id))].sort();
        packFingerprints = [...new Set(
          verifiedIssuers.map((issuer) => issuer.public_key_fingerprint),
        )].sort();
        packRoles = [...new Set(verifiedIssuers.map((issuer) => issuer.role))].sort();
        if (verifiedKeyIds.length < 2 || packFingerprints.length < 2 ||
          canonical(packRoles) !== canonical(["core", "nyra"])) {
          throw new Error("policy_compiler_signature_quorum_invalid");
        }
      }
      for (const role of packRoles) verifiedRoles.add(role);
      for (const fingerprint of packFingerprints) verifiedFingerprints.add(fingerprint);
      orderedPackEvidence.push({
        pack_id: pack.pack_id,
        version: pack.version,
        pack_digest: ancestry.digest,
        scope_kind: pack.scope.kind,
        verification_kind: verificationKind,
        verified_key_ids: verifiedKeyIds,
        verified_public_key_fingerprints: packFingerprints,
        verified_roles: packRoles,
      });
    }
    if (usedReferences.size !== normalized.compilerInput.packs.length || compiledCoreRoots.length !== 1) {
      throw new Error("policy_compiler_pack_set_mismatch");
    }
    if (!["core", "nyra"].every((role) => verifiedRoles.has(role)) ||
      verifiedFingerprints.size < 2) {
      throw new Error("policy_compiler_signature_quorum_invalid");
    }

    const body = {
      schema_version: PROVENANCE_SCHEMA,
      compiler_mode: COMPILER_MODE,
      compiler_algorithm: COMPILER_ALGORITHM,
      tenant_id: normalized.tenantId,
      domain_pack_id: normalized.domainPackId,
      snapshot_digest: compiled.snapshot_digest,
      leaf_pack_digests: JSON.parse(canonical(compiled.leaf_packs)),
      ordered_pack_evidence: orderedPackEvidence,
      core_root_digest: compiledCoreRoots[0],
      catalog_digest: trust.catalogDigest,
      trust_catalog_digest: trust.trustCatalogDigest,
      compiler_build_commit: buildCommit,
      validity: JSON.parse(canonical(compiled.validity)),
      resolution: JSON.parse(canonical(compiled.resolution)),
      execution_authorized: false,
    };
    return deepFreeze({
      ...body,
      provenance_digest: digestCanonical(body),
    });
  }

  function verifyRecord(record, input) {
    const failure = Object.freeze({
      ok: false,
      provenance_verified: false,
      record_integrity_verified: false,
      derivation_reverified: false,
      execution_authorized: false,
      error: "compiled_policy_snapshot_provenance_invalid",
    });
    try {
      if (!exactProvenanceRecord(
        record,
        buildCommit,
        trust.catalogDigest,
        trust.trustCatalogDigest,
      )) return failure;
      const expected = verify(input);
      if (!safeEqual(canonical(record), canonical(expected)) ||
        record.tenant_id !== input.tenant_id ||
        record.domain_pack_id !== input.domain_pack_id ||
        record.snapshot_digest !== input.snapshot.snapshot_digest) {
        return failure;
      }
      return deepFreeze({
        ok: true,
        provenance_verified: true,
        record_integrity_verified: true,
        derivation_reverified: true,
        tenant_id: record.tenant_id,
        domain_pack_id: record.domain_pack_id,
        snapshot_digest: record.snapshot_digest,
        provenance_digest: record.provenance_digest,
        execution_authorized: false,
        error: null,
      });
    } catch {
      return failure;
    }
  }

  function verifyPersistedRecord(record, binding) {
    const failure = Object.freeze({
      ok: false,
      record_integrity_verified: false,
      derivation_reverified: false,
      execution_authorized: false,
      error: "compiled_policy_snapshot_provenance_invalid",
    });
    try {
      assertPlainJson(binding, "compiled_policy_snapshot_provenance_invalid", {
        maxDepth: 4,
        maxNodes: 16,
        maxBytes: 4_096,
        budgetCode: "compiled_policy_snapshot_provenance_invalid",
      });
      if (!isExactPlainObject(binding, PERSISTED_BINDING_FIELDS) ||
        typeof binding.tenant_id !== "string" || !ID.test(binding.tenant_id) ||
        typeof binding.domain_pack_id !== "string" || !ID.test(binding.domain_pack_id) ||
        typeof binding.snapshot_digest !== "string" || !SHA256.test(binding.snapshot_digest) ||
        typeof binding.compiler_provenance_digest !== "string" ||
        !SHA256.test(binding.compiler_provenance_digest) ||
        !exactProvenanceRecord(
          record,
          buildCommit,
          trust.catalogDigest,
          trust.trustCatalogDigest,
        ) ||
        record.tenant_id !== binding.tenant_id ||
        record.domain_pack_id !== binding.domain_pack_id ||
        record.snapshot_digest !== binding.snapshot_digest ||
        record.provenance_digest !== binding.compiler_provenance_digest) {
        return failure;
      }
      return deepFreeze({
        ok: true,
        record_integrity_verified: true,
        derivation_reverified: false,
        tenant_id: record.tenant_id,
        domain_pack_id: record.domain_pack_id,
        snapshot_digest: record.snapshot_digest,
        compiler_provenance_digest: record.provenance_digest,
        compiler_build_commit: record.compiler_build_commit,
        catalog_digest: record.catalog_digest,
        trust_catalog_digest: record.trust_catalog_digest,
        execution_authorized: false,
        error: null,
      });
    } catch {
      return failure;
    }
  }

  function status() {
    const clockReady = serverClock() !== null;
    return deepFreeze({
      schema_version: STATUS_SCHEMA,
      ready: clockReady,
      clock_ready: clockReady,
      mode: COMPILER_MODE,
      compiler_algorithm: COMPILER_ALGORITHM,
      verification_algorithm: VERIFICATION_ALGORITHM,
      traversal_budget: traversalBudget,
      compiler_build_commit: buildCommit,
      catalog_digest: trust.catalogDigest,
      trust_catalog_digest: trust.trustCatalogDigest,
      issuer_count: trust.publicIssuers.length,
      independent_key_count: new Set(
        trust.publicIssuers.map((issuer) => issuer.public_key_fingerprint),
      ).size,
      trusted_core_pack_digest_count: trust.trustedCorePackDigests.length,
      known_core_branch_count: trust.knownCoreBranchIds.length,
      known_nyra_branch_count: trust.knownNyraBranchIds.length,
      known_domain_pack_count: trust.knownDomainPackIds.length,
      execution_authorized: false,
      error: clockReady ? null : "policy_compiler_clock_unavailable",
    });
  }

  return Object.freeze({ verify, verifyRecord, verifyPersistedRecord, status });
}
