const crypto = require("node:crypto");

const HOST_NATIVE_HEALTH_CONTRACT_VERSION = "host_native_health_contract_v1";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const HOST_NATIVE_HEALTH_CONTRACT_DIGEST = crypto.createHash("sha256").update(canonical({
  schema_version: HOST_NATIVE_HEALTH_CONTRACT_VERSION,
  transport: "https",
  path: "/healthz",
  content_type: "application/json",
  required: {
    ok: true,
    version: "non_empty",
    build_commit_sha: "exact_release_commit",
    build_commit_verifiable: true,
    render_ready: true,
  },
})).digest("hex");

function buildIdentity(environment = process.env) {
  const commitSha = String(environment.RENDER_GIT_COMMIT || environment.GIT_COMMIT || "")
    .trim().toLowerCase();
  const commitVerifiable = /^[a-f0-9]{40}$/.test(commitSha);
  return {
    build_id: String(environment.RENDER_DEPLOY_ID || (commitVerifiable ? commitSha : "unavailable")).trim(),
    commit_sha: commitVerifiable ? commitSha : null,
    commit_verifiable: commitVerifiable,
  };
}

function healthPayload({ service, version, ready, environment = process.env }) {
  const build = buildIdentity(environment);
  const renderReady = ready === true && build.commit_verifiable;
  return {
    ok: renderReady,
    service,
    version,
    build,
    health_contract_version: HOST_NATIVE_HEALTH_CONTRACT_VERSION,
    health_contract_digest: HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
    render_ready: renderReady,
  };
}

module.exports = {
  HOST_NATIVE_HEALTH_CONTRACT_VERSION,
  HOST_NATIVE_HEALTH_CONTRACT_DIGEST,
  buildIdentity,
  healthPayload,
};
