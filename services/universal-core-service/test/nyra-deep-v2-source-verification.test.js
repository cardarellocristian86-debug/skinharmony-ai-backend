import assert from "node:assert/strict";
import test from "node:test";
import { createNyraDeepV2SourceVerifier } from "../src/nyraDeepV2SourceVerification.js";

const NOW = 1_780_000_000_000;
const BRANCH_ID = "research_evidence";
const SOURCE_URL = "https://www.nist.gov/example-evidence";
const NIST_ROOT_URL = "https://nist.gov/example-evidence";
const EXCERPT = "Verified source excerpt supports the bounded claim.";
const PUBLIC_DNS_LOOKUP = async () => [{ address: "93.184.216.34", family: 4 }];
const NIST_SOURCE = Object.freeze({
  source_id: "nist",
  status: "active",
  source_type: "official_documentation",
  reliability_score: 0.95,
  allowed_domains: Object.freeze(["nist.gov"]),
  allowed_operations: Object.freeze(["search", "fetch_document"]),
});
const NIST_SOURCE_REGISTRY = Object.freeze({
  branch_source_policy: Object.freeze({
    fail_closed_on_unknown_source: true,
  }),
  sources: Object.freeze([NIST_SOURCE]),
  branch_bindings: Object.freeze({
    [BRANCH_ID]: Object.freeze(["nist"]),
  }),
});

function nistSourceRegistry(sourceOverrides = {}) {
  return {
    branch_source_policy: {
      fail_closed_on_unknown_source: true,
    },
    sources: [{
      ...NIST_SOURCE,
      ...sourceOverrides,
    }],
    branch_bindings: {
      [BRANCH_ID]: ["nist"],
    },
  };
}

test("Core source verifier requires a valid fail-closed source registry", () => {
  assert.throws(
    () => createNyraDeepV2SourceVerifier(),
    /nyra_deep_v2_source_registry_invalid/,
  );
  assert.throws(
    () => createNyraDeepV2SourceVerifier({
      sourceRegistry: {
        ...NIST_SOURCE_REGISTRY,
        branch_source_policy: { fail_closed_on_unknown_source: false },
      },
    }),
    /nyra_deep_v2_source_registry_invalid/,
  );
  assert.throws(
    () => createNyraDeepV2SourceVerifier({
      sourceRegistry: {
        branch_source_policy: { fail_closed_on_unknown_source: true },
        sources: "nist",
      },
    }),
    /nyra_deep_v2_source_registry_invalid/,
  );
});

