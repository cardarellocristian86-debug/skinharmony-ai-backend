import assert from "node:assert/strict";
import test from "node:test";

import { TOOLS } from "../src/tool-definitions.js";
import { WORK_CONTINUITY_TOOLS } from "../src/work-continuity-tools.js";
import { NYRA_WORK_AUTOMATION_TOOLS } from "../src/nyra-work-automation-tools.js";
import { NYRA_AUTOPILOT_TOOLS } from "../src/nyra-autopilot-tools.js";
import { ENTITY_360_TOOLS } from "../src/entity-360.js";
import {
  COMPACT_MCP_TOOL_NAMES,
  INTERNAL_ONLY_TOOL_NAMES,
  compactMcpTools,
  createDynamicCapabilityHandlers,
  dynamicCapabilityCatalogSnapshot,
} from "../src/dynamic-capability-router.js";

const identity = {
  tenantId: "tenant-a",
  scopes: ["core:read", "core:govern"],
  ownerConfirmed: true,
};

test("catalog includes system-owned CI without exposing verifier assignment fields", () => {
  const tool = NYRA_WORK_AUTOMATION_TOOLS.find((item) => item.name === "nyra_work_automation_ci_verify");
  const handlers = { [tool.name]: async () => ({}) };
  const snapshot = dynamicCapabilityCatalogSnapshot([tool], handlers);
  assert.deepEqual(snapshot.capabilities.map((item) => item.capability_id), [tool.name]);
  assert.equal(Object.hasOwn(tool.inputSchema.properties, "verifier_agent_id"), false);
  assert.equal(Object.hasOwn(tool.inputSchema.properties, "system_assigned"), false);
});

test("late-stage Nyra closure traverses the real dynamic connector gate and exact schema", async () => {
  const tool = NYRA_WORK_AUTOMATION_TOOLS.find((item) => item.name === "nyra_work_automation_closure_finalize");
  let received;
  const handlers = { [tool.name]: async (args) => { received = args; return { structuredContent: { ok: true, state: "COMPLETED", dedicated_core_gate: { authorized: true, authority: "universal_core" } } }; } };
  const router = createDynamicCapabilityHandlers({ tools: [tool], handlers, semanticSelect: async () => ({}), gateAction: async () => ({ structuredContent: { authorization: { allowed: true } } }) });
  const catalog_revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const caller = { ...identity, agentPresence: { agent_id: "builder", session_id: "session", client_type: "codex" } };
  const argumentsValue = { work_id: "work", closure_receipt: { ticket_id: "ticket", host_session_fingerprint: "host-session" } };
  const response = await router.core_capability_invoke({ capability_id: tool.name, catalog_revision, idempotency_key: "closure-once", arguments: argumentsValue }, caller);
  assert.equal(response.structuredContent.state, "COMPLETED");
  assert.equal(received.agent_id, "builder");
  await assert.rejects(router.core_capability_invoke({ capability_id: tool.name, catalog_revision, idempotency_key: "closure-forged", arguments: { ...argumentsValue, closure_receipt: { ...argumentsValue.closure_receipt, closed: true } } }, caller), /dynamic_capability_arguments_invalid/);
});

test("Nyra admits tenant binding only at signed evidence roots verified again by Core", async () => {
  const tool = NYRA_WORK_AUTOMATION_TOOLS.find((item) => item.name === "nyra_work_automation_push_record");
  const handlers = { [tool.name]: async () => ({ structuredContent: { ok: true, dedicated_core_gate: { authorized: true, authority: "universal_core" } } }) };
  const router = createDynamicCapabilityHandlers({ tools: [tool], handlers, semanticSelect: async () => ({}), gateAction: async () => ({ structuredContent: { authorization: { allowed: true } } }) });
  const catalog_revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const caller = { ...identity, agentPresence: { agent_id: "builder", session_id: "session", client_type: "codex" } };
  const base = { work_id: "work", session_fingerprint: "session", action_receipt: { tenant_id: "tenant-a" } };
  await router.core_capability_invoke({ capability_id: tool.name, catalog_revision, idempotency_key: "signed-root", arguments: base }, caller);
  await assert.rejects(router.core_capability_invoke({ capability_id: tool.name, catalog_revision, idempotency_key: "nested-forged", arguments: { ...base, action_receipt: { signed: { tenant_id: "tenant-a" } } } }, caller), /dynamic_capability_reserved_argument/);
});

test("DTT outcome admits only authenticated tenant bindings required by evidence v2", async () => {
  const tool = TOOLS.find((item) => item.name === "orchestration_dtt_outcome_record");
  let received;
  const handlers = {
    [tool.name]: async (args) => {
      received = args;
      return { structuredContent: { ok: true } };
    },
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
    gateAction: async () => ({ structuredContent: { authorization: { allowed: true } } }),
  });
  const catalog_revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const workId = "00000000-0000-4000-8000-000000000001";
  const evidenceDraft = {
    schema_version: "verification_evidence_draft_v2",
    tenant_id: "tenant-a",
    work_id: workId,
    tree_id: "dtt_test",
    node_id: "verify",
    claim: "Focused verification passed",
    artifacts: [{
      artifact_id: "artifact-a",
      content_digest: `sha256:${"a".repeat(64)}`,
      source_reference: "focused-test",
    }],
    provenance: {
      tenant_id: "tenant-a",
      work_id: workId,
      tree_id: "dtt_test",
      node_id: "verify",
      producer_id: "builder-a",
      source_type: "test",
      source_reference: "focused-test",
    },
    evidence_digest: `evd_${"b".repeat(64)}`,
    quorum: { required_approvals: 1, dissent_policy: "block" },
    execution_authorized: false,
  };
  const invoke = (idempotency_key, draft = evidenceDraft) => router.core_capability_invoke({
    capability_id: tool.name,
    catalog_revision,
    idempotency_key,
    owner_confirmed: true,
    arguments: {
      work_id: workId,
      tree_id: "dtt_test",
      node_id: "verify",
      outcome: "verified",
      evidence_draft: draft,
    },
  }, identity);

  await invoke("dtt-evidence-valid");
  assert.deepEqual(received.evidence_draft, evidenceDraft);

  const evidence = {
    ...evidenceDraft,
    schema_version: "verification_evidence_contract_v2",
    attestations: [{
      verifier_id: "verifier-a",
      decision: "approve",
      rationale: "Evidence verified",
      identity_receipt: "signed-receipt",
      assignment_id: `dtta_${"c".repeat(32)}`,
      attestation_id: `att_${"d".repeat(64)}`,
      scheme: "sha256_work_bound_vote_integrity_v2",
    }],
    quorum: {
      required_approvals: 1,
      dissent_policy: "block",
      approvals: 1,
      dissents: 0,
      satisfied: true,
    },
  };
  await router.core_capability_invoke({
    capability_id: tool.name,
    catalog_revision,
    idempotency_key: "dtt-evidence-contract-valid",
    owner_confirmed: true,
    arguments: {
      work_id: workId,
      tree_id: "dtt_test",
      node_id: "verify",
      outcome: "verified",
      evidence,
    },
  }, identity);
  assert.deepEqual(received.evidence, evidence);

  await assert.rejects(
    invoke("dtt-evidence-wrong-root", { ...evidenceDraft, tenant_id: "tenant-b" }),
    /dynamic_capability_reserved_argument/,
  );
  await assert.rejects(
    invoke("dtt-evidence-wrong-provenance", {
      ...evidenceDraft,
      provenance: { ...evidenceDraft.provenance, tenant_id: "tenant-b" },
    }),
    /dynamic_capability_reserved_argument/,
  );
  await assert.rejects(
    invoke("dtt-evidence-forged-nested", {
      ...evidenceDraft,
      artifacts: [{ ...evidenceDraft.artifacts[0], metadata: { tenant_id: "tenant-a" } }],
    }),
    /dynamic_capability_reserved_argument/,
  );
});

