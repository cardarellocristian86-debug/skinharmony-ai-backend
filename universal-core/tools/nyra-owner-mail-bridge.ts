import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

export type OwnerMailBridgeStatus = {
  owner_target_available: boolean;
  smtp_available: boolean;
  legacy_gmail_available: boolean;
  autonomous_send_enabled: boolean;
  autonomous_rate_limit_remaining: number;
  delivery_mode: "draft_only" | "owner_confirmed_smtp" | "owner_autonomous_smtp";
  outbox_path: string;
  policy: {
    scope: "nyra_to_owner_only";
    recipient_lock: "owner_primary_email_only";
    user_recipients_allowed: false;
    send_requires_owner_confirmation: boolean;
    autonomous_send_allowed_to_owner: boolean;
    autonomous_hourly_limit: number;
    expose_owner_email_in_chat: false;
  };
};

export type OwnerMailDraft = {
  id: string;
  created_at: string;
  to_hash: string;
  to_label: "owner_primary_email";
  subject: string;
  body: string;
  status: "draft" | "sent" | "blocked" | "failed";
  autonomous_requested?: boolean;
  reason?: string;
};

export type OwnerMailSendResult = {
  ok: boolean;
  mode: "sent" | "draft_only" | "blocked" | "failed";
  draft: OwnerMailDraft;
  reason?: string;
  provider_message_id?: string;
};

export type OwnerMailBridgeConfig = {
  ownerEmail?: string;
  rootDir?: string;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
};

export type OwnerMailDraftOptions = {
  autonomousRequested?: boolean;
};

export type OwnerMailOutboxProcessResult = {
  processed: number;
  sent: number;
  blocked: number;
  failed: number;
  results: OwnerMailSendResult[];
};

const DEFAULT_SUBJECT = "Nyra - messaggio owner-only";
const DEFAULT_AUTONOMOUS_HOURLY_LIMIT = 120;
const require = createRequire(import.meta.url);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bridgeRoot(rootDir?: string): string {
  return rootDir ?? join(process.cwd(), "..");
}

function outboxPath(rootDir?: string): string {
  return join(bridgeRoot(rootDir), "runtime", "owner-private-entity", "nyra_owner_mail_outbox.jsonl");
}

function auditPath(rootDir?: string): string {
  return join(bridgeRoot(rootDir), "runtime", "owner-private-entity", "nyra_owner_mail_audit.jsonl");
}

function legacyGmailSenderPath(rootDir?: string): string {
  return join(bridgeRoot(rootDir), "mail", "send_email.js");
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeSubject(value: string | undefined): string {
  const subject = compactWhitespace(value ?? "");
  return (subject || DEFAULT_SUBJECT).slice(0, 120);
}

function sanitizeBody(value: string): string {
  return value.trim().slice(0, 6000);
}

function appendJsonl(path: string, record: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}

function boolEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function autonomousHourlyLimit(config: OwnerMailBridgeConfig = {}): number {
  const env = config.env ?? process.env;
  const parsed = Number(env.NYRA_OWNER_MAIL_AUTONOMOUS_HOURLY_LIMIT);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_AUTONOMOUS_HOURLY_LIMIT;
  return Math.min(Math.round(parsed), 500);
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function rewriteDraft(path: string, updated: OwnerMailDraft): void {
  if (!existsSync(path)) {
    appendJsonl(path, updated);
    return;
  }
  const records = readFileSync(path, "utf8")
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OwnerMailDraft)
    .map((draft) => draft.id === updated.id ? updated : draft);
  if (!records.some((draft) => draft.id === updated.id)) records.push(updated);
  writeFileSync(path, `${records.map((draft) => JSON.stringify(draft)).join("\n")}\n`);
}

function readLatestDraft(path: string): OwnerMailDraft | undefined {
  if (!existsSync(path)) return undefined;
  const records = readFileSync(path, "utf8")
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OwnerMailDraft)
    .filter((draft) => draft.status === "draft");
  return records.at(-1);
}

