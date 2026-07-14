#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);
const EXPECTED_SHA = "aa5cbcbbf48f41ca185fce900e19592f1ade4cd5994eb6e0ede468dac8a6f302";
const ENGINE = process.env.GHIDRA_CONTAINER_ENGINE || "docker";
const IMAGE = process.env.GHIDRA_WORKER_IMAGE || "";

function value(args, name, fallback = "") { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; }
function bounded(value_, minimum, maximum) { const number = Number(value_); if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error("resource_limit_invalid"); return number; }
async function inspect() {
  if (!IMAGE || IMAGE.includes(":latest") || !IMAGE.includes("@sha256:")) throw new Error("ghidra_worker_image_digest_required");
  const { stdout } = await run(ENGINE, ["image", "inspect", IMAGE, "--format", "{{json .Config.Labels}}"], { timeout: 15000, maxBuffer: 262144 });
  const labels = JSON.parse(stdout);
  if (labels["usi.worker"] !== "ghidra_headless" || labels["org.opencontainers.image.version"] !== "12.1" || labels["usi.ghidra.release_sha256"] !== EXPECTED_SHA) throw new Error("ghidra_worker_image_labels_invalid");
  return labels;
}

function requireImmutableImage(image) {
  if (!image || image.includes(":latest") || !image.includes("@sha256:")) throw new Error("ghidra_worker_image_digest_required");
  return image;
}

export function buildContainerArguments(args, cwd, options = {}) {
  const image = requireImmutableImage(options.image ?? IMAGE);
  const input = path.resolve(value(args, "--input")); const output = path.resolve(value(args, "--output"));
  if (path.dirname(input) !== cwd || path.dirname(output) !== cwd) throw new Error("ghidra_worker_path_outside_job");
  if (value(args, "--network") !== "none") throw new Error("ghidra_worker_network_denied");
  const cpu = bounded(value(args, "--cpu-seconds"), 1, 120); const memory = bounded(value(args, "--memory-megabytes"), 64, 2048);
  const wall = bounded(value(args, "--wall-time-seconds"), 1, 300); const outputBytes = bounded(value(args, "--output-bytes"), 1024, 8388608);
  return ["run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", "256", "--memory", `${memory}m`, "--cpus", "1.0", "--ulimit", `cpu=${cpu}:${cpu}`, "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=256m", "--mount", `type=bind,src=${cwd},dst=/work`, image, "--input", `/work/${path.basename(input)}`, "--output", `/work/${path.basename(output)}`, "--wall-time-seconds", String(wall), "--output-bytes", String(outputBytes)];
}

export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === "probe") { await inspect(); process.stdout.write(JSON.stringify({ worker: "ghidra_headless", version: "12.1", release_sha256: EXPECTED_SHA, network_access: "denied", resource_limits_enforced: true })); return; }
  if (argv[0] !== "analyze") throw new Error("ghidra_launcher_command_invalid");
  await inspect(); const args = buildContainerArguments(argv.slice(1), process.cwd());
  await run(ENGINE, args, { timeout: bounded(value(argv, "--wall-time-seconds"), 1, 300) * 1000 + 5000, maxBuffer: 1048576 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
