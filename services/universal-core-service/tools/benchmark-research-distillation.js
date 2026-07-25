import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createResearchDistillationRuntime } from "../src/researchDistillationLayer.js";

const iterations = Number(process.env.NYRA_RESEARCH_BENCH_ITERATIONS || 200);
const storageRoot = path.join(os.tmpdir(), `nyra-research-bench-${Date.now()}`);
const runtime = createResearchDistillationRuntime({ storageRoot });
const evidence = [
  {
    source_id: "eur_lex",
    canonical_url: "https://eur-lex.europa.eu/eli/reg/2023/1545/oj",
    title: "EU legal reference",
    published_at: "2026-07-10T00:00:00Z",
    claim_summary: "Regulatory evidence supports the branch question.",
    support_direction: "support",
  },
  {
    source_id: "pubmed",
    canonical_url: "https://pubmed.ncbi.nlm.nih.gov/12345/",
    title: "Peer reviewed analysis",
    published_at: "2026-07-11T00:00:00Z",
    claim_summary: "Peer reviewed evidence confirms the relationship.",
    support_direction: "support",
  },
  {
    source_id: "nist",
    canonical_url: "https://www.nist.gov/example",
    title: "NIST guidance",
    published_at: "2026-07-12T00:00:00Z",
    claim_summary: "Standards evidence constrains the implementation.",
    support_direction: "neutral",
  },
];

const timings = [];
let finalCandidate = null;
for (let index = 0; index < iterations; index += 1) {
  const started = performance.now();
  const workspace = runtime.openWorkspace({
    tenant_id: "codexai",
    request_id: `research-bench-${index}`,
    question: "Quali fonti ufficiali sostengono il claim?",
    branch_ids: ["research_evidence", "quality_verification"],
    allowed_source_ids: ["eur_lex", "pubmed", "nist"],
    max_documents: 5,
    max_bytes: 200000,
    max_duration_ms: 20000,
  });
  runtime.attachEvidence(workspace.workspace_id, { tenant_id: "codexai", evidence });
  finalCandidate = runtime.distillCandidate(workspace.workspace_id, {
    evidence,
    lesson: "Lezioni verificate solo dopo outcome e fonti canoniche.",
    scope: "research_evidence",
  });
  runtime.closeWorkspace(workspace.workspace_id);
  timings.push(performance.now() - started);
}

const sum = timings.reduce((acc, value) => acc + value, 0);
const sorted = [...timings].sort((a, b) => a - b);
const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

console.log(JSON.stringify({
  schema_version: "nyra_research_distillation_benchmark_v1",
  iterations,
  storage_root: storageRoot,
  final_status: finalCandidate?.candidate?.status || null,
  quality_score: finalCandidate?.validation?.quality_score || null,
  timing_ms: {
    avg: Number((sum / timings.length).toFixed(4)),
    p50: Number(percentile(50).toFixed(4)),
    p95: Number(percentile(95).toFixed(4)),
    p99: Number(percentile(99).toFixed(4)),
  },
  metrics: runtime.status("codexai").metrics,
}, null, 2));
