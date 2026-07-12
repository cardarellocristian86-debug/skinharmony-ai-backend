# Suite Block 06 - Licenze, Update Server, Smart Desk Bridge, App Key Factory

Data mappatura: 2026-05-24

## Scopo Del Blocco

Questo blocco descrive il layer di vendita, attivazione e collegamento operativo della Suite: licenze WaaS, soft gate, checkout WooCommerce, update server, Smart Desk Bridge e generatore App Key per Smart Desk.

La logica corretta e: Suite e il super-tenant/provider. Genera contratti, licenze, chiavi, pacchetti e payload di governance; Smart Desk e il nodo operativo. Il collegamento deve avvenire per snapshot, policy e pulse, non copiando database interi o facendo sync automatici non governati.

## File Letti

- `wordpress/plugins/skinharmony-site-suite/modules/waas-licenses/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/update-server/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/smartdesk-bridge/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/license-renewals/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/core/class-shss-license-soft-gate.php`
- `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`

## Verita Architetturale

Il blocco e misto:

- `waas-licenses` e un modulo reale read-only per stato licenze, registry e governance.
- `update-server` e un modulo reale read-only per manifest/governance, ma la configurazione e il client update vivono nel monolite.
- `smartdesk-bridge` e un modulo reale read-only per stato/payload/governance, ma configure/test/manual-sync vivono nel monolite.
- App Key Factory, seat contracts, activation, config bundle e pulse sono nel monolite.
- License Soft Gate e un core leggero separato e funziona come warning/grace, non hard block.

Quindi oggi:

- licenze = operative con registry e verifica soft;
- update = manifest/checker manuale, non auto-install;
- Smart Desk Bridge = preview/manual sync governato;
- App Key Factory = reale e collegata a piani, seat limit, brand kit, infra e pulse;
- automazione distruttiva = spenta.

## Licenze WaaS

Modulo:

- `SHSS_Module_Waas_Licenses`
- runtime: `modular_readonly_waas_licenses_status`

REST modulari:

- `GET /wp-json/shss/v1/waas-manager/license`
- `GET /wp-json/shss/v1/waas-manager/license-registry`
- `GET /wp-json/shss/v1/waas-manager/license-governance`

REST monolite/legacy:

- `POST /wp-json/shss/v1/waas-manager/license-registry/add`
- `POST /wp-json/shss/v1/waas-manager/license-registry/generate`
- `POST /wp-json/shss/v1/waas-manager/license/verify`
- `GET /wp-json/shss/v1/waas-manager/license-fulfillment`
- `GET /wp-json/shss/v1/waas-manager/license-fulfillment/actions`

Admin:

- `shss-waas-license`
- `shss-waas-license-registry`
- `shss-waas-subscription-products`
- `shss-waas-module-gates`

Storage:

- `shss_waas_license_registry`
- opzioni licenza locale in `shss_settings`
- meta ordine WooCommerce per dominio/piano/ciclo/scope.

Policy:

- hard block disattivato;
- automatic disable non consentito;
- grace period 7 giorni;
- audit predisposto;
- private fields nascosti negli output;
- registry e generazione manuale sono monolite;
- pagamento -> licenza e monolite/WooCommerce hook.

## License Soft Gate

Core:

- `SHSS_License_Soft_Gate`

Regola:

- `license_enforcement_mode=soft_gate`
- `hard_block=false`
- `warn_and_recommend_action; do_not_disable_plugin_automatically`

Stati:

- `internal`
- `active`
- `trial`
- `blocked`
- `unknown`
- `grace`
- `expired`

Output:

- license status;
- severity;
- grace active/until;
- recommended action;
- audit event `license_soft_gate_evaluated` se disponibile.

Verita importante:

- anche se una licenza e scaduta/bloccata, il sistema non deve spegnere brutalmente il plugin;
- deve mostrare warning, rinnovo, contatto supporto, preview/soft gating.

