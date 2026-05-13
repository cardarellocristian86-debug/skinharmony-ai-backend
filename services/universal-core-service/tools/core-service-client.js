#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usage() {
  console.log(`Usage:
  node services/universal-core-service/tools/core-service-client.js presets --url http://127.0.0.1:8787
  node services/universal-core-service/tools/core-service-client.js generate-key --url http://127.0.0.1:8787 --admin-key <admin> --tenant <tenant> --brand <brand> --preset suite_connector|smartdesk_connector|wordpress_connector|codex_automation|readonly_monitor
  node services/universal-core-service/tools/core-service-client.js verify-key --url http://127.0.0.1:8787 --key <core-key>
  node services/universal-core-service/tools/core-service-client.js decision --url http://127.0.0.1:8787 --key <core-key> --tenant <tenant>
`);
}

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return process.env[`CORE_CLIENT_${name.toUpperCase().replaceAll("-", "_")}`] || fallback;
  return process.argv[index + 1] || fallback;
}

async function request(url, method, pathName, key, body) {
  const headers = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  const response = await fetch(`${url.replace(/\/$/, "")}${pathName}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${json.error || "request_failed"}`);
  }
  return json;
}

function writeReport(name, payload) {
  const reportDir = path.resolve("reports/codex-core");
  fs.mkdirSync(reportDir, { recursive: true });
  const fullPayload = { generated_at: new Date().toISOString(), ...payload };
  fs.writeFileSync(path.join(reportDir, `${name}_latest.json`), JSON.stringify(fullPayload, null, 2), "utf8");
  return fullPayload;
}

function printEnvBlock(json, url) {
  const record = json.record || {};
  return [
    "",
    "# .env / Render",
    `UNIVERSAL_CORE_URL=${url.replace(/\/$/, "")}`,
    `UNIVERSAL_CORE_KEY=${json.key}`,
    `UNIVERSAL_CORE_TENANT_ID=${record.tenant_id || ""}`,
    `UNIVERSAL_CORE_BRAND_SCOPE=${record.brand_scope || ""}`,
    `UNIVERSAL_CORE_KEY_ID=${record.key_id || ""}`,
    "",
  ].join("\n");
}

const command = process.argv[2];
const url = arg("url", "http://127.0.0.1:8787");

try {
  if (!command || command === "--help" || command === "help") {
    usage();
    process.exit(0);
  }

  if (command === "presets") {
    const json = await request(url, "GET", "/v1/keys/presets", "", undefined);
    console.log(JSON.stringify(json, null, 2));
    process.exit(0);
  }

  if (command === "generate-key") {
    const adminKey = arg("admin-key");
    const tenant = arg("tenant");
    const brand = arg("brand", tenant);
    const type = arg("type", "connector");
    const preset = arg("preset", "");
    const label = arg("label", type === "automation" ? "Codex automation key" : "Core connector key");
    const expiresAt = arg("expires-at", "");
    if (!adminKey || !tenant) throw new Error("admin-key and tenant are required");

    const payload = {
      tenant_id: tenant,
      brand_scope: brand,
      key_type: type,
      preset: preset || null,
      label,
      expires_at: expiresAt || null,
    };
    const json = await request(url, "POST", "/v1/keys/generate", adminKey, payload);
    writeReport("core_key_generation", {
      ok: true,
      command,
      url,
      tenant_id: tenant,
      brand_scope: brand,
      preset: preset || null,
      key_id: json.record?.key_id,
      key_type: json.record?.key_type,
      allowed_scopes: json.record?.allowed_scopes || [],
      note: "La key in chiaro non viene salvata nel report. Copiarla solo da stdout/ambiente sicuro.",
    });
    console.log(JSON.stringify(json, null, 2));
    console.log(printEnvBlock(json, url));
    process.exit(0);
  }

  if (command === "verify-key") {
    const key = arg("key");
    if (!key) throw new Error("key is required");
    const json = await request(url, "GET", "/v1/tenant/status", key);
    writeReport("core_key_verification", {
      ok: true,
      command,
      url,
      tenant_id: json.tenant_id,
      brand_scope: json.brand_scope,
      key_id: json.key_id,
      key_type: json.key_type,
      allowed_scopes: json.allowed_scopes,
      status: json.status,
    });
    console.log(JSON.stringify(json, null, 2));
    process.exit(0);
  }

  if (command === "decision") {
    const key = arg("key");
    const tenant = arg("tenant");
    if (!key || !tenant) throw new Error("key and tenant are required");
    const json = await request(url, "POST", "/v1/decision", key, {
      tenant_id: tenant,
      domain: "crm",
      signals: [
        {
          id: "codex:automation_check",
          label: "Richiesta automazione Codex controllata",
          category: "automation",
          normalized_score: 64,
          confidence_hint: 82,
          evidence: [{ label: "Key scoped verificata", value: true }],
          tags: ["codex", "automation"],
        },
      ],
    });
    console.log(JSON.stringify(json, null, 2));
    process.exit(0);
  }

  throw new Error(`unknown command: ${command}`);
} catch (error) {
  const reportDir = path.resolve("reports/universal-core/core-service");
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportDir, "core_service_client_error_latest.json"),
    JSON.stringify({ ok: false, generated_at: new Date().toISOString(), command, error: error.message }, null, 2),
    "utf8",
  );
  console.error(error.message);
  process.exit(1);
}
