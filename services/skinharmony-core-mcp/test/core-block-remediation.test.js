import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { classifyRemediationResubmissionOutcome, createCoreHandlers } from "../src/core-handlers.js";
import { createCoreBlockRemediationStore } from "../src/core-block-remediation-store.js";
import { TOOLS } from "../src/tool-definitions.js";
import {
  CORE_BLOCK_CLASS,
  CORE_BLOCK_REMEDIATION_STATUS,
  buildRemediationContract,
  buildDeterministicBlockExplanation,
  classifyCoreBlock,
  evaluateEvidenceRequirements,
  proposeRemediationAttempt,
  reviewRemediationProposal,
} from "../../shared/core-block-remediation.js";

function makeTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function blockedPayload() {
  return {
    ok: false,
    authorization: {
      allowed: false,
      state: "blocked",
      mediation: "hard_block",
      decision_id: "decision-blocked",
    },
    decision_contract: {
      decision_id: "decision-blocked",
      state: "blocked",
      block_code: "MISSING_EVIDENCE",
      block_class: "correctable",
      blocked_reasons: ["MISSING_EVIDENCE"],
      policy_snapshot_digest: "policy-digest",
      contract_digest: "contract-digest",
    },
    output: {
      selected_by_core: {
        risk_band: "medium",
        unmet_conditions: ["provide evidence"],
        evidence_requirements: ["MISSING_EVIDENCE"],
        allowed_alternatives: ["prepare evidence"],
      },
      recommended_actions: [{ blocked: true, reason_code: "MISSING_EVIDENCE" }],
    },
  };
}

function allowedPayload() {
  return {
    ok: true,
    authorization: {
      allowed: true,
      state: "allowed",
      decision_id: "decision-allowed",
      execution_allowed: false,
    },
    decision_contract: {
      decision_id: "decision-allowed",
      state: "allowed",
      decision_digest: "digest-allowed",
    },
    output: {
      selected_by_core: {
        risk_band: "low",
      },
    },
  };
}

function confirmationPayload() {
  const payload = blockedPayload();
  payload.authorization.state = "CONFIRM";
  payload.authorization.mediation = "confirm";
  payload.decision_contract.state = "CONFIRM";
  payload.decision_contract.block_code = "MISSING_OWNER_CONFIRMATION";
  payload.decision_contract.block_class = "confirmation_required";
  payload.output.recommended_actions = [{ blocked: true, reason_code: "MISSING_OWNER_CONFIRMATION" }];
  return payload;
}

test("classifies exact block codes and preserves deterministic explanation", () => {
  assert.equal(classifyCoreBlock({ block_code: "MISSING_EVIDENCE" }).blockClass, CORE_BLOCK_CLASS.CORRECTABLE);
  assert.equal(classifyCoreBlock({ block_code: "MISSING_OWNER_CONFIRMATION" }).blockClass, CORE_BLOCK_CLASS.CONFIRMATION_REQUIRED);
  assert.equal(classifyCoreBlock({ block_code: "TENANT_SCOPE_VIOLATION" }).blockClass, CORE_BLOCK_CLASS.ABSOLUTE);
  assert.equal(classifyCoreBlock({ block_code: "ACTIVE_LEASE_CONFLICT" }).blockClass, CORE_BLOCK_CLASS.TRANSIENT);
  assert.equal(classifyCoreBlock({ block_code: "MISSING_EVIDENCE_AND_MORE" }).blockClass, CORE_BLOCK_CLASS.MANUAL_REVIEW);
  assert.equal(classifyCoreBlock({ block_code: "FALSE_COMPLETION_CLAIM" }).blockClass, CORE_BLOCK_CLASS.CORRECTABLE);
  assert.equal(classifyCoreBlock({ block_code: "CONCURRENT_WRITE_CONFLICT" }).blockClass, CORE_BLOCK_CLASS.TRANSIENT);
  assert.equal(classifyCoreBlock({ block_code: "MODEL_UNCERTAINTY_TOO_HIGH" }).blockClass, CORE_BLOCK_CLASS.CONFIRMATION_REQUIRED);
  assert.equal(classifyCoreBlock({ block_code: "PROMPT_INJECTION_DETECTED" }).blockClass, CORE_BLOCK_CLASS.ABSOLUTE);
  assert.equal(classifyCoreBlock({ block_code: "PROMPT_INJECTION_DETECTED_MORE" }).blockClass, CORE_BLOCK_CLASS.MANUAL_REVIEW);

  const explanation = buildDeterministicBlockExplanation({
    remediation_id: "cbr_test",
    bound_scope: { operation_type: "deploy" },
    continuation_scope: { allowed_capabilities: ["read_work_context"] },
    original_decision: {
      decision_id: "decision-1",
      block_code: "MISSING_EVIDENCE",
      block_class: CORE_BLOCK_CLASS.CORRECTABLE,
      reasons: ["missing evidence"],
      unmet_conditions: ["evidence"],
      allowed_alternatives: ["prepare evidence"],
      same_action_retry_allowed: true,
      owner_confirmation_required: false,
    },
  });
  assert.equal(explanation.recommended_next_action, "prepare_remediation_proposal");
  assert.deepEqual(explanation.what_may_continue, ["read_work_context"]);
});

