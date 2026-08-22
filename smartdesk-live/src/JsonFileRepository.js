const fs = require("fs");

let atomicWriteCounter = 0;

function atomicWriteJson(filePath, value) {
  const payload = JSON.stringify(value, null, 2);
  const existingMode = fs.existsSync(filePath) ? fs.statSync(filePath).mode & 0o777 : 0o600;
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteCounter += 1}.tmp`;
  let descriptor = null;
  try {
    descriptor = fs.openSync(tempPath, "wx", existingMode);
    fs.writeFileSync(descriptor, payload, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempPath, filePath);
    const directoryDescriptor = fs.openSync(require("node:path").dirname(filePath), "r");
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* Preserve the original error. */ }
    }
    try { fs.unlinkSync(tempPath); } catch { /* It may already have been renamed. */ }
    throw error;
  }
}

class JsonFileRepository {
  constructor(filePath, defaultValue = [], options = {}) {
    this.filePath = filePath;
    this.defaultValue = defaultValue;
    this.adapter = options.adapter || null;
    this.collectionName = options.collectionName || null;
    this.cache = null;
    this.revision = options.revision || null;
  }

  ensureFile() {
    if (!fs.existsSync(this.filePath)) {
      atomicWriteJson(this.filePath, this.defaultValue);
      this.cache = null;
    }
  }

  list() {
    if (!fs.existsSync(this.filePath)) {
      // A read must not create durable state. The first real mutation (or the
      // explicit PostgreSQL bootstrap) materializes the collection.
      return JSON.parse(JSON.stringify(this.defaultValue));
    }
    const stat = fs.statSync(this.filePath);
    if (
      this.cache
      && this.cache.mtimeMs === stat.mtimeMs
      && this.cache.size === stat.size
    ) {
      return this.cache.items;
    }
    const items = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    this.cache = {
      items,
      mtimeMs: stat.mtimeMs,
      size: stat.size
    };
    return items;
  }

  write(items, options = {}) {
    if ((options.trackRollback || !options.skipLegacySync) && this.adapter && this.collectionName) {
      const previousPayload = fs.existsSync(this.filePath) ? fs.readFileSync(this.filePath) : null;
      this.adapter.trackLocalRollback?.(this.filePath, () => {
        if (previousPayload === null) {
          if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
        } else {
          atomicWriteJson(this.filePath, JSON.parse(previousPayload.toString("utf8")));
        }
        this.cache = null;
      });
    }
    atomicWriteJson(this.filePath, items);
    const stat = fs.statSync(this.filePath);
    this.cache = {
      items,
      mtimeMs: stat.mtimeMs,
      size: stat.size
    };
    if (!options.skipLegacySync && this.adapter && this.collectionName) {
      void this.adapter.enqueueWrite(this.collectionName, items);
    }
  }

  setRevision(revision) {
    const value = Number(revision);
    this.revision = Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  async writeDurable(items) {
    if (this.adapter && this.collectionName) {
      const staged = this.adapter.stageWrite?.(
        this.collectionName,
        items,
        this.revision,
        (revision) => this.setRevision(revision)
      );
      if (staged) {
        this.write(items, { skipLegacySync: true, trackRollback: true });
        return;
      }
      this.revision = await this.adapter.writeCollection(this.collectionName, items, this.revision);
    }
    this.write(items, { skipLegacySync: true });
  }

  acceptDurableCommit(items, revision) {
    this.setRevision(revision);
    this.write(items, { skipLegacySync: true });
  }

  async createDurable(item) {
    const items = this.list();
    await this.writeDurable([item, ...items]);
    return item;
  }

  async updateDurable(id, updater) {
    const items = this.list();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const next = updater(items[index]);
    const replacement = [...items];
    replacement[index] = next;
    await this.writeDurable(replacement);
    return next;
  }

  async deleteDurable(id) {
    const items = this.list();
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) return false;
    await this.writeDurable(next);
    return true;
  }

  findById(id) {
    return this.list().find((item) => item.id === id) || null;
  }

  create(item) {
    const items = this.list();
    items.unshift(item);
    this.write(items);
    return item;
  }

  update(id, updater) {
    const items = this.list();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) {
      return null;
    }
    const current = items[index];
    const next = updater(current);
    items[index] = next;
    this.write(items);
    return next;
  }

  delete(id) {
    const items = this.list();
    const next = items.filter((item) => item.id !== id);
    const removed = next.length !== items.length;
    if (removed) {
      this.write(next);
    }
    return removed;
  }

  deleteWhere(predicate) {
    const items = this.list();
    const next = items.filter((item) => !predicate(item));
    const removedCount = items.length - next.length;
    if (removedCount > 0) {
      this.write(next);
    }
    return removedCount;
  }
}

module.exports = {
  JsonFileRepository,
  atomicWriteJson
};
