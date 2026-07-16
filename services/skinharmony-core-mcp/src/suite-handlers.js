import { createSuiteClient, SuiteClientError } from "./suite-client.js";

const CREDENTIAL_KEY = /(password|secret|token|cookie|authorization|api.?key|client_secret|access_token|refresh_token)/i;
const PERSONAL_KEY = /^(email|email_address|phone|phone_number|first_name|last_name|full_name|customer_name|address|street|postal_code)$/i;
const RAW_COLLECTION_KEY = /^(customers?|contacts?|profiles?|orders?|records?|raw|raw_.*)$/i;
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

function safeText(value, maximum = 2_000) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum);
  return EMAIL_VALUE.test(text) ? "[redacted]" : text;
}

export function sanitizeSuiteValue(value, key = "", depth = 0) {
  if (depth > 10 || CREDENTIAL_KEY.test(key) || PERSONAL_KEY.test(key)) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return safeText(value);
  if (RAW_COLLECTION_KEY.test(key) && (Array.isArray(value) || (value && typeof value === "object"))) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, 100)
      .map((item) => sanitizeSuiteValue(item, key, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;
  const output = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 160)) {
    const sanitized = sanitizeSuiteValue(childValue, childKey, depth + 1);
    if (sanitized !== undefined) output[childKey] = sanitized;
  }
  return output;
}

function result(payload, summary) {
  return {
    structuredContent: payload,
    content: [{ type: "text", text: safeText(summary, 1_000) }],
  };
}

function normalizedCockpit(payload) {
  const sanitized = sanitizeSuiteValue(payload || {}) || {};
  return {
    ...sanitized,
    ok: sanitized.ok !== false,
    schema_version: safeText(sanitized.schema_version || "cockpit_360_summary_v1", 100),
    guardrails: {
      ...(sanitized.guardrails || {}),
      tenant_scoped: true,
      aggregate_only: true,
      read_only: true,
      execution_allowed: false,
    },
    mcp_contract: {
      schema_version: "suite_mcp_cockpit_360_v1",
      tenant_source: "authenticated_identity",
      upstream: "suite_control_plane",
      aggregate_only: true,
      execution_allowed: false,
    },
  };
}

function branchArchitecture(payload) {
  const source = payload?.branch_map || payload?.architecture || payload || {};
  return sanitizeSuiteValue(source) || {};
}

function runbookCatalog(payload) {
  const source = payload?.catalog || payload || {};
  return sanitizeSuiteValue(source) || {};
}

