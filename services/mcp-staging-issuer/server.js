import http from "node:http";
import { pathToFileURL } from "node:url";
import { createCollaborationReceiptRuntime } from "./src/collaborationReceiptRuntime.js";
import { createMcpStagingIssuerRuntimeFromEnv } from "./src/issuerRuntime.js";
import { fetchMcpStagingPrivateJwks } from "./src/privateJwksClient.js";
import {
  createNyraDeepV2OperationalSignerRuntime,
  NYRA_DEEP_V2_OPERATIONAL_SIGNER_CONTRACT,
} from "./src/nyraDeepV2OperationalSigner.js";
import {
  createMcpStagingCredentialReceiptVerifier,
  createMcpStagingIssuerEvidenceVerifier,
  createMcpStagingOwnerConfirmationVerifier,
  loadMcpStagingPublicTrustAnchor,
} from "../universal-core-service/src/mcpStagingEvidence.js";
import { createCollaborationCoreGateVerifier } from
  "../universal-core-service/src/collaborationCoreGateEvidence.js";
import { createMcpStagingIssuerReplayClientFromEnv } from
  "../universal-core-service/src/mcpStagingControlPlaneClient.js";
import {
  loadMcpStagingDependencyBuildIdentity,
  loadMcpStagingProviderBuildIdentity,
} from
  "../universal-core-service/src/mcpStagingDependencyBuildIdentity.js";

const SENSITIVE_ENV_KEYS = Object.freeze([
  "MCP_STAGING_ISSUER_SIGNING_SECRET",
  "MCP_STAGING_ISSUER_AUTH_TOKEN",
  "MCP_STAGING_CONTROL_PLANE_INTERNAL_HOSTPORT",
  "MCP_STAGING_ISSUER_NONCE_API_TOKEN",
  "MCP_STAGING_NYRA_JWKS_TOKEN",
  "MCP_STAGING_CORE_GATE_VERIFY_SECRET",
  "MCP_STAGING_NYRA_DEEP_V2_SIGNING_SECRET",
  "MCP_STAGING_NYRA_DEEP_V2_SIGNING_TOKEN",
]);
const PUBLIC_ANCHOR_ENV_KEYS = Object.freeze([
  "MCP_STAGING_RECEIPT_AUTHORITY_PUBLIC_JWK",
  "MCP_STAGING_RECEIPT_AUTHORITY_KID",
  "MCP_STAGING_OWNER_AUTHORITY_PUBLIC_JWK",
  "MCP_STAGING_OWNER_AUTHORITY_KID",
  "MCP_STAGING_NYRA_AUTHORITY_PUBLIC_JWK",
  "MCP_STAGING_NYRA_AUTHORITY_KID",
]);
const PRIVATE_PORT = 8_789;
const ISSUER_PROTOCOLS = Object.freeze({
  collaboration: "collaboration",
  renderExecutor: "render_executor",
});

export function loadIssuerPrivatePort(env = process.env) {
  try {
    if (!env || typeof env !== "object" || env.PORT !== String(PRIVATE_PORT)) {
      throw new Error("invalid");
    }
    return PRIVATE_PORT;
  } catch {
    throw new Error("issuer_private_port_invalid");
  }
}

export function scrubIssuerEnvironment(env = process.env) {
  for (const key of [...SENSITIVE_ENV_KEYS, ...PUBLIC_ANCHOR_ENV_KEYS]) {
    try {
      delete env[key];
    } catch {
      // Startup never reports environment values.
    }
  }
}

export function loadMcpStagingIssuerEntrypointBuildIdentity(env = process.env) {
  const startupMode = env?.MCP_STAGING_ISSUER_STARTUP_MODE || "full";
  if (startupMode !== "full" && startupMode !== "jwks_only") {
    throw new Error("issuer_startup_mode_invalid");
  }
  return Object.freeze({
    startupMode,
    buildIdentity: startupMode === "jwks_only"
      ? loadMcpStagingProviderBuildIdentity(env)
      : loadMcpStagingDependencyBuildIdentity(env),
  });
}

function anchorFromEnv(env, authority, prefix) {
  return loadMcpStagingPublicTrustAnchor({
    authority,
    jwkJson: env[`${prefix}_PUBLIC_JWK`],
    expectedKid: env[`${prefix}_KID`],
  });
}

function assertIndependentAnchors(runtimeKid, anchors) {
  const kids = [runtimeKid, ...anchors.map((anchor) => anchor.kid)];
  if (new Set(kids).size !== kids.length) throw new Error("issuer_trust_anchors_not_independent");
}

