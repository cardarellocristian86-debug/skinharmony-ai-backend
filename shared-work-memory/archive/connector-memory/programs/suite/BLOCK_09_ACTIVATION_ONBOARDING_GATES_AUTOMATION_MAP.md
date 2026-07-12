# Suite Block 09 - Activation, Onboarding, Project Builder, Trial Bridge, Gates, Daily Automation

Data lettura: 2026-05-24
Versione Suite rilevata: 5.2.37

## Scope Del Blocco

Questo blocco mappa la parte che trasforma un lead/offerta in progetto operativo WaaS: onboarding, project builder, trial Smart Desk, module gates, dashboard WaaS e automazioni giornaliere.

File principali letti:

- `wordpress/plugins/skinharmony-site-suite/modules/waas-engine/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/waas-onboarding/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/waas-projects/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/waas-gates/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/trial-bridge/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/daily-automation/class-module.php`

## Tesi Operativa

Suite ha già la struttura di activation pipeline, ma non deve essere letta come provisioning automatico completo.

Oggi fa bene:

- raccoglie dati cliente;
- valuta readiness;
- prepara proposte;
- prepara bozze;
- mostra moduli inclusi/upgrade;
- registra richieste trial;
- segnala blocker;
- genera dashboard multi-sito preview.

Non deve promettere ancora:

- creazione automatica sito live;
- checkout automatico;
- pubblicazione automatica;
- provisioning remoto completo;
- sync operativo multi-sito automatico.

## WaaS Engine

Modulo:

- `modules/waas-engine/class-module.php`

Endpoint:

- `GET /wp-json/shss/v1/waas-manager/status`
- `GET /wp-json/shss/v1/waas-manager/dashboard`

Admin pages:

- `shss-waas-control-room`
- `shss-waas-manager`
- `shss-waas-dashboard`

Runtime:

- `modular_readonly_waas_engine_status`
- endpoint read-only modulari.

Readiness locale:

- Site Suite attiva;
- WooCommerce disponibile;
- email lead configurata;
- endpoint trial Smart Desk configurato;
- registro licenze con record;
- onboarding almeno 70%;
- almeno un progetto registrato.

Dashboard multi-sito:

- legge sito locale;
- legge domini da registro licenze;
- mostra siti remoti come `pending_remote_bridge`;
- non sincronizza metriche remote.

Plugin rilevati:

- SkinHarmony Core;
- SkinHarmony Site Suite;
- WooCommerce;
- Nexi XPay;
- AI Engine.

Verità:

Il WaaS Engine è un control/readiness layer, non provisioning runtime completo.

## WaaS Onboarding

Modulo:

- `modules/waas-onboarding/class-module.php`

Endpoint:

- `GET /wp-json/shss/v1/waas-manager/onboarding`

Storage:

- option `shss_waas_onboarding`

Campi richiesti:

- company_name;
- sector;
- email;
- domain;
- legal_data;
- products_services;
- payment_method.

Altri campi:

- template_id;
- phone;
- primary_color;
- notes;
- updated_at.

Completion:

- percentuale calcolata sui campi richiesti.
- pronto per template generation a 70% o più.

Template consigliato:

- `distributor_catalog` per distributori/rivenditori;
- `factory_orders` per fabbrica/produzione/ricambi;
- `services_consulting` per consulenza/servizi;
- `lead_generation` per lead/campagne;
- default `technology_products`.

Policy:

- non salva automaticamente dal modulo;
- non genera template automaticamente;
- non pubblica;
- non attiva checkout;
- richiede review manuale;
- richiede approvazione cliente;
- no prezzi inventati;
- no claim medici/terapeutici.

## WaaS Projects

Modulo:

- `modules/waas-projects/class-module.php`

Endpoint:

- `GET /wp-json/shss/v1/waas-manager/projects`

Route dichiarate:

- `/waas-manager/projects`
- `/waas-manager/projects/save`
- `/waas-manager/projects/from-lead`

Storage:

- option `shss_waas_projects`

Project fields:

- project_id;
- project_name;
- customer_name;
- contact_email;
- domain;
- sector;
- project_type;
- partner_model;
- template_id;
- payment_flow;
- content_status;
- legal_status;
- checkout_status;
- bridge_required;
- project_status;
- source_lead_id.

Project types:

- `auto`;
- `check`;
- `launch`;
- `commerce`;
- `catalog`;
- `lead_funnel`;
- `operating_layer`.

Partner model:

- `network` = standard;
- `powered` = eccezione controllata.

Payment flow:

- `quote_first`;
- `card_after_quote`;
- `deposit_balance`;
- `subscription_later`;
- `none_yet`.

Readiness states:

- `missing`;
- `partial`;
- `ready`;
- `to_review`.

