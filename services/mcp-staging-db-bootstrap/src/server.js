import crypto from "node:crypto";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { bootstrapMcpStagingDatabaseWithControlPlane } from "./bootstrap.js";
import { bootstrapMcpStagingCollaborationDatabaseWithControlPlane } from
  "./collaboration-rollout.js";
import { createMcpStagingConsumptionEvidenceVerifier } from
  "../../universal-core-service/src/mcpStagingConsumptionEvidence.js";
import { createMcpStagingPostgresControlPlaneFromBootstrap } from "../../universal-core-service/src/mcpStagingPostgresControlPlane.js";
import { loadMcpStagingDependencyBuildIdentity } from
  "../../universal-core-service/src/mcpStagingDependencyBuildIdentity.js";

const SENSITIVE_ENV_KEYS = Object.freeze([
  "PG_ADMIN_DATABASE_URL",
  "MCP_STAGING_GATE_CONTROL_PASSWORD",
  "MCP_STAGING_RECEIPT_AUTHORITY_PUBLIC_JWK",
  "MCP_STAGING_RECEIPT_AUTHORITY_KID",
  "MCP_STAGING_OWNER_AUTHORITY_PUBLIC_JWK",
  "MCP_STAGING_OWNER_AUTHORITY_KID",
  "MCP_STAGING_CORE_AUTHORITY_PUBLIC_JWK",
  "MCP_STAGING_CORE_AUTHORITY_KID",
  "MCP_STAGING_NYRA_AUTHORITY_PUBLIC_JWK",
  "MCP_STAGING_NYRA_AUTHORITY_KID",
  "MCP_STAGING_CORE_NONCE_API_TOKEN",
  "MCP_STAGING_NYRA_NONCE_API_TOKEN",
  "MCP_STAGING_RECEIPT_CONSUMER_API_TOKEN",
]);
const API_TOKEN_KEYS = Object.freeze(["coreNonce", "nyraNonce", "receiptConsumer"]);
const REQUEST_BODY_LIMIT = 65_536;
const PRIVATE_PORT = 10_001;
const BASE_HEALTH_KEYS = Object.freeze([
  "ok",
  "status",
  "environment",
  "schema_version",
  "role_count",
  "isolation",
  "secrets_exposed",
]);

export function scrubBootstrapEnvironment(env = process.env) {
  for (const key of SENSITIVE_ENV_KEYS) delete env[key];
}

function validToken(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4_096 && /^[\x21-\x7e]+$/.test(value);
}

function validApiTokens(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\u0000") !== [...API_TOKEN_KEYS].sort().join("\u0000")) return false;
  const tokens = API_TOKEN_KEYS.map((key) => value[key]);
  return tokens.every(validToken) && new Set(tokens).size === tokens.length;
}

function normalizedHealth(health, hasControlPlane) {
  const expectedKeys = hasControlPlane ? [...BASE_HEALTH_KEYS, "control_plane"] : [...BASE_HEALTH_KEYS];
  try {
    if (!health || typeof health !== "object" || Array.isArray(health) ||
        Object.getPrototypeOf(health) !== Object.prototype ||
        Object.keys(health).sort().join("\u0000") !== expectedKeys.sort().join("\u0000") ||
        health.ok !== true || health.status !== "ready" || health.environment !== "staging" ||
        health.schema_version !== 2 || ![1, 2].includes(health.role_count) || health.isolation !== "verified" ||
        health.secrets_exposed !== false || (hasControlPlane && health.control_plane !== "ready")) {
      throw new Error("invalid");
    }
    return Object.freeze({
      ok: true,
      status: "ready",
      environment: "staging",
      schema_version: 2,
      role_count: health.role_count,
      isolation: "verified",
      ...(hasControlPlane ? { control_plane: "ready" } : {}),
      secrets_exposed: false,
    });
  } catch {
    throw new Error("bootstrap_health_not_ready");
  }
}