test("closed remediation rejects new attempts and evidence requirements require exact digests", async () => {
  const closed = {
    remediation_id: "cbr-closed",
    tenant_id: "codexai",
    work_id: "work-closed",
    status: CORE_BLOCK_REMEDIATION_STATUS.CLOSED,
    attempt_count: 0,
    max_attempts: 3,
    attempts: [],
  };
  assert.throws(() => proposeRemediationAttempt({
    remediation: closed,
    proposal: { proposal_type: "same_action_remediation", summary: "retry closed work" },
  }), /remediation_proposal_state_invalid/);

  const requiredDigest = "a".repeat(64);
  assert.equal(evaluateEvidenceRequirements({
    requirements: [requiredDigest],
    evidence: [`prefix-${requiredDigest}-suffix`],
  }), false);
  assert.equal(evaluateEvidenceRequirements({
    requirements: [requiredDigest],
    evidence: [{ evidence_digest: requiredDigest }],
  }), true);
});

test("confirmation blocks start waiting for owner and Core CONFIRM remains waiting", () => {
  const contract = buildRemediationContract({
    decision: { decision_id: "decision-confirm", verdict: "CONFIRM", max_attempts: 3 },
    classification: classifyCoreBlock({ block_code: "MISSING_OWNER_CONFIRMATION" }),
    boundScope: { target_system: "render", operation_type: "deploy", resource_ids: [],
      repository: null, ref: null, environment: "staging", scope_digest: "scope-confirm" },
    continuationScope: { mode: "analysis_only", allowed_capabilities: [], blocked_capabilities: [], external_actions_allowed: false },
    workContext: { tenant_id: "codexai", work_id: "work-confirm" },
    actor: { subject: "agent-confirm" },
    now: () => new Date("2026-08-03T12:00:00.000Z"),
  });
  assert.equal(contract.status, CORE_BLOCK_REMEDIATION_STATUS.WAITING_OWNER);
  const outcome = classifyRemediationResubmissionOutcome({
    authorization: { allowed: false, state: "CONFIRM", confirmation_required: true },
    decision_contract: { decision_id: "decision-confirm-new", verdict: "CONFIRM" },
  });
  assert.equal(outcome.allowed, false);
  assert.equal(outcome.confirmationRequired, true);
  assert.equal(outcome.status, CORE_BLOCK_REMEDIATION_STATUS.WAITING_OWNER);
});

test("proposal summary and diagnosis root cause redact credential forms", () => {
  const remediation = {
    remediation_id: "cbr-redact", tenant_id: "codexai", work_id: "work-redact",
    status: CORE_BLOCK_REMEDIATION_STATUS.OPEN, attempt_count: 0, max_attempts: 3, attempts: [],
  };
  const attempt = proposeRemediationAttempt({ remediation, actor: { tenant_id: "codexai" },
    idempotencyKey: "idem-redact", proposal: {
      proposal_type: "same_action_remediation", summary: "github_pat_11AA22BB33CC44DD55EE66FF",
      scope: {}, tests: [],
    }, diagnosis: {
      root_cause: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz",
    } });
  const serialized = JSON.stringify(attempt);
  assert.equal(serialized.includes("github_pat_"), false);
  assert.equal(serialized.includes("eyJhbGci"), false);
  assert.match(serialized, /REDACTED_SECRET/);
});

