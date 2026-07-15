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

function interpretScalp(args = {}) {
  const locale = args.locale === "en" ? "en" : "it";
  const overall = normalizeMetrics(args.overall);
  const zones = (args.zones || []).map((zone) => ({ zone: String(zone.zone), metrics: normalizeMetrics(zone.metrics), priorities: priorities(normalizeMetrics(zone.metrics)).slice(0, 2) }));
  const ranked = priorities(overall);
  const lowConfidence = overall.confidence < 0.65 || zones.some((zone) => zone.metrics.confidence < 0.65);
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
    schema_version: "scalp_analyzer_interpretation_v1",
    mode: "read_only_local_metrics",
    overall,
    zones,
    dominant_pattern: ranked[0],
    secondary_patterns: ranked.slice(1, 3),
    data_quality: { confidence: overall.confidence, repeat_acquisition_recommended: lowConfidence },
    suggested_direction: messages.direction,
    safety_boundary: messages.boundary,
    governance: {
      tenant_scoped: true,
      execution_allowed: false,
      diagnosis_allowed: false,
      prescription_allowed: false,
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
