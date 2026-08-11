import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { bootstrapReleaseExceptionCanonicalJson } from "../../../../services/universal-core-service/src/bootstrapReleaseException.js";
import { readBundle } from "../install-trust-key.mjs";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function trustBundle(providerAttestationDigest) {
  const { publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ format: "der", type: "spki" });
  const publicKeySha256 = sha256(spki);
  const genesisRecord = {
    ceremony: "external_local_pin",
    custody_class: "owner_local_encrypted"
  };

  return {
    schema_version: "bootstrap_authority_trust_bundle_v1",
    tenant_id: "codexai",
    authority_key_id: `local-pin-p256:${publicKeySha256.slice(0, 32)}`,
    authority_provider: "local_pin",
    algorithm: "ECDSA_P256_SHA256_P1363",
    public_key_spki_base64: spki.toString("base64"),
    public_key_sha256: publicKeySha256,
    provider_attestation_digest: providerAttestationDigest,
    genesis_record: genesisRecord,
    genesis_record_digest: sha256(bootstrapReleaseExceptionCanonicalJson(genesisRecord))
  };
}

async function validateBundle(bundle) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nyra-local-pin-test-"));
  const filename = path.join(directory, "public-trust-bundle.json");
  await fs.writeFile(filename, JSON.stringify(bundle));

  try {
    return await readBundle(filename);
  } catch (error) {
    return error;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("local PIN trust bundles require an explicit null provider attestation", async () => {
  const validResult = await validateBundle(trustBundle(null));
  assert.equal(validResult.installRecord.provider_attestation_digest, null);

  const invalidResult = await validateBundle(trustBundle("a".repeat(64)));
  assert.match(invalidResult.message, /bootstrap_trust_bundle_schema_invalid/);
});
