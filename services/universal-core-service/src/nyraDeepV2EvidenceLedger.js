import crypto from "node:crypto";

/**
 * Nyra Deep V2 keeps research evidence out of its routing envelopes.  This
 * module is the narrow bridge between a Core-owned evidence intake and the
 * V2 attester: it retains only opaque references plus time/authority metadata.
 *
 * In particular, raw claim text, memory, URLs and source documents are used
 * only to derive keyed references during ingestion.  They are never kept in
 * the ledger or returned by its public API.
 */

export const NYRA_DEEP_V2_EVIDENCE_LEDGER_SCHEMA_VERSION = "nyra_deep_v2_evidence_ledger_v1";
export const NYRA_DEEP_V2_CORE_POLICY_DECISION_RECEIPT_SCHEMA_VERSION = "nyra_deep_v2_core_policy_decision_receipt_v1";
export const NYRA_DEEP_V2_CORE_POLICY_DECISION_RECEIPT_ISSUER = "skinharmony-universal-core";

const REFERENCE_PATTERN = /^[a-f0-9]{64}$/i;
const REQUIREMENT_REFERENCE_PATTERN = /^req_[a-f0-9]{64}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const CORE_RECEIPT_ID_PATTERN = /^ev_[a-f0-9-]{36}$/i;
const CORE_SOURCE_RECEIPT_BUNDLE_SCHEMA_VERSION = "nyra_deep_v2_core_source_receipt_bundle_v1";
const CORE_SOURCE_RECEIPT_ISSUER = "skinharmony-universal-core";
const MAX_RECORDS = 50_000;
const MAX_BINDINGS_PER_INGEST = 2_000;
const MAX_RECORD_REFS_PER_QUERY = 10_000;
const MAX_EVIDENCE_SESSION_MS = 5 * 60_000;
const VALID_AUTHORITY = new Set([
  "authoritative",
  "independent_corroboration",
  "unverified",
]);
const VALID_POLICY_DECISIONS = new Set(["allow", "deny", "abstain"]);
const VALID_CORE_POLICY_DECISIONS = new Set(["ALLOW", "DENY"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("ledger_non_finite_number");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined) result[key] = canonicalValue(value[key]);
        return result;
      }, {});
  }
  throw new TypeError("ledger_non_json_value");
}

/** Stable JSON encoding used before every hash/signature operation. */
export function nyraDeepV2CanonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hmac(secret, domain, value) {
  return crypto
    .createHmac("sha256", secret)
    .update(`nyra-deep-v2/${domain}\u0000${nyraDeepV2CanonicalJson(value)}`)
    .digest("hex");
}

