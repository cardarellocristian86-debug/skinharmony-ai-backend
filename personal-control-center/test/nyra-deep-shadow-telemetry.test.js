"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  aggregateShadowTelemetry,
  appendShadowTelemetry,
  buildShadowTelemetryEvent,
  readShadowTelemetry,
} = require("../lib/nyra-deep-shadow-telemetry");
const { loadCatalog } = require("../lib/nyra-deep-branch-v2");

const fingerprint = "a".repeat(64);
const corePayload = {
  result: {
    nyra_neural_network: {
      opened_branches: [
        { id: "context_intelligence" },
        { id: "work_intake" },
        { id: "risk_governance" },
        { id: "analyzer_domain" },
      ],
      denied_branches: ["suite_domain"],
    },
  },
};

function eventAt(observedAt, overrides = {}) {
  return buildShadowTelemetryEvent({
    observedAt,
    service: "nyra-test",
    tenantId: "codexai",
    domainPackId: "skinharmony",
    localInterpretation: {
      proposed_branches: [
        "context_intelligence",
        "work_intake",
        "risk_governance",
        "quality_verification",
      ],
    },
    corePayload,
    deepBranchV2: {
      mode: "shadow",
      state: "shadow_v1_authoritative",
      catalog_fingerprint: fingerprint,
      selected_branches: [
        { id: "context_intelligence" },
        { id: "work_intake" },
        { id: "risk_governance" },
        { id: "analyzer_domain" },
      ],
      evaluations: [
        {
          node_id: "analyzer_domain.uncertainty_abstention.analyzer_abstention_controller",
          state: "human_review_required_low_confidence",
          reason_codes: ["confidence_below_threshold"],
          evidence: [{ customer_name: "Must never be retained" }],
        },
        {
          node_id: "analyzer_domain.uncertainty_abstention.analyzer_abstention_controller.verifier",
          state: "not_activated_subbranch_mismatch",
          reason_codes: ["subbranch_not_requested"],
        },
      ],
      execution_authorized: false,
      core_final_authority: true,
    },
    requestedSubbranchId: "uncertainty_abstention",
    coreLatencyMs: 12.34567,
    deepLatencyMs: 3.45678,
    ...overrides,
  });
}

