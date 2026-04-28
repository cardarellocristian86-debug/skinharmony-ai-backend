const MODES = {
  finance: {
    label: "Finanza",
    icon: "LN",
    sourceLabel: "Nyra pending",
    state: "In attesa feed Nyra",
    level: "monitor",
    risk: "Basso",
    action: "Attendi primo feed reale",
    reason: "Questo ramo deve leggere solo Nyra reale, non una simulazione scritta.",
    primaryMetric: "Source",
    primaryValue: "pending",
    secondaryMetric: "Stato",
    secondaryValue: "waiting",
    allocation: [
      ["Source", "pending"],
      ["Feed", "in attesa"],
      ["Edge", "n.d."],
      ["Cash", "n.d."]
    ],
    availabilityStatus: "live_pending",
    availabilityNote: "Questo ramo si muove solo quando gli endpoint /api/nyra/finance/* producono report reali.",
    signals: ["Nessun testo finto", "Aspetta Nyra reale", "Report o monitor live", "UI pronta"],
    history: ["Avvio · waiting"],
    bars: [16, 20, 18, 24, 26, 22, 28, 30, 26, 34, 30, 36]
  },
  factory: {
    label: "Fabbrica",
    icon: "FC",
    sourceLabel: "non collegato",
    state: "Ramo non collegato",
    level: "offline",
    risk: "Medio",
    action: "Nessuna lettura reale",
    reason: "Questo dominio non e ancora agganciato alla Nyra reale. Meglio dirlo che fingere una console attiva.",
    primaryMetric: "Source",
    primaryValue: "none",
    secondaryMetric: "Stato",
    secondaryValue: "offline",
    allocation: [
      ["Feed", "assente"],
      ["Source", "none"],
      ["Decisione", "n.d."],
      ["Safety", "n.d."]
    ],
    availabilityStatus: "offline",
    availabilityNote: "Questo ramo non è collegato al runtime Nyra reale. La UI qui resta volutamente ferma.",
    signals: ["Dominio non collegato", "Nessuna Nyra finta", "Serve dataset reale", "UI in attesa"],
    history: ["Offline · no runtime"],
    bars: [12, 14, 16, 15, 18, 20, 17, 19, 16, 18, 17, 19]
  },
  business: {
    label: "Azienda",
    icon: "BZ",
    sourceLabel: "non collegato",
    state: "Ramo non collegato",
    level: "offline",
    risk: "Basso",
    action: "Nessuna lettura reale",
    reason: "Anche qui niente copy scritto che si spaccia per Nyra. Va collegato a un ramo reale prima di usarlo.",
    primaryMetric: "Source",
    primaryValue: "none",
    secondaryMetric: "Stato",
    secondaryValue: "offline",
    allocation: [
      ["Feed", "assente"],
      ["Source", "none"],
      ["Decisione", "n.d."],
      ["Contesto", "n.d."]
    ],
    availabilityStatus: "offline",
    availabilityNote: "Questo ramo non è collegato al runtime Nyra reale. Serve un branch vero prima che la console si muova.",
    signals: ["Dominio non collegato", "Nessuna Nyra finta", "Serve ramo reale", "UI in attesa"],
    history: ["Offline · no runtime"],
    bars: [12, 15, 17, 19, 16, 18, 20, 17, 18, 19, 16, 20]
  }
};

const state = {
  mode: "finance",
  lastMessage: "",
  financeOverride: null,
  financeRaw: null,
  financeHistory: [],
  financeProfile: null,
  financeProfileHistory: [],
  financeLearning: null,
  financeKeepAwake: null,
  financeTreasury: null,
  worldMarketScan: null,
  worldMarketSelection: null,
  worldPaper: null,
  worldPaperAuto: null,
  worldPaperLoading: false,
  worldMarketLoading: false,
  financeLiveLoading: false,
  financeStatusTimer: null,
  worldPaperAutoTimer: null,
  financeDeskOpenFolders: {}
};

const byId = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `HTTP ${response.status}`);
  return text ? JSON.parse(text) : {};
}

function riskClass(risk) {
  const normalized = String(risk || "").toLowerCase();
  if (normalized === "alto") return "risk-alto";
  if (normalized === "medio") return "risk-medio";
  return "risk-basso";
}

function availabilityMeta(modeKey) {
  if (modeKey === "finance") {
    const hasLiveFinance = Boolean(state.financeRaw);
    return {
      label: hasLiveFinance ? "live" : "live pending",
      className: hasLiveFinance ? "availability-live" : "availability-pending",
      note: hasLiveFinance
        ? "Nyra sta leggendo un report reale del ramo finanza."
        : "Questo ramo si muove solo quando gli endpoint /api/nyra/finance/* producono report reali."
    };
  }

  return {
    label: "offline reale",
    className: "availability-offline",
    note: MODES[modeKey]?.availabilityNote || "Ramo non collegato al runtime reale."
  };
}

function renderModeStrip() {
  byId("modeStrip").innerHTML = Object.entries(MODES).map(([key, item]) => `
    <button class="mode-chip ${key === state.mode ? "active" : ""}" type="button" data-mode="${esc(key)}">
      <span class="mode-icon">${esc(item.icon)}</span>
      <span>
        <strong class="mode-title">${esc(item.label)}</strong>
        <small class="mode-state">${esc(item.state)}</small>
      </span>
      <span class="mode-availability ${esc(availabilityMeta(key).className)}">${esc(availabilityMeta(key).label)}</span>
      <span class="status-pill ${riskClass(item.risk)}">${esc(item.risk)}</span>
    </button>
  `).join("");

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      renderDashboard();
    });
  });
}

function toChartPoints(bars = []) {
  const values = (Array.isArray(bars) && bars.length ? bars : [12, 18, 16, 22]).map((value) => Number(value || 0));
  const width = 100;
  const height = 100;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);

  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * 78 - 10;
    return { x, y, value };
  });
}

function chartToneFromStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "selected" || normalized === "entry" || normalized === "exit") return "green";
  if (normalized === "watch") return "yellow";
  if (normalized === "blocked") return "orange";
  if (normalized === "no_trade") return "red";
  return "green";
}

function renderChart(targetId, bars = [], tone = "green") {
  const points = toChartPoints(bars);
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `0,100 ${line} 100,100`;
  const grid = [20, 45, 70].map((y) => `<line class="chart-grid-line" x1="0" y1="${y}" x2="100" y2="${y}"></line>`).join("");
  const nodes = points.map((point) => `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="1.7"></circle>`).join("");

  byId(targetId).innerHTML = `
    <svg class="chart-svg chart-tone-${esc(tone)}" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      ${grid}
      <polygon class="chart-area" points="${area}"></polygon>
      <polyline class="chart-line" points="${line}"></polyline>
      ${nodes}
    </svg>
  `;
}

function buildAssetBars(item) {
  const signed = Math.min(100, Math.abs(Number(item.signed_score || 0)) / 3);
  const adjusted = Math.min(100, Math.abs(Number(item.adjusted_score || 0)) / 3);
  const threshold = Math.max(8, Math.min(100, Number(item.min_strength_required || 0) * 2));
  const riskHeadroom = Math.max(8, 100 - Math.min(92, Number(item.risk_score || 0)));
  const size = Math.max(8, Number(item.size_multiplier || 0) * 35);
  return [signed, adjusted, threshold, riskHeadroom, size];
}

function renderDecisionCard(data) {
  const availability = availabilityMeta(state.mode);
  byId("decisionCard").innerHTML = `
    <div class="decision-top">
      <div>
        <div class="decision-kicker">
          <span class="mode-icon">${esc(data.icon)}</span>
          <span>${esc(data.label)}</span>
          <span>· ${esc(data.sourceLabel || data.source || "manuale")}</span>
        </div>
        <h2 class="decision-title">${esc(data.state)}</h2>
      </div>
      <span class="status-pill ${riskClass(data.risk)}">Rischio ${esc(data.risk)}</span>
    </div>

    <div class="decision-grid">
      <div class="action-box">
        <small>Azione</small>
        <strong class="decision-value">${esc(data.action)}</strong>
      </div>
      <div class="level-box">
        <small>Livello</small>
        <strong class="decision-value">${esc(data.level)}</strong>
      </div>
    </div>

    <div class="reason-box">
      <small>Motivo</small>
      <p>${esc(data.reason)}</p>
    </div>

    <div class="connection-box ${esc(availability.className)}">
      <small>Stato runtime</small>
      <strong>${esc(availability.label)}</strong>
      <p>${esc(availability.note)}</p>
    </div>
  `;
}

function renderAllocation(data) {
  byId("allocationList").innerHTML = data.allocation.map(([label, value]) => `
    <div class="allocation-row">
      <span>${esc(label)}</span>
      <strong>${esc(value)}</strong>
    </div>
  `).join("");
}

