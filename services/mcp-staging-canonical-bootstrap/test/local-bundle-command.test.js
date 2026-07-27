import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CANONICAL_BOOTSTRAP_PATHS,
  canonicalBootstrapBundleDigest,
} from "../src/index.js";
import {
  createLocalCanonicalBootstrapBundle,
  localCanonicalBootstrapBundleContract,
} from "../src/local-bundle-command.js";

const COMMIT = "a".repeat(40);
const NOW = Date.parse("2026-07-23T15:00:00.000Z");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-local-bundle-"));
  for (const canonicalPath of CANONICAL_BOOTSTRAP_PATHS) {
    const absolute = path.join(root, canonicalPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    let content = "# Reviewed canonical document\n";
    if (canonicalPath === "SHARED_MEMORY/STATE.json") {
      content = JSON.stringify({
        tenant: "codexai",
        active_task_count: 0,
        active_lock_count: 0,
      });
    } else if (canonicalPath === "SHARED_MEMORY/TASKS.json") {
      content = JSON.stringify({ tenant: "codexai", count: 0, tasks: [] });
    } else if (canonicalPath === "SHARED_MEMORY/LOCKS.json") {
      content = JSON.stringify({ tenant: "codexai", count: 0, locks: [] });
    } else if (canonicalPath === "SHARED_MEMORY/ARTIFACTS.json") {
      content = JSON.stringify({ tenant: "codexai", count: 0, artifacts: [] });
    }
    fs.writeFileSync(absolute, content, "utf8");
  }
  return root;
}

test("streams a deterministic validated bundle without writing a local artifact", () => {
  const root = fixture();
  const before = fs.readdirSync(root, { recursive: true }).sort();
  const options = {
    workspaceRoot: root,
    targetCommit: COMMIT,
    now: () => NOW,
    randomBytes: () => Buffer.alloc(18, 0x61),
  };
  const first = createLocalCanonicalBootstrapBundle(options);
  const second = createLocalCanonicalBootstrapBundle(options);
  assert.equal(canonicalBootstrapBundleDigest(first), canonicalBootstrapBundleDigest(second));
  assert.equal(first.target.commit, COMMIT);
  assert.deepEqual(first.documents.map(({ path: documentPath }) => documentPath), CANONICAL_BOOTSTRAP_PATHS);
  assert.deepEqual(fs.readdirSync(root, { recursive: true }).sort(), before);
  assert.equal(localCanonicalBootstrapBundleContract.output, "stdout_json_only");
  assert.equal(localCanonicalBootstrapBundleContract.writes_local_files, false);
});

test("rejects symlink escape and credential material before stdout transfer", () => {
  const root = fixture();
  const indexPath = path.join(root, "SHARED_MEMORY", "INDEX.md");
  const outside = path.join(os.tmpdir(), `canonical-outside-${Date.now()}.md`);
  fs.writeFileSync(outside, "# Outside", "utf8");
  fs.unlinkSync(indexPath);
  fs.symlinkSync(outside, indexPath);
  assert.throws(
    () => createLocalCanonicalBootstrapBundle({
      workspaceRoot: root,
      targetCommit: COMMIT,
      now: () => NOW,
      randomBytes: () => Buffer.alloc(18, 0x61),
    }),
    /canonical_bootstrap_bundle_path_invalid/,
  );

  const safeRoot = fixture();
  fs.writeFileSync(
    path.join(safeRoot, "SHARED_MEMORY", "INDEX.md"),
    "DATABASE_URL=postgres://runtime:do-not-store@example.invalid/db",
    "utf8",
  );
  assert.throws(
    () => createLocalCanonicalBootstrapBundle({
      workspaceRoot: safeRoot,
      targetCommit: COMMIT,
      now: () => NOW,
      randomBytes: () => Buffer.alloc(18, 0x61),
    }),
    /canonical_bootstrap_credential_material_rejected/,
  );
});
