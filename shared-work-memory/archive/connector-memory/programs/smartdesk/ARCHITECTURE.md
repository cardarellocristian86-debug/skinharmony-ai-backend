# Architettura Smart Desk

Aggiornato: 2026-06-06 - Assistente virtuale Nyra local-first e fix live AI Gold owner/admin/cassa/report.

## Dove Vive

- Desktop: `skin-harmony-desktop`.
- Web: `smartdesk` / `smartdesk-live`.
- Live Render: `render-smartdesk-live`.
- Backend/API: `services/api-server`.
- AI service: `services/ai-service`.
- Live Render: `https://skinharmony-smartdesk-live.onrender.com`.

## Componenti

- UI gestionale.
- SQLite/offline-first desktop.
- Backend/API per sync e live.
- AI service via backend.
- Gold Decision Engine e capability layer.
- Assistente virtuale Nyra: router locale nel backend prima di ogni chiamata OpenAI.

## Flussi

1. Centro usa agenda/clienti/cassa.
2. Dati reali alimentano dashboard e AI Gold.
3. AI Gold suggerisce priorità e azioni.
4. Operatore conferma.

## Confini

- Gestionale/Core/Silver sono fonte dei numeri.
- AI Gold interpreta e propone.
- Suite vende/licenzia e collega nodi.
- Universal Core governa decisioni critiche quando integrato.

## Mappa A Blocchi

1. `BLOCK_01_RENDER_RUNTIME_API_PERSISTENCE_MAP.md` - runtime Render, API, persistenza, auth, safe mode e gating.
2. `BLOCK_02_OPERATIONAL_DOMAIN_MODULES_MAP.md` - dashboard, clienti, agenda, cassa, turni, magazzino, protocolli e report.
3. `BLOCK_03_AI_GOLD_DECISION_FLEET_WHATSAPP_MAP.md` - AI Gold, decision engine, Progressive Intelligence, WhatsApp e Fleet.
4. `BLOCK_04_SUITE_CORE_DESKTOP_WEB_DEPLOYMENT_MAP.md` - Suite bridge, Universal Core bridge, desktop/web e deploy.
5. `BLOCK_05_GOLD_STATE_DECISION_ENGINE_DEEP_MAP.md` - Gold State, Corelia, temporal layer, enterprise layer e capability gating.
6. `BLOCK_06_GOLD_MARKETING_PROFITABILITY_PROTOCOLS_MAP.md` - marketing Gold, redditivita, protocolli, cassa e data quality.
7. `BLOCK_07_GOLD_ONBOARDING_PIAL_LEARNING_MAP.md` - onboarding/import, PIAL, maturita e learning outcome.
8. `BLOCK_08_FRONTEND_API_GOLD_UI_MAP.md` - endpoint Gold, UI bridge, Fleet UI e regole frontend.
9. `BLOCK_09_GOLD_READINESS_TEST_RELEASE_MAP.md` - readiness commerciale, test minimi, limiti e release checklist.

## Stato Architetturale Verificato - Blocco 01

- Live Render usa `render-smartdesk-live/server.js` con Express.
- Persistenza: Postgres se `DATABASE_URL`, altrimenti JSON locale.
- Safe mode controlla carico, p95, errori, concorrenza e burst.
- Auth/trial/password hanno rate limit e flussi dedicati.
- API operative coprono clienti, agenda, cataloghi, turni, magazzino, cassa, protocolli e admin.

## Stato Architetturale Verificato - Blocco 02

- I moduli operativi sono il centro dati reale.
- Base mantiene cassa, agenda, clienti, marketing manuale, turni base, magazzino base e protocolli manuali.
- Base include anche servizi/listino, storico appuntamenti cliente, pagamenti/storico pagamenti, note cliente, report base e impostazioni centro.
- Cassa Base/Silver/Gold conserva righe `serviceLines` e `productSales`; se il client invia `lines`, il backend le normalizza in servizio/prodotto e il report operativo legge `topProducts` e `paymentMethods`.
- Silver aggiunge redditivita, report evoluti, turni/magazzino evoluti e controlli operativi piu profondi.
- Gold aggiunge intelligenza sopra i moduli: priorita giornaliere, marketing suggerito/autopilot approvabile, clienti da recuperare, alert redditivita e suggerimenti sempre confermati.
- Protocolli AI, protocolli guidati/adattivi e analisi protocollo AI non sono assegnati ai piani commerciali finche non sono sistemati e testati.

## Stato Architetturale Verificato - Blocco 03

Aggiornamento 2026-05-31:

