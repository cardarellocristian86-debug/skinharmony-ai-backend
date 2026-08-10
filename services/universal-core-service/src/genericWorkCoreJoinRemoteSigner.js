import crypto from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";

const DIGEST = /^[a-f0-9]{64}$/;
const SIGNATURE = /^[A-Za-z0-9_-]+$/;
const RESPONSE_FIELDS = ["algorithm", "digest", "key_id", "public_key_fingerprint", "schema_version", "signature"];
const PROBE_FIELDS = ["algorithm", "key_id", "nonce", "public_key_fingerprint", "purpose", "schema_version", "signature"];
function fail(code) { throw new Error(code); }
function exactObject(value, fields, code) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0")) fail(code); return value; }
function identifier(value, code) { const normalized = String(value || "").trim(); if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,159}$/.test(normalized)) fail(code); return normalized; }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function fingerprint(key) { return sha256(key.export({ type: "spki", format: "der" })); }
function verifierKey(value) { try { const key = value?.type === "public" ? value : crypto.createPublicKey(value); if (key.asymmetricKeyType !== "ed25519") fail("generic_work_core_join_remote_public_key_invalid"); return key; } catch { fail("generic_work_core_join_remote_public_key_invalid"); } }
function unsafeHost(hostname) { const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, ""); return !host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || net.isIP(host) !== 0; }
function canonicalUrl(value) { let parsed; try { parsed = new URL(String(value || "")); } catch { fail("generic_work_core_join_remote_url_invalid"); } if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || unsafeHost(parsed.hostname)) fail("generic_work_core_join_remote_url_invalid"); return parsed.toString(); }
function allowedEndpoint(value, allowedUrls) { const resolved = canonicalUrl(value); const allowed = new Set((Array.isArray(allowedUrls) ? allowedUrls : []).map(canonicalUrl)); if (!allowed.size || !allowed.has(resolved)) fail("generic_work_core_join_remote_url_not_allowed"); return resolved; }
function context(value) { exactObject(value, ["adapter", "idempotency_digest", "tenant_id", "work_id"], "generic_work_core_join_remote_context_invalid"); return { tenant_id: identifier(value.tenant_id, "generic_work_core_join_remote_context_invalid"), work_id: identifier(value.work_id, "generic_work_core_join_remote_context_invalid"), adapter: identifier(value.adapter, "generic_work_core_join_remote_context_invalid"), idempotency_digest: DIGEST.test(String(value.idempotency_digest || "")) ? value.idempotency_digest : fail("generic_work_core_join_remote_context_invalid") }; }
function trustedKeys(activeId, activeKey, supplied) { const entries = supplied && typeof supplied === "object" && !Array.isArray(supplied) ? Object.entries(supplied) : []; const keys = new Map(entries.map(([keyId, key]) => [identifier(keyId, "generic_work_core_join_remote_public_key_invalid"), verifierKey(key)])); if (keys.has(activeId) && fingerprint(keys.get(activeId)) !== fingerprint(activeKey)) fail("generic_work_core_join_remote_public_key_invalid"); keys.set(activeId, activeKey); return keys; }

