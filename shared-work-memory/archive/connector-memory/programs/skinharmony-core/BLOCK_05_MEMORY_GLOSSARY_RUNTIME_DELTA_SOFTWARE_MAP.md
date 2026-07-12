# SkinHarmony Core - Blocco 05

## Area Coperta

Questo blocco mappa il layer che rende il traduttore riusabile, stabile e non caotico:

- glossary e policy pack;
- translation memory;
- runtime layer;
- delta detector;
- autosync su salvataggio;
- software/catalog bridge;
- endpoint OpenAI legacy/bozza.

File verificati:

- `wordpress/plugins/skinharmony-core/includes/class-sh-core-glossary.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-core-memory.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-core-runtime.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-core-delta-detector.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-core-autosync.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-core-software-bridge.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-openai.php`

## 1. Glossary / Policy Pack

Classe:

- `SH_Core_Glossary`

Ruolo:

- legge termini protetti;
- legge termini sensibili;
- legge parole preferite e parole da evitare;
- applica policy pack attivi;
- esporta bundle policy per Core/network.

Fonti JSON:

- `language-core/terms/skinharmony-terms.json`
- `language-core/terms/protected-terms.json`
- `language-core/terms/sensitive-terms.json`
- `language-core/terms/preferred-translations.json`
- `language-core/terms/market-tone-map.json`
- `language-core/policy-packs/<pack_id>.json`

Funzioni principali:

- `get_protected_terms()`
- `get_sensitive_terms()`
- `get_preferred_words()`
- `get_avoid_words()`
- `get_market_tone($language)`
- `get_preferred_translations($language)`
- `get_active_policy_pack_ids()`
- `get_active_policy_packs()`
- `export_policy_bundle()`

Regola operativa:

- i termini di brand/prodotto/metodo non devono essere tradotti liberamente;
- i policy pack devono verticalizzare il comportamento senza duplicare codice;
- Suite e altri plugin devono leggere policy/termini da Core quando possibile.

## 2. Translation Memory

Classe:

- `SH_Core_Memory`

Ruolo:

- wrapper leggero su `SH_Core_Storage`;
- legge memory approvata;
- salva/upserta traduzioni;
- salva missing in modalita `memory_only`.

Funzioni:

- `get($source_hash, $target_lang, $domain, $key_path)`
- `upsert($args)`
- `save_missing($source_text, $source_hash, $target_lang, $domain, $item)`

Regola operativa:

- la memory e la fonte di verita runtime;
- se `memory_only` non trova traduzione, deve registrare missing e non inventare;
- `domain` e `key_path` sono obbligatori per evitare collisioni tra testi simili.

## 3. Runtime Layer

Classe:

- `SH_Core_Runtime`

Ruolo:

- salva layer traduzione pagina;
- salva layer SEO;
- salva layer strutturato Suite;
- risolve una singola stringa per render runtime;
- evita che le stringhe in review finiscano nel frontend.

Storage WordPress:

- `sh_core_site_translations`
- `sh_core_seo_translations`

Funzioni principali:

- `get_page_layer($post_id, $target_lang)`
- `store_page_layer($post_id, $target_lang, $results)`
- `set_page_translation_item($post_id, $target_lang, $item_id, $item)`
- `store_seo_layer($post_id, $target_lang, $items)`
- `get_seo_layer($post_id, $target_lang)`
- `store_suite_structured_layer($domain, $object_id, $target_lang, $items)`
- `get_suite_structured_layer($domain, $object_id, $target_lang)`
- `resolve_translation_item($object_id, $target_lang, $domain, $key_path, $source_hash, $fallback)`

Stati runtime accettati:

- `approved`
- `published`
- `runtime`
- `ready`
- `machine_generated`

Stati esclusi dal render:

- `pending_review`
- stati vuoti/non approvati.

Regola operativa:

- il frontend deve vedere solo contenuto approvato o sicuro;
- se non trova traduzione, torna al fallback sorgente;
- il render deve preferire structured layer e poi memory.

## 4. Delta Detector

Classe:

- `SH_Core_Delta_Detector`

Ruolo:

- normalizza stringhe;
- calcola hash SHA-256;
- registra fonti stringa in `sh_core_string_sources`;
- riconosce stringhe nuove o cambiate.