function composeNyraDeepV2OperationalSigner({
  runtime,
  env,
  replayStore,
  targetCommit,
  startupMode,
  now,
  logger,
}) {
  const signingSecret = env?.MCP_STAGING_NYRA_DEEP_V2_SIGNING_SECRET;
  const authToken = env?.MCP_STAGING_NYRA_DEEP_V2_SIGNING_TOKEN;
  if (signingSecret === undefined && authToken === undefined) return runtime;
  if (signingSecret === undefined || authToken === undefined) {
    throw new Error("nyra_deep_v2_signer_config_incomplete");
  }
  const signer = createNyraDeepV2OperationalSignerRuntime({
    mode: env?.MCP_STAGING_ISSUER_MODE,
    environment: env?.MCP_STAGING_ENVIRONMENT,
    startupMode,
    signingSecret,
    authToken,
    replayStore,
    targetCommit,
    now,
    logger,
  });
  async function handle(req, res) {
    const pathname = (() => {
      try {
        return new URL(req.url || "/", "http://issuer.invalid").pathname;
      } catch {
        return "/invalid";
      }
    })();
    if (pathname === NYRA_DEEP_V2_OPERATIONAL_SIGNER_CONTRACT.endpoint ||
        pathname === NYRA_DEEP_V2_OPERATIONAL_SIGNER_CONTRACT.jwks_endpoint) {
      return signer.handle(req, res);
    }
    return runtime.handle(req, res);
  }
  return Object.freeze({
    ...runtime,
    nyraDeepV2OperationalSignerReady: true,
    nyraDeepV2OperationalSignerJwk: signer.jwk,
    nyraDeepV2OperationalSignerEndpoint: signer.endpoint,
    nyraDeepV2OperationalSignerJwksEndpoint: signer.jwksEndpoint,
    handle,
  });
}

export function createMcpStagingIssuerServiceRuntime({
  env = process.env,
  now = Date.now,
  logger = () => {},
  replayStore,
  targetCommit,
  nyraTrust,
} = {}) {
  let delegatedEvidenceVerifier = async () => {
    throw new Error("issuer_evidence_unavailable");
  };
  try {
    if (!env || typeof env !== "object" || env.MCP_STAGING_ENVIRONMENT !== "staging") {
      throw new Error("issuer_staging_confirmation_required");
    }
    const startupMode = env?.MCP_STAGING_ISSUER_STARTUP_MODE || "full";
    const protocol = env?.MCP_STAGING_ISSUER_PROTOCOL || ISSUER_PROTOCOLS.renderExecutor;
    if (startupMode !== "full" && startupMode !== "jwks_only") {
      throw new Error("issuer_startup_mode_invalid");
    }
    if (!Object.values(ISSUER_PROTOCOLS).includes(protocol)) {
      throw new Error("issuer_protocol_invalid");
    }
    if (startupMode === "jwks_only") {
      return createMcpStagingIssuerRuntimeFromEnv(env, { now, logger, targetCommit });
    }
    if (!replayStore || replayStore.durable !== true || typeof replayStore.claim !== "function") {
      throw new Error("issuer_durable_replay_store_required");
    }
    if (protocol === ISSUER_PROTOCOLS.collaboration) {
      const mode = env?.MCP_STAGING_ISSUER_MODE;
      let nyraPublicKey;
      let coreGateVerifier;
      if (mode === "core") {
        if (nyraTrust?.authority !== "nyra" ||
            nyraTrust?.targetCommit !== targetCommit ||
            nyraTrust?.issuer !== "nyra-staging" ||
            nyraTrust?.kid !== nyraTrust?.jwk?.kid) {
          throw new Error("collaboration_nyra_private_trust_required");
        }
        nyraPublicKey = loadMcpStagingPublicTrustAnchor({
          authority: "nyra",
          jwkJson: JSON.stringify(nyraTrust.jwk),
          expectedKid: nyraTrust.kid,
        }).publicKey;
        coreGateVerifier = createCollaborationCoreGateVerifier({
          secret: env?.MCP_STAGING_CORE_GATE_VERIFY_SECRET,
          targetCommit,
          now,
        });
      }
      const runtime = createCollaborationReceiptRuntime({
        mode,
        signingSecret: env?.MCP_STAGING_ISSUER_SIGNING_SECRET,
        authToken: env?.MCP_STAGING_ISSUER_AUTH_TOKEN,
        replayStore,
        audience: env?.MCP_STAGING_COLLABORATION_AUDIENCE,
        targetCommit,
        ...(nyraPublicKey ? { nyraPublicKey } : {}),
        ...(coreGateVerifier ? { coreGateVerifier } : {}),
        now,
      });
      return composeNyraDeepV2OperationalSigner({
        runtime,
        env,
        replayStore,
        targetCommit,
        startupMode,
        now,
        logger,
      });
    }
    const receiptAnchor = anchorFromEnv(env, "receipt", "MCP_STAGING_RECEIPT_AUTHORITY");
    const ownerAnchor = anchorFromEnv(env, "owner", "MCP_STAGING_OWNER_AUTHORITY");
    const runtime = createMcpStagingIssuerRuntimeFromEnv(env, {
      now,
      logger,
      targetCommit,
      ...(replayStore ? { replayStore } : {}),
      evidenceVerifier: (request) => delegatedEvidenceVerifier(request),
    });
    const anchors = [receiptAnchor, ownerAnchor];
    let nyraPublicKey;
    if (runtime.mode === "core") {
      const nyraAnchor = anchorFromEnv(env, "nyra", "MCP_STAGING_NYRA_AUTHORITY");
      anchors.push(nyraAnchor);
      nyraPublicKey = nyraAnchor.publicKey;
    }
    assertIndependentAnchors(runtime.jwk.kid, anchors);
    delegatedEvidenceVerifier = createMcpStagingIssuerEvidenceVerifier({
      mode: runtime.mode,
      receiptVerifier: createMcpStagingCredentialReceiptVerifier({
        publicKey: receiptAnchor.publicKey,
        now,
        targetCommit,
      }),
      ownerConfirmationVerifier: createMcpStagingOwnerConfirmationVerifier({
        publicKey: ownerAnchor.publicKey,
        now,
        targetCommit,
      }),
      ...(runtime.mode === "core" ? { nyraPublicKey } : {}),
      now,
      targetCommit,
    });
    return composeNyraDeepV2OperationalSigner({
      runtime,
      env,
      replayStore,
      targetCommit,
      startupMode,
      now,
      logger,
    });
  } finally {
    scrubIssuerEnvironment(env);
  }
}

