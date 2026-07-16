function textResult(payload) {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

function bounded(value, fallback = 0, minimum = 0, maximum = 100) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
}

function normalizeMetrics(input = {}) {
  return {
    density_index: bounded(input.density_index, 50),
    shaft_caliber_index: bounded(input.shaft_caliber_index, 50),
    miniaturization_index: bounded(input.miniaturization_index),
    single_unit_percent: bounded(input.single_unit_percent),
    double_triple_unit_percent: bounded(input.double_triple_unit_percent),
    empty_ostia_percent: bounded(input.empty_ostia_percent),
    broken_hair_percent: bounded(input.broken_hair_percent),
    desquamation_percent: bounded(input.desquamation_percent),
    sebum_plug_percent: bounded(input.sebum_plug_percent),
    redness_percent: bounded(input.redness_percent),
    ostium_diameter_index: bounded(input.ostium_diameter_index, 50),
    ostium_diameter_pixels: bounded(input.ostium_diameter_pixels, 0, 0, 100_000),
    ostia_count: Math.trunc(bounded(input.ostia_count, 0, 0, 1_000_000)),
    confidence: bounded(input.confidence, 0.5, 0, 1),
  };
}

function priorities(metrics) {
  return [
    { id: "density_distribution", label: "distribuzione visiva della densita", score: Math.round((100 - metrics.density_index) * 0.65 + metrics.empty_ostia_percent * 0.35) },
    { id: "shaft_variability", label: "variabilita visiva dei fusti", score: Math.round(metrics.miniaturization_index * 0.55 + (100 - metrics.shaft_caliber_index) * 0.3 + metrics.broken_hair_percent * 0.15) },
    { id: "surface_balance", label: "equilibrio cosmetico della superficie", score: Math.round(metrics.desquamation_percent * 0.45 + metrics.sebum_plug_percent * 0.35 + metrics.redness_percent * 0.2) },
    { id: "follicular_units", label: "distribuzione visiva delle unita follicolari", score: Math.round(metrics.single_unit_percent * 0.5 + (100 - metrics.double_triple_unit_percent) * 0.3 + metrics.empty_ostia_percent * 0.2) },
  ].map((item) => ({ ...item, score: bounded(item.score) })).sort((left, right) => right.score - left.score);
}

const WARNING_SIGNALS = new Set(["sudden_change", "pain", "bleeding", "open_lesion", "infection_suspected"]);
const PROFESSIONAL_PROFILES = new Set(["medical_study", "salon_trichology", "pharmacy_dermocosmetic"]);

function professionalProfile(value) {
  const id = PROFESSIONAL_PROFILES.has(String(value)) ? String(value) : "salon_trichology";
  const profiles = {
    medical_study: { label: "Studio medico / dermatologico", output_mode: "clinician_review_dossier", audience: "licensed_clinician", language: "quantitative_observations_with_clinical_correlation_required", allowed: ["acquisition_quality", "zone_measurements", "longitudinal_deltas", "uncertainty", "review_questions"], blocked: ["ai_diagnosis", "ai_differential_diagnosis", "treatment_plan", "prescription"] },
    salon_trichology: { label: "Parrucchiere / tecnico tricologico", output_mode: "technical_cosmetic_consultation", audience: "trained_hair_professional", language: "technical_observational_cosmetic", allowed: ["surface_balance", "shaft_quality", "zone_comparison", "cosmetic_protocol_direction", "follow_up"], blocked: ["diagnosis", "disease_name", "hair_loss_cause", "therapy", "prescription"] },
    pharmacy_dermocosmetic: { label: "Farmacia dermocosmetica", output_mode: "dermocosmetic_counselling", audience: "pharmacist_or_trained_staff", language: "dermocosmetic_tolerability_and_adherence", allowed: ["surface_balance", "tolerability_questions", "ingredient_family_direction", "routine_adherence", "follow_up"], blocked: ["diagnosis", "drug_recommendation", "prescription", "therapeutic_claim"] },
  };
  return { id, ...profiles[id] };
}

function communicationPack(profile, dominant, abstain, stop) {
  const patternLabels = { density_distribution: "distribuzione visiva e uniformita delle aree osservate", shaft_variability: "qualita visiva e variabilita dei fusti", surface_balance: "equilibrio cosmetico della superficie del cuoio capelluto", follicular_units: "distribuzione visiva delle unita follicolari", data_quality: "qualita dell'acquisizione" };
  const focus = patternLabels[dominant?.id || "data_quality"] || patternLabels.data_quality;
  const base = {
    headline: abstain || stop ? "Prima una rilevazione affidabile" : "Una lettura piu precisa del benessere visivo di cute e capelli",
    value_proposition: abstain || stop ? "La consulenza si ferma quando i dati non sono sufficienti o richiedono valutazione professionale." : `Il percorso mette a fuoco ${focus} e ne segue l'andamento con acquisizioni comparabili.`,
    proof_points: ["qualita dello scatto dichiarata", "confronto per zone", "andamento verificabile nel tempo"],
    cta: profile.id === "medical_study" ? "Prepara il dossier per la revisione del professionista" : "Prenota una consulenza tricologica cosmetica con nuova rilevazione",
    forbidden_claims: ["diagnosi AI", "cura la caduta", "blocca la caduta", "ricrescita garantita", "risultato clinico certo"],
    publish_ready: false, owner_review_required: true,
  };
  if (profile.id === "medical_study") return { ...base, marketing_allowed: false, purpose: "professional_information_only" };
  return { ...base, marketing_allowed: !abstain && !stop, purpose: "cosmetic_consultation_marketing" };
}

