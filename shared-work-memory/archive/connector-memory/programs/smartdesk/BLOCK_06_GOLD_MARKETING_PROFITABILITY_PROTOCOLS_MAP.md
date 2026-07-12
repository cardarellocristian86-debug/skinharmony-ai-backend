# Smart Desk - Blocco 06 Gold Marketing, Redditivita E Protocolli

## Scopo

Questo blocco mappa le funzioni Gold che trasformano i dati operativi in lavoro quotidiano: marketing clienti, redditivita, protocolli e decisioni operative.

## File Principali

- `render-smartdesk-live/src/DesktopMirrorService.js`
- `render-smartdesk-live/src/core/marketing/MarketingCore.js`
- `render-smartdesk-live/src/core/profitability/ProfitabilityCore.js`
- `render-smartdesk-live/src/core/cash/CashCore.js`
- `render-smartdesk-live/src/core/data-quality/DataQualityCore.js`

## Marketing Gold

Endpoint:

- `/api/ai-gold/marketing`
- `/api/ai-gold/marketing/autopilot`
- `/api/ai-gold/marketing/autopilot/generate`
- `/api/ai-gold/marketing/autopilot/:id/status`

Funzioni:

- `getAiGoldMarketing`
- `getAiGoldMarketingSnapshot`
- `getAiMarketingAutopilot`
- `generateAiMarketingAutopilotActions`

Il marketing legge:

- anagrafica clienti
- appuntamenti
- pagamenti
- servizi
- ultimo contatto
- storico marketing
- consensi
- valore cliente
- frequenza/routine
- rischio churn
- pressione spam
- qualita contatto

Classificazioni operative:

- recupero soft
- recupero attivo
- mantenimento
- promemoria naturale
- perso
- storico inattivo
- in routine
- evitare contatto

Regola importante:

Persi e storico non devono gonfiare le priorita quotidiane. La dashboard alta conta solo contatti realmente lavorabili.

## Marketing Core

File:

- `render-smartdesk-live/src/core/marketing/MarketingCore.js`

Versione:

- `marketing_core_v1`

Calcola:

- customer value
- churn risk
- habit/routine
- timing
- contactability
- spam pressure
- goal fit
- data quality
- opportunity
- readiness

Vincoli:

- non invia messaggi
- non persiste invii da solo
- ordina e suggerisce
- richiede consenso e canale valido

## WhatsApp Gold

Endpoint:

- `/api/ai-gold/whatsapp/status`
- `/api/ai-gold/whatsapp/test-twilio`
- `/api/ai-gold/whatsapp/preview`
- `/api/ai-gold/whatsapp/send`
- `/api/ai-gold/whatsapp/bulk-send`
- `/api/integrations/twilio/whatsapp-webhook`

Regole:

- solo Gold
- consenso obbligatorio
- telefono valido obbligatorio
- confidence minima
- rischio e frizione sotto soglia
- niente contatto troppo recente
- limite tentativi
- operatore conferma sempre
- fallback copia se Twilio non configurato o rifiutato
- Twilio del centro supportato tramite Account SID, Auth Token e sender `whatsapp:+...`
- Auth Token salvato lato server e mascherato nelle settings pubbliche

## Redditivita Gold

Endpoint:

- `/api/ai-gold/profitability`

Funzioni:

- `getAiGoldProfitability`
- `getAiGoldProfitabilityLive`
- `buildAiGoldProfitabilityFromOverview`
- `getProfitabilityOverview`
- `buildProfitabilityOverviewFromGoldState`

La redditivita legge:

- servizi
- appuntamenti
- pagamenti collegati
- durata reale o stimata
- costo orario operatore
- prodotti usati
- tecnologie usate
- sconti
- costi configurati
- revenue e margine

Output:

- servizi sani
- servizi a basso margine
- servizi in perdita
- configurazione economica incompleta
- alert
- suggerimenti
- trend mensile

Confidence economica:

- `REAL`
- `STANDARD`
- `ESTIMATED`
- `INCOMPLETE`

Regola:

Se mancano costi servizio o costi orari operatori, Gold non deve far credere che la redditivita sia affidabile. Deve mostrare configurazione incompleta e chiedere correzione dei dati.

## Protocolli Manuali E Backlog AI

Endpoint/backlog:

- `/api/ai-gold/protocols/draft` resta fuori scope commerciale finche non e sistemato e testato

Il flusso protocolli manuale deve restare:

- raccolta dati cliente
- area/zona/esigenza
- sensibilita
- tecnologie attive
- obiettivo seduta
- proposta di seduta
- verifiche
- comunicazione cliente
- limiti
- conferma operatore

Regola:

I protocolli AI, i protocolli guidati/adattivi e l'analisi protocollo AI non sono assegnati a Base/Silver/Gold in questa fase. Quando verranno riaperti, non dovranno mai essere diagnosi medica: saranno bozze operative da confermare.

## Cassa E Data Quality

Gold dipende da:

- `CashCore`
- `DataQualityCore`
- pagamenti collegati
- appuntamenti senza pagamento
- clienti senza contatto
- duplicati
- servizi senza costi
- operatori senza costo orario

Se la qualita dati e bassa:

- AI Gold abbassa confidence
- blocca letture economiche forti
- promuove azione di pulizia dati

## Manuale Operativo Gold

Uso corretto:

1. Aprire dashboard/AI Gold.
2. Leggere la priorita principale.
3. Controllare confidence, rischio e motivazione.
4. Aprire modulo collegato.
5. Correggere dati se Gold segnala bassa qualita.
6. Approvare manualmente marketing/WhatsApp/protocollo.
7. Registrare outcome quando l'azione produce risultato.

## Stato Vendibile

Vendibile:

- marketing guidato
- recall clienti
- redditivita prudente
- azioni da approvare
- learning su outcome

Da non promettere:

- invio automatico senza approvazione
- protocolli AI, protocolli guidati/adattivi o analisi protocollo AI finche non sono sistemati e testati
- diagnosi mediche
- margini certi se i costi non sono configurati
- previsione rigida di ricavo
