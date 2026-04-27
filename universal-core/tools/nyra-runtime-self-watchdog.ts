import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type DialogueMemoryRecord = {
  user_text: string;
  intent: string;
};

type PresenceState = {
  attached: boolean;
  shadow_runtime_active: boolean;
};

type DecisionLoopState = {
  final_status: "idle" | "verified" | "retry_exhausted" | "fallback_protection_only";
  task: string;
  verified: boolean;
};

type WatchdogIssueId =
  | "greeting_relational_drift"
  | "shadow_attach_gap"
  | "decision_loop_not_closed";

type WatchdogState = {
  version: "nyra_runtime_self_watchdog_v1";
  generated_at: string;
  status: "healthy" | "repairing" | "warning";
  issues: Array<{
    id: WatchdogIssueId;
    severity: "low" | "medium" | "high";
    note: string;
  }>;
  executed_repairs: string[];
  runtime_summary: {
    device_attached: boolean;
    shadow_runtime_active: boolean;
    decision_loop_status: string;
  };
};

const ROOT = process.cwd();
const HANDOFF_DIR = join(ROOT, "runtime", "nyra-handoff");
const OWNER_DIR = join(ROOT, "runtime", "owner-private-entity");
const DIALOGUE_MEMORY_PATH = join(OWNER_DIR, "nyra_dialogue_memory.json");
const PRESENCE_PATH = join(HANDOFF_DIR, "nyra_device_presence_latest.json");
const DECISION_LOOP_PATH = join(HANDOFF_DIR, "nyra_autonomous_decision_loop_latest.json");
const OUTPUT_PATH = join(HANDOFF_DIR, "nyra_runtime_self_watchdog_latest.json");

function nowIso(): string {
  return new Date().toISOString();
}

function readJsonOptional<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function runNodeTool(args: string[]): void {
  execFileSync(process.execPath, ["--experimental-strip-types", ...args], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function getLoopMode(): "once" | "daemon" {
  return process.argv.includes("--once") ? "once" : "daemon";
}

function getIntervalMs(): number {
  const raw = Number(process.env.NYRA_RUNTIME_WATCHDOG_INTERVAL_MS ?? 5000);
  return Number.isFinite(raw) && raw >= 1000 ? raw : 5000;
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function detectWatchdogIssues(
  dialogueMemory: DialogueMemoryRecord[],
  presence: PresenceState | undefined,
  decisionLoop: DecisionLoopState | undefined,
): WatchdogState["issues"] {
  const issues: WatchdogState["issues"] = [];
  const recent = dialogueMemory.slice(-6);
  const sawGreetingDrift = recent.some((entry) => {
    const normalized = ` ${entry.user_text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()} `;
    const shortGreeting =
      normalized === " come va " ||
      normalized === " come stai " ||
      normalized === " buongiorno " ||
      normalized === " ciao ";
    return shortGreeting && entry.intent !== "ask_general_status";
  });
  if (sawGreetingDrift) {
    issues.push({
      id: "greeting_relational_drift",
      severity: "medium",
      note: "input relazionale corto instradato fuori dal ramo stato/presenza",
    });
  }

  if (presence?.attached && !presence.shadow_runtime_active) {
    issues.push({
      id: "shadow_attach_gap",
      severity: "high",
      note: "device collegato ma shadow runtime non attivo",
    });
  }

  if (decisionLoop && (decisionLoop.final_status === "retry_exhausted" || decisionLoop.final_status === "fallback_protection_only")) {
    issues.push({
      id: "decision_loop_not_closed",
      severity: "high",
      note: "execute/verify/retry non ha chiuso il loop",
    });
  }

  return issues;
}

export function runWatchdogOnce(): WatchdogState {
  mkdirSync(HANDOFF_DIR, { recursive: true });
  const dialogueMemory = readJsonOptional<DialogueMemoryRecord[]>(DIALOGUE_MEMORY_PATH) ?? [];
  const presence = readJsonOptional<PresenceState>(PRESENCE_PATH);
  const decisionLoop = readJsonOptional<DecisionLoopState>(DECISION_LOOP_PATH);
  const issues = detectWatchdogIssues(dialogueMemory, presence, decisionLoop);
  const executedRepairs: string[] = [];

  if (issues.some((entry) => entry.id === "shadow_attach_gap" || entry.id === "decision_loop_not_closed")) {
    runNodeTool(["tools/nyra-autonomous-decision-loop.ts"]);
    executedRepairs.push("run:nyra-autonomous-decision-loop");
  }

  const status: WatchdogState["status"] =
    issues.length === 0 ? "healthy" : executedRepairs.length > 0 ? "repairing" : "warning";

  const state: WatchdogState = {
    version: "nyra_runtime_self_watchdog_v1",
    generated_at: nowIso(),
    status,
    issues,
    executed_repairs: executedRepairs,
    runtime_summary: {
      device_attached: presence?.attached ?? false,
      shadow_runtime_active: presence?.shadow_runtime_active ?? false,
      decision_loop_status: decisionLoop?.final_status ?? "not_loaded",
    },
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(state, null, 2));
  return state;
}

function main(): void {
  const mode = getLoopMode();
  const intervalMs = getIntervalMs();

  if (mode === "once") {
    const state = runWatchdogOnce();
    console.log(JSON.stringify({ ok: true, output_path: OUTPUT_PATH, status: state.status, issues: state.issues.length, repairs: state.executed_repairs.length }, null, 2));
    return;
  }

  while (true) {
    const state = runWatchdogOnce();
    console.log(JSON.stringify({ ok: true, output_path: OUTPUT_PATH, status: state.status, issues: state.issues.length, repairs: state.executed_repairs.length }, null, 2));
    sleep(intervalMs);
  }
}

if (process.argv[1]?.endsWith("nyra-runtime-self-watchdog.ts")) {
  main();
}
