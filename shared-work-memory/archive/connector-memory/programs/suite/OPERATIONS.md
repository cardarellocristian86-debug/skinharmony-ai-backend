# Operazioni Suite

## Installazione

- Caricare zip da WordPress > Plugin > Aggiungi nuovo.
- Verificare attivazione plugin.
- Svuotare cache se UI non aggiorna.

## Aggiornamento

- Incrementare versione nel plugin.
- Eseguire test statici/sintassi.
- Generare zip in `dist/`.
- Caricare zip su WordPress.
- Verificare route, menu e pagine principali.

## Test Minimi

- PHP lint dei file modificati.
- Route WordPress esposte.
- Pagine admin apribili: Suite, Control Room, CRM B2B, Price Guard, Product Cards.
- Pulsanti principali collegati.
- Se un bottone o una card comunica un'azione, deve aprire un target reale. Niente CTA ambigue o card che sembrano cliccabili ma non portano a nulla.
- I deep-link interni Suite devono aprire la sezione corretta, evidenziarla e portare il focus sul primo campo utile visibile, non su input hidden o su summary chiusi.
- Nei pannelli finance/read-only come `Payment Settlements`, la regola e la stessa: la tabella puo restare non modificabile, ma deve esporre CTA esplicite verso il modulo sorgente reale (`pagamenti WooCommerce`, `gateway`, `ordine`) quando l operatore deve continuare il lavoro li.
- Nel `CRM Order Ledger` gli errori operativi non si cancellano hard: si archiviano in soft delete con motivo obbligatorio. Ammesso solo per righe `crm_manual` e `b2b_order_bridge`; righe `WooCommerce` si gestiscono dalla sorgente WooCommerce.
- Chiusura corretta del `CRM B2B` multiutente commerciale: non basta avere ruoli diversi. Per dichiarare il CRM pronto a una rete vendita con piu agenti servono anche cockpit per ruolo, limiti amministrativi coerenti e visibilita per agente/portafoglio assegnato. Il campo `assigned_agent` non basta se resta solo descrittivo.
- Nessun errore 500.
- Report scritto in `reports/site-suite` o `SHARED_MEMORY/reports`.
- Dopo ogni modifica Suite eseguire Program Registry:
  - `npm run codex:program-registry -- --file <file-suite> --file SHARED_MEMORY/programs/suite/<mappa-aggiornata>.md`

## Performance Endpoint Diagnostici

