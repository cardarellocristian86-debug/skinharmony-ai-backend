import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeUniversalSoftwareJob,
  createSoftwareAuthorizationVerifier,
  issueSoftwareAuthorizationEnvelope,
  createUniversalSoftwareJobManager,
  FRIDA_TEMPLATE_CATALOG,
  correlateUniversalSoftwareEvidence,
  normalizeSoftwareResourceLimits,
  UNIVERSAL_SOFTWARE_EVIDENCE_SCHEMA,
  universalSoftwareComponentManifest,
} from "../src/universalSoftwareIntelligence.js";

test("correlates static reconstruction with runtime-confirmed calls for assistant interpretation", () => {
  const staticEvidence = { schema_version: "universal_software_evidence_v1", functions: [{ name: "_work", entry: "1000", signature: "int work(int)", callers: ["entry"], callees: [] }], call_graph: [{ caller: "entry", callee: "_work" }], decompilation: [{ function: "_work", code: "return value + 1;" }] };
  const dynamicEvidence = { schema_version: "universal_software_evidence_v1", events: [{ kind: "call_enter", symbol: "work" }, { kind: "call_leave", symbol: "work" }] };
  const result = correlateUniversalSoftwareEvidence(staticEvidence, dynamicEvidence);
  assert.equal(result.observed_function_count, 1);
  assert.equal(result.matched_functions[0].confidence, "confirmed_runtime");
  assert.equal(result.reconstructed_code[0].function, "_work");
  assert.equal(result.raw_content_persisted, false);
});

const owned = Object.freeze({ asserted: true, basis: "owned", purpose: "testing", owner_confirmed: true });

function fixture(format) {
  if (format === "elf") return Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, ...new Array(73).fill(0)]);
  if (format === "pe") {
    const value = Buffer.alloc(160); value.write("MZ"); value.writeUInt32LE(64, 0x3c); value.write("PE\0\0", 64, "binary"); return value;
  }
  return Buffer.from([0xcf, 0xfa, 0xed, 0xfe, ...new Array(76).fill(0)]);
}

const artifact = (format) => ({ name: `fixture.${format}`, content_base64: fixture(format).toString("base64") });
const context = (tenant = "tenant-a") => ({ tenant_id: tenant, memory_available: true, core_available: true, core_authorized: true, target_allowlist: ["process:owned-demo"] });

