import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCoreResearchDirective } from "../src/coreResearchDirective.js";
import { createResearchDistillationRuntime } from "../src/researchDistillationLayer.js";

const INITIAL_NOW = new Date("2026-07-15T12:00:00.000Z");

function runtimeEnv(mode = "shadow", overrides = {}) {
  return {
    NYRA_RESEARCH_DISTILLATION_ENABLED: "true",
    NYRA_RESEARCH_DISTILLATION_MODE: mode,
    NYRA_RESEARCH_TENANT_ALLOWLIST: "tenant-a,tenant-b",
    ...overrides,
  };
}

function evidence(sourceId, suffix = "1") {
  const source = {
    eur_lex: {
      canonical_url: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${suffix}`,
      title: `EUR-Lex evidence ${suffix}`,
    },
    pubmed: {
      canonical_url: `https://pubmed.ncbi.nlm.nih.gov/${suffix}/`,
      title: `PubMed evidence ${suffix}`,
    },
    nist: {
      canonical_url: `https://www.nist.gov/publications/example-${suffix}`,
      title: `NIST evidence ${suffix}`,
    },
  }[sourceId];
  return {
    source_id: sourceId,
    ...source,
    published_at: "2026-07-10T00:00:00.000Z",
    claim_summary: `${source.title} supports the governed research claim.`,
    support_direction: "support",
    citation: source.title,
  };
}

function open(runtime, tenantId = "tenant-a", overrides = {}) {
  const input = {
    request_id: `request-${tenantId}`,
    question: "Which governed evidence supports this claim?",
    branch_ids: ["research_evidence"],
    allowed_source_ids: ["eur_lex", "pubmed", "nist"],
    max_documents: 3,
    max_bytes: 200_000,
    max_duration_ms: 30_000,
    ...overrides,
  };
  const coreResearch = buildCoreResearchDirective({
    tenantId,
    requestText: input.question,
    operationType: "research_distillation_shadow",
    evidenceState: { source_count: 0, confidence: 0, freshness_state: "unknown", evidence_gap: true },
    selectedBranches: input.branch_ids,
  });
  const envelope = runtime.authorizeEnvelope({ ...input, tenant_id: tenantId }, {
    tenantId,
    coreDirective: coreResearch.directive,
  });
  if (envelope.status === "denied") return envelope;
  return runtime.openWorkspace({ tenant_id: tenantId, envelope_id: envelope.envelope_id });
}

test("tenant allowlist parses CSV values and remains fail-closed", () => {
  const runtime = createResearchDistillationRuntime({
    env: runtimeEnv("shadow", {
      NYRA_RESEARCH_TENANT_ALLOWLIST: " tenant-a,tenant-b, tenant-a ,,",
    }),
    now: () => INITIAL_NOW,
  });

  assert.deepEqual(runtime.config.tenant_allowlist, ["tenant-a", "tenant-b"]);
  assert.throws(() => open(runtime, "tenant-c"), /research_tenant_not_allowlisted/);
  assert.equal(open(runtime, "tenant-a").tenant_id, "tenant-a");

  const missing = createResearchDistillationRuntime({
    env: runtimeEnv("shadow", {
      NYRA_RESEARCH_TENANT_ALLOWLIST: "   ",
      CORE_RESEARCH_TENANT_ALLOWLIST: "   ",
    }),
    now: () => INITIAL_NOW,
  });
  assert.throws(() => open(missing, "tenant-a"), /research_tenant_allowlist_required/);

  const fallback = createResearchDistillationRuntime({
    env: runtimeEnv("shadow", {
      NYRA_RESEARCH_TENANT_ALLOWLIST: "   ",
      CORE_RESEARCH_TENANT_ALLOWLIST: "tenant-a",
    }),
    now: () => INITIAL_NOW,
  });
  assert.deepEqual(fallback.config.tenant_allowlist, ["tenant-a"]);

  assert.throws(() => createResearchDistillationRuntime({
    env: runtimeEnv("active", { NYRA_DISTILLATION_REQUIRES_REVIEW: "truue" }),
  }), /distillation_requires_review_invalid/);
});

