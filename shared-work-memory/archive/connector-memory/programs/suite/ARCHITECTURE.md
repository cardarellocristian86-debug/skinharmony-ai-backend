# Architettura Suite

## Dove Vive

- WordPress: plugin `wordpress/plugins/skinharmony-site-suite`.
- Pacchetti: `dist/skinharmony-site-suite*.zip`.
- Report/test: `reports/site-suite`, `reports/wordpress`, `SHARED_MEMORY/reports`.
- Server esterni: Render per update server, Core, Smart Desk bridge, Google OAuth/letture, runtime dedicato, Event Spine Analytics e Commerce Snapshot aggregato quando configurati.

## Componenti

- UI admin WordPress: Control Room, CRM B2B, Price Guard, Product Cards, Trial Bridge, Automazioni, update/licenze.
- REST endpoints: Suite, CRM, Price Guard, bridge e update.
- Storage: WordPress options/post/meta/custom data dove presente; Render conserva riepiloghi/eventi minimizzati tenant-scoped per Analytics WaaS e snapshot aggregati commerce/CRM/magazzino quando il runtime è configurato.
- Core bridge: invio snapshot, decisioni, traduzioni e policy verso Universal Core/SkinHarmony Core.
- Ecommerce: WooCommerce per prodotti, ordini, checkout, licenze e pacchetti.
- Framework sidecar: `core/` con bootstrap, loader, security, health, registry moduli, soft gate licenze e snapshot Core.
- Moduli: `modules/<slug>/class-module.php`, caricati dal registry quando esistono.
- Monolite legacy: `skinharmony-site-suite.php`, ancora responsabile di molte UI, REST route, handler e logiche operative.

## Flussi

1. Owner configura piani, moduli, listini, nodi e chiavi.
2. Cliente/brand/distributore usa CRM, ordini, offerte, template o licenze.
3. Suite manda snapshot a Core quando serve decisione/governance.
4. Suite mostra stato, rischio, next action, audit e report.

## Confini

- Suite raccoglie, mostra e orchestra lato WordPress.
- Analytics WaaS raccoglie localmente eventi privacy-safe e può inoltrarli server-side a Render; il browser non riceve mai la chiave runtime.
- Commerce Snapshot è aggregato: CRM, magazzino, tecnologie, lead, ordini e licenze vengono inviati a Render come riepilogo tenant-scoped, senza record cliente grezzi, pagamento automatico o modifica stock.
- Universal Core decide policy/rischio/guardrail quando collegato.
- SkinHarmony Core gestisce traduzione, scrittura, claim/language autopilot.
- Smart Desk esegue operatività del centro.
- Azioni critiche richiedono conferma owner.
- Il codice Suite deve restare agnostico: listini, contatti, canali social, project key, powered-by, URL cliente e preset SkinHarmony/dogfood sono dati tenant e devono arrivare da opzioni WordPress/Suite, import admin o runtime privato, non dai default dello zip.
- Template e cataloghi non sono release software: il registry attivo deve vivere in WordPress/Suite (`shss_suite_template_registry`) e il file nel plugin deve essere solo fallback. Gli aggiornamenti correggono il motore, non devono cancellare template creati o importati dal pannello.

## Su Server / Non Su Server

- Su WordPress: UI, dati plugin, pagine, WooCommerce, CRM leggero, magazzino operativo e aggregati analytics locali.
- Su Render: update server, Core centrale, Smart Desk live, Google connector, Event Spine Analytics, Commerce Snapshot aggregato e eventuale runtime dedicato.
- Locale: sviluppo, zip, report, test e Core 2.0 per Codex.

## Stato Architetturale Verificato - Blocco 01

Mappa dettagliata:

- `SHARED_MEMORY/programs/suite/BLOCK_01_BOOTSTRAP_MODULE_MAP.md`

Verità attuale:

- Suite e versione `5.2.37`.
- Il registry modulare esiste e prova a caricare tutti i moduli fisici.
- Il framework sidecar espone route read-only di stato/snapshot/rest-map.
- Il monolite resta ancora centrale per molte funzioni operative.
- Ogni blocco successivo deve distinguere `modulare reale`, `read-only metadata` e `legacy monolith`.