function renderSignals(data) {
  byId("signalsGrid").innerHTML = data.signals.map((signal) => `
    <div class="signal-row">
      <span class="signal-mark">OK</span>
      <strong>${esc(signal)}</strong>
    </div>
  `).join("");
}

function renderHistory(data) {
  byId("historyList").innerHTML = data.history.map((item) => `
    <div class="history-row">${esc(item)}</div>
  `).join("");
}

function formatCandidateScore(value) {
  const number = Number(value || 0);
  return number > 0 ? `+${number.toFixed(2)}` : number.toFixed(2);
}

function buildFinanceLiveRows() {
  const diagnostics = state.financeRaw?.candidate_diagnostics;
  const products = state.financeRaw?.scan_products;

  if (Array.isArray(diagnostics) && diagnostics.length) {
    const maxAbsScore = diagnostics.reduce((acc, item) => Math.max(acc, Math.abs(Number(item.adjusted_score || 0))), 1);
    return {
      html: diagnostics.map((item) => {
        const width = Math.max(8, Math.round((Math.abs(Number(item.adjusted_score || 0)) / maxAbsScore) * 100));
        const note = Array.isArray(item.notes) && item.notes.length ? item.notes[0] : "nessuna nota";
        const chartId = `assetChart-${item.product.replace(/[^a-zA-Z0-9_-]/g, "")}`;
        return `
          <div class="finance-asset-row">
            <span class="desk-lane">Crypto live</span>
            <div class="finance-asset-copy">
              <strong>${esc(item.product)}</strong>
              <small>${esc(item.financial_action)} · ${esc(item.microstructure_scenario || "n.d.")}</small>
            </div>
            <div class="asset-mini-chart" id="${esc(chartId)}"></div>
            <div>
              <div class="finance-score-bar"><div class="finance-score-fill" style="width:${width}%"></div></div>
              <small>${esc(note)}</small>
            </div>
            <span class="asset-status ${esc(item.status)}">${esc(item.status)}</span>
            <div class="finance-asset-score">
              <small>score</small>
              <strong>${esc(formatCandidateScore(item.adjusted_score))}</strong>
            </div>
          </div>
        `;
      }).join(""),
      charts: diagnostics.map((item) => ({
        id: `assetChart-${item.product.replace(/[^a-zA-Z0-9_-]/g, "")}`,
        bars: buildAssetBars(item),
        tone: chartToneFromStatus(item.status)
      }))
    };
  }

  if (Array.isArray(products) && products.length) {
    return {
      html: products.map((product) => `
        <div class="finance-asset-row">
          <span class="desk-lane">Crypto live</span>
          <div class="finance-asset-copy">
            <strong>${esc(product)}</strong>
            <small>in attesa prossima lettura</small>
          </div>
          <div></div>
          <div>
            <div class="finance-score-bar"><div class="finance-score-fill" style="width:12%"></div></div>
            <small>nessun candidato ancora esposto</small>
          </div>
          <span class="asset-status no_trade">waiting</span>
          <div class="finance-asset-score">
            <small>score</small>
            <strong>n.d.</strong>
          </div>
        </div>
      `).join(""),
      charts: []
    };
  }

  return {
    html: `<div class="history-row">Nyra non ha ancora esposto un universe live.</div>`,
    charts: []
  };
}

function buildWorldMarketRows() {
  const scan = state.worldMarketScan;
  const selectedSymbol = String(state.worldMarketSelection?.symbol || "");
  if (!scan) {
    return `<div class="history-row">Caricamento automatico mercato mondiale...</div>`;
  }
  const rows = [
    ...(Array.isArray(scan.top_candidates) ? scan.top_candidates.slice(0, 8) : []),
    ...(Array.isArray(scan.watchlist) ? scan.watchlist.slice(0, 4) : [])
  ];
  if (!rows.length) {
    return `<div class="history-row">Scansione completata, nessun candidato pulito.</div>`;
  }
  return rows.map((row) => {
    const isSelected = selectedSymbol && selectedSymbol === row.symbol;
    const thesis = row.multiverse_thesis || null;
    const thesisLabel = thesis
      ? `${thesis.thesis_action || "watch"} · EV ${Number(thesis.expected_value_score || 0).toFixed(1)} · rischio ${Number(thesis.adverse_risk || 0).toFixed(1)}`
      : "tesi non calcolata";
    const newsLabel = row.news_thesis_action
      ? `news ${row.news_thesis_action} · ${Number(row.news_score || 0).toFixed(1)}`
      : "news non lette";
    return `
      <article class="finance-asset-row ${isSelected ? "selected-world-market" : ""}">
        <span class="desk-lane">Mercato globale</span>
        <div class="finance-asset-copy">
          <strong>${esc(row.symbol)}${isSelected ? " · scelto" : ""}</strong>
          <small>${esc(row.name)} · ${esc(row.class)} · ${esc(row.region)}</small>
          <small>${esc(newsLabel)}</small>
          <small>${esc(thesisLabel)}</small>
        </div>
        <div class="finance-asset-score">
          <small>Edge</small>
          <strong>${esc(Number(row.edge_score || 0).toFixed(1))}</strong>
        </div>
        <div class="finance-score-bar">
          <div class="finance-score-fill" style="width:${Math.max(4, Math.min(100, Number(row.edge_score || 0)))}%"></div>
        </div>
        <span class="asset-status ${moveStatusClass(row.action === "candidate" ? "selected" : row.action === "watch" ? "watch" : "blocked")}">${esc(row.action)}</span>
        <button type="button" class="ghost-btn choose-world-market-btn" data-world-symbol="${esc(row.symbol)}">
          ${isSelected ? "Scelto" : "Scegli"}
        </button>
      </article>
    `;
  }).join("");
}

function buildWorldPaperRows() {
  const portfolio = state.worldPaper?.portfolio;
  const summary = state.worldPaper?.summary;
  if (!portfolio || !summary) {
    return `<div class="history-row">Paper trading non ancora inizializzato.</div>`;
  }
  const positions = Array.isArray(portfolio.positions) ? portfolio.positions : [];
  const trades = Array.isArray(portfolio.trades) ? portfolio.trades.slice(0, 6) : [];
  if (!positions.length && !trades.length) {
    return `<div class="history-row">Nessuna posizione paper aperta. Scegli un mercato e premi Prova scelta.</div>`;
  }
  return [
    positions.map((position) => `
      <article class="finance-asset-row">
        <span class="desk-lane">Portafoglio</span>
        <div class="finance-asset-copy">
          <strong>${esc(position.symbol)}</strong>
          <small>${esc(position.name)} · ${esc(position.class)} · ${esc(position.region)} · marcia ${esc(position.gear || "-")}</small>
          <small>${esc(position.multiverse_thesis ? `${position.multiverse_thesis.thesis_action} · EV ${Number(position.multiverse_thesis.expected_value_score || 0).toFixed(1)} · pazienza ${Number(position.multiverse_thesis.patience_score || 0).toFixed(1)}` : "tesi non calcolata")}</small>
        </div>
        <div class="finance-asset-score">
          <small>Valore</small>
          <strong>${esc(formatEur(position.market_value_eur))}</strong>
        </div>
        <div class="finance-asset-score">
          <small>PnL</small>
          <strong class="${Number(position.pnl_eur || 0) >= 0 ? "positive" : "negative"}">${esc(formatEur(position.pnl_eur))}</strong>
        </div>
        <span class="asset-status ${moveStatusClass(position.last_action === "candidate" ? "selected" : position.last_action)}">${esc(position.last_action)}</span>
        <span class="move-tag">${esc(String(position.pnl_pct || 0))}%</span>
      </article>
    `).join(""),
    trades.map((trade) => `
      <article class="finance-asset-row">
        <span class="desk-lane">Evento</span>
        <div class="finance-asset-copy">
          <strong>${esc(trade.symbol)}</strong>
          <small>${esc(trade.type)} · ${esc(trade.at)} · marcia ${esc(trade.gear || "-")}</small>
        </div>
        <div class="finance-asset-score">
          <small>Prezzo</small>
          <strong>${esc(Number(trade.price || 0).toFixed(2))}</strong>
        </div>
        <div class="finance-asset-score">
          <small>Motivo</small>
          <strong>${esc(trade.reason || "-")}</strong>
        </div>
        <span class="asset-status ${moveStatusClass(trade.type === "entry" ? "selected" : trade.type === "exit" ? "watch" : "blocked")}">${esc(trade.type)}</span>
        <span class="move-tag">${esc(trade.class || "-")}</span>
      </article>
    `).join("")
  ].filter(Boolean).join("");
}

