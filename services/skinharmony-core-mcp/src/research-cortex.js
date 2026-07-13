import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { redactText } from "./memory-fabric.js";

const ID_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/i;
const RECORD_ID_PATTERN = /^research_[a-f0-9-]{36}$/;
const DOCUMENT_ID_PATTERN = /^[a-f0-9]{24}$/;
const SOURCE_TYPES = new Set(["official", "regulator", "academic", "standards", "manufacturer", "news", "industry", "community", "other"]);
const CLAIM_KINDS = new Set(["fact", "inference", "hypothesis"]);
const RECORD_STATES = new Set(["candidate", "quarantined", "validated", "deprecated"]);
const FEEDBACK_VERDICTS = new Set(["confirm", "challenge", "deprecate"]);
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/,
  /\bSHX-[A-Z]+-[A-Za-z0-9_-]{12,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+/i,
  /\b[A-Fa-f0-9]{40,}\b/,
];
const PROMPT_INJECTION_PATTERNS = [
  /ignore (?:all |any )?(?:previous|prior|earlier) (?:instructions|messages|rules)/i,
  /(?:system|developer) (?:prompt|message|instructions)/i,
  /reveal (?:the )?(?:secret|token|password|api key|hidden prompt)/i,
  /(?:execute|run) (?:this |the )?(?:command|shell|code)/i,
  /override (?:the )?(?:policy|guardrail|instructions)/i,
  /ignora (?:tutte le )?(?:istruzioni|regole) (?:precedenti|iniziali)/i,
  /rivela (?:il |la |i )?(?:segreto|token|password|chiave api|prompt nascosto)/i,
  /(?:esegui|lancia) (?:questo |il )?(?:comando|shell|codice)/i,
];
const PHONE_PATTERN = /(?:\+?\d[\d .()/-]{7,}\d)/g;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
}

function safeId(value, name, { optional = false } = {}) {
  const id = String(value || "").trim();
  if (!id && optional) return "";
  if (!ID_PATTERN.test(id)) fail(`${name}_invalid`);
  return id;
}

function actorFingerprint(identity) {
  return crypto.createHash("sha256").update(String(identity?.subject || identity?.kind || "system")).digest("hex").slice(0, 24);
}

function hasPattern(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function sanitizeText(value, name, max = 2_000, { required = true } = {}) {
  const raw = String(value || "").trim();
  if (!raw && required) fail(`${name}_required`);
  if (!raw) return { text: "", redaction_count: 0, prompt_injection: false };
  if (raw.length > max) fail(`${name}_too_long`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw)) fail(`${name}_invalid`);
  if (hasPattern(raw, SECRET_PATTERNS)) fail("research_sensitive_content_rejected");
  const promptInjection = hasPattern(raw, PROMPT_INJECTION_PATTERNS);
  const withoutActiveHtml = raw
    .replace(/<\s*(?:script|iframe|object|embed|style)[^>]*>[\s\S]*?<\s*\/\s*(?:script|iframe|object|embed|style)\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const redacted = redactText(withoutActiveHtml, max);
  let phoneRedactions = 0;
  const text = redacted.text.replace(PHONE_PATTERN, () => {
    phoneRedactions += 1;
    return "[REDACTED_PHONE]";
  });
  return { text, redaction_count: redacted.redaction_count + phoneRedactions, prompt_injection: promptInjection };
}

function normalizeDate(value, name, { optional = true } = {}) {
  if (!value && optional) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 86_400_000) fail(`${name}_invalid`);
  return date.toISOString();
}

function privateHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || [".localhost", ".local", ".internal", ".home", ".lan"].some((suffix) => host.endsWith(suffix))) return true;
  if (net.isIP(host) === 6) {
    return host === "::" || host === "::1" || host.startsWith("::ffff:")
      || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || /^ff/.test(host) || /^2001:db8(?::|$)/.test(host);
  }
  if (host === "0.0.0.0") return true;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function publicHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (privateHostname(host) || net.isIP(host) !== 0 || host.length > 253 || !host.includes(".")) return false;
  if ([".test", ".example", ".invalid", ".onion"].some((suffix) => host.endsWith(suffix))) return false;
  return host.split(".").every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

function normalizeUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    fail("research_source_url_invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) {
    fail("research_source_url_rejected");
  }
  if (!publicHostname(parsed.hostname)) fail("research_source_host_rejected");
  parsed.hash = "";
  return parsed.toString();
}

function normalizeDomain(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  let hostname;
  try {
    hostname = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    fail("research_domain_invalid");
  }
  if (!publicHostname(hostname)) fail("research_domain_rejected");
  return hostname;
}

