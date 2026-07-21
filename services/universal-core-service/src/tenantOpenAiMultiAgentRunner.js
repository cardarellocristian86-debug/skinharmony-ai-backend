import crypto from "node:crypto";

const WORKFLOW_ID = "research_review_synthesis_v1";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";
const MAX_MODEL_CALLS = 3;
const MAX_TOTAL_TOKENS = 3_600;
// This is intentionally a small first live workflow. The envelope reserves
// 1,200 tokens per stage and bounds all input by characters before a request
// leaves Core. It is a real cost ceiling, not a client-supplied estimate.
const MAX_STAGE_RESERVED_TOKENS = 1_200;
const MAX_OUTPUT_TOKENS = 200;
const MAX_TASK_CHARS = 300;
// Tokenisation is byte based. Count every UTF-8 byte as a possible token,
// rather than relying on a friendly-language chars/token ratio, so unicode
// text cannot silently enlarge the chargeable request envelope.
const MAX_TASK_UTF8_BYTES = 300;
const MAX_CONTEXT_UTF8_BYTES = 100;
const MAX_STAGE_INPUT_UTF8_BYTES = MAX_STAGE_RESERVED_TOKENS - MAX_OUTPUT_TOKENS;
const STAGE_TIMEOUT_MS = 45_000;
const RUN_DEADLINE_MS = 150_000;
const MAX_ACTIVE_RUNS = 2;
const MAX_TERMINAL_RUNS = 100;

