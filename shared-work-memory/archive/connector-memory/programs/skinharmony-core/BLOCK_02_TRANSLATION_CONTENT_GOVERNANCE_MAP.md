# SkinHarmony Core Block 02 - Traduzione, Language Autopilot E Content Governance

## Perimetro

Questo blocco mappa il cuore del traduttore: estrazione stringhe, traduzione pagina/strutturata, runtime per lingua, Content Governance, Language Autopilot, humanizer, Claim Guard locale e decisione Core remota.

File letti:

- `wordpress/plugins/skinharmony-core/includes/class-sh-language.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-site-translator.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-core-content-orchestrator.php`
- `wordpress/plugins/skinharmony-core/language-core/*`

## Lingue

Lingue supportate:

- `it`
- `en`
- `fr`
- `de`
- `es`

La lingua sorgente default è `it`.

La lingua corrente può arrivare da:

- query `sh_lang`;
- query `lang`;
- prefisso path;
- cookie `sh_lang`;
- default language.

Shortcode:

- `[sh_language_switcher]`
- `[sh_translate key="..." fallback="..."]`

Regola:

- La lingua sorgente è protetta. Non va riscritta automaticamente durante una traduzione.

## Traduzione Pagina

REST:

- `GET /wp-json/sh-core/v1/site/strings`
- `POST /wp-json/sh-core/v1/site/translate-page`

Flusso:

1. legge `post_id`;
2. estrae stringhe visibili dal contenuto;
3. aggiunge stringhe dinamiche generate da shortcode supportati;
4. calcola `source_hash`;
5. traduce via memory/local_service/OpenAI;
6. applica humanizer/governance;
7. salva in memory se richiesto;
8. restituisce review summary.

Shortcode dinamici supportati in estrazione:

- `sh_waas_offer`
- `sh_waas_packages`
- `sh_waas_template_gallery`
- `sh_waas_template_wizard`
- `sh_waas_template_preview`
- `sh_waas_module_gate`
- `sh_conversion_stack`
- `sh_technology_cards`
- `sh_trial_bridge`
- `sh_social_channels`
- `sh_powered_by_skinharmony`
- `sh_dam_assets`
- `sh_upsell_suggestions`
- `sh_lead_intelligence_form`

Provider traduzione:

- `memory_only`
- `local_service`
- `openai`

Regole provider:

- `memory_only`: se manca una traduzione, torna errore 409.
- `local_service`: usa endpoint configurato.
- `openai`: usa credenziali provider e modello impostato.

## Traduzione Strutturata Suite

REST:

- `POST /wp-json/sh-core/v1/site/translate-structured`
- `POST /wp-json/sh-core/v1/site/suite-sync`
- `GET /wp-json/sh-core/v1/site/translation-item`

Payload atteso:

- `module_id`
- `object_type`
- `object_id`
- `domain`
- `items`
- `key_path`
- `source_text`
- `context`

Uso:

- Suite espone stringhe atomiche.
- Core traduce e salva.
- Suite renderizza per lingua usando `translation-item`.
- Se non trova traduzione, fallback italiano.

Regola:

- Non tradurre HTML finale.
- Tradurre stringhe atomiche stabili.
- `key_path` non deve cambiare a ogni render.

## Runtime Frontend

Filtro:

- `the_content`

Se `enable_site_translation = yes`:

1. legge lingua corrente;
2. se lingua corrente è sorgente, lascia contenuto originale;
3. carica memory per post/lingua;
4. sostituisce solo text node visibili;
5. ignora script/style/noscript;
6. in caso di errore torna contenuto originale.

Regola:

- Il render deve degradare in sicurezza: se manca memory o errore, mostra sorgente.

## Translation Multiverse / V7 Preview

REST:

- `POST /wp-json/sh-core/v1/site/translation-multiverse-preview`

Fa:

- riceve source_text;
- riceve candidate_translation;
- costruisce scenari;
- genera digest V7;
- produce verdetto locale;
- se configurato interroga Universal Core;
- seleziona scenario;
- restituisce publish_safe/requires_review.

Regola:

- Provider genera.
- Universal Core valuta scenari.
- WordPress salva solo draft/approved.

## Content Governance / Language Autopilot

REST:

- `POST /wp-json/sh-core/v1/site/content-governance`
- `POST /wp-json/sh-core/v1/site/language-autopilot`

Permesso:

- admin/manage settings;
- network orchestrator;
- automation key con scope `content_governance`.

Input:

- `source_text`
- `candidate_text`
- `mode`
- `target_language`
- `domain`
- `context`
- `object_type`
- `object_id`
- `key_path`
- `sector`
- `target_audience`
- `channel`

Mode principali:

- `improve_source`
- `translate`
- `marketing_copy`
- `seo_localized`

Output:

- `branch_hints`
- `core_branch_map`
- `humanizer`
- `content_orchestration`
- `text_structure`
- `automation_workflow`
- `scenarios`
- `v7_digest`
- `local_verdict`
- `remote_core`
- `selected_scenario`
- `suggested_output`
- `claim_corrections`
- `publish_safe`
- `requires_review`

Regola stabile:

> OpenAI genera. Universal Core decide. Il plugin espone testo strutturato, workflow e rami; Suite consuma payload e non duplica scrittura/traduzione.

## Content Orchestrator

Classe:

- `SH_Core_Content_Orchestrator`

Serve a capire se un testo è:

- troppo astratto;
- freddo;
- ripetitivo;
- povero di dettagli funzionali;
- rischioso lato claim;
- debole lato marketing;
- privo di problema reale.

Analizza:

- strategy brief;
- functional detail map;
- claim boundary;
- story arc;
- repetition;
- human readability;
- publish recommendation.

Esempio specifico O3/scalp:

- cerca termini come ossigeno, ozono, neutralizzazione, sebo, residui, cute, freschezza, styling;
- richiede sequenza prima/durante/dopo;
- blocca o segnala claim come cura, ricrescita, dermatite, guarigione, risultati garantiti.

Regola:

- Deve accompagnare il lettore con funzionamento concreto, non riempire la pagina di parole astratte tipo premium, coerenza, percezione, controllo.

## Claim Guard Locale

Il Claim Guard locale:

- rileva parole/frasi rischiose;
- propone correzione;
- richiede review;
- non deve bloccare tutta la pagina per una parola;
- deve preferire correzione puntuale e riga/contesto.

Hard stop solo per:

- claim estremi;
- publish automatico;
- rischio medico/terapeutico esplicito.

## Stato Operativo

Pronto:

- lingua corrente;
- memory runtime;
- traduzione pagina;
- traduzione strutturata;
- suite sync;
- translation item lookup;
- multiverse preview;
- content governance;
- language autopilot alias;
- content orchestrator;
- automation key content governance.

Parziale:

- qualità finale dipende da prompt/provider/Core remoto;
- SEO meta Rank Math non sempre modificabile da REST standard;
- Universal Core remoto deve essere configurato per decisione centrale;
- local_service richiede endpoint esterno;
- humanizer/claim guard vanno testati su testi reali per settore.

Da non promettere:

- traduzione perfetta senza review;
- claim legalmente certificato;
- pubblicazione automatica sempre sicura;
- sostituzione consulenza normativa;
- riscrittura corretta di testi tecnici se mancano dati prodotto/protocollo.

