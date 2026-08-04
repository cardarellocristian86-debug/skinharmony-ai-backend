import crypto from "node:crypto";
import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json({ limit: "2mb" }));
const port = Number(process.env.PORT || 8795);
const gatewayKey = String(process.env.BROWSER_GATEWAY_KEY || "").trim();
const allowedOrigins = String(process.env.WEB_AGENT_ALLOWED_ORIGINS || "")
  .split(",").map((value) => value.trim()).filter(Boolean).map((value) => new URL(value).origin);
const contexts = new Map();
let browserPromise;

function fail(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function authorized(req) {
  const provided = Buffer.from(String(req.headers["x-browser-gateway-key"] || ""), "utf8");
  const expected = Buffer.from(gatewayKey, "utf8");
  return gatewayKey && provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

function assertOrigin(url) {
  const target = new URL(String(url || ""));
  if (!["http:", "https:"].includes(target.protocol)) fail("web_url_scheme_not_allowed");
  if (allowedOrigins.length && !allowedOrigins.includes(target.origin)) fail("web_origin_not_allowlisted", 403);
  return target;
}

async function browser() {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true });
  return browserPromise;
}

async function contextFor(tenantId) {
  const key = String(tenantId || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(key)) fail("tenant_id_invalid");
  if (!contexts.has(key)) contexts.set(key, (await browser()).newContext({ serviceWorkers: "allow" }));
  return contexts.get(key);
}

async function action(page, item) {
  const type = String(item?.type || "");
  if (type === "click") return page.locator(item.selector).click({ timeout: 10_000 });
  if (type === "fill") return page.locator(item.selector).fill(String(item.value || ""), { timeout: 10_000 });
  if (type === "type") return page.locator(item.selector).type(String(item.value || ""), { timeout: 10_000 });
  if (type === "press") return page.locator(item.selector).press(String(item.key || "Enter"), { timeout: 10_000 });
  if (type === "wait") return page.waitForTimeout(Math.min(Math.max(Number(item.ms) || 100, 100), 30_000));
  if (type === "wait_for_load") return page.waitForLoadState(item.state || "domcontentloaded", { timeout: 30_000 });
  if (type === "evaluate") return page.evaluate(String(item.script || ""));
  fail("web_browser_action_not_allowed");
}

app.get("/healthz", (_req, res) => res.json({ ok: true, service: "skinharmony-browser-runtime", browser: "chromium_playwright" }));

app.post("/v1/browser/execute", async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "browser_gateway_unauthorized" });
  let page;
  try {
    const target = assertOrigin(req.body?.url);
    const actions = Array.isArray(req.body?.actions) ? req.body.actions : [];
    if (actions.length > 40) fail("web_browser_actions_too_many");
    if (Buffer.byteLength(String(req.body?.javascript || ""), "utf8") > 100_000) fail("web_javascript_too_large");
    const pageContext = await contextFor(req.body?.tenant_id);
    page = await pageContext.newPage();
    await page.goto(target.href, { waitUntil: req.body?.wait_until || "domcontentloaded", timeout: 30_000 });
    const actionResults = [];
    for (const item of actions) actionResults.push(await action(page, item));
    const javascript = String(req.body?.javascript || "");
    const scriptResult = javascript ? await page.evaluate(async (source) => {
      const value = await (0, eval)(source);
      try { return JSON.parse(JSON.stringify(value)); } catch { return { type: typeof value }; }
    }, javascript) : null;
    const state = await page.evaluate(async () => ({
      title: document.title, url: location.href,
      text: (document.body?.innerText || "").slice(0, 200_000),
      service_workers: "serviceWorker" in navigator
        ? (await navigator.serviceWorker.getRegistrations()).map((registration) => ({
            scope: registration.scope, active: Boolean(registration.active),
            installing: Boolean(registration.installing), waiting: Boolean(registration.waiting),
          })) : [],
    }));
    const payload = { ok: true, schema_version: "web_browser_runtime_v1", browser: "chromium_playwright", state, action_results: actionResults, javascript: scriptResult };
    if (req.body?.screenshot === true) payload.screenshot_base64 = (await page.screenshot({ type: "png" })).toString("base64");
    return res.json(payload);
  } catch (error) {
    const status = Number(error.status || 500);
    return res.status(status).json({ ok: false, error: String(error.code || "web_browser_execution_failed") });
  } finally {
    await page?.close().catch(() => {});
  }
});

app.listen(port, () => console.log(`[skinharmony-browser-runtime] listening on ${port}`));
