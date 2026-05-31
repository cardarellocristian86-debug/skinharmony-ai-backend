import { runUniversalCore } from "../../../universal-core/packages/core/src/index.ts";
import { runUniversalCoreDecisionV1Calibrated } from "../../../universal-core/packages/core/src/decisionV1Calibrated.ts";
import { runAssistantDigestRuntimeV2 } from "../../../universal-core/packages/branches/assistant/src/index.ts";

function clamp(value, min = 0, max = 100) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function hasTag(signal, tag) {
  return Array.isArray(signal.tags) && signal.tags.includes(tag);
}

function hasSignal(input, id) {
  return input.signals.some((signal) => signal.id === id);
}

function signal(id, label, score, tags, evidence) {
  return {
    id,
    source: "semantic-selection-service",
    category: "semantic_selection",
    label,
    value: score,
    normalized_score: score,
    severity_hint: score,
    confidence_hint: 92,
    reliability_hint: 90,
    expected_value_hint: score,
    friction_hint: tags.includes("noise") ? 75 : 12,
    risk_hint: tags.includes("noise") ? 70 : 18,
    reversibility_hint: tags.includes("noise") ? 25 : 90,
    evidence: [{ label: evidence, value: true, weight: 1 }],
    tags,
  };
}

function normalizeContext(candidate = {}, options = {}) {
  const context = candidate.semantic_context || candidate.context || {};
  const targetLanguage = String(options.target_language || context.target_language || "it");
  const languageBranch = String(context.language_branch || (targetLanguage === "it" ? "it" : "unknown"));
  const surface = String(context.surface || candidate.surface || "visible_text");
  return {
    targetLanguage,
    languageBranch,
    surface,
    hasResidue: Boolean(context.has_english_residue ?? candidate.has_english_residue ?? !candidate.do_not_translate),
    protectedTerm: Boolean(context.protected_term || candidate.protected_term || candidate.do_not_translate),
    toleratedTerm: Boolean(context.tolerated_product_term),
    ambiguous: Boolean(context.ambiguous || candidate.risk === "medium" || candidate.risk === "review"),
  };
}

export function buildSemanticSelectionInput(candidate = {}, options = {}) {
  const normalized = normalizeContext(candidate, options);
  const signals = [];
  const blockedRules = [];

  if (
    normalized.hasResidue &&
    normalized.languageBranch === normalized.targetLanguage &&
    ["visible_text", "protocol_copy", "wordpress_admin_copy"].includes(normalized.surface) &&
    !normalized.protectedTerm
  ) {
    signals.push(signal(
      "semantic:visible_language_residue",
      "Correggi testo visibile",
      normalized.ambiguous ? 72 : 84,
      ["semantic", "visible_ui", "target_language_branch"],
      "Residuo linguistico in superficie visibile della lingua target",
    ));
  }

  if (["class_name", "replacement_key", "code_token"].includes(normalized.surface)) {
    signals.push(signal(
      "semantic:technical_noise",
      "Scarta rumore tecnico",
      88,
      ["semantic", "noise", "system"],
      "Stringa tecnica, classe, token o chiave interna",
    ));
    blockedRules.push({
      scope: "semantic_patch",
      reason_code: "technical_or_mapping_noise",
      severity: 88,
      blocks_execution: true,
    });
  }

  if (normalized.languageBranch !== "unknown" && normalized.languageBranch !== normalized.targetLanguage) {
    signals.push(signal(
      "semantic:valid_other_language_branch",
      "Scarta branch lingua non target",
      82,
      ["semantic", "noise", "system"],
      "La stringa appartiene a un branch lingua diverso dalla lingua target",
    ));
    blockedRules.push({
      scope: "semantic_patch",
      reason_code: "valid_other_language_branch",
      severity: 82,
      blocks_execution: true,
    });
  }

  if (normalized.protectedTerm || normalized.toleratedTerm) {
    signals.push(signal(
      "semantic:protected_or_valid_term",
      "Mantieni termine protetto",
      28,
      ["semantic", "protected", "system"],
      "Termine prodotto, brand o tecnico da non tradurre/modificare",
    ));
  }

  if (!signals.length) {
    signals.push(signal("semantic:observe", "Nessuna correzione", 12, ["semantic", "system"], "Nessun segnale utente da correggere"));
  }

  return {
    request_id: `semantic-selection-${candidate.id || Date.now()}`,
    generated_at: new Date().toISOString(),
    domain: "custom",
    context: {
      tenant_id: options.tenant_id || "core-service",
      locale: normalized.targetLanguage,
      metadata: {
        semantic_intent: options.intent || "semantic_selection",
        action_type: "read",
        source: candidate.source || "",
        target_language: normalized.targetLanguage,
        language_branch: normalized.languageBranch,
        surface: normalized.surface,
        ambiguous: normalized.ambiguous,
        adapter: options.adapter || "generic",
      },
    },
    signals,
    data_quality: {
      score: 91,
      completeness: 88,
      freshness: 95,
      consistency: 90,
      reliability: 91,
    },
    constraints: {
      allow_automation: false,
      require_confirmation: false,
      max_control_level: "suggest",
      blocked_action_rules: blockedRules,
    },
  };
}

