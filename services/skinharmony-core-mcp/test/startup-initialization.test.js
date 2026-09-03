import assert from "node:assert/strict";
import test from "node:test";
import { initializeStoreAfter } from "../src/startup-initialization.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

test("dependent PostgreSQL initialization cannot overlap its prerequisite", async () => {
  const prerequisite = deferred();
  let calls = 0;
  const ready = initializeStoreAfter(prerequisite.promise, {
    initialize: async () => {
      calls += 1;
      return { ready: true };
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
  prerequisite.resolve({ ready: true });
  assert.deepEqual(await ready, { ready: true });
  assert.equal(calls, 1);
});

test("dependent PostgreSQL initialization fails closed with its prerequisite", async () => {
  const prerequisite = deferred();
  let calls = 0;
  const ready = initializeStoreAfter(prerequisite.promise, {
    initialize: async () => {
      calls += 1;
    },
  });
  prerequisite.reject(new Error("continuity_schema_failed"));
  await assert.rejects(ready, /continuity_schema_failed/);
  assert.equal(calls, 0);
});
