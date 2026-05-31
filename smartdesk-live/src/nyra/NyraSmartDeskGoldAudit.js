"use strict";

const fs = require("fs");
const path = require("path");

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value) {
  return Boolean(value);
}

function text(value = "") {
  return String(value || "").trim();
}

function issue(id, status, severity, detail, evidence = {}) {
  return { id, status, severity, detail, evidence };
}

function pass(id, detail, evidence = {}) {
  return issue(id, "pass", "info", detail, evidence);
}

function warn(id, detail, evidence = {}) {
  return issue(id, "warn", "medium", detail, evidence);
}

function fail(id, detail, evidence = {}) {
  return issue(id, "fail", "high", detail, evidence);
}

function routeSupported(bundleText, action) {
  const normalized = text(action);
  if (!normalized) return false;
  return bundleText.includes(`case"${normalized}"`) || bundleText.includes(`case "${normalized}"`);
}

function readActiveFrontendBundle(rootDir) {
  const indexPath = path.join(rootDir, "public", "index.html");
  const html = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
  const match = html.match(/<script[^>]+type="module"[^>]+src="\/assets\/([^"]+\.js)"/)
    || html.match(/src="\/assets\/(index-[^"]+\.js)"/);
  const bundlePath = match ? path.join(rootDir, "public", "assets", match[1]) : "";
  return {
    indexPath,
    bundlePath,
    bundleText: bundlePath && fs.existsSync(bundlePath) ? fs.readFileSync(bundlePath, "utf8") : ""
  };
}

class NyraSmartDeskGoldAudit {
  constructor({ desktopMirror, assistantService, rootDir = process.cwd() } = {}) {
    this.desktopMirror = desktopMirror;
    this.assistantService = assistantService;
    this.rootDir = rootDir;
  }

  getGoldSession(session = null) {
    if (session) return session;
    const fallbackUser = this.desktopMirror?.usersRepository?.list?.()
      ?.find((user) => String(user.role || "").toLowerCase() !== "superadmin" && String(user.subscriptionPlan || "").toLowerCase() === "gold")
      || this.desktopMirror?.usersRepository?.list?.()?.find((user) => String(user.role || "").toLowerCase() !== "superadmin");
    return {
      role: "owner",
      centerId: fallbackUser?.centerId || "center_admin",
      centerName: fallbackUser?.centerName || fallbackUser?.businessName || "Centro Smart Desk",
      subscriptionPlan: "gold",
      accessState: "active"
    };
  }