function readTool(name = "nyra_dynamic_read") {
  return {
    name,
    title: "Dynamic read",
    description: "Reads a tenant-bound capability.",
    scopes: ["core:read"],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string", minLength: 1 } },
      required: ["query"],
    },
  };
}

function writeTool(name = "workspace_dynamic_write") {
  return {
    name,
    title: "Dynamic write",
    description: "Writes through the governed capability router.",
    scopes: ["core:govern"],
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: { "skinharmony/ownerConfirmationRequired": true },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        value: { type: "string", minLength: 1 },
        owner_confirmed: { type: "boolean" },
        confirmation_reference: { type: "string" },
      },
      required: ["value", "owner_confirmed"],
    },
  };
}

function delegatedWriteTool(name = "orchestration_dtt_agent_report") {
  const definition = writeTool(name);
  definition._meta = { "skinharmony/ownerConfirmationRequired": false };
  delete definition.inputSchema.properties.owner_confirmed;
  delete definition.inputSchema.properties.confirmation_reference;
  definition.inputSchema.required = ["value"];
  return definition;
}

function dedicatedCoreWriteTool(name = "host_native_action_reserve") {
  const definition = delegatedWriteTool(name);
  definition._meta["skinharmony/dedicatedCoreGate"] = true;
  return definition;
}

test("publishes a fixed compact MCP surface below the connector import budget", () => {
  const verifiedFinalize = WORK_CONTINUITY_TOOLS.find((tool) =>
    tool.name === "nyra_verified_work_finalize");
  const availableTools = [...TOOLS, ...NYRA_AUTOPILOT_TOOLS, ...ENTITY_360_TOOLS, verifiedFinalize];
  const handlers = Object.fromEntries(availableTools.map((tool) => [tool.name, async () => ({})]));
  const compact = compactMcpTools(availableTools, handlers);

  assert.deepEqual(compact.map((tool) => tool.name), COMPACT_MCP_TOOL_NAMES);
  assert.equal(compact.length, 16);
  assert(compact.some((tool) => tool.name === "nyra_control_room_status"));
  assert(compact.some((tool) => tool.name === "nyra_autopilot_enable"));
  assert(compact.some((tool) => tool.name === "entity_360_shadow_enable"));
  assert(compact.some((tool) => tool.name === "entity_360_shadow_disable"));
  assert(compact.some((tool) => tool.name === "nyra_continue"));
  assert(compact.some((tool) => tool.name === "nyra_work_assignment_claim"));
  assert(compact.some((tool) => tool.name === "nyra_work_assignment_submit"));
  assert.equal(compact.some((tool) => tool.name === "nyra_verified_work_finalize"), false);
  assert.deepEqual([...INTERNAL_ONLY_TOOL_NAMES], ["work_preflight"]);
  assert.equal(compact.some((tool) => INTERNAL_ONLY_TOOL_NAMES.has(tool.name)), false);
  assert.equal(compact.some((tool) => tool.name.startsWith("tenant_provider_openai_")), false);
  assert(Buffer.byteLength(JSON.stringify({ tools: compact })) < 64 * 1024);
});

test("keeps large policy activation outside dynamic wrappers while reserving compact space for governed controls", async () => {
  const activation = TOOLS.find((tool) => tool.name === "nyra_policy_registry_activate");
  const handlers = {
    [activation.name]: async () => ({}),
  };
  const snapshot = dynamicCapabilityCatalogSnapshot([activation], handlers);
  const router = createDynamicCapabilityHandlers({
    tools: [activation],
    handlers,
    semanticSelect: async () => ({}),
  });

  assert.equal(COMPACT_MCP_TOOL_NAMES.includes(activation.name), false);
  assert.deepEqual(snapshot.capabilities, []);
  await assert.rejects(
    router.core_capability_catalog({ capability_id: activation.name }, identity),
    /dynamic_capability_unavailable/,
  );
  await assert.rejects(
    router.core_capability_read({
      capability_id: activation.name,
      catalog_revision: snapshot.catalog_revision,
      arguments: {},
    }, identity),
    /dynamic_capability_unavailable/,
  );
  await assert.rejects(
    router.core_capability_invoke({
      capability_id: activation.name,
      catalog_revision: snapshot.catalog_revision,
      idempotency_key: "policy-activation-dynamic-bypass",
      arguments: {},
    }, identity),
    /dynamic_capability_unavailable/,
  );
});

test("keeps the generic preflight internal instead of exposing it through dynamic discovery", () => {
  const preflight = TOOLS.find((tool) => tool.name === "work_preflight");
  const snapshot = dynamicCapabilityCatalogSnapshot([preflight], {
    work_preflight: async () => ({}),
  });
  assert.deepEqual(snapshot.capabilities, []);
});

test("keeps governed continuation direct-only and outside dynamic discovery", () => {
  const continuation = TOOLS.find((tool) => tool.name === "nyra_continue");
  const snapshot = dynamicCapabilityCatalogSnapshot([continuation], {
    nyra_continue: async () => ({}),
  });
  assert.deepEqual(snapshot.capabilities, []);
});

