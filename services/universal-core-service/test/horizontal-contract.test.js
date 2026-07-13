import assert from "node:assert/strict";
import test from "node:test";
import {
  VERTICAL_BRANCH_IDS,
  checkDomainPackRequest,
  getDomainPack,
  listDomainPacks,
  resolveDomainPack,
  resolveDomainPackForKey,
  validateDomainPack,
} from "../src/domainPacks.js";
import {
  MAX_PARALLEL_BRANCHES,
  MAX_SUBBRANCHES_PER_BRANCH,
  nyraBranchCatalog,
  routeNyraBranches,
  validateNyraBranchNetwork,
} from "../src/nyraBranchNetwork.js";
import {
  HORIZONTAL_WORK_BRANCHES,
  deterministicBranchGroups,
  deterministicBranchRegistry,
  resolveBranchesForKey,
} from "../branches/index.js";

test("Core defaults to horizontal and product packs require explicit key metadata", () => {
  const packs = listDomainPacks();
  assert.deepEqual(packs.map((pack) => pack.id), ["generic", "regulated_demo", "suite", "smartdesk", "analyzer"]);
  assert.equal(resolveDomainPack({ tenantId: "tenant-acme" }).id, "generic");
  assert.equal(resolveDomainPack({ tenantId: "tenant_demo_skinharmony" }).id, "generic");
  assert.equal(resolveDomainPack({ brandScope: "skinharmony" }).id, "generic");
  assert.equal(resolveDomainPack({ metadata: { domain_pack_id: "suite" } }).id, "suite");
  assert.equal(resolveDomainPack({ metadata: { domain_pack_id: "smartdesk" } }).id, "smartdesk");
  assert.equal(resolveDomainPack({ metadata: { domain_pack_id: "analyzer" } }).id, "analyzer");
  assert.equal(resolveDomainPack({ metadata: { domain_pack_id: "skinharmony" } }).id, "generic");
  assert.equal(getDomainPack("skinharmony"), null);
  assert.equal(packs[0].activation_mode, "default_horizontal");
  assert(packs.slice(1).every((pack) => pack.activation_mode === "explicit_key_metadata_only"));
  assert.equal(validateDomainPack({}).ok, false);
});

test("client payloads cannot select a domain pack", () => {
  const key = { tenant_id: "tenant-acme", brand_scope: "skinharmony", metadata: { domain_pack_id: "analyzer" } };
  assert.equal(resolveDomainPackForKey(key).id, "analyzer");
  assert.equal(checkDomainPackRequest(key).ok, true);
  assert.deepEqual(checkDomainPackRequest(key, "analyzer"), {
    ok: false,
    pack: resolveDomainPackForKey(key),
    requested_id: "analyzer",
    error: "domain_pack_override_denied",
  });
  assert.equal(checkDomainPackRequest(key, "generic").ok, false);
});

test("Nyra network respects limits and exposes only explicit product branches", () => {
  const validation = validateNyraBranchNetwork();
  assert.equal(validation.ok, true);
  assert.equal(validation.max_subbranches_per_branch, 20);
  for (const packId of ["generic", "suite", "smartdesk", "analyzer"]) {
    for (const item of nyraBranchCatalog(packId).branches) {
      assert(item.subbranch_count > 0);
      assert(item.subbranch_count <= MAX_SUBBRANCHES_PER_BRANCH);
      assert.equal(item.subbranches.length, item.subbranch_count);
    }
  }
  const genericIds = nyraBranchCatalog("generic").branches.map((item) => item.id);
  assert.equal(genericIds.includes("suite_domain"), false);
  assert.equal(genericIds.includes("smartdesk_domain"), false);
  assert.equal(genericIds.includes("analyzer_domain"), false);
  assert.equal(genericIds.includes("skinharmony_domain"), false);
  assert(nyraBranchCatalog("suite").branches.some((item) => item.id === "suite_domain"));
  assert(nyraBranchCatalog("smartdesk").branches.some((item) => item.id === "smartdesk_domain"));
  assert(nyraBranchCatalog("analyzer").branches.some((item) => item.id === "analyzer_domain"));
  const research = nyraBranchCatalog("generic").branches.find((item) => item.id === "research_evidence");
  assert.equal(research.subbranch_count, 20);
  assert(research.subbranches.includes("claim_evidence_graph"));
  assert(research.subbranches.includes("temporal_truth"));
  assert(research.subbranches.includes("knowledge_release_gate"));
  assert(research.subbranches.includes("source_injection_defense"));
});

