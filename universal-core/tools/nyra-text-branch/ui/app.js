const state = {
  busy: false,
  sessionId: localStorage.getItem("nyra-text-session-id") || `ui_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 6)}`,
};

localStorage.setItem("nyra-text-session-id", state.sessionId);

const byId = (id) => document.getElementById(id);

function addMessage(role, content, meta = {}) {
  const node = document.createElement("article");
  node.className = `message ${role}`;
  node.appendChild(renderRichText(content));

  const metaLine = document.createElement("div");
  metaLine.className = "message-meta";

  if (meta.actor) {
    const actor = document.createElement("span");
    actor.className = "meta-badge meta-badge-actor";
    actor.textContent = meta.actor;
    metaLine.appendChild(actor);
  }

  if (meta.primary) {
    const domain = document.createElement("span");
    domain.className = "meta-badge meta-badge-domain";
    domain.textContent = meta.secondary?.length
      ? `${meta.primary} + ${meta.secondary.join(",")}`
      : meta.primary;
    metaLine.appendChild(domain);
  }

  if (meta.source) {
    const source = document.createElement("span");
    source.textContent = `source: ${meta.source}`;
    metaLine.appendChild(source);
  }

  if (meta.risk) {
    const risk = document.createElement("span");
    risk.textContent = `risk: ${meta.risk}`;
    metaLine.appendChild(risk);
  }

  if (typeof meta.confidence === "number") {
    const conf = document.createElement("span");
    conf.textContent = `conf: ${meta.confidence.toFixed(2)}`;
    metaLine.appendChild(conf);
  }

  if (metaLine.children.length) {
    node.appendChild(metaLine);
  }

  if (Array.isArray(meta.warning) && meta.warning.length) {
    node.appendChild(renderInfoBox("Warning", meta.warning, "warning"));
  }

  if (Array.isArray(meta.action) && meta.action.length) {
    node.appendChild(renderInfoBox("Action", meta.action, "action"));
  }

  if (Array.isArray(meta.notes) && meta.notes.length) {
    node.appendChild(renderInfoBox("Notes", meta.notes, "notes"));
  }

  byId("messages").appendChild(node);
  byId("messages").scrollTop = byId("messages").scrollHeight;
}

function renderInfoBox(title, lines, kind) {
  const box = document.createElement("section");
  box.className = `info-box ${kind}`;

  const heading = document.createElement("strong");
  heading.textContent = title;
  box.appendChild(heading);

  const list = document.createElement("ul");
  for (const line of lines) {
    const item = document.createElement("li");
    item.textContent = line;
    list.appendChild(item);
  }
  box.appendChild(list);
  return box;
}

function renderRichText(content) {
  const container = document.createElement("div");
  container.className = "message-content";

  const source = String(content || "");
  const fencePattern = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = fencePattern.exec(source)) !== null) {
    const before = source.slice(lastIndex, match.index);
    appendParagraphBlock(container, before);

    const pre = document.createElement("pre");
    pre.className = "message-code";
    const code = document.createElement("code");
    code.textContent = match[2].trim();
    pre.appendChild(code);
    container.appendChild(pre);

    lastIndex = match.index + match[0].length;
  }

  appendParagraphBlock(container, source.slice(lastIndex));
  return container;
}

function appendParagraphBlock(container, raw) {
  const text = String(raw || "").trim();
  if (!text) return;

  const blocks = text.split(/\n{2,}/g);
  for (const block of blocks) {
    const p = document.createElement("p");
    p.textContent = block.replace(/\n/g, " ").trim();
    container.appendChild(p);
  }
}

function setMetaLine(text) {
  byId("metaLine").textContent = text;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function sendMessage(text) {
  if (!text.trim() || state.busy) return;
  state.busy = true;
  byId("sendBtn").disabled = true;
  setMetaLine("Nyra sta leggendo...");
  addMessage("user", text);

  try {
    const response = await fetchJson("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, sessionId: state.sessionId }),
    });

    addMessage("nyra", response.content || "Nessuna risposta.", {
      actor: response.actor,
      primary: response.route?.primary,
      secondary: response.route?.secondary,
      source: response.source,
      risk: response.risk,
      confidence: response.confidence,
      warning: response.ui?.warning,
      action: response.ui?.action,
      notes: response.ui?.notes,
    });
    setMetaLine(`Pronta. Sessione: ${state.sessionId} · actor: ${response.actor || response.source}`);
  } catch (error) {
    addMessage("system", `Errore runtime: ${error.message}`);
    setMetaLine("Errore. Controlla il server locale.");
  } finally {
    state.busy = false;
    byId("sendBtn").disabled = false;
  }
}

async function ping() {
  setMetaLine("Ping...");
  try {
    const response = await fetchJson("/api/ping");
    addMessage("system", `Server attivo: ${response.ok ? "ok" : "no"} · ${response.mode}`);
    setMetaLine("Pronta.");
  } catch (error) {
    addMessage("system", `Ping fallito: ${error.message}`);
    setMetaLine("Server non raggiungibile.");
  }
}

function wireEvents() {
  byId("chatForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const textarea = byId("messageInput");
    const text = textarea.value;
    textarea.value = "";
    await sendMessage(text);
    textarea.focus();
  });

  byId("clearChatBtn").addEventListener("click", () => {
    byId("messages").innerHTML = "";
    addMessage("system", "Chat pulita.");
    setMetaLine("Pronta.");
  });

  byId("pingBtn").addEventListener("click", () => {
    ping();
  });

  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      byId("messageInput").value = button.getAttribute("data-prompt") || "";
      byId("messageInput").focus();
    });
  });

  document.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", async () => {
      const command = button.getAttribute("data-command") || "";
      await sendMessage(command);
    });
  });
}

wireEvents();
addMessage("system", "Sono pronta. Punto, azione, limite.");
setMetaLine("Pronta.");
