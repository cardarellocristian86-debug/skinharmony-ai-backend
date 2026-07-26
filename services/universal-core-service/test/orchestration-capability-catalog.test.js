import assert from "node:assert/strict";
import test from "node:test";

import {
  ORCHESTRATION_CAPABILITY_CATALOG_VERSION,
  deterministicBranchRegistry,
  deterministicBranchTaxonomy,
  listOrchestrationCapabilities,
  listVirtualOrchestrationCombinations,
  orchestrationCatalogDescriptor,
} from "../branches/index.js";

const BRANCH_IDS = ["agent_orchestration", "ai_orchestration"];

test("agent and AI orchestration expose distinct versioned atomic capability catalogs", () => {
  const registry = deterministicBranchRegistry();
  const agent = registry.agent_orchestration;
  const ai = registry.ai_orchestration;

  assert(agent);
  assert(ai);
  assert.equal(agent.capability_catalog.schema_version, ORCHESTRATION_CAPABILITY_CATALOG_VERSION);
  assert.equal(ai.capability_catalog.schema_version, ORCHESTRATION_CAPABILITY_CATALOG_VERSION);
  assert.notEqual(agent.capability_catalog.fingerprint, ai.capability_catalog.fingerprint);
  assert(agent.subbranches.length >= 30);
  assert(ai.subbranches.length >= 30);
  assert.equal(new Set(agent.subbranches).size, agent.subbranches.length);
  assert.equal(new Set(ai.subbranches).size, ai.subbranches.length);
  assert.equal(agent.subbranches.filter((id) => ai.subbranches.includes(id)).length, 0);

  for (const branchId of BRANCH_IDS) {
    const descriptor = orchestrationCatalogDescriptor(branchId);
    assert.equal(descriptor.expansion_mode, "lazy_deterministic_paged");
    assert.equal(descriptor.runtime_policy, "bounded_materialization_only_with_explicit_plan_depth");
    assert.equal(descriptor.virtual_depth_policy, "recursive_lazy_without_static_catalog_ceiling");
    assert(BigInt(descriptor.virtual_combination_count) > 100_000n);
  }
});

test("capability paging is deterministic, stable and bounded", () => {
  for (const branchId of BRANCH_IDS) {
    const first = listOrchestrationCapabilities({ branchId, limit: 7 });
    const replay = listOrchestrationCapabilities({ branchId, limit: 7 });
    assert.deepEqual(replay, first);
    assert.equal(first.items.length, 7);
    assert.equal(first.cursor, "0");
    assert.equal(first.next_cursor, "7");

    const second = listOrchestrationCapabilities({
      branchId,
      cursor: first.next_cursor,
      limit: 7,
    });
    assert.equal(second.cursor, "7");
    assert.equal(
      first.items.some((item) => second.items.some((candidate) => candidate.capability_id === item.capability_id)),
      false,
    );

    const capped = listOrchestrationCapabilities({ branchId, limit: 100_000 });
    assert(capped.page_limit <= 100);
    assert(capped.items.length <= 100);
    assert(JSON.stringify(capped).length < 40_000);
  }
});

test("virtual combinations expand lazily without agent or model materialization", () => {
  for (const branchId of BRANCH_IDS) {
    const first = listVirtualOrchestrationCombinations({ branchId, limit: 9 });
    const replay = listVirtualOrchestrationCombinations({ branchId, limit: 9 });
    assert.deepEqual(replay, first);
    assert.equal(first.items.length, 9);
    assert.equal(first.next_cursor, "9");
    assert(BigInt(first.virtual_combination_count) > BigInt(first.items.length));

    for (const item of first.items) {
      assert.equal(item.materialized, false);
      assert.equal(item.authority, "proposal_only");
      assert(Object.keys(item.selection).length >= 7);
    }

    const finalCursor = (BigInt(first.virtual_combination_count) - 2n).toString();
    const finalPage = listVirtualOrchestrationCombinations({
      branchId,
      cursor: finalCursor,
      limit: 50,
    });
    assert.equal(finalPage.items.length, 2);
    assert.equal(finalPage.next_cursor, null);

    const capped = listVirtualOrchestrationCombinations({ branchId, limit: 1_000_000 });
    assert.equal(capped.page_limit, 50);
    assert.equal(capped.items.length, 50);
    assert(JSON.stringify(capped).length < 35_000);
  }
});

test("orchestration branches reach L30 while taxonomy stores only bounded catalog descriptors", () => {
  const taxonomy = deterministicBranchTaxonomy();
  assert.equal(taxonomy.max_depth, 30);

  for (const branchId of BRANCH_IDS) {
    const branchNode = taxonomy.nodes.find((node) => node.node_id === `${branchId}__branch`);
    const terminal = taxonomy.nodes.find((node) => node.node_id === `${branchId}__continuity_handoff`);
    assert(branchNode);
    assert(terminal);
    assert.equal(branchNode.depth, 6);
    assert.equal(terminal.depth, 30);
    assert.equal(branchNode.virtual_capability_catalog.branch_id, branchId);
    assert.equal(branchNode.virtual_capability_catalog.expansion_mode, "lazy_deterministic_paged");
    assert.equal(Object.hasOwn(branchNode.virtual_capability_catalog, "items"), false);
    assert(JSON.stringify(branchNode.virtual_capability_catalog).length < 1_000);
  }
});

test("catalog rejects unknown versions and malformed cursors", () => {
  assert.throws(
    () => listOrchestrationCapabilities({ branchId: "agent_orchestration", version: "future_unverified" }),
    /unsupported orchestration catalog version/,
  );
  assert.throws(
    () => listVirtualOrchestrationCombinations({ branchId: "ai_orchestration", cursor: "-1" }),
    /cursor must be a non-negative integer/,
  );
});
