import crypto from "node:crypto";

const SNAPSHOT_SCHEMA_VERSION = "nyra_live_branch_catalog_snapshot_v1";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalSha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function branchIds(network) {
  const branches = network?.opened_branches;
  if (!Array.isArray(branches)) return [];
  return branches.map((branch) => String(branch?.id || branch || "")).filter(Boolean).sort();
}

function coreNetwork(payload) {
  return payload?.result?.nyra_neural_network
    || payload?.nyra_neural_network
    || payload?.result?.work_preflight?.nyra_route
    || payload?.work_preflight?.nyra_route
    || null;
}

function catalogCounts(corePayload) {
  const branches = Array.isArray(corePayload?.catalog?.branches) ? corePayload.catalog.branches : [];
  return {
    branch_count: branches.length,
    subbranch_count: branches.reduce((total, branch) => (
      total + (Array.isArray(branch?.subbranches)
        ? branch.subbranches.length
        : Number(branch?.subbranch_count || 0))
    ), 0),
  };
}

function baseShadow(state, details = {}) {
  return {
    schema_version: "nyra_mcp_deep_branch_shadow_v1",
    state,
    mode: "shadow",
    selected_authority: "V1",
    fallback: "nyra_neural_branch_network_v1",
    execution_authorized: false,
    core_final_authority: true,
    ...details,
  };
}

export function compareCatalogs(corePayload, deepPayload, tenantId) {
  const source = deepPayload?.catalog?.source_catalog || {};
  const metrics = deepPayload?.validation?.metrics || deepPayload?.catalog?.topology || {};
  const coreCounts = catalogCounts(corePayload);
  const deepCounts = {
    branch_count: Number(metrics.branch_count || 0),
    subbranch_count: Number(metrics.subbranch_count || deepPayload?.catalog?.runtime_manifest?.shard_count || 0),
    node_count: Number(metrics.node_count || deepPayload?.catalog?.function_registry?.function_count || 0),
    shard_count: Number(deepPayload?.catalog?.runtime_manifest?.shard_count || 0),
  };
  const reconstructedSnapshot = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    captured_at: source.captured_at,
    source: source.source,
    authenticated_tenant: source.tenant_id,
    response: corePayload,
  };
  const observedSnapshotSha256 = canonicalSha256(reconstructedSnapshot);
  const checks = {
    core_tenant_match: String(corePayload?.tenant_id || "") === String(tenantId || ""),
    deep_tenant_match: String(deepPayload?.tenant_id || "") === String(tenantId || ""),
    source_tenant_match: String(source.tenant_id || "") === String(tenantId || ""),
    domain_pack_match: String(source.domain_pack_id || "") === String(corePayload?.catalog?.domain_pack_id || ""),
    schema_match: String(source.schema_version || "") === String(corePayload?.catalog?.schema_version || ""),
    authority_match: deepPayload?.catalog?.authority === "universal_core"
      && deepPayload?.core_final_authority === true,
    topology_match: coreCounts.branch_count === deepCounts.branch_count
      && coreCounts.subbranch_count === deepCounts.subbranch_count
      && deepCounts.shard_count === deepCounts.subbranch_count,
    skinharmony_topology: coreCounts.branch_count === 18 && coreCounts.subbranch_count === 239,
    snapshot_match: /^[a-f0-9]{64}$/.test(String(source.source_snapshot_sha256 || ""))
      && source.source_snapshot_sha256 === observedSnapshotSha256,
  };
  const synchronized = deepPayload?.ok === true
    && deepPayload?.validation?.ok === true
    && Object.values(checks).every(Boolean);
  return baseShadow(
    synchronized ? "shadow_synced_v1_authoritative" : "shadow_mismatch_v1_authoritative",
    {
      synchronized,
      feature_flags: {
        enabled: deepPayload?.feature_flags?.enabled === true,
        mode: deepPayload?.feature_flags?.mode || "disabled",
      },
      parity: {
        checks,
        core: coreCounts,
        v2: deepCounts,
        expected_source_snapshot_sha256: source.source_snapshot_sha256 || null,
        observed_source_snapshot_sha256: observedSnapshotSha256,
      },
      catalog: deepPayload?.catalog ? {
        schema_version: deepPayload.catalog.schema_version,
        version: deepPayload.catalog.version,
        catalog_fingerprint: deepPayload.catalog.catalog_fingerprint,
        rollback_checkpoint: deepPayload.catalog.rollback_checkpoint,
        function_registry: {
          schema_version: deepPayload.catalog.function_registry?.schema_version,
          registry_hash: deepPayload.catalog.function_registry?.registry_hash,
          function_count: deepCounts.node_count,
        },
        runtime_manifest: {
          schema_version: deepPayload.catalog.runtime_manifest?.schema_version,
          manifest_hash: deepPayload.catalog.runtime_manifest?.manifest_hash,
          shard_count: deepCounts.shard_count,
        },
      } : null,
    },
  );
}

