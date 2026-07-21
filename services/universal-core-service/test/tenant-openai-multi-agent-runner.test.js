import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAudit } from "../src/audit.js";
import { createGenericAgentCheckpointStore } from "../src/genericAgentCheckpointStore.js";
import { createGenericAgentOrchestrationStore } from "../src/genericAgentOrchestrationStore.js";
import { createGenericAgentOrchestrator } from "../src/genericAgentOrchestrator.js";
import { createGenericAgentRuntime } from "../src/genericAgentRuntime.js";
import { createGovernedAgentBudgetStore } from "../src/governedAgentBudgetStore.js";
import { createTenantOpenAiMultiAgentRunner } from "../src/tenantOpenAiMultiAgentRunner.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fixture({ fetchImpl, tenantProviderCredentials, clock, maxActiveRuns, deadlineMs } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tenant-openai-multiagent-"));
  const audit = createAudit(root);
  const genericAgentRuntime = createGenericAgentRuntime();
  const genericAgentOrchestrator = createGenericAgentOrchestrator({ maxConcurrent: 1, maxWorkers: 3, maxBranchDepth: 3 });
  const genericAgentOrchestrationStore = createGenericAgentOrchestrationStore({ root: path.join(root, "plans") });
  const genericAgentCheckpointStore = createGenericAgentCheckpointStore({ root: path.join(root, "checkpoints") });
  const governedAgentBudgetStore = createGovernedAgentBudgetStore({ root: path.join(root, "budget") });
  return {
    root,
    audit,
    genericAgentCheckpointStore,
    genericAgentOrchestrationStore,
    governedAgentBudgetStore,
    runner: createTenantOpenAiMultiAgentRunner({
      tenantProviderCredentials: tenantProviderCredentials || {
        async getOpenAiForExecution() { return "test-openai-key-not-a-secret"; },
      },
      genericAgentRuntime,
      genericAgentOrchestrator,
      genericAgentOrchestrationStore,
      genericAgentCheckpointStore,
      governedAgentBudgetStore,
      audit,
      fetchImpl,
      model: "gpt-test-bounded",
      clock,
      maxActiveRuns,
      deadlineMs,
    }),
  };
}

test("tenant OpenAI runner makes exactly three bounded sequential Responses calls without persisting the credential", async () => {
  const requests = [];
  const { root, audit, runner } = fixture({
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url, body, headers: init.headers });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            output: [{ content: [{ type: "output_text", text: `stage-${requests.length}` }] }],
            usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
          };
        },
      };
    },
  });

  const result = await runner.run({ tenant_id: "tenant-a", task: "Valuta un piano editoriale senza eseguire alcuna azione." });

  assert.equal(result.status, "completed");
  assert.equal(result.model_usage.model_calls, 3);
  assert.equal(result.model_usage.reserved_tokens, 3_600);
  assert.equal(result.stages.filter((stage) => stage.status === "completed").length, 3);
  assert.equal(result.final_output, "stage-3");
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.url, "https://api.openai.com/v1/responses");
    assert.equal(request.body.model, "gpt-test-bounded");
    assert.equal(request.body.store, false);
    assert.equal(request.body.max_output_tokens, 200);
    assert.equal(Object.hasOwn(request.body, "tools"), false);
    assert.equal(Object.hasOwn(request.body, "tool_choice"), false);
  }
  assert.match(requests[1].body.input, /stage-1/);
  assert.match(requests[2].body.input, /stage-1/);
  assert.match(requests[2].body.input, /stage-2/);

  const auditText = fs.readFileSync(path.join(root, "audit", "events.jsonl"), "utf8");
  assert.equal(auditText.includes("test-openai-key-not-a-secret"), false);
  assert.equal(auditText.includes("Valuta un piano editoriale"), false);
  assert.equal(JSON.stringify(result).includes("test-openai-key-not-a-secret"), false);
  assert.equal(audit.recent().some((event) => event.event_type === "tenant_openai_multi_agent_completed"), true);
});

