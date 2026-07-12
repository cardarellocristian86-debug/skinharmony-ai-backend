# Smart Desk Web Alignment Execution Roadmap - 2026-05-17

## Obiettivo
Trasformare la spec `desktop -> web` in una roadmap operativa chiudibile a blocchi.

Regola:
- ogni task si chiude solo con prova
- non contano solo i fix tecnici
- conta il comportamento reale per l operatore

## Sequenza obbligatoria
1. `Agenda`
2. `Client detail`
3. `Cashdesk`
4. `AI Gold`
5. `Marketing`
6. `Inventory`
7. `Profitability`
8. `Protocols / Treatments`
9. `Refactor architettura web`

## Task 01 - Agenda parity
### Obiettivo
Portare la web alla stessa profondita operativa della desktop sulla vista centrale del prodotto.

### Stato 2026-05-17
- `parziale chiuso`
- aggiunti nella web:
  - drawer agenda con tab reali `Appuntamento / Cliente / Azioni`
  - azioni operative con feedback immediato:
    - `Conferma arrivo`
    - `Apri cassa`
    - `Chiudi`
    - `Non presentato`
    - `Annulla`
    - `Sposta`
  - `Apri cassa` ora registra un incasso minimo via `/api/sales` e chiude l appuntamento
  - `Apri scheda` ora apre davvero la vista clienti con focus sul cliente selezionato
  - mini `client detail` read-only nella vista clienti
  - quick panel slot piu utile:
    - operatore
    - carico operatore sul giorno
    - contesto rapido
    - scorciatoia `Nuovo cliente`
  - `Nota tecnica` minimale sull appuntamento via update note
  - `Full screen` agenda locale:
    - topbar nascosta
    - content area allargata
    - layout focalizzato su `agenda + drawer`
- file toccato:
  - `smartdesk/public/app.js`
  - `smartdesk/public/styles.css`
- verifica minima:
  - `node --check smartdesk/public/app.js`
- ancora aperto:
  - quick panel piu ricco
  - cash flow vero da agenda
  - technical sheet flow
  - gerarchia full screen coerente con desktop

### Da fare
- portare drawer cliente
- portare quick panel reale
- portare move flow
- portare cash flow da agenda
- portare technical sheet flow
- portare feedback immediato su annullo/elimina/no-show/cassa
- portare gerarchia full screen coerente

### File guida
- `skin-harmony-desktop/src/renderer/pages/AppointmentsPage.tsx`
- `smartdesk/public/app.js`
- `SMARTDESK_LOGICA_COMANDI.md`

### Criterio di chiusura
- agenda web gestisce data reale
- crea cliente + appuntamento senza regressioni
- move flow visibile e coerente
- cash flow da agenda visibile
- feedback immediato sui pulsanti operativi

### Prova richiesta
- test manuale
- nota di confronto desktop/web
- eventuale preflight collegato

## Task 02 - Client detail parity
### Obiettivo
Portare la scheda cliente web allo stesso ruolo operativo della desktop.

### Stato 2026-05-18
- `quasi chiuso strutturalmente`
- aggiunti nella web:
  - storico appuntamenti cliente
  - ultimi incassi cliente
  - `prossima sessione`
  - `incasso totale`
  - `continuita cliente` leggibile da dati reali
  - riquadro `Gold / Core` come lettura di supporto
  - `dossier operativo` cliente:
    - consensi
    - recall
    - protocollo consigliato
    - allergie
    - tier
    - photo status
  - `azione consigliata Gold` con messaggio copiabile e blocco se manca consenso marketing
  - blocco `prossimo step`
  - scorciatoie:
    - `Apri agenda`
    - `Apri AI Gold`
- file toccato:
  - `smartdesk/public/app.js`
- verifica minima:
  - `node --check smartdesk/public/app.js`
- ancora aperto:
  - continuita piu ricca
  - consulenza collegata
  - prossimo step guidato da Gold/Core piu forte
  - edit piu completo in stile desktop

### Da fare
- storico appuntamenti
- pagamenti cliente
- note e continuita
- consulenza collegata
- aggancio a prossimi step
- aggancio ad AI Gold

### File guida
- `skin-harmony-desktop/src/renderer/pages/ClientDetailPage.tsx`
- `smartdesk/public/app.js`

