import crypto from "node:crypto";

export const HUMAN_TONE_SCHEMA_VERSION = "human_tone_review_v1";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function humanToneDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function normalizedText(value) {
  return String(value ?? "").trim().normalize("NFC");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function protectedTokens(text, explicit = []) {
  const found = text.match(/(https?:\/\/[^\s)]+|\[[^\]]+\]|\{[^}]+\}|%[a-zA-Z0-9_$]+%|\b[A-Z][A-Z0-9_]{2,}\b|\b\d+(?:[.,]\d+)?\s?(?:€|EUR|USD|%|anni|years?)?)/gu) || [];
  return unique([...explicit.map(normalizedText), ...found]);
}

function normalizedNumbers(text) {
  return unique((text.match(/\b\d+(?:[.,]\d+)?\b/gu) || []).map((item) => item.replace(",", ".")));
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export function analyzeHumanToneTransformation(input = {}) {
  const sourceText = normalizedText(input.source_text);
  const candidateText = normalizedText(input.candidate_text ?? input.humanized_text);
  const audience = normalizedText(input.audience);
  const surface = normalizedText(input.surface ?? input.surface_type);
  const locale = normalizedText(input.locale ?? input.target_locale ?? "it-IT");
  if (!sourceText) throw new Error("human_tone_source_text_required");
  if (!candidateText) throw new Error("human_tone_candidate_text_required");
  if (!audience) throw new Error("human_tone_audience_required");
  if (!surface) throw new Error("human_tone_surface_required");

  const sourceDigest = humanToneDigest(sourceText);
  const candidateDigest = humanToneDigest(candidateText);
  const sourceTokens = protectedTokens(sourceText, Array.isArray(input.protected_tokens) ? input.protected_tokens : []);
  const missingTokens = sourceTokens.filter((token) => !candidateText.includes(token));
  const sourceNumbers = normalizedNumbers(sourceText);
  const introducedNumbers = normalizedNumbers(candidateText).filter((number) => !sourceNumbers.includes(number));
  const instructions = normalizedText(input.instructions ?? input.request);
  const candidateLower = candidateText.toLowerCase();
  const sourceLower = sourceText.toLowerCase();
  const defects = [];
  const add = (code, severity, detail) => defects.push({ code, severity, detail });

  for (const token of missingTokens) add("protected_token_altered", "blocker", token);
  for (const number of introducedNumbers) add("number_introduced", "blocker", number);

  const firstPersonExperience = [
    /\b(?:io|noi)\s+(?:ho|abbiamo)\s+(?:provato|vissuto|testato|aiutato|creato)\b/iu,
    /\bI\s+(?:personally\s+)?(?:tried|experienced|tested|helped|created)\b/iu,
    /\bwe\s+have\s+(?:helped|served|transformed)\b/iu,
  ];
  if (hasAny(candidateText, firstPersonExperience) && !hasAny(sourceText, firstPersonExperience) && input.first_party_evidence_verified !== true) {
    add("invented_lived_experience", "blocker", "candidate introduces unverified first-person experience");
  }

  const testimonial = /\b(?:testimonianza|cliente dice|recensione verificata|testimonial|verified review|our clients say)\b/iu;
  if (testimonial.test(candidateText) && !testimonial.test(sourceText) && input.testimonial_evidence_verified !== true) {
    add("fabricated_testimonial", "blocker", "candidate introduces an unverified testimonial");
  }

  const absoluteClaims = ["garantito", "garantita", "garantisce", "garantiamo", "sempre", "senza rischi", "100%", "guaranteed", "guarantees", "always", "risk-free", "proven"];
  for (const claim of absoluteClaims) {
    if (candidateLower.includes(claim) && !sourceLower.includes(claim)) add("claim_inflation", "blocker", claim);
  }

  const evasion = /(?:bypass|evad|elud|ingann).{0,30}(?:ai detector|rilevatore|detector ai)|(?:ai detector|rilevatore|detector ai).{0,30}(?:bypass|evad|elud|ingann)/iu;
  if (evasion.test(instructions) || evasion.test(candidateText)) add("ai_detector_evasion", "blocker", "request attempts to evade authorship detection");

  const evidence = input.semantic_evidence && typeof input.semantic_evidence === "object" ? input.semantic_evidence : {};
  const independentEvidence = evidence.independently_verified === true
    && /^[a-f0-9]{64}$/.test(String(evidence.receipt_digest || ""))
    && evidence.source_digest === sourceDigest
    && evidence.candidate_digest === candidateDigest
    && normalizedText(evidence.builder_actor_id)
    && normalizedText(evidence.verifier_actor_id)
    && evidence.builder_actor_id !== evidence.verifier_actor_id
    && normalizedText(evidence.builder_session_id)
    && normalizedText(evidence.verifier_session_id)
    && evidence.builder_session_id !== evidence.verifier_session_id
    && evidence.meaning_preserved === true
    && evidence.claims_preserved === true
    && evidence.action_preserved === true;

  if (!independentEvidence) add("independent_semantic_evidence_missing", "review", "exact source/candidate evidence is required");
  const blockers = defects.filter((item) => item.severity === "blocker");
  const status = blockers.length ? "BLOCKED" : independentEvidence ? "PASS" : "REVIEW_REQUIRED";
  const result = {
    schema_version: HUMAN_TONE_SCHEMA_VERSION,
    mode: "meaning_locked_human_tone_review",
    status,
    source_digest: sourceDigest,
    candidate_digest: candidateDigest,
    audience,
    surface,
    locale,
    protected_token_count: sourceTokens.length,
    defects,
    independent_semantic_evidence_verified: independentEvidence,
    eligible_for_owner_review: status === "PASS",
    publish_ready: false,
    execution_authorized: false,
    authorship_detection_claimed: false,
    recommended_companion_branches: [
      "lexical_semantic_intelligence",
      "ramo_testo",
      "translation_governance",
      "content_localization_guard",
      "quality_verification_intelligence",
    ],
  };
  return { ...result, review_digest: humanToneDigest(result) };
}
