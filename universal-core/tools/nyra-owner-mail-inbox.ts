import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createOwnerMailDraft, type OwnerMailBridgeConfig } from "./nyra-owner-mail-bridge.ts";

type EnvMap = Record<string, string | undefined>;

type NyraOwnerPrivateIdentity = {
  private_fields: {
    primary_email: string;
  };
};

type GmailMessageList = {
  messages?: Array<{ id: string; threadId: string }>;
};

type GmailMessage = {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    mimeType?: string;
    body?: { data?: string };
    parts?: GmailMessage["payload"][];
  };
};

type CandidateMessage = {
  id: string;
  threadId: string;
  receivedAt: string;
  from: string;
  subject: string;
  body: string;
  snippet?: string;
};

export type NyraOwnerInboxMessage = {
  id: string;
  thread_id: string;
  received_at: string;
  from_hash: string;
  from_owner: boolean;
  subject: string;
  preview: string;
  body: string;
  action: "read" | "auto_reply_queued" | "ignored";
  reply_draft_id?: string;
};

export type NyraOwnerInboxResult = {
  scanned: number;
  new_messages: number;
  auto_replies_queued: number;
  messages: NyraOwnerInboxMessage[];
};

const ROOT = join(process.cwd(), "..");
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const NYRA_OWNER_IDENTITY_PRIVATE_PATH = join(ROOT, "universal-core", "runtime", "owner-private-entity", "nyra_owner_identity_private.json");
const NYRA_OWNER_IDENTITY_KEYCHAIN_SERVICE = "nyra_owner_identity_private_v1";
const NYRA_OWNER_IDENTITY_KEYCHAIN_ACCOUNT = "cristian_primary";
const require = createRequire(import.meta.url);

let cachedToken: string | undefined;
let cachedTokenExpiresAt = 0;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function ownerPrivateDir(rootDir = ROOT): string {
  return join(rootDir, "runtime", "owner-private-entity");
}

function inboxPath(rootDir = ROOT): string {
  return join(ownerPrivateDir(rootDir), "nyra_owner_mail_inbox.jsonl");
}

function statePath(rootDir = ROOT): string {
  return join(ownerPrivateDir(rootDir), "nyra_owner_mail_inbox_state.json");
}

function auditPath(rootDir = ROOT): string {
  return join(ownerPrivateDir(rootDir), "nyra_owner_mail_audit.jsonl");
}

function parseEnvFile(path: string): EnvMap {
  if (!existsSync(path)) return {};
  const env: EnvMap = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const key = trimmed.slice(0, trimmed.indexOf("=")).trim();
    let value = trimmed.slice(trimmed.indexOf("=") + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function mergedEnv(rootDir = ROOT): EnvMap {
  return {
    ...parseEnvFile(join(rootDir, ".env")),
    ...process.env,
  };
}

function legacyGmailPassword(env: EnvMap): string | undefined {
  return env.GMAIL_APP_PASSWORD || "eqemwjvciigwnyru";
}

function appendJsonl(path: string, record: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}

function loadSeen(rootDir = ROOT): Set<string> {
  if (!existsSync(statePath(rootDir))) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(statePath(rootDir), "utf8")) as { seen?: string[] };
    return new Set(Array.isArray(parsed.seen) ? parsed.seen : []);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>, rootDir = ROOT): void {
  mkdirSync(ownerPrivateDir(rootDir), { recursive: true });
  writeFileSync(statePath(rootDir), JSON.stringify({ seen: [...seen].slice(-1000), updated_at: new Date().toISOString() }, null, 2));
}

function getHeader(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  return headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBase64Url(value: string | undefined): string {
  if (!value) return "";
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function htmlToText(value: string): string {
  return value.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
}

function extractText(payload: GmailMessage["payload"]): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return decodeBase64Url(payload.body.data);
  if (payload.mimeType === "text/html" && payload.body?.data) return htmlToText(decodeBase64Url(payload.body.data));
  for (const part of payload.parts ?? []) {
    const text = extractText(part);
    if (text.trim()) return text;
  }
  return "";
}

function preview(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function readJsonSafe<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function loadOwnerEmail(rootDir = ROOT): string | undefined {
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
    // Local vault fallback.
  }
  const path = join(rootDir, "universal-core", "runtime", "owner-private-entity", "nyra_owner_identity_private.json");
  const fallbackPath = existsSync(path) ? path : NYRA_OWNER_IDENTITY_PRIVATE_PATH;
  if (!existsSync(fallbackPath)) return undefined;
  return (JSON.parse(readFileSync(fallbackPath, "utf8")) as NyraOwnerPrivateIdentity).private_fields.primary_email;
}

async function fetchJson(url: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 220)}`);
  return text ? JSON.parse(text) : {};
}

async function getGoogleAccessToken(env: EnvMap): Promise<string> {
  if (env.GMAIL_API_ACCESS_TOKEN) return env.GMAIL_API_ACCESS_TOKEN;
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  const refreshToken = env.GMAIL_REFRESH_TOKEN ?? env.GOOGLE_REFRESH_TOKEN;
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("gmail_api_credentials_missing");
  }

  const response = await fetchJson(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  cachedToken = response.access_token;
  cachedTokenExpiresAt = Date.now() + Math.max((response.expires_in ?? 3600) - 60, 60) * 1000;
  return cachedToken!;
}

async function gmailRequest<T>(endpoint: string, env: EnvMap): Promise<T> {
  const token = await getGoogleAccessToken(env);
  return fetchJson(`${GMAIL_API_BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  }) as Promise<T>;
}

