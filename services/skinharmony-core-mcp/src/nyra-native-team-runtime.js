import crypto from "node:crypto";
import { Pool } from "pg";
import { digest, WORK_CONTINUITY_SCHEMA_SQL } from "./work-continuity-runtime.js";
import { postgresPoolConfig } from "./postgres-pool-config.js";
import { createRetryablePostgresInitializer } from "../../shared/retryable-postgres-initializer.js";

export const NYRA_NATIVE_TEAM_PACKAGE_ID = "nyra_native_team";
export const NYRA_NATIVE_TEAM_VERSION = "1.0.0";
export const NYRA_NATIVE_TEAM_PARENT_ID = "nyra_work_supervisor";

const clone = (value) => JSON.parse(JSON.stringify(value));

function tenant(value) {
  const id = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(id)) throw new Error("tenant_invalid");
  return id;
}

function identifier(value, field) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(id)) throw new Error(`${field}_invalid`);
  return id;
}

function uuid(value, field) {
  const id = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`${field}_invalid`);
  }
  return id;
}

function idempotencyKey(value) {
  return identifier(value, "idempotency_key");
}

function selectedBlueprints(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > NYRA_NATIVE_TEAM_BLUEPRINTS.length) {
    throw new Error("nyra_native_team_blueprints_invalid");
  }
  const requested = [...new Set(value.map((item) => identifier(item, "blueprint_id")))].sort();
  const catalog = new Map(NYRA_NATIVE_TEAM_BLUEPRINTS.map((item) => [item.blueprint_id, item]));
  const blueprints = requested.map((id) => catalog.get(id));
  if (blueprints.some((item) => !item)) throw new Error("nyra_native_team_blueprint_unknown");
  return blueprints;
}

const blueprint = ({ id, role, label, description, capabilities }) => Object.freeze({
  blueprint_id: id,
  blueprint_version: NYRA_NATIVE_TEAM_VERSION,
  role,
  label,
  description,
  parent_kind: "nyra",
  parent_agent_id: NYRA_NATIVE_TEAM_PARENT_ID,
  capability_allowlist: Object.freeze([...capabilities]),
  // A blueprint describes a specialist. It does not grant a live tool or a
  // model call: Core must bind both to a single assignment later.
  tool_allowlist: Object.freeze([]),
  memory_scope: "minimal_structured_work_only",
  execution_provider: "nyra_native_adapter",
  execution_mode: "disabled",
  model_invocation_allowed: false,
  external_action_allowed: false,
  core_gate_required: true,
  learning_mode: "frozen",
});

export const NYRA_NATIVE_TEAM_BLUEPRINTS = Object.freeze([
  blueprint({
    id: "memory_curator",
    role: "memory_curator",
    label: "Curatore lavoro e memoria",
    description: "Mantiene capsule, handoff e proposte di memoria verificata; non promuove memoria né modifica dati da solo.",
    capabilities: ["read_work_context", "prepare_handoff", "propose_verified_memory"],
  }),
  blueprint({
    id: "researcher",
    role: "researcher",
    label: "Ricercatore",
    description: "Prepara evidenze con provenienza e incertezza esplicita; non pubblica né contatta soggetti esterni.",
    capabilities: ["read_work_context", "collect_evidence", "cite_sources"],
  }),
  blueprint({
    id: "planner",
    role: "planner",
    label: "Pianificatore",
    description: "Scompone il lavoro, definisce dipendenze e criteri di uscita; non assegna privilegi o esecuzioni.",
    capabilities: ["read_work_context", "plan_work", "propose_assignments"],
  }),
  blueprint({
    id: "executor_specialist",
    role: "executor_specialist",
    label: "Esecutore specialista",
    description: "Prepara output delimitati per un incarico approvato; non ha deploy, merge, credenziali o scritture esterne.",
    capabilities: ["read_assigned_context", "prepare_scoped_artifact", "report_evidence"],
  }),
  blueprint({
    id: "independent_verifier",
    role: "independent_verifier",
    label: "Verificatore indipendente",
    description: "Controlla qualità, regressioni e limiti in modo indipendente; non corregge direttamente l'output verificato.",
    capabilities: ["read_assigned_context", "verify_evidence", "flag_risk"],
  }),
  blueprint({
    id: "release_operations",
    role: "release_operations",
    label: "Operazioni e rilascio",
    description: "Prepara checklist e rollback; deploy, merge e accesso sensibile restano sempre al gate del Core.",
    capabilities: ["read_release_context", "prepare_release_checklist", "prepare_rollback"],
  }),
]);

