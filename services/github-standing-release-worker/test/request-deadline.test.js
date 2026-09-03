import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createWorkerRequestDeadline } from "../src/requestDeadline.js";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function envValue(blueprint, name) {
  const match = blueprint.match(new RegExp(
    `- key: ${name}\\n\\s+value: ["']?(\\d+)["']?`,
    "u",
  ));
  return match ? Number(match[1]) : null;
}

test("a request deadline returns only the smaller residual per-fetch budget", () => {
  let now = 1_000;
  const deadline = createWorkerRequestDeadline({ timeout_ms: 18_000, now: () => now });
  assert.equal(deadline.remainingTimeoutMs(8_000), 8_000);
  now += 12_500;
  assert.equal(deadline.remainingTimeoutMs(8_000), 5_500);
  now += 5_500;
  assert.throws(
    () => deadline.remainingTimeoutMs(8_000),
    (error) => error.code === "github_worker_request_deadline_exceeded",
  );
  now -= 10_000;
  assert.throws(
    () => deadline.remainingTimeoutMs(8_000),
    (error) => error.code === "github_worker_request_deadline_exceeded",
  );
});

test("the deployed worker deadline remains strictly below its Core caller timeout", () => {
  const worker = fs.readFileSync(
    path.join(REPOSITORY_ROOT, "render-github-standing-release-worker.yaml"),
    "utf8",
  );
  const core = fs.readFileSync(path.join(REPOSITORY_ROOT, "render-core-mcp.yaml"), "utf8");
  const workerDeadline = envValue(worker, "GITHUB_WORKER_REQUEST_DEADLINE_MS");
  const coreTimeout = envValue(core, "GITHUB_STANDING_RELEASE_WORKER_REQUEST_TIMEOUT_MS");
  assert.equal(workerDeadline, 18_000);
  assert.equal(coreTimeout, 20_000);
  assert(workerDeadline < coreTimeout);
});
