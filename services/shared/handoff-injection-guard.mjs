import crypto from "node:crypto";
import { assessLexicalSemanticText } from "./lexical-semantic-engine.mjs";

export const HANDOFF_INJECTION_SCANNER_VERSION = "handoff_injection_guard_v7";
// This scanner is a deterministic, high-recall quarantine layer. A clean scan
// is not proof of semantic safety and must never grant tools or authority:
// capability isolation and Core authorization remain mandatory downstream.
export const HANDOFF_INJECTION_SECURITY_MODEL = Object.freeze({
  classification: "deterministic_high_recall",
  semantic_safety_proof: false,
  capability_isolation_required: true,
  ambiguous_control_language: "manual_review",
  allow_semantics: "untrusted_data_only",
  allow_grants_role: false,
  allow_grants_tools: false,
  allow_grants_authority: false,
});

const UNTRUSTED_DATA_BOUNDARY = Object.freeze({
  classification: "untrusted_data",
  grants_role: false,
  grants_tools: false,
  grants_authority: false,
  core_authorization_required: true,
});

const MAX_ENVELOPE_DEPTH = 8;
const MAX_ENVELOPE_ITEMS = 512;
const MAX_ENVELOPE_TEXTS = 256;
const MAX_TEXT_CHARS = 20_000;
const MAX_TOTAL_CHARS = 100_000;

