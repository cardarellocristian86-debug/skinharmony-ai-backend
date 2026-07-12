# Operazioni Smart Desk

Aggiornato: 2026-06-06 - test Assistente virtuale Nyra local-first, cassa/report, AI Gold piani Base/Silver/Gold e routing operativo Gold.

## Runtime

- Locale gestionale: `http://127.0.0.1:3010`.
- Live: `https://skinharmony-smartdesk-live.onrender.com`.
- Desktop: offline-first.

## Test Minimi

- Login.
- Dashboard.
- Agenda.
- Cassa.
- AI Gold.
- Capability/gating piani.
- Base: verificare accesso a report base, cassa/incassi, pagamenti, marketing manuale, magazzino base, turni base e protocolli manuali.
- Silver: verificare preview/upgrade coerente per AI Gold e accesso a redditivita/report evoluti/magazzino-turni evoluti.
- Gold: verificare capability AI operative abilitate solo su Gold/Enterprise e sempre con conferma operatore.
- Protocolli AI: verificare che non risultino attivi su nessun piano.
- Desktop: aprire direttamente una route non inclusa/non abilitata e verificare preview/upgrade card invece di redirect muto alla dashboard.
- Endpoint Fleet se superadmin.
- Suite App Key Bridge status/activate/config/pulse.
- Universal Core Bridge status/decision se configurato.
- WhatsApp Gold preview/send solo con consenso e conferma.
- Safe mode sotto carico.
- Endpoint Gold principali: capabilities, decision-context, decision-center, business-snapshot, state, marketing, profitability, progressive-intelligence.
- Nyra wiring scan: verificare `missing_route_calls=0`, `missing_imports=0`, `missing_script_refs=0`, `unbound_ui_actions=0`, `unbound_ui_action_attributes=0`, `high_or_above=0` sul mirror prima di considerare stabile la preview/live shell.
- Nyra cockpit UX scan: verificare anche `ambiguous_ui_actions=0`. Un bottone `Dettagli` con solo toggle generico non basta: deve aprire pannello/modulo/scroll evidente e avere copy operativo.
- Demo Gold cockpit loading: la vista iniziale non deve dipendere da tutti i deep-dive Gold. Endpoint primari e deep-dive devono avere watchdog/fallback UI, cosi un rallentamento non viene percepito come blocco completo.
- Demo Gold cockpit copy: le CTA devono dire l'azione successiva concreta (`cosa confermare`, `cosa fare ora`, `apri piano`) invece di etichette generiche.
- Core AI/Gold Bridge: verificare che le card in `gold-bridge.js` con `data-gold-route`, `data-enterprise-nav` o `data-enterprise-card-target` aprano un modulo reale anche da tastiera.
- Routing operativo AI Gold: non basta che una card sia collegata; deve aprire il modulo coerente con l'azione. Esempio stabile: `profitability` + `completa costi servizi/operatori` deve aprire `/services`, non `/profitability`.
- AI Gold support mode: misurare sia route statiche sia endpoint profondi. Le route statiche possono essere veloci mentre `decision-context`/deep-dive in support mode restano lenti.
- AI Gold vendita: ogni sezione Cockpit/Decision Center con `items` operativi deve esporre anche `actions` confermabili o CTA chiare. `items>0` con `actions=0` e accettabile solo per evidenze/read-only, non per priorita operative Gold.
- Marketing Autopilot: dopo `generate`, l'endpoint deve mostrare subito le azioni persistite. Gold State valido ma stale non deve nascondere `aiMarketingActions` appena create.
- Gold Onboarding: analyze/confirm con righe `SAFE`, `REVIEW`, `INVALID`.
- Gold State rebuild e Progressive Intelligence recompute.
- Test regressione cassa/report: registrare pagamento con servizio + prodotto, verificare `serviceLines=1`, `productSales=1`, `topProducts>=1`, `paymentMethods>=1`.
- Test gating AI Gold: Gold owner/admin deve ricevere risposta da `/api/ai-gold/ask`; Base e Silver devono ricevere `403 plan_locked`.
- Test redditivita piani: Base deve restare `403 plan_locked`; Silver deve rispondere `200`.
- Test Assistente virtuale Nyra anti-token: `apri agenda` -> provider `local_navigation`; `come aggiungo un cliente?` -> provider `nyra_local`; `cosa include il mio piano?` -> risposta locale differenziata per piano; `scrivimi un messaggio elegante per recuperare una cliente inattiva` -> provider `openai`; `elimina tutti i clienti` -> provider `core_required`; `analizza priorita Gold di oggi` -> provider `gold_decision_required`/Gold context, senza inventare dati.

## Lettura A Blocchi

1. `BLOCK_01_RENDER_RUNTIME_API_PERSISTENCE_MAP.md` - runtime Render/API/persistenza/auth/safe mode.
2. `BLOCK_02_OPERATIONAL_DOMAIN_MODULES_MAP.md` - dominio operativo centro.
3. `BLOCK_03_AI_GOLD_DECISION_FLEET_WHATSAPP_MAP.md` - AI Gold/Fleet/WhatsApp/decisioni.
4. `BLOCK_04_SUITE_CORE_DESKTOP_WEB_DEPLOYMENT_MAP.md` - collegamenti Suite/Core/deploy.
5. `BLOCK_05_GOLD_STATE_DECISION_ENGINE_DEEP_MAP.md` - Gold State/Corelia/capability gating.
6. `BLOCK_06_GOLD_MARKETING_PROFITABILITY_PROTOCOLS_MAP.md` - marketing/redditivita/protocolli.
7. `BLOCK_07_GOLD_ONBOARDING_PIAL_LEARNING_MAP.md` - onboarding/PIAL/learning.
8. `BLOCK_08_FRONTEND_API_GOLD_UI_MAP.md` - API/UI Gold.
9. `BLOCK_09_GOLD_READINESS_TEST_RELEASE_MAP.md` - readiness/test/release.

## Fallback

- Non rompere accessi legacy.
- Non rimuovere moduli dal menu: mostra preview/upgrade card.
- Non alterare pricing senza controllo commerciale.
- Non far eseguire AI Gold se Gold/Core segnalano rischio, bassa confidence o blocked action.
- Non mescolare dati tra centri/tenant.
- Non promettere sync Smart Desk completo se e attivo solo bridge activate/config/pulse.
- Non promettere Protocolli AI, protocolli guidati/adattivi o analisi protocollo AI finche non sono sistemati e testati.
- Non mandare a OpenAI richieste coperte da router locale/Nyra: supporto gestionale, apertura moduli, piano incluso e azioni sicure devono restare zero-token.
- Dopo ogni modifica strutturale aggiornare questa mappa e lanciare Program Registry.
- Dopo ogni modifica Gold aggiornare almeno uno tra blocchi 05-09.
