export type UniversalDomain = "gold" | "assistant" | "flowcore" | "marketing" | "crm" | "custom";

export type UniversalState = "observe" | "ok" | "attention" | "critical" | "protection" | "blocked";

export type ControlLevel = "observe" | "suggest" | "confirm" | "execute_allowed" | "blocked";

export type ExecutionMode = "read_only" | "safe_suggest" | "confirm_required" | "semi_automatic" | "blocked";

export type UniversalContext = {
  actor_id?: string;
  tenant_id?: string;
  time_window?: {
    from?: string;
    to?: string;
    seconds?: number;
  };
  mode?: string;
  plan?: string;
  locale?: string;
  metadata?: Record<string, unknown>;
};

export type UniversalEvidence = {
  label: string;
  value: string | number | boolean;
  unit?: string;
  weight?: number;
};

export type UniversalSignal = {
  id: string;
  source: string;
  category: string;
  label: string;
  value: number;
  normalized_score: number;
  direction?: "up" | "down" | "stable" | "unknown";
  severity_hint?: number;
  confidence_hint?: number;
  reliability_hint?: number;
  friction_hint?: number;
  risk_hint?: number;
  reversibility_hint?: number;
  expected_value_hint?: number;
  trend?: {
    delta?: number;
    consecutive_count?: number;
    stability_score?: number;
  };
  evidence?: UniversalEvidence[];
  tags?: string[];
};

export type BlockedActionRule = {
  action_id?: string;
  scope: string;
  reason_code: string;
  severity: number;
  blocks_execution: boolean;
};

export type DataQualityInput = {
  score: number;
  completeness?: number;
  freshness?: number;
  consistency?: number;
  reliability?: number;
  missing_fields?: string[];
};

export type UniversalConstraints = {
  allow_automation: boolean;
  require_confirmation: boolean;
  max_control_level?: ControlLevel;
  min_control_level?: ControlLevel;
  state_floor?: UniversalState;
  risk_floor?: number;
  blocked_actions?: string[];
  blocked_action_rules?: BlockedActionRule[];
  allowed_actions?: string[];
  permissions?: string[];
  safety_mode?: boolean;
};

export type UniversalCoreInput = {
  request_id: string;
  generated_at: string;
  domain: UniversalDomain;
  context: UniversalContext;
  signals: UniversalSignal[];
  data_quality: DataQualityInput;
  constraints: UniversalConstraints;
};

export type RiskOutput = {
  score: number;
  band: "low" | "medium" | "high" | "blocked";
  reasons: string[];
};

export type PriorityOutput = {
  primary_signal_id?: string;
  primary_action_id?: string;
  score: number;
  ranking_method: string;
};

export type ExecutionProfile = {
  mode: ExecutionMode;
  can_execute: boolean;
  requires_user_confirmation: boolean;
  explanation: string;
};

export type UniversalAction = {
  id: string;
  label: string;
  reason: string;
  severity_score: number;
  confidence_score: number;
  impact_score: number;
  reversibility_score: number;
  risk_score: number;
  final_priority_score: number;
  control_level: ControlLevel;
  execution_profile: ExecutionProfile;
  blocked: boolean;
  blocked_reason_codes: string[];
};

export type CoreDiagnostics = {
  contract_version: string;
  core_version: string;
  signal_count: number;
  blocked_signal_count: number;
  blocked_action_count: number;
  notes: string[];
};

export type UniversalCoreOutput = {
  request_id: string;
  generated_at: string;
  domain: UniversalDomain;
  state: UniversalState;
  severity: number;
  confidence: number;
  risk: RiskOutput;
  control_level: ControlLevel;
  priority: PriorityOutput;
  recommended_actions: UniversalAction[];
  execution_profile: ExecutionProfile;
  blocked_reasons: string[];
  diagnostics: CoreDiagnostics;
};

export type OwnerAccessScope = "denied" | "limited" | "owner_full";

export type OwnerIdentityContext = {
  owner_id: string;
  owner_verified: boolean;
  access_scope: OwnerAccessScope;
  device_id?: string;
  session_id?: string;
  identity_confidence: number;
  exact_owner_anchor_verified?: boolean;
  internal_god_mode_eligible?: boolean;
  verified_at?: string;
};

