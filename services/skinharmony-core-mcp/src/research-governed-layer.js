import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createResearchCortex } from "./research-cortex.js";
import {
  TRUSTED_SOURCE_REGISTRY,
  branchesForQuestion,
  getBranchLearningPack,
  getSourceByHostname,
  getSourceById,
  listBranchLearningPacks,
  allowedSourcesForBranches,
} from "./research-governed-registry.js";

const GOVERNED_RESEARCH_SCHEMA_VERSION = "tenant_research_governed_layer_v1";

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function cleanText(value, max = 2_000) {
  return String(value || "").trim().slice(0, max);
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function safeId(value, name, { optional = false } = {}) {
  const id = String(value || "").trim();
  if (!id && optional) return "";
  if (!/^[a-z][a-z0-9_-]{1,63}$/i.test(id)) throw new Error(`${name}_invalid`);
  return id;
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

function workspaceRoot(config) {
  const root = String(config.researchGovernedRoot || config.researchCortexRoot || config.memoryFabricRoot || "").trim();
  if (!root) throw new Error("research_governed_root_not_configured");
  return root;
}

function tenantDirectory(root, tenantId) {
  const tenant = safeId(tenantId, "tenant");
  const base = path.resolve(root, "tenants");
  const resolved = path.resolve(base, tenant, "research-governed");
  if (!resolved.startsWith(`${base}${path.sep}`)) throw new Error("tenant_path_rejected");
  return resolved;
}

function statePath(root, tenantId) {
  return path.join(tenantDirectory(root, tenantId), "state.json");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(directory, ".research-governed.lock");
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const handle = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
      return { handle, lockPath };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > 30_000) fs.unlinkSync(lockPath);
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
      }
      await wait(25);
    }
  }
  throw new Error("research_governed_busy");
}

function releaseLock(lock) {
  try { fs.closeSync(lock.handle); } catch {}
  try { fs.unlinkSync(lock.lockPath); } catch {}
}

function emptyState() {
  return {
    schema_version: GOVERNED_RESEARCH_SCHEMA_VERSION,
    revision: 0,
    source_registry_version: TRUSTED_SOURCE_REGISTRY.schema_version,
    workspaces: [],
    cache: [],
    learning_candidates: [],
    audit: [],
  };
}

