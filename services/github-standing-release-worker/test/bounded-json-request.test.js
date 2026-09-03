import assert from "node:assert/strict";
import test from "node:test";

import { boundedJsonRequest } from "../../shared/bounded-json-request.js";

test("bounded JSON transport returns one successful response without retry", async () => {
  const calls = [];
  const result = await boundedJsonRequest("https://worker.test/result", {
    method: "POST",
    body: JSON.stringify({ request: true }),
  }, {
    timeoutMs: 100,
    maxResponseBytes: 1_024,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true, result: "bounded" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.payload, { ok: true, result: "bounded" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.signal.aborted, false);
  assert.equal(calls[0].init.redirect, "error");
});

test("bounded JSON transport aborts a fetch that never resolves", async () => {
  let observedSignal = null;
  let calls = 0;
  await assert.rejects(boundedJsonRequest("https://worker.test/never", {}, {
    timeoutMs: 10,
    maxResponseBytes: 1_024,
    fetchImpl: async (_url, init) => {
      calls += 1;
      observedSignal = init.signal;
      return new Promise(() => {});
    },
    errorCodes: { timeout: "test_request_timeout" },
  }), (error) => error.code === "test_request_timeout" && error.status === 504);

  assert.equal(calls, 1);
  assert.equal(observedSignal?.aborted, true);
});

test("bounded JSON transport cancels an oversized streamed response", async () => {
  let calls = 0;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ payload: "x".repeat(256) })));
      controller.close();
    },
  });
  await assert.rejects(boundedJsonRequest("https://worker.test/oversized", {}, {
    timeoutMs: 100,
    maxResponseBytes: 64,
    fetchImpl: async () => {
      calls += 1;
      return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
    },
    errorCodes: { too_large: "test_response_too_large" },
  }), (error) => error.code === "test_response_too_large" && error.status === 502);

  assert.equal(calls, 1);
});