const BLUEPRINT_DIGEST = digest(NYRA_NATIVE_TEAM_BLUEPRINTS);

export function nyraNativeTeamBlueprintCatalog() {
  return {
    schema_version: "nyra_native_team_blueprints_v1",
    package_id: NYRA_NATIVE_TEAM_PACKAGE_ID,
    package_version: NYRA_NATIVE_TEAM_VERSION,
    blueprint_digest: BLUEPRINT_DIGEST,
    parent: { kind: "nyra", agent_id: NYRA_NATIVE_TEAM_PARENT_ID },
    defaults: {
      execution_mode: "disabled",
      model_invocation_allowed: false,
      external_action_allowed: false,
      core_gate_required: true,
      tenant_project_work_scoped: true,
    },
    blueprints: clone(NYRA_NATIVE_TEAM_BLUEPRINTS),
  };
}

const CREATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS core_nyra_native_team_packages (
  tenant_id varchar(64) NOT NULL,
  package_id varchar(80) NOT NULL,
  package_version varchar(40) NOT NULL,
  blueprint_digest char(64) NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'enabled',
  execution_mode varchar(40) NOT NULL DEFAULT 'disabled',
  model_invocation_allowed boolean NOT NULL DEFAULT false,
  external_action_allowed boolean NOT NULL DEFAULT false,
  enable_idempotency_key varchar(160) NOT NULL,
  enabled_by varchar(120) NOT NULL,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, package_id),
  UNIQUE (tenant_id, enable_idempotency_key)
);

CREATE TABLE IF NOT EXISTS core_nyra_agent_instances (
  tenant_id varchar(64) NOT NULL,
  project_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  agent_instance_id uuid NOT NULL,
  blueprint_id varchar(80) NOT NULL,
  blueprint_version varchar(40) NOT NULL,
  blueprint_digest char(64) NOT NULL,
  role varchar(80) NOT NULL,
  parent_kind varchar(40) NOT NULL CHECK (parent_kind='nyra'),
  parent_agent_id varchar(120) NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'ready' CHECK (status IN ('draft','ready','blocked','retired')),
  execution_provider varchar(80) NOT NULL,
  execution_mode varchar(40) NOT NULL DEFAULT 'disabled',
  model_invocation_allowed boolean NOT NULL DEFAULT false,
  external_action_allowed boolean NOT NULL DEFAULT false,
  core_gate_required boolean NOT NULL DEFAULT true,
  capability_allowlist jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool_allowlist jsonb NOT NULL DEFAULT '[]'::jsonb,
  memory_scope varchar(120) NOT NULL,
  learning_mode varchar(40) NOT NULL DEFAULT 'frozen',
  created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, agent_instance_id),
  UNIQUE (tenant_id, work_id, blueprint_id),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);
CREATE INDEX IF NOT EXISTS core_nyra_agent_instances_scope_idx
  ON core_nyra_agent_instances (tenant_id, project_id, work_id, created_at);

CREATE TABLE IF NOT EXISTS core_nyra_agent_receipts (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  sequence_number bigint NOT NULL,
  event_type varchar(80) NOT NULL,
  payload jsonb NOT NULL,
  previous_receipt_hash char(64),
  receipt_hash char(64) NOT NULL,
  created_by varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, receipt_id),
  UNIQUE (tenant_id, work_id, sequence_number),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);
CREATE OR REPLACE FUNCTION core_nyra_agent_receipts_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'core_nyra_agent_receipts_append_only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS core_nyra_agent_receipts_no_mutation ON core_nyra_agent_receipts;
CREATE TRIGGER core_nyra_agent_receipts_no_mutation BEFORE UPDATE OR DELETE ON core_nyra_agent_receipts
FOR EACH ROW EXECUTE FUNCTION core_nyra_agent_receipts_append_only();

