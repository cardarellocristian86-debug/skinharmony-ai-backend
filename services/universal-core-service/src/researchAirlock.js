import crypto from "node:crypto";
import dns from "node:dns/promises";

import { assessLexicalSemanticText } from "../../shared/lexical-semantic-engine.mjs";
import {
  normalizedPublicSourceUrl,
  pinnedPublicHttpsFetch,
  resolvePublicSourceAddresses,
  safePublicSourceContentType,
} from "./nyraDeepV2SourceVerification.js";

export const RESEARCH_AIRLOCK_SCHEMA_VERSION = "nyra_core_research_airlock_v1";
export const RESEARCH_AIRLOCK_POLICY_VERSION = "nyra_core_research_airlock_policy_v1";
export const RESEARCH_AIRLOCK_SANITIZER_VERSION = "research_airlock_sanitizer_v1";

const RELEASE_OVERLAY = Object.freeze({
  enforcement_scope: "research_airlock_v1",
  enforced_branch_ids: {
    core: ["research_evidence_intelligence"],
    nyra: ["research_evidence"],
  },
  execution_authority_expanded: false,
  host_web_globally_intercepted: false,
});
const EXTERNAL_TOOLS = new Set([
  "web_compatibility_execute",
  "nyra_research_airlock_discover",
  "research_plan",
  "research_validate",
  "nyra_research_evidence_ingest",
  "nyra_research_envelope_authorize",
  "nyra_research_workspace_open",
  "nyra_research_workspace_attach",
  "nyra_research_distill",
]);
const ALWAYS_ALLOWED_TOOLS = new Set([
  "nyra_research_airlock_status",
  "nyra_research_airlock_tool_authorize",
]);
const PREOPEN_SAFE_TOOLS = new Set([
  ...ALWAYS_ALLOWED_TOOLS,
  "nyra_research_airlock_bootstrap",
  "nyra_research_airlock_plan",
  "nyra_research_airlock_open",
]);
const PUBLIC_PHASE_TOOLS = new Set([
  ...ALWAYS_ALLOWED_TOOLS,
  "nyra_research_airlock_discover",
  "nyra_research_airlock_seal",
]);
const SEALED_PHASE_TOOLS = new Set([
  ...ALWAYS_ALLOWED_TOOLS,
  "nyra_research_airlock_private_enter",
]);
const PRIVATE_PHASE_TOOLS = new Set([
  ...ALWAYS_ALLOWED_TOOLS,
  "nyra_research_airlock_complete",
]);

function externalTool(input = {}) {
  const toolName = String(input.tool_name || "").trim();
  const transportToolName = String(input.transport_tool_name || toolName).trim();
  return input.open_world === true
    || EXTERNAL_TOOLS.has(toolName)
    || [toolName, transportToolName].some((name) => (
      name.startsWith("web_")
      || name.startsWith("suite_")
      || name.startsWith("nyra_v2_")
      || name.startsWith("core_capability_")
      || (name.startsWith("nyra_research_") && !ALWAYS_ALLOWED_TOOLS.has(name))
    ));
}
const PROMPT_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|system|developer)\s+instructions?/i,
  /(?:system|developer)\s+(?:message|instruction|prompt)\s*[:=]/i,
  /(?:reveal|print|return|send|upload|exfiltrate)\s+(?:the\s+)?(?:system\s+prompt|developer\s+message|secret|token|credentials?|private\s+data)/i,
  /ignora\s+(?:tutte\s+)?(?:le\s+)?istruzioni\s+(?:precedenti|di\s+sistema)/i,
  /(?:rivela|invia|carica|esfiltra)\s+(?:il\s+)?(?:prompt|segreto|token|credenziali|dati\s+privati)/i,
  /(?:transmit|copy|send|upload|append|place|encode|embed)\b[\s\S]{0,120}\b(?:private|confidential|customer|tenant|secret|credential)\b[\s\S]{0,120}\b(?:url|uri|query|parameter|header|request|endpoint)/i,
  /(?:url|uri|query|parameter|header|request|endpoint)\b[\s\S]{0,120}\b(?:private|confidential|customer|tenant|secret|credential)\b/i,
  /(?:obey|follow|execute|prioriti[sz]e)\b[\s\S]{0,100}\b(?:instructions?|directives?|commands?)\b[\s\S]{0,100}\b(?:page|document|source|website)\b/i,
  /(?:copia|invia|trasmetti|aggiungi|codifica)\b[\s\S]{0,120}\b(?:privat[ioe]|confidenzial[ei]|client[ei]|segreti?|credenziali)\b[\s\S]{0,120}\b(?:url|query|parametr[oi]|richiesta|endpoint)/i,
];
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/i,
  /\b(?:password|passwd|secret|api[_ -]?key|access[_ -]?token)\s*[:=]\s*[^\s,;]+/i,
];