test("discovers, reads and owner-refreshes Nyra's persistent self-model through a narrow dynamic path", async () => {
  const readTool = TOOLS.find((item) => item.name === "nyra_self_model");
  const refreshTool = TOOLS.find((item) => item.name === "nyra_self_model_refresh");
  let readCalls = 0;
  let refreshCalls = 0;
  const handlers = {
    nyra_self_model: async () => {
      readCalls += 1;
      return { structuredContent: { ok: true, self_model: { persistent: true } } };
    },
    nyra_self_model_refresh: async () => {
      refreshCalls += 1;
      return {
        structuredContent: {
          ok: true,
          self_model: { schema_version: "nyra_persistent_self_model_v1", persistent: true },
          execution_allowed: false,
          dedicated_core_gate: { authorized: true, authority: "universal_core" },
        },
      };
    },
  };
  const router = createDynamicCapabilityHandlers({
    tools: [readTool, refreshTool],
    handlers,
    semanticSelect: async () => ({}),
  });
  const catalog = await router.core_capability_catalog({
    group: "self_model",
    include_schema: true,
  }, identity);
  assert.equal(catalog.structuredContent.total, 2);
  const readCapability = catalog.structuredContent.capabilities.find((item) =>
    item.capability_id === "nyra_self_model");
  const refreshCapability = catalog.structuredContent.capabilities.find((item) =>
    item.capability_id === "nyra_self_model_refresh");
  assert.equal(readCapability.group, "self_model");
  assert.equal(readCapability.access_mode, "read");
  assert.equal(refreshCapability.group, "self_model");
  assert.equal(refreshCapability.access_mode, "invoke");
  assert.equal(refreshCapability.owner_confirmation_required, true);
  assert.equal(refreshCapability.dedicated_core_gate, true);

  const result = await router.core_capability_read({
    capability_id: "nyra_self_model",
    catalog_revision: catalog.structuredContent.catalog_revision,
    arguments: {},
  }, identity);
  assert.equal(readCalls, 1);
  assert.equal(result.structuredContent.self_model.persistent, true);
  assert.equal(result.structuredContent.dynamic_capability.capability_id, "nyra_self_model");

  await assert.rejects(router.core_capability_invoke({
    capability_id: "nyra_self_model_refresh",
    catalog_revision: catalog.structuredContent.catalog_revision,
    idempotency_key: "self-model-refresh-denied",
    owner_confirmed: true,
    confirmation_reference: "owner approved self model refresh",
    arguments: {},
  }, { ...identity, ownerConfirmed: false }), /owner_confirmation_required/);
  assert.equal(refreshCalls, 0);

  const refreshed = await router.core_capability_invoke({
    capability_id: "nyra_self_model_refresh",
    catalog_revision: catalog.structuredContent.catalog_revision,
    idempotency_key: "self-model-refresh-allowed",
    owner_confirmed: true,
    confirmation_reference: "owner approved self model refresh",
    arguments: {},
  }, identity);
  assert.equal(refreshCalls, 1);
  assert.equal(refreshed.structuredContent.execution_allowed, false);
  assert.equal(refreshed.structuredContent.dynamic_capability.capability_id, "nyra_self_model_refresh");
  assert.equal(refreshed.structuredContent.dynamic_capability.gate_source, "universal_core_dedicated_route");
});

test("catalogs every tenant Work capability on the continuity surface", () => {
  const tenantWorkTools = WORK_CONTINUITY_TOOLS.filter((tool) =>
    tool.name.startsWith("tenant_work_"));
  const handlers = Object.fromEntries(tenantWorkTools.map((tool) =>
    [tool.name, async () => ({})]));
  const snapshot = dynamicCapabilityCatalogSnapshot(tenantWorkTools, handlers);

  assert(tenantWorkTools.length > 0);
  assert.equal(snapshot.capabilities.length, tenantWorkTools.length);
  assert.equal(snapshot.capabilities.every((item) => item.group === "continuity"), true);
});

test("a server-admitted native child sees only its terminal report capability", async () => {
  const report = WORK_CONTINUITY_TOOLS.find((tool) =>
    tool.name === "work_continuity_native_report");
  const unrelated = delegatedWriteTool("tenant_work_task_record");
  const handlers = {
    [report.name]: async () => ({ structuredContent: { ok: true } }),
    [unrelated.name]: async () => ({ structuredContent: { ok: true } }),
  };
  const router = createDynamicCapabilityHandlers({
    tools: [report, unrelated],
    handlers,
    semanticSelect: async () => ({}),
    gateAction: async () => ({ structuredContent: { authorization: { allowed: true } } }),
    capabilityVisible: ({ tool, identity: caller }) => caller.nativeReportAdmission
      ? tool.name === "work_continuity_native_report"
      : false,
  });
  const caller = {
    ...identity,
    nativeReportAdmission: { capability_id: "work_continuity_native_report" },
  };
  const catalog = await router.core_capability_catalog({
    capability_id: "work_continuity_native_report",
    include_schema: true,
  }, caller);
  assert.equal(catalog.structuredContent.capability.capability_id,
    "work_continuity_native_report");
  const revision = catalog.structuredContent.catalog_revision;
  await assert.rejects(router.core_capability_invoke({
    capability_id: unrelated.name,
    catalog_revision: revision,
    idempotency_key: "native-child-escalation-attempt",
    arguments: { value: "forbidden" },
  }, caller), /dynamic_capability_unavailable/);
});

test("a server-admitted verifier can read only its acceptance-contract capability", async () => {
  const acceptanceRead = WORK_CONTINUITY_TOOLS.find((tool) =>
    tool.name === "work_continuity_native_acceptance_contract_read");
  const report = WORK_CONTINUITY_TOOLS.find((tool) =>
    tool.name === "work_continuity_native_report");
  let received;
  const router = createDynamicCapabilityHandlers({
    tools: [acceptanceRead, report],
    handlers: {
      [acceptanceRead.name]: async (args) => {
        received = args;
        return { structuredContent: { execution_authorized: false } };
      },
      [report.name]: async () => ({ structuredContent: { ok: true } }),
    },
    semanticSelect: async () => ({}),
    gateAction: async () => ({ structuredContent: { authorization: { allowed: true } } }),
    capabilityVisible: ({ tool, identity: caller }) =>
      caller.nativeAcceptanceContractReadAdmission?.capability_id === acceptanceRead.name &&
      tool.name === acceptanceRead.name,
  });
  const caller = {
    ...identity,
    nativeAcceptanceContractReadAdmission: { capability_id: acceptanceRead.name },
  };
  const catalog = await router.core_capability_catalog({}, caller);
  assert.deepEqual(catalog.structuredContent.capabilities.map((item) => item.capability_id), [
    acceptanceRead.name,
  ]);
  const catalogRevision = catalog.structuredContent.catalog_revision;
  await router.core_capability_read({
    capability_id: acceptanceRead.name,
    catalog_revision: catalogRevision,
    arguments: {
      work_id: "11111111-1111-4111-8111-111111111111",
      plan_id: "22222222-2222-4222-8222-222222222222",
      native_agent_id: "native-child-verifier",
      host_task_id: "/root/native-child-verifier",
      assignment_capability: `hnac_${"A".repeat(43)}`,
    },
  }, caller);
  assert.equal(received.native_agent_id, "native-child-verifier");
  await assert.rejects(router.core_capability_invoke({
    capability_id: acceptanceRead.name,
    catalog_revision: catalogRevision,
    idempotency_key: "attempt-read-as-mutation",
    arguments: received,
  }, caller), /dynamic_capability_mutation_required/);
  await assert.rejects(router.core_capability_read({
    capability_id: report.name,
    catalog_revision: catalogRevision,
    arguments: received,
  }, caller), /dynamic_capability_unavailable/);
});

