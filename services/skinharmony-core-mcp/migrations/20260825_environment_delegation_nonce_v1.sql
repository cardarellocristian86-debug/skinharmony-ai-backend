BEGIN;

-- A production-to-staging delegation is a single-use bearer envelope. The
-- primary key is the cross-replica replay barrier; DB clock decides whether a
-- nonce can still be claimed. Expired rows may be pruned later by a governed
-- maintenance job because the signed envelope itself is already unusable.
CREATE TABLE IF NOT EXISTS mcp_environment_delegation_nonces (
  nonce varchar(80) PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (nonce ~ '^[A-Za-z0-9_-]{16,80}$')
);

CREATE INDEX IF NOT EXISTS mcp_environment_delegation_nonces_expiry_idx
  ON mcp_environment_delegation_nonces (expires_at);

COMMIT;
