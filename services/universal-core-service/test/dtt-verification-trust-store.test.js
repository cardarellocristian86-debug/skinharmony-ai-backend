import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createFileDttVerificationTrustStore,
  createPostgresDttVerificationTrustStore,
} from "../src/dttVerificationTrustStore.js";

const WORK_A = "11111111-1111-4111-8111-111111111111";
const WORK_B = "22222222-2222-4222-8222-222222222222";

function assignment(work_id) {
  return {
    tenant_id: "tenant-a",
    work_id,
    tree_id: "dtt_0123456789abcdef01234567",
    node_id: "verify",
    verifier_id: "verifier-a",
    session_id: "session-id-a",
    session_fingerprint: "session-a",
    host_transport_session_fingerprint: "transport-session-a",
    presence_signature: "ags_verifier_a",
    client_type: "codex",
    opaque_agent_id: "ai_verifier_a",
    actor_provenance: "ap_actor_a",
  };
}

function artifact(work_id) {
  return {
    tenant_id: "tenant-a",
    work_id,
    artifact_id: "artifact-a",
    content: "immutable reviewed evidence",
    source_reference: "urn:source:a",
    registry_reference: "urn:registry:a",
  };
}

test("DTT file trust V2 scopes assignments and artifacts by Work and preserves legacy V1 bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dtt-trust-work-"));
  const legacyFile = path.join(root, "trust.json");
  const legacy = {
    assignments: {
      dtta_legacy: { assignment_id: "dtta_legacy", tenant_id: "tenant-a", tree_id: "legacy-tree" },
    },
    artifacts: {
      dtar_legacy: { registry_id: "dtar_legacy", tenant_id: "tenant-a", artifact_id: "legacy-artifact" },
    },
  };
  fs.writeFileSync(legacyFile, JSON.stringify(legacy), { mode: 0o600 });
  const legacyHash = crypto.createHash("sha256").update(fs.readFileSync(legacyFile)).digest("hex");
  const store = createFileDttVerificationTrustStore({ root });

  const assignmentA = store.assignVerifier(assignment(WORK_A));
  const assignmentASecondNode = store.assignVerifier({ ...assignment(WORK_A), node_id: "verify-second" });
  const assignmentB = store.assignVerifier(assignment(WORK_B));
  assert.notEqual(assignmentA.assignment_id, assignmentB.assignment_id);
  assert.equal(assignmentA.work_id, WORK_A);
  assert.equal(assignmentB.work_id, WORK_B);
  assert.equal(assignmentA.execution_authorized, false);
  assert.throws(() => store.assignVerifier({
    ...assignment(WORK_A),
    session_fingerprint: "session-other",
    opaque_agent_id: "ai_verifier_other",
    actor_provenance: "ap_actor_other",
  }), /dtt_verifier_slot_already_assigned/);
  assert.deepEqual(store.listAssignments({
    tenant_id: "tenant-a", work_id: WORK_A, tree_id: assignmentA.tree_id, node_id: assignmentA.node_id,
  }).map((record) => record.assignment_id), [assignmentA.assignment_id]);
  assert.deepEqual(
    store.listAssignmentsForTree({ tenant_id: "tenant-a", work_id: WORK_A, tree_id: assignmentA.tree_id })
      .map((record) => record.node_id).sort(),
    [assignmentA.node_id, assignmentASecondNode.node_id],
  );
  assert.deepEqual(store.listAssignments({
    tenant_id: "tenant-a", work_id: WORK_B, tree_id: assignmentB.tree_id, node_id: assignmentB.node_id,
  }).map((record) => record.assignment_id), [assignmentB.assignment_id]);
  const verifiedAssignmentA = store.verifyAssignment({ ...assignment(WORK_A), assignment_id: assignmentA.assignment_id });
  assert.equal(verifiedAssignmentA.verified, true);
  assert.equal(verifiedAssignmentA.tenant_id, "tenant-a");
  assert.equal(verifiedAssignmentA.work_id, WORK_A);
  assert.equal(verifiedAssignmentA.tree_id, assignmentA.tree_id);
  assert.equal(verifiedAssignmentA.node_id, assignmentA.node_id);
  assert.equal(verifiedAssignmentA.verifier_id, assignmentA.verifier_id);
  assert.equal(verifiedAssignmentA.session_id, assignmentA.session_id);
  assert.equal(verifiedAssignmentA.host_transport_session_fingerprint, assignmentA.host_transport_session_fingerprint);
  assert.equal(verifiedAssignmentA.presence_signature, assignmentA.presence_signature);
  assert.equal(verifiedAssignmentA.execution_authorized, false);
  assert.deepEqual(
    store.verifyAssignment({ ...assignment(WORK_B), assignment_id: assignmentA.assignment_id }),
    { verified: false, execution_authorized: false },
  );
  assert.deepEqual(
    store.verifyAssignment({ ...assignment(WORK_A), assignment_id: "dtta_legacy" }),
    { verified: false, execution_authorized: false },
  );

  const artifactA = store.registerArtifact(artifact(WORK_A));
  assert.deepEqual(
    store.verifyArtifact({ ...artifactA, work_id: WORK_B }),
    { verified: false, execution_authorized: false },
  );
  const artifactB = store.registerArtifact(artifact(WORK_B));
  assert.notEqual(artifactA.registry_id, artifactB.registry_id);
  assert.equal(artifactA.work_id, WORK_A);
  assert.equal(artifactB.work_id, WORK_B);
  const verifiedArtifactA = store.verifyArtifact(artifactA);
  assert.equal(verifiedArtifactA.verified, true);
  assert.equal(verifiedArtifactA.tenant_id, "tenant-a");
  assert.equal(verifiedArtifactA.work_id, WORK_A);
  assert.equal(verifiedArtifactA.artifact_id, artifactA.artifact_id);
  assert.equal(verifiedArtifactA.execution_authorized, false);
  assert.throws(() => store.listAssignments({
    tenant_id: "tenant-a", work_id: "not-a-uuid", tree_id: assignmentA.tree_id, node_id: assignmentA.node_id,
  }), /work_id_invalid/);

  const restarted = createFileDttVerificationTrustStore({ root });
  assert.equal(restarted.verifyAssignment({ ...assignment(WORK_A), assignment_id: assignmentA.assignment_id }).verified, true);
  assert.equal(restarted.verifyArtifact(artifactA).verified, true);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(legacyFile)).digest("hex"), legacyHash);
  fs.writeFileSync(path.join(root, "trust-v2.json"), "{malformed", { encoding: "utf8" });
  assert.throws(() => restarted.listAssignments({
    tenant_id: "tenant-a", work_id: WORK_A, tree_id: assignmentA.tree_id, node_id: assignmentA.node_id,
  }), /dtt_verification_trust_store_corrupt/);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(legacyFile)).digest("hex"), legacyHash);
});