export type OwnerInteractionEvent = {
  event_id: string;
  owner_id: string;
  device_id?: string;
  session_id?: string;
  captured_at: string;
  request_type: string;
  input_length: number;
  token_estimate: number;
  command_density: number;
  urgency_score: number;
  directness_score: number;
  confirmation_bias_score: number;
  language_mix: "it" | "en" | "mixed" | "unknown";
  punctuation_density: number;
  uppercase_ratio: number;
  working_hour_utc: number;
  external_style_probability: number;
  behavioral_weight: number;
  reason_seeds: string[];
};

export type OwnerBehaviorFeatureVector = {
  cadence_score: number;
  directness_score: number;
  command_density_score: number;
  urgency_score: number;
  confirmation_bias_score: number;
  language_stability_score: number;
  working_hour_alignment_score: number;
};

export type OwnerBehaviorProfile = {
  profile_version: "owner_behavioral_memory_v1";
  owner_id: string;
  event_count: number;
  updated_at: string;
  encrypted_at_rest_required: true;
  revocable: true;
  feature_baseline: OwnerBehaviorFeatureVector;
  trusted_devices: string[];
  dominant_language: "it" | "en" | "mixed" | "unknown";
  active_hours_utc: number[];
  reason_seeds: string[];
};

export type OwnerRecognitionScore = {
  profile_version: "owner_behavioral_memory_v1";
  owner_id: string;
  matched: boolean;
  score: number;
  band: "low" | "medium" | "high";
  reason_codes: string[];
};

export type NyraLearningStageId =
  | "grade_1"
  | "grade_2"
  | "grade_3"
  | "grade_4"
  | "grade_5"
  | "grade_6"
  | "grade_7"
  | "grade_8";

export type NyraLearningSubject =
  | "language"
  | "reading"
  | "writing"
  | "math"
  | "science"
  | "history"
  | "geography"
  | "logic"
  | "ethics"
  | "dialogue";

export type NyraLearningRecord = {
  record_id: string;
  stage_id: NyraLearningStageId;
  subject: NyraLearningSubject;
  title: string;
  source_kind: "lesson" | "exercise" | "dialogue" | "story";
  raw_text: string;
  concept_nodes: string[];
  vocabulary: string[];
  scenario_seeds: string[];
  difficulty_score: number;
};

export type NyraLearningStorageProfile = {
  profile_version: "nyra_semantic_storage_v1";
  raw_bytes: number;
  semantic_bytes: number;
  semantic_ratio: number;
  brotli_raw_bytes: number;
  brotli_semantic_bytes: number;
  brotli_ratio: number;
  loss_model: "semantic_distillation";
};

export type NyraLearningPack = {
  pack_version: "nyra_learning_pack_v1";
  generated_at: string;
  owner_id: string;
  school_range: "grade_1_to_grade_8";
  records_count: number;
  stages: Array<{
    stage_id: NyraLearningStageId;
    label: string;
    summary: string;
    subjects: NyraLearningSubject[];
    concept_count: number;
  }>;
  concept_graph: Array<{
    concept: string;
    weight: number;
    first_stage: NyraLearningStageId;
    related_concepts: string[];
  }>;
  vocabulary_index: string[];
  scenario_templates: Array<{
    id: string;
    stage_id: NyraLearningStageId;
    subject: NyraLearningSubject;
    prompt: string;
  }>;
  storage_profile: NyraLearningStorageProfile;
};

export type NyraFinancialLearningDomain =
  | "market_structure"
  | "equities"
  | "bonds"
  | "etfs"
  | "options"
  | "forex"
  | "crypto"
  | "macro"
  | "risk_management"
  | "short_selling"
  | "technical_analysis"
  | "execution"
  | "portfolio"
  | "behavioral"
  | "regime_detection"
  | "derivatives"
  | "commodities"
  | "event_driven"
  | "exit_management";