export function getOwnerMailBridgeStatus(config: OwnerMailBridgeConfig = {}): OwnerMailBridgeStatus {
  const env = config.env ?? process.env;
  const smtpAvailable = Boolean(
    env.NYRA_OWNER_MAIL_SMTP_HOST &&
    env.NYRA_OWNER_MAIL_SMTP_PORT &&
    env.NYRA_OWNER_MAIL_SMTP_USER &&
    env.NYRA_OWNER_MAIL_SMTP_PASS &&
    env.NYRA_OWNER_MAIL_FROM,
  );
  const legacyGmailAvailable = existsSync(legacyGmailSenderPath(config.rootDir));
  const providerAvailable = smtpAvailable || legacyGmailAvailable;
  const autonomousEnabled = providerAvailable && Boolean(config.ownerEmail) && boolEnv(env.NYRA_OWNER_MAIL_AUTONOMOUS_SEND);
  const hourlyLimit = autonomousHourlyLimit(config);
  const autonomousRateLimitRemaining = Math.max(0, hourlyLimit - countRecentAutonomousSends(config));

  return {
    owner_target_available: Boolean(config.ownerEmail),
    smtp_available: smtpAvailable,
    legacy_gmail_available: legacyGmailAvailable,
    autonomous_send_enabled: autonomousEnabled,
    autonomous_rate_limit_remaining: autonomousRateLimitRemaining,
    delivery_mode: providerAvailable
      ? autonomousEnabled ? "owner_autonomous_smtp" : "owner_confirmed_smtp"
      : "draft_only",
    outbox_path: outboxPath(config.rootDir),
    policy: {
      scope: "nyra_to_owner_only",
      recipient_lock: "owner_primary_email_only",
      user_recipients_allowed: false,
      send_requires_owner_confirmation: !autonomousEnabled,
      autonomous_send_allowed_to_owner: autonomousEnabled,
      autonomous_hourly_limit: hourlyLimit,
      expose_owner_email_in_chat: false,
    },
  };
}

function countRecentAutonomousSends(config: OwnerMailBridgeConfig = {}): number {
  const now = config.now?.() ?? new Date();
  const hourAgo = now.getTime() - 60 * 60 * 1000;
  return readJsonl<{ event?: string; at?: string }>(auditPath(config.rootDir))
    .filter((entry) => entry.event === "autonomous_sent")
    .filter((entry) => {
      const at = entry.at ? new Date(entry.at).getTime() : 0;
      return Number.isFinite(at) && at >= hourAgo;
    })
    .length;
}

export function createOwnerMailDraft(
  message: string,
  config: OwnerMailBridgeConfig = {},
  subject?: string,
  options: OwnerMailDraftOptions = {},
): OwnerMailDraft {
  const now = config.now?.() ?? new Date();
  const ownerEmail = config.ownerEmail?.trim();
  const draft: OwnerMailDraft = {
    id: `nyra-mail:${now.getTime()}:${sha256(message).slice(0, 10)}`,
    created_at: now.toISOString(),
    to_hash: ownerEmail ? sha256(ownerEmail.toLowerCase()) : "owner_email_unavailable",
    to_label: "owner_primary_email",
    subject: sanitizeSubject(subject),
    body: sanitizeBody(message),
    status: ownerEmail ? "draft" : "blocked",
    autonomous_requested: options.autonomousRequested || undefined,
    reason: ownerEmail ? undefined : "owner_email_unavailable",
  };
  appendJsonl(outboxPath(config.rootDir), draft);
  appendJsonl(auditPath(config.rootDir), {
    event: "draft_created",
    draft_id: draft.id,
    created_at: draft.created_at,
    status: draft.status,
    to_hash: draft.to_hash,
  });
  return draft;
}

export function getLatestPendingOwnerMailDraft(config: OwnerMailBridgeConfig = {}): OwnerMailDraft | undefined {
  return readLatestDraft(outboxPath(config.rootDir));
}