test("accepts only the exact pre-admission catalog revision for an admitted native report", async () => {
  const report = delegatedWriteTool("work_continuity_native_report");
  const unrelated = delegatedWriteTool("tenant_work_task_record");
  let reports = 0;
  const handlers = {
    [report.name]: async () => {
      reports += 1;
      return { structuredContent: { ok: true } };
    },
    [unrelated.name]: async () => ({ structuredContent: { ok: true } }),
  };
  const router = createDynamicCapabilityHandlers({
    tools: [report, unrelated],
    handlers,
    semanticSelect: async () => ({}),
    gateAction: async () => ({ structuredContent: { authorization: { allowed: true } } }),
    capabilityVisible: ({ tool, identity: caller }) =>
      caller.nativeReportAdmission?.capability_id === report.name
      ? tool.name === report.name
      : true,
  });
  const ambientCaller = { ...identity };
  const ambientCatalog = await router.core_capability_catalog({}, ambientCaller);
  const ambientRevision = ambientCatalog.structuredContent.catalog_revision;
  const admittedCaller = {
    ...identity,
    nativeReportAdmission: { capability_id: "work_continuity_native_report" },
  };
  const admittedCatalog = await router.core_capability_catalog({}, admittedCaller);
  const admittedRevision = admittedCatalog.structuredContent.catalog_revision;
  assert.notEqual(ambientRevision, admittedRevision);

  const invoke = (caller, capability_id, catalog_revision, idempotency_key) =>
    router.core_capability_invoke({
      capability_id,
      catalog_revision,
      idempotency_key,
      arguments: { value: "bounded evidence" },
    }, caller);

  const accepted = await invoke(
    admittedCaller,
    report.name,
    ambientRevision,
    "native-report-ambient-revision",
  );
  assert.equal(reports, 1);
  assert.equal(accepted.structuredContent.dynamic_capability.capability_id, report.name);
  assert.equal(accepted.structuredContent.dynamic_capability.catalog_revision, admittedRevision);

  await assert.rejects(
    invoke(admittedCaller, unrelated.name, ambientRevision, "native-report-wrong-target"),
    /dynamic_capability_catalog_revision_mismatch/,
  );
  await assert.rejects(
    invoke(
      { ...identity },
      report.name,
      admittedRevision,
      "native-report-no-admission",
    ),
    /dynamic_capability_catalog_revision_mismatch/,
  );
  await assert.rejects(
    invoke(
      {
        ...identity,
        nativeReportAdmission: { capability_id: "tenant_work_task_record" },
      },
      report.name,
      admittedRevision,
      "native-report-invalid-admission",
    ),
    /dynamic_capability_catalog_revision_mismatch/,
  );
  const alteredRevision = `${ambientRevision.slice(0, -1)}${
    ambientRevision.endsWith("0") ? "1" : "0"
  }`;
  await assert.rejects(
    invoke(admittedCaller, report.name, alteredRevision, "native-report-altered-revision"),
    /dynamic_capability_catalog_revision_mismatch/,
  );
  assert.equal(reports, 1);
});

test("pre-Work review uses one server-owned Core gate and stable idempotency", async () => {
  const tool = WORK_CONTINUITY_TOOLS.find((item) =>
    item.name === "tenant_work_open_review");
  let genericGateCalls = 0;
  let includeMarker = true;
  let received;
  const handlers = {
    [tool.name]: async (args) => {
      received = args;
      return {
        structuredContent: {
          ok: true,
          ...(includeMarker ? {
            dedicated_core_gate: {
              authorized: true,
              authority: "universal_core",
              server_owned: true,
            },
          } : {}),
        },
      };
    },
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
    gateAction: async () => {
      genericGateCalls += 1;
      return { structuredContent: { authorization: { allowed: true } } };
    },
  });
  const catalog_revision = dynamicCapabilityCatalogSnapshot(
    [tool], handlers,
  ).catalog_revision;
  const invoke = (idempotency_key) => router.core_capability_invoke({
    capability_id: tool.name,
    catalog_revision,
    idempotency_key,
    arguments: {
      request: "Create a bounded Work",
      intent_type: "CREATE_WORK",
      create_request: { project_id: "nyra-core" },
    },
  }, {
    ...identity,
    agentPresence: {
      agent_id: "bootstrap-agent",
      session_id: "bootstrap-session",
      client_type: "codex",
    },
  });

  const result = await invoke("review-bootstrap-once");
  assert.equal(genericGateCalls, 0);
  assert.equal(received.idempotency_key, "review-bootstrap-once");
  assert.equal(
    result.structuredContent.dynamic_capability.gate_source,
    "universal_core_dedicated_route",
  );

  includeMarker = false;
  await assert.rejects(
    invoke("review-bootstrap-without-marker"),
    /dynamic_capability_dedicated_core_gate_unverified/,
  );
  assert.equal(genericGateCalls, 0);
});

test("canonical Work creation accepts only its verified durable readback on replay", async () => {
  const tool = WORK_CONTINUITY_TOOLS.find((item) =>
    item.name === "work_continuity_v2_create");
  const receipt = {
    schema_version: "work_bootstrap_core_authorization_receipt_v2",
    authority: "universal_core",
    route: "/v1/action-evaluator",
    target: `work_bootstrap:create:codex:codex_native:${"a".repeat(64)}`,
    receipt_digest: "b".repeat(64),
  };
  let tamper = null;
  const handlers = {
    [tool.name]: async () => ({
      structuredContent: {
        ok: true,
        result: {
          idempotent_replay: true,
          replay_source: "durable_bootstrap_mapping",
          execution_authorized: false,
          persisted_core_authorization_receipt: {
            ...receipt,
            ...(tamper || {}),
          },
        },
        dedicated_core_gate: {
          authorized: false,
          authority: "universal_core",
          route: "durable_work_bootstrap_readback",
          server_owned: true,
          readback_only: true,
        },
      },
    }),
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
    gateAction: async () => {
      throw new Error("generic_gate_must_not_run");
    },
  });
  const catalog_revision = dynamicCapabilityCatalogSnapshot(
    [tool], handlers,
  ).catalog_revision;
  const argumentsValue = {
    intent_type: "CREATE_WORK",
    request_id: "durable-replay",
    review_id: "11111111-1111-4111-8111-111111111111",
    review_digest: "c".repeat(64),
    project_id: "nyra-core",
    session_id: "durable-replay-session",
    work_name: "Durable replay",
    work_type: "software_git",
    idea: "Recover a previously created Work.",
    objective: "Return verified persisted evidence without creating again.",
    architecture: {},
    next_action: "Read the existing Work.",
    acceptance_criteria: ["The same Work is returned."],
    tasks: [{ title: "Verify durable readback" }],
  };
  const invoke = () => router.core_capability_invoke({
    capability_id: tool.name,
    catalog_revision,
    idempotency_key: "durable-work-bootstrap-replay",
    owner_confirmed: true,
    confirmation_reference: "owner-confirmed-replay",
    arguments: argumentsValue,
  }, {
    ...identity,
    ownerConfirmed: true,
  });

  const result = await invoke();
  assert.equal(result.structuredContent.dynamic_capability.gate_allowed, false);
  assert.equal(result.structuredContent.dynamic_capability.readback_only, true);
  assert.equal(
    result.structuredContent.dynamic_capability.gate_source,
    "durable_core_authorization_readback",
  );

  tamper = { receipt_digest: "not-a-digest" };
  await assert.rejects(
    invoke(),
    /dynamic_capability_dedicated_core_gate_unverified/,
  );
});

