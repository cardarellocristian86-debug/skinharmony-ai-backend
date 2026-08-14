import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

function signingSecret(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") < 32) fail("github_worker_ledger_secret_invalid");
  return value;
}

function signature(secret, unsigned) {
  return `gwl_${crypto.createHmac("sha256", secret).update(canonical(unsigned)).digest("hex")}`;
}

function signed(secret, value) {
  const unsigned = { ...value };
  delete unsigned.signature;
  return { ...unsigned, signature: signature(secret, unsigned) };
}

function verify(secret, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("github_worker_ledger_corrupt");
  const unsigned = { ...value };
  delete unsigned.signature;
  const expected = Buffer.from(signature(secret, unsigned));
  const actual = Buffer.from(String(value.signature || ""));
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) fail("github_worker_ledger_corrupt");
  return value;
}

export function createFileExecutionLedger({ root, signing_secret, now = Date.now } = {}) {
  const secret = signingSecret(signing_secret);
  if (typeof root !== "string" || !path.isAbsolute(root) || root === "/") fail("github_worker_ledger_root_invalid");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, "github-worker-executions.json");

  function read() {
    if (!fs.existsSync(file)) return { schema_version: "github_worker_execution_ledger_v1", records: {} };
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); } catch { fail("github_worker_ledger_corrupt"); }
    verify(secret, parsed);
    if (parsed.schema_version !== "github_worker_execution_ledger_v1" || !parsed.records || typeof parsed.records !== "object") {
      fail("github_worker_ledger_corrupt");
    }
    return parsed;
  }

  function write(state) {
    const output = signed(secret, state);
    const temp = path.join(root, `.github-worker-executions.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
    fs.writeFileSync(temp, `${JSON.stringify(output)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
    return output;
  }

  function mutate(callback) {
    const state = structuredClone(read());
    const result = callback(state);
    write(state);
    return structuredClone(result);
  }

  return Object.freeze({
    accept(claim) {
      const key = claim.nonce;
      const claimDigest = digest(claim);
      return mutate((state) => {
        const existing = state.records[key];
        if (existing) {
          if (existing.claim_digest !== claimDigest) fail("github_worker_claim_replay_conflict");
          return existing;
        }
        const at = new Date(Number(now())).toISOString();
        const record = signed(secret, {
          schema_version: "github_worker_execution_record_v1",
          nonce: key,
          tenant_id: claim.tenant_id,
          repository: claim.repository,
          ticket_id: claim.ticket_id,
          reservation_id: claim.reservation_id,
          action_digest: claim.action_digest,
          claim_digest: claimDigest,
          state: "accepted",
          accepted_at: at,
          updated_at: at,
          result: null,
        });
        state.records[key] = record;
        return record;
      });
    },
    begin(claim) {
      return mutate((state) => {
        const record = state.records[claim.nonce];
        if (!record || record.claim_digest !== digest(claim)) fail("github_worker_execution_not_accepted");
        verify(secret, record);
        if (record.state === "in_progress") {
          const quarantined = signed(secret, { ...record, state: "outcome_unknown", updated_at: new Date(Number(now())).toISOString(), result: null });
          state.records[claim.nonce] = quarantined;
          return quarantined;
        }
        if (record.state !== "accepted") return record;
        const active = signed(secret, { ...record, state: "in_progress", updated_at: new Date(Number(now())).toISOString() });
        state.records[claim.nonce] = active;
        return active;
      });
    },
    finish(claim, { state: outcome, result = null } = {}) {
      if (!new Set(["succeeded", "failed", "outcome_unknown"]).has(outcome)) fail("github_worker_execution_outcome_invalid");
      return mutate((ledger) => {
        const record = ledger.records[claim.nonce];
        if (!record || record.claim_digest !== digest(claim)) fail("github_worker_execution_not_accepted");
        verify(secret, record);
        if (record.state !== "in_progress") fail("github_worker_execution_not_in_progress");
        const terminal = signed(secret, { ...record, state: outcome, updated_at: new Date(Number(now())).toISOString(), result });
        ledger.records[claim.nonce] = terminal;
        return terminal;
      });
    },
    reconcile(claim, { state: outcome, result = null } = {}) {
      if (!new Set(["succeeded", "failed"]).has(outcome)) fail("github_worker_reconciliation_outcome_invalid");
      return mutate((ledger) => {
        const record = ledger.records[claim.nonce];
        if (!record || record.claim_digest !== digest(claim)) fail("github_worker_execution_not_accepted");
        verify(secret, record);
        if (record.state !== "outcome_unknown") fail("github_worker_execution_not_reconcilable");
        const terminal = signed(secret, { ...record, state: outcome, updated_at: new Date(Number(now())).toISOString(), result });
        ledger.records[claim.nonce] = terminal;
        return terminal;
      });
    },
    read(nonce) {
      const record = read().records[String(nonce || "")];
      return record ? structuredClone(verify(secret, record)) : null;
    },
  });
}
