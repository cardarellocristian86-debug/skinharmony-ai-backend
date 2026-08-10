import assert from "node:assert/strict";
import test from "node:test";
import { causalRouteAuthenticatedScopes, createPostgresCausalActionLeaseVerifier } from "../src/app.js";
import { causalDigest } from "../src/causalContinuityCanonical.js";
import { SCOPES } from "../src/scope.js";

test("causal route authority is derived from authenticated platform scope, not caller fields", () => {
  assert.deepEqual(causalRouteAuthenticatedScopes("causal:read", {
    allowed_scopes: [SCOPES.READ_DECISION],
  }), ["causal:read"]);

  const write = causalRouteAuthenticatedScopes("causal:authorize", {
    allowed_scopes: [SCOPES.WRITE_DECISION],
  });
  assert(write.includes("causal:authorize"));
  assert(write.includes("causal:change:execute"));
  assert(write.includes("gallery:project"));
  assert(write.includes("causal:rollout"));
  assert(write.includes("core:govern"));
  assert.equal(write.includes("intent:approve:strategic"), false);

  const owner = causalRouteAuthenticatedScopes("causal:approve", {
    allowed_scopes: [SCOPES.WRITE_DECISION, SCOPES.OWNER_ASSERTION],
    scopes: ["caller:injected"],
  });
  assert(owner.includes("intent:approve:strategic"));
  assert.equal(owner.includes("caller:injected"), false);
});

test("causal action lease authority comes only from persisted server policy", async () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const workId = "22222222-2222-4222-8222-222222222222";
  const changeId = "33333333-3333-4333-8333-333333333333";
  const obligationId = "44444444-4444-4444-8444-444444444444";
  const leaseId = "55555555-5555-4555-8555-555555555555";
  const actorId = "agent-a";
  const sessionFingerprint = "a".repeat(24);
  const surfaces = [
    { kind: "causal_change", value: changeId },
    { kind: "causal_obligation", value: obligationId },
    { kind: "causal_project", value: projectId },
  ];
  const persistedAuthority = ["causal:change:execute", "causal:write"];
  const authorityBindingDigest = causalDigest({
    schema_version: "persisted_lease_authority_v1",
    tenant_id: "tenant-a",
    lease_id: leaseId,
    actor_id: actorId,
    purpose: "causal_context_issue",
    surfaces,
    persisted_authority_scope: persistedAuthority,
    policy_session_fingerprint: sessionFingerprint,
  });
  let persistedSurfaces = surfaces;
  let persistedSessionFingerprint = sessionFingerprint;
  let persistedDigest = authorityBindingDigest;
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM core_continuity_leases/.test(sql)) return { rows: [{
        lease_id: leaseId,
        tenant_id: "tenant-a",
        work_id: workId,
        purpose: "causal_context_issue",
        status: "active",
        expires_at: "2030-01-01T00:00:00.000Z",
        policy_authority_scope: persistedAuthority,
        policy_authority_source: "persisted_lease_policy_v1",
        policy_authority_binding_digest: persistedDigest,
        policy_session_fingerprint: persistedSessionFingerprint,
        project_uuid: projectId,
        agent_id: actorId,
        surfaces: persistedSurfaces,
      }] };
      return { rows: [{ change_id: changeId, obligation_ids: [obligationId] }] };
    },
  };
  const verify = createPostgresCausalActionLeaseVerifier(pool);
  const result = await verify({
    tenant_id: "tenant-a",
    project_id: projectId,
    work_id: workId,
    change_id: changeId,
    obligation_ids: [obligationId],
    lease_id: leaseId,
    actor_id: actorId,
    actor_session_fingerprint: sessionFingerprint,
    authority_scope: ["intent:approve:strategic", "core:govern"],
  });
  assert.deepEqual(result.persisted_authority_scope, persistedAuthority);
  assert.equal(result.authority_source, "persisted_lease_policy_v1");
  assert.equal(result.authority_binding_digest, authorityBindingDigest);
  assert.equal(result.policy_session_fingerprint, sessionFingerprint);
  assert.equal(result.authority_scope, undefined);
  assert.deepEqual(calls[0].params, ["tenant-a", workId, leaseId, actorId, projectId, sessionFingerprint]);
  assert(!calls.some((call) => call.params?.includes("intent:approve:strategic")));
  assert.match(calls[0].sql, /policy_authority_scope/);
  assert.match(calls[0].sql, /jsonb_agg/);

  persistedSurfaces = [...surfaces, {
    kind: "causal_obligation",
    value: "66666666-6666-4666-8666-666666666666",
  }];
  assert.equal(await verify({
    tenant_id: "tenant-a", project_id: projectId, work_id: workId, change_id: changeId,
    obligation_ids: [obligationId], lease_id: leaseId, actor_id: actorId, actor_session_fingerprint: sessionFingerprint,
  }), null);

  persistedSurfaces = surfaces.filter((surface) => surface.kind !== "causal_obligation");
  assert.equal(await verify({
    tenant_id: "tenant-a", project_id: projectId, work_id: workId, change_id: changeId,
    obligation_ids: [obligationId], lease_id: leaseId, actor_id: actorId, actor_session_fingerprint: sessionFingerprint,
  }), null);

  persistedSurfaces = [surfaces[2], surfaces[1], surfaces[0]];
  persistedDigest = causalDigest({
    schema_version: "persisted_lease_authority_v1", tenant_id: "tenant-a", lease_id: leaseId,
    actor_id: actorId, purpose: "causal_context_issue", surfaces: persistedSurfaces,
    persisted_authority_scope: persistedAuthority, policy_session_fingerprint: sessionFingerprint,
  });
  const reordered = await verify({
    tenant_id: "tenant-a", project_id: projectId, work_id: workId, change_id: changeId,
    obligation_ids: [obligationId], lease_id: leaseId, actor_id: actorId, actor_session_fingerprint: sessionFingerprint,
  });
  assert.equal(reordered.change_id, changeId);
  assert.deepEqual(reordered.obligation_ids, [obligationId]);

  assert.equal(await verify({
    tenant_id: "tenant-a", project_id: projectId, work_id: workId, change_id: changeId,
    obligation_ids: [obligationId], lease_id: leaseId, actor_id: actorId,
    actor_session_fingerprint: "b".repeat(24),
  }), null);
  assert.equal(await verify({
    tenant_id: "tenant-a", project_id: projectId, work_id: workId, change_id: changeId,
    obligation_ids: [obligationId], lease_id: leaseId, actor_id: actorId,
  }), null);
  persistedSessionFingerprint = null;
  assert.equal(await verify({
    tenant_id: "tenant-a", project_id: projectId, work_id: workId, change_id: changeId,
    obligation_ids: [obligationId], lease_id: leaseId, actor_id: actorId,
    actor_session_fingerprint: sessionFingerprint,
  }), null);
  persistedSessionFingerprint = sessionFingerprint;
  persistedDigest = "f".repeat(64);
  assert.equal(await verify({
    tenant_id: "tenant-a", project_id: projectId, work_id: workId, change_id: changeId,
    obligation_ids: [obligationId], lease_id: leaseId, actor_id: actorId,
    actor_session_fingerprint: sessionFingerprint,
  }), null);
  persistedDigest = authorityBindingDigest;
  assert.equal(await verify({
    tenant_id: "tenant-a", project_id: projectId, work_id: workId, change_id: changeId,
    obligation_ids: [obligationId], lease_id: leaseId, actor_id: actorId,
    actor_session_fingerprint: sessionFingerprint, policy_session_fingerprint: sessionFingerprint,
  }), null);
});
