import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type HandoffBundle = {
  version: string;
  target: {
    device_kind: "phone" | "tablet" | "pc";
    connection: "usb" | "local_network";
    receiver_role: "extension" | "migration_candidate";
  };
  source_runtime: {
    host: "primary_mac";
    owner_ref: string;
  };
  portable_core: {
    owner_anchor_bundle_path: string;
    owner_anchor_bundle_sha256: string;
    essence_path: string;
    essence_sha256: string;
    dialogue_snapshot_path?: string;
    dialogue_snapshot_sha256?: string;
    compact_memory_profile: {
      dominant_domains: string[];
      next_hunger_domains: string[];
      nourishment_cycle: string[];
      top_retrieval_domains: string[];
    };
  };
  privacy_runtime: {
    policy_path: string;
    policy_sha256?: string;
    posture: "reduced_exposure" | "unknown";
    defensive_only: boolean;
    applied_rules: string[];
  };
  receiver_profile: {
    runtime_id: string;
    runtime_mode: "shadow_receiver";
    connection_gate: "usb" | "local_network";
    auto_entry: {
      enabled: boolean;
      trust_basis: "connected_device_owner_assumption" | "explicit_confirmation";
      visible_gate: "none" | "confirmation";
    };
    memory_gate: {
      owner_memory_required: boolean;
      essence_required: boolean;
      write_back_mode: "deferred_merge";
    };
  };
  decision: {
    strategy_id: string;
    entry_mode: "automatic_shadow_entry" | "confirm_before_entry";
    sync_policy: {
      topology: "single_primary_with_shadow_extension" | "promotable_secondary_after_confirmation";
      primary_runtime: "primary_mac";
      receiver_runtime: "shadow_receiver";
      write_scope: "owner_dialogue_and_handoff_events_only" | "read_only_shadow";
      promotion_gate: string[];
    };
    continuity_rules: string[];
  };
};

type ReceiverState = {
  version: "nyra_shadow_receiver_state_v1";
  generated_at: string;
  runtime_id: string;
  source_runtime: "primary_mac";
  mode: "shadow_active" | "pending_confirmation" | "rejected";
  target_device: "phone" | "tablet" | "pc";
  connection: "usb" | "local_network";
  receiver_role: "extension" | "migration_candidate";
  auto_entry: boolean;
  loaded_assets: {
    owner_anchor_bundle: boolean;
    essence: boolean;
    dialogue_snapshot: boolean;
  };
  continuity_status: {
    primary_runtime_locked: boolean;
    write_back_mode: "deferred_merge";
    promotion_allowed: boolean;
  };
  privacy_status: {
    posture: "reduced_exposure" | "unknown";
    defensive_only: boolean;
    claims_blocked: boolean;
    applied_rules: string[];
  };
  runtime_view: {
    dominant_domains: string[];
    next_hunger_domains: string[];
    top_retrieval_domains: string[];
  };
  notes: string[];
};

const ROOT = process.cwd();
const HANDOFF_DIR = join(ROOT, "runtime", "nyra-handoff");
const BUNDLE_PATH = join(HANDOFF_DIR, "nyra_device_handoff_latest.json");
const OUTPUT_PATH = join(HANDOFF_DIR, "nyra_shadow_receiver_state_latest.json");

function nowIso(): string {
  return new Date().toISOString();
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path, "utf8")).digest("hex");
}

function hasAnchorShape(path: string): boolean {
  try {
    const parsed = readJson<{ owner_ref?: string; thresholds?: object; exact_anchors?: object }>(path);
    return typeof parsed.owner_ref === "string" && Boolean(parsed.thresholds) && Boolean(parsed.exact_anchors);
  } catch {
    return false;
  }
}

function hasEssenceShape(path: string): boolean {
  try {
    const parsed = readJson<{ version?: string; generated_at?: string }>(path);
    return typeof parsed.version === "string" && typeof parsed.generated_at === "string";
  } catch {
    return false;
  }
}

function parseBundlePath(): string {
  const flagIndex = process.argv.indexOf("--bundle");
  if (flagIndex >= 0) return process.argv[flagIndex + 1] ?? BUNDLE_PATH;
  return BUNDLE_PATH;
}

