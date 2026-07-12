# Suite Block 05 - Template, Page Factory, Site Clone Engine

Data mappatura: 2026-05-24

## Scopo Del Blocco

Questo blocco descrive la parte di SkinHarmony Site Suite che serve a creare siti, pagine, template WaaS, pacchetti importabili e bozze di clonazione sito.

La funzione corretta non e "creare pagine a caso". La Suite deve partire da template approvati, mantenere struttura e CSS, adattare contenuti reali, lasciare tutto in bozza, passare da Core per claim/prezzi/pubblicazione e richiedere conferma owner prima del live.

## File Letti

- `wordpress/plugins/skinharmony-site-suite/modules/waas-templates/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/template-design-system/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/templates/registry/suite-template-registry.json`
- `wordpress/plugins/skinharmony-site-suite/templates/README.md`
- `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`

## Verita Architetturale

Il blocco template e ibrido:

- `waas-templates` e un modulo reale per shortcodes e REST read-only del catalogo.
- `template-design-system` e un modulo read-only: descrive token, blueprint e policy, ma non scrive CSS o tema.
- Il registry JSON e la fonte strutturata dei template, componenti, token, CTA e publish policy.
- La creazione pagine, export/import package, editor builder, site clone intake, preview e draft vivono ancora nel monolite.

Quindi oggi la verita e:

- catalogo template pubblico = modulo + monolite;
- template registry = file JSON strutturato;
- design system = contratto read-only;
- generazione/import/draft = monolite operativo;
- pubblicazione = sempre manuale.

## Template Registry

Registry:

- `schema_version`: `suite_template_registry_v1`
- `render_owner`: `wordpress_plugin`
- `decision_owner`: `universal_core`
- `status`: `active`

Policy publish:

- nessuna pubblicazione automatica;
- bozza prima;
- conferma owner obbligatoria;
- evidenza visuale obbligatoria;
- rollback richiesto.

Componenti ammessi:

- classi con prefisso `shss-`, `sh-`, `sh-pf-`, `sh-smartdesk-`, `wp-block-`;
- inline style non ammessi;
- tag `<style>` nel contenuto non ammessi;
- componenti registrati: hero, master hero, layout WaaS, premium card grid, target chain, proof band, CTA band, lead bridge, product grid, template gallery.

Brand tokens principali:

- primary `#6bbbd8`
- accent `#4fb6d6`
- surface `#f5fbfd`
- text `#53606b`

CTA approvate:

- `Richiedi proposta` -> `/contatti/`
- `Richiedi analisi` -> `/richiedi-analisi/`
- `Richiedi offerta` -> `/richiedi-offerta-prodotti/`
- `Diventa partner` -> `/attiva-partner/`

Template verificati nel registry:

- template operativi generici: tecnologia/prodotti, distributori, factory orders, consulting, lead generation, hospitality, retail, academy, professional safe, network partner;
- template commerce/luxury: luxury home, luxury collection, luxury product detail, luxury cart, beauty commerce source architecture, beauty showcase studio;
- master SkinHarmony: `skinharmony_home_master`, `skinharmony_waas_master`, con evidence visuale desktop/tablet/mobile nel registry.

## Modulo Waas Templates

Modulo:

- `SHSS_Module_Waas_Templates`
- runtime: `modular_shortcode_renderer_with_readonly_waas_template_manifest`
- endpoint reale: `GET /wp-json/shss/v1/waas-manager/templates`

Shortcodes registrati:

- `[sh_waas_template_gallery]`
- `[sh_waas_template_wizard]`
- `[sh_waas_template_preview]`

Policy dichiarata:

- `automatic_page_creation=false`
- `automatic_import=false`
- `automatic_publication=false`
- `contains_customer_data=false`
- import target `draft`
- review manuale obbligatoria;
- no prezzi inventati;
- no claim medici/terapeutici;
- approvazione cliente prima del publish.

Nota importante:

- il modulo dichiara anche route generate/package/import nella health, ma nel modulo fisico registra solo `/templates`;
- generate/package/import sono implementati nel monolite.

## Modulo Template Design System

Modulo:

- `SHSS_Module_Template_Design_System`
- runtime: `modular_readonly_template_design_system`
- nessun init operativo, nessun REST proprio, nessuno shortcode proprio.

Token:

- `primary_color`
- `accent_color`
- `surface_color`
- `font_family`
- `border_radius`
- `cta_style`

Blueprint:

- `professional-clean`
- `commercial-bold`
- `industrial-technical`
- `network-enterprise`
- `local-premium`

Policy:

- preview visuale e draft only;
- non cambia tema attivo;
- non sovrascrive CSS cliente;
- non pubblica template;
- non inventa prezzi;
- non usa claim medici o terapeutici;
- il brand cliente deve essere primo segnale;
- SkinHarmony resta powered-by dove previsto.

## Admin UI Template WaaS

Pagina:

- `render_waas_templates_admin()`

Funzioni visibili:

- catalogo template;
- family templates;
- preset grafico controllato;
- colori, asset hero/logo/gallery, CTA e link target;
- Template Clone Validation;
- workflow operativo da template madre a publish manuale;
- export/import package;
- apertura editor template;
- evidenza prossimi step dopo generazione.

