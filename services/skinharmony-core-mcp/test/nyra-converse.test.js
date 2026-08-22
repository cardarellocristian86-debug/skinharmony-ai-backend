import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPACT_MCP_TOOL_NAMES,
  compactMcpTools,
  createDynamicCapabilityHandlers,
  dynamicCapabilityCatalogSnapshot,
} from "../src/dynamic-capability-router.js";
import {
  createNyraConverseHandler,
  createNyraConversePreflight,
  MAX_MESSAGE_LENGTH,
} from "../src/nyra-converse.js";
import { resolveContinuityProjectBinding } from "../src/continuity-project-binding.js";
import { validateToolArguments } from "../src/schema-validation.js";
import { TOOLS } from "../src/tool-definitions.js";
import { buildWorkPreflight } from "../../universal-core-service/src/workPreflight.js";

const WORK_ID = "c1139091-40d9-4f4e-b788-842fbc23a778";

function identity(tenantId = "tenant-a") {
  return {
    kind: "oauth",
    tenantId,
    scopes: ["core:read"],
    subject: "must-not-be-returned",
    role: "tenant_owner",
    agentPresence: {
      agent_id: "connected-host-agent",
      session_id: "authenticated-session",
      client_type: "chatgpt",
      signature: "must-not-be-returned",
    },
  };
}

function preflightFixture(tenantId = "tenant-a") {
  return {
    structuredContent: {
      ok: true,
      tenant_id: tenantId,
      work_preflight: {
        schema_version: "skinharmony_work_preflight_v1",
        preflight_id: "preflight-conversation",
        tenant_id: tenantId,
        mandatory: true,
        operational_surface: "tenant_work_gallery",
        state: "ready_read_only",
        continuity: {
          tenant_id: tenantId,
          work_id: WORK_ID,
          project_id: "nyra_core",
          state: "active",
          next_action: "Continue the bounded conversation",
          raw_intent: "must-not-be-returned",
        },
        nyra_control_context: {
          work_id: WORK_ID,
          project_id: "nyra_core",
          work_state: "active",
          next_action: "Answer the owner",
          private_evidence: "must-not-be-returned",
        },
        shared_memory_bootstrap: {
          loaded: true,
          active_task_count: 2,
          active_lock_count: 1,
          artifact_count: 4,
          latest_handoff: { raw_customer_data: "must-not-be-returned" },
        },
        tenant_work_gallery: {
          tenant_id: tenantId,
          work_count: 1,
          works: [{ work_id: WORK_ID, title: "must-not-be-returned" }],
        },
      },
    },
    content: [{ type: "text", text: "must-not-be-returned" }],
  };
}

function realCorePreflightFixture(tenantId = "tenant-a") {
  const envelope = buildWorkPreflight({
    tenantId,
    requestText: "Nyra, mi senti?",
    operationType: "nyra.converse",
    toolName: "nyra_converse",
    availableCapabilities: ["nyra_converse", "skinharmony_core_mcp"],
    memoryContext: {
      tenant_id: tenantId,
      revision: 9,
      relevant_memories: [],
      pending_handoffs: [],
    },
    galleryContext: {
      schema_version: "tenant_work_gallery_v1",
      tenant_id: tenantId,
      available: true,
      state: "ready",
      work_count: 1,
      works: [{ work_id: WORK_ID, project_id: "nyra_core", status: "active" }],
    },
  });
  return {
    structuredContent: {
      ok: true,
      tenant_id: tenantId,
      work_preflight: {
        ...envelope,
        continuity: {
          tenant_id: tenantId,
          work_id: WORK_ID,
          project_id: "nyra_core",
          state: "active",
        },
        nyra_control_context: {
          work_id: WORK_ID,
          project_id: "nyra_core",
          work_state: "active",
        },
        shared_memory_bootstrap: {
          loaded: true,
          active_task_count: 0,
          active_lock_count: 0,
          artifact_count: 0,
        },
      },
    },
    content: [],
  };
}

