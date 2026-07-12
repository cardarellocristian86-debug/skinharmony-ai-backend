# Suite Block 08 - Commercial, Lead, Analytics, Brand Governance, DAM, Reputation

Data lettura: 2026-05-24
Versione Suite rilevata: 5.2.37

## Scope Del Blocco

Questo blocco mappa come Site Suite viene usata per vendere, misurare e governare il sito SkinHarmony e i futuri nodi cliente.

File principali letti:

- `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
- `wordpress/plugins/skinharmony-site-suite/modules/lead-intelligence/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/analytics/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/brand-governance/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/dam-assets/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/reputation/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/upsell-suggestions/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/seo-conversion/class-module.php`

## Tesi Operativa

Suite non è solo plugin tecnico.

In questo blocco lavora come:

- vetrina commerciale WaaS;
- raccolta lead;
- listino pubblico controllato;
- generatore proposte;
- controllo pagine commerciali;
- DAM asset ufficiali;
- governance contenuti brand;
- analytics aggregata privacy-safe;
- reputazione manuale;
- upsell/cross-sell controllato.

Regola:

`Il sito SkinHarmony deve essere il primo nodo gestito da Suite.`

## Lead Intelligence

Modulo:

- `modules/lead-intelligence/class-module.php`

Stato reale:

- shortcode reale;
- REST endpoint reale;
- snapshot read-only;
- submit handler ancora nel monolite.

Shortcode:

- `[sh_lead_intelligence_form]`

Endpoint:

- `GET /wp-json/shss/v1/latest-leads`

Storage:

- option `shss_leads`

Campi lead:

- id;
- created_at;
- name;
- company_name;
- vat_number;
- email;
- phone;
- message;
- interest;
- priority;
- status;
- source_url;
- is_trial.

Stati:

- `new`
- `to_contact`
- `contacted`
- `interested`
- `lost`
- `customer`
- `archived`

Privacy:

- endpoint latest-leads maschera email;
- espone hash email SHA256;
- non esporta automaticamente;
- non contatta automaticamente.

Verità operativa:

Ogni contatto commerciale deve passare da qui o da handler equivalenti Suite, così il sito non perde lead.

## SEO Conversion

Modulo:

- `modules/seo-conversion/class-module.php`

Shortcode:

- `[sh_conversion_stack]`
- `[sh_waas_offer]`
- `[sh_waas_packages]`

Ruolo:

- compone card tecnologie, lead form, trial bridge e assistente;
- mostra offerta WaaS;
- mostra pacchetti WaaS pubblici;
- precompila messaggio lead quando selezioni pacchetto.

Regola prezzi:

- usa pricebook Suite;
- mostra prezzi “da” o “su valutazione”;
- non inventa prezzi;
- Smart Desk resta listino separato.

Fallback pagina:

- URL offerte WaaS da pagina `offerte-waas`;
- fallback `/offerte-waas/`.

## WaaS Commercial

Funzioni principali monolite:

- `render_waas_commercial_admin()`
- `render_waas_commercial_proposal_generator()`
- `get_waas_commercial_status()`
- `get_waas_commercial_sellability_status()`
- `get_suite_page_governance_status()`

Stato reale:

- pannello amministrativo completo;
- offerte pubbliche modificabili da option;
- generatore proposte;
- prodotti WooCommerce collegabili alle card;
- controllo pagine commerciali;
- dogfood SkinHarmony;
- plugin sale readiness.

Pagine commerciali previste:

- offerta/pacchetti WaaS;
- richiesta contratto;
- condizioni servizio WaaS;
- attivazione progetto WaaS;
- onboarding post-proposta WaaS.

Storage pricebook:

- option `shss_waas_commercial_pricebook`

Modalità vendita:

- `public_simple_offers_internal_full_pricebook`
- `quote_first_public_starting_prices`

Regole:

- pubblico: offerte semplici con prezzo da e richiesta proposta;
- interno: listino completo per preventivi su misura, add-on, commissioni e condizioni partner;
- checkout solo dopo perimetro, condizioni, dominio, privacy e fatturazione confermati;
- prezzi IVA esclusa salvo diversa indicazione;
- gateway, chargeback, terze parti e costi legali/fiscali separati salvo accordo scritto.

Generatore proposte:

- cliente;
- email;
- settore;
- tipo cliente;
- offerta base;
- nodi/siti;
- partner;
- Smart Desk plan/accessi;
- fatturazione;
- margine partner;
- modello commissione;
- note.

Output:

- proposta salvata;
- CSV;
- versione stampabile/PDF via browser.

Non fa:

- non invia automaticamente;
- non crea ordine automatico;
- non incassa;
- non cambia condizioni senza owner.

## Page Governance

Suite controlla le pagine commerciali con:

- esistenza pagina;
- stato WordPress;
- qualità minima Suite;
- metadata;
- CTA;
- evidenza;
- prossima azione.

Funzione:

- `get_suite_page_governance_status()`

Usa:

- `analyze_suite_public_page_quality()`

Stati:

- `ready`;
- `partial`;
- `blocked`.

Regola:

Una pagina non deve essere considerata governata se mancano struttura, CTA, metadati, visual o qualità copy.

## Dogfood SkinHarmony

Nel pannello commerciale esiste il controllo:

- `SkinHarmony usa la Suite`

Scopo:

- verificare che il sito madre usi davvero Suite per offerte, DAM, template, tracking, lead e pagine.

Metriche:

- score uso Suite;
- shortcode attesi/trovati;
- offerte vendibili;
- traffico e lead;
- action queue;
- chiusura operativa sito madre.

Regola:

Prima di vendere Suite a clienti, il sito SkinHarmony deve usarla come nodo reale e dimostrabile.

## Analytics Aggregata

Modulo:

- `modules/analytics/class-module.php`

Stato reale:

- modulo read-only;
- scrittura tracking e UI nel monolite;
- aggrega traffico, lead e ordini WooCommerce;
- non fa ranking pubblico;
- non invia campagne;
- non sincronizza analytics esterni.

Endpoint dichiarati:

- `/wp-json/shss/v1/traffic/track`
- `/wp-json/shss/v1/waas-manager/analytics`

Storage traffico:

- option `shss_traffic_stats`

Metriche:

- visite 30 giorni;
- top referrer;
- lead totali/aperti;
- ordini tecnologia;
- valore ordini tecnologia;
- paths;
- referrer;
- UTM source/medium/campaign;
- paese stimato;
- timezone.

Privacy:

- tracking aggregato;
- IP non salvato in chiaro;
- geografia da lingua/timezone browser;
- nessuna città reale;
- GeoIP/Analytics esterni richiedono policy privacy.

Regola:

Analytics serve a orientare il business, non a inviare azioni automatiche.

## Brand Governance

Modulo:

- `modules/brand-governance/class-module.php`

Stato reale:

- modulo read-only;
- UI, salvataggio bozze e REST nel monolite.

Storage:

- option `shss_brand_governance_drafts`

Funzioni:

- bozze centrali;
- target di distribuzione;
- stato approvazione;
- preview contenuto;
- claim risk;
- content synchro controllato;
- brand asset pricing governance.

Policy:

- nessun push automatico;
- nessuna pubblicazione automatica;
- nessun overwrite contenuti partner;
- Claim Guard richiesto;
- Price Guard richiesto;
- owner confirmation richiesta.

Termini protetti:

- materie prime;
- formulazione;
- laboratorio;
- terzista;
- packaging;
- PIF;
- documentazione cosmetica;
- certificazione CE;
- marcatura CE;
- fascicolo tecnico;
- consulenza regolatoria;
- risultato clinico;
- promessa terapeutica;
- accesso garantito ai distributori.

Verità:

Brand Governance prepara contenuti centrali, ma non li distribuisce automaticamente nella rete.

## DAM Assets

Modulo:

- `modules/dam-assets/class-module.php`

Shortcode:

- `[sh_dam_assets]`

Stato reale:

- shortcode fisico;
- status locale;
- UI admin nel monolite;
- asset in option;
- può registrare URL o upload WordPress;
- nessun push o sostituzione automatica.

Storage:

- option `shss_dam_assets`

Campi asset:

- id;
- created_at;
- created_by;
- title;
- asset_type;
- category;
- asset_url;
- alt_text;
- tags;
- usage_scope;
- approved;
- visual_asset_studio.

Visual Asset Studio:

- master protetto;
- preset template;
- destination;
- quality gate;
- stato `pending_render`;
- nessuna modifica pubblicata automaticamente.

Uso:

- loghi;
- foto prodotto;
- video;
- documenti;
- asset brand/sito/partner.

## Reputation

Modulo:

- `modules/reputation/class-module.php`

Stato reale:

- read-only health nel modulo;
- registro/manual save nel monolite;
- nessuna risposta pubblica automatica.

Storage:

- option `shss_reputation_reviews`

Fonti ammesse:

- google;
- facebook;
- instagram;
- trustpilot;
- manual;
- other.

Stati:

- `to_review`
- `needs_reply`
- `critical`
- `replied`
- `closed`

Regole:

- recensioni registrate/importate manualmente;
- nessuna risposta pubblicata automaticamente;
- ogni messaggio suggerito va approvato;
- criticità restano aperte finché non chiuse;
- richieste feedback via WhatsApp/email richiedono consenso e conferma.

## Upsell Suggestions

Modulo:

- `modules/upsell-suggestions/class-module.php`

Shortcode:

- `[sh_upsell_suggestions]`

Stato reale:

- shortcode fisico;
- genera suggerimenti da catalogo tecnologie base;
- suggerimenti manuali salvabili nel monolite;
- nessun popup/email/checkout automatico.

Tecnologie base lette nel modulo:

- Skin Pro;
- Termosauna;
- O3 System.

Regola:

Upsell è proposta controllata per pagina, preventivo o shortcode. Non deve diventare promessa di risultato o automazione commerciale aggressiva.

## Cosa È Operativo

- Lead form e salvataggio lead.
- Latest leads REST con dati minimizzati.
- Offerte WaaS pubbliche da pricebook.
- Generatore proposte/CSV/stampa.
- Page governance commerciale.
- Dogfood status del sito madre.
- DAM asset registry e shortcode.
- Brand Governance draft queue.
- Analytics aggregata privacy-safe.
- Reputation manual registry.
- Upsell shortcode/suggerimenti.

## Cosa È Parziale

- Molti moduli fisici sono health/read-only; UI e write handlers restano nel monolite.
- Analytics non è ancora collegata a GA/Search Console/GeoIP.
- Reputation non importa recensioni esterne automaticamente.
- DAM non fa render grafico automatico.
- Brand Governance non distribuisce contenuti ai partner.
- Upsell non usa ancora Core/AI per priorità avanzate.

## Cosa Non Va Promesso

- “Pubblicazione automatica rete”.
- “Risposta automatica recensioni”.
- “Ranking pubblico partner”.
- “Geo preciso città”.
- “Checkout automatico senza proposta”.
- “Asset trasformati automaticamente”.
- “Copy legalmente certificato”.

## Regola Di Vendibilità

Per vendere Suite, il sito SkinHarmony deve mostrare:

1. pagine commerciali governate;
2. offerte e CTA funzionanti;
3. lead salvati;
4. tracking aggregato leggibile;
5. DAM e asset ufficiali;
6. Claim/Price Guard puliti;
7. proposta e contratto gestibili;
8. nessuna promessa fuori perimetro.

