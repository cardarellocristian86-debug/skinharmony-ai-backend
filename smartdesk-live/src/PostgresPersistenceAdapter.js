const fs = require("fs");
const { AsyncLocalStorage } = require("node:async_hooks");
const { atomicWriteJson } = require("./JsonFileRepository");

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

class PostgresPersistenceAdapter {
  constructor(databaseUrl) {
    this.databaseUrl = databaseUrl;
    this.writeChains = new Map();
    this.writeTracking = new AsyncLocalStorage();
    this.pool = null;
    this.pendingWrites = 0;
    this.failedCollections = new Set();
    this.lastWriteAt = null;
    this.lastFailureAt = null;
  }

  createPool() {
    if (this.pool) return this.pool;
    let Pool;
    try {
      ({ Pool } = require("pg"));
    } catch (error) {
      throw new Error("Dipendenza 'pg' non installata. Esegui npm install nel servizio render-smartdesk-live.");
    }
    this.pool = new Pool({
      connectionString: this.databaseUrl,
      ssl: this.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false }
    });
    return this.pool;
  }

  async init(collections) {
    if (!this.databaseUrl) return;
    const pool = this.createPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS smartdesk_collections (
        name TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const collection of collections) {
      await this.bootstrapCollection(collection);
    }
  }

  ensureLocalFile(filePath, defaultValue) {
    if (!fs.existsSync(filePath)) {
      atomicWriteJson(filePath, defaultValue);
    }
  }

  readLocalPayload(filePath, defaultValue) {
    this.ensureLocalFile(filePath, defaultValue);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  writeLocalPayload(filePath, payload) {
    atomicWriteJson(filePath, payload);
  }

  async bootstrapCollection({ name, filePath, defaultValue }) {
    const pool = this.createPool();
    const localPayload = this.readLocalPayload(filePath, defaultValue);
    const result = await pool.query(
      "SELECT payload FROM smartdesk_collections WHERE name = $1 LIMIT 1",
      [name]
    );

    if (result.rows[0]) {
      this.writeLocalPayload(filePath, result.rows[0].payload);
      return;
    }

    await pool.query(
      `INSERT INTO smartdesk_collections (name, payload, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (name) DO NOTHING`,
      [name, JSON.stringify(localPayload)]
    );
  }

  enqueueWrite(name, payload) {
    if (!this.databaseUrl) {
      return Promise.resolve({
        ok: true,
        collection: name,
        skipped: true
      });
    }

    const serializedPayload = JSON.stringify(payload);
    const currentChain = this.writeChains.get(name) || Promise.resolve();
    this.pendingWrites += 1;
    const operation = currentChain
      .catch(() => undefined)
      .then(async () => {
        const pool = this.createPool();
        await pool.query(
          `INSERT INTO smartdesk_collections (name, payload, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (name)
           DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
          [name, serializedPayload]
        );
      });

    const outcome = operation.then(
      () => {
        this.failedCollections.delete(name);
        this.lastWriteAt = new Date().toISOString();
        return {
          ok: true,
          collection: name,
          skipped: false
        };
      },
      () => {
        this.failedCollections.add(name);
        this.lastFailureAt = new Date().toISOString();
        return {
          ok: false,
          collection: name,
          code: "persistence_write_failed"
        };
      }
    ).then((result) => {
      this.pendingWrites = Math.max(0, this.pendingWrites - 1);
      return result;
    });

    const serializedChain = outcome.then(() => undefined);
    this.writeChains.set(name, serializedChain);
    void serializedChain.then(() => {
      if (this.writeChains.get(name) === serializedChain) {
        this.writeChains.delete(name);
      }
    });

    const context = this.writeTracking.getStore();
    if (context) {
      context.outcomes.push(outcome);
    } else {
      void outcome.then((result) => {
        if (!result.ok) {
          console.error(`[SmartDesk][DB] Sync fallita per ${name}: persistence_write_failed`);
        }
      });
    }

    return outcome;
  }

  runWithWriteTracking(callback) {
    const context = {
      outcomes: [],
      flushPromise: null
    };
    return this.writeTracking.run(context, () => callback(context));
  }

  flushTrackedWrites(context = this.writeTracking.getStore()) {
    if (!context) return Promise.resolve([]);
    if (context.flushPromise) return context.flushPromise;

    context.flushPromise = (async () => {
      const results = [];
      let cursor = 0;

      while (cursor < context.outcomes.length) {
        const batch = context.outcomes.slice(cursor);
        cursor += batch.length;
        results.push(...await Promise.all(batch));
      }

      const failures = results.filter((result) => !result.ok);
      if (failures.length) {
        const error = new Error("Persistenza dati non confermata.");
        error.code = "persistence_sync_failed";
        error.failedCollections = failures.map((result) => result.collection);
        throw error;
      }

      return results;
    })();

    return context.flushPromise;
  }

  getPersistenceStatus() {
    return {
      configured: Boolean(this.databaseUrl),
      healthy: this.failedCollections.size === 0,
      pendingWrites: this.pendingWrites,
      failedCollections: this.failedCollections.size,
      lastWriteAt: this.lastWriteAt,
      lastFailureAt: this.lastFailureAt
    };
  }

  async getDatabaseUsage(options = {}) {
    if (!this.databaseUrl) {
      return {
        connected: false,
        source: "postgres_adapter",
        note: "DATABASE_URL non configurato."
      };
    }

    const pool = this.createPool();
    const limitBytes = Number(options.limitBytes || 0);
    const databaseResult = await pool.query(`
      SELECT
        current_database() AS database_name,
        pg_database_size(current_database())::bigint AS used_bytes,
        pg_size_pretty(pg_database_size(current_database())) AS used_pretty
    `);
    const tablesResult = await pool.query(`
      SELECT
        schemaname,
        relname,
        pg_total_relation_size(format('%I.%I', schemaname, relname))::bigint AS bytes,
        pg_size_pretty(pg_total_relation_size(format('%I.%I', schemaname, relname))) AS pretty
      FROM pg_stat_user_tables
      ORDER BY bytes DESC
      LIMIT 12
    `);

    const row = databaseResult.rows[0] || {};
    const usedBytes = Number(row.used_bytes || 0);
    const remainingBytes = limitBytes > 0 ? Math.max(limitBytes - usedBytes, 0) : null;
    return {
      connected: true,
      source: "postgres_adapter",
      databaseName: row.database_name || "",
      usedBytes,
      usedPretty: row.used_pretty || formatBytes(usedBytes),
      limitBytes: limitBytes || null,
      limitPretty: limitBytes ? formatBytes(limitBytes) : "",
      remainingBytes,
      remainingPretty: remainingBytes === null ? "" : formatBytes(remainingBytes),
      usedPercent: limitBytes ? Math.round((usedBytes / limitBytes) * 1000) / 10 : null,
      tables: tablesResult.rows.map((table) => ({
        schema: table.schemaname,
        name: table.relname,
        bytes: Number(table.bytes || 0),
        pretty: table.pretty || formatBytes(table.bytes)
      })),
      updatedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  PostgresPersistenceAdapter
};
