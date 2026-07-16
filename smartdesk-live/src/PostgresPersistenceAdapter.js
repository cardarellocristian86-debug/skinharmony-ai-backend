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
  constructor(databaseUrl, options = {}) {
    this.databaseUrl = databaseUrl;
    this.tenantId = String(options.tenantId || process.env.SMARTDESK_TENANT_ID || "smartdesk").trim() || "smartdesk";
    this.poolFactory = options.poolFactory || null;
    this.revisions = new Map();
    this.legacyWriteChains = new Map();
    this.pool = null;
  }

  createPool() {
    if (this.pool) return this.pool;
    if (this.poolFactory) {
      this.pool = this.poolFactory();
      return this.pool;
    }
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS smartdesk_collection_snapshots (
        tenant_id TEXT NOT NULL,
        collection_name TEXT NOT NULL,
        revision BIGINT NOT NULL DEFAULT 1,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_id, collection_name)
      )
    `);
    await pool.query(
      `INSERT INTO smartdesk_collection_snapshots (tenant_id, collection_name, revision, payload, updated_at)
       SELECT $1, name, 1, payload, updated_at
       FROM smartdesk_collections
       ON CONFLICT (tenant_id, collection_name) DO NOTHING`,
      [this.tenantId]
    );

    for (const collection of collections) {
      await this.bootstrapCollection(collection);
    }
    return this.revisions;
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
      `SELECT payload, revision
       FROM smartdesk_collection_snapshots
       WHERE tenant_id = $1 AND collection_name = $2
       LIMIT 1`,
      [this.tenantId, name]
    );

    if (result.rows[0]) {
      this.writeLocalPayload(filePath, result.rows[0].payload);
      this.revisions.set(name, Number(result.rows[0].revision || 1));
      return;
    }

    const inserted = await pool.query(
      `INSERT INTO smartdesk_collection_snapshots (tenant_id, collection_name, revision, payload, updated_at)
       VALUES ($1, $2, 1, $3::jsonb, NOW())
       ON CONFLICT (tenant_id, collection_name) DO NOTHING
       RETURNING revision`,
      [this.tenantId, name, JSON.stringify(localPayload)]
    );
    if (inserted.rows[0]) {
      this.revisions.set(name, Number(inserted.rows[0].revision || 1));
      return;
    }
    const existing = await pool.query(
      `SELECT revision FROM smartdesk_collection_snapshots
       WHERE tenant_id = $1 AND collection_name = $2`,
      [this.tenantId, name]
    );
    this.revisions.set(name, Number(existing.rows[0]?.revision || 1));
  }

  getRevision(name) {
    return this.revisions.get(name) || null;
  }

  async writeCollection(name, payload, expectedRevision) {
    if (!this.databaseUrl) return null;
    const revision = Number(expectedRevision || this.getRevision(name));
    if (!Number.isSafeInteger(revision) || revision < 1) {
      const error = new Error(`Revisione mancante per la collezione ${name}`);
      error.code = "persistence_revision_missing";
      throw error;
    }
    let result;
    try {
      result = await this.createPool().query(
        `UPDATE smartdesk_collection_snapshots
         SET payload = $1::jsonb, revision = revision + 1, updated_at = NOW()
         WHERE tenant_id = $2 AND collection_name = $3 AND revision = $4
         RETURNING revision`,
        [JSON.stringify(payload), this.tenantId, name, revision]
      );
    } catch (cause) {
      const error = new Error(`Persistenza PostgreSQL non disponibile per ${name}`);
      error.code = "persistence_unavailable";
      error.cause = cause;
      throw error;
    }
    if (!result.rows[0]) {
      const error = new Error(`Conflitto di scrittura per la collezione ${name}; ricarica e riprova.`);
      error.code = "persistence_conflict";
      throw error;
    }
    const nextRevision = Number(result.rows[0].revision);
    this.revisions.set(name, nextRevision);
    return nextRevision;
  }

  // Transitional compatibility only. Critical endpoints must call writeCollection
  // through JsonFileRepository.writeDurable and await the result.
  enqueueLegacyWrite(name, payload) {
    const current = this.legacyWriteChains.get(name) || Promise.resolve();
    const next = current
      .catch(() => undefined)
      .then(() => this.writeCollection(name, payload, this.getRevision(name)))
      .catch((error) => {
        console.error(`[SmartDesk][DB][legacy] Sync fallita per ${name}:`, error.message);
      });
    this.legacyWriteChains.set(name, next);
    return next;
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
