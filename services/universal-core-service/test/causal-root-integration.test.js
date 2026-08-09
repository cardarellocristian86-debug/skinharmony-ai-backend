import assert from "node:assert/strict";
import test from "node:test";
import { causalRouteAuthenticatedScopes } from "../src/app.js";
import { SCOPES } from "../src/scope.js";

test("causal route authority is derived from authenticated platform scope, not caller fields", () => {
  assert.deepEqual(causalRouteAuthenticatedScopes("causal:read", {
    allowed_scopes: [SCOPES.READ_DECISION],
  }), ["causal:read"]);

  const write = causalRouteAuthenticatedScopes("causal:authorize", {
    allowed_scopes: [SCOPES.WRITE_DECISION],
  });
  assert(write.includes("causal:authorize"));
  assert(write.includes("causal:change:execute"));
  assert(write.includes("gallery:project"));
  assert(write.includes("causal:rollout"));
  assert(write.includes("core:govern"));
  assert.equal(write.includes("intent:approve:strategic"), false);

  const owner = causalRouteAuthenticatedScopes("causal:approve", {
    allowed_scopes: [SCOPES.WRITE_DECISION, SCOPES.OWNER_ASSERTION],
    scopes: ["caller:injected"],
  });
  assert(owner.includes("intent:approve:strategic"));
  assert.equal(owner.includes("caller:injected"), false);
});
