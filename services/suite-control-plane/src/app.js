import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SENSITIVE_ACTIONS, validateGovernanceRequest } from "./governance.js";

const SERVICE_VERSION = "0.3.5-governance-runtime";
const DEFAULT_MAX_EVENTS_PER_NODE = 250;
const RUNBOOK_CATALOG = [
  {
    id: "site_clone_readiness",
    label: "Template clone readiness",
    category: "provisioning",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Verifica se un nodo WordPress e pronto per clone template, senza clonare o modificare il sito.",
  },
  {
    id: "plugin_update_preflight",
    label: "Plugin update preflight",
    category: "release",
    risk: "high",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Prepara controlli per aggiornamento plugin: versione, manifest, rollback e stato nodo.",
  },
  {
    id: "claim_price_guard_scan",
    label: "Claim and price guard scan",
    category: "governance",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Richiede una scansione controllata di claim, prezzi e policy commerciali.",
  },
  {
    id: "smartdesk_bridge_check",
    label: "Smart Desk bridge check",
    category: "integration",
    risk: "low",
    owner_confirmation_required: false,
    execution_mode: "proposal_only",
    description: "Controlla readiness bridge Smart Desk e produce prossime azioni senza inviare dati cliente raw.",
  },
  {
    id: "clone_waas_site",
    label: "Clone sito WaaS",
    category: "provisioning",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Prepara il piano controllato per clone template WaaS senza creare o modificare siti.",
  },
  {
    id: "setup_site_suite",
    label: "Setup Suite cliente",
    category: "configuration",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Prepara checklist e bozza setup Suite per cliente, senza scrivere configurazioni sul nodo.",
  },
  {
    id: "claim_price_audit",
    label: "Verifica claim/prezzi",
    category: "governance",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Accetta il runbook Suite locale per verifica claim e prezzi, come richiesta controllata read-only.",
  },
  {
    id: "customer_report",
    label: "Report cliente",
    category: "reporting",
    risk: "low",
    owner_confirmation_required: false,
    execution_mode: "proposal_only",
    description: "Accoda la generazione di un report cliente controllato usando solo summary e stato nodo.",
  },
  {
    id: "smartdesk_gold_customer_intelligence_sync",
    label: "Smart Desk Gold Customer Intelligence",
    category: "smartdesk_gold",
    risk: "low",
    owner_confirmation_required: false,
    execution_mode: "proposal_only",
    description: "Verifica contratto Customer Intelligence, consensi e readiness Gold senza inviare messaggi o modificare dati cliente.",
  },
  {
    id: "customer_360_profile_review",
    label: "Customer 360 profile review",
    category: "customer_intelligence",
    risk: "low",
    owner_confirmation_required: false,
    execution_mode: "proposal_only",
    description: "Prepara una revisione profilo cliente leggendo solo summary e readiness Core.",
  },
  {
    id: "journey_builder_guarded_draft",
    label: "Journey builder controllato",
    category: "marketing_governance",
    risk: "medium",
    owner_confirmation_required: true,
    execution_mode: "proposal_only",
    description: "Prepara bozze journey marketing governate da Core; nessun invio automatico e conferma owner/operatore obbligatoria.",
  },
];

function nowIso() {
  return new Date().toISOString();
}

function readSecret(req) {
  const auth = req.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.get("x-sh-suite-key") || req.get("x-api-key") || "";
}

function publicError(res, status, code, message = code) {
  return res.status(status).json({ ok: false, error: code, message });
}

function normalizeBaseUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function sanitizeId(value, fallbackPrefix) {
  const raw = String(value || "").trim();
  const cleaned = raw.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120);
  return cleaned || `${fallbackPrefix}_${crypto.randomUUID()}`;
}

function isGovernanceSensitiveAction(action = {}) {
  return Boolean(action?.scope?.sensitive_action) || SENSITIVE_ACTIONS.has(action?.action_type);
}


function uniqueValues(values) {
  return [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))];
}

