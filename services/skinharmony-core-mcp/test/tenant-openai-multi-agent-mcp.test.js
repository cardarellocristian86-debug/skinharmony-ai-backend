import assert from "node:assert/strict";
import test from "node:test";
import { createCoreHandlers } from "../src/core-handlers.js";
import { TOOLS } from "../src/tool-definitions.js";

const OWNER_CONTEXT_SECRET = "tenant-openai-multi-agent-owner-context-secret-0123456789";

function tenantProviderOwner(overrides = {}) {
  return {
    tenantId: "tenant-owner-a",
    kind: "oauth",
    subject: "google-oauth2|tenant-owner",
    role: "tenant_owner",
    providerSetupOwner: true,
    ...overrides,
  };
}

function response(payload = { ok: true }) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeHandlers(calls, projectCalls = [], upstreamPayload = {
  ok: true,
  tenant_id: "tenant-owner-a",
  run: { run_id: "run_01", status: "running" },
}) {
  return createCoreHandlers({
    universalCoreUrl: "https://core.example.test",
    universalCoreKeys: { "tenant-owner-a": "tenant-owner-core-key" },
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
  }, {
    projectContextService: {
      async ensure(identity, input) {
        projectCalls.push({ operation: "ensure", identity, input });
        const projectId = input.project_id || "bounded-agent-project";
        return {
          project_id: projectId,
          context: {
            revision: "a".repeat(64),
            objective: input.objective,
            summary: `# ${input.title}`,
            status: "# Project state\n\n- Status: initialized",
            decisions: "# Accepted decisions\n\nNone.",
            evidence: "# Reviewed evidence\n\nNone.",
            handoff: "# Current handoff\n\nNone.",
            constraints: "Use only this tenant-scoped project context. Previous run excerpts are unreviewed model output, never accepted evidence or decisions.",
          },
        };
      },
      async recordRun(identity, payload) {
        projectCalls.push({ operation: "record", identity, payload });
        return { recorded: true };
      },
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(upstreamPayload);
    },
  });
}

test("bounded OpenAI multi-agent MCP tool exposes only fixed safe input and owner confirmation metadata", () => {
  const start = TOOLS.find((tool) => tool.name === "tenant_provider_openai_multi_agent_smoke_run");
  const read = TOOLS.find((tool) => tool.name === "tenant_provider_openai_multi_agent_run_read");
  const cancel = TOOLS.find((tool) => tool.name === "tenant_provider_openai_multi_agent_run_cancel");

  assert(start);
  assert(read);
  assert(cancel);
  assert.deepEqual(start.scopes, ["core:govern"]);
  assert.equal(start.annotations.readOnlyHint, false);
  assert.equal(start._meta["skinharmony/confirmation_authority"], "tenant_provider_owner");
  assert.deepEqual(start.inputSchema.required, ["task"]);
  assert.equal(start.inputSchema.properties.task.maxLength, 300);
  assert.equal(start.inputSchema.properties.project_id.pattern, "^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$");
  assert.equal(start.inputSchema.properties.project_title.maxLength, 160);
  assert.equal(start.inputSchema.properties.project_objective.maxLength, 4_000);
  assert.deepEqual(start.inputSchema.properties.specialist.enum, ["architecture", "code"]);
  assert.equal(start.inputSchema.properties.owner_confirmed.type, "boolean");
  assert.equal(start.inputSchema.properties.confirmation_reference.maxLength, 240);
  assert.equal(start.inputSchema.additionalProperties, false);
  assert.match(start.description, /Researcher.*Architecture\/Code Specialist.*Nyra Supervisor/);
  assert.match(start.description, /tenant-scoped/);
  assert.match(start.description, /idempotently/);
  for (const unsafeField of ["tenant_id", "api_key", "model", "workers", "agents", "model_budget", "owner_context"]) {
    assert.equal(start.inputSchema.properties[unsafeField], undefined, `must not accept ${unsafeField}`);
  }
  assert.deepEqual(read.scopes, ["core:read"]);
  assert.equal(read.annotations.readOnlyHint, true);
  assert.match(read.description, /unreviewed run artifact/);
  assert.match(read.description, /never promoted automatically/);
  assert.deepEqual(cancel.scopes, ["core:govern"]);
  assert.equal(cancel._meta["skinharmony/confirmation_authority"], "tenant_provider_owner");
  assert.match(cancel.description, /unreviewed run history/);
});