## WooCommerce -> Licenza

Hook:

- `woocommerce_order_status_processing`
- `woocommerce_order_status_completed`
- `woocommerce_before_order_notes`
- `woocommerce_checkout_process`
- `woocommerce_checkout_create_order`

Funzioni:

- `maybe_create_waas_license_from_order($order_id)`
- `extract_waas_subscription_payload_from_order($order)`
- `render_waas_checkout_license_fields()`
- `validate_waas_checkout_license_fields()`
- `save_waas_checkout_license_fields()`

Rilevamento prodotto WaaS:

- SKU che inizia con `sh-waas`;
- nome contenente `waas`;
- meta `_shss_create_waas_license=yes`;
- Smart Desk escluso dal prodotto WaaS puro.

Payload:

- dominio;
- piano;
- ciclo mensile/annuale;
- durata mesi;
- plugin scope;
- source order id;
- payment status.

Comportamento:

- se dominio/payload valido, crea o rinnova licenza registry;
- salva meta ordine:
  - `_shss_waas_license_created`
  - `_shss_waas_license_hash`
  - `_shss_waas_license_action`
- invia email admin e cliente se disponibile;
- non inventa piano/prezzo se il prodotto non lo dichiara.

## Update Server

Modulo:

- `SHSS_Module_Update_Server`
- runtime: `modular_readonly_update_server_status`

Admin:

- `shss-waas-update-server`

REST:

- `GET /wp-json/shss/v1/waas-manager/update-manifest`
- `POST /wp-json/shss/v1/waas-manager/update-server/configure`

Funzioni monolite:

- `get_waas_update_manifest()`
- `get_waas_update_server_status()`
- `build_waas_manifest_integrity_policy()`
- `build_waas_release_package_policy()`
- `build_waas_recovery_policy()`
- `get_waas_update_governance_status()`
- `build_waas_live_deployment_gate()`
- `fetch_waas_remote_update_manifest()`
- `filter_waas_plugin_updates()`
- `filter_waas_plugin_info()`
- `handle_save_waas_update_server()`

Manifest:

- plugin/name/channel/stable version;
- package URL;
- rollback URL;
- requires WP/PHP;
- changelog;
- integrity policy;
- release package policy;
- recovery policy.

Integrity:

- `local_manifest_integrity_v1`;
- manifest SHA256;
- HMAC-SHA256 signature;
- package checksum required;
- rollback checksum required se rollback URL presente.

Client update:

- checker cliente opzionale;
- legge manifest remoto;
- popola transient update WordPress se versione remota maggiore;
- mostra plugin info/changelog;
- non installa automaticamente.

Policy update:

- no automatic install;
- no automatic rollback;
- no self-heal automatico;
- canary manuale;
- rollback URL richiesto prima dei clienti;
- live gate controlla homepage/admin HTTP, stable/package/rollback/recovery.

## Smart Desk Bridge

Modulo:

- `SHSS_Module_Smartdesk_Bridge`
- runtime: `modular_readonly_smartdesk_bridge_status`

Admin:

- `shss-waas-smartdesk-bridge`

REST:

- `GET /wp-json/shss/v1/waas-manager/smartdesk-bridge`
- `POST /wp-json/shss/v1/waas-manager/smartdesk-bridge/configure`
- `GET /wp-json/shss/v1/waas-manager/smartdesk-bridge/payloads`
- `GET /wp-json/shss/v1/waas-manager/smartdesk-bridge/governance`
- `GET /wp-json/shss/v1/waas-manager/smartdesk-bridge/test`
- `POST /wp-json/shss/v1/waas-manager/smartdesk-bridge/manual-sync`

Stati:

- `disabled`
- `not_configured`
- `api_key_required`
- `configured_not_verified`
- `connected_preview`
- `ready_preview`
- `manual_sync_ready`

Payload:

