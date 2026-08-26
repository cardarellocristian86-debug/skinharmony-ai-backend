import { runUniversalCoreDecisionV1Calibrated } from "../packages/core/src/decisionV1Calibrated.ts";
import { runUniversalCoreDecisionV2Elastic } from "../packages/core/src/decisionV2Elastic.ts";
import { runUniversalCore } from "../packages/core/src/index.ts";
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

const guardedGreen = runUniversalCoreDecisionV1Calibrated(input({
  context: { tenant_id: "codexai", metadata: { action_type: "read" } },
  signals: [{
    id: "read:guarded-green",
    source: "test",
    category: "read",
    label: "Guarded safe read",
    value: 12,
    normalized_score: 12,
    severity_hint: 12,
    confidence_hint: 94,
  }],
  constraints: { allow_automation: true, require_confirmation: false, safety_mode: true },
}));
assert(guardedGreen.control_level === "confirm", "safety mode must cap green execution at confirm");
assert(guardedGreen.execution_profile.can_execute === false, "safety mode must not leak executable output");
assert(guardedGreen.execution_profile.requires_user_confirmation === true, "safety mode must require owner confirmation");

for (const [engine, decide] of [
  ["core-v0", runUniversalCore],
  ["core-v2-elastic", runUniversalCoreDecisionV2Elastic],
] as const) {
  const guarded = decide(input({
    context: { tenant_id: "codexai", mode: "sandbox", metadata: { action_type: "read" } },
    signals: [{
      id: `read:${engine}:guarded`,
      source: "test",
      category: "read",
      label: "Guarded low-risk read",
      value: 36,
      normalized_score: 36,
      severity_hint: 36,
      confidence_hint: 94,
    }],
    constraints: { allow_automation: true, require_confirmation: false, safety_mode: true },
  }));
  assert(guarded.control_level !== "execute_allowed", `${engine} safety mode must cap execution`);
  assert(guarded.execution_profile.can_execute === false, `${engine} safety mode must not expose can_execute`);
  assert(guarded.execution_profile.requires_user_confirmation === true, `${engine} safety mode must require confirmation`);
}

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

const guardedRead = runUniversalCoreDecisionV1Calibrated(input({
  context: { tenant_id: "codexai", metadata: { action_type: "read" } },
  signals: [{
    id: "read:guarded",
    source: "test",
    category: "read",
    label: "Guarded read",
    value: 34,
    normalized_score: 34,
    severity_hint: 34,
    confidence_hint: 88,
  }],
  constraints: { allow_automation: false, require_confirmation: false, safety_mode: true },
}));
assert(!guardedRead.blocked_reasons.includes("safety_mode"), "safety mode must not become a blocker");
assert(guardedRead.diagnostics.guard_mode === "confirmation_required", "guard posture should remain observable");

console.log(JSON.stringify({
  ok: true,
  contract: "decision_contract_v1_calibrated",
  scenarios: {
    green: { state: green.state, control: green.control_level },
    guarded_green: { state: guardedGreen.state, control: guardedGreen.control_level },
    destructive: { state: destructive.state, control: destructive.control_level },
    claim: { state: claim.state, control: claim.control_level },
    sla: { state: sla.state, control: sla.control_level },
    guarded_read: { state: guardedRead.state, blocked_reasons: guardedRead.blocked_reasons },
  },
}, null, 2));
