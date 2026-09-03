import crypto from "node:crypto";

// External mutations cannot be made replay-safe by the Core authorization
// ledger alone: an MCP response may be lost after the target accepted the
// request. Until a durable execution/result ledger exists, publish only the
// HTTP methods whose contract is retrieval-only.
const SAFE_METHODS = new Set(["GET", "HEAD"]);
const MAX_URL_LENGTH = 8_192;
const MAX_BODY_BYTES = 2_000_000;
const DEFAULT_RESPONSE_BYTES = 2_000_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const MAX_COOKIE_COUNT = 50;
const FORBIDDEN_CALLER_HEADERS = new Set([
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "transfer-encoding",
]);

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function canonicalizeWebUrl(input) {
  let url;
  try { url = new URL(String(input || "")); } catch { fail("web_url_invalid"); }
  if (!["http:", "https:"].includes(url.protocol)) fail("web_url_scheme_not_allowed");
  if (url.username || url.password) fail("web_url_credentials_not_allowed");
  if (url.href.length > MAX_URL_LENGTH) fail("web_url_too_long");
  url.hash = "";
  const canonicalUrl = url.toString();
  return {
    canonical_url: canonicalUrl,
    url_ref: `url_${sha256(canonicalUrl).slice(0, 32)}`,
    length: canonicalUrl.length,
    long_url: canonicalUrl.length > 256,
  };
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
}

function parseJsonLd(html) {
  const records = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    const raw = decodeEntities(match[1]).trim();
    try { records.push({ valid: true, data: JSON.parse(raw) }); }
    catch { records.push({ valid: false, raw: raw.slice(0, 20_000) }); }
  }
  return records;
}

export function ingestStructuredWebResponse({ url, status, headers = {}, body = "" }) {
  const identity = canonicalizeWebUrl(url);
  const html = String(body || "");
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  const meta = [...html.matchAll(/<meta\s+[^>]*?(?:name|property)=["']([^"']+)["'][^>]*?content=["']([^"']*)["'][^>]*>/gi)]
    .slice(0, 100).map((item) => ({ name: item[1], content: decodeEntities(item[2]) }));
  const text = decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim().slice(0, 200_000);
  return {
    schema_version: "web_compatibility_ingest_v1",
    url: identity,
    http: { status: Number(status) || 0, content_type: String(headers["content-type"] || headers["Content-Type"] || "") },
    title, meta, json_ld: parseJsonLd(html), text,
    integrity: { body_sha256: sha256(html), json_ld_preserved: true, extracted_before_model: true },
  };
}

function cookiePairs(setCookie) {
  if (!setCookie) return [];
  const values = Array.isArray(setCookie) ? setCookie : [setCookie];
  return values.map((item) => String(item).split(";", 1)[0]).filter(Boolean);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function normalizedAllowedOrigins(values) {
  const result = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    let candidate;
    try { candidate = new URL(String(value || "")); } catch { fail("web_allowed_origin_invalid"); }
    if (!["http:", "https:"].includes(candidate.protocol) || candidate.username || candidate.password) {
      fail("web_allowed_origin_invalid");
    }
    result.add(candidate.origin);
  }
  return result;
}

function allowedIdentity(input, allowedOrigins) {
  const identity = canonicalizeWebUrl(input);
  const origin = new URL(identity.canonical_url).origin;
  if (!allowedOrigins.has(origin)) fail("web_origin_not_allowed");
  return { identity, origin };
}

function tenantScope(value) {
  const tenantId = String(value || "");
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(tenantId)) fail("web_tenant_invalid");
  return tenantId;
}

function callerHeaders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (value === undefined || value === null) return {};
    fail("web_headers_invalid");
  }
  const entries = Object.entries(value);
  if (entries.length > 30) fail("web_headers_invalid");
  const result = {};
  for (const [rawName, rawValue] of entries) {
    const name = String(rawName || "").trim().toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]{1,80}$/.test(name) ||
        FORBIDDEN_CALLER_HEADERS.has(name) ||
        typeof rawValue !== "string" || rawValue.length > 2_000 ||
        /[\r\n]/.test(rawValue)) {
      fail("web_header_not_allowed");
    }
    result[name] = rawValue;
  }
  return result;
}

function responseHeaders(headers) {
  try { return Object.fromEntries(headers || []); } catch { return {}; }
}