export async function sendOwnerMailDraft(
  draft: OwnerMailDraft,
  config: OwnerMailBridgeConfig = {},
): Promise<OwnerMailSendResult> {
  const status = getOwnerMailBridgeStatus(config);
  const ownerEmail = config.ownerEmail?.trim();
  const path = outboxPath(config.rootDir);
  const audit = auditPath(config.rootDir);

  if (!ownerEmail) {
    const blocked = { ...draft, status: "blocked" as const, reason: "owner_email_unavailable" };
    rewriteDraft(path, blocked);
    appendJsonl(audit, { event: "send_blocked", draft_id: draft.id, reason: blocked.reason, at: new Date().toISOString() });
    return { ok: false, mode: "blocked", draft: blocked, reason: blocked.reason };
  }

  if (!status.smtp_available && !status.legacy_gmail_available) {
    appendJsonl(audit, { event: "send_not_available", draft_id: draft.id, reason: "smtp_not_configured", at: new Date().toISOString() });
    return { ok: false, mode: "draft_only", draft, reason: "smtp_not_configured" };
  }

  try {
    if (!status.smtp_available && status.legacy_gmail_available) {
      const sendEmail = require(legacyGmailSenderPath(config.rootDir)) as (
        to: string,
        subject: string,
        text: string,
        options?: Record<string, unknown>,
      ) => Promise<{ messageId?: string; response?: string }>;
      const result = await sendEmail(ownerEmail, draft.subject, draft.body);
      const sent = { ...draft, status: "sent" as const };
      rewriteDraft(path, sent);
      appendJsonl(audit, {
        event: "sent",
        provider: "legacy_gmail",
        draft_id: draft.id,
        at: new Date().toISOString(),
        to_hash: draft.to_hash,
        provider_message_id: result.messageId ?? result.response,
      });
      return { ok: true, mode: "sent", draft: sent, provider_message_id: result.messageId ?? result.response };
    }

    const nodemailer = await import("nodemailer");
    const env = config.env ?? process.env;
    const transporter = nodemailer.default.createTransport({
      host: env.NYRA_OWNER_MAIL_SMTP_HOST,
      port: Number(env.NYRA_OWNER_MAIL_SMTP_PORT),
      secure: env.NYRA_OWNER_MAIL_SMTP_SECURE === "true" || env.NYRA_OWNER_MAIL_SMTP_PORT === "465",
      auth: {
        user: env.NYRA_OWNER_MAIL_SMTP_USER,
        pass: env.NYRA_OWNER_MAIL_SMTP_PASS,
      },
    });
    const result = await transporter.sendMail({
      from: env.NYRA_OWNER_MAIL_FROM,
      to: ownerEmail,
      subject: draft.subject,
      text: draft.body,
    });
    const sent = { ...draft, status: "sent" as const };
    rewriteDraft(path, sent);
    appendJsonl(audit, {
      event: "sent",
      draft_id: draft.id,
      at: new Date().toISOString(),
      to_hash: draft.to_hash,
      provider_message_id: result.messageId,
    });
    return { ok: true, mode: "sent", draft: sent, provider_message_id: result.messageId };
  } catch (error) {
    const failed = {
      ...draft,
      status: "failed" as const,
      reason: error instanceof Error ? error.message.slice(0, 220) : "send_failed",
    };
    rewriteDraft(path, failed);
    appendJsonl(audit, { event: "send_failed", draft_id: draft.id, reason: failed.reason, at: new Date().toISOString() });
    return { ok: false, mode: "failed", draft: failed, reason: failed.reason };
  }
}

