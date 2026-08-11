import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readBundle } from "../install-trust-key.mjs";

async function writeBundle(providerAttestationDigest) {
  const { publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ type: "spki", format: "der" });
  const fingerprint = crypto.createHash("sha256").update(spki).digest("hex");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bootstrap-trust-bundle-"));
  const filename = path.join(directory, "bundle.json");
  await fs.writeFile(filename, `${JSON.stringify({
    schema_version: "bootstrap_authority_trust_bundle_v1",
    tenant_id: "codexai",
    authority_key_id: `local-pin-p256:${fingerprint.slice(0, 32)}`,
    authority_provider: "local_pin",
    algorithm: "ECDSA_P256_SHA256_P1363",
    public_key_spki_base64: spki.toString("base64"),
    public_key_sha256: fingerprint,
    provider_attestation_digest: providerAttestationDigest,
    genesis_record_digest: "a".repeat(64),
    genesis_record: { ceremony: "external_local_pin" },
  })}\n`, "utf8");
  return { directory, filename };
}

test("offline local-PIN trust bundle is explicitly unattested", async (t) => {
  const fixture = await writeBundle(null);
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const { installRecord } = await readBundle(fixture.filename);
  assert.equal(installRecord.attestation_status, "UNATTESTED_LOCAL_SOFTWARE");
  assert.equal(installRecord.provider_attestation_digest, null);
});

test("offline local-PIN trust bundle rejects a forged provider attestation", async (t) => {
  const fixture = await writeBundle("b".repeat(64));
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  await assert.rejects(() => readBundle(fixture.filename), /bootstrap_trust_bundle_schema_invalid/);
});