test("filters unauthorized application capabilities from catalog, read and invoke routes", async () => {
  const allowed = readTool("work_continuity_v2_read");
  const denied = writeTool("host_native_action_authorize");
  const handlers = {
    [allowed.name]: async () => ({ structuredContent: { ok: true } }),
    [denied.name]: async () => ({ structuredContent: { ok: true } }),
  };
  const router = createDynamicCapabilityHandlers({
    tools: [allowed, denied],
    handlers,
    semanticSelect: async () => ({}),
    gateAction: async () => ({ structuredContent: { authorization: { allowed: true } } }),
    capabilityVisible: ({ tool }) => tool.name === allowed.name,
  });
  const catalog = await router.core_capability_catalog({}, identity);

  assert.deepEqual(
    catalog.structuredContent.capabilities.map((item) => item.capability_id),
    [allowed.name],
  );
  await assert.rejects(router.core_capability_catalog({
    capability_id: denied.name,
  }, identity), /dynamic_capability_unavailable/);
  await assert.rejects(router.core_capability_invoke({
    capability_id: denied.name,
    catalog_revision: catalog.structuredContent.catalog_revision,
    idempotency_key: "denied-invoke",
    owner_confirmed: true,
    arguments: { value: "blocked" },
  }, identity), /dynamic_capability_unavailable/);
});

test("adds capabilities through the catalog without changing the connector surface", () => {
  const firstTools = [readTool()];
  const firstHandlers = { nyra_dynamic_read: async () => ({}) };
  const first = dynamicCapabilityCatalogSnapshot(firstTools, firstHandlers);
  const surfaceBefore = [...COMPACT_MCP_TOOL_NAMES];

  const secondTools = [...firstTools, readTool("nyra_future_read")];
  const secondHandlers = { ...firstHandlers, nyra_future_read: async () => ({}) };
  const second = dynamicCapabilityCatalogSnapshot(secondTools, secondHandlers);

  assert.notEqual(first.catalog_revision, second.catalog_revision);
  assert.deepEqual(COMPACT_MCP_TOOL_NAMES, surfaceBefore);
  assert.deepEqual(second.capabilities.map((item) => item.capability_id), [
    "nyra_dynamic_read",
    "nyra_future_read",
  ]);
});

test("binds dynamic Gallery coordination to the authenticated transport presence", async () => {
  const tool = WORK_CONTINUITY_TOOLS.find((item) => item.name === "tenant_work_gallery_join");
  let received;
  const handlers = {
    tenant_work_gallery_join: async (args) => {
      received = args;
      return { structuredContent: { ok: true } };
    },
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
    gateAction: async () => ({ structuredContent: { authorization: { allowed: true } } }),
  });
  const catalogRevision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const transportIdentity = {
    ...identity,
    ownerConfirmed: false,
    agentPresence: {
      agent_id: "transport-agent",
      session_id: "transport-session",
      client_type: "codex",
    },
  };

  await router.core_capability_invoke({
    capability_id: "tenant_work_gallery_join",
    catalog_revision: catalogRevision,
    idempotency_key: "gallery-transport-binding",
    arguments: {
      work_id: "dc6dc703-b1a6-4764-9d88-f2238d54df3a",
      agent_id: "caller-controlled-agent",
      session_id: "caller-controlled-session",
      client_type: "other",
      idempotency_key: "gallery-transport-binding",
    },
  }, transportIdentity);

  assert.equal(received.agent_id, "transport-agent");
  assert.equal(received.session_id, "transport-session");
  assert.equal(received.client_type, "codex");
});

test("reads only exact server-registered capabilities with scopes and a fresh revision", async () => {
  const tool = readTool();
  let received;
  const handlers = {
    [tool.name]: async (args, caller) => {
      received = { args, caller };
      return { structuredContent: { ok: true } };
    },
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
  });
  const revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const result = await router.core_capability_read({
    capability_id: tool.name,
    catalog_revision: revision,
    arguments: { query: "status" },
  }, identity);

  assert.deepEqual(received, { args: { query: "status" }, caller: identity });
  assert.equal(result.structuredContent.dynamic_capability.capability_id, tool.name);
  await assert.rejects(
    router.core_capability_read({
      capability_id: tool.name,
      catalog_revision: "0".repeat(64),
      arguments: { query: "status" },
    }, identity),
    /dynamic_capability_catalog_revision_mismatch/,
  );
  await assert.rejects(
    router.core_capability_read({
      capability_id: tool.name,
      catalog_revision: revision,
      arguments: { query: "status" },
    }, { ...identity, scopes: [] }),
    /insufficient_scope/,
  );
});

test("keeps a logical wrapper session out of strict Entity 360 target arguments", async () => {
  const tool = ENTITY_360_TOOLS.find((item) => item.name === "entity_360_policy_read");
  assert.ok(tool);
  let received;
  const handlers = {
    [tool.name]: async (args, caller) => {
      received = { args, caller };
      return { structuredContent: { ok: true } };
    },
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
  });
  const catalog_revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const caller = {
    ...identity,
    agentPresence: {
      agent_id: "server-agent",
      session_id: "server-session",
      client_type: "chatgpt",
    },
  };

  await router.core_capability_read({
    capability_id: tool.name,
    catalog_revision,
    session_id: "oauth-logical-session",
    arguments: { work_id: "91e82640-9edc-5424-a3e8-eb7853b0d8dd" },
  }, caller);

  assert.deepEqual(received.args, {
    work_id: "91e82640-9edc-5424-a3e8-eb7853b0d8dd",
  });
  assert.equal(received.caller, caller);

  await assert.rejects(router.core_capability_read({
    capability_id: tool.name,
    catalog_revision,
    session_id: "oauth-logical-session",
    arguments: {
      work_id: "91e82640-9edc-5424-a3e8-eb7853b0d8dd",
      agent_id: "caller-spoofed-agent",
      session_id: "caller-spoofed-session",
      client_type: "other",
    },
  }, caller), /dynamic_capability_arguments_invalid/);
});

test("injects only the server-issued Gallery preflight into action mediation", async () => {
  const tool = readTool("core_action_mediation_evaluate");
  tool.inputSchema.properties = {
    action: { type: "object", additionalProperties: true },
    work_preflight: { type: "object" },
  };
  tool.inputSchema.required = ["action", "work_preflight"];
  let received;
  const handlers = {
    [tool.name]: async (args) => {
      received = args;
      return { structuredContent: { ok: true } };
    },
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
  });
  const catalogRevision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const serverPreflight = {
    schema_version: "skinharmony_work_preflight_v1",
    preflight_id: "preflight-server-issued",
    tenant_id: "tenant-a",
    operational_surface: "tenant_work_gallery",
  };

  await router.core_capability_read({
    capability_id: tool.name,
    catalog_revision: catalogRevision,
    arguments: { action: { type: "git.commit" } },
    work_preflight: serverPreflight,
  }, identity);

  assert.deepEqual(received.work_preflight, serverPreflight);
  await assert.rejects(
    router.core_capability_read({
      capability_id: tool.name,
      catalog_revision: catalogRevision,
      arguments: {
        action: { type: "git.commit" },
        work_preflight: { tenant_id: "tenant-b" },
      },
      work_preflight: serverPreflight,
    }, identity),
    /dynamic_capability_reserved_argument/,
  );
  await assert.rejects(
    router.core_capability_read({
      capability_id: tool.name,
      catalog_revision: catalogRevision,
      arguments: { action: { type: "git.commit" } },
    }, identity),
    /dynamic_capability_arguments_invalid/,
  );
});

