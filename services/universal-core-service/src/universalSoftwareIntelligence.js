import crypto from "node:crypto";
import { analyzeEmbeddedSoftwareArtifact, embeddedComponentManifest, MAX_EMBEDDED_ARTIFACT_BYTES } from "./embeddedSoftwareIntelligence.js";

export const UNIVERSAL_SOFTWARE_EVIDENCE_SCHEMA = "universal_software_evidence_v1";
export const UNIVERSAL_SOFTWARE_JOB_SCHEMA = "universal_software_job_v1";

const MODES = new Set(["lightweight_static", "ghidra_headless", "frida_local_agent"]);
const DEEP_MODES = new Set(["ghidra_headless", "frida_local_agent"]);
const AUTHORIZATION_BASES = new Set(["owned", "written_permission", "open_source"]);
const TEMPLATE_ID = /^[a-z][a-z0-9_.-]{2,63}$/;
const TARGET_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,239}$/;

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(String(left || "")) || !/^[a-f0-9]{64}$/i.test(String(right || ""))) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function createSoftwareAuthorizationVerifier({ secret, now = () => Date.now() } = {}) {
  const key = String(secret || "");
  if (key.length < 32) throw new Error("software_authorization_secret_too_short");
  return ({ tenant_id: tenantId, request = {} }) => {
    const envelope = request.core_governance?.authorization_envelope;
    const signature = String(request.core_governance?.signature || "").toLowerCase();
    if (!envelope || typeof envelope !== "object") return { authorized: false, target_allowlist: [] };
    const expected = crypto.createHmac("sha256", key).update(JSON.stringify(envelope)).digest("hex");
    const expiresAt = Date.parse(envelope.expires_at || "");
    const issuedAt = Date.parse(envelope.issued_at || "");
    const modeAllowed = Array.isArray(envelope.allowed_modes) && envelope.allowed_modes.includes(request.mode);
    const valid = safeEqualHex(signature, expected) && envelope.schema_version === "universal_software_authorization_v1" &&
      envelope.tenant_id === tenantId && envelope.authorized === true && envelope.owner_confirmed === true &&
      envelope.issued_by === "universal_core" && modeAllowed && Number.isFinite(issuedAt) && Number.isFinite(expiresAt) &&
      issuedAt <= now() && expiresAt > now() && expiresAt - issuedAt <= 5 * 60_000;
    return { authorized: valid, target_allowlist: valid && Array.isArray(envelope.target_allowlist) ? envelope.target_allowlist.map(String) : [] };
  };
}

export function issueSoftwareAuthorizationEnvelope({ secret, tenantId, allowedModes, targetAllowlist = [], now = () => Date.now(), ttlMilliseconds = 60_000 } = {}) {
  const key = String(secret || "");
  if (key.length < 32) throw new Error("software_authorization_secret_too_short");
  const modes = [...new Set((allowedModes || []).map(String))];
  if (!modes.length || modes.some((mode) => !DEEP_MODES.has(mode))) throw new Error("software_authorization_modes_invalid");
  const issued = now();
  const ttl = Math.max(1_000, Math.min(5 * 60_000, Number(ttlMilliseconds) || 60_000));
  const envelope = {
    schema_version: "universal_software_authorization_v1",
    tenant_id: cleanIdentifier(tenantId, "software_tenant_required"),
    issued_by: "universal_core",
    authorized: true,
    owner_confirmed: true,
    allowed_modes: modes,
    target_allowlist: [...new Set(targetAllowlist.map(String))],
    issued_at: new Date(issued).toISOString(),
    expires_at: new Date(issued + ttl).toISOString(),
  };
  return { authorization_envelope: envelope, signature: crypto.createHmac("sha256", key).update(JSON.stringify(envelope)).digest("hex") };
}

export const DEFAULT_SOFTWARE_RESOURCE_LIMITS = Object.freeze({
  cpu_seconds: 30,
  memory_megabytes: 512,
  wall_time_seconds: 60,
  artifact_bytes: MAX_EMBEDDED_ARTIFACT_BYTES,
  output_bytes: 2 * 1024 * 1024,
});

