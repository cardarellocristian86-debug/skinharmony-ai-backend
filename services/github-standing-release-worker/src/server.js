import express from "express";
import crypto from "node:crypto";
import { createGitHubInstallationTokenResolver, parseGitHubAppBindings } from "./githubApp.js";
import { verifyGitHubWorkerExecutionClaim } from "../../shared/github-worker-execution-claim.js";
import { createFileExecutionLedger } from "./executionLedger.js";
import { createGitHubExecutor, createGitHubReconciler } from "./githubExecutor.js";

function boolean(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("github_worker_flag_invalid");
}

function positiveInteger(value, code) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(code);
  return parsed;
}

const JOIN_SCHEMA = "generic_work_core_join_v1";
const JOIN_PURPOSE = "generic_work_core_join_v1";
function joinSignaturePayload(digest) {
  return Buffer.from(`${JOIN_SCHEMA}\0${digest}`, "utf8");
}

export function createGitHubStandingReleaseWorker({ env = process.env, fetch_impl = fetch } = {}) {
  const enabled = boolean(env.GITHUB_STANDING_RELEASE_WORKER_ENABLED, false);
  const port = positiveInteger(env.PORT || 8792, "github_worker_port_invalid");
  let resolver = null;
  let ledger = null;
  let executor = null;
  let reconciler = null;
  let readinessError = null;
  try {
    if (enabled) {
      const appId = positiveInteger(env.GITHUB_APP_ID, "github_app_id_invalid");
      const privateKey = String(env.GITHUB_APP_PRIVATE_KEY || "").replaceAll("\\n", "\n");
      const bindings = parseGitHubAppBindings(env.GITHUB_APP_TENANT_BINDINGS_JSON);
      resolver = createGitHubInstallationTokenResolver({
        app_id: appId,
        private_key: privateKey,
        bindings,
        fetch_impl,
      });
      ledger = createFileExecutionLedger({
        root: String(env.GITHUB_WORKER_LEDGER_ROOT || "/var/data/github-standing-release-worker"),
        signing_secret: String(env.GITHUB_WORKER_LEDGER_SIGNING_SECRET || ""),
      });
      executor = createGitHubExecutor({ installation_token: resolver, fetch_impl });
      reconciler = createGitHubReconciler({ installation_token: resolver, fetch_impl });
      if (String(env.CORE_GITHUB_WORKER_EXECUTION_SIGNING_SECRET || "").length < 32) {
        throw new Error("github_worker_execution_secret_invalid");
      }
    }
  } catch (error) {
    readinessError = String(error?.code || error?.message || "github_worker_configuration_invalid");
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb", strict: true }));
  app.get("/livez", (_req, res) => res.status(200).json({ ok: true, service: "github-standing-release-worker" }));
  app.get("/healthz", (_req, res) => {
    const ready = enabled && resolver !== null && ledger !== null && executor !== null && reconciler !== null && readinessError === null;
    res.status(ready ? 200 : 503).json({
      ok: ready,
      service: "github-standing-release-worker",
      coordination_model: "horizontal_peer_adapters_v1",
      provider: "github_app",
      enabled,
      ready,
      execution_endpoint_enabled: ready,
      private_key_configured: enabled && Boolean(env.GITHUB_APP_PRIVATE_KEY),
      tenant_bindings_configured: enabled && Boolean(env.GITHUB_APP_TENANT_BINDINGS_JSON),
      configuration_error: readinessError,
    });
  });
  app.post("/v1/generic-work-core-join/sign", (req, res) => {
    const token = String(env.GENERIC_WORK_CORE_JOIN_SIGNER_SERVICE_TOKEN || "");
    if (!token || req.get("authorization") !== `Bearer ${token}`) return res.status(401).json({ error: "unauthorized" });
    const body = req.body;
    if (!body || body.schema_version !== JOIN_SCHEMA || body.service !== "universal-core-service" || body.purpose !== JOIN_PURPOSE ||
        !/^[a-f0-9]{64}$/.test(String(body.digest || "")) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(String(body.key_id || "")) ||
        !/^[a-f0-9]{40}$/.test(String(body.target_commit || ""))) return res.status(400).json({ error: "invalid_request" });
    try {
      const key = crypto.createPrivateKey(String(env.GENERIC_WORK_CORE_JOIN_SIGNER_PRIVATE_KEY || "").replaceAll("\\n", "\n"));
      if (key.asymmetricKeyType !== "ed25519") throw new Error("invalid_key");
      const signature = crypto.sign(null, joinSignaturePayload(body.digest), key).toString("base64url");
      return res.status(200).json({ schema_version: "generic_work_core_join_sign_response_v1", service: body.service, target_commit: body.target_commit, purpose: body.purpose, key_id: body.key_id, digest: body.digest, signature_algorithm: "ed25519", signature });
    } catch { return res.status(503).json({ error: "signer_unavailable" }); }
  });
  app.post("/v1/execute", async (req, res) => {
    if (!enabled || readinessError || !ledger || !executor) {
      return res.status(503).json({ error: "github_worker_unavailable" });
    }
    if (String(env.GITHUB_STANDING_RELEASE_WORKER_EMERGENCY_STOP || "false") === "true") {
      return res.status(503).json({ error: "github_worker_emergency_stop" });
    }
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
          Object.keys(req.body).some((key) => !new Set(["claim", "materialization"]).has(key))) {
        throw new Error("github_worker_request_invalid");
      }
      const claim = verifyGitHubWorkerExecutionClaim(req.body.claim, {
        signing_secret: env.CORE_GITHUB_WORKER_EXECUTION_SIGNING_SECRET,
      });
      const accepted = ledger.accept(claim);
      if (accepted.state === "succeeded") {
        return res.status(200).json({ ok: true, execution: accepted, provider_execution: true, idempotent: true });
      }
      if (!["accepted", "in_progress"].includes(accepted.state)) {
        return res.status(409).json({ error: "github_worker_execution_terminal", execution: accepted });
      }
      const active = ledger.begin(claim);
      if (active.state !== "in_progress") {
        return res.status(409).json({ error: "github_worker_execution_outcome_unknown", execution: active });
      }
      if (String(env.GITHUB_STANDING_RELEASE_WORKER_EMERGENCY_STOP || "false") === "true") {
        const stopped = ledger.finish(claim, { state: "failed", result: { reason: "emergency_stop_before_effect" } });
        return res.status(503).json({ error: "github_worker_emergency_stop", execution: stopped });
      }
      try {
        const result = await executor(claim, { materialization: req.body.materialization ?? null });
        const completed = ledger.finish(claim, { state: "succeeded", result });
        return res.status(200).json({ ok: true, execution: completed, provider_execution: true });
      } catch {
        const unknown = ledger.finish(claim, { state: "outcome_unknown", result: null });
        return res.status(409).json({ error: "github_worker_execution_outcome_unknown", execution: unknown });
      }
    } catch (error) {
      return res.status(400).json({ error: String(error?.code || error?.message || "github_worker_request_invalid") });
    }
  });
  app.post("/v1/reconcile", async (req, res) => {
    if (!enabled || readinessError || !ledger || !reconciler) return res.status(503).json({ error: "github_worker_unavailable" });
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).some((key) => key !== "claim")) {
        throw new Error("github_worker_request_invalid");
      }
      const claim = verifyGitHubWorkerExecutionClaim(req.body.claim, {
        signing_secret: env.CORE_GITHUB_WORKER_EXECUTION_SIGNING_SECRET,
        allow_expired_for_reconciliation: true,
      });
      const existing = ledger.read(claim.nonce);
      if (!existing) throw new Error("github_worker_execution_not_accepted");
      if (existing.state === "succeeded" || existing.state === "failed") {
        return res.status(200).json({ ok: true, execution: existing, provider_execution: false, idempotent: true });
      }
      if (existing.state !== "outcome_unknown") return res.status(409).json({ error: "github_worker_execution_not_reconcilable" });
      const outcome = await reconciler(claim);
      const reconciled = ledger.reconcile(claim, outcome);
      return res.status(200).json({ ok: true, execution: reconciled, provider_execution: false });
    } catch (error) {
      return res.status(409).json({ error: String(error?.code || error?.message || "github_worker_reconciliation_failed") });
    }
  });
  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  return Object.freeze({ app, port, enabled, resolver, ledger, executor, reconciler, readiness_error: readinessError });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const worker = createGitHubStandingReleaseWorker();
  worker.app.listen(worker.port, "0.0.0.0", () => {
    process.stdout.write(`github-standing-release-worker listening on ${worker.port}\n`);
  });
}
