const DEFAULT_TIMEOUT_MS = 3500;

const LANGUAGE_MAP = Object.freeze({
  it: "it-IT",
  "it-it": "it-IT",
  en: "en-US",
  "en-us": "en-US",
  "en-gb": "en-GB",
  fr: "fr-FR",
  "fr-fr": "fr-FR",
  es: "es-ES",
  "es-es": "es-ES",
});

const FALLBACK_DICTIONARIES = Object.freeze({
  it: [
    ["paggina", "pagina", "spelling"],
    ["immaggine", "immagine", "spelling"],
    ["aqquisto", "acquisto", "spelling"],
    ["aquisto", "acquisto", "spelling"],
    ["funziona tutto", "funziona correttamente", "style"],
    ["pricyng", "pricing", "spelling"],
    ["clim guard", "claim guard", "glossary"],
    ["laguagetool", "LanguageTool", "spelling"],
    ["brend", "brand", "spelling"],
    ["castom", "custom", "spelling"],
    ["personalizzazzione", "personalizzazione", "spelling"],
    ["publicazione", "pubblicazione", "spelling"],
    ["abbonameto", "abbonamento", "spelling"],
    ["dublica", "duplica", "spelling"],
  ],
  en: [
    ["recieve", "receive", "spelling"],
    ["adress", "address", "spelling"],
    ["bussiness", "business", "spelling"],
    ["managment", "management", "spelling"],
    ["teh", "the", "spelling"],
    ["wich", "which", "spelling"],
  ],
  fr: [
    ["adress", "adresse", "spelling"],
    ["developpement", "développement", "accent"],
    ["qualite", "qualité", "accent"],
    ["connexion", "connexion", "spelling"],
    ["foncionne", "fonctionne", "spelling"],
  ],
  es: [
    ["direccion", "dirección", "accent"],
    ["informacion", "información", "accent"],
    ["funciona corectamente", "funciona correctamente", "spelling"],
    ["gestion", "gestión", "accent"],
    ["cliente potenciale", "cliente potencial", "spelling"],
  ],
});

function normalizeLocale(locale = "it") {
  const key = String(locale || "it").toLowerCase().trim();
  return LANGUAGE_MAP[key] || LANGUAGE_MAP[key.split("-")[0]] || "it-IT";
}

function baseLocale(locale = "it") {
  return normalizeLocale(locale).slice(0, 2).toLowerCase();
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, cancel: () => clearTimeout(timer) };
}

function issueFromDictionary({ text, match, replacement, type, index }) {
  const lower = text.toLowerCase();
  const start = lower.indexOf(match.toLowerCase());
  if (start === -1) return null;
  return {
    id: `dict_${index + 1}`,
    type,
    severity: type === "glossary" ? "medium" : "low",
    start,
    end: start + match.length,
    original: text.slice(start, start + match.length),
    suggestions: [replacement],
    message: type === "glossary" ? "Termine non allineato al glossario." : "Possibile errore linguistico.",
    reason: "Dizionario locale Content Guard.",
    safe_to_auto_apply: type !== "glossary",
    provider: "local_dictionary",
  };
}

function detectWithLocalDictionary(text, locale) {
  const dictionary = FALLBACK_DICTIONARIES[baseLocale(locale)] || [];
  return dictionary
    .map(([match, replacement, type], index) => issueFromDictionary({ text, match, replacement, type, index }))
    .filter(Boolean);
}

function mapLanguageToolType(match = {}) {
  const category = String(match.rule?.category?.id || "").toUpperCase();
  const issueType = String(match.rule?.issueType || "").toLowerCase();
  if (category.includes("TYPOS") || issueType === "misspelling") return "spelling";
  if (category.includes("GRAMMAR")) return "grammar";
  if (category.includes("PUNCTUATION") || issueType === "typographical") return "punctuation";
  if (category.includes("STYLE") || issueType === "style") return "style";
  if (category.includes("CASING")) return "style";
  return "readability";
}

function mapLanguageToolSeverity(match = {}) {
  const type = mapLanguageToolType(match);
  if (type === "grammar") return "medium";
  if (type === "style" || type === "readability") return "low";
  return "low";
}

function issueFromLanguageToolMatch(match = {}, text = "", index = 0) {
  const start = Number(match.offset || 0);
  const length = Number(match.length || 0);
  const replacements = Array.isArray(match.replacements) ? match.replacements.slice(0, 5).map((item) => String(item.value || "").trim()).filter(Boolean) : [];
  const type = mapLanguageToolType(match);
  return {
    id: `lt_${index + 1}`,
    type,
    severity: mapLanguageToolSeverity(match),
    start,
    end: start + length,
    original: text.slice(start, start + length),
    suggestions: replacements,
    message: String(match.message || "Possibile problema linguistico."),
    reason: String(match.rule?.description || match.shortMessage || "LanguageTool"),
    safe_to_auto_apply: Boolean(replacements.length) && ["spelling", "accent", "punctuation"].includes(type),
    provider: "languagetool",
    rule_id: match.rule?.id || "",
  };
}

async function detectWithLanguageTool(text, locale, options = {}) {
  const url = String(options.url || process.env.LANGUAGETOOL_URL || process.env.LANGUAGE_TOOL_URL || "https://api.languagetool.org/v2/check").trim();
  if (!url || process.env.LANGUAGETOOL_DISABLED === "1" || process.env.NODE_ENV === "test") return [];

  const { controller, cancel } = withTimeout(Number(options.timeoutMs || process.env.LANGUAGETOOL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  try {
    const body = new URLSearchParams();
    body.set("text", text);
    body.set("language", normalizeLocale(locale));
    body.set("enabledOnly", "false");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const json = await response.json();
    return Array.isArray(json.matches) ? json.matches.slice(0, 80).map((match, index) => issueFromLanguageToolMatch(match, text, index)) : [];
  } catch {
    return [];
  } finally {
    cancel();
  }
}

function mergeIssues(existing = [], detected = []) {
  const seen = new Set();
  const merged = [];
  for (const issue of [...existing, ...detected]) {
    const key = `${issue.type}:${issue.start}:${issue.end}:${String(issue.original || "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(issue);
  }
  return merged;
}

export async function detectLanguageGuardIssues({ text = "", locale = "it", existingIssues = [], options = {} } = {}) {
  const cleanText = String(text || "");
  if (!cleanText.trim()) return existingIssues;
  const localIssues = detectWithLocalDictionary(cleanText, locale);
  const languageToolIssues = await detectWithLanguageTool(cleanText, locale, options);
  return mergeIssues(existingIssues, [...localIssues, ...languageToolIssues]);
}

export function supportedLanguageGuardLocales() {
  return {
    it: "it-IT",
    en: "en-US/en-GB",
    fr: "fr-FR",
    es: "es-ES",
  };
}
