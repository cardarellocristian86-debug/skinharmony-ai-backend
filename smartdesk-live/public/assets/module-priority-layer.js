(function () {
  "use strict";

  var PANEL_ID = "skinharmony-module-priority-panel";
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
    return text(item.title || item.label || item.name || item.headline || item.reason || "Priorita da controllare");
  }

  function itemDescription(item) {
    return text(
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

  function dedupe(items) {
    var map = new Map();
    items.forEach(function (item) {
      var key = [
        lower(item.target),
        lower(item.targetFocus),
        lower(item.sectionKey),
        lower(itemTitle(item)),
        lower(itemDescription(item)).slice(0, 80)
      ].join("|");
      var previous = map.get(key);
      var severity = severityOf(item);
      if (!previous) {
        item.moduleSeverity = severity;
        map.set(key, item);
        return;
      }
      previous.moduleSeverity = strongest(previous.moduleSeverity, severity);
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
    panel.querySelector(".module-priority-count").textContent = items.length + (items.length === 1 ? " voce" : " voci");

    var grid = panel.querySelector(".module-priority-grid");
    items.slice(0, 6).forEach(function (item) {
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
    }));
  }

  function refresh() {
    var module = currentModule();
    if (!module || !getToken()) {
      var panel = document.getElementById(PANEL_ID);
      if (panel) panel.remove();
      clearHighlights();
      return;
    }

    var now = Date.now();
    if (cachedModulePath === module.path && cachedItems.length && now - lastFetchAt < 15000) {
      if (!document.getElementById(PANEL_ID)) renderPanel(module, cachedItems);
      applyHighlights(module, cachedItems);
      return;
    }

    Promise.all([
      fetchJson("/api/ai-gold/decision-center"),
      fetchJson("/api/ai-gold/cockpit")
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