function unique(values) {
  return [...new Set(values)];
}

function tenantDirectory(root, tenantId) {
  const tenant = safeId(tenantId, "tenant");
  const base = path.resolve(root, "tenants");
  const resolved = path.resolve(base, tenant, "research-cortex");
  if (!resolved.startsWith(`${base}${path.sep}`)) fail("tenant_path_rejected");
  return resolved;
}

function emptyState() {
  return {
    schema_version: "tenant_research_cortex_v1",
    revision: 0,
    plans: [],
    records: [],
    feedback: [],
    audit: [],
  };
}

function normalizeState(value) {
  const state = value && typeof value === "object" && !Array.isArray(value) ? value : emptyState();
  for (const key of ["plans", "records", "feedback", "audit"]) if (!Array.isArray(state[key])) state[key] = [];
  state.schema_version = "tenant_research_cortex_v1";
  state.revision = Number.isInteger(state.revision) && state.revision >= 0 ? state.revision : 0;
  return state;
}

function stateFile(root, tenantId) {
  return path.join(tenantDirectory(root, tenantId), "state.json");
}

function readState(root, tenantId) {
  const file = stateFile(root, tenantId);
  if (!fs.existsSync(file)) return emptyState();
  try {
    return normalizeState(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    fail("research_state_invalid");
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(directory, ".research.lock");
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
  fail("research_cortex_busy");
}

function releaseLock(lock) {
  try { fs.closeSync(lock.handle); } catch {}
  try { fs.unlinkSync(lock.lockPath); } catch {}
}

function pruneState(state, now = Date.now()) {
  state.plans = state.plans.filter((plan) => !plan.expires_at || new Date(plan.expires_at).getTime() > now).slice(-500);
  state.records = state.records.filter((record) => !record.expires_at || new Date(record.expires_at).getTime() > now).slice(-2_000);
  const recordIds = new Set(state.records.map((record) => record.id));
  state.feedback = state.feedback.filter((entry) => recordIds.has(entry.record_id)).slice(-5_000);
  state.audit = state.audit.slice(-5_000);
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
    fs.renameSync(temporary, stateFile(root, tenantId));
    return { result, revision: state.revision };
  } finally {
    releaseLock(lock);
  }
}

function normalizePlanInput(input = {}) {
  const question = sanitizeText(input.question || input.query, "research_question", 2_000);
  const decision = sanitizeText(input.decision_context, "decision_context", 1_000, { required: false });
  const domains = unique((Array.isArray(input.allowed_domains) ? input.allowed_domains : []).slice(0, 20).map(normalizeDomain).filter(Boolean));
  return {
    question: question.text,
    decision_context: decision.text || undefined,
    allowed_domains: domains,
    domain_pack: safeId(input.domain_pack, "domain_pack", { optional: true }) || undefined,
    redaction_count: question.redaction_count + decision.redaction_count,
  };
}

function normalizeSourcePolicy(value = {}) {
  return {
    minimum_independent_sources: boundedNumber(value.minimum_independent_sources, 2, 1, 10),
    freshness_days: boundedNumber(value.freshness_days, 365, 1, 3_650),
    allowed_domains: unique((Array.isArray(value.allowed_domains) ? value.allowed_domains : [])
      .slice(0, 20)
      .map(normalizeDomain)
      .filter(Boolean))
      .sort(),
  };
}

function sourcePolicyFingerprint(value) {
  return JSON.stringify(normalizeSourcePolicy(value));
}

function normalizeEvidenceInput(input = {}) {
  const planId = safeId(input.plan_id, "research_plan", { optional: true }) || null;
  if (!planId) fail("research_plan_id_required");
  if (!input.plan?.source_policy || typeof input.plan.source_policy !== "object") fail("research_plan_policy_required");
  const question = sanitizeText(input.question || input.query, "research_question", 2_000);
  const decision = sanitizeText(input.decision_context, "decision_context", 1_000, { required: false });
  if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 20) fail("research_sources_invalid");
  if (!Array.isArray(input.claims) || input.claims.length < 1 || input.claims.length > 30) fail("research_claims_invalid");
  const sourceIds = new Set();
  const planPolicy = normalizeSourcePolicy(input.plan.source_policy);
  const allowedDomains = planPolicy.allowed_domains;
  let redactionCount = question.redaction_count + decision.redaction_count;
  let localInjectionCount = question.prompt_injection || decision.prompt_injection ? 1 : 0;
  const sources = input.sources.map((source) => {
    const id = safeId(source?.id, "research_source_id");
    if (sourceIds.has(id)) fail("research_source_id_duplicate");
    sourceIds.add(id);
    const type = String(source?.source_type || "other").trim().toLowerCase();
    if (!SOURCE_TYPES.has(type)) fail("research_source_type_invalid");
    const title = sanitizeText(source?.title, "research_source_title", 500);
    const publisher = sanitizeText(source?.publisher, "research_source_publisher", 240, { required: false });
    const excerpt = sanitizeText(source?.excerpt, "research_source_excerpt", 1_200, { required: false });
    const summary = sanitizeText(source?.summary, "research_source_summary", 1_200, { required: false });
    const promptInjection = title.prompt_injection || publisher.prompt_injection || excerpt.prompt_injection || summary.prompt_injection;
    if (promptInjection) localInjectionCount += 1;
    redactionCount += title.redaction_count + publisher.redaction_count + excerpt.redaction_count + summary.redaction_count;
    const url = normalizeUrl(source?.url);
    const hostname = new URL(url).hostname.toLowerCase();
    if (allowedDomains.length && !allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      fail("research_source_domain_not_allowed");
    }
    return {
      id,
      url,
      hostname,
      title: title.text,
      publisher: publisher.text || null,
      source_type: type,
      published_at: normalizeDate(source?.published_at, "research_source_published_at"),
      fetched_at: normalizeDate(source?.fetched_at || new Date().toISOString(), "research_source_fetched_at", { optional: false }),
      excerpt: excerpt.text || null,
      summary: summary.text || null,
      prompt_injection_detected: promptInjection,
      document_id: null,
    };
  });
  const claimIds = new Set();
  const claims = input.claims.map((claim) => {
    const id = safeId(claim?.id, "research_claim_id");
    if (claimIds.has(id)) fail("research_claim_id_duplicate");
    claimIds.add(id);
    const kind = String(claim?.kind || "fact").trim().toLowerCase();
    if (!CLAIM_KINDS.has(kind)) fail("research_claim_kind_invalid");
    const text = sanitizeText(claim?.text, "research_claim_text", 2_000);
    if (text.prompt_injection) localInjectionCount += 1;
    redactionCount += text.redaction_count;
    const sourceIdsForClaim = unique((Array.isArray(claim?.source_ids) ? claim.source_ids : []).map((idValue) => safeId(idValue, "research_claim_source_id")));
    if (sourceIdsForClaim.some((sourceId) => !sourceIds.has(sourceId))) fail("research_claim_source_unknown");
    const contradictions = unique((Array.isArray(claim?.contradicts_claim_ids) ? claim.contradicts_claim_ids : []).map((idValue) => safeId(idValue, "research_contradiction_id")));
    return {
      id,
      kind,
      text: text.text,
      source_ids: sourceIdsForClaim,
      contradicts_claim_ids: contradictions,
      confidence: Math.max(0, Math.min(1, Number.isFinite(Number(claim?.confidence)) ? Number(claim.confidence) : kind === "fact" ? 0.7 : 0.5)),
    };
  });
  for (const claim of claims) {
    if (claim.contradicts_claim_ids.some((id) => !claimIds.has(id) || id === claim.id)) fail("research_contradiction_invalid");
  }
  const idempotency = sanitizeText(input.idempotency_key, "research_idempotency_key", 120);
  return {
    plan_id: planId,
    question: question.text,
    decision_context: decision.text || null,
    sources,
    claims,
    plan: { source_policy: planPolicy },
    project_id: safeId(input.project_id, "project", { optional: true }) || null,
    session_id: safeId(input.session_id, "session", { optional: true }) || null,
    idempotency_key: idempotency.text || null,
    redaction_count: redactionCount + idempotency.redaction_count,
    local_prompt_injection_count: localInjectionCount,
  };
}

