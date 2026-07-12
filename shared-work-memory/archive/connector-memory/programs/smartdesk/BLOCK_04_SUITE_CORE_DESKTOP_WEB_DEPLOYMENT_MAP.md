# Smart Desk - Blocco 04

## Area Coperta

Questo blocco mappa collegamenti e superfici prodotto:

- Suite App Key Bridge;
- Universal Core bridge;
- desktop;
- web;
- WordPress/Suite bridge;
- deploy Render;
- report/test.

File verificati:

- `render-smartdesk-live/src/SuiteAppKeyBridge.js`
- `render-smartdesk-live/src/UniversalCoreBridge.js`
- `render-smartdesk-live/server.js`
- `smartdesk/server.js`
- `smartdesk/public/*`
- `skin-harmony-desktop/package.json`
- `wordpress/plugins/skinharmony-site-suite/modules/smartdesk-bridge/class-module.php`

## Suite App Key Bridge

Classe:

- `SuiteAppKeyBridge`

Protocollo:

- `suite_app_key_factory_v1`

Env/Config:

- `SUITE_API_URL`
- `SUITE_API_KEY`
- `SUITE_DEFAULT_APP_KEY`

Route Suite chiamate:

- `/wp-json/shss/v1/waas-manager/smartdesk-app-key-factory/activate`
- `/wp-json/shss/v1/waas-manager/smartdesk-app-key-factory/config-bundle`
- `/wp-json/shss/v1/waas-manager/smartdesk-app-key-factory/pulse`

Endpoint Smart Desk:

- `GET /api/suite-bridge/status`
- `POST /api/suite-bridge/activate`
- `POST /api/suite-bridge/config-bundle`
- `POST /api/suite-bridge/pulse`

Regola:

- Suite e fabbrica chiavi/licenze/config;
- Smart Desk e nodo operativo;
- Smart Desk manda pulse/snapshot, non database completo;
- se Suite non e configurata, mostra stato chiaro.

## Universal Core Bridge

Classe:

- `UniversalCoreBridge`

Env:

- `UNIVERSAL_CORE_URL`
- `UNIVERSAL_CORE_KEY`
- `UNIVERSAL_CORE_TENANT_ID`

Endpoint Smart Desk:

- `GET /api/universal-core/status`
- `GET /api/universal-core/tenant-status`
- `GET /api/universal-core/pulse`
- `POST /api/universal-core/decision`
- `POST /api/universal-core/branches/:branch`

Regola:

- Smart Desk non deve contenere tutto il Core;
- deve chiedere decisioni/policy a Universal Core quando configurato;
- il bridge oggi e read-only/decision, non orchestrazione piena multi-tenant.

## Desktop

Cartella:

- `skin-harmony-desktop`

Ruolo:

- sorgente madre UX/flussi;
- shell desktop offline-first;
- SQLite locale previsto;
- base per coerenza web.

Regole:

- desktop resta fonte principale di lavoro e modifica;
- web deve restare allineato;
- non evolvere web e desktop in direzioni divergenti.

## Web Locale

Cartella:

- `smartdesk`

Ruolo:

- shell web/locale;
- usa `server.js`;
- UI in `public/app.js`, `styles.css`, `runtime.js`, `operations.js`, `data-orchestration.js`.

Regola:

- non e il live Render principale;
- serve come ambiente locale/allineamento.

## Live Render

Cartella:

- `render-smartdesk-live`

Ruolo:

- deploy vendibile;
- API + UI;
- Postgres se `DATABASE_URL`;
- fallback JSON locale se non configurato.

URL:

- `https://skinharmony-smartdesk-live.onrender.com`

## WordPress / Suite Bridge

File:

- `wordpress/plugins/skinharmony-site-suite/modules/smartdesk-bridge/class-module.php`

Ruolo:

- lato Suite/WordPress vede Smart Desk come nodo/servizio collegabile;
- deve gestire configurazione, test connessione e stato.

Regola:

- Suite vende/licenzia/configura;
- Smart Desk esegue;
- Core governa decisioni dove collegato.

## Report / Test Esistenti

Cartelle:

- `reports/smartdesk-tests`
- `reports/ai-gold-tests`
- `reports/codex-core`
- `reports/wordpress`

Script:

- `scripts/smartdesk_multitenant_live_load_test.js`
- `scripts/smartdesk_gold_100_tenant_load_test.js`
- `scripts/smartdesk_gold_complex_center_test.js`
- `scripts/smartdesk_plan_comparison_same_dataset.js`
- `scripts/smartdesk_render_plan_validation.js`
- `scripts/smartdesk_i18n_audit.js`
- `render-smartdesk-live/scripts/*`

Regola:

- ogni modifica strutturale deve aggiornare mappa e produrre report;
- test non devono basarsi solo su "funziona tecnicamente", ma anche su UX, piani, gating e dati reali.

## Cosa E Gia Operativo

- Live Render.
- Suite App Key Bridge.
- Universal Core Bridge.
- Desktop/web distinti.
- Modulo Suite smartdesk-bridge.
- Ampia base report/test.

## Cosa Resta Da Validare Live

- Che App Key Bridge sia collegato alla Suite installata.
- Che Universal Core URL/key siano configurati su Render quando richiesto.
- Che desktop e web restino allineati.
- Che Suite non prometta sync completo se bridge fa solo activate/config/pulse.
- Che ogni release Smart Desk aggiorni mappa, test e report condivisi.

