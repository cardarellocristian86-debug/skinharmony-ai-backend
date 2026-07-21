"use strict";

const assert = require("node:assert");
const { DesktopMirrorService } = require("../src/DesktopMirrorService");

function repository(items = []) {
  const store = [...items];
  return {
    list: () => store,
    findById: (id) => store.find((item) => item.id === id) || null,
    async createDurable(item) { store.unshift(item); return item; },
    async updateDurable(id, updater) {
      const index = store.findIndex((item) => item.id === id);
      if (index < 0) return null;
      store[index] = updater(store[index]);
      return store[index];
    },
    async deleteDurable(id) {
      const index = store.findIndex((item) => item.id === id);
      if (index < 0) return false;
      store.splice(index, 1);
      return true;
    }
  };
}

const centerA = "tenant-a";
const sessionA = { centerId: centerA };
const client = { id: "client-a", centerId: centerA, marketingConsent: true, phone: "+39000000000" };
const service = Object.create(DesktopMirrorService.prototype);
service.getCenterId = (session) => session.centerId;
service.belongsToCenter = (item, centerId) => item.centerId === centerId;
service.filterByCenter = (items, session) => items.filter((item) => item.centerId === session.centerId);
service.findByIdInCenter = (repo, id, session) => repo.list().find((item) => item.id === id && item.centerId === session.centerId) || null;
service.clientsRepository = repository([client, { id: "client-b", centerId: "tenant-b", marketingConsent: true, phone: "+39000000001" }]);
service.servicesRepository = repository([
  { id: "blow-dry", centerId: centerA, name: "Piega" },
  { id: "lightening", centerId: centerA, name: "Schiaritura" }
]);
service.clientRecallProfilesRepository = repository();
service.appointmentsRepository = repository([
  // Weekly routine: four completed visits, one future booking and one non-completed booking.
  { id: "b1", centerId: centerA, clientId: "client-a", serviceId: "blow-dry", startAt: "2026-01-01T10:00:00.000Z", status: "completed" },
  { id: "b2", centerId: centerA, clientId: "client-a", serviceId: "blow-dry", startAt: "2026-01-08T10:00:00.000Z", status: "completed" },
  { id: "b3", centerId: centerA, clientId: "client-a", serviceId: "blow-dry", startAt: "2026-01-15T10:00:00.000Z", status: "completed" },
  { id: "b4", centerId: centerA, clientId: "client-a", serviceId: "blow-dry", startAt: "2026-01-22T10:00:00.000Z", status: "completed" },
  { id: "b-future", centerId: centerA, clientId: "client-a", serviceId: "blow-dry", startAt: "2026-03-01T10:00:00.000Z", status: "completed" },
  { id: "b-requested", centerId: centerA, clientId: "client-a", serviceId: "blow-dry", startAt: "2026-01-29T10:00:00.000Z", status: "requested" },
  // Approximate three-month routine: it must not be treated like the weekly routine.
  { id: "l1", centerId: centerA, clientId: "client-a", serviceId: "lightening", startAt: "2025-07-01T10:00:00.000Z", status: "completed" },
  { id: "l2", centerId: centerA, clientId: "client-a", serviceId: "lightening", startAt: "2025-10-01T10:00:00.000Z", status: "completed" },
  { id: "l3", centerId: centerA, clientId: "client-a", serviceId: "lightening", startAt: "2026-01-01T10:00:00.000Z", status: "completed" },
  { id: "foreign", centerId: "tenant-b", clientId: "client-b", serviceId: "blow-dry", startAt: "2026-01-01T10:00:00.000Z", status: "completed" }
]);

(async () => {
  const result = await service.syncClientRecallProfiles("client-a", sessionA, { nowAt: "2026-02-12T10:00:00.000Z" });
  assert.equal(result.automaticMessaging, false);
  assert.equal(result.profiles.length, 2, "profiles must be per service and isolated from another tenant");

  const blowDry = result.profiles.find((profile) => profile.serviceId === "blow-dry");
  assert.equal(blowDry.cadenceDays, 7);
  assert.equal(blowDry.state, "overdue");
  assert.equal(blowDry.confidence, "high");
  assert.equal(blowDry.marketingEligible, true);
  assert.equal(blowDry.manualActionRequired, true);
  assert.equal(blowDry.automaticMessageAllowed, false);

  const lightening = result.profiles.find((profile) => profile.serviceId === "lightening");
  assert.equal(lightening.cadenceDays, 92);
  assert.equal(lightening.state, "not_due");
  assert.notEqual(lightening.state, blowDry.state);
  assert.equal(service.clientRecallProfilesRepository.list().length, 2, "derived profiles must persist");

  const later = await service.syncClientRecallProfiles("client-a", sessionA, { nowAt: "2026-05-10T10:00:00.000Z" });
  assert.equal(later.profiles.find((profile) => profile.serviceId === "lightening").state, "overdue");

  client.marketingConsent = false;
  const revoked = await service.syncClientRecallProfiles("client-a", sessionA, { nowAt: "2026-02-12T10:00:00.000Z" });
  assert.equal(revoked.profiles.every((profile) => profile.marketingEligible === false), true, "consent revocation must suppress marketing eligibility");

  console.log(JSON.stringify({ ok: true, runner: "client_recall_profile_test" }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
