import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFridaLocalAdapter } from "../src/fridaLocalAdapter.js";

const limits = { wall_time_seconds: 2, output_bytes: 8192 };

test("verified Frida agent receives only an allowlisted template contract", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "frida-agent-test-"));
  const agent = path.join(root, "agent");
  await fs.writeFile(agent, "fixed agent", { mode: 0o700 });
  const hash = crypto.createHash("sha256").update(await fs.readFile(agent)).digest("hex");
  const calls = [];
  const run = async (_file, args) => {
    calls.push(args);
    if (args[0] === "probe") return { stdout: JSON.stringify({ worker: "frida_local_agent", version: "17.15.3", network_access: "denied", arbitrary_scripts_accepted: false }) };
    return { stdout: JSON.stringify({ schema_version: "universal_software_evidence_v1", analyzer: "frida_local_agent", network_access: "denied", events: [] }) };
  };
  try {
    const adapter = createFridaLocalAdapter({ agentPath: agent, agentSha256: hash, run });
    const evidence = await adapter({ authorization: { target: "pid:123", template_id: "observe_function_calls_v1" }, limits, template_parameters: { module: "demo", symbol: "work", max_events: 10 } });
    assert.equal(evidence.worker.arbitrary_scripts_accepted, false);
    assert.deepEqual(calls[1].slice(0, 7), ["analyze", "--target", "pid:123", "--template", "observe_function_calls_v1", "--parameters", calls[1][6]]);
    assert(!calls[1].join(" ").includes("javascript"));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("Frida agent hash and probe policy fail closed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "frida-agent-test-"));
  const agent = path.join(root, "agent"); await fs.writeFile(agent, "fixed agent", { mode: 0o700 });
  try {
    const adapter = createFridaLocalAdapter({ agentPath: agent, agentSha256: "0".repeat(64), run: async () => ({ stdout: "{}" }) });
    await assert.rejects(adapter({ authorization: {}, limits, template_parameters: {} }), /hash_mismatch/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
