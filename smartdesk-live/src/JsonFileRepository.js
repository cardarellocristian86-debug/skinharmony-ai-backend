const fs = require("fs");

let atomicWriteCounter = 0;

function atomicWriteJson(filePath, value) {
  const payload = JSON.stringify(value, null, 2);
  const existingMode = fs.existsSync(filePath)
    ? fs.statSync(filePath).mode & 0o777
    : 0o600;
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteCounter += 1}.tmp`;
  let descriptor = null;

  try {
    descriptor = fs.openSync(tempPath, "wx", existingMode);
    fs.writeFileSync(descriptor, payload, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch (_closeError) {
        // Preserve the original write error.
      }
    }
    try {
      fs.unlinkSync(tempPath);
    } catch (_cleanupError) {
      // The temporary file may already have been renamed or removed.
    }
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
  }

  ensureFile() {
    if (!fs.existsSync(this.filePath)) {
      atomicWriteJson(this.filePath, this.defaultValue);
      this.cache = null;
    }
  }

  list() {
    this.ensureFile();
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

  write(items) {
    atomicWriteJson(this.filePath, items);
    const stat = fs.statSync(this.filePath);
    this.cache = {
      items,
      mtimeMs: stat.mtimeMs,
      size: stat.size
    };
    if (this.adapter && this.collectionName) {
      void this.adapter.enqueueWrite(this.collectionName, items);
    }
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
