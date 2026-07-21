"use strict";

const assert = require("node:assert");
const { DesktopMirrorService } = require("../src/DesktopMirrorService");

const service = Object.create(DesktopMirrorService.prototype);
const appointments = Array.from({ length: 12 }, (_, index) => ({
  id: `appointment-${index + 1}`,
  startAt: `2026-01-${String(index + 1).padStart(2, "0")}T09:00:00.000Z`
}));

service.getClientDetail = () => ({
  client: { id: "client-test" },
  appointments: [appointments[3], appointments[0], { id: "invalid-date", startAt: "not-a-date" }, ...appointments.slice(1, 3), ...appointments.slice(4)],
  payments: [],
  treatments: []
});

const consultation = service.getClientConsultation("client-test");
assert.equal(consultation.history.length, 10);
assert.deepEqual(consultation.history.map((item) => item.id), [
  "appointment-12", "appointment-11", "appointment-10", "appointment-9", "appointment-8",
  "appointment-7", "appointment-6", "appointment-5", "appointment-4", "appointment-3"
]);
assert.equal(consultation.history.some((item) => item.id === "invalid-date"), false);
assert.equal(appointments[0].id, "appointment-1", "the source history must not be mutated");

console.log(JSON.stringify({ ok: true, runner: "client_consultation_history_test" }, null, 2));