Checkout states:

- `not_ready`;
- `quote_only`;
- `ready_after_quote`;
- `active`.

Project statuses:

- intake;
- proposal;
- waiting_client;
- drafting;
- review;
- ready_to_publish;
- live;
- blocked.

Valutazione:

- blocca se mancano dati essenziali o score basso;
- `proposal_ready` se dati minimi cliente/settore presenti;
- `draft_ready` se contenuti e legalità sono abbastanza pronti;
- checkout spento finché proposta e condizioni non sono confermate.

Policy:

- il modulo non salva progetti;
- non converte lead automaticamente;
- non crea siti;
- non genera template;
- non pubblica.

## Trial Bridge

Modulo:

- `modules/trial-bridge/class-module.php`

Shortcode:

- `[sh_trial_bridge]`

Ruolo:

- form trial Smart Desk;
- usa lo stesso submit handler legacy dei lead;
- imposta `interest = smartdesk_trial`;
- imposta `is_trial = yes`.

Campi:

- nome centro;
- referente;
- azienda/centro;
- partita IVA;
- email;
- conferma email;
- tipo attività;
- username Smart Desk;
- password Smart Desk;
- telefono;
- messaggio;
- privacy consent;
- policy consent;
- marketing consent.

Business model:

- estetica;
- hair;
- barber;
- spa/wellness;
- medicina estetica/studio;
- altro.

Regola:

Trial Bridge raccoglie richiesta trial, non crea automaticamente account live se non esiste handler autorizzato a valle.

## WaaS Module Gates

Modulo:

- `modules/waas-gates/class-module.php`

Shortcode:

- `[sh_waas_module_gate]`

Endpoint:

- `GET /wp-json/shss/v1/waas-manager/module-gates`
- `GET /wp-json/shss/v1/waas-manager/gate-retrofit`

Principio:

- soft gate;
- preview/upgrade;
- moduli visibili;
- hard block spento.

Piani/rank:

- `none` 0;
- `base` 1;
- `silver`/`pro` 2;
- `gold` 3;
- `waas` 4;
- `internal` 5.

Stati accesso:

- `included`;
- `preview_upgrade`;
- `blocked_by_license`.

Nota:

Anche `blocked_by_license` non è hard block brutale: mostra avviso/rinnovo.

Modulo gate definitions:

- base: dashboard, lead, e-commerce tecnologie/prodotti, Google Ads, Claim/Price Guard, social/powered by;
- silver/pro: template, onboarding, project builder, commercial, analytics;
- gold: CRM B2B, B2B bridge, commerce policy, price list, brand governance, DAM, reputation, upsell, Smart Desk Bridge, AI assistant;
- waas: warehouse barcode, fulfillment, settlements, renewals, registry, update server, multi-site dashboard.

Retrofit:

- legge target commercial pages/template manifest;
- segnala `already_gated`, `needs_gate`, `missing`;
- non modifica pagine automaticamente.

## Daily Automation

Modulo:

- `modules/daily-automation/class-module.php`

Cron hook:

- `shss_daily_automation`

Endpoint dichiarato:

- `/wp-json/shss/v1/run-daily-automation`

Storage:

- `shss_last_daily_report`
- `shss_last_waas_license_reminders`

Stato:

- modulo read-only;
- non avvia run da sé;
- non invia email da sé;
- non scrive report da sé.

Snapshot:

- daily report enabled;
- email lead configurata;
- next run;
- last report disponibile;
- license reminder disponibile.

## Cosa È Operativo

- Readiness WaaS locale.
- Dashboard multi-sito preview dal registry licenze.
- Onboarding snapshot e raccomandazione template.
- Project queue e stage progetto.
- Trial Bridge form.
- Soft gates moduli.
- Retrofit gate read-only.
- Daily automation status.

## Cosa È Parziale

- Save/configure/project conversion vivono nel monolite.
- Multi-sito è preview: metriche remote non sincronizzate.
- Trial non è provisioning live completo.
- Gates non applicano retrofit automatico.
- Daily automation status non equivale a motore scheduler autonomo completo.

## Cosa Non Va Promesso

- “crea sito live da solo”;
- “converte lead e pubblica automaticamente”;
- “attiva checkout automaticamente”;
- “multi-tenant remoto già sincronizzato”;
- “trial Smart Desk creato sempre in tempo reale”;
- “moduli bloccati duramente”.

## Regola Di Evoluzione

Prima di dichiarare activation pipeline enterprise:

1. creare almeno un progetto reale/demo;
2. collegare lead -> proposta -> progetto -> bozza;
3. chiudere onboarding a 70%+;
4. verificare page quality;
5. mantenere checkout quote-first;
6. salvare report/evidence;
7. owner conferma go-live.

