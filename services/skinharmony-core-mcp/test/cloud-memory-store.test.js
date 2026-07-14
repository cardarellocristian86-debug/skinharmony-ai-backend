import assert from "node:assert/strict";
import test from "node:test";
import { createCloudMemoryStore, redactMemoryText, stableMemoryId } from "../src/cloud-memory-store.js";

test("cloud memory ids are deterministic and tenant scoped", () => {
  assert.equal(stableMemoryId("tenant-a", "snapshots/state.md"), stableMemoryId("tenant-a", "snapshots/state.md"));
  assert.notEqual(stableMemoryId("tenant-a", "snapshots/state.md"), stableMemoryId("tenant-b", "snapshots/state.md"));
});

test("cloud memory redacts common credentials before persistence", () => {
  const result = redactMemoryText("token=abc123456 password=hunter2 Authorization: Bearer-value");
  assert.equal(result.redactions, 3);
  assert(!result.text.includes("hunter2"));
  assert(!result.text.includes("abc123456"));
});

test("cloud memory search matches every term without requiring phrase order", async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: params ? [{ id: "a".repeat(24), title: "Owner preflight report" }] : [] };
    },
  };
  const store = createCloudMemoryStore({ databaseUrl: "postgres://memory.test/db" }, { pool });

  const results = await store.search("tenant-a", "nested preflight owner", 7);

  assert.deepEqual(results, [{ id: "a".repeat(24), title: "Owner preflight report", url: "" }]);
  const searchCall = calls.at(-1);
  assert.match(searchCall.sql, /ILIKE ALL \(\$2::text\[\]\)/);
  assert.deepEqual(searchCall.params, ["tenant-a", ["%nested%", "%preflight%", "%owner%"], 7]);
});