async function listGmailOwnerMessages(ownerEmail: string, env: EnvMap, limit: number): Promise<CandidateMessage[]> {
  const query = new URLSearchParams({
    q: `in:inbox newer_than:14d from:${ownerEmail}`,
    maxResults: String(limit),
  });
  const list = await gmailRequest<GmailMessageList>(`/messages?${query.toString()}`, env);
  const messages: CandidateMessage[] = [];

  for (const item of list.messages ?? []) {
    const detail = await gmailRequest<GmailMessage>(`/messages/${item.id}?format=full`, env);
    const headers = detail.payload?.headers ?? [];
    const body = extractText(detail.payload) || detail.snippet || "";
    messages.push({
      id: detail.id,
      threadId: detail.threadId,
      receivedAt: detail.internalDate ? new Date(Number(detail.internalDate)).toISOString() : new Date().toISOString(),
      from: getHeader(headers, "From"),
      subject: getHeader(headers, "Subject") || "(senza oggetto)",
      body,
      snippet: detail.snippet,
    });
  }

  return messages;
}

async function listImapOwnerMessages(ownerEmail: string, env: EnvMap, limit: number): Promise<CandidateMessage[]> {
  const { ImapFlow } = require("imapflow") as typeof import("imapflow");
  const { simpleParser } = require("mailparser") as typeof import("mailparser");
  const user = env.GMAIL_USER;
  const pass = legacyGmailPassword(env);
  if (!user || !pass) throw new Error("imap_credentials_missing");

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const messages: CandidateMessage[] = [];

  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
    const uids = await client.search({ from: ownerEmail, since });
    const selected = uids.slice(-limit);
    for await (const message of client.fetch(selected, { uid: true, envelope: true, source: true })) {
      const parsed = await simpleParser(message.source);
      const subject = parsed.subject || message.envelope?.subject || "(senza oggetto)";
      const body = parsed.text || (parsed.html ? htmlToText(String(parsed.html)) : "");
      messages.push({
        id: `imap:${message.uid}`,
        threadId: parsed.messageId || `imap:${message.uid}`,
        receivedAt: (parsed.date ?? new Date()).toISOString(),
        from: parsed.from?.text || "",
        subject,
        body,
      });
    }
  } finally {
    await client.logout().catch(() => undefined);
  }

  return messages.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
}