## Stato Architetturale Verificato - Blocco 02

Mappa dettagliata:

- `SHARED_MEMORY/programs/suite/BLOCK_02_ADMIN_MENU_CONTROL_ROOM_MAP.md`

Verità attuale:

- Il menu padre `SkinHarmony Suite` apre direttamente la Control Room, non una dashboard neutra.
- La Control Room è la regia enterprise: legge, collega e orienta, ma non esegue azioni sensibili.
- La vista default è leggera; le board profonde si aprono singolarmente da pannelli/endpoint dedicati. La UI operativa non deve proporre render massivi completi.
- La mappa visibilità preserva tutti i moduli senza renderizzarli tutti subito.
- UI shell e JS admin intercettano target mancanti, copy action, righe card e media picker.
- Il bridge Core/Render/Smart Desk/Codex è già rappresentato come contratto read-only e separabile.

## Stato Architetturale Verificato - Blocco 03

Mappa dettagliata:

- `SHARED_MEMORY/programs/suite/BLOCK_03_CRM_B2B_NODE_360_MAP.md`

Verità attuale:

- Il modulo fisico `crm-b2b` è ancora metadata/health; la logica reale vive nel monolite.
- Il CRM B2B è operativo come rete commerciale leggera: account, ruoli filiera, listini, sconti, pipeline, documenti, email e preventivi.
- Le azioni amministrative reali includono crea/modifica, duplica, elimina, conversione lead, proposta/preventivo, export CSV, thread email e documenti.
- Customer/Node 360 aggrega CRM, lead, inventario, settlement, licenze e Smart Desk in profili read-only.
- Il CRM prepara snapshot e next action, ma non deve creare ordini, inviare marketing, cambiare stock o forzare prezzi senza conferma owner/Core.

## Stato Architetturale Verificato - Blocco 04

Mappa dettagliata:

- `SHARED_MEMORY/programs/suite/BLOCK_04_VALUE_CHAIN_COMMERCE_MAP.md`

Verità attuale:

- `ValueChainPricingEngine.php` è un motore reale separato: calcola costo, listino, sconti, margini, dose cost, rischio, alert e policy sicura.
- Price Guard è operativo come scanner pubblico read-only su importi in euro e listino ufficiale.
- B2B Order Bridge crea richieste interne e legge catalogo/stock, ma non evade ordini, non scala stock e non incassa.
- Commerce Policy distingue pagamento completo, acconto/saldo, preventivo, disponibilità, B2B riservato, autorizzazione e non vendibile.
- Price List Engine è ancora structure/health: manca il motore unico per listini, contratti, bundle e offerte riservate.

## Stato Architetturale Verificato - Blocco 05

Mappa dettagliata:

- `SHARED_MEMORY/programs/suite/BLOCK_05_TEMPLATE_PAGE_FACTORY_CLONE_MAP.md`

Verità attuale:

- Il registry template locale esiste ed è la fonte strutturata di template, componenti, token, CTA e policy publish.
- Il modulo `waas-templates` è reale per shortcode e REST read-only del catalogo, ma generate/package/import restano nel monolite.
- Il modulo `template-design-system` è un contratto read-only: non cambia tema, non sovrascrive CSS e non pubblica.
- La Page Factory crea pagine solo in bozza, salva metadata Suite e attacca il contratto qualità.
- Il Site Clone Engine gestisce intake, preview e draft, ma non è scraping/clonazione automatica completa di siti esterni.
- Template Clone Validation richiede Core check, render desktop/mobile, no overflow, CTA check, conferma owner e memoria condivisa prima di demo/publish.

## Stato Architetturale Verificato - Blocco 06

Mappa dettagliata:

- `SHARED_MEMORY/programs/suite/BLOCK_06_LICENSE_UPDATE_SMARTDESK_BRIDGE_MAP.md`

Verità attuale:

- Le licenze WaaS funzionano con registry, verifica soft, grace period e nessun hard block brutale.
- WooCommerce può creare/rinnovare licenze e generare App Key Smart Desk quando prodotto/meta/dominio sono corretti.
- Update Server espone manifest, firma/checksum policy, checker cliente e governance canary/rollback, ma non installa automaticamente.
- Smart Desk Bridge prepara payload minimizzati e può fare sync manuale solo con owner confirmation, configurazione, test e Core favorevole.
- Smart Desk App Key Factory è reale: gestisce seat limit mensili/annuali, piani, branding, infra standard/dedicata, config bundle, activation e pulse aggregati.