export function createSuiteHandlers(config, options = {}) {
  const client = options.client || createSuiteClient(config, options);
  return {
    suite_status: async (args, identity) => {
      const cockpit = normalizedCockpit(await client.cockpit360(identity, args.node_id));
      const status = {
        ok: true,
        schema_version: "suite_mcp_status_v1",
        source_schema_version: cockpit.schema_version,
        revision_hash: cockpit.revision_hash || "",
        generated_at: cockpit.generated_at || "",
        scope: cockpit.scope || {},
        connection: {
          node_status: cockpit.freshness?.node_status || "unknown",
          heartbeat_fresh: cockpit.freshness?.heartbeat_fresh === true,
          latest_heartbeat_at: cockpit.freshness?.latest_heartbeat_at || "",
          latest_snapshot_at: cockpit.freshness?.latest_snapshot_at || "",
          heartbeat_age_seconds: cockpit.freshness?.heartbeat_age_seconds ?? null,
        },
        readiness: {
          branches_total: cockpit.summary?.branches_total || 0,
          ready: cockpit.summary?.ready || 0,
          attention: cockpit.summary?.attention || 0,
          blocked: cockpit.summary?.blocked || 0,
          insufficient_data: cockpit.summary?.insufficient_data || 0,
          tenant_status: cockpit.summary?.tenant_readiness_status || "unknown",
          tenant_score: cockpit.summary?.tenant_readiness_score || 0,
        },
        module_coverage: cockpit.module_coverage || cockpit.summary?.module_coverage || {},
        guardrails: {
          tenant_scoped: true,
          aggregate_only: true,
          execution_allowed: false,
        },
      };
      return result(status, `Suite status: ${status.connection.node_status}; ${status.readiness.ready}/${status.readiness.branches_total} branches ready.`);
    },

    suite_cockpit_360: async (args, identity) => {
      const cockpit = normalizedCockpit(await client.cockpit360(identity, args.node_id));
      return result(cockpit, `Suite Cockpit 360 loaded at revision ${cockpit.revision_hash || "unknown"}; execution remains disabled.`);
    },

    suite_branch_catalog: async (_args, identity) => {
      const architecture = branchArchitecture(await client.branchCatalog(identity));
      const payload = {
        ok: true,
        schema_version: "suite_mcp_branch_catalog_v1",
        architecture_schema: architecture.schema || "nyra_suite_branch_architecture_v2",
        version: architecture.version || "",
        branch_count: Array.isArray(architecture.branch_keys) ? architecture.branch_keys.length : 0,
        branch_keys: Array.isArray(architecture.branch_keys) ? architecture.branch_keys : [],
        branch_groups: architecture.branch_groups || {},
        pipeline: architecture.pipeline || {},
        branches: Array.isArray(architecture.branches) ? architecture.branches : [],
        guardrails: architecture.guardrails || { execution_allowed: false, tenant_binding_required: true },
        validation: architecture.validation || {},
      };
      return result(payload, `Suite branch architecture loaded with ${payload.branch_count} tenant-scoped branches.`);
    },

    suite_branch_read: async (args, identity) => {
      const [catalogResponse, cockpitResponse] = await Promise.all([
        client.branchCatalog(identity),
        client.cockpit360(identity, args.node_id),
      ]);
      const architecture = branchArchitecture(catalogResponse);
      const cockpit = normalizedCockpit(cockpitResponse);
      const definition = (Array.isArray(architecture.branches) ? architecture.branches : [])
        .find((branch) => branch?.key === args.branch_key);
      if (!definition) throw new SuiteClientError("suite_branch_not_found", 404);
      const state = (Array.isArray(cockpit.branches) ? cockpit.branches : [])
        .find((branch) => branch?.key === args.branch_key) || null;
      const payload = {
        ok: true,
        schema_version: "suite_mcp_branch_read_v1",
        branch_key: args.branch_key,
        cockpit_revision_hash: cockpit.revision_hash || "",
        generated_at: cockpit.generated_at || "",
        definition: sanitizeSuiteValue(definition) || {},
        state: sanitizeSuiteValue(state) || {
          key: args.branch_key,
          state: "insufficient_data",
          primary_reason: "branch_state_not_available",
        },
        conflicts: (Array.isArray(cockpit.conflicts) ? cockpit.conflicts : [])
          .filter((conflict) => conflict?.winner_branch === args.branch_key || conflict?.affected_branches?.includes?.(args.branch_key)),
        guardrails: {
          tenant_scoped: true,
          aggregate_only: true,
          read_only: true,
          execution_allowed: false,
        },
      };
      return result(payload, `Suite branch ${args.branch_key}: ${payload.state.state || "unknown"}.`);
    },

    suite_decision_preview: async (args, identity) => {
      const preview = sanitizeSuiteValue(await client.decisionPreview(identity, args)) || {};
      const payload = {
        ...preview,
        ok: preview.ok !== false,
        schema_version: "suite_mcp_decision_preview_v1",
        guardrails: {
          ...(preview.guardrails || {}),
          tenant_scoped: true,
          aggregate_only: true,
          preview_only: true,
          execution_allowed: false,
        },
      };
      return result(payload, "Nyra/Core Suite decision preview completed from the server-hydrated Cockpit; no action was executed.");
    },

    suite_runbook_catalog: async (_args, identity) => {
      const catalog = runbookCatalog(await client.runbookCatalog(identity));
      const payload = {
        ...catalog,
        ok: true,
        schema_version: "suite_mcp_runbook_catalog_v1",
        runbooks: Array.isArray(catalog.runbooks) ? catalog.runbooks : [],
        execution_allowed: false,
        guardrails: {
          proposal_only: true,
          dispatch_tool_exposed: false,
          execution_allowed: false,
        },
      };
      return result(payload, `Suite runbook catalog loaded with ${payload.runbooks.length} proposal-only runbooks.`);
    },

    suite_runbook_preview: async (args, identity) => {
      const upstream = sanitizeSuiteValue(await client.runbookPreview(identity, args)) || {};
      const payload = {
        ...upstream,
        ok: upstream.ok !== false,
        schema_version: "suite_mcp_runbook_preview_v1",
        execution_allowed: false,
        guardrails: {
          preview_only: true,
          dispatch_tool_exposed: false,
          owner_confirmation_required: true,
          execution_allowed: false,
        },
      };
      return result(payload, `Suite runbook ${args.runbook_id} previewed; nothing was queued or executed.`);
    },
  };
}

export const suiteHandlerInternals = Object.freeze({ branchArchitecture, normalizedCockpit, runbookCatalog, safeText });
