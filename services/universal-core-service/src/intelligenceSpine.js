import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = "skinharmony_experience_v1";
const CLOUD_EVENT_SPEC_VERSION = "1.0";
const DEFAULT_SOURCE = "/skinharmony/universal-core-service";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function clampText(value, max = 160) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stableHash(value, secret = "") {
  return crypto
    .createHmac("sha256", secret || "skinharmony-shadow-ref-v1")
    .update(String(value ?? ""))
    .digest("hex");
}

function parseTraceId(req) {
  const traceparent = clampText(req.get?.("traceparent"), 128);
  const match = traceparent.match(/^00-([a-f0-9]{32})-[a-f0-9]{16}-[a-f0-9]{2}$/i);
  if (match) return match[1].toLowerCase();

  const requestId = clampText(req.get?.("x-request-id"), 120);
  if (requestId) return stableHash(requestId).slice(0, 32);
  return crypto.randomBytes(16).toString("hex");
}

function requestTenantRef(req, secret) {
  const tenant =
    req.body?.tenant_id ||
    req.body?.context?.tenant_id ||
    req.body?.core_input?.context?.tenant_id ||
    req.get?.("x-sh-tenant-id") ||
    "";
  return tenant ? stableHash(tenant, secret).slice(0, 24) : null;
}

function decisionSummary(payload) {
  if (!payload || typeof payload !== "object") return null;
  const contract = payload.decision_contract || payload.verdict || payload.result?.decision_contract || {};
  const output = payload.output || payload.result || {};
  const risk = contract.risk || output.risk || {};
  const mediation = contract.action_mediation || output.action_mediation || {};
  const summary = {
    state: clampText(contract.state || contract.decision || output.state || output.decision, 64) || null,
    control_level: clampText(contract.control_level || mediation.state, 64) || null,
    risk_band: clampText(contract.risk_band || risk.band, 32) || null,
    risk_score: finiteNumber(contract.risk_score ?? risk.score),
    confidence: finiteNumber(contract.confidence ?? output.confidence),
    execution_allowed:
      contract.executionAllowed ??
      contract.execution_allowed ??
      mediation.execution_allowed ??
      payload.guardrail?.execution_allowed ??
      null,
    owner_confirmation_required:
      contract.requiresOwnerConfirmation ??
      contract.owner_confirmation_required ??
      mediation.owner_confirmation_required ??
      payload.guardrail?.owner_confirmation_required ??
      null,
  };
  return Object.values(summary).some((value) => value !== null && value !== "") ? summary : null;
}

function eventTypeFor(req, summary) {
  const route = String(req.originalUrl || req.url || "").split("?")[0];
  if (route.includes("/review/action")) return "com.skinharmony.owner.feedback.recorded";
  if (route.includes("/decision") || route.includes("/action-evaluator") || route.includes("/gateway")) {
    return "com.skinharmony.core.decision.completed";
  }
  if (summary) return "com.skinharmony.core.verdict.completed";
  return "com.skinharmony.runtime.request.completed";
}

function shouldRecord(req, res, summary) {
  if (summary || Number(res.statusCode || 0) >= 500) return true;
  const route = String(req.originalUrl || req.url || "").split("?")[0];
  if (route.includes("/review/action")) return true;
  const configured = Number(process.env.SKINHARMONY_SPINE_RUNTIME_SAMPLE_RATE ?? 0.01);
  const sampleRate = Math.max(0, Math.min(1, Number.isFinite(configured) ? configured : 0.01));
  return Math.random() < sampleRate;
}

export function createCloudEvent({ type, subject, data, traceId, source = DEFAULT_SOURCE, time = new Date() }) {
  return {
    specversion: CLOUD_EVENT_SPEC_VERSION,
    id: `evt_${crypto.randomUUID()}`,
    source,
    type,
    subject: clampText(subject, 240) || "runtime/request",
    time: time instanceof Date ? time.toISOString() : new Date(time).toISOString(),
    datacontenttype: "application/json",
    dataschema: `urn:skinharmony:schema:${SCHEMA_VERSION}`,
    traceid: clampText(traceId, 64),
    data,
  };
}

