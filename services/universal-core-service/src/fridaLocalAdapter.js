import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { UNIVERSAL_SOFTWARE_EVIDENCE_SCHEMA } from "./universalSoftwareIntelligence.js";

const execFileAsync = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/;

async function fileSha256(file) {
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

export function createFridaLocalAdapter({ agentPath, agentSha256, expectedVersion = "17.15.3", run = execFileAsync } = {}) {
  const resolved = path.resolve(String(agentPath || ""));
  if (!agentPath || resolved !== agentPath) throw new Error("frida_local_agent_absolute_path_required");
  const expectedHash = String(agentSha256 || "").toLowerCase();
  if (!SHA256.test(expectedHash)) throw new Error("frida_local_agent_sha256_required");
  let verified = null;

  async function probe(limits) {
    if (verified) return verified;
    const stat = await fs.lstat(resolved).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) === 0) throw new Error("frida_local_agent_invalid");
    if (await fileSha256(resolved) !== expectedHash) throw new Error("frida_local_agent_hash_mismatch");
    const { stdout } = await run(resolved, ["probe", "--json"], { timeout: Math.min(10_000, limits.wall_time_seconds * 1000), maxBuffer: 262144 });
    const value = JSON.parse(stdout);
    if (value.worker !== "frida_local_agent" || value.version !== expectedVersion) throw new Error("frida_local_agent_version_mismatch");
    if (value.arbitrary_scripts_accepted !== false || value.network_access !== "denied") throw new Error("frida_local_agent_policy_unverified");
    verified = Object.freeze(value);
    return verified;
  }

  return async function fridaLocalAdapter({ authorization, limits, template_parameters: parameters }) {
    const worker = await probe(limits);
    const { stdout } = await run(resolved, [
      "analyze", "--target", authorization.target, "--template", authorization.template_id,
      "--parameters", Buffer.from(JSON.stringify(parameters || {})).toString("base64url"),
      "--seconds", String(Math.min(limits.wall_time_seconds, 60)), "--max-events", String(Math.min(Number(parameters?.max_events) || 500, 2000)),
    ], { timeout: limits.wall_time_seconds * 1000 + 2000, maxBuffer: limits.output_bytes });
    const evidence = JSON.parse(stdout);
    if (evidence.schema_version !== UNIVERSAL_SOFTWARE_EVIDENCE_SCHEMA || evidence.network_access !== "denied") throw new Error("frida_local_evidence_invalid");
    return { ...evidence, worker, raw_content_persisted: false };
  };
}