const STAGES = Object.freeze([
  {
    id: "research",
    worker_id: "research",
    agent_id: "research-scout",
    role: "researcher",
    instructions: "You are the Researcher in a bounded three-stage workflow. Analyse only the supplied request. Do not browse, call tools, access systems, make purchases, contact people, or claim external verification. State assumptions, alternatives, and information gaps. Give a concise Italian research brief.",
  },
  {
    id: "review",
    worker_id: "review",
    agent_id: "evidence-critic",
    role: "reviewer",
    instructions: "You are the Reviewer in a bounded three-stage workflow. Critically inspect the supplied request and research draft. Do not browse, call tools, access systems, make purchases, contact people, or claim external verification. Flag unsupported claims, risks, contradictions, missing constraints, and safer alternatives. Give a concise Italian review.",
  },
  {
    id: "synthesis",
    worker_id: "synthesis",
    agent_id: "nyra-supervisor",
    role: "synthesizer",
    instructions: "You are Nyra, the final coordinator in a bounded three-stage workflow. Use only the supplied request, researcher draft, and reviewer draft. Do not browse, call tools, access systems, make purchases, contact people, or claim external actions. Give a concise practical Italian answer: recommendation, open questions, and marked uncertainty.",
  },
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireText(value, field, max = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) throw new Error(`${field}_invalid`);
  return normalized;
}

function taskFingerprint(secret, value) {
  return `hmac-sha256:${crypto.createHmac("sha256", secret)
    .update(`tenant-openai-run-fingerprint\u0000${String(value || "")}`)
    .digest("hex")}`;
}

function utf8Bytes(value) {
  return Buffer.byteLength(String(value || ""), "utf8");
}

function truncate(value, max = 8_000) {
  const normalized = String(value || "").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(1, max - 1))}…`;
}

function truncatePromptContext(value, maxBytes = MAX_CONTEXT_UTF8_BYTES) {
  const normalized = String(value || "").trim();
  if (utf8Bytes(normalized) <= maxBytes) return normalized;
  const suffix = "…";
  const available = Math.max(0, maxBytes - utf8Bytes(suffix));
  let result = "";
  for (const character of normalized) {
    if (utf8Bytes(result) + utf8Bytes(character) > available) break;
    result += character;
  }
  return `${result}${suffix}`;
}

// Provider credentials and credentials embedded in a user request are both
// prohibited in this first live path. This keeps task, checkpoints, audit and
// model input credential-free even when a caller accidentally pastes a secret.
function containsSecret(text) {
  const value = String(text || "");
  return /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/i.test(value) ||
    /\bsk-ant-[A-Za-z0-9_-]{12,}\b/i.test(value) ||
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/i.test(value) ||
    /\bAKIA[0-9A-Z]{16}\b/.test(value) ||
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i.test(value) ||
    /\bAIza[0-9A-Za-z_-]{30,}\b/.test(value) ||
    /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/i.test(value) ||
    /\b(?:api[_ -]?key|private[_ -]?key|password|passwd|secret|access[_ -]?token|token)\b/i.test(value) ||
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i.test(value);
}

function redactSecretLikeText(value) {
  return String(value || "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[REDACTED_SECRET]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/gi, "[REDACTED_SECRET]")
    .replace(/\bsk-ant-[A-Za-z0-9_-]{12,}\b/gi, "[REDACTED_SECRET]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/gi, "[REDACTED_SECRET]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_SECRET]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi, "[REDACTED_SECRET]")
    .replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, "[REDACTED_SECRET]")
    .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/gi, "[REDACTED_SECRET]")
    .replace(/\b(?:api[_ -]?key|private[_ -]?key|password|passwd|secret|access[_ -]?token|token)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED_SECRET]")
    .trim();
}

function safeProviderError(response) {
  const status = Number(response?.status || 0);
  if (status === 401 || status === 403) return "openai_provider_auth_failed";
  if (status === 408 || status === 504) return "openai_provider_timeout";
  if (status === 429) return "openai_provider_rate_limited";
  if (status >= 500) return "openai_provider_unavailable";
  return "openai_provider_request_failed";
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    const output = redactSecretLikeText(payload.output_text);
    if (!output) throw new Error("openai_provider_response_invalid");
    return truncate(output, 8_000);
  }
  const parts = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  const output = redactSecretLikeText(parts.join("\n"));
  if (!output) throw new Error("openai_provider_response_invalid");
  return truncate(output, 8_000);
}

function safeUsage(payload) {
  const usage = payload?.usage && typeof payload.usage === "object" ? payload.usage : null;
  if (!usage || !Number.isFinite(Number(usage.total_tokens)) || Number(usage.total_tokens) < 0) {
    return { available: false, input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  }
  const number = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  const inputTokens = number(usage.input_tokens);
  const outputTokens = number(usage.output_tokens);
  return {
    available: true,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: Math.max(number(usage.total_tokens), inputTokens + outputTokens),
  };
}

function makeWorkers() {
  return [
    { worker_id: "research", agent_id: "research-scout", task: "Bounded research stage. No tools or external actions.", dependencies: [], branch_depth: 1 },
    { worker_id: "review", agent_id: "evidence-critic", task: "Bounded review stage. No tools or external actions.", dependencies: ["research"], parent_worker_id: "research", branch_depth: 2 },
    { worker_id: "synthesis", agent_id: "nyra-supervisor", task: "Bounded synthesis stage. No tools or external actions.", dependencies: ["research", "review"], parent_worker_id: "review", branch_depth: 3 },
  ];
}

function nowIso() {
  return new Date().toISOString();
}

function terminal(state) {
  return ["completed", "cancelled", "failed", "interrupted"].includes(state.status);
}

function statusCode(error) {
  return error instanceof Error ? error.message : "tenant_openai_multi_agent_failed";
}

function stageInput(stage, task, outputs) {
  if (stage.id === "research") return `Richiesta utente:\n${task}`;
  if (stage.id === "review") return `Richiesta utente:\n${task}\n\nRicerca:\n${truncatePromptContext(outputs.research)}`;
  return `Richiesta utente:\n${task}\n\nRicerca:\n${truncatePromptContext(outputs.research)}\n\nRevisione:\n${truncatePromptContext(outputs.review)}`;
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(new Error("stage_request_aborted"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new Error("stage_request_aborted"));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}

function publicRun(state, { includeOutput = false } = {}) {
  const stages = STAGES.map((stage) => {
    const stored = state.stages[stage.id] || {};
    return {
      id: stage.id,
      agent_id: stage.agent_id,
      role: stage.role,
      status: stored.status || "pending",
      ...(Number.isFinite(stored.latency_ms) ? { latency_ms: stored.latency_ms } : {}),
      ...(includeOutput && stored.status === "completed" && stored.output ? { output: stored.output } : {}),
    };
  });
  return {
    workflow: WORKFLOW_ID,
    run_id: state.run_id,
    plan_id: state.plan_id,
    tenant_id: state.tenant_id,
    status: state.status,
    model: state.model,
    provider_execution: true,
    learning_mode: "frozen",
    external_tools: false,
    limits: {
      max_model_calls: MAX_MODEL_CALLS,
      max_total_tokens: MAX_TOTAL_TOKENS,
      max_output_tokens_per_stage: MAX_OUTPUT_TOKENS,
      max_parallel_model_calls: 1,
      max_branch_depth: 3,
      deadline_ms: state.deadline_ms,
    },
    model_usage: clone(state.model_usage),
    provider_usage: clone(state.provider_usage),
    stages,
    ...(includeOutput && state.final_output ? { final_output: state.final_output } : {}),
    ...(state.error_code ? { error_code: state.error_code } : {}),
    ...(state.kill_signal ? { kill_signal: clone(state.kill_signal) } : {}),
    created_at: state.created_at,
    started_at: state.started_at,
    deadline_at: state.deadline_at,
    ...(state.completed_at ? { completed_at: state.completed_at } : {}),
  };
}

export function createTenantOpenAiMultiAgentRunner({
  tenantProviderCredentials,
  genericAgentRuntime,
  genericAgentOrchestrator,
  genericAgentOrchestrationStore,
  genericAgentCheckpointStore,
  governedAgentBudgetStore,
  audit,
  fetchImpl = fetch,
  model = process.env.NYRA_TENANT_OPENAI_MODEL || DEFAULT_MODEL,
  now = nowIso,
  maxActiveRuns = MAX_ACTIVE_RUNS,
  clock = () => Date.now(),
  taskFingerprintSecret,
  // These remain fixed by the service in production. Injection only keeps the
  // fail-closed deadline path directly testable without a multi-minute test.
  deadlineMs = RUN_DEADLINE_MS,
} = {}) {
  if (!tenantProviderCredentials || typeof tenantProviderCredentials.getOpenAiForExecution !== "function") throw new Error("tenant_provider_credentials_required");
  if (!genericAgentRuntime || !genericAgentOrchestrator || !genericAgentOrchestrationStore || !genericAgentCheckpointStore || !governedAgentBudgetStore || !audit) {
    throw new Error("tenant_openai_runner_dependencies_required");
  }
  if (typeof fetchImpl !== "function") throw new Error("openai_fetch_required");
  const selectedModel = requireText(model, "tenant_openai_model", 160);
  const concurrencyLimit = Number(maxActiveRuns);
  if (!Number.isInteger(concurrencyLimit) || concurrencyLimit < 1 || concurrencyLimit > 8) throw new Error("multi_agent_active_limit_invalid");
  const runDeadlineMs = Number(deadlineMs);
  if (!Number.isInteger(runDeadlineMs) || runDeadlineMs < 1_000 || runDeadlineMs > RUN_DEADLINE_MS) throw new Error("multi_agent_deadline_invalid");
  // A per-process fallback is still non-reversible and only used in local
  // tests/degraded deployments. Production passes the Core signing secret.
  const fingerprintSecret = String(taskFingerprintSecret || "").trim() || crypto.randomBytes(32).toString("hex");
  const fingerprint = (value) => taskFingerprint(fingerprintSecret, value);
  const activeByRun = new Map();
  const activeByTenant = new Map();
  const terminalByRun = new Map();

  function retainTerminal(state) {
    if (terminalByRun.has(state.run_id)) terminalByRun.delete(state.run_id);
    while (terminalByRun.size >= MAX_TERMINAL_RUNS) terminalByRun.delete(terminalByRun.keys().next().value);
    terminalByRun.set(state.run_id, state);
  }

  function persist(state) {
    const checkpoint = {
      schema_version: "tenant_openai_multi_agent_checkpoint_v1",
      state: {
        workflow: WORKFLOW_ID,
        status: state.status,
        plan_id: state.plan_id,
        model: state.model,
        task_fingerprint: state.task_fingerprint,
        model_usage: clone(state.model_usage),
        provider_usage: clone(state.provider_usage),
        stages: STAGES.map((stage) => ({
          id: stage.id,
          status: state.stages[stage.id]?.status || "pending",
          ...(Number.isFinite(state.stages[stage.id]?.latency_ms) ? { latency_ms: state.stages[stage.id].latency_ms } : {}),
        })),
        ...(state.error_code ? { error_code: state.error_code } : {}),
        ...(state.kill_signal ? { kill_signal: clone(state.kill_signal) } : {}),
      },
      cursor: state.current_stage || null,
      idempotency_key: null,
    };
    let runSnapshot = null;
    try { runSnapshot = genericAgentRuntime.getRun({ tenant_id: state.tenant_id, run_id: state.run_id }); } catch {}
    genericAgentCheckpointStore.save({
      tenant_id: state.tenant_id,
      run_id: state.run_id,
      checkpoint,
      run_snapshot: runSnapshot,
    });
    try {
      const plan = genericAgentOrchestrator.getPlan({ tenant_id: state.tenant_id, plan_id: state.plan_id });
      genericAgentOrchestrationStore.save({ tenant_id: state.tenant_id, plan_snapshot: plan });
    } catch {}
  }

  function tryPersist(state) {
    try { persist(state); } catch {}
  }

  function safeAudit(eventType, state, detail = {}) {
    try {
      audit.append(eventType, {
        tenant_id: state.tenant_id,
        run_id: state.run_id,
        plan_id: state.plan_id,
        workflow: WORKFLOW_ID,
        model: state.model,
        model_calls: state.model_usage.model_calls,
        reserved_tokens: state.model_usage.reserved_tokens,
        ...detail,
      });
    } catch {}
  }

  function finalise(state) {
    if (state.deadline_timer) clearTimeout(state.deadline_timer);
    state.deadline_timer = null;
    state.draining = false;
    activeByRun.delete(state.run_id);
    if (activeByTenant.get(state.tenant_id) === state.run_id) activeByTenant.delete(state.tenant_id);
    if (terminal(state)) retainTerminal(state);
  }

  function releaseUnstartedBudget(state) {
    if (!state.budget?.reservation_id || state.provider_request_started) return;
    try {
      governedAgentBudgetStore.releaseWorkflow?.({
        tenant_id: state.tenant_id,
        reservation_id: state.budget.reservation_id,
      });
    } catch {}
  }

  function cancellationSignal(state, reason = "cancelled_by_owner") {
    if (terminal(state)) return publicRun(state);
    state.cancelled_by_owner = true;
    state.controller.abort();
    state.status = "cancelled";
    state.current_stage = null;
    state.error_code = "run_cancelled";
    state.completed_at = now();
    try {
      const plan = genericAgentOrchestrator.cancelPlan({ tenant_id: state.tenant_id, plan_id: state.plan_id });
      state.kill_signal = plan.kill_signal || { propagated: true, cancelled_worker_count: 0 };
    } catch {
      state.kill_signal = { propagated: true, cancelled_worker_count: 0 };
    }
    try { genericAgentRuntime.cancelRun({ tenant_id: state.tenant_id, run_id: state.run_id, reason }); } catch {}
    releaseUnstartedBudget(state);
    tryPersist(state);
    safeAudit("tenant_openai_multi_agent_cancelled", state, { reason });
    return publicRun(state);
  }

  function failState(state, errorCode) {
    if (terminal(state)) return publicRun(state);
    state.status = "failed";
    state.current_stage = null;
    state.error_code = errorCode;
    state.completed_at = now();
    try {
      const plan = genericAgentOrchestrator.cancelPlan({ tenant_id: state.tenant_id, plan_id: state.plan_id });
      state.kill_signal = plan.kill_signal || { propagated: true, cancelled_worker_count: 0 };
    } catch {
      state.kill_signal = { propagated: true, cancelled_worker_count: 0 };
    }
    try { genericAgentRuntime.failRun({ tenant_id: state.tenant_id, run_id: state.run_id, reason: errorCode }); } catch {}
    releaseUnstartedBudget(state);
    tryPersist(state);
    safeAudit("tenant_openai_multi_agent_failed", state, { error_code: errorCode });
    return publicRun(state);
  }

  async function drainProviderRequest(state) {
    const pending = [...state.provider_drains];
    if (!pending.length) return;
    // A compliant fetch aborts immediately. If an adapter ignores AbortSignal,
    // we deliberately keep this tenant/capacity reservation until its request
    // settles, rather than risk overlapping chargeable provider calls.
    state.draining = true;
    await Promise.allSettled(pending);
  }

  function ensureLive(state) {
    if (state.cancelled_by_owner || state.status === "cancelled") throw new Error("run_cancelled");
    if (state.deadline_exceeded || clock() >= state.deadline_epoch_ms) {
      state.deadline_exceeded = true;
      state.controller.abort();
      throw new Error("run_deadline_exceeded");
    }
    if (terminal(state)) throw new Error("run_not_running");
  }

  function providerAbortCode(state, timedOut) {
    if (state.cancelled_by_owner || state.status === "cancelled") return "run_cancelled";
    if (state.deadline_exceeded || clock() >= state.deadline_epoch_ms) return "run_deadline_exceeded";
    return timedOut ? "openai_provider_timeout" : "openai_provider_unavailable";
  }

  async function invokeStage(state, stage, task, apiKey) {
    ensureLive(state);
    const claimed = genericAgentOrchestrator.claimReadyWorkers({ tenant_id: state.tenant_id, plan_id: state.plan_id });
    if (claimed.workers.length !== 1 || claimed.workers[0].worker_id !== stage.worker_id) throw new Error("workflow_scheduler_mismatch");
    state.current_stage = stage.id;
    state.stages[stage.id] = { status: "running" };
    persist(state);

    const contextStarted = clock();
    const input = stageInput(stage, task, state.outputs);
    if (utf8Bytes(stage.instructions) + utf8Bytes(input) > MAX_STAGE_INPUT_UTF8_BYTES) throw new Error("model_budget_exceeded");
    genericAgentRuntime.recordContextBuild({
      tenant_id: state.tenant_id,
      run_id: state.run_id,
      phase: stage.id,
      duration_ms: Math.max(0, clock() - contextStarted),
    });
    genericAgentRuntime.reserveModelCall({
      tenant_id: state.tenant_id,
      run_id: state.run_id,
      model_id: state.model,
      estimated_tokens: MAX_STAGE_RESERVED_TOKENS,
    });
    state.model_usage.model_calls += 1;
    state.model_usage.reserved_tokens += MAX_STAGE_RESERVED_TOKENS;
    persist(state);

    const callController = new AbortController();
    const abortFromRun = () => callController.abort();
    state.controller.signal.addEventListener("abort", abortFromRun, { once: true });
    let timedOut = false;
    const remaining = Math.max(1, state.deadline_epoch_ms - clock());
    const timeout = setTimeout(() => {
      timedOut = true;
      callController.abort();
    }, Math.min(STAGE_TIMEOUT_MS, remaining));
    const started = clock();
    state.provider_request_started = true;
    try {
      // Native fetch rejects on AbortSignal, but keep the cancellation and
      // deadline guarantee even for an adapter/test double that does not.
      // Otherwise a hung transport could leave a chargeable run stuck after
      // its owner has already sent the kill signal.
      const providerRequest = Promise.resolve().then(() => fetchImpl(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: state.model,
          store: false,
          max_output_tokens: MAX_OUTPUT_TOKENS,
          instructions: stage.instructions,
          input,
        }),
        signal: callController.signal,
      }));
      state.provider_drains.add(providerRequest);
      void providerRequest.finally(() => state.provider_drains.delete(providerRequest)).catch(() => {});
      const response = await abortable(providerRequest, callController.signal);
      ensureLive(state);
      if (!response?.ok) throw new Error(safeProviderError(response));
      const payload = await abortable(response.json(), callController.signal);
      ensureLive(state);
      const usage = safeUsage(payload);
      if (!usage.available) throw new Error("openai_provider_usage_missing");
      if (usage.total_tokens > MAX_STAGE_RESERVED_TOKENS || state.provider_usage.total_tokens + usage.total_tokens > MAX_TOTAL_TOKENS) {
        throw new Error("provider_usage_budget_exceeded");
      }
      const output = extractOutputText(payload);
      ensureLive(state);
      const latencyMs = Math.max(0, clock() - started);
      state.outputs[stage.id] = output;
      state.stages[stage.id] = { status: "completed", latency_ms: latencyMs, output };
      state.provider_usage.input_tokens += usage.input_tokens;
      state.provider_usage.output_tokens += usage.output_tokens;
      state.provider_usage.total_tokens += usage.total_tokens;
      const plan = genericAgentOrchestrator.completeWorker({
        tenant_id: state.tenant_id,
        plan_id: state.plan_id,
        worker_id: stage.worker_id,
        result: {
          output_digest: fingerprint(output),
          output_characters: output.length,
          latency_ms: latencyMs,
          usage,
        },
      });
      genericAgentOrchestrationStore.save({ tenant_id: state.tenant_id, plan_snapshot: plan });
      persist(state);
      safeAudit("tenant_openai_multi_agent_stage_completed", state, {
        stage: stage.id,
        latency_ms: latencyMs,
        provider_usage: usage,
      });
    } catch (error) {
      const code = statusCode(error);
      if (code === "stage_request_aborted" || callController.signal.aborted) throw new Error(providerAbortCode(state, timedOut));
      throw error;
    } finally {
      clearTimeout(timeout);
      state.controller.signal.removeEventListener("abort", abortFromRun);
    }
  }

  async function execute(state, task) {
    try {
      ensureLive(state);
      // Vault reads do not make a provider request. They still respect the
      // owner kill signal/deadline so a stalled storage adapter cannot pin the
      // tenant or global execution capacity forever.
      const apiKey = await abortable(
        tenantProviderCredentials.getOpenAiForExecution({ tenant_id: state.tenant_id }),
        state.controller.signal,
      );
      ensureLive(state);
      if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("tenant_openai_provider_not_configured");
      for (const stage of STAGES) {
        ensureLive(state);
        await invokeStage(state, stage, task, apiKey);
      }
      ensureLive(state);
      const joined = genericAgentOrchestrator.coreJoin({ tenant_id: state.tenant_id, plan_id: state.plan_id });
      genericAgentRuntime.completeRun({
        tenant_id: state.tenant_id,
        run_id: state.run_id,
        result: { workflow: WORKFLOW_ID, plan_id: state.plan_id, output_digest: fingerprint(state.outputs.synthesis || "") },
      });
      state.status = "completed";
      state.current_stage = null;
      state.final_output = state.outputs.synthesis || "";
      state.completed_at = now();
      persist(state);
      safeAudit("tenant_openai_multi_agent_completed", state, {
        joined_status: joined.status,
        provider_usage: clone(state.provider_usage),
      });
      return publicRun(state, { includeOutput: true });
    } catch (error) {
      const code = statusCode(error);
      if (code === "run_cancelled" || state.cancelled_by_owner || state.status === "cancelled") return cancellationSignal(state, "cancelled_by_owner");
      if (code === "stage_request_aborted" && (state.deadline_exceeded || clock() >= state.deadline_epoch_ms)) {
        return failState(state, "run_deadline_exceeded");
      }
      return failState(state, code);
    } finally {
      await drainProviderRequest(state);
      finalise(state);
    }
  }

  function cleanupFailedStart({ tenantId, run, plan, budget, state }) {
    try { if (plan) genericAgentOrchestrator.cancelPlan({ tenant_id: tenantId, plan_id: plan.plan_id }); } catch {}
    try { if (run) genericAgentRuntime.cancelRun({ tenant_id: tenantId, run_id: run.run_id, reason: "runner_initialization_failed" }); } catch {}
    if (state) finalise(state);
    if (budget?.reservation_id) {
      try { governedAgentBudgetStore.releaseWorkflow?.({ tenant_id: tenantId, reservation_id: budget.reservation_id }); } catch {}
    }
  }

  function start({ tenant_id, task }) {
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const normalizedTask = requireText(task, "task", MAX_TASK_CHARS);
    if (utf8Bytes(normalizedTask) > MAX_TASK_UTF8_BYTES) throw new Error("task_input_budget_exceeded");
    if (containsSecret(normalizedTask)) throw new Error("task_contains_secret");
    // This reservation happens synchronously before vault decryption. It closes
    // the await race that could otherwise start two chargeable workflows.
    if (activeByTenant.has(tenantId)) throw new Error("tenant_multi_agent_run_in_progress");
    if (activeByRun.size >= concurrencyLimit) throw new Error("multi_agent_execution_capacity_reached");

    let run;
    let plan;
    let budget;
    let state;
    try {
      run = genericAgentRuntime.startRun({
        tenant_id: tenantId,
        agent_id: "nyra-supervisor",
        task: "Bounded tenant OpenAI multi-agent workflow.",
        tools: [],
        learning_mode: "frozen",
        model_budget: { max_model_calls: MAX_MODEL_CALLS, max_total_tokens: MAX_TOTAL_TOKENS },
        metadata: { workflow: WORKFLOW_ID, task_fingerprint: fingerprint(normalizedTask), external_tools: false },
      });
      plan = genericAgentOrchestrator.createPlan({ tenant_id: tenantId, run_id: run.run_id, workers: makeWorkers() });
      genericAgentOrchestrationStore.save({ tenant_id: tenantId, plan_snapshot: plan });
      budget = governedAgentBudgetStore.reserveWorkflow({ tenant_id: tenantId, worker_count: STAGES.length, deadline_ms: runDeadlineMs });
      const deadlineEpochMs = clock() + runDeadlineMs;
      state = {
        tenant_id: tenantId,
        run_id: run.run_id,
        plan_id: plan.plan_id,
        workflow: WORKFLOW_ID,
        model: selectedModel,
        status: "running",
        task_fingerprint: fingerprint(normalizedTask),
        created_at: now(),
        started_at: now(),
        current_stage: "research",
        model_usage: { model_calls: 0, reserved_tokens: 0 },
        provider_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        stages: Object.fromEntries(STAGES.map((stage) => [stage.id, { status: "pending" }])),
        outputs: {},
        controller: new AbortController(),
        budget: { reservation_id: budget.reservation_id || null, deadline_at: budget.deadline_at, deadline_ms: budget.deadline_ms },
        deadline_at: budget.deadline_at,
        deadline_epoch_ms: deadlineEpochMs,
        deadline_ms: runDeadlineMs,
        provider_request_started: false,
        cancelled_by_owner: false,
        deadline_exceeded: false,
        deadline_timer: null,
        provider_drains: new Set(),
        draining: false,
        completion: null,
      };
      // Maps are populated before the first await in execute(). This is the
      // tenant/global capacity gate and makes cancellation available at once.
      activeByRun.set(state.run_id, state);
      activeByTenant.set(tenantId, state.run_id);
      state.deadline_timer = setTimeout(() => {
        if (!terminal(state)) {
          state.deadline_exceeded = true;
          state.controller.abort();
        }
      }, runDeadlineMs);
      persist(state);
      safeAudit("tenant_openai_multi_agent_started", state, {
        budget_day: budget.day,
        workflow_count: budget.workflows,
        worker_count: STAGES.length,
      });
    } catch (error) {
      cleanupFailedStart({ tenantId, run, plan, budget, state });
      throw error;
    }

    state.completion = execute(state, normalizedTask);
    // execute() handles all expected errors. The catch only prevents an
    // implementation regression from becoming an unhandled background error.
    void state.completion.catch(() => {});
    return publicRun(state);
  }

  async function wait({ tenant_id, run_id }) {
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const runId = requireText(run_id, "run_id", 160);
    const active = activeByRun.get(runId);
    if (active) {
      if (active.tenant_id !== tenantId) throw new Error("cross_tenant_run_denied");
      await active.completion;
      return publicRun(active, { includeOutput: true });
    }
    const known = terminalByRun.get(runId);
    if (known) {
      if (known.tenant_id !== tenantId) throw new Error("cross_tenant_run_denied");
      return publicRun(known, { includeOutput: true });
    }
    throw new Error("tenant_openai_multi_agent_run_not_found");
  }

  return {
    available() {
      return true;
    },

    start,

    // Exposed for Core-level tests and controlled worker integrations. Normal
    // HTTP callers use start() plus the owner-gated status/result routes.
    wait,

    async run(input) {
      const started = start(input);
      return wait({ tenant_id: input.tenant_id, run_id: started.run_id });
    },

    cancel({ tenant_id, run_id }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const runId = requireText(run_id, "run_id", 160);
      const state = activeByRun.get(runId);
      if (!state) {
        const known = terminalByRun.get(runId);
        if (known && known.tenant_id !== tenantId) throw new Error("cross_tenant_run_denied");
        if (known) return publicRun(known);
        throw new Error("tenant_openai_multi_agent_run_not_found");
      }
      if (state.tenant_id !== tenantId) throw new Error("cross_tenant_run_denied");
      return cancellationSignal(state);
    },

    get({ tenant_id, run_id, include_output = false }) {
      const tenantId = requireText(tenant_id, "tenant_id", 120);
      const runId = requireText(run_id, "run_id", 160);
      const state = activeByRun.get(runId) || terminalByRun.get(runId);
      if (state) {
        if (state.tenant_id !== tenantId) throw new Error("cross_tenant_run_denied");
        return publicRun(state, { includeOutput: include_output === true });
      }
      const checkpoint = genericAgentCheckpointStore.load({ tenant_id: tenantId, run_id: runId });
      const saved = checkpoint?.checkpoint?.state;
      if (!saved || saved.workflow !== WORKFLOW_ID) throw new Error("tenant_openai_multi_agent_run_not_found");
      return {
        workflow: WORKFLOW_ID,
        run_id: runId,
        plan_id: saved.plan_id,
        tenant_id: tenantId,
        status: ["running", "pending"].includes(saved.status) ? "interrupted" : saved.status,
        model: saved.model,
        provider_execution: true,
        learning_mode: "frozen",
        external_tools: false,
        model_usage: saved.model_usage || { model_calls: 0, reserved_tokens: 0 },
        provider_usage: saved.provider_usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        stages: Array.isArray(saved.stages) ? saved.stages : [],
        ...(saved.error_code ? { error_code: saved.error_code } : {}),
        ...(saved.kill_signal ? { kill_signal: saved.kill_signal } : {}),
      };
    },
  };
}
