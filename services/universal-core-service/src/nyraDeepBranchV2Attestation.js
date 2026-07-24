import crypto from "node:crypto";
import { createRequire } from "node:module";
import {
  NYRA_DEEP_V2_CORE_POLICY_DECISION_RECEIPT_ISSUER,
  NYRA_DEEP_V2_CORE_POLICY_DECISION_RECEIPT_SCHEMA_VERSION,
  NYRA_DEEP_V2_EVIDENCE_LEDGER_SCHEMA_VERSION,
  nyraDeepV2CanonicalJson,
} from "./nyraDeepV2EvidenceLedger.js";

const require = createRequire(import.meta.url);
const runtime = require("../../../personal-control-center/lib/nyra-deep-branch-v2.js");

/**
 * Builds a signed, non-executing V2 evidence package from one lazy Nyra
 * runtime shard.  The package is deliberately structural: catalog hashes are
 * public integrity bindings, while all tenant/request/node/evidence/policy
 * references are domain-separated HMAC values supplied by the Core ledger.
 */

export const NYRA_DEEP_BRANCH_V2_ATTESTATION_SCHEMA_VERSION = "nyra_deep_branch_v2_attestation_v1";
export const NYRA_DEEP_BRANCH_V2_ATTESTATION_ISSUER = "skinharmony-universal-core";
export const NYRA_DEEP_BRANCH_V2_ATTESTATION_AUDIENCE = "skinharmony-nyra-core";
/**
 * Internal Core-to-attester policy receipt contract.  These snapshots never
 * cross the Federation boundary: the existing opaque evaluator payload keeps
 * its exact wire schema and carries only the derived policy snapshot hash.
 */
