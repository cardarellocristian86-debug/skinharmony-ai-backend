import crypto from "node:crypto";

const MAX_RESPONSE_BYTES = 8_192;
const MAX_ATTEMPTS = 12;
const EXPECTED = Object.freeze({
  core: Object.freeze({
    hostport: "skinharmony-core-staging-issuer:8789",
    issuer: "universal-core-staging",
  }),
  nyra: Object.freeze({
    hostport: "skinharmony-nyra-staging-issuer:8789",
    issuer: "nyra-staging",
  }),
});
const RESPONSE_KEYS = Object.freeze([
  "schema_version",
  "issuer",
  "target_service",
  "target_environment",
  "target_commit",
  "keys",
]);
const JWK_KEYS = Object.freeze(["alg", "crv", "kid", "kty", "use", "x"]);

export class McpStagingPrivateJwksError extends Error {
  constructor(code) {
    super(code);
    this.name = "McpStagingPrivateJwksError";
    this.code = code;
  }
}

function fail(code) {
  throw new McpStagingPrivateJwksError(code);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null);
}

function exactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function validSecret(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4_096 &&
    /^[\x21-\x7e]+$/.test(value);
}

function publicKeyFingerprint(jwk) {
  let key;
  try {
    key = crypto.createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    fail("mcp_staging_private_jwks_key_invalid");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    fail("mcp_staging_private_jwks_key_invalid");
  }
  return `ed25519-sha256:${crypto.createHash("sha256")
    .update(key.export({ format: "der", type: "spki" }))
    .digest("hex")}`;
}

function canonicalJwk(jwk) {
  return JSON.stringify({
    alg: jwk.alg,
    crv: jwk.crv,
    kid: jwk.kid,
    kty: jwk.kty,
    use: jwk.use,
    x: jwk.x,
  });
}

async function readBoundedText(response) {
  const declared = response.headers?.get?.("content-length");
  if (declared !== null && declared !== undefined && declared !== "") {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RESPONSE_BYTES) {
      fail("mcp_staging_private_jwks_response_too_large");
    }
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      fail("mcp_staging_private_jwks_response_too_large");
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      length += chunk.length;
      if (length > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        fail("mcp_staging_private_jwks_response_too_large");
      }
      chunks.push(chunk);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return Buffer.concat(chunks).toString("utf8");
}

function validateDocument(document, { authority, targetCommit }) {
  const expected = EXPECTED[authority];
  if (!exactKeys(document, RESPONSE_KEYS) ||
      document.schema_version !== "mcp_staging_private_jwks_v1" ||
      document.issuer !== expected.issuer ||
      document.target_service !== "skinharmony-core-mcp-staging" ||
      document.target_environment !== "staging" ||
      document.target_commit !== targetCommit ||
      !Array.isArray(document.keys) ||
      document.keys.length !== 1) {
    fail("mcp_staging_private_jwks_document_invalid");
  }
  const jwk = document.keys[0];
  if (!exactKeys(jwk, JWK_KEYS) ||
      jwk.alg !== "EdDSA" ||
      jwk.crv !== "Ed25519" ||
      jwk.kty !== "OKP" ||
      jwk.use !== "sig" ||
      !/^ed25519-sha256:[a-f0-9]{64}$/.test(String(jwk.kid || "")) ||
      !/^[A-Za-z0-9_-]{43}$/.test(String(jwk.x || "")) ||
      publicKeyFingerprint(jwk) !== jwk.kid) {
    fail("mcp_staging_private_jwks_key_invalid");
  }
  const serialized = canonicalJwk(jwk);
  return Object.freeze({
    authority,
    issuer: expected.issuer,
    kid: jwk.kid,
    jwk: Object.freeze({ ...jwk }),
    jwkJson: serialized,
    jwkDigest: crypto.createHash("sha256")
      .update(`mcp-staging-private-jwk-v1\0${serialized}`)
      .digest("hex"),
    targetCommit,
  });
}

function retryable(error) {
  return !(error instanceof McpStagingPrivateJwksError) ||
    error.code === "mcp_staging_private_jwks_unavailable";
}

export async function fetchMcpStagingPrivateJwks(options = {}) {
  const authority = String(options.authority || "");
  const expected = EXPECTED[authority];
  if (!expected) fail("mcp_staging_private_jwks_authority_invalid");
  if (String(options.hostport || "") !== expected.hostport) {
    fail("mcp_staging_private_jwks_endpoint_invalid");
  }
  if (!validSecret(options.token)) fail("mcp_staging_private_jwks_token_invalid");
  const targetCommit = String(options.targetCommit || "").toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(targetCommit)) {
    fail("mcp_staging_private_jwks_target_commit_invalid");
  }
  const timeoutMs = Number(options.timeoutMs ?? 5_000);
  const attempts = Number(options.attempts ?? 6);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 10_000 ||
      !Number.isSafeInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) {
    fail("mcp_staging_private_jwks_bounds_invalid");
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sleep = options.sleep || ((milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)));
  if (typeof fetchImpl !== "function" || typeof sleep !== "function") {
    fail("mcp_staging_private_jwks_runtime_invalid");
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(
        `http://${expected.hostport}/.well-known/jwks.json`,
        {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${options.token}`,
          },
          redirect: "error",
          signal: controller.signal,
        },
      );
      if (response.status === 503) {
        throw new McpStagingPrivateJwksError("mcp_staging_private_jwks_unavailable");
      }
      if (response.status !== 200) {
        fail("mcp_staging_private_jwks_rejected");
      }
      const contentType = String(response.headers?.get?.("content-type") || "")
        .toLowerCase();
      if (!contentType.startsWith("application/json")) {
        fail("mcp_staging_private_jwks_content_type_invalid");
      }
      const text = await readBoundedText(response);
      let document;
      try {
        document = JSON.parse(text);
      } catch {
        fail("mcp_staging_private_jwks_document_invalid");
      }
      return validateDocument(document, { authority, targetCommit });
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !retryable(error)) throw error;
      await sleep(Math.min(250 * (2 ** (attempt - 1)), 2_000));
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastError instanceof McpStagingPrivateJwksError) throw lastError;
  fail("mcp_staging_private_jwks_unavailable");
}

export async function discoverMcpStagingPrivateTrust(options = {}) {
  const common = {
    targetCommit: options.targetCommit,
    timeoutMs: options.timeoutMs,
    attempts: options.attempts,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
  };
  const [core, nyra] = await Promise.all([
    fetchMcpStagingPrivateJwks({
      ...common,
      authority: "core",
      hostport: options.coreHostport,
      token: options.coreToken,
    }),
    fetchMcpStagingPrivateJwks({
      ...common,
      authority: "nyra",
      hostport: options.nyraHostport,
      token: options.nyraToken,
    }),
  ]);
  if (core.kid === nyra.kid || core.jwkDigest === nyra.jwkDigest) {
    fail("mcp_staging_private_jwks_independence_required");
  }
  return Object.freeze({ core, nyra });
}

export const mcpStagingPrivateJwksContract = Object.freeze({
  max_response_bytes: MAX_RESPONSE_BYTES,
  expected: EXPECTED,
  schema_version: "mcp_staging_private_jwks_v1",
});
