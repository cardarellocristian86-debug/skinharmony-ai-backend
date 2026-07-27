import crypto from "node:crypto";
import {
  McpStagingBoundedJsonResponseError,
  readMcpStagingBoundedJsonResponse,
} from "./mcpStagingBoundedJsonResponse.js";
import { requireMcpStagingTargetCommit } from "./mcpStagingTargetCommit.js";

const CONTROL_PLANE_SERVICE = "skinharmony-mcp-staging-db-bootstrap";
const CONTROL_PLANE_PORT = 10_001;
const DEFAULT_TIMEOUT_MS = 3_000;
const HOSTPORT_ENV_KEY = "MCP_STAGING_CONTROL_PLANE_INTERNAL_HOSTPORT";
const ISSUER_TOKEN_ENV_KEY = "MCP_STAGING_ISSUER_NONCE_API_TOKEN";
const CONSUMER_TOKEN_ENV_KEY = "MCP_STAGING_RECEIPT_CONSUMER_API_TOKEN";
const TENANT_ID = "codexai";
const TARGET_SERVICE = "skinharmony-core-mcp-staging";
const OPERATION = "create_only";
const EXECUTION_ID = "skinharmony-core-mcp-staging-render-create-v1";
const DIGEST = /^[a-f0-9]{64}$/;
const RECEIPT_ID = /^mcpstg_receipt_[A-Za-z0-9_-]{16,96}$/;
const CONSUMPTION_KEYS = Object.freeze([
  "execution_id", "attempt_id", "action_digest", "executor_contract_id", "deployment_spec_digest",
  "preflight_digest", "credential_grant_digest", "core_grant_digest", "nyra_attestation_digest",
  "owner_confirmation_digest",
]);

export class McpStagingControlPlaneClientError extends Error {
  constructor(code) {
    super(code);
    this.name = "McpStagingControlPlaneClientError";
    this.code = code;
  }
}

function fail(code) {
  throw new McpStagingControlPlaneClientError(code);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string")) return false;
  actual.sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function scrub(env, keys) {
  for (const key of keys) {
    try { delete env[key]; } catch { /* Client errors never contain environment values. */ }
  }
}

function readEnvironment(env, keys, code) {
  const values = Object.create(null);
  try {
    for (const key of keys) values[key] = env[key];
  } catch {
    fail(code);
  }
  return values;
}

function validToken(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4_096 && /^[\x21-\x7e]+$/.test(value);
}

function privateRenderBaseUrl(hostport) {
  if (typeof hostport !== "string" || hostport.length < 1 || hostport.length > 253 ||
      hostport !== hostport.trim() || hostport.includes("://") || !/^[\x21-\x7e]+$/.test(hostport)) {
    fail("control_plane_private_endpoint_invalid");
  }
  let endpoint;
  try {
    endpoint = new URL(`http://${hostport}`);
  } catch {
    fail("control_plane_private_endpoint_invalid");
  }
  const expectedHost = new RegExp(`^${CONTROL_PLANE_SERVICE}-[a-z0-9]+$`);
  const port = Number(endpoint.port);
  if (endpoint.protocol !== "http:" || endpoint.username || endpoint.password || endpoint.pathname !== "/" ||
      endpoint.search || endpoint.hash || !endpoint.port || endpoint.hostname.length > 63 ||
      !expectedHost.test(endpoint.hostname) ||
      port !== CONTROL_PLANE_PORT) {
    fail("control_plane_private_endpoint_invalid");
  }
  return `http://${endpoint.hostname}:${CONTROL_PLANE_PORT}`;
}

function validClientSources(env, fetchImpl, timeoutMs) {
  return env && typeof env === "object" && typeof fetchImpl === "function" &&
    Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 10_000;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(label, value) {
  return crypto.createHash("sha256")
    .update(`${label}\u0000${canonicalJson(value)}`, "utf8")
    .digest("hex");
}

function receiptConsumptionRequestBinding(input) {
  const receiptId = input?.credential_receipt?.claims?.receipt_id;
  const consumption = input?.consumption;
  if (!isPlainObject(input) || !exactKeys(input, [
    "credential_receipt", "owner_confirmation", "core_grant", "nyra_attestation", "consumption",
  ]) || !RECEIPT_ID.test(String(receiptId || "")) || !exactKeys(consumption, CONSUMPTION_KEYS) ||
      consumption.execution_id !== EXECUTION_ID ||
      !/^mcpstg_[A-Za-z0-9._:-]{8,120}$/.test(String(consumption.attempt_id || "")) ||
      !DIGEST.test(String(consumption.action_digest || "")) ||
      consumption.executor_contract_id !== `domain_action_${consumption.action_digest.slice(0, 20)}` ||
      CONSUMPTION_KEYS.slice(4).some((key) => !DIGEST.test(String(consumption[key] || "")))) {
    fail("control_plane_receipt_consume_request_invalid");
  }
  return Object.freeze({ receiptId, consumption: structuredClone(consumption) });
}

function createPost({ baseUrl, token, fetchImpl, timeoutMs }) {
  return async function post(path, body, responseValidator, code) {
    const controller = new AbortController();
    let timeout;
    const timeoutFailure = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new McpStagingControlPlaneClientError(`${code}_unavailable`));
      }, timeoutMs);
    });
    const operation = (async () => {
      let response;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        fail(`${code}_unavailable`);
      }
      let status;
      try { status = response?.status; }
      catch { fail(`${code}_unavailable`); }
      if (status !== 200) {
        fail(`${code}_unavailable`);
      }
      let payload;
      try {
        payload = await readMcpStagingBoundedJsonResponse(response, { signal: controller.signal });
      } catch (error) {
        const unavailable = controller.signal.aborted ||
          (error instanceof McpStagingBoundedJsonResponseError &&
            error.code === "bounded_json_response_aborted");
        fail(unavailable ? `${code}_unavailable` : `${code}_invalid`);
      }
      if (!responseValidator(payload)) fail(`${code}_invalid`);
      return structuredClone(payload);
    })();
    try {
      return await Promise.race([operation, timeoutFailure]);
    } finally {
      clearTimeout(timeout);
    }
  };
}

