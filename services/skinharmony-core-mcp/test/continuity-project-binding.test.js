import assert from "node:assert/strict";
import test from "node:test";
import { continuityProjectId } from "../src/continuity-project-id.js";
import { resolveContinuityProjectBinding } from "../src/continuity-project-binding.js";

test("resolves an existing Work project without mutating dynamic capability arguments", async () => {
  const identity = { tenantId: "tenant-a" };
  const args = {
    work_id: "11111111-1111-4111-8111-111111111111",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
  };
  const reads = [];
  const runtime = {
    readIntent: async (receivedIdentity, receivedArgs) => {
      reads.push({ identity: receivedIdentity, args: receivedArgs });
      return { project_id: "skinharmony-ai-backend" };
    },
  };

  const binding = await resolveContinuityProjectBinding(identity, args, runtime);

  assert.deepEqual(reads, [{
    identity,
    args: { work_id: "11111111-1111-4111-8111-111111111111" },
  }]);
  assert.equal(binding.projectId, "skinharmony-ai-backend");
  assert.equal(binding.continuityArgs.project_id, "skinharmony-ai-backend");
  assert.equal(Object.hasOwn(args, "project_id"), false);
  assert.notEqual(binding.continuityArgs, args);
});

test("preserves an explicit project so the strict Work mismatch check remains authoritative", async () => {
  const args = {
    work_id: "11111111-1111-4111-8111-111111111111",
    project_id: "different-project",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
  };
  const runtime = {
    readIntent: async () => {
      throw new Error("must_not_read_work_for_explicit_project");
    },
  };

  const binding = await resolveContinuityProjectBinding({ tenantId: "tenant-a" }, args, runtime);

  assert.equal(binding.projectId, "different-project");
  assert.equal(binding.continuityArgs, args);
});

test("propagates tenant-scoped Work lookup denial instead of falling back to repository", async () => {
  const denied = new Error("continuity_intent_anchor_not_found");
  denied.code = "continuity_intent_anchor_not_found";
  const reads = [];
  const identity = { tenantId: "tenant-b" };
  const runtime = {
    readIntent: async (receivedIdentity, receivedArgs) => {
      reads.push({ identity: receivedIdentity, args: receivedArgs });
      throw denied;
    },
  };

  await assert.rejects(
    resolveContinuityProjectBinding(identity, {
      work_id: "11111111-1111-4111-8111-111111111111",
      repository: "cardarellocristian86-debug/skinharmony-ai-backend",
    }, runtime),
    (error) => error === denied,
  );
  assert.deepEqual(reads, [{
    identity,
    args: { work_id: "11111111-1111-4111-8111-111111111111" },
  }]);
});

test("keeps the live repository fallback when no Work binding is available", async () => {
  const args = { repository: "cardarellocristian86-debug/skinharmony-ai-backend" };
  const binding = await resolveContinuityProjectBinding({ tenantId: "tenant-a" }, args, null);

  assert.equal(binding.projectId, "skinharmony-ai-backend");
  assert.equal(binding.continuityArgs, args);
  assert.equal(continuityProjectId({}), "skinharmony-ai-backend");
});

test("fails closed when a persisted Work project binding is malformed", async () => {
  const runtime = { readIntent: async () => ({ project_id: " invalid project " }) };

  await assert.rejects(
    resolveContinuityProjectBinding({ tenantId: "tenant-a" }, {
      work_id: "11111111-1111-4111-8111-111111111111",
      repository: "owner/repository",
    }, runtime),
    /continuity_project_binding_invalid/,
  );
});
