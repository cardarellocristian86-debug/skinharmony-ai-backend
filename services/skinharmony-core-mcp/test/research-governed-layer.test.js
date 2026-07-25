import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGovernedResearchLayer } from "../src/research-governed-layer.js";
import { TRUSTED_SOURCE_REGISTRY, getBranchLearningPack } from "../src/research-governed-registry.js";

const identity = { tenantId: "tenant-a", subject: "user-a", scopes: ["core:read", "core:govern"] };
const identityBlocked = { tenantId: "tenant-b", subject: "user-b", scopes: ["core:read", "core:govern"] };

function config(root, overrides = {}) {
  return {
    researchCortexRoot: root,
    researchGovernedRoot: root,
    memoryFabricRoot: root,
    sharedMemoryRoot: root,
    researchGovernedEnabled: true,
    researchGovernedMode: "shadow",
    researchTenantAllowlist: ["tenant-a"],
    researchMaxDocuments: 4,
    researchMaxBytes: 250_000,
    researchTimeoutMs: 5_000,
    researchCacheTtlSeconds: 120,
    researchRetentionDays: 365,
    distillationRequiresReview: true,
    openaiApiKey: "",
    openaiResearchEnabled: false,
    openaiResearchModel: "gpt-5.6",
    openaiResearchTimeoutMs: 5_000,
    openaiResearchMaxCallsPerHour: 10,
    ...overrides,
  };
}

function providers() {
  return {
    govern: async () => ({ allowed: true, decision: "allow_controlled", mediation: "allow" }),
    planProvider: async (args, identityValue) => ({ structuredContent: {
      ok: true,
      tenant_id: identityValue.tenantId,
      research_plan: {
        plan_id: "rp_12345678-1234-1234-1234-123456789012",
        question: args.question,
        source_policy: { minimum_independent_sources: 1, freshness_days: 30, allowed_domains: args.allowed_domains || [] },
      },
    } }),
    validateProvider: async ({ evidence_pack: pack }, identityValue) => ({ structuredContent: {
      ok: true,
      tenant_id: identityValue.tenantId,
      validation: {
        schema_version: "core_research_validation_v1",
        validation_id: "rv_12345678-1234-1234-1234-123456789012",
        state: "candidate",
        quality_score: 92,
        confidence_band: "high",
        effective_policy: { minimum_independent_sources: 1, freshness_days: 30, allowed_domains: ["pubmed.ncbi.nlm.nih.gov", "eur-lex.europa.eu"] },
        source_count: pack.sources.length,
        independent_host_count: pack.sources.length,
        authoritative_source_count: pack.sources.length,
        source_assessments: pack.sources.map((source) => ({ source_id: source.id, hostname: source.hostname, authority_score: 90, freshness_state: "fresh" })),
        claim_assessments: pack.claims.map((claim) => ({ claim_id: claim.id, state: "supported", support_score: 90 })),
        contradictions: [],
        threat_assessment: { prompt_injection_count: 0, sensitive_content_count: 0 },
        release_readiness: { eligible_for_tenant_review: true, missing: [], automatic_validation_allowed: false, global_promotion_allowed: false },
      },
    } }),
  };
}

function evidence() {
  return {
    question: "Need authoritative research evidence on cosmetic ingredient safety and verification",
    plan_id: "rp_12345678-1234-1234-1234-123456789012",
    plan: { source_policy: { minimum_independent_sources: 1, freshness_days: 30, allowed_domains: ["pubmed.ncbi.nlm.nih.gov", "eur-lex.europa.eu"] } },
    sources: [
      {
        id: "pubmed_evidence",
        url: "https://pubmed.ncbi.nlm.nih.gov/12345/",
        title: "PubMed evidence on ingredient safety",
        publisher: "PubMed",
        source_type: "academic",
        published_at: "2026-07-01T00:00:00.000Z",
        excerpt: "Study summary on ingredient safety.",
      },
      {
        id: "eurlex_notice",
        url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32009R1223",
        title: "EU Cosmetic Regulation",
        publisher: "EUR-Lex",
        source_type: "regulator",
        published_at: "2026-07-02T00:00:00.000Z",
        excerpt: "Regulatory requirement summary.",
      },
    ],
    claims: [
      {
        id: "claim_safety",
        kind: "fact",
        text: "The ingredient requires verification against official safety sources.",
        source_ids: ["pubmed_evidence", "eurlex_notice"],
        confidence: 0.9,
      },
    ],
    idempotency_key: "research-idem-1",
  };
}

