import assert from "node:assert/strict";
import test from "node:test";

import { createNyraSignedReceipt, verifyNyraSignedReceipt } from "../../shared/nyra-work-automation-receipts.js";

test("automation receipts are monouse exact-bound HMAC evidence", () => {
  const now = 1_700_000_000_000;
  const receipt = createNyraSignedReceipt({ schema_version: "host_native_action_completion_receipt_v1", tenant_id: "tenant", work_id: "work", action_digest: "a".repeat(64) }, { secret: "s".repeat(64), now: () => now });
  assert.equal(verifyNyraSignedReceipt(receipt, { secret: "s".repeat(64), now: () => now + 1, expected: { tenant_id: "tenant", work_id: "work" } }).work_id, "work");
  assert.throws(() => verifyNyraSignedReceipt(receipt, { secret: "s".repeat(64), now: () => now + 1, expected: { work_id: "other" } }), /binding_mismatch/);
});
