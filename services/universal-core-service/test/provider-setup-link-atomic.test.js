import assert from "node:assert/strict";
import test from "node:test";
import { createTenantProviderCredentialStore } from "../src/tenantProviderCredentialStore.js";
import { createTenantProviderSetupLinkStore } from "../src/tenantProviderSetupLinkStore.js";

function clone(value) {
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function createTransactionalPool() {
  const state = {
    link: null,
    credential: null,
    failFinalize: false,
    commits: 0,
    rollbacks: 0,
  };
  let snapshot = null;

  async function query(statement, values = []) {
    const sql = String(statement).replace(/\s+/g, " ").trim();
    if (sql === "BEGIN") {
      snapshot = { link: clone(state.link), credential: clone(state.credential) };
      return { rows: [] };
    }
    if (sql === "COMMIT") {
      snapshot = null;
      state.commits += 1;
      return { rows: [] };
    }
    if (sql === "ROLLBACK") {
      if (snapshot) {
        state.link = snapshot.link;
        state.credential = snapshot.credential;
      }
      snapshot = null;
      state.rollbacks += 1;
      return { rows: [] };
    }
    if (sql.startsWith("CREATE") || sql.startsWith("ALTER") || sql.startsWith("DELETE")) return { rows: [] };

    if (sql.startsWith("UPDATE governed_agent_provider_setup_links SET revoked_at")) {
      if (state.link && state.link.tenant_id === values[0] && !state.link.consumed_at && !state.link.revoked_at) {
        state.link.revoked_at = "2026-07-19T00:00:00.000Z";
      }
      return { rows: [] };
    }
    if (sql.startsWith("INSERT INTO governed_agent_provider_setup_links")) {
      state.link = {
        token_hash: values[0],
        tenant_id: values[1],
        expires_at: values[2],
        link_id: values[3],
        proof_hash: values[4],
        owner_subject_fingerprint: values[5],
        consumed_at: null,
        revoked_at: null,
        claim_id: null,
      };
      return { rows: [] };
    }
    if (sql.startsWith("SELECT link_id,tenant_id,owner_subject_fingerprint,expires_at FROM governed_agent_provider_setup_links")) {
      const active = state.link &&
        state.link.token_hash === values[0] &&
        state.link.proof_hash === values[1] &&
        !state.link.consumed_at &&
        !state.link.revoked_at &&
        !state.link.claim_id;
      return active
        ? { rows: [{
          link_id: state.link.link_id,
          tenant_id: state.link.tenant_id,
          owner_subject_fingerprint: state.link.owner_subject_fingerprint,
          expires_at: state.link.expires_at,
        }] }
        : { rows: [] };
    }
    if (sql.startsWith("INSERT INTO governed_agent_provider_credentials")) {
      state.credential = {
        tenant_id: values[0],
        ciphertext: values[1],
        iv: values[2],
        tag: values[3],
        key_hint: values[4],
      };
      return { rows: [{ provider: "openai", key_hint: state.credential.key_hint, updated_at: "2026-07-19T00:00:00.000Z" }] };
    }
    if (sql.startsWith("UPDATE governed_agent_provider_setup_links SET consumed_at=NOW()")) {
      const matches = state.link &&
        state.link.token_hash === values[0] &&
        state.link.proof_hash === values[1] &&
        state.link.link_id === values[2] &&
        !state.link.consumed_at &&
        !state.link.revoked_at;
      if (!matches || state.failFinalize) return { rows: [] };
      state.link.consumed_at = "2026-07-19T00:00:00.000Z";
      return { rows: [{
        link_id: state.link.link_id,
        tenant_id: state.link.tenant_id,
        owner_subject_fingerprint: state.link.owner_subject_fingerprint,
        expires_at: state.link.expires_at,
      }] };
    }
    throw new Error(`unexpected_query:${sql}`);
  }

  return {
    state,
    query,
    async connect() {
      return { query, release() {} };
    },
  };
}

function createStores(pool) {
  const connectionString = "postgres://governance:test@localhost:5432/nyra";
  return {
    credentials: createTenantProviderCredentialStore({
      connectionString,
      masterSecret: "x".repeat(32),
      pool,
    }),
    links: createTenantProviderSetupLinkStore({
      connectionString,
      pool,
      now: () => new Date("2026-07-19T00:00:00.000Z"),
    }),
  };
}

async function complete({ links, credentials, token, proof }) {
  return links.consumeAndPersist({
    token,
    proof,
    prepare: () => credentials.ensureInitialized(),
    persist: ({ tenant_id, client }) => credentials.saveOpenAiInTransaction({
      tenant_id,
      api_key: "sk-proj-atomic-12345678901234567890",
      client,
    }),
  });
}

test("provider setup persists the encrypted credential and consumes the proof in one transaction", async () => {
  const pool = createTransactionalPool();
  const { links, credentials } = createStores(pool);
  const issued = await links.issue({
    tenant_id: "tenant-a",
    owner_subject_fingerprint: `osf_${"a".repeat(64)}`,
  });

  const completed = await complete({ links, credentials, token: issued.token, proof: issued.proof });
  assert.equal(completed.tenant_id, "tenant-a");
  assert.equal(completed.credential.configured, true);
  assert.ok(pool.state.link.consumed_at);
  assert.equal(pool.state.credential.tenant_id, "tenant-a");
  assert.equal(pool.state.credential.ciphertext.includes("sk-proj-atomic"), false);
  assert.equal(await complete({ links, credentials, token: issued.token, proof: issued.proof }), null);
});

test("provider setup proof remains usable after an invalid key and is consumed by the valid retry", async () => {
  const pool = createTransactionalPool();
  const { links, credentials } = createStores(pool);
  const issued = await links.issue({
    tenant_id: "tenant-a",
    owner_subject_fingerprint: `osf_${"d".repeat(64)}`,
  });

  await assert.rejects(
    links.consumeAndPersist({
      token: issued.token,
      proof: issued.proof,
      prepare: () => credentials.ensureInitialized(),
      persist: ({ tenant_id, client }) => credentials.saveOpenAiInTransaction({
        tenant_id,
        api_key: "not-an-openai-key",
        client,
      }),
    }),
    /openai_api_key_format_invalid/,
  );
  assert.equal(pool.state.credential, null);
  assert.equal(pool.state.link.consumed_at, null);

  const completed = await complete({ links, credentials, token: issued.token, proof: issued.proof });
  assert.equal(completed.tenant_id, "tenant-a");
  assert.equal(completed.credential.configured, true);
  assert.ok(pool.state.link.consumed_at);
  assert.equal(await complete({ links, credentials, token: issued.token, proof: issued.proof }), null);
});

test("provider setup rolls back failed persistence or consumption and never writes for a revoked link", async () => {
  const pool = createTransactionalPool();
  const { links, credentials } = createStores(pool);
  const issued = await links.issue({
    tenant_id: "tenant-a",
    owner_subject_fingerprint: `osf_${"b".repeat(64)}`,
  });

  await assert.rejects(
    links.consumeAndPersist({
      token: issued.token,
      proof: issued.proof,
      prepare: () => credentials.ensureInitialized(),
      persist: ({ tenant_id, client }) => credentials.saveOpenAiInTransaction({
        tenant_id,
        api_key: "not-an-openai-key",
        client,
      }),
    }),
    /openai_api_key_format_invalid/,
  );
  assert.equal(pool.state.credential, null);
  assert.equal(pool.state.link.consumed_at, null);

  await assert.rejects(
    links.consumeAndPersist({
      token: issued.token,
      proof: issued.proof,
      prepare: () => credentials.ensureInitialized(),
      persist: async () => { throw new Error("simulated_vault_save_failure"); },
    }),
    /simulated_vault_save_failure/,
  );
  assert.equal(pool.state.credential, null);
  assert.equal(pool.state.link.consumed_at, null);

  const previousCredential = {
    tenant_id: "tenant-a",
    ciphertext: "preexisting-ciphertext",
    iv: "preexisting-iv",
    tag: "preexisting-tag",
    key_hint: "sk-…old1",
  };
  pool.state.credential = clone(previousCredential);
  pool.state.failFinalize = true;
  await assert.rejects(
    complete({ links, credentials, token: issued.token, proof: issued.proof }),
    /provider_setup_link_consume_failed/,
  );
  assert.deepEqual(pool.state.credential, previousCredential);
  assert.equal(pool.state.link.consumed_at, null);
  assert.ok(pool.state.rollbacks >= 3);

  pool.state.failFinalize = false;
  pool.state.link.revoked_at = "2026-07-19T00:00:00.000Z";
  assert.equal(await complete({ links, credentials, token: issued.token, proof: issued.proof }), null);
  assert.deepEqual(pool.state.credential, previousCredential);
  assert.equal(pool.state.link.consumed_at, null);
});
