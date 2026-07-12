import crypto from "node:crypto";

const PLANS = Object.freeze({
  basic: { approvals: 1, roles: ["owner"] },
  pro: { approvals: 1, roles: ["owner", "approver"], auditExport: true },
  enterprise: { approvals: 2, roles: ["owner", "approver"], auditExport: true, ssoRequired: true }
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

function opaque(prefix) {
  return `${prefix}_${crypto.randomBytes(18).toString("base64url")}`;
}

function fail(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

export class MemoryApprovalStore {
  constructor() { this.requests = new Map(); this.confirmations = new Map(); this.audit = []; }
}

export class ApprovalService {
  constructor({ keys, activeKid, store = new MemoryApprovalStore(), now = () => Date.now(), ttlMs = 15 * 60_000 } = {}) {
    this.keys = keys || {};
    this.activeKid = activeKid;
    this.store = store;
    this.now = now;
    this.ttlMs = ttlMs;
    if (!activeKid || !this.keys[activeKid] || Buffer.byteLength(this.keys[activeKid]) < 32) fail("approval_signing_key_required", 500);
  }

  audit(event, actor, details = {}) {
    const entry = Object.freeze({ id: opaque("aud"), at: new Date(this.now()).toISOString(), event, tenant_id: actor.tenant_id, actor_id: actor.subject, ...details });
    this.store.audit.push(entry);
    return entry;
  }

  assertTenant(actor, tenantId) {
    if (!actor?.subject || !actor?.tenant_id || actor.tenant_id !== tenantId) fail("tenant_forbidden", 403);
  }

  create(actor, input) {
    this.assertTenant(actor, input.tenant_id);
    if (!["owner", "operator"].includes(actor.role)) fail("role_forbidden", 403);
    const policy = PLANS[input.plan || "basic"];
    if (!policy) fail("plan_invalid");
    const request = Object.freeze({
      id: opaque("apr"), tenant_id: input.tenant_id, plan: input.plan || "basic", action_type: String(input.action_type),
      action_label: String(input.action_label), payload_hash: digest(input.payload || {}), risk: input.risk || "medium",
      required_approvals: policy.approvals, approvals: Object.freeze([]), state: "pending", created_by: actor.subject,
      created_at: new Date(this.now()).toISOString(), expires_at: new Date(this.now() + (input.ttl_ms || this.ttlMs)).toISOString()
    });
    this.store.requests.set(request.id, request);
    this.audit("approval.requested", actor, { request_id: request.id, action_type: request.action_type, payload_hash: request.payload_hash });
    return request;
  }

  list(actor, { state = "pending" } = {}) {
    return [...this.store.requests.values()].filter((item) => item.tenant_id === actor.tenant_id && (!state || item.state === state));
  }

  approve(actor, requestId, { authentication_method = "oauth" } = {}) {
    const current = this.store.requests.get(requestId);
    if (!current) fail("approval_not_found", 404);
    this.assertTenant(actor, current.tenant_id);
    const policy = PLANS[current.plan];
    if (!policy.roles.includes(actor.role)) fail("role_forbidden", 403);
    if (policy.ssoRequired && !["sso", "passkey"].includes(authentication_method)) fail("strong_auth_required", 403);
    if (current.state !== "pending" || Date.parse(current.expires_at) <= this.now()) fail("approval_not_pending", 409);
    if (current.approvals.some((item) => item.subject === actor.subject)) fail("duplicate_approver", 409);
    const approvals = Object.freeze([...current.approvals, Object.freeze({ subject: actor.subject, role: actor.role, authentication_method, at: new Date(this.now()).toISOString() })]);
    let next = Object.freeze({ ...current, approvals });
    if (approvals.length >= current.required_approvals) {
      const confirmationId = opaque("ocf");
      const expiresAt = Math.min(Date.parse(current.expires_at), this.now() + this.ttlMs);
      const claims = { jti: confirmationId, tenant_id: current.tenant_id, request_id: current.id, action_type: current.action_type, payload_hash: current.payload_hash, approvers: approvals.map((item) => item.subject), iat: this.now(), exp: expiresAt };
      const encoded = Buffer.from(canonical(claims)).toString("base64url");
      const signature = crypto.createHmac("sha256", this.keys[this.activeKid]).update(encoded).digest("base64url");
      const token = `${this.activeKid}.${encoded}.${signature}`;
      this.store.confirmations.set(confirmationId, { ...claims, token, state: "active" });
      next = Object.freeze({ ...next, state: "approved", owner_confirmation_id: confirmationId, confirmation_token: token, approved_at: new Date(this.now()).toISOString() });
    }
    this.store.requests.set(requestId, next);
    this.audit("approval.approved", actor, { request_id: requestId, quorum_reached: next.state === "approved" });
    return next;
  }

  consume(actor, { token, tenant_id, action_type, payload }) {
    this.assertTenant(actor, tenant_id);
    const [kid, encoded, signature] = String(token || "").split(".");
    if (!kid || !encoded || !signature || !this.keys[kid]) fail("confirmation_invalid", 401);
    const expected = crypto.createHmac("sha256", this.keys[kid]).update(encoded).digest("base64url");
    const a = Buffer.from(signature); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) fail("confirmation_invalid", 401);
    const claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const record = this.store.confirmations.get(claims.jti);
    if (!record || record.state !== "active") fail("confirmation_spent_or_revoked", 409);
    if (claims.exp <= this.now()) fail("confirmation_expired", 401);
    if (claims.tenant_id !== tenant_id || claims.action_type !== action_type || claims.payload_hash !== digest(payload || {})) fail("confirmation_scope_mismatch", 403);
    this.store.confirmations.set(claims.jti, { ...record, state: "consumed", consumed_at: new Date(this.now()).toISOString() });
    this.audit("confirmation.consumed", actor, { request_id: claims.request_id, owner_confirmation_id: claims.jti });
    return { owner_confirmation_id: claims.jti, verified: true, consumed: true };
  }

  revoke(actor, requestId) {
    const current = this.store.requests.get(requestId);
    if (!current) fail("approval_not_found", 404);
    this.assertTenant(actor, current.tenant_id);
    if (actor.role !== "owner") fail("role_forbidden", 403);
    const next = Object.freeze({ ...current, state: "revoked", revoked_at: new Date(this.now()).toISOString() });
    this.store.requests.set(requestId, next);
    if (current.owner_confirmation_id) this.store.confirmations.set(current.owner_confirmation_id, { ...this.store.confirmations.get(current.owner_confirmation_id), state: "revoked" });
    this.audit("approval.revoked", actor, { request_id: requestId });
    return next;
  }

  auditLog(actor) {
    return this.store.audit.filter((item) => item.tenant_id === actor.tenant_id);
  }
}

export { PLANS, canonical, digest };