### Criterio di chiusura
- la web non mostra solo lista clienti
- esiste una scheda cliente viva, usabile, orientata al lavoro

### Prova richiesta
- walkthrough cliente reale/demo
- confronto funzionale con desktop

## Task 03 - Cashdesk parity
### Obiettivo
Rendere la cassa web equivalente alla desktop.

### Stato 2026-05-18
- `chiuso locale`
- aggiunti nella web:
  - vista `Cassa` dedicata nel menu
  - riepilogo incassi giorno
  - conteggio pagamenti
  - conteggio sedute chiuse / aperte
  - breakdown per metodo
  - verifica minima della giornata
  - form rapido pagamento
  - storico pagamenti cliente / globale
  - collegamento minimo `pagamento <-> appuntamento`:
    - selezione seduta aperta
    - prefill cliente/descrizione
    - chiusura appuntamento al salvataggio
  - lettura cassa per giorno scelto:
    - data operativa selezionabile
    - pagamenti del giorno
    - sedute aperte/chiuse sul giorno
  - `verifica giornata` piu leggibile:
    - stato sintetico `Sotto controllo / Serve attenzione / Da chiudere`
    - rischio coerente con lo stato del giorno
    - lista punti da verificare da dati reali
  - `storico pagamenti` meno grezzo:
    - ambito `cliente selezionato / storico globale`
    - conteggio pagamenti
    - totale storico incassato
    - data ultimo pagamento
  - lista prudente `sedute chiuse da verificare`:
    - mostra solo appuntamenti chiusi del giorno senza un pagamento evidente nello stesso giorno per quel cliente
    - usata come supporto operativo, non come contabilita automatica
  - `chiusura giornata` leggibile:
    - stato `Pronta da chiudere / Non ancora pronta`
    - numero punti aperti
    - messaggio di chiusura coerente con lo stato del giorno
- file toccati:
  - `smartdesk/public/index.html`
  - `smartdesk/public/app.js`
- verifica minima:
  - `node --check smartdesk/public/app.js`
- nota:
  - il task e chiuso sul perimetro web locale coerente col piano Base
  - la desktop resta piu ricca sul lato contabile avanzato, ma non blocca la chiusura di questo step

### Da fare
- checkout
- metodi pagamento
- storico pagamenti
- chiusura appuntamento collegato
- distinzione chiara cassa vs redditivita

### File guida
- `skin-harmony-desktop/src/renderer/pages/CashdeskPage.tsx`
- `smartdesk/public/app.js`
- `SMARTDESK_LOGICA_COMANDI.md`

### Criterio di chiusura
- la cassa web registra e legge davvero i pagamenti
- il flusso e coerente col piano Base

### Prova richiesta
- test manuale su contanti/carta
- evidenza di collegamento appuntamento/pagamento

## Task 04 - AI Gold parity
### Obiettivo
Rendere AI Gold la stessa stanza premium sia su web sia su desktop.

### Stato 2026-05-18
- `parziale chiuso`
- aggiunti nella web:
  - vista dedicata `AI Gold` in navigazione
  - stanza operativa separata dalla dashboard
  - priorita primaria con apertura modulo coerente
  - priorita secondarie con link al modulo target
  - `pressioni di oggi` con conferme aperte, cassa e segnali centro
  - `coda marketing da approvare` da dati reali clienti/consenso/recall
  - `policy di esecuzione` esplicita:
    - conferma operatore richiesta
    - esecuzione diretta bloccata
  - il riepilogo dashboard mantiene il blocco `Alert prioritari AI` ma ora apre la stanza Gold vera
- file toccati:
  - `smartdesk/public/index.html`
  - `smartdesk/public/app.js`
- verifica minima:
  - `node --check smartdesk/public/app.js`
- ancora aperto:
  - allineamento ancora piu stretto con le priorita della desktop
  - maggiore profondita su code marketing/autopilot
  - raccordo piu ricco con protocolli e redditivita

### Da fare
- pagina/stanza dedicata coerente
- stessi ingressi da dashboard/marketing/clienti
- stesso gating piano Gold
- stessa semantica operativa
- stesso legame con GoldState/Universal Core

### File guida
- `skin-harmony-desktop/src/renderer/pages/AiGoldPage.tsx`
- `services/api-server/src/services/GoldStateService.js`
- `services/api-server/src/services/AssistantService.js`
- `smartdesk/public/app.js`

