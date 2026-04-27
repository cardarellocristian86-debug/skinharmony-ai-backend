import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import {
  sendOwnerMailAutonomously,
  type OwnerMailBridgeConfig,
} from "./nyra-owner-mail-bridge.ts";

type RunnerState = {
  status: "running" | "completed" | "failed";
  started_at?: string;
  ends_at?: string;
  finished_at?: string;
  completed_modules?: number;
  total_minutes?: number;
  current_module?: { id: string; label: string } | null;
  report_path?: string;
  error?: string;
};

type NyraOwnerPrivateIdentity = {
  private_fields: {
    primary_email: string;
  };
};

const ROOT = join(process.cwd(), "..");
const WORKSPACE_ROOT = ROOT;
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "nyra-autonomous-study");
const OWNER_RUNTIME_DIR = join(ROOT, "runtime", "owner-private-entity");
const LEARNING_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const REPORTS_DIR = join(ROOT, "universal-core", "reports", "universal-core", "nyra-learning");
const STATE_PATH = join(RUNTIME_DIR, "nyra_broad_autonomous_5h_state_latest.json");
const SENT_MARKER_PATH = join(RUNTIME_DIR, "nyra_broad_autonomous_5h_completion_mail_sent.json");
const BUNDLE_DIR = join(RUNTIME_DIR, "handoff-bundles");
const OWNER_IDENTITY_PRIVATE_PATH = join(ROOT, "universal-core", "runtime", "owner-private-entity", "nyra_owner_identity_private.json");
const OWNER_IDENTITY_KEYCHAIN_SERVICE = "nyra_owner_identity_private_v1";
const OWNER_IDENTITY_KEYCHAIN_ACCOUNT = "cristian_primary";

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function tryReadJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return readJson<T>(path);
}

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
    // Fall back to the local owner-only vault file.
  }
  if (!existsSync(OWNER_IDENTITY_PRIVATE_PATH)) return undefined;
  return readJson<NyraOwnerPrivateIdentity>(OWNER_IDENTITY_PRIVATE_PATH).private_fields.primary_email;
}

function sha256File(path: string): string {
  return execFileSync("/usr/bin/shasum", ["-a", "256", path], { encoding: "utf8" }).split(/\s+/)[0] ?? "";
}

function safeStat(path: string): { bytes: number; sha256: string } | undefined {
  if (!existsSync(path)) return undefined;
  const bytes = Number(execFileSync("/usr/bin/stat", ["-f", "%z", path], { encoding: "utf8" }).trim());
  return { bytes, sha256: sha256File(path) };
}

