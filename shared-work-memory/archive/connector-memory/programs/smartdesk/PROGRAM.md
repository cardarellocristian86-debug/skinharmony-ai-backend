# Smart Desk

Aggiornato: 2026-06-06 - Assistente virtuale Nyra con router locale/OpenAI/Core, piu AI Gold owner/admin, cassa/report piani e routing operativo card Gold.

## Cos'e

Smart Desk e il gestionale operativo per centri, saloni e operatori professionali.

## Cosa Fa

- Agenda, clienti, appuntamenti, cassa, incassi.
- Turni, magazzino, servizi, protocolli.
- AI Gold per priorità, marketing, clienti da recuperare, alert redditività e suggerimenti operativi sempre confermati.
- Fleet/God Mode per superadmin.
- WhatsApp Gold con approvazione operatore.
- Trial, login, support mode, piani e tenant.
- Suite App Key Bridge per attivazione/config/pulse.
- Universal Core Bridge per decisioni governate quando configurato.
- Gold State incrementale con Corelia Decision Engine.
- Progressive Intelligence Activation Layer per abilitare feature in base a qualita dati.
- Onboarding Gold con import CSV/XLSX, deduplica e rebuild stato.
- Learning outcome sulle azioni Gold per migliorare priorita nel tempo.
- AI Gold `ask` e disponibile agli owner/admin Gold tramite gating piano, non solo al superadmin.
- Cassa conserva righe servizio e prodotto collegate a magazzino/listino anche da payload `lines`; i report operativi leggono prodotti venduti e metodi pagamento.
- La preview/live shell deve restare collegata: endpoint compatibili, import locali, card/pulsanti `data-action` e card operative con attributi route (`data-gold-route`, `data-enterprise-nav`, `data-enterprise-card-target`, `data-admin-action`) devono passare lo scan Nyra Smart Desk Code Overlay senza missing route/import/script/action high.
- Base e gestionale completo competitivo: dashboard, agenda, clienti, storico, servizi/listino, cassa, pagamenti, marketing manuale, magazzino base serio, turni base, protocolli manuali, report base e impostazioni.
- Silver aggiunge controllo evoluto: redditivita, report evoluti, magazzino/turni evoluti e controlli operativi piu profondi.
- Gold aggiunge AI operativa: priorita giornaliere, marketing suggerito/autopilot approvabile, clienti da recuperare, alert redditivita e suggerimenti confermati.
- Protocolli AI, protocolli guidati/adattivi e analisi protocollo AI restano fuori scope commerciale finche non sono sistemati e testati.
- Assistente virtuale Nyra: primo filtro operativo locale per supporto gestionale, navigazione e azioni sicure; OpenAI viene usato solo per richieste linguistiche/complesse, Core per richieste sensibili e AI Gold/Core per decisioni Gold.

## Per Chi E

- Centri estetici.
- Parrucchieri/saloni.
- Owner/supporto SkinHarmony.
- Brand/franchising quando collegato a Suite.

## Cosa Non Fa

- Non deve inventare dati mancanti.
- Non deve eseguire azioni AI senza conferma.
- Non deve calcolare numeri se il gestionale li ha già.
- Non deve implementare prenotazione online in questo ciclo.
- Non deve assegnare Protocolli AI a Base/Silver/Gold finche non sono sistemati e testati.

## Stato

- Live Render e desktop/web in evoluzione.
- Desktop e sorgente principale; web deve restare allineato.
- 2026-05-30: wiring fix locale sul mirror `/Users/cristiancardarello/skinharmony-ai-backend/smartdesk-live`; scan Nyra dopo fix con high/critical `0`, missing route/import/script/action `0`, poi primo deploy Render del preview wiring.
- 2026-05-30: fix Core AI/Gold Bridge card wiring su Render. `gold-bridge.js` live ora collega card Gold/Core/Enterprise a moduli reali con click+tastiera; commit `df022572bec5aae47b33f37bc742de0612a1e899`, deploy `dep-d8dkj0op7ens73bhl8dg`, health `HTTP 200`, Nyra scan high/critical `0`.
- 2026-05-30: fix `demo_gold_cockpit` Dettagli/azioni ambigue su Render. L'asset attivo `index-Bb4ZEGa9.js` ora trasforma `Dettagli` in `Apri regole Core`, `Mostra dettagli` in `Apri pannello operativo` e fa scroll al pannello operativo. Commit `866406fe44c26bd63f1b4de0a8a6b1541d29cfd0`, deploy `dep-d8dkprg32otc73bmfbt0`, health `HTTP 200`.
- 2026-05-30: hardening `demo_gold_cockpit` loading/copy su Render. L'asset attivo `index-Bb4ZEGa9.js` ora usa watchdog brevi sugli endpoint AI Gold primari/deep-dive e copy operativo piu chiaro (`Vedi cosa confermare`, `Mostra cosa fare ora`, `Apri piano`). Commit `42d5059f7cd1d8b9362a287bb324ab2cf55450b2`, deploy `dep-d8dl07dvmnac73bndsdg`, health `HTTP 200`, bundle live verificato.
- 2026-05-30: fix routing operativo AI Gold/Core su Render. Le card con dominio `profitability` ma azione `completa costi servizi/operatori` non aprono piu Margini: backend espone `target=services` e `targetFocus`, bridge UI rispetta target/copy operativo. Commit `9d98cc3a7f3b6837c313ce5f6f12cc6efdaf6d6e`, deploy `dep-d8dl9s8p7ens73bi17i0`, verifica live superadmin/Privilege e support mode `demo_gold_cockpit` OK.
- 2026-06-06: taratura Assistente virtuale Nyra. Router backend classifica `local_support`, `local_navigation`, `local_safe_action`, `openai_required`, `core_required`, `gold_decision_required`; richieste semplici come `apri agenda`, `come aggiungo un cliente`, `come registro pagamento` e `cosa include il mio piano` non consumano OpenAI.

## Mappa Aggiornabile

- `ARCHITECTURE.md`
- `OPERATIONS.md`
- `USER_MANUAL.md`
- `BLOCK_01_RENDER_RUNTIME_API_PERSISTENCE_MAP.md`
- `BLOCK_02_OPERATIONAL_DOMAIN_MODULES_MAP.md`
- `BLOCK_03_AI_GOLD_DECISION_FLEET_WHATSAPP_MAP.md`
- `BLOCK_04_SUITE_CORE_DESKTOP_WEB_DEPLOYMENT_MAP.md`
- `BLOCK_05_GOLD_STATE_DECISION_ENGINE_DEEP_MAP.md`
- `BLOCK_06_GOLD_MARKETING_PROFITABILITY_PROTOCOLS_MAP.md`
- `BLOCK_07_GOLD_ONBOARDING_PIAL_LEARNING_MAP.md`
- `BLOCK_08_FRONTEND_API_GOLD_UI_MAP.md`
- `BLOCK_09_GOLD_READINESS_TEST_RELEASE_MAP.md`
