import crypto from "node:crypto";

const RENDER_API_ORIGIN = "https://api.render.com";
const RENDER_API_BASE = `${RENDER_API_ORIGIN}/v1`;
const GITHUB_API_ORIGIN = "https://api.github.com";
const EXPECTED_TENANT = "codexai";
const EXPECTED_ENVIRONMENT = "staging";
const EXPECTED_SERVICE = "skinharmony-universal-core-staging";
const EXPECTED_BRANCH = "agent/nyra-policy-registry";
const EXPECTED_REPOSITORY = "cardarellocristian86-debug/skinharmony-ai-backend";
const DEPLOY_OPERATION = "render.staging.deploy";
const RECEIPT_OPERATION = "render.staging.core_receipt";
const MUTATION_OPERATION = "render.staging.mutation";
const MUTATION_ACTOR = sha256(`${EXPECTED_TENANT}:${EXPECTED_SERVICE}:mutation`);
const ACTIVE_DEPLOY_STATUSES = new Set([
  "created", "queued", "build_in_progress", "update_in_progress",
  "pre_deploy_in_progress", "live",
]);
const TERMINAL_DEPLOY_STATUSES = new Set([
  "live", "build_failed", "update_failed", "pre_deploy_failed",
  "canceled", "deactivated",
]);
const SERVICE_ID_PATTERN = /^srv-[a-z0-9]{8,64}$/;
const ENVIRONMENT_ID_PATTERN = /^evm-[a-z0-9]{8,64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const RECEIPT_TYPE = "render_staging_core_receipt_v1";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex");
}

function normalizeRepository(value) {
  return String(value || "").trim()
    .replace(/^git@github\.com:/i, "")
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function deployCommit(deploy) {
  return String(deploy?.commit?.id || deploy?.commitId || deploy?.commit_id || "")
    .trim().toLowerCase();
}

function deployRecord(value) {
  return value?.deploy && typeof value.deploy === "object" ? value.deploy : value;
}

function publicDeploy(deploy, { idempotentReplay = false, healthVerified = false } = {}) {
  const record = deployRecord(deploy) || {};
  return {
    deploy_id_redacted: record.id ? `${String(record.id).slice(0, 8)}…` : null,
    status: String(record.status || "unknown"),
    commit: deployCommit(record) || null,
    created_at: record.createdAt || record.created_at || null,
    updated_at: record.updatedAt || record.updated_at || null,
    finished_at: record.finishedAt || record.finished_at || null,
    idempotent_replay: idempotentReplay,
    health_verified: healthVerified,
  };
}

function safeError(code, status = 503) {
  const error = new Error(code);
  error.status = status;
  return error;
}

async function readJson(response, failureCode) {
  if (!response?.ok) throw safeError(failureCode, Number(response?.status || 503));
  try {
    return await response.json();
  } catch {
    throw safeError(`${failureCode}_invalid`);
  }
}

function assertExactRequest(args, config, identity) {
  if (identity?.tenantId !== EXPECTED_TENANT) {
    throw safeError("render_staging_cross_tenant_denied", 403);
  }
  if (config.renderStagingDeployEnabled !== true) {
    throw safeError("render_staging_deploy_disabled");
  }
  if (!config.renderApiKey || !SERVICE_ID_PATTERN.test(config.renderUniversalCoreStagingServiceId) ||
      !ENVIRONMENT_ID_PATTERN.test(config.renderUniversalCoreStagingEnvironmentId)) {
    throw safeError("render_staging_deploy_configuration_incomplete");
  }
  if (
    args.target_service !== EXPECTED_SERVICE ||
    args.target_environment !== EXPECTED_ENVIRONMENT ||
    args.target_branch !== EXPECTED_BRANCH ||
    !COMMIT_PATTERN.test(String(args.target_commit || "")) ||
    args.clear_build_cache !== false ||
    args.modify_environment_variables !== false ||
    args.database_changes !== false ||
    args.auth0_changes !== false ||
    args.production_deploy !== false ||
    args.merge !== false ||
    args.delete !== false ||
    args.cross_tenant !== false
  ) {
    throw safeError("render_staging_deploy_scope_mismatch", 403);
  }
}

function assertServiceBinding(service, config) {
  const record = service?.service && typeof service.service === "object" ? service.service : service;
  const environmentId = String(record?.environmentId || record?.environment_id || "");
  const autoDeploy = record?.autoDeploy ?? record?.auto_deploy;
  const autoDeployOff = autoDeploy === false || autoDeploy === "no" || autoDeploy === "off";
  if (
    String(record?.id || "") !== config.renderUniversalCoreStagingServiceId ||
    String(record?.name || "") !== EXPECTED_SERVICE ||
    String(record?.branch || "") !== EXPECTED_BRANCH ||
    normalizeRepository(record?.repo) !== EXPECTED_REPOSITORY ||
    String(record?.type || "") !== "web_service" ||
    environmentId !== config.renderUniversalCoreStagingEnvironmentId ||
    !autoDeployOff
  ) {
    throw safeError("render_staging_service_binding_mismatch", 409);
  }
  return record;
}

export function renderStagingActorDigest(identity) {
  const subject = String(identity?.subject || identity?.sub || identity?.actorId || "unknown");
  return sha256(`${EXPECTED_TENANT}:${subject}`);
}

function receiptFromGate(gate) {
  const payload = gate?.structuredContent || {};
  return String(
    payload?.authorization?.core_receipt ||
    payload?.decision_contract?.core_receipt ||
    payload?.verdict?.core_receipt ||
    "",
  ).trim();
}

function decodeSegment(segment, code) {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw safeError(code, 403);
  }
}