class FakeTrustPostgresPool {
  constructor() {
    this.assignments = new Map();
    this.artifacts = new Map();
    this.calls = [];
  }

  async query(sql, params = []) {
    this.calls.push({ sql, params: [...params] });
    if (/CREATE TABLE IF NOT EXISTS dtt_verifier_assignments_v2/.test(sql)) return { rowCount: 0, rows: [] };
    if (/INSERT INTO dtt_verifier_assignments_v2/.test(sql)) {
      const [assignment_id, tenant_id, work_id, tree_id, node_id, verifier_id,
        session_id, session_fingerprint, host_transport_session_fingerprint,
        presence_signature, client_type, opaque_agent_id, actor_provenance] = params;
      const occupied = [...this.assignments.values()].find((record) => (
        record.tenant_id === tenant_id && record.work_id === work_id
        && record.tree_id === tree_id && record.node_id === node_id
        && (record.verifier_id === verifier_id || record.actor_provenance === actor_provenance)
      ));
      if (occupied) return { rowCount: 0, rows: [] };
      const record = {
        assignment_id, tenant_id, work_id, tree_id, node_id, verifier_id,
        session_id, session_fingerprint, host_transport_session_fingerprint,
        presence_signature, client_type, opaque_agent_id, actor_provenance,
        execution_authorized: false,
      };
      this.assignments.set(assignment_id, record);
      return { rowCount: 1, rows: [structuredClone(record)] };
    }
    if (/AND \(verifier_id=\$5 OR actor_provenance=\$6\)/.test(sql)) {
      const [tenant_id, work_id, tree_id, node_id, verifier_id, actor_provenance] = params;
      const rows = [...this.assignments.values()].filter((record) => (
        record.tenant_id === tenant_id && record.work_id === work_id
        && record.tree_id === tree_id && record.node_id === node_id
        && (record.verifier_id === verifier_id || record.actor_provenance === actor_provenance)
      ));
      return { rowCount: rows.length, rows: structuredClone(rows) };
    }
    if (/WHERE assignment_id=\$1 AND tenant_id=\$2 AND work_id=\$3::uuid/.test(sql)) {
      const record = this.assignments.get(params[0]);
      const match = record?.tenant_id === params[1] && record?.work_id === params[2] ? record : null;
      return { rowCount: match ? 1 : 0, rows: match ? [structuredClone(match)] : [] };
    }
    if (/WHERE tenant_id=\$1 AND work_id=\$2::uuid AND tree_id=\$3 AND node_id=\$4/.test(sql)) {
      const rows = [...this.assignments.values()].filter((record) => (
        record.tenant_id === params[0] && record.work_id === params[1]
        && record.tree_id === params[2] && record.node_id === params[3]
      ));
      return { rowCount: rows.length, rows: structuredClone(rows) };
    }
    if (/WHERE tenant_id=\$1 AND work_id=\$2::uuid AND tree_id=\$3/.test(sql)) {
      const rows = [...this.assignments.values()].filter((record) => (
        record.tenant_id === params[0] && record.work_id === params[1] && record.tree_id === params[2]
      ));
      return { rowCount: rows.length, rows: structuredClone(rows) };
    }
    if (/INSERT INTO dtt_evidence_artifacts_v2/.test(sql)) {
      const [registry_id, tenant_id, work_id, artifact_id, content_digest,
        source_reference, registry_reference] = params;
      const unique = `${tenant_id}\u0000${work_id}\u0000${artifact_id}\u0000${content_digest}\u0000${source_reference}`;
      let record = this.artifacts.get(unique);
      if (!record) {
        record = {
          registry_id, tenant_id, work_id, artifact_id, content_digest,
          source_reference, registry_reference, execution_authorized: false,
        };
        this.artifacts.set(unique, record);
      }
      return { rowCount: 1, rows: [structuredClone(record)] };
    }
    if (/SELECT registry_id,tenant_id,work_id,artifact_id,content_digest,source_reference,registry_reference/.test(sql)
        && /FROM dtt_evidence_artifacts_v2/.test(sql)) {
      const [tenant_id, work_id, artifact_id, content_digest, source_reference, registry_reference] = params;
      const rows = [...this.artifacts.values()].filter((record) => (
        record.tenant_id === tenant_id && record.work_id === work_id
        && record.artifact_id === artifact_id && record.content_digest === content_digest
        && record.source_reference === source_reference
        && (registry_reference === null || record.registry_reference === registry_reference)
      )).map((record) => structuredClone(record));
      return { rowCount: rows.length, rows };
    }
    throw new Error(`unexpected_query:${String(sql).slice(0, 120)}`);
  }
}

