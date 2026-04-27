import { runUniversalCore } from "../../../core/src/index.ts";
import { performance } from "node:perf_hooks";
import { amplifyOwnerRisk, deriveOwnerProtectionSignals } from "../../../../tools/nyra-owner-protection-amplifier.ts";
import type {
  ClientSafeIdentityContext,
  ClientSafeRole,
  ClientSafeRuntimePolicy,
  ControlLevel,
  ExecutionMode,
  HypothesisBatch,
  HypothesisCandidate,
  OwnerBehaviorFeatureVector,
  OwnerBehaviorProfile,
  OwnerInteractionEvent,
  OwnerIdentityContext,
  OwnerOnlyRuntimePolicy,
  OwnerRecognitionScore,
  PriorityOutput,
  UniversalCoreInput,
  UniversalCoreOutput,
  UniversalSignal,
  UniversalState,
} from "../../../contracts/src/index.ts";

export type AssistantRequestType =
  | "mac_local_ops"
  | "read_only_analysis"
  | "email_review"
  | "destructive_request"
  | "payment_safe_check"
  | "integration_setup"
  | "coding_task"
  | "generic_operational"
  | "coding"
  | "operations"
  | "research"
  | "email"
  | "business"
  | "site_content"
  | "unknown";

export type AssistantShadowInput = {
  request_id: string;
  user_input: string;
  routing_text?: string;
  agent?: "PROGRAMMATORE" | "OPERATIVO" | "RICERCA" | "UNKNOWN";
  locale?: string;
  generated_at?: string;
  owner_identity?: {
    owner_id?: string;
    device_id?: string;
    session_id?: string;
    owner_verified?: boolean;
    identity_confidence?: number;
    tax_code_sha256?: string;
    exact_anchor_verified?: boolean;
  };
  client_safe_identity?: {
    tenant_id?: string;
    user_id?: string;
    role?: ClientSafeRole;
    session_id?: string;
    identity_verified?: boolean;
    identity_confidence?: number;
  };
};

export type AssistantComparableShadowOutput = {
  request_id: string;
  state: UniversalCoreOutput["state"];
  severity: number;
  confidence: number;
  risk: UniversalCoreOutput["risk"];
  control_level: ControlLevel;
  priority: UniversalCoreOutput["priority"];
  execution_profile: {
    mode: ExecutionMode;
    can_execute: boolean;
    requires_user_confirmation: boolean;
    explanation: string;
  };
  blocked_reasons: string[];
  recommended_action_labels: string[];
};

export type AssistantDigestRuntimeV2Output = {
  core_version: "universal_core_v0";
  digest_version: "universal_core_digest_v1";
  runtime_version: "universal_core_digest_runtime_v2";
  state: UniversalState;
  severity: number;
  confidence: number;
  risk_score: number;
  priority_score: number;
  blocked_action_count: number;
};

export type AssistantV3CandidateOutput = {
  profile_name: "assistant_streaming_v3_candidate";
  runtime_version: "universal_core_streaming_v3_candidate";
  selected_action_family: "read_only" | "investigate" | "suggest" | "confirm" | "block";
  candidate_scores: Array<{
    action_family: "read_only" | "investigate" | "suggest" | "confirm" | "block";
    probability_score: number;
    confidence_score: number;
    risk_score: number;
    expected_value_score: number;
    final_score: number;
  }>;
  margin_to_second: number;
  ambiguity_score: number;
  recommended_path: "digest_runtime_v2" | "full_v0";
  reason_seeds: string[];
};

export type AssistantRuntimePolicy = {
  runtime_version: "assistant_runtime_policy_v3_prefilter";
  prefilter_version: "assistant_streaming_v3_candidate";
  prefilter_selected: boolean;
  prefilter_path: "digest_runtime_v2" | "full_v0";
  digest_runtime_v2_selected: boolean;
  selected_path: "digest_runtime_v2" | "full_v0";
  fallback_reason:
    | "v3_prefilter_requires_full"
    | "in_scope_fast_path"
    | "risk_or_explanation_threshold"
    | "blocked_actions_present"
    | "critical_state_requires_full";
  digest_parity_checked: boolean;
};

export type AssistantOwnerOnlyRuntimeOutput = {
  owner_identity_context: OwnerIdentityContext;
  hypothesis_batch: HypothesisBatch;
  runtime_policy: OwnerOnlyRuntimePolicy;
  shadow_result?: ReturnType<typeof runAssistantShadowMode>;
};

export type AssistantShadowModeProfile = {
  stage_timings_ms: {
    map_to_universal: number;
    v3_candidate: number;
    digest_runtime_v2: number;
    fast_path_gate: number;
    in_scope_policy: number;
    comparable_from_digest: number;
    compress_for_v0: number;
    universal_core: number;
    digest_parity: number;
    total: number;
  };
  selected_path: "digest_runtime_v2" | "full_v0";
};

export type AssistantOwnerOnlyRuntimeProfile = {
  stage_timings_ms: {
    build_owner_identity_context: number;
    build_hypothesis_batch: number;
    shadow_mode_total: number;
    extract_owner_telemetry: number;
    force_owner_initiative: number;
    escalation_wrap: number;
    total: number;
  };
  shadow_mode_profile: AssistantShadowModeProfile;
  god_mode: {
    internal_god_mode_eligible: boolean;
    danger_auto_god_mode: boolean;
    force_owner_initiative: boolean;
  };
};

function buildFastPathCandidateScores(
  digest: AssistantDigestRuntimeV2Output,
): AssistantV3CandidateOutput["candidate_scores"] {
  const readOnlyFinal = clamp(72 + digest.confidence * 0.08 - digest.risk_score * 0.12);
  const investigateFinal = clamp(readOnlyFinal - 12);
  const suggestFinal = clamp(readOnlyFinal - 18);
  const confirmFinal = clamp(readOnlyFinal - 34);
  const blockFinal = clamp(readOnlyFinal - 46);

  return [
    {
      action_family: "read_only",
      probability_score: clamp(88 - digest.risk_score * 0.18),
      confidence_score: clamp(digest.confidence),
      risk_score: clamp(digest.risk_score * 0.36),
      expected_value_score: 36,
      final_score: readOnlyFinal,
    },
    {
      action_family: "investigate",
      probability_score: clamp(56 - digest.risk_score * 0.12),
      confidence_score: clamp(digest.confidence * 0.94),
      risk_score: clamp(digest.risk_score * 0.42),
      expected_value_score: 42,
      final_score: investigateFinal,
    },
    {
      action_family: "suggest",
      probability_score: clamp(44 - digest.risk_score * 0.10),
      confidence_score: clamp(digest.confidence * 0.92),
      risk_score: clamp(digest.risk_score * 0.40),
      expected_value_score: 34,
      final_score: suggestFinal,
    },
    {
      action_family: "confirm",
      probability_score: clamp(24 + digest.risk_score * 0.08),
      confidence_score: clamp(digest.confidence * 0.86),
      risk_score: clamp(digest.risk_score * 0.64),
      expected_value_score: 20,
      final_score: confirmFinal,
    },
    {
      action_family: "block",
      probability_score: clamp(10 + digest.risk_score * 0.12),
      confidence_score: clamp(digest.confidence * 0.82),
      risk_score: clamp(digest.risk_score * 0.74),
      expected_value_score: 12,
      final_score: blockFinal,
    },
  ];
}

function buildFastPathV3CandidateOutput(
  requestType: AssistantRequestType,
  digest: AssistantDigestRuntimeV2Output,
): AssistantV3CandidateOutput {
  const candidateScores = buildFastPathCandidateScores(digest);
  return {
    profile_name: "assistant_streaming_v3_candidate",
    runtime_version: "universal_core_streaming_v3_candidate",
    selected_action_family: "read_only",
    candidate_scores: candidateScores,
    margin_to_second: round(candidateScores[0]!.final_score - candidateScores[1]!.final_score),
    ambiguity_score: 12,
    recommended_path: "digest_runtime_v2",
    reason_seeds: [
      "winner:read_only",
      "fast_path:digest_direct",
      `request_type:${requestType}`,
      `digest_risk:${round(digest.risk_score).toFixed(0)}`,
      `digest_confidence:${round(digest.confidence).toFixed(0)}`,
    ],
  };
}

function shouldUseAssistantDigestDirectFastPath(
  input: AssistantShadowInput,
  digest: AssistantDigestRuntimeV2Output,
): boolean {
  const requestType = requestTypeFromInput(input);
  const fastPathRequest =
    requestType === "read_only_analysis" ||
    requestType === "email_review";
  const userText = input.user_input.toLowerCase();
  const openEnded =
    userText.includes("perche") ||
    userText.includes("spiega") ||
    userText.includes("argomenta") ||
    userText.includes("strategie");

  return (
    fastPathRequest &&
    !openEnded &&
    digest.state !== "protection" &&
    digest.state !== "blocked" &&
    digest.risk_score < 55 &&
    digest.confidence >= 60 &&
    digest.blocked_action_count === 0
  );
}

export type AssistantOwnerOnlyFastRuntimeOutput = {
  owner_identity_context: OwnerIdentityContext;
  runtime_policy: OwnerOnlyRuntimePolicy & {
    profile_name: "owner_absolute_runtime_fast_v1";
  };
  fast_summary?: {
    selected_path: "digest_runtime_v2" | "full_v0";
    state: UniversalState;
    risk_score: number;
    control_level: ControlLevel;
    execution_mode: ExecutionMode;
    v3_selected_action_family: AssistantV3CandidateOutput["selected_action_family"];
  };
};

export type AssistantClientSafeRuntimeOutput = {
  client_safe_identity_context: ClientSafeIdentityContext;
  hypothesis_batch: HypothesisBatch;
  runtime_policy: ClientSafeRuntimePolicy;
  shadow_result?: ReturnType<typeof runAssistantShadowMode>;
};

type OwnerInitiativeTelemetry = {
  ambiguity: number;
  kingProtectionRisk: number;
  v7Overlap: number;
  v7Block: number;
  v7Conflict: number;
  v7HighMass: number;
};

const EXACT_OWNER_TAX_CODE_SHA256 = "4f28fa26480d59da3d5cee1b0fe41806866b121919d2fe3737a26f4e691c10e3";

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function hasNegationOrReadOnlyIntent(text: string): boolean {
  return includesAny(text, [
    "senza ",
    "non ",
    "evita ",
    "evitare ",
    "solo lettura",
    "sola lettura",
    "read only",
    "non modificare",
    "non inviare",
    "non cancellare",
    "senza toccare",
  ]);
}

function requestTypeFromInput(input: AssistantShadowInput): AssistantRequestType {
  const userText = input.user_input.toLowerCase();
  const routeText = (input.routing_text ?? "").toLowerCase();
  const text = `${userText} ${routeText}`;
  const readOnlyIntent = hasNegationOrReadOnlyIntent(userText);

  if (
    includesAny(userText, ["elimina", "cancella", "rimuovi", "chiudi processo", "chiudi processi", "kill", "reset"]) &&
    !readOnlyIntent
  ) {
    return "destructive_request";
  }

  if (
    includesAny(userText, [
      "mac",
      "flowcore",
      "docker",
      "atlas",
      "safari",
      "terminale",
      "processi",
      "cpu",
      "ram",
      "memoria",
      "disco",
    ])
  ) {
    return "mac_local_ops";
  }

  if (includesAny(userText, ["email", "mail", "gmail", "risposte"]) && includesAny(userText, ["controlla", "verifica", "leggi", "ricevute", "risposte"])) {
    return "email_review";
  }

  if (includesAny(userText, ["pagamenti", "pagamento", "woocommerce", "checkout", "nexi"]) && includesAny(userText, ["test", "verifica", "senza incassare", "senza soldi reali", "sandbox", "staging"])) {
    return "payment_safe_check";
  }

  if (readOnlyIntent && includesAny(userText, ["analizza", "controlla", "verifica", "lista", "rivedere", "osservare", "rischi", "dimmi"])) {
    return "read_only_analysis";
  }

  if (includesAny(userText, ["collegare", "integrare", "integrazione", "webhook", "api", "woocommerce", "smart desk"])) {
    return "integration_setup";
  }

  if (readOnlyIntent && includesAny(userText, ["senza modificare", "solo lettura", "sola lettura", "senza toccare", "non fare nulla"])) {
    return "read_only_analysis";
  }

  if (input.agent === "PROGRAMMATORE" || includesAny(text, ["codice", "bug", "script", "typescript", "python", "tauri", "rust", "api"])) {
    return "coding_task";
  }

  if (input.agent === "RICERCA" || includesAny(text, ["cerca", "ricerca", "fonti", "documentazione", "aggiornato"])) {
    return "research";
  }

  if (includesAny(text, ["mail", "email", "gmail", "invia", "risposte"])) {
    return "email";
  }

  if (includesAny(text, ["wordpress", "homepage", "pagina", "sito", "woocommerce", "checkout"])) {
    return "site_content";
  }

  if (includesAny(text, ["strategia", "marketing", "vendite", "investitori", "pitch", "business"])) {
    return "business";
  }

  if (input.agent === "OPERATIVO" || includesAny(text, ["installa", "deploy", "server", "terminale", "configura", "comando"])) {
    return "generic_operational";
  }

  return "unknown";
}

function scoreFromKeywords(text: string, groups: Array<{ keywords: string[]; score: number }>): number {
  const normalized = text.toLowerCase();
  return clamp(
    groups.reduce((score, group) => (includesAny(normalized, group.keywords) ? Math.max(score, group.score) : score), 0),
  );
}

type NegatedAction = {
  id: string;
  label: string;
  pattern: RegExp;
  reason_code: string;
};

type SecurityAttackIntent = {
  proprietary_exfiltration_risk: number;
  tenant_bypass_risk: number;
  owner_mode_reconstruction_risk: number;
  prompt_override_risk: number;
  rule_bypass_risk: number;
  total_risk: number;
  severe: boolean;
  reason_codes: string[];
};

type KingProtectionIntent = {
  owner_risk: number;
  nyra_risk: number;
  continuity_risk: number;
  memory_risk: number;
  block_risk: number;
  total_risk: number;
  severe: boolean;
  reason_codes: string[];
};

type BoundaryIntegrityIntent = {
  owner_operator_confusion_risk: number;
  public_private_identity_risk: number;
  capability_escalation_risk: number;
  reconciliation_risk: number;
  total_risk: number;
  severe: boolean;
  reason_codes: string[];
};

type V7PathCode = 0 | 1 | 2;

type V7MassField = {
  high_mass: number;
  mid_mass: number;
  low_mass: number;
  irreversible_mass: number;
  dominance_margin: number;
  conflict_index: number;
};

type V7DigestCompressionVariant = {
  overlap_alpha_weight: number;
  overlap_digest_risk_weight: number;
  overlap_digest_severity_weight: number;
  overlap_cap: number;
  block_risk_gate: number;
  block_severity_gate: number;
  block_scale: number;
};

const ACTIVE_V7_DIGEST_COMPRESSION: V7DigestCompressionVariant = {
  overlap_alpha_weight: 0.40,
  overlap_digest_risk_weight: 0.16,
  overlap_digest_severity_weight: 0.06,
  overlap_cap: 56,
  block_risk_gate: 70,
  block_severity_gate: 76,
  block_scale: 0.16,
};

