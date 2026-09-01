import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import {
  createOwnerManualEffectWorkBindingResolver,
} from "../src/owner-manual-effect-work-binding.js";
import {
  genericWorkCoreJoinDigest,
} from "../../universal-core-service/src/genericWorkCoreJoin.js";

const TENANT_ID = "tenant-a";
const PROJECT_ID = "project-a";
const REPOSITORY = "owner/repo";
const WORK_A = "14794fa6-2cdc-5f6a-8e68-211ff12c8cc6";
const WORK_B = "24794fa6-2cdc-5f6a-8e68-211ff12c8cc6";
const INTENT_A = "a".repeat(64);
const INTENT_B = "b".repeat(64);
const UPDATED_AT = "2026-08-31T10:00:00.000Z";

function githubReference(pullRequest) {
  return {
    repository: REPOSITORY,
    pull_request: pullRequest,
    base_branch: "main",
    base_commit: "1".repeat(40),
    head_commit: "2".repeat(40),
    merge_commit: "3".repeat(40),
    required_checks: ["core-mcp", "universal-core"],
    required_checks_policy_digest: "4".repeat(64),
  };
}

function nyraCoreReference({
  path = "allowed/repair.js",
  commit = "5".repeat(40),
  repairActionId = "nra_work-a-repair",
  repairActionDigest = "6".repeat(64),
  repairReceiptId = "nrr_work-a-repair",
  repairReceiptDigest = "7".repeat(64),
} = {}) {
  return {
    repository: REPOSITORY,
    branch: "main",
    path,
    commit,
    repair_action_id: repairActionId,
    repair_action_digest: repairActionDigest,
    repair_receipt_id: repairReceiptId,
    repair_receipt_digest: repairReceiptDigest,
  };
}

function effectBinding({
  work_id,
  intent_anchor_digest,
  mode = "OWNER_MANUAL",
  adapter_id = "github",
  effect_type = "github.merge",
  resource_id = `github:${REPOSITORY}`,
  effect_reference,
}) {
  return {
    work_id,
    intent_anchor_digest,
    mode,
    adapter_id,
    effect_type,
    resource_id,
    effect_reference,
  };
}

function policy(effect_bindings, overrides = {}) {
  return {
    schema_version: "owner_manual_effect_policies_v1",
    policies: [{
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      repository: REPOSITORY,
      effects: [{
        adapter_id: "github",
        effect_type: "github.merge",
        resource_id: `github:${REPOSITORY}`,
      }],
      break_glass: {
        resource_id: "nyra_core:skinharmony-core",
        branch: "main",
        allowed_path_prefixes: ["allowed", ".github/workflows"],
      },
      effect_bindings,
      ...overrides,
    }],
  };
}

function configured(effect_bindings, overrides = {}) {
  return loadConfig({
    OWNER_MANUAL_EFFECT_POLICIES_JSON: JSON.stringify(policy(effect_bindings, overrides)),
  });
}

function work(work_id, intent_digest) {
  return {
    tenant_id: TENANT_ID,
    work_id,
    project_id: PROJECT_ID,
    intent_digest,
    architecture: { repository: REPOSITORY },
    status: "ACTIVE",
    updated_at: UPDATED_AT,
  };
}

function resolverFor(config, works) {
  return createOwnerManualEffectWorkBindingResolver({
    config,
    requireTenantWorkCapability: () => {},
    withTenantWorkAcl: (identity) => ({ ...identity, tenant_work_acl: { read: true } }),
    resolveStandingReleaseIntentBinding: async (_identity, workId) => ({
      intent_anchor_digest: works.get(workId).intent_digest,
    }),
    readWork: async (_identity, { work_id }) => ({ work: structuredClone(works.get(work_id)) }),
    now: () => Date.parse("2026-08-31T10:00:01.000Z"),
  });
}

function issueRequest(work_id, intent_anchor_digest, reference) {
  return {
    phase: "issue",
    work_id,
    intent_anchor_digest,
    mode: "OWNER_MANUAL",
    scope: {
      adapter_ids: ["github"],
      effect_types: ["github.merge"],
      resource_ids: [`github:${REPOSITORY}`],
      effect_reference_digests: [genericWorkCoreJoinDigest(reference)],
    },
    effect_ceiling: ["github.merge"],
  };
}

