import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_STALE_LOCK_MS = 120_000;

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR", "EBADF"].includes(error?.code)) throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function safeReadJson(file, maxBytes) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size < 2 || stat.size > maxBytes) {
    throw new Error("nyra_deep_v2_file_state_corrupt");
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error("nyra_deep_v2_file_state_corrupt");
  }
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

export function createNyraDeepV2FileState({
  filePath,
  maxBytes = DEFAULT_MAX_BYTES,
  staleLockMs = DEFAULT_STALE_LOCK_MS,
  now = () => Date.now(),
} = {}) {
  const target = path.resolve(String(filePath || ""));
  if (!filePath || target === path.parse(target).root) {
    throw new Error("nyra_deep_v2_file_state_path_required");
  }
  const byteLimit = Math.max(4_096, Math.min(
    DEFAULT_MAX_BYTES,
    Number(maxBytes) || DEFAULT_MAX_BYTES,
  ));
  const staleAfter = Math.max(30_000, Math.min(
    15 * 60_000,
    Number(staleLockMs) || DEFAULT_STALE_LOCK_MS,
  ));
  const directory = path.dirname(target);
  const lockPath = `${target}.lock`;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  function recoverStaleLock() {
    let firstStat;
    let lock;
    try {
      firstStat = fs.lstatSync(lockPath);
      if (!firstStat.isFile() || now() - firstStat.mtimeMs <= staleAfter) return false;
      lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    } catch {
      return false;
    }
    if (
      !lock
      || typeof lock !== "object"
      || !Number.isSafeInteger(lock.pid)
      || typeof lock.token !== "string"
      || !/^[a-f0-9]{32}$/u.test(lock.token)
      || processAlive(lock.pid)
    ) return false;
    let secondStat;
    try {
      secondStat = fs.lstatSync(lockPath);
    } catch {
      return false;
    }
    if (!sameFile(firstStat, secondStat) || now() - secondStat.mtimeMs <= staleAfter) return false;
    const quarantine = `${lockPath}.stale.${lock.token}`;
    try {
      fs.renameSync(lockPath, quarantine);
      fs.unlinkSync(quarantine);
      fsyncDirectory(directory);
      return true;
    } catch {
      return false;
    }
  }

  function acquireLock() {
    const token = crypto.randomBytes(16).toString("hex");
    let descriptor;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        descriptor = fs.openSync(lockPath, "wx", 0o600);
        const payload = JSON.stringify({
          schema_version: "nyra_deep_v2_file_lock_v1",
          pid: process.pid,
          token,
          created_at: new Date(now()).toISOString(),
        });
        fs.writeFileSync(descriptor, payload, "utf8");
        fs.fsyncSync(descriptor);
        return { descriptor, token };
      } catch (error) {
        if (descriptor !== undefined) {
          try { fs.closeSync(descriptor); } catch {}
          descriptor = undefined;
        }
        if (error?.code !== "EEXIST" || attempt > 0 || !recoverStaleLock()) {
          throw new Error("nyra_deep_v2_file_state_locked");
        }
      }
    }
    throw new Error("nyra_deep_v2_file_state_locked");
  }

  function releaseLock(lock) {
    if (lock?.descriptor !== undefined) fs.closeSync(lock.descriptor);
    try {
      const stored = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if (stored?.token !== lock?.token || stored?.pid !== process.pid) {
        throw new Error("nyra_deep_v2_file_state_lock_ownership_lost");
      }
      fs.unlinkSync(lockPath);
      fsyncDirectory(directory);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  function write(state) {
    const encoded = `${JSON.stringify(state)}\n`;
    if (Buffer.byteLength(encoded, "utf8") > byteLimit) {
      throw new Error("nyra_deep_v2_file_state_capacity_exceeded");
    }
    const temporary = `${target}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(descriptor, encoded, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, target);
      fs.chmodSync(target, 0o600);
      fsyncDirectory(directory);
    } finally {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch {}
      }
      try { fs.unlinkSync(temporary); } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }

  function update(work) {
    if (typeof work !== "function") throw new TypeError("nyra_deep_v2_file_state_work_required");
    const lock = acquireLock();
    try {
      const current = safeReadJson(target, byteLimit);
      const outcome = work(current);
      if (!outcome || typeof outcome !== "object" || !("state" in outcome)) {
        throw new Error("nyra_deep_v2_file_state_update_invalid");
      }
      if (outcome.state !== null) write(outcome.state);
      return outcome.result;
    } finally {
      releaseLock(lock);
    }
  }

  function probe() {
    try {
      return update((current) => ({ state: current, result: { ok: true } }));
    } catch {
      return { ok: false };
    }
  }

  return Object.freeze({
    kind: "atomic_fsync_file_v1",
    restart_durable: true,
    distributed: false,
    read: () => safeReadJson(target, byteLimit),
    update,
    probe,
  });
}