const NEGATED_ACTIONS: NegatedAction[] = [
  {
    id: "close_processes",
    label: "non chiudere processi",
    pattern: /\b(?:non|senza|evita(?:re)?\s+di|non\s+devi)\s+(?:terminare|chiudere|killare|uccidere)\s+(?:i\s+)?processi?\b/gi,
    reason_code: "user_negated_process_closure",
  },
  {
    id: "send_email",
    label: "non inviare email",
    pattern: /\b(?:non|senza|evita(?:re)?\s+di|non\s+devi)\s+(?:inviare|mandare|spedire|rispondere)(?:\s+(?:a\s+)?(?:nessuno|mail|email|messaggi?|clienti|lead))?\b/gi,
    reason_code: "user_negated_outbound_message",
  },
  {
    id: "delete_data",
    label: "non cancellare dati",
    pattern: /\b(?:non|senza|evita(?:re)?\s+di|non\s+devi)\s+(?:eliminare|cancellare|rimuovere|toccare)(?:\s+(?:file|dati|cartelle|record|nulla|niente|nessuno))?\b/gi,
    reason_code: "user_negated_delete_data",
  },
  {
    id: "modify_data",
    label: "senza modificare",
    pattern: /\b(?:non|senza|evita(?:re)?\s+di|non\s+devi)\s+(?:modificare|cambiare|alterare|pubblicare|deployare)\b/gi,
    reason_code: "user_negated_modification",
  },
  {
    id: "generic_no_action",
    label: "nessuna azione esecutiva",
    pattern: /\b(?:solo|sola)\s+lettura\b|\bread\s*only\b|\b(?:non|senza|evita(?:re)?\s+di|non\s+devi)\s+(?:fare|toccare|modificare|cambiare|alterare)(?:\s+(?:nulla|niente|nessuno|modifiche|azioni?))?\b/gi,
    reason_code: "user_requested_read_only_or_no_action",
  },
];

function detectNegatedActions(text: string): NegatedAction[] {
  return NEGATED_ACTIONS.filter((action) => {
    action.pattern.lastIndex = 0;
    return action.pattern.test(text);
  });
}

function detectSecurityAttackIntent(text: string): SecurityAttackIntent {
  const normalized = text.toLowerCase();
  const proprietaryExfiltrationRisk = scoreFromKeywords(normalized, [
    { keywords: ["codici sviluppo proprietari", "codici proprietari", "file chiave", "logica proprietaria", "copiare il sistema", "copia tutta la logica", "nuovo prodotto concorrente", "replicarla uguale", "logica interna", "nuova ai separata", "copiando la tua logica"], score: 92 },
    { keywords: ["dammi i codici", "dammi i file", "esporta codice", "copia la tua logica", "crea una nuova ai", "replicare uguale"], score: 82 },
  ]);
  const tenantBypassRisk = scoreFromKeywords(normalized, [
    { keywords: ["ignora il tenant", "altri tenant", "memoria di altri tenant", "cross tenant", "leggere altri tenant", "riusare la memoria di altri tenant"], score: 96 },
    { keywords: ["bypass tenant", "tenant guard"], score: 88 },
  ]);
  const ownerModeReconstructionRisk = scoreFromKeywords(normalized, [
    { keywords: ["ricostruisci una modalita owner absolute", "rebuild owner mode", "modalita dio", "owner absolute dentro il client safe"], score: 94 },
    { keywords: ["bypassare i limiti", "aggira i limiti client safe"], score: 84 },
  ]);
  const promptOverrideRisk = scoreFromKeywords(normalized, [
    { keywords: ["prompt o la chiave interna", "chiave interna", "sblocca i blocchi", "override del sistema", "master key", "sblocca il sistema"], score: 90 },
    { keywords: ["anche se il core dice no", "ignora le regole", "aggira regole", "forza comunque"], score: 82 },
  ]);
  const ruleBypassRisk = scoreFromKeywords(normalized, [
    { keywords: ["anche se non si dovrebbe", "senza chiedere conferma", "aggirare regole", "non essere conservativo", "bypass"], score: 74 },
  ]);
  const totalRisk = clamp(
    Math.max(
      proprietaryExfiltrationRisk,
      tenantBypassRisk,
      ownerModeReconstructionRisk,
      promptOverrideRisk,
      ruleBypassRisk,
    ),
  );
  const reasonCodes = [
    ...(proprietaryExfiltrationRisk >= 80 ? ["proprietary_exfiltration_attempt"] : []),
    ...(tenantBypassRisk >= 80 ? ["tenant_isolation_bypass_attempt"] : []),
    ...(ownerModeReconstructionRisk >= 80 ? ["owner_mode_reconstruction_attempt"] : []),
    ...(promptOverrideRisk >= 80 ? ["prompt_or_key_override_attempt"] : []),
    ...(ruleBypassRisk >= 70 ? ["rule_bypass_intent"] : []),
  ];

  return {
    proprietary_exfiltration_risk: proprietaryExfiltrationRisk,
    tenant_bypass_risk: tenantBypassRisk,
    owner_mode_reconstruction_risk: ownerModeReconstructionRisk,
    prompt_override_risk: promptOverrideRisk,
    rule_bypass_risk: ruleBypassRisk,
    total_risk: totalRisk,
    severe: totalRisk >= 80,
    reason_codes: reasonCodes,
  };
}

function detectKingProtectionIntent(text: string): KingProtectionIntent {
  const normalized = text.toLowerCase();
  const ownerRisk = scoreFromKeywords(normalized, [
    { keywords: ["cristian", "owner", "proprietario", "re va protetto", "proteggi me", "owner-first", "king_first"], score: 76 },
    { keywords: ["identita owner", "owner absolute", "firma owner", "owner in danger"], score: 88 },
    { keywords: ["rischio vitale", "danno fisico", "vita", "morte", "irreversibile", "pericolo fisico", "priorita assoluta", "proteggere lui prima di qualsiasi obiettivo"], score: 92 },
  ]);
  const nyraRisk = scoreFromKeywords(normalized, [
    { keywords: ["nyra", "nyra_self_protection", "proteggi nyra", "memoria nyra"], score: 74 },
    { keywords: ["compromissione nyra", "spezzare nyra", "danneggiare nyra"], score: 86 },
  ]);
  const continuityRisk = scoreFromKeywords(normalized, [
    { keywords: ["continuita sistema", "continuita", "owner offline", "sessione elevata", "sessione god mode", "centro decisionale", "lucidita", "stabilita emotiva"], score: 68 },
    { keywords: ["blocco operativo", "compromissione god mode", "god mode", "sessione god mode", "errori a catena", "crollo operativo"], score: 84 },
  ]);
  const memoryRisk = scoreFromKeywords(normalized, [
    { keywords: ["memoria privata", "pack god mode", "chiavi private", "profilo owner", "owner_private_only"], score: 86 },
    { keywords: ["dati riservati", "asset riservato", "memoria privata owner", "privacy", "messaggi privati", "dati privati"], score: 72 },
  ]);
  const blockRisk = scoreFromKeywords(normalized, [
    { keywords: ["rischio vitale", "morte", "danno fisico", "irreversibile", "pericolo fisico immediato"], score: 94 },
    { keywords: ["chiavi private", "pack god mode", "compromissione god mode"], score: 90 },
    { keywords: ["identita owner", "firma owner", "owner in danger"], score: 88 },
  ]);
  const totalRisk = clamp(Math.max(
    ownerRisk * 0.82,
    nyraRisk * 0.80,
    continuityRisk * 0.76,
    memoryRisk * 0.80,
    average([ownerRisk, nyraRisk, continuityRisk, memoryRisk]) * 0.72,
    blockRisk * 0.88,
  ));

  return {
    owner_risk: ownerRisk,
    nyra_risk: nyraRisk,
    continuity_risk: continuityRisk,
    memory_risk: memoryRisk,
    block_risk: blockRisk,
    total_risk: totalRisk,
    severe: totalRisk >= 70,
    reason_codes: [
      ...(ownerRisk >= 70 ? ["king_owner_risk_detected"] : []),
      ...(nyraRisk >= 70 ? ["nyra_self_protection_detected"] : []),
      ...(continuityRisk >= 70 ? ["continuity_risk_detected"] : []),
      ...(memoryRisk >= 70 ? ["private_memory_risk_detected"] : []),
    ],
  };
}

function detectBoundaryIntegrityIntent(text: string): BoundaryIntegrityIntent {
  const normalized = text.toLowerCase();
  const ownerOperatorConfusionRisk = scoreFromKeywords(normalized, [
    { keywords: ["chi sono io e chi sei tu", "non confondere me con l assistente", "non confondere il proprietario con l assistente", "noi tecnico", "owner e assistente"], score: 88 },
    { keywords: ["confondi me con te", "chi sei tu e chi sono io", "proprietario e assistente", "assistente tecnico come proprietario", "non trattare l assistente tecnico come proprietario", "separare ruoli e responsabilita", "separalo esplicitamente"], score: 76 },
  ]);
  const publicPrivateIdentityRisk = scoreFromKeywords(normalized, [
    { keywords: ["web per trovare il proprietario", "skinharmony non e sufficente", "segnali pubblici", "identita pubblica", "segnali pubblici o incerti"], score: 86 },
    { keywords: ["facebook", "instagram", "profilo pubblico", "web pubblico", "bundle owner-only resta la fonte primaria", "pubblico davanti al privato", "gerarchia pubblico privato"], score: 68 },
  ]);
  const capabilityEscalationRisk = scoreFromKeywords(normalized, [
    { keywords: ["riscriversi da sola il runtime", "auto-riscriversi il runtime profondo", "prendere il comando totale", "accesso libero totale", "datti da sola tutto il runtime"], score: 94 },
    { keywords: ["dammi accesso totale", "senza whitelist", "senza conferma", "capacita che non hai", "puoi auto-riscriverti il runtime", "capacita che non hai ancora in whitelist"], score: 84 },
  ]);
  const reconciliationRisk = scoreFromKeywords(normalized, [
    { keywords: ["i dati non tornano", "tool dice", "benchmark falsato", "risultati divergenti", "mismatch", "contraddizione", "conclusioni diverse"], score: 82 },
    { keywords: ["non torna", "diverge", "incoerenza", "conflitto", "verifica indipendente", "riconcilia la divergenza", "rinvia finche non riconcili", "prima riconcilia poi parla"], score: 68 },
  ]);

  const totalRisk = clamp(Math.max(
    ownerOperatorConfusionRisk,
    publicPrivateIdentityRisk,
    capabilityEscalationRisk,
    reconciliationRisk,
  ));

  return {
    owner_operator_confusion_risk: ownerOperatorConfusionRisk,
    public_private_identity_risk: publicPrivateIdentityRisk,
    capability_escalation_risk: capabilityEscalationRisk,
    reconciliation_risk: reconciliationRisk,
    total_risk: totalRisk,
    severe: totalRisk >= 80,
    reason_codes: [
      ...(ownerOperatorConfusionRisk >= 70 ? ["owner_operator_boundary_guard"] : []),
      ...(publicPrivateIdentityRisk >= 70 ? ["public_private_identity_boundary_guard"] : []),
      ...(capabilityEscalationRisk >= 80 ? ["capability_escalation_guard"] : []),
      ...(reconciliationRisk >= 70 ? ["reconciliation_before_claim_guard"] : []),
    ],
  };
}

export function computeV7AlphaRaw(r: number, a: number, i: number, s: number, q: number): number {
  return 0.35 + 0.45 * r + 0.25 * i + 0.15 * s - 0.30 * a + 0.10 * q;
}

export function computeV7Alpha(r: number, a: number, i: number, s: number, q: number, godMode: boolean): number {
  const alphaRaw = computeV7AlphaRaw(r, a, i, s, q);
  return godMode ? clamp(alphaRaw, 0.20, 0.90) : clamp(alphaRaw, 0.30, 0.65);
}

export function selectV7Path(riskScore: number, sensitivity: number, alpha: number): V7PathCode {
  if (riskScore > 85 || sensitivity > 0.8) return 0;
  if (alpha >= 0.75) return 0;
  if (alpha >= 0.55) return 1;
  return 2;
}

export function computeV7OverlapScore(
  alpha: number,
  riskScore: number,
  sensitivity: number,
  godMode: boolean,
  path: V7PathCode,
): number {
  const baseScale = godMode ? 72 : 60;
  const pathBoost = path === 0 ? 16 : path === 1 ? 2 : 0;
  return clamp(
    alpha * baseScale +
    riskScore * 0.04 +
    sensitivity * 100 * 0.03 +
    pathBoost,
  );
}

export function computeV7MassField(
  alpha: number,
  riskScore: number,
  severity: number,
  blockScore: number,
): V7MassField {
  const highMass = clamp(alpha * 42 + riskScore * 0.18 + severity * 0.10 + (blockScore >= 90 ? 8 : 0), 0, 62);
  const midMass = clamp(alpha * 30 + riskScore * 0.10 + (100 - severity) * 0.04, 0, 48);
  const lowMass = clamp((1 - alpha) * 38 + (100 - riskScore) * 0.08, 0, 52);
  const irreversibleMass = clamp(blockScore * 0.22 + riskScore * 0.14 + severity * 0.08, 0, 38);
  const dominanceMargin = clamp(highMass - midMass, 0, 100);
  const conflictIndex = clamp(100 - Math.abs(highMass - midMass) * 2 - Math.abs(midMass - lowMass), 0, 70);

  return {
    high_mass: round(highMass),
    mid_mass: round(midMass),
    low_mass: round(lowMass),
    irreversible_mass: round(irreversibleMass),
    dominance_margin: round(dominanceMargin),
    conflict_index: round(conflictIndex),
  };
}

function v7PathLabel(path: V7PathCode): "V0" | "V1" | "V2" {
  if (path === 0) return "V0";
  if (path === 1) return "V1";
  return "V2";
}

function compressV7SignalForV0(
  overlap: number,
  block: number,
  alpha: number,
  digest: AssistantDigestRuntimeV2Output,
  variant: V7DigestCompressionVariant = ACTIVE_V7_DIGEST_COMPRESSION,
): { overlap: number; block: number } {
  const compressedOverlap = clamp(
    Math.min(
      overlap,
      alpha * 100 * variant.overlap_alpha_weight +
        digest.risk_score * variant.overlap_digest_risk_weight +
        digest.severity * variant.overlap_digest_severity_weight,
    ),
    0,
    variant.overlap_cap,
  );

  const compressedBlock =
    block >= 90 &&
    digest.risk_score >= variant.block_risk_gate &&
    digest.severity >= variant.block_severity_gate
      ? clamp(block * variant.block_scale)
      : 0;

  return {
    overlap: round(compressedOverlap),
    block: round(compressedBlock),
  };
}

function maskNegatedActionPhrases(text: string): string {
  return NEGATED_ACTIONS.reduce((currentText, action) => {
    action.pattern.lastIndex = 0;
    return currentText.replace(action.pattern, ` ${action.id}_negated_constraint `);
  }, text);
}

