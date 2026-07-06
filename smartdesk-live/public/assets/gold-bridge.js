(function () {
  const SCRIPT_ID = "skinharmony-gold-bridge-style";
  const PANEL_ID = "skinharmony-gold-priority-bridge";
  const ROUTES = new Set(["/", "/dashboard", "/ai-gold"]);
  const SETTINGS_PANEL_ID = "skinharmony-admin-tools-bridge";
  const ENTERPRISE_HOME_PANEL_ID = "skinharmony-enterprise-home-bridge";
  const ENTERPRISE_SETTINGS_PANEL_ID = "skinharmony-enterprise-settings-bridge";
  const ENTERPRISE_REPORTS_PANEL_ID = "skinharmony-enterprise-reports-bridge";
  const ENTERPRISE_SURFACE_PANEL_ID = "skinharmony-enterprise-surface-bridge";
  const TOPBAR_MENU_BUTTON_ID = "skinharmony-topbar-menu-toggle";
  const TOPBAR_MENU_STORAGE_KEY = "skinharmony-topbar-menu-expanded";
  let renderToken = 0;
  let goldRenderTimers = [];
  let settingsRenderTimers = [];
  let observerStarted = false;
  let mutationLockDepth = 0;
  let uiLanguage = "it";
  let uiLanguageReady = false;
  let uiLanguageRefreshPromise = null;
  let uiLanguageLastRefreshAt = 0;

  function normalizeLanguage(value) {
    const language = String(value || "").toLowerCase().slice(0, 2);
    if (language === "en" || language === "de") return language;
    return "it";
  }

  function isEnglish() {
    return uiLanguage === "en";
  }

  function isGerman() {
    return uiLanguage === "de";
  }

  function isPublicAuthRoute() {
    return ["/login", "/trial", "/verify-email", "/forgot-password", "/reset-password"].includes(window.location.pathname || "");
  }

  function getStoredPublicLanguage() {
    try {
      return window.localStorage.getItem("skinharmony-web-public-language");
    } catch (_error) {
      return "";
    }
  }

  function copy(it, en, de = en) {
    if (isGerman()) return de;
    return isEnglish() ? en : it;
  }

  function injectStyle() {
    if (document.getElementById(SCRIPT_ID)) return;
    const style = document.createElement("style");
    style.id = SCRIPT_ID;
    style.textContent = `
      .gold-bridge-panel {
        margin: 18px 0 20px;
        border-radius: 22px;
        border: 1px solid rgba(79,182,214,0.22);
        background: rgba(255,255,255,0.97);
        box-shadow: 0 20px 50px rgba(18,56,77,0.08);
        padding: 20px;
      }
      .topbar-nav.sh-topbar-nav-collapsible {
        overflow: hidden;
        transition: max-height 0.18s ease, opacity 0.18s ease, margin-top 0.18s ease;
      }
      .topbar-nav.sh-topbar-nav-collapsible.sh-topbar-nav-collapsed {
        max-height: 0 !important;
        opacity: 0;
        margin-top: 0 !important;
        pointer-events: none;
      }
      .topbar-nav.sh-topbar-nav-collapsible.sh-topbar-nav-expanded {
        max-height: 520px;
        opacity: 1;
        pointer-events: auto;
      }
      .sh-topbar-menu-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 42px;
        padding: 9px 14px;
        border-radius: 14px;
        border: 1px solid rgba(79,182,214,0.28);
        background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(239,249,253,0.95));
        color: #276b86;
        font: inherit;
        font-size: 13px;
        font-weight: 900;
        cursor: pointer;
        box-shadow: 0 10px 24px rgba(31,134,170,0.09);
      }
      .sh-topbar-menu-toggle:hover,
      .sh-topbar-menu-toggle:focus-visible {
        border-color: rgba(79,182,214,0.58);
        outline: none;
      }
      .sh-topbar-menu-toggle-current {
        max-width: 190px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #5d7380;
        font-weight: 800;
      }
      .sh-topbar-menu-toggle-icon {
        font-size: 15px;
        line-height: 1;
        color: #1f86aa;
      }
      .gold-bridge-source {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 14px;
        align-items: center;
        margin-bottom: 14px;
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px solid rgba(79,182,214,0.24);
        background: linear-gradient(180deg, rgba(239,250,254,0.96) 0%, rgba(255,255,255,0.96) 100%);
      }
      .gold-bridge-source-title {
        font-size: 12px;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #1f86aa;
        margin-bottom: 4px;
      }
      .gold-bridge-source-copy {
        font-size: 13px;
        line-height: 1.5;
        color: #4d6877;
      }
      .gold-bridge-source-status {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        padding: 0 12px;
        border-radius: 999px;
        background: rgba(50,181,118,0.12);
        color: #1f7b4d;
        font-size: 12px;
        font-weight: 900;
        white-space: nowrap;
      }
      .gold-bridge-source-status.fallback {
        background: rgba(243,179,54,0.16);
        color: #8c5a12;
      }
      .gold-bridge-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 14px;
      }
      .gold-bridge-title {
        font-size: 20px;
        font-weight: 800;
        color: #163747;
        margin: 0 0 6px;
      }
      .gold-bridge-subtitle {
        font-size: 13px;
        line-height: 1.55;
        color: #5b7f91;
        margin: 0;
      }
      .gold-bridge-pill {
        display: inline-flex;
        align-items: center;
        min-height: 36px;
        padding: 0 14px;
        border-radius: 999px;
        background: rgba(79,182,214,0.14);
        color: #1f86aa;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .gold-bridge-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 14px;
      }
      .gold-bridge-metric {
        border-radius: 16px;
        border: 1px solid rgba(121,159,184,0.18);
        background: rgba(247,250,253,0.94);
        padding: 14px 16px;
      }
      .gold-bridge-metric[data-gold-route],
      .gold-bridge-item[data-gold-route],
      .enterprise-bridge-card[data-enterprise-card-target] {
        cursor: pointer;
        transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
      }
      .gold-bridge-metric[data-gold-route]:hover,
      .gold-bridge-item[data-gold-route]:hover,
      .enterprise-bridge-card[data-enterprise-card-target]:hover {
        transform: translateY(-1px);
        border-color: rgba(42,158,196,0.34);
        box-shadow: 0 14px 28px rgba(31,134,170,0.08);
      }
      .gold-bridge-label {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #6b8391;
        margin-bottom: 6px;
      }
      .gold-bridge-value {
        font-size: 18px;
        font-weight: 800;
        color: #163747;
        line-height: 1.35;
      }
      .gold-bridge-list {
        display: grid;
        gap: 10px;
      }
      .gold-bridge-item {
        border-radius: 16px;
        border: 1px solid rgba(121,159,184,0.16);
        background: rgba(247,250,253,0.92);
        padding: 14px 16px;
      }
      .gold-bridge-item-title {
        font-size: 15px;
        font-weight: 700;
        color: #163747;
        margin-bottom: 4px;
      }
      .gold-bridge-item-subtitle {
        font-size: 13px;
        color: #5b7f91;
        line-height: 1.5;
      }
      @media (max-width: 900px) {
        .gold-bridge-grid {
          grid-template-columns: 1fr;
        }
      }
      .admin-tools-panel {
        margin: 18px 0 20px;
        border-radius: 22px;
        border: 1px solid rgba(121,159,184,0.18);
        background: rgba(255,255,255,0.97);
        box-shadow: 0 20px 50px rgba(18,56,77,0.08);
        padding: 20px;
      }
      .admin-tools-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 14px;
      }
      .admin-tools-title {
        font-size: 20px;
        font-weight: 800;
        color: #163747;
        margin: 0 0 6px;
      }
      .admin-tools-subtitle {
        font-size: 13px;
        line-height: 1.55;
        color: #5b7f91;
        margin: 0;
      }
      .admin-tools-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 14px;
      }
      .admin-tools-button {
        min-height: 44px;
        padding: 0 16px;
        border-radius: 14px;
        border: 0;
        background: linear-gradient(135deg, rgba(126,211,229,.94), rgba(47,171,200,.96));
        color: #fff;
        font-size: 13px;
        font-weight: 800;
        cursor: pointer;
      }
      .admin-tools-button.secondary {
        background: rgba(247,250,253,.98);
        color: #163747;
        border: 1px solid rgba(121,159,184,0.22);
      }
      .admin-tools-status {
        margin-top: 12px;
        font-size: 13px;
        line-height: 1.5;
        color: #5b7f91;
      }
      .enterprise-bridge-panel {
        margin: 18px 0 20px;
        border-radius: 24px;
        border: 1px solid rgba(79,182,214,0.18);
        background:
          radial-gradient(circle at top right, rgba(105,211,240,0.16), transparent 32%),
          linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(244,249,253,0.96) 100%);
        box-shadow: 0 20px 50px rgba(18,56,77,0.08);
        padding: 22px;
      }
      .enterprise-bridge-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 14px;
      }
      .enterprise-bridge-title {
        font-size: 20px;
        font-weight: 800;
        color: #163747;
        margin: 0 0 6px;
      }
      .enterprise-bridge-subtitle {
        font-size: 13px;
        line-height: 1.6;
        color: #5b7f91;
        margin: 0;
      }
      .enterprise-bridge-pill {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        padding: 0 14px;
        border-radius: 999px;
        background: rgba(79,182,214,0.14);
        color: #1f86aa;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .enterprise-bridge-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
      }
      .enterprise-bridge-card {
        border-radius: 18px;
        border: 1px solid rgba(121,159,184,0.16);
        background: rgba(255,255,255,0.82);
        padding: 16px;
      }
      .enterprise-bridge-card-title {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #6b8391;
        margin-bottom: 8px;
      }
      .enterprise-bridge-card-value {
        font-size: 16px;
        line-height: 1.45;
        font-weight: 700;
        color: #163747;
      }
      .enterprise-bridge-card-copy {
        font-size: 13px;
        line-height: 1.55;
        color: #5b7f91;
      }
      .enterprise-center-list {
        display: grid;
        gap: 10px;
        margin-top: 14px;
      }
      .enterprise-center-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 12px;
        align-items: center;
        border-radius: 18px;
        border: 1px solid rgba(121,159,184,0.16);
        background: rgba(255,255,255,0.88);
        padding: 14px 16px;
      }
      .enterprise-center-name {
        font-size: 15px;
        font-weight: 800;
        color: #163747;
      }
      .enterprise-center-meta {
        margin-top: 4px;
        font-size: 12px;
        line-height: 1.45;
        color: #6b8391;
      }
      .enterprise-center-action {
        min-height: 40px;
        padding: 0 14px;
        border-radius: 14px;
        border: 0;
        background: linear-gradient(135deg, rgba(126,211,229,.94), rgba(47,171,200,.96));
        color: #fff;
        font-size: 13px;
        font-weight: 800;
        cursor: pointer;
        white-space: nowrap;
      }
      .enterprise-bridge-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 16px;
      }
      .enterprise-bridge-link {
        min-height: 40px;
        padding: 0 14px;
        border-radius: 14px;
        border: 1px solid rgba(79,182,214,0.18);
        background: rgba(255,255,255,0.92);
        color: #1f86aa;
        font-size: 13px;
        font-weight: 800;
        cursor: pointer;
      }
      .enterprise-bridge-link.active {
        border-color: rgba(42,158,196,0.42);
        background: linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(233,247,252,1) 100%);
        box-shadow: 0 12px 24px rgba(31,134,170,0.08);
      }
      .dashboard-period-toggle .sh-button.active-btn,
      .dashboard-period-toggle button.active-btn,
      .dashboard-period-toggle .secondary-btn.active-btn {
        border-color: rgba(42,158,196,0.48) !important;
        background: linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(233,247,252,1) 100%) !important;
        color: #1f86aa !important;
        box-shadow: 0 12px 24px rgba(31,134,170,0.10) !important;
        outline: 2px solid rgba(79,182,214,0.18) !important;
      }
      .dashboard-period-toggle .sh-button:not(.active-btn),
      .dashboard-period-toggle button:not(.active-btn) {
        opacity: 0.92;
      }
      @media (max-width: 900px) {
        .enterprise-bridge-grid {
          grid-template-columns: 1fr;
        }
        .enterprise-bridge-header {
          flex-direction: column;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function riskLabel(band) {
    if (band === "high") return copy("Rischio alta", "High risk", "Hohes Risiko");
    if (band === "medium") return copy("Rischio media", "Medium risk", "Mittleres Risiko");
    return copy("Rischio bassa", "Low risk", "Niedriges Risiko");
  }

  function normalizeRoute(value) {
    const route = String(value || "").trim();
    if (!route) return "";
    return route.startsWith("/") ? route : `/${route}`;
  }

  function navigateTo(route) {
    const target = normalizeRoute(route);
    if (!target || target === window.location.pathname) return;
    history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function routeForDomain(domain, fallback = "/ai-gold") {
    const value = String(domain || "").toLowerCase();
    if (value.includes("marketing") || value.includes("recall") || value.includes("customer")) return "/marketing";
    if (value.includes("growth")) return "/marketing";
    if (value.includes("client")) return "/clients";
    if (value.includes("agenda") || value.includes("booking") || value.includes("appointment")) return "/appointments";
    if (value.includes("operation")) return "/appointments";
    if (value.includes("cash") || value.includes("payment") || value.includes("checkout")) return "/cashdesk";
    if (value.includes("profit") || value.includes("margin") || value.includes("revenue")) return "/profitability";
    if (value.includes("data_quality") || value.includes("quality")) return "/settings";
    if (value.includes("inventory") || value.includes("stock")) return "/inventory";
    if (value.includes("protocol") || value.includes("treatment")) return "/protocols";
    if (value.includes("staff") || value.includes("shift")) return "/shifts";
    if (value.includes("service") || value.includes("catalog")) return "/services";
    if (value.includes("report")) return "/reports";
    return fallback;
  }

  function routeForGoldAction(action, domain, item = {}) {
    const explicitTarget = normalizeRoute(item.route || item.targetRoute || item.href || item.target || "");
    if (explicitTarget && explicitTarget !== "/dashboard") return explicitTarget === "/autopilot" ? "/marketing" : explicitTarget;
    const value = [
      action,
      item.action,
      item.label,
      item.title,
      item.suggestedAction,
      item.explanationShort,
      item.explanationLong,
      item.reason,
      item.button,
      item.actionLabel
    ].filter(Boolean).join(" ").toLowerCase();
    if (/costi|costo|prezzo|durata|servizi|service|operatori|staff|catalogo/.test(value) && /completa|configura|correggi|verifica|apri/.test(value)) return "/services";
    if (value.includes("marketing") || value.includes("recall") || value.includes("message") || value.includes("messaggio") || value.includes("cliente da")) return "/marketing";
    if (value.includes("client") || value.includes("telefono") || value.includes("email") || value.includes("consenso") || value.includes("contatto")) return "/clients";
    if (value.includes("appointment") || value.includes("booking") || value.includes("agenda") || value.includes("appuntamento")) return "/appointments";
    if (value.includes("cash") || value.includes("checkout") || value.includes("payment") || value.includes("cassa") || value.includes("pagament")) return "/cashdesk";
    if (value.includes("stock") || value.includes("inventory") || value.includes("magazzino")) return "/inventory";
    if (value.includes("protocol") || value.includes("trattament")) return "/protocols";
    if (value.includes("report")) return "/reports";
    if (value.includes("profit") || value.includes("margin") || value.includes("redditiv") || value.includes("margini")) return "/profitability";
    return routeForDomain(domain, "/ai-gold");
  }

  function bindBridgeNavigation(panel) {
    panel.addEventListener("click", (event) => {
      const target = event.target?.closest?.("[data-gold-route],[data-enterprise-card-target],[data-enterprise-nav]");
      if (!target) return;
      navigateTo(target.getAttribute("data-gold-route") || target.getAttribute("data-enterprise-card-target") || target.getAttribute("data-enterprise-nav"));
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target?.closest?.("[data-gold-route],[data-enterprise-card-target],[data-enterprise-nav]");
      if (!target) return;
      event.preventDefault();
      navigateTo(target.getAttribute("data-gold-route") || target.getAttribute("data-enterprise-card-target") || target.getAttribute("data-enterprise-nav"));
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function removePanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();
  }

  function removeSettingsPanel() {
    const existing = document.getElementById(SETTINGS_PANEL_ID);
    if (existing) existing.remove();
  }

  function removeEnterprisePanels() {
    [ENTERPRISE_HOME_PANEL_ID, ENTERPRISE_SETTINGS_PANEL_ID, ENTERPRISE_REPORTS_PANEL_ID, ENTERPRISE_SURFACE_PANEL_ID].forEach((id) => {
      const existing = document.getElementById(id);
      if (existing) existing.remove();
    });
  }

  function clearTimers(list) {
    list.forEach((id) => window.clearTimeout(id));
    list.length = 0;
  }

  function runWithMutationLock(fn) {
    mutationLockDepth += 1;
    try {
      return fn();
    } finally {
      window.setTimeout(() => {
        mutationLockDepth = Math.max(0, mutationLockDepth - 1);
      }, 0);
    }
  }

  function getTopbarMenuExpanded() {
    try {
      return window.localStorage.getItem(TOPBAR_MENU_STORAGE_KEY) === "1";
    } catch (_error) {
      return false;
    }
  }

  function setTopbarMenuExpanded(value) {
    try {
      window.localStorage.setItem(TOPBAR_MENU_STORAGE_KEY, value ? "1" : "0");
    } catch (_error) {}
  }

  function getCurrentTopbarLabel(nav) {
    const active = nav?.querySelector?.(".active-btn, [aria-current='page']");
    const label = String(active?.textContent || "").replace(/\s+/g, " ").trim();
    return label || copy("moduli", "modules", "Module");
  }

  function isEnterpriseControlSessionPayload(session) {
    return String(session?.role || "").toLowerCase() === "superadmin" && !session?.supportMode;
  }

  async function isEnterpriseControlSession() {
    try {
      return isEnterpriseControlSessionPayload(await fetchJson("/api/auth/session"));
    } catch (_error) {
      return false;
    }
  }

  function enhanceTopbarMenu() {
    if (isPublicAuthRoute()) return;
    const nav = document.querySelector(".topbar-nav");
    if (!nav) return;
    const topbar = nav.closest(".topbar") || nav.parentElement;
    if (!topbar) return;

    const expanded = getTopbarMenuExpanded();
    const currentLabel = getCurrentTopbarLabel(nav);

    runWithMutationLock(() => {
      nav.classList.add("sh-topbar-nav-collapsible");
      nav.classList.toggle("sh-topbar-nav-expanded", expanded);
      nav.classList.toggle("sh-topbar-nav-collapsed", !expanded);

      let button = document.getElementById(TOPBAR_MENU_BUTTON_ID);
      if (!button) {
        button = document.createElement("button");
        button.id = TOPBAR_MENU_BUTTON_ID;
        button.type = "button";
        button.className = "sh-topbar-menu-toggle";
        button.addEventListener("click", () => {
          const next = !getTopbarMenuExpanded();
          setTopbarMenuExpanded(next);
          enhanceTopbarMenu();
        });
        nav.insertAdjacentElement("beforebegin", button);
      }

      button.setAttribute("aria-expanded", expanded ? "true" : "false");
      button.innerHTML = `
        <span class="sh-topbar-menu-toggle-icon">${expanded ? "▴" : "▾"}</span>
        <span>${copy("Menu", "Menu", "Menü")}</span>
        <span class="sh-topbar-menu-toggle-current">${escapeHtml(currentLabel)}</span>
      `;
    });
  }

  function shouldRender() {
    return ROUTES.has(window.location.pathname || "/");
  }

  function cleanDisplayText(value, fallback = "") {
    const text = String(value || fallback || "").trim();
    return text || fallback;
  }

  function localizeGeneratedText(value) {
    const counted = (singular, plural) => (_match, count) => `${count} ${Number(count) === 1 ? singular : plural}`;
    let text = String(value || "");
    const replacements = isGerman()
      ? [
        [/\bAI Gold ha letto il centro\./g, "AI Gold hat das Center gelesen."],
        [/\bAI Gold has read the center\./g, "AI Gold hat das Center gelesen."],
        [/\bPrima priorita:/g, "Erste Priorität:"],
        [/\bFirst priority:/g, "Erste Priorität:"],
        [/\bPoi controlla:/g, "Dann prüfen:"],
        [/\bThen check:/g, "Dann prüfen:"],
        [/\bOperatore:/g, "Operator:"],
        [/\bOperator:/g, "Operator:"],
        [/\bSmart Desk non modifica dati:/g, "Smart Desk ändert keine Daten:"],
        [/\bSmart Desk does not change data:/g, "Smart Desk ändert keine Daten:"],
        [/\bapri servizi e operatori, poi completa (\d+) costi servizio e (\d+) costi orari operatori\b/g, (_match, serviceCosts, hourlyCosts) => `Leistungen und Mitarbeitende öffnen, dann ${serviceCosts} ${Number(serviceCosts) === 1 ? "Leistungskostenpunkt" : "Leistungskostenpunkte"} und ${hourlyCosts} ${Number(hourlyCosts) === 1 ? "Stundenkostenpunkt" : "Stundenkostenpunkte"} ergänzen`],
        [/\bopen services and staff, then complete (\d+) service costs? and (\d+) staff hourly costs?\b/g, (_match, serviceCosts, hourlyCosts) => `Leistungen und Mitarbeitende öffnen, dann ${serviceCosts} ${Number(serviceCosts) === 1 ? "Leistungskostenpunkt" : "Leistungskostenpunkte"} und ${hourlyCosts} ${Number(hourlyCosts) === 1 ? "Stundenkostenpunkt" : "Stundenkostenpunkte"} ergänzen`],
        [/\bapri servizi\/operatori e completa i costi prima di leggere la redditivita\b/g, "Leistungen/Mitarbeitende öffnen und Kosten ergänzen, bevor die Rentabilität gelesen wird"],
        [/\bopen services\/staff and complete costs before reading profitability\b/g, "Leistungen/Mitarbeitende öffnen und Kosten ergänzen, bevor die Rentabilität gelesen wird"],
        [/\bapri servizi\/operatori/g, "Leistungen/Mitarbeitende öffnen"],
        [/\bopen services\/staff/g, "Leistungen/Mitarbeitende öffnen"],
        [/\bapri servizi e operatori/g, "Leistungen und Mitarbeitende öffnen"],
        [/\bopen services and staff/g, "Leistungen und Mitarbeitende öffnen"],
        [/\bpoi completa\b/g, "dann ergänzen"],
        [/\bthen complete\b/g, "dann ergänzen"],
        [/\bcompleta i costi prima di leggere la redditivita\b/g, "Kosten ergänzen, bevor die Rentabilität gelesen wird"],
        [/\bcomplete costs before reading profitability\b/g, "Kosten ergänzen, bevor die Rentabilität gelesen wird"],
        [/\bcompleta configurazione costi\b/g, "Kostenkonfiguration ergänzen"],
        [/\bcomplete cost setup\b/g, "Kostenkonfiguration ergänzen"],
        [/\bcompleta il dato o conferma l'azione manuale\b/g, "fehlende Daten ergänzen oder die manuelle Aktion bestätigen"],
        [/\bcomplete the missing data or confirm the manual action\b/g, "fehlende Daten ergänzen oder die manuelle Aktion bestätigen"],
        [/\bconferma prima di eseguire\b/g, "vor der Ausführung bestätigen"],
        [/\bconfirm before executing\b/g, "vor der Ausführung bestätigen"],
        [/\bapri il modulo indicato\b/g, "das angegebene Modul öffnen"],
        [/\bopen the indicated module\b/g, "das angegebene Modul öffnen"],
        [/\bapri cassa\b/g, "Kasse öffnen"],
        [/\bopen checkout\b/g, "Kasse öffnen"],
        [/\bcollega pagamenti\/appuntamenti\b/g, "Zahlungen/Termine verknüpfen"],
        [/\blink payments\/appointments\b/g, "Zahlungen/Termine verknüpfen"],
        [/\bprima del report\b/g, "vor dem Bericht"],
        [/\bbefore the report\b/g, "vor dem Bericht"],
        [/\b(\d+)\s+costi servizio\b/g, counted("Leistungskostenpunkt", "Leistungskostenpunkte")],
        [/\b(\d+)\s+service costs?\b/g, counted("Leistungskostenpunkt", "Leistungskostenpunkte")],
        [/\b(\d+)\s+costi orari operatori\b/g, counted("Stundenkostenpunkt", "Stundenkostenpunkte")],
        [/\b(\d+)\s+staff hourly costs?\b/g, counted("Stundenkostenpunkt", "Stundenkostenpunkte")],
        [/\bcosti orari operatori\b/g, "Stundenkosten Mitarbeitende"],
        [/\bstaff hourly costs\b/g, "Stundenkosten Mitarbeitende"],
        [/\bcosti servizio\b/g, "Leistungskosten"],
        [/\bservice costs\b/g, "Leistungskosten"],
        [/\bservizio\b/g, "Leistung"],
        [/\bservice\b/g, "Leistung"],
        [/\bredditivita\b/g, "Rentabilität"],
        [/\bprofitability\b/g, "Rentabilität"],
        [/\bQualità dati\b/g, "Datenqualität"],
        [/\bData quality\b/g, "Datenqualität"],
        [/\bCliente occasionale\b/g, "Gelegenheitskunde"],
        [/\bOccasional client\b/g, "Gelegenheitskunde"],
        [/\bDominio\b/g, "Bereich"],
        [/\bDomain\b/g, "Bereich"],
        [/\brischio\b/g, "Risiko"],
        [/\brisk\b/g, "Risiko"],
        [/\bpunteggio\b/g, "Score"],
        [/\bscore\b/g, "Score"],
        [/\bconferma owner richiesta\b/g, "Owner-Bestätigung erforderlich"],
        [/\bowner confirmation required\b/g, "Owner-Bestätigung erforderlich"]
      ]
      : isEnglish()
        ? [
        [/\bAI Gold ha letto il centro\./g, "AI Gold has read the center."],
        [/\bPrima priorita:/g, "First priority:"],
        [/\bPoi controlla:/g, "Then check:"],
        [/\bOperatore:/g, "Operator:"],
        [/\bSmart Desk non modifica dati:/g, "Smart Desk does not change data:"],
        [/\bapri servizi e operatori, poi completa (\d+) costi servizio e (\d+) costi orari operatori\b/g, (_match, serviceCosts, hourlyCosts) => `open services and staff, then complete ${serviceCosts} ${Number(serviceCosts) === 1 ? "service cost" : "service costs"} and ${hourlyCosts} ${Number(hourlyCosts) === 1 ? "staff hourly cost" : "staff hourly costs"}`],
        [/\bapri servizi\/operatori e completa i costi prima di leggere la redditivita\b/g, "open services/staff and complete costs before reading profitability"],
        [/\bapri servizi\/operatori/g, "open services/staff"],
        [/\bapri servizi e operatori/g, "open services and staff"],
        [/\bpoi completa\b/g, "then complete"],
        [/\bcompleta i costi prima di leggere la redditivita\b/g, "complete costs before reading profitability"],
        [/\bcompleta costi prima di leggere la redditivita\b/g, "complete costs before reading profitability"],
        [/\bcompleta configurazione costi\b/g, "complete cost setup"],
        [/\bcompleta il dato o conferma l'azione manuale\b/g, "complete the missing data or confirm the manual action"],
        [/\bconferma prima di eseguire\b/g, "confirm before executing"],
        [/\bapri il modulo indicato\b/g, "open the indicated module"],
        [/\bapri cassa\b/g, "open checkout"],
        [/\bcollega pagamenti\/appuntamenti\b/g, "link payments/appointments"],
        [/\s+e\s+link payments\/appointments\b/g, " and link payments/appointments"],
        [/\s+e\s+complete costs before reading profitability\b/g, " and complete costs before reading profitability"],
        [/\s+e\s+(\d+)\s+staff hourly costs?/g, (_match, count) => ` and ${count} ${Number(count) === 1 ? "staff hourly cost" : "staff hourly costs"}`],
        [/\bprima del report\b/g, "before the report"],
        [/\b(\d+)\s+costi servizio\b/g, counted("service cost", "service costs")],
        [/\b(\d+)\s+costi orari operatori\b/g, counted("staff hourly cost", "staff hourly costs")],
        [/\bcosti orari operatori\b/g, "staff hourly costs"],
        [/\bcosti servizio\b/g, "service costs"],
        [/\bservizio\b/g, "service"],
        [/\bredditivita\b/g, "profitability"],
        [/\bQualità dati\b/g, "Data quality"],
        [/\bCliente occasionale\b/g, "Occasional client"],
        [/\bDominio\b/g, "Domain"],
        [/\brischio\b/g, "risk"],
        [/\bpunteggio\b/g, "score"],
        [/\bconferma owner richiesta\b/g, "owner confirmation required"]
      ]
        : [
        [/\bAI Gold has read the center\./g, "AI Gold ha letto il centro."],
        [/\bFirst priority:/g, "Prima priorita:"],
        [/\bThen check:/g, "Poi controlla:"],
        [/\bOperator:/g, "Operatore:"],
        [/\bSmart Desk does not change data:/g, "Smart Desk non modifica dati:"],
        [/\bopen services\/staff/g, "apri servizi/operatori"],
        [/\bopen services and staff/g, "apri servizi e operatori"],
        [/\bcomplete costs before reading profitability\b/g, "completa i costi prima di leggere la redditivita"],
        [/\bcomplete cost setup\b/g, "completa configurazione costi"],
        [/\bcomplete the missing data or confirm the manual action\b/g, "completa il dato o conferma l'azione manuale"],
        [/\bconfirm before executing\b/g, "conferma prima di eseguire"],
        [/\bopen the indicated module\b/g, "apri il modulo indicato"],
        [/\bopen checkout\b/g, "apri cassa"],
        [/\blink payments\/appointments\b/g, "collega pagamenti/appuntamenti"],
        [/\bbefore the report\b/g, "prima del report"],
        [/\bData quality\b/g, "Qualità dati"],
        [/\bOccasional client\b/g, "Cliente occasionale"],
        [/\bDomain\b/g, "Dominio"],
        [/\brisk\b/g, "rischio"],
        [/\bscore\b/g, "punteggio"],
        [/\bowner confirmation required\b/g, "conferma owner richiesta"],
        [/\b(\d+)\s+service costs?\b/g, counted("costi servizio", "costi servizio")],
        [/\b(\d+)\s+staff hourly costs?\b/g, counted("costi orari operatori", "costi orari operatori")]
      ];
    replacements.forEach(([from, to]) => {
      text = text.replace(from, to);
    });
    return text;
  }

  function sourceStatus(context = {}, capabilities = {}) {
    const external = context?.externalAi || {};
    const primary = Boolean(external.primary || context?.summary?.externalPrimary || context?.decisionAuthority === "core_nyra_render_primary");
    const provider = cleanDisplayText(external.provider || context?.summary?.externalProvider || capabilities?.engineName || "", copy("Lettura dati Smart Desk", "Smart Desk data reading", "Smart-Desk-Datenlesung"));
    return {
      primary,
      provider,
      label: primary ? copy("Fonte primaria", "Primary source", "Primärquelle") : copy("Lettura prudente", "Careful reading", "Vorsichtige Lesung"),
      title: primary ? copy("Core/Nyra server in alto", "Core/Nyra server on top", "Core/Nyra-Server als Hauptquelle") : copy("Core/Nyra server non pienamente disponibili", "Core/Nyra server not fully available", "Core/Nyra-Server nicht vollständig verfügbar"),
      copy: primary
        ? copy("Smart Desk legge i dati del centro; Core server decide la priorita; Nyra server spiega cosa fare. OpenAI rifinisce solo la forma se disponibile.", "Smart Desk reads the center data; Core server decides the priority; Nyra server explains what to do. OpenAI only refines the wording when available.", "Smart Desk liest die Center-Daten; der Core-Server entscheidet die Priorität; der Nyra-Server erklärt, was zu tun ist. OpenAI verfeinert nur die Formulierung, wenn verfügbar.")
        : copy("Smart Desk sta mostrando una lettura prudente dai dati locali. Controlla dati mancanti e riprova la lettura esterna.", "Smart Desk is showing a careful reading from local data. Check missing data and retry the external reading.", "Smart Desk zeigt eine vorsichtige Lesung aus lokalen Daten. Fehlende Daten prüfen und die externe Lesung erneut starten."),
      className: primary ? "" : "fallback"
    };
  }

  function sanitizeGoldUiText(root = document.getElementById("root")) {
    if (!root) return;
    if (!uiLanguageReady) return;
    if (isPublicAuthRoute() && !isEnglish() && !isGerman()) return;
    const counted = (singular, plural) => (_match, count) => `${count} ${Number(count) === 1 ? singular : plural}`;
    const replacements = new Map([
      ["Universal Core Decision Engine", copy("AI Gold - Core/Nyra server", "AI Gold - Core/Nyra server", "AI Gold - Core/Nyra-Server")],
      ["Universal Core Read-only", copy("Core server sola lettura", "Core server read-only", "Core-Server nur lesend")],
      ["Core server read-only", copy("Core server sola lettura", "Core server read-only", "Core-Server nur lesend")],
      ["Customer Intelligence Core", copy("Lettura clienti Core", "Core client reading", "Core-Kundenlesung")],
      ["Core + Nyra + OpenAI", copy("AI Gold - Core/Nyra server", "AI Gold - Core/Nyra server", "AI Gold - Core/Nyra-Server")],
      ["Core/Nyra Render", copy("Core/Nyra server", "Core/Nyra server", "Core/Nyra-Server")],
      ["Core Render", copy("Core server", "Core server", "Core-Server")],
      ["Nyra Render", copy("Nyra server", "Nyra server", "Nyra-Server")],
      ["Nessuna priorità urgente", copy("Cosa manca / cosa controllare", "What is missing / what to check", "Was fehlt / was zu prüfen ist")],
      ["Nessuna priorita urgente", copy("Cosa manca / cosa controllare", "What is missing / what to check", "Was fehlt / was zu prüfen ist")],
      ["Nessuna priorità principale disponibile.", copy("Prossima azione: completa i dati mancanti e rileggi il centro.", "Next action: complete missing data and read the center again.", "Nächste Aktion: fehlende Daten ergänzen und das Center erneut lesen.")],
      ["Nessuna azione secondaria prioritaria.", copy("Controlla dati, cassa, agenda e costi prima di cercare altre azioni.", "Check data, cash desk, agenda and costs before looking for more actions.", "Daten, Kasse, Agenda und Kosten prüfen, bevor weitere Aktionen gesucht werden.")],
      ["Non ci sono priorità urgenti da mostrare.", copy("Non ci sono urgenze forti: controlla cosa manca e la prossima azione manuale.", "There are no strong urgent items: check what is missing and the next manual action.", "Es gibt keine starke Dringlichkeit: prüfe, was fehlt, und die nächste manuelle Aktion.")],
      ["Gold continua a leggere il centro e riapparirà solo quando serve un'azione.", copy("Gold resta attivo: se mancano dati, mostra cosa completare; se i dati sono coerenti, indica la prossima verifica utile.", "Gold stays active: if data is missing, it shows what to complete; if data is coherent, it points to the next useful check.", "Gold bleibt aktiv: wenn Daten fehlen, zeigt es, was zu ergänzen ist; wenn die Daten stimmig sind, zeigt es die nächste sinnvolle Prüfung.")],
      ["Centro sotto controllo", copy("Centro letto da Smart Desk", "Center read by Smart Desk", "Center von Smart Desk gelesen")],
      ["AI priority alerts", copy("AI Gold - cosa fare ora", "AI Gold - what to do now", "AI Gold - was jetzt zu tun ist")]
    ]);
    const regexReplacements = isGerman()
      ? [
        [/\bDa richiamare\b|\bTo recall\b/g, "Zurückrufen"],
        [/\bA rischio\b|\bAt risk\b/g, "Gefährdet"],
        [/\bPerso\b|\bLost\b/g, "Verloren"],
        [/\bStorico\b|\bHistoric\b/g, "Historisch"],
        [/\bIn linea\b|\bOn track\b/g, "Im Plan"],
        [/\bApri Smart\b|\bOpen Smart\b/g, "Smart öffnen"],
        [/\bLingua\b|\bLanguage\b/g, "Sprache"],
        [/\bEcosistema Center\b/g, "Center-Ökosystem"],
        [/\bEcosistema\b/g, "Ökosystem"],
        [/\bProtocolli\b|\bProtocols\b/g, "Protokolle"],
        [/\bTrattamenti\b|\bTreatments\b/g, "Behandlungen"],
        [/\bmoduli attivi e gestione del centro\b/g, "aktive Module und Center-Verwaltung"],
        [/\bCentro letto da Smart Desk\b|\bCenter read by Smart Desk\b/g, "Center von Smart Desk gelesen"],
        [/\blettura operativa del centro, non solo numeri sparsi\./g, "operative Center-Lesung, nicht nur verstreute Zahlen."],
        [/\bGiorno\b|\bDay\b/g, "Tag"],
        [/\bSettimana\b|\bWeek\b/g, "Woche"],
        [/\bMese\b|\bMonth\b/g, "Monat"],
        [/\bMostra periodo\b|\bShow period\b/g, "Zeitraum anzeigen"],
        [/\bAggiorna ora\b|\bRefresh now\b/g, "Jetzt aktualisieren"],
        [/\bUltimo aggiornamento\b|\bLast update\b/g, "Letzte Aktualisierung"],
        [/\bPRIORITÀ #1 · ATTENZIONE\b|\bPRIORITA #1 · ATTENZIONE\b|\bPRIORITY #1 · ATTENTION\b/g, "PRIORITÄT #1 · ACHTUNG"],
        [/\bPriorità #1 · Attenzione\b|\bPriorita #1 · Attenzione\b|\bPriority #1 · Attention\b/g, "Priorität #1 · Achtung"],
        [/\bMancano informazioni per completare l'analisi\./g, "Es fehlen Informationen, um die Analyse abzuschließen."],
        [/\bCompleta questi campi:/g, "Diese Felder ergänzen:"],
        [/\bclienti senza contatto\b/g, "Kunden ohne Kontakt"],
        [/\bservizi senza costi\b/g, "Leistungen ohne Kosten"],
        [/\bappuntamenti senza pagamento\b/g, "Termine ohne Zahlung"],
        [/\bAltre priorità\b|\bAltre priorita\b|\bOther priorities\b/g, "Weitere Prioritäten"],
        [/\bSegnali secondari dopo la prima azione\./g, "Sekundäre Signale nach der ersten Aktion."],
        [/\bLettura operativa dal motore Gold\./g, "Operative Lesung aus der Gold Engine."],
        [/\bApri piano Gold\b|\bOpen Gold plan\b/g, "Gold-Plan öffnen"],
        [/\bAttività bassa oggi\b|\bAttivita bassa oggi\b|\bLow activity today\b/g, "Heute geringe Aktivität"],
        [/\b(\d+)\s+appuntamenti nel periodo selezionato\b|\b(\d+)\s+appointments in the selected period\b/g, (_match, itCount, enCount) => counted("Termin im ausgewählten Zeitraum", "Termine im ausgewählten Zeitraum")(_match, itCount || enCount)],
        [/\bAI ha preparato il piano di oggi\b|\bAI prepared today's plan\b/g, "AI hat den Tagesplan vorbereitet"],
        [/\b(\d+)\s+segnali da leggere\b|\b(\d+)\s+signals to review\b/g, (_match, itCount, enCount) => counted("Signal zu lesen", "Signale zu lesen")(_match, itCount || enCount)],
        [/\bDatenqualit[äaà]+/g, "Datenqualität"],
        [/\bapri servizi e operatori, poi completa (\d+) costi servizio e (\d+) costi orari operatori\b/g, (_match, serviceCosts, hourlyCosts) => `Leistungen und Mitarbeitende öffnen, dann ${serviceCosts} Leistungskosten und ${hourlyCosts} Stundenkosten ergänzen`],
        [/\bCentro sotto controllo\b|\bCenter under control\b/g, "Center unter Kontrolle"],
        [/\bDashboard\b/g, "Dashboard"],
        [/\bAgenda\b|\bSchedule\b/g, "Agenda"],
        [/\bClienti\b|\bClients\b/g, "Kunden"],
        [/\bServizi\b|\bServices\b/g, "Leistungen"],
        [/\bCassa\b|\bCash desk\b|\bCheckout\b/g, "Kasse"],
        [/\bMagazzino\b|\bStock\b|\bInventory\b/g, "Lager"],
        [/\bRedditivita\b|\bRedditività\b|\bProfitability\b/g, "Rentabilität"],
        [/\bReport\b|\bReports\b/g, "Berichte"],
        [/\bImpostazioni\b|\bSettings\b/g, "Einstellungen"],
        [/\bAI Gold - cosa fare ora\b|\bAI Gold - what to do now\b/g, "AI Gold - was jetzt zu tun ist"],
        [/\bCore\/Nyra server in alto\b|\bCore\/Nyra server on top\b/g, "Core/Nyra-Server als Hauptquelle"],
        [/\bFonte primaria\b|\bPrimary source\b/g, "Primärquelle"],
        [/\bFonte\b|\bSource\b/g, "Quelle"],
        [/\bProssima azione\b|\bNext action\b/g, "Nächste Aktion"],
        [/\bCosa controllare\b|\bWhat to check\b/g, "Was prüfen"],
        [/\bIn attesa\b|\bWaiting\b/g, "Wartend"],
        [/\bArrivati\b|\bArrived\b/g, "Angekommen"],
        [/\bIn corso\b|\bIn progress\b/g, "In Bearbeitung"],
        [/\bCompletati\b|\bCompleted\b/g, "Abgeschlossen"],
        [/\bOperatori attivi\b|\bActive staff\b/g, "Aktive Mitarbeitende"],
        [/\bServizi attivi\b|\bActive services\b/g, "Aktive Leistungen"],
        [/\bClienti attivi\b|\bActive clients\b/g, "Aktive Kunden"],
        [/\bDati da completare\b|\bData to complete\b/g, "Zu ergänzende Daten"],
        [/\bDa confermare\b|\bTo confirm\b/g, "Zu bestätigen"],
        [/\bPronto checkout\b|\bReady checkout\b/g, "Bereit für Kasse"],
        [/\bIncasso\b|\bRevenue\b/g, "Umsatz"],
        [/\bIn agenda nel periodo\b|\bUpcoming in period\b/g, "Im Zeitraum in der Agenda"],
        [/\bdati da aggiornare quando serve\b|\bdata to refresh when needed\b/g, "Daten bei Bedarf aktualisieren"],
        [/\bSnapshot dashboard\b|\bDashboard snapshot\b/g, "Dashboard-Snapshot"],
        [/\bAttivo\b|\bActive\b/g, "Aktiv"],
        [/\bIn ritardo\b|\bDelayed\b/g, "Verspätet"],
        [/\bInattivo\b|\bInactive\b/g, "Inaktiv"],
        [/\bDati insufficienti\b|\bInsufficient data\b/g, "Unzureichende Daten"],
        [/\bCerca cliente\.\.\.\b|\bSearch client\.\.\.\b/g, "Kunde suchen..."],
        [/\bTutti gli stati\b|\bAll statuses\b/g, "Alle Status"],
        [/\bModifica cliente\b|\bEdit client\b/g, "Kunde bearbeiten"],
        [/\bNuovo cliente\b|\bNew client\b/g, "Neuer Kunde"],
        [/\bAnnulla\b|\bCancel\b/g, "Abbrechen"],
        [/\bNome\b(?!\s+(centro|referente))|\bFirst name\b/g, "Vorname"],
        [/\bCognome\b|\bLast name\b/g, "Nachname"],
        [/\bTelefono\b|\bPhone\b/g, "Telefon"],
        [/\bNote rapide\b|\bQuick notes\b/g, "Schnellnotizen"],
        [/\bPreferenze cliente\b|\bClient preferences\b/g, "Kundenpräferenzen"],
        [/\bPrivacy e consensi\b|\bPrivacy and consents\b/g, "Datenschutz und Einwilligungen"],
        [/\bSalva cliente\b|\bSave client\b/g, "Kunde speichern"],
        [/\bAggiorna cliente\b|\bUpdate client\b/g, "Kunde aktualisieren"],
        [/\bApri scheda\b|\bOpen card\b/g, "Karte öffnen"],
        [/\bModifica\b|\bEdit\b/g, "Bearbeiten"],
        [/\bSalva impostazioni\b|\bSave settings\b/g, "Einstellungen speichern"],
        [/\bRipristina default\b|\bReset default\b/g, "Standard wiederherstellen"],
        [/\bLingua del gestionale\b|\bManagement language\b/g, "Sprache der Verwaltungssoftware"],
        [/\bLingua predefinita del centro\b|\bDefault center language\b/g, "Standardsprache des Centers"],
        [/\bProfilo centro e moduli\b|\bCenter profile and modules\b/g, "Center-Profil und Module"],
        [/\bAccedi al tuo gestionale\b|\bAccess your management system\b/g, "Zugriff auf deine Verwaltungssoftware"],
        [/\bUsername\b/g, "Benutzername"],
        [/\bPassword\b/g, "Passwort"],
        [/\bInserisci il tuo username\b|\bEnter your username\b/g, "Benutzernamen eingeben"],
        [/\bInserisci la tua password\b|\bEnter your password\b/g, "Passwort eingeben"],
        [/\bEntra nel gestionale\b|\bEnter the management system\b/g, "Verwaltungssoftware öffnen"],
        [/\bAccesso in corso\.\.\.\b|\bSigning in\.\.\.\b/g, "Anmeldung läuft..."],
        [/\bAttiva la prova gratuita\b|\bStart free trial\b/g, "Kostenlose Testphase starten"],
        [/\bPassword dimenticata\?\b|\bForgot password\?\b/g, "Passwort vergessen?"],
        [/\bScopri Smart Desk\b|\bDiscover Smart Desk\b/g, "Smart Desk entdecken"],
        [/\bAttiva la tua prova gratuita\b|\bActivate your free trial\b/g, "Aktiviere deine kostenlose Testphase"],
        [/\bCrea ora il tuo accesso Smart Desk\./g, "Erstelle jetzt deinen Smart-Desk-Zugang."],
        [/\bDati centro\b|\bCenter data\b/g, "Center-Daten"],
        [/\bNome centro\b|\bCenter name\b/g, "Center-Name"],
        [/\bNome referente\b|\bContact person name\b/g, "Name der Ansprechperson"],
        [/\bConferma email\b|\bConfirm email\b/g, "E-Mail bestätigen"],
        [/\bCrea il tuo accesso\b|\bCreate your access\b/g, "Zugang erstellen"],
        [/\bUsername desiderato\b|\bDesired username\b/g, "Gewünschter Benutzername"],
        [/\bPassword min\. 8 caratteri\b|\bPassword min\. 8 characters\b/g, "Passwort min. 8 Zeichen"],
        [/\bAttivazione in corso\.\.\.\b|\bActivation in progress\.\.\.\b/g, "Aktivierung läuft..."],
        [/\bHai già un accesso\? Vai al login\b|\bAlready have access\? Go to login\b/g, "Du hast bereits Zugang? Zum Login"],
        [/\bVai al login\b|\bGo to login\b/g, "Zum Login"],
        [/\bTorna alla login\b|\bBack to login\b/g, "Zurück zum Login"],
        [/\bTorna al login\b|\bBack to login\b/g, "Zurück zum Login"],
        [/\bTorna alla prova gratuita\b|\bBack to free trial\b/g, "Zurück zur kostenlosen Testphase"],
        [/\bVerifica email\b|\bEmail verification\b/g, "E-Mail-Verifizierung"],
        [/\bVerifica assistita\b|\bAssisted verification\b/g, "Begleitete Verifizierung"],
        [/\bAttivazione dopo la prova\b|\bActivation after trial\b/g, "Aktivierung nach der Testphase"],
        [/\bPagamento con carta Nexi\b|\bPayment by Nexi card\b/g, "Zahlung per Nexi-Karte"],
        [/\bApri pagamento Nexi\b|\bOpen Nexi payment\b/g, "Nexi-Zahlung öffnen"],
        [/\bRichiesta registrata\b|\bRequest registered\b/g, "Anfrage gespeichert"],
        [/\bImposta una nuova password\b|\bSet a new password\b/g, "Neues Passwort festlegen"],
        [/\bNuova password\b|\bNew password\b/g, "Neues Passwort"],
        [/\bConferma nuova password\b|\bConfirm new password\b/g, "Neues Passwort bestätigen"],
        [/\bAggiorna password\b|\bUpdate password\b/g, "Passwort aktualisieren"],
        [/\bAggiornamento in corso\.\.\.\b|\bUpdating\.\.\.\b/g, "Aktualisierung läuft..."],
        [/\bInserisci email o username\b|\bEnter email or username\b/g, "E-Mail oder Benutzername eingeben"],
        [/\bInvia link di reset\b|\bSend reset link\b/g, "Reset-Link senden"],
        [/\bInvio in corso\.\.\.\b|\bSending\.\.\.\b/g, "Senden läuft..."],
        [/\bDisponibile dal piano\b|\bAvailable from plan\b/g, "Verfügbar ab Plan"],
        [/\bDurante la prova gratuita resta attivo in versione completa\./g, "Während der kostenlosen Testphase bleibt es vollständig aktiv."],
        [/\bSome information is still missing to complete the analysis\./g, "Einige Informationen fehlen noch, um die Analyse abzuschließen."],
        [/\bClients to recall \/ at risk\b/g, "Kunden zum Zurückrufen / gefährdet"],
        [/\bNo upcoming appointments appear in the selected period\./g, "Im ausgewählten Zeitraum erscheinen keine anstehenden Termine."],
        [/\bThere are no open confirmations to close in the selected period\./g, "Im ausgewählten Zeitraum gibt es keine offenen Bestätigungen."],
        [/\bBase revenue by payment method\b/g, "Basisumsatz nach Zahlungsart"],
        [/\bregistered payments appear in the selected period\./g, "registrierte Zahlungen erscheinen im ausgewählten Zeitraum."],
        [/\bAI prepared today's plan\b/g, "AI hat den Tagesplan vorbereitet"],
        [/\b(\d+)\s+signals to review\b/g, counted("Signal zu prüfen", "Signale zu prüfen")],
        [/\bApri agenda\b|\bOpen schedule\b/g, "Agenda öffnen"],
        [/\bApri clienti\b|\bOpen clients\b/g, "Kunden öffnen"],
        [/\bApri cassa\b|\bOpen checkout\b/g, "Kasse öffnen"],
        [/\bApri report\b|\bOpen reports\b/g, "Berichte öffnen"],
        [/\bApri redditività\b|\bOpen profitability\b/g, "Rentabilität öffnen"],
        [/\bApri impostazioni\b|\bOpen settings\b/g, "Einstellungen öffnen"],
        [/\bOpen details\b|\bApri dettaglio\b/g, "Details öffnen"],
        [/\bInformation is missing to complete the analysis\./g, "Es fehlen Informationen, um die Analyse abzuschließen."],
        [/\bOpen the module linked to the AI priority\b|\bApri modulo collegato alla priorita AI\b|\bApri modulo collegato alla priorità AI\b/g, "Mit der AI-Priorität verknüpftes Modul öffnen"],
        [/\bOpen AI Gold\b|\bApri AI Gold\b/g, "AI Gold öffnen"],
        [/\bOpen the action suggested by AI Gold\b|\bApri azione suggerita da AI Gold\b/g, "Von AI Gold vorgeschlagene Aktion öffnen"],
        [/\bOpen linked operational detail\b|\bApri dettaglio operativo collegato\b/g, "Verknüpftes operatives Detail öffnen"],
        [/\bOpen secondary priority\b|\bApri priorita secondaria\b|\bApri priorità secondaria\b/g, "Sekundäre Priorität öffnen"],
        [/\bOpen settings for blocked actions\b|\bApri impostazioni per azioni bloccate\b/g, "Einstellungen für blockierte Aktionen öffnen"],
        [/\bOpen AI Gold for domino effect\b|\bApri AI Gold per effetto domino\b/g, "AI Gold für Dominoeffekt öffnen"],
        [/\bOpen clients linked to Core client reading\b|\bApri clienti collegati alla lettura clienti Core\b/g, "Mit der Core-Kundenlesung verknüpfte Kunden öffnen"],
        [/\bBlocked actions\b|\bAzioni bloccate\b/g, "Blockierte Aktionen"],
        [/\bchecks\b|\bcontrolli\b/g, "Prüfungen"],
        [/\bclients\b|\bclienti\b/g, "Kunden"],
        [/\bconsents\b|\bconsensi\b/g, "Einwilligungen"],
        [/\bautomatic sending\b|\binvio automatico\b/g, "automatischer Versand"],
        [/\benabled\b|\babilitato\b/g, "aktiviert"],
        [/\bblocked\b|\bbloccato\b/g, "blockiert"],
        [/\bcenter\b|\bcentro\b/g, "Center"],
        [/\bDominio\b|\bDomain\b/g, "Bereich"],
        [/\brischio\b|\brisk\b/g, "Risiko"],
        [/\bpunteggio\b|\bscore\b/g, "Score"],
        [/\bQualità dati\b|\bData quality\b/g, "Datenqualität"],
        [/\bCliente occasionale\b|\bOccasional client\b/g, "Gelegenheitskunde"],
        [/\bEffetto domino attivo\b|\bDomino effect active\b/g, "Dominoeffekt aktiv"],
        [/\bconferma owner richiesta\b|\bowner confirmation required\b/g, "Owner-Bestätigung erforderlich"],
        [/\bDemo and test cleanup\b|\bPulizia demo e test\b/g, "Demo- und Testbereinigung"],
        [/\bQuick super admin tools to remove demo\/test tenants and clean operational noise\./g, "Schnelle Superadmin-Werkzeuge, um Demo-/Test-Tenants zu entfernen und operatives Rauschen zu bereinigen."],
        [/\bStrumenti rapidi super admin per togliere tenant demo\/test e ripulire il rumore operativo\./g, "Schnelle Superadmin-Werkzeuge, um Demo-/Test-Tenants zu entfernen und operatives Rauschen zu bereinigen."],
        [/\bDelete demo\/test tenants\b|\bElimina demo\/test tenant\b/g, "Demo-/Test-Tenants löschen"],
        [/\bClean STRESS_ tests\b|\bPulisci test STRESS_\b/g, "STRESS_-Tests bereinigen"],
        [/\bReady\.\b|\bPronto\./g, "Bereit."],
        [/\bRunning\.\.\.\b|\bEsecuzione\.\.\./g, "Ausführung läuft..."],
        [/\bCenters removed\b|\bCentri rimossi\b/g, "Entfernte Center"],
        [/\bnone\b|\bnessuno\b/g, "keine"],
        [/\bSTRESS_ cleanup completed\.\b|\bCleanup STRESS_ completato\./g, "STRESS_-Bereinigung abgeschlossen."],
        [/\bActive Enterprise configuration\b|\bConfigurazione Enterprise attiva\b/g, "Aktive Enterprise-Konfiguration"],
        [/\bThe shell must explain what is active, what requires confirmation and which next move makes sense now\./g, "Die Oberfläche muss erklären, was aktiv ist, was Bestätigung verlangt und welcher nächste Schritt jetzt sinnvoll ist."],
        [/\bLa shell deve spiegare cosa e attivo, cosa richiede conferma e quale prossima mossa ha senso ora\./g, "Die Oberfläche muss erklären, was aktiv ist, was Bestätigung verlangt und welcher nächste Schritt jetzt sinnvoll ist."],
        [/\bactive modules\b|\bmoduli attivi\b/g, "aktive Module"],
        [/\bOpen session settings\b|\bApri impostazioni sessione\b/g, "Sitzungseinstellungen öffnen"],
        [/\bSession\b|\bSessione\b/g, "Sitzung"],
        [/\bSensitive actions remain confirmable\b|\bLe azioni sensibili restano confermabili\b/g, "Sensible Aktionen bleiben bestätigungspflichtig"],
        [/\bOpen module settings\b|\bApri impostazioni moduli\b/g, "Moduleinstellungen öffnen"],
        [/\bAccess rules\b|\bRegole accesso\b/g, "Zugriffsregeln"],
        [/\bprofitability readable\b|\bredditivita leggibile\b|\bredditività leggibile\b/g, "Rentabilität lesbar"],
        [/\bprofitability blocked\b|\bredditivita bloccata\b|\bredditività bloccata\b/g, "Rentabilität blockiert"],
        [/\bWhen a module is not active, the UI must open premium guidance instead of leaving an empty state or a dry error\./g, "Wenn ein Modul nicht aktiv ist, muss die UI eine Premium-Führung öffnen, statt einen leeren Zustand oder einen trockenen Fehler zu zeigen."],
        [/\bQuando un modulo non e attivo, la UI deve aprire una guida premium invece di lasciare uno stato vuoto o un errore secco\./g, "Wenn ein Modul nicht aktiv ist, muss die UI eine Premium-Führung öffnen, statt einen leeren Zustand oder einen trockenen Fehler zu zeigen."],
        [/\bOpen next settings action\b|\bApri prossima azione impostazioni\b/g, "Nächste Einstellungsaktion öffnen"],
        [/\bNext move\b|\bProssima mossa\b/g, "Nächster Schritt"],
        [/\bCheck modules, session and copy coherence\b|\bControlla moduli, sessione e coerenza testi\b/g, "Module, Sitzung und Textkohärenz prüfen"],
        [/\bIf the center cannot act, the view must indicate the next step: plan, settings or correct role\./g, "Wenn das Center nicht handeln kann, muss die Ansicht den nächsten Schritt zeigen: Plan, Einstellungen oder richtige Rolle."],
        [/\bSe il centro non puo agire, la vista deve indicare il prossimo passo: piano, impostazioni o ruolo corretto\./g, "Wenn das Center nicht handeln kann, muss die Ansicht den nächsten Schritt zeigen: Plan, Einstellungen oder richtige Rolle."],
        [/\bClearer report reading\b|\bLettura report piu chiara\b|\bLettura report più chiara\b/g, "Klarere Berichtlesung"],
        [/\bThe selected state must remain visible even with zero data: day, week and month cannot look the same\./g, "Der ausgewählte Zustand muss auch bei Null-Daten sichtbar bleiben: Tag, Woche und Monat dürfen nicht gleich wirken."],
        [/\bLo stato selezionato deve restare visibile anche con dati a zero: giorno, settimana e mese non possono sembrare uguali\./g, "Der ausgewählte Zustand muss auch bei Null-Daten sichtbar bleiben: Tag, Woche und Monat dürfen nicht gleich wirken."],
        [/\bview\b|\bvista\b/g, "Ansicht"],
        [/\bOpen active-period report\b|\bApri report periodo attivo\b/g, "Bericht des aktiven Zeitraums öffnen"],
        [/\bActive period\b|\bPeriodo attivo\b/g, "Aktiver Zeitraum"],
        [/\bThe active selection must be readable immediately above numbers and lists\./g, "Die aktive Auswahl muss direkt über Zahlen und Listen lesbar sein."],
        [/\bLa selezione attiva deve essere leggibile subito sopra numeri e liste\./g, "Die aktive Auswahl muss direkt über Zahlen und Listen lesbar sein."],
        [/\bOpen cash desk to verify zero data\b|\bApri cassa per verificare dati zero\b/g, "Kasse öffnen, um Null-Daten zu prüfen"],
        [/\bIf data is zero\b|\bSe i dati sono zero\b/g, "Wenn Daten null sind"],
        [/\bit must not look silent\b|\bnon deve sembrare silenzio\b/g, "es darf nicht still wirken"],
        [/\bThe UI must explain whether activity, cash desk data or simply volume is missing in the selected period\./g, "Die UI muss erklären, ob Aktivität, Kassendaten oder einfach Volumen im ausgewählten Zeitraum fehlen."],
        [/\bLa UI deve spiegare se mancano attivita, cassa o semplicemente volume nel periodo selezionato\./g, "Die UI muss erklären, ob Aktivität, Kassendaten oder einfach Volumen im ausgewählten Zeitraum fehlen."],
        [/\bOpen agenda for useful action\b|\bApri agenda per azione utile\b/g, "Agenda für sinnvolle Aktion öffnen"],
        [/\bUseful action\b|\bAzione utile\b/g, "Sinnvolle Aktion"],
        [/\bchange view or verify closures\b|\bcambia vista o verifica chiusure\b/g, "Ansicht wechseln oder Abschlüsse prüfen"],
        [/\bIf the day is empty, try week or month; if everything is empty, check agenda, cash desk and service-operator links\./g, "Wenn der Tag leer ist, Woche oder Monat prüfen; wenn alles leer ist, Agenda, Kasse und Leistungs-Mitarbeiter-Verknüpfungen kontrollieren."],
        [/\bSe il giorno e vuoto, prova settimana o mese; se e tutto vuoto, controlla agenda, cassa e collegamenti servizio-operatore\./g, "Wenn der Tag leer ist, Woche oder Monat prüfen; wenn alles leer ist, Agenda, Kasse und Leistungs-Mitarbeiter-Verknüpfungen kontrollieren."],
        [/\bServices separated more clearly\b|\bServizi separati con piu chiarezza\b|\bServizi separati con più chiarezza\b/g, "Leistungen klarer getrennt"],
        [/\bCatalog, staff and resources must be read as different surfaces of the same system\./g, "Katalog, Team und Ressourcen müssen als unterschiedliche Flächen desselben Systems gelesen werden."],
        [/\bCatalogo, staff e risorse devono essere letti come superfici diverse dello stesso sistema\./g, "Katalog, Team und Ressourcen müssen als unterschiedliche Flächen desselben Systems gelesen werden."],
        [/\bCatalog\b|\bCatalogo\b/g, "Katalog"],
        [/\bShifts\b|\bTurni\b/g, "Schichten"],
        [/\bKeep price, duration and category aligned\.\b|\bTieni allineati prezzo, durata e categoria\./g, "Preis, Dauer und Kategorie ausgerichtet halten."],
        [/\bIf staff is missing, the shell must say it usefully\./g, "Wenn Teamdaten fehlen, muss die Oberfläche es nützlich erklären."],
        [/\bSe manca lo staff, la shell deve dirlo in modo utile\./g, "Wenn Teamdaten fehlen, muss die Oberfläche es nützlich erklären."],
        [/\bResources\b|\bRisorse\b/g, "Ressourcen"],
        [/\bTechnologies and rooms must be read as operational constraints\./g, "Technologien und Räume müssen als operative Grenzen gelesen werden."],
        [/\bTecnologie e stanze vanno lette come vincoli operativi\./g, "Technologien und Räume müssen als operative Grenzen gelesen werden."],
        [/\bShifts readable by blocks\b|\bTurni leggibili a blocchi\b/g, "Schichten in Blöcken lesbar"],
        [/\bCalendar, attendance and templates must be better separated in long screens\./g, "Kalender, Anwesenheiten und Vorlagen müssen in langen Ansichten besser getrennt sein."],
        [/\bCalendario, presenze e modelli devono essere separati meglio nelle schermate lunghe\./g, "Kalender, Anwesenheiten und Vorlagen müssen in langen Ansichten besser getrennt sein."],
        [/\bCalendar\b|\bCalendario\b/g, "Kalender"],
        [/\bFirst see who works today and where there are gaps\./g, "Zuerst sehen, wer heute arbeitet und wo Lücken sind."],
        [/\bPrima vedi chi lavora oggi e dove ci sono buchi\./g, "Zuerst sehen, wer heute arbeitet und wo Lücken sind."],
        [/\bAttendance\b|\bPresenze\b/g, "Anwesenheiten"],
        [/\bThen confirmations and operational control\./g, "Dann Bestätigungen und operative Kontrolle."],
        [/\bPoi conferme e controllo operativo\./g, "Dann Bestätigungen und operative Kontrolle."],
        [/\bTemplates\b|\bModelli\b/g, "Vorlagen"],
        [/\bFinally the reusable center patterns\./g, "Zum Schluss die wiederverwendbaren Center-Muster."],
        [/\bInfine gli schemi riutilizzabili del centro\./g, "Zum Schluss die wiederverwendbaren Center-Muster."],
        [/\bProtocols with clearer levels\b|\bProtocolli con livelli piu chiari\b|\bProtocolli con livelli più chiari\b/g, "Protokolle mit klareren Ebenen"],
        [/\bLibrary, client profile and AI draft must feel like three distinct levels, not one very long page\./g, "Bibliothek, Kundenprofil und AI-Entwurf müssen wie drei getrennte Ebenen wirken, nicht wie eine sehr lange Seite."],
        [/\bLibreria, scheda cliente e bozza AI devono sembrare tre livelli distinti, non una pagina unica lunghissima\./g, "Bibliothek, Kundenprofil und AI-Entwurf müssen wie drei getrennte Ebenen wirken, nicht wie eine sehr lange Seite."],
        [/\bLibrary\b|\bLibreria\b/g, "Bibliothek"],
        [/\bFirst see what already exists and what is missing\./g, "Zuerst sehen, was schon existiert und was fehlt."],
        [/\bPrima vedi cosa esiste gia e cosa manca\./g, "Zuerst sehen, was schon existiert und was fehlt."],
        [/\bClient\b|\bCliente\b/g, "Kunde"],
        [/\bThen history, sensitivity and area\./g, "Dann Historie, Sensibilität und Zone."],
        [/\bPoi storico, sensibilita e zona\./g, "Dann Historie, Sensibilität und Zone."],
        [/\bAI draft\b|\bBozza AI\b/g, "AI-Entwurf"],
        [/\bOnly then come suggestion and operator confirmation\./g, "Erst danach kommen Vorschlag und Bestätigung durch den Operator."],
        [/\bSolo dopo arrivano suggerimento e conferma operatore\./g, "Erst danach kommen Vorschlag und Bestätigung durch den Operator."],
        [/\b(\d+)\s+clienti? senza telefono o email\b|\b(\d+)\s+clients? without phone or email\b/g, (_match, itCount, enCount) => counted("Kunde ohne Telefon oder E-Mail", "Kunden ohne Telefon oder E-Mail")(_match, itCount || enCount)],
        [/\b(\d+)\s+servizi? senza costi configurati\b|\b(\d+)\s+services? without configured costs\b/g, (_match, itCount, enCount) => counted("Leistung ohne konfigurierte Kosten", "Leistungen ohne konfigurierte Kosten")(_match, itCount || enCount)],
        [/\b(\d+)\s+servizi? con costi stimati non collegat[io] a prodotti o tecnologie\b|\b(\d+)\s+services? with estimated costs not linked to products or technologies\b/g, (_match, itCount, enCount) => counted("Leistung mit geschätzten Kosten ohne Produkt- oder Technologieverknüpfung", "Leistungen mit geschätzten Kosten ohne Produkt- oder Technologieverknüpfung")(_match, itCount || enCount)],
        [/\b(\d+)\s+appuntament[io] passat[io] senza pagamento collegato\b|\b(\d+)\s+past appointments? without a linked payment\b/g, (_match, itCount, enCount) => counted("vergangener Termin ohne verknüpfte Zahlung", "vergangene Termine ohne verknüpfte Zahlung")(_match, itCount || enCount)],
        [/\b(\d+)\s+pagament[io] da collegare\b|\b(\d+)\s+payments? to link\b/g, (_match, itCount, enCount) => counted("Zahlung zu verknüpfen", "Zahlungen zu verknüpfen")(_match, itCount || enCount)],
        [/\b(\d+)\s+grupp[oi] di possibili duplicati cliente\b|\b(\d+)\s+possible duplicate client groups?\b/g, (_match, itCount, enCount) => counted("mögliche Kundenduplikat-Gruppe", "mögliche Kundenduplikat-Gruppen")(_match, itCount || enCount)],
        [/\b(\d+)\s+possibil[ei] duplicat[oi]\b|\b(\d+)\s+possible duplicates?\b/g, (_match, itCount, enCount) => counted("mögliches Duplikat", "mögliche Duplikate")(_match, itCount || enCount)]
      ]
      : isEnglish()
        ? [
        [/\bDa richiamare\b/g, "To recall"],
        [/\bA rischio\b/g, "At risk"],
        [/\bPerso\b/g, "Lost"],
        [/\bStorico\b/g, "Historic"],
        [/\bIn linea\b/g, "On track"],
        [/\bApri Smart\b/g, "Open Smart"],
        [/\bEcosistema Center\b/g, "Ecosystem Center"],
        [/\bEcosistema\b/g, "Ecosystem"],
        [/\bProtocolli\b/g, "Protocols"],
        [/\bTrattamenti\b/g, "Treatments"],
        [/\bmoduli attivi e gestione del centro\b/g, "active modules and center management"],
        [/\bCentro letto da Smart Desk\b/g, "Center read by Smart Desk"],
        [/\blettura operativa del centro, non solo numeri sparsi\./g, "operational center reading, not just scattered numbers."],
        [/\bGiorno\b/g, "Day"],
        [/\bSettimana\b/g, "Week"],
        [/\bMese\b/g, "Month"],
        [/\bMostra periodo\b/g, "Show period"],
        [/\bAggiorna ora\b/g, "Refresh now"],
        [/\bUltimo aggiornamento\b/g, "Last update"],
        [/\bPRIORITÀ #1 · ATTENZIONE\b|\bPRIORITA #1 · ATTENZIONE\b/g, "PRIORITY #1 · ATTENTION"],
        [/\bPriorità #1 · Attenzione\b|\bPriorita #1 · Attenzione\b/g, "Priority #1 · Attention"],
        [/\bMancano informazioni per completare l'analisi\./g, "Information is missing to complete the analysis."],
        [/\bCompleta questi campi:/g, "Complete these fields:"],
        [/\bclienti senza contatto\b/g, "clients without contact"],
        [/\bservizi senza costi\b/g, "services without costs"],
        [/\bappuntamenti senza pagamento\b/g, "appointments without payment"],
        [/\bAltre priorità\b|\bAltre priorita\b/g, "Other priorities"],
        [/\bSegnali secondari dopo la prima azione\./g, "Secondary signals after the first action."],
        [/\bLettura operativa dal motore Gold\./g, "Operational reading from the Gold engine."],
        [/\bApri piano Gold\b/g, "Open Gold plan"],
        [/\bAttività bassa oggi\b|\bAttivita bassa oggi\b/g, "Low activity today"],
        [/\b(\d+)\s+appuntamenti nel periodo selezionato\b/g, counted("appointment in the selected period", "appointments in the selected period")],
        [/\bAI ha preparato il piano di oggi\b/g, "AI prepared today's plan"],
        [/\b(\d+)\s+segnali da leggere\b/g, counted("signal to review", "signals to review")],
        [/\bDa confermare\b/g, "To confirm"],
        [/\bPronto checkout\b/g, "Ready checkout"],
        [/\bIncasso\b/g, "Revenue"],
        [/\bIn agenda nel periodo\b/g, "Upcoming in period"],
        [/\bdati da aggiornare quando serve\b/g, "data to refresh when needed"],
        [/\bSnapshot dashboard\b/g, "Dashboard snapshot"],
        [/\bAttivo\b/g, "Active"],
        [/\bIn ritardo\b/g, "Delayed"],
        [/\bInattivo\b/g, "Inactive"],
        [/\bDati insufficienti\b/g, "Insufficient data"],
        [/\bCerca cliente\.\.\.\b/g, "Search client..."],
        [/\bTutti gli stati\b/g, "All statuses"],
        [/\bModifica cliente\b/g, "Edit client"],
        [/\bNuovo cliente\b/g, "New client"],
        [/\bAnnulla\b/g, "Cancel"],
        [/\bNome\b(?!\s+(centro|referente))/g, "First name"],
        [/\bCognome\b/g, "Last name"],
        [/\bTelefono\b/g, "Phone"],
        [/\bNote rapide\b/g, "Quick notes"],
        [/\bPreferenze cliente\b/g, "Client preferences"],
        [/\bPrivacy e consensi\b/g, "Privacy and consents"],
        [/\bSalva cliente\b/g, "Save client"],
        [/\bAggiorna cliente\b/g, "Update client"],
        [/\bApri scheda\b/g, "Open card"],
        [/\bModifica\b/g, "Edit"],
        [/\bSalva impostazioni\b/g, "Save settings"],
        [/\bRipristina default\b/g, "Reset default"],
        [/\bLingua del gestionale\b/g, "Management language"],
        [/\bLingua predefinita del centro\b/g, "Default center language"],
        [/\bProfilo centro e moduli\b/g, "Center profile and modules"],
        [/\bAccedi al tuo gestionale\b/g, "Access your management system"],
        [/\bInserisci il tuo username\b/g, "Enter your username"],
        [/\bInserisci la tua password\b/g, "Enter your password"],
        [/\bEntra nel gestionale\b/g, "Enter the management system"],
        [/\bAccesso in corso\.\.\.\b/g, "Signing in..."],
        [/\bAttiva la prova gratuita\b/g, "Start free trial"],
        [/\bPassword dimenticata\?\b/g, "Forgot password?"],
        [/\bScopri Smart Desk\b/g, "Discover Smart Desk"],
        [/\bAttiva la tua prova gratuita\b/g, "Activate your free trial"],
        [/\bCrea ora il tuo accesso Smart Desk\./g, "Create your Smart Desk access now."],
        [/\bDati centro\b/g, "Center data"],
        [/\bNome centro\b/g, "Center name"],
        [/\bNome referente\b/g, "Contact person name"],
        [/\bConferma email\b/g, "Confirm email"],
        [/\bCrea il tuo accesso\b/g, "Create your access"],
        [/\bUsername desiderato\b/g, "Desired username"],
        [/\bPassword min\. 8 caratteri\b/g, "Password min. 8 characters"],
        [/\bAttivazione in corso\.\.\.\b/g, "Activation in progress..."],
        [/\bHai già un accesso\? Vai al login\b/g, "Already have access? Go to login"],
        [/\bVai al login\b/g, "Go to login"],
        [/\bTorna alla login\b|\bTorna al login\b/g, "Back to login"],
        [/\bTorna alla prova gratuita\b/g, "Back to free trial"],
        [/\bVerifica email\b/g, "Email verification"],
        [/\bVerifica assistita\b/g, "Assisted verification"],
        [/\bAttivazione dopo la prova\b/g, "Activation after trial"],
        [/\bPagamento con carta Nexi\b/g, "Payment by Nexi card"],
        [/\bApri pagamento Nexi\b/g, "Open Nexi payment"],
        [/\bRichiesta registrata\b/g, "Request registered"],
        [/\bImposta una nuova password\b/g, "Set a new password"],
        [/\bNuova password\b/g, "New password"],
        [/\bConferma nuova password\b/g, "Confirm new password"],
        [/\bAggiorna password\b/g, "Update password"],
        [/\bAggiornamento in corso\.\.\.\b/g, "Updating..."],
        [/\bInserisci email o username\b/g, "Enter email or username"],
        [/\bInvia link di reset\b/g, "Send reset link"],
        [/\bInvio in corso\.\.\.\b/g, "Sending..."],
        [/\bDisponibile dal piano\b/g, "Available from plan"],
        [/\bDurante la prova gratuita resta attivo in versione completa\./g, "During the free trial it remains active in the full version."],
        [/\b(\d+)\s+clienti? senza telefono o email\b/g, counted("client without phone or email", "clients without phone or email")],
        [/\b(\d+)\s+servizi? senza costi configurati\b/g, counted("service without configured costs", "services without configured costs")],
        [/\b(\d+)\s+servizi? con costi stimati non collegat[io] a prodotti o tecnologie\b/g, counted("service with estimated costs not linked to products or technologies", "services with estimated costs not linked to products or technologies")],
        [/\b(\d+)\s+appuntament[io] passat[io] senza pagamento collegato\b/g, counted("past appointment without a linked payment", "past appointments without a linked payment")],
        [/\b(\d+)\s+pagament[io] da collegare\b/g, counted("payment to link", "payments to link")],
        [/\b(\d+)\s+grupp[oi] di possibili duplicati cliente\b/g, counted("possible duplicate client group", "possible duplicate client groups")],
        [/\b(\d+)\s+possibil[ei] duplicat[oi]\b/g, counted("possible duplicate", "possible duplicates")]
      ]
        : [
        [/\bTo recall\b/g, "Da richiamare"],
        [/\bAt risk\b/g, "A rischio"],
        [/\bLost\b/g, "Perso"],
        [/\bHistoric\b/g, "Storico"],
        [/\bOn track\b/g, "In linea"],
        [/\bOpen Smart\b/g, "Apri Smart"],
        [/\bCenter-Ökosystem\b|\bEcosystem Center\b/g, "Ecosistema Center"],
        [/\bÖkosystem\b|\bEcosystem\b/g, "Ecosistema"],
        [/\bProtokolle\b|\bProtocols\b/g, "Protocolli"],
        [/\bBehandlungen\b|\bTreatments\b/g, "Trattamenti"],
        [/\baktive Module und Center-Verwaltung\b|\bactive modules and center management\b/g, "moduli attivi e gestione del centro"],
        [/\bCenter von Smart Desk gelesen\b|\bCenter read by Smart Desk\b/g, "Centro letto da Smart Desk"],
        [/\boperative Center-Lesung, nicht nur verstreute Zahlen\.\b|\boperational center reading, not just scattered numbers\./g, "lettura operativa del centro, non solo numeri sparsi."],
        [/\bTag\b|\bDay\b/g, "Giorno"],
        [/\bWoche\b|\bWeek\b/g, "Settimana"],
        [/\bMonat\b|\bMonth\b/g, "Mese"],
        [/\bZeitraum anzeigen\b|\bShow period\b/g, "Mostra periodo"],
        [/\bJetzt aktualisieren\b|\bRefresh now\b/g, "Aggiorna ora"],
        [/\bLetzte Aktualisierung\b|\bLast update\b/g, "Ultimo aggiornamento"],
        [/\bPRIORITÄT #1 · ACHTUNG\b|\bPRIORITY #1 · ATTENTION\b/g, "PRIORITÀ #1 · ATTENZIONE"],
        [/\bPriorität #1 · Achtung\b|\bPriority #1 · Attention\b/g, "Priorità #1 · Attenzione"],
        [/\bEs fehlen Informationen, um die Analyse abzuschließen\.\b|\bInformation is missing to complete the analysis\./g, "Mancano informazioni per completare l'analisi."],
        [/\bDiese Felder ergänzen:\b|\bComplete these fields:/g, "Completa questi campi:"],
        [/\bKunden ohne Kontakt\b|\bclients without contact\b/g, "clienti senza contatto"],
        [/\bLeistungen ohne Kosten\b|\bservices without costs\b/g, "servizi senza costi"],
        [/\bTermine ohne Zahlung\b|\bappointments without payment\b/g, "appuntamenti senza pagamento"],
        [/\bWeitere Prioritäten\b|\bOther priorities\b/g, "Altre priorità"],
        [/\bSekundäre Signale nach der ersten Aktion\.\b|\bSecondary signals after the first action\./g, "Segnali secondari dopo la prima azione."],
        [/\bOperative Lesung aus der Gold Engine\.\b|\bOperational reading from the Gold engine\./g, "Lettura operativa dal motore Gold."],
        [/\bGold-Plan öffnen\b|\bOpen Gold plan\b/g, "Apri piano Gold"],
        [/\bHeute geringe Aktivität\b|\bLow activity today\b/g, "Attività bassa oggi"],
        [/\bAI hat den Tagesplan vorbereitet\b|\bAI prepared today's plan\b/g, "AI ha preparato il piano di oggi"],
        [/\bZu bestätigen\b|\bTo confirm\b/g, "Da confermare"],
        [/\bBereit für Kasse\b|\bReady checkout\b/g, "Pronto checkout"],
        [/\bUmsatz\b|\bRevenue\b/g, "Incasso"],
        [/\bIm Zeitraum in der Agenda\b|\bUpcoming in period\b/g, "In agenda nel periodo"],
        [/\bDaten bei Bedarf aktualisieren\b|\bdata to refresh when needed\b/g, "dati da aggiornare quando serve"],
        [/\bDashboard-Snapshot\b|\bDashboard snapshot\b/g, "Snapshot dashboard"],
        [/\bAktiv\b|\bActive\b/g, "Attivo"],
        [/\bVerspätet\b|\bDelayed\b/g, "In ritardo"],
        [/\bInaktiv\b|\bInactive\b/g, "Inattivo"],
        [/\bUnzureichende Daten\b|\bInsufficient data\b/g, "Dati insufficienti"],
        [/\bKunde suchen\.\.\.\b|\bSearch client\.\.\.\b/g, "Cerca cliente..."],
        [/\bAlle Status\b|\bAll statuses\b/g, "Tutti gli stati"],
        [/\bKunde bearbeiten\b|\bEdit client\b/g, "Modifica cliente"],
        [/\bNeuer Kunde\b|\bNew client\b/g, "Nuovo cliente"],
        [/\bAbbrechen\b|\bCancel\b/g, "Annulla"],
        [/\bVorname\b|\bFirst name\b/g, "Nome"],
        [/\bNachname\b|\bLast name\b/g, "Cognome"],
        [/\bTelefon\b|\bPhone\b/g, "Telefono"],
        [/\bSchnellnotizen\b|\bQuick notes\b/g, "Note rapide"],
        [/\bKundenpräferenzen\b|\bClient preferences\b/g, "Preferenze cliente"],
        [/\bDatenschutz und Einwilligungen\b|\bPrivacy and consents\b/g, "Privacy e consensi"],
        [/\bKunde speichern\b|\bSave client\b/g, "Salva cliente"],
        [/\bKunde aktualisieren\b|\bUpdate client\b/g, "Aggiorna cliente"],
        [/\bKarte öffnen\b|\bOpen card\b/g, "Apri scheda"],
        [/\bBearbeiten\b|\bEdit\b/g, "Modifica"],
        [/\bEinstellungen speichern\b|\bSave settings\b/g, "Salva impostazioni"],
        [/\bStandard wiederherstellen\b|\bReset default\b/g, "Ripristina default"],
        [/\bSprache der Verwaltungssoftware\b|\bManagement language\b/g, "Lingua del gestionale"],
        [/\bStandardsprache des Centers\b|\bDefault center language\b/g, "Lingua predefinita del centro"],
        [/\bCenter-Profil und Module\b|\bCenter profile and modules\b/g, "Profilo centro e moduli"],
        [/\bZugriff auf deine Verwaltungssoftware\b|\bAccess your management system\b/g, "Accedi al tuo gestionale"],
        [/\bBenutzername\b/g, "Username"],
        [/\bPasswort\b/g, "Password"],
        [/\bBenutzernamen eingeben\b|\bEnter your username\b/g, "Inserisci il tuo username"],
        [/\bPasswort eingeben\b|\bEnter your password\b/g, "Inserisci la tua password"],
        [/\bVerwaltungssoftware öffnen\b|\bEnter the management system\b/g, "Entra nel gestionale"],
        [/\bAnmeldung läuft\.\.\.\b|\bSigning in\.\.\.\b/g, "Accesso in corso..."],
        [/\bKostenlose Testphase starten\b|\bStart free trial\b/g, "Attiva la prova gratuita"],
        [/\bPasswort vergessen\?\b|\bForgot password\?\b/g, "Password dimenticata?"],
        [/\bSmart Desk entdecken\b|\bDiscover Smart Desk\b/g, "Scopri Smart Desk"],
        [/\bAktiviere deine kostenlose Testphase\b|\bActivate your free trial\b/g, "Attiva la tua prova gratuita"],
        [/\bErstelle jetzt deinen Smart-Desk-Zugang\.\b|\bCreate your Smart Desk access now\./g, "Crea ora il tuo accesso Smart Desk."],
        [/\bCenter-Daten\b|\bCenter data\b/g, "Dati centro"],
        [/\bCenter-Name\b|\bCenter name\b/g, "Nome centro"],
        [/\bName der Ansprechperson\b|\bContact person name\b/g, "Nome referente"],
        [/\bE-Mail bestätigen\b|\bConfirm email\b/g, "Conferma email"],
        [/\bZugang erstellen\b|\bCreate your access\b/g, "Crea il tuo accesso"],
        [/\bGewünschter Benutzername\b|\bDesired username\b/g, "Username desiderato"],
        [/\bPasswort min\. 8 Zeichen\b|\bPassword min\. 8 characters\b/g, "Password min. 8 caratteri"],
        [/\bAktivierung läuft\.\.\.\b|\bActivation in progress\.\.\.\b/g, "Attivazione in corso..."],
        [/\bDu hast bereits Zugang\? Zum Login\b|\bAlready have access\? Go to login\b/g, "Hai già un accesso? Vai al login"],
        [/\bZum Login\b|\bGo to login\b/g, "Vai al login"],
        [/\bZurück zum Login\b|\bBack to login\b/g, "Torna al login"],
        [/\bZurück zur kostenlosen Testphase\b|\bBack to free trial\b/g, "Torna alla prova gratuita"],
        [/\bE-Mail-Verifizierung\b|\bEmail verification\b/g, "Verifica email"],
        [/\bBegleitete Verifizierung\b|\bAssisted verification\b/g, "Verifica assistita"],
        [/\bAktivierung nach der Testphase\b|\bActivation after trial\b/g, "Attivazione dopo la prova"],
        [/\bZahlung per Nexi-Karte\b|\bPayment by Nexi card\b/g, "Pagamento con carta Nexi"],
        [/\bNexi-Zahlung öffnen\b|\bOpen Nexi payment\b/g, "Apri pagamento Nexi"],
        [/\bAnfrage gespeichert\b|\bRequest registered\b/g, "Richiesta registrata"],
        [/\bNeues Passwort festlegen\b|\bSet a new password\b/g, "Imposta una nuova password"],
        [/\bNeues Passwort\b|\bNew password\b/g, "Nuova password"],
        [/\bNeues Passwort bestätigen\b|\bConfirm new password\b/g, "Conferma nuova password"],
        [/\bPasswort aktualisieren\b|\bUpdate password\b/g, "Aggiorna password"],
        [/\bAktualisierung läuft\.\.\.\b|\bUpdating\.\.\.\b/g, "Aggiornamento in corso..."],
        [/\bE-Mail oder Benutzername eingeben\b|\bEnter email or username\b/g, "Inserisci email o username"],
        [/\bReset-Link senden\b|\bSend reset link\b/g, "Invia link di reset"],
        [/\bSenden läuft\.\.\.\b|\bSending\.\.\.\b/g, "Invio in corso..."],
        [/\bVerfügbar ab Plan\b|\bAvailable from plan\b/g, "Disponibile dal piano"],
        [/\bWährend der kostenlosen Testphase bleibt es vollständig aktiv\.\b|\bDuring the free trial it remains active in the full version\./g, "Durante la prova gratuita resta attivo in versione completa."],
        [/\b(\d+)\s+clients? without phone or email\b/g, counted("cliente senza telefono o email", "clienti senza telefono o email")],
        [/\b(\d+)\s+services? without configured costs\b/g, counted("servizio senza costi configurati", "servizi senza costi configurati")],
        [/\b(\d+)\s+services? with estimated costs not linked to products or technologies\b/g, counted("servizio con costi stimati non collegato a prodotti o tecnologie", "servizi con costi stimati non collegati a prodotti o tecnologie")],
        [/\b(\d+)\s+past appointments? without a linked payment\b/g, counted("appuntamento passato senza pagamento collegato", "appuntamenti passati senza pagamento collegato")],
        [/\b(\d+)\s+payments? to link\b/g, counted("pagamento da collegare", "pagamenti da collegare")],
        [/\b(\d+)\s+possible duplicate client groups?\b/g, counted("gruppo di possibili duplicati cliente", "gruppi di possibili duplicati cliente")],
        [/\b(\d+)\s+possible duplicates?\b/g, counted("possibile duplicato", "possibili duplicati")]
      ];
    const translateText = (value) => {
      let text = value || "";
      replacements.forEach((to, from) => {
        if (text.includes(from)) text = text.split(from).join(to);
      });
      regexReplacements.forEach(([from, to]) => {
        text = text.replace(from, to);
      });
      return text;
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const text = translateText(node.nodeValue || "");
      node.nodeValue = text;
    });
    const attributeNames = ["placeholder", "title", "aria-label", "value"];
    root.querySelectorAll("[placeholder], [title], [aria-label], input[value], button[value]").forEach((element) => {
      attributeNames.forEach((attributeName) => {
        if (!element.hasAttribute(attributeName)) return;
        const current = element.getAttribute(attributeName) || "";
        if (!current || !/[A-Za-zÀ-ÿ]/.test(current)) return;
        const next = translateText(current);
        if (next !== current) element.setAttribute(attributeName, next);
      });
    });
  }

  function buildAuthHeaders(base = {}) {
    const token = window.localStorage.getItem("skinharmony-web-token");
    return token
      ? { ...base, Authorization: `Bearer ${token}` }
      : base;
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      credentials: "include",
      headers: buildAuthHeaders({ Accept: "application/json" })
    });
    if (!response.ok) {
      throw new Error(String(response.status));
    }
    return response.json();
  }

  async function refreshUiLanguage(settingsPayload = null, options = {}) {
    const now = Date.now();
    if (!settingsPayload && !options.force && uiLanguageRefreshPromise) return uiLanguageRefreshPromise;
    if (!settingsPayload && !options.force && now - uiLanguageLastRefreshAt < 4500) return Promise.resolve(uiLanguage);
    uiLanguageRefreshPromise = (async () => {
      uiLanguageLastRefreshAt = Date.now();
      try {
        const settings = settingsPayload || await fetchJson("/api/settings");
        uiLanguage = normalizeLanguage(settings?.appLanguage || getStoredPublicLanguage() || document.documentElement.getAttribute("lang") || navigator.language);
        document.documentElement.setAttribute("lang", uiLanguage);
      } catch (_error) {
        uiLanguage = normalizeLanguage(getStoredPublicLanguage() || document.documentElement.getAttribute("lang") || navigator.language || "it");
        document.documentElement.setAttribute("lang", uiLanguage);
      } finally {
        uiLanguageReady = true;
        uiLanguageRefreshPromise = null;
      }
      return uiLanguage;
    })();
    return uiLanguageRefreshPromise;
  }

  function refreshLanguageAndSanitize(options = {}) {
    try {
      void refreshUiLanguage(null, options).then(() => {
        sanitizeGoldUiText();
      });
    } catch (_error) {
      sanitizeGoldUiText();
    }
  }

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: buildAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || String(response.status));
    }
    return data;
  }

  function findAnchor() {
    const root = document.getElementById("root");
    if (!root) return null;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = (node.textContent || "").trim();
      if (text === "Centro sotto controllo" || text === "Center under control") {
        let current = node;
        for (let i = 0; i < 5 && current; i += 1) {
          if (current.tagName === "SECTION" || current.classList?.contains("card")) {
            return current;
          }
          current = current.parentElement;
        }
      }
    }

    return root.firstElementChild;
  }

  function findSettingsAnchor() {
    const root = document.getElementById("root");
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = (node.textContent || "").trim();
      if (text === "Dati centro" || text === "Center data") {
        let current = node;
        for (let i = 0; i < 5 && current; i += 1) {
          if (current.tagName === "SECTION" || current.classList?.contains("card")) return current;
          current = current.parentElement;
        }
      }
    }
    return root.firstElementChild;
  }

  function findAnchorByText(targetText) {
    const root = document.getElementById("root");
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = (node.textContent || "").trim();
      if (text === targetText) {
        let current = node;
        for (let i = 0; i < 6 && current; i += 1) {
          if (current.tagName === "SECTION" || current.classList?.contains("card") || current.classList?.contains("sh-card")) return current;
          current = current.parentElement;
        }
      }
    }
    return root.firstElementChild;
  }

  function buildPanel(context, capabilities, customerIntelligence) {
    const primary = context?.primaryAction || capabilities?.primaryAction || null;
    const source = sourceStatus(context, capabilities);
    const summary = context?.summary || {};
    const secondary = Array.isArray(context?.secondaryActions) ? context.secondaryActions : [];
    const blocked = Array.isArray(context?.blockedActions) ? context.blockedActions : [];
    const confidence = Number(context?.confidence ?? capabilities?.confidence ?? 0);
    const risk = context?.risk || capabilities?.risk || { score: 0, band: "low" };
    const customerContract = customerIntelligence?.contract || null;
    const readiness = customerIntelligence?.readiness || null;
    const localSummary = customerIntelligence?.localSummary || {};
    const customerSchema = customerContract?.schema_version || "";
    const changeImpact = context?.changeImpactContract || capabilities?.changeImpactContract || null;
    const nextStep = readiness?.next_step || "waiting_for_core";
    const automaticSendAllowed = Boolean(customerIntelligence?.automation?.automaticSendAllowed);
    const primaryText = localizeGeneratedText(cleanDisplayText(primary?.label || primary?.suggestedAction || summary.primaryActionLabel || summary.primaryAction, copy("Prossima azione: completa i dati mancanti e rileggi il centro", "Next action: complete missing data and read the center again")));
    const actionText = localizeGeneratedText(cleanDisplayText(primary?.suggestedAction || summary.firstExternalAction || primary?.action, copy("Controlla dati, cassa, agenda e costi", "Check data, cash desk, agenda and costs")));
    const explanationText = localizeGeneratedText(cleanDisplayText(primary?.explanationShort || context?.explanationShort || summary.title, copy("Cosa manca: verifica dati economici, costi servizi/operatori, agenda e cassa prima della prossima decisione.", "What is missing: check economic data, service/operator costs, agenda and cash desk before the next decision.")));
    const primaryRoute = routeForGoldAction(primary?.action || primaryText, primary?.domain, primary || {});
    const actionRoute = routeForGoldAction(primary?.suggestedAction || primary?.action || actionText, primary?.domain, primary || {});
    const explanationRoute = routeForDomain(primary?.domain, "/ai-gold");

    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "gold-bridge-panel";
    panel.innerHTML = `
      <div class="gold-bridge-source">
        <div>
          <div class="gold-bridge-source-title">${source.title}</div>
          <div class="gold-bridge-source-copy">${source.copy}</div>
        </div>
        <div class="gold-bridge-source-status ${source.className}">${source.label}</div>
      </div>
      <div class="gold-bridge-header">
        <div>
          <div class="gold-bridge-title">${copy("AI Gold - cosa fare ora", "AI Gold - what to do now", "AI Gold - was jetzt zu tun ist")}</div>
          <div class="gold-bridge-subtitle">${copy("Il gestionale dice cosa sta succedendo. AI Gold dice cosa fare, cosa manca e quale controllo aprire.", "The management system says what is happening. AI Gold says what to do, what is missing and which control to open.", "Das Managementsystem zeigt, was passiert. AI Gold sagt, was zu tun ist, was fehlt und welche Kontrolle zu öffnen ist.")}</div>
        </div>
        <div class="gold-bridge-pill">${riskLabel(risk.band)}</div>
      </div>
      <div class="gold-bridge-grid">
        <div class="gold-bridge-metric" data-gold-route="${primaryRoute}" role="button" tabindex="0" aria-label="${copy("Apri modulo collegato alla priorita AI", "Open the module linked to the AI priority")}">
          <div class="gold-bridge-label">${copy("Prossima azione", "Next action", "Nächste Aktion")}</div>
          <div class="gold-bridge-value">${escapeHtml(primaryText)}</div>
        </div>
        <div class="gold-bridge-metric" data-gold-route="/ai-gold" role="button" tabindex="0" aria-label="${copy("Apri AI Gold", "Open AI Gold")}">
          <div class="gold-bridge-label">${copy("Fonte", "Source", "Quelle")}</div>
          <div class="gold-bridge-value">${source.primary ? copy("Core/Nyra server", "Core/Nyra server", "Core/Nyra-Server") : copy("Fallback dati", "Data fallback", "Daten-Fallback")}</div>
        </div>
        <div class="gold-bridge-metric" data-gold-route="${actionRoute}" role="button" tabindex="0" aria-label="${copy("Apri azione suggerita da AI Gold", "Open the action suggested by AI Gold")}">
          <div class="gold-bridge-label">${copy("Cosa controllare", "What to check", "Was prüfen")}</div>
          <div class="gold-bridge-value">${escapeHtml(actionText)}</div>
        </div>
      </div>
      <div class="gold-bridge-list">
        <div class="gold-bridge-item" data-gold-route="${explanationRoute}" role="button" tabindex="0" aria-label="${copy("Apri dettaglio operativo collegato", "Open linked operational detail")}">
          <div class="gold-bridge-item-title">${escapeHtml(explanationText)}</div>
          <div class="gold-bridge-item-subtitle">${copy("Dominio", "Domain")}: ${primary?.domain || copy("centro", "center")} · ${copy("rischio", "risk")} ${(Number(risk.score || 0)).toFixed(2)} · provider ${escapeHtml(source.provider)}</div>
        </div>
        ${secondary.slice(0, 3).map((item) => `
          <div class="gold-bridge-item" data-gold-route="${routeForGoldAction(item.action, item.domain, item)}" role="button" tabindex="0" aria-label="${copy("Apri priorita secondaria", "Open secondary priority")}">
            <div class="gold-bridge-item-title">${localizeGeneratedText(item.label || item.domain || copy("Priorita secondaria", "Secondary priority"))}</div>
            <div class="gold-bridge-item-subtitle">${copy("Dominio", "Domain")}: ${item.domain || copy("centro", "center")} · ${copy("punteggio", "score")} ${(Number(item.score || 0)).toFixed(2)}</div>
          </div>
        `).join("")}
        ${blocked.length ? `
          <div class="gold-bridge-item" data-gold-route="/settings" role="button" tabindex="0" aria-label="${copy("Apri impostazioni per azioni bloccate", "Open settings for blocked actions")}">
            <div class="gold-bridge-item-title">${copy("Azioni bloccate", "Blocked actions")}</div>
            <div class="gold-bridge-item-subtitle">${blocked.map((item) => escapeHtml(item.label || item.domain || item)).join(" · ")}</div>
          </div>
        ` : ""}
        ${changeImpact?.enabled ? `
          <div class="gold-bridge-item" data-gold-route="/ai-gold" role="button" tabindex="0" aria-label="${copy("Apri AI Gold per effetto domino", "Open AI Gold for domino effect")}">
            <div class="gold-bridge-item-title">${copy("Effetto domino attivo", "Domino effect active")}</div>
            <div class="gold-bridge-item-subtitle">
              Branch ${escapeHtml(changeImpact.coreBranch || "change_impact_orchestration")} ·
              ${Number(changeImpact.requiredActionsCount || changeImpact.requiredActions?.length || 0)} ${copy("controlli", "checks")} ·
              ${Number(changeImpact.testsRequiredCount || changeImpact.testsRequired?.length || 0)} test ·
              ${copy("conferma owner richiesta", "owner confirmation required")}
            </div>
          </div>
        ` : ""}
        ${customerSchema ? `
          <div class="gold-bridge-item" data-gold-route="/clients" role="button" tabindex="0" aria-label="${copy("Apri clienti collegati alla lettura clienti Core", "Open clients linked to Core client reading")}">
            <div class="gold-bridge-item-title">${copy("Lettura clienti Core", "Core client reading")}</div>
            <div class="gold-bridge-item-subtitle">
              ${customerSchema} · ${copy("clienti", "clients")} ${Number(localSummary.clients || 0)} · ${copy("consensi", "consents")} ${Number(readiness?.granted_consent_count ?? localSummary.consents_registered ?? 0)} · ${copy("invio automatico", "automatic sending")} ${automaticSendAllowed ? copy("abilitato", "enabled") : copy("bloccato", "blocked")}
            </div>
            <div class="gold-bridge-item-subtitle">${copy("Prossima azione", "Next action")}: ${nextStep}</div>
          </div>
        ` : ""}
      </div>
    `;
    bindBridgeNavigation(panel);
    return panel;
  }

  async function renderGoldBridge() {
    renderToken += 1;
    const token = renderToken;
    if (!shouldRender()) {
      runWithMutationLock(() => removePanel());
      return;
    }
    injectStyle();

    try {
      await refreshUiLanguage();
      if (await isEnterpriseControlSession()) {
        runWithMutationLock(() => removePanel());
        return;
      }
      const [capabilities, context, customerIntelligence] = await Promise.all([
        fetchJson("/api/ai-gold/capabilities"),
        fetchJson("/api/ai-gold/decision-context"),
        fetchJson("/api/ai-gold/customer-intelligence").catch(() => null)
      ]);
      if (token !== renderToken) return;

      const anchor = findAnchor();
      if (!anchor) return;
      sanitizeGoldUiText();
      const panel = buildPanel(context, capabilities, customerIntelligence);
      const existing = document.getElementById(PANEL_ID);
      runWithMutationLock(() => {
        if (existing) {
          existing.replaceWith(panel);
        } else {
          anchor.insertAdjacentElement("afterend", panel);
        }
      });
      sanitizeGoldUiText(panel);
    } catch (_error) {
      sanitizeGoldUiText();
      if (!shouldRender()) {
        runWithMutationLock(() => removePanel());
      }
    }
  }

  function isSettingsRoute() {
    return (window.location.pathname || "/") === "/settings";
  }

  function isDashboardRoute() {
    return ["/", "/dashboard"].includes(window.location.pathname || "/");
  }

  function isEnterpriseAiRoute() {
    return (window.location.pathname || "/") === "/ai-gold";
  }

  function isReportsRoute() {
    return (window.location.pathname || "/") === "/reports";
  }

  function isSurfaceRoute() {
    return ["/services", "/shifts", "/protocols"].includes(window.location.pathname || "/");
  }

  function findEnterpriseHomeAnchor() {
    return findAnchorByText("Centro letto da Smart Desk")
      || findAnchorByText("Smart Desk center reading")
      || findAnchorByText("Centro sotto controllo")
      || findAnchorByText("Center under control")
      || document.getElementById("root")?.firstElementChild
      || null;
  }

  let sessionRoleCache = "";
  let sessionRolePromise = null;

  async function getSessionRole() {
    if (sessionRoleCache) return sessionRoleCache;
    if (!sessionRolePromise) {
      sessionRolePromise = fetchJson("/api/auth/session")
        .then((session) => {
          sessionRoleCache = String(session?.role || "").toLowerCase();
          return sessionRoleCache;
        })
        .catch(() => "")
        .finally(() => {
          sessionRolePromise = null;
        });
    }
    return sessionRolePromise;
  }

  async function isSuperAdminSession() {
    try {
      return (await getSessionRole()) === "superadmin";
    } catch (_error) {
      return false;
    }
  }

  function buildSettingsPanel() {
    const panel = document.createElement("section");
    panel.id = SETTINGS_PANEL_ID;
    panel.className = "admin-tools-panel";
    panel.innerHTML = `
      <div class="admin-tools-header">
        <div>
          <div class="admin-tools-title">${copy("Pulizia demo e test", "Demo and test cleanup")}</div>
          <div class="admin-tools-subtitle">${copy("Strumenti rapidi super admin per togliere tenant demo/test e ripulire il rumore operativo.", "Quick super admin tools to remove demo/test tenants and clean operational noise.")}</div>
        </div>
        <div class="gold-bridge-pill">super admin</div>
      </div>
      <div class="admin-tools-actions">
        <button type="button" class="admin-tools-button" data-admin-action="cleanup-demo-centers">${copy("Elimina demo/test tenant", "Delete demo/test tenants")}</button>
        <button type="button" class="admin-tools-button secondary" data-admin-action="cleanup-test-prefix">${copy("Pulisci test STRESS_", "Clean STRESS_ tests")}</button>
      </div>
      <div class="admin-tools-status" data-admin-status>${copy("Pronto.", "Ready.")}</div>
    `;
    panel.addEventListener("click", async (event) => {
      const action = event.target?.getAttribute?.("data-admin-action");
      if (!action) return;
      const status = panel.querySelector("[data-admin-status]");
      status.textContent = copy("Esecuzione...", "Running...");
      try {
        if (action === "cleanup-demo-centers") {
          const result = await postJson("/api/admin/cleanup-demo-centers", {});
          status.textContent = `${copy("Centri rimossi", "Centers removed")}: ${(result.removedCenters || []).join(", ") || copy("nessuno", "none")}.`;
        }
        if (action === "cleanup-test-prefix") {
          const result = await postJson("/api/admin/cleanup-test-data", { prefix: "STRESS_" });
          status.textContent = copy("Cleanup STRESS_ completato.", "STRESS_ cleanup completed.");
          if (result?.deleted?.users || result?.deleted?.clients) {
            status.textContent += ` Users ${result.deleted.users || 0}, ${copy("clienti", "clients")} ${result.deleted.clients || 0}.`;
          }
        }
      } catch (error) {
        status.textContent = error.message || String(error);
      }
    });
    return panel;
  }

  function buildEnterpriseSettingsPanel(session, settings, enterpriseControl = null) {
    const role = String(session?.role || "owner").toLowerCase();
    const supportMode = Boolean(session?.supportMode);
    if (role !== "superadmin" || supportMode) return null;
    const confirmationMode = role === "superadmin" ? "high_control" : "required_for_sensitive_actions";
    const activeModules = [
      settings?.enableMarketing !== false,
      settings?.enableTreatments !== false,
      settings?.enableCashdesk !== false,
      settings?.enableProtocolsHub !== false,
      settings?.shiftsBaseEnabled !== false,
      settings?.profitabilityEnabled !== false,
      settings?.operatorReportsEnabled !== false
    ].filter(Boolean).length;
    const centerCount = Number(enterpriseControl?.centerCount || 0);
    const centerLimit = Number(enterpriseControl?.centerLimit || 0);
    const remainingCenters = Number(enterpriseControl?.remainingCenters || 0);
    const canCreateCenters = Boolean(enterpriseControl?.canCreateCenters);
    const subscriptionStatus = String(enterpriseControl?.subscriptionStatus || "active");
    const creationPolicy = enterpriseControl?.creationPolicy
      || copy("Creazione centri gestita dall'abbonamento Enterprise.", "Center creation is managed by the Enterprise subscription.");
    const checklist = Array.isArray(enterpriseControl?.checklist) ? enterpriseControl.checklist : [];
    const panel = document.createElement("section");
    panel.id = ENTERPRISE_SETTINGS_PANEL_ID;
    panel.className = "enterprise-bridge-panel";
    panel.innerHTML = `
      <div class="enterprise-bridge-header">
        <div>
          <div class="enterprise-bridge-title">${copy("Enterprise Control Room", "Enterprise Control Room")}</div>
          <div class="enterprise-bridge-subtitle">${copy("Per catene, franchising e brand: controlla centri, accessi, piani, supporto e slot abbonamento senza entrare nel gestionale operativo del singolo centro.", "For chains, franchises and brands: manage centers, access, plans, support and subscription slots without replacing the operating desk of a single center.")}</div>
        </div>
        <div class="enterprise-bridge-pill">${copy("Piano", "Plan")} Enterprise</div>
      </div>
      <div class="enterprise-bridge-grid">
        <div class="enterprise-bridge-card" data-enterprise-card-target="/settings" role="button" tabindex="0" aria-label="${copy("Apri impostazioni sessione", "Open session settings")}">
          <div class="enterprise-bridge-card-title">${copy("Abbonamento", "Subscription")}</div>
          <div class="enterprise-bridge-card-value">${subscriptionStatus}</div>
          <div class="enterprise-bridge-card-copy">${creationPolicy}</div>
        </div>
        <div class="enterprise-bridge-card" data-enterprise-card-target="/settings" role="button" tabindex="0" aria-label="${copy("Apri impostazioni moduli", "Open module settings")}">
          <div class="enterprise-bridge-card-title">${copy("Centri gestiti", "Managed centers")}</div>
          <div class="enterprise-bridge-card-value">${centerCount} / ${centerLimit}</div>
          <div class="enterprise-bridge-card-copy">${canCreateCenters ? `${remainingCenters} ${copy("slot disponibili per nuovi centri.", "slots available for new centers.")}` : copy("Nessuno slot disponibile: la creazione nuovi centri e bloccata.", "No slot available: new center creation is locked.")}</div>
        </div>
        <div class="enterprise-bridge-card" data-enterprise-card-target="/settings" role="button" tabindex="0" aria-label="${copy("Apri prossima azione impostazioni", "Open next settings action")}">
          <div class="enterprise-bridge-card-title">${copy("Governance", "Governance")}</div>
          <div class="enterprise-bridge-card-value">${copy("azioni confermabili", "confirmable actions")}</div>
          <div class="enterprise-bridge-card-copy">${copy("Supporto, reset, cambio piano e nuovi centri restano sotto controllo abbonamento e conferma operativa.", "Support, reset, plan changes and new centers remain under subscription control and operational confirmation.")}</div>
        </div>
        <div class="enterprise-bridge-card" data-enterprise-card-target="/fleet-intelligence" role="button" tabindex="0" aria-label="${copy("Apri Fleet Intelligence", "Open Fleet Intelligence")}">
          <div class="enterprise-bridge-card-title">${copy("Fleet Intelligence", "Fleet Intelligence")}</div>
          <div class="enterprise-bridge-card-value">${copy("read-only", "read-only")}</div>
          <div class="enterprise-bridge-card-copy">${copy("Lettura multi-centro per anomalie, performance e uso, senza modificare dati operativi dei centri.", "Multi-center reading for anomalies, performance and usage, without changing center operating data.")}</div>
        </div>
        <div class="enterprise-bridge-card" data-enterprise-card-target="/settings" role="button" tabindex="0" aria-label="${copy("Apri checklist Enterprise", "Open Enterprise checklist")}">
          <div class="enterprise-bridge-card-title">${copy("Checklist", "Checklist")}</div>
          <div class="enterprise-bridge-card-value">${checklist.length || activeModules} ${copy("controlli", "checks")}</div>
          <div class="enterprise-bridge-card-copy">${(checklist.slice(0, 3).map((item) => item.label).join(" · ")) || copy("Centri, piani, supporto e moduli attivi.", "Centers, plans, support and active modules.")}</div>
        </div>
        <div class="enterprise-bridge-card" data-enterprise-card-target="/settings" role="button" tabindex="0" aria-label="${copy("Apri controllo piani", "Open plan control")}">
          <div class="enterprise-bridge-card-title">${copy("Piani centri", "Center plans")}</div>
          <div class="enterprise-bridge-card-value">Base · Silver · Gold</div>
          <div class="enterprise-bridge-card-copy">${copy("Enterprise controlla la flotta; il singolo centro continua a lavorare nel proprio piano operativo.", "Enterprise controls the fleet; each center keeps working inside its operating plan.")}</div>
        </div>
      </div>
    `;
    bindBridgeNavigation(panel);
    return panel;
  }

  function normalizeEnterpriseCenters(users = []) {
    const planRank = { base: 1, silver: 2, gold: 3 };
    const centers = new Map();
    users.forEach((user) => {
      if (String(user.role || "").toLowerCase() === "superadmin") return;
      const centerId = String(user.centerId || "").trim();
      if (!centerId) return;
      const current = centers.get(centerId) || {
        centerId,
        centerName: user.centerName || centerId,
        users: 0,
        activeUsers: 0,
        plan: user.subscriptionPlan || "base",
        accessState: user.accessState || "",
        memory: user.controlStats?.memoryBytes || 0,
        sessions: user.controlStats?.activeSessions || 0,
        ownerName: user.ownerName || "",
        contactEmail: user.contactEmail || ""
      };
      current.users += 1;
      if (user.active !== false && !["suspended", "expired"].includes(String(user.accessState || ""))) current.activeUsers += 1;
      if ((planRank[String(user.subscriptionPlan || "").toLowerCase()] || 0) > (planRank[String(current.plan || "").toLowerCase()] || 0)) {
        current.plan = user.subscriptionPlan || current.plan;
      }
      current.sessions += Number(user.controlStats?.activeSessions || 0);
      current.memory += Number(user.controlStats?.memoryBytes || 0);
      centers.set(centerId, current);
    });
    return Array.from(centers.values()).sort((a, b) => String(a.centerName).localeCompare(String(b.centerName)));
  }

  function formatMemory(bytes) {
    const value = Number(bytes || 0);
    if (value >= 1048576) return `${(value / 1048576).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
  }

  function buildEnterpriseHomePanel(session, enterpriseControl = null, users = []) {
    const role = String(session?.role || "owner").toLowerCase();
    const supportMode = Boolean(session?.supportMode);
    if (role !== "superadmin" || supportMode) return null;
    const centerCount = Number(enterpriseControl?.centerCount || 0);
    const centerLimit = Number(enterpriseControl?.centerLimit || 0);
    const remainingCenters = Number(enterpriseControl?.remainingCenters || 0);
    const canCreateCenters = Boolean(enterpriseControl?.canCreateCenters);
    const subscriptionStatus = String(enterpriseControl?.subscriptionStatus || "active");
    const checklist = Array.isArray(enterpriseControl?.checklist) ? enterpriseControl.checklist : [];
    const centers = normalizeEnterpriseCenters(users);
    const panel = document.createElement("section");
    panel.id = ENTERPRISE_HOME_PANEL_ID;
    panel.className = "enterprise-bridge-panel";
    panel.innerHTML = `
      <div class="enterprise-bridge-header">
        <div>
          <div class="enterprise-bridge-title">${copy("Enterprise Control Room", "Enterprise Control Room")}</div>
          <div class="enterprise-bridge-subtitle">${copy("Vista superadmin per catene, franchising e brand: qui controlli centri, piani, supporto, slot abbonamento e Fleet Intelligence. Il gestionale operativo resta dentro ogni singolo centro.", "Superadmin view for chains, franchises and brands: manage centers, plans, support, subscription slots and Fleet Intelligence here. The operating desk stays inside each single center.")}</div>
        </div>
        <div class="enterprise-bridge-pill">${copy("Piano", "Plan")} Enterprise</div>
      </div>
      <div class="enterprise-bridge-grid">
        <div class="enterprise-bridge-card" data-enterprise-card-target="/settings" role="button" tabindex="0">
          <div class="enterprise-bridge-card-title">${copy("Abbonamento", "Subscription")}</div>
          <div class="enterprise-bridge-card-value">${subscriptionStatus}</div>
          <div class="enterprise-bridge-card-copy">${canCreateCenters ? copy("Creazione centri consentita entro gli slot attivi.", "Center creation allowed within active slots.") : copy("Creazione nuovi centri bloccata: serve uno slot Enterprise attivo.", "New center creation locked: an active Enterprise slot is required.")}</div>
        </div>
        <div class="enterprise-bridge-card" data-enterprise-card-target="/settings" role="button" tabindex="0">
          <div class="enterprise-bridge-card-title">${copy("Centri / slot", "Centers / slots")}</div>
          <div class="enterprise-bridge-card-value">${centerCount} / ${centerLimit}</div>
          <div class="enterprise-bridge-card-copy">${remainingCenters} ${copy("slot disponibili.", "slots available.")}</div>
        </div>
        <div class="enterprise-bridge-card" data-enterprise-card-target="/fleet-intelligence" role="button" tabindex="0">
          <div class="enterprise-bridge-card-title">${copy("Fleet Intelligence", "Fleet Intelligence")}</div>
          <div class="enterprise-bridge-card-value">${copy("multi-centro", "multi-center")}</div>
          <div class="enterprise-bridge-card-copy">${copy("Legge uso, anomalie e performance senza scrivere dati operativi.", "Reads usage, anomalies and performance without writing operating data.")}</div>
        </div>
        <div class="enterprise-bridge-card" data-enterprise-card-target="/settings" role="button" tabindex="0">
          <div class="enterprise-bridge-card-title">${copy("Piani centri", "Center plans")}</div>
          <div class="enterprise-bridge-card-value">Base · Silver · Gold</div>
          <div class="enterprise-bridge-card-copy">${copy("Enterprise governa la flotta; i centri restano nei loro piani operativi.", "Enterprise governs the fleet; centers remain in their operating plans.")}</div>
        </div>
        <div class="enterprise-bridge-card" data-enterprise-card-target="/settings" role="button" tabindex="0">
          <div class="enterprise-bridge-card-title">${copy("Supporto", "Support")}</div>
          <div class="enterprise-bridge-card-value">${copy("accesso controllato", "controlled access")}</div>
          <div class="enterprise-bridge-card-copy">${copy("Entrata supporto, reset e cambi piano restano azioni confermabili.", "Support entry, resets and plan changes remain confirmable actions.")}</div>
        </div>
        <div class="enterprise-bridge-card" data-enterprise-card-target="/settings" role="button" tabindex="0">
          <div class="enterprise-bridge-card-title">${copy("Checklist", "Checklist")}</div>
          <div class="enterprise-bridge-card-value">${checklist.length || 6} ${copy("controlli", "checks")}</div>
          <div class="enterprise-bridge-card-copy">${(checklist.slice(0, 3).map((item) => item.label).join(" · ")) || copy("Centri, abbonamento, supporto.", "Centers, subscription, support.")}</div>
        </div>
      </div>
      <div class="enterprise-center-list">
        ${centers.length ? centers.slice(0, 8).map((center) => `
          <div class="enterprise-center-row">
            <div>
              <div class="enterprise-center-name">${escapeHtml(center.centerName)}</div>
              <div class="enterprise-center-meta">
                ${escapeHtml(center.plan || "base")} · ${center.activeUsers}/${center.users} ${copy("utenti attivi", "active users")} · ${center.sessions} ${copy("sessioni", "sessions")} · ${formatMemory(center.memory)}
              </div>
            </div>
            <button type="button" class="enterprise-center-action" data-enterprise-support-user="${escapeHtml(center.centerId)}">${copy("Entra nel centro", "Enter center")}</button>
          </div>
        `).join("") : `
          <div class="enterprise-center-row">
            <div>
              <div class="enterprise-center-name">${copy("Nessun centro collegato", "No connected center")}</div>
              <div class="enterprise-center-meta">${copy("Aggiungi centri solo tramite slot Enterprise attivi.", "Add centers only through active Enterprise slots.")}</div>
            </div>
          </div>
        `}
      </div>
    `;
    panel.addEventListener("click", async (event) => {
      const button = event.target?.closest?.("[data-enterprise-support-user]");
      if (!button) return;
      const centerId = button.getAttribute("data-enterprise-support-user");
      const target = users.find((user) => String(user.centerId || "") === String(centerId || "") && String(user.role || "").toLowerCase() !== "superadmin");
      if (!target?.id) return;
      button.disabled = true;
      button.textContent = copy("Apertura...", "Opening...");
      try {
        const result = await postJson(`/api/auth/users/${target.id}/support-session`, {});
        if (result?.token) window.localStorage.setItem("skinharmony-web-token", result.token);
        window.location.assign("/");
      } catch (error) {
        button.disabled = false;
        button.textContent = error?.message || copy("Errore", "Error");
      }
    });
    bindBridgeNavigation(panel);
    return panel;
  }

  function detectActivePeriod() {
    const activeButton =
      document.querySelector(".dashboard-period-toggle .active-btn") ||
      document.querySelector(".dashboard-period-toggle [aria-pressed='true']");
    const raw = (activeButton?.textContent || "").trim().toLowerCase();
    if (raw.includes("settim") || raw.includes("week")) return "week";
    if (raw.includes("mese") || raw.includes("month")) return "month";
    return "day";
  }

  function buildEnterpriseReportsPanel() {
    const activePeriod = detectActivePeriod();
    const panel = document.createElement("section");
    panel.id = ENTERPRISE_REPORTS_PANEL_ID;
    panel.className = "enterprise-bridge-panel";
    panel.innerHTML = `
      <div class="enterprise-bridge-header">
        <div>
          <div class="enterprise-bridge-title">${copy("Lettura report piu chiara", "Clearer report reading")}</div>
          <div class="enterprise-bridge-subtitle">${copy("Lo stato selezionato deve restare visibile anche con dati a zero: giorno, settimana e mese non possono sembrare uguali.", "The selected state must remain visible even with zero data: day, week and month cannot look the same.")}</div>
        </div>
        <div class="enterprise-bridge-pill">${copy("vista", "view")} ${activePeriod}</div>
      </div>
      <div class="enterprise-bridge-grid">
        <div class="enterprise-bridge-card" data-enterprise-card-target="/reports" role="button" tabindex="0" aria-label="${copy("Apri report periodo attivo", "Open active-period report")}">
          <div class="enterprise-bridge-card-title">${copy("Periodo attivo", "Active period")}</div>
          <div class="enterprise-bridge-card-value">${activePeriod}</div>
          <div class="enterprise-bridge-card-copy">${copy("La selezione attiva deve essere leggibile subito sopra numeri e liste.", "The active selection must be readable immediately above numbers and lists.")}</div>
        </div>
        <div class="enterprise-bridge-card" data-enterprise-card-target="/cashdesk" role="button" tabindex="0" aria-label="${copy("Apri cassa per verificare dati zero", "Open cash desk to verify zero data")}">
          <div class="enterprise-bridge-card-title">${copy("Se i dati sono zero", "If data is zero")}</div>
          <div class="enterprise-bridge-card-value">${copy("non deve sembrare silenzio", "it must not look silent")}</div>
          <div class="enterprise-bridge-card-copy">${copy("La UI deve spiegare se mancano attivita, cassa o semplicemente volume nel periodo selezionato.", "The UI must explain whether activity, cash desk data or simply volume is missing in the selected period.")}</div>
        </div>
        <div class="enterprise-bridge-card" data-enterprise-card-target="/appointments" role="button" tabindex="0" aria-label="${copy("Apri agenda per azione utile", "Open agenda for useful action")}">
          <div class="enterprise-bridge-card-title">${copy("Azione utile", "Useful action")}</div>
          <div class="enterprise-bridge-card-value">${copy("cambia vista o verifica chiusure", "change view or verify closures")}</div>
          <div class="enterprise-bridge-card-copy">${copy("Se il giorno e vuoto, prova settimana o mese; se e tutto vuoto, controlla agenda, cassa e collegamenti servizio-operatore.", "If the day is empty, try week or month; if everything is empty, check agenda, cash desk and service-operator links.")}</div>
        </div>
      </div>
    `;
    bindBridgeNavigation(panel);
    return panel;
  }

  function buildEnterpriseSurfacePanel(route) {
    const config = {
      "/services": {
        title: copy("Servizi separati con piu chiarezza", "Services separated more clearly"),
        subtitle: copy("Catalogo, staff e risorse devono essere letti come superfici diverse dello stesso sistema.", "Catalog, staff and resources must be read as different surfaces of the same system."),
        actions: [
          { label: copy("Catalogo", "Catalog"), href: "/services", active: true },
          { label: copy("Turni", "Shifts"), href: "/shifts" },
          { label: copy("Protocolli", "Protocols"), href: "/protocols" }
        ],
        cards: [
          [copy("Catalogo", "Catalog"), copy("Tieni allineati prezzo, durata e categoria.", "Keep price, duration and category aligned."), "/services"],
          ["Staff", copy("Se manca lo staff, la shell deve dirlo in modo utile.", "If staff is missing, the shell must say it usefully."), "/services"],
          [copy("Risorse", "Resources"), copy("Tecnologie e stanze vanno lette come vincoli operativi.", "Technologies and rooms must be read as operational constraints."), "/services"]
        ]
      },
      "/shifts": {
        title: copy("Turni leggibili a blocchi", "Shifts readable by blocks"),
        subtitle: copy("Calendario, presenze e modelli devono essere separati meglio nelle schermate lunghe.", "Calendar, attendance and templates must be better separated in long screens."),
        actions: [
          { label: copy("Turni", "Shifts"), href: "/shifts", active: true },
          { label: copy("Servizi", "Services"), href: "/services" },
          { label: copy("Protocolli", "Protocols"), href: "/protocols" }
        ],
        cards: [
          [copy("Calendario", "Calendar"), copy("Prima vedi chi lavora oggi e dove ci sono buchi.", "First see who works today and where there are gaps."), "/shifts"],
          [copy("Presenze", "Attendance"), copy("Poi conferme e controllo operativo.", "Then confirmations and operational control."), "/shifts"],
          [copy("Modelli", "Templates"), copy("Infine gli schemi riutilizzabili del centro.", "Finally the reusable center patterns."), "/shifts"]
        ]
      },
      "/protocols": {
        title: copy("Protocolli con livelli piu chiari", "Protocols with clearer levels"),
        subtitle: copy("Libreria, scheda cliente e bozza AI devono sembrare tre livelli distinti, non una pagina unica lunghissima.", "Library, client profile and AI draft must feel like three distinct levels, not one very long page."),
        actions: [
          { label: copy("Protocolli", "Protocols"), href: "/protocols", active: true },
          { label: copy("Servizi", "Services"), href: "/services" },
          { label: copy("Turni", "Shifts"), href: "/shifts" }
        ],
        cards: [
          [copy("Libreria", "Library"), copy("Prima vedi cosa esiste gia e cosa manca.", "First see what already exists and what is missing."), "/protocols"],
          [copy("Cliente", "Client"), copy("Poi storico, sensibilita e zona.", "Then history, sensitivity and area."), "/clients"],
          [copy("Bozza AI", "AI draft"), copy("Solo dopo arrivano suggerimento e conferma operatore.", "Only then come suggestion and operator confirmation."), "/ai-gold"]
        ]
      }
    }[route];
    if (!config) return null;
    const panel = document.createElement("section");
    panel.id = ENTERPRISE_SURFACE_PANEL_ID;
    panel.className = "enterprise-bridge-panel";
    panel.innerHTML = `
      <div class="enterprise-bridge-header">
        <div>
          <div class="enterprise-bridge-title">${config.title}</div>
          <div class="enterprise-bridge-subtitle">${config.subtitle}</div>
        </div>
        <div class="enterprise-bridge-pill">enterprise ui</div>
      </div>
      <div class="enterprise-bridge-grid">
        ${config.cards.map(([title, copy, target]) => `
          <div class="enterprise-bridge-card" data-enterprise-card-target="${target}" role="button" tabindex="0" aria-label="${copy("Apri", "Open")} ${title}">
            <div class="enterprise-bridge-card-title">${title}</div>
            <div class="enterprise-bridge-card-copy">${copy}</div>
          </div>
        `).join("")}
      </div>
      <div class="enterprise-bridge-actions">
        ${config.actions.map((item) => `
          <button type="button" class="enterprise-bridge-link ${item.active ? "active" : ""}" data-enterprise-nav="${item.href}">${item.label}</button>
        `).join("")}
      </div>
    `;
    bindBridgeNavigation(panel);
    return panel;
  }

  async function renderSettingsTools() {
    if (!isSettingsRoute()) {
      runWithMutationLock(() => removeSettingsPanel());
      return;
    }
    await refreshUiLanguage();
    if (!(await isSuperAdminSession())) {
      runWithMutationLock(() => removeSettingsPanel());
      return;
    }
    injectStyle();
    const anchor = findSettingsAnchor();
    if (!anchor) return;
    const panel = buildSettingsPanel();
    const existing = document.getElementById(SETTINGS_PANEL_ID);
    runWithMutationLock(() => {
      if (existing) {
        existing.replaceWith(panel);
      } else {
        anchor.insertAdjacentElement("afterend", panel);
      }
    });
  }

  async function renderEnterprisePanels() {
    if (!isDashboardRoute() && !isEnterpriseAiRoute() && !isSettingsRoute() && !isReportsRoute() && !isSurfaceRoute()) {
      runWithMutationLock(removeEnterprisePanels);
      return;
    }
    injectStyle();
    if (isDashboardRoute() || isEnterpriseAiRoute()) {
      try {
        const [session, enterpriseControl, users] = await Promise.all([
          fetchJson("/api/auth/session"),
          fetchJson("/api/enterprise/control").catch(() => null),
          fetchJson("/api/auth/users").catch(() => [])
        ]);
        const anchor = isEnterpriseAiRoute() ? (document.getElementById("root")?.firstElementChild || findEnterpriseHomeAnchor()) : findEnterpriseHomeAnchor();
        const panel = buildEnterpriseHomePanel(session, enterpriseControl, users);
        const existing = document.getElementById(ENTERPRISE_HOME_PANEL_ID);
        runWithMutationLock(() => {
          if (!panel) {
            if (existing) existing.remove();
            return;
          }
          if (existing) existing.replaceWith(panel);
          else if (anchor) anchor.insertAdjacentElement("beforebegin", panel);
        });
      } catch (_error) {
        const existing = document.getElementById(ENTERPRISE_HOME_PANEL_ID);
        if (existing) runWithMutationLock(() => existing.remove());
      }
    } else {
      const existing = document.getElementById(ENTERPRISE_HOME_PANEL_ID);
      if (existing) runWithMutationLock(() => existing.remove());
    }
    if (isSettingsRoute()) {
      try {
        const [session, settings, enterpriseControl] = await Promise.all([
          fetchJson("/api/auth/session"),
          fetchJson("/api/settings"),
          fetchJson("/api/enterprise/control").catch(() => null)
        ]);
        await refreshUiLanguage(settings);
        const anchor = findSettingsAnchor();
        if (anchor) {
          const panel = buildEnterpriseSettingsPanel(session, settings, enterpriseControl);
          const existing = document.getElementById(ENTERPRISE_SETTINGS_PANEL_ID);
          runWithMutationLock(() => {
            if (!panel) {
              if (existing) existing.remove();
              return;
            }
            if (existing) existing.replaceWith(panel);
            else anchor.insertAdjacentElement("afterend", panel);
          });
        }
      } catch (_error) {}
    } else {
      const existing = document.getElementById(ENTERPRISE_SETTINGS_PANEL_ID);
      if (existing) runWithMutationLock(() => existing.remove());
    }
    if (isReportsRoute()) {
      const anchor = findAnchorByText("Report operativi");
      if (anchor) {
        const panel = buildEnterpriseReportsPanel();
        const existing = document.getElementById(ENTERPRISE_REPORTS_PANEL_ID);
        runWithMutationLock(() => {
          if (existing) existing.replaceWith(panel);
          else anchor.insertAdjacentElement("afterend", panel);
        });
      }
    } else {
      const existing = document.getElementById(ENTERPRISE_REPORTS_PANEL_ID);
      if (existing) runWithMutationLock(() => existing.remove());
    }
    if (isSurfaceRoute()) {
      const route = window.location.pathname || "/";
      const targetText = route === "/services" ? "Servizi e risorse" : route === "/shifts" ? "Shifts" : "Protocols";
      const fallbackText = route === "/services" ? "Services and resources" : route === "/shifts" ? "Shifts" : "Protocols";
      const anchor = findAnchorByText(targetText) || findAnchorByText(fallbackText);
      const panel = buildEnterpriseSurfacePanel(route);
      if (anchor && panel) {
        const existing = document.getElementById(ENTERPRISE_SURFACE_PANEL_ID);
        runWithMutationLock(() => {
          if (existing) existing.replaceWith(panel);
          else anchor.insertAdjacentElement("afterend", panel);
        });
      }
    } else {
      const existing = document.getElementById(ENTERPRISE_SURFACE_PANEL_ID);
      if (existing) runWithMutationLock(() => existing.remove());
    }
  }

  function scheduleRender() {
    clearTimers(goldRenderTimers);
    clearTimers(settingsRenderTimers);
    window.setTimeout(enhanceTopbarMenu, 80);
    window.setTimeout(enhanceTopbarMenu, 360);
    goldRenderTimers = [
      window.setTimeout(() => refreshLanguageAndSanitize({ force: true }), 40),
      window.setTimeout(renderGoldBridge, 180),
      window.setTimeout(() => refreshLanguageAndSanitize(), 420),
      window.setTimeout(renderGoldBridge, 900),
      window.setTimeout(() => refreshLanguageAndSanitize({ force: true }), 1400)
    ];
    settingsRenderTimers = [
      window.setTimeout(renderEnterprisePanels, 180),
      window.setTimeout(renderEnterprisePanels, 520),
      window.setTimeout(renderSettingsTools, 180),
      window.setTimeout(renderSettingsTools, 900)
    ];
  }

  const observer = new MutationObserver(() => {
    if (mutationLockDepth > 0) return;
    refreshLanguageAndSanitize();
    scheduleRender();
  });

  const originalPushState = history.pushState;
  history.pushState = function () {
    const result = originalPushState.apply(this, arguments);
    scheduleRender();
    return result;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function () {
    const result = originalReplaceState.apply(this, arguments);
    scheduleRender();
    return result;
  };

  window.addEventListener("popstate", scheduleRender);
  window.addEventListener("load", scheduleRender);
  window.addEventListener("app-settings-updated", (event) => {
    void refreshUiLanguage(event?.detail || null).then(() => {
      sanitizeGoldUiText();
      scheduleRender();
    });
  });

  function startObserver() {
    if (observerStarted) return;
    const root = document.getElementById("root");
    if (!root) {
      window.setTimeout(startObserver, 120);
      return;
    }
    observer.observe(root, { childList: true, subtree: true });
    observerStarted = true;
    refreshLanguageAndSanitize({ force: true });
  }

  startObserver();
  scheduleRender();
})();