function nodeReadiness(node) {
  const capabilities = Array.isArray(node?.latest_heartbeat?.capabilities) ? node.latest_heartbeat.capabilities : [];
  const validation = node?.latest_snapshot?.validation || {};
  const controlPlane = node?.latest_snapshot?.control_plane || {};
  const checks = {
    heartbeat: Boolean(node?.latest_heartbeat),
    snapshot: Boolean(node?.latest_snapshot),
    evidence: Number(node?.evidence_count || 0) > 0,
    change_impact_contract: Boolean(node?.latest_snapshot?.change_impact_orchestration),
    manifest_integrity: validation.manifest_integrity_ready === true,
    runbook_receiver: capabilities.includes("runbook_receiver") || controlPlane.runbook_receiver_ready === true,
    core_bridge: capabilities.includes("control_plane") || controlPlane.core_bridge_ready === true,
  };
  const missing = Object.entries(checks)
    .filter(([, ready]) => !ready)
    .map(([key]) => key);
  const criticalIssues = Array.isArray(validation.critical_issues)
    ? validation.critical_issues.map(String).filter(Boolean)
    : [];

  return {
    status: criticalIssues.length ? "blocked" : missing.length ? "warning" : "ready",
    score: Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100),
    checks,
    missing,
    critical_issues: criticalIssues,
    next_actions: [
      ...(checks.heartbeat ? [] : ["send_node_heartbeat"]),
      ...(checks.snapshot ? [] : ["send_node_snapshot"]),
      ...(checks.change_impact_contract ? [] : ["attach_change_impact_contract"]),
      ...(checks.manifest_integrity ? [] : ["verify_release_manifest_integrity"]),
      ...(checks.runbook_receiver ? [] : ["enable_runbook_receiver_capability"]),
      ...(checks.core_bridge ? [] : ["verify_core_bridge_capability"]),
      ...(checks.evidence ? [] : ["write_first_core_evidence"]),
    ],
  };
}

function summarizeEvidence(events = []) {
  const byType = {};
  const byDecision = {};
  const byRisk = {};
  for (const event of events) {
    byType[event.evidence_type] = (byType[event.evidence_type] || 0) + 1;
    if (event.decision) byDecision[event.decision] = (byDecision[event.decision] || 0) + 1;
    if (event.risk) byRisk[event.risk] = (byRisk[event.risk] || 0) + 1;
  }
  return {
    total: events.length,
    by_type: byType,
    by_decision: byDecision,
    by_risk: byRisk,
    latest: events.slice(0, 10),
  };
}

function getRunbook(runbookId) {
  const id = sanitizeId(runbookId, "runbook");
  return RUNBOOK_CATALOG.find((runbook) => runbook.id === id) || null;
}

function buildRunbookPreview(runbook, node) {
  const nodeOnline = node && node.status === "online";
  const hasSnapshot = Boolean(node && node.latest_snapshot);
  const blocking = [];
  if (!node) blocking.push("node_not_registered");
  if (node && !nodeOnline) blocking.push("node_not_online");
  if (node && !hasSnapshot) blocking.push("snapshot_missing");

  const state = blocking.length === 0 ? "ready_for_owner_confirmation" : "blocked_until_node_ready";
  return {
    runbook_id: runbook.id,
    label: runbook.label,
    category: runbook.category,
    risk: runbook.risk,
    execution_mode: runbook.execution_mode,
    owner_confirmation_required: runbook.owner_confirmation_required,
    state,
    blocking,
    next_action: blocking.length === 0
      ? "Chiedere conferma owner e inviare al nodo solo come richiesta controllata."
      : "Registrare heartbeat/snapshot del nodo prima di preparare dispatch.",
  };
}

