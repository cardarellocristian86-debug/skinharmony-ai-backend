import assert from "node:assert/strict";
import test from "node:test";

import {
  deterministicBranchRegistry,
  deterministicBranchTaxonomy,
} from "../branches/index.js";
import { branchLexicalSemanticIntelligence } from "../branches/branch-lexical-semantic-intelligence.js";

const BRANCH_ID = "lexical_semantic_intelligence";

test("lexical semantic branch is advisory and exposes only a bounded lazy descriptor", () => {
  const branch = deterministicBranchRegistry()[BRANCH_ID];
  assert(branch, `${BRANCH_ID} branch missing`);
  assert.equal(branch.production_status, "advisory");
  assert.equal(branchLexicalSemanticIntelligence.guardrails.allowed_action_level, "lexical_semantic_advisory");
  assert.equal(branchLexicalSemanticIntelligence.guardrails.destructive_automation, false);
  assert.equal(branch.capability_catalog.authority, "proposal_only");
  assert.equal(branch.capability_catalog.execution_effect, "none");
  assert.equal(branch.capability_catalog.expansion_mode, "lazy_deterministic_paged");
  assert.equal(branch.capability_catalog.virtual_combination_count, "777600");
  assert.equal(Object.hasOwn(branch.capability_catalog, "items"), false);
  assert(JSON.stringify(branch.capability_catalog).length < 2_000);
});

test("lexical semantic taxonomy preserves its governed L6 to L30 path", () => {
  const taxonomy = deterministicBranchTaxonomy();
  const path = taxonomy.nodes
    .filter((node) => node.node_id.startsWith(`${BRANCH_ID}__`))
    .sort((left, right) => left.depth - right.depth);

  assert.equal(taxonomy.max_depth, 30);
  assert.equal(path[0]?.node_id, `${BRANCH_ID}__branch`);
  assert.equal(path[0]?.depth, 6);
  assert.equal(path[0]?.kind, "branch");
  assert.equal(path.at(-1)?.node_id, `${BRANCH_ID}__continuity_handoff`);
  assert.equal(path.at(-1)?.depth, 30);

  const stages = path.filter((node) => node.kind === "stage");
  assert.equal(stages.length, 24);
  assert.deepEqual(stages.map((node) => node.depth), Array.from({ length: 24 }, (_, index) => index + 7));
  assert(stages.every((node) => node.branch_bindings.includes(BRANCH_ID)));

  const descriptor = path[0].virtual_capability_catalog;
  assert(descriptor);
  assert.equal(descriptor.authority, "proposal_only");
  assert.equal(descriptor.execution_effect, "none");
  assert.equal(descriptor.expansion_mode, "lazy_deterministic_paged");
  assert.equal(descriptor.virtual_combination_count, "777600");
  assert.equal(Object.hasOwn(descriptor, "items"), false);
  assert(JSON.stringify(descriptor).length < 2_000);
});
