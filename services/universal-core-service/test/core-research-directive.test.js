import assert from "node:assert/strict";
import test from "node:test";
import { assessCoreResearchNeed, buildCoreResearchDirective } from "../src/coreResearchDirective.js";

const INPUT = {
  tenantId: "tenant-a",
  requestText: "Verifica la normativa attuale prima della pubblicazione",
  operationType: "publish",
  evidenceState: {
    source_count: 1,
    confidence: 0.55,
    freshness_state: "stale",
    contradictions: ["claim-a:claim-b"],
  },
  selectedBranches: ["legal_privacy_compliance_guard"],
  allowedDomains: ["europa.eu"],
};

test("Core detects every governed research trigger", () => {
  const result = assessCoreResearchNeed(INPUT);
  assert.equal(result.required, true);
  assert.deepEqual(result.reasons, [
    "confidence_below_threshold",
    "freshness_gap",
    "high_impact_decision",
    "unresolved_contradiction",
  ]);
  assert.equal(result.confidence_threshold, 0.85);
});

test("directive is deterministic and tenant-scoped", () => {
  const first = buildCoreResearchDirective(INPUT);
  const second = buildCoreResearchDirective(INPUT);
  assert.deepEqual(first, second);
  assert.match(first.directive.directive_id, /^crd_[a-f0-9]{32}$/);
  assert.equal(first.directive.tenant_scope.tenant_id, "tenant-a");
  assert.equal(first.directive.tenant_scope.cross_tenant, false);
  const otherTenant = buildCoreResearchDirective({ ...INPUT, tenantId: "tenant-b" });
  assert.notEqual(first.directive.directive_id, otherTenant.directive.directive_id);
});

test("directive defines research to consolidation while authorizing no action", () => {
  const { directive } = buildCoreResearchDirective(INPUT);
  assert.deepEqual(directive.lifecycle_contract.stages, ["research", "evidence", "distill", "verify", "consolidate"]);
  assert.equal(directive.lifecycle_contract.transitions[0].separate_authorization_required, true);
  assert.equal(directive.lifecycle_contract.transitions.at(-1).explicit_promotion_authorization_required, true);
  assert.equal(directive.authority.ai_may_execute_without_core_authorization, false);
  assert.equal(directive.authority.research_execution_authorized, false);
  assert.equal(directive.authority.distillation_authorized, false);
  assert.equal(directive.authority.consolidation_authorized, false);
  assert.equal(directive.authority.nyra_may_select_core_variant, false);
});

test("Core emits no directive when fresh evidence meets the confidence floor", () => {
  const result = buildCoreResearchDirective({
    tenantId: "tenant-a",
    requestText: "Riassumi questo documento",
    evidenceState: { source_count: 2, confidence: 0.9, freshness_state: "fresh" },
  });
  assert.equal(result.assessment.required, false);
  assert.equal(result.directive, null);
});

test("directive redacts secrets before hashing or returning questions", () => {
  const result = buildCoreResearchDirective({
    tenantId: "tenant-a",
    requestText: "Controlla token=super-secret-value",
    evidenceState: { source_count: 0 },
  });
  assert(!JSON.stringify(result).includes("super-secret-value"));
});
