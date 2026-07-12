# Smart Desk - Blocco 01

## Area Coperta

Questo blocco mappa il runtime vendibile su Render:

- servizio live Express;
- API principali;
- persistenza JSON/Postgres;
- sicurezza minima;
- safe mode;
- trial/auth;
- dipendenze runtime.

File verificati:

- `render-smartdesk-live/package.json`
- `render-smartdesk-live/server.js`
- `render-smartdesk-live/src/DesktopMirrorService.js`
- `render-smartdesk-live/src/JsonFileRepository.js`
- `render-smartdesk-live/src/PostgresPersistenceAdapter.js`

## Runtime Live

Cartella:

- `render-smartdesk-live`

Servizio:

- `skinharmony-smartdesk-live`

URL live:

- `https://skinharmony-smartdesk-live.onrender.com`

Script:

- `npm start`
- entrypoint `server.js`

Dipendenze:

- `express`
- `nodemailer`
- `pg`
- `xlsx`

Persistenza:

- se `DATABASE_URL` e presente usa `PostgresPersistenceAdapter`;
- se `DATABASE_URL` manca usa JSON locale in `render-smartdesk-live/data`.

Log atteso:

- `Persistence: Postgres (DATABASE_URL)` quando live usa database Render.

## Data Store

Repository principali creati in `DesktopMirrorService`:

- `clients`
- `appointments`
- `services`
- `staff`
- `shifts`
- `shift_templates`
- `resources`
- `inventory`
- `inventory_movements`
- `payments`
- `cash_closures`
- `treatments`
- `protocols`
- `ai_marketing_actions`
- `dashboard_snapshots`
- `gold_state`
- `gold_decision_history`
- `gold_action_outcomes`
- `gold_imports`
- `whatsapp_messages`
- `users`
- `sales`
- `settings`

Regola:

- il gestionale/Core dati e la fonte dei numeri;
- AI Gold legge e interpreta, non inventa dati.

## Auth / Trial / Utenti

Route principali:

