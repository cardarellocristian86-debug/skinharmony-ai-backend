import express from "express";
import healthContract from "../../shared/host-native-health-contract.cjs";
import { createGitHubInstallationTokenResolver, parseGitHubAppBindings } from "./githubApp.js";
import { verifyGitHubWorkerExecutionClaim } from "../../shared/github-worker-execution-claim.js";
import { createFileExecutionLedger } from "./executionLedger.js";
import { createGitHubExecutor, createGitHubReconciler } from "./githubExecutor.js";
import {
  GENERIC_WORK_CORE_JOIN_SIGN_ROUTE,
  createGenericWorkCoreJoinSignerEndpoint,
} from "./genericWorkCoreJoinSigner.js";

const WORKER_VERSION = "1.0.0";

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

export function createGitHubStandingReleaseWorker({ env = process.env, fetch_impl = fetch } = {}) {
  const enabled = boolean(env.GITHUB_STANDING_RELEASE_WORKER_ENABLED, false);
  const port = positiveInteger(env.PORT || 8792, "github_worker_port_invalid");
  const build = healthContract.buildIdentity(env);
  let emergencyStop = false;
  let resolver = null;
  let ledger = null;
  let executor = null;
  let reconciler = null;
  let readinessError = null;
  try {
    emergencyStop = boolean(env.GITHUB_STANDING_RELEASE_WORKER_EMERGENCY_STOP, false);
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
  const signerEndpoint = createGenericWorkCoreJoinSignerEndpoint({ env });
  const workerReady = () => enabled
    && resolver !== null
    && ledger !== null
    && executor !== null
    && reconciler !== null
    && readinessError === null
    && build.commit_verifiable === true;

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb", strict: true }));
  app.get("/livez", (_req, res) => res.status(200).json({ ok: true, service: "github-standing-release-worker" }));
  app.get("/healthz", (_req, res) => {
    const executionReady = workerReady() && !emergencyStop;
    const signerHealth = signerEndpoint.health({
      worker_enabled: enabled,
      worker_ready: workerReady(),
      emergency_stop: emergencyStop,
    });
    // The GitHub execution adapter and Generic Join signer are independent
    // horizontal capabilities. Each publishes and enforces its own readiness.
    const ready = executionReady;
    const hostHealth = healthContract.healthPayload({
      service: "github-standing-release-worker",
      version: WORKER_VERSION,
      ready,
      environment: env,
    });
    res.status(hostHealth.render_ready ? 200 : 503).json({
      ...hostHealth,
      coordination_model: "horizontal_peer_adapters_v1",
      provider: "github_app",
      enabled,
      ready,
      emergency_stop: emergencyStop,
      execution_endpoint_enabled: executionReady,
      private_key_configured: enabled && Boolean(env.GITHUB_APP_PRIVATE_KEY),
      tenant_bindings_configured: enabled && Boolean(env.GITHUB_APP_TENANT_BINDINGS_JSON),
      configuration_error: readinessError,
      generic_work_core_join_signer: signerHealth,
    });
  });
  app.post(GENERIC_WORK_CORE_JOIN_SIGN_ROUTE, (req, res) => signerEndpoint.handle(req, res, {
    worker_enabled: enabled,
    worker_ready: workerReady(),
    emergency_stop: emergencyStop,
  }));
  app.post("/v1/execute", async (req, res) => {
    if (!workerReady()) {
      return res.status(503).json({ error: "github_worker_unavailable" });
    }
    if (emergencyStop) {
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
      if (emergencyStop) {
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
    if (!workerReady()) return res.status(503).json({ error: "github_worker_unavailable" });
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
  app.use((error, _req, res, next) => {
    if (error?.type === "entity.parse.failed" || error?.type === "entity.too.large" || error instanceof SyntaxError) {
      return res.status(400).json({ error: "invalid_request" });
    }
    return next(error);
  });
  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  return Object.freeze({
    app,
    port,
    enabled,
    emergency_stop: emergencyStop,
    resolver,
    ledger,
    executor,
    reconciler,
    readiness_error: readinessError,
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const worker = createGitHubStandingReleaseWorker();
  worker.app.listen(worker.port, "0.0.0.0", () => {
    process.stdout.write(`github-standing-release-worker listening on ${worker.port}\n`);
  });
}
