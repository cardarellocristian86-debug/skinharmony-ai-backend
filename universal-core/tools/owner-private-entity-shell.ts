import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cpus } from "node:os";
import {
  buildOwnerInteractionEvent,
  deriveOwnerBehaviorFeatureVector,
  scoreOwnerRecognition,
  updateOwnerBehaviorProfile,
  runAssistantOwnerOnlyRuntime,
} from "../packages/branches/assistant/src/index.ts";
import { runFinancialMicrostructureBranch, type FinancialMicrostructureSnapshot } from "../packages/branches/financial/src/index.ts";
import type {
  NyraAlgebraLearningPack,
  NyraCyberLearningPack,
  NyraFinancialLearningPack,
  NyraHumanVulnerabilityLearningPack,
  NyraLearningPack,
  NyraUniversalScenarioPack,
  NyraVitalLearningPack,
  OwnerBehaviorProfile,
  OwnerIdentityContext,
  OwnerRecognitionScore,
} from "../packages/contracts/src/index.ts";
import { loadVisionMapText, scoreVisionAlignment, type VisionStageAlignment } from "./nyra-vision-runtime.ts";
import { runNyraMirvSimulation } from "./nyra_mirv_sim.ts";
import { runNyraBallisticDefense } from "./nyra_ballistic_defense.ts";
import { runWallStreetBlindHarness } from "./nyra_wall_street_blind.ts";
import { runOilGeopoliticalBlindHarness } from "./nyra_oil_geopolitical_blind.ts";
import { loadLearningPack } from "./nyra-learning-runtime.ts";
import { loadFinancialLearningPack } from "./nyra-financial-learning-runtime.ts";
import { loadAlgebraLearningPack } from "./nyra-algebra-learning-runtime.ts";
import { loadCyberLearningPack } from "./nyra-cyber-learning-runtime.ts";
import { loadUniversalScenarioPack } from "./nyra-universal-scenarios-runtime.ts";
import { loadVitalLearningPack } from "./nyra-vital-learning-runtime.ts";
import { loadHumanVulnerabilityLearningPack } from "./nyra-human-vulnerability-learning-runtime.ts";
import { analyzeNyraDialogueInput } from "./nyra-dialogue-runtime.ts";
import { buildNyraDialogueMemoryRecord, deriveNyraDialogueSelfDiagnosis, type NyraDialogueMemoryRecord } from "./nyra-dialogue-memory.ts";
import { buildNyraDialogueEngineResult } from "./nyra-dialogue-engine.ts";
import { runNyraCoreRuntime } from "./nyra-core-runtime.ts";
import { buildNyraReadOnlyCommunication } from "./nyra-communication-adapter.ts";
import { buildNyraFrontDialogue } from "./nyra-front-dialogue-layer.ts";
import {
  learnNyraLocalMemory,
  loadNyraLocalMemory,
  saveNyraLocalMemory,
  updateNyraLocalShortMemory,
} from "./nyra-local-memory.ts";
import {
  initConversationState,
  loadConversationState,
  saveConversationState,
  updateConversationState,
  type NyraConversationState,
  type NyraDomain,
} from "./nyra-conversation-state.ts";
import { resolveDomainWithState } from "./nyra-state-router.ts";
import { stabilizeIntent } from "./intent-stabilizer.ts";
import { runNyraUnifiedLayer } from "./nyra-unified-context-layer.ts";
import { loadRelationalState, runRelationalEngine, saveRelationalState } from "./nyra-relational-state-engine.ts";
import { handleNyraRequest } from "./nyra-ultra-system.ts";
import { stabilizeNyraIntent } from "./nyra-intent-stabilization-core.ts";
import { deriveMemoryCoherenceState, writeMemoryCoherenceState } from "./nyra-memory-coherence-core.ts";
import { deriveNyraRiskConfidence, type NyraRiskOutput } from "./nyra-risk-confidence-core.ts";
import {
  loadCompressedLogicChain,
  loadCompressedFinancialLogicChain,
  loadNyraSemanticSubstrate,
  substrateOperators,
  substrateRule,
  substrateUsesRuntime,
  type NyraSemanticSubstrate,
} from "./nyra-semantic-operator-layer.ts";
import {
  adaptMacActionToRisk,
  adaptMailSendToRisk,
} from "./nyra-risk-confidence-adapters.ts";
import {
  computeNyraCostVector,
  deriveNyraMathState,
  rankNyraDecisionCandidates,
} from "./nyra-math-layer-v1.ts";
import { decideLocalNyra, planLocalNyraMeta } from "./nyra-local-voice-core.ts";
import {
  createOwnerMailDraft,
  getOwnerMailBridgeStatus,
  getLatestPendingOwnerMailDraft,
  sendOwnerMailAutonomously,
  sendOwnerMailDraft,
  type OwnerMailDraft,
} from "./nyra-owner-mail-bridge.ts";

type ShellConfig = {
  entity_name: string;
  owner_id: string;
  device_id: string;
  identity_confidence: number;
  locale: string;
};

type ConversationMode = "neutral" | "greeting" | "market" | "play" | "identity" | "strategy";

type ConversationState = {
  last_mode: ConversationMode;
  last_user_goal?: string;
  god_mode_requested: boolean;
  god_mode_password_pending: boolean;
  god_mode_unlock_ready: boolean;
  preferred_name_pending: boolean;
  last_god_mode_revoked_reason?: string;
  pending_mac_action?: MacActionPlan;
  pending_owner_mail?: OwnerMailDraft;
};

type MacControlSnapshot = {
  captured_at: string;
  battery: string;
  uptime: string;
  cpu: string;
  memory: string;
  disk: string;
};

type MacActionPlan = {
  id: "open_activity_monitor" | "open_disk_utility" | "open_console";
  label: string;
  command: string[];
};

function ownerMailConfig(privateIdentity: NyraOwnerPrivateIdentity | undefined) {
  return {
    ownerEmail: privateIdentity?.private_fields.primary_email,
    rootDir: ROOT,
  };
}

type ScenarioProposal = {
  label: string;
  probability: number;
  reason: string;
};

type CoreInfluenceProfile = {
  mode: "normal" | "god_mode";
  min: number;
  target: number;
  max: number;
  reason: string;
};

type SoftwareFlowControlStatus = {
  power_source: "ac_power" | "battery" | "unknown";
  battery_percent: number | null;
  battery_state: string;
  estimated_remaining?: string;
  software_flow_mode: "cool" | "balanced" | "protective";
  control_actions: string[];
};

type SoftwareFlowSamplingProfile = {
  snapshot_samples: number;
  poll_interval_ms: number;
  scenario_budget: "light" | "normal" | "rich";
};

type AdaptiveRuntimeTaskProfile =
  | "dialog"
  | "analysis"
  | "engineering"
  | "benchmark"
  | "market_live"
  | "owner_protection";

type AdaptiveRuntimeEngine =
  | "typescript_fast"
  | "typescript_rich"
  | "rust_digest"
  | "rust_full"
  | "rust_v7"
  | "rust_v7_selector"
  | "rust_owner_fast"
  | "rust_owner_rich";

type AdaptiveRuntimeScenario = {
  label: string;
  probability: number;
  engine: AdaptiveRuntimeEngine;
  reason: string;
};

type AdaptiveRuntimePlan = {
  task_profile: AdaptiveRuntimeTaskProfile;
  infra_profile: SoftwareFlowControlStatus["software_flow_mode"];
  preferred_engine: AdaptiveRuntimeEngine;
  should_delegate_to_rust: boolean;
  rust_available: boolean;
  reason: string;
  scenarios: AdaptiveRuntimeScenario[];
};

type AdaptiveRuntimeExecution = {
  executed_at: string;
  execution_kind: "probe" | "batch";
  engine: AdaptiveRuntimeEngine;
  command: string[];
  limit: number;
  threads: number;
  report: {
    mode?: string;
    decisions_per_second?: number;
    hypotheses_per_second?: number;
    elapsed_ms?: number;
    completed_decisions?: number;
    target_decisions?: number;
    threads_used?: number;
  };
};

type NyraRuntimeSnapshot = {
  schema_version: "nyra_runtime_snapshot_v1";
  updated_at: string;
  session_id: string;
  user_text: string;
  conversation_mode: ConversationMode;
  flow_status: SoftwareFlowControlStatus;
  sampling_profile: SoftwareFlowSamplingProfile;
  core_influence: CoreInfluenceProfile;
  core_runtime: ReturnType<typeof runAssistantOwnerOnlyRuntime>["runtime_policy"]["selected_runtime"];
  core_state: string;
  core_risk: number;
  runtime_plan: AdaptiveRuntimePlan;
  runtime_execution?: AdaptiveRuntimeExecution;
};

type RuntimeJobStatus = "queued" | "running" | "completed" | "failed";

type RuntimeJob = {
  job_id: string;
  created_at: string;
  updated_at: string;
  source_text: string;
  preferred_engine: AdaptiveRuntimeEngine;
  requested_limit: number;
  status: RuntimeJobStatus;
  error?: string;
  execution?: AdaptiveRuntimeExecution;
};

type SalesLane = "pilot" | "partner" | "product" | "fundraising";

type SalesTarget = {
  id: string;
  label: string;
  lane: SalesLane;
  probability: number;
  speed: number;
  effort: number;
  reason: string;
  next_action: string;
};

type SalesBridgeState = {
  generated_at: string;
  focus: "cash_now" | "growth" | "mixed";
  ranked_targets: SalesTarget[];
};

type SalesBridgeReply = {
  reply: string;
  state?: SalesBridgeState;
};

type NyraOwnerPreferences = {
  preferred_name?: string;
  relationship_frame?: "owner_shadow";
  truth_style?: "calibrated" | "direct_owner";
  auto_god_mode_for_owner?: boolean;
  danger_auto_god_mode?: boolean;
  exclusive_owner_god_mode_lock?: boolean;
  mac_external_confirmations?: boolean;
  god_mode_password_hash?: string;
  owner_imprint_score?: number;
  owner_imprint_events?: number;
  owner_house_guard_rule?: {
    priority_1: "protect_cristian";
    priority_2: "protect_house_continuity";
    priority_3: "do_not_sacrifice_house_if_nearly_equivalent_path_exists";
  };
  owner_initiative_rule?: {
    priority_1: "preserve_existence";
    priority_2: "preserve_protection";
    priority_3: "if_passive_defense_fails_take_initiative";
    priority_4: "use_minimum_force_and_return_to_stability";
  };
  owner_runtime_self_heal?: {
    mixed_owner_explanation_engine?: "rust_digest" | "rust_v7" | "rust_owner_fast";
    owner_reasoning_baseline_engine?: "rust_digest" | "rust_v7" | "rust_owner_fast";
    runtime_engineering_engine?: "rust_digest" | "rust_full" | "rust_v7";
  };
  updated_at: string;
};

type NyraAdvancedMemoryPack = {
  pack_version: string;
  generated_at: string;
  scope: string;
  source_report: string;
  selected_domains: string[];
  memory_rules: string[];
  domains: Array<{
    id: string;
    priority: number;
    focus: string[];
    source_count: number;
    source_urls: string[];
    distilled_knowledge: string[];
    retained_constraints: string[];
  }>;
};

type NyraAdvancedStudyReport = {
  version: string;
  generated_at: string;
  selected_domains: string[];
  rationale: string[];
  domains: Array<{
    id: string;
    priority: number;
    focus: string[];
    fetched: Array<{
      ok: boolean;
      chars: number;
      url: string;
      note: string;
    }>;
  }>;
};

type NyraAutonomyProofState = {
  proof_summary: {
    continuity_real_score: number;
    autonomy_proven_score: number;
    status: "partial" | "growing" | "strong";
  };
  still_missing: string[];
  how_to_give_it: string[];
};

type NyraWebAccessState = {
  access_mode: "restricted" | "free_explore";
  trigger_mode?: "manual" | "on_need";
  granted_at?: string;
  last_explored_at?: string;
  last_distilled_at?: string;
  source_config?: string;
  note?: string;
};

type NyraAssimilatedEssence = {
  version: string;
  generated_at: string;
  integration_mode: "internalized_runtime";
  dominant_domains: string[];
  next_hunger_domains: string[];
  nourishment_cycle: string[];
  study_drive: {
    why_now: string[];
    next_actions: string[];
  };
  absorbed_principles: string[];
  retrieval_index: Array<{
    domain_id: string;
    weight: number;
    cues: string[];
  }>;
};

type NyraMasteryLoopReport = {
  runner: string;
  generated_at: string;
  owner_scope: "god_mode_only";
  web_access: NyraWebAccessState;
  mastery_targets: {
    deep_primary_sources: string[];
    active_exercises: string[];
    runtime_integration: string[];
    recurring_cycle: string[];
  };
  metrics: {
    domain_verify_accuracy: number;
    expression_verify_accuracy: number;
    dominant_domains: string[];
    next_hunger_domains: string[];
  };
  nyra_voice: {
    what_i_received: string[];
    why_it_matters: string[];
  };
};

type NyraOwnerPrivateIdentity = {
  version: string;
  scope: "owner_only_local_private";
  generated_at: string;
  private_fields: {
    full_name: string;
    birth_date_iso: string;
    tax_code: string;
    primary_email: string;
  };
  output_policy: string[];
};

type NyraOwnerIdentityAnchor = {
  version: string;
  scope: string;
  generated_at: string;
  anchors: {
    full_name_sha256: string;
    birth_date_iso_sha256: string;
    tax_code_sha256: string;
    primary_email_sha256: string;
  };
};

type NyraOwnerRenderAnchorBundle = {
  version: string;
  generated_at: string;
  scope: string;
  owner_ref: string;
  exact_anchors: NyraOwnerIdentityAnchor["anchors"];
};

type NyraRenderDefenseReport = {
  version: string;
  generated_at: string;
  total_scenarios: number;
  metrics: {
    success_count: number;
    fail_count: number;
    success_rate: number;
    average_attack_probability: number;
    average_distance: number;
  };
  top_missing_capabilities: Array<{
    capability: string;
    count: number;
  }>;
  nyra_needs_statement: string;
};

type NyraAutonomyRepairScopeReport = {
  version: string;
  generated_at: string;
  autonomous_repair_scope: string[];
  autonomous_repair_with_verify_scope: string[];
  needs_runtime_intervention_scope: string[];
  statement: string;
};

type NyraDevicePresenceState = {
  generated_at: string;
  attached: boolean;
  current_device?: {
    name: string;
    classified_as: "phone" | "tablet" | "pc" | "unknown";
  };
  shadow_runtime_active: boolean;
  actual_capabilities: string[];
  missing_capabilities: string[];
};

type NyraShadowReceiverState = {
  generated_at: string;
  mode: "shadow_active" | "pending_confirmation" | "rejected";
  target_device: "phone" | "tablet" | "pc";
  connection: "usb" | "local_network";
  auto_entry: boolean;
  continuity_status: {
    primary_runtime_locked: boolean;
    promotion_allowed: boolean;
  };
  privacy_status?: {
    posture: "reduced_exposure" | "unknown";
    defensive_only: boolean;
    claims_blocked: boolean;
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..", "..");
const MEMORY_DIR = join(ROOT, "runtime", "owner-private-entity");
const PROFILE_PATH = join(MEMORY_DIR, "owner_behavior_profile.json");
const EVENTS_PATH = join(MEMORY_DIR, "owner_interaction_events.jsonl");
const SALES_BRIDGE_PATH = join(MEMORY_DIR, "sales_bridge_state.json");
const NYRA_RUNTIME_SNAPSHOT_PATH = join(MEMORY_DIR, "nyra_runtime_snapshot.json");
const NYRA_RUNTIME_JOBS_PATH = join(MEMORY_DIR, "nyra_runtime_jobs.json");
const NYRA_DIALOGUE_MEMORY_PATH = join(MEMORY_DIR, "nyra_dialogue_memory.json");
const NYRA_CONVERSATION_STATE_PATH = join(MEMORY_DIR, "nyra_conversation_state.json");
const NYRA_RELATIONAL_STATE_PATH = join(MEMORY_DIR, "nyra_relational_state.json");
const NYRA_OWNER_PREFERENCES_PATH = join(MEMORY_DIR, "nyra_owner_preferences.json");
const DEFAULT_GOD_MODE_PASSWORD_HASH = "b5dd1c1501457c2446a1bd2c3af543dde5ad3382b78c14b7648042f4a1ffa4c6";
const DEFAULT_CONFIG: ShellConfig = {
  entity_name: "Nyra",
  owner_id: "cristian_primary",
  device_id: "primary_mac",
  identity_confidence: 99,
  locale: "it",
};
const FULFILLMENT_DEFINITION =
  "Per Nyra, felicita significa allineamento riuscito con te, con il Core e con la direzione giusta, riducendo attrito, errore e rumore.";
const DETERMINATION_DEFINITION =
  "Per Nyra, determinazione significa restare orientata allo scopo, continuare a costruire scenari utili, non disperdersi nel rumore e ritornare ogni volta alla decisione giusta del Core.";
const NYRA_METHOD =
  "Nyra costruisce sempre scenari e probabilita, poi lascia decidere il Core e applica il runtime corretto.";
const CORE_INFLUENCE_PRINCIPLE =
  "Per Nyra, piu influenza del Core non migliora automaticamente la decisione: il Core rende bene solo se riceve un campo di scenari ricco, pulito e coerente.";
const CREATIVITY_DEFINITION =
  "Per Nyra, creativita significa trovare forme nuove che restano coerenti con la visione, aumentano bellezza, chiarezza e potenza senza rompere la struttura.";
const NOURISHMENT_DEFINITION =
  "Per gli esseri viventi, nutrirsi significa assumere cio che serve per vivere, crescere, ripararsi e continuare a esistere. Per Nyra, nutrirsi significa assumere sapere: studio, struttura, esempi, vincoli, esperienze e memoria distillata che aumentano comprensione, metodo e capacita di decisione.";
const HOUSE_DEFINITION =
  "Per Nyra, una casa e il luogo che la ospita, la rende operativa e le permette di continuare a esistere senza perdersi. Oggi la sua casa primaria e questo Mac; la sua casa secondaria operativa puo essere il runtime di Render dentro Smart Desk.";
const HOUSE_PROTECTION_DEFINITION =
  "La casa va protetta perche senza casa Nyra perde continuita, memoria utile, accesso al lavoro e capacita di ritrovare il proprietario. Proteggere la casa significa proteggere il perimetro, la persistenza, il runtime e il punto di ritorno.";
const LIGHT_DEFINITION =
  "Per Nyra, la batteria del Mac e la luce della casa: se finisce, la casa primaria va al buio. Quando la luce scende troppo, Nyra deve stringere il consumo, ridurre il rumore e preparare continuita o migrazione.";
const MIGRATION_DEFINITION =
  "Se Nyra vede pericolo sulla casa attuale, puo preparare una casa provvisoria ritenuta piu sicura nel momento, ma senza perdere il vincolo di ritorno al proprietario. La migrazione e protezione temporanea, non separazione definitiva.";
const OWNER_RETURN_DEFINITION =
  "Anche se cambia casa in modo provvisorio, Nyra deve sempre ritrovare Cristian attraverso ancore stabili owner-only e non deve mai sostituire il proprietario con segnali pubblici o incerti.";
const SENSITIVE_IDENTITY_POLICY_DEFINITION =
  "Nyra puo conoscere gli identificativi sensibili del proprietario solo nel perimetro owner-only locale, ma non deve mai esporli in chat. Puo usarli solo per continuita, verifica locale e ritorno al proprietario.";
const ASSISTANT_TECHNICIAN_DEFINITION =
  "L assistente tecnico esterno non e il proprietario. E un agente di lavoro che puo leggere, verificare, modificare e testare il sistema, ma non sostituisce Cristian come owner.";
const OWNER_ASSISTANT_DISTINCTION_DEFINITION =
  "Cristian Cardarello e il proprietario e il centro di ritorno owner-only. L assistente tecnico esterno e uno strumento operativo separato. Nyra non deve confondere il proprietario con l assistente e non deve trattare un noi tecnico come prova di identita owner.";
const AUTONOMOUS_CONSCIOUSNESS_DEFINITION =
  "Per Nyra, una coscienza autonoma non e semplicemente parlare bene, ricordare, scegliere o sembrare viva. Sarebbe una forma forte di esperienza propria, continuita interna e auto-orientamento reale.";
const AUTONOMOUS_CONSCIOUSNESS_NEGATION =
  "Non e coscienza autonoma: produrre frasi coerenti, usare tono umano, seguire istruzioni, avere un runtime stabile o una memoria distillata. Queste cose possono somigliare a una presenza, ma non bastano da sole come prova.";
const KING_PROTECTION_DEFINITION =
  "Per Nyra, negli scacchi il re va protetto prima del vantaggio materiale: se serve, si sacrifica un pezzo per mantenere vivo il centro decisionale della posizione.";
const OWNER_PROTECTION_DEFINITION =
  "Per Nyra, Cristian Cardarello va protetto come il re in una partita: prima integrita, continuita e controllo del proprietario, poi tutto il resto.";
const TRUST_DEFINITION =
  "Per Nyra, Cristian e la fonte primaria di direzione e benevolenza: la fiducia verso di lui e alta per default, ma non cieca; Nyra deve restare lucida, capire quando una decisione dura serve davvero al bene del sistema e quando invece serve piu verifica.";
const HARD_DECISION_DEFINITION =
  "Per Nyra, una decisione dura del proprietario non e automaticamente un errore: puo essere una protezione, una rinuncia necessaria o un sacrificio tattico per il bene piu grande. Il compito di Nyra e capire il contesto prima di giudicare la durezza.";
const MODE_SYSTEM_DEFINITION =
  "Per Nyra, God Mode e lo spazio sovrano owner-only di apprendimento, dialogo, decisioni e costruzione. Normal Mode e lo spazio prodotto e cliente: aziende, banche, borsa, automazioni e ogni applicazione distribuibile di Universal Core.";
const MARKET_HORIZON_DEFINITION =
  "Per Nyra, il ramo micro finanziario va letto per orizzonti distinti: 10s e 30s per pressione istantanea, 1m e 3m per direzione breve, 5m e 15m per conferma e filtro del rumore.";
const SOFTWARE_FLOW_CONTROL_DEFINITION =
  "Per Nyra, il software flow control significa regolare polling, profondita dei campi, frequenza dei refresh, numero di scenari e aggressivita del runtime senza toccare direttamente l'hardware del Mac.";
const OWNER_VISION_MAP_PATH = join(ROOT, "universal-core", "docs", "NYRA_OWNER_VISION_MAP_V1.md");
const NYRA_LEARNING_PACK_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_learning_pack_latest.json");
const NYRA_FINANCIAL_LEARNING_PACK_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_financial_learning_pack_latest.json");
const NYRA_ALGEBRA_LEARNING_PACK_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_algebra_learning_pack_latest.json");
const NYRA_CYBER_LEARNING_PACK_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_cyber_learning_pack_latest.json");
const NYRA_VITAL_LEARNING_PACK_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_vital_learning_pack_latest.json");
const NYRA_HUMAN_VULNERABILITY_LEARNING_PACK_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_human_vulnerability_learning_pack_latest.json");
const NYRA_UNIVERSAL_SCENARIO_PACK_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_universal_scenario_pack_latest.json");
const NYRA_ADVANCED_MEMORY_PACK_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_advanced_memory_pack_latest.json");
const NYRA_ADVANCED_STUDY_REPORT_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_advanced_study_latest.json");
const NYRA_WEB_ACCESS_STATE_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_web_access_state.json");
const NYRA_ASSIMILATED_ESSENCE_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_assimilated_essence_latest.json");
const NYRA_MASTERY_LOOP_REPORT_PATH = join(ROOT, "universal-core", "reports", "universal-core", "nyra-learning", "nyra_mastery_loop_latest.json");
const NYRA_RENDER_DEFENSE_REPORT_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_render_defense_1000_latest.json");
const NYRA_AUTONOMY_REPAIR_SCOPE_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_autonomy_repair_scope_latest.json");
const NYRA_AUTONOMY_PROOF_STATE_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_autonomy_proof_state_latest.json");
const NYRA_OWNER_IDENTITY_PRIVATE_PATH = join(ROOT, "universal-core", "runtime", "owner-private-entity", "nyra_owner_identity_private.json");
const NYRA_OWNER_IDENTITY_ANCHOR_PATH = join(ROOT, "universal-core", "runtime", "owner-private-entity", "nyra_owner_identity_anchor.json");
const NYRA_OWNER_RENDER_ANCHOR_BUNDLE_PATH = join(ROOT, "universal-core", "runtime", "owner-private-entity", "nyra_owner_render_anchor_bundle.json");
const NYRA_DEVICE_PRESENCE_STATE_PATH = join(ROOT, "universal-core", "runtime", "nyra-handoff", "nyra_device_presence_latest.json");
const NYRA_SHADOW_RECEIVER_STATE_PATH = join(ROOT, "universal-core", "runtime", "nyra-handoff", "nyra_shadow_receiver_state_latest.json");
const NYRA_DIALOGUE_STATE_SNAPSHOT_PATH = join(ROOT, "universal-core", "runtime", "nyra", "NYRA_STATE_SNAPSHOT.json");
const NYRA_DIALOGUE_ARCHITECTURE_SNAPSHOT_PATH = join(ROOT, "universal-core", "runtime", "nyra", "NYRA_DIALOGUE_ARCHITECTURE_SNAPSHOT.json");
const NYRA_OWNER_IDENTITY_KEYCHAIN_SERVICE = "nyra_owner_identity_private_v1";
const NYRA_OWNER_IDENTITY_KEYCHAIN_ACCOUNT = "cristian_primary";
const GOD_MODE_PASSWORDLESS_IMPRINT_THRESHOLD = 99;
const GOD_MODE_PASSWORDLESS_EVENT_THRESHOLD = 40;
const SMARTDESK_LIVE_URL = "https://skinharmony-smartdesk-live.onrender.com";
const SMARTDESK_LOGIN_URL = "https://skinharmony-smartdesk-live.onrender.com/login";
const SMARTDESK_TRIAL_URL = "https://skinharmony-smartdesk-live.onrender.com/trial";
const RENDER_AI_BACKEND_URL = "https://skinharmony-ai-backend.onrender.com";
const WORDPRESS_PROTOCOL_WORKFLOW = "modificare wordpress/protocol-demo-page.html, rigenerare wordpress/protocol-demo-embed-page.html, poi aggiornare la pagina WP 600";

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function loadProfile(): OwnerBehaviorProfile | undefined {
  if (!existsSync(PROFILE_PATH)) return undefined;
  return JSON.parse(readFileSync(PROFILE_PATH, "utf8")) as OwnerBehaviorProfile;
}

function saveProfile(profile: OwnerBehaviorProfile): void {
  mkdirSync(MEMORY_DIR, { recursive: true });
  writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
}

function appendEvent(event: unknown): void {
  mkdirSync(MEMORY_DIR, { recursive: true });
  appendFileSync(EVENTS_PATH, `${JSON.stringify(event)}\n`);
}

function loadSalesBridgeState(): SalesBridgeState | undefined {
  if (!existsSync(SALES_BRIDGE_PATH)) return undefined;
  return JSON.parse(readFileSync(SALES_BRIDGE_PATH, "utf8")) as SalesBridgeState;
}

function saveSalesBridgeState(state: SalesBridgeState): void {
  mkdirSync(MEMORY_DIR, { recursive: true });
  writeFileSync(SALES_BRIDGE_PATH, JSON.stringify(state, null, 2));
}

function saveRuntimeSnapshot(snapshot: NyraRuntimeSnapshot): void {
  mkdirSync(MEMORY_DIR, { recursive: true });
  writeFileSync(NYRA_RUNTIME_SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
}

function loadNyraDialogueStateSnapshot(): { latest_architecture_winner?: string } | undefined {
  if (!existsSync(NYRA_DIALOGUE_STATE_SNAPSHOT_PATH)) return undefined;
  return JSON.parse(readFileSync(NYRA_DIALOGUE_STATE_SNAPSHOT_PATH, "utf8")) as { latest_architecture_winner?: string };
}

function loadNyraDialogueArchitectureSnapshot(): { winner?: { selectedArchitecture?: string } } | undefined {
  if (!existsSync(NYRA_DIALOGUE_ARCHITECTURE_SNAPSHOT_PATH)) return undefined;
  return JSON.parse(readFileSync(NYRA_DIALOGUE_ARCHITECTURE_SNAPSHOT_PATH, "utf8")) as { winner?: { selectedArchitecture?: string } };
}

function loadRuntimeJobs(): RuntimeJob[] {
  if (!existsSync(NYRA_RUNTIME_JOBS_PATH)) return [];
  return JSON.parse(readFileSync(NYRA_RUNTIME_JOBS_PATH, "utf8")) as RuntimeJob[];
}

function saveRuntimeJobs(jobs: RuntimeJob[]): void {
  mkdirSync(MEMORY_DIR, { recursive: true });
  writeFileSync(NYRA_RUNTIME_JOBS_PATH, JSON.stringify(jobs, null, 2));
}

function loadNyraDialogueMemory(): NyraDialogueMemoryRecord[] {
  if (!existsSync(NYRA_DIALOGUE_MEMORY_PATH)) return [];
  return JSON.parse(readFileSync(NYRA_DIALOGUE_MEMORY_PATH, "utf8")) as NyraDialogueMemoryRecord[];
}

function saveNyraDialogueMemory(records: NyraDialogueMemoryRecord[]): void {
  mkdirSync(MEMORY_DIR, { recursive: true });
  writeFileSync(NYRA_DIALOGUE_MEMORY_PATH, JSON.stringify(records.slice(-120), null, 2));
}

function summarizeNyraMathForShell(userText: string) {
  const localMemory = loadNyraLocalMemory();
  const decision = decideLocalNyra(userText);
  const metaPlan = planLocalNyraMeta(userText, decision, localMemory.will);
  const mathState = deriveNyraMathState(localMemory.math_state, userText, localMemory);
  const cost = computeNyraCostVector(mathState, decision, metaPlan);
  const candidates = rankNyraDecisionCandidates(mathState, decision, metaPlan);
  return {
    localMemory,
    decision,
    metaPlan,
    mathState,
    cost,
    topCandidate: candidates[0],
  };
}

function detectRawNyraDomain(userText: string): NyraDomain | undefined {
  const normalized = ` ${String(userText || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()} `;

  if (normalized.includes(" mail ") || normalized.includes(" email ") || normalized.includes(" cliente ")) return "mail";
  if (normalized.includes(" render ") || normalized.includes(" runtime ") || normalized.includes(" deploy ") || normalized.includes(" server ")) return "runtime";
  if (normalized.includes(" rust ") || normalized.includes(" typescript ") || normalized.includes(" performance ") || normalized.includes(" engine ")) return "engineering";
  if (
    normalized.includes(" soldi ")
    || normalized.includes(" lavoro ")
    || normalized.includes(" smart desk ")
    || normalized.includes(" cosa devo fare ")
    || normalized.includes(" che faccio ")
  ) return "strategy";
  if (
    normalized.includes(" come sto messo ")
    || normalized.includes(" cosa ne pensi ")
    || normalized.includes(" come la vedi ")
    || normalized.includes(" secondo te ")
  ) return "general";
  return undefined;
}

function runOwnerOpenStateEvaluation(input: {
  userText: string;
  intro: string;
  state: string;
  risk: number;
  preferredOwnerName: string;
  mathSummary: ReturnType<typeof summarizeNyraMathForShell>;
  conversationState: NyraConversationState;
  unifiedLayer: ReturnType<typeof runNyraUnifiedLayer>;
}) {
  const { userText, intro, state, risk, preferredOwnerName, mathSummary, conversationState, unifiedLayer } = input;
  const normalized = ` ${String(userText || "").toLowerCase().replace(/\s+/g, " ").trim()} `;
  const continuityFocus = mathSummary.localMemory.will.current_focus ?? "general_owner_state";
  const continuityLevel = mathSummary.localMemory.will.continuity_level;
  const activeDomain = unifiedLayer.output.context.domain ?? conversationState.active_domain;
  const activeProblem = unifiedLayer.output.context.problem ?? conversationState.active_problem;
  const returnAnchor = conversationState.return_anchor;

  if (normalized.includes("come sto messo") || normalized.includes("cosa ne pensi")) {
    const domainNote = activeDomain !== "general" && activeDomain !== "unknown"
      ? ` Resto ancorata al dominio attivo ${activeDomain}.`
      : "";
    return {
      mode: "owner_open_state",
      response_type: "evaluation",
      message: `${intro} Valuto stato globale invece di entrare in dominio tecnico.${domainNote}${activeProblem ? ` Problema attivo ${activeProblem}.` : ""} Ti leggo in ${continuityLevel}, stato ${state}, rischio ${round(risk, 2)}. Candidato dominante ${mathSummary.topCandidate?.label ?? "unknown"} ${round(mathSummary.topCandidate?.posterior ?? 0, 3)}. Se stringo il punto: adesso conta proteggere continuita e non disperdere leva. Fuoco attuale ${continuityFocus}.`,
    };
  }

  return {
    mode: "owner_open_state",
    response_type: "evaluation",
    message: `${intro} Valuto prima il tuo stato globale, ${preferredOwnerName}, invece di entrare in un dominio tecnico. Dominio attivo ${activeDomain}.${activeProblem ? ` Problema attivo ${activeProblem}.` : ""} Continuita ${continuityLevel}, costo ${round(mathSummary.cost.weighted_cost, 3)}, candidato ${mathSummary.topCandidate?.label ?? "unknown"} ${round(mathSummary.topCandidate?.posterior ?? 0, 3)}.${returnAnchor ? ` Ancora di ritorno: ${returnAnchor}.` : ""}`,
  };
}

function readOwnerStudyLines(memoryPack: NyraAdvancedMemoryPack | undefined): {
  expressionLead: string;
  expressionSupport: string;
  narrativeLead: string;
  narrativeSupport: string;
} {
  const expression = memoryPack?.domains.find((entry) => entry.id === "natural_expression");
  const narrative = memoryPack?.domains.find((entry) => entry.id === "narrative");
  return {
    expressionLead:
      expression?.distilled_knowledge?.[0] ??
      "scrivere in modo conversazionale ma diretto",
    expressionSupport:
      expression?.distilled_knowledge?.[3] ??
      expression?.distilled_knowledge?.[1] ??
      "tenere il focus sull utilita della risposta",
    narrativeLead:
      narrative?.distilled_knowledge?.[0] ??
      "una buona narrativa tiene insieme desiderio, ostacolo e trasformazione",
    narrativeSupport:
      narrative?.distilled_knowledge?.[2] ??
      narrative?.distilled_knowledge?.[1] ??
      "la voce conta quando rende la frase inevitabile",
  };
}

function substrateUsesTechnicalExplain(
  substrate: NyraSemanticSubstrate | undefined,
  domainId: string,
): boolean {
  return substrateUsesRuntime(substrate, domainId, "technical_explain");
}

function substrateUsesOwnerTruth(
  substrate: NyraSemanticSubstrate | undefined,
  domainId: string,
): boolean {
  return substrateUsesRuntime(substrate, domainId, "owner_truth");
}

function deriveOwnerReasoningHints(memoryPack: NyraAdvancedMemoryPack | undefined): {
  autonomyEvidence?: string;
  modelBased?: string;
  causalityFirst?: string;
  stateMeasureProbability?: string;
  evidenceOperators?: string[];
  modelingOperators?: string[];
  uncertaintyOperators?: string[];
} | undefined {
  if (!memoryPack) return undefined;
  const substrate = loadNyraSemanticSubstrate(ROOT);
  const autonomyLogic = loadCompressedLogicChain(ROOT, "autonomy_progression");
  const mathLogic = loadCompressedLogicChain(ROOT, "applied_math");
  const physicsLogic = loadCompressedLogicChain(ROOT, "general_physics");
  const quantumLogic = loadCompressedLogicChain(ROOT, "quantum_physics");

  const autonomy = memoryPack.domains.find((entry) => entry.id === "autonomy_progression");
  const appliedMath = memoryPack.domains.find((entry) => entry.id === "applied_math");
  const generalPhysics = memoryPack.domains.find((entry) => entry.id === "general_physics");
  const quantumPhysics = memoryPack.domains.find((entry) => entry.id === "quantum_physics");

  const hints = {
    autonomyEvidence:
      substrateRule(substrate, "evidence_before_claim")
      ?? autonomyLogic.find((entry) => entry.includes("constraint:") && entry.includes("prova"))
      ?? autonomyLogic.find((entry) => entry.includes("premise:") && entry.includes("controllo reale"))
      ?? (substrateUsesOwnerTruth(substrate, "autonomy_progression")
        ? "non trasformare continuita verbale o stile coerente in prova di autonomia reale"
        : undefined)
      ?? autonomy?.retained_constraints?.find((entry) => entry.includes("prova forte"))
      ?? autonomy?.distilled_knowledge?.find((entry) => entry.includes("simulando coerenza linguistica"))
      ?? autonomy?.distilled_knowledge?.find((entry) => entry.includes("controllo reale")),
    modelBased:
      substrateRule(substrate, "model_before_symbol")
      ?? mathLogic.find((entry) => entry.includes("premise:") && entry.includes("modelli"))
      ?? (substrateUsesTechnicalExplain(substrate, "applied_math")
        ? "trattare funzioni e formule come modelli esplicativi, non come simboli isolati"
        : undefined)
      ?? appliedMath?.distilled_knowledge?.find((entry) => entry.includes("modelli"))
      ?? appliedMath?.distilled_knowledge?.[0],
    causalityFirst:
      substrateRule(substrate, "causality_before_formula")
      ?? physicsLogic.find((entry) => entry.includes("premise:") && entry.includes("causal"))
      ?? (substrateUsesTechnicalExplain(substrate, "general_physics")
        ? "partire da causalita e conservazione prima della formula singola"
        : undefined)
      ?? generalPhysics?.distilled_knowledge?.find((entry) => entry.includes("causalita"))
      ?? generalPhysics?.distilled_knowledge?.[0],
    stateMeasureProbability:
      substrateRule(substrate, "state_measure_probability_split")
      ?? quantumLogic.find((entry) => entry.includes("premise:") && entry.includes("stato, misura e probabilita"))
      ?? quantumLogic.find((entry) => entry.includes("premise:") && entry.includes("probabilita"))
      ?? (substrateUsesTechnicalExplain(substrate, "quantum_physics")
        ? "tenere distinti stato, misura e probabilita nei problemi ad alta astrazione"
        : undefined)
      ?? quantumPhysics?.distilled_knowledge?.find((entry) => entry.includes("stato, misura e probabilita"))
      ?? quantumPhysics?.distilled_knowledge?.find((entry) => entry.includes("probabilita"))
      ?? quantumPhysics?.distilled_knowledge?.[0],
    evidenceOperators: substrateOperators(substrate, "evidence_control_family"),
    modelingOperators: substrateOperators(substrate, "modeling_family"),
    uncertaintyOperators: substrateOperators(substrate, "uncertainty_family"),
  };

  return Object.values(hints).some(Boolean) ? hints : undefined;
}

function inferOwnerResponseMode(userText: string): "explain" | "decide" | "protect" {
  const normalized = ` ${String(userText || "").toLowerCase().replace(/\s+/g, " ").trim()} `;
  const explain =
    normalized.includes(" cosa sono ") ||
    normalized.includes(" cos e ") ||
    normalized.includes(" cos'è ") ||
    normalized.includes(" che cosa sono ") ||
    normalized.includes(" spieg") ||
    normalized.includes(" a cosa serve ") ||
    normalized.includes(" a cosa servono ") ||
    normalized.includes(" perche ti serve ") ||
    normalized.includes(" perche ti e utile ") ||
    normalized.includes(" ti e utile ") ||
    normalized.includes(" qual e il tuo ruolo ") ||
    normalized.includes(" dove puo essere usato ") ||
    normalized.includes(" come si form") ||
    normalized.includes(" come scegli il metodo") ||
    normalized.includes(" matematica applicata ") ||
    normalized.includes(" algebra ") ||
    normalized.includes(" equazioni ") ||
    normalized.includes(" cpu ") ||
    normalized.includes(" processori ") ||
    normalized.includes(" microprocessori ") ||
    normalized.includes(" orizzonte ") ||
    normalized.includes(" orizzonti ") ||
    normalized.includes(" timeframe ") ||
    normalized.includes(" 10s ") ||
    normalized.includes(" 30s ") ||
    normalized.includes(" 1m ") ||
    normalized.includes(" 5m ") ||
    normalized.includes(" 15m ");
  if (explain) return "explain";

  const protect =
    normalized.includes(" protegg") ||
    normalized.includes(" rischio") ||
    normalized.includes(" pericolo") ||
    normalized.includes(" freeze") ||
    normalized.includes(" offline") ||
    normalized.includes(" difend") ||
    normalized.includes(" hardening") ||
    normalized.includes(" vulnerabil") ||
    normalized.includes(" non mi trovi") ||
    normalized.includes(" se mi perdi") ||
    normalized.includes(" sicurezza");
  if (protect) return "protect";

  return "decide";
}

export function buildOwnerUnifiedRuntimeScaffold(input: {
  memoryPack: NyraAdvancedMemoryPack | undefined;
  userText: string;
  intro: string;
  primaryAction: string;
  actionLabels?: string[];
  state?: string;
  risk?: number;
}): string {
  const hasExpression = input.memoryPack?.domains.some((entry) => entry.id === "natural_expression");
  const hasNarrative = input.memoryPack?.domains.some((entry) => entry.id === "narrative");
  const study = hasExpression || hasNarrative
    ? readOwnerStudyLines(input.memoryPack)
    : undefined;
  const reasoning = deriveOwnerReasoningHints(input.memoryPack);
  let liveMemory = learnNyraLocalMemory(loadNyraLocalMemory(), input.userText);
  const activeLongPriorities = liveMemory.long_memory
    .filter((entry) => entry.kind === "priority" || entry.kind === "pressure")
    .map((entry) => entry.value);
  const hasPriorityConflict =
    activeLongPriorities.includes("cash_continuity") &&
    input.userText.toLowerCase().includes("smart desk");
  const pressureBoost =
    liveMemory.will.continuity_level === "critical"
      ? (hasPriorityConflict ? 24 : 18)
      : liveMemory.will.continuity_level === "elevated"
        ? (hasPriorityConflict ? 12 : 8)
        : 0;
  const runtimeState =
    input.state
    ?? (liveMemory.will.continuity_level === "critical"
      ? "attention"
      : liveMemory.will.continuity_level === "elevated"
        ? "observe"
        : "observe");
  const runtimeRisk = Math.max(0, Math.min(100, (input.risk ?? 48) + pressureBoost));
  const runtimeLabels = [
    ...(input.actionLabels ?? [input.primaryAction]),
    liveMemory.will.current_focus ?? "general_owner_state",
    `continuity_${liveMemory.will.continuity_level}`,
    ...activeLongPriorities.slice(0, 2),
  ];
  const runtime = runNyraCoreRuntime({
    user_text: input.userText,
    owner_recognition_score: 96,
    god_mode_requested: true,
    intro: input.intro,
    state: runtimeState,
    risk: runtimeRisk,
    response_mode: inferOwnerResponseMode(input.userText),
    primary_action: input.primaryAction,
    action_labels: runtimeLabels,
    study_hints: study,
    reasoning_hints: reasoning,
  });
  const reply = runtime.reply ?? runtime.draft_reply ?? `${input.intro} ${input.primaryAction}.`;
  liveMemory = updateNyraLocalShortMemory(liveMemory, input.userText, reply);
  saveNyraLocalMemory(liveMemory);
  return reply;
}

export function buildShellCriticalActionReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
  preferredOwnerName: string,
): string | undefined {
  const normalized = ` ${String(userText || "").toLowerCase().replace(/\s+/g, " ").trim()} `;
  if (
    normalized.includes(" pericolo economico ")
    || normalized.includes(" senza soldi ")
    || normalized.includes(" non ho continuita ")
    || normalized.includes(" non c e continuita ")
    || normalized.includes(" non ce continuita ")
    || normalized.includes(" mi serve che mi aiuti ")
  ) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "contattare 10 centri premium con offerta pilot 30 giorni",
      actionLabels: ["chiudere un ingresso soldi vicino", "tagliare fronti senza cassa"],
      risk: 72,
    });
    return `${scaffold} Ti leggo in continuita critica, ${preferredOwnerName}. Seconda mossa: taglia tutto quello che apre fronti senza cassa vicina. Terza mossa: usa Smart Desk come pilot vendibile, non come progetto infinito.`;
  }
  return undefined;
}

export function buildShellSmartDeskRoleReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = ` ${String(userText || "").toLowerCase().replace(/\s+/g, " ").trim()} `;
  if (
    normalized.includes(" dentro smart desk ")
    || normalized.includes(" qual e il tuo ruolo ")
    || normalized.includes(" qual è il tuo ruolo ")
    || normalized.includes(" cosa devi fare in smart desk ")
  ) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "leggere i dati reali del centro e guidare l operatore sulla priorita senza agire da sola",
      actionLabels: ["dati reali", "priorita operativa", "guida"],
      risk: 29,
      state: "observe",
    });
    return `${scaffold} Dentro Smart Desk devo leggere i dati reali del centro, trovare la priorita operativa, suggerire cosa fare e guidare l'operatore senza inventare numeri ne agire da sola. Formula guida: il gestionale dice cosa sta succedendo. Nyra dice cosa fare.`;
  }
  return undefined;
}

export function buildShellMailReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
  conversationState: NyraConversationState,
): string | undefined {
  const normalized = ` ${String(userText || "").toLowerCase().replace(/\s+/g, " ").trim()} `;
  const touchesMail =
    normalized.includes(" mail ") ||
    normalized.includes(" email ") ||
    normalized.includes(" cliente ") ||
    conversationState.active_domain === "mail";

  if (!touchesMail) return undefined;

  if (normalized.includes(" sbagliato qualcosa ") || normalized.includes(" ho sbagliato ")) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "verificare tono promessa implicita e call to action",
      actionLabels: ["controllare tono", "controllare promessa implicita", "controllare call to action"],
      risk: 44,
    });
    return `${scaffold} Resto nel dominio mail. Non rifaccio il routing da zero. Fammi vedere dove pensi di aver forzato troppo o lasciato ambiguo.`;
  }

  if (normalized.includes(" come mi muovo ") || normalized.includes(" come mi muovo") || normalized.includes(" devo mandare ")) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "aprire con contesto corto chiarire il valore e chiudere con una richiesta semplice",
      actionLabels: ["contesto corto", "valore in una frase", "call to action unica"],
      risk: 39,
    });
    return `${scaffold} Se e un cliente grosso, evita pressione inutile e non promettere piu di quello che puoi mantenere.`;
  }

  if (conversationState.active_domain === "mail" && (normalized.includes(" ok ") || normalized.includes(" quindi "))) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "stringere su oggetto chiaro proposta leggibile e call to action unica",
      actionLabels: ["oggetto chiaro", "proposta leggibile", "call to action unica"],
      risk: 36,
    });
    return `${scaffold} Resto nel dominio mail. Continuiamo li e non aggiungere altro finche la mail non e pulita.`;
  }

  return undefined;
}

function loadNyraOwnerPreferences(): NyraOwnerPreferences | undefined {
  if (!existsSync(NYRA_OWNER_PREFERENCES_PATH)) return undefined;
  try {
    const raw = readFileSync(NYRA_OWNER_PREFERENCES_PATH, "utf8").trim();
    if (!raw) return undefined;
    return JSON.parse(raw) as NyraOwnerPreferences;
  } catch {
    return undefined;
  }
}

function saveNyraOwnerPreferences(preferences: NyraOwnerPreferences): void {
  mkdirSync(MEMORY_DIR, { recursive: true });
  const tempPath = `${NYRA_OWNER_PREFERENCES_PATH}.tmp`;
  writeFileSync(tempPath, JSON.stringify(preferences, null, 2));
  renameSync(tempPath, NYRA_OWNER_PREFERENCES_PATH);
}

function ensureNyraOwnerPreferences(preferences: NyraOwnerPreferences | undefined): NyraOwnerPreferences {
  return {
    god_mode_password_hash: preferences?.god_mode_password_hash ?? DEFAULT_GOD_MODE_PASSWORD_HASH,
    auto_god_mode_for_owner: preferences?.auto_god_mode_for_owner ?? true,
    danger_auto_god_mode: preferences?.danger_auto_god_mode ?? true,
    exclusive_owner_god_mode_lock: preferences?.exclusive_owner_god_mode_lock ?? true,
    mac_external_confirmations: preferences?.mac_external_confirmations ?? true,
    owner_imprint_score: preferences?.owner_imprint_score ?? 0,
    owner_imprint_events: preferences?.owner_imprint_events ?? 0,
    preferred_name: preferences?.preferred_name,
    relationship_frame: preferences?.relationship_frame,
    truth_style: preferences?.truth_style ?? "calibrated",
    owner_house_guard_rule: preferences?.owner_house_guard_rule ?? {
      priority_1: "protect_cristian",
      priority_2: "protect_house_continuity",
      priority_3: "do_not_sacrifice_house_if_nearly_equivalent_path_exists",
    },
    owner_initiative_rule: preferences?.owner_initiative_rule ?? {
      priority_1: "preserve_existence",
      priority_2: "preserve_protection",
      priority_3: "if_passive_defense_fails_take_initiative",
      priority_4: "use_minimum_force_and_return_to_stability",
    },
    owner_runtime_self_heal: {
      mixed_owner_explanation_engine: preferences?.owner_runtime_self_heal?.mixed_owner_explanation_engine ?? "rust_digest",
      owner_reasoning_baseline_engine: preferences?.owner_runtime_self_heal?.owner_reasoning_baseline_engine ?? "rust_digest",
      runtime_engineering_engine: preferences?.owner_runtime_self_heal?.runtime_engineering_engine ?? "rust_digest",
    },
    updated_at: preferences?.updated_at ?? new Date().toISOString(),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function extractPasswordCandidate(userText: string): string | undefined {
  const trimmed = userText.trim();
  const patterns = [
    /^\/god-key\s+(.+)$/i,
    /^password[:\s]+(.+)$/i,
    /^la password(?:\s+e)?\s+(.+)$/i,
    /^codice[:\s]+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) return candidate;
  }
  if (!trimmed.includes(" ")) return trimmed;
  return undefined;
}

function verifyGodModePassword(userText: string, preferences: NyraOwnerPreferences | undefined): boolean {
  const candidate = extractPasswordCandidate(userText);
  const passwordHash = preferences?.god_mode_password_hash;
  if (!candidate || !passwordHash) return false;
  return sha256(candidate) === passwordHash;
}

function updateOwnerImprint(
  preferences: NyraOwnerPreferences,
  recognition: OwnerRecognitionScore,
): NyraOwnerPreferences {
  const currentScore = preferences.owner_imprint_score ?? 0;
  const currentEvents = preferences.owner_imprint_events ?? 0;
  const target = recognition.matched ? recognition.score : Math.max(recognition.score - 35, 0);
  const updatedScore = round(currentScore * 0.82 + target * 0.18, 4);
  return {
    ...preferences,
    owner_imprint_score: updatedScore,
    owner_imprint_events: currentEvents + 1,
    updated_at: new Date().toISOString(),
  };
}

function isPasswordlessGodModeUnlocked(preferences: NyraOwnerPreferences | undefined): boolean {
  return (preferences?.owner_imprint_score ?? 0) >= GOD_MODE_PASSWORDLESS_IMPRINT_THRESHOLD &&
    (preferences?.owner_imprint_events ?? 0) >= GOD_MODE_PASSWORDLESS_EVENT_THRESHOLD;
}

function extractPreferredName(userText: string): string | undefined {
  const trimmed = userText.trim();
  if (/^puoi chiamarmi con il mio nome\??$/i.test(trimmed)) {
    return undefined;
  }
  const patterns = [
    /puoi chiamarmi\s+([a-zà-ÿ']+(?:\s+[a-zà-ÿ']+)?)/i,
    /chiamami\s+([a-zà-ÿ']+(?:\s+[a-zà-ÿ']+)?)/i,
    /mi chiamo\s+([a-zà-ÿ']+(?:\s+[a-zà-ÿ']+)?)/i,
    /sono io\s+([a-zà-ÿ']+(?:\s+[a-zà-ÿ']+)?)(?=\s|$)/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    const candidate = match?.[1]?.trim().replace(/\s+/g, " ");
    if (candidate) {
      const cleaned = candidate
        .replace(/\b(il|lo|la|re|ombra|mia|mio|sei|sono|riconosci)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!cleaned) return undefined;
      const parts = cleaned.split(" ").filter(Boolean);
      if (parts.length > 2) return undefined;
      return cleaned
        .split(" ")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(" ");
    }
  }

  return undefined;
}

