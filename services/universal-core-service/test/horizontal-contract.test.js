import assert from "node:assert/strict";
import test from "node:test";
import {
  checkDomainPackRequest,
  listDomainPacks,
  resolveDomainPack,
  resolveDomainPackForKey,
  validateDomainPack,
} from "../src/domainPacks.js";
import {
  MAX_SUBBRANCHES_PER_BRANCH,
  nyraBranchCatalog,
  routeNyraBranches,
  validateNyraBranchNetwork,
} from "../src/nyraBranchNetwork.js";
import { resolveBranchesForKey } from "../branches/index.js";

test("domain packs are valid and generic is the horizontal default", () => {
  const packs = listDomainPacks();
  assert.deepEqual(packs.map((pack) => pack.id), ["generic", "regulated_demo", "skinharmony"]);
  assert.equal(resolveDomainPack({ tenantId: "tenant-acme" }).id, "generic");
  assert.equal(resolveDomainPack({ tenantId: "tenant_demo_skinharmony" }).id, "skinharmony");
  assert.equal(resolveDomainPack({ brandScope: "skinharmony" }).id, "skinharmony");
  assert.equal(validateDomainPack({}).ok, false);
});

test("client cannot override the domain pack resolved from its key", () => {
  const key = { tenant_id: "tenant-acme", brand_scope: "acme", metadata: {} };
  assert.equal(resolveDomainPackForKey(key).id, "generic");
  assert.equal(checkDomainPackRequest(key, "generic").ok, true);
  assert.deepEqual(checkDomainPackRequest(key, "skinharmony"), {
    ok: false,
    pack: resolveDomainPackForKey(key),
    requested_id: "skinharmony",
    error: "domain_pack_override_denied",
  });
});

test("Nyra network respects the twenty-subbranch hard limit", () => {
  const validation = validateNyraBranchNetwork();
  assert.equal(validation.ok, true);
  assert.equal(validation.max_subbranches_per_branch, 20);
  for (const item of nyraBranchCatalog("skinharmony").branches) {
    assert(item.subbranch_count > 0);
    assert(item.subbranch_count <= MAX_SUBBRANCHES_PER_BRANCH);
    assert.equal(item.subbranches.length, item.subbranch_count);
  }
});

test("Core opens horizontal Nyra branches and denies unentitled vertical branches", () => {
  const generic = routeNyraBranches({
    text: "Valuta rischio privacy e prepara un piano di deploy",
    requestedBranches: ["execution_planning", "skinharmony_domain", "unknown_branch"],
    domainPackId: "generic",
  });
  assert.equal(generic.opened_by, "universal_core");
  assert(generic.opened_branches.some((item) => item.id === "execution_planning"));
  assert.deepEqual(generic.denied_branches, ["skinharmony_domain", "unknown_branch"]);
  assert.equal(generic.execution_authorized, false);

  const vertical = routeNyraBranches({ text: "Valuta protocollo SkinHarmony", requestedBranches: ["skinharmony_domain"], domainPackId: "skinharmony" });
  assert(vertical.opened_branches.some((item) => item.id === "skinharmony_domain"));
});

test("generic Core packages exclude vertical branches while SkinHarmony remains compatible", () => {
  const generic = resolveBranchesForKey({ tenant_id: "tenant-acme", brand_scope: "acme", preset: "nyra_core_360_connector", metadata: {} });
  assert.equal(generic.domain_pack.id, "generic");
  assert.equal(generic.allowed_branches.includes("skinharmony_analyzer"), false);
  assert.equal(generic.allowed_branches.includes("beauty_vertical_orchestration"), false);
  assert.equal(generic.allowed_branches.includes("codex_security_guard"), true);

  const skinHarmony = resolveBranchesForKey({ tenant_id: "tenant_demo_skinharmony", brand_scope: "skinharmony", preset: "nyra_core_360_connector", metadata: {} });
  assert.equal(skinHarmony.domain_pack.id, "skinharmony");
  assert.equal(skinHarmony.allowed_branches.includes("skinharmony_analyzer"), true);
});

test("domain and branch routing remains deterministic under repeated load", () => {
  const start = performance.now();
  for (let index = 0; index < 10_000; index += 1) {
    const pack = resolveDomainPack({ tenantId: index % 2 ? "tenant-acme" : "tenant_demo_skinharmony" });
    const result = routeNyraBranches({ text: "Valuta rischio e piano", domainPackId: pack.id });
    assert.equal(result.opened_by, "universal_core");
    assert(result.opened_branches.length >= 2);
  }
  assert(performance.now() - start < 2_000);
});
