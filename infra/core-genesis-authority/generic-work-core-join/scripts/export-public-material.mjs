import crypto from "node:crypto";
import { GetPublicKeyCommand, KMSClient } from "@aws-sdk/client-kms";

const keyId = process.env.SIGNER_KMS_KEY_ARN;
const logicalKeyId = process.env.SIGNER_LOGICAL_KEY_ID;
if (!keyId || !logicalKeyId) throw new Error("SIGNER_KMS_KEY_ARN and SIGNER_LOGICAL_KEY_ID are required");

const result = await new KMSClient({}).send(new GetPublicKeyCommand({ KeyId: keyId }));
if (!result.PublicKey || !result.SigningAlgorithms?.includes("ED25519_SHA_512")) {
  throw new Error("KMS key is not an Ed25519 signing key");
}
const der = Buffer.from(result.PublicKey);
const publicKey = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("unexpected public key type");

process.stdout.write(`${JSON.stringify({
  schema_version: "generic_work_core_join_public_material_v1",
  key_id: logicalKeyId,
  algorithm: "Ed25519",
  public_key: publicKey.export({ type: "spki", format: "pem" }),
  public_key_fingerprint: crypto.createHash("sha256").update(der).digest("hex")
}, null, 2)}\n`);