test("Core opens horizontal Nyra branches and isolates product-specific branches", () => {
  const generic = routeNyraBranches({
    text: "Valuta rischio privacy, SkinHarmony, Suite, SmartDesk e Analyzer e prepara un piano di deploy",
    requestedBranches: ["execution_planning", "suite_domain", "smartdesk_domain", "analyzer_domain", "unknown_branch"],
    domainPackId: "generic",
  });
  assert.equal(generic.opened_by, "universal_core");
  assert(generic.opened_branches.some((item) => item.id === "execution_planning"));
  assert.deepEqual(generic.denied_branches, ["suite_domain", "smartdesk_domain", "analyzer_domain", "unknown_branch"]);
  assert.equal(generic.execution_authorized, false);
  assert(generic.parallel_analysis.waves.every((wave) => wave.length <= MAX_PARALLEL_BRANCHES));
  assert.equal(generic.parallel_analysis.join_authority, "universal_core");

  const suite = routeNyraBranches({ text: "Prepara il sito Suite", requestedBranches: ["suite_domain", "analyzer_domain"], domainPackId: "suite" });
  assert(suite.opened_branches.some((item) => item.id === "suite_domain"));
  assert.deepEqual(suite.denied_branches, ["analyzer_domain"]);

  const smartdesk = routeNyraBranches({ text: "Verifica agenda SmartDesk", requestedBranches: ["smartdesk_domain"], domainPackId: "smartdesk" });
  assert(smartdesk.opened_branches.some((item) => item.id === "smartdesk_domain"));

  const analyzer = routeNyraBranches({ text: "Valuta analisi e protocollo", requestedBranches: ["analyzer_domain"], domainPackId: "analyzer" });
  assert(analyzer.opened_branches.some((item) => item.id === "analyzer_domain"));
});

test("Nyra proposes a complete horizontal work graph and Core opens it in bounded waves", () => {
  const route = routeNyraBranches({
    text: "Ricerca fonti, pianifica priorita, coordina il lavoro in parallelo, testa qualita e impara dal feedback",
    domainPackId: "generic",
  });
  const opened = route.opened_branches.map((item) => item.id);
  for (const id of ["work_intake", "research_evidence", "planning_prioritization", "parallel_coordination", "quality_verification", "adaptive_learning"]) {
    assert(opened.includes(id), `missing Nyra work branch ${id}`);
  }
  assert.equal(route.parallel_analysis.maximum_parallel_branches, 6);
  assert(route.parallel_analysis.waves.length >= 2);
  assert(route.parallel_analysis.waves.every((wave) => wave.length <= 6));
  assert.equal(route.parallel_analysis.conflict_policy, "core_reconciles_evidence_before_action");
  assert.equal(route.governed_learning.state, "active");
  assert.equal(route.governed_learning.memory_source, "tenant_memory_fabric");
  assert.equal(route.governed_learning.policy_activation_requires_verify, true);
  assert.equal(route.governed_learning.free_weight_training, false);
  assert.equal(route.execution_authorized, false);
});

test("every horizontal Nyra Core binding resolves to an agnostic registered work branch", () => {
  const registry = deterministicBranchRegistry();
  const catalog = nyraBranchCatalog("generic");
  for (const item of catalog.branches) {
    for (const binding of item.core_branch_bindings) {
      assert(registry[binding], `missing Core binding ${binding}`);
      assert.equal(registry[binding].domain, "horizontal_work");
      assert(registry[binding].subbranches.length <= 20);
    }
  }
  assert.deepEqual(deterministicBranchGroups().work_cortex.branches, HORIZONTAL_WORK_BRANCHES);
});

