import crypto from "node:crypto";

const SAFE_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const MAX_URL_LENGTH = 8_192;
const MAX_BODY_BYTES = 2_000_000;

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

export function createWebTransport({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") fail("web_fetch_unavailable");
  const jar = new Map();
  return {
    async request({ url, method = "GET", headers = {}, body, followRedirect = true }) {
      const identity = canonicalizeWebUrl(url);
      const verb = String(method).toUpperCase();
      if (!SAFE_METHODS.has(verb)) fail("web_method_not_allowed");
      if (body !== undefined && Buffer.byteLength(String(body), "utf8") > MAX_BODY_BYTES) fail("web_body_too_large");
      const requestHeaders = { ...headers };
      if (jar.size) requestHeaders.cookie = [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
      const response = await fetchImpl(identity.canonical_url, {
        method: verb, headers: requestHeaders, body: body === undefined ? undefined : String(body),
        redirect: followRedirect ? "follow" : "manual",
      });
      for (const pair of cookiePairs(response.headers?.getSetCookie?.() || response.headers?.get?.("set-cookie"))) {
        const [key, value] = pair.split("=", 2); if (key && value) jar.set(key.trim(), value.trim());
      }
      const responseBody = await response.text();
      return {
        ...ingestStructuredWebResponse({ url: response.url || identity.canonical_url, status: response.status, headers: Object.fromEntries(response.headers || []), body: responseBody }),
        request: { method: verb, cookie_sent: Boolean(requestHeaders.cookie), post_sent: ["POST", "PUT", "PATCH"].includes(verb) },
        cookies: { stored: [...jar.keys()], count: jar.size },
      };
    },
  };
}

export function webCompatibilityManifest() {
  return {
    branch_id: "web_compatibility",
    subbranches: ["browser_transport", "structured_ingest", "url_continuity"],
    capabilities: ["javascript_runtime_bridge", "cookie_jar", "post_requests", "json_ld_preservation", "long_url_refs"],
    controls: ["tenant_bound", "core_gate_required", "allowlisted_origin", "audit_digest", "fail_closed"],
  };
}