test("governed research layer opens a workspace, normalizes sources and exposes registry metadata", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "research-governed-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const layer = createGovernedResearchLayer(config(root), providers());
  const plan = await layer.plan({ question: evidence().question, allowed_domains: ["pubmed.ncbi.nlm.nih.gov", "eur-lex.europa.eu"] }, identity);
  assert.equal(plan.research_governance.enabled, true);
  assert.equal(plan.research_governance.mode, "shadow");
  assert.equal(plan.research_governance.source_registry.schema_version, TRUSTED_SOURCE_REGISTRY.schema_version);
  assert.equal(plan.research_governance.source_registry.source_count > 0, true);
  assert.equal(plan.research_governance.workspace.branch_ids.includes("research_evidence"), true);
  assert.equal(plan.research_governance.workspace.branch_learning_packs.length > 0, true);
  assert.equal(plan.research_governance.workspace.allowed_source_ids.includes("pubmed"), true);
  assert.equal(getBranchLearningPack("research_evidence").manifest.branch_id, "research_evidence");

  const ingested = await layer.ingest(evidence(), identity);
  assert.equal(ingested.research_governance.enabled, true);
  assert.equal(ingested.research_governance.workspace.evidence_count, 2);
  assert.equal(ingested.research_governance.evidence.every((item) => item.redacted === true), true);
  assert.equal(ingested.research_governance.evidence[0].source_id, "pubmed");
  assert.equal(ingested.research_governance.evidence[1].source_id, "eur_lex");
  assert.equal(ingested.research_governance.workspace.dtt_binding.evidence_refs.length, 2);

  const status = layer.status({}, identity);
  assert.equal(status.research_governance.workspace_count, 1);
  assert.equal(status.research_governance.learning_candidate_count, 0);
  assert.equal(status.research_governance.cache_count >= 2, true);
});

test("validated feedback creates a learning candidate and preserves tenant isolation", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "research-governed-feedback-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let memoryWrites = 0;
  const layer = createGovernedResearchLayer(config(root), {
    ...providers(),
    memoryFabric: {
      append: async () => {
        memoryWrites += 1;
        return { memory: { id: "mem_12345678-1234-1234-1234-123456789012" } };
      },
    },
  });
  await layer.plan({ question: evidence().question, allowed_domains: ["pubmed.ncbi.nlm.nih.gov", "eur-lex.europa.eu"] }, identity);
  const ingested = await layer.ingest(evidence(), identity);
  const reviewed = await layer.feedback({ record_id: ingested.record.id, verdict: "confirm", rationale: "Confermo evidenza verificata." }, identity);
  assert.equal(reviewed.research_governance.candidate.status, "confirmed");
  assert.equal(reviewed.research_governance.candidate.source_refs.includes("pubmed"), true);
  assert.equal(memoryWrites, 1);
  const status = layer.status({}, identity);
  assert.equal(status.research_governance.learning_candidate_count, 1);
  assert.equal(status.research_governance.learning_candidates[0].status, "confirmed");
  assert.equal(status.research_governance.learning_candidates[0].tenant_id, "tenant-a");
});

test("disabled tenant falls back to the underlying research cortex without governed workspace state", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "research-governed-tenant-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const layer = createGovernedResearchLayer(config(root), providers());
  const plan = await layer.plan({ question: evidence().question, allowed_domains: ["pubmed.ncbi.nlm.nih.gov", "eur-lex.europa.eu"] }, identityBlocked);
  assert.equal(plan.research_governance.enabled, false);
  assert.equal(plan.research_governance.workspace, null);
  const status = layer.status({}, identityBlocked);
  assert.equal(status.research_governance.enabled, false);
  assert.equal(status.research_governance.workspace_count, 0);
});