test("mutations fail closed unless owner confirmation, Core gate, and safe arguments agree", async () => {
  const tool = writeTool();
  let writes = 0;
  let gateAllowed = true;
  let receivedGatePreflight;
  const handlers = {
    [tool.name]: async () => {
      writes += 1;
      return { structuredContent: { ok: true } };
    },
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
    gateAction: async ({ workPreflight }) => {
      receivedGatePreflight = workPreflight;
      return {
      structuredContent: { authorization: { allowed: gateAllowed } },
      };
    },
  });
  const revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const args = {
    capability_id: tool.name,
    catalog_revision: revision,
    idempotency_key: "write-1",
    owner_confirmed: true,
    confirmation_reference: "owner-approved",
    arguments: { value: "safe" },
    work_preflight: {
      schema_version: "skinharmony_work_preflight_v1",
      preflight_id: "preflight-router-gate-binding",
      tenant_id: "tenant-a",
      mandatory: true,
      operational_surface: "tenant_work_gallery",
    },
  };

  await router.core_capability_invoke(args, identity);
  assert.equal(writes, 1);
  assert.equal(receivedGatePreflight.preflight_id, "preflight-router-gate-binding");

  gateAllowed = false;
  await assert.rejects(
    router.core_capability_invoke({ ...args, idempotency_key: "write-2" }, identity),
    /dynamic_capability_not_authorized/,
  );
  assert.equal(writes, 1);

  await assert.rejects(
    router.core_capability_invoke(
      { ...args, idempotency_key: "write-3", arguments: { value: "unsafe", nested: { tenant_id: "tenant-b" } } },
      identity,
    ),
    /dynamic_capability_reserved_argument/,
  );
  await assert.rejects(
    router.core_capability_invoke(args, { ...identity, ownerConfirmed: false }),
    /owner_confirmation_required/,
  );
  assert.equal(writes, 1);
});

test("allows tenant_id only at the authorized release manifest root", async () => {
  function manifestTool(name) {
    const definition = dedicatedCoreWriteTool(name);
    definition.inputSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        release_manifest: {
          type: "object",
          additionalProperties: true,
          properties: { tenant_id: { type: "string", minLength: 1 } },
          required: ["tenant_id"],
        },
      },
      required: ["release_manifest"],
    };
    return definition;
  }

  const authorizedTool = manifestTool("host_native_action_authorize");
  const otherTool = manifestTool("host_native_action_reserve");
  let received;
  const handlers = {
    host_native_action_authorize: async (args) => {
      received = args;
      return {
        structuredContent: {
          dedicated_core_gate: { authorized: true, authority: "universal_core" },
        },
      };
    },
    host_native_action_reserve: async () => ({
      structuredContent: {
        dedicated_core_gate: { authorized: true, authority: "universal_core" },
      },
    }),
  };
  const tools = [authorizedTool, otherTool];
  const router = createDynamicCapabilityHandlers({
    tools,
    handlers,
    semanticSelect: async () => ({}),
  });
  const revision = dynamicCapabilityCatalogSnapshot(tools, handlers).catalog_revision;
  const invoke = (capabilityId, arguments_, suffix) => router.core_capability_invoke({
    capability_id: capabilityId,
    catalog_revision: revision,
    idempotency_key: `manifest-${suffix}`,
    arguments: arguments_,
  }, { ...identity, ownerConfirmed: false });

  await invoke(
    "host_native_action_authorize",
    { release_manifest: { tenant_id: "tenant-a", repository: "owner/repository" } },
    "allowed",
  );
  assert.deepEqual(received, {
    release_manifest: { tenant_id: "tenant-a", repository: "owner/repository" },
  });

  const rejected = [
    ["host_native_action_reserve", { release_manifest: { tenant_id: "tenant-a" } }, "other-capability"],
    ["host_native_action_authorize", { tenant_id: "tenant-a", release_manifest: { tenant_id: "tenant-a" } }, "root"],
    ["host_native_action_authorize", { release_manifest: { tenant_id: "tenant-a", delivery: { tenant_id: "tenant-a" } } }, "nested"],
    ["host_native_action_authorize", { release_manifest: { tenant_id: "tenant-a", prototype: {} } }, "prototype"],
    ["host_native_action_authorize", { release_manifest: { tenant_id: "tenant-a", owner_context: {} } }, "owner-context"],
  ];
  for (const [capabilityId, arguments_, suffix] of rejected) {
    await assert.rejects(
      invoke(capabilityId, arguments_, suffix),
      /dynamic_capability_reserved_argument/,
    );
  }
});

test("allows only a metadata-free agent heartbeat without owner confirmation", async () => {
  const tool = writeTool("agent_heartbeat");
  tool.inputSchema.properties = {
    agent_id: { type: "string" },
    client_type: { type: "string" },
    session_id: { type: "string" },
    display_name: { type: "string" },
    capabilities: { type: "array", items: { type: "string" } },
    owner_confirmed: { type: "boolean" },
    confirmation_reference: { type: "string" },
  };
  tool.inputSchema.required = ["agent_id", "client_type", "session_id", "owner_confirmed"];
  let received;
  let gatedTool;
  const handlers = {
    agent_heartbeat: async (args) => {
      received = args;
      return { structuredContent: { ok: true } };
    },
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
    gateAction: async ({ tool: target }) => {
      gatedTool = target;
      return { structuredContent: { authorization: { allowed: true } } };
    },
  });
  const revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const minimal = {
    capability_id: "agent_heartbeat",
    catalog_revision: revision,
    idempotency_key: "heartbeat-minimal-1",
    arguments: { agent_id: "agent-a", client_type: "codex", session_id: "session-a" },
  };

  const result = await router.core_capability_invoke(minimal, { ...identity, ownerConfirmed: false });
  assert.equal(gatedTool._meta["skinharmony/ownerConfirmationRequired"], false);
  assert.equal(result.structuredContent.dynamic_capability.owner_confirmation_required, false);
  assert.deepEqual(received, { ...minimal.arguments, owner_confirmed: false });

  for (const arguments_ of [
    { ...minimal.arguments, display_name: "Custom agent" },
    { ...minimal.arguments, capabilities: ["release_governance"] },
    { ...minimal.arguments, capabilities: "release_governance" },
  ]) {
    await assert.rejects(
      router.core_capability_invoke(
        { ...minimal, idempotency_key: `blocked-${String(arguments_.display_name || arguments_.capabilities)}`, arguments: arguments_ },
        { ...identity, ownerConfirmed: false },
      ),
      /owner_confirmation_required/,
    );
  }
});