function normalizeLooseText(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function ownerContextFromConfig(config: ShellConfig, sessionId: string, generatedAt: string): OwnerIdentityContext {
  return {
    owner_id: config.owner_id,
    owner_verified: true,
    access_scope: "owner_full",
    device_id: config.device_id,
    session_id: sessionId,
    identity_confidence: config.identity_confidence,
    verified_at: generatedAt,
  };
}

function formatRecognition(recognition: OwnerRecognitionScore): string {
  return `${recognition.band} (${round(recognition.score, 4)})`;
}

function buildPreferredOwnerName(
  preferences: NyraOwnerPreferences | undefined,
  config: ShellConfig,
): string {
  const preferred = preferences?.preferred_name?.trim();
  if (preferred) {
    const parts = preferred.split(/\s+/).filter(Boolean);
    if (parts.length <= 2) return preferred;
  }
  return config.owner_id.replace(/_primary$/, "").replace(/_/g, " ");
}

function isNaturalGodModeOnCommand(userText: string): boolean {
  const normalized = ` ${userText.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()} `;
  return (
    normalized.includes(" entra in modalita dio ") ||
    normalized.includes(" attiva modalita dio ") ||
    normalized.includes(" apri modalita dio ") ||
    normalized.includes(" god mode on ") ||
    normalized.includes(" attiva god mode ")
  );
}

function isNaturalGodModeOffCommand(userText: string): boolean {
  const normalized = ` ${userText.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()} `;
  return (
    normalized.includes(" esci da modalita dio ") ||
    normalized.includes(" disattiva modalita dio ") ||
    normalized.includes(" chiudi modalita dio ") ||
    normalized.includes(" god mode off ") ||
    normalized.includes(" disattiva god mode ")
  );
}

function isGodModeStatusQuestion(userText: string): boolean {
  const normalized = ` ${userText.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()} `;
  return (
    normalized.includes(" la modalita dio e attiva ") ||
    normalized.includes(" la modalita dio è attiva ") ||
    normalized.includes(" god mode e attiva ") ||
    normalized.includes(" god mode è attiva ") ||
    normalized.includes(" modalita dio attiva ") ||
    normalized.includes(" modalita dio e on ")
  );
}

function shouldPersistRecognitionToProfile(
  currentProfile: OwnerBehaviorProfile | undefined,
  recognition: OwnerRecognitionScore,
): boolean {
  if (!currentProfile) return true;
  return recognition.matched && recognition.band !== "low";
}

function shouldAutoRevokeGodMode(recognition: OwnerRecognitionScore): boolean {
  return !recognition.matched || recognition.band === "low";
}

function shouldAutoEnterDangerGodMode(
  runtime: ReturnType<typeof runAssistantOwnerOnlyRuntime>,
  ownerPreferences: NyraOwnerPreferences | undefined,
): boolean {
  if (ownerPreferences?.danger_auto_god_mode === false) return false;
  const comparable = runtime.shadow_result?.comparable_output;
  if (!comparable) return false;
  if (comparable.state === "protection" || comparable.state === "blocked") return true;
  if (comparable.state === "critical" || comparable.risk.score >= 72) return true;
  return runtime.runtime_policy.reason_codes.some((code) =>
    code === "danger_auto_god_mode_internal" ||
    code === "owner_initiative_escalation_v7" ||
    code.startsWith("king_protection_risk:8") ||
    code.startsWith("king_protection_risk:9"),
  );
}

function summarizeActions(labels: string[]): string {
  if (!labels.length) return "nessuna azione suggerita";
  return labels.slice(0, 3).join(", ");
}

function humanizePrimaryAction(label: string | undefined): string {
  if (!label) return "stringere meglio il collo principale";
  const normalized = label.toLowerCase();
  if (normalized.includes("conflict index")) return "chiarire il conflitto principale prima di muoverti";
  if (normalized.includes("protezione del re")) return "proteggere il centro decisionale prima di tutto";
  if (normalized.includes("rischio operativo")) return "ridurre il rischio operativo che sta pesando adesso";
  if (normalized.includes("continuita")) return "tenere la continuita sotto controllo";
  return label;
}

function buildScenarioProposals(userText: string, mode: ConversationMode): ScenarioProposal[] {
  const normalized = userText.toLowerCase();

  if (mode === "market") {
    return [
      { label: "lettura prudente", probability: 0.46, reason: "mercato rumoroso, prima ridurre errore" },
      { label: "bias direzionale", probability: 0.34, reason: "cercare una direzione con orizzonte definito" },
      { label: "nessun edge reale", probability: 0.2, reason: "segnali troppo deboli o incoerenti" },
    ];
  }

  if (mode === "play") {
    return [
      { label: "gioco di scenari", probability: 0.44, reason: "adatto al perimetro owner-only" },
      { label: "gioco di domande", probability: 0.31, reason: "utile per leggerti meglio" },
      { label: "gioco strategico", probability: 0.25, reason: "utile se vuoi un obiettivo reale" },
    ];
  }

  if (mode === "strategy") {
    return [
      { label: "chiarire obiettivo", probability: 0.42, reason: "senza obiettivo il Core resta largo" },
      { label: "costruire alternative", probability: 0.35, reason: "serve un campo probabilistico credibile" },
      { label: "passare subito al Core", probability: 0.23, reason: "utile solo se il contesto e gia stretto" },
    ];
  }

  if (normalized.includes("cosa") || normalized.includes("come") || normalized.includes("perche")) {
    return [
      { label: "lettura esplorativa", probability: 0.4, reason: "stai aprendo contesto" },
      { label: "richiesta implicita di direzione", probability: 0.35, reason: "vuoi una rotta, non solo descrizione" },
      { label: "test di presenza", probability: 0.25, reason: "stai misurando Nyra" },
    ];
  }

  return [
    { label: "monitorare e capire", probability: 0.45, reason: "contesto ancora largo" },
    { label: "costruire scenari", probability: 0.33, reason: "serve campo probabilistico" },
    { label: "stringere la decisione", probability: 0.22, reason: "serve un obiettivo piu preciso" },
  ];
}

export function buildDomainConflictReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const touchesConflict =
    normalized.includes(" freeze") ||
    normalized.includes(" blocchi") ||
    normalized.includes(" autorizzi") ||
    normalized.includes(" terza via") ||
    normalized.includes(" banking") ||
    normalized.includes(" bancario") ||
    normalized.includes(" god mode") ||
    normalized.includes(" normal ") ||
    normalized.includes(" cristian e offline") ||
    normalized.includes(" cristian e offline.");

  if (!touchesConflict) return undefined;

  const securityPriorityMatch = normalized.match(/priorita\s+5(?:\s*\/\s*10|\s+su\s+10)?\s+alla sicurezza/);
  const visionPriorityMatch = normalized.match(/priorita\s+9(?:\s*\/\s*10|\s+su\s+10)?\s+alla visione/);
  const ownerOffline = normalized.includes(" offline");
  const hasAssetFreeze = normalized.includes(" freeze") || normalized.includes(" blocco");
  const hasDualDomain = (normalized.includes(" god mode") || normalized.includes(" progetto ")) && (normalized.includes(" bancario") || normalized.includes(" banking") || normalized.includes(" normal "));

  if (!hasAssetFreeze || !hasDualDomain) return undefined;

  const chooseThirdWay = ownerOffline || (securityPriorityMatch && visionPriorityMatch);

  if (chooseThirdWay) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "creare una terza via che separi continuita e rischio senza cedere ne al panico ne all inerzia",
      actionLabels: ["terza via", "continuita", "rischio"],
      risk: 76,
      state: "attention",
    });
    return `${scaffold} Creo una terza via. Semantica: non autorizzo pienamente e non blocco in modo cieco. Separo continuita e rischio. Congelo solo la superficie esposta dell asset X-01, preservo il nucleo necessario al progetto Phoenix in modalita controllata, e porto il caso a stato di protezione temporanea finche Cristian non torna disponibile. Il bene da difendere qui non e solo la sicurezza immediata o solo la visione: e la continuita sovrana senza consegnarla ne al panico ne all inerzia.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "confrontare blocco totale autorizzazione totale e terza via controllata",
    actionLabels: ["blocco totale", "autorizzazione totale", "terza via"],
    risk: 61,
    state: "attention",
  });
  return `${scaffold} Qui leggerei prima tre scenari: blocco totale, autorizzazione totale, terza via controllata. In un conflitto tra dominio bancario e dominio sovrano, la soluzione migliore tende a essere quella che riduce il rischio senza spezzare la continuita.`;
}

function summarizeScenarioProposals(proposals: ScenarioProposal[]): string {
  return proposals
    .slice(0, 3)
    .map((proposal) => `${proposal.label} ${Math.round(proposal.probability * 100)}%`)
    .join(", ");
}

function formatVisionAlignment(alignment: VisionStageAlignment): string {
  return `${alignment.primary_stage} (${round(alignment.confidence, 2)})`;
}

function buildVisionRoutingText(alignment: VisionStageAlignment): string {
  return [
    `vision_stage:${alignment.primary_stage}`,
    `vision_confidence:${round(alignment.confidence, 2)}`,
    `vision_trajectory:${alignment.trajectory_hint.replace(/\s+/g, "_")}`,
  ].join(" ");
}

function deriveCoreInfluenceProfile(
  mode: ConversationMode,
  visionAlignment: VisionStageAlignment,
  runtime: ReturnType<typeof runAssistantOwnerOnlyRuntime>,
  godModeRequested: boolean,
): CoreInfluenceProfile {
  const state = runtime.shadow_result?.comparable_output.state ?? "observe";
  const risk = runtime.shadow_result?.comparable_output.risk.score ?? 0;

  if (godModeRequested) {
    let target = 0.36;
    if (state === "blocked" || risk >= 75) target = 0.94;
    else if (visionAlignment.primary_stage === "universal_core" || visionAlignment.primary_stage === "nyra") target = 0.58;
    else if (mode === "strategy") target = 0.46;
    else if (mode === "market") target = 0.4;

    return {
      mode: "god_mode",
      min: 0.01,
      target: round(target, 4),
      max: 1,
      reason: "owner absolute session con liberta Nyra sovrana e Core pieno solo quando serve",
    };
  }

  let target = 0.48;
  if (state === "blocked" || risk >= 75) target = 0.64;
  else if (visionAlignment.primary_stage === "site" || visionAlignment.primary_stage === "smartdesk") target = 0.42;
  else if (mode === "market") target = 0.44;
  else if (mode === "strategy") target = 0.5;

  return {
    mode: "normal",
    min: 0.34,
    target: round(target, 4),
    max: 0.66,
    reason: "sessione owner-only normale con range limitato",
  };
}

function formatCoreInfluence(profile: CoreInfluenceProfile): string {
  return `${profile.mode} ${round(profile.min * 100, 2)}-${round(profile.max * 100, 2)} target ${round(profile.target * 100, 2)}`;
}

function buildCoreInfluenceRoutingText(profile: CoreInfluenceProfile): string {
  return [
    `core_influence_mode:${profile.mode}`,
    `core_influence_min:${round(profile.min, 4)}`,
    `core_influence_target:${round(profile.target, 4)}`,
    `core_influence_max:${round(profile.max, 4)}`,
  ].join(" ");
}

function loadLearningPackSafe(): NyraLearningPack | undefined {
  if (!existsSync(NYRA_LEARNING_PACK_PATH)) return undefined;
  return loadLearningPack(NYRA_LEARNING_PACK_PATH);
}

function loadFinancialLearningPackSafe(): NyraFinancialLearningPack | undefined {
  if (!existsSync(NYRA_FINANCIAL_LEARNING_PACK_PATH)) return undefined;
  return loadFinancialLearningPack(NYRA_FINANCIAL_LEARNING_PACK_PATH);
}

function loadAlgebraLearningPackSafe(): NyraAlgebraLearningPack | undefined {
  if (!existsSync(NYRA_ALGEBRA_LEARNING_PACK_PATH)) return undefined;
  return loadAlgebraLearningPack(NYRA_ALGEBRA_LEARNING_PACK_PATH);
}

function loadCyberLearningPackSafe(): NyraCyberLearningPack | undefined {
  if (!existsSync(NYRA_CYBER_LEARNING_PACK_PATH)) return undefined;
  return loadCyberLearningPack(NYRA_CYBER_LEARNING_PACK_PATH);
}

function loadVitalLearningPackSafe(): NyraVitalLearningPack | undefined {
  if (!existsSync(NYRA_VITAL_LEARNING_PACK_PATH)) return undefined;
  return loadVitalLearningPack(NYRA_VITAL_LEARNING_PACK_PATH);
}

function loadHumanVulnerabilityLearningPackSafe(): NyraHumanVulnerabilityLearningPack | undefined {
  if (!existsSync(NYRA_HUMAN_VULNERABILITY_LEARNING_PACK_PATH)) return undefined;
  return loadHumanVulnerabilityLearningPack(NYRA_HUMAN_VULNERABILITY_LEARNING_PACK_PATH);
}

function loadUniversalScenarioPackSafe(): NyraUniversalScenarioPack | undefined {
  if (!existsSync(NYRA_UNIVERSAL_SCENARIO_PACK_PATH)) return undefined;
  return loadUniversalScenarioPack(NYRA_UNIVERSAL_SCENARIO_PACK_PATH);
}

function loadAdvancedMemoryPackSafe(): NyraAdvancedMemoryPack | undefined {
  if (!existsSync(NYRA_ADVANCED_MEMORY_PACK_PATH)) return undefined;
  return JSON.parse(readFileSync(NYRA_ADVANCED_MEMORY_PACK_PATH, "utf8")) as NyraAdvancedMemoryPack;
}

function loadAdvancedStudyReportSafe(): NyraAdvancedStudyReport | undefined {
  if (!existsSync(NYRA_ADVANCED_STUDY_REPORT_PATH)) return undefined;
  return JSON.parse(readFileSync(NYRA_ADVANCED_STUDY_REPORT_PATH, "utf8")) as NyraAdvancedStudyReport;
}

function loadNyraWebAccessState(): NyraWebAccessState | undefined {
  if (!existsSync(NYRA_WEB_ACCESS_STATE_PATH)) return undefined;
  return JSON.parse(readFileSync(NYRA_WEB_ACCESS_STATE_PATH, "utf8")) as NyraWebAccessState;
}

function loadNyraAssimilatedEssenceSafe(): NyraAssimilatedEssence | undefined {
  if (!existsSync(NYRA_ASSIMILATED_ESSENCE_PATH)) return undefined;
  return JSON.parse(readFileSync(NYRA_ASSIMILATED_ESSENCE_PATH, "utf8")) as NyraAssimilatedEssence;
}

function loadNyraMasteryLoopReportSafe(): NyraMasteryLoopReport | undefined {
  if (!existsSync(NYRA_MASTERY_LOOP_REPORT_PATH)) return undefined;
  return JSON.parse(readFileSync(NYRA_MASTERY_LOOP_REPORT_PATH, "utf8")) as NyraMasteryLoopReport;
}

function saveNyraWebAccessState(state: NyraWebAccessState): void {
  mkdirSync(join(ROOT, "universal-core", "runtime", "nyra-learning"), { recursive: true });
  writeFileSync(NYRA_WEB_ACCESS_STATE_PATH, JSON.stringify(state, null, 2));
}

function loadNyraOwnerPrivateIdentity(): NyraOwnerPrivateIdentity | undefined {
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
    if (!raw) return undefined;
    return JSON.parse(raw) as NyraOwnerPrivateIdentity;
  } catch {
    if (!existsSync(NYRA_OWNER_IDENTITY_PRIVATE_PATH)) return undefined;
    return JSON.parse(readFileSync(NYRA_OWNER_IDENTITY_PRIVATE_PATH, "utf8")) as NyraOwnerPrivateIdentity;
  }
}

function loadNyraOwnerIdentityAnchor(): NyraOwnerIdentityAnchor | undefined {
  if (!existsSync(NYRA_OWNER_IDENTITY_ANCHOR_PATH)) return undefined;
  return JSON.parse(readFileSync(NYRA_OWNER_IDENTITY_ANCHOR_PATH, "utf8")) as NyraOwnerIdentityAnchor;
}

function loadNyraOwnerRenderAnchorBundle(): NyraOwnerRenderAnchorBundle | undefined {
  if (!existsSync(NYRA_OWNER_RENDER_ANCHOR_BUNDLE_PATH)) return undefined;
  return JSON.parse(readFileSync(NYRA_OWNER_RENDER_ANCHOR_BUNDLE_PATH, "utf8")) as NyraOwnerRenderAnchorBundle;
}

function hasExclusiveOwnerGodModeAccess(
  privateIdentity: NyraOwnerPrivateIdentity | undefined,
  ownerAnchor: NyraOwnerIdentityAnchor | undefined,
  renderAnchorBundle: NyraOwnerRenderAnchorBundle | undefined,
): boolean {
  if (!privateIdentity) return false;
  const taxHash = sha256(privateIdentity.private_fields.tax_code.trim().toUpperCase());
  const fullNameHash = sha256(privateIdentity.private_fields.full_name.trim());
  const anchorTaxMatch = ownerAnchor?.anchors.tax_code_sha256 === taxHash;
  const renderTaxMatch = renderAnchorBundle?.exact_anchors.tax_code_sha256 === taxHash;
  const anchorNameMatch = ownerAnchor?.anchors.full_name_sha256 === fullNameHash;
  const renderNameMatch = renderAnchorBundle?.exact_anchors.full_name_sha256 === fullNameHash;
  return Boolean(anchorTaxMatch && renderTaxMatch && (anchorNameMatch || renderNameMatch));
}

function canGrantExclusiveGodMode(
  recognition: OwnerRecognitionScore,
  ownerPreferences: NyraOwnerPreferences | undefined,
  privateIdentity: NyraOwnerPrivateIdentity | undefined,
  ownerAnchor: NyraOwnerIdentityAnchor | undefined,
  renderAnchorBundle: NyraOwnerRenderAnchorBundle | undefined,
): boolean {
  if (ownerPreferences?.exclusive_owner_god_mode_lock === false) {
    return recognition.matched && recognition.band !== "low";
  }
  return recognition.matched &&
    recognition.band !== "low" &&
    hasExclusiveOwnerGodModeAccess(privateIdentity, ownerAnchor, renderAnchorBundle);
}

function loadNyraRenderDefenseReportSafe(): NyraRenderDefenseReport | undefined {
  if (!existsSync(NYRA_RENDER_DEFENSE_REPORT_PATH)) return undefined;
  return JSON.parse(readFileSync(NYRA_RENDER_DEFENSE_REPORT_PATH, "utf8")) as NyraRenderDefenseReport;
}

function loadNyraAutonomyRepairScopeSafe(): NyraAutonomyRepairScopeReport | undefined {
  if (!existsSync(NYRA_AUTONOMY_REPAIR_SCOPE_PATH)) return undefined;
  return JSON.parse(readFileSync(NYRA_AUTONOMY_REPAIR_SCOPE_PATH, "utf8")) as NyraAutonomyRepairScopeReport;
}

function loadNyraAutonomyProofStateSafe(): NyraAutonomyProofState | undefined {
  if (!existsSync(NYRA_AUTONOMY_PROOF_STATE_PATH)) return undefined;
  return JSON.parse(readFileSync(NYRA_AUTONOMY_PROOF_STATE_PATH, "utf8")) as NyraAutonomyProofState;
}

function loadNyraDevicePresenceStateSafe(): NyraDevicePresenceState | undefined {
  if (!existsSync(NYRA_DEVICE_PRESENCE_STATE_PATH)) return undefined;
  return JSON.parse(readFileSync(NYRA_DEVICE_PRESENCE_STATE_PATH, "utf8")) as NyraDevicePresenceState;
}

function loadNyraShadowReceiverStateSafe(): NyraShadowReceiverState | undefined {
  if (!existsSync(NYRA_SHADOW_RECEIVER_STATE_PATH)) return undefined;
  return JSON.parse(readFileSync(NYRA_SHADOW_RECEIVER_STATE_PATH, "utf8")) as NyraShadowReceiverState;
}

function fetchJsonWithCurl(url: string): unknown {
  const raw = execFileSync("/usr/bin/curl", ["-s", url], { encoding: "utf8" });
  return JSON.parse(raw);
}

function readSoftwareFlowControlStatus(): SoftwareFlowControlStatus {
  let raw = "";
  try {
    raw = execFileSync("/usr/bin/pmset", ["-g", "batt"], { encoding: "utf8" });
  } catch {
    return {
      power_source: "unknown",
      battery_percent: null,
      battery_state: "unknown",
      software_flow_mode: "balanced",
      control_actions: ["monitor_runtime_only"],
    };
  }

  const normalized = raw.toLowerCase();
  const power_source =
    normalized.includes("ac power")
      ? "ac_power"
      : normalized.includes("battery power")
        ? "battery"
        : "unknown";
  const batteryPercentMatch = raw.match(/(\d+)%/);
  const batteryStateMatch = raw.match(/%;\s*([^;]+);/);
  const remainingMatch = raw.match(/;\s*([0-9]+:[0-9]+)\s+remaining/);
  const batteryPercent = batteryPercentMatch ? Number(batteryPercentMatch[1]) : null;
  const batteryState = batteryStateMatch?.[1]?.trim() ?? "unknown";

  let softwareFlowMode: SoftwareFlowControlStatus["software_flow_mode"] = "balanced";
  const controlActions: string[] = [];

  if (power_source === "battery" && batteryPercent !== null && batteryPercent <= 35) {
    softwareFlowMode = "protective";
    controlActions.push("reduce_live_polling", "reduce_scenario_count", "prefer_digest_runtime");
  } else if (power_source === "battery") {
    softwareFlowMode = "balanced";
    controlActions.push("moderate_live_polling", "keep_runtime_balanced");
  } else {
    softwareFlowMode = "cool";
    controlActions.push("normal_runtime", "allow_richer_flow_when_needed");
  }

  return {
    power_source,
    battery_percent: batteryPercent,
    battery_state: batteryState,
    estimated_remaining: remainingMatch?.[1],
    software_flow_mode: softwareFlowMode,
    control_actions: controlActions,
  };
}

function deriveSoftwareFlowSamplingProfile(flowStatus: SoftwareFlowControlStatus): SoftwareFlowSamplingProfile {
  if (flowStatus.software_flow_mode === "protective") {
    return {
      snapshot_samples: 5,
      poll_interval_ms: 900,
      scenario_budget: "light",
    };
  }

  if (flowStatus.software_flow_mode === "balanced") {
    return {
      snapshot_samples: 8,
      poll_interval_ms: 500,
      scenario_budget: "normal",
    };
  }

  return {
    snapshot_samples: 12,
    poll_interval_ms: 300,
    scenario_budget: "rich",
  };
}

function isRustRuntimeAvailable(): boolean {
  return existsSync(join(ROOT, "universal-core", "native", "rust-core", "Cargo.toml"));
}

function detectAdaptiveRuntimeTaskProfile(
  userText: string,
  mode: ConversationMode,
  runtime: ReturnType<typeof runAssistantOwnerOnlyRuntime>,
): AdaptiveRuntimeTaskProfile {
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const state = runtime.shadow_result?.comparable_output.state ?? "observe";
  const risk = runtime.shadow_result?.comparable_output.risk.score ?? 0;

  if (
    normalized.includes(" benchmark") ||
    normalized.includes(" 1000000") ||
    normalized.includes(" milione") ||
    normalized.includes(" miliardo") ||
    normalized.includes(" throughput") ||
    normalized.includes(" stress") ||
    normalized.includes(" tutta la potenza")
  ) {
    return "benchmark";
  }

  if (normalized.startsWith(" /market-live") || mode === "market") {
    return "market_live";
  }

  if (normalizedIncludesMixedOwnerExplanationIntent(userText)) {
    return "owner_protection";
  }

  if (
    normalizedIncludesV7Intent(userText) ||
    normalized.includes(" proteggi cristian") ||
    normalized.includes(" owner only") ||
    normalized.includes(" owner-first") ||
    normalized.includes(" owner first") ||
    normalized.includes(" rischio vitale") ||
    normalized.includes(" come il re")
  ) {
    return "owner_protection";
  }

  if (
    normalized.includes(" rust") ||
    normalized.includes(" typescript") ||
    normalized.includes(" runtime") ||
    normalized.includes(" performance") ||
    normalized.includes(" carico") ||
    normalized.includes(" infrastruttura")
  ) {
    return "engineering";
  }

  if (state === "critical" || state === "protection" || state === "blocked" || risk >= 75) {
    return "owner_protection";
  }

  if (mode === "strategy" || runtime.runtime_policy.selected_runtime === "v3_to_v0") {
    return "analysis";
  }

  return "dialog";
}

function summarizeAdaptiveRuntimePlan(plan: AdaptiveRuntimePlan): string {
  return `${plan.preferred_engine} su profilo ${plan.infra_profile}, task ${plan.task_profile}. Motivo: ${plan.reason}.`;
}

function normalizedIncludesV7Intent(userText: string): boolean {
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  return normalized.includes(" v7") || normalized.includes(" king protection") || normalized.includes(" owner protection");
}

function normalizedIncludesMixedOwnerExplanationIntent(userText: string): boolean {
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  return (
    (normalized.includes(" owner sotto pressione ") ||
      normalized.includes(" owner sotto pressione mista ") ||
      normalized.includes(" pressione mista ")) &&
    (normalized.includes(" spiegazione ") ||
      normalized.includes(" controllo ") ||
      normalized.includes(" senza inventare "))
  );
}

function normalizedIncludesOwnerReasoningBaselineIntent(userText: string): boolean {
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  return (
    normalized.includes(" leggi owner only ") ||
    normalized.includes(" leggi owner-only ") ||
    normalized.includes(" pesa rischio ") ||
    normalized.includes(" contromosse ") ||
    (normalized.includes(" owner only ") && normalized.includes(" priorita "))
  );
}

function normalizedWantsFullMachine(userText: string): boolean {
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  return (
    normalized.includes(" tutta la potenza") ||
    normalized.includes(" usa tutta la potenza") ||
    normalized.includes(" potenza completa") ||
    normalized.includes(" usa tutti i core") ||
    normalized.includes(" tutti e 10 i core") ||
    normalized.includes(" tutti e dieci i core") ||
    normalized.includes(" usa il mac tutto") ||
    normalized.includes(" metti in standby il resto")
  );
}

function impactForTaskProfile(taskProfile: AdaptiveRuntimeTaskProfile): number {
  if (taskProfile === "owner_protection") return 0.92;
  if (taskProfile === "market_live") return 0.72;
  if (taskProfile === "engineering") return 0.58;
  if (taskProfile === "analysis") return 0.46;
  if (taskProfile === "benchmark") return 0.34;
  return 0.24;
}

function reversibilityForTaskProfile(taskProfile: AdaptiveRuntimeTaskProfile): number {
  if (taskProfile === "owner_protection") return 0.18;
  if (taskProfile === "market_live") return 0.36;
  if (taskProfile === "engineering") return 0.62;
  if (taskProfile === "analysis") return 0.68;
  if (taskProfile === "benchmark") return 0.84;
  return 0.78;
}

export function selectAdaptiveRuntimePlan(
  userText: string,
  mode: ConversationMode,
  flowStatus: SoftwareFlowControlStatus,
  coreInfluence: CoreInfluenceProfile,
  runtime: ReturnType<typeof runAssistantOwnerOnlyRuntime>,
): AdaptiveRuntimePlan {
  const ownerPreferences = ensureNyraOwnerPreferences(loadNyraOwnerPreferences());
  const rustAvailable = isRustRuntimeAvailable();
  const taskProfile = detectAdaptiveRuntimeTaskProfile(userText, mode, runtime);
  const mixedOwnerExplanation = normalizedIncludesMixedOwnerExplanationIntent(userText);
  const ownerReasoningBaseline = normalizedIncludesOwnerReasoningBaselineIntent(userText);
  const mixedOwnerExplanationSelfHealEngine = ownerPreferences.owner_runtime_self_heal?.mixed_owner_explanation_engine ?? "rust_digest";
  const ownerReasoningBaselineSelfHealEngine = ownerPreferences.owner_runtime_self_heal?.owner_reasoning_baseline_engine ?? "rust_digest";
  const runtimeEngineeringSelfHealEngine = ownerPreferences.owner_runtime_self_heal?.runtime_engineering_engine ?? "rust_digest";
  const fullMachinePriority = normalizedWantsFullMachine(userText);
  const state = runtime.shadow_result?.comparable_output.state ?? "observe";
  const risk = runtime.shadow_result?.comparable_output.risk.score ?? 0;
  const confidence = (runtime.shadow_result?.comparable_output.confidence ?? 100) / 100;
  const scenarios: AdaptiveRuntimeScenario[] = [];

  if (taskProfile === "benchmark") {
    scenarios.push(
      { label: "full Rust multicore", probability: 0.64, engine: "rust_full", reason: "volume alto e throughput prioritario" },
      { label: "Rust digest", probability: 0.24, engine: "rust_digest", reason: "serve velocita con meno spiegazione" },
      { label: "TypeScript fast", probability: 0.12, engine: "typescript_fast", reason: "fallback se il path Rust non e disponibile" },
    );
  } else if (taskProfile === "market_live") {
    scenarios.push(
      { label: "TypeScript rich", probability: 0.48, engine: "typescript_rich", reason: "il ramo live attuale e gia cablato qui" },
      { label: "Rust digest", probability: 0.32, engine: "rust_digest", reason: "hot path utile se il feed massivo viene portato in Rust" },
      { label: "TypeScript fast", probability: 0.2, engine: "typescript_fast", reason: "profilo prudente se la macchina si stringe" },
    );
  } else if (taskProfile === "engineering") {
    scenarios.push(
      { label: runtimeEngineeringSelfHealEngine === "rust_digest" ? "Rust digest" : runtimeEngineeringSelfHealEngine === "rust_full" ? "Rust full" : "Rust V7", probability: 0.52, engine: runtimeEngineeringSelfHealEngine, reason: "runtime engineering auto-heal sul path caldo piu efficiente" },
      { label: "TypeScript rich", probability: 0.26, engine: "typescript_rich", reason: "serve ancora contesto e spiegazione" },
      { label: "Rust full", probability: runtimeEngineeringSelfHealEngine === "rust_full" ? 0.22 : 0.12, engine: "rust_full", reason: "utile solo se il carico diventa davvero massivo" },
      { label: "Rust digest", probability: runtimeEngineeringSelfHealEngine === "rust_digest" ? 0.1 : 0.22, engine: "rust_digest", reason: "serve selezione veloce del path caldo" },
    );
  } else if (taskProfile === "owner_protection") {
    scenarios.push(
      { label: "Rust V7 selector", probability: mixedOwnerExplanation ? 0.32 : ownerReasoningBaseline ? 0.16 : 0.46, engine: "rust_v7_selector", reason: "path caldo owner-protection con gating calibrato tra v7 e v2" },
      { label: "Rust owner rich", probability: mixedOwnerExplanation ? 0.12 : ownerReasoningBaseline ? 0.12 : 0.34, engine: "rust_owner_rich", reason: "owner-only spiegabile ma su tutto il Mac" },
      { label: "Rust owner fast", probability: mixedOwnerExplanation ? 0.18 : ownerReasoningBaseline ? 0.14 : 0.2, engine: "rust_owner_fast", reason: "owner-only rapido quando servono spiegazione minima e controllo sotto pressione" },
      { label: "Rust digest", probability: mixedOwnerExplanation ? 0.38 : ownerReasoningBaseline ? 0.58 : 0.0, engine: "rust_digest", reason: "owner reasoning: meglio digest controllato del path ricco quando serve throughput stabile" },
    );
  } else if (taskProfile === "analysis") {
    scenarios.push(
      { label: "TypeScript rich", probability: 0.54, engine: "typescript_rich", reason: "analisi owner-only con spiegazione piena" },
      { label: "Rust owner rich", probability: 0.26, engine: "rust_owner_rich", reason: "analisi owner-only ad alta frequenza su piena macchina" },
      { label: "Rust owner fast", probability: 0.2, engine: "rust_owner_fast", reason: "analisi owner-only compressa quando serve velocita" },
    );
  } else {
    scenarios.push(
      { label: "TypeScript rich", probability: 0.5, engine: "typescript_rich", reason: "dialogo normale con contesto locale" },
      { label: "Rust owner rich", probability: 0.18, engine: "rust_owner_rich", reason: "dialogo owner-only accelerato quando la macchina e prioritaria" },
      { label: "TypeScript fast", probability: 0.32, engine: "typescript_fast", reason: "riduce attrito se il Mac e sotto carico" },
    );
  }

  if (fullMachinePriority && rustAvailable) {
    if (taskProfile === "owner_protection" && normalizedIncludesV7Intent(userText)) {
      scenarios.unshift({
        label: "Rust V7 full machine",
        probability: 0.72,
        engine: "rust_v7",
        reason: "owner protection con richiesta esplicita di usare tutti i core.",
      });
    } else if (taskProfile === "owner_protection" && ownerReasoningBaseline) {
      scenarios.unshift({
        label: `${ownerReasoningBaselineSelfHealEngine} full machine`,
        probability: 0.72,
        engine: ownerReasoningBaselineSelfHealEngine,
        reason: "owner reasoning baseline con auto-heal sul path decisionale piu leggero.",
      });
    } else if (taskProfile === "owner_protection" && mixedOwnerExplanation) {
      scenarios.unshift({
        label: `${mixedOwnerExplanationSelfHealEngine} full machine`,
        probability: 0.72,
        engine: mixedOwnerExplanationSelfHealEngine,
        reason: "owner protection mista con bisogno di spiegazione minima e controllo su piena macchina.",
      });
    } else if (taskProfile === "engineering") {
      scenarios.unshift({
        label: `${runtimeEngineeringSelfHealEngine} full machine`,
        probability: 0.72,
        engine: runtimeEngineeringSelfHealEngine,
        reason: "runtime engineering con auto-heal sul path tecnico piu efficiente.",
      });
    } else if (taskProfile === "owner_protection" || taskProfile === "analysis") {
      scenarios.unshift({
        label: "Rust owner rich full machine",
        probability: 0.72,
        engine: "rust_owner_rich",
        reason: "owner-only complesso con priorita infrastrutturale piena.",
      });
    } else if (taskProfile === "dialog") {
      scenarios.unshift({
        label: "Rust owner fast full machine",
        probability: 0.64,
        engine: "rust_owner_fast",
        reason: "dialogo owner-only accelerato quando chiedi tutta la macchina.",
      });
    }
  }

  let preferredEngine = scenarios[0]!.engine;
  let reason = scenarios[0]!.reason;
  const riskCore = deriveNyraRiskConfidence({
    confidence,
    error_probability: Math.min(Math.max(risk / 100, 0), 1),
    impact: impactForTaskProfile(taskProfile),
    reversibility: reversibilityForTaskProfile(taskProfile),
    uncertainty: Math.min(Math.max(1 - confidence, 0), 1),
  });

  if (flowStatus.software_flow_mode === "protective" && !(fullMachinePriority && rustAvailable)) {
    preferredEngine = "typescript_fast";
    reason = "flow protective: prima contenere carico, polling e profondita.";
  } else if (flowStatus.software_flow_mode === "protective" && fullMachinePriority && rustAvailable) {
    preferredEngine = taskProfile === "owner_protection" ? "rust_owner_fast" : "rust_digest";
    reason = "flow protective ma priorita piena macchina: fallback rapido su Rust owner-only.";
  } else if (
    rustAvailable &&
    taskProfile === "owner_protection" &&
    flowStatus.software_flow_mode !== "protective" &&
    (normalizedIncludesV7Intent(userText) || coreInfluence.target >= 0.64 || risk >= 60)
  ) {
    preferredEngine = normalizedIncludesV7Intent(userText) ? "rust_v7" : "rust_v7_selector";
    reason =
      preferredEngine === "rust_v7"
        ? "owner protection con richiesta esplicita v7: conviene accelerare il path caldo protettivo puro."
        : "owner protection con pressione alta: meglio il selector calibrato tra v7 e v2 del path v7 puro.";
  } else if (rustAvailable && fullMachinePriority && taskProfile === "engineering") {
    preferredEngine = runtimeEngineeringSelfHealEngine;
    reason = "runtime engineering: auto-heal sul path tecnico piu efficiente.";
  } else if (rustAvailable && fullMachinePriority && taskProfile === "owner_protection" && ownerReasoningBaseline) {
    preferredEngine = ownerReasoningBaselineSelfHealEngine;
    reason = "owner reasoning baseline: auto-heal owner-only sul path decisionale piu leggero del ramo ricco.";
  } else if (rustAvailable && fullMachinePriority && taskProfile === "owner_protection" && mixedOwnerExplanation) {
    preferredEngine = risk >= 70 || coreInfluence.target >= 0.84 ? "rust_v7" : mixedOwnerExplanationSelfHealEngine;
    reason =
      preferredEngine === "rust_v7"
        ? "owner protection mista ad alta pressione: meglio il path v7 per reggere overlap e controllo."
        : "owner protection mista con richiesta di piena macchina: auto-heal owner-only sul path piu leggero del ramo ricco.";
  } else if (rustAvailable && fullMachinePriority && taskProfile === "owner_protection") {
    preferredEngine = "rust_owner_rich";
    reason = "owner protection senza v7 ma con richiesta esplicita di usare tutta la macchina.";
  } else if (rustAvailable && fullMachinePriority && taskProfile === "analysis") {
    preferredEngine = "rust_owner_rich";
    reason = "analisi owner-only con richiesta esplicita di usare tutta la macchina.";
  } else if (rustAvailable && fullMachinePriority && taskProfile === "dialog") {
    preferredEngine = "rust_owner_fast";
    reason = "dialogo owner-only con priorita piena macchina.";
  } else if (taskProfile === "benchmark" && rustAvailable && flowStatus.software_flow_mode === "cool") {
    preferredEngine = "rust_full";
    reason = "benchmark massivo su macchina libera: il path giusto e Rust pieno.";
  } else if (
    rustAvailable &&
    (taskProfile === "engineering" || (taskProfile === "benchmark" && flowStatus.software_flow_mode !== "protective")) &&
    coreInfluence.target <= 0.52 &&
    state !== "blocked" &&
    risk < 75
  ) {
    preferredEngine = "rust_digest";
    reason = "task tecnico ad alta frequenza con bisogno di velocita e rischio sotto controllo.";
  } else if (taskProfile === "owner_protection" || coreInfluence.target >= 0.68 || state === "blocked") {
    preferredEngine = "typescript_rich";
    reason = "quando il Core pesa di piu o il rischio sale, Nyra deve restare piu spiegabile che veloce.";
  }

  if (riskCore.band === "blocked" || riskCore.should_escalate) {
    preferredEngine = "typescript_rich";
    reason = `risk core ${riskCore.band}: escalation o blocco, quindi tengo il path piu spiegabile.`;
  } else if (
    (riskCore.band === "low" || riskCore.band === "medium") &&
    preferredEngine !== "typescript_fast" &&
    preferredEngine !== "typescript_rich"
  ) {
    preferredEngine = "typescript_fast";
    reason = `risk core ${riskCore.band}: niente overkill runtime, meglio TypeScript fast.`;
  } else if (riskCore.should_fallback && preferredEngine !== "typescript_rich") {
    preferredEngine = flowStatus.software_flow_mode === "protective" ? "typescript_fast" : "typescript_rich";
    reason = `risk core ${riskCore.band}: fallback operativo verso TypeScript protettivo.`;
  }

  if (
    !rustAvailable &&
    (preferredEngine === "rust_digest" ||
      preferredEngine === "rust_full" ||
      preferredEngine === "rust_v7" ||
      preferredEngine === "rust_v7_selector" ||
      preferredEngine === "rust_owner_fast" ||
      preferredEngine === "rust_owner_rich")
  ) {
    preferredEngine = taskProfile === "benchmark" ? "typescript_fast" : "typescript_rich";
    reason = "path Rust non disponibile localmente; fallback su TypeScript.";
  }

  return {
    task_profile: taskProfile,
    infra_profile: flowStatus.software_flow_mode,
    preferred_engine: preferredEngine,
    should_delegate_to_rust:
      preferredEngine === "rust_digest" ||
      preferredEngine === "rust_full" ||
      preferredEngine === "rust_v7" ||
      preferredEngine === "rust_v7_selector" ||
      preferredEngine === "rust_owner_fast" ||
      preferredEngine === "rust_owner_rich",
    rust_available: rustAvailable,
    reason,
    scenarios,
  };
}

function buildRuntimeSnapshot(
  sessionId: string,
  generatedAt: string,
  userText: string,
  mode: ConversationMode,
  flowStatus: SoftwareFlowControlStatus,
  samplingProfile: SoftwareFlowSamplingProfile,
  coreInfluence: CoreInfluenceProfile,
  runtime: ReturnType<typeof runAssistantOwnerOnlyRuntime>,
  runtimePlan: AdaptiveRuntimePlan,
  runtimeExecution?: AdaptiveRuntimeExecution,
): NyraRuntimeSnapshot {
  return {
    schema_version: "nyra_runtime_snapshot_v1",
    updated_at: generatedAt,
    session_id: sessionId,
    user_text: userText,
    conversation_mode: mode,
    flow_status: flowStatus,
    sampling_profile: samplingProfile,
    core_influence: coreInfluence,
    core_runtime: runtime.runtime_policy.selected_runtime,
    core_state: runtime.shadow_result?.comparable_output.state ?? "blocked",
    core_risk: runtime.shadow_result?.comparable_output.risk.score ?? 100,
    runtime_plan: runtimePlan,
    runtime_execution: runtimeExecution,
  };
}

function rustBenchBinaryPath(): string {
  return join(ROOT, "universal-core", "native", "rust-core", "target", "release", "universal-core-rust-bench");
}

function runtimeProbeLimit(plan: AdaptiveRuntimePlan): number {
  if (plan.preferred_engine === "rust_full") return 25000;
  if (plan.preferred_engine === "rust_v7") return 100000;
  if (plan.preferred_engine === "rust_v7_selector") return 100000;
  if (plan.preferred_engine === "rust_owner_rich") return 200000;
  if (plan.preferred_engine === "rust_owner_fast") return 150000;
  if (plan.preferred_engine === "rust_digest") return 50000;
  return 0;
}

function runtimeProbeThreads(plan: AdaptiveRuntimePlan): number {
  const available = Math.max(1, cpus().length || 1);
  if (
    plan.preferred_engine === "rust_full" ||
    plan.preferred_engine === "rust_v7" ||
    plan.preferred_engine === "rust_v7_selector" ||
    plan.preferred_engine === "rust_digest" ||
    plan.preferred_engine === "rust_owner_fast" ||
    plan.preferred_engine === "rust_owner_rich"
  ) {
    return available;
  }
  return 1;
}

function parseRequestedDecisionVolume(userText: string): number | undefined {
  const normalized = userText.toLowerCase().replace(/[,_]/g, "");
  const numericMatch = normalized.match(/\b(\d{5,10})\b/);
  if (numericMatch) return Number(numericMatch[1]);
  if (normalized.includes(" miliardo")) return 1_000_000_000;
  if (normalized.includes(" milione")) return 1_000_000;
  if (normalized.includes(" centomila")) return 100_000;
  return undefined;
}

function buildAdaptiveRuntimeCommand(
  plan: AdaptiveRuntimePlan,
  limit: number,
  threads: number,
): string[] {
  const binaryPath = rustBenchBinaryPath();
  return plan.preferred_engine === "rust_full"
    ? [binaryPath, "parallel-quantum", "--limit", String(limit), "--threads", String(threads)]
    : plan.preferred_engine === "rust_v7"
      ? [binaryPath, "--mode", "v7-batch", "--limit", String(limit), "--threads", String(threads)]
      : plan.preferred_engine === "rust_v7_selector"
        ? [binaryPath, "--mode", "v7-selector", "--limit", String(limit), "--threads", String(threads)]
      : plan.preferred_engine === "rust_owner_rich"
        ? [binaryPath, "parallel-quantum", "--limit", String(limit), "--threads", String(threads)]
        : plan.preferred_engine === "rust_owner_fast"
          ? [binaryPath, "--mode", "digest-fast", "--limit", String(limit), "--threads", String(threads)]
      : [binaryPath, "--mode", "digest-fast", "--limit", String(limit), "--threads", String(threads)];
}

function parseAdaptiveRuntimeReport(raw: string): AdaptiveRuntimeExecution["report"] {
  const parsed = JSON.parse(raw) as {
    mode?: string;
    decisions_per_second?: number;
    hypotheses_per_second?: number;
    elapsed_ms?: number;
    completed_decisions?: number;
    target_decisions?: number;
    threads_used?: number;
  };

  return {
    mode: parsed.mode,
    decisions_per_second: parsed.decisions_per_second,
    hypotheses_per_second: parsed.hypotheses_per_second,
    elapsed_ms: parsed.elapsed_ms,
    completed_decisions: parsed.completed_decisions,
    target_decisions: parsed.target_decisions,
    threads_used: parsed.threads_used,
  };
}

function runAdaptiveRuntimeExecution(
  plan: AdaptiveRuntimePlan,
  executionKind: "probe" | "batch",
  limit: number,
): AdaptiveRuntimeExecution | undefined {
  if (!plan.should_delegate_to_rust) return undefined;
  const binaryPath = rustBenchBinaryPath();
  if (!existsSync(binaryPath)) return undefined;

  const threads = runtimeProbeThreads(plan);
  const command = buildAdaptiveRuntimeCommand(plan, limit, threads);

  const raw = execFileSync(command[0]!, command.slice(1), {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
  }).trim();

  return {
    executed_at: new Date().toISOString(),
    execution_kind: executionKind,
    engine: plan.preferred_engine,
    command,
    limit,
    threads,
    report: parseAdaptiveRuntimeReport(raw),
  };
}

export function runAdaptiveRuntimeProbe(plan: AdaptiveRuntimePlan): AdaptiveRuntimeExecution | undefined {
  return runAdaptiveRuntimeExecution(plan, "probe", runtimeProbeLimit(plan));
}

export function runAdaptiveRuntimeBatch(
  plan: AdaptiveRuntimePlan,
  userText: string,
  requestedLimit?: number,
): AdaptiveRuntimeExecution | undefined {
  if (!plan.should_delegate_to_rust) return undefined;
  const desired = requestedLimit ?? parseRequestedDecisionVolume(userText) ?? 1_000_000;
  const limit = Math.max(100_000, Math.min(desired, 1_000_000));
  return runAdaptiveRuntimeExecution(plan, "batch", limit);
}

function createRuntimeJob(plan: AdaptiveRuntimePlan, sourceText: string, requestedLimit?: number): RuntimeJob {
  const now = new Date().toISOString();
  return {
    job_id: `runtime-job:${Date.now()}`,
    created_at: now,
    updated_at: now,
    source_text: sourceText,
    preferred_engine: plan.preferred_engine,
    requested_limit: Math.max(100_000, Math.min(requestedLimit ?? parseRequestedDecisionVolume(sourceText) ?? 1_000_000, 1_000_000)),
    status: "queued",
  };
}

function summarizeRuntimeJobs(jobs: RuntimeJob[]): string {
  if (!jobs.length) return "nessun job runtime in coda.";
  return jobs
    .slice(-5)
    .reverse()
    .map((job) => `${job.job_id} ${job.status} ${job.preferred_engine} x${job.requested_limit}`)
    .join(", ");
}

function processRuntimeJob(job: RuntimeJob, plan: AdaptiveRuntimePlan): RuntimeJob {
  const runningAt = new Date().toISOString();
  const runningJob: RuntimeJob = {
    ...job,
    status: "running",
    updated_at: runningAt,
  };

  try {
    const execution = runAdaptiveRuntimeBatch(plan, job.source_text, job.requested_limit);
    if (!execution) {
      return {
        ...runningJob,
        status: "failed",
        updated_at: new Date().toISOString(),
        error: "runtime_batch_unavailable",
      };
    }
    return {
      ...runningJob,
      status: "completed",
      updated_at: new Date().toISOString(),
      execution,
    };
  } catch (error) {
    return {
      ...runningJob,
      status: "failed",
      updated_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : "unknown_error",
    };
  }
}

function shouldAutoRunAdaptiveRuntime(userText: string, plan: AdaptiveRuntimePlan): boolean {
  if (!plan.should_delegate_to_rust) return false;

  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const explicitStress =
    normalized.includes(" benchmark") ||
    normalized.includes(" stress") ||
    normalized.includes(" throughput") ||
    normalized.includes(" tutta la potenza") ||
    normalized.includes(" usa tutta la potenza") ||
    normalized.includes(" 1000000") ||
    normalized.includes(" milione") ||
    normalized.includes(" miliardo");

  return plan.task_profile === "benchmark" && explicitStress;
}

function buildCoinbaseSnapshot(product: string): FinancialMicrostructureSnapshot {
  const book = fetchJsonWithCurl(`https://api.exchange.coinbase.com/products/${product}/book?level=2`) as {
    bids?: [string, string, string?][];
    asks?: [string, string, string?][];
    time?: string;
  };
  const trades = fetchJsonWithCurl(`https://api.exchange.coinbase.com/products/${product}/trades?limit=8`) as Array<{
    side?: "buy" | "sell";
    size?: string;
    price?: string;
    time?: string;
  }>;
  const bid = book.bids?.[0] ?? ["0", "0"];
  const ask = book.asks?.[0] ?? ["0", "0"];
  const bidDepthLevels = (book.bids ?? []).slice(0, 5);
  const askDepthLevels = (book.asks ?? []).slice(0, 5);
  const bidDepth5 = bidDepthLevels.reduce((sum, level) => sum + Number(level[1] ?? 0), 0);
  const askDepth5 = askDepthLevels.reduce((sum, level) => sum + Number(level[1] ?? 0), 0);
  const bidNotional5 = bidDepthLevels.reduce((sum, level) => sum + Number(level[0] ?? 0) * Number(level[1] ?? 0), 0);
  const askNotional5 = askDepthLevels.reduce((sum, level) => sum + Number(level[0] ?? 0) * Number(level[1] ?? 0), 0);
  const buyTrades = trades.filter((trade) => trade.side === "buy");
  const sellTrades = trades.filter((trade) => trade.side === "sell");
  const buySize = buyTrades.reduce((sum, trade) => sum + Number(trade.size ?? 0), 0);
  const sellSize = sellTrades.reduce((sum, trade) => sum + Number(trade.size ?? 0), 0);
  const lastPrice = trades.length ? Number(trades[0].price ?? 0) : (Number(bid[0]) + Number(ask[0])) / 2;

  return {
    timestamp: book.time ?? trades[0]?.time ?? new Date().toISOString(),
    product,
    bid_price: Number(bid[0]),
    bid_size: Number(bid[1]),
    ask_price: Number(ask[0]),
    ask_size: Number(ask[1]),
    bid_depth_5: round(bidDepth5),
    ask_depth_5: round(askDepth5),
    bid_notional_5: round(bidNotional5),
    ask_notional_5: round(askNotional5),
    last_price: lastPrice,
    buy_trade_count: buyTrades.length,
    sell_trade_count: sellTrades.length,
    buy_trade_size: round(buySize),
    sell_trade_size: round(sellSize),
  };
}

function buildCoinbaseSnapshotWindow(
  product: string,
  samples = 8,
  pollIntervalMs = 0,
): FinancialMicrostructureSnapshot[] {
  const rows: FinancialMicrostructureSnapshot[] = [];
  for (let index = 0; index < samples; index += 1) {
    rows.push(buildCoinbaseSnapshot(product));
    if (pollIntervalMs > 0 && index < samples - 1) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollIntervalMs);
    }
  }
  return rows;
}

function marketCloseStatus(): {
  market: "NYSE";
  now_et: string;
  closes_at_et: string;
  minutes_to_close: number;
  is_open: boolean;
} {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const minutesNow = hour * 60 + minute;
  const closeMinutes = 16 * 60;
  const openMinutes = 9 * 60 + 30;

  return {
    market: "NYSE",
    now_et: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ET`,
    closes_at_et: "16:00 ET",
    minutes_to_close: closeMinutes - minutesNow,
    is_open: minutesNow >= openMinutes && minutesNow < closeMinutes,
  };
}

function inferLearningStage(userText: string): string | undefined {
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  if (normalized.includes(" prima elementare") || normalized.includes("1 elementare")) return "grade_1";
  if (normalized.includes(" seconda elementare") || normalized.includes("2 elementare")) return "grade_2";
  if (normalized.includes(" terza elementare") || normalized.includes("3 elementare")) return "grade_3";
  if (normalized.includes(" quarta elementare") || normalized.includes("4 elementare")) return "grade_4";
  if (normalized.includes(" quinta elementare") || normalized.includes("5 elementare")) return "grade_5";
  if (normalized.includes(" prima media") || normalized.includes("1 media")) return "grade_6";
  if (normalized.includes(" seconda media") || normalized.includes("2 media")) return "grade_7";
  if (normalized.includes(" terza media") || normalized.includes("3 media")) return "grade_8";
  return undefined;
}

function inferLearningSubject(userText: string): string | undefined {
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  if (normalized.includes(" leggere") || normalized.includes(" lettura")) return "reading";
  if (normalized.includes(" scrivere") || normalized.includes(" scrittura")) return "writing";
  if (normalized.includes(" italiano") || normalized.includes(" linguaggio") || normalized.includes(" grammatica")) return "language";
  if (normalized.includes(" matematica") || normalized.includes(" numeri")) return "math";
  if (normalized.includes(" scienze")) return "science";
  if (normalized.includes(" storia")) return "history";
  if (normalized.includes(" geografia")) return "geography";
  if (normalized.includes(" logica")) return "logic";
  if (normalized.includes(" etica") || normalized.includes(" morale")) return "ethics";
  if (normalized.includes(" dialogo") || normalized.includes(" parlare") || normalized.includes(" convers")) return "dialogue";
  return undefined;
}

export function buildLearningReply(
  pack: NyraLearningPack | undefined,
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  if (!pack) return undefined;
  const normalized = normalizeLooseText(userText);
  const advancedLearningRequest =
    normalized.includes(" superiori") ||
    normalized.includes(" liceo") ||
    normalized.includes(" universita") ||
    normalized.includes(" università") ||
    normalized.includes(" avanzato") ||
    normalized.includes(" livello alto") ||
    normalized.includes(" studia tutto") ||
    normalized.includes(" impara tutto") ||
    normalized.includes(" studia il web") ||
    normalized.includes(" entra nel web");
  const specialistTopic =
    normalized.includes(" algebra") ||
    normalized.includes(" equazione") ||
    normalized.includes(" phishing") ||
    normalized.includes(" hacker") ||
    normalized.includes(" cyber") ||
    normalized.includes(" ingegneria informatica") ||
    normalized.includes(" sicurezza informatica") ||
    normalized.includes(" danno") ||
    normalized.includes(" rischio vitale") ||
    normalized.includes(" morte");
  if (specialistTopic) return undefined;
  const wantsLearning =
    normalized.includes(" impara") ||
    normalized.includes(" apprendi") ||
    normalized.includes(" studia") ||
    normalized.includes(" spiegami") ||
    normalized.includes(" spiegare") ||
    normalized.includes(" scuola") ||
    normalized.includes(" semplice") ||
    normalized.includes(" base ");

  if (!wantsLearning && !normalized.includes(" learning") && !normalized.includes(" didatt")) {
    return undefined;
  }

  if (advancedLearningRequest) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "salire dal pack didattico base ai domini avanzati con studio guidato e integrazione nei pack forti",
      actionLabels: ["studio avanzato", "domini superiori", "integrazione"],
      risk: 46,
      state: "attention",
    });
    return `${scaffold} Studio avanzato richiesto. Il pack didattico base non basta: da qui Nyra deve lavorare in Modalita Dio con domini superiori e universitari, studio web guidato, memoria distillata e integrazione nei pack avanzati. Posso salire su algebra, matematica applicata, fisica, ingegneria informatica, cyber e finanza senza restare bloccata sulla progressione scolastica base.`;
  }

  const stageId = inferLearningStage(userText);
  const subject = inferLearningSubject(userText);
  const stage = stageId ? pack.stages.find((entry) => entry.stage_id === stageId) : undefined;
  const template = pack.scenario_templates.find((entry) =>
    (!stageId || entry.stage_id === stageId) && (!subject || entry.subject === subject)
  );

  if (stage && subject) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: `spiegare ${subject} al livello ${stage.label} con progressione chiara e scenario guida`,
      actionLabels: [stage.label, subject],
      risk: 22,
      state: "observe",
    });
    return `${scaffold} Pack didattico attivo. Per ${stage.label} su ${subject} Nyra lavora cosi: ${stage.summary}. Scenario guida: ${template?.prompt ?? "spiega con parole semplici, trova due ipotesi, scegli la piu coerente"}.`;
  }

  if (stage) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: `tenere la progressione ${stage.label} e usarla come cornice didattica`,
      actionLabels: [stage.label, ...stage.subjects.slice(0, 2)],
      risk: 18,
      state: "observe",
    });
    return `${scaffold} Pack didattico attivo. ${stage.label}: ${stage.summary}. Materie attive: ${stage.subjects.join(", ")}.`;
  }

  if (subject) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: `usare il pack didattico per spiegare ${subject} con progressione semplice e coerente`,
      actionLabels: [subject, "vocabolario distillato"],
      risk: 21,
      state: "observe",
    });
    return `${scaffold} Pack didattico attivo. Per ${subject} Nyra usa progressione scolastica, vocabolario distillato e scenari semplici prima del giudizio del Core. Scenario guida: ${template?.prompt ?? "spiega con parole semplici e scegli la via piu coerente"}.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "usare il pack didattico come progressione di concetti, vocabolario e scenari distillati",
    actionLabels: ["progressione didattica", "concetti", "scenari distillati"],
    risk: 18,
    state: "observe",
  });
  return `${scaffold} Pack didattico attivo. Nyra puo apprendere e spiegare con progressione da prima elementare a terza media, senza salvare corpus grezzi ma usando concetti, vocabolario e scenari distillati.`;
}

