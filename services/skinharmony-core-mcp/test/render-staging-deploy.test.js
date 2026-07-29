import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  RENDER_STAGING_DEPLOY_CONTRACT,
  createRenderStagingDeployHandlers,
} from "../src/render-staging-deploy.js";

const COMMIT = "c774e198d675975dce5dad7053899e2bd1e16ef5";
const SERVICE_ID = "srv-abcdefgh12345678";
const ENVIRONMENT_ID = "evm-abcdefgh12345678";
const DEPLOY_ID = "dep-abcdefgh12345678";
const KID = "core-staging-2026-07";
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const PUBLIC_JWK = publicKey.export({ format: "jwk" });
const identity = {
  tenantId: "codexai",
  subject: "owner:test",
  confirmationReference: "owner-confirmation:test",
};

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function service(overrides = {}) {
  return {
    id: SERVICE_ID,
    name: "skinharmony-universal-core-staging",
    type: "web_service",
    repo: "https://github.com/cardarellocristian86-debug/skinharmony-ai-backend.git",
    branch: "agent/nyra-policy-registry",
    environmentId: ENVIRONMENT_ID,
    autoDeploy: false,
    ...overrides,
  };
}

function deploy(overrides = {}) {
  return {
    id: DEPLOY_ID,
    status: "created",
    commit: { id: COMMIT },
    createdAt: "2026-07-28T21:00:00.000Z",
    ...overrides,
  };
}

function config(overrides = {}) {
  return {
    renderStagingDeployEnabled: true,
    renderApiKey: "render-test-key-never-returned",
    renderUniversalCoreStagingServiceId: SERVICE_ID,
    renderUniversalCoreStagingEnvironmentId: ENVIRONMENT_ID,
    renderUniversalCoreStagingHealthUrl:
      "https://skinharmony-universal-core-staging.onrender.com/healthz",
    renderStagingDeployTimeoutMs: 1_000,
    renderStagingGithubToken: "github-read-token-never-returned",
    renderStagingCoreReceiptJwk: PUBLIC_JWK,
    renderStagingCoreReceiptKid: KID,
    renderStagingCoreReceiptIssuer: "universal-core-staging",
    renderStagingCoreReceiptAudience: "https://mcp-staging.example.test/mcp",
    renderStagingCoreReceiptTtlMs: 30_000,
    ...overrides,
  };
}

function deployArgs(overrides = {}) {
  return {
    target_service: "skinharmony-universal-core-staging",
    target_environment: "staging",
    target_branch: "agent/nyra-policy-registry",
    target_commit: COMMIT,
    clear_build_cache: false,
    modify_environment_variables: false,
    database_changes: false,
    auth0_changes: false,
    production_deploy: false,
    merge: false,
    delete: false,
    cross_tenant: false,
    ...overrides,
  };
}

function compactReceipt(claimOverrides = {}, headerOverrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "EdDSA",
    kid: KID,
    typ: "render_staging_core_receipt_v1",
    ...headerOverrides,
  };
  const claims = {
    receipt_type: "render_staging_core_receipt_v1",
    iss: "universal-core-staging",
    aud: "https://mcp-staging.example.test/mcp",
    tenant_id: "codexai",
    capability_id: "render_staging_deploy",
    catalog_revision: "b".repeat(64),
    arguments_digest: "a".repeat(64),
    idempotency_key_sha256: crypto.createHash("sha256")
      .update("deploy-policy-registry-c774e198").digest("hex"),
    actor_subject_sha256: crypto.createHash("sha256")
      .update("codexai:owner:test").digest("hex"),
    confirmation_reference_sha256: crypto.createHash("sha256")
      .update("owner-confirmation:test").digest("hex"),
    target_service_id: SERVICE_ID,
    target_service: "skinharmony-universal-core-staging",
    target_environment: "staging",
    target_branch: "agent/nyra-policy-registry",
    target_commit: COMMIT,
    single_use: true,
    iat: now,
    exp: now + 25,
    jti: `receipt-${crypto.randomUUID()}`,
    ...claimOverrides,
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.sign(
    null,
    Buffer.from(`${encodedHeader}.${encodedClaims}`),
    privateKey,
  ).toString("base64url");
  return `${encodedHeader}.${encodedClaims}.${signature}`;
}