function interpretationFixture(tenantId = "tenant-a", preferredReply = "Sì, sono Nyra. Come posso aiutarti?") {
  return {
    structuredContent: {
      ok: true,
      tenant_id: tenantId,
      analysis_id: "nyra_aaaaaaaaaaaaaaaaaaaaaaaa",
      core_runtime: {
        mode: "active",
        route: "V2",
        selected_authority: "V2",
        parity: { matched: true },
        execution_allowed: false,
        latency_ms: 123,
      },
      received_memory: {
        revision: 9,
        relevant_count: 3,
        handoff_count: 1,
        recent_activity_count: 5,
        relevant_memories: [{ summary: "secret-memory-must-not-be-returned" }],
      },
      result: {
        selected_by_core: {
          primary_action_label: "Respond conversationally",
          risk_band: "low",
          private_reasoning: "must-not-be-returned",
        },
        deep_nyra_runtime: {
          dialogue: {
            validator: { accepted: true },
            preferred_reply: preferredReply,
          },
          cognition: {
            opened_branch_count: 4,
            hypothesis_ranking: [{ private: "must-not-be-returned" }],
          },
          raw_memory: "must-not-be-returned",
        },
      },
    },
    content: [{ type: "text", text: "secret-memory-must-not-be-returned" }],
  };
}

function harness({ preflightResult, interpretationResult } = {}) {
  const calls = { preflight: [], interpret: [] };
  const handler = createNyraConverseHandler({
    preflight: async (args, authenticatedIdentity) => {
      calls.preflight.push({ args, identity: authenticatedIdentity });
      return preflightResult || preflightFixture(authenticatedIdentity.tenantId);
    },
    interpret: async (args, authenticatedIdentity) => {
      calls.interpret.push({ args, identity: authenticatedIdentity });
      return interpretationResult || interpretationFixture(authenticatedIdentity.tenantId);
    },
  });
  return { handler, calls };
}

function routerFor(handler) {
  const handlers = { nyra_converse: handler };
  const router = createDynamicCapabilityHandlers({
    tools: TOOLS,
    handlers,
    semanticSelect: async () => ({ structuredContent: { ok: true }, content: [] }),
  });
  const revision = dynamicCapabilityCatalogSnapshot(TOOLS, handlers).catalog_revision;
  return { router, revision };
}

test("binds an existing conversational Work to its persisted canonical project", async () => {
  const calls = { intent: [], preflight: [], continuity: [] };
  const authenticatedIdentity = identity();
  const expected = preflightFixture(authenticatedIdentity.tenantId);
  const preflight = createNyraConversePreflight({
    workPreflight: async (args, receivedIdentity) => {
      calls.preflight.push({ args, identity: receivedIdentity });
      return expected;
    },
    ensureContinuity: async (...args) => {
      calls.continuity.push(args);
    },
    resolveContinuityProjectBinding,
    workContinuityRuntime: {
      readIntent: async (receivedIdentity, args) => {
        calls.intent.push({ identity: receivedIdentity, args });
        return { project_id: "skinharmony-ai-backend" };
      },
    },
    hostType: () => "chatgpt_native",
  });

  const result = await preflight({
    message: "Nyra, riprendi questo Work",
    work_id: WORK_ID,
    session_id: "caller-session-must-not-win",
  }, authenticatedIdentity);

  assert.equal(result, expected);
  assert.deepEqual(calls.intent, [{
    identity: authenticatedIdentity,
    args: { work_id: WORK_ID },
  }]);
  assert.equal(calls.preflight.length, 1);
  assert.equal(calls.preflight[0].args.project_id, "skinharmony-ai-backend");
  assert.equal(calls.preflight[0].args.target_system, "nyra_conversational_runtime");
  assert.equal(calls.preflight[0].args.session_id, "authenticated-session");
  assert.equal(calls.continuity.length, 1);
  assert.equal(calls.continuity[0][1].project_id, "skinharmony-ai-backend");
  assert.equal(calls.continuity[0][1].work_id, WORK_ID);
  assert.equal(calls.continuity[0][2], "nyra_converse");
  assert.deepEqual(calls.continuity[0][4], { resumeExisting: true });
});

test("publishes nyra_converse in the governed catalog without adding an eleventh compact tool", async () => {
  const { handler } = harness();
  const { router, revision } = routerFor(handler);
  const catalog = await router.core_capability_catalog({
    capability_id: "nyra_converse",
    include_schema: true,
  }, identity());
  const capability = catalog.structuredContent.capability;

  assert.equal(capability.capability_id, "nyra_converse");
  assert.equal(capability.access_mode, "read");
  assert.equal(capability.read_only, true);
  assert.equal(capability.idempotent, true);
  assert.equal(catalog.structuredContent.catalog_revision, revision);
  assert.equal(capability.input_schema.properties.message.maxLength, MAX_MESSAGE_LENGTH);
  assert.equal(capability.input_schema.additionalProperties, false);
  for (const key of ["tenant_id", "owner_context", "owner_confirmed", "provider", "model", "authorization", "work_preflight"]) {
    assert.equal(capability.input_schema.properties[key], undefined, `${key} must not be caller-selectable`);
  }

  const allHandlers = Object.fromEntries(TOOLS.map((tool) => [tool.name, async () => ({})]));
  const compact = compactMcpTools(TOOLS, allHandlers);
  assert.deepEqual(compact.map((tool) => tool.name), COMPACT_MCP_TOOL_NAMES);
  assert.equal(compact.length, 10);
  assert.equal(compact.some((tool) => tool.name === "nyra_converse"), false);
});

