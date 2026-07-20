import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_AUTOMATION_SCOPES, DEFAULT_CONNECTOR_SCOPES, KEY_PRESETS, SCOPES, sanitizeScopes } from "./scope.js";
import { ensureDir } from "./audit.js";
import { normalizeAllowedDomains, normalizeSuiteLimits, sanitizeSuiteModules } from "./suitePolicy.js";
import { getDomainPack } from "./domainPacks.js";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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

function publicRecord(record) {
  if (!record) return null;
  const { key_hash, ...safe } = record;
  return safe;
}

const PROVIDER_SETUP_LINK_BOOTSTRAP_KIND = "provider_setup_link";
const PROVIDER_SETUP_LINK_SERVICE_KIND = "provider_setup_link_service";
const PROVIDER_SETUP_LINK_SERVICE_TENANT = "__provider_setup_service__";
const PROVIDER_SETUP_LINK_SCOPES = Object.freeze([SCOPES.WRITE_PROVIDER_SETUP_LINK]);

function isDedicatedProviderSetupLinkRecord(record, tenantId, keyHash) {
  return Boolean(
    record &&
    record.key_hash === keyHash &&
    record.tenant_id === tenantId &&
    record.key_type === "connector" &&
    record.status === "active" &&
    record.expires_at === null &&
    record.preset === null &&
    record.brand_scope === "" &&
    Array.isArray(record.allowed_scopes) &&
    record.allowed_scopes.length === PROVIDER_SETUP_LINK_SCOPES.length &&
    record.allowed_scopes.every((scope, index) => scope === PROVIDER_SETUP_LINK_SCOPES[index]) &&
    record.metadata?.bootstrap_kind === PROVIDER_SETUP_LINK_BOOTSTRAP_KIND,
  );
}

export function isProviderSetupLinkServiceRecord(record) {
  return Boolean(
    record && record.tenant_id === PROVIDER_SETUP_LINK_SERVICE_TENANT &&
    record.key_type === "connector" && record.status === "active" &&
    record.expires_at === null && record.preset === null && record.brand_scope === "" &&
    Array.isArray(record.allowed_scopes) &&
    record.allowed_scopes.length === PROVIDER_SETUP_LINK_SCOPES.length &&
    record.allowed_scopes.every((scope, index) => scope === PROVIDER_SETUP_LINK_SCOPES[index]) &&
    record.metadata?.bootstrap_kind === PROVIDER_SETUP_LINK_SERVICE_KIND,
  );
}

