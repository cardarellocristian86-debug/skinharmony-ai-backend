"use strict";

const { DesktopMirrorService } = require("../src/DesktopMirrorService");
const { AssistantService } = require("../src/AssistantService");
const {
  NyraSmartDeskGoldAudit,
  writeNyraSmartDeskGoldAuditReport
} = require("../src/nyra/NyraSmartDeskGoldAudit");

function buildSession(service) {
  const users = service.usersRepository?.list?.() || [];
  const user = users.find((item) => /privilege/i.test([item.centerName, item.businessName, item.username, item.centerId].join(" ")))
    || users.find((item) => String(item.subscriptionPlan || "").toLowerCase() === "gold" && String(item.role || "").toLowerCase() !== "superadmin")
    || users.find((item) => String(item.role || "").toLowerCase() !== "superadmin")
    || {};
  return {
    role: "owner",
    centerId: user.centerId || "center_admin",
    centerName: user.centerName || user.businessName || "Privilege Parrucchieri",
    subscriptionPlan: "gold",
    accessState: "active"
  };
}

async function main() {
  const service = new DesktopMirrorService();
  await service.init();
  const assistant = new AssistantService(service);
  const audit = new NyraSmartDeskGoldAudit({
    desktopMirror: service,
    assistantService: assistant,
    rootDir: process.cwd()
  });
  const report = await audit.run(buildSession(service));
  const reportPath = writeNyraSmartDeskGoldAuditReport(report);
  console.log(JSON.stringify({
    ok: report.ok,
    verdict: report.verdict,
    summary: report.summary,
    tenant: report.tenant,
    reportPath,
    failedChecks: report.checks.filter((item) => item.status === "fail").map((item) => item.id),
    warningChecks: report.checks.filter((item) => item.status === "warn").map((item) => item.id)
  }, null, 2));
  if (report.verdict === "fail") process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
