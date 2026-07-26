import assert from "node:assert/strict";
import test from "node:test";

import {
  BRANCH_RESEARCH_LEARNING_PROFILES,
  getBranchResearchLearningProfile,
} from "../branches/branch-research-learning-profiles.js";
import {
  deterministicBranchRegistry,
  deterministicBranchTaxonomy,
  resolveBranchesForKey,
} from "../branches/index.js";

const TARGET_BRANCHES = Object.freeze([
  "software_systems_intelligence",
  "codex_architecture_guard",
  "suite_governance",
  "smartdesk_operations_guard",
  "skinharmony_analyzer",
  "beauty_vertical_orchestration",
  "lexical_semantic_intelligence",
]);

test("five target areas expose rich governed research and learning profiles", () => {
  const profiles = Object.values(BRANCH_RESEARCH_LEARNING_PROFILES);
  assert.equal(profiles.length, 5);
  assert.deepEqual(
    profiles.map((profile) => profile.area).sort(),
    ["analyzer_vertical", "lexical_semantic_intelligence", "programming_architecture", "smartdesk_vertical", "suite_vertical"],
  );

  for (const profile of profiles) {
    assert(profile.mission.length >= 80, `${profile.id} mission must be operational`);
    assert(profile.operational_subbranches.length >= 28, `${profile.id} must have at least 28 real subbranches`);
    assert(profile.research_questions.length >= 8, `${profile.id} research questions missing`);
    assert(profile.source_policy.preferred.length >= 5, `${profile.id} preferred sources missing`);
    assert(profile.source_policy.rejected.length >= 4, `${profile.id} rejected sources missing`);
    assert(profile.benchmarks.length >= 6, `${profile.id} benchmarks missing`);
    assert(profile.negative_cases.length >= 8, `${profile.id} negative cases missing`);
    assert(profile.learning_objectives.length >= 6, `${profile.id} learning objectives missing`);
    assert(profile.verify_criteria.length >= 6, `${profile.id} verify criteria missing`);

    const stages = Object.values(profile.stage_map);
    assert.equal(stages.length, 24, `${profile.id} must map stages 7-30`);
    assert.equal(new Set(stages.map((stage) => stage.label)).size, 24);
    assert.equal(new Set(stages.map((stage) => stage.expected_artifact)).size, 24);
    for (const stage of stages) {
      assert(stage.research_focus.length >= 45, `${profile.id}:${stage.stage_id} research focus too shallow`);
      assert(stage.semantic_tags.length >= 3, `${profile.id}:${stage.stage_id} semantic tags missing`);
    }
  }
});

test("target L6 branches are operationally full and preserve specific depth-30 paths", () => {
  const registry = deterministicBranchRegistry();
  const taxonomy = deterministicBranchTaxonomy();
  const byId = new Map(taxonomy.nodes.map((node) => [node.node_id, node]));

  const minimumRegistrySubbranches = {
    software_systems_intelligence: 24,
    codex_architecture_guard: 20,
    suite_governance: 28,
    smartdesk_operations_guard: 28,
    skinharmony_analyzer: 30,
    beauty_vertical_orchestration: 18,
    lexical_semantic_intelligence: 50,
  };

  for (const branchId of TARGET_BRANCHES) {
    const profile = getBranchResearchLearningProfile(branchId);
    assert(profile, `${branchId} profile missing`);
    assert(
      registry[branchId].subbranches.length >= minimumRegistrySubbranches[branchId],
      `${branchId} registry is not full enough`,
    );

    const branchNode = byId.get(`${branchId}__branch`);
    assert(branchNode, `${branchId} L6 node missing`);
    assert.equal(branchNode.depth, 6);
    assert.equal(branchNode.kind, "branch");
    assert.equal(branchNode.research_learning_profile.profile_id, profile.id);
    assert.equal(branchNode.research_learning_profile.stage_count, 24);
    assert(branchNode.semantic_tags.includes(profile.semantic_tags[0]));
    assert(branchNode.semantic_tags.includes(profile.operational_subbranches.at(-1)));

    const path = taxonomy.nodes
      .filter((node) => node.branch_bindings.includes(branchId))
      .sort((left, right) => left.depth - right.depth);
    const stages = path.filter((node) => node.kind === "stage");
    assert.equal(stages.length, 24);
    assert.equal(path.at(-1)?.depth, 30);
    assert.equal(path.at(-1)?.node_id, `${branchId}__continuity_handoff`);
    assert.equal(new Set(stages.map((node) => node.stage_profile.expected_artifact)).size, 24);
    for (const stage of stages) {
      assert.equal(stage.stage_profile.profile_id, profile.id);
      assert.equal(stage.stage_profile.area, profile.area);
      assert(stage.stage_profile.research_focus.length >= 45);
      assert(!stage.label.endsWith("Sensory Ingest"));
      assert(!stage.label.endsWith("Continuity Handoff"));
    }
  }
});

test("Suite, SmartDesk and Analyzer domain packs keep vertical research isolated", () => {
  const requestedVerticals = [
    "suite_governance",
    "smartdesk_operations_guard",
    "skinharmony_analyzer",
    "beauty_vertical_orchestration",
  ];
  const resolve = (domainPackId) => resolveBranchesForKey({
    tenant_id: `tenant-${domainPackId}`,
    brand_scope: "independent_brand",
    metadata: {
      domain_pack_id: domainPackId,
      active_branches: requestedVerticals,
    },
  }, requestedVerticals);

  const suite = resolve("suite");
  assert.deepEqual(suite.selected_branches, ["suite_governance"]);
  assert(suite.denied_branches.includes("smartdesk_operations_guard"));
  assert(suite.denied_branches.includes("skinharmony_analyzer"));

  const smartdesk = resolve("smartdesk");
  assert.deepEqual(smartdesk.selected_branches, ["smartdesk_operations_guard"]);
  assert(smartdesk.denied_branches.includes("suite_governance"));
  assert(smartdesk.denied_branches.includes("skinharmony_analyzer"));

  const analyzer = resolve("analyzer");
  assert.deepEqual(analyzer.selected_branches, ["skinharmony_analyzer", "beauty_vertical_orchestration"]);
  assert(analyzer.denied_branches.includes("suite_governance"));
  assert(analyzer.denied_branches.includes("smartdesk_operations_guard"));
});