Regola UX:

- il pannello dichiara esplicitamente che le pagine sono create in bozza, poi adattate e approvate prima del live.

## Preset Grafici

Handler:

- `handle_save_waas_template_design_preset()`

Storage:

- `shss_waas_template_design_presets`

Campi:

- project key/label;
- primary/accent/surface/text color;
- hero/logo/gallery/detail asset URL;
- primary CTA;
- primary/secondary/collection/product/cart target URL.

Limite:

- salva token e asset per bozze successive;
- non pubblica;
- non modifica tema;
- non garantisce da solo qualita visuale: serve render/screenshot/check.

## Generazione Template Pagine

Handler/admin:

- `handle_generate_waas_template()`
- `handle_save_waas_template()`

REST:

- `rest_generate_waas_template()`

Motore:

- `create_waas_template_pages($template_id, $project_key)`

Comportamento:

- cerca template nel manifest;
- per ogni pagina del template controlla se lo slug esiste;
- se esiste, adotta/hydrata metadata e sincronizza dal source;
- se non esiste, crea pagina WordPress `draft`;
- salva meta:
  - `_shss_waas_template_id`
  - `_shss_waas_project_key`
  - `_shss_waas_template_gate_module`
  - `_shss_waas_generated_by`
  - `_shss_waas_template_source_hash`
- attacca contratto qualita pagina tramite `attach_suite_page_quality_contract()`.

Output:

- `post_status=draft`;
- `publishes_automatically=false`;
- lista pagine create, adottate, saltate o in errore.

## Template Package Export Import

REST:

- `GET /wp-json/shss/v1/waas-manager/templates/package?template_id=...`
- `POST /wp-json/shss/v1/waas-manager/templates/import`

Motori:

- `build_waas_template_package($template_id)`
- `import_waas_template_package($package)`

Export:

- schema `waas_template_package_v1`;
- include template, design profile, gate module, required modules, enterprise layers e pagine;
- `license_required=true`;
- `contains_customer_data=false`;
- `publishes_automatically=false`;
- `import_target_status=draft`;
- `requires_manual_review=true`.

Import:

- rifiuta package non validi;
- rifiuta package con dati cliente, publish automatico o target diverso da draft;
- crea solo pagine bozza;
- se pagina esiste, salta;
- salva meta template/package;
- attacca contratto qualita pagina.

Questo e importante per vendita e nodi:

- Suite puo spostare blueprint e pagine tra installazioni autorizzate;
- non deve diventare un sistema di pubblicazione cieca;
- ogni import resta in staging/bozza con revisione manuale.

## Site Clone Engine

Intake:

- `handle_save_site_clone_intake()`
- `save_suite_site_clone_intake_record()`

Preview:

- `handle_generate_site_clone_preview()`
- `generate_suite_site_clone_preview($clone_id)`

Draft:

- `handle_create_site_clone_draft()`
- `create_suite_site_clone_draft($clone_id)`

Storage:

- `shss_site_clone_previews`
- intake site clone in option dedicata del monolite.

Campi intake importanti:

- source site/page URL;
- product family;
- source type;
- operator mode;
- page type;
- sector pack;
- brand tier;
- positioning mode;
- competitor research mode;
- mother site imprint mode;
- brand expression mode;
- narrative mode;
- science visibility;
- sales ceremony level;
- language guard mode;
- technology fields;
- clone fidelity;
- layout architecture;
- full width requirement;
- visual density;
- approved shell family;
- automation mode;
- target language;
- template id.

Preview:

- costruisce HTML preview locale;
- calcola titolo display;
- valuta linguaggio pubblico cliente;
- salva:
  - `public_language_status`
  - termini rilevati;
  - issue count;
  - semantic issues;
  - semantic summary;
  - lane selezionata;
  - elapsed ms.

Draft:

- usa preview esistente o la genera;
- crea/aggiorna pagina WordPress in `draft`;
- salva meta:
  - `_shss_clone_engine_id`
  - `_shss_clone_engine_lane`
  - `_shss_clone_engine_source`
- non pubblica.

Limite reale:

- il clone engine non clona automaticamente un sito esterno completo via scraping/runtime;
- e un workflow guidato che usa URL sorgente, scenario, template, preview e draft controllato.

## Template Clone Validation

Funzione:

- `get_suite_template_clone_validation_status()`

Endpoint:

- `GET /wp-json/shss/v1/waas-manager/template-clone-validation`

Controlli:

- template sorgente dichiarato;
- clone completo layout/CSS;
- contenuti adattati al cliente;
- Core check obbligatorio;
- rendering responsive richiesto;
- pubblicazione solo manuale;
- memoria condivisa/handoff aggiornati.

Stato attuale:

- il check responsive/rendering e volutamente non OK finche non esiste evidenza visuale desktop/mobile;
- quindi il sistema e prudente: puo creare bozze, ma non deve essere considerato pronto per demo cliente senza screenshot/render.

Sequenza obbligatoria:

