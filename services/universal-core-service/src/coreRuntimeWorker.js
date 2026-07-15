import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BINARY = path.resolve(__dirname, "../native/core-runtime/target/release/skinharmony-core-runtime");

export function createCoreRuntimeWorker(options = {}) {
  const binaryPath = options.binaryPath || process.env.CORE_RUNTIME_V2_BIN || DEFAULT_BINARY;
  const timeoutMs = Number(options.timeoutMs || process.env.CORE_RUNTIME_V2_TIMEOUT_MS || 1_500);
  let child = null;
  let buffer = "";
  const pending = new Map();

  function rejectAll(code) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(code));
    }
    pending.clear();
  }

  function ensureStarted() {
    if (child && !child.killed) return child;
    child = spawn(binaryPath, [], { stdio: ["pipe", "pipe", "ignore"] });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let response;
        try { response = JSON.parse(line); } catch { continue; }
        const entry = pending.get(response.id);
        if (!entry) continue;
        pending.delete(response.id);
        clearTimeout(entry.timer);
        if (response.ok) entry.resolve(response.output ?? response);
        else entry.reject(new Error(String(response.error || "core_runtime_v2_failed")));
      }
    });
    child.on("error", () => rejectAll("core_runtime_v2_unavailable"));
    child.on("exit", () => {
      rejectAll("core_runtime_v2_exited");
      child = null;
    });
    return child;
  }

  function call(operation, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = `runtime_${crypto.randomUUID()}`;
      let processHandle;
      try { processHandle = ensureStarted(); } catch { reject(new Error("core_runtime_v2_unavailable")); return; }
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("core_runtime_v2_timeout"));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      processHandle.stdin.write(`${JSON.stringify({ id, operation, ...payload })}\n`, (error) => {
        if (!error) return;
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        clearTimeout(entry.timer);
        reject(new Error("core_runtime_v2_write_failed"));
      });
    });
  }

  return {
    call,
    health: () => call("health"),
    digest: (input) => call("digest", { input }),
    status: () => ({ configured: Boolean(binaryPath), running: Boolean(child && !child.killed) }),
    close: () => {
      rejectAll("core_runtime_v2_closed");
      child?.kill();
      child = null;
    },
  };
}