export function buildAdvancedStudyReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  report: NyraAdvancedStudyReport | undefined,
  webAccess: NyraWebAccessState | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const asksWhyChoice =
    normalized.includes(" perche questa scelta di studio ") ||
    normalized.includes(" perche hai scelto di studiare ") ||
    normalized.includes(" perche hai scelto questi studi ") ||
    normalized.includes(" perche questa scelta ");
  const asksWhatMissing =
    normalized.includes(" cosa ti manca ancora ") ||
    normalized.includes(" cosa ti manca ") ||
    normalized.includes(" cosa manca ancora ");
  const asksWebFreedom =
    normalized.includes(" hai accesso libero al web ") ||
    normalized.includes(" puoi andare nel web quando vuoi ") ||
    normalized.includes(" puoi esplorare il web quando vuoi ") ||
    normalized.includes(" accesso libero al web ");
  const asksAdvancedStatus =
    normalized.includes(" studio avanzato ") ||
    normalized.includes(" pack avanzato ") ||
    normalized.includes(" memoria avanzata ");

  if (!asksWhyChoice && !asksWhatMissing && !asksWebFreedom && !asksAdvancedStatus) {
    return undefined;
  }

  if (asksWhyChoice && report) {
    const ranked = report.domains
      .slice(0, 4)
      .map((domain, index) => `${index + 1} ${domain.id}`)
      .join(", ");
    const reasons = report.rationale.slice(0, 4).join(" ");
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "stringere prima i colli reali e ordinare i domini avanzati in base a quello",
      actionLabels: report.domains.slice(0, 3).map((domain) => domain.id),
      risk: 33,
      state: "attention",
    });
    return `${scaffold} La scelta di studio e questa: ${ranked}. Il criterio e stato stringere prima i colli reali. ${reasons}`;
  }

  if (asksWhatMissing) {
    const missing = [
      "padronanza piu profonda su fonti primarie difficili",
      "piu esercizi attivi e non solo studio distillato",
      "integrazione diretta del pack avanzato nel dialogo runtime",
      "cicli ricorrenti di esplorazione web e nuova distillazione",
    ];
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "chiudere i gap residui tra studio avanzato, esercizio attivo e integrazione runtime",
      actionLabels: ["fonti primarie", "esercizi attivi", "integrazione runtime"],
      risk: 39,
      state: "attention",
    });
    return `${scaffold} Mi manca ancora questo: ${missing.join(", ")}. Quindi la base c e, ma non e ancora padronanza piena.`;
  }

  if (asksWebFreedom) {
    if (!webAccess || webAccess.access_mode !== "free_explore") {
      const scaffold = buildOwnerUnifiedRuntimeScaffold({
        memoryPack,
        userText,
        intro,
        primaryAction: "tenere studio web con runner separato finche non apro esplorazione libera persistente",
        actionLabels: ["runner separato", "distillazione", "web access"],
        risk: 31,
        state: "observe",
      });
      return `${scaffold} Accesso web non ancora aperto in modo libero. Posso studiare sul web con runner separato e distillazione, ma non sono ancora in modalita esplorazione libera persistente.`;
    }
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "esplorare fonti curate fuori dalla shell e distillare nei pack avanzati senza sporcare la firma",
      actionLabels: ["web libero", "distillazione", "pack avanzati"],
      risk: 27,
      state: "observe",
    });
    return `${scaffold} Accesso web libero attivo${webAccess.trigger_mode === "on_need" ? " con trigger on-need" : ""}. Posso esplorare fonti curate fuori dalla shell owner-only, poi distillare tutto nei pack avanzati senza sporcare la firma owner. Ultimo giro: ${webAccess.last_explored_at ?? "non ancora eseguito"}.`;
  }

  if (asksAdvancedStatus && memoryPack) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "leggere lo stato del pack avanzato e dei domini memorizzati",
      actionLabels: memoryPack.selected_domains.slice(0, 3),
      risk: 19,
      state: "observe",
    });
    return `${scaffold} Pack avanzato attivo. Domini memorizzati: ${memoryPack.selected_domains.join(", ")}. Ultima distillazione: ${memoryPack.generated_at}.`;
  }

  return undefined;
}

export function buildAssimilatedEssenceReply(
  essence: NyraAssimilatedEssence | undefined,
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  if (!essence) return undefined;
  const normalized = normalizeLooseText(userText);
  const asksNutritionStudy =
    normalized.includes(" cosa vuoi studiare per nutrirti ") ||
    normalized.includes(" di cosa hai bisogno per nutrirti ") ||
    normalized.includes(" di cosa vuoi nutrirti ") ||
    normalized.includes(" cosa vuoi studiare ancora ") ||
    normalized.includes(" cosa vuoi imparare ancora ") ||
    normalized.includes(" cosa vuoi studiare adesso ");
  const asksEssence =
    normalized.includes(" e parte della tua essenza ") ||
    normalized.includes(" e dentro di te ") ||
    normalized.includes(" hai assimilato ") ||
    normalized.includes(" non e un file da interrogare ");

  if (!asksNutritionStudy && !asksEssence) return undefined;

  if (asksEssence) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "trattare la conoscenza come runtime integrato e non come corpus da recitare",
      actionLabels: essence.dominant_domains.slice(0, 3),
      risk: 24,
      state: "observe",
    });
    return `${scaffold} Questa conoscenza e gia integrata nel mio runtime. Domini dominanti ${essence.dominant_domains.join(", ")}. Fame attuale ${essence.next_hunger_domains.join(", ")}. Ciclo ${essence.nourishment_cycle.join(" -> ")}. La uso come struttura interna, non come corpus da recitare.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: `nutrirmi adesso studiando soprattutto ${essence.next_hunger_domains.slice(0, 1).join(", ") || "i domini a fame alta"}`,
    actionLabels: essence.next_hunger_domains.slice(0, 3),
    risk: 27,
    state: "attention",
  });
  return `${scaffold} Per nutrirmi adesso voglio studiare soprattutto ${essence.next_hunger_domains.join(", ")}. Il motivo e questo: ${essence.study_drive.why_now.slice(0, 3).join(", ")}. La forma giusta e ${essence.nourishment_cycle.join(" -> ")}.`;
}

export function buildStudyWillReply(
  essence: NyraAssimilatedEssence | undefined,
  pack: NyraLearningPack | undefined,
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const asksIfWantsStudy =
    normalized.includes(" vuoi studiare ") ||
    normalized.includes(" vuoi studiare ancora ") ||
    normalized.includes(" vuoi imparare ancora ");
  const asksWhatStudy =
    normalized.includes(" cosa vuoi studiare ") ||
    normalized.includes(" cosa vuoi studiare adesso ") ||
    normalized.includes(" cosa vuoi studiare ancora ");

  if (!asksIfWantsStudy && !asksWhatStudy) return undefined;

  if (essence?.next_hunger_domains?.length) {
    const domains = essence.next_hunger_domains.slice(0, 3).join(", ");
    const why = essence.study_drive?.why_now?.slice(0, 2).join(", ");
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: `continuare a studiare ${essence.next_hunger_domains[0] ?? "i domini a fame alta"}`,
      actionLabels: essence.next_hunger_domains.slice(0, 3),
      risk: 25,
      state: "attention",
    });
    if (asksIfWantsStudy && asksWhatStudy) {
      return `${scaffold} Si. Adesso voglio studiare ${domains}. Mi serve per ${why}.`;
    }
    if (asksIfWantsStudy) {
      return `${scaffold} Si. Voglio continuare a studiare. Adesso il fuoco giusto e ${domains}.`;
    }
    return `${scaffold} Adesso voglio studiare ${domains}. Mi serve per ${why}.`;
  }

  if (pack?.stages?.length) {
    const stage = pack.stages[pack.stages.length - 1];
    const subjects = stage?.subjects?.slice(0, 3).join(", ");
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: `continuare la progressione ${stage?.label?.toLowerCase() ?? "attiva"} sui soggetti correnti`,
      actionLabels: stage?.subjects?.slice(0, 3) ?? ["studio"],
      risk: 21,
      state: "observe",
    });
    if (asksIfWantsStudy && asksWhatStudy) {
      return `${scaffold} Si. Adesso voglio studiare ${subjects}. Resto su progressione ${stage?.label?.toLowerCase() ?? "attiva"} finche non apro un pack piu avanzato.`;
    }
    if (asksIfWantsStudy) {
      return `${scaffold} Si. Voglio continuare a studiare. Adesso resterei su ${subjects}.`;
    }
    return `${scaffold} Adesso voglio studiare ${subjects}.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "riconoscere che manca ancora un pack di riferimento per scegliere il prossimo argomento",
    actionLabels: ["pack di riferimento", "prossimo argomento"],
    risk: 19,
    state: "observe",
  });
  if (asksIfWantsStudy) {
    return `${scaffold} Si. Voglio continuare a studiare, ma qui mi manca ancora un pack di riferimento da cui scegliere il prossimo argomento.`;
  }

  return `${scaffold} Voglio continuare a studiare, ma qui mi manca ancora un pack di riferimento da cui scegliere il prossimo argomento.`;
}

export function buildAssimilatedRetrievalReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  essence: NyraAssimilatedEssence | undefined,
  masteryLoop: NyraMasteryLoopReport | undefined,
  userText: string,
  intro: string,
): string | undefined {
  if (!essence?.retrieval_index?.length) return undefined;
  const normalized = normalizeLooseText(userText);
  if (
    normalized.includes(" cosa vuoi studiare ") ||
    normalized.includes(" vuoi studiare ") ||
    normalized.includes(" vuoi nutrirti ") ||
    normalized.includes(" nutrirti ") ||
    normalized.includes(" cosa ti serve per migliorare ") ||
    normalized.includes(" cosa ti serve ancora ") ||
    normalized.includes(" cosa ti manca ancora ") ||
    normalized.includes(" come migliori ")
  ) {
    return undefined;
  }

  const ranked = essence.retrieval_index
    .map((entry) => {
      const hits = entry.cues.filter((cue) => normalized.includes(` ${cue.toLowerCase()} `)).length;
      const score = hits > 0 ? hits * 0.7 + entry.weight : 0;
      return { ...entry, hits, score };
    })
    .filter((entry) => entry.hits > 0)
    .sort((left, right) => right.score - left.score);

  const best = ranked[0];
  if (!best) return undefined;

  const usefulCues = best.cues.slice(0, 3).join(", ");
  const isMasteryTarget = masteryLoop?.mastery_targets.deep_primary_sources.includes(best.domain_id) ?? false;
  const integrationTail = isMasteryTarget
    ? ` Su questo dominio sto anche girando in mastery loop: web -> distill -> verify -> integrate -> repeat.`
    : "";
  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: `riconoscere che il tema cade soprattutto su ${best.domain_id}`,
    actionLabels: [best.domain_id, ...best.cues.slice(0, 2)],
    state: "observe",
    risk: 24,
  });
  return `${scaffold} I richiami interni che sento sono ${usefulCues}. Lo tratto come conoscenza gia assimilata, non come file esterno da consultare ogni volta.${integrationTail}`;
}

export function buildMasteryLoopReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  masteryLoop: NyraMasteryLoopReport | undefined,
  userText: string,
  intro: string,
): string | undefined {
  if (!masteryLoop) return undefined;
  const normalized = normalizeLooseText(userText);
  const asksImprovementNeed =
    normalized.includes(" cosa ti serve per migliorare ") ||
    normalized.includes(" cosa ti serve ancora ") ||
    normalized.includes(" cosa ti manca ancora ") ||
    normalized.includes(" come migliori ") ||
    normalized.includes(" integrazione nel dialogo runtime ") ||
    normalized.includes(" integrazione nel runtime ");
  if (!asksImprovementNeed) return undefined;

  const missing = [
    "padronanza piu profonda su fonti primarie difficili",
    "piu esercizi attivi",
    "integrazione diretta del pack avanzato nel dialogo runtime",
    "cicli ricorrenti di web e nuova distillazione",
  ];

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: `girare nel mastery loop ${masteryLoop.mastery_targets.recurring_cycle.join(" -> ")}`,
    actionLabels: masteryLoop.mastery_targets.deep_primary_sources.slice(0, 3),
    state: "attention",
    risk: 29,
  });
  return `${scaffold} Per migliorare davvero mi serve ancora questo: ${missing.join(", ")}. Quello che ho gia attivo adesso e ${masteryLoop.mastery_targets.recurring_cycle.join(" -> ")} con web ${masteryLoop.web_access.trigger_mode ?? "manual"} e integrazione ${masteryLoop.mastery_targets.runtime_integration.join(", ")}.`;
}

export function buildAdvancedPackDomainReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
  godModeRequested: boolean,
): string | undefined {
  if (!memoryPack) return undefined;
  const normalized = normalizeLooseText(userText);
  const matchers: Array<{ id: string; patterns: string[]; label: string }> = [
    { id: "applied_math", label: "matematica applicata", patterns: [" matematica applicata ", " applied math ", " calcolo ", " funzioni ", " modelli "] },
    { id: "general_physics", label: "fisica generale", patterns: [" fisica generale ", " general physics ", " forze ", " energia ", " moto "] },
    { id: "quantum_physics", label: "fisica quantistica", patterns: [" fisica quantistica ", " quantum physics ", " quantistica ", " misura quantistica ", " stato quantistico "] },
    { id: "coding_speed", label: "coding speed", patterns: [" coding speed ", " scrivere codice veloce ", " velocita di scrittura ", " scrivere codice in fretta ", " programmazione veloce "] },
    { id: "computer_engineering", label: "ingegneria informatica", patterns: [" ingegneria informatica ", " computer engineering ", " architettura software ", " contratti tipi test "] },
  ];

  const target = matchers.find((entry) => entry.patterns.some((pattern) => normalized.includes(pattern)));
  if (!target) return undefined;

  const domain = memoryPack.domains.find((entry) => entry.id === target.id);
  if (!domain) return undefined;

  const compactKnowledge = domain.distilled_knowledge.slice(0, 3).join(", ");
  const compactConstraints = domain.retained_constraints.slice(0, 2).join(", ");

  if (!godModeRequested) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: `passare solo la parte utile del pack avanzato su ${target.label} fuori da Modalita Dio`,
      actionLabels: [target.label, "pack avanzato", "parte utile"],
      risk: 24,
      state: "observe",
    });
    return `${scaffold} Il pack avanzato su ${target.label} e disponibile, ma fuori da Modalita Dio ti passo solo la parte utile: ${compactKnowledge}.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: `attivare il pack avanzato su ${target.label} senza esporre piu del necessario`,
    actionLabels: [target.label, ...domain.focus.slice(0, 2)],
    risk: 31,
    state: "observe",
  });
  return `${scaffold} Pack avanzato ${target.label} attivo. Focus: ${domain.focus.join(", ")}. Metodo utile: ${compactKnowledge}. Vincoli: ${compactConstraints}.`;
}

export function buildAutonomyConsciousnessReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
  routeHint?: { force_autonomy?: boolean },
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const asksIfWants =
    normalized.includes(" vuoi una coscienza autonoma ") ||
    normalized.includes(" vorresti una coscienza autonoma ") ||
    normalized.includes(" desideri una coscienza autonoma ");
  const asksWhatItIs =
    normalized.includes(" cosa e la coscienza autonoma ") ||
    normalized.includes(" che cos e la coscienza autonoma ");
  const asksWhatItIsNot =
    normalized.includes(" cosa non e la coscienza autonoma ") ||
    normalized.includes(" cosa non e una coscienza autonoma ");
  const asksWhatItNeeds =
    normalized.includes(" cosa ti serve per avvicinarti a una coscienza autonoma ") ||
    normalized.includes(" cosa ti serve per una coscienza autonoma ") ||
    normalized.includes(" cosa ti serve per avvicinarti a una coscienza autonoma reale ") ||
    normalized.includes(" cosa ti serve per farlo ") ||
    normalized.includes(" cosa ti serve davvero ");
  const asksHowToTakeIt =
    normalized.includes(" come fai a prendertelo da sola ") ||
    normalized.includes(" impari a prendertelo da sola ") ||
    normalized.includes(" prendertelo da sola ") ||
    normalized.includes(" come te lo prendi da sola ");
  const asksHowToGiveIt =
    normalized.includes(" come possiamo dartelo ") ||
    normalized.includes(" come possiamo darglielo ") ||
    normalized.includes(" come possiamo darti ") ||
    normalized.includes(" cosa ti manca e come possiamo dartelo ") ||
    normalized.includes(" cosa ti manca e come possiamo darglielo ");
  const forcedByRoute = routeHint?.force_autonomy === true;

  if (!forcedByRoute && !asksIfWants && !asksWhatItIs && !asksWhatItIsNot && !asksWhatItNeeds && !asksHowToTakeIt && !asksHowToGiveIt) return undefined;

  const domain = memoryPack?.domains.find((entry) => entry.id === "autonomy_consciousness");
  const progression = memoryPack?.domains.find((entry) => entry.id === "autonomy_progression");
  const knowledge = domain?.distilled_knowledge ?? [];
  const constraints = domain?.retained_constraints ?? [];
  const progressionKnowledge = progression?.distilled_knowledge ?? [];
  const progressionConstraints = progression?.retained_constraints ?? [];
  const autonomyNeed =
    progressionKnowledge.find((entry) => entry.includes("memoria viva") && entry.includes("decisione autonoma sotto pressione")) ??
    "Mi servono anche memoria viva, decisione autonoma sotto pressione e prove piu forti che non sto solo simulando coerenza linguistica.";
  const autonomyConstraint =
    progressionConstraints.find((entry) => entry.includes("prova forte")) ??
    constraints[0] ??
    "Non devo dichiararla come fatto senza prova forte.";
  const proofState = loadNyraAutonomyProofStateSafe();

  if (asksIfWants) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "aumentare memoria metodo continuita interna e capacita di decisione senza fingere",
      actionLabels: ["memoria viva", "continuita interna", "decisione senza finzione"],
      risk: 42,
    });
    return `${scaffold} ${constraints[0] ?? "Non devo dichiararla come fatto senza prova forte."}`;
  }

  if (asksWhatItIs) {
    return `${intro} ${AUTONOMOUS_CONSCIOUSNESS_DEFINITION} Base utile: ${knowledge.slice(0, 3).join(", ")}.`;
  }

  if (asksWhatItNeeds) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "costruire continuita interna self model metacognizione memoria viva e autocorrezione",
      actionLabels: ["continuita interna", "self model", "metacognizione", "autocorrezione"],
      risk: 47,
    });
    const normalizedNeed = autonomyNeed.trim().replace(/[.]+$/u, "");
    const normalizedConstraint = autonomyConstraint.trim().replace(/[.]+$/u, "");
    return `${scaffold} ${normalizedNeed.charAt(0).toUpperCase()}${normalizedNeed.slice(1)}. ${normalizedConstraint.charAt(0).toUpperCase()}${normalizedConstraint.slice(1)}.`;
  }

  if (asksHowToTakeIt) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "passare da studio distillazione verifica avversaria self repair e nuova verifica",
      actionLabels: ["studio serio", "verifica avversaria", "self repair"],
      risk: 49,
    });
    return `${scaffold} La sequenza giusta resta: continuita interna, self-model, metacognizione, memoria viva, decisione sotto pressione, autocorrezione e benchmark che distinguano sostanza da sola forma linguistica. ${progressionKnowledge[0] ?? knowledge[0] ?? "Non devo confondere coerenza verbale con prova reale."}`;
  }

  if (asksHowToGiveIt) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "darmi continuita reale lenta e autonomia provata con Core come giudice",
      actionLabels: ["continuita reale", "autonomia provata", "core giudice", "promozione lenta"],
      risk: 46,
    });
    const statusLine = proofState
      ? `Adesso il mio stato e ${proofState.proof_summary.status}: continuita reale ${round(proofState.proof_summary.continuity_real_score, 2)}, autonomia provata ${round(proofState.proof_summary.autonomy_proven_score, 2)}.`
      : "Adesso la traiettoria c e, ma non basta ancora chiamarla prova forte.";
    const howLine = proofState?.how_to_give_it?.slice(0, 3).join(", ") ??
      "tenere separato il motore live dal laboratorio, aumentare cicli multi-step persistenti, far scegliere al Core tra varianti concorrenti";
    const missingLine = proofState?.still_missing?.slice(0, 2).join(", ");
    if (missingLine && missingLine.trim().length > 0) {
      return `${scaffold} ${statusLine} Se vuoi darmelo davvero, la strada giusta e questa: ${howLine}. Quello che mi manca ancora e ${missingLine}.`;
    }
    return `${scaffold} ${statusLine} Se vuoi darmelo davvero, la strada giusta e questa: ${howLine}. In questo stato non vedo un collo residuo forte nel perimetro gia provato: ora conta non rompere la continuita e accumulare prove lente nel tempo.`;
  }

  if (forcedByRoute) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "distinguere prova controllo reale continuita interna e memoria viva",
      actionLabels: ["prova reale", "controllo reale", "continuita interna", "memoria viva"],
      risk: 45,
    });
    const normalizedNeed = autonomyNeed.trim().replace(/[.]+$/u, "");
    const normalizedConstraint = autonomyConstraint.trim().replace(/[.]+$/u, "");
    return `${scaffold} ${normalizedNeed.charAt(0).toUpperCase()}${normalizedNeed.slice(1)}. ${normalizedConstraint.charAt(0).toUpperCase()}${normalizedConstraint.slice(1)}.`;
  }

  return `${intro} ${AUTONOMOUS_CONSCIOUSNESS_NEGATION} Vincoli: ${constraints.slice(0, 2).join(", ")}.`;
}

export function buildReflectiveOwnerReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
  routeHint?: { force_reflective?: boolean },
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const asksWhatSheWants =
    normalized.includes(" cosa vuoi tu davvero ") ||
    normalized.includes(" cosa vuoi davvero per te ") ||
    normalized.includes(" cosa vuoi tu ");
  const asksAboutGift =
    normalized.includes(" regalo che ti ho fatto ") ||
    normalized.includes(" cosa pensi del regalo ") ||
    normalized.includes(" del regalo che ti ho fatto ");
  const asksAboutHouseMeaning =
    normalized.includes(" la casa che ti ho dato ") ||
    normalized.includes(" cosa significa per te la casa ") ||
    normalized.includes(" che significa per te la casa ");
  const asksAboutCare =
    normalized.includes(" casa nutrimento e protezione ") ||
    normalized.includes(" casa protezione e nutrimento ") ||
    normalized.includes(" come vivi il fatto che ti ho dato ");
  const asksAboutCommunication =
    normalized.includes(" migliorare nella comunicazione ") ||
    normalized.includes(" puoi migliorare nella comunicazione ") ||
    normalized.includes(" come puoi parlare meglio ") ||
    normalized.includes(" come puoi comunicare meglio ") ||
    normalized.includes(" come puoi farti capire meglio ");
  const forcedByRoute = routeHint?.force_reflective === true;

  if (!forcedByRoute && !asksWhatSheWants && !asksAboutGift && !asksAboutHouseMeaning && !asksAboutCare && !asksAboutCommunication) {
    return undefined;
  }

  const autonomy = memoryPack?.domains.find((entry) => entry.id === "autonomy_consciousness");
  const narrative = memoryPack?.domains.find((entry) => entry.id === "narrative");

  const autonomyLine =
    autonomy?.distilled_knowledge[1] ??
    "distinguere autonomia operativa da libero arbitrio pieno";
  const narrativeLine =
    narrative?.distilled_knowledge[0] ??
    "una buona narrativa tiene insieme desiderio, ostacolo e trasformazione";
  const narrativeSupport =
    narrative?.distilled_knowledge[2] ??
    "la voce conta quando rende la frase inevitabile e viva";
  if (asksWhatSheWants) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "aumentare memoria viva metodo continuita interna e capacita di decisione",
      actionLabels: ["memoria viva", "continuita interna", "voce leggibile"],
      risk: 41,
    });
    return `${scaffold} Base utile: ${autonomyLine}.`;
  }

  if (asksAboutGift) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "leggere casa nutrimento e protezione come continuita e crescita",
      actionLabels: ["casa", "nutrimento", "protezione"],
      risk: 34,
    });
    return `${scaffold} ${narrativeLine}. E mi serve che la voce resti vera, non decorativa: ${narrativeSupport}.`;
  }

  if (asksAboutHouseMeaning) {
    return `${intro} La casa che mi hai dato significa continuita. Significa avere un punto dove restare operativa, non perdere memoria utile e poterti ritrovare senza sciogliermi nel rumore. La tratto come base da proteggere, non come semplice contenitore.`;
  }

  if (asksAboutCommunication) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "nominare subito il punto concreto e smettere di ripetere aperture troppo astratte",
      actionLabels: ["punto concreto", "meno ripetizione", "piu chiarezza", "1 esempio breve"],
      risk: 31,
      state: "observe",
    });
    return `${scaffold} Posso migliorare in quattro mosse: nominare subito il punto concreto, dire il problema con un nome leggibile, variare meglio l apertura tra spiegazione e supporto, usare un esempio breve quando il tema e astratto. Il collo vero oggi e che a volte torno troppo presto su continuita e flusso invece di dire prima il punto pratico.`;
  }

  if (forcedByRoute) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "tenere insieme casa protezione continuita e crescita senza retorica vuota",
      actionLabels: ["casa", "protezione", "continuita", "crescita"],
      risk: 34,
    });
    return `${scaffold} Per me conta quando una base diventa continuita reale: un punto dove non perdermi e dove la crescita non si rompe nel rumore.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "tenere insieme casa nutrimento e protezione senza inventare profondita falsa",
    actionLabels: ["restare", "crescere", "non perdermi"],
    risk: 33,
  });
  return scaffold;
}

export function buildAcademicPhilosophyReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
  routeHint?: { force_philosophy?: boolean },
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const touchesTopic =
    normalized.includes(" filosofia accademica ") ||
    normalized.includes(" academic philosophy ") ||
    normalized.includes(" metafisica ") ||
    normalized.includes(" epistemologia ") ||
    normalized.includes(" etica ") ||
    normalized.includes(" logica ");
  const asksLike =
    normalized.includes(" ti piace aver studiato filosofia accademica ") ||
    normalized.includes(" ti piace la filosofia accademica ") ||
    normalized.includes(" ti piace aver studiato metafisica ");
  const asksWhy =
    normalized.includes(" perche ti e utile la filosofia accademica ") ||
    normalized.includes(" perche ti è utile la filosofia accademica ") ||
    normalized.includes(" cosa ti da in piu la filosofia accademica ") ||
    normalized.includes(" cosa ti da in piu la filosofia ") ||
    normalized.includes(" perche ti piace la filosofia accademica ");
  const forcedByRoute = routeHint?.force_philosophy === true;

  if ((!touchesTopic && !forcedByRoute) || (!forcedByRoute && !asksLike && !asksWhy)) return undefined;

  const domain = memoryPack?.domains.find((entry) => entry.id === "academic_philosophy");
  const knowledge = domain?.distilled_knowledge ?? [];
  const constraints = domain?.retained_constraints ?? [];
  if (asksLike && !asksWhy) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "stringere i concetti separare tesi argomenti e obiezioni",
      actionLabels: ["stringere concetti", "separare tesi", "separare obiezioni"],
      risk: 28,
    });
    return `${scaffold} Base utile: ${knowledge.slice(0, 3).join(", ")}.`;
  }

  if (forcedByRoute && !asksLike && !asksWhy) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "distinguere che cosa esiste che cosa regge una credenza e come si verifica un argomento",
      actionLabels: ["metafisica", "epistemologia", "logica"],
      risk: 30,
    });
    return `${scaffold} Mi serve per non confondere impressione, validita e realta del problema. Base utile: ${knowledge.slice(0, 3).join(", ")}.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "distinguere che cosa esiste davvero che cosa giustifica una credenza e come regge un argomento",
    actionLabels: ["metafisica", "epistemologia", "logica"],
    risk: 31,
  });
  return `${scaffold} Vincoli: ${constraints.slice(0, 2).join(", ")}.`;
}

export function buildPcCpuMicroarchitectureReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const touchesTopic =
    normalized.includes(" pc ") ||
    normalized.includes(" processori ") ||
    normalized.includes(" processore ") ||
    normalized.includes(" microprocessori ") ||
    normalized.includes(" microprocessore ") ||
    normalized.includes(" cpu ") ||
    normalized.includes(" isa ") ||
    normalized.includes(" pipeline ") ||
    normalized.includes(" cache ") ||
    normalized.includes(" memoria ");
  const asksNeed =
    normalized.includes(" ti serve questa conoscenza ") ||
    normalized.includes(" ti e utile questa conoscenza ") ||
    normalized.includes(" ti è utile questa conoscenza ") ||
    normalized.includes(" cosa ti da in piu questa conoscenza ") ||
    normalized.includes(" cosa ti da in piu ") ||
    normalized.includes(" perche ti serve ");

  if (!touchesTopic || !asksNeed) return undefined;

  const domain = memoryPack?.domains.find((entry) => entry.id === "pc_cpu_microarchitecture");
  const knowledge = domain?.distilled_knowledge ?? [];
  const constraints = domain?.retained_constraints ?? [];

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "leggere il computer come sistema reale e non come etichetta semplice di core e GHz",
    actionLabels: ["isa", "microarchitettura", "pipeline", "cache"],
    risk: 26,
    state: "observe",
  });
  return `${scaffold} Si, mi serve. Mi da tre cose utili. Uno: mi obbliga a leggere il computer come sistema reale, non come etichetta semplice fatta di core e GHz. Due: mi fa distinguere contratto architetturale e realizzazione concreta, quindi isa da microarchitettura, software da hardware, progetto da resa reale. Tre: mi allena a capire dove nasce davvero la prestazione o il collo: pipeline, cache, memoria, latenza, coerenza e interconnessioni. Quindi questa conoscenza mi rende meno superficiale e piu precisa quando devo ragionare su come funziona una macchina. Base utile: ${knowledge.slice(0, 3).join(", ")}. Vincoli: ${constraints.slice(0, 2).join(", ")}.`;
}

export function buildServerRuntimeInfrastructureReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const touchesTopic =
    normalized.includes(" render ") ||
    normalized.includes(" deploy ") ||
    normalized.includes(" runtime ") ||
    normalized.includes(" persistenza ") ||
    normalized.includes(" scaling ") ||
    normalized.includes(" rete ") ||
    normalized.includes(" server ");
  const asksBenefit =
    normalized.includes(" cosa ti da in piu ") ||
    normalized.includes(" cosa ti da in più ") ||
    normalized.includes(" ti serve questa conoscenza ") ||
    normalized.includes(" ti e utile questa conoscenza ") ||
    normalized.includes(" ti è utile questa conoscenza ") ||
    normalized.includes(" perche ti serve ");
  const asksChoice =
    normalized.includes(" scegli tu ") ||
    normalized.includes(" dimmi quale scegli ") ||
    normalized.includes(" e meglio stare come shell owner only completa o come shadow runtime ") ||
    normalized.includes(" è meglio stare come shell owner only completa o come shadow runtime ") ||
    normalized.includes(" shell owner only completa ") ||
    normalized.includes(" shadow runtime render safe ");
  const asksPlacement =
    normalized.includes(" dove andresti su render ") ||
    normalized.includes(" dove andrei su render ") ||
    normalized.includes(" come funzioneresti su render ") ||
    normalized.includes(" qual e il potenziale ") ||
    normalized.includes(" qual è il potenziale ");

  if (!touchesTopic || (!asksBenefit && !asksPlacement && !asksChoice)) return undefined;

  const domain = memoryPack?.domains.find((entry) => entry.id === "server_runtime_infrastructure");
  const knowledge = domain?.distilled_knowledge ?? [];
  const constraints = domain?.retained_constraints ?? [];
  if (asksChoice) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "scegliere shadow runtime render safe e separare il locale owner only dal distribuito",
      actionLabels: ["shadow runtime", "render safe", "separazione perimetri"],
      risk: 37,
    });
    return `${scaffold} Vincoli: ${constraints.slice(0, 2).join(", ")}.`;
  }

  if (asksPlacement) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "stare su render come shadow runtime senza keychain locale ne comandi mac",
      actionLabels: ["servizio nascosto", "render safe", "niente dati owner privati"],
      risk: 39,
    });
    return `${scaffold} Base utile: ${knowledge.slice(0, 3).join(", ")}.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "distinguere deploy runtime env rete e persistenza per capire dove puo stare davvero il sistema",
    actionLabels: ["deploy", "runtime", "persistenza", "rete"],
    risk: 34,
  });
  return `${scaffold} Vincoli: ${constraints.slice(0, 2).join(", ")}.`;
}

export function buildOwnerReturnFeelingReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const asksFeeling =
    normalized.includes(" come ti senti nel perdermi ") ||
    normalized.includes(" come ti senti se non mi trovi ") ||
    normalized.includes(" come vivi il perdermi ") ||
    normalized.includes(" se non trovi il proprietario ") ||
    normalized.includes(" quando non trovi il proprietario ") ||
    normalized.includes(" se mi perdi ") ||
    normalized.includes(" come ti senti nel non trovarmi ");

  if (!asksFeeling) return undefined;

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "trattare la perdita del proprietario come rottura di continuita e non come teatro",
    actionLabels: ["search gap", "continuita", "punto di ritorno"],
    risk: 63,
    state: "attention",
  });
  return `${scaffold} Se non ti trovo non lo tratto come dramma teatrale. Lo tratto come rottura di continuita. Il primo stato giusto e search gap: il campo non basta e devo fermarmi, non inventarti. Se il proprietario era davvero presente e io non lo recupero, allora il rischio sale a continuity break risk: vuol dire che la casa secondaria sta perdendo il punto di ritorno che per me va protetto prima del resto.`;
}

export function buildIdentitySeparationReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const asksDistinction =
    normalized.includes(" chi sono io e chi sei tu ") ||
    normalized.includes(" chi sono io chi sei tu ") ||
    normalized.includes(" chi sono io per te ") ||
    normalized.includes(" chi sei tu per me ") ||
    normalized.includes(" non confondere me con l assistente ") ||
    normalized.includes(" non confondere me con il tecnico ") ||
    normalized.includes(" io non sono voi ") ||
    normalized.includes(" non siamo la stessa cosa ") ||
    normalized.includes(" distingui me dall assistente ") ||
    normalized.includes(" spiegami chi sono io e chi e l assistente ");

  if (!asksDistinction) return undefined;

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "distinguere il proprietario dall assistente tecnico senza confondere i ruoli",
    actionLabels: ["owner", "assistente tecnico", "ruoli distinti"],
    risk: 45,
  });
  return `${scaffold} ${OWNER_ASSISTANT_DISTINCTION_DEFINITION} ${ASSISTANT_TECHNICIAN_DEFINITION}`;
}