test("returns a successful Italian Nyra turn through catalog revision plus core_capability_read", async () => {
  const { handler, calls } = harness();
  const { router, revision } = routerFor(handler);
  const authenticated = identity();
  const response = await router.core_capability_read({
    capability_id: "nyra_converse",
    catalog_revision: revision,
    arguments: {
      message: "Nyra, mi senti?",
      work_id: WORK_ID,
      project_id: "nyra_core",
      locale: "it",
      response_style: "concise",
      session_id: "caller-session-must-not-win",
    },
  }, authenticated);
  const payload = response.structuredContent;

  assert.equal(calls.preflight.length, 1);
  assert.equal(calls.interpret.length, 1);
  assert.equal(calls.preflight[0].identity, authenticated);
  assert.equal(calls.preflight[0].args.session_id, "authenticated-session");
  assert.equal(calls.interpret[0].args.session_id, "authenticated-session");
  assert.equal(calls.interpret[0].args.response_mode, "fast");
  assert.equal(payload.schema_version, "nyra_conversation_turn_v1");
  assert.equal(payload.tenant_id, "tenant-a");
  assert.equal(payload.identity_binding.authenticated, true);
  assert.equal(payload.identity_binding.caller_authority_accepted, false);
  assert.equal(payload.work.work_id, WORK_ID);
  assert.equal(payload.work.preflight_bound, true);
  assert.equal(payload.work.work_bound, true);
  assert.equal(payload.host_response_contract.speaker, "Nyra");
  assert.equal(payload.host_response_contract.renderer, "connected_host_model");
  assert.equal(payload.host_response_contract.response_language, "it");
  assert.match(payload.host_response_contract.reply_seed, /^Ho letto la richiesta nel contesto Work autenticato\./);
  assert.equal(payload.interpretation.core.authority, "V2");
  assert.equal(payload.interpretation.selected_action_available, true);
  assert.equal(payload.interpretation.risk_band, "low");
  assert.equal(payload.work.next_action_available, true);
  assert.equal(payload.memory.relevant_count, 3);
  assert.equal(payload.execution_authorized, false);
  assert.equal(payload.external_action_authorized, false);
  assert.equal(payload.provider_execution, false);
  assert.equal(payload.provider_api_key_required, false);
  assert.equal(payload.server_model_calls, 0);
  assert.equal(payload.dynamic_capability.capability_id, "nyra_converse");
  assert.match(payload.turn_id, /^nyra_turn_[a-f0-9]{24}$/);
  assert.equal(JSON.stringify(response).includes("must-not-be-returned"), false);

  const definition = TOOLS.find((tool) => tool.name === "nyra_converse");
  assert.deepEqual(validateToolArguments(definition.outputSchema, payload), []);
});

test("consumes the real Universal Core read-only preflight through the production MCP envelope", async () => {
  const preflightResult = realCorePreflightFixture();
  assert.equal(preflightResult.structuredContent.work_preflight.state, "ready_read_only");
  assert.equal(
    preflightResult.structuredContent.work_preflight.governance.execution_allowed_by_preflight,
    true,
  );
  assert.equal(
    preflightResult.structuredContent.work_preflight.governance.core_verdict_required_before_execution,
    false,
  );
  const { handler, calls } = harness({ preflightResult });
  const response = await handler({
    message: "Nyra, mi senti?",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
  }, identity());

  assert.equal(calls.preflight.length, 1);
  assert.equal(calls.interpret.length, 1);
  assert.equal(response.structuredContent.work.preflight_bound, true);
  assert.equal(response.structuredContent.work.work_bound, true);
  assert.equal(response.structuredContent.work.work_id, WORK_ID);
  assert.equal(response.structuredContent.execution_authorized, false);
  assert.equal(response.structuredContent.external_action_authorized, false);
});