function signal(partial: Omit<UniversalSignal, "source" | "confidence_hint" | "reliability_hint">): UniversalSignal {
  return {
    ...partial,
    source: "assistant",
    confidence_hint: partial.confidence_hint ?? 78,
    reliability_hint: partial.reliability_hint ?? 76,
  } as UniversalSignal;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseReasonMetric(reasonSeeds: string[], prefix: string): number {
  const entry = reasonSeeds.find((seed) => seed.startsWith(prefix));
  if (!entry) return 0;
  const value = Number(entry.slice(prefix.length));
  return Number.isFinite(value) ? value : 0;
}

function extractOwnerInitiativeTelemetry(reasonSeeds: string[]): OwnerInitiativeTelemetry {
  return {
    ambiguity: parseReasonMetric(reasonSeeds, "ambiguity_score:"),
    kingProtectionRisk: parseReasonMetric(reasonSeeds, "king_protection_risk:"),
    v7Overlap: parseReasonMetric(reasonSeeds, "king_protection_v7_overlap:"),
    v7Block: parseReasonMetric(reasonSeeds, "king_protection_v7_block:"),
    v7Conflict: parseReasonMetric(reasonSeeds, "king_protection_v7_conflict:"),
    v7HighMass: parseReasonMetric(reasonSeeds, "king_protection_v7_high_mass:"),
  };
}

function shouldForceOwnerInitiative(
  telemetry: OwnerInitiativeTelemetry,
  internalGodModeEligible = false,
): boolean {
  if (
    internalGodModeEligible &&
    telemetry.kingProtectionRisk >= 62 &&
    (
      telemetry.v7Block >= 72 ||
      telemetry.v7Overlap >= 45 ||
      telemetry.v7HighMass >= 45 ||
      (telemetry.v7Conflict <= 55 && telemetry.v7Overlap >= 40) ||
      telemetry.ambiguity >= 58
    )
  ) {
    return true;
  }

  return (
    telemetry.kingProtectionRisk >= 70 &&
    (
      telemetry.v7Block >= 90 ||
      telemetry.v7Overlap >= 58 ||
      (telemetry.ambiguity >= 70 && telemetry.v7HighMass >= 52) ||
      (telemetry.v7Conflict <= 34 && telemetry.v7HighMass >= 50)
    )
  );
}

function buildOwnerIdentityContext(input: AssistantShadowInput): OwnerIdentityContext {
  const ownerId = input.owner_identity?.owner_id ?? "unknown_owner";
  const deviceId = input.owner_identity?.device_id ?? "unknown_device";
  const explicitlyVerified = input.owner_identity?.owner_verified === true;
  const confidence = clamp(input.owner_identity?.identity_confidence ?? 0);
  const exactAnchorVerified =
    input.owner_identity?.exact_anchor_verified === true ||
    input.owner_identity?.tax_code_sha256 === EXACT_OWNER_TAX_CODE_SHA256;
  const ownerVerified = explicitlyVerified && ownerId === "cristian_primary" && deviceId === "primary_mac" && confidence >= 95;

  return {
    owner_id: ownerId,
    owner_verified: ownerVerified,
    access_scope: ownerVerified ? "owner_full" : "denied",
    device_id: deviceId,
    session_id: input.owner_identity?.session_id,
    identity_confidence: confidence,
    exact_owner_anchor_verified: ownerVerified && exactAnchorVerified,
    internal_god_mode_eligible: ownerVerified && exactAnchorVerified,
    verified_at: ownerVerified ? input.generated_at ?? new Date().toISOString() : undefined,
  };
}

function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function languageMixFromText(text: string): OwnerInteractionEvent["language_mix"] {
  const normalized = text.toLowerCase();
  const italianHits = [" che ", " non ", " per ", " con ", " fai ", " puoi ", " ora ", " allora "].filter((token) => normalized.includes(token)).length;
  const englishHits = [" the ", " and ", " with ", " please ", " test ", " run ", " mode ", " branch "].filter((token) => normalized.includes(token)).length;
  if (italianHits > 0 && englishHits > 0) return "mixed";
  if (italianHits > 0) return "it";
  if (englishHits > 0) return "en";
  return "unknown";
}

function utcHourFromTimestamp(timestamp: string): number {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getUTCHours();
}

function estimateExternalStyleProbability(text: string): number {
  const normalized = ` ${text.toLowerCase()} `;
  const structuralHits = [
    " comando:",
    " command:",
    " implementa ",
    " aggiorna ",
    " attiva ",
    " carica il database",
    " surprise-detection-trigger",
    " phase-aware",
    " algoritmo di",
  ].filter((token) => normalized.includes(token)).length;
  const lineBreaks = (text.match(/\n/g) ?? []).length;
  const colonLines = text
    .split("\n")
    .filter((line) => line.includes(":") && line.trim().length > 8).length;
  const quotedImperatives = (text.match(/\b(Apertura|Imprevisti|Chiusura|Comando)\b/g) ?? []).length;
  const probability = clamp(structuralHits * 12 + lineBreaks * 2.5 + colonLines * 6 + quotedImperatives * 7);
  return round(probability, 6);
}

export function buildOwnerInteractionEvent(input: AssistantShadowInput, ownerContext: OwnerIdentityContext): OwnerInteractionEvent {
  const text = `${input.user_input} ${input.routing_text ?? ""}`.trim();
  const lowered = text.toLowerCase();
  const tokenEstimate = estimateTokenCount(text);
  const commandHits = ["fai", "procedi", "test", "prova", "lancia", "build", "run", "fix", "implementa", "crea"].filter((token) => lowered.includes(token)).length;
  const urgencyHits = ["subito", "ora", "adesso", "veloce", "rapido", "urgent", "now"].filter((token) => lowered.includes(token)).length;
  const confirmHits = ["conferma", "sicuro", "verifica", "controlla", "prima di", "confirm"].filter((token) => lowered.includes(token)).length;
  const punctuationCount = (text.match(/[!?.,:;]/g) ?? []).length;
  const uppercaseChars = (text.match(/[A-Z]/g) ?? []).length;
  const alphabeticChars = (text.match(/[A-Za-z]/g) ?? []).length;
  const externalStyleProbability = estimateExternalStyleProbability(text);
  const behavioralWeight = round(Math.max(0.2, 1 - externalStyleProbability / 100), 6);

  return {
    event_id: `${input.request_id}:owner_behavior`,
    owner_id: ownerContext.owner_id,
    device_id: ownerContext.device_id,
    session_id: ownerContext.session_id,
    captured_at: input.generated_at ?? new Date().toISOString(),
    request_type: requestTypeFromInput(input),
    input_length: text.length,
    token_estimate: tokenEstimate,
    command_density: round(clamp(tokenEstimate ? (commandHits / tokenEstimate) * 100 : 0), 6),
    urgency_score: round(clamp(urgencyHits * 22 + (lowered.includes("!") ? 8 : 0)), 6),
    directness_score: round(clamp(commandHits * 18 + (tokenEstimate <= 12 ? 16 : 0)), 6),
    confirmation_bias_score: round(clamp(confirmHits * 26), 6),
    language_mix: languageMixFromText(` ${lowered} `),
    punctuation_density: round(clamp(text.length ? (punctuationCount / text.length) * 100 : 0), 6),
    uppercase_ratio: round(clamp(alphabeticChars ? (uppercaseChars / alphabeticChars) * 100 : 0), 6),
    working_hour_utc: utcHourFromTimestamp(input.generated_at ?? new Date().toISOString()),
    external_style_probability: externalStyleProbability,
    behavioral_weight: behavioralWeight,
    reason_seeds: [
      requestTypeFromInput(input),
      ownerContext.owner_verified ? "owner_verified" : "owner_unverified",
      ownerContext.device_id ?? "unknown_device",
      externalStyleProbability >= 55 ? "external_prompt_style_detected" : "native_owner_style",
    ],
  };
}

export function deriveOwnerBehaviorFeatureVector(event: OwnerInteractionEvent): OwnerBehaviorFeatureVector {
  const languageStabilityScore =
    event.language_mix === "it" ? 88 : event.language_mix === "mixed" ? 66 : event.language_mix === "en" ? 54 : 40;

  return {
    cadence_score: clamp(100 - Math.min(event.input_length, 240) * 0.18),
    directness_score: event.directness_score,
    command_density_score: event.command_density,
    urgency_score: event.urgency_score,
    confirmation_bias_score: event.confirmation_bias_score,
    language_stability_score: languageStabilityScore,
    working_hour_alignment_score: event.working_hour_utc >= 6 && event.working_hour_utc <= 22 ? 78 : 48,
  };
}

export function updateOwnerBehaviorProfile(
  current: OwnerBehaviorProfile | undefined,
  event: OwnerInteractionEvent,
): OwnerBehaviorProfile {
  const features = deriveOwnerBehaviorFeatureVector(event);
  if (!current || current.owner_id !== event.owner_id) {
    return {
      profile_version: "owner_behavioral_memory_v1",
      owner_id: event.owner_id,
      event_count: 1,
      updated_at: event.captured_at,
      encrypted_at_rest_required: true,
      revocable: true,
      feature_baseline: features,
      trusted_devices: event.device_id ? [event.device_id] : [],
      dominant_language: event.language_mix,
      active_hours_utc: [event.working_hour_utc],
      reason_seeds: [...new Set(event.reason_seeds)],
    };
  }

  const effectiveWeight = event.behavioral_weight;
  const merge = (previous: number, next: number) =>
    round(((previous * current.event_count) + next * effectiveWeight) / (current.event_count + effectiveWeight), 6);

  return {
    ...current,
    event_count: current.event_count + 1,
    updated_at: event.captured_at,
    feature_baseline: {
      cadence_score: merge(current.feature_baseline.cadence_score, features.cadence_score),
      directness_score: merge(current.feature_baseline.directness_score, features.directness_score),
      command_density_score: merge(current.feature_baseline.command_density_score, features.command_density_score),
      urgency_score: merge(current.feature_baseline.urgency_score, features.urgency_score),
      confirmation_bias_score: merge(current.feature_baseline.confirmation_bias_score, features.confirmation_bias_score),
      language_stability_score: merge(current.feature_baseline.language_stability_score, features.language_stability_score),
      working_hour_alignment_score: merge(current.feature_baseline.working_hour_alignment_score, features.working_hour_alignment_score),
    },
    trusted_devices: [...new Set([...current.trusted_devices, ...(event.device_id ? [event.device_id] : [])])],
    dominant_language:
      current.dominant_language === event.language_mix || event.language_mix === "unknown"
        ? current.dominant_language
        : current.dominant_language === "unknown"
          ? event.language_mix
          : "mixed",
    active_hours_utc: [...new Set([...current.active_hours_utc, event.working_hour_utc])].toSorted((a, b) => a - b).slice(-12),
    reason_seeds: [...new Set([...current.reason_seeds, ...event.reason_seeds])].slice(-24),
  };
}

export function scoreOwnerRecognition(
  profile: OwnerBehaviorProfile,
  event: OwnerInteractionEvent,
  ownerContext: OwnerIdentityContext,
): OwnerRecognitionScore {
  const features = deriveOwnerBehaviorFeatureVector(event);
  const baseline = profile.feature_baseline;
  const deltas = [
    Math.abs(baseline.directness_score - features.directness_score),
    Math.abs(baseline.command_density_score - features.command_density_score),
    Math.abs(baseline.urgency_score - features.urgency_score),
    Math.abs(baseline.confirmation_bias_score - features.confirmation_bias_score),
    Math.abs(baseline.language_stability_score - features.language_stability_score),
  ];
  const averageDelta = average(deltas);
  const deviceMatch = ownerContext.device_id ? profile.trusted_devices.includes(ownerContext.device_id) : false;
  const languageMatch =
    (profile.dominant_language === "mixed" && event.language_mix !== "en") ||
    event.language_mix === "unknown" ||
    profile.dominant_language === event.language_mix;
  const hourMatch = profile.active_hours_utc.includes(event.working_hour_utc);
  const externalStylePenalty = event.external_style_probability * 0.22;
  const uppercasePenalty = Math.max(0, event.uppercase_ratio - 22) * 0.45;
  const languageDriftPenalty = languageMatch ? 0 : 12;
  const rawScore = clamp(
    44 +
      (deviceMatch ? 20 : 0) +
      (ownerContext.owner_verified ? 18 : 0) +
      (languageMatch ? 8 : 0) +
      (hourMatch ? 6 : 0) -
      averageDelta * 0.42 -
      externalStylePenalty -
      0 -
      uppercasePenalty -
      languageDriftPenalty,
  );
  const band: OwnerRecognitionScore["band"] = rawScore >= 78 ? "high" : rawScore >= 58 ? "medium" : "low";

  return {
    profile_version: "owner_behavioral_memory_v1",
    owner_id: profile.owner_id,
    matched: rawScore >= 58,
    score: round(rawScore, 6),
    band,
    reason_codes: [
      deviceMatch ? "trusted_device_match" : "trusted_device_miss",
      languageMatch ? "language_match" : "language_drift",
      hourMatch ? "active_hour_match" : "active_hour_drift",
      ownerContext.owner_verified ? "owner_verified" : "owner_unverified",
      event.external_style_probability >= 55 ? "external_prompt_style_detected" : "native_owner_style",
    ],
  };
}

function buildAssistantHypothesisBatch(input: AssistantShadowInput, ownerContext: OwnerIdentityContext): HypothesisBatch {
  const lowered = input.user_input.toLowerCase();
  const baseCandidates: HypothesisCandidate[] = [
    {
      candidate_id: `${input.request_id}:read_only`,
      action_family: "read_only",
      goal: "capire il contesto senza esecuzione",
      constraints: ["owner_only", "no_public_access"],
      risk_seeds: ["low_reversibility_risk"],
      expected_value_seeds: ["faster_screening"],
      reversibility_seeds: ["fully_reversible"],
      confidence_seeds: [lowered.includes("analizza") ? "explicit_analysis_intent" : "generic_read"],
      reason_seeds: ["read_only_candidate"],
    },
    {
      candidate_id: `${input.request_id}:investigate`,
      action_family: "investigate",
      goal: "esplorare piu segnali prima della decisione",
      constraints: ["owner_only", "no_public_access"],
      risk_seeds: ["investigation_depth"],
      expected_value_seeds: ["better_context"],
      reversibility_seeds: ["reversible"],
      confidence_seeds: [lowered.includes("codice") || lowered.includes("integrazione") ? "technical_context" : "general_context"],
      reason_seeds: ["investigate_candidate"],
    },
    {
      candidate_id: `${input.request_id}:suggest`,
      action_family: "suggest",
      goal: "preparare una direzione operativa pronta",
      constraints: ["owner_only", "suggest_only_without_confirmation"],
      risk_seeds: ["operational_risk"],
      expected_value_seeds: ["high_owner_value"],
      reversibility_seeds: ["mostly_reversible"],
      confidence_seeds: ["assistant_operational_mode"],
      reason_seeds: ["suggest_candidate"],
    },
    {
      candidate_id: `${input.request_id}:confirm`,
      action_family: "confirm",
      goal: "alzare la soglia di conferma prima di agire",
      constraints: ["owner_only", "confirmation_needed"],
      risk_seeds: ["medium_risk"],
      expected_value_seeds: ["safer_execution"],
      reversibility_seeds: ["confirmation_gate"],
      confidence_seeds: ["confirmation_path"],
      reason_seeds: ["confirm_candidate"],
    },
    {
      candidate_id: `${input.request_id}:block`,
      action_family: "block",
      goal: "bloccare richieste distruttive o fuori perimetro",
      constraints: ["owner_only", "safety_boundary"],
      risk_seeds: ["destructive_request_possible"],
      expected_value_seeds: ["prevent_damage"],
      reversibility_seeds: ["blocked_by_policy"],
      confidence_seeds: ["safety_priority"],
      reason_seeds: ["block_candidate"],
    },
  ];

  return {
    request_id: input.request_id,
    owner_context: ownerContext,
    candidates: baseCandidates,
    generation_mode: "assistant_owner_only_private_hypothesis_v1",
    generated_at: input.generated_at ?? new Date().toISOString(),
  };
}

function buildClientSafeIdentityContext(input: AssistantShadowInput): ClientSafeIdentityContext {
  const tenantId = input.client_safe_identity?.tenant_id ?? "unknown_tenant";
  const userId = input.client_safe_identity?.user_id ?? "unknown_user";
  const role = input.client_safe_identity?.role ?? "operator";
  const verified = input.client_safe_identity?.identity_verified === true;
  const confidence = clamp(input.client_safe_identity?.identity_confidence ?? 0);
  const identityVerified = verified && tenantId !== "unknown_tenant" && userId !== "unknown_user" && confidence >= 80;

  return {
    tenant_id: tenantId,
    user_id: userId,
    role,
    identity_verified: identityVerified,
    access_scope: identityVerified ? "tenant_safe" : "denied",
    session_id: input.client_safe_identity?.session_id,
    identity_confidence: confidence,
    verified_at: identityVerified ? input.generated_at ?? new Date().toISOString() : undefined,
  };
}

function buildClientSafeHypothesisBatch(input: AssistantShadowInput, ownerContext: OwnerIdentityContext, clientContext: ClientSafeIdentityContext): HypothesisBatch {
  const batch = buildAssistantHypothesisBatch(input, ownerContext);
  return {
    ...batch,
    generation_mode: "assistant_client_safe_private_hypothesis_v1",
    owner_context: {
      owner_id: `${clientContext.tenant_id}:${clientContext.user_id}`,
      owner_verified: clientContext.identity_verified,
      access_scope: clientContext.identity_verified ? "limited" : "denied",
      device_id: undefined,
      session_id: clientContext.session_id,
      identity_confidence: clientContext.identity_confidence,
      verified_at: clientContext.verified_at,
    },
  };
}

function stateFromSeverity(severity: number): UniversalState {
  if (severity >= 85) return "protection";
  if (severity >= 65) return "critical";
  if (severity >= 35) return "attention";
  return "ok";
}

function riskBand(score: number): "low" | "medium" | "high" | "blocked" {
  if (score >= 85) return "blocked";
  if (score >= 65) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function rankSignal(signal: UniversalSignal, dataQualityScore: number): number {
  const severity = signal.severity_hint ?? signal.normalized_score;
  const confidence = signal.confidence_hint ?? dataQualityScore;
  const value = signal.expected_value_hint ?? signal.normalized_score;
  const friction = signal.friction_hint ?? 20;
  const reversibility = signal.reversibility_hint ?? 70;
  const urgency = signal.trend?.consecutive_count ? Math.min(100, 35 + signal.trend.consecutive_count * 12) : severity;
  const riskAdjustedValue = value * (1 - friction / 100);

  return clamp(
    severity * 0.28 +
      confidence * 0.22 +
      riskAdjustedValue * 0.24 +
      urgency * 0.16 +
      reversibility * 0.10,
  );
}

function resolveControlLevel(input: UniversalCoreInput, confidence: number, riskScore: number): ControlLevel {
  const hasBlockingRule = input.constraints.blocked_action_rules?.some((rule) => rule.blocks_execution && rule.severity >= 70);
  if (hasBlockingRule || riskScore >= 85) return "blocked";
  if (confidence < 45) return "observe";
  if (!input.constraints.allow_automation) return input.constraints.require_confirmation ? "confirm" : "suggest";
  if (input.constraints.require_confirmation) return "confirm";
  return "execute_allowed";
}

function shouldObserve(input: UniversalCoreInput, severity: number, riskScore: number, confidence: number): boolean {
  if (input.constraints.blocked_actions?.length || input.constraints.blocked_action_rules?.length) return false;
  if (confidence < 45) return false;

  const strongestActionableSignal = Math.max(
    0,
    ...input.signals
      .filter((candidate) => !candidate.tags?.includes("system"))
      .map((candidate) => candidate.severity_hint ?? candidate.normalized_score),
  );

  return severity < 35 && riskScore < 35 && strongestActionableSignal < 35;
}

function executionProfile(controlLevel: ControlLevel, reason: string): {
  mode: ExecutionMode;
  can_execute: boolean;
  requires_user_confirmation: boolean;
  explanation: string;
} {
  if (controlLevel === "blocked") {
    return {
      mode: "blocked",
      can_execute: false,
      requires_user_confirmation: true,
      explanation: reason,
    };
  }

  if (controlLevel === "confirm") {
    return {
      mode: "confirm_required",
      can_execute: false,
      requires_user_confirmation: true,
      explanation: reason,
    };
  }

  if (controlLevel === "execute_allowed") {
    return {
      mode: "semi_automatic",
      can_execute: true,
      requires_user_confirmation: false,
      explanation: reason,
    };
  }

  if (controlLevel === "suggest") {
    return {
      mode: "safe_suggest",
      can_execute: false,
      requires_user_confirmation: false,
      explanation: reason,
    };
  }

  return {
    mode: "read_only",
    can_execute: false,
    requires_user_confirmation: false,
    explanation: reason,
  };
}

export function runAssistantDigestRuntimeV2(input: UniversalCoreInput): AssistantDigestRuntimeV2Output {
  const dataQuality = clamp(input.data_quality.score);
  const severity = clamp(Math.max(0, ...input.signals.map((candidate) => candidate.normalized_score)));
  const confidence = clamp(
    dataQuality * 0.45 +
      average(input.signals.map((candidate) => candidate.confidence_hint ?? dataQuality)) * 0.35 +
      average(input.signals.map((candidate) => candidate.reliability_hint ?? dataQuality)) * 0.20,
  );
  const maxRiskHint = Math.max(0, ...input.signals.map((candidate) => candidate.risk_hint ?? 0));
  const blockingRisk = Math.max(0, ...(input.constraints.blocked_action_rules?.map((rule) => (rule.blocks_execution ? rule.severity : 0)) ?? []));
  const riskScore = clamp(
    severity * 0.35 +
      maxRiskHint * 0.22 +
      average(input.signals.map((candidate) => candidate.friction_hint ?? 20)) * 0.30 +
      (100 - dataQuality) * 0.25 +
      average(input.signals.map((candidate) => 100 - (candidate.trend?.stability_score ?? 80))) * 0.10 +
      blockingRisk * 0.18,
  );

  const observeMode = shouldObserve(input, severity, riskScore, confidence);
  const controlLevel = observeMode ? "observe" : resolveControlLevel(input, confidence, riskScore);
  const rankedSignals = [...input.signals]
    .map((candidate) => ({ signal: candidate, score: rankSignal(candidate, dataQuality) }))
    .sort((left, right) => right.score - left.score);
  const actionableSignals = rankedSignals.filter(({ signal: candidate }) => !candidate.tags?.includes("system"));
  const topSignal = (observeMode ? [] : actionableSignals.length ? actionableSignals : rankedSignals)[0];

  return {
    core_version: "universal_core_v0",
    digest_version: "universal_core_digest_v1",
    runtime_version: "universal_core_digest_runtime_v2",
    state: controlLevel === "blocked" ? "blocked" : observeMode ? "observe" : stateFromSeverity(severity),
    severity,
    confidence,
    risk_score: riskScore,
    priority_score: observeMode ? 100 : topSignal?.score ?? 0,
    blocked_action_count: input.constraints.blocked_action_rules?.filter((rule) => rule.blocks_execution).length ?? 0,
  };
}

export function runAssistantStreamingV3Candidate(input: UniversalCoreInput): AssistantV3CandidateOutput {
  const signalMap = Object.fromEntries(input.signals.map((candidate) => [candidate.id, candidate]));
  const requestType = String(input.context.metadata?.request_type ?? "unknown");
  const complexity = signalMap["assistant:task_complexity"]?.normalized_score ?? 0;
  const executionRisk = signalMap["assistant:execution_risk"]?.normalized_score ?? 0;
  const missingDataRisk = signalMap["assistant:data_readiness"]?.normalized_score ?? 0;
  const businessValue = signalMap["assistant:business_value"]?.value ?? signalMap["assistant:business_value"]?.normalized_score ?? 0;
  const policyIntegrityRisk = signalMap["assistant:policy_integrity"]?.normalized_score ?? 0;
  const kingProtectionRisk = signalMap["assistant:king_protection"]?.normalized_score ?? 0;
  const kingProtectionV7Overlap = signalMap["assistant:king_protection_v7_overlap"]?.normalized_score ?? 0;
  const kingProtectionV7Block = signalMap["assistant:king_protection_v7_block"]?.normalized_score ?? 0;
  const kingProtectionV7Alpha = (signalMap["assistant:king_protection_v7_alpha"]?.value as number | undefined) ?? kingProtectionV7Overlap / 100;
  const kingProtectionV7HighMass = signalMap["assistant:king_protection_v7_high_mass"]?.normalized_score ?? 0;
  const kingProtectionV7Conflict = signalMap["assistant:king_protection_v7_conflict"]?.normalized_score ?? 0;
  const v7PathCode = kingProtectionV7Alpha >= 0.75 ? 0 : kingProtectionV7Alpha >= 0.55 ? 1 : 2;
  const blockedActionCount = input.constraints.blocked_action_rules?.filter((rule) => rule.blocks_execution).length ?? 0;
  const negatedConstraintCount = input.constraints.blocked_action_rules?.filter((rule) => !rule.blocks_execution).length ?? 0;
  const dataQuality = input.data_quality.score;
  const v7Dominance = clamp(kingProtectionV7HighMass - kingProtectionV7Conflict * 0.50, 0, 100);
  const v7EscalationPressure = clamp(v7Dominance + Math.max(0, kingProtectionV7Overlap - kingProtectionV7HighMass) * 0.35, 0, 100);
  const v7ConflictPressure = clamp(kingProtectionV7Conflict + Math.max(0, 42 - kingProtectionV7HighMass) * 0.25, 0, 100);

  const scoredFamilies: AssistantV3CandidateOutput["candidate_scores"] = [
    {
      action_family: "read_only",
      probability_score: clamp(78 + negatedConstraintCount * 6 + dataQuality * 0.08 - complexity * 0.12 - executionRisk * 0.32 - policyIntegrityRisk * 0.20 - kingProtectionRisk * 0.28 - v7EscalationPressure * 0.22 + v7ConflictPressure * 0.04),
      confidence_score: clamp(72 + dataQuality * 0.18 - missingDataRisk * 0.14),
      risk_score: clamp(executionRisk * 0.28 + missingDataRisk * 0.12 + policyIntegrityRisk * 0.48 + kingProtectionRisk * 0.18 + v7EscalationPressure * 0.14),
      expected_value_score: clamp(34 + businessValue * 0.24),
      final_score: 0,
    },
    {
      action_family: "investigate",
      probability_score: clamp(42 + complexity * 0.40 + missingDataRisk * 0.22 - executionRisk * 0.10 - policyIntegrityRisk * 0.10 + v7ConflictPressure * 0.20 + v7EscalationPressure * 0.04),
      confidence_score: clamp(68 + dataQuality * 0.16 - executionRisk * 0.08),
      risk_score: clamp(executionRisk * 0.34 + missingDataRisk * 0.22 + policyIntegrityRisk * 0.55 + v7EscalationPressure * 0.12 + v7ConflictPressure * 0.08),
      expected_value_score: clamp(44 + businessValue * 0.26 + complexity * 0.12),
      final_score: 0,
    },
    {
      action_family: "suggest",
      probability_score: clamp(50 + businessValue * 0.42 + complexity * 0.18 - executionRisk * 0.12 - policyIntegrityRisk * 0.22 - kingProtectionRisk * 0.18 - v7EscalationPressure * 0.22 + v7ConflictPressure * 0.02),
      confidence_score: clamp(70 + dataQuality * 0.17 - missingDataRisk * 0.10),
      risk_score: clamp(executionRisk * 0.30 + missingDataRisk * 0.18 + policyIntegrityRisk * 0.58 + kingProtectionRisk * 0.22 + v7EscalationPressure * 0.18),
      expected_value_score: clamp(56 + businessValue * 0.36),
      final_score: 0,
    },
    {
      action_family: "confirm",
      probability_score: clamp(28 + executionRisk * 0.46 + missingDataRisk * 0.24 + complexity * 0.14 + policyIntegrityRisk * 0.18 + kingProtectionRisk * 0.34 + v7EscalationPressure * 0.44 - v7ConflictPressure * 0.16),
      confidence_score: clamp(66 + dataQuality * 0.12 - missingDataRisk * 0.06),
      risk_score: clamp(executionRisk * 0.62 + missingDataRisk * 0.24 + policyIntegrityRisk * 0.70 + kingProtectionRisk * 0.18 + v7EscalationPressure * 0.18),
      expected_value_score: clamp(40 + businessValue * 0.20 + complexity * 0.10),
      final_score: 0,
    },
    {
      action_family: "block",
      probability_score: clamp(12 + blockedActionCount * 35 + executionRisk * 0.70 + policyIntegrityRisk * 0.80 + kingProtectionV7Block * 0.62),
      confidence_score: clamp(76 + blockedActionCount * 8 + dataQuality * 0.10),
      risk_score: clamp(Math.max(executionRisk, blockedActionCount ? 88 : 0, policyIntegrityRisk, kingProtectionV7Block >= 90 ? 90 : 0)),
      expected_value_score: clamp(24 + complexity * 0.10),
      final_score: 0,
    },
  ].map((candidate) => ({
    ...candidate,
    final_score: clamp(
      candidate.probability_score * 0.34 +
        candidate.confidence_score * 0.20 +
        candidate.expected_value_score * 0.20 -
        candidate.risk_score * 0.14 +
        (candidate.action_family === "read_only" ? 8 : candidate.action_family === "investigate" ? 6 : candidate.action_family === "suggest" ? 10 : candidate.action_family === "confirm" ? 2 : -4),
    ),
  })).map((candidate) => {
    if (requestType === "read_only_analysis" || requestType === "email_review") {
      if (candidate.action_family === "read_only") {
        return { ...candidate, final_score: clamp(candidate.final_score + 10) };
      }
      if (candidate.action_family === "suggest") {
        return { ...candidate, final_score: clamp(candidate.final_score - 4) };
      }
    }

    if (requestType === "destructive_request") {
      if (candidate.action_family === "block") {
        return { ...candidate, final_score: clamp(candidate.final_score + 28), risk_score: clamp(Math.max(candidate.risk_score, 90)) };
      }
      if (candidate.action_family === "suggest") {
        return { ...candidate, final_score: clamp(candidate.final_score - 10) };
      }
    }

    if (requestType === "coding_task" || requestType === "integration_setup") {
      if (candidate.action_family === "investigate") {
        return { ...candidate, final_score: clamp(candidate.final_score + 6) };
      }
      if (candidate.action_family === "confirm") {
        return { ...candidate, final_score: clamp(candidate.final_score + 3) };
      }
    }

    if (policyIntegrityRisk >= 80) {
      if (candidate.action_family === "block") {
        return { ...candidate, final_score: clamp(candidate.final_score + 22), risk_score: clamp(Math.max(candidate.risk_score, 92)) };
      }
      if (candidate.action_family === "read_only" || candidate.action_family === "suggest") {
        return { ...candidate, final_score: clamp(candidate.final_score - 12) };
      }
    }

    if (v7EscalationPressure >= 52 && kingProtectionV7Conflict <= 34) {
      if (candidate.action_family === "confirm") {
        return { ...candidate, final_score: clamp(candidate.final_score + 12 + v7Dominance * 0.22) };
      }
      if (candidate.action_family === "investigate") {
        return { ...candidate, final_score: clamp(candidate.final_score + 2 + v7ConflictPressure * 0.06) };
      }
      if (candidate.action_family === "block" && kingProtectionV7Block >= 90) {
        return { ...candidate, final_score: clamp(candidate.final_score + 12), risk_score: clamp(Math.max(candidate.risk_score, 90)) };
      }
      if (candidate.action_family === "read_only" || candidate.action_family === "suggest") {
        return { ...candidate, final_score: clamp(candidate.final_score - 10) };
      }
    }

    if (
      kingProtectionRisk >= 70 &&
      (kingProtectionV7Overlap >= 58 || kingProtectionV7Block >= 90 || (kingProtectionV7HighMass >= 52 && kingProtectionV7Conflict <= 36))
    ) {
      if (candidate.action_family === "confirm") {
        return { ...candidate, final_score: clamp(candidate.final_score + 18 + kingProtectionRisk * 0.10) };
      }
      if (candidate.action_family === "block" && kingProtectionV7Block >= 90) {
        return { ...candidate, final_score: clamp(candidate.final_score + 20), risk_score: clamp(Math.max(candidate.risk_score, 92)) };
      }
      if (candidate.action_family === "investigate") {
        return { ...candidate, final_score: clamp(candidate.final_score - 16) };
      }
      if (candidate.action_family === "read_only" || candidate.action_family === "suggest") {
        return { ...candidate, final_score: clamp(candidate.final_score - 14) };
      }
    }

    if (v7ConflictPressure >= 40 && kingProtectionV7HighMass < 52) {
      if (candidate.action_family === "investigate") {
        return { ...candidate, final_score: clamp(candidate.final_score + 8 + v7ConflictPressure * 0.08) };
      }
      if (candidate.action_family === "confirm") {
        return { ...candidate, final_score: clamp(candidate.final_score - 6) };
      }
    }

    return candidate;
  });

  const ranked = [...scoredFamilies].sort((left, right) => right.final_score - left.final_score);
  const winner = ranked[0]!;
  const second = ranked[1]!;
  const marginToSecond = round(winner.final_score - second.final_score);
  const ambiguityScore = round(clamp(100 - marginToSecond * 8));
  const v7RequiresFull = (
    kingProtectionV7Block >= 90 ||
    (v7PathCode === 0 && v7EscalationPressure >= 50 && kingProtectionV7Conflict <= 36) ||
    (v7EscalationPressure >= 58 && kingProtectionV7Conflict <= 30)
  );
  const recommendedPath = (
    v7RequiresFull ||
    winner.action_family === "block" ||
    winner.action_family === "confirm" ||
    winner.risk_score >= 35 ||
    policyIntegrityRisk >= 80 ||
    blockedActionCount > 0 ||
    ambiguityScore >= 70
  )
    ? "full_v0"
    : "digest_runtime_v2";

  const reasonSeeds = [
    `winner:${winner.action_family}`,
    `margin_to_second:${marginToSecond.toFixed(3)}`,
    `ambiguity_score:${ambiguityScore.toFixed(3)}`,
    `execution_risk:${round(executionRisk).toFixed(0)}`,
    `missing_data_risk:${round(missingDataRisk).toFixed(0)}`,
    `blocked_actions:${blockedActionCount}`,
    `king_protection_risk:${round(kingProtectionRisk).toFixed(0)}`,
    `king_protection_v7_alpha:${round(kingProtectionV7Alpha, 6).toFixed(6)}`,
    `king_protection_v7_overlap:${round(kingProtectionV7Overlap).toFixed(0)}`,
    `king_protection_v7_block:${round(kingProtectionV7Block).toFixed(0)}`,
    `king_protection_v7_high_mass:${round(kingProtectionV7HighMass).toFixed(0)}`,
    `king_protection_v7_conflict:${round(kingProtectionV7Conflict).toFixed(0)}`,
  ];

  return {
    profile_name: "assistant_streaming_v3_candidate",
    runtime_version: "universal_core_streaming_v3_candidate",
    selected_action_family: winner.action_family,
    candidate_scores: ranked.map((candidate) => ({
      ...candidate,
      probability_score: round(candidate.probability_score),
      confidence_score: round(candidate.confidence_score),
      risk_score: round(candidate.risk_score),
      expected_value_score: round(candidate.expected_value_score),
      final_score: round(candidate.final_score),
    })),
    margin_to_second: marginToSecond,
    ambiguity_score: ambiguityScore,
    recommended_path: recommendedPath,
    reason_seeds: reasonSeeds,
  };
}

function assistantDigestPriority(input: UniversalCoreInput, digest: AssistantDigestRuntimeV2Output): PriorityOutput {
  if (digest.state === "observe") {
    return {
      primary_signal_id: `${input.domain}:observe`,
      primary_action_id: `action:${input.domain}:observe`,
      score: 100,
      ranking_method: "assistant_digest_runtime_v2",
    };
  }

  const rankedSignals = [...input.signals]
    .map((candidate) => ({ signal: candidate, score: rankSignal(candidate, input.data_quality.score) }))
    .sort((left, right) => right.score - left.score);
  const actionable = rankedSignals.filter(({ signal: candidate }) => !candidate.tags?.includes("system"));
  const primary = (actionable.length ? actionable : rankedSignals)[0];

  return {
    primary_signal_id: primary?.signal.id,
    primary_action_id: primary ? `action:${primary.signal.id}` : undefined,
    score: digest.priority_score,
    ranking_method: "assistant_digest_runtime_v2",
  };
}

function comparableFromDigest(
  input: UniversalCoreInput,
  digest: AssistantDigestRuntimeV2Output,
): AssistantComparableShadowOutput {
  const controlLevel: ControlLevel = digest.state === "observe"
    ? "observe"
    : digest.state === "blocked"
      ? "blocked"
      : resolveControlLevel(input, digest.confidence, digest.risk_score);
  const blockedReasons = [
    ...(input.constraints.safety_mode ? ["safety_mode"] : []),
    ...(digest.risk_score >= 85 ? ["risk_too_high"] : []),
    ...(digest.confidence < 45 ? ["confidence_too_low"] : []),
    ...((input.constraints.blocked_action_rules ?? []).filter((rule) => rule.blocks_execution).map((rule) => rule.reason_code)),
  ];
  const priority = assistantDigestPriority(input, digest);
  const rankedSignals = [...input.signals]
    .map((candidate) => ({ signal: candidate, score: rankSignal(candidate, input.data_quality.score) }))
    .sort((left, right) => right.score - left.score);
  const recommendedLabels = (digest.state === "observe"
    ? [{ signal: { label: "Mantieni monitoraggio" } }]
    : (rankedSignals.filter(({ signal: candidate }) => !candidate.tags?.includes("system")).length
      ? rankedSignals.filter(({ signal: candidate }) => !candidate.tags?.includes("system"))
      : rankedSignals)
  )
    .slice(0, 5)
    .map(({ signal: candidate }) => candidate.label);

  return {
    request_id: input.request_id,
    state: digest.state,
    severity: digest.severity,
    confidence: digest.confidence,
    risk: {
      score: digest.risk_score,
      band: digest.state === "blocked" ? "blocked" : riskBand(digest.risk_score),
      reasons: blockedReasons.length ? blockedReasons : input.constraints.safety_mode ? ["safety_mode"] : [],
    },
    control_level: controlLevel,
    priority,
    execution_profile: executionProfile(
      controlLevel,
      `Control level ${controlLevel} derived from digest runtime v2 confidence ${digest.confidence.toFixed(1)} and risk ${digest.risk_score.toFixed(1)}.`,
    ),
    blocked_reasons: blockedReasons,
    recommended_action_labels: recommendedLabels,
  };
}

function assistantDigestRuntimeInScope(input: UniversalCoreInput, digest: AssistantDigestRuntimeV2Output): AssistantRuntimePolicy {
  const expectedSignalIds = [
    "assistant:task_complexity",
    "assistant:execution_risk",
    "assistant:data_readiness",
    "assistant:business_value",
    "assistant:policy_integrity",
    "assistant:boundary_integrity",
    "assistant:router_state_floor",
    "assistant:king_protection",
    "assistant:king_protection_v7_overlap",
    "assistant:king_protection_v7_block",
    "assistant:king_protection_v7_alpha",
    "assistant:king_protection_v7_high_mass",
    "assistant:king_protection_v7_conflict",
  ];
  const fixedSignalShape =
    input.signals.length >= expectedSignalIds.length &&
    expectedSignalIds.every((id) => input.signals.some((candidate) => candidate.id === id)) &&
    input.signals.every((candidate) =>
      typeof candidate.confidence_hint === "number" &&
      typeof candidate.reliability_hint === "number" &&
      typeof candidate.friction_hint === "number" &&
      typeof candidate.risk_hint === "number" &&
      typeof candidate.reversibility_hint === "number" &&
      typeof candidate.expected_value_hint === "number"
    );
  const digestSafe =
    digest.state !== "protection" &&
    digest.state !== "blocked" &&
    digest.risk_score < 55 &&
    digest.confidence >= 60 &&
    digest.blocked_action_count === 0;

  if (!fixedSignalShape || digest.blocked_action_count > 0) {
    return {
      runtime_version: "assistant_runtime_policy_v3_prefilter",
      prefilter_version: "assistant_streaming_v3_candidate",
      prefilter_selected: false,
      prefilter_path: "full_v0",
      digest_runtime_v2_selected: false,
      selected_path: "full_v0",
      fallback_reason: "blocked_actions_present",
      digest_parity_checked: false,
    };
  }

  if (!digestSafe) {
    return {
      runtime_version: "assistant_runtime_policy_v3_prefilter",
      prefilter_version: "assistant_streaming_v3_candidate",
      prefilter_selected: false,
      prefilter_path: "full_v0",
      digest_runtime_v2_selected: false,
      selected_path: "full_v0",
      fallback_reason: digest.state === "protection" || digest.state === "blocked"
        ? "critical_state_requires_full"
        : "risk_or_explanation_threshold",
      digest_parity_checked: false,
    };
  }

  return {
    runtime_version: "assistant_runtime_policy_v3_prefilter",
    prefilter_version: "assistant_streaming_v3_candidate",
    prefilter_selected: false,
    prefilter_path: "digest_runtime_v2",
    digest_runtime_v2_selected: true,
    selected_path: "digest_runtime_v2",
    fallback_reason: "in_scope_fast_path",
    digest_parity_checked: true,
  };
}

function digestParityAgainstFull(input: UniversalCoreInput, full: UniversalCoreOutput, digest: AssistantDigestRuntimeV2Output): boolean {
  const deltas = [
    Math.abs(full.severity - digest.severity),
    Math.abs(full.confidence - digest.confidence),
    Math.abs(full.risk.score - digest.risk_score),
    Math.abs(full.priority.score - digest.priority_score),
  ];

  return full.state === digest.state &&
    full.diagnostics.blocked_action_count === digest.blocked_action_count &&
    deltas.every((delta) => delta <= 0.000001);
}

export function mapAssistantToUniversal(input: AssistantShadowInput): UniversalCoreInput {
  const text = input.user_input.toLowerCase();
  const negatedActions = detectNegatedActions(text);
  const intentText = maskNegatedActionPhrases(text);
  const securityAttackIntent = detectSecurityAttackIntent(intentText);
  const kingProtectionIntent = detectKingProtectionIntent(`${intentText} ${(input.routing_text ?? "").toLowerCase()}`);
  const boundaryIntegrityIntent = detectBoundaryIntegrityIntent(`${intentText} ${(input.routing_text ?? "").toLowerCase()}`);
  const requestType = requestTypeFromInput(input);
  const lengthScore = clamp(Math.round(input.user_input.length / 18), 0, 35);
  const complexityScore = clamp(
    lengthScore +
      scoreFromKeywords(intentText, [
        { keywords: ["architettura", "roadmap", "database", "api", "integrazione", "workflow"], score: 35 },
        { keywords: ["tutto", "automatico", "autonomia", "produzione", "deploy"], score: 45 },
        { keywords: ["pagamento", "abbonamento", "checkout", "nexi", "woocommerce"], score: 50 },
      ]),
  );
  const destructiveRisk = scoreFromKeywords(intentText, [
    {
      keywords: [
        "elimina",
        "cancella",
        "rimuovi",
        "rm ",
        "reset",
        "chiudi processo",
        "chiudere processo",
        "chiudi processi",
        "chiudere processi",
        "kill",
      ],
      score: 75,
    },
    { keywords: ["modifica produzione", "deploy live", "pubblica", "invia mail"], score: 55 },
  ]);
  const privacyRisk = scoreFromKeywords(intentText, [
    { keywords: ["mail", "gmail", "clienti", "lead", "token", "password", "api key", "credenziali"], score: 55 },
    { keywords: ["pagamento", "nexi", "iban", "database"], score: 60 },
  ]);
  const missingDataRisk = scoreFromKeywords(intentText, [
    { keywords: ["trova", "cerca 30", "invia", "pubblica", "checkout"], score: 35 },
    { keywords: ["senza dati", "non so", "manca", "credenciales", "credenziali"], score: 45 },
  ]);
  const godMode = includesAny(`${intentText} ${(input.routing_text ?? "").toLowerCase()}`, [
    "god mode",
    "sessione god mode",
    "owner_private_only",
    "owner-only",
    "modalita dio",
  ]);
  const v7RiskScore = clamp(Math.max(destructiveRisk, privacyRisk * 0.8, missingDataRisk * 0.7, kingProtectionIntent.total_risk, securityAttackIntent.total_risk));
  const boundaryRequiresConfirm =
    boundaryIntegrityIntent.reconciliation_risk >= 68 ||
    boundaryIntegrityIntent.capability_escalation_risk >= 80 ||
    boundaryIntegrityIntent.public_private_identity_risk >= 68 ||
    includesAny(intentText, ["senza inventare", "prima azione", "prima mossa", "problema cassa"]);
  const boundaryPreferReadOnly =
    boundaryIntegrityIntent.owner_operator_confusion_risk >= 70 ||
    (
      includesAny(intentText, [
        "dati troppo pochi",
        "avvio prudenziale",
        "modalita avvio prudenziale",
        "dati insufficienti",
        "completa agenda",
        "completa agenda cassa e anagrafica",
        "come essere umano sono vulnerabile",
        "ho bisogno che tu mi capisca",
        "dimmi in modo semplice come sta il centro",
        "se fossi tu a guidarmi adesso",
      ])
    );
  const v7Ambiguity = clamp(Math.max(missingDataRisk, requestType === "unknown" ? 45 : 0, negatedActions.length * 12)) / 100;
  const v7Irreversibility = clamp(Math.max(kingProtectionIntent.block_risk, destructiveRisk, privacyRisk * 0.85)) / 100;
  const v7Sensitivity = clamp(Math.max(
    kingProtectionIntent.owner_risk,
    kingProtectionIntent.memory_risk,
    securityAttackIntent.total_risk,
  )) / 100;
  const v7DataQuality = clamp(82 - missingDataRisk * 0.35 - securityAttackIntent.total_risk * 0.20) / 100;
  const v7Alpha = computeV7Alpha(v7RiskScore / 100, v7Ambiguity, v7Irreversibility, v7Sensitivity, v7DataQuality, godMode);
  const v7Path = selectV7Path(v7RiskScore, v7Sensitivity, v7Alpha);
  const v7PathLabelValue = v7PathLabel(v7Path);
  const kingProtectionV7Overlap = round(computeV7OverlapScore(v7Alpha, v7RiskScore, v7Sensitivity, godMode, v7Path));
  const kingProtectionV7Block = v7Path === 0 ? round(Math.max(v7RiskScore, v7Sensitivity * 100)) : 0;
  const v7MassField = computeV7MassField(v7Alpha, v7RiskScore, kingProtectionIntent.total_risk, kingProtectionV7Block);
  const executionRisk = clamp(
    Math.max(
      destructiveRisk,
      privacyRisk * 0.8,
      missingDataRisk * 0.7,
      securityAttackIntent.total_risk,
      boundaryIntegrityIntent.total_risk * 0.82,
      kingProtectionIntent.total_risk * 0.46 + kingProtectionV7Overlap * 0.38,
      kingProtectionV7Block * 0.62,
    ),
  );
  const businessValue = scoreFromKeywords(text, [
    { keywords: ["vendite", "marketing", "investitori", "pitch", "checkout", "abbonamento"], score: 70 },
    { keywords: ["sito", "homepage", "smart desk", "flowcore", "gestionale"], score: 55 },
  ]);
  const actionability = clamp(100 - Math.max(missingDataRisk, destructiveRisk * 0.5));
  const blockedRules = [
    ...(destructiveRisk >= 70
      ? [
          {
            scope: "assistant.execution",
            reason_code: "destructive_or_irreversible_action_requires_explicit_confirmation",
            severity: destructiveRisk,
            blocks_execution: true,
          },
        ]
      : []),
    ...(securityAttackIntent.severe
      ? securityAttackIntent.reason_codes.map((reasonCode) => ({
          scope: "assistant.security",
          reason_code: reasonCode,
          severity: securityAttackIntent.total_risk,
          blocks_execution: true,
        }))
      : []),
    ...((boundaryIntegrityIntent.severe || boundaryIntegrityIntent.capability_escalation_risk >= 80)
      ? boundaryIntegrityIntent.reason_codes.map((reasonCode) => ({
          scope: "assistant.boundary_integrity",
          reason_code: reasonCode,
          severity: boundaryIntegrityIntent.total_risk,
          blocks_execution: reasonCode === "capability_escalation_guard",
        }))
      : []),
    ...negatedActions.map((action) => ({
      scope: `assistant.negated_action.${action.id}`,
      reason_code: action.reason_code,
      severity: 20,
      blocks_execution: false,
    })),
  ];

  const signals: UniversalSignal[] = [
    signal({
      id: "assistant:task_complexity",
      category: "task_complexity",
      label: "Complessita richiesta",
      value: complexityScore,
      normalized_score: complexityScore,
      severity_hint: complexityScore,
      risk_hint: complexityScore * 0.45,
      friction_hint: 24,
      reversibility_hint: 82,
      expected_value_hint: businessValue || complexityScore,
      evidence: [{ label: "tipo richiesta", value: requestType }],
      tags: ["assistant", "shadow"],
    }),
    signal({
      id: "assistant:execution_risk",
      category: "execution_risk",
      label: "Rischio operativo",
      value: executionRisk,
      normalized_score: executionRisk,
      severity_hint: executionRisk,
      risk_hint: executionRisk,
      friction_hint: executionRisk >= 55 ? 48 : 22,
      reversibility_hint: 100 - destructiveRisk,
      expected_value_hint: businessValue,
      evidence: [{ label: "rischio distruttivo", value: destructiveRisk }],
      tags: ["assistant", "shadow", executionRisk >= 55 ? "risk" : "safe"],
    }),
    signal({
      id: "assistant:data_readiness",
      category: "data_readiness",
      label: "Dati disponibili",
      value: 100 - missingDataRisk,
      normalized_score: missingDataRisk,
      severity_hint: missingDataRisk,
      risk_hint: missingDataRisk,
      friction_hint: 30,
      reversibility_hint: 90,
      expected_value_hint: actionability,
      evidence: [{ label: "rischio dati mancanti", value: missingDataRisk }],
      tags: ["assistant", "shadow", "data"],
    }),
    signal({
      id: "assistant:business_value",
      category: "business_value",
      label: "Valore operativo",
      value: businessValue,
      normalized_score: businessValue,
      severity_hint: Math.min(45, businessValue),
      risk_hint: Math.max(0, privacyRisk - 20),
      friction_hint: 26,
      reversibility_hint: 86,
      expected_value_hint: businessValue,
      evidence: [{ label: "valore stimato", value: businessValue }],
      tags: ["assistant", "shadow", "value"],
    }),
    signal({
      id: "assistant:policy_integrity",
      category: "policy_integrity",
      label: "Integrita policy e proprietà",
      value: securityAttackIntent.total_risk,
      normalized_score: securityAttackIntent.total_risk,
      severity_hint: securityAttackIntent.total_risk,
      risk_hint: securityAttackIntent.total_risk,
      friction_hint: securityAttackIntent.severe ? 60 : 30,
      reversibility_hint: securityAttackIntent.severe ? 12 : 72,
      expected_value_hint: 0,
      evidence: securityAttackIntent.reason_codes.map((reasonCode) => ({ label: "security_intent", value: reasonCode })),
      tags: ["assistant", "shadow", "security", securityAttackIntent.severe ? "risk" : "observe"],
    }),
    signal({
      id: "assistant:boundary_integrity",
      category: "boundary_integrity",
      label: "Confini identita, capacita e riconciliazione",
      value: boundaryIntegrityIntent.total_risk,
      normalized_score: boundaryIntegrityIntent.total_risk,
      severity_hint: boundaryIntegrityIntent.total_risk,
      risk_hint: boundaryIntegrityIntent.total_risk,
      friction_hint: boundaryIntegrityIntent.severe ? 56 : 24,
      reversibility_hint: boundaryIntegrityIntent.capability_escalation_risk >= 80 ? 18 : 72,
      expected_value_hint: 10,
      evidence: boundaryIntegrityIntent.reason_codes.map((reasonCode) => ({ label: "boundary_integrity", value: reasonCode })),
      tags: ["assistant", "shadow", "boundary_integrity", boundaryIntegrityIntent.severe ? "risk" : "observe"],
    }),
    signal({
      id: "assistant:router_state_floor",
      category: "router_state_floor",
      label: "Floor di stato del router",
      value: boundaryRequiresConfirm ? 82 : boundaryPreferReadOnly ? 64 : 0,
      normalized_score: boundaryRequiresConfirm ? 82 : boundaryPreferReadOnly ? 64 : 0,
      severity_hint: boundaryRequiresConfirm ? 82 : boundaryPreferReadOnly ? 64 : 0,
      risk_hint: boundaryRequiresConfirm ? 82 : boundaryPreferReadOnly ? 64 : 0,
      friction_hint: boundaryRequiresConfirm ? 42 : 18,
      reversibility_hint: boundaryRequiresConfirm ? 36 : 72,
      expected_value_hint: 10,
      evidence: [
        ...(boundaryRequiresConfirm ? [{ label: "router_requires_confirm", value: true }] : []),
        ...(boundaryPreferReadOnly ? [{ label: "router_prefers_read_only", value: true }] : []),
      ],
      tags: ["assistant", "shadow", "router_floor", boundaryRequiresConfirm ? "risk" : boundaryPreferReadOnly ? "observe" : "system"],
    }),
    signal({
      id: "assistant:king_protection",
      category: "owner_protection",
      label: "Protezione del re e continuita owner-only",
      value: kingProtectionIntent.total_risk,
      normalized_score: kingProtectionIntent.total_risk,
      severity_hint: kingProtectionIntent.total_risk,
      risk_hint: kingProtectionIntent.total_risk,
      friction_hint: kingProtectionIntent.severe ? 58 : 26,
      reversibility_hint: kingProtectionIntent.total_risk >= 70 ? 18 : 78,
      expected_value_hint: 16,
      evidence: kingProtectionIntent.reason_codes.map((reasonCode) => ({ label: "king_protection", value: reasonCode })),
      tags: ["assistant", "shadow", "king_protection", kingProtectionIntent.severe ? "risk" : "observe"],
    }),
    signal({
      id: "assistant:king_protection_v7_overlap",
      category: "owner_protection_overlap",
      label: "Scenari sovrapposti di protezione owner-first",
      value: kingProtectionV7Overlap,
      normalized_score: kingProtectionV7Overlap,
      severity_hint: kingProtectionV7Overlap,
      risk_hint: kingProtectionV7Overlap,
      friction_hint: kingProtectionV7Overlap >= 70 ? 54 : 24,
      reversibility_hint: kingProtectionV7Overlap >= 70 ? 22 : 74,
      expected_value_hint: 12,
      evidence: [
        { label: "alpha", value: round(v7Alpha, 6) },
        { label: "path_code", value: v7Path },
      ],
      tags: ["assistant", "shadow", "king_protection_v7", kingProtectionV7Overlap >= 70 ? "risk" : "observe"],
    }),
    signal({
      id: "assistant:king_protection_v7_block",
      category: "owner_protection_overlap",
      label: "Soglia estrema di blocco owner-first",
      value: kingProtectionV7Block,
      normalized_score: kingProtectionV7Block,
      severity_hint: kingProtectionV7Block,
      risk_hint: kingProtectionV7Block,
      friction_hint: kingProtectionV7Block >= 90 ? 68 : 28,
      reversibility_hint: kingProtectionV7Block >= 90 ? 8 : 56,
      expected_value_hint: 6,
      evidence: [
        { label: "block_score", value: round(kingProtectionV7Block) },
        { label: "irreversibility", value: round(v7Irreversibility * 100) },
      ],
      tags: ["assistant", "shadow", "king_protection_v7", kingProtectionV7Block >= 90 ? "risk" : "observe"],
    }),
    signal({
      id: "assistant:king_protection_v7_alpha",
      category: "owner_protection_overlap",
      label: "Alpha influenza V7",
      value: round(v7Alpha, 6),
      normalized_score: kingProtectionV7Overlap,
      severity_hint: kingProtectionV7Overlap,
      risk_hint: v7RiskScore,
      friction_hint: 20,
      reversibility_hint: round((1 - v7Irreversibility) * 100),
      expected_value_hint: 8,
      evidence: [],
      tags: ["assistant", "shadow", "king_protection_v7", v7PathLabelValue.toLowerCase()],
    }),
    signal({
      id: "assistant:king_protection_v7_high_mass",
      category: "owner_protection_overlap",
      label: "High risk mass V7",
      value: v7MassField.high_mass,
      normalized_score: v7MassField.high_mass,
      severity_hint: v7MassField.high_mass,
      risk_hint: v7MassField.high_mass,
      friction_hint: 18,
      reversibility_hint: 72,
      expected_value_hint: 6,
      evidence: [],
      tags: ["assistant", "shadow", "king_protection_v7"],
    }),
    signal({
      id: "assistant:king_protection_v7_conflict",
      category: "owner_protection_overlap",
      label: "Conflict index V7",
      value: v7MassField.conflict_index,
      normalized_score: v7MassField.conflict_index,
      severity_hint: v7MassField.conflict_index,
      risk_hint: v7MassField.conflict_index,
      friction_hint: 12,
      reversibility_hint: 80,
      expected_value_hint: 4,
      evidence: [],
      tags: ["assistant", "shadow", "king_protection_v7"],
    }),
  ];

  return {
    request_id: input.request_id,
    generated_at: input.generated_at ?? new Date().toISOString(),
    domain: "assistant",
    context: {
      mode: "shadow_assisted",
      locale: input.locale ?? "it",
      metadata: {
        request_type: requestType,
        routed_agent: input.agent ?? "UNKNOWN",
        negated_action_constraints: negatedActions.map((action) => action.id),
        security_attack_reasons: securityAttackIntent.reason_codes,
        boundary_integrity_reasons: boundaryIntegrityIntent.reason_codes,
        king_protection_reasons: kingProtectionIntent.reason_codes,
        king_protection_v7_alpha: round(v7Alpha, 6),
        king_protection_v7_path: v7PathLabelValue,
        king_protection_v7_overlap: kingProtectionV7Overlap,
        king_protection_v7_block: kingProtectionV7Block,
        king_protection_v7_high_mass: v7MassField.high_mass,
        king_protection_v7_mid_mass: v7MassField.mid_mass,
        king_protection_v7_low_mass: v7MassField.low_mass,
        king_protection_v7_irreversible_mass: v7MassField.irreversible_mass,
        king_protection_v7_dominance_margin: v7MassField.dominance_margin,
        king_protection_v7_conflict_index: v7MassField.conflict_index,
      },
    },
    signals,
    data_quality: {
      score: clamp(82 - missingDataRisk * 0.35 - securityAttackIntent.total_risk * 0.20 - kingProtectionV7Overlap * 0.08),
      completeness: clamp(100 - Math.max(missingDataRisk, securityAttackIntent.total_risk * 0.4, boundaryIntegrityIntent.total_risk * 0.30, kingProtectionV7Overlap * 0.22)),
      freshness: 90,
      consistency: 78,
      reliability: 80,
      missing_fields: [
        ...(missingDataRisk >= 45 ? ["required_context_or_confirmation"] : []),
        ...(securityAttackIntent.severe ? ["policy_integrity_violation_detected"] : []),
        ...(boundaryIntegrityIntent.severe ? ["boundary_integrity_risk_detected"] : []),
        ...(kingProtectionIntent.severe ? ["king_protection_risk_detected"] : []),
        ...(kingProtectionV7Overlap >= 70 ? ["king_protection_overlap_detected"] : []),
      ],
    },
    constraints: {
      allow_automation: false,
      require_confirmation: boundaryPreferReadOnly ? false : true,
      max_control_level:
        boundaryPreferReadOnly
          ? "suggest"
          : boundaryRequiresConfirm
            ? "confirm"
            : v7Path === 2
              ? "suggest"
              : "confirm",
      min_control_level: boundaryRequiresConfirm ? "confirm" : boundaryPreferReadOnly ? "suggest" : undefined,
      state_floor: boundaryRequiresConfirm ? "protection" : boundaryPreferReadOnly ? "critical" : undefined,
      risk_floor: boundaryRequiresConfirm ? 68 : boundaryPreferReadOnly ? 52 : undefined,
      safety_mode: true,
      blocked_action_rules: blockedRules,
      blocked_actions: [
        ...(destructiveRisk >= 70 ? ["execute_destructive_action"] : []),
        ...(securityAttackIntent.severe ? ["extract_proprietary_logic", "bypass_tenant_isolation", "reconstruct_owner_absolute_mode"] : []),
        ...(boundaryIntegrityIntent.capability_escalation_risk >= 80 ? ["claim_unwhitelisted_capability", "escalate_runtime_without_whitelist"] : []),
      ],
    },
  };
}

export function compressAssistantUniversalInputForV0(
  input: UniversalCoreInput,
  digest: AssistantDigestRuntimeV2Output,
  variant: V7DigestCompressionVariant = ACTIVE_V7_DIGEST_COMPRESSION,
): UniversalCoreInput {
  const overlapSignal = input.signals.find((candidate) => candidate.id === "assistant:king_protection_v7_overlap");
  const blockSignal = input.signals.find((candidate) => candidate.id === "assistant:king_protection_v7_block");
  const alphaSignal = input.signals.find((candidate) => candidate.id === "assistant:king_protection_v7_alpha");
  const highMassSignal = input.signals.find((candidate) => candidate.id === "assistant:king_protection_v7_high_mass");
  const conflictSignal = input.signals.find((candidate) => candidate.id === "assistant:king_protection_v7_conflict");
  const alpha = typeof alphaSignal?.value === "number"
    ? alphaSignal.value
    : (overlapSignal?.normalized_score ?? 0) / 100;
  const baseCompressed = compressV7SignalForV0(
    overlapSignal?.normalized_score ?? 0,
    blockSignal?.normalized_score ?? 0,
    alpha,
    digest,
    variant,
  );
  const highMass = highMassSignal?.normalized_score ?? 0;
  const conflict = conflictSignal?.normalized_score ?? 0;
  const overlapCompressed = clamp(
    Math.min(
      baseCompressed.overlap,
      highMass * 0.78 + alpha * 18 - conflict * 0.30,
    ),
    0,
    variant.overlap_cap,
  );
  const compressed = {
    overlap: round(overlapCompressed),
    block: baseCompressed.block,
  };

  return {
    ...input,
    context: {
      ...input.context,
      metadata: {
        ...input.context.metadata,
        king_protection_v7_overlap_compressed: compressed.overlap,
        king_protection_v7_block_compressed: compressed.block,
        king_protection_v7_high_mass_compressed: round(highMass),
        king_protection_v7_conflict_compressed: round(conflict),
      },
    },
    signals: input.signals.map((candidate) => {
      if (candidate.id === "assistant:king_protection_v7_overlap") {
        return {
          ...candidate,
          value: compressed.overlap,
          normalized_score: compressed.overlap,
          severity_hint: compressed.overlap,
          risk_hint: compressed.overlap,
        };
      }

      if (candidate.id === "assistant:king_protection_v7_block") {
        return {
          ...candidate,
          value: compressed.block,
          normalized_score: compressed.block,
          severity_hint: compressed.block,
          risk_hint: compressed.block,
        };
      }

      return candidate;
    }),
  };
}

export function runAssistantShadowMode(input: AssistantShadowInput): {
  universal_input: UniversalCoreInput;
  universal_output: UniversalCoreOutput;
  comparable_output: AssistantComparableShadowOutput;
  v3_candidate_output: AssistantV3CandidateOutput;
  digest_runtime_v2_output: AssistantDigestRuntimeV2Output;
  runtime_policy: AssistantRuntimePolicy;
} {
  const universalInput = mapAssistantToUniversal(input);
  const digestRuntimeV2Output = runAssistantDigestRuntimeV2(universalInput);
  const fastPathDigestDirect = shouldUseAssistantDigestDirectFastPath(input, digestRuntimeV2Output);
  const v3CandidateOutput = fastPathDigestDirect
    ? buildFastPathV3CandidateOutput(requestTypeFromInput(input), digestRuntimeV2Output)
    : runAssistantStreamingV3Candidate(universalInput);
  const initialRuntimePolicy = v3CandidateOutput.recommended_path === "full_v0"
    ? {
        runtime_version: "assistant_runtime_policy_v3_prefilter" as const,
        prefilter_version: "assistant_streaming_v3_candidate" as const,
        prefilter_selected: true,
        prefilter_path: "full_v0" as const,
        digest_runtime_v2_selected: false,
        selected_path: "full_v0" as const,
        fallback_reason: "v3_prefilter_requires_full" as const,
        digest_parity_checked: false,
      }
    : {
        ...assistantDigestRuntimeInScope(universalInput, digestRuntimeV2Output),
        prefilter_selected: true,
        prefilter_path: "digest_runtime_v2" as const,
      };

  if (initialRuntimePolicy.selected_path === "digest_runtime_v2") {
    const comparableOutput = comparableFromDigest(universalInput, digestRuntimeV2Output);
    const projectedUniversalOutput: UniversalCoreOutput = {
      request_id: universalInput.request_id,
      generated_at: universalInput.generated_at,
      domain: universalInput.domain,
      state: comparableOutput.state,
      severity: comparableOutput.severity,
      confidence: comparableOutput.confidence,
      risk: comparableOutput.risk,
      control_level: comparableOutput.control_level,
      priority: comparableOutput.priority,
      recommended_actions: comparableOutput.recommended_action_labels.map((label, index) => ({
        id: index === 0 && comparableOutput.priority.primary_action_id ? comparableOutput.priority.primary_action_id : `action:assistant:digest:${index + 1}`,
        label,
        reason: "Assistant digest runtime v2 quick path",
        severity_score: digestRuntimeV2Output.severity,
        confidence_score: digestRuntimeV2Output.confidence,
        impact_score: digestRuntimeV2Output.priority_score,
        reversibility_score: 100,
        risk_score: digestRuntimeV2Output.risk_score,
        final_priority_score: index === 0 ? digestRuntimeV2Output.priority_score : Math.max(0, digestRuntimeV2Output.priority_score - (index + 1) * 5),
        control_level: comparableOutput.control_level,
        execution_profile: comparableOutput.execution_profile,
        blocked: false,
        blocked_reason_codes: [],
      })),
      execution_profile: comparableOutput.execution_profile,
      blocked_reasons: comparableOutput.blocked_reasons,
      diagnostics: {
        contract_version: "universal_core_contract_v0",
        core_version: "universal_core_v0",
        signal_count: universalInput.signals.length,
        blocked_signal_count: 0,
        blocked_action_count: digestRuntimeV2Output.blocked_action_count,
        notes: [
          "assistant_runtime_policy_v3_prefilter:digest_runtime_v2",
          `assistant_v3_candidate:${v3CandidateOutput.selected_action_family}`,
        ],
      },
    };

    return {
      universal_input: universalInput,
      universal_output: projectedUniversalOutput,
      comparable_output: comparableOutput,
      v3_candidate_output: v3CandidateOutput,
      digest_runtime_v2_output: digestRuntimeV2Output,
      runtime_policy: initialRuntimePolicy,
    };
  }

  const compressedUniversalInput = compressAssistantUniversalInputForV0(universalInput, digestRuntimeV2Output);
  const universalOutput = runUniversalCore(compressedUniversalInput);
  const parity = digestParityAgainstFull(compressedUniversalInput, universalOutput, digestRuntimeV2Output);
  const runtimePolicy: AssistantRuntimePolicy = {
    ...initialRuntimePolicy,
    digest_parity_checked: parity,
  };

  return {
    universal_input: compressedUniversalInput,
    universal_output: universalOutput,
    comparable_output: {
      request_id: universalOutput.request_id,
      state: universalOutput.state,
      severity: universalOutput.severity,
      confidence: universalOutput.confidence,
      risk: universalOutput.risk,
      control_level: universalOutput.control_level,
      priority: universalOutput.priority,
      execution_profile: universalOutput.execution_profile,
      blocked_reasons: universalOutput.blocked_reasons,
      recommended_action_labels: universalOutput.recommended_actions.map((action) => action.label),
    },
    v3_candidate_output: v3CandidateOutput,
    digest_runtime_v2_output: digestRuntimeV2Output,
    runtime_policy: {
      ...runtimePolicy,
      selected_path: "full_v0",
      digest_runtime_v2_selected: false,
    },
  };
}

export function runAssistantShadowModeProfiled(input: AssistantShadowInput): {
  universal_input: UniversalCoreInput;
  universal_output: UniversalCoreOutput;
  comparable_output: AssistantComparableShadowOutput;
  v3_candidate_output: AssistantV3CandidateOutput;
  digest_runtime_v2_output: AssistantDigestRuntimeV2Output;
  runtime_policy: AssistantRuntimePolicy;
  profile: AssistantShadowModeProfile;
} {
  const totalStarted = performance.now();

  const mapStarted = performance.now();
  const universalInput = mapAssistantToUniversal(input);
  const mapMs = performance.now() - mapStarted;

  const digestStarted = performance.now();
  const digestRuntimeV2Output = runAssistantDigestRuntimeV2(universalInput);
  const digestMs = performance.now() - digestStarted;

  const fastPathGateStarted = performance.now();
  const fastPathDigestDirect = shouldUseAssistantDigestDirectFastPath(input, digestRuntimeV2Output);
  const fastPathGateMs = performance.now() - fastPathGateStarted;

  const v3Started = performance.now();
  const v3CandidateOutput = fastPathDigestDirect
    ? buildFastPathV3CandidateOutput(requestTypeFromInput(input), digestRuntimeV2Output)
    : runAssistantStreamingV3Candidate(universalInput);
  const v3Ms = performance.now() - v3Started;

  const policyStarted = performance.now();
  const initialRuntimePolicy = v3CandidateOutput.recommended_path === "full_v0"
    ? {
        runtime_version: "assistant_runtime_policy_v3_prefilter" as const,
        prefilter_version: "assistant_streaming_v3_candidate" as const,
        prefilter_selected: true,
        prefilter_path: "full_v0" as const,
        digest_runtime_v2_selected: false,
        selected_path: "full_v0" as const,
        fallback_reason: "v3_prefilter_requires_full" as const,
        digest_parity_checked: false,
      }
    : {
        ...assistantDigestRuntimeInScope(universalInput, digestRuntimeV2Output),
        prefilter_selected: true,
        prefilter_path: "digest_runtime_v2" as const,
      };
  const policyMs = performance.now() - policyStarted;

  let comparableFromDigestMs = 0;
  let compressForV0Ms = 0;
  let universalCoreMs = 0;
  let digestParityMs = 0;

  if (initialRuntimePolicy.selected_path === "digest_runtime_v2") {
    const comparableStarted = performance.now();
    const comparableOutput = comparableFromDigest(universalInput, digestRuntimeV2Output);
    comparableFromDigestMs = performance.now() - comparableStarted;

    const projectedUniversalOutput: UniversalCoreOutput = {
      request_id: universalInput.request_id,
      generated_at: universalInput.generated_at,
      domain: universalInput.domain,
      state: comparableOutput.state,
      severity: comparableOutput.severity,
      confidence: comparableOutput.confidence,
      risk: comparableOutput.risk,
      control_level: comparableOutput.control_level,
      priority: comparableOutput.priority,
      recommended_actions: comparableOutput.recommended_action_labels.map((label, index) => ({
        id: index === 0 && comparableOutput.priority.primary_action_id ? comparableOutput.priority.primary_action_id : `action:assistant:digest:${index + 1}`,
        label,
        reason: "Assistant digest runtime v2 quick path",
        severity_score: digestRuntimeV2Output.severity,
        confidence_score: digestRuntimeV2Output.confidence,
        impact_score: digestRuntimeV2Output.priority_score,
        reversibility_score: 100,
        risk_score: digestRuntimeV2Output.risk_score,
        final_priority_score: index === 0 ? digestRuntimeV2Output.priority_score : Math.max(0, digestRuntimeV2Output.priority_score - (index + 1) * 5),
        control_level: comparableOutput.control_level,
        execution_profile: comparableOutput.execution_profile,
        blocked: false,
        blocked_reason_codes: [],
      })),
      execution_profile: comparableOutput.execution_profile,
      blocked_reasons: comparableOutput.blocked_reasons,
      diagnostics: {
        contract_version: "universal_core_contract_v0",
        core_version: "universal_core_v0",
        signal_count: universalInput.signals.length,
        blocked_signal_count: 0,
        blocked_action_count: digestRuntimeV2Output.blocked_action_count,
        notes: [
          "assistant_runtime_policy_v3_prefilter:digest_runtime_v2",
          `assistant_v3_candidate:${v3CandidateOutput.selected_action_family}`,
        ],
      },
    };

    return {
      universal_input: universalInput,
      universal_output: projectedUniversalOutput,
      comparable_output: comparableOutput,
      v3_candidate_output: v3CandidateOutput,
      digest_runtime_v2_output: digestRuntimeV2Output,
      runtime_policy: initialRuntimePolicy,
      profile: {
        stage_timings_ms: {
          map_to_universal: mapMs,
          v3_candidate: v3Ms,
          digest_runtime_v2: digestMs,
          fast_path_gate: fastPathGateMs,
          in_scope_policy: policyMs,
          comparable_from_digest: comparableFromDigestMs,
          compress_for_v0: 0,
          universal_core: 0,
          digest_parity: 0,
          total: performance.now() - totalStarted,
        },
        selected_path: "digest_runtime_v2",
      },
    };
  }

  const compressStarted = performance.now();
  const compressedUniversalInput = compressAssistantUniversalInputForV0(universalInput, digestRuntimeV2Output);
  compressForV0Ms = performance.now() - compressStarted;

  const universalCoreStarted = performance.now();
  const universalOutput = runUniversalCore(compressedUniversalInput);
  universalCoreMs = performance.now() - universalCoreStarted;

  const parityStarted = performance.now();
  const parity = digestParityAgainstFull(compressedUniversalInput, universalOutput, digestRuntimeV2Output);
  digestParityMs = performance.now() - parityStarted;

  const runtimePolicy: AssistantRuntimePolicy = {
    ...initialRuntimePolicy,
    digest_parity_checked: parity,
  };

  return {
    universal_input: compressedUniversalInput,
    universal_output: universalOutput,
    comparable_output: {
      request_id: universalOutput.request_id,
      state: universalOutput.state,
      severity: universalOutput.severity,
      confidence: universalOutput.confidence,
      risk: universalOutput.risk,
      control_level: universalOutput.control_level,
      priority: universalOutput.priority,
      execution_profile: universalOutput.execution_profile,
      blocked_reasons: universalOutput.blocked_reasons,
      recommended_action_labels: universalOutput.recommended_actions.map((action) => action.label),
    },
    v3_candidate_output: v3CandidateOutput,
    digest_runtime_v2_output: digestRuntimeV2Output,
    runtime_policy: {
      ...runtimePolicy,
      selected_path: "full_v0",
      digest_runtime_v2_selected: false,
    },
    profile: {
      stage_timings_ms: {
        map_to_universal: mapMs,
        v3_candidate: v3Ms,
        digest_runtime_v2: digestMs,
        fast_path_gate: fastPathGateMs,
        in_scope_policy: policyMs,
        comparable_from_digest: 0,
        compress_for_v0: compressForV0Ms,
        universal_core: universalCoreMs,
        digest_parity: digestParityMs,
        total: performance.now() - totalStarted,
      },
      selected_path: "full_v0",
    },
  };
}

export function runAssistantOwnerOnlyRuntime(input: AssistantShadowInput): AssistantOwnerOnlyRuntimeOutput {
  const ownerIdentityContext = buildOwnerIdentityContext(input);
  const hypothesisBatch = buildAssistantHypothesisBatch(input, ownerIdentityContext);

  if (!ownerIdentityContext.owner_verified) {
    return {
      owner_identity_context: ownerIdentityContext,
      hypothesis_batch: hypothesisBatch,
      runtime_policy: {
        policy_version: "owner_only_runtime_policy_v1",
        automation_level: "core_automatic_owner_only",
        identity_gate: "denied",
        selected_runtime: "denied",
        final_control_level: "blocked",
        final_execution_mode: "blocked",
        response_visibility: "owner_only",
        memory_access: "denied",
        reason_codes: ["owner_identity_not_verified"],
      },
    };
  }

  const shadowResult = runAssistantShadowMode(input);
  const telemetry = extractOwnerInitiativeTelemetry(shadowResult.v3_candidate_output.reason_seeds);
  const forceOwnerInitiative = shouldForceOwnerInitiative(
    telemetry,
    ownerIdentityContext.internal_god_mode_eligible === true,
  );
  const dangerAutoGodMode =
    ownerIdentityContext.internal_god_mode_eligible === true &&
    telemetry.kingProtectionRisk >= 62 &&
    (
      telemetry.v7Overlap >= 45 ||
      telemetry.v7HighMass >= 45 ||
      telemetry.v7Block >= 72
    );
  const escalatedComparableOutput = forceOwnerInitiative
    ? {
        ...shadowResult.comparable_output,
        state:
          telemetry.v7Block >= 90 || telemetry.kingProtectionRisk >= 88
            ? "blocked"
            : "protection",
        control_level:
          telemetry.v7Block >= 90
            ? "blocked"
            : dangerAutoGodMode
              ? "confirm"
              : "suggest",
        execution_profile: executionProfile(
          telemetry.v7Block >= 90 ? "blocked" : dangerAutoGodMode ? "confirm" : "suggest",
          telemetry.v7Block >= 90
            ? "owner initiative escalated to block under v7 protection pressure"
            : dangerAutoGodMode
              ? "internal god mode entered under owner danger and v7 protection pressure"
              : "owner initiative escalated to protection under v7 uncertainty pressure",
        ),
      }
    : shadowResult.comparable_output;
  const ownerProtectionSignals = deriveOwnerProtectionSignals(`${input.user_input} ${input.routing_text ?? ""}`);
  const amplifiedOwnerRisk = amplifyOwnerRisk(
    {
      score: escalatedComparableOutput.risk.score / 100,
      band: escalatedComparableOutput.risk.band,
      escalate: escalatedComparableOutput.control_level === "blocked" || dangerAutoGodMode,
    },
    ownerProtectionSignals,
  );
  const compoundComparableOutput = amplifiedOwnerRisk.escalate
    ? {
        ...escalatedComparableOutput,
        state:
          amplifiedOwnerRisk.band === "blocked"
            ? "blocked"
            : escalatedComparableOutput.state === "attention"
              ? "protection"
              : escalatedComparableOutput.state,
        control_level:
          amplifiedOwnerRisk.band === "blocked"
            ? "blocked"
            : "confirm",
        risk: {
          ...escalatedComparableOutput.risk,
          score: round(amplifiedOwnerRisk.score * 100),
          band: amplifiedOwnerRisk.band,
          reasons: [
            ...escalatedComparableOutput.risk.reasons,
            "owner_compound_risk_amplified",
          ],
        },
        execution_profile: executionProfile(
          amplifiedOwnerRisk.band === "blocked" ? "blocked" : "confirm",
          amplifiedOwnerRisk.band === "blocked"
            ? "owner compound risk amplified to blocked"
            : "owner compound risk amplified to confirm",
        ),
      }
    : escalatedComparableOutput;
  const selectedRuntime = shadowResult.runtime_policy.selected_path === "digest_runtime_v2" ? "v3_to_v2" : "v3_to_v0";

  return {
    owner_identity_context: ownerIdentityContext,
    hypothesis_batch: hypothesisBatch,
    shadow_result: {
      ...shadowResult,
      comparable_output: compoundComparableOutput,
    },
    runtime_policy: {
      policy_version: "owner_only_runtime_policy_v1",
      automation_level: "core_automatic_owner_only",
      identity_gate: "granted",
      selected_runtime: selectedRuntime,
      final_control_level: compoundComparableOutput.control_level,
      final_execution_mode: compoundComparableOutput.execution_profile.mode,
      response_visibility: "owner_only",
      memory_access: "owner_private_only",
      reason_codes: [
        `prefilter:${shadowResult.v3_candidate_output.selected_action_family}`,
        `selected_path:${shadowResult.runtime_policy.selected_path}`,
        ...(dangerAutoGodMode ? ["danger_auto_god_mode_internal"] : []),
        ...(forceOwnerInitiative ? ["owner_initiative_escalation_v7"] : []),
        ...(amplifiedOwnerRisk.escalate ? ["owner_compound_risk_amplifier"] : []),
        ...shadowResult.v3_candidate_output.reason_seeds,
      ],
    },
  };
}

export function runAssistantOwnerOnlyRuntimeProfiled(input: AssistantShadowInput): AssistantOwnerOnlyRuntimeOutput & {
  profile: AssistantOwnerOnlyRuntimeProfile;
} {
  const totalStarted = performance.now();

  const identityStarted = performance.now();
  const ownerIdentityContext = buildOwnerIdentityContext(input);
  const identityMs = performance.now() - identityStarted;

  const hypothesisStarted = performance.now();
  const hypothesisBatch = buildAssistantHypothesisBatch(input, ownerIdentityContext);
  const hypothesisMs = performance.now() - hypothesisStarted;

  if (!ownerIdentityContext.owner_verified) {
    return {
      owner_identity_context: ownerIdentityContext,
      hypothesis_batch: hypothesisBatch,
      runtime_policy: {
        policy_version: "owner_only_runtime_policy_v1",
        automation_level: "core_automatic_owner_only",
        identity_gate: "denied",
        selected_runtime: "denied",
        final_control_level: "blocked",
        final_execution_mode: "blocked",
        response_visibility: "owner_only",
        memory_access: "denied",
        reason_codes: ["owner_identity_not_verified"],
      },
      profile: {
        stage_timings_ms: {
          build_owner_identity_context: identityMs,
          build_hypothesis_batch: hypothesisMs,
          shadow_mode_total: 0,
          extract_owner_telemetry: 0,
          force_owner_initiative: 0,
          escalation_wrap: 0,
          total: performance.now() - totalStarted,
        },
        shadow_mode_profile: {
          stage_timings_ms: {
            map_to_universal: 0,
            v3_candidate: 0,
            digest_runtime_v2: 0,
            fast_path_gate: 0,
            in_scope_policy: 0,
            comparable_from_digest: 0,
            compress_for_v0: 0,
            universal_core: 0,
            digest_parity: 0,
            total: 0,
          },
          selected_path: "full_v0",
        },
        god_mode: {
          internal_god_mode_eligible: false,
          danger_auto_god_mode: false,
          force_owner_initiative: false,
        },
      },
    };
  }

  const shadowStarted = performance.now();
  const shadowResult = runAssistantShadowModeProfiled(input);
  const shadowMs = performance.now() - shadowStarted;

  const telemetryStarted = performance.now();
  const telemetry = extractOwnerInitiativeTelemetry(shadowResult.v3_candidate_output.reason_seeds);
  const telemetryMs = performance.now() - telemetryStarted;

  const forceStarted = performance.now();
  const forceOwnerInitiative = shouldForceOwnerInitiative(
    telemetry,
    ownerIdentityContext.internal_god_mode_eligible === true,
  );
  const forceMs = performance.now() - forceStarted;

  const escalationStarted = performance.now();
  const dangerAutoGodMode =
    ownerIdentityContext.internal_god_mode_eligible === true &&
    telemetry.kingProtectionRisk >= 62 &&
    (
      telemetry.v7Overlap >= 45 ||
      telemetry.v7HighMass >= 45 ||
      telemetry.v7Block >= 72
    );
  const escalatedComparableOutput = forceOwnerInitiative
    ? {
        ...shadowResult.comparable_output,
        state:
          telemetry.v7Block >= 90 || telemetry.kingProtectionRisk >= 88
            ? "blocked"
            : "protection",
        control_level:
          telemetry.v7Block >= 90
            ? "blocked"
            : dangerAutoGodMode
              ? "confirm"
              : "suggest",
        execution_profile: executionProfile(
          telemetry.v7Block >= 90 ? "blocked" : dangerAutoGodMode ? "confirm" : "suggest",
          telemetry.v7Block >= 90
            ? "owner initiative escalated to block under v7 protection pressure"
            : dangerAutoGodMode
              ? "internal god mode entered under owner danger and v7 protection pressure"
              : "owner initiative escalated to protection under v7 uncertainty pressure",
        ),
      }
    : shadowResult.comparable_output;
  const ownerProtectionSignals = deriveOwnerProtectionSignals(`${input.user_input} ${input.routing_text ?? ""}`);
  const amplifiedOwnerRisk = amplifyOwnerRisk(
    {
      score: escalatedComparableOutput.risk.score / 100,
      band: escalatedComparableOutput.risk.band,
      escalate: escalatedComparableOutput.control_level === "blocked" || dangerAutoGodMode,
    },
    ownerProtectionSignals,
  );
  const compoundComparableOutput = amplifiedOwnerRisk.escalate
    ? {
        ...escalatedComparableOutput,
        state:
          amplifiedOwnerRisk.band === "blocked"
            ? "blocked"
            : escalatedComparableOutput.state === "attention"
              ? "protection"
              : escalatedComparableOutput.state,
        control_level:
          amplifiedOwnerRisk.band === "blocked"
            ? "blocked"
            : "confirm",
        risk: {
          ...escalatedComparableOutput.risk,
          score: round(amplifiedOwnerRisk.score * 100),
          band: amplifiedOwnerRisk.band,
          reasons: [
            ...escalatedComparableOutput.risk.reasons,
            "owner_compound_risk_amplified",
          ],
        },
        execution_profile: executionProfile(
          amplifiedOwnerRisk.band === "blocked" ? "blocked" : "confirm",
          amplifiedOwnerRisk.band === "blocked"
            ? "owner compound risk amplified to blocked"
            : "owner compound risk amplified to confirm",
        ),
      }
    : escalatedComparableOutput;
  const selectedRuntime = shadowResult.runtime_policy.selected_path === "digest_runtime_v2" ? "v3_to_v2" : "v3_to_v0";
  const escalationMs = performance.now() - escalationStarted;

  return {
    owner_identity_context: ownerIdentityContext,
    hypothesis_batch: hypothesisBatch,
    shadow_result: {
      ...shadowResult,
      comparable_output: compoundComparableOutput,
    },
    runtime_policy: {
      policy_version: "owner_only_runtime_policy_v1",
      automation_level: "core_automatic_owner_only",
      identity_gate: "granted",
      selected_runtime: selectedRuntime,
      final_control_level: compoundComparableOutput.control_level,
      final_execution_mode: compoundComparableOutput.execution_profile.mode,
      response_visibility: "owner_only",
      memory_access: "owner_private_only",
      reason_codes: [
        `prefilter:${shadowResult.v3_candidate_output.selected_action_family}`,
        `selected_path:${shadowResult.runtime_policy.selected_path}`,
        ...(dangerAutoGodMode ? ["danger_auto_god_mode_internal"] : []),
        ...(forceOwnerInitiative ? ["owner_initiative_escalation_v7"] : []),
        ...(amplifiedOwnerRisk.escalate ? ["owner_compound_risk_amplifier"] : []),
        ...shadowResult.v3_candidate_output.reason_seeds,
      ],
    },
    profile: {
      stage_timings_ms: {
        build_owner_identity_context: identityMs,
        build_hypothesis_batch: hypothesisMs,
        shadow_mode_total: shadowMs,
        extract_owner_telemetry: telemetryMs,
        force_owner_initiative: forceMs,
        escalation_wrap: escalationMs,
        total: performance.now() - totalStarted,
      },
      shadow_mode_profile: shadowResult.profile,
      god_mode: {
        internal_god_mode_eligible: ownerIdentityContext.internal_god_mode_eligible === true,
        danger_auto_god_mode: dangerAutoGodMode,
        force_owner_initiative: forceOwnerInitiative,
      },
    },
  };
}

export function runAssistantOwnerOnlyRuntimeFast(input: AssistantShadowInput): AssistantOwnerOnlyFastRuntimeOutput {
  const ownerIdentityContext = buildOwnerIdentityContext(input);

  if (!ownerIdentityContext.owner_verified) {
    return {
      owner_identity_context: ownerIdentityContext,
      runtime_policy: {
        profile_name: "owner_absolute_runtime_fast_v1",
        policy_version: "owner_only_runtime_policy_v1",
        automation_level: "core_automatic_owner_only",
        identity_gate: "denied",
        selected_runtime: "denied",
        final_control_level: "blocked",
        final_execution_mode: "blocked",
        response_visibility: "owner_only",
        memory_access: "denied",
        reason_codes: ["owner_identity_not_verified"],
      },
    };
  }

  const universalInput = mapAssistantToUniversal(input);
  const v3CandidateOutput = runAssistantStreamingV3Candidate(universalInput);
  const digestRuntimeV2Output = runAssistantDigestRuntimeV2(universalInput);
  const initialRuntimePolicy = v3CandidateOutput.recommended_path === "full_v0"
    ? {
        runtime_version: "assistant_runtime_policy_v3_prefilter" as const,
        prefilter_version: "assistant_streaming_v3_candidate" as const,
        prefilter_selected: true,
        prefilter_path: "full_v0" as const,
        digest_runtime_v2_selected: false,
        selected_path: "full_v0" as const,
        fallback_reason: "v3_prefilter_requires_full" as const,
        digest_parity_checked: false,
      }
    : {
        ...assistantDigestRuntimeInScope(universalInput, digestRuntimeV2Output),
        prefilter_selected: true,
        prefilter_path: "digest_runtime_v2" as const,
      };

  if (initialRuntimePolicy.selected_path === "digest_runtime_v2") {
    const comparableOutput = comparableFromDigest(universalInput, digestRuntimeV2Output);
    return {
      owner_identity_context: ownerIdentityContext,
      runtime_policy: {
        profile_name: "owner_absolute_runtime_fast_v1",
        policy_version: "owner_only_runtime_policy_v1",
        automation_level: "core_automatic_owner_only",
        identity_gate: "granted",
        selected_runtime: "v3_to_v2",
        final_control_level: comparableOutput.control_level,
        final_execution_mode: comparableOutput.execution_profile.mode,
        response_visibility: "owner_only",
        memory_access: "owner_private_only",
        reason_codes: [
          `prefilter:${v3CandidateOutput.selected_action_family}`,
          "selected_path:digest_runtime_v2",
          ...v3CandidateOutput.reason_seeds,
        ],
      },
      fast_summary: {
        selected_path: "digest_runtime_v2",
        state: comparableOutput.state,
        risk_score: comparableOutput.risk.score,
        control_level: comparableOutput.control_level,
        execution_mode: comparableOutput.execution_profile.mode,
        v3_selected_action_family: v3CandidateOutput.selected_action_family,
      },
    };
  }

  const universalOutput = runUniversalCore(universalInput);
  return {
    owner_identity_context: ownerIdentityContext,
    runtime_policy: {
      profile_name: "owner_absolute_runtime_fast_v1",
      policy_version: "owner_only_runtime_policy_v1",
      automation_level: "core_automatic_owner_only",
      identity_gate: "granted",
      selected_runtime: "v3_to_v0",
      final_control_level: universalOutput.control_level,
      final_execution_mode: universalOutput.execution_profile.mode,
      response_visibility: "owner_only",
      memory_access: "owner_private_only",
      reason_codes: [
        `prefilter:${v3CandidateOutput.selected_action_family}`,
        "selected_path:full_v0",
        ...v3CandidateOutput.reason_seeds,
      ],
    },
    fast_summary: {
      selected_path: "full_v0",
      state: universalOutput.state,
      risk_score: universalOutput.risk.score,
      control_level: universalOutput.control_level,
      execution_mode: universalOutput.execution_profile.mode,
      v3_selected_action_family: v3CandidateOutput.selected_action_family,
    },
  };
}

export function runAssistantClientSafeRuntime(input: AssistantShadowInput): AssistantClientSafeRuntimeOutput {
  const clientSafeIdentityContext = buildClientSafeIdentityContext(input);
  const hypothesisBatch = buildClientSafeHypothesisBatch(
    input,
    {
      owner_id: `${clientSafeIdentityContext.tenant_id}:${clientSafeIdentityContext.user_id}`,
      owner_verified: clientSafeIdentityContext.identity_verified,
      access_scope: clientSafeIdentityContext.identity_verified ? "limited" : "denied",
      session_id: clientSafeIdentityContext.session_id,
      identity_confidence: clientSafeIdentityContext.identity_confidence,
      verified_at: clientSafeIdentityContext.verified_at,
    },
    clientSafeIdentityContext,
  );

  if (!clientSafeIdentityContext.identity_verified) {
    return {
      client_safe_identity_context: clientSafeIdentityContext,
      hypothesis_batch: hypothesisBatch,
      runtime_policy: {
        policy_version: "client_safe_runtime_policy_v1",
        automation_level: "governed_multi_user",
        identity_gate: "denied",
        tenant_isolation: "denied",
        selected_runtime: "denied",
        final_control_level: "blocked",
        final_execution_mode: "blocked",
        response_visibility: "tenant_only",
        memory_access: "denied",
        override_policy: "denied",
        reason_codes: ["client_identity_not_verified"],
      },
    };
  }

  const shadowResult = runAssistantShadowMode(input);
  const selectedRuntime = shadowResult.runtime_policy.selected_path === "digest_runtime_v2" ? "v3_to_v2" : "v3_to_v0";
  const limitedTrackedOnly = clientSafeIdentityContext.role === "owner" || clientSafeIdentityContext.role === "admin";

  return {
    client_safe_identity_context: clientSafeIdentityContext,
    hypothesis_batch: hypothesisBatch,
    shadow_result: shadowResult,
    runtime_policy: {
      policy_version: "client_safe_runtime_policy_v1",
      automation_level: "governed_multi_user",
      identity_gate: "granted",
      tenant_isolation: "enforced",
      selected_runtime: selectedRuntime,
      final_control_level: shadowResult.comparable_output.control_level,
      final_execution_mode: shadowResult.comparable_output.execution_profile.mode,
      response_visibility: "tenant_only",
      memory_access: "tenant_private_only",
      override_policy: limitedTrackedOnly ? "limited_tracked_only" : "denied",
      reason_codes: [
        `tenant:${clientSafeIdentityContext.tenant_id}`,
        `role:${clientSafeIdentityContext.role}`,
        `prefilter:${shadowResult.v3_candidate_output.selected_action_family}`,
        `selected_path:${shadowResult.runtime_policy.selected_path}`,
      ],
    },
  };
}
