import assert from "node:assert/strict";
import test from "node:test";
import {
  COLLABORATION_TRUST_PIN_FUNCTION_BODY,
  collaborationTrustPinSchemaSql,
  pinOrVerifyCollaborationIssuerTrust,
} from "../src/collaboration-trust-pins.js";

const COMMIT = "a".repeat(40);

function trust() {
  const coreKid = `ed25519-sha256:${"1".repeat(64)}`;
  const nyraKid = `ed25519-sha256:${"2".repeat(64)}`;
  return {
    core: {
      authority: "core",
      issuer: "universal-core-staging",
      kid: coreKid,
      jwk: { kid: coreKid },
      jwkDigest: "3".repeat(64),
      targetCommit: COMMIT,
    },
    nyra: {
      authority: "nyra",
      issuer: "nyra-staging",
      kid: nyraKid,
      jwk: { kid: nyraKid },
      jwkDigest: "4".repeat(64),
      targetCommit: COMMIT,
    },
  };
}

test("trust pin DDL is append-only, security-definer and fixes both issuer identities", () => {
  const sql = collaborationTrustPinSchemaSql();
  assert.match(sql, /trusted_issuer_keys/);
  assert.match(sql, /BEFORE UPDATE OR DELETE OR TRUNCATE/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /STRICT/);
  assert.match(sql, /SET search_path = pg_catalog, mcp_collaboration_control, pg_temp/);
  assert.match(sql, /REVOKE ALL ON TABLE mcp_collaboration_control\.trusted_issuer_keys FROM PUBLIC/);
  assert.match(sql, /REVOKE ALL ON FUNCTION mcp_collaboration_control\.pin_or_verify_issuer_pair/);
  assert.match(COLLABORATION_TRUST_PIN_FUNCTION_BODY, /universal-core-staging/);
  assert.match(COLLABORATION_TRUST_PIN_FUNCTION_BODY, /nyra-staging/);
  assert.match(COLLABORATION_TRUST_PIN_FUNCTION_BODY, /v_matches <> 2 OR v_total <> 2/);
  assert.match(COLLABORATION_TRUST_PIN_FUNCTION_BODY, /ON CONFLICT \(authority\) DO NOTHING/);
});

test("runtime pins or verifies both public fingerprints in one database statement", async () => {
  const calls = [];
  const result = await pinOrVerifyCollaborationIssuerTrust({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1, rows: [{ verified: true }] };
    },
  }, trust(), COMMIT);
  assert.equal(result.verified, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /pin_or_verify_issuer_pair/);
  assert.deepEqual(calls[0].params, [
    `ed25519-sha256:${"1".repeat(64)}`,
    "3".repeat(64),
    `ed25519-sha256:${"2".repeat(64)}`,
    "4".repeat(64),
    COMMIT,
  ]);
  assert.equal(JSON.stringify(calls).includes('"d"'), false);
});

test("trust pin fails closed on drift or database rejection without leaking details", async () => {
  const invalid = trust();
  invalid.nyra.kid = invalid.core.kid;
  invalid.nyra.jwk.kid = invalid.core.kid;
  await assert.rejects(
    pinOrVerifyCollaborationIssuerTrust({ query: async () => ({}) }, invalid, COMMIT),
    /collaboration_trust_pin_input_invalid/,
  );

  const marker = "private-database-detail";
  await assert.rejects(
    pinOrVerifyCollaborationIssuerTrust({
      async query() { throw new Error(marker); },
    }, trust(), COMMIT),
    (error) => error.message === "collaboration_trust_pin_failed" &&
      !error.message.includes(marker),
  );
});
