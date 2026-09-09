const DIGEST = /^[a-f0-9]{64}$/u;
const KINDS = new Set(["objective", "acceptance", "constraint"]);

function exactKeys(value, keys) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.size
    && Object.keys(value).every((key) => keys.has(key)));
}

function text(value, max) {
  return typeof value === "string" && value.trim() === value && value.length > 0
    && value.length <= max;
}

function identifier(value) {
  return text(value, 160) && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value);
}

function criterionDigest(criterion, intentDigest, digest) {
  return digest({ schema_version: "intent_acceptance_criterion_v1", intent_digest: intentDigest,
    criterion_id: criterion.criterion_id, criterion_kind: criterion.criterion_kind,
    text: criterion.text });
}

function normalizeAmendment(value, baseCriteria, baseCriteriaDigest) {
  const amendmentKeys = new Set(["schema_version", "base_criteria_digest", "reason",
    "superseded_criteria", "replacement_criteria"]);
  if (!exactKeys(value, amendmentKeys)
    || !["intent_acceptance_contract_amendment_v1", "intent_acceptance_contract_amendment_v2"]
      .includes(value.schema_version)
    || value.base_criteria_digest !== baseCriteriaDigest || !text(value.reason, 2_000)
    || !Array.isArray(value.superseded_criteria) || value.superseded_criteria.length < 1
    || value.superseded_criteria.length > 100
    || !Array.isArray(value.replacement_criteria) || value.replacement_criteria.length < 1
    || value.replacement_criteria.length > 100) return null;
  const baseById = new Map(baseCriteria.map((item) => [item.criterion_id, item]));
  const supersededIds = new Set();
  const superseded = [];
  for (const item of value.superseded_criteria) {
    if (!exactKeys(item, new Set(["criterion_id", "criterion_digest", "reason"]))
      || !identifier(item.criterion_id) || !DIGEST.test(String(item.criterion_digest || ""))
      || !text(item.reason, 1_000) || supersededIds.has(item.criterion_id)) return null;
    const base = baseById.get(item.criterion_id);
    if (!base || base.criterion_digest !== item.criterion_digest
      || (base.criterion_kind === "objective"
        && value.schema_version !== "intent_acceptance_contract_amendment_v2")) return null;
    supersededIds.add(item.criterion_id);
    superseded.push({ criterion_id: item.criterion_id, criterion_digest: item.criterion_digest,
      reason: item.reason });
  }
  const baseIds = new Set(baseCriteria.map((item) => item.criterion_id));
  const replacementIds = new Set();
  const replacements = [];
  for (const item of value.replacement_criteria) {
    if (!exactKeys(item, new Set(["criterion_id", "criterion_kind", "text"]))
      || !identifier(item.criterion_id) || !KINDS.has(item.criterion_kind)
      || !text(item.text, 2_000) || replacementIds.has(item.criterion_id)) return null;
    const replacesObjective = item.criterion_kind === "objective"
      && value.schema_version === "intent_acceptance_contract_amendment_v2"
      && item.criterion_id === "objective" && supersededIds.has("objective");
    if ((item.criterion_kind === "objective" && !replacesObjective)
      || (baseIds.has(item.criterion_id) && !replacesObjective)) return null;
    replacementIds.add(item.criterion_id);
    replacements.push({ criterion_id: item.criterion_id, criterion_kind: item.criterion_kind,
      text: item.text });
  }
  return { schema_version: value.schema_version, base_criteria_digest: baseCriteriaDigest,
    reason: value.reason,
    superseded_criteria: superseded.sort((a, b) => a.criterion_id.localeCompare(b.criterion_id)),
    replacement_criteria: replacements.sort((a, b) => a.criterion_id.localeCompare(b.criterion_id)) };
}

export function acceptanceContractIntegrityValid(contract, digest) {
  try {
    if (typeof digest !== "function" || !contract || typeof contract !== "object"
      || Array.isArray(contract) || !DIGEST.test(String(contract.intent_digest || ""))
      || !Array.isArray(contract.criteria) || contract.criteria.length < 1) return false;
    const criterionKeys = new Set(["criterion_id", "criterion_kind", "text", "criterion_digest"]);
    const validCriteria = (criteria) => criteria.every((item) => exactKeys(item, criterionKeys)
      && identifier(item.criterion_id) && KINDS.has(item.criterion_kind) && text(item.text, 8_000)
      && item.criterion_digest === criterionDigest(item, contract.intent_digest, digest));
    if (!validCriteria(contract.criteria) || digest(contract.criteria) !== contract.criteria_digest
      || contract.criteria.filter((item) => item.criterion_kind === "objective").length !== 1
      || contract.evidence_required !== true || contract.independent_verifier_required !== true) return false;
    if (contract.schema_version === "intent_acceptance_contract_v1") {
      return exactKeys(contract, new Set(["schema_version", "intent_digest", "criteria",
        "criteria_digest", "evidence_required", "independent_verifier_required"]));
    }
    const v2Keys = new Set(["schema_version", "intent_digest", "base_criteria",
      "base_criteria_digest", "amendment", "amendment_digest", "architecture_version",
      "architecture_digest", "criteria", "criteria_digest", "evidence_required",
      "independent_verifier_required"]);
    if (contract.schema_version !== "intent_acceptance_contract_v2" || !exactKeys(contract, v2Keys)
      || !Array.isArray(contract.base_criteria) || !validCriteria(contract.base_criteria)
      || digest(contract.base_criteria) !== contract.base_criteria_digest
      || !Number.isInteger(contract.architecture_version) || contract.architecture_version < 1
      || !DIGEST.test(String(contract.architecture_digest || ""))) return false;
    const amendment = normalizeAmendment(contract.amendment, contract.base_criteria,
      contract.base_criteria_digest);
    if (!amendment || digest(amendment) !== contract.amendment_digest) return false;
    const superseded = new Set(amendment.superseded_criteria.map((item) => item.criterion_id));
    const expected = [...contract.base_criteria.filter((item) => !superseded.has(item.criterion_id)),
      ...amendment.replacement_criteria.map((item) => ({ ...item,
        criterion_digest: criterionDigest(item, contract.intent_digest, digest) }))];
    return digest(expected) === digest(contract.criteria);
  } catch {
    return false;
  }
}