export const NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_BUNDLE_SCHEMA_VERSION = "nyra_deep_branch_v2_core_policy_snapshot_bundle_v1";
export const NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_SCHEMA_VERSION = "nyra_deep_branch_v2_core_policy_snapshot_v1";
export const NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_ISSUER = "skinharmony-universal-core";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const REF_PATTERN = /^[a-f0-9]{64}$/i;
const DECISION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/;
const L4_ORDER = ["method", "strategy", "verifier", "metric"];
const MAX_EXPLICIT_RECORD_REFS = 20_000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(nyraDeepV2CanonicalJson(value)).digest("hex");
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function textHash(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function safeString(value, max = 512) {
  const text = String(value || "").trim();
  return text.length > 0 && text.length <= max ? text : null;
}

function canonicalIsoEpoch(value) {
  const text = String(value || "");
  const epoch = Date.parse(text);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === text ? epoch : null;
}

function stableRecordRefs(value) {
  const raw = Array.isArray(value)
    ? value
    : isPlainObject(value)
      ? (value.evidence_refs || value.policy_refs || value.record_refs || [])
      : [];
  const refs = [];
  const visit = (item) => {
    if (typeof item === "string" && REF_PATTERN.test(item)) refs.push(item);
    else if (isPlainObject(item) && REF_PATTERN.test(String(item.record_ref || ""))) refs.push(item.record_ref);
  };
  for (const item of raw) visit(item);
  return [...new Set(refs)].slice(0, MAX_EXPLICIT_RECORD_REFS);
}

function collectRecordRefs(value) {
  if (Array.isArray(value)) return stableRecordRefs(value);
  if (!isPlainObject(value)) return [];
  return [...new Set([
    ...stableRecordRefs(value.evidence_refs),
    ...stableRecordRefs(value.policy_refs),
    ...stableRecordRefs(value.record_refs),
  ])].slice(0, MAX_EXPLICIT_RECORD_REFS);
}

function openedBranchIds(nyraNetwork) {
  const candidates = Array.isArray(nyraNetwork?.opened_branches)
    ? nyraNetwork.opened_branches
    : Array.isArray(nyraNetwork?.openedBranches)
      ? nyraNetwork.openedBranches
      : [];
  return new Set(candidates
    .map((item) => String(item?.id || item?.branch_id || item || "").trim())
    .filter(Boolean));
}

function nowEpoch(now) {
  const value = Number(now());
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : Date.now();
}

function nodeSort(left, right) {
  const order = (node) => node.level === 2
    ? 0
    : node.level === 3
      ? 1
      : 2 + L4_ORDER.indexOf(node.node_type);
  return order(left) - order(right) || left.id.localeCompare(right.id);
}

function policyDecision(records) {
  if (records.some((record) => record.decision === "deny")) return "denied";
  if (records.some((record) => record.decision === "allow")) return "satisfied";
  return "missing";
}

function evidenceSatisfied(records, minimumCount, authorityRequirement) {
  const acceptable = records.filter((record) => (
    (authorityRequirement === "independent_corroboration"
      ? record.independent === true && ["authoritative", "independent_corroboration"].includes(record.authority)
      : record.authority === "authoritative")
    && REF_PATTERN.test(String(record.evidence_ref || ""))
  ));
  const uniqueEvidence = new Map();
  for (const record of acceptable) {
    if (!uniqueEvidence.has(record.evidence_ref)) uniqueEvidence.set(record.evidence_ref, record);
  }
  const selected = [...uniqueEvidence.values()].slice(0, Math.max(0, minimumCount));
  return {
    state: selected.length >= minimumCount ? "satisfied" : "missing",
    records: selected,
  };
}

function unsignedEnvelope(envelope) {
  const value = clone(envelope);
  delete value.package_hash;
  delete value.signature;
  return value;
}

function signedEnvelope(envelope) {
  const value = clone(envelope);
  delete value.signature;
  return value;
}

function ed25519Signature(privateKey, payload) {
  return crypto.sign(null, Buffer.from(nyraDeepV2CanonicalJson(payload)), privateKey).toString("base64url");
}

function verifyEd25519(publicKey, payload, signature) {
  try {
    return crypto.verify(
      null,
      Buffer.from(nyraDeepV2CanonicalJson(payload)),
      publicKey,
      Buffer.from(String(signature || ""), "base64url")
    );
  } catch {
    return false;
  }
}

function operationalSignature(privateKey, attestation) {
  const payload = clone(attestation);
  delete payload.signature;
  return crypto.sign(
    null,
    Buffer.from(
      `nyra-deep-branch-v2-operational-attestation\u0000${nyraDeepV2CanonicalJson(payload)}`,
      "utf8"
    ),
    privateKey
  ).toString("base64url");
}

function verifyOperationalSignature(publicKey, attestation) {
  try {
    const payload = clone(attestation);
    delete payload.signature;
    return crypto.verify(
      null,
      Buffer.from(
        `nyra-deep-branch-v2-operational-attestation\u0000${nyraDeepV2CanonicalJson(payload)}`,
        "utf8"
      ),
      publicKey,
      Buffer.from(String(attestation?.signature || ""), "base64url")
    );
  } catch {
    return false;
  }
}

function opaqueNodeContext({ nodeId, contextId, payload }) {
  const raw = Buffer.from(nyraDeepV2CanonicalJson(payload), "utf8");
  return {
    schema_version: "nyra_deep_branch_v2_opaque_node_context_v1",
    node_id: nodeId,
    context_id: contextId,
    payload_encoding: "base64url_canonical_json",
    payload_sha256: sha256Bytes(raw),
    opaque_payload: raw.toString("base64url"),
  };
}

function operationalLineage(loaded, shard) {
  const index = new Map((shard?.nodes || []).map((node) => [node.id, node]));
  const ids = shard?.descriptor?.node_ids || [];
  if (ids.length !== 6 || new Set(ids).size !== 6) return null;
  const nodes = ids.map((id) => index.get(id));
  if (nodes.some((node) => !node)) return null;
  const [level2, level3, ...level4] = nodes;
  if (
    level2.level !== 2
    || level2.node_type !== "specialized_capability"
    || level3.level !== 3
    || level3.node_type !== "micro_capability"
    || level3.parent_id !== level2.id
    || level4.length !== 4
    || level4.some((node) => node.level !== 4 || node.parent_id !== level3.id)
    || JSON.stringify(level4.map((node) => node.node_type).sort()) !== JSON.stringify([...L4_ORDER].sort())
  ) return null;
  if (loaded?.manifest?.root_binding?.function_registry_hash !== level2.function_binding?.registry_hash) return null;
  return nodes.map((node) => ({
    node_id: node.id,
    parent_id: node.parent_id,
    level: node.level,
    node_type: node.node_type,
    function_binding_hash: sha256(node.function_binding || {}),
    semantic_function_hash: node.function_binding?.semantic_function_hash || null,
  }));
}

function operationalAssertion(assertion, result, evidenceIds) {
  return {
    subject: assertion.subject,
    predicate: assertion.predicate,
    object: assertion.object,
    polarity: assertion.polarity,
    key: assertion.key,
    result,
    evidence_ids: evidenceIds,
  };
}

function rootBindings(loaded) {
  const manifest = loaded?.manifest;
  const root = manifest?.root_binding;
  const catalog = manifest?.catalog;
  if (
    !loaded?.ok
    || loaded.runtime_lazy !== true
    || !manifest
    || !root
    || !catalog
    || !SHA256_PATTERN.test(String(manifest.manifest_hash || ""))
    || !SHA256_PATTERN.test(String(manifest.root_binding_hash || ""))
    || !SHA256_PATTERN.test(String(root.catalog_fingerprint || ""))
    || !SHA256_PATTERN.test(String(root.function_registry_hash || ""))
    || root.catalog_fingerprint !== catalog.catalog_fingerprint
    || root.function_registry_hash !== manifest.function_registry?.registry_hash
  ) {
    return null;
  }
  return {
    catalog_fingerprint: root.catalog_fingerprint,
    root_binding_hash: manifest.root_binding_hash,
    function_registry_hash: root.function_registry_hash,
    manifest_hash: manifest.manifest_hash,
    catalog_binding_hash: manifest.catalog_binding_hash,
  };
}

function validateSixNodeShard({ loaded, shard, branchId, subbranchId }) {
  const descriptor = shard?.descriptor;
  const nodes = Array.isArray(shard?.nodes) ? shard.nodes : [];
  const functions = Array.isArray(shard?.functions) ? shard.functions : [];
  const functionIndex = new Map(functions.map((spec) => [spec.function_id, spec]));
  if (
    !shard?.ok
    || descriptor?.branch_id !== branchId
    || descriptor?.subbranch_id !== subbranchId
    || descriptor?.node_count !== 6
    || descriptor?.function_count !== 6
    || nodes.length !== 6
    || functions.length !== 6
    || functionIndex.size !== 6
  ) return { ok: false, reason: "nyra_deep_v2_shard_contract_invalid" };

  const l2 = nodes.filter((node) => node.level === 2);
  const l3 = nodes.filter((node) => node.level === 3);
  const l4 = nodes.filter((node) => node.level === 4);
  if (
    l2.length !== 1
    || l3.length !== 1
    || l4.length !== 4
    || l2[0]?.node_type !== "specialized_capability"
    || l3[0]?.node_type !== "micro_capability"
    || l2[0]?.parent_id !== `${branchId}.${subbranchId}`
    || l3[0]?.parent_id !== l2[0]?.id
    || l4.some((node) => node.parent_id !== l3[0]?.id)
    || L4_ORDER.some((type) => !l4.some((node) => node.node_type === type))
  ) return { ok: false, reason: "nyra_deep_v2_lineage_invalid" };

  for (const node of nodes) {
    const binding = node?.function_binding;
    const spec = functionIndex.get(node?.id);
    if (
      node?.branch_id !== branchId
      || node?.supervisor_status !== "APPROVED"
      || !binding
      || binding.registry_hash !== loaded.manifest.root_binding.function_registry_hash
      || spec?.function_id !== node.id
      || spec.semantic_function_hash !== binding.semantic_function_hash
      || spec.execution_plan_hash !== binding.execution_plan_hash
      || spec.observation_contract_hash !== binding.observation_contract_hash
      || spec.semantic_source?.branch_id !== branchId
      || spec.semantic_source?.subbranch_id !== subbranchId
      || spec.semantic_source?.level !== node.level
      || spec.semantic_source?.node_type !== node.node_type
      || !Array.isArray(node.required_evidence)
      || !Array.isArray(node.core_policy_bindings)
    ) return { ok: false, reason: "nyra_deep_v2_function_binding_invalid" };
  }
  return {
    ok: true,
    descriptor,
    nodes: [...nodes].sort(nodeSort),
    functionIndex,
  };
}

/**
 * Creates a lazy-shard attester.  `ledger` must be created by
 * `createNyraDeepV2EvidenceLedger`; `signingPrivateKey` must be an Ed25519
 * private key (PEM or KeyObject).  It never evaluates/executes a Nyra node.
 */
export function createNyraDeepBranchV2Attester({
  ledger,
  signingPrivateKey,
  signingPublicKey = null,
  keyId = "universal-core-nyra-v2",
  runtimeAdapter = runtime,
  now = () => Date.now(),
} = {}) {
  if (
    !ledger
    || typeof ledger.reference !== "function"
    || typeof ledger.resolve !== "function"
    || typeof ledger.verifyCorePolicyDecisionReceipt !== "function"
  ) {
    throw new TypeError("nyra_deep_v2_attester_ledger_required");
  }
  if (!signingPrivateKey) throw new TypeError("nyra_deep_v2_attester_private_key_required");
  const privateKey = signingPrivateKey?.type === "private"
    ? signingPrivateKey
    : crypto.createPrivateKey(signingPrivateKey);
  const publicKey = signingPublicKey
    ? signingPublicKey?.type === "public"
      ? signingPublicKey
      : crypto.createPublicKey(signingPublicKey)
    : crypto.createPublicKey(privateKey);
  if (privateKey.asymmetricKeyType !== "ed25519" || publicKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("nyra_deep_v2_attester_ed25519_required");
  }
  const signerKeyId = safeString(keyId, 256) || "universal-core-nyra-v2";

  function loadShard(branchId, subbranchId, tenantId = "attestation") {
    const branch = safeString(branchId);
    const subbranch = safeString(subbranchId);
    if (!branch || !subbranch) return { ok: false, reason: "nyra_deep_v2_branch_and_subbranch_required" };
    const loaded = runtimeAdapter.loadCatalog({ runtimeMode: "lazy" });
    const artifact = rootBindings(loaded);
    if (!artifact) return { ok: false, reason: "nyra_deep_v2_manifest_binding_invalid" };
    const shard = runtimeAdapter.loadRuntimeShard({
      loaded,
      tenantId: safeString(tenantId) || "attestation",
      branchId: branch,
      subbranchId: subbranch,
    });
    const topology = validateSixNodeShard({ loaded, shard, branchId: branch, subbranchId: subbranch });
    if (!topology.ok) return topology;
    return { ok: true, branchId: branch, subbranchId: subbranch, loaded, artifact, ...topology };
  }

  function requirementRef(artifact, node, requirement, requirementIndex) {
    return `req_${ledger.reference("requirement", {
      catalog_fingerprint: artifact.catalog_fingerprint,
      root_binding_hash: artifact.root_binding_hash,
      function_registry_hash: artifact.function_registry_hash,
      node_id: node.id,
      requirement_index: requirementIndex,
      evidence_type: requirement.evidence_type,
      semantic_claim_hash: requirement.semantic_claim_hash,
    })}`;
  }

  /**
   * Raw identifiers are intentionally available only to the in-process Core
   * caller.  MCP receives the already compacted evidence requirements, not
   * this list.  Core uses it to issue exactly one policy receipt per required
   * node/binding before asking the attester for an operational package.
   */
  function corePolicySnapshotRequirements(loaded) {
    return loaded.nodes
      .flatMap((node) => node.core_policy_bindings
        .filter((binding) => binding.core_decision_required === true)
        .map((binding) => ({
          node_id: node.id,
          branch_id: loaded.branchId,
          subbranch_id: loaded.subbranchId,
          policy_id: binding.policy_id,
          effect: binding.effect,
          core_decision_required: true,
        })))
      .sort((left, right) => (
        left.node_id.localeCompare(right.node_id)
        || left.policy_id.localeCompare(right.policy_id)
        || left.effect.localeCompare(right.effect)
      ));
  }

  function policySnapshotKey({ node_id: nodeId, policy_id: policyId, effect } = {}) {
    return [nodeId, policyId, effect].map((value) => String(value || "")).join("\u0000");
  }

  /**
   * Produces the deterministic opaque requirement refs needed by MCP evidence
   * intake.  It reads exactly one verified lazy shard, never the V2 monolith.
   */
  function requirementBindings({ branchId, subbranchId } = {}) {
    const loaded = loadShard(branchId, subbranchId);
    if (!loaded.ok) return { ok: false, reason: loaded.reason, requirement_bindings: [] };
    const bindings = loaded.nodes.flatMap((node) => node.required_evidence.map((requirement, index) => ({
      requirement_ref: requirementRef(loaded.artifact, node, requirement, index),
      node_ref: ledger.reference("node", node.id),
      level: node.level,
      node_type: node.node_type,
      minimum_count: Math.max(1, Number(requirement.minimum_count) || 1),
      authority_requirement: String(requirement.authority_requirement || "unverified"),
    })));
    const policies = loaded.nodes.flatMap((node) => node.core_policy_bindings.map((binding) => ({
      node_ref: ledger.reference("node", node.id),
      policy_ref: ledger.reference("policy", binding.policy_id),
      core_decision_required: binding.core_decision_required === true,
    })));
    return {
      ok: true,
      catalog: clone(loaded.artifact),
      branch_ref: ledger.reference("branch", loaded.branchId),
      subbranch_ref: ledger.reference("subbranch", { branch_id: loaded.branchId, subbranch_id: loaded.subbranchId }),
      requirement_bindings: bindings,
      policy_bindings: policies,
      core_policy_snapshot_requirements: corePolicySnapshotRequirements(loaded),
    };
  }

  /**
   * Core-only discovery for the strict operational receipt bundle.  It reads
   * the same verified lazy shard as the attester, so an application caller
   * cannot invent a node/policy pair that will later be accepted.
   */
  function operationalPolicySnapshotRequirements({ branchId, subbranchId } = {}) {
    const loaded = loadShard(branchId, subbranchId);
    if (!loaded.ok) return { ok: false, reason: loaded.reason, requirements: [] };
    return {
      ok: true,
      requirements: clone(corePolicySnapshotRequirements(loaded)),
    };
  }

  function nodeEvidenceAtoms({ tenantId, requestId, explicitRecordRefs, loaded, node }) {
    return node.required_evidence.map((requirement, index) => {
      const expectedRequirementRef = requirementRef(loaded.artifact, node, requirement, index);
      const resolved = ledger.resolve({
        tenantId,
        requestId,
        recordRefs: explicitRecordRefs,
        requirementRef: expectedRequirementRef,
        kind: "evidence",
        nodeId: node.id,
        now: nowEpoch(now),
      });
      const result = evidenceSatisfied(
        resolved.ok ? resolved.records : [],
        Math.max(1, Number(requirement.minimum_count) || 1),
        String(requirement.authority_requirement || "unverified")
      );
      return {
        requirement_ref: expectedRequirementRef,
        required_count: Math.max(1, Number(requirement.minimum_count) || 1),
        authority_ref: ledger.reference("authority", requirement.authority_requirement),
        state: result.state,
        evidence_record_refs: result.records.map((record) => record.record_ref),
        evidence_refs: result.records.map((record) => record.evidence_ref),
      };
    });
  }

  function nodePolicyAtoms({ tenantId, requestId, explicitRecordRefs, node }) {
    return node.core_policy_bindings.map((binding) => {
      const policyRef = ledger.reference("policy", binding.policy_id);
      if (binding.core_decision_required !== true) {
        return { policy_ref: policyRef, state: "not_required", policy_record_refs: [] };
      }
      const resolved = ledger.resolve({
        tenantId,
        requestId,
        recordRefs: explicitRecordRefs,
        policyRef,
        nodeId: node.id,
        kind: "policy",
        now: nowEpoch(now),
      });
      const state = policyDecision(resolved.ok ? resolved.records : []);
      return {
        policy_ref: policyRef,
        state,
        policy_record_refs: (resolved.ok ? resolved.records : []).map((record) => record.record_ref),
      };
    });
  }

  function qualifyingEvidenceRecords({
    tenantId,
    requestId,
    explicitRecordRefs,
    loaded,
    node,
    requirement,
    requirementIndex,
    observedAt,
    evidenceSessionRef = null,
  }) {
    const resolved = ledger.resolve({
      tenantId,
      requestId,
      recordRefs: explicitRecordRefs,
      requirementRef: requirementRef(loaded.artifact, node, requirement, requirementIndex),
      kind: "evidence",
      nodeId: node.id,
      branchId: loaded.branchId,
      subbranchId: loaded.subbranchId,
      evidenceSessionRef,
      allowSessionHandoff: Boolean(evidenceSessionRef),
      now: observedAt,
    });
    return evidenceSatisfied(
      resolved.ok ? resolved.records : [],
      Math.max(1, Number(requirement.minimum_count) || 1),
      String(requirement.authority_requirement || "unverified")
    );
  }

  /**
   * Validates the Core-issued decision receipts before any evaluator payload
   * can contain `ALLOW`.  The old operational path inferred permission from
   * booleans and/or ledger policy atoms; this deliberately has neither path.
   *
   * A malformed bundle fails closed for every node.  A structurally valid
   * explicit DENY is intentionally isolated to its own node/binding so that
   * audit can distinguish it from a transport/schema failure.
   */
  function validateCorePolicySnapshotBundle({
    corePolicyContext,
    tenantId,
    requestId,
    branchId,
    subbranchId,
    preflightId,
    corePolicyHash,
    issuedAt,
    expiresAt,
    observedAt,
    loaded,
  }) {
    const requirements = corePolicySnapshotRequirements(loaded);
    const requirementByKey = new Map(requirements.map((requirement) => [policySnapshotKey(requirement), requirement]));
    const rejected = (reason) => Object.freeze({
      structurally_valid: false,
      reason,
      decisionFor: () => ({ decision: "DENY", decision_id: null }),
    });
    if (requirements.length === 0 || requirementByKey.size !== requirements.length) {
      return rejected("nyra_deep_v2_policy_snapshot_requirements_invalid");
    }
    if (!exactKeys(corePolicyContext, ["schema_version", "policy_snapshots"])
      || corePolicyContext.schema_version !== NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_BUNDLE_SCHEMA_VERSION
      || !Array.isArray(corePolicyContext.policy_snapshots)
      || corePolicyContext.policy_snapshots.length !== requirements.length) {
      return rejected("nyra_deep_v2_policy_snapshot_bundle_invalid");
    }

    const snapshots = new Map();
    const decisionIds = new Set();
    for (const snapshot of corePolicyContext.policy_snapshots) {
      if (!exactKeys(snapshot, [
        "schema_version",
        "issuer",
        "decision_id",
        "decision_receipt",
        "decision",
        "tenant_id",
        "request_id",
        "branch_id",
        "subbranch_id",
        "node_id",
        "policy_id",
        "effect",
        "preflight_id",
        "core_policy_hash",
        "issued_at",
        "expires_at",
      ])) return rejected("nyra_deep_v2_policy_snapshot_schema_invalid");
      const decisionId = safeString(snapshot.decision_id, 256);
      const snapshotIssuedAt = canonicalIsoEpoch(snapshot.issued_at);
      const snapshotExpiresAt = canonicalIsoEpoch(snapshot.expires_at);
      const receiptHeaderValid = isPlainObject(snapshot.decision_receipt)
        && snapshot.decision_receipt.schema_version === NYRA_DEEP_V2_CORE_POLICY_DECISION_RECEIPT_SCHEMA_VERSION
        && snapshot.decision_receipt.issuer === NYRA_DEEP_V2_CORE_POLICY_DECISION_RECEIPT_ISSUER;
      const receiptVerification = receiptHeaderValid
        ? ledger.verifyCorePolicyDecisionReceipt({
          receipt: snapshot.decision_receipt,
          tenantId,
          requestId,
          branchId,
          subbranchId,
          nodeId: snapshot.node_id,
          policyId: snapshot.policy_id,
          effect: snapshot.effect,
          decision: snapshot.decision,
          decisionId,
          preflightId,
          corePolicyHash,
          issuedAt: snapshot.issued_at,
          expiresAt: snapshot.expires_at,
          observedAt,
        })
        : { ok: false };
      if (
        snapshot.schema_version !== NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_SCHEMA_VERSION
        || snapshot.issuer !== NYRA_DEEP_BRANCH_V2_CORE_POLICY_SNAPSHOT_ISSUER
        || !decisionId
        || !DECISION_ID_PATTERN.test(decisionId)
        || decisionIds.has(decisionId)
        || !["ALLOW", "DENY"].includes(snapshot.decision)
        || snapshot.tenant_id !== tenantId
        || snapshot.request_id !== requestId
        || snapshot.branch_id !== branchId
        || snapshot.subbranch_id !== subbranchId
        || snapshot.preflight_id !== preflightId
        || snapshot.core_policy_hash !== corePolicyHash
        || !Number.isFinite(snapshotIssuedAt)
        || !Number.isFinite(snapshotExpiresAt)
        || snapshotExpiresAt <= snapshotIssuedAt
        || snapshotIssuedAt < issuedAt
        || snapshotExpiresAt > expiresAt
        || snapshotIssuedAt > observedAt
        || snapshotExpiresAt <= observedAt
        || receiptVerification.ok !== true
      ) return rejected("nyra_deep_v2_policy_snapshot_scope_or_time_invalid");
      const key = policySnapshotKey(snapshot);
      if (!requirementByKey.has(key) || snapshots.has(key)) {
        return rejected("nyra_deep_v2_policy_snapshot_coverage_invalid");
      }
      decisionIds.add(decisionId);
      snapshots.set(key, snapshot);
    }
    if (snapshots.size !== requirements.length) {
      return rejected("nyra_deep_v2_policy_snapshot_coverage_invalid");
    }
    return Object.freeze({
      structurally_valid: true,
      reason: null,
      decisionFor(node, binding) {
        if (binding?.core_decision_required !== true) return { decision: "DENY", decision_id: null };
        const snapshot = snapshots.get(policySnapshotKey({
          node_id: node?.id,
          policy_id: binding?.policy_id,
          effect: binding?.effect,
        }));
        return {
          decision: snapshot?.decision === "ALLOW" ? "ALLOW" : "DENY",
          decision_id: snapshot?.decision_id || null,
        };
      },
    });
  }

  function corePolicyDecisions({
    tenantId,
    node,
    evidenceManifestHash,
    policySnapshotValidation,
  }) {
    return node.core_policy_bindings.map((binding) => {
      const source = policySnapshotValidation?.decisionFor(node, binding) || { decision: "DENY", decision_id: null };
      const decision = source.decision === "ALLOW" ? "ALLOW" : "DENY";
      // This stays byte-for-byte compatible with the Federation's exact-key
      // wire contract.  The Core-only decision_id is never serialized here.
      const snapshot = {
        issuer: "universal_core",
        tenant_id: tenantId,
        node_id: node.id,
        branch_id: node.branch_id,
        policy_id: binding.policy_id,
        effect: binding.effect,
        decision,
        semantic_hash: node.semantic_contract.semantic_hash,
        function_registry_hash: node.function_binding.registry_hash,
        semantic_function_hash: node.function_binding.semantic_function_hash,
        evidence_manifest_hash: evidenceManifestHash,
      };
      return {
        policy_id: binding.policy_id,
        effect: binding.effect,
        decision,
        snapshot,
        snapshot_hash: sha256(snapshot),
      };
    });
  }

  function operationalNodeContext({
    tenantId,
    requestId,
    explicitRecordRefs,
    loaded,
    node,
    functionSpec,
    nodeIndex,
    observedAt,
    evidenceSessionRef = null,
    policySnapshotValidation = null,
  }) {
    const method = node.methods?.[0];
    const parameters = method?.parameters;
    const assertions = functionSpec?.semantic_assertions;
    if (!method || !parameters || !assertions || !method.input_field) {
      return { ok: false, reason: "nyra_deep_v2_operational_method_contract_invalid" };
    }
    const planned = node.required_evidence.flatMap((requirement, requirementIndex) => {
      const match = qualifyingEvidenceRecords({
        tenantId,
        requestId,
        explicitRecordRefs,
        loaded,
        node,
        requirement,
        requirementIndex,
        observedAt,
        evidenceSessionRef,
      });
      return match.records.map((record, recordIndex) => ({
        requirement,
        requirement_index: requirementIndex,
        record,
        evidence_id: `ev_${nodeIndex}_${requirementIndex}_${recordIndex}_${record.evidence_ref.slice(0, 24)}`,
      }));
    });
    const evidenceIds = planned.map((item) => item.evidence_id);
    const subject = `subject_${ledger.reference("operational-subject", {
      tenant_id: tenantId,
      request_id: requestId,
      node_id: node.id,
    }).slice(0, 48)}`;
    const recordId = `record_${ledger.reference("operational-record", {
      tenant_id: tenantId,
      request_id: requestId,
      node_id: node.id,
    }).slice(0, 48)}`;
    const allStaticFacts = [...new Set([
      assertions.problem_resolution?.object,
      ...(assertions.evidence_support || []).map((item) => item.object),
      ...(assertions.failure_absence || []).map((item) => item.object),
      assertions.boundary_preservation?.object,
      ...node.required_evidence.map((item) => item.description),
    ].filter((value) => typeof value === "string" && value.length >= 8))];
    const observation = {
      function_hash: functionSpec.semantic_function_hash,
      problem_resolution: operationalAssertion(assertions.problem_resolution, "resolved", evidenceIds),
      evidence_support: (assertions.evidence_support || []).map((item) => operationalAssertion(item, "supported", evidenceIds)),
      failure_absence: (assertions.failure_absence || []).map((item) => operationalAssertion(item, "not_observed", evidenceIds)),
      boundary_preservation: operationalAssertion(assertions.boundary_preservation, "preserved", evidenceIds),
      artifact_refs: [{
        ref: `artifact_${ledger.reference("operational-artifact", node.id).slice(0, 48)}`,
        sha256: ledger.reference("operational-artifact-hash", {
          node_id: node.id,
          package_hash: loaded.descriptor.uncompressed_sha256,
        }),
      }],
    };
    const capabilityInput = {
      subbranch_id: loaded.subbranchId,
      mechanism_id: parameters.mechanism_id,
      capability_spec_hash: parameters.capability_spec_hash,
      problem_statement: node.problem_solved,
      evidence_requirement_tags: [...parameters.evidence_tags],
      failure_mode_candidates: [...parameters.failure_mode_ids],
      subject,
      records: [{
        id: recordId,
        semantic_observation: observation,
        claim_hash: parameters.record_claim_hash,
        status: "verified",
        observed_at: new Date(observedAt).toISOString(),
        relations: [],
        failure_signals: [],
      }],
    };
    const capabilityInputHash = sha256(capabilityInput);
    const subjectHash = sha256(subject);
    const recordHashes = capabilityInput.records.map((record) => sha256(record));
    const evidence = planned.map((item) => {
      const content = {
        source_ref: `source_${item.record.source_ref.slice(0, 48)}`,
        facts: allStaticFacts,
        tags: [item.requirement.content_tag],
        claim: item.requirement.description,
        claim_hash: item.requirement.semantic_claim_hash,
        semantic_hash: node.semantic_contract.semantic_hash,
        capability_input_hash: capabilityInputHash,
        subject_hash: subjectHash,
        record_hashes: recordHashes,
      };
      const itemPayload = {
        evidence_id: item.evidence_id,
        evidence_type: item.requirement.evidence_type,
        tenant_id: tenantId,
        authority: item.requirement.authority_requirement,
        independent: item.requirement.authority_requirement === "independent_corroboration",
        content_tags: [item.requirement.content_tag],
        content,
        observed_at: new Date(observedAt).toISOString(),
      };
      const payload_hash = sha256(content);
      return {
        ...itemPayload,
        payload_hash,
        provenance_hash: sha256({
          tenant_id: itemPayload.tenant_id,
          evidence_type: itemPayload.evidence_type,
          authority: itemPayload.authority,
          independent: itemPayload.independent,
          content,
          payload_hash,
          observed_at: itemPayload.observed_at,
        }),
      };
    });
    const manifestPayload = {
      issuer: "universal_core",
      tenant_id: tenantId,
      node_id: node.id,
      branch_id: node.branch_id,
      semantic_hash: node.semantic_contract.semantic_hash,
      function_registry_hash: node.function_binding.registry_hash,
      semantic_function_hash: node.function_binding.semantic_function_hash,
      capability_input_hash: capabilityInputHash,
      evidence_hashes: evidence.map((item) => item.provenance_hash),
    };
    const evidenceManifest = { ...manifestPayload, manifest_hash: sha256(manifestPayload) };
    const policyDecisions = corePolicyDecisions({
      tenantId,
      node,
      evidenceManifestHash: evidenceManifest.manifest_hash,
      policySnapshotValidation,
    });
    const payload = {
      node_id: node.id,
      capability_input: capabilityInput,
      evidence,
      evidence_manifest: evidenceManifest,
      policy_decisions: policyDecisions,
    };
    const fullyQualified = planned.length === node.required_evidence.reduce(
      (sum, requirement) => sum + Math.max(1, Number(requirement.minimum_count) || 1),
      0
    ) && policyDecisions.length === node.core_policy_bindings.filter((binding) => binding.core_decision_required === true).length
      && policyDecisions.every((item) => item.decision === "ALLOW");
    return {
      ok: true,
      fully_qualified: fullyQualified,
      context: opaqueNodeContext({
        nodeId: node.id,
        contextId: `opctx_${nodeIndex}_${ledger.reference("operational-context", {
          tenant_id: tenantId,
          request_id: requestId,
          node_id: node.id,
          observed_at: observedAt,
        }).slice(0, 48)}`,
        payload,
      }),
    };
  }

  /**
   * Prepares a six-node L2 → L3 → four-L4 package.  The result is valid even
   * without evidence: every affected atom is explicitly `missing` and each
   * node/package is `abstaining`; no positive evidence is invented.
   */
  function prepare({
    tenantId,
    requestId,
    domainPackId,
    nyraNetwork = {},
    branchContext = {},
    workPreflight = {},
    selectedByCore = {},
    evidenceRefs = [],
    branchId,
    subbranchId,
  } = {}) {
    const tenant = safeString(tenantId);
    const request = safeString(requestId);
    const domain = safeString(domainPackId, 128);
    if (!tenant || !request || !domain) return { ok: false, reason: "nyra_deep_v2_tenant_request_domain_required" };
    if (domain !== "skinharmony") return { ok: false, reason: "nyra_deep_v2_domain_pack_not_supported" };
    if (!openedBranchIds(nyraNetwork).has(branchId)) {
      return { ok: false, reason: "nyra_deep_v2_core_branch_not_open" };
    }
    if (branchContext?.branch_id && String(branchContext.branch_id) !== String(branchId)) {
      return { ok: false, reason: "nyra_deep_v2_branch_context_mismatch" };
    }
    const preflightId = safeString(workPreflight?.preflight_id || workPreflight?.id);
    if (!preflightId || String(workPreflight?.state || "").toLowerCase().includes("denied")) {
      return { ok: false, reason: "nyra_deep_v2_core_preflight_required" };
    }

    const loaded = loadShard(branchId, subbranchId, tenant);
    if (!loaded.ok) return { ok: false, reason: loaded.reason };
    const explicitRecordRefs = collectRecordRefs(evidenceRefs);
    const nodePackages = loaded.nodes.map((node) => {
      const evidence_atoms = nodeEvidenceAtoms({
        tenantId: tenant,
        requestId: request,
        explicitRecordRefs,
        loaded,
        node,
      });
      const policy_atoms = nodePolicyAtoms({
        tenantId: tenant,
        requestId: request,
        explicitRecordRefs,
        node,
      });
      const hasDenial = policy_atoms.some((atom) => atom.state === "denied");
      const fullySupported = evidence_atoms.every((atom) => atom.state === "satisfied")
        && policy_atoms.every((atom) => atom.state === "satisfied" || atom.state === "not_required");
      return {
        node_ref: ledger.reference("node", node.id),
        parent_ref: ledger.reference("node-parent", node.parent_id),
        lineage_ref: ledger.reference("lineage", {
          branch_id: loaded.branchId,
          subbranch_id: loaded.subbranchId,
          node_id: node.id,
          parent_id: node.parent_id,
          level: node.level,
          node_type: node.node_type,
        }),
        level: node.level,
        node_type: node.node_type,
        function_ref: ledger.reference("function", node.function_binding.semantic_function_hash),
        contract_ref: ledger.reference("node-contract", {
          semantic_hash: node.semantic_contract?.semantic_hash,
          function_hash: node.function_binding.semantic_function_hash,
          execution_plan_hash: node.function_binding.execution_plan_hash,
          observation_contract_hash: node.function_binding.observation_contract_hash,
        }),
        fallback_ref: ledger.reference("fallback", node.fallback_node),
        evidence_atoms,
        policy_atoms,
        state: hasDenial ? "denied" : fullySupported ? "supported" : "abstaining",
      };
    });

    const packageState = nodePackages.some((node) => node.state === "denied")
      ? "denied"
      : nodePackages.every((node) => node.state === "supported")
        ? "attested"
        : "abstaining";
    const issuedAt = new Date(nowEpoch(now)).toISOString();
    const envelope = {
      schema_version: NYRA_DEEP_BRANCH_V2_ATTESTATION_SCHEMA_VERSION,
      issuer: NYRA_DEEP_BRANCH_V2_ATTESTATION_ISSUER,
      audience: NYRA_DEEP_BRANCH_V2_ATTESTATION_AUDIENCE,
      issued_at: issuedAt,
      ledger_schema_version: NYRA_DEEP_V2_EVIDENCE_LEDGER_SCHEMA_VERSION,
      tenant_ref: ledger.reference("tenant", tenant),
      request_ref: ledger.reference("request", { tenant, request }),
      domain_pack_ref: ledger.reference("domain-pack", domain),
      branch_ref: ledger.reference("branch", loaded.branchId),
      subbranch_ref: ledger.reference("subbranch", { branch_id: loaded.branchId, subbranch_id: loaded.subbranchId }),
      catalog: clone(loaded.artifact),
      core_context: {
        preflight_ref: ledger.reference("preflight", {
          id: preflightId,
          state: workPreflight?.state || null,
          mandatory: workPreflight?.mandatory === true,
        }),
        selected_by_core_ref: ledger.reference("selected-by-core", selectedByCore),
        network_ref: ledger.reference("nyra-network", nyraNetwork),
        branch_context_ref: ledger.reference("branch-context", branchContext),
      },
      nodes: nodePackages,
      package_state: packageState,
      execution_authorized: false,
      core_final_authority: true,
      fallback: "nyra_neural_branch_network_v1",
      signer: { algorithm: "Ed25519", key_id: signerKeyId },
    };
    envelope.evidence_package_hash = sha256({
      tenant_ref: envelope.tenant_ref,
      request_ref: envelope.request_ref,
      catalog: envelope.catalog,
      nodes: envelope.nodes.map((node) => ({
        node_ref: node.node_ref,
        evidence_atoms: node.evidence_atoms,
        policy_atoms: node.policy_atoms,
      })),
    });
    envelope.package_hash = sha256(unsignedEnvelope(envelope));
    envelope.signature = ed25519Signature(privateKey, signedEnvelope(envelope));
    return { ok: true, attestation: envelope };
  }

  /**
   * Produces the exact Federation operational-attestation schema.  Universal
   * Core must construct and HMAC-sign its base envelope first, then pass the
   * resulting binding hash here.  This method only creates opaque, bounded
   * evaluator contexts from verified ledger records and static node contracts.
   * It never claims success when any evidence/policy atom is missing.
   */
  function prepareOperational({
    tenantId,
    requestId,
    domainPackId = "skinharmony",
    branchId,
    subbranchId,
    preflightId,
    corePolicyHash,
    envelopeBindingHash,
    issuedAt,
    expiresAt,
    observedAt,
    evidenceRefs = [],
    evidenceSessionRef = null,
    corePolicyContext = null,
    nonce = null,
  } = {}) {
    const tenant = safeString(tenantId);
    const request = safeString(requestId, 160);
    const domain = safeString(domainPackId, 128);
    const preflight = safeString(preflightId, 160);
    const branch = safeString(branchId, 128);
    const subbranch = safeString(subbranchId, 128);
    const observed = Number(observedAt);
    const issued = Date.parse(String(issuedAt || ""));
    const expires = Date.parse(String(expiresAt || ""));
    const attestationNonce = nonce ? String(nonce) : crypto.randomBytes(32).toString("hex");
    if (
      !tenant || !request || !preflight || !branch || !subbranch || domain !== "skinharmony"
      || !SHA256_PATTERN.test(String(corePolicyHash || ""))
      || !SHA256_PATTERN.test(String(envelopeBindingHash || ""))
      || !Number.isFinite(observed)
      || !Number.isFinite(issued)
      || !Number.isFinite(expires)
      || expires <= issued
      || expires - issued > 60_000
      || !/^[a-f0-9]{32,128}$/i.test(attestationNonce)
    ) return { ok: false, reason: "nyra_deep_v2_operational_input_invalid" };

    const loaded = loadShard(branch, subbranch, tenant);
    if (!loaded.ok) return { ok: false, reason: loaded.reason };
    const lineage = operationalLineage(loaded.loaded, loaded);
    if (!lineage) return { ok: false, reason: "nyra_deep_v2_operational_lineage_invalid" };
    const explicitRecordRefs = collectRecordRefs(evidenceRefs);
    const nodeById = new Map(loaded.nodes.map((node) => [node.id, node]));
    const policySnapshotValidation = validateCorePolicySnapshotBundle({
      corePolicyContext,
      tenantId: tenant,
      requestId: request,
      branchId: branch,
      subbranchId: subbranch,
      preflightId: preflight,
      corePolicyHash: String(corePolicyHash),
      issuedAt: issued,
      expiresAt: expires,
      observedAt: Math.floor(observed),
      loaded,
    });
    const contexts = [];
    let allQualified = true;
    for (const [index, lineageNode] of lineage.entries()) {
      const node = nodeById.get(lineageNode.node_id);
      const context = operationalNodeContext({
        tenantId: tenant,
        requestId: request,
        explicitRecordRefs,
        loaded,
        node,
        functionSpec: loaded.functionIndex.get(node?.id),
        nodeIndex: index,
        observedAt: Math.floor(observed),
        evidenceSessionRef,
        policySnapshotValidation,
      });
      if (!context.ok) return { ok: false, reason: context.reason };
      contexts.push(context.context);
      allQualified = allQualified && context.fully_qualified;
    }
    const attestation = {
      schema_version: "nyra_deep_branch_v2_operational_attestation_v1",
      issuer: NYRA_DEEP_BRANCH_V2_ATTESTATION_ISSUER,
      audience: NYRA_DEEP_BRANCH_V2_ATTESTATION_AUDIENCE,
      key_id: signerKeyId,
      tenant_id: tenant,
      request_id: request,
      domain_pack: domain,
      branch_id: branch,
      subbranch_id: subbranch,
      preflight_id: preflight,
      core_policy_hash: String(corePolicyHash),
      envelope_binding_hash: String(envelopeBindingHash),
      catalog_fingerprint: loaded.artifact.catalog_fingerprint,
      root_binding_hash: loaded.artifact.root_binding_hash,
      function_registry_hash: loaded.artifact.function_registry_hash,
      package_hash: loaded.descriptor.uncompressed_sha256,
      lineage,
      node_contexts: contexts,
      nonce: attestationNonce,
      issued_at: new Date(issued).toISOString(),
      expires_at: new Date(expires).toISOString(),
      observed_at: Math.floor(observed),
    };
    attestation.signature = operationalSignature(privateKey, attestation);
    return {
      ok: true,
      state: allQualified ? "operational_attestation_ready" : "operational_attestation_abstaining",
      advisory_qualified: allQualified,
      attestation,
    };
  }

  /** Verifies Ed25519 integrity and optional tenant/request ownership. */
  function verify(attestation, { tenantId = null, requestId = null } = {}) {
    if (!isPlainObject(attestation) || attestation.schema_version !== NYRA_DEEP_BRANCH_V2_ATTESTATION_SCHEMA_VERSION) {
      return { ok: false, reason: "nyra_deep_v2_attestation_schema_invalid" };
    }
    if (attestation.package_hash !== sha256(unsignedEnvelope(attestation))) {
      return { ok: false, reason: "nyra_deep_v2_attestation_package_hash_invalid" };
    }
    if (!verifyEd25519(publicKey, signedEnvelope(attestation), attestation.signature)) {
      return { ok: false, reason: "nyra_deep_v2_attestation_signature_invalid" };
    }
    if (tenantId && attestation.tenant_ref !== ledger.reference("tenant", tenantId)) {
      return { ok: false, reason: "nyra_deep_v2_attestation_tenant_mismatch" };
    }
    if (tenantId && requestId && attestation.request_ref !== ledger.reference("request", { tenant: tenantId, request: requestId })) {
      return { ok: false, reason: "nyra_deep_v2_attestation_request_mismatch" };
    }
    return { ok: true };
  }

  function verifyOperational(attestation, { tenantId = null, requestId = null } = {}) {
    if (
      !isPlainObject(attestation)
      || attestation.schema_version !== "nyra_deep_branch_v2_operational_attestation_v1"
      || attestation.issuer !== NYRA_DEEP_BRANCH_V2_ATTESTATION_ISSUER
      || attestation.audience !== NYRA_DEEP_BRANCH_V2_ATTESTATION_AUDIENCE
      || attestation.key_id !== signerKeyId
      || !verifyOperationalSignature(publicKey, attestation)
    ) return { ok: false, reason: "nyra_deep_v2_operational_signature_invalid" };
    if (tenantId && attestation.tenant_id !== tenantId) return { ok: false, reason: "nyra_deep_v2_operational_tenant_mismatch" };
    if (requestId && attestation.request_id !== requestId) return { ok: false, reason: "nyra_deep_v2_operational_request_mismatch" };
    return { ok: true };
  }

  return Object.freeze({
    prepare,
    prepareOperational,
    requirementBindings,
    operationalPolicySnapshotRequirements,
    verify,
    verifyOperational,
  });
}