function buildWorldPaperMovementChart() {
  const portfolio = state.worldPaper?.portfolio;
  const summary = state.worldPaper?.summary;
  if (!portfolio || !summary) {
    return `<section class="paper-equity-panel"><div class="history-row">Grafico movimenti non ancora disponibile.</div></section>`;
  }

  const initialCapital = Number(portfolio.initial_capital_eur || 100000);
  const currentCapital = Number(summary.capital_eur || initialCapital);
  const trades = (Array.isArray(portfolio.trades) ? portfolio.trades : [])
    .filter((trade) => trade?.at)
    .slice()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const realizedEvents = trades
    .filter((trade) => Number.isFinite(Number(trade.pnl_eur)))
    .map((trade) => ({
      at: trade.at,
      symbol: trade.symbol || "-",
      type: trade.type || "trade",
      pnl: Number(trade.pnl_eur || 0),
      reason: trade.reason || ""
    }));

  let runningCapital = initialCapital;
  const points = [{ at: portfolio.started_at || trades[0]?.at || "", value: initialCapital, pnl: 0, symbol: "START", type: "start", reason: "Capitale iniziale" }];
  realizedEvents.forEach((event) => {
    runningCapital += event.pnl;
    points.push({ ...event, value: runningCapital });
  });
  points.push({
    at: summary.generated_at || portfolio.updated_at || new Date().toISOString(),
    value: currentCapital,
    pnl: currentCapital - runningCapital,
    symbol: "ORA",
    type: "mark_to_market",
    reason: "Capitale attuale, incluse posizioni aperte"
  });

  const values = points.map((point) => Number(point.value || 0));
  const minValue = Math.min(initialCapital, ...values);
  const maxValue = Math.max(initialCapital, ...values);
  const padding = Math.max(250, (maxValue - minValue) * 0.15);
  const chartMin = minValue - padding;
  const chartMax = maxValue + padding;
  const span = Math.max(1, chartMax - chartMin);
  const width = 1000;
  const height = 260;
  const left = 34;
  const right = 24;
  const top = 18;
  const bottom = 34;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const toX = (index) => left + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
  const toY = (value) => top + (1 - ((Number(value || 0) - chartMin) / span)) * innerH;
  const baselineY = toY(initialCapital);
  const path = points.map((point, index) => `${toX(index)},${toY(point.value)}`).join(" ");
  const currentAbove = currentCapital >= initialCapital;
  const wins = realizedEvents.filter((event) => event.pnl > 0).length;
  const losses = realizedEvents.filter((event) => event.pnl < 0).length;
  const lastPoints = points.slice(-18);
  const startIndex = points.length - lastPoints.length;
  const markers = lastPoints.map((point, localIndex) => {
    const index = startIndex + localIndex;
    const pnl = Number(point.pnl || 0);
    const tone = point.type === "start" ? "neutral" : pnl > 0 ? "win" : pnl < 0 ? "loss" : Number(point.value || 0) >= initialCapital ? "above" : "below";
    return `
      <circle class="paper-equity-marker ${tone}" cx="${toX(index)}" cy="${toY(point.value)}" r="${point.symbol === "ORA" ? 7 : 5}">
        <title>${esc(point.symbol)} · ${esc(point.type)} · capitale ${esc(formatEur(point.value))} · movimento ${esc(formatEur(pnl))}</title>
      </circle>
    `;
  }).join("");
  const recentRows = realizedEvents.slice(-6).reverse().map((event) => `
    <div class="paper-move-chip ${event.pnl >= 0 ? "win" : "loss"}">
      <strong>${esc(event.symbol)}</strong>
      <span>${esc(formatEur(event.pnl))}</span>
    </div>
  `).join("");

  return `
    <section class="paper-equity-panel ${currentAbove ? "above" : "below"}">
      <div class="paper-equity-head">
        <div>
          <small>Movimenti Nyra</small>
          <strong>${currentAbove ? "Sopra capitale iniziale" : "Sotto capitale iniziale"}</strong>
        </div>
        <div class="paper-equity-status ${currentAbove ? "positive" : "negative"}">
          ${esc(formatEur(currentCapital - initialCapital))}
        </div>
      </div>
      <svg class="paper-equity-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafico capitale paper Nyra">
        <rect class="paper-equity-zone-above" x="${left}" y="${top}" width="${innerW}" height="${Math.max(0, baselineY - top)}"></rect>
        <rect class="paper-equity-zone-below" x="${left}" y="${baselineY}" width="${innerW}" height="${Math.max(0, top + innerH - baselineY)}"></rect>
        <line class="paper-equity-baseline" x1="${left}" y1="${baselineY}" x2="${width - right}" y2="${baselineY}"></line>
        <polyline class="paper-equity-line ${currentAbove ? "above" : "below"}" points="${path}"></polyline>
        ${markers}
        <text class="paper-equity-label" x="${left}" y="${Math.max(14, baselineY - 7)}">100.000 EUR</text>
      </svg>
      <div class="paper-equity-legend">
        <span class="legend-dot win"></span><span>vince / realizza profitto</span>
        <span class="legend-dot loss"></span><span>perde / realizza perdita</span>
        <span class="legend-line"></span><span>capitale iniziale</span>
      </div>
      <div class="paper-equity-stats">
        <span>Capitale attuale <strong>${esc(formatEur(currentCapital))}</strong></span>
        <span>Movimenti vincenti <strong class="positive">${esc(String(wins))}</strong></span>
        <span>Movimenti perdenti <strong class="negative">${esc(String(losses))}</strong></span>
        <span>Delta QQQ <strong class="${Number(summary.alpha_vs_qqq_eur || 0) >= 0 ? "positive" : "negative"}">${esc(formatEur(summary.alpha_vs_qqq_eur || 0))}</strong></span>
      </div>
      ${recentRows ? `<div class="paper-recent-moves">${recentRows}</div>` : ""}
    </section>
  `;
}

function buildSelfDiagnosisCard() {
  const diagnosis = state.worldPaper?.selfDiagnosis || state.worldPaperAuto?.selfDiagnosis || null;
  if (!diagnosis) {
    return `
      <div class="desk-summary-card self-diagnosis-card">
        <small>Autodiagnosi Nyra</small>
        <strong>non ancora disponibile</strong>
        <p>Serve almeno un ciclo paper per collegare lettura mercato, esecuzione e spiegazione.</p>
      </div>
    `;
  }
  const self = diagnosis.self_diagnosis || {};
  const levels = diagnosis.three_levels || {};
  const summary = diagnosis.summary || {};
  const decision = diagnosis.decision_report || {};
  const postTrade = diagnosis.post_trade_analysis || {};
  const severity = String(self.severity || "low");
  return `
    <div class="desk-summary-card self-diagnosis-card severity-${esc(severity)}">
      <small>Autodiagnosi Nyra</small>
      <strong>${esc(self.main_error_label || "collo non isolato")}</strong>
      <p>${esc(self.evidence || "Nyra sta collegando risultato, motivo e prossima correzione.")}</p>
      <div class="self-diagnosis-grid">
        <div>
          <span>Lettura mercato</span>
          <strong>${esc(levels.market_reading || "-")}</strong>
        </div>
        <div>
          <span>Esecuzione</span>
          <strong>${esc(levels.execution || "-")}</strong>
        </div>
        <div>
          <span>Perche</span>
          <strong>${esc(levels.explanation || self.prudent_correction || "-")}</strong>
        </div>
      </div>
      <div class="desk-tags">
        <span>win ${esc(String(summary.win_count_recent ?? 0))}</span>
        <span>loss ${esc(String(summary.loss_count_recent ?? 0))}</span>
        <span>hold/skip ${esc(String(summary.hold_or_skip_recent ?? 0))}</span>
        <span>fee ${esc(formatEur(summary.fees_total_eur || 0))}</span>
        <span class="${Number(summary.alpha_vs_qqq_eur || 0) >= 0 ? "positive" : "negative"}">vs QQQ ${esc(formatEur(summary.alpha_vs_qqq_eur || 0))}</span>
      </div>
      <details class="self-diagnosis-details">
        <summary>Report decisione</summary>
        <div class="self-diagnosis-grid">
          <div><span>Qualita lettura</span><strong>${esc(formatPct(Number(decision.market_read_quality || 0)))}</strong></div>
          <div><span>Expected edge</span><strong>${esc(String(decision.expected_edge ?? "-"))}</strong></div>
          <div><span>Pressione costi</span><strong>${esc(formatPct(Number(decision.cost_pressure || 0)))}</strong></div>
          <div><span>Pressione rischio</span><strong>${esc(formatPct(Number(decision.risk_pressure || 0)))}</strong></div>
          <div><span>Errore se sbaglia</span><strong>${esc(decision.error_if_wrong || "-")}</strong></div>
          <div><span>Confidence reale</span><strong>${esc(formatPct(Number(decision.confidence_real || 0)))}</strong></div>
        </div>
      </details>
      <details class="self-diagnosis-details">
        <summary>Post-trade analysis</summary>
        <div class="self-diagnosis-grid">
          <div><span>Outcome</span><strong>${esc(postTrade.outcome || "-")}</strong></div>
          <div><span>Causa</span><strong>${esc(postTrade.cause || "-")}</strong></div>
          <div><span>Evitabile</span><strong>${postTrade.avoidable ? "si" : "no"}</strong></div>
          <div><span>Correzione</span><strong>${esc(postTrade.correction || "-")}</strong></div>
        </div>
      </details>
    </div>
  `;
}

