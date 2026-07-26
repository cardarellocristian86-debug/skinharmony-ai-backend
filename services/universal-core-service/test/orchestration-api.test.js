import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createUniversalCoreService } from "../src/app.js";

async function request(base, method, pathname, body, key) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

test("orchestration API is tenant-bound, paged and proposal-only", async () => {
  const previousAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "orchestration-api-admin";
  const { app } = createUniversalCoreService({
    storageRoot: path.join(os.tmpdir(), `core-orchestration-${Date.now()}-${Math.random()}`),
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const generated = await request(base, "POST", "/v1/keys/generate", {
      tenant_id: "tenant-orchestration",
      preset: "codex_automation",
    }, "orchestration-api-admin");
    const key = generated.json.key;

    const catalog = await request(
      base,
      "GET",
      "/v1/orchestration/capabilities?branch=agent_orchestration&view=virtual&limit=2",
      undefined,
      key,
    );
    assert.equal(catalog.status, 200);
    assert.equal(catalog.json.tenant_id, "tenant-orchestration");
    assert.equal(catalog.json.items.length, 2);
    assert.equal(catalog.json.items[0].materialized, false);
    assert.equal(catalog.json.execution_authorized, false);

    const deniedRelational = await request(base, "POST", "/v1/orchestration/relational/evaluate", {
      tenant_id: "attacker-tenant",
      objective: "Coordinate bounded work",
      actors: [
        { actor_id: "core", role: "core" },
        { actor_id: "relations", role: "relational_supervisor" },
        { actor_id: "nyra", role: "nyra" },
      ],
      relations: [
        { from: "core", to: "relations", type: "governs" },
        { from: "relations", to: "nyra", type: "coordinates" },
      ],
    }, key);
    assert.equal(deniedRelational.status, 403);
    const relational = await request(base, "POST", "/v1/orchestration/relational/evaluate", {
      objective: "Coordinate bounded work",
      actors: [
        { actor_id: "core", role: "core" },
        { actor_id: "relations", role: "relational_supervisor" },
        { actor_id: "nyra", role: "nyra" },
      ],
      relations: [
        { from: "core", to: "relations", type: "governs" },
        { from: "relations", to: "nyra", type: "coordinates" },
      ],
    }, key);
    assert.equal(relational.status, 200);
    assert.equal(relational.json.tenant_id, "tenant-orchestration");
    assert.equal(relational.json.hierarchy.decision_authority, "universal_core");
    assert.equal(relational.json.guarantees.execution_authorized, false);

    const deniedTree = await request(base, "POST", "/v1/orchestration/dtt/plan", {
      tenant_id: "attacker-tenant",
      objective: "Research, verify and join",
      nodes: [
        { node_id: "research", kind: "research", task: "Collect evidence", depth: 0 },
        {
          node_id: "verify",
          kind: "verification",
          task: "Verify evidence",
          parent_node_id: "research",
          dependencies: ["research"],
          depth: 1,
        },
      ],
    }, key);
    assert.equal(deniedTree.status, 403);
    const tree = await request(base, "POST", "/v1/orchestration/dtt/plan", {
      objective: "Research, verify and join",
      nodes: [
        { node_id: "research", kind: "research", task: "Collect evidence", depth: 0 },
        {
          node_id: "verify",
          kind: "verification",
          task: "Verify evidence",
          parent_node_id: "research",
          dependencies: ["research"],
          depth: 1,
        },
      ],
    }, key);
    assert.equal(tree.status, 200);
    assert.equal(tree.json.tenant_id, "tenant-orchestration");
    assert.equal(tree.json.execution.authorized, false);
    assert.equal(tree.json.execution.core_join_required, true);
    assert.equal(tree.json.limits.max_parallel, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = previousAdmin;
  }
});