function createHandoffBundle(state: RunnerState): { path: string; bytes: number; sha256: string; entries: string[] } {
  mkdirSync(BUNDLE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const manifestPath = join(BUNDLE_DIR, `nyra_5h_repo_handoff_manifest_${stamp}.json`);
  const archivePath = join(BUNDLE_DIR, `nyra_5h_repo_handoff_${stamp}.tar.gz`);
  const entries = [
    "universal-core/tools/nyra_broad_autonomous_5h.ts",
    "universal-core/config/nyra_web_study_sources_v2.json",
    "universal-core/runtime/nyra-autonomous-study/nyra_broad_autonomous_5h_state_latest.json",
    "universal-core/runtime/nyra-autonomous-study/nyra_broad_autonomous_5h_log.jsonl",
    "universal-core/runtime/nyra-learning/nyra_work_liquidity_scenarios_latest.json",
    "universal-core/runtime/nyra-learning/nyra_web_explore_latest.json",
    "universal-core/reports/universal-core/nyra-learning/nyra_broad_autonomous_5h_latest.json",
    "universal-core/launchd/com.nyra.broad-autonomous-5h.plist",
    "universal-core/launchd/com.nyra.broad-autonomous-5h-watchdog.plist",
  ].filter((entry) => existsSync(join(WORKSPACE_ROOT, entry)));

  const manifest = {
    generated_at: nowIso(),
    workspace_root: WORKSPACE_ROOT,
    runner_state: state,
    report_path: state.report_path,
    entries,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  execFileSync("/usr/bin/tar", ["-czf", archivePath, basename(manifestPath), ...entries], {
    cwd: WORKSPACE_ROOT,
    stdio: "ignore",
  });

  const stat = safeStat(archivePath)!;
  return { path: archivePath, bytes: stat.bytes, sha256: stat.sha256, entries: [basename(manifestPath), ...entries] };
}

function buildBody(state: RunnerState, bundle: { path: string; bytes: number; sha256: string; entries: string[] }): string {
  const report = state.report_path && existsSync(state.report_path)
    ? tryReadJson<{ modules_completed?: number; total_minutes?: number; final_metrics?: Record<string, unknown>; work_liquidity_scenario_path?: string }>(state.report_path)
    : undefined;
  const scenariosPath = join(LEARNING_DIR, "nyra_work_liquidity_scenarios_latest.json");
  const scenarios = tryReadJson<{ scenario_count?: number; stable_rules?: string[] }>(scenariosPath);
  const reportStat = state.report_path ? safeStat(state.report_path) : undefined;

  return [
    "Nyra: ciclo 5h completato.",
    "",
    `Stato: ${state.status}`,
    `Inizio: ${state.started_at ?? "n/d"}`,
    `Fine: ${state.finished_at ?? nowIso()}`,
    `Moduli completati: ${report?.modules_completed ?? state.completed_modules ?? "n/d"}`,
    `Durata prevista minuti: ${report?.total_minutes ?? state.total_minutes ?? "n/d"}`,
    "",
    "Repo/bundle owner-only:",
    `Percorso workspace: ${WORKSPACE_ROOT}`,
    `Bundle locale: ${bundle.path}`,
    `Bundle bytes: ${bundle.bytes}`,
    `Bundle sha256: ${bundle.sha256}`,
    `File inclusi: ${bundle.entries.length}`,
    "",
    "Report:",
    `Report path: ${state.report_path ?? "n/d"}`,
    `Report bytes: ${reportStat?.bytes ?? "n/d"}`,
    `Report sha256: ${reportStat?.sha256 ?? "n/d"}`,
    `Scenari lavoro/liquidita: ${scenarios?.scenario_count ?? "n/d"}`,
    "",
    "Regole assimilate:",
    ...(scenarios?.stable_rules ?? []).map((rule) => `- ${rule}`),
    "",
    "Nota: non prometto guadagni. Ti mando priorita, scenario, rischio e primo passo verificabile.",
  ].join("\n");
}

async function sendCompletionMail(state: RunnerState): Promise<void> {
  if (existsSync(SENT_MARKER_PATH)) return;
  const bundle = createHandoffBundle(state);
  const config: OwnerMailBridgeConfig = {
    ownerEmail: loadOwnerEmail(),
    rootDir: ROOT,
    env: {
      ...process.env,
      NYRA_OWNER_MAIL_AUTONOMOUS_SEND: "true",
    },
  };
  const result = await sendOwnerMailAutonomously(
    buildBody(state, bundle),
    config,
    "Nyra - repo e report ciclo 5h completato",
  );
  writeFileSync(SENT_MARKER_PATH, JSON.stringify({
    generated_at: nowIso(),
    mail_ok: result.ok,
    mail_mode: result.mode,
    draft_id: result.draft.id,
    provider_message_id: result.provider_message_id,
    reason: result.reason,
    bundle,
  }, null, 2));
}

async function main(): Promise<void> {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(OWNER_RUNTIME_DIR, { recursive: true });
  const timeoutAt = Date.now() + 7 * 60 * 60 * 1000;

  while (Date.now() < timeoutAt) {
    if (!existsSync(STATE_PATH)) {
      await sleep(60_000);
      continue;
    }
    const state = readJson<RunnerState>(STATE_PATH);
    if (state.status === "completed") {
      await sendCompletionMail(state);
      return;
    }
    if (state.status === "failed") {
      await sendCompletionMail(state);
      return;
    }
    await sleep(60_000);
  }

  writeFileSync(SENT_MARKER_PATH, JSON.stringify({
    generated_at: nowIso(),
    mail_ok: false,
    reason: "timeout_waiting_for_5h_runner",
  }, null, 2));
}

main().catch((error) => {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(SENT_MARKER_PATH, JSON.stringify({
    generated_at: nowIso(),
    mail_ok: false,
    reason: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
