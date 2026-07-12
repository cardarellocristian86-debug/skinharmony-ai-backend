# Universal Core API Key Contract Policy

Data: 2026-06-01

## Regola generale
Tutti i software SkinHarmony che usano Universal Core devono lavorare tramite:

- API key scoped;
- tenant / client scope;
- endpoint pubblici stabili;
- contratti API versionati;
- scadenza e revoca chiavi gestite da Universal Core;
- fallback sicuro quando Core non risponde.

Universal Core puo aggiornarsi internamente senza obbligare aggiornamenti dei client.

## Ambito
Questa regola vale per:

- SkinHarmony Suite;
- SkinHarmony Core Translator;
- Smart Desk;
- AI Gold / Nyra client;
- Control Plane Render;
- future app installabili;
- future UI web esterne;
- automazioni Codex autorizzate;
- connettori cliente.

## Principio
Il motore si aggiorna su Universal Core.

I client non devono essere aggiornati a ogni deploy Core se:

- la API key resta valida;
- il contratto pubblico resta compatibile;
- gli endpoint pubblici restano stabili;
- lo schema di risposta resta compatibile;
- le policy diventano uguali o piu restrittive senza rompere il client.

## Quando aggiornare un client
Aggiornare Suite, Translator, Smart Desk o altri client solo quando cambia:

- endpoint pubblico;
- payload richiesto;
- schema risposta letto dalla UI;
- nuova capability da mostrare;
- nuova azione che richiede UI/consenso;
- nuova policy che richiede owner/operator confirmation diversa;
- gestione chiavi/scadenze/tenant scope;
- fallback o messaggio errore da mostrare all'utente.

## API key
Universal Core e responsabile di:

- generare chiavi scoped;
- riconoscere chiavi valide fino a scadenza;
- revocare chiavi compromesse;
- associare chiavi a tenant, prodotto, capability e permessi;
- auditare uso chiave;
- bloccare richieste fuori scope;
- non richiedere reinstall/update client se la chiave resta valida.

I client devono:

- non esporre mai chiavi nel browser;
- inviare chiavi solo server-side;
- mostrare stato chiave in forma mascherata;
- gestire `expired`, `revoked`, `missing_scope`, `rate_limited`;
- non salvare segreti in memoria condivisa.

## Separazione corretta

```text
Client / Plugin / App
-> API key scoped
-> endpoint Universal Core stabile
-> risposta decisionale / traduzione / gate / insight
-> UI mostra output e richiede conferma se serve
```

Universal Core aggiorna:

- modelli;
- policy;
- ranking;
- traduttore;
- gate linguistici;
- branch Nyra;
- decision layer;
- audit/evidence;
- compatibilita API key.

Il client aggiorna solo UI, orchestrazione locale e supporto a nuovi contratti pubblici.

## Anti-pattern vietati

- Copiare motori Core dentro i plugin.
- Aggiornare plugin/client a ogni deploy Core interno.
- Legare un client a una versione interna non pubblica di Core.
- Usare token hardcoded.
- Esporre API key client-side.
- Rompere chiavi valide prima della scadenza senza revoca esplicita.

## Frase guida
Core evolve al centro. I client restano leggeri, compatibili e governati da chiavi scoped.