- leads aperti con email mascherata/hash;
- ordini tecnologie minimizzati, nessun dato carta;
- stats sito: versione, lead, ordini, claim issues, price issues, onboarding, pagine commerciali.

Governance:

- privacy review richiesta;
- conferma operatore richiesta;
- automatic sync spento;
- automatic push spento;
- automatic customer/order sync spenti;
- sync manuale solo se endpoint, API key, test e Core sono favorevoli.

Manual sync:

- richiede `owner_confirmed`;
- richiede bridge configurato;
- richiede `manual_sync_ready` o `manual_sync_governed`;
- se Core restituisce blocked/protection+confirm, blocca;
- prepara package con suite snapshot, payloads e decisione;
- se `dry_run`, non invia;
- se non dry-run, fa POST all'endpoint Smart Desk con bearer/API key;
- salva `shss_waas_smartdesk_bridge_last_sync`;
- registra audit `smartdesk_bridge_manual_sync`.

## App Key Factory Smart Desk

Admin:

- `shss-smartdesk-app-keys`

REST:

- `GET /wp-json/shss/v1/waas-manager/smartdesk-app-key-factory`
- `POST /wp-json/shss/v1/waas-manager/smartdesk-app-key-factory/generate`
- `POST /wp-json/shss/v1/waas-manager/smartdesk-app-key-factory/activate`
- `POST /wp-json/shss/v1/waas-manager/smartdesk-app-key-factory/config-bundle`
- `POST /wp-json/shss/v1/waas-manager/smartdesk-app-key-factory/pulse`

Storage:

- `shss_smartdesk_app_keys`
- `shss_smartdesk_seat_contracts`

Funzioni:

- `generate_smartdesk_app_key_records()`
- `get_smartdesk_app_key_factory_status()`
- `build_smartdesk_config_bundle()`
- `rest_activate_smartdesk_app_key()`
- `rest_smartdesk_config_bundle()`
- `rest_receive_smartdesk_pulse()`

Formato chiave:

- `SHD-<PLAN>-<6>-<8>`

Record:

- app key hash;
- preview;
- account owner id/name;
- assigned center id/name;
- plan level;
- seat index/package;
- infra tier;
- dedicated infra URL;
- Smart Desk live/web URL;
- status;
- expiry;
- brand id/name;
- sector scope;
- brand kit;
- contract period/limit;
- local override policy;
- catalog policy;
- protocol policy;
- price policy mode;
- heartbeat/pulse.

Stati chiave:

- `available`
- `active`
- `assigned`
- `suspended`
- `expired`

## Seat Contracts

Handler:

- `handle_save_smartdesk_seat_contract()`

Contratto:

- account owner id/name;
- seat limit;
- period type `monthly` o `annual`;
- max plan;
- scadenza contratto;
- branding;
- local override policy;
- catalog policy;
- price policy mode.

Validazione:

- se contratto mancante, generazione owner/manuale consentita;
- se contratto scaduto, generazione bloccata;
- se piano richiesto supera max plan, bloccata;
- se count richiesto supera remaining seats del periodo, bloccata;
- usage calcolato sul periodo corrente mensile o annuale.

Questo chiude la logica richiesta:

- Cristian/owner puo vendere 10, 50, 100 Smart Desk;
- il cliente genera solo entro limite contratto;
- il limite e periodico mensile/annuale;
- App Key eredita piano, branding, policy e scadenza.

## Config Bundle Smart Desk

Endpoint:

- `POST /wp-json/shss/v1/waas-manager/smartdesk-app-key-factory/config-bundle`

Contenuto:

- piano e moduli attivi;
- owner e centro;
- branding:
  - logo;
  - nome brand;
  - primary color;
  - background color;
  - text color;
  - replace default logo;
- infrastruttura:
  - standard shared;
  - dedicated runtime;
  - Smart Desk live/web URL;
