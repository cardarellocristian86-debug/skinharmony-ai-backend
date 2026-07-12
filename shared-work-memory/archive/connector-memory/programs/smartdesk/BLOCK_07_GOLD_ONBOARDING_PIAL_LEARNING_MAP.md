# Smart Desk - Blocco 07 Gold Onboarding, PIAL E Learning

## Scopo

Questo blocco descrive come un centro Gold viene alimentato, verificato, attivato progressivamente e migliorato nel tempo.

## File Principali

- `render-smartdesk-live/src/GoldOnboardingEngine.js`
- `render-smartdesk-live/src/ProgressiveIntelligenceActivationLayer.js`
- `render-smartdesk-live/src/DesktopMirrorService.js`

## Gold Onboarding

Endpoint:

- `/api/ai-gold/onboarding/imports`
- `/api/ai-gold/onboarding/analyze`
- `/api/ai-gold/onboarding/confirm`

Formati ammessi:

- `.csv`
- `.xlsx`

Limiti:

- CSV: massimo 8 MB
- XLSX: massimo 4 MB
- macro `.xlsm` bloccate
- formule Excel bloccate

Tipi file dichiarati:

- `customers`
- `appointments`
- `payments`

## Analisi Import

Funzione:

- `analyze`

Passaggi:

1. valida formato, mime, estensione e dimensione
2. decodifica CSV/XLSX
3. rileva tipo reale dagli header
4. confronta tipo dichiarato e tipo rilevato
5. normalizza righe
6. produce snapshot
7. divide righe in `SAFE`, `REVIEW`, `INVALID`
8. riconosce duplicati
9. salva import con hash

Snapshot prodotti:

- `import_customers_snapshot`
- `import_appointments_snapshot`
- `import_payments_snapshot`

## Conferma Import

Funzione:

- `confirm`

Regole:

- righe `SAFE` importabili
- righe `REVIEW` importabili solo se approvate
- righe `INVALID` escluse
- duplicati saltati
- idempotency key per evitare doppi inserimenti
- pagamenti collegati agli appuntamenti se compatibili per cliente/giorno
- ultimo appuntamento aggiorna `lastVisit`

Dopo conferma:

- rebuild Gold State
- ricalcolo PIAL
- salvataggio esito import

## PIAL - Progressive Intelligence Activation Layer

File:

- `render-smartdesk-live/src/ProgressiveIntelligenceActivationLayer.js`

Versione:

- `progressive_intelligence_activation_layer_v2`

Formula generale:

`raw_data -> state_layer -> maturity_layer -> decision_layer -> oracle_layer`

Misure qualita:

- history coverage
- data volume
- cost completeness
- CRM quality
- state stability
- economic reliability

Livelli:

- `L0`: bootstrap / insufficient data
- `L1`: operational basic
- `L2`: operational enriched
- `L3`: economic analytical
- `L4`: strategic optimization
- `L5`: predictive / oracle-ready

## Feature Attivate Progressivamente

Sempre/primi livelli:

- quality alerts
- startup checklist
- daily priorities basic
- basic risk clients

Livello intermedio:

- recall
- continuity signals
- customer frequency insights

Livello economico:

- margin analysis
- operator productivity
- service correction suggestions

Livello strategico:

- strategic optimization
- push/reduce guidance

Livello L5:

- forecast scenarios
- intelligent marketing
- campaign timing

## Oracle / Forecast

PIAL abilita forecast solo con:

- livello minimo L5
- storico sufficiente
- costi completi
- stato stabile
- affidabilita economica sufficiente

Output consentito:

- scenari prudenziali
- intervallo conservativo/centrale/favorevole

Output non consentito:

- previsione puntuale garantita
- promessa di ricavo

## Learning Outcome

Repository:

- `gold_action_outcomes`

Funzione:

- `recordGoldActionOutcome`

Serve a registrare:

- azione proposta
- successo/fallimento
- valore economico
- nota

Il layer enterprise usa questi outcome per:

- `pSuccessLearned`
- aggiornamento bayesiano
- migliore simulazione azione
- priorita meno cieca nel tempo

## Regola Di Attivazione Commerciale

Gold puo essere venduto come intelligenza operativa progressiva.

Va spiegato al cliente che:

- piu dati puliti inserisce, piu Gold diventa utile
- se i dati sono pochi, Gold resta prudente
- bloccare una previsione non e un errore: e protezione

## Cose Da Non Rompere

- Non importare review senza conferma.
- Non accettare file ambigui.
- Non usare formule Excel.
- Non duplicare clienti/pagamenti/appuntamenti.
- Non promuovere L5 se PIAL non lo abilita.

