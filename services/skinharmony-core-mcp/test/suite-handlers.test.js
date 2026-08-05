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

test("Suite UI blueprint returns only structural browser evidence and redacts reference query strings", async () => {
  const calls = [];
  const handlers = createSuiteHandlers({}, {
    client: {},
    browserRuntime: {
      execute: async (input) => {
        calls.push(input);
        return {
          javascript: {
            layout_regions: { header: 1, navigation: 1, main: 1, section: 4, article: 0, aside: 0, footer: 1 },
            hierarchy: { headings: [{ level: 1, count: 1 }], landmarks: 4 },
            components: { links: 12, buttons: 3, forms: 1, controls: { inputs: 2, textarea: 0, select: 0, buttons: 3 }, media: 5 },
            behavior_signals: { client_scripts: 8, has_search: false, has_live_regions: false },
            navigation: [{ region: "header", items: 6, buttons: 1, list_groups: 1, nested_groups: 2, disclosure_controls: 1, mobile_toggle_present: true, copied_label: "Navigation" }],
            ctas: [{ kind: "link", region: "main", action: "navigation", target_scope: "internal", has_accessible_name: true, has_icon: false, disabled: false, text_length: 12, copied_text: "Shop now" }],
            page_sections: [{ kind: "section", region: "main", heading_level: 2, child_sections: 0, links: 2, buttons: 1, media: 1, copied_heading: "Hero" }],
            forms: [{ region: "footer", inputs: 1, textareas: 0, selects: 0, required_controls: 1, submit_controls: 1, has_search: false, copied_action: "/subscribe" }],
            complexity: { dom_elements: 200 },
            forbidden_page_text: "Do not copy this page",
          },
          state: { text: "This must never leave the browser runtime" },
          screenshot_base64: "never-returned",
        };
      },
    },
  });
  const output = await handlers.suite_web_ui_blueprint({
    reference_urls: ["https://example.test/landing?private=1#hero"],
    own_content_slots: [{ slot_id: "hero_title", kind: "own_heading", required: true }],
  }, { tenantId: "tenant-a" });
  const payload = output.structuredContent;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tenantId, "tenant-a");
  assert.equal(calls[0].screenshot, false);
  assert.deepEqual(calls[0].actions, []);
  assert.equal(payload.references[0].reference_url, "https://example.test/landing");
  assert.equal(payload.references[0].structure.forbidden_page_text, undefined);
  assert.equal(payload.references[0].structure.navigation[0].items, 6);
  assert.equal(payload.references[0].structure.navigation[0].copied_label, undefined);
  assert.equal(payload.references[0].structure.ctas[0].action, "navigation");
  assert.equal(payload.references[0].structure.ctas[0].copied_text, undefined);
  assert.equal(payload.references[0].structure.page_sections[0].heading_level, 2);
  assert.equal(payload.references[0].structure.forms[0].submit_controls, 1);
  assert.equal(JSON.stringify(payload).includes("This must never leave"), false);
  assert.equal(JSON.stringify(payload).includes("never-returned"), false);
  assert.equal(payload.guardrails.third_party_code_copied, false);
  assert.deepEqual(payload.own_content_contract.slots, [{ slot_id: "hero_title", kind: "own_heading", required: true }]);
});
