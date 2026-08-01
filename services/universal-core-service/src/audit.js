import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SENSITIVE_KEY = /authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|credential/i;

function sanitize(value, seen = new WeakSet()) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 2048);
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitize(entry, seen));
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitize(entry, seen)]));
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function createAudit(storageRoot) {
  const auditDir = path.join(storageRoot, "audit");
  const auditFile = path.join(auditDir, "events.jsonl");
  ensureDir(auditDir);

  function append(eventType, payload = {}) {
    const previous = recent(1)[0];
    const event = {
      audit_id: crypto.randomUUID(),
      event_type: eventType,
      created_at: new Date().toISOString(),
      ...sanitize(payload),
      previous_digest: previous?.event_digest || null,
    };

    event.event_digest = digest(event);

    fs.appendFileSync(auditFile, `${JSON.stringify(event)}\n`, "utf8");
    return event;
  }

  function appendSecurityEvent(input) {
    const duplicate = recent(200).find((event) => event.event_id === input.event_id);
    if (duplicate) return duplicate;
    return append(input.event_type || "security_hardening_event", {
      event_id: input.event_id,
      schema_version: input.schema_version || "1.1",
      tenant_id: input.tenant_id,
      work_id: input.work_id,
      session_id: input.session_id,
      remediation_id: input.remediation_id,
      agent_id: input.agent_id,
      tool_id: input.tool_id,
      severity: input.severity,
      policy_code: input.policy_code,
      decision: input.decision,
      timestamp: input.timestamp,
      metadata: sanitize(input.metadata || {}),
    });
  }

  function verifyChain() {
    const events = recent(200).filter((event) => event.event_digest);
    let previous = events[0]?.previous_digest || null;
    for (const event of events) {
      const stored = event.event_digest;
      const candidate = { ...event };
      delete candidate.event_digest;
      if (event.previous_digest !== previous || digest(candidate) !== stored) return false;
      previous = stored;
    }
    return true;
  }

  function recent(limit = 50) {
    if (!fs.existsSync(auditFile)) return [];
    const lines = fs
      .readFileSync(auditFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(200, Number(limit) || 50)));

    return lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { event_type: "audit_parse_error", raw: line };
      }
    });
  }

  return { append, appendSecurityEvent, recent, verifyChain };
}
