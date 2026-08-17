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
  const fallback = buildTechnologyProfiles({ graph: { nodes: [{ source_ref: "firmware.unknown" }] } });
  assert.equal(fallback[0].support_level, "DISCOVERY_ONLY");
  assert.equal(fallback[0].knowledge_gaps.some((item) => item.category === "MISSING_SEMANTIC_ADAPTER"), true);
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
    assert.equal(profile.support_level, "TOOLCHAIN_ASSISTED");
    assert.match(profile.profile_id, /^technology:/);
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
  assert.equal(plan.sources.some((item) => item.source_class === "VENDOR_SECURITY_ADVISORY"), true);
  assert.equal(plan.sources.some((item) => item.source_class === "INDEPENDENT_SECURITY_DATABASE"), true);
  assert.match(plan.research_cortex_plan_digest, /^[a-f0-9]{64}$/);
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
  const base = buildSoftwareResearchPlan({ ...scope, graph, question: "Verify runtime API", version_context: { typescript: "6.0.3", rust: "stable" } });
  const plan = { ...base, airlock_plan_digest: "b".repeat(64) };
  plan.research_plan_digest = "c".repeat(64);
  const selectedSources = [];
  for (const source of plan.sources) {
    if (!selectedSources.some((item) => new URL(item.url).hostname === new URL(source.url).hostname)) selectedSources.push(source);
    if (selectedSources.length === 3) break;
  }
  const capsule = { schema_version: "research_airlock_evidence_capsule_v1", capsule_id: "capsule-a",
    work_binding: { tenant_id: scope.tenant_id, project_id: scope.project_id, work_id: scope.work_id, session_id: "session-a" },
    plan_digest: plan.airlock_plan_digest, evidence_digest: "d".repeat(64), evidence_count: 3, independent_source_count: 3, independent_domain_count: 3,
    source_url_digests: selectedSources.map((item) => softwareDigest(item.url)),
    source_domain_digests: selectedSources.map((item) => softwareDigest(new URL(item.url).hostname)),
    expires_at: "2026-08-17T12:30:00.000Z" };
  const sealed_evidence = { capsule_id: capsule.capsule_id, evidence_digest: capsule.evidence_digest,
    trust_label: "public_untrusted_sanitized_non_executable", execution_authorized: false,
    evidence: selectedSources.map((item, index) => ({ source: { canonical_url: item.url, fetched_at: "2026-08-17T12:00:00.000Z" },
      spans: [{ span_id: `span-${index}`, text: `Documented behavior ${index}.`, executable: false }] })) };
  const bound = bindSoftwareResearchEvidence({ plan, capsule, sealed_evidence, verified: true, now: Date.parse("2026-08-17T12:00:00.000Z") });
  assert.equal(bound.verified, true);
  assert.equal(bound.execution_authorized, false);
  assert.equal(bound.research_evidence_bundle.sources.every((item) => item.exact_url && item.lineage_id && item.sanitized_content_digest), true);
  assert.equal(bound.research_evidence_bundle.claims.every((item) => item.coverage_state === "DOCUMENTED_BEHAVIOR"), true);
  assert.throws(() => bindSoftwareResearchEvidence({ plan, capsule: { ...capsule, work_binding: { ...capsule.work_binding, tenant_id: "tenant-b" } }, sealed_evidence, verified: true,
    now: Date.parse("2026-08-17T12:00:00.000Z") }), /software_research_capsule_scope_mismatch/);
  assert.throws(() => bindSoftwareResearchEvidence({ plan, capsule, sealed_evidence, verified: false,
    now: Date.parse("2026-08-17T12:00:00.000Z") }), /software_research_capsule_signature_invalid/);
  assert.throws(() => bindSoftwareResearchEvidence({ plan, capsule: { ...capsule, independent_source_count: 3,
    source_url_digests: [capsule.source_url_digests[0]] }, sealed_evidence, verified: true,
    now: Date.parse("2026-08-17T12:00:00.000Z") }), /software_research_evidence_insufficient/);
});

test("source independence is lineage-based and mirrors do not satisfy coverage", () => {
  const base = buildSoftwareResearchPlan({ ...scope, graph: { ...graph, nodes: [graph.nodes[0]] }, question: "Verify TypeScript API",
    version_context: { typescript: "6.0.3" } });
  const sameLineage = base.sources.slice(0, 2).map((item) => ({ ...item, lineage_id: "lineage_same" }));
  const plan = { ...base, sources: sameLineage, source_policy: { ...base.source_policy, minimum_independent_sources: 2 },
    airlock_plan_digest: "b".repeat(64), research_plan_digest: "c".repeat(64) };
  const capsule = { schema_version: "research_airlock_evidence_capsule_v1", capsule_id: "capsule-lineage",
    work_binding: { tenant_id: scope.tenant_id, project_id: scope.project_id, work_id: scope.work_id }, plan_digest: plan.airlock_plan_digest,
    evidence_digest: "d".repeat(64), evidence_count: 2, independent_source_count: 2, independent_domain_count: 2,
    source_url_digests: sameLineage.map((item) => softwareDigest(item.url)),
    source_domain_digests: sameLineage.map((item) => softwareDigest(new URL(item.url).hostname)), expires_at: "2026-08-17T12:30:00.000Z" };
  assert.throws(() => bindSoftwareResearchEvidence({ plan, capsule, verified: true, now: Date.parse("2026-08-17T12:00:00.000Z"),
    sealed_evidence: { capsule_id: capsule.capsule_id, evidence_digest: capsule.evidence_digest,
      trust_label: "public_untrusted_sanitized_non_executable", execution_authorized: false, evidence: [] } }),
  /software_research_evidence_lineage_insufficient/);
});