- Gli endpoint diagnostici read-only possono usare transient breve quando aggregano molti moduli e non devono riflettere ogni millisecondo di stato live.
- `refresh=1` deve restare riservato agli amministratori.
- Non usare cache per endpoint di scrittura, sync, import, execute, cleanup, pagamenti, stock mutation o automazioni.
- Dal checkpoint `5.3.14`, i fast path read-only coprono anche Network Control, Completion Map, Post Install Validation e AI Control Tower Score, oltre agli snapshot gia ottimizzati.
- Dal checkpoint `5.3.15`, ogni pacchetto installabile deve avanzare con numero progressivo anche quando contiene solo packaging o hardening locale, per evitare zip diversi con la stessa versione.
- Dal checkpoint `5.3.16`, gli endpoint diagnostici GET piu pesanti usano cache read-only da 300 secondi; `Enterprise Closure` ed `Execution Board` hanno fast path dedicato. `refresh=1` resta amministratore-only.
- Dal checkpoint `5.3.36`, `enterprise-core/snapshot`, `completion-map` e `ai-control-tower-score` devono rispondere in fast path read-only di default. I builder profondi restano disponibili solo per admin con `?full=1` o `?refresh=1`, per evitare claim scan, pricing scenarios, CRM graph, remote dashboard e decisioni Core profonde in apertura pagina o scan.
- Dal checkpoint `5.3.37`, le schermate admin leggere (`WaaS Manager`, `Dashboard WaaS` e pattern analoghi) non devono chiamare builder completi prima del `return` della light view. La vista iniziale puo leggere solo snapshot cheap/cacheati e segnali statici; status completi, operating path, lead/order board, claim/pricing scan e bridge profondi vanno costruiti solo nel ramo `full=1`, refresh esplicito o board dedicate.
- La cache/snapshot admin deve restare dietro le quinte nei moduli operativi: `CRM B2B`, `Payment Settlements`, `Value Chain`, `Product Inventory`, `Technology Inventory` devono aprire direttamente nella vista di lavoro, non in una `light view` intermedia. Se serve alleggerire il first paint, si estraggono builder, read-model e sezioni progressive senza cambiare la UX percepita da chi lavora.
- Dal checkpoint locale `5.3.46`, il primo refactor anti-monolite parte da questa regola: rollback della UX `light view` introdotta in `5.3.45`, ripristino baseline `.44` e scomposizione interna del `CRM B2B` in metodi dedicati (`context`, `notices`, `account form`) senza cambiare il comportamento del pannello.
- Dal checkpoint locale `5.3.47`, la scomposizione del `CRM B2B` continua senza cambiare la UX operativa piena: il metodo principale deve delegare progressivamente `legacy registry panel` e `rules panel`. Il pannello ordini/ledger resta fuori da questo refactor finche il gate locale protegge il perimetro `ledger`; non forzare workaround semantici.
- Dal checkpoint locale `5.3.48`, il primo blocco `CRM B2B` multiutente commerciale e chiuso per il ruolo `agent`: `assigned_user_id` diventa assegnazione strutturata compatibile col dato storico `assigned_agent`, il menu Suite dell agente parte dal CRM e si riduce al perimetro commerciale utile, e il filtro portafoglio si applica a contatti, cockpit, email thread, documenti ed export CSV. I form/handler CRM devono negare anche write secondarie (`duplica`, `archivia`, `converti`, `bozza proposta`) se il contatto o la risorsa non appartengono al perimetro visibile dell agente. Restano aperti il contratto completo `finance/support`, le eccezioni `account condivisi/non assegnati` e il test scenario `15 agenti`.
- Dal checkpoint locale `5.3.49`, la matrice `finance/support` e chiusa a livello UI/menu senza toccare la UX piena del CRM: `finance` e `support` entrano comunque in `CRM B2B`, ma con desk dedicato, menu ridotto al perimetro coerente e pannelli role-aware. Regola stabile: se un ruolo non puo davvero salvare, la UI non deve mostrare `Modifica`, `Nuovo ordine`, archiviazioni o form ingannevoli; si lascia la lettura operativa e si aprono i moduli sorgente reali.
- Dal checkpoint locale `5.3.50`, il `CRM B2B` chiude le eccezioni di portafoglio per la rete vendita: ogni contatto usa `portfolio_scope` (`assigned_only`, `shared_agents`, `unassigned_pool`) oltre a `assigned_user_id`, e la stessa policy arriva fino agli ordini assistiti del `CRM Order Ledger`. Regola stabile: account condivisi o nel pool non assegnato devono essere espliciti nel master CRM; le righe ordine mostrano chi le ha create e non possono essere archiviate da un agente fuori perimetro (`scope_locked`).
- Nota lineage `2026-07-01`: le vecchie voci locali `5.3.51` e `5.3.52` su cache governance/board CRM appartenevano alla linea derivata dalla baseline errata `5.3.53` e non sono autoritative dopo il ripristino owner dalla `5.3.48`. Non usarle come riferimento per reinstall, pacchetti o manifest finche non vengono reintrodotte consapevolmente su una baseline corretta.
- La build locale `5.3.51` del `2026-07-01` e da non caricare: conteneva un allowlist prezzi hardcoded in `default_official_prices()`, contrario alla regola Suite agnostica.
- Dal checkpoint locale `5.3.52` reale della linea `5.3.48 -> 5.3.50`, Price Guard monolite deve restare agnostico: niente prezzi ufficiali hardcoded nel codice o nello zip; i prezzi ammessi si configurano solo da opzioni/runtime/import amministrato. La readiness vendita legge `stable_version_matches_current`, `package_url_matches_version` e `package_is_zip`, non chiavi legacy non esposte dal manifest.
- La build locale `5.3.52` del `2026-07-01` non e sufficiente per upload agnostico: rimuoveva il fallback prezzi solo dal monolite, ma lasciava prezzi/listini/prodotti hardcoded in moduli e documenti storici.
- Dal checkpoint locale `5.3.53`, i default distribuibili devono restare senza prezzi, piani/SKU Smart Desk, endpoint Smart Desk live, PEC/domini/chiavi demo SkinHarmony e pricebook WaaS. Prezzi, prodotti, endpoint, pricebook e preset dogfood devono arrivare da opzioni WordPress, import amministrato, filtro o runtime privato esterno allo zip.
- Dal checkpoint locale `5.3.54`, il `Compatibility Contract` deve leggere il bundle sorgenti modulare, non solo il monolite. Il checker deve includere `skinharmony-site-suite.php`, sidecar core e `modules/*/class-module.php`, cosi una route gia migrata nel sidecar non diventa falso negativo. Il payload resta read-only e deve esporre `source_scope=modular_source_bundle`; nessun enforcement runtime o update automatico viene abilitato da questo controllo.
- Dal checkpoint locale `5.3.55`, `Page Quality Audit` distingue blocchi pubblici reali da advisory. Non bocciare pagine manuali storiche per mancanza di metadati Suite: i metadata restano obbligatori solo per pagine generate/gestite dalla Suite. Checkout e pagine transazionali usano soglie dedicate, le bozze non bloccano la readiness pubblica e la meta description puo avere fallback audit da excerpt/contenuto con source tracking. Il payload deve esporre `blocking_failed`, `advisory_items`, `blocks_public_release`, `page_contract`, `failed_checks` e `advisory_checks`.

