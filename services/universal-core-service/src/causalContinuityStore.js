import crypto from "node:crypto";
import { Pool } from "pg";
import { causalDigest, CausalContinuityError, requireText, requireUuid } from "./causalContinuityCanonical.js";
import { createCausalContinuityMigrator } from "./causalContinuityMigration.js";

function rowOrNotFound(result) {
  if (!result.rows[0]) throw new CausalContinuityError("CAUSAL_NOT_FOUND");
  return result.rows[0];
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function projectLockParts(tenantId, projectId) {
  return [`causal:${tenantId}`, projectId];
}

const CHANGE_STATE_EDGES = Object.freeze({ DRAFT: ["MODELED"], MODELED: ["AUTHORIZED"], AUTHORIZED: ["EXECUTED"], EXECUTED: ["OBSERVING"], OBSERVING: ["VERIFIED_PROVISIONAL","PARTIAL","CONTRADICTED","HARMFUL","UNKNOWN"], VERIFIED_PROVISIONAL: ["VERIFIED_FINAL","CONTRADICTED","REMEDIATING"], VERIFIED_FINAL: ["CONTRADICTED"], CLOSED: ["CONTRADICTED"], PARTIAL: ["OBSERVING","REMEDIATING"], CONTRADICTED: ["REMEDIATING"], HARMFUL: ["REMEDIATING","ROLLED_BACK"], UNKNOWN: ["OBSERVING","ESCALATED"], REMEDIATING: ["EXECUTED","ROLLED_BACK"] });
const OBLIGATION_STATE_EDGES = Object.freeze({ ...CHANGE_STATE_EDGES, ROLLED_BACK: ["REMEDIATING"] });

function stateEdgeAllowed(edges, from, to) {
  return Array.isArray(edges[from]) && edges[from].includes(to);
}

export function buildCausalEventHash({
  tenant_id, project_id, event_id, sequence_number, event_type, operation,
  idempotency_key, request_digest, payload_digest, actor_provenance,
  previous_event_hash,
}) {
  return causalDigest({
    schema_version: "causal_event_hash_v1", tenant_id, project_id, event_id,
    sequence_number, event_type, operation, idempotency_key, request_digest,
    payload_digest, actor_provenance_digest: causalDigest(actor_provenance || {}),
    previous_event_hash: previous_event_hash || null,
  });
}

function galleryBindingPayload(row) {
  return {
    schema_version: "gallery_entity_binding_v1",
    tenant_id: row.tenant_id,
    project_id: row.project_id,
    project_state_digest: row.project_state_digest,
    genesis_intent_id: row.genesis_intent_id,
    intent_revision_id: row.intent_revision_id,
    work_id: row.work_id,
    change_id: row.change_id || null,
    obligation_ids: [...(row.obligation_ids || [])].sort(),
    entity_type: row.entity_type,
    ticket_id: row.ticket_id,
    parent_ticket_id: row.parent_ticket_id || null,
    core_event_sequence: Number(row.core_event_sequence),
    context_digest: row.context_digest,
    provenance: row.provenance || {},
  };
}

export function buildGalleryBindingDigest(row) {
  return causalDigest(galleryBindingPayload(row));
}

function galleryReadbackPayload(row) {
  return {
    ...galleryBindingPayload(row),
    binding_digest: row.binding_digest,
    core_event_hash: row.core_event_hash,
  };
}

function galleryIntegrityValid({ binding, event, outbox, context, previous }) {
  if (!binding || !event || !outbox || !context || binding.status !== "ACTIVE" || outbox.state !== "DELIVERED") return false;
  const sequence = Number(event.sequence_number);
  const expectedPrevious = sequence === 1 ? null : previous?.event_hash || null;
  const envelope = context.envelope || {};
  const contextObligations = new Set(envelope.obligation_ids || []);
  const expectedReadback = {
    ...galleryBindingPayload(binding), binding_digest: binding.binding_digest, core_event_hash: event.event_hash,
  };
  const eventResult = event.payload?.result || {};
  const outboxResult = outbox.payload?.result || {};
  return buildGalleryBindingDigest(binding) === binding.binding_digest &&
    buildGalleryBindingDigest(eventResult) === binding.binding_digest &&
    outboxResult.binding_digest === binding.binding_digest &&
    outbox.payload?.event_id === event.event_id && Number(outbox.payload?.sequence_number) === sequence &&
    outbox.payload?.event_type === "GALLERY_ITEM_BOUND" && outbox.projection_type === "GALLERY_BINDING" &&
    causalDigest(outbox.payload) === outbox.payload_digest && causalDigest(event.payload) === event.payload_digest &&
    buildCausalEventHash({ ...event, sequence_number: sequence }) === event.event_hash &&
    event.previous_event_hash === expectedPrevious && event.event_type === "GALLERY_ITEM_BOUND" && event.operation === "gallery_binding_project" &&
    binding.last_readback_digest === causalDigest(expectedReadback) &&
    context.tenant_id === binding.tenant_id && context.project_id === binding.project_id &&
    context.work_id === binding.work_id && context.change_id === binding.change_id && context.context_digest === binding.context_digest &&
    envelope.tenant_id === binding.tenant_id && envelope.project_id === binding.project_id &&
    envelope.project_state_digest === binding.project_state_digest && envelope.genesis_intent_id === binding.genesis_intent_id &&
    envelope.intent_revision_id === binding.intent_revision_id && envelope.work_id === binding.work_id &&
    envelope.change_id === binding.change_id && binding.obligation_ids.every((id) => contextObligations.has(id));
}

export function createPostgresCausalContinuityStore({ pool, connectionString, now = () => new Date() } = {}) {
  if (!pool && !connectionString) throw new CausalContinuityError("CAUSAL_DATABASE_REQUIRED");
  const ownsPool = !pool;
  const db = pool || new Pool({ connectionString, max: 6, idleTimeoutMillis: 10_000 });
  const migrator = createCausalContinuityMigrator({ pool: db });
  let initialized = false;

  async function initialize() {
    const migration = await migrator.apply();
    initialized = true;
    return migration;
  }

  async function health() {
    const probe = await db.query("SELECT current_setting('server_version_num')::int AS version_num, clock_timestamp() AS database_now");
    const readback = await migrator.readback();
    return {
      ok: initialized && readback.migration?.application_state === "COMPLETED",
      initialized,
      database_time: probe.rows[0]?.database_now,
      postgres_major: Math.floor(Number(probe.rows[0]?.version_num || 0) / 10_000),
      migration: readback.migration,
    };
  }

  async function readProject({ tenant_id, project_id, alias }, client = db) {
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    if (project_id) {
      return rowOrNotFound(await client.query(
        "SELECT p.* FROM core_projects p WHERE p.tenant_id=$1 AND p.project_id=$2",
        [tenantId, requireUuid(project_id, "project_id")],
      ));
    }
    const projectAlias = requireText(alias, "project_alias", 500);
    return rowOrNotFound(await client.query(
      `SELECT p.*, a.alias, a.provenance AS alias_provenance, a.verified_at AS alias_verified_at
         FROM core_project_aliases a
         JOIN core_projects p ON p.tenant_id=a.tenant_id AND p.project_id=a.project_id
        WHERE a.tenant_id=$1 AND a.alias=$2`,
      [tenantId, projectAlias],
    ));
  }

  async function runProjectOperation({ tenant_id, project_id, operation, idempotency_key, request, event_type, actor_provenance = {}, projection_type = "CAUSAL_TIMELINE", mutate }) {
    const tenantId = requireText(tenant_id, "tenant_id", 120);
    const projectId = requireUuid(project_id, "project_id");
    const operationName = requireText(operation, "operation", 160);
    const idempotencyKey = requireText(idempotency_key, "idempotency_key", 240);
    const requestDigest = causalDigest(request);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const [lockA, lockB] = projectLockParts(tenantId, projectId);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [lockA, lockB]);
      const prior = (await client.query(
        `SELECT request_digest,payload,event_id,sequence_number,event_hash
           FROM core_causal_event_ledger
          WHERE tenant_id=$1 AND project_id=$2 AND operation=$3 AND idempotency_key=$4`,
        [tenantId, projectId, operationName, idempotencyKey],
      )).rows[0];
      if (prior) {
        if (prior.request_digest !== requestDigest) throw new CausalContinuityError("IDEMPOTENCY_CONFLICT");
        await client.query("COMMIT");
        return { ...prior.payload.result, _event: { event_id: prior.event_id, sequence_number: Number(prior.sequence_number), event_hash: prior.event_hash, replayed: true } };
      }
      const previous = (await client.query(
        `SELECT sequence_number,event_hash FROM core_causal_event_ledger
          WHERE tenant_id=$1 AND project_id=$2 ORDER BY sequence_number DESC LIMIT 1`,
        [tenantId, projectId],
      )).rows[0];
      const sequence = Number(previous?.sequence_number || 0) + 1;
      const eventId = crypto.randomUUID();
      const result = await mutate(client, {
        event_id: eventId,
        sequence_number: sequence,
        previous_event_hash: previous?.event_hash || null,
      });
      const payload = { schema_version: "causal_event_payload_v1", result };
      const payloadDigest = causalDigest(payload);
      const actorProvenanceDigest = causalDigest(actor_provenance);
      const eventHash = buildCausalEventHash({
        tenant_id: tenantId, project_id: projectId, event_id: eventId, sequence_number: sequence,
        event_type, operation: operationName, idempotency_key: idempotencyKey,
        request_digest: requestDigest, payload_digest: payloadDigest, actor_provenance,
        previous_event_hash: previous?.event_hash || null,
      });
      await client.query(
        `INSERT INTO core_causal_event_ledger
          (tenant_id,project_id,event_id,sequence_number,event_type,operation,idempotency_key,request_digest,payload,payload_digest,actor_provenance,actor_provenance_digest,previous_event_hash,event_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13,$14)`,
        [tenantId, projectId, eventId, sequence, event_type, operationName, idempotencyKey, requestDigest, json(payload), payloadDigest, json(actor_provenance), actorProvenanceDigest, previous?.event_hash || null, eventHash],
      );
      const outboxId = crypto.randomUUID();
      const outboxPayload = { event_id: eventId, sequence_number: sequence, event_type, result };
      await client.query(
        `INSERT INTO core_causal_projection_outbox
          (tenant_id,outbox_id,project_id,event_id,projection_type,payload,payload_digest)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [tenantId, outboxId, projectId, eventId, projection_type, json(outboxPayload), causalDigest(outboxPayload)],
      );
      await client.query("COMMIT");
      return { ...result, _event: { event_id: eventId, sequence_number: sequence, event_hash: eventHash, replayed: false } };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* original error wins */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async function createProject(input) {
    return runProjectOperation({
      ...input, operation: "project_identity_create", event_type: "PROJECT_REGISTERED", request: input,
      mutate: async (client) => {
        await client.query(
          `INSERT INTO core_projects (tenant_id,project_id,derived_from_project_id,canonical_name)
           VALUES ($1,$2,$3,$4)`,
          [input.tenant_id, input.project_id, input.derived_from_project_id || null, input.canonical_name],
        );
        if (input.alias) {
          await client.query(
            `INSERT INTO core_project_aliases (tenant_id,alias,project_id,provenance,verified_at)
             VALUES ($1,$2,$3,$4::jsonb,$5)`,
            [input.tenant_id, input.alias, input.project_id, json(input.provenance || {}), input.alias_verified_at || null],
          );
        }
        await client.query(
          "INSERT INTO core_causal_feature_flags (tenant_id,project_id,mode) VALUES ($1,$2,'SHADOW')",
          [input.tenant_id, input.project_id],
        );
        return readProject({ tenant_id: input.tenant_id, project_id: input.project_id }, client);
      },
    });
  }

  async function bindScope(input) {
    return runProjectOperation({
      ...input, operation: "project_scope_bind", event_type: "PROJECT_SCOPE_CHANGED", request: input,
      mutate: async (client) => {
        const result = await client.query(
          `INSERT INTO core_project_scope_resources
            (tenant_id,resource_id,project_id,resource_type,canonical_identifier,environment,ownership,active,provenance,resource_digest,last_verified_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11)
           ON CONFLICT (tenant_id,project_id,resource_type,canonical_identifier,environment)
           DO UPDATE SET ownership=EXCLUDED.ownership,active=EXCLUDED.active,provenance=EXCLUDED.provenance,
                         resource_digest=EXCLUDED.resource_digest,last_verified_at=EXCLUDED.last_verified_at
           RETURNING *`,
          [input.tenant_id, input.resource_id, input.project_id, input.resource_type, input.canonical_identifier,
            input.environment, json(input.ownership), input.active !== false, json(input.provenance), input.resource_digest || null,
            input.last_verified_at || null],
        );
        await client.query("UPDATE core_projects SET active_state_digest=NULL,version=version+1 WHERE tenant_id=$1 AND project_id=$2", [input.tenant_id, input.project_id]);
        return result.rows[0];
      },
    });
  }

  async function readScope(input) {
    const tenantId = requireText(input.tenant_id, "tenant_id", 120);
    const projectId = requireUuid(input.project_id, "project_id");
    return (await db.query(
      `SELECT * FROM core_project_scope_resources
        WHERE tenant_id=$1 AND project_id=$2 AND ($3::boolean IS FALSE OR active)
        ORDER BY resource_type,canonical_identifier,environment LIMIT $4`,
      [tenantId, projectId, input.active_only !== false, Math.min(Number(input.limit) || 500, 500)],
    )).rows;
  }

  async function saveState(input) {
    return runProjectOperation({
      ...input, operation: "project_state_snapshot", event_type: "PROJECT_STATE_SNAPSHOTTED", request: input,
      mutate: async (client) => {
        const project = rowOrNotFound(await client.query(
          "SELECT * FROM core_projects WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE",
          [input.tenant_id, input.project_id],
        ));
        if (input.base_state_digest && project.active_state_digest && input.base_state_digest !== project.active_state_digest) {
          throw new CausalContinuityError("STALE_PROJECT_STATE", "Project state advanced", { current_state_digest: project.active_state_digest });
        }
        const latest = (await client.query(
          "SELECT COALESCE(MAX(sequence_number),0)::bigint AS sequence FROM core_causal_event_ledger WHERE tenant_id=$1 AND project_id=$2",
          [input.tenant_id, input.project_id],
        )).rows[0];
        const ledgerSequence = Number(latest.sequence) + 1;
        const result = await client.query(
          `INSERT INTO core_project_state_snapshots
            (tenant_id,snapshot_id,project_id,canonicalization_version,canonical_state,state_digest,ledger_sequence,observed_at)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *`,
          [input.tenant_id, input.snapshot_id, input.project_id, input.canonicalization_version, json(input.canonical_state),
            input.state_digest, ledgerSequence, input.observed_at],
        );
        await client.query(
          "UPDATE core_projects SET active_state_digest=$3,version=version+1 WHERE tenant_id=$1 AND project_id=$2",
          [input.tenant_id, input.project_id, input.state_digest],
        );
        return result.rows[0];
      },
    });
  }

  async function currentState(input) {
    const project = await readProject(input);
    if (!project.active_state_digest) return null;
    return rowOrNotFound(await db.query(
      `SELECT * FROM core_project_state_snapshots
        WHERE tenant_id=$1 AND project_id=$2 AND state_digest=$3`,
      [input.tenant_id, project.project_id, project.active_state_digest],
    ));
  }

  async function createGenesis(input) {
    return runProjectOperation({
      ...input, operation: "genesis_intent_create", event_type: "GENESIS_INTENT_CREATED", request: input,
      mutate: async (client) => (await client.query(
        `INSERT INTO core_genesis_intents
          (tenant_id,genesis_intent_id,project_id,intent_text,author_id,canonical_digest)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [input.tenant_id, input.genesis_intent_id, input.project_id, input.intent_text, input.author_id, input.canonical_digest],
      )).rows[0],
    });
  }

  async function readGenesis(input) {
    return rowOrNotFound(await db.query(
      "SELECT * FROM core_genesis_intents WHERE tenant_id=$1 AND project_id=$2",
      [requireText(input.tenant_id, "tenant_id", 120), requireUuid(input.project_id, "project_id")],
    ));
  }

  async function proposeRevision(input) {
    return runProjectOperation({
      ...input, operation: "intent_revision_propose", event_type: "INTENT_REVISION_PROPOSED", request: input,
      mutate: async (client) => {
        if (input.parent_revision_id) {
          const parent = (await client.query(
            `SELECT * FROM core_intent_revisions
              WHERE tenant_id=$1 AND project_id=$2 AND intent_revision_id=$3 AND state='APPROVED' FOR SHARE`,
            [input.tenant_id, input.project_id, input.parent_revision_id],
          )).rows[0];
          if (!parent) throw new CausalContinuityError("INTENT_PARENT_INVALID");
          const cycle = (await client.query(
            `WITH RECURSIVE ancestors AS (
               SELECT intent_revision_id,parent_revision_id,ARRAY[intent_revision_id] AS path,FALSE AS cycle
                 FROM core_intent_revisions
                WHERE tenant_id=$1 AND project_id=$2 AND intent_revision_id=$3
               UNION ALL
               SELECT r.intent_revision_id,r.parent_revision_id,a.path || r.intent_revision_id,
                      r.intent_revision_id=ANY(a.path)
                 FROM core_intent_revisions r
                 JOIN ancestors a ON r.tenant_id=$1 AND r.project_id=$2 AND r.intent_revision_id=a.parent_revision_id
                WHERE NOT a.cycle
             ) SELECT 1 FROM ancestors WHERE cycle OR intent_revision_id=$4 LIMIT 1`,
            [input.tenant_id, input.project_id, input.parent_revision_id, input.intent_revision_id],
          )).rows[0];
          if (cycle) throw new CausalContinuityError("INTENT_REVISION_CYCLE");
        }
        const result = (await client.query(
          `INSERT INTO core_intent_revisions
            (tenant_id,intent_revision_id,project_id,genesis_intent_id,parent_revision_id,alias,classification,revision_payload,author_id,canonical_digest)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) RETURNING *`,
          [input.tenant_id, input.intent_revision_id, input.project_id, input.genesis_intent_id, input.parent_revision_id || null,
            input.alias, input.classification, json(input.revision_payload), input.author_id, input.canonical_digest],
        )).rows[0];
        if (input.parent_revision_id) {
          await client.query(
            `INSERT INTO core_intent_revision_edges
              (tenant_id,project_id,parent_revision_id,child_revision_id,relation)
             VALUES ($1,$2,$3,$4,'CHILD_REVISION')`,
            [input.tenant_id, input.project_id, input.parent_revision_id, input.intent_revision_id],
          );
        }
        return result;
      },
    });
  }

  async function approveRevision(input) {
    return runProjectOperation({
      ...input, operation: "intent_revision_approve", event_type: input.approved === false ? "INTENT_REVISION_REJECTED" : "INTENT_REVISION_APPROVED", request: input,
      mutate: async (client) => {
        const revision = rowOrNotFound(await client.query(
          "SELECT * FROM core_intent_revisions WHERE tenant_id=$1 AND intent_revision_id=$2 FOR UPDATE",
          [input.tenant_id, input.intent_revision_id],
        ));
        if (revision.state !== "PROPOSED") throw new CausalContinuityError("INTENT_REVISION_IMMUTABLE");
        if (revision.classification === "PURPOSE_CHANGE" && input.approved !== false) throw new CausalContinuityError("NEW_PROJECT_REQUIRED");
        const state = input.approved === false ? "REJECTED" : "APPROVED";
        const updated = (await client.query(
          `UPDATE core_intent_revisions SET state=$3,authorized_by=$4,decided_at=clock_timestamp()
            WHERE tenant_id=$1 AND intent_revision_id=$2 RETURNING *`,
          [input.tenant_id, input.intent_revision_id, state, input.authorized_by],
        )).rows[0];
        if (state === "APPROVED") {
          await client.query(
            "UPDATE core_projects SET active_intent_revision_id=$3,version=version+1 WHERE tenant_id=$1 AND project_id=$2",
            [input.tenant_id, revision.project_id, input.intent_revision_id],
          );
        }
        return updated;
      },
    });
  }

  async function listRevisions(input) {
    return (await db.query(
      "SELECT * FROM core_intent_revisions WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at,intent_revision_id LIMIT $3",
      [requireText(input.tenant_id, "tenant_id", 120), requireUuid(input.project_id, "project_id"), Math.min(Number(input.limit) || 200, 200)],
    )).rows;
  }

  async function bindWork(input) {
    return runProjectOperation({
      ...input, operation: "work_bind_intent", event_type: "WORK_OPENED", request: input,
      mutate: async (client) => {
        const project = rowOrNotFound(await client.query(
          "SELECT project_id,active_state_digest FROM core_projects WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE",
          [input.tenant_id, input.project_id],
        ));
        if (input.legacy_binding_state !== "UNRESOLVED_LEGACY_BINDING" &&
            (!input.base_state_digest || project.active_state_digest !== input.base_state_digest)) {
          throw new CausalContinuityError("STALE_PROJECT_STATE");
        }
        let legacyBinding = { present: false, state: input.legacy_binding_state };
        const legacyPresent = (await client.query("SELECT to_regclass('core_continuity_works') IS NOT NULL AS present")).rows[0]?.present === true;
        if (legacyPresent) {
          const legacyRows = (await client.query(
            "SELECT work_id,project_uuid FROM core_continuity_works WHERE tenant_id=$1 AND work_id=$2 FOR UPDATE",
            [input.tenant_id, input.work_id],
          )).rows;
          if (legacyRows.length > 1) throw new CausalContinuityError("UNRESOLVED_LEGACY_BINDING");
          if (legacyRows.length === 1) {
            const legacy = legacyRows[0];
            if (input.legacy_binding_state === "UNRESOLVED_LEGACY_BINDING") {
              legacyBinding = { present: true, state: "UNRESOLVED_LEGACY_BINDING", project_uuid: legacy.project_uuid || null };
            } else {
              if (legacy.project_uuid && legacy.project_uuid !== input.project_id) throw new CausalContinuityError("LEGACY_PROJECT_BINDING_CONFLICT");
              await client.query(
                "UPDATE core_continuity_works SET project_uuid=$3 WHERE tenant_id=$1 AND work_id=$2 AND (project_uuid IS NULL OR project_uuid=$3)",
                [input.tenant_id, input.work_id, input.project_id],
              );
              const readback = rowOrNotFound(await client.query(
                "SELECT work_id,project_uuid FROM core_continuity_works WHERE tenant_id=$1 AND work_id=$2 FOR SHARE",
                [input.tenant_id, input.work_id],
              ));
              if (readback.project_uuid !== input.project_id) throw new CausalContinuityError("LEGACY_PROJECT_BINDING_CONFLICT");
              legacyBinding = { present: true, state: "VERIFIED", project_uuid: readback.project_uuid };
            }
          }
        }
        const inserted = (await client.query(
          `INSERT INTO core_work_causal_bindings
          (tenant_id,work_id,project_id,genesis_intent_id,intent_revision_id,base_state_digest,legacy_binding_state,provenance)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         ON CONFLICT (tenant_id,work_id) DO NOTHING
         RETURNING *`,
          [input.tenant_id, input.work_id, input.project_id, input.genesis_intent_id, input.intent_revision_id,
          input.base_state_digest || null, input.legacy_binding_state || "VERIFIED", json(input.provenance)],
        )).rows[0];
        if (inserted) return { ...inserted, legacy_binding: legacyBinding };
        const existing = rowOrNotFound(await client.query(
          "SELECT * FROM core_work_causal_bindings WHERE tenant_id=$1 AND work_id=$2",
          [input.tenant_id, input.work_id],
        ));
        const desired = {
          project_id: input.project_id, genesis_intent_id: input.genesis_intent_id,
          intent_revision_id: input.intent_revision_id, base_state_digest: input.base_state_digest || null,
          legacy_binding_state: input.legacy_binding_state || "VERIFIED", provenance: input.provenance,
        };
        const observed = {
          project_id: existing.project_id, genesis_intent_id: existing.genesis_intent_id,
          intent_revision_id: existing.intent_revision_id, base_state_digest: existing.base_state_digest,
          legacy_binding_state: existing.legacy_binding_state, provenance: existing.provenance,
        };
        if (causalDigest(desired) !== causalDigest(observed)) throw new CausalContinuityError("IDEMPOTENCY_CONFLICT");
        return { ...existing, legacy_binding: legacyBinding };
      },
    });
  }

  async function createChange(input) {
    return runProjectOperation({
      ...input, operation: "change_create", event_type: "CHANGE_OPENED", request: input,
      mutate: async (client) => (await client.query(
        `INSERT INTO core_changes
          (tenant_id,change_id,project_id,work_id,intent_revision_id,parent_change_id,alias,reason,scope,expected_effects,forbidden_effects,base_state_digest,expected_target_state,request_digest)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13::jsonb,$14) RETURNING *`,
        [input.tenant_id, input.change_id, input.project_id, input.work_id, input.intent_revision_id, input.parent_change_id || null,
          input.alias || null, input.reason, json(input.scope), json(input.expected_effects), json(input.forbidden_effects),
          input.base_state_digest, json(input.expected_target_state), causalDigest(input)],
      )).rows[0],
    });
  }

  async function readChange(input) {
    return rowOrNotFound(await db.query(
      "SELECT * FROM core_changes WHERE tenant_id=$1 AND change_id=$2",
      [requireText(input.tenant_id, "tenant_id", 120), requireUuid(input.change_id, "change_id")],
    ));
  }

  async function readWork(input) {
    return rowOrNotFound(await db.query(
      "SELECT * FROM core_work_causal_bindings WHERE tenant_id=$1 AND work_id=$2",
      [requireText(input.tenant_id, "tenant_id", 120), requireUuid(input.work_id, "work_id")],
    ));
  }

  async function listChanges(input) {
    return (await db.query(
      "SELECT * FROM core_changes WHERE tenant_id=$1 AND project_id=$2 AND ($3::uuid IS NULL OR work_id=$3) ORDER BY created_at,change_id LIMIT $4",
      [input.tenant_id, input.project_id, input.work_id || null, Math.min(Number(input.limit) || 200, 200)],
    )).rows;
  }

  async function transitionChange(input) {
    return runProjectOperation({ ...input, operation: "change_transition", event_type: input.event_type, request: input,
      mutate: async (client) => {
        const current = rowOrNotFound(await client.query(
          "SELECT * FROM core_changes WHERE tenant_id=$1 AND change_id=$2 FOR UPDATE",
          [input.tenant_id, input.change_id],
        ));
        if (!stateEdgeAllowed(CHANGE_STATE_EDGES, current.state, input.target_state) || current.state !== input.expected_state) throw new CausalContinuityError("CHANGE_STATE_INVALID");
        if (input.target_state === "AUTHORIZED") throw new CausalContinuityError("TRANSITION_ORIGIN_REQUIRED");
        if (input.target_state === "EXECUTED") {
          const lease = input.lease_id ? (await client.query(
            `SELECT 1 FROM core_action_lease_bindings WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND change_id=$4
              AND lease_id=$5 AND lease_purpose='causal_context_issue' AND authority_binding_digest IS NOT NULL AND expires_at>clock_timestamp() FOR SHARE`,
            [input.tenant_id, current.project_id, current.work_id, current.change_id, input.lease_id],
          )).rows[0] : null;
          if (!lease) throw new CausalContinuityError("LEASE_INVALID");
          const consumedContext = input.context_digest ? (await client.query(
            `SELECT 1 FROM core_causal_contexts WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND change_id=$4
              AND context_digest=$5 AND envelope->>'lease_id'=$6 AND consumed_at IS NOT NULL AND expires_at>clock_timestamp() FOR SHARE`,
            [input.tenant_id, current.project_id, current.work_id, current.change_id, input.context_digest, input.lease_id],
          )).rows[0] : null;
          if (!consumedContext || !input.execution_evidence_digest) throw new CausalContinuityError("EXECUTION_AUTHORIZATION_REQUIRED");
        }
        const updated = rowOrNotFound(await client.query(
          "UPDATE core_changes SET state=$3,updated_at=clock_timestamp() WHERE tenant_id=$1 AND change_id=$2 AND state=$4 RETURNING *",
          [input.tenant_id, input.change_id, input.target_state, input.expected_state],
        ));
        await client.query(
          `INSERT INTO core_change_state_transitions (tenant_id,transition_id,change_id,from_state,to_state,reason,actor_provenance)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [input.tenant_id, input.transition_id, input.change_id, input.expected_state, input.target_state, input.reason, json(input.actor_provenance)],
        );
        return updated;
      },
    });
  }

  async function transitionObligation(input) {
    return runProjectOperation({ ...input, operation: "causal_obligation_transition", event_type: input.event_type, request: input,
      mutate: async (client) => {
        const current = rowOrNotFound(await client.query(
          "SELECT * FROM core_causal_obligations WHERE tenant_id=$1 AND obligation_id=$2 FOR UPDATE",
          [input.tenant_id, input.obligation_id],
        ));
        if (!stateEdgeAllowed(OBLIGATION_STATE_EDGES, current.state, input.target_state) || current.state !== input.expected_state) throw new CausalContinuityError("OBLIGATION_STATE_INVALID");
        if (input.target_state === "AUTHORIZED") throw new CausalContinuityError("TRANSITION_ORIGIN_REQUIRED");
        if (input.target_state === "EXECUTED") {
          const lease = input.lease_id ? (await client.query(
            `SELECT 1 FROM core_action_lease_bindings WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND change_id=$4 AND lease_id=$5
              AND obligation_ids @> $6::jsonb AND lease_purpose='causal_context_issue' AND authority_binding_digest IS NOT NULL
              AND expires_at>clock_timestamp() FOR SHARE`,
            [input.tenant_id, current.project_id, current.work_id, current.change_id, input.lease_id, json([current.obligation_id])],
          )).rows[0] : null;
          if (!lease) throw new CausalContinuityError("LEASE_INVALID");
          const consumedContext = input.context_digest ? (await client.query(
            `SELECT 1 FROM core_causal_contexts WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND change_id=$4
              AND context_digest=$5 AND envelope->>'lease_id'=$6 AND envelope->'obligation_ids' @> $7::jsonb
              AND consumed_at IS NOT NULL AND expires_at>clock_timestamp() FOR SHARE`,
            [input.tenant_id, current.project_id, current.work_id, current.change_id, input.context_digest, input.lease_id, json([current.obligation_id])],
          )).rows[0] : null;
          if (!consumedContext || !input.execution_evidence_digest) throw new CausalContinuityError("EXECUTION_AUTHORIZATION_REQUIRED");
        }
        const updated = rowOrNotFound(await client.query(
          "UPDATE core_causal_obligations SET state=$3,updated_at=clock_timestamp() WHERE tenant_id=$1 AND obligation_id=$2 AND state=$4 RETURNING *",
          [input.tenant_id, input.obligation_id, input.target_state, input.expected_state],
        ));
        await client.query(
          `INSERT INTO core_obligation_state_transitions (tenant_id,transition_id,obligation_id,from_state,to_state,reason,actor_provenance)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [input.tenant_id, input.transition_id, input.obligation_id, input.expected_state, input.target_state, input.reason, json(input.actor_provenance)],
        );
        return updated;
      },
    });
  }

  async function createObligation(input) {
    return runProjectOperation({
      ...input, operation: "causal_obligation_create", event_type: "OBLIGATION_CREATED", request: input,
      mutate: async (client) => {
        const obligation = (await client.query(
          `INSERT INTO core_causal_obligations
            (tenant_id,obligation_id,project_id,intent_revision_id,work_id,change_id,claim,owner_id,delegated_owners,expected_effects,forbidden_effects,assurance_level,verification_horizons,rollback_plan,residual_obligations,next_verification_at,obligation_digest)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17) RETURNING *`,
          [input.tenant_id, input.obligation_id, input.project_id, input.intent_revision_id, input.work_id, input.change_id,
            input.claim, input.owner_id, json(input.delegated_owners), json(input.expected_effects), json(input.forbidden_effects),
            input.assurance_level, json(input.verification_horizons), json(input.rollback_plan), json(input.residual_obligations),
            input.next_verification_at || null, input.obligation_digest],
        )).rows[0];
        await client.query(
          `INSERT INTO core_evidence_contracts
            (tenant_id,evidence_contract_id,obligation_id,required_sources,minimum_independence,minimum_independent_observers,freshness_seconds,minimum_assurance_level,horizons,falsification_conditions,forbidden_effect_observers,contract_digest)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12)`,
          [input.tenant_id, input.evidence_contract.evidence_contract_id, input.obligation_id,
            json(input.evidence_contract.required_sources), input.evidence_contract.minimum_independence,
            input.evidence_contract.minimum_independent_observers, input.evidence_contract.freshness_seconds, input.evidence_contract.minimum_assurance_level,
            json(input.evidence_contract.horizons), json(input.evidence_contract.falsification_conditions),
            json(input.evidence_contract.forbidden_effect_observers), input.evidence_contract.contract_digest],
        );
        for (const check of input.temporal_checks || []) {
          await client.query(
            `INSERT INTO core_temporal_checks (tenant_id,temporal_check_id,obligation_id,horizon,due_at)
             VALUES ($1,$2,$3,$4,$5)`,
            [input.tenant_id, check.temporal_check_id, input.obligation_id, check.horizon, check.due_at],
          );
        }
        return obligation;
      },
    });
  }

  async function bindActionLease(input) {
    return runProjectOperation({
      ...input, operation: "action_lease_bind", event_type: "ACTION_AUTHORIZED", request: input.verification,
      mutate: async (client) => {
        const existingLease = (await client.query(
          "SELECT 1 FROM core_action_lease_bindings WHERE tenant_id=$1 AND lease_id=$2 FOR SHARE",
          [input.tenant_id, input.lease_id],
        )).rows[0];
        if (existingLease) throw new CausalContinuityError("LEASE_REPLAYED");
        const change = rowOrNotFound(await client.query(
          "SELECT * FROM core_changes WHERE tenant_id=$1 AND change_id=$2 FOR UPDATE",
          [input.tenant_id, input.change_id],
        ));
        if (change.state !== "MODELED") throw new CausalContinuityError("CHANGE_STATE_INVALID");
        const obligations = (await client.query(
          "SELECT * FROM core_causal_obligations WHERE tenant_id=$1 AND obligation_id=ANY($2::uuid[]) ORDER BY obligation_id FOR UPDATE",
          [input.tenant_id, input.obligation_ids],
        )).rows;
        if (obligations.length !== input.obligation_ids.length || obligations.some((row) => row.project_id !== input.project_id || row.work_id !== input.work_id || row.change_id !== input.change_id || row.state !== "MODELED")) throw new CausalContinuityError("OBLIGATION_STATE_INVALID");
        const inserted = (await client.query(
          `INSERT INTO core_action_lease_bindings
            (tenant_id,lease_id,project_id,work_id,change_id,obligation_id,obligation_ids,authority_scope,lease_purpose,lease_surfaces,authority_binding_digest,verification_digest,verified_at,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14)
           ON CONFLICT (tenant_id,lease_id) DO NOTHING RETURNING *`,
          [input.tenant_id, input.lease_id, input.project_id, input.work_id, input.change_id, input.obligation_id,
            json(input.obligation_ids), json(input.authority_scope), input.lease_purpose, json(input.lease_surfaces), input.authority_binding_digest,
            input.verification_digest, input.verified_at, input.expires_at],
        )).rows[0];
        if (!inserted) throw new CausalContinuityError("LEASE_REPLAYED");
        await client.query("UPDATE core_changes SET state='AUTHORIZED',updated_at=clock_timestamp() WHERE tenant_id=$1 AND change_id=$2", [input.tenant_id, input.change_id]);
        await client.query(
          `INSERT INTO core_change_state_transitions (tenant_id,transition_id,change_id,from_state,to_state,reason,actor_provenance)
           VALUES ($1,$2,$3,'MODELED','AUTHORIZED','verified action lease',$4::jsonb)`,
          [input.tenant_id, input.change_transition_id, input.change_id, json(input.actor_provenance)],
        );
        for (const obligation of obligations) {
          await client.query("UPDATE core_causal_obligations SET state='AUTHORIZED',updated_at=clock_timestamp() WHERE tenant_id=$1 AND obligation_id=$2", [input.tenant_id, obligation.obligation_id]);
          await client.query(
            `INSERT INTO core_obligation_state_transitions (tenant_id,transition_id,obligation_id,from_state,to_state,reason,actor_provenance)
             VALUES ($1,$2,$3,'MODELED','AUTHORIZED','verified action lease',$4::jsonb)`,
            [input.tenant_id, input.obligation_transition_ids[obligation.obligation_id], obligation.obligation_id, json(input.actor_provenance)],
          );
        }
        return inserted;
      },
    });
  }

  async function readObligation(input, client = db) {
    return rowOrNotFound(await client.query(
      `SELECT o.*,ec.required_sources,ec.minimum_independence,ec.minimum_independent_observers,ec.freshness_seconds,
              ec.minimum_assurance_level,ec.horizons,ec.falsification_conditions,ec.forbidden_effect_observers,ec.contract_digest
         FROM core_causal_obligations o
         LEFT JOIN core_evidence_contracts ec ON ec.tenant_id=o.tenant_id AND ec.obligation_id=o.obligation_id
        WHERE o.tenant_id=$1 AND o.obligation_id=$2`,
      [requireText(input.tenant_id, "tenant_id", 120), requireUuid(input.obligation_id, "obligation_id")],
    ));
  }


  async function listObligations(input) {
    return (await db.query(
      "SELECT * FROM core_causal_obligations WHERE tenant_id=$1 AND project_id=$2 AND ($3::uuid IS NULL OR work_id=$3) ORDER BY created_at,obligation_id LIMIT $4",
      [input.tenant_id, input.project_id, input.work_id || null, Math.min(Number(input.limit) || 200, 200)],
    )).rows;
  }

  async function listTemporalChecks(input, client = db, { forUpdate = false } = {}) {
    return (await client.query(
      `SELECT * FROM core_temporal_checks WHERE tenant_id=$1 AND obligation_id=$2 ORDER BY due_at,temporal_check_id${forUpdate ? " FOR UPDATE" : ""}`,
      [requireText(input.tenant_id, "tenant_id", 120), requireUuid(input.obligation_id, "obligation_id")],
    )).rows;
  }

  async function readCapsuleSupport(input) {
    const limit = Math.max(1, Math.min(Number(input.limit) || 200, 200));
    const [gallery, artifacts, conflicts, temporal] = await Promise.all([
      db.query(`SELECT * FROM core_gallery_entity_bindings WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3
        ORDER BY core_event_sequence DESC LIMIT $4`, [input.tenant_id, input.project_id, input.work_id, limit]),
      db.query(`SELECT a.* FROM core_change_artifacts a JOIN core_changes c ON c.tenant_id=a.tenant_id AND c.change_id=a.change_id
        WHERE c.tenant_id=$1 AND c.project_id=$2 AND c.work_id=$3 ORDER BY a.created_at DESC,a.artifact_id LIMIT $4`, [input.tenant_id, input.project_id, input.work_id, limit]),
      db.query(`SELECT * FROM core_conflict_records WHERE tenant_id=$1 AND project_id=$2 AND (work_id=$3 OR work_id IS NULL)
        ORDER BY created_at DESC,conflict_id LIMIT $4`, [input.tenant_id, input.project_id, input.work_id, limit]),
      db.query(`SELECT t.* FROM core_temporal_checks t JOIN core_causal_obligations o ON o.tenant_id=t.tenant_id AND o.obligation_id=t.obligation_id
        WHERE o.tenant_id=$1 AND o.project_id=$2 AND o.work_id=$3 AND t.state='PENDING'
        ORDER BY t.due_at,t.temporal_check_id LIMIT $4`, [input.tenant_id, input.project_id, input.work_id, limit]),
    ]);
    return { gallery_bindings: gallery.rows, artifacts: artifacts.rows, conflicts: conflicts.rows, pending_temporal_checks: temporal.rows };
  }

  async function updateTemporalCheck(input) {
    const result = await db.query(
      `UPDATE core_temporal_checks SET state=$3,observation_id=$4,checked_at=clock_timestamp()
        WHERE tenant_id=$1 AND temporal_check_id=$2 RETURNING *`,
      [input.tenant_id, input.temporal_check_id, input.state, input.observation_id || null],
    );
    return rowOrNotFound(result);
  }

  async function updateObligation(input) {
    return runProjectOperation({
      ...input, operation: input.operation, event_type: input.event_type, request: input,
      mutate: async (client) => {
        const current = await readObligation(input, client);
        if (input.expected_states && !input.expected_states.includes(current.state)) {
          throw new CausalContinuityError("OBLIGATION_STATE_INVALID", `${current.state} cannot transition to ${input.state}`);
        }
        if (!stateEdgeAllowed(OBLIGATION_STATE_EDGES, current.state, input.state)) throw new CausalContinuityError("OBLIGATION_STATE_INVALID");
        const updated = (await client.query(
          `UPDATE core_causal_obligations SET state=$3,next_verification_at=$4,updated_at=clock_timestamp()
            WHERE tenant_id=$1 AND obligation_id=$2 RETURNING *`,
          [input.tenant_id, input.obligation_id, input.state, input.next_verification_at || current.next_verification_at],
        )).rows[0];
        await client.query(
          `INSERT INTO core_obligation_state_transitions (tenant_id,transition_id,obligation_id,from_state,to_state,reason,actor_provenance)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [input.tenant_id, input.transition_id, input.obligation_id, current.state, input.state, input.reason || input.operation, json(input.actor_provenance)],
        );
        return updated;
      },
    });
  }

  async function recordObservation(input) {
    return runProjectOperation({
      ...input, operation: "causal_observation_record", event_type: input.automatic_reopen ? "CLOSURE_REOPENED" : "EVIDENCE_RECORDED", request: input,
      mutate: async (client) => {
        const obligation = rowOrNotFound(await client.query(
          "SELECT * FROM core_causal_obligations WHERE tenant_id=$1 AND obligation_id=$2 FOR UPDATE",
          [input.tenant_id, input.obligation_id],
        ));
        const targetState = input.automatic_reopen
          ? "CONTRADICTED"
          : ["EXECUTED", "PARTIAL", "UNKNOWN"].includes(obligation.state) ? "OBSERVING" : obligation.state;
        if (targetState !== obligation.state && !stateEdgeAllowed(OBLIGATION_STATE_EDGES, obligation.state, targetState)) throw new CausalContinuityError("OBLIGATION_STATE_INVALID");
        if (!input.automatic_reopen && !["EXECUTED","OBSERVING","PARTIAL","UNKNOWN"].includes(obligation.state)) throw new CausalContinuityError("OBLIGATION_STATE_INVALID");
        const observation = (await client.query(
          `INSERT INTO core_reality_observations
          (tenant_id,observation_id,project_id,intent_revision_id,work_id,change_id,obligation_id,source,observer_identity,observer_role,provenance,independence,baseline,freshness_seconds,observed_at,evidence_digest,causal_relation,confidence,contradiction_status,observation_digest)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
          [input.tenant_id, input.observation_id, input.project_id, input.intent_revision_id, input.work_id, input.change_id,
          input.obligation_id, input.source, input.observer_identity, input.observer_role, json(input.provenance), input.independence,
          json(input.baseline), input.freshness_seconds, input.observed_at, input.evidence_digest, input.causal_relation,
          input.confidence, input.contradiction_status, input.observation_digest],
        )).rows[0];
        if (targetState !== obligation.state) {
          await client.query("UPDATE core_causal_obligations SET state=$3,updated_at=clock_timestamp() WHERE tenant_id=$1 AND obligation_id=$2", [input.tenant_id, input.obligation_id, targetState]);
          await client.query(
            `INSERT INTO core_obligation_state_transitions (tenant_id,transition_id,obligation_id,from_state,to_state,reason,actor_provenance)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
            [input.tenant_id, input.transition_id, input.obligation_id, obligation.state, targetState, input.automatic_reopen ? "contradictory evidence" : "first observation", json(input.actor_provenance)],
          );
        }
        return { ...observation, obligation_reopened: input.automatic_reopen === true };
      },
    });
  }

  async function listObservations(input) {
    return (await db.query(
      "SELECT * FROM core_reality_observations WHERE tenant_id=$1 AND obligation_id=$2 ORDER BY observed_at,observation_id LIMIT $3",
      [requireText(input.tenant_id, "tenant_id", 120), requireUuid(input.obligation_id, "obligation_id"), Math.min(Number(input.limit) || 200, 200)],
    )).rows;
  }

  async function saveReconciliation(input) {
    return runProjectOperation({
      ...input, operation: "causal_reconcile", event_type: "OUTCOME_RECONCILED", request: input,
      mutate: async (client) => {
        const obligation = rowOrNotFound(await client.query(
          "SELECT * FROM core_causal_obligations WHERE tenant_id=$1 AND obligation_id=$2 FOR UPDATE",
          [input.tenant_id, input.obligation_id],
        ));
        if (!stateEdgeAllowed(OBLIGATION_STATE_EDGES, obligation.state, input.verdict)) throw new CausalContinuityError("OBLIGATION_STATE_INVALID");
        const reconciliation = (await client.query(
          `INSERT INTO core_causal_reconciliations
          (tenant_id,reconciliation_id,project_id,intent_revision_id,work_id,change_id,obligation_id,observation_ids,reconciliation_payload,verdict,achieved_assurance_level,reconciliation_digest)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12) RETURNING *`,
        [input.tenant_id, input.reconciliation_id, input.project_id, input.intent_revision_id, input.work_id, input.change_id,
          input.obligation_id, json(input.observation_ids), json(input.reconciliation_payload), input.verdict,
          input.achieved_assurance_level, input.reconciliation_digest],
        )).rows[0];
        await client.query("UPDATE core_causal_obligations SET state=$3,updated_at=clock_timestamp() WHERE tenant_id=$1 AND obligation_id=$2", [input.tenant_id, input.obligation_id, input.verdict]);
        await client.query(
          `INSERT INTO core_obligation_state_transitions (tenant_id,transition_id,obligation_id,from_state,to_state,reason,actor_provenance)
           VALUES ($1,$2,$3,$4,$5,'server-side causal reconciliation',$6::jsonb)`,
          [input.tenant_id, input.transition_id, input.obligation_id, obligation.state, input.verdict, json(input.actor_provenance)],
        );
        return reconciliation;
      },
    });
  }

  async function readReconciliation(input) {
    return rowOrNotFound(await db.query(
      "SELECT * FROM core_causal_reconciliations WHERE tenant_id=$1 AND reconciliation_id=$2",
      [input.tenant_id, input.reconciliation_id],
    ));
  }

  async function saveReceipt(input) {
    return runProjectOperation({
      ...input, operation: "causal_close_receipt", event_type: input.closure_state === "VERIFIED_FINAL" ? "CLOSURE_FINAL" : "CLOSURE_PROVISIONAL", request: input.receipt_payload,
      mutate: async (client) => (await client.query(
        `INSERT INTO core_outcome_receipts
          (tenant_id,outcome_receipt_id,project_id,obligation_id,reconciliation_id,receipt_payload,receipt_digest,closure_state)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *`,
        [input.tenant_id, input.outcome_receipt_id, input.project_id, input.obligation_id, input.reconciliation_id,
          json(input.receipt_payload), input.receipt_digest, input.closure_state],
      )).rows[0],
    });
  }

  async function closeObligationAtomic(input) {
    return runProjectOperation({
      ...input, operation: "causal_close", event_type: input.closure_state === "VERIFIED_FINAL" ? "CLOSURE_FINAL" : "CLOSURE_PROVISIONAL", request: input.receipt_payload,
      mutate: async (client) => {
        const obligation = rowOrNotFound(await client.query(
          "SELECT * FROM core_causal_obligations WHERE tenant_id=$1 AND obligation_id=$2 FOR UPDATE",
          [input.tenant_id, input.obligation_id],
        ));
        const reconciliation = rowOrNotFound(await client.query(
          "SELECT * FROM core_causal_reconciliations WHERE tenant_id=$1 AND reconciliation_id=$2",
          [input.tenant_id, input.reconciliation_id],
        ));
        if (!input.expected_states.includes(obligation.state) || reconciliation.obligation_id !== obligation.obligation_id ||
            reconciliation.reconciliation_digest !== input.reconciliation_digest ||
            !["VERIFIED_PROVISIONAL", "VERIFIED_FINAL"].includes(reconciliation.verdict)) {
          throw new CausalContinuityError("EVIDENCE_CONTRACT_UNSATISFIED");
        }
        const contradiction = (await client.query(
          `SELECT 1 FROM core_reality_observations
            WHERE tenant_id=$1 AND obligation_id=$2 AND contradiction_status='CONFIRMED'
              AND created_at>$3 LIMIT 1`,
          [input.tenant_id, input.obligation_id, reconciliation.created_at],
        )).rows[0];
        if (contradiction) throw new CausalContinuityError("EVIDENCE_CONTRACT_UNSATISFIED", "Contradictory evidence arrived after reconciliation");
        if (input.closure_state === "VERIFIED_FINAL") {
          const checks = await listTemporalChecks(input, client, { forUpdate: true });
          const databaseNow = new Date((await client.query("SELECT clock_timestamp() AS now")).rows[0].now).getTime();
          if (!checks.length || checks.some((check) => check.state !== "SATISFIED" || new Date(check.due_at).getTime() > databaseNow)) {
            throw new CausalContinuityError("TEMPORAL_CHECKS_PENDING");
          }
          if (!stateEdgeAllowed(OBLIGATION_STATE_EDGES, obligation.state, "VERIFIED_FINAL")) throw new CausalContinuityError("OBLIGATION_STATE_INVALID");
        }
        const updated = (await client.query(
          `UPDATE core_causal_obligations SET state=$3,updated_at=clock_timestamp()
            WHERE tenant_id=$1 AND obligation_id=$2 RETURNING *`,
          [input.tenant_id, input.obligation_id, input.closure_state],
        )).rows[0];
        const receipt = (await client.query(
          `INSERT INTO core_outcome_receipts
            (tenant_id,outcome_receipt_id,project_id,obligation_id,reconciliation_id,receipt_payload,receipt_digest,closure_state)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *`,
          [input.tenant_id, input.outcome_receipt_id, input.project_id, input.obligation_id, input.reconciliation_id,
            json(input.receipt_payload), input.receipt_digest, input.closure_state],
        )).rows[0];
        if (input.closure_state !== obligation.state) {
          await client.query(
            `INSERT INTO core_obligation_state_transitions (tenant_id,transition_id,obligation_id,from_state,to_state,reason,actor_provenance)
             VALUES ($1,$2,$3,$4,$5,'evidence contract closure',$6::jsonb)`,
            [input.tenant_id, input.transition_id, input.obligation_id, obligation.state, input.closure_state, json(input.actor_provenance)],
          );
        }
        return { obligation: updated, outcome_receipt: receipt };
      },
    });
  }

  async function saveContext(input) {
    return runProjectOperation({
      ...input, operation: "causal_context_issue", event_type: "CONTEXT_ISSUED", request: input.envelope,
      mutate: async (client) => (await client.query(
        `INSERT INTO core_causal_contexts
          (tenant_id,context_id,project_id,work_id,change_id,context_digest,envelope,signature,enforcement_mode,issued_at,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11) RETURNING *`,
        [input.tenant_id, input.context_id, input.project_id, input.work_id, input.change_id, input.context_digest,
          json(input.envelope), json(input.signature), input.enforcement_mode, input.issued_at, input.expires_at],
      )).rows[0],
    });
  }

  async function readContext(input) {
    return rowOrNotFound(await db.query(
      "SELECT * FROM core_causal_contexts WHERE tenant_id=$1 AND context_digest=$2",
      [requireText(input.tenant_id, "tenant_id", 120), input.context_digest],
    ));
  }

  async function consumeNonce(input) {
    const persisted = await readContext(input);
    const result = await db.query(
      `INSERT INTO core_consumed_nonces (tenant_id,project_id,context_id,issuer_id,nonce_digest,context_digest,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING nonce_digest`,
      [input.tenant_id, persisted.project_id, persisted.context_id, input.issuer_id, input.nonce_digest, input.context_digest, input.expires_at],
    );
    if (!result.rows[0]) throw new CausalContinuityError("CONTEXT_REPLAYED");
    return { consumed: true };
  }

  async function consumeContextAtomic(input) {
    const tenantId = requireText(input.tenant_id, "tenant_id", 120);
    const projectId = requireUuid(input.project_id, "project_id");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const [lockA, lockB] = projectLockParts(tenantId, projectId);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [lockA, lockB]);
      const project = rowOrNotFound(await client.query(
        "SELECT * FROM core_projects WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE",
        [tenantId, projectId],
      ));
      const persisted = rowOrNotFound(await client.query(
        `SELECT *,clock_timestamp() AS database_now
           FROM core_causal_contexts
          WHERE tenant_id=$1 AND context_digest=$2 FOR UPDATE`,
        [tenantId, input.context_digest],
      ));
      if (persisted.project_id !== projectId || persisted.work_id !== input.work_id || persisted.change_id !== input.change_id) {
        throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
      }
      if (project.active_state_digest !== input.project_state_digest) {
        throw new CausalContinuityError("STALE_PROJECT_STATE", "Project state advanced before context consume", { current_state_digest: project.active_state_digest });
      }
      const databaseNow = new Date(persisted.database_now).getTime();
      if (databaseNow < new Date(input.issued_at).getTime() || databaseNow >= new Date(input.expires_at).getTime()) {
        throw new CausalContinuityError("CONTEXT_EXPIRED");
      }
      if (persisted.consumed_at) throw new CausalContinuityError("CONTEXT_REPLAYED");
      const nonce = await client.query(
        `INSERT INTO core_consumed_nonces (tenant_id,project_id,context_id,issuer_id,nonce_digest,context_digest,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING nonce_digest`,
        [tenantId, projectId, persisted.context_id, input.issuer_id, input.nonce_digest, input.context_digest, input.expires_at],
      );
      if (!nonce.rows[0]) throw new CausalContinuityError("CONTEXT_REPLAYED");
      const previous = (await client.query(
        `SELECT sequence_number,event_hash FROM core_causal_event_ledger
          WHERE tenant_id=$1 AND project_id=$2 ORDER BY sequence_number DESC LIMIT 1`,
        [tenantId, projectId],
      )).rows[0];
      const sequence = Number(previous?.sequence_number || 0) + 1;
      const eventId = crypto.randomUUID();
      const payload = { schema_version: "causal_event_payload_v1", result: { context_digest: input.context_digest, consumed: true } };
      const payloadDigest = causalDigest(payload);
      const requestDigest = causalDigest({ context_digest: input.context_digest, nonce_digest: input.nonce_digest, actor_provenance_digest: input.actor_provenance_digest });
      const eventHash = buildCausalEventHash({
        tenant_id: tenantId, project_id: projectId, event_id: eventId, sequence_number: sequence,
        event_type: "CONTEXT_CONSUMED", operation: "causal_context_consume", idempotency_key: input.context_digest,
        request_digest: requestDigest, payload_digest: payloadDigest, actor_provenance: input.actor_provenance || {},
        previous_event_hash: previous?.event_hash || null,
      });
      await client.query(
        `INSERT INTO core_causal_event_ledger
          (tenant_id,project_id,event_id,sequence_number,event_type,operation,idempotency_key,request_digest,payload,payload_digest,actor_provenance,actor_provenance_digest,previous_event_hash,event_hash)
         VALUES ($1,$2,$3,$4,'CONTEXT_CONSUMED','causal_context_consume',$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12)`,
        [tenantId, projectId, eventId, sequence, input.context_digest, requestDigest, json(payload), payloadDigest,
          json(input.actor_provenance || {}), causalDigest(input.actor_provenance || {}), previous?.event_hash || null, eventHash],
      );
      const outboxPayload = { event_id: eventId, sequence_number: sequence, event_type: "CONTEXT_CONSUMED", result: payload.result };
      await client.query(
        `INSERT INTO core_causal_projection_outbox
          (tenant_id,outbox_id,project_id,event_id,projection_type,payload,payload_digest)
         VALUES ($1,$2,$3,$4,'CAUSAL_TIMELINE',$5::jsonb,$6)`,
        [tenantId, crypto.randomUUID(), projectId, eventId, json(outboxPayload), causalDigest(outboxPayload)],
      );
      await client.query(
        "UPDATE core_causal_contexts SET consumed_at=clock_timestamp() WHERE tenant_id=$1 AND context_digest=$2",
        [tenantId, input.context_digest],
      );
      await client.query("COMMIT");
      return { consumed: true, context_digest: input.context_digest, event_id: eventId, sequence_number: sequence, event_hash: eventHash };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* original error wins */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async function saveCapsule(input) {
    return runProjectOperation({
      ...input, operation: "continuity_capsule_build", event_type: "CONTINUITY_CAPSULE_BUILT", request: input.capsule,
      mutate: async (client) => (await client.query(
        `INSERT INTO core_causal_continuity_capsules
          (tenant_id,capsule_id,project_id,work_id,generated_from_event_sequence,capsule_payload,capsule_digest)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`,
        [input.tenant_id, input.capsule_id, input.project_id, input.work_id, input.generated_from_event_sequence,
          json(input.capsule), input.capsule_digest],
      )).rows[0],
    });
  }

  async function latestCapsule(input) {
    return rowOrNotFound(await db.query(
      `SELECT * FROM core_causal_continuity_capsules
        WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3
        ORDER BY generated_from_event_sequence DESC LIMIT 1`,
      [input.tenant_id, input.project_id, input.work_id],
    ));
  }

  async function timeline(input) {
    const limit = Math.min(Number(input.limit) || 200, 200);
    const before = input.before_sequence ? Number(input.before_sequence) : Number.MAX_SAFE_INTEGER;
    return (await db.query(
      `SELECT * FROM core_causal_event_ledger
        WHERE tenant_id=$1 AND project_id=$2 AND sequence_number<$3
        ORDER BY sequence_number DESC LIMIT $4`,
      [input.tenant_id, input.project_id, before, limit],
    )).rows.reverse();
  }

  async function createGalleryBinding(input) {
    return runProjectOperation({
      ...input,
      operation: "gallery_binding_project",
      event_type: "GALLERY_ITEM_BOUND",
      projection_type: "GALLERY_BINDING",
      request: input,
      mutate: async (client, event) => {
        const project = rowOrNotFound(await client.query(
          "SELECT * FROM core_projects WHERE tenant_id=$1 AND project_id=$2 FOR UPDATE",
          [input.tenant_id, input.project_id],
        ));
        if (!project.active_state_digest || project.active_state_digest !== input.project_state_digest) {
          throw new CausalContinuityError("STALE_PROJECT_STATE");
        }
        const work = rowOrNotFound(await client.query(
          `SELECT * FROM core_work_causal_bindings
            WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3
              AND genesis_intent_id=$4 AND intent_revision_id=$5 FOR SHARE`,
          [input.tenant_id, input.project_id, input.work_id, input.genesis_intent_id, input.intent_revision_id],
        ));
        if (input.change_id) {
          rowOrNotFound(await client.query(
            "SELECT 1 FROM core_changes WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3 AND change_id=$4 FOR SHARE",
            [input.tenant_id, input.project_id, input.work_id, input.change_id],
          ));
        }
        const context = rowOrNotFound(await client.query(
          `SELECT *,clock_timestamp() AS database_now FROM core_causal_contexts
            WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3
              AND change_id IS NOT DISTINCT FROM $4 AND context_digest=$5 FOR SHARE`,
          [input.tenant_id, input.project_id, input.work_id, input.change_id || null, input.context_digest],
        ));
        if (new Date(context.expires_at).getTime() <= new Date(context.database_now).getTime()) {
          throw new CausalContinuityError("CONTEXT_EXPIRED");
        }
        const envelope = context.envelope || {};
        if (envelope.genesis_intent_id !== input.genesis_intent_id || envelope.intent_revision_id !== input.intent_revision_id ||
            envelope.project_state_digest !== input.project_state_digest || envelope.work_id !== input.work_id ||
            envelope.change_id !== input.change_id) throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
        const envelopeObligations = new Set(envelope.obligation_ids || []);
        if (input.obligation_ids.some((id) => !envelopeObligations.has(id))) throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
        if (input.obligation_ids.length) {
          const obligations = await client.query(
            `SELECT obligation_id FROM core_causal_obligations
              WHERE tenant_id=$1 AND project_id=$2 AND work_id=$3
                AND change_id IS NOT DISTINCT FROM $4 AND obligation_id=ANY($5::uuid[]) FOR SHARE`,
            [input.tenant_id, input.project_id, input.work_id, input.change_id || null, input.obligation_ids],
          );
          if (obligations.rows.length !== input.obligation_ids.length) throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
        }
        const row = {
          tenant_id: input.tenant_id, binding_id: input.binding_id, project_id: input.project_id,
          project_state_digest: input.project_state_digest, genesis_intent_id: work.genesis_intent_id,
          intent_revision_id: work.intent_revision_id, work_id: input.work_id, change_id: input.change_id || null,
          obligation_ids: input.obligation_ids, entity_type: input.entity_type, ticket_id: input.ticket_id,
          parent_ticket_id: input.parent_ticket_id || null, core_event_sequence: event.sequence_number,
          context_digest: input.context_digest, provenance: input.provenance || {}, status: "PENDING",
        };
        row.binding_digest = buildGalleryBindingDigest(row);
        const existing = (await client.query(
          "SELECT * FROM core_gallery_entity_bindings WHERE tenant_id=$1 AND entity_type=$2 AND ticket_id=$3 FOR UPDATE",
          [input.tenant_id, input.entity_type, input.ticket_id],
        )).rows[0];
        if (existing) {
          if (existing.binding_digest !== row.binding_digest) throw new CausalContinuityError("IDEMPOTENCY_CONFLICT");
          return existing;
        }
        return (await client.query(
          `INSERT INTO core_gallery_entity_bindings
            (tenant_id,binding_id,project_id,project_state_digest,genesis_intent_id,intent_revision_id,work_id,change_id,
             obligation_ids,entity_type,ticket_id,parent_ticket_id,core_event_sequence,context_digest,provenance,status,binding_digest)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15::jsonb,'PENDING',$16) RETURNING *`,
          [row.tenant_id, row.binding_id, row.project_id, row.project_state_digest, row.genesis_intent_id,
            row.intent_revision_id, row.work_id, row.change_id, json(row.obligation_ids), row.entity_type,
            row.ticket_id, row.parent_ticket_id, row.core_event_sequence, row.context_digest, json(row.provenance), row.binding_digest],
        )).rows[0];
      },
    });
  }

  async function claimGalleryProjection(input) {
    const tenantId = requireText(input.tenant_id, "tenant_id", 120);
    const projectId = input.project_id ? requireUuid(input.project_id, "project_id") : null;
    const workerId = requireText(input.worker_id, "worker_id", 160);
    const limit = Math.max(1, Math.min(Number(input.limit) || 20, 50));
    const leaseSeconds = Math.max(5, Math.min(Number(input.lease_seconds) || 30, 300));
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE core_causal_projection_outbox
            SET state=CASE WHEN attempts>=max_attempts THEN 'QUARANTINED' ELSE 'RETRY_WAIT' END,
                 claimed_by=NULL,lease_expires_at=NULL,
                 available_at=clock_timestamp(),last_error_code='CLAIM_LEASE_EXPIRED'
          WHERE tenant_id=$1 AND projection_type='GALLERY_BINDING' AND state='CLAIMED'
            AND lease_expires_at<=clock_timestamp() AND ($2::uuid IS NULL OR project_id=$2)`,
        [tenantId, projectId],
      );
      await client.query(
        `UPDATE core_causal_projection_outbox
            SET state='QUARANTINED',claimed_by=NULL,lease_expires_at=NULL,last_error_code='GALLERY_ATTEMPT_LIMIT_REACHED'
          WHERE tenant_id=$1 AND projection_type='GALLERY_BINDING' AND state IN ('PENDING','RETRY_WAIT')
            AND attempts>=max_attempts AND ($2::uuid IS NULL OR project_id=$2)`,
        [tenantId, projectId],
      );
      const claimed = await client.query(
        `WITH candidates AS (
           SELECT tenant_id,outbox_id FROM core_causal_projection_outbox
            WHERE tenant_id=$1 AND projection_type='GALLERY_BINDING'
              AND state IN ('PENDING','RETRY_WAIT') AND available_at<=clock_timestamp()
              AND attempts<max_attempts
              AND ($2::uuid IS NULL OR project_id=$2)
            ORDER BY available_at,outbox_id FOR UPDATE SKIP LOCKED LIMIT $3
         )
         UPDATE core_causal_projection_outbox o
            SET state='CLAIMED',attempts=attempts+1,claimed_by=$4,
                last_attempt_at=clock_timestamp(),lease_expires_at=clock_timestamp()+($5::int*interval '1 second')
           FROM candidates c WHERE o.tenant_id=c.tenant_id AND o.outbox_id=c.outbox_id
         RETURNING o.*`,
        [tenantId, projectId, limit, workerId, leaseSeconds],
      );
      const rows = [];
      for (const outbox of claimed.rows) {
        const joined = (await client.query(
          `SELECT b.*,e.event_id,e.event_type,e.operation,e.idempotency_key,e.request_digest,e.payload AS event_payload,
                  e.payload_digest,e.actor_provenance,e.previous_event_hash,e.event_hash,
                  o.outbox_id,o.payload AS outbox_payload,o.payload_digest AS outbox_payload_digest,
                  o.attempts,o.max_attempts,o.lease_expires_at,o.claimed_by
             FROM core_causal_projection_outbox o
             JOIN core_causal_event_ledger e ON e.tenant_id=o.tenant_id AND e.project_id=o.project_id AND e.event_id=o.event_id
             JOIN core_gallery_entity_bindings b ON b.tenant_id=o.tenant_id AND b.project_id=o.project_id AND b.core_event_sequence=e.sequence_number
            WHERE o.tenant_id=$1 AND o.outbox_id=$2`,
          [tenantId, outbox.outbox_id],
        )).rows[0];
        if (!joined) {
          await client.query(
            "UPDATE core_causal_projection_outbox SET state='QUARANTINED',claimed_by=NULL,lease_expires_at=NULL,last_error_code='ORPHAN_GALLERY_ITEM' WHERE tenant_id=$1 AND outbox_id=$2",
            [tenantId, outbox.outbox_id],
          );
          continue;
        }
        rows.push(joined);
      }
      await client.query("COMMIT");
      return rows;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve primary error */ }
      throw error;
    } finally { client.release(); }
  }

  async function completeGalleryProjection(input) {
    const tenantId = requireText(input.tenant_id, "tenant_id", 120);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const outbox = rowOrNotFound(await client.query(
        "SELECT *,clock_timestamp() AS database_now FROM core_causal_projection_outbox WHERE tenant_id=$1 AND outbox_id=$2 FOR UPDATE",
        [tenantId, input.outbox_id],
      ));
      const readbackDigest = causalDigest(galleryReadbackPayload(input.readback));
      if (outbox.state === "DELIVERED") {
        const prior = rowOrNotFound(await client.query(
          "SELECT * FROM core_gallery_entity_bindings WHERE tenant_id=$1 AND project_id=$2 AND core_event_sequence=(SELECT sequence_number FROM core_causal_event_ledger WHERE tenant_id=$1 AND project_id=$2 AND event_id=$3)",
          [tenantId, outbox.project_id, outbox.event_id],
        ));
        if (prior.last_readback_digest !== readbackDigest) throw new CausalContinuityError("IDEMPOTENCY_CONFLICT");
        await client.query("COMMIT");
        return { delivered: true, replayed: true, binding: prior };
      }
      if (outbox.state !== "CLAIMED" || outbox.claimed_by !== input.worker_id || new Date(outbox.lease_expires_at).getTime() <= new Date(outbox.database_now).getTime()) {
        throw new CausalContinuityError("GALLERY_CLAIM_INVALID");
      }
      const event = rowOrNotFound(await client.query(
        "SELECT * FROM core_causal_event_ledger WHERE tenant_id=$1 AND project_id=$2 AND event_id=$3 FOR SHARE",
        [tenantId, outbox.project_id, outbox.event_id],
      ));
      const binding = rowOrNotFound(await client.query(
        "SELECT * FROM core_gallery_entity_bindings WHERE tenant_id=$1 AND project_id=$2 AND core_event_sequence=$3 FOR UPDATE",
        [tenantId, outbox.project_id, event.sequence_number],
      ));
      const expectedHash = buildCausalEventHash({ ...event, sequence_number: Number(event.sequence_number) });
      const expected = { ...galleryBindingPayload(binding), binding_digest: binding.binding_digest, core_event_hash: event.event_hash };
      const exact = causalDigest(outbox.payload) === outbox.payload_digest &&
        causalDigest(event.payload) === event.payload_digest && expectedHash === event.event_hash &&
        causalDigest(galleryReadbackPayload(input.readback)) === causalDigest(expected);
      if (!exact) {
        await client.query(
          "UPDATE core_gallery_entity_bindings SET status='ORPHAN_GALLERY_ITEM',last_readback_digest=$3,last_verified_at=clock_timestamp() WHERE tenant_id=$1 AND binding_id=$2",
          [tenantId, binding.binding_id, readbackDigest],
        );
        await client.query(
          "UPDATE core_causal_projection_outbox SET state='QUARANTINED',claimed_by=NULL,lease_expires_at=NULL,last_error_code='GALLERY_READBACK_MISMATCH' WHERE tenant_id=$1 AND outbox_id=$2",
          [tenantId, outbox.outbox_id],
        );
        await client.query("COMMIT");
        return { delivered: false, status: "ORPHAN_GALLERY_ITEM" };
      }
      const updated = rowOrNotFound(await client.query(
        `UPDATE core_gallery_entity_bindings SET status='ACTIVE',last_readback_digest=$3,
                first_verified_at=COALESCE(first_verified_at,clock_timestamp()),last_verified_at=clock_timestamp()
          WHERE tenant_id=$1 AND binding_id=$2 RETURNING *`,
        [tenantId, binding.binding_id, readbackDigest],
      ));
      await client.query(
        "UPDATE core_causal_projection_outbox SET state='DELIVERED',claimed_by=NULL,lease_expires_at=NULL,delivered_at=clock_timestamp(),last_error_code=NULL WHERE tenant_id=$1 AND outbox_id=$2",
        [tenantId, outbox.outbox_id],
      );
      await client.query("COMMIT");
      return { delivered: true, replayed: false, binding: updated, event_hash: event.event_hash };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve primary error */ }
      throw error;
    } finally { client.release(); }
  }

  async function failGalleryProjection(input) {
    const delay = Math.max(1, Math.min(Number(input.retry_after_seconds) || 5, 300));
    const result = await db.query(
      `UPDATE core_causal_projection_outbox
          SET state=CASE WHEN attempts>=max_attempts THEN 'QUARANTINED' ELSE 'RETRY_WAIT' END,
              claimed_by=NULL,lease_expires_at=NULL,available_at=clock_timestamp()+($5::int*interval '1 second'),
              last_error_code=$4
        WHERE tenant_id=$1 AND outbox_id=$2 AND state='CLAIMED' AND claimed_by=$3
        RETURNING state,attempts,max_attempts,available_at,last_error_code`,
      [requireText(input.tenant_id, "tenant_id", 120), input.outbox_id, requireText(input.worker_id, "worker_id", 160), requireText(input.error_code, "error_code", 120), delay],
    );
    if (!result.rows[0]) throw new CausalContinuityError("GALLERY_CLAIM_INVALID");
    return result.rows[0];
  }

  async function readGalleryCausalView(input) {
    const typeMap = {
      intent_evolution: ["INTENT_REVISION"], decision_history: ["ARCHITECTURE_DECISION"], work_graph: ["WORK"],
      change_timeline: ["CHANGE"], evidence: ["EVIDENCE", "VERIFICATION"],
      closure: ["CLOSURE", "REOPENING", "OUTCOME", "REMEDIATION", "ROLLBACK"],
    };
    const limit = Math.max(1, Math.min(Number(input.limit) || 50, 200));
    const before = input.before_sequence ? Number(input.before_sequence) : Number.MAX_SAFE_INTEGER;
    const types = typeMap[input.view] || null;
    const rows = (await db.query(
      `SELECT b.*,e.event_hash,e.event_type,e.created_at AS event_created_at
         FROM core_gallery_entity_bindings b JOIN core_causal_event_ledger e
           ON e.tenant_id=b.tenant_id AND e.project_id=b.project_id AND e.sequence_number=b.core_event_sequence
        WHERE b.tenant_id=$1 AND b.project_id=$2 AND b.core_event_sequence<$3
          AND ($4::text[] IS NULL OR b.entity_type=ANY($4::text[]))
        ORDER BY b.core_event_sequence DESC LIMIT $5`,
      [input.tenant_id, input.project_id, before, types, limit],
    )).rows;
    return { view: input.view, items: rows, next_before_sequence: rows.length === limit ? Number(rows.at(-1).core_event_sequence) : null };
  }

  async function metricsSnapshot(input) {
    const result = await db.query(
      `SELECT
         (SELECT count(*) FROM core_work_causal_bindings w WHERE w.tenant_id=$1 AND w.project_id=$2 AND w.legacy_binding_state='VERIFIED') AS works_with_lineage,
         (SELECT count(*) FROM core_changes c WHERE c.tenant_id=$1 AND c.project_id=$2 AND c.state NOT IN ('CLOSED','ROLLED_BACK','VERIFIED_FINAL')) AS open_changes,
         (SELECT count(*) FROM core_causal_obligations o WHERE o.tenant_id=$1 AND o.project_id=$2 AND o.state NOT IN ('CLOSED','ROLLED_BACK')) AS open_obligations,
         (SELECT count(*) FROM core_causal_obligations o WHERE o.tenant_id=$1 AND o.project_id=$2 AND o.state IN ('VERIFIED_PROVISIONAL','VERIFIED_FINAL','CLOSED')) AS verified_obligations,
         (SELECT count(*) FROM core_gallery_entity_bindings g WHERE g.tenant_id=$1 AND g.project_id=$2 AND g.status IN ('ORPHAN_GALLERY_ITEM','QUARANTINED')) AS orphan_gallery_items,
         (SELECT count(*) FROM core_causal_projection_outbox x WHERE x.tenant_id=$1 AND x.project_id=$2 AND x.projection_type='GALLERY_BINDING' AND x.state IN ('PENDING','CLAIMED','RETRY_WAIT')) AS gallery_projection_pending,
         (SELECT count(*) FROM core_causal_projection_outbox x WHERE x.tenant_id=$1 AND x.project_id=$2 AND x.projection_type='GALLERY_BINDING' AND x.state='QUARANTINED') AS gallery_projection_quarantined,
         (SELECT count(*) FROM core_causal_event_ledger e WHERE e.tenant_id=$1 AND e.project_id=$2) AS ledger_events,
         (SELECT COALESCE(max(sequence_number),0) FROM core_causal_event_ledger e WHERE e.tenant_id=$1 AND e.project_id=$2) AS ledger_sequence,
         (SELECT count(*) FROM core_changes c WHERE c.tenant_id=$1 AND c.project_id=$2 AND c.state='EXECUTED') AS changes_executed,
         (SELECT count(*) FROM core_causal_obligations o WHERE o.tenant_id=$1 AND o.project_id=$2 AND o.state='OBSERVING') AS obligations_observing,
         (SELECT count(*) FROM core_causal_obligations o WHERE o.tenant_id=$1 AND o.project_id=$2 AND o.state='VERIFIED_FINAL') AS obligations_verified_final,
         (SELECT count(*) FROM core_change_state_transitions t JOIN core_changes c ON c.tenant_id=t.tenant_id AND c.change_id=t.change_id WHERE c.tenant_id=$1 AND c.project_id=$2) AS change_transitions,
         (SELECT count(*) FROM core_obligation_state_transitions t JOIN core_causal_obligations o ON o.tenant_id=t.tenant_id AND o.obligation_id=t.obligation_id WHERE o.tenant_id=$1 AND o.project_id=$2) AS obligation_transitions,
         (SELECT count(*) FROM core_conflict_records c WHERE c.tenant_id=$1 AND c.project_id=$2 AND c.state='OPEN') AS open_conflicts,
         (SELECT count(*) FROM core_temporal_checks t JOIN core_causal_obligations o ON o.tenant_id=t.tenant_id AND o.obligation_id=t.obligation_id WHERE o.tenant_id=$1 AND o.project_id=$2 AND t.state='PENDING') AS pending_temporal_checks`,
      [input.tenant_id, input.project_id],
    );
    const metrics = Object.fromEntries(Object.entries(result.rows[0] || {}).map(([name, value]) => [name, Number(value)]));
    return { tenant_id: input.tenant_id, project_id: input.project_id, metrics, observed_at: now().toISOString() };
  }

  async function verifyGalleryBinding(input) {
    const tenantId = requireText(input.tenant_id, "tenant_id", 120);
    const ticketId = requireText(input.ticket_id, "ticket_id", 240);
    const client = await db.connect();
    let verified = null;
    let integrityFailed = false;
    try {
      await client.query("BEGIN");
      const bindings = (await client.query(
        "SELECT * FROM core_gallery_entity_bindings WHERE tenant_id=$1 AND ticket_id=$2 FOR UPDATE",
        [tenantId, ticketId],
      )).rows;
      if (bindings.length !== 1 || bindings[0].status !== "ACTIVE") {
        if (bindings.length > 1) {
          await client.query(
            "UPDATE core_gallery_entity_bindings SET status='QUARANTINED',last_verified_at=clock_timestamp() WHERE tenant_id=$1 AND ticket_id=$2 AND status='ACTIVE'",
            [tenantId, ticketId],
          );
          await client.query("COMMIT");
          integrityFailed = true;
        } else {
          await client.query("ROLLBACK");
          throw new CausalContinuityError("ORPHAN_GALLERY_ITEM");
        }
      } else {
        const binding = bindings[0];
        const event = (await client.query(
          "SELECT * FROM core_causal_event_ledger WHERE tenant_id=$1 AND project_id=$2 AND sequence_number=$3 FOR SHARE",
          [tenantId, binding.project_id, binding.core_event_sequence],
        )).rows[0] || null;
        const outbox = event ? (await client.query(
          "SELECT * FROM core_causal_projection_outbox WHERE tenant_id=$1 AND project_id=$2 AND event_id=$3 AND projection_type='GALLERY_BINDING' FOR UPDATE",
          [tenantId, binding.project_id, event.event_id],
        )).rows[0] || null : null;
        const context = (await client.query(
          "SELECT * FROM core_causal_contexts WHERE tenant_id=$1 AND context_digest=$2 FOR SHARE",
          [tenantId, binding.context_digest],
        )).rows[0] || null;
        const previous = event && Number(event.sequence_number) > 1 ? (await client.query(
          "SELECT event_hash FROM core_causal_event_ledger WHERE tenant_id=$1 AND project_id=$2 AND sequence_number=$3 FOR SHARE",
          [tenantId, binding.project_id, Number(event.sequence_number) - 1],
        )).rows[0] || null : null;
        if (!galleryIntegrityValid({ binding, event, outbox, context, previous })) {
          await client.query(
            "UPDATE core_gallery_entity_bindings SET status='QUARANTINED',last_verified_at=clock_timestamp() WHERE tenant_id=$1 AND binding_id=$2",
            [tenantId, binding.binding_id],
          );
          if (outbox) {
            await client.query(
              "UPDATE core_causal_projection_outbox SET state='QUARANTINED',last_error_code='GALLERY_POST_ACTIVATION_INTEGRITY_MISMATCH' WHERE tenant_id=$1 AND outbox_id=$2",
              [tenantId, outbox.outbox_id],
            );
          }
          await client.query("COMMIT");
          integrityFailed = true;
        } else {
          await client.query(
            "UPDATE core_gallery_entity_bindings SET last_verified_at=clock_timestamp() WHERE tenant_id=$1 AND binding_id=$2",
            [tenantId, binding.binding_id],
          );
          await client.query("COMMIT");
          verified = { ...binding, event_hash: event.event_hash };
        }
      }
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve primary error */ }
      throw error;
    } finally { client.release(); }
    if (integrityFailed) throw new CausalContinuityError("GALLERY_INTEGRITY_MISMATCH");
    return verified;
  }

  async function readFeatureFlag(input) {
    return rowOrNotFound(await db.query(
      `SELECT tenant_id,project_id,mode,version,updated_at
         FROM core_causal_feature_flags
        WHERE tenant_id=$1 AND project_id=$2`,
      [requireText(input.tenant_id, "tenant_id", 120), requireUuid(input.project_id, "project_id")],
    ));
  }

  async function setFeatureFlag(input) {
    return runProjectOperation({
      ...input,
      operation: "causal_rollout_set",
      event_type: "ROLLOUT_MODE_CHANGED",
      request: input,
      mutate: async (client) => {
        const result = await client.query(
          `UPDATE core_causal_feature_flags
              SET mode=$3,version=version+1,updated_at=clock_timestamp()
            WHERE tenant_id=$1 AND project_id=$2 AND version=$4
            RETURNING tenant_id,project_id,mode,version,updated_at`,
          [input.tenant_id, input.project_id, input.mode, input.expected_version],
        );
        if (!result.rows[0]) throw new CausalContinuityError("STALE_PROJECT_STATE", "Rollout flag version is stale");
        return result.rows[0];
      },
    });
  }

  return {
    initialize, health, migrationReadback: migrator.readback, migrationRollback: migrator.rollback,
    readProject, createProject, bindScope, readScope, saveState, currentState,
    createGenesis, readGenesis, proposeRevision, approveRevision, listRevisions,
    bindWork, readWork, createChange, readChange, listChanges, transitionChange, createObligation, bindActionLease, readObligation, listObligations, listTemporalChecks, readCapsuleSupport, updateTemporalCheck, updateObligation, transitionObligation,
    recordObservation, listObservations, saveReconciliation, readReconciliation, saveReceipt, closeObligationAtomic, saveContext, readContext, consumeNonce, consumeContextAtomic,
    saveCapsule, latestCapsule, timeline,
    createGalleryBinding, claimGalleryProjection, completeGalleryProjection, failGalleryProjection,
    readGalleryCausalView, metricsSnapshot, verifyGalleryBinding,
    readFeatureFlag, setFeatureFlag, runProjectOperation,
    async close() { if (ownsPool) await db.end(); },
    now,
  };
}

