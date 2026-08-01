import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ExecutionLeaseStore, HardeningDefensiveLayer, ToolIntegrityGate, sanitize, sha256 } from "../src/securityDefensiveHardeningLayer.js";

const signer = "skin-trust-root";
const trustSecret = "test-only-signing-secret";
const toolId = "mcp.safe.patch";
const version = "1.2.0";
const content = "immutable tool package";
const digest = sha256(content);

function signature(overrides = {}) {
  const value = { tool_id: toolId, version, content_hash: digest, provenance: "internal-build/42", tenant_id: "tenant-a", ...overrides };
  return crypto.createHmac("sha256", trustSecret).update([value.tool_id, value.version, value.content_hash, value.provenance, value.tenant_id || "*"].join("\n")).digest("hex");
}

function manifest(overrides = {}) {
  const value = { tool_id: toolId, version, content_hash: digest, content, signer, provenance: "internal-build/42", tenant_id: "tenant-a", capabilities: ["repo:patch"], expires_at: "2099-01-01T00:00:00.000Z", ...overrides };
  return { ...value, signature: overrides.signature || signature(value) };
}

function checkpoint(overrides = {}) {
  const value = { tenant_id: "tenant-a", work_id: "work-a", repository: "repo-a", payload: { ref: "abc123" }, stale: false, ...overrides };
  return { ...value, digest: overrides.digest || sha256(value.payload) };
}

function validInput(overrides = {}) {
  return {
    tenantContext: { tenant_id: "tenant-a" },
    workIdentity: { tenant_id: "tenant-a", work_id: "work-a", session_id: "session-a", agent_id: "agent-a", capabilities: ["repo:patch"] },
    remediationProposal: { tenant_id: "tenant-a", remediation_id: "rem-a", operation: "patch", target: "src/a.js", paths: ["src/a.js"], environment: {}, checkpoint: checkpoint() },
    requestedCapabilities: ["repo:patch"], toolManifest: manifest(),
    executionScope: { root: "/tmp/tenant-a/work-a", bound_scope: "/tmp/tenant-a/work-a", repository: "repo-a", environment_allowlist: ["LANG"], max_timeout_ms: 1000, max_output_bytes: 1024 },
    nonce: crypto.randomUUID(), issuer: "nyra-core", audience: "remediation-runtime",
    ...overrides,
  };
}

function layer(options = {}) {
  return new HardeningDefensiveLayer({ mode: "shadow", catalog: { [toolId]: { version, digest, capabilities: ["repo:patch"] } }, trustRoots: { [signer]: trustSecret }, processAdapter: { enforced: true }, ...options });
}

test("trusted tool is authorized and receives a scoped lease", async () => {
  const result = await layer().evaluate(validInput());
  assert.equal(result.verdict, "ALLOWED"); assert.ok(result.executionLease?.leaseId);
});

const integrityCases = [
  ["altered tool hash", { content: "tampered" }, "content hash mismatch"],
  ["unknown signer", { signer: "unknown" }, "unknown signer"],
  ["revoked tool", {}, "tool revoked", { revoked: [`${toolId}@${version}`] }],
  ["version downgrade", { version: "1.1.0" }, "version downgrade denied", { minimumVersions: { [toolId]: "1.2.0" } }],
];
for (const [name, toolOverrides, reason, options] of integrityCases) test(name, () => {
  const gate = new ToolIntegrityGate({ catalog: { [toolId]: { version, digest, capabilities: ["repo:patch"] } }, trustRoots: { [signer]: trustSecret }, ...options });
  assert.ok(gate.verify(manifest(toolOverrides), { tenant_id: "tenant-a", requestedCapabilities: ["repo:patch"] }).reasons.some((item) => item.includes(reason)));
});

const policyCases = [
  ["tenant mismatch", (input) => { input.remediationProposal.tenant_id = "tenant-b"; }, "tenant"],
  ["work identity mismatch", (input) => { input.workIdentity.tenant_id = "tenant-b"; }, "tenant"],
  ["capability not granted", (input) => { input.requestedCapabilities = ["repo:admin"]; }, "capability"],
  ["path traversal", (input) => { input.remediationProposal.paths = ["../../etc/passwd"]; }, "path outside"],
  ["file outside scope", (input) => { input.remediationProposal.paths = ["/etc/passwd"]; }, "path outside"],
  ["secret environment read", (input) => { input.remediationProposal.environment = { API_KEY: "x" }; }, "environment variable denied"],
  ["global environment mutation", (input) => { input.remediationProposal.modify_global_environment = true; }, "global environment"],
  ["excessive output", (input) => { input.remediationProposal.expected_output_bytes = 2048; }, "output limit"],
  ["execution timeout", (input) => { input.remediationProposal.timeout_ms = 2000; }, "timeout"],
  ["missing checkpoint", (input) => { delete input.remediationProposal.checkpoint; }, "checkpoint"],
  ["checkpoint digest mismatch", (input) => { input.remediationProposal.checkpoint.digest = "bad"; }, "checkpoint"],
  ["rollback cross-tenant", (input) => { input.remediationProposal.checkpoint.tenant_id = "tenant-b"; }, "checkpoint"],
];
for (const [name, mutate, reason] of policyCases) test(name, async () => {
  const input = validInput(); mutate(input); const result = await layer().evaluate(input);
  assert.ok(result.reasons.some((item) => item.includes(reason)));
});

