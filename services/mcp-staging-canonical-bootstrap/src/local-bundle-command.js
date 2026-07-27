import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CANONICAL_BOOTSTRAP_PATHS,
  createCanonicalBootstrapBundle,
} from "./index.js";

function fail(code) {
  throw new Error(code);
}

function exactArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 4 ||
      argv[0] !== "--workspace-root" || argv[2] !== "--target-commit") {
    fail("canonical_bootstrap_bundle_arguments_invalid");
  }
  const workspaceRoot = path.resolve(String(argv[1] || ""));
  const targetCommit = String(argv[3] || "").toLowerCase();
  if (!path.isAbsolute(workspaceRoot) || !/^[a-f0-9]{40}$/.test(targetCommit)) {
    fail("canonical_bootstrap_bundle_arguments_invalid");
  }
  return { workspaceRoot, targetCommit };
}

function reviewedDocument(workspaceRoot, canonicalPath) {
  const expectedRoot = path.join(workspaceRoot, "SHARED_MEMORY");
  const absolutePath = path.resolve(workspaceRoot, canonicalPath);
  if (absolutePath !== expectedRoot && !absolutePath.startsWith(`${expectedRoot}${path.sep}`)) {
    fail("canonical_bootstrap_bundle_path_invalid");
  }
  let realRoot;
  let realDocument;
  try {
    realRoot = fs.realpathSync(expectedRoot);
    realDocument = fs.realpathSync(absolutePath);
  } catch {
    fail("canonical_bootstrap_bundle_document_unavailable");
  }
  if (realDocument !== realRoot && !realDocument.startsWith(`${realRoot}${path.sep}`)) {
    fail("canonical_bootstrap_bundle_path_invalid");
  }
  const content = fs.readFileSync(realDocument, "utf8");
  const redactionCount = content.match(/\[(?:REDACTED|redacted)\]/g)?.length || 0;
  return {
    title: canonicalPath.split("/").at(-1),
    content,
    redaction_count: redactionCount,
    redaction_status: "reviewed_redacted",
  };
}

export function createLocalCanonicalBootstrapBundle({
  workspaceRoot,
  targetCommit,
  now = Date.now,
  randomBytes = crypto.randomBytes,
} = {}) {
  if (typeof now !== "function" || typeof randomBytes !== "function") {
    fail("canonical_bootstrap_bundle_runtime_invalid");
  }
  const timestamp = Number(now());
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    fail("canonical_bootstrap_bundle_runtime_invalid");
  }
  const suffix = randomBytes(18).toString("base64url");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(suffix)) {
    fail("canonical_bootstrap_bundle_runtime_invalid");
  }
  return createCanonicalBootstrapBundle({
    bootstrap_id: `mcpboot_${suffix}`,
    target_commit: String(targetCommit || "").toLowerCase(),
    created_at: new Date(timestamp).toISOString(),
    documents: CANONICAL_BOOTSTRAP_PATHS.map((canonicalPath) =>
      reviewedDocument(path.resolve(String(workspaceRoot || "")), canonicalPath)),
  });
}

export function main(argv = process.argv.slice(2)) {
  const { workspaceRoot, targetCommit } = exactArguments(argv);
  const bundle = createLocalCanonicalBootstrapBundle({ workspaceRoot, targetCommit });
  process.stdout.write(`${JSON.stringify(bundle)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch {
    process.stderr.write("canonical_bootstrap_bundle_failed\n");
    process.exitCode = 1;
  }
}

export const localCanonicalBootstrapBundleContract = Object.freeze({
  canonical_paths: CANONICAL_BOOTSTRAP_PATHS,
  output: "stdout_json_only",
  writes_local_files: false,
  contains_credentials: false,
});
