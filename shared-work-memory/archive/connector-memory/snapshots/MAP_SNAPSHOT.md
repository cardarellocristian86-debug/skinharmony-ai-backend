# MAP_SNAPSHOT

## Ecosistema
- WordPress/SkinHarmony: sito pubblico, pagine, WooCommerce, contenuti marketing.
- Site Suite: nodo WordPress-native per WaaS, CRM B2B, licenze, offerte, template, governance e dashboard marketing/funnel. `Analytics WaaS` e la destinazione UI operativa per Google Funnel Intelligence e Web Analytics proprietaria; `Core Connector / Google Connector` resta configurazione, OAuth, selezione account e stato.
- Site Suite gestisce anche routing operativo leggero del sito: email lead/contatto/supporto/fatturazione/executive e pulsante pubblico WhatsApp assistenza configurabile. Non crea mailbox o alias provider: espone e usa la mappa dentro Suite.
- Suite Control Plane Render: runtime remoto per nodi Suite, evidence/runbook, Google OAuth reale, token tenant, account Ads/GA4 e Funnel Intelligence read-only.
- SkinHarmony Core plugin: traduzione, marketing copy, Claim Guard, Content Governance API.
- Universal Core Render: decision engine, policy, gate, branch/risk/verdict.
- Universal Core 2.0 locale: laboratorio modificabile in `universal-core-2.0` per lavoro Codex/Nyra, con Chat Rich, governance locale, pipeline `Core2/V1/V2/V7`, overlay rami, eventi JSONL redatti e Render/produzione protetti.
- Codex connector: collega assistant/Codex a Universal Core prima di azioni sensibili. Dal `2026-05-30` include anche un sidecar Nyra locale su `work-start`, `checkpoint` e `finalize`: senza cambiare i comandi Codex, aggiorna `universal-core-2.0/runtime/nyra-learning/nyra_codex_work_memory_latest.json` quando `universal-core-2.0` e disponibile, altrimenti resta no-op. Dal `2026-06-05` include `Metodo SkinHarmony` verticale interno tramite `skinharmony-method-check`: registra correzioni ricorrenti di metodo con evidenza e resta fuori dai pacchetti automazioni vendibili.
- Smart Desk: gestionale operativo modulare, AI Gold, Fleet/God Mode, WhatsApp Gold.
- Smart Desk WhatsApp Gold: UI di attivazione assistita salva numero Business e consenso, apre richiesta supporto SkinHarmony e resta in fallback manuale finche provider Meta/Twilio non e configurato su Render.
- Smart Desk WhatsApp Gold supporta anche Twilio proprio del centro: credenziali tenant salvate lato server, token mascherato in UI/API settings, test connessione protetto e invio via API Twilio solo dopo conferma operatore. Provider possibili: Twilio tenant, Twilio piattaforma SkinHarmony, fallback manuale.
- SkinHarmony Visual Engine: motore visuale proprietario local-first, autonomo ma collegabile. Deve parlare con Site Suite/DAM tramite bridge WordPress separato, usare Core come quality gate, esporre stato/anomalie a Nyra, usare il traduttore per alt/title/label/localizzazioni e restare governabile da Codex automation.
- Program Registry: mappa obbligatoria dei programmi in `SHARED_MEMORY/programs/`. Ogni programma deve avere `PROGRAM.md`, `ARCHITECTURE.md`, `USER_MANUAL.md`, `OPERATIONS.md`. Il connector deve bloccare la chiusura se un programma cambia senza aggiornare la sua mappa/manuale.

## Regola moduli enterprise
Ogni modulo SkinHarmony deve poter lavorare da solo e collegarsi agli altri tramite contratti espliciti: status, job, asset, Core verdict, Nyra priority, translator payload e audit. Nessun modulo nuovo deve diventare monolite chiuso o dipendenza strategica da provider esterno.

## Regola Program Registry
Prima di toccare Suite, SkinHarmony Core/traduttore, Universal Core, Smart Desk o Core Codex Connector leggere la cartella `SHARED_MEMORY/programs/<programma>/`.
Se cambia cosa fa, architettura, server/runtime, UI, API, vendita, workflow o manuale, aggiornare la relativa mappa.
Check obbligatorio: `node scripts/program_registry_check.js` o `sh-core-codex program-map-check --file <file>`.

## Regola template
Una nuova pagina/nodo non va creata a mano: va clonata da template approvato e poi adattata.

## Template approvati oggi
- Pagina WaaS: `https://www.skinharmony.it/skinharmony-waas/`
- Offerte WaaS: `https://www.skinharmony.it/offerte-waas/`
- Operating Ecosystem: `https://www.skinharmony.it/skinharmony-operating-ecosystem/`