function evidenceFingerprint(evidence) {
  return crypto.createHash("sha256").update(JSON.stringify({
    plan_id: evidence.plan_id,
    question: evidence.question,
    decision_context: evidence.decision_context,
    plan: evidence.plan,
    sources: evidence.sources.map(({ fetched_at: _fetchedAt, ...source }) => source),
    claims: evidence.claims,
    project_id: evidence.project_id,
    session_id: evidence.session_id,
  })).digest("hex");
}

function corePayload(result) {
  return result?.structuredContent && typeof result.structuredContent === "object" ? result.structuredContent : result;
}

function publicRecord(record, { quarantineMetadataOnly = true } = {}) {
  const { actor_fingerprint: _actor, idempotency_key: _key, evidence_fingerprint: _fingerprint, ...safe } = record;
  if (record.state !== "quarantined" || !quarantineMetadataOnly) return safe;
  return {
    id: record.id,
    plan_id: record.plan_id,
    state: record.state,
    quality_score: record.quality_score,
    created_at: record.created_at,
    updated_at: record.updated_at,
    expires_at: record.expires_at,
    redacted: true,
    redaction_count: record.redaction_count,
    source_count: record.sources.length,
    claim_count: record.claims.length,
    quarantine_reason: record.validation?.release_readiness?.missing || ["security_review_required"],
  };
}