test("request-bound owner route moves waiting_owner through a fresh Core ALLOW", async (t) => {
  const root = makeTempRoot("core-block-owner-route-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.example", universalCoreKey: "x".repeat(64), universalCoreKeys: {},
    defaultTenantId: "codexai", tenantGatewayKey: "y".repeat(64), tenantContextSigningSecret: "z".repeat(64),
    ownerContextSigningSecret: "o".repeat(64), coreBlockRemediationMode: "active",
    coreBlockRemediationMaxAttempts: 3, sharedMemoryRoot: root, agentWorkspaceRoot: root,
  }, { fetchImpl: async (_url, init = {}) => {
    const body = JSON.parse(init.body || "{}"); calls.push(body);
    const response = body.remediation_context ? allowedPayload() : confirmationPayload();
    return { ok: body.remediation_context, status: body.remediation_context ? 200 : 403,
      json: async () => response };
  } });
  const worker = { tenantId: "codexai", kind: "connected_ai", subject: "worker-owner-route" };
  const blocked = await handlers.core_gate_action({ action_label: "Deploy", action_type: "deploy",
    operation_class: "release", work_id: "work-owner-route", target_system: "render", environment: "staging" }, worker);
  const remediation = blocked.structuredContent.remediation;
  assert.equal(remediation.status, CORE_BLOCK_REMEDIATION_STATUS.WAITING_OWNER);
  const proposed = await handlers.core_block_remediation_propose({ remediation_id: remediation.remediation_id,
    expected_version: remediation.version, idempotency_key: "owner-route-proposal", diagnosis: {
      root_cause: "request-bound owner confirmation required", evidence: [], unknowns: [], affected_components: [],
    }, proposal: { proposal_type: "owner_confirmation_route", summary: "Obtain exact owner confirmation",
      scope: {}, changes: [], tests: [], evidence: [], rollback: { available: false },
      conditions_addressed: ["MISSING_OWNER_CONFIRMATION"], residual_risks: [], alternative_only: false } }, worker);
  const attempt = proposed.structuredContent.remediation.latest_attempt;
  const owner = { ...worker, kind: "oauth", oauthOwnerElevated: true, ownerConfirmed: true,
    confirmationReference: "owner-confirmed-exact-remediation" };
  const result = await handlers.core_block_remediation_resubmit({ remediation_id: remediation.remediation_id,
    attempt_id: attempt.attempt_id }, owner);
  assert.equal(result.structuredContent.remediation.status, CORE_BLOCK_REMEDIATION_STATUS.ALLOWED);
  assert.equal(calls.at(-1).owner_confirmed, true);
  assert.equal(calls.at(-1).owner_context.owner_verified, true);
  assert.equal(calls.at(-1).remediation_context.proposal_digest, attempt.proposal_digest);
});

test("Nyra review is bound to the latest attempt and its proposal digest", async () => {
  const oldAttempt = { attempt_id: "attempt-old", proposal_digest: "digest-old" };
  const latestAttempt = {
    attempt_id: "attempt-latest",
    proposal_digest: "digest-latest",
    proposal_type: "same_action_remediation",
    scope: {},
    evidence: [],
    tests: [],
    rollback: {},
  };
  const remediation = {
    remediation_id: "cbr-review-binding",
    tenant_id: "codexai",
    attempts: [oldAttempt, latestAttempt],
    bound_scope: { scope_digest: "not-a-matching-digest", operation_type: "inspect" },
    original_decision: {
      block_class: CORE_BLOCK_CLASS.CORRECTABLE,
      risk_band: "low",
      evidence_requirements: [],
    },
  };
  assert.throws(() => reviewRemediationProposal({
    remediation,
    attempt: oldAttempt,
    actor: { kind: "nyra", tenant_id: "codexai" },
  }), /latest_attempt_required/);

  const review = await reviewRemediationProposal({
    remediation,
    attempt: latestAttempt,
    actor: { kind: "nyra", tenant_id: "codexai" },
  });
  assert.equal(review.reviewed_attempt_id, latestAttempt.attempt_id);
  assert.equal(review.reviewed_proposal_digest, latestAttempt.proposal_digest);
  assert.notEqual(review.reviewed_proposal_digest, "digest-tampered");
});

test("publishes the remediation capabilities in the MCP catalog", () => {
  const names = new Set(TOOLS.map((tool) => tool.name));
  for (const name of [
    "core_block_remediation_status",
    "core_block_remediation_explain",
    "core_block_remediation_propose",
    "core_block_remediation_review",
    "core_block_remediation_resubmit",
    "core_block_remediation_cancel",
  ]) {
    assert.equal(names.has(name), true);
  }
});

