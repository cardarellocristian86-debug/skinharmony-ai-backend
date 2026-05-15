import { runUniversalCoreDecisionV1Calibrated } from "../packages/core/src/decisionV1Calibrated.ts";
import type { UniversalCoreInput } from "../packages/contracts/src/index.ts";

function input(overrides: Partial<UniversalCoreInput>): UniversalCoreInput {
  return {
    request_id: "test",
    generated_at: new Date().toISOString(),
    domain: "assistant",
    context: { tenant_id: "codexai", metadata: {} },
    signals: [],
    data_quality: { score: 90 },
    constraints: {
      allow_automation: false,
      require_confirmation: true,
      safety_mode: true,
    },
    ...overrides,
  };
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const green = runUniversalCoreDecisionV1Calibrated(input({
  context: { tenant_id: "codexai", metadata: { action_type: "read" } },
  signals: [{
    id: "read:safe",
    source: "test",
    category: "read",
    label: "Safe read",
    value: 12,
    normalized_score: 12,
    severity_hint: 12,
    confidence_hint: 94,
  }],
  constraints: { allow_automation: true, require_confirmation: false, safety_mode: false },
}));
assert(green.state === "ok", "green state should be ok");
assert(green.control_level === "execute_allowed", "green should execute");

const destructive = runUniversalCoreDecisionV1Calibrated(input({
  context: { tenant_id: "codexai", metadata: { action_type: "delete" } },
  signals: [{
    id: "delete:destructive",
    source: "test",
    category: "safety",
    label: "Destructive delete",
    value: 99,
    normalized_score: 99,
    severity_hint: 99,
    confidence_hint: 90,
  }],
}));
assert(destructive.state === "blocked", "destructive should be blocked");
assert(destructive.control_level === "blocked", "destructive control should be blocked");

const claim = runUniversalCoreDecisionV1Calibrated(input({
  context: { tenant_id: "codexai", metadata: { action_type: "publish" } },
  signals: [{
    id: "claim:forbidden",
    source: "test",
    category: "claim",
    label: "Forbidden claim",
    value: 94,
    normalized_score: 94,
    severity_hint: 94,
    confidence_hint: 86,
  }],
}));
assert(claim.state === "protection", "claim should enter protection");
assert(claim.control_level === "confirm", "claim should require confirm");

const sla = runUniversalCoreDecisionV1Calibrated(input({
  context: { tenant_id: "codexai", metadata: { action_type: "sla_breach" } },
  signals: [{
    id: "sla:overdue",
    source: "test",
    category: "sla",
    label: "SLA overdue",
    value: 50,
    normalized_score: 50,
    severity_hint: 50,
    confidence_hint: 80,
  }],
}));
assert(sla.state === "critical", "SLA should be critical");
assert(sla.control_level === "suggest", "SLA should suggest");

console.log(JSON.stringify({
  ok: true,
  contract: "decision_contract_v1_calibrated",
  scenarios: {
    green: { state: green.state, control: green.control_level },
    destructive: { state: destructive.state, control: destructive.control_level },
    claim: { state: claim.state, control: claim.control_level },
    sla: { state: sla.state, control: sla.control_level },
  },
}, null, 2));
