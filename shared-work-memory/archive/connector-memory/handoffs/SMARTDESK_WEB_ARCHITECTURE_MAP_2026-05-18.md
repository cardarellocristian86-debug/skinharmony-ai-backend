# Smart Desk Web Architecture Map - 2026-05-18

## Obiettivo
Fissare la nuova mappa reale della web dopo il refactor locale.

## Struttura attuale

### Entry shell
- `smartdesk/public/index.html`
- `smartdesk/public/styles.css`
- `smartdesk/public/app.js`

Ruolo:
- shell principale
- stato globale
- helper condivisi
- wiring finale
- composizione delle viste

### Runtime
- `smartdesk/public/runtime.js`
- `smartdesk/public/i18n.js`
- `smartdesk/public/ui-helpers.js`
- `smartdesk/public/shell-helpers.js`
- `smartdesk/public/operations.js`

Ruolo:
- risoluzione `API_SERVER_URL`
- policy refresh
- stato iniziale shell
- dizionario lingua e helper i18n
- helper UI condivisi
- logica shell condivisa
- flow operativi condivisi

Blocchi estratti:
- `resolveApiServerUrl`
- `LAZY_REFRESH_MS`
- `REFRESH_POLICY`
- `createInitialState`
- `supportedLanguages`
- `translations`
- `createI18n`
- `showFeedback`
- `euro`
- `euroFromCents`
- `escapeHtml`
- `safeJsonFetch`
- `currentPlanId`
- `activeNavClass`
- `syncTopbar`
- `moduleEnabled`
- `canUseAiGold`
- `renderEnterpriseBanner`
- `renderModuleStateCard`
- `renderLockedModule`
- `renderPeriodFilters`
- `kpiCards`
- `riskBandLabel`
- `openClientDialog`
- `openServiceDialog`
- `openStaffDialog`
- `openAppointmentDialog`
- `openCenterDialog`
- `submitEntity`
- `deleteAppointment`
- `saveCashdeskPayment`
- `copyClientMessageToClipboard`

### Bootstrap
- `smartdesk/public/bootstrap/global.js`

Ruolo:
- eventi globali
- bootstrap iniziale
- init app
- apertura assistant
- submit assistant
- submit dialog entity

### Data orchestration
- `smartdesk/public/data-orchestration.js`

Ruolo:
- loader dati
- refresh policy
- orchestrazione fetch
- lazy refresh
- refresh per dominio evento

Blocchi estratti:
- `loadProfitabilityOverview`
- `loadTreatments`
- `loadData`
- `refreshForUserEvent`
- `startLazyRefreshLoop`

### Domain helpers
- `smartdesk/public/domain/smartdesk.js`
- `smartdesk/public/domain/normalizers.js`

Ruolo:
- helper di dominio Smart Desk
- letture derivate su clienti e cassa
- regole locali di supporto senza bootstrap globale
- normalizzazione payload lato shell

Blocchi estratti:
- `filteredClients`
- `clientAppointments`
- `clientPayments`
- `clientContinuityStatus`
- `methodLabel`
- `activeCashdeskPayments`
- `cashdeskOpenAppointments`
- `cashdeskClosedSessionsToVerify`
- `cashdeskHistorySummary`
- `cashdeskDailyCheck`
- `clientGoldAction`
- `normalizeClient`
- `normalizeAppointment`
- `normalizeService`
- `normalizeStaff`
- `normalizeInventoryItem`
- `normalizeInventoryMovement`
- `normalizeProfitabilityOverview`
- `normalizeTreatment`

### View bindings
- `smartdesk/public/view-bindings/primary.js`
- `smartdesk/public/view-bindings/secondary.js`

Ruolo:
- controller UI per vista
- eventi locali alle viste
- update stato locale coerente

`primary.js`
- `Agenda`
- `Clienti`
- `Cassa`

`secondary.js`
- `AI Gold`
- `Marketing`
- `Inventory`
- `Profitability`
- `Protocols`
- `Services`
- `Reports`
- `Settings`

### Views
- `smartdesk/public/views/agenda.js`
- `smartdesk/public/views/clients.js`
- `smartdesk/public/views/cashdesk.js`
- `smartdesk/public/views/profitability.js`
- `smartdesk/public/views/protocols.js`
- `smartdesk/public/views/marketing.js`
- `smartdesk/public/views/inventory.js`

Ruolo:
- rendering delle stanze principali
- markup e struttura locale della vista
- nessun bootstrap globale

## Lettura architetturale

### Cosa non e piu vero
- la web non e piu tutta concentrata in `smartdesk/public/app.js`

### Cosa e vero adesso
- `app.js` = shell + wiring + helper condivisi residui
- `runtime.js` = config runtime e stato iniziale
- `i18n.js` = dizionario lingua e helper traduzione
- `ui-helpers.js` = feedback, format e fetch condivisi
- `shell-helpers.js` = nav, gating e blocchi shell condivisi
- `operations.js` = dialog, salvataggi e azioni operative condivise
- `bootstrap/global.js` = avvio e eventi cross-view
- `data-orchestration.js` = pipeline dati
- `domain/*` = helper di dominio e normalizzazione
- `view-bindings/*` = comandi per vista
- `views/*` = rendering delle stanze

## Stato Task 10
- `quasi chiuso strutturalmente`

Cosa e gia chiuso:
- renderer principali estratti
- binding principali estratti
- binding secondari estratti
- data orchestrator estratto
- domain helpers principali estratti
- runtime e stato iniziale estratti
- i18n estratto
- helper UI condivisi estratti
- shell logic estratta
- operations estratte
- bootstrap globale estratto

Cosa resta aperto:
- stato globale ancora in `app.js`
- alcuni helper condivisi ancora in `app.js`
- prova funzionale reale fuori sandbox

## Regola per il prossimo step
Non tornare a far crescere `app.js` come monolite.

Ogni nuovo lavoro web deve scegliere uno di questi punti:
- `views/*` per il rendering
- `view-bindings/*` per gli eventi di vista
- `runtime.js` per config e stato iniziale
- `i18n.js` per lingua e dizionari
- `ui-helpers.js` per feedback, format e fetch condivisi
- `shell-helpers.js` per nav, gating e blocchi shell
- `operations.js` per dialog, save e azioni operative
- `data-orchestration.js` per i loader/refresh
- `domain/*` per letture derivate e normalizzazione
- `bootstrap/global.js` per eventi trasversali

## Quando considerarlo chiuso davvero
- smoke test reale fuori sandbox
- walkthrough minimo:
  - login
  - agenda
  - clienti
  - cassa
  - marketing
  - inventory
  - profitability
  - protocols
  - AI Gold
- nessuna regressione evidente sul wiring locale
