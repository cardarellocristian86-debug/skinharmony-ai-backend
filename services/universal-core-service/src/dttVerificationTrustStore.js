import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function value(input, field, max = 1_000) {
  const result = String(input || "").trim();
  if (!result || result.length > max) throw new Error(`${field}_invalid`);
  return result;
}

function workId(input) {
  if (typeof input !== "string") throw new Error("work_id_invalid");
  const normalized = input.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error("work_id_invalid");
  }
  return normalized;
}

function canonical(input) {
  return JSON.stringify(Object.keys(input).sort().reduce((result, key) => {
    result[key] = input[key];
    return result;
  }, {}));
}

function id(prefix, input) {
  return `${prefix}_${crypto.createHash("sha256").update(canonical(input)).digest("hex").slice(0, 32)}`;
}

export function createFileDttVerificationTrustStore({ root } = {}) {
  const directory = path.resolve(value(root, "dtt_verification_trust_root", 2_000));
  fs.mkdirSync(directory, { recursive: true });
  // trust.json is the immutable legacy V1 file. V2 uses a separate file so
  // adding Work isolation never rewrites or auto-binds historical records.
  const file = path.join(directory, "trust-v2.json");
  const lock = `${file}.lock`;
  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (
        parsed?.schema_version !== "dtt_verification_trust_store_v2"
        || !parsed.assignments
        || typeof parsed.assignments !== "object"
        || Array.isArray(parsed.assignments)
        || !parsed.artifacts
        || typeof parsed.artifacts !== "object"
        || Array.isArray(parsed.artifacts)
      ) {
        throw new Error("dtt_verification_trust_store_corrupt");
      }
      for (const [assignmentId, record] of Object.entries(parsed.assignments)) {
        if (
          record?.assignment_id !== assignmentId
          || record.work_id !== workId(record.work_id)
          || record.execution_authorized !== false
        ) throw new Error("dtt_verification_trust_store_corrupt");
        for (const [field, max] of [
          ["tenant_id", 120], ["tree_id", 160], ["node_id", 120], ["verifier_id", 160],
          ["session_fingerprint", 160], ["opaque_agent_id", 160], ["actor_provenance", 160],
        ]) value(record[field], field, max);
      }
      for (const [registryId, record] of Object.entries(parsed.artifacts)) {
        if (
          record?.registry_id !== registryId
          || record.work_id !== workId(record.work_id)
          || record.execution_authorized !== false
          || !/^sha256:[a-f0-9]{64}$/.test(String(record.content_digest || ""))
        ) throw new Error("dtt_verification_trust_store_corrupt");
        for (const [field, max] of [
          ["tenant_id", 120], ["artifact_id", 160], ["source_reference", 1_000], ["registry_reference", 1_000],
        ]) value(record[field], field, max);
      }
      return parsed;
    } catch (error) {
      if (error.code === "ENOENT") {
        return { schema_version: "dtt_verification_trust_store_v2", assignments: {}, artifacts: {} };
      }
      throw new Error("dtt_verification_trust_store_corrupt");
    }
  }
  function update(operation) {
    let descriptor;
    try { descriptor = fs.openSync(lock, "wx", 0o600); }
    catch (error) {
      if (error.code === "EEXIST") throw new Error("dtt_verification_trust_store_busy");
      throw error;
    }
    try {
      const state = read();
      const result = operation(state);
      const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, file);
      return result;
    } finally {
      fs.closeSync(descriptor);
      fs.unlinkSync(lock);
    }
  }
  return {
    kind: "file_cas_v2",
    distributed: false,
    assignVerifier({
      tenant_id,
      work_id,
      tree_id,
      node_id,
      verifier_id,
      session_id,
      session_fingerprint,
      host_transport_session_fingerprint,
      presence_signature,
      client_type,
      opaque_agent_id,
      actor_provenance,
    }) {
      const stable = {
        tenant_id: value(tenant_id, "tenant_id", 120),
        work_id: workId(work_id),
        tree_id: value(tree_id, "tree_id", 160),
        node_id: value(node_id, "node_id", 120),
        verifier_id: value(verifier_id, "verifier_id", 160),
        session_id: value(session_id, "session_id", 160),
        session_fingerprint: value(session_fingerprint, "session_fingerprint", 160),
        host_transport_session_fingerprint: value(
          host_transport_session_fingerprint,
          "host_transport_session_fingerprint",
          160,
        ),
        presence_signature: value(presence_signature, "presence_signature", 200),
        client_type: value(client_type, "client_type", 64),
        opaque_agent_id: value(opaque_agent_id, "opaque_agent_id", 160),
        actor_provenance: value(actor_provenance, "actor_provenance", 160),
        execution_authorized: false,
      };
      const assignment_id = id("dtta", stable);
      return update((state) => {
        const sameActor = Object.values(state.assignments).find((record) => (
          record.tenant_id === stable.tenant_id
          && record.work_id === stable.work_id
          && record.tree_id === stable.tree_id
          && record.node_id === stable.node_id
          && record.actor_provenance === stable.actor_provenance
        ));
        if (sameActor && canonical(sameActor) !== canonical({ assignment_id, ...stable })) {
          throw new Error("dtt_verifier_actor_already_assigned");
        }
        const sameVerifier = Object.values(state.assignments).find((record) => (
          record.tenant_id === stable.tenant_id
          && record.work_id === stable.work_id
          && record.tree_id === stable.tree_id
          && record.node_id === stable.node_id
          && record.verifier_id === stable.verifier_id
        ));
        if (sameVerifier && canonical(sameVerifier) !== canonical({ assignment_id, ...stable })) {
          throw new Error("dtt_verifier_slot_already_assigned");
        }
        const existing = state.assignments[assignment_id];
        if (existing && canonical(existing) !== canonical({ assignment_id, ...stable })) {
          throw new Error("dtt_verifier_assignment_conflict");
        }
        state.assignments[assignment_id] = { assignment_id, ...stable };
        return structuredClone(state.assignments[assignment_id]);
      });
    },
    verifyAssignment(input) {
      const expectedWorkId = workId(input.work_id);
      const record = read().assignments[value(input.assignment_id, "assignment_id", 160)];
      if (!record) return { verified: false, execution_authorized: false };
      const fields = [
        "tenant_id", "tree_id", "node_id", "verifier_id", "session_id", "session_fingerprint",
        "host_transport_session_fingerprint", "presence_signature", "client_type", "opaque_agent_id",
        "actor_provenance",
      ];
      if (record.work_id !== expectedWorkId || !fields.every((field) => record[field] === input[field])) {
        return { verified: false, execution_authorized: false };
      }
      return {
        verified: true,
        assignment_id: record.assignment_id,
        tenant_id: record.tenant_id,
        work_id: record.work_id,
        tree_id: record.tree_id,
        node_id: record.node_id,
        verifier_id: record.verifier_id,
        session_id: record.session_id,
        session_fingerprint: record.session_fingerprint,
        host_transport_session_fingerprint: record.host_transport_session_fingerprint,
        presence_signature: record.presence_signature,
        client_type: record.client_type,
        opaque_agent_id: record.opaque_agent_id,
        actor_provenance: record.actor_provenance,
        independence_key: record.actor_provenance,
        execution_authorized: false,
      };
    },
    listAssignments({ tenant_id, work_id, tree_id, node_id }) {
      const expectedWorkId = workId(work_id);
      return Object.values(read().assignments).filter((record) => (
        record.tenant_id === tenant_id
        && record.work_id === expectedWorkId
        && record.tree_id === tree_id
        && record.node_id === node_id
      )).map((record) => structuredClone(record));
    },
    listAssignmentsForTree({ tenant_id, work_id, tree_id }) {
      const expectedWorkId = workId(work_id);
      return Object.values(read().assignments).filter((record) => (
        record.tenant_id === tenant_id
        && record.work_id === expectedWorkId
        && record.tree_id === tree_id
      )).map((record) => structuredClone(record));
    },
    registerArtifact({ tenant_id, work_id, artifact_id, content, source_reference, registry_reference }) {
      const boundedContent = value(content, "artifact_content", 200_000);
      const record = {
        tenant_id: value(tenant_id, "tenant_id", 120),
        work_id: workId(work_id),
        artifact_id: value(artifact_id, "artifact_id", 160),
        content_digest: `sha256:${crypto.createHash("sha256").update(boundedContent).digest("hex")}`,
        source_reference: value(source_reference, "source_reference", 1_000),
        registry_reference: value(registry_reference, "registry_reference", 1_000),
        execution_authorized: false,
      };
      const key = id("dtar", record);
      return update((state) => {
        state.artifacts[key] = { registry_id: key, ...record };
        return structuredClone(state.artifacts[key]);
      });
    },
    verifyArtifact({ tenant_id, work_id, artifact_id, content_digest, source_reference, registry_reference }) {
      const expectedWorkId = workId(work_id);
      const matches = Object.values(read().artifacts).filter((record) => (
        record.tenant_id === tenant_id
        && record.work_id === expectedWorkId
        && record.artifact_id === artifact_id
        && record.content_digest === content_digest
        && record.source_reference === source_reference
        && (!registry_reference || record.registry_reference === registry_reference)
      ));
      return matches.length === 1
        ? {
          verified: true,
          tenant_id: matches[0].tenant_id,
          work_id: matches[0].work_id,
          artifact_id: matches[0].artifact_id,
          content_digest: matches[0].content_digest,
          source_reference: matches[0].source_reference,
          registry_reference: matches[0].registry_reference,
          registry_id: matches[0].registry_id,
          execution_authorized: false,
        }
        : { verified: false, execution_authorized: false };
    },
  };
}