function ipv4Number(address) {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}
function inV4Range(value, base, prefix) { const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0; return (value & mask) === (base & mask); }
function publicIpv4(address) {
  const value = ipv4Number(address); if (value === null) return false;
  return ![
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
    ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
    ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
  ].some(([base, prefix]) => inV4Range(value, ipv4Number(base), prefix));
}
function ipv6Words(address) {
  let source = address.toLowerCase().split("%")[0];
  const mapped = source.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) { const value = ipv4Number(mapped[2]); if (value === null) return null; source = `${mapped[1]}${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`; }
  if ((source.match(/::/g) || []).length > 1) return null;
  const halves = source.split("::"); const left = halves[0] ? halves[0].split(":") : []; const right = halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length; if (missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array(missing).fill("0"), ...right];
  if (words.length !== 8 || words.some((word) => !/^[a-f0-9]{1,4}$/.test(word))) return null;
  return words.map((word) => Number.parseInt(word, 16));
}
function ipv6Prefix(words, prefixWords, bits) {
  const full = Math.floor(bits / 16); const remaining = bits % 16;
  for (let index = 0; index < full; index += 1) if (words[index] !== prefixWords[index]) return false;
  if (!remaining) return true; const mask = (0xffff << (16 - remaining)) & 0xffff; return (words[full] & mask) === (prefixWords[full] & mask);
}
function publicIpv6(address) {
  const words = ipv6Words(address); if (!words) return false;
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (mapped) return publicIpv4(`${words[6] >>> 8}.${words[6] & 255}.${words[7] >>> 8}.${words[7] & 255}`);
  const global = (words[0] & 0xe000) === 0x2000; if (!global) return false;
  const denied = [
    ["2001::", 23], ["2001:db8::", 32], ["2002::", 16]
  ];
  return !denied.some(([base, bits]) => ipv6Prefix(words, ipv6Words(base), bits));
}
function publicAddress(address, family) { const detected = net.isIP(address); if (!detected || (family && Number(family) !== detected)) return false; return detected === 4 ? publicIpv4(address) : publicIpv6(address); }
async function resolvePinned(hostname, dnsLookup) {
  let records; try { records = await dnsLookup(hostname, { all: true, verbatim: true }); } catch { fail("generic_work_core_join_remote_dns_unavailable"); }
  if (!Array.isArray(records) || !records.length) fail("generic_work_core_join_remote_dns_denied");
  const unique = new Map();
  for (const record of records) {
    const address = String(record?.address || "").trim(); const family = Number(record?.family || net.isIP(address));
    if (!publicAddress(address, family)) fail("generic_work_core_join_remote_dns_denied");
    unique.set(`${family}:${address}`, Object.freeze({ address, family }));
  }
  return Object.freeze([...unique.values()]);
}
function pinnedLookup(hostname, expectedHostname, addresses) {
  return (requested, options, callback) => {
    if (requested !== hostname || requested !== expectedHostname) return callback(new Error("generic_work_core_join_remote_dns_pin_mismatch"));
    const normalized = typeof options === "number" ? { family: options } : (options || {}); const family = Number(normalized.family || 0);
    const candidates = family ? addresses.filter((entry) => entry.family === family) : addresses;
    if (!candidates.length) return callback(new Error("generic_work_core_join_remote_dns_pin_unavailable"));
    if (normalized.all) return callback(null, candidates.map((entry) => ({ ...entry })));
    return callback(null, candidates[0].address, candidates[0].family);
  };
}
function requestJson({ target, body, token, addresses, httpsRequest, timeoutMs, maxResponseBytes }) {
  const parsed = new URL(target); const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    let request; let settled = false; let size = 0; const chunks = [];
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
    const timer = setTimeout(() => { request?.destroy?.(); finish(new Error("generic_work_core_join_remote_unavailable")); }, timeoutMs);
    try {
      request = httpsRequest({
        protocol: "https:", hostname: parsed.hostname, servername: parsed.hostname, port: parsed.port || 443, path: parsed.pathname,
        method: "POST", rejectUnauthorized: true, lookup: pinnedLookup(parsed.hostname, parsed.hostname, addresses),
        headers: { accept: "application/json", authorization: `Bearer ${token}`, "content-type": "application/json", "content-length": payload.byteLength }
      }, (response) => {
        const status = Number(response?.statusCode || 0); const location = response?.headers?.location;
        if ((status >= 300 && status < 400) || location) { response?.resume?.(); finish(new Error("generic_work_core_join_remote_redirect_denied")); return; }
        if (status < 200 || status >= 300) { response?.resume?.(); finish(new Error("generic_work_core_join_remote_denied")); return; }
        const length = Number(response?.headers?.["content-length"] || 0);
        if (Number.isFinite(length) && length > maxResponseBytes) { request?.destroy?.(); finish(new Error("generic_work_core_join_remote_response_invalid")); return; }
        response.on("data", (chunk) => { if (settled) return; const part = Buffer.from(chunk); size += part.byteLength; if (size > maxResponseBytes) { request?.destroy?.(); finish(new Error("generic_work_core_join_remote_response_invalid")); return; } chunks.push(part); });
        response.once("end", () => { if (settled) return; try { finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { finish(new Error("generic_work_core_join_remote_response_invalid")); } });
        response.once("error", () => finish(new Error("generic_work_core_join_remote_unavailable")));
      });
      request.once?.("error", () => finish(new Error("generic_work_core_join_remote_unavailable")));
      request.write(payload); request.end();
    } catch { request?.destroy?.(); finish(new Error("generic_work_core_join_remote_unavailable")); }
  });
}

