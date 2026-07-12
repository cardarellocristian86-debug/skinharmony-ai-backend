# Suite Blocco 01 - Bootstrap, Registry, Moduli

Aggiornato: 2026-05-24

## Scopo Del Blocco

Questo blocco spiega come SkinHarmony Site Suite si avvia, come carica i moduli, cosa resta nel monolite e quali endpoint espone per stato/framework/Core.

## File Letti

- `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
- `wordpress/plugins/skinharmony-site-suite/core/class-shss-bootstrap.php`
- `wordpress/plugins/skinharmony-site-suite/core/class-shss-loader.php`
- `wordpress/plugins/skinharmony-site-suite/core/class-shss-module-registry.php`
- `wordpress/plugins/skinharmony-site-suite/core/class-shss-security.php`
- cartella `wordpress/plugins/skinharmony-site-suite/modules/`

## Versione Corrente

- Plugin: `SkinHarmony Site Suite`
- Versione rilevata: `5.2.37`
- Costante: `SHSS_VERSION = 5.2.37`

## Come Parte

Il file principale `skinharmony-site-suite.php` definisce costanti base:

- `SHSS_VERSION`
- `SHSS_FILE`
- `SHSS_PATH`
- `SHSS_URL`

Poi carica classi core con `shss_safe_require`, tra cui:

- loader;
- security;
- settings;
- audit;
- health;
- soft gate licenze;
- module registry;
- bootstrap;
- Core/readiness/decision layer se presenti.

La classe principale `SkinHarmony_Site_Suite` aggancia WordPress con:

- `plugins_loaded`
- `admin_menu`
- `admin_init`
- `rest_api_init`
- enqueue asset frontend/admin
- tracking Google Ads / traffico
- daily automation
- update settings
- moltissimi `admin_post_*`
- hook WooCommerce.

## Doppio Layer Reale

Suite oggi lavora su due livelli:

1. **Monolite legacy reale**
   - Vive nel file `skinharmony-site-suite.php`.
   - Contiene molte UI admin, handler, REST route, calcoli e integrazioni.
   - Serve ancora gran parte delle funzionalità operative.

2. **Framework modulare sidecar**
   - Vive in `core/` e `modules/`.
   - Carica i moduli da `SHSS_Module_Registry`.
   - Espone health, snapshot e ownership map.
   - In molte aree dichiara lo stato del modulo ma lascia ancora servizio al monolite.

Questa e la verità architetturale: Suite non e piu solo monolite, ma non e ancora estratta completamente.

## Module Registry

File: `core/class-shss-module-registry.php`

Il registry contiene una lista di moduli attivi per default.

Per ogni modulo salva:

- `slug`
- `label`
- `class`
- `path`
- `active`
- `dependencies`
- `capability`
- `status`
- `runtime`
- `health_message`

Il path standard e:

```text
modules/<slug>/class-module.php
```

La classe standard e:

```text
SHSS_Module_<Nome_Modulo>
```

Esempio:

```text
crm-b2b -> SHSS_Module_Crm_B2b
```

## Logica Di Caricamento Moduli

Metodo: `SHSS_Module_Registry::load_active_modules()`

Flusso:

1. Per ogni modulo legge il path.
2. Se il file non esiste:
   - status `loaded`
   - runtime `legacy_monolith`
   - quindi il sistema considera la funzione ancora servita dal monolite.
3. Se il file esiste:
   - lo carica tramite `SHSS_Loader`.
   - controlla che esista la classe dichiarata.
   - istanzia il modulo.
   - se esiste `init()`, lo esegue.
   - salva istanza.
   - status `loaded`
   - runtime `modular`.
4. Se fallisce:
   - status `failed`
   - salva `health_message`
   - registra audit `module_failed`.

## Moduli Dichiarati

Moduli rilevati nel registry:

- Lead Intelligence
- Translation Manager
- Claim Guard
- Price Guard
- Trial Bridge
- Product Cards
- Social Channels
- Powered By
- DAM Assets
- Upsell Suggestions
- Technology Inventory
- B2B Engine
- CRM B2B
- Commerce Control Room
- Commerce Policy
- Price List Engine
- Warehouse / Barcode
- Fulfillment Control
- Universal Core Commerce
- SEO Conversion
- AI Assistant Bridge
- WaaS Engine
- WaaS Licenses
- WaaS Gates
- WaaS Templates
- WaaS Onboarding
- WaaS Projects
- WaaS Commercial
- Update Server
- Security Hardening
- Analytics
- Reputation
- Payment Settlements
- Google Ads
- License Renewals
- Brand Governance
- Template Design System
- Traffic Attribution
- 2.0 Readiness Gate
- Release Governance
- Client Network Dashboard
- Module Ownership Map
- Compatibility Contract
- Extraction Planner
- SkinHarmony Core Connector
- Smart Desk Bridge
- WooCommerce Bridge
- Daily Automation

## Moduli Fisici Presenti

La cartella `modules/` contiene file per tutti o quasi tutti i moduli dichiarati. Questo significa che il registry prova a caricarli come modulari.

La qualità reale va verificata modulo per modulo: alcuni moduli sono operativi, altri sono health/metadata/read-only e la logica forte resta nel monolite.

## Core Bootstrap Sidecar

File: `core/class-shss-bootstrap.php`

Oggetti creati:

- `SHSS_Loader`
- `SHSS_Settings`
- `SHSS_Security`
- `SHSS_License_Soft_Gate`
- `SHSS_Module_Registry`
- `SHSS_Health`
- `SHSS_Universal_Core`
- `SHSS_Module_Snapshot_Builder`
- `SHSS_Waas_Readiness_Core`
- `SHSS_Nyra_Decision_Layer`

Il metodo `init()`:

- carica moduli attivi;
- registra route core REST;
- registra audit `framework_bootstrap_loaded`;
- aggiorna opzione `shss_framework_bootstrap_version`.

## Endpoint Framework/Core

Registrati da `SHSS_Bootstrap`:

- `GET /wp-json/shss/v1/status`
- `GET /wp-json/shss/v1/framework-health`
- `GET /wp-json/shss/v1/framework-rest-map`
- `GET /wp-json/shss/v1/core/snapshot`
- `GET /wp-json/shss/v1/core/<module>`
- `GET /wp-json/shss/v1/waas-core/readiness`

Sono endpoint di lettura/governance, con policy:

- `read_only = true`
- `writes_data = false`
- `executes_actions = false`
- `destructive_actions_allowed = false`
- `owner_confirmation_required = true`
- `control_room_required_for_actions = true`

## Route Monolite

Il file principale registra anche moltissime route REST sotto `shss/v1`, fra cui:

- status;
- daily automation;
- translations;
- traffic;
- price guard;
- Nyra/commercial intelligence;
- WaaS manager;
- licenses;
- module gates;
- package matrix;
- deployment architecture;
- templates;
- onboarding;
- B2B order bridge;
- product inventory;
- CRM B2B;
- customer node 360;
- ERP light backbone;
- event spine;
- smartdesk intelligence;
- commerce policy/control room;
- value chain pricing guard;
- projects;
- network control;
- enterprise core snapshot;
- commercial/sellability;
- connection command center;
- activation/go-live/completion map;
- fulfillment;
- lifecycle/renewal/support/customer proof;
- update manifest/governance;
- Smart Desk bridge;
- Smart Desk app key factory;
- DAM, analytics, reputation, upsell, settlements;
- SkinHarmony Core connector;
- control plane/visibility/live connection.

Queste route vanno lette in blocchi successivi perché sono troppe per dichiarare stato reale in un solo passaggio.

## Security

File: `core/class-shss-security.php`

Base attuale:

- capability principale: `manage_options`;
- REST permission: `current_user_can('manage_options')`;
- helper sanitize:
  - text;
  - key;
  - email;
- helper nonce/capability per admin action.

Nota: per clienti/tenant/ruoli avanzati la security va verificata nei moduli e nel monolite. Il core security sidecar e semplice e owner/admin-centric.

## Collegamenti Principali

Suite si collega a:

- WordPress admin e REST;
- WooCommerce per ordini/prodotti/licenze;
- Google Ads/traffic tracking;
- SkinHarmony Core per content/claim/translation governance;
- Universal Core/Nyra per snapshot, readiness, rischio, advisory;
- Smart Desk per bridge/app key/pulse/config bundle;
- Render/update server/runtime remoto quando configurato.

## Stato Reale Del Blocco

Verde:

- Bootstrap presente.
- Registry moduli presente.
- Health/snapshot/rest-map presenti.
- Sidecar Core/Nyra/readiness presente.
- Security base presente.

Giallo:

- Molta logica resta nel monolite.
- Alcuni moduli possono essere solo dichiarativi/read-only.
- La REST map distingue tra route dichiarate e route ancora servite dal monolite.

Rosso / da verificare nei prossimi blocchi:

- Quali moduli sono realmente operativi e quali solo metadata.
- Quali pulsanti UI puntano ad azioni reali.
- Quali endpoint scrivono dati e con quali permessi.
- Quali parti sono pronte per vendita e quali ancora governance/readiness.

## Prossimo Blocco Consigliato

Blocco 2: `Admin Menu + Control Room + UI shell`.

Obiettivo: capire tutte le pagine admin Suite, cosa mostrano, quali sono vive, quali sono solo dashboard e quali pulsanti/actions sono collegate.
