import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SERVICE_VERSION = "0.3.1-suite-runbook-alignment";
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

function sanitizeId(value, fallbackPrefix) {
  const raw = String(value || "").trim();
  const cleaned = raw.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120);
  return cleaned || `${fallbackPrefix}_${crypto.randomUUID()}`;
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
      };
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

export function createSuiteControlPlane(options = {}) {
  const app = express();
  const storage = options.storage || createSuiteControlStorage();
  const auth = createAuth();

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      service: "skinharmony-suite-control-plane",
      version: SERVICE_VERSION,
      storage_mode: storage.mode,
      storage_persistent: storage.mode === "file",
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
