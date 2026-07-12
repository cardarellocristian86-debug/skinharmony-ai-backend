# Smart Desk Web vs Desktop Alignment Spec - 2026-05-17

## Obiettivo
- Portare la `web` allo stesso prodotto della `desktop`.
- Non basta allineare grafica o naming.
- Devono allinearsi:
  - moduli
  - profondita operativa
  - gating piani/moduli
  - semantica AI
  - struttura delle viste

## Stato attuale

### Desktop
La desktop e la `fonte madre` del prodotto.

Superfici reali presenti nel codice:
- `Dashboard`
- `Ecosystem`
- `Clients`
- `Client detail`
- `Appointments / Agenda`
- `Shifts`
- `Reports`
- `Operator report`
- `Marketing`
- `Inventory`
- `Profitability`
- `AI Gold`
- `Services`
- `Protocols`
- `Treatments`
- `Cashdesk`
- `Settings`

Riferimenti:
- `skin-harmony-desktop/src/renderer/App.tsx`
- `skin-harmony-desktop/src/renderer/pages/*`

### Web
La web oggi e ancora una `shell operativa avanzata`, non l intero prodotto desktop portato online.

Superfici principali attuali:
- `ecosystem`
- `dashboard`
- `appointments`
- `reports`
- `clients`
- `services`
- `settings`

Riferimenti:
- `smartdesk/public/index.html`
- `smartdesk/public/app.js`

## Gap veri da chiudere

### 1. Architettura
Problema:
- desktop = pagine React/TS vere
- web = logica concentrata in `smartdesk/public/app.js`

Effetto:
- crescita piu fragile
- moduli meno profondi
- maggiore rischio divergenza

Target:
- la web va spezzata in pagine/componenti coerenti alla desktop
- no ulteriore crescita del monolite `app.js`

Priorita:
- `critica`

### 2. Agenda
Problema:
- la desktop ha una agenda piu profonda e piu operativa
- la web ha una buona agenda, ma non allo stesso livello

Aggiornamento `2026-05-17`:
- primo riallineamento reale fatto in `smartdesk/public/app.js`
- la web ora ha:
  - drawer agenda con tre tab funzionali
  - update stato appuntamento con feedback immediato
  - move flow base
  - salto coerente da agenda a `client detail` web minimo
- non e ancora parity completa desktop

Gap principali da portare:
- drawer cliente
- quick panel reale
- move flow
- cash flow da agenda
- technical sheet flow
- stessa gerarchia visiva per agenda full screen
- stessa logica feedback immediato

Riferimento desktop:
- `skin-harmony-desktop/src/renderer/pages/AppointmentsPage.tsx`

Priorita:
- `1`

### 3. Client detail
Problema:
- la desktop ha una scheda cliente piu viva e collegata al lavoro
- la web non e ancora allo stesso livello

Da allineare:
- storico
- consulenza
- continuita cliente
- prossimi step
- aggancio ad AI Gold

Priorita:
- `2`

### 4. Cashdesk
Problema:
- nella desktop la Cassa e un modulo vero
- nella web non e ancora una vista equivalente completa

Da allineare:
- checkout
- storico pagamenti
- metodi pagamento
- collegamento con appuntamenti
- feedback immediato operativo

Priorita:
- `3`

### 5. AI Gold
Problema:
- la web lo racconta bene come shell
- la desktop ha gia route/pagina dedicate
- ma le due shell devono comportarsi come lo stesso prodotto

Da allineare:
- stessa stanza `AI Gold`
- stessi ingressi da dashboard/marketing/clienti
- stesso gating piano
- stessa semantica operativa
- stesso legame con `GoldState / Universal Core`

Priorita:
- `4`

### 6. Marketing
Problema:
- il prodotto commerciale prevede marketing base/gold
- la web non e ancora al livello della desktop come modulo vero

Da allineare:
- recall
- da richiamare / a rischio / perso / storico
- messaggi suggeriti
- coda AI Gold quando prevista

Priorita:
- `5`

### 7. Inventory
Problema:
- il modulo magazzino deve essere premium/operativo
- oggi la web non e ancora equivalente alla desktop

Da allineare:
- stock
- movimenti
- sottoscorta
- valore operativo
- segnali verso Gold

Priorita:
- `6`

### 8. Profitability
Problema:
- il modulo esiste nel prodotto desktop
- la web non e ancora allo stesso livello funzionale

Da allineare:
- ricavi
- costi
- utile
- margini
- trend
- alert coerenti con dati reali

Priorita:
- `7`

### 9. Protocols / Treatments
Problema:
- la desktop ha superfici piu ricche
- la web deve arrivare allo stesso contratto prodotto

Da allineare:
- protocolli
- trattamenti
- connessione con scheda cliente
- connessione con AI Gold / protocol AI

Priorita:
- `8`

### 10. Gating moduli e piani
Problema:
- desktop e web devono mostrare gli stessi moduli e gli stessi blocchi commerciali

Da allineare:
- Base / Silver / Gold
- moduli attivi/spenti
- preview upgrade
- blocco coerente da URL diretto

Priorita:
- `trasversale`

## Ordine di lavoro consigliato
1. `Agenda`
2. `Client detail`
3. `Cashdesk`
4. `AI Gold`
5. `Marketing`
6. `Inventory`
7. `Profitability`
8. `Protocols / Treatments`
9. `Refactor architettura web`

## Regola finale
- la web non deve piu essere trattata come shell storica da rifinire a pezzi
- va trattata come `seconda shell dello stesso prodotto desktop`

## Verdetto
- oggi la web e `credibile`
- ma non e ancora `allineata davvero`
- il collo principale non e solo UI
- e `profondita moduli + architettura`
