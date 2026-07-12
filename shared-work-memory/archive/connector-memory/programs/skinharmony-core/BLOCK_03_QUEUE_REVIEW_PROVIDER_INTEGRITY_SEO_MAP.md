# SkinHarmony Core - Blocco 03

## Area Coperta

Questo blocco mappa la parte operativa del traduttore:

- coda traduzioni;
- review queue;
- provider OpenAI/local/memory;
- controllo integrita sito;
- traduzione SEO.

File verificati:

- `wordpress/plugins/skinharmony-core/includes/class-sh-core-queue.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-core-review-queue.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-core-provider.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-core-integrity-check.php`
- `wordpress/plugins/skinharmony-core/includes/class-sh-core-seo-bridge.php`

## 1. Coda Traduzioni

Classe:

- `SH_Core_Queue`

Ruolo:

- riceve richieste di traduzione o scan;
- salva job nella tabella `sh_core_translation_jobs`;
- processa i job manualmente o via cron;
- separa errori temporanei da errori permanenti;
- aggiorna stato, tentativi e messaggi errore.

Route principali:

- `POST /sh-core/v1/site/enqueue-page`
- `GET /sh-core/v1/queue/status`
- `POST /sh-core/v1/queue/run`
- `POST /sh-core/v1/queue/retry-failed`

Cron:

- hook `sh_core_process_translation_queue`;
- intervallo registrato `sh_core_every_five_minutes`;
- frequenza: ogni 5 minuti.

Tipi job gestiti:

- `page_translate`
- `seo_translate`
- `site_integrity_scan`
- `page_integrity_scan`
- `software_catalog_translate`

Regola operativa:

- la coda non deve saltare review e policy;
- se il provider fallisce temporaneamente, il job puo essere ritentato;
- se manca un dato strutturale o il target non e valido, il fallimento resta da correggere.

## 2. Review Queue

Classe:

- `SH_Core_Review_Queue`

Ruolo:

- raccoglie traduzioni candidate e testi sensibili;
- assegna revisori;
- gestisce note, approvazione, rifiuto, aggiornamento, pubblicazione e rollback;
- separa contenuto pronto da contenuto da controllare.

Route principali:

- `GET /sh-core/v1/review/pending`
- `GET /sh-core/v1/review/history`
- `POST /sh-core/v1/review/assign`
- `POST /sh-core/v1/review/note`
- `POST /sh-core/v1/review/page-bundle`
- `POST /sh-core/v1/review/approve`
- `POST /sh-core/v1/review/submit`
- `POST /sh-core/v1/review/reject`
- `POST /sh-core/v1/review/update`
- `POST /sh-core/v1/review/cleanup`
- `POST /sh-core/v1/review/publish`
- `POST /sh-core/v1/review/rollback`

Permessi:

- lettura review: capability di review;
- approvazione: capability di approve;
- pubblicazione/rollback: capability di publish.

Logica `should_review()`:

Il plugin manda in review quando trova:

- confidence sotto soglia;
- termini sensibili;
- contesto critico;
- identita protette;
- dati prezzo/listino;
- stringhe Suite importanti;
- campi dove una traduzione sbagliata puo cambiare promessa, prezzo o significato.

Eccezioni conservative:

- label brevi sicure;
- identita prezzo-like da non tradurre;
- contesti allegato/asset;
- stringhe operative dove serve evitare traduzioni creative.

Regola operativa:

- la review non deve essere percepita come blocco totale;
- deve produrre correzione puntuale, nota e alternativa pubblicabile;
- claim rischiosi e testi commerciali sensibili vanno in review se non sono gia bonificati.

## 3. Provider Traduzione / AI

Classe:

- `SH_Core_Provider`

Ruolo:

- decide se usare memory, OpenAI o servizio locale;
- testa lo stato provider;
- traccia uso OpenAI;
- stima budget e costo;
- restituisce errori leggibili quando manca configurazione.

Route principali:

- `GET /sh-core/v1/provider/status`
- `POST /sh-core/v1/provider/test`
- `GET /sh-core/v1/usage/openai`
- `GET /sh-core/v1/usage/budget`

Provider supportati:

- `memory_only`
- `openai`
- `local_service`

Chiave OpenAI:

Ordine di lettura:

1. env `SH_CORE_OPENAI_API_KEY`;
2. costante wp-config `SH_CORE_OPENAI_API_KEY`;
3. impostazioni plugin.

Modello default:

- `gpt-4.1-mini` se non configurato diversamente.

Uso/costi:

- log in `sh_core_openai_usage_log`;
- stima costo input/output;
- budget leggibile da pannello/report.

Regola operativa:

- OpenAI genera o rifinisce;
- la memory conserva cio che e approvato;
- Universal Core, quando collegato, resta giudice decisionale;
- il provider non deve pubblicare automaticamente senza review/policy quando il contenuto e sensibile.

## 4. Integrity Check

Classe:

- `SH_Core_Integrity_Check`

Ruolo:

- controlla pagine/post pubblicati;
- misura readiness traduzione;
- rileva stringhe mancanti;
- rileva review pendenti;
- controlla SEO localizzata;
- segnala se il sito puo essere considerato pubblicabile in lingua target.

Route principali:

- `GET /sh-core/v1/integrity/status`
- `POST /sh-core/v1/integrity/scan`
- `POST /sh-core/v1/integrity/fix-missing`

Cron:

- hook `sh_core_nightly_integrity_check`;
- schedulazione giornaliera;
- default intorno alle `03:00`.

Output atteso:

- readiness generale;
- readiness publish-safe;
- pagine con missing strings;
- pending review;
- SEO missing;
- fix suggeriti.

Regola operativa:

- integrity non deve inventare traduzioni mancanti;
- deve dire cosa manca e, se possibile, creare job/review;
- la readiness deve distinguere contenuto tradotto da contenuto davvero pubblicabile.

## 5. SEO Bridge

Classe:

- `SH_Core_SEO_Bridge`

Ruolo:

- legge title/description/social title/social description;
- traduce o recupera da memory;
- crea review se il campo SEO non e sicuro;
- evita che una pagina tradotta resti con metadati solo italiani.

Route principali:

- `GET /sh-core/v1/seo/status`
- `POST /sh-core/v1/seo/translate`

Campi supportati:

Yoast:

- `_yoast_wpseo_title`
- `_yoast_wpseo_metadesc`
- `_yoast_wpseo_opengraph-title`
- `_yoast_wpseo_opengraph-description`

Rank Math:

- `rank_math_title`
- `rank_math_description`
- `rank_math_facebook_title`
- `rank_math_facebook_description`

AIOSEO:

- `_aioseo_title`
- `_aioseo_description`

Media:

- `_wp_attachment_image_alt`

Regola operativa:

- SEO non e traduzione letterale;
- deve restare coerente con claim guard, tone of voice e search intent;
- se manca contesto o il testo e sensibile, passa in review.

## Flusso End-To-End

1. Una pagina o un modulo viene enqueued.
2. La coda crea job e lo processa.
3. Provider/memory producono candidato.
4. Review Queue decide se approvare, aggiornare, pubblicare o respingere.
5. SEO Bridge traduce i metadati.
6. Integrity Check misura copertura e readiness.
7. Se Universal Core e configurato, le decisioni sensibili passano dal giudice esterno.

## Cosa E Gia Operativo

- Queue REST e cron.
- Review completa con approvazione, update, publish e rollback.
- Provider status/test/usage/budget.
- Integrity scan manuale e notturno.
- SEO bridge per i plugin SEO principali.

## Cosa Resta Da Validare Live

- Che la queue processi correttamente batch grandi senza timeout.
- Che review/publish/rollback siano chiari per un utente non tecnico.
- Che SEO Bridge non generi doppioni meta su plugin SEO attivi.
- Che integrity distingua bene pagina tradotta, pagina review e pagina non pronta.
- Che l'automazione non salti mai claim guard e owner review sui contenuti sensibili.