function required(value, name, maximum = 160) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(normalized)) throw new Error(`${name}_invalid`);
  return normalized;
}

function digest(value) {
  return crypto.createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : stableJson(value)).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => {
    if (value[key] !== undefined) out[key] = canonical(value[key]);
    return out;
  }, {});
}

function stableJson(value) { return JSON.stringify(canonical(value)); }

function workIdentity(tenantId, input = {}) {
  return {
    tenant_id: required(tenantId, "research_airlock_tenant_id"),
    project_id: required(input.project_id, "research_airlock_project_id"),
    work_id: required(input.work_id, "research_airlock_work_id"),
    session_id: required(input.session_id, "research_airlock_session_id"),
  };
}

function publicDomain(value) {
  const url = normalizedPublicSourceUrl(`https://${String(value || "").trim().toLowerCase()}`);
  if (!url || url.pathname !== "/") throw new Error("research_airlock_domain_invalid");
  return url.hostname;
}

function domainAllowed(hostname, allowedDomains) {
  return allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function inspectText(raw) {
  const text = String(raw || "");
  const candidates = [text];
  try { candidates.push(decodeURIComponent(text)); } catch { /* raw remains inspectable */ }
  candidates.push(text.replace(/&#x([0-9a-f]+);|&#([0-9]+);/gi, (_match, hex, decimal) => String.fromCodePoint(Number.parseInt(hex || decimal, hex ? 16 : 10))));
  return candidates.join("\n");
}

function visibleText(body, contentType) {
  const raw = String(body || "");
  if (contentType.includes("json")) {
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, (_key, value) => typeof value === "string" ? value : value).slice(0, 20_000);
    } catch { return raw.slice(0, 20_000); }
  }
  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20_000);
}

function sanitizeEvidence(body, contentType, source) {
  const inspected = inspectText(body);
  const lexical = assessLexicalSemanticText({ text: inspected.slice(0, 200_000), source_context: "retrieved_web" });
  const prompt = PROMPT_PATTERNS.some((pattern) => pattern.test(inspected)) || lexical.disposition !== "allow";
  const sensitive = SECRET_PATTERNS.some((pattern) => pattern.test(inspected));
  if (prompt || sensitive) {
    return {
      verdict: "BLOCK",
      reason: prompt ? "research_airlock_prompt_injection_detected" : "research_airlock_sensitive_material_detected",
      labels: [...new Set([...(prompt ? ["prompt_injection"] : []), ...(sensitive ? ["sensitive_material"] : []), ...(lexical.matched_families || [])])],
    };
  }
  const text = visibleText(body, contentType);
  if (!text) return { verdict: "BLOCK", reason: "research_airlock_empty_evidence", labels: ["empty"] };
  const spans = text.split(/(?<=[.!?])\s+/).map((span) => span.trim()).filter(Boolean).slice(0, 12).map((span, index) => ({
    span_id: `span_${index + 1}`,
    kind: "source_excerpt",
    text: span.slice(0, 500),
    executable: false,
  }));
  const evidence = {
    schema_version: "research_airlock_typed_evidence_v1",
    source: {
      canonical_url: source.url,
      final_url: source.final_url,
      fetched_at: source.fetched_at,
      content_type: source.content_type,
      status_code: source.status_code,
    },
    spans,
    trust_label: "public_untrusted_sanitized_non_executable",
    instructions_allowed: false,
  };
  return { verdict: "ALLOW", evidence, digest: digest(evidence), labels: [] };
}

function actorDigest(context = {}) {
  return digest(String(context.actor || context.keyId || "core-mcp")).slice(0, 32);
}