- `POST /api/auth/login`
- `GET /api/auth/trial-config`
- `POST /api/auth/request-trial`
- `POST /api/auth/verify-trial-email`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/auth/users`
- `POST /api/auth/users`
- `POST /api/auth/users/:id/status`
- `POST /api/auth/users/:id/support-session`
- `POST /api/auth/subscription/request-change`

Protezione:

- rate limit su login, trial e password;
- password hash;
- token sessione;
- support mode superadmin;
- trial email verification se env SMTP sono configurate.

Env trial/email:

- `TRIAL_SMTP_HOST`
- `TRIAL_SMTP_PORT`
- `TRIAL_SMTP_USER`
- `TRIAL_SMTP_PASS`
- `TRIAL_MAIL_FROM`
- `TRIAL_BANK_ACCOUNT_HOLDER`
- `TRIAL_BANK_IBAN`

## Health / Safe Mode

Route:

- `GET /health`
- `GET /api/health`
- `GET /api/system/safe-mode`

Safe mode controlla:

- richieste concorrenti;
- richieste attive lente;
- p95;
- media;
- error rate;
- request rate;
- burst API;
- request attive troppo vecchie.

Env principali safe mode:

- `SAFE_MODE_FORCE`
- `SAFE_MODE_WINDOW_MS`
- `SAFE_MODE_MIN_SAMPLES`
- `SAFE_MODE_P95_MS`
- `SAFE_MODE_AVG_MS`
- `SAFE_MODE_ERROR_RATE`
- `SAFE_MODE_CONCURRENT_REQUESTS`
- `SAFE_MODE_ACTIVE_REQUEST_AGE_MS`
- `SAFE_MODE_OLDEST_ACTIVE_REQUEST_MS`
- `SAFE_MODE_SLOW_ACTIVE_REQUESTS`
- `SAFE_MODE_REQUEST_RATE_PER_SECOND`
- `SAFE_MODE_BURST_SAMPLES`

Regola:

- safe mode deve limitare operazioni pesanti, non rompere operativita base.

## API Operative Base

Dashboard:

- `GET /api/dashboard/stats`
- `POST /api/dashboard/refresh`

Regola runtime dashboard aggiornata:

- `GET /api/dashboard/stats` legge lo snapshot dashboard salvato per centro/piano/periodo/data.
- Se lo snapshot non esiste, viene creato una sola volta come bootstrap.
- Le scritture operative invalidano solo gli snapshot collegati al centro e ai blocchi dipendenti.
- `POST /api/dashboard/refresh` resta manuale con cooldown e safe mode; non deve diventare refresh continuo.

Assistant:

- `POST /api/assistant/chat`

Clienti:

- `GET /api/clients`
- `GET /api/clients/duplicates`
- `POST /api/clients/duplicate-suggestions`
- `POST /api/clients/merge`
- `POST /api/clients`
- `PUT /api/clients/:id`
- `GET /api/clients/:id`
- `GET /api/clients/:id/consultation`
- `GET /api/clients/:id/consent-document`

Agenda:

- `GET /api/appointments`
- `POST /api/appointments`
- `PUT /api/appointments/:id`
- `DELETE /api/appointments/:id`

Cataloghi:

- `GET/POST/PUT/DELETE /api/catalog/services`
- `GET/POST/PUT/DELETE /api/catalog/staff`
- `GET/POST/PUT/DELETE /api/catalog/resources`

Turni:

- `GET/POST/PUT/DELETE /api/shifts`
- template turni da Silver: `/api/shifts/templates`
- export turni da Silver: `/api/shifts/export`

Magazzino:

- `GET/POST/PUT/DELETE /api/inventory/items`
- movimenti da Silver: `/api/inventory/movements`
- overview da Silver: `/api/inventory/overview`

Cassa/pagamenti:

- `GET /api/payments`
- `GET /api/payments/summary`
- `GET /api/payments/unlinked`
- `POST /api/payments/cash-close`
- `POST /api/payments`
- `POST /api/payments/:id/link`

Impostazioni:

- `GET /api/settings`
- `PUT /api/settings`
- `POST /api/settings/reset`

## Piani / Gating

Funzioni principali:

- `getPlanLevel(session)`
- `requirePlan(plan)`
- superadmin senza support mode vede Gold.

Regole stabili:

- Base deve mantenere agenda, clienti, appuntamenti, cassa, marketing manuale, turni base, magazzino base, protocolli manuali.
- Silver attiva redditivita, report evoluti, magazzino evoluto, turni evoluti e controlli operativi piu profondi.
- Gold attiva intelligenza sopra i moduli, AI Gold, priorita giornaliere, marketing suggerito/autopilot approvabile, clienti da recuperare, alert redditivita, decision center e WhatsApp Gold.
- Protocolli AI, protocolli guidati/adattivi e analisi protocollo AI restano fuori dai piani commerciali finche non sono sistemati e testati.
- Enterprise resta avanzamento futuro/multi-centro.

## Admin / Supporto

Route principali:

- `POST /api/admin/cleanup-test-data`
- `POST /api/admin/reset-center-data`
- `POST /api/admin/cleanup-demo-centers`
- `POST /api/admin/gold-state/rebuild`
- `POST /api/admin/progressive-intelligence/recompute`
- `GET /api/admin/database-usage`

Regola:

- azioni distruttive/admin restano superadmin;
- support mode deve essere esplicito e tracciabile.

## Cosa E Gia Operativo

- Runtime Render Node/Express.
- Health e safe mode.
- Login/trial/password flow.
- Persistenza Postgres o JSON.
- CRUD operativo su clienti, agenda, servizi, staff, risorse, turni, inventario, pagamenti, protocolli.
- Gating piani Base/Silver/Gold.
- Superadmin/support mode.

## Cosa Resta Da Validare Live

- Che `DATABASE_URL` sia sempre attivo su Render.
- Che safe mode non blocchi flussi base.
- Che tutte le route Gold/Silver mostrino preview/upgrade quando non autorizzate.
- Che support mode non confonda dati tra centri.
- Che le azioni admin non siano disponibili a tenant normali.
