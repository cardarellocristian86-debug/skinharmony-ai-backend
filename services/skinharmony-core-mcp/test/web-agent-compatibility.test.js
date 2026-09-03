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

test("carries cookies across retrieval requests through the governed transport", async () => {
  const calls = [];
  const transport = createWebTransport({ allowedOrigins: ["https://example.test"], fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { url, status: 200, headers: { getSetCookie: () => ["sid=abc; Path=/"] , [Symbol.iterator]: function*(){ yield ["content-type", "text/html"]; } }, text: async () => '<script type="application/ld+json">{"ok":true}</script>' };
  }});
  await transport.request({ tenantId: "tenant-a", url: "https://example.test/login", method: "GET" });
  const result = await transport.request({ tenantId: "tenant-a", url: "https://example.test/private", method: "GET" });
  assert.equal(result.request.cookie_sent, true);
  assert.equal(calls[1].options.headers.cookie, "sid=abc");
  assert.equal(calls[1].options.redirect, "manual");
  assert.equal(result.json_ld[0].data.ok, true);
});

test("rejects every mutating method before the external fetch", async () => {
  let calls = 0;
  const transport = createWebTransport({
    allowedOrigins: ["https://example.test"],
    fetchImpl: async () => { calls += 1; throw new Error("must not run"); },
  });
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    await assert.rejects(
      transport.request({ tenantId: "tenant-a", url: "https://example.test/action", method }),
      /web_method_not_allowed/,
    );
  }
  assert.equal(calls, 0);
});

test("fails closed outside the exact origin allowlist before fetch", async () => {
  let calls = 0;
  const transport = createWebTransport({
    allowedOrigins: ["https://example.test"],
    fetchImpl: async () => { calls += 1; throw new Error("must not run"); },
  });
  await assert.rejects(
    transport.request({ tenantId: "tenant-a", url: "https://unbound.test/private" }),
    /web_origin_not_allowed/,
  );
  assert.equal(calls, 0);
});

test("isolates the server cookie jar by tenant and exact origin", async () => {
  const calls = [];
  const transport = createWebTransport({
    allowedOrigins: ["https://example.test", "https://second.test"],
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        url,
        status: 200,
        headers: {
          getSetCookie: () => url.endsWith("/login") ? ["sid=tenant-a; Path=/"] : [],
          [Symbol.iterator]: function* () { yield ["content-type", "text/html"]; },
        },
        text: async () => "<p>ok</p>",
      };
    },
  });
  await transport.request({ tenantId: "tenant-a", url: "https://example.test/login" });
  const otherTenant = await transport.request({ tenantId: "tenant-b", url: "https://example.test/private" });
  const otherOrigin = await transport.request({ tenantId: "tenant-a", url: "https://second.test/private" });
  const sameScope = await transport.request({ tenantId: "tenant-a", url: "https://example.test/private" });
  assert.equal(otherTenant.request.cookie_sent, false);
  assert.equal(otherOrigin.request.cookie_sent, false);
  assert.equal(sameScope.request.cookie_sent, true);
  assert.equal(calls[3].options.headers.cookie, "sid=tenant-a");
});

test("rejects caller-owned credential and cookie headers", async () => {
  const transport = createWebTransport({
    allowedOrigins: ["https://example.test"],
    fetchImpl: async () => { throw new Error("must not run"); },
  });
  for (const headers of [{ authorization: "Bearer secret" }, { cookie: "sid=forged" }]) {
    await assert.rejects(
      transport.request({ tenantId: "tenant-a", url: "https://example.test", headers }),
      /web_header_not_allowed/,
    );
  }
});

test("bounds response bytes and the complete request deadline without retry", async () => {
  let oversizedCalls = 0;
  const oversized = createWebTransport({
    allowedOrigins: ["https://example.test"],
    maxResponseBytes: 1_024,
    fetchImpl: async (url) => {
      oversizedCalls += 1;
      return {
        url,
        status: 200,
        headers: { [Symbol.iterator]: function* () {} },
        text: async () => "x".repeat(1_025),
      };
    },
  });
  await assert.rejects(
    oversized.request({ tenantId: "tenant-a", url: "https://example.test" }),
    /web_response_too_large/,
  );
  assert.equal(oversizedCalls, 1);

  let timeoutCalls = 0;
  const timed = createWebTransport({
    allowedOrigins: ["https://example.test"],
    requestTimeoutMs: 100,
    fetchImpl: async () => {
      timeoutCalls += 1;
      return new Promise(() => {});
    },
  });
  await assert.rejects(
    timed.request({ tenantId: "tenant-a", url: "https://example.test" }),
    /web_request_timeout/,
  );
  assert.equal(timeoutCalls, 1);
});

test("exposes bounded compatibility branches", () => {
  assert.deepEqual(webCompatibilityManifest().subbranches, ["browser_transport", "structured_ingest", "url_continuity"]);
});
