import crypto from "node:crypto";

export const OFFICE_ARTIFACT_SCHEMA_VERSION = "nyra_office_artifact_intelligence_v1";
const KINDS = new Set(["document", "presentation", "workbook", "mixed"]);
const MAX_UNITS = 200;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function officeArtifactDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function text(value, code, max = 500) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) fail(code);
  return normalized;
}

function identifier(value, code) {
  const normalized = String(value || "").trim();
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(normalized)) fail(code);
  return normalized;
}

function integer(value, code, min, max) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) fail(code);
  return normalized;
}

function digest(value, code) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) fail(code);
  return normalized;
}

function unique(values) {
  return [...new Set(values)];
}

function qualityProfile(kind) {
  const common = [
    "all_planned_units_present",
    "all_units_rendered",
    "no_blank_or_partial_required_unit",
    "no_clipping_overflow_or_unintended_overlap",
    "no_unresolved_placeholder",
    "reading_order_and_alt_text_valid",
    "independent_visual_verification",
  ];
  if (kind === "document") return [...common, "heading_and_pagination_continuity", "table_geometry_valid"];
  if (kind === "presentation") return [...common, "slide_density_and_title_fit", "speaker_note_sources_bound"];
  if (kind === "workbook") return [...common, "formula_error_scan", "chart_data_reconciliation", "typed_number_formats"];
  return [...common, "cross_format_revision_consistency", "chart_data_reconciliation", "pagination_continuity"];
}

function minimumFontFor(kind) {
  if (kind === "presentation") return 16;
  if (kind === "workbook") return 10;
  return 9;
}

export function buildOfficeArtifactPlan(input = {}) {
  const kind = String(input.kind || "").trim();
  if (!KINDS.has(kind)) fail("office_artifact_kind_invalid");
  const plannedUnits = integer(input.planned_units, "office_artifact_planned_units_invalid", 1, MAX_UNITS);
  const rawSections = Array.isArray(input.sections) ? input.sections : [];
  if (!rawSections.length || rawSections.length > 80) fail("office_artifact_sections_invalid");
  const sections = rawSections.map((section, index) => ({
    section_id: identifier(section.section_id, "office_artifact_section_id_invalid"),
    title: text(section.title, "office_artifact_section_title_invalid", 200),
    purpose: text(section.purpose, "office_artifact_section_purpose_invalid", 1000),
    unit_budget: integer(section.unit_budget, "office_artifact_section_budget_invalid", 1, plannedUnits),
    order: index + 1,
    required_claim_ids: unique((Array.isArray(section.required_claim_ids) ? section.required_claim_ids : [])
      .map((item) => identifier(item, "office_artifact_claim_id_invalid"))),
  }));
  if (new Set(sections.map((item) => item.section_id)).size !== sections.length) {
    fail("office_artifact_section_id_duplicate");
  }
  if (sections.reduce((sum, section) => sum + section.unit_budget, 0) !== plannedUnits) {
    fail("office_artifact_section_budget_mismatch");
  }
  const checkpointInterval = integer(input.checkpoint_interval || 10,
    "office_artifact_checkpoint_interval_invalid", 1, 25);
  const checkpointUnits = [];
  for (let unit = checkpointInterval; unit < plannedUnits; unit += checkpointInterval) checkpointUnits.push(unit);
  checkpointUnits.push(plannedUnits);
  const plan = {
    schema_version: OFFICE_ARTIFACT_SCHEMA_VERSION,
    artifact_id: identifier(input.artifact_id, "office_artifact_id_invalid"),
    kind,
    title: text(input.title, "office_artifact_title_invalid", 300),
    audience: text(input.audience, "office_artifact_audience_invalid", 1000),
    purpose: text(input.purpose, "office_artifact_purpose_invalid", 1500),
    source_locale: text(input.source_locale || "it-IT", "office_artifact_source_locale_invalid", 20),
    target_locales: unique((Array.isArray(input.target_locales) ? input.target_locales : [])
      .map((item) => text(item, "office_artifact_target_locale_invalid", 20))),
    brand_profile_id: input.brand_profile_id ? identifier(input.brand_profile_id, "office_artifact_brand_invalid") : null,
    template_digest: input.template_digest ? digest(input.template_digest, "office_artifact_template_digest_invalid") : null,
    source_revision_digest: digest(input.source_revision_digest, "office_artifact_source_revision_invalid"),
    planned_units: plannedUnits,
    maximum_units: MAX_UNITS,
    sections,
    context_ledger: {
      checkpoint_interval: checkpointInterval,
      checkpoint_units: checkpointUnits,
      required_fields: [
        "plan_digest", "source_revision_digest", "facts_digest", "claims_digest", "terminology_digest",
        "decisions_digest", "open_questions_digest", "completed_section_ids",
      ],
    },
    companion_branches: [
      "typography_layout_guard", "human_tone_intelligence", "lexical_semantic_intelligence", "ramo_testo", "research_evidence_intelligence",
      "quality_verification_intelligence", "decision_provenance_intelligence",
    ],
    quality_requirements: qualityProfile(kind),
    layout_contract: {
      minimum_font_pt: minimumFontFor(kind),
      every_unit_requires_sequence_marker: true,
      title_overflow_allowed: false,
      fixed_row_text_truncation_allowed: false,
    },
    microsoft_365: {
      external_write_authorized: false,
      required_for_write: ["authenticated_principal", "tenant_binding", "least_privilege_scope", "core_verdict", "owner_confirmation"],
    },
    execution_authorized: false,
  };
  return Object.freeze({ ...plan, plan_digest: officeArtifactDigest(plan) });
}

