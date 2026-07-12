# SkinHarmony Site Suite

## Definizione

SkinHarmony Site Suite e il plugin WordPress che trasforma un sito in nodo operativo governato.

Non e solo:

- builder pagine;
- CRM contatti;
- plugin licenze;
- traduttore;
- e-commerce.

E il layer WordPress che collega:

- sito pubblico;
- CRM B2B;
- offerte WaaS;
- template;
- licenze;
- update;
- cataloghi;
- ordini;
- stock;
- listini;
- claim/prezzi;
- Core;
- Smart Desk;
- rete commerciale.

Formula stabile:

> WordPress mostra e raccoglie. Suite orchestra. Universal/Core decide. Smart Desk esegue operatività centro. Owner conferma le azioni sensibili.

## Per Chi E

- SkinHarmony owner: controlla rete, nodi, clienti, licenze, release, offerte, update e priorità.
- Brand: governa listini, claim, contenuti, prodotti, offerte, partner e distributori collegati.
- Distributori: gestiscono rete, brand collegati, richieste stock, ordini B2B e listini autorizzati.
- Partner/centri/saloni: usano contenuti, tecnologie, offerte, ordini e Smart Desk quando previsto.
- Clienti WaaS: ricevono sito/nodo controllato con template, tracking, lead, claim/price guard e pacchetto modulare.

## Mappa Funzionale Completa

1. Bootstrap, sidecar e registry moduli.
2. Control Room enterprise e menu admin.
3. CRM B2B / Node 360.
4. Value Chain Pricing, Price Guard e Order Bridge.
5. Template registry, Page Factory e Site Clone.
6. Licenze, update server, Smart Desk Bridge e App Key Factory.
7. Core Connector, traduzioni strutturate, Claim Guard e Codex keys.
8. Commerciale WaaS, lead, analytics, DAM, brand governance, reputation e dogfood.
9. Activation pipeline, onboarding, project builder, trial bridge, soft gates e daily automation.
10. Inventory, WooCommerce bridge, fulfillment, barcode e settlement.
11. AI/Nyra advisory, network dashboard, AI Control Tower, Agent Observability, Enterprise Health e V2 readiness.
12. Google Ads, attribution, product cards, social, powered-by, conversion stack e bozze SEO.
13. Security hardening, release governance, compatibility contract, module ownership ed extraction planner.
14. Routing operativo sito: email lead/contatto/supporto/fatturazione/executive e pulsante WhatsApp assistenza pubblico configurabile. Suite centralizza la mappa, ma non crea caselle o alias nel provider posta.

## Dove Vive

WordPress:

- UI admin;
- pagine pubbliche;
- shortcode;
- CRM leggero;
- WooCommerce;
- opzioni e registry locali;
- lead e proposte;
- guardrail fallback;
- zip plugin.

Render / server esterno:

- Universal Core centrale;
- SkinHarmony Core/traduzione se esposto come servizio;
- Smart Desk live;
- update package/manifest quando configurato;
- runtime dedicato futuro.

Locale:

- sviluppo;
- Core 2.0 per Codex;
- report;
- zip;
- memoria condivisa;
- program registry.

## Stato Reale

Operativo:

- Control Room;
- CRM B2B base/avanzato;
- Product Cards;
- lead/trial;
- Price Guard pubblico;
- Value Chain Pricing Engine;
- B2B Order Bridge come richiesta;
- licenze soft gate;
- App Key Smart Desk;
- Google Ads conversioni evento;
- traffic attribution aggregata;
- template/draft generator;
- Core translation registry;
- Enterprise Health;
- release/readiness governance.

Parziale:

- estrazione completa dal monolite;
- Smart Desk sync automatico;
- update server vendibile full fleet;
- multi-tenant remoto reale;
- claim guard semantico pienamente centralizzato;
- page clone automatico end-to-end;
- analytics enterprise con costi/campagne;
- release automation e rollback automatico.

Read-only / governance:

- Nyra advisory;
- AI Control Tower;
- Network Dashboard;
- Release Governance;
- Security Hardening;
- Module Ownership Map;
- Extraction Planner;
- Payment Settlements;
- WooCommerce Bridge modulo fisico;
- Warehouse/Barcode.

## Cosa Non Promettere

- Automazioni distruttive senza conferma owner.
- Hard block brutale su licenze se non previsto da contratto.
- Campagne Google Ads create/ottimizzate automaticamente.
- Sync Smart Desk automatico senza consenso/privacy/Core.
- Payout, refund, revenue share o settlement automatici.
- Certificazione legale claim.
- Clonazione perfetta automatica di qualsiasi sito esterno.
- Monolite gia estratto.
- Multi-tenant cloud completo se non configurato.

## Documenti Di Mappa

- `BLOCK_01_BOOTSTRAP_MODULE_MAP.md`
- `BLOCK_02_ADMIN_MENU_CONTROL_ROOM_MAP.md`
- `BLOCK_03_CRM_B2B_NODE_360_MAP.md`
- `BLOCK_04_VALUE_CHAIN_COMMERCE_MAP.md`
- `BLOCK_05_TEMPLATE_PAGE_FACTORY_CLONE_MAP.md`
- `BLOCK_06_LICENSE_UPDATE_SMARTDESK_BRIDGE_MAP.md`
- `BLOCK_07_CORE_TRANSLATION_CLAIM_CODEX_MAP.md`
- `BLOCK_08_COMMERCIAL_ANALYTICS_BRAND_DOGFOOD_MAP.md`
- `BLOCK_09_ACTIVATION_ONBOARDING_GATES_AUTOMATION_MAP.md`
- `BLOCK_10_INVENTORY_WOOCOMMERCE_FULFILLMENT_SETTLEMENT_MAP.md`
- `BLOCK_11_AI_NYRA_NETWORK_READINESS_MAP.md`
- `BLOCK_12_TRACKING_SOCIAL_CARDS_CONVERSION_MAP.md`
- `BLOCK_13_SECURITY_RELEASE_OWNERSHIP_EXTRACTION_MAP.md`

## Regola Di Manutenzione

Ogni modifica Suite deve aggiornare almeno uno tra:

- blocco mappa specifico;
- `ARCHITECTURE.md`;
- `OPERATIONS.md`;
- `USER_MANUAL.md` se cambia l'uso reale.

Ogni modifica deve poi passare da:

- `npm run codex:program-registry -- --file <file-modificato> --file SHARED_MEMORY/programs/suite/<doc>`
