const CORE_ISSUER = "universal-core-staging";
const NYRA_ISSUER = "nyra-staging";

export const COLLABORATION_TRUST_PIN_FUNCTION_BODY = `DECLARE
  v_matches integer;
  v_total integer;
BEGIN
  IF p_core_kid !~ '^ed25519-sha256:[a-f0-9]{64}$'
     OR p_nyra_kid !~ '^ed25519-sha256:[a-f0-9]{64}$'
     OR p_core_kid = p_nyra_kid
     OR p_core_jwk_digest !~ '^[a-f0-9]{64}$'
     OR p_nyra_jwk_digest !~ '^[a-f0-9]{64}$'
     OR p_core_jwk_digest = p_nyra_jwk_digest
     OR p_target_commit !~ '^[a-f0-9]{40}$' THEN
    RAISE EXCEPTION 'collaboration_trust_anchor_invalid';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('skinharmony-mcp-collaboration-trust-v1', 0)
  );

  INSERT INTO mcp_collaboration_control.trusted_issuer_keys
    (authority,issuer,kid,jwk_digest,pinned_build_commit)
  VALUES
    ('core','${CORE_ISSUER}',p_core_kid,p_core_jwk_digest,p_target_commit),
    ('nyra','${NYRA_ISSUER}',p_nyra_kid,p_nyra_jwk_digest,p_target_commit)
  ON CONFLICT (authority) DO NOTHING;

  SELECT count(*)::integer INTO v_matches
  FROM mcp_collaboration_control.trusted_issuer_keys
  WHERE (authority='core' AND issuer='${CORE_ISSUER}' AND
         kid=p_core_kid AND jwk_digest=p_core_jwk_digest)
     OR (authority='nyra' AND issuer='${NYRA_ISSUER}' AND
         kid=p_nyra_kid AND jwk_digest=p_nyra_jwk_digest);

  SELECT count(*)::integer INTO v_total
  FROM mcp_collaboration_control.trusted_issuer_keys;

  IF v_matches <> 2 OR v_total <> 2 THEN
    RAISE EXCEPTION 'collaboration_trust_anchor_mismatch';
  END IF;
  RETURN true;
END`;

export function collaborationTrustPinSchemaSql() {
  return `CREATE TABLE IF NOT EXISTS mcp_collaboration_control.trusted_issuer_keys (
  authority varchar(16) PRIMARY KEY CHECK (authority IN ('core','nyra')),
  issuer varchar(120) NOT NULL UNIQUE,
  kid varchar(96) NOT NULL UNIQUE CHECK (kid ~ '^ed25519-sha256:[a-f0-9]{64}$'),
  jwk_digest char(64) NOT NULL UNIQUE CHECK (jwk_digest ~ '^[a-f0-9]{64}$'),
  pinned_build_commit char(40) NOT NULL CHECK (pinned_build_commit ~ '^[a-f0-9]{40}$'),
  pinned_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE mcp_collaboration_control.trusted_issuer_keys OWNER TO CURRENT_USER;
DROP TRIGGER IF EXISTS no_mutation_trusted_issuer_keys
  ON mcp_collaboration_control.trusted_issuer_keys;
CREATE TRIGGER no_mutation_trusted_issuer_keys
  BEFORE UPDATE OR DELETE OR TRUNCATE
  ON mcp_collaboration_control.trusted_issuer_keys
  FOR EACH STATEMENT EXECUTE FUNCTION public.mcp_reject_append_only_mutation();
CREATE OR REPLACE FUNCTION mcp_collaboration_control.pin_or_verify_issuer_pair(
  p_core_kid varchar,
  p_core_jwk_digest char(64),
  p_nyra_kid varchar,
  p_nyra_jwk_digest char(64),
  p_target_commit char(40)
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STRICT
SET search_path = pg_catalog, mcp_collaboration_control, pg_temp
AS $trust_pin$${COLLABORATION_TRUST_PIN_FUNCTION_BODY}$trust_pin$;
ALTER FUNCTION mcp_collaboration_control.pin_or_verify_issuer_pair(
  varchar,char,varchar,char,char
) OWNER TO CURRENT_USER;
REVOKE ALL ON TABLE mcp_collaboration_control.trusted_issuer_keys FROM PUBLIC;
REVOKE ALL ON FUNCTION mcp_collaboration_control.pin_or_verify_issuer_pair(
  varchar,char,varchar,char,char
) FROM PUBLIC;`;
}

function exactTrust(value, authority, issuer, targetCommit) {
  return Boolean(value) &&
    value.authority === authority &&
    value.issuer === issuer &&
    value.targetCommit === targetCommit &&
    value.kid === value.jwk?.kid &&
    /^ed25519-sha256:[a-f0-9]{64}$/.test(String(value.kid || "")) &&
    /^[a-f0-9]{64}$/.test(String(value.jwkDigest || ""));
}

export async function pinOrVerifyCollaborationIssuerTrust(
  queryable,
  trust,
  targetCommit,
) {
  const commit = String(targetCommit || "").toLowerCase();
  if (!queryable || typeof queryable.query !== "function" ||
      !/^[a-f0-9]{40}$/.test(commit) ||
      !exactTrust(trust?.core, "core", CORE_ISSUER, commit) ||
      !exactTrust(trust?.nyra, "nyra", NYRA_ISSUER, commit) ||
      trust.core.kid === trust.nyra.kid ||
      trust.core.jwkDigest === trust.nyra.jwkDigest) {
    throw new Error("collaboration_trust_pin_input_invalid");
  }
  try {
    const result = await queryable.query(
      `SELECT mcp_collaboration_control.pin_or_verify_issuer_pair(
         $1::varchar,$2::char(64),$3::varchar,$4::char(64),$5::char(40)
       ) AS verified`,
      [
        trust.core.kid,
        trust.core.jwkDigest,
        trust.nyra.kid,
        trust.nyra.jwkDigest,
        commit,
      ],
    );
    if (result.rowCount !== 1 || result.rows?.[0]?.verified !== true) {
      throw new Error("not_verified");
    }
    return Object.freeze({
      verified: true,
      core_kid: trust.core.kid,
      nyra_kid: trust.nyra.kid,
    });
  } catch {
    throw new Error("collaboration_trust_pin_failed");
  }
}

export const collaborationTrustPinContract = Object.freeze({
  authorities: Object.freeze({
    core: CORE_ISSUER,
    nyra: NYRA_ISSUER,
  }),
  function: "mcp_collaboration_control.pin_or_verify_issuer_pair",
});