function sha256(value) {
  return crypto.createHash("sha256").update(nyraDeepV2CanonicalJson(value)).digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function normalizeEpoch(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function canonicalIsoEpoch(value) {
  const text = String(value || "");
  const epoch = Date.parse(text);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === text ? epoch : null;
}

function normalizeAuthority(value) {
  const normalized = String(value || "unverified").trim().toLowerCase();
  return VALID_AUTHORITY.has(normalized) ? normalized : "unverified";
}

function normalizePolicyDecision(value) {
  const normalized = String(value || "abstain").trim().toLowerCase();
  if (normalized === "satisfied" || normalized === "approved") return "allow";
  return VALID_POLICY_DECISIONS.has(normalized) ? normalized : "abstain";
}

function compactString(value, max = 512) {
  const text = String(value || "").trim();
  return text.length > 0 && text.length <= max ? text : null;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function bindingList(bindings) {
  if (Array.isArray(bindings)) return bindings;
  if (isPlainObject(bindings) && Array.isArray(bindings.requirement_bindings)) {
    return bindings.requirement_bindings;
  }
  return [];
}

function evidenceClaims(evidencePack) {
  if (!isPlainObject(evidencePack)) return [];
  return list(evidencePack.claims || evidencePack.evidence || evidencePack.records);
}

function policyAtoms(evidencePack) {
  if (!isPlainObject(evidencePack)) return [];
  return list(evidencePack.policy_atoms || evidencePack.policy_decisions || evidencePack.policies);
}

function sourceIndex(evidencePack) {
  const byId = new Map();
  for (const source of list(evidencePack?.sources)) {
    const id = compactString(source?.id || source?.source_id || source?.source_ref);
    if (id && !byId.has(id)) byId.set(id, source);
  }
  return byId;
}

function claimIndex(evidencePack) {
  const byId = new Map();
  for (const claim of evidenceClaims(evidencePack)) {
    const id = compactString(claim?.id || claim?.claim_id || claim?.claim_ref);
    if (id && !byId.has(id)) byId.set(id, claim);
  }
  return byId;
}

function validationIndex(evidencePack) {
  const byId = new Map();
  const candidates = [
    ...list(evidencePack?.validated_claims),
    ...list(evidencePack?.validated_evidence),
    ...list(evidencePack?.validation_results),
  ];
  for (const validation of candidates) {
    const id = compactString(validation?.id || validation?.claim_id || validation?.claim_ref);
    if (id && !byId.has(id)) byId.set(id, validation);
  }
  return byId;
}

function coreSourceReceiptValid(receipt, expectedSourceIds) {
  if (!exactKeys(receipt, ["schema_version", "issuer", "receipt_ids", "sources"])
    || receipt.schema_version !== CORE_SOURCE_RECEIPT_BUNDLE_SCHEMA_VERSION
    || receipt.issuer !== CORE_SOURCE_RECEIPT_ISSUER
    || !Array.isArray(receipt.receipt_ids)
    || !Array.isArray(receipt.sources)
    || receipt.receipt_ids.length < 1
    || receipt.receipt_ids.length > 64
    || receipt.sources.length !== receipt.receipt_ids.length
    || receipt.sources.length !== expectedSourceIds.length) return false;
  const receiptIds = new Set();
  for (const receiptId of receipt.receipt_ids) {
    if (!CORE_RECEIPT_ID_PATTERN.test(String(receiptId || "")) || receiptIds.has(receiptId)) return false;
    receiptIds.add(receiptId);
  }
  const suppliedSourceIds = new Set();
  for (const source of receipt.sources) {
    if (!exactKeys(source, ["source_id", "source_url_sha256", "content_sha256", "excerpt_sha256"])
      || !expectedSourceIds.includes(source.source_id)
      || suppliedSourceIds.has(source.source_id)
      || !SHA256_PATTERN.test(String(source.source_url_sha256 || ""))
      || !SHA256_PATTERN.test(String(source.content_sha256 || ""))
      || !SHA256_PATTERN.test(String(source.excerpt_sha256 || ""))) return false;
    suppliedSourceIds.add(source.source_id);
  }
  return suppliedSourceIds.size === expectedSourceIds.length
    && expectedSourceIds.every((sourceId) => suppliedSourceIds.has(sourceId));
}

function coreEvidenceValidation(value, { expectedSourceIds = [], now = Date.now() } = {}) {
  const validation = isPlainObject(value) ? value : {};
  const state = String(validation.state || validation.status || "").trim().toLowerCase();
  const declaredAccepted = validation.valid === true || validation.verified === true || ["accepted", "valid", "verified", "allow"].includes(state);
  const validUntil = normalizeEpoch(validation.valid_until || validation.expires_at, 0) || null;
  const normalizedSourceIds = [...new Set(list(expectedSourceIds)
    .map((sourceId) => compactString(sourceId))
    .filter(Boolean))];
  const coreReceipt = isPlainObject(validation.core_receipt) ? validation.core_receipt : null;
  const receiptValid = normalizedSourceIds.length > 0
    && coreSourceReceiptValid(coreReceipt, normalizedSourceIds);
  return {
    accepted: declaredAccepted && receiptValid && Number.isFinite(validUntil) && validUntil > now,
    authority: normalizeAuthority(validation.authority),
    independent: validation.independent === true,
    valid_until: validUntil,
    core_receipt: receiptValid ? coreReceipt : null,
  };
}

function trimRecords(records) {
  if (records.size <= MAX_RECORDS) return;
  const oldest = records.keys().next().value;
  records.delete(oldest);
}

/**
 * Creates an in-memory, tenant-scoped evidence ledger.
 *
 * `secret` is intentionally required: references and record signatures must
 * be unlinkable outside Universal Core.  `ingestResearchEvidence` accepts the
 * MCP shape `{sources, claims}` plus Core-produced `validated_claims` and
 * bindings `{branch_id, subbranch_id, evidence_session_id,
 * requirement_bindings:[{id, requirement_ref, source_ids, claim_ids}]}`;
 * scope may equivalently be supplied with the top-level `branchId`,
 * `subbranchId`, and `evidenceSessionId` arguments.
 * `requirement_ref` is an opaque, deterministic reference produced by the
 * attester.  A caller's `valid:true` is insufficient: every accepted claim
 * must carry an unexpired Core-issued source-receipt bundle with one digest
 * receipt per claim source. Authority/independence come only from that Core
 * validation, never from the caller's claim object. The return value has only
 * signed opaque record references.
 */
export function createNyraDeepV2EvidenceLedger({
  secret,
  now = () => Date.now(),
  maxRecords = MAX_RECORDS,
} = {}) {
  const key = String(secret || "");
  if (key.length < 32) throw new TypeError("nyra_deep_v2_ledger_secret_required");
  const capacity = Math.max(100, Math.min(MAX_RECORDS, Number(maxRecords) || MAX_RECORDS));
  const records = new Map();
  let sequence = 0;

  function reference(domain, value) {
    const normalizedDomain = compactString(domain, 128);
    if (!normalizedDomain) throw new TypeError("ledger_reference_domain_required");
    return hmac(key, `ref/${normalizedDomain}`, value);
  }

  function recordSignature(record) {
    const unsigned = { ...record };
    delete unsigned.signature;
    return hmac(key, "record-signature/v1", unsigned);
  }

  function verifyRecord(record) {
    if (!isPlainObject(record) || record.schema_version !== NYRA_DEEP_V2_EVIDENCE_LEDGER_SCHEMA_VERSION) {
      return false;
    }
    if (!REFERENCE_PATTERN.test(String(record.record_ref || ""))) return false;
    return safeEqual(record.signature, recordSignature(record));
  }

  function save(record) {
    const sealed = { ...record, signature: recordSignature(record) };
    records.set(sealed.record_ref, Object.freeze(sealed));
    while (records.size > capacity) trimRecords(records);
    return clone(sealed);
  }

  function createRecord({
    kind,
    tenantId,
    requestId,
    nodeId = null,
    nodeRef = null,
    branchId = null,
    subbranchId = null,
    evidenceSessionRef = null,
    evidenceSessionExpiresAt = null,
    observedAt,
    payload,
  }) {
    const tenant = compactString(tenantId);
    const request = compactString(requestId);
    if (!tenant || !request) throw new TypeError("ledger_tenant_and_request_required");
    const nowMs = normalizeEpoch(observedAt, normalizeEpoch(now(), Date.now()));
    const resolvedNodeRef = REFERENCE_PATTERN.test(String(nodeRef || ""))
      ? String(nodeRef)
      : nodeId
        ? reference("node", nodeId)
        : null;
    const resolvedBranchRef = branchId ? reference("branch", branchId) : null;
    const resolvedSubbranchRef = branchId && subbranchId
      ? reference("subbranch", { branch_id: branchId, subbranch_id: subbranchId })
      : null;
    const resolvedSessionRef = REFERENCE_PATTERN.test(String(evidenceSessionRef || ""))
      ? String(evidenceSessionRef)
      : null;
    const resolvedSessionExpiry = resolvedSessionRef
      ? normalizeEpoch(evidenceSessionExpiresAt, 0) || null
      : null;
    sequence += 1;
    const record = {
      schema_version: NYRA_DEEP_V2_EVIDENCE_LEDGER_SCHEMA_VERSION,
      record_ref: reference("record", {
        kind,
        tenant,
        request,
        node: resolvedNodeRef || nodeId || null,
        branch: resolvedBranchRef,
        subbranch: resolvedSubbranchRef,
        evidence_session: resolvedSessionRef,
        evidence_session_expires_at: resolvedSessionExpiry,
        sequence,
        observed_at: nowMs,
      }),
      kind,
      tenant_ref: reference("tenant", tenant),
      request_ref: reference("request", { tenant, request }),
      node_ref: resolvedNodeRef,
      branch_ref: resolvedBranchRef,
      subbranch_ref: resolvedSubbranchRef,
      evidence_session_ref: resolvedSessionRef,
      evidence_session_expires_at: resolvedSessionExpiry,
      observed_at: nowMs,
      ...payload,
    };
    return save(record);
  }

  function policyDecisionReceiptFor(record) {
    return {
      schema_version: NYRA_DEEP_V2_CORE_POLICY_DECISION_RECEIPT_SCHEMA_VERSION,
      issuer: NYRA_DEEP_V2_CORE_POLICY_DECISION_RECEIPT_ISSUER,
      receipt_ref: record.record_ref,
      receipt_hash: sha256(record),
    };
  }

  /**
   * Mints an in-process Core receipt for one concrete Nyra policy decision.
   * The stored record is HMAC-signed with the ledger secret; callers only
   * receive an opaque ref plus deterministic hash.  The attester resolves and
   * verifies this receipt before it can serialize an operational `ALLOW`.
   */
  function issueCorePolicyDecisionReceipt({
    tenantId,
    requestId,
    branchId,
    subbranchId,
    nodeId,
    policyId,
    effect,
    decision,
    preflightId,
    corePolicyHash,
    issuedAt,
    expiresAt,
    observedAt,
  } = {}) {
    const tenant = compactString(tenantId);
    const request = compactString(requestId);
    const branch = compactString(branchId);
    const subbranch = compactString(subbranchId);
    const node = compactString(nodeId);
    const policy = compactString(policyId);
    const policyEffect = compactString(effect);
    const resolvedDecision = String(decision || "").trim().toUpperCase();
    const preflight = compactString(preflightId);
    const policyHash = String(corePolicyHash || "");
    const issuedEpoch = canonicalIsoEpoch(issuedAt);
    const expiresEpoch = canonicalIsoEpoch(expiresAt);
    const nowMs = normalizeEpoch(observedAt, normalizeEpoch(now(), Date.now()));
    if (
      !tenant || !request || !branch || !subbranch || !node || !policy || !policyEffect || !preflight
      || !SHA256_PATTERN.test(policyHash)
      || !VALID_CORE_POLICY_DECISIONS.has(resolvedDecision)
      || !Number.isFinite(issuedEpoch)
      || !Number.isFinite(expiresEpoch)
      || expiresEpoch <= issuedEpoch
      || expiresEpoch - issuedEpoch > 60_000
      || issuedEpoch > nowMs
      || expiresEpoch <= nowMs
    ) return { ok: false, reason: "ledger_core_policy_receipt_input_invalid" };
    const decisionId = `nyra-v2-policy-${crypto.randomUUID()}`;
    const record = createRecord({
      kind: "core_policy_decision",
      tenantId: tenant,
      requestId: request,
      nodeId: node,
      branchId: branch,
      subbranchId: subbranch,
      observedAt: nowMs,
      payload: {
        decision_id: decisionId,
        policy_id: policy,
        effect: policyEffect,
        decision: resolvedDecision,
        preflight_id: preflight,
        core_policy_hash: policyHash,
        issued_at: new Date(issuedEpoch).toISOString(),
        expires_at: new Date(expiresEpoch).toISOString(),
        valid_until: expiresEpoch,
      },
    });
    return {
      ok: true,
      decision_id: decisionId,
      decision_receipt: policyDecisionReceiptFor(record),
    };
  }

  /**
   * Verifies a Core-only receipt against the signed in-memory record.  This is
   * deliberately narrower than generic `resolve`: all scope, decision, time,
   * hash, and decision-id fields must match before an attester can allow a
   * single node-policy binding.
   */
  function verifyCorePolicyDecisionReceipt({
    receipt,
    tenantId,
    requestId,
    branchId,
    subbranchId,
    nodeId,
    policyId,
    effect,
    decision,
    decisionId,
    preflightId,
    corePolicyHash,
    issuedAt,
    expiresAt,
    observedAt,
  } = {}) {
    const tenant = compactString(tenantId);
    const request = compactString(requestId);
    const branch = compactString(branchId);
    const subbranch = compactString(subbranchId);
    const node = compactString(nodeId);
    const policy = compactString(policyId);
    const policyEffect = compactString(effect);
    const resolvedDecision = String(decision || "").trim().toUpperCase();
    const resolvedDecisionId = compactString(decisionId, 256);
    const preflight = compactString(preflightId);
    const policyHash = String(corePolicyHash || "");
    const issuedEpoch = canonicalIsoEpoch(issuedAt);
    const expiresEpoch = canonicalIsoEpoch(expiresAt);
    const nowMs = normalizeEpoch(observedAt, normalizeEpoch(now(), Date.now()));
    if (!exactKeys(receipt, ["schema_version", "issuer", "receipt_ref", "receipt_hash"])
      || receipt.schema_version !== NYRA_DEEP_V2_CORE_POLICY_DECISION_RECEIPT_SCHEMA_VERSION
      || receipt.issuer !== NYRA_DEEP_V2_CORE_POLICY_DECISION_RECEIPT_ISSUER
      || !REFERENCE_PATTERN.test(String(receipt.receipt_ref || ""))
      || !SHA256_PATTERN.test(String(receipt.receipt_hash || ""))
      || !tenant || !request || !branch || !subbranch || !node || !policy || !policyEffect || !preflight
      || !resolvedDecisionId || !VALID_CORE_POLICY_DECISIONS.has(resolvedDecision)
      || !SHA256_PATTERN.test(policyHash)
      || !Number.isFinite(issuedEpoch) || !Number.isFinite(expiresEpoch)
      || expiresEpoch <= issuedEpoch || expiresEpoch <= nowMs) {
      return { ok: false, reason: "ledger_core_policy_receipt_input_invalid" };
    }
    const record = records.get(String(receipt.receipt_ref));
    if (!record || !verifyRecord(record) || record.kind !== "core_policy_decision") {
      return { ok: false, reason: "ledger_core_policy_receipt_not_found" };
    }
    if (receipt.receipt_hash !== policyDecisionReceiptFor(record).receipt_hash) {
      return { ok: false, reason: "ledger_core_policy_receipt_hash_invalid" };
    }
    if (
      record.tenant_ref !== reference("tenant", tenant)
      || record.request_ref !== reference("request", { tenant, request })
      || record.branch_ref !== reference("branch", branch)
      || record.subbranch_ref !== reference("subbranch", { branch_id: branch, subbranch_id: subbranch })
      || record.node_ref !== reference("node", node)
      || record.decision_id !== resolvedDecisionId
      || record.policy_id !== policy
      || record.effect !== policyEffect
      || record.decision !== resolvedDecision
      || record.preflight_id !== preflight
      || record.core_policy_hash !== policyHash
      || record.issued_at !== new Date(issuedEpoch).toISOString()
      || record.expires_at !== new Date(expiresEpoch).toISOString()
      || record.valid_until !== expiresEpoch
      || record.valid_until <= nowMs
    ) return { ok: false, reason: "ledger_core_policy_receipt_scope_invalid" };
    return { ok: true };
  }

  function ingestResearchEvidence({
    tenantId,
    requestId,
    evidencePack = {},
    bindings = [],
    branchId: suppliedBranchId = null,
    subbranchId: suppliedSubbranchId = null,
    evidenceSessionId: suppliedEvidenceSessionId = null,
    evidenceSessionExpiresAt: suppliedEvidenceSessionExpiresAt = null,
    now: observedAt,
  } = {}) {
    const tenant = compactString(tenantId);
    const request = compactString(requestId);
    if (!tenant || !request) {
      return { ok: false, reason: "ledger_tenant_and_request_required", evidence_refs: [], policy_refs: [] };
    }
    const suppliedBindings = bindingList(bindings).slice(0, MAX_BINDINGS_PER_INGEST);
    const bindingScope = isPlainObject(bindings) ? bindings : {};
    const branchId = compactString(bindingScope.branch_id || bindingScope.branchId || suppliedBranchId);
    const subbranchId = compactString(bindingScope.subbranch_id || bindingScope.subbranchId || suppliedSubbranchId);
    const sessionId = compactString(
      bindingScope.evidence_session_id || bindingScope.evidenceSessionId || suppliedEvidenceSessionId || request,
      256
    );
    const ingestNow = normalizeEpoch(observedAt, normalizeEpoch(now(), Date.now()));
    const requestedSessionExpiry = branchId && subbranchId
      ? normalizeEpoch(
        bindingScope.evidence_session_expires_at
        || bindingScope.evidenceSessionExpiresAt
        || suppliedEvidenceSessionExpiresAt,
        ingestNow + 60_000
      )
      : null;
    const evidenceSessionExpiresAt = requestedSessionExpiry
      ? Math.min(requestedSessionExpiry, ingestNow + MAX_EVIDENCE_SESSION_MS)
      : null;
    if (evidenceSessionExpiresAt && evidenceSessionExpiresAt <= ingestNow) {
      return { ok: false, reason: "ledger_evidence_session_expired", evidence_refs: [], policy_refs: [] };
    }
    const evidenceSessionRef = branchId && subbranchId
      ? reference("evidence-session", {
        tenant_id: tenant,
        branch_id: branchId,
        subbranch_id: subbranchId,
        session_id: sessionId,
      })
      : null;
    const claims = claimIndex(evidencePack);
    const sources = sourceIndex(evidencePack);
    const validations = validationIndex(evidencePack);
    const evidenceRefs = [];
    const missingBindings = [];

    for (const binding of suppliedBindings) {
      const requirementRef = compactString(binding?.requirement_ref, 128);
      const claimIds = [...new Set([
        ...list(binding?.claim_ids || binding?.claimIds),
        binding?.claim_id || binding?.claim_ref,
      ].map((value) => compactString(value)).filter(Boolean))].slice(0, 64);
      const sourceIds = new Set([
        ...list(binding?.source_ids || binding?.sourceIds),
        binding?.source_id || binding?.source_ref,
      ].map((value) => compactString(value)).filter(Boolean).slice(0, 64));
      if (!requirementRef || !REQUIREMENT_REFERENCE_PATTERN.test(requirementRef) || claimIds.length === 0) {
        missingBindings.push({ requirement_ref: requirementRef || null, reason: "invalid_requirement_binding" });
        continue;
      }
      let accepted = 0;
      for (const claimId of claimIds) {
        const claim = claims.get(claimId);
        if (!claim) continue;
        const nodeId = compactString(binding?.node_id || binding?.nodeId || claim?.node_id || claim?.nodeId);
        const nodeRef = compactString(binding?.node_ref || binding?.nodeRef || claim?.node_ref || claim?.nodeRef, 128);
        const claimSourceIds = [...new Set([
          ...list(claim?.source_ids || claim?.sourceIds),
          claim?.source_id || claim?.sourceId || claim?.source_ref,
        ].map((value) => compactString(value)).filter(Boolean))].slice(0, 64);
        const acceptedSourceIds = claimSourceIds.filter((sourceId) => (
          sourceIds.size === 0 || sourceIds.has(sourceId)
        ));
        if (acceptedSourceIds.length === 0) continue;
        const sourceId = acceptedSourceIds[0];
        const source = sources.get(sourceId) || null;
        const validation = coreEvidenceValidation(validations.get(claimId), {
          expectedSourceIds: claimSourceIds,
          now: ingestNow,
        });
        if (!validation.accepted) continue;
        const record = createRecord({
          kind: "evidence",
          tenantId: tenant,
          requestId: request,
          nodeId,
          nodeRef,
          branchId: compactString(binding?.branch_id || binding?.branchId || branchId),
          subbranchId: compactString(binding?.subbranch_id || binding?.subbranchId || subbranchId),
          evidenceSessionRef,
          evidenceSessionExpiresAt,
          observedAt: claim?.observed_at || claim?.observedAt || observedAt,
          payload: {
            requirement_ref: requirementRef,
            claim_ref: reference("claim", claimId),
            source_ref: reference("source", acceptedSourceIds),
            evidence_ref: reference("evidence", {
              claim_id: claimId,
              source_ids: acceptedSourceIds,
              claim_hash: claim?.claim_hash || claim?.hash || null,
              semantic_hash: claim?.semantic_hash || null,
              content: claim?.content || claim?.text || claim?.value || null,
            }),
            authority: validation.authority,
            independent: validation.independent,
            valid_until: validation.valid_until || normalizeEpoch(claim?.valid_until || claim?.expires_at || source?.valid_until, 0) || null,
            core_receipt_ref: reference("core-source-receipt", validation.core_receipt),
            metadata_ref: reference("evidence-metadata", {
              claim,
              source,
              binding: {
                requirement_ref: requirementRef,
                claim_id: claimId,
              },
            }),
          },
        });
        accepted += 1;
        evidenceRefs.push({
          requirement_ref: requirementRef,
          claim_ref: record.claim_ref,
          evidence_ref: record.evidence_ref,
          record_ref: record.record_ref,
        });
      }
      if (accepted === 0) {
        missingBindings.push({ requirement_ref: requirementRef, reason: "claims_sources_or_core_validation_not_present" });
      }
    }

    const policyRefs = [];
    for (const atom of policyAtoms(evidencePack).slice(0, MAX_BINDINGS_PER_INGEST)) {
      const policyId = compactString(atom?.policy_id || atom?.id);
      const suppliedPolicyRef = compactString(atom?.policy_ref || atom?.policyRef, 128);
      const policyRef = REFERENCE_PATTERN.test(String(suppliedPolicyRef || ""))
        ? suppliedPolicyRef
        : policyId
          ? reference("policy", policyId)
          : null;
      if (!policyRef) continue;
      const nodeId = compactString(atom?.node_id || atom?.nodeId);
      const nodeRef = compactString(atom?.node_ref || atom?.nodeRef, 128);
      const record = createRecord({
        kind: "policy",
        tenantId: tenant,
        requestId: request,
        nodeId,
        nodeRef,
        branchId,
        subbranchId,
        evidenceSessionRef,
        evidenceSessionExpiresAt,
        observedAt: atom?.observed_at || atom?.observedAt || observedAt,
        payload: {
          policy_ref: policyRef,
          decision: normalizePolicyDecision(atom?.decision || atom?.state || atom?.verdict),
          scope: nodeId ? "node" : "request",
          valid_until: normalizeEpoch(atom?.valid_until || atom?.expires_at, 0) || null,
          metadata_ref: reference("policy-metadata", atom),
        },
      });
      policyRefs.push({ policy_ref: record.policy_ref, record_ref: record.record_ref, decision: record.decision });
    }

    return {
      ok: true,
      state: missingBindings.length > 0 ? "partial_evidence_ingested" : "evidence_ingested",
      evidence_refs: evidenceRefs,
      policy_refs: policyRefs,
      evidence_session_ref: evidenceSessionRef,
      evidence_session_expires_at: evidenceSessionExpiresAt,
      missing_bindings: missingBindings,
    };
  }

  /**
   * Returns verified, opaque records belonging to exactly one tenant.  Normal
   * reads bind to the original request.  A cross-request read is permitted
   * only for an explicit, signed record-ref handoff scoped to the same tenant,
   * branch, subbranch, requirement, non-expired evidence session.
   */
  function resolve({
    tenantId,
    requestId,
    recordRefs = null,
    requirementRef = null,
    policyRef = null,
    nodeId = null,
    kind = null,
    branchId = null,
    subbranchId = null,
    evidenceSessionRef = null,
    allowSessionHandoff = false,
    now: queryNow,
  } = {}) {
    const tenant = compactString(tenantId);
    const request = compactString(requestId);
    if (!tenant || !request) return { ok: false, reason: "ledger_tenant_and_request_required", records: [] };
    const tenantRef = reference("tenant", tenant);
    const requestRef = reference("request", { tenant, request });
    const wantedRefs = new Set(list(recordRefs).slice(0, MAX_RECORD_REFS_PER_QUERY).filter((value) => REFERENCE_PATTERN.test(String(value || ""))));
    const expectedNodeRef = nodeId ? reference("node", nodeId) : null;
    const expectedBranchRef = branchId ? reference("branch", branchId) : null;
    const expectedSubbranchRef = branchId && subbranchId
      ? reference("subbranch", { branch_id: branchId, subbranch_id: subbranchId })
      : null;
    const handoff = allowSessionHandoff === true;
    const validSessionRef = REFERENCE_PATTERN.test(String(evidenceSessionRef || ""))
      ? String(evidenceSessionRef)
      : null;
    if (handoff && (!validSessionRef || !expectedBranchRef || !expectedSubbranchRef || wantedRefs.size === 0)) {
      return { ok: false, reason: "ledger_evidence_session_handoff_scope_invalid", records: [] };
    }
    const nowMs = normalizeEpoch(queryNow, normalizeEpoch(now(), Date.now()));
    const matched = [];
    for (const record of records.values()) {
      if (!verifyRecord(record)) continue;
      if (record.tenant_ref !== tenantRef) continue;
      if (!handoff && record.request_ref !== requestRef) continue;
      if (handoff && (
        record.evidence_session_ref !== validSessionRef
        || record.branch_ref !== expectedBranchRef
        || record.subbranch_ref !== expectedSubbranchRef
        || !Number.isFinite(Number(record.evidence_session_expires_at))
        || Number(record.evidence_session_expires_at) <= nowMs
      )) continue;
      if (wantedRefs.size > 0 && !wantedRefs.has(record.record_ref)) continue;
      if (kind && record.kind !== kind) continue;
      if (requirementRef && record.requirement_ref !== requirementRef) continue;
      if (policyRef && record.policy_ref !== policyRef) continue;
      if (expectedNodeRef && record.node_ref && record.node_ref !== expectedNodeRef) continue;
      if (record.valid_until && record.valid_until < nowMs) continue;
      matched.push(clone(record));
    }
    matched.sort((left, right) => left.observed_at - right.observed_at || left.record_ref.localeCompare(right.record_ref));
    return { ok: true, records: matched };
  }

  /**
   * Resolves a handoff session from explicit signed evidence record refs.
   * It is intentionally narrower than `resolve`: every supplied ref must be
   * a live evidence record in the same tenant/branch/subbranch/session.  Core
   * can call this when MCP's evaluate request has a different request id from
   * the prepare request, without adding a user-controlled session field.
   */
  function resolveEvidenceSession({
    tenantId,
    branchId,
    subbranchId,
    recordRefs = [],
    now: queryNow,
  } = {}) {
    const tenant = compactString(tenantId);
    const branch = compactString(branchId);
    const subbranch = compactString(subbranchId);
    const refs = [...new Set(list(recordRefs)
      .slice(0, MAX_RECORD_REFS_PER_QUERY)
      .filter((value) => REFERENCE_PATTERN.test(String(value || ""))))];
    if (!tenant || !branch || !subbranch || refs.length === 0) {
      return { ok: false, reason: "ledger_evidence_session_scope_invalid" };
    }
    const tenantRef = reference("tenant", tenant);
    const branchRef = reference("branch", branch);
    const subbranchRef = reference("subbranch", { branch_id: branch, subbranch_id: subbranch });
    const nowMs = normalizeEpoch(queryNow, normalizeEpoch(now(), Date.now()));
    const sessionRefs = new Set();
    for (const recordRef of refs) {
      const record = records.get(recordRef);
      if (
        !record
        || !verifyRecord(record)
        || record.kind !== "evidence"
        || record.tenant_ref !== tenantRef
        || record.branch_ref !== branchRef
        || record.subbranch_ref !== subbranchRef
        || !REFERENCE_PATTERN.test(String(record.evidence_session_ref || ""))
        || !Number.isFinite(Number(record.evidence_session_expires_at))
        || Number(record.evidence_session_expires_at) <= nowMs
        || (record.valid_until && record.valid_until < nowMs)
      ) return { ok: false, reason: "ledger_evidence_session_record_rejected" };
      sessionRefs.add(record.evidence_session_ref);
    }
    if (sessionRefs.size !== 1) return { ok: false, reason: "ledger_evidence_session_mismatch" };
    return {
      ok: true,
      evidence_session_ref: sessionRefs.values().next().value,
      record_count: refs.length,
    };
  }

  function ledgerStats() {
    return {
      schema_version: NYRA_DEEP_V2_EVIDENCE_LEDGER_SCHEMA_VERSION,
      record_count: records.size,
      signed: true,
      raw_content_retained: false,
    };
  }

  return Object.freeze({
    ingestResearchEvidence,
    issueCorePolicyDecisionReceipt,
    ledgerStats,
    reference,
    resolve,
    resolveEvidenceSession,
    verifyCorePolicyDecisionReceipt,
    verifyRecord,
  });
}