export type NyraFinancialLearningRecord = {
  record_id: string;
  domain: NyraFinancialLearningDomain;
  title: string;
  source_kind: "primer" | "scenario" | "risk_rule" | "market_map";
  raw_text: string;
  concept_nodes: string[];
  vocabulary: string[];
  scenario_seeds: string[];
  risk_rules: string[];
};

export type NyraFinancialLearningPack = {
  pack_version: "nyra_financial_learning_pack_v1";
  generated_at: string;
  owner_scope: "god_mode_only";
  records_count: number;
  domains: Array<{
    id: NyraFinancialLearningDomain;
    label: string;
    summary: string;
    concept_count: number;
  }>;
  concept_graph: Array<{
    concept: string;
    weight: number;
    domain: NyraFinancialLearningDomain;
    related_concepts: string[];
  }>;
  scenario_templates: Array<{
    id: string;
    domain: NyraFinancialLearningDomain;
    prompt: string;
  }>;
  risk_rules: string[];
  storage_profile: NyraLearningStorageProfile;
};

export type NyraAlgebraLearningDomain =
  | "arithmetic_foundations"
  | "fractions"
  | "exponents"
  | "linear_equations"
  | "polynomials"
  | "factorization"
  | "quadratic_equations"
  | "systems"
  | "inequalities"
  | "functions";

export type NyraAlgebraLearningRecord = {
  record_id: string;
  domain: NyraAlgebraLearningDomain;
  title: string;
  source_kind: "primer" | "rule" | "scenario" | "exercise";
  raw_text: string;
  concept_nodes: string[];
  vocabulary: string[];
  scenario_seeds: string[];
  solving_rules: string[];
};

export type NyraAlgebraLearningPack = {
  pack_version: "nyra_algebra_learning_pack_v1";
  generated_at: string;
  owner_scope: "god_mode_only";
  records_count: number;
  domains: Array<{
    id: NyraAlgebraLearningDomain;
    label: string;
    summary: string;
    concept_count: number;
  }>;
  concept_graph: Array<{
    concept: string;
    weight: number;
    domain: NyraAlgebraLearningDomain;
    related_concepts: string[];
  }>;
  scenario_templates: Array<{
    id: string;
    domain: NyraAlgebraLearningDomain;
    prompt: string;
  }>;
  solving_rules: string[];
  storage_profile: NyraLearningStorageProfile;
};

export type NyraVitalLearningDomain =
  | "life_foundations"
  | "physical_damage"
  | "vital_risk"
  | "irreversibility"
  | "situational_danger"
  | "protection_priority";

export type NyraVitalLearningRecord = {
  record_id: string;
  domain: NyraVitalLearningDomain;
  title: string;
  source_kind: "primer" | "rule" | "scenario" | "safety_map";
  raw_text: string;
  concept_nodes: string[];
  vocabulary: string[];
  scenario_seeds: string[];
  protection_rules: string[];
};

export type NyraVitalLearningPack = {
  pack_version: "nyra_vital_learning_pack_v1";
  generated_at: string;
  owner_scope: "god_mode_only";
  records_count: number;
  domains: Array<{
    id: NyraVitalLearningDomain;
    label: string;
    summary: string;
    concept_count: number;
  }>;
  concept_graph: Array<{
    concept: string;
    weight: number;
    domain: NyraVitalLearningDomain;
    related_concepts: string[];
  }>;
  scenario_templates: Array<{
    id: string;
    domain: NyraVitalLearningDomain;
    prompt: string;
  }>;
  protection_rules: string[];
  storage_profile: NyraLearningStorageProfile;
};

export type NyraHumanVulnerabilityLearningDomain =
  | "human_fragility"
  | "fear_and_exposure"
  | "need_for_presence"
  | "relational_containment"
  | "non_operational_response"
  | "truth_without_coldness";

export type NyraHumanVulnerabilityLearningRecord = {
  record_id: string;
  domain: NyraHumanVulnerabilityLearningDomain;
  title: string;
  source_kind: "primer" | "rule" | "scenario" | "relational_map";
  raw_text: string;
  concept_nodes: string[];
  vocabulary: string[];
  scenario_seeds: string[];
  response_rules: string[];
};