## Lettura A Blocchi

La mappa Suite va mantenuta a blocchi:

1. `BLOCK_01_BOOTSTRAP_MODULE_MAP.md` - bootstrap, registry, moduli, route core.
2. `BLOCK_02_ADMIN_MENU_CONTROL_ROOM_MAP.md` - admin menu, Control Room, UI shell, mappa visibilità e bridge Core/Render.
3. `BLOCK_03_CRM_B2B_NODE_360_MAP.md` - CRM B2B, account graph leggero, email, documenti, preventivi e Customer/Node 360.
4. `BLOCK_04_VALUE_CHAIN_COMMERCE_MAP.md` - pricing, value chain, Price Guard, Commerce Policy e B2B Order Bridge.
5. `BLOCK_05_TEMPLATE_PAGE_FACTORY_CLONE_MAP.md` - template registry, page factory, package import/export, site clone preview/draft e page quality contract.
6. `BLOCK_06_LICENSE_UPDATE_SMARTDESK_BRIDGE_MAP.md` - licenze, soft gate, WooCommerce fulfillment, update server, Smart Desk Bridge e App Key Factory.
7. `BLOCK_07_CORE_TRANSLATION_CLAIM_CODEX_MAP.md` - Core connector, content/claim guard, traduzioni strutturate, evidence e Codex Automation keys.
8. `BLOCK_08_COMMERCIAL_ANALYTICS_BRAND_DOGFOOD_MAP.md` - vendita WaaS, lead, analytics, DAM, brand governance, reputation, upsell e dogfood sito madre.
9. `BLOCK_09_ACTIVATION_ONBOARDING_GATES_AUTOMATION_MAP.md` - activation pipeline, onboarding, project builder, trial bridge, module gates e daily automation.
10. `BLOCK_10_INVENTORY_WOOCOMMERCE_FULFILLMENT_SETTLEMENT_MAP.md` - magazzino tecnologie/prodotti, WooCommerce bridge, fulfillment, barcode e settlement.
11. `BLOCK_11_AI_NYRA_NETWORK_READINESS_MAP.md` - AI bridge, Nyra advisory, network map, AI Control Tower, Agent Observability, Enterprise Health e V2 readiness.
12. `BLOCK_12_TRACKING_SOCIAL_CARDS_CONVERSION_MAP.md` - Google Ads/eventi reali, attribution aggregata, card tecnologie, social, powered-by, conversion stack e bozze SEO.
13. `BLOCK_13_SECURITY_RELEASE_OWNERSHIP_EXTRACTION_MAP.md` - security hardening, release governance, compatibility contract, ownership moduli ed extraction planner.

## Regole Template / Clone

- Ogni nuova pagina deve partire da template sorgente approvato.
- Le pagine generate/importate devono restare in `draft`.
- Non pubblicare senza Core check su claim, prezzi, traduzioni, publish safety e scope.
- Il catalogo template va creato/salvato/importato da Suite e persistito in WordPress (`shss_suite_template_registry`). Non inserire template cliente o dati SkinHarmony nel codice per “farli comparire”: il codice deve restare motore/fallback.
- Prima di demo cliente servono render desktop/tablet/mobile, no overflow, CTA visibili e conferma owner.
- Dopo ogni clone o correzione pagina aggiornare memoria condivisa/evento/handoff.

## Regole Licenze / Update / Smart Desk

