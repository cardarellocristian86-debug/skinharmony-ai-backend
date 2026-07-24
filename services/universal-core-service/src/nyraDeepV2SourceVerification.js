import crypto from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const SOURCE_ID_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/i;
const MAX_SOURCES = 20;
const MAX_RESPONSE_BYTES = 250_000;
const MAX_TIMEOUT_MS = 8_000;
const MIN_TIMEOUT_MS = 500;
const MAX_CONCURRENCY = 3;
const RECEIPT_TTL_MS = 5 * 60_000;

const NON_PUBLIC_NETWORKS = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) NON_PUBLIC_NETWORKS.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["64:ff9b:1::", 48],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
]) NON_PUBLIC_NETWORKS.addSubnet(address, prefix, "ipv6");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function compactText(value, maximum) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text && text.length <= maximum ? text : "";
}

function publicHostname(value) {
  const host = String(value || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host.length > 253 || !host.includes(".")) return false;
  if (net.isIP(host) !== 0) return false;
  if (host === "localhost" || [".localhost", ".local", ".internal", ".home", ".lan", ".test", ".example", ".invalid", ".onion"].some((suffix) => host.endsWith(suffix))) {
    return false;
  }
  return host.split(".").every((label) => (
    label.length > 0
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ));
}

function normalizedSourceUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || (url.port && url.port !== "443")
      || !publicHostname(url.hostname)
    ) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function publicResolvedAddress(value) {
  const address = String(value || "").trim();
  const family = net.isIP(address);
  if (family === 0) return false;
  return !NON_PUBLIC_NETWORKS.check(address, family === 4 ? "ipv4" : "ipv6");
}

async function resolvePublicAddresses(hostname, lookup) {
  let result;
  try {
    result = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("nyra_deep_v2_source_dns_lookup_failed");
  }
  const records = Array.isArray(result) ? result : [result];
  const addresses = [...new Set(records
    .map((record) => String(record?.address || record || "").trim())
    .filter(Boolean))];
  if (addresses.length < 1) throw new Error("nyra_deep_v2_source_dns_empty");
  if (addresses.some((address) => !publicResolvedAddress(address))) {
    throw new Error("nyra_deep_v2_source_dns_address_rejected");
  }
  return addresses;
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name) || "";
  const value = headers?.[String(name).toLowerCase()] ?? headers?.[name];
  return Array.isArray(value) ? value.join(", ") : String(value || "");
}

async function boundedIncomingMessageBytes(message, maximum) {
  const advertised = Number(headerValue(message?.headers, "content-length") || 0);
  if (Number.isFinite(advertised) && advertised > maximum) {
    message?.destroy?.(new Error("nyra_deep_v2_source_content_too_large"));
    throw new Error("nyra_deep_v2_source_content_too_large");
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = (error, bytes = null) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(bytes);
    };
    message.on("data", (chunk) => {
      const bytes = Buffer.from(chunk);
      total += bytes.length;
      if (total > maximum) {
        const error = new Error("nyra_deep_v2_source_content_too_large");
        message.destroy(error);
        finish(error);
        return;
      }
      chunks.push(bytes);
    });
    message.once("end", () => finish(null, Buffer.concat(chunks, total)));
    message.once("aborted", () => finish(new Error("nyra_deep_v2_source_fetch_aborted")));
    message.once("error", (error) => finish(error));
  });
}

function requestPinnedAddress({ url, address, headers, signal }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request = null;
    const finish = (error, value = null) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.("abort", abort);
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => {
      const error = Object.assign(new Error("nyra_deep_v2_source_fetch_timeout"), { name: "AbortError" });
      request?.destroy(error);
      finish(error);
    };
    if (signal?.aborted) return abort();
    try {
      request = https.request({
        protocol: "https:",
        hostname: address,
        family: net.isIP(address),
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { ...headers, Host: url.host },
        servername: url.hostname,
        rejectUnauthorized: true,
        checkServerIdentity: (_host, certificate) => tls.checkServerIdentity(url.hostname, certificate),
        agent: false,
      }, (response) => {
        const remoteAddress = String(response.socket?.remoteAddress || "").replace(/^::ffff:/i, "");
        // The request target is the validated numeric address, so DNS cannot
        // be rebound between validation and connect. Reject any proxy or
        // socket outcome that still lands on a non-public peer.
        if (!publicResolvedAddress(remoteAddress)) {
          response.destroy(new Error("nyra_deep_v2_source_remote_address_rejected"));
          finish(new Error("nyra_deep_v2_source_remote_address_rejected"));
          return;
        }
        finish(null, response);
      });
      request.once("error", (error) => finish(error));
      signal?.addEventListener?.("abort", abort, { once: true });
      request.end();
    } catch (error) {
      finish(error);
    }
  });
}

