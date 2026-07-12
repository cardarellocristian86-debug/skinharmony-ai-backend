# Suite Block 02 - Admin Menu, Control Room E UI Shell

Data lettura: 2026-05-24

## Obiettivo Del Blocco

Mappare il secondo livello della Suite:

- menu WordPress principale;
- Control Room WaaS / Enterprise;
- UI shell admin;
- mappa moduli visibili;
- collegamento Core, Render, Smart Desk, Codex e Shared Memory;
- comportamento dei pulsanti/ancore della UI.

Questo blocco spiega come l'owner entra nella Suite e come la Suite evita di diventare una lista tecnica di pagine scollegate.

## File Letti

- `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
- `wordpress/plugins/skinharmony-site-suite/assets/site-suite.css`
- `wordpress/plugins/skinharmony-site-suite/assets/site-suite-admin.js`
- `wordpress/plugins/skinharmony-site-suite/admin/README.md`

## Entry Point Admin

Funzione principale:

- `register_admin_menu()`

Il menu padre `SkinHarmony Suite` punta a:

- slug: `shss-dashboard`
- render: `render_waas_control_room_admin()`

Scelta importante:

- il menu padre non apre una dashboard generica;
- apre direttamente la Control Room;
- questo rende Suite una console di governo, non un semplice elenco plugin.

## Pagine Admin Registrate

La Suite registra un menu molto ampio, tutto sotto `SkinHarmony Suite`.

### Operatività Base

- `shss-dashboard` - SkinHarmony Suite / Control Room
- `shss-dashboard-base` - Dashboard Base
- `shss-leads` - Lead Intelligence
- `shss-translations` - Translation Manager
- `shss-claim-guard` - Claim Guard
- `shss-price-guard` - Price Guard
- `shss-trial-bridge` - Trial Bridge
- `shss-automation` - Automazioni
- `shss-cards` - Product Cards
- `shss-seo-local` - SEO Local Pages

### Catalogo, CRM E B2B

- `shss-technology-inventory` - Magazzino Tecnologie
- `shss-product-inventory` - Magazzino Prodotti
- `shss-b2b-crm` - CRM B2B
- `shss-value-chain-pricing-guard` - Value Chain Pricing
- `shss-b2b-order-bridge` - B2B Order Bridge
- `shss-technology-deposits` - Acconto e Saldo
- `shss-technology-orders` - Ordini Tecnologie
- `shss-commerce-control-room` - Commerce Control Room

### WaaS, Licenze E Clienti

- `shss-waas-control-room` - Control Room
- `shss-waas-manager` - WaaS Manager
- `shss-waas-dashboard` - Dashboard WaaS
- `shss-waas-license` - Licenza WaaS
- `shss-waas-license-registry` - Registro Licenze
- `shss-waas-subscription-products` - Prodotti Abbonamento
- `shss-waas-module-gates` - Gate Moduli
- `shss-deployment-architecture` - Architettura Scalabile
- `shss-waas-templates` - Template WaaS
- `shss-waas-template-builder` - Template Builder
- `shss-waas-onboarding` - Onboarding WaaS
- `shss-multi-tenant-onboarding` - Multi-Tenant
- `shss-waas-project-builder` - Project Builder
- `shss-waas-commercial` - Pagamenti e Contratti

### Governance, Growth E Bridge

- `shss-social-channels` - Social Channels
- `shss-enterprise-health` - Enterprise Health
- `shss-brand-governance` - Brand Governance
- `shss-dam` - DAM Centrale
- `shss-waas-analytics` - Analytics WaaS
- `shss-reputation-management` - Reputation Management
- `shss-upsell-engine` - AI Upsell Engine
- `shss-payment-settlements` - Payment Settlements
- `shss-waas-update-server` - Update Server
- `shss-core-connector` - Core Connector
- `shss-shared-memory` - Shared Memory / Handoff
- `shss-waas-smartdesk-bridge` - Smart Desk Bridge
- `shss-smartdesk-app-keys` - Smart Desk App Keys
- `shss-codex-automation` - Codex Automation

## Perché Il Menu È Così Grande

La Suite non è un singolo modulo.

È una console WordPress che collega:

- sito;
- lead;
- CRM;
- ecommerce;
- B2B;
- licenze;
- template;
- update;
- Core;
- Smart Desk;
- automazioni;
- report;
- contenuti;
- guardrail claim/prezzo.

Il rischio è diventare pesante e dispersiva.

Per questo la Control Room leggera diventa il punto d'ingresso e la mappa moduli preserva tutte le funzioni senza renderizzarle subito.

## Control Room - Render Principale

Funzione:

- `render_waas_control_room_admin()`

La schermata costruisce:

- hero enterprise;
- nota operativa;
- pannello demo/sito SkinHarmony;
- vista leggera default;
- board profonde divise per importanza e aperte singolarmente;
- KPI iniziali;
- command strip;
- next actions;
- governance evidence;
- operator command index;
- revenue radar;
- authority matrix;
- runtime topology;
- entitlement rail;
- automation inventory;
- Customer Node 360;
- ERP Light Backbone;
- Event Spine;
- Smart Desk Customer Intelligence;
- Runbook Catalog;
- Agent Exposure;
- Decision Queue;
- Evidence Receipt;
- Exception Triage;
- Remediation Playbook;
- Agent Lifecycle;
- Control Attestation;
- endpoint groups.

## Regola Della Control Room

La pagina dichiara più volte una regola stabile:

- coordina;
- legge;
- mostra;
- non installa;
- non paga;
- non pubblica;
- non sincronizza automaticamente;
- non esegue runbook ciechi;
- richiede Core/owner per azioni sensibili.

Questa è coerente con la logica:

`WordPress/Suite mostrano. Core decide. Nyra spiega. Codex/Smart Desk eseguono solo entro policy.`

## Modalità Leggera

La Control Room default usa una sintesi veloce e non propone più la vista completa massiva nella UI operativa.

Perché:

- l'admin WordPress non deve esplodere;
- le board profonde restano su endpoint REST o pannelli dedicati;
- i moduli non vengono rimossi, solo caricati su richiesta.

## KPI Iniziali

La vista leggera mostra:

- WaaS readiness;
- moduli pronti;
- plugin attivi;
- colli aperti.

Questi dati arrivano da:

- `get_waas_manager_status()`
- `get_waas_control_room_groups()`
- blocker interni dello stato WaaS.

## Command Strip

La Control Room traduce l'architettura in cinque concetti leggibili:

- Control plane: coordina;
- Core gate: governa;
- Suite node: legge e mostra;
- Render runtime: separabile;
- Owner action: conferma.

Perché serve:

- evita linguaggio tecnico puro;
- fa capire al cliente/provider dove vive ogni responsabilità.

## Prossime Azioni

La dock `owner workflow` porta l'owner verso:

- Core Connector;
- Shared Memory;
- Codex Automation;
- Smart Desk App Keys;
- Pagamenti e Contratti.

Sono link, non automazioni.

Questa scelta è corretta perché trasforma i pulsanti in navigazione contestuale e non in azioni pericolose.

## Governance Evidence

La rail `Osserva, governa, misura, prova` separa:

- contesto/freschezza;
- policy/tenant;
- score/ROI readiness;
- evidence/audit.

Questa è la base UI per rendere vendibile il concetto di governance AI.

## Operator Command Index

La Suite mostra comandi tipo:

- `/core status`
- `/shared memory`
- `/policy tenant`
- `/audit actions`
- `/codex keys`
- `/runbook preview`
- `/change impact`
- `/waas offer`
- `/smartdesk keys`
- `/marketing queue`

Sono etichette operative e link.

Non eseguono comandi.

## Mappa Di Visibilità Suite

Funzioni:

- `get_suite_visibility_map()`
- `render_suite_visibility_map_panel()`

La mappa divide la Suite in sezioni:

- Operatività sito;
- Contenuti, lingua e guardrail;
- WaaS, vendita e clienti;
- Commerce e B2B;
- Core, Render e automazione controllata;
- Crescita, reputazione e rete.

Ogni elemento contiene:

- nome;
- slug pagina;
- ruolo;
- dettaglio;
- URL admin;
- stato visibile nella Control Room leggera o solo dettaglio.

Obiettivo:

- non perdere moduli;
- non caricare tutto subito;
- far capire cosa esiste e dove si apre.

## Control Plane Status

Funzione:

- `get_suite_control_plane_status()`

Aggrega:

- Core Connector;
- Remote Runtime;
- registro licenze;
- update governance;
- runbook definitions;
- evidence events;
- tenant registry;
- runbook artifacts;
- dashboard runtime remoto;
- runbook marketplace remoto;
- ecosystem tracks.

Output chiave:

- tenant;
- summary;
- endpoints;
- guardrails;
- tenant registry;
- remote runtime;
- runbook marketplace;
- action queue;
- recent runbook history.

Questo è un control plane locale read-only, con possibilità di estendere verso Render.

## Tenant Registry

Funzione:

- `get_suite_tenant_registry_status()`

Legge:

- tenant id;
- brand scope;
- dominio WordPress;
- nome sito;
- licenze attive;
- stato Core/update.

Crea un nodo locale:

- id locale hashato;
- dominio;
- tenant;
- brand scope;
- piano;
- versione Suite;
- mode Core;
- health;
- next action;
- `write_enabled = false`.

Guardrail:

- read-only;
- nessun cambio chiavi;
- nessuna mutazione tenant;
- nessuna scrittura remota;
- owner confirmation richiesta per cambi.

## Core Control Plane Bridge

Funzione:

- `get_suite_core_control_plane_bridge_status()`
- `render_suite_core_control_plane_bridge_panel()`

Ruoli dichiarati:

- Suite: `ui_agent_wordpress`;
- Core: `governance_decision_policy_audit`;
- Render: `control_plane_runtime_for_heavy_or_dedicated_nodes`.

Branch family esposte:

- agent orchestration guard;
- runtime deployment scaling guard;
- codex wordpress platform guard;
- data integration orchestration;
- legal privacy compliance guard;
- observability ROI guard.

Contratto Nyra/Core/Codex:

- Nyra prepara scenari e spiega;
- Core giudica ranking, rischio, branch, policy, gate, audit;
- Codex implementa solo il microblocco vincente e verifica.

Regola anti duplicazione:

- scenari ripetuti non devono gonfiare ranking.

## Remote Runtime

Funzione:

- `get_suite_remote_runtime_status()`

Legge settings:

- `suite_runtime_url`;
- `suite_runtime_api_key`;
- `suite_runtime_mode`;
- `suite_runtime_node_id`;
- `suite_runtime_topology`;
- tenant id;
- brand scope.

Produce contratto per:

- heartbeat;
- snapshot push;
- evidence push;
- remote dashboard;
- ecosystem tracks;
- remote runbook receiver.

Guardrail:

- fallback locale obbligatorio;
- nessuna esecuzione remota automatica;
- nessun dato cliente raw di default;
- key scoped obbligatoria;
- conferma owner per azioni sensibili.

## Commerce Control Room

Funzione:

- `render_commerce_control_room_admin()`

È una seconda control room specifica commerce.

Legge:

- WooCommerce;
- B2B;
- policy;
- guardrail;
- settlement;
- Smart Desk.

Regola:

- vista read-only;
- azioni operative governate da Core e conferma owner;
- nessun checkout/pagamento/stock automatico.

## UI Shell Admin

Asset:

- `assets/site-suite.css`
- `assets/site-suite-admin.js`

Caricamento:

- `enqueue_assets()`
- `safe_enqueue_assets()`

Regole:

- CSS sempre caricato;
- JS admin caricato in admin;
- media library WordPress caricata solo su `shss-waas-template-builder`.

## CSS Admin

Il CSS contiene:

- griglie responsive;
- card e metriche;
- tabelle scrollabili;
- overflow hardening;
- pulsanti a capo;
- highlight ancore;
- stato target mancante;
- fondazione UI enterprise 5.1.43;
- command layer 5.1.44;
- next action dock 5.1.45;
- governance evidence 5.1.46;
- rail successive per runtime, entitlement, automation, customer node, runbook, evidence.

Nota importante:

- il CSS è molto stratificato;
- diverse sezioni sono state aggiunte progressivamente;
- esistono regole duplicate/di hardening, ma servono a contenere WordPress e prevenire card che escono dai box.

## JS Admin

File:

- `assets/site-suite-admin.js`

Fa tre cose principali:

1. Ancore interne:
   - intercetta link `#...`;
   - se il target esiste scrolla e mette highlight;
   - se manca, mostra toast warning e marca il link come non collegato.