test("latest documentation cannot be relabeled as exact legacy-version evidence", () => {
  const base = buildSoftwareResearchPlan({ ...scope, graph: { ...graph, nodes: [graph.nodes[0]] }, question: "Verify TypeScript API",
    version_context: { typescript: "6.0.3" } });
  const generic = base.sources.filter((item) => item.version_applicability?.state !== "EXACT_URL_BINDING").slice(0, 2);
  const plan = { ...base, sources: generic, airlock_plan_digest: "b".repeat(64), research_plan_digest: "c".repeat(64) };
  const capsule = { schema_version: "research_airlock_evidence_capsule_v1", capsule_id: "capsule-version",
    work_binding: { tenant_id: scope.tenant_id, project_id: scope.project_id, work_id: scope.work_id }, plan_digest: plan.airlock_plan_digest,
    evidence_digest: "d".repeat(64), evidence_count: 2, independent_source_count: 2, independent_domain_count: 2,
    source_url_digests: generic.map((item) => softwareDigest(item.url)),
    source_domain_digests: generic.map((item) => softwareDigest(new URL(item.url).hostname)), expires_at: "2026-08-17T12:30:00.000Z" };
  const sealed = { capsule_id: capsule.capsule_id, evidence_digest: capsule.evidence_digest,
    trust_label: "public_untrusted_sanitized_non_executable", execution_authorized: false,
    evidence: generic.map((item) => ({ source: { canonical_url: item.url, fetched_at: "2026-08-17T12:00:00.000Z" }, spans: [] })) };
  assert.throws(() => bindSoftwareResearchEvidence({ plan, capsule, sealed_evidence: sealed, verified: true,
    now: Date.parse("2026-08-17T12:00:00.000Z") }), /software_research_version_source_missing/);
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
    bindings: { genesis: { id: "genesis-a", digest: "d".repeat(64) }, intent: { id: "intent-a", digest: "1".repeat(64), verified: true },
      icf: { id: "icf-a", digest: "2".repeat(64), verified: true }, graph: { digest: "e".repeat(64) }, native_plan: { digest: "f".repeat(64) },
      security: { id: "security-a", digest: "3".repeat(64), status: "verified_no_critical_gap" } },
    issued_at: "2026-08-17T12:00:00.000Z", fresh_until: "2026-08-17T12:30:00.000Z" });
  assert.equal(decision.state, "NYRA_PROVISIONAL");
  assert.equal(decision.core_state, "CORE_PENDING");
  assert.equal(decision.disposition, "PROPOSE");
  assert.equal(decision.execution_authorized, false);
  assert.equal(decision.authority_scope, "ADVISORY_NON_EXECUTABLE");
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
  assert.throws(() => validateTechnologyEvidence({ plan, evidence_authority: { evidence_digest: "b".repeat(64), fresh_until: "2026-08-17T12:30:00.000Z" },
    profile_results: [{ technology: profile.technology, profile_digest: profile.profile_digest, detected_version: "99.99.99", passed: true,
      manifest_digests: ["c".repeat(64)], lockfile_digests: [], adapter_receipts: { compiler_type_checker: [receipt], tests: [receipt], lint_static_analysis: [receipt], dependency_inventory: [receipt] } }] }), /software_technology_version_mismatch/);
});

test("missing technical evidence forces abstention or a security block", () => {
  const common = { ...scope, disposition: "PROPOSE", recommendation: "Ship", rationale: [], bindings: {},
    issued_at: "2026-08-17T12:00:00.000Z", fresh_until: "2026-08-17T12:10:00.000Z" };
  const abstain = createNyraPrecoreDecision({ ...common, research_plan: { research_required: true, research_plan_digest: "a".repeat(64), risk_tier: "normal" } });
  assert.equal(abstain.disposition, "ABSTAIN");
  const block = createNyraPrecoreDecision({ ...common, research_plan: { research_required: true, research_plan_digest: "a".repeat(64), risk_tier: "security_critical" } });
  assert.equal(block.disposition, "RECOMMEND_BLOCK");
});