test("manual effect resolver binds descriptor to its exact Work, rejecting same-repository Work A / PR B substitution", async () => {
  const referenceA = githubReference(101);
  const referenceB = githubReference(202);
  const config = configured([
    effectBinding({ work_id: WORK_A, intent_anchor_digest: INTENT_A, effect_reference: referenceA }),
    effectBinding({ work_id: WORK_B, intent_anchor_digest: INTENT_B, effect_reference: referenceB }),
  ]);
  const works = new Map([
    [WORK_A, work(WORK_A, INTENT_A)],
    [WORK_B, work(WORK_B, INTENT_B)],
  ]);
  const resolver = resolverFor(config, works);
  const identity = { tenantId: TENANT_ID };

  const allowed = await resolver(identity, {
    phase: "reconcile",
    work_id: WORK_A,
    intent_anchor_digest: INTENT_A,
    mode: "OWNER_MANUAL",
    selector: {
      adapter_id: "github",
      effect_type: "github.merge",
      resource_id: `github:${REPOSITORY}`,
    },
    effect_reference: referenceA,
  });
  assert.deepEqual(allowed.effect_reference, referenceA);
  assert.equal(allowed.work_binding.allowed_effect_tuples[0].effect_reference_digest,
    genericWorkCoreJoinDigest(referenceA));

  await assert.rejects(
    resolver(identity, issueRequest(WORK_A, INTENT_A, referenceB)),
    /owner_manual_effect_work_binding_effect_unbound/,
  );
  const omittedDigestScope = issueRequest(WORK_A, INTENT_A, referenceA);
  delete omittedDigestScope.scope.effect_reference_digests;
  await assert.rejects(
    resolver(identity, omittedDigestScope),
    /owner_manual_effect_work_binding_scope_invalid/,
  );
  const alternateScope = issueRequest(WORK_A, INTENT_A, referenceA);
  alternateScope.scope.untrusted_effect_reference = referenceB;
  await assert.rejects(
    resolver(identity, alternateScope),
    /owner_manual_effect_work_binding_scope_invalid/,
  );
  await assert.rejects(
    resolver(identity, {
      phase: "reconcile",
      work_id: WORK_A,
      intent_anchor_digest: INTENT_A,
      mode: "OWNER_MANUAL",
      selector: {
        adapter_id: "github",
        effect_type: "github.merge",
        resource_id: `github:${REPOSITORY}`,
      },
      effect_reference: referenceB,
    }),
    /owner_manual_effect_work_binding_effect_unbound/,
  );
});

test("break-glass paths are canonical relative POSIX paths in both deployment policy and caller assertion", async () => {
  const breakGlassBinding = effectBinding({
    work_id: WORK_A,
    intent_anchor_digest: INTENT_A,
    mode: "OWNER_BREAK_GLASS",
    adapter_id: "nyra_core",
    effect_type: "nyra_core.self_repair.commit",
    resource_id: "nyra_core:skinharmony-core",
    effect_reference: nyraCoreReference(),
  });
  const invalidPaths = [
    "allowed/../secret",
    "allowed//secret",
    "/allowed/secret",
    "allowed/secret/",
    "allowed\\secret",
    "allowed\u0000/secret",
    "allowed/%2e%2e/secret",
    "allowed/%2fsecret",
    "allowed/./secret",
  ];
  for (const path of invalidPaths) {
    assert.throws(() => configured([breakGlassBinding], {
      break_glass: {
        resource_id: "nyra_core:skinharmony-core",
        branch: "main",
        allowed_path_prefixes: [path],
      },
    }), /break_glass invalid/);
  }
  for (const path of invalidPaths) {
    assert.throws(() => configured([{
      ...breakGlassBinding,
      effect_reference: { ...breakGlassBinding.effect_reference, path },
    }]), /effect_binding invalid/);
  }

  const config = configured([breakGlassBinding]);
  const resolver = resolverFor(config, new Map([[WORK_A, work(WORK_A, INTENT_A)]]));
  await assert.rejects(
    resolver({ tenantId: TENANT_ID }, {
      phase: "reconcile",
      work_id: WORK_A,
      intent_anchor_digest: INTENT_A,
      mode: "OWNER_BREAK_GLASS",
      selector: {
        adapter_id: "nyra_core",
        effect_type: "nyra_core.self_repair.commit",
        resource_id: "nyra_core:skinharmony-core",
      },
      effect_reference: {
        ...breakGlassBinding.effect_reference,
        path: "allowed/../secret",
      },
    }),
    /owner_manual_effect_break_glass_reference_denied/,
  );
});

