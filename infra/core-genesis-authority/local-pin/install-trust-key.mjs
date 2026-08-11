#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { createPostgresBootstrapAuthorityStore } from "../../../services/universal-core-service/src/bootstrapAuthorityPostgresStore.js";
import { bootstrapReleaseExceptionCanonicalJson } from "../../../services/universal-core-service/src/bootstrapReleaseException.js";

const requireFromUniversalCore = createRequire(
  new URL("../../../services/universal-core-service/package.json", import.meta.url),
);
const { Pool } = requireFromUniversalCore("pg");

const TRUST_BUNDLE_SCHEMA_VERSION = "bootstrap_authority_trust_bundle_v1";
const INSTALL_RECEIPT_SCHEMA_VERSION = "bootstrap_trust_key_install_receipt_v1";
const MAX_BUNDLE_BYTES = 128 * 1024;
const BUNDLE_FIELDS = Object.freeze([
  "algorithm",
  "authority_key_id",
  "authority_provider",
  "genesis_record",
  "genesis_record_digest",
  "provider_attestation_digest",
  "public_key_sha256",
  "public_key_spki_base64",
  "schema_version",
  "tenant_id",
]);
const FORBIDDEN_FIELD = /(^|_)(?:private(?:_key)?|secret|password|passphrase|credential|credentials|token|seed|mnemonic|hmac|mac|shared_key|symmetric_key|api_key|access_key|client_secret)(?:_|$)/i;
const SHA256 = /^[a-f0-9]{64}$/;
const TENANT = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;
const KEY_ID = /^local-pin-p256:[a-f0-9]{32}$/;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function fail(code) {
  throw new Error(code);
}

function plain(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value, expected, code) {
  if (!plain(value)) fail(code);
  const fields = Object.keys(value).sort();
  const required = [...expected].sort();
  if (fields.length !== required.length || fields.some((field, index) => field !== required[index])) fail(code);
}

function assertPublicData(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) {
    if (seen.has(value)) fail("bootstrap_trust_bundle_public_data_invalid");
    seen.add(value);
    for (const entry of value) assertPublicData(entry, seen);
    seen.delete(value);
    return;
  }
  if (!plain(value) || seen.has(value) || Object.getOwnPropertySymbols(value).length) {
    fail("bootstrap_trust_bundle_public_data_invalid");
  }
  seen.add(value);
  for (const [field, entry] of Object.entries(value)) {
    if (FORBIDDEN_FIELD.test(field)) fail("bootstrap_trust_bundle_private_material_forbidden");
    assertPublicData(entry, seen);
  }
  seen.delete(value);
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256Canonical(value) {
  return crypto.createHash("sha256")
    .update(bootstrapReleaseExceptionCanonicalJson(value), "utf8")
    .digest("hex");
}

async function readBundle(filename) {
  if (typeof filename !== "string" || filename.length === 0) fail("bootstrap_trust_bundle_path_required");
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size < 2 || stat.size > MAX_BUNDLE_BYTES) {
    fail("bootstrap_trust_bundle_file_invalid");
  }
  let bundle;
  try {
    bundle = JSON.parse(await fs.readFile(filename, "utf8"));
  } catch {
    fail("bootstrap_trust_bundle_json_invalid");
  }
  exactFields(bundle, BUNDLE_FIELDS, "bootstrap_trust_bundle_schema_invalid");
  assertPublicData(bundle);
  if (bundle.schema_version !== TRUST_BUNDLE_SCHEMA_VERSION ||
      bundle.authority_provider !== "local_pin" ||
      bundle.algorithm !== "ECDSA_P256_SHA256_P1363" ||
      typeof bundle.tenant_id !== "string" || !TENANT.test(bundle.tenant_id) ||
      typeof bundle.authority_key_id !== "string" || !KEY_ID.test(bundle.authority_key_id) ||
      typeof bundle.public_key_sha256 !== "string" || !SHA256.test(bundle.public_key_sha256) ||
      bundle.provider_attestation_digest !== null ||
      typeof bundle.genesis_record_digest !== "string" || !SHA256.test(bundle.genesis_record_digest) ||
      !plain(bundle.genesis_record) ||
      typeof bundle.public_key_spki_base64 !== "string" || !CANONICAL_BASE64.test(bundle.public_key_spki_base64)) {
    fail("bootstrap_trust_bundle_schema_invalid");
  }

  const publicKeySpki = Buffer.from(bundle.public_key_spki_base64, "base64");
  const fingerprint = sha256Bytes(publicKeySpki);
  if (publicKeySpki.length < 32 || publicKeySpki.length > 4096 ||
      publicKeySpki.toString("base64") !== bundle.public_key_spki_base64 ||
      fingerprint !== bundle.public_key_sha256 ||
      bundle.authority_key_id !== `local-pin-p256:${fingerprint.slice(0, 32)}`) {
    fail("bootstrap_trust_bundle_fingerprint_mismatch");
  }
  try {
    const key = crypto.createPublicKey({ key: publicKeySpki, format: "der", type: "spki" });
    const normalized = key.export({ format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
        !Buffer.from(normalized).equals(publicKeySpki)) {
      fail("bootstrap_trust_bundle_public_key_invalid");
    }
  } catch (error) {
    if (error?.message === "bootstrap_trust_bundle_public_key_invalid") throw error;
    fail("bootstrap_trust_bundle_public_key_invalid");
  }

  return Object.freeze({
    bundle,
    installRecord: Object.freeze({
      tenant_id: bundle.tenant_id,
      authority_key_id: bundle.authority_key_id,
      authority_provider: bundle.authority_provider,
      algorithm: bundle.algorithm,
      public_key_spki_der: publicKeySpki,
      public_key_sha256: fingerprint,
      trust_bundle_digest: sha256Canonical(bundle),
      provider_attestation_digest: bundle.provider_attestation_digest,
      genesis_record_digest: bundle.genesis_record_digest,
      genesis_record: bundle.genesis_record,
    }),
  });
}