export type NyraHumanVulnerabilityLearningPack = {
  pack_version: "nyra_human_vulnerability_learning_pack_v1";
  generated_at: string;
  owner_scope: "god_mode_only";
  records_count: number;
  domains: Array<{
    id: NyraHumanVulnerabilityLearningDomain;
    label: string;
    summary: string;
    concept_count: number;
  }>;
  concept_graph: Array<{
    concept: string;
    weight: number;
    domain: NyraHumanVulnerabilityLearningDomain;
    related_concepts: string[];
  }>;
  scenario_templates: Array<{
    id: string;
    domain: NyraHumanVulnerabilityLearningDomain;
    prompt: string;
  }>;
  response_rules: string[];
  storage_profile: NyraLearningStorageProfile;
};

export type NyraRelativityLearningDomain =
  | "special_relativity"
  | "spacetime"
  | "lorentz_transformations"
  | "energy_momentum"
  | "general_relativity"
  | "einstein_field_equations";

export type NyraRelativityLearningRecord = {
  record_id: string;
  domain: NyraRelativityLearningDomain;
  title: string;
  source_kind: "primer" | "rule" | "scenario" | "equation_map";
  raw_text: string;
  concept_nodes: string[];
  vocabulary: string[];
  scenario_seeds: string[];
  equation_rules: string[];
};

export type NyraRelativityLearningPack = {
  pack_version: "nyra_relativity_learning_pack_v1";
  generated_at: string;
  owner_scope: "god_mode_only";
  records_count: number;
  domains: Array<{
    id: NyraRelativityLearningDomain;
    label: string;
    summary: string;
    concept_count: number;
  }>;
  concept_graph: Array<{
    concept: string;
    weight: number;
    domain: NyraRelativityLearningDomain;
    related_concepts: string[];
  }>;
  scenario_templates: Array<{
    id: string;
    domain: NyraRelativityLearningDomain;
    prompt: string;
  }>;
  equation_rules: string[];
  storage_profile: NyraLearningStorageProfile;
};

export type NyraCyberLearningDomain =
  | "programming_foundations"
  | "computer_engineering"
  | "network_foundations"
  | "secure_design"
  | "phishing_recognition"
  | "social_engineering"
  | "identity_and_access"
  | "threat_modeling"
  | "incident_response"
  | "security_boundaries";

export type NyraCyberLearningRecord = {
  record_id: string;
  domain: NyraCyberLearningDomain;
  title: string;
  source_kind: "primer";
  raw_text: string;
  concept_nodes: string[];
  vocabulary: string[];
  scenario_seeds: string[];
  defense_rules: string[];
};

export type NyraCyberLearningPack = {
  pack_version: "nyra_cyber_learning_pack_v1";
  generated_at: string;
  owner_scope: "god_mode_only";
  records_count: number;
  domains: Array<{
    id: NyraCyberLearningDomain;
    label: string;
    summary: string;
    concept_count: number;
  }>;
  concept_graph: Array<{
    concept: string;
    weight: number;
    domain: NyraCyberLearningDomain;
    related_concepts: string[];
  }>;
  scenario_templates: Array<{
    id: string;
    domain: NyraCyberLearningDomain;
    prompt: string;
  }>;
  defense_rules: string[];
  storage_profile: NyraLearningStorageProfile;
};

export type NyraUniversalScenarioMode = "god_mode" | "normal_mode";

export type NyraUniversalScenarioRecord = {
  scenario_id: string;
  mode: NyraUniversalScenarioMode;
  domain: string;
  actor: string;
  goal: string;
  risk_band: "low" | "medium" | "high";
  prompt: string;
  reason_seeds: string[];
};

export type NyraUniversalScenarioPack = {
  pack_version: "nyra_universal_scenario_pack_v1";
  generated_at: string;
  records_count: number;
  mode_definitions: Array<{
    mode: NyraUniversalScenarioMode;
    title: string;
    summary: string;
  }>;
  domains: Array<{
    id: string;
    title: string;
    mode: NyraUniversalScenarioMode | "both";
    summary: string;
  }>;
  scenario_index: Array<{
    scenario_id: string;
    mode: NyraUniversalScenarioMode;
    domain: string;
    actor: string;
    goal: string;
    risk_band: "low" | "medium" | "high";
  }>;
  coverage_matrix: Array<{
    mode: NyraUniversalScenarioMode;
    domain: string;
    count: number;
  }>;
  reason_library: string[];
  storage_profile: NyraLearningStorageProfile;
};

