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
  constructor(databaseUrl, options = {}) {
    this.databaseUrl = databaseUrl;
    this.tenantId = String(options.tenantId || process.env.SMARTDESK_TENANT_ID || "smartdesk").trim() || "smartdesk";
    this.poolFactory = options.poolFactory || null;
    this.revisions = new Map();
    this.writeChains = new Map();
    this.writeTracking = new AsyncLocalStorage();
    this.pool = null;
    this.pendingWrites = 0;
    this.failedCollections = new Set();
    this.lastWriteAt = null;
    this.lastFailureAt = null;
    this.mutationTail = Promise.resolve();
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

  async readCollection(name) {
    try {
      const result = await this.createPool().query(
        `SELECT payload, revision
         FROM smartdesk_collection_snapshots
         WHERE tenant_id = $1 AND collection_name = $2
         LIMIT 1`,
        [this.tenantId, name]
      );
      if (!result.rows[0]) {
        const error = new Error(`Collezione PostgreSQL non trovata: ${name}`);
        error.code = "persistence_unavailable";
        throw error;
      }
      const value = {
        payload: result.rows[0].payload,
        revision: Number(result.rows[0].revision)
      };
      this.revisions.set(name, value.revision);
      return value;
    } catch (cause) {
      if (cause?.code === "persistence_unavailable") throw cause;
      const error = new Error(`Persistenza PostgreSQL non disponibile per ${name}`);
      error.code = "persistence_unavailable";
      error.cause = cause;
      throw error;
    }
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

  async writeCollectionsAtomically(changes = []) {
    const ordered = [...changes].sort((left, right) => String(left.name).localeCompare(String(right.name)));
    if (!ordered.length) return new Map();
    let client;
    let began = false;
    try {
      client = await this.createPool().connect();
      await client.query("BEGIN");
      began = true;
      const committed = new Map();
      for (const change of ordered) {
        const expectedRevision = Number(change.expectedRevision || this.getRevision(change.name));
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
          const error = new Error(`Revisione mancante per la collezione ${change.name}`);
          error.code = "persistence_revision_missing";
          throw error;
        }
        const result = await client.query(
          `UPDATE smartdesk_collection_snapshots
           SET payload = $1::jsonb, revision = revision + 1, updated_at = NOW()
           WHERE tenant_id = $2 AND collection_name = $3 AND revision = $4
           RETURNING revision`,
          [JSON.stringify(change.payload), this.tenantId, change.name, expectedRevision]
        );
        if (!result.rows[0]) {
          const error = new Error(`Conflitto di scrittura per la collezione ${change.name}; ricarica e riprova.`);
          error.code = "persistence_conflict";
          throw error;
        }
        committed.set(change.name, Number(result.rows[0].revision));
      }
      await client.query("COMMIT");
      began = false;
      committed.forEach((revision, name) => this.revisions.set(name, revision));
      return committed;
    } catch (cause) {
      if (began) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original persistence error.
        }
      }
      if (cause?.code === "persistence_conflict" || cause?.code === "persistence_revision_missing") throw cause;
      const error = new Error("Persistenza PostgreSQL non disponibile per la transazione Smart Desk");
      error.code = "persistence_unavailable";
      error.cause = cause;
      throw error;
    } finally {
      client?.release?.();
    }
  }

  // Transitional compatibility only. Critical endpoints must call writeCollection
  // through JsonFileRepository.writeDurable and await the result.
  enqueueLegacyWrite(name, payload) {
    return this.enqueueWrite(name, payload);
  }

  enqueueWrite(name, payload) {
    if (!this.databaseUrl) return Promise.resolve({ ok: true, collection: name, skipped: true });
    const snapshot = JSON.parse(JSON.stringify(payload));
    if (this.stageWrite(name, snapshot, this.getRevision(name))) {
      return Promise.resolve({ ok: true, collection: name, staged: true });
    }
    const current = this.writeChains.get(name) || Promise.resolve();
    this.pendingWrites += 1;
    const operation = current.catch(() => undefined).then(() => (
      this.writeCollection(name, snapshot, this.getRevision(name))
    ));
    const outcome = operation.then(
      () => {
        this.failedCollections.delete(name);
        this.lastWriteAt = new Date().toISOString();
        return { ok: true, collection: name, skipped: false };
      },
      () => {
        this.failedCollections.add(name);
        this.lastFailureAt = new Date().toISOString();
        return { ok: false, collection: name, code: "persistence_write_failed" };
      }
    ).then((result) => {
      this.pendingWrites = Math.max(0, this.pendingWrites - 1);
      return result;
    });
    const chain = outcome.then(() => undefined);
    this.writeChains.set(name, chain);
    void chain.then(() => {
      if (this.writeChains.get(name) === chain) this.writeChains.delete(name);
    });
    const context = this.writeTracking.getStore();
    if (context) {
      context.outcomes.push(outcome);
    } else {
      void outcome.then((result) => {
        if (!result.ok) console.error(`[SmartDesk][DB] Sync fallita per ${name}: persistence_write_failed`);
      });
    }
    return outcome;
  }

  runWithWriteTracking(callback) {
    let release;
    const turn = new Promise((resolve) => { release = resolve; });
    const previous = this.mutationTail;
    this.mutationTail = previous.catch(() => undefined).then(() => turn);
    return previous.catch(() => undefined).then(() => {
      const context = {
        outcomes: [],
        stagedWrites: new Map(),
        rollbacks: new Map(),
        flushPromise: null,
        flushSettled: false,
        released: false,
        release
      };
      return this.writeTracking.run(context, () => callback(context));
    });
  }

  releaseTrackedWrites(context = this.writeTracking.getStore()) {
    if (!context || context.released) return false;
    if (this.hasTrackedWrites(context) && !context.flushSettled) return false;
    context.released = true;
    context.release();
    return true;
  }

  stageWrite(name, payload, expectedRevision, onCommit = null) {
    const context = this.writeTracking.getStore();
    if (!context || !this.databaseUrl) return false;
    const existing = context.stagedWrites.get(name);
    context.stagedWrites.set(name, {
      name,
      payload: JSON.parse(JSON.stringify(payload)),
      expectedRevision: existing?.expectedRevision ?? expectedRevision ?? this.getRevision(name),
      onCommit: [...(existing?.onCommit || []), ...(typeof onCommit === "function" ? [onCommit] : [])]
    });
    return true;
  }

  trackLocalRollback(key, rollback) {
    const context = this.writeTracking.getStore();
    if (!context || typeof rollback !== "function" || context.rollbacks.has(key)) return false;
    context.rollbacks.set(key, rollback);
    return true;
  }

  hasTrackedWrites(context = this.writeTracking.getStore()) {
    return Boolean(context && (context.outcomes.length || context.stagedWrites.size));
  }

  flushTrackedWrites(context = this.writeTracking.getStore()) {
    if (!context) return Promise.resolve([]);
    if (context.flushPromise) return context.flushPromise;
    context.flushPromise = (async () => {
      const results = [];
      try {
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
        if (context.stagedWrites.size) {
          this.pendingWrites += context.stagedWrites.size;
          const committed = await this.writeCollectionsAtomically([...context.stagedWrites.values()]);
          for (const entry of context.stagedWrites.values()) {
            const revision = committed.get(entry.name);
            entry.onCommit.forEach((callback) => callback(revision));
            this.failedCollections.delete(entry.name);
            results.push({ ok: true, collection: entry.name, revision });
          }
          this.pendingWrites = Math.max(0, this.pendingWrites - context.stagedWrites.size);
          this.lastWriteAt = new Date().toISOString();
        }
        context.rollbacks.clear();
        return results;
      } catch (cause) {
        this.pendingWrites = Math.max(0, this.pendingWrites - context.stagedWrites.size);
        context.stagedWrites.forEach((_entry, name) => this.failedCollections.add(name));
        this.lastFailureAt = new Date().toISOString();
        [...context.rollbacks.values()].reverse().forEach((rollback) => rollback());
        const error = new Error("Persistenza dati non confermata.");
        error.code = "persistence_sync_failed";
        error.failedCollections = [...context.stagedWrites.keys()];
        error.cause = cause;
        throw error;
      }
    })().finally(() => {
      context.flushSettled = true;
    });
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

  async probeHealth() {
    const status = this.getPersistenceStatus();
    if (!this.databaseUrl) return { ...status, databaseReachable: false };
    try {
      await this.createPool().query("SELECT 1 AS smartdesk_health");
      return { ...this.getPersistenceStatus(), databaseReachable: true };
    } catch {
      return { ...this.getPersistenceStatus(), healthy: false, databaseReachable: false };
    }
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
