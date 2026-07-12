# Smart Desk - Blocco 08 Frontend, API E UI Gold

## Scopo

Questo blocco collega backend, endpoint e UI Gold. Serve a evitare che il motore Gold funzioni dietro ma l'interfaccia non lo renda comprensibile.

## File Principali

- `render-smartdesk-live/server.js`
- `render-smartdesk-live/public/index.html`
- `render-smartdesk-live/public/fleet-intelligence.html`
- `render-smartdesk-live/public/assets/gold-bridge.js`
- `smartdesk/public/app.js`
- `skin-harmony-desktop`

## Endpoint Gold Live

AI Gold:

- `GET /api/ai-gold/marketing`
- `GET /api/ai-gold/profitability`
- `GET /api/business-snapshot`
- `GET /api/ai-gold/decision-center`
- `GET /api/ai-gold/capabilities`
- `GET /api/ai-gold/progressive-intelligence`
- `GET /api/ai-gold/decision-context`
- `GET /api/ai-gold/change-impact-contract`
- `GET /api/ai-gold/state`
- `GET /api/ai-gold/state/snapshots`
- `GET /api/ai-gold/state/signals`
- `GET /api/ai-gold/state/decision`
- `GET /api/ai-gold/marketing/autopilot/learning`
- `POST /api/ai-gold/marketing/autopilot/learning/reset`

Corelia aliases:

- `GET /api/corelia/capabilities`
- `GET /api/corelia/decision-context`
- `GET /api/corelia/decision-center`
- `POST /api/corelia/dialog`

Gold command:

- `POST /api/ai-gold/ask`
- `POST /api/ai-gold/command`

Gold onboarding:

- `GET /api/ai-gold/onboarding/imports`
- `POST /api/ai-gold/onboarding/analyze`
- `POST /api/ai-gold/onboarding/confirm`

WhatsApp Gold:

- `GET /api/ai-gold/whatsapp/status`
- `POST /api/ai-gold/whatsapp/test-twilio`
- `POST /api/ai-gold/whatsapp/preview`
- `POST /api/ai-gold/whatsapp/send`
- `POST /api/ai-gold/whatsapp/bulk-send`
- `POST /api/integrations/twilio/whatsapp-webhook`

UI impostazioni:

- blocco `Collega il Twilio del centro`;
- campi Account SID, Auth Token e sender WhatsApp;
- test connessione;
- token mascherato dopo salvataggio;
- copy esplicito: non e redirect, Smart Desk invia via API solo dopo conferma operatore.

Admin:

- `POST /api/admin/gold-state/rebuild`
- `POST /api/admin/progressive-intelligence/recompute`

## Gold Bridge UI

File:

- `render-smartdesk-live/public/assets/gold-bridge.js`
- repo/deploy live: `smartdesk-live/public/assets/gold-bridge.js`

Legge:

- `/api/ai-gold/capabilities`
- `/api/ai-gold/decision-context`

Mostra:

- priorita del giorno
- risk label
- confidence
- azione
- spiegazione
- priorita secondarie
- azioni bloccate
- effetto domino

Regola UI:

L'utente non deve vedere solo numeri. Deve capire:

- cosa fare ora
- perche
- quanto e affidabile
- cosa e bloccato
- quale modulo aprire

Regola collegamenti:

- Le card Core AI/Gold Bridge non devono restare decorative se sembrano operative.
- Ogni card metrica, priorita, blocco o superficie cliccabile deve avere una destinazione esplicita (`data-gold-route`, `data-enterprise-nav` o `data-enterprise-card-target`), `role="button"`, `tabindex="0"` e binding click+tastiera.
- I target devono aprire moduli reali: marketing/clienti/agenda/cassa/redditivita/magazzino/protocolli/turni/servizi/report/impostazioni/AI Gold.
- Nyra Code Overlay deve riportare `unbound_ui_action_attributes=0` oltre a `unbound_ui_actions=0`.

## UI Fleet

File:

- `render-smartdesk-live/public/fleet-intelligence.html`

Endpoint:

- `/api/fleet/overview`
- `/api/fleet/maturity`
- `/api/fleet/outliers`
- `/api/fleet/alerts`
- `/api/fleet/performance`
- `/api/fleet/oracle`

Vincolo:

Fleet e superadmin-only e read-only. Non modifica piani, pricing, dati operativi o decision engine.

## Desktop E Web

Regola architetturale:

- desktop = sorgente madre UX e logica validata
- web/live = shell allineata per uso online
- Render = backend live e persistenza centralizzata

Non creare divergenze:

- naming
- colori
- flussi
- moduli
- pulsanti
- gating piani

## Regole UI Gold

- Dashboard: prima cosa fare, poi numeri.
- Alert prioritari AI sotto `Centro sotto controllo`.
- AI Gold deve essere regia distribuita, non contenitore unico: `Stato centro`, `Priorità del giorno`, `Redditività`, `Performance` e `Magazzino/Opportunità` devono possedere le proprie card operative senza duplicati. La mappa stabile è in `SHARED_MEMORY/reports/smartdesk/SMARTDESK_GOLD_DISTRIBUTED_DECISION_ARCHITECTURE_2026-07-02.md`.
- Azioni operative devono dare feedback immediato.
- Ogni card/pulsante con `data-action` deve avere un binding reale o essere rimosso: Nyra Code Overlay deve riportare `unbound_ui_actions=0`.
- Ogni card/pulsante con attributi route (`data-gold-route`, `data-enterprise-nav`, `data-enterprise-card-target`, `data-admin-action`) deve avere binding reale o essere rimosso: Nyra Code Overlay deve riportare `unbound_ui_action_attributes=0`.
- Moduli non inclusi devono mostrare preview/upgrade, non sparire.
- Gold deve sembrare responsabile operativo digitale, non chatbot.
- Testare overflow testi/card.

## Adapter Preview Shell

Endpoint compatibili locali aggiunti nel mirror Smart Desk per evitare disconnessioni frontend/backend:

- `GET /api/assistant/brief`
- `POST /api/assistant/query`
- `GET /api/center`
- `POST /api/center`
- `GET /api/runtime-meta`
- `GET /api/sales`
- `POST /api/sales`
- `GET /api/history`

Nota operativa: questi adapter non autorizzano deploy automatico. Prima di portarli live serve il normale ciclo gate, test e verifica Render.

## Stato Vendibile UI

Vendibile se:

- Gold bridge mostra priorita comprensibili
- capability e decision context rispondono
- marketing/profitability/decision-center sono leggibili
- PIAL spiega feature abilitate/bloccate
- onboarding importa e ricostruisce stato

Non vendibile se:

- pulsanti non danno feedback
- decisioni restano solo JSON tecnico
- la UI nasconde perche qualcosa e bloccato
