# SkinHarmony Core Block 01 - Bootstrap, Accesso, Storage E Admin

## Perimetro

Questo blocco mappa il bootstrap del plugin traduttore/Core WordPress, il plugin Core Admin, impostazioni, storage, ruoli, API key e confini con Universal Core.

File letti:

- `wordpress/plugins/skinharmony-core/skinharmony-core.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-core-settings.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-core-storage.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-core-automation-keys.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-settings-api.php`
- `wordpress/plugins/skinharmony-core-admin/skinharmony-core-admin.php`

## Versioni

- SkinHarmony Translation Hub: release locale `3.2.38`, live verificato `3.2.37`
- SkinHarmony Core Admin: `1.0.4`
- DB schema Core: `3.1.6`

## Ruolo Del Programma

SkinHarmony Translation Hub e il plugin WordPress dedicato a:

- traduzione sito;
- memory traduzioni;
- review queue;
- content governance;
- Language Autopilot;
- claim/content guard;
- collegamento Universal Core;
- automation key per usare il servizio senza sessione admin.

SkinHarmony Core Admin e un plugin separato per:

- generare API key Universal Core;
- gestire clienti;
- gestire setup/vendite Suite;
- configurare URL/admin key Core centrale;
- testare Core remoto.

## Bootstrap Core

File principale:

- `skinharmony-core.php`

Costanti:

- `SH_CORE_VERSION`
- `SH_CORE_FILE`
- `SH_CORE_PATH`
- `SH_CORE_URL`

Classi caricate:

- settings;
- automation keys;
- access/roles;
- storage;
- delta detector;
- queue/autosync;
- glossary;
- memory;
- provider;
- runtime;
- content orchestrator;
- review queue;
- SEO bridge;
- integrity check;
- software bridge;
- Universal Core adapter;
- network orchestrator;
- language;
- admin;
- leads;
- Smart Desk bridge;
- license;
- OpenAI;
- site translator;
- settings API.

Inizializzazione:

- istanzia language, bridge, license, admin, leads;
- inizializza in safe mode provider, translator, queue, autosync, review, SEO, integrity, software bridge, Universal Core adapter, network orchestrator e settings API;
- salva boot errors senza mandare in fatal il sito.

Hook principali:

- `init`: sync roles;
- `init`: maybe upgrade storage;
- `rest_api_init`: route access;
- `init`: shortcode base;
- `wp_enqueue_scripts`: CSS frontend;
- `admin_enqueue_scripts`: CSS admin;
- `query_vars`: `sh_lang`;
- `template_redirect`: cookie lingua.

Shortcode base:

- `[sh_language_switcher]`
- `[sh_translate]`
- `[sh_lead_form]`

## Storage

Tabelle create da `SH_Core_Storage`:

- `sh_core_translation_memory`
- `sh_core_translation_jobs`
- `sh_core_string_sources`
- `sh_core_review_queue`
- `sh_core_audit_log`
- `sh_core_openai_usage_log`
- `sh_core_translation_revisions`
- `sh_core_network_nodes`
- `sh_core_network_sync_log`

Significato:

- `translation_memory`: memoria traduzioni approvate o da review;
- `translation_jobs`: coda traduzione;
- `string_sources`: fonti stringhe e hash;
- `review_queue`: coda revisione;
- `audit_log`: eventi;
- `openai_usage_log`: uso/costi provider;
- `translation_revisions`: storico modifiche;
- `network_nodes`: nodi Suite/Core;
- `network_sync_log`: eventi sync rete.

Regola:

- Il plugin non deve tradurre direttamente modificando contenuto sorgente italiano. Deve salvare memory/runtime e applicare render per lingua.

## Settings

Opzione:

- `sh_core_settings`

Default importanti:

- lingue abilitate: `it`, `en`, `fr`, `de`, `es`;
- default/source language: `it`;
- translation provider: `memory_only`;
- governance mode: `base_openai`;
- operating mode: `hybrid`;
- Suite connector: `local_suite`;
- target_langs: `en`, `fr`, `de`, `es`;
- enabled policy packs:
  - `beauty_marketing`
  - `partner_distributor`
  - `software_runtime`
  - `compliance_guard`
- protected terms:
  - SkinHarmony
  - Smart Desk
  - AI Gold
  - Nyra
  - Site Suite

Chiavi/config:

- OpenAI API key;
- Universal Core remote URL/key;
- Suite connector key;
- Codex direct API key;
- network API key;
- license server URL/key;
- Smart Desk API URL/key.

Budget provider:

- budget mensile/giornaliero;
- limite stringhe per call;
- limite char per call;
- limite jobs per ora;
- stop on budget optional.

## REST Settings / Codex

Namespace:

- `sh-core/v1`

Route settings principali:

- `GET /settings`
- `POST /settings`
- `POST /settings/generate-codex-key`
- `GET /settings/automation-keys`
- `POST /settings/automation-keys`
- `DELETE /settings/automation-keys/{key_id}`
- `POST /settings/test-universal-core`
- `GET /codex/status`
- `POST /codex/content-guard/check`

Regola:

- Settings API richiede admin WordPress.
- Route Codex richiedono `X-SkinHarmony-Codex-Key` o Bearer uguale alla key configurata.

## Automation Keys

Classe:

- `SH_Core_Automation_Keys`

Header:

- `X-SkinHarmony-Automation-Key`

Formato key:

- `SHX-AUTO-...`

Storage:

- `sh_core_automation_api_keys`

Scope ammessi:

- `content_governance`
- `translation_read`
- `claim_check`
- `suite_sync`
- `codex_status`
- `all`

Rate limit:

- `120` richieste/minuto per chiave/scope.

Regole:

- La chiave in chiaro viene mostrata alla creazione.
- Nel database resta hash + masked key.
- Revoca cambia status a `revoked`, non deve cancellare lo storico.
- Automation key serve per automazioni/clienti senza dare accesso admin WordPress.

## Core Admin

Plugin:

- `wordpress/plugins/skinharmony-core-admin`

Menu:

- `Core Admin`
- `Clienti e vendite`
- `Setup Suite`
- `API Key Core`
- `Mappa Core`
- `Impostazioni Core`

REST:

- `GET /shca/v1/status`
- `GET /shca/v1/settings`
- `POST /shca/v1/settings`
- `GET /shca/v1/keys`
- `POST /shca/v1/keys/generate`
- `POST /shca/v1/keys/revoke`
- `POST /shca/v1/test-core`

Storage:

- `shca_settings`
- `shca_clients`
- `shca_sales_setups`
- `shca_generated_keys`

Admin key Universal Core:

1. `SH_CORE_ADMIN_KEY` in `wp-config.php`;
2. env `SH_CORE_ADMIN_KEY`;
3. WordPress option.

Regola:

- Core Admin genera chiavi Universal Core/provider.
- SkinHarmony Core genera automation key locali per usare il plugin/traduttore.
- Le due famiglie di chiavi non vanno confuse.

## Stato Operativo

Pronto:

- bootstrap sicuro con safe init;
- impostazioni;
- tabelle core;
- automation keys;
- API settings;
- Core Admin per chiavi/clienti/setup;
- cookie lingua e shortcode base.

Parziale:

- Core Admin dipende da admin key remota configurata;
- policy tenant/settore dipende da Universal Core e pack;
- revoca/rotazione chiavi va sempre auditata nei report;
- alcune funzioni avanzate dipendono da provider/OpenAI/Render configurati.

Da non promettere:

- provisioning SaaS completo solo dal plugin Core;
- sicurezza enterprise solo con automation key;
- decisione Universal Core se URL/key remoti non sono configurati;
- accesso Codex senza key dedicata.
