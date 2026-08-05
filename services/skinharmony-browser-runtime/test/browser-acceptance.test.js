import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(resolve));
}

test("real Chromium acceptance covers dynamic DOM, form actions, service workers, screenshots and tenant cookie isolation", async (t) => {
  process.env.NODE_ENV = "test";
  process.env.BROWSER_GATEWAY_KEY = "acceptance-browser-key-0123456789";
  process.env.WEB_AGENT_ALLOWED_ORIGINS = "http://127.0.0.1";
  process.env.WEB_AGENT_DYNAMIC_PUBLIC_ORIGINS = "true";
  const fixture = http.createServer((req, res) => {
    if (req.url === "/sw.js") {
      res.writeHead(200, { "content-type": "application/javascript" });
      return res.end("self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));");
    }
    if (req.url === "/check") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<!doctype html><title>Cookie check</title><main id=check>check</main>");
    }
    res.writeHead(200, { "content-type": "text/html", "set-cookie": "fixture_session=tenant-a; Path=/; SameSite=Lax" });
    return res.end(`<!doctype html><title>Interactive fixture</title>
      <main><input id="name"><button id="toggle">Toggle</button><form id="form"><button id="submit" type="submit">Submit</button></form><output id="result">idle</output></main>
      <script>document.querySelector('#toggle').addEventListener('click', () => document.querySelector('#result').textContent = 'toggled'); document.querySelector('#form').addEventListener('submit', (event) => { event.preventDefault(); document.querySelector('#result').textContent = 'submitted:' + document.querySelector('#name').value; }); navigator.serviceWorker.register('/sw.js');</script>`);
  });
  const fixturePort = await listen(fixture);
  let gateway;
  let closeBrowserRuntime = async () => {};
  try {
    const gatewayModule = await import("../src/server.js");
    closeBrowserRuntime = gatewayModule.closeBrowserRuntime;
    gateway = gatewayModule.app.listen(0, "127.0.0.1");
    await new Promise((resolve) => gateway.once("listening", resolve));
    const gatewayPort = gateway.address().port;
    const invoke = async (payload) => {
      const response = await fetch(`http://127.0.0.1:${gatewayPort}/v1/browser/execute`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-browser-gateway-key": process.env.BROWSER_GATEWAY_KEY },
        body: JSON.stringify(payload),
      });
      return { status: response.status, body: await response.json() };
    };
    const interacted = await invoke({
      tenant_id: "tenant_a",
      url: `http://127.0.0.1:${fixturePort}/`,
      actions: [
        { type: "fill", selector: "#name", value: "Ada" },
        { type: "click", selector: "#toggle" },
        { type: "click", selector: "#submit" },
        { type: "wait", ms: 500 },
      ],
      javascript: "(async () => { await navigator.serviceWorker.ready; return { result: document.querySelector('#result').textContent, cookie: document.cookie, workers: (await navigator.serviceWorker.getRegistrations()).length }; })()",
      screenshot: true,
    });
    assert.equal(interacted.status, 200, JSON.stringify(interacted.body));
    assert.equal(interacted.body.browser, "chromium_playwright");
    assert.equal(interacted.body.javascript.result, "submitted:Ada");
    assert.match(interacted.body.javascript.cookie, /fixture_session=tenant-a/);
    assert.equal(interacted.body.javascript.workers, 1);
    assert.ok(interacted.body.screenshot_base64.length > 100);

    const sameTenant = await invoke({ tenant_id: "tenant_a", url: `http://127.0.0.1:${fixturePort}/check`, javascript: "document.cookie" });
    const otherTenant = await invoke({ tenant_id: "tenant_b", url: `http://127.0.0.1:${fixturePort}/check`, javascript: "document.cookie" });
    assert.match(sameTenant.body.javascript, /fixture_session=tenant-a/);
    assert.equal(otherTenant.body.javascript, "");
  } catch (error) {
    if (/Executable doesn't exist|browserType.launch|ERR_MODULE_NOT_FOUND|Cannot find package/.test(String(error?.message || error))) t.skip("Gateway dependencies and Chromium are installed by CI for this acceptance test");
    else throw error;
  } finally {
    if (gateway) await close(gateway);
    await close(fixture);
    await closeBrowserRuntime();
  }
});
