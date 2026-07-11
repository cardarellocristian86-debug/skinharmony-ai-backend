import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createCloudEvent, createExperienceLedger, createIntelligenceSpine } from "../src/intelligenceSpine.js";

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sh-intelligence-spine-"));

const event = createCloudEvent({
  type: "com.skinharmony.core.decision.completed",
  subject: "POST /v1/decision",
  traceId: "a".repeat(32),
  data: { mode: "shadow", decisions_mutated: false },
});

assert.equal(event.specversion, "1.0");
assert.equal(event.traceid, "a".repeat(32));
assert.equal(event.data.decisions_mutated, false);

const ledger = createExperienceLedger(storageRoot, { signingSecret: "test-secret" });
const first = ledger.append(event);
const second = ledger.append(createCloudEvent({
  type: "com.skinharmony.owner.feedback.recorded",
  subject: "POST /v1/review/action",
  traceId: "b".repeat(32),
  data: { mode: "shadow", decisions_mutated: false },
}));

assert.equal(first.written, true);
assert.equal(second.written, true);
assert.notEqual(first.hash, second.hash);
assert.equal(ledger.status().events, 2);
assert.equal(ledger.status().signed, true);
assert.equal(ledger.status().decisions_mutated, false);

const lines = fs
  .readFileSync(path.join(storageRoot, "intelligence-spine", "experience-ledger.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

assert.equal(lines.length, 2);
assert.equal(lines[0].integrity.previous_hash, "GENESIS");
assert.equal(lines[1].integrity.previous_hash, lines[0].integrity.hash);
assert.equal(lines[0].integrity.production_signed, true);

const spine = createIntelligenceSpine(storageRoot, { enabled: false });
assert.equal(spine.status().enabled, false);

const middlewareStorage = fs.mkdtempSync(path.join(os.tmpdir(), "sh-intelligence-middleware-"));
const activeSpine = createIntelligenceSpine(middlewareStorage, {
  enabled: true,
  refSecret: "tenant-ref-test",
  signingSecret: "ledger-signing-test",
});
const req = {
  body: { tenant_id: "tenant-secret", customer_email: "private@example.test" },
  method: "POST",
  originalUrl: "/v1/decision?debug=true",
  get(name) {
    return name.toLowerCase() === "x-request-id" ? "req-test" : "";
  },
};
const responseEvents = new EventEmitter();
const headers = new Map();
const res = Object.assign(responseEvents, {
  statusCode: 200,
  setHeader(name, value) { headers.set(name.toLowerCase(), value); },
  getHeader(name) { return headers.get(name.toLowerCase()); },
  json(payload) { this.payload = payload; return this; },
});
let nextCalled = false;
activeSpine.middleware(req, res, () => { nextCalled = true; });
assert.equal(nextCalled, true);
res.json({
  decision_contract: { state: "attention", control_level: "confirm", risk_band: "medium", confidence: 82 },
  ignored_private_payload: "must-not-be-stored",
});
res.emit("finish");

const middlewareRecord = JSON.parse(
  fs.readFileSync(path.join(middlewareStorage, "intelligence-spine", "experience-ledger.jsonl"), "utf8").trim(),
);
const serializedMiddlewareRecord = JSON.stringify(middlewareRecord);
assert.equal(middlewareRecord.type, "com.skinharmony.core.decision.completed");
assert.equal(middlewareRecord.data.route, "/v1/decision");
assert.equal(middlewareRecord.data.decision.control_level, "confirm");
assert.equal(middlewareRecord.data.contains_raw_body, false);
assert.equal(serializedMiddlewareRecord.includes("private@example.test"), false);
assert.equal(serializedMiddlewareRecord.includes("must-not-be-stored"), false);
assert.equal(serializedMiddlewareRecord.includes("tenant-secret"), false);
assert.equal(typeof middlewareRecord.data.tenant_ref, "string");
assert.equal(headers.has("traceparent"), true);

console.log(JSON.stringify({
  ok: true,
  checks: ["cloudevent_contract", "privacy_minimal_payload", "hash_chain", "signed_ledger", "shadow_mode", "middleware_trace", "no_raw_body"],
  events: ledger.status().events,
}, null, 2));
