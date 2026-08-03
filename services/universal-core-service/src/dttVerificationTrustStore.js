import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function value(input, field, max = 1_000) {
  const result = String(input || "").trim();
  if (!result || result.length > max) throw new Error(`${field}_invalid`);
  return result;
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
  const file = path.join(directory, "trust.json");
  const lock = `${file}.lock`;
  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return { assignments: parsed.assignments || {}, artifacts: parsed.artifacts || {} };
    } catch (error) {
      if (error.code === "ENOENT") return { assignments: {}, artifacts: {} };
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
    kind: "file_cas",
    distributed: false,
    assignVerifier({ tenant_id, tree_id, node_id, verifier_id, session_fingerprint, opaque_agent_id, actor_provenance }) {
      const stable = {
        tenant_id: value(tenant_id, "tenant_id", 120),
        tree_id: value(tree_id, "tree_id", 160),
        node_id: value(node_id, "node_id", 120),
        verifier_id: value(verifier_id, "verifier_id", 160),
        session_fingerprint: value(session_fingerprint, "session_fingerprint", 160),
        opaque_agent_id: value(opaque_agent_id, "opaque_agent_id", 160),
        actor_provenance: value(actor_provenance, "actor_provenance", 160),
      };
      const assignment_id = id("dtta", stable);
      return update((state) => {
        const sameActor = Object.values(state.assignments).find((record) => (
          record.tenant_id === stable.tenant_id
          && record.tree_id === stable.tree_id
          && record.node_id === stable.node_id
          && record.actor_provenance === stable.actor_provenance
        ));
        if (sameActor && canonical(sameActor) !== canonical({ assignment_id, ...stable })) {
          throw new Error("dtt_verifier_actor_already_assigned");
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
      const record = read().assignments[value(input.assignment_id, "assignment_id", 160)];
      if (!record) return { verified: false };
      const fields = ["tenant_id", "tree_id", "node_id", "verifier_id", "session_fingerprint", "opaque_agent_id", "actor_provenance"];
      return {
        verified: fields.every((field) => record[field] === input[field]),
        assignment_id: record.assignment_id,
        independence_key: record.actor_provenance,
      };
    },
    listAssignments({ tenant_id, tree_id, node_id }) {
      return Object.values(read().assignments).filter((record) => (
        record.tenant_id === tenant_id && record.tree_id === tree_id && record.node_id === node_id
      )).map((record) => structuredClone(record));
    },
    registerArtifact({ tenant_id, artifact_id, content, source_reference, registry_reference }) {
      const boundedContent = value(content, "artifact_content", 200_000);
      const record = {
        tenant_id: value(tenant_id, "tenant_id", 120),
        artifact_id: value(artifact_id, "artifact_id", 160),
        content_digest: `sha256:${crypto.createHash("sha256").update(boundedContent).digest("hex")}`,
        source_reference: value(source_reference, "source_reference", 1_000),
        registry_reference: value(registry_reference, "registry_reference", 1_000),
      };
      const key = id("dtar", record);
      return update((state) => {
        state.artifacts[key] = { registry_id: key, ...record };
        return structuredClone(state.artifacts[key]);
      });
    },
    verifyArtifact({ tenant_id, artifact_id, content_digest, source_reference, registry_reference }) {
      const matches = Object.values(read().artifacts).filter((record) => (
        record.tenant_id === tenant_id
        && record.artifact_id === artifact_id
        && record.content_digest === content_digest
        && record.source_reference === source_reference
        && (!registry_reference || record.registry_reference === registry_reference)
      ));
      return matches.length === 1
        ? { verified: true, registry_id: matches[0].registry_id }
        : { verified: false };
    },
  };
}

export function createPostgresDttVerificationTrustStore({ pool } = {}) {
  if (!pool?.query) throw new Error("dtt_verification_trust_postgres_pool_required");
  let initialized;
  async function initialize() {
    if (!initialized) initialized = pool.query(`
      CREATE TABLE IF NOT EXISTS dtt_verifier_assignments (
        assignment_id varchar(80) PRIMARY KEY, tenant_id varchar(120) NOT NULL,
        tree_id varchar(160) NOT NULL, node_id varchar(120) NOT NULL,
        verifier_id varchar(160) NOT NULL, session_fingerprint varchar(160) NOT NULL,
        opaque_agent_id varchar(160) NOT NULL, actor_provenance varchar(160) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id,tree_id,node_id,verifier_id),
        UNIQUE (tenant_id,tree_id,node_id,actor_provenance)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS dtt_verifier_assignments_actor_per_node
        ON dtt_verifier_assignments (tenant_id,tree_id,node_id,actor_provenance);
      CREATE TABLE IF NOT EXISTS dtt_evidence_artifacts (
        registry_id varchar(80) PRIMARY KEY, tenant_id varchar(120) NOT NULL,
        artifact_id varchar(160) NOT NULL, content_digest varchar(256) NOT NULL,
        source_reference text NOT NULL, registry_reference text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id,artifact_id,content_digest,source_reference)
      );
    `);
    return initialized;
  }
  return {
    kind: "postgresql",
    distributed: true,
    async assignVerifier(input) {
      await initialize();
      const stable = {
        tenant_id: value(input.tenant_id, "tenant_id", 120),
        tree_id: value(input.tree_id, "tree_id", 160),
        node_id: value(input.node_id, "node_id", 120),
        verifier_id: value(input.verifier_id, "verifier_id", 160),
        session_fingerprint: value(input.session_fingerprint, "session_fingerprint", 160),
        opaque_agent_id: value(input.opaque_agent_id, "opaque_agent_id", 160),
        actor_provenance: value(input.actor_provenance, "actor_provenance", 160),
      };
      const assignment_id = id("dtta", stable);
      const result = await pool.query(
        `INSERT INTO dtt_verifier_assignments
         (assignment_id,tenant_id,tree_id,node_id,verifier_id,session_fingerprint,opaque_agent_id,actor_provenance)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [assignment_id, stable.tenant_id, stable.tree_id, stable.node_id, stable.verifier_id,
          stable.session_fingerprint, stable.opaque_agent_id, stable.actor_provenance],
      );
      if (result.rows[0]) return result.rows[0];
      const occupied = await pool.query(
        `SELECT * FROM dtt_verifier_assignments
         WHERE tenant_id=$1 AND tree_id=$2 AND node_id=$3
           AND (verifier_id=$4 OR actor_provenance=$5)`,
        [stable.tenant_id, stable.tree_id, stable.node_id, stable.verifier_id, stable.actor_provenance],
      );
      const exact = occupied.rows.find((record) => (
        record.assignment_id === assignment_id
        && record.verifier_id === stable.verifier_id
        && record.session_fingerprint === stable.session_fingerprint
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
      const result = await pool.query("SELECT * FROM dtt_verifier_assignments WHERE assignment_id=$1 AND tenant_id=$2", [input.assignment_id, input.tenant_id]);
      const record = result.rows[0];
      if (!record) return { verified: false };
      const fields = ["tenant_id", "tree_id", "node_id", "verifier_id", "session_fingerprint", "opaque_agent_id", "actor_provenance"];
      return {
        verified: fields.every((field) => record[field] === input[field]),
        assignment_id: record.assignment_id,
        independence_key: record.actor_provenance,
      };
    },
    async listAssignments({ tenant_id, tree_id, node_id }) {
      await initialize();
      return (await pool.query(
        "SELECT * FROM dtt_verifier_assignments WHERE tenant_id=$1 AND tree_id=$2 AND node_id=$3",
        [tenant_id, tree_id, node_id],
      )).rows;
    },
    async registerArtifact({ tenant_id, artifact_id, content, source_reference, registry_reference }) {
      await initialize();
      const boundedContent = value(content, "artifact_content", 200_000);
      const record = {
        tenant_id: value(tenant_id, "tenant_id", 120),
        artifact_id: value(artifact_id, "artifact_id", 160),
        content_digest: `sha256:${crypto.createHash("sha256").update(boundedContent).digest("hex")}`,
        source_reference: value(source_reference, "source_reference", 1_000),
        registry_reference: value(registry_reference, "registry_reference", 1_000),
      };
      const registry_id = id("dtar", record);
      const result = await pool.query(
        `INSERT INTO dtt_evidence_artifacts
         (registry_id,tenant_id,artifact_id,content_digest,source_reference,registry_reference)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (tenant_id,artifact_id,content_digest,source_reference) DO UPDATE
         SET registry_id=dtt_evidence_artifacts.registry_id RETURNING *`,
        [registry_id, record.tenant_id, record.artifact_id, record.content_digest,
          record.source_reference, record.registry_reference],
      );
      return result.rows[0];
    },
    async verifyArtifact({ tenant_id, artifact_id, content_digest, source_reference, registry_reference }) {
      await initialize();
      const result = await pool.query(
        `SELECT registry_id FROM dtt_evidence_artifacts
         WHERE tenant_id=$1 AND artifact_id=$2 AND content_digest=$3 AND source_reference=$4
           AND ($5::text IS NULL OR registry_reference=$5)`,
        [tenant_id, artifact_id, content_digest, source_reference, registry_reference || null],
      );
      return result.rows.length === 1
        ? { verified: true, registry_id: result.rows[0].registry_id }
        : { verified: false };
    },
    initialize,
  };
}
