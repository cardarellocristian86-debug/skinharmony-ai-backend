(function () {
  "use strict";

  var ROOT_ID = "nyra-gold-chat-layer";
  var API_BASE = (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost" || window.location.hostname === "skinharmony-smartdesk-live.onrender.com")
    ? window.location.origin
    : (window.localStorage.getItem("skinharmony-web-api-url") || window.location.origin).replace(/\/$/, "");
  var state = {
    open: false,
    sending: false,
    session: null,
    messages: [],
    composer: ""
  };

  function token() {
    return window.localStorage.getItem("skinharmony-web-token") || "";
  }

  function plan() {
    var raw = state.session && (state.session.subscriptionPlan || state.session.plan || state.session.role);
    return String(raw || "base").toLowerCase();
  }

  function isGold() {
    var p = plan();
    return p === "gold" || p === "trial" || p === "superadmin";
  }

  function isLoggedIn() {
    return Boolean(token());
  }

  function currentPageLabel() {
    var path = window.location.pathname || "/";
    var map = {
      "/": "Dashboard",
      "/appointments": "Agenda",
      "/clients": "Clienti",
      "/marketing": "Recall",
      "/profitability": "Redditivita",
      "/cashdesk": "Cassa",
      "/inventory": "Magazzino",
      "/services": "Servizi",
      "/ai-gold": "AI Gold",
      "/reports": "Report",
      "/settings": "Impostazioni"
    };
    return map[path] || "Smart Desk";
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fetchJson(path, options) {
    var headers = { "Content-Type": "application/json" };
    var t = token();
    if (t) headers.Authorization = "Bearer " + t;
    return fetch(API_BASE + path, Object.assign({
      headers: headers,
      credentials: "same-origin"
    }, options || {})).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          throw new Error(text || ("HTTP " + response.status));
        });
      }
      return response.status === 204 ? {} : response.json();
    });
  }

  function routeTo(path) {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function seedMessages() {
    if (state.messages.length) return;
    if (isGold()) {
      state.messages.push({
        role: "assistant",
        text: "Sono Nyra Gold. Leggo priorita, clienti, agenda, cassa e margini: ti dico cosa fare, poi confermi tu."
      });
      return;
    }
    state.messages.push({
      role: "assistant",
      text: plan() === "silver"
        ? "Sono Nyra. In Silver ti guido nei moduli e ti spiego dove lavorare; le azioni operative Gold restano protette."
        : "Sono Nyra. In Base ti aiuto a usare agenda, clienti, cassa, servizi e impostazioni."
    });
  }

  function renderMessage(message, index) {
    var label = message.role === "user" ? "Tu" : (isGold() ? "Nyra Gold" : "Nyra");
    return [
      '<div class="nyra-gold-message ', esc(message.role), '" data-index="', index, '">',
      '<div class="nyra-gold-message-label">', esc(label), '</div>',
      '<div class="nyra-gold-message-body">', esc(message.text), '</div>',
      message.actions && message.actions.length ? '<div class="nyra-gold-actions">' + message.actions.map(function (action) {
        return '<button type="button" data-nyra-route="' + esc(action.path || action.route || "") + '">' + esc(action.label || action.title || "Apri") + '</button>';
      }).join("") + '</div>' : '',
      '</div>'
    ].join("");
  }

  function quickActions() {
    if (isGold()) {
      return [
        "Cosa devo fare adesso?",
        "Mostrami la priorita rossa",
        "Controlla clienti da recuperare",
        "Dove perdo margine?"
      ];
    }
    return [
      "Come inserisco un cliente?",
      "Come apro la cassa?",
      "Dove modifico servizi?",
      "Come controllo agenda?"
    ];
  }

  function render() {
    if (!isLoggedIn()) {
      var old = document.getElementById(ROOT_ID);
      if (old) old.remove();
      return;
    }
    seedMessages();
    var root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      document.body.appendChild(root);
    }
    var gold = isGold();
    var subtitle = gold
      ? "Assistente operativo Gold · " + currentPageLabel()
      : "Assistente tecnico · " + (plan() === "silver" ? "Silver" : "Base");
    root.className = "nyra-gold-chat-root" + (state.open ? " open" : "") + (gold ? " gold" : " support");
    root.innerHTML = [
      state.open ? '<aside class="nyra-gold-panel" role="dialog" aria-label="Nyra">' +
        '<div class="nyra-gold-head">' +
          '<div><div class="nyra-gold-kicker">' + (gold ? 'AI OPERATIVA' : 'ASSISTENZA') + '</div><strong>' + (gold ? 'Nyra Gold' : 'Nyra') + '</strong><span>' + esc(subtitle) + '</span></div>' +
          '<button type="button" class="nyra-gold-close" aria-label="Chiudi Nyra">Chiudi</button>' +
        '</div>' +
        '<div class="nyra-gold-thread">' + state.messages.map(renderMessage).join("") + (state.sending ? '<div class="nyra-gold-message assistant thinking"><div class="nyra-gold-message-label">Nyra</div><div class="nyra-gold-message-body">Sto leggendo il centro...</div></div>' : '') + '</div>' +
        '<div class="nyra-gold-quick">' + quickActions().map(function (label) {
          return '<button type="button" data-nyra-prompt="' + esc(label) + '">' + esc(label) + '</button>';
        }).join("") + '</div>' +
        '<form class="nyra-gold-form"><input name="message" value="' + esc(state.composer) + '" placeholder="' + (gold ? 'Scrivi a Nyra Gold...' : 'Chiedi supporto a Nyra...') + '" autocomplete="off"><button type="submit"' + (state.sending ? ' disabled' : '') + '>Invia</button></form>' +
      '</aside>' : '',
      '<button type="button" class="nyra-gold-trigger" aria-label="Apri Nyra">' +
        '<span class="nyra-gold-mark">?</span><span><strong>' + (gold ? 'Nyra Gold' : 'Nyra') + '</strong><small>' + (gold ? 'operativa' : 'supporto') + '</small></span>' +
      '</button>'
    ].join("");
    attachEvents(root);
    scrollThread(root);
  }

  function scrollThread(root) {
    var thread = root.querySelector(".nyra-gold-thread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  function attachEvents(root) {
    var trigger = root.querySelector(".nyra-gold-trigger");
    if (trigger) trigger.onclick = function () {
      state.open = !state.open;
      render();
    };
    var close = root.querySelector(".nyra-gold-close");
    if (close) close.onclick = function () {
      state.open = false;
      render();
    };
    root.querySelectorAll("[data-nyra-prompt]").forEach(function (button) {
      button.onclick = function () {
        sendMessage(button.getAttribute("data-nyra-prompt") || "");
      };
    });
    root.querySelectorAll("[data-nyra-route]").forEach(function (button) {
      button.onclick = function () {
        var path = button.getAttribute("data-nyra-route");
        if (path) routeTo(path);
      };
    });
    var input = root.querySelector(".nyra-gold-form input");
    if (input) input.oninput = function () {
      state.composer = input.value;
    };
    var form = root.querySelector(".nyra-gold-form");
    if (form) form.onsubmit = function (event) {
      event.preventDefault();
      sendMessage(state.composer);
    };
  }

  function normalizeAnswer(payload) {
    if (!payload) return { text: "Non ho ricevuto una risposta leggibile.", actions: [] };
    var text = payload.answer || payload.message || payload.text || payload.reply || "";
    if (!text && payload.dialogue) text = payload.dialogue.reply || payload.dialogue.content || "";
    if (!text && payload.structured) text = payload.structured.summary || payload.structured.message || "";
    var actions = payload.actions || payload.suggestedActions || payload.primaryActions || [];
    if (!Array.isArray(actions)) actions = [];
    return { text: text || "Ho letto il contesto. Dimmi quale modulo vuoi aprire.", actions: actions.slice(0, 3) };
  }

  function sendMessage(raw) {
    var message = String(raw || "").trim();
    if (!message || state.sending) return;
    state.composer = "";
    state.messages.push({ role: "user", text: message });
    state.sending = true;
    render();

    var gold = isGold();
    var endpoint = gold ? "/api/ai-gold/ask" : "/api/assistant/chat";
    var body = gold
      ? { question: message, message: message, page: window.location.pathname, source: "nyra_gold_floating_chat" }
      : { message: message, page: window.location.pathname, source: "nyra_support_floating_chat" };

    fetchJson(endpoint, { method: "POST", body: JSON.stringify(body) })
      .then(function (payload) {
        var answer = normalizeAnswer(payload);
        state.messages.push({ role: "assistant", text: answer.text, actions: answer.actions });
      })
      .catch(function (error) {
        var fallback = gold
          ? "Non riesco a leggere AI Gold adesso. Puoi aprire AI Gold e aggiornare la lettura; non modifico dati senza conferma."
          : "Non riesco a rispondere ora. Riprova tra poco o apri il modulo dal menu.";
        state.messages.push({ role: "assistant", text: error && error.message ? error.message : fallback });
      })
      .finally(function () {
        state.sending = false;
        render();
      });
  }

  function loadSession() {
    if (!isLoggedIn()) {
      render();
      return;
    }
    fetchJson("/api/auth/session")
      .then(function (session) {
        state.session = session || {};
      })
      .catch(function () {
        state.session = {};
      })
      .finally(render);
  }

  window.addEventListener("storage", loadSession);
  window.addEventListener("popstate", function () { setTimeout(render, 50); });
  document.addEventListener("DOMContentLoaded", loadSession);
  setTimeout(loadSession, 900);
})();
