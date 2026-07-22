import assert from "node:assert/strict";
import test from "node:test";
import { issueOpenAiProviderSetupLink } from "../src/provider-setup-link-client.js";

const tenantId = "tenant-a";
const config = {
  universalCoreUrl: "https://core.example.test",
  universalCoreProviderSetupLinkKeys: { [tenantId]: "tenant-a-provider-link-key" },
};

function setupLinkPayload(overrides = {}) {
  return {
    ok: true,
    tenant_id: tenantId,
    setup_url: `https://core.example.test/v1/generic-agents/providers/openai/setup/${"a".repeat(32)}`,
    setup_proof: "p".repeat(40),
    link_id: `psl_${"l".repeat(24)}`,
    expires_at: "2030-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function issueWithResponse(payload, calls) {
  return issueOpenAiProviderSetupLink({
    config,
    tenantId,
    ownerContext: {
      assertion_version: "owner_context_assertion_v1",
      tenant_id: tenantId,
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
}

test("fails closed when Core returns a setup link bound to a different tenant", async () => {
  const calls = [];

  await assert.rejects(
    issueWithResponse(setupLinkPayload({ tenant_id: "tenant-b" }), calls),
    /provider_setup_link_tenant_mismatch/,
  );

  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].init.body).tenant_id, tenantId);
  assert.equal(calls[0].init.headers.authorization, "Bearer tenant-a-provider-link-key");
});

test("fails closed when Core omits the tenant binding from a setup link", async () => {
  const calls = [];
  const payload = setupLinkPayload();
  delete payload.tenant_id;

  await assert.rejects(
    issueWithResponse(payload, calls),
    /provider_setup_link_tenant_mismatch/,
  );

  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].init.body).tenant_id, tenantId);
});
