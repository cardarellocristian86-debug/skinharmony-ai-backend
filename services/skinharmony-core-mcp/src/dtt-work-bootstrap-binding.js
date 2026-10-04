import crypto from "node:crypto";

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => (
    value[key] === undefined ? [] : [[key, stableCanonical(value[key])]]
  )));
}

// This resolver is intentionally dependency-injected so the server and its
// integration test share the same authorization-to-binding path.
export function createDttWorkBootstrapBindingResolver({
  authorizeExactWorkRead,
  store,
  withTenantWorkAcl,
  requireTenantWorkCapability,
  aclError,
  now = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
} = {}) {
  if (typeof authorizeExactWorkRead !== "function" || typeof withTenantWorkAcl !== "function" ||
      typeof requireTenantWorkCapability !== "function" || typeof aclError !== "function") {
    throw new Error("dtt_work_bootstrap_binding_unavailable");
  }
  return async function resolveDttWorkBootstrapBinding(identity, workId) {
    requireTenantWorkCapability(identity, "read");
    const presence = identity?.agentPresence;
    if (!presence || presence.transport_bound !== true) {
      throw aclError("dtt_work_signed_presence_required", 403);
    }
    const authorized = await authorizeExactWorkRead({
      store,
      identity: withTenantWorkAcl(identity),
      tenant_id: identity.tenantId,
      work_id: workId,
      include_work: true,
    });
    const work = authorized.work;
    if (!work || work.work_id !== workId ||
        work.causal_lineage_state !== "READY" ||
        !/^[a-f0-9]{64}$/u.test(String(work.causal_lineage_digest || "")) ||
        !/^[a-f0-9]{64}$/u.test(String(work.intent_digest || ""))) {
      throw aclError("dtt_work_bootstrap_binding_denied", 409);
    }
    return Object.freeze({
      schema_version: "dtt_work_bootstrap_binding_v1",
      tenant_id: identity.tenantId,
      work_id: workId,
      binding_id: randomUUID(),
      work_binding_digest: crypto.createHash("sha256")
        .update(JSON.stringify(stableCanonical({
          schema_version: "dtt_work_bootstrap_work_binding_v1",
          tenant_id: identity.tenantId,
          work_id: workId,
          legacy_work_id: work.legacy_work_id || null,
          project_id: work.project_id,
          intent_digest: work.intent_digest,
          causal_lineage_digest: work.causal_lineage_digest,
        })))
        .digest("hex"),
      expires_at: new Date(now() + 60_000).toISOString(),
      server_owned: true,
      execution_authorized: false,
    });
  };
}
