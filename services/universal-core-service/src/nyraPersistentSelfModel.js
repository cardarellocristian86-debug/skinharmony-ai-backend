import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./audit.js";

const SCHEMA_VERSION = "nyra_persistent_self_model_v1";

const canonical = (value) => JSON.stringify(value, Object.keys(value || {}).sort());
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const safeTenant = (value) => String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "unknown";

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function buildNyraSelfModel({ tenantId, catalog }) {
  const ids = new Set((catalog?.branches || []).map((branch) => branch.id));
  const available = (...required) => required.every((id) => ids.has(id));
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
    capabilities,
    required_infrastructure,
    next_recommended_capability: required_infrastructure[0].id,
    catalog_revision: catalog?.schema_version || "unknown",
  };
}

export function createNyraPersistentSelfModelStore({ storageRoot, signingSecret = "" }) {
  const root = path.join(storageRoot, "nyra-self-model");
  const key = Buffer.byteLength(signingSecret, "utf8") >= 32 ? signingSecret : "local-self-model-unsigned";
  const fileFor = (tenantId) => path.join(root, `${safeTenant(tenantId)}.json`);
  const sign = (payload) => crypto.createHmac("sha256", key).update(canonical(payload)).digest("hex");
  return {
    readOrRefresh({ tenantId, catalog }) {
      const profile = buildNyraSelfModel({ tenantId, catalog });
      const payloadDigest = sha256(canonical(profile));
      const current = readJson(fileFor(tenantId));
      if (current?.payload_digest === payloadDigest && current?.signature === sign(profile)) return current;
      const record = {
        ...profile,
        revision: Number(current?.revision || 0) + 1,
        generated_at: new Date().toISOString(),
        payload_digest: payloadDigest,
        signature: sign(profile),
      };
      writeJsonAtomic(fileFor(tenantId), record);
      return record;
    },
  };
}

export { SCHEMA_VERSION as NYRA_PERSISTENT_SELF_MODEL_SCHEMA_VERSION };
