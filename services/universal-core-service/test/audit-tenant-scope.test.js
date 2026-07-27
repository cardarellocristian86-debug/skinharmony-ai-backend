import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAudit } from "../src/audit.js";

test("tenant audit reads filter before limiting and exclude other tenants", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-audit-scope-"));
  try {
    const audit = createAudit(root);
    audit.append("tenant_a_old", { tenant_id: "tenant-a" });
    for (let index = 0; index < 210; index += 1) {
      audit.append("tenant_b_noise", { tenant_id: "tenant-b", index });
    }
    audit.append("global_event", {});
    audit.append("tenant_a_new", { tenant_id: "tenant-a" });

    const tenantOnly = audit.recentForTenant("tenant-a", 50);
    assert.deepEqual(tenantOnly.map((event) => event.event_type), ["tenant_a_old", "tenant_a_new"]);
    assert(tenantOnly.every((event) => event.tenant_id === "tenant-a"));

    const withGlobal = audit.recentForTenant("tenant-a", 50, { includeGlobal: true });
    assert.deepEqual(withGlobal.map((event) => event.event_type), ["tenant_a_old", "global_event", "tenant_a_new"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("tenant audit rejects empty or malformed tenant identifiers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-audit-scope-"));
  try {
    const audit = createAudit(root);
    assert.throws(() => audit.recentForTenant("", 10), /tenant_id_invalid/);
    assert.throws(() => audit.recentForTenant("../tenant", 10), /tenant_id_invalid/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