function buildEcosystemTracks(overview, runbooks, coreStatus) {
  const list = Array.isArray(runbooks) ? runbooks : [];
  const nodes = Array.isArray(overview?.nodes) ? overview.nodes : [];
  const suiteRunbooks = list.filter((runbook) => [
    "provisioning",
    "configuration",
    "release",
    "governance",
    "reporting",
  ].includes(runbook.category));
  const smartDeskRunbooks = list.filter((runbook) => [
    "integration",
    "smartdesk_gold",
    "customer_intelligence",
    "marketing_governance",
  ].includes(runbook.category));

  return {
    schema_version: "suite_ecosystem_tracks_v1",
    generated_at: nowIso(),
    core: {
      configured: Boolean(coreStatus?.configured),
      tenant_id: coreStatus?.tenant_id || "",
      provider_url: coreStatus?.provider_url || "",
    },
    suite_provider_track: {
      purpose: "vendere, configurare e governare nodi WordPress/Suite, tenant, runbook, audit e update controllati.",
      status: nodes.length ? "active" : "waiting_for_first_node",
      nodes_total: overview?.nodes_total || 0,
      nodes_online: overview?.nodes_online || 0,
      runbooks: suiteRunbooks.map((runbook) => ({
        id: runbook.id,
        label: runbook.label,
        category: runbook.category,
        risk: runbook.risk,
        owner_confirmation_required: runbook.owner_confirmation_required,
      })),
      next_actions: nodes.length
        ? ["verificare snapshot nodi", "accodare runbook solo con conferma quando richiesto", "salvare evidence/artifact"]
        : ["collegare primo nodo Suite/WordPress", "registrare heartbeat", "inviare snapshot readiness"],
    },
    smartdesk_gold_track: {
      purpose: "leggere operativita centro, profilazione cliente, consenso, marketing Gold e Customer Intelligence tramite Core.",
      status: coreStatus?.configured ? "core_ready" : "core_not_configured",
      runbooks: smartDeskRunbooks.map((runbook) => ({
        id: runbook.id,
        label: runbook.label,
        category: runbook.category,
        risk: runbook.risk,
        owner_confirmation_required: runbook.owner_confirmation_required,
      })),
      guardrails: [
        "nessun invio automatico",
        "consenso marketing obbligatorio",
        "operatore conferma sempre",
        "Core decide readiness/rischio",
      ],
      next_actions: [
        "mostrare stato Customer Intelligence Gold in Suite",
        "collegare report readiness per tenant",
        "preparare Customer 360 e journey controllato come runbook",
      ],
    },
  };
}

