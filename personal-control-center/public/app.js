let overview = null;
let nyraControl = null;
let assistantState = {
  answer: "Nessuna risposta.",
  proposal: null
};

const byId = (id) => document.getElementById(id);
const euro = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

function money(value) {
  return euro.format(Number(value || 0));
}

function pct(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toneClass(level) {
  if (["critical", "critico"].includes(level)) return "critico";
  if (["warning", "attenzione", "mancante", "incompleto", "eventi_mancanti"].includes(level)) return "attenzione";
  if (["ok", "positivo", "attivo", "api_attivo", "manuale_attivo"].includes(level)) return "ok";
  return "neutro";
}

function panelTone(status) {
  if (["critical", "critico"].includes(status)) return "tone-critical";
  if (["warning", "attenzione"].includes(status)) return "tone-warning";
  if (["ok", "positivo"].includes(status)) return "tone-ok";
  return "tone-neutral";
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  return text ? JSON.parse(text) : {};
}

function buildPriorityQueue(data) {
  const queue = [];
  const push = (level, title, detail, origin) => {
    if (!title) return;
    queue.push({ level, title, detail, origin });
  };

  (data.decision?.nextActions || []).forEach((item) => push(item.priority, item.title, item.detail, "decision"));
  (data.executive?.strategicActions || []).forEach((item) => push(item.level, item.title, item.detail, "executive"));
  (data.alerts || []).slice(0, 8).forEach((item) => push(item.level, item.type, item.message, "alert"));
  (data.dataQuality?.missing || []).forEach((item) => push("attenzione", `Dato mancante: ${item.label}`, item.detail, "quality"));

  const weight = { critico: 0, critical: 0, attenzione: 1, warning: 1, ok: 2, positivo: 2, neutro: 3 };
  return queue
    .filter((item) => item.title)
    .sort((a, b) => (weight[a.level] ?? 3) - (weight[b.level] ?? 3))
    .slice(0, 10);
}

function buildTempoBuckets(data, queue) {
  const blocked = [];
  const watch = [];
  const now = [];
  const next = [];

  const pushUnique = (bucket, title, detail, level, origin) => {
    if (!title) return;
    const key = `${title}|${detail}`;
    if (bucket.some((item) => `${item.title}|${item.detail}` === key)) return;
    bucket.push({ title, detail, level, origin });
  };

  queue.forEach((item, index) => {
    if (index === 0 || ["critico", "critical"].includes(item.level)) {
      pushUnique(now, item.title, item.detail, item.level, item.origin);
    } else {
      pushUnique(next, item.title, item.detail, item.level, item.origin);
    }
  });

  (data.dataQuality?.missing || []).forEach((item) => {
    pushUnique(blocked, `Blocco dati: ${item.label}`, item.detail, "attenzione", "quality");
  });

  const sources = data.sources || {};
  Object.entries(sources).forEach(([key, source]) => {
    const status = String(source?.status || "");
    if (status.includes("da_collegare") || status === "pronto") {
      pushUnique(blocked, `Fonte non collegata: ${key}`, "La vista esiste ma il feed non e affidabile.", "attenzione", "runtime");
    }
  });

  (data.websiteFunnel?.missing || []).forEach((item) => {
    pushUnique(blocked, "Funnel incompleto", item, "attenzione", "website");
  });

  if ((data.alerts || []).length > 0) {
    (data.alerts || []).slice(0, 5).forEach((item) => {
      if (item.level === "attenzione") {
        pushUnique(watch, item.type, item.message, item.level, "alert");
      }
    });
  }

  if (!watch.length) {
    pushUnique(watch, "Monitoraggio attivo", "Non ci sono segnali deboli che superano la soglia di rumore.", "neutro", "system");
  }

  if (!blocked.length) {
    pushUnique(blocked, "Nessun blocco dominante", "Il sistema non sta segnalando impedimenti strutturali forti.", "ok", "system");
  }

  if (!next.length) {
    pushUnique(next, "Nessuna mossa successiva forte", "Dopo la priorita attuale, il resto e secondario.", "neutro", "system");
  }

  return {
    now: now.slice(0, 4),
    next: next.slice(0, 4),
    blocked: blocked.slice(0, 4),
    watch: watch.slice(0, 4)
  };
}

function buildConfidenceSignals(data) {
  const funnel = data.websiteFunnel || {};
  const sources = data.sources || {};
  return [
    {
      label: "Website",
      state: funnel.status === "attivo" ? "reale" : funnel.status === "eventi_mancanti" ? "incompleto" : "non collegato",
      detail: funnel.note || "Lettura funnel sito."
    },
    {
      label: "Instagram",
      state: sources.instagram?.status === "api_attivo" ? "reale" : "non collegato",
      detail: sources.instagram?.latest ? "Snapshot social disponibile." : "Snapshot social assente."
    },
    {
      label: "Smart Desk",
      state: sources.smartDesk?.latest ? "reale" : "incompleto",
      detail: sources.smartDesk?.latest ? "Snapshot gestionale disponibile." : "Manca snapshot recente del gestionale."
    },
    {
      label: "Revenue",
      state: Number(data.economics?.sales?.length || 0) > 0 ? "reale" : "incompleto",
      detail: Number(data.economics?.sales?.length || 0) > 0 ? "Vendite collegate presenti." : "Mancano vendite collegate ai lead."
    },
    {
      label: "Margin",
      state: Number(data.economics?.sales?.some((sale) => Number(sale.estimatedCost || 0) > 0) ? 1 : 0) ? "reale" : "stimato",
      detail: Number(data.economics?.sales?.some((sale) => Number(sale.estimatedCost || 0) > 0) ? 1 : 0) ? "Costi presenti." : "Margine ancora parziale o stimato."
    },
    {
      label: "Runtime",
      state: sources.render?.latest ? "reale" : "incompleto",
      detail: sources.render?.latest ? "Render e leggibile." : "Monitor runtime non ancora coerente."
    }
  ];
}

function buildSegmentedQueue(data, queue) {
  const groups = {
    commerciale: [],
    operativa: [],
    tecnica: [],
    strategica: []
  };

  const put = (group, item) => {
    if (!groups[group]) return;
    groups[group].push(item);
  };

  queue.forEach((item) => {
    const origin = String(item.origin || "");
    if (origin === "decision" || origin === "alert") put("commerciale", item);
    else if (origin === "quality" || origin === "runtime") put("tecnica", item);
    else put("strategica", item);
  });

  if (data.agenda?.totalOpenTodos) {
    put("operativa", {
      title: `${data.agenda.totalOpenTodos} task aperti`,
      detail: "Il carico operativo manuale va ridotto o trasformato in azione chiusa.",
      level: "attenzione",
      origin: "agenda"
    });
  }

  Object.keys(groups).forEach((key) => {
    if (!groups[key].length) {
      groups[key].push({
        title: "Nessuna pressione dominante",
        detail: "Non emerge una frizione forte in questo dominio.",
        level: "neutro",
        origin: key
      });
    }
  });

  return groups;
}

function buildRuntimeSignals(data) {
  const sources = data.sources || {};
  const items = [
    ["Website", sources.website?.status, sources.website?.analytics?.date || sources.website?.searchConsole?.date || sources.website?.latest?.date || "non letto"],
    ["Instagram", sources.instagram?.status, sources.instagram?.latest?.date || "non letto"],
    ["Smart Desk", sources.smartDesk?.status, sources.smartDesk?.latest?.date || "non letto"],
    ["Render", sources.render?.status, sources.render?.latest?.date || "non letto"],
    ["GitHub", sources.github?.status, sources.github?.latest?.date || "non letto"],
    ["Contacts", sources.contacts?.status, `${sources.contacts?.total || 0} contatti manuali`]
  ];
  return items.map(([label, status, detail]) => ({ label, status: status || "non collegato", detail }));
}

function renderSessionMeta(data) {
  byId("sessionMeta").textContent = [
    `Updated: ${data.generatedAt || "n.d."}`,
    `Alerts: ${(data.alerts || []).length}`,
    `Leads: ${data.funnel?.total || 0}`,
    `Open tasks: ${data.agenda?.totalOpenTodos || 0}`
  ].join("\n");
}

function renderHero(data, queue, nyra) {
  const primary = nyra?.primary || queue[0] || {
    level: data.decision?.status || "neutro",
    title: data.decision?.headline || "Nessuna pressione dominante",
    detail: "Il sistema non vede ancora una frizione dominante."
  };
  const nextMove = nyra?.tempo?.next?.[0] || queue[1] || primary;

  byId("primaryTitle").textContent = primary.title;
  byId("primaryDetail").textContent = primary.detail || "Nessun dettaglio disponibile.";
  byId("primaryStatus").textContent = String(data.decision?.status || "neutro").toUpperCase();
  byId("primaryResponse").textContent = pct(data.decision?.responseRate || 0);
  byId("primaryQuality").textContent = `${data.dataQuality?.score || 0}%`;
  byId("primaryProductivity").textContent = String(data.productivity?.today?.outputScore || 0);

  const hero = byId("command");
  hero.className = `panel hero ${panelTone(data.decision?.status)}`;

  byId("nextMoveCard").innerHTML = `
    <small>Next move</small>
    <strong>${esc(nextMove.title)}</strong>
    <p>${esc(nextMove.detail || "Nessun dettaglio disponibile.")}</p>
    <div class="item-meta">
      <span class="pill ${toneClass(nextMove.level)}">${esc(nextMove.level || "neutro")}</span>
      <span class="pill">${esc(nextMove.origin || "system")}</span>
    </div>
  `;
}

function renderMetricGrid(data) {
  const cards = data.executive?.cards || [];
  byId("metricGrid").innerHTML = cards.map((card) => `
    <article class="metric-card ${panelTone(card.status)}">
      <small>${esc(card.label)}</small>
      <strong>${esc(card.value)}</strong>
      <p>${esc(card.detail || "")}</p>
    </article>
  `).join("");
}

function renderStrategy(data, queue) {
  byId("commandQueue").innerHTML = queue.map((item, index) => `
    <article class="stack-item ${panelTone(item.level)}">
      <div class="item-meta">
        <span class="pill ${toneClass(item.level)}">P${index + 1}</span>
        <span class="pill">${esc(item.origin || "system")}</span>
      </div>
      <h4>${esc(item.title)}</h4>
      <p>${esc(item.detail || "")}</p>
    </article>
  `).join("");

  byId("strategyLine").innerHTML = (data.executive?.strategyBrief || []).map((line, index) => `
    <article class="stack-item">
      <div class="item-meta"><span class="pill neutro">Line ${index + 1}</span></div>
      <p>${esc(line)}</p>
    </article>
  `).join("");
}

function renderTempo(data, queue, nyra) {
  const buckets = nyra?.tempo || buildTempoBuckets(data, queue);
  const renderBucket = (targetId, items) => {
    byId(targetId).innerHTML = items.map((item) => `
      <article class="stack-item ${panelTone(item.level)}">
        <div class="item-meta">
          <span class="pill ${toneClass(item.level)}">${esc(item.level || "neutro")}</span>
          <span class="pill">${esc(item.origin || "system")}</span>
        </div>
        <h4>${esc(item.title)}</h4>
        <p>${esc(item.detail || "")}</p>
      </article>
    `).join("");
  };
  renderBucket("nowQueue", buckets.now);
  renderBucket("nextQueue", buckets.next);
  renderBucket("blockedQueue", buckets.blocked);
  renderBucket("watchQueue", buckets.watch);
}

function renderChannels(data, nyra) {
  const channels = [
    {
      label: "Website",
      status: data.sources?.website?.status,
      detail: data.websiteFunnel?.note || "Traffico, CTA, form e conversioni."
    },
    {
      label: "Instagram",
      status: data.sources?.instagram?.status,
      detail: `${data.sources?.instagram?.latest?.followers || 0} follower, ${data.sources?.instagram?.latest?.mediaCount || 0} media letti`
    },
    {
      label: "Smart Desk",
      status: data.sources?.smartDesk?.status,
      detail: data.sources?.smartDesk?.latest ? "Snapshot presente" : "Snapshot assente"
    },
    {
      label: "Render",
      status: data.sources?.render?.status,
      detail: data.sources?.render?.latest?.database?.note || data.sources?.render?.latest?.service?.status || "Monitor infrastrutturale"
    },
    {
      label: "GitHub",
      status: data.sources?.github?.status,
      detail: data.sources?.github?.latest?.repo || "Lettura repo"
    },
    {
      label: "Contacts",
      status: data.sources?.contacts?.status,
      detail: `${data.sources?.contacts?.total || 0} contatti manuali`
    }
  ];

  byId("channelGrid").innerHTML = channels.map((channel) => `
    <article class="channel-card ${panelTone(channel.status)}">
      <small>${esc(channel.label)}</small>
      <strong>${esc(String(channel.status || "n.d.").replaceAll("_", " "))}</strong>
      <p>${esc(channel.detail || "")}</p>
    </article>
  `).join("");

  const confidence = nyra?.confidence || buildConfidenceSignals(data);
  byId("confidenceBoard").innerHTML = confidence.map((item) => `
    <article class="confidence-card ${panelTone(item.state)}">
      <small>${esc(item.label)}</small>
      <strong>${esc(item.state)}</strong>
      <p>${esc(item.detail)}</p>
    </article>
  `).join("");

  byId("funnelStrip").innerHTML = (data.websiteFunnel?.steps || []).map((step) => `
    <article class="funnel-step">
      <small>${esc(step.label)}</small>
      <strong>${esc(step.value)}</strong>
      <span class="pill ${toneClass(step.state)}">${esc(step.state)}</span>
    </article>
  `).join("");
}

function renderPipeline(data, nyra) {
  byId("campaignList").innerHTML = (data.campaigns || []).map((campaign) => `
    <article class="table-row ${panelTone(campaign.responseRate < 0.02 && campaign.sends > 0 ? "critical" : campaign.responseRate < 0.2 && campaign.sends > 0 ? "warning" : "ok")}">
      <div>
        <h4>${esc(campaign.label)}</h4>
        <p>${esc(campaign.status || "n.d.")}</p>
      </div>
      <div>
        <strong>${esc(campaign.sends)}</strong>
        <span>Invii</span>
      </div>
      <div>
        <strong>${esc(campaign.replies)}</strong>
        <span>Risposte</span>
      </div>
      <div>
        <strong>${pct(campaign.responseRate)}</strong>
        <span>Reply rate</span>
      </div>
      <div>
        <strong>${esc(campaign.customers || 0)}</strong>
        <span>Clienti</span>
      </div>
    </article>
  `).join("");

  const leadItems = [];
  if ((data.behavior || []).length) {
    const stale = data.behavior
      .filter((item) => !["cliente", "perso"].includes(item.stato))
      .sort((a, b) => Number(b.followUp || 0) - Number(a.followUp || 0))
      .slice(0, 8);
    stale.forEach((item) => {
      leadItems.push({
        title: item.nome || item.contatto || "Lead",
        detail: `${item.stato || "n.d."} | follow-up ${item.followUp || 0} | ${item.tempoRisposta || "no response"}`
      });
    });
  }
  if (!leadItems.length) {
    leadItems.push({ title: "Nessuna pressione lead", detail: "Non risultano lead con segnale operativo forte." });
  }

  byId("leadPressure").innerHTML = leadItems.map((item) => `
    <article class="stack-item">
      <h4>${esc(item.title)}</h4>
      <p>${esc(item.detail)}</p>
    </article>
  `).join("");

  const segmented = nyra?.segmented || buildSegmentedQueue(data, buildPriorityQueue(data));
  byId("segmentedQueue").innerHTML = Object.entries(segmented).map(([group, items]) => `
    <section class="stack-list">
      <div class="subsection-head">
        <h3>${esc(group)}</h3>
      </div>
      ${items.slice(0, 3).map((item) => `
        <article class="stack-item ${panelTone(item.level)}">
          <div class="item-meta">
            <span class="pill ${toneClass(item.level)}">${esc(item.level || "neutro")}</span>
          </div>
          <h4>${esc(item.title)}</h4>
          <p>${esc(item.detail || "")}</p>
        </article>
      `).join("")}
    </section>
  `).join("");
}

function renderCapital(data) {
  const capitalItems = [
    { title: "Revenue tracked", detail: money(data.economics?.totalRevenue || 0) },
    { title: "Margin tracked", detail: money(data.economics?.totalMargin || 0) },
    { title: "Sales linked", detail: `${data.economics?.sales?.length || 0} vendite` },
    { title: "Top product", detail: data.economics?.topProduct ? `${data.economics.topProduct.product} (${data.economics.topProduct.count})` : "Non disponibile" }
  ];
  byId("capitalBoard").innerHTML = capitalItems.map((item) => `
    <article class="stack-item">
      <h4>${esc(item.title)}</h4>
      <p>${esc(item.detail)}</p>
    </article>
  `).join("");

  const inventoryItems = [
    { title: "Manual inventory", detail: `${data.manualInventory?.totalProducts || 0} prodotti | ${data.manualInventory?.totalUnits || 0} unita` },
    { title: "Low stock", detail: `${data.manualInventory?.lowStock?.length || 0} prodotti sotto soglia` },
    { title: "Products sold", detail: `${data.inventory?.productsSold?.length || 0} prodotti mossi` },
    { title: "Stationary products", detail: `${data.inventory?.stationaryProducts?.length || 0} prodotti fermi` }
  ];
  byId("inventoryBoard").innerHTML = inventoryItems.map((item) => `
    <article class="stack-item">
      <h4>${esc(item.title)}</h4>
      <p>${esc(item.detail)}</p>
    </article>
  `).join("");
}

function renderRuntime(data) {
  const runtimeItems = buildRuntimeSignals(data);
  byId("runtimeBoard").innerHTML = runtimeItems.map((item) => `
    <article class="stack-item ${panelTone(item.status)}">
      <h4>${esc(item.label)}</h4>
      <p>${esc(item.detail)}</p>
      <div class="item-meta">
        <span class="pill ${toneClass(item.status)}">${esc(String(item.status).replaceAll("_", " "))}</span>
      </div>
    </article>
  `).join("");

  const agenda = data.agenda || {};
  const agendaItems = [
    { title: "Today", detail: agenda.today || "n.d." },
    { title: "Appointments today", detail: `${agenda.appointmentsToday?.length || 0}` },
    { title: "Open tasks", detail: `${agenda.totalOpenTodos || 0}` },
    { title: "Recent open tasks", detail: (agenda.openTodos || []).slice(0, 5).map((item) => item.titolo).join(" | ") || "Nessun task aperto" }
  ];
  byId("agendaBoard").innerHTML = agendaItems.map((item) => `
    <article class="stack-item">
      <h4>${esc(item.title)}</h4>
      <p>${esc(item.detail)}</p>
    </article>
  `).join("");
}

function renderFinanceDock(data) {
  const readyEconomic = Number(data.economics?.sales?.length || 0) > 0;
  const readyRuntime = Boolean(data.sources?.render?.latest && data.sources?.smartDesk?.latest);
  const readyFlow = Number(data.campaigns?.length || 0) > 0 && Number(data.funnel?.total || 0) > 0;

  const dockItems = [
    {
      title: "Trading surface",
      status: "attenzione",
      detail: "Non attiva ancora. Deve entrare come workspace separato, non come card persa."
    },
    {
      title: "Economic feed",
      status: readyEconomic ? "ok" : "attenzione",
      detail: readyEconomic ? "Revenue e margin reali gia presenti." : "Mancano abbastanza vendite collegate."
    },
    {
      title: "Runtime feed",
      status: readyRuntime ? "ok" : "attenzione",
      detail: readyRuntime ? "Render e Smart Desk sono gia leggibili." : "Serve consistenza tra runtime e business feed."
    },
    {
      title: "Flow feed",
      status: readyFlow ? "ok" : "attenzione",
      detail: readyFlow ? "Campaign, funnel e lead sono gia presenti per il layer finanziario." : "Serve piu base dati pipeline."
    }
  ];

  byId("financeDockBoard").innerHTML = dockItems.map((item) => `
    <article class="dock-card ${panelTone(item.status)}">
      <small>${esc(item.title)}</small>
      <strong>${esc(String(item.status).toUpperCase())}</strong>
      <p>${esc(item.detail)}</p>
    </article>
  `).join("");
}

function renderAssistantState() {
  byId("assistantAnswer").textContent = assistantState.answer || "Nessuna risposta.";
  const box = byId("proposalBox");
  if (!assistantState.proposal) {
    box.innerHTML = "Nessuna proposta.";
    return;
  }
  const proposal = assistantState.proposal;
  const proposals = Array.isArray(proposal.proposals) ? proposal.proposals : [];
  box.innerHTML = `
    <div class="proposal-card">
      <h4>${esc(proposal.summary || "Proposta AI")}</h4>
      <p>${esc(proposal.diagnosis || "")}</p>
    </div>
    ${proposals.map((item, index) => `
      <div class="proposal-card">
        <div class="item-meta">
          <span class="pill ${toneClass(item.priority)}">${esc(item.priority || "media")}</span>
          <span class="pill">${esc(item.type || "proposal")}</span>
        </div>
        <h4>${esc(item.title || `Proposta ${index + 1}`)}</h4>
        <p>${esc(item.note || "")}</p>
        <div class="proposal-actions">
          <button class="btn btn-secondary" type="button" data-commit-index="${index}">Commit</button>
        </div>
      </div>
    `).join("")}
  `;

  box.querySelectorAll("[data-commit-index]").forEach((button) => {
    button.addEventListener("click", async () => {
      const index = Number(button.getAttribute("data-commit-index"));
      const item = proposals[index];
      if (!item) return;
      button.disabled = true;
      try {
        const result = await fetchJson("/api/assistant/commit", {
          method: "POST",
          body: JSON.stringify({ proposal: item })
        });
        assistantState.answer = `Commit eseguito: ${result.message || "ok"}`;
      } catch (error) {
        assistantState.answer = `Commit fallito: ${error.message}`;
      } finally {
        button.disabled = false;
        renderAssistantState();
      }
    });
  });
}

function renderAll(data) {
  renderSessionMeta(data);
  const nyra = nyraControl?.nyra || null;
  if (nyra?.doctrine?.summary) {
    byId("nyraDoctrine").textContent = nyra.doctrine.summary;
  }
  const queue = buildPriorityQueue(data);
  renderHero(data, queue, nyra);
  renderTempo(data, queue, nyra);
  renderMetricGrid(data);
  renderStrategy(data, queue);
  renderChannels(data, nyra);
  renderPipeline(data, nyra);
  renderCapital(data);
  renderRuntime(data);
  renderFinanceDock(data);
  renderAssistantState();
}

async function loadOverview() {
  const [data, nyra] = await Promise.all([
    fetchJson("/api/overview"),
    fetchJson("/api/nyra/control").catch(() => null)
  ]);
  overview = data;
  nyraControl = nyra;
  renderAll(data);
}

function attachEvents() {
  byId("refreshBtn").addEventListener("click", async () => {
    byId("refreshBtn").disabled = true;
    try {
      await loadOverview();
    } finally {
      byId("refreshBtn").disabled = false;
    }
  });

  byId("syncAllBtn").addEventListener("click", async () => {
    byId("syncAllBtn").disabled = true;
    try {
      const result = await fetchJson("/api/sync/all", { method: "POST" });
      assistantState.answer = `Sync completata. Fonti aggiornate: ${(result.results || []).length || "n.d."}`;
      await loadOverview();
    } catch (error) {
      assistantState.answer = `Sync fallita: ${error.message}`;
      renderAssistantState();
    } finally {
      byId("syncAllBtn").disabled = false;
      renderAssistantState();
    }
  });

  byId("askForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = byId("askInput").value.trim();
    if (!question) return;
    assistantState.answer = "Sto leggendo il contesto operativo...";
    renderAssistantState();
    try {
      const result = await fetchJson("/api/assistant/ai", {
        method: "POST",
        body: JSON.stringify({ question })
      });
      assistantState.answer = result.answer || "Nessuna risposta.";
    } catch (error) {
      assistantState.answer = `Richiesta fallita: ${error.message}`;
    }
    renderAssistantState();
  });

  byId("actionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const prompt = byId("actionInput").value.trim();
    const mode = byId("actionMode").value;
    if (!prompt) return;
    assistantState.proposal = {
      summary: "Sto costruendo una proposta...",
      diagnosis: "",
      proposals: []
    };
    renderAssistantState();
    try {
      const result = await fetchJson("/api/assistant/action", {
        method: "POST",
        body: JSON.stringify({ prompt, mode, scope: "control_desk", cardType: "command_center" })
      });
      assistantState.proposal = result.result || null;
      assistantState.answer = `Proposta generata in modalita ${result.mode}.`;
    } catch (error) {
      assistantState.answer = `Proposta fallita: ${error.message}`;
      assistantState.proposal = null;
    }
    renderAssistantState();
  });
}

async function init() {
  attachEvents();
  try {
    await loadOverview();
  } catch (error) {
    document.body.innerHTML = `<main class="panel" style="margin:24px"><h1>Errore Control Desk</h1><pre>${esc(error.message)}</pre></main>`;
  }
}

init();
