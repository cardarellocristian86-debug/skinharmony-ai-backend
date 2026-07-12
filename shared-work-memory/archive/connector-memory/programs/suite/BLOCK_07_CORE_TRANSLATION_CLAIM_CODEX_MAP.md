# Suite Block 07 - Core Connector, Translation, Claim Guard, Codex Automation

Data lettura: 2026-05-24
Versione Suite rilevata: 5.2.37

## Scope Del Blocco

Questo blocco mappa il layer di governo tra Site Suite, SkinHarmony Core/Universal Core, traduzioni strutturate, Claim Guard e automazioni Codex.

File principali letti:

- `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
- `wordpress/plugins/skinharmony-site-suite/modules/skinharmony-core-connector/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/translation-manager/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/claim-guard/class-module.php`

## Ruolo Architetturale

Suite non deve duplicare il Core.

Ruoli corretti:

- Suite raccoglie, mostra, rende disponibili payload e azioni operative WordPress.
- SkinHarmony Core/Universal Core decide policy, rischio, claim, traduzione governata, publish safety e action mediation.
- Codex Automation usa chiavi scoped per lavorare sul nodo Suite senza ricevere accessi admin generici.
- Claim Guard in Suite resta adapter/fallback locale: legge superfici, segnala, propone review, ma non pubblica e non modifica da solo.

Formula stabile:

`Suite espone e applica. Core decide. Codex assiste. Owner conferma le azioni sensibili.`

## Core Connector

Modulo fisico:

- `modules/skinharmony-core-connector/class-module.php`

Stato reale:

- modulo metadata/read-only;
- runtime operativo nel monolite;
- endpoint REST e UI reali nel monolite;
- fallback Suite presente se Core non è configurato.

Endpoint dichiarati dal modulo:

- `/wp-json/shss/v1/waas-manager/skinharmony-core-connector`
- `/wp-json/shss/v1/waas-manager/skinharmony-core-connector/claim-guard-bridge`
- `/wp-json/shss/v1/waas-manager/skinharmony-core-connector/content-guard`
- `/wp-json/shss/v1/waas-manager/skinharmony-core-connector/action-gate`
- `/wp-json/shss/v1/waas-manager/skinharmony-core-connector/evidence`
- `/wp-json/shss/v1/waas-manager/control-plane`
- `/wp-json/shss/v1/waas-manager/connector-sdk`
- `/wp-json/shss/v1/waas-manager/runbook-marketplace/catalog-spec`
- `/wp-json/shss/v1/waas-manager/runbook-marketplace/preview`
- `/wp-json/shss/v1/waas-manager/runbook-marketplace/execute`

Funzioni monolite rilevanti:

- `get_skinharmony_core_connector_status()`
- `run_skinharmony_core_remote_probe()`
- `run_skinharmony_core_content_guard()`
- `evaluate_suite_action_with_core()`
- `run_skinharmony_core_decision()`
- `append_core_evidence_event()`
- `get_core_evidence_events()`
- `get_suite_claim_guard_bridge_contract()`

Modalità supportate:

- `standalone`
- `local_core`
- `remote_core`
- `hybrid`

Effective mode:

- `standalone_fallback`
- `local_core`
- `remote_core_ready`
- `hybrid`

Guardrail espliciti:

- Suite deve funzionare anche senza Core.
- Nessun hard block se Core manca.
- Nessun remote write automatico.
- Probe remoto manuale.
- Nessun override policy senza owner.
- Runbook execute ammesso solo come report, piano o bozza senza scritture esterne.

## Decisione Core

`run_skinharmony_core_decision()` chiama Core remoto su:

- `/v1/decision`

Payload Suite:

- `tenant_id`
- `brand_scope`
- `domain`
- `signals`
- `metadata.source = wordpress_site_suite`
- `context`

Risposta normalizzata da Suite:

- `state`
- `control_level`
- `risk_score`
- `confidence`
- `readiness_score`
- `risk_band`
- `recommended_action`
- `next_best_step`
- `can_execute`
- `requires_user_confirmation`
- `action_mediation`
- `blocking_reasons`

Action mediation supportata:

- `allow`
- `rewrite`
- `confirm`
- `defer`
- `sandbox`
- `block`
- `rollback_required`

Nota critica:

Suite non deve interpretare `confirm` come blocco brutale. `confirm` significa: preparare output, mostrare rischio, attendere owner. Solo `block` deve fermare l'azione.

## Evidence Layer

Suite salva evidence firmata localmente in:

- option `shss_core_evidence_events`

Ogni record contiene:

- id evento;
- data;
- event type;
- tenant id;
- brand scope;
- payload;
- firma HMAC SHA256.

Funzione:

- `append_core_evidence_event()`

Uso:

- lasciare prova di probe, action gate, content guard, runbook;
- non sostituisce audit remoto Core, ma crea evidenza locale verificabile.

## Claim Guard Bridge

Claim Guard in Suite è un adapter governato dal Core.

Contratto:

- `schema_version = suite_claim_guard_bridge_v1`
- `mode = core_governed_claim_guard_adapter`
- `fallback_mode = local_keyword_scan_review_required`
- `fallback_publish_safe = false`
- `automatic_content_change = false`
- `automatic_publish = false`
- `owner_confirmation_required = true`

Core branch dichiarati:

- `claim_guard`
- `publish_safety`
- `legal_soft_risk`
- `brand_voice`
- `marketing_copy`
- `content_localization_guard`

Superfici Suite:

- `waas_packages`
- `offer_card`
- `product_page`
- `crm_email`
- `proposal`
- `pricing_copy`
- `partner_distributor_content`
- `local_page`
- `template`

Guardrail:

- no claim medici o terapeutici;
- no garanzia risultato;
- no override prezzo/sconto;
- no publish safe quando Core manca;
- no pubblicazione automatica di rewrite;
- review operatore per warning.

## Claim Guard Locale

Modulo:

- `modules/claim-guard/class-module.php`

Stato reale:

- scanner locale read-only su pagine pubblicate;
- usa dizionario Core se presente;
- fallback con lista locale;
- non modifica contenuti;
- non pubblica;
- non blocca tutto automaticamente.

Dizionario Core cercato:

- `WP_PLUGIN_DIR/skinharmony-core/language-core/rules/forbidden-claims.json`

Fallback locale rileva termini come:

- `cura`
- `terapia`
- `guarigione`
- `medico`
- `clinico`
- `risultati garantiti`
- `dimagrimento garantito`
- `anti-cellulite garantito`
- `acne curata`
- `ricrescita garantita`
- `blocca la caduta`
- `detox clinico`
- `elimina la cellulite`

Ha un controllo semplice di contesto negato, ma non è giudizio semantico pieno.

Verità operativa:

Claim Guard locale serve a far emergere rischi e proporre correzioni/review. Il giudizio forte deve arrivare dal Core quando configurato.

## Content Guard Remoto

`run_skinharmony_core_content_guard()` chiama:

- `/v1/content-guard/check`

Payload:

- tenant;
- brand scope;
- source `Suite`;
- module;
- sector;
- text type;
- requested mode;
- language;
- domain;
- content/text;
- branch hints;
- guardrails.

Branch hints:

- `claim_guard`
- `publish_safety`
- `legal_soft_risk`
- `brand_voice`

Suite estrae:

- `publish_safe`
- `issue_count`
- response code;
- risposta raw.

Fallback:

- se Core non è configurato, `fallback_publish_safe=false` e `requires_review=true`.

## Translation Manager

Modulo:

- `modules/translation-manager/class-module.php`

Stato reale:

- snapshot read-only della memoria traduzioni;
- admin actions legacy dichiarate;
- generazione automatica solo come draft controllata;
- import/export CSV controllato;
- source language `it`;
- target language rilevata nel modulo fisico: `en`.

Option memoria:

- `sh_core_site_translations`

Metriche lette:

- pagine con memoria;
- lingue;
- totale item;
- draft;
- approved;
- aggiornamenti recenti.

## Structured Translation Payload

Suite espone stringhe atomiche, non HTML intero.

Endpoint:

- `/wp-json/shss/v1/translation/structured-payload`

Moduli iniziali:

- `sh_waas_packages`
- `sh_waas_offer`

Moduli registrati aggiunti:

- `sh_waas_template_gallery`
- `sh_waas_template_wizard`
- `sh_conversion_stack`
- `sh_technology_cards`
- `sh_trial_bridge`
- `sh_social_channels`

Ogni item contiene:

- `key_path`
- `source_text`
- `source_hash`
- `context`

Helper:

- `get_translation_payload($module_id)`
- `add_suite_translation_payload_item()`
- `get_suite_current_language()`
- `shss_translate_item()`
- `lookup_structured_translation_memory()`
- `enqueue_suite_translation_sync()`

Flusso corretto:

1. Suite costruisce payload di stringhe atomiche.
2. Core/traduttore governa memoria, review e runtime.
3. Suite renderizza usando lookup traduzione.
4. Se manca traduzione approvata, fallback italiano.

Stati traduzione accettati dal lookup:

- `approved`
- `runtime`
- `published`
- `ready`

## Codex Automation Keys

Pagina admin:

- `Codex Automation`

Funzioni:

- `render_codex_automation_admin()`
- `handle_generate_codex_automation_key()`
- `handle_revoke_codex_automation_key()`
- `rest_generate_codex_automation_key()`
- `rest_revoke_codex_automation_key()`
- `rest_codex_automation_status()`
- `rest_codex_automation_runbook()`

Endpoint:

- `GET /wp-json/shss/v1/automation/codex/status`
- `POST /wp-json/shss/v1/automation/codex/runbook`
- `POST /wp-json/shss/v1/automation/codex/generate-key`
- `POST /wp-json/shss/v1/automation/codex/revoke-key`

Header supportati:

- `X-SkinHarmony-Codex-Key`
- `Authorization: Bearer TOKEN`

Scopo:

- permettere a Codex/automazioni autorizzate di lavorare sul nodo Suite senza accessi admin generici.

Non è la chiave Universal Core/provider:

- le API key Universal Core e setup token provider restano in Core Admin.

Runbook operations mappate:

- `health_check`
- `setup_client`
- `create_node_draft`
- `configure_waas`
- `generate_smartdesk_keys`
- `sync_translations`
- `impact_review`
- `change_impact_review`
- `crm_import_preview`
- `read_orders`
- `read_inventory`
- `generate_proposal_draft`

Azioni bloccate:

- publish pubblico;
- hard block cliente;
- cattura pagamento;
- cancellazione distruttiva;
- cambio prezzi senza owner.

Ogni runbook deve leggere:

- change impact orchestration;
- stato corrente;
- scope e brand boundary;
- test richiesti;
- rollback;
- conferma owner.

## Stato Operativo Reale

Pronto:

- Core Connector UI/REST come contratto e fallback;
- Content Guard remoto se URL/API key sono configurati;
- Claim Guard locale come scanner review;
- Translation payload strutturato;
- Translation memory lookup;
- Evidence locale firmata;
- Codex Automation keys scoped per nodo Suite;
- Runbook Codex assistito e non distruttivo.

Parziale:

- modulo fisico Core Connector è descrittivo; runtime nel monolite;
- modulo Translation Manager è snapshot/read-only;
- Claim Guard locale non è semantic engine pieno;
- remote Core dipende da configurazione URL/API key;
- Codex Automation non deve sostituire Core Admin.

Non presente / non promesso:

- pubblicazione automatica sicura senza owner;
- traduzione completa autonoma di tutto l'HTML;
- claim legal certification automatica;
- decisione semantica piena se Core remoto non è collegato;
- sync mailbox o automazioni distruttive.

## Regola Di Evoluzione

Prima di aggiungere nuove automazioni Suite:

1. definire superficie e tenant/brand scope;
2. passare da Core decision/action mediation;
3. salvare evidence locale;
4. generare solo bozza/report/snapshot;
5. owner conferma pubblicazione, prezzi, pagamenti, hard block e sync esterni.

