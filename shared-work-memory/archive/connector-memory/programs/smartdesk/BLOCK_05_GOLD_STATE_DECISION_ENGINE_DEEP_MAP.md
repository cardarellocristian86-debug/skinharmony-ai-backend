# Smart Desk - Blocco 05 Gold State E Decision Engine

## Scopo

Questo blocco descrive il cuore Gold di Smart Desk: stato incrementale del centro, motore decisionale Corelia, layer temporale, layer enterprise e gating che decide se una priorita puo diventare azione.

## File Principali

- `render-smartdesk-live/src/DesktopMirrorService.js`
- `render-smartdesk-live/src/core/decision/DecisionCore.js`
- `render-smartdesk-live/src/ProgressiveIntelligenceActivationLayer.js`

## Contratto Gold

Gold non e un modulo dati. Gold e il livello che legge i moduli operativi e decide priorita.

Regola stabile:

`Il gestionale dice cosa sta succedendo. AI Gold dice cosa fare.`

Aggiornamento architetturale 2026-05-31:

- Nel prodotto live, l'autorita decisionale primaria Gold deve stare fuori da Smart Desk: `Universal Core Render -> Nyra Render -> eventuale OpenAI refinement`.
- Il `Gold State` dentro Smart Desk resta stato dati incrementale/fallback/evidenza, non deve presentarsi come Universal Core.
- Se il bridge esterno e disponibile, gli endpoint Gold/Silver devono marcare la lettura esterna come primaria e il layer locale come `fallback_only`.
- Se il bridge esterno non e disponibile, Smart Desk puo mostrare fallback prudente, ma deve dirlo chiaramente e non simulare decisione AI premium.

## Gold State

Record principale:

- id: `gold_state:<centerId>`
- versione: `corelia_state_v1`
- componenti: `Rev`, `U`, `Sat`, `Act`, `Cont`, `Ticket`, `Prod`, `DQ`, `CostConf`, `Margin`, `Conf`
- contatori: clienti, appuntamenti, pagamenti, servizi, operatori, stock, costi e contatti
- snapshot: letture aggregate usate dal decision engine
- segnali: eventi compressi per priorita
- decisione: output operativo del centro
- validazione: confronto stato vs dati raw per evitare drift

Funzioni chiave:

- `buildDefaultGoldState`
- `getGoldState`
- `bootstrapGoldStateFromRepositories`
- `rebuildGoldStateForTenant`
- `rebuildGoldStateForCurrentGoldTenant`
- `compareGoldStateToRaw`

## Business Snapshot

Endpoint/funzione centrale:

- funzione: `getBusinessSnapshot`
- endpoint: `/api/business-snapshot`
- piano richiesto: Gold

Produce:

- report operativo
- center health
- marketing
- redditivita
- magazzino
- data quality
- economic reading
- gold engine dashboard
- decision branches

Branch Gold:

- `marketing`
- `agenda`
- `cash`
- `profit`
- `operators`
- `inventory`
- `dashboard`

## Decision Core

File:

- `render-smartdesk-live/src/core/decision/DecisionCore.js`

Versione:

- `decision_core_v1`

Input normalizzato:

- need
- urgency
- value
- baseRisk
- friction
- trend
- maturity
- dataQuality
- reversibility
- ambiguity
- fragility
- pLoss
- potentialLoss
- confidence da redditivita/cassa/data quality

Output:

- `phi`
- `rap`
- `rap2`
- `ev`
- `oc`
- `neu`
- `priorityScore`
- `actionBand`
- `tone`
- `eligible`
- `blockReasons`

Action band:

- `ACT_NOW`
- `SUGGEST`
- `MONITOR`
- `VERIFY`
- `STOP`

Block reasons:

- `NEED_TOO_LOW`
- `CONFIDENCE_TOO_LOW`
- `RISK_TOO_HIGH`
- `DATA_QUALITY_TOO_LOW`
- `PIAL_NOT_READY`
- `CASH_NOT_RELIABLE`
- `PROFITABILITY_NOT_RELIABLE`
- `ACTION_NOT_REVERSIBLE`

## Layer Temporale

Funzioni:

- `persistGoldDecisionHistory`
- `getGoldDecisionHistoryMap`
- `applyGoldTemporalLayer`
- `applyGoldTemporalLayerToItems`

Serve a non reagire solo allo snapshot singolo. Calcola:

- delta phi
- delta RAP
- accelerazione
- volatilita
- confidence temporale
- trend label

Trend label:

- `rising_fast`
- `rising`
- `falling_fast`
- `falling`
- `noisy`
- `recent_unconfirmed`
- `stable`

## Layer Enterprise

Funzioni:

- `applyGoldEnterpriseLayer`
- `applyGoldEnterpriseLayerToItems`
- `recordGoldActionOutcome`
- `getGoldLearningStatsForItem`

Calcola:

- enterprise risk
- risk adjusted priority 2
- expected value
- opportunity cost
- net expected utility
- pSuccess learned
- simulazione migliore azione

Learning:

- metodo: `bayesian_update`
- usa outcomes salvati in `gold_action_outcomes`
- aggiorna la probabilita di successo delle azioni nel tempo

## Capability Layer

Funzioni:

- `getGoldCapabilities`
- `getGoldDecisionContext`
- `canExecuteAction`
- `compactGoldDecisionForSmart`

Regole esecutive:

- piano deve essere Gold
- azione ammessa: `ACT_NOW` o `SUGGEST`
- confidence minima: `0.5`
- rischio massimo: `0.6`
- frizione massima: `0.6`
- conferma operatore sempre richiesta
- PIAL puo bloccare feature non mature

## Universal Core Shadow

Il decision context costruisce anche una lettura `universalCoreShadow`.

Serve per:

- allineare Gold al modello Core
- separare azioni secondarie e bloccate
- promuovere una primary action solo se coerente con safety/rischio/confidence

## Endpoint Gold Corelia

- `/api/ai-gold/capabilities`
- `/api/ai-gold/decision-context`
- `/api/corelia/capabilities`
- `/api/corelia/decision-context`
- `/api/corelia/decision-center`
- `/api/ai-gold/state`
- `/api/ai-gold/state/snapshots`
- `/api/ai-gold/state/signals`
- `/api/ai-gold/state/decision`
- `/api/admin/gold-state/rebuild`

## Regole Di Sicurezza

- Gold non esegue senza conferma operatore.
- Se i dati economici sono incompleti, redditivita e decisioni economiche devono restare prudenti.
- Se PIAL non abilita una feature, l'azione deve restare bloccata o consultiva.
- Se un valore e incoerente, si corregge il modulo fonte, non l'AI.

## Stato Vendibile

Vendibile come:

- decision layer operativo Gold
- priorita giornaliere
- lettura rischio/confidence
- suggerimenti con conferma
- dashboard decisionale

Non vendere ancora come:

- automazione autonoma piena
- previsione garantita
- decisione senza controllo owner/operatore