async function pinnedPublicHttpsFetch({ url, addresses, headers, signal, maxBytes }) {
  let lastError = null;
  for (const address of addresses) {
    try {
      const response = await requestPinnedAddress({ url, address, headers, signal });
      const status = Number(response.statusCode || 0);
      const contentType = headerValue(response.headers, "content-type");
      if (status < 200 || status >= 300) {
        response.resume?.();
        return { ok: false, status, contentType, bytes: null };
      }
      return {
        ok: true,
        status,
        contentType,
        bytes: await boundedIncomingMessageBytes(response, maxBytes),
      };
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      lastError = error;
    }
  }
  throw lastError || new Error("nyra_deep_v2_source_fetch_failed");
}

function safeContentType(value) {
  const contentType = String(value || "").toLowerCase().split(";", 1)[0].trim();
  return contentType.startsWith("text/")
    || contentType === "application/json"
    || contentType === "application/ld+json"
    || contentType === "application/xml"
    || contentType === "text/xml";
}

async function boundedResponseBytes(response, maximum) {
  const advertised = Number(response.headers?.get?.("content-length") || 0);
  if (Number.isFinite(advertised) && advertised > maximum) throw new Error("nyra_deep_v2_source_content_too_large");
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maximum) throw new Error("nyra_deep_v2_source_content_too_large");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maximum) {
        try { await reader.cancel("nyra_deep_v2_source_content_too_large"); } catch {}
        throw new Error("nyra_deep_v2_source_content_too_large");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}

async function concurrentMap(values, maximum, worker) {
  const output = new Array(values.length);
  let cursor = 0;
  async function next() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      output[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(maximum, values.length) }, next));
  return output;
}

function receiptPayload({ sourceId, url, excerpt, body, contentType, observedAt, expiresAt }) {
  return {
    issuer: "skinharmony-universal-core",
    source_id: sourceId,
    source_url_sha256: sha256(url.toString()),
    content_sha256: sha256(body),
    excerpt_sha256: sha256(excerpt),
    content_type: contentType,
    fetched_at: new Date(observedAt).toISOString(),
    expires_at: new Date(expiresAt).toISOString(),
  };
}

/**
 * Performs a narrow, Core-owned source retrieval for Deep V2 evidence.
 * It never persists or returns source text. Callers receive only digests and
 * timestamps, which lets the Core prove that a reviewed excerpt was present
 * in the bytes it retrieved without turning Nyra into a web browser.
 */
