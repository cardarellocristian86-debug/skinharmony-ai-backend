import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import pg from "pg";

import {
  ICF_EVENT_DIGEST_CONTRACT_V2,
  icfEventDigestV2,
  icfEventPayloadDigestV2,
} from "../src/icfEventDigest.js";
import { createIcfPostgresStore } from "../src/icfPostgresStore.js";

const DATABASE_URL = String(process.env.ENTITY360_DATABASE_URL
  || process.env.SOFTWARE_COGNITION_DATABASE_URL || "").trim();

function identifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

test("PostgreSQL 16 jsonb zeta/alpha ordering verifies under ICF canonical v2",
  { skip: DATABASE_URL ? false : "PostgreSQL 16 integration URL not configured" }, async () => {
    const admin = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
    const schema = `icf_digest_v2_${crypto.randomUUID().replaceAll("-", "")}`;
    let pool;
    try {
      assert.match((await admin.query("SHOW server_version")).rows[0].server_version, /^16\./u);
      await admin.query(`CREATE SCHEMA ${identifier(schema)}`);
      pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2,
        options: `-c search_path=${schema}` });
      const store = createIcfPostgresStore({ pool });
      await store.initialize();
      const storeHealth = store.health();
      assert.equal(storeHealth.ready, true);
      assert.equal(storeHealth.state, "ready");
      assert.equal(storeHealth.migration.migration_id, "20260825_002_icf_event_digest_v2");
      assert.equal(storeHealth.migration.application_state, "COMPLETED");
      assert.equal(storeHealth.migration.checkpoint, "READBACK_VERIFIED");
      const migrationRow = (await pool.query(`SELECT application_state,checkpoint,sql_digest
        FROM core_schema_migrations WHERE migration_id=$1`,
      ["20260825_002_icf_event_digest_v2"])).rows[0];
      assert.equal(migrationRow.application_state, "COMPLETED");
      assert.equal(migrationRow.checkpoint, "READBACK_VERIFIED");
      assert.match(migrationRow.sql_digest, /^[a-f0-9]{64}$/u);
      const payload = { zeta: { zeta: "last", alpha: "first" },
        alpha: [{ zeta: 2, alpha: 1 }, "BOUND"] };
      const written = await store.appendEvent({ tenantId: "tenant-a", workId: "work-a",
        eventType: "STATE_BOUND", payload });
      const row = (await pool.query(`SELECT tenant_id,work_id,seq,event_type,payload,
        previous_digest,digest,digest_contract,canonicalization_version,digest_algorithm,
        payload_digest,previous_digest_contract FROM core_icf_event
        WHERE tenant_id=$1 AND work_id=$2`, ["tenant-a", "work-a"])).rows[0];
      assert.deepEqual(row.payload, { alpha: [{ alpha: 1, zeta: 2 }, "BOUND"],
        zeta: { alpha: "first", zeta: "last" } });
      assert.equal(row.digest_contract, ICF_EVENT_DIGEST_CONTRACT_V2);
      assert.equal(row.payload_digest, icfEventPayloadDigestV2(row.payload));
      assert.equal(row.digest, icfEventDigestV2({ tenantId: row.tenant_id,
        workId: row.work_id, seq: Number(row.seq), eventType: row.event_type,
        payload: row.payload, previous: row.previous_digest,
        previousDigestContract: row.previous_digest_contract }));
      assert.equal(row.digest, written.digest);

      await pool.query(`ALTER TABLE core_icf_event
        DROP CONSTRAINT core_icf_event_digest_contract_v2_ck,
        ADD CONSTRAINT core_icf_event_digest_contract_v2_ck CHECK (
          true OR (
            digest_contract IS NULL
            OR (digest_contract='nyra.icf.event-digest/canonical-json-v2'
              AND canonicalization_version='nyra.icf.canonical-json/2.0'
              AND digest_algorithm='sha256'
              AND payload_digest ~ '^[a-f0-9]{64}$')
        ))`);
      const tamperedStore = createIcfPostgresStore({ pool });
      await assert.rejects(tamperedStore.initialize(), (error) => {
        assert.equal(error.code, "icf_event_digest_v2_schema_manifest_mismatch");
        return true;
      });
      assert.equal(tamperedStore.health().ready, false);
      assert.equal(tamperedStore.health().state, "failed");
    } finally {
      if (pool) await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${identifier(schema)} CASCADE`);
      await admin.end();
    }
  });