test("Core source verifier issues only digest receipts after retrieving the reviewed excerpt", async () => {
  let requested;
  const verifier = createNyraDeepV2SourceVerifier({
    sourceRegistry: NIST_SOURCE_REGISTRY,
    now: () => NOW,
    dnsLookup: PUBLIC_DNS_LOOKUP,
    fetchImpl: async (url, options) => {
      requested = { url, options };
      return new Response(`<html><body>${EXCERPT}</body></html>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });
  const result = await verifier.verifySources([{
    id: "source_a",
    registry_source_id: "nist",
    url: SOURCE_URL,
    excerpt: EXCERPT,
  }], { branchId: BRANCH_ID });

  assert.equal(result.ok, true);
  assert.equal(requested.url, SOURCE_URL);
  assert.equal(requested.options.redirect, "error");
  assert.equal(requested.options.credentials, "omit");
  assert.deepEqual(Object.keys(result.receipts[0]).sort(), [
    "content_sha256",
    "content_type",
    "excerpt_sha256",
    "expires_at",
    "fetched_at",
    "issuer",
    "registry_source_id",
    "reliability_score",
    "source_id",
    "source_type",
    "source_url_sha256",
  ]);
  assert.match(result.receipts[0].content_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.receipts[0].issuer, "skinharmony-universal-core");
  assert.equal(result.receipts[0].source_id, "source_a");
  assert.equal(result.receipts[0].registry_source_id, "nist");
  assert.equal(result.receipts[0].source_type, "official");
  assert.equal(result.receipts[0].reliability_score, 0.95);
  assert.equal(JSON.stringify(result).includes(EXCERPT), false);
  assert.equal(JSON.stringify(result).includes(SOURCE_URL), false);
});

test("Core source verifier fails closed for an unverified excerpt or non-public source", async () => {
  let calls = 0;
  const verifier = createNyraDeepV2SourceVerifier({
    sourceRegistry: NIST_SOURCE_REGISTRY,
    now: () => NOW,
    dnsLookup: PUBLIC_DNS_LOOKUP,
    fetchImpl: async () => {
      calls += 1;
      return new Response("Different fetched source text", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    },
  });

  const mismatch = await verifier.verifySources([{
    id: "source_a",
    url: NIST_ROOT_URL,
    excerpt: EXCERPT,
  }], { branchId: BRANCH_ID });
  assert.equal(mismatch.ok, false);
  assert.deepEqual(mismatch.rejected, [{ source_id: "source_a", reason: "nyra_deep_v2_source_excerpt_not_verified" }]);

  const privateSource = await verifier.verifySources([{
    id: "source_b",
    url: "https://127.0.0.1/internal",
    excerpt: EXCERPT,
  }], { branchId: BRANCH_ID });
  assert.equal(privateSource.ok, false);
  assert.deepEqual(privateSource.rejected, [{ source_id: "source_b", reason: "nyra_deep_v2_source_url_rejected" }]);
  assert.equal(calls, 1);
});

test("Core source verifier resolves public addresses before transport and pins the resolved target", async () => {
  let pinned;
  const verifier = createNyraDeepV2SourceVerifier({
    sourceRegistry: NIST_SOURCE_REGISTRY,
    now: () => NOW,
    dnsLookup: async (hostname, options) => {
      assert.equal(hostname, "www.nist.gov");
      assert.deepEqual(options, { all: true, verbatim: true });
      return [{ address: "93.184.216.34", family: 4 }];
    },
    pinnedFetch: async (input) => {
      pinned = input;
      return {
        ok: true,
        contentType: "text/html; charset=utf-8",
        bytes: Buffer.from(`<html><body>${EXCERPT}</body></html>`),
      };
    },
  });

  const result = await verifier.verifySources([{
    id: "source_a",
    url: SOURCE_URL,
    excerpt: EXCERPT,
  }], { branchId: BRANCH_ID });
  assert.equal(result.ok, true);
  assert.equal(pinned.url.toString(), SOURCE_URL);
  assert.deepEqual(pinned.addresses, ["93.184.216.34"]);
  assert.equal(pinned.maxBytes, 250_000);
});

test("Core source verifier rejects private DNS answers before a caller-controlled transport can run", async () => {
  let calls = 0;
  const verifier = createNyraDeepV2SourceVerifier({
    sourceRegistry: NIST_SOURCE_REGISTRY,
    now: () => NOW,
    dnsLookup: async () => [{ address: "10.0.0.8", family: 4 }],
    fetchImpl: async () => {
      calls += 1;
      return new Response(EXCERPT, { status: 200, headers: { "content-type": "text/plain" } });
    },
  });
  const result = await verifier.verifySources([{
    id: "source_a",
    url: SOURCE_URL,
    excerpt: EXCERPT,
  }], { branchId: BRANCH_ID });
  assert.equal(result.ok, false);
  assert.deepEqual(result.rejected, [{ source_id: "source_a", reason: "nyra_deep_v2_source_dns_address_rejected" }]);
  assert.equal(calls, 0);
});

test("Core source verifier rejects a mixed DNS set when any answer is non-public", async () => {
  let calls = 0;
  const verifier = createNyraDeepV2SourceVerifier({
    sourceRegistry: NIST_SOURCE_REGISTRY,
    now: () => NOW,
    dnsLookup: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ],
    pinnedFetch: async () => {
      calls += 1;
      return { ok: true, contentType: "text/plain", bytes: Buffer.from(EXCERPT) };
    },
  });
  const result = await verifier.verifySources([{
    id: "source_a",
    url: SOURCE_URL,
    excerpt: EXCERPT,
  }], { branchId: BRANCH_ID });
  assert.equal(result.ok, false);
  assert.deepEqual(result.rejected, [{ source_id: "source_a", reason: "nyra_deep_v2_source_dns_address_rejected" }]);
  assert.equal(calls, 0);
});

test("Core source verifier rejects an unregistered domain before DNS or fetch", async () => {
  let dnsCalls = 0;
  let fetchCalls = 0;
  const verifier = createNyraDeepV2SourceVerifier({
    sourceRegistry: NIST_SOURCE_REGISTRY,
    dnsLookup: async () => {
      dnsCalls += 1;
      return PUBLIC_DNS_LOOKUP();
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(EXCERPT, { status: 200, headers: { "content-type": "text/plain" } });
    },
  });
  const result = await verifier.verifySources([{
    id: "source_external",
    url: "https://nist.gov.attacker.org/example-evidence",
    excerpt: EXCERPT,
  }], { branchId: BRANCH_ID });

  assert.equal(result.ok, false);
  assert.deepEqual(result.rejected, [{
    source_id: "source_external",
    reason: "nyra_deep_v2_source_registry_rejected",
  }]);
  assert.equal(dnsCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("Core source verifier accepts only active fetch-capable registry sources with allowed domains", async () => {
  for (const [label, sourceOverrides] of [
    ["inactive", { status: "disabled" }],
    ["missing fetch capability", { allowed_operations: ["search"] }],
    ["missing allowed domain", { allowed_domains: [] }],
  ]) {
    let dnsCalls = 0;
    const verifier = createNyraDeepV2SourceVerifier({
      sourceRegistry: nistSourceRegistry(sourceOverrides),
      dnsLookup: async () => {
        dnsCalls += 1;
        return PUBLIC_DNS_LOOKUP();
      },
      fetchImpl: async () => new Response(EXCERPT, {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    });
    const result = await verifier.verifySources([{
      id: "source_a",
      registry_source_id: "nist",
      url: SOURCE_URL,
      excerpt: EXCERPT,
    }], { branchId: BRANCH_ID });

    assert.equal(result.ok, false, label);
    assert.deepEqual(result.rejected, [{
      source_id: "source_a",
      reason: "nyra_deep_v2_source_registry_rejected",
    }], label);
    assert.equal(dnsCalls, 0, label);
  }
});

test("Core source verifier enforces registry branch bindings before DNS or fetch", async () => {
  let dnsCalls = 0;
  const verifier = createNyraDeepV2SourceVerifier({
    sourceRegistry: NIST_SOURCE_REGISTRY,
    dnsLookup: async () => {
      dnsCalls += 1;
      return PUBLIC_DNS_LOOKUP();
    },
    fetchImpl: async () => new Response(EXCERPT, {
      status: 200,
      headers: { "content-type": "text/plain" },
    }),
  });
  const result = await verifier.verifySources([{
    id: "source_a",
    registry_source_id: "nist",
    url: SOURCE_URL,
    excerpt: EXCERPT,
  }], { branchId: "agent_orchestration" });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "nyra_deep_v2_source_branch_binding_rejected");
  assert.equal(dnsCalls, 0);
});
