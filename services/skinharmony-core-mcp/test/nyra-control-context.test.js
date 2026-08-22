import assert from "node:assert/strict";
import test from "node:test";
import { buildNyraControlContext, NYRA_CONTROL_CONTEXT_SCHEMA_VERSION } from "../src/nyra-control-context.js";
import { attachWorkPreflight } from "../src/app.js";

test("Nyra control context is compact and carries only the next bounded action", () => {
  const context = buildNyraControlContext({
    operation: "workspace_write_document",
    continuity: {
      tenant_id: "codexai",
      project_id: "SkinHarmony/smart-desk",
      work_id: "11111111-1111-4111-8111-111111111111",
      intent_digest: "a".repeat(64),
      state: "active",
      next_action: "Implement the accepted bounded change.",
      // A large gallery must never be repeated to a connected AI.
      tenant_work_gallery: { works: Array.from({ length: 50 }, () => ({ raw: "not exported" })) },
    },
    autopilot: {
      assignments: [{ assignment_id: "22222222-2222-4222-8222-222222222222", role: "executor_specialist", status: "offered" }],
    },
  });
  assert.equal(context.schema_version, NYRA_CONTROL_CONTEXT_SCHEMA_VERSION);
  assert.equal(context.work_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(context.assignment.role, "executor_specialist");
  assert.equal(context.execution_authorized, false);
  assert.equal(JSON.stringify(context).includes("not exported"), false);
  assert.match(context.context_digest, /^[a-f0-9]{64}$/);
});

test("a reconnect context exposes one recovery action and preserves the Work", () => {
  const context = buildNyraControlContext({
    continuity: {
      tenant_id: "codexai",
      project_id: "SkinHarmony/smart-desk",
      work_id: "11111111-1111-4111-8111-111111111111",
      state: "blocked_recoverable",
      connector_state: { state: "reconnect_required", recovery_action: "Reconnect the existing OAuth session, then resume this Work." },
    },
  });
  assert.equal(context.connector.state, "reconnect_required");
  assert.equal(context.work_id, "11111111-1111-4111-8111-111111111111");
  assert.match(context.next_action, /Reconnect the existing OAuth session/);
});

test("the connector returns the compact context instead of a full Work Gallery", () => {
  const context = buildNyraControlContext({
    continuity: {
      tenant_id: "codexai",
      project_id: "SkinHarmony/smart-desk",
      work_id: "11111111-1111-4111-8111-111111111111",
      state: "active",
      next_action: "Continue the bounded Work.",
    },
  });
  const result = attachWorkPreflight({ structuredContent: { ok: true }, content: [] }, {
    work_preflight: {
      schema_version: "skinharmony_work_preflight_v1",
      preflight_id: "preflight-control-context",
      tenant_id: "codexai",
      mandatory: true,
      operational_surface: "tenant_work_gallery",
      tenant_work_gallery: {
        schema_version: "tenant_work_gallery_v1",
        tenant_id: "codexai",
        available: true,
        state: "available",
        work_count: 1,
        works: [{ raw: "must not reach the connected AI" }],
      },
      nyra_control_context: context,
    },
  });
  const preflight = result.structuredContent.work_preflight;
  assert.equal(preflight.nyra_control_context.context_digest, context.context_digest);
  assert.equal(preflight.tenant_work_gallery.work_count, 1);
  assert.equal(Object.hasOwn(preflight.tenant_work_gallery, "works"), false);
});
