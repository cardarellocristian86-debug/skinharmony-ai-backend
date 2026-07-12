# Suite Block 13 - Security, Release, Ownership Ed Estrazione

## Perimetro

Questo blocco mappa i moduli che governano sicurezza, release, compatibilità, ownership dei moduli ed estrazione progressiva dal monolite.

File letti:

- `wordpress/plugins/skinharmony-site-suite/modules/security-hardening/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/release-governance/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/compatibility-contract/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/module-ownership-map/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/extraction-planner/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`

## Sintesi

Questa area non esegue hardening automatico e non riscrive il plugin.

Suite oggi fa:

- espone checklist sicurezza read-only;
- verifica release governance read-only;
- dichiara compatibilità minima di shortcode e REST markers;
- misura quanto runtime vive ancora nel monolite;
- propone una sequenza sicura di estrazione;
- alimenta Enterprise Health e Control Room.

Suite oggi non fa:

- lockdown automatico;
- modifica ruoli/capability;
- blocco automatico REST;
- installazione update automatica;
- rollback automatico;
- spostamento file/moduli automatico;
- rewiring automatico shortcode/REST;
- cancellazione legacy.

## Security Hardening

Modulo fisico:

- `SHSS_Module_Security_Hardening`

REST dichiarata:

- `/wp-json/shss/v1/waas-manager/security-hardening`

Runtime legacy:

- `get_security_hardening_status()`
- `rest_security_hardening_status()`
- Enterprise Health nel monolite.

Checklist principale:

- REST admin protette da permission callback;
- endpoint pubblici limitati;
- admin-post con capability + nonce;
- export protetti;
- licenze in soft gate;
- campi privati mascherati;
- audit retention limitata;
- preflight release obbligatorio.

Endpoint pubblici ammessi in whitelist:

- `/traffic/track`
- `/price-guard/nyra-snapshot`
- `/waas-manager/license/verify`
- `/waas-manager/update-manifest`

Controlli export:

- lead CSV protetto;
- translations CSV protetto;
- capability `manage_options`;
- nonce obbligatorio;
- export pubblico spento.

Protezione dati:

- chiavi sensibili mascherate;
- license key mascherate;
- credenziali pagamento non salvate qui;
- payload REST privati non pubblici;
- serve policy retention GDPR prima di scala enterprise.

Regola:

- Questo modulo deve restare read-only finché non esiste una policy enterprise completa. Non deve trasformarsi in “blocca tutto” automatico.

## Release Governance

Modulo fisico:

- `SHSS_Module_Release_Governance`

REST dichiarata:

- `/wp-json/shss/v1/waas-manager/update-governance`

Storage:

- `shss_waas_update_server`

Controlli:

- stable version allineata alla versione corrente;
- package URL zip configurato;
- package contiene la versione stable;
- rollback zip presente;
- canary manuale obbligatorio;
- installazione automatica spenta;
- preflight obbligatorio.

Policy:

- `update_mode = manual_canary_only`
- `automatic_install_enabled = false`
- `automatic_rollback_enabled = false`
- `automatic_canary_swap_enabled = false`
- `automatic_manifest_write_enabled = false`

Procedura richiesta:

1. backup plugin;
2. upload canary;
3. check HTTP/admin;
4. rollback immediato se 500/timeout;
5. promozione solo dopo conferma owner.

Regola:

- Release Governance decide se una distribuzione è matura, ma non installa e non promuove manifest da sola.

## Compatibility Contract

Modulo fisico:

- `SHSS_Module_Compatibility_Contract`

REST:

- `/wp-json/shss/v1/waas-manager/compatibility-contract`

Shortcode richiesti dal contratto:

- `sh_lead_intelligence_form`
- `sh_trial_bridge`
- `sh_technology_cards`
- `sh_conversion_stack`
- `sh_ai_assistant`
- `sh_waas_offer`
- `sh_waas_module_gate`
- `sh_social_channels`
- `sh_powered_by_skinharmony`
- `sh_dam_assets`
- `sh_upsell_suggestions`

Marker REST richiesti:

- `shss/v1`
- `framework-health`
- `waas-manager`
- `license`
- `templates`
- `smartdesk-bridge`

Contratti critici:

- soft gate licenze non deve diventare hard block;
- WooCommerce deve restare guardato quando assente;
- namespace REST `shss/v1` non va rotto;
- shortcode pubblici non vanno rinominati senza alias.

Limite:

- Non fa enforcement runtime automatico. E un gate di preflight/manual release.

Aggiornamento 2026-07-02 / `5.3.54`:

- Il contratto non legge piu solo `skinharmony-site-suite.php`.
- Usa un bundle sorgenti controllato: monolite, `core/class-shss-bootstrap.php`, `core/class-shss-health.php`, `core/class-shss-module-registry.php`, `core/class-shss-license-soft-gate.php` e i file `modules/*/class-module.php`.
- Questo evita falsi negativi quando una route, come `framework-health`, e gia registrata nel sidecar core invece che nel monolite.
- Il payload resta read-only e dichiara `source_scope=modular_source_bundle` e `source_files_scanned`.
- Non aggiunge enforcement runtime, non abilita update automatici e non inserisce dati tenant nello zip.

## Module Ownership Map

Modulo fisico:

- `SHSS_Module_Module_Ownership_Map`

REST:

- `/wp-json/shss/v1/waas-manager/module-ownership-map`

Scopo:

- capire chi possiede davvero il runtime: modulo fisico, sidecar con monolite, o monolite legacy.

Moduli tracciati:

- `lead-intelligence`
- `trial-bridge`
- `product-cards`
- `seo-conversion`
- `waas-licenses`
- `waas-gates`
- `waas-templates`
- `waas-projects`
- `update-server`
- `smartdesk-bridge`
- `woocommerce-bridge`
- `google-ads`
- `brand-governance`
- `traffic-attribution`

Livelli:

- `module_owned`: modulo possiede runtime;
- `sidecar_with_legacy_runtime`: modulo presente, runtime ancora monolite;
- `legacy_only`: manca modulo proprietario.

Hotspot legacy contati:

- shortcode registrations;
- REST routes;
- admin pages;
- admin_post actions;
- WooCommerce hooks;
- option writes.

Verità:

- Oggi molti moduli sono wrapper/health/read-only con runtime ancora nel file principale.
- Il debito principale non è “manca idea”, ma “ownership non ancora estratta”.

## Extraction Planner

Modulo fisico:

- `SHSS_Module_Extraction_Planner`

REST:

- `/wp-json/shss/v1/waas-manager/extraction-plan`

Sequenza raccomandata:

1. `p1_shortcode_renderers`
   - powered-by
   - social-channels
   - dam-assets
   - upsell-suggestions
   - product-cards
   - rischio basso
2. `p2_readonly_repositories`
   - lead-intelligence
   - technology-inventory
   - b2b-engine
   - waas-projects
   - rischio medio
3. `p3_admin_views`
   - waas-templates
   - waas-onboarding
   - waas-commercial
   - update-server
   - rischio medio
4. `p4_rest_aliases`
   - waas-licenses
   - smartdesk-bridge
   - analytics
   - reputation
   - rischio alto
5. `p5_woocommerce_hooks`
   - woocommerce-bridge
   - payment-settlements
   - rischio critico

Do not touch:

- `license_soft_gate_hard_block`
- `woocommerce_live_payment_hooks`
- `trial_bridge_submit_flow`
- `smartdesk_bridge_auto_sync`
- `update_manifest_stable_channel`
- `public_shortcode_names`
- `rest_namespace_shss_v1`

Regola:

- Un blocco per zip, caricato manualmente, con test WordPress reale.
- Nessuna estrazione automatica.
- Nessuna cancellazione legacy senza alias, test e rollback.

## Collegamento Con Enterprise Health

Enterprise Health legge:

- versione plugin ammessa;
- stable manifest allineato;
- `.htaccess`;
- installazione automatica spenta;
- Claim Guard;
- Price Guard;
- readiness WaaS;
- Smart Desk bridge safe mode;
- social channels separati;
- WP_DEBUG.

Stati:

- `healthy`
- `attention`
- `critical`

Regola:

- Se ci sono critical/high aperti, non si distribuisce ai clienti.

## Stato Operativo

Pronto:

- checklist sicurezza read-only;
- release governance read-only;
- compatibility contract read-only;
- ownership map read-only;
- extraction plan read-only;
- Enterprise Health come gate umano.

Parziale:

- audit retention ancora semplice;
- enforcement automatico assente;
- estrazione moduli non completata;
- update server dipende ancora da manifest/package/rollback configurati;
- alcuni moduli fisici sono ancora descrittivi.

Da non promettere:

- hardening automatico enterprise;
- release fully automated;
- rollback automatico;
- monolite già estratto;
- policy GDPR/data retention completa;
- update fleet autonomo.

## Regola Di Chiusura

Questa area e vendibile come:

> governance e preflight di release per Suite WordPress.

Non e vendibile come:

> DevOps enterprise fully automated o security appliance autonomo.