test("shadow is observational, active enables writes, and disabled preserves the legacy block response", async (t) => {
  const root = makeTempRoot("core-block-remediation-modes-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const identity = { tenantId: "codexai", kind: "connected_ai", subject: "agent-mode-test" };
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => blockedPayload() });
  const baseConfig = {
    universalCoreUrl: "https://core.example",
    tenantGatewayKey: "g".repeat(64),
    tenantContextSigningSecret: "z".repeat(64),
    ownerContextSigningSecret: "o".repeat(64),
    coreBlockRemediationMaxAttempts: 3,
    coreBlockRemediationTransientRetryLimit: 2,
    sharedMemoryRoot: root,
    agentWorkspaceRoot: root,
  };
  const action = {
    action_label: "Inspect blocked deploy",
    action_type: "deploy",
    work_id: "work-mode-test",
    target_system: "render",
    environment: "staging",
  };

  const shadow = createCoreHandlers({ ...baseConfig, coreBlockRemediationMode: "shadow" }, { fetchImpl });
  const shadowBlocked = await shadow.core_gate_action(action, identity);
  assert.equal(shadowBlocked.structuredContent.state, "blocked_with_remediation");
  const remediationId = shadowBlocked.structuredContent.remediation.remediation_id;
  const shadowStatus = await shadow.core_block_remediation_status({ remediation_id: remediationId }, identity);
  assert.equal(shadowStatus.structuredContent.remediation.status, "open");
  for (const [name, args] of [
    ["core_block_remediation_propose", { remediation_id: remediationId }],
    ["core_block_remediation_review", { remediation_id: remediationId }],
    ["core_block_remediation_resubmit", { remediation_id: remediationId }],
    ["core_block_remediation_cancel", { remediation_id: remediationId }],
  ]) {
    await assert.rejects(() => shadow[name](args, identity), /core_block_remediation_active_mode_required/);
  }

  const draftRoot = makeTempRoot("core-block-remediation-draft-legacy-");
  t.after(() => fs.rmSync(draftRoot, { recursive: true, force: true }));
  const draft = createCoreHandlers({
    ...baseConfig,
    sharedMemoryRoot: draftRoot,
    agentWorkspaceRoot: draftRoot,
    coreBlockRemediationMode: "shadow",
    aiWorkQualityMode: "draft",
  }, { fetchImpl });
  const draftLegacyBlocked = await draft.core_gate_action({ ...action, work_id: "work-draft-legacy" }, identity);
  await assert.rejects(() => draft.core_block_remediation_propose({
    remediation_id: draftLegacyBlocked.structuredContent.remediation.remediation_id,
  }, identity), /core_block_remediation_active_mode_required/);

  const disabledRoot = makeTempRoot("core-block-remediation-disabled-");
  t.after(() => fs.rmSync(disabledRoot, { recursive: true, force: true }));
  const disabled = createCoreHandlers({
    ...baseConfig,
    sharedMemoryRoot: disabledRoot,
    agentWorkspaceRoot: disabledRoot,
    coreBlockRemediationMode: "disabled",
  }, { fetchImpl });
  const disabledBlocked = await disabled.core_gate_action({ ...action, work_id: "work-disabled" }, identity);
  assert.equal(disabledBlocked.structuredContent.authorization.allowed, false);
  assert.equal(disabledBlocked.structuredContent.state, undefined);
  assert.equal(disabledBlocked.structuredContent.remediation, undefined);
  assert.equal(fs.existsSync(`${disabledRoot}/core-block-remediations`), false);
});