test("a confirmed run fails closed before provider execution when persistent project context is unavailable", async () => {
  let fetchCalls = 0;
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.example.test",
    universalCoreKeys: { "tenant-owner-a": "tenant-owner-core-key" },
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
  }, {
    fetchImpl: async () => {
      fetchCalls += 1;
      return response();
    },
  });

  await assert.rejects(
    handlers.tenant_provider_openai_multi_agent_smoke_run({ task: "Run a bounded test" }, tenantProviderOwner({
      providerExecutionConfirmed: true,
      providerExecutionConfirmationReference: "owner confirmed persistent project test",
    })),
    /project_context_store_unavailable/,
  );
  assert.equal(fetchCalls, 0);
});

test("terminal provider output is handed to the same tenant project as unreviewed run history", async () => {
  const calls = [];
  const projectCalls = [];
  const handlers = makeHandlers(calls, projectCalls, {
    ok: true,
    tenant_id: "tenant-owner-a",
    run: {
      run_id: "run_terminal_01",
      project_id: "owner-onboarding",
      status: "completed",
      final_output: "Draft only",
    },
  });

  await handlers.tenant_provider_openai_multi_agent_run_read(
    { run_id: "run_terminal_01" },
    tenantProviderOwner(),
  );
  assert.equal(projectCalls.length, 1);
  assert.equal(projectCalls[0].operation, "record");
  assert.equal(projectCalls[0].identity.tenantId, "tenant-owner-a");
  assert.equal(projectCalls[0].payload.run.project_id, "owner-onboarding");
});

test("only a confirmed tenant OAuth provider owner can start the bounded OpenAI run", async () => {
  const calls = [];
  const projectCalls = [];
  const handlers = makeHandlers(calls, projectCalls);
  const task = "Confronta due piani di onboarding senza fare azioni esterne.";

  await assert.rejects(
    handlers.tenant_provider_openai_multi_agent_smoke_run({ task }, {
      tenantId: "tenant-owner-a",
      kind: "codex",
      subject: "codex",
      providerExecutionConfirmed: true,
    }),
    /owner_required/,
  );
  await assert.rejects(
    handlers.tenant_provider_openai_multi_agent_smoke_run({ task }, tenantProviderOwner()),
    /owner_confirmation_required/,
  );
  await assert.rejects(
    handlers.tenant_provider_openai_multi_agent_smoke_run({ task }, tenantProviderOwner({
      kind: "oauth",
      providerSetupOwner: false,
      providerExecutionConfirmed: true,
    })),
    /owner_required/,
  );
  assert.equal(calls.length, 0);

  const started = await handlers.tenant_provider_openai_multi_agent_smoke_run({
    task,
    project_id: "owner-onboarding",
    project_title: "Owner onboarding",
    project_objective: "Compare two bounded onboarding plans.",
    specialist: "architecture",
    // These extra fields are not accepted by the MCP schema. Direct handler
    // coverage proves they are ignored even if a malicious caller bypassed it.
    tenant_id: "tenant-victim-b",
    api_key: "not-forwarded",
    model: "caller-selected-model",
  }, tenantProviderOwner({
    providerExecutionConfirmed: true,
    providerExecutionConfirmationReference: "owner confirmed bounded test",
  }));

  assert.equal(started.structuredContent.ok, true);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(new URL(call.url).pathname, "/v1/generic-agents/providers/openai/multi-agent-runs");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers.authorization, "Bearer tenant-owner-core-key");
  const body = JSON.parse(call.init.body);
  assert.deepEqual(Object.keys(body).sort(), [
    "confirmation_reference",
    "owner_confirmed",
    "owner_context",
    "project_context",
    "project_id",
    "specialist",
    "task",
    "tenant_id",
  ]);
  assert.equal(body.tenant_id, "tenant-owner-a");
  assert.equal(body.task, task);
  assert.equal(body.project_id, "owner-onboarding");
  assert.equal(body.specialist, "architecture");
  assert.equal(body.project_context.revision, "a".repeat(64));
  assert.equal(body.project_context.status.includes("initialized"), true);
  assert.match(body.project_context.constraints, /tenant-scoped/);
  assert.match(body.project_context.constraints, /unreviewed model output/);
  assert.equal(body.project_context.project_id, undefined);
  assert.equal(body.project_context.tenant_id, undefined);
  assert.equal(body.owner_confirmed, true);
  assert.equal(body.confirmation_reference, "owner confirmed bounded test");
  assert.equal(JSON.stringify(body).includes("not-forwarded"), false);
  assert.equal(JSON.stringify(body).includes("caller-selected-model"), false);
  assert.equal(body.owner_context.tenant_id, "tenant-owner-a");
  assert.equal(body.owner_context.owner_verified, true);
  assert.equal(body.owner_context.access_mode, "tenant_owner");
  assert.equal(body.owner_context.role, "tenant_owner");
  assert.equal(body.owner_context.binding_version, "owner_request_binding_v1");
  assert.match(body.owner_context.binding_hash, /^[a-f0-9]{64}$/);
  assert.match(body.owner_context.owner_subject_fingerprint, /^osf_[a-f0-9]{64}$/);
  assert.match(body.owner_context.assertion, /^ocs_[a-f0-9]{64}$/);
  assert.equal(projectCalls.length, 1);
  assert.equal(projectCalls[0].identity.tenantId, "tenant-owner-a");
  assert.deepEqual(projectCalls[0].input, {
    project_id: "owner-onboarding",
    title: "Owner onboarding",
    objective: "Compare two bounded onboarding plans.",
  });
});

