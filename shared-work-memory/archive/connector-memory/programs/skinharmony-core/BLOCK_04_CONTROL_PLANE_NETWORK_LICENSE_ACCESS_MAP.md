# SkinHarmony Core - Blocco 04

## Area Coperta

Questo blocco mappa il control plane del traduttore/Core:

- Universal Core Adapter locale;
- snapshot decisionale Language Core;
- Nyra advisory locale;
- rete/nodi/Suite connector;
- Smart Desk bridge;
- licenza SaaS;
- ruoli e permessi enterprise.

File verificati:

- `wordpress/plugins/skinharmony-core/includes/class-sh-core-universal-core-adapter.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-core-network-orchestrator.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-smartdesk-bridge.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-license.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-core-access.php`

## 1. Universal Core Adapter Locale

Classe:

- `SH_Core_Universal_Core_Adapter`

Ruolo:

- costruisce uno snapshot completo dello stato multilingua;
- aggrega integrity, queue, provider, SEO, review, network, Suite governance, Smart Desk bridge e licenza;
- produce decisione locale;
- produce advisory leggibile in stile Nyra;
- esporta/importa policy bundle;
- esporta activity log in JSON/CSV.

Route principali:

- `GET /sh-core/v1/language-core/snapshot`
- `GET /sh-core/v1/language-core/decision`
- `GET /sh-core/v1/language-core/nyra-advisory`
- `GET /sh-core/v1/language-core/page-status`
- `GET /sh-core/v1/language-core/activity`
- `GET /sh-core/v1/language-core/activity-export`
- `GET /sh-core/v1/language-core/policy-bundle`
- `POST /sh-core/v1/language-core/policy-bundle`

Snapshot include:

- `site_readiness`
- `content_status`
- `seo_status`
- `software_catalog_status`
- `network_status`
- `suite_governance`
- `safety_status`
- `queue_status`
- `provider_status`
- `governance_analytics`
- `decision`

Decisione locale:

- calcola rischio da stringhe mancanti, review pendenti, SEO mancante e job falliti;
- considera review critiche come blocker;
- legge segnali Suite Claim Guard e Pricing Guard se disponibili;
- valuta readiness rete/control plane;
- restituisce:
  - `readiness`
  - `risk_level`
  - `confidence`
  - `can_publish`
  - `owner_confirmation_required`
  - `blockers`
  - `warnings`
  - `next_best_action`
  - `bridge_status`
  - `license_status`

Regola operativa:

- questo adapter non sostituisce Universal Core su Render;
- e un layer locale di snapshot, diagnosi e fallback;
- quando Core remoto e configurato, il giudizio vendibile deve passare dal servizio centrale.

## 2. Nyra Advisory Locale

Metodo:

- `build_nyra_advisory()`

Ruolo:

- traduce lo snapshot tecnico in spiegazione operativa;
- dice cosa succede, cosa blocca, cosa fare prima, cosa ignorare;
- segnala rischi e opportunita;
- indica se serve azione owner.

Output:

- `summary`
- `what_is_happening`
- `what_is_blocked`
- `what_to_do_first`
- `what_to_ignore_now`
- `risks`
- `opportunities`
- `owner_action_required`

Regola operativa:

- Nyra spiega e ordina;
- Core decide;
- l'utente/owner conferma le azioni sensibili.

## 3. Network Orchestrator

Classe:

- `SH_Core_Network_Orchestrator`

Ruolo:

- registra nodi Core/Suite/WordPress;
- esporta/importa network bundle;
- sincronizza Suite locale o remota;
- legge claim/pricing guard da Suite;
- mantiene log sync rete;
- espone stato connector.

Route principali:

- `GET /sh-core/v1/network/connector-status`
- `GET /sh-core/v1/network/nodes`
- `POST /sh-core/v1/network/nodes`
- `GET /sh-core/v1/network/bundle`
- `POST /sh-core/v1/network/import-bundle`
- `POST /sh-core/v1/network/sync-suite`

Chiave rete:

- header principale: `X-SkinHarmony-Core-Key`
- fallback: `X-SkinHarmony-Bridge-Key`
- parametro fallback: `api_key`
- fonte chiave:
  1. env `SH_CORE_NETWORK_API_KEY`;
  2. costante wp-config `SH_CORE_NETWORK_API_KEY`;
  3. setting `network_api_key`.

Suite bundle:

- route Suite attesa: `/wp-json/shss/v1/translations/core-bundle`
- modalita:
  - `local_suite`
  - `remote_suite`
  - `hybrid`
  - `wordpress_only`

Sync Suite:

- se Suite locale e disponibile, chiama `rest_skinharmony_core_bundle`;
- se remota, usa `suite_remote_url` + `suite_connector_api_key`;
- importa connector, claim guard, pricing guard e structured modules;
- registra nodo in `sh_core_network_nodes`;
- scrive eventi in `sh_core_network_sync_log`.