export function createInMemoryCausalContinuityStore({ now = () => new Date() } = {}) {
  const state = {
    projects: new Map(), aliases: new Map(), scopes: new Map(), snapshots: new Map(), genesis: new Map(), revisions: new Map(),
    works: new Map(), changes: new Map(), obligations: new Map(), observations: new Map(), reconciliations: new Map(),
    contexts: new Map(), nonces: new Set(), capsules: new Map(), events: new Map(), idempotency: new Map(),
    gallery: new Map(), outbox: new Map(), featureFlags: new Map(), legacyWorks: new Map(),
    changeTransitions: new Map(), obligationTransitions: new Map(), artifacts: new Map(), conflicts: new Map(),
  };
  const key = (tenant, id) => `${tenant}\u0000${id}`;
  const listFor = (map, tenant, predicate = () => true) => [...map.values()].filter((row) => row.tenant_id === tenant && predicate(row));

  async function runProjectOperation(input) {
    const idem = key(input.tenant_id, `${input.project_id}:${input.operation}:${input.idempotency_key}`);
    const digest = causalDigest(input.request);
    const prior = state.idempotency.get(idem);
    if (prior) {
      if (prior.request_digest !== digest) throw new CausalContinuityError("IDEMPOTENCY_CONFLICT");
      return structuredClone(prior.result);
    }
    const events = listFor(state.events, input.tenant_id, (row) => row.project_id === input.project_id).sort((a, b) => a.sequence_number - b.sequence_number);
    const previous = events.at(-1);
    const event = {
      tenant_id: input.tenant_id, project_id: input.project_id, event_id: crypto.randomUUID(),
      sequence_number: (previous?.sequence_number || 0) + 1, event_type: input.event_type, operation: input.operation,
      idempotency_key: input.idempotency_key, request_digest: digest, previous_event_hash: previous?.event_hash || null,
      actor_provenance: input.actor_provenance || {},
    };
    const result = await input.mutate(null, {
      event_id: event.event_id, sequence_number: event.sequence_number, previous_event_hash: event.previous_event_hash,
    });
    event.payload = { schema_version: "causal_event_payload_v1", result: structuredClone(result) };
    event.payload_digest = causalDigest(event.payload);
    event.event_hash = buildCausalEventHash({ ...event, idempotency_key: input.idempotency_key, actor_provenance: input.actor_provenance || {} });
    event.created_at = now().toISOString();
    state.events.set(key(input.tenant_id, event.event_id), event);
    const outboxPayload = { event_id: event.event_id, sequence_number: event.sequence_number, event_type: event.event_type, result: structuredClone(result) };
    const outbox = {
      tenant_id: input.tenant_id, outbox_id: crypto.randomUUID(), project_id: input.project_id, event_id: event.event_id,
      projection_type: input.projection_type || "CAUSAL_TIMELINE", payload: outboxPayload,
      payload_digest: causalDigest(outboxPayload), state: "PENDING", attempts: 0, max_attempts: 5,
      claimed_by: null, available_at: now().toISOString(), lease_expires_at: null, last_attempt_at: null,
      last_error_code: null, created_at: now().toISOString(), delivered_at: null,
    };
    state.outbox.set(key(input.tenant_id, outbox.outbox_id), outbox);
    const returned = { ...structuredClone(result), _event: { event_id: event.event_id, sequence_number: event.sequence_number, event_hash: event.event_hash, replayed: false } };
    state.idempotency.set(idem, { request_digest: digest, result: returned });
    return returned;
  }

  const withOp = (input, operation, eventType, mutate) => runProjectOperation({ ...input, operation, event_type: eventType, request: input, mutate });
  const get = (map, tenant, id) => {
    const row = map.get(key(tenant, id));
    if (!row) throw new CausalContinuityError("CAUSAL_NOT_FOUND");
    return structuredClone(row);
  };

  return {
    state,
    async initialize() { return { applied: true, in_memory: true }; },
    async health() { return { ok: true, initialized: true, in_memory: true }; },
    async readProject(input) {
      if (input.project_id) return get(state.projects, input.tenant_id, input.project_id);
      const projectId = state.aliases.get(key(input.tenant_id, input.alias));
      if (!projectId) throw new CausalContinuityError("CAUSAL_NOT_FOUND");
      return get(state.projects, input.tenant_id, projectId);
    },
    async createProject(input) { return withOp(input, "project_identity_create", "PROJECT_REGISTERED", async () => {
      const row = { tenant_id: input.tenant_id, project_id: input.project_id, canonical_name: input.canonical_name, derived_from_project_id: input.derived_from_project_id || null, status: "ACTIVE", version: 1, active_state_digest: null, active_intent_revision_id: null };
      state.projects.set(key(input.tenant_id, input.project_id), row);
      state.featureFlags.set(key(input.tenant_id, input.project_id), {
        tenant_id: input.tenant_id, project_id: input.project_id, mode: "SHADOW", version: 1,
        updated_at: now().toISOString(),
      });
      if (input.alias) state.aliases.set(key(input.tenant_id, input.alias), input.project_id);
      return row;
    }); },
    async bindScope(input) { return withOp(input, "project_scope_bind", "PROJECT_SCOPE_CHANGED", async () => {
      const row = { ...input, active: input.active !== false };
      state.scopes.set(key(input.tenant_id, input.resource_id), row);
      const project = state.projects.get(key(input.tenant_id, input.project_id));
      if (!project) throw new CausalContinuityError("CAUSAL_NOT_FOUND");
      project.active_state_digest = null;
      project.version += 1;
      return row;
    }); },
    async readScope(input) { return listFor(state.scopes, input.tenant_id, (row) => row.project_id === input.project_id && (input.active_only === false || row.active)).sort((a, b) => `${a.resource_type}:${a.canonical_identifier}`.localeCompare(`${b.resource_type}:${b.canonical_identifier}`)); },
    async saveState(input) { return withOp(input, "project_state_snapshot", "PROJECT_STATE_SNAPSHOTTED", async () => {
      const project = state.projects.get(key(input.tenant_id, input.project_id));
      if (!project) throw new CausalContinuityError("CAUSAL_NOT_FOUND");
      if (input.base_state_digest && project.active_state_digest && input.base_state_digest !== project.active_state_digest) throw new CausalContinuityError("STALE_PROJECT_STATE");
      const row = { ...input };
      state.snapshots.set(key(input.tenant_id, input.snapshot_id), row);
      project.active_state_digest = input.state_digest; project.version += 1;
      return row;
    }); },
    async currentState(input) { const project = await this.readProject(input); return project.active_state_digest ? listFor(state.snapshots, input.tenant_id, (row) => row.project_id === project.project_id && row.state_digest === project.active_state_digest)[0] || null : null; },
    async createGenesis(input) { return withOp(input, "genesis_intent_create", "GENESIS_INTENT_CREATED", async () => { const row = { ...input }; state.genesis.set(key(input.tenant_id, input.project_id), row); return row; }); },
    async readGenesis(input) { return get(state.genesis, input.tenant_id, input.project_id); },
    async proposeRevision(input) { return withOp(input, "intent_revision_propose", "INTENT_REVISION_PROPOSED", async () => {
      if (input.parent_revision_id) {
        const parent = state.revisions.get(key(input.tenant_id, input.parent_revision_id));
        if (!parent || parent.project_id !== input.project_id || parent.state !== "APPROVED") throw new CausalContinuityError("INTENT_PARENT_INVALID");
        const visited = new Set([input.intent_revision_id]);
        let cursor = parent;
        while (cursor) {
          if (visited.has(cursor.intent_revision_id)) throw new CausalContinuityError("INTENT_REVISION_CYCLE");
          visited.add(cursor.intent_revision_id);
          cursor = cursor.parent_revision_id ? state.revisions.get(key(input.tenant_id, cursor.parent_revision_id)) : null;
          if (cursor && cursor.project_id !== input.project_id) throw new CausalContinuityError("INTENT_PARENT_INVALID");
        }
      }
      const row = { ...input, state: "PROPOSED" }; state.revisions.set(key(input.tenant_id, input.intent_revision_id), row); return row;
    }); },
    async approveRevision(input) { return withOp(input, "intent_revision_approve", input.approved === false ? "INTENT_REVISION_REJECTED" : "INTENT_REVISION_APPROVED", async () => {
      const revision = state.revisions.get(key(input.tenant_id, input.intent_revision_id));
      if (!revision) throw new CausalContinuityError("CAUSAL_NOT_FOUND");
      if (revision.state !== "PROPOSED") throw new CausalContinuityError("INTENT_REVISION_IMMUTABLE");
      if (revision.classification === "PURPOSE_CHANGE" && input.approved !== false) throw new CausalContinuityError("NEW_PROJECT_REQUIRED");
      revision.state = input.approved === false ? "REJECTED" : "APPROVED"; revision.authorized_by = input.authorized_by;
      if (revision.state === "APPROVED") state.projects.get(key(input.tenant_id, revision.project_id)).active_intent_revision_id = revision.intent_revision_id;
      return revision;
    }); },
    async listRevisions(input) { return listFor(state.revisions, input.tenant_id, (row) => row.project_id === input.project_id); },
    async bindWork(input) { return withOp(input, "work_bind_intent", "WORK_OPENED", async () => {
      const project = state.projects.get(key(input.tenant_id, input.project_id));
      if (!project) throw new CausalContinuityError("CAUSAL_NOT_FOUND");
      if (input.legacy_binding_state !== "UNRESOLVED_LEGACY_BINDING" && project.active_state_digest !== input.base_state_digest) throw new CausalContinuityError("STALE_PROJECT_STATE");
      const legacy = state.legacyWorks.get(key(input.tenant_id, input.work_id));
      if (legacy && input.legacy_binding_state !== "UNRESOLVED_LEGACY_BINDING") {
        if (legacy.project_uuid && legacy.project_uuid !== input.project_id) throw new CausalContinuityError("LEGACY_PROJECT_BINDING_CONFLICT");
        legacy.project_uuid = input.project_id;
        if (legacy.project_uuid !== input.project_id) throw new CausalContinuityError("LEGACY_PROJECT_BINDING_CONFLICT");
      }
      const workKey = key(input.tenant_id, input.work_id);
      const existing = state.works.get(workKey);
      const binding = (row) => ({
        project_id: row.project_id, genesis_intent_id: row.genesis_intent_id, intent_revision_id: row.intent_revision_id,
        base_state_digest: row.base_state_digest || null, legacy_binding_state: row.legacy_binding_state || "VERIFIED",
        provenance: row.provenance,
      });
      if (existing && causalDigest(binding(existing)) !== causalDigest(binding(input))) throw new CausalContinuityError("IDEMPOTENCY_CONFLICT");
      const row = existing || { ...input };
      state.works.set(workKey, row);
      return { ...row, legacy_binding: legacy ? { present: true, state: input.legacy_binding_state, project_uuid: legacy.project_uuid || null } : { present: false, state: input.legacy_binding_state } };
    }); },
    async readWork(input) { return get(state.works, input.tenant_id, input.work_id); },
    async createChange(input) { return withOp(input, "change_create", "CHANGE_OPENED", async () => { const row = { ...input, state: "DRAFT" }; state.changes.set(key(input.tenant_id, input.change_id), row); return row; }); },
    async readChange(input) { return get(state.changes, input.tenant_id, input.change_id); },
    async listChanges(input) { return listFor(state.changes, input.tenant_id, (row) => row.project_id === input.project_id && (!input.work_id || row.work_id === input.work_id)); },
    async transitionChange(input) { return withOp(input, "change_transition", input.event_type, async () => {
      const row = state.changes.get(key(input.tenant_id, input.change_id));
      if (!row || row.state !== input.expected_state || !stateEdgeAllowed(CHANGE_STATE_EDGES, row.state, input.target_state)) throw new CausalContinuityError("CHANGE_STATE_INVALID");
      if (input.target_state === "AUTHORIZED") throw new CausalContinuityError("TRANSITION_ORIGIN_REQUIRED");
      if (input.target_state === "EXECUTED") {
        const lease = state.leases?.get(key(input.tenant_id, input.lease_id));
        if (!lease || lease.project_id !== row.project_id || lease.change_id !== row.change_id || lease.lease_purpose !== "causal_context_issue" || !lease.authority_binding_digest || new Date(lease.expires_at).getTime() <= now().getTime()) throw new CausalContinuityError("LEASE_INVALID");
        const persistedContext = state.contexts.get(key(input.tenant_id, input.context_digest));
        if (!persistedContext || persistedContext.project_id !== row.project_id || persistedContext.work_id !== row.work_id || persistedContext.change_id !== row.change_id ||
            persistedContext.envelope?.lease_id !== input.lease_id || !persistedContext.consumed_at || new Date(persistedContext.expires_at).getTime() <= now().getTime() || !input.execution_evidence_digest) {
          throw new CausalContinuityError("EXECUTION_AUTHORIZATION_REQUIRED");
        }
      }
      const transition = { ...input, from_state: row.state, to_state: input.target_state, created_at: now().toISOString() };
      row.state = input.target_state; state.changeTransitions.set(key(input.tenant_id, input.transition_id), transition); return row;
    }); },
    async createObligation(input) { return withOp(input, "causal_obligation_create", "OBLIGATION_CREATED", async () => {
      const row = { ...input, ...input.evidence_contract, state: "DRAFT" };
      state.obligations.set(key(input.tenant_id, input.obligation_id), row);
      state.temporalChecks ||= new Map();
      for (const check of input.temporal_checks || []) state.temporalChecks.set(key(input.tenant_id, check.temporal_check_id), { ...check, tenant_id: input.tenant_id, obligation_id: input.obligation_id, state: "PENDING" });
      return row;
    }); },
    async bindActionLease(input) { return withOp({ ...input, request: input.verification }, "action_lease_bind", "ACTION_AUTHORIZED", async () => {
      state.leases ||= new Map();
      const leaseKey = key(input.tenant_id, input.lease_id);
      if (state.leases.has(leaseKey)) throw new CausalContinuityError("LEASE_REPLAYED");
      const change = state.changes.get(key(input.tenant_id, input.change_id));
      const obligations = input.obligation_ids.map((id) => state.obligations.get(key(input.tenant_id, id)));
      if (!change || change.state !== "MODELED") throw new CausalContinuityError("CHANGE_STATE_INVALID");
      if (obligations.some((row) => !row || row.project_id !== input.project_id || row.work_id !== input.work_id || row.change_id !== input.change_id || row.state !== "MODELED")) throw new CausalContinuityError("OBLIGATION_STATE_INVALID");
      const row = { ...input };
      state.leases.set(leaseKey, row);
      state.changeTransitions.set(key(input.tenant_id, input.change_transition_id), { tenant_id: input.tenant_id, transition_id: input.change_transition_id, change_id: input.change_id, from_state: "MODELED", to_state: "AUTHORIZED", reason: "verified action lease", actor_provenance: input.actor_provenance, created_at: now().toISOString() });
      change.state = "AUTHORIZED";
      for (const obligation of obligations) {
        const transitionId = input.obligation_transition_ids[obligation.obligation_id];
        state.obligationTransitions.set(key(input.tenant_id, transitionId), { tenant_id: input.tenant_id, transition_id: transitionId, obligation_id: obligation.obligation_id, from_state: "MODELED", to_state: "AUTHORIZED", reason: "verified action lease", actor_provenance: input.actor_provenance, created_at: now().toISOString() });
        obligation.state = "AUTHORIZED";
      }
      return row;
    }); },
    async readObligation(input) { return get(state.obligations, input.tenant_id, input.obligation_id); },
    async listObligations(input) { return listFor(state.obligations, input.tenant_id, (row) => row.project_id === input.project_id && (!input.work_id || row.work_id === input.work_id)); },
    async listTemporalChecks(input) { state.temporalChecks ||= new Map(); return listFor(state.temporalChecks, input.tenant_id, (row) => row.obligation_id === input.obligation_id).sort((a, b) => String(a.due_at).localeCompare(String(b.due_at))); },
    async readCapsuleSupport(input) {
      const limit = Math.max(1, Math.min(Number(input.limit) || 200, 200));
      const changeIds = new Set(listFor(state.changes, input.tenant_id, (row) => row.project_id === input.project_id && row.work_id === input.work_id).map((row) => row.change_id));
      const obligationIds = new Set(listFor(state.obligations, input.tenant_id, (row) => row.project_id === input.project_id && row.work_id === input.work_id).map((row) => row.obligation_id));
      state.temporalChecks ||= new Map();
      return {
        gallery_bindings: listFor(state.gallery, input.tenant_id, (row) => row.project_id === input.project_id && row.work_id === input.work_id).sort((a,b) => b.core_event_sequence-a.core_event_sequence).slice(0,limit),
        artifacts: listFor(state.artifacts, input.tenant_id, (row) => changeIds.has(row.change_id)).slice(0,limit),
        conflicts: listFor(state.conflicts, input.tenant_id, (row) => row.project_id === input.project_id && (!row.work_id || row.work_id === input.work_id)).slice(0,limit),
        pending_temporal_checks: listFor(state.temporalChecks, input.tenant_id, (row) => obligationIds.has(row.obligation_id) && row.state === "PENDING").slice(0,limit),
      };
    },
    async updateTemporalCheck(input) { state.temporalChecks ||= new Map(); const row = state.temporalChecks.get(key(input.tenant_id, input.temporal_check_id)); if (!row) throw new CausalContinuityError("CAUSAL_NOT_FOUND"); row.state = input.state; row.observation_id = input.observation_id || null; row.checked_at = now().toISOString(); return row; },
    async updateObligation(input) { return withOp(input, input.operation, input.event_type, async () => {
      const row = state.obligations.get(key(input.tenant_id, input.obligation_id));
      if (!row) throw new CausalContinuityError("CAUSAL_NOT_FOUND");
      if (input.expected_states && !input.expected_states.includes(row.state)) throw new CausalContinuityError("OBLIGATION_STATE_INVALID");
      if (!stateEdgeAllowed(OBLIGATION_STATE_EDGES, row.state, input.state)) throw new CausalContinuityError("OBLIGATION_STATE_INVALID");
      const from = row.state; row.state = input.state; if (input.next_verification_at) row.next_verification_at = input.next_verification_at;
      state.obligationTransitions.set(key(input.tenant_id, input.transition_id), { ...input, from_state: from, to_state: input.state }); return row;
    }); },
    async transitionObligation(input) { return withOp(input, "causal_obligation_transition", input.event_type, async () => {
      const row = state.obligations.get(key(input.tenant_id, input.obligation_id));
      if (!row || row.state !== input.expected_state || !stateEdgeAllowed(OBLIGATION_STATE_EDGES, row.state, input.target_state)) throw new CausalContinuityError("OBLIGATION_STATE_INVALID");
      if (input.target_state === "AUTHORIZED") throw new CausalContinuityError("TRANSITION_ORIGIN_REQUIRED");
      if (input.target_state === "EXECUTED") {
        const lease = state.leases?.get(key(input.tenant_id, input.lease_id));
        if (!lease || !lease.obligation_ids.includes(row.obligation_id) || lease.change_id !== row.change_id || lease.lease_purpose !== "causal_context_issue" || !lease.authority_binding_digest || new Date(lease.expires_at).getTime() <= now().getTime()) throw new CausalContinuityError("LEASE_INVALID");
        const persistedContext = state.contexts.get(key(input.tenant_id, input.context_digest));
        if (!persistedContext || persistedContext.project_id !== row.project_id || persistedContext.work_id !== row.work_id || persistedContext.change_id !== row.change_id ||
            persistedContext.envelope?.lease_id !== input.lease_id || !persistedContext.envelope?.obligation_ids?.includes(row.obligation_id) || !persistedContext.consumed_at ||
            new Date(persistedContext.expires_at).getTime() <= now().getTime() || !input.execution_evidence_digest) {
          throw new CausalContinuityError("EXECUTION_AUTHORIZATION_REQUIRED");
        }
      }
      const transition = { ...input, from_state: row.state, to_state: input.target_state, created_at: now().toISOString() };
      row.state = input.target_state; state.obligationTransitions.set(key(input.tenant_id, input.transition_id), transition); return row;
    }); },
    async recordObservation(input) { return withOp(input, "causal_observation_record", input.automatic_reopen ? "CLOSURE_REOPENED" : "EVIDENCE_RECORDED", async () => {
      const obligation = state.obligations.get(key(input.tenant_id, input.obligation_id));
      if (!obligation) throw new CausalContinuityError("CAUSAL_NOT_FOUND");
      const target = input.automatic_reopen
        ? "CONTRADICTED"
        : ["EXECUTED", "PARTIAL", "UNKNOWN"].includes(obligation.state) ? "OBSERVING" : obligation.state;
      if (!input.automatic_reopen && !["EXECUTED","OBSERVING","PARTIAL","UNKNOWN"].includes(obligation.state)) throw new CausalContinuityError("OBLIGATION_STATE_INVALID");
      if (target !== obligation.state) { if (!stateEdgeAllowed(OBLIGATION_STATE_EDGES, obligation.state, target)) throw new CausalContinuityError("OBLIGATION_STATE_INVALID"); const from = obligation.state; obligation.state = target; state.obligationTransitions.set(key(input.tenant_id, input.transition_id), { transition_id: input.transition_id, obligation_id: obligation.obligation_id, from_state: from, to_state: target }); }
      const row = { ...input, obligation_reopened: input.automatic_reopen === true }; state.observations.set(key(input.tenant_id, input.observation_id), row); return row;
    }); },
    async listObservations(input) { return listFor(state.observations, input.tenant_id, (row) => row.obligation_id === input.obligation_id).sort((a, b) => String(a.observed_at).localeCompare(String(b.observed_at))); },
    async saveReconciliation(input) { return withOp(input, "causal_reconcile", "OUTCOME_RECONCILED", async () => {
      const obligation = state.obligations.get(key(input.tenant_id, input.obligation_id));
      if (!obligation || !stateEdgeAllowed(OBLIGATION_STATE_EDGES, obligation.state, input.verdict)) throw new CausalContinuityError("OBLIGATION_STATE_INVALID");
      const from = obligation.state; obligation.state = input.verdict; state.obligationTransitions.set(key(input.tenant_id, input.transition_id), { transition_id: input.transition_id, obligation_id: obligation.obligation_id, from_state: from, to_state: input.verdict });
      const row = { ...input }; state.reconciliations.set(key(input.tenant_id, input.reconciliation_id), row); return row;
    }); },
    async readReconciliation(input) { return get(state.reconciliations, input.tenant_id, input.reconciliation_id); },
    async saveReceipt(input) { return withOp({ ...input, request: input.receipt_payload }, "causal_close_receipt", input.closure_state === "VERIFIED_FINAL" ? "CLOSURE_FINAL" : "CLOSURE_PROVISIONAL", async () => ({ ...input })); },
    async closeObligationAtomic(input) { return withOp({ ...input, request: input.receipt_payload }, "causal_close", input.closure_state === "VERIFIED_FINAL" ? "CLOSURE_FINAL" : "CLOSURE_PROVISIONAL", async () => {
      const obligation = state.obligations.get(key(input.tenant_id, input.obligation_id));
      const reconciliation = state.reconciliations.get(key(input.tenant_id, input.reconciliation_id));
      if (!obligation || !reconciliation || !input.expected_states.includes(obligation.state) ||
          reconciliation.obligation_id !== obligation.obligation_id || reconciliation.reconciliation_digest !== input.reconciliation_digest ||
          !["VERIFIED_PROVISIONAL", "VERIFIED_FINAL"].includes(reconciliation.verdict)) throw new CausalContinuityError("EVIDENCE_CONTRACT_UNSATISFIED");
      const contradiction = listFor(state.observations, input.tenant_id, (row) => row.obligation_id === input.obligation_id && row.contradiction_status === "CONFIRMED");
      if (contradiction.length) throw new CausalContinuityError("EVIDENCE_CONTRACT_UNSATISFIED");
      if (input.closure_state === "VERIFIED_FINAL") {
        const checks = await this.listTemporalChecks(input);
        if (!checks.length || checks.some((check) => check.state !== "SATISFIED" || new Date(check.due_at).getTime() > now().getTime())) throw new CausalContinuityError("TEMPORAL_CHECKS_PENDING");
      }
      if (input.closure_state !== obligation.state) { if (!stateEdgeAllowed(OBLIGATION_STATE_EDGES, obligation.state, input.closure_state)) throw new CausalContinuityError("OBLIGATION_STATE_INVALID"); const from = obligation.state; obligation.state = input.closure_state; state.obligationTransitions.set(key(input.tenant_id, input.transition_id), { transition_id: input.transition_id, obligation_id: obligation.obligation_id, from_state: from, to_state: input.closure_state }); }
      return { obligation, outcome_receipt: { ...input } };
    }); },
    async saveContext(input) { return withOp({ ...input, request: input.envelope }, "causal_context_issue", "CONTEXT_ISSUED", async () => { const row = { ...input }; state.contexts.set(key(input.tenant_id, input.context_digest), row); return row; }); },
    async readContext(input) { return get(state.contexts, input.tenant_id, input.context_digest); },
    async consumeNonce(input) { const nonceKey = key(input.tenant_id, `${input.issuer_id}:${input.nonce_digest}`); if (state.nonces.has(nonceKey)) throw new CausalContinuityError("CONTEXT_REPLAYED"); state.nonces.add(nonceKey); return { consumed: true }; },
    async consumeContextAtomic(input) {
      const project = state.projects.get(key(input.tenant_id, input.project_id));
      const persisted = state.contexts.get(key(input.tenant_id, input.context_digest));
      if (!project || !persisted) throw new CausalContinuityError("CAUSAL_NOT_FOUND");
      if (persisted.project_id !== input.project_id || persisted.work_id !== input.work_id || persisted.change_id !== input.change_id) throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
      if (project.active_state_digest !== input.project_state_digest) throw new CausalContinuityError("STALE_PROJECT_STATE");
      const current = now().getTime();
      if (current < new Date(input.issued_at).getTime() || current >= new Date(input.expires_at).getTime()) throw new CausalContinuityError("CONTEXT_EXPIRED");
      const nonceKey = key(input.tenant_id, `${input.issuer_id}:${input.nonce_digest}`);
      if (state.nonces.has(nonceKey) || persisted.consumed_at) throw new CausalContinuityError("CONTEXT_REPLAYED");
      state.nonces.add(nonceKey);
      persisted.consumed_at = now().toISOString();
      return runProjectOperation({
        ...input, operation: "causal_context_consume", event_type: "CONTEXT_CONSUMED",
        idempotency_key: input.context_digest, request: { context_digest: input.context_digest, nonce_digest: input.nonce_digest },
        mutate: async () => ({ consumed: true, context_digest: input.context_digest }),
      });
    },
    async saveCapsule(input) { return withOp({ ...input, request: input.capsule }, "continuity_capsule_build", "CONTINUITY_CAPSULE_BUILT", async () => { const row = { ...input }; state.capsules.set(key(input.tenant_id, input.capsule_id), row); return row; }); },
    async latestCapsule(input) { const rows = listFor(state.capsules, input.tenant_id, (row) => row.project_id === input.project_id && row.work_id === input.work_id).sort((a, b) => b.generated_from_event_sequence - a.generated_from_event_sequence); if (!rows[0]) throw new CausalContinuityError("CAUSAL_NOT_FOUND"); return rows[0]; },
    async timeline(input) { return listFor(state.events, input.tenant_id, (row) => row.project_id === input.project_id && (!input.before_sequence || row.sequence_number < input.before_sequence)).sort((a, b) => a.sequence_number - b.sequence_number).slice(-(Math.min(Number(input.limit) || 200, 200))); },
    async createGalleryBinding(input) { return runProjectOperation({
      ...input, operation: "gallery_binding_project", event_type: "GALLERY_ITEM_BOUND", projection_type: "GALLERY_BINDING", request: input,
      mutate: async (_client, event) => {
        const project = state.projects.get(key(input.tenant_id, input.project_id));
        if (!project || project.active_state_digest !== input.project_state_digest) throw new CausalContinuityError("STALE_PROJECT_STATE");
        const work = state.works.get(key(input.tenant_id, input.work_id));
        if (!work || work.project_id !== input.project_id || work.genesis_intent_id !== input.genesis_intent_id || work.intent_revision_id !== input.intent_revision_id) throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
        const change = input.change_id ? state.changes.get(key(input.tenant_id, input.change_id)) : null;
        if (input.change_id && (!change || change.project_id !== input.project_id || change.work_id !== input.work_id)) throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
        const context = state.contexts.get(key(input.tenant_id, input.context_digest));
        if (!context || context.project_id !== input.project_id || context.work_id !== input.work_id || context.change_id !== input.change_id) throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
        if (new Date(context.expires_at).getTime() <= now().getTime()) throw new CausalContinuityError("CONTEXT_EXPIRED");
        const envelope = context.envelope || {};
        const envelopeObligations = new Set(envelope.obligation_ids || []);
        if (envelope.project_state_digest !== input.project_state_digest || envelope.genesis_intent_id !== input.genesis_intent_id ||
            envelope.intent_revision_id !== input.intent_revision_id || input.obligation_ids.some((id) => !envelopeObligations.has(id))) {
          throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
        }
        for (const obligationId of input.obligation_ids) {
          const obligation = state.obligations.get(key(input.tenant_id, obligationId));
          if (!obligation || obligation.project_id !== input.project_id || obligation.work_id !== input.work_id || obligation.change_id !== input.change_id) throw new CausalContinuityError("CAUSAL_IDENTITY_MISMATCH");
        }
        const row = {
          tenant_id: input.tenant_id, binding_id: input.binding_id, project_id: input.project_id,
          project_state_digest: input.project_state_digest, genesis_intent_id: input.genesis_intent_id,
          intent_revision_id: input.intent_revision_id, work_id: input.work_id, change_id: input.change_id || null,
          obligation_ids: [...input.obligation_ids], entity_type: input.entity_type, ticket_id: input.ticket_id,
          parent_ticket_id: input.parent_ticket_id || null, core_event_sequence: event.sequence_number,
          context_digest: input.context_digest, provenance: input.provenance || {}, status: "PENDING",
          first_verified_at: null, last_verified_at: null, last_readback_digest: null,
        };
        row.binding_digest = buildGalleryBindingDigest(row);
        const galleryKey = key(input.tenant_id, `${input.entity_type}:${input.ticket_id}`);
        const existing = state.gallery.get(galleryKey);
        if (existing && existing.binding_digest !== row.binding_digest) throw new CausalContinuityError("IDEMPOTENCY_CONFLICT");
        state.gallery.set(galleryKey, existing || row);
        return existing || row;
      },
    }); },
    async claimGalleryProjection(input) {
      const limit = Math.max(1, Math.min(Number(input.limit) || 20, 50));
      const leaseSeconds = Math.max(5, Math.min(Number(input.lease_seconds) || 30, 300));
      const current = now().getTime();
      for (const row of listFor(state.outbox, input.tenant_id, (candidate) => candidate.projection_type === "GALLERY_BINDING" &&
        candidate.state === "CLAIMED" && new Date(candidate.lease_expires_at).getTime() <= current &&
        (!input.project_id || candidate.project_id === input.project_id))) {
        row.state = row.attempts >= row.max_attempts ? "QUARANTINED" : "RETRY_WAIT";
        row.claimed_by = null; row.lease_expires_at = null; row.available_at = now().toISOString();
        row.last_error_code = "CLAIM_LEASE_EXPIRED";
      }
      for (const row of listFor(state.outbox, input.tenant_id, (candidate) => candidate.projection_type === "GALLERY_BINDING" &&
        ["PENDING", "RETRY_WAIT"].includes(candidate.state) && candidate.attempts >= candidate.max_attempts &&
        (!input.project_id || candidate.project_id === input.project_id))) {
        row.state = "QUARANTINED"; row.claimed_by = null; row.lease_expires_at = null;
        row.last_error_code = "GALLERY_ATTEMPT_LIMIT_REACHED";
      }
      const eligible = listFor(state.outbox, input.tenant_id, (row) => row.projection_type === "GALLERY_BINDING" &&
        (!input.project_id || row.project_id === input.project_id) &&
        ["PENDING", "RETRY_WAIT"].includes(row.state) && row.attempts < row.max_attempts &&
        new Date(row.available_at).getTime() <= current)
        .sort((a, b) => String(a.available_at).localeCompare(String(b.available_at)) || a.outbox_id.localeCompare(b.outbox_id)).slice(0, limit);
      return eligible.map((outbox) => {
        outbox.state = "CLAIMED"; outbox.attempts += 1; outbox.claimed_by = input.worker_id;
        outbox.last_attempt_at = now().toISOString(); outbox.lease_expires_at = new Date(current + leaseSeconds * 1000).toISOString();
        const event = state.events.get(key(input.tenant_id, outbox.event_id));
        const binding = [...state.gallery.values()].find((row) => row.tenant_id === input.tenant_id && row.project_id === outbox.project_id && row.core_event_sequence === event?.sequence_number);
        if (!event || !binding) {
          outbox.state = "QUARANTINED"; outbox.claimed_by = null; outbox.lease_expires_at = null;
          outbox.last_error_code = "ORPHAN_GALLERY_ITEM";
          return null;
        }
        return structuredClone({ ...binding, ...event, event_payload: event.payload, outbox_id: outbox.outbox_id,
          outbox_payload: outbox.payload, outbox_payload_digest: outbox.payload_digest, attempts: outbox.attempts,
          max_attempts: outbox.max_attempts, lease_expires_at: outbox.lease_expires_at, claimed_by: outbox.claimed_by });
      }).filter(Boolean);
    },
    async completeGalleryProjection(input) {
      const outbox = state.outbox.get(key(input.tenant_id, input.outbox_id));
      if (!outbox) throw new CausalContinuityError("CAUSAL_NOT_FOUND");
      const event = state.events.get(key(input.tenant_id, outbox.event_id));
      const binding = [...state.gallery.values()].find((row) => row.tenant_id === input.tenant_id && row.project_id === outbox.project_id && row.core_event_sequence === event?.sequence_number);
      if (!event || !binding) throw new CausalContinuityError("ORPHAN_GALLERY_ITEM");
      const readbackDigest = causalDigest(galleryReadbackPayload(input.readback));
      if (outbox.state === "DELIVERED") {
        if (binding.last_readback_digest !== readbackDigest) throw new CausalContinuityError("IDEMPOTENCY_CONFLICT");
        return { delivered: true, replayed: true, binding: structuredClone(binding) };
      }
      if (outbox.state !== "CLAIMED" || outbox.claimed_by !== input.worker_id || new Date(outbox.lease_expires_at).getTime() <= now().getTime()) throw new CausalContinuityError("GALLERY_CLAIM_INVALID");
      const expectedHash = buildCausalEventHash(event);
      const expected = { ...galleryBindingPayload(binding), binding_digest: binding.binding_digest, core_event_hash: event.event_hash };
      const exact = causalDigest(outbox.payload) === outbox.payload_digest && causalDigest(event.payload) === event.payload_digest &&
        expectedHash === event.event_hash && causalDigest(galleryReadbackPayload(input.readback)) === causalDigest(expected);
      if (!exact) {
        binding.status = "ORPHAN_GALLERY_ITEM"; binding.last_readback_digest = readbackDigest; binding.last_verified_at = now().toISOString();
        outbox.state = "QUARANTINED"; outbox.claimed_by = null; outbox.lease_expires_at = null; outbox.last_error_code = "GALLERY_READBACK_MISMATCH";
        return { delivered: false, status: "ORPHAN_GALLERY_ITEM" };
      }
      binding.status = "ACTIVE"; binding.last_readback_digest = readbackDigest;
      binding.first_verified_at ||= now().toISOString(); binding.last_verified_at = now().toISOString();
      outbox.state = "DELIVERED"; outbox.claimed_by = null; outbox.lease_expires_at = null;
      outbox.delivered_at = now().toISOString(); outbox.last_error_code = null;
      return { delivered: true, replayed: false, binding: structuredClone(binding), event_hash: event.event_hash };
    },
    async failGalleryProjection(input) {
      const outbox = state.outbox.get(key(input.tenant_id, input.outbox_id));
      if (!outbox || outbox.state !== "CLAIMED" || outbox.claimed_by !== input.worker_id) throw new CausalContinuityError("GALLERY_CLAIM_INVALID");
      outbox.state = outbox.attempts >= outbox.max_attempts ? "QUARANTINED" : "RETRY_WAIT";
      outbox.claimed_by = null; outbox.lease_expires_at = null; outbox.last_error_code = input.error_code;
      outbox.available_at = new Date(now().getTime() + Math.max(1, Math.min(Number(input.retry_after_seconds) || 5, 300)) * 1000).toISOString();
      return structuredClone({ state: outbox.state, attempts: outbox.attempts, max_attempts: outbox.max_attempts, available_at: outbox.available_at, last_error_code: outbox.last_error_code });
    },
    async readGalleryCausalView(input) {
      const typeMap = { intent_evolution: ["INTENT_REVISION"], decision_history: ["ARCHITECTURE_DECISION"], work_graph: ["WORK"], change_timeline: ["CHANGE"], evidence: ["EVIDENCE", "VERIFICATION"], closure: ["CLOSURE", "REOPENING", "OUTCOME", "REMEDIATION", "ROLLBACK"] };
      const types = typeMap[input.view] || null;
      const limit = Math.max(1, Math.min(Number(input.limit) || 50, 200));
      const rows = listFor(state.gallery, input.tenant_id, (row) => row.project_id === input.project_id && (!input.before_sequence || row.core_event_sequence < input.before_sequence) && (!types || types.includes(row.entity_type)))
        .sort((a, b) => b.core_event_sequence - a.core_event_sequence).slice(0, limit).map((row) => {
          const event = listFor(state.events, input.tenant_id, (candidate) => candidate.project_id === input.project_id && candidate.sequence_number === row.core_event_sequence)[0];
          return { ...structuredClone(row), event_hash: event?.event_hash || null, event_type: event?.event_type || null };
        });
      return { view: input.view, items: rows, next_before_sequence: rows.length === limit ? rows.at(-1).core_event_sequence : null };
    },
    async metricsSnapshot(input) {
      const projectRows = (map) => listFor(map, input.tenant_id, (row) => row.project_id === input.project_id);
      const obligations = projectRows(state.obligations); const gallery = projectRows(state.gallery);
      const outbox = projectRows(state.outbox).filter((row) => row.projection_type === "GALLERY_BINDING");
      return { tenant_id: input.tenant_id, project_id: input.project_id, observed_at: now().toISOString(), metrics: {
        works_with_lineage: projectRows(state.works).filter((row) => (row.legacy_binding_state || "VERIFIED") === "VERIFIED").length,
        open_changes: projectRows(state.changes).filter((row) => !["CLOSED", "ROLLED_BACK", "VERIFIED_FINAL"].includes(row.state)).length,
        open_obligations: obligations.filter((row) => !["CLOSED", "ROLLED_BACK"].includes(row.state)).length,
        verified_obligations: obligations.filter((row) => ["VERIFIED_PROVISIONAL", "VERIFIED_FINAL", "CLOSED"].includes(row.state)).length,
        orphan_gallery_items: gallery.filter((row) => ["ORPHAN_GALLERY_ITEM", "QUARANTINED"].includes(row.status)).length,
        gallery_projection_pending: outbox.filter((row) => ["PENDING", "CLAIMED", "RETRY_WAIT"].includes(row.state)).length,
        gallery_projection_quarantined: outbox.filter((row) => row.state === "QUARANTINED").length,
        ledger_events: projectRows(state.events).length,
        ledger_sequence: Math.max(0, ...projectRows(state.events).map((row) => row.sequence_number)),
        changes_executed: projectRows(state.changes).filter((row) => row.state === "EXECUTED").length,
        obligations_observing: obligations.filter((row) => row.state === "OBSERVING").length,
        obligations_verified_final: obligations.filter((row) => row.state === "VERIFIED_FINAL").length,
        change_transitions: listFor(state.changeTransitions, input.tenant_id, (row) => projectRows(state.changes).some((change) => change.change_id === row.change_id)).length,
        obligation_transitions: listFor(state.obligationTransitions, input.tenant_id, (row) => obligations.some((obligation) => obligation.obligation_id === row.obligation_id)).length,
        open_conflicts: projectRows(state.conflicts).filter((row) => row.state === "OPEN").length,
        pending_temporal_checks: listFor(state.temporalChecks || new Map(), input.tenant_id, (row) => obligations.some((obligation) => obligation.obligation_id === row.obligation_id) && row.state === "PENDING").length,
      } };
    },
    async verifyGalleryBinding(input) {
      const matches = [...state.gallery.values()].filter((row) => row.tenant_id === input.tenant_id && row.ticket_id === input.ticket_id && row.status === "ACTIVE");
      if (matches.length !== 1) {
        for (const binding of matches) binding.status = "QUARANTINED";
        throw new CausalContinuityError(matches.length ? "GALLERY_INTEGRITY_MISMATCH" : "ORPHAN_GALLERY_ITEM");
      }
      const binding = matches[0];
      const event = listFor(state.events, input.tenant_id, (row) => row.project_id === binding.project_id && row.sequence_number === binding.core_event_sequence)[0] || null;
      const outbox = event ? listFor(state.outbox, input.tenant_id, (row) => row.project_id === binding.project_id && row.event_id === event.event_id && row.projection_type === "GALLERY_BINDING")[0] || null : null;
      const context = state.contexts.get(key(input.tenant_id, binding.context_digest)) || null;
      const previous = event && event.sequence_number > 1 ? listFor(state.events, input.tenant_id, (row) => row.project_id === binding.project_id && row.sequence_number === event.sequence_number - 1)[0] || null : null;
      if (!galleryIntegrityValid({ binding, event, outbox, context, previous })) {
        binding.status = "QUARANTINED"; binding.last_verified_at = now().toISOString();
        if (outbox) { outbox.state = "QUARANTINED"; outbox.last_error_code = "GALLERY_POST_ACTIVATION_INTEGRITY_MISMATCH"; }
        throw new CausalContinuityError("GALLERY_INTEGRITY_MISMATCH");
      }
      binding.last_verified_at = now().toISOString();
      return structuredClone({ ...binding, event_hash: event.event_hash });
    },
    async readFeatureFlag(input) { return get(state.featureFlags, input.tenant_id, input.project_id); },
    async setFeatureFlag(input) { return withOp(input, "causal_rollout_set", "ROLLOUT_MODE_CHANGED", async () => {
      const row = state.featureFlags.get(key(input.tenant_id, input.project_id));
      if (!row) throw new CausalContinuityError("CAUSAL_NOT_FOUND");
      if (Number(row.version) !== Number(input.expected_version)) throw new CausalContinuityError("STALE_PROJECT_STATE");
      row.mode = input.mode; row.version += 1; row.updated_at = now().toISOString();
      return row;
    }); },
    runProjectOperation,
    async close() {},
    now,
  };
}