async function boundedResponseText(response, maximumBytes, setReader) {
  const declared = response?.headers?.get?.("content-length");
  if (declared !== null && declared !== undefined && declared !== "") {
    if (!/^\d+$/.test(String(declared)) || Number(declared) > maximumBytes) {
      fail("web_response_too_large");
    }
  }
  if (response?.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    setReader(reader);
    const chunks = [];
    let bytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      const chunk = Buffer.from(part.value);
      bytes += chunk.byteLength;
      if (bytes > maximumBytes) {
        void reader.cancel().catch(() => {});
        fail("web_response_too_large");
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, bytes).toString("utf8");
  }
  if (typeof response?.text !== "function") fail("web_response_invalid");
  const text = await response.text();
  if (Buffer.byteLength(String(text), "utf8") > maximumBytes) fail("web_response_too_large");
  return String(text);
}

function storeResponseCookies(jar, setCookie) {
  for (const pair of cookiePairs(setCookie)) {
    const separator = pair.indexOf("=");
    const key = separator < 1 ? "" : pair.slice(0, separator).trim();
    const value = separator < 1 ? "" : pair.slice(separator + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(key) || value.length > 4_096) continue;
    if (jar.has(key)) jar.delete(key);
    jar.set(key, value);
    while (jar.size > MAX_COOKIE_COUNT) jar.delete(jar.keys().next().value);
  }
}

export function createWebTransport({
  fetchImpl = globalThis.fetch,
  allowedOrigins = [],
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_RESPONSE_BYTES,
} = {}) {
  if (typeof fetchImpl !== "function") fail("web_fetch_unavailable");
  const allowed = normalizedAllowedOrigins(allowedOrigins);
  const timeoutMs = boundedInteger(requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 100, 60_000);
  const responseLimit = boundedInteger(maxResponseBytes, DEFAULT_RESPONSE_BYTES, 1_024, MAX_BODY_BYTES);
  const jars = new Map();
  return {
    async request({ tenantId, url, method = "GET", headers = {}, body }) {
      const tenant = tenantScope(tenantId);
      const { identity, origin } = allowedIdentity(url, allowed);
      const verb = String(method).toUpperCase();
      if (!SAFE_METHODS.has(verb)) fail("web_method_not_allowed");
      if (body !== undefined && Buffer.byteLength(String(body), "utf8") > MAX_BODY_BYTES) fail("web_body_too_large");
      const requestHeaders = callerHeaders(headers);
      const jarKey = `${tenant}\u0000${origin}`;
      const jar = jars.get(jarKey) || new Map();
      if (jar.size) requestHeaders.cookie = [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
      const controller = new AbortController();
      let reader = null;
      let timedOut = false;
      let timer;
      const operation = (async () => {
        const response = await fetchImpl(identity.canonical_url, {
          method: verb,
          headers: requestHeaders,
          body: body === undefined ? undefined : String(body),
          // Automatic redirects could escape the allowlist or carry the
          // server-owned cookie jar to a different origin. The caller may
          // explicitly request a returned allowlisted location instead.
          redirect: "manual",
          signal: controller.signal,
        });
        if (!response || !Number.isSafeInteger(Number(response.status))) fail("web_response_invalid");
        const responseUrl = response.url || identity.canonical_url;
        allowedIdentity(responseUrl, allowed);
        const responseBody = await boundedResponseText(response, responseLimit, (value) => { reader = value; });
        if (timedOut) fail("web_request_timeout");
        storeResponseCookies(jar, response.headers?.getSetCookie?.() || response.headers?.get?.("set-cookie"));
        jars.set(jarKey, jar);
        return {
          ...ingestStructuredWebResponse({
            url: responseUrl,
            status: response.status,
            headers: responseHeaders(response.headers),
            body: responseBody,
          }),
          request: {
            method: verb,
            cookie_sent: Boolean(requestHeaders.cookie),
            post_sent: ["POST", "PUT", "PATCH"].includes(verb),
            redirect_mode: "manual",
          },
          cookies: { stored: [...jar.keys()], count: jar.size },
        };
      })();
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          if (reader) void reader.cancel().catch(() => {});
          const error = new Error("web_request_timeout");
          error.code = "web_request_timeout";
          reject(error);
        }, timeoutMs);
      });
      try {
        return await Promise.race([operation, deadline]);
      } catch (error) {
        controller.abort();
        if (reader) void reader.cancel().catch(() => {});
        if (error?.code && /^web_[a-z0-9_]+$/.test(error.code)) throw error;
        if (error?.name === "AbortError" || timedOut) fail("web_request_timeout");
        fail("web_fetch_failed");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function webCompatibilityManifest() {
  return {
    branch_id: "web_compatibility",
    subbranches: ["browser_transport", "structured_ingest", "url_continuity"],
    capabilities: ["javascript_runtime_bridge", "cookie_jar", "retrieval_requests", "json_ld_preservation", "long_url_refs"],
    controls: ["tenant_bound", "core_gate_required", "allowlisted_origin", "read_only_http_methods", "audit_digest", "fail_closed"],
  };
}