test("shadow event retains only bounded routing telemetry and no prompt, evidence, request or node input", () => {
  const event = eventAt("2026-07-24T10:00:00.000Z", {
    localInterpretation: {
      proposed_branches: ["context_intelligence", "quality_verification"],
      raw_prompt: "Cristian Rossi +39 333 1234567",
    },
    corePayload: {
      ...corePayload,
      request_id: "customer@example.com",
      evidence: [{ customer_name: "Maria Bianchi" }],
    },
  });
  const serialized = JSON.stringify(event);

  for (const forbidden of [
    "Cristian Rossi",
    "+39 333",
    "customer@example.com",
    "Maria Bianchi",
    "Must never be retained",
    "\"raw_prompt\":",
    "\"node_inputs\":",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(event.v2_route.signal_branch_ids, ["analyzer_domain", "quality_verification"]);
  assert.equal(event.evaluation.abstention_count, 1);
  assert.equal(event.evaluation.human_review_count, 1);
  assert.equal(event.evaluation.not_activated_count, 1);
  assert.equal(event.privacy.pii_fields_stored, false);
  assert.equal(event.timing_ms.core, 12.346);
});

test("JSONL append/read is bounded and ignores malformed records", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nyra-shadow-telemetry-"));
  const filePath = path.join(tempRoot, "telemetry.jsonl");
  const event = eventAt("2026-07-24T10:00:00.000Z");
  appendShadowTelemetry(filePath, event);
  fs.appendFileSync(filePath, "{malformed}\n", "utf8");

  const loaded = readShadowTelemetry(filePath);
  assert.equal(loaded.events.length, 1);
  assert.equal(loaded.malformed_line_count, 1);
  assert.equal(loaded.truncated, false);
  assert.equal(loaded.events[0].event_id, event.event_id);
});

test("7/30 day aggregates distinguish opening, signal, evaluation and honest measurement limits", () => {
  const now = Date.parse("2026-07-24T12:00:00.000Z");
  const events = [
    eventAt("2026-07-23T12:00:00.000Z"),
    eventAt("2026-07-14T12:00:00.000Z", {
      requestedSubbranchId: "",
      deepBranchV2: {
        mode: "shadow",
        state: "shadow_v1_authoritative",
        catalog_fingerprint: fingerprint,
        selected_branches: [{ id: "context_intelligence" }],
        evaluations: [],
        execution_authorized: false,
        core_final_authority: true,
      },
    }),
    eventAt("2026-06-01T12:00:00.000Z"),
  ];
  const options = {
    now,
    knownBranchIds: [
      "context_intelligence",
      "quality_verification",
      "analyzer_domain",
      "suite_domain",
    ],
    knownSubbranchIds: [
      "analyzer_domain.uncertainty_abstention",
      "suite_domain.content_publishing",
    ],
  };
  const seven = aggregateShadowTelemetry(events, { ...options, days: 7 });
  const thirty = aggregateShadowTelemetry(events, { ...options, days: 30 });

  assert.equal(seven.event_count, 1);
  assert.equal(thirty.event_count, 2);
  assert.equal(seven.branch_usage.opened_counts.context_intelligence, 1);
  assert.equal(seven.branch_usage.signal_counts.analyzer_domain, 1);
  assert.equal(seven.branch_usage.signal_counts.quality_verification, 1);
  assert.equal(seven.branch_usage.signal_counts.context_intelligence, undefined);
  assert.deepEqual(seven.branch_usage.unused_ids, ["context_intelligence", "suite_domain"]);
  assert.equal(seven.subbranch_usage.evaluated_counts["analyzer_domain.uncertainty_abstention"], 1);
  assert.deepEqual(seven.subbranch_usage.unused_ids, ["suite_domain.content_publishing"]);
  assert.equal(thirty.subbranch_usage.events_without_deep_evaluation, 1);
  assert.equal(seven.evaluation.abstention_count, 1);
  assert.equal(seven.evaluation.not_activated_count, 1);
  assert.equal(seven.parity.selected_outside_core_count, 0);
  assert.equal(seven.parity.authority_violation_count, 0);
  assert.equal(seven.collision_measurement.available, false);
  assert.equal(seven.collision_measurement.observed_count, null);
  assert.equal(seven.gap_indicators.taxonomy_gap_count, null);
});

test("aggregate surfaces routing and authority parity violations", () => {
  const now = Date.parse("2026-07-24T12:00:00.000Z");
  const unsafe = eventAt("2026-07-24T10:00:00.000Z", {
    deepBranchV2: {
      mode: "shadow",
      state: "shadow_v1_authoritative",
      catalog_fingerprint: fingerprint,
      selected_branches: [{ id: "software_intelligence" }],
      evaluations: [],
      execution_authorized: true,
      core_final_authority: false,
    },
  });
  const aggregate = aggregateShadowTelemetry([unsafe], {
    days: 7,
    now,
    knownBranchIds: ["software_intelligence"],
  });

  assert.equal(aggregate.parity.selected_outside_core_count, 1);
  assert.equal(aggregate.parity.core_opened_not_selected_count, 4);
  assert.equal(aggregate.parity.authority_violation_count, 1);
  assert.equal(aggregate.gap_indicators.route_selection_gap_count, 5);
});

test("real catalog aggregation preserves all 239 branch-qualified subbranches", () => {
  const loaded = loadCatalog({ runtimeMode: "lazy" });
  assert.equal(loaded.ok, true, loaded.validation.errors.join("\n"));
  const knownBranchIds = loaded.catalog.branches.map((branch) => branch.id);
  const knownSubbranchIds = loaded.catalog.branches.flatMap((branch) =>
    branch.subbranches.map((subbranch) => `${branch.id}.${subbranch.id}`)
  );
  const aggregate = aggregateShadowTelemetry([], {
    days: 30,
    now: Date.parse("2026-07-24T12:00:00.000Z"),
    knownBranchIds,
    knownSubbranchIds,
  });

  assert.equal(knownSubbranchIds.length, 239);
  assert.equal(new Set(knownSubbranchIds).size, 239);
  assert.equal(aggregate.subbranch_usage.known_count, 239);
  assert.equal(aggregate.subbranch_usage.unused_count, 239);
});