  async run(session = null, options = {}) {
    if (!this.desktopMirror) throw new Error("NyraSmartDeskGoldAudit richiede DesktopMirrorService");
    const resolvedSession = this.getGoldSession(session);
    const frontend = readActiveFrontendBundle(this.rootDir);
    const checks = [];

    const dashboard = this.desktopMirror.getDashboardStats?.({ period: "day" }, resolvedSession) || {};
    const operationalReport = this.desktopMirror.getOperationalReport?.({ period: "month" }, resolvedSession) || {};
    const profitability = this.desktopMirror.getProfitabilityOverview?.({}, resolvedSession) || {};
    const decisionCenter = this.desktopMirror.getAiGoldDecisionCenter?.({}, resolvedSession) || {};
    const dataQuality = this.desktopMirror.getDataQuality?.(resolvedSession, { summaryOnly: true }) || {};
    const goldState = this.desktopMirror.getGoldState?.(resolvedSession) || {};
    const decisionContext = this.desktopMirror.getGoldDecisionContext?.({}, resolvedSession) || {};
    const snapshot = this.desktopMirror.getBusinessSnapshot?.({}, resolvedSession) || {};

    const todayAppointments = number(dashboard.todayAppointments);
    const todayRevenueCents = number(dashboard.todayRevenueCents);
    const reportRevenueCents = number(operationalReport?.totals?.revenueCents);
    const dashboardSource = text(dashboard?.dashboardCache?.source || dashboard?.source);
    if (dashboardSource === "gold_state") {
      checks.push(fail("dashboard_period_source", "Dashboard giornaliera alimentata da Gold State aggregato: rischio numeri falsi.", { dashboardSource }));
    } else {
      checks.push(pass("dashboard_period_source", "Dashboard giornaliera non usa Gold State aggregato come sorgente primaria.", { dashboardSource }));
    }
    if (todayAppointments === 0 && todayRevenueCents > 100000) {
      checks.push(fail("dashboard_zero_appointments_high_revenue", "Incasso giornaliero alto con zero appuntamenti: Nyra deve segnalarlo come anomalia, non come centro sano.", { todayAppointments, todayRevenueCents }));
    } else {
      checks.push(pass("dashboard_zero_appointments_high_revenue", "Nessuna anomalia forte tra appuntamenti giornalieri e incasso giorno.", { todayAppointments, todayRevenueCents }));
    }
    if (todayRevenueCents > 0 && reportRevenueCents > 0 && todayRevenueCents > reportRevenueCents * 1.5) {
      checks.push(fail("dashboard_report_revenue_alignment", "Incasso giorno maggiore del report mese: probabile mix di finestre temporali.", { todayRevenueCents, reportRevenueCents }));
    } else {
      checks.push(pass("dashboard_report_revenue_alignment", "Dashboard e report non mostrano un conflitto temporale evidente.", { todayRevenueCents, reportRevenueCents }));
    }

    const centerHealth = snapshot?.report?.centerHealth || {};
    const saturationPercent = number(centerHealth.saturationPercent);
    const revenuePerOperatorCents = number(centerHealth.revenuePerOperatorCents);
    const healthStatus = text(centerHealth.status);
    if (healthStatus === "stabile" && (saturationPercent < 15 || revenuePerOperatorCents < 250000)) {
      checks.push(fail("center_health_survival_first", "Stato centro stabile non coerente con sopravvivenza operativa: prima volume/saturazione, poi margini.", { healthStatus, saturationPercent, revenuePerOperatorCents }));
    } else {
      checks.push(pass("center_health_survival_first", "Salute centro rispetta la regola: prima volume e saturazione, poi ottimizzazione.", { healthStatus, saturationPercent, revenuePerOperatorCents }));
    }

    const profitabilityBlocked = bool(profitability?.meta?.blockedForConfiguration)
      || /configurare|bassa/i.test(JSON.stringify(profitability?.confidence || {}));
    const exposedProfitabilityRevenue = number(profitability?.revenueCents || profitability?.totals?.revenueCents);
    if (profitabilityBlocked && exposedProfitabilityRevenue > 0) {
      checks.push(fail("profitability_blocked_numbers", "Redditività bloccata/configurazione bassa ma mostra numeri forti: rischio vendibilità finta.", { profitabilityBlocked, exposedProfitabilityRevenue }));
    } else {
      checks.push(pass("profitability_blocked_numbers", "Redditività bloccata non promuove numeri economici come validi.", { profitabilityBlocked, exposedProfitabilityRevenue }));
    }

    checks.push(goldState.agendaParallel
      ? pass("agenda_parallel_present", "agendaParallel presente nel Gold State.", { status: goldState.agendaParallel?.status || "" })
      : fail("agenda_parallel_present", "agendaParallel mancante: Nyra deve intercettare che l'agenda non sta governando la lettura Gold.", {}));
    checks.push(goldState.decisionParallel
      ? pass("decision_parallel_present", "decisionParallel presente nel Gold State.", { status: goldState.decisionParallel?.status || "" })
      : fail("decision_parallel_present", "decisionParallel mancante: Core Decision non è dimostrato nello stato Gold.", {}));

    const marketingParallel = goldState.marketingParallel || {};
    checks.push(marketingParallel.mathAdapter || /marketing_policy_adapter_v1/i.test(JSON.stringify(marketingParallel))
      ? pass("marketing_math_adapter_present", "Marketing Core espone prova mathAdapter/policy adapter.", { mathAdapter: marketingParallel.mathAdapter || "" })
      : warn("marketing_math_adapter_present", "Marketing Core non espone prova chiara del mathAdapter: rischio fallback indistinto.", { keys: Object.keys(marketingParallel) }));

    const dataQualitySource = text(dataQuality?.source || goldState?.dataQualitySelection?.source || snapshot?.dataQuality?.source);
    if (/legacy/i.test(dataQualitySource)) {
      checks.push(fail("data_quality_not_legacy_primary", "Data Quality risulta ancora legacy dove dovrebbe essere Core primaria.", { dataQualitySource }));
    } else {
      checks.push(pass("data_quality_not_legacy_primary", "Data Quality non risulta legacy primaria nel controllo Nyra.", { dataQualitySource }));
    }

    const uiLabel = text(decisionCenter?.summary?.uiReadingLabel);
    const decisionConfidence = number(decisionCenter?.summary?.decisionConfidence ?? decisionContext.globalConfidence);
    if (/chiara/i.test(uiLabel) && decisionConfidence <= 0.05) {
      checks.push(fail("decision_confidence_label_alignment", "AI Gold dice risposta chiara con confidence zero: messaggio e dato tecnico non coincidono.", { uiLabel, decisionConfidence }));
    } else {
      checks.push(pass("decision_confidence_label_alignment", "Etichetta UI e confidence non sono in conflitto evidente.", { uiLabel, decisionConfidence }));
    }

    const assistant = this.assistantService;
    let priorityReply = null;
    if (assistant?.chat) {
      priorityReply = await assistant.chat({ message: options.priorityQuestion || "cosa devo fare oggi" }, resolvedSession);
      const action = text(priorityReply?.action);
      const message = text(priorityReply?.message || priorityReply?.answer);
      if (!action) {
        checks.push(fail("ai_gold_priority_action_not_null", "Il comando priorità torna senza action: AI Gold parla ma non accompagna l'operatore.", { priorityReply }));
      } else {
        checks.push(pass("ai_gold_priority_action_not_null", "Il comando priorità torna con action operativa.", { action, route: priorityReply?.payload?.route || "" }));
      }
      if (message.length < 80) {
        checks.push(fail("ai_gold_speaks_operationally", "AI Gold risponde troppo poco o muta: deve leggere dati e dire cosa fare.", { messageLength: message.length, message }));
      } else {
        checks.push(pass("ai_gold_speaks_operationally", "AI Gold produce una risposta operativa leggibile.", { messageLength: message.length }));
      }
      if (action && !routeSupported(frontend.bundleText, action)) {
        checks.push(fail("frontend_supports_ai_action", "Il backend produce un'action che il frontend attivo non gestisce.", { action, bundlePath: frontend.bundlePath }));
      } else if (action) {
        checks.push(pass("frontend_supports_ai_action", "Il frontend attivo gestisce l'action prodotta da AI Gold.", { action, bundlePath: frontend.bundlePath }));
      }
    } else {
      checks.push(fail("ai_gold_priority_action_not_null", "AssistantService non disponibile nell'audit Nyra.", {}));
    }

    let aiGoldAsk = null;
    if (assistant?.aiGoldAsk) {
      aiGoldAsk = await assistant.aiGoldAsk({ question: options.goldQuestion || "Leggi i dati del centro e dimmi cosa serve davvero oggi." }, resolvedSession);
      const provider = text(aiGoldAsk?.provider);
      const answer = text(aiGoldAsk?.answer);
      if (!/corelia|nyra|universal_core/i.test(provider) && !aiGoldAsk?.dialogue && !aiGoldAsk?.structured) {
        checks.push(warn("ai_gold_governed_by_core_nyra", "AI Gold risponde da provider non governato esplicitamente da Core/Nyra. OpenAI deve rifinire, non governare.", { provider }));
      } else {
        checks.push(pass("ai_gold_governed_by_core_nyra", "AI Gold espone governo Core/Nyra o fallback Corelia.", { provider }));
      }
      if (answer.length < 80) {
        checks.push(fail("ai_gold_ask_answer_useful", "AI Gold Ask non produce una risposta utile sui dati del centro.", { provider, answerLength: answer.length, answer }));
      } else {
        checks.push(pass("ai_gold_ask_answer_useful", "AI Gold Ask produce una risposta leggibile sui dati del centro.", { provider, answerLength: answer.length }));
      }
    }

    const openAiMode = text(process.env.SMARTDESK_AI_PROVIDER || "corelia_only");
    const openAiKeyPresent = Boolean(text(process.env.OPENAI_API_KEY));
    if (openAiMode !== "corelia_only" && !openAiKeyPresent) {
      checks.push(warn("openai_runtime_available", "SMARTDESK_AI_PROVIDER consente OpenAI ma OPENAI_API_KEY non è presente nel runtime.", { openAiMode, openAiKeyPresent }));
    } else {
      checks.push(pass("openai_runtime_available", "Runtime AI coerente con configurazione provider.", { openAiMode, openAiKeyPresent }));
    }

    const failures = checks.filter((item) => item.status === "fail");
    const warnings = checks.filter((item) => item.status === "warn");
    const verdict = failures.length ? "fail" : warnings.length ? "warn" : "pass";
    const report = {
      ok: verdict === "pass",
      verdict,
      generatedAt: new Date().toISOString(),
      scope: "nyra_smartdesk_gold_product_audit_v1",
      tenant: {
        centerId: resolvedSession.centerId,
        centerName: resolvedSession.centerName,
        plan: resolvedSession.subscriptionPlan
      },
      summary: {
        pass: checks.filter((item) => item.status === "pass").length,
        warn: warnings.length,
        fail: failures.length
      },
      checks,
      samples: {
        dashboard: { todayAppointments, todayRevenueCents, dashboardSource },
        report: { revenueCents: reportRevenueCents },
        profitability: { blocked: profitabilityBlocked, exposedRevenueCents: exposedProfitabilityRevenue },
        decision: { uiLabel, decisionConfidence },
        priorityReply,
        aiGoldAsk
      }
    };
    return report;
  }
}

function writeNyraSmartDeskGoldAuditReport(report, outputPath) {
  const target = outputPath || path.resolve(process.cwd(), "reports", "ai-gold-tests", "nyra_smartdesk_gold_product_audit_latest.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return target;
}

module.exports = {
  NyraSmartDeskGoldAudit,
  writeNyraSmartDeskGoldAuditReport
};
