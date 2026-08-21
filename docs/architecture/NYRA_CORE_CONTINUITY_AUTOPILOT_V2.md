# Nyra/Core Continuity Autopilot v2

## Obiettivo

Nyra deve far proseguire un intento governato tra chat, Codex e ChatGPT senza
far ripetere all'utente il contesto, senza preflight duplicati e senza
trasformare un errore recuperabile in una catena di richieste manuali.

## Flusso

```
Richiesta → selezione Work → preflight server-side → Nyra coordina → Core decide
                     │                                      │
                     ├─ uno solo: bind automatico            ├─ recuperabile: checkpoint + retry limitato
                     ├─ più di uno: scelta esplicita          ├─ OAuth: reconnect reale + ripresa del Work
                     └─ nessuno: una conferma per creare      └─ rilascio: ticket esatto + readback live
```

## Regole operative

1. Il `work_id` è l'unità di continuità, non la singola chat. Una nuova
   sessione viene collegata automaticamente se esiste un solo Work operativo
   nello stesso tenant e progetto.
2. Il preflight è sempre eseguito dal gateway; il modello non deve invocarlo
   esplicitamente e non deve riscannerizzare memoria o repository.
3. La conferma owner è legata a intento, scope, scadenza e rollback. Nyra non
   chiede una seconda conferma per fasi interne già coperte; Core la richiede
   soltanto per drift, nuova portata o un'azione esterna distinta.
4. Un blocco transitorio diventa un checkpoint con una sola prossima azione.
   Per OAuth questa azione è reconnect; la riconnessione non è prova di merge
   o deploy e non sostituisce ticket, CI o readback.
5. Merge e deploy restano due effetti esterni attestati: ticket Core esatto,
   approvazione host quando richiesta, commit/health/rollback readback.

## Riduzione di chiamate e crediti

- una selezione di Work e un preflight automatico per azione, non un tool-call
  esplicito più una seconda preflight nascosta;
- contesto compatto dal checkpoint e Work Atlas, non prompt/repository completi;
- nessun modello server-side o API key provider;
- retry solo per l'errore classificato e idempotente, mai per una risposta AI
  inconcludente o per un effetto esterno sconosciuto.

## Confini non aggirabili

OAuth scaduto, autorizzazioni GitHub/Render e prompt di approvazione del host
non possono essere simulati o bypassati. L'autopilota riduce il flusso a un
singolo recupero reale e conserva Work, intento, evidenze e prossimo passo.