### Criterio di chiusura
- AI Gold web non e solo copy
- legge dati reali
- legge decision context
- apre i flussi giusti
- non esegue senza conferma

### Prova richiesta
- walkthrough con dati demo reali
- evidenza su priorita, action e ruolo del Core

## Task 05 - Marketing parity
### Obiettivo
Portare il marketing web al livello prodotto desktop.

### Stato 2026-05-18
- `parziale chiuso`
- aggiunti nella web:
  - vista dedicata `Marketing` in navigazione
  - rispetto modulo acceso/spento nel menu
  - bucket recall:
    - `Da richiamare`
    - `A rischio`
    - `Perso`
    - `Storico`
  - messaggio suggerito copiabile per cliente
  - blocco su consenso marketing mancante
  - apertura diretta scheda cliente
  - ponte coerente con piano:
    - Base/Silver -> marketing manuale
    - Gold -> ponte a `AI Gold`
  - richiamo della coda marketing Gold anche dentro Marketing
- file toccati:
  - `smartdesk/public/index.html`
  - `smartdesk/public/app.js`
- verifica minima:
  - `node --check smartdesk/public/app.js`
- ancora aperto:
  - queue/autopilot piu ricca
  - stati `to_approve / approved / copied / done / archived`
  - integrazione piu stretta con azioni confermabili/WhatsApp

### Da fare
- recall manuale
- bucket `da richiamare / a rischio / perso / storico`
- messaggi suggeriti
- collegamento a coda Gold se attiva

### File guida
- `skin-harmony-desktop/src/renderer/pages/MarketingPage.tsx`
- `smartdesk/public/app.js`

### Criterio di chiusura
- il marketing web non e una lista povera
- e operativo e leggibile per il centro

### Prova richiesta
- test con clienti demo
- bucket corretti

## Task 06 - Inventory parity
### Obiettivo
Portare il magazzino web al livello premium richiesto dal prodotto.

### Stato 2026-05-18
- `parziale chiuso`
- aggiunti nella web:
  - vista dedicata `Magazzino` in navigazione
  - rispetto modulo acceso/spento nel menu
  - overview premium:
    - articoli attivi
    - sottoscorta
    - valore costo
    - valore retail
  - lista `Sottoscorta e priorita`
  - lista `Articoli in stock` con stato reale
  - registrazione movimento stock reale:
    - carico
    - scarico
    - consumo cabina
    - vendita retail
    - reso
    - rettifica stock
  - lettura `Movimenti recenti`
  - aggancio migliore a Gold: dominio inventory ora apre `Magazzino`
- file toccati:
  - `smartdesk/public/index.html`
  - `smartdesk/public/app.js`
- verifica minima:
  - `node --check smartdesk/public/app.js`
- ancora aperto:
  - CRUD articolo piu profondo
  - report magazzino piu ricco
  - maggior allineamento visivo/operativo con la desktop

### Da fare
- stock
- movimenti
- sottoscorta
- valore operativo
- segnali verso Gold

### File guida
- `skin-harmony-desktop/src/renderer/pages/InventoryPage.tsx`
- `smartdesk/public/app.js`

### Criterio di chiusura
- il magazzino web legge e mostra controllo centro, non solo elenco freddo

### Prova richiesta
- test su giacenze e sottoscorta

## Task 07 - Profitability parity
### Obiettivo
Portare la redditivita web al livello desktop.

### Stato 2026-05-18
- `parziale chiuso`
- aggiunti nella web:
  - vista `Redditivita` dedicata in navigazione
  - gating coerente col modulo `profitabilityEnabled`
  - range data `da / a`
  - refresh analisi esplicito
  - overview reale da backend:
    - servizi letti
    - ricavi analizzati
    - costo totale
    - profitto totale
  - sezioni dedicate:
    - `Servizi`
    - `Prodotti`
    - `Tecnologie`
    - `Alert automatici`
  - stato chiaro quando l overview non e disponibile:
    - niente numeri inventati
    - messaggio esplicito di analisi assente
- file toccati:
  - `smartdesk/public/index.html`
  - `smartdesk/public/app.js`
- verifica minima:
  - `node --check smartdesk/public/app.js`
- ancora aperto:
  - trend mensile piu ricco se il backend lo espone
  - lettura ancora piu stretta del rapporto con Gold
  - raffinamento del linguaggio premium su alert e blocchi economici

