"use strict";

const fs = require("fs");
const path = require("path");
const { DesktopMirrorService } = require("../render-smartdesk-live/src/DesktopMirrorService");
const { CoreliaBridge } = require("../render-smartdesk-live/src/corelia/CoreliaBridge");
const { NyraDialogueAdapter } = require("../render-smartdesk-live/src/nyra/NyraDialogueAdapter");
const { evaluateRouterVariants } = require("../render-smartdesk-live/src/corelia/CoreliaIntentRouter");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function activeSession(user) {
  return {
    role: "owner",
    centerId: user.centerId,
    centerName: user.centerName,
    subscriptionPlan: "gold",
    accessState: "active"
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

(async () => {
  const service = new DesktopMirrorService();
  await service.init();
  const bridge = new CoreliaBridge(service);
  const nyra = new NyraDialogueAdapter();
  const user = service.usersRepository.list().find((item) => String(item.role || "").toLowerCase() !== "superadmin");
  if (!user) throw new Error("Nessun tenant locale disponibile per il test");
  const session = activeSession(user);
  const baseSnapshot = service.getBusinessSnapshot({}, session);
  const beforeCounts = {
    clients: service.clientsRepository.list().length,
    appointments: service.appointmentsRepository.list().length,
    payments: service.paymentsRepository.list().length,
    inventory: service.inventoryRepository.list().length
  };

  const strongSnapshot = clone(baseSnapshot);
  strongSnapshot.report = strongSnapshot.report || {};
  strongSnapshot.report.centerHealth = {
    ...(strongSnapshot.report.centerHealth || {}),
    status: "forte",
    statusLabel: "Forte",
    revenuePerOperatorCents: 540000,
    saturationPercent: 88,
    continuityPercent: 81,
    reason: "Volume operativo forte e continuità sana."
  };
  strongSnapshot.dataQuality = { ...(strongSnapshot.dataQuality || {}), score: 92, alerts: [], metrics: { unlinkedPayments: 0 } };
  strongSnapshot.marketing = { ...(strongSnapshot.marketing || {}), suggestions: [{ clientId: "c1", name: "Laura", priority: "media", clearReason: "Cliente da mantenere in continuità", operatingDecision: "proponi mantenimento" }], focusClient: { name: "Laura", priority: "media", clearReason: "Cliente da mantenere in continuità", operatingDecision: "proponi mantenimento" } };
  const strongDecisionContext = {
    ...(service.getGoldDecisionContext({}, session) || {}),
    primaryAction: { domain: "operations", label: "Centro forte sotto controllo", suggestedAction: "mantieni il ritmo e controlla solo i punti deboli", action: "MONITOR", risk: 0.18 },
    systemRisk: 0.22,
    globalConfidence: 0.88,
    topSignals: [{ domain: "decision", label: "Centro forte", explanationShort: "Centro forte e stabile", confidence: 0.88, risk: 0.18 }]
  };
  const strongGoldState = {
    ...(service.getGoldState(session) || {}),
    decision: { domain: "operations", action: "MONITOR", explanationShort: "Centro forte: monitorare." },
    signals: { ...(service.getGoldState(session)?.signals || {}), dataReliability: 0.92 },
    cashSelection: { ...(service.getGoldState(session)?.cashSelection || {}), reliabilityScore: 0.92 }
  };

  const mediumSnapshot = clone(baseSnapshot);
  mediumSnapshot.report = mediumSnapshot.report || {};
  mediumSnapshot.report.centerHealth = {
    ...(mediumSnapshot.report.centerHealth || {}),
    status: "fragile",
    statusLabel: "Fragile",
    revenuePerOperatorCents: 305000,
    saturationPercent: 56,
    continuityPercent: 48,
    reason: "Il centro regge ma va rinforzata la continuità."
  };
  mediumSnapshot.dataQuality = { ...(mediumSnapshot.dataQuality || {}), score: 79, alerts: ["Alcuni pagamenti non risultano collegati"], metrics: { unlinkedPayments: 1 } };
  mediumSnapshot.operations = { ...(mediumSnapshot.operations || {}), weakestUpcomingDay: ["2026-04-24", 2] };
  const mediumDecisionContext = {
    ...(service.getGoldDecisionContext({}, session) || {}),
    primaryAction: { domain: "operations", label: "Centro fragile ma recuperabile", suggestedAction: "rinforza continuità clienti e saturazione", action: "SUGGEST", risk: 0.48 },
    systemRisk: 0.54,
    globalConfidence: 0.71,
    topSignals: [{ domain: "decision", label: "Continuità da rinforzare", explanationShort: "Continuità clienti da rinforzare", confidence: 0.71, risk: 0.48 }]
  };
  const mediumGoldState = {
    ...(service.getGoldState(session) || {}),
    decision: { domain: "operations", action: "SUGGEST", explanationShort: "Centro fragile: suggerita azione." },
    signals: { ...(service.getGoldState(session)?.signals || {}), dataReliability: 0.79 },
    cashSelection: { ...(service.getGoldState(session)?.cashSelection || {}), reliabilityScore: 0.76 }
  };

  const fragileSnapshot = clone(baseSnapshot);
  fragileSnapshot.report = fragileSnapshot.report || {};
  fragileSnapshot.report.centerHealth = {
    ...(fragileSnapshot.report.centerHealth || {}),
    status: "sotto_soglia",
    statusLabel: "Sotto soglia",
    revenuePerOperatorCents: 180000,
    saturationPercent: 29,
    continuityPercent: 22,
    reason: "Centro sotto soglia: prima agenda e continuità."
  };
  fragileSnapshot.dataQuality = { ...(fragileSnapshot.dataQuality || {}), score: 42, alerts: ["Dati cassa incompleti", "Anagrafica clienti incompleta"], metrics: { unlinkedPayments: 3 } };
  fragileSnapshot.marketing = { ...(fragileSnapshot.marketing || {}), suggestions: [], focusClient: null };
  fragileSnapshot.operations = { ...(fragileSnapshot.operations || {}), weakestUpcomingDay: ["2026-04-25", 0] };
  const fragileDecisionContext = {
    ...(service.getGoldDecisionContext({}, session) || {}),
    primaryAction: { domain: "operations", label: "Centro sotto soglia", suggestedAction: "aumenta volume agenda e continuità clienti subito", action: "ACT_NOW", risk: 0.88 },
    systemRisk: 0.91,
    globalConfidence: 0.58,
    topSignals: [{ domain: "decision", label: "Centro sotto soglia", explanationShort: "Centro sotto soglia", confidence: 0.58, risk: 0.88 }]
  };
  const fragileGoldState = {
    ...(service.getGoldState(session) || {}),
    decision: { domain: "operations", action: "ACT_NOW", explanationShort: "Centro sotto soglia: agire ora." },
    signals: { ...(service.getGoldState(session)?.signals || {}), dataReliability: 0.42 },
    cashSelection: { ...(service.getGoldState(session)?.cashSelection || {}), reliabilityScore: 0.38 }
  };

  const routerCases = [
    { message: "Come sta il centro oggi?", intent: "ask_center_status", domain: "decision", state: { snapshot: mediumSnapshot, decisionContext: mediumDecisionContext, goldState: mediumGoldState } },
    { message: "Verifica la cassa e i pagamenti da collegare", intent: "ask_cash_issue", domain: "cash", state: { snapshot: mediumSnapshot, decisionContext: mediumDecisionContext, goldState: mediumGoldState } },
    { message: "Cosa devo fare oggi?", intent: "ask_priority", domain: "decision", state: { snapshot: fragileSnapshot, decisionContext: fragileDecisionContext, goldState: fragileGoldState } },
    { message: "Chi devo richiamare nel marketing?", intent: "ask_marketing_opportunity", domain: "marketing", state: { snapshot: mediumSnapshot, decisionContext: mediumDecisionContext, goldState: mediumGoldState } },
    { message: "Fammi un report dell'andamento", intent: "ask_report_summary", domain: "report", state: { snapshot: strongSnapshot, decisionContext: strongDecisionContext, goldState: strongGoldState } },
    { message: "Com'è la redditività del centro?", intent: "ask_profitability", domain: "profitability", state: { snapshot: mediumSnapshot, decisionContext: mediumDecisionContext, goldState: mediumGoldState } },
    { message: "Quale operatore va controllato?", intent: "ask_operator_productivity", domain: "operator", state: { snapshot: mediumSnapshot, decisionContext: mediumDecisionContext, goldState: mediumGoldState } },
    { message: "La qualità dati è affidabile?", intent: "ask_data_quality", domain: "data_quality", state: { snapshot: fragileSnapshot, decisionContext: fragileDecisionContext, goldState: fragileGoldState } }
  ];
  const routerVariants = evaluateRouterVariants(routerCases);
  const chosenVariant = routerVariants[0]?.variant || "balanced_v2";

  const tests = [
    { id: "center_status", message: "Come sta il centro oggi?", expectedIntent: "ask_center_status", expectedDomain: "decision", overrides: { snapshot: mediumSnapshot, decisionContext: mediumDecisionContext, goldState: mediumGoldState } },
    { id: "cash_issue", message: "Verifica la cassa e i pagamenti da collegare", expectedIntent: "ask_cash_issue", expectedDomain: "cash", overrides: { snapshot: mediumSnapshot, decisionContext: mediumDecisionContext, goldState: mediumGoldState } },
    { id: "daily_priority", message: "Cosa devo fare oggi?", expectedIntent: "ask_priority", expectedDomain: "decision", overrides: { snapshot: fragileSnapshot, decisionContext: fragileDecisionContext, goldState: fragileGoldState } },
    { id: "marketing", message: "Chi devo richiamare nel marketing?", expectedIntent: "ask_marketing_opportunity", expectedDomain: "marketing", overrides: { snapshot: mediumSnapshot, decisionContext: mediumDecisionContext, goldState: mediumGoldState } },
    { id: "report_summary", message: "Fammi un report dell'andamento", expectedIntent: "ask_report_summary", expectedDomain: "report", overrides: { snapshot: strongSnapshot, decisionContext: strongDecisionContext, goldState: strongGoldState } },
    { id: "tenant_strong", message: "Come sta il centro nel complesso?", expectedIntent: "ask_center_status", expectedDomain: "decision", overrides: { snapshot: strongSnapshot, decisionContext: strongDecisionContext, goldState: strongGoldState } },
    { id: "tenant_medium", message: "Qual è lo stato generale del centro?", expectedIntent: "ask_center_status", expectedDomain: "decision", overrides: { snapshot: mediumSnapshot, decisionContext: mediumDecisionContext, goldState: mediumGoldState } },
    { id: "tenant_fragile", message: "Come sta il centro e quali sono le priorità?", expectedIntent: "ask_center_status", expectedDomain: "decision", overrides: { snapshot: fragileSnapshot, decisionContext: fragileDecisionContext, goldState: fragileGoldState } }
  ];

  const results = tests.map((testCase) => {
    const corelia = bridge.buildDialog({
      message: testCase.message,
      routerVariant: chosenVariant,
      sourceOverrides: testCase.overrides
    }, session);
    const nyraReply = nyra.render(corelia, { message: testCase.message });
    assert(corelia.intent === testCase.expectedIntent || testCase.id.startsWith("tenant_"), `Intent errato per ${testCase.id}: ${corelia.intent}`);
    assert(corelia.domain === testCase.expectedDomain, `Domain errato per ${testCase.id}: ${corelia.domain}`);
    assert(corelia.identity === "corelia", `Identity Corelia assente per ${testCase.id}`);
    assert(nyraReply.identity === "nyra", `Identity Nyra assente per ${testCase.id}`);
    assert((nyraReply.coherence || {}).ok !== false, `Coerenza fallita per ${testCase.id}`);
    assert(!/openai/i.test(JSON.stringify({ corelia, nyraReply })), `OpenAI non deve comparire per ${testCase.id}`);
    return {
      id: testCase.id,
      intent: corelia.intent,
      domain: corelia.domain,
      actionBand: corelia.actionBand,
      confidence: corelia.confidence,
      urgency: corelia.urgency,
      coreliaSummary: corelia.humanSummary,
      nyraReply: nyraReply.reply,
      coherence: nyraReply.coherence
    };
  });

  const afterCounts = {
    clients: service.clientsRepository.list().length,
    appointments: service.appointmentsRepository.list().length,
    payments: service.paymentsRepository.list().length,
    inventory: service.inventoryRepository.list().length
  };
  assert(JSON.stringify(beforeCounts) === JSON.stringify(afterCounts), "Il test ha modificato dati reali");

  const report = {
    ok: true,
    tenant: { centerId: user.centerId, centerName: user.centerName },
    routerVariants,
    chosenVariant,
    results,
    writeCheck: {
      beforeCounts,
      afterCounts,
      unchanged: true
    }
  };

  const reportPath = path.resolve(__dirname, "../reports/ai-gold-tests/corelia_nyra_dialog_test_latest.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