export function loadPrivatePort(env = process.env) {
  try {
    if (!env || typeof env !== "object" || env.PORT !== String(PRIVATE_PORT)) {
      throw new Error("invalid");
    }
    return PRIVATE_PORT;
  } catch {
    throw new Error("bootstrap_private_port_invalid");
  }
}

function authorized(header, expectedDigest) {
  const match = typeof header === "string" ? header.match(/^Bearer ([\x21-\x7e]+)$/) : null;
  if (!match || !expectedDigest) return false;
  const provided = crypto.createHash("sha256").update(match[1], "utf8").digest();
  return crypto.timingSafeEqual(provided, expectedDigest);
}

function authorizedCapability(header, tokenDigests) {
  for (const key of API_TOKEN_KEYS) {
    if (authorized(header, tokenDigests?.[key])) return key;
  }
  return null;
}

function send(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request, limit = REQUEST_BODY_LIMIT, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let size = 0;
    const chunks = [];
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        finish(new Error("too_large"));
        if (typeof request.resume === "function") request.resume();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { finish(new Error("invalid_json")); }
    };
    const onError = () => finish(new Error("body_unavailable"));
    const timeout = setTimeout(() => finish(new Error("body_timeout")), timeoutMs);
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}

export function createHealthServer(health, { controlPlane = null, apiTokens = null } = {}) {
  const safeHealth = normalizedHealth(health, Boolean(controlPlane));
  const controlPlaneValid = !controlPlane || (
    typeof controlPlane.verifyAndConsumeReceipt === "function" &&
    controlPlane.issuerReplayStore?.durable === true &&
    typeof controlPlane.issuerReplayStore.claim === "function" &&
    typeof controlPlane.close === "function"
  );
  if (!controlPlaneValid || (controlPlane && !validApiTokens(apiTokens)) || (!controlPlane && apiTokens !== null)) {
    throw new Error("control_plane_api_config_invalid");
  }
  const tokenDigests = controlPlane ? Object.freeze({
    coreNonce: crypto.createHash("sha256").update(apiTokens.coreNonce, "utf8").digest(),
    nyraNonce: crypto.createHash("sha256").update(apiTokens.nyraNonce, "utf8").digest(),
    receiptConsumer: crypto.createHash("sha256").update(apiTokens.receiptConsumer, "utf8").digest(),
  }) : null;
  const body = JSON.stringify(safeHealth);
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(body);
      return;
    }
    const knownPost = request.url === "/v1/issuer-nonces/claim" ||
      request.url === "/v1/credential-receipts/consume";
    if (!knownPost) return send(response, 404, { ok: false, status: "not_found" });
    if (request.method !== "POST") return send(response, 405, { ok: false, status: "method_not_allowed" });
    if (!controlPlane) return send(response, 401, { ok: false, status: "control_plane_auth_required" });
    const capability = authorizedCapability(request.headers.authorization, tokenDigests);
    const routeAuthorized = request.url === "/v1/issuer-nonces/claim"
      ? capability === "coreNonce" || capability === "nyraNonce"
      : capability === "receiptConsumer";
    if (!routeAuthorized) {
      return send(response, 401, { ok: false, status: "control_plane_auth_required" });
    }
    const declaredLength = request.headers["content-length"];
    if (declaredLength !== undefined &&
        (!/^\d{1,10}$/.test(String(declaredLength)) || Number(declaredLength) > REQUEST_BODY_LIMIT)) {
      return send(response, 413, { ok: false, status: "request_body_too_large" });
    }
    if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
      return send(response, 415, { ok: false, status: "application_json_required" });
    }
    void readJsonBody(request).then(async (payload) => {
      if (request.url === "/v1/issuer-nonces/claim") {
        const expectedMode = capability === "coreNonce" ? "core" : "nyra";
        if (payload?.mode !== expectedMode) {
          return send(response, 401, { ok: false, status: "control_plane_auth_required" });
        }
        const claimed = await controlPlane.issuerReplayStore.claim(payload);
        return send(response, 200, {
          schema_version: "mcp_staging_nonce_claim_result_v1",
          ok: true,
          claimed,
        });
      }
      const result = await controlPlane.verifyAndConsumeReceipt(payload);
      return send(response, 200, result);
    }).catch(() => send(response, 400, { ok: false, status: "control_plane_request_rejected" }));
  });
  if (controlPlane && typeof controlPlane.close === "function") {
    server.once("close", () => {
      Promise.resolve(controlPlane.close()).catch(() => {});
    });
  }
  server.requestTimeout = 5_000;
  server.headersTimeout = 6_000;
  server.keepAliveTimeout = 2_000;
  return server;
}