test("tenant OpenAI runner redacts a secret-like provider response before retaining it", async () => {
  const { audit, runner } = fixture({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          output_text: "Risultato: sk-proj-abcdefghijklmnopqrstuvwx",
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        };
      },
    }),
  });

  const result = await runner.run({ tenant_id: "tenant-a", task: "Valuta una proposta in modo prudente." });
  assert.equal(result.status, "completed");
  assert.match(result.final_output, /\[REDACTED_SECRET\]/);
  assert.equal(JSON.stringify(result).includes("sk-proj-abcdefghijklmnopqrstuvwx"), false);
  assert.equal(JSON.stringify(audit.recent()).includes("sk-proj-abcdefghijklmnopqrstuvwx"), false);
});

test("tenant OpenAI runner aborts the in-flight call and all downstream stages on cancellation", async () => {
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  let callCount = 0;
  const { audit, runner } = fixture({
    fetchImpl: async (_url, init) => {
      callCount += 1;
      started();
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
  });

  const execution = runner.run({ tenant_id: "tenant-a", task: "Testa l'arresto immediato dei tre agenti." });
  await startedPromise;
  const startedAudit = audit.recent().find((event) => event.event_type === "tenant_openai_multi_agent_started");
  assert.ok(startedAudit?.run_id);

  const cancelled = runner.cancel({ tenant_id: "tenant-a", run_id: startedAudit.run_id });
  const result = await execution;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.kill_signal.propagated, true);
  assert.equal(result.status, "cancelled");
  assert.equal(callCount, 1);
  assert.equal(result.stages.filter((stage) => stage.status === "completed").length, 0);
  assert.throws(
    () => runner.get({ tenant_id: "tenant-b", run_id: startedAudit.run_id }),
    /cross_tenant_run_denied/,
  );
});

test("tenant OpenAI runner start returns before the vault resolves and cancellation prevents every model call", async () => {
  const vault = deferred();
  let fetchCalls = 0;
  const { governedAgentBudgetStore, runner } = fixture({
    tenantProviderCredentials: {
      getOpenAiForExecution() { return vault.promise; },
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("a cancelled run must not reach OpenAI");
    },
  });

  const started = runner.start({
    tenant_id: "tenant-start-cancel",
    task: "Verifica che l'avvio sia annullabile prima della chiamata al modello.",
  });
  assert.match(started.run_id, /^run_/);
  assert.equal(started.status, "running");
  assert.equal(fetchCalls, 0);

  const completion = runner.wait({ tenant_id: "tenant-start-cancel", run_id: started.run_id });
  const cancelled = runner.cancel({ tenant_id: "tenant-start-cancel", run_id: started.run_id });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.kill_signal.propagated, true);

  vault.resolve("tenant-openai-key-delayed-sentinel");
  const result = await completion;
  assert.equal(result.status, "cancelled");
  assert.equal(fetchCalls, 0);
  assert.equal(result.stages.filter((stage) => stage.status === "completed").length, 0);
  assert.equal(governedAgentBudgetStore.get({ tenant_id: "tenant-start-cancel" }).workflows, 0);
});

test("tenant OpenAI runner admits only one concurrent run per tenant before a delayed vault resolves", async () => {
  const vault = deferred();
  let vaultCalls = 0;
  const { runner } = fixture({
    tenantProviderCredentials: {
      getOpenAiForExecution() {
        vaultCalls += 1;
        return vault.promise;
      },
    },
    fetchImpl: async () => {
      throw new Error("the test cancels before any provider call");
    },
  });

  const first = runner.start({
    tenant_id: "tenant-concurrency",
    task: "Mantieni un solo workflow attivo per tenant.",
  });
  await Promise.resolve();
  assert.equal(vaultCalls, 1);
  assert.throws(
    () => runner.start({
      tenant_id: "tenant-concurrency",
      task: "Questo secondo workflow non deve essere ammesso.",
    }),
    /tenant_multi_agent_run_in_progress/,
  );

  const completion = runner.wait({ tenant_id: "tenant-concurrency", run_id: first.run_id });
  runner.cancel({ tenant_id: "tenant-concurrency", run_id: first.run_id });
  vault.resolve("tenant-openai-key-concurrency-sentinel");
  const result = await completion;
  assert.equal(result.status, "cancelled");
  assert.equal(vaultCalls, 1);
});