function createMemoryStorage(options = {}) {
  const nodes = new Map((options.nodes || []).map((node) => [node.node_id, node]));
  const evidence = Array.isArray(options.evidence) ? options.evidence : [];
  const dispatches = Array.isArray(options.dispatches) ? options.dispatches : [];
  const artifacts = Array.isArray(options.artifacts) ? options.artifacts : [];
  const onChange = typeof options.onChange === "function" ? options.onChange : () => {};

  function emitChange() {
    onChange({ nodes: Array.from(nodes.values()), evidence, dispatches, artifacts });
  }

  function getOrCreateNode(nodeId, tenantId = "unknown") {
    const id = sanitizeId(nodeId, "node");
    if (!nodes.has(id)) {
      nodes.set(id, {
        node_id: id,
        tenant_id: sanitizeId(tenantId, "tenant"),
        first_seen_at: nowIso(),
        last_seen_at: null,
        status: "registered",
        runtime_mode: "remote",
        topology: "shared",
        heartbeat_count: 0,
        snapshot_count: 0,
        evidence_count: 0,
        latest_heartbeat: null,
        latest_snapshot: null,
        events: [],
      });
    }
    return nodes.get(id);
  }

  function appendNodeEvent(node, type, payload) {
    node.events.unshift({
      id: `${type}_${crypto.randomUUID()}`,
      type,
      created_at: nowIso(),
      payload,
    });

    if (node.events.length > DEFAULT_MAX_EVENTS_PER_NODE) {
      node.events.length = DEFAULT_MAX_EVENTS_PER_NODE;
    }
  }

  return {
    mode: "memory",
    heartbeat(payload) {
      const node = getOrCreateNode(payload.node_id, payload.tenant_id);
      node.tenant_id = sanitizeId(payload.tenant_id || node.tenant_id, "tenant");
      node.last_seen_at = nowIso();
      node.status = payload.status || "online";
      node.runtime_mode = payload.runtime_mode || node.runtime_mode;
      node.topology = payload.topology || node.topology;
      node.heartbeat_count += 1;
      node.latest_heartbeat = {
        received_at: node.last_seen_at,
        plugin_version: payload.plugin_version || null,
        wp_version: payload.wp_version || null,
        site_url: payload.site_url || null,
        capabilities: Array.isArray(payload.capabilities) ? payload.capabilities.map(String) : [],
        health: payload.health && typeof payload.health === "object" ? payload.health : {},
      },
      appendNodeEvent(node, "heartbeat", node.latest_heartbeat);
      emitChange();
      return node;
    },
    snapshot(payload) {
      const node = getOrCreateNode(payload.node_id, payload.tenant_id);
      node.snapshot_count += 1;
      node.last_seen_at = nowIso();
      node.latest_snapshot = {
        received_at: node.last_seen_at,
        summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
        control_plane: payload.control_plane && typeof payload.control_plane === "object" ? payload.control_plane : {},
        validation: payload.validation && typeof payload.validation === "object" ? payload.validation : {},
        change_impact_orchestration: payload.change_impact_orchestration && typeof payload.change_impact_orchestration === "object" ? payload.change_impact_orchestration : null,
      };
      appendNodeEvent(node, "snapshot", node.latest_snapshot);
      emitChange();
      return node;
    },
    evidence(payload) {
      const node = getOrCreateNode(payload.node_id, payload.tenant_id);
      const event = {
        id: `evidence_${crypto.randomUUID()}`,
        received_at: nowIso(),
        node_id: node.node_id,
        tenant_id: node.tenant_id,
        evidence_type: String(payload.evidence_type || "suite_event"),
        decision: payload.decision || null,
        risk: payload.risk || null,
        audit_id: payload.audit_id || null,
        payload: payload.payload && typeof payload.payload === "object" ? payload.payload : {},
      };
      evidence.unshift(event);
      node.evidence_count += 1;
      node.last_seen_at = event.received_at;
      appendNodeEvent(node, "evidence", event);
      emitChange();
      return { node, event };
    },
    runbookCatalog() {
      return RUNBOOK_CATALOG;
    },
    runbookPreview(payload) {
      const runbook = getRunbook(payload.runbook_id);
      if (!runbook) return null;
      const node = nodes.get(sanitizeId(payload.node_id, "node")) || null;
      return buildRunbookPreview(runbook, node);
    },
    runbookDispatch(payload) {
      const runbook = getRunbook(payload.runbook_id);
      if (!runbook) return null;
      const node = nodes.get(sanitizeId(payload.node_id, "node")) || null;
      const preview = buildRunbookPreview(runbook, node);
      const ownerConfirmed = payload.owner_confirmed === true || payload.owner_confirmed === "true" || payload.owner_confirmed === "yes";
      const accepted = preview.state === "ready_for_owner_confirmation"
        && (!runbook.owner_confirmation_required || ownerConfirmed);
      const dispatch = {
        id: `dispatch_${crypto.randomUUID()}`,
        created_at: nowIso(),
        runbook_id: runbook.id,
        node_id: node ? node.node_id : sanitizeId(payload.node_id, "node"),
        tenant_id: node ? node.tenant_id : sanitizeId(payload.tenant_id, "tenant"),
        state: accepted ? "queued_for_node_pull" : "not_queued",
        accepted,
        owner_confirmed: ownerConfirmed,
        execution_mode: runbook.execution_mode,
        risk: runbook.risk,
        preview,
        payload: payload.payload && typeof payload.payload === "object" ? payload.payload : {},
      };
      dispatches.unshift(dispatch);
      if (dispatches.length > 1000) dispatches.length = 1000;
      if (node) {
        appendNodeEvent(node, "runbook_dispatch", dispatch);
      }
      emitChange();
      return dispatch;
    },
    runbookArtifact(payload) {
      const node = getOrCreateNode(payload.node_id, payload.tenant_id);
      const artifact = {
        id: `artifact_${crypto.randomUUID()}`,
        received_at: nowIso(),
        node_id: node.node_id,
        tenant_id: node.tenant_id,
        runbook_id: sanitizeId(payload.runbook_id, "runbook"),
        artifact_type: sanitizeId(payload.artifact_type || "runbook_execution_record", "artifact_type"),
        signature: String(payload.signature || ""),
        source: String(payload.source || "wordpress_node"),
        payload: payload.payload && typeof payload.payload === "object" ? payload.payload : {},
      };
      artifacts.unshift(artifact);
      if (artifacts.length > 1000) artifacts.length = 1000;
      node.last_seen_at = artifact.received_at;
      node.runbook_artifact_count = (node.runbook_artifact_count || 0) + 1;
      appendNodeEvent(node, "runbook_artifact", artifact);
      emitChange();
      return { node, artifact };
    },
    runbookArtifacts(nodeId, limit = 50) {
      const id = sanitizeId(nodeId, "node");
      return artifacts.filter((item) => item.node_id === id).slice(0, limit);
    },
    dashboard(nodeId) {
      const node = nodes.get(sanitizeId(nodeId, "node"));
      if (!node) return null;
      return {
        node,
        recent_events: node.events.slice(0, 50),
        evidence: evidence.filter((item) => item.node_id === node.node_id).slice(0, 50),
        dispatches: dispatches.filter((item) => item.node_id === node.node_id).slice(0, 50),
        runbook_artifacts: artifacts.filter((item) => item.node_id === node.node_id).slice(0, 50),
      };
    },
    overview() {
      const allNodes = Array.from(nodes.values());
      return {
        nodes_total: allNodes.length,
        nodes_online: allNodes.filter((node) => node.status === "online").length,
        evidence_total: evidence.length,
        dispatches_total: dispatches.length,
        runbook_artifacts_total: artifacts.length,
        runbooks_total: RUNBOOK_CATALOG.length,
        nodes: allNodes
          .map((node) => ({
            node_id: node.node_id,
            tenant_id: node.tenant_id,
            status: node.status,
            last_seen_at: node.last_seen_at,
            heartbeat_count: node.heartbeat_count,
            snapshot_count: node.snapshot_count,
            evidence_count: node.evidence_count,
            runbook_artifact_count: node.runbook_artifact_count || 0,
          }))
          .sort((a, b) => String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || ""))),
      };
    },
    tenantDashboard(tenantId) {
      const tenantKey = sanitizeId(tenantId, "tenant");
      const tenantNodes = Array.from(nodes.values()).filter((node) => node.tenant_id === tenantKey);
      const tenantEvidence = evidence.filter((item) => item.tenant_id === tenantKey);
      const readiness = tenantNodes.map((node) => ({
        node_id: node.node_id,
        tenant_id: node.tenant_id,
        status: node.status,
        runtime_mode: node.runtime_mode,
        topology: node.topology,
        last_seen_at: node.last_seen_at,
        heartbeat_count: node.heartbeat_count,
        snapshot_count: node.snapshot_count,
        evidence_count: node.evidence_count,
        runbook_artifact_count: node.runbook_artifact_count || 0,
        readiness: nodeReadiness(node),
      }));
      const blocked = readiness.filter((item) => item.readiness.status === "blocked").length;
      const warnings = readiness.filter((item) => item.readiness.status === "warning").length;
      const ready = readiness.filter((item) => item.readiness.status === "ready").length;
      return {
        tenant_id: tenantKey,
        generated_at: nowIso(),
        nodes_total: tenantNodes.length,
        nodes_online: tenantNodes.filter((node) => node.status === "online").length,
        readiness_status: blocked ? "blocked" : warnings || !tenantNodes.length ? "warning" : "ready",
        readiness_summary: {
          ready,
          warning: warnings,
          blocked,
          average_score: readiness.length
            ? Math.round(readiness.reduce((sum, item) => sum + item.readiness.score, 0) / readiness.length)
            : 0,
        },
        next_actions: uniqueValues(readiness.flatMap((item) => item.readiness.next_actions)),
        nodes: readiness.sort((a, b) => String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || ""))),
        evidence: summarizeEvidence(tenantEvidence),
      };
    },
    controlPlaneDashboard() {
      const tenantIds = uniqueValues(Array.from(nodes.values()).map((node) => node.tenant_id));
      const tenants = tenantIds.map((tenantId) => this.tenantDashboard(tenantId));
      const blocked = tenants.filter((tenant) => tenant.readiness_status === "blocked").length;
      const warnings = tenants.filter((tenant) => tenant.readiness_status === "warning").length;
      const ready = tenants.filter((tenant) => tenant.readiness_status === "ready").length;
      return {
        generated_at: nowIso(),
        mode: "control_plane_first",
        execution_allowed: false,
        positioning: "Suite Control Plane read-only: stato tenant, nodi, Core bridge, evidence e readiness senza esecuzione automatica.",
        totals: {
          tenants: tenants.length,
          nodes: Array.from(nodes.values()).length,
          evidence: evidence.length,
          ready,
          warning: warnings,
          blocked,
        },
        next_actions: uniqueValues(tenants.flatMap((tenant) => tenant.next_actions)),
        tenants,
      };
    }

  };
}