- Le licenze devono restare in soft gate: warning, grace e rinnovo, non spegnimento brutale.
- Per generare licenze da WooCommerce servono dominio, piano, ciclo e prodotto/meta coerenti.
- Le App Key Smart Desk devono rispettare contratto seats mensile/annuale e piano massimo.
- Il config bundle Smart Desk può inviare logo/colori/moduli/policy, ma non deve scrivere automaticamente dati operativi.
- Smart Desk Bridge sincronizza solo in manual sync con owner confirmation, bridge test e Core favorevole.
- Update Server resta manual canary/rollback: niente auto-install aggressivo su clienti.

## Regole Core / Traduzione / Claim / Codex

- Suite deve esporre stringhe atomiche al Core/traduttore, non HTML finale.
- Se manca una traduzione approvata, il render deve cadere sull'italiano.
- Claim Guard locale è fallback di review: blocca la parola/rischio e propone correzione, non deve bloccare tutto il lavoro.
- Se Core remoto non è configurato, `publish_safe` deve restare falso o sconosciuto e serve review.
- `confirm` non è `block`: prepara bozza/report e aspetta owner. Solo `block` ferma.
- Le Codex Automation Keys di Suite servono per il nodo WordPress/Suite; le API key Universal Core si generano da Core Admin.
- Ogni runbook Codex deve dichiarare scope, brand boundary, test, rollback ed evidence prima di proporre modifiche.

## Regole Commerciali / Analytics / Brand

- Il sito SkinHarmony deve restare il primo nodo reale gestito da Suite.
- Le offerte WaaS pubbliche devono leggere il pricebook Suite, non testo hardcoded casuale.
- La Suite resta agnostica: non inserire prezzi, numeri WhatsApp, email, social, domini, project key o preset SkinHarmony nei default del codice o nello zip. Inserirli da WordPress/Suite, import admin o runtime privato. Il listino personale locale è `runtime/private/skinharmony_site_creation_pricebook.json` e non va pacchettizzato.
- Non usare o installare `dist/quarantine-agnostic-data-separation/skinharmony-site-suite-5.2.63-do-not-install.zip`; lo zip pulito corrente è `dist/skinharmony-site-suite.zip` versione `5.2.64`, preparato come pacchetto correttivo agnostico dopo la quarantena `5.2.63`.
- Checkout diretto solo dopo perimetro, privacy, condizioni, dominio e fatturazione confermati.
- Lead sempre salvati; nessun contatto commerciale deve restare solo in pagina o email.
- Email operative sito sempre tracciate nella mappa Suite: lead, contatto, supporto, fatturazione, executive. Suite non crea alias provider: registra destinazioni operative e le rende visibili.
- Pulsante WhatsApp pubblico del sito configurabile da Suite; serve come scorciatoia assistenza e non sostituisce CRM/form.
- Analytics proprietaria resta aggregata e privacy-safe; niente promessa di geografia precisa senza integrazione e privacy policy.
- Event Spine Analytics su Render: WordPress resta collector e fallback locale; quando `suite_runtime_url` e `suite_runtime_api_key` sono configurati, inoltra gli eventi al Control Plane con chiamata server-side non bloccante. Non mettere mai chiavi runtime nel JavaScript pubblico.
- Endpoint Render Analytics: `POST /api/suite/events/ingest` per eventi minimizzati e `GET /api/suite/tenants/:tenantId/events/summary?days=30` per riepilogo tenant. Usare solo dati aggregati/minimizzati: niente IP in chiaro, niente sessione raw, niente payload personale.
- Commerce Snapshot su Render: dal 5.2.89 il sync remoto invia anche `POST /api/suite/commerce/snapshot` con solo conteggi aggregati di CRM, magazzino prodotti, tecnologie, lead, ordini e licenze. Il riepilogo remoto si legge da `GET /api/suite/tenants/:tenantId/commerce/summary`. Non inviare record cliente grezzi, email, telefoni, indirizzi, payload pagamento o movimenti stock irreversibili.
- `Analytics WaaS` deve essere mantenuta come AI Operational Control Plane, non come report grezzo: health score, funnel visuale, badge governance, next controlled moves e page decision queue devono restare leggibili in pochi secondi.
- Ogni azione consigliata da Analytics WaaS deve dichiarare almeno stato/priorità, motivo, azione, verifica e hold; non deve modificare budget, campagne, pagine, form o checkout senza conferma owner.
- Brand Governance e DAM preparano asset/contenuti, ma non fanno push automatico ai partner.
- Reputation prepara risposta/priorità, ma invio e pubblicazione restano manuali.
- Upsell suggerisce bundle e cross-sell, ma non deve promettere risultati né spingere popup/email automatiche.