export function createKeyStore(storageRoot, audit) {
  const keysDir = path.join(storageRoot, "keys");
  const keysFile = path.join(keysDir, "keys.json");
  ensureDir(keysDir);

  function listAll() {
    return readJson(keysFile, []);
  }

  function saveAll(records) {
    writeJson(keysFile, records);
  }

  function createKey(input = {}) {
    const preset = KEY_PRESETS[input.preset] || null;
    const requestedType = input.key_type || preset?.key_type;
    const keyType = requestedType === "automation" ? "automation" : requestedType === "user_session" ? "user_session" : "connector";
    const keyId = `key_${crypto.randomUUID()}`;
    const secret = `SHX-${keyType.toUpperCase()}-${crypto.randomBytes(18).toString("base64url")}`;
    const fallbackScopes = preset?.scopes || (keyType === "automation" ? DEFAULT_AUTOMATION_SCOPES : DEFAULT_CONNECTOR_SCOPES);
    const domainPackId = String(input.domain_pack_id || input.metadata?.domain_pack_id || "").trim();
    if (domainPackId && !getDomainPack(domainPackId)) throw new Error("invalid_domain_pack_id");
    const record = {
      key_id: keyId,
      key_type: keyType,
      key_hash: sha256(secret),
      tenant_id: String(input.tenant_id || "").trim(),
      brand_scope: String(input.brand_scope || "").trim(),
      label: String(input.label || preset?.label || "").trim(),
      preset: preset ? String(input.preset) : null,
      allowed_scopes: sanitizeScopes(input.allowed_scopes, fallbackScopes),
      status: "active",
      created_at: new Date().toISOString(),
      expires_at: input.expires_at || null,
      last_used_at: null,
      revoked_at: null,
      metadata: {
        ...(typeof input.metadata === "object" && input.metadata ? input.metadata : {}),
        domain_pack_id: domainPackId || undefined,
        tier: String(input.tier || input.metadata?.tier || preset?.tier || "").trim() || undefined,
        suite_tier: String(input.suite_tier || input.metadata?.suite_tier || input.tier || input.metadata?.tier || preset?.tier || "").trim() || undefined,
        active_branches: Array.isArray(input.active_branches)
          ? input.active_branches.map(String)
          : Array.isArray(input.metadata?.active_branches)
            ? input.metadata.active_branches.map(String)
            : undefined,
        active_branch_groups: Array.isArray(input.active_branch_groups)
          ? input.active_branch_groups.map(String)
          : Array.isArray(input.metadata?.active_branch_groups)
            ? input.metadata.active_branch_groups.map(String)
            : undefined,
        suite_modules: sanitizeSuiteModules(
          Array.isArray(input.suite_modules)
            ? input.suite_modules
            : Array.isArray(input.metadata?.suite_modules)
              ? input.metadata.suite_modules
              : [],
        ),
        suite_limits: normalizeSuiteLimits(
          typeof input.suite_limits === "object" && input.suite_limits
            ? input.suite_limits
            : typeof input.metadata?.suite_limits === "object" && input.metadata.suite_limits
              ? input.metadata.suite_limits
              : { seat_limit: input.seat_limit || input.metadata?.seat_limit },
        ),
        allowed_domains: normalizeAllowedDomains(input.allowed_domains || input.metadata?.allowed_domains),
        suite_policy: {
          ...(typeof input.metadata?.suite_policy === "object" && input.metadata.suite_policy ? input.metadata.suite_policy : {}),
          ...(typeof input.suite_policy === "object" && input.suite_policy ? input.suite_policy : {}),
          soft_gate: true,
          hard_block: false,
        },
        branch_limits: typeof input.branch_limits === "object" && input.branch_limits
          ? input.branch_limits
          : typeof input.metadata?.branch_limits === "object" && input.metadata.branch_limits
            ? input.metadata.branch_limits
            : undefined,
      },
    };

    if (!record.tenant_id) {
      throw new Error("tenant_id_required");
    }

    const records = listAll();
    records.push(record);
    saveAll(records);
    audit?.append("core_key_created", { key_id: keyId, tenant_id: record.tenant_id, key_type: keyType, scopes: record.allowed_scopes });
    return { key: secret, record: publicRecord(record) };
  }

  function ensureProviderSetupLinkKey(input = {}) {
    const secret = String(input.secret || "").trim();
    const tenantId = String(input.tenant_id || "").trim();
    if (!secret) throw new Error("provider_setup_link_key_required");
    if (!tenantId) throw new Error("provider_setup_link_tenant_required");

    const keyHash = sha256(secret);
    const records = listAll();
    const existing = records.find((record) => record.key_hash === keyHash);
    if (existing) {
      if (!isDedicatedProviderSetupLinkRecord(existing, tenantId, keyHash)) {
        throw new Error("provider_setup_link_key_conflict");
      }
      return { created: false, record: publicRecord(existing) };
    }

    const existingBootstrap = records.find((record) => (
      record.tenant_id === tenantId &&
      record.metadata?.bootstrap_kind === PROVIDER_SETUP_LINK_BOOTSTRAP_KIND
    ));
    if (existingBootstrap) throw new Error("provider_setup_link_key_rotation_required");

    const record = {
      key_id: `key_${crypto.randomUUID()}`,
      key_type: "connector",
      key_hash: keyHash,
      tenant_id: tenantId,
      brand_scope: "",
      label: "Provider setup-link issuer",
      preset: null,
      allowed_scopes: [...PROVIDER_SETUP_LINK_SCOPES],
      status: "active",
      created_at: new Date().toISOString(),
      expires_at: null,
      last_used_at: null,
      revoked_at: null,
      metadata: {
        bootstrap_kind: PROVIDER_SETUP_LINK_BOOTSTRAP_KIND,
        suite_modules: [],
        suite_limits: normalizeSuiteLimits({}),
        allowed_domains: [],
        suite_policy: {
          soft_gate: true,
          hard_block: false,
        },
      },
    };

    records.push(record);
    saveAll(records);
    audit?.append("core_provider_setup_link_key_seeded", {
      key_id: record.key_id,
      tenant_id: record.tenant_id,
      key_type: record.key_type,
      scopes: record.allowed_scopes,
    });
    return { created: true, record: publicRecord(record) };
  }

  function ensureProviderSetupLinkServiceKey(input = {}) {
    const secret = String(input.secret || "").trim();
    if (!secret) throw new Error("provider_setup_link_service_key_required");
    const keyHash = sha256(secret);
    const records = listAll();
    const existing = records.find((record) => record.key_hash === keyHash);
    if (existing) {
      if (!isProviderSetupLinkServiceRecord(existing)) throw new Error("provider_setup_link_service_key_conflict");
      return { created: false, record: publicRecord(existing) };
    }
    if (records.some((record) => record.metadata?.bootstrap_kind === PROVIDER_SETUP_LINK_SERVICE_KIND)) {
      throw new Error("provider_setup_link_service_key_rotation_required");
    }
    const record = {
      key_id: `key_${crypto.randomUUID()}`,
      key_type: "connector",
      key_hash: keyHash,
      tenant_id: PROVIDER_SETUP_LINK_SERVICE_TENANT,
      brand_scope: "",
      label: "Tenant provider setup-link issuer",
      preset: null,
      allowed_scopes: [...PROVIDER_SETUP_LINK_SCOPES],
      status: "active",
      created_at: new Date().toISOString(),
      expires_at: null,
      last_used_at: null,
      revoked_at: null,
      metadata: { bootstrap_kind: PROVIDER_SETUP_LINK_SERVICE_KIND, suite_modules: [], suite_limits: normalizeSuiteLimits({}), allowed_domains: [], suite_policy: { soft_gate: true, hard_block: false } },
    };
    records.push(record);
    saveAll(records);
    audit?.append("core_provider_setup_link_service_key_seeded", { key_id: record.key_id, key_type: record.key_type, scopes: record.allowed_scopes });
    return { created: true, record: publicRecord(record) };
  }

  function authenticate(secret) {
    if (!secret) return { ok: false, error: "missing_key" };
    const records = listAll();
    const keyHash = sha256(secret);
    const record = records.find((item) => item.key_hash === keyHash);
    if (!record) return { ok: false, error: "invalid_key" };
    if (record.status !== "active") return { ok: false, error: `key_${record.status}`, record: publicRecord(record) };
    if (record.expires_at && new Date(record.expires_at).getTime() < Date.now()) {
      return { ok: false, error: "key_expired", record: publicRecord(record) };
    }

    record.last_used_at = new Date().toISOString();
    saveAll(records);
    return { ok: true, record };
  }

  function revokeKey(keyId, status = "revoked") {
    const records = listAll();
    const record = records.find((item) => item.key_id === keyId);
    if (!record) return null;
    record.status = status === "suspended" ? "suspended" : "revoked";
    record.revoked_at = new Date().toISOString();
    saveAll(records);
    audit?.append("core_key_revoked", { key_id: record.key_id, tenant_id: record.tenant_id, status: record.status });
    return publicRecord(record);
  }

  function listKeys(filter = {}) {
    return listAll()
      .filter((record) => !filter.tenant_id || record.tenant_id === filter.tenant_id)
      .map(publicRecord);
  }

  return {
    createKey,
    ensureProviderSetupLinkKey,
    ensureProviderSetupLinkServiceKey,
    authenticate,
    revokeKey,
    listKeys,
    publicRecord,
  };
}