async function main() {
  const buildIdentity = loadMcpStagingDependencyBuildIdentity(process.env);
  const profile = process.env.MCP_STAGING_CONTROL_PLANE_PROFILE || "render_executor";
  if (!["render_executor", "collaboration"].includes(profile)) {
    throw new Error("control_plane_profile_invalid");
  }
  let result;
  let apiTokens;
  try {
    if (profile === "collaboration") {
      result = await bootstrapMcpStagingCollaborationDatabaseWithControlPlane({
        env: process.env,
        targetCommit: buildIdentity.commit,
        controlPlaneFactory: (capability, binding) =>
          createMcpStagingPostgresControlPlaneFromBootstrap({
            capability,
            targetCommit: binding.targetCommit,
            profile: binding.profile,
          }),
      });
    } else {
      const consumptionEvidenceVerifier = createMcpStagingConsumptionEvidenceVerifier({
        receipt: {
          jwkJson: process.env.MCP_STAGING_RECEIPT_AUTHORITY_PUBLIC_JWK,
          expectedKid: process.env.MCP_STAGING_RECEIPT_AUTHORITY_KID,
        },
        owner: {
          jwkJson: process.env.MCP_STAGING_OWNER_AUTHORITY_PUBLIC_JWK,
          expectedKid: process.env.MCP_STAGING_OWNER_AUTHORITY_KID,
        },
        core: {
          jwkJson: process.env.MCP_STAGING_CORE_AUTHORITY_PUBLIC_JWK,
          expectedKid: process.env.MCP_STAGING_CORE_AUTHORITY_KID,
        },
        nyra: {
          jwkJson: process.env.MCP_STAGING_NYRA_AUTHORITY_PUBLIC_JWK,
          expectedKid: process.env.MCP_STAGING_NYRA_AUTHORITY_KID,
        },
        targetCommit: buildIdentity.commit,
      });
      result = await bootstrapMcpStagingDatabaseWithControlPlane({
        controlPlaneFactory: (capability) => createMcpStagingPostgresControlPlaneFromBootstrap({
          capability,
          consumptionEvidenceVerifier,
          targetCommit: buildIdentity.commit,
        }),
      });
    }
    apiTokens = {
      coreNonce: process.env.MCP_STAGING_CORE_NONCE_API_TOKEN,
      nyraNonce: process.env.MCP_STAGING_NYRA_NONCE_API_TOKEN,
      receiptConsumer: process.env.MCP_STAGING_RECEIPT_CONSUMER_API_TOKEN,
    };
    if (!validApiTokens(apiTokens)) throw new Error("control_plane_api_config_invalid");
  } finally {
    scrubBootstrapEnvironment();
  }
  const port = loadPrivatePort(process.env);
  const health = Object.freeze({ ...result.health, control_plane: "ready" });
  const server = createHealthServer(health, { controlPlane: result.controlPlane, apiTokens });
  for (const key of API_TOKEN_KEYS) apiTokens[key] = "";
  server.listen(port, "0.0.0.0");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("mcp_staging_db_bootstrap_failed");
    process.exitCode = 1;
  });
}
