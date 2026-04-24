(function () {
  const SCRIPT_ID = "skinharmony-gold-bridge-style";
  const PANEL_ID = "skinharmony-gold-priority-bridge";
  const ROUTES = new Set(["/", "/dashboard"]);
  const SETTINGS_PANEL_ID = "skinharmony-admin-tools-bridge";
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
    `;
    document.head.appendChild(style);
  }

  function riskLabel(band) {
    if (band === "high") return "Rischio alta";
    if (band === "medium") return "Rischio media";
    return "Rischio bassa";
  }

  function removePanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();
  }

  function removeSettingsPanel() {
    const existing = document.getElementById(SETTINGS_PANEL_ID);
    if (existing) existing.remove();
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
      if (text === "Centro sotto controllo") {
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
      if (text === "Dati centro") {
        let current = node;
        for (let i = 0; i < 5 && current; i += 1) {
          if (current.tagName === "SECTION" || current.classList?.contains("card")) return current;
          current = current.parentElement;
        }
      }
    }
    return root.firstElementChild;
  }

  function buildPanel(context, capabilities) {
    const primary = context?.primaryAction || capabilities?.primaryAction || null;
    const secondary = Array.isArray(context?.secondaryActions) ? context.secondaryActions : [];
    const blocked = Array.isArray(context?.blockedActions) ? context.blockedActions : [];
    const confidence = Number(context?.confidence ?? capabilities?.confidence ?? 0);
    const risk = context?.risk || capabilities?.risk || { score: 0, band: "low" };

    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "gold-bridge-panel";
    panel.innerHTML = `
      <div class="gold-bridge-header">
        <div>
          <div class="gold-bridge-title">Alert prioritari AI</div>
          <div class="gold-bridge-subtitle">Il gestionale dice cosa sta succedendo. AI Gold dice cosa fare.</div>
        </div>
        <div class="gold-bridge-pill">${riskLabel(risk.band)}</div>
      </div>
      <div class="gold-bridge-grid">
        <div class="gold-bridge-metric">
          <div class="gold-bridge-label">Priorità di oggi</div>
          <div class="gold-bridge-value">${primary?.label || "Monitorare il centro"}</div>
        </div>
        <div class="gold-bridge-metric">
          <div class="gold-bridge-label">Confidenza</div>
          <div class="gold-bridge-value">${Math.round(confidence * 100)}%</div>
        </div>
        <div class="gold-bridge-metric">
          <div class="gold-bridge-label">Azione</div>
          <div class="gold-bridge-value">${primary?.action || "MONITOR"}</div>
        </div>
      </div>
      <div class="gold-bridge-list">
        <div class="gold-bridge-item">
          <div class="gold-bridge-item-title">${context?.explanationShort || "Nessuna spiegazione disponibile."}</div>
          <div class="gold-bridge-item-subtitle">Dominio: ${primary?.domain || "center"} · rischio ${(Number(risk.score || 0)).toFixed(2)}</div>
        </div>
        ${secondary.slice(0, 3).map((item) => `
          <div class="gold-bridge-item">
            <div class="gold-bridge-item-title">${item.label || item.domain || "Priorità secondaria"}</div>
            <div class="gold-bridge-item-subtitle">Dominio: ${item.domain || "center"} · score ${(Number(item.score || 0)).toFixed(2)}</div>
          </div>
        `).join("")}
        ${blocked.length ? `
          <div class="gold-bridge-item">
            <div class="gold-bridge-item-title">Azioni bloccate</div>
            <div class="gold-bridge-item-subtitle">${blocked.join(" · ")}</div>
          </div>
        ` : ""}
      </div>
    `;
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
      const [capabilities, context] = await Promise.all([
        fetchJson("/api/ai-gold/capabilities"),
        fetchJson("/api/ai-gold/decision-context")
      ]);
      if (token !== renderToken) return;

      const anchor = findAnchor();
      if (!anchor) return;
      const panel = buildPanel(context, capabilities);
      const existing = document.getElementById(PANEL_ID);
      runWithMutationLock(() => {
        if (existing) {
          existing.replaceWith(panel);
        } else {
          anchor.insertAdjacentElement("afterend", panel);
        }
      });
    } catch (_error) {
      if (!shouldRender()) {
        runWithMutationLock(() => removePanel());
      }
    }
  }

  function isSettingsRoute() {
    return (window.location.pathname || "/") === "/settings";
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

  function scheduleRender() {
    clearTimers(goldRenderTimers);
    clearTimers(settingsRenderTimers);
    goldRenderTimers = [
      window.setTimeout(renderGoldBridge, 180),
      window.setTimeout(renderGoldBridge, 900)
    ];
    settingsRenderTimers = [
      window.setTimeout(renderSettingsTools, 180),
      window.setTimeout(renderSettingsTools, 900)
    ];
  }

  const observer = new MutationObserver(() => {
    if (mutationLockDepth > 0) return;
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