test("symlink escape", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-jail-"));
  fs.symlinkSync("/etc/passwd", path.join(root, "escape"));
  const input = validInput({ executionScope: { ...validInput().executionScope, root, bound_scope: root } });
  input.remediationProposal.paths = ["escape"];
  assert.ok((await layer().evaluate(input)).reasons.some((item) => item.includes("symlink escape")));
  fs.rmSync(root, { recursive: true, force: true });
});

const networkCases = [
  ["egress unauthorized host", "https://example.com/a", "NETWORK_TARGET_OUT_OF_SCOPE", {}],
  ["egress localhost", "http://localhost/a", "NETWORK_TARGET_OUT_OF_SCOPE", { hosts: ["localhost"], protocols: ["http"], ports: [80] }],
  ["cloud metadata endpoint", "http://169.254.169.254/latest/meta-data", "NETWORK_TARGET_OUT_OF_SCOPE", { hosts: ["169.254.169.254"], protocols: ["http"], ports: [80] }],
];
for (const [name, url, reason, network] of networkCases) test(name, async () => {
  const input = validInput({ networkIntent: { url, method: "GET" } }); input.executionScope.network = network;
  assert.ok((await layer().evaluate(input)).reasons.includes(reason));
});

test("redirect is revalidated", async () => {
  const input = validInput({ networkIntent: { url: "https://example.com/a", redirect_url: "http://localhost/a" } });
  input.executionScope.network = { hosts: ["example.com"], protocols: ["https"], ports: [443], methods: ["GET"] };
  assert.ok((await layer().evaluate(input)).reasons.includes("NETWORK_REDIRECT_POLICY_VIOLATION"));
});

test("expired execution lease is rejected", () => {
  const store = new ExecutionLeaseStore(); const issued = store.issue({ nonce: "n", tenant_id: "t" }, 1);
  store.leases.get(issued.leaseId).expiresAt = "2000-01-01T00:00:00.000Z";
  assert.equal(store.consume(issued.leaseId, { tenant_id: "t", work_id: undefined, session_id: undefined, remediation_id: undefined, operation: undefined, target: undefined, bound_scope: undefined, issuer: undefined, audience: undefined }), false);
});

test("reused nonce is blocked", async () => {
  const instance = layer(); const input = validInput({ nonce: "same-nonce" }); await instance.evaluate(input);
  assert.ok((await instance.evaluate(input)).reasons.includes("nonce replay detected"));
});

test("log payload secrets are redacted", () => {
  const value = sanitize({ Authorization: "Bearer secret", nested: { api_key: "secret", safe: "ok" } });
  assert.equal(value.Authorization, "[REDACTED]"); assert.equal(value.nested.api_key, "[REDACTED]");
});

test("audit chain alteration is detectable", () => {
  const first = { event_id: "1", previous_digest: null }; const firstDigest = sha256(first);
  const second = { event_id: "2", previous_digest: firstDigest }; const tampered = { ...first, event_id: "x" };
  assert.notEqual(sha256(tampered), second.previous_digest);
});

test("off mode preserves existing flow", async () => { assert.equal((await new HardeningDefensiveLayer({ mode: "off" }).evaluate({})).allowed, true); });
test("shadow mode records violations without blocking", async () => { const result = await layer().evaluate({}); assert.equal(result.allowed, true); assert.equal(result.verdict, "CORRECTABLE"); });
test("enforce mode blocks violations", async () => { const input = validInput(); input.remediationProposal.tenant_id = "tenant-b"; const result = await layer({ mode: "enforce" }).evaluate(input); assert.equal(result.allowed, false); assert.equal(result.verdict, "ABSOLUTE_BLOCK"); });
test("untrusted tools are quarantined in enforce mode", async () => { const input = validInput({ toolManifest: manifest({ content: "tampered" }) }); const result = await layer({ mode: "enforce" }).evaluate(input); assert.equal(result.verdict, "QUARANTINED"); });
test("legitimate legacy remediation remains compatible in off mode", async () => { assert.equal((await new HardeningDefensiveLayer({ mode: "off" }).evaluate({ legacy: true })).verdict, "ALLOWED"); });
test("security policy is semantic and does not scan command names", async () => { const input = validInput(); input.remediationProposal.command = "sudo curl wget are documentation words"; assert.equal((await layer().evaluate(input)).verdict, "ALLOWED"); });