function invocation(overrides = {}, claimOverrides = {}, headerOverrides = {}) {
  return {
    argumentsDigest: "a".repeat(64),
    catalogRevision: "b".repeat(64),
    idempotencyKey: "deploy-policy-registry-c774e198",
    gate: {
      structuredContent: {
        authorization: {
          allowed: true,
          core_receipt: compactReceipt(claimOverrides, headerOverrides),
        },
      },
    },
    ...overrides,
  };
}

function memoryPool() {
  const rows = new Map();
  const key = (params) => params.slice(0, 4).join("|");
  const client = {
    async query(sql, params = []) {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO mcp_collaboration_idempotency")) {
        const rowKey = key(params);
        if (rows.has(rowKey)) return { rowCount: 0, rows: [] };
        rows.set(rowKey, { request_sha256: params[4], state: "pending", result_ref: null });
        return { rowCount: 1, rows: [{ state: "pending" }] };
      }
      if (sql.includes("SELECT request_sha256,state,result_ref")) {
        const row = rows.get(key(params));
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (sql.includes("UPDATE mcp_collaboration_idempotency")) {
        const row = rows.get(key(params));
        if (!row || row.state !== "pending" || (params[5] && row.request_sha256 !== params[5])) {
          return { rowCount: 0, rows: [] };
        }
        row.state = "completed";
        row.result_ref = JSON.parse(params[4]);
        return { rowCount: 1, rows: [{ state: "completed" }] };
      }
      throw new Error(`unexpected sql:${sql}`);
    },
    release() {},
  };
  return { connect: async () => client, rows };
}

function successfulFetch({ deploys = [], health, githubStatus = "identical", serviceRecord } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith("https://api.github.com/")) {
      return response(200, { status: githubStatus, base_commit: { sha: COMMIT } });
    }
    if (url === `https://api.render.com/v1/services/${SERVICE_ID}`) {
      return response(200, serviceRecord || service());
    }
    if (url === `https://api.render.com/v1/services/${SERVICE_ID}/deploys?limit=20`) {
      return response(200, deploys);
    }
    if (url === `https://api.render.com/v1/services/${SERVICE_ID}/deploys`) {
      return response(201, deploy());
    }
    if (url === "https://skinharmony-universal-core-staging.onrender.com/healthz") {
      return response(200, health || {
        ok: true,
        build: { commit_verifiable: true, commit_sha: COMMIT },
      });
    }
    throw new Error(`unexpected:${url}`);
  };
  return { fetch, calls };
}

test("contract is hard-pinned to staging, GitHub, and the signed receipt type", () => {
  assert.deepEqual(RENDER_STAGING_DEPLOY_CONTRACT, {
    tenant_id: "codexai",
    target_environment: "staging",
    target_service: "skinharmony-universal-core-staging",
    target_branch: "agent/nyra-policy-registry",
    repository: "cardarellocristian86-debug/skinharmony-ai-backend",
    api_origin: "https://api.render.com",
    github_api_origin: "https://api.github.com",
    receipt_type: "render_staging_core_receipt_v1",
  });
});

test("proves the commit is on the branch, verifies service, and triggers only that commit", async () => {
  const remote = successfulFetch();
  const handlers = createRenderStagingDeployHandlers(config(), {
    fetch: remote.fetch,
    pool: memoryPool(),
  });
  const result = await handlers.render_staging_deploy(deployArgs(), identity, invocation());

  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.deploy.commit, COMMIT);
  assert.equal(result.structuredContent.deploy.deploy_id_redacted, "dep-abcd…");
  assert.equal(JSON.stringify(result).includes("never-returned"), false);
  assert.match(remote.calls[0].url, /api\.github\.com\/repos\/.*\/compare\//);
  const trigger = remote.calls.at(-1);
  assert.equal(trigger.init.method, "POST");
  assert.deepEqual(JSON.parse(trigger.init.body), {
    clearCache: "do_not_clear",
    commitId: COMMIT,
  });
});