function acquisitionQuality(input = {}, confidence = 0.5) {
  const focus = bounded(input.focus_score, confidence * 100) / 100;
  const illumination = bounded(input.illumination_score, confidence * 100) / 100;
  const coverage = bounded(input.zone_coverage_score, confidence * 100) / 100;
  const provenance = Boolean(input.device_model && input.magnification && input.capture_protocol_id);
  const score = Math.round((confidence * 0.4 + focus * 0.25 + illumination * 0.2 + coverage * 0.15) * 100);
  const reasons = [...(focus < 0.65 ? ["focus_low"] : []), ...(illumination < 0.65 ? ["illumination_low"] : []), ...(coverage < 0.6 ? ["zone_coverage_low"] : []), ...(!provenance ? ["capture_provenance_incomplete"] : [])];
  return { score, focus, illumination, coverage, provenance_complete: provenance, reasons };
}

function comparableCapture(current = {}, previous = {}) {
  if (!previous || typeof previous !== "object") return { available: false, comparable: false, reasons: ["previous_capture_missing"] };
  const fields = ["device_model", "magnification", "capture_protocol_id", "polarization"];
  const reasons = fields.filter((field) => !current[field] || !previous[field] || String(current[field]) !== String(previous[field])).map((field) => `${field}_mismatch`);
  return { available: true, comparable: reasons.length === 0, reasons };
}

function metricDeltas(current, previous) {
  return Object.fromEntries(Object.keys(current).filter((key) => key !== "confidence" && Number.isFinite(previous[key])).map((key) => [key, Math.round((current[key] - previous[key]) * 10) / 10]));
}

function interpretScalp(args = {}) {
  const locale = args.locale === "en" ? "en" : "it";
  const overall = normalizeMetrics(args.overall);
  const zones = (args.zones || []).map((zone) => ({ zone: String(zone.zone), metrics: normalizeMetrics(zone.metrics), priorities: priorities(normalizeMetrics(zone.metrics)).slice(0, 2) }));
  const ranked = priorities(overall);
  const quality = acquisitionQuality(args.acquisition, overall.confidence);
  const comparison = comparableCapture(args.acquisition, args.previous?.acquisition);
  const previousOverall = args.previous?.overall ? normalizeMetrics(args.previous.overall) : null;
  const warningSignals = [...new Set((args.reported_warning_signals || []).map(String).filter((item) => WARNING_SIGNALS.has(item)))];
  const stopCosmeticInterpretation = warningSignals.length > 0;
  const lowConfidence = overall.confidence < 0.65 || quality.score < 65 || zones.some((zone) => zone.metrics.confidence < 0.65);
  const abstain = lowConfidence || stopCosmeticInterpretation;
  const learning = args.learning_context || {};
  const learningEligible = comparison.comparable && previousOverall && learning.outcome_verified === true && learning.human_reviewed === true && bounded(learning.comparable_capture_count, 0, 0, 1_000_000) >= 2;
  const profile = professionalProfile(args.professional_profile);
  const communication = communicationPack(profile, ranked[0], abstain, stopCosmeticInterpretation);
  const messages = locale === "en"
    ? {
        direction: "Use the dominant visual pattern to guide a conservative cosmetic consultation and repeat acquisition when quality is low.",
        boundary: "Non-diagnostic cosmetic observation. It does not identify disease, hair-loss cause, treatment, or prescription.",
      }
    : {
        direction: "Usare il pattern visivo dominante per una consulenza cosmetica prudente e ripetere l'acquisizione quando la qualita e bassa.",
        boundary: "Osservazione cosmetica non diagnostica: non identifica patologie, cause di caduta, terapie o prescrizioni.",
      };
  return {
    ok: true,
    schema_version: "scalp_analyzer_interpretation_v2",
    mode: "read_only_local_metrics",
    overall,
    zones,
    dominant_pattern: abstain ? null : ranked[0], secondary_patterns: abstain ? [] : ranked.slice(1, 3),
    data_quality: { confidence: overall.confidence, ...quality, abstained: abstain, repeat_acquisition_recommended: lowConfidence },
    longitudinal: { ...comparison, deltas: comparison.comparable && previousOverall ? metricDeltas(overall, previousOverall) : {}, interpretation_allowed: comparison.comparable && !abstain },
    warning_gate: { reported_signals: warningSignals, stop_cosmetic_interpretation: stopCosmeticInterpretation, professional_review_recommended: stopCosmeticInterpretation },
    learning: { eligible_candidate: Boolean(learningEligible), activation_allowed: false, requires: ["verified_outcome", "human_review", "comparable_capture_series", "core_regression_gate"], reason: learningEligible ? "verified_candidate_ready_for_core_review" : "insufficient_verified_comparable_evidence" },
    professional_context: { ...profile, ai_role: profile.id === "medical_study" ? "measurement_and_documentation_support" : "cosmetic_observation_support", clinician_review_required: profile.id === "medical_study", professional_decision_required: true },
    communication,
    suggested_direction: stopCosmeticInterpretation ? null : lowConfidence ? "repeat_acquisition" : messages.direction,
    safety_boundary: messages.boundary,
    governance: {
      tenant_scoped: true,
      execution_allowed: false,
      diagnosis_allowed: false,
      prescription_allowed: false,
      abstention_enforced: true, learning_requires_verified_outcome: true, live_weight_mutation_allowed: false,
      impersonation_allowed: false, medical_conclusion_allowed: false, marketing_auto_publish_allowed: false,
      raw_images_received: false,
      publish_requires_owner_confirmation: true,
    },
  };
}

export function createAnalyzerHandlers() {
  return {
    scalp_analyzer: async (args) => textResult(interpretScalp(args)),
  };
}

export { interpretScalp, normalizeMetrics };
