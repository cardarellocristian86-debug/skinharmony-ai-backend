const byId = (id) => document.getElementById(id);

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return text ? JSON.parse(text) : {};
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function boolPill(value, good = "ok", bad = "bad") {
  return `<span class="pill ${value ? good : bad}">${value ? "ready" : "blocked"}</span>`;
}

async function load() {
  const [overview, nyra] = await Promise.all([
    fetchJson("/api/overview"),
    fetchJson("/api/nyra/control").catch(() => null)
  ]);

  const fd = nyra?.nyra?.financeDockReadiness || {};
  const responseRate = Math.round(Number(overview?.decision?.responseRate || 0) * 100);
  const revenue = Number(overview?.economics?.totalRevenue || 0);
  const margin = Number(overview?.economics?.totalMargin || 0);

  byId("primaryTitle").textContent = fd.economicFeedReady
    ? "Economic feed parzialmente pronto"
    : "Financial desk non ancora operativo";
  byId("primaryDetail").textContent =
    fd.note || "Il desk finanziario va separato dal Control Desk e attivato solo con feed affidabili.";

  byId("heroStats").innerHTML = `
    <article class="hero-stat"><small>Campaign reply</small><strong>${responseRate}%</strong></article>
    <article class="hero-stat"><small>Revenue linked</small><strong>${Math.round(revenue)} EUR</strong></article>
    <article class="hero-stat"><small>Margin linked</small><strong>${Math.round(margin)} EUR</strong></article>
    <article class="hero-stat"><small>Smart Desk feed</small><strong>${overview?.sources?.smartDesk?.latest ? "ON" : "OFF"}</strong></article>
  `;

  byId("regimeCard").innerHTML = `
    <small class="label">Regime</small>
    <h3>Observe first</h3>
    <p>Senza market feed, execution feed e risk feed coerenti, questa stanza deve leggere pressione e readiness. Non deve fingere trading.</p>
    <div class="pill-row">
      ${boolPill(fd.flowFeedReady, "ok", "warn")}
      ${boolPill(fd.economicFeedReady, "ok", "warn")}
    </div>
  `;

  byId("executionCard").innerHTML = `
    <small class="label">Execution</small>
    <h3>Execution plane blocked</h3>
    <p>Ordini, sizing, exposure e invalidation non vanno mostrati come attivi senza feed reali dedicati.</p>
    <div class="pill-row">
      ${boolPill(false, "ok", "bad")}
    </div>
  `;

  byId("feedCard").innerHTML = `
    <small class="label">Feed integrity</small>
    <strong>${overview?.sources?.render?.latest ? "Hybrid feed present" : "Hybrid feed partial"}</strong>
    <p>Control Desk ha già revenue, margin, pipeline e runtime. Manca ancora il market feed finanziario vero.</p>
  `;
  byId("riskCard").innerHTML = `
    <small class="label">Risk gate</small>
    <strong>Protection first</strong>
    <p>Il desk deve fermare l'azione se regime, laterale, execution risk o confidence sono sotto soglia.</p>
  `;
  byId("capitalCard").innerHTML = `
    <small class="label">Capital lens</small>
    <strong>${Math.round(revenue)} EUR tracked</strong>
    <p>Capitale business leggibile. Non ancora capitale finanziario operativo.</p>
  `;
  byId("readinessCard").innerHTML = `
    <small class="label">Readiness</small>
    <strong>${fd.runtimeFeedReady ? "Runtime ready" : "Runtime partial"}</strong>
    <p>Il runtime del desk è pronto solo come control plane. Non ancora come trading plane.</p>
  `;

  const tempoItems = [
    ["Now", "Separare il financial desk dal Control Desk generale."],
    ["Blocked", "Nessun market feed reale collegato."],
    ["Watch", "Usare solo readiness, regime e risk doctrine finché il feed non è vero."]
  ];
  byId("tempoGrid").innerHTML = tempoItems.map(([title, detail]) => `
    <article class="tempo-item">
      <small class="label">${esc(title)}</small>
      <p>${esc(detail)}</p>
    </article>
  `).join("");

  const surfaces = [
    "Regime board",
    "Pressure board",
    "Risk gate",
    "Execution gate",
    "Exposure map",
    "Scenario tape",
    "Event tape",
    "Journal / post-trade review"
  ];
  byId("surfaceList").innerHTML = surfaces.map((item) => `<article class="list-item"><p>${esc(item)}</p></article>`).join("");

  const doctrine = [
    "Non mostrare PnL attivo se non esiste un feed vero.",
    "Prima regime e rischio, poi opportunità.",
    "Nel laterale la decisione corretta può essere non agire.",
    "L'interfaccia deve guidare disciplina, non eccitare attività.",
    "Una stanza separata evita il minestrone con marketing, lead e operations."
  ];
  byId("doctrineList").innerHTML = doctrine.map((item) => `<article class="list-item"><p>${esc(item)}</p></article>`).join("");

  const integration = [
    `Economic feed ready: ${fd.economicFeedReady ? "yes" : "no"}`,
    `Runtime feed ready: ${fd.runtimeFeedReady ? "yes" : "no"}`,
    `Flow feed ready: ${fd.flowFeedReady ? "yes" : "no"}`,
    "Control Desk resta la stanza business.",
    "Financial Desk diventa la stanza regime/risk/execution separata."
  ];
  byId("integrationList").innerHTML = integration.map((item) => `<article class="list-item"><p>${esc(item)}</p></article>`).join("");
}

byId("refreshBtn").addEventListener("click", () => void load());
void load();