export function createRemoteGenericWorkCoreJoinSigner(configuration = {}, dependencies = {}) {
  const { url, healthUrl, allowedUrls, authToken, keyId, publicKey, trustedPublicKeys, timeoutMs = 5000, maxResponseBytes = 16 * 1024 } = configuration;
  if (["fetchImpl", "dnsLookup", "httpsRequest", "transport"].some((field) => Object.hasOwn(configuration, field))) fail("generic_work_core_join_remote_test_dependency_in_config");
  const dnsLookup = dependencies.dnsLookup || dns.lookup; const httpsRequest = dependencies.httpsRequest || https.request;
  if (typeof dnsLookup !== "function" || typeof httpsRequest !== "function") fail("generic_work_core_join_remote_transport_unavailable");
  const resolvedUrl = allowedEndpoint(url, allowedUrls); const resolvedHealthUrl = allowedEndpoint(healthUrl || url, allowedUrls);
  const resolvedKeyId = identifier(keyId, "generic_work_core_join_remote_key_id_invalid"); const token = String(authToken || "").trim(); if (!token || token.length > 8192) fail("generic_work_core_join_remote_auth_unavailable"); if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) fail("generic_work_core_join_remote_timeout_invalid"); if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 256 || maxResponseBytes > 16 * 1024) fail("generic_work_core_join_remote_response_limit_invalid");
  const activeKey = verifierKey(publicKey); const keys = trustedKeys(resolvedKeyId, activeKey, trustedPublicKeys); const activeFingerprint = fingerprint(activeKey);
  const request = async (target, body) => {
    const deadline = Date.now() + timeoutMs; const parsed = new URL(target);
    const addresses = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
      const timer = setTimeout(() => finish(new Error("generic_work_core_join_remote_unavailable")), timeoutMs);
      resolvePinned(parsed.hostname, dnsLookup).then((value) => finish(null, value), (error) => finish(error));
    });
    const remaining = deadline - Date.now(); if (remaining <= 0) fail("generic_work_core_join_remote_unavailable");
    try { return await requestJson({ target, body, token, addresses, httpsRequest, timeoutMs: remaining, maxResponseBytes }); } catch (error) { if (error?.message?.startsWith("generic_work_core_join_remote_")) throw error; fail("generic_work_core_join_remote_unavailable"); }
  };
  return Object.freeze({ algorithm: "Ed25519", key_id: resolvedKeyId, public_key: activeKey, public_key_fingerprint: activeFingerprint, custody: "external_remote_signer", resolvePublicKey(key) { const value = keys.get(identifier(key, "generic_work_core_join_remote_key_id_invalid")); if (!value) fail("generic_work_core_join_remote_key_untrusted"); return value; }, async probe() { const nonce = crypto.randomBytes(32).toString("base64url"); const result = await request(resolvedHealthUrl, { schema_version: "generic_work_core_join_probe_request_v1", purpose: "generic_work_core_join_remote_probe_v1", key_id: resolvedKeyId, nonce }); exactObject(result, PROBE_FIELDS, "generic_work_core_join_remote_probe_invalid"); if (result.schema_version !== "generic_work_core_join_probe_response_v1" || result.purpose !== "generic_work_core_join_remote_probe_v1" || result.key_id !== resolvedKeyId || result.nonce !== nonce || result.algorithm !== "Ed25519" || result.public_key_fingerprint !== activeFingerprint || !SIGNATURE.test(String(result.signature || "")) || !crypto.verify(null, Buffer.from(`generic_work_core_join_remote_probe_v1\0${nonce}`), activeKey, Buffer.from(result.signature, "base64url"))) fail("generic_work_core_join_remote_probe_invalid"); return Object.freeze({ key_id: resolvedKeyId, public_key_fingerprint: activeFingerprint }); }, async signDigest(value, suppliedContext) { const digest = String(value || ""); if (!DIGEST.test(digest)) fail("generic_work_core_join_remote_digest_invalid"); const bound = context(suppliedContext); const result = await request(resolvedUrl, { schema_version: "generic_work_core_join_sign_request_v1", purpose: "generic_work_core_join_v1", key_id: resolvedKeyId, digest, request_id: `gwcjs_${sha256(`${resolvedKeyId}\0${digest}`)}`, ...bound }); exactObject(result, RESPONSE_FIELDS, "generic_work_core_join_remote_response_invalid"); if (result.schema_version !== "generic_work_core_join_sign_response_v1" || result.algorithm !== "Ed25519" || result.key_id !== resolvedKeyId || result.digest !== digest || result.public_key_fingerprint !== activeFingerprint || !SIGNATURE.test(String(result.signature || "")) || !crypto.verify(null, Buffer.from(`generic_work_core_join_v1\0${digest}`), activeKey, Buffer.from(result.signature, "base64url"))) fail("generic_work_core_join_remote_signature_invalid"); return result.signature; } });
}