async function settled(manager, id, tenant) {
  for (let attempt = 0; attempt < 800; attempt += 1) {
    const value = manager.get(id, tenant);
    if (["completed", "failed"].includes(value?.state)) return value;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("job_did_not_settle");
}

test("lightweight analyzer is active while absent optional workers stay unavailable", () => {
  const manifest = universalSoftwareComponentManifest();
  assert.equal(manifest.components.find((item) => item.id === "universal_binary_evidence_core").status, "embedded_active");
  assert(manifest.optional_workers.every((item) => item.status === "optional_unavailable"));
  assert.equal(FRIDA_TEMPLATE_CATALOG.length, 3);
});

test("internally generated ELF, PE, and Mach-O fixtures produce common evidence without persistence", async () => {
  for (const format of ["elf", "pe", "macho"]) {
    const manager = createUniversalSoftwareJobManager();
    const queued = manager.submit({ mode: "lightweight_static", artifact: artifact(format), authorization: owned }, context());
    const result = await settled(manager, queued.job_id, "tenant-a");
    assert.equal(result.state, "completed");
    assert.equal(result.evidence.schema_version, UNIVERSAL_SOFTWARE_EVIDENCE_SCHEMA);
    assert.equal(result.raw_artifact_persisted, false);
    assert.equal(result.evidence.retention.raw_artifact_persisted, false);
    assert.equal(result.network_access, "denied");
    assert(!JSON.stringify(result).includes(artifact(format).content_base64));
  }
});

test("jobs are isolated between tenant-a and tenant-b", () => {
  const manager = createUniversalSoftwareJobManager();
  const job = manager.submit({ mode: "lightweight_static", artifact: artifact("elf"), authorization: owned }, context("tenant-a"));
  assert.equal(manager.get(job.job_id, "tenant-b"), null);
  assert.equal(manager.list("tenant-b").length, 0);
  assert.throws(() => manager.submit({ tenant_id: "tenant-b", mode: "lightweight_static", artifact: artifact("elf"), authorization: owned }, { ...context("tenant-a"), requested_tenant_id: "tenant-b" }), /software_cross_tenant_denied/);
});

test("deep analysis fails closed without Core, memory, confirmation, or authorization", () => {
  const base = { mode: "ghidra_headless", artifact: artifact("elf"), authorization: owned };
  assert.throws(() => authorizeUniversalSoftwareJob(base, { ...context(), memory_available: false }), /software_memory_unavailable/);
  assert.throws(() => authorizeUniversalSoftwareJob(base, { ...context(), core_available: false }), /software_core_unavailable/);
  assert.throws(() => authorizeUniversalSoftwareJob(base, { ...context(), core_authorized: false }), /software_core_authorization_required/);
  assert.throws(() => authorizeUniversalSoftwareJob({ ...base, authorization: { ...owned, owner_confirmed: false } }, context()), /software_owner_confirmation_required/);
  assert.throws(() => authorizeUniversalSoftwareJob({ ...base, authorization: { ...owned, asserted: false } }, context()), /software_analysis_authorization_assertion_required/);
});

test("Frida rejects arbitrary input and processes outside the allowlist", () => {
  const base = { mode: "frida_local_agent", target: "process:owned-demo", template_id: "observe_module_loads_v1", authorization: owned };
  assert.throws(() => authorizeUniversalSoftwareJob({ ...base, javascript: "send(Process.enumerateModules())" }, context()), /frida_arbitrary_input_denied/);
  assert.throws(() => authorizeUniversalSoftwareJob({ ...base, target: "process:not-owned" }, context()), /software_target_not_allowlisted/);
  assert.throws(() => authorizeUniversalSoftwareJob({ ...base, template_id: "bypass_tls_v1" }, context()), /frida_template_not_allowlisted/);
  assert.throws(() => authorizeUniversalSoftwareJob({ ...base, template_parameters: { stealth: true } }, context()), /frida_template_parameter_denied/);
});

test("absent Ghidra and Frida workers fail without executing the artifact", async () => {
  for (const mode of ["ghidra_headless", "frida_local_agent"]) {
    const manager = createUniversalSoftwareJobManager();
    const input = mode === "frida_local_agent"
      ? { mode, target: "process:owned-demo", template_id: "observe_module_loads_v1", authorization: owned }
      : { mode, artifact: artifact("elf"), authorization: owned };
    const queued = manager.submit(input, context());
    const result = await settled(manager, queued.job_id, "tenant-a");
    assert.equal(result.state, "failed");
    assert.equal(result.error, `${mode}_worker_unavailable`);
  }
});

test("resource limits are bounded and timeout/output failures are closed", async () => {
  const limits = normalizeSoftwareResourceLimits({ cpu_seconds: 999, memory_megabytes: 1, wall_time_seconds: 0, output_bytes: 1 });
  assert.deepEqual(limits, { cpu_seconds: 120, memory_megabytes: 64, wall_time_seconds: 1, artifact_bytes: 6291456, output_bytes: 1024 });

  const manager = createUniversalSoftwareJobManager({ adapters: { ghidra_headless: async () => new Promise(() => {}) } });
  const queued = manager.submit({ mode: "ghidra_headless", artifact: artifact("elf"), authorization: owned, limits: { wall_time_seconds: 1 } }, context());
  const result = await settled(manager, queued.job_id, "tenant-a");
  assert.equal(result.state, "failed");
  assert.equal(result.error, "software_analysis_timeout");
});

test("redaction removes secrets from lightweight evidence", async () => {
  const manager = createUniversalSoftwareJobManager();
  const raw = Buffer.from("header token=private-value user@example.org tail");
  const queued = manager.submit({ mode: "lightweight_static", artifact: { name: "redaction.bin", content_base64: raw.toString("base64") }, authorization: owned }, context());
  const result = await settled(manager, queued.job_id, "tenant-a");
  const serialized = JSON.stringify(result);
  assert(!serialized.includes("private-value"));
  assert(!serialized.includes("user@example.org"));
  assert(serialized.includes("[REDACTED]"));
});

test("server-side Core authorization envelope is tenant, mode, signature and time scoped", () => {
  const secret = "test-only-authorization-secret-32-bytes-minimum";
  const now = Date.parse("2026-07-13T20:00:00Z");
  const issued = issueSoftwareAuthorizationEnvelope({ secret, tenantId: "tenant-a", allowedModes: ["ghidra_headless"], now: () => now - 1_000, ttlMilliseconds: 61_000 });
  const envelope = issued.authorization_envelope;
  const signature = issued.signature;
  const verify = createSoftwareAuthorizationVerifier({ secret, now: () => now });
  assert.equal(verify({ tenant_id: "tenant-a", request: { mode: "ghidra_headless", core_governance: { authorization_envelope: envelope, signature } } }).authorized, true);
  assert.equal(verify({ tenant_id: "tenant-b", request: { mode: "ghidra_headless", core_governance: { authorization_envelope: envelope, signature } } }).authorized, false);
  assert.equal(verify({ tenant_id: "tenant-a", request: { mode: "frida_local_agent", core_governance: { authorization_envelope: envelope, signature } } }).authorized, false);
  assert.equal(verify({ tenant_id: "tenant-a", request: { mode: "ghidra_headless", core_governance: { authorization_envelope: envelope, signature: "0".repeat(64) } } }).authorized, false);
});