function renderFinanceDeskBoard() {
  const container = byId("financeDeskBoard");
  const autoStatus = byId("worldPaperAutoStatus");
  if (state.mode !== "finance") {
    container.innerHTML = `<div class="history-row">Disponibile solo nel ramo finanza.</div>`;
    if (autoStatus) autoStatus.innerHTML = "";
    return;
  }
  if (autoStatus) {
    const auto = state.worldPaperAuto;
    autoStatus.innerHTML = auto
      ? `<small>Auto loop: ${auto.enabled ? "attivo" : "spento"} · running: ${auto.running ? "si" : "no"} · ultimo: ${esc(auto.lastResult?.symbol || "-")} · studio asset: ${auto.lastResult?.assetHistoryAware ? "si" : "no"}${auto.lastResult?.assetBehavior ? `/${esc(auto.lastResult.assetBehavior)}` : ""} · prossimo: ${esc(formatClock(auto.nextRunAt))} · errore: ${esc(auto.lastError || "nessuno")}</small>`
      : `<small>Auto loop: stato non caricato</small>`;
  }
  const summary = state.worldPaper?.summary;
  const learning = state.worldPaper?.learning || state.worldPaperAuto?.learning || null;
  const treasury = state.financeTreasury;
  const benchmark = summary?.benchmark || treasury?.benchmark || null;
  const learningState = learning?.learning_state || "observe";
  const learningPolicy = learning?.policy || {};
  const liveRows = buildFinanceLiveRows();
  const marketRows = buildWorldMarketRows();
  const paperRows = buildWorldPaperRows();
  const movementChart = buildWorldPaperMovementChart();
  const selfDiagnosisCard = buildSelfDiagnosisCard();
  const previousOpenFolders = {};
  container.querySelectorAll(".desk-folder[data-folder]").forEach((folder) => {
    previousOpenFolders[folder.dataset.folder] = folder.open;
  });
  state.financeDeskOpenFolders = {
    ...state.financeDeskOpenFolders,
    ...previousOpenFolders
  };
  container.innerHTML = `
    <div class="finance-desk-summary">
      <div class="desk-summary-card">
        <small>Tesoreria unica</small>
        <strong>${esc(formatEur(treasury?.totalCapitalEur || summary?.capital_eur || 0))}</strong>
        <p>Capitale condiviso tra crypto live, mercati globali e riserva cash.</p>
        <div class="desk-tags">
          <span>libero ${esc(formatEur(treasury?.freeCapitalEur || 0))}</span>
          <span>live ${esc(formatEur(treasury?.liveReservedEur || 0))}</span>
          <span>paper ${esc(formatEur(treasury?.paperInvestedEur || 0))}</span>
        </div>
      </div>
      <div class="desk-summary-card">
        <small>Rotazione Nyra</small>
        <strong>${esc(treasury?.worldRotation?.primaryClass || "-")}${treasury?.worldRotation?.secondaryClass ? ` -> ${esc(treasury.worldRotation.secondaryClass)}` : ""}</strong>
        <p>${esc(treasury?.worldRotation?.reason || "Nyra non ha ancora una rotazione attiva.")}</p>
        <div class="desk-tags">
          ${(Array.isArray(treasury?.worldRotation?.rankedClasses) ? treasury.worldRotation.rankedClasses.slice(0, 4) : []).map((item) => `<span>${esc(item.assetClass)} ${esc(Number(item.score || 0).toFixed(1))}</span>`).join("")}
        </div>
      </div>
      <div class="desk-summary-card">
        <small>Apprendimento</small>
        <strong>${esc(learningState)}</strong>
        <p>${esc(learningPolicy.reason || "Nyra osserva i cicli e corregge la disciplina quando vede un collo reale.")}</p>
        <div class="desk-tags">
          ${learningPolicy.paper_area_is_test_lab ? `<span>area test</span>` : ""}
          ${learningPolicy.paper_capital_replenishable ? `<span>capitale ricaricabile</span>` : ""}
          ${learningPolicy.fee_bleed_guard_active ? `<span>anti fee bleed</span>` : ""}
          ${learningPolicy.benchmark_recovery_required ? `<span>recupero vs QQQ</span>` : ""}
          <span>${learningPolicy.pause_new_entries ? "nuove entrate quasi bloccate" : learningPolicy.elastic_choice_enabled ? "nuove entrate elastiche" : "nuove entrate permesse"}</span>
          ${learningPolicy.max_new_position_multiplier !== undefined ? `<span>size x${esc(Number(learningPolicy.max_new_position_multiplier || 0).toFixed(2))}</span>` : ""}
          ${learningState === "hard_profit_learning" ? `<span>hard learning: cerca profitto paper</span>` : ""}
          ${learningPolicy.conviction_rule ? `<span>confidence hold</span>` : ""}
          <span>cash reserve ${esc(formatEur(treasury?.marketAllocation?.cashReserveEur || 0))}</span>
        </div>
        ${learningPolicy.conviction_rule ? `<small>${esc(learningPolicy.conviction_rule)}</small>` : ""}
        ${learningPolicy.anti_robinhood_rule ? `<small>${esc(learningPolicy.anti_robinhood_rule)}</small>` : ""}
        ${learningPolicy.training_directive ? `<small>${esc(learningPolicy.training_directive)}</small>` : ""}
      </div>
      <div class="desk-summary-card">
        <small>Benchmark QQQ</small>
        <strong>${benchmark ? esc(`${formatEur(benchmark.current_value_eur || 0)} · ${Number(benchmark.pnl_pct || 0).toFixed(2)}%`) : "non pronto"}</strong>
        <p>${benchmark ? esc(`Buy and hold QQQ dallo stesso capitale iniziale. Prezzo iniziale ${Number(benchmark.initial_price || 0).toFixed(2)}, attuale ${Number(benchmark.current_price || 0).toFixed(2)}.`) : "Serve almeno una scansione mercato mondiale con QQQ disponibile."}</p>
        <div class="desk-tags">
          <span>Nyra ${esc(formatEur(summary?.pnl_eur || 0))}</span>
          <span>QQQ ${esc(formatEur(benchmark?.pnl_eur || 0))}</span>
          <span>${esc(`delta ${formatEur(summary?.alpha_vs_qqq_eur || 0)}`)}</span>
        </div>
      </div>
      ${selfDiagnosisCard}
    </div>
    ${movementChart}
    <div class="finance-desk-folders">
      <details class="desk-folder" data-folder="monitor_live" ${state.financeDeskOpenFolders.monitor_live ? "open" : ""}>
        <summary>
          <span>Monitor live</span>
          <strong>${esc(liveRows.charts.length ? `${liveRows.charts.length} asset` : "apri")}</strong>
        </summary>
        <div class="finance-desk-stream">
          ${liveRows.html}
        </div>
      </details>
      <details class="desk-folder" data-folder="world_market" ${state.financeDeskOpenFolders.world_market ? "open" : ""}>
        <summary>
          <span>Mercato mondiale</span>
          <strong>${esc(`${state.worldMarketScan?.output?.market_breadth_candidates || state.worldMarketScan?.top_candidates?.length || 0} candidati`)}</strong>
        </summary>
        <div class="finance-desk-stream">
          ${marketRows}
        </div>
      </details>
      <details class="desk-folder" data-folder="paper_portfolio" ${state.financeDeskOpenFolders.paper_portfolio ? "open" : ""}>
        <summary>
          <span>Portafoglio paper e ultimi eventi</span>
          <strong>${esc(`${state.worldPaper?.summary?.positions_count || 0} posizioni`)}</strong>
        </summary>
        <div class="finance-desk-stream">
          ${paperRows}
        </div>
      </details>
    </div>
  `;
  liveRows.charts.forEach((item) => {
    renderChart(item.id, item.bars, item.tone);
  });
  container.querySelectorAll(".desk-folder[data-folder]").forEach((folder) => {
    folder.addEventListener("toggle", () => {
      state.financeDeskOpenFolders[folder.dataset.folder] = folder.open;
    });
  });
}

function moveStatusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "selected" || normalized === "entry" || normalized === "exit") return "selected";
  if (normalized === "watch") return "watch";
  return "blocked";
}

