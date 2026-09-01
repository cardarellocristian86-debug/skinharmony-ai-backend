import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  finalizeNyraCanonicalIntent,
  nyraCanonicalIntentMessageDigest,
} from "../../shared/nyra-canonical-intent.mjs";
import { createUniversalCoreService } from "../src/app.js";

function canonicalIntent(message) {
  return finalizeNyraCanonicalIntent({
    schema_version: "nyra_canonical_intent_v1",
    requested_now: [],
    future_goals: [],
    constraints: [],
    prohibited_actions: [],
    referenced_actions: [],
    owner_reserved_actions: [],
    speech_act: "QUESTION",
    operation_class: "READ_ONLY",
    scope: "GLOBAL",
    target: "advisory_read",
    work_requirement: "NONE",
    consequential_intent: false,
    confidence: 0.99,
    ambiguity: false,
    safety_signals: [],
    provenance: {
      source: "nyra_dialogue_semantic_intake",
      reason_code: "canonical_api_test",
      semantic_hint_state: "NOT_PROVIDED",
      raw_text_digest: nyraCanonicalIntentMessageDigest(message),
    },
  }, { message });
}

async function call(base, pathname, body, key) {
  const response = await fetch(`${base}${pathname}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

test("Core binds one canonical Intent across preflight and interpretation", async () => {
  const priorAdmin = process.env.CORE_SERVICE_ADMIN_KEY;
  process.env.CORE_SERVICE_ADMIN_KEY = "canonical-intent-api-admin";
  const storageRoot = path.join(os.tmpdir(), `canonical-intent-api-${Date.now()}-${Math.random()}`);
  const { app } = createUniversalCoreService({ storageRoot });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const generated = await call(base, "/v1/keys/generate", {
      tenant_id: "canonical-a",
      preset: "codex_automation",
    }, "canonical-intent-api-admin");
    assert.equal(generated.status, 201);
    const key = generated.json.key;
    const message = "Come funziona la continuità Nyra?";
    const canonical = canonicalIntent(message);
    const memory = {
      schema_version: "tenant_memory_context_v1",
      tenant_id: "canonical-a",
      revision: 1,
      relevant_memories: [],
      pending_handoffs: [],
    };
    const gallery = {
      schema_version: "tenant_work_gallery_v1",
      tenant_id: "canonical-a",
      available: true,
      state: "ready",
      work_count: 0,
      works: [],
    };
    const preflight = await call(base, "/v1/work/preflight", {
      request: message,
      operation_type: "nyra.converse",
      tool_name: "nyra_converse",
      memory_context: memory,
      gallery_context: gallery,
      canonical_intent: canonical,
    }, key);
    assert.equal(preflight.status, 200);
    const envelope = preflight.json.work_preflight;
    assert.equal(envelope.canonical_intent_binding.intent_digest, canonical.intent_digest);
    assert.equal(envelope.core_orchestration_verdict.verdict, "ALLOW");

    const interpreted = await call(base, "/v1/nira/core-bridge", {
      text: message,
      memory_context: memory,
      gallery_context: gallery,
      work_preflight: envelope,
      canonical_intent: canonical,
    }, key);
    assert.equal(interpreted.status, 200, JSON.stringify(interpreted.json));
    assert.equal(interpreted.json.result.work_preflight.canonical_intent_binding.intent_digest,
      canonical.intent_digest);
    assert.equal(interpreted.json.result.work_preflight.core_orchestration_verdict.authority,
      "UNIVERSAL_CORE");

    const drifted = await call(base, "/v1/nira/core-bridge", {
      text: message,
      memory_context: memory,
      gallery_context: gallery,
      work_preflight: {
        ...envelope,
        canonical_intent_binding: {
          ...envelope.canonical_intent_binding,
          binding_digest: "f".repeat(64),
        },
      },
      canonical_intent: canonical,
    }, key);
    assert.equal(drifted.status, 409);
    assert.equal(drifted.json.error, "nyra_canonical_intent_preflight_binding_mismatch");

    const wrongMessage = await call(base, "/v1/work/preflight", {
      request: "Un messaggio differente",
      operation_type: "nyra.converse",
      tool_name: "nyra_converse",
      memory_context: memory,
      gallery_context: gallery,
      canonical_intent: canonical,
    }, key);
    assert.equal(wrongMessage.status, 409);
    assert.equal(wrongMessage.json.error, "nyra_canonical_intent_message_binding_mismatch");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (priorAdmin === undefined) delete process.env.CORE_SERVICE_ADMIN_KEY;
    else process.env.CORE_SERVICE_ADMIN_KEY = priorAdmin;
  }
});
