import process from "node:process";

const input = await new Promise((resolve) => {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { raw += chunk; });
  process.stdin.on("end", () => {
    try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
  });
});

const toolName = String(input.tool_name || "");
const command = String(input.tool_input?.command || "");
const enforcement = String(process.env.SKINHARMONY_CORE_GATE_ENFORCEMENT || "advisory").toLowerCase();
const coreUrl = String(process.env.SKINHARMONY_CORE_URL || "https://skinharmony-universal-core.onrender.com").replace(/\/+$/, "");
const coreKey = String(process.env.SKINHARMONY_CORE_GATE_KEY || "");
const tenantId = String(process.env.SKINHARMONY_CORE_TENANT_ID || "codexai");

const safeReadOnly = toolName === "Bash" && /^(?:\s*)(?:rg\b|git\s+(?:status|diff|log|show)\b|npm\s+(?:test|run\s+test)\b|node\s+--check\b|cargo\s+test\b)/i.test(command);
if (safeReadOnly) process.exit(0);

let actionType = toolName === "apply_patch" || /^(?:Edit|Write)$/i.test(toolName) ? "code_edit" : "workflow_decision";
let riskHint = actionType === "code_edit" ? 30 : 45;
if (/\b(?:deploy|publish|git\s+push|gh\s+pr\s+merge|render)\b/i.test(command)) { actionType = "deploy"; riskHint = 82; }
if (/\b(?:rm\s+-rf|git\s+reset\s+--hard|git\s+push\s+--force|drop\s+database|delete)\b/i.test(command)) { actionType = "delete"; riskHint = 95; }

function context(message) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: message,
    },
  }));
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }));
}

if (!coreKey) {
  if (enforcement === "strict") deny("Universal Core gate key missing. Configure SKINHARMONY_CORE_GATE_KEY; writes fail closed in strict mode.");
  else context("Universal Core gate is advisory because SKINHARMONY_CORE_GATE_KEY is missing. Do not merge, deploy, publish, delete, or make production changes.");
  process.exit(0);
}

try {
  const response = await fetch(`${coreUrl}/v1/policy/check`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${coreKey}`,
      "x-sh-tenant-id": tenantId,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      action: { action_type: actionType, action_label: `${toolName}: ${command.slice(0, 240)}`, risk_hint: riskHint },
      policy: { mode: "hard-gating", approval_required: riskHint >= 70 },
      context: { owner_confirmed: false, audit_ready: true, source: "codex_pre_tool_hook" },
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const json = await response.json();
  const engine = json.result?.policy_engine || {};
  const mediation = String(engine.action_mediation?.state || "defer");
  if (!response.ok || !["allow", "rewrite"].includes(mediation)) {
    deny(`Universal Core verdict: ${mediation}. ${String(engine.action_mediation?.next_step || json.error || "Action not authorized")}`);
  } else {
    context(`Universal Core allowed this ${actionType} action with mediation=${mediation}, risk=${String(engine.risk?.band || "unknown")}. Keep audit and scope unchanged.`);
  }
} catch (error) {
  if (enforcement === "strict") deny(`Universal Core unavailable; strict mode fails closed. ${error.message}`);
  else context(`Universal Core unavailable in advisory mode. Do not perform production, deploy, publish, delete, or merge actions. ${error.message}`);
}
