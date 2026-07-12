"use strict";

const assert = require("node:assert");
const { resolveTenantScope, scopedEntityId, profileStoreKey } = require("../lib/tenant-isolation");

const a = resolveTenantScope({ tenant_id: "tenant-a", center_id: "center-1" });
const b = resolveTenantScope({ tenant_id: "tenant-b", center_id: "center-1" });

assert.notStrictEqual(scopedEntityId("sale", "same-id", a), scopedEntityId("sale", "same-id", b));
assert.notStrictEqual(scopedEntityId("inventory", "same-id", a), scopedEntityId("inventory", "same-id", b));
assert.notStrictEqual(profileStoreKey("p_same", a), profileStoreKey("p_same", b));
assert.strictEqual(resolveTenantScope({ tenant_id: "Tenant A", center_id: "Center 1" }).namespace, "tenant_a:center_1");

console.log(JSON.stringify({ ok: true, runner: "nyra_tenant_isolation_test" }, null, 2));
