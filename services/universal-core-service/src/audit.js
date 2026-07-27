import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function createAudit(storageRoot) {
  const auditDir = path.join(storageRoot, "audit");
  const auditFile = path.join(auditDir, "events.jsonl");
  ensureDir(auditDir);

  function append(eventType, payload = {}) {
    const event = {
      audit_id: crypto.randomUUID(),
      event_type: eventType,
      created_at: new Date().toISOString(),
      ...payload,
    };

    fs.appendFileSync(auditFile, `${JSON.stringify(event)}\n`, "utf8");
    return event;
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

  function recentForTenant(tenantId, limit = 50, { includeGlobal = false } = {}) {
    const normalizedTenantId = String(tenantId || "").trim();
    if (!/^[a-z0-9][a-z0-9_-]{1,119}$/i.test(normalizedTenantId)) throw new Error("tenant_id_invalid");
    if (!fs.existsSync(auditFile)) return [];
    const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    return fs
      .readFileSync(auditFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((event) => event && (event.tenant_id === normalizedTenantId || (includeGlobal && !event.tenant_id)))
      .slice(-boundedLimit);
  }

  return { append, recent, recentForTenant };
}
