# Smart Desk Enterprise — stato hardening persistenza P0

## Implementato localmente

- Snapshot PostgreSQL versionati per `tenant_id` e collezione con confronto revisione (CAS).
- Migrazione compatibile dalla tabella legacy, senza cancellare dati legacy.
- Bootstrap PostgreSQL di `gold_imports` incluso.
- Scritture `await` e fail-closed per clienti, pagamenti e chiusure cassa.
- Pagamento con prodotti: transazione PostgreSQL unica per pagamento, movimenti e stock (`BEGIN`/CAS/`COMMIT`); conflitto o errore esegue rollback e ricarica gli snapshot locali.
- Movimento manuale di magazzino: movimento e giacenza vengono salvati nella stessa transazione snapshot; un errore non lascia movimenti senza aggiornamento stock.
- Appuntamenti: creazione, modifica ed eliminazione attendono la persistenza PostgreSQL prima di invalidare cache agenda e snapshot analitici.
- Conferma Gold onboarding: prevalidazione completa, snapshot in memoria per clienti/appuntamenti/pagamenti/import e un solo commit PostgreSQL. I duplicati nello stesso batch vengono scartati, il retry dopo successo è idempotente e una transazione fallita non modifica gli snapshot locali.
- `409` per conflitto di revisione; `503` per indisponibilità della persistenza.
- Flag `SMARTDESK_REQUIRE_DURABLE_PERSISTENCE=true`: il processo non parte senza `DATABASE_URL`.

## Non ancora completo

- Le mutazioni non convertite usano ancora il percorso legacy asincrono e possono dare falso successo in caso di errore DB.
- L'import Gold non ricostruisce nello stesso commit lo stato derivato Gold/PIAL: lo marca `pending_recompute` per un calcolo separato, evitando che dati derivati non transazionali rendano ambiguo l'esito dell'import.
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
