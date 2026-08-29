import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./audit.js";

const SCHEMA_VERSION = "nyra_persistent_self_model_v1";

// Deterministic at every depth: both the digest and the signature must cover
// every nested capability and requirement, not only the top-level envelope.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
// Tenant ids are never used as a lossy filename. The digest is complete,
// collision-resistant for this purpose and does not disclose the tenant name.
const tenantStorageKey = (tenantId) => sha256(`nyra-self-model-tenant-v1\0${String(tenantId || "")}`);

function readJson(file) {
  try {
    return { exists: true, record: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, record: null };
    return { exists: true, record: null };
  }
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function buildNyraSelfModel({ tenantId, catalog, authorizedBranchIds = [] }) {
  const authorized = new Set(authorizedBranchIds);
  const catalogIds = new Set((catalog?.branches || []).map((branch) => branch.id));
  const available = (...required) => required.every((id) => catalogIds.has(id) && authorized.has(id));
  const capabilities = [
    ["next_step_planning", available("planning_prioritization", "execution_planning")],
    ["connected_ai_orchestration", available("ai_orchestration", "agent_orchestration")],
    ["verified_learning", available("learning_memory", "adaptive_learning")],
    ["owner_protection_advice", available("risk_governance", "delegated_authority")],
    ["software_cognition", available("software_cognition")],
  ].map(([id, present]) => ({ id, state: present ? "available" : "unavailable" }));
  const required_infrastructure = [
    { id: "verified_outcome_learning_loop", reason: "collegare outcome verificati ad aggiornamenti di memoria misurabili" },
    { id: "owner_protection_signal", reason: "usare un segnale owner esplicito, autenticato e revocabile" },
    { id: "connected_ai_execution_contract", reason: "emettere step, receipt del worker e ripresa dal checkpoint" },
  ];
  return {
    schema_version: SCHEMA_VERSION,
    tenant_id: tenantId,
    dialogue_mode: "structured_orchestration_contract",
    execution_allowed: false,
    cognitive_engine_contract: {
      reasoning_owner: "nyra_core",
      connected_ai_role: "interchangeable_cognitive_and_linguistic_engine",
      decision_source_of_truth: "persistent_governed_state",
      final_authority: "universal_core",
    },
    structural_autonomy_requirement: {
      id: "software_architecture_atlas",
      current_state_source: "work_scoped_operational_dialogue",
      required_coverage: ["components", "files", "dependencies", "services", "apis", "events", "databases", "changes", "impacts"],
      when_not_indexed: "request_bounded_verified_indexing",
      bootstrap_capability: "software_cognition_repository_bootstrap",
      bootstrap_contract: "server_fetches_one_bounded_snapshot_batch_and_persists_only_graph_and_digests",
      purpose: "compare_agent_activity_to_actual_software_and_impact_surface",
    },
    capabilities,
    required_infrastructure,
    next_recommended_capability: "software_architecture_atlas",
    catalog_revision: catalog?.schema_version || "unknown",
    authorized_branches_digest: sha256(canonical([...authorized].sort())),
  };
}

export function createNyraPersistentSelfModelStore({ storageRoot, signingSecret = "" }) {
  const root = path.join(storageRoot, "nyra-self-model");
  const key = Buffer.byteLength(signingSecret, "utf8") >= 32 ? signingSecret : "local-self-model-unsigned";
  const fileFor = (tenantId) => path.join(root, `${tenantStorageKey(tenantId)}.json`);
  const sign = (payload) => crypto.createHmac("sha256", key).update(canonical(payload)).digest("hex");
  const storedProfile = (record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    const {
      revision: _revision,
      generated_at: _generatedAt,
      payload_digest: _payloadDigest,
      signature: _signature,
      ...profile
    } = record;
    return profile;
  };
  const unsignedRecord = (record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    const {
      payload_digest: _payloadDigest,
      signature: _signature,
      ...unsigned
    } = record;
    return unsigned;
  };
  const validStoredEnvelope = (record, { tenantId, catalog }) => {
    const profile = storedProfile(record);
    const unsigned = unsignedRecord(record);
    const expectedShape = buildNyraSelfModel({ tenantId, catalog, authorizedBranchIds: [] });
    return Boolean(
      profile &&
      unsigned &&
      Object.keys(profile).sort().join("\0") === Object.keys(expectedShape).sort().join("\0") &&
      profile.schema_version === SCHEMA_VERSION &&
      profile.tenant_id === tenantId &&
      Number.isSafeInteger(record.revision) && record.revision > 0 &&
      typeof record.generated_at === "string" &&
      Number.isFinite(Date.parse(record.generated_at)) &&
      new Date(record.generated_at).toISOString() === record.generated_at &&
      record.payload_digest === sha256(canonical(unsigned)) &&
      record.signature === sign(unsigned)
    );
  };
  // The immediately preceding on-disk format signed only the self-model
  // profile. Accept it as a bounded compatibility envelope so an upgrade
  // does not strand an otherwise authentic tenant record. A write-capable,
  // owner-confirmed refresh below always migrates it to the current envelope,
  // whose signature also covers revision and generated_at.
  const validLegacyStoredEnvelope = (record, { tenantId }) => {
    const profile = storedProfile(record);
    const expectedShape = buildNyraSelfModel({ tenantId, catalog: null, authorizedBranchIds: [] });
    return Boolean(
      profile &&
      Object.keys(profile).sort().join("\0") === Object.keys(expectedShape).sort().join("\0") &&
      profile.schema_version === SCHEMA_VERSION &&
      profile.tenant_id === tenantId &&
      Number.isSafeInteger(record.revision) && record.revision > 0 &&
      typeof record.generated_at === "string" &&
      Number.isFinite(Date.parse(record.generated_at)) &&
      new Date(record.generated_at).toISOString() === record.generated_at &&
      record.payload_digest === sha256(canonical(profile)) &&
      record.signature === sign(profile)
    );
  };
  const validStoredRecord = (record, { tenantId, catalog }) => Boolean(
    validStoredEnvelope(record, { tenantId, catalog }) &&
    record.catalog_revision === (catalog?.schema_version || "unknown")
  );
  const validLegacyStoredRecord = (record, { tenantId, catalog }) => Boolean(
    validLegacyStoredEnvelope(record, { tenantId }) &&
    record.catalog_revision === (catalog?.schema_version || "unknown")
  );
  return {
    read({ tenantId, catalog }) {
      const { record: current } = readJson(fileFor(tenantId));
      return validStoredRecord(current, { tenantId, catalog }) ||
        validLegacyStoredRecord(current, { tenantId, catalog })
        ? current
        : null;
    },
    refresh({ tenantId, catalog, authorizedBranchIds = [] }) {
      const profile = buildNyraSelfModel({ tenantId, catalog, authorizedBranchIds });
      const stored = readJson(fileFor(tenantId));
      const current = stored.record;
      const currentEnvelopeValid = !stored.exists
        ? false
        : validStoredEnvelope(current, { tenantId, catalog });
      const legacyEnvelopeValid = !stored.exists || currentEnvelopeValid
        ? false
        : validLegacyStoredEnvelope(current, { tenantId });
      if (stored.exists && !currentEnvelopeValid && !legacyEnvelopeValid) {
        throw new Error("nyra_self_model_integrity_invalid");
      }
      if (currentEnvelopeValid && canonical(storedProfile(current)) === canonical(profile)) return current;
      const unsigned = {
        ...profile,
        revision: currentEnvelopeValid || legacyEnvelopeValid ? current.revision + 1 : 1,
        generated_at: new Date().toISOString(),
      };
      const record = {
        ...unsigned,
        payload_digest: sha256(canonical(unsigned)),
        signature: sign(unsigned),
      };
      writeJsonAtomic(fileFor(tenantId), record);
      return record;
    },
    fileFor,
  };
}

export { SCHEMA_VERSION as NYRA_PERSISTENT_SELF_MODEL_SCHEMA_VERSION };