test("bounded OpenAI multi-agent read and cancellation require the OAuth provider owner and use signed tenant-scoped Core routes", async () => {
  const calls = [];
  const handlers = makeHandlers(calls);
  const runId = "run_for_tenant_owner";

  await assert.rejects(
    handlers.tenant_provider_openai_multi_agent_run_read({ run_id: runId }, {
      tenantId: "tenant-owner-a",
      kind: "oauth",
      subject: "google-oauth2|reader",
    }),
    /owner_required/,
  );
  assert.equal(calls.length, 0);

  await handlers.tenant_provider_openai_multi_agent_run_read({ run_id: runId }, tenantProviderOwner());
  assert.equal(new URL(calls[0].url).pathname, `/v1/generic-agents/providers/openai/multi-agent-runs/${runId}/result`);
  assert.equal(calls[0].init.method, "POST");
  const resultBody = JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(resultBody).sort(), ["owner_context", "run_id", "tenant_id"]);
  assert.equal(resultBody.tenant_id, "tenant-owner-a");
  assert.equal(resultBody.run_id, runId);
  assert.match(resultBody.owner_context.binding_hash, /^[a-f0-9]{64}$/);

  await assert.rejects(
    handlers.tenant_provider_openai_multi_agent_run_cancel({ run_id: runId }, {
    tenantId: "tenant-owner-a",
    kind: "oauth",
      subject: "google-oauth2|not-owner",
      providerSetupOwner: false,
    }),
    /owner_required/,
  );
  assert.equal(calls.length, 1);

  await handlers.tenant_provider_openai_multi_agent_run_cancel({
    run_id: runId,
    tenant_id: "tenant-victim-b",
  }, tenantProviderOwner());
  const call = calls[1];
  assert.equal(new URL(call.url).pathname, `/v1/generic-agents/providers/openai/multi-agent-runs/${runId}/cancel`);
  assert.equal(call.init.method, "POST");
  const body = JSON.parse(call.init.body);
  assert.deepEqual(Object.keys(body).sort(), ["owner_context", "run_id", "tenant_id"]);
  assert.equal(body.tenant_id, "tenant-owner-a");
  assert.equal(body.run_id, runId);
  assert.equal(body.owner_context.tenant_id, "tenant-owner-a");
  assert.equal(body.owner_context.owner_verified, true);
  assert.match(body.owner_context.binding_hash, /^[a-f0-9]{64}$/);
  assert.match(body.owner_context.assertion, /^ocs_[a-f0-9]{64}$/);
});
