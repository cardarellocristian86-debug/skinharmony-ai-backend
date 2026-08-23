"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smartdesk-checkout-contract-"));
const originalCwd = process.cwd();
const originalCenterLimit = process.env.ENTERPRISE_CENTER_LIMIT;
process.env.ENTERPRISE_CENTER_LIMIT = "20";
process.chdir(tempRoot);
const { DesktopMirrorService } = require("../src/DesktopMirrorService");

class SharedCasAdapter {
  constructor(collections = {}) {
    this.collections = new Map(Object.entries(collections).map(([name, payload]) => [name, {
      payload: structuredClone(payload),
      revision: 1
    }]));
    this.atomicCommitCount = 0;
    this.writeAttempts = 0;
    this.releaseOverlap = null;
    this.overlapReached = new Promise((resolve) => { this.releaseOverlap = resolve; });
    this.firstCommitDone = null;
    this.resolveFirstCommit = null;
    this.firstCommitDone = new Promise((resolve) => { this.resolveFirstCommit = resolve; });
  }

  stageWrite() {
    return false;
  }

  async readCollection(name) {
    const current = this.collections.get(name) || { payload: [], revision: 1 };
    return structuredClone(current);
  }

  async writeCollectionsAtomically(changes) {
    const attempt = this.writeAttempts++;
    if (attempt === 0) {
      await this.overlapReached;
    } else if (attempt === 1) {
      this.releaseOverlap();
      await this.firstCommitDone;
    }
    for (const change of changes) {
      const current = this.collections.get(change.name) || { payload: [], revision: 1 };
      if (Number(change.expectedRevision) !== current.revision) {
        const error = new Error(`stale:${change.name}`);
        error.code = "persistence_conflict";
        throw error;
      }
    }
    const revisions = new Map();
    for (const change of changes) {
      const current = this.collections.get(change.name) || { payload: [], revision: 1 };
      const revision = current.revision + 1;
      this.collections.set(change.name, { payload: structuredClone(change.payload), revision });
      revisions.set(change.name, revision);
    }
    this.atomicCommitCount += 1;
    if (attempt === 0) this.resolveFirstCommit();
    return revisions;
  }
}

function account(id, centerId, email) {
  return {
    id,
    username: email,
    role: "owner",
    active: true,
    centerId,
    centerName: centerId,
    contactEmail: email,
    planType: "trial",
    subscriptionPlan: "silver",
    paymentStatus: "trial_free",
    accountStatus: "trial",
    accessState: "active"
  };
}

function paidOrder({ id, email, plan = "base", centerId = "", status = "completed" } = {}) {
  return {
    id,
    status,
    total: "49.00",
    billing: { email },
    line_items: [{ sku: `sh-smartdesk-${plan}-monthly`, name: `Smart Desk ${plan} mensile` }],
    meta_data: centerId ? [{ key: "smartdesk_center_id", value: centerId }] : []
  };
}