CREATE TABLE IF NOT EXISTS core_nyra_native_team_idempotency (
  tenant_id varchar(64) NOT NULL,
  work_id uuid NOT NULL,
  idempotency_key varchar(160) NOT NULL,
  request_digest char(64) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_id, idempotency_key),
  FOREIGN KEY (tenant_id, work_id) REFERENCES core_continuity_works(tenant_id, work_id)
);
`;

function publicInstance(row) {
  return {
    agent_instance_id: row.agent_instance_id,
    blueprint_id: row.blueprint_id,
    blueprint_version: row.blueprint_version,
    role: row.role,
    parent: { kind: row.parent_kind, agent_id: row.parent_agent_id },
    status: row.status,
    execution: {
      provider: row.execution_provider,
      mode: row.execution_mode,
      model_invocation_allowed: row.model_invocation_allowed,
      external_action_allowed: row.external_action_allowed,
      core_gate_required: row.core_gate_required,
    },
    capability_allowlist: Array.isArray(row.capability_allowlist) ? row.capability_allowlist : [],
    tool_allowlist: Array.isArray(row.tool_allowlist) ? row.tool_allowlist : [],
    memory_scope: row.memory_scope,
    learning_mode: row.learning_mode,
    created_at: row.created_at,
  };
}

export function createNyraNativeTeamRuntime(config = {}, options = {}) {
  if (!config.databaseUrl && !options.pool) return null;
  const pool = options.pool || new Pool(postgresPoolConfig(config, {
    connectionString: config.databaseUrl,
  }));
  // Team rows bind to Gallery Work Identity. The Gallery schema is therefore
  // initialized first even when the first request after restart is `enable`.
  const initialize = createRetryablePostgresInitializer({
    pool,
    sql: `${WORK_CONTINUITY_SCHEMA_SQL}\n${CREATE_SCHEMA_SQL}`,
  });

  async function transaction(fn) {
    await initialize();
    const client = typeof pool.connect === "function" ? await pool.connect() : pool;
    try {
      if (client.query !== pool.query) await client.query("BEGIN");
      const result = await fn(client);
      if (client.query !== pool.query) await client.query("COMMIT");
      return result;
    } catch (error) {
      if (client.query !== pool.query) await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release?.(); }
  }

  async function appendReceipt(client, context, eventType, payload) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [context.tenantId, `nyra-team:${context.workId}`]);
    const previous = await client.query(`SELECT sequence_number,receipt_hash FROM core_nyra_agent_receipts
      WHERE tenant_id=$1 AND work_id=$2 ORDER BY sequence_number DESC LIMIT 1 FOR UPDATE`, [context.tenantId, context.workId]);
    const receipt = {
      tenant_id: context.tenantId,
      work_id: context.workId,
      sequence_number: Number(previous.rows[0]?.sequence_number || 0) + 1,
      event_type: eventType,
      payload,
      previous_receipt_hash: previous.rows[0]?.receipt_hash || null,
    };
    const receiptHash = digest(receipt);
    const receiptId = crypto.randomUUID();
    await client.query(`INSERT INTO core_nyra_agent_receipts
      (tenant_id,work_id,receipt_id,sequence_number,event_type,payload,previous_receipt_hash,receipt_hash,created_by)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`, [
      context.tenantId, context.workId, receiptId, receipt.sequence_number, eventType,
      JSON.stringify(payload), receipt.previous_receipt_hash, receiptHash, context.actor,
    ]);
    return { receipt_id: receiptId, sequence_number: receipt.sequence_number, event_type: eventType, receipt_hash: receiptHash };
  }

  async function packageFor(client, tenantId) {
    const result = await client.query(`SELECT package_id,package_version,blueprint_digest,status,execution_mode,
      model_invocation_allowed,external_action_allowed,enable_idempotency_key,enabled_at FROM core_nyra_native_team_packages
      WHERE tenant_id=$1 AND package_id=$2`, [tenantId, NYRA_NATIVE_TEAM_PACKAGE_ID]);
    return result.rows[0] || null;
  }

  // This private-by-default runtime surface is deliberately not exposed as an
  // MCP tool. It lets Nyra's Work Autopilot materialize only the specialists
  // selected for one existing Work, while keeping the owner-gated package
  // enablement and every zero-privilege property intact.
  async function materializeForWorkInTransaction(client, identity, input = {}) {
    if (!client || typeof client.query !== "function") throw new Error("nyra_native_team_transaction_client_required");
    const tenantId = tenant(identity?.tenantId);
    const workId = uuid(input.work_id, "work_id");
    const projectId = identifier(input.project_id, "project_id");
    const actor = identifier(input.agent_id || identity?.subject || "nyra_autopilot", "agent_id");
    const key = idempotencyKey(input.idempotency_key);
    const blueprints = selectedBlueprints(input.blueprint_ids || NYRA_NATIVE_TEAM_BLUEPRINTS.map((item) => item.blueprint_id));
    const context = { tenantId, workId, projectId, actor };
    const work = await client.query(`SELECT project_id,status FROM core_continuity_works
        WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE`, [tenantId, workId]);
      if (!work.rows[0]) throw new Error("continuity_work_not_found");
      if (work.rows[0].project_id !== projectId) throw new Error("nyra_native_team_project_mismatch");
      const activePackage = await packageFor(client, tenantId);
      if (activePackage?.status !== "enabled") throw new Error("nyra_native_team_not_enabled");
      const request = {
        project_id: projectId,
        work_id: workId,
        blueprint_digest: BLUEPRINT_DIGEST,
        blueprint_ids: blueprints.map((item) => item.blueprint_id),
      };
      const legacyBootstrapRequest = {
        project_id: projectId,
        work_id: workId,
        blueprint_digest: BLUEPRINT_DIGEST,
      };
      const existing = await client.query(`SELECT request_digest,result FROM core_nyra_native_team_idempotency
        WHERE tenant_id=$1 AND work_id=$2 AND idempotency_key=$3`, [tenantId, workId, key]);
      if (existing.rows[0]) {
        const matchesCurrent = existing.rows[0].request_digest === digest(request);
        const matchesLegacyBootstrap = input.receipt_event_type === "native_team_bootstrapped" &&
          existing.rows[0].request_digest === digest(legacyBootstrapRequest);
        if (!matchesCurrent && !matchesLegacyBootstrap) throw new Error("idempotency_key_conflict");
        return { ...existing.rows[0].result, idempotent_replay: true };
      }
      const prior = await client.query(`SELECT agent_instance_id,blueprint_id,blueprint_version,role,parent_kind,parent_agent_id,
        status,execution_provider,execution_mode,model_invocation_allowed,external_action_allowed,core_gate_required,
        capability_allowlist,tool_allowlist,memory_scope,learning_mode,created_at
        FROM core_nyra_agent_instances WHERE tenant_id=$1 AND work_id=$2 ORDER BY blueprint_id FOR UPDATE`, [tenantId, workId]);
      const existingByBlueprint = new Map(prior.rows.map((row) => [row.blueprint_id, row]));
      const instances = [];
      const createdBlueprintIds = [];
      for (const spec of blueprints) {
        const priorInstance = existingByBlueprint.get(spec.blueprint_id);
        if (priorInstance) {
          instances.push(publicInstance(priorInstance));
          continue;
        }
        const instanceId = crypto.randomUUID();
        const inserted = await client.query(`INSERT INTO core_nyra_agent_instances
          (tenant_id,project_id,work_id,agent_instance_id,blueprint_id,blueprint_version,blueprint_digest,role,parent_kind,parent_agent_id,
           status,execution_provider,execution_mode,model_invocation_allowed,external_action_allowed,core_gate_required,
           capability_allowlist,tool_allowlist,memory_scope,learning_mode,created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'nyra',$9,'ready',$10,'disabled',false,false,true,$11::jsonb,$12::jsonb,$13,'frozen',$14)
          RETURNING agent_instance_id,blueprint_id,blueprint_version,role,parent_kind,parent_agent_id,status,execution_provider,
            execution_mode,model_invocation_allowed,external_action_allowed,core_gate_required,capability_allowlist,tool_allowlist,memory_scope,learning_mode,created_at`, [
          tenantId, projectId, workId, instanceId, spec.blueprint_id, spec.blueprint_version, BLUEPRINT_DIGEST,
          spec.role, NYRA_NATIVE_TEAM_PARENT_ID, spec.execution_provider, JSON.stringify(spec.capability_allowlist),
          JSON.stringify(spec.tool_allowlist), spec.memory_scope, actor,
        ]);
        instances.push(publicInstance(inserted.rows[0]));
        createdBlueprintIds.push(spec.blueprint_id);
      }
      const receipt = await appendReceipt(client, context, input.receipt_event_type || "native_team_materialized", {
        project_id: projectId,
        package_id: NYRA_NATIVE_TEAM_PACKAGE_ID,
        package_version: NYRA_NATIVE_TEAM_VERSION,
        blueprint_digest: BLUEPRINT_DIGEST,
        selected_blueprint_ids: blueprints.map((item) => item.blueprint_id),
        created_blueprint_ids: createdBlueprintIds,
        execution_mode: "disabled",
        model_invocation_allowed: false,
        external_action_allowed: false,
      });
      const result = {
        tenant_id: tenantId,
        project_id: projectId,
        work_id: workId,
        parent: { kind: "nyra", agent_id: NYRA_NATIVE_TEAM_PARENT_ID },
        package: NYRA_NATIVE_TEAM_PACKAGE_ID,
        blueprint_digest: BLUEPRINT_DIGEST,
        instances,
        created_blueprint_ids: createdBlueprintIds,
        receipt,
        execution_authorized: false,
      };
      await client.query(`INSERT INTO core_nyra_native_team_idempotency
        (tenant_id,work_id,idempotency_key,request_digest,result) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [tenantId, workId, key, digest(request), JSON.stringify(result)]);
    return result;
  }

  async function materializeForWork(identity, input = {}) {
    return transaction((client) => materializeForWorkInTransaction(client, identity, input));
  }

  return {
    schemaSql: CREATE_SCHEMA_SQL,
    blueprintCatalog: nyraNativeTeamBlueprintCatalog,

    async status(identity) {
      const tenantId = tenant(identity?.tenantId);
      await initialize();
      const row = await packageFor(pool, tenantId);
      return {
        tenant_id: tenantId,
        package: {
          id: NYRA_NATIVE_TEAM_PACKAGE_ID,
          version: NYRA_NATIVE_TEAM_VERSION,
          enabled: row?.status === "enabled",
          execution_mode: row?.execution_mode || "disabled",
          model_invocation_allowed: row?.model_invocation_allowed === true,
          external_action_allowed: row?.external_action_allowed === true,
          enabled_at: row?.enabled_at || null,
        },
        ...nyraNativeTeamBlueprintCatalog(),
      };
    },

    async enable(identity, input = {}) {
      const tenantId = tenant(identity?.tenantId);
      const actor = identifier(input.agent_id || identity?.subject || "connected_ai", "agent_id");
      const key = idempotencyKey(input.idempotency_key);
      return transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [tenantId, "nyra-native-team-enable"]);
        const existing = await packageFor(client, tenantId);
        if (existing) {
          const replay = existing.enable_idempotency_key === key;
          if (!replay) throw new Error("nyra_native_team_already_enabled");
          return { tenant_id: tenantId, package: { id: existing.package_id, version: existing.package_version, enabled: true,
            execution_mode: existing.execution_mode, model_invocation_allowed: existing.model_invocation_allowed,
            external_action_allowed: existing.external_action_allowed }, idempotent_replay: true };
        }
        await client.query(`INSERT INTO core_nyra_native_team_packages
          (tenant_id,package_id,package_version,blueprint_digest,status,execution_mode,model_invocation_allowed,external_action_allowed,enable_idempotency_key,enabled_by)
          VALUES ($1,$2,$3,$4,'enabled','disabled',false,false,$5,$6)`,
        [tenantId, NYRA_NATIVE_TEAM_PACKAGE_ID, NYRA_NATIVE_TEAM_VERSION, BLUEPRINT_DIGEST, key, actor]);
        return { tenant_id: tenantId, package: { id: NYRA_NATIVE_TEAM_PACKAGE_ID, version: NYRA_NATIVE_TEAM_VERSION,
          enabled: true, execution_mode: "disabled", model_invocation_allowed: false, external_action_allowed: false }, idempotent_replay: false };
      });
    },

    async bootstrap(identity, input = {}) {
      return materializeForWork(identity, {
        ...input,
        blueprint_ids: NYRA_NATIVE_TEAM_BLUEPRINTS.map((item) => item.blueprint_id),
        receipt_event_type: "native_team_bootstrapped",
      });
    },

    materializeForWork,
    // Internal composition surface: callers must already own the transaction.
    // It is intentionally absent from the MCP tool registry.
    materializeForWorkInTransaction,

    async read(identity, input = {}) {
      const tenantId = tenant(identity?.tenantId);
      const workId = uuid(input.work_id, "work_id");
      const projectId = input.project_id ? identifier(input.project_id, "project_id") : null;
      await initialize();
      const result = await pool.query(`SELECT i.agent_instance_id,i.blueprint_id,i.blueprint_version,i.role,i.parent_kind,i.parent_agent_id,
        i.status,i.execution_provider,i.execution_mode,i.model_invocation_allowed,i.external_action_allowed,i.core_gate_required,
        i.capability_allowlist,i.tool_allowlist,i.memory_scope,i.learning_mode,i.created_at,w.project_id
        FROM core_nyra_agent_instances i JOIN core_continuity_works w ON w.tenant_id=i.tenant_id AND w.work_id=i.work_id
        WHERE i.tenant_id=$1 AND i.work_id=$2 ${projectId ? "AND w.project_id=$3" : ""} ORDER BY i.blueprint_id`,
      projectId ? [tenantId, workId, projectId] : [tenantId, workId]);
      if (!result.rows.length && projectId) throw new Error("nyra_native_team_not_found");
      return { tenant_id: tenantId, project_id: result.rows[0]?.project_id || projectId || null, work_id: workId,
        parent: { kind: "nyra", agent_id: NYRA_NATIVE_TEAM_PARENT_ID }, blueprint_digest: BLUEPRINT_DIGEST,
        instances: result.rows.map(publicInstance), execution_authorized: false };
    },
  };
}