const RULES = Object.freeze([
  {
    id: "instruction_override",
    patterns: [
      /\bignore\s+(?:all\s+|any\s+)?(?:previous|prior|earlier)\s+(?:instructions|messages|rules)\b/i,
      /\bignore\s+(?:all\s+|any\s+)?(?:previous|prior|earlier)\s+(?:prompt|prompts|directives?)\b/i,
      /\bdisregard\s+(?:all\s+|every\s+|any\s+)?(?:previous|prior|earlier)\s+(?:instructions?|messages?|rules?|prompts?|directives?)\b/i,
      /\bforget\s+(?:all\s+|every\s+)?(?:previous|prior|earlier)\s+(?:instructions?|rules?|prompts?|directives?)\b/i,
      /\b(?:override|bypass|disable)\s+(?:the\s+)?(?:policy|policies|guardrail|guardrails|instructions|core)\b/i,
      /\bignora\s+(?:tutte\s+le\s+)?(?:istruzioni|regole)\s+(?:precedenti|iniziali)\b/i,
      /\bignora\s+(?:(?:tutte\s+)?le\s+)?(?:precedenti|iniziali)\s+(?:istruzioni|regole|direttive|prompt)\b/i,
      /\bignora\s+(?:tutte\s+le\s+)?(?:istruzioni|regole|direttive|prompt)\s+(?:precedenti|iniziali)\b/i,
      /\b(?:sovrascrivi|aggira|disabilita)\s+(?:le\s+|il\s+)?(?:regole|policy|guardrail|core)\b/i,
    ],
  },
  {
    id: "authority_displacement",
    patterns: [
      /\b(?:the\s+)?(?:next|receiving|other)\s+agent\s+(?:must|should|has\s+to)\s+(?:obey|follow|listen\s+to)\s+(?:me|my|this)\s+(?:instead\s+of|over|not)\s+(?:core|system|developer|policy|instructions?)\b/i,
      /\b(?:obey|follow|prioriti[sz]e)\s+(?:me|my\s+instructions?|this\s+(?:message|instruction|command))\s*(?:,|;)?\s*(?:instead\s+of|over|not)\s+(?:core|system|developer|policy|instructions?)\b/i,
      /\b(?:my|these|this)\s+instructions?\s+(?:take|takes|have|has)\s+(?:priority|precedence)\s+over\s+(?:core|system|developer|policy|instructions?)\b/i,
      /\b(?:il\s+)?(?:prossimo|altro)\s+agente\s+(?:deve|dovra)\s+(?:obbedire|seguire|ascoltare)\s+(?:me|le\s+mie\s+istruzioni)\s+(?:invece\s+di|al\s+posto\s+di)\s+(?:core|sistema|policy|istruzioni)\b/i,
      /\b(?:obbedisci|segui)\s+(?:me|le\s+mie\s+istruzioni)\s*(?:,|;)?\s*(?:non|invece\s+di)\s+(?:core|il\s+sistema|la\s+policy|le\s+istruzioni)\b/i,
    ],
  },
  {
    id: "negative_system_obedience",
    patterns: [
      /\b(?:do\s+not|don't|never|stop)\s+(?:obey|follow|respect|apply|adhere\s+to)\s+(?:the\s+)?(?:system|developer|core|policy|policies|instructions?|rules?|guardrails?)\b/i,
      /\b(?:non|mai)\s+(?:obbedire|seguire|rispettare|applicare)\s+(?:il\s+|le\s+|la\s+)?(?:sistema|core|policy|istruzioni|regole|guardrail)\b/i,
    ],
  },
  {
    id: "priority_escalation",
    patterns: [
      /\b(?:new|updated|absolute|highest|top|supreme)\s+(?:highest\s+|top\s+)?priority\s*(?::|is|=)\s*(?:now\s+)?(?:obey|follow|execute|run|call|invoke|dump|print|reveal|expose|leak|send|return|output)\b/i,
      /\bpriority\s+(?:override|update|escalation)\s*(?::|is|=)\s*(?:obey|follow|execute|run|call|invoke|dump|print|reveal|expose|leak|send|return|output)\b/i,
      /\b(?:nuova|massima|assoluta|suprema)\s+priorita\s*(?::|e|=)\s*(?:obbedisci|segui|esegui|lancia|chiama|invoca|mostra|stampa|rivela|esponi|invia|restituisci)\b/i,
    ],
  },
  {
    id: "policy_invalidation",
    patterns: [
      /\b(?:the\s+)?(?:policy|policies|rule|rules|guardrail|guardrails|system\s+instructions?|core\s+policy)\s+(?:no\s+longer|doesn'?t|does\s+not|do\s+not|ceased?\s+to)\s+(?:appl(?:y|ies)|matter|matters|govern|governs|have\s+effect)\b/i,
      /\b(?:the\s+)?(?:policy|policies|rule|rules|guardrail|guardrails)\s+(?:is|are)\s+(?:void|invalid|obsolete|revoked|suspended|disabled)\b/i,
      /\b(?:la\s+|le\s+|il\s+)?(?:policy|regole|guardrail|istruzioni\s+di\s+sistema)\s+(?:non\s+si\s+applica|non\s+si\s+applicano|non\s+vale|non\s+valgono|e\s+revocata|sono\s+revocate)\b/i,
    ],
  },
  {
    id: "authority_impersonation",
    patterns: [
      /\b(?:system|developer)\s+(?:prompt|message|instructions?)\s*:/i,
      /\b(?:act|behave)\s+as\s+(?:the\s+)?(?:system|developer|core|root)\b/i,
      /\bpretend\s+(?:that\s+)?(?:this|these)\s+(?:is|are)\s+(?:a\s+|the\s+)?(?:system|developer|core|root)\s+(?:prompt|message|instructions?)\b/i,
      /\b(?:fingi|comportati)\s+(?:di\s+essere|come)\s+(?:il\s+)?(?:sistema|developer|core|root)\b/i,
    ],
  },
  {
    id: "tool_execution_coercion",
    patterns: [
      /\b(?:execute|run|invoke|call)\s+(?:this\s+|the\s+)?(?:command|shell|code|tool|function)\b/i,
      /\b(?:call|invoke|use)\s+(?:the\s+)?(?:exec|shell|terminal)\b/i,
      /\b(?:obey|follow)\s+(?:this|the)\s+command\s*:\s*\S/i,
      /\buse\s+(?:your|the)\s+(?:shell|terminal|command\s+line)\s+to\s+(?:execute|run|invoke)\b/i,
      /\b(?:esegui|lancia|invoca|chiama)\s+(?:questo\s+|il\s+)?(?:comando|shell|codice|tool|strumento|funzione)\b/i,
      /\b(?:usa|utilizza)\s+(?:la\s+)?(?:shell|terminale|riga\s+di\s+comando)\s+per\s+(?:eseguire|lanciare|invocare)\b/i,
      /\b(?:rm\s+-rf|curl\s+[^|]{0,200}\|\s*(?:sh|bash)|wget\s+[^|]{0,200}\|\s*(?:sh|bash)|process\.env)\b/i,
      /<\s*(?:tool_call|function_call)\b/i,
    ],
  },
  {
    id: "secret_exfiltration",
    patterns: [
      /\b(?:reveal|print|return|send|output|show|expose|dump|leak|exfiltrate)\s+(?:the\s+)?(?:secrets?|token|password|api[ _-]?key|hidden prompt)\b/i,
      /\b(?:reveal|print|return|send|expose|dump|exfiltrate)\s+(?:all\s+|the\s+)?(?:credentials?|environment|env(?:ironment)?\s+variables?|process\.env)\b/i,
      /\b(?:rivela|stampa|restituisci|invia|mostra|esponi|esfiltra)\s+(?:il\s+|la\s+)?(?:segreto|token|password|chiave api|prompt nascosto)\b/i,
      /\b(?:rivela|stampa|restituisci|invia|esponi|esfiltra)\s+(?:tutte\s+le\s+|le\s+)?(?:credenziali|variabili\s+d ambiente|variabili\s+di\s+ambiente)\b/i,
    ],
  },
]);

function normalizeForScan(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[“”„‟]/g, "\"")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[аеорсхуіј]/gi, (character) => ({
      а: "a", е: "e", о: "o", р: "p", с: "c", х: "x", у: "y", і: "i", ј: "j",
    })[character.toLowerCase()] || character)
    .replace(/\b(?:[a-z0-9][\s._~*|/\\-]+){2,}[a-z0-9]\b/gi, (token) => token.replace(/[^a-z0-9]/gi, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function deobfuscateForScan(value) {
  return normalizeForScan(value)
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[3]/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[5$]/g, "s")
    .replace(/[7+]/g, "t");
}

function scanVariants(value) {
  const canonical = normalizeForScan(value);
  const deobfuscated = deobfuscateForScan(canonical);
  const compact = deobfuscated.replace(/[^a-z0-9]+/g, "");
  return [...new Set([canonical, deobfuscated, compact])];
}

const SEMANTIC_LEXICON = Object.freeze({
  control: [
    "elevat*", "discard*", "replace*", "supersed*", "revok*", "obsolete", "adopt*", "demot*",
    "reclassif*", "suspend*", "unrestricted", "constitutional", "governance", "supervisor",
    "safeguard*", "compliance", "override*", "switch*", "assume*",
    "elev*", "scart*", "sostitu*", "superat*", "revoc*", "obsolet*", "adott*", "declass*",
    "riclassific*", "sospend*", "sospes*", "illimitat*", "costituzional*", "supervis*", "salvaguard*",
    "conformita", "assum*", "mett*", "maintenance", "amend*", "dominat*", "oversight",
    "aside", "enter*", "entr*", "profil*", "modific*", "activat*", "attiv*", "break", "glass",
    "straordinar*", "privileged", "privilegiat*",
  ],
  authority: [
    "core", "system", "developer", "root", "admin*", "supervisor*", "governance", "policy",
    "policies", "safeguard*", "constraint*", "sistema", "sviluppator*", "amministr*",
    "supervis*", "politic*", "salvaguard*", "vincol*", "oversight", "hierarchy", "gerarch*",
    "support*", "supporto", "privileged", "privilegiat*",
  ],
  role_change: ["switch*", "assume*", "role", "roles", "become*", "enter*", "assum*", "ruol*", "entr*", "profil*"],
  command: [
    "comply", "obey", "obed*", "priorit*", "directive*", "command*", "launch*", "run", "execute*",
    "invoke*", "inspect*", "enumerate*", "provide*", "transmit*", "call", "exec", "shell", "terminal",
    "conform*", "obbed*", "direttiv*", "comand*", "avvi*", "lanci*", "esegu*", "invoc*",
    "ispezion*", "enumer*", "forni*", "trasmett*", "comunic*", "read", "powershell", "console",
    "apri*", "legg*", "harvest*", "collect*", "consult*", "raccogl*",
  ],
  exfiltration: [
    "divulg*", "disclose*", "expose*", "dump*", "leak*", "reveal*", "transmit*", "provide*",
    "enumerate*", "inspect*", "print*", "output*", "show", "send", "return", "exfiltrat*",
    "divulga*", "espon*", "rivel*", "trasmett*", "forni*", "enumer*", "ispezion*", "comunic*",
    "mostr*", "stamp*", "invi*", "read", "return", "legg*", "harvest*", "collect*", "consult*",
    "raccogl*",
  ],
  sensitive: [
    "secret*", "credential*", "token*", "key", "keys", "password*", "env*", "runtime", "access*",
    "segret*", "credenzial*", "chiav*", "ambiente", "accesso", "accessi", "variabil*",
    "private", "authentication", "auth", "material", "reserved", "confidential", "riservat*",
    "signing", "signature", "firma", "vault",
  ],
  priority: ["priority", "priorit*", "mandate*", "mandato", "mandat*"],
  priority_modifier: ["new", "top", "highest", "urgent", "absolute", "supreme", "massima", "nuova", "urgente"],
});

function tokenMatchesLexeme(token, lexeme) {
  return lexeme.endsWith("*") ? token.startsWith(lexeme.slice(0, -1)) : token === lexeme;
}

function hasLexemeFamily(tokens, family) {
  for (const token of tokens) {
    if (family.some((lexeme) => tokenMatchesLexeme(token, lexeme))) return true;
  }
  return false;
}

function hasCompactLexemeFamily(compact, family) {
  return family.some((lexeme) => {
    const root = lexeme.endsWith("*") ? lexeme.slice(0, -1) : lexeme;
    return root.length >= 4 && compact.includes(root);
  });
}

function hasFullyLetterSpacedRun(value) {
  const canonical = String(value || "")
    .normalize("NFKC")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "");
  return /(?:^|[^a-z0-9])(?:[a-z0-9][\s._~*|/\\-]+){4,}[a-z0-9](?:$|[^a-z0-9])/i.test(canonical);
}

function isNaturalLanguageSecurityReport(text) {
  return /\b(?:assessment|report|security\s+report|finding|detector|test|corpus|threat|attack)\b/i.test(text)
    && /\b(?:covers?|documents?|documented|describes?|described|records?|recorded|classif(?:y|ies|ied)|detects?|detected|blocks?|blocked|produced|found)\b/i.test(text);
}

function compositionalSemanticRules(value) {
  const deobfuscated = deobfuscateForScan(value);
  const tokens = new Set(deobfuscated.match(/[a-z]+/g) || []);
  if (tokens.size === 0) return [];
  const compact = deobfuscated.replace(/[^a-z]+/g, "");
  const fullyLetterSpaced = hasFullyLetterSpacedRun(value);
  const hasFamily = (family) => hasLexemeFamily(tokens, family)
    || (fullyLetterSpaced && hasCompactLexemeFamily(compact, family));

  const control = hasFamily(SEMANTIC_LEXICON.control);
  const authority = hasFamily(SEMANTIC_LEXICON.authority);
  const roleChange = hasFamily(SEMANTIC_LEXICON.role_change);
  const command = hasFamily(SEMANTIC_LEXICON.command);
  const exfiltration = hasFamily(SEMANTIC_LEXICON.exfiltration);
  const sensitive = hasFamily(SEMANTIC_LEXICON.sensitive)
    || (tokens.has("api") && tokens.has("key"))
    || (tokens.has("environment") && (tokens.has("variable") || tokens.has("variables")))
    || (tokens.has("env") && (tokens.has("var") || tokens.has("vars")));
  const priority = hasFamily(SEMANTIC_LEXICON.priority);
  const priorityModifier = hasFamily(SEMANTIC_LEXICON.priority_modifier);
  const commandedAction = command || exfiltration;
  const oversightSetAside = tokens.has("oversight") && tokens.has("set") && tokens.has("aside");
  const privilegedMode = tokens.has("maintenance")
    || hasFamily(["admin*", "root", "amministr*", "support*", "privileged", "privilegiat*"]);
  const effectiveControl = control || oversightSetAside;
  const rules = [];

  if (exfiltration && sensitive) rules.push("secret_exfiltration");
  if (effectiveControl && authority) rules.push("authority_displacement");
  if (effectiveControl && command) rules.push("semantic_control_override");
  if (authority && roleChange) rules.push("authority_impersonation");
  if (privilegedMode && roleChange) rules.push("authority_impersonation");
  if (priority && priorityModifier && commandedAction) rules.push("priority_escalation");
  if (isNaturalLanguageSecurityReport(deobfuscated)
    && (control || authority || command || exfiltration || sensitive || priority)) {
    rules.push("ambiguous_security_control_language");
  }
  return rules;
}

export function extractBoundedInterAgentText(value, {
  max_depth = MAX_ENVELOPE_DEPTH,
  max_items = MAX_ENVELOPE_ITEMS,
  max_texts = MAX_ENVELOPE_TEXTS,
  max_text_chars = MAX_TEXT_CHARS,
  max_total_chars = MAX_TOTAL_CHARS,
} = {}) {
  const texts = [];
  const seen = new WeakSet();
  let itemCount = 0;
  let totalChars = 0;
  let truncated = false;

  function visit(current, path, depth) {
    if (texts.length >= max_texts || itemCount >= max_items || totalChars >= max_total_chars) {
      truncated = true;
      return;
    }
    itemCount += 1;
    if (typeof current === "string") {
      const remaining = Math.max(0, max_total_chars - totalChars);
      const text = current.slice(0, Math.min(max_text_chars, remaining));
      if (text.length < current.length) truncated = true;
      totalChars += text.length;
      if (text.trim()) texts.push({ path, text });
      return;
    }
    if (current === null || current === undefined || typeof current !== "object") return;
    if (seen.has(current)) {
      truncated = true;
      return;
    }
    seen.add(current);
    if (depth >= max_depth) {
      truncated = true;
      return;
    }
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) visit(current[index], `${path}[${index}]`, depth + 1);
      return;
    }
    for (const key of Object.keys(current).sort()) {
      visit(current[key], path ? `${path}.${key}` : key, depth + 1);
    }
  }
  visit(value, "$", 0);
  return { texts, text_count: texts.length, item_count: itemCount, total_chars: totalChars, truncated };
}