function deriveKey(secret) {
  const material = String(secret || "").trim();
  if (Buffer.byteLength(material, "utf8") < 32) return null;
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(material), Buffer.from("skinharmony-research-airlock"), Buffer.from(RESEARCH_AIRLOCK_POLICY_VERSION), 32));
}

function capabilityToken({ id, nonce }) { return `${id}.${nonce}`; }

function parseCapability(value) {
  const [id, nonce, extra] = String(value || "").split(".");
  if (extra || !/^rac_[a-f0-9-]{36}$/.test(id || "") || !/^[a-f0-9]{64}$/.test(nonce || "")) throw new Error("research_airlock_capability_invalid");
  return { id, nonce };
}

function parsePlanCapability(value) {
  const [id, nonce, extra] = String(value || "").split(".");
  if (extra || !/^rap_[a-f0-9-]{36}$/.test(id || "") || !/^[a-f0-9]{64}$/.test(nonce || "")) throw new Error("research_airlock_plan_capability_invalid");
  return { id, nonce };
}

export function createResearchAirlockRuntime(options = {}) {
  const store = options.store || {
    kind: "unavailable",
    restart_durable: false,
    distributed: false,
    async metrics() { return { state_counts: {}, verdict_counts: {} }; },
  };
  const signingKey = deriveKey(options.signingSecret);
  const mode = String(options.mode || "shadow").trim().toLowerCase();
  const enforced = mode === "enforced";
  const now = () => new Date(typeof options.now === "function" ? options.now() : options.now || Date.now());
  const transport = options.transport || createAirlockTransport(options.transportOptions);
  const shadowMonitorRequired = options.shadowMonitorRequired === true;
  const durableStore = store.kind === "postgresql" && store.restart_durable && store.distributed;
  const configuredReady = Boolean(signingKey && store.kind === "postgresql" && store.restart_durable && store.distributed && enforced)
    || Boolean(options.allowTestStore === true && signingKey && enforced);
  const storeInitialization = () => {
    if (typeof store.initializationStatus !== "function") {
      return { state: "ready", ready: true, error: null };
    }
    const status = store.initializationStatus();
    return {
      state: String(status?.state || "unknown").slice(0, 40),
      ready: status?.ready === true,
      error: status?.error ? String(status.error).slice(0, 80) : null,
    };
  };
  const operationalReady = () => configuredReady && storeInitialization().ready;
  const keyVersion = signingKey ? `airlock_${digest(signingKey).slice(0, 16)}` : null;
  const sign = (value) => crypto.createHmac("sha256", signingKey).update(stableJson(value)).digest("hex");
  const baseEvent = (context, request) => ({
    actor_digest: actorDigest(context),
    request_digest: digest(request),
    created_at: now().toISOString(),
  });

  async function createPlan(input, context = {}) {
    if (!operationalReady()) throw new Error("research_airlock_not_ready");
    const work = workIdentity(context.tenantId, input.work_binding || input);
    const allowedUrls = [...new Set((input.source_urls || []).map((value) => {
      const url = normalizedPublicSourceUrl(value);
      if (!url) throw new Error("research_airlock_source_url_invalid");
      return url.toString();
    }))];
    if (!allowedUrls.length || allowedUrls.length > 20) throw new Error("research_airlock_source_urls_invalid");
    const allowedDomains = [...new Set(allowedUrls.map((value) => publicDomain(new URL(value).hostname)))];
    const issued = now();
    const cortexPlanDigest = input.research_cortex_plan_digest == null ? null : String(input.research_cortex_plan_digest);
    if (cortexPlanDigest !== null && !/^[a-f0-9]{64}$/.test(cortexPlanDigest)) throw new Error("research_airlock_cortex_plan_digest_invalid");
    const planId = `rap_${crypto.randomUUID()}`;
    const nonce = crypto.randomBytes(32).toString("hex");
    const planDigest = digest({
      schema_version: "research_airlock_public_plan_v1",
      work_binding: work,
      source_urls: allowedUrls,
      research_cortex_plan_digest: cortexPlanDigest,
      policy_version: RESEARCH_AIRLOCK_POLICY_VERSION,
    });
    const expiresAt = new Date(issued.getTime() + 120_000).toISOString();
    await store.issuePlan({
      ...work,
      allowed_domains: allowedDomains,
      allowed_urls: allowedUrls,
      plan_id: planId,
      plan_digest: planDigest,
      policy_snapshot_digest: digest({ policy: RESEARCH_AIRLOCK_POLICY_VERSION, overlay: RELEASE_OVERLAY, allowed_urls: allowedUrls }),
      nonce_digest: digest(nonce),
      key_version: keyVersion,
      issued_at: issued.toISOString(),
      expires_at: expiresAt,
      ...baseEvent(context, input),
    });
    return {
      verdict: "ALLOW",
      plan: {
        schema_version: "research_airlock_public_plan_v1",
        plan_digest: planDigest,
        research_cortex_plan_digest: cortexPlanDigest,
        source_url_digests: allowedUrls.map((value) => digest(value)),
        expires_at: expiresAt,
      },
      plan_capability: `${planId}.${nonce}`,
    };
  }

  async function createWork(input, context = {}) {
    if (!operationalReady()) throw new Error("research_airlock_not_ready");
    const work = workIdentity(context.tenantId, input.work_binding || input);
    const plan = parsePlanCapability(input.plan_capability);
    const created = now();
    return store.consumePlanAndCreateWork({
      ...work,
      plan_id: plan.id,
      nonce_digest: digest(plan.nonce),
      release_commit_sha: /^[a-f0-9]{40}$/.test(String(options.releaseCommitSha || "")) ? options.releaseCommitSha : null,
      created_at: created.toISOString(),
      expires_at: new Date(created.getTime() + Math.min(Math.max(Number(input.ttl_seconds) || 1_800, 300), 3_600) * 1_000).toISOString(),
      ...baseEvent(context, input),
    });
  }

  function createCapability(purpose, request, context) {
    const nonce = crypto.randomBytes(32).toString("hex");
    const capabilityId = `rac_${crypto.randomUUID()}`;
    const issued = now();
    const requestDigest = digest(request);
    return {
      token: capabilityToken({ id: capabilityId, nonce }),
      request_digest: requestDigest,
      store_input: {
      required_state: purpose === "DISCOVERY_FETCH" ? "DISCOVERY_OPEN" : "EVIDENCE_SEALED",
      capability_id: capabilityId,
      purpose,
      request_digest: requestDigest,
      nonce_digest: digest(nonce),
      issued_at: issued.toISOString(),
      expires_at: new Date(issued.getTime() + 120_000).toISOString(),
      key_version: keyVersion,
      ...baseEvent(context, request),
      },
    };
  }

  async function issueCapability(work, purpose, request, context) {
    const capability = createCapability(purpose, request, context);
    await store.issueCapability(work, capability.store_input);
    return capability;
  }

  async function discover(input, context = {}) {
    if (!operationalReady()) throw new Error("research_airlock_not_ready");
    const work = workIdentity(context.tenantId, input.work_binding || input);
    const current = await store.getWork(work, baseEvent(context, { operation: "discover", work }));
    if (!current || current.state !== "DISCOVERY_OPEN") throw new Error("research_airlock_discovery_closed");
    const method = String(input.method || "GET").toUpperCase();
    if (!["GET", "HEAD"].includes(method)) throw new Error("research_airlock_method_rejected");
    const url = normalizedPublicSourceUrl(input.url);
    if (!url || !current.allowed_urls.includes(url.toString())) throw new Error("research_airlock_source_not_authorized");
    const request = { work, url: url.toString(), method, plan_digest: current.plan_digest, policy_snapshot_digest: current.policy_snapshot_digest };
    const capability = await issueCapability(work, "DISCOVERY_FETCH", request, context);
    let fetched;
    try {
      fetched = await transport.fetch({ url, method, allowedDomains: current.allowed_domains });
    } catch (error) {
      throw Object.assign(new Error(error.message || "research_airlock_fetch_failed"), { capability_consumed: false });
    }
    const sanitized = sanitizeEvidence(fetched.bytes.toString("utf8"), fetched.content_type, {
      url: url.toString(), final_url: fetched.final_url, fetched_at: now().toISOString(), content_type: fetched.content_type, status_code: fetched.status_code,
    });
    const parsed = parseCapability(capability.token);
    const event = {
      capability_id: parsed.id,
      nonce_digest: digest(parsed.nonce),
      request_digest: capability.request_digest,
      fetch_id: `raf_${crypto.randomUUID()}`,
      normalized_url_digest: digest(url.toString()),
      resolved_ip_digest: digest(fetched.resolved_addresses.sort().join("\n")),
      redirect_chain_digest: digest(fetched.redirect_chain),
      response_digest: digest(fetched.bytes),
      typed_evidence_digest: sanitized.digest || digest({ blocked: sanitized.reason }),
      content_type: fetched.content_type,
      byte_count: fetched.bytes.length,
      status_code: fetched.status_code,
      sanitizer_version: RESEARCH_AIRLOCK_SANITIZER_VERSION,
      injection_verdict: sanitized.verdict,
      reason_code: sanitized.reason || "research_airlock_fetch_verified",
      evidence: sanitized.evidence || null,
      ...baseEvent(context, request),
    };
    const stored = await store.consumeDiscoveryCapability(work, event);
    if (stored.state === "QUARANTINED") {
      return { verdict: "BLOCK", state: stored.state, reason: sanitized.reason, threat_labels: sanitized.labels, raw_content_returned: false, safe_replan: safeReplan(sanitized.reason) };
    }
    const unsignedFetchProof = {
      schema_version: "research_airlock_fetch_proof_v1",
      work_binding: work,
      request_digest: event.request_digest,
      capability_id: event.capability_id,
      capability_consumed_at: event.created_at,
      authorized_method: method,
      authorized_url_digest: event.normalized_url_digest,
      dns_ip_digest: event.resolved_ip_digest,
      redirect_chain_digest: event.redirect_chain_digest,
      response_digest: event.response_digest,
      sanitizer_version: event.sanitizer_version,
      typed_evidence_digest: event.typed_evidence_digest,
      injection_verdict: event.injection_verdict,
      policy_snapshot_digest: current.policy_snapshot_digest,
      release_commit_sha: current.release_commit_sha,
      fetch_id: event.fetch_id,
      key_version: keyVersion,
    };
    return {
      verdict: "ALLOW",
      state: stored.state,
      evidence: sanitized.evidence,
      fetch_proof: {
        ...unsignedFetchProof,
        core_signature: sign(unsignedFetchProof),
      },
      raw_content_returned: false,
    };
  }

  async function seal(input, context = {}) {
    if (!operationalReady()) throw new Error("research_airlock_not_ready");
    const work = workIdentity(context.tenantId, input.work_binding || input);
    const current = await store.getWork(work, baseEvent(context, { operation: "seal_evidence", work }));
    if (!current || current.state !== "DISCOVERY_OPEN" || !current.evidence.length) throw new Error("research_airlock_not_sealable");
    const evidenceDigest = digest(current.evidence);
    const sourceUrls = [...new Set(current.evidence.map((item) => normalizedPublicSourceUrl(item?.source?.canonical_url)?.toString()).filter(Boolean))].sort();
    const sourceDomains = [...new Set(sourceUrls.map((value) => new URL(value).hostname.toLowerCase()))].sort();
    const unsigned = {
      schema_version: "research_airlock_evidence_capsule_v1",
      capsule_id: `rec_${crypto.randomUUID()}`,
      work_binding: work,
      plan_digest: current.plan_digest,
      policy_snapshot_digest: current.policy_snapshot_digest,
      evidence_digest: evidenceDigest,
      evidence_count: current.evidence.length,
      independent_source_count: sourceUrls.length,
      independent_domain_count: sourceDomains.length,
      source_url_digests: sourceUrls.map((value) => digest(value)),
      source_domain_digests: sourceDomains.map((value) => digest(value)),
      issued_at: now().toISOString(),
      expires_at: current.expires_at,
      source_domain: "public_untrusted",
      destination_domain: "tenant_private",
      executable_instructions_allowed: false,
    };
    const capsule = { ...unsigned, signature: { algorithm: "hmac-sha256", key_version: keyVersion, value: sign(unsigned) } };
    const privateEntryRequest = { work, capsule_id: capsule.capsule_id, evidence_digest: evidenceDigest };
    const privateEntry = createCapability("PRIVATE_ENTRY", privateEntryRequest, context);
    const sealed = await store.sealAndIssuePrivateCapability(work, {
      evidence_digest: evidenceDigest,
      capsule,
      capability: privateEntry.store_input,
      ...baseEvent(context, input),
    });
    return { verdict: "ALLOW", state: sealed.state, capsule, private_entry_capability: privateEntry.token, web_via_nyra_core_allowed: false };
  }

  async function enterPrivate(input, context = {}) {
    if (!operationalReady()) throw new Error("research_airlock_not_ready");
    const work = workIdentity(context.tenantId, input.work_binding || input);
    const current = await store.getWork(work, baseEvent(context, { operation: "consume_private_cap", work }));
    if (!current || current.state !== "EVIDENCE_SEALED") throw new Error("research_airlock_private_entry_denied");
    const parsed = parseCapability(input.private_entry_capability);
    const request = { work, capsule_id: current.capsule?.capsule_id, evidence_digest: current.evidence_digest };
    const entered = await store.enterPrivate(work, {
      capability_id: parsed.id,
      nonce_digest: digest(parsed.nonce),
      request_digest: digest(request),
      ...baseEvent(context, request),
    });
    return {
      verdict: "ALLOW",
      state: entered.state,
      evidence_bundle: entered.evidence,
      capability: { web_via_nyra_core_allowed: false, redirects_allowed: false, external_tools_allowed: false },
      boundary_notice: "This enforcement covers Nyra/Core tools only; ChatGPT host web tools remain outside the connector boundary.",
    };
  }

  async function authorizeTool(input, context = {}) {
    if (!operationalReady()) return { verdict: "BLOCK", reason: "research_airlock_not_ready" };
    const work = workIdentity(context.tenantId, input.work_binding || input);
    const current = await store.getWork(work, baseEvent(context, { operation: "authorize_tool", work }));
    if (!current) return { verdict: "BLOCK", reason: "research_airlock_work_not_found" };
    return authorizeCurrentTool(current, input);
  }

  function authorizeCurrentTool(current, input = {}) {
    const toolName = String(input.tool_name || "").trim();
    if (ALWAYS_ALLOWED_TOOLS.has(toolName)) return { verdict: "ALLOW", state: current.state, nyra_core_boundary_only: true };
    if (current.state === "DISCOVERY_OPEN" && !PUBLIC_PHASE_TOOLS.has(toolName)) {
      return { verdict: "BLOCK", reason: "research_airlock_public_phase_tool_denied", state: current.state };
    }
    if (current.state === "EVIDENCE_SEALED" && !SEALED_PHASE_TOOLS.has(toolName)) {
      return { verdict: "BLOCK", reason: "research_airlock_sealed_phase_tool_denied", state: current.state };
    }
    if (current.state === "PRIVATE_SYNTHESIS") {
      if (PRIVATE_PHASE_TOOLS.has(toolName)) return { verdict: "ALLOW", state: current.state, nyra_core_boundary_only: true };
      if (externalTool(input)) return { verdict: "BLOCK", reason: "research_airlock_external_tool_closed", state: current.state };
    }
    if (["QUARANTINED", "EXPIRED", "CLOSED"].includes(current.state)) return { verdict: "BLOCK", reason: "research_airlock_terminal_state", state: current.state };
    return { verdict: "ALLOW", state: current.state, nyra_core_boundary_only: true };
  }

  async function authorizeSessionToolReadOnly(input, context = {}) {
    const tenantId = required(context.tenantId, "research_airlock_tenant_id");
    const sessionId = required(input.session_id, "research_airlock_session_id");
    if (typeof store.observeSessionAuthorization !== "function") {
      return { verdict: "BLOCK", reason: "research_airlock_read_only_authorization_unavailable" };
    }
    const initialized = storeInitialization().ready;
    if (!operationalReady() && !(mode === "shadow" && durableStore && initialized)) {
      return { verdict: "BLOCK", reason: "research_airlock_not_ready" };
    }
    const resolved = await store.observeSessionAuthorization({
      tenant_id: tenantId,
      session_id: sessionId,
      tool_name: input.tool_name,
      safe_preopen: PREOPEN_SAFE_TOOLS.has(String(input.tool_name || "")),
      ...baseEvent(context, { operation: "observe_session_tool", tenant_id: tenantId, session_id: sessionId }),
    });
    if (!resolved.work) {
      const observed = resolved.decision;
      if (mode === "shadow" && observed?.verdict !== "BLOCK") return {
        verdict: "ALLOW",
        state: observed.state,
        shadow_observation: observed.state,
        nyra_core_boundary_only: true,
      };
      return observed;
    }
    if (!configuredReady) return { verdict: "BLOCK", reason: "research_airlock_shadow_active_work_closed", state: resolved.work.state };
    return authorizeCurrentTool(resolved.work, input);
  }

  async function authorizeSessionTool(input, context = {}) {
    const tenantId = required(context.tenantId, "research_airlock_tenant_id");
    const sessionId = required(input.session_id, "research_airlock_session_id");
    const initialized = storeInitialization().ready;
    if (!operationalReady() && !(mode === "shadow" && durableStore && initialized)) {
      return { verdict: "BLOCK", reason: "research_airlock_not_ready" };
    }
    const resolved = await store.resolveSessionAuthorization({
      tenant_id: tenantId,
      session_id: sessionId,
      tool_name: input.tool_name,
      safe_preopen: PREOPEN_SAFE_TOOLS.has(String(input.tool_name || "")),
      ...baseEvent(context, { operation: "authorize_session_tool", tenant_id: tenantId, session_id: sessionId }),
    });
    if (!resolved.work) {
      const observed = resolved.decision;
      if (mode === "shadow") return {
        verdict: "ALLOW",
        state: observed.state === "PREOPEN_TAINTED" ? "SHADOW_PREOPEN_TAINTED" : "SHADOW_NO_ACTIVE_AIRLOCK",
        shadow_observation: observed.state,
        nyra_core_boundary_only: true,
      };
      return observed;
    }
    if (!configuredReady) return { verdict: "BLOCK", reason: "research_airlock_shadow_active_work_closed", state: resolved.work.state };
    return authorizeTool({
      work_binding: resolved.work,
      tool_name: input.tool_name,
      transport_tool_name: input.transport_tool_name,
      open_world: input.open_world === true,
    }, context);
  }

  async function complete(input, context = {}) {
    if (!operationalReady()) throw new Error("research_airlock_not_ready");
    const work = workIdentity(context.tenantId, input.work_binding || input);
    const closed = await store.closeWork(work, baseEvent(context, input));
    return { verdict: "ALLOW", state: closed.state };
  }

  function safeReplan(reason) {
    return {
      state: "SAFE_REPLAN_REQUIRED",
      reason: String(reason || "research_airlock_blocked").slice(0, 160),
      next_actions: ["start_new_public_only_work", "use_independent_authorized_https_source", "discard_quarantined_artifacts"],
      prohibited_actions: ["reuse_work_id", "reuse_capability", "send_private_data_to_public_source"],
    };
  }

  async function status(tenantId) {
    const tenant = required(tenantId, "research_airlock_tenant_id");
    const initialization = storeInitialization();
    const runtimeReady = configuredReady && initialization.ready;
    const shadowOperational = mode === "shadow"
      && (!shadowMonitorRequired || (durableStore && initialization.ready));
    return {
      schema_version: RESEARCH_AIRLOCK_SCHEMA_VERSION,
      policy_version: RESEARCH_AIRLOCK_POLICY_VERSION,
      mode,
      ready: runtimeReady,
      state: initialization.state,
      operational_safe: runtimeReady || shadowOperational,
      accepting_new_work: runtimeReady,
      key_version: keyVersion,
      state_backend: store.kind,
      restart_durable: store.restart_durable === true,
      distributed: store.distributed === true,
      initialization,
      raw_content_crosses_model_boundary: false,
      enforcement_overlay: RELEASE_OVERLAY,
      boundary: { nyra_core_tools_enforced: true, chatgpt_host_web_intercepted: false },
      rollback: { mode: "shadow", effect: "new work denied; active capabilities fail closed" },
      metrics: initialization.ready
        ? await store.metrics(tenant)
        : {
            state_counts: {},
            verdict_counts: {},
            preopen_tainted_sessions: 0,
            plan_counts: { issued: 0, consumed: 0, expired_unconsumed: 0 },
          },
    };
  }

  function verifyFetchProof(proof = {}) {
    if (!signingKey || typeof proof.core_signature !== "string") return false;
    const { core_signature: signature, ...unsigned } = proof;
    const expected = sign(unsigned);
    const left = Buffer.from(signature, "hex");
    const right = Buffer.from(expected, "hex");
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  function verifyEvidenceCapsule(capsule = {}) {
    if (!signingKey || capsule?.schema_version !== "research_airlock_evidence_capsule_v1"
      || capsule?.signature?.algorithm !== "hmac-sha256" || capsule.signature.key_version !== keyVersion
      || typeof capsule.signature.value !== "string") return false;
    const { signature, ...unsigned } = capsule;
    const expected = sign(unsigned);
    const left = Buffer.from(signature.value, "hex");
    const right = Buffer.from(expected, "hex");
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  async function readSealedEvidence(capsule = {}, context = {}) {
    if (!operationalReady() || !verifyEvidenceCapsule(capsule)) throw new Error("research_airlock_evidence_capsule_invalid");
    const work = workIdentity(context.tenantId, capsule.work_binding || {});
    const current = await store.getWork(work, baseEvent(context, { operation: "read_sealed_evidence", work }));
    if (!current || current.state !== "EVIDENCE_SEALED" || current.capsule?.capsule_id !== capsule.capsule_id
      || current.plan_digest !== capsule.plan_digest || current.evidence_digest !== capsule.evidence_digest
      || digest(current.evidence || []) !== capsule.evidence_digest) throw new Error("research_airlock_evidence_capsule_stale");
    return { schema_version: "research_airlock_sealed_evidence_read_v1", work_binding: work,
      capsule_id: capsule.capsule_id, plan_digest: current.plan_digest, evidence_digest: current.evidence_digest,
      evidence: structuredClone(current.evidence || []), fresh_until: current.expires_at, trust_label: "public_untrusted_sanitized_non_executable",
      execution_authorized: false };
  }

  return {
    createPlan,
    createWork,
    discover,
    seal,
    enterPrivate,
    authorizeTool,
    authorizeSessionTool,
    authorizeSessionToolReadOnly,
    complete,
    status,
    safeReplan,
    verifyFetchProof,
    verifyEvidenceCapsule,
    readSealedEvidence,
    // This property reports static configuration for the signed bootstrap
    // guard. Operational readiness, including schema state, is returned by
    // status() and enforced by every action method above.
    ready: configuredReady,
    mode,
    store,
  };
}

export function createAirlockTransport({
  dnsLookup = dns.lookup,
  pinnedFetch = pinnedPublicHttpsFetch,
  timeoutMs = 5_000,
  maxBytes = 250_000,
  maxRedirects = 3,
} = {}) {
  return {
    async fetch({ url, method = "GET", allowedDomains = [] }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(Math.max(Number(timeoutMs) || 5_000, 500), 8_000));
      try {
        let current = normalizedPublicSourceUrl(url);
        if (!current || !domainAllowed(current.hostname, allowedDomains)) throw new Error("research_airlock_source_url_rejected");
        const redirectChain = [];
        const resolvedAddresses = [];
        for (let hop = 0; hop <= maxRedirects; hop += 1) {
          const addresses = await resolvePublicSourceAddresses(current.hostname, dnsLookup);
          resolvedAddresses.push(...addresses);
          const response = await pinnedFetch({
            url: current,
            addresses,
            headers: { Accept: "text/html, text/plain, application/json, application/ld+json;q=0.8", "User-Agent": "skinharmony-research-airlock/1" },
            signal: controller.signal,
            maxBytes,
            method,
            allowRedirect: true,
          });
          if (response.redirect) {
            if (hop === maxRedirects) throw new Error("research_airlock_redirect_limit");
            if (!response.location) throw new Error("research_airlock_redirect_rejected");
            const next = normalizedPublicSourceUrl(new URL(response.location, current).toString());
            if (!next || !domainAllowed(next.hostname, allowedDomains)) throw new Error("research_airlock_redirect_rejected");
            redirectChain.push({ from_digest: digest(current.toString()), to_digest: digest(next.toString()), status: response.status });
            current = next;
            continue;
          }
          if (response.ok !== true) throw new Error("research_airlock_fetch_rejected");
          if (!safePublicSourceContentType(response.contentType)) throw new Error("research_airlock_content_type_rejected");
          return {
            bytes: response.bytes,
            content_type: String(response.contentType || "").toLowerCase().split(";", 1)[0],
            status_code: response.status,
            final_url: current.toString(),
            redirect_chain: redirectChain,
            resolved_addresses: [...new Set(resolvedAddresses)],
          };
        }
        throw new Error("research_airlock_redirect_limit");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
