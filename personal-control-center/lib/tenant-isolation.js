"use strict";

const crypto = require("crypto");

function cleanScope(value, fallback = "", max = 120) {
  const normalized = String(value || fallback || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.slice(0, max);
}

function resolveTenantScope(payload = {}, defaults = {}) {
  const tenantId = cleanScope(
    payload.tenant_id || payload.tenantId,
    defaults.tenantId || defaults.tenant_id || "codexai"
  );
  const centerId = cleanScope(
    payload.center_id || payload.centerId,
    defaults.centerId || defaults.center_id || "center_admin"
  );
  return { tenantId, centerId, namespace: `${tenantId}:${centerId}` };
}

function scopedEntityId(kind, sourceId, scope) {
  const resolved = resolveTenantScope(scope);
  const digest = crypto.createHash("sha256")
    .update(`${resolved.namespace}:${String(kind || "entity")}:${String(sourceId || "")}`)
    .digest("hex")
    .slice(0, 32);
  return `${cleanScope(kind, "entity", 32)}_${digest}`;
}

function profileStoreKey(profileId, scope) {
  const resolved = resolveTenantScope(scope);
  return `${resolved.namespace}:${String(profileId || "")}`;
}

module.exports = { cleanScope, resolveTenantScope, scopedEntityId, profileStoreKey };