test("workspace operations enforce enabled mode and authenticated tenant", () => {
  const disabled = createResearchDistillationRuntime({
    env: runtimeEnv("active", { NYRA_RESEARCH_DISTILLATION_ENABLED: "false" }),
    now: () => INITIAL_NOW,
  });
  const placeholder = "rw_00000000-0000-0000-0000-000000000000";
  assert.equal(open(disabled).status, "denied");
  assert.throws(() => disabled.attachEvidence(placeholder, { tenant_id: "tenant-a", evidence: [] }), /research_distillation_disabled/);
  assert.throws(() => disabled.distillCandidate(placeholder, { tenant_id: "tenant-a" }), /research_distillation_disabled/);
  assert.throws(() => disabled.closeWorkspace(placeholder, { tenant_id: "tenant-a" }), /research_distillation_disabled/);
  assert.throws(() => disabled.cleanupExpired({ tenant_id: "tenant-a" }), /research_distillation_disabled/);

  const modeOff = createResearchDistillationRuntime({
    env: runtimeEnv("off"),
    now: () => INITIAL_NOW,
  });
  assert.equal(open(modeOff).status, "denied");

  const runtime = createResearchDistillationRuntime({
    env: runtimeEnv("shadow", { NYRA_RESEARCH_TENANT_ALLOWLIST: "tenant-a,tenant-b" }),
    now: () => INITIAL_NOW,
  });
  const workspace = open(runtime);
  assert.throws(() => runtime.attachEvidence(workspace.workspace_id, { evidence: [evidence("eur_lex")] }), /research_tenant_required/);
  assert.throws(() => runtime.distillCandidate(workspace.workspace_id), /research_tenant_required/);
  assert.throws(() => runtime.closeWorkspace(workspace.workspace_id), /research_tenant_required/);
  assert.throws(() => runtime.attachEvidence(workspace.workspace_id, { tenant_id: "tenant-b", evidence: [evidence("eur_lex")] }), /research_workspace_tenant_mismatch/);
  assert.throws(() => runtime.distillCandidate(workspace.workspace_id, { tenant_id: "tenant-b" }), /research_workspace_tenant_mismatch/);
  assert.throws(() => runtime.closeWorkspace(workspace.workspace_id, { tenant_id: "tenant-b" }), /research_workspace_tenant_mismatch/);
  assert.throws(() => runtime.cleanupExpired(), /research_tenant_required/);
  assert.throws(() => runtime.authorizeEnvelope({
    tenant_id: "tenant-b",
    branch_ids: ["research_evidence"],
  }, { tenantId: "tenant-a" }), /research_tenant_mismatch/);
});

test("shadow mode is observational and never writes workspace or learning files", () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-research-shadow-"));
  const runtime = createResearchDistillationRuntime({
    env: runtimeEnv("shadow", { NYRA_DISTILLATION_REQUIRES_REVIEW: "false" }),
    now: () => INITIAL_NOW,
    storageRoot,
  });
  const workspace = open(runtime);
  runtime.attachEvidence(workspace.workspace_id, {
    tenant_id: "tenant-a",
    evidence: [evidence("eur_lex"), evidence("pubmed"), evidence("nist")],
  });
  const result = runtime.distillCandidate(workspace.workspace_id, {
    tenant_id: "tenant-a",
    persist_verified: true,
    lesson: "This remains an observational result.",
  });

  assert.equal(result.candidate.status, "under_review");
  assert.equal(result.verified_learning, null);
  assert.equal(result.guardrail.observational_mode, true);
  assert.equal(result.guardrail.durable_persistence_performed, false);
  runtime.closeWorkspace(workspace.workspace_id, { tenant_id: "tenant-a" });
  runtime.cleanupExpired({ tenant_id: "tenant-a" });
  assert.equal(fs.existsSync(path.join(storageRoot, "research")), false);
});

test("mandatory review holds confirmation and verified persistence", () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-research-review-"));
  const runtime = createResearchDistillationRuntime({
    env: runtimeEnv("active", { NYRA_DISTILLATION_REQUIRES_REVIEW: "true" }),
    now: () => INITIAL_NOW,
    storageRoot,
    activeAuthorizationVerifier: () => true,
  });
  const workspace = open(runtime);
  runtime.attachEvidence(workspace.workspace_id, {
    tenant_id: "tenant-a",
    evidence: [evidence("eur_lex"), evidence("pubmed"), evidence("nist")],
  });
  const result = runtime.distillCandidate(workspace.workspace_id, {
    tenant_id: "tenant-a",
    persist_verified: true,
    lesson: "A reviewer must confirm this lesson.",
  });

  assert.equal(result.validation.release_readiness.eligible_for_tenant_review, true);
  assert.equal(result.candidate.status, "under_review");
  assert.equal(result.candidate.review.state, "pending");
  assert.equal(result.verified_learning, null);
  assert.equal(result.guardrail.memory_promotion_allowed, false);
  assert.equal(fs.existsSync(path.join(storageRoot, "research", "verified-learning", "tenant-a.jsonl")), false);
});