function createSuiteControlStorage() {
  const storageRoot = process.env.SUITE_CONTROL_STORAGE_ROOT || "";
  if (!storageRoot) return createMemoryStorage();

  fs.mkdirSync(storageRoot, { recursive: true });
  const stateFile = path.join(storageRoot, "suite-control-state.json");
  let initialState = { nodes: [], evidence: [], dispatches: [], artifacts: [] };
  if (fs.existsSync(stateFile)) {
    try {
      initialState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
      initialState = { nodes: [], evidence: [], dispatches: [], artifacts: [] };
    }
  }

  const storage = createMemoryStorage({
    nodes: Array.isArray(initialState.nodes) ? initialState.nodes : [],
    evidence: Array.isArray(initialState.evidence) ? initialState.evidence : [],
    dispatches: Array.isArray(initialState.dispatches) ? initialState.dispatches : [],
    artifacts: Array.isArray(initialState.artifacts) ? initialState.artifacts : [],
    onChange(state) {
      const tmpFile = `${stateFile}.tmp`;
      fs.writeFileSync(tmpFile, `${JSON.stringify({
        saved_at: nowIso(),
        nodes: state.nodes,
        evidence: state.evidence.slice(0, 1000),
        dispatches: state.dispatches.slice(0, 1000),
        artifacts: state.artifacts.slice(0, 1000),
      }, null, 2)}\n`);
      fs.renameSync(tmpFile, stateFile);
    },
  });
  storage.mode = "file";
  storage.state_file = stateFile;
  return storage;
}

