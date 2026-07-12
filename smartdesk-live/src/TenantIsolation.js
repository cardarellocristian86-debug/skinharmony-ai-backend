"use strict";

function cleanScope(value, fallback = "", max = 120) {
  const normalized = String(value || fallback || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.slice(0, max);
}

function resolveBridgeScope(record = {}, defaults = {}) {
  return {
    tenantId: cleanScope(
      record.tenantId || record.tenant_id,
      defaults.tenantId || defaults.tenant_id || "smartdesk-skinharmony"
    ),
    centerId: cleanScope(
      record.centerId || record.center_id,
      defaults.centerId || defaults.center_id || "center_admin"
    ),
    centerName: String(record.centerName || record.center_name || defaults.centerName || defaults.center_name || "").trim().slice(0, 160)
  };
}

function hasExplicitBridgeScope(record = {}) {
  return Boolean(
    String(record.tenantId || record.tenant_id || "").trim()
    && String(record.centerId || record.center_id || "").trim()
  );
}

module.exports = { cleanScope, resolveBridgeScope, hasExplicitBridgeScope };
