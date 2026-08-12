import crypto from "node:crypto";

const digest = (value) => `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

export function createIcfKernel({ audit } = {}) {
  const works = new Map();
  const append = (event, payload) => audit?.append?.(`icf_${event}`, payload);
  const scoped = (tenantId, workId) => {
    const key = `${tenantId}:${workId}`;
    let work = works.get(key);
    if (!work) {
      work = { tenant_id: tenantId, work_id: workId, version: 0, events: [], covenant: null, obligations: new Map() };
      works.set(key, work);
    }
    return work;
  };
  const event = (work, type, payload) => {
    const record = { seq: work.events.length + 1, type, at: new Date().toISOString(), payload };
    record.digest = digest(record);
    work.events.push(record);
    work.version = record.seq;
    append(type, { tenant_id: work.tenant_id, work_id: work.work_id, seq: record.seq });
    return record;
  };
  return {
    putCovenant(tenantId, workId, input = {}) {
      const work = scoped(tenantId, workId);
      if (work.covenant?.status === "sealed") return { ok: false, error: "covenant_sealed" };
      const covenant = { schema: "nyra.icf.intent-covenant/1.0", tenant_id: tenantId, work_id: workId, version: (work.covenant?.version || 0) + 1, ...input, status: "sealed" };
      covenant.digest = digest(covenant);
      work.covenant = covenant;
      event(work, "covenant_sealed", { covenant_digest: covenant.digest });
      return { ok: true, covenant };
    },
    compile(tenantId, workId, claims = []) {
      const work = scoped(tenantId, workId);
      if (!work.covenant) return { ok: false, error: "covenant_required" };
      const obligations = claims.map((claim, index) => {
        const item = { schema: "nyra.icf.obligation/1.0", obligation_id: claim.obligation_id || `obl_${work.version + index + 1}`, tenant_id: tenantId, work_id: workId, covenant_digest: work.covenant.digest, kind: claim.kind || "achievement", claim: claim.claim || String(claim), status: "open", disposition: null };
        item.digest = digest(item); work.obligations.set(item.obligation_id, item); return item;
      });
      event(work, "obligations_compiled", { obligation_ids: obligations.map((o) => o.obligation_id) });
      return { ok: true, obligations };
    },
    status(tenantId, workId) {
      const work = scoped(tenantId, workId);
      const obligations = [...work.obligations.values()];
      const open = obligations.filter((o) => o.status === "open");
      return { tenant_id: tenantId, work_id: workId, mode: "shadow", ledger_head: work.events.at(-1) || null, covenant: work.covenant, obligations, closure: { required_open_obligations: open.length, unaccounted_obligations: 0, decision: open.length ? "BLOCK" : "ALLOW_CLOSE" } };
    },
    resolve(tenantId, workId, obligationId, disposition) {
      const work = scoped(tenantId, workId); const obligation = work.obligations.get(obligationId);
      if (!obligation) return { ok: false, error: "obligation_not_found" };
      if (!["satisfied", "waived", "transferred"].includes(disposition)) return { ok: false, error: "invalid_disposition" };
      obligation.status = disposition; obligation.disposition = disposition; event(work, "obligation_resolved", { obligation_id: obligationId, disposition });
      return { ok: true, obligation };
    },
  };
}
