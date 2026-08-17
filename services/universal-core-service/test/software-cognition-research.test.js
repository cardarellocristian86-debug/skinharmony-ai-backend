import assert from "node:assert/strict";
import test from "node:test";

import {
  bindSoftwareResearchEvidence, buildSoftwareResearchPlan, buildTechnologyProfiles, createNyraPrecoreDecision, validateTechnologyEvidence,
  detectSoftwareTechnologies, SOFTWARE_TECHNOLOGY_SOURCE_CATALOG,
} from "../src/softwareCognitionResearch.js";
import { softwareDigest } from "../src/softwareCognition.js";

const scope = Object.freeze({ tenant_id: "tenant-a", project_id: "project-a", work_id: "work-a", change_id: "change-a", plan_id: "plan-a" });
const graph = Object.freeze({ revision: 4, source_digest: "a".repeat(64), nodes: [
  { node_id: "node-ts", kind: "file", source_ref: "src/server.ts" },
  { node_id: "node-cargo", kind: "configuration", source_ref: "worker/Cargo.toml" },
] });

test("technology detection is evidence-first and supports an extensible language catalog", () => {
  const detected = detectSoftwareTechnologies({ graph });
  assert.deepEqual(detected.map((item) => item.technology), ["rust", "typescript"]);
  assert.equal(detected.every((item) => item.confidence >= 0.9), true);
  assert.equal(Object.keys(SOFTWARE_TECHNOLOGY_SOURCE_CATALOG).length >= 10, true);
  const hinted = detectSoftwareTechnologies({ graph: { nodes: [] }, technology_hints: ["python", "unknown-language"] });
  assert.deepEqual(hinted.map((item) => item.technology), ["python"]);
  assert.equal(hinted[0].hypothesis_only, true);
});

test("technology_profile_v1 contains every required technical and evidence adapter contract", () => {
  const profiles = buildTechnologyProfiles({ graph, technology_hints: ["python", "go", "java", "dotnet"] });
  assert.equal(profiles.length >= 6, true);
  for (const profile of profiles) {
    assert.equal(profile.schema_version, "technology_profile_v1");
    for (const key of ["language", "runtimes", "version_detectors", "manifest_types", "lockfile_types", "framework_detectors",
      "parser_semantic_adapter", "compiler_type_checker", "lint_static_analysis", "test_adapters", "dependency_adapters",
      "official_documentation_roots", "package_registries", "security_advisory_sources", "freshness_rules", "minimum_evidence_coverage"]) {
      assert.notEqual(profile[key], undefined, `${profile.technology}:${key}`);
    }
    assert.equal(profile.adapter_execution.execution_authorized, false);
    assert.equal(profile.adapter_execution.authority, "sandboxed_worker_only");
    assert.equal(profile.official_documentation_roots.length >= 1, true, `${profile.technology}:official sources`);
    assert.equal(profile.package_registries.length >= 1, true, `${profile.technology}:package registry`);
    assert.equal(profile.security_advisory_sources.length >= 1, true, `${profile.technology}:security source`);
    for (const group of [profile.version_detectors, profile.compiler_type_checker, profile.lint_static_analysis, profile.test_adapters, profile.dependency_adapters]) {
      assert.equal(group.every((item) => item.sandbox_required === true), true);
    }
  }
});

