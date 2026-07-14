import { resolveDomainPack } from "./domainPacks.js";

export function normalizeTenantId(value) {
  return String(value || "default").toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "_") || "default";
}

export function getTenantPolicy(tenantId, plan = "", options = {}) {
  const normalized = normalizeTenantId(tenantId);
  const pack = resolveDomainPack({ tenantId: normalized, brandScope: options.brandScope, metadata: options.metadata });
  const base = pack.policy;
  return {
    ...base,
    tenant_id: normalized,
    domain: pack.domain,
    domain_pack: { id: pack.id, version: pack.version, runtime_kind: pack.runtime_kind },
    plan: String(plan || "").trim() || "unspecified",
    source: pack.id === "generic" ? "default_policy" : "domain_pack_registry",
    runtime_rule: "Universal Core resta agnostico; la specificita business viene iniettata tramite tenant policy.",
  };
}
