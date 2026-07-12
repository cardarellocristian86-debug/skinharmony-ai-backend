# Smart Desk - Blocco 09 Gold Readiness, Test E Release

## Scopo

Questo blocco definisce quando Smart Desk Gold puo essere dichiarato vendibile, cosa testare e cosa resta limite commerciale.

## Test Minimi Gold

Backend/API:

- login centro Gold
- `/api/ai-gold/capabilities`
- `/api/ai-gold/decision-context`
- `/api/ai-gold/decision-center`
- `/api/business-snapshot`
- `/api/ai-gold/state`
- `/api/ai-gold/marketing`
- `/api/ai-gold/profitability`
- `/api/ai-gold/progressive-intelligence`

Onboarding:

- import CSV clienti
- import CSV appuntamenti
- import CSV pagamenti
- righe `SAFE`
- righe `REVIEW`
- righe `INVALID`
- duplicati
- conferma import
- rebuild Gold State
- ricalcolo PIAL

Marketing:

- cliente in routine non deve essere spinto
- cliente a rischio deve essere segnalato
- cliente perso/storico non deve gonfiare top priority
- consenso mancante blocca invio
- telefono/email mancante abbassa contactability

Redditivita:

- servizio sano
- servizio low margin
- servizio loss
- servizio con costi mancanti
- operatore senza costo orario
- pagamento non collegato

WhatsApp:

- status fallback copia
- preview senza invio
- invio solo con consenso e telefono valido
- bulk send prudente
- webhook risposta

UI:

- Gold Bridge renderizza senza overflow
- pulsanti aprono modulo corretto
- azioni bloccate sono spiegate
- capability e PIAL leggibili
- Fleet solo superadmin

## Cosa E Vendibile Ora

Vendibile come:

- Smart Desk Base/Silver/Gold modulare
- Gold come intelligenza operativa sopra i dati
- marketing guidato con approvazione
- redditivita prudente
- onboarding assistito
- decision center con rischio/confidence
- WhatsApp assistito/fallback, non invio autonomo

## Cosa Non Promettere

- AI autonoma che agisce senza conferma.
- Protocolli AI, protocolli guidati/adattivi o analisi protocollo AI finche non sono sistemati e testati.
- Diagnosi mediche.
- Ricavi garantiti.
- Forecast certo.
- Margini perfetti senza costi configurati.
- WhatsApp automatico fuori consenso.
- Enterprise multi-centro pieno se Fleet resta read-only.

## Condizione Gold Commerciale

Gold e vendibile se viene posizionato correttamente:

`Gold non sostituisce il titolare. Prepara il lavoro, ordina le priorita e riduce errori. Il titolare o l'operatore conferma.`

## Checklist Release

- [ ] versione aggiornata in repo/zip
- [ ] deploy Render completato
- [ ] health endpoint OK
- [ ] Postgres attivo se `DATABASE_URL`
- [ ] login e trial OK
- [ ] endpoint Gold principali OK
- [ ] onboarding import testato
- [ ] Gold State rebuild testato
- [ ] PIAL recompute testato
- [ ] WhatsApp fallback o Twilio status chiaro
- [ ] Twilio del centro: token mascherato, test connessione, fallback manuale se errore
- [ ] UI Gold senza overflow
- [ ] report salvato in `reports/`
- [ ] mappa condivisa aggiornata

## Regola Di Aggiornamento Mappa

Ogni modifica a:

- Gold State
- Decision Engine
- Marketing Autopilot
- Redditivita
- Protocolli
- PIAL
- Onboarding
- WhatsApp
- Fleet
- Suite/Core bridge

deve aggiornare questa cartella prima di dichiarare il lavoro chiuso.
