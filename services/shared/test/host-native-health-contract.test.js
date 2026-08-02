import assert from "node:assert/strict";
import test from "node:test";
import healthContract from "../host-native-health-contract.cjs";
import {
  HOST_NATIVE_HEALTH_CONTRACT_DIGEST as CORE_DIGEST,
  HOST_NATIVE_HEALTH_CONTRACT_VERSION as CORE_VERSION,
} from "../../universal-core-service/src/hostNativeGovernance.js";

test("shared health contract remains identical to Universal Core", () => {
  assert.equal(healthContract.HOST_NATIVE_HEALTH_CONTRACT_VERSION, CORE_VERSION);
  assert.equal(healthContract.HOST_NATIVE_HEALTH_CONTRACT_DIGEST, CORE_DIGEST);
});

test("health payload binds only a full provider build commit and fails closed", () => {
  const commit = "a".repeat(40);
  const ready = healthContract.healthPayload({
    service: "service-a", version: "1.0.0", ready: true,
    environment: { RENDER_GIT_COMMIT: commit, RENDER_DEPLOY_ID: "deploy-a" },
  });
  assert.equal(ready.render_ready, true);
  assert.equal(ready.build.commit_sha, commit);
  assert.equal(ready.build.build_id, "deploy-a");

  for (const environment of [{}, { GIT_COMMIT: "short" }]) {
    const blocked = healthContract.healthPayload({ service: "service-a", version: "1.0.0", ready: true, environment });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.render_ready, false);
    assert.equal(blocked.build.commit_verifiable, false);
  }
});