function push(defects, condition, code, subject = null) {
  if (!condition) defects.push({ code, subject });
}

export function evaluateOfficeArtifactQuality(plan, evidence = {}) {
  if (!plan || plan.schema_version !== OFFICE_ARTIFACT_SCHEMA_VERSION) fail("office_artifact_plan_required");
  const expectedPlanDigest = officeArtifactDigest(Object.fromEntries(Object.entries(plan)
    .filter(([key]) => key !== "plan_digest")));
  if (plan.plan_digest !== expectedPlanDigest) fail("office_artifact_plan_digest_mismatch");
  const defects = [];
  push(defects, evidence.plan_digest === plan.plan_digest, "stale_or_foreign_plan");
  push(defects, evidence.source_revision_digest === plan.source_revision_digest, "stale_source_revision");
  push(defects, /^[a-f0-9]{64}$/.test(String(evidence.receipt_digest || "")), "verified_receipt_missing");
  push(defects, evidence.independently_verified === true, "independent_verification_missing");
  push(defects, evidence.builder_actor_id && evidence.verifier_actor_id
    && evidence.builder_actor_id !== evidence.verifier_actor_id, "builder_self_verification");
  push(defects, evidence.builder_session_id && evidence.verifier_session_id
    && evidence.builder_session_id !== evidence.verifier_session_id, "builder_verifier_session_reuse");

  const units = Array.isArray(evidence.units) ? evidence.units : [];
  push(defects, units.length === plan.planned_units, "planned_unit_count_mismatch");
  const byNumber = new Map();
  for (const unit of units) {
    const number = Number(unit.unit_number);
    if (!Number.isInteger(number) || number < 1 || number > plan.planned_units || byNumber.has(number)) {
      defects.push({ code: "unit_identity_invalid", subject: unit.unit_number ?? null });
      continue;
    }
    byNumber.set(number, unit);
    const subject = `unit:${number}`;
    push(defects, unit.rendered === true, "unit_not_rendered", subject);
    push(defects, Number(unit.blank_ratio) >= 0 && Number(unit.blank_ratio) < 0.92, "blank_or_partial_unit", subject);
    push(defects, unit.required_content_present === true, "required_content_missing", subject);
    push(defects, Number(unit.clipped_text_count || 0) === 0, "clipped_text", subject);
    push(defects, Number(unit.overflow_count || 0) === 0, "content_outside_canvas", subject);
    push(defects, Number(unit.unintended_overlap_count || 0) === 0, "unintended_overlap", subject);
    push(defects, Number(unit.unresolved_placeholder_count || 0) === 0, "unresolved_placeholder", subject);
    push(defects, unit.reading_order_valid === true, "reading_order_invalid", subject);
    push(defects, unit.layout_consistent === true, "layout_drift", subject);
    push(defects, Number(unit.minimum_font_pt) >= plan.layout_contract.minimum_font_pt, "font_below_readability_floor", subject);
    push(defects, unit.sequence_marker_valid === true, "pagination_or_slide_number_invalid", subject);
    push(defects, unit.title_overflow !== true, "title_overflow", subject);
    push(defects, plan.sections.some((section) => section.section_id === unit.section_id), "unit_section_unknown", subject);
  }
  for (let number = 1; number <= plan.planned_units; number += 1) {
    push(defects, byNumber.has(number), "planned_unit_missing", `unit:${number}`);
  }
  for (const section of plan.sections) {
    const count = units.filter((unit) => unit.section_id === section.section_id).length;
    push(defects, count === section.unit_budget, "section_unit_budget_mismatch", section.section_id);
  }

  for (const chart of Array.isArray(evidence.charts) ? evidence.charts : []) {
    const subject = `chart:${String(chart.chart_id || "unknown")}`;
    push(defects, /^[a-f0-9]{64}$/.test(String(chart.data_source_digest || "")), "chart_source_missing", subject);
    push(defects, chart.values_match_source === true, "chart_data_mismatch", subject);
    push(defects, Boolean(String(chart.title || "").trim()), "chart_title_missing", subject);
    push(defects, chart.labels_legible === true, "chart_labels_illegible", subject);
    push(defects, chart.bounds_valid === true, "chart_outside_layout", subject);
    push(defects, Boolean(String(chart.alt_text || "").trim()), "chart_alt_text_missing", subject);
    push(defects, chart.axis_titles_required !== true || chart.axis_titles_present === true, "chart_axis_title_missing", subject);
    push(defects, chart.legend_required !== true || chart.legend_present === true, "chart_legend_missing", subject);
  }
  for (const asset of Array.isArray(evidence.images) ? evidence.images : []) {
    const subject = `image:${String(asset.image_id || "unknown")}`;
    push(defects, /^[a-f0-9]{64}$/.test(String(asset.provenance_digest || "")), "image_provenance_missing", subject);
    push(defects, ["licensed", "owned", "generated"].includes(asset.rights_status), "image_rights_unverified", subject);
    push(defects, asset.bounds_valid === true, "image_outside_layout", subject);
    push(defects, asset.crop_valid === true, "image_crop_invalid", subject);
    push(defects, asset.resolution_ok === true, "image_resolution_insufficient", subject);
    push(defects, asset.text_ocr_match !== false, "image_text_corrupted", subject);
    push(defects, asset.decorative === true || Boolean(String(asset.alt_text || "").trim()), "image_alt_text_missing", subject);
    push(defects, Number(asset.reuse_count || 1) <= 1 || asset.background === true, "image_reused_without_reason", subject);
  }

  const checkpoints = Array.isArray(evidence.context_checkpoints) ? evidence.context_checkpoints : [];
  const checkpointMap = new Map(checkpoints.map((item) => [Number(item.unit_number), item]));
  let previousCheckpointDigest = null;
  let previouslyCompleted = new Set();
  for (const number of plan.context_ledger.checkpoint_units) {
    const checkpoint = checkpointMap.get(number);
    push(defects, Boolean(checkpoint), "context_checkpoint_missing", `unit:${number}`);
    if (!checkpoint) continue;
    push(defects, checkpoint.plan_digest === plan.plan_digest, "context_checkpoint_plan_mismatch", `unit:${number}`);
    push(defects, checkpoint.source_revision_digest === plan.source_revision_digest,
      "context_checkpoint_source_mismatch", `unit:${number}`);
    for (const field of plan.context_ledger.required_fields.filter((item) => item.endsWith("_digest"))) {
      push(defects, /^[a-f0-9]{64}$/.test(String(checkpoint[field] || "")),
        "context_checkpoint_field_missing", `${number}:${field}`);
    }
    const completed = Array.isArray(checkpoint.completed_section_ids)
      ? checkpoint.completed_section_ids.map(String) : [];
    push(defects, completed.every((id) => plan.sections.some((section) => section.section_id === id)),
      "context_checkpoint_section_unknown", `unit:${number}`);
    push(defects, [...previouslyCompleted].every((id) => completed.includes(id)),
      "context_checkpoint_completion_regressed", `unit:${number}`);
    push(defects, (checkpoint.previous_checkpoint_digest || null) === previousCheckpointDigest,
      "context_checkpoint_chain_broken", `unit:${number}`);
    const checkpointPayload = Object.fromEntries(Object.entries(checkpoint)
      .filter(([key]) => key !== "checkpoint_digest"));
    const computedCheckpointDigest = officeArtifactDigest(checkpointPayload);
    push(defects, checkpoint.checkpoint_digest === computedCheckpointDigest,
      "context_checkpoint_digest_mismatch", `unit:${number}`);
    previousCheckpointDigest = checkpoint.checkpoint_digest || null;
    previouslyCompleted = new Set(completed);
  }
  push(defects, plan.sections.every((section) => previouslyCompleted.has(section.section_id)),
    "context_ledger_final_sections_incomplete");

  if (plan.kind === "workbook" || plan.kind === "mixed") {
    push(defects, Number(evidence.formula_error_count || 0) === 0, "workbook_formula_error");
    push(defects, evidence.key_totals_reconciled === true, "workbook_totals_unreconciled");
  }
  push(defects, evidence.full_visual_inventory === true, "sample_only_visual_review");
  push(defects, evidence.claims_reconciled === true, "claim_reconciliation_missing");
  push(defects, evidence.context_contradiction_count === 0, "long_context_contradiction");

  const uniqueDefects = [...new Map(defects.map((item) => [`${item.code}:${item.subject || ""}`, item])).values()];
  const result = {
    schema_version: "nyra_office_artifact_quality_v1",
    artifact_id: plan.artifact_id,
    plan_digest: plan.plan_digest,
    status: uniqueDefects.length ? "BLOCKED" : "PASS",
    release_eligible: uniqueDefects.length === 0,
    defects: uniqueDefects,
    checked_unit_count: units.length,
    planned_unit_count: plan.planned_units,
    execution_authorized: false,
  };
  return { ...result, evaluation_digest: officeArtifactDigest(result) };
}
