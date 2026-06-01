export const SOFTWARE_LANGUAGE_GATE_VERSION = "software_language_gate_v1";

const RADARS = [
  {
    id: "cta",
    pattern:
      /\b(apri|mostra|salva|elimina|modifica|aggiorna|conferma|rimanda|entra|esci|vai|invia|copia|scarica|open|show|save|delete|edit|update|confirm|send|copy|download|öffnen|anzeigen|speichern|löschen|aktualisieren|bestätigen|senden)\b/i,
  },
  {
    id: "navigation",
    pattern:
      /\b(dashboard|agenda|clienti|clients|servizi|services|cassa|kasse|margini|profitability|report|berichte|turni|lager|magazzino|settings|impostazioni|einstellungen|protocolli|trattamenti)\b/i,
  },
  {
    id: "errors",
    pattern:
      /\b(errore|impossibile|non riuscito|scadut[ao]|manca|mancano|invalid|error|failed|missing|expired|forbidden|unauthorized|fehler|fehlgeschlagen|fehlt|abgelaufen)\b/i,
  },
  {
    id: "onboarding_trial",
    pattern:
      /\b(login|accedi|password|trial|prova gratuita|verifica email|registrati|account|onboarding|demo|kostenlose|anmelden|passwort|registrieren)\b/i,
  },
  {
    id: "ai_gold_copy",
    pattern:
      /\b(ai gold|gold|nyra|core|smart desk|priorit[àa]|decision|decisione|azione|azioni|alert|lettura|responsabile operativo|risposta|risponde)\b/i,
  },
  {
    id: "data_quality",
    pattern:
      /\b(qualit[àa] dati|data quality|datenqualit[äa]t|dati da completare|senza contatto|senza costi|senza pagamento|missing information|incomplete data)\b/i,
  },
  {
    id: "system_status",
    pattern:
      /\b(stato sistema|centro sotto controllo|nessun errore|affidabilit[àa]|sistema|system status|under control|reliability|governance)\b/i,
  },
  {
    id: "legal_privacy",
    pattern:
      /\b(privacy|consenso|gdpr|telefono|email|whatsapp|autorizzazione|consent|permission|datenschutz|einwilligung)\b/i,
  },
  {
    id: "pricing_payment",
    pattern:
      /\b(prezzo|prezzi|pagamento|pagamenti|incasso|incassi|costo|costi|fatturato|revenue|payment|price|cost|zahlung|preis|umsatz)\b/i,
  },
  {
    id: "admin_support",
    pattern:
      /\b(superadmin|admin|supporto|support|assistenza|tenant|fleet|god mode|operator[ei]|staff|mitarbeiter)\b/i,
  },
];