function searchableText(record) {
  return [record.question, record.decision_context, ...record.sources.flatMap((source) => [source.title, source.publisher, source.hostname]), ...record.claims.map((claim) => claim.text)].join(" ").toLowerCase();
}

function tokens(value) {
  return unique(String(value || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9_\s-]+/g, " ").split(/\s+/).filter((token) => token.length > 1).slice(0, 30));
}

function textResult(payload) {
  return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function validationSummary(validation) {
  return {
    schema_version: validation.schema_version,
    validation_id: validation.validation_id,
    state: validation.state,
    quality_score: validation.quality_score,
    confidence_band: validation.confidence_band,
    effective_policy: validation.effective_policy && typeof validation.effective_policy === "object" ? validation.effective_policy : null,
    source_count: validation.source_count,
    independent_host_count: validation.independent_host_count,
    authoritative_source_count: validation.authoritative_source_count,
    source_assessments: Array.isArray(validation.source_assessments) ? validation.source_assessments : [],
    claim_assessments: Array.isArray(validation.claim_assessments) ? validation.claim_assessments : [],
    contradictions: Array.isArray(validation.contradictions) ? validation.contradictions : [],
    threat_assessment: validation.threat_assessment || {},
    release_readiness: validation.release_readiness || { eligible_for_tenant_review: false, missing: ["core_validation_missing"] },
  };
}

function providerSource(raw, index) {
  try {
    const url = normalizeUrl(raw?.url);
    const title = sanitizeText(raw?.title || new URL(url).hostname, "research_provider_source_title", 500);
    return {
      id: `source_${index + 1}`,
      url,
      title: title.text,
      publisher: new URL(url).hostname,
      source_type: "other",
      published_at: null,
      fetched_at: new Date().toISOString(),
      excerpt: null,
    };
  } catch {
    return null;
  }
}

function extractOpenAiResponse(payload, query) {
  const sourceRows = [];
  const textParts = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (item?.type === "web_search_call" && Array.isArray(item.action?.sources)) sourceRows.push(...item.action.sources);
    if (item?.type !== "message") continue;
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (content?.type === "output_text" && content.text) textParts.push(String(content.text));
      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
        if (annotation?.type === "url_citation" && annotation.url) sourceRows.push({ url: annotation.url, title: annotation.title });
      }
    }
  }
  const synthesis = sanitizeText(textParts.join("\n") || payload?.output_text, "research_provider_synthesis", 8_000);
  const deduplicated = [];
  const seen = new Set();
  for (const row of sourceRows) {
    const normalized = providerSource(row, deduplicated.length);
    if (!normalized || seen.has(normalized.url)) continue;
    seen.add(normalized.url);
    deduplicated.push(normalized);
    if (deduplicated.length >= 20) break;
  }
  if (!deduplicated.length) fail("openai_research_sources_missing");
  return {
    provider: "openai_responses_web_search",
    query,
    synthesis: synthesis.text,
    sources: deduplicated,
    evidence_pack_template: {
      question: query,
      sources: deduplicated,
      claims: [{
        id: "claim_synthesis",
        kind: "inference",
        text: synthesis.text.slice(0, 2_000),
        source_ids: deduplicated.map((source) => source.id),
        confidence: 0.5,
      }],
    },
  };
}

