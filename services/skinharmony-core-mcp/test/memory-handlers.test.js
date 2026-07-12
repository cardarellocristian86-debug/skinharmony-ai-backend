import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMemoryHandlers } from "../src/memory-handlers.js";

test("search and fetch stay inside the authenticated tenant", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-memory-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [tenant, text] of [["tenant-a", "alpha private work"], ["tenant-b", "beta confidential work"]]) {
    const dir = path.join(root, "tenants", tenant, "documents");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "aaaaaaaaaaaaaaaaaaaaaaaa.json"), JSON.stringify({ id: "aaaaaaaaaaaaaaaaaaaaaaaa", title: `${tenant}.md`, source_path: "report.md", text }));
  }
  const handlers = createMemoryHandlers({ sharedMemoryRoot: root, publicUrl: "https://mcp.test" });
  const search = JSON.parse((await handlers.search({ query: "work" }, { tenantId: "tenant-a" })).content[0].text);
  assert.equal(search.results.length, 1);
  assert.equal(search.results[0].title, "tenant-a.md");
  const fetched = JSON.parse((await handlers.fetch({ id: search.results[0].id }, { tenantId: "tenant-a" })).content[0].text);
  assert.match(fetched.text, /alpha/);
  const isolated = JSON.parse((await handlers.search({ query: "beta" }, { tenantId: "tenant-a" })).content[0].text);
  assert.deepEqual(isolated.results, []);
});
