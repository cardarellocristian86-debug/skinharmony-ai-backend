import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createCoreHandlers } from "../src/core-handlers.js";
import { TOOLS } from "../src/tool-definitions.js";

const OWNER_CONTEXT_SECRET = "project-review-owner-context-secret-0123456789abcdef";

function owner(overrides = {}) {
  return {
    tenantId: "tenant-owner-a",
    kind: "oauth",
    subject: "google-oauth2|tenant-owner-a",
    role: "tenant_owner",
    providerSetupOwner: true,
    providerExecutionConfirmed: true,
    ...overrides,
  };
}

function stableCanonical(value) {
  if (Array.isArray(value)) return value.map(stableCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableCanonical(value[key]);
    return result;
  }, {});
}

function expectedBindingHash(body) {
  const binding = `tenant_openai_project_review\u0000${JSON.stringify(stableCanonical(body))}`;
  return crypto.createHash("sha256").update(binding).digest("hex");
}

function reviewArgs(overrides = {}) {
  return {
    project_id: "agent-platform",
    run_id: "run_review_01",
    expected_revision: "a".repeat(64),
    disposition: "accept_selected",
    decision_items: [{ decision: "Keep Nyra as supervisor.", rationale: "One final accountable synthesis." }],
    evidence_items: [{ claim: "The three-stage workflow completed.", source: "run_review_01 owner review" }],
    idempotency_key: "review-owner-01",
    owner_confirmed: true,
    ...overrides,
  };
}

function preparedReview() {
  return {
    schema_version: "skinharmony_project_review_v1",
    project_id: "agent-platform",
    run_id: "run_review_01",
    expected_revision: "a".repeat(64),
    disposition: "accept_selected",
    decision_items: [{ decision: "Keep Nyra as supervisor.", rationale: "One final accountable synthesis." }],
    evidence_items: [{ claim: "The three-stage workflow completed.", source: "run_review_01 owner review" }],
    idempotency_key: "review-owner-01",
    review_digest_sha256: "b".repeat(64),
  };
}

