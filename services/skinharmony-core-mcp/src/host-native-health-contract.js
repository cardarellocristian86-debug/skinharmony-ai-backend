import crypto from "node:crypto";

export const HOST_NATIVE_HEALTH_CONTRACT_VERSION = "host_native_health_contract_v1";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const HOST_NATIVE_HEALTH_CONTRACT_DIGEST = crypto
  .createHash("sha256")
  .update(canonical({
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
  }))
  .digest("hex");