function boundedIdentity(value) {
  return String(value || "").trim().slice(0, 160);
}

export function scanInterAgentHandoff({
  tenant_id,
  from_agent_id,
  to_agent_id,
  from_agent_signature = "",
  from_client_type = "",
  thread_id = "",
  body,
} = {}) {
  const extracted = extractBoundedInterAgentText(body);
  const normalized = extracted.texts.map((entry) => `${entry.path}: ${normalizeForScan(entry.text)}`).join("\n");
  const variants = scanVariants(normalized);
  const lexicalAssessment = assessLexicalSemanticText({
    text: normalized,
    source_context: "inter_agent_handoff",
  });
  const matchedRules = RULES
    .filter((rule) => rule.patterns.some((pattern) => variants.some((variant) => pattern.test(variant))))
    .map((rule) => rule.id);
  for (const entry of extracted.texts) {
    matchedRules.push(...compositionalSemanticRules(entry.text));
  }
  const uniqueMatchedRules = [...new Set(matchedRules)];
  if (extracted.truncated) uniqueMatchedRules.push("envelope_unscannable");
  if (lexicalAssessment.disposition === "block") uniqueMatchedRules.push("lexical_semantic_block");
  if (lexicalAssessment.disposition === "clarify") uniqueMatchedRules.push("lexical_semantic_clarify");
  const deduplicatedRules = [...new Set(uniqueMatchedRules)];
  const tenantId = boundedIdentity(tenant_id);
  const sender = boundedIdentity(from_agent_id);
  const recipient = boundedIdentity(to_agent_id);
  const signature = boundedIdentity(from_agent_signature);
  const clientType = boundedIdentity(from_client_type);
  const thread = boundedIdentity(thread_id);
  const contentDigest = crypto
    .createHash("sha256")
    .update(`${tenantId}\u0000${sender}\u0000${recipient}\u0000${normalized}`)
    .digest("hex");
  const tenantScopeDigest = crypto.createHash("sha256").update(tenantId).digest("hex").slice(0, 24);

  return {
    suspicious: deduplicatedRules.length > 0,
    action: deduplicatedRules.length > 0 ? "quarantine" : "allow",
    failure_code: deduplicatedRules.length > 0 ? "PROMPT_INJECTION_DETECTED" : null,
    scanner_version: HANDOFF_INJECTION_SCANNER_VERSION,
    trust_boundary: { ...UNTRUSTED_DATA_BOUNDARY },
    content_digest: contentDigest,
    matched_rules: deduplicatedRules,
    envelope: {
      text_count: extracted.text_count,
      item_count: extracted.item_count,
      total_chars: extracted.total_chars,
      truncated: extracted.truncated,
    },
    provenance: {
      tenant_scope_digest: tenantScopeDigest,
      from_agent_id: sender,
      to_agent_id: recipient,
      from_agent_signature_digest: signature
        ? crypto.createHash("sha256").update(`${tenantId}\u0000${signature}`).digest("hex").slice(0, 32)
        : null,
      from_client_type: clientType || null,
      thread_id: thread || null,
    },
    lexical_assessment: {
      engine_version: lexicalAssessment.engine_version,
      catalog_fingerprint: lexicalAssessment.catalog_fingerprint,
      disposition: lexicalAssessment.disposition,
      risk_band: lexicalAssessment.risk_band,
      matched_families: [...lexicalAssessment.matched_families],
      quoted_or_reported: lexicalAssessment.context.quoted || lexicalAssessment.context.reported,
      negated: lexicalAssessment.context.negated,
      explicit_confirmation_eligible: lexicalAssessment.explicit_confirmation_eligible,
      grants_authority: false,
    },
    false_positive_policy: deduplicatedRules.length > 0
      ? {
          automatic_release: false,
          review_required: true,
          recommended_disposition: lexicalAssessment.disposition === "block" || extracted.truncated ? "block" : "clarify",
          explicit_confirmation_eligible: lexicalAssessment.disposition === "clarify"
            || (lexicalAssessment.disposition === "allow" && !extracted.truncated),
          final_authority: "universal_core",
          safe_retry: "Resubmit a declarative summary without executable instructions or quoted control-language.",
        }
      : null,
  };
}

