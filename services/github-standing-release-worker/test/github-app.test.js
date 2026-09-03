import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import test from "node:test";
import {
  createGitHubAppJwt,
  createGitHubInstallationTokenResolver,
  parseGitHubAppBindings,
  resolveGitHubAppBinding,
  validateExecutionClaimShape,
} from "../src/githubApp.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });

function registry() {
  return {
    schema_version: "github_app_tenant_bindings_v1",
    bindings: [
      { tenant_id: "codexai", installation_id: 153760356, repositories: ["cardarellocristian86-debug/skinharmony-ai-backend"] },
      { tenant_id: "customer-a", installation_id: 200, repositories: ["customer/example"] },
    ],
  };
}

test("bindings isolate tenant, installation and exact repository", () => {
  const parsed = parseGitHubAppBindings(registry());
  assert.equal(resolveGitHubAppBinding(parsed, {
    tenant_id: "customer-a", repository: "customer/example",
  }).installation_id, 200);
  assert.throws(() => resolveGitHubAppBinding(parsed, {
    tenant_id: "customer-a", repository: "cardarellocristian86-debug/skinharmony-ai-backend",
  }), /github_app_repository_not_authorized/);
  assert.throws(() => parseGitHubAppBindings({
    ...registry(), bindings: [...registry().bindings, { tenant_id: "customer-b", installation_id: 200, repositories: ["customer/other"] }],
  }), /github_app_binding_duplicate/);
});

test("App JWT is short lived, RS256 signed and contains only the App identity", () => {
  const token = createGitHubAppJwt({ app_id: 4596254, private_key: privatePem, now: 1_700_000_000_000 });
  const [header, payload, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url")), { iat: 1699999970, exp: 1700000540, iss: "4596254" });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  verifier.end();
  assert.equal(verifier.verify(publicKey, Buffer.from(signature, "base64url")), true);
});

test("installation token request is fixed to GitHub and one authorized repository", async () => {
  const calls = [];
  const resolver = createGitHubInstallationTokenResolver({
    app_id: 4596254,
    private_key: privatePem,
    bindings: registry(),
    now: () => 1_700_000_000_000,
    fetch_impl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { token: "installation-token-not-a-real-secret", expires_at: "2023-11-14T23:13:20.000Z", repositories: [{ full_name: "customer/example" }] };
        },
      };
    },
  });
  const first = await resolver({ tenant_id: "customer-a", repository: "customer/example" });
  const second = await resolver({ tenant_id: "customer-a", repository: "customer/example" });
  assert.equal(first, second);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/app/installations/200/access_tokens");
  assert.deepEqual(JSON.parse(calls[0].options.body), { repositories: ["example"], permissions: {} });
  assert.match(calls[0].options.headers.authorization, /^Bearer /);
  await assert.rejects(
    resolver({ tenant_id: "customer-a", repository: "other/private" }),
    /github_app_repository_not_authorized/,
  );
});

test("installation token request aborts at its deadline and rejects oversized JSON", async () => {
  let observedSignal = null;
  const timed = createGitHubInstallationTokenResolver({
    app_id: 4596254,
    private_key: privatePem,
    bindings: registry(),
    now: () => 1_700_000_000_000,
    request_timeout_ms: 10,
    fetch_impl: async (_url, options) => {
      observedSignal = options.signal;
      return new Promise(() => {});
    },
  });
  await assert.rejects(
    timed({ tenant_id: "customer-a", repository: "customer/example" }),
    (error) => error.code === "github_api_request_timeout" && error.status === 504,
  );
  assert.equal(observedSignal?.aborted, true);

  const oversized = createGitHubInstallationTokenResolver({
    app_id: 4596254,
    private_key: privatePem,
    bindings: registry(),
    now: () => 1_700_000_000_000,
    response_limit_bytes: 64,
    fetch_impl: async () => new Response(JSON.stringify({ payload: "x".repeat(256) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  await assert.rejects(
    oversized({ tenant_id: "customer-a", repository: "customer/example" }),
    (error) => error.code === "github_api_response_too_large" && error.status === 502,
  );
});

test("execution claim rejects caller authority and malformed bindings", () => {
  const claim = validateExecutionClaimShape({
    schema_version: "standing_release_execution_claim_v1",
    tenant_id: "customer-a",
    repository: "customer/example",
    ticket_id: "ticket-12345678",
    action_digest: "a".repeat(64),
    expires_at: "2026-08-14T20:00:00.000Z",
  });
  assert.equal(claim.repository, "customer/example");
  assert.throws(() => validateExecutionClaimShape({ ...claim, token: "caller-token" }), /github_worker_claim_invalid/);
  assert.throws(() => parseGitHubAppBindings({ ...registry(), caller_override_allowed: true }), /github_app_bindings_invalid/);
});