### Da fare
- ricavi
- costi
- utile
- margini
- trend
- alert coerenti

### File guida
- `skin-harmony-desktop/src/renderer/pages/ProfitabilityPage.tsx`
- `smartdesk/public/app.js`
- `SMARTDESK_LOGICA_COMANDI.md`

### Criterio di chiusura
- la lettura e basata su dati reali
- segnala chiaramente se i dati sono insufficienti

### Prova richiesta
- test con pagamenti reali/demo
- evidenza andamento mensile se dati presenti

## Task 08 - Protocols / Treatments parity
### Obiettivo
Portare web allo stesso contratto prodotto desktop per protocolli e trattamenti.

### Stato 2026-05-18
- `parziale chiuso`
- aggiunti nella web:
  - vista `Protocolli` dedicata in navigazione
  - gating coerente sui moduli `protocols` e `treatments`
  - stanza unica locale con:
    - perimetro piano
    - stato moduli collegati
    - trattamenti registrati recenti
    - scheda trattamento reale
    - passaggi operativi
  - registrazione trattamento reale via `/api/treatments`
  - aggancio minimo a `AI Gold` e alle `schede cliente`
- file toccati:
  - `smartdesk/public/index.html`
  - `smartdesk/public/app.js`
- verifica minima:
  - `node --check smartdesk/public/app.js`
- ancora aperto:
  - consulenza protocollo piu ricca
  - allineamento piu profondo con dettaglio cliente desktop
  - separazione ancora piu netta tra `hub protocolli` e `scheda trattamento` se serve come viste distinte

### Da fare
- protocolli
- trattamenti
- connessione con cliente
- connessione con AI Gold / protocol AI

### File guida
- `skin-harmony-desktop/src/renderer/pages/ProtocolsPage.tsx`
- `skin-harmony-desktop/src/renderer/pages/TreatmentsPage.tsx`
- `smartdesk/public/app.js`

### Criterio di chiusura
- web non lascia questi moduli come shell incompleta

### Prova richiesta
- walkthrough flusso base

## Task 09 - Gating parity
### Obiettivo
Allineare perfettamente i gate tra web e desktop.

### Stato 2026-05-18
- `parziale chiuso`
- riallineato il criterio base:
  - `modulo + piano`, non solo `modulo`
- aggiornamenti fatti:
  - `runtimeMeta` locale ora espone anche `subscription.plan`
  - la web usa il piano per governare:
    - `profitability`
    - `reports`
    - `treatments`
    - `AI Gold`
  - il piano `Base` non sblocca piu in web viste che in desktop richiedono almeno `Silver`
- file toccati:
  - `smartdesk/server.js`
  - `smartdesk/public/app.js`
- verifica minima:
  - `node --check smartdesk/public/app.js`
  - `node --check smartdesk/server.js`
- ancora aperto:
  - preview upgrade piu esplicita per ogni piano
  - blocco URL diretto ancora piu coerente su tutte le viste
  - rifinitura dei messaggi `Base / Silver / Gold` modulo per modulo

### Da fare
- Base / Silver / Gold
- moduli attivi/spenti
- preview upgrade
- blocco URL diretto coerente

### File guida
- `skin-harmony-desktop/src/renderer/lib/subscriptionPlan.ts`
- `skin-harmony-desktop/src/renderer/hooks/useAppSettings.ts`
- `smartdesk/public/app.js`
- `SMARTDESK_LOGICA_COMANDI.md`

### Criterio di chiusura
- i due prodotti non divergono su moduli e piano

### Prova richiesta
- tabella piano/modulo
- test minimo URL/modulo

## Task 10 - Refactor web architecture
### Obiettivo
Uscire dal monolite `smartdesk/public/app.js`.

### Stato 2026-05-18
- `quasi chiuso strutturalmente`
- primo pattern architetturale introdotto:
  - nuove viste estratte in moduli dedicati sotto `smartdesk/public/views/`
  - `app.js` mantiene wiring, stato residuo, helper condivisi residui e orchestrazione
  - config runtime e stato iniziale spostati in `smartdesk/public/runtime.js`
  - i18n shell spostato in `smartdesk/public/i18n.js`
  - helper UI condivisi spostati in `smartdesk/public/ui-helpers.js`
  - shell logic spostata in `smartdesk/public/shell-helpers.js`
  - flow operativi condivisi spostati in `smartdesk/public/operations.js`
  - helper di dominio clienti/cassa spostati in `smartdesk/public/domain/smartdesk.js`
  - normalizer shell spostati in `smartdesk/public/domain/normalizers.js`
