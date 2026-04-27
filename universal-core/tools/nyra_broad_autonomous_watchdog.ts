import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type RunnerState = {
  status: "running" | "completed" | "failed";
  started_at?: string;
  ends_at?: string;
  completed_modules?: number;
  current_module?: {
    id: string;
    label: string;
    duration_minutes: number;
  } | null;
  error?: string;
  report_path?: string;
};

type WatchdogEvent = {
  at: string;
  type: "watchdog_started" | "heartbeat" | "warning" | "runner_completed" | "runner_failed";
  status?: RunnerState["status"];
  completed_modules?: number;
  current_module_id?: string;
  message?: string;
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-autonomous-study");
const STATE_PATH = join(RUNTIME_DIR, "nyra_broad_autonomous_5h_state_latest.json");
const WATCHDOG_LOG_PATH = join(RUNTIME_DIR, "nyra_broad_autonomous_5h_watchdog.jsonl");
const WATCHDOG_STATE_PATH = join(RUNTIME_DIR, "nyra_broad_autonomous_5h_watchdog_state_latest.json");
const POLL_INTERVAL_MS = 60_000;
const MODULE_GRACE_MS = 8 * 60_000;

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readState(): RunnerState | undefined {
  if (!existsSync(STATE_PATH)) return undefined;
  return JSON.parse(readFileSync(STATE_PATH, "utf8")) as RunnerState;
}

function appendEvent(event: WatchdogEvent): void {
  appendFileSync(WATCHDOG_LOG_PATH, `${JSON.stringify(event)}\n`);
}

function writeWatchdogState(state: unknown): void {
  writeFileSync(WATCHDOG_STATE_PATH, JSON.stringify(state, null, 2));
}

async function main(): Promise<void> {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  appendEvent({ at: nowIso(), type: "watchdog_started", message: "monitoring broad autonomous 5h runner" });

  let lastModuleId: string | undefined;
  let moduleStartedAt = Date.now();
  let warnedForModule: string | undefined;

  while (true) {
    const state = readState();
    const at = nowIso();

    if (!state) {
      appendEvent({ at, type: "warning", message: "runner state file not found" });
      writeWatchdogState({ status: "warning", at, message: "runner state file not found" });
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const currentModuleId = state.current_module?.id;
    if (currentModuleId !== lastModuleId) {
      lastModuleId = currentModuleId;
      moduleStartedAt = Date.now();
      warnedForModule = undefined;
    }

    appendEvent({
      at,
      type: "heartbeat",
      status: state.status,
      completed_modules: state.completed_modules,
      current_module_id: currentModuleId,
    });

    if (state.status === "completed") {
      appendEvent({ at, type: "runner_completed", status: state.status, message: state.report_path });
      writeWatchdogState({ status: "completed", at, runner_report_path: state.report_path });
      return;
    }

    if (state.status === "failed") {
      appendEvent({ at, type: "runner_failed", status: state.status, message: state.error });
      writeWatchdogState({ status: "failed", at, error: state.error });
      return;
    }

    if (state.current_module) {
      const maxModuleMs = state.current_module.duration_minutes * 60_000 + MODULE_GRACE_MS;
      const elapsedMs = Date.now() - moduleStartedAt;
      if (elapsedMs > maxModuleMs && warnedForModule !== state.current_module.id) {
        warnedForModule = state.current_module.id;
        appendEvent({
          at,
          type: "warning",
          status: state.status,
          completed_modules: state.completed_modules,
          current_module_id: state.current_module.id,
          message: `module exceeded expected duration plus grace: ${state.current_module.label}`,
        });
      }
    }

    writeWatchdogState({
      status: "monitoring",
      at,
      runner_status: state.status,
      completed_modules: state.completed_modules,
      current_module: state.current_module,
    });
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((error) => {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const at = nowIso();
  const message = error instanceof Error ? error.message : String(error);
  appendEvent({ at, type: "warning", message });
  writeWatchdogState({ status: "watchdog_failed", at, error: message });
  process.exitCode = 1;
});
