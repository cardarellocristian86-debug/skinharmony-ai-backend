const fs = require("fs");

class JsonFileRepository {
  constructor(filePath, defaultValue = []) {
    this.filePath = filePath;
    this.defaultValue = defaultValue;
  }

  ensureFile() {
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify(this.defaultValue, null, 2));
    }
  }

  list() {
    this.ensureFile();
    return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
  }

  write(items) {
    fs.writeFileSync(this.filePath, JSON.stringify(items, null, 2));
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
}

module.exports = {
  JsonFileRepository
};
