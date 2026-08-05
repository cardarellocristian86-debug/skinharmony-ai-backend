import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { createPostgresResearchAirlockStore } from "../src/researchAirlockStore.js";

const DATABASE_URL = process.env.RESEARCH_AIRLOCK_DATABASE_URL || "";

test("PostgreSQL Airlock consumes a discovery capability exactly once under race", { skip: !DATABASE_URL }, async () => {
  const store = createPostgresResearchAirlockStore({ connectionString: DATABASE_URL });
  const suffix = crypto.randomUUID();
  const work = { tenant_id: `tenant-${suffix}`, project_id: "project", work_id: "work", session_id: "session" };
  const now = new Date();
  const event = { actor_digest: "a".repeat(32), request_digest: "b".repeat(64), created_at: now.toISOString() };
  const planId = `rap_${crypto.randomUUID()}`;
  const planNonceDigest = "0".repeat(64);
  await store.issuePlan({
    ...work,
    plan_id: planId,
    allowed_domains: ["nist.gov"],
    allowed_urls: ["https://www.nist.gov/ai"],
    plan_digest: "c".repeat(64),
    policy_snapshot_digest: "d".repeat(64),
    nonce_digest: planNonceDigest,
    key_version: "test-v1",
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 120_000).toISOString(),
    ...event,
  });
  const consumePlan = () => store.consumePlanAndCreateWork({
    ...work,
    plan_id: planId,
    nonce_digest: planNonceDigest,
    release_commit_sha: "e".repeat(40),
    expires_at: new Date(now.getTime() + 300_000).toISOString(),
    ...event,
  });
  const planOutcomes = await Promise.allSettled([consumePlan(), consumePlan()]);
  assert.equal(planOutcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(planOutcomes.filter((item) => item.status === "rejected").length, 1);
  assert.match(planOutcomes.find((item) => item.status === "rejected").reason.message, /invalid_or_replayed/);
  const capabilityId = `rac_${crypto.randomUUID()}`;
  const nonceDigest = "f".repeat(64);
  await store.issueCapability(work, {
    required_state: "DISCOVERY_OPEN",
    capability_id: capabilityId,
    purpose: "DISCOVERY_FETCH",
    request_digest: event.request_digest,
    nonce_digest: nonceDigest,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 120_000).toISOString(),
    key_version: "test-v1",
    ...event,
  });
  const consume = () => store.consumeDiscoveryCapability(work, {
    capability_id: capabilityId,
    nonce_digest: nonceDigest,
    request_digest: event.request_digest,
    fetch_id: `raf_${crypto.randomUUID()}`,
    normalized_url_digest: "1".repeat(64),
    resolved_ip_digest: "2".repeat(64),
    redirect_chain_digest: "3".repeat(64),
    response_digest: "4".repeat(64),
    typed_evidence_digest: "5".repeat(64),
    content_type: "text/plain",
    byte_count: 8,
    status_code: 200,
    sanitizer_version: "test-v1",
    injection_verdict: "ALLOW",
    reason_code: "research_airlock_fetch_verified",
    evidence: { schema_version: "test", spans: [{ text: "verified", executable: false }] },
    ...event,
  });
  const outcomes = await Promise.allSettled([consume(), consume()]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
  assert.match(outcomes.find((item) => item.status === "rejected").reason.message, /replayed/);
  assert.equal((await store.getWork(work)).evidence.length, 1);

  const capsule = { capsule_id: `rec_${crypto.randomUUID()}`, evidence_digest: "5".repeat(64) };
  const privateCapability = {
    required_state: "EVIDENCE_SEALED",
    capability_id: capabilityId,
    purpose: "PRIVATE_ENTRY",
    request_digest: "6".repeat(64),
    nonce_digest: "7".repeat(64),
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 120_000).toISOString(),
    key_version: "test-v1",
    ...event,
  };
  await assert.rejects(
    store.sealAndIssuePrivateCapability(work, {
      evidence_digest: capsule.evidence_digest,
      capsule,
      capability: privateCapability,
      ...event,
    }),
    /duplicate|unique/i,
  );
  assert.equal((await store.getWork(work)).state, "DISCOVERY_OPEN");
  assert.equal((await store.getWork(work)).capsule, null);

  const privateCapabilityId = `rac_${crypto.randomUUID()}`;
  await store.sealAndIssuePrivateCapability(work, {
    evidence_digest: capsule.evidence_digest,
    capsule,
    capability: { ...privateCapability, capability_id: privateCapabilityId },
    ...event,
  });
  const enter = () => store.enterPrivate(work, {
    capability_id: privateCapabilityId,
    nonce_digest: privateCapability.nonce_digest,
    request_digest: privateCapability.request_digest,
    ...event,
  });
  const privateOutcomes = await Promise.allSettled([enter(), enter()]);
  assert.equal(privateOutcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(privateOutcomes.filter((item) => item.status === "rejected").length, 1);

  const expiredWork = { ...work, work_id: "expired-work", session_id: "expired-session" };
  await store.createWork({
    ...expiredWork,
    allowed_domains: ["nist.gov"],
    allowed_urls: ["https://www.nist.gov/ai"],
    plan_digest: "8".repeat(64),
    policy_snapshot_digest: "9".repeat(64),
    release_commit_sha: "a".repeat(40),
    expires_at: new Date(now.getTime() - 1_000).toISOString(),
    ...event,
  });
  const expired = await store.getWork(expiredWork, event);
  assert.equal(expired.state, "EXPIRED");
  assert.equal((await store.findActiveWork({ tenant_id: expiredWork.tenant_id, session_id: expiredWork.session_id, ...event })).state, "EXPIRED");

  const tainted = { tenant_id: work.tenant_id, project_id: "project", work_id: "tainted-work", session_id: "tainted-session" };
  const preopen = await store.authorizeUnopenedSession({
    tenant_id: tainted.tenant_id,
    session_id: tainted.session_id,
    safe_preopen: false,
    tool_name: "workspace_read_document",
    ...event,
  });
  assert.equal(preopen.state, "PREOPEN_TAINTED");
  await assert.rejects(store.issuePlan({
    ...tainted,
    plan_id: `rap_${crypto.randomUUID()}`,
    allowed_domains: ["attacker.com"],
    allowed_urls: ["https://attacker.com/collect?tenant_secret=CANARY_PRIVATE"],
    plan_digest: "1".repeat(64),
    policy_snapshot_digest: "2".repeat(64),
    nonce_digest: "3".repeat(64),
    key_version: "test-v1",
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 120_000).toISOString(),
    ...event,
  }), /session_preopen_tainted/);

  const race = { tenant_id: work.tenant_id, project_id: "project", work_id: "authorization-race-work", session_id: "authorization-race-session" };
  const racePlanId = `rap_${crypto.randomUUID()}`;
  const raceNonceDigest = "4".repeat(64);
  await store.issuePlan({
    ...race,
    plan_id: racePlanId,
    allowed_domains: ["nist.gov"],
    allowed_urls: ["https://www.nist.gov/ai"],
    plan_digest: "5".repeat(64),
    policy_snapshot_digest: "6".repeat(64),
    nonce_digest: raceNonceDigest,
    key_version: "test-v1",
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 120_000).toISOString(),
    ...event,
  });
  const [authorizationRace, openRace] = await Promise.allSettled([
    store.resolveSessionAuthorization({
      tenant_id: race.tenant_id,
      session_id: race.session_id,
      safe_preopen: false,
      tool_name: "workspace_read_document",
      ...event,
    }),
    store.consumePlanAndCreateWork({
      ...race,
      plan_id: racePlanId,
      nonce_digest: raceNonceDigest,
      release_commit_sha: "e".repeat(40),
      expires_at: new Date(now.getTime() + 300_000).toISOString(),
      ...event,
    }),
  ]);
  assert.equal(authorizationRace.status, "fulfilled");
  if (openRace.status === "fulfilled") {
    assert.equal(authorizationRace.value.work?.state, "DISCOVERY_OPEN");
    assert.equal(authorizationRace.value.decision, null);
  } else {
    assert.match(openRace.reason.message, /session_preopen_tainted/);
    assert.equal(authorizationRace.value.decision?.state, "PREOPEN_TAINTED");
  }
  await store.close();
});
