# SkinHarmony Program Registry

Questo registro e obbligatorio per ogni programma, plugin, servizio, modulo o layer operativo SkinHarmony.

Scopo: evitare che Suite, Core, traduttore, Smart Desk, connector, nodi e servizi crescano senza una mappa aggiornata.

## Regola

Ogni programma deve avere una cartella con almeno:

- `PROGRAM.md`: cosa e, cosa fa, per chi e, cosa non promette.
- `ARCHITECTURE.md`: dove vive, cosa gira su WordPress, cosa gira su Render/server, cosa resta locale.
- `USER_MANUAL.md`: come lo usa una persona non tecnica.
- `OPERATIONS.md`: installazione, aggiornamento, test, report, fallback, rischi.

Ogni modifica sostanziale deve aggiornare almeno uno di questi file.

## Programmi iniziali

- `suite/`: SkinHarmony Site Suite, CRM, WaaS, network, ecommerce, licenze, template e governance.
- `skinharmony-core/`: plugin SkinHarmony Translation Hub, traduttore, content governance, claim/language autopilot.
- `universal-core/`: Universal Core su Render e Core 2.0 locale per Codex.
- `smartdesk/`: gestionale operativo Smart Desk.
- `core-codex-connector/`: connettore che vincola Codex a Core, snapshot, audit, sessioni e mappe.

## Obbligo per Codex

Se tocchi codice o contenuti collegati a un programma, devi:

1. leggere la cartella programma;
2. aggiornare la mappa/manuale se cambia comportamento, architettura, server, UI, API, workflow o vendita;
3. eseguire `node scripts/program_registry_check.js`;
4. includere nel report finale i file programma aggiornati.

Se manca la mappa, il lavoro non va dichiarato finito.
