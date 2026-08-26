import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  assembleEntity360Snapshot,
  deterministicEntity360Id,
  verifyEntity360Snapshot,
} from "../src/entity360.js";
import { loadEntity360Configuration } from "../src/entity360Runtime.js";

const iterations = Math.min(10_000, Math.max(1, Number(process.env.ENTITY360_BENCHMARK_ITERATIONS || 250)));
const { policy, ontology } = loadEntity360Configuration();
const tenant = "benchmark-tenant";
const identity = { work_id: "91e82640-9edc-5424-a3e8-eb7853b0d8dd" };
const entityId = deterministicEntity360Id({ tenant_id: tenant, entity_type: "work", identity });
const asOf = "2026-08-25T10:00:00.000Z";
const adapterRegistryVersion = "entity_360_adapter_registry_v1";
const qualificationSecret = "entity360-benchmark-only-qualification-key-material-v1";
function qualificationSignature(payload, purpose) {
  return `bench_${crypto.createHmac("sha256", qualificationSecret)
    .update(JSON.stringify({ purpose, payload })).digest("hex")}`;
}
const qualificationSigner = Object.freeze({
  algorithm: "hmac-sha256",
  key_id: "entity360-benchmark-key-v1",
  sign(payload, { purpose } = {}) { return qualificationSignature(payload, purpose); },
});
const qualificationVerifier = Object.freeze({
  verify(payload, signature, { purpose, key_id: keyId } = {}) {
    if (keyId !== qualificationSigner.key_id) return false;
    const expected = Buffer.from(qualificationSignature(payload, purpose));
    const actual = Buffer.from(String(signature || ""));
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  },
});

function contribution(sourceId, adapterVersion, evidenceClass, evidenceDigest, facts) {
  return { tenant_id: tenant, entity_id: entityId, source_id: sourceId,
    adapter_version: adapterVersion, source_watermark: `${sourceId}:benchmark`,
    observed_at: asOf, recorded_at: asOf, evidence_class: evidenceClass,
    evidence_digests: [evidenceDigest], evidence_refs: [`benchmark:${sourceId}`], facts };
}

const contributions = [
  contribution("work_continuity", "work_continuity_entity360_adapter_v1", "authoritative_record",
    "a".repeat(64), [
      { fact_id: "work.identity", value: { work_id: identity.work_id }, criticality: "high_impact" },
      { fact_id: "work.current_state", value: { status: "ACTIVE" }, criticality: "high_impact",
        evidence_class: "verified_observation" },
    ]),
  contribution("intent", "intent_entity360_adapter_v1", "authoritative_record", "b".repeat(64), [
    { fact_id: "governance.intent.binding", value: { intent_digest: "b".repeat(64) },
      criticality: "high_impact" },
  ]),
  contribution("genesis", "genesis_entity360_adapter_v1", "authoritative_record", "c".repeat(64), [
    { fact_id: "governance.genesis.binding", value: { genesis_digest: "c".repeat(64) },
      criticality: "high_impact" },
  ]),
  contribution("icf", "icf_entity360_adapter_v2", "authoritative_record", "d".repeat(64), [
    { fact_id: "governance.icf.binding", value: { ledger_head_digest: "d".repeat(64) },
      criticality: "high_impact" },
  ]),
];

const durations = [];
const digests = new Set();
let verifiedSnapshots = 0;
for (let index = 0; index < iterations; index += 1) {
  const startedAt = performance.now();
  const snapshot = assembleEntity360Snapshot({ tenant_id: tenant, entity_type: "work", identity,
    as_of: asOf, snapshot_version: 1,
    source_contributions: index % 2 ? [...contributions].reverse() : contributions,
    source_discovery: [
      ...contributions.map((item) => ({ source_id: item.source_id, state: "accepted",
        evidence_digest: item.evidence_digests[0], evidence_ref: item.evidence_refs[0] })),
      { source_id: "entity360_context_assembler", state: "complete",
        consistent_cut: "postgres_repeatable_read" },
    ] },
  { policy, ontology, created_at: asOf, adapter_registry_version: adapterRegistryVersion,
    qualification_signer: qualificationSigner });
  durations.push(performance.now() - startedAt);
  digests.add(snapshot.deterministic_immutable_digest);
  const verification = verifyEntity360Snapshot(snapshot, { policy, ontology,
    verification_time: asOf, qualification_verifier: qualificationVerifier });
  if (!verification.valid) {
    throw new Error(`entity360_benchmark_verification_failed:${verification.reasons.join(",")}`);
  }
  verifiedSnapshots += 1;
}

durations.sort((left, right) => left - right);
const percentile = (ratio) => durations[Math.min(durations.length - 1, Math.floor(durations.length * ratio))];
const result = {
  schema_version: "entity_360_benchmark_v1",
  iterations,
  deterministic_digest_count: digests.size,
  independently_verified_snapshot_count: verifiedSnapshots,
  latency_ms: {
    minimum: durations[0],
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    maximum: durations.at(-1),
    mean: durations.reduce((sum, value) => sum + value, 0) / durations.length,
  },
  policy_version: policy.policy_version,
  ontology_version: ontology.ontology_version,
  execution_authorized: false,
};

if (digests.size !== 1) throw new Error("entity360_benchmark_determinism_failed");
if (verifiedSnapshots !== iterations) throw new Error("entity360_benchmark_verification_count_failed");
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
