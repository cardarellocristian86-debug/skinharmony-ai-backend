import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableCanonical(value[key]);
    return result;
  }, {});
}

function ownerRequestBinding(purpose, body) {
  return `${purpose}\u0000${JSON.stringify(stableCanonical(body))}`;
}

function signedBoundOwnerContext({ tenantId, signingSecret, purpose, body }) {
  const context = {
    assertion_version: "owner_context_assertion_v1",
    audience: "nira_core_bridge",
    tenant_id: tenantId,
    access_mode: "tenant_owner",
    role: "tenant_owner",
    delegated_actor: "oauth",
    owner_verified: true,
    owner_subject_fingerprint: `osf_${"b".repeat(64)}`,
    issued_at: new Date().toISOString(),
    binding_version: "owner_request_binding_v1",
    binding_hash: crypto.createHash("sha256").update(ownerRequestBinding(purpose, body)).digest("hex"),
    approval_digest: "test_approval_digest",
  };
  const canonical = JSON.stringify({
    version: context.assertion_version,
    audience: context.audience,
    tenant_id: context.tenant_id,
    access_mode: context.access_mode,
    role: context.role,
    delegated_actor: context.delegated_actor,
    owner_verified: context.owner_verified,
    owner_subject_fingerprint: context.owner_subject_fingerprint,
    issued_at: context.issued_at,
    binding_version: context.binding_version,
    binding_hash: context.binding_hash,
    approval_digest: context.approval_digest,
  });
  return {
    ...context,
    assertion: `ocs_${crypto.createHmac("sha256", signingSecret)
      .update(`owner-context\u0000${canonical}`)
      .digest("hex")}`,
  };
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function request(base, method, pathname, body, key) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

function responseFor(stage) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        output: [{ content: [{ type: "output_text", text: `safe-stage-${stage}-output` }] }],
        usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
      };
    },
  };
}

async function waitFor(check, { timeoutMs = 1_500, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`condition_not_met_before_timeout: ${JSON.stringify(last)}`);
}

async function createFixture({ openAiFetchImpl }) {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "tenant-openai-multiagent-api-admin";
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "core-tenant-openai-multiagent-api-"));
  const signingSecret = "tenant-openai-multiagent-owner-context-signing-secret";
  const fakeProviderKey = "tenant-openai-test-credential-sentinel";
  const tenantProviderCredentials = {
    async status({ tenant_id: tenantId }) {
      return tenantId === "tenant-openai-a"
        ? { provider: "openai", configured: true, key_hint: "sk-…7890", execution_enabled: false }
        : { provider: "openai", configured: false, execution_enabled: false };
    },
    async getOpenAiForExecution({ tenant_id: tenantId }) {
      if (tenantId !== "tenant-openai-a") return null;
      return fakeProviderKey;
    },
  };
  const service = createUniversalCoreService({
    storageRoot,
    ownerContextSigningSecret: signingSecret,
    tenantProviderCredentials,
    tenantOpenAiModel: "gpt-test-tenant-bounded",
    openAiFetchImpl,
  });
  const { server, base } = await listen(service.app);
  const adminKey = "tenant-openai-multiagent-api-admin";
  const keyA = await request(base, "POST", "/v1/keys/generate", {
    tenant_id: "tenant-openai-a",
    preset: "codex_automation",
  }, adminKey);
  const keyB = await request(base, "POST", "/v1/keys/generate", {
    tenant_id: "tenant-openai-b",
    preset: "codex_automation",
  }, adminKey);
  assert.equal(keyA.status, 201);
  assert.equal(keyB.status, 201);

  return {
    base,
    keyA: keyA.json.key,
    keyB: keyB.json.key,
    signingSecret,
    fakeProviderKey,
    storageRoot,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
      else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
    },
  };
}

function startBody({ task, confirmationReference, signingSecret }) {
  const body = {
    tenant_id: "tenant-openai-a",
    task,
    owner_confirmed: true,
    confirmation_reference: confirmationReference,
  };
  return {
    ...body,
    owner_context: signedBoundOwnerContext({
      tenantId: "tenant-openai-a",
      signingSecret,
      purpose: "tenant_openai_multiagent_run",
      body,
    }),
  };
}

function ownerRunBody({ runId, signingSecret, purpose }) {
  const body = { tenant_id: "tenant-openai-a", run_id: runId };
  return {
    ...body,
    owner_context: signedBoundOwnerContext({
      tenantId: "tenant-openai-a",
      signingSecret,
      purpose,
      body,
    }),
  };
}

