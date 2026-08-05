import net from "node:net";
import { lookup } from "node:dns/promises";

export const MAX_SCREENSHOT_BYTES = 1_500_000;

function fail(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

export function parseAllowedOrigins(value) {
  const entries = String(value || "").split(",").map((origin) => origin.trim()).filter(Boolean);
  if (!entries.length) fail("web_allowed_origins_not_configured", 503);
  return entries.map((origin) => {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      fail("web_allowed_origins_invalid", 500);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) fail("web_allowed_origins_invalid", 500);
    return parsed.origin;
  });
}

function targetUrl(url) {
  let target;
  try {
    target = new URL(String(url || ""));
  } catch {
    fail("web_url_invalid");
  }
  if (!['http:', 'https:'].includes(target.protocol)) fail("web_url_scheme_not_allowed");
  if (target.username || target.password) fail("web_url_credentials_not_allowed");
  return target;
}

function privateIpv4(value) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19));
}

function privateIp(value) {
  const family = net.isIP(value);
  if (family === 4) return privateIpv4(value);
  if (family !== 6) return true;
  const normalized = value.toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
    normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

async function assertPublicHost(target) {
  const hostname = target.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) fail("web_private_network_not_allowed", 403);
  const directFamily = net.isIP(hostname);
  if (directFamily) {
    if (privateIp(hostname)) fail("web_private_network_not_allowed", 403);
    return target;
  }
  let records;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    fail("web_host_resolution_failed", 422);
  }
  if (!records.length || records.some((record) => privateIp(record.address))) fail("web_private_network_not_allowed", 403);
  return target;
}

export function assertAllowedOrigin(url, allowedOrigins) {
  const target = targetUrl(url);
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length) fail("web_allowed_origins_not_configured", 503);
  if (!allowedOrigins.includes(target.origin)) fail("web_origin_not_allowlisted", 403);
  return target;
}

export async function assertPermittedWebTarget(url, allowedOrigins, { allowDynamicPublicOrigins = false, allowPrivateTestTargets = false } = {}) {
  const target = targetUrl(url);
  const staticallyAllowed = Array.isArray(allowedOrigins) && allowedOrigins.includes(target.origin);
  if (!staticallyAllowed && allowDynamicPublicOrigins !== true) {
    fail("web_origin_not_allowlisted", 403);
  }
  if (!staticallyAllowed && (!Array.isArray(allowedOrigins) || !allowedOrigins.length) && allowDynamicPublicOrigins !== true) {
    fail("web_allowed_origins_not_configured", 503);
  }
  // This exists solely for the in-process acceptance fixture.  Production
  // callers never set it, so loopback and private-network SSRF protection is
  // unchanged in every deployed environment.
  return allowPrivateTestTargets === true ? target : assertPublicHost(target);
}

export function assertScreenshotSize(screenshot) {
  if (!Buffer.isBuffer(screenshot) || screenshot.length > MAX_SCREENSHOT_BYTES) {
    fail("web_screenshot_too_large", 413);
  }
  return screenshot;
}