export function createMcpStagingIssuerHttpServer(runtime) {
  if (!runtime || typeof runtime.handle !== "function") throw new Error("issuer_runtime_invalid");
  const server = http.createServer(runtime.handle);
  server.requestTimeout = 5_000;
  server.headersTimeout = 6_000;
  server.keepAliveTimeout = 2_000;
  return server;
}

async function main() {
  const { startupMode, buildIdentity } =
    loadMcpStagingIssuerEntrypointBuildIdentity(process.env);
  const controlPlaneClient = startupMode === "full"
    ? createMcpStagingIssuerReplayClientFromEnv({ env: process.env })
    : undefined;
  const collaborationCore = startupMode === "full" &&
    process.env.MCP_STAGING_ISSUER_PROTOCOL === ISSUER_PROTOCOLS.collaboration &&
    process.env.MCP_STAGING_ISSUER_MODE === "core";
  const nyraTrust = collaborationCore
    ? await fetchMcpStagingPrivateJwks({
        authority: "nyra",
        hostport: process.env.MCP_STAGING_NYRA_JWKS_HOSTPORT,
        token: process.env.MCP_STAGING_NYRA_JWKS_TOKEN,
        targetCommit: buildIdentity.commit,
        timeoutMs: Number(process.env.MCP_STAGING_NYRA_JWKS_TIMEOUT_MS || 5_000),
        attempts: Number(process.env.MCP_STAGING_NYRA_JWKS_ATTEMPTS || 12),
      })
    : undefined;
  const runtime = createMcpStagingIssuerServiceRuntime({
    env: process.env,
    targetCommit: buildIdentity.commit,
    ...(controlPlaneClient ? { replayStore: controlPlaneClient.issuerReplayStore } : {}),
    ...(nyraTrust ? { nyraTrust } : {}),
    logger(event) {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    },
  });
  const port = loadIssuerPrivatePort(process.env);
  createMcpStagingIssuerHttpServer(runtime).listen(port, "0.0.0.0", () => {
    const event = runtime.startupMode === "jwks_only"
      ? { event: "issuer_started", mode: runtime.mode, startup_mode: "jwks_only", issuance_ready: false, port }
      : { event: "issuer_started", mode: runtime.mode, port };
    process.stdout.write(`${JSON.stringify(event)}\n`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("mcp_staging_issuer_startup_failed");
    process.exitCode = 1;
  });
}