test("DTT PostgreSQL trust V2 uses Work-scoped versioned tables and queries", async () => {
  const pool = new FakeTrustPostgresPool();
  const store = createPostgresDttVerificationTrustStore({ pool });
  const assignmentA = await store.assignVerifier(assignment(WORK_A));
  const assignmentB = await store.assignVerifier(assignment(WORK_B));
  assert.notEqual(assignmentA.assignment_id, assignmentB.assignment_id);
  await assert.rejects(store.assignVerifier({
    ...assignment(WORK_A),
    session_fingerprint: "session-other",
    opaque_agent_id: "ai_verifier_other",
    actor_provenance: "ap_actor_other",
  }), /dtt_verifier_slot_already_assigned/);
  const verifiedAssignmentA = await store.verifyAssignment({
    ...assignment(WORK_A), assignment_id: assignmentA.assignment_id,
  });
  assert.equal(verifiedAssignmentA.verified, true);
  assert.equal(verifiedAssignmentA.tenant_id, "tenant-a");
  assert.equal(verifiedAssignmentA.work_id, WORK_A);
  assert.equal(verifiedAssignmentA.tree_id, assignmentA.tree_id);
  assert.equal(verifiedAssignmentA.node_id, assignmentA.node_id);
  assert.equal(verifiedAssignmentA.session_id, assignmentA.session_id);
  assert.equal(verifiedAssignmentA.host_transport_session_fingerprint, assignmentA.host_transport_session_fingerprint);
  assert.equal(verifiedAssignmentA.presence_signature, assignmentA.presence_signature);
  assert.equal(verifiedAssignmentA.execution_authorized, false);
  assert.deepEqual(
    await store.verifyAssignment({ ...assignment(WORK_B), assignment_id: assignmentA.assignment_id }),
    { verified: false, execution_authorized: false },
  );
  assert.deepEqual((await store.listAssignments({
    tenant_id: "tenant-a", work_id: WORK_A, tree_id: assignmentA.tree_id, node_id: assignmentA.node_id,
  })).map((record) => record.assignment_id), [assignmentA.assignment_id]);
  assert.deepEqual((await store.listAssignmentsForTree({
    tenant_id: "tenant-a", work_id: WORK_A, tree_id: assignmentA.tree_id,
  })).map((record) => record.assignment_id), [assignmentA.assignment_id]);

  const artifactA = await store.registerArtifact(artifact(WORK_A));
  assert.deepEqual(
    await store.verifyArtifact({ ...artifactA, work_id: WORK_B }),
    { verified: false, execution_authorized: false },
  );
  const artifactB = await store.registerArtifact(artifact(WORK_B));
  assert.notEqual(artifactA.registry_id, artifactB.registry_id);
  const verifiedArtifactA = await store.verifyArtifact(artifactA);
  assert.equal(verifiedArtifactA.verified, true);
  assert.equal(verifiedArtifactA.tenant_id, "tenant-a");
  assert.equal(verifiedArtifactA.work_id, WORK_A);
  assert.equal(verifiedArtifactA.artifact_id, artifactA.artifact_id);
  assert.equal(verifiedArtifactA.execution_authorized, false);
  const initialization = pool.calls.find(({ sql }) => /CREATE TABLE IF NOT EXISTS dtt_verifier_assignments_v2/.test(sql));
  assert(initialization);
  assert.match(initialization.sql, /work_id uuid NOT NULL/);
  assert.match(initialization.sql, /dtt_evidence_artifacts_v2/);
  assert(pool.calls.some(({ sql }) => /assignment_id=\$1 AND tenant_id=\$2 AND work_id=\$3::uuid/.test(sql)));
  assert(pool.calls.some(({ sql }) => /tenant_id=\$1 AND work_id=\$2::uuid AND artifact_id=\$3/.test(sql)));
});

test("DTT PostgreSQL trust initialization retries a transient migration failure and coalesces callers", async () => {
  let attempts = 0;
  let releases = 0;
  const migrationQueries = [];
  const pool = {
    async query() { return { rows: [], rowCount: 0 }; },
    async connect() {
      attempts += 1;
      return {
        async query(query) {
          if (query && typeof query === "object" && /CREATE TABLE IF NOT EXISTS dtt_verifier_assignments_v2/.test(query.text)) {
            migrationQueries.push(query);
            if (attempts === 1) throw new Error("transient_lock_timeout");
          }
          return { rows: [], rowCount: 0 };
        },
        release() { releases += 1; },
      };
    },
  };
  const store = createPostgresDttVerificationTrustStore({ pool });
  await assert.rejects(Promise.all([store.initialize(), store.initialize()]), /transient_lock_timeout/);
  await Promise.all([store.initialize(), store.initialize()]);
  assert.equal(attempts, 2);
  assert.equal(releases, 2);
  assert.equal(migrationQueries.length, 2);
  assert(migrationQueries.every((query) => query.query_timeout === 30_000));
});