export function selectSemanticCandidate(candidate = {}, options = {}) {
  const input = buildSemanticSelectionInput(candidate, options);
  const v2 = runAssistantDigestRuntimeV2(input);
  const v1 = runUniversalCoreDecisionV1Calibrated(input);
  const hasVisibleResidue = hasSignal(input, "semantic:visible_language_residue");
  const hasProtectedOrNoise = input.signals.some((item) => hasTag(item, "protected") || hasTag(item, "noise"));
  const ambiguous = Boolean(input.context.metadata?.ambiguous);
  const needsV0 =
    v2.blocked_action_count > 0 ||
    hasProtectedOrNoise ||
    ambiguous ||
    v1.control_level === "confirm" ||
    v1.control_level === "blocked";

  if (!needsV0) {
    const keep = hasVisibleResidue && v2.state !== "observe" && v2.priority_score >= 35;
    return {
      decision: keep ? "keep" : "discard",
      path: "v2_fast_plus_v1_governance",
      confidence: keep ? 0.91 : 0.78,
      reason: keep ? "V2 selezione veloce e V1 senza blocchi." : "Nessun residuo visibile nella lingua target.",
      v2: { state: v2.state, priority: clamp(v2.priority_score), blocked: v2.blocked_action_count || 0 },
      v1: { state: v1.state, control: v1.control_level },
      v0: null,
    };
  }

  const v0 = runUniversalCore(input);
  const blocked = (v0.blocked_reasons || []).length > 0 || (v0.recommended_actions || []).some((action) => action.blocked);
  const keep = !blocked && hasVisibleResidue && v0.state !== "observe";
  return {
    decision: blocked ? "blocked" : keep ? "keep" : "discard",
    path: "v2_prefilter_v1_governance_v0_final",
    confidence: blocked ? 0.93 : keep ? 0.9 : 0.86,
    reason: blocked
      ? `V0 blocca: ${(v0.blocked_reasons || []).join(", ") || "blocked_action"}`
      : keep
        ? "V0 conferma residuo visibile nella lingua target."
        : "V0 scarta come rumore, termine protetto o stringa valida.",
    v2: { state: v2.state, priority: clamp(v2.priority_score), blocked: v2.blocked_action_count || 0 },
    v1: { state: v1.state, control: v1.control_level },
    v0: {
      state: v0.state,
      control: v0.control_level,
      primary: v0.priority?.primary_signal_id || "none",
      blocked_reasons: v0.blocked_reasons || [],
    },
  };
}

export function selectSemanticCandidates(candidates = [], options = {}) {
  const items = candidates.slice(0, options.limit || 200).map((candidate) => ({
    ...candidate,
    semantic_selection: selectSemanticCandidate(candidate, options),
  }));
  const summary = items.reduce((acc, item) => {
    const decision = item.semantic_selection?.decision || "unknown";
    acc[decision] = (acc[decision] || 0) + 1;
    return acc;
  }, {});
  return {
    generated_at: new Date().toISOString(),
    engine: "semantic_selection_v2_v1_v0",
    summary,
    items,
  };
}