## Regole Activation / Onboarding / Gates

- Onboarding sotto 70% non deve generare demo come se fosse completa.
- Project Builder può preparare proposal/draft, ma non deve creare siti live senza review.
- Trial Bridge salva richiesta; provisioning Smart Desk live richiede handler autorizzato e verifica.
- Module Gates devono restare soft: preview/upgrade invece di nascondere o bloccare brutalmente.
- Retrofit gate su pagine esistenti deve essere manuale e verificabile.
- Daily Automation va trattata come report/reminder controllato, non come invio automatico cieco.

## Regole Inventory / WooCommerce / Settlement

- WooCommerce Bridge legge e verifica; non deve mutare ordini o gateway dal modulo read-only.
- Ogni movimento stock irreversibile deve avere evento tracciabile.
- Settlement, commissioni e revenue share richiedono contratto e owner confirmation.
- Nessun payout, refund o split automatico finché non esiste policy fiscale/contrattuale.
- Fulfillment prepara stati e prossime azioni; spedizione e pagamento restano operatore/owner controlled.
- Product Inventory oggi vive nel monolite: prima di evolverlo va estratto o mappato con attenzione per non duplicare stock.
- Dal 5.2.91 `Magazzino Prodotti` va trattato come `Master Product Registry`: salva solo dati master prodotto, costo netto/MSRP derivati da IVA, stock, visibilità CRM/B2B/WooCommerce e prezzo pubblico sito governato. Non deve duplicare CRM: filiera, sconti, offerte, prezzo manuale, margini commerciali e owner alert reali restano nel CRM; Redditività calcola il risultato reale post vendita. Nessuna modifica prezzo WooCommerce e nessuno stock vengono pubblicati automaticamente senza conferma owner.
- Regola SSOT tecnologie `2026-06-05`: `Magazzino Tecnologie` è la fonte master unica delle tecnologie. Le nuove tecnologie non devono più essere create nel `Product Registry` come record duplicati `reserved`.
- CRM / Company Cockpit / Order Ledger devono continuare a leggere le tecnologie dal `Technology Registry` anche quando il listino ufficiale non è ancora disponibile; in quel caso la tecnologia resta `registry-first`, quote-only e non vende su WooCommerce.
- WooCommerce per le tecnologie è solo un canale collegabile dal master tecnologia. L'attivazione Woo richiede prezzo ufficiale reale, verifica registry e conferma owner; non crea una seconda anagrafica prodotto.
- Pricing Autopilot tecnologie `5.3.40`: per le tecnologie la Suite deve derivare automaticamente la filiera B2B partendo da `prezzo acquisto` e `prezzo vendita netto all'esercente`. Le tecnologie si fermano all'esercente e non vanno confuse con i prodotti B2C. Il sistema deve calcolare scenari distributore `40/50/60`, usare `50` come default, segnalare quando il margine brand non regge e marcare `factory cost review` quando serve rinegoziare il costo fabbrica o rivedere il prezzo esercente. Le tecnologie estetiche standard usano un riferimento advisory `x3-x5`; i laser restano su profilo separato a ricarico ridotto e non devono essere forzati nello stesso range.
- Playbook duplicati tecnologie `5.3.38`: se il mother site mostra righe `SH-TECH-*` in `Product Registry` ma `technology-inventory` non esiste o risponde `404`, non lanciare migrazioni. Prima installare manualmente la Site Suite `5.3.38`, poi rieseguire `node scripts/audit_suite_technology_registry_duplicates.js`; solo con endpoint `technology-inventory` `200` usare `node scripts/migrate_suite_technology_registry_duplicates.js` per creare le anagrafiche mancanti nel `Technology Registry` e archiviare i duplicati `reserved` dal `Product Registry`.
- Hotfix UI `5.3.39`: le righe `registry-only / price pending` di `Magazzino Tecnologie` devono restare editabili direttamente nella tabella come il `Magazzino Prodotti`. Anche senza link WooCommerce l'operatore deve poter completare nome, listino ufficiale, costo, IVA, stock e ordinazione e salvare tutto nel `Technology Registry`; CRM legge quelle modifiche senza passare da una seconda anagrafica.
- Product Cards registry-first `5.3.41`: `Product Cards` e lo shortcode `[sh_technology_cards]` non devono più essere compilati come catalogo manuale separato. Le card pubbliche devono risolversi automaticamente da `Magazzino Tecnologie` e `Magazzino Prodotti`; il pannello card conserva solo override leggeri di tag, testo, titolo e link quando serve rifinire il marketing. Quando nasce o cambia una tecnologia/prodotto, la card deve comparire in automatico dal registry master. Per le tecnologie il link preferito è la pagina dedicata; per i prodotti il link preferito è il permalink WooCommerce collegato quando esiste. WooCommerce resta un canale opzionale, non la fonte unica delle card pubbliche.