test("fails before any network access for forbidden scope or missing durable store", async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return response(500, {});
  };
  const handlers = createRenderStagingDeployHandlers(config(), { fetch, pool: memoryPool() });
  for (const args of [
    deployArgs({ target_environment: "production" }),
    deployArgs({ target_branch: "main" }),
    deployArgs({ modify_environment_variables: true }),
    deployArgs({ database_changes: true }),
    deployArgs({ auth0_changes: true }),
    deployArgs({ production_deploy: true }),
    deployArgs({ merge: true }),
    deployArgs({ delete: true }),
    deployArgs({ cross_tenant: true }),
  ]) {
    await assert.rejects(
      handlers.render_staging_deploy(args, identity, invocation()),
      /render_staging_deploy_scope_mismatch/,
    );
  }
  await assert.rejects(
    handlers.render_staging_deploy(deployArgs(), { ...identity, tenantId: "other" }, invocation()),
    /render_staging_cross_tenant_denied/,
  );
  const noPool = createRenderStagingDeployHandlers(config(), { fetch });
  await assert.rejects(
    noPool.render_staging_deploy(deployArgs(), identity, invocation()),
    /render_staging_durable_store_required/,
  );
  assert.equal(calls, 0);
});

test("rejects missing, forged, expired, replayed, or request-mismatched Core receipts", async () => {
  const remote = successfulFetch();
  const pool = memoryPool();
  const handlers = createRenderStagingDeployHandlers(config(), { fetch: remote.fetch, pool });
  await assert.rejects(
    handlers.render_staging_deploy(deployArgs(), identity, {
      ...invocation(),
      gate: { structuredContent: { authorization: { allowed: true } } },
    }),
    /render_staging_core_receipt_required/,
  );
  await assert.rejects(
    handlers.render_staging_deploy(deployArgs(), identity, invocation({}, { target_commit: "d".repeat(40) })),
    /render_staging_core_receipt_binding_mismatch/,
  );
  await assert.rejects(
    handlers.render_staging_deploy(
      deployArgs(),
      { ...identity, subject: "owner:other" },
      invocation(),
    ),
    /render_staging_core_receipt_binding_mismatch/,
  );
  await assert.rejects(
    handlers.render_staging_deploy(
      deployArgs(),
      { ...identity, confirmationReference: "owner-confirmation:other" },
      invocation(),
    ),
    /render_staging_core_receipt_binding_mismatch/,
  );
  await assert.rejects(
    handlers.render_staging_deploy(deployArgs(), identity, invocation({}, {
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) - 30,
    })),
    /render_staging_core_receipt_expired_or_invalid/,
  );
  await assert.rejects(
    handlers.render_staging_deploy(deployArgs(), identity, invocation({}, {
      iat: Math.floor(Date.now() / 1000) - 1,
      exp: Math.floor(Date.now() / 1000),
    })),
    /render_staging_core_receipt_expired_or_invalid/,
  );
  const forged = invocation();
  forged.gate.structuredContent.authorization.core_receipt =
    `${forged.gate.structuredContent.authorization.core_receipt.slice(0, -2)}aa`;
  await assert.rejects(
    handlers.render_staging_deploy(deployArgs(), identity, forged),
    /render_staging_core_receipt_signature_invalid/,
  );

  const oneReceipt = compactReceipt();
  const first = invocation();
  first.gate.structuredContent.authorization.core_receipt = oneReceipt;
  await handlers.render_staging_deploy(deployArgs(), identity, first);
  const second = invocation({ idempotencyKey: "different-idempotency-key" }, {
    idempotency_key_sha256: crypto.createHash("sha256").update("different-idempotency-key").digest("hex"),
  });
  second.gate.structuredContent.authorization.core_receipt = oneReceipt;
  await assert.rejects(
    handlers.render_staging_deploy(deployArgs(), identity, second),
    /render_staging_core_receipt_binding_mismatch|render_staging_core_receipt_replayed/,
  );
});