function normalizeState(value) {
  const state = value && typeof value === "object" && !Array.isArray(value) ? value : emptyState();
  state.schema_version = GOVERNED_RESEARCH_SCHEMA_VERSION;
  state.revision = Number.isInteger(state.revision) && state.revision >= 0 ? state.revision : 0;
  state.source_registry_version = String(state.source_registry_version || TRUSTED_SOURCE_REGISTRY.schema_version);
  for (const key of ["workspaces", "cache", "learning_candidates", "audit"]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  return state;
}

function readState(root, tenantId) {
  const file = statePath(root, tenantId);
  if (!fs.existsSync(file)) return emptyState();
  return normalizeState(JSON.parse(fs.readFileSync(file, "utf8")));
}

async function updateState(root, tenantId, mutate) {
  const directory = tenantDirectory(root, tenantId);
  const lock = await acquireLock(directory);
  try {
    const state = readState(root, tenantId);
    pruneState(state);
    const result = await mutate(state);
    state.revision += 1;
    const temporary = path.join(directory, `.state-${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, statePath(root, tenantId));
    return { result, revision: state.revision };
  } finally {
    releaseLock(lock);
  }
}

function pruneState(state, now = Date.now(), cacheTtlSeconds = 900) {
  const active = (item) => !item.expires_at || new Date(item.expires_at).getTime() > now;
  state.workspaces = state.workspaces.filter(active).slice(-500);
  state.learning_candidates = state.learning_candidates.filter(active).slice(-500);
  state.cache = state.cache.filter((item) => active(item) && (!item.last_accessed_at || now - new Date(item.last_accessed_at).getTime() <= cacheTtlSeconds * 1000)).slice(-1_000);
  state.audit = state.audit.slice(-5_000);
}

function parseMode(config) {
  const raw = String(config.researchGovernedMode || "off").trim().toLowerCase();
  return ["off", "shadow", "advisory", "active"].includes(raw) ? raw : "off";
}

function activeEnabled(config) {
  return truthy(config.researchGovernedEnabled) && parseMode(config) !== "off";
}

function sourceForUrl(url) {
  try {
    return getSourceByHostname(new URL(url).hostname);
  } catch {
    return null;
  }
}

function freshnessScore(publishedAt, policyDays) {
  const published = Date.parse(publishedAt || "");
  if (!Number.isFinite(published)) return 0.5;
  const ageDays = Math.max(0, (Date.now() - published) / 86_400_000);
  const policy = Math.max(1, Number(policyDays) || 365);
  return Number(Math.max(0, 1 - ageDays / policy).toFixed(3));
}

function relevanceScore(question, source, claims = []) {
  const text = `${question} ${source.title} ${source.publisher || ""} ${source.hostname} ${source.excerpt || ""} ${claims.map((claim) => claim.text).join(" ")}`.toLowerCase();
  const tokens = String(question || "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 12);
  if (!tokens.length) return 0.5;
  const hits = tokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0);
  return Number(Math.min(1, hits / Math.max(3, tokens.length)).toFixed(3));
}

function inferAllowedDomains(branchIds) {
  const domains = new Set();
  for (const branchId of branchIds) {
    const pack = getBranchLearningPack(branchId);
    for (const sourceId of pack?.source_ids || []) {
      const source = getSourceById(sourceId);
      for (const domain of source?.allowed_domains || []) domains.add(domain);
    }
  }
  return [...domains];
}

function normalizeEvidenceSources(inputSources, question, branchIds, maxDocuments, maxBytes) {
  if (!Array.isArray(inputSources) || !inputSources.length) throw new Error("research_sources_required");
  if (inputSources.length > maxDocuments) throw new Error("research_documents_limit_exceeded");
  const normalized = [];
  const seenHashes = new Set();
  const seenUrls = new Set();
  let sizeBytes = 0;
  let redactionCount = 0;
  for (const source of inputSources) {
    const url = cleanText(source?.url, 2_000);
    if (!url) throw new Error("research_source_url_required");
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("research_source_url_invalid");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("research_source_url_rejected");
    const registrySource = sourceForUrl(url);
    if (!registrySource) throw new Error("research_source_not_in_registry");
    if (branchIds.length && !branchIds.some((branchId) => registrySource.branch_bindings.includes(branchId))) {
      throw new Error("research_source_branch_not_allowed");
    }
    const canonicalUrl = parsed.toString().replace(/#.*$/, "");
    if (seenUrls.has(canonicalUrl)) throw new Error("research_source_duplicate_url");
    seenUrls.add(canonicalUrl);
    const title = cleanText(source?.title || registrySource.name, 500);
    const publisher = cleanText(source?.publisher || registrySource.name, 240);
    const excerpt = cleanText(source?.excerpt || source?.summary || "", 1_200);
    const publishedAt = source?.published_at || null;
    const retrievedAt = source?.fetched_at || new Date().toISOString();
    const supportDirection = String(source?.support_direction || "neutral").toLowerCase();
    const licenseClass = cleanText(source?.license_class || registrySource.license_policy, 120);
    const contentHash = stableHash([registrySource.source_id, canonicalUrl, title, publisher, excerpt, publishedAt].join("|"));
    if (seenHashes.has(contentHash)) throw new Error("research_source_duplicate_content");
    seenHashes.add(contentHash);
    sizeBytes += Buffer.byteLength(JSON.stringify({ canonicalUrl, title, publisher, excerpt, publishedAt }), "utf8");
    if (sizeBytes > maxBytes) throw new Error("research_bytes_limit_exceeded");
    const claimSummaries = Array.isArray(source?.claim_summaries) ? source.claim_summaries.slice(0, 10).map((item) => cleanText(item, 240)).filter(Boolean) : [];
    const claimSummary = claimSummaries.length ? claimSummaries.join("; ") : excerpt || title;
    const evidence = {
      evidence_id: `evidence_${crypto.randomUUID()}`,
      source_id: registrySource.source_id,
      source_alias: cleanText(source?.id || source?.source_id || registrySource.source_id, 120),
      canonical_url: canonicalUrl,
      title,
      published_at: publishedAt || null,
      retrieved_at: retrievedAt,
      content_hash: contentHash,
      claim_summary: claimSummary,
      support_direction: ["support", "against", "neutral"].includes(supportDirection) ? supportDirection : "neutral",
      reliability: Number(registrySource.reliability_score.toFixed(2)),
      freshness: freshnessScore(publishedAt || retrievedAt, registrySource.freshness_policy_days),
      relevance: relevanceScore(question, { title, publisher, hostname: parsed.hostname, excerpt }, claimSummaries.map((text, index) => ({ text, id: `claim_${index}` }))),
      uncertainty: 0,
      citation: `${title} — ${parsed.hostname}`,
      license_class: licenseClass,
      redacted: true,
      branch_bindings: [...registrySource.branch_bindings],
      allowed_domains: [...registrySource.allowed_domains],
      source_type: registrySource.source_type,
      source_registry_version: TRUSTED_SOURCE_REGISTRY.schema_version,
    };
    evidence.uncertainty = Number((1 - ((evidence.reliability * 0.45) + (evidence.freshness * 0.35) + (evidence.relevance * 0.20))).toFixed(3));
    redactionCount += Number(source?.redaction_count || 0);
    normalized.push(evidence);
  }
  return { evidence: normalized, redaction_count: redactionCount, bytes: sizeBytes };
}

function candidateLesson(record, workspace) {
  const firstClaim = Array.isArray(record.claims) ? record.claims[0]?.text : "";
  return cleanText(firstClaim || record.question || workspace.question, 500);
}

function createCandidate(record, workspace, result, state, status = "confirmed") {
  const candidateId = `lc_${crypto.randomUUID()}`;
  const sourceRefs = [...new Set((workspace.evidence || record.sources || []).map((source) => source.source_id || source.source_alias || source.id || source.hostname).filter(Boolean))];
  const outcomeRefs = [record.id, result?.memory_promotion?.memory_id || null].filter(Boolean);
  return {
    candidate_id: candidateId,
    tenant_id: workspace.tenant_id,
    branch_id: workspace.branch_ids[0] || "research_evidence",
    lesson: candidateLesson(record, workspace),
    source_refs: sourceRefs,
    outcome_refs: outcomeRefs,
    confidence: Number(Math.max(0, Math.min(1, record.quality_score / 100)).toFixed(2)),
    limitations: Array.isArray(record.validation?.release_readiness?.missing) ? [...record.validation.release_readiness.missing] : [],
    contradictions: Array.isArray(record.validation?.contradictions) ? [...record.validation.contradictions] : [],
    scope: workspace.question,
    valid_from: record.reviewed_at || record.updated_at,
    valid_until: record.expires_at,
    policy_version: state.source_registry_version,
    status,
    audit_reference: record.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expires_at: record.expires_at,
  };
}

function buildWorkspace(input, identity, branchIds, allowedSourceIds, normalizedEvidence = []) {
  const createdAt = new Date().toISOString();
  const maxDurationMs = boundedNumber(input.max_duration_ms, 30_000, 1_000, 300_000);
  return {
    workspace_id: `rw_${crypto.randomUUID()}`,
    request_id: input.request_id || `req_${crypto.randomUUID()}`,
    tenant_id: identity.tenantId,
    question: cleanText(input.question || input.query || "", 2_000),
    request_fingerprint: stableHash(JSON.stringify({
      tenant_id: identity.tenantId,
      question: input.question || input.query || "",
      branch_ids: branchIds,
      allowed_source_ids: allowedSourceIds,
    })),
    branch_ids: branchIds,
    source_registry_version: TRUSTED_SOURCE_REGISTRY.schema_version,
    branch_learning_packs: listBranchLearningPacks(branchIds),
    allowed_source_ids: allowedSourceIds,
    max_documents: boundedNumber(input.max_documents, 10, 1, 20),
    max_bytes: boundedNumber(input.max_bytes, 2_000_000, 1_000, 5_000_000),
    max_duration_ms: maxDurationMs,
    max_cost: boundedNumber(input.max_cost, 0, 0, 1_000),
    retention_mode: String(input.retention_mode || "ephemeral").toLowerCase(),
    external_side_effects: false,
    source_policy: input.source_policy || null,
    status: "active",
    created_at: createdAt,
    updated_at: createdAt,
    expires_at: new Date(Date.now() + maxDurationMs).toISOString(),
    evidence: normalizedEvidence,
    evidence_count: normalizedEvidence.length,
    bytes: normalizedEvidence.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item), "utf8"), 0),
    dtt_binding: {
      branch_ids: branchIds,
      evidence_refs: normalizedEvidence.map((item) => item.evidence_id),
      core_authority: "universal_core",
    },
    cleanup: {
      requested: false,
      completed: false,
      completed_at: null,
      reason: null,
    },
  };
}

function publicWorkspace(workspace) {
  return {
    workspace_id: workspace.workspace_id,
    request_id: workspace.request_id,
    tenant_id: workspace.tenant_id,
    question: workspace.question,
    request_fingerprint: workspace.request_fingerprint,
    branch_ids: [...workspace.branch_ids],
    source_registry_version: workspace.source_registry_version,
    branch_learning_packs: workspace.branch_learning_packs.map((pack) => ({
      manifest: pack.manifest,
      source_count: pack.source_ids.length,
      verified_knowledge_count: pack.verified_knowledge.length,
      source_ids: [...pack.source_ids],
    })),
    allowed_source_ids: [...workspace.allowed_source_ids],
    max_documents: workspace.max_documents,
    max_bytes: workspace.max_bytes,
    max_duration_ms: workspace.max_duration_ms,
    max_cost: workspace.max_cost,
    retention_mode: workspace.retention_mode,
    external_side_effects: workspace.external_side_effects,
    source_policy: workspace.source_policy,
    status: workspace.status,
    created_at: workspace.created_at,
    updated_at: workspace.updated_at,
    expires_at: workspace.expires_at,
    evidence_count: workspace.evidence_count,
    bytes: workspace.bytes,
    dtt_binding: workspace.dtt_binding,
    cleanup: workspace.cleanup,
  };
}

function sourceRegistrySummary() {
  return {
    schema_version: TRUSTED_SOURCE_REGISTRY.schema_version,
    status: TRUSTED_SOURCE_REGISTRY.status,
    owner: TRUSTED_SOURCE_REGISTRY.owner,
    source_count: TRUSTED_SOURCE_REGISTRY.sources.length,
    branch_count: listBranchLearningPacks().length,
  };
}

export function createGovernedResearchLayer(config, options = {}) {
  const root = workspaceRoot(config);
  const research = createResearchCortex(config, options);
  const mode = parseMode(config);
  const cacheTtlSeconds = boundedNumber(config.researchCacheTtlSeconds, 900, 60, 86_400);
  const maxDocuments = boundedNumber(config.researchMaxDocuments, 10, 1, 20);
  const maxBytes = boundedNumber(config.researchMaxBytes, 2_000_000, 100_000, 10_000_000);
  const maxDurationMs = boundedNumber(config.researchTimeoutMs, 30_000, 1_000, 300_000);
  const tenantAllowlist = new Set((Array.isArray(config.researchTenantAllowlist) ? config.researchTenantAllowlist : []).map((item) => String(item).trim()).filter(Boolean));
  const distillationRequiresReview = config.distillationRequiresReview !== false;
  const label = mode === "active" ? "active" : mode === "advisory" ? "advisory" : "shadow";

  function isEnabled(identity) {
    return activeEnabled(config) && (!tenantAllowlist.size || tenantAllowlist.has(identity.tenantId));
  }

  function readState(tenantId) {
    return normalizeState(fs.existsSync(statePath(root, tenantId)) ? JSON.parse(fs.readFileSync(statePath(root, tenantId), "utf8")) : emptyState());
  }

  async function mutateState(tenantId, mutate) {
    return updateState(root, tenantId, mutate);
  }

  function workspaceForPlan(workspace, planId) {
    return workspace.request_id === planId || workspace.workspace_id === planId || workspace.workspaces?.includes?.(planId);
  }

  async function plan(input = {}, identity) {
    const question = cleanText(input.question || input.query, 2_000);
    if (!question) throw new Error("research_question_required");
    const branchIds = branchesForQuestion(question, input.domain_pack || input.domain_pack_id || "generic");
    const allowedDomains = inferAllowedDomains(branchIds);
    const requestedDomains = Array.isArray(input.allowed_domains) ? input.allowed_domains.slice(0, 20).map((item) => String(item).trim()).filter(Boolean) : [];
    const mergedDomains = requestedDomains.length ? allowedDomains.filter((domain) => requestedDomains.some((requested) => domain === requested || domain.endsWith(`.${requested}`) || requested.endsWith(`.${domain}`))) : allowedDomains;
    const allowedSourceIds = [...new Set(allowedSourcesForBranches(branchIds).map((source) => source.source_id))];
    const active = isEnabled(identity);
    const basePlan = await research.plan({ question, decision_context: input.decision_context, allowed_domains: mergedDomains, domain_pack: input.domain_pack }, identity);
    if (!active) {
      return {
        ...basePlan,
        research_governance: {
          enabled: false,
          mode: label,
          source_registry: sourceRegistrySummary(),
          branch_ids: branchIds,
          allowed_source_ids: allowedSourceIds,
          learning_packs: listBranchLearningPacks(branchIds),
          workspace: null,
          distillation: { requires_review: distillationRequiresReview, candidate_status: "disabled" },
        },
      };
    }
    const workspace = buildWorkspace({
      request_id: basePlan?.research_plan?.plan_id || input.request_id,
      question,
      max_documents: input.max_documents || maxDocuments,
      max_bytes: input.max_bytes || maxBytes,
      max_duration_ms: input.max_duration_ms || maxDurationMs,
      max_cost: input.max_cost || 0,
      retention_mode: input.retention_mode || "ephemeral",
      source_policy: basePlan?.research_plan?.source_policy || null,
    }, identity, branchIds, allowedSourceIds, []);
    await mutateState(identity.tenantId, async (state) => {
      state.source_registry_version = TRUSTED_SOURCE_REGISTRY.schema_version;
      state.workspaces = state.workspaces.filter((candidate) => candidate.request_id !== workspace.request_id && candidate.workspace_id !== workspace.workspace_id);
      state.workspaces.push(workspace);
      state.audit.push({
        id: `ra_${crypto.randomUUID()}`,
        created_at: workspace.created_at,
        actor: identity.subject || identity.kind || "system",
        action_type: "research.workspace_opened",
        target: workspace.workspace_id,
        branch_ids: branchIds,
      });
    });
    return {
      ...basePlan,
      research_governance: {
        enabled: true,
        mode: label,
        source_registry: sourceRegistrySummary(),
        branch_ids: branchIds,
        allowed_source_ids: allowedSourceIds,
        learning_packs: listBranchLearningPacks(branchIds),
        workspace: publicWorkspace(workspace),
        distillation: {
          requires_review: distillationRequiresReview,
          candidate_status: "candidate",
        },
      },
    };
  }

  async function ingest(input = {}, identity) {
    if (!isEnabled(identity)) return research.ingest(input, identity);
    const workspaceState = readState(identity.tenantId);
    const workspace = workspaceState.workspaces.find((candidate) => candidate.request_id === input.plan_id || candidate.workspace_id === input.plan_id || candidate.request_id === input.request_id);
    if (!workspace) throw new Error("research_workspace_not_found");
    const normalizedEvidencePack = normalizeEvidenceSources(input.sources || [], input.question || input.query || workspace.question, workspace.branch_ids, workspace.max_documents, workspace.max_bytes);
    const normalizedEvidence = normalizedEvidencePack.evidence;
    const allowedSourceSet = new Set(workspace.allowed_source_ids);
    for (const evidence of normalizedEvidence) {
      if (allowedSourceSet.size && !allowedSourceSet.has(evidence.source_id)) throw new Error("research_source_registry_mismatch");
    }
    const record = await research.ingest({
      ...input,
      plan: { ...(input.plan || {}), source_policy: workspace.source_policy || input.plan?.source_policy },
    }, identity);
    const updated = await mutateState(identity.tenantId, async (state) => {
      const currentWorkspace = state.workspaces.find((candidate) => candidate.workspace_id === workspace.workspace_id);
      if (!currentWorkspace) throw new Error("research_workspace_not_found");
      currentWorkspace.updated_at = new Date().toISOString();
      currentWorkspace.evidence = normalizedEvidence;
      currentWorkspace.evidence_count = normalizedEvidence.length;
      currentWorkspace.bytes = normalizedEvidence.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item), "utf8"), 0);
      currentWorkspace.dtt_binding = {
        branch_ids: currentWorkspace.branch_ids,
        evidence_refs: normalizedEvidence.map((item) => item.evidence_id),
        core_authority: "universal_core",
      };
      currentWorkspace.status = record.record?.state === "quarantined" ? "blocked" : "evidence_collected";
      currentWorkspace.cleanup.requested = true;
      currentWorkspace.cleanup.reason = record.record?.state === "quarantined" ? "quarantined" : null;
      if (currentWorkspace.bytes > currentWorkspace.max_bytes) throw new Error("research_workspace_bytes_limit_exceeded");
      state.cache.push(...normalizedEvidence.map((evidence) => ({
        ...evidence,
        tenant_id: identity.tenantId,
        branch_ids: currentWorkspace.branch_ids,
        workspace_id: currentWorkspace.workspace_id,
        last_accessed_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + cacheTtlSeconds * 1000).toISOString(),
      })));
      return {
        workspace: publicWorkspace(currentWorkspace),
        evidence: normalizedEvidence,
      };
    });
    return {
      ...record,
      research_governance: {
        enabled: true,
        mode: label,
        source_registry: sourceRegistrySummary(),
        workspace: updated.result.workspace,
        evidence: updated.result.evidence,
      },
    };
  }

  function query(input, identity) {
    const result = research.query(input, identity);
    if (!isEnabled(identity)) return result;
    return {
      ...result,
      research_governance: {
        enabled: true,
        mode: label,
        source_registry: sourceRegistrySummary(),
      },
    };
  }

  async function feedback(input, identity) {
    const result = await research.feedback(input, identity);
    if (!isEnabled(identity)) return result;
    const record = result.record;
    const workspaceState = readState(identity.tenantId);
    const workspace = workspaceState.workspaces.find((candidate) => candidate.request_id === record.plan_id || candidate.workspace_id === record.plan_id);
    if (!workspace) {
      return {
        ...result,
        research_governance: {
          enabled: true,
          mode: label,
          source_registry: sourceRegistrySummary(),
          candidate: null,
        },
      };
    }
    const candidate = createCandidate(record, workspace, result, workspaceState, record.state === "validated" ? "confirmed" : record.state === "deprecated" ? "deprecated" : record.state === "quarantined" ? "challenged" : "under_review");
    const updated = await mutateState(identity.tenantId, async (state) => {
      const existingIndex = state.learning_candidates.findIndex((item) => item.audit_reference === record.id);
      if (existingIndex >= 0) state.learning_candidates[existingIndex] = candidate;
      else state.learning_candidates.push(candidate);
      const currentWorkspace = state.workspaces.find((item) => item.workspace_id === workspace.workspace_id);
      if (currentWorkspace) {
        currentWorkspace.updated_at = new Date().toISOString();
        currentWorkspace.status = record.state === "validated" ? "completed" : record.state === "deprecated" ? "failed" : currentWorkspace.status;
        currentWorkspace.cleanup.completed = record.state === "validated" || record.state === "deprecated";
        currentWorkspace.cleanup.completed_at = currentWorkspace.cleanup.completed ? new Date().toISOString() : null;
      }
      return { candidate, candidate_count: state.learning_candidates.length };
    });
    return {
      ...result,
      research_governance: {
        enabled: true,
        mode: label,
        source_registry: sourceRegistrySummary(),
        candidate: updated.result.candidate,
      },
    };
  }

  function searchDocuments(queryValue, identity, limit = 20) {
    return research.searchDocuments(queryValue, identity, limit);
  }

  function fetchDocument(documentId, identity) {
    return research.fetchDocument(documentId, identity);
  }

  async function executeOpenAi(input, identity) {
    return research.executeOpenAi(input, identity);
  }

  function status(input, identity) {
    const base = research.status(input, identity);
    if (!isEnabled(identity)) {
      return {
        ...base,
        research_governance: {
          enabled: false,
          mode: label,
          source_registry: sourceRegistrySummary(),
          learning_packs: listBranchLearningPacks(),
          workspace_count: 0,
          learning_candidate_count: 0,
          cache_count: 0,
        },
      };
    }
    const state = readState(identity.tenantId);
    return {
      ...base,
      research_governance: {
        enabled: true,
        mode: label,
        source_registry: sourceRegistrySummary(),
        learning_packs: listBranchLearningPacks(),
        workspace_count: state.workspaces.length,
        workspaces: state.workspaces.slice(-10).map(publicWorkspace),
        learning_candidate_count: state.learning_candidates.length,
        learning_candidates: state.learning_candidates.slice(-10),
        cache_count: state.cache.length,
        cache_ttl_seconds: cacheTtlSeconds,
        max_documents: maxDocuments,
        max_bytes: maxBytes,
        max_duration_ms: maxDurationMs,
      },
    };
  }

  return {
    plan,
    ingest,
    query,
    status,
    feedback,
    searchDocuments,
    fetchDocument,
    executeOpenAi,
    openAiAvailable: research.openAiAvailable,
    sourceRegistry: TRUSTED_SOURCE_REGISTRY,
    learningPacks: listBranchLearningPacks(),
    version: GOVERNED_RESEARCH_SCHEMA_VERSION,
  };
}