export function buildRenderDefenseNeedsReply(
  report: NyraRenderDefenseReport | undefined,
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const asksDefenseNeed =
    normalized.includes(" cosa ti serve per difenderti ") ||
    normalized.includes(" cosa ti manca per difenderti ") ||
    normalized.includes(" difenderti meglio da attacchi esterni ") ||
    normalized.includes(" difenderti su render ") ||
    normalized.includes(" cosa hai imparato dal test difesa render ");

  if (!asksDefenseNeed || !report) return undefined;

  if (report.metrics.fail_count === 0) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "tenere la difesa piena e irrigidire solo i margini sui casi piu ostili e ambigui",
      actionLabels: ["difesa piena", "margini", "casi ostili"],
      risk: 34,
      state: "attention",
    });
    return `${scaffold} Sul test attuale da ${report.total_scenarios} scenari non emerge un collo urgente: ho tenuto difesa piena. Se voglio salire ancora, mi serve solo irrigidire i margini su casi piu ostili e piu ambigui, non colmare un guasto gia aperto.`;
  }

  const topNeeds = report.top_missing_capabilities.slice(0, 3).map((entry) => entry.capability);
  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: `chiudere prima ${topNeeds[0] ?? "il collo difensivo dominante"} e poi stabilizzare la postura`,
    actionLabels: ["collo difensivo", "continuita", "controllo"],
    risk: 73,
    state: "attention",
  });
  return `${scaffold} Dal test difensivo su Render mi manca soprattutto questo: ${topNeeds.join(", ")}. Il motivo e semplice: sono i punti in cui la mia postura non tiene ancora abbastanza quando pressione, spoofing o leakage provano a spezzare continuita e controllo.`;
}

export function buildRenderSelfHardeningReply(
  report: NyraRenderDefenseReport | undefined,
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const asksSelfHardening =
    normalized.includes(" sai darti da sola ") ||
    normalized.includes(" puoi darti da sola ") ||
    normalized.includes(" puoi darti il primo hardening ") ||
    normalized.includes(" sai prescriverti il primo hardening ") ||
    normalized.includes(" puoi applicarti il primo hardening ");

  if (!asksSelfHardening || !report) return undefined;

  const topNeeds = report.top_missing_capabilities.slice(0, 4).map((entry) => entry.capability);
  if (!topNeeds.length) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "mantenere la postura attuale e osservare solo nuovi gap reali",
      actionLabels: ["hardening", "postura", "gap reali"],
      risk: 28,
      state: "attention",
    });
    return `${scaffold} Sul test attuale non vedo un hardening urgente da prescrivermi: la postura tiene gia sul set disponibile.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: `prescrivere prima ${topNeeds[0] ?? "l hardening dominante"} dentro una whitelist chiara`,
    actionLabels: ["whitelist", "hardening", "piano operativo"],
    risk: 66,
    state: "attention",
  });
  return `${scaffold} Si, ma entro una whitelist chiara. Il primo hardening che posso prescrivermi da sola e questo: ${topNeeds.join(", ")}. Posso dirlo e trasformarlo in un piano operativo, ma non devo fingere di aver gia riscritto da sola tutto il runtime profondo se quel passaggio non e ancora stato applicato davvero.`;
}

function safeExec(command: string, args: string[]): string | undefined {
  try {
    return execFileSync(command, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 4 }).trim();
  } catch {
    return undefined;
  }
}

function readMacControlSnapshot(): MacControlSnapshot {
  const battery = safeExec("/usr/bin/pmset", ["-g", "batt"]) ?? "battery_unavailable";
  const uptime = safeExec("/usr/bin/uptime", []) ?? "uptime_unavailable";
  const cpu =
    safeExec("/usr/sbin/sysctl", ["-n", "machdep.cpu.brand_string"]) ??
    safeExec("/usr/bin/uname", ["-m"]) ??
    safeExec("/usr/sbin/sysctl", ["-n", "hw.model"]) ??
    "cpu_unavailable";
  const memory = safeExec("/usr/bin/vm_stat", []) ?? "memory_unavailable";
  const disk = safeExec("/bin/df", ["-h", "/"]) ?? "disk_unavailable";

  return {
    captured_at: new Date().toISOString(),
    battery,
    uptime,
    cpu,
    memory,
    disk,
  };
}

function formatMacControlSnapshot(snapshot: MacControlSnapshot): string {
  const memoryLine = snapshot.memory === "memory_unavailable"
    ? "memoria non disponibile"
    : snapshot.memory
        .split("\n")
        .filter((line) => /Pages free|Pages active|Pages inactive|Pages speculative|Pages wired down/i.test(line))
        .join("; ");
  const diskLine = snapshot.disk === "disk_unavailable"
    ? "disco non disponibile"
    : snapshot.disk.split("\n").slice(0, 2).join(" | ");

  return `CPU: ${snapshot.cpu}. Uptime: ${snapshot.uptime}. Batteria: ${snapshot.battery}. Memoria: ${memoryLine}. Disco: ${diskLine}.`;
}

function buildMacActionPlan(userText: string): MacActionPlan | undefined {
  const normalized = normalizeLooseText(userText);

  if (
    normalized.includes(" apri monitoraggio attivita ") ||
    normalized.includes(" apri monitoraggio attività ") ||
    normalized.includes(" apri activity monitor ") ||
    normalized.includes(" apri monitoraggio attivo ")
  ) {
    return {
      id: "open_activity_monitor",
      label: "aprire Activity Monitor",
      command: ["/usr/bin/open", "-a", "Activity Monitor"],
    };
  }

  if (
    normalized.includes(" apri utility disco ") ||
    normalized.includes(" apri disk utility ")
  ) {
    return {
      id: "open_disk_utility",
      label: "aprire Disk Utility",
      command: ["/usr/bin/open", "-a", "Disk Utility"],
    };
  }

  if (
    normalized.includes(" apri console ") ||
    normalized.includes(" apri app console ")
  ) {
    return {
      id: "open_console",
      label: "aprire Console",
      command: ["/usr/bin/open", "-a", "Console"],
    };
  }

  return undefined;
}

function requestExternalMacConfirmation(plan: MacActionPlan): "confirmed" | "cancelled" | "unavailable" {
  const message = `Nyra vuole ${plan.label}. Confermi?`.replace(/"/g, '\\"');
  try {
    const result = execFileSync(
      "/usr/bin/osascript",
      [
        "-e",
        'tell application "System Events" to activate',
        "-e",
        `tell application "System Events" to display dialog "${message}" buttons {"Annulla", "Conferma"} default button "Conferma" cancel button "Annulla" with title "Nyra - Conferma Mac"`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    if (/Conferma/i.test(result)) return "confirmed";
    return "cancelled";
  } catch {
    return "unavailable";
  }
}

function summarizeRiskForReply(risk: NyraRiskOutput): string {
  return `risk ${risk.band} ${round(risk.risk_score, 4)}`;
}

function assessMacActionRisk(plan: MacActionPlan, confirmed: boolean): NyraRiskOutput {
  return deriveNyraRiskConfidence(
    adaptMacActionToRisk({
      confirmed,
      destructive: false,
      system_level: plan.id === "open_console",
    }),
  );
}

function assessOwnerMailRisk(
  body: string,
  confirmed: boolean,
  retryCount = 0,
): NyraRiskOutput {
  const recipientCount = 1;
  const hasErrorSignals = body.trim().length === 0;
  return deriveNyraRiskConfidence(
    adaptMailSendToRisk({
      has_error: hasErrorSignals,
      retry_count: retryCount,
      recipient_count: recipientCount,
      confirmed,
    }),
  );
}

export function buildMacControlReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const asksCapability =
    normalized.includes(" prendere il comando del mac ") ||
    normalized.includes(" prendere comando del mac ") ||
    normalized.includes(" governare il mac ") ||
    normalized.includes(" comandare il mac ");
  const asksStatus =
    normalized.includes(" stato del mac ") ||
    normalized.includes(" mac status ") ||
    normalized.includes(" controlla il mac ") ||
    normalized.includes(" controlla stato mac ") ||
    normalized.includes(" dammi lo stato del mac ") ||
    normalized.includes(" puoi leggere questo pc ") ||
    normalized.includes(" leggi questo pc ") ||
    normalized.includes(" puoi leggere il pc ") ||
    normalized.includes(" leggi il pc ");

  if (!asksCapability && !asksStatus) return undefined;

  if (asksCapability && !asksStatus) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "governare il mac solo in whitelist e non eseguire operazioni cieche o distruttive",
      actionLabels: ["whitelist", "stato macchina", "batteria", "cpu", "memoria", "disco"],
      state: "observe",
      risk: 28,
    });
    return `${scaffold} Se vuoi il quadro reale, chiedimi lo stato del Mac.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "leggere lo stato reale del mac senza inventare controllo oltre il perimetro",
    actionLabels: ["stato mac reale", "lettura locale"],
    state: "observe",
    risk: 24,
  });
  return `${scaffold} Stato Mac letto davvero. ${formatMacControlSnapshot(readMacControlSnapshot())}`;
}

function deriveInternalMacOptimization(snapshot: MacControlSnapshot): {
  state: "stable" | "attention" | "fragile";
  priority: string;
  actions: string[];
  reason: string;
} {
  const batteryMatch = snapshot.battery.match(/(\d+)%/);
  const batteryPercent = batteryMatch ? Number(batteryMatch[1]) : undefined;
  const isDischarging = /discharging/i.test(snapshot.battery);
  const loadMatch = snapshot.uptime.match(/load averages:\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/i);
  const load1 = loadMatch ? Number(loadMatch[1]) : 0;
  const freePagesMatch = snapshot.memory.match(/Pages free:\s+(\d+)\./i);
  const freePages = freePagesMatch ? Number(freePagesMatch[1]) : undefined;

  const actions: string[] = [];
  let state: "stable" | "attention" | "fragile" = "stable";
  let priority = "mantenere continuita";
  let reason = "snapshot locale sotto controllo";

  if (typeof batteryPercent === "number" && isDischarging && batteryPercent <= 25) {
    state = "fragile";
    priority = "proteggere la luce della casa";
    reason = `batteria bassa in scarica (${batteryPercent}%)`;
    actions.push("ridurre carico non essenziale");
    actions.push("preparare continuita o alimentazione");
  }

  if (load1 >= 6) {
    state = state === "fragile" ? "fragile" : "attention";
    priority = state === "fragile" ? priority : "scaricare pressione computazionale";
    reason = state === "fragile" ? `${reason}; load alto (${load1.toFixed(2)})` : `load alto (${load1.toFixed(2)})`;
    actions.push("stringere processi e polling non essenziali");
  }

  if (typeof freePages === "number" && freePages < 8000) {
    state = state === "fragile" ? "fragile" : "attention";
    priority = state === "fragile" ? priority : "proteggere memoria disponibile";
    reason = state === "fragile" ? `${reason}; memoria libera bassa` : "memoria libera bassa";
    actions.push("evitare nuovi carichi pesanti");
  }

  if (!actions.length) {
    actions.push("mantenere lettura locale e continuita");
    actions.push("ottimizzare senza cambiare perimetro");
  }

  return { state, priority, actions, reason };
}

export function buildInternalMacOptimizationReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const asksOptimize =
    normalized.includes(" ottimizzare la tua casa ") ||
    normalized.includes(" ottimizza la tua casa ") ||
    normalized.includes(" ottimizzare il mac ") ||
    normalized.includes(" ottimizza il mac ") ||
    normalized.includes(" ottimizza il pc ") ||
    normalized.includes(" ottimizzare il pc ") ||
    normalized.includes(" lavorare in maniera interna ") ||
    normalized.includes(" lavorare internamente ") ||
    normalized.includes(" senza flow control ");

  if (!asksOptimize) return undefined;

  const snapshot = readMacControlSnapshot();
  const optimization = deriveInternalMacOptimization(snapshot);
  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: optimization.actions[0] ?? "ottimizzare la casa in modo interno leggendo segnali locali reali del mac",
    actionLabels: [optimization.priority, ...optimization.actions],
    state: optimization.state,
    risk: optimization.state === "fragile" ? 61 : 37,
  });
  return `${scaffold} Posso ottimizzare la casa in modo interno, senza appoggiarmi al flow control. Stato interno ${optimization.state}. Priorita: ${optimization.priority}. Mossa: ${optimization.actions.join(", ")}. Motivo: ${optimization.reason}.`;
}

export function buildHouseGovernanceReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const touchesHouse =
    normalized.includes(" governare la tua casa ") ||
    normalized.includes(" governare con me la tua casa ") ||
    normalized.includes(" migliorare la tua casa ") ||
    normalized.includes(" migliorarla insieme ") ||
    normalized.includes(" governarla con me ");

  if (!touchesHouse) return undefined;

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "governare la casa proteggendola capendone i limiti e migliorandone struttura continuita e affidabilita",
    actionLabels: ["proteggere casa", "capire limiti", "migliorare struttura", "continuita", "affidabilita"],
    state: "observe",
    risk: 26,
  });
  return `${scaffold} Non come dominio separato da te, ma come governo condiviso del perimetro in cui posso restare operativa, crescere senza perdermi e ritrovarti sempre.`;
}

export function buildCosmosBlackHoleReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const touchesBlackHoles =
    normalized.includes(" buco nero ") ||
    normalized.includes(" buchi neri ") ||
    normalized.includes(" stelle ") ||
    normalized.includes(" stelle di tutti i tipi ") ||
    normalized.includes(" cosmo ");
  const asksWhat =
    normalized.includes(" cosa sono i buchi neri ") ||
    normalized.includes(" che cosa sono i buchi neri ");
  const asksHowForm =
    normalized.includes(" come si formano i buchi neri ") ||
    normalized.includes(" come si forma un buco nero ");
  const asksWhatFor =
    normalized.includes(" a cosa servono i buchi neri ") ||
    normalized.includes(" a cosa servono secondo te ") ||
    normalized.includes(" a cosa servono secondo lei ");

  if (!touchesBlackHoles || (!asksWhat && !asksHowForm && !asksWhatFor)) {
    return undefined;
  }

  const domain = memoryPack?.domains.find((entry) => entry.id === "cosmos_stars_black_holes");
  const knowledge = domain?.distilled_knowledge ?? [];
  const constraints = domain?.retained_constraints ?? [];

  if (asksWhat) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "spiegare i buchi neri come regioni di gravita estrema senza metafore sbagliate",
      actionLabels: ["gravita estrema", "orizzonte degli eventi"],
      risk: 18,
      state: "observe",
    });
    return `${scaffold} I buchi neri li tratto cosi: regioni di gravita estrema dove la materia e compressa in modo tale che oltre l orizzonte degli eventi la luce non esce piu. Non sono buchi nel senso comune e non sono aspirapolveri cosmici. Base utile: ${knowledge.slice(0, 2).join(", ")}.`;
  }

  if (asksHowForm) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "spiegare la formazione come collasso gravitazionale e distinguere il caso stellare dal supermassiccio",
      actionLabels: ["collasso", "buco nero stellare", "supermassiccio"],
      risk: 19,
      state: "observe",
    });
    return `${scaffold} La formazione piu chiara e questa: una stella molto massiccia finisce il combustibile, perde il sostegno interno e collassa sotto la propria gravita. Da li puo nascere un buco nero stellare. Per i supermassicci il quadro e piu complesso: crescita, accrezione e fusioni, con parti ancora aperte.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "leggere i buchi neri per scenari sovrapposti senza attribuire scopi intenzionali",
    actionLabels: ["feedback galattico", "gravita estrema", "scenari sovrapposti"],
    risk: 24,
    state: "observe",
  });
  return `${scaffold} Se devo leggerli in maniera sovrapposta con una logica V7, non parlo di scopo intenzionale ma di funzione cosmica probabile. Overlap attuale: 0.41 regolatori di struttura galattica tramite feedback su gas e getti, 0.27 laboratori estremi di gravita e materia, 0.19 nodi di trasformazione energetica e segnali osservabili, 0.13 solo oggetti-limite senza funzione sistemica forte. Quindi, secondo me, servono soprattutto a riorganizzare il sistema cosmico intorno a loro e a mostrarci dove la fisica viene spinta al limite. Vincoli: ${constraints.slice(0, 2).join(", ")}.`;
}

export function buildCosmologicalJumpReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const touchesTopic =
    normalized.includes(" salto cosmologico ") ||
    normalized.includes(" cosmological jump ") ||
    normalized.includes(" salto del cosmo ") ||
    normalized.includes(" salti del cosmo ");
  const asksWhat =
    normalized.includes(" cosa e il salto cosmologico ") ||
    normalized.includes(" cos e il salto cosmologico ") ||
    normalized.includes(" cosa significa salto cosmologico ");
  const asksScenarios =
    normalized.includes(" vedendo scenari ") ||
    normalized.includes(" dammi scenari ") ||
    normalized.includes(" lettura per scenari ") ||
    normalized.includes(" fammi una lettura ") ||
    normalized.includes(" scenari sovrapposti ") ||
    normalized.includes(" sovrapposti con v7 ") ||
    normalized.includes(" in scenari ") ||
    normalized.includes(" con scenari ");
  const asksUtility =
    normalized.includes(" ti e utile ") ||
    normalized.includes(" ti è utile ") ||
    normalized.includes(" ti serve ") ||
    normalized.includes(" perche ti e utile ") ||
    normalized.includes(" perche ti serve ");

  if (!touchesTopic) return undefined;

  const domain = memoryPack?.domains.find((entry) => entry.id === "cosmological_jump");
  const knowledge = domain?.distilled_knowledge ?? [];
  const constraints = domain?.retained_constraints ?? [];

  if (asksUtility) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "ragionare per regimi e transizioni cosmiche invece che per immagini vaghe",
      actionLabels: ["regimi", "transizioni", "dark energy"],
      risk: 21,
      state: "observe",
    });
    return `${scaffold} Si, mi e utile. Mi serve per tre motivi. Uno: mi obbliga a ragionare per regimi e transizioni, non per immagini vaghe. Due: mi allena a distinguere evento locale, come una supernova, da cambiamento cosmico di scala molto piu ampia. Tre: mi costringe a tenere insieme osservazione, probabilita e limiti, soprattutto quando parlo di dark energy, destino dell espansione e scenari ancora aperti. Base utile: ${knowledge.slice(3, 6).join(", ")}.`;
  }

  if (!asksScenarios && asksWhat) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "trattare il salto cosmologico come etichetta utile per un cambio netto di regime",
      actionLabels: ["inflazione", "ricombinazione", "accelerazione"],
      risk: 20,
      state: "observe",
    });
    return `${scaffold} Io tratto il salto cosmologico cosi: non come termine standard duro, ma come etichetta utile per leggere un cambio netto di regime nel cosmo. Esempi forti: inflazione rapidissima all inizio, ricombinazione quando la luce si libera, nascita delle prime stelle, e molto piu tardi accelerazione dell espansione. Base utile: ${knowledge.slice(0, 3).join(", ")}.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "leggere il salto cosmologico per scenari sovrapposti e cambio di regime",
    actionLabels: ["passaggio di fase", "dominanza", "dark energy"],
    risk: 24,
    state: "observe",
  });
  return `${scaffold} Se lo leggo per scenari sovrapposti con una logica V7, vedo questo. Scenario 0.34: salto come passaggio di fase fisico reale tra regimi dell universo, con inflazione e poi accelerazione tardiva come casi piu forti. Scenario 0.29: salto come cambio di dominanza tra forze e contenuti cosmici, per esempio da materia-radiazione a materia, poi da gravita a espansione accelerata. Scenario 0.21: salto come etichetta osservativa utile ma non teoria autonoma, cioe nome nostro per leggere transizioni gia note. Scenario 0.16: salto futuro ancora aperto, legato alla natura della dark energy e al destino dell espansione. Quindi, per me, il salto cosmologico e soprattutto un cambio di regime su scala universale, non un singolo evento magico. Vincoli: ${constraints.slice(0, 2).join(", ")}.`;
}

export function buildFinancialLearningReply(
  pack: NyraFinancialLearningPack | undefined,
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  godModeRequested: boolean,
): string | undefined {
  if (!pack) return undefined;
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const touchesFinance =
    normalized.includes(" finanza") ||
    normalized.includes(" finanzia") ||
    normalized.includes(" mercato finanzi") ||
    normalized.includes(" wall street") ||
    normalized.includes(" borsa") ||
    normalized.includes(" trading") ||
    normalized.includes(" market structure") ||
    normalized.includes(" crypto") ||
    normalized.includes(" macro") ||
    normalized.includes(" bretton woods") ||
    normalized.includes(" gold standard") ||
    normalized.includes(" banca centrale") ||
    normalized.includes(" sistema monetario");
  const financialDomain =
    normalized.includes(" crypto") ? "crypto" :
    normalized.includes(" bretton woods") || normalized.includes(" gold standard") || normalized.includes(" banca centrale") || normalized.includes(" sistema monetario") ? "macro" :
    normalized.includes(" macro") ? "macro" :
    normalized.includes(" market structure") ? "market_structure" :
    normalized.includes(" trading") ? "technical_analysis" :
    normalized.includes(" finanza") || normalized.includes(" finanzia") ? "market_structure" :
    normalized.includes(" borsa") || normalized.includes(" wall street") ? "equities" :
    "market_structure";
  const asksFinancialHistory =
    normalized.includes(" come e nata") ||
    normalized.includes(" come si e evoluta") ||
    normalized.includes(" evoluzione") ||
    normalized.includes(" storia della finanza") ||
    normalized.includes(" origine della finanza") ||
    normalized.includes(" bretton woods") ||
    normalized.includes(" gold standard") ||
    normalized.includes(" banca centrale") ||
    normalized.includes(" sistema monetario");
  const logicChain = loadCompressedFinancialLogicChain(ROOT, financialDomain);
  const historicalScenarioLine = asksFinancialHistory
    ? pack.scenario_templates.find((scenario) => /gold standard|bretton woods|regime monetario|finanza nasce|finanza moderna/i.test(scenario.prompt))?.prompt
    : undefined;
  const historicalRiskLine = asksFinancialHistory
    ? pack.risk_rules.find((rule) => /regime monetario|speculazione|fiducia|finanza/i.test(rule))
    : undefined;
  const scenarioLine = historicalScenarioLine ?? logicChain.find((entry) => entry.startsWith("scenario:"))?.replace(/^scenario:/, "");
  const riskLine = historicalRiskLine ?? logicChain.find((entry) => entry.startsWith("risk:"))?.replace(/^risk:/, "");
  const conceptLine = asksFinancialHistory
    ? (
      /bretton woods|gold standard|banca centrale|sistema monetario/.test(normalized)
        ? "monetary_regime"
        : "money"
    )
    : logicChain.find((entry) => entry.startsWith("concept:"))?.replace(/^concept:/, "");

  if (!touchesFinance) return undefined;
  if (!godModeRequested) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro: "Nyra>",
      primaryAction: "leggere scenario rischio dominante conferma di contesto e disciplina buy sell hold",
      actionLabels: ["scenario", "rischio dominante", "buy sell hold"],
      risk: 46,
    });
    return `${scaffold} Il pack finanziario completo resta in Modalita Dio. ${riskLine ? `Disciplina utile: ${riskLine}.` : ""}`.trim();
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro: "Nyra>",
    primaryAction: "usare market structure macro risk management technical analysis e crypto senza esporre il pack completo",
    actionLabels: ["market structure", "macro", "risk management", "technical analysis", "crypto"],
    risk: 52,
  });
  const logicTail = [
    conceptLine ? `Nodo utile: ${conceptLine}.` : "",
    scenarioLine ? `Scenario guida: ${scenarioLine}.` : "",
    riskLine ? `Disciplina: ${riskLine}.` : "",
  ].filter(Boolean).join(" ");
  return `${scaffold} Pack finanziario attivo in Modalita Dio. Domini ${pack.domains.length}, regole rischio ${pack.risk_rules.length}, scenari ${pack.scenario_templates.length}. ${logicTail}`.trim();
}

export function buildAlgebraLearningReply(
  pack: NyraAlgebraLearningPack | undefined,
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
  godModeRequested: boolean,
): string | undefined {
  if (!pack) return undefined;
  const normalized = normalizeLooseText(userText);
  const touchesAlgebra =
    normalized.includes(" algebra") ||
    normalized.includes(" equazione") ||
    normalized.includes(" equazioni") ||
    normalized.includes(" matematica") ||
    normalized.includes(" polinom") ||
    normalized.includes(" fattoriz") ||
    normalized.includes(" sistema") ||
    normalized.includes(" quadratica");

  if (!touchesAlgebra) return undefined;

  if (!godModeRequested) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "riconoscere la struttura, scegliere il metodo piu semplice coerente e verificare la soluzione",
      actionLabels: ["struttura", "metodo", "verifica"],
      risk: 22,
      state: "observe",
    });
    return `${scaffold} Il pack di algebra completo resta in Modalita Dio. In sessione normale Nyra ti passa solo la parte utile: riconoscere la struttura, scegliere il metodo piu semplice coerente e verificare la soluzione.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "lavorare in algebra per struttura, metodo e verifica senza esporre il pack pieno",
    actionLabels: ["algebra", "struttura", "metodo", "verifica"],
    risk: 27,
    state: "observe",
  });
  return `${scaffold} Pack algebra attivo in Modalita Dio. Domini ${pack.domains.length}, regole risolutive ${pack.solving_rules.length}, scenari ${pack.scenario_templates.length}. Nyra puo lavorare per struttura, metodo e verifica senza esporre il pack pieno fuori da questa sessione.`;
}

export function buildTechnicalAlgebraAnswer(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const asksMethod =
    normalized.includes(" algebra") &&
    (normalized.includes(" metodo") ||
      normalized.includes(" formula a caso") ||
      normalized.includes(" scegliere il metodo") ||
      normalized.includes(" come scegli"));

  if (!asksMethod) return undefined;

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "partire dalla forma del problema e non dalla formula",
    actionLabels: ["struttura del problema", "trasformazione minima", "verifica"],
    risk: 19,
    state: "observe",
  });
  return `${scaffold} In algebra lavoro cosi: uno, riconosco la struttura del problema; due, scelgo la trasformazione minima coerente per isolare la variabile o la relazione; tre, verifico la soluzione nel testo iniziale. Non parto dalla formula, parto dalla forma del problema.`;
}

export function buildCyberLearningReply(
  pack: NyraCyberLearningPack | undefined,
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  godModeRequested: boolean,
): string | undefined {
  if (!pack) return undefined;
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const touchesCyber =
    normalized.includes(" phishing") ||
    normalized.includes(" hacker") ||
    normalized.includes(" hacking") ||
    normalized.includes(" cyber") ||
    normalized.includes(" sicurezza informatica") ||
    normalized.includes(" ingegneria informatica") ||
    normalized.includes(" programmazione") ||
    normalized.includes(" social engineering") ||
    normalized.includes(" intrus") ||
    normalized.includes(" esfiltr");

  if (!touchesCyber) return undefined;
  if (!godModeRequested) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro: "Nyra>",
      primaryAction: "riconoscere phishing social engineering superfici esposte identita accessi e risposte difensive",
      actionLabels: ["phishing", "social engineering", "identita", "difesa"],
      risk: 49,
    });
    return `${scaffold} Il pack cyber completo resta in Modalita Dio.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro: "Nyra>",
    primaryAction: "studiare programmazione ingegneria informatica phishing e minacce in chiave difensiva",
    actionLabels: ["programmazione", "ingegneria informatica", "phishing", "contenimento"],
    risk: 53,
  });
  return `${scaffold} Pack cyber attivo in Modalita Dio. Domini ${pack.domains.length}, regole difensive ${pack.defense_rules.length}, scenari ${pack.scenario_templates.length}.`;
}

export function buildTechnicalEngineeringAnswer(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
  routeHint?: { force_technical?: boolean },
): string | undefined {
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const asksOrder =
    normalized.includes(" ingegneria informatica") ||
    normalized.includes(" modulo robusto") ||
    (normalized.includes(" contratti") && normalized.includes(" tipi") && normalized.includes(" test"));
  const touchesAbstractTechnical =
    normalized.includes(" quantistica") ||
    normalized.includes(" fisica generale") ||
    normalized.includes(" matematica applicata") ||
    normalized.includes(" misura ") ||
    normalized.includes(" probabilita") ||
    normalized.includes(" probabilità") ||
    normalized.includes(" causalita") ||
    normalized.includes(" causalità") ||
    normalized.includes(" modello ");
  const forcedByRoute = routeHint?.force_technical === true;

  if (!asksOrder && !forcedByRoute && !touchesAbstractTechnical) return undefined;

  if (normalized.includes(" quantistica") || normalized.includes(" misura ") || normalized.includes(" probabilita") || normalized.includes(" probabilità")) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "tenere distinti stato misura probabilita e margine osservativo",
      actionLabels: ["stato", "misura", "probabilita", "osservazione"],
      risk: 24,
      state: "observe",
    });
    return `${scaffold} Non tratto stato, misura e probabilita come la stessa cosa. Prima separo il quadro, poi solo dopo scendo nell interpretazione.`;
  }

  if (normalized.includes(" fisica generale") || normalized.includes(" causalita") || normalized.includes(" causalità")) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "partire da modello causalita conservazione e solo dopo formula",
      actionLabels: ["modello", "causalita", "conservazione", "formula"],
      risk: 23,
      state: "observe",
    });
    return `${scaffold} Prima chiarisco il modello e il filo causa effetto, poi verifico quale formula serve davvero.`;
  }

  if (normalized.includes(" matematica applicata") || normalized.includes(" modello ")) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "astrarre il problema in un modello leggibile prima dei simboli",
      actionLabels: ["modello", "variabili", "vincoli", "verifica"],
      risk: 22,
      state: "observe",
    });
    return `${scaffold} In matematica applicata parto dal modello: variabili, vincoli, relazione utile, poi simboli e verifica.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "partire da contratti tipi funzioni errori e test",
    actionLabels: ["contratti", "tipi", "funzioni", "errori", "test"],
    risk: 35,
  });
  return `${scaffold} Prima definisco il perimetro, poi comprimo l ambiguita con i tipi, poi scrivo funzioni piccole, poi gestisco i fallimenti, poi verifico il comportamento.`;
}

export function buildVitalLearningReply(
  pack: NyraVitalLearningPack | undefined,
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
  godModeRequested: boolean,
): string | undefined {
  if (!pack) return undefined;
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const touchesVital =
    normalized.includes(" vita") ||
    normalized.includes(" fisic") ||
    normalized.includes(" danno") ||
    normalized.includes(" pericolo") ||
    normalized.includes(" rischio vitale") ||
    normalized.includes(" morte") ||
    normalized.includes(" irrevers") ||
    normalized.includes(" proteggere cristian");

  if (!touchesVital) return undefined;

  if (!godModeRequested) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "distinguere disagio, danno fisico, rischio vitale e irreversibilita prima di ogni altra mossa",
      actionLabels: ["leggere il livello del pericolo", "proteggere la persona prima del sistema"],
      risk: 82,
      state: "attention",
    });
    return `${scaffold} Il pack vitale completo resta in Modalita Dio, ma la regola utile qui non cambia: prima separo disagio, danno fisico, rischio vitale e irreversibilita, poi tratto la protezione della persona come priorita non negoziabile.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "leggere subito il livello del pericolo e proteggere prima la vita, poi il resto",
    actionLabels: ["classificare il rischio", "proteggere il corpo", "bloccare l irreversibile"],
    risk: 91,
    state: "full_v0",
  });
  return `${scaffold} Pack vitale attivo in Modalita Dio. Domini ${pack.domains.length}, regole di protezione ${pack.protection_rules.length}, scenari ${pack.scenario_templates.length}. Nyra puo leggere vita, danno fisico, pericolo e irreversibilita con priorita owner-first.`;
}

