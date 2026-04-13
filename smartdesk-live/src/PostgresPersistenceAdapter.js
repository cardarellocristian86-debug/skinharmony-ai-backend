const fs = require("fs");

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
    this.pool = null;
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
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
    }
  }

  readLocalPayload(filePath, defaultValue) {
    this.ensureLocalFile(filePath, defaultValue);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  writeLocalPayload(filePath, payload) {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
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
    if (!this.databaseUrl) return Promise.resolve();
    const currentChain = this.writeChains.get(name) || Promise.resolve();
    const nextChain = currentChain
      .catch(() => undefined)
      .then(async () => {
        const pool = this.createPool();
        await pool.query(
          `INSERT INTO smartdesk_collections (name, payload, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (name)
           DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
          [name, JSON.stringify(payload)]
        );
      })
      .catch((error) => {
        console.error(`[SmartDesk][DB] Sync fallita per ${name}:`, error.message);
      });

    this.writeChains.set(name, nextChain);
    return nextChain;
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
