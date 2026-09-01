import assert from "node:assert/strict";
import test from "node:test";
import { createCloudMemoryStore, platformLearningBlockKey, redactMemoryText, stableMemoryId } from "../src/cloud-memory-store.js";

test("cloud memory ids are deterministic and tenant scoped", () => {
  assert.equal(stableMemoryId("tenant-a", "snapshots/state.md"), stableMemoryId("tenant-a", "snapshots/state.md"));
  assert.notEqual(stableMemoryId("tenant-a", "snapshots/state.md"), stableMemoryId("tenant-b", "snapshots/state.md"));
});

test("platform learning block keys contain only the reusable failure class", () => {
  assert.equal(
    platformLearningBlockKey("nyra_converse", "agent_instance_conflict"),
    platformLearningBlockKey("nyra_converse", "agent_instance_conflict"),
  );
  assert.notEqual(
    platformLearningBlockKey("nyra_converse", "agent_instance_conflict"),
    platformLearningBlockKey("nyra_converse", "core_unavailable"),
  );
});

test("cloud memory redacts common credentials before persistence", () => {
  const result = redactMemoryText("token=abc123456 password=hunter2 Authorization: Bearer-value");
  assert.equal(result.redactions, 3);
  assert(!result.text.includes("hunter2"));
  assert(!result.text.includes("abc123456"));
});

test("cloud memory does not redact ordinary SkinHarmony repository names", () => {
  const url = "https://github.com/cardarellocristian86-debug/skinharmony-ai-backend/pull/44";
  const result = redactMemoryText(url);
  assert.equal(result.redactions, 0);
  assert.equal(result.text, url);
});

test("cloud memory still redacts structured provider credentials", () => {
  const input = [
    `sk-${"a".repeat(20)}`,
    `sk-proj-${"b".repeat(20)}`,
    `ghp_${"c".repeat(20)}`,
    `xoxb-${"d".repeat(20)}`,
    `AKIA${"E".repeat(16)}`,
  ].join(" ");
  const result = redactMemoryText(input);
  assert.equal(result.redactions, 5);
  assert.equal(result.text.includes("aaaa"), false);
  assert.equal(result.text.includes("cccc"), false);
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

test("canonical bootstrap lookup uses exact tenant-scoped source paths", async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  const store = createCloudMemoryStore({ databaseUrl: "postgres://memory.test/db" }, { pool });
  const paths = ["SHARED_MEMORY/STATE.json", "SHARED_MEMORY/HANDOFF.md"];
  await store.inspectBySourcePaths("codexai", paths);
  await store.fetchBySourcePaths("codexai", paths);
  const [inspect, fetch] = calls.slice(-2);
  assert.match(inspect.sql, /tenant_id = \$1 AND source_path = ANY\(\$2::text\[\]\)/);
  assert.match(fetch.sql, /tenant_id = \$1 AND source_path = ANY\(\$2::text\[\]\)/);
  assert.deepEqual(inspect.params, ["codexai", paths]);
  assert.deepEqual(fetch.params, ["codexai", paths]);
});

test("distilled failures persist only structured, tenant-scoped lesson metadata", async () => {
  const calls = [];
  const pool = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: params ? [{ source_tool: "nyra_converse", failure_code: "core_unavailable", occurrence_count: 1 }] : [] };
  } };
  const store = createCloudMemoryStore({ databaseUrl: "postgres://memory.test/db" }, { pool });
  await store.recordDistilledFailure({ tenantId: "tenant-a" }, {
    toolName: "nyra_converse",
    args: { project_id: "nyra-runtime" },
    error: { code: "core unavailable: raw prompt must not persist" },
  });
  const write = calls.find((call) => /INSERT INTO mcp_memory_distilled_lessons/.test(call.sql));
  assert.match(write.sql, /mcp_memory_distilled_lessons/);
  assert.deepEqual(write.params, ["tenant-a", "nyra-runtime", "nyra_converse", "unclassified_failure"]);
  assert.equal(JSON.stringify(write.params).includes("raw prompt"), false);
  const platformWrite = calls.find((call) => /INSERT INTO mcp_platform_learning_blocks/.test(call.sql));
  assert.match(platformWrite.sql, /block_key, source_tool, failure_code/);
  assert.equal(JSON.stringify(platformWrite.params).includes("tenant-a"), false);
});

test("platform learning reads only bounded anonymized shadow or verified blocks", async () => {
  const calls = [];
  const pool = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: params ? [{
      block_key: "a".repeat(64), source_tool: "nyra_converse", failure_code: "agent_instance_conflict",
      occurrence_count: 4, corroborating_tenant_count: 2, lifecycle_state: "shadow",
    }] : [] };
  } };
  const store = createCloudMemoryStore({ databaseUrl: "postgres://memory.test/db" }, { pool });
  const blocks = await store.listPlatformLearningBlocks(99);
  const read = calls.at(-1);
  assert.match(read.sql, /lifecycle_state IN \('shadow', 'verified'\)/);
  assert.deepEqual(read.params, [20]);
  assert.equal(blocks[0].scope, "platform_anonymized");
  assert.equal(blocks[0].entity_360_reference.entity_type, "nyra_platform_learning_block");
  assert.equal(Object.hasOwn(blocks[0], "tenant_id"), false);
});
