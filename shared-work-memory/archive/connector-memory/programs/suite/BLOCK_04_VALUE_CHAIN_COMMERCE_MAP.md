# Suite Block 04 - Value Chain Pricing, Price Guard, Commerce Policy, B2B Order Bridge

Data mappatura: 2026-05-24

## Scopo Del Blocco

Questo blocco descrive la parte economica e commerciale di SkinHarmony Site Suite: prezzi ufficiali, guardrail prezzi, value chain Fabbrica -> Brand -> Distributore -> Esercente, policy catalogo, ordini B2B, acconto/saldo e controllo commerce.

La logica verificata conferma che Suite non si limita a mostrare prezzi: costruisce una governance di filiera. Il sistema calcola margini, sconti, dose cost, rischio, policy sicura e presa visione owner, ma non impone prezzi pubblici e non modifica ordini storici.

## File Letti

- `wordpress/plugins/skinharmony-site-suite/src/core/pricing/ValueChainPricingEngine.php`
- `wordpress/plugins/skinharmony-site-suite/modules/price-guard/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/price-list-engine/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/b2b-engine/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/commerce-policy/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/commerce-core/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/commerce-control-room/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`

## Verita Architetturale

Il blocco commerce e misto:

- `ValueChainPricingEngine.php` e un motore reale e separato.
- `price-guard` e un modulo reale read-only con REST endpoint proprio.
- `b2b-engine` e un modulo read-only parziale, ma la logica piena vive nel monolite.
- `commerce-policy`, `price-list-engine` e `commerce-core` sono ancora soprattutto structure/health.
- Il monolite `skinharmony-site-suite.php` tiene UI, handler, REST route, storage e policy operative.

Quindi oggi la verita e:

- matematica value chain = gia estratta in core pricing;
- scansione prezzi pubblici = modulo reale + monolite;
- order bridge / commerce policy = operative nel monolite, moduli fisici ancora leggeri;
- price list engine = non ancora motore centrale completo.

## Endpoint E Admin

Admin:

- `shss-price-guard`
- `shss-value-chain-pricing-guard`
- `shss-b2b-order-bridge`
- `shss-commerce-control-room`
- `shss-technology-deposits`
- `shss-technology-orders`

REST:

- `GET /wp-json/shss/v1/price-guard/nyra-snapshot`
- `GET /wp-json/shss/v1/waas-manager/value-chain-pricing-guard`
- `GET /wp-json/shss/v1/waas-manager/value-chain-access-policy`
- `GET /wp-json/shss/v1/waas-manager/b2b-order-bridge`
- `POST /wp-json/shss/v1/waas-manager/b2b-order-bridge/request`
- `GET /wp-json/shss/v1/waas-manager/commerce-policy`
- `GET /wp-json/shss/v1/waas-manager/commerce-control-room`

Admin-post:

- `shss_save_price_settings`
- `shss_save_value_chain_policy`
- `shss_generate_value_chain_snapshot`
- `shss_create_value_chain_safe_policy`
- `shss_ack_value_chain_policy`
- `shss_save_b2b_order_request`
- `shss_save_b2b_delivery_settings`

## Storage

Storage principali:

- `shss_settings[official_prices]`
- `shss_value_chain_price_policies`
- `shss_value_chain_price_snapshots`
- `shss_value_chain_price_alerts`
- `shss_b2b_order_requests`
- `shss_technology_commerce_policies`
- `shss_custom_technology_sales_definitions`

Limiti:

- policy value chain salvate fino a circa 300;
- snapshot value chain fino a circa 500;
- alert value chain fino a circa 500;
- richieste B2B fino a circa 300.

## Price Guard Pubblico

`modules/price-guard/class-module.php` registra:

- `GET /wp-json/shss/v1/price-guard/nyra-snapshot`

Funzione:

- legge pagine pubblicate;
- cerca importi in euro;
- confronta gli importi con listino ufficiale;
- segnala importi non ammessi;
- non modifica contenuti;
- non blocca pubblicazione;
- produce snapshot per Nyra/Core.

Prezzi ufficiali:

- leggono `shss_settings[official_prices]`;
- includono fallback ufficiali predefiniti Smart Desk/WaaS/tecnologie.

Limite:

- e un controllo importi, non interpreta ancora sconti complessi, bundle o contesto contrattuale.

## Value Chain Pricing Engine

Motore reale:

- `src/core/pricing/ValueChainPricingEngine.php`

Input policy:

- `C` costo produzione;
- `k` coefficiente listino;
- `dD` sconto distributore;
- `dE` sconto esercente;
- `mB_min` margine/markup minimo brand;
- `mD_min` markup minimo distributore;
- `positioning_min_ratio`;
- `dose_count` oppure `ml_total` + `ml_per_treatment`;
- `sold_to_role`;
- `sector_scope`;
- `visibility_profile`;
- `approval_required`.

Output:

- `L` listino;
- `PD` prezzo distributore;
- `PE` prezzo esercente;
- `brand_markup`;
- `brand_margin`;
- `distributor_markup`;
- `distributor_margin`;
- `safe_operator_discount`;
- `safe_PE`;
- `dose_cost`;
- `risk_score`;
- `risk_status`;
- `alerts`;
- `suggested_action`;
- `owner_confirmation_required`;
- `requires_acknowledgement`;
- `recalculation_plan`.

## Logica Di Filiera

Formula centrale:

- `L = C * k`
- `PD = L * (1 - dD)`
- `PE = L * (1 - dE)`

Sconto esercente massimo sicuro:

- calcolato dalla relazione tra sconto distributore e markup minimo distributore.

Default importante:

- markup minimo distributore default `100%`, quindi logica 1 a 1.

La catena legge da dove parte la vendita:

- se vendi a fabbrica, ricalcolo da brand;
- se vendi a brand, ricalcolo da distributore;
- se vendi a distributore, ricalcolo da operatore;
- se vendi a operatore, ricalcolo solo dose cost/risk.

Regola stabile:

- ogni modifica genera nuovo snapshot;
- gli ordini storici non vengono riscritti;
- la catena riparte solo dallo step successivo.

## Alert E Rischio

Alert critici:

- costo produzione non valido;
- coefficiente listino sotto 1;
- sconto distributore non valido;
- sconto esercente non valido;
- margine brand sotto soglia;
- margine distributore insufficiente;
- sconto esercente troppo alto rispetto alla catena;
- dati dose mancanti.

Classificazione rischio:

- `ok` fino a 20;
- `warning` fino a 50;
- `high` fino a 80;
- `critical` sopra 80.

Conferma owner:

- richiesta se la policy e marcata approval required;
- richiesta se il rischio e high/critical;
- richiesta se la policy non e ancora acknowledged.

## Policy Sicura

Il pulsante `Crea policy sicura` non modifica la policy originale.

Fa questo:

- calcola lo sconto esercente massimo sicuro;
- crea una nuova policy duplicata;
- porta `dE` al massimo sicuro;
- imposta `approval_required = yes`;
- rimette `acknowledgement_status = pending`;
- genera nuovo snapshot;
- scrive audit `value_chain_safe_discount_policy_created`.

Questa logica e corretta per il modello richiesto: il sistema corregge la catena in bozza controllata, non impone automaticamente la modifica.

## Privacy E Visibilita Filiera

Profili:

- `partner_safe`
- `factory_private`
- `brand_owner`
- `distributor_private`
- `operator_private`

Policy API key:

- ogni chiave deve avere ruolo, actor id, settore, visibilita, piano e scadenza;
- default `deny_cross_actor_private_data`;
- factory non vede condizioni private distributor/operator;
- brand vede solo la propria rete;
- distributore vede solo proprie condizioni e operatori assegnati;
- operatore vede solo prezzo/dose/materiali propri.

Questo blocco e gia coerente con il modello rete privata multi-attore.

## B2B Order Bridge

Il B2B Order Bridge e operativo come richiesta interna, non come ordine automatico.

Legge catalogo da:

- definizioni tecnologia;
- WooCommerce;
- Magazzino Prodotti;
- stock prodotto;
- policy di vendita.

Crea richieste con:

- partner;
- email;
- dominio;
- prodotto;
- quantita;
- tipo richiesta;
- note;
- stato `pending_review`.

Tipi richiesta:

- `stock_order`;
- `availability_check`;
- `quote_request`.

Stati:

- `pending_review`;
- `quoted`;
- `approved`;
- `rejected`;
- `converted_manually`.

Guardrail:

- nessuna evasione automatica;
- nessuna scalata stock dal bridge;
- nessun pagamento automatico;
- controllo umano su listino, contratto e disponibilita.

## Commerce Policy

La Commerce Policy normalizza il comportamento commerciale per prodotto.

Campi:

- `sales_mode`;
- `barcode`;
- `deposit_percent`;
- `fulfillment_owner`;
- `delivery_profile`;
- `reserved_price_group`;
- `reorder_point`;
- `policy_note`;
- `approval_required`.

