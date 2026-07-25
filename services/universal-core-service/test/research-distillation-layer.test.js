import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";
import { createResearchDistillationRuntime, TRUSTED_SOURCE_REGISTRY_VERSION } from "../src/researchDistillationLayer.js";

const NOW = new Date("2026-07-15T12:00:00.000Z");

function sampleEvidence() {
  return [
    {
      source_id: "eur_lex",
      canonical_url: "https://eur-lex.europa.eu/eli/reg/2023/1545/oj",
      title: "EU legal reference",
      published_at: "2026-07-10T00:00:00Z",
      claim_summary: "Regulatory evidence supports the branch question.",
      support_direction: "support",
      citation: "EUR-Lex",
    },
    {
      source_id: "pubmed",
      canonical_url: "https://pubmed.ncbi.nlm.nih.gov/12345/",
      title: "Peer reviewed analysis",
      published_at: "2026-07-11T00:00:00Z",
      claim_summary: "Peer reviewed evidence confirms the relationship.",
      support_direction: "support",
      citation: "PubMed",
    },
    {
      source_id: "nist",
      canonical_url: "https://www.nist.gov/example",
      title: "NIST guidance",
      published_at: "2026-07-12T00:00:00Z",
      claim_summary: "Standards evidence constrains the implementation.",
      support_direction: "neutral",
      citation: "NIST",
    },
  ];
}

test("trusted source registry and learning packs are versioned and branch-bound", () => {
  const runtime = createResearchDistillationRuntime({ now: () => NOW, storageRoot: path.join(os.tmpdir(), `nyra-research-${Date.now()}`) });
  const registry = runtime.registry;
  assert.equal(registry.version, TRUSTED_SOURCE_REGISTRY_VERSION);
  assert(registry.sources.some((source) => source.source_id === "pubmed"));
  assert(registry.branch_bindings.research_evidence.includes("pubmed"));
  assert(runtime.branchPack("codexai", "research_evidence").learning_pack.manifest.branch_id === "research_evidence");
  assert(runtime.branchPack("codexai", "research_evidence").learning_pack.manifest.source_registry_version === TRUSTED_SOURCE_REGISTRY_VERSION);
  assert(runtime.branchPack("codexai", "research_evidence").learning_pack.verified_knowledge.length === 0);
});

test("research runtime opens a workspace, normalizes evidence and distills a candidate", () => {
  const runtime = createResearchDistillationRuntime({ now: () => NOW, storageRoot: path.join(os.tmpdir(), `nyra-research-${Date.now()}`) });
  const workspace = runtime.openWorkspace({
    tenant_id: "codexai",
    request_id: "research-request-1",
    question: "Quali fonti ufficiali sostengono il claim?",
    branch_ids: ["research_evidence", "quality_verification"],
    allowed_source_ids: ["eur_lex", "pubmed", "nist"],
    max_documents: 5,
    max_bytes: 200000,
    max_duration_ms: 20000,
  });
  const attached = runtime.attachEvidence(workspace.workspace_id, { tenant_id: "codexai", evidence: sampleEvidence() });
  assert.equal(attached.evidence.length, 3);
  assert.equal(attached.validation.state, "candidate");
  assert.equal(attached.dtt_binding.branch_ids[0], "research_evidence");
  const distill = runtime.distillCandidate(workspace.workspace_id, {
    evidence: sampleEvidence(),
    lesson: "Lezioni verificate solo dopo outcome e fonti canoniche.",
    scope: "research_evidence",
    persist_verified: true,
  });
  assert.equal(distill.candidate.schema_version, "nyra_learning_candidate_v1");
  assert.equal(distill.candidate.tenant_id, "codexai");
  assert.equal(distill.candidate.branch_id, "research_evidence");
  assert.equal(distill.guardrail.automatic_promotion, false);
  assert(distill.candidate.status === "confirmed" || distill.candidate.status === "under_review");
  assert(distill.candidate.source_refs.includes("eur_lex"));
});

test("research runtime fail-closes private hosts and unknown branches", () => {
  const runtime = createResearchDistillationRuntime({ now: () => NOW });
  assert.throws(() => runtime.authorizeEnvelope({ tenant_id: "codexai", branch_ids: ["unknown_branch"], allowed_source_ids: ["eur_lex"] }), /research_branch_unknown/);
  assert.throws(() => runtime.normalizeEvidenceItem({
    source_id: "eur_lex",
    canonical_url: "http://127.0.0.1/private",
    title: "Private",
    claim_summary: "Blocked",
  }), /research_source_url_rejected|research_source_host_rejected/);
});

test("research API exposes registry, packs, workspace and distillation endpoints", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "research-layer-admin";
  const storageRoot = path.join(os.tmpdir(), `research-layer-api-${Date.now()}`);
  const { app } = createUniversalCoreService({ storageRoot });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, pathname, body, key = "research-layer-admin") => {
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  };

  try {
    const generated = await request("POST", "/v1/keys/generate", {
      tenant_id: "codexai",
      preset: "nyra_core_360_connector",
    });
    assert.equal(generated.status, 201);
    const coreKey = generated.json.key;

    const registry = await request("GET", "/v1/research/source-registry", undefined, coreKey);
    assert.equal(registry.status, 200);
    assert.equal(registry.json.registry.version, TRUSTED_SOURCE_REGISTRY_VERSION);

    const packs = await request("GET", "/v1/research/learning-packs?branch_id=research_evidence", undefined, coreKey);
    assert.equal(packs.status, 200);
    assert.equal(packs.json.learning_pack.manifest.branch_id, "research_evidence");

    const opened = await request("POST", "/v1/research/workspaces/open", {
      request_id: "research-api-1",
      question: "Quali fonti ufficiali servono?",
      branch_ids: ["research_evidence", "quality_verification"],
      allowed_source_ids: ["eur_lex", "pubmed", "nist"],
      max_documents: 5,
      max_bytes: 200000,
      max_duration_ms: 20000,
    }, coreKey);
    assert.equal(opened.status, 201);
    const workspaceId = opened.json.workspace.workspace_id;

    const attached = await request("POST", "/v1/research/workspaces/attach", {
      workspace_id: workspaceId,
      evidence: sampleEvidence(),
    }, coreKey);
    assert.equal(attached.status, 200);
    assert.equal(attached.json.evidence.length, 3);

    const distill = await request("POST", "/v1/research/distill", {
      workspace_id: workspaceId,
      evidence: sampleEvidence(),
      lesson: "Lezioni verificate e governate dal Core.",
      scope: "research_evidence",
      persist_verified: true,
    }, coreKey);
    assert.equal(distill.status, 200);
    assert.equal(distill.json.candidate.tenant_id, "codexai");
    assert.equal(distill.json.guardrail.automatic_promotion, false);

    const cleanup = await request("POST", "/v1/research/cleanup", {}, coreKey);
    assert.equal(cleanup.status, 200);
    assert.equal(cleanup.json.cleanup.cleaned >= 0, true);

    const status = await request("GET", "/v1/research/status", undefined, coreKey);
    assert.equal(status.status, 200);
    assert.equal(status.json.status.registry_version, TRUSTED_SOURCE_REGISTRY_VERSION);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});