function makeHandlers({ allowed = true, responseStatus = 200, commitResult, prepareError, mutateAuthorization } = {}) {
  const coreCalls = [];
  const prepareCalls = [];
  const commitCalls = [];
  const prepared = preparedReview();
  const projectContextService = {
    prepareReview(args) {
      prepareCalls.push(args);
      if (prepareError) throw prepareError;
      return prepared;
    },
    async commitReview(identity, value) {
      commitCalls.push({ identity, value });
      return commitResult || {
        committed: true,
        idempotent: false,
        project_id: value.project_id,
        run_id: value.run_id,
        disposition: value.disposition,
        review_id: "review_01",
        revision: "c".repeat(64),
      };
    },
  };
  const handlers = createCoreHandlers({
    universalCoreUrl: "https://core.example.test",
    universalCoreKeys: { "tenant-owner-a": "tenant-owner-core-key" },
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
  }, {
    projectContextService,
    fetchImpl: async (url, init) => {
      coreCalls.push({ url, init });
      const request = JSON.parse(init.body);
      const authorization = {
        ok: responseStatus === 200,
        tenant_id: request.tenant_id,
        allowed,
        ...(allowed ? {
          authorization: {
            authorization_id: "pra_00000000-0000-4000-8000-000000000001",
            allowed: true,
            purpose: "tenant_openai_project_review",
            owner_confirmation_satisfied: true,
            binding: {
              binding_version: "owner_request_binding_v1",
              binding_hash: request.owner_context.binding_hash,
              tenant_id: request.tenant_id,
              project_id: request.project_id,
              run_id: request.run_id,
              expected_revision: request.expected_revision,
              disposition: request.disposition,
              review_digest_sha256: request.review_digest_sha256,
              decision_count: request.decision_count,
              evidence_count: request.evidence_count,
              idempotency_key: request.idempotency_key,
            },
          },
        } : {}),
      };
      const payload = typeof mutateAuthorization === "function"
        ? mutateAuthorization(structuredClone(authorization))
        : authorization;
      return new Response(JSON.stringify(payload), {
        status: responseStatus,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { handlers, prepared, coreCalls, prepareCalls, commitCalls };
}

test("project review tool has a bounded owner-only schema and native Core gate", () => {
  const tool = TOOLS.find((item) => item.name === "project_context_review_commit");
  assert(tool);
  assert.deepEqual(tool.scopes, ["core:govern"]);
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.equal(tool.annotations.idempotentHint, true);
  assert.equal(tool._meta["skinharmony/confirmation_authority"], "tenant_provider_owner");
  assert.deepEqual(tool.inputSchema.required, [
    "project_id",
    "run_id",
    "expected_revision",
    "disposition",
    "decision_items",
    "evidence_items",
    "idempotency_key",
    "owner_confirmed",
  ]);
  assert.deepEqual(tool.inputSchema.properties.disposition.enum, ["accept_selected", "reject"]);
  assert.equal(tool.inputSchema.properties.decision_items.maxItems, 10);
  assert.deepEqual(tool.inputSchema.properties.decision_items.items.required, ["decision"]);
  assert.equal(tool.inputSchema.properties.decision_items.items.properties.rationale.maxLength, 2_000);
  assert.equal(tool.inputSchema.properties.evidence_items.maxItems, 10);
  assert.deepEqual(tool.inputSchema.properties.evidence_items.items.required, ["claim", "source"]);
  assert.equal(tool.inputSchema.properties.idempotency_key.maxLength, 120);
  assert.equal(tool.inputSchema.properties.idempotency_key.pattern, "^[A-Za-z0-9][A-Za-z0-9_-]{7,119}$");
  assert.equal(tool.inputSchema.properties.owner_confirmed.type, "boolean");
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.match(tool.description, /fresh OAuth owner confirmation/i);
  assert.match(tool.description, /never copied or exposed automatically/i);
  for (const unsafe of ["tenant_id", "model_output", "final_output", "api_key", "owner_context"]) {
    assert.equal(tool.inputSchema.properties[unsafe], undefined, `must not accept ${unsafe}`);
  }
  assert.equal(tool.outputSchema.properties.committed.const, true);
});

test("project review requires an authenticated OAuth tenant owner and fresh confirmation before preparation", async () => {
  const first = makeHandlers();
  await assert.rejects(
    first.handlers.project_context_review_commit(reviewArgs(), owner({ kind: "codex" })),
    /owner_required/,
  );
  assert.equal(first.prepareCalls.length, 0);
  assert.equal(first.coreCalls.length, 0);
  assert.equal(first.commitCalls.length, 0);

  const second = makeHandlers();
  await assert.rejects(
    second.handlers.project_context_review_commit(reviewArgs(), owner({ providerExecutionConfirmed: false })),
    /owner_confirmation_required/,
  );
  assert.equal(second.prepareCalls.length, 0);
  assert.equal(second.coreCalls.length, 0);
  assert.equal(second.commitCalls.length, 0);
});

test("project review sends only digest metadata to Core, binds the exact request, then commits once", async () => {
  const state = makeHandlers();
  const args = reviewArgs({
    tenant_id: "tenant-victim-b",
    model_output: "raw owner-only model answer must never cross the Core gate",
  });
  const result = await state.handlers.project_context_review_commit(args, owner());

  assert.equal(state.prepareCalls.length, 1);
  assert.equal(state.coreCalls.length, 1);
  assert.equal(state.commitCalls.length, 1);
  const call = state.coreCalls[0];
  assert.equal(new URL(call.url).pathname, "/v1/generic-agents/providers/openai/project-reviews/authorize");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers.authorization, "Bearer tenant-owner-core-key");
  const body = JSON.parse(call.init.body);
  const safeBody = {
    tenant_id: "tenant-owner-a",
    project_id: state.prepared.project_id,
    run_id: state.prepared.run_id,
    expected_revision: state.prepared.expected_revision,
    disposition: state.prepared.disposition,
    review_digest_sha256: state.prepared.review_digest_sha256,
    decision_count: 1,
    evidence_count: 1,
    idempotency_key: state.prepared.idempotency_key,
    owner_confirmed: true,
  };
  assert.deepEqual(Object.keys(body).sort(), [...Object.keys(safeBody), "owner_context"].sort());
  for (const [key, value] of Object.entries(safeBody)) assert.deepEqual(body[key], value);
  assert.equal(body.owner_context.tenant_id, "tenant-owner-a");
  assert.equal(body.owner_context.owner_verified, true);
  assert.equal(body.owner_context.binding_hash, expectedBindingHash(safeBody));
  assert.match(body.owner_context.assertion, /^ocs_[a-f0-9]{64}$/);
  assert.match(body.owner_context.owner_subject_fingerprint, /^osf_[a-f0-9]{64}$/);
  const serializedBody = JSON.stringify(body);
  assert.equal(serializedBody.includes("Keep Nyra"), false);
  assert.equal(serializedBody.includes("three-stage workflow"), false);
  assert.equal(serializedBody.includes("raw owner-only model answer"), false);
  assert.equal(serializedBody.includes("tenant-victim-b"), false);

  assert.equal(state.commitCalls[0].identity.tenantId, "tenant-owner-a");
  assert.equal(state.commitCalls[0].value, state.prepared);
  assert.deepEqual(result.structuredContent, {
    ok: true,
    tenant_id: "tenant-owner-a",
    project_id: "agent-platform",
    run_id: "run_review_01",
    disposition: "accept_selected",
    committed: true,
    idempotent: false,
    review_id: "review_01",
    revision: "c".repeat(64),
  });
  assert.equal(JSON.stringify(result).includes("Keep Nyra"), false);
});

test("project review fails closed on Core denial or unavailability and never calls the store", async () => {
  const denied = makeHandlers({ allowed: false });
  await assert.rejects(
    denied.handlers.project_context_review_commit(reviewArgs(), owner()),
    /project_review_not_authorized/,
  );
  assert.equal(denied.coreCalls.length, 1);
  assert.equal(denied.commitCalls.length, 0);

  const unavailable = makeHandlers({ allowed: false, responseStatus: 503 });
  await assert.rejects(
    unavailable.handlers.project_context_review_commit(reviewArgs(), owner()),
    /core_request_failed:503/,
  );
  assert.equal(unavailable.coreCalls.length, 1);
  assert.equal(unavailable.commitCalls.length, 0);
});

test("project review rejects a superficially allowed but tampered Core authorization", async () => {
  for (const mutateAuthorization of [
    (payload) => ({ ...payload, tenant_id: "tenant-victim-b" }),
    (payload) => ({ ...payload, authorization: { ...payload.authorization, allowed: false } }),
    (payload) => ({ ...payload, authorization: { ...payload.authorization, purpose: "tenant_openai_multiagent_run" } }),
    (payload) => ({
      ...payload,
      authorization: {
        ...payload.authorization,
        binding: { ...payload.authorization.binding, binding_hash: "0".repeat(64) },
      },
    }),
    (payload) => ({
      ...payload,
      authorization: {
        ...payload.authorization,
        binding: { ...payload.authorization.binding, expected_revision: "d".repeat(64) },
      },
    }),
    (payload) => ({
      ...payload,
      authorization: {
        ...payload.authorization,
        binding: { ...payload.authorization.binding, unexpected: "extra-field" },
      },
    }),
  ]) {
    const tampered = makeHandlers({ mutateAuthorization });
    await assert.rejects(
      tampered.handlers.project_context_review_commit(reviewArgs(), owner()),
      /project_review_not_authorized/,
    );
    assert.equal(tampered.coreCalls.length, 1);
    assert.equal(tampered.commitCalls.length, 0);
  }
});

test("project review fails closed when project storage is absent or does not confirm its commit", async () => {
  const withoutStore = createCoreHandlers({
    universalCoreUrl: "https://core.example.test",
    universalCoreKeys: { "tenant-owner-a": "tenant-owner-core-key" },
    ownerContextSigningSecret: OWNER_CONTEXT_SECRET,
  }, {
    fetchImpl: async () => {
      throw new Error("Core must not be called");
    },
  });
  await assert.rejects(
    withoutStore.project_context_review_commit(reviewArgs(), owner()),
    /project_context_store_unavailable/,
  );

  const incomplete = makeHandlers({ commitResult: { committed: false } });
  await assert.rejects(
    incomplete.handlers.project_context_review_commit(reviewArgs(), owner()),
    /project_review_commit_failed/,
  );
  assert.equal(incomplete.commitCalls.length, 1);
});