Funzioni:

- `normalize($text)`
- `hash($text)`
- `detect_delta($args)`

Input logico:

- `object_type`
- `object_id`
- `domain`
- `strings`
- `key_path`
- `context`

Output:

- `new`
- `changed`
- `seen`
- `seen_key_paths`

Regola operativa:

- non bisogna ritradurre tutto se cambia una piccola parte;
- ogni modulo deve produrre key_path stabile;
- hash e key_path sono la base per memory, review e autosync.

## 5. Autosync

Classe:

- `SH_Core_Autosync`

Ruolo:

- intercetta `save_post`;
- se abilitato, rileva delta;
- crea job di traduzione per le lingue target;
- scrive audit.

Trigger:

- hook `save_post` con priorita `20`.

Condizioni:

- post type `page` o `post`;
- stato `publish` o `draft`;
- non autosave/revision;
- `auto_sync_enabled` attivo;
- `auto_translate_on_save` attivo;
- contenuto nella lingua sorgente.

Job creati:

- `page_translate`
- reason `source_saved_delta`
- priority `30`
- payload `changed_hashes`

Regola operativa:

- autosync non significa pubblicazione automatica;
- crea lavoro controllabile in queue/review;
- source language resta protetta.

## 6. Software / Catalog Bridge

Classe:

- `SH_Core_Software_Bridge`

Ruolo:

- importa cataloghi software/UI;
- traduce chiavi software per app/namespace;
- esporta cataloghi tradotti;
- produce readiness cataloghi.

Route principali:

- `POST /sh-core/v1/software/import-catalog`
- `POST /sh-core/v1/software/translate-catalog`
- `GET /sh-core/v1/software/export-catalog`
- `GET /sh-core/v1/software/status`

Storage:

- option `sh_core_software_catalog_sources`
- domain memory `software:<app_id>`

Flusso:

1. Importa `app`, `namespace`, `entries`.
2. Registra delta.
3. Per ogni target legge memory.
4. Se manca, chiama provider.
5. Passa da review se necessario.
6. Salva in memory.
7. Esporta solo traduzioni presenti.

Regola operativa:

- utile per tradurre UI, plugin, Smart Desk, Suite o software esterni;
- non deve confondere testi UI con testi marketing;
- context/namespace devono essere stabili.

## 7. OpenAI Draft Legacy

Classe:

- `SH_Core_OpenAI`

Ruolo:

- endpoint semplice per test OpenAI;
- endpoint bozza traduzione;
- protegge lingua sorgente;
- restituisce bozza sempre da review.

Route:

- `POST /sh-core/v1/openai/test`
- `POST /sh-core/v1/openai/translate`

Caratteristiche:

- usa `SH_Core_Provider::get_openai_credentials()`;
- modello default `gpt-4.1-mini`;
- temperature `0.2`;
- max output `900`;
- ritorna `requires_review = true`;
- ritorna `safe_to_publish_automatically = false`.

Regola operativa:

- questo endpoint non e il nuovo autopilot completo;
- serve come bozza/test controllato;
- Content Governance/Language Autopilot sono il layer piu evoluto.

## Flusso Qualita

1. Glossary/policy definisce termini e tono.
2. Delta Detector capisce cosa e nuovo/cambiato.
3. Queue processa solo quello che serve.
4. Provider genera quando memory non basta.
5. Review decide cosa e sicuro.
6. Runtime pubblica solo item accettati.
7. Integrity misura cosa manca.

## Cosa E Gia Operativo

- Policy pack e termini da file JSON + settings.
- Memory e missing memory.
- Runtime layer pagina/SEO/Suite.
- Delta detector con source registry.
- Autosync su salvataggio.
- Catalog software import/translate/export/status.
- Endpoint OpenAI legacy per test e bozza.

## Cosa Resta Da Validare Live

- Che i key_path Suite/software restino stabili nel tempo.
- Che autosync non generi troppi job su pagine molto grandi.
- Che memory_only sia chiaro per utente: segnala missing, non traduce.
- Che policy pack verticali non si sovrappongano creando tono incoerente.
- Che Software Bridge sia usato anche da Suite/Smart Desk invece di duplicare traduzioni UI.