2. Copia testo:
   - gestisce elementi con `data-shss-copy`;
   - usa Clipboard API;
   - fallback con messaggio manuale.

3. Builder/card:
   - aggiunge righe card tecnologia;
   - collega media picker WordPress al Template Builder;
   - aggiorna input nascosti e preview immagine.

Questo JS è importante perché rende visibili i pulsanti non collegati invece di farli sembrare rotti.

## Admin Partial Directory

File:

- `admin/README.md`

Stato:

- directory predisposta;
- rendering ancora nel monolite;
- motivazione: evitare cambio slug, screen ID o form action prima della stabilità framework/registry.

## Come È Collegata

```text
WordPress admin menu
  -> render_waas_control_room_admin()
      -> get_waas_manager_status()
      -> get_waas_control_room_groups()
      -> get_suite_visibility_map()
      -> get_suite_control_plane_status()
      -> get_suite_core_control_plane_bridge_status()
      -> get_suite_remote_runtime_status()
      -> get_suite_customer_node_360_status()
      -> get_suite_erp_light_backbone_status()
      -> get_suite_event_spine_status()
      -> get_suite_smartdesk_customer_intelligence_status()
      -> endpoint REST dedicati
  -> pagine modulo singole
      -> render_*_admin()
      -> admin_post_* handlers
      -> REST endpoints
```

