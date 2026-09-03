import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createWorkContinuityV2Store,
  deriveAuthenticatedTenantWorkAcl,
} from "../src/work-continuity-v2-store.js";

const WORK_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const PLAN_ID = "33333333-3333-4333-8333-333333333333";
const EVALUATION_ID = "44444444-4444-4444-8444-444444444444";
const LEGACY_EVIDENCE_ID = "55555555-5555-4555-8555-555555555555";
const REPLACEMENT_EVIDENCE_ID = "66666666-6666-4666-8666-666666666666";
const RECEIPT_ID = "77777777-7777-4777-8777-777777777777";
const WORKSPACE_DIGEST = "8".repeat(64);
const SUPERSEDING_PLAN_ID = "88888888-8888-4888-8888-888888888888";
const SUPERSEDING_EVALUATION_ID = "99999999-9999-4999-8999-999999999999";
const SUPERSEDING_EVIDENCE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPERSEDING_RECEIPT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUPERSEDING_WORKSPACE_DIGEST = "c".repeat(64);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
const RECEIPT_PAYLOAD = Object.freeze({
  schema_version: "native_agent_receipt_v1",
  receipt_id: RECEIPT_ID,
  work_id: WORK_ID,
  plan_id: PLAN_ID,
  receipt_type: "agent_reported",
  agent_id: "verifier-agent",
  task_id: "verifier-task",
  task_kind: "verifier",
  status: "completed",
  report_digest: "a".repeat(64),
  native_session_fingerprint: "b".repeat(64),
  host_native: true,
  provider_execution: false,
  host_permission_override: false,
  host_policy_override: false,
  host_policy_must_allow: true,
  coordinator_session_fingerprint: "c".repeat(64),
  host_type: "codex_native",
});
const RECEIPT_DIGEST = digest(RECEIPT_PAYLOAD);
function key(...parts) { return parts.join("\0"); }
function cloneMap(value) { return new Map([...value].map(([k, v]) => [k, structuredClone(v)])); }

function identity(tenantId = "tenant-a") {
  const base = {
    tenantId,
    subject: "owner",
    userId: "owner",
    agentPresence: { agent_id: "owner-agent", session_fingerprint: "a".repeat(64) },
    authenticatedTenantMembership: {
      schema_version: "tenant_membership_binding_v1",
      authenticated: true,
      tenant_id: tenantId,
      subject: "owner",
      role: "tenant_owner",
      expires_at: "2030-01-01T00:00:00.000Z",
      team_ids: [],
      managed_team_ids: [],
      assigned_work_ids: [],
    },
  };
  return { ...base, tenant_work_acl: deriveAuthenticatedTenantWorkAcl(
    base,
    Date.parse("2026-08-29T10:00:00.000Z"),
  ) };
}