test("tenant OpenAI runner discards a response whose json body is still pending when the owner cancels", async () => {
  const jsonStarted = deferred();
  const jsonPayload = deferred();
  const outputSentinel = "MODEL_OUTPUT_MUST_NOT_SURVIVE_CANCEL";
  let fetchCalls = 0;
  const { genericAgentCheckpointStore, runner } = fixture({
    fetchImpl: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        json() {
          jsonStarted.resolve();
          return jsonPayload.promise;
        },
      };
    },
  });

  const started = runner.start({
    tenant_id: "tenant-json-cancel",
    task: "Annulla mentre la risposta del primo agente viene decodificata.",
  });
  const completion = runner.wait({ tenant_id: "tenant-json-cancel", run_id: started.run_id });
  await jsonStarted.promise;
  const cancelled = runner.cancel({ tenant_id: "tenant-json-cancel", run_id: started.run_id });
  jsonPayload.resolve({
    output_text: outputSentinel,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  });

  const result = await completion;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(result.status, "cancelled");
  assert.equal(fetchCalls, 1);
  assert.equal(JSON.stringify(result).includes(outputSentinel), false);
  assert.equal(result.stages.filter((stage) => stage.status === "completed").length, 0);
  const checkpoint = genericAgentCheckpointStore.load({ tenant_id: "tenant-json-cancel", run_id: started.run_id });
  assert.equal(JSON.stringify(checkpoint).includes(outputSentinel), false);
});

test("tenant OpenAI runner persists task, provider key, and model output nowhere in checkpoints or audit", async () => {
  const taskSentinel = "TASK_PRIVATE_SENTINEL_728";
  const providerKeySentinel = "tenant-provider-credential-sentinel-728";
  const outputSentinel = "MODEL_OUTPUT_PRIVATE_SENTINEL_728";
  const { root, audit, genericAgentCheckpointStore, runner } = fixture({
    tenantProviderCredentials: {
      async getOpenAiForExecution() { return providerKeySentinel; },
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          output_text: outputSentinel,
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        };
      },
    }),
  });

  const result = await runner.run({
    tenant_id: "tenant-persistence",
    task: `Analizza ${taskSentinel} senza azioni esterne.`,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.final_output, outputSentinel);

  const checkpoint = genericAgentCheckpointStore.load({
    tenant_id: "tenant-persistence",
    run_id: result.run_id,
  });
  const checkpointText = JSON.stringify(checkpoint);
  const auditText = fs.readFileSync(path.join(root, "audit", "events.jsonl"), "utf8");
  for (const value of [taskSentinel, providerKeySentinel, outputSentinel]) {
    assert.equal(checkpointText.includes(value), false, `checkpoint must not contain ${value}`);
    assert.equal(auditText.includes(value), false, `audit file must not contain ${value}`);
    assert.equal(JSON.stringify(audit.recent()).includes(value), false, `audit reader must not contain ${value}`);
  }
});

test("tenant OpenAI runner checks its deadline before parsing a delayed provider response", async () => {
  const responseReady = deferred();
  const fetchStarted = deferred();
  const outputSentinel = "DEADLINE_RESPONSE_MUST_NOT_BE_PARSED";
  let nowMs = 0;
  let jsonCalls = 0;
  const { genericAgentCheckpointStore, runner } = fixture({
    clock: () => nowMs,
    fetchImpl: async () => {
      fetchStarted.resolve();
      return responseReady.promise;
    },
  });

  const started = runner.start({
    tenant_id: "tenant-deadline",
    task: "Verifica che una risposta arrivata dopo la scadenza non venga elaborata.",
  });
  const completion = runner.wait({ tenant_id: "tenant-deadline", run_id: started.run_id });
  await fetchStarted.promise;
  nowMs = 150_001;
  responseReady.resolve({
    ok: true,
    status: 200,
    async json() {
      jsonCalls += 1;
      return {
        output_text: outputSentinel,
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      };
    },
  });

  const result = await completion;
  assert.equal(result.status, "failed");
  assert.equal(result.error_code, "run_deadline_exceeded");
  assert.equal(jsonCalls, 0);
  assert.equal(result.stages.filter((stage) => stage.status === "completed").length, 0);
  const checkpoint = genericAgentCheckpointStore.load({ tenant_id: "tenant-deadline", run_id: started.run_id });
  assert.equal(JSON.stringify(checkpoint).includes(outputSentinel), false);
});

