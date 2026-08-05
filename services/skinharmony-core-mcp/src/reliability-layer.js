import crypto from "node:crypto";

const READ_PATHS = Object.freeze({
  contract: "/v1/reliability/status",
  status: "/v1/reliability/status",
  budget: "/v1/reliability/budget",
});

function textResult(payload) {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

function bounded(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function sessionScope(args, identity) {
  const identitySession = bounded(identity?.agentPresence?.session_id || identity?.session_id, 160);
  const requestedSession = bounded(args?.session_id, 160);
  if (identitySession && requestedSession && identitySession !== requestedSession) {
    const error = new Error("reliability_session_scope_mismatch");
    error.code = error.message;
    throw error;
  }
  const sessionId = identitySession || requestedSession;
  if (!sessionId) {
    const error = new Error("reliability_session_scope_missing");
    error.code = error.message;
    throw error;
  }
  return {
    ...(args && typeof args === "object" ? args : {}),
    session_id: sessionId,
    agent_id: bounded(identity?.agentPresence?.agent_id || identity?.agentId || args?.agent_id || "connected_ai", 160),
  };
}

function routeForRead(view) {
  const key = bounded(view || "contract", 32).toLowerCase();
  if (!READ_PATHS[key]) throw new Error("reliability_view_invalid");
  return READ_PATHS[key];
}

function requireId(value, code) {
  const normalized = bounded(value, 200);
  if (!normalized) throw new Error(code);
  return normalized;
}

function bridge(coreHandlers, route, method, args, identity) {
  return coreHandlers.core_reliability_request({
    path: route,
    method,
    body: method === "POST" ? sessionScope(args, identity) : undefined,
  }, identity).then((payload) => textResult({
    ...payload,
    dedicated_core_gate: {
      authorized: payload?.ok === true,
      authority: "universal_core",
      route,
      provider_execution: false,
      host_policy_override: false,
      execution_enabled: false,
      execution_authorized: false,
    },
  }));
}

export function createReliabilityHandlers(_config, { coreHandlers } = {}) {
  if (typeof coreHandlers?.core_reliability_request !== "function") {
    throw new Error("reliability_core_bridge_unavailable");
  }
  return {
    nyra_reliability_read: async (args = {}, identity) => bridge(
      coreHandlers,
      routeForRead(args.view),
      "GET",
      {},
      identity,
    ),
    nyra_reliability_content_check: async (args = {}, identity) => bridge(
      coreHandlers,
      "/v1/reliability/content/check",
      "POST",
      args,
      identity,
    ),
    nyra_reliability_chat_evaluate: async (args = {}, identity) => bridge(
      coreHandlers,
      "/v1/reliability/chat/evaluate",
      "POST",
      args,
      identity,
    ),
    nyra_reliability_claim_record: async (args = {}, identity) => bridge(
      coreHandlers,
      "/v1/reliability/claims",
      "POST",
      args,
      identity,
    ),
    nyra_reliability_claim_read: async (args = {}, identity) => {
      sessionScope(args, identity);
      return bridge(coreHandlers, `/v1/reliability/claims/${encodeURIComponent(requireId(args.claim_id, "claim_id_required"))}`, "GET", {}, identity);
    },
    nyra_reliability_claim_verify: async (args = {}, identity) => bridge(
      coreHandlers,
      `/v1/reliability/claims/${encodeURIComponent(requireId(args.claim_id, "claim_id_required"))}/verify`,
      "POST",
      args,
      identity,
    ),
    nyra_reliability_action_issue: async (args = {}, identity) => bridge(
      coreHandlers,
      "/v1/reliability/actions",
      "POST",
      args,
      identity,
    ),
    nyra_reliability_action_consume: async (args = {}, identity) => bridge(
      coreHandlers,
      "/v1/reliability/actions/consume",
      "POST",
      args,
      identity,
    ),
    nyra_reliability_handoff_issue: async (args = {}, identity) => bridge(
      coreHandlers,
      "/v1/reliability/handoffs",
      "POST",
      args,
      identity,
    ),
    nyra_reliability_handoff_consume: async (args = {}, identity) => bridge(
      coreHandlers,
      "/v1/reliability/handoffs/consume",
      "POST",
      args,
      identity,
    ),
    nyra_reliability_completion_register: async (args = {}, identity) => bridge(
      coreHandlers,
      "/v1/reliability/completions",
      "POST",
      args,
      identity,
    ),
    nyra_reliability_completion_verify: async (args = {}, identity) => bridge(
      coreHandlers,
      `/v1/reliability/completions/${encodeURIComponent(requireId(args.completion_id, "completion_id_required"))}/verify`,
      "POST",
      args,
      identity,
    ),
    nyra_reliability_completion_finalize: async (args = {}, identity) => bridge(
      coreHandlers,
      `/v1/reliability/completions/${encodeURIComponent(requireId(args.completion_id, "completion_id_required"))}/finalize`,
      "POST",
      args,
      identity,
    ),
    nyra_reliability_continuity_checkpoint: async (args = {}, identity) => bridge(
      coreHandlers,
      "/v1/reliability/continuity/checkpoint",
      "POST",
      args,
      identity,
    ),
    nyra_reliability_continuity_read: async (args = {}, identity) => {
      sessionScope(args, identity);
      return bridge(coreHandlers, `/v1/reliability/continuity/${encodeURIComponent(requireId(args.work_id, "work_id_required"))}`, "GET", {}, identity);
    },
    nyra_reliability_continuity_replay: async (args = {}, identity) => bridge(
      coreHandlers,
      "/v1/reliability/continuity/replay",
      "POST",
      args,
      identity,
    ),
    nyra_reliability_budget_reserve: async (args = {}, identity) => bridge(
      coreHandlers,
      "/v1/reliability/budget/reserve",
      "POST",
      args,
      identity,
    ),
    nyra_reliability_browser_issue: async (args = {}, identity) => bridge(
      coreHandlers,
      "/v1/reliability/browser/contracts",
      "POST",
      args,
      identity,
    ),
    nyra_reliability_browser_observe: async (args = {}, identity) => bridge(
      coreHandlers,
      `/v1/reliability/browser/contracts/${encodeURIComponent(requireId(args.contract_id, "contract_id_required"))}/observe`,
      "POST",
      args,
      identity,
    ),
    reliability_digest: async (args = {}, identity) => textResult({
      ok: true,
      tenant_id: identity.tenantId,
      digest: digest(args.value),
      execution_enabled: false,
      execution_authorized: false,
    }),
  };
}