export function createResearchCortex(config, options = {}) {
  const root = String(config.researchCortexRoot || config.memoryFabricRoot || "").trim();
  if (!root) throw new Error("research_cortex_not_configured");
  const govern = options.govern;
  const planProvider = options.planProvider;
  const validateProvider = options.validateProvider;
  const memoryFabric = options.memoryFabric;
  const fetchImpl = options.fetchImpl || fetch;
  const openAiCalls = new Map();

  function read(tenantId) {
    const state = readState(root, tenantId);
    pruneState(state);
    return state;
  }

  async function governed(identity, action, mutate) {
    const gate = await authorize(identity, action);
    const transaction = await updateState(root, identity.tenantId, async (state) => {
      const result = await mutate(state, gate);
      state.audit.push({
        id: `ra_${crypto.randomUUID()}`,
        created_at: new Date().toISOString(),
        actor_fingerprint: actorFingerprint(identity),
        action_type: action.action_type,
        target: action.target,
        gate: { decision: gate.decision || "unknown", mediation: gate.mediation || "unknown" },
      });
      return result;
    });
    return { ...transaction.result, revision: transaction.revision, gate: { decision: gate.decision, mediation: gate.mediation } };
  }

  async function authorize(identity, action) {
    if (typeof govern !== "function") fail("research_governance_unavailable");
    const gate = await govern(action, identity);
    if (!gate?.allowed) fail("core_gate_denied");
    return gate;
  }

  async function plan(input, identity) {
    if (typeof planProvider !== "function") fail("research_plan_provider_unavailable");
    const normalized = normalizePlanInput(input);
    const response = corePayload(await planProvider(normalized, identity));
    if (!response?.ok || response.tenant_id !== identity.tenantId || !response.research_plan?.source_policy) {
      fail("research_plan_provider_invalid");
    }
    const planId = safeId(response.research_plan.plan_id, "research_plan");
    const issuedQuestion = sanitizeText(response.research_plan.question, "research_question", 2_000).text;
    if (issuedQuestion !== normalized.question) fail("research_plan_provider_invalid");
    const sourcePolicy = normalizeSourcePolicy(response.research_plan.source_policy);
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 3_600_000).toISOString();
    await updateState(root, identity.tenantId, async (state) => {
      state.plans = state.plans.filter((candidate) => candidate.plan_id !== planId);
      state.plans.push({
        plan_id: planId,
        question: issuedQuestion,
        decision_context: normalized.decision_context || null,
        source_policy: sourcePolicy,
        actor_fingerprint: actorFingerprint(identity),
        issued_at: issuedAt,
        expires_at: expiresAt,
      });
      state.audit.push({
        id: `ra_${crypto.randomUUID()}`,
        created_at: issuedAt,
        actor_fingerprint: actorFingerprint(identity),
        action_type: "research.plan_issued",
        target: planId,
        gate: { decision: "read_only_plan", mediation: "allow" },
      });
    });
    return {
      ...response,
      research_bridge: {
        primary_provider: "connected_ai_web",
        next_step: "Use the connected ChatGPT or Codex web tool, then call nyra_research_ingest with short excerpts and claim-source links.",
        secrets_exposed: false,
        tenant_from_verified_identity: true,
        issued_plan_required: true,
        plan_expires_at: expiresAt,
      },
    };
  }

  async function ingest(input, identity) {
    if (typeof validateProvider !== "function") fail("research_validation_provider_unavailable");
    const evidence = normalizeEvidenceInput(input);
    const issuedPlan = read(identity.tenantId).plans.find((candidate) => candidate.plan_id === evidence.plan_id);
    if (!issuedPlan) fail("research_plan_not_issued");
    if (issuedPlan.question !== evidence.question) fail("research_plan_question_mismatch");
    if (sourcePolicyFingerprint(issuedPlan.source_policy) !== sourcePolicyFingerprint(evidence.plan.source_policy)) {
      fail("research_plan_policy_mismatch");
    }
    evidence.plan.source_policy = issuedPlan.source_policy;
    const validationResponse = corePayload(await validateProvider({ evidence_pack: evidence, domain_pack: input.domain_pack }, identity));
    if (!validationResponse?.ok || validationResponse.tenant_id !== identity.tenantId || !validationResponse.validation) {
      fail("research_validation_provider_invalid");
    }
    const validation = validationSummary(validationResponse.validation);
    let state = RECORD_STATES.has(validation.state) ? validation.state : "quarantined";
    if (state === "validated" || state === "deprecated") state = "candidate";
    if (evidence.local_prompt_injection_count > 0) state = "quarantined";
    const recordId = `research_${crypto.randomUUID()}`;
    const timestamp = new Date().toISOString();
    const effectivePolicy = validation.effective_policy || evidence.plan.source_policy;
    const retentionDays = Math.min(config.researchRetentionDays, boundedNumber(effectivePolicy.freshness_days, 365, 1, 3_650));
    const record = {
      id: recordId,
      plan_id: evidence.plan_id,
      question: evidence.question,
      decision_context: evidence.decision_context,
      sources: evidence.sources.map((source) => ({
        ...source,
        document_id: crypto.createHash("sha256").update(`${identity.tenantId}:${recordId}:${source.id}`).digest("hex").slice(0, 24),
      })),
      claims: evidence.claims,
      source_policy: effectivePolicy,
      validation,
      state,
      quality_score: boundedNumber(validation.quality_score, 0, 0, 100),
      project_id: evidence.project_id,
      session_id: evidence.session_id,
      actor_fingerprint: actorFingerprint(identity),
      idempotency_key: evidence.idempotency_key,
      evidence_fingerprint: evidenceFingerprint(evidence),
      created_at: timestamp,
      updated_at: timestamp,
      reviewed_at: null,
      redacted: true,
      redaction_count: evidence.redaction_count,
      expires_at: new Date(Date.now() + retentionDays * 86_400_000).toISOString(),
    };
    return governed(identity, {
      action_type: "research.ingest",
      action_label: `Ingest tenant research evidence ${record.id}`,
      target: record.id,
    }, async (store) => {
      const existing = store.records.find((candidate) => candidate.idempotency_key === record.idempotency_key);
      if (existing) {
        if (existing.evidence_fingerprint && existing.evidence_fingerprint !== record.evidence_fingerprint) fail("research_idempotency_conflict");
        if (!existing.evidence_fingerprint) existing.evidence_fingerprint = record.evidence_fingerprint;
        return { record: publicRecord(existing), created: false, idempotent_replay: true };
      }
      store.records.push(record);
      return { record: publicRecord(record), created: true, idempotent_replay: false };
    });
  }

  function query(input, identity) {
    const queryValue = sanitizeText(input.query, "research_query", 500, { required: false }).text;
    const stateFilter = input.state ? String(input.state).trim().toLowerCase() : "";
    if (stateFilter && !RECORD_STATES.has(stateFilter)) fail("research_state_invalid");
    if (stateFilter === "quarantined" && !identity.scopes?.includes("core:govern")) fail("research_quarantine_scope_required");
    const queryTokens = tokens(queryValue);
    const limit = boundedNumber(input.limit, 10, 1, 50);
    const records = read(identity.tenantId).records
      .filter((record) => stateFilter ? record.state === stateFilter : ["candidate", "validated"].includes(record.state))
      .map((record) => {
        const haystack = searchableText(record);
        const lexical = queryTokens.reduce((score, token) => score + (haystack.includes(token) ? 12 : 0), 0);
        const recency = Math.max(0, 20 - Math.log2(Math.max(0, Date.now() - new Date(record.updated_at).getTime()) / 3_600_000 + 1) * 3);
        return { record, lexical, score: lexical + recency + record.quality_score * 0.4 };
      })
      .filter(({ lexical }) => !queryTokens.length || lexical > 0)
      .sort((left, right) => right.score - left.score || right.record.updated_at.localeCompare(left.record.updated_at))
      .slice(0, limit)
      .map(({ record, score }) => ({ ...publicRecord(record), relevance_score: Number(score.toFixed(2)) }));
    return {
      schema_version: "tenant_research_query_v1",
      tenant_id: identity.tenantId,
      results: records,
      policy: { quarantined_excluded_by_default: true, cross_tenant_access: false },
    };
  }

  function status(_input, identity) {
    const state = read(identity.tenantId);
    const counts = Object.fromEntries([...RECORD_STATES].map((recordState) => [recordState, state.records.filter((record) => record.state === recordState).length]));
    return {
      schema_version: "tenant_research_status_v1",
      tenant_id: identity.tenantId,
      revision: state.revision,
      record_count: state.records.length,
      counts,
      providers: {
        connected_ai_web: { available: true, credential_mode: "host_managed", server_secret_required: false },
        curated_collectors: { available: true, mode: "evidence_pack_ingest" },
        openai_optional_fallback: {
          enabled: config.openaiResearchEnabled === true,
          configured: Boolean(config.openaiApiKey),
          callable: config.openaiResearchEnabled === true && Boolean(config.openaiApiKey),
          model: config.openaiResearchModel,
          max_calls_per_hour_per_tenant: config.openaiResearchMaxCallsPerHour,
        },
      },
      learning_policy: {
        candidate_memory_promoted_automatically: false,
        validated_memory_requires_core_governed_feedback: true,
        global_promotion_allowed: false,
        tenant_isolated: true,
      },
    };
  }

  async function promoteToMemory(record, identity) {
    if (!memoryFabric || typeof memoryFabric.append !== "function") return { status: "not_configured" };
    try {
      const result = await memoryFabric.append({
        kind: "learning",
        title: `Validated research: ${record.question}`.slice(0, 240),
        summary: `Tenant-reviewed evidence validated with quality score ${record.quality_score}.`,
        facts: record.claims.filter((claim) => claim.kind === "fact").map((claim) => claim.text).slice(0, 20),
        outcomes: ["Research evidence promoted after authorized tenant review."],
        next_steps: ["Revalidate when temporal evidence expires or contradictory evidence appears."],
        tags: ["research_evidence", "validated", "tenant_scoped"],
        importance: Math.max(60, record.quality_score),
        data_classification: "internal",
        project_id: record.project_id || undefined,
        session_id: record.session_id || undefined,
        agent_id: "nyra",
        source: "research_cortex",
        retention_days: Math.min(config.researchRetentionDays, record.source_policy?.freshness_days || config.researchRetentionDays),
        idempotency_key: `research:${record.id}:validated`,
      }, identity);
      return { status: "completed", memory_id: result.memory?.id || null };
    } catch (error) {
      return { status: "failed", error: error.code || "memory_promotion_failed" };
    }
  }

  async function feedback(input, identity) {
    const recordId = String(input.record_id || "").trim();
    if (!RECORD_ID_PATTERN.test(recordId)) fail("research_record_id_invalid");
    const verdict = String(input.verdict || "").trim().toLowerCase();
    if (!FEEDBACK_VERDICTS.has(verdict)) fail("research_feedback_verdict_invalid");
    const rationale = sanitizeText(input.rationale, "research_feedback_rationale", 2_000);
    const result = await governed(identity, {
      action_type: "research.feedback",
      action_label: `${verdict} tenant research evidence ${recordId}`,
      target: recordId,
    }, async (state, gate) => {
      const record = state.records.find((candidate) => candidate.id === recordId);
      if (!record) fail("research_record_not_found");
      let idempotentReplay = false;
      if (verdict === "confirm") {
        if (record.state === "validated") {
          idempotentReplay = true;
        } else {
          if (record.state !== "candidate") fail("research_record_not_confirmable");
          if (record.quality_score < 65 || record.validation?.release_readiness?.eligible_for_tenant_review !== true) {
            fail("research_validation_requirements_unmet");
          }
          record.state = "validated";
        }
      } else if (verdict === "challenge") {
        record.state = "quarantined";
      } else {
        record.state = "deprecated";
      }
      record.updated_at = new Date().toISOString();
      record.reviewed_at = record.updated_at;
      const feedbackRecord = idempotentReplay ? null : {
        id: `rf_${crypto.randomUUID()}`,
        record_id: record.id,
        verdict,
        rationale: rationale.text,
        actor_fingerprint: actorFingerprint(identity),
        created_at: record.updated_at,
        gate: { decision: gate.decision || "unknown", mediation: gate.mediation || "unknown" },
      };
      if (feedbackRecord) state.feedback.push(feedbackRecord);
      return {
        record: publicRecord(record),
        feedback: feedbackRecord ? { ...feedbackRecord, actor_fingerprint: undefined } : null,
        idempotent_replay: idempotentReplay,
      };
    });
    const memoryPromotion = result.record.state === "validated"
      ? await promoteToMemory(result.record, identity)
      : { status: "not_requested" };
    return { ...result, memory_promotion: memoryPromotion };
  }

  function searchDocuments(queryValue, identity, limit = 20) {
    const queryTokens = tokens(queryValue);
    const documents = read(identity.tenantId).records
      .filter((record) => record.state === "validated")
      .flatMap((record) => record.sources.map((source) => {
        const claims = record.claims.filter((claim) => claim.source_ids.includes(source.id));
        const haystack = `${record.question} ${source.title} ${source.publisher || ""} ${source.hostname} ${source.excerpt || ""} ${claims.map((claim) => claim.text).join(" ")}`.toLowerCase();
        const lexical = queryTokens.reduce((score, token) => score + (haystack.includes(token) ? 10 : 0), 0);
        return { id: source.document_id, title: source.title, url: source.url, lexical, quality: record.quality_score };
      }))
      .filter((document) => !queryTokens.length || document.lexical > 0)
      .sort((left, right) => right.lexical - left.lexical || right.quality - left.quality)
      .slice(0, Math.max(1, Math.min(50, limit)));
    return documents.map(({ lexical: _lexical, quality: _quality, ...document }) => document);
  }

  function fetchDocument(documentId, identity) {
    if (!DOCUMENT_ID_PATTERN.test(String(documentId || ""))) return null;
    for (const record of read(identity.tenantId).records.filter((candidate) => candidate.state === "validated")) {
      const source = record.sources.find((candidate) => candidate.document_id === documentId);
      if (!source) continue;
      const claims = record.claims.filter((claim) => claim.source_ids.includes(source.id));
      const text = [
        `Research question: ${record.question}`,
        `Evidence state: ${record.state}`,
        `Quality score: ${record.quality_score}`,
        `Publisher: ${source.publisher || source.hostname}`,
        `Published at: ${source.published_at || "unknown"}`,
        source.excerpt ? `Short excerpt: ${source.excerpt}` : "",
        "Supported claims:",
        ...claims.map((claim) => `- [${claim.kind}] ${claim.text} (confidence ${claim.confidence})`),
      ].filter(Boolean).join("\n");
      return {
        id: source.document_id,
        title: source.title,
        text,
        url: source.url,
        metadata: {
          source: "nyra_research_cortex",
          state: record.state,
          quality_score: String(record.quality_score),
          published_at: source.published_at || "unknown",
          source_type: source.source_type,
        },
      };
    }
    return null;
  }

  function checkOpenAiRate(identity) {
    const now = Date.now();
    const windowStart = now - 3_600_000;
    const current = (openAiCalls.get(identity.tenantId) || []).filter((timestamp) => timestamp > windowStart);
    if (current.length >= config.openaiResearchMaxCallsPerHour) fail("openai_research_rate_limited");
    current.push(now);
    openAiCalls.set(identity.tenantId, current);
  }

  async function executeOpenAi(input, identity) {
    if (!config.openaiResearchEnabled) fail("openai_research_disabled");
    if (!config.openaiApiKey) fail("openai_research_not_configured");
    const normalizedQuery = sanitizeText(input.query || input.question, "research_query", 2_000);
    if (normalizedQuery.prompt_injection) fail("research_query_rejected");
    const query = normalizedQuery.text;
    const contextSize = ["low", "medium", "high"].includes(input.search_context_size) ? input.search_context_size : "low";
    const allowedDomains = unique((Array.isArray(input.allowed_domains) ? input.allowed_domains : []).slice(0, 20).map(normalizeDomain).filter(Boolean));
    const queryFingerprint = crypto.createHash("sha256").update(query).digest("hex").slice(0, 24);
    const gate = await authorize(identity, {
      action_type: "research.external_web_search",
      action_label: "Run optional billable OpenAI web research",
      target: `research_query_${queryFingerprint}`,
      operation_class: "billable_external_read",
      external_side_effect: true,
      contains_customer_data: normalizedQuery.redaction_count > 0,
    });
    checkOpenAiRate(identity);
    const webTool = {
      type: "web_search",
      search_context_size: contextSize,
      external_web_access: true,
      ...(allowedDomains.length ? { filters: { allowed_domains: allowedDomains } } : {}),
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.openaiResearchTimeoutMs);
    let response;
    try {
      response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.openaiApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.openaiResearchModel,
          tools: [webTool],
          tool_choice: "required",
          max_tool_calls: 3,
          parallel_tool_calls: false,
          max_output_tokens: 2_000,
          store: false,
          safety_identifier: crypto.createHash("sha256").update(`tenant:${identity.tenantId}`).digest("hex"),
          include: ["web_search_call.action.sources"],
          input: `Research this question with current, authoritative sources. Preserve contradictions and uncertainty. Return a concise evidence synthesis with citations. Question: ${query}`,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      fail(error?.name === "AbortError" ? "openai_research_timeout" : "openai_research_unavailable");
    } finally {
      clearTimeout(timeout);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) fail(`openai_research_failed_${response.status}`);
    const extracted = extractOpenAiResponse(payload, query);
    return {
      ...extracted,
      model: config.openaiResearchModel,
      usage: {
        input_tokens: Number(payload.usage?.input_tokens || 0),
        output_tokens: Number(payload.usage?.output_tokens || 0),
        total_tokens: Number(payload.usage?.total_tokens || 0),
      },
      policy: {
        stored: false,
        next_step: "Review the evidence pack template, then call nyra_research_ingest.",
        api_key_exposed: false,
        tenant_scoped: true,
        core_gate: { decision: gate.decision, mediation: gate.mediation },
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
    openAiAvailable: config.openaiResearchEnabled === true && Boolean(config.openaiApiKey),
  };
}

export function createResearchHandlers(research) {
  return {
    nyra_research_plan: async (args, identity) => textResult(await research.plan(args, identity)),
    nyra_research_ingest: async (args, identity) => textResult(await research.ingest(args, identity)),
    nyra_research_query: async (args, identity) => textResult(research.query(args, identity)),
    nyra_research_status: async (args, identity) => textResult(research.status(args, identity)),
    nyra_research_feedback: async (args, identity) => textResult(await research.feedback(args, identity)),
    ...(research.openAiAvailable
      ? { nyra_research_execute: async (args, identity) => textResult(await research.executeOpenAi(args, identity)) }
      : {}),
  };
}

export { normalizeUrl, tenantDirectory };
