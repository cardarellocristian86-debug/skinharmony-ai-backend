import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGhidraHeadlessAdapter, GHIDRA_12_1_RELEASE_SHA256 } from "../src/ghidraHeadlessAdapter.js";

const limits = { cpu_seconds: 2, memory_megabytes: 128, wall_time_seconds: 2, artifact_bytes: 4096, output_bytes: 8192 };

async function harness(overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ghidra-adapter-test-"));
  const launcher = path.join(root, "sandbox-launcher");
  await fs.writeFile(launcher, "verified fake launcher", { mode: 0o700 });
  const launcherSha256 = crypto.createHash("sha256").update(await fs.readFile(launcher)).digest("hex");
  const seen = [];
  const run = async (_file, args) => {
    seen.push(args);
    if (args[0] === "probe") return { stdout: JSON.stringify({ worker: "ghidra_headless", version: overrides.version || "12.1", release_sha256: GHIDRA_12_1_RELEASE_SHA256, network_access: overrides.network || "denied", resource_limits_enforced: true }) };
    const output = args[args.indexOf("--output") + 1];
    await fs.writeFile(output, JSON.stringify({ schema_version: "universal_software_evidence_v1", network_access: "denied", sections: [".text"], symbols: ["token=private-value", "user@example.org"], functions: [], references: [], call_graph: [] }));
    return { stdout: "" };
  };
  return { root, launcher, launcherSha256, seen, run };
}

test("verified launcher emits redacted Ghidra evidence and deletes transient input", async () => {
  const item = await harness();
  try {
    const adapter = createGhidraHeadlessAdapter({ launcherPath: item.launcher, launcherSha256: item.launcherSha256, run: item.run, tempRoot: item.root });
    const evidence = await adapter({ artifact: { name: "fixture.elf", content_base64: Buffer.from("ELF fixture").toString("base64") }, authorization: { basis: "owned" }, limits });
    assert.equal(evidence.analyzer, "ghidra_headless");
    assert.equal(evidence.raw_content_persisted, false);
    assert(!JSON.stringify(evidence).includes("private-value"));
    assert(!JSON.stringify(evidence).includes("user@example.org"));
    assert(item.seen[1].includes("--network"));
    assert(item.seen[1].includes("none"));
    const leftovers = (await fs.readdir(item.root)).filter((name) => name.startsWith("usi-ghidra-"));
    assert.deepEqual(leftovers, []);
  } finally { await fs.rm(item.root, { recursive: true, force: true }); }
});

test("launcher hash, Ghidra version and network isolation fail closed", async () => {
  const hashCase = await harness();
  try {
    const adapter = createGhidraHeadlessAdapter({ launcherPath: hashCase.launcher, launcherSha256: "0".repeat(64), run: hashCase.run, tempRoot: hashCase.root });
    await assert.rejects(adapter({ artifact: { content_base64: Buffer.from("x").toString("base64") }, authorization: { basis: "owned" }, limits }), /ghidra_sandbox_launcher_hash_mismatch/);
  } finally { await fs.rm(hashCase.root, { recursive: true, force: true }); }
  for (const override of [{ version: "12.0" }, { network: "allowed" }]) {
    const item = await harness(override);
    try {
      const adapter = createGhidraHeadlessAdapter({ launcherPath: item.launcher, launcherSha256: item.launcherSha256, run: item.run, tempRoot: item.root });
      await assert.rejects(adapter({ artifact: { content_base64: Buffer.from("x").toString("base64") }, authorization: { basis: "owned" }, limits }), /ghidra_worker_version_mismatch|ghidra_sandbox_isolation_unverified/);
    } finally { await fs.rm(item.root, { recursive: true, force: true }); }
  }
});
