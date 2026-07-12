# Suite Block 10 - Inventory, WooCommerce Bridge, Fulfillment, Barcode, Settlements

Data lettura: 2026-05-24
Versione Suite rilevata: 5.2.37

## Scope Del Blocco

Questo blocco mappa la parte ERP-light e commerce operativo: magazzino tecnologie/prodotti, WooCommerce Bridge, barcode/warehouse, fulfillment e settlement.

File principali letti:

- `wordpress/plugins/skinharmony-site-suite/modules/technology-inventory/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/warehouse-barcode/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/fulfillment-control/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/payment-settlements/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/woocommerce-bridge/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/commerce-control-room/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`

## Tesi Operativa

Suite ha già un ERP-light di controllo, ma non è ancora un ERP runtime completo.

Fa:

- legge prodotti WooCommerce;
- legge stock tecnologie;
- mostra stati disponibilità;
- legge gateway;
- legge ordini;
- prepara settlement manuale;
- definisce stati fulfillment;
- struttura barcode/movimenti;
- può riservare stock in alcuni hook legacy controllati.

Non fa:

- non muove denaro;
- non cattura pagamenti;
- non fa payout;
- non cambia gateway;
- non muta ordini da modulo;
- non fa fulfillment automatico completo;
- non deve inventare commissioni o percentuali.

## Technology Inventory

Modulo:

- `modules/technology-inventory/class-module.php`

Admin pages:

- `shss-technology-inventory`
- `shss-technology-deposits`
- `shss-technology-orders`

Runtime:

- `modular_readonly_inventory`

Storage:

- WooCommerce products;
- technology catalog slugs.

UI corrente:

- dal 5.2.93 la pagina admin `shss-technology-inventory` è presentata come `Technology Governance Hub`;
- mantiene la logica già presente: creazione prodotto pieno, acconto e saldo; duplicazione modello; stock; backorder; barcode; evasione; listino/consegna; scorta minima; policy vendita; B2B Order Bridge; owner confirmation;
- aggiunge hero enterprise, KPI tecnologia, `Technology Action Center`, empty state guidata e `Governance Flow`;
- la pagina governa catalogo, stock e policy; non diventa un mini CRM e non deve duplicare trattative, offerte, sconti o marginalità reale;
- WooCommerce vende solo se il prodotto è pubblicato/collegato e la policy lo consente; B2B e acconto/saldo leggono le stesse tecnologie senza evasione automatica fuori dai flussi confermati.
- dal `2026-06-05` la regola è esplicita: nuove tecnologie = `Technology Registry` soltanto. Se manca il listino ufficiale, la tecnologia può restare `registry-only` / quote-only, leggibile da CRM, senza creare duplicati nel `Product Registry`.
- l'attivazione WooCommerce delle tecnologie parte dal master tecnologia e richiede prezzo ufficiale reale; Woo non crea una seconda anagrafica.

Tecnologie base:

- Skin Pro -> `skin-pro-tecnologia`
- Termosauna -> `termosauna-skinharmony`
- O3 System -> `o3-system-tecnologia`

Snapshot:

- configured products;
- found products;
- available;
- on_request;
- missing;
- stock quantity;
- backorders allowed.

Dipendenza:

- WooCommerce / `wc_get_product`.

## Product Inventory Nel Monolite

Funzioni monolite rilevate:

- `render_product_inventory_admin()`
- `get_product_inventory_items()`
- `get_product_inventory_status()`
- `handle_add_product_inventory_item()`
- `handle_duplicate_product_inventory_item()`
- `handle_save_product_inventory()`

Ruolo:

- magazzino prodotti/cosmetici/kit/materiali B2B;
- letto dal B2B Order Bridge;
- distinto dal magazzino tecnologie.

UI corrente:

- dal 5.2.91 la pagina admin `shss-product-inventory` è presentata come `Product Governance Hub` / `Product Control Center`, ma con responsabilità `Master Product Registry`;
- mostra hero enterprise, KPI catalogo, `Product Action Center`, empty state guidata, `Product Registry` e `Governance Flow`;
- salva dati master prodotto: nome, SKU/barcode, brand/nodo, categoria, stock, prezzo acquisto, IVA acquisto, aliquota IVA, MSRP, IVA vendita, visibilità CRM/B2B/WooCommerce e tipo prodotto;
- calcola solo valori tecnici di registry: costo netto da IVA, MSRP netto/lordo e prezzo pubblico WooCommerce previsto;
- WooCommerce price modes: `MSRP`, prezzo manuale sito, `MSRP con sconto`; questi valori restano configurazione governata, non pubblicazione automatica;
- CRM resta responsabile di filiera, sconti, offerte, prezzo manuale, margine commerciale, alert sotto soglia e owner confirmation;
- conferma owner sempre visibile: nessuna pubblicazione prezzo WooCommerce, modifica prezzo, claim o movimento stock automatico non autorizzato.

