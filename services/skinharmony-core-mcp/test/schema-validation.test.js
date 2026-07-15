import assert from "node:assert/strict";
import test from "node:test";
import { validateToolArguments } from "../src/schema-validation.js";

test("validates required, bounds, enums, nested items and additional properties", () => {
  const schema = {
    type: "object",
    required: ["items"],
    properties: {
      items: { type: "array", minItems: 1, items: { type: "object", required: ["mode"], properties: { mode: { enum: ["safe"] }, score: { type: "number", minimum: 0, maximum: 100 } }, additionalProperties: false } },
    },
    additionalProperties: false,
  };
  assert.deepEqual(validateToolArguments(schema, { items: [{ mode: "safe", score: 50 }] }), []);
  const errors = validateToolArguments(schema, { items: [{ mode: "unsafe", score: 101, tenant_id: "x" }], tenant_id: "x" });
  assert(errors.some((item) => item.code === "enum"));
  assert(errors.some((item) => item.code === "maximum"));
  assert.equal(errors.filter((item) => item.code === "additional_property").length, 2);
});