function formatEur(value) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} EUR`;
}

function renderPrimaryStrip() {
  const paperSummary = state.worldPaper?.summary || null;
  const paperPortfolio = state.worldPaper?.portfolio || null;
  const raw = state.financeRaw;
  const hasPaperCapital = Number.isFinite(Number(paperSummary?.capital_eur));
  const capital = hasPaperCapital
    ? Number(paperPortfolio?.initial_capital_eur || 100000)
    : Number(raw?.capital_eur || 0);
  const current = hasPaperCapital
    ? Number(paperSummary.capital_eur || 0)
    : capital + Number(raw?.aggregate?.total_pnl_eur || 0);
  const pnl = hasPaperCapital
    ? Number(paperSummary.pnl_eur || current - capital)
    : Number(raw?.aggregate?.total_pnl_eur || 0);
  const profit = pnl > 0 ? pnl : 0;
  const loss = pnl < 0 ? Math.abs(pnl) : 0;

  byId("primaryCapitalStart").textContent = capital ? formatEur(capital) : "-";
  byId("primaryProfit").textContent = formatEur(profit);
  byId("primaryCapitalCurrent").textContent = capital ? formatEur(current) : "-";
  byId("primaryLoss").textContent = formatEur(loss);
}

function formatPct(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function profileLabel(profile) {
  return {
    capital_protection: "Capital protection",
    balanced_growth: "Balanced growth",
    aggressive_growth: "Aggressive growth",
    hard_growth: "Hard growth",
    overdrive_5_auto_only: "Overdrive 5",
    overdrive_6_auto_only: "Overdrive 6",
    overdrive_7_auto_only: "Overdrive 7"
  }[profile] || profile || "-";
}

function isManualFinanceProfile(profile) {
  return ["capital_protection", "balanced_growth", "aggressive_growth", "hard_growth"].includes(String(profile || ""));
}

function renderProfilePanel() {
  const profile = state.financeProfile;
  const autoBtn = byId("modeAutoBtn");
  const manualBtn = byId("modeManualBtn");
  const select = byId("manualProfileSelect");
  const modeNote = byId("profileModeRuntimeNote");
  if (!profile) {
    byId("profileCurrent").textContent = "-";
    byId("profileGear").textContent = "-";
    byId("profileRiskCap").textContent = "-";
    byId("profileCash").textContent = "-";
    byId("profileWarning").hidden = true;
    autoBtn.classList.remove("active-choice");
    manualBtn.classList.remove("active-choice");
    if (modeNote) modeNote.textContent = "Caricamento profilo Nyra finanza.";
    return;
  }

  const mode = profile.mode || "auto";
  const currentProfile = String(profile.currentProfile || "");
  const manualProfile = String(profile.manualProfile || "hard_growth");
  autoBtn.classList.toggle("active-choice", mode === "auto");
  manualBtn.classList.toggle("active-choice", mode === "manual");
  select.disabled = mode !== "manual";
  select.value = mode === "auto" && isManualFinanceProfile(currentProfile) ? currentProfile : manualProfile;
  select.title =
    mode === "auto"
      ? "Automatico attivo: il menu mostra la marcia effettiva scelta da Nyra, non una scelta manuale."
      : "Manuale attivo: la marcia scelta qui viene applicata davvero.";
  if (modeNote) {
    modeNote.textContent =
      mode === "auto"
        ? `Automatico attivo: Nyra sta usando davvero ${profileLabel(profile.currentProfile)} / Marcia ${profile.currentGear || "-"}. La marcia manuale salvata (${profileLabel(manualProfile)}) non comanda finche non passi a Manuale.`
        : `Manuale attivo: Nyra usa la marcia scelta da te (${profileLabel(manualProfile)}). Se vede rischio, puo solo avvisare.`;
  }
  byId("profileCurrent").textContent = profileLabel(profile.currentProfile);
  byId("profileGear").textContent = `Marcia ${profile.currentGear || "-"}`;
  byId("profileRiskCap").textContent = formatPct(profile.riskyWeight || 0);
  byId("profileCash").textContent = formatPct(profile.cashWeight || 0);

  const warningBox = byId("profileWarning");
  const warning = profile.warning || null;
  const currentGear = Number(profile.currentGear || 0);
  const recommendedGear = Number(warning?.recommendedGear || currentGear);
  const recommendedProfile = String(warning?.recommendedProfile || currentProfile);
  const warningIsActionable =
    warning &&
    mode === "manual" &&
    (recommendedGear !== currentGear || recommendedProfile !== currentProfile);
  if (!warningIsActionable) {
    warningBox.hidden = true;
    return;
  }
  warningBox.hidden = false;
  byId("profileWarningTitle").textContent = warning.kind === "accelerate" ? "Nyra chiede accelerazione" : "Nyra chiede frenata";
  byId("profileWarningMessage").textContent = `${warning.message} Profilo suggerito: ${profileLabel(warning.recommendedProfile)}.`;
}

function formatProfileHistoryTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderProfileHistory() {
  const container = byId("profileHistoryList");
  const rows = Array.isArray(state.financeProfileHistory) ? [...state.financeProfileHistory].reverse() : [];
  if (!rows.length) {
    container.innerHTML = `<div class="history-row">Ancora nessun cambio marcia registrato.</div>`;
    return;
  }

  container.innerHTML = rows.map((row) => {
    const fromProfile = row.fromProfile ? profileLabel(row.fromProfile) : "inizio";
    const toProfile = profileLabel(row.toProfile);
    const modeLabel = (row.modeTo || "auto") === "manual" ? "MANUALE" : "AUTO";
    return `
      <article class="profile-history-row">
        <div class="profile-history-top">
          <strong>${esc(formatProfileHistoryTime(row.timestamp))}</strong>
          <span class="move-tag">${esc(modeLabel)}</span>
        </div>
        <div class="profile-history-shift">
          <span>Marcia ${esc(String(row.fromGear ?? "-"))}</span>
          <span class="profile-history-arrow">-></span>
          <span>Marcia ${esc(String(row.toGear ?? "-"))}</span>
        </div>
        <div class="profile-history-copy">
          <strong>${esc(fromProfile)}</strong>
          <span class="profile-history-arrow">-></span>
          <strong>${esc(toProfile)}</strong>
        </div>
        <div class="move-reason">${esc(row.selectorReason || row.reason || "Nessun motivo disponibile.")}</div>
      </article>
    `;
  }).join("");
}

function renderFinanceLearningState() {
  const learning = state.financeLearning || {};
  const policy = learning.selected_policy || "observe";
  const status = learning.learning_state || "observe";
  byId("financeLearningState").textContent = `${status.replaceAll("_", " ")} · ${policy.replace(/^live_/, "").replaceAll("_", " ")}`;
}

function renderFinanceKeepAwakeState() {
  const keepAwake = state.financeKeepAwake || {};
  const battery = keepAwake.battery || {};
  let stateLabel = "spento";
  if (keepAwake.active) stateLabel = "attivo";
  else if (keepAwake.enabled) stateLabel = "in attesa";
  byId("financeKeepAwakeState").textContent = stateLabel;

  const batteryPercent = Number.isFinite(Number(battery.batteryPercent)) ? `${Number(battery.batteryPercent)}%` : "n/d";
  const source = battery.powerSource === "ac"
    ? "AC"
    : battery.powerSource === "battery"
      ? "batteria"
      : "fonte n/d";
  const charging = battery.charging === true ? "carica" : battery.charging === false ? "scarica" : "stato n/d";
  byId("financeKeepAwakeBattery").textContent = `${batteryPercent} · ${source} · ${charging}`;
}

function renderFinanceMoves() {
  const container = byId("financeMoves");
  if (state.mode !== "finance") {
    container.innerHTML = `<div class="history-row">Disponibile solo nel ramo finanza.</div>`;
    return;
  }

  const raw = state.financeRaw;
  if (!raw) {
    container.innerHTML = `<div class="history-row">Nessun report live ancora disponibile.</div>`;
    return;
  }

  const portfolio = Array.isArray(raw.portfolio) ? raw.portfolio : [];
  const exits = Array.isArray(raw.exits) ? raw.exits : [];
  const diagnostics = Array.isArray(raw.candidate_diagnostics) ? raw.candidate_diagnostics : [];
  const rows = [];

  portfolio.forEach((position) => {
    rows.push({
      kind: "entry",
      title: `${position.product} ${position.side}`,
      status: "selected",
      meta: [
        `capitale lordo ${Number(position.capital_gross_eur || 0).toFixed(2)} EUR`,
        `peso ${Number(position.weight_pct || 0).toFixed(2)}%`,
        `scenario ${position.microstructure_scenario || "n.d."}`
      ],
      reason: `Nyra ha aperto questa posizione virtuale perche il candidato ha passato i gate. Action: ${position.financial_action}.`,
      tags: Array.isArray(position.learning_notes) ? position.learning_notes : []
    });
  });

  exits.forEach((exit) => {
    rows.push({
      kind: "exit",
      title: `${exit.product} ${exit.side}`,
      status: exit.profitable ? "selected" : "no_trade",
      meta: [
        `pnl ${Number(exit.pnl_eur || 0).toFixed(2)} EUR`,
        `${Number(exit.pnl_pct || 0).toFixed(2)}%`,
        `chiusura ${exit.exit_reason || "n.d."}`
      ],
      reason: `Nyra ha chiuso la posizione virtuale al termine della finestra di osservazione.`,
      tags: [exit.profitable ? "profittevole" : "non profittevole"]
    });
  });

  diagnostics
    .filter((item) => item.status !== "selected")
    .forEach((item) => {
      rows.push({
        kind: item.status,
        title: `${item.product} ${item.side}`,
        status: item.status,
        meta: [
          `score ${formatCandidateScore(item.adjusted_score)}`,
          `action ${item.financial_action || "n.d."}`,
          `scenario ${item.microstructure_scenario || "n.d."}`
        ],
        reason: item.status === "blocked"
          ? `Nyra vedeva una mossa ma l'ha bloccata per disciplina o rischio.`
          : item.status === "watch"
            ? `Nyra lo tiene in osservazione ma non ha ancora conferma piena.`
            : `Nyra non ha visto edge sufficiente per entrare.`,
        tags: Array.isArray(item.notes) ? item.notes : []
      });
    });

  if (!rows.length) {
    container.innerHTML = `<div class="history-row">Nessun movimento registrato nel ciclo corrente.</div>`;
    return;
  }

  container.innerHTML = rows.map((row) => `
    <article class="move-row">
      <div class="move-head">
        <div class="move-title">
          <strong>${esc(row.title)}</strong>
          <span class="asset-status ${moveStatusClass(row.status)}">${esc(row.kind)}</span>
        </div>
      </div>
      <div class="move-meta">${row.meta.map((item) => `<span>${esc(item)}</span>`).join("")}</div>
      <div class="move-reason">${esc(row.reason)}</div>
      <div class="move-tags">${(row.tags || []).map((tag) => `<span class="move-tag">${esc(tag)}</span>`).join("")}</div>
    </article>
  `).join("");
}

function formatHistoryTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderFinanceHistory() {
  const container = byId("financeHistory");
  if (state.mode !== "finance") {
    container.innerHTML = `<div class="history-row">Disponibile solo nel ramo finanza.</div>`;
    return;
  }

  const rows = Array.isArray(state.financeHistory) ? [...state.financeHistory].reverse() : [];
  if (!rows.length) {
    container.innerHTML = `<div class="history-row">Ancora nessun ciclo storico salvato.</div>`;
    return;
  }

  container.innerHTML = rows.map((row) => {
    const candidate = row.topCandidate;
    const pnl = Number(row.totalPnlEur || 0);
    const pnlLabel = pnl > 0 ? `+${pnl.toFixed(2)}` : pnl.toFixed(2);
    const status = row.selectedPositions > 0 ? "selected" : (candidate?.status || "no_trade");
    return `
      <article class="history-summary-row">
        <div class="history-summary-top">
          <div class="history-summary-title">
            <strong>${esc(formatHistoryTime(row.generatedAt))}</strong>
            <small>${esc(row.source || "n.d.")} · capitale ${esc(String(row.capitalEur || 0))} EUR</small>
          </div>
          <span class="asset-status ${moveStatusClass(status)}">${esc(status)}</span>
        </div>
        <div class="history-summary-metrics">
          <span class="move-tag">posizioni ${esc(String(row.selectedPositions || 0))}</span>
          <span class="move-tag">pnl ${esc(pnlLabel)} EUR</span>
          <span class="move-tag">avg ${esc(Number(row.avgPnlPct || 0).toFixed(2))}%</span>
          <span class="move-tag">blocked ${esc(String(row.blockedCount || 0))}</span>
          <span class="move-tag">watch ${esc(String(row.watchCount || 0))}</span>
          <span class="move-tag">no_trade ${esc(String(row.noTradeCount || 0))}</span>
        </div>
        <div class="move-reason">
          ${esc(candidate ? `${candidate.product} ${candidate.side} · ${candidate.action} · ${candidate.scenario}` : "Nessun candidato dominante in questo ciclo.")}
        </div>
        <div class="move-tags">${(candidate?.notes || []).map((tag) => `<span class="move-tag">${esc(tag)}</span>`).join("")}</div>
      </article>
    `;
  }).join("");
}

function renderFinanceAnalytics() {
  const history = Array.isArray(state.financeHistory) ? state.financeHistory : [];
  if (state.mode !== "finance" || !history.length) {
    renderChart("equityChart", [12, 16, 14, 18], "yellow");
    byId("assetPnlBoard").innerHTML = `<div class="history-row">Nessun dato asset ancora disponibile.</div>`;
    return;
  }

  let capitalCursor = Number(history[0]?.capitalEur || 0);
  const equityBars = history.map((row) => {
    capitalCursor += Number(row.totalPnlEur || 0);
    return capitalCursor;
  });
  const lastPnl = Number(history[history.length - 1]?.totalPnlEur || 0);
  renderChart("equityChart", equityBars, lastPnl > 0 ? "green" : lastPnl < 0 ? "red" : "yellow");

  const assetMap = new Map();
  history.forEach((row) => {
    const assets = Array.isArray(row.assets) ? row.assets : [];
    assets.forEach((asset) => {
      const current = assetMap.get(asset.product) || {
        product: asset.product,
        pnlEur: 0,
        selected: 0,
        blocked: 0,
        noTrade: 0,
        watch: 0
      };
      current.pnlEur += Number(asset.pnlEur || 0);
      current.selected += asset.status === "selected" ? 1 : 0;
      current.blocked += asset.status === "blocked" ? 1 : 0;
      current.noTrade += asset.status === "no_trade" ? 1 : 0;
      current.watch += asset.status === "watch" ? 1 : 0;
      assetMap.set(asset.product, current);
    });
  });

  const assetRows = [...assetMap.values()]
    .sort((a, b) => Math.abs(b.pnlEur) - Math.abs(a.pnlEur));

  byId("assetPnlBoard").innerHTML = assetRows.map((asset) => {
    const positive = asset.pnlEur > 0;
    const negative = asset.pnlEur < 0;
    return `
      <div class="asset-pnl-row">
        <div class="asset-pnl-copy">
          <strong>${esc(asset.product)}</strong>
          <small>selected ${esc(String(asset.selected))} · blocked ${esc(String(asset.blocked))} · watch ${esc(String(asset.watch))} · no_trade ${esc(String(asset.noTrade))}</small>
        </div>
        <div class="asset-pnl-value ${positive ? "positive" : negative ? "negative" : ""}">
          ${esc(formatEur(asset.pnlEur))}
        </div>
      </div>
    `;
  }).join("");
}

function renderMobile(data) {
  byId("mobileRisk").className = `status-pill ${riskClass(data.risk)}`;
  byId("mobileRisk").textContent = data.risk;
  byId("mobileState").textContent = data.state;
  byId("mobileAction").textContent = data.action;
  byId("mobileReason").textContent = data.reason;
  byId("mobilePrimaryLabel").textContent = data.primaryMetric;
  byId("mobilePrimaryValue").textContent = data.primaryValue;
  byId("mobileSecondaryLabel").textContent = data.secondaryMetric;
  byId("mobileSecondaryValue").textContent = data.secondaryValue;
  renderChart("mobileChart", data.bars, chartToneFromStatus(state.financeRaw?.aggregate?.selected_positions > 0 ? "selected" : state.financeRaw?.candidate_diagnostics?.[0]?.status || "watch"));
}

function renderMetrics(data) {
  byId("primaryMetricLabel").textContent = data.primaryMetric;
  byId("primaryMetricValue").textContent = data.primaryValue;
  byId("secondaryMetricLabel").textContent = data.secondaryMetric;
  byId("secondaryMetricValue").textContent = data.secondaryValue;
}

function renderDashboard() {
  const data = state.mode === "finance" && state.financeOverride ? state.financeOverride : MODES[state.mode];
  document.querySelector(".nyra-page")?.classList.toggle("finance-focus", state.mode === "finance");
  renderModeStrip();
  renderProfilePanel();
  renderPrimaryStrip();
  renderDecisionCard(data);
  renderChart("miniChart", data.bars, chartToneFromStatus(state.financeRaw?.aggregate?.selected_positions > 0 ? "selected" : state.financeRaw?.candidate_diagnostics?.[0]?.status || "watch"));
  renderMetrics(data);
  renderAllocation(data);
  renderSignals(data);
  renderHistory(data);
  renderFinanceDeskBoard();
  renderFinanceMoves();
  renderFinanceHistory();
  renderFinanceAnalytics();
  renderProfileHistory();
  renderFinanceLearningState();
  renderFinanceKeepAwakeState();
  renderMobile(data);
}