async function main() {
  const service = new DesktopMirrorService();
  for (const plan of ["base", "silver", "gold", "enterprise"]) {
    for (const cycle of ["monthly", "yearly"]) {
      assert.deepEqual(
        service.getSmartDeskPlanFromWooCommerceOrder({ line_items: [{ sku: `sh-smartdesk-${plan}-${cycle}`, name: "ignored" }] }),
        { plan, cycle, canonical: true, reason: "canonical_sku" }
      );
    }
  }
  assert.equal(service.getSmartDeskPlanFromWooCommerceOrder({ line_items: [{ sku: "smartdesk-silver-monthly", name: "Subscription" }] }).plan, "");
  assert.equal(service.getSmartDeskPlanFromWooCommerceOrder({ line_items: [{ sku: "database-tools", name: "Subscription" }] }).plan, "");
  assert.equal(service.getSmartDeskPlanFromWooCommerceOrder({ line_items: [{ sku: "gift-card", name: "Silver Gift" }] }).plan, "");
  service.usersRepository.create({ ...account("user-a", "center-a", "a@example.test"), subscriptionPlan: "base" });
  service.usersRepository.create(account("user-b", "center-b", "b@example.test"));

  const activated = await service.activateSubscriptionFromWooCommerceOrder(paidOrder({
    id: "order-base-1",
    email: "a@example.test",
    plan: "base",
    centerId: "center-a"
  }));
  assert.equal(activated.action, "account_activated");
  assert.equal(activated.plan, "base");
  assert.equal(service.usersRepository.findById("user-a").subscriptionLastOrderId, "order-base-1");

  const replay = await service.activateSubscriptionFromWooCommerceOrder(paidOrder({
    id: "order-base-1",
    email: "a@example.test",
    plan: "base",
    centerId: "center-a"
  }));
  assert.equal(replay.idempotentReplay, true);
  await assert.rejects(
    service.activateSubscriptionFromWooCommerceOrder(paidOrder({ id: "order-base-1", email: "a@example.test", plan: "base" })),
    /woocommerce_delivery_tenant_binding_required/
  );
  await assert.rejects(
    service.activateSubscriptionFromWooCommerceOrder(paidOrder({ id: "order-base-1", email: "a@example.test", plan: "base", centerId: "center-wrong" })),
    /woocommerce_delivery_tenant_mismatch/
  );
  const restartedService = new DesktopMirrorService();
  const restartReplay = await restartedService.activateSubscriptionFromWooCommerceOrder(paidOrder({
    id: "order-base-1", email: "a@example.test", plan: "base", centerId: "center-a"
  }));
  assert.equal(restartReplay.idempotentReplay, true);
  assert.equal(restartReplay.receiptId, activated.receiptId);
  await assert.rejects(
    service.activateSubscriptionFromWooCommerceOrder(paidOrder({ id: "order-base-1", email: "b@example.test", plan: "base", centerId: "center-a" })),
    /woocommerce_order_replay_conflict/
  );
  const missingBinding = await service.activateSubscriptionFromWooCommerceOrder(paidOrder({
    id: "order-no-tenant", email: "a@example.test", plan: "silver"
  }));
  assert.equal(missingBinding.action, "pending_manual_activation");
  assert.equal(missingBinding.reason, "woocommerce_delivery_tenant_binding_required");
  await assert.rejects(
    service.activateSubscriptionFromWooCommerceOrder(paidOrder({ id: "order-tenant-mismatch", email: "a@example.test", plan: "silver", centerId: "center-b" })),
    /woocommerce_delivery_tenant_mismatch/
  );
  await assert.rejects(
    service.activateSubscriptionFromWooCommerceOrder(paidOrder({ id: "", email: "a@example.test", plan: "silver", centerId: "center-a" })),
    /woocommerce_order_id_missing/
  );

  const beforeGuided = service.usersRepository.findById("user-a").subscriptionPlan;
  const guided = await service.activateSubscriptionFromWooCommerceOrder(paidOrder({ id: "order-gold", email: "a@example.test", plan: "gold", centerId: "center-a" }));
  assert.equal(guided.action, "guided_activation_required");
  assert.equal(service.usersRepository.findById("user-a").subscriptionPlan, beforeGuided);
  await assert.rejects(
    service.activateSubscriptionFromWooCommerceOrder(paidOrder({ id: "order-enterprise", email: "a@example.test", plan: "enterprise", centerId: "center-a" })),
    /woocommerce_plan_not_supported:enterprise/
  );

  const originalCommit = service.commitRepositorySnapshots.bind(service);
  let durableWrites = 0;
  service.commitRepositorySnapshots = async (...args) => {
    durableWrites += 1;
    await new Promise((resolve) => setImmediate(resolve));
    return originalCommit(...args);
  };
  const concurrentOrder = paidOrder({ id: "order-silver-concurrent", email: "b@example.test", plan: "silver", centerId: "center-b" });
  const concurrent = await Promise.all([
    service.activateSubscriptionFromWooCommerceOrder(concurrentOrder),
    service.activateSubscriptionFromWooCommerceOrder(concurrentOrder)
  ]);
  assert.equal(durableWrites, 1);
  assert.deepEqual(concurrent.map((item) => item.orderId), ["order-silver-concurrent", "order-silver-concurrent"]);
  assert.equal(service.usersRepository.findById("user-b").subscriptionPlan, "silver");

  const sharedAdapter = new SharedCasAdapter({
    users: service.usersRepository.list(),
    commerce_receipts: service.commerceReceiptsRepository.list()
  });
  const instanceA = new DesktopMirrorService({ persistenceAdapter: sharedAdapter });
  const instanceB = new DesktopMirrorService({ persistenceAdapter: sharedAdapter });
  for (const instance of [instanceA, instanceB]) {
    instance.usersRepository.setRevision(1);
    instance.commerceReceiptsRepository.setRevision(1);
  }
  const overlappingOrder = paidOrder({ id: "order-overlap-cas", email: "a@example.test", plan: "silver", centerId: "center-a" });
  const [firstCommit, staleReplay] = await Promise.all([
    instanceA.activateSubscriptionFromWooCommerceOrder(overlappingOrder),
    instanceB.activateSubscriptionFromWooCommerceOrder(overlappingOrder)
  ]);
  assert.equal(firstCommit.action, "account_activated");
  assert.equal(staleReplay.idempotentReplay, true);
  assert.equal(sharedAdapter.atomicCommitCount, 1);
  const remoteUsers = (await sharedAdapter.readCollection("users")).payload;
  const remoteReceipts = (await sharedAdapter.readCollection("commerce_receipts")).payload;
  assert.equal(remoteReceipts.filter((item) => item.id === firstCommit.receiptId).length, 1);
  assert.equal(remoteUsers.find((item) => item.id === "user-a").subscriptionLastOrderId, "order-overlap-cas");
  assert.equal(instanceB.usersRepository.findById("user-a").subscriptionLastOrderId, "order-overlap-cas");
  assert.equal(instanceB.commerceReceiptsRepository.findById(firstCommit.receiptId).id, firstCommit.receiptId);

  const higherPlanUser = service.usersRepository.findById("user-a");
  service.usersRepository.write(service.usersRepository.list().map((item) => item.id === higherPlanUser.id
    ? { ...item, subscriptionPlan: "silver", planType: "active" }
    : item));
  const downgrade = await service.activateSubscriptionFromWooCommerceOrder(paidOrder({
    id: "order-base-downgrade", email: "a@example.test", plan: "base", centerId: "center-a"
  }));
  assert.equal(downgrade.action, "downgrade_denied");
  assert.equal(service.usersRepository.findById("user-a").subscriptionPlan, "silver");

  service.usersRepository.create(account("user-b-duplicate", "center-b", "b@example.test"));
  await assert.rejects(
    service.activateSubscriptionFromWooCommerceOrder(paidOrder({ id: "order-ambiguous", email: "b@example.test", plan: "base", centerId: "center-b" })),
    /woocommerce_delivery_tenant_ambiguous/
  );

  const beforeGift = service.usersRepository.findById("user-a").subscriptionPlan;
  const gift = await service.activateSubscriptionFromWooCommerceOrder({
    ...paidOrder({ id: "order-silver-gift", email: "a@example.test", centerId: "center-a" }),
    line_items: [{ sku: "gift-card", name: "Silver Gift" }]
  });
  assert.equal(gift.ignored, true);
  assert.equal(service.usersRepository.findById("user-a").subscriptionPlan, beforeGift);

  const trialPayload = {
    centerName: "Trial Receipt Center",
    ownerName: "Trial Owner",
    email: "trial-receipt@example.test",
    confirmEmail: "trial-receipt@example.test",
    username: "Owner.Test",
    password: "Trial-Receipt-Password-2026",
    emailConfirmed: true,
    privacyConsent: true,
    policyConsent: true,
    idempotencyKey: "trial-receipt-key-0001",
    trialDays: 999,
    subscriptionPlan: "enterprise",
    planType: "active"
  };
  const concurrentTrials = await Promise.all([service.requestTrial(trialPayload), service.requestTrial(trialPayload)]);
  assert.equal(concurrentTrials[0].success, true);
  assert.equal(concurrentTrials[0].user.subscriptionPlan, "silver");
  assert.equal(concurrentTrials[0].user.planType, "trial");
  assert.equal(concurrentTrials[0].user.trialDays, 7);
  assert.equal(concurrentTrials[0].user.username, "owner.test");
  assert.match(concurrentTrials[0].delivery.bindingDigest, /^[a-f0-9]{64}$/);
  assert.equal(
    concurrentTrials[0].delivery.idempotencyDigest,
    crypto.createHash("sha256").update(`smartdesk_trial_idempotency_v1:${trialPayload.idempotencyKey}`).digest("hex")
  );
  assert.equal(service.commerceReceiptsRepository.list().filter((item) => item.type === "trial_delivery").length, 1);
  const persistedText = fs.readFileSync(path.join(tempRoot, "data", "commerce_receipts.json"), "utf8");
  assert.equal(persistedText.includes(trialPayload.password), false);
  assert.equal(persistedText.includes(trialPayload.idempotencyKey), false);
  const trialRestart = new DesktopMirrorService();
  const trialReplay = await trialRestart.requestTrial(trialPayload);
  assert.equal(trialReplay.delivery.status, "idempotent_replay");
  assert.equal(trialReplay.user.username, "owner.test");
  assert.equal(trialReplay.delivery.receiptId, concurrentTrials[0].delivery.receiptId);
  await assert.rejects(
    trialRestart.requestTrial({ ...trialPayload, email: "changed@example.test", confirmEmail: "changed@example.test" }),
    (error) => error?.code === "trial_idempotency_conflict"
  );

  console.log(JSON.stringify({
    ok: true,
    suite: "trial_checkout_contract",
    assertions: {
      baseSilverAllowlist: true,
      goldGuidedOnly: true,
      enterpriseDenied: true,
      tenantDeliveryBound: true,
      ambiguousTenantDeliveryDenied: true,
      orderReplayFailClosed: true,
      concurrentReplaySingleWrite: true
      ,canonicalSkuOnly: true
      ,crossInstanceWooReplay: true
      ,trialReceiptConcurrentRestartReplay: true
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}).finally(() => {
  process.chdir(originalCwd);
  if (originalCenterLimit === undefined) delete process.env.ENTERPRISE_CENTER_LIMIT;
  else process.env.ENTERPRISE_CENTER_LIMIT = originalCenterLimit;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
