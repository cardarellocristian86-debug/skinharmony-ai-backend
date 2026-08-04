const PREFLIGHT_SCHEMA_VERSION = "skinharmony_work_preflight_v1";
const GALLERY_SCHEMA_VERSION = "tenant_work_gallery_v1";

function text(value, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function candidatePreflight(request = {}) {
  return request?.work_preflight
    || request?.context?.work_preflight
    || request?.action?.work_preflight
    || request?.policy?.work_preflight
    || null;
}

export function validateWorkPreflightEnvelope(request = {}, tenantId, {
  requireGallery = true,
  requireMemory = true,
  requireExecution = false,
} = {}) {
  const preflight = candidatePreflight(request);
  const expectedTenant = text(tenantId, 120);
  const errors = [];
  if (!preflight || typeof preflight !== "object" || Array.isArray(preflight)) {
    errors.push("work_preflight_required");
  } else {
    if (preflight.schema_version !== PREFLIGHT_SCHEMA_VERSION) errors.push("work_preflight_schema_invalid");
    const security = preflight.security_governance;
    if (!security || security.schema_version !== "nyra_core_security_gate_v1"
      || security.always_on !== true
      || security.fail_closed !== true
      || security.core_verdict_required !== true
      || security.source_instructions_are_data !== true
      || security.cross_tenant_blocked !== true) {
      errors.push("security_governance_required");
    }
    if (!text(preflight.preflight_id, 160)) errors.push("work_preflight_id_missing");
    if (!preflight.mandatory) errors.push("work_preflight_not_mandatory");
    if (text(preflight.tenant_id, 120) !== expectedTenant) errors.push("work_preflight_tenant_mismatch");
    if (preflight.operational_surface !== "tenant_work_gallery") errors.push("work_preflight_surface_invalid");
    const gallery = preflight.tenant_work_gallery;
    if (requireGallery && (!gallery || gallery.schema_version !== GALLERY_SCHEMA_VERSION
      || gallery.tenant_id !== expectedTenant || gallery.available !== true
      || !["ready", "membership_required"].includes(gallery.state))) {
      errors.push("work_gallery_required");
    }
    if (requireMemory && preflight.memory_first?.status !== "recalled") errors.push("work_memory_recall_required");
    if (typeof preflight.governance?.execution_allowed_by_preflight !== "boolean") {
      errors.push("work_preflight_governance_missing");
    } else if (requireExecution && preflight.governance.execution_allowed_by_preflight !== true) {
      errors.push("work_preflight_execution_denied");
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    preflight: errors.length === 0 ? preflight : null,
    execution_allowed: errors.length === 0 && preflight.governance.execution_allowed_by_preflight === true,
  };
}

export function workPreflightFailure(errors = []) {
  const unique = [...new Set(errors.map((item) => text(item, 120)).filter(Boolean))];
  return {
    code: unique.includes("work_preflight_required") ? "WORK_PREFLIGHT_REQUIRED" : "WORK_PREFLIGHT_INVALID",
    reason_codes: unique.length ? unique : ["work_preflight_invalid"],
    execution_allowed: false,
  };
}

export const WORK_PREFLIGHT_GATE_CONTRACT = Object.freeze({
  schema_version: "work_preflight_gate_v1",
  preflight_schema_version: PREFLIGHT_SCHEMA_VERSION,
  gallery_schema_version: GALLERY_SCHEMA_VERSION,
  fail_closed: true,
  applies_to: ["universal_core", "core_mcp", "nyra", "smartdesk", "connected_adapters"],
  execution_requires_gallery: true,
  execution_requires_memory_recall: true,
  core_remains_final_authority: true,
  security_governance_schema_version: "nyra_core_security_gate_v1",
  security_always_on: true,
  security_fail_closed: true,
});