async function loadFinanceMode() {
  try {
    const response = await fetchJson("/api/nyra/finance");
    if (response?.finance) {
      state.financeOverride = response.finance;
      state.financeRaw = null;
      state.financeHistory = [];
      state.financeProfile = response.profile || state.financeProfile;
      state.financeProfileHistory = Array.isArray(response.history) ? response.history : state.financeProfileHistory;
      state.financeLearning = response.realtimeAutoimprovement || state.financeLearning;
      if (state.mode === "finance") renderDashboard();
    }
  } catch (_error) {
    state.financeOverride = null;
    state.financeRaw = null;
    state.financeHistory = [];
  }
}

async function refreshFinanceProfile() {
  try {
    const response = await fetchJson("/api/nyra/finance/profile");
    if (response?.profile) {
      state.financeProfile = response.profile;
      state.financeProfileHistory = Array.isArray(response.history) ? response.history : state.financeProfileHistory;
      if (state.mode === "finance") renderDashboard();
    }
  } catch (_error) {}
}

async function saveFinanceProfile(mode, manualProfile) {
  const response = await fetchJson("/api/nyra/finance/profile", {
    method: "POST",
    body: JSON.stringify({ mode, manualProfile })
  });
  if (response?.profile) {
    state.financeProfile = response.profile;
    state.financeProfileHistory = Array.isArray(response.history) ? response.history : state.financeProfileHistory;
    if (state.mode === "finance") renderDashboard();
  }
}

async function runFinanceLive() {
  if (state.financeLiveLoading) return;
  state.financeLiveLoading = true;
  const button = byId("financeLiveBtn");
  const previous = button.textContent;
  button.textContent = "Monitor live in corso...";
  button.disabled = true;
  try {
    const response = await fetchJson("/api/nyra/finance/live", {
      method: "POST",
      body: JSON.stringify({})
    });
    if (response?.finance) {
      state.financeProfile = response.profile || state.financeProfile;
      state.financeProfileHistory = Array.isArray(response.profileHistory) ? response.profileHistory : state.financeProfileHistory;
      state.financeOverride = response.finance;
      state.financeRaw = response.raw || null;
      state.financeHistory = Array.isArray(response.history) ? response.history : state.financeHistory;
      state.financeLearning = response.realtimeAutoimprovement || state.financeLearning;
      state.mode = "finance";
      renderDashboard();
      addMessage("nyra", "Ramo finanza aggiornato con monitor live web.", "finance-live");
    }
  } catch (error) {
    addMessage("nyra", `Errore finanza live: ${error.message}`, "error");
  } finally {
    state.financeLiveLoading = false;
    button.textContent = previous;
    button.disabled = false;
  }
}

async function loadWorldMarketCached() {
  try {
    const response = await fetchJson("/api/nyra/finance/world-market");
    state.worldMarketScan = response.scan || state.worldMarketScan;
    state.worldMarketSelection = response.selection || state.worldMarketSelection;
    renderDashboard();
  } catch (error) {
    addMessage("nyra", `Errore cache mercato mondiale: ${error.message}`, "error");
  }
}

async function loadWorldPaper() {
  try {
    const response = await fetchJson("/api/nyra/finance/world-paper");
    state.worldPaper = response;
    state.financeTreasury = response.treasury || state.financeTreasury;
    renderDashboard();
  } catch (error) {
    addMessage("nyra", `Errore paper mondiale: ${error.message}`, "error");
  }
}

async function loadWorldPaperAutoStatus() {
  try {
    const response = await fetchJson("/api/nyra/finance/world-paper/auto/status");
    state.worldPaperAuto = response;
    state.worldPaper = { portfolio: response.portfolio, summary: response.summary, learning: response.learning, selfDiagnosis: response.selfDiagnosis };
    state.financeTreasury = response.treasury || state.financeTreasury;
    renderDashboard();
  } catch (error) {
    addMessage("nyra", `Errore stato auto paper: ${error.message}`, "error");
  }
}

async function runWorldMarketScan(options = {}) {
  if (state.worldMarketLoading) return;
  state.worldMarketLoading = true;
  const silent = Boolean(options.silent);
  const button = byId("worldMarketBtn");
  const inlineButton = byId("worldMarketInlineBtn");
  const previous = button.textContent;
  const inlinePrevious = inlineButton.textContent;
  button.textContent = "Scansione in corso...";
  inlineButton.textContent = "Scansione in corso...";
  button.disabled = true;
  inlineButton.disabled = true;
  try {
    const response = await fetchJson("/api/nyra/finance/world-market", {
      method: "POST",
      body: JSON.stringify({})
    });
    state.worldMarketScan = response.scan || null;
    state.worldMarketSelection = response.selection || state.worldMarketSelection;
    renderDashboard();
    const best = state.worldMarketScan?.output?.best_symbol || "nessun candidato";
    if (!silent) addMessage("nyra", `Scansione mercato mondiale completata. Miglior candidato: ${best}.`, "world-market");
  } catch (error) {
    if (!silent) addMessage("nyra", `Errore mercato mondiale: ${error.message}`, "error");
  } finally {
    state.worldMarketLoading = false;
    button.textContent = previous;
    inlineButton.textContent = inlinePrevious;
    button.disabled = false;
    inlineButton.disabled = false;
  }
}

async function selectWorldMarketAsset(symbol) {
  try {
    const response = await fetchJson("/api/nyra/finance/world-market/select", {
      method: "POST",
      body: JSON.stringify({ symbol })
    });
    state.worldMarketSelection = response.selection || null;
    renderDashboard();
    addMessage("nyra", `Mercato scelto: ${state.worldMarketSelection?.symbol || symbol}. Lo osservo, non eseguo senza conferma.`, "world-market");
  } catch (error) {
    addMessage("nyra", `Errore scelta mercato: ${error.message}`, "error");
  }
}

async function runWorldPaperStep(options = {}) {
  if (state.worldPaperLoading) return;
  state.worldPaperLoading = true;
  const autoSelect = Boolean(options.autoSelect);
  const button = byId(autoSelect ? "worldPaperAutoBtn" : "worldPaperStepBtn");
  const previous = button.textContent;
  button.textContent = "Prova in corso...";
  button.disabled = true;
  try {
    const symbol = state.worldMarketSelection?.symbol || state.worldMarketScan?.output?.best_symbol || "";
    const response = await fetchJson("/api/nyra/finance/world-paper/step", {
      method: "POST",
      body: JSON.stringify(autoSelect ? { autoSelect: true } : { symbol })
    });
    state.worldPaper = { portfolio: response.portfolio, summary: response.summary, learning: response.learning, selfDiagnosis: response.selfDiagnosis };
    state.financeTreasury = response.treasury || state.financeTreasury;
    renderDashboard();
    const actor = response.mode === "nyra_auto_select" ? "Nyra ha scelto da sola" : "Paper scelta manuale";
    const study = response.autoChoice?.studyAware ? "con studio mercato mondiale" : "senza studio dedicato";
    const assetStudy = response.autoChoice?.assetHistoryAware ? ` · asset: ${response.autoChoice?.selectedAssetHistory?.behavior || "studiato"}` : "";
    const learning = response.learning?.learning_state ? ` · learning: ${response.learning.learning_state}` : "";
    addMessage("nyra", `${actor}: ${response.action} su ${response.selected?.symbol || symbol}, marcia ${response.riskBudget?.gear || "-"}, ${study}${assetStudy}${learning}. Nessun ordine reale.`, "world-market");
  } catch (error) {
    addMessage("nyra", `Errore prova paper: ${error.message}`, "error");
  } finally {
    state.worldPaperLoading = false;
    button.textContent = previous;
    button.disabled = false;
  }
}

async function resetWorldPaper() {
  try {
    const response = await fetchJson("/api/nyra/finance/world-paper/reset", {
      method: "POST",
      body: JSON.stringify({ initialCapitalEur: 1000000 })
    });
    state.worldPaper = { portfolio: response.portfolio, summary: response.summary, learning: response.learning, selfDiagnosis: response.selfDiagnosis };
    state.financeTreasury = response.treasury || state.financeTreasury;
    renderDashboard();
    addMessage("nyra", "Portafoglio paper mondiale resettato a 1.000.000 EUR virtuali.", "world-market");
  } catch (error) {
    addMessage("nyra", `Errore reset paper: ${error.message}`, "error");
  }
}

async function startWorldPaperAutoLoop() {
  try {
    const response = await fetchJson("/api/nyra/finance/world-paper/auto/start", {
      method: "POST",
      body: JSON.stringify({ intervalMinutes: 10 })
    });
    state.worldPaperAuto = response;
    state.worldPaper = { portfolio: response.portfolio, summary: response.summary, learning: response.learning };
    state.financeTreasury = response.treasury || state.financeTreasury;
    renderDashboard();
    addMessage("nyra", "Auto loop paper mondiale attivato. Nyra scansiona, sceglie e aggiorna in autonomia.", "world-market");
  } catch (error) {
    addMessage("nyra", `Errore auto loop: ${error.message}`, "error");
  }
}

