const fs = require("fs");

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
      throw new Error("Dipendenza 'pg' non installata. Esegui npm install nel servizio smartdesk-live.");
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
}

module.exports = {
  PostgresPersistenceAdapter
};