## Cosa Fa Bene

- Il menu è completo.
- Il parent menu apre la regia principale.
- La Control Room leggera evita lentezza e render massivo.
- I moduli restano visibili tramite mappa.
- I link principali puntano ai pannelli corretti.
- La UI dichiara guardrail chiari: read-only, owner confirmation, no sync cieco.
- JS intercetta target mancanti per evitare pulsanti apparentemente morti.
- La distinzione WordPress/Core/Render/Smart Desk/Codex è già presente nel testo e nei dati.

## Dove È Ancora Debole

- Molta UI è ancora nel monolite.
- La pagina Control Room è enorme: buona come regia, ma difficile da mantenere.
- Alcune rail sono specifiche UI/read-only più che motore operativo.
- I partial admin non sono ancora estratti.
- La mappa completa dice cosa esiste, ma non garantisce da sola che ogni pulsante faccia azione reale.
- Le classi CSS sono molto cresciute per strati: serve futura normalizzazione design system.

## Verdetto Blocco 02

Stato: operativo come control surface.

La Suite oggi ha un ingresso admin coerente:

- Control Room leggera per orientamento;
- moduli raggiungibili;
- guardrail leggibili;
- bridge verso Core/Render/Smart Desk/Codex dichiarato;
- runtime remoto separabile ma non automatico;
- UI più enterprise rispetto al WordPress tecnico.

Non è ancora un'app admin completamente estratta in componenti/partials.

## Prossimo Blocco

Blocco 03:

- CRM B2B;
- account hierarchy;
- customer/node 360;
- documenti, mail, attività;
- collegamento CRM con ordini, listini, stock, Core e Smart Desk.
