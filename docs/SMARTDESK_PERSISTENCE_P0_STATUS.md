# Smart Desk Enterprise — stato hardening persistenza P0

## Implementato localmente

- Snapshot PostgreSQL versionati per `tenant_id` e collezione con confronto revisione (CAS).
- Migrazione compatibile dalla tabella legacy, senza cancellare dati legacy.
- Bootstrap PostgreSQL di `gold_imports` incluso.
- Scritture `await` e fail-closed per clienti, pagamenti e chiusure cassa.
- Pagamento con prodotti: transazione PostgreSQL unica per pagamento, movimenti e stock (`BEGIN`/CAS/`COMMIT`); conflitto o errore esegue rollback e ricarica gli snapshot locali.
- `409` per conflitto di revisione; `503` per indisponibilità della persistenza.
- Flag `SMARTDESK_REQUIRE_DURABLE_PERSISTENCE=true`: il processo non parte senza `DATABASE_URL`.

## Non ancora completo

- Le mutazioni non convertite usano ancora il percorso legacy asincrono e possono dare falso successo in caso di errore DB.
- Gold onboarding ora valida clienti, appuntamenti e pagamenti prima di iniziare a scrivere, ma salva ancora record uno alla volta: un errore runtime intermedio richiede recupero idempotente; non è ancora un batch atomico.
- Il tenant è separato per configurazione del servizio; i centri restano isolamento logico dentro uno snapshot comune. L'isolamento fisico per centro richiede normalizzazione per entità.
- Il flag fail-closed è soltanto codice finché non viene configurato nel servizio Render tramite un'azione autorizzata.

## Evidenze locali

```text
npm run test:persistence-p0
npm run test:external-ai-gold
npm run test:semantic-selection
node --check server.js src/DesktopMirrorService.js src/GoldOnboardingEngine.js
```

Tutte le verifiche sopra sono passate nella worktree di hardening. Nessun deploy o cambio Render è stato effettuato.
