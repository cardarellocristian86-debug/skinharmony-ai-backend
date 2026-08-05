import assert from "node:assert/strict";
import test from "node:test";

import { createAirlockTransport } from "../src/researchAirlock.js";

const lookupPublic = async () => [{ address: "23.1.2.3", family: 4 }];

test("transport pins validated DNS, follows bounded same-allowlist redirects and returns bytes only to Core", async () => {
  const calls = [];
  const target = createAirlockTransport({
    dnsLookup: lookupPublic,
    pinnedFetch: async (input) => {
      calls.push(input);
      if (calls.length === 1) return { redirect: true, status: 302, location: "https://docs.nist.gov/final" };
      return { ok: true, status: 200, contentType: "text/plain", bytes: Buffer.from("verified") };
    },
  });
  const result = await target.fetch({ url: "https://www.nist.gov/start", allowedDomains: ["nist.gov"] });
  assert.equal(result.bytes.toString(), "verified");
  assert.equal(result.redirect_chain.length, 1);
  assert.deepEqual(result.resolved_addresses, ["23.1.2.3"]);
  assert(calls.every((call) => call.method === "GET"));
});

test("transport rejects private DNS answers before any connection", async () => {
  for (const address of [
    "169.254.169.254",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b::0a00:0001",
    "64:ff9b::7f00:0001",
    "::ffff:169.254.169.254",
  ]) {
    let connected = false;
    const target = createAirlockTransport({
      dnsLookup: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
      pinnedFetch: async () => { connected = true; throw new Error("unexpected"); },
    });
    await assert.rejects(target.fetch({ url: "https://www.nist.gov/", allowedDomains: ["nist.gov"] }), /dns_address_rejected/, address);
    assert.equal(connected, false, address);
  }
});

test("transport rejects public redirect to an unapproved domain", async () => {
  const target = createAirlockTransport({
    dnsLookup: lookupPublic,
    pinnedFetch: async () => ({ redirect: true, status: 302, location: "https://attacker.example/collect" }),
  });
  await assert.rejects(target.fetch({ url: "https://www.nist.gov/", allowedDomains: ["nist.gov"] }), /redirect_rejected/);
});

test("transport rejects private literals, non-HTTPS, ports and unsupported content types", async () => {
  for (const url of ["https://127.0.0.1/", "http://www.nist.gov/", "https://www.nist.gov:8443/"]) {
    const target = createAirlockTransport({ dnsLookup: lookupPublic, pinnedFetch: async () => ({ ok: true, status: 200, contentType: "text/plain", bytes: Buffer.alloc(0) }) });
    await assert.rejects(target.fetch({ url, allowedDomains: ["nist.gov"] }), /source_url_rejected/);
  }
  const contentType = createAirlockTransport({
    dnsLookup: lookupPublic,
    pinnedFetch: async () => ({ ok: true, status: 200, contentType: "application/octet-stream", bytes: Buffer.alloc(1) }),
  });
  await assert.rejects(contentType.fetch({ url: "https://www.nist.gov/file", allowedDomains: ["nist.gov"] }), /content_type_rejected/);
});
