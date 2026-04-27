import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  getOwnerMailBridgeStatus,
  processOwnerMailAutonomousOutbox,
  type OwnerMailBridgeConfig,
} from "./nyra-owner-mail-bridge.ts";

type NyraOwnerPrivateIdentity = {
  private_fields: {
    primary_email: string;
  };
};

const ROOT = join(process.cwd(), "..");
const NYRA_OWNER_IDENTITY_PRIVATE_PATH = join(ROOT, "universal-core", "runtime", "owner-private-entity", "nyra_owner_identity_private.json");
const NYRA_OWNER_IDENTITY_KEYCHAIN_SERVICE = "nyra_owner_identity_private_v1";
const NYRA_OWNER_IDENTITY_KEYCHAIN_ACCOUNT = "cristian_primary";

function loadOwnerEmail(): string | undefined {
  try {
    const raw = execFileSync(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-a",
        NYRA_OWNER_IDENTITY_KEYCHAIN_ACCOUNT,
        "-s",
        NYRA_OWNER_IDENTITY_KEYCHAIN_SERVICE,
        "-w",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (raw) return (JSON.parse(raw) as NyraOwnerPrivateIdentity).private_fields.primary_email;
  } catch {
    // Fall back to the local owner-only vault file.
  }
  if (!existsSync(NYRA_OWNER_IDENTITY_PRIVATE_PATH)) return undefined;
  return (JSON.parse(readFileSync(NYRA_OWNER_IDENTITY_PRIVATE_PATH, "utf8")) as NyraOwnerPrivateIdentity).private_fields.primary_email;
}

function parseIntervalMs(): number {
  const raw = process.env.NYRA_OWNER_MAIL_WORKER_INTERVAL_MS ?? "15000";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 3000) return 15000;
  return Math.round(parsed);
}

async function tick(config: OwnerMailBridgeConfig): Promise<void> {
  const result = await processOwnerMailAutonomousOutbox(config);
  if (result.processed > 0) {
    console.log(JSON.stringify({
      event: "nyra_owner_mail_worker_tick",
      processed: result.processed,
      sent: result.sent,
      blocked: result.blocked,
      failed: result.failed,
      at: new Date().toISOString(),
    }));
  }
}

async function main(): Promise<void> {
  const config: OwnerMailBridgeConfig = {
    ownerEmail: loadOwnerEmail(),
    rootDir: ROOT,
    env: {
      ...process.env,
      NYRA_OWNER_MAIL_AUTONOMOUS_SEND: process.env.NYRA_OWNER_MAIL_AUTONOMOUS_SEND ?? "true",
    },
  };
  const status = getOwnerMailBridgeStatus(config);
  console.log(JSON.stringify({
    event: "nyra_owner_mail_worker_started",
    owner_target_available: status.owner_target_available,
    delivery_mode: status.delivery_mode,
    autonomous_send_enabled: status.autonomous_send_enabled,
    autonomous_rate_limit_remaining: status.autonomous_rate_limit_remaining,
    at: new Date().toISOString(),
  }));

  await tick(config);
  if (process.argv.includes("--once")) return;

  const intervalMs = parseIntervalMs();
  setInterval(() => {
    tick(config).catch((error) => {
      console.error(JSON.stringify({
        event: "nyra_owner_mail_worker_error",
        message: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
      }));
    });
  }, intervalMs);
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: "nyra_owner_mail_worker_fatal",
    message: error instanceof Error ? error.message : String(error),
    at: new Date().toISOString(),
  }));
  process.exitCode = 1;
});

