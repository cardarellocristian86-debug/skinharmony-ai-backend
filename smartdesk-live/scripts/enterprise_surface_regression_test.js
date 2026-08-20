"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert");
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "smartdesk-enterprise-test-"));
const originalDataDir = process.env.SMARTDESK_DATA_DIR;
const originalExportsDir = process.env.SMARTDESK_EXPORTS_DIR;
process.env.SMARTDESK_DATA_DIR = path.join(sandbox, "data");
process.env.SMARTDESK_EXPORTS_DIR = path.join(sandbox, "exports");
const { DesktopMirrorService } = require("../src/DesktopMirrorService");
const { AssistantService } = require("../src/AssistantService");

(async () => {
  try {
  const service = new DesktopMirrorService();
  await service.init();

  const user = service.usersRepository.list().find((item) => String(item.role || "").toLowerCase() !== "superadmin")
    || service.usersRepository.list()[0]
    || { centerId: "center_enterprise_test", centerName: "Enterprise Test Center", role: "owner" };
  const session = {
    role: "owner",
    centerId: user.centerId || "center_enterprise_test",
    centerName: user.centerName || user.businessName || "Enterprise Test Center",
    subscriptionPlan: "enterprise",
    accessState: "active"
  };

  assert.strictEqual(service.getPlanLevel(session), "enterprise");
  assert.strictEqual(service.hasGoldIntelligence(session), true);
  assert.strictEqual(service.hasProtocolAiAccess(session), true);
  assert.strictEqual(service.getProtocolAiLimit(session), 300);

  const progressive = service.getProgressiveIntelligenceStatus(session);
  assert.strictEqual(progressive.currentPlan, "enterprise");
  assert(progressive.goldStateEventSeq >= 0);

  const decisionCenter = service.getAiGoldDecisionCenter({}, session);
  assert.strictEqual(decisionCenter.goldEnabled, true);
  assert(Array.isArray(decisionCenter.sections) && decisionCenter.sections.length > 0);

  const snapshot = service.getBusinessSnapshot({}, session);
  assert.notStrictEqual(snapshot.snapshotAvailable, false);

  const assistant = new AssistantService(service);
  const support = await assistant.supportChat({ message: "Cosa include il mio piano?" }, session);
  assert.match(String(support.message || ""), /Enterprise/i);
  assert(Array.isArray(support.actions) && support.actions.some((action) => action.path === "/ai-gold"));

  const shellHelpersSource = fs.readFileSync(path.resolve(__dirname, "../public/preview-shell/shell-helpers.js"), "utf8");
  assert(!shellHelpersSource.includes("enterprise layer is not complete yet"));
  assert(shellHelpersSource.includes("Session metadata not loaded yet"));

  const profitabilitySource = fs.readFileSync(path.resolve(__dirname, "../public/preview-shell/views/profitability.js"), "utf8");
  assert(profitabilitySource.includes("Gold / Enterprise center cost per minute"));
  assert(profitabilitySource.includes("plan !== \"gold\" && plan !== \"enterprise\""));

  console.log(JSON.stringify({
    ok: true,
    runner: "enterprise_surface_regression_test",
    plan: session.subscriptionPlan,
    decisionCenter: {
      goldEnabled: decisionCenter.goldEnabled,
      sections: decisionCenter.sections.length
    }
  }, null, 2));
  } finally {
    if (originalDataDir === undefined) delete process.env.SMARTDESK_DATA_DIR;
    else process.env.SMARTDESK_DATA_DIR = originalDataDir;
    if (originalExportsDir === undefined) delete process.env.SMARTDESK_EXPORTS_DIR;
    else process.env.SMARTDESK_EXPORTS_DIR = originalExportsDir;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
