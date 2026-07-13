import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { decodeEmbeddedArtifact } from "./embeddedSoftwareIntelligence.js";
import { UNIVERSAL_SOFTWARE_EVIDENCE_SCHEMA } from "./universalSoftwareIntelligence.js";

const execFileAsync = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/;
const EXPECTED_GHIDRA_RELEASE_SHA256 = "aa5cbcbbf48f41ca185fce900e19592f1ade4cd5994eb6e0ede468dac8a6f302";

function requireAbsoluteFile(value) {
  const resolved = path.resolve(String(value || ""));
  if (!value || resolved !== value) throw new Error("ghidra_sandbox_launcher_absolute_path_required");
  return resolved;
}

function sanitizeName(value) {
  return String(value || "artifact.bin").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "artifact.bin";
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
  if (typeof value !== "string") return value;
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\b(password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
}

async function sha256File(file) {
  const bytes = await fs.readFile(file);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseJson(value, errorCode) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    throw new Error(errorCode);
  }
}

export function createGhidraHeadlessAdapter({
  launcherPath,
  launcherSha256,
  expectedVersion = "12.1",
  expectedReleaseSha256 = EXPECTED_GHIDRA_RELEASE_SHA256,
  tempRoot = os.tmpdir(),
  run = execFileAsync,
} = {}) {
  const launcher = requireAbsoluteFile(launcherPath);
  const launcherHash = String(launcherSha256 || "").toLowerCase();
  const releaseHash = String(expectedReleaseSha256 || "").toLowerCase();
  if (!SHA256.test(launcherHash)) throw new Error("ghidra_sandbox_launcher_sha256_required");
  if (!SHA256.test(releaseHash)) throw new Error("ghidra_release_sha256_required");

  let verifiedProbe = null;
  async function verifyLauncher(limits) {
    if (verifiedProbe) return verifiedProbe;
    const stat = await fs.lstat(launcher).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error("ghidra_sandbox_launcher_invalid");
    if ((stat.mode & 0o111) === 0) throw new Error("ghidra_sandbox_launcher_not_executable");
    if (await sha256File(launcher) !== launcherHash) throw new Error("ghidra_sandbox_launcher_hash_mismatch");
    const probeRun = await run(launcher, ["probe", "--json"], {
      timeout: Math.min(10_000, limits.wall_time_seconds * 1000),
      maxBuffer: Math.min(limits.output_bytes, 256 * 1024),
      windowsHide: true,
      env: { PATH: process.env.PATH || "", JAVA_HOME: process.env.JAVA_HOME || "", LANG: "C.UTF-8" },
    });
    const probe = parseJson(probeRun.stdout, "ghidra_sandbox_probe_invalid");
    if (probe.worker !== "ghidra_headless" || probe.version !== expectedVersion) throw new Error("ghidra_worker_version_mismatch");
    if (probe.release_sha256 !== releaseHash) throw new Error("ghidra_release_hash_mismatch");
    if (probe.network_access !== "denied" || probe.resource_limits_enforced !== true) throw new Error("ghidra_sandbox_isolation_unverified");
    verifiedProbe = Object.freeze({ worker: probe.worker, version: probe.version, release_sha256: probe.release_sha256, network_access: "denied" });
    return verifiedProbe;
  }

  return async function ghidraHeadlessAdapter({ artifact, authorization, limits }) {
    const probe = await verifyLauncher(limits);
    const decoded = decodeEmbeddedArtifact(artifact);
    if (decoded.buffer.length > limits.artifact_bytes) throw new Error("software_artifact_too_large");
    const workingDirectory = await fs.mkdtemp(path.join(tempRoot, "usi-ghidra-"));
    const inputPath = path.join(workingDirectory, sanitizeName(decoded.name));
    const outputPath = path.join(workingDirectory, "evidence.json");
    try {
      await fs.chmod(workingDirectory, 0o700);
      await fs.writeFile(inputPath, decoded.buffer, { mode: 0o600, flag: "wx" });
      await run(launcher, [
        "analyze",
        "--input", inputPath,
        "--output", outputPath,
        "--network", "none",
        "--cpu-seconds", String(limits.cpu_seconds),
        "--memory-megabytes", String(limits.memory_megabytes),
        "--wall-time-seconds", String(limits.wall_time_seconds),
        "--output-bytes", String(limits.output_bytes),
      ], {
        cwd: workingDirectory,
        timeout: limits.wall_time_seconds * 1000,
        maxBuffer: Math.min(limits.output_bytes, 1024 * 1024),
        windowsHide: true,
        env: { PATH: process.env.PATH || "", JAVA_HOME: process.env.JAVA_HOME || "", LANG: "C.UTF-8" },
      });
      const outputStat = await fs.stat(outputPath).catch(() => null);
      if (!outputStat?.isFile()) throw new Error("ghidra_evidence_missing");
      if (outputStat.size > limits.output_bytes) throw new Error("software_output_limit_exceeded");
      const evidence = parseJson(await fs.readFile(outputPath, "utf8"), "ghidra_evidence_invalid");
      if (evidence.schema_version !== UNIVERSAL_SOFTWARE_EVIDENCE_SCHEMA) throw new Error("ghidra_evidence_schema_invalid");
      if (evidence.network_access !== "denied") throw new Error("ghidra_evidence_isolation_invalid");
      return redact({
        ...evidence,
        analyzer: "ghidra_headless",
        worker: probe,
        authorization_basis: authorization.basis,
        raw_content_persisted: false,
      });
    } finally {
      await fs.rm(workingDirectory, { recursive: true, force: true });
    }
  };
}

export const GHIDRA_12_1_RELEASE_SHA256 = EXPECTED_GHIDRA_RELEASE_SHA256;