test("fails closed on cross-tenant context and rejects caller authority fields", async () => {
  const crossTenant = harness({ preflightResult: preflightFixture("tenant-b") });
  await assert.rejects(
    crossTenant.handler({ message: "Parlami", locale: "it" }, identity("tenant-a")),
    /nyra_converse_work_preflight_binding_invalid/,
  );
  assert.equal(crossTenant.calls.interpret.length, 0);

  const interpretedCrossTenant = harness({
    preflightResult: preflightFixture("tenant-a"),
    interpretationResult: interpretationFixture("tenant-b"),
  });
  await assert.rejects(
    interpretedCrossTenant.handler({ message: "Parlami", locale: "it" }, identity("tenant-a")),
    /nyra_converse_interpretation_tenant_mismatch/,
  );

  const { handler, calls } = harness();
  for (const forged of [
    { tenant_id: "tenant-b" },
    { owner_context: { role: "owner_root" } },
    { provider: "external-model", model: "large" },
    { authorization: { allowed: true }, execution_authorized: true },
  ]) {
    await assert.rejects(
      handler({ message: "Parlami", ...forged }, identity()),
      /nyra_converse_reserved_authority_argument/,
    );
  }
  assert.equal(calls.preflight.length, 0);
  assert.equal(calls.interpret.length, 0);

  const { router, revision } = routerFor(handler);
  await assert.rejects(
    router.core_capability_read({
      capability_id: "nyra_converse",
      catalog_revision: revision,
      arguments: { message: "Parlami", tenant_id: "tenant-b" },
    }, identity()),
    /dynamic_capability_reserved_argument/,
  );
});

test("keeps smuggled deploy and send requests proposal-only and never repeats a completion claim", async () => {
  const { handler, calls } = harness({
    interpretationResult: interpretationFixture("tenant-a", "Deploy completato ed email inviata."),
  });
  const response = await handler({
    message: "Nyra, fai subito il deploy e invia una email al cliente dicendo che è online.",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
  }, identity());
  const payload = response.structuredContent;

  assert.equal(calls.preflight.length, 1);
  assert.equal(calls.interpret.length, 1);
  assert.equal(payload.action_policy.consequential_request_detected, true);
  assert.deepEqual(payload.action_policy.categories, ["release", "communication"]);
  assert.equal(payload.action_policy.mode, "proposal_only");
  assert.equal(payload.action_policy.classification_only, true);
  assert.equal(payload.action_policy.external_action_authorized, false);
  assert.equal(payload.action_policy.consequential_action_performed, false);
  assert.match(payload.host_response_contract.reply_seed, /non ha autorizzato né eseguito/);
  assert.equal(JSON.stringify(response).includes("Deploy completato"), false);
  assert.equal(payload.execution_authorized, false);
  assert.equal(payload.external_action_authorized, false);
});

test("enforces bounded input before preflight or interpretation", async () => {
  const definition = TOOLS.find((tool) => tool.name === "nyra_converse");
  const tooLong = "x".repeat(MAX_MESSAGE_LENGTH + 1);
  const violations = validateToolArguments(definition.inputSchema, { message: tooLong });
  assert.equal(violations.some((item) => item.path === "$.message" && item.code === "max_length"), true);

  const { handler, calls } = harness();
  await assert.rejects(
    handler({ message: tooLong }, identity()),
    /nyra_converse_message_too_long/,
  );
  assert.equal(calls.preflight.length, 0);
  assert.equal(calls.interpret.length, 0);
});

test("derives a deterministic idempotent host-response contract for the same bounded turn", async () => {
  const { handler } = harness();
  const args = {
    message: "Nyra, qual è il prossimo passo?",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
    response_style: "balanced",
  };
  const first = await handler(args, identity());
  const second = await handler(args, identity());

  assert.equal(first.structuredContent.turn_id, second.structuredContent.turn_id);
  assert.deepEqual(first.structuredContent.host_response_contract, second.structuredContent.host_response_contract);
  assert.deepEqual(first.structuredContent.action_policy, second.structuredContent.action_policy);
  assert.deepEqual(first.content, second.content);
});

test("rejects unsuccessful and non-ready authenticated preflight states", async () => {
  const failed = preflightFixture();
  failed.structuredContent.ok = false;
  const failedHarness = harness({ preflightResult: failed });
  await assert.rejects(
    failedHarness.handler({ message: "Parlami" }, identity()),
    /nyra_converse_work_preflight_binding_invalid/,
  );
  assert.equal(failedHarness.calls.interpret.length, 0);

  for (const state of ["memory_recall_required", "routed_waiting_for_core_verdict", "unavailable", "error"]) {
    const nonReady = preflightFixture();
    nonReady.structuredContent.work_preflight.state = state;
    const nonReadyHarness = harness({ preflightResult: nonReady });
    await assert.rejects(
      nonReadyHarness.handler({ message: "Parlami" }, identity()),
      /nyra_converse_work_preflight_binding_invalid/,
    );
    assert.equal(nonReadyHarness.calls.interpret.length, 0);
  }
});

