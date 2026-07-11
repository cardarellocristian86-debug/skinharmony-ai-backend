import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createIntelligenceSpine } from "../src/intelligenceSpine.js";

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sh-intelligence-http-"));
const spine = createIntelligenceSpine(storageRoot, {
  enabled: true,
  refSecret: "http-tenant-ref-test",
  signingSecret: "http-ledger-signing-test",
});
const gateway = express();
const core = express();

gateway.use(spine.middleware);
core.use(express.json());
core.post("/v1/decision", (req, res) => {
  assert.equal(req.body.tenant_id, "tenant-http-test");
  res.json({
    ok: true,
    tenant_id: req.body.tenant_id,
    decision_contract: {
      state: "attention",
      control_level: "confirm",
      risk_band: "medium",
      confidence: 79,
      owner_confirmation_required: true,
    },
    private_detail: "response-private-detail",
  });
});
gateway.use(core);

const server = gateway.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));

try {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/decision`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "http-test-request" },
    body: JSON.stringify({
      tenant_id: "tenant-http-test",
      customer_email: "http-private@example.test",
      signals: [{ id: "safe-signal", value: 50 }],
    }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("traceparent"), /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  const payload = await response.json();
  assert.equal(payload.decision_contract.control_level, "confirm");

  const ledgerFile = path.join(storageRoot, "intelligence-spine", "experience-ledger.jsonl");
  const record = JSON.parse(fs.readFileSync(ledgerFile, "utf8").trim());
  const serialized = JSON.stringify(record);
  assert.equal(record.type, "com.skinharmony.core.decision.completed");
  assert.equal(record.data.learning_eligible, true);
  assert.equal(record.data.decision.owner_confirmation_required, true);
  assert.equal(record.data.contains_raw_body, false);
  assert.equal(serialized.includes("http-private@example.test"), false);
  assert.equal(serialized.includes("response-private-detail"), false);
  assert.equal(serialized.includes("tenant-http-test"), false);

  console.log(JSON.stringify({
    ok: true,
    checks: ["express_gateway", "trace_propagation", "decision_summary", "tenant_pseudonymization", "no_raw_payload"],
  }, null, 2));
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