## Regole AI / Network / Readiness

- AI Assistant Bridge non deve essere confuso con Universal Core: è solo wrapper shortcode.
- Nyra interpreta e prioritizza; Core giudica; Suite esegue solo entro policy e conferma.
- Network Map e Network Control Center sono read-only finché ogni nodo remoto non ha API key, consenso, audit e rollback.
- AI Control Tower Score serve a decidere postura operativa, non ad autorizzare automaticamente automazioni rischiose.
- V2 Readiness Gate non deve promuovere major, manifest o estrazioni modulo da solo.

## Regole Tracking / Social / Conversione

- Google Ads può emettere tag e conversioni solo se configurato con ID/label reali.
- Conversioni Ads solo su eventi reali: lead, trial, richiesta WaaS o ordine WooCommerce.
- Non usare Google Ads per creare campagne, budget o label automaticamente.
- Traffic Attribution resta aggregata e privacy-safe: niente IP in chiaro, niente GeoIP/città senza integrazione e policy.
- Product Cards non deve contenere claim medici, prezzi inventati o specifiche tecniche non verificate.
- Social Channels deve mantenere separati canali cliente e canali SkinHarmony.
- Powered By è badge fiducia opzionale, non certificazione legale.
- Le bozze SEO/conversione restano draft finché non passano review claim, prezzi, layout e owner confirmation.
- Audit pagine pubbliche SkinHarmony `2026-06-02`: report read-only in `reports/wordpress/skinharmony_site_orphan_candidates_2026-06-02.md` e artifact `SHARED_WORK/artifacts/skinharmony_site_orphan_pages_audit_2026-06-02.json`. Le pagine non collegate possono sporcare Suite/SEO, ma metterle in bozza è `write_production`: serve selezione Core/owner, verificando prima pagine utility, pagamento, account, legali e commerciali da collegare.

## Regole Security / Release / Estrazione

- Security Hardening resta read-only finché non esiste policy enterprise completa: niente lockdown automatico, niente cambio ruoli, niente blocco REST cieco.
- Release Governance richiede canary manuale, package zip, stable allineata, rollback pronto e check admin/HTTP.
- Non distribuire se Enterprise Health segnala critical/high aperti su release, manifest, debug, bridge o guardrail.
- Compatibility Contract protegge shortcode pubblici e namespace `shss/v1`: aggiungere alias prima di rinominare.
- Compatibility Contract deve cercare marker REST/shortcode nel bundle sorgenti modulare. Non aggiungere marker finti nel monolite per far passare il test: se il runtime e nel sidecar o in un modulo, il checker deve leggere quella sorgente.
- Extraction Planner va seguito in ordine: shortcode renderer, repository read-only, admin views, REST aliases, WooCommerce hooks.
- WooCommerce hooks, trial submit, smartdesk auto sync, update stable channel e public shortcode names sono zone ad alto rischio: non toccarle in refactor generici.
- Ogni estrazione deve essere un blocco piccolo, uno zip, un test WordPress reale, un rollback dichiarato.

## Runtime

- WordPress: plugin live.
- Render: eventuale update server/Core/Smart Desk.
- Locale: sviluppo e packaging.
- Product Registry API: da `5.2.92` l'inserimento prodotti master puo passare da `POST /wp-json/shss/v1/waas-manager/product-inventory/upsert` con `X-SkinHarmony-Codex-Key` o owner auth. L'endpoint salva dati runtime WordPress, non prodotti hardcoded nel plugin, non pubblica prezzi WooCommerce e non scala stock. Dopo installazione manuale 5.2.92 usare `scripts/upsert_suite_product_inventory_pilot.js` per testare prodotto pilota e lettura CRM/B2B.

## Fallback

- Usare backup zip precedente.
- Ripristinare file da backup report.
- Non cancellare dati cliente senza export.