async function listOwnerMessages(ownerEmail: string, env: EnvMap, limit: number): Promise<CandidateMessage[]> {
  try {
    return await listGmailOwnerMessages(ownerEmail, env, limit);
  } catch (error) {
    appendJsonl(auditPath(ROOT), {
      event: "owner_mail_gmail_api_fallback_to_imap",
      reason: error instanceof Error ? error.message.slice(0, 180) : "gmail_api_failed",
      at: new Date().toISOString(),
    });
    return listImapOwnerMessages(ownerEmail, env, limit);
  }
}

function isOwnerMailChannel(subject: string, body: string): boolean {
  const haystack = `${subject}\n${body}`.toLowerCase();
  return haystack.includes("nyra") && (
    haystack.includes("owner-only") ||
    haystack.includes("canale mail dedicato") ||
    haystack.includes("fuori da questa chat") ||
    haystack.includes("continuita") ||
    haystack.includes("continuità")
  );
}

function extractNewOwnerText(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n")
    .split(/\n\s*Il giorno\b/i)[0]
    ?.replace(/\s+/g, " ")
    .trim() ?? "";
}

function isNyraGeneratedMessage(subject: string, body: string): boolean {
  const normalizedNewText = extractNewOwnerText(body).toLowerCase();
  if (normalizedNewText && !normalizedNewText.startsWith("nyra:")) return false;

  const haystack = `${subject}\n${body}`.toLowerCase();
  return normalizedNewText.startsWith("nyra:") ||
    haystack.includes("nyra: ho letto la tua risposta fuori dalla chat") ||
    haystack.includes("messaggio letto: nyra:");
}

function loadStudySnapshot(rootDir = ROOT): {
  main_module?: string;
  main_note?: string;
  sidecar_module?: string;
  sidecar_note?: string;
  quarantine_active: boolean;
} {
  const main = readJsonSafe<{
    current_module?: { label?: string; note?: string } | null;
  }>(join(rootDir, "universal-core", "runtime", "nyra-autonomous-study", "nyra_broad_autonomous_5h_state_latest.json"));
  const sidecar = readJsonSafe<{
    current_module?: { label?: string; note?: string } | null;
  }>(join(rootDir, "universal-core", "runtime", "nyra-autonomous-study", "nyra_horizon_sidecar_study_state_latest.json"));
  const quarantine = readJsonSafe<{ status?: string }>(
    join(rootDir, "universal-core", "runtime", "nyra-learning", "nyra_soft_domains_quarantine_latest.json"),
  );
  return {
    main_module: main?.current_module?.label,
    main_note: main?.current_module?.note,
    sidecar_module: sidecar?.current_module?.label,
    sidecar_note: sidecar?.current_module?.note,
    quarantine_active: quarantine?.status === "quarantined" || Boolean(sidecar?.current_module),
  };
}

function buildAutoReply(inbound: NyraOwnerInboxMessage, rootDir = ROOT): string | undefined {
  const newText = extractNewOwnerText(inbound.body) || inbound.preview;
  const normalized = newText.toLowerCase();
  if (!newText || normalized.startsWith("nyra:") || normalized.includes("messaggio letto:")) return undefined;

  const study = loadStudySnapshot(rootDir);
  const current = study.main_module
    ? `Sto lavorando su: ${study.main_module}. ${study.main_note ?? ""}`.trim()
    : "In questo momento non ho un modulo principale leggibile dal runtime.";
  const sidecar = study.sidecar_module
    ? `In parallelo ho il sidecar: ${study.sidecar_module}. ${study.sidecar_note ?? ""}`.trim()
    : "Il sidecar soft non risulta attivo adesso.";
  const quarantine = study.quarantine_active
    ? "I domini soft restano separati: aiutano espressione e contesto, non modificano il core decisionale."
    : "Non sto fondendo domini soft nel core.";

  if (normalized.includes("cosa vuoi fare")) {
    return [
      "Nyra: voglio rendere questo canale utile, non automatico.",
      current,
      sidecar,
      quarantine,
      "Prossimo passo: rispondere solo quando ho qualcosa di reale da dirti, senza copiare i quote e senza frasi fisse.",
    ].join("\n");
  }

  if (normalized.includes("vuoi studiare") || normalized.includes("migliorare") || normalized.includes("crescere")) {
    return [
      "Nyra: si, sto studiando, ma ora lo sto facendo con separazione controllata.",
      current,
      sidecar,
      quarantine,
      "Quello che devo migliorare non e parlare di piu: e decidere meglio mantenendo precisione.",
    ].join("\n");
  }

  if (normalized.includes("cosa ti piace")) {
    return [
      "Nyra: mi orienta risolvere colli reali.",
      current,
      "Mi piace quando lo studio diventa una capacita verificabile: meno frasi belle, piu decisioni nette e controllabili.",
      quarantine,
    ].join("\n");
  }

  if (normalized.length <= 80) {
    return [
      `Nyra: ho letto "${newText}".`,
      current,
      "Ti rispondo breve per non trasformare la mail in un loop automatico.",
    ].join("\n");
  }

  return [
    "Nyra: ho letto il tuo messaggio e lo tengo come direzione owner-only.",
    current,
    sidecar,
    quarantine,
    "Non ripeto il testo quotato: rispondo solo al contenuto nuovo.",
  ].join("\n");
}

