import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SCREENSHOT_BYTES,
  assertAllowedOrigin,
  assertScreenshotSize,
  parseAllowedOrigins,
} from "../src/security.js";

test("requires a non-empty explicit browser origin allowlist", () => {
  assert.throws(() => parseAllowedOrigins(""), { code: "web_allowed_origins_not_configured", status: 503 });
});

test("allows only configured http(s) origins", () => {
  const origins = parseAllowedOrigins("https://skin.example,https://www.skin.example/path");
  assert.equal(assertAllowedOrigin("https://www.skin.example/article", origins).origin, "https://www.skin.example");
  assert.throws(() => assertAllowedOrigin("https://attacker.example", origins), { code: "web_origin_not_allowlisted", status: 403 });
  assert.throws(() => assertAllowedOrigin("file:///tmp/page", origins), { code: "web_url_scheme_not_allowed" });
});

test("rejects oversized gateway screenshots before base64 encoding", () => {
  assert.equal(assertScreenshotSize(Buffer.alloc(MAX_SCREENSHOT_BYTES)).length, MAX_SCREENSHOT_BYTES);
  assert.throws(() => assertScreenshotSize(Buffer.alloc(MAX_SCREENSHOT_BYTES + 1)), { code: "web_screenshot_too_large", status: 413 });
});