const LANGUAGE_PATTERNS = {
  it: [
    /\b(centro|clienti|servizi|agenda|cassa|magazzino|impostazioni|mancano|apri|mostra|aggiorna|conferma|redditiv|incassi|operatore|operatori|appuntamenti|qualit[àa]|nessun[ao]|prova gratuita|accedi|esci)\b/i,
    /[àèéìòù]/i,
  ],
  en: [
    /\b(center|clients|services|settings|missing|open|show|save|delete|confirm|staff|revenue|profitability|appointments|dashboard|trial|password|under control|data quality|what to do now)\b/i,
  ],
  de: [
    /\b(kunden|leistungen|einstellungen|berichte|kasse|lager|termine|datenqualit[äa]t|mitarbeiter|öffnen|speichern|kosten|umsatz|sprache|passwort|bestätigen)\b/i,
    /[äöüß]/i,
  ],
  fr: [/\b(clients|services|paramètres|ouvrir|enregistrer|mot de passe|paiement|chiffre d'affaires)\b/i],
  es: [/\b(clientes|servicios|ajustes|abrir|guardar|contraseña|pago|ingresos)\b/i],
};

const BLOCKING_RADARS = new Set([
  "cta",
  "errors",
  "onboarding_trial",
  "ai_gold_copy",
  "legal_privacy",
  "pricing_payment",
]);

function normalizeText(value) {
  return String(value || "").replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
}

function detectLanguages(text) {
  const languages = [];
  for (const [lang, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(text))) languages.push(lang);
  }
  return languages;
}

function classifyRadar(text) {
  const matched = RADARS.filter((radar) => radar.pattern.test(text)).map((radar) => radar.id);
  return matched.length ? matched : ["generic_ui_copy"];
}

function classifyDomain(input = {}) {
  const source = String(input.source || input.domain || input.file || "").toLowerCase();
  const text = normalizeText(input.text || input.source_text || input.value);
  if (source.includes("dictionary") || source.includes("i18n") || source.includes("translations")) return "dictionary_source";
  if (source.includes("repair") || source.includes("regex") || /\/b[A-Za-zÀ-ÿ]|\\b|_match|=>/.test(text)) return "translation_rule_or_repair_map";
  if (source.includes("server")) return "server_runtime";
  if (source.includes("bundle") || source.includes("asset")) return "active_bundle_or_bridge";
  return "runtime_copy";
}

function severityFor({ targetLang, languages, radars, domain, text }) {
  const residueLangs = languages.filter((lang) => lang !== targetLang);
  const hasTarget = languages.includes(targetLang);
  if (/^<html lang=/.test(text) && residueLangs.length) return "high";
  if (domain === "translation_rule_or_repair_map") return "low";
  if (domain === "dictionary_source") return "info";
  if (!residueLangs.length && hasTarget) return "ok";
  if (!residueLangs.length) return "low";
  if (radars.some((id) => ["cta", "errors", "onboarding_trial", "pricing_payment", "legal_privacy"].includes(id))) return "high";
  if (radars.some((id) => ["navigation", "ai_gold_copy", "data_quality", "system_status"].includes(id))) return "medium";
  return "low";
}

function normalizeEntries(payload = {}) {
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  const rows = entries.length ? entries : findings;
  return rows.slice(0, 1000).map((entry, index) => {
    const text = normalizeText(entry.text || entry.source_text || entry.value || entry.label || "");
    return {
      id: String(entry.id || entry.key || entry.key_path || `entry_${index + 1}`),
      key: String(entry.key || entry.key_path || ""),
      text,
      file: String(entry.file || ""),
      line: Number(entry.line || 0),
      source: String(entry.source || entry.domain || entry.file || "runtime_copy"),
      context: String(entry.context || ""),
    };
  }).filter((entry) => entry.text.length >= 3);
}

function coreNoiseDecision(finding) {
  const text = finding.text || "";
  if (finding.domain === "translation_rule_or_repair_map") {
    return { keep: false, stage: "v2_semantic_noise", reason: "translation_repair_rule_not_visible_copy" };
  }
  if (finding.domain === "dictionary_source") {
    return { keep: false, stage: "v2_semantic_noise", reason: "dictionary_source_not_runtime_residue" };
  }
  if (/[\[\]{}]|=>|_match|RegExp|function\s*\(/.test(text) && /\/b|\\b|\(\?|\[io\]|\(d\+\)/.test(text)) {
    return { keep: false, stage: "v2_semantic_noise", reason: "regex_or_code_fragment" };
  }
  if (finding.severity === "low" && finding.radars.length === 1 && finding.radars[0] === "generic_ui_copy") {
    return { keep: false, stage: "v1_policy_noise", reason: "generic_low_signal_copy" };
  }
  if (finding.domain === "server_runtime" && finding.severity === "low") {
    return { keep: false, stage: "v1_policy_noise", reason: "server_low_visibility_copy" };
  }
  if (!finding.languages.length && finding.severity !== "high") {
    return { keep: false, stage: "v0_final_noise", reason: "no_language_signal_not_high_risk" };
  }
  return { keep: true, stage: "v0_visible_risk", reason: "visible_or_high_risk_copy" };
}

function countBy(items, pick) {
  return items.reduce((acc, item) => {
    const keys = [].concat(pick(item));
    for (const key of keys.length ? keys : ["unknown"]) acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

export function evaluateSoftwareLanguageGate(payload = {}) {
  const targetLang = String(payload.target_lang || payload.target_language || "it").trim().toLowerCase();
  const app = String(payload.app || payload.adapter || "software").trim();
  const entries = normalizeEntries(payload);
  const rawFindings = entries.map((entry) => {
    const languages = detectLanguages(entry.text);
    const radars = classifyRadar(entry.text);
    const domain = classifyDomain(entry);
    const severity = severityFor({ targetLang, languages, radars, domain, text: entry.text });
    return { ...entry, target_lang: targetLang, languages, radars, domain, severity };
  }).filter((finding) => !["ok", "info"].includes(finding.severity));

  const governed = rawFindings.map((finding) => ({ ...finding, core_noise: coreNoiseDecision(finding) }));
  const noise = governed.filter((finding) => !finding.core_noise.keep);
  const findings = governed.filter((finding) => finding.core_noise.keep);
  const high = findings.filter((finding) => finding.severity === "high");
  const blocking = high.filter((finding) => finding.radars.some((radar) => BLOCKING_RADARS.has(radar)));
  const languageReady = blocking.length === 0;

  return {
    ok: true,
    schema_version: SOFTWARE_LANGUAGE_GATE_VERSION,
    app,
    target_lang: targetLang,
    core_nyra_required: true,
    mandatory: true,
    language_ready: languageReady,
    decision: languageReady ? "ready" : "blocked",
    action_mediation: {
      state: languageReady ? "allow" : "block",
      execution_allowed: languageReady,
      next_step: languageReady
        ? "runtime_language_can_continue_with_audit"
        : "send_blocking_findings_to_governed_translation_catalog_before_release",
    },
    pipeline: {
      v2: "semantic_filter_dictionaries_repair_maps_regex_code",
      v1: "writing_policy_low_signal_filter",
      v0: "final_visible_risk_gate",
    },
    summary: {
      entries: entries.length,
      raw_findings_before_noise: rawFindings.length,
      noise_removed: noise.length,
      findings: findings.length,
      high: high.length,
      medium: findings.filter((finding) => finding.severity === "medium").length,
      low: findings.filter((finding) => finding.severity === "low").length,
      blocking_high: blocking.length,
      by_radar: countBy(findings, (finding) => finding.radars),
      by_language: countBy(findings, (finding) => finding.languages),
      noise_by_stage: countBy(noise, (finding) => finding.core_noise.stage),
      noise_by_reason: countBy(noise, (finding) => finding.core_noise.reason),
    },
    blocking_findings: blocking.slice(0, 100),
    findings: findings.slice(0, Number(payload.limit || 100)),
    rule: "No software language/runtime/AI copy is ready until horizontal radars plus V2/V1/V0 plus Core/Nyra governance pass.",
  };
}
