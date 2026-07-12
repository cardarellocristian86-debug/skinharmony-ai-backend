# Smart Desk Gold + Core Spec - 2026-05-17

## Formula guida
`Il gestionale dice cosa sta succedendo. AI Gold dice cosa fare.`

## Obiettivo
Definire con chiarezza cosa deve essere `Smart Desk Gold` quando e collegato a `Universal Core`.

Gold non e:
- un chatbot generico
- un calcolatore autonomo dei numeri
- un executor automatico

Gold e:
- un `assistente operativo premium`
- sopra i dati reali del centro
- governato dal `Core`

## Ruoli corretti

### Gestionale / dati
Fonte unica di verita per:
- clienti
- appuntamenti
- agenda
- pagamenti
- servizi
- magazzino
- turni
- protocolli
- storico
- costi e ricavi quando esistono

Regola:
- se un numero e sbagliato, si corregge il modulo dati
- non l AI

### Universal Core
Ruolo:
- leggere segnali strutturati
- valutare rischio
- valutare priorita
- valutare confidence
- decidere stato operativo
- fornire azione primaria / secondaria / bloccata

Nel contesto Smart Desk:
- `Universal Core` e il `motore decisionale read-only`
- non scrive i dati del gestionale

### AI Gold
Ruolo:
- leggere output del gestionale e del Core
- tradurli in priorita operative
- spiegare il perche
- proporre cosa fare adesso
- aprire il flusso corretto
- mai eseguire da sola azioni sensibili

## Stato tecnico attuale

### GoldStateService
Riferimento:
- `services/api-server/src/services/GoldStateService.js`

Fa:
- legge store reali Smart Desk
- costruisce componenti e contatori
- costruisce snapshot:
  - `business`
  - `profitability`
  - `report`
- produce:
  - segnali
  - anomalie
  - decisione
  - stabilita temporale decisione

Espone gia naming coerente:
- `source: universal_core_runtime`
- `engineName: Universal Core`
- `runtimeStack: UniversalCoreAdapter / V0 / V2 / V7`

### AssistantService
Riferimento:
- `services/api-server/src/services/AssistantService.js`

Fa:
- costruisce contesto operativo
- legge settings/dashboard/clienti/staff
- integra `goldContext`
- gestisce capability e ruolo
- blocca azioni non consentite
- propone solo azioni compatibili

### Gold Decision Context
Smart Desk legge gia un contesto decisionale sopra i moduli.

Significa:
- Gold non deve inventare la priorita
- la deve ricevere e interpretare

## Cosa deve fare Smart Desk Gold

### 1. Priorita giornaliera
Deve dire:
- cosa fare prima
- perche
- con che urgenza
- con che confidenza

Esempi:
- clienti da richiamare
- pagamenti da collegare
- stock da verificare
- margine da ricontrollare
- agenda troppo vuota o troppo compressa

### 2. Azione confermabile
Deve portare l operatore nel posto giusto:
- agenda
- clienti
- cassa
- magazzino
- marketing
- redditivita
- protocolli

Regola:
- suggerisce
- apre il flusso
- l operatore conferma

### 3. Lettura salute centro
Deve partire da:
- fatturato totale
- fatturato per operatore
- saturazione agenda
- continuita clienti

Non deve dichiarare sano un centro solo per margini o prodotti.

### 4. Marketing Gold
Deve usare:
- anagrafica clienti
- ultima visita
- frequenza
- servizi
- acquisti
- consenso marketing
- note

Produce:
- da richiamare
- a rischio
- perso
- storico
- messaggio suggerito
- priorita

### 5. Redditivita Gold
Deve usare:
- incassi reali
- servizi
- costi
- operatori
- tecnologie
- prodotti
- sconti
- trend mensile

Produce:
- servizi critici
- alert perdita
- margini da verificare
- suggerimenti di controllo

### 6. Protocolli Gold
Deve usare:
- scheda cliente
- storico trattamenti
- tecnologie
- prodotti
- note operatore

Produce:
- proposta protocollo
- prossimo step
- note da confermare

## Cosa non deve fare
- non correggere pagamenti
- non correggere costi
- non correggere margini
- non inventare dati mancanti
- non inviare marketing in automatico
- non cambiare piano/moduli
- non fare azioni irreversibili

## Gating
Gold deve essere visibile e coerente col piano.

### Base
- niente AI Gold decisionale piena
- solo uso manuale moduli base

### Silver
- lettura migliore del centro
- protocolli AI limitati
- niente piena stanza operativa Gold

### Gold
- stanza AI Gold vera
- priorita operative
- coda marketing da approvare
- margini da correggere
- segnali cross-modulo

## Collegamento con Core
La direzione giusta e:
- `Smart Desk` legge dati
- `Universal Core` decide
- `Gold` interpreta

Quindi:
- niente duplicazione di logiche decisionali dentro Smart Desk
- niente AI autonoma scollegata dal Core

## API/contratto da preservare
Smart Desk deve continuare a leggere:
- capabilities
- decision context
- risk
- confidence
- primary action
- secondary actions
- blocked actions

## Differenza tra shell e motore
### Web / Desktop
Sono shell del prodotto.

### Gold + Core
Sono il motore decisionale sopra il prodotto.

Regola:
- le shell possono differire un po nella presentazione
- non devono divergere nella logica Gold/Core

## Verdetto finale
Smart Desk Gold collegato al Core deve essere:
- `responsabile operativo digitale`
- non `chatbot`
- non `autopilota cieco`

Deve:
- leggere
- ordinare
- spiegare
- guidare
- chiedere conferma

Non deve:
- inventare
- correggere dati
- eseguire senza permesso
