# Smart Desk - Blocco 02

## Area Coperta

Questo blocco mappa i moduli operativi del centro:

- dashboard;
- clienti;
- agenda;
- cassa;
- servizi/staff/risorse;
- turni;
- magazzino;
- trattamenti/protocolli;
- report;
- qualità dati.

File verificati:

- `render-smartdesk-live/server.js`
- `render-smartdesk-live/src/DesktopMirrorService.js`
- `render-smartdesk-live/src/core/cash/CashCore`
- `render-smartdesk-live/src/core/profitability/ProfitabilityCore`
- `render-smartdesk-live/src/core/data-quality/DataQualityCore`
- `render-smartdesk-live/src/core/marketing/MarketingCore`

## Principio Centrale

Smart Desk non e un chatbot e non e solo una dashboard.

E il gestionale operativo del centro.

Regola stabile:

- il gestionale/Core/Silver e la fonte dei numeri;
- AI Gold non corregge i numeri;
- se un numero e sbagliato, si corregge il modulo che genera il dato.

Formula:

- `Il gestionale dice cosa sta succedendo. AI Gold dice cosa fare.`

## Dashboard

Route:

- `GET /api/dashboard/stats`
- `POST /api/dashboard/refresh`

Regole:

- apertura dashboard = lettura ultimo snapshot salvato;
- refresh manuale solo da pulsante con cooldown/lock;
- refresh automatico solo scheduler sfalsato;
- alert AI prioritari devono stare prima dei KPI.

## Clienti / CRM Centro

Route:

- `GET /api/clients`
- `POST /api/clients`
- `PUT /api/clients/:id`
- `GET /api/clients/:id`
- `GET /api/clients/duplicates`
- `POST /api/clients/duplicate-suggestions`
- `POST /api/clients/merge`
- `GET /api/clients/:id/consultation`
- `GET /api/clients/:id/consent-document`

Funzioni:

- anagrafica cliente;
- duplicati;
- merge;
- storico;
- consenso/documento;
- consultazione.

Regola:

- il cliente non e solo contatto: deve alimentare agenda, cassa, marketing, protocolli e AI Gold.

## Agenda

Route:

- `GET /api/appointments`
- `POST /api/appointments`
- `PUT /api/appointments/:id`
- `DELETE /api/appointments/:id`

Regole:

- data reale;
- conferma arrivo;
- spostamento;
- eliminazione;
- no-show/annulla/cassa con feedback visibile.

UX:

- apertura rapida;
- inserimento veloce da slot orario;
- full screen pulito;
- topbar nascosta in full screen;
- azioni rapide in menu laterale.

## Cassa / Pagamenti

Route:

- `GET /api/payments`
- `GET /api/payments/summary`
- `GET /api/payments/unlinked`
- `POST /api/payments/cash-close`
- `POST /api/payments`
- `POST /api/payments/:id/link`

Regola piano:

- Cassa resta attiva anche nel Base;
- Base vede incassi e pagamenti cliente;
- redditivita, margini e analisi avanzate partono da Silver/Gold.

## Servizi / Staff / Risorse

Route:

- `/api/catalog/services`
- `/api/catalog/staff`
- `/api/catalog/resources`

Funzioni:

- catalogo servizi;
- operatori;
- risorse/tecnologie;
- durata/prezzo/costo se presente;
- base per agenda, cassa, redditivita e protocolli.

## Turni

Route:

- `GET/POST/PUT/DELETE /api/shifts`
- `GET/POST/PUT/DELETE /api/shifts/templates` da Silver
- `POST /api/shifts/templates/generate` da Silver
- `GET /api/shifts/export` da Silver

Regola piano:

- Base: inserimento e lettura turni;
- Silver: schemi/template/export;
- Gold: AI sopra turni se collegata a decisioni operative.

## Magazzino

Route:

- `GET/POST/PUT/DELETE /api/inventory/items`
- `GET/POST /api/inventory/movements` da Silver
- `GET /api/inventory/overview` da Silver

Regola piano:

- Base: articoli, giacenze, costo;
- Silver: movimenti, alert, overview;
- Gold: suggerimenti e priorita sopra stock.

Posizionamento:

- controllo centro premium;
- non elenco prodotti freddo.

## Trattamenti / Protocolli

Route:

- `GET/POST /api/treatments` da Silver per area trattamenti evoluta; i protocolli manuali restano nel Base tramite hub protocolli/scheda cliente
- `GET/POST/PUT/DELETE /api/protocols`
- `POST /api/ai-gold/protocols/draft` fuori scope commerciale finche non e sistemato e testato

Regola:

- protocolli base manuali;
- Silver aggiunge controllo operativo evoluto, non protocolli AI;
- Gold aggiunge AI operativa sopra priorita, marketing e redditivita, non protocolli guidati/adattivi in questa fase;
- protocolli AI, protocolli guidati/adattivi e analisi protocollo AI restano fuori dai piani finche non sono sistemati e testati;
- output sempre confermato dall'operatore.

Analisi protocollo deve leggere:

- scheda cliente;
- storico trattamenti;
- area/zona/esigenza;
- sensibilita;
- tecnologie;
- prodotti;
- obiettivo seduta;
- eventuale foto/lettura operatore in futuro.

## Report

Route:

- `GET /api/reports/operational` da Silver
- `GET /api/reports/export` da Silver
- `GET /api/reports/open-exports` da Silver
- `GET /api/reports/operator/:id` da Silver
- `GET /api/reports/operator/:id/export` da Silver

Regola:

- Base lavora;
- Silver legge;
- Gold decide priorita sopra i dati.

## Qualita Dati

Route:

- `GET /api/data-quality`

Uso:

- controlla consistenza dati;
- alimenta Progressive Intelligence;
- riduce decisioni AI se il dato e povero.

## Cosa E Gia Operativo

- Moduli operativi principali.
- CRUD e report base.
- Gating Base/Silver/Gold.
- Data quality.
- Cassa nel Base.
- Protocolli e trattamenti con gating.

## Cosa Resta Da Validare Live

- Che ogni pulsante dia feedback immediato.
- Che Base/Silver/Gold abbiano preview/upgrade coerenti.
- Che i dati centro non si mischino tra tenant.
- Che dashboard non ricalcoli tutto all'apertura.
- Che protocolli non inventino dati clinici o terapeutici.
