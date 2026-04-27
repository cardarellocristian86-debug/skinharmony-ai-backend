import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDiscoverySnapshot, parseUsbIoreg } from "./nyra-device-discovery-watcher.ts";

type PresenceState = {
  version: "nyra_device_presence_state_v1";
  generated_at: string;
  loop_started_at: string;
  poll_interval_ms: number;
  attached: boolean;
  current_device?: {
    name: string;
    serial?: string;
    location_id?: string;
    classified_as: "phone" | "tablet" | "pc" | "unknown";
  };
  shadow_runtime_active: boolean;
  detach_handled: boolean;
  actual_capabilities: string[];
  missing_capabilities: string[];
  source_files: {
    discovery_snapshot: string;
    handoff_bundle: string;
    shadow_receiver_state: string;
  };
};

const ROOT = process.cwd();
const HANDOFF_DIR = join(ROOT, "runtime", "nyra-handoff");
const PRESENCE_PATH = join(HANDOFF_DIR, "nyra_device_presence_latest.json");
const DISCOVERY_PATH = join(HANDOFF_DIR, "nyra_device_discovery_latest.json");
const HANDOFF_PATH = join(HANDOFF_DIR, "nyra_device_handoff_latest.json");
const SHADOW_PATH = join(HANDOFF_DIR, "nyra_shadow_receiver_state_latest.json");
const STATUS_PATH = join(HANDOFF_DIR, "nyra_shadow_receiver_connection_latest.json");

function nowIso(): string {
  return new Date().toISOString();
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function getPollInterval(): number {
  const raw = Number(process.env.NYRA_DEVICE_PRESENCE_INTERVAL_MS ?? 3000);
  return Number.isFinite(raw) && raw >= 1000 ? raw : 3000;
}

function getLoopMode(): "once" | "daemon" {
  return process.argv.includes("--once") ? "once" : "daemon";
}

function captureUsbRaw(): string {
  return execFileSync("ioreg", ["-p", "IOUSB", "-l", "-w", "0"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

function hasShadowActive(): boolean {
  const state = readJson<{ mode?: string }>(SHADOW_PATH);
  return state?.mode === "shadow_active";
}

function writeConnectionStatus(attached: boolean, deviceName?: string): void {
  writeFileSync(
    STATUS_PATH,
    JSON.stringify(
      {
        version: "nyra_shadow_receiver_connection_v1",
        generated_at: nowIso(),
        attached,
        shadow_runtime_active: hasShadowActive(),
        status: attached ? "connected" : "detached",
        device_name: deviceName,
      },
      null,
      2,
    ),
  );
}

function clearShadowOnDetach(): boolean {
  const hadShadow = existsSync(SHADOW_PATH);
  if (hadShadow) rmSync(SHADOW_PATH, { force: true });
  writeConnectionStatus(false);
  return hadShadow;
}

function buildCapabilities(attached: boolean): { actual: string[]; missing: string[] } {
  const actual = [
    "rilevare device USB collegato",
    "classificare telefono o tablet",
    "caricare handoff bundle",
    "attivare receiver shadow",
    "mantenere Mac come casa primaria",
  ];
  if (!attached) actual.push("gestire detach senza perdere la casa primaria");

  const missing = [
    "controllare app native del telefono",
    "toccare UI del telefono",
    "scrivere file o mail sul telefono in autonomia",
    "restare runtime pieno indipendente sul telefono",
    "governare il telefono come fai tu sul Mac",
  ];
  return { actual, missing };
}

function writePresenceState(loopStartedAt: string, pollIntervalMs: number, detachHandled: boolean): PresenceState {
  const discovery = readJson<{
    selected_candidate?: {
      name: string;
      serial?: string;
      location_id?: string;
      classified_as: "phone" | "tablet" | "pc" | "unknown";
    };
  }>(DISCOVERY_PATH);
  const attached = Boolean(discovery?.selected_candidate);
  const capabilities = buildCapabilities(attached);
  const state: PresenceState = {
    version: "nyra_device_presence_state_v1",
    generated_at: nowIso(),
    loop_started_at: loopStartedAt,
    poll_interval_ms: pollIntervalMs,
    attached,
    current_device: discovery?.selected_candidate,
    shadow_runtime_active: hasShadowActive(),
    detach_handled: detachHandled,
    actual_capabilities: capabilities.actual,
    missing_capabilities: capabilities.missing,
    source_files: {
      discovery_snapshot: DISCOVERY_PATH,
      handoff_bundle: HANDOFF_PATH,
      shadow_receiver_state: SHADOW_PATH,
    },
  };
  writeFileSync(PRESENCE_PATH, JSON.stringify(state, null, 2));
  return state;
}

function tick(loopStartedAt: string, pollIntervalMs: number): PresenceState {
  mkdirSync(HANDOFF_DIR, { recursive: true });
  const raw = captureUsbRaw();
  const devices = parseUsbIoreg(raw);
  let detachHandled = false;

  if (devices.some((device) => device.classified_as === "phone" || device.classified_as === "tablet")) {
    const snapshot = buildDiscoverySnapshot(raw);
    writeFileSync(DISCOVERY_PATH, JSON.stringify(snapshot, null, 2));
    writeConnectionStatus(true, snapshot.selected_candidate?.name);
  } else {
    detachHandled = clearShadowOnDetach();
    writeFileSync(
      DISCOVERY_PATH,
      JSON.stringify(
        {
          version: "nyra_device_discovery_snapshot_v1",
          generated_at: nowIso(),
          source: "ioreg_usb",
          devices: [],
          auto_attach_triggered: false,
        },
        null,
        2,
      ),
    );
  }

  return writePresenceState(loopStartedAt, pollIntervalMs, detachHandled);
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function main(): void {
  const pollIntervalMs = getPollInterval();
  const loopStartedAt = nowIso();
  const mode = getLoopMode();

  if (mode === "once") {
    const state = tick(loopStartedAt, pollIntervalMs);
    console.log(JSON.stringify({ ok: true, mode, output_path: PRESENCE_PATH, attached: state.attached, shadow_runtime_active: state.shadow_runtime_active }, null, 2));
    return;
  }

  while (true) {
    const state = tick(loopStartedAt, pollIntervalMs);
    console.log(JSON.stringify({ ok: true, mode, generated_at: state.generated_at, attached: state.attached, device: state.current_device?.name, shadow_runtime_active: state.shadow_runtime_active }, null, 2));
    sleep(pollIntervalMs);
  }
}

if (process.argv[1]?.endsWith("nyra-device-presence-loop.ts")) {
  main();
}
