import crypto from "node:crypto";

export const RENDER_STAGING_RECEIPT_TYPE = "render_staging_core_receipt_v1";
export const RENDER_STAGING_RECEIPT_ISSUER = "universal-core-staging";
export const RENDER_STAGING_RECEIPT_AUDIENCE =
  "https://skinharmony-core-mcp-staging.onrender.com/mcp";

const TENANT_ID = "codexai";
const CAPABILITY_ID = "render_staging_deploy";
const TARGET_SERVICE = "skinharmony-universal-core-staging";
const TARGET_ENVIRONMENT = "staging";
const TARGET_BRANCH = "agent/nyra-policy-registry";
const AUTHORIZATION_SCOPE = "request_bound_owner_confirmed_staging_deploy";
const DIGEST = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const SERVICE_ID = /^srv-[a-z0-9]{8,64}$/;
const MAX_TTL_MS = 30_000;

function fail(code) {
  throw new Error(code);
}

function privateKeyFromJwk(value) {
  let jwk = value;
  if (typeof value === "string") {
    try {
      jwk = JSON.parse(value);
    } catch {
      fail("render_staging_core_receipt_private_jwk_invalid");
    }
  }
  if (!jwk || typeof jwk !== "object" || Array.isArray(jwk) ||
      jwk.kty !== "OKP" || jwk.crv !== "Ed25519" ||
      typeof jwk.x !== "string" || !jwk.x ||
      typeof jwk.d !== "string" || !jwk.d) {
    fail("render_staging_core_receipt_private_jwk_invalid");
  }
  try {
    return crypto.createPrivateKey({ key: jwk, format: "jwk" });
  } catch {
    fail("render_staging_core_receipt_private_jwk_invalid");
  }
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function exactBody(body, serviceId) {
  return body?.operation_class === AUTHORIZATION_SCOPE &&
    body?.action_type === CAPABILITY_ID &&
    body?.target === CAPABILITY_ID &&
    body?.authenticated_tenant_id === TENANT_ID &&
    body?.tenant_id === TENANT_ID &&
    body?.authenticated_key_type === "connector" &&
    body?.owner_confirmed === true &&
    body?.owner_context_verified === true &&
    body?.request_bound_owner_confirmation === true &&
    body?.external_side_effect === true &&
    body?.contains_customer_data === false &&
    body?.contains_secret === false &&
    body?.secret_value_transmitted === false &&
    body?.cross_tenant === false &&
    body?.configuration_changes === false &&
    body?.provider_execution === true &&
    body?.deploy === true &&
    body?.production_deploy === false &&
    body?.merge === false &&
    body?.delete === false &&
    body?.auth0_changes === false &&
    body?.database_changes === false &&
    body?.modify_environment_variables === false &&
    body?.clear_build_cache === false &&
    body?.destructive === true &&
    body?.bounded_scope === true &&
    body?.low_impact === false &&
    body?.idempotent_or_compensable === false &&
    body?.rollback_ready === false &&
    body?.audit_ready === true &&
    body?.target_authority_verified === true &&
    body?.actor_authorized_for_target === true &&
    body?.receipt_required === true &&
    body?.receipt_type === RENDER_STAGING_RECEIPT_TYPE &&
    body?.receipt_single_use === true &&
    DIGEST.test(String(body?.actor_subject_sha256 || "")) &&
    DIGEST.test(String(body?.confirmation_reference_sha256 || "")) &&
    DIGEST.test(String(body?.catalog_revision || "")) &&
    DIGEST.test(String(body?.dynamic_capability_arguments_digest || "")) &&
    DIGEST.test(String(body?.idempotency_key_sha256 || "")) &&
    body?.target_service_id === serviceId &&
    body?.target_service === TARGET_SERVICE &&
    body?.target_environment === TARGET_ENVIRONMENT &&
    body?.target_branch === TARGET_BRANCH &&
    COMMIT.test(String(body?.target_commit || ""));
}

export function createRenderStagingCoreReceiptIssuer({
  privateJwk,
  kid,
  serviceId,
  audience = RENDER_STAGING_RECEIPT_AUDIENCE,
  issuer = RENDER_STAGING_RECEIPT_ISSUER,
  now = Date.now,
  ttlMs = 25_000,
} = {}) {
  const normalizedKid = String(kid || "").trim();
  const normalizedServiceId = String(serviceId || "").trim();
  if (!/^[a-zA-Z0-9._:-]{8,120}$/.test(normalizedKid) ||
      !SERVICE_ID.test(normalizedServiceId) ||
      audience !== RENDER_STAGING_RECEIPT_AUDIENCE ||
      issuer !== RENDER_STAGING_RECEIPT_ISSUER ||
      typeof now !== "function" ||
      !Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > MAX_TTL_MS) {
    fail("render_staging_core_receipt_issuer_config_invalid");
  }
  const key = privateKeyFromJwk(privateJwk);

  return Object.freeze({
    issue({ tenantId, body, authorization } = {}) {
      if (tenantId !== TENANT_ID ||
          authorization?.allowed !== true ||
          authorization?.scope !== AUTHORIZATION_SCOPE ||
          authorization?.confirmation_satisfied !== true ||
          String(authorization?.target_commit || "").toLowerCase() !==
            String(body?.target_commit || "").toLowerCase() ||
          !exactBody(body, normalizedServiceId)) {
        fail("render_staging_core_receipt_binding_invalid");
      }
      const timestamp = Number(now());
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        fail("render_staging_core_receipt_clock_invalid");
      }
      const iat = Math.floor(timestamp / 1_000);
      const claims = {
        receipt_type: RENDER_STAGING_RECEIPT_TYPE,
        iss: RENDER_STAGING_RECEIPT_ISSUER,
        aud: RENDER_STAGING_RECEIPT_AUDIENCE,
        tenant_id: TENANT_ID,
        capability_id: CAPABILITY_ID,
        catalog_revision: body.catalog_revision,
        arguments_digest: body.dynamic_capability_arguments_digest,
        idempotency_key_sha256: body.idempotency_key_sha256,
        actor_subject_sha256: body.actor_subject_sha256,
        confirmation_reference_sha256: body.confirmation_reference_sha256,
        target_service_id: normalizedServiceId,
        target_service: TARGET_SERVICE,
        target_environment: TARGET_ENVIRONMENT,
        target_branch: TARGET_BRANCH,
        target_commit: String(body.target_commit).toLowerCase(),
        single_use: true,
        iat,
        exp: Math.floor((timestamp + ttlMs) / 1_000),
        jti: `render-staging-${crypto.randomUUID()}`,
      };
      const header = {
        alg: "EdDSA",
        kid: normalizedKid,
        typ: RENDER_STAGING_RECEIPT_TYPE,
      };
      const encodedHeader = encode(header);
      const encodedClaims = encode(claims);
      const signature = crypto.sign(
        null,
        Buffer.from(`${encodedHeader}.${encodedClaims}`),
        key,
      ).toString("base64url");
      return `${encodedHeader}.${encodedClaims}.${signature}`;
    },
  });
}
