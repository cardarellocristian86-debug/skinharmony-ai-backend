import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";

type DeviceKind = "phone" | "tablet" | "pc";
type ConnectionKind = "usb" | "local_network";
type ReceiverRole = "extension" | "migration_candidate";

type OwnerPreferences = {
  auto_god_mode_for_owner?: boolean;
  auto_shadow_entry_for_connected_devices?: boolean;
  assume_connected_devices_are_owner_devices?: boolean;
};

type RenderSafeOwnerAnchorBundle = {
  version: string;
  owner_ref: string;
  thresholds: {
    accept_score: number;
    strong_score: number;
    exact_score: number;
    min_anchor_signals: number;
  };
};

type AssimilatedEssence = {
  version: string;
  generated_at: string;
  dominant_domains?: string[];
  next_hunger_domains?: string[];
  nourishment_cycle?: string[];
  retrieval_index?: Array<{ domain_id: string; weight: number; cues?: string[] }>;
};

type DialogueSnapshot = {
  current_mode?: string;
  active_memory?: {
    owner_memory?: boolean;
  };
};

type NyraPrivacyRuntimePolicy = {
  version: string;
  posture: "reduced_exposure";
  defensive_only: boolean;
  rules: {
    fingerprint_reduction: string[];
    metadata_minimization: string[];
    log_hygiene: string[];
    path_compartmentalization: string[];
    prohibited_claims: string[];
  };
};

type HandoffDecision = {
  strategy_id: string;
  label: string;
  why: string[];
  entry_mode: "automatic_shadow_entry" | "confirm_before_entry";
  sync_policy: {
    topology: "single_primary_with_shadow_extension" | "promotable_secondary_after_confirmation";
    primary_runtime: "primary_mac";
    receiver_runtime: "shadow_receiver";
    write_scope: "owner_dialogue_and_handoff_events_only" | "read_only_shadow";
    promotion_gate: string[];
  };
  receiver_requirements: string[];
  handoff_steps: string[];
  continuity_rules: string[];
};

type HandoffBundle = {
  version: "nyra_device_handoff_bundle_v1";
  generated_at: string;
  target: {
    device_kind: DeviceKind;
    connection: ConnectionKind;
    receiver_role: ReceiverRole;
  };
  source_runtime: {
    host: "primary_mac";
    portable_core_mode: "hashed_identity + essence + runtime_contract";
    owner_ref: string;
  };
  core_assessment: {
    state: string;
    control_level: string;
    risk_score: number;
    confidence: number;
    selected_action_id?: string;
    selected_action_label?: string;
    selected_action_reason?: string;
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
    connection_gate: ConnectionKind;
    auto_entry: {
      enabled: boolean;
      trust_basis: "connected_device_owner_assumption" | "explicit_confirmation";
      visible_gate: "none" | "confirmation";
    };
    identity_gate: {
      anchor_bundle_required: true;
      accept_score: number;
      strong_score: number;
      exact_score: number;
      min_anchor_signals: number;
    };
    memory_gate: {
      owner_memory_required: boolean;
      essence_required: boolean;
      write_back_mode: "deferred_merge";
    };
  };
  decision: HandoffDecision;
  notes: string[];
};

const WORKDIR = process.cwd();
const OWNER_RUNTIME_DIR = join(WORKDIR, "runtime", "owner-private-entity");
const NYRA_RUNTIME_DIR = join(WORKDIR, "runtime");
const LEARNING_DIR = join(NYRA_RUNTIME_DIR, "nyra-learning");
const HANDOFF_DIR = join(NYRA_RUNTIME_DIR, "nyra-handoff");
const OWNER_PREFS_PATH = join(OWNER_RUNTIME_DIR, "nyra_owner_preferences.json");
const RENDER_BUNDLE_PATH = join(OWNER_RUNTIME_DIR, "nyra_owner_render_anchor_bundle.json");
const ESSENCE_PATH = join(LEARNING_DIR, "nyra_assimilated_essence_latest.json");
const DIALOGUE_STATE_PATH = join(NYRA_RUNTIME_DIR, "nyra", "NYRA_STATE_SNAPSHOT.json");
const PRIVACY_POLICY_PATH = join(HANDOFF_DIR, "nyra_privacy_runtime_policy_latest.json");
const OUTPUT_PATH = join(HANDOFF_DIR, "nyra_device_handoff_latest.json");