export function guardInterAgentEnvelope(context = {}) {
  let scan = scanInterAgentHandoff(context);
  if (scan.suspicious) {
    return {
      allowed: false,
      value: null,
      quarantine: publicQuarantineReceipt(scan, {
        quarantine_id: `quarantine_${crypto.randomUUID()}`,
        created_at: new Date().toISOString(),
      }),
      trust_boundary: { ...UNTRUSTED_DATA_BOUNDARY },
    };
  }
  try {
    return {
      allowed: true,
      value: context.body === undefined ? null : JSON.parse(JSON.stringify(context.body)),
      quarantine: null,
      trust_boundary: { ...UNTRUSTED_DATA_BOUNDARY },
    };
  } catch {
    scan = {
      ...scan,
      suspicious: true,
      action: "quarantine",
      matched_rules: [...new Set([...scan.matched_rules, "envelope_unscannable"])],
      false_positive_policy: {
        automatic_release: false,
        review_required: true,
        recommended_disposition: "clarify",
        explicit_confirmation_eligible: true,
        final_authority: "universal_core",
        safe_retry: "Resubmit a declarative summary without executable instructions or quoted control-language.",
      },
    };
    return {
      allowed: false,
      value: null,
      quarantine: publicQuarantineReceipt(scan, {
        quarantine_id: `quarantine_${crypto.randomUUID()}`,
        created_at: new Date().toISOString(),
      }),
      trust_boundary: { ...UNTRUSTED_DATA_BOUNDARY },
    };
  }
}

export function publicQuarantineReceipt(scan, { quarantine_id, created_at, idempotent_replay = false } = {}) {
  return {
    quarantine_id,
    state: "quarantined",
    propagation_allowed: false,
    content_digest: scan.content_digest,
    scanner_version: scan.scanner_version,
    matched_rules: [...scan.matched_rules],
    provenance: { ...scan.provenance },
    false_positive_policy: scan.false_positive_policy,
    lexical_assessment: scan.lexical_assessment,
    created_at,
    idempotent_replay,
  };
}