function verifyCoreReceipt(config, invocation, args, identity) {
  const compact = receiptFromGate(invocation.gate);
  const segments = compact.split(".");
  if (segments.length !== 3) throw safeError("render_staging_core_receipt_required", 403);
  const header = decodeSegment(segments[0], "render_staging_core_receipt_invalid");
  const claims = decodeSegment(segments[1], "render_staging_core_receipt_invalid");
  if (header.alg !== "EdDSA" || header.kid !== config.renderStagingCoreReceiptKid ||
      header.typ !== RECEIPT_TYPE) {
    throw safeError("render_staging_core_receipt_header_mismatch", 403);
  }
  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: config.renderStagingCoreReceiptJwk, format: "jwk" });
  } catch {
    throw safeError("render_staging_core_receipt_trust_invalid", 503);
  }
  const valid = crypto.verify(
    null,
    Buffer.from(`${segments[0]}.${segments[1]}`),
    publicKey,
    Buffer.from(segments[2], "base64url"),
  );
  if (!valid) throw safeError("render_staging_core_receipt_signature_invalid", 403);

  const now = Math.floor(Date.now() / 1000);
  const maxTtlSeconds = Math.floor((config.renderStagingCoreReceiptTtlMs || 30_000) / 1000);
  const expected = {
    receipt_type: RECEIPT_TYPE,
    iss: config.renderStagingCoreReceiptIssuer,
    aud: config.renderStagingCoreReceiptAudience,
    tenant_id: EXPECTED_TENANT,
    capability_id: "render_staging_deploy",
    catalog_revision: invocation.catalogRevision,
    arguments_digest: invocation.argumentsDigest,
    idempotency_key_sha256: sha256(invocation.idempotencyKey),
    actor_subject_sha256: renderStagingActorDigest(identity),
    confirmation_reference_sha256: sha256(String(identity?.confirmationReference || "")),
    target_service_id: config.renderUniversalCoreStagingServiceId,
    target_service: EXPECTED_SERVICE,
    target_environment: EXPECTED_ENVIRONMENT,
    target_branch: EXPECTED_BRANCH,
    target_commit: String(args.target_commit).toLowerCase(),
    single_use: true,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (claims[key] !== value) throw safeError("render_staging_core_receipt_binding_mismatch", 403);
  }
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) ||
      claims.iat > now + 5 || claims.exp <= now || claims.exp <= claims.iat ||
      claims.exp - claims.iat > maxTtlSeconds ||
      !/^[a-zA-Z0-9._:-]{16,120}$/.test(String(claims.jti || ""))) {
    throw safeError("render_staging_core_receipt_expired_or_invalid", 403);
  }
  return { compact, claims, digest: sha256(compact) };
}

