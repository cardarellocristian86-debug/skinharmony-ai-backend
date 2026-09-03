import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  githubWorkerActionDigest,
  signGitHubWorkerExecutionClaim,
} from "../../shared/github-worker-execution-claim.js";
import { createGitHubStandingReleaseWorker } from "../src/server.js";

test("a provider timeout is quarantined once and only explicit reconciliation reads GitHub", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "github-worker-transport-"));
  const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const signingSecret = "test-only-execution-signing-secret-0123456789";
  const title = "Bounded draft";
  const body = "A transport timeout must not repeat this mutation.";
  const repository = "customer/example";
  const action = {
    kind: "github.draft_pr",
    repository,
    provider_execution: false,
    force: false,
    delete_ref: false,
    tags: false,
    head_branch: "agent/bounded-transport",
    base_branch: "main",
    head_commit: "a".repeat(40),
    expected_base_commit: "b".repeat(40),
    changed_files: ["src/app.js"],
    title_digest: crypto.createHash("sha256").update(title).digest("hex"),
    body_digest: crypto.createHash("sha256").update(body).digest("hex"),
    draft: true,
  };
  const now = Date.now();
  const claim = signGitHubWorkerExecutionClaim({
    schema_version: "github_worker_execution_claim_v1",
    tenant_id: "customer-a",
    work_id: "11111111-1111-4111-8111-111111111111",
    repository,
    ticket_id: "ticket-bounded-transport",
    reservation_id: "reservation-bounded-transport",
    action,
    action_digest: githubWorkerActionDigest(action),
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60_000).toISOString(),
    nonce: crypto.createHash("sha256").update("bounded-transport-nonce").digest("hex"),
    provider_execution: false,
  }, { signing_secret: signingSecret });

  const calls = [];
  let mutationSignal = null;
  const worker = createGitHubStandingReleaseWorker({
    env: {
      PORT: "8792",
      GITHUB_STANDING_RELEASE_WORKER_ENABLED: "true",
      GITHUB_STANDING_RELEASE_WORKER_EMERGENCY_STOP: "false",
      GITHUB_API_REQUEST_TIMEOUT_MS: "100",
      GITHUB_API_RESPONSE_LIMIT_BYTES: "65536",
      GITHUB_APP_ID: "123",
      GITHUB_APP_PRIVATE_KEY: keys.privateKey.export({ type: "pkcs8", format: "pem" }),
      GITHUB_APP_TENANT_BINDINGS_JSON: JSON.stringify({
        schema_version: "github_app_tenant_bindings_v1",
        bindings: [{ tenant_id: "customer-a", installation_id: 123, repositories: [repository] }],
      }),
      GITHUB_WORKER_LEDGER_ROOT: root,
      GITHUB_WORKER_LEDGER_SIGNING_SECRET: "test-only-ledger-signing-secret-0123456789",
      CORE_GITHUB_WORKER_EXECUTION_SIGNING_SECRET: signingSecret,
      RENDER_GIT_COMMIT: "c".repeat(40),
      RENDER_DEPLOY_ID: "deploy-transport-test",
    },
    fetch_impl: async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return new Response(JSON.stringify({
          token: "temporary-installation-token-for-test",
          expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
          repositories: [{ full_name: repository }],
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
      if (calls.length === 2) {
        mutationSignal = init.signal;
        return new Promise(() => {});
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(worker.readiness_error, null);

  const server = worker.app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, requestBody) => {
    const response = await fetch(`${origin}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    return { status: response.status, body: await response.json() };
  };

  try {
    const uncertain = await post("/v1/execute", { claim, materialization: { title, body } });
    assert.equal(uncertain.status, 409);
    assert.equal(uncertain.body.error, "github_worker_execution_outcome_unknown");
    assert.equal(uncertain.body.execution.state, "outcome_unknown");
    assert.equal(mutationSignal?.aborted, true);
    assert.equal(calls.length, 2);

    const replay = await post("/v1/execute", { claim, materialization: { title, body } });
    assert.equal(replay.status, 409);
    assert.equal(replay.body.error, "github_worker_execution_terminal");
    assert.equal(replay.body.execution.state, "outcome_unknown");
    assert.equal(calls.length, 2);

    const reconciled = await post("/v1/reconcile", { claim });
    assert.equal(reconciled.status, 200);
    assert.equal(reconciled.body.execution.state, "failed");
    assert.equal(reconciled.body.execution.result.reconciled, true);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].init.method, "GET");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a proven pre-effect executor error is terminal failure, not outcome_unknown", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "github-worker-pre-effect-"));
  const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const signingSecret = "test-only-execution-signing-secret-0123456789";
  const repository = "customer/example";
  const action = {
    kind: "git.push.branch",
    repository,
    provider_execution: false,
    force: false,
    delete_ref: false,
    tags: false,
    branch: "agent/pre-effect",
    source_commit: "a".repeat(40),
    expected_remote_commit: "b".repeat(40),
    changed_files: ["src/app.js"],
    induced_effects: [],
  };
  const now = Date.now();
  const claim = signGitHubWorkerExecutionClaim({
    schema_version: "github_worker_execution_claim_v1",
    tenant_id: "customer-a",
    work_id: "11111111-1111-4111-8111-111111111111",
    repository,
    ticket_id: "ticket-pre-effect-failure",
    reservation_id: "reservation-pre-effect-failure",
    action,
    action_digest: githubWorkerActionDigest(action),
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60_000).toISOString(),
    nonce: crypto.createHash("sha256").update("pre-effect-failure-nonce").digest("hex"),
    provider_execution: false,
  }, { signing_secret: signingSecret });
  let calls = 0;
  const worker = createGitHubStandingReleaseWorker({
    env: {
      PORT: "8792",
      GITHUB_STANDING_RELEASE_WORKER_ENABLED: "true",
      GITHUB_STANDING_RELEASE_WORKER_EMERGENCY_STOP: "false",
      GITHUB_WORKER_REQUEST_DEADLINE_MS: "18000",
      GITHUB_API_REQUEST_TIMEOUT_MS: "8000",
      GITHUB_API_RESPONSE_LIMIT_BYTES: "65536",
      GITHUB_APP_ID: "123",
      GITHUB_APP_PRIVATE_KEY: keys.privateKey.export({ type: "pkcs8", format: "pem" }),
      GITHUB_APP_TENANT_BINDINGS_JSON: JSON.stringify({
        schema_version: "github_app_tenant_bindings_v1",
        bindings: [{ tenant_id: "customer-a", installation_id: 123, repositories: [repository] }],
      }),
      GITHUB_WORKER_LEDGER_ROOT: root,
      GITHUB_WORKER_LEDGER_SIGNING_SECRET: "test-only-ledger-signing-secret-0123456789",
      CORE_GITHUB_WORKER_EXECUTION_SIGNING_SECRET: signingSecret,
      RENDER_GIT_COMMIT: "c".repeat(40),
      RENDER_DEPLOY_ID: "deploy-pre-effect-test",
    },
    fetch_impl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ message: "installation denied" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const server = worker.app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ claim }),
    });
    const payload = await response.json();
    assert.equal(response.status, 409);
    assert.equal(payload.error, "github_worker_execution_failed");
    assert.equal(payload.execution.state, "failed");
    assert.deepEqual(payload.execution.result, {
      outcome: "failure",
      reason: "github_app_installation_token_unavailable",
      mutation_dispatched: false,
    });
    assert.equal(calls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("every HTTP error after mutation dispatch stays unknown until exact reconciliation", async (t) => {
  const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const signingSecret = "test-only-execution-signing-secret-0123456789";
  const repository = "customer/example";
  const cases = [
    { name: "draft PR 500", kind: "github.draft_pr", status: 500 },
    { name: "draft PR 422", kind: "github.draft_pr", status: 422 },
    { name: "push 429", kind: "git.push.branch", status: 429 },
    { name: "push 408", kind: "git.push.branch", status: 408 },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "github-worker-http-outcome-"));
      const title = `Bounded ${fixture.name}`;
      const body = "A post-dispatch HTTP status requires reconciliation.";
      const shared = {
        repository,
        provider_execution: false,
        force: false,
        delete_ref: false,
        tags: false,
        changed_files: ["src/app.js"],
      };
      const action = fixture.kind === "github.draft_pr"
        ? {
            ...shared,
            kind: fixture.kind,
            head_branch: "agent/http-outcome",
            base_branch: "main",
            head_commit: "a".repeat(40),
            expected_base_commit: "b".repeat(40),
            title_digest: crypto.createHash("sha256").update(title).digest("hex"),
            body_digest: crypto.createHash("sha256").update(body).digest("hex"),
            draft: true,
          }
        : {
            ...shared,
            kind: fixture.kind,
            branch: "agent/http-outcome",
            source_commit: "a".repeat(40),
            expected_remote_commit: "b".repeat(40),
            induced_effects: [],
          };
      const now = Date.now();
      const claim = signGitHubWorkerExecutionClaim({
        schema_version: "github_worker_execution_claim_v1",
        tenant_id: "customer-a",
        work_id: "11111111-1111-4111-8111-111111111111",
        repository,
        ticket_id: `ticket-http-${fixture.status}-${fixture.kind}`,
        reservation_id: `reservation-http-${fixture.status}-${fixture.kind}`,
        action,
        action_digest: githubWorkerActionDigest(action),
        issued_at: new Date(now).toISOString(),
        expires_at: new Date(now + 60_000).toISOString(),
        nonce: crypto.createHash("sha256").update(fixture.name).digest("hex"),
        provider_execution: false,
      }, { signing_secret: signingSecret });
      const calls = [];
      const mutationCall = fixture.kind === "github.draft_pr" ? 2 : 3;
      const reconcileCall = mutationCall + 1;
      const worker = createGitHubStandingReleaseWorker({
        env: {
          PORT: "8792",
          GITHUB_STANDING_RELEASE_WORKER_ENABLED: "true",
          GITHUB_STANDING_RELEASE_WORKER_EMERGENCY_STOP: "false",
          GITHUB_WORKER_REQUEST_DEADLINE_MS: "18000",
          GITHUB_API_REQUEST_TIMEOUT_MS: "8000",
          GITHUB_API_RESPONSE_LIMIT_BYTES: "65536",
          GITHUB_APP_ID: "123",
          GITHUB_APP_PRIVATE_KEY: keys.privateKey.export({ type: "pkcs8", format: "pem" }),
          GITHUB_APP_TENANT_BINDINGS_JSON: JSON.stringify({
            schema_version: "github_app_tenant_bindings_v1",
            bindings: [{ tenant_id: "customer-a", installation_id: 123, repositories: [repository] }],
          }),
          GITHUB_WORKER_LEDGER_ROOT: root,
          GITHUB_WORKER_LEDGER_SIGNING_SECRET: "test-only-ledger-signing-secret-0123456789",
          CORE_GITHUB_WORKER_EXECUTION_SIGNING_SECRET: signingSecret,
          RENDER_GIT_COMMIT: "c".repeat(40),
          RENDER_DEPLOY_ID: `deploy-http-${fixture.status}`,
        },
        fetch_impl: async (url, init) => {
          calls.push({ url, init });
          if (calls.length === 1) {
            return new Response(JSON.stringify({
              token: "temporary-installation-token-for-http-test",
              expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
              repositories: [{ full_name: repository }],
            }), { status: 201, headers: { "content-type": "application/json" } });
          }
          if (fixture.kind === "git.push.branch" && calls.length === 2) {
            return new Response(JSON.stringify({ object: { sha: "b".repeat(40) } }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          if (calls.length === mutationCall) {
            return new Response(JSON.stringify({ message: `provider status ${fixture.status}` }), {
              status: fixture.status,
              headers: { "content-type": "application/json" },
            });
          }
          if (calls.length === reconcileCall) {
            const reconciliation = fixture.kind === "github.draft_pr"
              ? []
              : { object: { sha: "b".repeat(40) } };
            return new Response(JSON.stringify(reconciliation), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          throw new Error("unexpected_fetch_retry");
        },
      });
      const server = worker.app.listen(0, "127.0.0.1");
      await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
      const origin = `http://127.0.0.1:${server.address().port}`;
      const post = async (route, payload) => {
        const response = await fetch(`${origin}${route}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        return { status: response.status, payload: await response.json() };
      };
      try {
        const request = {
          claim,
          ...(fixture.kind === "github.draft_pr"
            ? { materialization: { title, body } }
            : {}),
        };
        const uncertain = await post("/v1/execute", request);
        assert.equal(uncertain.status, 409);
        assert.equal(uncertain.payload.error, "github_worker_execution_outcome_unknown");
        assert.equal(uncertain.payload.execution.state, "outcome_unknown");
        assert.equal(calls.length, mutationCall, "mutation HTTP response must not trigger retry");

        const reconciled = await post("/v1/reconcile", { claim });
        assert.equal(reconciled.status, 200);
        assert.equal(reconciled.payload.execution.state, "failed");
        assert.equal(reconciled.payload.execution.result.outcome, "failure");
        assert.equal(reconciled.payload.execution.result.reconciled, true);
        assert.equal(calls.length, reconcileCall);
        assert.equal(calls.at(-1).init.method, "GET");
      } finally {
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
