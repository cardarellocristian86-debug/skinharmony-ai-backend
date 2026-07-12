# Suite Block 12 - Tracking, Social, Cards E Conversione

## Perimetro

Questo blocco mappa i moduli che collegano il sito pubblico a conversione, tracking, card tecnologie, canali ufficiali e pagine commerciali leggere.

File letti:

- `wordpress/plugins/skinharmony-site-suite/modules/google-ads/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/traffic-attribution/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/social-channels/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/powered-by/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/product-cards/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`

## Sintesi

Questa area non e un campaign manager.

Suite oggi fa:

- tracking proprietario aggregato;
- emissione tag Google Ads se configurato;
- conversioni Google Ads solo su eventi reali;
- card pubbliche per tecnologie/prodotti/servizi;
- stack conversione con card + lead form + trial form + AI assistant wrapper;
- canali social separati tra cliente e SkinHarmony;
- badge `Powered by SkinHarmony` opzionale;
- generazione bozze conversione/SEO locali, mai publish automatico.

Suite oggi non fa:

- creazione campagne Google Ads;
- modifica budget;
- creazione label conversione Google;
- installazione pixel esterni automatica;
- geolocalizzazione precisa via GeoIP;
- pubblicazione automatica di pagine conversione;
- generazione prezzi o claim tecnici non verificati.

## Google Ads

Modulo fisico:

- `SHSS_Module_Google_Ads`

Storage:

- `shss_settings.google_ads_global_tag_id`
- `shss_settings.google_ads_conversion_lead_label`
- `shss_settings.google_ads_conversion_trial_label`
- `shss_settings.google_ads_conversion_waas_request_label`
- `shss_settings.google_ads_conversion_purchase_label`

Runtime reale nel monolite:

- `render_google_ads_global_tag()`
- `render_google_ads_conversion_from_query()`
- `render_google_ads_purchase_conversion($order_id)`
- `render_google_ads_conversion_settings_rows($settings)`
- `sanitize_google_ads_tag_id()`
- `sanitize_google_ads_conversion_ref()`
- `build_google_ads_conversion_send_to()`

Regole operative:

- L'ID accettato deve essere nel formato `AW-...`.
- Le label possono essere label singola o `AW-.../label`.
- Il tag globale viene emesso nel `head` pubblico solo se configurato.
- Le conversioni query partono solo con `shss_conversion` + `shss_event_id`.
- Eventi query supportati: `lead`, `trial`, `waas_request`.
- La conversione purchase parte da `woocommerce_thankyou`.
- La deduplica browser usa `localStorage` con chiave evento.

Governance:

- `automatic_tag_creation_enabled = false`
- `automatic_campaign_creation_enabled = false`
- `automatic_budget_changes_enabled = false`
- `automatic_conversion_fire_without_event_enabled = false`
- Owner confirmation richiesta per campagne, budget, nuove label e scalabilità Ads.

## Traffic Attribution

Modulo fisico:

- `SHSS_Module_Traffic_Attribution`

REST route:

- `POST /wp-json/shss/v1/traffic/track`

Storage:

- `shss_traffic_stats`

Runtime reale:

- `render_traffic_tracking_script()`
- `rest_track_traffic_event()`
- `record_traffic_event($event)`
- `estimate_traffic_country($browser_language, $browser_timezone)`
- `normalize_traffic_referrer($referrer)`
- `get_waas_traffic_stats()`

Flusso:

1. Il sito pubblico emette uno script leggero nel footer.
2. Lo script usa `navigator.sendBeacon`.
3. Invia path, referrer, UTM, lingua browser e timezone.
4. Suite salva solo aggregati giornalieri.
5. La retention locale taglia a circa 45 giorni.

Dati aggregati:

- total visite;
- paths;
- referrers;
- utm_sources;
- utm_mediums;
- utm_campaigns;
- countries stimate;
- timezones.

Privacy:

- nessun IP in chiaro;
- nessun dato personale esposto;
- niente GeoIP automatico;
- city-level non disponibile senza integrazione esterna e privacy review.

## Product / Technology Cards

Modulo fisico:

- `SHSS_Module_Product_Cards`

Shortcode:

- `[sh_technology_cards]`

Storage:

- `shss_cards`

Runtime:

- modulo fisico: rendering base card;
- monolite: `render_cards_shortcode()` con lookup traduzione Core;
- admin: `render_cards_admin()`;
- handler: `handle_save_cards()`.

Campi card:

- `title`
- `tag`
- `text`
- `link`

Uso corretto:

- card pubbliche tecnologia/prodotto/servizio;
- testo prudente;
- nessun claim medico;
- nessun prezzo inventato;
- link verso pagine già controllate.