test("fails closed when GitHub cannot prove branch ancestry or service binding drifts", async () => {
  for (const setup of [
    { githubStatus: "diverged", expected: /render_staging_commit_not_on_authorized_branch/ },
    { serviceRecord: service({ autoDeploy: true }), expected: /render_staging_service_binding_mismatch/ },
  ]) {
    const remote = successfulFetch(setup);
    const handlers = createRenderStagingDeployHandlers(config(), {
      fetch: remote.fetch,
      pool: memoryPool(),
    });
    await assert.rejects(
      handlers.render_staging_deploy(deployArgs(), identity, invocation()),
      setup.expected,
    );
    assert.equal(remote.calls.some((call) => call.init.method === "POST"), false);
  }
});

test("durable idempotency replays completed results and rejects conflicting bindings", async () => {
  const remote = successfulFetch();
  const pool = memoryPool();
  const firstReplica = createRenderStagingDeployHandlers(config(), { fetch: remote.fetch, pool });
  const secondReplica = createRenderStagingDeployHandlers(config(), {
    fetch: async () => { throw new Error("replay must not call provider"); },
    pool,
  });
  const first = await firstReplica.render_staging_deploy(deployArgs(), identity, invocation());
  const replayKey = "deploy-policy-registry-replay-key";
  const replay = await secondReplica.render_staging_deploy(
    deployArgs(),
    identity,
    invocation(
      {
        idempotencyKey: replayKey,
        catalogRevision: "c".repeat(64),
        argumentsDigest: "d".repeat(64),
      },
      {
        idempotency_key_sha256: crypto.createHash("sha256")
          .update(replayKey).digest("hex"),
        catalog_revision: "c".repeat(64),
        arguments_digest: "d".repeat(64),
      },
    ),
  );
  assert.deepEqual(replay, first);

  await assert.rejects(
    secondReplica.render_staging_deploy(
      deployArgs({ target_commit: "d".repeat(40) }),
      identity,
      invocation(
        { argumentsDigest: "c".repeat(64) },
        { arguments_digest: "c".repeat(64), target_commit: "d".repeat(40) },
      ),
    ),
    /render_staging_idempotency_key_reused/,
  );
});

test("two replicas cannot reserve the same mutation even with different idempotency keys", async () => {
  const pool = memoryPool();
  let releaseGithub;
  const githubWait = new Promise((resolve) => { releaseGithub = resolve; });
  const firstRemote = successfulFetch();
  const delayedFetch = async (url, init) => {
    if (url.startsWith("https://api.github.com/")) await githubWait;
    return firstRemote.fetch(url, init);
  };
  const firstReplica = createRenderStagingDeployHandlers(config(), { fetch: delayedFetch, pool });
  const secondReplica = createRenderStagingDeployHandlers(config(), { fetch: firstRemote.fetch, pool });
  const first = firstReplica.render_staging_deploy(deployArgs(), identity, invocation());
  await new Promise((resolve) => setImmediate(resolve));
  const secondKey = "deploy-policy-registry-second-key";
  await assert.rejects(
    secondReplica.render_staging_deploy(
      deployArgs(),
      identity,
      invocation(
        {
          idempotencyKey: secondKey,
          catalogRevision: "c".repeat(64),
          argumentsDigest: "d".repeat(64),
        },
        {
          idempotency_key_sha256: crypto.createHash("sha256")
            .update(secondKey).digest("hex"),
          catalog_revision: "c".repeat(64),
          arguments_digest: "d".repeat(64),
        },
      ),
    ),
    /render_staging_idempotency_in_progress/,
  );
  releaseGithub();
  await first;
});

test("status succeeds only when health proves the exact verifiable commit", async () => {
  for (const [health, successful] of [
    [{ ok: true, build: { commit_verifiable: true, commit_sha: COMMIT } }, true],
    [{ ok: true, build: { commit_verifiable: true, commit_sha: "d".repeat(40) } }, false],
    [{ ok: true }, false],
  ]) {
    const remote = successfulFetch({ deploys: [deploy({ status: "live" })], health });
    const handlers = createRenderStagingDeployHandlers(config(), {
      fetch: remote.fetch,
      pool: memoryPool(),
    });
    const result = await handlers.render_staging_deploy_status({
      target_service: "skinharmony-universal-core-staging",
      target_environment: "staging",
      target_commit: COMMIT,
    }, identity);
    assert.equal(result.structuredContent.successful, successful);
    assert.equal(result.structuredContent.deploy.health_verified, successful);
  }
});
