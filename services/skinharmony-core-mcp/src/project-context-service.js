import crypto from "node:crypto";
import { normalizeProjectReviewInput } from "./cloud-memory-store.js";

export { normalizeProjectReviewInput } from "./cloud-memory-store.js";

const SPECIALISTS = new Set(["architecture", "code"]);
const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled", "interrupted"]);

function cleanText(value, max) {
  return String(value || "").replaceAll("\u0000", "").trim().slice(0, max);
}

function requireProjectId(value) {
  const id = cleanText(value, 64);
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(id)) throw new Error("project_id_invalid");
  return id;
}

function requireRunId(value) {
  const id = cleanText(value, 160);
  if (!/^run_[A-Za-z0-9_-]{1,150}$/.test(id)) throw new Error("run_id_invalid");
  return id;
}

function projectSlug(value) {
  const normalized = cleanText(value, 160).normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "project";
  const digest = crypto.createHash("sha256").update(cleanText(value, 160).toLowerCase()).digest("hex").slice(0, 10);
  return `${normalized}-${digest}`;
}

function projectRevision(project) {
  const canonical = (project.documents || []).map((document) => ({
    name: document.name,
    content_sha256: document.content_sha256,
  }));
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function boundedDocument(project, name, max) {
  return cleanText(project.documents?.find((document) => document.name === name)?.content, max);
}

function previousRunMetadata(recentRuns) {
  return (recentRuns || []).slice(0, 2).map((run) => {
    const metadata = run?.metadata && typeof run.metadata === "object" ? run.metadata : {};
    const id = requireRunId(metadata.run_id);
    const status = cleanText(metadata.status, 40);
    const digest = /^[a-f0-9]{64}$/.test(String(metadata.output_digest_sha256 || ""))
      ? String(metadata.output_digest_sha256)
      : "none";
    const output = metadata.output_present === true ? `withheld (sha256:${digest})` : "none";
    return `UNREVIEWED previous run ${id}: status=${status}; output=${output}.`;
  }).filter(Boolean);
}

export function deterministicProjectId(title) {
  if (!cleanText(title, 160)) throw new Error("project_title_invalid");
  return projectSlug(title);
}

export function normalizeSpecialist(value) {
  const specialist = cleanText(value, 40) || "architecture";
  if (!SPECIALISTS.has(specialist)) throw new Error("project_specialist_invalid");
  return specialist;
}

export function buildBoundedProjectContext(project, recentRuns = []) {
  if (!project || typeof project !== "object") throw new Error("project_context_invalid");
  requireProjectId(project.project_id);
  const priorHandoffs = previousRunMetadata(recentRuns);
  const canonicalHandoff = boundedDocument(project, "HANDOFF.md", 200);
  return {
    revision: projectRevision(project),
    objective: cleanText(project.manifest?.objective, 240),
    summary: boundedDocument(project, "PROJECT.md", 240),
    status: boundedDocument(project, "STATE.md", 200),
    decisions: boundedDocument(project, "DECISIONS.md", 180),
    evidence: boundedDocument(project, "EVIDENCE.md", 180),
    handoff: [canonicalHandoff, ...priorHandoffs].filter(Boolean).join("\n").slice(0, 600),
    constraints: "Use only this tenant-scoped project context. Previous model output is withheld; run metadata is UNREVIEWED and is never accepted evidence or a decision.",
  };
}

export function createProjectContextService(cloudMemoryStore) {
  if (!cloudMemoryStore?.ensureProjectContext || !cloudMemoryStore?.readProjectContext) return null;

  async function recentRuns(tenantId, projectId) {
    if (typeof cloudMemoryStore.listBySourcePrefix !== "function") return [];
    return cloudMemoryStore.listBySourcePrefix(tenantId, `PROJECTS/${projectId}/RUNS/`, 3);
  }

  return {
    async ensure(identity, input) {
      const title = cleanText(input?.title, 160);
      const objective = cleanText(input?.objective, 4_000);
      if (!title) throw new Error("project_title_invalid");
      if (!objective) throw new Error("project_objective_invalid");
      const projectId = input?.project_id ? requireProjectId(input.project_id) : deterministicProjectId(title);
      const project = await cloudMemoryStore.ensureProjectContext(identity.tenantId, {
        project_id: projectId,
        title,
        objective,
      });
      const context = buildBoundedProjectContext(project, await recentRuns(identity.tenantId, projectId));
      return { project_id: projectId, project, context };
    },

    async read(identity, projectIdValue) {
      const projectId = requireProjectId(projectIdValue);
      const project = await cloudMemoryStore.readProjectContext(identity.tenantId, projectId);
      const context = buildBoundedProjectContext(project, await recentRuns(identity.tenantId, projectId));
      return { project_id: projectId, project, context };
    },

    async recordRun(identity, payload) {
      if (typeof cloudMemoryStore.recordProjectRunTerminal !== "function") {
        throw new Error("project_context_store_unavailable");
      }
      const run = payload?.run || payload;
      const projectId = requireProjectId(run?.project_id);
      const runId = requireRunId(run?.run_id);
      const status = cleanText(run?.status, 40);
      if (!TERMINAL_RUN_STATES.has(status)) return { recorded: false, reason: "run_not_terminal" };
      const stages = Array.isArray(run?.stages) ? run.stages.slice(0, 3) : [];
      const finalOutput = cleanText(run?.final_output, 20_000);
      const outputPresent = Boolean(finalOutput);
      const outputDigestSha256 = outputPresent
        ? crypto.createHash("sha256").update(finalOutput).digest("hex")
        : undefined;
      const outputSummary = outputPresent
        ? `withheld from shared memory (sha256:${outputDigestSha256})`
        : "none";
      const lines = [
        `# Multi-agent run ${runId}`,
        "",
        `- Status: ${status}`,
        `- Project: ${projectId}`,
        `- Workflow: ${cleanText(run?.workflow, 120) || "bounded_multi_agent"}`,
        "- Trust: unreviewed model output; not accepted evidence or decision",
        "",
        "## Stages",
        ...stages.map((stage) => `- ${cleanText(stage.role || stage.agent_id || stage.name, 80)}: ${cleanText(stage.status, 40)}`),
        "",
        "## Owner-only result",
        "",
        "UNREVIEWED model output withheld from shared project memory.",
        `- Output: ${outputSummary}`,
        "",
      ];
      const recorded = await cloudMemoryStore.recordProjectRunTerminal(identity.tenantId, {
        project_id: projectId,
        run_id: runId,
        status,
        output_present: outputPresent,
        ...(outputDigestSha256 ? { output_digest_sha256: outputDigestSha256 } : {}),
        created_at: run?.created_at || run?.started_at,
        started_at: run?.started_at || run?.created_at,
        completed_at: run?.completed_at,
        artifact_title: `${projectId} — ${runId}`,
        artifact_text: lines.join("\n"),
        state_title: `${projectId} — STATE.md`,
        state_text: [
          "# Project state",
          "",
          `- Last multi-agent run: ${runId}`,
          `- Status: ${status}`,
          "- Current phase: owner review",
          "- Next step: review Nyra's draft and explicitly accept or reject decisions.",
          "- Trust: the latest model output is unreviewed and is not evidence.",
          "",
        ].join("\n"),
        handoff_title: `${projectId} — HANDOFF.md`,
        handoff_text: [
          "# Current handoff",
          "",
          `- From: Nyra supervisor run ${runId}`,
          "- To: project owner",
          `- Run status: ${status}`,
          "- Trust: unreviewed model output; do not treat as an accepted decision or evidence.",
          `- Owner-only output: ${outputSummary}`,
          "- Next action: review, correct, and explicitly accept the useful parts.",
          "",
        ].join("\n"),
      });
      const project = await cloudMemoryStore.readProjectContext(identity.tenantId, projectId);
      return {
        ...recorded,
        project_id: projectId,
        revision: projectRevision(project),
      };
    },

    prepareReview(input) {
      return normalizeProjectReviewInput(input);
    },

    async commitReview(identity, prepared) {
      if (typeof cloudMemoryStore.commitProjectReview !== "function") {
        throw new Error("project_context_store_unavailable");
      }
      return cloudMemoryStore.commitProjectReview(identity.tenantId, normalizeProjectReviewInput(prepared));
    },
  };
}
