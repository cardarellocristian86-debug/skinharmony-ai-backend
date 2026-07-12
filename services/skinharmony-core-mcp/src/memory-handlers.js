import fs from "node:fs";
import path from "node:path";

function tenantDir(config, tenantId) {
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(tenantId)) throw new Error("tenant_invalid");
  const root = path.resolve(config.sharedMemoryRoot, "tenants");
  const resolved = path.resolve(root, tenantId, "documents");
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("tenant_path_rejected");
  return resolved;
}

function records(config, tenantId) {
  const dir = tenantDir(config, tenantId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /^[a-f0-9]{24}\.json$/.test(name)).map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
}

function content(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

export function createMemoryHandlers(config) {
  return {
    search: async ({ query }, identity) => {
      const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 12);
      const results = records(config, identity.tenantId).map((record) => {
        const haystack = `${record.title}\n${record.source_path}\n${record.text}`.toLowerCase();
        const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        return { record, score };
      }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.record.title.localeCompare(b.record.title)).slice(0, 20).map(({ record }) => ({
        id: record.id,
        title: record.title,
        url: `${config.publicUrl}/memory/${record.id}`
      }));
      return content({ results });
    },
    fetch: async ({ id }, identity) => {
      if (!/^[a-f0-9]{24}$/.test(String(id || ""))) throw new Error("memory_id_invalid");
      const record = records(config, identity.tenantId).find((item) => item.id === id);
      if (!record) throw new Error("memory_document_not_found");
      return content({ id: record.id, title: record.title, text: record.text.slice(0, 100_000), url: `${config.publicUrl}/memory/${record.id}`, metadata: { source_path: record.source_path, tenant_id: identity.tenantId, redacted: true } });
    }
  };
}

export { tenantDir };
