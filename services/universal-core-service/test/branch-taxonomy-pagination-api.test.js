import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createUniversalCoreService } from "../src/app.js";
import { paginateBranchTaxonomy } from "../src/branchTaxonomyPagination.js";

const gatewayKey = "branch-taxonomy-gateway-key-012345678901234567890";
const tenantSecret = "branch-taxonomy-tenant-secret-012345678901234567890";

function tenantContext(tenantId) {
  const value = {
    version: "mcp_tenant_context_v1",
    tenant_id: tenantId,
    issued_at: new Date().toISOString(),
  };
  const assertion = `mtc_${crypto.createHmac("sha256", tenantSecret)
    .update(`mcp-tenant-context\0${JSON.stringify(value)}`).digest("hex")}`;
  return Buffer.from(JSON.stringify({ ...value, assertion })).toString("base64url");
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function read(url, tenantId = "tenant-a") {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${gatewayKey}`,
      "x-sh-tenant-id": tenantId,
      "x-sh-tenant-context": tenantContext(tenantId),
    },
  });
  return { response, body: await response.json() };
}

test("branch taxonomy cursor is bound to the exact taxonomy digest", () => {
  const taxonomy = {
    schema_version: "branch_taxonomy_v3",
    nodes: [
      { node_id: "root", depth: 1 },
      { node_id: "child", depth: 2 },
    ],
    synapses: [],
  };
  const first = paginateBranchTaxonomy({
    taxonomy,
    tenantId: "tenant-a",
    limit: 1,
    secret: tenantSecret,
  });
  assert(first.pagination.next_cursor);
  assert.throws(
    () => paginateBranchTaxonomy({
      taxonomy: { ...taxonomy, nodes: [...taxonomy.nodes, { node_id: "new", depth: 3 }] },
      tenantId: "tenant-a",
      cursor: first.pagination.next_cursor,
      limit: 1,
      secret: tenantSecret,
    }),
    /branch_taxonomy_cursor_invalid/,
  );
});

test("branch taxonomy pagination is bounded, stable, tenant-bound and tamper-evident", async () => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "branch-taxonomy-page-"));
  const service = createUniversalCoreService({
    storageRoot,
    mcpTenantGatewayKey: gatewayKey,
    tenantContextSigningSecret: tenantSecret,
  });
  const { server, url } = await listen(service.app);
  try {
    const legacy = await read(`${url}/v1/branches/taxonomy`);
    assert.equal(legacy.response.status, 200);
    assert.equal(legacy.body.pagination, undefined);
    assert.equal(legacy.body.taxonomy.nodes.length, legacy.body.taxonomy.node_count);
    assert.equal(legacy.body.taxonomy.synapses.length, legacy.body.taxonomy.synapse_count);

    const first = await read(`${url}/v1/branches/taxonomy?limit=37`);
    assert.equal(first.response.status, 200);
    assert.equal(first.body.tenant_id, "tenant-a");
    assert.equal(first.body.pagination.schema_version, "branch_taxonomy_page_v1");
    assert.match(first.body.pagination.taxonomy_digest, /^[a-f0-9]{64}$/);
    assert.equal(first.body.pagination.offset, 0);
    assert.equal(first.body.pagination.returned_items, 37);
    assert(first.body.pagination.next_cursor.startsWith("btc1_"));
    assert.equal(
      first.body.taxonomy.nodes.length + first.body.taxonomy.synapses.length,
      37,
    );
    assert(Buffer.byteLength(JSON.stringify(first.body), "utf8") < 128 * 1024);

    const repeated = await read(`${url}/v1/branches/taxonomy?limit=37`);
    assert.equal(repeated.body.pagination.taxonomy_digest, first.body.pagination.taxonomy_digest);
    assert.equal(repeated.body.pagination.next_cursor, first.body.pagination.next_cursor);
    assert.deepEqual(repeated.body.taxonomy, first.body.taxonomy);

    const second = await read(`${url}/v1/branches/taxonomy?limit=37&cursor=${encodeURIComponent(first.body.pagination.next_cursor)}`);
    assert.equal(second.response.status, 200);
    assert.equal(second.body.pagination.offset, 37);
    assert.equal(second.body.pagination.taxonomy_digest, first.body.pagination.taxonomy_digest);
    assert.equal(second.body.pagination.returned_items, 37);
    const firstIds = new Set(first.body.taxonomy.nodes.map((node) => node.node_id));
    assert(second.body.taxonomy.nodes.every((node) => !firstIds.has(node.node_id)));

    const token = first.body.pagination.next_cursor;
    const replacement = token.endsWith("A") ? "B" : "A";
    const tampered = await read(`${url}/v1/branches/taxonomy?limit=37&cursor=${encodeURIComponent(token.slice(0, -1) + replacement)}`);
    assert.equal(tampered.response.status, 400);
    assert.equal(tampered.body.error, "branch_taxonomy_cursor_invalid");

    const crossTenant = await read(
      `${url}/v1/branches/taxonomy?limit=37&cursor=${encodeURIComponent(token)}`,
      "tenant-b",
    );
    assert.equal(crossTenant.response.status, 400);
    assert.equal(crossTenant.body.error, "branch_taxonomy_cursor_invalid");

    const invalidLimit = await read(`${url}/v1/branches/taxonomy?limit=201`);
    assert.equal(invalidLimit.response.status, 400);
    assert.equal(invalidLimit.body.error, "branch_taxonomy_limit_invalid");

    const emptyCursor = await read(`${url}/v1/branches/taxonomy?cursor=`);
    assert.equal(emptyCursor.response.status, 400);
    assert.equal(emptyCursor.body.error, "branch_taxonomy_cursor_invalid");

    let traversalCursor = null;
    let traversed = 0;
    let expectedDigest = null;
    const nodeIds = new Set();
    let synapseCount = 0;
    do {
      const query = new URLSearchParams({ limit: "200" });
      if (traversalCursor) query.set("cursor", traversalCursor);
      const current = await read(`${url}/v1/branches/taxonomy?${query}`);
      assert.equal(current.response.status, 200);
      assert(Buffer.byteLength(JSON.stringify(current.body), "utf8") < 512 * 1024);
      expectedDigest ??= current.body.pagination.taxonomy_digest;
      assert.equal(current.body.pagination.taxonomy_digest, expectedDigest);
      traversed += current.body.pagination.returned_items;
      for (const node of current.body.taxonomy.nodes) {
        assert.equal(nodeIds.has(node.node_id), false);
        nodeIds.add(node.node_id);
      }
      for (const synapse of current.body.taxonomy.synapses) {
        assert.equal(typeof synapse.from_node_id, "string");
        assert.equal(typeof synapse.to_node_id, "string");
        synapseCount += 1;
      }
      traversalCursor = current.body.pagination.next_cursor;
      if (!traversalCursor) assert.equal(current.body.pagination.complete, true);
    } while (traversalCursor);
    assert.equal(traversed, first.body.pagination.total_items);
    assert.equal(nodeIds.size, legacy.body.taxonomy.node_count);
    assert.equal(synapseCount, legacy.body.taxonomy.synapse_count);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(storageRoot, { recursive: true, force: true });
  }
});
