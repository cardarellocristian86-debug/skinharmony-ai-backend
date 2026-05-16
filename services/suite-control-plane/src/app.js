import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SERVICE_VERSION = "0.1.0-suite-runtime";
const DEFAULT_MAX_EVENTS_PER_NODE = 250;

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

function createMemoryStorage(options = {}) {
  const nodes = new Map((options.nodes || []).map((node) => [node.node_id, node]));
  const evidence = Array.isArray(options.evidence) ? options.evidence : [];
  const onChange = typeof options.onChange === "function" ? options.onChange : () => {};

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
      onChange({ nodes: Array.from(nodes.values()), evidence });
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
      onChange({ nodes: Array.from(nodes.values()), evidence });
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
      onChange({ nodes: Array.from(nodes.values()), evidence });
      return { node, event };
    },
    dashboard(nodeId) {
      const node = nodes.get(sanitizeId(nodeId, "node"));
      if (!node) return null;
      return {
        node,
        recent_events: node.events.slice(0, 50),
        evidence: evidence.filter((item) => item.node_id === node.node_id).slice(0, 50),
      };
    },
    overview() {
      const allNodes = Array.from(nodes.values());
      return {
        nodes_total: allNodes.length,
        nodes_online: allNodes.filter((node) => node.status === "online").length,
        evidence_total: evidence.length,
        nodes: allNodes
          .map((node) => ({
            node_id: node.node_id,
            tenant_id: node.tenant_id,
            status: node.status,
            last_seen_at: node.last_seen_at,
            heartbeat_count: node.heartbeat_count,
            snapshot_count: node.snapshot_count,
            evidence_count: node.evidence_count,
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
  let initialState = { nodes: [], evidence: [] };
  if (fs.existsSync(stateFile)) {
    try {
      initialState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
      initialState = { nodes: [], evidence: [] };
    }
  }

  const storage = createMemoryStorage({
    nodes: Array.isArray(initialState.nodes) ? initialState.nodes : [],
    evidence: Array.isArray(initialState.evidence) ? initialState.evidence : [],
    onChange(state) {
      const tmpFile = `${stateFile}.tmp`;
      fs.writeFileSync(tmpFile, `${JSON.stringify({
        saved_at: nowIso(),
        nodes: state.nodes,
        evidence: state.evidence.slice(0, 1000),
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
