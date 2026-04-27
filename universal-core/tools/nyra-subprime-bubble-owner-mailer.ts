import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getOwnerMailBridgeStatus,
  sendOwnerMailAutonomously,
  type OwnerMailBridgeConfig,
  type OwnerMailSendResult,
} from "./nyra-owner-mail-bridge.ts";
import {
  buildNyraFinancialAlertBody,
  buildNyraFinancialAlertSubject,
} from "./nyra-financial-output-layer.ts";
import {
  runNyraSubprimeBubbleGodModeReplay,
  type NyraSubprimeBubbleGodModeReport,
} from "../tests/nyra-subprime-bubble-god-mode-test.ts";

type NyraOwnerPrivateIdentity = {
  private_fields: {
    primary_email: string;
  };
};

type MailCheckpointResult = {
  date: string;
  alert_level: string;
  subject: string;
  ok: boolean;
  mode: string;
  reason?: string;
  provider_message_id?: string;
  draft_id: string;
};

type MailerReport = {
  generated_at: string;
  runner: "nyra_subprime_bubble_owner_mailer";
  replay_report_path: string;
  bridge_status: ReturnType<typeof getOwnerMailBridgeStatus>;
  sent_count: number;
  failed_count: number;
  checkpoints: MailCheckpointResult[];
};

const ROOT = process.cwd();
const OWNER_IDENTITY_PRIVATE_PATH = join(ROOT, "universal-core", "runtime", "owner-private-entity", "nyra_owner_identity_private.json");
const REPORT_DIR = join(ROOT, "reports", "universal-core", "financial-core-test");
const REPORT_PATH = join(REPORT_DIR, "nyra_subprime_bubble_owner_mailer_latest.json");
const OWNER_IDENTITY_KEYCHAIN_SERVICE = "nyra_owner_identity_private_v1";
const OWNER_IDENTITY_KEYCHAIN_ACCOUNT = "cristian_primary";

function loadOwnerEmail(): string | undefined {
  try {
    const raw = execFileSync(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-a",
        OWNER_IDENTITY_KEYCHAIN_ACCOUNT,
        "-s",
        OWNER_IDENTITY_KEYCHAIN_SERVICE,
        "-w",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (raw) return (JSON.parse(raw) as NyraOwnerPrivateIdentity).private_fields.primary_email;
  } catch {
    // fall through to local owner-only file
  }

  if (!existsSync(OWNER_IDENTITY_PRIVATE_PATH)) return undefined;
  return (JSON.parse(readFileSync(OWNER_IDENTITY_PRIVATE_PATH, "utf8")) as NyraOwnerPrivateIdentity).private_fields.primary_email;
}

async function sendCheckpointMail(
  checkpoint: NyraSubprimeBubbleGodModeReport["checkpoints"][number],
  report: NyraSubprimeBubbleGodModeReport,
  config: OwnerMailBridgeConfig,
): Promise<MailCheckpointResult> {
  const subject = buildNyraFinancialAlertSubject(checkpoint);
  const body = buildNyraFinancialAlertBody(checkpoint, {
    scenarioLabel: "bolla mutui USA pre-crash",
    modeLabel: report.mode,
  });
  const result: OwnerMailSendResult = await sendOwnerMailAutonomously(body, config, subject);
  return {
    date: checkpoint.date,
    alert_level: checkpoint.alert_level,
    subject,
    ok: result.ok,
    mode: result.mode,
    reason: result.reason,
    provider_message_id: result.provider_message_id,
    draft_id: result.draft.id,
  };
}

async function main(): Promise<void> {
  const report = runNyraSubprimeBubbleGodModeReplay();
  const ownerEmail = loadOwnerEmail();
  const config: OwnerMailBridgeConfig = {
    ownerEmail,
    rootDir: ROOT,
    env: {
      ...process.env,
      NYRA_OWNER_MAIL_AUTONOMOUS_SEND: "true",
    },
  };
  const bridgeStatus = getOwnerMailBridgeStatus(config);
  const checkpointsToSend = report.checkpoints.filter((checkpoint) => checkpoint.alert_level !== "none");

  const results: MailCheckpointResult[] = [];
  for (const checkpoint of checkpointsToSend) {
    results.push(await sendCheckpointMail(checkpoint, report, config));
  }

  const mailerReport: MailerReport = {
    generated_at: new Date().toISOString(),
    runner: "nyra_subprime_bubble_owner_mailer",
    replay_report_path: join(REPORT_DIR, "nyra_subprime_bubble_god_mode_latest.json"),
    bridge_status: bridgeStatus,
    sent_count: results.filter((entry) => entry.ok).length,
    failed_count: results.filter((entry) => !entry.ok).length,
    checkpoints: results,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(mailerReport, null, 2));
  console.log(JSON.stringify(mailerReport, null, 2));
}

main().catch((error) => {
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify({
    generated_at: new Date().toISOString(),
    runner: "nyra_subprime_bubble_owner_mailer",
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  throw error;
});
