import { pathToFileURL } from "node:url";
import { executeCanonicalBootstrapImport } from "./canonical-bootstrap-import.js";

const MAX_STDIN_BYTES = 2 * 1024 * 1024;

export async function readCanonicalBootstrapBundle(input = process.stdin) {
  const chunks = [];
  let length = 0;
  for await (const value of input) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    length += chunk.length;
    if (length > MAX_STDIN_BYTES) throw new Error("canonical_bootstrap_stdin_too_large");
    chunks.push(chunk);
  }
  if (length === 0) throw new Error("canonical_bootstrap_stdin_required");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("canonical_bootstrap_stdin_invalid");
  }
}

export async function main() {
  const bundle = await readCanonicalBootstrapBundle();
  const result = await executeCanonicalBootstrapImport({ bundle });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write("canonical_bootstrap_import_failed\n");
    process.exitCode = 1;
  });
}

export const canonicalBootstrapCommandContract = Object.freeze({
  input: "stdin_json_only",
  max_stdin_bytes: MAX_STDIN_BYTES,
  provider_transfer: "render_native_ssh",
  secrets_in_input: false,
  output: "sanitized_result_only",
});
