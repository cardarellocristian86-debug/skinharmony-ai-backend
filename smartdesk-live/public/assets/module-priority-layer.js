(function () {
  "use strict";

  var PANEL_ID = "skinharmony-module-priority-panel";
  var COST_MINUTE_PANEL_ID = "skinharmony-gold-cost-minute-panel";
  var STYLE_ID = "skinharmony-module-priority-style";
  var currentSignature = "";
  var refreshTimer = null;
  var observer = null;
  var cachedItems = [];
  var cachedModulePath = "";
  var lastFetchAt = 0;

  var MODULES = [
    {
      path: "/services",
      label: "Priorita servizi e operatori",
      targets: ["services"],
      focuses: ["service-costs", "staff-costs"],
      sections: ["profitability", "performance", "data_quality"]
    },
    {
      path: "/profitability",
      label: "Priorita redditivita",
      targets: ["profitability"],
      focuses: ["profitability", "service-costs", "staff-costs"],
      sections: ["profitability"]
    },
    {
      path: "/inventory",
      label: "Priorita magazzino",
      targets: ["inventory", "stock"],
      focuses: ["low-stock", "stock", "inventory"],
      sections: ["inventory", "hidden"]
    },
    {
      path: "/marketing",
      label: "Priorita marketing",
      targets: ["marketing", "clients"],
      focuses: ["recall", "marketing", "client-recall"],
      sections: ["marketing", "hidden"]
    },
    {
      path: "/appointments",
      label: "Priorita agenda",
      targets: ["appointments", "agenda"],
      focuses: ["appointments", "agenda", "booking"],
      sections: ["daily", "booking"]
    },
    {
      path: "/cashdesk",
      label: "Priorita cassa",
      targets: ["cashdesk", "cash", "payments"],
      focuses: ["cashdesk", "cash", "payments"],
      sections: ["cashdesk", "payments"]
    },
    {
      path: "/clients",
      label: "Priorita clienti",
      targets: ["clients"],
      focuses: ["clients", "client-recall"],
      sections: ["marketing", "clients"]
    },
    {
      path: "/shifts",
      label: "Priorita turni",
      targets: ["shifts", "staff"],
      focuses: ["shifts", "staff-costs", "staff"],
      sections: ["performance", "staff"]
    }
  ];

  function getToken() {
    try {
      return localStorage.getItem("skinharmony-web-token") || "";
    } catch (error) {
      return "";
    }
  }

  function headers() {
    var token = getToken();
    return token ? { Authorization: "Bearer " + token } : {};
  }

  function text(value) {
    return String(value == null ? "" : value);
  }

  function lower(value) {
    return text(value).toLowerCase();
  }

  function currentModule() {
    var path = window.location.pathname.replace(/\/+$/, "") || "/";
    return MODULES.find(function (module) {
      return path === module.path || path.indexOf(module.path + "/") === 0;
    }) || null;
  }

  function strongest(a, b) {
    return a === "critical" || b === "critical" ? "critical" : "warning";
  }

  function severityOf(item) {
    var haystack = [
      item.level,
      item.severity,
      item.priority,
      item.status,
      item.urgency,
      item.actionType,
      item.sectionKey,
      item.id,
      item.title,
      item.label,
      item.description
    ].map(lower).join(" ");

    if (
      /critical|critico|alta|high|urgent|urgente|act_now|primary|executive|blocco|sottosoglia/.test(haystack)
    ) {
      return "critical";
    }

    return "warning";
  }

  function itemTitle(item) {
    return text(item.displayTitle || item.title || item.label || item.name || item.headline || item.reason || "Priorita da controllare");
  }

  function itemDescription(item) {
    return text(
      item.displayDescription ||
      item.description ||
      item.body ||
      item.message ||
      item.subtitle ||
      item.reason ||
      item.action ||
      item.nextStep ||
      ""
    );
  }

  function rawTitle(item) {
    return text(item.title || item.label || item.name || item.headline || item.reason || item.parentTitle || "");
  }

  function rawDescription(item) {
    return text(
      item.description ||
      item.body ||
      item.message ||
      item.subtitle ||
      item.reason ||
      item.action ||
      item.nextStep ||
      item.suggestedAction ||
      item.explanationShort ||
      item.explanationLong ||
      ""
    );
  }

  function hasInternalLanguage(value) {
    return /core\/nyra|core|nyra|gold engine|modulo corretto|evitare duplicati|legge il centro|come fonte|sorgente|snapshot|decision/i.test(text(value));
  }

  function userFacingCopy(item, module) {
    var focus = lower(item.targetFocus || item.focus || item.anchor);
    var target = lower(item.target || item.module || item.route);
    var section = lower(item.sectionKey || item.section || item.category);
    var raw = lower(rawTitle(item) + " " + rawDescription(item) + " " + text(item.parentTitle));
    var copy = {
      title: rawTitle(item) || "Priorita da controllare",
      description: rawDescription(item) || "Apri il blocco evidenziato e completa il dato richiesto."
    };

    if (/service-costs/.test(focus) || (/servizi|servizio/.test(raw) && /costi|costo|redditiv/.test(raw))) {
      copy.title = "Completa costi servizi";
      copy.description = "Inserisci costo prodotto, durata e consumo sui servizi indicati: finche mancano, margini e redditivita non sono affidabili.";
    } else if (/staff-costs/.test(focus) || (/operatori|staff|operatore/.test(raw) && /costi|costo|resa|performance/.test(raw))) {
      copy.title = "Completa costi operatori";
      copy.description = "Controlla costo orario e ruolo degli operatori: senza questi dati la resa del centro resta parziale.";
    } else if (/low-stock/.test(focus) || /sottoscorta|sotto soglia|stock|magazzino/.test(raw)) {
      copy.title = "Prepara riordino stock";
      copy.description = "Questo articolo e sotto soglia: verifica giacenza reale e prepara carico o riordino prima che blocchi il lavoro.";
    } else if (target === "marketing" || /cliente|clienti|recall|richiamare|recuperare|alto valore/.test(raw)) {
      copy.title = "Lavora clienti prioritari";
      copy.description = "Parti dai clienti con piu valore o rischio di perdita: apri marketing, verifica consenso e prepara il contatto.";
    } else if (target === "cashdesk" || /cassa|pagamenti|incassi|pagamento/.test(raw)) {
      copy.title = "Sistema cassa e pagamenti";
      copy.description = "Controlla pagamenti non collegati e appuntamenti senza incasso prima di leggere i report.";
    } else if (target === "appointments" || /agenda|appuntamenti|slot/.test(raw)) {
      copy.title = "Riempi agenda";
      copy.description = "Controlla slot liberi e appuntamenti deboli: prima aumenta volume e continuita, poi ottimizza i margini.";
    } else if (target === "profitability" || section === "profitability" || module.path === "/profitability") {
      copy.title = "Controlla margini";
      copy.description = "Apri il dettaglio redditivita e verifica i servizi che assorbono margine prima di spingerli in vendita.";
    }

    if (hasInternalLanguage(copy.title) || hasInternalLanguage(copy.description)) {
      if (module.path === "/profitability") {
        copy.title = "Controlla margini";
        copy.description = "Apri il dettaglio redditivita e lavora prima i servizi con dati incompleti o margine debole.";
      } else if (module.path === "/services") {
        copy.title = "Completa configurazione servizi";
        copy.description = "Sistema prezzo, durata, costo e operatori nei servizi evidenziati: poi la lettura economica diventa affidabile.";
      } else if (module.path === "/inventory") {
        copy.title = "Controlla stock";
        copy.description = "Verifica gli articoli evidenziati e prepara il movimento necessario.";
      } else if (module.path === "/marketing" || module.path === "/clients") {
        copy.title = "Lavora clienti prioritari";
        copy.description = "Apri la lista clienti e parti dai contatti piu utili per oggi.";
      } else {
        copy.title = "Azione prioritaria";
        copy.description = "Apri il blocco evidenziato e completa il controllo richiesto.";
      }
    }

    return {
      ...item,
      displayTitle: copy.title,
      displayDescription: copy.description
    };
  }

  function normalizeAction(action, parent, source, sectionKey, sectionTitle) {
    var normalized = Object.assign({}, parent || {}, action || {});
    normalized.source = source;
    normalized.sectionKey = sectionKey || normalized.sectionKey || "";
    normalized.sectionTitle = sectionTitle || normalized.sectionTitle || "";
    normalized.parentTitle = parent ? itemTitle(parent) : "";
    normalized.target = normalized.target || normalized.module || normalized.route || "";
    normalized.targetFocus = normalized.targetFocus || normalized.focus || normalized.anchor || "";
    return normalized;
  }

  function flattenSections(payload, source) {
    var items = [];
    var sections = Array.isArray(payload && payload.sections) ? payload.sections : [];

    sections.forEach(function (section) {
      var sectionKey = text(section.key || section.id || section.slug || "");
      var sectionTitle = text(section.title || section.label || section.name || "");
      var sectionItems = Array.isArray(section.items) ? section.items : [];
      var sectionActions = Array.isArray(section.actions) ? section.actions : [];

      sectionItems.forEach(function (item) {
        var normalized = normalizeAction(item, null, source, sectionKey, sectionTitle);
        items.push(normalized);
        (Array.isArray(item.actions) ? item.actions : []).forEach(function (action) {
          items.push(normalizeAction(action, item, source, sectionKey, sectionTitle));
        });
      });

      sectionActions.forEach(function (action) {
        items.push(normalizeAction(action, null, source, sectionKey, sectionTitle));
      });
    });

    ["items", "priorities", "alerts", "actions"].forEach(function (key) {
      (Array.isArray(payload && payload[key]) ? payload[key] : []).forEach(function (item) {
        items.push(normalizeAction(item, null, source, text(item.sectionKey || key), ""));
      });
    });

    return items;
  }

  function belongsToModule(item, module) {
    var target = lower(item.target || item.module || item.route);
    var focus = lower(item.targetFocus || item.focus || item.anchor);
    var section = lower(item.sectionKey || item.section || item.category);
    var title = lower(itemTitle(item) + " " + itemDescription(item) + " " + text(item.parentTitle));

    if (module.targets.some(function (value) { return target === value || target.indexOf(value) >= 0; })) return true;
    if (module.focuses.some(function (value) { return focus === value || focus.indexOf(value) >= 0; })) return true;
    if (module.sections.some(function (value) { return section === value || section.indexOf(value) >= 0; })) return true;

    if (module.path === "/services") {
      return /servizi|servizio|operatori|operatore|costi servizio|costo servizio|staff/.test(title);
    }
    if (module.path === "/profitability") {
      return /redditiv|margine|margini|costo|utile|perdita|sottocosto/.test(title);
    }
    if (module.path === "/inventory") {
      return /stock|magazzino|sottoscorta|giacenza|carico/.test(title);
    }
    if (module.path === "/marketing" || module.path === "/clients") {
      return /marketing|recall|cliente|clienti|richiamare|rischio/.test(title);
    }

    return false;
  }

  function dedupe(items, module) {
    var map = new Map();
    items.forEach(function (item) {
      var normalized = module ? userFacingCopy(item, module) : item;
      var key = [
        lower(normalized.target),
        lower(normalized.targetFocus),
        lower(normalized.displayTitle || itemTitle(normalized))
      ].join("|");
      var previous = map.get(key);
      var severity = severityOf(normalized);
      if (!previous) {
        normalized.moduleSeverity = severity;
        map.set(key, normalized);
        return;
      }
      previous.moduleSeverity = strongest(previous.moduleSeverity, severity);
      if (!previous.displayDescription && normalized.displayDescription) previous.displayDescription = normalized.displayDescription;
    });
    return Array.from(map.values()).sort(function (a, b) {
      if (a.moduleSeverity === b.moduleSeverity) return 0;
      return a.moduleSeverity === "critical" ? -1 : 1;
    });
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "#"+PANEL_ID+"{margin:18px 0 22px;padding:18px;border:1px solid rgba(114,189,212,.28);border-radius:22px;background:linear-gradient(180deg,#ffffff,#f7fcff);box-shadow:0 18px 40px rgba(36,90,120,.08)}",
      "#"+PANEL_ID+" .module-priority-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}",
      "#"+PANEL_ID+" .module-priority-kicker{font-size:12px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#4f83bf}",
      "#"+PANEL_ID+" .module-priority-title{font-size:24px;line-height:1.05;font-weight:900;color:#26394e}",
      "#"+PANEL_ID+" .module-priority-count{padding:8px 14px;border-radius:999px;font-weight:900;background:#edf9f5;color:#397a56;border:1px solid rgba(72,160,110,.2);white-space:nowrap}",
      "#"+PANEL_ID+" .module-priority-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}",
      "#"+PANEL_ID+" .module-priority-card{border-radius:18px;padding:14px 16px;border:1px solid rgba(86,150,185,.22);background:#fff;box-shadow:0 10px 24px rgba(35,65,100,.06)}",
      "#"+PANEL_ID+" .module-priority-card.priority-critical{border-color:rgba(200,72,72,.58);background:linear-gradient(180deg,#fff9f9,#ffecec);box-shadow:0 16px 34px rgba(200,72,72,.16)}",
      "#"+PANEL_ID+" .module-priority-card.priority-warning{border-color:rgba(210,154,55,.58);background:linear-gradient(180deg,#fffdf6,#fff1cf);box-shadow:0 14px 30px rgba(210,154,55,.14)}",
      "#"+PANEL_ID+" .module-priority-card strong{display:block;font-size:17px;line-height:1.15;margin-bottom:7px;color:#26394e}",
      "#"+PANEL_ID+" .module-priority-card p{margin:0;color:#6d7f94;font-size:14px;line-height:1.35}",
      "#"+PANEL_ID+" .module-priority-card.priority-critical strong{color:#9f2f2f}",
      "#"+PANEL_ID+" .module-priority-card.priority-warning strong{color:#7a5a20}",
      "#"+PANEL_ID+" .module-priority-badge{display:inline-flex;margin-bottom:9px;padding:4px 9px;border-radius:999px;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}",
      "#"+PANEL_ID+" .priority-critical .module-priority-badge{background:#ffe0e0;color:#9f2f2f}",
      "#"+PANEL_ID+" .priority-warning .module-priority-badge{background:#ffe9a8;color:#7a5a20}",
      "#"+COST_MINUTE_PANEL_ID+"{margin:18px 0 22px;padding:20px;border:1px solid rgba(200,72,72,.46);border-radius:22px;background:linear-gradient(180deg,#fffafa,#fff0f0);box-shadow:0 18px 40px rgba(200,72,72,.13)}",
      "#"+COST_MINUTE_PANEL_ID+" .cost-minute-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:14px}",
      "#"+COST_MINUTE_PANEL_ID+" .cost-minute-kicker{font-size:12px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#b24646}",
      "#"+COST_MINUTE_PANEL_ID+" .cost-minute-title{font-size:24px;line-height:1.08;font-weight:900;color:#26394e}",
      "#"+COST_MINUTE_PANEL_ID+" .cost-minute-subtitle{margin-top:5px;color:#6d7f94;font-size:14px;line-height:1.35}",
      "#"+COST_MINUTE_PANEL_ID+" .cost-minute-pill{padding:8px 13px;border-radius:999px;font-weight:900;background:#ffe1e1;color:#9f2f2f;border:1px solid rgba(200,72,72,.18);white-space:nowrap}",
      "#"+COST_MINUTE_PANEL_ID+" .cost-minute-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:14px 0}",
      "#"+COST_MINUTE_PANEL_ID+" .cost-minute-stat{border-radius:16px;border:1px solid rgba(86,150,185,.18);background:#fff;padding:13px 14px}",
      "#"+COST_MINUTE_PANEL_ID+" .cost-minute-stat span{display:block;font-size:12px;font-weight:800;color:#6d7f94;margin-bottom:5px}",
      "#"+COST_MINUTE_PANEL_ID+" .cost-minute-stat strong{font-size:23px;line-height:1;color:#26394e}",
      "#"+COST_MINUTE_PANEL_ID+" .cost-minute-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:12px}",
      "#"+COST_MINUTE_PANEL_ID+" label{display:grid;gap:5px;font-size:12px;font-weight:800;color:#4e6178}",
      "#"+COST_MINUTE_PANEL_ID+" input{width:100%;box-sizing:border-box;border:1px solid rgba(86,150,185,.25);border-radius:12px;padding:10px 11px;font:inherit;color:#26394e;background:#fff}",
      "#"+COST_MINUTE_PANEL_ID+" .cost-minute-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px}",
      "#"+COST_MINUTE_PANEL_ID+" button{border:1px solid rgba(86,150,185,.28);border-radius:14px;padding:10px 14px;font-weight:900;color:#2d78ad;background:#f8fdff;cursor:pointer}",
      "#"+COST_MINUTE_PANEL_ID+" button.cost-minute-save{background:#77c2d7;color:#fff;border-color:#77c2d7}",
      "#"+COST_MINUTE_PANEL_ID+" .cost-minute-note{font-size:13px;color:#6d7f94;line-height:1.35}",
      "#"+COST_MINUTE_PANEL_ID+" .cost-minute-missing{margin-top:10px;border-radius:14px;border:1px dashed rgba(200,72,72,.35);background:#fff8f8;padding:10px 12px;color:#9f2f2f;font-weight:800}",
      ".module-priority-target-critical{border-color:rgba(200,72,72,.72)!important;background:linear-gradient(180deg,#fff8f8,#ffe8e8)!important;box-shadow:0 20px 42px rgba(200,72,72,.22)!important}",
      ".module-priority-target-warning{border-color:rgba(210,154,55,.68)!important;background:linear-gradient(180deg,#fffdf4,#fff1c9)!important;box-shadow:0 18px 38px rgba(210,154,55,.2)!important}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function clearHighlights() {
    document.querySelectorAll(".module-priority-target-critical,.module-priority-target-warning").forEach(function (node) {
      node.classList.remove("module-priority-target-critical", "module-priority-target-warning");
    });
  }

  function pageHost() {
    return (
      document.querySelector(".content-area") ||
      document.querySelector(".app-main") ||
      document.querySelector("main") ||
      document.querySelector("#root > div") ||
      document.getElementById("root")
    );
  }

  function cents(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function eurosToCents(value) {
    var normalized = text(value).replace(/\./g, "").replace(",", ".");
    var number = Number(normalized);
    return Number.isFinite(number) ? Math.round(number * 100) : 0;
  }

  function centsToEuros(value) {
    return (cents(value) / 100).toLocaleString("it-IT", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function money(value) {
    return centsToEuros(value) + " €";
  }

  function fixedProfileValue(profile, key) {
    var value = profile && profile[key];
    return centsToEuros(cents(value));
  }

  function costMinute(profile) {
    var fixed = profile && profile.fixedCostProfile ? profile.fixedCostProfile : {};
    var workingDays = Math.max(1, Number(fixed.workingDaysMonthly || 24));
    var operatingHours = Math.max(1, Number(fixed.operatingHoursDaily || 8));
    var minutes = workingDays * operatingHours * 60;
    return {
      minutes: minutes,
      centsPerMinute: minutes > 0 ? cents(profile && profile.totalMonthlyBaselineCents) / minutes : 0,
      workingDays: workingDays,
      operatingHours: operatingHours
    };
  }

  function renderCostMinutePanel(overview) {
    injectStyle();
    var oldPanel = document.getElementById(COST_MINUTE_PANEL_ID);
    if (oldPanel) oldPanel.remove();

    var module = currentModule();
    if (!module || module.path !== "/profitability") return;

    var profile = overview && overview.operatingCostMinuteProfile;
    if (!profile) return;

    var fixed = profile.fixedCostProfile || {};
    var minute = costMinute(profile);
    var missing = Array.isArray(profile.missing) ? profile.missing : [];
    var panel = document.createElement("section");
    panel.id = COST_MINUTE_PANEL_ID;
    panel.innerHTML =
      '<div class="cost-minute-head">' +
        '<div><div class="cost-minute-kicker">Gold · controllo costi fissi</div>' +
        '<div class="cost-minute-title">Costo minuto centro Gold</div>' +
        '<div class="cost-minute-subtitle">Usa operatori, tecnologie, prodotti e costi fissi. Se manca un dato, il report resta attivo ma lo segnala.</div></div>' +
        '<div class="cost-minute-pill"></div>' +
      '</div>' +
      '<div class="cost-minute-grid">' +
        '<div class="cost-minute-stat"><span>Dal gestionale</span><strong data-cost="existing"></strong></div>' +
        '<div class="cost-minute-stat"><span>Fissi generali</span><strong data-cost="manual"></strong></div>' +
        '<div class="cost-minute-stat"><span>Totale mese</span><strong data-cost="total"></strong></div>' +
        '<div class="cost-minute-stat"><span>Minuti mese</span><strong data-cost="minutes"></strong></div>' +
      '</div>' +
      '<div class="cost-minute-form">' +
        '<label>Giorni lavorativi mese<input inputmode="decimal" data-fixed="workingDaysMonthly" /></label>' +
        '<label>Ore operative giorno<input inputmode="decimal" data-fixed="operatingHoursDaily" /></label>' +
        '<label>Affitto mensile<input inputmode="decimal" data-fixed="rent" /></label>' +
        '<label>Corrente / energia<input inputmode="decimal" data-fixed="utilitiesPower" /></label>' +
        '<label>Acqua / gas<input inputmode="decimal" data-fixed="utilitiesWaterGas" /></label>' +
        '<label>Commercialista<input inputmode="decimal" data-fixed="accountant" /></label>' +
        '<label>Assicurazioni<input inputmode="decimal" data-fixed="insurance" /></label>' +
        '<label>Software / gestionali<input inputmode="decimal" data-fixed="software" /></label>' +
        '<label>Marketing fisso<input inputmode="decimal" data-fixed="marketing" /></label>' +
        '<label>Altro fisso<input inputmode="decimal" data-fixed="otherFixedCosts" /></label>' +
      '</div>' +
      '<div class="cost-minute-actions">' +
        '<button type="button" class="cost-minute-save">Salva costi fissi</button>' +
        '<span class="cost-minute-note">Operatori, prodotti e tecnologie vengono letti dai moduli gia compilati. Qui completi solo i fissi generali.</span>' +
      '</div>' +
      '<div class="cost-minute-missing" hidden></div>';

    panel.querySelector(".cost-minute-pill").textContent = money(minute.centsPerMinute) + " / minuto";
    panel.querySelector('[data-cost="existing"]').textContent = money(profile.existingMonthlyCents);
    panel.querySelector('[data-cost="manual"]').textContent = money(profile.manualFixedMonthlyCents);
    panel.querySelector('[data-cost="total"]').textContent = money(profile.totalMonthlyBaselineCents);
    panel.querySelector('[data-cost="minutes"]').textContent = Math.round(minute.minutes).toLocaleString("it-IT");

    panel.querySelectorAll("[data-fixed]").forEach(function (input) {
      var key = input.getAttribute("data-fixed");
      if (key === "workingDaysMonthly" || key === "operatingHoursDaily") {
        input.value = text(fixed[key] || (key === "workingDaysMonthly" ? 24 : 8));
      } else {
        input.value = fixedProfileValue(fixed, key);
      }
    });

    var missingBox = panel.querySelector(".cost-minute-missing");
    if (missing.length) {
      missingBox.hidden = false;
      missingBox.textContent = "Da completare: " + missing.join(", ");
    }

    panel.querySelector(".cost-minute-save").addEventListener("click", function () {
      var nextProfile = {};
      panel.querySelectorAll("[data-fixed]").forEach(function (input) {
        var key = input.getAttribute("data-fixed");
        if (key === "workingDaysMonthly" || key === "operatingHoursDaily") {
          var number = Number(text(input.value).replace(",", "."));
          if (Number.isFinite(number) && number > 0) nextProfile[key] = number;
        } else {
          nextProfile[key] = eurosToCents(input.value);
        }
      });

      fetch("/api/center", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, headers()),
        credentials: "same-origin",
        body: JSON.stringify({ goldFixedCostProfile: nextProfile })
      }).then(function (response) {
        if (!response.ok) throw new Error("save_failed");
        cachedModulePath = "";
        lastFetchAt = 0;
        currentSignature = "";
        scheduleRefresh();
      }).catch(function () {
        missingBox.hidden = false;
        missingBox.textContent = "Salvataggio non riuscito. Riprova o verifica la sessione.";
      });
    });

    var priorityPanel = document.getElementById(PANEL_ID);
    if (priorityPanel && priorityPanel.parentNode) {
      priorityPanel.parentNode.insertBefore(panel, priorityPanel.nextSibling);
      return;
    }

    var host = pageHost();
    if (host) host.prepend(panel);
  }

  function renderPanel(module, items) {
    injectStyle();
    var oldPanel = document.getElementById(PANEL_ID);
    if (oldPanel) oldPanel.remove();
    if (!items.length) return;

    var panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.innerHTML =
      '<div class="module-priority-head">' +
        '<div><div class="module-priority-kicker">Priorita del modulo</div>' +
        '<div class="module-priority-title"></div></div>' +
        '<div class="module-priority-count"></div>' +
      '</div>' +
      '<div class="module-priority-grid"></div>';

    panel.querySelector(".module-priority-title").textContent = module.label;
    var displayItems = items.slice(0, 6);
    panel.querySelector(".module-priority-count").textContent = displayItems.length + (displayItems.length === 1 ? " voce" : " voci");

    var grid = panel.querySelector(".module-priority-grid");
    displayItems.forEach(function (item) {
      var severity = item.moduleSeverity || severityOf(item);
      var card = document.createElement("article");
      card.className = "module-priority-card priority-" + severity;
      card.innerHTML =
        '<span class="module-priority-badge"></span>' +
        '<strong></strong>' +
        '<p></p>';
      card.querySelector(".module-priority-badge").textContent = severity === "critical" ? "Critico" : "Da controllare";
      card.querySelector("strong").textContent = itemTitle(item);
      card.querySelector("p").textContent = itemDescription(item) || text(item.sectionTitle || item.parentTitle || "Apri il blocco evidenziato e completa il dato richiesto.");
      grid.appendChild(card);
    });

    var host = pageHost();
    if (!host) return;
    var firstUseful = Array.from(host.children).find(function (child) {
      return child.id !== PANEL_ID && child.offsetParent !== null;
    });
    if (firstUseful && firstUseful.parentNode === host) {
      host.insertBefore(panel, firstUseful.nextSibling || null);
    } else {
      host.prepend(panel);
    }
  }

  function markNode(node, severity) {
    if (!node) return;
    node.classList.remove("module-priority-target-critical", "module-priority-target-warning");
    node.classList.add(severity === "critical" ? "module-priority-target-critical" : "module-priority-target-warning");
  }

  function hasFocus(items, focus) {
    return items.some(function (item) {
      return lower(item.targetFocus || item.focus || item.anchor).indexOf(focus) >= 0;
    });
  }

  function strongestSeverity(items, fallback) {
    return items.reduce(function (severity, item) {
      return strongest(severity, item.moduleSeverity || severityOf(item));
    }, fallback || "warning");
  }

  function applyServiceHighlights(items) {
    var serviceItems = items.filter(function (item) {
      return /service-costs|profitability/.test(lower(item.targetFocus || item.focus || item.anchor || item.sectionKey || ""));
    });
    var staffItems = items.filter(function (item) {
      return /staff-costs|performance|staff/.test(lower(item.targetFocus || item.focus || item.anchor || item.sectionKey || ""));
    });
    var serviceSeverity = strongestSeverity(serviceItems, "warning");
    var staffSeverity = strongestSeverity(staffItems, "warning");

    document.querySelectorAll(".list-item.static, .list-item, article, .sh-card").forEach(function (node) {
      var body = lower(node.innerText || node.textContent || "");
      if (serviceItems.length && /sottocosto|correggere|controllare|completa costo|costo mancante|0,00|senza costo|senza prodotto|senza tecnologia/.test(body)) {
        markNode(node, serviceSeverity);
      }
      if (staffItems.length && /operatore|staff|team|costo orario|postazione/.test(body) && /0,00|mancante|completa|controllare/.test(body)) {
        markNode(node, staffSeverity);
      }
    });
  }

  function applyGenericHighlights(module, items) {
    var severity = strongestSeverity(items, "warning");
    var terms = [];

    items.forEach(function (item) {
      [item.targetFocus, item.focus, item.anchor, itemTitle(item)].forEach(function (value) {
        lower(value).split(/[^a-z0-9àèéìòù]+/).forEach(function (part) {
          if (part.length > 5 && terms.indexOf(part) < 0) terms.push(part);
        });
      });
    });

    if (!terms.length) return;
    document.querySelectorAll(".list-item.static, .list-item, article, .sh-card").forEach(function (node) {
      var body = lower(node.innerText || node.textContent || "");
      var matched = terms.some(function (term) { return body.indexOf(term) >= 0; });
      if (matched) markNode(node, severity);
    });
  }

  function applyHighlights(module, items) {
    clearHighlights();
    if (!items.length) return;
    if (module.path === "/services") {
      applyServiceHighlights(items);
      return;
    }
    applyGenericHighlights(module, items);
  }

  function fetchJson(path) {
    return fetch(path + (path.indexOf("?") >= 0 ? "&" : "?") + "modulePriorityTs=" + Date.now(), {
      headers: headers(),
      credentials: "same-origin"
    }).then(function (response) {
      if (!response.ok) return null;
      return response.json();
    }).catch(function () {
      return null;
    });
  }

  function buildItems(payloads, module) {
    var allItems = [];
    payloads.forEach(function (entry) {
      if (!entry.payload) return;
      allItems = allItems.concat(flattenSections(entry.payload, entry.source));
    });
    return dedupe(allItems.filter(function (item) {
      return belongsToModule(item, module);
    }), module);
  }

  function refresh() {
    var module = currentModule();
    if (!module || !getToken()) {
      var panel = document.getElementById(PANEL_ID);
      if (panel) panel.remove();
      var costMinutePanel = document.getElementById(COST_MINUTE_PANEL_ID);
      if (costMinutePanel) costMinutePanel.remove();
      clearHighlights();
      return;
    }

    var now = Date.now();
    if (cachedModulePath === module.path && cachedItems.length && now - lastFetchAt < 15000) {
      if (!document.getElementById(PANEL_ID)) renderPanel(module, cachedItems);
      applyHighlights(module, cachedItems);
      if (module.path === "/profitability" && !document.getElementById(COST_MINUTE_PANEL_ID)) {
        fetchJson("/api/profitability/overview").then(renderCostMinutePanel);
      }
      return;
    }

    Promise.all([
      fetchJson("/api/ai-gold/decision-center"),
      fetchJson("/api/ai-gold/cockpit"),
      module.path === "/profitability" ? fetchJson("/api/profitability/overview") : Promise.resolve(null)
    ]).then(function (responses) {
      var items = buildItems([
        { source: "decision-center", payload: responses[0] },
        { source: "cockpit", payload: responses[1] }
      ], module);
      cachedItems = items;
      cachedModulePath = module.path;
      lastFetchAt = Date.now();
      var signature = module.path + "|" + window.location.search + "|" + items.map(function (item) {
        return item.moduleSeverity + ":" + itemTitle(item) + ":" + itemDescription(item);
      }).join(";");
      if (signature !== currentSignature) {
        currentSignature = signature;
        renderPanel(module, items);
      }
      renderCostMinutePanel(responses[2]);
      applyHighlights(module, items);
    });
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refresh, 180);
  }

  function hookHistory() {
    ["pushState", "replaceState"].forEach(function (method) {
      var original = history[method];
      history[method] = function () {
        var result = original.apply(this, arguments);
        currentSignature = "";
        scheduleRefresh();
        return result;
      };
    });
    window.addEventListener("popstate", function () {
      currentSignature = "";
      scheduleRefresh();
    });
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(function () {
      scheduleRefresh();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    hookHistory();
    startObserver();
    scheduleRefresh();
    window.addEventListener("focus", scheduleRefresh);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
