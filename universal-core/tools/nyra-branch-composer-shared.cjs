function summarizeActiveBranches(branchOverlay) {
  if (!branchOverlay || typeof branchOverlay !== "object") return "";
  const active = Array.isArray(branchOverlay.active_branches) ? branchOverlay.active_branches : [];
  const primary = branchOverlay.primary_branch && typeof branchOverlay.primary_branch === "object"
    ? branchOverlay.primary_branch.id || ""
    : "";
  return active.slice(0, 3).map((branch) => branch.id).join(", ") || primary;
}

const ANALYZER_BRANCH_META_BY_KEY = {
  skin_tone_brightness: {
    id: "pigmentation_tone_matrix",
    label: "tono e uniformita",
    why: "luminosita e discromie vanno lette come uniformita del tono",
  },
  water_oil_balance: {
    id: "barrier_hydration_matrix",
    label: "barriera e idratazione",
    why: "comfort, film idrolipidico e tollerabilita guidano la progressione",
  },
  texture_fine_lines: {
    id: "aging_texture_matrix",
    label: "texture e micro-rilievo",
    why: "trama e linee superficiali richiedono progressione, non correzione brusca",
  },
  redness_sensitivity_signals: {
    id: "sensitivity_reactivity_matrix",
    label: "reattivita e rossore",
    why: "la tollerabilita viene prima dell'intensita",
  },
  spots_pigmentation_signals: {
    id: "pigmentation_tone_matrix",
    label: "discromie e pigmento",
    why: "tono non uniforme e pigmento vanno letti con fotoprotezione e costanza",
  },
  pores_texture: {
    id: "pores_texture_matrix",
    label: "pori, grana e pattern follicolare",
    why: "pori, grana e assetto sebaceo vanno letti insieme",
  },
};

const ANALYZER_BRANCH_META_BY_ID = {
  pores_texture_matrix: ANALYZER_BRANCH_META_BY_KEY.pores_texture,
  sensitivity_reactivity_matrix: ANALYZER_BRANCH_META_BY_KEY.redness_sensitivity_signals,
  barrier_hydration_matrix: ANALYZER_BRANCH_META_BY_KEY.water_oil_balance,
  pigmentation_tone_matrix: ANALYZER_BRANCH_META_BY_KEY.spots_pigmentation_signals,
  aging_texture_matrix: ANALYZER_BRANCH_META_BY_KEY.texture_fine_lines,
  catalog_choice_matrix: {
    id: "catalog_choice_matrix",
    label: "scelta catalogo coerente",
    why: "catalogo e proposta vanno dopo la lettura del quadro, non prima",
  },
  service_product_technology_overlap: {
    id: "service_product_technology_overlap",
    label: "sovrapposizione servizi, prodotti e tecnologie",
    why: "la proposta si sceglie solo dove i segnali convergono",
  },
  formulation_compatibility_guard: {
    id: "formulation_compatibility_guard",
    label: "compatibilita formulativa",
    why: "attivi e texture vanno scelti secondo tollerabilita e contesto",
  },
  anamnesis_sales_guard: {
    id: "anamnesis_sales_guard",
    label: "coerenza anamnesi e vendita",
    why: "dichiarato cliente e segnale osservato non vanno confusi",
  },
  technology_claim_guard: {
    id: "technology_claim_guard",
    label: "guardrail claim tecnologia",
    why: "nessuna promessa tecnica o terapeutica non supportata",
  },
  post_treatment_timing_guard: {
    id: "post_treatment_timing_guard",
    label: "contesto post-trattamento",
    why: "reattivita e variazioni temporanee non vanno lette come quadro stabile",
  },
};

function getAnalyzerBranchMetaByKeyData(key, fallback) {
  return ANALYZER_BRANCH_META_BY_KEY[key] || fallback;
}

function getAnalyzerBranchMetaByIdData(id, fallback) {
  return ANALYZER_BRANCH_META_BY_ID[id] || fallback;
}

function buildNyraBranchSummaryNotesData(bundle) {
  const notes = [
    `Rami attivi: ${summarizeActiveBranches(bundle.branch_overlay)}`,
    `Route: ${bundle.action_route?.intent || "unknown"}, modo ${bundle.action_route?.execution_mode || "unknown"}`,
    `Core: V2 ${bundle.core2_pipeline?.stages?.v2?.control_level || "unknown"}, V7 ${bundle.core2_pipeline?.stages?.v7?.path_label || "unknown"}`,
  ];
  const learningEntries = Array.isArray(bundle?.branch_learning?.entries) ? bundle.branch_learning.entries : [];
  if (learningEntries.length) {
    notes.push(
      `Learning rami: ${learningEntries.slice(0, 3).map((entry) => (
        `${entry.branch_id}:${(Array.isArray(entry.sources) ? entry.sources : []).slice(0, 2).map((source) => source.title).join(" + ")}`
      )).join(" | ")}`
    );
  }
  return notes;
}

function buildNyraBranchSummaryLineData(bundle) {
  return buildNyraBranchSummaryNotesData(bundle).map((line) => `${line}.`).join(" ");
}

