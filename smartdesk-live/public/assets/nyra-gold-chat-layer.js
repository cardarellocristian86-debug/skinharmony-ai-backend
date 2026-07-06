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

  function isGreeting(message) {
    return /^(ciao|hey|ehi|buongiorno|buonasera|salve|ok|okay|test)\W*$/i.test(String(message || "").trim());
  }

  function greetingAnswer() {
    if (isGold()) {
      return "Ciao. Sono qui: posso indicarti la priorita di oggi, aprire il modulo giusto o leggere clienti, agenda, cassa e margini. Dimmi cosa vuoi controllare.";
    }
    return "Ciao. Posso aiutarti a usare Smart Desk: agenda, clienti, cassa, servizi, magazzino e impostazioni.";
  }

  function cleanAssistantText(value) {
    var text = String(value || "");
    return text
      .replace(/Domanda ricevuta:\s*.*(\n|$)/gi, "")
      .replace(/Lettura AI Gold operativa sui dati disponibili,?\s*/gi, "")
      .replace(/con Universal Core come motore decisionale\.?\s*/gi, "")
      .replace(/Universal Core/gi, "il sistema")
      .replace(/Core\/Nyra server/gi, "lettura del centro")
      .replace(/Core\/Nyra/gi, "lettura del centro")
      .replace(/Core server/gi, "sistema")
      .replace(/Nyra server/gi, "Nyra")
      .replace(/AI Gold operativa/gi, "lettura operativa")
      .replace(/AI Gold/gi, "Nyra Gold")
      .replace(/Fonte esterna server:.*$/gim, "")
      .replace(/Smart Desk resta sorgente dati\.?/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function compactAssistantText(value) {
    var text = cleanAssistantText(value);
    if (!text) return "";
    var lines = text.split(/\n+/).map(function (line) { return line.trim(); }).filter(Boolean);
    if (lines.length > 5) lines = lines.slice(0, 5);
    text = lines.join("\n");
    if (text.length > 520) text = text.slice(0, 500).replace(/\s+\S*$/, "") + "...";
    return text;
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

  function isNativeNyraButton(node) {
    if (!node || node.closest("#" + ROOT_ID)) return false;
    var text = String(node.innerText || node.textContent || "").trim();
    if (!/nyra/i.test(text)) return false;
    var rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
    if (!rect || rect.width < 30 || rect.height < 28) return false;
    return rect.left < 320 && rect.top > window.innerHeight - 190;
  }

  function enhanceNativeNyraButton() {
    var buttons = Array.from(document.querySelectorAll("button, a, [role='button']"));
    buttons.forEach(function (button) {
      if (!isNativeNyraButton(button)) return;
      button.classList.add("nyra-gold-native-enhanced");
      button.setAttribute("data-nyra-mode", isGold() ? "gold" : "support");
      button.setAttribute("aria-label", isGold() ? "Apri Nyra Gold" : "Apri Nyra");
      button.setAttribute("title", isGold() ? "Nyra Gold" : "Nyra");
    });
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
      '</aside>' : ''
    ].join("");
    enhanceNativeNyraButton();
    attachEvents(root);
    scrollThread(root);
  }

  function scrollThread(root) {
    var thread = root.querySelector(".nyra-gold-thread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  function attachEvents(root) {
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
    return { text: compactAssistantText(text) || "Ho letto il contesto. Dimmi quale modulo vuoi aprire.", actions: actions.slice(0, 3) };
  }

  function sendMessage(raw) {
    var message = String(raw || "").trim();
    if (!message || state.sending) return;
    state.composer = "";
    state.messages.push({ role: "user", text: message });
    if (isGreeting(message)) {
      state.messages.push({ role: "assistant", text: greetingAnswer() });
      render();
      return;
    }
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
          ? "Non riesco a leggere il centro adesso. Apri Nyra Gold o aggiorna la dashboard; non modifico dati senza conferma."
          : "Non riesco a rispondere ora. Riprova tra poco o apri il modulo dal menu.";
        state.messages.push({ role: "assistant", text: compactAssistantText(error && error.message ? error.message : fallback) });
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
  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest ? event.target.closest("button, a, [role='button']") : null;
    if (!isNativeNyraButton(target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    state.open = !state.open;
    render();
  }, true);
  document.addEventListener("DOMContentLoaded", loadSession);
  setInterval(enhanceNativeNyraButton, 1200);
  setTimeout(loadSession, 900);
})();
