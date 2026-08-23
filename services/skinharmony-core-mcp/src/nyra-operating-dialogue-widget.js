export const NYRA_DIALOGUE_WIDGET_URI = "ui://skinharmony/nyra-operating-dialogue-v1.html";
export const NYRA_DIALOGUE_WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

// This is intentionally a dependency-free MCP Apps component. The server is
// the sole source of the Work state; the widget only renders bounded
// structuredContent that Nyra already returned to the connected host.
export const NYRA_DIALOGUE_WIDGET_HTML = String.raw`<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body { margin: 0; padding: 12px; background: transparent; color: CanvasText; }
  main { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 14px; padding: 14px; max-width: 720px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  h1 { font-size: 15px; margin: 0; letter-spacing: .01em; }
  .badge { border-radius: 999px; padding: 3px 8px; font-size: 12px; background: color-mix(in srgb, #6c5ce7 18%, transparent); }
  #reply { font-size: 16px; line-height: 1.45; margin: 0 0 12px; white-space: pre-wrap; }
  dl { display: grid; grid-template-columns: max-content 1fr; column-gap: 10px; row-gap: 6px; margin: 0; font-size: 13px; }
  dt { opacity: .68; } dd { margin: 0; overflow-wrap: anywhere; }
  #empty { opacity: .7; font-size: 14px; }
</style></head><body>
<main aria-live="polite"><header><h1>Nyra</h1><span id="state" class="badge">In attesa</span></header>
<p id="reply">Nyra sta preparando la risposta governata…</p><dl id="details" hidden></dl><p id="empty" hidden>Nessuna risposta Nyra disponibile.</p></main>
<script>
(() => {
  const reply = document.getElementById("reply");
  const state = document.getElementById("state");
  const details = document.getElementById("details");
  const empty = document.getElementById("empty");
  const safe = (value, fallback = "—") => typeof value === "string" && value.trim() ? value : fallback;
  const render = (payload) => {
    const data = payload && typeof payload === "object" ? payload : null;
    const contract = data?.host_response_contract || {};
    const work = data?.work || {};
    const dialogue = data?.nyra_dialogue || {};
    if (!data || data.ok !== true) { reply.hidden = true; details.hidden = true; empty.hidden = false; return; }
    empty.hidden = true; reply.hidden = false; reply.textContent = safe(contract.reply_seed, "Nyra non ha emesso un prossimo passo.");
    state.textContent = safe(work.state, "unknown");
    const rows = [
      ["Work", work.work_id], ["Progetto", work.project_id], ["Diagnosi", dialogue.diagnosis_state],
      ["Checkpoint", dialogue.checkpoint_available === true ? "disponibile" : "non disponibile"],
      ["Software", dialogue.software_state],
    ].filter(([, value]) => value !== null && value !== undefined && value !== "");
    details.replaceChildren(...rows.flatMap(([label, value]) => {
      const dt = document.createElement("dt"); dt.textContent = label;
      const dd = document.createElement("dd"); dd.textContent = String(value);
      return [dt, dd];
    }));
    details.hidden = rows.length === 0;
    window.openai?.notifyIntrinsicHeight?.();
  };
  const fromResult = (params) => render(params?.structuredContent || params?.result?.structuredContent || null);
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || !event.data || event.data.jsonrpc !== "2.0") return;
    if (event.data.method === "ui/notifications/tool-result") fromResult(event.data.params);
  }, { passive: true });
  if (window.openai?.toolOutput) render(window.openai.toolOutput);
  try { window.parent.postMessage({ jsonrpc: "2.0", id: "nyra-dialogue-init", method: "ui/initialize", params: { capabilities: {} } }, "*"); } catch {}
})();
</script></body></html>`;

export const NYRA_DIALOGUE_WIDGET_RESOURCE = Object.freeze({
  uri: NYRA_DIALOGUE_WIDGET_URI,
  name: "Nyra operating dialogue",
  description: "Authoritative Nyra Work response rendered from bounded server output.",
  mimeType: NYRA_DIALOGUE_WIDGET_MIME_TYPE,
});