test("agent heartbeat can rely on its handler-owned Core gate without a duplicate dynamic gate", async () => {
  const tool = writeTool("agent_heartbeat");
  tool.inputSchema.properties = {
    agent_id: { type: "string" },
    client_type: { type: "string" },
    session_id: { type: "string" },
    display_name: { type: "string" },
    capabilities: { type: "array", items: { type: "string" } },
    owner_confirmed: { type: "boolean" },
    confirmation_reference: { type: "string" },
  };
  tool.inputSchema.required = ["agent_id", "client_type", "session_id", "owner_confirmed"];
  let dynamicGateCalls = 0;
  let handlerGateVerified = true;
  const handlers = {
    agent_heartbeat: async () => ({
      structuredContent: {
        ok: true,
        gate: { allowed: handlerGateVerified },
      },
    }),
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
    internallyGovernedCapabilities: ["agent_heartbeat"],
    gateAction: async () => {
      dynamicGateCalls += 1;
      return { structuredContent: { authorization: { allowed: true } } };
    },
  });
  const revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const invoke = (suffix) => router.core_capability_invoke({
    capability_id: "agent_heartbeat",
    catalog_revision: revision,
    idempotency_key: `heartbeat-internal-${suffix}`,
    arguments: { agent_id: "agent-a", client_type: "codex", session_id: "session-a" },
  }, { ...identity, ownerConfirmed: false });

  const result = await invoke("verified");
  assert.equal(dynamicGateCalls, 0);
  assert.equal(result.structuredContent.dynamic_capability.gate_source, "handler_internal_core_gate");

  handlerGateVerified = false;
  await assert.rejects(invoke("unverified"), /dynamic_capability_internal_core_gate_unverified/);
  assert.equal(dynamicGateCalls, 0);
});

test("agent heartbeat admits tenant identity only inside a Core-signed recovery envelope", async () => {
  const tool = writeTool("agent_heartbeat");
  tool.inputSchema.properties = {
    agent_id: { type: "string" },
    client_type: { type: "string" },
    session_id: { type: "string" },
    owner_confirmed: { type: "boolean" },
    confirmation_reference: { type: "string" },
    recovery_context: {
      type: "object",
      properties: {
        envelope: { type: "object", additionalProperties: true },
        signature: { type: "object", additionalProperties: true },
      },
      required: ["envelope", "signature"],
      additionalProperties: false,
    },
  };
  tool.inputSchema.required = ["agent_id", "client_type", "session_id", "recovery_context"];
  const handlers = {
    agent_heartbeat: async () => ({ structuredContent: { gate: { allowed: true } } }),
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
    internallyGovernedCapabilities: ["agent_heartbeat"],
  });
  const revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const base = {
    capability_id: "agent_heartbeat",
    catalog_revision: revision,
    idempotency_key: "presence-recovery-envelope",
    arguments: {
      agent_id: "agent-a",
      client_type: "codex",
      session_id: "session-a",
      recovery_context: {
        envelope: { tenant_id: "tenant-a", context_digest: "a".repeat(64) },
        signature: { key_id: "causal-v1", digest: "b".repeat(64) },
      },
    },
  };
  const accepted = await router.core_capability_invoke(base, { ...identity, ownerConfirmed: false });
  assert.equal(accepted.structuredContent.dynamic_capability.gate_source, "handler_internal_core_gate");
  await assert.rejects(router.core_capability_invoke({
    ...base,
    idempotency_key: "presence-recovery-top-level-tenant",
    arguments: { ...base.arguments, tenant_id: "tenant-a" },
  }, { ...identity, ownerConfirmed: false }), /dynamic_capability_reserved_argument/);
  await assert.rejects(router.core_capability_invoke({
    ...base,
    idempotency_key: "presence-recovery-nested-tenant",
    arguments: {
      ...base.arguments,
      recovery_context: {
        ...base.arguments.recovery_context,
        envelope: { tenant_id: "tenant-a", nested: { tenant_id: "tenant-a" } },
      },
    },
  }, { ...identity, ownerConfirmed: false }), /dynamic_capability_reserved_argument/);
});

test("bounded internal mutations use the target metadata instead of impersonating the owner", async () => {
  const tool = delegatedWriteTool();
  let received;
  let gated = 0;
  const handlers = {
    [tool.name]: async (args, caller) => {
      received = { args, caller };
      return { structuredContent: { ok: true } };
    },
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
    gateAction: async () => {
      gated += 1;
      return { structuredContent: { authorization: { allowed: true } } };
    },
  });
  const revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const caller = { ...identity, ownerConfirmed: false };
  const result = await router.core_capability_invoke({
    capability_id: tool.name,
    catalog_revision: revision,
    idempotency_key: "agent-report-1",
    arguments: { value: "verified receipt" },
  }, caller);

  assert.equal(gated, 1);
  assert.deepEqual(received.args, { value: "verified receipt" });
  assert.equal(received.caller, caller);
  assert.equal(result.structuredContent.dynamic_capability.owner_confirmation_required, false);
  assert.equal(result.structuredContent.dynamic_capability.owner_confirmation_satisfied, true);
});

test("dedicated Core routes replace the generic gate only with a verified Core marker", async () => {
  const tool = dedicatedCoreWriteTool();
  let genericGateCalls = 0;
  let markerAuthorized = true;
  const handlers = {
    [tool.name]: async () => ({
      structuredContent: {
        ok: true,
        dedicated_core_gate: {
          authorized: markerAuthorized,
          authority: "universal_core",
        },
      },
    }),
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
    gateAction: async () => {
      genericGateCalls += 1;
      return { structuredContent: { authorization: { allowed: true } } };
    },
  });
  const revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const args = {
    capability_id: tool.name,
    catalog_revision: revision,
    idempotency_key: "reserve-ticket-1",
    arguments: { value: "ticket" },
  };

  const result = await router.core_capability_invoke(args, {
    ...identity,
    ownerConfirmed: false,
  });
  assert.equal(genericGateCalls, 0);
  assert.equal(
    result.structuredContent.dynamic_capability.gate_source,
    "universal_core_dedicated_route",
  );

  markerAuthorized = false;
  await assert.rejects(
    router.core_capability_invoke(
      { ...args, idempotency_key: "reserve-ticket-2" },
      { ...identity, ownerConfirmed: false },
    ),
    /dynamic_capability_dedicated_core_gate_unverified/,
  );
  assert.equal(genericGateCalls, 0);
});

test("keeps Entity 360 shadow controls direct-only and out of generic discovery", () => {
  const shadowTools = ENTITY_360_TOOLS.filter((tool) => [
    "entity_360_shadow_enable",
    "entity_360_shadow_disable",
  ].includes(tool.name));
  const handlers = Object.fromEntries(shadowTools.map((tool) => [tool.name, async () => ({})]));
  const snapshot = dynamicCapabilityCatalogSnapshot(shadowTools, handlers);

  assert.deepEqual(snapshot.capabilities, []);
  for (const tool of shadowTools) {
    assert.equal(COMPACT_MCP_TOOL_NAMES.includes(tool.name), true);
  }
});

