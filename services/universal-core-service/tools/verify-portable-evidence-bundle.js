#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

import { verifyPortableVerificationBundle } from "../src/verificationEvidenceContract.js";

function usage() {
  return "usage: node tools/verify-portable-evidence-bundle.js <bundle.json> <trusted-public-key.pem> <valid-at-rfc3339>";
}

try {
  const [bundlePath, publicKeyPath, validAt] = process.argv.slice(2);
  if (!bundlePath || !publicKeyPath || !validAt) throw new Error(usage());
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const publicKey = fs.readFileSync(publicKeyPath, "utf8");
  const result = verifyPortableVerificationBundle(bundle, {
    trusted_public_keys: [{ key_id: bundle?.trust_anchor?.key_id, public_key: publicKey }],
    valid_at: validAt,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error?.message || "portable_bundle_verification_failed"}\n`);
  process.exitCode = 1;
}
