import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeWebUrl, createWebTransport, ingestStructuredWebResponse, webCompatibilityManifest } from "../src/web-agent-compatibility.js";

test("preserves JSON-LD before model ingestion", () => {
  const result = ingestStructuredWebResponse({ url: "https://example.test/a", status: 200, headers: { "content-type": "text/html" }, body: '<title>Demo</title><script type="application/ld+json">{"@type":"Product","name":"X"}</script><p>Body</p>' });
  assert.equal(result.integrity.json_ld_preserved, true);
  assert.equal(result.json_ld[0].data.name, "X");
});

test("supports long URLs through a stable bounded reference", () => {
  const result = canonicalizeWebUrl(`https://example.test/search?q=${"x".repeat(400)}`);
  assert.equal(result.long_url, true);
  assert.match(result.url_ref, /^url_[a-f0-9]{32}$/);
});

test("carries cookies and executes POST through the governed transport", async () => {
  const calls = [];
  const transport = createWebTransport({ allowedOrigins: ["https://example.test"], fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { url, status: 200, headers: { getSetCookie: () => ["sid=abc; Path=/"] , [Symbol.iterator]: function*(){ yield ["content-type", "text/html"]; } }, text: async () => '<script type="application/ld+json">{"ok":true}</script>' };
  }});
  await transport.request({ url: "https://example.test/login", method: "POST", body: "a=1" });
  const result = await transport.request({ url: "https://example.test/private", method: "GET" });
  assert.equal(result.request.cookie_sent, true);
  assert.equal(calls[1].options.headers.cookie, "sid=abc");
  assert.equal(result.json_ld[0].data.ok, true);
});

test("exposes bounded compatibility branches", () => {
  assert.deepEqual(webCompatibilityManifest().subbranches, ["browser_transport", "structured_ingest", "url_continuity"]);
});

