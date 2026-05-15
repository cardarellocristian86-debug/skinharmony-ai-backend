import http from "node:http";
import { runUniversalCore } from "../../../packages/core/src/index.ts";
import { runUniversalCoreDecisionV1Calibrated } from "../../../packages/core/src/decisionV1Calibrated.ts";
import type { UniversalCoreInput } from "../../../packages/contracts/src/index.ts";

type KeyRecord = {
  key: string;
  tenant_id: string;
  key_type: string;
  tier: string;
  status: "active" | "disabled";
  scopes: string[];
  branches?: string[];
};

const PORT = Number(process.env.PORT || 3000);
const MODE = process.env.UNIVERSAL_CORE_MODE || "decision_contract_v1_calibrated";
const keyRegistry: KeyRecord[] = JSON.parse(process.env.SHX_KEYS_JSON || "[]");

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error("payload_too_large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function extractToken(req: http.IncomingMessage): string | null {
  const bearer = req.headers.authorization;
  if (bearer?.startsWith("Bearer ")) return bearer.slice(7).trim();
  const direct = req.headers["x-skinharmony-core-key"] || req.headers["x-sh-core-key"] || req.headers["x-api-key"];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  return null;
}

function resolveKey(req: http.IncomingMessage): KeyRecord | null {
  const token = extractToken(req);
  if (!token) return null;
  return keyRegistry.find((entry) => entry.key === token && entry.status === "active") ?? null;
}

function ensureTenantAccess(key: KeyRecord, inputTenant?: string): boolean {
  return !inputTenant || key.tenant_id === inputTenant;
}

function normalizeInput(body: UniversalCoreInput, key: KeyRecord): UniversalCoreInput {
  return {
    ...body,
    request_id: body.request_id || `core_${Date.now()}`,
    generated_at: body.generated_at || new Date().toISOString(),
    domain: body.domain || "custom",
    context: {
      ...(body.context || {}),
      tenant_id: body.context?.tenant_id || key.tenant_id,
      metadata: body.context?.metadata || {},
    },
    signals: Array.isArray(body.signals) ? body.signals : [],
    data_quality: {
      score: Number(body.data_quality?.score ?? 70),
      ...(body.data_quality || {}),
    },
    constraints: {
      allow_automation: Boolean(body.constraints?.allow_automation),
      require_confirmation: body.constraints?.require_confirmation !== false,
      blocked_actions: Array.isArray(body.constraints?.blocked_actions) ? body.constraints.blocked_actions : [],
      blocked_action_rules: Array.isArray(body.constraints?.blocked_action_rules) ? body.constraints.blocked_action_rules : [],
      allowed_actions: Array.isArray(body.constraints?.allowed_actions) ? body.constraints.allowed_actions : [],
      permissions: Array.isArray(body.constraints?.permissions) ? body.constraints.permissions : key.scopes,
      safety_mode: body.constraints?.safety_mode !== false,
      max_control_level: body.constraints?.max_control_level,
      min_control_level: body.constraints?.min_control_level,
      state_floor: body.constraints?.state_floor,
      risk_floor: body.constraints?.risk_floor,
    },
  };
}

function runSelectedCore(input: UniversalCoreInput) {
  return MODE === "decision_contract_v1_calibrated"
    ? runUniversalCoreDecisionV1Calibrated(input)
    : runUniversalCore(input);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/healthz")) {
      return send(res, 200, {
        ok: true,
        service: "skinharmony-universal-core-api",
        mode: MODE,
        version: MODE,
      });
    }

    const key = resolveKey(req);
    if (!key) return send(res, 401, { ok: false, error: "unauthorized" });

    if (req.method === "GET" && url.pathname === "/v1/tenant/status") {
      return send(res, 200, {
        ok: true,
        tenant_id: key.tenant_id,
        key_type: key.key_type,
        tier: key.tier,
        status: key.status,
        mode: MODE,
        scopes: key.scopes,
        branches: key.branches || [],
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/decision") {
      const body = normalizeInput((await readJson(req)) as UniversalCoreInput, key);
      if (!ensureTenantAccess(key, body.context?.tenant_id)) {
        return send(res, 403, { ok: false, error: "tenant_scope_denied" });
      }

      return send(res, 200, {
        ok: true,
        mode: MODE,
        output: runSelectedCore(body),
      });
    }

    return send(res, 404, { ok: false, error: "not_found" });
  } catch (error) {
    return send(res, 500, {
      ok: false,
      error: "internal_error",
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
});

server.listen(PORT, () => {
  console.log(`[universal-core] listening on :${PORT} mode=${MODE}`);
});
