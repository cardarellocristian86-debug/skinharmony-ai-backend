(function () {
  const SCRIPT_ID = "skinharmony-gold-bridge-style";
  const PANEL_ID = "skinharmony-gold-priority-bridge";
  const ROUTES = new Set(["/", "/dashboard", "/ai-gold"]);
  const SETTINGS_PANEL_ID = "skinharmony-admin-tools-bridge";
  const ENTERPRISE_SETTINGS_PANEL_ID = "skinharmony-enterprise-settings-bridge";
  const ENTERPRISE_REPORTS_PANEL_ID = "skinharmony-enterprise-reports-bridge";
  const ENTERPRISE_SURFACE_PANEL_ID = "skinharmony-enterprise-surface-bridge";
  let renderToken = 0;
  let goldRenderTimers = [];
  let settingsRenderTimers = [];
  let observerStarted = false;
  let mutationLockDepth = 0;

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
    if (band === "high") return "Rischio alta";
    if (band === "medium") return "Rischio media";
    return "Rischio bassa";
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
    [ENTERPRISE_SETTINGS_PANEL_ID, ENTERPRISE_REPORTS_PANEL_ID, ENTERPRISE_SURFACE_PANEL_ID].forEach((id) => {
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

  function shouldRender() {
    return ROUTES.has(window.location.pathname || "/");
  }

  function cleanDisplayText(value, fallback = "") {
    const text = String(value || fallback || "").trim();
    return text || fallback;
  }

  function sourceStatus(context = {}, capabilities = {}) {
    const external = context?.externalAi || {};
    const primary = Boolean(external.primary || context?.summary?.externalPrimary || context?.decisionAuthority === "core_nyra_render_primary");
    const provider = cleanDisplayText(external.provider || context?.summary?.externalProvider || capabilities?.engineName || "", "Lettura dati Smart Desk");
    return {
      primary,
      provider,
      label: primary ? "Fonte primaria" : "Lettura prudente",
      title: primary ? "Core/Nyra server in alto" : "Core/Nyra server non pienamente disponibili",
      copy: primary
        ? "Smart Desk legge i dati del centro; Core server decide la priorita; Nyra server spiega cosa fare. OpenAI rifinisce solo la forma se disponibile."
        : "Smart Desk sta mostrando una lettura prudente dai dati locali. Controlla dati mancanti e riprova la lettura esterna.",
      className: primary ? "" : "fallback"
    };
  }

  function sanitizeGoldUiText(root = document.getElementById("root")) {
    if (!root) return;
    const replacements = new Map([
      ["Universal Core Decision Engine", "AI Gold - Core/Nyra server"],
      ["Universal Core Read-only", "Core server sola lettura"],
      ["Core server read-only", "Core server sola lettura"],
      ["Customer Intelligence Core", "Lettura clienti Core"],
      ["Core + Nyra + OpenAI", "AI Gold - Core/Nyra server"],
      ["Core/Nyra Render", "Core/Nyra server"],
      ["Core Render", "Core server"],
      ["Nyra Render", "Nyra server"],
      ["Nessuna priorità urgente", "Cosa manca / cosa controllare"],
      ["Nessuna priorita urgente", "Cosa manca / cosa controllare"],
      ["Nessuna priorità principale disponibile.", "Prossima azione: completa i dati mancanti e rileggi il centro."],
      ["Nessuna azione secondaria prioritaria.", "Controlla dati, cassa, agenda e costi prima di cercare altre azioni."],
      ["Non ci sono priorità urgenti da mostrare.", "Non ci sono urgenze forti: controlla cosa manca e la prossima azione manuale."],
      ["Gold continua a leggere il centro e riapparirà solo quando serve un'azione.", "Gold resta attivo: se mancano dati, mostra cosa completare; se i dati sono coerenti, indica la prossima verifica utile."],
      ["Centro sotto controllo", "Centro letto da Smart Desk"],
      ["AI priority alerts", "AI Gold - cosa fare ora"]
    ]);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      let text = node.nodeValue || "";
      replacements.forEach((to, from) => {
        if (text.includes(from)) text = text.split(from).join(to);
      });
      node.nodeValue = text;
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
    const primaryText = cleanDisplayText(primary?.label || primary?.suggestedAction || summary.primaryActionLabel || summary.primaryAction, "Prossima azione: completa i dati mancanti e rileggi il centro");
    const actionText = cleanDisplayText(primary?.suggestedAction || summary.firstExternalAction || primary?.action, "Controlla dati, cassa, agenda e costi");
    const explanationText = cleanDisplayText(primary?.explanationShort || context?.explanationShort || summary.title, "Cosa manca: verifica dati economici, costi servizi/operatori, agenda e cassa prima della prossima decisione.");
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
          <div class="gold-bridge-title">AI Gold - cosa fare ora</div>
          <div class="gold-bridge-subtitle">Il gestionale dice cosa sta succedendo. AI Gold dice cosa fare, cosa manca e quale controllo aprire.</div>
        </div>
        <div class="gold-bridge-pill">${riskLabel(risk.band)}</div>
      </div>
      <div class="gold-bridge-grid">
        <div class="gold-bridge-metric" data-gold-route="${primaryRoute}" role="button" tabindex="0" aria-label="Apri modulo collegato alla priorita AI">
          <div class="gold-bridge-label">Prossima azione</div>
          <div class="gold-bridge-value">${escapeHtml(primaryText)}</div>
        </div>
        <div class="gold-bridge-metric" data-gold-route="/ai-gold" role="button" tabindex="0" aria-label="Apri AI Gold">
          <div class="gold-bridge-label">Fonte</div>
          <div class="gold-bridge-value">${source.primary ? "Core/Nyra server" : "Fallback dati"}</div>
        </div>
        <div class="gold-bridge-metric" data-gold-route="${actionRoute}" role="button" tabindex="0" aria-label="Apri azione suggerita da AI Gold">
          <div class="gold-bridge-label">Cosa controllare</div>
          <div class="gold-bridge-value">${escapeHtml(actionText)}</div>
        </div>
      </div>
      <div class="gold-bridge-list">
        <div class="gold-bridge-item" data-gold-route="${explanationRoute}" role="button" tabindex="0" aria-label="Apri dettaglio operativo collegato">
          <div class="gold-bridge-item-title">${escapeHtml(explanationText)}</div>
          <div class="gold-bridge-item-subtitle">Dominio: ${primary?.domain || "centro"} · rischio ${(Number(risk.score || 0)).toFixed(2)} · provider ${escapeHtml(source.provider)}</div>
        </div>
        ${secondary.slice(0, 3).map((item) => `
          <div class="gold-bridge-item" data-gold-route="${routeForGoldAction(item.action, item.domain, item)}" role="button" tabindex="0" aria-label="Apri priorita secondaria">
            <div class="gold-bridge-item-title">${item.label || item.domain || "Priorita secondaria"}</div>
            <div class="gold-bridge-item-subtitle">Dominio: ${item.domain || "centro"} · punteggio ${(Number(item.score || 0)).toFixed(2)}</div>
          </div>
        `).join("")}
        ${blocked.length ? `
          <div class="gold-bridge-item" data-gold-route="/settings" role="button" tabindex="0" aria-label="Apri impostazioni per azioni bloccate">
            <div class="gold-bridge-item-title">Azioni bloccate</div>
            <div class="gold-bridge-item-subtitle">${blocked.map((item) => escapeHtml(item.label || item.domain || item)).join(" · ")}</div>
          </div>
        ` : ""}
        ${changeImpact?.enabled ? `
          <div class="gold-bridge-item" data-gold-route="/ai-gold" role="button" tabindex="0" aria-label="Apri AI Gold per effetto domino">
            <div class="gold-bridge-item-title">Effetto domino attivo</div>
            <div class="gold-bridge-item-subtitle">
              Branch ${escapeHtml(changeImpact.coreBranch || "change_impact_orchestration")} ·
              ${Number(changeImpact.requiredActionsCount || changeImpact.requiredActions?.length || 0)} controlli ·
              ${Number(changeImpact.testsRequiredCount || changeImpact.testsRequired?.length || 0)} test ·
              conferma owner richiesta
            </div>
          </div>
        ` : ""}
        ${customerSchema ? `
          <div class="gold-bridge-item" data-gold-route="/clients" role="button" tabindex="0" aria-label="Apri clienti collegati alla lettura clienti Core">
            <div class="gold-bridge-item-title">Lettura clienti Core</div>
            <div class="gold-bridge-item-subtitle">
              ${customerSchema} · clienti ${Number(localSummary.clients || 0)} · consensi ${Number(readiness?.granted_consent_count ?? localSummary.consents_registered ?? 0)} · invio automatico ${automaticSendAllowed ? "abilitato" : "bloccato"}
            </div>
            <div class="gold-bridge-item-subtitle">Prossima azione: ${nextStep}</div>
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

  function isReportsRoute() {
    return (window.location.pathname || "/") === "/reports";
  }

  function isSurfaceRoute() {
    return ["/services", "/shifts", "/protocols"].includes(window.location.pathname || "/");
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
          <div class="admin-tools-title">Pulizia demo e test</div>
          <div class="admin-tools-subtitle">Strumenti rapidi super admin per togliere tenant demo/test e ripulire il rumore operativo.</div>
        </div>
        <div class="gold-bridge-pill">super admin</div>
      </div>
      <div class="admin-tools-actions">
        <button type="button" class="admin-tools-button" data-admin-action="cleanup-demo-centers">Elimina demo/test tenant</button>
        <button type="button" class="admin-tools-button secondary" data-admin-action="cleanup-test-prefix">Pulisci test STRESS_</button>
      </div>
      <div class="admin-tools-status" data-admin-status>Pronto.</div>
    `;
    panel.addEventListener("click", async (event) => {
      const action = event.target?.getAttribute?.("data-admin-action");
      if (!action) return;
      const status = panel.querySelector("[data-admin-status]");
      status.textContent = "Esecuzione...";
      try {
        if (action === "cleanup-demo-centers") {
          const result = await postJson("/api/admin/cleanup-demo-centers", {});
          status.textContent = `Centri rimossi: ${(result.removedCenters || []).join(", ") || "nessuno"}.`;
        }
        if (action === "cleanup-test-prefix") {
          const result = await postJson("/api/admin/cleanup-test-data", { prefix: "STRESS_" });
          status.textContent = `Cleanup STRESS_ completato.`;
          if (result?.deleted?.users || result?.deleted?.clients) {
            status.textContent += ` Users ${result.deleted.users || 0}, clienti ${result.deleted.clients || 0}.`;
          }
        }
      } catch (error) {
        status.textContent = error.message || String(error);
      }
    });
    return panel;
  }

  function buildEnterpriseSettingsPanel(session, settings) {
    const role = String(session?.role || "owner").toLowerCase();
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
    const panel = document.createElement("section");
    panel.id = ENTERPRISE_SETTINGS_PANEL_ID;
    panel.className = "enterprise-bridge-panel";
    panel.innerHTML = `
      <div class="enterprise-bridge-header">
        <div>
          <div class="enterprise-bridge-title">Configurazione Enterprise attiva</div>
          <div class="enterprise-bridge-subtitle">La shell deve spiegare cosa e attivo, cosa richiede conferma e quale prossima mossa ha senso ora.</div>
        </div>
        <div class="enterprise-bridge-pill">${activeModules} moduli attivi</div>
      </div>
      <div class="enterprise-bridge-grid">
        <div class="enterprise-bridge-card" data-enterprise-card-target="/settings" role="button" tabindex="0" aria-label="Apri impostazioni sessione">
          <div class="enterprise-bridge-card-title">Sessione</div>
          <div class="enterprise-bridge-card-value">${role || "owner"}</div>
          <div class="enterprise-bridge-card-copy">Le azioni sensibili restano confermabili: ${confirmationMode}.</div>
        </div>
        <div class="enterprise-bridge-card" data-enterprise-card-target="/settings" role="button" tabindex="0" aria-label="Apri impostazioni moduli">
          <div class="enterprise-bridge-card-title">Regole accesso</div>
          <div class="enterprise-bridge-card-value">${settings?.profitabilityEnabled !== false ? "redditivita leggibile" : "redditivita bloccata"}</div>
          <div class="enterprise-bridge-card-copy">Quando un modulo non e attivo, la UI deve aprire una guida premium invece di lasciare uno stato vuoto o un errore secco.</div>
        </div>
        <div class="enterprise-bridge-card" data-enterprise-card-target="/settings" role="button" tabindex="0" aria-label="Apri prossima azione impostazioni">
          <div class="enterprise-bridge-card-title">Prossima mossa</div>
          <div class="enterprise-bridge-card-value">Controlla moduli, sessione e coerenza testi</div>
          <div class="enterprise-bridge-card-copy">Se il centro non puo agire, la vista deve indicare il prossimo passo: piano, impostazioni o ruolo corretto.</div>
        </div>
      </div>
    `;
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
          <div class="enterprise-bridge-title">Lettura report piu chiara</div>
          <div class="enterprise-bridge-subtitle">Lo stato selezionato deve restare visibile anche con dati a zero: giorno, settimana e mese non possono sembrare uguali.</div>
        </div>
        <div class="enterprise-bridge-pill">vista ${activePeriod}</div>
      </div>
      <div class="enterprise-bridge-grid">
        <div class="enterprise-bridge-card" data-enterprise-card-target="/reports" role="button" tabindex="0" aria-label="Apri report periodo attivo">
          <div class="enterprise-bridge-card-title">Periodo attivo</div>
          <div class="enterprise-bridge-card-value">${activePeriod}</div>
          <div class="enterprise-bridge-card-copy">La selezione attiva deve essere leggibile subito sopra numeri e liste.</div>
        </div>
        <div class="enterprise-bridge-card" data-enterprise-card-target="/cashdesk" role="button" tabindex="0" aria-label="Apri cassa per verificare dati zero">
          <div class="enterprise-bridge-card-title">Se i dati sono zero</div>
          <div class="enterprise-bridge-card-value">non deve sembrare silenzio</div>
          <div class="enterprise-bridge-card-copy">La UI deve spiegare se mancano attivita, cassa o semplicemente volume nel periodo selezionato.</div>
        </div>
        <div class="enterprise-bridge-card" data-enterprise-card-target="/appointments" role="button" tabindex="0" aria-label="Apri agenda per azione utile">
          <div class="enterprise-bridge-card-title">Azione utile</div>
          <div class="enterprise-bridge-card-value">cambia vista o verifica chiusure</div>
          <div class="enterprise-bridge-card-copy">Se il giorno e vuoto, prova settimana o mese; se e tutto vuoto, controlla agenda, cassa e collegamenti servizio-operatore.</div>
        </div>
      </div>
    `;
    bindBridgeNavigation(panel);
    return panel;
  }

  function buildEnterpriseSurfacePanel(route) {
    const config = {
      "/services": {
        title: "Servizi separati con piu chiarezza",
        subtitle: "Catalogo, staff e risorse devono essere letti come superfici diverse dello stesso sistema.",
        actions: [
          { label: "Catalogo", href: "/services", active: true },
          { label: "Turni", href: "/shifts" },
          { label: "Protocolli", href: "/protocols" }
        ],
        cards: [
          ["Catalogo", "Tieni allineati prezzo, durata e categoria.", "/services"],
          ["Staff", "Se manca lo staff, la shell deve dirlo in modo utile.", "/services"],
          ["Risorse", "Tecnologie e stanze vanno lette come vincoli operativi.", "/services"]
        ]
      },
      "/shifts": {
        title: "Turni leggibili a blocchi",
        subtitle: "Calendario, presenze e modelli devono essere separati meglio nelle schermate lunghe.",
        actions: [
          { label: "Turni", href: "/shifts", active: true },
          { label: "Servizi", href: "/services" },
          { label: "Protocolli", href: "/protocols" }
        ],
        cards: [
          ["Calendario", "Prima vedi chi lavora oggi e dove ci sono buchi.", "/shifts"],
          ["Presenze", "Poi conferme e controllo operativo.", "/shifts"],
          ["Modelli", "Infine gli schemi riutilizzabili del centro.", "/shifts"]
        ]
      },
      "/protocols": {
        title: "Protocolli con livelli piu chiari",
        subtitle: "Libreria, scheda cliente e bozza AI devono sembrare tre livelli distinti, non una pagina unica lunghissima.",
        actions: [
          { label: "Protocolli", href: "/protocols", active: true },
          { label: "Servizi", href: "/services" },
          { label: "Turni", href: "/shifts" }
        ],
        cards: [
          ["Libreria", "Prima vedi cosa esiste gia e cosa manca.", "/protocols"],
          ["Cliente", "Poi storico, sensibilita e zona.", "/clients"],
          ["Bozza AI", "Solo dopo arrivano suggerimento e conferma operatore.", "/ai-gold"]
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
          <div class="enterprise-bridge-card" data-enterprise-card-target="${target}" role="button" tabindex="0" aria-label="Apri ${title}">
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
    if (!isSettingsRoute() && !isReportsRoute() && !isSurfaceRoute()) {
      runWithMutationLock(removeEnterprisePanels);
      return;
    }
    injectStyle();
    if (isSettingsRoute()) {
      try {
        const [session, settings] = await Promise.all([
          fetchJson("/api/auth/session"),
          fetchJson("/api/settings")
        ]);
        const anchor = findSettingsAnchor();
        if (anchor) {
          const panel = buildEnterpriseSettingsPanel(session, settings);
          const existing = document.getElementById(ENTERPRISE_SETTINGS_PANEL_ID);
          runWithMutationLock(() => {
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
      const anchor = findAnchorByText("Report operativi") || findAnchorByText("Operational reports");
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
    goldRenderTimers = [
      window.setTimeout(renderGoldBridge, 180),
      window.setTimeout(renderGoldBridge, 900)
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
    sanitizeGoldUiText();
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

  function startObserver() {
    if (observerStarted) return;
    const root = document.getElementById("root");
    if (!root) {
      window.setTimeout(startObserver, 120);
      return;
    }
    observer.observe(root, { childList: true, subtree: true });
    observerStarted = true;
  }

  startObserver();
  scheduleRender();
})();
