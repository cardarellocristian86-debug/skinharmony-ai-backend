const identifier = { type: "string", minLength: 1, maxLength: 160 };
const workId = {
  type: "string",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
};
const entityType = { type: "string", pattern: "^[a-z][a-z0-9._-]{0,79}$" };
const entityId = { type: "string", pattern: "^e360_[a-f0-9]{48}$" };
const digest = { type: "string", pattern: "^[a-f0-9]{64}$" };
const dateTime = { type: "string", minLength: 20, maxLength: 40, format: "date-time" };
const bitemporalQueryMode = {
  type: "string",
  enum: ["CURRENT_STATE", "VALID_AT", "KNOWN_AT", "VALID_AND_KNOWN_AT", "DECISION_CONTEXT_AT"],
};
const bitemporalQuery = Object.freeze({
  query_mode: bitemporalQueryMode,
  valid_at: dateTime,
  known_at: dateTime,
  as_of_valid_time: dateTime,
  as_of_knowledge_time: dateTime,
  decision_time: dateTime,
});
const idempotencyKey = { type: "string", minLength: 1, maxLength: 240 };
const scalar = { type: ["string", "number", "boolean"] };
const ownerConfirmationProperties = Object.freeze({
  owner_confirmed: { type: "boolean" },
  confirmation_reference: { type: "string", maxLength: 240 },
});
const object = (properties = {}, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const identity = {
  type: "object",
  minProperties: 1,
  maxProperties: 32,
  additionalProperties: scalar,
};

const projectWorkLinkage = object({
  project_id: identifier,
  work_id: identifier,
  legacy_work_id: identifier,
  component_id: identifier,
});

function tool(name, title, description, inputSchema, readOnly, options = {}) {
  const schema = options.ownerConfirmationRequired === true
    ? {
      ...inputSchema,
      properties: { ...inputSchema.properties, ...ownerConfirmationProperties },
    }
    : inputSchema;
  return {
    name,
    title,
    description,
    inputSchema: schema,
    outputSchema: { type: "object", additionalProperties: true },
    scopes: [readOnly ? "core:read" : "core:govern"],
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    ...(options.ownerConfirmationRequired === true ? {
      _meta: {
        "skinharmony/ownerConfirmationRequired": true,
        // Tenant-wide shadow transitions own distinct Universal Core routes;
        // never let the dynamic wrapper replace it with a Work-scoped gate.
        ...(options.dedicatedCoreGate === true
          ? { "skinharmony/dedicatedCoreGate": true }
          : {}),
      },
    } : {}),
  };
}

const definitions = [
  [
    "entity_360_resolve",
    "Resolve Entity 360 identity",
    "Resolve one tenant-bound entity deterministically. Ambiguity is returned fail-closed and never authorizes execution.",
    object({
      work_id: workId,
      entity_type: entityType,
      identity,
      entity_id: entityId,
      project_work_linkage: projectWorkLinkage,
    }, ["work_id", "entity_type", "identity"]),
    true,
  ],
  [
    "entity_360_snapshot_assemble",
    "Assemble Entity 360 snapshot",
    "Ask Universal Core to assemble and persist one immutable, evidence-backed context snapshot in shadow mode; the result is context, not authority.",
    object({
      work_id: workId,
      entity_type: entityType,
      identity,
      entity_id: entityId,
      as_of: dateTime,
      expected_revision: { type: "integer", minimum: 0 },
      idempotency_key: idempotencyKey,
      project_work_linkage: projectWorkLinkage,
    }, ["work_id", "entity_type", "identity", "as_of", "expected_revision", "idempotency_key"]),
    false,
  ],
  [
    "entity_360_snapshot_latest",
    "Read latest Entity 360 snapshot",
    "Read the latest immutable snapshot, or a non-authoritative bitemporal projection, within the authenticated tenant.",
    object({ work_id: workId, entity_id: entityId, ...bitemporalQuery }, ["work_id", "entity_id"]),
    true,
  ],
  [
    "entity_360_snapshot_read",
    "Read Entity 360 snapshot version",
    "Read one exact immutable snapshot version, or a non-authoritative bitemporal projection, within the authenticated tenant.",
    object({ work_id: workId, entity_id: entityId,
      snapshot_version: { type: "integer", minimum: 1 }, ...bitemporalQuery }, ["work_id", "entity_id", "snapshot_version"]),
    true,
  ],
  [
    "entity_360_snapshot_verify",
    "Verify Entity 360 snapshot",
    "Ask Universal Core to independently verify one exact tenant-bound snapshot without granting authority or execution.",
    object({
      work_id: workId,
      entity_id: entityId,
      snapshot_version: { type: "integer", minimum: 1 },
      snapshot_digest: digest,
    }, ["work_id", "entity_id", "snapshot_version"]),
    true,
  ],
  [
    "entity_360_shadow_compare",
    "Compare Entity 360 shadow path",
    "Persist a tenant-bound shadow comparison against the legacy path without changing the production decision.",
    object({
      work_id: workId,
      entity_id: entityId,
      snapshot_version: { type: "integer", minimum: 1 },
      snapshot_digest: digest,
      legacy_context_digest: digest,
      legacy_outcome: { type: "string", enum: ["ALLOW", "HOLD", "BLOCK", "INSUFFICIENT_CONTEXT"] },
      idempotency_key: idempotencyKey,
    }, ["work_id", "entity_id", "snapshot_version", "legacy_context_digest", "legacy_outcome", "idempotency_key"]),
    false,
  ],
  [
    "entity_360_policy_read",
    "Read Entity 360 policy",
    "Read the active tenant-bound Entity 360 policy, ontology and feature mode.",
    object({ work_id: workId, project_id: identifier }, ["work_id"]),
    true,
  ],
  [
    "entity_360_metrics_read",
    "Read Entity 360 metrics",
    "Read bounded tenant-scoped Entity 360 assembly, occupancy, corroboration, completeness and shadow metrics.",
    object({ work_id: workId, project_id: identifier }, ["work_id"]),
    true,
  ],
  [
    "entity_360_shadow_enable",
    "Enable Entity 360 tenant shadow",
    "Enable the tenant-wide Entity 360 context fabric in non-authoritative SHADOW mode. This requires a fresh owner confirmation and can never enable execution or production decision mutation.",
    object({
      expected_revision: { type: "integer", minimum: 0 },
      idempotency_key: idempotencyKey,
    }, ["expected_revision", "idempotency_key"]),
    false,
    { ownerConfirmationRequired: true, dedicatedCoreGate: true },
  ],
  [
    "entity_360_shadow_disable",
    "Disable Entity 360 tenant shadow",
    "Disable the tenant-wide Entity 360 context fabric. This preserves history and requires a fresh owner confirmation; it can never delete Entity 360 records, enable execution or mutate a production decision.",
    object({
      expected_revision: { type: "integer", minimum: 0 },
      idempotency_key: idempotencyKey,
    }, ["expected_revision", "idempotency_key"]),
    false,
    { ownerConfirmationRequired: true, dedicatedCoreGate: true },
  ],
];

export const ENTITY_360_TOOLS = Object.freeze(definitions.map((entry) => tool(...entry)));

const paths = Object.freeze({
  entity_360_resolve: "/v1/entity-360/resolve",
  entity_360_snapshot_assemble: "/v1/entity-360/snapshots/assemble",
  entity_360_snapshot_latest: "/v1/entity-360/snapshots/latest",
  entity_360_snapshot_read: "/v1/entity-360/snapshots/read",
  entity_360_snapshot_verify: "/v1/entity-360/snapshots/verify",
  entity_360_shadow_compare: "/v1/entity-360/shadow/compare",
  entity_360_policy_read: "/v1/entity-360/policy",
  entity_360_metrics_read: "/v1/entity-360/metrics",
});

const textResult = (value) => ({
  structuredContent: value,
  content: [{ type: "text", text: JSON.stringify(value) }],
});

function withoutCallerTenant(args) {
  const body = { ...args };
  delete body.tenant_id;
  delete body.tenantId;
  delete body.tenant_scope;
  delete body.tenantScope;
  return body;
}

function transportWorkId(args) {
  const value = String(args?.work_id || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) {
    throw new Error("entity360_dtt_work_id_required");
  }
  for (const candidate of [args?.identity?.work_id, args?.project_work_linkage?.work_id]) {
    if (candidate !== undefined && String(candidate).trim().toLowerCase() !== value) {
      throw new Error("entity360_dtt_work_binding_mismatch");
    }
  }
  if (args?.identity && args.identity.work_id === undefined) {
    throw new Error("entity360_dtt_work_identity_required");
  }
  return value;
}

function assertContextOnlyResponse(value) {
  const pending = [{ value, depth: 0 }];
  const seen = new Set();
  let inspected = 0;
  while (pending.length) {
    const current = pending.pop();
    if (!current?.value || typeof current.value !== "object") continue;
    if (seen.has(current.value)) throw new Error("entity360_response_cycle_invalid");
    seen.add(current.value);
    inspected += 1;
    if (inspected > 50_000 || current.depth > 64) {
      throw new Error("entity360_response_boundary_scan_exceeded");
    }
    const objectValue = current.value;
    for (const [rawKey, child] of Object.entries(objectValue)) {
      const key = rawKey.trim().toLowerCase().replaceAll("-", "_");
      if (["allow", "authorization", "core_verdict", "deploy", "execution", "merge", "publish"]
        .includes(key)
        || key === "authority" && (child !== "universal_core"
          || objectValue.execution_authorized !== false)) {
        throw new Error("entity360_authority_boundary_violation");
      }
    }
    if (objectValue.execution_authorized === true
      || objectValue.production_decision_changed === true
      || objectValue.production_decision_mutation === true
      || objectValue.authorized === true
      || objectValue.authorization?.allowed === true) {
      throw new Error("entity360_authority_boundary_violation");
    }
    for (const child of Array.isArray(objectValue) ? objectValue : Object.values(objectValue)) {
      if (child && typeof child === "object") pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return value;
}

function adaptEntity360NyraContext(capabilityId, value, tenantId, workId) {
  if (capabilityId !== "entity_360_snapshot_assemble"
    || value?.projection === undefined) return value;
  const source = value.projection;
  const projection = source?.projection;
  const cache = source?.cache;
  if (projection === null && cache?.authoritative === false
    && cache?.execution_authorized === false) {
    const { projection: _sourceProjection, ...rest } = value;
    return {
      ...rest,
      entity_360_nyra_context: {
        schema_version: "entity_360_nyra_context_v1",
        state: "UNAVAILABLE",
        projection: null,
        projection_digest: null,
        cache,
        context_authoritative: false,
        execution_authorized: false,
        production_decision_mutation: false,
      },
    };
  }
  if (!projection || typeof projection !== "object" || Array.isArray(projection)
    || projection.schema_version !== "entity_360_projection_v1"
    || projection.tenant_scope !== tenantId || projection.work_id !== workId
    || !/^e360_[a-f0-9]{48}$/u.test(String(projection.entity_id || ""))
    || !/^[a-f0-9]{64}$/u.test(String(projection.snapshot_digest || ""))
    || !/^[a-f0-9]{64}$/u.test(String(projection.projection_digest || ""))
    || !Number.isSafeInteger(Number(projection.snapshot_version))
    || Number(projection.snapshot_version) < 1
    || projection.authority !== "universal_core"
    || projection.execution_authorized !== false
    || projection.production_decision_mutation !== false
    || !cache || typeof cache !== "object" || Array.isArray(cache)
    || !new Set(["HIT", "REBUILT"]).has(cache.state)
    || cache.authoritative !== false || cache.execution_authorized !== false) {
    throw new Error("entity360_nyra_projection_invalid");
  }
  const { projection: _sourceProjection, ...rest } = value;
  return {
    ...rest,
    entity_360_nyra_context: {
      schema_version: "entity_360_nyra_context_v1",
      state: "READY_CONTEXT_ONLY",
      projection,
      projection_digest: projection.projection_digest,
      cache,
      context_authoritative: false,
      execution_authorized: false,
      production_decision_mutation: false,
    },
  };
}

export function createEntity360Handlers({
  coreRequest,
  shadowEnableCoreRequest,
  shadowDisableCoreRequest,
  issueAgentContext,
} = {}) {
  if (typeof coreRequest !== "function" || typeof issueAgentContext !== "function") {
    throw new TypeError("entity 360 transport required");
  }
  return Object.fromEntries(definitions.map(([capabilityId]) => [
    capabilityId,
    async (args = {}, identityContext = {}) => {
      const shadowTransition = capabilityId === "entity_360_shadow_enable"
        ? { coreRequest: shadowEnableCoreRequest, route: "entity_360_shadow_enable" }
        : capabilityId === "entity_360_shadow_disable"
          ? { coreRequest: shadowDisableCoreRequest, route: "entity_360_shadow_disable" }
          : null;
      if (shadowTransition) {
        if (typeof shadowTransition.coreRequest !== "function") {
          throw new Error("entity360_configuration_transport_required");
        }
        const tenantId = String(identityContext?.tenantId || "").trim();
        if (!tenantId) throw new Error("entity360_authenticated_tenant_required");
        if (identityContext.ownerConfirmed !== true || args.owner_confirmed !== true) {
          throw new Error("owner_confirmation_required");
        }
        const response = await shadowTransition.coreRequest({
          expected_revision: args.expected_revision,
          idempotency_key: args.idempotency_key,
          owner_confirmed: true,
          confirmation_reference: args.confirmation_reference,
        }, identityContext);
        const dedicatedCoreGate = response?.dedicated_core_gate;
        if (dedicatedCoreGate?.authorized !== true ||
          dedicatedCoreGate?.authority !== "universal_core" ||
          dedicatedCoreGate?.route !== shadowTransition.route ||
          dedicatedCoreGate?.provider_execution !== false ||
          dedicatedCoreGate?.host_policy_override !== false) {
          throw new Error("entity360_dedicated_core_gate_unverified");
        }
        const { dedicated_core_gate: _gate, ...contextOnlyResponse } = response;
        const value = assertContextOnlyResponse(contextOnlyResponse);
        return textResult({ ...value, dedicated_core_gate: dedicatedCoreGate });
      }
      const tenantId = String(identityContext?.tenantId || "").trim();
      if (!tenantId || !identityContext.agentPresence) throw new Error("agent_presence_session_required");
      const boundWorkId = transportWorkId(args);
      const agentContext = issueAgentContext({
        tenant_id: tenantId,
        work_id: boundWorkId,
        agent_presence: identityContext.agentPresence,
      });
      if (!agentContext) throw new Error("dtt_agent_identity_not_ready");
      const value = assertContextOnlyResponse(await coreRequest(paths[capabilityId], args,
        identityContext, {
        method: "POST",
        body: withoutCallerTenant(args),
        additionalHeaders: { "x-sh-dtt-agent-context": agentContext },
      }));
      return textResult(adaptEntity360NyraContext(
        capabilityId, value, tenantId, boundWorkId,
      ));
    },
  ]));
}