- governance:
  - local override policy;
  - catalog policy;
  - protocol policy;
  - price policy mode;
  - brand controls catalog;
  - center can modify;
  - owner confirmation required;
  - automatic write from Suite false;
- heartbeat endpoint e intervallo.

Regola:

- Suite invia policy/configurazione;
- Smart Desk manda heartbeat/pulse aggregato;
- niente dati carta;
- niente database intero.

## Pulse Smart Desk -> Suite

Endpoint:

- `POST /wp-json/shss/v1/waas-manager/smartdesk-app-key-factory/pulse`

Pulse consentito:

- appointments today;
- revenue today;
- currency;
- active staff;
- stock alerts;
- risk signals;
- health status;
- sent at.

Audit:

- `smartdesk_app_key_pulse_received`
- `pii_received=false`

## WooCommerce -> App Key

Funzioni:

- `maybe_generate_smartdesk_app_key_from_order()`
- `is_smartdesk_subscription_product()`

Rilevamento Smart Desk:

- SKU che inizia con `sh-smartdesk` o `smartdesk`;
- nome contenente `smart desk`;
- meta `_shss_generate_smartdesk_app_key=yes`.

Seat count:

- da meta prodotto `_shss_smartdesk_seats` moltiplicato per quantita;
- fallback quantita ordine.

Piano:

- meta prodotto `_shss_smartdesk_plan`;
- inferito da nome/SKU: enterprise, gold, silver, base.

Comportamento:

- genera App Key se seat count > 0 e limiti contratto rispettati;
- salva meta ordine:
  - `_shss_smartdesk_app_key_created`
  - `_shss_smartdesk_app_key_count`
  - `_shss_smartdesk_app_key_preview`
- invia chiavi al cliente via email una sola volta;
- invia preview a supporto;
- registra audit `smartdesk_app_keys_generated_from_order`.

## Confini Da Rispettare

Non promettere:

- update automatici aggressivi;
- rollback automatico;
- sync Smart Desk continuo;
- creazione cliente Smart Desk automatica senza consenso;
- invio dati sensibili o database completo;
- hard block brutale licenze;
- generazione illimitata chiavi se esiste contratto seats.

Promettere correttamente:

- license registry e soft gate;
- checkout -> licenza/App Key quando prodotto e meta sono corretti;
- seat limit mensile/annuale;
- branding Smart Desk controllato da config bundle;
- bridge preview/manual sync con owner confirmation e Core check;
- manifest update con firma/checksum policy;
- canary/rollback manuale documentato;
- pulse aggregato Smart Desk -> Suite.

## Debolezze Da Non Dimenticare

- Molta logica operativa vive ancora nel monolite.
- Moduli update/bridge/licenze sono prevalentemente read-only.
- Update server non e ancora un installer SaaS completo: e manifest/checker/canary manuale.
- Manual sync Smart Desk puo inviare pacchetto solo se configurato e confermato; non va usato come sync automatico.
- App Key Factory e forte, ma serve test end-to-end reale Smart Desk con activate/config-bundle/pulse.
- Email chiavi dipende dalla configurazione mail WordPress.
- Il cliente vede le chiavi una sola volta: serve processo supporto/rotazione chiaro.

## Verdetto

Il blocco 06 e gia una base vendibile come governance controllata:

- Suite puo vendere licenze, piani, seat e App Key.
- Smart Desk puo essere sbloccato con App Key e ricevere config bundle.
- Update Server puo esporre manifest firmato e checker controllato.
- Bridge Smart Desk puo lavorare in preview/manual sync con payload minimizzati.

Non e ancora vendibile come orchestrazione automatica piena senza supporto: la promessa corretta e "controllo, chiavi, soft gate, update manuale governato e bridge a consenso".

## Prossimo Blocco

Blocco 07:

- SkinHarmony Core Connector;
- traduzione strutturata;
- claim guard bridge;
- language autopilot;
- Core decision contract;
- Codex automation/API key.
