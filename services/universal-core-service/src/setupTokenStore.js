import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ensureDir } from "./audit.js";
import { KEY_PRESETS, sanitizeScopes } from "./scope.js";

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function normalizeList(value, max = 100) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((item) => String(item || "").trim()).filter(Boolean);
}

function defaultExpiresAt(hours = 24) {
  return new Date(Date.now() + Math.max(1, Math.min(168, Number(hours) || 24)) * 60 * 60 * 1000).toISOString();
}

function generateSetupToken() {
  const raw = crypto.randomBytes(18).toString("hex").toUpperCase();
  return `SHX-SETUP-${raw.slice(0, 8)}-${raw.slice(8, 16)}-${raw.slice(16, 24)}-${raw.slice(24)}`;
}

function publicRecord(record) {
  if (!record) return null;
  const { token_hash, ...safe } = record;
  return safe;
}

function normalizeSetupRecord(input = {}) {
  const preset = KEY_PRESETS[input.preset] || KEY_PRESETS.codex_automation;
  const tenantId = String(input.tenant_id || input.tenant?.tenant_id || input.tenant?.id || "").trim();
  if (!tenantId) throw new Error("tenant_id_required");

  return {
    token_id: `setup_${crypto.randomUUID()}`,
    tenant_id: tenantId,
    brand_scope: String(input.brand_scope || input.tenant?.brand_scope || "").trim(),
    label: String(input.label || `Setup ${tenantId}`).trim(),
    preset: KEY_PRESETS[input.preset] ? String(input.preset) : "codex_automation",
    key_type: String(input.key_type || preset.key_type || "automation").trim(),
    plan: String(input.plan || input.tier || input.tenant?.plan || input.tenant?.tier || "internal").trim(),
    role: String(input.role || "codex automation").trim(),
    environment: String(input.environment || input.tenant?.environment || "production").trim(),
    scopes: sanitizeScopes(input.scopes || input.allowed_scopes, preset.scopes),
    branch_groups: normalizeList(input.branch_groups || input.active_branch_groups, 50),
    branches: normalizeList(input.branches || input.active_branches, 100),
    modules: normalizeList(input.modules || input.suite_modules, 100),
    limits: typeof input.limits === "object" && input.limits ? input.limits : {},
    policy: typeof input.policy === "object" && input.policy ? input.policy : {},
    gate_mode: String(input.gate_mode || "hard_gating").trim(),
    recommended_folders: typeof input.recommended_folders === "object" && input.recommended_folders
      ? input.recommended_folders
      : {},
    expires_at: input.expires_at || defaultExpiresAt(input.ttl_hours),
    key_expires_at: input.key_expires_at || null,
    created_at: nowIso(),
    consumed_at: null,
    revoked_at: null,
    status: "active",
    metadata: typeof input.metadata === "object" && input.metadata ? input.metadata : {},
  };
}

export function createSetupTokenStore(storageRoot, audit) {
  const setupDir = path.join(storageRoot, "setup-tokens");
  const setupFile = path.join(setupDir, "tokens.json");
  ensureDir(setupDir);

  function listAll() {
    return readJson(setupFile, []);
  }

  function saveAll(records) {
    writeJson(setupFile, records);
  }

  function create(input = {}) {
    const token = generateSetupToken();
    const record = {
      ...normalizeSetupRecord(input),
      token_hash: sha256(token),
    };
    const records = listAll();
    records.push(record);
    saveAll(records);
    audit?.append("core_setup_token_created", {
      token_id: record.token_id,
      tenant_id: record.tenant_id,
      preset: record.preset,
      plan: record.plan,
      expires_at: record.expires_at,
    });
    return { setup_token: token, record: publicRecord(record) };
  }

  function consume(token, metadata = {}) {
    const tokenHash = sha256(token);
    const records = listAll();
    const record = records.find((item) => item.token_hash === tokenHash);
    if (!record) return { ok: false, status: 404, error: "setup_token_not_found" };
    if (record.status === "revoked") return { ok: false, status: 410, error: "setup_token_revoked", record: publicRecord(record) };
    if (record.status === "consumed") return { ok: false, status: 409, error: "setup_token_already_consumed", record: publicRecord(record) };
    if (record.expires_at && new Date(record.expires_at).getTime() < Date.now()) {
      record.status = "expired";
      saveAll(records);
      audit?.append("core_setup_token_expired", { token_id: record.token_id, tenant_id: record.tenant_id });
      return { ok: false, status: 410, error: "setup_token_expired", record: publicRecord(record) };
    }

    record.status = "consumed";
    record.consumed_at = nowIso();
    record.consume_context = {
      actor_id: String(metadata.actor_id || "").trim() || undefined,
      connector: String(metadata.connector || "").trim() || undefined,
      host: String(metadata.host || "").trim() || undefined,
    };
    saveAll(records);
    audit?.append("core_setup_token_consumed", {
      token_id: record.token_id,
      tenant_id: record.tenant_id,
      preset: record.preset,
    });
    return { ok: true, record: publicRecord(record) };
  }

  function revoke(tokenOrId, reason = "manual_revoke") {
    const value = String(tokenOrId || "").trim();
    const records = listAll();
    const record = records.find((item) => item.token_id === value || item.token_hash === sha256(value));
    if (!record) return null;
    record.status = "revoked";
    record.revoked_at = nowIso();
    record.revoke_reason = String(reason || "manual_revoke").trim();
    saveAll(records);
    audit?.append("core_setup_token_revoked", {
      token_id: record.token_id,
      tenant_id: record.tenant_id,
      reason: record.revoke_reason,
    });
    return publicRecord(record);
  }

  function list(filter = {}) {
    return listAll()
      .filter((record) => !filter.tenant_id || record.tenant_id === filter.tenant_id)
      .map(publicRecord);
  }

  return {
    create,
    consume,
    revoke,
    list,
  };
}