test("core gate opens remediation on block and resubmits through a new Core request", async (t) => {
  const root = makeTempRoot("core-block-remediation-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const fetchCalls = [];
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    fetchCalls.push({ url, body });
    if (body.remediation_context) return { ok: true, status: 200, json: async () => allowedPayload() };
    return { ok: false, status: 403, json: async () => blockedPayload() };
  };

  const config = {
    universalCoreUrl: "https://core.example",
    universalCoreKey: "x".repeat(64),
    universalCoreKeys: {},
    defaultTenantId: "codexai",
    tenantGatewayKey: "y".repeat(64),
    tenantContextSigningSecret: "z".repeat(64),
    ownerContextSigningSecret: "o".repeat(64),
    coreBlockRemediationMode: "active",
    coreBlockRemediationMaxAttempts: 3,
    coreBlockRemediationTransientRetryLimit: 2,
    sharedMemoryRoot: root,
    agentWorkspaceRoot: root,
  };

  const ledgerEvents = [];
  const ledgerContexts = [];
  const handlers = createCoreHandlers(config, {
    fetchImpl,
    decisionLedger: {
      startWork: async (identity, toolName, args) => {
        const context = {
          tenantId: identity.tenantId,
          workId: crypto.randomUUID(),
          traceId: crypto.randomUUID(),
          toolName,
          agentId: args.agent_id,
        };
        ledgerContexts.push({ identity, toolName, args, context });
        ledgerEvents.push({ context, event_type: "work_received", sequence_number: 1 });
        return context;
      },
      append: async (context, eventType, input) => {
        assert.equal(context.tenantId, "codexai");
        assert.equal(context.toolName, "core_block_remediation");
        assert.equal(typeof eventType, "string");
        assert.equal(typeof input, "object");
        const sequenceNumber = ledgerEvents.filter((event) => event.context.workId === context.workId).length + 1;
        ledgerEvents.push({ context, event_type: eventType, sequence_number: sequenceNumber, ...input });
      },
    },
  });

  const identity = { tenantId: "codexai", kind: "connected_ai", subject: "agent-1" };

  const blocked = await handlers.core_gate_action({
    action_label: "Deploy service",
    action_type: "deploy",
    operation_class: "release",
    project_id: "project-a",
    session_id: "session-a",
    work_id: "work-a",
    target_system: "render",
    environment: "staging",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
    ref: "feature/core-block-remediation-v1",
  }, identity);

  assert.equal(blocked.structuredContent.state, "blocked_with_remediation");
  assert.equal(blocked.structuredContent.allowed, false);
  assert.equal(blocked.structuredContent.remediation.block_class, CORE_BLOCK_CLASS.CORRECTABLE);
  assert.equal(blocked.structuredContent.remediation.can_continue_analysis, true);
  assert.equal(fetchCalls[0].body.request_id.startsWith("action_"), true);

  const remediationId = blocked.structuredContent.remediation.remediation_id;
  const status = await handlers.core_block_remediation_status({ remediation_id: remediationId }, identity);
  assert.equal(status.structuredContent.remediation.remediation_id, remediationId);
  assert.equal(status.structuredContent.remediation.status, "open");

  const proposal = {
    proposal_type: "same_action_remediation",
    summary: "Add the missing evidence and retry the same deploy path.",
    scope: {
      target_system: "render",
      operation_type: "deploy",
      operation_class: "release",
      resource_ids: [],
      repository: "cardarellocristian86-debug/skinharmony-ai-backend",
      ref: "feature/core-block-remediation-v1",
      environment: "staging",
    },
    changes: [
      {
        component: "tests",
        path: "services/skinharmony-core-mcp/test/core-block-remediation.test.js",
        change: "Add remediation coverage",
        reason: "Provide evidence for the blocked deploy.",
      },
    ],
    tests: [
      {
        name: "remediation smoke",
        type: "integration",
        command: "node --test services/skinharmony-core-mcp/test/core-block-remediation.test.js",
        expected_result: "passes",
      },
    ],
    evidence: ["MISSING_EVIDENCE"],
    rollback: { available: true, steps: ["restore previous revision"], trigger_conditions: ["regression"] },
    conditions_addressed: ["MISSING_EVIDENCE"],
    residual_risks: ["manual review may still be needed"],
    alternative_only: false,
  };

  const proposed = await handlers.core_block_remediation_propose({
    remediation_id: remediationId,
    expected_version: status.structuredContent.remediation.version,
    idempotency_key: "idem-1",
    diagnosis: {
      root_cause: "missing evidence before deploy",
      evidence: ["evidence missing"],
      unknowns: ["none"],
      affected_components: ["core"],
    },
    proposal,
  }, identity);

  const attempt = proposed.structuredContent.remediation.latest_attempt;
  assert.equal(attempt.proposal_type, "same_action_remediation");
  assert.equal(proposed.structuredContent.remediation.status, "proposal_ready");
  const eventsBeforeReplay = ledgerEvents.length;

  const repeated = await handlers.core_block_remediation_propose({
    remediation_id: remediationId,
    expected_version: proposed.structuredContent.remediation.version,
    idempotency_key: "idem-1",
    diagnosis: {
      root_cause: "missing evidence before deploy",
      evidence: ["evidence missing"],
      unknowns: ["none"],
      affected_components: ["core"],
    },
    proposal,
  }, identity);
  assert.equal(repeated.structuredContent.ok, true);
  assert.equal(repeated.structuredContent.idempotent, true);
  assert.equal(ledgerEvents.length, eventsBeforeReplay);

  await assert.rejects(() => handlers.core_block_remediation_status({
    remediation_id: remediationId,
  }, { tenantId: "other-tenant", kind: "connected_ai", subject: "agent-2" }), /not_found/);
  assert.equal(ledgerEvents.length, eventsBeforeReplay);

  await assert.rejects(() => handlers.core_block_remediation_propose({
    remediation_id: remediationId,
    expected_version: proposed.structuredContent.remediation.version,
    idempotency_key: "idem-1",
    diagnosis: {
      root_cause: "different payload",
      evidence: ["different"],
      unknowns: [],
      affected_components: ["core"],
    },
    proposal: {
      proposal_type: "same_action_remediation",
      summary: "Different payload",
      scope: {
        target_system: "render",
        operation_type: "deploy",
        operation_class: "release",
        repository: "cardarellocristian86-debug/skinharmony-ai-backend",
        ref: "feature/core-block-remediation-v1",
        environment: "staging",
      },
      changes: [],
      tests: [
        { name: "remediation smoke", type: "integration", expected_result: "passes" },
      ],
      evidence: ["MISSING_EVIDENCE"],
      rollback: { available: true, steps: ["restore previous revision"], trigger_conditions: ["regression"] },
      conditions_addressed: ["MISSING_EVIDENCE"],
      residual_risks: [],
      alternative_only: false,
    },
  }, identity), /core_block_remediation_replay_rejected/);

  const review = await handlers.core_block_remediation_review({
    remediation_id: remediationId,
    attempt_id: attempt.attempt_id,
  }, { tenantId: "codexai", kind: "nyra", subject: "nyra-supervisor" });
  assert.equal(review.structuredContent.review.status, "approve_for_core");

  const bindingStore = createCoreBlockRemediationStore(config, { root });
  const beforeTamper = await bindingStore.findById({ tenant_id: "codexai", remediation_id: remediationId });
  await bindingStore.update({
    tenant_id: "codexai",
    remediation_id: remediationId,
    expected_version: beforeTamper.version,
    mutate: async (current) => {
      current.attempts.at(-1).proposal_digest = "tampered-proposal-digest";
      return current;
    },
  });
  await assert.rejects(() => handlers.core_block_remediation_resubmit({
    remediation_id: remediationId,
    attempt_id: attempt.attempt_id,
  }, identity), /nyra_review_attempt_binding_mismatch/);
  const afterTamper = await bindingStore.findById({ tenant_id: "codexai", remediation_id: remediationId });
  await bindingStore.update({
    tenant_id: "codexai",
    remediation_id: remediationId,
    expected_version: afterTamper.version,
    mutate: async (current) => {
      current.attempts.at(-1).proposal_digest = attempt.proposal_digest;
      return current;
    },
  });

  const resubmitted = await handlers.core_block_remediation_resubmit({
    remediation_id: remediationId,
    attempt_id: attempt.attempt_id,
  }, identity);
  assert.equal(resubmitted.structuredContent.remediation.status, "allowed");
  assert.equal(resubmitted.structuredContent.remediation.core_response.authorization.allowed, true);
  assert.equal(fetchCalls.some((call) => Boolean(call.body.remediation_context)), true);

  const cancel = await handlers.core_block_remediation_cancel({
    remediation_id: remediationId,
    reason: "cleanup",
  }, identity);
  assert.equal(cancel.structuredContent.remediation.status, "cancelled");
  for (const eventType of [
    "core_block_remediation_opened",
    "core_block_proposal_submitted",
    "core_block_remediation_allowed",
    "core_block_remediation_cancelled",
  ]) {
    assert.ok(ledgerEvents.some((event) => event.event_type === eventType), eventType);
  }
  assert.equal(ledgerContexts.length, 1);
  assert.equal(new Set(ledgerEvents.map((event) => event.context.workId)).size, 1);
  assert.deepEqual(ledgerEvents.map((event) => event.sequence_number), ledgerEvents.map((_, index) => index + 1));
  assert.ok(ledgerEvents.filter((event) => event.event_type !== "work_received")
    .every((event) => event.metadata.remediation_work_id));
});