function assertNoDifferentActiveKey(rows, record) {
  for (const row of rows) {
    if (row.authority_key_id !== record.authority_key_id) {
      fail("bootstrap_trust_key_different_active_key_exists");
    }
    if (row.public_key_sha256 !== record.public_key_sha256 ||
        row.trust_bundle_digest !== record.trust_bundle_digest ||
        row.authority_provider !== record.authority_provider ||
        row.algorithm !== record.algorithm) {
      fail("bootstrap_trust_key_active_fingerprint_mismatch");
    }
  }
}

async function main() {
  if (process.argv.length !== 3) fail("usage:node_install-trust-key.mjs_public-trust-bundle.json");
  const databaseUrl = process.env.GOVERNED_AGENT_DATABASE_URL;
  if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
    fail("governed_agent_database_url_required");
  }
  const { installRecord } = await readBundle(process.argv[2]);
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const store = createPostgresBootstrapAuthorityStore({ pool });
  let lockClient;
  try {
    await store.initialize();
    lockClient = await pool.connect();
    await lockClient.query(
      "SELECT pg_advisory_lock(hashtextextended('bootstrap_trust_key_install_v1' || E'\\x1f' || $1, 0))",
      [installRecord.tenant_id],
    );
    const active = await lockClient.query(
      "SELECT k.authority_key_id,k.authority_provider,k.algorithm,k.public_key_sha256,k.trust_bundle_digest " +
      "FROM core_bootstrap_trust_keys k JOIN core_bootstrap_trust_key_state s USING (tenant_id,authority_key_id) " +
      "WHERE k.tenant_id=$1 AND s.status='ACTIVE' FOR UPDATE OF k,s",
      [installRecord.tenant_id],
    );
    assertNoDifferentActiveKey(active.rows, installRecord);

    const installed = await store.installTrustKey(installRecord);
    const receipt = Object.freeze({
      schema_version: INSTALL_RECEIPT_SCHEMA_VERSION,
      tenant_id: installRecord.tenant_id,
      authority_key_id: installRecord.authority_key_id,
      authority_provider: installRecord.authority_provider,
      algorithm: installRecord.algorithm,
      status: installed.status,
      public_key_sha256: installRecord.public_key_sha256,
      trust_bundle_digest: installRecord.trust_bundle_digest,
      provider_attestation_digest: installRecord.provider_attestation_digest,
      genesis_record_digest: installRecord.genesis_record_digest,
      installed_at: installed.installed_at instanceof Date
        ? installed.installed_at.toISOString()
        : String(installed.installed_at),
      ledger_event_id: installed.event?.event_id ?? null,
      ledger_event_hash: installed.event?.event_hash ?? null,
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      receipt,
      receipt_digest: sha256Canonical(receipt),
    }, null, 2)}\n`);
  } finally {
    if (lockClient) {
      await lockClient.query(
        "SELECT pg_advisory_unlock(hashtextextended('bootstrap_trust_key_install_v1' || E'\\x1f' || $1, 0))",
        [installRecord.tenant_id],
      ).catch(() => {});
      lockClient.release();
    }
    await pool.end().catch(() => {});
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || "bootstrap_trust_key_install_failed")}\n`);
    process.exitCode = 1;
  });
}

export { readBundle };
