const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const {
  applySecurityHeaders,
  createCorsMiddleware,
  createPersistenceCommitBarrier
} = require("../server");
const { PostgresPersistenceAdapter } = require("../src/PostgresPersistenceAdapter");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function request(server, options = {}) {
  const address = server.address();
  const body = options.body === undefined ? null : JSON.stringify(options.body);
  const headers = {
    ...(options.headers || {})
  };
  if (body !== null) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const req = http.request({
      host: "127.0.0.1",
      port: address.port,
      path: options.path || "/health",
      method: options.method || "GET",
      headers
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text,
          durationMs: Date.now() - startedAt
        });
      });
    });
    req.on("error", reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

async function main() {
  const allowedOrigin = "https://allowed.smartdesk.test";
  const deniedOrigin = "https://denied.smartdesk.test";
  const adapter = new PostgresPersistenceAdapter("postgres://smartdesk-local-sandbox");
  let completedDatabaseWrites = 0;
  adapter.pool = {
    query: async (_sql, parameters) => {
      const payload = JSON.parse(parameters[1]);
      await delay(25);
      if (payload.fail === true) {
        throw new Error("simulated_database_private_detail");
      }
      completedDatabaseWrites += 1;
      return { rows: [] };
    }
  };

  const testApp = express();
  testApp.set("trust proxy", 1);
  testApp.disable("x-powered-by");
  testApp.use(applySecurityHeaders);
  testApp.use(createCorsMiddleware(() => new Set([allowedOrigin])));
  testApp.use(express.json());
  testApp.use(createPersistenceCommitBarrier(() => adapter));
  testApp.get("/health", (_req, res) => res.json({ ok: true }));
  testApp.get("/fleet-intelligence", (_req, res) => res.send("fleet"));
  testApp.post("/api/write", (req, res) => {
    void adapter.enqueueWrite("http_security_test", req.body || {});
    res.status(201).json({ success: true });
  });

  const server = await new Promise((resolve, reject) => {
    const instance = testApp.listen(0, "127.0.0.1", () => resolve(instance));
    instance.on("error", reject);
  });

  try {
    const allowed = await request(server, {
      headers: {
        Origin: allowedOrigin,
        "X-Forwarded-Proto": "https"
      }
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers["access-control-allow-origin"], allowedOrigin);
    assert.match(allowed.headers.vary || "", /Origin/i);
    assert.match(allowed.headers["content-security-policy"] || "", /frame-ancestors 'none'/);
    assert.doesNotMatch(allowed.headers["content-security-policy"] || "", /script-src[^;]*'unsafe-inline'/);
    assert.equal(allowed.headers["x-content-type-options"], "nosniff");
    assert.equal(allowed.headers["x-frame-options"], "DENY");
    assert.equal(allowed.headers["referrer-policy"], "strict-origin-when-cross-origin");
    assert.equal(allowed.headers["strict-transport-security"], "max-age=31536000; includeSubDomains");
    assert.equal(allowed.headers["x-powered-by"], undefined);

    const legacyInlinePage = await request(server, {
      path: "/fleet-intelligence",
      headers: { Origin: allowedOrigin }
    });
    assert.equal(legacyInlinePage.status, 200);
    assert.match(
      legacyInlinePage.headers["content-security-policy"] || "",
      /script-src[^;]*'unsafe-inline'/
    );

    const withoutOrigin = await request(server);
    assert.equal(withoutOrigin.status, 200);
    assert.notEqual(withoutOrigin.headers["access-control-allow-origin"], "*");

    const denied = await request(server, {
      headers: { Origin: deniedOrigin }
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers["access-control-allow-origin"], undefined);
    assert.equal(JSON.parse(denied.text).code, "cors_origin_denied");

    const preflight = await request(server, {
      method: "OPTIONS",
      path: "/api/write",
      headers: {
        Origin: allowedOrigin,
        "Access-Control-Request-Method": "POST"
      }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers["access-control-allow-origin"], allowedOrigin);
    assert.match(preflight.headers["access-control-allow-methods"] || "", /POST/);

    const deniedWritesBefore = completedDatabaseWrites;
    const deniedMutation = await request(server, {
      method: "POST",
      path: "/api/write",
      headers: { Origin: deniedOrigin },
      body: { value: "must_not_run" }
    });
    assert.equal(deniedMutation.status, 403);
    assert.equal(completedDatabaseWrites, deniedWritesBefore);

    const successfulMutation = await request(server, {
      method: "POST",
      path: "/api/write",
      headers: { Origin: allowedOrigin },
      body: { value: "sandbox_success" }
    });
    assert.equal(successfulMutation.status, 201);
    assert.equal(successfulMutation.headers["x-smartdesk-persistence"], "confirmed");
    assert.equal(successfulMutation.headers["cache-control"], "no-store");
    assert.equal(completedDatabaseWrites, deniedWritesBefore + 1);

    const failedMutation = await request(server, {
      method: "POST",
      path: "/api/write",
      headers: { Origin: allowedOrigin },
      body: { fail: true }
    });
    assert.equal(failedMutation.status, 503);
    assert.equal(failedMutation.headers["x-smartdesk-persistence"], "failed");
    const failedPayload = JSON.parse(failedMutation.text);
    assert.equal(failedPayload.code, "persistence_sync_failed");
    assert.equal(failedMutation.text.includes("private_detail"), false);

    const healthSamples = await Promise.all(
      Array.from({ length: 40 }, () => request(server, {
        headers: { Origin: allowedOrigin }
      }))
    );
    assert.ok(healthSamples.every((sample) => sample.status === 200));
    const healthDurations = healthSamples
      .map((sample) => sample.durationMs)
      .sort((left, right) => left - right);
    const healthAverageMs = Number((
      healthDurations.reduce((total, value) => total + value, 0) / healthDurations.length
    ).toFixed(2));
    const healthP95Ms = healthDurations[Math.ceil(healthDurations.length * 0.95) - 1];
    assert.ok(healthP95Ms < 1000, `health_p95_too_high:${healthP95Ms}`);

    console.log(JSON.stringify({
      ok: true,
      suite: "http_security_policy",
      assertions: {
        exactOriginCors: true,
        wildcardCorsRemoved: true,
        deniedOriginCannotReachMutation: true,
        securityHeadersPresent: true,
        inlineScriptExceptionIsRouteScoped: true,
        frameworkHeaderRemoved: true,
        successfulMutationWaitsForPersistence: true,
        failedPersistenceReturnsSafe503: true
      },
      performance: {
        persistenceDelayMs: 25,
        successfulMutationResponseMs: successfulMutation.durationMs,
        concurrentHealthRequests: healthDurations.length,
        healthAverageMs,
        healthP95Ms,
        healthMaxMs: healthDurations.at(-1)
      }
    }, null, 2));
  } finally {
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : "http_security_policy_test_failed");
  process.exitCode = 1;
});
