# Smart Desk Live Web Source Map

Data: `2026-05-18`

## Verdetto

La `web live` che piace e che oggi gira su Render **non** va modificata dentro:

- `smartdesk-live/public/assets/*`

Quelli sono bundle compilati.

La sorgente editabile corretta e:

- `skin-harmony-web/src/renderer/`

## Root live attuale

Render root:

- `https://skinharmony-smartdesk-live.onrender.com/`

Serve:

- `smartdesk-live/public/index.html`
- bundle React compilato in `smartdesk-live/public/assets/*`

## Preview shell tecnica

Route tecnica:

- `https://skinharmony-smartdesk-live.onrender.com/web-preview/`

Sorgente:

- `smartdesk/public/*`
- copiata in `smartdesk-live/public/preview-shell/*`

Uso corretto:

- laboratorio logica / parity
- non sorgente grafica finale del live

## Sorgente madre web editabile

Percorso:

- `skin-harmony-web/src/renderer/App.tsx`

Pagine principali:

- `pages/DashboardPage.tsx`
- `pages/AppointmentsPage.tsx`
- `pages/ClientsPage.tsx`
- `pages/ClientDetailPage.tsx`
- `pages/CashdeskPage.tsx`
- `pages/AiGoldPage.tsx`
- `pages/MarketingPage.tsx`
- `pages/InventoryPage.tsx`
- `pages/ProfitabilityPage.tsx`
- `pages/ProtocolsPage.tsx`
- `pages/ServicesPage.tsx`
- `pages/SettingsPage.tsx`

Layout:

- `components/layout/Shell.tsx`
- `components/layout/Sidebar.tsx`
- `components/layout/Topbar.tsx`

Stato / auth / settings:

- `state/authStore.ts`
- `hooks/useAppSettings.ts`
- `lib/api.ts`
- `lib/subscription.ts`

## Decisione di lavoro

Direzione corretta:

- `tenere la grafica live attuale`
- `portare la logica nuova dentro skin-harmony-web`
- `usare preview-shell solo come reference tecnica di parity`

Direzione sbagliata:

- editare i file in `public/assets/*`
- promuovere la preview-shell come UI finale senza rifarla visivamente

## Primo punto di innesto consigliato

Per parity operativa:

1. `AppointmentsPage.tsx`
2. `ClientDetailPage.tsx`
3. `CashdeskPage.tsx`
4. `AiGoldPage.tsx`
5. `MarketingPage.tsx`
6. `InventoryPage.tsx`
7. `ProfitabilityPage.tsx`
8. `ProtocolsPage.tsx`

## Nota operativa

La shell preview ha gia incorporato logiche utili su:

- agenda
- scheda cliente
- cassa
- AI Gold
- marketing
- magazzino
- redditivita
- protocolli

Queste logiche vanno ora tradotte nella web React vera, non copiate alla cieca.