export function compareInterpretations(authoritativePayload, nyraPayload, tenantId) {
  const shadow = nyraPayload?.deep_branch_v2;
  const authoritativeIds = branchIds(coreNetwork(authoritativePayload));
  const shadowCoreIds = branchIds(coreNetwork(nyraPayload?.core_router));
  const selectedIds = Array.isArray(shadow?.selected_branches)
    ? shadow.selected_branches.map((branch) => String(branch?.id || branch || "")).filter(Boolean).sort()
    : [];
  const checks = {
    tenant_match: String(nyraPayload?.tenant_id || "") === String(tenantId || ""),
    shadow_mode: shadow?.mode === "shadow",
    shadow_state: shadow?.state === "shadow_v1_authoritative",
    core_final_authority: shadow?.core_final_authority === true,
    execution_disabled: shadow?.execution_authorized === false && nyraPayload?.execution_allowed === false,
    core_route_match: JSON.stringify(authoritativeIds) === JSON.stringify(shadowCoreIds),
    v2_subset_of_core: selectedIds.every((id) => authoritativeIds.includes(id)),
  };
  const matched = nyraPayload?.ok === true && Object.values(checks).every(Boolean);
  return baseShadow(matched ? "shadow_compared_v1_authoritative" : "shadow_mismatch_v1_authoritative", {
    matched,
    parity: {
      checks,
      authoritative_opened_branches: authoritativeIds,
      shadow_core_opened_branches: shadowCoreIds,
      v2_selected_branches: selectedIds,
    },
    catalog_version: shadow?.catalog_version,
    catalog_fingerprint: shadow?.catalog_fingerprint,
    validation: shadow?.validation ? {
      ok: shadow.validation.ok === true,
      metrics: shadow.validation.metrics,
    } : undefined,
  });
}

export function unavailableShadow(reason = "nyra_v2_unavailable") {
  return baseShadow("shadow_unavailable_v1_authoritative", {
    synchronized: false,
    reason: String(reason).slice(0, 160),
  });
}

export function createNyraV2Bridge(config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = String(config.nyraRuntimeUrl || "").replace(/\/$/, "");
  const apiKey = String(config.nyraRuntimeApiKey || "");
  const timeoutMs = Math.min(Math.max(Number(config.nyraRuntimeTimeoutMs || 5_000), 250), 30_000);

  function configured() {
    return Boolean(baseUrl && apiKey);
  }

  async function request(path, { method = "GET", body } = {}) {
    if (!configured()) throw new Error("nyra_v2_bridge_not_configured");
    const headers = { accept: "application/json", authorization: `Bearer ${apiKey}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => ({ ok: false, error: "invalid_nyra_response" }));
    if (!response.ok) throw new Error(`nyra_v2_request_failed:${response.status}:${payload.error || "unknown"}`);
    return payload;
  }

  return {
    configured,
    catalog: () => request("/api/nyra/runtime/v2/catalog"),
    interpret: (body) => request("/api/nyra/runtime/interpret", { method: "POST", body }),
  };
}
