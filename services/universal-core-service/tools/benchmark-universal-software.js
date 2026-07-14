import { performance } from "node:perf_hooks";
import { createUniversalSoftwareJobManager } from "../src/universalSoftwareIntelligence.js";

const iterations = 100;
const binary = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, ...new Array(505).fill(0)]).toString("base64");
const authorization = { asserted: true, basis: "owned", purpose: "testing", owner_confirmed: true };
const context = { tenant_id: "tenant-a", memory_available: true, core_available: true, core_authorized: true, target_allowlist: [] };
const mockDeep = async () => ({ observations: { functions: [], references: [], call_graph: [] } });

async function run(mode, adapters) {
  const manager = createUniversalSoftwareJobManager({ adapters });
  const started = performance.now();
  const jobs = [];
  for (let index = 0; index < iterations; index += 1) jobs.push(manager.submit({ mode, artifact: { name: "fixture.elf", content_base64: binary }, authorization }, context));
  while (jobs.some((job) => !["completed", "failed"].includes(manager.get(job.job_id, "tenant-a")?.state))) await new Promise((resolve) => setImmediate(resolve));
  const elapsed = performance.now() - started;
  return { iterations, total_ms: Number(elapsed.toFixed(3)), mean_ms: Number((elapsed / iterations).toFixed(3)) };
}

const report = {
  schema_version: "universal_software_benchmark_v1",
  fixture_bytes: Buffer.from(binary, "base64").length,
  lightweight_static: await run("lightweight_static", {}),
  deep_orchestration_mock: await run("ghidra_headless", { ghidra_headless: mockDeep }),
  caveat: "Deep result measures queue/policy/evidence orchestration only; no Ghidra runtime is installed.",
};
console.log(JSON.stringify(report, null, 2));