test("tenant OpenAI runner keeps a tenant slot while an abort-ignoring provider request drains", async () => {
  const requestStarted = deferred();
  const rawRequest = deferred();
  let requestCount = 0;
  const { runner } = fixture({
    fetchImpl: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        requestStarted.resolve();
        return rawRequest.promise;
      }
      return {
        ok: true,
        status: 200,
        async json() { return { output_text: "safe", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }; },
      };
    },
  });

  const first = runner.start({ tenant_id: "tenant-draining", task: "Verifica che un arresto non sovrapponga chiamate fatturabili." });
  const completion = runner.wait({ tenant_id: "tenant-draining", run_id: first.run_id });
  await requestStarted.promise;
  assert.equal(runner.cancel({ tenant_id: "tenant-draining", run_id: first.run_id }).status, "cancelled");
  assert.throws(
    () => runner.start({ tenant_id: "tenant-draining", task: "Questo run deve attendere il drain della richiesta precedente." }),
    /tenant_multi_agent_run_in_progress/,
  );

  rawRequest.resolve({ ok: true, status: 200, async json() { return { output_text: "ignored", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }; } });
  assert.equal((await completion).status, "cancelled");

  const second = runner.start({ tenant_id: "tenant-draining", task: "Ora il nuovo run può essere ammesso." });
  assert.match(second.run_id, /^run_/);
  assert.equal(runner.cancel({ tenant_id: "tenant-draining", run_id: second.run_id }).status, "cancelled");
  assert.equal((await runner.wait({ tenant_id: "tenant-draining", run_id: second.run_id })).status, "cancelled");
});

test("tenant OpenAI runner releases a stalled vault on its bounded deadline", async () => {
  const firstVault = deferred();
  let vaultCalls = 0;
  let fetchCalls = 0;
  const { runner } = fixture({
    deadlineMs: 1_000,
    tenantProviderCredentials: {
      getOpenAiForExecution() {
        vaultCalls += 1;
        return vaultCalls === 1 ? firstVault.promise : "tenant-openai-key-after-deadline";
      },
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        async json() { return { output_text: `stage-${fetchCalls}`, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }; },
      };
    },
  });

  const first = runner.start({ tenant_id: "tenant-vault-deadline", task: "Verifica la scadenza del recupero cifrato della chiave." });
  const failed = await runner.wait({ tenant_id: "tenant-vault-deadline", run_id: first.run_id });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error_code, "run_deadline_exceeded");
  assert.equal(fetchCalls, 0);

  const second = await runner.run({ tenant_id: "tenant-vault-deadline", task: "Il tenant deve essere libero dopo la scadenza del vault." });
  assert.equal(second.status, "completed");
  assert.equal(fetchCalls, 3);
});

test("tenant OpenAI runner fails closed for oversized UTF-8 input, unreported usage, and common pasted credentials", async () => {
  let fetchCalls = 0;
  const { runner } = fixture({
    fetchImpl: async () => {
      fetchCalls += 1;
      return { ok: true, status: 200, async json() { return { output_text: "output without usage" }; } };
    },
  });

  assert.throws(
    () => runner.start({ tenant_id: "tenant-input-guard", task: "🙂".repeat(76) }),
    /task_input_budget_exceeded/,
  );
  assert.throws(
    () => runner.start({ tenant_id: "tenant-input-guard", task: "Usa ghp_abcdefghijklmnopqrstuvwxabcdefghijkl per eseguire il task" }),
    /task_contains_secret/,
  );
  const result = await runner.run({ tenant_id: "tenant-input-guard", task: "Verifica la risposta senza metadati di utilizzo." });
  assert.equal(result.status, "failed");
  assert.equal(result.error_code, "openai_provider_usage_missing");
  assert.equal(fetchCalls, 1);
});
