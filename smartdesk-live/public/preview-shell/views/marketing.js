export function renderMarketingView(deps) {
  const {
    moduleEnabled,
    renderLockedModule,
    currentLanguage,
    canUseAiGold,
    state,
    classifyMarketingClient,
    marketingMessageForClient,
    daysFromToday,
    t,
    renderEnterpriseBanner,
    escapeHtml,
    goldMarketingQueue
  } = deps;

  if (!moduleEnabled("marketing")) {
    return renderLockedModule({
      title: "Marketing",
      reason: currentLanguage() === "en" ? "Marketing is not active in this center configuration." : "Il marketing non e attivo in questa configurazione centro.",
      hint: currentLanguage() === "en" ? "Enable the module from settings to work on manual recalls and lists." : "Attiva il modulo da impostazioni per lavorare recall manuali e liste."
    });
  }

  const hasAiGold = Boolean(canUseAiGold() && state.goldCapabilities?.aiGoldEnabled);
  const marketingClients = (state.clients || [])
    .filter((item) => item.recallDue || item.marketingConsent)
    .map((item) => ({
      ...item,
      bucket: classifyMarketingClient(item),
      message: marketingMessageForClient(item),
      daysDelta: daysFromToday(item.recallDue)
    }));
  const groups = {
    to_recall: marketingClients.filter((item) => item.bucket === "to_recall"),
    at_risk: marketingClients.filter((item) => item.bucket === "at_risk"),
    lost: marketingClients.filter((item) => item.bucket === "lost"),
    historic: marketingClients.filter((item) => item.bucket === "historic")
  };
  const sections = [
    { key: "to_recall", label: t("marketingView.toRecall"), items: groups.to_recall },
    { key: "at_risk", label: t("marketingView.atRisk"), items: groups.at_risk },
    { key: "lost", label: t("marketingView.lost"), items: groups.lost },
    { key: "historic", label: t("marketingView.historic"), items: groups.historic }
  ];
  const title = hasAiGold ? t("marketingView.titleGold") : t("marketingView.titleBasic");
  const subtitle = hasAiGold ? t("marketingView.subtitleGold") : t("marketingView.subtitleBasic");
  const planHint = hasAiGold ? t("marketingView.planHintGold") : t("marketingView.planHintBasic");

  return `
    <div class="stack">
      ${renderEnterpriseBanner()}
      <section class="card">
        <div class="dashboard-hero">
          <div>
            <div class="section-title">${title}</div>
            <div class="page-subtitle">${subtitle}</div>
          </div>
          <div class="hero-badges">
            <div class="module-pill active">${sections[0].items.length + sections[1].items.length} ${t("clientsView.recall").toLowerCase()}</div>
            <button class="sh-button secondary-btn" data-view-link="${hasAiGold ? "ai-gold" : "clients"}" type="button">${hasAiGold ? t("marketingView.openAiGold") : t("marketingView.openClients")}</button>
          </div>
        </div>
        <div class="settings-note mt-16">${planHint}</div>
      </section>
      <div class="settings-grid">
        ${sections.map((section) => `
          <section class="card">
            <div class="row between mb-16">
              <div class="section-title">${section.label}</div>
              <div class="module-pill ${section.items.length ? "active" : ""}">${section.items.length}</div>
            </div>
            <div class="list">
              ${section.items.length ? section.items.slice(0, 6).map((item) => `
                <div class="list-item">
                  <div>
                    <div class="item-title">${escapeHtml(item.name || t("agendaView.client"))}</div>
                    <div class="item-subtitle">${escapeHtml(item.phone || t("marketingView.phoneUnavailable"))} · ${item.daysDelta !== null ? (item.daysDelta >= 0 ? t("marketingView.dueInDays", { count: item.daysDelta }) : t("marketingView.daysLate", { count: Math.abs(item.daysDelta) })) : "--"}</div>
                    <div class="item-subtitle mt-16">${escapeHtml(item.marketingConsent ? item.message : t("marketingView.consentMissing"))}</div>
                  </div>
                  <div class="action-row">
                    <button class="sh-button secondary-btn" data-action="copy-marketing-message" data-id="${escapeHtml(item.id)}" type="button" ${item.marketingConsent ? "" : "disabled"}>${t("marketingView.copy")}</button>
                    <button class="sh-button secondary-btn" data-action="open-marketing-client" data-id="${escapeHtml(item.id)}" type="button">${t("marketingView.openClientSheet")}</button>
                  </div>
                </div>
              `).join("") : `<div class="settings-note">${section.key === "to_recall" || section.key === "at_risk" ? t("marketingView.emptyCopy") : t("marketingView.emptyTitle")}</div>`}
            </div>
          </section>
        `).join("")}
      </div>
      ${hasAiGold ? `
        <section class="card">
          <div class="row between mb-16">
            <div class="section-title">${t("aiGoldView.marketingQueue")}</div>
            <button class="sh-button secondary-btn" data-view-link="ai-gold" type="button">${t("marketingView.reviewInGold")}</button>
          </div>
          <div class="list">
            ${goldMarketingQueue().length ? goldMarketingQueue().map((item) => `
              <div class="list-item">
                <div>
                  <div class="item-title">${escapeHtml(item.name || t("agendaView.client"))}</div>
                  <div class="item-subtitle">${escapeHtml(item.recallDue || "--")} · ${escapeHtml(item.recommendedProtocol || t("clientsView.noProtocol"))}</div>
                </div>
              </div>
            `).join("") : `<div class="settings-note">${t("aiGoldView.noMarketingQueue")}</div>`}
          </div>
        </section>
      ` : ""}
    </div>
  `;
}
