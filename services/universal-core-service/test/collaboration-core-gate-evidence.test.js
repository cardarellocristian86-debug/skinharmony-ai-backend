import assert from "node:assert/strict";
import test from "node:test";
import {
  createCollaborationCoreGateIssuer,
  createCollaborationCoreGateVerifier,
} from "../src/collaborationCoreGateEvidence.js";

const secret = "core-gate-test-secret-that-is-at-least-32-bytes";
const targetCommit = "a".repeat(40);
const nowMs = Date.parse("2026-07-23T12:00:00.000Z");
const binding = Object.freeze({
  schema_version: "mcp_collaboration_action_binding_v1",
  audience: "https://skinharmony-core-mcp-staging.onrender.com/mcp",
  target_service: "skinharmony-core-mcp-staging",
  target_environment: "staging",
  target_commit: targetCommit,
  tenant_id: "codexai",
  actor_subject_sha256: "1".repeat(64),
  agent_id: "codex-a",
  session_id: "session-a",
  session_fingerprint: "0123456789abcdef01234567",
  agent_signature_sha256: "2".repeat(64),
  trace_id: "11111111-1111-4111-8111-111111111111",
  preflight_id: "preflight-1",
  task_contract_id: "contract-1",
  task_trace_id: "task-trace-1",
  coordination_lock: "lock-1",
  shared_memory_checksum: "3".repeat(64),
  tool_name: "task_create",
  action_type: "task.create",
  target: "Create task",
  payload_sha256: "4".repeat(64),
  expected_version: null,
  lock_id: null,
  fencing_token: null,
  idempotency_key_sha256: "5".repeat(64),
});

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

async function digestBinding(value) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256")
    .update("mcp-collaboration-binding-v1")
    .update("\0")
    .update(canonicalJson(value))
    .digest("hex");
}

const decision = Object.freeze({
  schema_version: "mcp_collaboration_core_decision_v1",
  binding_digest: await digestBinding(binding),
  allowed: true,
  decision: "authorized",
  mediation: "allow",
  confirmation_satisfied: false,
});

function gateBody() {
  return {
    action_type: binding.action_type,
    target: binding.target,
    payload_sha256: binding.payload_sha256,
    expected_version: binding.expected_version,
    lock_id: binding.lock_id,
    fencing_token: binding.fencing_token,
    idempotency_key_sha256: binding.idempotency_key_sha256,
    collaboration_audience: binding.audience,
    collaboration_target_service: binding.target_service,
    collaboration_target_environment: binding.target_environment,
    collaboration_target_commit: binding.target_commit,
    collaboration_binding_digest: decision.binding_digest,
  };
}

const authorization = Object.freeze({
  allowed: true,
  state: "authorized",
  mediation: "allow",
  confirmation_satisfied: false,
  scope: "reversible_internal_collaboration_write",
});

test("Universal Core evidence is exact-binding signed and independently verifiable", () => {
  const issuer = createCollaborationCoreGateIssuer({
    secret,
    targetCommit,
    now: () => nowMs,
  });
  const verifier = createCollaborationCoreGateVerifier({
    secret,
    targetCommit,
    now: () => nowMs + 1_000,
  });
  const envelope = issuer.issue({ tenantId: "codexai", body: gateBody(), authorization });
  const verified = verifier.verify(envelope, { binding, decision });
  assert.equal(verified.binding_digest, decision.binding_digest);
  assert.match(verified.jti, /^mcpcg_/);

  assert.throws(
    () => verifier.verify({
      ...envelope,
      claims: { ...envelope.claims, payload_sha256: "f".repeat(64) },
    }, { binding, decision }),
    /collaboration_core_gate_invalid/,
  );
  assert.throws(
    () => verifier.verify(envelope, {
      binding: { ...binding, target: "Different target" },
      decision,
    }),
    /collaboration_core_gate_invalid/,
  );
});

test("Core gate issuer refuses denied or scope-mismatched actions", () => {
  const issuer = createCollaborationCoreGateIssuer({ secret, targetCommit, now: () => nowMs });
  assert.throws(
    () => issuer.issue({
      tenantId: "codexai",
      body: gateBody(),
      authorization: { ...authorization, allowed: false },
    }),
    /collaboration_core_gate_not_authorized/,
  );
  assert.throws(
    () => issuer.issue({
      tenantId: "codexai",
      body: { ...gateBody(), collaboration_target_environment: "production" },
      authorization,
    }),
    /collaboration_core_gate_not_authorized/,
  );
});

test("Core gate evidence expires fail-closed", () => {
  const envelope = createCollaborationCoreGateIssuer({
    secret,
    targetCommit,
    now: () => nowMs,
    ttlMs: 1_000,
  }).issue({ tenantId: "codexai", body: gateBody(), authorization });
  const verifier = createCollaborationCoreGateVerifier({
    secret,
    targetCommit,
    now: () => nowMs + 1_001,
  });
  assert.throws(
    () => verifier.verify(envelope, { binding, decision }),
    /collaboration_core_gate_expired/,
  );
});
