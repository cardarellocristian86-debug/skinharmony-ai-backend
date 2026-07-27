import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  discoverMcpStagingPrivateTrust,
  fetchMcpStagingPrivateJwks,
} from "../src/privateJwksClient.js";

const TARGET_COMMIT = "a".repeat(40);
const TOKEN = "private-jwks-token-test-only-0123456789abcdef";

function authority(mode) {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const exported = publicKey.export({ format: "jwk" });
  const kid = `ed25519-sha256:${crypto.createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("hex")}`;
  const jwk = {
    alg: "EdDSA",
    crv: "Ed25519",
    kid,
    kty: "OKP",
    use: "sig",
    x: exported.x,
  };
  return {
    jwk,
    document: {
      schema_version: "mcp_staging_private_jwks_v1",
      issuer: mode === "core" ? "universal-core-staging" : "nyra-staging",
      target_service: "skinharmony-core-mcp-staging",
      target_environment: "staging",
      target_commit: TARGET_COMMIT,
      keys: [jwk],
    },
  };
}

function response(document, init = {}) {
  return new Response(JSON.stringify(document), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });
}

test("discovers two independent Ed25519 anchors only from exact private endpoints", async () => {
  const core = authority("core");
  const nyra = authority("nyra");
  const calls = [];
  const trust = await discoverMcpStagingPrivateTrust({
    targetCommit: TARGET_COMMIT,
    coreHostport: "skinharmony-core-staging-issuer:8789",
    nyraHostport: "skinharmony-nyra-staging-issuer:8789",
    coreToken: TOKEN,
    nyraToken: `${TOKEN}-nyra`,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(url.includes("core-staging") ? core.document : nyra.document);
    },
    sleep: async () => {},
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ url }) => url).sort(), [
    "http://skinharmony-core-staging-issuer:8789/.well-known/jwks.json",
    "http://skinharmony-nyra-staging-issuer:8789/.well-known/jwks.json",
  ]);
  assert(calls.every(({ init }) => init.redirect === "error"));
  assert.equal(calls[0].init.headers.authorization.startsWith("Bearer "), true);
  assert.notEqual(trust.core.kid, trust.nyra.kid);
  assert.match(trust.core.jwkDigest, /^[a-f0-9]{64}$/);
  assert.equal("d" in trust.core.jwk, false);
});

test("retries bounded unavailability but does not retry an authentication rejection", async () => {
  const core = authority("core");
  let attempts = 0;
  const discovered = await fetchMcpStagingPrivateJwks({
    authority: "core",
    hostport: "skinharmony-core-staging-issuer:8789",
    token: TOKEN,
    targetCommit: TARGET_COMMIT,
    attempts: 3,
    fetchImpl: async () => {
      attempts += 1;
      return attempts < 3 ? response({}, { status: 503 }) : response(core.document);
    },
    sleep: async () => {},
  });
  assert.equal(attempts, 3);
  assert.equal(discovered.kid, core.jwk.kid);

  attempts = 0;
  await assert.rejects(fetchMcpStagingPrivateJwks({
    authority: "core",
    hostport: "skinharmony-core-staging-issuer:8789",
    token: TOKEN,
    targetCommit: TARGET_COMMIT,
    attempts: 3,
    fetchImpl: async () => {
      attempts += 1;
      return response({}, { status: 401 });
    },
    sleep: async () => {},
  }), /mcp_staging_private_jwks_rejected/);
  assert.equal(attempts, 1);
});

test("fails closed on endpoint substitution, metadata drift and non-public JWK material", async () => {
  const core = authority("core");
  await assert.rejects(fetchMcpStagingPrivateJwks({
    authority: "core",
    hostport: "attacker:8789",
    token: TOKEN,
    targetCommit: TARGET_COMMIT,
    fetchImpl: async () => response(core.document),
  }), /mcp_staging_private_jwks_endpoint_invalid/);

  await assert.rejects(fetchMcpStagingPrivateJwks({
    authority: "core",
    hostport: "skinharmony-core-staging-issuer:8789",
    token: TOKEN,
    targetCommit: TARGET_COMMIT,
    fetchImpl: async () => response({ ...core.document, target_commit: "b".repeat(40) }),
  }), /mcp_staging_private_jwks_document_invalid/);

  await assert.rejects(fetchMcpStagingPrivateJwks({
    authority: "core",
    hostport: "skinharmony-core-staging-issuer:8789",
    token: TOKEN,
    targetCommit: TARGET_COMMIT,
    fetchImpl: async () => response({
      ...core.document,
      keys: [{ ...core.jwk, d: "private-material-forbidden" }],
    }),
  }), /mcp_staging_private_jwks_key_invalid/);
});

test("rejects oversized or non-JSON responses before parsing", async () => {
  await assert.rejects(fetchMcpStagingPrivateJwks({
    authority: "nyra",
    hostport: "skinharmony-nyra-staging-issuer:8789",
    token: TOKEN,
    targetCommit: TARGET_COMMIT,
    fetchImpl: async () => new Response("{}", {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": "9000",
      },
    }),
  }), /mcp_staging_private_jwks_response_too_large/);

  await assert.rejects(fetchMcpStagingPrivateJwks({
    authority: "nyra",
    hostport: "skinharmony-nyra-staging-issuer:8789",
    token: TOKEN,
    targetCommit: TARGET_COMMIT,
    fetchImpl: async () => new Response("not-json", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }),
  }), /mcp_staging_private_jwks_content_type_invalid/);
});