class PrecommitPool {
  constructor() {
    this.works = new Map();
    this.tasks = new Map();
    this.evidence = new Map();
    this.nativeEvidence = new Map();
    this.receipts = new Map();
    this.plans = [];
    this.evaluations = [];
    this.gates = new Map();
    this.mappings = new Map();
    this.fulfillments = new Map();
    this.supersedingGates = [];
    this.supersedingMappings = new Map();
    this.supersedingFulfillments = new Map();
    this.claims = new Map();
    this.claimFulfillments = new Map();
    this.claimReconciliations = new Map();
    this.events = [];
    this.legacyIntentAnchors = new Map();
  }
  snapshot() {
    return {
      works: cloneMap(this.works), tasks: cloneMap(this.tasks), evidence: cloneMap(this.evidence),
      nativeEvidence: cloneMap(this.nativeEvidence), receipts: cloneMap(this.receipts),
      plans: structuredClone(this.plans), evaluations: structuredClone(this.evaluations),
      gates: cloneMap(this.gates), mappings: cloneMap(this.mappings),
      fulfillments: cloneMap(this.fulfillments), events: structuredClone(this.events),
      supersedingGates: structuredClone(this.supersedingGates),
      supersedingMappings: cloneMap(this.supersedingMappings),
      supersedingFulfillments: cloneMap(this.supersedingFulfillments),
      claims: cloneMap(this.claims), claimFulfillments: cloneMap(this.claimFulfillments),
      claimReconciliations: cloneMap(this.claimReconciliations),
      legacyIntentAnchors: cloneMap(this.legacyIntentAnchors),
    };
  }
  restore(snapshot) { Object.assign(this, snapshot); }
  async connect() {
    let snapshot;
    return {
      query: async (sql, parameters = []) => {
        const queryText = typeof sql === "string" ? sql : sql.text;
        if (!parameters.length && Array.isArray(sql?.values)) parameters = sql.values;
        const q = queryText.replace(/\s+/g, " ").trim();
        if (q === "BEGIN") { snapshot = this.snapshot(); return { rows: [], rowCount: 0 }; }
        if (q === "COMMIT") { snapshot = null; return { rows: [], rowCount: 0 }; }
        if (q === "ROLLBACK") { if (snapshot) this.restore(snapshot); return { rows: [], rowCount: 0 }; }
        if (q.startsWith("SET LOCAL ")) return { rows: [], rowCount: 0 };
        return this.query(queryText, parameters);
      },
      release() {},
    };
  }
  async query(sql, parameters = []) {
    const queryText = typeof sql === "string" ? sql : sql.text;
    if (!parameters.length && Array.isArray(sql?.values)) parameters = sql.values;
    const q = queryText.replace(/\s+/g, " ").trim();
    if (q.includes("CREATE TABLE IF NOT EXISTS tenant_work")) return { rows: [], rowCount: 0 };
    if (q.startsWith("SELECT * FROM tenant_work WHERE tenant_id=$1 AND work_id=$2")) {
      const row = this.works.get(key(parameters[0], parameters[1]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT * FROM tenant_work_precommit_ticket_gate") &&
        !q.startsWith("SELECT * FROM tenant_work_precommit_ticket_gate_supersession") &&
        !q.startsWith("SELECT * FROM tenant_work_precommit_ticket_gate_claim")) {
      const row = this.gates.get(key(parameters[0], parameters[1]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT * FROM tenant_work_precommit_ticket_gate_supersession")) {
      const rows = this.supersedingGates.filter((row) => row.tenant_id === parameters[0] &&
        row.work_id === parameters[1]).sort((a, b) => b.gate_version - a.gate_version);
      return { rows: rows.length ? [structuredClone(rows[0])] : [], rowCount: rows.length ? 1 : 0 };
    }
    if (q.startsWith("SELECT gate_version,reconciliation_digest FROM tenant_work_precommit_ticket_gate_supersession")) {
      const rows = this.supersedingGates.filter((row) => row.tenant_id === parameters[0] &&
        row.work_id === parameters[1]).sort((a, b) => b.gate_version - a.gate_version);
      return { rows: rows.length ? [structuredClone(rows[0])] : [], rowCount: rows.length ? 1 : 0 };
    }
    if (q.startsWith("SELECT legacy_evidence_id,replacement_evidence_id,")) {
      const source = q.includes("reconciliation_supersession")
        ? this.supersedingMappings : this.mappings;
      const rows = [...source.values()].filter((row) => row.tenant_id === parameters[0] &&
        row.work_id === parameters[1] && row.task_id === parameters[2] &&
        (!q.includes("gate_version=$4") || row.gate_version === parameters[3]))
        .sort((a, b) => a.legacy_evidence_id.localeCompare(b.legacy_evidence_id));
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (q.startsWith("SELECT r.*,legacy.required AS legacy_required")) {
      const source = q.includes("reconciliation_supersession")
        ? this.supersedingMappings : this.mappings;
      const rows = [...source.values()].filter((row) => row.tenant_id === parameters[0] &&
        row.work_id === parameters[1] && row.task_id === parameters[2] &&
        (!q.includes("r.gate_version=$4") || row.gate_version === parameters[3])).map((row) => {
        const legacy = this.evidence.get(key(row.tenant_id, row.legacy_evidence_id));
        const replacement = this.evidence.get(key(row.tenant_id, row.replacement_evidence_id));
        const native = this.nativeEvidence.get(key(row.tenant_id, row.replacement_evidence_id));
        return { ...row,
          legacy_required: legacy?.required,
          legacy_independently_verified: legacy?.independently_verified,
          replacement_required: replacement?.required,
          replacement_independently_verified: replacement?.independently_verified,
          current_replacement_evidence_digest: replacement?.digest,
          replacement_kind: replacement?.kind,
          native_plan_id: native?.plan_id,
          native_evidence_id: native?.evidence_id,
          current_native_receipt_id: native?.native_receipt_id,
          current_native_receipt_digest: native?.native_receipt_digest,
          native_evidence_digest: native?.evidence_digest,
        };
      }).sort((a, b) => a.legacy_evidence_id.localeCompare(b.legacy_evidence_id));
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (q.startsWith("SELECT task_id,status,required,acceptance_verified FROM tenant_work_task")) {
      const row = this.tasks.get(key(parameters[0], parameters[2]));
      return { rows: row && row.work_id === parameters[1] ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT plan_id,plan,plan_digest,status,plan_version,supersedes_plan_id")) {
      const rows = this.plans.filter((row) => row.tenant_id === parameters[0] && row.work_id === parameters[1])
        .sort((a, b) => a.plan_version - b.plan_version || a.plan_id.localeCompare(b.plan_id));
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (q.startsWith("SELECT evaluation_id,evaluation,evaluation_digest FROM core_continuity_closure_evaluations")) {
      const rows = this.evaluations.filter((row) => row.tenant_id === parameters[0] &&
        row.work_id === parameters[1] && row.plan_id === parameters[2])
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) ||
          b.evaluation_id.localeCompare(a.evaluation_id));
      return { rows: rows.length ? [structuredClone(rows[0])] : [], rowCount: rows.length ? 1 : 0 };
    }
    if (q.startsWith("SELECT tenant_id,work_id,sequence_number,event_type,payload,")) {
      const rows = this.events.filter((row) => row.tenant_id === parameters[0] &&
        row.work_id === parameters[1] && row.event_type === "work_v2_created")
        .sort((a, b) => a.sequence_number - b.sequence_number);
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (q.startsWith("SELECT anchor,intent_digest FROM core_continuity_intent_anchors")) {
      const row = this.legacyIntentAnchors.get(key(parameters[0], parameters[1]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT ticket_id,ticket_digest,gate_projection_digest")) {
      const source = q.includes("fulfillment_supersession")
        ? this.supersedingFulfillments : this.fulfillments;
      const row = q.includes("gate_version=$4")
        ? source.get(key(parameters[0], parameters[1], parameters[3]))
        : q.includes("gate_version=$3")
          ? source.get(key(parameters[0], parameters[1], parameters[2]))
          : source.get(key(parameters[0], parameters[1]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT c.*,f.ticket_id AS fulfilled_ticket_id")) {
      const rows = [...this.claims.values()].filter((row) => row.tenant_id === parameters[0] &&
        row.work_id === parameters[1] && (q.includes("c.idempotency_key=$4")
          ? (row.gate_projection_digest === parameters[2] || row.idempotency_key === parameters[3])
          : q.includes("c.claim_id=$3")
            ? row.claim_id === parameters[2]
            : q.includes("c.continuation_ref=$3")
              ? row.continuation_ref === parameters[2]
              : q.includes("$3::boolean IS TRUE")
                ? Boolean(this.claimFulfillments.get(key(
                  row.tenant_id, row.work_id, row.gate_projection_digest,
                )))
                : row.gate_projection_digest === parameters[2])).filter((row) =>
        !q.includes("c.request_digest=$4") ||
        (row.request_digest === parameters[3] && row.delegation_id === parameters[4] &&
          row.action_digest === parameters[5] && row.host_session_fingerprint === parameters[6]));
      const row = rows[0];
      const fulfillment = row && this.claimFulfillments.get(key(row.tenant_id, row.work_id,
        row.gate_projection_digest));
      const locator = row && this.claimReconciliations.get(key(
        row.tenant_id, row.work_id, row.claim_id, "ticket_locator_received",
      ));
      const before = row && this.claimReconciliations.get(key(
        row.tenant_id, row.work_id, row.claim_id, "before_ticket_locator",
      ));
      return { rows: row ? [{ ...structuredClone(row),
        fulfilled_ticket_id: fulfillment?.ticket_id || null,
        fulfilled_claim_id: fulfillment?.claim_id || null,
        fulfilled_claim_digest: fulfillment?.claim_digest || null,
        reconciled_ticket_id: locator?.ticket_id || null,
        before_ticket_locator: Boolean(before) }] : [],
        rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT * FROM tenant_work_precommit_ticket_gate_claim WHERE")) {
      const row = [...this.claims.values()].find((item) => item.tenant_id === parameters[0] &&
        item.work_id === parameters[1] && item.claim_id === parameters[2]);
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT * FROM tenant_work_precommit_ticket_gate_claim_reconciliation")) {
      const row = this.claimReconciliations.get(key(parameters[0], parameters[1], parameters[2], parameters[3]));
      return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (q.startsWith("SELECT evidence_id,required,independently_verified FROM tenant_work_evidence")) {
      const ids = new Set(parameters[2]);
      const rows = [...this.evidence.values()].filter((row) => row.tenant_id === parameters[0] &&
        row.work_id === parameters[1] && ids.has(row.evidence_id));
      return { rows: structuredClone(rows), rowCount: rows.length };
    }
    if (q.startsWith("SELECT e.evidence_id,e.kind,e.digest,e.required,")) {
      const evidence = this.evidence.get(key(parameters[0], parameters[2]));
      const native = this.nativeEvidence.get(key(parameters[0], parameters[2]));
      const receipt = native && this.receipts.get(key(parameters[0], native.native_receipt_id));
      if (!evidence || evidence.work_id !== parameters[1] || !native || !receipt) return { rows: [], rowCount: 0 };
      return { rows: [{ ...structuredClone(evidence), ...structuredClone(native),
        native_task_id: native.task_id,
        native_verifier_agent_id: native.verifier_agent_id,
        native_verifier_session_fingerprint: native.verifier_session_fingerprint,
        native_report_digest: native.report_digest,
        receipt_type: receipt.receipt_type, receipt_agent_id: receipt.agent_id,
        payload: structuredClone(receipt.payload),
        payload_digest: receipt.payload_digest }], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO tenant_work_precommit_ticket_gate") &&
        !q.startsWith("INSERT INTO tenant_work_precommit_ticket_gate_supersession") &&
        !q.startsWith("INSERT INTO tenant_work_precommit_ticket_gate_claim")) {
      const native = q.includes("'native_closure_evaluation'");
      const row = { tenant_id: parameters[0], work_id: parameters[1], task_id: parameters[2],
        plan_id: parameters[3], evaluation_id: parameters[4], evaluation_digest: parameters[5],
        workspace_digest: parameters[6], supersession_digest: parameters[7],
        reconciliation_digest: parameters[8], action_kind: "git.commit",
        gate_source: native ? "native_closure_evaluation" : "legacy_evidence_reconciliation",
        gate_kind: "ticket_acquisition", created_by_user_id: parameters[9] };
      this.gates.set(key(row.tenant_id, row.work_id), row);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO tenant_work_task")) {
      const row = { tenant_id: parameters[0], task_id: parameters[1], work_id: parameters[2],
        title: parameters[3], weight: 1, status: "planned", required: true,
        acceptance_verified: false };
      this.tasks.set(key(row.tenant_id, row.task_id), row);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO tenant_work_precommit_ticket_gate_supersession")) {
      const native = q.includes("'native_closure_evaluation'");
      const row = { tenant_id: parameters[0], work_id: parameters[1], gate_version: parameters[2],
        task_id: parameters[3], plan_id: parameters[4], evaluation_id: parameters[5],
        evaluation_digest: parameters[6], workspace_digest: parameters[7],
        supersession_digest: parameters[8], reconciliation_digest: parameters[9],
        supersedes_reconciliation_digest: parameters[10], action_kind: "git.commit",
        gate_source: native ? "native_closure_evaluation" : "legacy_evidence_reconciliation",
        gate_kind: "ticket_acquisition", created_by_user_id: parameters[11] };
      this.supersedingGates.push(row);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO tenant_work_precommit_evidence_reconciliation") &&
        !q.startsWith("INSERT INTO tenant_work_precommit_evidence_reconciliation_supersession")) {
      const row = { tenant_id: parameters[0], work_id: parameters[1], legacy_evidence_id: parameters[2],
        replacement_evidence_id: parameters[3], task_id: parameters[4], plan_id: parameters[5],
        evaluation_id: parameters[6], native_receipt_id: parameters[7], native_receipt_digest: parameters[8],
        replacement_evidence_digest: parameters[9], evaluation_digest: parameters[10],
        workspace_digest: parameters[11], supersession_digest: parameters[12],
        reconciliation_digest: parameters[13], created_by_user_id: parameters[14] };
      this.mappings.set(key(row.tenant_id, row.work_id, row.legacy_evidence_id), row);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO tenant_work_precommit_evidence_reconciliation_supersession")) {
      const row = { tenant_id: parameters[0], work_id: parameters[1], gate_version: parameters[2],
        legacy_evidence_id: parameters[3], replacement_evidence_id: parameters[4],
        task_id: parameters[5], plan_id: parameters[6], evaluation_id: parameters[7],
        native_receipt_id: parameters[8], native_receipt_digest: parameters[9],
        replacement_evidence_digest: parameters[10], evaluation_digest: parameters[11],
        workspace_digest: parameters[12], supersession_digest: parameters[13],
        reconciliation_digest: parameters[14], created_by_user_id: parameters[15] };
      this.supersedingMappings.set(
        key(row.tenant_id, row.work_id, row.gate_version, row.legacy_evidence_id), row,
      );
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("SELECT sequence_number,event_hash FROM tenant_work_event")) {
      const rows = this.events.filter((row) => row.tenant_id === parameters[0] && row.work_id === parameters[1]);
      return { rows: rows.length ? [structuredClone(rows.at(-1))] : [], rowCount: rows.length ? 1 : 0 };
    }
    if (q.startsWith("INSERT INTO tenant_work_event")) {
      this.events.push({ tenant_id: parameters[0], work_id: parameters[1], event_id: parameters[2],
        sequence_number: parameters[3], event_type: parameters[4], payload: JSON.parse(parameters[5]),
        previous_event_hash: parameters[6], event_hash: parameters[7] });
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO tenant_work_precommit_ticket_fulfillment") &&
        !q.startsWith("INSERT INTO tenant_work_precommit_ticket_fulfillment_supersession")) {
      const row = { tenant_id: parameters[0], work_id: parameters[1], task_id: parameters[2],
        ticket_id: parameters[3], ticket_digest: parameters[4], gate_projection_digest: parameters[5],
        fulfillment_digest: parameters[6] };
      this.fulfillments.set(key(row.tenant_id, row.work_id), row);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO tenant_work_precommit_ticket_fulfillment_supersession")) {
      const row = { tenant_id: parameters[0], work_id: parameters[1], gate_version: parameters[2],
        task_id: parameters[3], ticket_id: parameters[4], ticket_digest: parameters[5],
        gate_projection_digest: parameters[6], fulfillment_digest: parameters[7] };
      this.supersedingFulfillments.set(key(row.tenant_id, row.work_id, row.gate_version), row);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO tenant_work_precommit_ticket_gate_claim_fulfillment")) {
      const row = { tenant_id: parameters[0], work_id: parameters[1],
        gate_projection_digest: parameters[2], claim_id: parameters[3],
        claim_digest: parameters[4], ticket_id: parameters[5] };
      this.claimFulfillments.set(key(row.tenant_id, row.work_id, row.gate_projection_digest), row);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO tenant_work_precommit_ticket_gate_claim") &&
        !q.startsWith("INSERT INTO tenant_work_precommit_ticket_gate_claim_fulfillment") &&
        !q.startsWith("INSERT INTO tenant_work_precommit_ticket_gate_claim_reconciliation")) {
      const row = { tenant_id: parameters[0], work_id: parameters[1],
        gate_projection_digest: parameters[2], claim_id: parameters[3], continuation_ref: parameters[4],
        request_digest: parameters[5], delegation_id: parameters[6], action_digest: parameters[7],
        host_session_fingerprint: parameters[8], idempotency_key: parameters[9],
        claim_digest: parameters[10], state: "CLAIMED", ticket_id: null };
      this.claims.set(key(row.tenant_id, row.work_id, row.gate_projection_digest), row);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("INSERT INTO tenant_work_precommit_ticket_gate_claim_reconciliation")) {
      const row = { tenant_id: parameters[0], work_id: parameters[1], claim_id: parameters[2],
        reconciliation_id: parameters[3], gate_projection_digest: parameters[4], stage: parameters[5],
        ticket_id: parameters[6], error_code: parameters[7], request_digest: parameters[8],
        continuation_ref: parameters[9], idempotency_key: parameters[10], reconciliation_digest: parameters[11] };
      this.claimReconciliations.set(key(row.tenant_id, row.work_id, row.claim_id, row.stage), row);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith("UPDATE tenant_work_task SET status='completed'")) {
      const row = this.tasks.get(key(parameters[0], parameters[2]));
      if (!row || row.work_id !== parameters[1] || row.status !== "planned" ||
          row.acceptance_verified !== false || row.required !== true) return { rows: [], rowCount: 0 };
      Object.assign(row, { status: "completed", acceptance_verified: true,
        completed_at: "2026-08-29T10:00:00.000Z" });
      return { rows: [{ task_id: row.task_id }], rowCount: 1 };
    }
    throw new Error(`precommit_fake_query_unhandled:${q}`);
  }
}

function fixture() {
  const pool = new PrecommitPool();
  pool.works.set(key("tenant-a", WORK_ID), {
    tenant_id: "tenant-a", work_id: WORK_ID, legacy_work_id: WORK_ID,
    work_code: "NYRA-1", work_name: "Precommit", work_type: "software_git",
    project_id: "nyra-core", owner_user_id: "owner", created_by_user_id: "owner",
    assigned_user_ids: [], supervising_user_ids: [], agent_ids: [], visibility_scope: "private",
    status: "ACTIVE", priority: "P2", priority_score: 300, progress_bp: 0,
    acceptance_criteria: ["verified"], intent_digest: "1".repeat(64),
  });
  pool.tasks.set(key("tenant-a", TASK_ID), {
    tenant_id: "tenant-a", work_id: WORK_ID, task_id: TASK_ID,
    title: "legacy title deliberately ignored", status: "planned", required: true,
    acceptance_verified: false,
  });
  pool.evidence.set(key("tenant-a", LEGACY_EVIDENCE_ID), {
    tenant_id: "tenant-a", work_id: WORK_ID, evidence_id: LEGACY_EVIDENCE_ID,
    kind: "legacy_required", digest: "5".repeat(64), required: true,
    independently_verified: false,
  });
  pool.evidence.set(key("tenant-a", REPLACEMENT_EVIDENCE_ID), {
    tenant_id: "tenant-a", work_id: WORK_ID, evidence_id: REPLACEMENT_EVIDENCE_ID,
    kind: "native_verifier_terminal_report", digest: "6".repeat(64), required: true,
    independently_verified: true,
  });
  pool.nativeEvidence.set(key("tenant-a", REPLACEMENT_EVIDENCE_ID), {
    tenant_id: "tenant-a", work_id: WORK_ID, evidence_id: REPLACEMENT_EVIDENCE_ID,
    evidence_digest: "6".repeat(64), plan_id: PLAN_ID,
    task_id: "verifier-task", verifier_agent_id: "verifier-agent",
    verifier_session_fingerprint: "b".repeat(64), report_digest: "a".repeat(64),
    native_receipt_id: RECEIPT_ID, native_receipt_digest: RECEIPT_DIGEST,
  });
  pool.receipts.set(key("tenant-a", RECEIPT_ID), {
    tenant_id: "tenant-a", work_id: WORK_ID, plan_id: PLAN_ID,
    receipt_id: RECEIPT_ID, receipt_type: "agent_reported",
    agent_id: "verifier-agent", payload: RECEIPT_PAYLOAD, payload_digest: RECEIPT_DIGEST,
  });
  const plan = { schema_version: "native_agent_plan_v1", tasks: [] };
  pool.plans.push({ tenant_id: "tenant-a", work_id: WORK_ID, plan_id: PLAN_ID,
    plan, plan_digest: digest(plan), status: "planned", plan_version: 1, supersedes_plan_id: null });
  const evaluation = {
    schema_version: "native_closure_evaluation_v1", closed: false,
    commit_ticket_ready: true, execution_authorized: false,
    precommit_verification: { ready: true, workspace_digest: WORKSPACE_DIGEST },
  };
  pool.evaluations.push({ tenant_id: "tenant-a", work_id: WORK_ID, plan_id: PLAN_ID,
    evaluation_id: EVALUATION_ID, evaluation, evaluation_digest: digest(evaluation),
    created_at: "2026-08-29T09:00:00.000Z" });
  const store = createWorkContinuityV2Store({ pool, now: () => new Date("2026-08-29T10:00:00.000Z") });
  const input = {
    work_id: WORK_ID, task_id: TASK_ID, plan_id: PLAN_ID, evaluation_id: EVALUATION_ID,
    evaluation_digest: digest(evaluation), workspace_digest: WORKSPACE_DIGEST,
    mappings: [{ legacy_evidence_id: LEGACY_EVIDENCE_ID,
      replacement_evidence_id: REPLACEMENT_EVIDENCE_ID,
      native_receipt_id: RECEIPT_ID, native_receipt_digest: RECEIPT_DIGEST }],
    idempotency_key: "precommit-reconcile-001",
  };
  return { pool, store, input };
}

function actionTicket(projectionDigest, overrides = {}) {
  return { state: "issued", uses: 0, ticket: {
    schema_version: "host_native_action_ticket_v1", ticket_id: `hnt_${"a".repeat(64)}`,
    tenant_id: "tenant-a", work_id: WORK_ID, action: { kind: "git.commit" },
    delegation_id: "delegation-1", host_session_fingerprint: "a".repeat(64),
    evidence_digest: projectionDigest, max_uses: 1, provider_execution: false,
    host_policy_override: false, host_policy_must_allow: true,
    signature: `hnt_${"b".repeat(64)}`, ...overrides,
  } };
}
async function claimGate(store, projection, overrides = {}) {
  return store.claimPrecommitTicketGate(identity(), {
    work_id: WORK_ID, gate_projection_digest: projection.projection_digest,
    continuation_ref: "continuation-1", request_digest: "1".repeat(64),
    delegation_id: "delegation-1", action_digest: digest({ kind: "git.commit" }),
    host_session_fingerprint: "a".repeat(64), idempotency_key: "claim-1", ...overrides,
  });
}

test("reconciles exact receipt-bound evidence idempotently without mutating closure evidence", async () => {
  const { pool, store, input } = fixture();
  const first = await store.reconcilePrecommitTicketGate(identity(), input);
  assert.equal(first.schema_version, "precommit_ticket_gate_v1");
  assert.equal(first.fresh, true);
  assert.equal(first.idempotent_replay, false);
  assert.deepEqual(first.legacy_evidence_ids, [LEGACY_EVIDENCE_ID]);
  assert.deepEqual(first.replacement_evidence_ids, [REPLACEMENT_EVIDENCE_ID]);
  assert.equal(pool.evidence.get(key("tenant-a", LEGACY_EVIDENCE_ID)).independently_verified, false,
    "reconciliation must not weaken full closure evidence");
  assert.equal(pool.tasks.get(key("tenant-a", TASK_ID)).status, "planned");
  const replay = await store.reconcilePrecommitTicketGate(identity(), input);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.projection_digest, first.projection_digest);
  assert.equal(pool.gates.size, 1);
  assert.equal(pool.mappings.size, 1);
});

test("reconciliation fails closed across tenants and on receipt, evaluation or replacement substitution", async () => {
  {
    const { store, input } = fixture();
    await assert.rejects(store.reconcilePrecommitTicketGate(identity("tenant-b"), input),
      /tenant_work_not_found/);
  }
  for (const [name, mutate, expected] of [
    ["receipt", (input) => { input.mappings[0].native_receipt_digest = "9".repeat(64); },
      /precommit_reconcile_replacement_evidence_invalid/],
    ["evaluation", (input) => { input.evaluation_digest = "9".repeat(64); },
      /precommit_reconcile_evaluation_not_current/],
    ["replacement", (input) => { input.mappings[0].replacement_evidence_id =
      "99999999-9999-4999-8999-999999999999"; }, /precommit_reconcile_replacement_evidence_invalid/],
  ]) {
    const { store, input } = fixture();
    mutate(input);
    await assert.rejects(store.reconcilePrecommitTicketGate(identity(), input), expected, name);
  }
  {
    const { pool, store, input } = fixture();
    const receipt = pool.receipts.get(key("tenant-a", RECEIPT_ID));
    receipt.payload = { ...receipt.payload, host_native: false };
    receipt.payload_digest = digest(receipt.payload);
    pool.nativeEvidence.get(key("tenant-a", REPLACEMENT_EVIDENCE_ID)).native_receipt_digest =
      receipt.payload_digest;
    input.mappings[0].native_receipt_digest = receipt.payload_digest;
    await assert.rejects(store.reconcilePrecommitTicketGate(identity(), input),
      /precommit_reconcile_replacement_evidence_invalid/);
  }
  {
    const { pool, store, input } = fixture();
    pool.evidence.get(key("tenant-a", REPLACEMENT_EVIDENCE_ID)).work_id =
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await assert.rejects(store.reconcilePrecommitTicketGate(identity(), input),
      /precommit_reconcile_replacement_evidence_invalid/);
  }
  const { store, input } = fixture();
  await store.reconcilePrecommitTicketGate(identity(), input);
  await assert.rejects(store.reconcilePrecommitTicketGate(identity(), {
    ...input,
    workspace_digest: "9".repeat(64),
  }), /precommit_reconcile_replay_conflict/);
});

test("projection detects plan/evaluation drift and ticket fulfillment accepts only exact Core readback", async () => {
  const { pool, store, input } = fixture();
  const projection = await store.reconcilePrecommitTicketGate(identity(), input);
  await assert.rejects(store.fulfillPrecommitTicketTask(identity(), {
    work_id: WORK_ID,
    gate_projection_digest: projection.projection_digest,
    action_ticket: actionTicket("9".repeat(64)),
  }), /precommit_ticket_fulfillment_readback_invalid/);
  const fulfilled = await store.fulfillPrecommitTicketTask(identity(), {
    work_id: WORK_ID,
    gate_projection_digest: projection.projection_digest,
    action_ticket: actionTicket(projection.projection_digest),
  });
  assert.equal(fulfilled.idempotent_replay, false);
  assert.equal(pool.tasks.get(key("tenant-a", TASK_ID)).status, "completed");
  assert.equal(pool.tasks.get(key("tenant-a", TASK_ID)).acceptance_verified, true);
  const replay = await store.fulfillPrecommitTicketTask(identity(), {
    work_id: WORK_ID,
    gate_projection_digest: projection.projection_digest,
    action_ticket: actionTicket(projection.projection_digest),
  });
  assert.equal(replay.idempotent_replay, true);
  await assert.rejects(store.fulfillPrecommitTicketTask(identity(), {
    work_id: WORK_ID,
    gate_projection_digest: projection.projection_digest,
    action_ticket: actionTicket(projection.projection_digest, { ticket_id: `hnt_${"c".repeat(64)}` }),
  }), /precommit_ticket_fulfillment_replay_conflict/);

  const drifted = fixture();
  await drifted.store.reconcilePrecommitTicketGate(identity(), drifted.input);
  const replacementPlan = { schema_version: "native_agent_plan_v1", tasks: [{ task_id: "new" }] };
  drifted.pool.plans.push({ tenant_id: "tenant-a", work_id: WORK_ID,
    plan_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", plan: replacementPlan,
    plan_digest: digest(replacementPlan), status: "planned", plan_version: 2,
    supersedes_plan_id: PLAN_ID });
  const gate = await drifted.store.readPrecommitTicketGate(identity(), { work_id: WORK_ID });
  assert.equal(gate.fresh, false);
  assert(gate.drift_codes.includes("precommit_gate_plan_drift"));
  assert(gate.drift_codes.includes("precommit_gate_supersession_drift"));
});

test("appends a fresh superseding gate after plan drift and preserves replay and fulfillment isolation", async () => {
  const { pool, store, input } = fixture();
  const first = await store.reconcilePrecommitTicketGate(identity(), input);
  pool.plans[0].status = "superseded";
  const plan = { schema_version: "native_agent_plan_v1", tasks: [{ task_id: "replacement" }] };
  pool.plans.push({ tenant_id: "tenant-a", work_id: WORK_ID, plan_id: SUPERSEDING_PLAN_ID,
    plan, plan_digest: digest(plan), status: "planned", plan_version: 2,
    supersedes_plan_id: PLAN_ID });
  const evaluation = {
    schema_version: "native_closure_evaluation_v1", closed: false,
    commit_ticket_ready: true, execution_authorized: false,
    precommit_verification: { ready: true, workspace_digest: SUPERSEDING_WORKSPACE_DIGEST },
  };
  pool.evaluations.push({ tenant_id: "tenant-a", work_id: WORK_ID,
    plan_id: SUPERSEDING_PLAN_ID, evaluation_id: SUPERSEDING_EVALUATION_ID,
    evaluation, evaluation_digest: digest(evaluation), created_at: "2026-08-29T09:30:00.000Z" });
  const receiptPayload = {
    ...RECEIPT_PAYLOAD,
    receipt_id: SUPERSEDING_RECEIPT_ID,
    plan_id: SUPERSEDING_PLAN_ID,
    report_digest: "d".repeat(64),
  };
  const receiptDigest = digest(receiptPayload);
  pool.evidence.set(key("tenant-a", SUPERSEDING_EVIDENCE_ID), {
    tenant_id: "tenant-a", work_id: WORK_ID, evidence_id: SUPERSEDING_EVIDENCE_ID,
    kind: "native_verifier_terminal_report", digest: "e".repeat(64), required: true,
    independently_verified: true,
  });
  pool.nativeEvidence.set(key("tenant-a", SUPERSEDING_EVIDENCE_ID), {
    tenant_id: "tenant-a", work_id: WORK_ID, evidence_id: SUPERSEDING_EVIDENCE_ID,
    evidence_digest: "e".repeat(64), plan_id: SUPERSEDING_PLAN_ID,
    task_id: "verifier-task", verifier_agent_id: "verifier-agent",
    verifier_session_fingerprint: "b".repeat(64), report_digest: "d".repeat(64),
    native_receipt_id: SUPERSEDING_RECEIPT_ID, native_receipt_digest: receiptDigest,
  });
  pool.receipts.set(key("tenant-a", SUPERSEDING_RECEIPT_ID), {
    tenant_id: "tenant-a", work_id: WORK_ID, plan_id: SUPERSEDING_PLAN_ID,
    receipt_id: SUPERSEDING_RECEIPT_ID, receipt_type: "agent_reported",
    agent_id: "verifier-agent", payload: receiptPayload, payload_digest: receiptDigest,
  });
  const supersedingInput = {
    ...input,
    plan_id: SUPERSEDING_PLAN_ID,
    evaluation_id: SUPERSEDING_EVALUATION_ID,
    evaluation_digest: digest(evaluation),
    workspace_digest: SUPERSEDING_WORKSPACE_DIGEST,
    mappings: [{ legacy_evidence_id: LEGACY_EVIDENCE_ID,
      replacement_evidence_id: SUPERSEDING_EVIDENCE_ID,
      native_receipt_id: SUPERSEDING_RECEIPT_ID, native_receipt_digest: receiptDigest }],
    idempotency_key: "precommit-reconcile-superseding-002",
  };

  const second = await store.reconcilePrecommitTicketGate(identity(), supersedingInput);
  assert.equal(second.fresh, true);
  assert.equal(second.plan_id, SUPERSEDING_PLAN_ID);
  assert.notEqual(second.reconciliation_digest, first.reconciliation_digest);
  assert.equal(pool.gates.size, 1, "the v1 gate remains immutable");
  assert.equal(pool.mappings.size, 1, "the v1 evidence mapping remains immutable");
  assert.equal(pool.supersedingGates.length, 1);
  assert.equal(pool.supersedingGates[0].gate_version, 2);
  assert.equal(pool.supersedingGates[0].supersedes_reconciliation_digest,
    first.reconciliation_digest);
  assert.equal(pool.supersedingMappings.size, 1);

  const replay = await store.reconcilePrecommitTicketGate(identity(), supersedingInput);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.projection_digest, second.projection_digest);
  await assert.rejects(store.reconcilePrecommitTicketGate(identity(), input),
    /precommit_reconcile_replay_conflict/);
  await assert.rejects(store.reconcilePrecommitTicketGate(identity(), {
    ...supersedingInput, workspace_digest: "f".repeat(64),
  }), /precommit_reconcile_replay_conflict/);

  const fulfilled = await store.fulfillPrecommitTicketTask(identity(), {
    work_id: WORK_ID,
    gate_projection_digest: second.projection_digest,
    action_ticket: actionTicket(second.projection_digest),
  });
  assert.equal(fulfilled.idempotent_replay, false);
  assert.equal(pool.fulfillments.size, 0);
  assert.equal(pool.supersedingFulfillments.size, 1);
});

test("migration is additive, replay-safe and append-only", () => {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const migration = fs.readFileSync(path.join(directory,
    "../migrations/20260829_precommit_ticket_reconciliation_v1.sql"), "utf8");
  for (const table of [
    "tenant_work_precommit_ticket_gate",
    "tenant_work_precommit_evidence_reconciliation",
    "tenant_work_precommit_ticket_fulfillment",
  ]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration, /BEFORE UPDATE OR DELETE[\s\S]*append_only/);
  assert.match(migration, /20260829_precommit_ticket_reconciliation_v1'[\s\S]*ON CONFLICT DO NOTHING/);
  assert.match(migration, /CHECK \(action_kind='git\.commit'\)/);
  assert.match(migration, /CHECK \(gate_kind='ticket_acquisition'\)/);
  assert.match(migration,
    /FOREIGN KEY \(tenant_id, work_id, task_id\)[\s\S]*tenant_work_task\(tenant_id, work_id, task_id\)/);
  assert.match(migration,
    /FOREIGN KEY \(tenant_id, work_id, native_receipt_id\)[\s\S]*tenant_work_native_verifier_evidence\(tenant_id, work_id, native_receipt_id\)/);

  const supersedingMigration = fs.readFileSync(path.join(directory,
    "../migrations/20260830_precommit_ticket_gate_supersession_v1.sql"), "utf8");
  for (const table of [
    "tenant_work_precommit_ticket_gate_supersession",
    "tenant_work_precommit_evidence_reconciliation_supersession",
    "tenant_work_precommit_ticket_fulfillment_supersession",
  ]) assert.match(supersedingMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(supersedingMigration, /CHECK \(gate_version>1\)/);
  assert.match(supersedingMigration, /supersedes_reconciliation_digest char\(64\) NOT NULL/);
  assert.match(supersedingMigration, /BEFORE UPDATE OR DELETE[\s\S]*append_only/);
  assert.match(supersedingMigration,
    /20260830_precommit_ticket_gate_supersession_v1'[\s\S]*ON CONFLICT DO NOTHING/);

  const nativeMigration = fs.readFileSync(path.join(directory,
    "../migrations/20260901_native_precommit_ticket_gate_v2.sql"), "utf8");
  assert.match(nativeMigration, /gate_source varchar\(48\)/);
  assert.match(nativeMigration, /legacy_evidence_reconciliation/);
  assert.match(nativeMigration, /native_closure_evaluation/);
  assert.match(nativeMigration, /20260901_native_precommit_ticket_gate_v2/);
  const claimMigration = fs.readFileSync(path.join(directory,
    "../migrations/20260901_precommit_ticket_gate_claim_v1.sql"), "utf8");
  assert.match(claimMigration, /tenant_work_precommit_ticket_gate_claim/);
  assert.match(claimMigration, /tenant_work_precommit_ticket_gate_claim_fulfillment/);
  assert.match(claimMigration, /BEFORE UPDATE OR DELETE/);
  assert.match(claimMigration, /20260901_precommit_ticket_gate_claim_v1/);
});

test("claim CAS permits exact replay and rejects cross-bound projection or request", async () => {
  const { store, input } = fixture();
  const gate = await store.reconcilePrecommitTicketGate(identity(), input);
  const claim = await claimGate(store, gate);
  assert.equal(claim.schema_version, "precommit_ticket_gate_claim_v1");
  assert.equal(claim.replay, false);
  const replay = await claimGate(store, gate);
  assert.equal(replay.replay, true);
  assert.equal(replay.claim_id, claim.claim_id);
  await assert.rejects(claimGate(store, gate, { request_digest: "9".repeat(64) }),
    /precommit_gate_claim_replay_conflict/);
  await assert.rejects(claimGate(store, { ...gate, projection_digest: "8".repeat(64) }, {
    idempotency_key: "claim-cross-projection",
  }), /precommit_gate_claim_gate_invalid/);
  await assert.rejects(store.fulfillPrecommitTicketTask(identity(), {
    work_id: WORK_ID, gate_projection_digest: gate.projection_digest,
    gate_claim: { ...claim, claim_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    action_ticket: actionTicket(gate.projection_digest),
  }), /precommit_ticket_fulfillment_claim_unexpected/);
});

test("claim recovery is append-only, exact-replayable and cross-binding closed", async () => {
  const { store, input, pool } = fixture();
  const gate = await store.reconcilePrecommitTicketGate(identity(), input);
  const claim = await claimGate(store, gate);
  const recovery = { work_id: WORK_ID, gate_claim: claim,
    gate_projection_digest: gate.projection_digest, continuation_ref: "continuation-1",
    request_digest: "1".repeat(64), idempotency_key: "claim-1",
    stage: "before_ticket_locator", ticket_id: null, error_code: "core_authorize_unavailable" };
  const first = await store.reconcilePrecommitTicketGateClaim(identity(), recovery);
  assert.equal(first.replay, false);
  const replay = await store.reconcilePrecommitTicketGateClaim(identity(), recovery);
  assert.equal(replay.replay, true);
  assert.equal(replay.reconciliation_id, first.reconciliation_id);
  assert.equal(pool.claimReconciliations.size, 1);
  await assert.rejects(store.reconcilePrecommitTicketGateClaim(identity(), {
    ...recovery, error_code: "different_failure",
  }), /precommit_claim_reconciliation_replay_conflict/);
  await assert.rejects(store.reconcilePrecommitTicketGateClaim(identity(), {
    ...recovery, request_digest: "9".repeat(64),
  }), /precommit_claim_reconciliation_claim_invalid/);
});

test("claim recovery adopts an exact prior continuation and lets verified fulfillment supersede its locator", async () => {
  const { store, input, pool } = fixture();
  const gate = await store.reconcilePrecommitTicketGate(identity(), input);
  const claim = await claimGate(store, gate);
  const naked = await store.readPrecommitTicketGateClaimRecovery(identity(), {
    work_id: WORK_ID, gate_projection_digest: gate.projection_digest,
    request_digest: "1".repeat(64), delegation_id: "delegation-1",
    action_digest: digest({ kind: "git.commit" }), host_session_fingerprint: "a".repeat(64),
  });
  assert.equal(naked.recovery_source, "claim");
  assert.equal(naked.ticket_id, null);
  assert.equal(naked.gate_claim.continuation_ref, "continuation-1");
  assert.equal(naked.gate_claim.replay, true);
  await store.reconcilePrecommitTicketGateClaim(identity(), {
    work_id: WORK_ID, gate_claim: claim, gate_projection_digest: gate.projection_digest,
    continuation_ref: "continuation-1", request_digest: "1".repeat(64),
    idempotency_key: "claim-1", stage: "before_ticket_locator", ticket_id: null,
    error_code: "core_authorize_unavailable",
  });
  const before = await store.readPrecommitTicketGateClaimRecovery(identity(), {
    work_id: WORK_ID, gate_projection_digest: gate.projection_digest,
    request_digest: "1".repeat(64), delegation_id: "delegation-1",
    action_digest: digest({ kind: "git.commit" }), host_session_fingerprint: "a".repeat(64),
  });
  assert.equal(before.recovery_source, "before_ticket_locator");
  assert.equal(before.ticket_id, null);
  assert.equal(before.gate_claim.continuation_ref, "continuation-1");
  assert.equal(before.gate_claim.replay, true);

  const locator = `hnt_${"c".repeat(32)}`;
  await store.reconcilePrecommitTicketGateClaim(identity(), {
    work_id: WORK_ID, gate_claim: claim, gate_projection_digest: gate.projection_digest,
    continuation_ref: "continuation-1", request_digest: "1".repeat(64),
    idempotency_key: "claim-1", stage: "ticket_locator_received", ticket_id: locator,
    error_code: "nyra_continue_commit_ticket_readback_unavailable",
  });
  const adopted = await store.readPrecommitTicketGateClaimRecovery(identity(), {
    work_id: WORK_ID, gate_projection_digest: gate.projection_digest,
    request_digest: "1".repeat(64), delegation_id: "delegation-1",
    action_digest: digest({ kind: "git.commit" }), host_session_fingerprint: "a".repeat(64),
  });
  assert.equal(adopted.recovery_source, "reconciliation");
  assert.equal(adopted.ticket_id, locator);
  assert.equal(adopted.gate_claim.continuation_ref, "continuation-1");

  pool.claimFulfillments.set(key("tenant-a", WORK_ID, gate.projection_digest), {
    tenant_id: "tenant-a", work_id: WORK_ID, gate_projection_digest: gate.projection_digest,
    claim_id: claim.claim_id, claim_digest: claim.claim_digest,
    ticket_id: locator,
  });
  const fulfilled = await store.readPrecommitTicketGateClaimRecovery(identity(), {
    work_id: WORK_ID, fulfilled: true, request_digest: "1".repeat(64),
    delegation_id: "delegation-1", action_digest: digest({ kind: "git.commit" }),
    host_session_fingerprint: "a".repeat(64),
  });
  assert.equal(fulfilled.recovery_source, "fulfillment");
  assert.equal(fulfilled.ticket_id, locator);
  pool.claimFulfillments.get(key("tenant-a", WORK_ID, gate.projection_digest)).ticket_id =
    `hnt_${"d".repeat(32)}`;
  const replacement = await store.readPrecommitTicketGateClaimRecovery(identity(), {
    work_id: WORK_ID, gate_claim: claim,
  });
  assert.equal(replacement.recovery_source, "fulfillment");
  assert.equal(replacement.ticket_id, `hnt_${"d".repeat(32)}`);
  await assert.rejects(store.readPrecommitTicketGateClaimRecovery(identity(), {
    work_id: WORK_ID, gate_projection_digest: gate.projection_digest,
    request_digest: "1".repeat(64), delegation_id: "delegation-1",
    action_digest: digest({ kind: "git.commit" }), host_session_fingerprint: "f".repeat(64),
  }), /precommit_claim_recovery_host_invalid/);
});

test("materializes one server-owned native closure gate for a canonical promoted V2 bridge", async () => {
  const pool = new PrecommitPool();
  const canonicalAnchor = {
    schema_version: "intent_anchor_v1",
    initial_message: "canonical bootstrap",
    idea: "Canonical bridge",
    objective: "Bind both intent namespaces",
    acceptance_criteria: ["both digests verified"],
    constraints: [],
    source: { client_type: "codex", session_id: "canonical-session" },
    immutable: true,
  };
  const canonicalIntentDigest = digest(canonicalAnchor);
  pool.legacyIntentAnchors.set(key("tenant-a", WORK_ID), {
    anchor: canonicalAnchor,
    intent_digest: canonicalIntentDigest,
  });
  pool.works.set(key("tenant-a", WORK_ID), {
    tenant_id: "tenant-a", work_id: WORK_ID, legacy_work_id: WORK_ID,
    work_type: "software_git", intent_digest: canonicalIntentDigest,
    owner_user_id: "owner", created_by_user_id: "owner", assigned_user_ids: [],
    supervising_user_ids: [], agent_ids: [], visibility_scope: "private", status: "ACTIVE",
  });
  const createdEventMaterial = { tenant_id: "tenant-a", work_id: WORK_ID, sequence_number: 1,
    event_type: "work_v2_created",
    payload: { legacy_work_id: WORK_ID, intent_digest: canonicalIntentDigest,
      legacy_intent_digest: canonicalIntentDigest, legacy_event_hash: "2".repeat(64) },
    previous_event_hash: null };
  pool.events.push({ ...createdEventMaterial, event_hash: digest(createdEventMaterial) });
  const plan = { schema_version: "native_agent_plan_v1", tasks: [] };
  pool.plans.push({ tenant_id: "tenant-a", work_id: WORK_ID, plan_id: PLAN_ID,
    plan, plan_digest: digest(plan), status: "planned", plan_version: 1, supersedes_plan_id: null });
  const evaluation = { schema_version: "native_closure_evaluation_v1", closed: false,
    commit_ticket_ready: true, execution_authorized: false,
    precommit_verification: { ready: true, workspace_digest: WORKSPACE_DIGEST } };
  pool.evaluations.push({ tenant_id: "tenant-a", work_id: WORK_ID, plan_id: PLAN_ID,
    evaluation_id: EVALUATION_ID, evaluation, evaluation_digest: digest(evaluation),
    created_at: "2026-09-01T10:00:00.000Z" });
  const store = createWorkContinuityV2Store({ pool });
  const client = await pool.connect();
  await client.query("BEGIN");
  const input = { server_owned: true, tenant_id: "tenant-a", work_id: WORK_ID,
    plan_id: PLAN_ID, evaluation_id: EVALUATION_ID, evaluation_digest: digest(evaluation),
    workspace_digest: WORKSPACE_DIGEST };
  const first = await store.materializeNativePrecommitTicketGateWithClient(client, input);
  assert.equal(first.schema_version, "precommit_ticket_gate_v2");
  assert.equal(first.gate_source, "native_closure_evaluation");
  assert.equal(first.fresh, true);
  assert.deepEqual(first.legacy_evidence_ids, []);
  assert.deepEqual(first.replacement_evidence_ids, []);
  assert.equal(first.idempotent_replay, false);
  await assert.rejects(store.fulfillPrecommitTicketTask(identity(), {
    work_id: WORK_ID, gate_projection_digest: first.projection_digest,
    action_ticket: actionTicket(first.projection_digest),
  }), /precommit_ticket_fulfillment_claim_invalid/);
  const replay = await store.materializeNativePrecommitTicketGateWithClient(client, input);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.projection_digest, first.projection_digest);
  assert.equal(pool.tasks.size, 1);
  pool.plans[0].status = "superseded";
  const nextPlan = { schema_version: "native_agent_plan_v1", tasks: [{ task_id: "next" }] };
  pool.plans.push({ tenant_id: "tenant-a", work_id: WORK_ID, plan_id: SUPERSEDING_PLAN_ID,
    plan: nextPlan, plan_digest: digest(nextPlan), status: "planned", plan_version: 2,
    supersedes_plan_id: PLAN_ID });
  const nextEvaluation = { ...evaluation,
    precommit_verification: { ready: true, workspace_digest: SUPERSEDING_WORKSPACE_DIGEST } };
  pool.evaluations.push({ tenant_id: "tenant-a", work_id: WORK_ID, plan_id: SUPERSEDING_PLAN_ID,
    evaluation_id: SUPERSEDING_EVALUATION_ID, evaluation: nextEvaluation,
    evaluation_digest: digest(nextEvaluation), created_at: "2026-09-01T11:00:00.000Z" });
  const superseding = await store.materializeNativePrecommitTicketGateWithClient(client, {
    ...input, plan_id: SUPERSEDING_PLAN_ID, evaluation_id: SUPERSEDING_EVALUATION_ID,
    evaluation_digest: digest(nextEvaluation), workspace_digest: SUPERSEDING_WORKSPACE_DIGEST,
  });
  assert.equal(superseding.schema_version, "precommit_ticket_gate_v2");
  assert.equal(superseding.fresh, true);
  assert.equal(superseding.plan_id, SUPERSEDING_PLAN_ID);
  assert.equal(pool.supersedingGates.length, 1);
  assert.equal(pool.tasks.size, 1, "native supersession reuses the immutable ticket-acquisition task");
  await client.query("COMMIT");

  const storedCreatedEvent = pool.events[0];
  storedCreatedEvent.payload.legacy_intent_digest = "f".repeat(64);
  storedCreatedEvent.event_hash = digest({
    tenant_id: storedCreatedEvent.tenant_id,
    work_id: storedCreatedEvent.work_id,
    sequence_number: storedCreatedEvent.sequence_number,
    event_type: storedCreatedEvent.event_type,
    payload: storedCreatedEvent.payload,
    previous_event_hash: storedCreatedEvent.previous_event_hash,
  });
  await assert.rejects(
    store.materializeNativePrecommitTicketGateWithClient(client, input),
    /native_precommit_gate_work_invalid/,
  );
});

test("materializes a native gate for the historical divergent-intent event only with its immutable anchor", async () => {
  const pool = new PrecommitPool();
  const legacyAnchor = {
    schema_version: "intent_anchor_v1",
    initial_message: "legacy bootstrap",
    idea: "Historical bridge",
    objective: "Retain the old event without weakening the V2 identity",
    acceptance_criteria: ["anchor verified"],
    constraints: [],
    source: { client_type: "codex", session_id: "legacy-session" },
    immutable: true,
  };
  const legacyIntentDigest = digest(legacyAnchor);
  pool.legacyIntentAnchors.set(key("tenant-a", WORK_ID), {
    anchor: legacyAnchor,
    intent_digest: legacyIntentDigest,
  });
  pool.works.set(key("tenant-a", WORK_ID), {
    tenant_id: "tenant-a", work_id: WORK_ID, legacy_work_id: WORK_ID,
    work_type: "software_git", intent_digest: "1".repeat(64),
    owner_user_id: "owner", created_by_user_id: "owner", assigned_user_ids: [],
    supervising_user_ids: [], agent_ids: [], visibility_scope: "private", status: "ACTIVE",
  });
  const createdEventMaterial = {
    tenant_id: "tenant-a", work_id: WORK_ID, sequence_number: 1,
    event_type: "work_v2_created",
    payload: { legacy_work_id: WORK_ID, intent_digest: legacyIntentDigest,
      legacy_event_hash: "2".repeat(64) },
    previous_event_hash: null,
  };
  pool.events.push({ ...createdEventMaterial, event_hash: digest(createdEventMaterial) });
  const plan = { schema_version: "native_agent_plan_v1", tasks: [] };
  pool.plans.push({ tenant_id: "tenant-a", work_id: WORK_ID, plan_id: PLAN_ID,
    plan, plan_digest: digest(plan), status: "planned", plan_version: 1,
    supersedes_plan_id: null });
  const evaluation = {
    schema_version: "native_closure_evaluation_v1", closed: false,
    commit_ticket_ready: true, execution_authorized: false,
    precommit_verification: { ready: true, workspace_digest: WORKSPACE_DIGEST },
  };
  pool.evaluations.push({ tenant_id: "tenant-a", work_id: WORK_ID, plan_id: PLAN_ID,
    evaluation_id: EVALUATION_ID, evaluation, evaluation_digest: digest(evaluation),
    created_at: "2026-09-01T10:00:00.000Z" });
  const store = createWorkContinuityV2Store({ pool });
  const client = await pool.connect();
  const gate = await store.materializeNativePrecommitTicketGateWithClient(client, {
    server_owned: true,
    tenant_id: "tenant-a",
    work_id: WORK_ID,
    plan_id: PLAN_ID,
    evaluation_id: EVALUATION_ID,
    evaluation_digest: digest(evaluation),
    workspace_digest: WORKSPACE_DIGEST,
  });

  assert.equal(gate.schema_version, "precommit_ticket_gate_v2");
  assert.equal(gate.gate_source, "native_closure_evaluation");

  pool.legacyIntentAnchors.get(key("tenant-a", WORK_ID)).anchor.immutable = false;
  await assert.rejects(
    store.materializeNativePrecommitTicketGateWithClient(client, {
      server_owned: true,
      tenant_id: "tenant-a",
      work_id: WORK_ID,
      plan_id: PLAN_ID,
      evaluation_id: EVALUATION_ID,
      evaluation_digest: digest(evaluation),
      workspace_digest: WORKSPACE_DIGEST,
    }),
    /native_precommit_gate_work_invalid/,
  );
});

test("native gate writer rejects caller authority and noncanonical legacy projections", async () => {
  const { pool, store } = fixture();
  const client = await pool.connect();
  const base = { server_owned: true, tenant_id: "tenant-a", work_id: WORK_ID,
    plan_id: PLAN_ID, evaluation_id: EVALUATION_ID,
    evaluation_digest: pool.evaluations[0].evaluation_digest, workspace_digest: WORKSPACE_DIGEST };
  await assert.rejects(store.materializeNativePrecommitTicketGateWithClient(client,
    { ...base, server_owned: false }), /native_precommit_gate_server_owned_required/);
  await assert.rejects(store.materializeNativePrecommitTicketGateWithClient(client, base),
    /native_precommit_gate_work_invalid/);
  pool.works.get(key("tenant-a", WORK_ID)).legacy_work_id = null;
  const unlinkedEventMaterial = { tenant_id: "tenant-a", work_id: WORK_ID, sequence_number: 1,
    event_type: "work_v2_created", payload: { legacy_work_id: WORK_ID,
      intent_digest: "1".repeat(64) }, previous_event_hash: null };
  pool.events.push({ ...unlinkedEventMaterial, event_hash: digest(unlinkedEventMaterial) });
  await assert.rejects(store.materializeNativePrecommitTicketGateWithClient(client, base),
    /native_precommit_gate_work_invalid/);
  pool.works.get(key("tenant-a", WORK_ID)).legacy_work_id = WORK_ID;
  pool.works.get(key("tenant-a", WORK_ID)).work_type = "legacy";
  await assert.rejects(store.materializeNativePrecommitTicketGateWithClient(client, base),
    /native_precommit_gate_work_invalid/);
});