function createAuth() {
  const configuredKey = process.env.SUITE_CONTROL_PLANE_API_KEY || "";
  const devKey = process.env.NODE_ENV === "production" ? "" : "dev-suite-control-plane-key";
  const expected = configuredKey || devKey;

  return (req, res, next) => {
    if (!expected) return publicError(res, 503, "suite_control_plane_key_not_configured");
    if (readSecret(req) !== expected) return publicError(res, 401, "suite_control_plane_key_invalid");
    return next();
  };
}

function createUniversalCoreClient(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.UNIVERSAL_CORE_URL);
  const apiKey = String(options.apiKey || process.env.UNIVERSAL_CORE_KEY || "").trim();
  const defaultTenantId = sanitizeId(options.tenantId || process.env.UNIVERSAL_CORE_TENANT_ID || "suite-control-plane", "tenant");
  const timeoutMs = Number(options.timeoutMs || process.env.UNIVERSAL_CORE_TIMEOUT_MS || 8000);

  async function request(method, route, body, tenantId = defaultTenantId) {
    if (!baseUrl || !apiKey) {
      return { success: false, code: "universal_core_not_configured" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}${route}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          "x-sh-tenant-id": tenantId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text };
      }
      return {
        success: response.ok && json.ok !== false,
        http_status: response.status,
        provider_url: baseUrl,
        ...json,
      };
    } catch (error) {
      return {
        success: false,
        code: error?.name === "AbortError" ? "universal_core_timeout" : "universal_core_unreachable",
        provider_url: baseUrl,
        message: error instanceof Error ? error.message : "Universal Core non raggiungibile.",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    isConfigured: () => Boolean(baseUrl && apiKey),
    status: () => ({ configured: Boolean(baseUrl && apiKey), provider_url: baseUrl, tenant_id: defaultTenantId }),
    customerIntelligenceContract: (tenantId = defaultTenantId) => request("GET", `/v1/customer-intelligence/contract?tenant_id=${encodeURIComponent(tenantId)}`, undefined, tenantId),
    customerIntelligenceReadiness: (payload = {}, tenantId = defaultTenantId) => request("POST", "/v1/customer-intelligence/readiness", {
      tenant_id: tenantId,
      events: Array.isArray(payload.events) ? payload.events : [],
      consents: Array.isArray(payload.consents) ? payload.consents : [],
      customer_profile: payload.customer_profile || payload.customerProfile || {},
    }, tenantId),
    actionMediation: (tenantId = defaultTenantId, payload = {}) => request("POST", "/v1/action-mediation/evaluate", payload, tenantId),
  };
}