- Smart Desk non deve contenere Nyra/Core come motore decisionale primario.
- Smart Desk resta `SmartDeskDataSource`: CRUD, moduli, indici, dirty block, snapshot dashboard salvati e fallback dati.
- L'assistente operativo UI e rinominato `Assistente virtuale Nyra`: per supporto gestionale, apertura moduli e azioni sicure usa regole locali/Nyra e non consuma OpenAI.
- Router assistente stabile: `local_support`, `local_navigation`, `local_safe_action`, `openai_required`, `core_required`, `gold_decision_required`.
- OpenAI e ammesso solo per richieste linguistiche/articolate o non coperte localmente; richieste sensibili/distruttive restano `core_required`; letture Gold restano su Gold State/Core/Nyra e non inventano dati.
- Silver usa Core server in lettura read-only quando configurato: branch `front_desk_base`, `operations_silver` e guard operativo Smart Desk.
- Gold usa Core server come gate decisionale, Nyra server come spiegazione e OpenAI solo come rifinitura voce se disponibile: branch `executive_gold`, `smartdesk_operations_guard`, `customer_360_guard`, `consent_ledger_guard` e `beauty_protocol_guard`.
- Il bridge AI Gold passa a Core/Nyra il pacchetto branch esplicito per piano e il profilo settore/centro; Nyra riceve il riepilogo branch come learning contestuale della risposta.
- Il layer locale `Gold State` resta evidenza/fallback incrementale, non autorita decisionale primaria quando il bridge esterno risponde.
- Dashboard: apertura = lettura ultimo snapshot salvato; se cambiano appuntamenti, cassa, clienti, servizi, operatori o dati collegati, viene invalidato solo lo snapshot dipendente del centro e la lettura successiva lo ricrea.

- AI Gold legge capability, decision context e Gold State.
- Endpoint `/api/ai-gold/ask` usa `requirePlan("gold")`: owner/admin Gold autorizzati, Base/Silver bloccati da `plan_locked`, superadmin resta invariato.
- Universal Core e gate primario quando configurato; Corelia/fallback locale resta interno.
- Il bridge Corelia/Nyra espone anche `reply_source` e `validator`: le risposte valide sono marcate `validated`, mentre output generici o non ancorati ai dati passano a `guarded_repair` senza eseguire azioni automatiche.
- Progressive Intelligence attiva funzioni in base alla qualita dati.
- WhatsApp Gold richiede consenso/conferma e usa fallback copia se Twilio non e pronto.
- Fleet Intelligence e superadmin-only e read-only.

## Stato Architetturale Verificato - Blocco 04

- Suite App Key Bridge parla con endpoint Suite `smartdesk-app-key-factory`.
- Universal Core Bridge usa `/v1/tenant/status`, `/v1/ecosystem-pulse`, `/v1/decision`.
- Desktop resta sorgente madre UX; web/live devono restare allineati.
- Suite vende/licenzia/configura, Smart Desk esegue, Core governa decisioni.

## Stato Architetturale Verificato - Blocco 05

- Gold State usa record `gold_state:<centerId>` e componenti `Rev/U/Sat/Act/Cont/Ticket/Prod/DQ/CostConf/Margin/Conf`.
- Business Snapshot comprime marketing, agenda, cassa, redditivita, operatori e inventory in branch decisionali.
- Decision Core calcola phi, RAP, RAP2, EV, OC, NEU, action band e block reasons.
- Temporal layer usa storico e volatilita; Enterprise layer usa rischio, utilita attesa e learning bayesiano sugli outcome.
- Capability layer blocca esecuzione se piano, confidence, rischio, frizione o PIAL non sono coerenti.

## Stato Architetturale Verificato - Blocco 06

- Marketing Gold legge CRM, storico, pagamenti, servizi, consensi, valore cliente, routine, contactability e spam pressure.
- Redditivita Gold legge pagamenti collegati, durata, costi operatore, prodotti, tecnologie e sconti.
- Se costi o qualita dati mancano, Gold deve abbassare confidence o chiedere configurazione.
- Protocolli manuali sono nel Base; Protocolli AI restano laboratorio/backlog e non vanno promessi nei piani commerciali.
- WhatsApp Gold richiede consenso, telefono valido, soglie rischio/confidence e conferma operatore.
- WhatsApp Gold puo usare tre stati provider: Twilio proprio del centro, Twilio piattaforma SkinHarmony o fallback manuale. Le credenziali Twilio centro sono tenant-scoped lato server e il token non torna al frontend.

## Stato Architetturale Verificato - Blocco 07

- Gold Onboarding importa CSV/XLSX separando `SAFE`, `REVIEW`, `INVALID`.
- Conferma import ricostruisce Gold State e ricalcola PIAL.
- PIAL attiva funzioni da L0 a L5 in base a storico, volume dati, costi, CRM, stabilita ed affidabilita economica.
- Forecast/oracle resta prudenziale e solo con requisiti L5.

## Stato Architetturale Verificato - Blocco 08

- UI Gold deve leggere capability e decision context, non duplicare decisioni.
- Gold Bridge mostra priorita, confidence, rischio, azione, spiegazione, bloccati ed effetto domino.
- Fleet resta read-only e superadmin-only.

## Stato Architetturale Verificato - Blocco 09

- Gold e vendibile come responsabile operativo digitale assistito, non come automazione autonoma.
- Release richiede test endpoint Gold, onboarding, state rebuild, PIAL, WhatsApp e UI senza overflow.