## CRM Order Ledger Bridge 5.2.95

Il nuovo `CRM Order Ledger` collega inventory e commerce senza spostare la proprieta dei dati:

- legge Product Registry e Technology Registry per nome, SKU/key, costo netto, prezzo netto e stock;
- le tecnologie senza listino ufficiale possono restare nel Technology Registry con prezzo `0` e stato operativo quote-only; il CRM le legge comunque come anagrafica, senza forzare WooCommerce.
- legge/sincronizza ordini WooCommerce quando gli ordini passano in `processing` o `completed`;
- legge richieste B2B Order Bridge e le rende visibili nel cockpit cliente;
- consente ordine assistito CRM manuale, richiesta B2B o bozza WooCommerce, sempre con governance owner;
- non modifica registry prodotti/tecnologie;
- non cattura pagamenti;
- non scala stock dal CRM;
- non sostituisce Payment Settlements o Value Chain Pricing.

Regola operativa:

`Cliente -> Ordine WooCommerce/B2B/CRM assistito -> Product/Technology Registry -> Payment Settlements -> Value Chain Pricing -> Timeline Cliente`.

Nota:

Il modulo fisico per product inventory non è separato come classe dedicata in `modules/`; la logica vive nel monolite.

## Warehouse / Barcode

Modulo:

- `modules/warehouse-barcode/class-module.php`

Stato:

- structure ready;
- non ha REST/shortcode;
- dipende da WooCommerce.

Purpose:

- carico;
- scarico;
- riserva stock;
- barcode;
- SKU;
- inventario;
- movimenti merce.

Movement types:

- `load`
- `unload`
- `reserve`
- `release_reserve`
- `adjustment`
- `return`

Planned fields:

- sku;
- barcode;
- warehouse_location;
- stock_reserved;
- stock_available;
- movement_log.

Policy:

- lo stock può essere riservato da commerce policy controllata;
- cambi irreversibili richiedono evento tracciabile.

Verità:

È ancora struttura/contratto, non magazzino barcode runtime completo.

## Fulfillment Control

Modulo:

- `modules/fulfillment-control/class-module.php`

Stato:

- structure ready;
- nessuna UI/REST/shortcode diretta;
- dipende da WooCommerce.

Purpose:

- evasione ordine;
- saldo;
- preparazione;
- spedizione;
- tracking;
- blocchi operativi.

Order states:

- draft;
- requested;
- waiting_approval;
- approved;
- awaiting_payment;
- paid;
- preparing;
- shipped;
- completed;
- cancelled.

Blocking rules:

- acconto/saldo richiede saldo prima della spedizione;
- B2B reserved richiede approvazione interna;
- quote only richiede accettazione preventivo;
- not sellable blocca checkout.

Policy:

- prepara next action;
- spedizione e conferma pagamento restano controllate da operatore.

## WooCommerce Bridge

Modulo:

- `modules/woocommerce-bridge/class-module.php`

Stato:

- read-only governance;
- legge WooCommerce, gateway, prodotti abbonamento, ordini tecnologia;
- le mutazioni reali restano legacy monolith.

Admin pages:

- `shss-technology-inventory`
- `shss-technology-orders`
- `shss-waas-subscription-products`
- `shss-payment-settlements`

Endpoint collegati:

- `/wp-json/shss/v1/waas-manager/b2b-order-bridge`
- `/wp-json/shss/v1/waas-manager/payment-settlements`

Hook osservati:

- `woocommerce_order_status_processing`
  - `reserve_stock_for_deposit_order`
  - `maybe_create_waas_license_from_order`
- `woocommerce_order_status_completed`
  - `reserve_stock_for_deposit_order`
  - `maybe_create_waas_license_from_order`
- `woocommerce_before_order_notes`
  - `render_waas_checkout_license_fields`
- `woocommerce_checkout_process`
  - `validate_waas_checkout_license_fields`
- `woocommerce_checkout_create_order`
  - `save_waas_checkout_license_fields`

Safety:

- automatic stock reserve dal modulo: false;
- automatic order mutation: false;
- automatic license creation dal modulo: false;
- checkout field injection dal modulo: false;
- payment capture: false.

Subscription products expected:

- Smart Desk Base mensile/annuale;
- Smart Desk Silver mensile/annuale;
- Smart Desk Gold mensile/annuale;
- WaaS Setup bozza;
- WaaS Licenza Annuale bozza.

Prezzi Smart Desk attesi nel bridge:

- Base mensile 29;
- Base annuale 295.80;
- Silver mensile 79;
- Silver annuale 758.40;
- Gold mensile 179;
- Gold annuale 1611.

Nota:

Questi sono controlli di allineamento prodotto, non autorizzano a inventare nuovi prezzi.