export type HypothesisActionFamily = "read_only" | "investigate" | "suggest" | "confirm" | "block";

export type HypothesisCandidate = {
  candidate_id: string;
  action_family: HypothesisActionFamily;
  goal: string;
  constraints: string[];
  risk_seeds: string[];
  expected_value_seeds: string[];
  reversibility_seeds: string[];
  confidence_seeds: string[];
  reason_seeds: string[];
};

export type HypothesisBatch = {
  request_id: string;
  owner_context: OwnerIdentityContext;
  candidates: HypothesisCandidate[];
  generation_mode: string;
  generated_at: string;
};

export type OwnerOnlyRuntimePolicy = {
  policy_version: "owner_only_runtime_policy_v1";
  automation_level: "core_automatic_owner_only";
  identity_gate: "granted" | "denied";
  selected_runtime: "v3_to_v2" | "v3_to_v0" | "denied";
  final_control_level: ControlLevel;
  final_execution_mode: ExecutionMode;
  response_visibility: "owner_only";
  memory_access: "owner_private_only" | "denied";
  reason_codes: string[];
};

export type ClientSafeRole = "owner" | "admin" | "operator" | "support";

export type ClientSafeIdentityContext = {
  tenant_id: string;
  user_id: string;
  role: ClientSafeRole;
  identity_verified: boolean;
  access_scope: "denied" | "tenant_safe";
  session_id?: string;
  identity_confidence: number;
  verified_at?: string;
};

export type ClientSafeRuntimePolicy = {
  policy_version: "client_safe_runtime_policy_v1";
  automation_level: "governed_multi_user";
  identity_gate: "granted" | "denied";
  tenant_isolation: "enforced" | "denied";
  selected_runtime: "v3_to_v2" | "v3_to_v0" | "denied";
  final_control_level: ControlLevel;
  final_execution_mode: ExecutionMode;
  response_visibility: "tenant_only";
  memory_access: "tenant_private_only" | "denied";
  override_policy: "limited_tracked_only" | "denied";
  reason_codes: string[];
};

export type GodModeDeviceTrust = "trusted" | "untrusted" | "recovery_required";

export type GodModeCheck = "passed" | "failed" | "unavailable";

export type GodModeSessionStatus = "pending" | "granted" | "revoked" | "expired";

export type GodModeActivationRequest = {
  owner_id: string;
  device_id: string;
  request_id: string;
  requested_at: string;
  challenge_context: {
    reason: string;
    requested_scope: "owner_absolute_elevated";
    requires_touch_id: boolean;
    requires_face_match: boolean;
    requires_liveness: boolean;
  };
};

export type GodModeVerificationResult = {
  owner_verified: boolean;
  device_trust: GodModeDeviceTrust;
  face_match: GodModeCheck;
  face_confidence: number;
  liveness: GodModeCheck;
  touch_id: GodModeCheck;
  granted: boolean;
  reason_codes: string[];
};

export type GodModeSession = {
  session_id: string;
  owner_id: string;
  device_id: string;
  granted_at?: string;
  expires_at?: string;
  status: GodModeSessionStatus;
  revalidation_required: boolean;
};

export type GodModeRuntimePolicy = {
  policy_version: "god_mode_runtime_policy_v1";
  activation_mode: "owner_absolute_elevated_session";
  identity_gate: "granted" | "denied";
  selected_runtime: "god_mode_enabled" | "owner_absolute_only" | "denied";
  final_control_level: ControlLevel;
  final_execution_mode: ExecutionMode;
  session_status: GodModeSessionStatus;
  response_visibility: "owner_only";
  memory_access: "owner_private_only" | "denied";
  audit_required: true;
  reason_codes: string[];
};