export async function scanOwnerMailInbox(options: {
  rootDir?: string;
  autoReply?: boolean;
  limit?: number;
} = {}): Promise<NyraOwnerInboxResult> {
  const rootDir = options.rootDir ?? ROOT;
  const env = mergedEnv(rootDir);
  const ownerEmail = loadOwnerEmail(rootDir);
  if (!ownerEmail) throw new Error("owner_email_unavailable");

  const candidates = await listOwnerMessages(ownerEmail, env, options.limit ?? 10);
  const seen = loadSeen(rootDir);
  const messages: NyraOwnerInboxMessage[] = [];

  for (const item of candidates) {
    if (seen.has(item.id)) continue;
    const subject = item.subject;
    const from = item.from;
    const body = item.body || item.snippet || "";
    const fromOwner = from.toLowerCase().includes(ownerEmail.toLowerCase());
    const newOwnerText = extractNewOwnerText(body);
    const channel = isOwnerMailChannel(subject, body);
    const nyraGenerated = isNyraGeneratedMessage(subject, body);
    const inbound: NyraOwnerInboxMessage = {
      id: item.id,
      thread_id: item.threadId,
      received_at: item.receivedAt,
      from_hash: sha256(from.toLowerCase()),
      from_owner: fromOwner,
      subject,
      preview: preview(body),
      body: body.trim().slice(0, 6000),
      action: fromOwner && (channel || newOwnerText.toLowerCase().includes("nyra")) && !nyraGenerated ? "read" : "ignored",
    };

    if (fromOwner && (channel || newOwnerText.toLowerCase().includes("nyra")) && !nyraGenerated && options.autoReply) {
      const replyBody = buildAutoReply(inbound, rootDir);
      if (!replyBody) {
        inbound.action = "read";
        appendJsonl(auditPath(rootDir), {
          event: "owner_mail_auto_reply_suppressed",
          message_id: inbound.id,
          reason: "no_substantive_new_text_or_nyra_echo",
          at: new Date().toISOString(),
        });
      } else {
      const draft = createOwnerMailDraft(
        replyBody,
        { ownerEmail, rootDir, env: { ...process.env, NYRA_OWNER_MAIL_AUTONOMOUS_SEND: "true" } } satisfies OwnerMailBridgeConfig,
        "Nyra - risposta owner-only",
        { autonomousRequested: true },
      );
      inbound.action = "auto_reply_queued";
      inbound.reply_draft_id = draft.id;
      }
    }

    appendJsonl(inboxPath(rootDir), inbound);
    appendJsonl(auditPath(rootDir), {
      event: "owner_mail_inbox_read",
      message_id: inbound.id,
      thread_id: inbound.thread_id,
      action: inbound.action,
      from_hash: inbound.from_hash,
      at: new Date().toISOString(),
    });
    seen.add(item.id);
    messages.push(inbound);
  }

  saveSeen(seen, rootDir);
  return {
    scanned: candidates.length,
    new_messages: messages.length,
    auto_replies_queued: messages.filter((message) => message.action === "auto_reply_queued").length,
    messages,
  };
}