export function createNyraDeepV2SourceVerifier({
  fetchImpl = null,
  dnsLookup = dns.lookup,
  pinnedFetch = pinnedPublicHttpsFetch,
  now = () => Date.now(),
  timeoutMs = 5_000,
  maxBytes = MAX_RESPONSE_BYTES,
  receiptTtlMs = RECEIPT_TTL_MS,
} = {}) {
  if (fetchImpl !== null && typeof fetchImpl !== "function") throw new TypeError("nyra_deep_v2_source_fetch_invalid");
  if (typeof dnsLookup !== "function") throw new TypeError("nyra_deep_v2_source_dns_lookup_required");
  if (typeof pinnedFetch !== "function") throw new TypeError("nyra_deep_v2_source_pinned_fetch_required");
  const boundedTimeout = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Number(timeoutMs) || 5_000));
  const boundedBytes = Math.max(1_024, Math.min(MAX_RESPONSE_BYTES, Number(maxBytes) || MAX_RESPONSE_BYTES));
  const boundedTtl = Math.max(30_000, Math.min(RECEIPT_TTL_MS, Number(receiptTtlMs) || RECEIPT_TTL_MS));

  async function verifyOne(source) {
    const sourceId = String(source?.id || "").trim();
    const url = normalizedSourceUrl(source?.url);
    const excerpt = compactText(source?.excerpt, 1_200);
    if (!SOURCE_ID_PATTERN.test(sourceId)) return { ok: false, source_id: sourceId || null, reason: "nyra_deep_v2_source_id_invalid" };
    if (!url) return { ok: false, source_id: sourceId, reason: "nyra_deep_v2_source_url_rejected" };
    if (excerpt.length < 16) return { ok: false, source_id: sourceId, reason: "nyra_deep_v2_source_excerpt_required" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), boundedTimeout);
    const headers = { Accept: "text/html, text/plain, application/json, application/xml;q=0.8" };
    try {
      const addresses = await resolvePublicAddresses(url.hostname, dnsLookup);
      let contentType = "";
      let bytes = null;
      if (fetchImpl) {
        // This is an explicit Core-owned test/integration hook. Production
        // uses the pinned HTTPS transport below; caller input never selects a
        // transport or a resolved address.
        const response = await fetchImpl(url.toString(), {
          method: "GET",
          redirect: "error",
          cache: "no-store",
          credentials: "omit",
          headers,
          signal: controller.signal,
        });
        if (!response?.ok) return { ok: false, source_id: sourceId, reason: "nyra_deep_v2_source_fetch_rejected" };
        contentType = String(headerValue(response.headers, "content-type")).toLowerCase();
        bytes = await boundedResponseBytes(response, boundedBytes);
      } else {
        const response = await pinnedFetch({
          url,
          addresses,
          headers,
          signal: controller.signal,
          maxBytes: boundedBytes,
        });
        if (response?.ok !== true) return { ok: false, source_id: sourceId, reason: "nyra_deep_v2_source_fetch_rejected" };
        contentType = String(response.contentType || "").toLowerCase();
        bytes = response.bytes;
      }
      if (!safeContentType(contentType)) return { ok: false, source_id: sourceId, reason: "nyra_deep_v2_source_content_type_rejected" };
      if (!Buffer.isBuffer(bytes)) return { ok: false, source_id: sourceId, reason: "nyra_deep_v2_source_fetch_rejected" };
      const body = bytes.toString("utf8");
      // The excerpt is user-reviewed, but it becomes evidence only after the
      // Core proves it occurred in the fetched bytes. No fetched body leaves
      // this function or is stored in the V2 ledger.
      const searchableText = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
      if (!searchableText.includes(excerpt)) {
        return { ok: false, source_id: sourceId, reason: "nyra_deep_v2_source_excerpt_not_verified" };
      }
      const observedAt = Number(now());
      const receipt = receiptPayload({
        sourceId,
        url,
        excerpt,
        body: bytes,
        contentType: contentType.split(";", 1)[0],
        observedAt,
        expiresAt: observedAt + boundedTtl,
      });
      return { ok: true, source_id: sourceId, receipt };
    } catch (error) {
      return {
        ok: false,
        source_id: sourceId,
        reason: error?.name === "AbortError" ? "nyra_deep_v2_source_fetch_timeout" : String(error?.message || "nyra_deep_v2_source_fetch_failed").slice(0, 120),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function verifySources(sources) {
    if (!Array.isArray(sources) || sources.length < 1 || sources.length > MAX_SOURCES) {
      return { ok: false, reason: "nyra_deep_v2_sources_invalid", receipts: [], rejected: [] };
    }
    const results = await concurrentMap(sources, MAX_CONCURRENCY, verifyOne);
    const receipts = results.filter((item) => item.ok).map((item) => item.receipt);
    const rejected = results.filter((item) => !item.ok).map((item) => ({ source_id: item.source_id, reason: item.reason }));
    if (rejected.length > 0 || receipts.length !== sources.length) {
      return { ok: false, reason: "nyra_deep_v2_source_verification_failed", receipts: [], rejected };
    }
    return { ok: true, receipts, rejected: [] };
  }

  return Object.freeze({ verifySources });
}