test("Core branch packages isolate Suite, SmartDesk and Analyzer verticals", () => {
  const generic = resolveBranchesForKey({
    tenant_id: "tenant_demo_skinharmony",
    brand_scope: "skinharmony",
    preset: "nyra_core_360_connector",
    metadata: {},
  });
  assert.equal(generic.domain_pack.id, "generic");
  assert(VERTICAL_BRANCH_IDS.every((id) => !generic.allowed_branches.includes(id)));
  assert.equal(generic.allowed_branches.includes("codex_security_guard"), true);
  for (const branchId of HORIZONTAL_WORK_BRANCHES) assert(generic.allowed_branches.includes(branchId));

  const suite = resolveBranchesForKey({
    tenant_id: "tenant_demo_skinharmony",
    brand_scope: "skinharmony",
    preset: "nyra_core_360_connector",
    metadata: { domain_pack_id: "suite" },
  });
  assert.equal(suite.domain_pack.id, "suite");
  assert.equal(suite.allowed_branches.includes("suite_governance"), true);
  assert.equal(suite.allowed_branches.includes("smartdesk_operations_guard"), false);
  assert.equal(suite.allowed_branches.includes("skinharmony_analyzer"), false);

  const smartdesk = resolveBranchesForKey({
    tenant_id: "tenant-any",
    preset: "nyra_core_360_connector",
    metadata: { domain_pack_id: "smartdesk" },
  });
  assert.equal(smartdesk.allowed_branches.includes("smartdesk_operations_guard"), true);
  assert.equal(smartdesk.allowed_branches.includes("suite_governance"), false);
  assert.equal(smartdesk.allowed_branches.includes("beauty_protocol_guard"), false);

  const analyzer = resolveBranchesForKey({
    tenant_id: "tenant-any",
    preset: "nyra_core_360_connector",
    metadata: { domain_pack_id: "analyzer" },
  });
  assert.equal(analyzer.allowed_branches.includes("skinharmony_analyzer"), true);
  assert.equal(analyzer.allowed_branches.includes("beauty_protocol_guard"), true);
  assert.equal(analyzer.allowed_branches.includes("suite_governance"), false);
  assert.equal(analyzer.allowed_branches.includes("smartdesk_operations_guard"), false);
});

test("existing keys with explicit branch allowlists inherit only the horizontal work cortex by default", () => {
  const existingKey = resolveBranchesForKey({
    tenant_id: "codexai",
    brand_scope: "skinharmony",
    preset: "codex_automation",
    metadata: {
      tier: "internal",
      active_branches: ["codex_security_guard", "codex_release_gate", "suite_governance"],
    },
  });
  assert.equal(existingKey.domain_pack.id, "generic");
  assert(existingKey.allowed_branches.includes("codex_security_guard"));
  assert(existingKey.allowed_branches.includes("codex_release_gate"));
  assert.equal(existingKey.allowed_branches.includes("suite_governance"), false);
  for (const branchId of HORIZONTAL_WORK_BRANCHES) assert(existingKey.allowed_branches.includes(branchId));
});

test("domain and branch routing remains deterministic under repeated load", () => {
  const start = performance.now();
  for (let index = 0; index < 10_000; index += 1) {
    const pack = resolveDomainPack({
      tenantId: "tenant_demo_skinharmony",
      brandScope: "skinharmony",
      metadata: index % 2 ? {} : { domain_pack_id: "analyzer" },
    });
    const result = routeNyraBranches({ text: "Valuta rischio e piano", domainPackId: pack.id });
    assert.equal(result.opened_by, "universal_core");
    assert(result.opened_branches.length >= 2);
  }
  assert(performance.now() - start < 2_000);
});