- viste gia estratte:
  - `Agenda`
  - `Clienti`
  - `Cassa`
  - `Redditivita`
  - `Protocolli`
  - `Marketing`
  - `Magazzino`
- file nuovi:
  - `smartdesk/public/bootstrap/global.js`
  - `smartdesk/public/data-orchestration.js`
  - `smartdesk/public/runtime.js`
  - `smartdesk/public/i18n.js`
  - `smartdesk/public/ui-helpers.js`
  - `smartdesk/public/shell-helpers.js`
  - `smartdesk/public/operations.js`
  - `smartdesk/public/domain/smartdesk.js`
  - `smartdesk/public/domain/normalizers.js`
  - `smartdesk/public/views/agenda.js`
  - `smartdesk/public/views/clients.js`
  - `smartdesk/public/views/cashdesk.js`
  - `smartdesk/public/views/profitability.js`
  - `smartdesk/public/views/protocols.js`
  - `smartdesk/public/views/marketing.js`
  - `smartdesk/public/views/inventory.js`
  - `smartdesk/public/view-bindings/primary.js`
  - `smartdesk/public/view-bindings/secondary.js`
- helper di dominio spostati fuori da `app.js`:
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
  - `normalizeClient`
  - `normalizeAppointment`
  - `normalizeService`
  - `normalizeStaff`
  - `normalizeInventoryItem`
  - `normalizeInventoryMovement`
  - `normalizeProfitabilityOverview`
  - `normalizeTreatment`
- file aggiornati:
  - `smartdesk/public/app.js`
- verifica minima:
  - `node --check smartdesk/public/app.js`
  - `node --check smartdesk/public/bootstrap/global.js`
  - `node --check smartdesk/public/data-orchestration.js`
  - `node --check smartdesk/public/runtime.js`
  - `node --check smartdesk/public/i18n.js`
  - `node --check smartdesk/public/ui-helpers.js`
  - `node --check smartdesk/public/shell-helpers.js`
  - `node --check smartdesk/public/operations.js`
  - `node --check smartdesk/public/domain/smartdesk.js`
  - `node --check smartdesk/public/domain/normalizers.js`
  - `node --check smartdesk/public/view-bindings/primary.js`
  - `node --check smartdesk/public/view-bindings/secondary.js`
  - `node --check smartdesk/public/views/agenda.js`
  - `node --check smartdesk/public/views/clients.js`
  - `node --check smartdesk/public/views/cashdesk.js`
  - `node --check smartdesk/public/views/profitability.js`
  - `node --check smartdesk/public/views/protocols.js`
  - `node --check smartdesk/public/views/marketing.js`
  - `node --check smartdesk/public/views/inventory.js`
- ancora aperto:
  - stato globale ancora dentro `app.js`
  - alcuni helper condivisi residui ancora dentro `app.js`
  - prova funzionale reale fuori sandbox
  - rifinitura finale del wiring e validazione reale dopo estrazione massiva

### Da fare
- spezzare la web in pagine/componenti
- riallinearla alla desktop come struttura
- mantenere comportamento coerente durante la transizione

### Criterio di chiusura
- la web non dipende piu da un file unico per tutta la logica

### Prova richiesta
- mappa nuova cartelle/componenti
- riduzione netta della logica nel monolite
- smoke reale fuori sandbox o terminale utente

## Task trasversali

### A. i18n parity
- stessa qualita lingua
- niente residui inglesi in italiano
- niente copy divergente

### B. Core / Gold parity
- stessa semantica decisionale
- niente numeri inventati
- stesso ruolo del Core

### C. Anti-regressione
Prima di chiudere un blocco:
- login
- agenda crea cliente + appuntamento
- turni
- cassa
- gating piani
- modulo toccato

## Chiusura grande
Il punto `Allineare davvero Smart Desk web alla desktop come sorgente madre` si puo segnare `[x]` solo quando:
- task 01-10 sono chiusi
- i gate sono coerenti
- AI Gold e Core hanno lo stesso ruolo in entrambe le shell
- la web non e piu una shell storica divergente