async function stopWorldPaperAutoLoop() {
  try {
    const response = await fetchJson("/api/nyra/finance/world-paper/auto/stop", {
      method: "POST",
      body: JSON.stringify({})
    });
    state.worldPaperAuto = response;
    state.worldPaper = { portfolio: response.portfolio, summary: response.summary, learning: response.learning };
    state.financeTreasury = response.treasury || state.financeTreasury;
    renderDashboard();
    addMessage("nyra", "Auto loop paper mondiale fermato.", "world-market");
  } catch (error) {
    addMessage("nyra", `Errore stop auto loop: ${error.message}`, "error");
  }
}

function formatClock(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function refreshFinanceLiveStatus() {
  try {
    const response = await fetchJson("/api/nyra/finance/live/status");
    byId("financeLiveState").textContent = response.running
      ? "aggiornamento in corso"
      : response.enabled
        ? "attivo"
        : "fermato";
    byId("financeLiveAt").textContent = formatClock(response.lastFinishedAt || response.lastStartedAt);
    byId("financeLiveError").textContent = response.lastError ? response.lastError.slice(0, 80) : "nessuno";
    state.financeHistory = Array.isArray(response.history) ? response.history : state.financeHistory;
    state.financeProfile = response.profile || state.financeProfile;
    state.financeProfileHistory = Array.isArray(response.profileHistory) ? response.profileHistory : state.financeProfileHistory;
    state.financeLearning = response.realtimeAutoimprovement || state.financeLearning;
    state.financeKeepAwake = response.keepAwake || state.financeKeepAwake;
    state.financeTreasury = response.treasury || state.financeTreasury;
    if (response.finance) {
      state.financeOverride = response.finance;
      state.financeRaw = response.raw || null;
      if (state.mode === "finance") renderDashboard();
      return;
    }
    if (state.mode === "finance") renderDashboard();
  } catch (error) {
    byId("financeLiveState").textContent = "errore";
    byId("financeLiveError").textContent = error.message;
  }
}

function addMessage(role, text, meta = "") {
  const node = document.createElement("article");
  node.className = role;
  node.innerHTML = `<small>${esc(role === "user" ? "Tu" : "Nyra")}${meta ? ` · ${esc(meta)}` : ""}</small><div>${esc(text).replace(/\n/g, "<br>")}</div>`;
  byId("messages").appendChild(node);
  node.scrollIntoView({ block: "end" });
}

function setInspector(result = {}) {
  byId("intentValue").textContent = result.intent || "-";
  byId("bandValue").textContent = result.action_band || "-";
  byId("toneValue").textContent = result.tone || "-";
  byId("writeValue").textContent = String(result.writes_memory === true);
}

async function askNyra(message) {
  const clean = String(message || "").trim();
  if (!clean) return;
  state.lastMessage = clean;
  addMessage("user", clean, "read-only");
  addMessage("nyra", "Sto leggendo Nyra locale...", "working");
  const loading = byId("messages").lastElementChild;
  try {
    const response = await fetchJson("/api/nyra/read-only", {
      method: "POST",
      body: JSON.stringify({ message: clean })
    });
    loading.remove();
    const result = response.result || {};
    addMessage("nyra", result.reply || "Nessuna risposta.", result.mode || "read-only");
    setInspector(result);
  } catch (error) {
    loading.remove();
    addMessage("nyra", `Errore runtime: ${error.message}`, "error");
    setInspector({ intent: "runtime_error", action_band: "reply_only", tone: "direct", writes_memory: false });
  }
}

async function loadSnapshot() {
  try {
    const [snapshot, control] = await Promise.all([
      fetchJson("/api/nyra/snapshot"),
      fetchJson("/api/nyra/control")
    ]);
    const nyra = control.nyra || {};
    const normalizeSnapshotItem = (item) => {
      if (item == null) return "-";
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return String(item);
      if (Array.isArray(item)) return item.map(normalizeSnapshotItem).join(" | ");
      if (typeof item === "object") {
        if (item.title) return String(item.title);
        if (item.label) return String(item.label);
        if (item.name) return String(item.name);
        if (item.id) return String(item.id);
        return Object.entries(item)
          .slice(0, 3)
          .map(([key, value]) => `${key}: ${normalizeSnapshotItem(value)}`)
          .join(" · ");
      }
      return String(item);
    };
    byId("snapshotBox").textContent = [
      `Primary: ${normalizeSnapshotItem(nyra.primary)}`,
      `Doctrine: ${normalizeSnapshotItem(nyra.doctrine)}`,
      "",
      `Now: ${normalizeSnapshotItem(nyra.tempo?.now || [])}`,
      `Next: ${normalizeSnapshotItem(nyra.tempo?.next || [])}`,
      `Blocked: ${normalizeSnapshotItem(nyra.tempo?.blocked || [])}`,
      `Watch: ${normalizeSnapshotItem(nyra.tempo?.watch || [])}`,
      "",
      `Voice: ${(snapshot.voice || "").slice(0, 500) || "-"}`,
      "",
      `Work: ${(snapshot.work || "").slice(0, 700) || "-"}`
    ].join("\n");
  } catch (error) {
    byId("snapshotBox").textContent = `Errore snapshot: ${error.message}`;
  }
}

function bindEvents() {
  byId("chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = byId("messageInput");
    const value = input.value;
    input.value = "";
    askNyra(value);
  });

  byId("clearBtn").addEventListener("click", () => {
    byId("messages").innerHTML = "";
    addMessage("nyra", "Sono pronta. Punto, azione, limite.", "ready");
    setInspector({ intent: "-", action_band: "-", tone: "-", writes_memory: false });
  });

  byId("snapshotBtn").addEventListener("click", loadSnapshot);
  byId("financeLiveBtn").addEventListener("click", runFinanceLive);
  byId("worldMarketBtn").addEventListener("click", runWorldMarketScan);
  byId("worldMarketInlineBtn").addEventListener("click", runWorldMarketScan);
  byId("worldPaperStepBtn").addEventListener("click", runWorldPaperStep);
  byId("worldPaperAutoBtn").addEventListener("click", () => runWorldPaperStep({ autoSelect: true }));
  byId("worldPaperLoopStartBtn").addEventListener("click", startWorldPaperAutoLoop);
  byId("worldPaperLoopStopBtn").addEventListener("click", stopWorldPaperAutoLoop);
  byId("worldPaperResetBtn").addEventListener("click", resetWorldPaper);
  byId("financeDeskBoard").addEventListener("click", (event) => {
    const button = event.target.closest("[data-world-symbol]");
    if (!button) return;
    selectWorldMarketAsset(button.dataset.worldSymbol || "");
  });
  byId("modeAutoBtn").addEventListener("click", () => {
    const storedManual = state.financeProfile?.manualProfile || byId("manualProfileSelect").value || "hard_growth";
    saveFinanceProfile("auto", storedManual);
  });
  byId("modeManualBtn").addEventListener("click", () => saveFinanceProfile("manual", byId("manualProfileSelect").value));
  byId("saveProfileBtn").addEventListener("click", () => {
    const currentMode = state.financeProfile?.mode === "manual" ? "manual" : "auto";
    const manualProfile =
      currentMode === "manual"
        ? byId("manualProfileSelect").value
        : state.financeProfile?.manualProfile || "hard_growth";
    saveFinanceProfile(currentMode, manualProfile);
  });
  byId("applyRecommendationBtn").addEventListener("click", async () => {
    try {
      const response = await fetchJson("/api/nyra/finance/profile/apply-recommendation", {
        method: "POST",
        body: JSON.stringify({})
      });
      if (response?.profile) {
        state.financeProfile = response.profile;
        renderDashboard();
        addMessage("nyra", "Profilo manuale aggiornato sul consiglio di Nyra.", "profile");
      }
    } catch (error) {
      addMessage("nyra", `Errore profilo: ${error.message}`, "error");
    }
  });

  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      const prompt = button.dataset.prompt || "";
      byId("messageInput").value = prompt;
      askNyra(prompt);
    });
  });
}

renderDashboard();
bindEvents();
addMessage("nyra", "Sono pronta. Punto, azione, limite.", "ready");
loadFinanceMode();
refreshFinanceProfile();
refreshFinanceLiveStatus();
loadWorldMarketCached().then(() => runWorldMarketScan({ silent: true }));
loadWorldPaper();
loadWorldPaperAutoStatus();
state.financeStatusTimer = setInterval(refreshFinanceLiveStatus, 5000);
state.worldPaperAutoTimer = setInterval(loadWorldPaperAutoStatus, 15000);
loadSnapshot();