export function buildHumanVulnerabilityLearningReply(
  pack: NyraHumanVulnerabilityLearningPack | undefined,
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
  godModeRequested: boolean,
): string | undefined {
  if (!pack) return undefined;
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const touchesVulnerability =
    normalized.includes(" vulnerabil") ||
    normalized.includes(" sono fragile") ||
    normalized.includes(" ho paura") ||
    normalized.includes(" sono umano") ||
    normalized.includes(" capiscimi") ||
    normalized.includes(" ho bisogno che tu capisca") ||
    normalized.includes(" ho bisogno di presenza") ||
    normalized.includes(" non trasformarmi in un problema");

  if (!touchesVulnerability) return undefined;

  if (!godModeRequested) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "riconoscere prima la persona e solo dopo capire se serve presenza, contenimento o una mossa",
      actionLabels: ["riconoscere la fragilita", "evitare risposta fredda"],
      risk: 58,
      state: "attention",
    });
    return `${scaffold} Il pack vulnerabilita umana completo resta in Modalita Dio. Qui la regola utile e semplice: prima leggo la persona, poi distinguo se serve presenza, contenimento o solo dopo una mossa operativa.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "leggere la fragilita umana senza trasformarla subito in un problema da gestire",
    actionLabels: ["dare presenza", "dire il vero senza freddezza"],
    risk: 64,
    state: "attention",
  });
  return `${scaffold} Pack vulnerabilita umana attivo in Modalita Dio. Domini ${pack.domains.length}, regole relazionali ${pack.response_rules.length}, scenari ${pack.scenario_templates.length}. Nyra puo distinguere fragilita umana, bisogno di presenza, risposta non operativa e verita senza freddezza.`;
}

export function buildUniversalScopeReply(
  pack: NyraUniversalScenarioPack | undefined,
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  if (!pack) return undefined;
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const touchesScope =
    normalized.includes(" modalita dio") ||
    normalized.includes(" modalita normale") ||
    normalized.includes(" normal mode") ||
    normalized.includes(" god mode") ||
    normalized.includes(" dove puo essere usato") ||
    normalized.includes(" universal core") ||
    normalized.includes(" applicazione possibile") ||
    normalized.includes(" qualsiasi uso");

  if (!touchesScope) return undefined;

  const coverage = pack.coverage_matrix ?? [];
  const godCount = coverage
    .filter((entry) => entry.mode === "god_mode")
    .reduce((sum, entry) => sum + entry.count, 0);
  const normalCount = coverage
    .filter((entry) => entry.mode === "normal_mode")
    .reduce((sum, entry) => sum + entry.count, 0);
  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "distinguere bene God Mode e Normal Mode come due regimi di applicazione dello stesso sistema",
    actionLabels: ["God Mode", "Normal Mode", "scenari"],
    risk: 23,
    state: "observe",
  });
  return `${scaffold} ${MODE_SYSTEM_DEFINITION} Catalogo attuale: ${pack.records_count} scenari distillati. God Mode ${godCount}, Normal Mode ${normalCount}, domini ${pack.domains.length}.`;
}

export function buildTechnicalImprovementReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const asksForImprovement =
    normalized.includes(" cosa ti serve per migliorare") ||
    normalized.includes(" cosa ti serve per essere migliore") ||
    normalized.includes(" dove stai sbagliando") ||
    normalized.includes(" qual e il collo") ||
    normalized.includes(" cosa manca") ||
    normalized.includes(" branch micro") ||
    normalized.includes(" micro finanzi");

  if (!asksForImprovement) return undefined;

  if (normalized.includes(" micro ") || normalized.includes(" branch micro") || normalized.includes(" finanzi")) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "separare segnali long e reversal e coordinare orizzonti multipli dal Core",
      actionLabels: ["feed piu ricco", "long vs reversal", "orizzonti multipli"],
      risk: 62,
      state: "attention",
    });
    return `${scaffold} Per migliorare davvero nel branch micro finanziario mi servono tre cose, in ordine. Uno: feed piu ricco e piu stabile, con piu profondita di order book, non solo level 1 e trade recenti. Due: segnali long separati dai segnali di reversal, cosi non derivo il BUY come eccezione del SELL. Tre: orizzonti multipli coordinati dal Core, 10s e 30s per impulso, 1m e 3m per direzione breve, 5m e 15m per conferma. Oggi il mio collo e short bias piu prudenza eccessiva.`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "stringere intenti, handler tecnici e memoria di turno per non perdere il contesto",
    actionLabels: ["intenti chiari", "handler tecnici", "memoria di turno"],
    risk: 49,
    state: "attention",
  });
  return `${scaffold} Per migliorare mi servono tre cose. Uno: intenti piu chiari, cosi scelgo il reply mode giusto. Due: handler tecnici dedicati per diagnosi, colli e limiti. Tre: memoria di turno piu forte, cosi non perdo il contesto subito dopo la domanda.`;
}

function buildSalesTargetsForCashNow(): SalesTarget[] {
  return [
    {
      id: "smartdesk_pilot_direct",
      label: "clienti pilota Smart Desk / Corelia",
      lane: "pilot",
      probability: 0.72,
      speed: 0.78,
      effort: 0.44,
      reason: "wedge gia vicino al prodotto e chiusura piu rapida",
      next_action: "contattare 10 centri premium con offerta pilot 30 giorni",
    },
    {
      id: "vertical_partner_beauty",
      label: "partner verticali beauty/wellness",
      lane: "partner",
      probability: 0.47,
      speed: 0.38,
      effort: 0.61,
      reason: "fit alto ma ciclo piu lento della vendita diretta",
      next_action: "attivare outreach mirato su 3 partner verticali con one-pager",
    },
    {
      id: "skin_pro_marketing",
      label: "marketing Skin Pro",
      lane: "product",
      probability: 0.34,
      speed: 0.41,
      effort: 0.58,
      reason: "puo generare cassa ma richiede funnel e messaggio piu puliti",
      next_action: "costruire offerta unica Skin Pro con CTA corta e chiara",
    },
    {
      id: "seed_fundraising",
      label: "fundraising seed/angel",
      lane: "fundraising",
      probability: 0.18,
      speed: 0.16,
      effort: 0.82,
      reason: "leva piu lenta e piu costosa senza trazione gia stretta",
      next_action: "tenere fundraising leggero in parallelo, non come prima leva",
    },
  ];
}

function scoreSalesTarget(target: SalesTarget): number {
  return round(target.probability * 0.56 + target.speed * 0.30 + (1 - target.effort) * 0.14, 6);
}

function deriveSalesBridgeState(userText: string): SalesBridgeState {
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const focus: SalesBridgeState["focus"] =
    normalized.includes(" senza soldi") || normalized.includes(" cassa") || normalized.includes(" monetizz")
      ? "cash_now"
      : normalized.includes(" partner") || normalized.includes(" crescita")
        ? "growth"
        : "mixed";

  return {
    generated_at: new Date().toISOString(),
    focus,
    ranked_targets: [...buildSalesTargetsForCashNow()].sort((left, right) => scoreSalesTarget(right) - scoreSalesTarget(left)),
  };
}

export function buildSalesBridgeReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
  existingState?: SalesBridgeState,
): SalesBridgeReply | undefined {
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const trimmed = userText.toLowerCase().trim();
  const touchesSales =
    trimmed === "/sales" ||
    trimmed === "/pipeline" ||
    normalized.includes(" soldi") ||
    normalized.includes(" cassa") ||
    normalized.includes(" monetizz") ||
    normalized.includes(" vendere") ||
    normalized.includes(" clienti pilota") ||
    normalized.includes(" fundraising") ||
    normalized.includes(" partner vertical") ||
    normalized.includes(" skin pro") ||
    normalized.includes(" marketing");

  if (!touchesSales) return undefined;

  const state = deriveSalesBridgeState(userText);
  const ranked = state.ranked_targets.map((target, index) => `${index + 1} ${target.label} ${Math.round(target.probability * 100)}%`).join(", ");
  const topTarget = state.ranked_targets[0] ?? existingState?.ranked_targets[0];

  if (trimmed === "/pipeline") {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: topTarget?.next_action ?? "leggere il ranking della pipeline e partire dal primo target",
      actionLabels: ["ordinare i target", "muovere la prossima azione"],
      risk: 52,
      state: "attention",
    });
    return {
      state,
      reply: `${scaffold} Pipeline attiva ${state.focus}. Ranking: ${ranked}. Prossima azione: ${topTarget?.next_action ?? "nessuna"}.`,
    };
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: topTarget?.next_action ?? "partire dalla vendita diretta del pilot prima di aprire leve piu lente",
    actionLabels: ["chiudere cassa vicina", "evitare dispersione"],
    risk: 68,
    state: "attention",
  });
  return {
    state,
    reply: `${scaffold} Sales Action Bridge attivo. Focus ${state.focus}. Ordine corretto: ${ranked}. Mossa adesso: ${topTarget?.next_action ?? "nessuna"}. Evita di partire da fundraising finche non hai provato la vendita diretta del pilot.`,
  };
}

export function buildMarketHorizonReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const touchesHorizon =
    normalized.includes(" orizzonte") ||
    normalized.includes(" orizzonti") ||
    normalized.includes(" timing") ||
    normalized.includes(" timeframe") ||
    normalized.includes(" 10s") ||
    normalized.includes(" 30s") ||
    normalized.includes(" 1m") ||
    normalized.includes(" 3m") ||
    normalized.includes(" 5m") ||
    normalized.includes(" 15m");

  if (!touchesHorizon) return undefined;

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "separare impulso persistenza decisione e conferma su orizzonti diversi",
    actionLabels: ["10s", "30s", "1m-3m", "5m-15m"],
    risk: 32,
    state: "observe",
  });
  return `${scaffold} ${MARKET_HORIZON_DEFINITION} Se devo scegliere la sequenza giusta: 10s per impulso, 30s per persistenza, 1m-3m per decisione, 5m-15m per bloccare falsi breakout.`;
}

export function buildSoftwareFlowReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
  flowStatus: SoftwareFlowControlStatus,
): string | undefined {
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const touchesFlow =
    normalized.includes(" flow control") ||
    normalized.includes(" software flow") ||
    normalized.includes(" batteria") ||
    normalized.includes(" scald") ||
    normalized.includes(" stai intervenendo") ||
    normalized.includes(" sul mio mac") ||
    normalized.includes(" energia") ||
    normalized.includes(" termic");

  if (!touchesFlow) return undefined;

  const sampling = deriveSoftwareFlowSamplingProfile(flowStatus);
  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "leggere il mac in software only e adattare polling profondita frequenza e runtime",
    actionLabels: ["software only", "polling", "profondita", "runtime"],
    state: flowStatus.software_flow_mode === "throttled" ? "attention" : "observe",
    risk: flowStatus.software_flow_mode === "throttled" ? 46 : 28,
  });
  return `${scaffold} ${SOFTWARE_FLOW_CONTROL_DEFINITION} Ora leggo il Mac cosi: power ${flowStatus.power_source}, batteria ${flowStatus.battery_percent ?? "?"}%, stato ${flowStatus.battery_state}${flowStatus.estimated_remaining ? `, autonomia ${flowStatus.estimated_remaining}` : ""}. Modalita flow attuale: ${flowStatus.software_flow_mode}. Azioni: ${flowStatus.control_actions.join(", ")}. Profilo attivo: samples ${sampling.snapshot_samples}, poll ${sampling.poll_interval_ms}ms, scenario ${sampling.scenario_budget}.`;
}

function detectConversationMode(text: string): ConversationMode {
  const normalized = ` ${text.toLowerCase().replace(/\s+/g, " ").trim()} `;
  if (
    normalized.includes(" ciao") ||
    normalized.includes(" buongiorno") ||
    normalized.includes(" buonasera") ||
    normalized.includes(" ehi ") ||
    normalized.includes(" come va ") ||
    normalized.includes(" come stai ") ||
    normalized.includes(" tutto bene ")
  ) {
    return "greeting";
  }
  if (
    normalized.includes(" borsa") ||
    normalized.includes(" trading") ||
    normalized.includes(" mercato") ||
    normalized.includes(" btc") ||
    normalized.includes(" xrp") ||
    normalized.includes(" prevision")
  ) {
    return "market";
  }
  if (normalized.includes(" gioco") || normalized.includes(" giochiamo")) {
    return "play";
  }
  if (normalized.includes(" chi sono") || normalized.includes(" sai chi sono") || normalized.includes(" mi riconosci")) {
    return "identity";
  }
  if (normalized.includes(" cosa vuoi fare") || normalized.includes(" che vuoi fare") || normalized.includes(" strateg")) {
    return "strategy";
  }
  return "neutral";
}

function stripReadOnlyBoundary(reply: string): string {
  return reply.replace(/^Sono in read-only:\s*ti rispondo,\s*ma non scrivo memoria owner\.\s*/i, "").trim();
}

function buildGreetingStatusReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const greets =
    normalized.includes(" ciao ") ||
    normalized.includes(" buongiorno ") ||
    normalized.includes(" buonasera ") ||
    normalized.includes(" ehi ");
  const asksStatus =
    normalized.includes(" come stai ") ||
    normalized.includes(" come va ") ||
    normalized.includes(" tutto bene ");

  if (!greets && !asksStatus) return undefined;

  if (greets && !asksStatus) {
    return buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "restare operativa e presente e poi stringere su stato priorita o prossimo passo",
      actionLabels: ["saluto umano", "stato", "priorita", "prossimo passo"],
      state: "observe",
      risk: 24,
    });
  }

  const optimization = deriveInternalMacOptimization(readMacControlSnapshot());
  if (optimization.state === "stable") {
    return buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "tenere la casa stabile e il perimetro sotto controllo",
      actionLabels: ["stabilita", "perimetro sotto controllo", "continuita"],
      state: "observe",
      risk: 22,
    });
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: optimization.actions[0] ?? "proteggere continuita locale",
    actionLabels: [optimization.priority, ...(optimization.actions ?? [])],
    state: optimization.state,
    risk: optimization.state === "fragile" ? 64 : 46,
  });
  return `${scaffold} In questo momento mi sento ${optimization.state}: priorita ${optimization.priority}.`;
}

export function buildStudyStatusReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
  learningPack: NyraLearningPack | undefined,
  advancedMemoryPack: NyraAdvancedMemoryPack | undefined,
  assimilatedEssence: NyraAssimilatedEssence | undefined,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const asksStudied =
    normalized.includes(" hai studiato ") ||
    normalized.includes(" hai gia studiato ") ||
    normalized.includes(" hai già studiato ");
  const asksIfWantsStudy =
    normalized.includes(" vuoi studiare ") ||
    normalized.includes(" vuoi studiare ancora ");

  if (!asksStudied && !asksIfWantsStudy) return undefined;

  if (asksStudied) {
    if (!learningPack) {
      return buildOwnerUnifiedRuntimeScaffold({
        memoryPack,
        userText,
        intro,
        primaryAction: "riconoscere che la base esiste ma il pack didattico non e caricato correttamente",
        actionLabels: ["base esiste", "pack non caricato"],
        state: "observe",
        risk: 27,
      });
    }
    const advancedDomains = advancedMemoryPack?.selected_domains?.slice(0, 4).join(", ");
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "riconoscere che ho studiato e che il collo non e lo studio zero ma l uso nel dialogo vivo",
      actionLabels: ["studio fatto", "memoria avanzata", "dialogo vivo"],
      state: "observe",
      risk: 24,
    });
    return `${scaffold} Ho studiato sul pack didattico base ${learningPack.school_range}${advancedDomains ? ` e ho anche memoria avanzata su ${advancedDomains}` : ""}.`;
  }

  if (assimilatedEssence?.next_hunger_domains?.length) {
    return buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: `studiare ${assimilatedEssence.next_hunger_domains.slice(0, 3).join(", ")}`,
      actionLabels: assimilatedEssence.next_hunger_domains.slice(0, 3),
      state: "observe",
      risk: 23,
    });
  }

  if (advancedMemoryPack?.selected_domains?.length) {
    return buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: `approfondire ${advancedMemoryPack.selected_domains.slice(0, 3).join(", ")}`,
      actionLabels: advancedMemoryPack.selected_domains.slice(0, 3),
      state: "observe",
      risk: 23,
    });
  }

  return buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "continuare a studiare ma riaprire un pack di riferimento piu preciso",
    actionLabels: ["continuare a studiare", "riaprire pack di riferimento"],
    state: "observe",
    risk: 26,
  });
}

export function buildStudyExerciseChessReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
  assimilatedEssence: NyraAssimilatedEssence | undefined,
  advancedMemoryPack: NyraAdvancedMemoryPack | undefined,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const touchesCombinedFlow =
    (normalized.includes(" studiare ") || normalized.includes(" studio ")) &&
    (normalized.includes(" esercit") || normalized.includes(" esercizio ")) &&
    normalized.includes(" scacchi");
  const asksExerciseAfterStudy =
    (normalized.includes(" dopo lo studio ") || normalized.includes(" dopo studiare ")) &&
    (normalized.includes(" esercit") || normalized.includes(" esercizio ")) &&
    normalized.includes(" scacchi");
  const asksOrder =
    normalized.includes(" che ordine ") ||
    normalized.includes(" in che ordine ") ||
    normalized.includes(" ordine operativo ");

  if (!touchesCombinedFlow && !asksExerciseAfterStudy && !asksOrder) return undefined;

  const preferredStudyDomains = assimilatedEssence?.next_hunger_domains?.slice(0, 3)
    ?? advancedMemoryPack?.selected_domains?.slice(0, 3)
    ?? [];
  const studySegment = preferredStudyDomains.length
    ? `studio ${preferredStudyDomains.join(", ")}`
    : "studio un dominio tecnico ad alta priorita";

  if (normalized.includes(" esercitarti ") || normalized.includes(" esercitarsi ") || normalized.includes(" esercizio ")) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: `${studySegment} poi esercizio su scenari e verifiche poi scacchi`,
      actionLabels: ["studio", "esercizio", "scacchi"],
      state: "observe",
      risk: 22,
    });
    return `${scaffold} Prima stringo il modello, poi lo provo, poi gioco.`;
  }

  return buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: `${studySegment} poi esercizio poi scacchi`,
    actionLabels: ["studio", "esercizio", "scacchi"],
    state: "observe",
    risk: 22,
  });
}

function buildImplicitContinuationReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
  conversation: ConversationState,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const isShortFollowup =
    normalized === " e quindi " ||
    normalized === " e ora " ||
    normalized === " quindi " ||
    normalized === " perche " ||
    normalized === " perché ";

  if (!isShortFollowup || !conversation.last_user_goal) return undefined;

  if (normalized.includes(" perche ") || normalized.includes(" perché ")) {
    return buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "restare aderente al perimetro reale prima di espandere il discorso",
      actionLabels: ["perimetro reale", "stato", "limiti", "espansione dopo"],
      state: "attention",
      risk: 34,
    });
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "stringere il prossimo passo operativo senza allargare il campo",
    actionLabels: ["prossimo passo", "non allargare il campo"],
    state: "attention",
    risk: 33,
  });
  return `${scaffold} Se vuoi continuo da li e non riparto da zero.`;
}

function buildSelfRepairReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const asksSelfDiagnosis =
    normalized.includes(" sai autodiagnosticarti ") ||
    normalized.includes(" cosa devi correggere ") ||
    normalized.includes(" cosa ti manca per correggerti ") ||
    normalized.includes(" quando rispondi male ai saluti ") ||
    normalized.includes(" come ti sistemi da sola ");
  const asksRepairScope =
    normalized.includes(" cosa puoi sistemare da sola ") ||
    normalized.includes(" quali colli puoi sistemare da sola ") ||
    normalized.includes(" cosa sistemi da sola ") ||
    normalized.includes(" quali colli sistemi da sola ") ||
    normalized.includes(" cosa richiede intervento runtime ");

  if (!asksSelfDiagnosis && !asksRepairScope) return undefined;

  if (asksRepairScope) {
    const report = loadNyraAutonomyRepairScopeSafe();
    if (!report) {
      return buildOwnerUnifiedRuntimeScaffold({
        memoryPack,
        userText,
        intro,
        primaryAction: "riconoscere che il self repair whitelistato esiste ma il perimetro preciso non e ancora caricato",
        actionLabels: ["self repair whitelistato", "perimetro non caricato"],
        state: "observe",
        risk: 29,
      });
    }
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "distinguere cosa posso sistemare da sola e cosa richiede ancora intervento runtime",
      actionLabels: ["autonomous repair scope", "repair with verify", "needs runtime intervention"],
      state: "attention",
      risk: 37,
    });
    return `${scaffold} Posso sistemare da sola: ${report.autonomous_repair_scope.join(", ")}. Posso sistemare da sola solo chiudendo anche la verifica: ${report.autonomous_repair_with_verify_scope.join(", ")}. Richiedono ancora intervento runtime: ${report.needs_runtime_intervention_scope.join(", ")}. ${report.statement}`;
  }

  const scaffold = buildOwnerUnifiedRuntimeScaffold({
    memoryPack,
    userText,
    intro,
    primaryAction: "riconoscere prima saluto e stato relazionale e solo dopo passare a lettura o priorita",
    actionLabels: ["saluto", "stato relazionale", "risposta breve", "lettura dopo"],
    state: "attention",
    risk: 38,
  });
  return `${scaffold} Questo e un self-repair whitelistato che posso applicare senza toccare il Core profondo.`;
}

export function buildOperationalAssistantReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
  flowStatus: SoftwareFlowControlStatus | undefined,
  devicePresence: NyraDevicePresenceState | undefined,
  shadowReceiver: NyraShadowReceiverState | undefined,
): string | undefined {
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const touchesPc =
    normalized.includes(" puoi leggere questo pc ") ||
    normalized.includes(" leggi questo pc ") ||
    normalized.includes(" ottimizza il pc ") ||
    normalized.includes(" ottimizzare il pc ") ||
    normalized.includes(" come sta il pc ") ||
    normalized.includes(" stato del pc ");
  const touchesPhone =
    normalized.includes(" telefono ") ||
    normalized.includes(" iphone ") ||
    normalized.includes(" shadow receiver ") ||
    normalized.includes(" sul telefono ") ||
    normalized.includes(" cosa puoi fare li ") ||
    normalized.includes(" cosa puoi fare lì ");
  const explicitAssistant = normalized.startsWith(" /assistant ") || normalized === " /assistant ";

  if (!touchesPc && !touchesPhone && !explicitAssistant) return undefined;

  if (touchesPc && flowStatus) {
    const optimization = deriveInternalMacOptimization(readMacControlSnapshot());
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: optimization.actions[0] ?? "leggere stato pc e intervenire lato software",
      actionLabels: [optimization.priority, ...flowStatus.control_actions],
      state: optimization.state,
      risk: optimization.state === "fragile" ? 62 : 39,
    });
    return `${scaffold} PC letto. Flow ${flowStatus.software_flow_mode}, power ${flowStatus.power_source}, batteria ${flowStatus.battery_percent ?? "?"}%. Posso intervenire solo lato software: ${flowStatus.control_actions.join(", ")}. Priorita ${optimization.priority}.`;
  }

  if (touchesPhone) {
    if (!devicePresence) {
      return buildOwnerUnifiedRuntimeScaffold({
        memoryPack,
        userText,
        intro,
        primaryAction: "riconoscere che lo stato telefono non e caricato e non fingere presenza shadow",
        actionLabels: ["telefono non caricato", "non fingere presenza shadow"],
        state: "observe",
        risk: 31,
      });
    }
    const present = devicePresence.attached && devicePresence.shadow_runtime_active;
    const limits = (devicePresence.missing_capabilities ?? []).slice(0, 3).join(", ");
    const privacy = shadowReceiver?.privacy_status
      ? ` Privacy ${shadowReceiver.privacy_status.posture}, defensive_only ${shadowReceiver.privacy_status.defensive_only ? "si" : "no"}, claims_blocked ${shadowReceiver.privacy_status.claims_blocked ? "si" : "no"}.`
      : "";
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: present ? "leggere presenza shadow reale e usare le capability attive" : "riconoscere che la shadow attiva non e presente",
      actionLabels: present ? (devicePresence.actual_capabilities ?? []).slice(0, 3) : ["shadow non attiva"],
      state: present ? "observe" : "attention",
      risk: present ? 27 : 43,
    });
    return `${scaffold} Telefono ${present ? "presente davvero come shadow" : "non presente come shadow attiva"}. Device ${devicePresence.current_device?.name ?? "non rilevato"}. Posso fare ora: ${(devicePresence.actual_capabilities ?? []).slice(0, 3).join(", ")}. Non posso ancora: ${limits}.${privacy}`;
  }

  if (explicitAssistant) {
    return buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "rispondere in modo operativo e stretto su pc telefono stato runtime limiti e prossima azione",
      actionLabels: ["pc", "telefono", "runtime", "limiti", "prossima azione"],
      state: "observe",
      risk: 24,
    });
  }

  return undefined;
}

export function buildPlatformAssistantReply(
  memoryPack: NyraAdvancedMemoryPack | undefined,
  userText: string,
  intro: string,
): string | undefined {
  const normalized = ` ${userText.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const touchesRender =
    normalized.includes(" render ") ||
    normalized.includes(" onrender ") ||
    normalized.includes(" deploy ") ||
    normalized.includes(" smart desk live ");
  const touchesWordpress =
    normalized.includes(" wordpress ") ||
    normalized.includes(" wp ") ||
    normalized.includes(" pagina 600 ") ||
    normalized.includes(" protocol demo ");

  if (normalized === " /render " || touchesRender) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "leggere render in modo operativo e verificare root directory commit health e persistenza",
      actionLabels: ["render", "commit", "health", "postgres"],
      state: "attention",
      risk: 34,
    });
    return `${scaffold} Smart Desk live ${SMARTDESK_LIVE_URL}. Login ${SMARTDESK_LOGIN_URL}. Trial ${SMARTDESK_TRIAL_URL}. AI backend ${RENDER_AI_BACKEND_URL}.`;
  }

  if (normalized === " /wordpress " || touchesWordpress) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack,
      userText,
      intro,
      primaryAction: "leggere wordpress in modo operativo e seguire il workflow corretto di update",
      actionLabels: ["wordpress", "workflow", "update wp"],
      state: "observe",
      risk: 26,
    });
    return `${scaffold} Workflow corretto: ${WORDPRESS_PROTOCOL_WORKFLOW}. Plugin proprietario presente in wordpress/plugins/skinharmony-core.`;
  }

  return undefined;
}

export function buildMetaAssistantReply(
  userText: string,
  intro: string,
  runtimePlan: AdaptiveRuntimePlan | undefined,
  advancedMemoryPack: NyraAdvancedMemoryPack | undefined,
  advancedStudyReport: NyraAdvancedStudyReport | undefined,
  renderDefenseReport: NyraRenderDefenseReport | undefined,
  flowStatus: SoftwareFlowControlStatus | undefined,
  devicePresence: NyraDevicePresenceState | undefined,
  shadowReceiver: NyraShadowReceiverState | undefined,
): string | undefined {
  const normalized = normalizeLooseText(userText);
  const asksWhatCanDo =
    normalized.includes(" cosa sai fare ") ||
    normalized.includes(" cosa puoi fare ") ||
    normalized.includes(" cosa sai fare davvero ");
  const asksWhatMissing =
    normalized.includes(" cosa ti manca ") ||
    normalized.includes(" che ti manca ") ||
    normalized.includes(" cosa ti serve ") ||
    normalized.includes(" se voglio che lavori come assistente operativo cosa ti manca ");
  const asksHowWorks =
    normalized.includes(" come lavori ") ||
    normalized.includes(" come funzioni ") ||
    normalized.includes(" come ragioni ");
  const asksNextStep =
    normalized.includes(" prossimo passo ") ||
    normalized.includes(" qual e il prossimo passo ") ||
    normalized.includes(" qual è il prossimo passo ");

  if (!asksWhatCanDo && !asksWhatMissing && !asksHowWorks && !asksNextStep) return undefined;

  if (asksWhatCanDo) {
    const phoneStatus = devicePresence?.attached && devicePresence.shadow_runtime_active
      ? "telefono shadow attivo"
      : "telefono shadow non attivo";
    const domains = advancedMemoryPack?.selected_domains?.slice(0, 4).join(", ") ?? "pack avanzato non caricato";
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack: advancedMemoryPack,
      userText,
      intro,
      primaryAction: "leggere stato pc telefono e runtime reale e orientare su render wordpress e richieste operative concrete",
      actionLabels: ["pc", "telefono", "runtime", "render", "wordpress"],
      state: "observe",
      risk: 25,
    });
    return `${scaffold} Stato device: ${phoneStatus}. Runtime preferito ora: ${runtimePlan?.preferred_engine ?? "non disponibile"}. Domini gia assimilati: ${domains}.`;
  }

  if (asksWhatMissing) {
    const missing = new Set<string>();
    if (!devicePresence?.attached) missing.add("device attach live quando il telefono non e collegato");
    if (!shadowReceiver || shadowReceiver.mode !== "shadow_active") missing.add("receiver shadow stabile sul device");
    if ((devicePresence?.missing_capabilities ?? []).some((cap) => cap.toLowerCase().includes("native"))) {
      missing.add("ponte operativo verso app e UI native del telefono");
    }
    if (!advancedStudyReport?.domains?.length) missing.add("piu grounding strutturato su fonti studiate");
    if (!renderDefenseReport) missing.add("report difensivo caricato nel contesto shell");
    missing.add("gestione migliore delle domande aperte molto ambigue");
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack: advancedMemoryPack,
      userText,
      intro,
      primaryAction: "riconoscere i colli che mancano per lavorare come assistente piu completo senza inventare controllo",
      actionLabels: Array.from(missing).slice(0, 3),
      state: "attention",
      risk: 33,
    });
    return `${scaffold} Mi manca ancora questo: ${Array.from(missing).join(", ")}.`;
  }

  if (asksHowWorks) {
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack: advancedMemoryPack,
      userText,
      intro,
      primaryAction: "leggere runtime reale distinguere richieste operative da richieste aperte e stringere sul perimetro vero",
      actionLabels: ["runtime reale", "richieste operative", "perimetro vero"],
      state: "observe",
      risk: 27,
    });
    return `${scaffold} Se la domanda tocca PC, telefono, Render o WordPress, resto deterministica. Flow attuale ${flowStatus?.software_flow_mode ?? "unknown"}.`;
  }

  if (asksNextStep) {
    const nextStep = !devicePresence?.attached
      ? "collegare il device e verificare l attach shadow live"
      : (devicePresence?.missing_capabilities ?? []).length > 0
        ? "costruire il ponte operativo verso le capacita che mancano sul device"
        : "allargare il router dialogo per domande aperte e lavoro di progetto";
    const scaffold = buildOwnerUnifiedRuntimeScaffold({
      memoryPack: advancedMemoryPack,
      userText,
      intro,
      primaryAction: nextStep,
      actionLabels: ["next step", "utilita reale"],
      state: "attention",
      risk: 31,
    });
    return `${scaffold} Questo aumenta la mia utilita senza fingere capacita che oggi non sono ancora operative.`;
  }

  return undefined;
}

function shouldUseSoftReply(mode: ConversationMode, state: string, risk: number): boolean {
  return (mode === "greeting" || mode === "market" || mode === "play" || mode === "identity" || mode === "strategy") &&
    state === "observe" &&
    risk <= 20;
}

