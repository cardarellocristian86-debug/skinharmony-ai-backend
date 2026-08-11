import crypto from "node:crypto";
import { GetPublicKeyCommand, KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

const HEX_64 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,159}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,159}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_BODY_BYTES = 8192;
const SIGN_PURPOSE = "generic_work_core_join_v1";
const PROBE_PURPOSE = "generic_work_core_join_remote_probe_v1";

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff"
    },
    body: JSON.stringify(body)
  };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseBody(event) {
  const encoded = String(event?.body || "");
  const body = event?.isBase64Encoded ? Buffer.from(encoded, "base64") : Buffer.from(encoded, "utf8");
  if (body.length === 0 || body.length > MAX_BODY_BYTES) throw new Error("invalid_body");
  return JSON.parse(body.toString("utf8"));
}

function requestPath(event) {
  return event?.rawPath || event?.requestContext?.http?.path || event?.path || "";
}

function requestMethod(event) {
  return String(event?.requestContext?.http?.method || event?.httpMethod || "").toUpperCase();
}

function bearer(event) {
  const headers = event?.headers || {};
  return headers.authorization || headers.Authorization || "";
}

function expectedRequestId(keyId, digest) {
  return `gwcjs_${crypto.createHash("sha256").update(keyId).update("\0").update(digest).digest("hex")}`;
}

function fingerprint(publicKeyDer) {
  return crypto.createHash("sha256").update(publicKeyDer).digest("hex");
}

function audit(event, details = {}) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...details }));
}

export function createHandler({ keyId, getBearerToken, getPublicKeyDer, signBytes }) {
  if (!KEY_ID.test(String(keyId || ""))) throw new Error("invalid_key_id");
  let publicMaterial;

  async function material() {
    if (!publicMaterial) {
      const der = Buffer.from(await getPublicKeyDer());
      const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
      if (key.asymmetricKeyType !== "ed25519") throw new Error("non_ed25519_key");
      publicMaterial = { der, fingerprint: fingerprint(der) };
    }
    return publicMaterial;
  }

  return async function handler(event) {
    const path = requestPath(event);
    if (requestMethod(event) !== "POST") return json(405, { error: "method_not_allowed" });

    const expectedToken = await getBearerToken();
    if (!safeEqual(bearer(event), `Bearer ${expectedToken}`)) {
      audit("generic_work_core_join_signer_denied", { reason: "authentication" });
      return json(401, { error: "denied" });
    }

    let body;
    try {
      body = parseBody(event);
    } catch {
      return json(400, { error: "invalid_request" });
    }

    try {
      const publicKey = await material();
      if (path === "/v1/generic-work-core-join/sign") {
        const keys = ["schema_version", "purpose", "key_id", "digest", "request_id", "tenant_id", "work_id", "adapter", "idempotency_digest"];
        if (!exactKeys(body, keys)
          || body.schema_version !== "generic_work_core_join_sign_request_v1"
          || body.purpose !== SIGN_PURPOSE
          || body.key_id !== keyId
          || !HEX_64.test(body.digest)
          || !IDENTIFIER.test(body.tenant_id)
          || !IDENTIFIER.test(body.work_id)
          || !IDENTIFIER.test(body.adapter)
          || !HEX_64.test(body.idempotency_digest)
          || body.request_id !== expectedRequestId(keyId, body.digest)) {
          return json(400, { error: "invalid_request" });
        }

        const message = Buffer.from(`${SIGN_PURPOSE}\0${body.digest}`, "utf8");
        const signature = Buffer.from(await signBytes(message)).toString("base64url");
        if (!BASE64URL.test(signature)) throw new Error("invalid_signature_encoding");
        audit("generic_work_core_join_signed", {
          request_id: body.request_id,
          digest: body.digest,
          key_id: keyId,
          tenant_digest: crypto.createHash("sha256").update(body.tenant_id).digest("hex")
        });
        return json(200, {
          schema_version: "generic_work_core_join_sign_response_v1",
          algorithm: "Ed25519",
          key_id: keyId,
          digest: body.digest,
          public_key_fingerprint: publicKey.fingerprint,
          signature
        });
      }

      if (path === "/v1/generic-work-core-join/health") {
        const keys = ["schema_version", "purpose", "key_id", "nonce"];
        if (!exactKeys(body, keys)
          || body.schema_version !== "generic_work_core_join_probe_request_v1"
          || body.purpose !== PROBE_PURPOSE
          || body.key_id !== keyId
          || typeof body.nonce !== "string"
          || !BASE64URL.test(body.nonce)
          || body.nonce.length < 32
          || body.nonce.length > 128) {
          return json(400, { error: "invalid_request" });
        }
        const message = Buffer.from(`${PROBE_PURPOSE}\0${body.nonce}`, "utf8");
        const signature = Buffer.from(await signBytes(message)).toString("base64url");
        audit("generic_work_core_join_probe_signed", { key_id: keyId });
        return json(200, {
          schema_version: "generic_work_core_join_probe_response_v1",
          purpose: PROBE_PURPOSE,
          key_id: keyId,
          nonce: body.nonce,
          algorithm: "Ed25519",
          public_key_fingerprint: publicKey.fingerprint,
          signature
        });
      }
      return json(404, { error: "not_found" });
    } catch (error) {
      audit("generic_work_core_join_signer_unavailable", { reason: error?.name || "signing_failure" });
      return json(503, { error: "unavailable" });
    }
  };
}

let productionHandler;

function buildProductionHandler() {
  const kms = new KMSClient({});
  const secrets = new SecretsManagerClient({});
  const configuredKeyId = process.env.SIGNER_LOGICAL_KEY_ID;
  const kmsKeyArn = process.env.SIGNER_KMS_KEY_ARN;
  const authSecretArn = process.env.SIGNER_AUTH_SECRET_ARN;

  async function loadToken() {
    const result = await secrets.send(new GetSecretValueCommand({
      SecretId: authSecretArn,
      VersionStage: "AWSCURRENT"
    }));
    const parsed = JSON.parse(result.SecretString || "{}");
    if (typeof parsed.token !== "string" || parsed.token.length < 32) throw new Error("invalid_auth_secret");
    return parsed.token;
  }

  return createHandler({
    keyId: configuredKeyId,
    getBearerToken: loadToken,
    getPublicKeyDer: async () => {
      const result = await kms.send(new GetPublicKeyCommand({ KeyId: kmsKeyArn }));
      if (!result.PublicKey || !result.SigningAlgorithms?.includes("ED25519_SHA_512")) {
        throw new Error("kms_ed25519_unavailable");
      }
      return result.PublicKey;
    },
    signBytes: async (message) => {
      const result = await kms.send(new SignCommand({
        KeyId: kmsKeyArn,
        Message: message,
        MessageType: "RAW",
        SigningAlgorithm: "ED25519_SHA_512"
      }));
      if (!result.Signature) throw new Error("kms_signature_missing");
      return result.Signature;
    }
  });
}

export async function handler(event) {
  if (!productionHandler) productionHandler = buildProductionHandler();
  return productionHandler(event);
}