function mergeAnalyzerBranchCandidates(candidates) {
  const merged = new Map();
  (Array.isArray(candidates) ? candidates : []).filter(Boolean).forEach((candidate) => {
    const key = candidate.id || candidate.label;
    if (!key) return;
    if (!merged.has(key)) {
      merged.set(key, { ...candidate, sources: [candidate.source].filter(Boolean) });
      return;
    }
    const current = merged.get(key);
    current.score = Math.max(current.score || 0, candidate.score || 0);
    current.why = current.why || candidate.why || "";
    current.metric_key = current.metric_key || candidate.metric_key || "";
    current.metric_label = current.metric_label || candidate.metric_label || "";
    current.severity = current.severity || candidate.severity || "";
    if (candidate.source && !current.sources.includes(candidate.source)) current.sources.push(candidate.source);
  });
  return Array.from(merged.values()).sort((a, b) => (b.score - a.score) || String(a.id).localeCompare(String(b.id)));
}

function computeAnalyzerV7Overlay(params) {
  const riskScore = Number(params?.core_v2_digest?.risk_score) || 34;
  const blocked = Number(params?.core_v2_digest?.blocked_action_count) || 0;
  const secondaryCount = Array.isArray(params?.secondary) ? params.secondary.length : 0;
  const stableCount = Array.isArray(params?.stable) ? params.stable.length : 0;
  const relationshipCount = Array.isArray(params?.relationships) ? params.relationships.length : 0;
  const familyCount = Array.isArray(params?.families) ? params.families.length : 0;
  const overlapScore = Math.round(
    Math.min(
      100,
      26
        + secondaryCount * 11
        + relationshipCount * 9
        + familyCount * 6
        + (stableCount ? 4 : 0)
        + Math.max(0, riskScore - 40) * 0.25
    )
  );
  const pathLabel = blocked > 0 || riskScore >= 72
    ? "protect"
    : overlapScore >= 68 || secondaryCount >= 2
      ? "verify"
      : "normal";
  return {
    overlap_score: overlapScore,
    path_label: pathLabel,
    why: pathLabel === "protect"
      ? "il quadro richiede prudenza massima e guardrail forti"
      : pathLabel === "verify"
        ? "il quadro ha rami sovrapposti che vanno letti insieme prima della proposta"
        : "il quadro resta leggibile con un ramo dominante e pochi vincoli di sovrapposizione",
  };
}

function buildAnalyzerCoreOverlayData(input) {
  const coreV2Digest = input?.core_v2_digest || {};
  const explicitCoreBranches = Array.isArray(input?.explicit_core_branches) ? input.explicit_core_branches.filter(Boolean) : [];
  const v0Branches = Array.isArray(input?.v0_branches) ? input.v0_branches.filter(Boolean) : [];
  const v2Branches = Array.isArray(input?.v2_branches) ? input.v2_branches.filter(Boolean) : [];
  const merged = mergeAnalyzerBranchCandidates([...explicitCoreBranches, ...v0Branches, ...v2Branches]);
  const v7 = computeAnalyzerV7Overlay({
    core_v2_digest: coreV2Digest,
    secondary: input?.secondary,
    stable: input?.stable,
    relationships: input?.relationships,
    families: input?.families,
  });
  const selected = merged.slice(0, v7.path_label === "normal" ? 2 : 3);
  return {
    v0: {
      dominant_branch: explicitCoreBranches[0] || v0Branches[0] || null,
      secondary_branches: mergeAnalyzerBranchCandidates([...explicitCoreBranches.slice(1), ...v0Branches.slice(1)]).slice(0, 3),
      protective_count: Array.isArray(input?.stable) ? input.stable.length : 0,
    },
    v2: {
      state: coreV2Digest.state || "not_provided",
      risk_score: Number(coreV2Digest.risk_score) || null,
      priority_score: Number(coreV2Digest.priority_score) || null,
      fallback_required: Boolean(coreV2Digest.fallback_required),
      selected_branches: v2Branches.slice(0, 3),
    },
    v7: {
      overlap_score: v7.overlap_score,
      path_label: v7.path_label,
      why: v7.why,
      selected_branches: selected,
    },
    selected_branches: selected,
  };
}

function buildNyraAnalyzerCoreOverlayLineData(overlay, practiceProfile) {
  const selected = Array.isArray(overlay?.selected_branches) ? overlay.selected_branches : [];
  if (!selected.length) return "";
  const head = selected[0];
  const tail = selected.slice(1);
  const joinTail = tail.length ? ` con ${tail.map((item) => item.label).join(" e ")}` : "";
  const practiceProfileId = typeof practiceProfile === "string"
    ? practiceProfile
    : practiceProfile?.id || "";

  if (practiceProfileId === "medical_dermatology") {
    return `Lettura guidata dai rami Core: il quadro va letto da ${head.label}${joinTail}, con percorso ${overlay?.v7?.path_label || "normal"} e correlazione prudente dei segni osservabili.`;
  }
  if (practiceProfileId === "pharmacy_dermocosmetic") {
    return `Lettura guidata dai rami Core: oggi il quadro si appoggia a ${head.label}${joinTail}, cosi la routine resta coerente e non si disperde su troppi fronti.`;
  }
  return `Lettura guidata dai rami Core: oggi il percorso parte da ${head.label}${joinTail}, perche e li che conviene concentrare la scelta operativa.`;
}

module.exports = {
  buildNyraBranchSummaryNotesData,
  buildNyraBranchSummaryLineData,
  getAnalyzerBranchMetaByKeyData,
  getAnalyzerBranchMetaByIdData,
  mergeAnalyzerBranchCandidates,
  computeAnalyzerV7Overlay,
  buildAnalyzerCoreOverlayData,
  buildNyraAnalyzerCoreOverlayLineData,
};
