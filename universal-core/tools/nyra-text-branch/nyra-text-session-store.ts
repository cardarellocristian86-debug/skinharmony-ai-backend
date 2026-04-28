import fs from "node:fs/promises";
import path from "node:path";
import type { NyraTextOutput } from "./nyra-text-types.ts";
import type { NyraTextRoute } from "./nyra-text-domain-router.ts";

export interface NyraTextSessionTurn {
  input: string;
  outputPreview: string;
  actor?: string;
  primary?: string;
  secondary?: string[];
  risk: string;
  timestamp: number;
}

export interface NyraTextSession {
  id: string;
  ownerId: string;
  turns: NyraTextSessionTurn[];
  createdAt: number;
  updatedAt: number;
}

function storagePath(...parts: string[]): string {
  const storageRoot = process.env.NYRA_STORAGE_ROOT?.trim();
  if (storageRoot) return path.join(storageRoot, ...parts);
  return path.join(process.cwd(), ...parts);
}

const ROOT = storagePath("universal-core", "runtime", "nyra", "text-sessions");

function sessionPath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return path.join(ROOT, `${safe}.json`);
}

export function createSessionId(): string {
  return `session_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 6)}`;
}

export async function readSession(sessionId: string, ownerId = "owner"): Promise<NyraTextSession> {
  try {
    const raw = await fs.readFile(sessionPath(sessionId), "utf8");
    return JSON.parse(raw) as NyraTextSession;
  } catch {
    const now = Date.now();
    return { id: sessionId, ownerId, turns: [], createdAt: now, updatedAt: now };
  }
}

export async function writeSession(session: NyraTextSession): Promise<void> {
  await fs.mkdir(ROOT, { recursive: true });
  session.updatedAt = Date.now();
  await fs.writeFile(sessionPath(session.id), JSON.stringify(session, null, 2), "utf8");
}

export async function appendSessionTurn(params: {
  sessionId: string;
  ownerId: string;
  input: string;
  output: NyraTextOutput;
  route?: NyraTextRoute;
}): Promise<void> {
  const session = await readSession(params.sessionId, params.ownerId);
  session.turns.push({
    input: params.input,
    outputPreview: params.output.content.slice(0, 500),
    actor: params.output.actor,
    primary: params.route?.primary ?? params.output.route?.primary,
    secondary: params.route?.secondary ?? params.output.route?.secondary,
    risk: params.output.risk,
    timestamp: Date.now(),
  });
  session.turns = session.turns.slice(-80);
  await writeSession(session);
}

export async function clearSession(sessionId: string, ownerId = "owner"): Promise<void> {
  const now = Date.now();
  await writeSession({ id: sessionId, ownerId, turns: [], createdAt: now, updatedAt: now });
}

export async function renderSession(sessionId: string, ownerId = "owner"): Promise<string> {
  const session = await readSession(sessionId, ownerId);
  const turns = session.turns.slice(-12).map((turn, index) => [
    `${index + 1}. ${turn.primary ?? "unknown"} / ${turn.actor ?? "unknown"} / ${turn.risk}`,
    `   in: ${turn.input.slice(0, 120)}`,
    `   out: ${turn.outputPreview.slice(0, 120)}`,
  ].join("\n"));

  return [
    `Sessione: ${session.id}`,
    `Turni: ${session.turns.length}`,
    "",
    turns.length ? turns.join("\n\n") : "Nessun turno.",
  ].join("\n");
}
