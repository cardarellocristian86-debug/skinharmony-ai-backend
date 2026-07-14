#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);
const SHA = /^[a-f0-9]{64}$/;
const ANALYZE = process.env.GHIDRA_ANALYZE_HEADLESS || "";
const JAVA_HOME = process.env.GHIDRA_JAVA_HOME || "";
const VERSION = process.env.GHIDRA_LOCAL_VERSION || "12.1.2";
const RELEASE_SHA = process.env.GHIDRA_LOCAL_RELEASE_SHA256 || "";
const EXPORTER = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../ghidra/UniversalEvidenceExporter.java");

function option(args, name) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : ""; }
function integer(value, min, max) { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error("resource_limit_invalid"); return parsed; }
async function requireRuntime() {
  if (!path.isAbsolute(ANALYZE) || !path.isAbsolute(JAVA_HOME) || !SHA.test(RELEASE_SHA)) throw new Error("ghidra_local_runtime_configuration_invalid");
  for (const file of [ANALYZE, EXPORTER]) if (!(await fs.stat(file).catch(() => null))?.isFile()) throw new Error("ghidra_local_runtime_missing");
}

export async function main(argv = process.argv.slice(2)) {
  await requireRuntime();
  if (argv[0] === "probe") {
    process.stdout.write(JSON.stringify({ worker: "ghidra_headless", runtime: "local_agent", version: VERSION, release_sha256: RELEASE_SHA, network_access: "denied", resource_limits_enforced: true, arbitrary_scripts_accepted: false }));
    return;
  }
  if (argv[0] !== "analyze") throw new Error("ghidra_launcher_command_invalid");
  const args = argv.slice(1); const cwd = process.cwd();
  const input = path.resolve(option(args, "--input")); const output = path.resolve(option(args, "--output"));
  const canonicalCwd = await fs.realpath(cwd); const canonicalInputDirectory = await fs.realpath(path.dirname(input)); const canonicalOutputDirectory = await fs.realpath(path.dirname(output));
  if (canonicalInputDirectory !== canonicalCwd || canonicalOutputDirectory !== canonicalCwd) throw new Error("ghidra_worker_path_outside_job");
  if (option(args, "--network") !== "none") throw new Error("ghidra_worker_network_denied");
  const cpu = integer(option(args, "--cpu-seconds"), 1, 120); const memory = integer(option(args, "--memory-megabytes"), 64, 2048);
  const wall = integer(option(args, "--wall-time-seconds"), 1, 300); const outputBytes = integer(option(args, "--output-bytes"), 1024, 8388608);
  const shell = "ulimit -t \"$1\"; exec /usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' \"$3\" \"$4\" \"$5\" -import \"$6\" -overwrite -analysisTimeoutPerFile \"$7\" -scriptPath \"$8\" -postScript UniversalEvidenceExporter.java \"$9\" 20 true -deleteProject";
  await run("/bin/sh", ["-c", shell, "usi-ghidra", String(cpu), String(memory * 1024), ANALYZE, cwd, `project-${process.pid}`, input, String(wall), path.dirname(EXPORTER), output], { cwd, timeout: wall * 1000 + 5000, maxBuffer: Math.min(outputBytes, 1048576), env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", JAVA_HOME, JAVA_TOOL_OPTIONS: `-Xmx${memory}m -XX:MaxMetaspaceSize=256m`, USI_JOB_ROOT: path.dirname(output), LANG: "C.UTF-8" } });
  const stat = await fs.stat(output).catch(() => null);
  if (!stat?.isFile()) throw new Error("ghidra_evidence_missing");
  if (stat.size > outputBytes) { await fs.rm(output, { force: true }); throw new Error("software_output_limit_exceeded"); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });
