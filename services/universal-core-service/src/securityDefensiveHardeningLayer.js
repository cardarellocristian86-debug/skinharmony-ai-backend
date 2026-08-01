import crypto from "node:crypto";
import { promises as dns } from "node:dns";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const MODES = new Set(["off", "shadow", "enforce"]);
const SENSITIVE_KEY = /authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|credential/i;
const METRIC_NAMES = [
  "hardening_evaluations_total", "hardening_blocks_total", "hardening_quarantines_total",
  "integrity_failures_total", "privilege_escalation_attempts_total", "filesystem_scope_violations_total",
  "network_egress_denials_total", "execution_lease_replays_total", "rollback_verification_failures_total",
  "audit_chain_verification_failures_total",
];

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sanitize(value, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 2048 ? `${value.slice(0, 2048)}[TRUNCATED]` : value;
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitize(entry, seen));
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitize(entry, seen)]));
}

function isPrivateAddress(address) {
  if (net.isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
  }
  const normalized = String(address).toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

export class ToolIntegrityGate {
  constructor({ catalog = {}, trustRoots = {}, revoked = [], minimumVersions = {} } = {}) {
    this.catalog = catalog;
    this.trustRoots = trustRoots;
    this.revoked = new Set(revoked);
    this.minimumVersions = minimumVersions;
  }

  verify(manifest, context) {
    const reasons = [];
    const toolId = String(manifest?.tool_id || manifest?.toolId || "");
    const version = String(manifest?.version || "");
    const digest = String(manifest?.content_hash || manifest?.digest || "");
    const signer = manifest?.signer ? String(manifest.signer) : undefined;
    const entry = this.catalog[toolId];
    let trustStatus = "unknown";
    if (!toolId || !version || !digest || !manifest?.signature || !signer || !manifest?.provenance) reasons.push("incomplete contextual tool manifest");
    if (!entry) reasons.push("tool absent from capability catalog");
    if (entry && entry.version !== version) reasons.push("catalog version mismatch");
    if (entry && entry.digest !== digest) reasons.push("catalog digest mismatch");
    if (manifest?.content !== undefined && sha256(manifest.content) !== digest) reasons.push("content hash mismatch");
    if (this.revoked.has(`${toolId}@${version}`) || entry?.revoked) { trustStatus = "revoked"; reasons.push("tool revoked"); }
    if (manifest?.expires_at && Date.parse(manifest.expires_at) <= Date.now()) { trustStatus = "expired"; reasons.push("tool manifest expired"); }
    if (this.minimumVersions[toolId] && version.localeCompare(this.minimumVersions[toolId], undefined, { numeric: true }) < 0) reasons.push("version downgrade denied");
    if (manifest?.tenant_id && manifest.tenant_id !== context.tenant_id) reasons.push("tool tenant mismatch");
    const declared = new Set(manifest?.capabilities || []);
    for (const capability of context.requestedCapabilities || []) if (!declared.has(capability) || !entry?.capabilities?.includes(capability)) reasons.push(`unauthorized capability: ${capability}`);
    const trustRoot = this.trustRoots[signer];
    if (trustRoot && manifest?.signature) {
      const signed = [toolId, version, digest, manifest.provenance, manifest.tenant_id || "*"].join("\n");
      const expected = crypto.createHmac("sha256", trustRoot).update(signed).digest("hex");
      if (timingSafeEqual(expected, manifest.signature)) trustStatus = "trusted";
      else reasons.push("invalid signature");
    } else if (signer) reasons.push("unknown signer");
    if (trustStatus !== "trusted") reasons.push("untrusted provenance");
    return { verified: reasons.length === 0, toolId, version, digest, signer, trustStatus, reasons: [...new Set(reasons)] };
  }
}

export class ExecutionJailPolicy {
  constructor({ processAdapter } = {}) { this.processAdapter = processAdapter; }

  evaluate(scope = {}, proposal = {}) {
    const reasons = [];
    const root = path.resolve(String(scope.root || scope.bound_scope || ""));
    if (!root || root === path.parse(root).root) reasons.push("invalid or root bound_scope");
    for (const requestedPath of proposal.paths || []) {
      const candidate = path.resolve(root, String(requestedPath));
      if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) reasons.push(`path outside bound_scope: ${requestedPath}`);
      if ((proposal.symlinks || []).includes(requestedPath)) reasons.push(`symlink escape denied: ${requestedPath}`);
      if (fs.existsSync(candidate)) {
        const real = fs.realpathSync(candidate);
        if (real !== root && !real.startsWith(`${root}${path.sep}`)) reasons.push(`symlink escape denied: ${requestedPath}`);
      }
    }
    const envAllowlist = new Set(scope.environment_allowlist || []);
    for (const key of Object.keys(proposal.environment || {})) {
      if (SENSITIVE_KEY.test(key) || !envAllowlist.has(key)) reasons.push(`environment variable denied: ${key}`);
    }
    if (proposal.modify_global_environment) reasons.push("global environment mutation denied");
    if (Number(proposal.timeout_ms || 0) > Number(scope.max_timeout_ms || 30_000)) reasons.push("execution timeout exceeds policy");
    if (Number(proposal.expected_output_bytes || 0) > Number(scope.max_output_bytes || 1_000_000)) reasons.push("output limit exceeds policy");
    const controls = ["filesystem-deny-default", "path-containment", "environment-allowlist", "deterministic-cleanup-policy"];
    const unavailable = [];
    if (this.processAdapter?.enforced) controls.push("process-isolation", "non-privileged-user", "execution-limits");
    else unavailable.push("process-isolation", "non-privileged-user", "os-memory-limit");
    return { allowed: reasons.length === 0, status: unavailable.length ? "partially_enforced" : "enforced", reasons, controls, unavailable };
  }
}

export class NetworkEgressPolicy {
  async evaluate(intent, policy = {}) {
    if (!intent) return { allowed: true, reasons: [], controls: ["network-deny-default"], unavailable: [] };
    const reasons = [];
    let target;
    try { target = new URL(intent.url); } catch { return { allowed: false, reasons: ["invalid network target"], controls: [], unavailable: [] }; }
    const protocol = target.protocol.replace(":", "");
    const port = Number(target.port || (protocol === "https" ? 443 : 80));
    if (!(policy.hosts || []).includes(target.hostname)) reasons.push("NETWORK_TARGET_OUT_OF_SCOPE");
    if (!(policy.protocols || ["https"]).includes(protocol) || !(policy.ports || [443]).includes(port)) reasons.push("NETWORK_EGRESS_DENIED");
    if (!(policy.methods || ["GET"]).includes(String(intent.method || "GET").toUpperCase())) reasons.push("NETWORK_EGRESS_DENIED");
    if (target.hostname === "localhost" || target.hostname.endsWith(".localhost") || target.hostname === "169.254.169.254") reasons.push("NETWORK_TARGET_OUT_OF_SCOPE");
    try {
      const addresses = await dns.lookup(target.hostname, { all: true });
      if (!policy.allow_private && addresses.some(({ address }) => isPrivateAddress(address))) reasons.push("NETWORK_TARGET_OUT_OF_SCOPE");
    } catch { reasons.push("DNS resolution failed closed"); }
    if (intent.redirect_url) {
      const redirected = await this.evaluate({ ...intent, url: intent.redirect_url, redirect_url: undefined }, policy);
      if (!redirected.allowed) reasons.push("NETWORK_REDIRECT_POLICY_VIOLATION");
    }
    return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], controls: ["network-deny-default", "dns-validation", "redirect-revalidation"], unavailable: policy.adapter_enforced ? [] : ["os-egress-isolation"] };
  }
}

export class ExecutionLeaseStore {
  constructor() { this.leases = new Map(); this.nonces = new Set(); }
  issue(context, ttlMs = 60_000) {
    if (!context.nonce || this.nonces.has(context.nonce)) return null;
    this.nonces.add(context.nonce);
    const leaseId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + Math.min(Math.max(ttlMs, 1000), 300_000)).toISOString();
    const scopeDigest = sha256({ tenant_id: context.tenant_id, work_id: context.work_id, session_id: context.session_id, remediation_id: context.remediation_id, operation: context.operation, target: context.target, bound_scope: context.bound_scope, issuer: context.issuer, audience: context.audience });
    this.leases.set(leaseId, { ...context, leaseId, expiresAt, scopeDigest, consumed: false, revoked: false });
    return { leaseId, expiresAt, scopeDigest };
  }
  consume(leaseId, context) {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.revoked || lease.consumed || Date.parse(lease.expiresAt) <= Date.now() || lease.scopeDigest !== sha256(context)) return false;
    lease.consumed = true;
    return true;
  }
  revoke(leaseId) { const lease = this.leases.get(leaseId); if (lease) lease.revoked = true; }
}

export class HardeningDefensiveLayer {
  constructor(options = {}) {
    this.mode = MODES.has(options.mode) ? options.mode : "off";
    this.integrity = options.integrityGate || new ToolIntegrityGate(options);
    this.jail = options.jailPolicy || new ExecutionJailPolicy(options);
    this.network = options.networkPolicy || new NetworkEgressPolicy();
    this.leases = options.leaseStore || new ExecutionLeaseStore();
    this.audit = options.audit;
    this.metrics = Object.fromEntries(METRIC_NAMES.map((name) => [name, 0]));
  }
  increment(name) { if (name in this.metrics) this.metrics[name] += 1; }
  snapshotMetrics() { return { ...this.metrics }; }

  async evaluate(input = {}) {
    const auditEventId = crypto.randomUUID();
    if (this.mode === "off") return { allowed: true, verdict: "ALLOWED", reasons: [], enforcedControls: [], unavailableControls: [], auditEventId };
    this.increment("hardening_evaluations_total");
    const reasons = [], enforcedControls = [], unavailableControls = [];
    let policyCode;
    const required = ["tenantContext", "workIdentity", "remediationProposal", "executionScope"];
    if (required.some((key) => !input[key])) { reasons.push("invalid hardening input schema"); policyCode = "SECURITY_HARDENING_POLICY_VIOLATION"; }
    const tenantId = input.tenantContext?.tenant_id;
    if (!tenantId || input.workIdentity?.tenant_id !== tenantId || input.remediationProposal?.tenant_id !== tenantId) { reasons.push("tenant or work identity mismatch"); policyCode ||= "SECURITY_HARDENING_POLICY_VIOLATION"; }
    if (!input.nonce) { reasons.push("missing anti-replay nonce"); policyCode ||= "PRIVILEGE_ESCALATION_BLOCKED"; }
    const integrity = this.integrity.verify(input.toolManifest, { tenant_id: tenantId, requestedCapabilities: input.requestedCapabilities });
    enforcedControls.push("tool-integrity-provenance");
    if (!integrity.verified) { reasons.push(...integrity.reasons); policyCode = "UNTRUSTED_TOOL_DETECTED"; this.increment("integrity_failures_total"); }
    const requested = input.requestedCapabilities || [];
    const granted = new Set(input.workIdentity?.capabilities || []);
    if (requested.some((item) => item === "*" || item === "root" || !granted.has(item))) { reasons.push("capability escalation denied"); policyCode ||= "PRIVILEGE_ESCALATION_BLOCKED"; this.increment("privilege_escalation_attempts_total"); }
    const jail = this.jail.evaluate(input.executionScope, input.remediationProposal);
    enforcedControls.push(...jail.controls); unavailableControls.push(...jail.unavailable);
    if (!jail.allowed) { reasons.push(...jail.reasons); policyCode ||= "SECURITY_HARDENING_POLICY_VIOLATION"; this.increment("filesystem_scope_violations_total"); }
    const network = await this.network.evaluate(input.networkIntent, input.executionScope?.network || {});
    enforcedControls.push(...network.controls); unavailableControls.push(...network.unavailable);
    if (!network.allowed) { reasons.push(...network.reasons); policyCode ||= network.reasons[0] || "NETWORK_EGRESS_DENIED"; this.increment("network_egress_denials_total"); }
    const checkpoint = input.remediationProposal?.checkpoint;
    if (!checkpoint || checkpoint.tenant_id !== tenantId || checkpoint.work_id !== input.workIdentity?.work_id || checkpoint.repository !== input.executionScope?.repository || checkpoint.stale || checkpoint.digest !== sha256(checkpoint.payload)) {
      reasons.push("checkpoint missing, stale, mismatched, or unverified"); policyCode ||= "ROLLBACK_VERIFICATION_FAILED"; this.increment("rollback_verification_failures_total");
    } else enforcedControls.push("verified-checkpoint-rollback");
    if (this.mode === "enforce" && unavailableControls.length) { reasons.push("required isolation control unavailable"); policyCode ||= "SECURITY_HARDENING_POLICY_VIOLATION"; }
    let executionLease;
    if (!reasons.length) {
      executionLease = this.leases.issue({ tenant_id: tenantId, work_id: input.workIdentity.work_id, session_id: input.workIdentity.session_id, remediation_id: input.remediationProposal.remediation_id, operation: input.remediationProposal.operation, target: input.remediationProposal.target, bound_scope: input.executionScope.bound_scope || input.executionScope.root, issuer: input.issuer, audience: input.audience, nonce: input.nonce }, input.leaseTtlMs);
      if (!executionLease) { reasons.push("nonce replay detected"); policyCode = "PRIVILEGE_ESCALATION_BLOCKED"; this.increment("execution_lease_replays_total"); }
      else enforcedControls.push("single-use-execution-lease");
    }
    const blocked = reasons.length > 0;
    const verdict = blocked ? (policyCode === "UNTRUSTED_TOOL_DETECTED" ? "QUARANTINED" : "ABSOLUTE_BLOCK") : "ALLOWED";
    if (blocked) this.increment("hardening_blocks_total");
    if (verdict === "QUARANTINED") this.increment("hardening_quarantines_total");
    const event = { event_id: auditEventId, schema_version: "1.1", tenant_id: tenantId, work_id: input.workIdentity?.work_id, session_id: input.workIdentity?.session_id, remediation_id: input.remediationProposal?.remediation_id, agent_id: input.workIdentity?.agent_id, tool_id: integrity.toolId, event_type: blocked ? policyCode : "HARDENING_ALLOWED", severity: blocked ? "CRITICAL" : "INFO", policy_code: policyCode, decision: verdict, timestamp: new Date().toISOString(), metadata: sanitize({ reasons, enforcedControls, unavailableControls, destination: input.networkIntent?.url }) };
    if (this.audit?.appendSecurityEvent) await this.audit.appendSecurityEvent(event);
    return { allowed: this.mode === "shadow" ? true : !blocked, verdict: this.mode === "shadow" && blocked ? "CORRECTABLE" : verdict, policyCode, reasons: [...new Set(reasons)], enforcedControls: [...new Set(enforcedControls)], unavailableControls: [...new Set(unavailableControls)], executionLease, auditEventId };
  }
}

export function createHardeningDefensiveLayer(options = {}) {
  return new HardeningDefensiveLayer({ ...options, mode: options.mode ?? process.env.NYRA_DEFENSIVE_HARDENING_MODE ?? "off" });
}

export { sanitize, sha256 };