test("break-glass binds an immutable Nyra/Core action and signed receipt to one exact Work", async () => {
  const referenceA = nyraCoreReference();
  const referenceB = nyraCoreReference({
    repairActionId: "nra_work-b-repair",
    repairActionDigest: "8".repeat(64),
    repairReceiptId: "nrr_work-b-repair",
    repairReceiptDigest: "9".repeat(64),
  });
  const bindingA = effectBinding({
    work_id: WORK_A,
    intent_anchor_digest: INTENT_A,
    mode: "OWNER_BREAK_GLASS",
    adapter_id: "nyra_core",
    effect_type: "nyra_core.self_repair.commit",
    resource_id: "nyra_core:skinharmony-core",
    effect_reference: referenceA,
  });
  const bindingB = effectBinding({
    work_id: WORK_B,
    intent_anchor_digest: INTENT_B,
    mode: "OWNER_BREAK_GLASS",
    adapter_id: "nyra_core",
    effect_type: "nyra_core.self_repair.commit",
    resource_id: "nyra_core:skinharmony-core",
    // Deliberately the same repository/path/commit as Work A: only the
    // completed Nyra action and its signed receipt distinguish the repair.
    effect_reference: referenceB,
  });
  const config = configured([bindingA, bindingB]);
  const resolver = resolverFor(config, new Map([
    [WORK_A, work(WORK_A, INTENT_A)],
    [WORK_B, work(WORK_B, INTENT_B)],
  ]));
  const identity = { tenantId: TENANT_ID };

  const allowed = await resolver(identity, {
    phase: "reconcile",
    work_id: WORK_A,
    intent_anchor_digest: INTENT_A,
    mode: "OWNER_BREAK_GLASS",
    selector: {
      adapter_id: "nyra_core",
      effect_type: "nyra_core.self_repair.commit",
      resource_id: "nyra_core:skinharmony-core",
    },
    effect_reference: referenceA,
  });
  assert.deepEqual(allowed.effect_reference, referenceA);

  await assert.rejects(
    resolver(identity, {
      phase: "reconcile",
      work_id: WORK_A,
      intent_anchor_digest: INTENT_A,
      mode: "OWNER_BREAK_GLASS",
      selector: {
        adapter_id: "nyra_core",
        effect_type: "nyra_core.self_repair.commit",
        resource_id: "nyra_core:skinharmony-core",
      },
      effect_reference: referenceB,
    }),
    /owner_manual_effect_work_binding_effect_unbound/,
  );

  assert.throws(() => configured([bindingA, {
    ...bindingB,
    effect_reference: {
      ...referenceB,
      repair_action_id: referenceA.repair_action_id,
      repair_action_digest: referenceA.repair_action_digest,
    },
  }]), /effect_binding repair action reused/);
  assert.throws(() => configured([bindingA, {
    ...bindingB,
    effect_reference: {
      ...referenceB,
      repair_action_id: referenceA.repair_action_id,
      repair_action_digest: "c".repeat(64),
    },
  }]), /effect_binding repair action reused/);
  assert.throws(() => configured([bindingA, {
    ...bindingB,
    effect_reference: {
      ...referenceB,
      repair_receipt_id: referenceA.repair_receipt_id,
      repair_receipt_digest: referenceA.repair_receipt_digest,
    },
  }]), /effect_binding repair receipt reused/);
  assert.throws(() => configured([bindingA, {
    ...bindingB,
    effect_reference: {
      ...referenceB,
      repair_receipt_id: referenceA.repair_receipt_id,
      repair_receipt_digest: "d".repeat(64),
    },
  }]), /effect_binding repair receipt reused/);
});