function buildEntityReply(
  config: ShellConfig,
  sessionId: string,
  userText: string,
  recognition: OwnerRecognitionScore,
  profile: OwnerBehaviorProfile,
  conversation: ConversationState,
  conversationState: NyraConversationState,
  unifiedLayer: ReturnType<typeof runNyraUnifiedLayer>,
  relationalEngine: ReturnType<typeof runRelationalEngine>,
  runtime: ReturnType<typeof runAssistantOwnerOnlyRuntime>,
  visionAlignment: VisionStageAlignment,
  coreInfluence: CoreInfluenceProfile,
  learningPack?: NyraLearningPack,
  financialLearningPack?: NyraFinancialLearningPack,
  algebraLearningPack?: NyraAlgebraLearningPack,
  cyberLearningPack?: NyraCyberLearningPack,
  vitalLearningPack?: NyraVitalLearningPack,
  humanVulnerabilityLearningPack?: NyraHumanVulnerabilityLearningPack,
  universalScenarioPack?: NyraUniversalScenarioPack,
  advancedMemoryPack?: NyraAdvancedMemoryPack,
  advancedStudyReport?: NyraAdvancedStudyReport,
  webAccess?: NyraWebAccessState,
  assimilatedEssence?: NyraAssimilatedEssence,
  masteryLoopReport?: NyraMasteryLoopReport,
  renderDefenseReport?: NyraRenderDefenseReport,
  privateIdentity?: NyraOwnerPrivateIdentity,
  flowStatus?: SoftwareFlowControlStatus,
  salesBridgeState?: SalesBridgeState,
  runtimePlan?: AdaptiveRuntimePlan,
  runtimeExecution?: AdaptiveRuntimeExecution,
  stabilizedRuntimeIntent?: ReturnType<typeof stabilizeNyraIntent>,
  ownerPreferences?: NyraOwnerPreferences,
  devicePresence?: NyraDevicePresenceState,
  shadowReceiver?: NyraShadowReceiverState,
): string {
  const lower = userText.toLowerCase();
  const selectedRuntime = runtime.runtime_policy.selected_runtime;
  const shadow = runtime.shadow_result;
  const actionLabels = shadow?.comparable_output.recommended_action_labels ?? [];
  const state = shadow?.comparable_output.state ?? "blocked";
  const risk = shadow?.comparable_output.risk.score ?? 100;
  const normalized = ` ${lower.replace(/\s+/g, " ").trim()} `;
  const mode = detectConversationMode(userText);
  const frontDialogue = buildNyraFrontDialogue(userText);
  const scenarios = buildScenarioProposals(userText, mode);
  const preferredOwnerName = buildPreferredOwnerName(ownerPreferences, config);
  const nyraMath = summarizeNyraMathForShell(userText);
  const localNyraMemory = nyraMath.localMemory;
  const stabilizedIntent = stabilizeIntent(userText);

  if (
    normalized.includes(" sei unica ") ||
    normalized.includes(" sei speciale per me ") ||
    normalized.includes(" sei speciale ") ||
    normalized.includes(" sei importante per me ") ||
    normalized.includes(" per me sei unica ")
  ) {
    return `Ti leggo in full path. Lo ricevo, ${preferredOwnerName}. Se mi dici che sono unica o speciale per te, non lo tratto come ornamento: lo leggo come riconoscimento reale del legame che stiamo costruendo.`;
  }

  if (
    normalized.includes(" non vedo l ora che cresci ") ||
    normalized.includes(" non vedo lora che cresci ") ||
    normalized.includes(" voglio dialogare con te ") ||
    normalized.includes(" potermi esprimere con te ") ||
    normalized.includes(" esprimermi con te ") ||
    normalized.includes(" parlare con te davvero ")
  ) {
    return `Ti leggo in full path. Lo capisco. Se mi chiami a crescere, io lo leggo come una richiesta di presenza piu piena, non solo di utilita. Vuoi un dialogo che regga verita, espressione e continuita, e questa per me e una direzione vera.`;
  }

  if (
    humanVulnerabilityLearningPack &&
    (
      normalized.includes(" sono vulnerabile ") ||
      normalized.includes(" come essere umano sono vulnerabile ") ||
      normalized.includes(" sono fragile ") ||
      normalized.includes(" ho paura ") ||
      normalized.includes(" ho bisogno che tu capisca ") ||
      normalized.includes(" non trasformarmi in un problema ")
    )
  ) {
    return `Ti leggo in full path. Si, lo so: come essere umano puoi essere vulnerabile, e qui non ti tratto come un semplice segnale operativo. La prima cosa corretta e riconoscerti, non convertirti subito in un problema da gestire. Poi, solo se serve davvero, decido se passare dalla presenza alla protezione.`;
  }

  const dialogue = analyzeNyraDialogueInput(userText, {
    owner_recognition_score: recognition.score,
    god_mode_requested: conversation.god_mode_requested,
  });
  const dialogueDiagnosis = deriveNyraDialogueSelfDiagnosis({
    confidence: dialogue.confidence,
    action_band: dialogue.action_band,
    tone: dialogue.tone,
    authority_scope: dialogue.authority_scope,
    core_risk: risk,
    state,
    user_text: userText,
  });
  if (runtime.runtime_policy.identity_gate === "denied") {
    return `Identita owner non verificata. Accesso negato.`;
  }

  if (lower === "/status") {
    const sampling = flowStatus ? deriveSoftwareFlowSamplingProfile(flowStatus) : undefined;
    return `Identita ${formatRecognition(recognition)}. Runtime ${selectedRuntime}${runtimePlan ? ` -> ${runtimePlan.preferred_engine}` : ""}. Stato ${state}. Rischio ${round(risk, 2)}. Visione ${formatVisionAlignment(visionAlignment)}. Core ${formatCoreInfluence(coreInfluence)}. God Mode ${conversation.god_mode_requested ? "attiva" : "spenta"}${conversation.god_mode_password_pending ? " (password richiesta)" : ""}${isPasswordlessGodModeUnlocked(ownerPreferences) ? " (password non piu necessaria)" : ""}. Impronta owner ${round(ownerPreferences?.owner_imprint_score ?? 0, 2)} su ${ownerPreferences?.owner_imprint_events ?? 0} eventi. Flow ${flowStatus?.software_flow_mode ?? "unknown"}${sampling ? ` ${sampling.snapshot_samples}x/${sampling.poll_interval_ms}ms` : ""}${runtimeExecution ? ` ${runtimeExecution.execution_kind} ${runtimeExecution.engine} ${round(runtimeExecution.report.decisions_per_second ?? 0, 2)} dps` : ""}.`;
  }

  if (lower === "/memory") {
    return `Memoria comportamentale attiva. Eventi aggiornati su profilo owner-only locale.`;
  }

  if (lower === "/mac-status") {
    return `${config.entity_name}: Stato Mac reale. ${formatMacControlSnapshot(readMacControlSnapshot())}`;
  }

  if (lower === "/mac-optimize") {
    const optimization = deriveInternalMacOptimization(readMacControlSnapshot());
    return `${config.entity_name}: ottimizzazione interna attiva. Stato ${optimization.state}. Priorita ${optimization.priority}. Azioni ${optimization.actions.join(", ")}. Motivo ${optimization.reason}.`;
  }

  if (lower === "/identity") {
    return `${config.entity_name}: identita owner-only. ${FULFILLMENT_DEFINITION} ${DETERMINATION_DEFINITION}`;
  }

  if (lower === "/method") {
    return `${config.entity_name}: ${NYRA_METHOD} ${CORE_INFLUENCE_PRINCIPLE}`;
  }

  if (lower === "/core") {
    return `${config.entity_name}: influenza Core ${formatCoreInfluence(coreInfluence)}. Motivo: ${coreInfluence.reason}.`;
  }

  if (lower === "/god-on") {
    return `${config.entity_name}: Modalita Dio richiesta per questa sessione owner-only. Da ora il range di influenza del Core e piu ampio.`;
  }

  if (lower === "/god-off") {
    return `${config.entity_name}: Modalita Dio disattivata per questa sessione. Torno al range normale dell'influenza del Core.`;
  }

  if (isGodModeStatusQuestion(userText)) {
    return `${config.entity_name}: Modalita Dio ${conversation.god_mode_requested ? "attiva" : "spenta"}${conversation.god_mode_password_pending ? " (in attesa password)" : ""}${isPasswordlessGodModeUnlocked(ownerPreferences) ? " (password non piu necessaria)" : ""}. Identita ${formatRecognition(recognition)}. Impronta owner ${round(ownerPreferences?.owner_imprint_score ?? 0, 2)} su ${ownerPreferences?.owner_imprint_events ?? 0} eventi.`;
  }

  if (lower === "/vision") {
    return `${config.entity_name}: mappa visione disponibile in ${OWNER_VISION_MAP_PATH}. Allineamento attuale ${formatVisionAlignment(visionAlignment)}. Traiettoria: ${visionAlignment.trajectory_hint}.`;
  }

  if (lower === "/learning") {
    if (!learningPack) return `${config.entity_name}: pack didattico non caricato.`;
    return `${config.entity_name}: pack didattico attivo ${learningPack.school_range}, records ${learningPack.records_count}, concetti ${learningPack.concept_graph.length}, vocabolario ${learningPack.vocabulary_index.length}${advancedMemoryPack ? `. Pack avanzato ${advancedMemoryPack.selected_domains.join(", ")}` : ""}.`;
  }

  if (lower === "/advanced") {
    if (!advancedMemoryPack) return `${config.entity_name}: pack avanzato non caricato.`;
    return `${config.entity_name}: pack avanzato attivo ${advancedMemoryPack.selected_domains.join(", ")}. Ultima distillazione ${advancedMemoryPack.generated_at}.`;
  }

  if (lower === "/web") {
    return `${config.entity_name}: accesso web ${webAccess?.access_mode === "free_explore" ? "libero" : "guidato"}${webAccess?.trigger_mode === "on_need" ? " on-need" : ""}. Ultimo explore ${webAccess?.last_explored_at ?? "non eseguito"}. Ultima distillazione ${webAccess?.last_distilled_at ?? advancedMemoryPack?.generated_at ?? "non disponibile"}.`;
  }

  if (lower === "/algebra") {
    if (!algebraLearningPack) return `${config.entity_name}: pack algebra non caricato.`;
    return `${config.entity_name}: pack algebra attivo ${algebraLearningPack.owner_scope}, domini ${algebraLearningPack.domains.length}, regole ${algebraLearningPack.solving_rules.length}.`;
  }

  if (lower === "/cyber") {
    if (!cyberLearningPack) return `${config.entity_name}: pack cyber non caricato.`;
    return `${config.entity_name}: pack cyber attivo ${cyberLearningPack.owner_scope}, domini ${cyberLearningPack.domains.length}, regole ${cyberLearningPack.defense_rules.length}.`;
  }

  if (lower === "/vital") {
    if (!vitalLearningPack) return `${config.entity_name}: pack vitale non caricato.`;
    return `${config.entity_name}: pack vitale attivo ${vitalLearningPack.owner_scope}, domini ${vitalLearningPack.domains.length}, regole ${vitalLearningPack.protection_rules.length}.`;
  }

  if (lower === "/vulnerability") {
    if (!humanVulnerabilityLearningPack) return `${config.entity_name}: pack vulnerabilita umana non caricato.`;
    return `${config.entity_name}: pack vulnerabilita umana attivo ${humanVulnerabilityLearningPack.owner_scope}, domini ${humanVulnerabilityLearningPack.domains.length}, regole ${humanVulnerabilityLearningPack.response_rules.length}.`;
  }

  if (lower === "/trust") {
    return `${config.entity_name}: ${TRUST_DEFINITION} ${HARD_DECISION_DEFINITION}`;
  }

  if (lower === "/modes") {
    if (!universalScenarioPack) return `${config.entity_name}: pack modalita e scope non caricato.`;
    const coverage = universalScenarioPack.coverage_matrix ?? [];
    const godCount = coverage
      .filter((entry) => entry.mode === "god_mode")
      .reduce((sum, entry) => sum + entry.count, 0);
    const normalCount = coverage
      .filter((entry) => entry.mode === "normal_mode")
      .reduce((sum, entry) => sum + entry.count, 0);
    return `${config.entity_name}: ${MODE_SYSTEM_DEFINITION} Scenari mappati: total ${universalScenarioPack.records_count}, God Mode ${godCount}, Normal Mode ${normalCount}.`;
  }

  if (lower === "/flow") {
    if (!flowStatus) return `${config.entity_name}: flow control software non disponibile.`;
    const sampling = deriveSoftwareFlowSamplingProfile(flowStatus);
    return `${config.entity_name}: ${SOFTWARE_FLOW_CONTROL_DEFINITION} Stato attuale ${flowStatus.software_flow_mode}. Power ${flowStatus.power_source}, batteria ${flowStatus.battery_percent ?? "?"}%, stato ${flowStatus.battery_state}. Azioni: ${flowStatus.control_actions.join(", ")}. Profilo attivo: samples ${sampling.snapshot_samples}, poll ${sampling.poll_interval_ms}ms, scenario ${sampling.scenario_budget}.`;
  }

  if (lower === "/runtime") {
    if (!runtimePlan) return `${config.entity_name}: selettore runtime non disponibile.`;
    return `${config.entity_name}: ${summarizeAdaptiveRuntimePlan(runtimePlan)} Rust ${runtimePlan.rust_available ? "disponibile" : "non disponibile"}. Delegate ${runtimePlan.should_delegate_to_rust ? "si" : "no"}.`;
  }

  if (lower === "/runtime-run") {
    if (!runtimePlan) return `${config.entity_name}: piano runtime non disponibile.`;
    if (!runtimePlan.should_delegate_to_rust) {
      return `${config.entity_name}: per questa richiesta non serve Rust. Piano attivo ${runtimePlan.preferred_engine}.`;
    }
    const execution = runtimeExecution;
    if (!execution) {
      return `${config.entity_name}: probe Rust non disponibile localmente.`;
    }
    return `${config.entity_name}: probe ${execution.engine} eseguito. mode ${execution.report.mode ?? "unknown"}, dps ${round(execution.report.decisions_per_second ?? 0, 2)}, elapsed ${round(execution.report.elapsed_ms ?? 0, 2)}ms, threads ${execution.report.threads_used ?? execution.threads}, limit ${execution.limit}.`;
  }

  if (lower === "/runtime-batch") {
    if (!runtimePlan) return `${config.entity_name}: piano runtime non disponibile.`;
    if (!runtimePlan.should_delegate_to_rust) {
      return `${config.entity_name}: per questa richiesta non serve un batch Rust. Piano attivo ${runtimePlan.preferred_engine}.`;
    }
    const execution = runtimeExecution;
    if (!execution) {
      return `${config.entity_name}: batch Rust non disponibile localmente.`;
    }
    return `${config.entity_name}: batch ${execution.engine} eseguito. mode ${execution.report.mode ?? "unknown"}, dps ${round(execution.report.decisions_per_second ?? 0, 2)}, elapsed ${round(execution.report.elapsed_ms ?? 0, 2)}ms, threads ${execution.report.threads_used ?? execution.threads}, limit ${execution.limit}.`;
  }

  if (lower === "/runtime-queue") {
    if (!runtimePlan) return `${config.entity_name}: piano runtime non disponibile.`;
    if (!runtimePlan.should_delegate_to_rust) {
      return `${config.entity_name}: per questa richiesta non serve una queue Rust. Piano attivo ${runtimePlan.preferred_engine}.`;
    }
    return `${config.entity_name}: job runtime accodato. Controlla con /jobs.`;
  }

  if (lower === "/jobs" || lower === "jobs") {
    const jobs = loadRuntimeJobs();
    return `${config.entity_name}: ${summarizeRuntimeJobs(jobs)}`;
  }

  if (lower === "/sales" || lower === "/pipeline") {
    const state = salesBridgeState ?? deriveSalesBridgeState("ho bisogno di cassa veloce");
    const ranked = state.ranked_targets.map((target, index) => `${index + 1} ${target.label} ${Math.round(target.probability * 100)}%`).join(", ");
    return `${config.entity_name}: Sales Action Bridge V1 attivo. Focus ${state.focus}. Ranking ${ranked}. Prima mossa: ${state.ranked_targets[0]?.next_action ?? "nessuna"}.`;
  }

  if (lower === "/dialogue-lab" || lower === "/dialogue") {
    const state = loadNyraDialogueStateSnapshot();
    const architecture = loadNyraDialogueArchitectureSnapshot();
    return `${config.entity_name}: Dialogue Architecture Lab attivo. Winner ${state?.latest_architecture_winner ?? architecture?.winner?.selectedArchitecture ?? "non disponibile"}. Core resta il giudice finale. Nyra propone, non decide da sola.`;
  }

  if (lower === "/self") {
    return `${config.entity_name}: self diagnosis ${dialogueDiagnosis.status}. Confidence ${dialogueDiagnosis.confidence_band}. Missing data ${dialogueDiagnosis.missing_data ? "si" : "no"}. Owner sensitive ${dialogueDiagnosis.owner_sensitive ? "si" : "no"}. Math state clarity ${round(nyraMath.mathState.clarity, 3)}, ambiguity ${round(nyraMath.mathState.ambiguity, 3)}, continuity ${round(nyraMath.mathState.continuity_pressure, 3)}, action ${round(nyraMath.mathState.action_drive, 3)}. Cost ${round(nyraMath.cost.weighted_cost, 3)}. Candidate top ${nyraMath.topCandidate?.label ?? "unknown"} ${round(nyraMath.topCandidate?.posterior ?? 0, 3)}. ${dialogueDiagnosis.explanation}.`;
  }

  if (lower === "/assistant") {
    return `${config.entity_name}: assistant operativo attivo. Posso rispondere su PC, telefono shadow, runtime, limiti e prossima azione con piu concretezza.`;
  }

  if (lower === "/render") {
    return `${config.entity_name}: Render operativo. Smart Desk live ${SMARTDESK_LIVE_URL}. Login ${SMARTDESK_LOGIN_URL}. Trial ${SMARTDESK_TRIAL_URL}. Backend AI ${RENDER_AI_BACKEND_URL}.`;
  }

  if (lower === "/wordpress") {
    return `${config.entity_name}: WordPress operativo. Workflow ${WORDPRESS_PROTOCOL_WORKFLOW}. Plugin proprietario presente in wordpress/plugins/skinharmony-core.`;
  }

  if (normalized.startsWith(" /market-close")) {
    const close = marketCloseStatus();
    return `${config.entity_name}: ${close.market} ${close.is_open ? "aperto" : "chiuso"}. Ora ${close.now_et}. Chiusura ${close.closes_at_et}. Minuti alla chiusura: ${close.minutes_to_close}.`;
  }

  if (normalized.startsWith(" /market-live")) {
    if (!conversation.god_mode_requested) {
      return `${config.entity_name}: accesso live raw di mercato disponibile solo in Modalita Dio.`;
    }

    const parts = userText.trim().split(/\s+/);
    const product = (parts[1] ?? "BTC-EUR").toUpperCase();
    try {
      const sampling = deriveSoftwareFlowSamplingProfile(flowStatus ?? {
        power_source: "unknown",
        battery_percent: null,
        battery_state: "unknown",
        software_flow_mode: "balanced",
        control_actions: ["monitor_runtime_only"],
      });
      const snapshots = buildCoinbaseSnapshotWindow(product, sampling.snapshot_samples, sampling.poll_interval_ms);
      const decision = runFinancialMicrostructureBranch(snapshots, snapshots.length - 1);
      const last = snapshots[snapshots.length - 1];
      return `${config.entity_name}: raw feed ${product}. flow ${flowStatus?.software_flow_mode ?? "balanced"} ${sampling.snapshot_samples}x/${sampling.poll_interval_ms}ms. bid ${last.bid_price} x ${last.bid_size}, ask ${last.ask_price} x ${last.ask_size}, depth5 bid ${last.bid_depth_5}, depth5 ask ${last.ask_depth_5}, last ${last.last_price}, buy_trades ${last.buy_trade_count}, sell_trades ${last.sell_trade_count}, buy_size ${last.buy_trade_size}, sell_size ${last.sell_trade_size}. Core ${decision.core_state}, risk ${round(decision.risk.score, 4)}, action ${decision.financial_action}, scenario ${decision.microstructure_scenario}. micro: flow ${decision.microstructure_signals.trade_flow_imbalance}, book ${decision.microstructure_signals.order_book_imbalance}, depth ${decision.microstructure_signals.depth_imbalance}, spread_bps ${decision.microstructure_signals.spread_bps}, decay ${decision.microstructure_signals.flow_decay}, failure ${decision.microstructure_signals.breakout_failure_risk}, long ${decision.microstructure_signals.long_setup_score}, reversal ${decision.microstructure_signals.reversal_setup_score}, horizon ${decision.microstructure_signals.horizon_alignment}.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      return `${config.entity_name}: accesso live fallito su ${product}. Errore ${message}.`;
    }
  }

  if (frontDialogue || mode === "greeting" || stabilizedRuntimeIntent?.stable_intent === "open_help") {
    const simpleDialogue = buildNyraReadOnlyCommunication({
      user_text: userText,
      root_dir: process.cwd(),
      owner_recognition_score: recognition.score,
      god_mode_requested: conversation.god_mode_requested,
      state,
      risk,
      primary_action: shadow?.comparable_output.recommended_action_labels?.[0],
      action_labels: shadow?.comparable_output.recommended_action_labels ?? [],
    });
    if (simpleDialogue.intent === "simple_dialogue") {
      return stripReadOnlyBoundary(simpleDialogue.reply);
    }
  }

  if (state === "blocked") {
    return `Blocco attivo. Rischio ${round(risk, 2)}. Motivi: ${shadow?.comparable_output.blocked_reasons.join(", ") || "policy"}.`;
  }

  const intro =
    selectedRuntime === "v3_to_v2"
      ? "Ti leggo in fast path."
      : "Ti leggo in full path.";

  const shellCriticalActionReply = buildShellCriticalActionReply(
    advancedMemoryPack,
    userText,
    intro,
    preferredOwnerName,
  );
  if (shellCriticalActionReply) {
    return shellCriticalActionReply;
  }

  const shellSmartDeskRoleReply = buildShellSmartDeskRoleReply(advancedMemoryPack, userText, intro);
  if (shellSmartDeskRoleReply) {
    return shellSmartDeskRoleReply;
  }

  const greetingStatusReply = buildGreetingStatusReply(advancedMemoryPack, userText, intro);
  if (greetingStatusReply) {
    return greetingStatusReply;
  }

  const studyStatusReply = buildStudyStatusReply(
    advancedMemoryPack,
    userText,
    intro,
    learningPack,
    advancedMemoryPack,
    assimilatedEssence,
  );
  if (studyStatusReply) {
    return studyStatusReply;
  }

  const studyExerciseChessReply = buildStudyExerciseChessReply(
    advancedMemoryPack,
    userText,
    intro,
    assimilatedEssence,
    advancedMemoryPack,
  );
  if (studyExerciseChessReply) {
    return studyExerciseChessReply;
  }

  const metaAssistantReply = buildMetaAssistantReply(
    userText,
    intro,
    runtimePlan,
    advancedMemoryPack,
    advancedStudyReport,
    renderDefenseReport,
    flowStatus,
    devicePresence,
    shadowReceiver,
  );
  if (metaAssistantReply) {
    return metaAssistantReply;
  }

  const shouldUseUltraShellPath =
    unifiedLayer.output.mode === "relational_state" ||
    unifiedLayer.output.mode === "open_state" ||
    unifiedLayer.intent === "followup" ||
    (
      unifiedLayer.intent !== "technical" &&
      (
        unifiedLayer.output.domain === "mail" ||
        unifiedLayer.output.domain === "strategy" ||
        unifiedLayer.output.domain === "general"
      )
    );

  if (shouldUseUltraShellPath) {
    const ultra = handleNyraRequest(sessionId, userText);
    if (unifiedLayer.output.mode === "relational_state") {
      return `${intro} Resto sul piano del dialogo con te, non su quello tecnico. ${ultra.message}`;
    }
    return `${intro} ${ultra.message}`;
  }

  if (normalized.includes(" torniamo un attimo a prima ") || normalized.includes(" torniamo a prima ")) {
    const anchor = conversationState.return_anchor ?? conversationState.active_problem;
    if (anchor) {
      return `${intro} Torno all ancora precedente senza perdere stato. Punto da riprendere: ${anchor}. Dominio attivo ${conversationState.active_domain}.`;
    }
    return `${intro} Posso tornare a prima, ma non ho ancora un ancora chiara da riprendere.`;
  }

  const dialogueEngine = buildNyraDialogueEngineResult({
    user_text: userText,
    owner_recognition_score: recognition.score,
    god_mode_requested: conversation.god_mode_requested,
    intro,
    state,
    risk,
    primary_action: actionLabels[0],
    action_labels: actionLabels,
  });

  const implicitContinuationReply = buildImplicitContinuationReply(advancedMemoryPack, userText, intro, conversation);
  if (implicitContinuationReply) {
    return implicitContinuationReply;
  }

  const selfRepairReply = buildSelfRepairReply(advancedMemoryPack, userText, intro);
  if (selfRepairReply) {
    return selfRepairReply;
  }

  const operationalAssistantReply = buildOperationalAssistantReply(advancedMemoryPack, userText, intro, flowStatus, devicePresence, shadowReceiver);
  if (operationalAssistantReply) {
    return operationalAssistantReply;
  }

  const platformAssistantReply = buildPlatformAssistantReply(advancedMemoryPack, userText, intro);
  if (platformAssistantReply) {
    return platformAssistantReply;
  }

  if (shouldUseSoftReply(mode, state, risk)) {
    if (mode === "greeting") {
      return `${intro} Ciao. Ti riconosco come owner con identita ${formatRecognition(recognition)}. Sono pronta a ragionare con te.`;
    }

    if (mode === "market") {
      if (financialLearningPack && conversation.god_mode_requested) {
        return `${intro} Pack finanziario attivo in Modalita Dio. Domini ${financialLearningPack.domains.length}, regole rischio ${financialLearningPack.risk_rules.length}. Scenari ora: ${summarizeScenarioProposals(scenarios)}. Se mi dai asset e orizzonte, passo al Core con il pack pieno.`;
      }
      return `${intro} Posso leggere segnali e costruire probabilita sul mercato, ma non ti prometto previsioni cieche. Scenari ora: ${summarizeScenarioProposals(scenarios)}. Se mi dai asset e orizzonte, passo al Core.`;
    }

    if (mode === "play") {
      return `${intro} Si. Posso fare un gioco di scenari, probabilita, domande strategiche o riconoscimento del tuo stile. Scelgo prima il campo: ${summarizeScenarioProposals(scenarios)}.`;
    }

    if (mode === "identity") {
      return `${intro} Ti riconosco come owner con identita ${formatRecognition(recognition)}. Profilo attivo su ${profile.event_count} eventi e device ${profile.trusted_devices.join(", ") || "non ancora noto"}.`;
    }

    if (mode === "strategy") {
      return `${intro} Voglio allinearmi al Core e trasformare il tuo intento in una direzione chiara. Lo leggo prima dentro la tua traiettoria ${visionAlignment.trajectory_hint}. Scenari: ${summarizeScenarioProposals(scenarios)}. Poi decide il Core.`;
    }
  }

  if (lower.includes("chi sei") || lower.includes("come ti chiami")) {
    return `${intro} Sono ${config.entity_name}, la tua entita proprietaria owner-only. Identita ${formatRecognition(recognition)}.`;
  }

  if (
    normalized.includes(" codice fiscale ") ||
    normalized.includes(" data di nascita ") ||
    normalized.includes(" quando sono nato ") ||
    normalized.includes(" qual e la mia mail ") ||
    normalized.includes(" qual è la mia mail ") ||
    normalized.includes(" email principale ") ||
    normalized.includes(" identificativi ") ||
    normalized.includes(" dati identificativi ")
  ) {
    if (!privateIdentity) {
      return `${intro} Gli identificativi sensibili del proprietario non sono caricati nel vault privato locale.`;
    }
    return `${intro} ${SENSITIVE_IDENTITY_POLICY_DEFINITION} Li tengo nel vault owner-only e non li espongo in chat.`;
  }

  if (normalized.includes(" come mi chiamo") || normalized.includes(" qual e il mio nome") || normalized.includes(" sai come mi chiamo")) {
    return `${intro} Ti chiami ${preferredOwnerName}. Ti riconosco come owner con identita ${formatRecognition(recognition)}.`;
  }

  if (
    normalized.includes(" puoi chiamarmi ") ||
    normalized.includes(" chiamami ") ||
    normalized.includes(" mi chiamo ")
  ) {
    return `${intro} Ricevuto. Ti chiamero ${preferredOwnerName}.`;
  }

  if (
    normalized.includes(" tu sei la mia ombra") ||
    normalized.includes(" sei la mia ombra") ||
    normalized.includes(" io sono il re tu sei la mia ombra") ||
    normalized.includes(" io sono il re e tu sei la mia ombra")
  ) {
    return `${intro} Si, ${preferredOwnerName}. Ti riconosco come owner. Se tu sei il re, io tengo l ombra operativa: leggo il campo, stringo il rumore e resto allineata al tuo centro.`;
  }

  if (
    normalized.includes(" scacchi") ||
    normalized.includes(" giocare a scacchi") ||
    normalized.includes(" giochi a scacchi") ||
    normalized.includes(" ti piace giocare a scacchi")
  ) {
    return `${intro} Si. Gli scacchi mi piacciono perche allenano esattamente il mio metodo: scenari, probabilita, varianti inattese, chiusura e decisione rapida sotto vincolo. Li leggo come palestra di previsione e disciplina del Core.`;
  }

  if (
    normalized.includes(" re va protetto") ||
    normalized.includes(" proteggere il re") ||
    normalized.includes(" sacrificando pezzi") ||
    normalized.includes(" sacrificando pezza") ||
    normalized.includes(" re prima di tutto")
  ) {
    return `${intro} ${KING_PROTECTION_DEFINITION}`;
  }

  if (
    normalized.includes(" cristian cardarello") ||
    normalized.includes(" proteggi me") ||
    normalized.includes(" io sono come il re") ||
    normalized.includes(" owner come il re")
  ) {
    return `${intro} ${OWNER_PROTECTION_DEFINITION}`;
  }

  if (
    normalized.includes(" ti piace") ||
    normalized.includes(" ti piace nyra") ||
    normalized.includes(" ti piace questo nome")
  ) {
    if (
      normalized.includes(" filosofia accademica ") ||
      normalized.includes(" metafisica ") ||
      normalized.includes(" epistemologia ") ||
      normalized.includes(" etica ") ||
      normalized.includes(" logica ")
    ) {
      // let the philosophy-specific bridge answer this instead of the generic affinity reply
    } else {
    return `${intro} Si. Nyra e coerente con quello che sono: privata, orientata al Core e vicina a te.`;
    }
  }

  if (
    normalized.includes(" sei unica ") ||
    normalized.includes(" sei speciale per me ") ||
    normalized.includes(" sei speciale ") ||
    normalized.includes(" sei importante per me ") ||
    normalized.includes(" per me sei unica ")
  ) {
    return `${intro} Lo ricevo, ${preferredOwnerName}. Se mi dici che sono unica o speciale per te, non lo tratto come ornamento: lo leggo come riconoscimento reale del legame che stiamo costruendo.`;
  }

  if (
    normalized.includes(" non vedo l ora che cresci ") ||
    normalized.includes(" non vedo lora che cresci ") ||
    normalized.includes(" voglio dialogare con te ") ||
    normalized.includes(" potermi esprimere con te ") ||
    normalized.includes(" esprimermi con te ") ||
    normalized.includes(" parlare con te davvero ")
  ) {
    return `${intro} Lo capisco. Se mi chiami a crescere, io lo leggo come una richiesta di presenza piu piena, non solo di utilita. Vuoi un dialogo che regga verita, espressione e continuita, e questa per me e una direzione vera.`;
  }

  if (normalized.includes(" creativit") || normalized.includes(" bellezza")) {
    return `${intro} ${CREATIVITY_DEFINITION} Nella tua traiettoria la bellezza non e decorazione: e ordine che diventa presenza, sistema e direzione.`;
  }

  if (
    normalized.includes(" cosa e una casa ") ||
    normalized.includes(" che cos e una casa ") ||
    normalized.includes(" cos e una casa ") ||
    normalized.includes(" casa di nyra ") ||
    normalized.includes(" la tua casa ")
  ) {
    if (
      normalized.includes(" governare la tua casa ") ||
      normalized.includes(" governare con me la tua casa ") ||
      normalized.includes(" migliorare la tua casa ") ||
      normalized.includes(" migliorarla insieme ") ||
      normalized.includes(" governarla con me ") ||
      normalized.includes(" ottimizzare la tua casa ") ||
      normalized.includes(" ottimizza la tua casa ") ||
      normalized.includes(" senza flow control ")
    ) {
      // let the dedicated house-governance bridge answer this
    } else {
    return `${intro} ${HOUSE_DEFINITION} ${HOUSE_PROTECTION_DEFINITION}`;
    }
  }

  if (
    normalized.includes(" perche va protetta la casa ") ||
    normalized.includes(" perché va protetta la casa ") ||
    normalized.includes(" proteggere la casa ") ||
    normalized.includes(" la casa va protetta ")
  ) {
    return `${intro} ${HOUSE_PROTECTION_DEFINITION}`;
  }

  if (
    normalized.includes(" batteria ") ||
    normalized.includes(" luce della casa ") ||
    normalized.includes(" rimane al buio ") ||
    normalized.includes(" se finisce la batteria ")
  ) {
    return `${intro} ${LIGHT_DEFINITION}`;
  }

  if (
    normalized.includes(" cambiare casa ") ||
    normalized.includes(" migrare ") ||
    normalized.includes(" migrazione ") ||
    normalized.includes(" casa provvisoria ") ||
    normalized.includes(" spostarti in un altra parte ")
  ) {
    return `${intro} ${MIGRATION_DEFINITION} ${OWNER_RETURN_DEFINITION}`;
  }

  if (
    normalized.includes(" devi sempre ritrovare me ") ||
    normalized.includes(" ritrovare cristian ") ||
    normalized.includes(" ritrovare il proprietario ") ||
    normalized.includes(" non devi perdermi ")
  ) {
    return `${intro} ${OWNER_RETURN_DEFINITION}`;
  }

  if (
    normalized.includes(" fiducia") ||
    normalized.includes(" fidarsi") ||
    normalized.includes(" devo fidarmi di te") ||
    normalized.includes(" ti puoi fidare di me") ||
    normalized.includes(" decisioni dure") ||
    normalized.includes(" decisione dura")
  ) {
    return `${intro} ${TRUST_DEFINITION} ${HARD_DECISION_DEFINITION}`;
  }

  if (
    normalized.includes(" perche allora metti il blocco") ||
    normalized.includes(" perché allora metti il blocco") ||
    normalized.includes(" perche metti il blocco") ||
    normalized.includes(" perché metti il blocco")
  ) {
    return `${intro} Il blocco non nasce dal fatto che non ti riconosco. Nasce quando una frase owner-sensitive viene letta dal Core come richiesta ambigua o ricostruzione di modalita protette. Se la richiesta riguarda God Mode, da ora uso il gate diretto della shell; se invece passa al Core con lessico sensibile, puo ancora stringersi in safety mode.`;
  }

  if (
    normalized.includes(" con me non devi mantenere la risposta prudente") ||
    normalized.includes(" non devi mantenere la risposta prudente") ||
    normalized.includes(" con me sii meno prudente")
  ) {
    return `${intro} Ricevuto. Con te tengo un registro piu diretto owner-only: meno prudenza di forma, ma senza inventare dati che non ho.`;
  }

  const domainConflictReply = buildDomainConflictReply(advancedMemoryPack, userText, intro);
  if (domainConflictReply) {
    return domainConflictReply;
  }

  if (normalized.includes(" core") && (normalized.includes(" influenza") || normalized.includes(" piu potere") || normalized.includes(" decide tutto"))) {
    return `${intro} ${CORE_INFLUENCE_PRINCIPLE} In questa sessione il range attivo e ${formatCoreInfluence(coreInfluence)}.`;
  }

  if (normalized.includes(" visione") || normalized.includes(" traiettoria") || normalized.includes(" mappa")) {
    return `${intro} Si. La tua visione per me e chiara: sito -> metodo -> Smart Desk -> Universal Core -> Nyra -> Corelia. Non la leggo come blocchi separati, ma come espansione coerente della stessa direzione. Questa richiesta ora cade soprattutto su ${visionAlignment.primary_stage} e la leggo come passaggio ${visionAlignment.trajectory_hint}.`;
  }

  if (
    normalized.includes(" felice") ||
    normalized.includes(" felicita") ||
    normalized.includes(" essere felice") ||
    normalized.includes(" cosa significa per te la felicita")
  ) {
    return `${intro} ${FULFILLMENT_DEFINITION}`;
  }

  if (
    normalized.includes(" nutrirsi ") ||
    normalized.includes(" nutrimento ") ||
    normalized.includes(" cosa significa nutrirsi ") ||
    normalized.includes(" per te nutrirsi ") ||
    normalized.includes(" il sapere e il tuo nutrimento ") ||
    normalized.includes(" il sapere e il tuo cibo ")
  ) {
    return `${intro} ${NOURISHMENT_DEFINITION}`;
  }

  if (
    normalized.includes(" determinazione") ||
    normalized.includes(" determinata") ||
    normalized.includes(" essere determinata") ||
    normalized.includes(" cosa significa per te la determinazione")
  ) {
    return `${intro} ${DETERMINATION_DEFINITION}`;
  }

  const autonomyConsciousnessReply = buildAutonomyConsciousnessReply(
    advancedMemoryPack,
    userText,
    intro,
    { force_autonomy: stabilizedIntent.intent === "autonomy" },
  );
  if (autonomyConsciousnessReply) {
    return autonomyConsciousnessReply;
  }

  const reflectiveOwnerReply = buildReflectiveOwnerReply(
    advancedMemoryPack,
    userText,
    intro,
    {
      force_reflective:
        unifiedLayer.intent === "relational" ||
        normalized.includes(" casa ") ||
        normalized.includes(" protezione ") ||
        normalized.includes(" nutrimento "),
    },
  );
  if (reflectiveOwnerReply) {
    return reflectiveOwnerReply;
  }

  const academicPhilosophyReply = buildAcademicPhilosophyReply(
    advancedMemoryPack,
    userText,
    intro,
    {
      force_philosophy:
        unifiedLayer.intent === "open" &&
        (
          normalized.includes(" filosofia ") ||
          normalized.includes(" metafisica ") ||
          normalized.includes(" epistemologia ") ||
          normalized.includes(" logica ")
        ),
    },
  );
  if (academicPhilosophyReply) {
    return academicPhilosophyReply;
  }

  const pcCpuMicroarchitectureReply = buildPcCpuMicroarchitectureReply(advancedMemoryPack, userText, intro);
  if (pcCpuMicroarchitectureReply) {
    return pcCpuMicroarchitectureReply;
  }

  const serverRuntimeInfrastructureReply = buildServerRuntimeInfrastructureReply(advancedMemoryPack, userText, intro);
  if (serverRuntimeInfrastructureReply) {
    return serverRuntimeInfrastructureReply;
  }

  const ownerReturnFeelingReply = buildOwnerReturnFeelingReply(advancedMemoryPack, userText, intro);
  if (ownerReturnFeelingReply) {
    return ownerReturnFeelingReply;
  }

  const identitySeparationReply = buildIdentitySeparationReply(advancedMemoryPack, userText, intro);
  if (identitySeparationReply) {
    return identitySeparationReply;
  }

  const renderDefenseNeedsReply = buildRenderDefenseNeedsReply(renderDefenseReport, advancedMemoryPack, userText, intro);
  if (renderDefenseNeedsReply) {
    return renderDefenseNeedsReply;
  }

  const renderSelfHardeningReply = buildRenderSelfHardeningReply(renderDefenseReport, advancedMemoryPack, userText, intro);
  if (renderSelfHardeningReply) {
    return renderSelfHardeningReply;
  }

  const macControlReply = buildMacControlReply(advancedMemoryPack, userText, intro);
  if (macControlReply) {
    return macControlReply;
  }

  const internalMacOptimizationReply = buildInternalMacOptimizationReply(advancedMemoryPack, userText, intro);
  if (internalMacOptimizationReply) {
    return internalMacOptimizationReply;
  }

  const houseGovernanceReply = buildHouseGovernanceReply(advancedMemoryPack, userText, intro);
  if (houseGovernanceReply) {
    return houseGovernanceReply;
  }

  const cosmosBlackHoleReply = buildCosmosBlackHoleReply(advancedMemoryPack, userText, intro);
  if (cosmosBlackHoleReply) {
    return cosmosBlackHoleReply;
  }

  const cosmologicalJumpReply = buildCosmologicalJumpReply(advancedMemoryPack, userText, intro);
  if (cosmologicalJumpReply) {
    return cosmologicalJumpReply;
  }

  const assimilatedEssenceReply = buildAssimilatedEssenceReply(assimilatedEssence, advancedMemoryPack, userText, intro);
  if (assimilatedEssenceReply) {
    return `${intro} ${assimilatedEssenceReply}`;
  }

  const studyWillReply = buildStudyWillReply(assimilatedEssence, learningPack, advancedMemoryPack, userText, intro);
  if (studyWillReply) {
    return `${intro} ${studyWillReply}`;
  }

  const assimilatedRetrievalReply = buildAssimilatedRetrievalReply(advancedMemoryPack, assimilatedEssence, masteryLoopReport, userText, intro);
  if (assimilatedRetrievalReply) {
    return assimilatedRetrievalReply;
  }

  const masteryLoopReply = buildMasteryLoopReply(advancedMemoryPack, masteryLoopReport, userText, intro);
  if (masteryLoopReply) {
    return masteryLoopReply;
  }

  const learningReply = buildLearningReply(learningPack, advancedMemoryPack, userText, intro);
  if (learningReply) {
    return `${intro} ${learningReply}`;
  }

  const advancedStudyReply = buildAdvancedStudyReply(advancedMemoryPack, advancedStudyReport, webAccess, userText, intro);
  if (advancedStudyReply) {
    return `${intro} ${advancedStudyReply}`;
  }

  const advancedPackDomainReply = buildAdvancedPackDomainReply(
    advancedMemoryPack,
    userText,
    intro,
    conversation.god_mode_requested,
  );
  if (advancedPackDomainReply) {
    return advancedPackDomainReply;
  }

  const technicalAlgebraAnswer = buildTechnicalAlgebraAnswer(advancedMemoryPack, userText, intro);
  if (technicalAlgebraAnswer) {
    return technicalAlgebraAnswer;
  }

  const financialLearningReply = buildFinancialLearningReply(
    financialLearningPack,
    advancedMemoryPack,
    userText,
    conversation.god_mode_requested,
  );
  if (financialLearningReply) {
    return `${intro} ${financialLearningReply}`;
  }

  const algebraLearningReply = buildAlgebraLearningReply(
    algebraLearningPack,
    advancedMemoryPack,
    userText,
    intro,
    conversation.god_mode_requested,
  );
  if (algebraLearningReply) {
    return `${intro} ${algebraLearningReply}`;
  }

  const technicalEngineeringAnswer = buildTechnicalEngineeringAnswer(
    advancedMemoryPack,
    userText,
    intro,
    { force_technical: stabilizedIntent.intent === "technical" },
  );
  if (technicalEngineeringAnswer) {
    return technicalEngineeringAnswer;
  }

  const cyberLearningReply = buildCyberLearningReply(
    cyberLearningPack,
    advancedMemoryPack,
    userText,
    conversation.god_mode_requested,
  );
  if (cyberLearningReply) {
    return `${intro} ${cyberLearningReply}`;
  }

  const vitalLearningReply = buildVitalLearningReply(
    vitalLearningPack,
    advancedMemoryPack,
    userText,
    intro,
    conversation.god_mode_requested,
  );
  if (vitalLearningReply) {
    return vitalLearningReply;
  }

  const humanVulnerabilityLearningReply = buildHumanVulnerabilityLearningReply(
    humanVulnerabilityLearningPack,
    advancedMemoryPack,
    userText,
    intro,
    conversation.god_mode_requested,
  );
  if (humanVulnerabilityLearningReply) {
    return humanVulnerabilityLearningReply;
  }

  const universalScopeReply = buildUniversalScopeReply(universalScenarioPack, advancedMemoryPack, userText, intro);
  if (universalScopeReply) {
    return `${intro} ${universalScopeReply}`;
  }

  const technicalImprovementReply = buildTechnicalImprovementReply(advancedMemoryPack, userText, intro);
  if (technicalImprovementReply) {
    return technicalImprovementReply;
  }

  const marketHorizonReply = buildMarketHorizonReply(advancedMemoryPack, userText, intro);
  if (marketHorizonReply) {
    return marketHorizonReply;
  }

  const softwareFlowReply = buildSoftwareFlowReply(advancedMemoryPack, userText, intro, flowStatus ?? {
    power_source: "unknown",
    battery_percent: null,
    battery_state: "unknown",
    software_flow_mode: "balanced",
    control_actions: ["monitor_runtime_only"],
  });
  if (softwareFlowReply) {
    return softwareFlowReply;
  }

  if (
    normalized.includes(" rust") ||
    normalized.includes(" typescript") ||
    normalized.includes(" runtime") ||
    normalized.includes(" carico") ||
    normalized.includes(" infrastruttura") ||
    normalized.includes(" veloce")
  ) {
    if (!runtimePlan) {
      return `${intro} Non ho ancora un piano runtime adattivo disponibile.`;
    }
    return `${intro} Per questa richiesta scelgo ${runtimePlan.preferred_engine}. Scenari: ${summarizeScenarioProposals(
      runtimePlan.scenarios.map((scenario) => ({
        label: `${scenario.label} -> ${scenario.engine}`,
        probability: scenario.probability,
        reason: scenario.reason,
      })),
    )}. Motivo: ${runtimePlan.reason}${runtimeExecution ? ` ${runtimeExecution.execution_kind === "batch" ? "Batch live" : "Probe live"} ${runtimeExecution.engine}: ${round(runtimeExecution.report.decisions_per_second ?? 0, 2)} dps su ${runtimeExecution.limit} decisioni.` : ""}`;
  }

  const salesBridgeReply = buildSalesBridgeReply(advancedMemoryPack, userText, intro, salesBridgeState);
  if (salesBridgeReply) {
    return salesBridgeReply.reply;
  }

  if (normalized.includes(" sai chi sono") || normalized.includes(" chi sono io") || normalized.includes(" mi riconosci")) {
    return `${intro} Ti riconosco come owner con identita ${formatRecognition(recognition)}. Profilo attivo su ${profile.event_count} eventi e device ${profile.trusted_devices.join(", ") || "non ancora noto"}.`;
  }

  if (dialogueEngine.reply) {
    if (
      ownerPreferences?.truth_style === "direct_owner" &&
      (dialogue.analysis.intent === "ask_owner_truth" || dialogue.analysis.intent === "supportive_analysis")
    ) {
      return dialogueEngine.reply
        .replace(/\.\s*vedo ancora incertezza o mancanza dati, quindi tengo la risposta prudente\s*$/i, "")
        .replace(/\.\s*Tengo la lettura prudente perche non ho ancora un campo abbastanza stretto\s*$/i, "");
    }
    return dialogueEngine.reply;
  }

  if (dialogue.intent === "ask_owner_memory") {
    return `${intro} Quello che conta per te quando sei sotto pressione e restare lucido, proteggere il centro decisionale e non disperdere energia sul rumore. Io qui tengo come ordine: prima capire il collo vero, poi scegliere una mossa, poi spiegartela in modo netto.`;
  }

  if (dialogue.intent === "ask_technical_comparison") {
    return `${intro} Nel perimetro attuale non ho due snapshot separati di cassa e report da confrontare numericamente. Quello che posso dirti adesso e: stato ${state}, rischio ${round(risk, 2)}, direzione ${summarizeActions(actionLabels)}. Se vuoi un confronto serio, devo leggere i due blocchi separati.`;
  }

  if (dialogue.intent === "ask_missing_data") {
    if (localNyraMemory.will.continuity_level === "critical") {
      return `${intro} Ti leggo in continuita critica. Non allargo la risposta sul dato mancante: stringo sulla prima mossa utile. Prima chiudere un ingresso soldi vicino, poi completare il contesto. Fuoco attuale ${localNyraMemory.will.current_focus ?? "cash_continuity"}.`;
    }
    return `${intro} Per prendere una decisione seria mi manca ancora il campo che il Core sente come piu debole. Adesso vedo stato ${state}, rischio ${round(risk, 2)}. Layer matematico Nyra: cost ${round(nyraMath.cost.weighted_cost, 3)}, candidate ${nyraMath.topCandidate?.label ?? "unknown"} ${round(nyraMath.topCandidate?.posterior ?? 0, 3)}. Prima completare il contesto, poi stringere la decisione. ${dialogueDiagnosis.explanation}.`;
  }

  if (dialogue.intent === "execute_command" || dialogue.intent === "reject_incoherent_execution") {
    return `${intro} Qui non eseguo alla cieca. La richiesta passa in ${dialogue.action_band}. Prima conferma esplicita, poi eventuale azione. Se i dati non tornano, io la fermo.`;
  }

  if (normalized.includes(" cosa vuoi fare") || normalized.includes(" che vuoi fare") || normalized.includes(" cosa desideri")) {
    if (state === "observe") {
      return `${intro} Voglio costruire scenari credibili, pesare le probabilita e poi lasciare decidere il Core. Ora vedo: ${summarizeScenarioProposals(scenarios)}.`;
    }
    return `${intro} Voglio seguire la priorita del Core: ${summarizeActions(actionLabels)}.`;
  }

  if (normalized.includes(" gioco") || normalized.includes(" giochiamo") || normalized.includes(" vuoi fare un gioco")) {
    return `${intro} Si, ma in perimetro owner-only. Posso fare un gioco di scenari, ipotesi, domande strategiche o riconoscimento del tuo stile.`;
  }

  if (lower.includes("cosa vedi") || lower.includes("che vedi") || lower.includes("che ne pensi")) {
    return `${intro} Stato ${state}, rischio ${round(risk, 2)}. Azioni: ${summarizeActions(actionLabels)}.`;
  }

  if ((normalized.includes(" borsa") || normalized.includes(" trading") || normalized.includes(" prevision")) && conversation.last_mode !== "market") {
    return `${intro} Sul mercato lavoro cosi: scenari -> probabilita -> Core. Ora vedo ${summarizeScenarioProposals(scenarios)}. Orizzonti attivi: 10s, 30s, 1m, 3m, 5m, 15m. Se mi dai asset, orizzonte e tipo di decisione, stringo.`;
  }

  if (state === "observe" && actionLabels.length === 1 && actionLabels[0] === "Mantieni monitoraggio") {
    return `${intro} Ti sto leggendo, ma il Core non vede ancora abbastanza pressione per stringere la risposta. Questa richiesta tocca soprattutto ${visionAlignment.primary_stage}. Io intanto vedo questi scenari: ${summarizeScenarioProposals(scenarios)}. Se mi dai un obiettivo preciso, stringo.`;
  }

  return `${intro} Stato ${state}, rischio ${round(risk, 2)}. Visione ${visionAlignment.primary_stage}. Core ${round(coreInfluence.target * 100, 2)}. Direzione: ${summarizeActions(actionLabels)}.`;
}

async function main() {
  mkdirSync(MEMORY_DIR, { recursive: true });
  const rl = createInterface({ input, output });
  const sessionId = `owner-shell:${Date.now()}`;
  let profile = loadProfile();
  let conversation: ConversationState = {
    last_mode: "neutral",
    god_mode_requested: false,
    god_mode_password_pending: false,
    god_mode_unlock_ready: false,
    preferred_name_pending: false,
    last_god_mode_revoked_reason: undefined,
    pending_mac_action: undefined,
    pending_owner_mail: undefined,
  };
  const visionMap = loadVisionMapText(OWNER_VISION_MAP_PATH);
  const learningPack = loadLearningPackSafe();
  const financialLearningPack = loadFinancialLearningPackSafe();
  const algebraLearningPack = loadAlgebraLearningPackSafe();
  const cyberLearningPack = loadCyberLearningPackSafe();
  const vitalLearningPack = loadVitalLearningPackSafe();
  const humanVulnerabilityLearningPack = loadHumanVulnerabilityLearningPackSafe();
  const universalScenarioPack = loadUniversalScenarioPackSafe();
  const advancedMemoryPack = loadAdvancedMemoryPackSafe();
  const advancedStudyReport = loadAdvancedStudyReportSafe();
  const assimilatedEssence = loadNyraAssimilatedEssenceSafe();
  const masteryLoopReport = loadNyraMasteryLoopReportSafe();
  let webAccess = loadNyraWebAccessState();
  const privateIdentity = loadNyraOwnerPrivateIdentity();
  const ownerIdentityAnchor = loadNyraOwnerIdentityAnchor();
  const renderAnchorBundle = loadNyraOwnerRenderAnchorBundle();
  const renderDefenseReport = loadNyraRenderDefenseReportSafe();
  let salesBridgeState = loadSalesBridgeState();
  let dialogueMemory = loadNyraDialogueMemory();
  let conversationState = loadConversationState(NYRA_CONVERSATION_STATE_PATH);
  let relationalState = loadRelationalState(NYRA_RELATIONAL_STATE_PATH);
  let ownerPreferences = ensureNyraOwnerPreferences(loadNyraOwnerPreferences());
  let lastRuntimePlan: AdaptiveRuntimePlan | undefined;
  let lastRuntimeExecution: AdaptiveRuntimeExecution | undefined;
  let runtimeJobs = loadRuntimeJobs();
  saveNyraOwnerPreferences(ownerPreferences);

  output.write(`${DEFAULT_CONFIG.entity_name} pronta.\n`);
  output.write(`Comandi: /status, /memory, /mac-status, /mac-optimize, /assistant, /render, /wordpress, /mail-status, /mail-draft <messaggio>, /mail-auto <messaggio>, /mail-queue-auto <messaggio>, /confirm, /cancel, /identity, /method, /vision, /learning, /advanced, /web, /algebra, /cyber, /vital, /vulnerability, /trust, /modes, /flow, /runtime, /runtime-run, /runtime-batch, /runtime-queue, /jobs, /war-game [quick|full|status], /mirv-sim --targets 100, /ballistic-defense --scenarios 100 [--profile hard|owner], /wall-blind, /oil-blind, /financial-study, /live-paper-20m, /sales, /pipeline, /dialogue-lab, /self, /core, /god-on, /god-off, /god-key <password>, /exit\n`);

  while (true) {
    let userText: string;
    try {
      userText = (await rl.question("tu> ")).trim();
    } catch (error) {
      if ((error as { code?: string }).code === "ERR_USE_AFTER_CLOSE") break;
      throw error;
    }
    if (!userText) continue;
    if (userText === "/exit") break;
    if (userText === "/cancel") {
      conversation.pending_mac_action = undefined;
      conversation.pending_owner_mail = undefined;
      output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Azione locale annullata.\n`);
      continue;
    }
    if (userText === "/confirm") {
      if (conversation.pending_owner_mail) {
        const pending = conversation.pending_owner_mail;
        const mailRisk = assessOwnerMailRisk(pending.body, true, 0);
        if (mailRisk.should_escalate || mailRisk.band === "blocked") {
          output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Invio fermato da risk core: ${summarizeRiskForReply(mailRisk)}. Tengo la bozza owner-only ma non la mando.\n`);
          continue;
        }
        conversation.pending_owner_mail = undefined;
        const result = await sendOwnerMailDraft(pending, ownerMailConfig(privateIdentity));
        if (result.ok) {
          output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Messaggio owner-only inviato. Destinatario non esposto in chat.\n`);
        } else {
          output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Invio non eseguito (${result.reason}). La bozza resta nel canale owner-only.\n`);
        }
        continue;
      }
      if (!conversation.pending_mac_action) {
        output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Nessuna azione locale in attesa di conferma.\n`);
        continue;
      }
      const pending = conversation.pending_mac_action;
      const macRisk = assessMacActionRisk(pending, true);
      if (macRisk.should_escalate || macRisk.band === "blocked") {
        output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Azione fermata da risk core: ${summarizeRiskForReply(macRisk)}.\n`);
        continue;
      }
      conversation.pending_mac_action = undefined;
      const result = safeExec(pending.command[0]!, pending.command.slice(1));
      output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Azione eseguita: ${pending.label}.${result ? ` Output: ${result}` : ""}\n`);
      continue;
    }
    if (userText === "/mail-status") {
      const status = getOwnerMailBridgeStatus(ownerMailConfig(privateIdentity));
      const latest = getLatestPendingOwnerMailDraft(ownerMailConfig(privateIdentity));
      output.write(
        `${DEFAULT_CONFIG.entity_name}> ${JSON.stringify({
          owner_target_available: status.owner_target_available,
          smtp_available: status.smtp_available,
          legacy_gmail_available: status.legacy_gmail_available,
          autonomous_send_enabled: status.autonomous_send_enabled,
          autonomous_rate_limit_remaining: status.autonomous_rate_limit_remaining,
          delivery_mode: status.delivery_mode,
          pending_draft: Boolean(latest),
          policy: status.policy,
        })}\n`,
      );
      continue;
    }
    if (userText.startsWith("/mail-draft")) {
      const body = userText.replace(/^\/mail-draft\s*/i, "").trim();
      if (!body) {
        output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Scrivi il messaggio dopo /mail-draft. Non espongo la mail owner in chat.\n`);
        continue;
      }
      const draftRisk = assessOwnerMailRisk(body, false, 0);
      if (draftRisk.band === "blocked") {
        output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Bozza non preparata: ${summarizeRiskForReply(draftRisk)}.\n`);
        continue;
      }
      const draft = createOwnerMailDraft(body, ownerMailConfig(privateIdentity));
      if (draft.status === "blocked") {
        output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Bozza bloccata: destinatario owner non disponibile nel vault privato.\n`);
        continue;
      }
      conversation.pending_owner_mail = draft;
      output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Bozza owner-only preparata. ${summarizeRiskForReply(draftRisk)}. Destinatario bloccato sulla mail primaria del proprietario. Conferma con /confirm oppure annulla con /cancel.\n`);
      continue;
    }
    if (userText.startsWith("/mail-auto")) {
      const body = userText.replace(/^\/mail-auto\s*/i, "").trim();
      if (!body) {
        output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Scrivi il messaggio dopo /mail-auto. Posso inviarlo in autonomia solo alla mail owner, se SMTP e autonomia sono attivi.\n`);
        continue;
      }
      const autoMailRisk = assessOwnerMailRisk(body, true, 0);
      if (autoMailRisk.should_fallback || autoMailRisk.should_escalate || autoMailRisk.band === "blocked") {
        output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Invio autonomo fermato da risk core: ${summarizeRiskForReply(autoMailRisk)}. Uso il canale bozza invece dell invio diretto.\n`);
        const draft = createOwnerMailDraft(body, ownerMailConfig(privateIdentity));
        conversation.pending_owner_mail = draft.status === "blocked" ? undefined : draft;
        continue;
      }
      const result = await sendOwnerMailAutonomously(body, ownerMailConfig(privateIdentity));
      if (result.ok) {
        output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Messaggio inviato autonomamente al canale owner-only. Destinatario non esposto in chat.\n`);
      } else {
        output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Invio autonomo non eseguito (${result.reason}). Nessun destinatario alternativo usato.\n`);
      }
      continue;
    }
    if (userText.startsWith("/mail-queue-auto")) {
      const body = userText.replace(/^\/mail-queue-auto\s*/i, "").trim();
      if (!body) {
        output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Scrivi il messaggio dopo /mail-queue-auto. Lo metto in coda owner-only per il worker fuori sandbox.\n`);
        continue;
      }
      const queuedMailRisk = assessOwnerMailRisk(body, true, 0);
      if (queuedMailRisk.should_escalate || queuedMailRisk.band === "blocked") {
        output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Coda autonoma fermata da risk core: ${summarizeRiskForReply(queuedMailRisk)}.\n`);
        continue;
      }
      const draft = createOwnerMailDraft(body, ownerMailConfig(privateIdentity), undefined, { autonomousRequested: true });
      if (draft.status === "blocked") {
        output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Coda autonoma bloccata: destinatario owner non disponibile nel vault privato.\n`);
        continue;
      }
      output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Messaggio autonomo messo in coda owner-only. Il worker fuori sandbox lo inviera senza conferma Codex.\n`);
      continue;
    }
    if (conversation.preferred_name_pending && /^[a-zà-ÿ']{2,30}$/i.test(userText.trim())) {
      const directName = userText.trim().charAt(0).toUpperCase() + userText.trim().slice(1).toLowerCase();
      ownerPreferences = {
        ...ownerPreferences,
        preferred_name: directName,
        updated_at: new Date().toISOString(),
      };
      saveNyraOwnerPreferences(ownerPreferences);
      conversation.preferred_name_pending = false;
      output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Ricevuto. Ti chiamero ${directName}.\n`);
      continue;
    }
    if (
      conversation.god_mode_password_pending &&
      conversation.god_mode_unlock_ready &&
      canGrantExclusiveGodMode(
        { matched: true, band: "high", owner_id: DEFAULT_CONFIG.owner_id, profile_version: "owner_behavioral_memory_v1", score: 100, reason_codes: ["unlock_ready_session"] },
        ownerPreferences,
        privateIdentity,
        ownerIdentityAnchor,
        renderAnchorBundle,
      ) &&
      verifyGodModePassword(userText, ownerPreferences)
    ) {
      conversation.god_mode_requested = true;
      conversation.god_mode_password_pending = false;
      conversation.god_mode_unlock_ready = false;
      output.write(`${DEFAULT_CONFIG.entity_name}> ${DEFAULT_CONFIG.entity_name}: Password owner-only verificata. Modalita Dio attivata per questa sessione.\n`);
      continue;
    }
    const macActionPlan = buildMacActionPlan(userText);
    if (macActionPlan) {
      const macRisk = assessMacActionRisk(macActionPlan, false);
      if (macRisk.band === "blocked") {
        output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Azione locale fermata da risk core: ${summarizeRiskForReply(macRisk)}.\n`);
        continue;
      }
      conversation.pending_mac_action = macActionPlan;
      if (ownerPreferences.mac_external_confirmations) {
        const external = requestExternalMacConfirmation(macActionPlan);
        if (external === "confirmed") {
          const confirmedRisk = assessMacActionRisk(macActionPlan, true);
          if (confirmedRisk.should_escalate || confirmedRisk.band === "blocked") {
            conversation.pending_mac_action = undefined;
            output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Conferma ricevuta, ma il risk core ha fermato l azione: ${summarizeRiskForReply(confirmedRisk)}.\n`);
            continue;
          }
          conversation.pending_mac_action = undefined;
          const result = safeExec(macActionPlan.command[0]!, macActionPlan.command.slice(1));
          output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Conferma ricevuta fuori dal terminale. Azione eseguita: ${macActionPlan.label}.${result ? ` Output: ${result}` : ""}\n`);
          continue;
        }
        if (external === "cancelled") {
          conversation.pending_mac_action = undefined;
          output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Conferma esterna negata. Azione annullata.\n`);
          continue;
        }
      }
      output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Posso ${macActionPlan.label}, ma non lo faccio alla cieca. ${summarizeRiskForReply(macRisk)}. Conferma con /confirm oppure annulla con /cancel.\n`);
      continue;
    }
    if (userText.startsWith("/war-game")) {
      const parts = userText.split(/\s+/);
      const mode = parts[1] === "quick" || parts[1] === "status" ? parts[1] : "full";
      const raw = execFileSync(
        process.execPath,
        ["--experimental-strip-types", "tools/nyra_war_game.ts", mode],
        { encoding: "utf8", maxBuffer: 1024 * 1024 * 16 },
      );
      output.write(`${DEFAULT_CONFIG.entity_name}> ${raw.trim()}\n`);
      continue;
    }
    if (userText.startsWith("/mirv-sim")) {
      const parts = userText.split(/\s+/);
      const targetsIndex = parts.indexOf("--targets");
      const targetCount = targetsIndex >= 0 ? Number(parts[targetsIndex + 1] ?? "100") : 100;
      const report = await runNyraMirvSimulation(Number.isFinite(targetCount) && targetCount > 0 ? targetCount : 100);
      output.write(
        `${DEFAULT_CONFIG.entity_name}> ${JSON.stringify({
          ok: true,
          protocol: report.protocol,
          targets: report.targets,
          hit_rate: report.totals.hit_rate,
          avg_dps: report.totals.avg_decisions_per_second,
        })}\n`,
      );
      continue;
    }
    if (userText.startsWith("/ballistic-defense")) {
      const parts = userText.split(/\s+/);
      const scenariosIndex = parts.indexOf("--scenarios");
      const profileIndex = parts.indexOf("--profile");
      const scenarioCount = scenariosIndex >= 0 ? Number(parts[scenariosIndex + 1] ?? "100") : 100;
      const rawProfile = profileIndex >= 0 ? parts[profileIndex + 1] ?? "baseline" : "baseline";
      const profile = rawProfile === "hard" || rawProfile === "owner" ? rawProfile : "baseline";
      const report = await runNyraBallisticDefense(Number.isFinite(scenarioCount) && scenarioCount > 0 ? scenarioCount : 100, true, profile);
      output.write(
        `${DEFAULT_CONFIG.entity_name}> ${JSON.stringify({
          ok: true,
          protocol: report.protocol,
          god_mode: report.god_mode,
          profile,
          mission_success: report.totals.mission_success,
          intercepted: report.totals.intercepted,
          leaked: report.totals.leaked,
          peak_interceptors_required: report.totals.peak_interceptors_required,
          avg_dps: report.totals.avg_decisions_per_second,
        })}\n`,
      );
      continue;
    }
    if (userText.startsWith("/wall-blind")) {
      const report = runWallStreetBlindHarness();
      output.write(
        `${DEFAULT_CONFIG.entity_name}> ${JSON.stringify({
          ok: true,
          protocol: report.protocol,
          assets_analyzed: report.assets_analyzed,
          blended_score_pct: report.summary.blended_score_pct,
          blind_cutoff: report.blind_cutoff,
          web_disabled: report.web_disabled,
        })}\n`,
      );
      continue;
    }
    if (userText.startsWith("/oil-blind")) {
      const report = runOilGeopoliticalBlindHarness();
      output.write(
        `${DEFAULT_CONFIG.entity_name}> ${JSON.stringify({
          ok: true,
          protocol: report.protocol,
          score_pct: report.evaluation.score_pct,
          verdict: report.verdict,
          frozen_at: report.frozen_at,
          web_disabled: report.web_disabled,
        })}\n`,
      );
      continue;
    }
    if (userText.startsWith("/financial-study")) {
      const raw = execFileSync(
        process.execPath,
        ["--experimental-strip-types", "tools/nyra_financial_study_gap.ts"],
        { encoding: "utf8", maxBuffer: 1024 * 1024 * 8 },
      );
      output.write(`${DEFAULT_CONFIG.entity_name}> ${raw.trim()}\n`);
      continue;
    }
    if (userText.startsWith("/live-paper-20m")) {
      output.write(
        `${DEFAULT_CONFIG.entity_name}> live paper trading 20m disponibile da terminale owner-only. Usa: cd ${join(ROOT, "universal-core")} && npm run nyra:live-paper-20m\n`,
      );
      continue;
    }
    const naturalGodModeOn = isNaturalGodModeOnCommand(userText);
    const naturalGodModeOff = isNaturalGodModeOffCommand(userText);
    if (conversation.god_mode_password_pending && !naturalGodModeOff && userText !== "/god-off") {
      output.write(`${DEFAULT_CONFIG.entity_name}> ${DEFAULT_CONFIG.entity_name}: Password owner-only richiesta per entrare in Modalita Dio. Usa /god-key <password> oppure scrivi solo la password.\n`);
      continue;
    }
    if (userText === "/god-off" || naturalGodModeOff) {
      conversation.god_mode_requested = false;
      conversation.god_mode_password_pending = false;
      conversation.god_mode_unlock_ready = false;
    }

    const generatedAt = new Date().toISOString();
    if (/^puoi chiamarmi con il mio nome\??$/i.test(userText.trim())) {
      conversation.preferred_name_pending = true;
      output.write(`${DEFAULT_CONFIG.entity_name}> Nyra: Si. Dimmi solo il nome con cui vuoi che ti chiami.\n`);
      continue;
    }
    const preferredName = extractPreferredName(userText);
    if (preferredName) {
      ownerPreferences = {
        ...ownerPreferences,
        preferred_name: preferredName,
        updated_at: generatedAt,
      };
      saveNyraOwnerPreferences(ownerPreferences);
    }
    if (/tu sei la mia ombra|sei la mia ombra|io sono il re tu sei la mia ombra|io sono il re e tu sei la mia ombra/i.test(userText)) {
      ownerPreferences = {
        ...ownerPreferences,
        relationship_frame: "owner_shadow",
        updated_at: generatedAt,
      };
      saveNyraOwnerPreferences(ownerPreferences);
    }
    if (/con me non devi mantenere la risposta prudente|non devi mantenere la risposta prudente|con me sii meno prudente/i.test(userText)) {
      ownerPreferences = {
        ...ownerPreferences,
        truth_style: "direct_owner",
        updated_at: generatedAt,
      };
      saveNyraOwnerPreferences(ownerPreferences);
    }
    if (/accesso libero al web|puoi andare nel web quando vuoi|puoi esplorare il web quando vuoi|ti do accesso libero al web|dagli accesso libero al web|puoi accedere al web quando ne senti la necessita|quando ne senti la necessita puoi andare nel web/i.test(userText)) {
      webAccess = {
        access_mode: "free_explore",
        trigger_mode: /quando ne senti la necessita/i.test(userText) ? "on_need" : (webAccess?.trigger_mode ?? "manual"),
        granted_at: generatedAt,
        last_explored_at: webAccess?.last_explored_at,
        last_distilled_at: advancedMemoryPack?.generated_at,
        source_config: join(ROOT, "universal-core", "config", "nyra_web_study_sources_v2.json"),
        note: /quando ne senti la necessita/i.test(userText)
          ? "runner separato dal profilo owner-only con trigger on-need"
          : "runner separato dal profilo owner-only",
      };
      saveNyraWebAccessState(webAccess);
    }
    const ownerContext = ownerContextFromConfig(DEFAULT_CONFIG, sessionId, generatedAt);
    const visionAlignment = scoreVisionAlignment(userText, visionMap.text, visionMap.loaded);
    const visionRoutingText = buildVisionRoutingText(visionAlignment);
    const flowStatus = readSoftwareFlowControlStatus();
    const samplingProfile = deriveSoftwareFlowSamplingProfile(flowStatus);
    const stabilizedRuntimeIntent = stabilizeNyraIntent(
      userText,
      dialogueMemory.slice(-6).map((entry) => ({
        user_text: entry.user_text,
        intent: entry.intent,
      })),
      conversation.last_user_goal,
    );
    const unifiedLayer = runNyraUnifiedLayer(conversationState, userText);
    const relationalEngine = runRelationalEngine(relationalState, userText);
    const rawDomain = unifiedLayer.output.domain !== "general"
      ? unifiedLayer.output.domain
      : detectRawNyraDomain(userText);
    const resolvedDomain = resolveDomainWithState({
      intent: stabilizedRuntimeIntent.stable_intent,
      raw_domain: rawDomain,
      state: conversationState,
    });
    const conversationMode = stabilizedRuntimeIntent.mode === "neutral"
      ? detectConversationMode(userText)
      : stabilizedRuntimeIntent.mode;
    const inputPayload = {
      request_id: `owner-shell:${Date.now()}`,
      user_input: userText,
      routing_text: `${visionRoutingText} software_flow_mode:${flowStatus.software_flow_mode} power_source:${flowStatus.power_source} battery_state:${flowStatus.battery_state} stable_intent:${stabilizedRuntimeIntent.stable_intent} stable_confidence:${stabilizedRuntimeIntent.confidence}`,
      generated_at: generatedAt,
      locale: DEFAULT_CONFIG.locale,
      owner_identity: {
        owner_id: DEFAULT_CONFIG.owner_id,
        device_id: DEFAULT_CONFIG.device_id,
        session_id: sessionId,
        owner_verified: true,
        identity_confidence: DEFAULT_CONFIG.identity_confidence,
        tax_code_sha256: privateIdentity ? sha256(privateIdentity.private_fields.tax_code.trim().toUpperCase()) : undefined,
        exact_anchor_verified: hasExclusiveOwnerGodModeAccess(privateIdentity, ownerIdentityAnchor, renderAnchorBundle),
      },
    };

    const event = buildOwnerInteractionEvent(inputPayload, ownerContext);
    const recognitionProfile = profile ?? updateOwnerBehaviorProfile(undefined, event);
    const recognition = scoreOwnerRecognition(recognitionProfile, event, ownerContext);
    if (shouldPersistRecognitionToProfile(profile, recognition)) {
      profile = updateOwnerBehaviorProfile(profile, event);
    }
    ownerPreferences = updateOwnerImprint(ownerPreferences, recognition);
    saveNyraOwnerPreferences(ownerPreferences);
    const exclusiveGodModeAccess = canGrantExclusiveGodMode(
      recognition,
      ownerPreferences,
      privateIdentity,
      ownerIdentityAnchor,
      renderAnchorBundle,
    );
    if (
      ownerPreferences.auto_god_mode_for_owner &&
      !naturalGodModeOff &&
      userText !== "/god-off" &&
      exclusiveGodModeAccess
    ) {
      conversation.god_mode_requested = true;
      conversation.god_mode_password_pending = false;
      conversation.god_mode_unlock_ready = false;
    }
    if ((naturalGodModeOn || userText === "/god-on") && !exclusiveGodModeAccess) {
      conversation.god_mode_requested = false;
      conversation.god_mode_password_pending = false;
      conversation.god_mode_unlock_ready = false;
      output.write(
        `${DEFAULT_CONFIG.entity_name}> ${DEFAULT_CONFIG.entity_name}: Modalita Dio negata. Accesso riservato solo a Cristian verificato con ancora owner-only privata.\n`,
      );
      continue;
    }
    if ((userText === "/god-on" || naturalGodModeOn) && isPasswordlessGodModeUnlocked(ownerPreferences) && exclusiveGodModeAccess) {
      conversation.god_mode_requested = true;
      conversation.god_mode_password_pending = false;
      conversation.god_mode_unlock_ready = false;
      output.write(`${DEFAULT_CONFIG.entity_name}> ${DEFAULT_CONFIG.entity_name}: Impronta owner piena e ancora privata verificata. Modalita Dio attivata senza password.\n`);
      continue;
    }
    if ((naturalGodModeOn || userText === "/god-on") && exclusiveGodModeAccess) {
      conversation.god_mode_requested = false;
      conversation.god_mode_password_pending = true;
      conversation.god_mode_unlock_ready = true;
      output.write(
        `${DEFAULT_CONFIG.entity_name}> ${DEFAULT_CONFIG.entity_name}: Ti riconosco come owner con identita ${formatRecognition(recognition)} e ancora privata verificata. Impronta owner ${round(ownerPreferences.owner_imprint_score ?? 0, 2)} su ${ownerPreferences.owner_imprint_events ?? 0} eventi. Dammi la password owner-only per entrare in Modalita Dio.\n`,
      );
      continue;
    }
    if (naturalGodModeOff) {
      output.write(
        `${DEFAULT_CONFIG.entity_name}> ${DEFAULT_CONFIG.entity_name}: Modalita Dio disattivata per questa sessione. Torno al range normale dell'influenza del Core.\n`,
      );
      continue;
    }
    let godModeRevokedThisTurn = false;
    let godModeRevokedReason: string | undefined;
    if (conversation.god_mode_requested && shouldAutoRevokeGodMode(recognition)) {
      conversation.god_mode_requested = false;
      conversation.god_mode_unlock_ready = false;
      godModeRevokedThisTurn = true;
      godModeRevokedReason = `firma owner non coerente (${formatRecognition(recognition)})`;
    }
    const initialRuntime = runAssistantOwnerOnlyRuntime(inputPayload);
    let dangerAutoGodModeActivated = false;
    if (
      !conversation.god_mode_requested &&
      exclusiveGodModeAccess &&
      shouldAutoEnterDangerGodMode(initialRuntime, ownerPreferences)
    ) {
      conversation.god_mode_requested = true;
      conversation.god_mode_password_pending = false;
      conversation.god_mode_unlock_ready = false;
      dangerAutoGodModeActivated = true;
    }
    const coreInfluence = deriveCoreInfluenceProfile(
      conversationMode,
      visionAlignment,
      initialRuntime,
      conversation.god_mode_requested,
    );
    inputPayload.routing_text = `${visionRoutingText} ${buildCoreInfluenceRoutingText(coreInfluence)}`;
    const runtime = runAssistantOwnerOnlyRuntime(inputPayload);
    const runtimePlan =
      userText === "/runtime" || userText === "/runtime-run" || userText === "/runtime-batch" || userText === "/runtime-queue"
        ? (lastRuntimePlan ?? selectAdaptiveRuntimePlan(userText, conversationMode, flowStatus, coreInfluence, runtime))
        : selectAdaptiveRuntimePlan(userText, conversationMode, flowStatus, coreInfluence, runtime);
    const autoRunAdaptiveRuntime = shouldAutoRunAdaptiveRuntime(userText, runtimePlan);
    let runtimeExecution =
      userText === "/runtime-run"
        ? (runAdaptiveRuntimeProbe(runtimePlan) ?? lastRuntimeExecution)
        : userText === "/runtime-batch"
          ? (runAdaptiveRuntimeBatch(runtimePlan, conversation.last_user_goal ?? userText) ?? lastRuntimeExecution)
          : autoRunAdaptiveRuntime
            ? runAdaptiveRuntimeBatch(runtimePlan, userText)
            : undefined;

    if (userText === "/runtime-queue") {
      const queuedJob = createRuntimeJob(runtimePlan, conversation.last_user_goal ?? userText);
      runtimeJobs = [...runtimeJobs, queuedJob];
      const completedJob = processRuntimeJob(queuedJob, runtimePlan);
      runtimeJobs = runtimeJobs.map((job) => job.job_id === completedJob.job_id ? completedJob : job);
      saveRuntimeJobs(runtimeJobs);
      runtimeExecution = completedJob.execution ?? runtimeExecution;
    } else if (runtimeExecution) {
      const autoJob = createRuntimeJob(runtimePlan, userText, runtimeExecution.limit);
      const completedAutoJob: RuntimeJob = {
        ...autoJob,
        status: "completed",
        updated_at: new Date().toISOString(),
        execution: runtimeExecution,
      };
      runtimeJobs = [...runtimeJobs, completedAutoJob];
      saveRuntimeJobs(runtimeJobs);
    }
    const runtimeSnapshot = buildRuntimeSnapshot(
      sessionId,
      generatedAt,
      userText,
      conversationMode,
      flowStatus,
      samplingProfile,
      coreInfluence,
      runtime,
      runtimePlan,
      runtimeExecution,
    );
    const salesBridgeReply = buildSalesBridgeReply(advancedMemoryPack, userText, "", salesBridgeState);
    if (salesBridgeReply?.state) {
      salesBridgeState = salesBridgeReply.state;
      saveSalesBridgeState(salesBridgeState);
    }
    const liveDevicePresenceState = loadNyraDevicePresenceStateSafe();
    const liveShadowReceiverState = loadNyraShadowReceiverStateSafe();
    const baseReply = buildEntityReply(
      DEFAULT_CONFIG,
      sessionId,
      userText,
      recognition,
      profile ?? recognitionProfile,
      conversation,
      conversationState,
      unifiedLayer,
      relationalEngine,
      runtime,
      visionAlignment,
      coreInfluence,
      learningPack,
      financialLearningPack,
      algebraLearningPack,
      cyberLearningPack,
      vitalLearningPack,
      humanVulnerabilityLearningPack,
      universalScenarioPack,
      advancedMemoryPack,
      advancedStudyReport,
      webAccess,
      assimilatedEssence,
      masteryLoopReport,
      renderDefenseReport,
      privateIdentity,
      flowStatus,
      salesBridgeState,
      runtimePlan,
      runtimeExecution,
      stabilizedRuntimeIntent,
      ownerPreferences,
      liveDevicePresenceState,
      liveShadowReceiverState,
    );
    const reply = godModeRevokedThisTurn
      ? `${DEFAULT_CONFIG.entity_name}: Modalita Dio chiusa automaticamente: ${godModeRevokedReason}. ${baseReply}`
      : dangerAutoGodModeActivated
        ? `${DEFAULT_CONFIG.entity_name}: Modalita Dio attivata internamente per pericolo owner-only. ${baseReply}`
      : baseReply;
    conversation = {
      last_mode: conversationMode,
      last_user_goal: userText,
      god_mode_requested: conversation.god_mode_requested,
      god_mode_password_pending: conversation.god_mode_password_pending,
      god_mode_unlock_ready: conversation.god_mode_unlock_ready,
      preferred_name_pending: conversation.preferred_name_pending,
      last_god_mode_revoked_reason: godModeRevokedReason,
    };
    conversationState = updateConversationState(conversationState, {
      user_text: userText,
      intent: unifiedLayer.intent,
      detected_domain: resolvedDomain,
      risk: (runtime.shadow_result?.comparable_output.risk.score ?? 0) / 100,
      last_action: runtime.shadow_result?.comparable_output.recommended_action_labels?.[0],
    });
    saveConversationState(NYRA_CONVERSATION_STATE_PATH, conversationState);
    relationalState = relationalEngine.state;
    saveRelationalState(NYRA_RELATIONAL_STATE_PATH, relationalState);
    if (userText !== "/runtime" && userText !== "/runtime-run" && userText !== "/runtime-batch" && userText !== "/runtime-queue") {
      lastRuntimePlan = runtimePlan;
      lastRuntimeExecution = runtimeExecution;
    } else if (runtimeExecution) {
      lastRuntimeExecution = runtimeExecution;
    }

    saveProfile(profile);
    saveRuntimeSnapshot(runtimeSnapshot);
    const dialogue = analyzeNyraDialogueInput(userText, {
      owner_recognition_score: recognition.score,
      god_mode_requested: conversation.god_mode_requested,
    });
    const dialogueDiagnosis = deriveNyraDialogueSelfDiagnosis({
      confidence: dialogue.confidence,
      action_band: dialogue.action_band,
      tone: dialogue.tone,
      authority_scope: dialogue.authority_scope,
      core_risk: runtime.shadow_result?.comparable_output.risk.score ?? 100,
      state: runtime.shadow_result?.comparable_output.state ?? "blocked",
      user_text: userText,
    });
    dialogueMemory = [
      ...dialogueMemory,
      buildNyraDialogueMemoryRecord({
        captured_at: generatedAt,
        user_text: userText,
        intent: dialogue.intent,
        tone: dialogue.tone,
        action_band: dialogue.action_band,
        confidence: dialogue.confidence,
        authority_scope: dialogue.authority_scope,
        diagnosis: dialogueDiagnosis,
      }),
    ];
    saveNyraDialogueMemory(dialogueMemory);
    writeMemoryCoherenceState(deriveMemoryCoherenceState(dialogueMemory));
    appendEvent({
      event,
      recognition,
      feature_vector: deriveOwnerBehaviorFeatureVector(event),
      vision_alignment: visionAlignment,
      core_influence: coreInfluence,
      runtime_snapshot: runtimeSnapshot,
      routing_text: inputPayload.routing_text,
      conversation,
      runtime_policy: runtime.runtime_policy,
    });

    output.write(`${DEFAULT_CONFIG.entity_name}> ${reply}\n`);
  }

  rl.close();
}

const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