test("active mode can persist only when mandatory review is explicitly disabled", () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-research-active-"));
  const runtime = createResearchDistillationRuntime({
    env: runtimeEnv("active", { NYRA_DISTILLATION_REQUIRES_REVIEW: "false" }),
    now: () => INITIAL_NOW,
    storageRoot,
    activeAuthorizationVerifier: () => true,
  });
  const workspace = open(runtime);
  runtime.attachEvidence(workspace.workspace_id, {
    tenant_id: "tenant-a",
    evidence: [evidence("eur_lex"), evidence("pubmed"), evidence("nist")],
  });
  const result = runtime.distillCandidate(workspace.workspace_id, {
    tenant_id: "tenant-a",
    persist_verified: true,
    lesson: "Explicit active-mode persistence remains compatible.",
  });

  assert.equal(result.candidate.status, "confirmed");
  assert.equal(result.guardrail.durable_persistence_performed, true);
  assert.equal(fs.existsSync(path.join(storageRoot, "research", "verified-learning", "tenant-a.jsonl")), true);
});

test("candidate source records are evidence-backed and validation accepts repeated registry sources", () => {
  const runtime = createResearchDistillationRuntime({
    env: runtimeEnv(),
    now: () => INITIAL_NOW,
  });
  assert.throws(() => open(runtime, "tenant-a", {
    branch_ids: ["communication_explanation"],
    allowed_source_ids: ["pubmed"],
  }), /research_source_not_authorized/);

  const workspace = open(runtime, "tenant-a", {
    allowed_source_ids: ["pubmed"],
    max_documents: 2,
  });
  const attached = runtime.attachEvidence(workspace.workspace_id, {
    tenant_id: "tenant-a",
    evidence: [evidence("pubmed", "111"), evidence("pubmed", "222")],
  });
  assert.equal(attached.validation.source_count, 2);
  assert.equal(new Set(attached.validation.source_assessments.map((item) => item.source_id)).size, 2);

  const result = runtime.distillCandidate(workspace.workspace_id, { tenant_id: "tenant-a" });
  assert.deepEqual(result.candidate.source_refs, ["pubmed"]);
  assert.equal(result.candidate.source_records.length, 1);
  assert.equal(result.candidate.source_evidence.length, 2);
  assert.equal(result.candidate.core_policy_validation.source_records_valid, true);
  assert.equal(result.candidate.core_policy_validation.source_evidence_valid, true);
});

test("max_documents is cumulative and rejected batches do not partially mutate a workspace", () => {
  const runtime = createResearchDistillationRuntime({
    env: runtimeEnv(),
    now: () => INITIAL_NOW,
  });
  const workspace = open(runtime, "tenant-a", { max_documents: 2 });
  runtime.attachEvidence(workspace.workspace_id, { tenant_id: "tenant-a", evidence: [evidence("eur_lex")] });
  runtime.attachEvidence(workspace.workspace_id, { tenant_id: "tenant-a", evidence: [evidence("pubmed")] });
  assert.throws(() => runtime.attachEvidence(workspace.workspace_id, {
    tenant_id: "tenant-a",
    evidence: [evidence("nist")],
  }), /research_workspace_document_limit_exceeded/);

  const unchanged = runtime.attachEvidence(workspace.workspace_id, { tenant_id: "tenant-a", evidence: [] });
  assert.equal(unchanged.workspace.document_count, 2);
  assert.equal(unchanged.evidence.length, 2);
});

test("invalid source evidence rejects the whole batch before workspace mutation", () => {
  const runtime = createResearchDistillationRuntime({
    env: runtimeEnv(),
    now: () => INITIAL_NOW,
  });
  const workspace = open(runtime, "tenant-a", { max_documents: 1 });
  assert.throws(() => runtime.attachEvidence(workspace.workspace_id, {
    tenant_id: "tenant-a",
    evidence: [
      evidence("eur_lex"),
      {
        ...evidence("pubmed"),
        canonical_url: "https://example.org/not-pubmed",
      },
    ],
  }), /research_source_domain_not_allowed/);

  const attached = runtime.attachEvidence(workspace.workspace_id, {
    tenant_id: "tenant-a",
    evidence: [evidence("nist")],
  });
  assert.equal(attached.workspace.document_count, 1);
  assert.equal(attached.evidence[0].source_id, "nist");
});