export const FRIDA_TEMPLATE_CATALOG = Object.freeze([
  Object.freeze({
    id: "observe_module_loads_v1",
    version: 1,
    capability: "module_load_observation",
    parameters: Object.freeze(["module_name_filter"]),
    prohibited_capabilities: Object.freeze(["credential_extraction", "tls_bypass", "stealth", "protection_disable"]),
  }),
  Object.freeze({
    id: "observe_function_calls_v1",
    version: 1,
    capability: "allowlisted_function_trace",
    parameters: Object.freeze(["module", "symbol", "max_events"]),
    prohibited_capabilities: Object.freeze(["credential_extraction", "tls_bypass", "stealth", "protection_disable"]),
  }),
  Object.freeze({
    id: "observe_file_access_v1",
    version: 1,
    capability: "file_access_metadata",
    parameters: Object.freeze(["path_prefix", "max_events"]),
    prohibited_capabilities: Object.freeze(["file_content_capture", "credential_extraction", "stealth"]),
  }),
]);

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed))) : fallback;
}

export function normalizeSoftwareResourceLimits(input = {}) {
  return Object.freeze({
    cpu_seconds: boundedInteger(input.cpu_seconds, DEFAULT_SOFTWARE_RESOURCE_LIMITS.cpu_seconds, 1, 120),
    memory_megabytes: boundedInteger(input.memory_megabytes, DEFAULT_SOFTWARE_RESOURCE_LIMITS.memory_megabytes, 64, 2048),
    wall_time_seconds: boundedInteger(input.wall_time_seconds, DEFAULT_SOFTWARE_RESOURCE_LIMITS.wall_time_seconds, 1, 300),
    artifact_bytes: boundedInteger(input.artifact_bytes, DEFAULT_SOFTWARE_RESOURCE_LIMITS.artifact_bytes, 1, MAX_EMBEDDED_ARTIFACT_BYTES),
    output_bytes: boundedInteger(input.output_bytes, DEFAULT_SOFTWARE_RESOURCE_LIMITS.output_bytes, 1024, 8 * 1024 * 1024),
  });
}

function cleanIdentifier(value, errorCode) {
  const result = String(value || "").trim();
  if (!TARGET_ID.test(result)) throw new Error(errorCode);
  return result;
}

function authorizationBasis(input = {}) {
  const basis = String(input.basis || "").trim().toLowerCase();
  if (input.asserted !== true) throw new Error("software_analysis_authorization_assertion_required");
  if (!AUTHORIZATION_BASES.has(basis)) throw new Error("software_analysis_authorization_basis_invalid");
  return basis;
}

export function authorizeUniversalSoftwareJob(input = {}, context = {}) {
  const tenantId = cleanIdentifier(context.tenant_id, "software_tenant_required");
  const mode = String(input.mode || "lightweight_static").trim().toLowerCase();
  if (!MODES.has(mode)) throw new Error("software_analysis_mode_invalid");
  const basis = authorizationBasis(input.authorization);
  if (!context.memory_available) throw new Error("software_memory_unavailable");
  if (context.requested_tenant_id && context.requested_tenant_id !== tenantId) throw new Error("software_cross_tenant_denied");

  const deep = DEEP_MODES.has(mode);
  if (deep && !context.core_available) throw new Error("software_core_unavailable");
  if (deep && context.core_authorized !== true) throw new Error("software_core_authorization_required");
  if (deep && input.authorization?.owner_confirmed !== true) throw new Error("software_owner_confirmation_required");

  const artifactOwner = cleanIdentifier(input.authorization?.artifact_owner || tenantId, "software_artifact_owner_invalid");
  if (basis === "owned" && artifactOwner !== tenantId) throw new Error("software_artifact_ownership_mismatch");

  const target = mode === "frida_local_agent" ? cleanIdentifier(input.target, "software_target_required") : null;
  const targetAllowlist = Array.isArray(context.target_allowlist) ? context.target_allowlist.map(String) : [];
  if (target && !targetAllowlist.includes(target)) throw new Error("software_target_not_allowlisted");

  let template = null;
  if (mode === "frida_local_agent") {
    if (input.javascript || input.script || input.source) throw new Error("frida_arbitrary_input_denied");
    const templateId = String(input.template_id || "").trim();
    if (!TEMPLATE_ID.test(templateId)) throw new Error("frida_template_required");
    template = FRIDA_TEMPLATE_CATALOG.find((item) => item.id === templateId) || null;
    if (!template) throw new Error("frida_template_not_allowlisted");
    const allowedParameters = new Set(template.parameters);
    for (const key of Object.keys(input.template_parameters || {})) {
      if (!allowedParameters.has(key)) throw new Error("frida_template_parameter_denied");
    }
  }

  return Object.freeze({
    tenant_id: tenantId,
    mode,
    basis,
    deep_analysis: deep,
    core_governed: deep,
    owner_confirmed: input.authorization?.owner_confirmed === true,
    target,
    template_id: template?.id || null,
  });
}