export function createExperienceLedger(storageRoot, options = {}) {
  const enabled = options.enabled !== false;
  const dir = path.join(storageRoot, "intelligence-spine");
  const file = path.join(dir, "experience-ledger.jsonl");
  const stateFile = path.join(dir, "ledger-state.json");
  const signingSecret = String(options.signingSecret || process.env.CORE_EXPERIENCE_SIGNING_SECRET || "").trim();
  let state = { events: 0, last_hash: "GENESIS", last_event_at: null };

  if (enabled) {
    ensureDir(dir);
    try {
      if (fs.existsSync(stateFile)) state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, "utf8")) };
    } catch {
      state = { events: 0, last_hash: "GENESIS", last_event_at: null, recovered: true };
    }
  }

  function append(event) {
    if (!enabled) return { written: false, mode: "disabled" };
    const previousHash = state.last_hash || "GENESIS";
    const serialized = JSON.stringify(event);
    const hash = signingSecret
      ? crypto.createHmac("sha256", signingSecret).update(`${previousHash}\n${serialized}`).digest("hex")
      : crypto.createHash("sha256").update(`${previousHash}\n${serialized}`).digest("hex");
    const record = {
      ...event,
      integrity: {
        algorithm: signingSecret ? "hmac-sha256-chain" : "sha256-chain",
        previous_hash: previousHash,
        hash,
        production_signed: Boolean(signingSecret),
      },
    };
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
    state = { events: Number(state.events || 0) + 1, last_hash: hash, last_event_at: event.time };
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
    return { written: true, event_id: event.id, hash };
  }

  return {
    append,
    status() {
      return {
        schema_version: SCHEMA_VERSION,
        mode: "shadow",
        enabled,
        events: Number(state.events || 0),
        last_event_at: state.last_event_at || null,
        signed: Boolean(signingSecret),
        decisions_mutated: false,
      };
    },
  };
}

export function createIntelligenceSpine(storageRoot, options = {}) {
  const enabled = options.enabled ?? process.env.SKINHARMONY_INTELLIGENCE_SPINE_ENABLED !== "false";
  const refSecret = String(options.refSecret || process.env.CORE_EXPERIENCE_REF_SECRET || "").trim();
  const ledger = createExperienceLedger(storageRoot, {
    enabled,
    signingSecret: options.signingSecret,
  });

  function middleware(req, res, next) {
    if (!enabled) return next();
    const route = String(req.originalUrl || req.url || "").split("?")[0];
    if (route === "/healthz" || route === "/intelligence-spine/healthz") return next();

    const startedAt = process.hrtime.bigint();
    const traceId = parseTraceId(req);
    const spanId = crypto.randomBytes(8).toString("hex");
    const requestId = clampText(req.get?.("x-request-id"), 120) || `req_${crypto.randomUUID()}`;
    let responseSummary = null;

    res.setHeader("X-Request-ID", requestId);
    if (!res.getHeader("traceparent")) res.setHeader("traceparent", `00-${traceId}-${spanId}-01`);

    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      responseSummary = decisionSummary(payload);
      return originalJson(payload);
    };

    res.once("finish", () => {
      try {
        if (!shouldRecord(req, res, responseSummary)) return;
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const tenantRef = requestTenantRef(req, refSecret);
        const event = createCloudEvent({
          type: eventTypeFor(req, responseSummary),
          subject: `${String(req.method || "GET").toUpperCase()} ${route}`,
          traceId,
          data: {
            schema_version: SCHEMA_VERSION,
            mode: "shadow",
            request_id: requestId,
            tenant_ref: tenantRef,
            route,
            method: String(req.method || "GET").toUpperCase(),
            status_code: Number(res.statusCode || 0),
            duration_ms: Math.round(durationMs * 1000) / 1000,
            decision: responseSummary,
            learning_eligible: Boolean(responseSummary && res.statusCode >= 200 && res.statusCode < 300),
            contains_raw_body: false,
            contains_credentials: false,
            decisions_mutated: false,
          },
        });
        ledger.append(event);
      } catch {
        // Telemetry is fail-open and must never alter a Core response.
      }
    });

    return next();
  }

  return {
    middleware,
    status: ledger.status,
  };
}

export const intelligenceSpineSchemaVersion = SCHEMA_VERSION;