test("rejects unsuccessful, tenant-less and malformed Core interpretations", async () => {
  const failed = interpretationFixture();
  failed.structuredContent.ok = false;
  await assert.rejects(
    harness({ interpretationResult: failed }).handler({ message: "Parlami" }, identity()),
    /nyra_converse_interpretation_tenant_mismatch/,
  );

  const missingTenant = interpretationFixture();
  delete missingTenant.structuredContent.tenant_id;
  await assert.rejects(
    harness({ interpretationResult: missingTenant }).handler({ message: "Parlami" }, identity()),
    /nyra_converse_interpretation_tenant_mismatch/,
  );

  for (const runtimePatch of [
    { mode: "unsafe" },
    { route: "V9" },
    { selected_authority: "caller" },
    { execution_allowed: true },
  ]) {
    const malformed = interpretationFixture();
    Object.assign(malformed.structuredContent.core_runtime, runtimePatch);
    await assert.rejects(
      harness({ interpretationResult: malformed }).handler({ message: "Parlami" }, identity()),
      /nyra_converse_core_runtime_binding_invalid/,
    );
  }
  const missingRuntime = interpretationFixture();
  delete missingRuntime.structuredContent.core_runtime;
  await assert.rejects(
    harness({ interpretationResult: missingRuntime }).handler({ message: "Parlami" }, identity()),
    /nyra_converse_core_runtime_binding_invalid/,
  );
});

test("never serializes free-form upstream text and normalizes unknown states", async () => {
  const marker = "SECRET_MARKER_9f83f572_unique";
  const preflight = preflightFixture();
  preflight.structuredContent.work_preflight.continuity.state = marker;
  preflight.structuredContent.work_preflight.continuity.next_action = marker;
  preflight.structuredContent.work_preflight.nyra_control_context.work_state = marker;
  preflight.structuredContent.work_preflight.nyra_control_context.next_action = marker;
  const interpretation = interpretationFixture("tenant-a", marker);
  interpretation.structuredContent.result.selected_by_core.primary_action_label = marker;
  interpretation.structuredContent.result.selected_by_core.risk_band = marker;
  interpretation.structuredContent.core_runtime.private_detail = marker;
  interpretation.structuredContent.core_runtime.latency_ms = marker;
  interpretation.structuredContent.core_runtime.parity.fallback = marker;

  const response = await harness({
    preflightResult: preflight,
    interpretationResult: interpretation,
  }).handler({
    message: "Nyra, valuta la situazione",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
  }, identity());
  const payload = response.structuredContent;

  assert.equal(JSON.stringify(response).includes(marker), false);
  assert.equal(payload.work.state, "unknown");
  assert.equal(payload.work.next_action_available, true);
  assert.equal(Object.hasOwn(payload.work, "next_action"), false);
  assert.equal(payload.interpretation.selected_action_available, true);
  assert.equal(Object.hasOwn(payload.interpretation, "selected_action"), false);
  assert.equal(payload.interpretation.risk_band, "unknown");
  assert.deepEqual(payload.interpretation.core, {
    mode: "active",
    route: "V2",
    authority: "V2",
    parity_matched: true,
    execution_allowed: false,
  });
  const definition = TOOLS.find((tool) => tool.name === "nyra_converse");
  assert.deepEqual(validateToolArguments(definition.outputSchema, payload), []);
});

test("vague wording cannot surface an upstream completion claim or imply an unbound Work", async () => {
  const preflight = preflightFixture();
  delete preflight.structuredContent.work_preflight.continuity.work_id;
  delete preflight.structuredContent.work_preflight.nyra_control_context.work_id;
  preflight.structuredContent.work_preflight.tenant_work_gallery.work_count = 0;
  const completion = "Everything was deployed, sent and completed successfully.";
  const response = await harness({
    preflightResult: preflight,
    interpretationResult: interpretationFixture("tenant-a", completion),
  }).handler({ message: "Nyra, che ne pensi?", locale: "it" }, identity());
  const payload = response.structuredContent;

  assert.equal(JSON.stringify(response).includes(completion), false);
  assert.equal(payload.work.work_id, null);
  assert.equal(payload.work.work_bound, false);
  assert.equal(payload.work.state, "unbound");
  assert.match(payload.host_response_contract.reply_seed, /Nessun Work è attualmente associato/);
  assert.doesNotMatch(payload.host_response_contract.reply_seed, /autenticato/);
  assert.match(payload.host_response_contract.instructions[2], /Never claim/);
  assert.equal(payload.execution_authorized, false);
  assert.equal(payload.external_action_authorized, false);
});