function publicJob(job) {
  return {
    schema_version: UNIVERSAL_SOFTWARE_JOB_SCHEMA,
    job_id: job.job_id,
    tenant_id: job.tenant_id,
    mode: job.mode,
    state: job.state,
    created_at: job.created_at,
    started_at: job.started_at || null,
    completed_at: job.completed_at || null,
    expires_at: job.expires_at,
    limits: job.limits,
    network_access: "denied",
    raw_artifact_persisted: false,
    evidence: job.evidence || null,
    error: job.error || null,
  };
}

function normalizeEvidence(job, result) {
  const evidence = result?.schema_version === UNIVERSAL_SOFTWARE_EVIDENCE_SCHEMA
    ? result
    : { schema_version: UNIVERSAL_SOFTWARE_EVIDENCE_SCHEMA, analyzer: job.mode, observations: result || {} };
  return {
    ...evidence,
    schema_version: UNIVERSAL_SOFTWARE_EVIDENCE_SCHEMA,
    tenant_id: job.tenant_id,
    job_id: job.job_id,
    analyzer: job.mode,
    isolation: { network_access: "denied", process_scope: job.authorization.target || null },
    retention: { raw_artifact_persisted: false, evidence_expires_at: job.expires_at },
  };
}

function normalizedSymbol(value) {
  return String(value || "").replace(/^_+/, "").trim().toLowerCase();
}

export function correlateUniversalSoftwareEvidence(staticEvidence, dynamicEvidence) {
  if (staticEvidence?.schema_version !== UNIVERSAL_SOFTWARE_EVIDENCE_SCHEMA || dynamicEvidence?.schema_version !== UNIVERSAL_SOFTWARE_EVIDENCE_SCHEMA) throw new Error("software_evidence_schema_invalid");
  const functions = Array.isArray(staticEvidence.functions) ? staticEvidence.functions : [];
  const runtimeCalls = new Map();
  for (const event of Array.isArray(dynamicEvidence.events) ? dynamicEvidence.events : []) {
    if (event?.kind !== "call_enter") continue;
    const key = normalizedSymbol(event.symbol);
    if (key) runtimeCalls.set(key, (runtimeCalls.get(key) || 0) + 1);
  }
  const matches = functions.map((item) => {
    const normalized = normalizedSymbol(item.name);
    return {
      function: item.name,
      entry: item.entry,
      signature: item.signature || null,
      static_callers: item.callers || [],
      static_callees: item.callees || [],
      runtime_observed: runtimeCalls.has(normalized),
      runtime_call_count: runtimeCalls.get(normalized) || 0,
      confidence: runtimeCalls.has(normalized) ? "confirmed_runtime" : "static_only",
    };
  });
  const unmatchedRuntimeSymbols = [...runtimeCalls.keys()].filter((symbol) => !functions.some((item) => normalizedSymbol(item.name) === symbol));
  return {
    schema_version: "universal_software_correlation_v1",
    evidence_schema: UNIVERSAL_SOFTWARE_EVIDENCE_SCHEMA,
    matched_functions: matches,
    observed_function_count: matches.filter((item) => item.runtime_observed).length,
    unmatched_runtime_symbols: unmatchedRuntimeSymbols,
    static_call_graph: Array.isArray(staticEvidence.call_graph) ? staticEvidence.call_graph : [],
    reconstructed_code: Array.isArray(staticEvidence.decompilation) ? staticEvidence.decompilation : [],
    interpretation_boundary: "Nyra and Codex may explain evidence and confidence but must not represent static inference as runtime fact.",
    raw_content_persisted: false,
  };
}