function publicResult(deploy, requestDigest, idempotentReplay = false) {
  const payload = {
    ok: true,
    target_service: EXPECTED_SERVICE,
    target_environment: EXPECTED_ENVIRONMENT,
    request_digest: requestDigest,
    deploy: publicDeploy(deploy, { idempotentReplay }),
    secrets_exposed: false,
  };
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify({
      ok: true,
      status: payload.deploy.status,
      idempotent_replay: idempotentReplay,
      secrets_exposed: false,
    }) }],
  };
}

async function reserveDurably(
  pool,
  identity,
  invocation,
  requestDigest,
  mutationDigest,
  receipt,
) {
  if (!pool || typeof pool.connect !== "function") {
    throw safeError("render_staging_durable_store_required");
  }
  const client = await pool.connect();
  const actor = renderStagingActorDigest(identity);
  const key = String(invocation.idempotencyKey);
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO mcp_collaboration_idempotency
         (tenant_id,operation,actor_subject_sha256,idempotency_key,request_sha256,state)
       VALUES ($1,$2,$3,$4,$5,'pending')
       ON CONFLICT DO NOTHING
       RETURNING state`,
      [EXPECTED_TENANT, DEPLOY_OPERATION, actor, key, requestDigest],
    );
    if (!inserted.rowCount) {
      const existing = await client.query(
        `SELECT request_sha256,state,result_ref
         FROM mcp_collaboration_idempotency
         WHERE tenant_id=$1 AND operation=$2 AND actor_subject_sha256=$3 AND idempotency_key=$4
         FOR UPDATE`,
        [EXPECTED_TENANT, DEPLOY_OPERATION, actor, key],
      );
      const row = existing.rows[0];
      if (!row || row.request_sha256 !== requestDigest) {
        throw safeError("render_staging_idempotency_key_reused", 409);
      }
      if (row.state !== "completed" || !row.result_ref) {
        throw safeError("render_staging_idempotency_in_progress", 409);
      }
      await client.query("COMMIT");
      return { replay: true, result: row.result_ref };
    }
    const receiptKey = sha256(receipt.claims.jti);
    const receiptInsert = await client.query(
      `INSERT INTO mcp_collaboration_idempotency
         (tenant_id,operation,actor_subject_sha256,idempotency_key,request_sha256,state)
       VALUES ($1,$2,$3,$4,$5,'pending')
       ON CONFLICT DO NOTHING
       RETURNING state`,
      [EXPECTED_TENANT, RECEIPT_OPERATION, actor, receiptKey, receipt.digest],
    );
    if (!receiptInsert.rowCount) {
      throw safeError("render_staging_core_receipt_replayed", 409);
    }
    const mutationKey = mutationDigest;
    const mutationInsert = await client.query(
      `INSERT INTO mcp_collaboration_idempotency
         (tenant_id,operation,actor_subject_sha256,idempotency_key,request_sha256,state)
       VALUES ($1,$2,$3,$4,$5,'pending')
       ON CONFLICT DO NOTHING
       RETURNING state`,
      [EXPECTED_TENANT, MUTATION_OPERATION, MUTATION_ACTOR, mutationKey, mutationDigest],
    );
    if (!mutationInsert.rowCount) {
      const existingMutation = await client.query(
        `SELECT request_sha256,state,result_ref
         FROM mcp_collaboration_idempotency
         WHERE tenant_id=$1 AND operation=$2 AND actor_subject_sha256=$3 AND idempotency_key=$4
         FOR UPDATE`,
        [EXPECTED_TENANT, MUTATION_OPERATION, MUTATION_ACTOR, mutationKey],
      );
      const mutation = existingMutation.rows[0];
      if (!mutation || mutation.request_sha256 !== mutationDigest) {
        throw safeError("render_staging_mutation_binding_conflict", 409);
      }
      if (mutation.state !== "completed" || !mutation.result_ref) {
        throw safeError("render_staging_idempotency_in_progress", 409);
      }
      const replayResult = JSON.stringify(mutation.result_ref);
      const completedDeploy = await client.query(
        `UPDATE mcp_collaboration_idempotency
         SET state='completed',result_ref=$5::jsonb,completed_at=now()
         WHERE tenant_id=$1 AND operation=$2 AND actor_subject_sha256=$3
           AND idempotency_key=$4 AND state='pending'
         RETURNING state`,
        [EXPECTED_TENANT, DEPLOY_OPERATION, actor, key, replayResult],
      );
      const completedReceipt = await client.query(
        `UPDATE mcp_collaboration_idempotency
         SET state='completed',result_ref=$5::jsonb,completed_at=now()
         WHERE tenant_id=$1 AND operation=$2 AND actor_subject_sha256=$3
           AND idempotency_key=$4 AND request_sha256=$6 AND state='pending'
         RETURNING state`,
        [
          EXPECTED_TENANT,
          RECEIPT_OPERATION,
          actor,
          receiptKey,
          JSON.stringify({ consumed: true, replay: true }),
          receipt.digest,
        ],
      );
      if (completedDeploy.rowCount !== 1 || completedReceipt.rowCount !== 1) {
        throw safeError("render_staging_idempotency_completion_conflict", 409);
      }
      await client.query("COMMIT");
      return { replay: true, result: mutation.result_ref };
    }
    await client.query("COMMIT");
    return {
      replay: false,
      actor,
      key,
      receiptKey,
      receiptDigest: receipt.digest,
      mutationKey,
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function completeDurably(pool, reservation, result) {
  if (reservation.replay) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const deploy = await client.query(
      `UPDATE mcp_collaboration_idempotency
       SET state='completed',result_ref=$5::jsonb,completed_at=now()
       WHERE tenant_id=$1 AND operation=$2 AND actor_subject_sha256=$3
         AND idempotency_key=$4 AND state='pending'
       RETURNING state`,
      [EXPECTED_TENANT, DEPLOY_OPERATION, reservation.actor, reservation.key, JSON.stringify(result)],
    );
    const receipt = await client.query(
      `UPDATE mcp_collaboration_idempotency
       SET state='completed',result_ref=$5::jsonb,completed_at=now()
       WHERE tenant_id=$1 AND operation=$2 AND actor_subject_sha256=$3
         AND idempotency_key=$4 AND request_sha256=$6 AND state='pending'
       RETURNING state`,
      [
        EXPECTED_TENANT,
        RECEIPT_OPERATION,
        reservation.actor,
        reservation.receiptKey,
        JSON.stringify({ consumed: true }),
        reservation.receiptDigest,
      ],
    );
    const mutation = await client.query(
      `UPDATE mcp_collaboration_idempotency
       SET state='completed',result_ref=$5::jsonb,completed_at=now()
       WHERE tenant_id=$1 AND operation=$2 AND actor_subject_sha256=$3
         AND idempotency_key=$4 AND request_sha256=$6 AND state='pending'
       RETURNING state`,
      [
        EXPECTED_TENANT,
        MUTATION_OPERATION,
        MUTATION_ACTOR,
        reservation.mutationKey,
        JSON.stringify(result),
        reservation.mutationKey,
      ],
    );
    if (deploy.rowCount !== 1 || receipt.rowCount !== 1 || mutation.rowCount !== 1) {
      throw safeError("render_staging_idempotency_completion_conflict", 409);
    }
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export function createRenderStagingDeployHandlers(config, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const pool = options.pool;
  if (typeof fetchImpl !== "function") throw new Error("render_staging_fetch_unavailable");

  async function timedFetch(url, init, unavailableCode) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.renderStagingDeployTimeoutMs || 10_000);
    try {
      return await fetchImpl(url, { ...init, redirect: "error", signal: controller.signal });
    } catch {
      throw safeError(unavailableCode);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function api(path, { method = "GET", body } = {}) {
    return timedFetch(`${RENDER_API_BASE}${path}`, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.renderApiKey}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, "render_api_unavailable");
  }

  async function verifiedService() {
    const response = await api(`/services/${encodeURIComponent(config.renderUniversalCoreStagingServiceId)}`);
    return assertServiceBinding(await readJson(response, "render_service_read_failed"), config);
  }

  async function verifyCommitOnBranch(targetCommit) {
    if (!config.renderStagingGithubToken) {
      throw safeError("render_staging_github_binding_unavailable");
    }
    const branch = encodeURIComponent(EXPECTED_BRANCH);
    const url = `${GITHUB_API_ORIGIN}/repos/${EXPECTED_REPOSITORY}/compare/${targetCommit}...${branch}`;
    const response = await timedFetch(url, {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${config.renderStagingGithubToken}`,
        "x-github-api-version": "2022-11-28",
      },
    }, "render_staging_github_unavailable");
    const body = await readJson(response, "render_staging_github_compare_failed");
    if (!["ahead", "identical"].includes(String(body?.status || "")) ||
        String(body?.base_commit?.sha || "").toLowerCase() !== targetCommit) {
      throw safeError("render_staging_commit_not_on_authorized_branch", 409);
    }
  }

  async function recentDeploys() {
    const response = await api(
      `/services/${encodeURIComponent(config.renderUniversalCoreStagingServiceId)}/deploys?limit=20`,
    );
    const body = await readJson(response, "render_deploy_list_failed");
    return (Array.isArray(body) ? body : body?.deploys || []).map(deployRecord);
  }

  async function healthVerified(targetCommit) {
    if (!config.renderUniversalCoreStagingHealthUrl) return false;
    try {
      const response = await timedFetch(config.renderUniversalCoreStagingHealthUrl, {
        method: "GET",
        headers: { accept: "application/json" },
      }, "render_staging_health_unavailable");
      if (!response?.ok) return false;
      const body = await response.json();
      return body?.ok === true &&
        body?.build?.commit_verifiable === true &&
        String(body?.build?.commit_sha || "").toLowerCase() === targetCommit;
    } catch {
      return false;
    }
  }

  return {
    render_staging_deploy: async (args, identity, invocation = {}) => {
      assertExactRequest(args, config, identity);
      if (!DIGEST_PATTERN.test(String(invocation.argumentsDigest || "")) ||
          !DIGEST_PATTERN.test(String(invocation.catalogRevision || "")) ||
          !String(invocation.idempotencyKey || "").trim()) {
        throw safeError("render_staging_request_binding_missing", 403);
      }
      const receipt = verifyCoreReceipt(config, invocation, args, identity);
      if (String(invocation.idempotencyKey).length > 120 ||
          !String(identity?.confirmationReference || "").trim()) {
        throw safeError("render_staging_request_binding_missing", 403);
      }
      const targetCommit = String(args.target_commit).toLowerCase();
      const requestDigest = sha256({
        tenant_id: identity.tenantId,
        target_service_id: config.renderUniversalCoreStagingServiceId,
        target_service: args.target_service,
        target_environment: args.target_environment,
        target_branch: args.target_branch,
        target_commit: targetCommit,
        catalog_revision: invocation.catalogRevision,
        arguments_digest: invocation.argumentsDigest,
      });
      const mutationDigest = sha256({
        operation: MUTATION_OPERATION,
        tenant_id: EXPECTED_TENANT,
        target_service_id: config.renderUniversalCoreStagingServiceId,
        target_service: EXPECTED_SERVICE,
        target_environment: EXPECTED_ENVIRONMENT,
        target_branch: EXPECTED_BRANCH,
        target_commit: targetCommit,
      });
      const reservation = await reserveDurably(
        pool,
        identity,
        invocation,
        requestDigest,
        mutationDigest,
        receipt,
      );
      if (reservation.replay) return reservation.result;
      await verifyCommitOnBranch(targetCommit);
      await verifiedService();
      const existing = (await recentDeploys()).find((deploy) =>
        deployCommit(deploy) === targetCommit &&
        ACTIVE_DEPLOY_STATUSES.has(String(deploy?.status || "")),
      );
      let result;
      if (existing) {
        result = publicResult(existing, requestDigest, true);
      } else {
        const response = await api(
          `/services/${encodeURIComponent(config.renderUniversalCoreStagingServiceId)}/deploys`,
          {
            method: "POST",
            body: { clearCache: "do_not_clear", commitId: targetCommit },
          },
        );
        if (![201, 202].includes(Number(response?.status))) {
          throw safeError("render_deploy_trigger_failed", Number(response?.status || 503));
        }
        let created = null;
        try {
          created = await response.json();
        } catch {
          if (Number(response.status) !== 202) {
            throw safeError("render_deploy_response_invalid");
          }
        }
        const returnedDeploy = deployRecord(created);
        const returnedCommit = deployCommit(returnedDeploy);
        if (returnedCommit && returnedCommit !== targetCommit) {
          throw safeError("render_deploy_response_binding_mismatch");
        }
        result = publicResult({
          ...(returnedDeploy || {}),
          status: returnedDeploy?.status || "queued",
          commit: { ...(returnedDeploy?.commit || {}), id: targetCommit },
        }, requestDigest);
      }
      await completeDurably(pool, reservation, result);
      return result;
    },

    render_staging_deploy_status: async (args, identity) => {
      if (identity?.tenantId !== EXPECTED_TENANT) {
        throw safeError("render_staging_cross_tenant_denied", 403);
      }
      if (config.renderStagingDeployEnabled !== true) {
        throw safeError("render_staging_deploy_disabled");
      }
      if (args.target_service !== EXPECTED_SERVICE ||
          args.target_environment !== EXPECTED_ENVIRONMENT ||
          !COMMIT_PATTERN.test(String(args.target_commit || ""))) {
        throw safeError("render_staging_status_scope_mismatch", 403);
      }
      await verifiedService();
      const targetCommit = String(args.target_commit).toLowerCase();
      const deploy = (await recentDeploys()).find((candidate) => deployCommit(candidate) === targetCommit);
      if (!deploy) throw safeError("render_deploy_status_not_found", 404);
      const status = String(deploy.status || "unknown");
      const verified = status === "live" ? await healthVerified(targetCommit) : false;
      return {
        structuredContent: {
          ok: true,
          target_service: EXPECTED_SERVICE,
          target_environment: EXPECTED_ENVIRONMENT,
          deploy: publicDeploy(deploy, { healthVerified: verified }),
          terminal: TERMINAL_DEPLOY_STATUSES.has(status),
          successful: status === "live" && verified,
          secrets_exposed: false,
        },
        content: [{ type: "text", text: JSON.stringify({
          ok: true,
          status,
          terminal: TERMINAL_DEPLOY_STATUSES.has(status),
          health_verified: verified,
          secrets_exposed: false,
        }) }],
      };
    },
  };
}

export const RENDER_STAGING_DEPLOY_CONTRACT = Object.freeze({
  tenant_id: EXPECTED_TENANT,
  target_environment: EXPECTED_ENVIRONMENT,
  target_service: EXPECTED_SERVICE,
  target_branch: EXPECTED_BRANCH,
  repository: EXPECTED_REPOSITORY,
  api_origin: RENDER_API_ORIGIN,
  github_api_origin: GITHUB_API_ORIGIN,
  receipt_type: RECEIPT_TYPE,
});