1. template source;
2. full clone layout/css;
3. adapt content;
4. Core check;
5. responsive rendering check;
6. manual publish.

Output bloccati:

- pagina manuale da zero;
- auto publish;
- prezzo inventato;
- claim medico/garantito;
- layout senza template sorgente.

Evidenze minime:

- source template id;
- summary dei contenuti cambiati;
- verdict Core;
- desktop/mobile render check;
- overflow check;
- CTA link check;
- conferma owner;
- event/handoff in memoria condivisa.

## Template Clone Workflow

Funzione:

- `get_suite_template_clone_workflow_status()`

Endpoint:

- `GET /wp-json/shss/v1/waas-manager/template-clone-workflow`

Step:

1. Template sorgente.
2. Clone layout/CSS.
3. Adattamento contenuti.
4. Core check.
5. Rendering visuale.
6. Conferma owner / publish.

Regola:

- nessuna scorciatoia;
- niente pagina da zero senza template;
- niente publish senza Core check;
- niente prezzi non ufficiali;
- niente claim medici o garantiti.

## Page Quality Contract

Policy:

- `get_suite_public_page_quality_policy()`

Analisi:

- `analyze_suite_public_page_quality($content, $context)`

Attach:

- `attach_suite_page_quality_contract($post_id, $source, $content, $context)`

Metriche controllate:

- word count;
- section count;
- H2/H3 count;
- CTA count;
- media count;
- style blocks;
- brand palette;
- Suite metadata;
- meta description.

Soglie:

- pubblica Suite-generated/managed: minimo 750 parole;
- pubblica manuale/legacy: minimo 520 parole come blocco, 750 come target premium;
- transazionale/checkout: soglie transazionali minime, non landing page lunga;
- bozza: minimo 520 parole;
- minimo 6 sezioni;
- minimo 4 H2;
- minimo 2 CTA;
- meta description pubblica almeno 90 caratteri e diversa dal title, con fallback audit da excerpt/contenuto quando il SEO plugin non espone un meta dedicato.

Semantica blocchi:

- `ok=false` indica solo un blocco pubblico/release blocker;
- bozze, pagine non pubbliche e advisory non bloccano la readiness pubblica;
- i metadati Suite sono obbligatori solo per pagine generate o gestite dalla Suite;
- il payload espone `blocking_failed`, `advisory_items`, `blocks_public_release`, `page_contract`, `failed_checks`, `advisory_checks` e source della meta description.

Meta salvati:

- `_shss_page_quality_contract`
- `_shss_page_quality_status`
- `_shss_page_quality_checked_at`

Limite:

- e un audit strutturale/copy minimo;
- non sostituisce screenshot visuale, Core claim/pricing review o revisione umana.

## Shortcode Pubblici E Traduzione

Shortcodes monolite:

- `render_waas_template_gallery_shortcode()`
- `render_waas_template_wizard_shortcode()`
- `render_waas_template_preview_shortcode()`

La galleria usa `shss_translate_item()` con domini:

- `suite:waas_template_gallery`
- `suite:waas_template_wizard`

Quindi il blocco e gia predisposto per:

- export stringhe atomiche;
- lookup traduzioni da Core/SkinHarmony Core;
- fallback italiano.

Nota:

- il modulo fisico `waas-templates` ha render autonomo piu semplice;
- il monolite ha la versione piu evoluta con traduzione, design profile e project key.

## Cosa Funziona Oggi

- Catalogo template esiste.
- Registry locale strutturato esiste.
- Galleria/wizard/preview shortcode esistono.
- Preset grafici controllati esistono.
- Generazione pagine draft esiste.
- Export/import package esiste.
- Import rifiuta package pericolosi e pubblicazione automatica.
- Site clone intake/preview/draft esiste.
- Template Clone Validation e Workflow sono esposti read-only.
- Page Quality Contract e attaccato alle pagine generate/importate.
- Traduzione atomica e gia agganciata nella galleria/wizard monolite.

## Debolezze Da Non Dimenticare

- Il motore vero e ancora troppo nel monolite.
- Il modulo `template-design-system` e solo read-only.
- Il modulo `waas-templates` registra solo `/templates`; generate/package/import sono monolite.
- La clone validation segnala ancora mancanza evidenza responsive/rendering.
- Il clone engine non deve essere venduto come clonazione automatica completa di siti esterni.
- Serve sempre test visuale desktop/mobile: il solo contratto DOM non basta.
- Serve tenere aggiornata la memoria condivisa dopo ogni clone o pagina creata/corretta.

## Verdetto

Il blocco template/page factory e operativo per creare bozze, pacchetti e preview controllate. Non e ancora un sistema autonomo di pubblicazione o clonazione completa end-to-end.

Posizionamento corretto:

- Suite crea e governa blueprint/pagine in bozza;
- Core controlla claim, prezzi, traduzioni, publish safety e scope;
- l'owner approva;
- solo dopo si pubblica.

## Prossimo Blocco

Blocco 06:

- licenze;
- API key;
- update server;
- Smart Desk Bridge;
- App Key factory;
- seat limit;
- package/plan gating.
