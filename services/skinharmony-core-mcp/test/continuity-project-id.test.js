import test from "node:test";
import assert from "node:assert/strict";

import { continuityProjectId } from "../src/continuity-project-id.js";

test("continuity project id uses the repository basename", () => {
  assert.equal(
    continuityProjectId({ repository: "cardarellocristian86-debug/skinharmony-ai-backend" }),
    "skinharmony-ai-backend",
  );
});

test("continuity project id preserves an explicit project id", () => {
  assert.equal(
    continuityProjectId({
      project_id: "explicit-project",
      repository: "owner/repository-slug",
      target_system: "target-system",
    }),
    "explicit-project",
  );
});

test("continuity project id preserves target_system when repository is absent", () => {
  assert.equal(
    continuityProjectId({ target_system: "target-system" }),
    "target-system",
  );
});

test("continuity project id fails safe for hostile or invalid repositories", () => {
  for (const repository of [
    "../repository",
    "owner/../repository",
    "https://example.test/owner/repository",
    "owner/%2e%2e",
    "owner\\repository",
    { owner: "owner", repository: "repository" },
  ]) {
    assert.equal(
      continuityProjectId({ repository }),
      "skinharmony-ai-backend",
      `expected fail-safe project id for ${String(repository)}`,
    );
  }
});