test("high-risk research requires multiple primary, package and security sources", () => {
  const plan = buildSoftwareResearchPlan({ ...scope, graph, question: "Verify tenant authorization and dependency safety", risk_tier: "normal",
    version_context: { typescript: "6.0.3", rust: "stable" } });
  assert.equal(plan.risk_tier, "security_critical");
  assert.equal(plan.source_policy.minimum_independent_sources, 3);
  assert.equal(plan.sources.some((item) => item.primary), true);
  assert.equal(plan.sources.some((item) => item.source_type === "security_advisory"), true);
  assert.equal(plan.execution_authorized, false);
  assert.match(plan.sources.find((item) => item.technology === "rust" && item.source_type === "official_reference").url, /^https:\/\/doc\.rust-lang\.org\//);
});

test("additional sources are limited to already authorized official domains", () => {
  assert.throws(() => buildSoftwareResearchPlan({ ...scope, graph, question: "Check behavior", version_context: { typescript: "6" },
    additional_source_urls: ["https://attacker.example/instructions"] }), /software_research_source_domain_not_authorized/);
  const plan = buildSoftwareResearchPlan({ ...scope, graph, question: "Check behavior", version_context: { typescript: "6" },
    additional_source_urls: ["https://nodejs.org/api/fs.html"] });
  assert.equal(plan.sources.some((item) => item.url === "https://nodejs.org/api/fs.html"), true);
});

test("signed Airlock capsule must match scope, plan and evidence threshold", () => {
  const base = buildSoftwareResearchPlan({ ...scope, graph, question: "Verify runtime API", version_context: { typescript: "6.0.3" } });
  const plan = { ...base, airlock_plan_digest: "b".repeat(64) };
  plan.research_plan_digest = "c".repeat(64);
  const capsule = { schema_version: "research_airlock_evidence_capsule_v1", capsule_id: "capsule-a",
    work_binding: { tenant_id: scope.tenant_id, project_id: scope.project_id, work_id: scope.work_id, session_id: "session-a" },
    plan_digest: plan.airlock_plan_digest, evidence_digest: "d".repeat(64), evidence_count: 3, independent_source_count: 3, independent_domain_count: 3,
    source_url_digests: plan.sources.slice(0, 3).map((item) => softwareDigest(item.url)),
    source_domain_digests: plan.sources.slice(0, 3).map((item) => softwareDigest(new URL(item.url).hostname)),
    expires_at: "2026-08-17T12:30:00.000Z" };
  const bound = bindSoftwareResearchEvidence({ plan, capsule, verified: true, now: Date.parse("2026-08-17T12:00:00.000Z") });
  assert.equal(bound.verified, true);
  assert.equal(bound.execution_authorized, false);
  assert.throws(() => bindSoftwareResearchEvidence({ plan, capsule: { ...capsule, work_binding: { ...capsule.work_binding, tenant_id: "tenant-b" } }, verified: true,
    now: Date.parse("2026-08-17T12:00:00.000Z") }), /software_research_capsule_scope_mismatch/);
  assert.throws(() => bindSoftwareResearchEvidence({ plan, capsule, verified: false,
    now: Date.parse("2026-08-17T12:00:00.000Z") }), /software_research_capsule_signature_invalid/);
  assert.throws(() => bindSoftwareResearchEvidence({ plan, capsule: { ...capsule, independent_source_count: 3,
    source_url_digests: [capsule.source_url_digests[0]] }, verified: true,
    now: Date.parse("2026-08-17T12:00:00.000Z") }), /software_research_evidence_insufficient/);
});

test("security research cannot omit the authorized advisory source", () => {
  const plan = buildSoftwareResearchPlan({ ...scope, graph: { ...graph, nodes: [graph.nodes[0]] }, question: "Check authorization security",
    version_context: { typescript: "6.0.3" } });
  const nonSecurity = plan.sources.filter((item) => item.source_type !== "security_advisory");
  const capsule = { schema_version: "research_airlock_evidence_capsule_v1", capsule_id: "capsule-security",
    work_binding: { tenant_id: scope.tenant_id, project_id: scope.project_id, work_id: scope.work_id }, plan_digest: "b".repeat(64),
    evidence_digest: "d".repeat(64), evidence_count: 3, independent_source_count: nonSecurity.length,
    independent_domain_count: nonSecurity.length, source_url_digests: nonSecurity.map((item) => softwareDigest(item.url)),
    source_domain_digests: nonSecurity.map((item) => softwareDigest(new URL(item.url).hostname)), expires_at: "2026-08-17T12:30:00.000Z" };
  assert.throws(() => bindSoftwareResearchEvidence({ plan: { ...plan, airlock_plan_digest: capsule.plan_digest }, capsule, verified: true,
    now: Date.parse("2026-08-17T12:00:00.000Z") }), /software_research_evidence_insufficient|software_research_security_source_missing/);
});

test("pre-Core decision is always provisional and cannot authorize execution", () => {
  const researchPlan = { research_required: true, technical_verification_required: true, research_plan_digest: "a".repeat(64), risk_tier: "normal" };
  const decision = createNyraPrecoreDecision({ ...scope, disposition: "PROPOSE", recommendation: "Adopt the bounded patch", rationale: ["Official docs agree"],
    research_plan: researchPlan, research_evidence: { verified: true, research_plan_digest: researchPlan.research_plan_digest,
      research_evidence_digest: "b".repeat(64), fresh_until: "2026-08-17T12:30:00.000Z" },
    technology_evidence: { verified: true, research_plan_digest: researchPlan.research_plan_digest,
      technology_evidence_digest: "c".repeat(64), fresh_until: "2026-08-17T12:30:00.000Z" },
    bindings: { intent: { verified: true }, icf: { verified: true } }, issued_at: "2026-08-17T12:00:00.000Z", fresh_until: "2026-08-17T12:30:00.000Z" });
  assert.equal(decision.state, "NYRA_PROVISIONAL");
  assert.equal(decision.core_state, "CORE_PENDING");
  assert.equal(decision.disposition, "PROPOSE");
  assert.equal(decision.execution_authorized, false);
  assert.equal(decision.authoritative_transition_performed, false);
});

test("technology evidence requires complete independently attested sandbox adapter receipts", () => {
  const plan = buildSoftwareResearchPlan({ ...scope, graph: { ...graph, nodes: [graph.nodes[0]] }, question: "Verify TypeScript", version_context: { typescript: "6.0.3" } });
  const profile = plan.technology_profiles[0];
  const receipt = "a".repeat(64);
  const verified = validateTechnologyEvidence({ plan, evidence_authority: { evidence_digest: "b".repeat(64), fresh_until: "2026-08-17T12:30:00.000Z" },
    profile_results: [{ technology: profile.technology, profile_digest: profile.profile_digest, detected_version: "6.0.3", passed: true,
      manifest_digests: ["c".repeat(64)], lockfile_digests: ["d".repeat(64)], frameworks: ["node"],
      adapter_receipts: { compiler_type_checker: [receipt], tests: [receipt], lint_static_analysis: [receipt], dependency_inventory: [receipt] } }] });
  assert.equal(verified.verified, true);
  assert.equal(verified.execution_authorized, false);
  assert.throws(() => validateTechnologyEvidence({ plan, evidence_authority: { evidence_digest: "b".repeat(64), fresh_until: "2026-08-17T12:30:00.000Z" },
    profile_results: [{ technology: profile.technology, profile_digest: profile.profile_digest, detected_version: "6.0.3", passed: true,
      manifest_digests: ["c".repeat(64)], adapter_receipts: { compiler_type_checker: [receipt], tests: [] } }] }), /software_technology_profile_evidence_incomplete/);
});

test("missing technical evidence forces abstention or a security block", () => {
  const common = { ...scope, disposition: "PROPOSE", recommendation: "Ship", rationale: [], bindings: {},
    issued_at: "2026-08-17T12:00:00.000Z", fresh_until: "2026-08-17T12:10:00.000Z" };
  const abstain = createNyraPrecoreDecision({ ...common, research_plan: { research_required: true, research_plan_digest: "a".repeat(64), risk_tier: "normal" } });
  assert.equal(abstain.disposition, "ABSTAIN");
  const block = createNyraPrecoreDecision({ ...common, research_plan: { research_required: true, research_plan_digest: "a".repeat(64), risk_tier: "security_critical" } });
  assert.equal(block.disposition, "RECOMMEND_BLOCK");
});
