import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateNyraExecution } from "./nyra-execution-validation-core.ts";

type PresenceState = {
  attached: boolean;
  current_device?: {
    classified_as: "phone" | "tablet" | "pc" | "unknown";
  };
  shadow_runtime_active: boolean;
};

type ShadowState = {
  mode?: "shadow_active" | "pending_confirmation" | "rejected";
  target_device?: "phone" | "tablet" | "pc";
  auto_entry?: boolean;
};

type DecisionTask =
  | "wait_for_device"
  | "verify_shadow_runtime"
  | "activate_shadow_runtime"
  | "fallback_protection_only";

type DecisionLoopState = {
  version: "nyra_autonomous_decision_loop_v1";
  generated_at: string;
  task: DecisionTask;
  attempts: number;
  executed_actions: string[];
  verified: boolean;
  fallback_used: boolean;
  final_status: "idle" | "verified" | "retry_exhausted" | "fallback_protection_only";
  notes: string[];
};

const ROOT = process.cwd();
const HANDOFF_DIR = join(ROOT, "runtime", "nyra-handoff");
const PRESENCE_PATH = join(HANDOFF_DIR, "nyra_device_presence_latest.json");
const SHADOW_PATH = join(HANDOFF_DIR, "nyra_shadow_receiver_state_latest.json");
const OUTPUT_PATH = join(HANDOFF_DIR, "nyra_autonomous_decision_loop_latest.json");

function nowIso(): string {
  return new Date().toISOString();
}

function readJsonOptional<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function deriveDecisionTask(
  presence: PresenceState | undefined,
  shadow: ShadowState | undefined,
): DecisionTask {
  if (!presence?.attached) return "wait_for_device";
  if (presence.shadow_runtime_active || shadow?.mode === "shadow_active") return "verify_shadow_runtime";
  return "activate_shadow_runtime";
}

export function verifyShadowRuntime(
  presence: PresenceState | undefined,
  shadow: ShadowState | undefined,
): boolean {
  const expectedTarget = presence?.current_device?.classified_as === "tablet" ? "tablet" : "phone";
  const validation = validateNyraExecution(
    {
      task: "activate_shadow_runtime",
      expected_state: "shadow_active",
      expected_target_device: expectedTarget,
      expected_auto_entry: true,
    },
    {
      actual_state: shadow?.mode,
      actual_target_device: shadow?.target_device,
      actual_auto_entry: shadow?.auto_entry,
      device_attached: presence?.attached,
      shadow_runtime_active: presence?.shadow_runtime_active,
    },
  );
  return validation.status === "pass";
}

function runNodeTool(args: string[]): string {
  return execFileSync(process.execPath, ["--experimental-strip-types", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function getLoopMode(): "once" | "daemon" {
  return process.argv.includes("--once") ? "once" : "daemon";
}

function getIntervalMs(): number {
  const raw = Number(process.env.NYRA_AUTONOMOUS_DECISION_INTERVAL_MS ?? 4000);
  return Number.isFinite(raw) && raw >= 1000 ? raw : 4000;
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function executeActivationForPresence(presence: PresenceState): string[] {
  const device = presence.current_device?.classified_as === "tablet" ? "tablet" : "phone";
  const actions: string[] = [];
  runNodeTool(["tools/nyra-device-handoff-protocol.ts", "--target", device, "--connection", "usb", "--role", "extension"]);
  actions.push(`handoff:${device}:usb:extension`);
  runNodeTool(["tools/nyra-shadow-receiver-runtime.ts"]);
  actions.push("shadow_receiver:activate");
  return actions;
}

export function runDecisionLoopOnce(): DecisionLoopState {
  mkdirSync(HANDOFF_DIR, { recursive: true });
  const initialPresence = readJsonOptional<PresenceState>(PRESENCE_PATH);
  const initialShadow = readJsonOptional<ShadowState>(SHADOW_PATH);
  const task = deriveDecisionTask(initialPresence, initialShadow);
  const executedActions: string[] = [];
  const notes: string[] = [];
  let attempts = 0;
  let verified = false;
  let fallbackUsed = false;
  let finalStatus: DecisionLoopState["final_status"] = "idle";

  if (task === "wait_for_device") {
    notes.push("nessun device collegato: nessuna esecuzione");
    finalStatus = "idle";
  } else if (task === "verify_shadow_runtime") {
    verified = verifyShadowRuntime(initialPresence, initialShadow);
    finalStatus = verified ? "verified" : "retry_exhausted";
    notes.push(verified ? "shadow runtime gia coerente" : "shadow runtime presente ma incoerente");
  } else {
    while (attempts < 2 && !verified) {
      attempts += 1;
      try {
        executedActions.push(...executeActivationForPresence(initialPresence!));
      } catch (error) {
        notes.push(`attempt_${attempts}_error:${error instanceof Error ? error.message : "unknown_error"}`);
      }
      const presence = readJsonOptional<PresenceState>(PRESENCE_PATH) ?? initialPresence;
      const shadow = readJsonOptional<ShadowState>(SHADOW_PATH);
      verified = verifyShadowRuntime(presence, shadow);
    }

    if (verified) {
      finalStatus = "verified";
      notes.push("loop chiuso con verify positiva");
    } else {
      fallbackUsed = true;
      finalStatus = "fallback_protection_only";
      notes.push("attivazione non verificata: resto in protezione e non overclaimo controllo");
    }
  }

  const state: DecisionLoopState = {
    version: "nyra_autonomous_decision_loop_v1",
    generated_at: nowIso(),
    task,
    attempts,
    executed_actions: executedActions,
    verified,
    fallback_used: fallbackUsed,
    final_status: finalStatus,
    notes,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(state, null, 2));
  return state;
}

function main(): void {
  const mode = getLoopMode();
  const intervalMs = getIntervalMs();

  if (mode === "once") {
    const state = runDecisionLoopOnce();
    console.log(JSON.stringify({ ok: true, output_path: OUTPUT_PATH, task: state.task, final_status: state.final_status, verified: state.verified }, null, 2));
    return;
  }

  while (true) {
    const state = runDecisionLoopOnce();
    console.log(JSON.stringify({ ok: true, output_path: OUTPUT_PATH, task: state.task, final_status: state.final_status, verified: state.verified }, null, 2));
    sleep(intervalMs);
  }
}

if (process.argv[1]?.endsWith("nyra-autonomous-decision-loop.ts")) {
  main();
}
