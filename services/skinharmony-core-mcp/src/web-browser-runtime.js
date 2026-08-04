import { chromium } from "playwright-core";

const MAX_ACTIONS = 40;
const MAX_SCRIPT_BYTES = 100_000;
const MAX_SCREENSHOT_BYTES = 1_500_000;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function allowed(url, origins) {
  return !origins.length || origins.includes(new URL(url).origin);
}

function safeJson(value) {
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > MAX_SCREENSHOT_BYTES) return { truncated: true };
    return JSON.parse(serialized);
  } catch {
    return { type: typeof value };
  }
}

export function createBrowserRuntime({
  wsEndpoint = "",
  executablePath = "",
  allowedOrigins = [],
  maxPages = 4,
} = {}) {
  let browserPromise;
  const contexts = new Map();

  async function browser() {
    if (!browserPromise) {
      if (wsEndpoint) browserPromise = chromium.connectOverCDP(wsEndpoint);
      else if (executablePath) browserPromise = chromium.launch({ headless: true, executablePath });
      else fail("web_browser_not_configured");
    }
    return browserPromise;
  }

  async function contextFor(tenantId) {
    const key = String(tenantId || "anonymous").slice(0, 120);
    let context = contexts.get(key);
    if (!context) {
      const instance = await browser();
      context = await instance.newContext({ serviceWorkers: "allow" });
      contexts.set(key, context);
    }
    return context;
  }

  async function applyAction(page, action) {
    const type = String(action?.type || "").trim();
    const selector = action?.selector;
    if (type === "click") return page.locator(selector).click({ timeout: 10_000 });
    if (type === "fill") return page.locator(selector).fill(String(action.value || ""), { timeout: 10_000 });
    if (type === "type") return page.locator(selector).type(String(action.value || ""), { timeout: 10_000 });
    if (type === "press") return page.locator(selector).press(String(action.key || "Enter"), { timeout: 10_000 });
    if (type === "wait") return page.waitForTimeout(Math.min(Math.max(Number(action.ms) || 100, 100), 30_000));
    if (type === "wait_for_load") return page.waitForLoadState(action.state || "domcontentloaded", { timeout: 30_000 });
    if (type === "evaluate") return page.evaluate(String(action.script || ""));
    fail("web_browser_action_not_allowed");
  }

  return {
    async execute({ tenantId, url, actions = [], javascript = "", screenshot = false, waitUntil = "domcontentloaded" }) {
      const target = new URL(String(url || ""));
      if (!["http:", "https:"].includes(target.protocol)) fail("web_url_scheme_not_allowed");
      if (!allowed(target.href, allowedOrigins)) fail("web_origin_not_allowlisted");
      if (!Array.isArray(actions) || actions.length > MAX_ACTIONS) fail("web_browser_actions_too_many");
      if (Buffer.byteLength(String(javascript || ""), "utf8") > MAX_SCRIPT_BYTES) fail("web_javascript_too_large");
      const context = await contextFor(tenantId);
      const pages = context.pages();
      if (pages.length >= maxPages) fail("web_browser_page_limit_reached");
      const page = await context.newPage();
      try {
        await page.goto(target.href, { waitUntil, timeout: 30_000 });
        const actionResults = [];
        for (const action of actions) actionResults.push(safeJson(await applyAction(page, action)));
        const scriptResult = javascript
          ? await page.evaluate(async (source) => {
              return safeJson(await (0, eval)(source));
            }, String(javascript))
          : null;
        const state = await page.evaluate(async () => ({
          title: document.title,
          url: location.href,
          text: (document.body?.innerText || "").slice(0, 200_000),
          service_workers: "serviceWorker" in navigator
            ? (await navigator.serviceWorker.getRegistrations()).map((registration) => ({
                scope: registration.scope,
                active: Boolean(registration.active),
                installing: Boolean(registration.installing),
                waiting: Boolean(registration.waiting),
              }))
            : [],
        }));
        const output = { state, action_results: actionResults, javascript: scriptResult };
        if (screenshot) {
          const bytes = await page.screenshot({ type: "png", fullPage: false });
          if (bytes.length > MAX_SCREENSHOT_BYTES) fail("web_browser_screenshot_too_large");
          output.screenshot_base64 = bytes.toString("base64");
        }
        return {
          schema_version: "web_browser_runtime_v1",
          browser: "chromium_playwright",
          ...output,
        };
      } finally {
        await page.close().catch(() => {});
      }
    },
  };
}
