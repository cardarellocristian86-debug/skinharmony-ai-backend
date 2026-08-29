import assert from "node:assert/strict";
import crypto from "node:crypto";
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
  NYRA_SERVER_CONNECTOR_HINT,
} from "../src/nyra-converse.js";
import { resolveContinuityProjectBinding } from "../src/continuity-project-binding.js";
import { NYRA_DIALOGUE_WIDGET_URI } from "../src/nyra-operating-dialogue-widget.js";
import { validateToolArguments } from "../src/schema-validation.js";
import { TOOLS } from "../src/tool-definitions.js";
import { NYRA_AUTOPILOT_TOOLS } from "../src/nyra-autopilot-tools.js";
import { buildWorkPreflight } from "../../universal-core-service/src/workPreflight.js";

const WORK_ID = "c1139091-40d9-4f4e-b788-842fbc23a778";
const TASK_ID = "91f9ea3c-c6fd-4d7b-8b03-f9937405106d";
const EVIDENCE_ID = "a4c8e893-1a86-4ed3-bd85-5150d451af72";
const INTENT_DIGEST = "1".repeat(64);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function canonicalDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function identity(tenantId = "tenant-a") {
  return {
    kind: "oauth",
    tenantId,
    oauthOwnerBound: true,
    scopes: ["core:read"],
    subject: "must-not-be-returned",
    role: "tenant_owner",
    authenticatedTenantMembership: {
      schema_version: "tenant_membership_binding_v1",
      authenticated: true,
      tenant_id: tenantId,
      subject: "must-not-be-returned",
      role: "tenant_owner",
      team_ids: [],
      managed_team_ids: [],
      assigned_work_ids: [],
      issued_at: new Date(Date.now() - 1_000).toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
    agentPresence: {
      agent_id: "connected-host-agent",
      session_id: "authenticated-session",
      client_type: "chatgpt",
      signature: "must-not-be-returned",
    },
  };
}

test("rejects claim-only OAuth before cache, Gallery discovery, preflight or continuity mutation", async () => {
  const calls = { catalog: 0, preflight: 0, continuity: 0, cache: 0, interpret: 0 };
  const unbound = {
    ...identity(),
    oauthOwnerBound: false,
    authenticatedTenantMembership: undefined,
    role: "member",
  };
  const preflight = createNyraConversePreflight({
    workPreflight: async () => { calls.preflight += 1; return preflightFixture(); },
    ensureContinuity: async () => { calls.continuity += 1; },
    resolveContinuityProjectBinding,
    workContinuityRuntime: {
      listWorks: async () => { calls.catalog += 1; return { works: [] }; },
    },
    hostType: () => "chatgpt_native",
  });
  await assert.rejects(preflight({
    message: "Nyra, riprendi il Work",
    session_id: "claim-only-session",
  }, unbound), /tenant_work_membership_required/);

  const handler = createNyraConverseHandler({
    preflight: async () => { calls.preflight += 1; return preflightFixture(); },
    interpret: async () => { calls.interpret += 1; return interpretationFixture(); },
    readControlContext: async () => { calls.cache += 1; return null; },
  });
  await assert.rejects(handler({
    message: "Nyra, riprendi il Work",
    work_id: WORK_ID,
    project_id: "nyra_core",
  }, unbound), /tenant_work_membership_required/);
  assert.deepEqual(calls, { catalog: 0, preflight: 0, continuity: 0, cache: 0, interpret: 0 });
});

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
          state: "ok",
          control_level: "observe",
          primary_action_id: "action:respond_conversationally",
          primary_action_label: "Respond conversationally",
          risk_band: "low",
          can_execute: false,
          requires_owner_confirmation: false,
          blocked_reasons: [],
          unmet_conditions: [],
          evidence_requirements: [],
          allowed_alternatives: [],
          private_reasoning: "must-not-be-returned",
        },
        automation_plan: {
          execution_allowed: false,
          next_step: "Proceed in read-only analysis",
          runbook_candidate: "respond_conversationally",
          audit_required: true,
          owner_confirmation_required: false,
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

function directiveContextFixture({
  tenantId = "tenant-a",
  projectId = "nyra_core",
  workRevision = 4,
  status = "ACTIVE",
  taskStatus = "planned",
  acceptanceVerified = false,
  evidenceVerified = false,
  closureVerification = null,
} = {}) {
  return {
    schema_version: "work_continuity_v2",
    work_revision: workRevision,
    work: {
      tenant_id: tenantId,
      work_id: WORK_ID,
      project_id: projectId,
      status,
      intent_digest: INTENT_DIGEST,
      objective: "Prepare the canonical Entity 360 architecture and governed delivery",
      next_action: "E360-02 — ADR boundaries",
      acceptance_criteria: ["Architecture and acceptance criteria are verified"],
    },
    tasks: [{
      tenant_id: tenantId,
      task_id: TASK_ID,
      work_id: WORK_ID,
      title: "Verify the Nyra orchestration contract and CI evidence",
      status: taskStatus,
      required: true,
      acceptance_verified: acceptanceVerified,
    }],
    evidence: [{
      tenant_id: tenantId,
      evidence_id: EVIDENCE_ID,
      work_id: WORK_ID,
      kind: "test_report",
      digest: "2".repeat(64),
      required: true,
      independently_verified: evidenceVerified,
      metadata: { raw_customer_data: "must-not-be-returned" },
    }],
    closure_receipt: null,
    closure_verification: closureVerification,
    final_report: null,
  };
}

function harness({
  preflightResult,
  interpretationResult,
  persistedContext,
  directiveContext,
  openContinuation,
} = {}) {
  const calls = { preflight: [], interpret: [], readControlContext: [], readDirectiveContext: [] };
  const handler = createNyraConverseHandler({
    preflight: async (args, authenticatedIdentity) => {
      calls.preflight.push({ args, identity: authenticatedIdentity });
      return preflightResult || preflightFixture(authenticatedIdentity.tenantId);
    },
    interpret: async (args, authenticatedIdentity) => {
      calls.interpret.push({ args, identity: authenticatedIdentity });
      return interpretationResult || interpretationFixture(authenticatedIdentity.tenantId);
    },
    readControlContext: persistedContext === undefined ? null : async (authenticatedIdentity, args) => {
      calls.readControlContext.push({ args, identity: authenticatedIdentity });
      return persistedContext;
    },
    readDirectiveContext: directiveContext === undefined ? null : async (authenticatedIdentity, args) => {
      calls.readDirectiveContext.push({ args, identity: authenticatedIdentity });
      return directiveContext;
    },
    openContinuation,
  });
  return { handler, calls };
}

test("reuses the persistent Nyra dialogue without preflight or Core interpretation", async () => {
  const context = (await import("../src/nyra-control-context.js")).buildNyraControlContext({
    continuity: {
      tenant_id: "tenant-a",
      project_id: "nyra_core",
      work_id: WORK_ID,
      state: "active",
      next_action: "Continue the existing Work.",
    },
    operational: { work_revision: 3, gallery: { state: "available", work_count: 1 } },
  });
  const { handler, calls } = harness({ persistedContext: context });
  const result = await handler({
    message: "Nyra, riprendi il lavoro",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
  }, identity());
  const payload = result.structuredContent;
  assert.equal(calls.readControlContext.length, 1);
  assert.equal(calls.preflight.length, 0);
  assert.equal(calls.interpret.length, 0);
  assert.equal(payload.work.preflight_bound, true);
  assert.equal(payload.work.next_action, "Continue the existing Work.");
  assert.equal(payload.host_response_contract.next_action, "Continue the existing Work.");
  assert.match(payload.host_response_contract.reply_seed,
    /^Riprendo dal punto verificabile di questo Work\.\n\nAdesso: AI collegata — Continue the existing Work\./);
  assert.equal(payload.host_response_contract.rendering_policy, "server_orchestration_directive_first_v2");
  assert.equal(payload.orchestration_directive.source, "PERSISTED_WORK");
  assert.equal(payload.orchestration_directive.decision.disposition, "RESUME");
  assert.equal(payload.orchestration_directive.decision.recommendation_authority, "NYRA");
  assert.equal(payload.orchestration_directive.decision.final_authority, "UNIVERSAL_CORE");
  assert.equal(payload.orchestration_directive.execution_authorized, false);
  assert.equal(result.content[0].text, payload.host_response_contract.reply_seed);
  assert.equal(result._meta.ui.resourceUri, NYRA_DIALOGUE_WIDGET_URI);
  assert.equal(result._meta["openai/outputTemplate"], NYRA_DIALOGUE_WIDGET_URI);
  assert.equal(result.content[0].text.includes(WORK_ID), false);
  assert.equal(payload.interpretation.core.execution_allowed, false);
  assert.equal(payload.interpretation.core.route, "V0");
  assert.equal(payload.nyra_dialogue.work_revision, 3);
  assert.equal(payload.nyra_dialogue.gallery_work_count, 1);
  assert.equal(payload.nyra_dialogue.diagnosis_state, "intent_anchor_incomplete");
  assert.deepEqual(payload.nyra_dialogue.assignment, {
    available: false,
    assignment_id: null,
    role: null,
    state: null,
  });
  assert.equal(payload.server_model_calls, 0);
  const definition = TOOLS.find((tool) => tool.name === "nyra_converse");
  assert.deepEqual(validateToolArguments(definition.outputSchema, payload), []);
});

test("does not let a cached Work step dominate a new technical orchestration request", async () => {
  const context = (await import("../src/nyra-control-context.js")).buildNyraControlContext({
    continuity: {
      tenant_id: "tenant-a",
      project_id: "nyra_core",
      work_id: WORK_ID,
      state: "active",
      next_action: "E360-02 — stale cached step",
    },
    operational: { work_revision: 4, gallery: { state: "available", work_count: 1 } },
  });
  const interpretation = interpretationFixture();
  interpretation.structuredContent.result.selected_by_core.primary_action_id = "action:software_verification";
  interpretation.structuredContent.result.selected_by_core.primary_action_label = "Verify patch and regressions";
  interpretation.structuredContent.result.automation_plan.next_step = "Prepare verified PR and CI evidence";
  const { handler, calls } = harness({
    persistedContext: context,
    interpretationResult: interpretation,
  });

  const response = await handler({
    message: "Nyra, diagnostica il problema del merge e dimmi cosa serve a Codex",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
  }, identity());
  const payload = response.structuredContent;

  assert.equal(calls.readControlContext.length, 0);
  assert.equal(calls.preflight.length, 1);
  assert.equal(calls.interpret.length, 1);
  assert.equal(payload.orchestration_directive.source, "FRESH_CORE");
  assert.equal(payload.orchestration_directive.decision.disposition, "PREPARE_BOUNDED_WORK");
  assert.equal(payload.host_response_contract.next_action, "Prepare verified PR and CI evidence");
  assert.equal(JSON.stringify(response).includes("stale cached step"), false);
  assert.deepEqual(
    payload.orchestration_directive.next_actions.map((item) => item.actor),
    ["HOST", "UNIVERSAL_CORE", "OWNER"],
  );
  assert.equal(payload.orchestration_directive.ticket_request.required, true);
  assert.match(payload.host_response_contract.reply_seed, /Per sbloccare il prossimo gate:/);
  assert.match(payload.host_response_contract.reply_seed, /Il ticket resta in attesa/);
});

test("never treats a server-routed stale capability request as a pure resume", async () => {
  const context = (await import("../src/nyra-control-context.js")).buildNyraControlContext({
    continuity: {
      tenant_id: "tenant-a",
      project_id: "nyra_core",
      work_id: WORK_ID,
      state: "active",
      next_action: "Cached resume step",
    },
    operational: { work_revision: 4, gallery: { state: "available", work_count: 1 } },
  });
  const { handler, calls } = harness({ persistedContext: context });
  const args = {
    message: "continua",
    work_id: WORK_ID,
    project_id: "nyra_core",
  };
  Object.defineProperty(args, NYRA_SERVER_CONNECTOR_HINT, {
    value: {
      server_issued: true,
      request_kind: "capability_read",
      capability_hint: "host_native_action_reserve",
    },
    enumerable: true,
  });

  const response = await handler(args, identity());
  assert.equal(calls.readControlContext.length, 0);
  assert.equal(calls.preflight.length, 1);
  assert.equal(calls.interpret.length, 1);
  assert.equal(response.structuredContent.orchestration_directive.source, "LEGACY_CONNECTOR_HINT");
  assert.equal(response.structuredContent.orchestration_directive.ticket_request.action_class, "TICKET_RESERVE");
});

test("honors the persisted recovery diagnosis on a pure resume", async () => {
  const context = (await import("../src/nyra-control-context.js")).buildNyraControlContext({
    continuity: {
      tenant_id: "tenant-a",
      project_id: "nyra_core",
      work_id: WORK_ID,
      state: "active",
      work_revision: 3,
      next_action: "Continue",
      connector_state: { state: "reconnect_required", recovery_action: "Reconnect the connector" },
    },
    operational: { work_revision: 3, gallery: { state: "available", work_count: 1 } },
  });
  const { handler, calls } = harness({ persistedContext: context });
  const payload = (await handler({
    message: "Nyra, riprendi il lavoro",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
  }, identity())).structuredContent;

  assert.equal(calls.preflight.length, 0);
  assert.equal(payload.nyra_dialogue.diagnosis_state, "recovery_required");
  assert.equal(payload.interpretation.risk_band, "blocked");
  assert.equal(payload.orchestration_directive.decision.disposition, "BLOCK");
  assert.equal(payload.orchestration_directive.can_continue, true);
});

test("keeps a requested merge manual for the owner and gives the registered host bounded preparation work", async () => {
  const interpretation = interpretationFixture();
  interpretation.structuredContent.result.selected_by_core.primary_action_id = "action:deployment_runbook";
  interpretation.structuredContent.result.selected_by_core.primary_action_label = "Prepare release runbook";
  interpretation.structuredContent.result.selected_by_core.requires_owner_confirmation = true;
  interpretation.structuredContent.result.automation_plan.next_step = "Prepare the PR and attach CI evidence";
  interpretation.structuredContent.result.automation_plan.owner_confirmation_required = true;
  const response = await harness({ interpretationResult: interpretation }).handler({
    message: "Nyra, prepara il lavoro ma il merge lo faccio io manualmente",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
  }, identity());
  const payload = response.structuredContent;

  assert.equal(payload.action_policy.manual_owner_execution_requested, true);
  assert.equal(payload.orchestration_directive.decision.disposition, "PREPARE_BOUNDED_WORK");
  assert.equal(payload.orchestration_directive.ticket_request.required, true);
  assert.equal(payload.orchestration_directive.ticket_request.owner_confirmation_required, true);
  assert.deepEqual(
    payload.orchestration_directive.next_actions.map((item) => item.actor),
    ["HOST", "UNIVERSAL_CORE", "OWNER"],
  );
  assert.equal(payload.orchestration_directive.next_actions[0].status, "READY");
  assert.equal(payload.orchestration_directive.next_actions[2].mode, "MANUAL");
  assert.equal(payload.orchestration_directive.ticket_request.merge_policy, "MANUAL_ONLY");
  assert.match(payload.host_response_contract.reply_seed, /il merge resta un'azione manuale tua/i);
  assert.equal(payload.execution_authorized, false);
});

test("reports missing evidence as insufficient context while keeping remediation open", async () => {
  const interpretation = interpretationFixture();
  interpretation.structuredContent.result.selected_by_core.unmet_conditions = ["required_checks_not_verified"];
  interpretation.structuredContent.result.selected_by_core.evidence_requirements = ["pg16_ci_evidence"];
  interpretation.structuredContent.result.selected_by_core.allowed_alternatives = ["Prepare the missing CI evidence"];
  const response = await harness({ interpretationResult: interpretation }).handler({
    message: "Nyra, dimmi cosa manca per continuare",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
  }, identity());
  const directive = response.structuredContent.orchestration_directive;

  assert.equal(directive.decision.disposition, "INSUFFICIENT_CONTEXT");
  assert.equal(directive.decision.core_verdict, "INSUFFICIENT_CONTEXT");
  assert.equal(directive.problem.code, "required_context_missing");
  assert.deepEqual(directive.needs.map((item) => item.detail), [
    "Condizione richiesta: required_checks_not_verified",
    "Evidenza richiesta: pg16_ci_evidence",
  ]);
  assert.equal(directive.next_actions[0].summary, "Prepare the missing CI evidence");
  assert.equal(directive.next_actions[1].stage, "EVIDENCE");
  assert.equal(directive.ticket_request.required, false);
  assert.equal(directive.can_continue, true);
});

test("surfaces a Core block as a remediable block, never as execution authority", async () => {
  const interpretation = interpretationFixture();
  interpretation.structuredContent.result.selected_by_core.risk_band = "blocked";
  interpretation.structuredContent.result.selected_by_core.blocked_reasons = ["cross_tenant_scope_denied"];
  interpretation.structuredContent.result.selected_by_core.allowed_alternatives = ["Restore the tenant-scoped binding"];
  const response = await harness({ interpretationResult: interpretation }).handler({
    message: "Nyra, diagnostica il blocco",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
  }, identity());
  const directive = response.structuredContent.orchestration_directive;

  assert.equal(directive.decision.disposition, "BLOCK");
  assert.equal(directive.decision.core_verdict, "BLOCK");
  assert.equal(directive.problem.code, "universal_core_blocked_action");
  assert.deepEqual(directive.needs.map((item) => item.detail), [
    "Risolvere il segnale Core “cross_tenant_scope_denied”, quindi rivalutare la stessa azione bounded.",
  ]);
  assert.equal(directive.next_actions[0].summary, "Restore the tenant-scoped binding");
  assert.equal(directive.can_continue, true);
  assert.equal(directive.execution_authorized, false);
});

test("treats legacy safety_mode as an explainable guard, not a fictitious Core block", async () => {
  const interpretation = interpretationFixture();
  interpretation.structuredContent.result.selected_by_core.state = "critical";
  interpretation.structuredContent.result.selected_by_core.control_level = "confirm";
  interpretation.structuredContent.result.selected_by_core.risk_band = "medium";
  interpretation.structuredContent.result.selected_by_core.blocked_reasons = ["safety_mode"];
  const response = await harness({ interpretationResult: interpretation }).handler({
    message: "Nyra, perché Core non crea il ticket? Diagnostica la causa radice.",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
  }, identity());
  const payload = response.structuredContent;
  const directive = payload.orchestration_directive;

  assert.equal(payload.action_policy.action_class, "NONE");
  assert.equal(payload.action_policy.work_bootstrap_requested, false);
  assert.deepEqual(payload.interpretation.blocked_reasons, []);
  assert.equal(payload.interpretation.governance_diagnostics.state, "CONFIRMATION_REQUIRED");
  assert.deepEqual(payload.interpretation.governance_diagnostics.causes, [{
    code: "safety_mode_guard_only",
    component: "UNIVERSAL_CORE",
    state: "GUARDED",
    remediation: "Non è un blocco: analisi, evidenze e proposta possono continuare. Un ticket e la conferma owner servono solo per una specifica azione esterna.",
  }]);
  assert.notEqual(directive.decision.disposition, "BLOCK");
  assert.equal(directive.decision.core_verdict, "HOLD");
  assert.equal(directive.ticket_request.required, false);
  assert.match(payload.host_response_contract.reply_seed, /Non ho rilevato uno stop tecnico/);
  assert.deepEqual(validateToolArguments(TOOLS.find((tool) => tool.name === "nyra_converse").outputSchema, payload), []);
});

test("adapts Nyra's wording to the requested detail without repeating governance boilerplate", async () => {
  const concise = (await harness().handler({
    message: "Nyra, prosegui con il deploy preparatorio",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
    response_style: "concise",
  }, identity())).structuredContent;
  const detailed = (await harness().handler({
    message: "Nyra, diagnostica cosa manca per il deploy",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
    response_style: "detailed",
  }, identity())).structuredContent;

  assert.equal(concise.orchestration_directive.decision.disposition, detailed.orchestration_directive.decision.disposition);
  assert.match(concise.host_response_contract.reply_seed, /Posso far avanzare la preparazione locale/);
  assert.doesNotMatch(concise.host_response_contract.reply_seed, /Per sbloccare il prossimo gate/);
  assert.doesNotMatch(concise.host_response_contract.reply_seed, /Questo turno conversazionale/);
  assert.match(detailed.host_response_contract.reply_seed, /Per sbloccare il prossimo gate/);
  assert.match(detailed.host_response_contract.reply_seed, /Il ticket resta in attesa/);
  assert.doesNotMatch(detailed.host_response_contract.reply_seed, /Questo turno conversazionale/);
});

test("keeps owner confirmation on a consequential ticket while Core is on HOLD", async () => {
  const interpretation = interpretationFixture();
  interpretation.structuredContent.result.selected_by_core.state = "critical";
  interpretation.structuredContent.result.selected_by_core.control_level = "confirm";
  interpretation.structuredContent.result.selected_by_core.risk_band = "medium";
  interpretation.structuredContent.result.selected_by_core.requires_owner_confirmation = false;
  interpretation.structuredContent.result.selected_by_core.governance_diagnostics = {
    guard_mode: "confirmation_required",
    blocking_causes: [],
  };
  interpretation.structuredContent.result.automation_plan.owner_confirmation_required = false;
  const payload = (await harness({ interpretationResult: interpretation }).handler({
    message: "Nyra, prepara il deploy in produzione.",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
  }, identity())).structuredContent;
  assert.equal(payload.orchestration_directive.decision.core_verdict, "HOLD");
  assert.equal(payload.orchestration_directive.ticket_request.required, true);
  assert.equal(payload.orchestration_directive.ticket_request.owner_confirmation_required, true);
});

test("returns the exact hard Core signal and its remediation owner", async () => {
  const interpretation = interpretationFixture();
  interpretation.structuredContent.result.selected_by_core.risk_band = "blocked";
  interpretation.structuredContent.result.selected_by_core.blocked_reasons = ["cross_tenant_scope_denied"];
  interpretation.structuredContent.result.selected_by_core.governance_diagnostics = {
    guard_mode: "normal",
    blocking_causes: [{
      code: "cross_tenant_scope_denied",
      component: "universal_core",
      remediation: "Restore the tenant-scoped binding before retrying.",
    }],
  };
  const payload = (await harness({ interpretationResult: interpretation }).handler({
    message: "Nyra, diagnostica il blocco",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
  }, identity())).structuredContent;

  assert.deepEqual(payload.interpretation.governance_diagnostics.causes, [{
    code: "cross_tenant_scope_denied",
    component: "UNIVERSAL_CORE",
    state: "BLOCKED",
    remediation: "Restore the tenant-scoped binding before retrying.",
  }]);
  assert.equal(payload.orchestration_directive.core_diagnostics.state, "BLOCKED");
  assert.equal(payload.orchestration_directive.needs[0].detail, "Restore the tenant-scoped binding before retrying.");
});

test("classifies live, production and distribution wording as governed release work", async () => {
  for (const [message, actionClass] of [
    ["Nyra, portalo live", "DEPLOY"],
    ["Nyra, mettilo in produzione", "DEPLOY"],
    ["Nyra, serve la distribuzione software", "DEPLOY"],
    ["Nyra, rilascialo", "PUBLISH"],
    ["Nyra, esegui un solo git commit locale senza push, PR o deploy", "GIT_COMMIT"],
    ["Nyra, fai push", "GIT_PUSH"],
    ["Nyra, publish", "PUBLISH"],
  ]) {
    const payload = (await harness().handler({
      message,
      work_id: WORK_ID,
      project_id: "nyra_core",
      locale: "it",
    }, identity())).structuredContent;
    assert.equal(payload.action_policy.consequential_request_detected, true, message);
    assert.equal(payload.action_policy.action_class, actionClass, message);
    assert.equal(payload.orchestration_directive.decision.disposition, "PREPARE_BOUNDED_WORK", message);
    assert.equal(payload.orchestration_directive.ticket_request.required, true, message);
    assert.equal(payload.orchestration_directive.ticket_request.ticket_id, null, message);
    assert.equal(payload.orchestration_directive.execution_authorized, false, message);
  }
});

test("keeps read-only architecture questions advisory when they mention production or denied external actions", async () => {
  for (const message of [
    "Nyra, in sola lettura indica cosa è già operativo in produzione e cosa serve per orchestrare una AI. Non creare o modificare Work, ticket, branch, PR, merge, deploy o permessi.",
    "Nyra, diagnostica il ticket Core senza fare deploy o merge. Dimmi soltanto la causa e il prossimo passo.",
    "Nyra, verifica il diff senza commit, push, PR o deploy.",
  ]) {
    const payload = (await harness().handler({
      message,
      work_id: WORK_ID,
      project_id: "nyra_core",
      locale: "it",
    }, identity())).structuredContent;
    assert.equal(payload.action_policy.consequential_request_detected, false, message);
    assert.equal(payload.action_policy.action_class, "NONE", message);
    assert.equal(payload.action_policy.mode, "advisory_only", message);
    assert.equal(payload.orchestration_directive.ticket_request.required, false, message);
  }
});

test("still governs an affirmative action after a read-only boundary", async () => {
  const payload = (await harness().handler({
    message: "Nyra, non fare deploy ora. Prima analizza; poi fai il merge.",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
  }, identity())).structuredContent;
  assert.equal(payload.action_policy.action_class, "GIT_MERGE");
  assert.equal(payload.orchestration_directive.ticket_request.required, true);

  const commitPayload = (await harness().handler({
    message: "Nyra, non fare push. Poi esegui un git commit locale.",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
  }, identity())).structuredContent;
  assert.equal(commitPayload.action_policy.action_class, "GIT_COMMIT");
  assert.equal(commitPayload.orchestration_directive.ticket_request.required, true);
});

test("makes every merge manual even when the user does not say manually", async () => {
  const payload = (await harness().handler({
    message: "Nyra, prepara il merge",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
  }, identity())).structuredContent;

  assert.equal(payload.action_policy.merge_requested, true);
  assert.equal(payload.action_policy.manual_owner_execution_requested, true);
  assert.equal(payload.orchestration_directive.ticket_request.action_class, "GIT_MERGE");
  assert.equal(payload.orchestration_directive.ticket_request.merge_policy, "MANUAL_ONLY");
  assert.equal(payload.orchestration_directive.next_actions.at(-1).actor, "OWNER");
  assert.equal(payload.orchestration_directive.next_actions.at(-1).mode, "MANUAL");
  assert.equal(payload.orchestration_directive.next_actions.at(-1).external_side_effect, true);
  assert.equal(payload.orchestration_directive.ticket_request.ticket_issued, false);
});

test("turns a server-issued reserve capability hint into an insufficient ticket prerequisite", async () => {
  const payload = (await harness().handler({
    message: "Nyra, dimmi cosa manca per continuare",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
    [NYRA_SERVER_CONNECTOR_HINT]: {
      server_issued: true,
      request_kind: "capability_discovery",
      capability_hint: "host_native_action_reserve",
    },
  }, identity())).structuredContent;
  const directive = payload.orchestration_directive;

  assert.equal(directive.source, "LEGACY_CONNECTOR_HINT");
  assert.equal(payload.action_policy.ticket_reserve_requested, true);
  assert.equal(directive.ticket_request.action_class, "TICKET_RESERVE");
  assert.equal(directive.ticket_request.capability_hint, "host_native_action_reserve");
  assert.equal(directive.ticket_request.capability_resolution, "SERVER_SIDE_RESOLVED");
  assert.equal(directive.ticket_request.state, "NEEDS_CONTEXT");
  assert.equal(directive.ticket_request.prerequisite_codes.includes("existing_core_ticket_required"), true);
  assert.equal(directive.needs.some((item) => item.code === "existing_core_ticket_required"), true);
  assert.equal(directive.ticket_request.ticket_id, null);
  assert.equal(directive.execution_authorized, false);
});

test("expands an E360 checkpoint into the real pending Work task and bounded evidence state", async () => {
  const context = directiveContextFixture();
  const { handler, calls } = harness({ directiveContext: context });
  const payload = (await handler({
    message: "Nyra, prepara il merge",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
  }, identity())).structuredContent;
  const directive = payload.orchestration_directive;

  assert.equal(calls.readDirectiveContext.length, 1);
  assert.deepEqual(calls.readDirectiveContext[0].args, {
    work_id: WORK_ID,
    project_id: "nyra_core",
    work_revision: null,
    intent_digest: null,
  });
  assert.equal(directive.work_context.available, true);
  assert.equal(directive.work_context.work_revision, 4);
  assert.equal(directive.work_context.intent_digest, INTENT_DIGEST);
  assert.equal(directive.work_context.pending_required_task_count, 1);
  assert.equal(directive.work_context.unverified_required_evidence_count, 1);
  assert.equal(directive.work_context.next_required_task.task_id, TASK_ID);
  assert.equal(directive.next_actions[0].summary,
    "Completare il task canonico: Verify the Nyra orchestration contract and CI evidence");
  assert.deepEqual(payload.host_response_contract.connected_ai_brief, {
    schema_version: "nyra_connected_ai_brief_v1",
    state: "READY",
    goal: "Completare il task canonico: Verify the Nyra orchestration contract and CI evidence",
    steps: [{
      order: 1,
      instruction: "Completare il task canonico: Verify the Nyra orchestration contract and CI evidence",
      mode: "BOUNDED_WORKSPACE",
      expected_evidence: ["Esito circoscritto per: Verify the Nyra orchestration contract and CI evidence"],
      external_side_effect: false,
    }, {
      order: 2,
      instruction: "Raccogliere e collegare al Work le evidenze mancanti con verifica indipendente",
      mode: "BOUNDED_WORKSPACE",
      expected_evidence: ["Evidenze richieste con verifica indipendente"],
      external_side_effect: false,
    }],
    expected_evidence: ["Evidenze richieste con verifica indipendente"],
    research_required: false,
    external_action_authorized: false,
  });
  assert.match(payload.host_response_contract.instructions[1], /complete server-issued task brief/);
  assert.equal(directive.ticket_request.state, "NEEDS_CONTEXT");
  assert.deepEqual(directive.ticket_request.prerequisite_codes, [
    "required_work_tasks_incomplete",
    "required_evidence_unverified",
  ]);
  assert.equal(JSON.stringify(payload).includes("E360-02"), false);
  assert.equal(JSON.stringify(payload).includes("raw_customer_data"), false);
  assert.match(directive.work_context.context_digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(validateToolArguments(TOOLS.find((tool) => tool.name === "nyra_converse").outputSchema, payload), []);
});

test("emits a deterministic revision-bound manual ticket candidate only after prerequisites are verified", async () => {
  const ready = directiveContextFixture({
    taskStatus: "completed",
    acceptanceVerified: true,
    evidenceVerified: true,
  });
  const authorizeArgs = {
    message: "Nyra, prepara il merge",
    work_id: WORK_ID,
    project_id: "nyra_core",
    continuation_operation: "authorize_action",
    locale: "it",
  };
  const openedContinuations = [];
  const openContinuation = ({ directive: openedDirective }) => {
    openedContinuations.push(openedDirective.directive_id);
    return null;
  };
  const first = await harness({ directiveContext: ready, openContinuation })
    .handler(authorizeArgs, identity());
  const second = await harness({ directiveContext: ready, openContinuation })
    .handler(authorizeArgs, identity());
  const directive = first.structuredContent.orchestration_directive;

  assert.equal(directive.decision.disposition, "MANUAL_HANDOFF");
  assert.equal(directive.ticket_request.state, "MANUAL_ONLY");
  assert.equal(Object.hasOwn(directive.ticket_request, "continuation_operation"), false);
  assert.deepEqual(directive.ticket_request.prerequisite_codes, []);
  assert.deepEqual(directive.ticket_request.binding, {
    tenant_id: "tenant-a",
    work_id: WORK_ID,
    project_id: "nyra_core",
    work_revision: 4,
    intent_digest: INTENT_DIGEST,
    context_digest: directive.work_context.context_digest,
  });
  assert.match(directive.ticket_request.request_digest, /^[a-f0-9]{64}$/);
  assert.equal(directive.ticket_request.ticket_id, null);
  assert.equal(directive.ticket_request.execution_authorized, false);
  assert.equal(
    directive.directive_id,
    second.structuredContent.orchestration_directive.directive_id,
  );
  const delegation = await harness({ directiveContext: ready, openContinuation }).handler({
    ...authorizeArgs,
    continuation_operation: "issue_delegation",
  }, identity());
  assert.equal(openedContinuations.length, 3);
  assert.notEqual(
    directive.request_digest,
    delegation.structuredContent.orchestration_directive.request_digest,
  );
  assert.notEqual(
    directive.ticket_request.request_digest,
    delegation.structuredContent.orchestration_directive.ticket_request.request_digest,
  );
  assert.notEqual(
    directive.directive_id,
    delegation.structuredContent.orchestration_directive.directive_id,
  );
  const definition = TOOLS.find((tool) => tool.name === "nyra_converse");
  assert.deepEqual(validateToolArguments(definition.outputSchema, first.structuredContent), []);
  const changed = await harness({
    directiveContext: directiveContextFixture({
      taskStatus: "completed",
      acceptanceVerified: true,
      evidenceVerified: false,
    }),
  }).handler({
    message: "Nyra, prepara il merge",
    work_id: WORK_ID,
    project_id: "nyra_core",
    locale: "it",
  }, identity());
  assert.notEqual(directive.directive_id, changed.structuredContent.orchestration_directive.directive_id);
});

test("rejects cross-bound or revision-drifted Work directive context", async () => {
  await assert.rejects(
    harness({ directiveContext: directiveContextFixture({ tenantId: "tenant-b" }) }).handler({
      message: "Nyra, diagnostica il Work",
      work_id: WORK_ID,
      project_id: "nyra_core",
    }, identity()),
    /nyra_converse_directive_context_binding_invalid/,
  );
  const persisted = (await import("../src/nyra-control-context.js")).buildNyraControlContext({
    continuity: {
      tenant_id: "tenant-a",
      project_id: "nyra_core",
      work_id: WORK_ID,
      state: "active",
      work_revision: 3,
      next_action: "Continue",
    },
    operational: { work_revision: 3, gallery: { state: "available", work_count: 1 } },
  });
  await assert.rejects(
    harness({
      persistedContext: persisted,
      directiveContext: directiveContextFixture({ workRevision: 4 }),
    }).handler({
      message: "Nyra, riprendi il lavoro",
      work_id: WORK_ID,
      project_id: "nyra_core",
    }, identity()),
    /nyra_converse_directive_context_revision_mismatch/,
  );
});

test("rejects malformed execution claims and quarantines upstream completion language", async () => {
  for (const mutate of [
    (fixture) => { delete fixture.structuredContent.result.selected_by_core.can_execute; },
    (fixture) => { fixture.structuredContent.result.selected_by_core.can_execute = true; },
    (fixture) => { delete fixture.structuredContent.result.automation_plan.execution_allowed; },
    (fixture) => { fixture.structuredContent.result.automation_plan.execution_allowed = true; },
  ]) {
    const interpretation = interpretationFixture();
    mutate(interpretation);
    await assert.rejects(
      harness({ interpretationResult: interpretation }).handler({
        message: "Nyra, diagnostica",
        work_id: WORK_ID,
        project_id: "nyra_core",
      }, identity()),
      /nyra_converse_interpretation_execution_claim_invalid/,
    );
  }
  for (const [field, value] of [
    ["state", "ready"],
    ["control_level", "caller"],
    ["risk_band", "certain"],
  ]) {
    const interpretation = interpretationFixture();
    interpretation.structuredContent.result.selected_by_core[field] = value;
    await assert.rejects(
      harness({ interpretationResult: interpretation }).handler({
        message: "Nyra, diagnostica",
        work_id: WORK_ID,
        project_id: "nyra_core",
      }, identity()),
      /nyra_converse_interpretation_contract_invalid/,
    );
  }
  for (const field of ["blocked_reasons", "unmet_conditions", "evidence_requirements", "allowed_alternatives"]) {
    for (const invalidValue of [undefined, "none", { code: "none" }]) {
      const interpretation = interpretationFixture();
      if (invalidValue === undefined) delete interpretation.structuredContent.result.selected_by_core[field];
      else interpretation.structuredContent.result.selected_by_core[field] = invalidValue;
      await assert.rejects(
        harness({ interpretationResult: interpretation }).handler({
          message: "Nyra, diagnostica",
          work_id: WORK_ID,
          project_id: "nyra_core",
        }, identity()),
        /nyra_converse_interpretation_contract_invalid/,
      );
    }
    for (const invalidList of [
      [null],
      [{ code: "hidden_block" }],
      [""],
      ["x".repeat(241)],
      ["duplicate", "duplicate"],
      Array.from({ length: 9 }, (_, index) => `signal-${index}`),
    ]) {
      const interpretation = interpretationFixture();
      interpretation.structuredContent.result.selected_by_core[field] = invalidList;
      await assert.rejects(
        harness({ interpretationResult: interpretation }).handler({
          message: "Nyra, diagnostica",
          work_id: WORK_ID,
          project_id: "nyra_core",
        }, identity()),
        /nyra_converse_interpretation_contract_invalid/,
      );
    }
  }
  for (const [target, field] of [
    ["selected_by_core", "requires_owner_confirmation"],
    ["automation_plan", "owner_confirmation_required"],
  ]) {
    for (const invalidValue of [undefined, "false", 0]) {
      const interpretation = interpretationFixture();
      if (invalidValue === undefined) delete interpretation.structuredContent.result[target][field];
      else interpretation.structuredContent.result[target][field] = invalidValue;
      await assert.rejects(
        harness({ interpretationResult: interpretation }).handler({
          message: "Nyra, diagnostica",
          work_id: WORK_ID,
          project_id: "nyra_core",
        }, identity()),
        /nyra_converse_interpretation_contract_invalid/,
      );
    }
  }
  const poisoned = interpretationFixture();
  poisoned.structuredContent.result.selected_by_core.primary_action_label = "Deploy completato";
  poisoned.structuredContent.result.automation_plan.next_step = "Merge eseguito";
  const response = await harness({ interpretationResult: poisoned }).handler({
    message: "Nyra, che cosa facciamo?",
    work_id: WORK_ID,
    project_id: "nyra_core",
  }, identity());
  assert.equal(JSON.stringify(response).includes("Deploy completato"), false);
  assert.equal(JSON.stringify(response).includes("Merge eseguito"), false);
  assert.equal(response.structuredContent.host_response_contract.next_action, "Answer the owner");
});

test("requires a verified closure before reporting a completed Work", async () => {
  const preflight = preflightFixture();
  preflight.structuredContent.work_preflight.continuity.state = "completed";
  preflight.structuredContent.work_preflight.nyra_control_context.work_state = "completed";
  const unverifiedContext = directiveContextFixture({
    status: "COMPLETED",
    taskStatus: "completed",
    acceptanceVerified: true,
    evidenceVerified: true,
  });
  unverifiedContext.closure_receipt = {
    work_id: WORK_ID,
    receipt_digest: "3".repeat(64),
    core_join_digest: "4".repeat(64),
    final_evidence_digest: "5".repeat(64),
  };
  const incomplete = await harness({
    preflightResult: preflight,
    directiveContext: unverifiedContext,
  }).handler({
    message: "Nyra, qual è lo stato?",
    work_id: WORK_ID,
    project_id: "nyra_core",
  }, identity());
  assert.equal(incomplete.structuredContent.orchestration_directive.decision.disposition, "INSUFFICIENT_CONTEXT");
  assert.equal(incomplete.structuredContent.orchestration_directive.problem.code, "verified_closure_required");

  const closureProjection = {
    schema_version: "tenant_work_closure_verification_v1",
    verified: true,
    tenant_id: "tenant-a",
    work_id: WORK_ID,
    status: "COMPLETED",
    receipt_digest: "3".repeat(64),
    report_digest: "4".repeat(64),
    core_join_digest: "5".repeat(64),
    final_evidence_digest: "6".repeat(64),
    closure_event_hash: "7".repeat(64),
    failure_codes: [],
  };
  const verified = await harness({
    preflightResult: preflight,
    directiveContext: directiveContextFixture({
      status: "COMPLETED",
      taskStatus: "completed",
      acceptanceVerified: true,
      evidenceVerified: true,
      closureVerification: {
        ...closureProjection,
        verification_digest: canonicalDigest(closureProjection),
      },
    }),
  }).handler({
    message: "Nyra, qual è lo stato?",
    work_id: WORK_ID,
    project_id: "nyra_core",
  }, identity());
  assert.equal(verified.structuredContent.orchestration_directive.decision.disposition, "COMPLETE");
  assert.match(verified.structuredContent.host_response_contract.reply_seed, /chiusura verificata/);
});

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

test("binds direct Nyra conversation to Work project when the host sends a stale project hint", async () => {
  const calls = { preflight: [], continuity: [] };
  const authenticatedIdentity = identity();
  const preflight = createNyraConversePreflight({
    workPreflight: async (args) => {
      calls.preflight.push(args);
      return preflightFixture(authenticatedIdentity.tenantId);
    },
    ensureContinuity: async (...args) => calls.continuity.push(args),
    resolveContinuityProjectBinding,
    workContinuityRuntime: { readIntent: async () => ({ project_id: "nyra_core" }) },
    hostType: () => "chatgpt_native",
  });

  await preflight({
    message: "Nyra, riprendi il Work",
    work_id: WORK_ID,
    project_id: "stale-host-project",
  }, authenticatedIdentity);

  assert.equal(calls.preflight.length, 1);
  assert.equal(calls.preflight[0].project_id, "nyra_core");
  assert.equal(calls.continuity[0][1].project_id, "nyra_core");
});

test("restores the sole operational Work before Nyra's single governed preflight", async () => {
  const calls = { catalog: [], intent: [], preflight: [], continuity: [] };
  const authenticatedIdentity = identity();
  const preflight = createNyraConversePreflight({
    workPreflight: async (args) => {
      calls.preflight.push(args);
      return preflightFixture(authenticatedIdentity.tenantId);
    },
    ensureContinuity: async (...args) => calls.continuity.push(args),
    resolveContinuityProjectBinding,
    workContinuityRuntime: {
      listWorks: async (receivedIdentity, input) => {
        calls.catalog.push({ identity: receivedIdentity, input });
        return {
          works: [{ work_id: WORK_ID, project_id: "nyra_core", status: "active" }],
          next_cursor: null,
        };
      },
      readIntent: async (receivedIdentity, args) => {
        calls.intent.push({ identity: receivedIdentity, args });
        return { project_id: "nyra_core" };
      },
    },
    hostType: () => "chatgpt_native",
  });

  await preflight({ message: "Nyra, riprendi il Work" }, authenticatedIdentity);

  assert.deepEqual(calls.catalog, ["active", "verified", "release_ready", "blocked"].map((status) => ({
    identity: authenticatedIdentity,
    input: { status, limit: 2 },
  })));
  assert.deepEqual(calls.intent, [{
    identity: authenticatedIdentity,
    args: { work_id: WORK_ID },
  }]);
  assert.equal(calls.preflight.length, 1);
  assert.equal(calls.preflight[0].work_id, WORK_ID);
  assert.equal(calls.preflight[0].project_id, "nyra_core");
  assert.equal(calls.continuity.length, 1);
  assert.equal(calls.continuity[0][1].work_id, WORK_ID);
  assert.equal(calls.continuity[0][1].project_id, "nyra_core");
});

test("routes an unbound explicit bootstrap to duplicate review instead of auto-binding the sole project Work", async () => {
  const calls = { catalog: [], intent: [], preflight: [], continuity: [] };
  const authenticatedIdentity = identity();
  const preflight = createNyraConversePreflight({
    workPreflight: async (args) => {
      calls.preflight.push(args);
      const result = preflightFixture(authenticatedIdentity.tenantId);
      delete result.structuredContent.work_preflight.continuity.work_id;
      delete result.structuredContent.work_preflight.nyra_control_context.work_id;
      return result;
    },
    ensureContinuity: async (...args) => calls.continuity.push(args),
    resolveContinuityProjectBinding,
    workContinuityRuntime: {
      listWorks: async (...args) => {
        calls.catalog.push(args);
        return {
          works: [{ work_id: WORK_ID, project_id: "nyra_core", status: "active" }],
          next_cursor: null,
        };
      },
      readIntent: async (...args) => {
        calls.intent.push(args);
        return { project_id: "nyra_core" };
      },
    },
    hostType: () => "chatgpt_native",
  });
  const bootstrap = {
    request_id: "new-work-review-001",
    work_name: "A semantically different Work",
  };

  await preflight({
    message: "Nyra, crea il nuovo Work",
    project_id: "nyra_core",
    work_bootstrap: bootstrap,
  }, authenticatedIdentity);

  assert.deepEqual(calls.catalog, [], "semantic duplicate review owns discovery for explicit bootstrap");
  assert.deepEqual(calls.intent, []);
  assert.equal(calls.preflight.length, 1);
  assert.equal(calls.preflight[0].work_id, undefined);
  assert.equal(calls.preflight[0].project_id, "nyra_core");
  assert.deepEqual(calls.continuity, [], "bootstrap review cannot implicitly resume or create a Work");
});

test("does not bind a tenant-wide Work from another project during bootstrap", async () => {
  const calls = { catalog: [], intent: [], preflight: [] };
  const authenticatedIdentity = identity();
  const preflight = createNyraConversePreflight({
    workPreflight: async (args) => {
      calls.preflight.push(args);
      return preflightFixture(authenticatedIdentity.tenantId);
    },
    ensureContinuity: async () => {},
    resolveContinuityProjectBinding,
    workContinuityRuntime: {
      listWorks: async (_receivedIdentity, input) => {
        calls.catalog.push(input);
        return {
          // Deliberately ignore the requested project like a stale adapter;
          // Nyra must still filter the response before binding a Work.
          works: [{ work_id: WORK_ID, project_id: "other_project", status: input.status }],
          next_cursor: null,
        };
      },
      readIntent: async (...args) => {
        calls.intent.push(args);
        return { project_id: "must-not-be-used" };
      },
    },
    hostType: () => "chatgpt_native",
  });

  await preflight({
    message: "Nyra, crea il Work per il nuovo progetto",
    project_id: "new_project",
  }, authenticatedIdentity);

  assert.deepEqual(calls.catalog, ["active", "verified", "release_ready", "blocked"].map((status) => ({
    status,
    limit: 2,
    project_id: "new_project",
  })));
  assert.deepEqual(calls.intent, []);
  assert.equal(calls.preflight[0].work_id, undefined);
  assert.equal(calls.preflight[0].project_id, "new_project");
});

test("does not guess a Work when the active Gallery has more than one candidate", async () => {
  const calls = { intent: [], preflight: [] };
  const preflight = createNyraConversePreflight({
    workPreflight: async (args) => {
      calls.preflight.push(args);
      return preflightFixture();
    },
    ensureContinuity: async () => {},
    resolveContinuityProjectBinding,
    workContinuityRuntime: {
      listWorks: async () => ({
        works: [
          { work_id: WORK_ID, project_id: "nyra_core", status: "active" },
          { work_id: "d8f1e821-4f45-4e1f-a9e9-633a3eaa5eaf", project_id: "other", status: "active" },
        ],
        next_cursor: null,
      }),
      readIntent: async (...args) => {
        calls.intent.push(args);
        return { project_id: "must-not-be-used" };
      },
    },
    hostType: () => "chatgpt_native",
  });

  await preflight({ message: "Nyra, riprendi il Work" }, identity());

  assert.deepEqual(calls.intent, []);
  assert.equal(calls.preflight.length, 1);
  assert.equal(calls.preflight[0].work_id, undefined);
  assert.equal(calls.preflight[0].project_id, "nyra_conversational_runtime");
});

test("does not guess an active Work when another operational Work is blocked", async () => {
  const calls = { intent: [], preflight: [] };
  const preflight = createNyraConversePreflight({
    workPreflight: async (args) => {
      calls.preflight.push(args);
      return preflightFixture();
    },
    ensureContinuity: async () => {},
    resolveContinuityProjectBinding,
    workContinuityRuntime: {
      listWorks: async (_identity, input) => ({
        works: input.status === "active"
          ? [{ work_id: WORK_ID, project_id: "nyra_core", status: "active" }]
          : input.status === "blocked"
            ? [{ work_id: "d8f1e821-4f45-4e1f-a9e9-633a3eaa5eaf", project_id: "other", status: "blocked" }]
            : [],
        next_cursor: null,
      }),
      readIntent: async (...args) => {
        calls.intent.push(args);
        return { project_id: "must-not-be-used" };
      },
    },
    hostType: () => "chatgpt_native",
  });

  await preflight({ message: "Nyra, riprendi il Work" }, identity());
  assert.deepEqual(calls.intent, []);
  assert.equal(calls.preflight[0].work_id, undefined);
});

test("publishes nyra_converse as a direct compact resume tool without discovery", async () => {
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

  const availableTools = [...TOOLS, ...NYRA_AUTOPILOT_TOOLS];
  const allHandlers = Object.fromEntries(availableTools.map((tool) => [tool.name, async () => ({})]));
  const compact = compactMcpTools(availableTools, allHandlers);
  assert.deepEqual(compact.map((tool) => tool.name), COMPACT_MCP_TOOL_NAMES);
  assert.equal(compact.length, 14);
  assert.equal(compact.some((tool) => tool.name === "nyra_converse"), true);
  assert.equal(compact.some((tool) => tool.name === "nyra_autopilot_enable"), true);
  assert.equal(compact.some((tool) => tool.name === "nyra_work_assignment_claim"), true);
  assert.equal(compact.some((tool) => tool.name === "nyra_work_assignment_submit"), true);
  assert.equal(compact.some((tool) => tool.name === "work_preflight"), false);
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
  assert.deepEqual(
    calls.interpret[0].args.work_preflight,
    preflightFixture(authenticated.tenantId).structuredContent.work_preflight,
  );
  assert.equal(payload.schema_version, "nyra_conversation_turn_v2");
  assert.equal(payload.tenant_id, "tenant-a");
  assert.equal(payload.identity_binding.authenticated, true);
  assert.equal(payload.identity_binding.caller_authority_accepted, false);
  assert.equal(payload.work.work_id, WORK_ID);
  assert.equal(payload.work.preflight_bound, true);
  assert.equal(payload.work.work_bound, true);
  assert.equal(payload.host_response_contract.speaker, "Nyra");
  assert.equal(payload.host_response_contract.renderer, "nyra_widget_with_host_fallback");
  assert.equal(payload.host_response_contract.response_language, "it");
  assert.match(payload.host_response_contract.reply_seed,
    /^Il Work può continuare dal suo stato verificato attuale\.\n\nAdesso: AI collegata — Respond conversationally\./);
  assert.equal(payload.work.next_action, "Answer the owner");
  assert.equal(payload.host_response_contract.next_action, "Respond conversationally");
  assert.match(payload.host_response_contract.reply_seed, /AI collegata — Respond conversationally/);
  assert.equal(payload.interpretation.core.authority, "V2");
  assert.equal(payload.interpretation.selected_action_id, "action:respond_conversationally");
  assert.equal(payload.interpretation.selected_action, "Respond conversationally");
  assert.equal(payload.interpretation.selected_action_available, true);
  assert.equal(payload.interpretation.risk_band, "low");
  assert.equal(payload.work.next_action_available, true);
  assert.equal(payload.orchestration_directive.source, "FRESH_CORE");
  assert.equal(payload.orchestration_directive.decision.disposition, "PROCEED_READ_ONLY");
  assert.equal(payload.orchestration_directive.ticket_request.required, false);
  assert.equal(payload.memory.relevant_count, 3);
  assert.equal(payload.execution_authorized, false);
  assert.equal(payload.external_action_authorized, false);
  assert.equal(payload.provider_execution, false);
  assert.equal(payload.provider_api_key_required, false);
  assert.equal(payload.server_model_calls, 0);
  assert.equal(payload.dynamic_capability.capability_id, "nyra_converse");
  assert.equal(response._meta.ui.resourceUri, NYRA_DIALOGUE_WIDGET_URI);
  assert.equal(response._meta["openai/outputTemplate"], NYRA_DIALOGUE_WIDGET_URI);
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
  assert.deepEqual(
    calls.interpret[0].args.work_preflight,
    preflightResult.structuredContent.work_preflight,
  );
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
  assert.equal(payload.orchestration_directive.decision.disposition, "PREPARE_BOUNDED_WORK");
  assert.equal(payload.orchestration_directive.can_continue, true);
  assert.equal(payload.orchestration_directive.ticket_request.required, true);
  assert.equal(payload.orchestration_directive.ticket_request.state, "NEEDS_CONTEXT");
  assert.equal(payload.orchestration_directive.ticket_request.action_class, "DEPLOY");
  assert.deepEqual(payload.action_policy.categories, ["release", "communication"]);
  assert.match(payload.host_response_contract.reply_seed, /Posso far avanzare la preparazione locale/);
  assert.match(payload.host_response_contract.reply_seed, /Il ticket resta in attesa/);
  assert.equal(JSON.stringify(response).includes("Deploy completato"), false);
  assert.equal(payload.execution_authorized, false);
  assert.equal(payload.external_action_authorized, false);
});

test("enforces bounded input before preflight or interpretation", async () => {
  const definition = TOOLS.find((tool) => tool.name === "nyra_converse");
  const tooLong = "x".repeat(MAX_MESSAGE_LENGTH + 1);
  const violations = validateToolArguments(definition.inputSchema, { message: tooLong });
  assert.equal(violations.some((item) => item.path === "$.message" && item.code === "max_length"), true);
  const operationViolations = validateToolArguments(definition.inputSchema, {
    message: "Nyra, prepara il merge",
    continuation_operation: "merge_and_deploy",
  });
  assert.equal(operationViolations.some((item) => (
    item.path === "$.continuation_operation" && item.code === "enum"
  )), true);

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

test("serializes the bounded server-issued next action but excludes unrelated upstream text", async () => {
  const marker = "SECRET_MARKER_9f83f572_unique";
  const preflight = preflightFixture();
  preflight.structuredContent.work_preflight.continuity.state = marker;
  preflight.structuredContent.work_preflight.nyra_control_context.work_state = marker;
  const interpretation = interpretationFixture("tenant-a", marker);
  interpretation.structuredContent.result.selected_by_core.primary_action_label = marker;
  interpretation.structuredContent.result.selected_by_core.primary_action_id = marker;
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
  assert.equal(payload.work.next_action, "Answer the owner");
  assert.equal(payload.host_response_contract.next_action, "Proceed in read-only analysis");
  assert.match(payload.host_response_contract.reply_seed, /AI collegata — Proceed in read-only analysis/);
  assert.equal(payload.interpretation.selected_action_available, false);
  assert.equal(payload.interpretation.selected_action_id, null);
  assert.equal(payload.interpretation.selected_action, null);
  assert.equal(payload.interpretation.risk_band, "low");
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
  assert.match(payload.host_response_contract.reply_seed, /Mi serve un solo Work canonico/);
  assert.doesNotMatch(payload.host_response_contract.reply_seed, /autenticato/);
  assert.match(payload.host_response_contract.instructions[2], /Do not claim/);
  assert.equal(payload.execution_authorized, false);
  assert.equal(payload.external_action_authorized, false);
});

test("offers an opaque two-phase V2 bootstrap reference only for an explicit structured new Work", async () => {
  const preflight = preflightFixture();
  delete preflight.structuredContent.work_preflight.continuity.work_id;
  delete preflight.structuredContent.work_preflight.nyra_control_context.work_id;
  preflight.structuredContent.work_preflight.tenant_work_gallery.work_count = 0;
  const caller = identity();
  caller.agentPresence.session_fingerprint = "f".repeat(64);
  caller.authenticatedHostPrincipal = {
    schema_version: "authenticated_host_principal_v1",
    registered: true,
    registry_revision: "a".repeat(64),
    app_id: "chatgpt_prod",
    auth_kind: "oauth",
    host_kind: "chatgpt_native",
    client_type: "chatgpt",
    interaction_mode: "nyra_conversational",
    capabilities: ["work.read", "work.create", "governed_continue"],
  };
  const candidates = [];
  const { handler } = harness({
    preflightResult: preflight,
    openContinuation: async ({ directive }) => {
      candidates.push(directive);
      return {
        schema_version: "nyra_continuation_ref_v1",
        available: true,
        continuation_ref: `nyc1_${"a".repeat(40)}`,
        expires_at: "2026-08-25T12:05:00.000Z",
        state: "READY",
        reason: null,
      };
    },
  });
  const workBootstrap = {
    request_id: "entity-360-bootstrap-001",
    work_name: "Entità 360",
    work_type: "software_git",
    idea: "Build the governed Entity 360 context layer",
    objective: "Create the canonical Entity 360 Work without duplicates",
    architecture: { layer: "context_evidence" },
    next_action: "Review the canonical architecture",
    acceptance_criteria: ["The Work has one persistent identity"],
    constraints: ["Universal Core remains final authority"],
    tasks: [{ title: "Review architecture", required: true }],
  };
  const response = await handler({
    message: "Nyra, crea il nuovo Work Entità 360",
    project_id: "nyra_core",
    work_bootstrap: workBootstrap,
    locale: "it",
  }, caller);
  const payload = response.structuredContent;
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].ticket_request.state, "WORK_BOOTSTRAP_READY");
  assert.equal(candidates[0].ticket_request.action_class, "WORK_BOOTSTRAP");
  assert.match(candidates[0].ticket_request.work_bootstrap_request_digest, /^[a-f0-9]{64}$/);
  assert.equal(payload.orchestration_directive.decision.disposition, "REQUEST_WORK_BOOTSTRAP");
  assert.equal(payload.action_policy.work_bootstrap_requested, true);
  assert.equal(payload.action_policy.work_bootstrap_spec_provided, true);
  assert.equal(payload.orchestration_directive.ticket_request.continuation.available, true);
  assert.match(payload.orchestration_directive.ticket_request.continuation.continuation_ref, /^nyc1_/);
  assert.equal(Object.hasOwn(payload.orchestration_directive.ticket_request.continuation, "candidate_attestation"), false);
  assert.equal(payload.orchestration_directive.execution_authorized, false);
  assert.equal(payload.external_action_authorized, false);
  const definition = TOOLS.find((tool) => tool.name === "nyra_converse");
  assert.deepEqual(validateToolArguments(definition.outputSchema, payload), []);
});

test("keeps an explicit structured bootstrap ahead of merge or deploy words in its prose", async () => {
  const preflight = preflightFixture();
  delete preflight.structuredContent.work_preflight.continuity.work_id;
  delete preflight.structuredContent.work_preflight.nyra_control_context.work_id;
  preflight.structuredContent.work_preflight.tenant_work_gallery.work_count = 0;
  const caller = identity();
  caller.agentPresence.session_fingerprint = "f".repeat(64);
  caller.authenticatedHostPrincipal = {
    schema_version: "authenticated_host_principal_v1",
    registered: true,
    registry_revision: "a".repeat(64),
    app_id: "chatgpt_prod",
    auth_kind: "oauth",
    host_kind: "chatgpt_native",
    client_type: "chatgpt",
    interaction_mode: "nyra_conversational",
    capabilities: ["work.read", "work.create", "governed_continue"],
  };
  const handler = createNyraConverseHandler({
    preflight: async () => preflight,
    interpret: async () => interpretationFixture(),
  });
  const response = await handler({
    message: "Crea un nuovo Work; dopo la review potremo fare merge e deploy.",
    project_id: "nyra_core",
    work_bootstrap: {
      request_id: "typed-bootstrap-precedence-001",
      work_name: "Review first",
      work_type: "software_git",
      idea: "Review before any release",
      objective: "Produce a governed review candidate",
      architecture: {},
      next_action: "Review the candidate",
      acceptance_criteria: ["Core reviews the candidate first"],
      constraints: [],
      tasks: [{ title: "Review", required: true }],
    },
    locale: "it",
  }, caller);
  assert.equal(response.structuredContent.action_policy.action_class, "WORK_BOOTSTRAP");
  assert.equal(response.structuredContent.action_policy.work_bootstrap_requested, true);
  assert.equal(response.structuredContent.action_policy.consequential_request_detected, true);
  assert.equal(response.structuredContent.execution_authorized, false);
});

test("an existing canonical Work wins over an explicit create request and no bootstrap candidate is issued", async () => {
  const caller = identity();
  caller.agentPresence.session_fingerprint = "f".repeat(64);
  caller.authenticatedHostPrincipal = {
    schema_version: "authenticated_host_principal_v1",
    registered: true,
    registry_revision: "a".repeat(64),
    app_id: "future_ai",
    auth_kind: "oauth",
    host_kind: "future_ai_native",
    client_type: "other",
    interaction_mode: "nyra_conversational",
    capabilities: ["work.read", "work.create", "governed_continue"],
  };
  let candidates = 0;
  const { handler } = harness({
    directiveContext: directiveContextFixture(),
    openContinuation: async () => {
      candidates += 1;
      return null;
    },
  });
  const response = await handler({
    message: "Nyra, crea un nuovo Work",
    work_id: WORK_ID,
    project_id: "nyra_core",
    work_bootstrap: {
      request_id: "duplicate-attempt-001",
      work_name: "Duplicate",
      work_type: "generic",
      idea: "Duplicate",
      objective: "Duplicate",
      architecture: {},
      next_action: "Do nothing",
      acceptance_criteria: ["No duplicate"],
      tasks: [{ title: "Do not create" }],
    },
  }, caller);
  assert.equal(response.structuredContent.work.work_id, WORK_ID);
  assert.equal(response.structuredContent.orchestration_directive.ticket_request.required, false);
  assert.equal(response.structuredContent.orchestration_directive.decision.disposition, "PROCEED_READ_ONLY");
  assert.equal(candidates, 1, "the signer may be consulted but must receive a NOT_REQUIRED directive");
  assert.equal(response.structuredContent.orchestration_directive.ticket_request.continuation.available, false);
});