test("TTL cleanup is exact, tenant-scoped, and removes only expired tenant files", () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-research-ttl-"));
  let current = new Date(INITIAL_NOW);
  const runtime = createResearchDistillationRuntime({
    env: runtimeEnv("active", {
      NYRA_RESEARCH_TENANT_ALLOWLIST: "tenant-a,tenant-b",
      NYRA_RESEARCH_TIMEOUT_MS: "120000",
      NYRA_RESEARCH_CACHE_TTL_SECONDS: "60",
    }),
    now: () => current,
    storageRoot,
    activeAuthorizationVerifier: () => true,
  });
  const workspaceA = open(runtime, "tenant-a", { max_duration_ms: 120_000 });
  const workspaceB = open(runtime, "tenant-b", { max_duration_ms: 120_000 });
  const fileA = path.join(storageRoot, "research", "workspaces", "tenant-a", `${workspaceA.workspace_id}.json`);
  const fileB = path.join(storageRoot, "research", "workspaces", "tenant-b", `${workspaceB.workspace_id}.json`);
  assert.equal(fs.existsSync(fileA), true);
  assert.equal(fs.existsSync(fileB), true);

  current = new Date(INITIAL_NOW.getTime() + 59_999);
  assert.equal(runtime.cleanupExpired({ tenant_id: "tenant-a" }), 0);
  current = new Date(INITIAL_NOW.getTime() + 60_000);
  assert.equal(runtime.cleanupExpired({ tenant_id: "tenant-a" }), 1);
  assert.equal(fs.existsSync(fileA), false);
  assert.equal(fs.existsSync(fileB), true);
  assert.equal(runtime.cleanupExpired({ tenant_id: "tenant-a" }), 0);
  assert.equal(runtime.cleanupExpired({ tenant_id: "tenant-b" }), 1);
  assert.equal(fs.existsSync(fileB), false);
});

test("envelopes are Core-issued, single-use and active mode needs a separate verifier", () => {
  const input = {
    request_id: "single-use-envelope",
    question: "Which governed evidence supports this claim?",
    branch_ids: ["research_evidence"],
    allowed_source_ids: ["nist"],
  };
  const coreResearch = buildCoreResearchDirective({
    tenantId: "tenant-a",
    requestText: input.question,
    operationType: "research_distillation_shadow",
    evidenceState: { evidence_gap: true },
    selectedBranches: input.branch_ids,
  });
  const shadow = createResearchDistillationRuntime({
    env: runtimeEnv("shadow"),
    now: () => INITIAL_NOW,
  });
  assert.throws(() => shadow.authorizeEnvelope({ ...input, tenant_id: "tenant-a" }, {
    tenantId: "tenant-a",
  }), /research_core_directive_invalid/);
  const envelope = shadow.authorizeEnvelope({ ...input, tenant_id: "tenant-a" }, {
    tenantId: "tenant-a",
    coreDirective: coreResearch.directive,
  });
  assert.equal(envelope.status, "shadow_only");
  const workspace = shadow.openWorkspace({ tenant_id: "tenant-a", envelope_id: envelope.envelope_id });
  assert.equal(workspace.dtt_binding.core_decision_reference, coreResearch.directive.directive_id);
  assert.throws(() => shadow.openWorkspace({
    tenant_id: "tenant-a",
    envelope_id: envelope.envelope_id,
  }), /research_envelope_replayed/);

  const active = createResearchDistillationRuntime({
    env: runtimeEnv("active"),
    now: () => INITIAL_NOW,
  });
  const denied = active.authorizeEnvelope({ ...input, tenant_id: "tenant-a" }, {
    tenantId: "tenant-a",
    coreDirective: coreResearch.directive,
  });
  assert.equal(denied.status, "denied");
});

test("status metrics and registry config never reveal another tenant", () => {
  const runtime = createResearchDistillationRuntime({
    env: runtimeEnv("shadow"),
    now: () => INITIAL_NOW,
  });
  const workspaceA = open(runtime, "tenant-a");
  open(runtime, "tenant-b");
  runtime.attachEvidence(workspaceA.workspace_id, {
    tenant_id: "tenant-a",
    evidence: [evidence("nist")],
  });
  const statusA = runtime.status("tenant-a");
  const statusB = runtime.status("tenant-b");
  assert.equal(statusA.metrics.workspace_created, 1);
  assert.equal(statusB.metrics.workspace_created, 1);
  assert.equal(statusA.metrics.sources_used, 1);
  assert.equal(statusB.metrics.sources_used, 0);
  const config = runtime.registryForTenant("tenant-a").config;
  assert.equal("tenant_allowlist" in config, false);
  assert.equal(config.tenant_allowlist_size, 2);
});