export function createMcpStagingIssuerReplayClientFromEnv({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  let token;
  let mode;
  let baseUrl;
  try {
    if (!validClientSources(env, fetchImpl, timeoutMs)) {
      fail("control_plane_issuer_client_config_invalid");
    }
    const values = readEnvironment(
      env,
      ["MCP_STAGING_ISSUER_MODE", HOSTPORT_ENV_KEY, ISSUER_TOKEN_ENV_KEY],
      "control_plane_issuer_client_config_invalid",
    );
    mode = values.MCP_STAGING_ISSUER_MODE;
    if (!["core", "nyra"].includes(mode) || !validToken(values[ISSUER_TOKEN_ENV_KEY])) {
      fail("control_plane_issuer_client_config_invalid");
    }
    try {
      baseUrl = privateRenderBaseUrl(values[HOSTPORT_ENV_KEY]);
    } catch {
      fail("control_plane_issuer_client_config_invalid");
    }
    token = values[ISSUER_TOKEN_ENV_KEY];
  } finally {
    if (env && typeof env === "object") scrub(env, [HOSTPORT_ENV_KEY, ISSUER_TOKEN_ENV_KEY]);
  }
  const post = createPost({ baseUrl, token, fetchImpl, timeoutMs });
  const issuerReplayStore = Object.freeze({
    durable: true,
    async claim(input) {
      if (!isPlainObject(input) || input.mode !== mode) {
        fail("control_plane_nonce_claim_mode_forbidden");
      }
      const payload = await post(
        "/v1/issuer-nonces/claim",
        input,
        (value) => exactKeys(value, ["schema_version", "ok", "claimed"]) &&
          value.schema_version === "mcp_staging_nonce_claim_result_v1" &&
          value.ok === true && typeof value.claimed === "boolean",
        "control_plane_nonce_claim",
      );
      return payload.claimed;
    },
  });
  return Object.freeze({ issuerReplayStore });
}

export function createMcpStagingReceiptConsumerClientFromEnv({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  targetCommit: targetCommitValue,
} = {}) {
  let token;
  let baseUrl;
  let targetCommit;
  try {
    if (!validClientSources(env, fetchImpl, timeoutMs)) {
      fail("control_plane_consumer_client_config_invalid");
    }
    try {
      targetCommit = requireMcpStagingTargetCommit(targetCommitValue);
    } catch {
      fail("control_plane_consumer_client_config_invalid");
    }
    const values = readEnvironment(
      env,
      [HOSTPORT_ENV_KEY, CONSUMER_TOKEN_ENV_KEY],
      "control_plane_consumer_client_config_invalid",
    );
    if (!validToken(values[CONSUMER_TOKEN_ENV_KEY])) fail("control_plane_consumer_client_config_invalid");
    try {
      baseUrl = privateRenderBaseUrl(values[HOSTPORT_ENV_KEY]);
    } catch {
      fail("control_plane_consumer_client_config_invalid");
    }
    token = values[CONSUMER_TOKEN_ENV_KEY];
  } finally {
    if (env && typeof env === "object") scrub(env, [HOSTPORT_ENV_KEY, CONSUMER_TOKEN_ENV_KEY]);
  }
  const post = createPost({ baseUrl, token, fetchImpl, timeoutMs });
  async function verifyAndConsumeReceipt(input) {
    const expected = receiptConsumptionRequestBinding(input);
    return post(
      "/v1/credential-receipts/consume",
      input,
      (value) => exactKeys(value, [
        "ok", "status", "idempotent", "receipt_id", "evidence_digest", "execution_id",
        "idempotency_key", "secrets_exposed",
      ]) && value.ok === true && value.status === "consumed" && typeof value.idempotent === "boolean" &&
        value.receipt_id === expected.receiptId && value.execution_id === expected.consumption.execution_id &&
        DIGEST.test(String(value.evidence_digest || "")) && value.idempotency_key === `mcpstg-consume-${digest(
          "mcp-staging-receipt-consumption-v1",
          {
            receipt_id: expected.receiptId,
            evidence_digest: value.evidence_digest,
            ...expected.consumption,
            tenant_id: TENANT_ID,
            target_service: TARGET_SERVICE,
            target_commit: targetCommit,
            operation: OPERATION,
          },
        )}` && value.secrets_exposed === false,
      "control_plane_receipt_consume",
    );
  }
  return Object.freeze({ verifyAndConsumeReceipt });
}

export const mcpStagingControlPlaneClientContract = Object.freeze({
  endpoint_env_key: HOSTPORT_ENV_KEY,
  private_service_name: CONTROL_PLANE_SERVICE,
  private_protocol: "http",
  private_port: CONTROL_PLANE_PORT,
  issuer_token_env_key: ISSUER_TOKEN_ENV_KEY,
  consumer_token_env_key: CONSUMER_TOKEN_ENV_KEY,
});