test("OAuth-owner continuity bootstrap capabilities use only their server-owned Core gate", async () => {
  const bootstrapTools = WORK_CONTINUITY_TOOLS.filter((tool) => [
    "work_continuity_create",
    "work_continuity_start_or_resume",
    "work_continuity_v2_create",
  ].includes(tool.name));
  const dedicatedContinuityTools = WORK_CONTINUITY_TOOLS.filter((tool) => [
    "work_continuity_create",
    "work_continuity_start_or_resume",
    "work_continuity_checkpoint",
    "work_continuity_resume",
    "work_continuity_v2_create",
    "tenant_work_queue_create_v3",
    "tenant_work_open_review",
    "tenant_work_legacy_reconcile_close",
    "work_continuity_precommit_reconcile",
    "work_continuity_generic_core_join",
    "work_continuity_generic_closure_finalize",
    "nyra_verified_work_finalize",
  ].includes(tool.name));
  assert.deepEqual(bootstrapTools.map((tool) => tool.name), [
    "work_continuity_create",
    "work_continuity_start_or_resume",
    "work_continuity_v2_create",
  ]);
  for (const tool of bootstrapTools) {
    assert.equal(tool._meta["skinharmony/dedicatedCoreGate"], true);
    assert.equal(tool._meta["skinharmony/serverOwnedGovernance"], true);
  }
  assert.deepEqual(dedicatedContinuityTools.map((tool) => tool.name), [
    "work_continuity_create",
    "work_continuity_checkpoint",
    "work_continuity_resume",
    "work_continuity_start_or_resume",
    "work_continuity_v2_create",
    "tenant_work_queue_create_v3",
    "tenant_work_open_review",
    "tenant_work_legacy_reconcile_close",
    "work_continuity_generic_core_join",
    "work_continuity_generic_closure_finalize",
    "nyra_verified_work_finalize",
    "work_continuity_precommit_reconcile",
  ]);
  assert.equal(dedicatedContinuityTools.every((tool) =>
    tool._meta?.["skinharmony/serverOwnedGovernance"] === true &&
    tool._meta?.["skinharmony/dedicatedCoreGate"] === true), true);
  assert.equal(WORK_CONTINUITY_TOOLS
    .filter((tool) => !dedicatedContinuityTools.includes(tool))
    .some((tool) => tool._meta?.["skinharmony/serverOwnedGovernance"] === true ||
      tool._meta?.["skinharmony/dedicatedCoreGate"] === true), false);

  for (const tool of bootstrapTools) {
    let genericGateCalls = 0;
    let includeMarker = true;
    const handlers = {
      [tool.name]: async (args, caller) => {
        assert.equal(caller.kind, "oauth");
        assert.equal(caller.oauthOwnerElevated, true);
        assert.equal(caller.ownerConfirmed, true);
        assert.equal(args.owner_confirmed, true);
        assert.equal(args.confirmation_reference, "owner-approved-work-bootstrap");
        return {
          structuredContent: {
            ok: true,
            ...(includeMarker ? {
              dedicated_core_gate: {
                authorized: true,
                authority: "universal_core",
                server_owned: true,
              },
            } : {}),
          },
        };
      },
    };
    const router = createDynamicCapabilityHandlers({
      tools: [tool],
      handlers,
      semanticSelect: async () => ({}),
      gateAction: async () => {
        genericGateCalls += 1;
        return { structuredContent: { authorization: { allowed: true } } };
      },
    });
    const revision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
    const argumentsByTool = tool.name === "work_continuity_create"
      ? {
        project_id: "client-project",
        session_id: "owner-session",
        idea: "Create the client work",
        objective: "Track the work",
        architecture: {},
        next_action: "Start the approved work",
      }
      : tool.name === "work_continuity_start_or_resume" ? {
        project_id: "client-project",
        session_id: "owner-session",
        initial_message: "Create the client work",
        idea: "Create the client work",
        objective: "Track the work",
        architecture: {},
        next_action: "Start the approved work",
      } : {
        intent_type: "CREATE_WORK",
        request_id: "owner-work-bootstrap-request",
        review_id: "66666666-6666-4666-8666-666666666666",
        review_digest: "a".repeat(64),
        project_id: "client-project",
        session_id: "owner-session",
        work_name: "Approved V2 work",
        work_type: "generic",
        idea: "Create the client work",
        objective: "Track the work",
        architecture: {},
        next_action: "Start the approved work",
        acceptance_criteria: ["The work is independently verified"],
        tasks: [{ title: "Perform the work", weight: 10_000, required: true }],
      };
    const args = {
      capability_id: tool.name,
      catalog_revision: revision,
      idempotency_key: `bootstrap-${tool.name}`,
      owner_confirmed: true,
      confirmation_reference: "owner-approved-work-bootstrap",
      arguments: argumentsByTool,
    };
    const oauthOwner = {
      ...identity,
      kind: "oauth",
      subject: "auth0|client-owner",
      oauthOwnerBound: true,
      oauthOwnerElevated: true,
      ownerConfirmed: true,
      confirmationReference: "owner-approved-work-bootstrap",
    };

    const result = await router.core_capability_invoke(args, oauthOwner);
    assert.equal(genericGateCalls, 0);
    assert.equal(result.structuredContent.dynamic_capability.gate_source, "universal_core_dedicated_route");

    includeMarker = false;
    await assert.rejects(
      router.core_capability_invoke({ ...args, idempotency_key: `missing-marker-${tool.name}` }, oauthOwner),
      /dynamic_capability_dedicated_core_gate_unverified/,
    );
    assert.equal(genericGateCalls, 0);
  }
});

test("semantic selection builds candidates from the server catalog and never authorizes execution", async () => {
  const tools = [readTool(), writeTool()];
  const handlers = Object.fromEntries(tools.map((tool) => [tool.name, async () => ({})]));
  let selectedArgs;
  const router = createDynamicCapabilityHandlers({
    tools,
    handlers,
    semanticSelect: async (args) => {
      selectedArgs = args;
      return { structuredContent: { selected: [args.candidates[0].id] } };
    },
  });

  const result = await router.core_semantic_select({
    query: "read current status",
    capability_ids: ["nyra_dynamic_read"],
  }, identity);

  assert.deepEqual(selectedArgs.candidates.map((item) => item.id), ["nyra_dynamic_read"]);
  assert.equal(result.structuredContent.execution_authorized, false);
  assert.deepEqual(result.structuredContent.candidate_capability_ids, ["nyra_dynamic_read"]);
});

test("binds Core branch analysis only to the outer server-issued preflight", async () => {
  const tool = TOOLS.find((candidate) => candidate.name === "core_branch_analyze");
  assert.ok(tool);
  let received;
  const handlers = {
    [tool.name]: async (args) => {
      received = args;
      return { structuredContent: { ok: true } };
    },
  };
  const router = createDynamicCapabilityHandlers({
    tools: [tool],
    handlers,
    semanticSelect: async () => ({}),
  });
  const catalogRevision = dynamicCapabilityCatalogSnapshot([tool], handlers).catalog_revision;
  const serverPreflight = {
    schema_version: "skinharmony_work_preflight_v1",
    preflight_id: "preflight-server-issued-branch",
    tenant_id: "tenant-a",
    operational_surface: "tenant_work_gallery",
  };

  await router.core_capability_read({
    capability_id: tool.name,
    catalog_revision: catalogRevision,
    arguments: {
      branch: "context_intelligence",
      request: "Analyze the bounded tenant context",
    },
    work_preflight: serverPreflight,
  }, identity);

  assert.deepEqual(received.work_preflight, serverPreflight);
  await assert.rejects(
    router.core_capability_read({
      capability_id: tool.name,
      catalog_revision: catalogRevision,
      arguments: {
        branch: "context_intelligence",
        request: "Analyze the bounded tenant context",
        work_preflight: {
          schema_version: "skinharmony_work_preflight_v1",
          preflight_id: "caller-forged-preflight",
          tenant_id: "tenant-b",
        },
      },
      work_preflight: serverPreflight,
    }, identity),
    /dynamic_capability_reserved_argument/,
  );
});
