import assert from "node:assert/strict";
import test from "node:test";
import {
  githubWorkerActionDigest,
  signGitHubWorkerExecutionClaim,
  verifyGitHubWorkerExecutionClaim,
} from "../github-worker-execution-claim.js";

const secret = "execution-domain-secret-32-bytes-minimum-value";
const now = Date.parse("2026-08-14T18:00:00.000Z");
const action = {
  kind: "git.push.branch",
  repository: "customer/example",
  branch: "agent/change",
  source_commit: "a".repeat(40),
  expected_remote_commit: "b".repeat(40),
  changed_files: ["src/app.js"],
  force: false,
  delete_ref: false,
  tags: false,
  induced_effects: [],
  provider_execution: false,
};

function claim() {
  return {
    schema_version: "github_worker_execution_claim_v1",
    tenant_id: "customer-a",
    work_id: "11111111-1111-4111-8111-111111111111",
    repository: "customer/example",
    ticket_id: "hnt_ticket_1",
    reservation_id: "hnr_reservation_1",
    action,
    action_digest: githubWorkerActionDigest(action),
    issued_at: "2026-08-14T18:00:00.000Z",
    expires_at: "2026-08-14T18:02:00.000Z",
    nonce: "c".repeat(64),
    provider_execution: false,
  };
}

test("execution claim is exact, signed, short lived and one action only", () => {
  const signed = signGitHubWorkerExecutionClaim(claim(), { signing_secret: secret });
  assert.equal(verifyGitHubWorkerExecutionClaim(signed, { signing_secret: secret, now }).ticket_id, "hnt_ticket_1");
  assert.throws(() => verifyGitHubWorkerExecutionClaim({ ...signed, repository: "other/repo" }, { signing_secret: secret, now }), /action_invalid|signature_invalid/);
  assert.throws(() => verifyGitHubWorkerExecutionClaim({ ...signed, action: { ...action, force: true } }, { signing_secret: secret, now }), /digest_mismatch/);
  assert.throws(() => verifyGitHubWorkerExecutionClaim(signed, { signing_secret: secret, now: Date.parse("2026-08-14T18:03:00.000Z") }), /expired/);
  assert.equal(verifyGitHubWorkerExecutionClaim(signed, {
    signing_secret: secret,
    now: Date.parse("2026-08-14T19:00:00.000Z"),
    allow_expired_for_reconciliation: true,
  }).ticket_id, "hnt_ticket_1");
  assert.throws(() => signGitHubWorkerExecutionClaim({ ...claim(), action: { ...action, kind: "provider.api.call" } }, { signing_secret: secret }), /action_invalid/);
  const mergeAction = { ...action, kind: "github.merge" };
  assert.throws(() => signGitHubWorkerExecutionClaim({
    ...claim(), action: mergeAction, action_digest: githubWorkerActionDigest(mergeAction),
  }, { signing_secret: secret }), /action_invalid/);
});