Cron/scheduler:

- se `auto_sync_enabled` e attivo e Suite ha queue `queued_for_core`, programma `sh_core_process_suite_sync_queue`.

Regola operativa:

- il network connector serve a non duplicare testo/claim/prezzi tra Suite e Core;
- il nodo remoto deve usare API key scoped;
- il sync non deve esporre dati tra tenant non autorizzati.

## 4. Smart Desk Bridge

Classe:

- `SH_Core_SmartDesk_Bridge`

Ruolo:

- verifica se Smart Desk e configurato/raggiungibile;
- testa URL e chiave;
- restituisce stato per dashboard e decisione locale.

Route principali:

- `GET /sh-core/v1/smartdesk-bridge/status`
- `POST /sh-core/v1/smartdesk-bridge/test`

Probe:

- `/api/health`
- `/health`
- `/login`
- `/`

Header usati:

- `Authorization: Bearer <key>`
- `X-API-Key`
- `X-SkinHarmony-Bridge-Key`

Stati:

- `inactive`
- `ok`
- `error`

Regola operativa:

- il bridge misura reachability;
- non sincronizza database Smart Desk;
- eventuali dati operativi devono restare aggregati/scoped e passare da API dedicate.

## 5. Licenza Core

Classe:

- `SH_Core_License`

Ruolo:

- distingue uso interno da uso SaaS;
- verifica licenza contro server esterno;
- cache verifica per 6 ore;
- espone stato a snapshot/decisione.

Route principali:

- `GET /sh-core/v1/license/status`
- `POST /sh-core/v1/license/verify`

Modalita:

- `internal`: sempre attivo per uso SkinHarmony interno;
- `saas`: richiede `license_key` e `license_server_url`.

Payload verifica:

- `license_key`
- `domain`
- `plugin = skinharmony-core`
- `version = SH_CORE_VERSION`

Output normalizzato:

- `active`
- `valid`
- `plan`
- `state`
- `domain`
- `payment_state`
- `expires_at`
- `billing_cycle`
- `blocking_enabled`
- `recommended_client_action`
- `message`

Regola operativa:

- oggi il blocco licenza e soft;
- `blocking_enabled` viene letto dal server ma non deve diventare blocco brutale senza UX chiara;
- per vendere serve server licenze stabile e documentato.

## 6. Accesso Enterprise

Classe:

- `SH_Core_Access`

Ruolo:

- crea capability dedicate;
- assegna profili enterprise a utenti WordPress;
- separa dashboard, activity, review, approve, publish, operations e settings.

Capability:

- `sh_core_view_dashboard`
- `sh_core_view_activity`
- `sh_core_review_items`
- `sh_core_approve_items`
- `sh_core_publish_items`
- `sh_core_run_operations`
- `sh_core_manage_settings`

Profili:

- `sh_core_translator`
- `sh_core_reviewer`
- `sh_core_approver`
- `sh_core_publisher`
- `sh_core_compliance_officer`
- `sh_core_regional_manager`
- `sh_core_distributor`

Route principali:

- `GET /sh-core/v1/roles/users`
- `POST /sh-core/v1/roles/assign`

Regola operativa:

- admin WordPress mantiene accesso pieno;
- gli altri utenti devono ricevere capability specifiche;
- publish e operation non devono essere concessi a profili lettura/review.

## Flusso Control Plane

1. Il plugin legge stato locale: contenuti, queue, review, SEO, provider.
2. Network Orchestrator legge Suite locale/remota e nodi.
3. Smart Desk Bridge verifica raggiungibilita del gestionale.
4. License legge stato commerciale/abbonamento.
5. Adapter costruisce snapshot e decisione.
6. Nyra advisory spiega la priorita.
7. Se serve sincronizzazione esterna, si usa network API key o Universal Core remoto.

## Cosa E Gia Operativo

- Snapshot/decision/advisory locale.
- Export/import policy bundle.
- Activity export JSON/CSV.
- Network nodes e bundle.
- Sync Suite locale/remoto.
- Smart Desk reachability test.
- Stato licenza internal/saas.
- Profili WordPress enterprise per traduzione/review/pubblicazione.

## Cosa Resta Da Validare Live

- Che la Network API key sia sempre configurata fuori da UI pubbliche quando il nodo e vendibile.
- Che Suite sync non esponga payload tra brand/tenant diversi.
- Che Smart Desk bridge sia chiaro: reachability non significa sync operativo completo.
- Che il server licenze risponda con schema stabile.
- Che ruoli non-admin possano usare solo le route previste.
- Che Universal Core remoto resti fonte decisionale primaria quando attivo.