export function createPostgresDttVerificationTrustStore({ pool } = {}) {
  if (!pool?.query) throw new Error("dtt_verification_trust_postgres_pool_required");
  let initialized;
  async function initialize() {
    if (!initialized) initialized = pool.query(`
      CREATE TABLE IF NOT EXISTS dtt_verifier_assignments_v2 (
        assignment_id varchar(80) PRIMARY KEY, tenant_id varchar(120) NOT NULL, work_id uuid NOT NULL,
        tree_id varchar(160) NOT NULL, node_id varchar(120) NOT NULL,
        verifier_id varchar(160) NOT NULL, session_id varchar(160) NOT NULL,
        session_fingerprint varchar(160) NOT NULL,
        host_transport_session_fingerprint varchar(160) NOT NULL,
        presence_signature varchar(200) NOT NULL, client_type varchar(64) NOT NULL,
        opaque_agent_id varchar(160) NOT NULL, actor_provenance varchar(160) NOT NULL,
        execution_authorized boolean NOT NULL DEFAULT false CHECK (execution_authorized=false),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id,work_id,tree_id,node_id,verifier_id),
        UNIQUE (tenant_id,work_id,tree_id,node_id,actor_provenance)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS dtt_verifier_assignments_v2_actor_per_node
        ON dtt_verifier_assignments_v2 (tenant_id,work_id,tree_id,node_id,actor_provenance);
      CREATE TABLE IF NOT EXISTS dtt_evidence_artifacts_v2 (
        registry_id varchar(80) PRIMARY KEY, tenant_id varchar(120) NOT NULL, work_id uuid NOT NULL,
        artifact_id varchar(160) NOT NULL, content_digest varchar(256) NOT NULL,
        source_reference text NOT NULL, registry_reference text NOT NULL,
        execution_authorized boolean NOT NULL DEFAULT false CHECK (execution_authorized=false),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id,work_id,artifact_id,content_digest,source_reference)
      );
    `);
    return initialized;
  }
  return {
    kind: "postgresql_v2",
    distributed: true,
    async assignVerifier(input) {
      await initialize();
      const stable = {
        tenant_id: value(input.tenant_id, "tenant_id", 120),
        work_id: workId(input.work_id),
        tree_id: value(input.tree_id, "tree_id", 160),
        node_id: value(input.node_id, "node_id", 120),
        verifier_id: value(input.verifier_id, "verifier_id", 160),
        session_id: value(input.session_id, "session_id", 160),
        session_fingerprint: value(input.session_fingerprint, "session_fingerprint", 160),
        host_transport_session_fingerprint: value(
          input.host_transport_session_fingerprint,
          "host_transport_session_fingerprint",
          160,
        ),
        presence_signature: value(input.presence_signature, "presence_signature", 200),
        client_type: value(input.client_type, "client_type", 64),
        opaque_agent_id: value(input.opaque_agent_id, "opaque_agent_id", 160),
        actor_provenance: value(input.actor_provenance, "actor_provenance", 160),
        execution_authorized: false,
      };
      const assignment_id = id("dtta", stable);
      const result = await pool.query(
        `INSERT INTO dtt_verifier_assignments_v2
         (assignment_id,tenant_id,work_id,tree_id,node_id,verifier_id,session_id,session_fingerprint,
          host_transport_session_fingerprint,presence_signature,client_type,opaque_agent_id,actor_provenance,
          execution_authorized)
         VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [assignment_id, stable.tenant_id, stable.work_id, stable.tree_id, stable.node_id, stable.verifier_id,
          stable.session_id, stable.session_fingerprint, stable.host_transport_session_fingerprint,
          stable.presence_signature, stable.client_type, stable.opaque_agent_id, stable.actor_provenance],
      );
      if (result.rows[0]) return result.rows[0];
      const occupied = await pool.query(
        `SELECT * FROM dtt_verifier_assignments_v2
         WHERE tenant_id=$1 AND work_id=$2::uuid AND tree_id=$3 AND node_id=$4
           AND (verifier_id=$5 OR actor_provenance=$6)`,
        [stable.tenant_id, stable.work_id, stable.tree_id, stable.node_id, stable.verifier_id, stable.actor_provenance],
      );
      const exact = occupied.rows.find((record) => (
        record.assignment_id === assignment_id
        && record.verifier_id === stable.verifier_id
        && record.session_id === stable.session_id
        && record.session_fingerprint === stable.session_fingerprint
        && record.host_transport_session_fingerprint === stable.host_transport_session_fingerprint
        && record.presence_signature === stable.presence_signature
        && record.client_type === stable.client_type
        && record.opaque_agent_id === stable.opaque_agent_id
        && record.actor_provenance === stable.actor_provenance
      ));
      if (exact) return exact;
      if (occupied.rows.some((record) => record.actor_provenance === stable.actor_provenance)) {
        throw new Error("dtt_verifier_actor_already_assigned");
      }
      throw new Error("dtt_verifier_slot_already_assigned");
    },
    async verifyAssignment(input) {
      await initialize();
      const expectedWorkId = workId(input.work_id);
      const result = await pool.query(
        "SELECT * FROM dtt_verifier_assignments_v2 WHERE assignment_id=$1 AND tenant_id=$2 AND work_id=$3::uuid",
        [input.assignment_id, input.tenant_id, expectedWorkId],
      );
      const record = result.rows[0];
      if (!record) return { verified: false, execution_authorized: false };
      const fields = [
        "tenant_id", "tree_id", "node_id", "verifier_id", "session_id", "session_fingerprint",
        "host_transport_session_fingerprint", "presence_signature", "client_type", "opaque_agent_id",
        "actor_provenance",
      ];
      if (record.work_id !== expectedWorkId || !fields.every((field) => record[field] === input[field])) {
        return { verified: false, execution_authorized: false };
      }
      return {
        verified: true,
        assignment_id: record.assignment_id,
        tenant_id: record.tenant_id,
        work_id: record.work_id,
        tree_id: record.tree_id,
        node_id: record.node_id,
        verifier_id: record.verifier_id,
        session_id: record.session_id,
        session_fingerprint: record.session_fingerprint,
        host_transport_session_fingerprint: record.host_transport_session_fingerprint,
        presence_signature: record.presence_signature,
        client_type: record.client_type,
        opaque_agent_id: record.opaque_agent_id,
        actor_provenance: record.actor_provenance,
        independence_key: record.actor_provenance,
        execution_authorized: false,
      };
    },
    async listAssignments({ tenant_id, work_id, tree_id, node_id }) {
      await initialize();
      const expectedWorkId = workId(work_id);
      return (await pool.query(
        "SELECT * FROM dtt_verifier_assignments_v2 WHERE tenant_id=$1 AND work_id=$2::uuid AND tree_id=$3 AND node_id=$4",
        [tenant_id, expectedWorkId, tree_id, node_id],
      )).rows;
    },
    async listAssignmentsForTree({ tenant_id, work_id, tree_id }) {
      await initialize();
      const expectedWorkId = workId(work_id);
      return (await pool.query(
        "SELECT * FROM dtt_verifier_assignments_v2 WHERE tenant_id=$1 AND work_id=$2::uuid AND tree_id=$3",
        [tenant_id, expectedWorkId, tree_id],
      )).rows;
    },
    async registerArtifact({ tenant_id, work_id, artifact_id, content, source_reference, registry_reference }) {
      await initialize();
      const boundedContent = value(content, "artifact_content", 200_000);
      const record = {
        tenant_id: value(tenant_id, "tenant_id", 120),
        work_id: workId(work_id),
        artifact_id: value(artifact_id, "artifact_id", 160),
        content_digest: `sha256:${crypto.createHash("sha256").update(boundedContent).digest("hex")}`,
        source_reference: value(source_reference, "source_reference", 1_000),
        registry_reference: value(registry_reference, "registry_reference", 1_000),
        execution_authorized: false,
      };
      const registry_id = id("dtar", record);
      const result = await pool.query(
        `INSERT INTO dtt_evidence_artifacts_v2
         (registry_id,tenant_id,work_id,artifact_id,content_digest,source_reference,registry_reference,execution_authorized)
         VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,false)
         ON CONFLICT (tenant_id,work_id,artifact_id,content_digest,source_reference) DO UPDATE
         SET registry_id=dtt_evidence_artifacts_v2.registry_id RETURNING *`,
        [registry_id, record.tenant_id, record.work_id, record.artifact_id, record.content_digest,
          record.source_reference, record.registry_reference],
      );
      return result.rows[0];
    },
    async verifyArtifact({ tenant_id, work_id, artifact_id, content_digest, source_reference, registry_reference }) {
      await initialize();
      const expectedWorkId = workId(work_id);
      const result = await pool.query(
        `SELECT registry_id,tenant_id,work_id,artifact_id,content_digest,source_reference,registry_reference
         FROM dtt_evidence_artifacts_v2
         WHERE tenant_id=$1 AND work_id=$2::uuid AND artifact_id=$3 AND content_digest=$4 AND source_reference=$5
           AND ($6::text IS NULL OR registry_reference=$6)`,
        [tenant_id, expectedWorkId, artifact_id, content_digest, source_reference, registry_reference || null],
      );
      return result.rows.length === 1
        ? {
          verified: true,
          tenant_id: result.rows[0].tenant_id,
          work_id: result.rows[0].work_id,
          artifact_id: result.rows[0].artifact_id,
          content_digest: result.rows[0].content_digest,
          source_reference: result.rows[0].source_reference,
          registry_reference: result.rows[0].registry_reference,
          registry_id: result.rows[0].registry_id,
          execution_authorized: false,
        }
        : { verified: false, execution_authorized: false };
    },
    initialize,
  };
}
