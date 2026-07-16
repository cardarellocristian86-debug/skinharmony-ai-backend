import assert from "node:assert/strict";
import test from "node:test";
import { createSuiteHandlers, sanitizeSuiteValue } from "../src/suite-handlers.js";

function cockpit(tenantId = "tenant-a") {
  return {
    ok: true,
    schema_version: "cockpit_360_summary_v1",
    revision_hash: "a".repeat(64),
    generated_at: "2026-07-16T12:00:00.000Z",
    scope: { tenant_id: tenantId, node_id: "node-a" },
    freshness: { node_status: "online", heartbeat_fresh: true, heartbeat_age_seconds: 10 },
    summary: { branches_total: 14, ready: 12, attention: 2, blocked: 0, insufficient_data: 0, tenant_readiness_score: 92 },
    branches: [{ key: "pricing_margin", state: "attention", primary_reason: "margin_attention" }],
    priorities: [{ branch_key: "pricing_margin", action: "claim_price_audit" }],
    customers: [{ full_name: "Private Person", email: "private@example.test", phone: "+390000" }],
    raw_customer_records: [{ id: "private-record" }],
    diagnostics: { access_token: "secret-provider-token", api_key: "secret-key" },
    guardrails: { aggregate_only: true, execution_allowed: false },
  };
}

function catalog() {
  return {
    ok: true,
    branch_map: {
      schema: "nyra_suite_branch_architecture_v2",
      version: "2026-07-16",
      branch_keys: ["pricing_margin"],
      branch_groups: { governance: ["pricing_margin"] },
      pipeline: { stages: ["facts", "freshness", "decision"] },
      branches: [{
        key: "pricing_margin",
        label: "Pricing and margin",
        purpose: "Read aggregate margin readiness.",
        evidence_sources: [{ id: "margin_summary", required: true, aggregate_only: true }],
        dependencies: { hard: [], soft: [] },
        decision_rules: { rules: ["no_below_cost"] },
        raw_customer_records: [{ email: "hidden@example.test" }],
      }],
      guardrails: { execution_allowed: false },
      validation: { ok: true },
    },
  };
}

test("Suite handlers remove raw customer records, PII and credentials defensively", async () => {
  const handlers = createSuiteHandlers({}, {
    client: {
      cockpit360: async () => cockpit(),
      branchCatalog: async () => catalog(),
      decisionPreview: async () => ({ ok: true, tenant_id: "tenant-a", customers: [{ email: "hidden@example.test" }], refresh_token: "never" }),
      runbookCatalog: async () => ({ ok: true, runbooks: [], client_secret: "never" }),
      runbookPreview: async () => ({ ok: true, preview: { runbook_id: "customer_report", execution_allowed: false }, contacts: [{ phone: "never" }] }),
    },
  });
  const identity = { tenantId: "tenant-a" };
  const outputs = [
    await handlers.suite_cockpit_360({}, identity),
    await handlers.suite_branch_catalog({}, identity),
    await handlers.suite_branch_read({ branch_key: "pricing_margin" }, identity),
    await handlers.suite_decision_preview({ question: "What next?" }, identity),
    await handlers.suite_runbook_catalog({}, identity),
    await handlers.suite_runbook_preview({ runbook_id: "customer_report", node_id: "node-a" }, identity),
  ];
  const serialized = JSON.stringify(outputs.map((output) => output.structuredContent));
  for (const forbidden of ["Private Person", "private@example.test", "+390000", "private-record", "secret-provider-token", "secret-key", "hidden@example.test", "refresh_token", "client_secret"]) {
    assert.equal(serialized.includes(forbidden), false, `privacy leak: ${forbidden}`);
  }
  assert.match(serialized, /pricing_margin/);
  assert.match(serialized, /aggregate_only/);
});

test("Suite status and branch reads keep the authenticated identity on every upstream call", async () => {
  const tenants = [];
  const client = {
    cockpit360: async (identity) => { tenants.push(identity.tenantId); return cockpit(identity.tenantId); },
    branchCatalog: async (identity) => { tenants.push(identity.tenantId); return catalog(); },
  };
  const handlers = createSuiteHandlers({}, { client });
  const statusA = await handlers.suite_status({}, { tenantId: "tenant-a" });
  const branchB = await handlers.suite_branch_read({ branch_key: "pricing_margin" }, { tenantId: "tenant-b" });
  assert.equal(statusA.structuredContent.scope.tenant_id, "tenant-a");
  assert.equal(branchB.structuredContent.branch_key, "pricing_margin");
  assert.deepEqual(tenants, ["tenant-a", "tenant-b", "tenant-b"]);
});

test("sanitizer retains aggregate counts but removes record collections", () => {
  const sanitized = sanitizeSuiteValue({
    crm_contacts: 12,
    profiles_visible: 3,
    contacts: [{ email: "hidden@example.test" }],
    profiles: [{ full_name: "Hidden" }],
  });
  assert.equal(sanitized.crm_contacts, 12);
  assert.equal(sanitized.profiles_visible, 3);
  assert.equal("contacts" in sanitized, false);
  assert.equal("profiles" in sanitized, false);
});