## Payment Settlements

Modulo:

- `modules/payment-settlements/class-module.php`

Endpoint:

- `/wp-json/shss/v1/waas-manager/payment-settlements`

Stato:

- read-only manual control;
- legge gateway e ordini;
- costruisce righe settlement per prodotti tecnologia;
- nessun movimento denaro.

Storage/lettura:

- WooCommerce gateways;
- WooCommerce orders;
- prodotti tecnologia/deposito/saldo.

Technology order items:

- Skin Pro full/deposit/balance;
- Termosauna full/deposit/balance;
- O3 System full/deposit/balance.

Settlement rows:

- order_id;
- created_at;
- customer masked;
- product label;
- payment type;
- order total;
- payment method;
- settlement_state = manual_review;
- next step.

Governance:

- no split payments automatici;
- no payout;
- no refund;
- no subscription billing;
- no revenue share;
- no partner commission;
- no gateway changes;
- contract rules required;
- owner confirmation required.

Regole:

- legge gateway e ordini, ma non muove denaro;
- split/payout/commissioni/revenue share richiedono contratto e controllo umano;
- nessuna percentuale inventata;
- refund/storni restano gateway o WooCommerce;
- BNPL/abbonamenti solo dopo scelta gateway e verifica fiscale.

## Commerce Control Room

Modulo:

- `modules/commerce-control-room/class-module.php`

Ruolo:

- pannello read-only unico per commerce, B2B, WooCommerce, Price/Claim Guard, settlement, Smart Desk e blocchi per pacchetto.

Package blocks:

- base: schede prodotto, lead/preventivo, scan claim/prezzo;
- silver: policy catalogo, CRM B2B, settlement manuale;
- gold: Smart Desk Bridge, Core assisted review, Price Guard operativo;
- network: distributori, multi-tenant, franchising, Render dedicated ready.

Policy:

- no checkout automatico;
- no mutation ordine;
- no stock reserve automatico da modulo;
- no capture pagamento;
- owner confirmation required.

## Cosa È Operativo

- Lettura prodotti tecnologie WooCommerce.
- Lettura stock/base availability.
- Magazzino prodotti nel monolite.
- B2B bridge legge catalogo tecnologie + prodotti.
- WooCommerce Bridge legge gateway, ordini e prodotti abbonamento.
- Settlement rows manual review.
- Hook legacy per riserva stock deposito e licenze ordine.
- Control Room commerce read-only.
- CRM Order Ledger `5.2.96` legge Payment Settlements e Value Chain Pricing come segnali di review/attenzione, senza diventare motore di pagamento o margine.

## Cosa È Parziale

- Warehouse/barcode è struttura, non runtime completo.
- Fulfillment Control è struttura, non workflow operativo completo.
- Payment Settlements non muove soldi e non fa payout.
- Product Inventory è monolite, non modulo estratto.
- WooCommerce Bridge è osservatore/read-only nel modulo; mutazioni nel monolite legacy.

## Cosa Non Va Promesso

- ERP completo.
- Payout automatici.
- Revenue share automatico.
- Stock e barcode industriale completo.
- Fulfillment automatico.
- Spedizioni automatiche.
- Gateway configurato o cambiato dal plugin.

## Regola Di Evoluzione

Prima di renderlo ERP-light vendibile:

1. separare Product Inventory in modulo dedicato;
2. rendere movimenti stock tracciati con event log;
3. collegare fulfillment a stati ordine reali;
4. mantenere settlement manuale finché non esistono contratti;
5. rendere ogni mutazione stock/pagamento owner-confirmed e auditata;
6. usare Commerce Control Room come cockpit, non come motore di pagamento.

## Aggiornamento 2026-05-29 - Settlement / Value Chain Bridge 5.2.96

Site Suite `5.2.96` aggiunge il ponte di lettura tra `CRM Order Ledger`, `Payment Settlements` e `Value Chain Pricing Guard`.

Comportamento:

- il ledger arricchisce gli ordini con `settlement_state` e `settlement_next_step`;
- il ledger arricchisce gli ordini con `value_chain_risk_status`, `value_chain_risk_score` e `value_chain_next_action`;
- Company Cockpit 360 mostra quanti ordini richiedono settlement review e quanti hanno attenzione Value Chain;
- la timeline cliente mostra eventi settlement/value-chain solo quando servono azione o verifica.

Governance:

- nessuna capture pagamento;
- nessun payout;
- nessuna modifica prezzo;
- nessuna mutazione stock;
- owner confirmation richiesta quando review o rischio sono presenti.

Stato release:

- locale OK: `php -l`, suite checks `1612/1612`, closure `22/22`;
- zip locale: `dist/skinharmony-site-suite-5.2.96.zip`;
- release/upload bloccato da Core irraggiungibile su `127.0.0.1:3199`.
