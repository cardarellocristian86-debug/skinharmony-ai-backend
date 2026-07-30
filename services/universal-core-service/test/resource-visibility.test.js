import assert from "node:assert/strict";
import test from "node:test";

import {
  createResourceVisibilityBinding,
  filterVisibleResources,
  learningRecordBranchIds,
  resourceVisibleToContext,
  validateResourceVisibilityBinding,
} from "../src/resourceVisibility.js";

const TENANT = "tenant-a";

function context(client_type, audience, entitlements = []) {
  return {
    tenant_id: TENANT,
    client_type,
    audience,
    entitlements,
    role: client_type === "chatgpt" ? "owner_root" : "service",
  };
}

test("horizontal resource is visible to ChatGPT owner_root without vertical widening", () => {
  const resource_visibility = createResourceVisibilityBinding({
    tenant_id: TENANT,
    branch_ids: ["ai_evaluation_intelligence"],
    origin_context: context("chatgpt", "chatgpt_connector"),
    domain_pack_id: "skinharmony",
    created_at: "2026-07-28T12:00:00.000Z",
  });
  const record = { tenant_id: TENANT, resource_visibility };

  assert.equal(resource_visibility.exposure_class, "chatgpt_horizontal");
  assert.equal(resource_visibility.domain_pack_id, "generic");
  assert.equal(resourceVisibleToContext(
    record,
    context("chatgpt", "chatgpt_connector"),
    { tenant_id: TENANT },
  ), true);
});

test("test-only and adjacent resources remain hidden from ChatGPT owner_root", () => {
  const testOnly = {
    tenant_id: TENANT,
    resource_visibility: createResourceVisibilityBinding({
      tenant_id: TENANT,
      branch_ids: ["model_adaptation_lab"],
      created_at: "2026-07-28T12:00:00.000Z",
    }),
  };
  const adjacent = {
    tenant_id: TENANT,
    resource_visibility: createResourceVisibilityBinding({
      tenant_id: TENANT,
      branch_ids: ["smartdesk_operations_guard"],
      origin_context: context(
        "smartdesk",
        "smartdesk_runtime",
        ["branch:smartdesk_operations_guard"],
      ),
      domain_pack_id: "skinharmony",
      created_at: "2026-07-28T12:00:00.000Z",
    }),
  };
  const chatgpt = context("chatgpt", "chatgpt_connector");

  assert.equal(resourceVisibleToContext(testOnly, chatgpt, { tenant_id: TENANT }), false);
  assert.equal(resourceVisibleToContext(adjacent, chatgpt, { tenant_id: TENANT }), false);
  assert.deepEqual(filterVisibleResources([testOnly, adjacent], chatgpt, {
    tenant_id: TENANT,
  }), []);
});

test("adjacent visibility requires the exact client, audience and entitlement", () => {
  const record = {
    tenant_id: TENANT,
    resource_visibility: createResourceVisibilityBinding({
      tenant_id: TENANT,
      branch_ids: ["skinharmony_analyzer"],
      origin_context: context(
        "analyzer",
        "analyzer_runtime",
        ["branch:skinharmony_analyzer"],
      ),
      domain_pack_id: "skinharmony",
      created_at: "2026-07-28T12:00:00.000Z",
    }),
  };
  assert.equal(resourceVisibleToContext(
    record,
    context("analyzer", "analyzer_runtime", ["branch:skinharmony_analyzer"]),
    { tenant_id: TENANT },
  ), true);
  assert.equal(resourceVisibleToContext(
    record,
    context("analyzer", "analyzer_runtime"),
    { tenant_id: TENANT },
  ), false);
  assert.equal(resourceVisibleToContext(
    record,
    context("suite", "suite_runtime", ["branch:skinharmony_analyzer"]),
    { tenant_id: TENANT },
  ), false);
});

test("tampered, cross-tenant and legacy resources fail closed except explicit admin legacy inspection", () => {
  const binding = createResourceVisibilityBinding({
    tenant_id: TENANT,
    branch_ids: ["learning_data_governance"],
    created_at: "2026-07-28T12:00:00.000Z",
  });
  const tampered = {
    tenant_id: TENANT,
    resource_visibility: {
      ...binding,
      allowed_client_types: [...binding.allowed_client_types, "smartdesk"],
    },
  };
  const chatgpt = context("chatgpt", "chatgpt_connector");
  const admin = context("admin", "admin_control_room");

  assert.equal(validateResourceVisibilityBinding(tampered.resource_visibility, {
    tenant_id: TENANT,
  }).ok, false);
  assert.equal(resourceVisibleToContext(tampered, chatgpt, { tenant_id: TENANT }), false);
  assert.equal(resourceVisibleToContext(
    { tenant_id: "tenant-b", resource_visibility: binding },
    chatgpt,
    { tenant_id: "tenant-b" },
  ), false);
  assert.equal(resourceVisibleToContext({ tenant_id: TENANT }, chatgpt, {
    tenant_id: TENANT,
  }), false);
  assert.equal(resourceVisibleToContext({ tenant_id: TENANT }, admin, {
    tenant_id: TENANT,
  }), true);
});

test("learning record mapping keeps model adaptation candidates test-only", () => {
  assert.deepEqual(
    learningRecordBranchIds("learning_candidates", { candidate_type: "prompt" }),
    ["model_adaptation_lab"],
  );
  assert.deepEqual(
    learningRecordBranchIds("learning_candidates", { candidate_type: "dataset" }),
    ["learning_data_governance"],
  );
  assert.deepEqual(
    learningRecordBranchIds("performance_scorecards", {}),
    ["ai_runtime_performance_intelligence"],
  );
});
