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

export function assertAllowedOrigin(url, allowedOrigins) {
  let target;
  try {
    target = new URL(String(url || ""));
  } catch {
    fail("web_url_invalid");
  }
  if (!['http:', 'https:'].includes(target.protocol)) fail("web_url_scheme_not_allowed");
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length) fail("web_allowed_origins_not_configured", 503);
  if (!allowedOrigins.includes(target.origin)) fail("web_origin_not_allowlisted", 403);
  return target;
}

export function assertScreenshotSize(screenshot) {
  if (!Buffer.isBuffer(screenshot) || screenshot.length > MAX_SCREENSHOT_BYTES) {
    fail("web_screenshot_too_large", 413);
  }
  return screenshot;
}