Traduzione/Core:

- object_id: `shss_technology_cards`
- domain: `suite:technology_cards`
- key path:
  - `technologies.<card_key>.tag`
  - `technologies.<card_key>.name`
  - `technologies.<card_key>.description`
  - `technologies.default.cta`

Limite:

- La card non garantisce qualità marketing da sola. Il testo deve passare da Core/traduttore/claim guard quando e usato su pagina pubblica importante.

## Conversion Stack

Shortcode:

- `[sh_conversion_stack interest="..."]`

Runtime:

- `render_conversion_stack_shortcode($atts)`

Composizione:

- product/technology cards;
- lead form;
- trial form Smart Desk;
- wrapper AI assistant se AI Engine e disponibile.

Traduzione/Core:

- object_id: `sh_conversion_stack`
- domain: `suite:conversion_stack`
- key path:
  - `stack.title`
  - `items.trial.title`

Regola:

- Lo stack serve a raccogliere lead e trial, non a promettere risultati.
- Se Google Ads e attivo, le conversioni devono essere collegate a eventi reali, non a page view generiche.

## Social Channels

Modulo fisico:

- `SHSS_Module_Social_Channels`

Shortcode:

- `[sh_social_channels scope="client"]`
- `[sh_social_channels scope="skinharmony"]`

Storage:

- `shss_settings.social_channels.client`
- `shss_settings.social_channels.skinharmony`

Canali supportati:

- Instagram
- Facebook
- TikTok
- LinkedIn
- YouTube
- WhatsApp
- Sito esterno

Regola importante:

- Scope cliente e scope SkinHarmony sono separati.
- Un sito cliente non deve ereditare canali SkinHarmony se non e voluto.
- I social non vengono pubblicati o sincronizzati automaticamente altrove.

Traduzione/Core:

- object_id: `shss_social_channels`
- domain: `suite:social_channels`
- key path:
  - `section.title.client`
  - `section.title.skinharmony`
  - `section.empty`

## Powered By SkinHarmony

Modulo fisico:

- `SHSS_Module_Powered_By`

Shortcode:

- `[sh_powered_by_skinharmony]`

Storage:

- `shss_settings.powered_by_enabled`
- `shss_settings.powered_by_label`

Regola:

- Badge fiduciario opzionale.
- Non deve essere usato come claim di certificazione se il nodo non e governato/controllato davvero.
- Il label e configurabile; default: `Powered by SkinHarmony`.

## SEO Local / Pagine Conversione

Runtime admin:

- `render_seo_local_admin()`
- `handle_generate_conversion_pages()`
- `build_conversion_page_content($sector, $focus)`
- `handle_generate_seo_page()`

Logica:

- genera bozze WordPress;
- supporta settori multipli, non solo beauty;
- crea struttura, titolo, blocchi prudenti e shortcode conversione;
- non pubblica automaticamente.

Settori previsti UI:

- brand professionali;
- distributori;
- produttori;
- reti commerciali;
- centri estetici;
- parrucchieri;
- barber;
- wellness;
- erboristerie;
- farmacie;
- retail;
- servizi B2B.

Regola:

- La Suite e orizzontale: beauty/wellness e il verticale principale, ma la Page/SEO Factory deve restare riusabile su mercati diversi.
- Ogni pagina generata deve passare da quality contract, Claim Guard, Price Guard e revisione owner prima di andare live.

## Collegamenti Con Altri Blocchi

- Block 05: template/page factory e qualità pagina.
- Block 07: traduzioni strutturate, Core lookup, claim/content guard.
- Block 08: lead, analytics, dogfood e readiness commerciale.
- Block 10: WooCommerce purchase conversion.
- Block 11: Nyra legge traffico/conversione come segnale advisory.

## Stato Operativo

Pronto:

- tracking aggregato proprietario;
- Google Ads tag/conversioni se configurati;
- card pubbliche;
- social/powered-by;
- conversion stack;
- generazione bozze SEO/conversione.

Parziale:

- qualità marketing dei testi dipende ancora da Core/traduttore/review;
- Google Ads non legge costi/campagne/GA4;
- attribution non ha città/geo precisa;
- product cards sono semplici, non ancora componenti visual builder completi.

Da non promettere:

- gestione campagne Ads automatica;
- ottimizzazione budget;
- attribution enterprise completa;
- certificazione automatica social/brand;
- publish automatico di pagine commerciali.

## Regola Di Chiusura

Questa area e vendibile come:

> conversion governance leggera integrata nel sito WordPress.

Non e vendibile come:

> piattaforma media buying o analytics enterprise completa.