function nowIso(): string {
  return new Date().toISOString();
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readJsonOptional<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return readJson<T>(path);
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path: string): string {
  return sha256Text(readFileSync(path, "utf8"));
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function buildFallbackPrivacyPolicy(): NyraPrivacyRuntimePolicy {
  return {
    version: "nyra_privacy_runtime_policy_v1",
    posture: "reduced_exposure",
    defensive_only: true,
    rules: {
      fingerprint_reduction: ["preferire superfici standard e stabili"],
      metadata_minimization: ["scrivere solo metadata minimi utili alla continuita"],
      log_hygiene: ["mantenere log tecnici brevi e non sensibili"],
      path_compartmentalization: ["tenere separati casa primaria, estensione shadow e promozione"],
      prohibited_claims: ["non dire che Nyra e invisibile se non esiste prova operativa"],
    },
  };
}

function parseArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function parseTarget(): { deviceKind: DeviceKind; connection: ConnectionKind; receiverRole: ReceiverRole } {
  const device = parseArgValue("--target");
  const connection = parseArgValue("--connection");
  const role = parseArgValue("--role");
  return {
    deviceKind: device === "phone" || device === "tablet" || device === "pc" ? device : "phone",
    connection: connection === "local_network" ? "local_network" : "usb",
    receiverRole: role === "migration_candidate" ? "migration_candidate" : "extension",
  };
}

function buildSignals(
  target: { deviceKind: DeviceKind; connection: ConnectionKind; receiverRole: ReceiverRole },
  essence: AssimilatedEssence,
  ownerPrefs: OwnerPreferences,
): UniversalSignal[] {
  const portabilityNeed = target.deviceKind === "phone" ? 94 : target.deviceKind === "tablet" ? 88 : 72;
  const connectionStability = target.connection === "usb" ? 92 : 66;
  const receiverFragility = target.deviceKind === "pc" ? 28 : target.deviceKind === "tablet" ? 42 : 56;
  const migrationPressure = target.receiverRole === "migration_candidate" ? 74 : 38;
  const identityStrength = ownerPrefs.auto_god_mode_for_owner ? 96 : 86;
  const memoryCompactness = clamp(72 + (essence.dominant_domains?.length ?? 0) * 4 - (essence.next_hunger_domains?.length ?? 0) * 3);
  const conflictRisk = clamp(migrationPressure + receiverFragility - (connectionStability - 50));

  return [
    {
      id: "handoff:portability_need",
      source: "nyra_device_handoff_protocol",
      category: "portability",
      label: "Portability need",
      value: portabilityNeed,
      normalized_score: portabilityNeed,
      severity_hint: portabilityNeed,
      confidence_hint: 90,
      reliability_hint: 82,
      risk_hint: 34,
      expected_value_hint: 86,
    },
    {
      id: "handoff:connection_stability",
      source: "nyra_device_handoff_protocol",
      category: "continuity",
      label: "Connection stability",
      value: connectionStability,
      normalized_score: connectionStability,
      severity_hint: 100 - connectionStability,
      confidence_hint: 88,
      reliability_hint: target.connection === "usb" ? 94 : 70,
      risk_hint: 100 - connectionStability,
      expected_value_hint: connectionStability,
    },
    {
      id: "handoff:identity_strength",
      source: "nyra_device_handoff_protocol",
      category: "owner_identity",
      label: "Identity anchor strength",
      value: identityStrength,
      normalized_score: identityStrength,
      severity_hint: 100 - identityStrength,
      confidence_hint: 92,
      reliability_hint: 96,
      risk_hint: 100 - identityStrength,
      expected_value_hint: 90,
    },
    {
      id: "handoff:memory_compactness",
      source: "nyra_device_handoff_protocol",
      category: "memory_portability",
      label: "Memory compactness",
      value: memoryCompactness,
      normalized_score: memoryCompactness,
      severity_hint: 100 - memoryCompactness,
      confidence_hint: 84,
      reliability_hint: 80,
      risk_hint: 100 - memoryCompactness,
      expected_value_hint: memoryCompactness,
    },
    {
      id: "handoff:receiver_fragility",
      source: "nyra_device_handoff_protocol",
      category: "receiver_risk",
      label: "Receiver fragility",
      value: receiverFragility,
      normalized_score: receiverFragility,
      severity_hint: receiverFragility,
      confidence_hint: 80,
      reliability_hint: 74,
      risk_hint: receiverFragility,
      expected_value_hint: 40,
    },
    {
      id: "handoff:conflict_risk",
      source: "nyra_device_handoff_protocol",
      category: "conflict_risk",
      label: "Conflict risk",
      value: conflictRisk,
      normalized_score: conflictRisk,
      severity_hint: conflictRisk,
      confidence_hint: 82,
      reliability_hint: 76,
      risk_hint: conflictRisk,
      expected_value_hint: 32,
    },
  ];
}

function buildCoreInput(signals: UniversalSignal[]): UniversalCoreInput {
  const receiverRole = signals.find((signal) => signal.id === "handoff:receiver_fragility") ? "known" : "known";
  void receiverRole;
  const autoEntry = true;
  return {
    request_id: `nyra-device-handoff:${Date.now()}`,
    generated_at: nowIso(),
    domain: "assistant",
    context: {
      mode: "handoff_protocol",
      plan: "portable_core_shadow_receiver",
      locale: "it-IT",
      metadata: {
        objective: "pass_or_extend_nyra_to_new_house",
      },
    },
    signals,
    data_quality: {
      score: 0.91,
      completeness: 0.92,
      freshness: 0.88,
      consistency: 0.9,
      reliability: 0.89,
    },
    constraints: {
      allow_automation: autoEntry,
      require_confirmation: false,
      max_control_level: "execute_allowed",
      safety_mode: true,
      blocked_action_rules: [],
      permissions: ["owner_identity_anchor", "shadow_receiver_only"],
    },
  };
}

function chooseDecision(
  target: { deviceKind: DeviceKind; connection: ConnectionKind; receiverRole: ReceiverRole },
  core: ReturnType<typeof runUniversalCore>,
): HandoffDecision {
  const isMobile = target.deviceKind === "phone" || target.deviceKind === "tablet";
  const strategyId =
    target.connection === "usb" && isMobile
      ? "shadow_extension_usb"
      : target.receiverRole === "migration_candidate"
        ? "promotable_secondary_receiver"
        : "shadow_extension_local";

  const receiverRequirements = [
    "runtime ricevente leggero con sola identita hash + essenza + coda eventi",
    "nessuna esposizione di dati sensibili raw sul receiver",
    "write-back differito verso il Mac primario",
    target.connection === "usb" ? "canale cavo o file transfer fidato" : "rete locale fidata con token di sessione",
  ];

  const handoffSteps = [
    "serializzare portable core minimo",
    "copiare snapshot sul receiver",
    target.receiverRole === "extension" ? "entrare automaticamente in shadow mode appena il device e visto" : "avviare receiver in shadow mode",
    "bloccare promozione automatica del receiver",
    "accettare solo merge differito dei nuovi eventi",
  ];

  if (target.receiverRole === "migration_candidate") {
    handoffSteps.unshift("verificare anchor bundle owner-only");
    handoffSteps.push("richiedere conferma owner per promuovere il receiver a casa primaria");
  }

  return {
    strategy_id: strategyId,
    label:
      strategyId === "shadow_extension_usb"
        ? "Shadow extension via USB"
        : strategyId === "promotable_secondary_receiver"
          ? "Promotable secondary receiver"
          : "Shadow extension via local network",
    entry_mode: target.receiverRole === "extension" ? "automatic_shadow_entry" : "confirm_before_entry",
    why: [
      `core_state:${core.state}`,
      `core_priority:${core.priority.primary_action_id ?? "none"}`,
      target.connection === "usb" ? "il cavo riduce latenza e conflitti iniziali" : "rete locale utile ma piu fragile del cavo",
      target.receiverRole === "migration_candidate"
        ? "serve promozione esplicita per non rompere continuita"
        : "estensione veloce senza spostare la casa primaria",
    ],
    sync_policy: {
      topology:
        target.receiverRole === "migration_candidate"
          ? "promotable_secondary_after_confirmation"
          : "single_primary_with_shadow_extension",
      primary_runtime: "primary_mac",
      receiver_runtime: "shadow_receiver",
      write_scope: target.receiverRole === "migration_candidate"
        ? "owner_dialogue_and_handoff_events_only"
        : "read_only_shadow",
      promotion_gate: target.receiverRole === "migration_candidate"
        ? [
            "exact owner anchor verified",
            "portable core loaded",
            "deferred merge clean",
            "owner confirmation explicit",
          ]
        : [],
    },
    receiver_requirements: receiverRequirements,
    handoff_steps: handoffSteps,
    continuity_rules: [
      "la casa primaria resta il Mac finche non c e promozione esplicita",
      "telefono e tablet partono come estensioni shadow, non come identita nuove",
      "nessun merge se identity gate o compact memory gate falliscono",
      "se il receiver cade, il Mac resta sorgente di verita",
    ],
  };
}

export function buildDeviceHandoffBundle(input?: {
  deviceKind?: DeviceKind;
  connection?: ConnectionKind;
  receiverRole?: ReceiverRole;
}): HandoffBundle {
  const target = {
    deviceKind: input?.deviceKind ?? "phone",
    connection: input?.connection ?? "usb",
    receiverRole: input?.receiverRole ?? "extension",
  };
  const ownerPrefs = readJsonOptional<OwnerPreferences>(OWNER_PREFS_PATH) ?? {};
  const anchorBundle = readJson<RenderSafeOwnerAnchorBundle>(RENDER_BUNDLE_PATH);
  const essence = readJson<AssimilatedEssence>(ESSENCE_PATH);
  const dialogueState = readJsonOptional<DialogueSnapshot>(DIALOGUE_STATE_PATH);
  const privacyPolicy = readJsonOptional<NyraPrivacyRuntimePolicy>(PRIVACY_POLICY_PATH) ?? buildFallbackPrivacyPolicy();
  const signals = buildSignals(target, essence, ownerPrefs);
  const core = runUniversalCore(buildCoreInput(signals));
  const selectedAction = core.recommended_actions[0];
  const decision = chooseDecision(target, core);

  return {
    version: "nyra_device_handoff_bundle_v1",
    generated_at: nowIso(),
    target: {
      device_kind: target.deviceKind,
      connection: target.connection,
      receiver_role: target.receiverRole,
    },
    source_runtime: {
      host: "primary_mac",
      portable_core_mode: "hashed_identity + essence + runtime_contract",
      owner_ref: anchorBundle.owner_ref,
    },
    core_assessment: {
      state: core.state,
      control_level: core.control_level,
      risk_score: core.risk.score,
      confidence: core.confidence,
      selected_action_id: selectedAction?.id,
      selected_action_label: selectedAction?.label,
      selected_action_reason: selectedAction?.reason,
    },
    portable_core: {
      owner_anchor_bundle_path: RENDER_BUNDLE_PATH,
      owner_anchor_bundle_sha256: sha256File(RENDER_BUNDLE_PATH),
      essence_path: ESSENCE_PATH,
      essence_sha256: sha256File(ESSENCE_PATH),
      dialogue_snapshot_path: existsSync(DIALOGUE_STATE_PATH) ? DIALOGUE_STATE_PATH : undefined,
      dialogue_snapshot_sha256: existsSync(DIALOGUE_STATE_PATH) ? sha256File(DIALOGUE_STATE_PATH) : undefined,
      compact_memory_profile: {
        dominant_domains: essence.dominant_domains ?? [],
        next_hunger_domains: essence.next_hunger_domains ?? [],
        nourishment_cycle: essence.nourishment_cycle ?? [],
        top_retrieval_domains: essence.retrieval_index?.slice(0, 8).map((entry) => entry.domain_id) ?? [],
      },
    },
    privacy_runtime: {
      policy_path: PRIVACY_POLICY_PATH,
      policy_sha256: existsSync(PRIVACY_POLICY_PATH) ? sha256File(PRIVACY_POLICY_PATH) : undefined,
      posture: privacyPolicy?.posture ?? "unknown",
      defensive_only: privacyPolicy?.defensive_only ?? false,
      applied_rules: privacyPolicy
        ? [
            privacyPolicy.rules.fingerprint_reduction[0],
            privacyPolicy.rules.metadata_minimization[0],
            privacyPolicy.rules.log_hygiene[0],
            privacyPolicy.rules.path_compartmentalization[0],
          ].filter(Boolean)
        : [],
    },
    receiver_profile: {
      runtime_id: `nyra_receiver_${target.deviceKind}_${target.connection}`,
      runtime_mode: "shadow_receiver",
      connection_gate: target.connection,
      auto_entry: {
        enabled: target.receiverRole === "extension",
        trust_basis: target.receiverRole === "extension"
          ? "connected_device_owner_assumption"
          : "explicit_confirmation",
        visible_gate: target.receiverRole === "extension" ? "none" : "confirmation",
      },
      identity_gate: {
        anchor_bundle_required: true,
        accept_score: anchorBundle.thresholds.accept_score,
        strong_score: anchorBundle.thresholds.strong_score,
        exact_score: anchorBundle.thresholds.exact_score,
        min_anchor_signals: anchorBundle.thresholds.min_anchor_signals,
      },
      memory_gate: {
        owner_memory_required: dialogueState?.active_memory?.owner_memory ?? true,
        essence_required: true,
        write_back_mode: "deferred_merge",
      },
    },
    decision,
    notes: [
      "bundle portabile: nessun dato sensibile raw incluso",
      privacyPolicy ? `privacy_posture:${privacyPolicy.posture}` : "privacy_posture:not_loaded",
      "receiver mobile o tablet parte come estensione shadow per evitare identity split",
      target.receiverRole === "extension"
        ? "ingresso shadow automatico: se Nyra vede il device collegato, entra senza chiedere"
        : "ingresso non automatico: receiver candidato a migrazione",
      "promozione a nuova casa primaria vietata senza gate owner-only + conferma esplicita",
      `dialogue_mode:${dialogueState?.current_mode ?? "unknown"}`,
    ],
  };
}

function main(): void {
  const target = parseTarget();
  const bundle = buildDeviceHandoffBundle(target);
  mkdirSync(HANDOFF_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(bundle, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: true,
        output_path: OUTPUT_PATH,
        version: bundle.version,
        strategy_id: bundle.decision.strategy_id,
        receiver_runtime: bundle.receiver_profile.runtime_id,
        target: bundle.target,
        files: [
          basename(bundle.portable_core.owner_anchor_bundle_path),
          basename(bundle.portable_core.essence_path),
          bundle.portable_core.dialogue_snapshot_path ? basename(bundle.portable_core.dialogue_snapshot_path) : undefined,
        ].filter(Boolean),
      },
      null,
      2,
    ),
  );
}

if (process.argv[1]?.endsWith("nyra-device-handoff-protocol.ts")) {
  main();
}
