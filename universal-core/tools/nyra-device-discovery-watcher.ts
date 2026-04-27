import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type DiscoveredUsbDevice = {
  name: string;
  vendor?: string;
  product?: string;
  serial?: string;
  location_id?: string;
  confidence: number;
  classified_as: "phone" | "tablet" | "pc" | "unknown";
};

type DiscoverySnapshot = {
  version: "nyra_device_discovery_snapshot_v1";
  generated_at: string;
  source: "ioreg_usb";
  devices: DiscoveredUsbDevice[];
  selected_candidate?: DiscoveredUsbDevice;
  auto_attach_triggered: boolean;
  handoff_bundle_path?: string;
  shadow_receiver_state_path?: string;
};

const ROOT = process.cwd();
const HANDOFF_DIR = join(ROOT, "runtime", "nyra-handoff");
const SNAPSHOT_PATH = join(HANDOFF_DIR, "nyra_device_discovery_latest.json");
const HANDOFF_PATH = join(HANDOFF_DIR, "nyra_device_handoff_latest.json");
const SHADOW_PATH = join(HANDOFF_DIR, "nyra_shadow_receiver_state_latest.json");

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function classifyName(name: string): { kind: DiscoveredUsbDevice["classified_as"]; confidence: number } {
  const lower = name.toLowerCase();
  if (/(iphone|android|pixel|galaxy|redmi|phone)/.test(lower)) return { kind: "phone", confidence: 94 };
  if (/(ipad|tablet|tab)/.test(lower)) return { kind: "tablet", confidence: 92 };
  if (/(macbook|laptop|notebook|desktop|pc)/.test(lower)) return { kind: "pc", confidence: 86 };
  if (/(apple mobile device|mtp|portable device|usb device)/.test(lower)) return { kind: "phone", confidence: 64 };
  return { kind: "unknown", confidence: 24 };
}

export function parseUsbIoreg(raw: string): DiscoveredUsbDevice[] {
  const blocks = raw
    .split(/\n(?=\s*\+-o )/g)
    .map((block) => block.trim())
    .filter(Boolean);

  const devices: DiscoveredUsbDevice[] = [];
  for (const block of blocks) {
    const firstLine = block.split("\n")[0] ?? "";
    const firstMatch = firstLine.match(/\+-o\s+(.+?)\s+</);
    const rawName = firstMatch?.[1]?.trim();
    if (!rawName) continue;
    if (/AppleT\d+USBXHCI|Root|IOUSBHostDevice$/.test(rawName)) continue;

    const vendor = block.match(/"USB Vendor Name"\s*=\s*"([^"]+)"/)?.[1]
      ?? block.match(/"kUSBVendorString"\s*=\s*"([^"]+)"/)?.[1];
    const product = block.match(/"USB Product Name"\s*=\s*"([^"]+)"/)?.[1]
      ?? block.match(/"kUSBProductString"\s*=\s*"([^"]+)"/)?.[1];
    const serial = block.match(/"USB Serial Number"\s*=\s*"([^"]+)"/)?.[1]
      ?? block.match(/"kUSBSerialNumberString"\s*=\s*"([^"]+)"/)?.[1];
    const location = block.match(/"locationID"\s*=\s*(\d+)/)?.[1];

    const visibleName = product ?? rawName;
    const classified = classifyName(`${visibleName} ${vendor ?? ""}`);
    devices.push({
      name: visibleName,
      vendor,
      product,
      serial,
      location_id: location,
      classified_as: classified.kind,
      confidence: classified.confidence,
    });
  }

  return devices.filter((device) => device.classified_as !== "unknown" || device.confidence >= 60);
}

function readCurrentShadowState(): { runtime_id?: string; target_device?: string } | undefined {
  if (!existsSync(SHADOW_PATH)) return undefined;
  return JSON.parse(readFileSync(SHADOW_PATH, "utf8")) as { runtime_id?: string; target_device?: string };
}

function runCommand(args: string[]): void {
  execFileSync(process.execPath, ["--experimental-strip-types", ...args], {
    cwd: ROOT,
    stdio: "ignore",
  });
}

function maybeAutoAttach(candidate: DiscoveredUsbDevice): boolean {
  const current = readCurrentShadowState();
  const targetKind = candidate.classified_as === "unknown" ? "phone" : candidate.classified_as;
  const runtimeId = `nyra_receiver_${targetKind}_usb`;
  if (current?.runtime_id === runtimeId && current?.target_device === targetKind) return false;

  runCommand(["tools/nyra-device-handoff-protocol.ts", "--target", targetKind, "--connection", "usb", "--role", "extension"]);
  runCommand(["tools/nyra-shadow-receiver-runtime.ts", "--bundle", HANDOFF_PATH]);
  return true;
}

export function buildDiscoverySnapshot(raw: string): DiscoverySnapshot {
  const devices = parseUsbIoreg(raw)
    .sort((a, b) => b.confidence - a.confidence);
  const selected = devices.find((device) => device.classified_as === "phone" || device.classified_as === "tablet");
  const autoAttachTriggered = selected ? maybeAutoAttach(selected) : false;

  return {
    version: "nyra_device_discovery_snapshot_v1",
    generated_at: nowIso(),
    source: "ioreg_usb",
    devices,
    selected_candidate: selected,
    auto_attach_triggered: autoAttachTriggered,
    handoff_bundle_path: selected ? HANDOFF_PATH : undefined,
    shadow_receiver_state_path: selected ? SHADOW_PATH : undefined,
  };
}

export { HANDOFF_PATH, SHADOW_PATH };

function main(): void {
  const raw = execFileSync("ioreg", ["-p", "IOUSB", "-l", "-w", "0"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const snapshot = buildDiscoverySnapshot(raw);
  mkdirSync(HANDOFF_DIR, { recursive: true });
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: true,
        output_path: SNAPSHOT_PATH,
        devices: snapshot.devices.length,
        selected_candidate: snapshot.selected_candidate?.name,
        auto_attach_triggered: snapshot.auto_attach_triggered,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1]?.endsWith("nyra-device-discovery-watcher.ts")) {
  main();
}
