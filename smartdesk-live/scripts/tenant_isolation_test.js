"use strict";

const assert = require("node:assert");
const { resolveBridgeScope, hasExplicitBridgeScope } = require("../src/TenantIsolation");

const fallback = { tenantId: "tenant-default", centerId: "center-default" };
assert.deepStrictEqual(resolveBridgeScope({}, fallback), {
  tenantId: "tenant-default",
  centerId: "center-default",
  centerName: ""
});

const first = resolveBridgeScope({ tenant_id: "Tenant A", center_id: "Center 1" }, fallback);
const second = resolveBridgeScope({ tenantId: "Tenant B", centerId: "Center 1" }, fallback);
assert.strictEqual(first.tenantId, "tenant_a");
assert.strictEqual(second.tenantId, "tenant_b");
assert.notStrictEqual(`${first.tenantId}:${first.centerId}`, `${second.tenantId}:${second.centerId}`);
assert.strictEqual(hasExplicitBridgeScope({ tenant_id: "tenant-a", center_id: "center-1" }), true);
assert.strictEqual(hasExplicitBridgeScope({ tenant_id: "tenant-a" }), false);

console.log(JSON.stringify({ ok: true, runner: "tenant_isolation_test" }, null, 2));