export async function sendOwnerMailAutonomously(
  message: string,
  config: OwnerMailBridgeConfig = {},
  subject?: string,
): Promise<OwnerMailSendResult> {
  const draft = createOwnerMailDraft(message, config, subject, { autonomousRequested: true });
  const status = getOwnerMailBridgeStatus(config);
  const audit = auditPath(config.rootDir);

  if (draft.status === "blocked") {
    return { ok: false, mode: "blocked", draft, reason: draft.reason };
  }

  if (!status.autonomous_send_enabled) {
    appendJsonl(audit, {
      event: "autonomous_blocked",
      draft_id: draft.id,
      reason: status.smtp_available || status.legacy_gmail_available ? "autonomous_send_not_enabled" : "smtp_not_configured",
      at: (config.now?.() ?? new Date()).toISOString(),
    });
    return {
      ok: false,
      mode: status.smtp_available || status.legacy_gmail_available ? "blocked" : "draft_only",
      draft,
      reason: status.smtp_available || status.legacy_gmail_available ? "autonomous_send_not_enabled" : "smtp_not_configured",
    };
  }

  if (status.autonomous_rate_limit_remaining <= 0) {
    appendJsonl(audit, {
      event: "autonomous_blocked",
      draft_id: draft.id,
      reason: "autonomous_rate_limit_reached",
      at: (config.now?.() ?? new Date()).toISOString(),
    });
    return { ok: false, mode: "blocked", draft, reason: "autonomous_rate_limit_reached" };
  }

  const result = await sendOwnerMailDraft(draft, config);
  if (result.ok) {
    appendJsonl(audit, {
      event: "autonomous_sent",
      draft_id: draft.id,
      at: (config.now?.() ?? new Date()).toISOString(),
      to_hash: draft.to_hash,
      provider_message_id: result.provider_message_id,
    });
  }
  return result;
}

export async function processOwnerMailAutonomousOutbox(
  config: OwnerMailBridgeConfig = {},
): Promise<OwnerMailOutboxProcessResult> {
  const path = outboxPath(config.rootDir);
  const audit = auditPath(config.rootDir);
  const status = getOwnerMailBridgeStatus(config);
  const drafts = readJsonl<OwnerMailDraft>(path)
    .filter((draft) => draft.status === "draft")
    .filter((draft) => draft.autonomous_requested === true);

  const results: OwnerMailSendResult[] = [];
  for (const draft of drafts) {
    const currentStatus = getOwnerMailBridgeStatus(config);
    if (!currentStatus.autonomous_send_enabled) {
      appendJsonl(audit, {
        event: "autonomous_worker_blocked",
        draft_id: draft.id,
        reason: currentStatus.smtp_available || currentStatus.legacy_gmail_available
          ? "autonomous_send_not_enabled"
          : "smtp_not_configured",
        at: (config.now?.() ?? new Date()).toISOString(),
      });
      results.push({
        ok: false,
        mode: currentStatus.smtp_available || currentStatus.legacy_gmail_available ? "blocked" : "draft_only",
        draft,
        reason: currentStatus.smtp_available || currentStatus.legacy_gmail_available
          ? "autonomous_send_not_enabled"
          : "smtp_not_configured",
      });
      continue;
    }
    if (currentStatus.autonomous_rate_limit_remaining <= 0) {
      appendJsonl(audit, {
        event: "autonomous_worker_blocked",
        draft_id: draft.id,
        reason: "autonomous_rate_limit_reached",
        at: (config.now?.() ?? new Date()).toISOString(),
      });
      results.push({ ok: false, mode: "blocked", draft, reason: "autonomous_rate_limit_reached" });
      continue;
    }
    const result = await sendOwnerMailDraft(draft, config);
    if (result.ok) {
      appendJsonl(audit, {
        event: "autonomous_sent",
        source: "worker",
        draft_id: draft.id,
        at: (config.now?.() ?? new Date()).toISOString(),
        to_hash: draft.to_hash,
        provider_message_id: result.provider_message_id,
      });
    }
    results.push(result);
  }

  return {
    processed: results.length,
    sent: results.filter((result) => result.ok).length,
    blocked: results.filter((result) => !result.ok && result.mode === "blocked").length,
    failed: results.filter((result) => !result.ok && result.mode === "failed").length,
    results,
  };
}
