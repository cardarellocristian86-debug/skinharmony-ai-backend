import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalService } from "../src/approvals.js";

const key = "x".repeat(64);
const actor = (subject, role, tenant_id = "tenant-a") => ({ subject, role, tenant_id });

test("creates immutable scoped approval and consumes it once", () => {
  const service = new ApprovalService({ keys: { k1: key }, activeKid: "k1" });
  const request = service.create(actor("operator", "operator"), { tenant_id: "tenant-a", plan: "basic", action_type: "deploy", action_label: "Deploy MCP", payload: { sha: "abc" } });
  assert(Object.isFrozen(request));
  const approved = service.approve(actor("owner", "owner"), request.id, { authentication_method: "passkey" });
  const result = service.consume(actor("executor", "operator"), { token: approved.confirmation_token, tenant_id: "tenant-a", action_type: "deploy", payload: { sha: "abc" } });
  assert.equal(result.verified, true);
  assert.throws(() => service.consume(actor("executor", "operator"), { token: approved.confirmation_token, tenant_id: "tenant-a", action_type: "deploy", payload: { sha: "abc" } }), /confirmation_spent_or_revoked/);
});

test("rejects cross-tenant and payload substitution", () => {
  const service = new ApprovalService({ keys: { k1: key }, activeKid: "k1" });
  const request = service.create(actor("operator", "operator"), { tenant_id: "tenant-a", action_type: "deploy", action_label: "Deploy", payload: { sha: "abc" } });
  assert.throws(() => service.approve(actor("owner-b", "owner", "tenant-b"), request.id), /tenant_forbidden/);
  const approved = service.approve(actor("owner", "owner"), request.id);
  assert.throws(() => service.consume(actor("executor", "operator"), { token: approved.confirmation_token, tenant_id: "tenant-a", action_type: "deploy", payload: { sha: "changed" } }), /confirmation_scope_mismatch/);
});

test("enterprise requires two distinct strong-auth approvers", () => {
  const service = new ApprovalService({ keys: { k1: key }, activeKid: "k1" });
  const request = service.create(actor("operator", "operator"), { tenant_id: "tenant-a", plan: "enterprise", action_type: "publish", action_label: "Publish", payload: {} });
  assert.throws(() => service.approve(actor("owner", "owner"), request.id, { authentication_method: "oauth" }), /strong_auth_required/);
  const first = service.approve(actor("owner", "owner"), request.id, { authentication_method: "sso" });
  assert.equal(first.state, "pending");
  assert.throws(() => service.approve(actor("owner", "owner"), request.id, { authentication_method: "sso" }), /duplicate_approver/);
  const second = service.approve(actor("approver", "approver"), request.id, { authentication_method: "passkey" });
  assert.equal(second.state, "approved");
});

test("expiry and revocation fail closed", () => {
  let now = 1000;
  const service = new ApprovalService({ keys: { k1: key }, activeKid: "k1", now: () => now, ttlMs: 100 });
  const expiring = service.create(actor("operator", "operator"), { tenant_id: "tenant-a", action_type: "deploy", action_label: "Deploy", payload: {} });
  now = 1200;
  assert.throws(() => service.approve(actor("owner", "owner"), expiring.id), /approval_not_pending/);
  now = 2000;
  const current = service.create(actor("operator", "operator"), { tenant_id: "tenant-a", action_type: "deploy", action_label: "Deploy", payload: {} });
  const approved = service.approve(actor("owner", "owner"), current.id);
  service.revoke(actor("owner", "owner"), current.id);
  assert.throws(() => service.consume(actor("executor", "operator"), { token: approved.confirmation_token, tenant_id: "tenant-a", action_type: "deploy", payload: {} }), /confirmation_spent_or_revoked/);
});
