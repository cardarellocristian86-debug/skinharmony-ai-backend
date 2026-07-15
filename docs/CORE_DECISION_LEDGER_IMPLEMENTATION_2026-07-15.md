# Core Decision Ledger

Data: 15 luglio 2026

## Risultato

Il servizio MCP Core/Nyra dispone di un ledger PostgreSQL tenant-scoped che
registra automaticamente ogni lavoro delle AI collegate. La registrazione e
eseguita dal Gateway, non affidata alle istruzioni del modello.

## Dati registrati

- sessione, agente, client, progetto e trace;
- tool richiesto e sintesi redatta;
- preflight e decisione Core;
- stato, rischio, controllo, reason code e versione policy;
- accettazione, correzione, negazione, hard block o conferma;
- errore, outcome verificato e correttezza della previsione;
- hash dell'input, hash dell'evento e hash dell'evento precedente.

Non vengono registrati prompt completi, chain-of-thought, token, password, API
key, immagini Analyzer o risposte integrali.

## Tabelle

- `core_ai_work_sessions`
- `core_decision_events`
- `core_verified_outcomes`
- vista `core_decision_daily_metrics`

`core_decision_events` ha un trigger PostgreSQL che nega UPDATE e DELETE. Un
advisory lock per tenant/lavoro serializza gli eventi concorrenti.

## Enforcement

Con `CORE_DECISION_LEDGER_REQUIRED=true` in produzione, l'assenza di
`DATABASE_URL` impedisce l'avvio. Se il ledger non riesce a creare la sessione,
la chiamata MCP non raggiunge il tool. Per i tool di scrittura, anche il mancato
salvataggio del risultato produce un errore fail-closed.

Il vincolo copre ogni AI che passa attraverso SkinHarmony MCP/Core. Un client
che chiama direttamente sistemi esterni senza attraversare il Gateway resta
tecnicamente fuori dal controllo e deve essere migrato al connettore governato.

## Report

Il tool `decision_ledger_report` espone, per il solo tenant autenticato:

- lavori avviati e completati;
- eventi per tipo;
- tasso di intervento Core;
- tasso di correzione;
- tasso di negazione;
- tasso di conferma;
- accuratezza su outcome verificati;
- dimensione del campione verificato.

L'accuratezza non viene interpretata come prova generale quando il campione di
outcome verificati e zero o troppo piccolo.

## Configurazione Render

```text
DATABASE_URL=<Render PostgreSQL internal URL>
DATABASE_SSL=true
DATABASE_POOL_MAX=5
CORE_DECISION_LEDGER_REQUIRED=true
```

Lo schema viene creato idempotentemente alla prima chiamata MCP dopo il deploy.
Il servizio usa il `DATABASE_URL` PostgreSQL gia configurato; non serve una
migrazione manuale separata.

## Rollback

1. Impostare `CORE_DECISION_LEDGER_REQUIRED=false`.
2. Ripristinare il servizio MCP alla versione precedente.
3. Conservare le tabelle per audit oppure esportarle prima di rimuoverle.

Non eliminare il ledger live senza una decisione separata su retention, privacy
e conservazione delle evidenze.