export function createUniversalSoftwareJobManager({ adapters = {}, now = () => Date.now(), retentionMilliseconds = 15 * 60_000 } = {}) {
  const jobs = new Map();

  function get(jobId, tenantId) {
    const job = jobs.get(String(jobId || ""));
    if (!job || job.tenant_id !== tenantId) return null;
    return publicJob(job);
  }

  function list(tenantId) {
    return [...jobs.values()].filter((job) => job.tenant_id === tenantId).map(publicJob);
  }

  function submit(input, context) {
    const authorization = authorizeUniversalSoftwareJob(input, context);
    const limits = normalizeSoftwareResourceLimits(input.limits);
    const artifact = input.artifact || {};
    const encoded = String(artifact.content_base64 || "");
    const estimatedBytes = Math.floor(encoded.length * 0.75);
    if (estimatedBytes > limits.artifact_bytes) throw new Error("software_artifact_too_large");
    const job = {
      job_id: `usij_${crypto.randomUUID()}`,
      tenant_id: authorization.tenant_id,
      mode: authorization.mode,
      authorization,
      limits,
      state: "queued",
      created_at: new Date(now()).toISOString(),
      expires_at: new Date(now() + retentionMilliseconds).toISOString(),
    };
    jobs.set(job.job_id, job);

    queueMicrotask(async () => {
      job.state = "running";
      job.started_at = new Date(now()).toISOString();
      try {
        let result;
        if (job.mode === "lightweight_static") {
          result = analyzeEmbeddedSoftwareArtifact({ artifact, authorization: input.authorization, options: input.options });
        } else {
          const adapter = adapters[job.mode];
          if (typeof adapter !== "function") throw new Error(`${job.mode}_worker_unavailable`);
          result = await Promise.race([
            adapter({ artifact, authorization, limits, template_parameters: input.template_parameters || {} }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("software_analysis_timeout")), limits.wall_time_seconds * 1000)),
          ]);
        }
        const serialized = JSON.stringify(result || {});
        if (Buffer.byteLength(serialized) > limits.output_bytes) throw new Error("software_output_limit_exceeded");
        job.evidence = normalizeEvidence(job, result);
        job.state = "completed";
      } catch (error) {
        job.error = String(error?.message || "software_analysis_failed");
        job.state = "failed";
      } finally {
        job.completed_at = new Date(now()).toISOString();
      }
    });
    return publicJob(job);
  }

  function purgeExpired() {
    const timestamp = now();
    for (const [id, job] of jobs) if (Date.parse(job.expires_at) <= timestamp) jobs.delete(id);
  }

  function correlate(jobIds, tenantId) {
    const selected = (jobIds || []).map((id) => jobs.get(String(id || "")));
    if (selected.length !== 2 || selected.some((job) => !job || job.tenant_id !== tenantId || job.state !== "completed")) throw new Error("software_correlation_jobs_unavailable");
    const staticJob = selected.find((job) => job.mode === "ghidra_headless");
    const dynamicJob = selected.find((job) => job.mode === "frida_local_agent");
    if (!staticJob || !dynamicJob) throw new Error("software_correlation_modes_required");
    return { ...correlateUniversalSoftwareEvidence(staticJob.evidence, dynamicJob.evidence), tenant_id: tenantId, source_job_ids: selected.map((job) => job.job_id) };
  }

  return Object.freeze({ submit, get, list, correlate, purgeExpired });
}

export function universalSoftwareComponentManifest({ configuredWorkers = [] } = {}) {
  const base = embeddedComponentManifest();
  return {
    schema_version: "universal_software_component_manifest_v1",
    evidence_schema: UNIVERSAL_SOFTWARE_EVIDENCE_SCHEMA,
    default_analyzer: "lightweight_static",
    runtime_dependency: "none_for_lightweight_static",
    desktop_application_required: false,
    components: base.components.map((item) => item.id === "universal_binary_evidence_core" ? {
      ...item,
      status: "embedded_active",
      verified: true,
    } : item),
    optional_workers: [
      { id: "ghidra_headless", status: configuredWorkers.includes("ghidra_headless") ? "optional_configured_probe_required" : "optional_unavailable", isolation: "no_network", capabilities: ["elf", "pe", "macho", "sections", "symbols", "imports", "exports", "functions", "references", "call_graph", "selective_decompilation"] },
      { id: "frida_local_agent", status: configuredWorkers.includes("frida_local_agent") ? "optional_configured_probe_required" : "optional_unavailable", isolation: "local_agent_no_network", templates: FRIDA_TEMPLATE_CATALOG.map((item) => ({ id: item.id, version: item.version, capability: item.capability })) },
    ],
  };
}
