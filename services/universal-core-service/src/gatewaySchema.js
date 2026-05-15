export const AI_GATEWAY_PAYLOAD_SCHEMA = {
  type: "object",
  required: ["user_request"],
  properties: {
    tenant_id: { type: "string" },
    adapter: { type: "string", enum: ["generic", "chatgpt", "codex", "site_suite", "smart_desk", "skinharmony_core"] },
    action_type: { type: "string" },
    requested_action: { type: "object" },
    user_request: { type: "string" },
    llm_output: { type: "string" },
    context: { type: "object" },
    runtime_state: { type: "object" },
    role_scope: { type: "object" },
    flow_pressure: { type: ["number", "object"] },
    gateway_mode: { type: "string", enum: ["advisory", "rewrite", "hard-gating", "execution_orchestration"] },
    mode: { type: "string", enum: ["advisory", "rewrite", "hard-gating", "execution_orchestration"] },
    variants: { type: "array" },
    owner_confirmed: { type: "boolean" },
  },
};

export const AI_GATEWAY_VERDICT_SCHEMA = {
  type: "object",
  required: ["decision", "risk", "confidence", "executionAllowed", "requiresOwnerConfirmation"],
  properties: {
    decision: { type: "string", enum: ["allow_advisory", "review", "block"] },
    decision_state: { type: "string", enum: ["ready", "attention", "blocked", "observe"] },
    risk: {
      type: "object",
      required: ["band"],
      properties: {
        score: { type: ["number", "null"] },
        band: { type: "string", enum: ["low", "medium", "high"] },
        reasons: { type: "array", items: { type: "string" } },
      },
    },
    confidence: { type: "number" },
    warnings: { type: "array", items: { type: "string" } },
    policyFlags: { type: "object" },
    executionAllowed: { type: "boolean" },
    recommendedVariant: { type: "object" },
    requiresOwnerConfirmation: { type: "boolean" },
    final_output: { type: "string" },
    audit_id: { type: "string" },
  },
};
