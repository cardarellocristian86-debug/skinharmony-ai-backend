import crypto from "node:crypto";

const CURSOR_PREFIX = "btc1_";
const CURSOR_SCHEMA_VERSION = "branch_taxonomy_cursor_v1";
const PAGE_SCHEMA_VERSION = "branch_taxonomy_page_v1";
const MIN_SECRET_BYTES = 32;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const SHA256 = /^[a-f0-9]{64}$/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => [key, stable(value[key])]));
}

function canonical(value) {
  return JSON.stringify(stable(value));
}

function compareText(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  return a < b ? -1 : a > b ? 1 : 0;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function boundedLimit(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_LIMIT;
  if (!/^\d+$/.test(String(value))) fail("branch_taxonomy_limit_invalid");
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    fail("branch_taxonomy_limit_invalid");
  }
  return limit;
}

function cursorKey(secret) {
  const value = String(secret || "");
  if (Buffer.byteLength(value, "utf8") < MIN_SECRET_BYTES) {
    fail("branch_taxonomy_cursor_unavailable");
  }
  return crypto.createHash("sha256")
    .update("branch-taxonomy-cursor-key-v1\0")
    .update(value)
    .digest();
}

function encodeCursor({ tenantId, taxonomyDigest, offset, secret }) {
  const plaintext = Buffer.from(canonical({
    schema_version: CURSOR_SCHEMA_VERSION,
    tenant_id: tenantId,
    taxonomy_digest: taxonomyDigest,
    offset,
  }), "utf8");
  const key = cursorKey(secret);
  const nonce = crypto.createHmac("sha256", key)
    .update("branch-taxonomy-cursor-nonce-v1\0")
    .update(plaintext)
    .digest()
    .subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(CURSOR_PREFIX, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${CURSOR_PREFIX}${Buffer.concat([nonce, tag, encrypted]).toString("base64url")}`;
}

function decodeCursor({ cursor, tenantId, taxonomyDigest, totalItems, secret }) {
  if (cursor === undefined || cursor === null) return 0;
  const token = String(cursor);
  if (!token.startsWith(CURSOR_PREFIX) || token.length > 1024 ||
      !/^[A-Za-z0-9_-]+$/.test(token.slice(CURSOR_PREFIX.length))) {
    fail("branch_taxonomy_cursor_invalid");
  }
  try {
    const packed = Buffer.from(token.slice(CURSOR_PREFIX.length), "base64url");
    if (packed.length < 29 || packed.toString("base64url") !== token.slice(CURSOR_PREFIX.length)) {
      fail("branch_taxonomy_cursor_invalid");
    }
    const key = cursorKey(secret);
    const nonce = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const encrypted = packed.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from(CURSOR_PREFIX, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const payload = JSON.parse(plaintext.toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        Object.keys(payload).sort().join("\0") !==
          ["offset", "schema_version", "taxonomy_digest", "tenant_id"].join("\0") ||
        payload.schema_version !== CURSOR_SCHEMA_VERSION || payload.tenant_id !== tenantId ||
        payload.taxonomy_digest !== taxonomyDigest || !Number.isSafeInteger(payload.offset) ||
        payload.offset < 0 || payload.offset >= totalItems) {
      fail("branch_taxonomy_cursor_invalid");
    }
    return payload.offset;
  } catch (error) {
    if (error?.code === "branch_taxonomy_cursor_unavailable") throw error;
    fail("branch_taxonomy_cursor_invalid");
  }
}

function orderedTaxonomy(taxonomy) {
  if (!taxonomy || typeof taxonomy !== "object" || Array.isArray(taxonomy) ||
      !Array.isArray(taxonomy.nodes) || !Array.isArray(taxonomy.synapses)) {
    fail("branch_taxonomy_source_invalid");
  }
  const nodes = [...taxonomy.nodes].sort((left, right) =>
    Number(left?.depth || 0) - Number(right?.depth || 0) ||
    compareText(left?.node_id, right?.node_id));
  const synapses = [...taxonomy.synapses].sort((left, right) =>
    compareText(left?.from_node_id, right?.from_node_id) ||
    compareText(left?.to_node_id, right?.to_node_id) ||
    compareText(left?.reason, right?.reason));
  return Object.freeze({ ...taxonomy, nodes: Object.freeze(nodes), synapses: Object.freeze(synapses) });
}

export function paginateBranchTaxonomy({
  taxonomy,
  tenantId,
  cursor,
  limit,
  secret,
} = {}) {
  const resolvedTenant = String(tenantId || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(resolvedTenant)) {
    fail("branch_taxonomy_tenant_invalid");
  }
  const pageLimit = boundedLimit(limit);
  const ordered = orderedTaxonomy(taxonomy);
  const digestInput = {
    ...ordered,
    nodes: ordered.nodes,
    synapses: ordered.synapses,
  };
  const taxonomyDigest = crypto.createHash("sha256").update(canonical(digestInput)).digest("hex");
  if (!SHA256.test(taxonomyDigest)) fail("branch_taxonomy_digest_invalid");
  const entries = [
    ...ordered.nodes.map((value) => Object.freeze({ kind: "node", value })),
    ...ordered.synapses.map((value) => Object.freeze({ kind: "synapse", value })),
  ];
  const offset = decodeCursor({
    cursor,
    tenantId: resolvedTenant,
    taxonomyDigest,
    totalItems: entries.length,
    secret,
  });
  const end = Math.min(entries.length, offset + pageLimit);
  const page = entries.slice(offset, end);
  const nextCursor = end < entries.length
    ? encodeCursor({ tenantId: resolvedTenant, taxonomyDigest, offset: end, secret })
    : null;
  const metadata = Object.fromEntries(Object.entries(ordered)
    .filter(([key]) => key !== "nodes" && key !== "synapses"));
  return Object.freeze({
    taxonomy: Object.freeze({
      ...metadata,
      nodes: Object.freeze(page.filter((entry) => entry.kind === "node").map((entry) => entry.value)),
      synapses: Object.freeze(page.filter((entry) => entry.kind === "synapse").map((entry) => entry.value)),
    }),
    pagination: Object.freeze({
      schema_version: PAGE_SCHEMA_VERSION,
      taxonomy_digest: taxonomyDigest,
      ordering: "nodes_by_depth_then_id__synapses_by_from_to_reason",
      cursor: cursor ? String(cursor) : null,
      next_cursor: nextCursor,
      page_limit: pageLimit,
      offset,
      returned_items: page.length,
      total_items: entries.length,
      complete: nextCursor === null,
    }),
  });
}

export const BRANCH_TAXONOMY_PAGE_LIMIT = MAX_LIMIT;