test("tenant OpenAI multi-agent POST is asynchronous, status hides output, result requires a bound owner proof, and confirmation cannot be replayed", async () => {
  const calls = [];
  const fixture = await createFixture({
    openAiFetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), authorization: init.headers.authorization });
      return responseFor(calls.length);
    },
  });

  try {
    const configured = await request(fixture.base, "GET", "/v1/generic-agents/providers/openai", undefined, fixture.keyA);
    assert.equal(configured.status, 200);
    assert.equal(configured.json.provider.configured, true);
    assert.equal(configured.json.provider.execution_enabled, false);
    assert.equal(configured.json.provider.execution_available, true);

    const task = "Valuta un piano di lavoro locale in tre fasi.";
    const confirmationReference = "Owner conferma il test limitato a tre chiamate.";
    const body = startBody({ task, confirmationReference, signingSecret: fixture.signingSecret });
    const started = await request(
      fixture.base,
      "POST",
      "/v1/generic-agents/providers/openai/multi-agent-runs",
      body,
      fixture.keyA,
    );
    assert.equal(started.status, 202);
    assert.equal(started.json.ok, true);
    assert.equal(started.json.governance.owner_confirmation_satisfied, true);
    assert.equal(started.json.run.status, "running");
    assert.match(started.json.run.run_id, /^run_/);
    assert.equal(Object.hasOwn(started.json.run, "final_output"), false);
    assert.equal(started.json.run.stages.some((stage) => Object.hasOwn(stage, "output")), false);

    // The same signed confirmation is a one-use charge authorization, even
    // when the original run is still executing or has already completed.
    const replay = await request(
      fixture.base,
      "POST",
      "/v1/generic-agents/providers/openai/multi-agent-runs",
      body,
      fixture.keyA,
    );
    assert.equal(replay.status, 409);
    assert.equal(replay.json.error, "owner_confirmation_replayed");

    const publicStatus = await waitFor(async () => {
      const status = await request(
        fixture.base,
        "GET",
        `/v1/generic-agents/providers/openai/multi-agent-runs/${started.json.run.run_id}`,
        undefined,
        fixture.keyA,
      );
      return status.status === 200 && status.json.run.status === "completed" ? status : null;
    });
    assert.equal(Object.hasOwn(publicStatus.json.run, "final_output"), false);
    assert.equal(publicStatus.json.run.stages.some((stage) => Object.hasOwn(stage, "output")), false);
    assert.equal(JSON.stringify(publicStatus.json).includes("safe-stage-"), false);

    const result = await request(
      fixture.base,
      "POST",
      `/v1/generic-agents/providers/openai/multi-agent-runs/${started.json.run.run_id}/result`,
      ownerRunBody({
        runId: started.json.run.run_id,
        signingSecret: fixture.signingSecret,
        purpose: "tenant_openai_multiagent_read",
      }),
      fixture.keyA,
    );
    assert.equal(result.status, 200);
    assert.equal(result.json.run.status, "completed");
    assert.equal(result.json.run.final_output, "safe-stage-3-output");
    assert.deepEqual(result.json.run.stages.map((stage) => stage.output), [
      "safe-stage-1-output",
      "safe-stage-2-output",
      "safe-stage-3-output",
    ]);

    assert.equal(calls.length, 3);
    for (const call of calls) {
      assert.equal(call.url, "https://api.openai.com/v1/responses");
      assert.equal(call.body.model, "gpt-test-tenant-bounded");
      assert.equal(call.body.store, false);
      assert.equal(call.body.max_output_tokens, 200);
      assert.equal(Object.hasOwn(call.body, "tools"), false);
      assert.equal(Object.hasOwn(call.body, "tool_choice"), false);
      assert.equal(call.authorization, `Bearer ${fixture.fakeProviderKey}`);
    }
    assert.match(calls[0].body.instructions, /Researcher/);
    assert.match(calls[1].body.instructions, /Reviewer/);
    assert.match(calls[2].body.instructions, /Nyra/);

    const serializedResponse = JSON.stringify(result.json);
    const auditLog = fs.readFileSync(path.join(fixture.storageRoot, "audit", "events.jsonl"), "utf8");
    assert.equal(serializedResponse.includes(fixture.fakeProviderKey), false);
    assert.equal(auditLog.includes(fixture.fakeProviderKey), false);
    assert.equal(auditLog.includes(task), false);

    const crossTenantRead = await request(
      fixture.base,
      "GET",
      `/v1/generic-agents/providers/openai/multi-agent-runs/${started.json.run.run_id}`,
      undefined,
      fixture.keyB,
    );
    assert.equal(crossTenantRead.status, 403);
    assert.equal(crossTenantRead.json.error, "cross_tenant_run_denied");
  } finally {
    await fixture.close();
  }
});

test("tenant OpenAI multi-agent cancel aborts a delayed provider request before a downstream worker can begin", async () => {
  let fetchStartedResolve;
  const fetchStarted = new Promise((resolve) => { fetchStartedResolve = resolve; });
  let fetchAbortedResolve;
  const fetchAborted = new Promise((resolve) => { fetchAbortedResolve = resolve; });
  const calls = [];
  const fixture = await createFixture({
    openAiFetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), signal: init.signal });
      fetchStartedResolve();
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          fetchAbortedResolve();
          reject(new Error("test_provider_request_aborted"));
        }, { once: true });
      });
    },
  });

  try {
    const started = await request(
      fixture.base,
      "POST",
      "/v1/generic-agents/providers/openai/multi-agent-runs",
      startBody({
        task: "Valuta un solo rischio, senza strumenti esterni.",
        confirmationReference: "Owner conferma il test di annullamento.",
        signingSecret: fixture.signingSecret,
      }),
      fixture.keyA,
    );
    assert.equal(started.status, 202);
    const runId = started.json.run.run_id;
    await fetchStarted;
    assert.equal(calls.length, 1);

    const cancelled = await request(
      fixture.base,
      "POST",
      `/v1/generic-agents/providers/openai/multi-agent-runs/${runId}/cancel`,
      ownerRunBody({ runId, signingSecret: fixture.signingSecret, purpose: "tenant_openai_multiagent_cancel" }),
      fixture.keyA,
    );
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.json.run.status, "cancelled");
    assert.equal(cancelled.json.run.kill_signal.propagated, true);
    await fetchAborted;

    const publicStatus = await waitFor(async () => {
      const status = await request(
        fixture.base,
        "GET",
        `/v1/generic-agents/providers/openai/multi-agent-runs/${runId}`,
        undefined,
        fixture.keyA,
      );
      return status.status === 200 && status.json.run.status === "cancelled" ? status : null;
    });
    assert.equal(Object.hasOwn(publicStatus.json.run, "final_output"), false);
    assert.equal(publicStatus.json.run.stages.some((stage) => Object.hasOwn(stage, "output")), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].signal.aborted, true);
  } finally {
    await fixture.close();
  }
});