export function createSuiteControlPlane(options = {}) {
  const app = express();
  const storage = options.storage || createSuiteControlStorage();
  const coreClient = options.coreClient || createUniversalCoreClient(options.universalCore || {});
  const auth = createAuth();

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      service: "skinharmony-suite-control-plane",
      version: SERVICE_VERSION,
      storage_mode: storage.mode,
      storage_persistent: storage.mode === "file",
      universal_core: coreClient.status(),
      generated_at: nowIso(),
    });
  });

  app.get("/api/suite/overview", auth, (req, res) => {
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      overview: storage.overview(),
    });
  });


  app.get("/api/suite/control-plane/dashboard", auth, (req, res) => {
    const dashboard = storage.controlPlaneDashboard();
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      dashboard: {
        ...dashboard,
        tenants: dashboard.tenants.map((tenant) => ({
          ...tenant,
          core_bridge: coreClient.status(),
        })),
      },
    });
  });

  app.get("/api/suite/tenants/:tenantId/dashboard", auth, (req, res) => {
    const dashboard = storage.tenantDashboard(req.params.tenantId);
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      dashboard: {
        ...dashboard,
        core_bridge: coreClient.status(),
      },
    });
  });

  app.get("/api/suite/ecosystem/tracks", auth, (req, res) => {
    const overview = storage.overview();
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      tracks: buildEcosystemTracks(overview, storage.runbookCatalog(), coreClient.status()),
    });
  });

  app.post("/api/suite/nodes/heartbeat", auth, (req, res) => {
    const node = storage.heartbeat(req.body || {});
    res.json({
      ok: true,
      accepted: true,
      node_id: node.node_id,
      tenant_id: node.tenant_id,
      status: node.status,
      received_at: node.last_seen_at,
    });
  });

  app.post("/api/suite/nodes/snapshot", auth, (req, res) => {
    const node = storage.snapshot(req.body || {});
    res.json({
      ok: true,
      accepted: true,
      node_id: node.node_id,
      tenant_id: node.tenant_id,
      snapshot_count: node.snapshot_count,
      received_at: node.last_seen_at,
    });
  });

  app.post("/api/suite/evidence", auth, (req, res) => {
    const { node, event } = storage.evidence(req.body || {});
    res.json({
      ok: true,
      accepted: true,
      node_id: node.node_id,
      tenant_id: node.tenant_id,
      evidence_id: event.id,
      received_at: event.received_at,
    });
  });

  app.get("/api/suite/runbooks", auth, (req, res) => {
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      runbooks: storage.runbookCatalog(),
    });
  });

  app.post("/api/suite/governance/validate", auth, (req, res) => {
    const manifest = req.body?.governance_manifest || req.body?.manifest || req.body || {};
    const validation = validateGovernanceRequest(manifest);
    res.status(validation.allowed ? 200 : 409).json({
      ok: validation.allowed,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "suite_core_codex_governance_runtime",
      execution_allowed: validation.allowed && validation.status === "allow",
      validation,
    });
  });

  app.get("/api/suite/customer-intelligence/contract", auth, async (req, res) => {
    const tenantId = sanitizeId(req.query.tenant_id || req.get("x-sh-tenant-id") || coreClient.status().tenant_id || "suite-control-plane", "tenant");
    const result = await coreClient.customerIntelligenceContract(tenantId);
    if (!result.success) {
      return publicError(res, result.http_status || 503, result.code || "customer_intelligence_contract_unavailable", result.message || "Contratto Customer Intelligence non disponibile.");
    }
    return res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      source: "universal_core",
      tenant_id: tenantId,
      contract: result.contract,
    });
  });

  app.post("/api/suite/customer-intelligence/readiness", auth, async (req, res) => {
    const tenantId = sanitizeId(req.body?.tenant_id || req.get("x-sh-tenant-id") || coreClient.status().tenant_id || "suite-control-plane", "tenant");
    const result = await coreClient.customerIntelligenceReadiness(req.body || {}, tenantId);
    if (!result.success) {
      return publicError(res, result.http_status || 503, result.code || "customer_intelligence_readiness_unavailable", result.message || "Readiness Customer Intelligence non disponibile.");
    }
    return res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      source: "universal_core",
      tenant_id: tenantId,
      readiness: result.readiness,
      rule: result.rule,
    });
  });

  app.post("/api/suite/core/action-mediation", auth, async (req, res) => {
    const tenantId = sanitizeId(req.body?.tenant_id || req.get("x-sh-tenant-id") || coreClient.status().tenant_id || "suite-control-plane", "tenant");
    const action = req.body?.action || req.body || {};
    const governanceManifest = req.body?.governance_manifest || req.body?.manifest || null;

    if (governanceManifest || isGovernanceSensitiveAction(action)) {
      const validation = validateGovernanceRequest(governanceManifest || {});
      if (!validation.allowed) {
        return res.status(409).json({
          ok: false,
          service: "suite_control_plane",
          version: SERVICE_VERSION,
          mode: "suite_core_codex_governance_runtime",
          execution_allowed: false,
          error: "suite_governance_manifest_blocked",
          message: "Governance manifest mancante o non valido per azione sensibile.",
          validation,
        });
      }
    }

    const result = await coreClient.actionMediation(tenantId, {
      action,
      policy: req.body?.policy || {},
      context: {
        source: "suite_control_plane",
        no_auto_execute: true,
        governance_runtime_checked: Boolean(governanceManifest || isGovernanceSensitiveAction(action)),
        ...(req.body?.context && typeof req.body.context === "object" ? req.body.context : {}),
      },
    });
    res.status(result.http_status || (result.success ? 200 : 424)).json({
      ok: result.success,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      mode: "core_action_mediation_proxy",
      execution_allowed: false,
      core: coreClient.status(),
      result,
    });
  });

  app.post("/api/suite/runbooks/preview", auth, (req, res) => {
    const preview = storage.runbookPreview(req.body || {});
    if (!preview) return publicError(res, 404, "suite_runbook_not_found");
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      preview,
    });
  });

  app.post("/api/suite/runbooks/dispatch", auth, (req, res) => {
    const dispatch = storage.runbookDispatch(req.body || {});
    if (!dispatch) return publicError(res, 404, "suite_runbook_not_found");
    res.status(dispatch.accepted ? 202 : 409).json({
      ok: dispatch.accepted,
      accepted: dispatch.accepted,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      dispatch,
    });
  });

  app.post("/api/suite/runbooks/artifacts", auth, (req, res) => {
    const { node, artifact } = storage.runbookArtifact(req.body || {});
    res.status(201).json({
      ok: true,
      accepted: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      node_id: node.node_id,
      tenant_id: node.tenant_id,
      artifact_id: artifact.id,
      received_at: artifact.received_at,
    });
  });

  app.get("/api/suite/nodes/:nodeId/runbook-artifacts", auth, (req, res) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50)));
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      node_id: sanitizeId(req.params.nodeId, "node"),
      artifacts: storage.runbookArtifacts(req.params.nodeId, limit),
    });
  });

  app.get("/api/suite/nodes/:nodeId/dashboard", auth, (req, res) => {
    const dashboard = storage.dashboard(req.params.nodeId);
    if (!dashboard) return publicError(res, 404, "suite_node_not_found");
    res.json({
      ok: true,
      service: "suite_control_plane",
      version: SERVICE_VERSION,
      dashboard,
    });
  });

  return { app, storage };
}
