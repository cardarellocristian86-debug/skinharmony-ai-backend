"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sh-gold-overview-"));
process.chdir(tempRoot);
const { DesktopMirrorService } = require("../src/DesktopMirrorService");

function session(centerId) {
  return {
    username: `user-${centerId}`,
    centerId,
    centerName: centerId,
    subscriptionPlan: "gold",
    accessState: "active",
    role: "member"
  };
}

function state(centerId, eventSeq, revenueCents) {
  return {
    id: `gold_state:${centerId}`,
    centerId,
    centerName: centerId,
    eventSeq,
    updatedAt: "2026-07-29T10:00:00.000Z",
    components: { Conf: 0.84 },
    counters: { revenueTotalCents: revenueCents, paymentCount: 5, clientsTotal: 4, activeClients: 3 },
    dirty: { components: [], snapshots: [], signals: [] },
    snapshots: {
      business: { revenueCents, paymentCount: 5, agendaSaturation: 0.7, confidence: 0.84 },
      profitability: { summary: { revenueCents } },
      report: { centerHealth: { status: "stabile" } },
      marketing: { suggestions: [{ clientId: "client-a", name: "Cliente A" }] },
      inventory: { summary: { totalItems: 3 }, lowStock: [] }
    },
    decision: { primaryAction: { label: "Priorità" }, secondaryActions: [], blockedActions: [], globalConfidence: 0.84, systemRisk: 0.1 }
  };
}

try {
  const service = new DesktopMirrorService();
  const tenantA = session("tenant-a");
  const tenantB = session("tenant-b");
  service.goldStateRepository.create(state("tenant-a", 7, 125000));
  service.goldStateRepository.create(state("tenant-b", 9, 990000));

  // An ordinary overview read must not enter the bootstrap/derived rebuild path.
  service.getGoldState = () => { throw new Error("overview must not rebuild"); };
  const first = service.getGoldOverviewReadModel(tenantA);
  const second = service.getGoldOverviewReadModel(tenantA);
  const otherTenant = service.getGoldOverviewReadModel(tenantB);
  assert.strictEqual(first.summary.revenueCents, 125000);
  assert.strictEqual(second.cache.hit, true);
  assert.strictEqual(otherTenant.summary.revenueCents, 990000);
  assert.notStrictEqual(service.getGoldOverviewEtag("tenant-a", 7), service.getGoldOverviewEtag("tenant-b", 7));
  assert.strictEqual(JSON.stringify(first).includes("tenant-a"), false, "tenant identifier must not be returned");

  // A genuine tenant mutation invalidates only that tenant and a new eventSeq
  // produces a new overview/version without contacting an external provider.
  service.goldStateRepository.update("gold_state:tenant-a", () => state("tenant-a", 8, 130000));
  service.invalidateBusinessSnapshot("tenant-a");
  const changed = service.getGoldOverviewReadModel(tenantA);
  assert.strictEqual(changed.cache.hit, false);
  assert.strictEqual(changed.eventSeq, 8);
  assert.strictEqual(changed.summary.revenueCents, 130000);
  assert.strictEqual(service.getGoldOverviewReadModel(tenantB).cache.hit, true);

  console.log(JSON.stringify({ ok: true, runner: "gold_overview_read_model_test" }));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