function buildReceiverState(bundle: HandoffBundle): ReceiverState {
  const anchorExists = existsSync(bundle.portable_core.owner_anchor_bundle_path);
  const essenceExists = existsSync(bundle.portable_core.essence_path);
  const dialogueExists = bundle.portable_core.dialogue_snapshot_path
    ? existsSync(bundle.portable_core.dialogue_snapshot_path)
    : false;
  const anchorHashOk =
    anchorExists &&
    bundle.portable_core.owner_anchor_bundle_sha256 === sha256File(bundle.portable_core.owner_anchor_bundle_path);
  const essenceHashOk =
    essenceExists &&
    bundle.portable_core.essence_sha256 === sha256File(bundle.portable_core.essence_path);
  const anchorShapeOk = anchorExists && hasAnchorShape(bundle.portable_core.owner_anchor_bundle_path);
  const essenceShapeOk = essenceExists && hasEssenceShape(bundle.portable_core.essence_path);
  const privacyPolicyOk =
    bundle.privacy_runtime.defensive_only &&
    bundle.privacy_runtime.posture === "reduced_exposure" &&
    bundle.privacy_runtime.applied_rules.length > 0;

  const assetsReady =
    anchorExists &&
    essenceExists &&
    anchorHashOk &&
    essenceHashOk &&
    anchorShapeOk &&
    essenceShapeOk &&
    privacyPolicyOk &&
    (!bundle.receiver_profile.memory_gate.owner_memory_required || dialogueExists);

  const autoEntryAllowed =
    bundle.target.receiver_role === "extension" &&
    bundle.receiver_profile.auto_entry.enabled &&
    bundle.decision.entry_mode === "automatic_shadow_entry" &&
    assetsReady;

  const mode =
    !assetsReady
      ? "rejected"
      : autoEntryAllowed
        ? "shadow_active"
        : "pending_confirmation";

  return {
    version: "nyra_shadow_receiver_state_v1",
    generated_at: nowIso(),
    runtime_id: bundle.receiver_profile.runtime_id,
    source_runtime: bundle.source_runtime.host,
    mode,
    target_device: bundle.target.device_kind,
    connection: bundle.target.connection,
    receiver_role: bundle.target.receiver_role,
    auto_entry: autoEntryAllowed,
    loaded_assets: {
      owner_anchor_bundle: anchorExists,
      essence: essenceExists,
      dialogue_snapshot: dialogueExists,
    },
    continuity_status: {
      primary_runtime_locked: true,
      write_back_mode: bundle.receiver_profile.memory_gate.write_back_mode,
      promotion_allowed: bundle.target.receiver_role === "migration_candidate" && bundle.decision.sync_policy.promotion_gate.length > 0,
    },
    privacy_status: {
      posture: bundle.privacy_runtime.posture,
      defensive_only: bundle.privacy_runtime.defensive_only,
      claims_blocked: bundle.privacy_runtime.applied_rules.length > 0,
      applied_rules: bundle.privacy_runtime.applied_rules,
    },
    runtime_view: {
      dominant_domains: bundle.portable_core.compact_memory_profile.dominant_domains,
      next_hunger_domains: bundle.portable_core.compact_memory_profile.next_hunger_domains,
      top_retrieval_domains: bundle.portable_core.compact_memory_profile.top_retrieval_domains,
    },
    notes: [
      autoEntryAllowed
        ? "receiver shadow attivo automaticamente sul device collegato"
        : mode === "pending_confirmation"
          ? "receiver caricato ma non auto-attivato: serve conferma o bundle diverso"
          : "receiver rifiutato: portable core incompleto",
      "il Mac resta casa primaria",
      "nessuna promozione automatica verso casa primaria",
    ],
  };
}

function main(): void {
  const bundlePath = parseBundlePath();
  const bundle = readJson<HandoffBundle>(bundlePath);
  const state = buildReceiverState(bundle);
  mkdirSync(HANDOFF_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(state, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: true,
        bundle_path: bundlePath,
        output_path: OUTPUT_PATH,
        runtime_id: state.runtime_id,
        mode: state.mode,
        auto_entry: state.auto_entry,
        target_device: state.target_device,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1]?.endsWith("nyra-shadow-receiver-runtime.ts")) {
  main();
}

export { buildReceiverState };