## Stato Architetturale Verificato - Blocco 07

Mappa dettagliata:

- `SHARED_MEMORY/programs/suite/BLOCK_07_CORE_TRANSLATION_CLAIM_CODEX_MAP.md`

Verità attuale:

- Core Connector è il contratto di governo tra Suite e SkinHarmony Core/Universal Core: Suite raccoglie e mostra, Core decide.
- Il runtime operativo del connector, Content Guard, action gate ed evidence vive ancora nel monolite; il modulo fisico è metadata/read-only.
- Claim Guard locale è uno scanner fallback review-required: non modifica, non pubblica e non sostituisce il giudizio semantico Core.
- Le traduzioni strutturate sono atomiche: Suite espone stringhe/key_path/source_hash e renderizza via lookup Core/memoria con fallback italiano.
- Codex Automation Keys sono chiavi scoped del nodo Suite, non chiavi provider Universal Core; servono per runbook assistiti, draft, setup e letture senza accesso admin generico.
- Azioni sensibili restano owner-confirmed: publish, prezzi, pagamenti, hard block, sync esterni e cancellazioni distruttive.

## Stato Architetturale Verificato - Blocco 08

Mappa dettagliata:

- `SHARED_MEMORY/programs/suite/BLOCK_08_COMMERCIAL_ANALYTICS_BRAND_DOGFOOD_MAP.md`

Verità attuale:

- Suite contiene già il percorso commerciale WaaS: offerte pubbliche, listino interno, proposte, pagine contratto, checkout quote-first e readiness vendibilità.
- Lead Intelligence è reale: shortcode, salvataggio contatti, stati lead e REST con email mascherata/hash.
- Analytics è aggregata e privacy-safe: traffico, lead, UTM, referrer, ordini tecnologia, ma niente GeoIP preciso. Dal blocco 5.2.75 gli eventi sito possono essere inoltrati server-side al Suite Control Plane Render come Event Spine tenant-scoped, senza IP o sessione raw.
- Brand Governance e DAM preparano contenuti e asset centrali, ma non fanno push automatico né overwrite partner.
- Reputation e Upsell sono manual-governed: preparano priorità, risposte e proposte, ma non pubblicano, non inviano e non cambiano checkout.
- Il dogfood del sito madre è misurato: SkinHarmony deve usare Suite come primo nodo reale prima di presentarla come prodotto vendibile.

## Stato Architetturale Verificato - Blocco 09

Mappa dettagliata:

- `SHARED_MEMORY/programs/suite/BLOCK_09_ACTIVATION_ONBOARDING_GATES_AUTOMATION_MAP.md`

Verità attuale:

- WaaS Engine misura readiness del nodo locale e mostra una dashboard multi-sito preview dal registro licenze, ma non sincronizza metriche remote.
- Onboarding raccoglie dati cliente e consiglia template; è pronto per generazione bozze solo sopra 70%, senza publish o checkout automatici.
- Project Builder valuta progetti, stage e queue; può arrivare a proposal_ready/draft_ready, ma non crea siti o template da solo nel modulo.
- Trial Bridge è un form Smart Desk collegato al salvataggio lead, non provisioning live garantito.
- Module Gates sono soft gate: moduli visibili, preview/upgrade, no hard block brutale.
- Daily Automation espone stato cron/report/reminder, ma il modulo fisico è read-only e non invia o scrive report autonomamente.

## Stato Architetturale Verificato - Blocco 10

Mappa dettagliata:

- `SHARED_MEMORY/programs/suite/BLOCK_10_INVENTORY_WOOCOMMERCE_FULFILLMENT_SETTLEMENT_MAP.md`

Verità attuale:

- Technology Inventory legge prodotti WooCommerce per Skin Pro, Termosauna e O3 System con stock/disponibilità.
- Dal `2026-06-05` il `Technology Registry` è SSOT anche per tecnologie nuove senza listino ufficiale: possono esistere in modalità `registry-first` / quote-only senza essere duplicate nel `Product Registry`.
- Product Inventory esiste nel monolite e alimenta anche il B2B Order Bridge, ma non è ancora modulo fisico separato.
- Il `Product Registry` resta confinato ai prodotti reali; WooCommerce per le tecnologie va trattato come canale collegabile dal master tecnologia, non come seconda anagrafica.
- Warehouse/Barcode e Fulfillment Control sono contratti structure-ready, non runtime completi.
- WooCommerce Bridge legge gateway, ordini, prodotti abbonamento e hook legacy, ma il modulo resta read-only.
- Payment Settlements prepara righe di review manuale su ordini tecnologia, senza split, payout, refund o revenue share automatici.
- Commerce Control Room è cockpit read-only: vede commerce e prossime azioni, non diventa payment engine.

## Stato Architetturale Verificato - Blocco 11

Mappa dettagliata:

- `SHARED_MEMORY/programs/suite/BLOCK_11_AI_NYRA_NETWORK_READINESS_MAP.md`

Verità attuale:

- AI Assistant Bridge è un wrapper shortcode verso AI Engine, non motore decisionale interno.
- Suite Control Plane preferisce gli endpoint Universal Core moderni (`/v1/adapters/site-suite/gateway` e `/v1/action-evaluator`) e mantiene fallback legacy (`/v1/nira/core-bridge`, `/v1/action-mediation/evaluate`) solo per compatibilità durante il riallineamento Render/repo.
- Nyra Commercial Intelligence è advisory/read-only: aggrega segnali reali e rende leggibile la priorità business, ma non esegue azioni.
- Client Network Dashboard e Network Control Center mostrano rete/licenze/nodi, ma non fanno sync remoto, login cliente, update push o data pull automatici.
- AI Control Tower Score e Agent Action Observability sono pannelli di governo: score, evidence, conferme, blocchi e rollback dichiarati.
- Enterprise Health controlla readiness, update, claim, prezzi, bridge, social e debug.
- V2 Readiness Gate misura se aprire una major controllata, senza promozione automatica o estrazione distruttiva del monolite.

## Stato Architetturale Verificato - Blocco 12

Mappa dettagliata:

- `SHARED_MEMORY/programs/suite/BLOCK_12_TRACKING_SOCIAL_CARDS_CONVERSION_MAP.md`

Verità attuale:

- Google Ads è governance conversioni/eventi reali: tag globale, label lead/trial/WaaS/purchase e deduplica browser, ma nessuna campagna o budget automatico.
- Traffic Attribution salva solo aggregati privacy-safe: path, referrer, UTM, lingua/timezone e paese stimato.
- Product/Technology Cards alimenta shortcode pubblico e registry traduzioni Core con modello registry-first: le righe pubbliche vengono risolte da `Magazzino Tecnologie` e `Magazzino Prodotti`, mentre `Product Cards` conserva solo override marketing leggeri. WooCommerce resta canale opzionale per prodotti e tecnologie price-ready, non fonte unica delle card pubbliche. Le pagine importanti richiedono comunque review testi.
- Conversion Stack unisce card, lead form, trial form e AI assistant wrapper.
- Social Channels separa scope cliente e SkinHarmony; Powered By è badge opzionale.
- SEO Local / Conversion Generator crea bozze, non pubblica.

## Stato Architetturale Verificato - Blocco 13

Mappa dettagliata:

- `SHARED_MEMORY/programs/suite/BLOCK_13_SECURITY_RELEASE_OWNERSHIP_EXTRACTION_MAP.md`

Verità attuale:

- Security Hardening è checklist read-only: permission callback, whitelist REST pubblica, nonce/capability, export protetti, audit e release preflight.
- Release Governance è manual-canary-only: package, rollback e stable devono essere coerenti, ma niente install/rollback automatici.
- Compatibility Contract controlla shortcode e marker REST che non devono rompersi.
- Module Ownership Map misura quali moduli sono già proprietari e quali sono ancora sidecar con runtime legacy.
- Extraction Planner dà la sequenza sicura di estrazione dal monolite, partendo dagli shortcode a rischio basso e lasciando WooCommerce hooks per ultimi.
- Questa area governa manutenzione e rilascio, non esegue hardening o refactor automatico.