Modalita vendita:

- `full_payment`;
- `deposit_balance`;
- `quote_only`;
- `availability_request`;
- `b2b_reserved`;
- `authorized_only`;
- `not_sellable`.

Next step automatico:

- sottoscorta -> valutare riordino/blocco traffico;
- consegna custom -> preventivo/verifica manuale;
- acconto/saldo -> acconto percentuale + saldo prima spedizione;
- quote only -> richiesta informazioni;
- B2B reserved -> controllare CRM/gruppo cliente;
- authorized only -> conferma owner/brand;
- not sellable -> solo scheda informativa.

## Acconto E Saldo Tecnologie

Le tecnologie hanno definizioni di default:

- Skin Pro;
- Termosauna;
- O3 System.

Ogni tecnologia puo avere:

- prodotto pieno;
- prodotto acconto;
- prodotto saldo;
- prezzo netto pieno;
- acconto;
- saldo.

La pagina `Acconto e Saldo Tecnologie` non forza tutte le tecnologie: legge la policy dal Magazzino Tecnologie. Se la policy e `deposit_balance`, il flusso acconto/saldo e attivo.

Nota importante:

- `reserve_stock_for_deposit_order()` puo riservare/scalare lo stock del prodotto fisico quando un ordine acconto passa in lavorazione/completato.
- Questo e un punto operativo reale, diverso dal B2B Order Bridge che non scala stock.

## Commerce Control Room

La Commerce Control Room e read-only.

Aggrega:

- WooCommerce checkout;
- Commerce Policy;
- B2B Order Bridge;
- Catalogo prodotti;
- Price Guard;
- Claim Guard;
- Settlement pagamenti;
- WaaS commerciale;
- Smart Desk Bridge;
- Universal Core.

Regole:

- Suite e UI/control plane;
- non deve diventare ERP completo;
- non deve essere gateway pagamento;
- non deve duplicare il motore decisionale Core;
- azioni sensibili richiedono Core/owner.

## Nyra / Business Brain

Suite crea snapshot read-only per Nyra:

- Price Guard;
- pricing coherence;
- channel risk;
- Universal Core commercial decision;
- business brain.

Output:

- postura commerciale;
- priorita;
- next best step;
- rischio;
- cosa ignorare;
- owner confirmation required.

Guardrail:

- read-only;
- nessun cambio prezzo automatico;
- nessun push campagne automatico;
- nessuna esposizione dati personali;
- nessun claim finanziario/legale.

## Cosa Funziona Oggi

- Price Guard pubblico scansiona pagine e listino ufficiale.
- Value Chain Pricing calcola davvero margini e rischio.
- Safe policy crea una nuova policy corretta senza sovrascrivere.
- Snapshot e audit sono generati.
- Access policy filiera esiste.
- B2B Order Bridge crea richieste interne.
- Commerce Policy distingue pagamento, preventivo, disponibilita, B2B riservato e autorizzazione.
- Commerce Control Room aggrega tutto in lettura.
- Acconto/saldo tecnologie e collegato a WooCommerce.

## Cosa Resta Debole

- Price List Engine non e ancora un motore completo centralizzato.
- Commerce Policy fisico e ancora structure/health; logica reale nel monolite.
- B2B Engine fisico e read-only/parziale; logica reale nel monolite.
- Value Chain non e ancora collegata a un ERP esterno.
- Non c'e propagazione prezzo automatica verso rete.
- Non c'e policy many-brand/many-distributor completamente separata su database centrale.
- Non c'e event bus esecutivo; molte azioni sono admin-post/manuali.
- Price Guard rileva importi, ma non capisce ancora contratti, bundle e prezzi riservati.

## Verdetto

Il blocco economico e uno dei piu maturi della Suite: la matematica value chain esiste davvero ed e gia separata. Il rischio principale non e funzionale, ma architetturale: molte superfici commerce restano nel monolite e alcuni moduli fisici sono descrittivi.

Per chiudere enterprise-grade servono tre passi:

1. estrarre Commerce Policy e B2B Order Bridge in moduli/engine reali;
2. trasformare Price List Engine nel motore unico per listini, contratti, sconti, offerte riservate e bundle;
3. collegare Value Chain, CRM, Order Bridge e Core con snapshot/eventi standard e API key scoped.

## Prossimo Blocco

Blocco 05 consigliato:

- Template/Page Factory;
- clonazione sito;
- Waas template gallery;
- template wizard;
- page governance;
- clone engine;
- regole UI enterprise per evitare pagine fuori stile.
