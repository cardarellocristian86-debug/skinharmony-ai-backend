import assert from "node:assert/strict";
import test from "node:test";
import {
  POSTGRES_MAJOR_VERSION_QUERY,
  createPostgresMajorVersionProbe,
} from "../postgres-major-version.js";

test("PostgreSQL major probe verifies major 16 or newer and exposes no connection data", async () => {
  for (const [serverVersionNum, expected] of [
    ["160012", { major: 16, verified: true }],
    ["150014", { major: 15, verified: false }],
    ["170003", { major: 17, verified: true }],
    ["180004", { major: 18, verified: true }],
  ]) {
    const statements = [];
    const probe = createPostgresMajorVersionProbe({
      query: async (statement) => {
        statements.push(statement);
        return { rows: [{ server_version_num: serverVersionNum }] };
      },
    });
    assert.deepEqual(await probe.check(), expected);
    assert.deepEqual(statements, [POSTGRES_MAJOR_VERSION_QUERY]);
    assert.equal(JSON.stringify(await probe.check()).includes("postgres://"), false);
  }
});

test("PostgreSQL major probe fails closed on query errors and briefly caches the result", async () => {
  let clock = 1_000;
  let calls = 0;
  const probe = createPostgresMajorVersionProbe({
    query: async () => {
      calls += 1;
      throw new Error("postgresql://user:secret@example.test/private");
    },
    cacheTtlMs: 5_000,
    now: () => clock,
  });

  assert.deepEqual(await probe.check(), { major: null, verified: false });
  assert.deepEqual(await probe.check(), { major: null, verified: false });
  assert.equal(calls, 1);
  clock += 5_001;
  assert.deepEqual(await probe.check(), { major: null, verified: false });
  assert.equal(calls, 2);
});
