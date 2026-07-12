# Suite Block 03 - CRM B2B, Account Graph, Customer/Node 360

Data mappatura: 2026-05-24

## Scopo Del Blocco

Questo blocco descrive la parte CRM B2B di SkinHarmony Site Suite: account, nodi di rete, pipeline commerciale, documenti, email, preventivi e Customer/Node 360.

La logica verificata conferma che il CRM non e solo una rubrica: e il primo layer operativo della rete commerciale Suite. Mostra chi e il nodo, che ruolo ha nella filiera, con chi e collegato, quale rischio ha, cosa deve fare l'owner e quali informazioni devono arrivare a Core, Commerce, Smart Desk e report.

## File Letti

- `wordpress/plugins/skinharmony-site-suite/modules/crm-b2b/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
- `wordpress/plugins/skinharmony-site-suite/assets/site-suite.css`
- `wordpress/plugins/skinharmony-site-suite/assets/site-suite-admin.js`

## Verita Architetturale

Il modulo fisico `modules/crm-b2b/class-module.php` e ancora soprattutto dichiarativo:

- `init()`, `register_admin()`, `register_rest()` e `register_shortcodes()` sono vuoti.
- `health()` dichiara runtime, pagina admin, REST route, capacita pronte e capacita pianificate.
- La logica operativa reale vive nel monolite `skinharmony-site-suite.php`.

Quindi oggi la verita e:

- modulo CRM = metadata/health/readiness;
- monolite Suite = UI, handler, storage, export, Customer 360 e collegamenti.

## Admin E Rotte

La pagina CRM e registrata sotto il menu Suite con slug:

- `shss-b2b-crm`

La renderizzazione principale passa da:

- `render_b2b_crm_admin()`
- `render_b2b_crm_enterprise_dashboard()`

Gli handler admin operativi sono:

- `admin_post_shss_save_b2b_crm_contact`
- `admin_post_shss_duplicate_b2b_crm_contact`
- `admin_post_shss_delete_b2b_crm_contact`
- `admin_post_shss_convert_b2b_crm_to_customer`
- `admin_post_shss_create_b2b_crm_quote`
- `admin_post_shss_create_b2b_crm_order`
- `admin_post_shss_export_b2b_crm_contacts_csv`
- `admin_post_shss_save_b2b_crm_email_thread`
- `admin_post_shss_delete_b2b_crm_email_thread`
- `admin_post_shss_save_b2b_crm_document`
- `admin_post_shss_delete_b2b_crm_document`
- `admin_post_shss_export_b2b_crm_documents_csv`

REST operativo aggiunto in `5.2.95`:

- `GET /wp-json/shss/v1/waas-manager/crm-order-ledger`

REST operativo aggiunto in `5.3.0`:

- `GET /wp-json/shss/v1/waas-manager/crm-erp-lite/snapshot`
- `POST /wp-json/shss/v1/waas-manager/crm-erp-lite/e2e-cleanup`

Render receiver collegato in `5.3.0`:

- `POST /api/suite/commerce/snapshot`

## CRM Order Ledger 5.2.95

Il CRM B2B diventa `ERP Lite Commercial Control Layer`, non un secondo ERP.

Nuova responsabilita:

- creare o leggere ordini assistiti senza duplicare le fonti master;
- aggregare righe da WooCommerce, B2B Order Bridge e CRM manuale;
- mostrare nel Company Cockpit 360 ordini, valore netto, margine base e owner required;
- alimentare una timeline cliente unica con ordini, email, documenti e follow-up.

Source of truth:

- prodotti: `Product Governance Hub`;
- tecnologie: `Technology Governance Hub`;
- ordini sito: `WooCommerce`;
- richieste B2B: `B2B Order Bridge`;
- pagamenti: `Payment Settlements`;
- margini complessi: `Value Chain Pricing Guard`;
- timeline: vista aggregata CRM.

Storage leggero:

- `shss_crm_order_ledger`

Il ledger salva riferimenti e snapshot operativi, non sostituisce ordini WooCommerce, registry prodotti/tecnologie o pagamenti.

## CRM ERP Lite Render Snapshot 5.3.0

La Suite espone una vista aggregata/sanificata del CRM ERP Lite per il Suite Control Plane Render.

Responsabilita:

- WordPress resta fonte operativa locale per CRM, registri prodotti/tecnologie, WooCommerce e documenti;
- Render riceve un commerce snapshot tenant-scoped con sezione `crm_erp_lite`;
- il payload contiene riepiloghi, ledger preview sanificata, source of truth e guardrail;
- i record cliente grezzi non vengono inviati;
- i record E2E vengono esclusi dalla lettura snapshot per non sporcare KPI e readiness.

Endpoint WordPress:

- `GET /wp-json/shss/v1/waas-manager/crm-erp-lite/snapshot`
- `POST /wp-json/shss/v1/waas-manager/crm-erp-lite/e2e-cleanup`

Endpoint Render:

- `POST /api/suite/commerce/snapshot`

Guardrail:

- nessuna cattura pagamento;
- nessuno stock scalato;
- nessun prezzo WooCommerce pubblicato;
- nessuna duplicazione ERP;
- conferma owner obbligatoria per azioni reali.

## E2E Visibility Guard 5.3.1

Il cleanup fisico dei record E2E non va considerato percorso ordinario: Core ha bloccato la cancellazione ledger con `local_hard_gate:ledger`.

La soluzione attiva e una guardia di visibilita:

- i record test restano nello storage per audit e cleanup governato;
- `Product Governance Hub` usa una vista operativa filtrata e mostra `summary.e2e_hidden`;
- `Technology Governance Hub` filtra le definizioni E2E dalla vista commerciale;
- lo snapshot CRM ERP Lite continua a calcolare `e2e_records_hidden` leggendo raw storage, ma espone conteggi master puliti;
- nessuna cancellazione, nessun cambio stock, nessun cambio prezzo, nessun pagamento e nessun dato cliente reale vengono modificati.

Regola: se un E2E crea dati di prova, la UI operativa non deve venderli o contarli come catalogo reale. La rimozione fisica resta azione separata, gate Core e owner-confirmed.

## Storage

Il CRM usa option WordPress, non tabelle dedicate.

Storage principali:

- `shss_b2b_crm_contacts`
- `shss_b2b_crm_email_threads`
- `shss_b2b_crm_documents`
- `shss_waas_commercial_proposals`

Limiti interni:

- contatti CRM salvati fino a circa 500 record;
- thread email fino a circa 1000 record;
- documenti fino a circa 2000 record.

Questo rende il CRM leggero e adatto al nodo WordPress, ma per uso enterprise multi-tenant grande va previsto sync/estrazione verso backend centrale.

## Account B2B

Ogni azienda viene normalizzata come nodo commerciale.

Campi principali:

- `company_name`
- `contact_name`
- `customer_type`
- `sector`
- `value_chain_role`
- `price_group`
- `discount_policy`
- `commercial_plan`
- `account_tier`
- `payment_policy`
- `approval_required`
- `order_limit_note`
- `email`
- `phone`
- `vat_number`
- `pec`
- `area`
- `assigned_agent`
- `connected_distributor_id`
- `status`
- `order_status`
- `payment_status`
- `delivery_status`
- `lost_reason`
- `privacy_documents_status`
- `estimated_order_value`
- `next_followup_date`
- `last_order_at`
- `total_orders`
- `total_revenue`
- `notes`
- `decision_snapshot`
- `next_step`

Tipi nodo verificati:

- brand
- factory
- distributor
- supplier
- pharmacy
- herbal store
- hair salon
- beauty center
- wellness
- retail
- partner B2B
- other

Ruoli filiera:

- factory
- brand
- distributor
- operator
- partner
- mixed

## Pipeline Commerciale

La dashboard CRM crea una vista enterprise con:

- KPI aziendali;
- widget pipeline;
- widget attivita;
- alert;
- AI/Core future-ready;
- logica lead -> CRM -> journey;
- tabella aziende;
- cockpit azienda.

Stati pipeline presenti:

- nuovo contatto;
- qualifica;
- proposta inviata;
- trattativa;
- documenti;
- vinto;
- perso;
- follow-up;
- cliente;
- partner attivo;
- trial;
- rinnovo;
- upsell.

La pipeline e oggi visuale e filtrata per stato. Il drag and drop reale e dichiarato come futuro, non ancora chiuso.

## Azioni CRM

Azioni operative gia presenti:

- crea/modifica account;
- duplica account;
- elimina account;
- trasforma lead in cliente/partner;
- crea preventivo/proposta;
- esporta contatti CSV;
- salva thread email;
- elimina thread email;
- salva documento;
- elimina documento;
- esporta documenti CSV.

Guardrail importanti:

- nessun ordine viene creato automaticamente dal CRM;
- nessuna modifica stock automatica;
- nessun enforcement pubblico dei prezzi dal CRM;
- nessun pagamento o settlement automatico;
- conferma owner richiesta sulle azioni critiche di prezzo/listino.

## Decision Snapshot CRM

Ogni contatto ha una lettura decisionale locale tramite `get_b2b_crm_contact_decision_snapshot()`.

Il sistema legge:

- completezza anagrafica;
- ruolo filiera;
- stato documenti/privacy;
- approvazione richiesta;
- stato ordine;
- stato pagamento;
- stato consegna;
- follow-up scaduto;
- rischio commerciale.

Output:

- risk score;
- readiness;
- priority;
- warnings;
- next best action;
- automation mode.

La logica e rule-based locale, non AI libera. L'automazione resta `manual_confirm_only`.

## Email Thread

Il CRM include accorpamento manuale/importato delle email per oggetto.

Storage:

- `shss_b2b_crm_email_threads`

Normalizzazione soggetto:

- rimuove prefissi tipo `re`, `r`, `fw`, `fwd`, `i`, `inoltro`, `ris`;
- crea chiave gruppo `contact_id|subject_key`.

Direzioni:

- incoming;
- outgoing;
- reply;
- forward;
- internal_note.

Stati:

- open;
- waiting_reply;
- answered;
- followup;
- closed.

Limite attuale: non legge direttamente una mailbox. Funziona come archivio/import manuale governato dal CRM.

## Documenti Cliente

Il CRM include ricerca e archivio rapido di documenti cliente.

Storage:

- `shss_b2b_crm_documents`

Tipi:

- invoice;
- delivery_note;
- ddt;
- credit_note;
- quote;
- contract;
- order;
- other.

Campi:

- contatto collegato;
- tipo documento;
- numero;
- titolo;
- data;
- scadenza;
- importo;
- stato;
- URL file;
- tag;
- note.

Ricerca:

- titolo;
- numero;
- tipo;
- stato;
- tag;
- note;
- contatto.

Limite attuale: e un indice documentale operativo, non conservazione fiscale e non gestionale contabile completo.

## Preventivi

`handle_create_b2b_crm_quote()` crea una proposta commerciale WaaS partendo dal contatto CRM.

Effetto:

- scrive in `shss_waas_commercial_proposals`;
- collega contatto, piano, valore stimato e note;
- aggiunge evento audit `b2b_crm_quote_created`.

Questa e una connessione reale tra CRM e area commerciale Suite, ma non genera ordine o checkout automatico.

## Customer / Node 360

`get_suite_customer_node_360_status()` costruisce una vista unificata dei nodi.

Fonti lette:

- CRM B2B;
- lead/analytics;
- inventario prodotti;
- payment settlement;
- license registry;
- Smart Desk bridge.

Output per ogni nodo:

- node id;
- label;
- tipo;
- settore;
- ruolo filiera;
- piano commerciale;
- stato;
- readiness score;
- risk score;
- priorita;
- valore stimato;
- ordini;
- revenue;
- stato documenti/consenso;
- commerce summary;
- relationship summary;
- warning;
- next best action;
- human actions;
- automation allowed.

Customer 360 e read-only/cache: non scrive score nei profili e non invia marketing, ordini, stock o pagamenti.

## Collegamenti Con Altri Blocchi

### Value Chain / Commerce

Il CRM espone price group, discount policy, connected distributor e approval requirement. Questi campi sono il ponte verso:

- Value Chain Pricing;
- Commerce Policy;
- Order Bridge;
- Price Guard.

### Smart Desk

Customer 360 prepara payload per Smart Desk Gold, ma con blocchi:

- no full customer export;
- no auto WhatsApp/email;
- no writeback automatico;
- conferma operatore.

### Event Spine

Il CRM alimenta eventi logici come:

- lead/follow-up;
- order requested;
- payment review;
- stock low;
- claim issue;
- price issue;
- license change;
- smartdesk pulse;
- core gate decision.

Lo spine e ancora read-only/tassonomico, non bus eventi esecutivo.

### Core / Nyra

Il CRM prepara snapshot e next action. Core resta il giudice per policy/rischio quando collegato; Nyra puo spiegare. Il CRM non deve diventare AI autonoma.

## Cosa Funziona Oggi

- Account B2B strutturato.
- Campo filiera con ruoli e listini.
- Dashboard enterprise CRM.
- Pipeline visuale per stato.
- CRUD account.
- Duplica/elimina/converte lead.
- Crea proposta/preventivo.
- Export contatti CSV.
- Email grouping per oggetto.
- Archivio documenti con ricerca.
- Customer/Node 360 read-only.
- Collegamenti concettuali e dati verso Value Chain, Smart Desk, Event Spine e Core.
- CRM Order Ledger `5.2.96` come layer ponte/read-only-operativo: aggrega ordini WooCommerce, B2B e CRM assistiti senza duplicare source of truth.
- Company Cockpit 360 legge riepilogo ordini, valore netto, margine base, review Payment Settlements e attenzione Value Chain.
- Timeline cliente unificata include eventi ordine, payment review e rischio prezzo/margine quando emergono dai moduli sorgente.

## Cosa Resta Debole

- Il modulo `modules/crm-b2b` non contiene ancora la logica vera.
- Il monolite resta troppo centrale.
- Non ci sono tabelle dedicate o data layer enterprise.
- Non c'e drag and drop pipeline operativo.
- Non c'e sync mailbox reale.
- Non c'e conservazione documentale/fiscale.
- Non c'e graph arbitrario completo many-to-many tra nodi.
- Non c'e workflow engine esecutivo; le azioni restano admin-post/manuali.
- Customer 360 e cache/read-only, non ancora state engine centrale.

## Verdetto

Il CRM B2B e gia operativo come CRM leggero di rete dentro WordPress, non e solo placeholder. Pero la sua maturita enterprise dipende da tre passaggi:

1. estrarre la logica CRM dal monolite in engine/modulo reale;
2. rendere il relationship graph piu generale e multi-relazione;
3. collegare CRM, Value Chain, Order Bridge, Core e Smart Desk con contratti snapshot/eventi piu forti.

## Prossimo Blocco

Blocco 04 consigliato:

- Value Chain Pricing;
- Price Guard;
- Commerce Policy;
- Order Bridge;
- sconti, margini e guardrail filiera.

## Aggiornamento 2026-05-29 - CRM Order Ledger 5.2.96

Site Suite `5.2.96` è pronta localmente e non caricata perché Core 2.0 locale è irraggiungibile su `127.0.0.1:3199`.

Source of truth confermate:

- ordini sito: WooCommerce;
- richieste B2B: B2B Order Bridge;
- prodotti: Product Governance Hub;
- tecnologie: Technology Governance Hub;
- pagamenti/review: Payment Settlements;
- rischio prezzo/margine: Value Chain Pricing Guard;
- cockpit/timeline: CRM B2B come orchestrazione e lettura.

Il CRM non scala stock, non cattura pagamenti, non modifica prodotti/tecnologie e non pubblica prezzi. Quando Payment Settlements o Value Chain segnalano attenzione, il ledger mostra `owner confirmation required`.

## Aggiornamento 2026-05-29 - Company Cockpit 360 5.2.97

Site Suite `5.2.97` è stata preparata e verificata come base del Company Cockpit 360.

La scheda azienda CRM ora aggrega concretamente:

- Customer Success Follow-up;
- Customer Lifecycle Board;
- Renewal Risk Board;
- Customer Value Board;
- License Registry;
- Product/Technology usage letto dal CRM Order Ledger.

Il matching avviene su ordini WooCommerce collegati al ledger e, quando disponibile, sul dominio licenza. Il CRM resta cockpit/orchestrazione: legge gli altri moduli, ma non diventa source of truth di licenze, rinnovi, ordini, cataloghi, pagamenti o margini.

Test locali:

- `php -l`: OK;
- suite local checks: `1614/1614`;
- closure: `22/22`;
- zip locale: `dist/skinharmony-site-suite-5.2.97.zip`.

## Aggiornamento 2026-05-29 - CRM ERP Lite Closure 5.2.98

Site Suite `5.2.98` è pronta localmente e non caricata. Core 2.0 locale risponde su `127.0.0.1:3199`; gate release finale `ALLOWED`, risk low, report `reports/codex-core/codex_core_gate_latest.json`.

Checklist CRM ERP Lite chiusa:

- licenze reali in scheda azienda: piano, dominio, scadenza, grace period e stato moduli;
- vista ordini aggregata più leggibile: sorgente, pagamento, consegna, margine base, owner alert e azione;
- Customer Success operativo: follow-up, lifecycle, renewal risk e link rapidi a follow-up/rinnovi;
- documenti collegabili a ID ordine, cliente, stato, importo e file;
- stock e disponibilità letti da Product/Technology Registry: stock critico, WooCommerce non collegati e vendibili;
- ruoli multiutente preparati: admin, agente, finance, support;
- dashboard manageriale `ERP Lite Commercial Control Layer`: ordini aperti, pagamenti da verificare, clienti a rischio, rinnovi, pipeline, margine a rischio, follow-up urgenti e licenze attive.

Regola invariata: CRM = orchestrazione/cockpit/timeline. Le source of truth restano WooCommerce, B2B Order Bridge, Product Governance Hub, Technology Governance Hub, Payment Settlements, Value Chain Pricing Guard, License Registry e Customer Success Boards. Il CRM non duplica ERP, non modifica registry, non scala stock, non muove pagamenti e non cambia licenze senza conferma owner.

Test locali:

- `php -l`: OK;
- suite local checks: `1621/1621`;
- closure: `22/22`;
- zip locale: `dist/skinharmony-site-suite-5.2.98.zip`.

## Aggiornamento 2026-05-29 - CRM ERP Lite E2E Test 5.2.99

Site Suite `5.2.99` aggiunge un endpoint di test end-to-end controllato per verificare il primo ciclo CRM/ERP Lite senza trasformare il CRM in ERP e senza duplicare source of truth.

Endpoint:

- `POST /wp-json/shss/v1/waas-manager/crm-erp-lite/e2e-test`

Ciclo verificato dall'endpoint:

1. crea prodotto test nel Product Governance Hub;
2. crea tecnologia test nel Technology Governance Hub;
3. crea cliente CRM;
4. crea ordine assistito;
5. genera bozza WooCommerce se WooCommerce è disponibile;
6. collega documento CRM all'ordine con `source_order_id`;
7. simula pagamento come `manual_review`;
8. verifica vista ordini aggregata;
9. verifica timeline cliente;
10. verifica Company Cockpit.

Guardrail:

- nessun pagamento reale;
- nessuna pubblicazione automatica;
- nessuna riduzione stock;
- nessun ordine duplicato come ERP parallelo;
- owner confirmation richiesta per azioni reali.

Test locali:

- `php -l`: OK;
- suite local checks: `1625/1625`;
- closure: `22/22`;
- zip locale: `dist/skinharmony-site-suite-5.2.99.zip`;
- runner live predisposto: `scripts/run_suite_crm_erp_lite_e2e_live.js`.

Nota Core locale: health diretto `127.0.0.1:3199/health` OK; il gate funziona quando eseguito fuori sandbox.

## Aggiornamento 2026-05-29 - CRM ERP Lite E2E Live Passed

Il primo ciclo completo CRM ERP Lite è passato su WordPress live con Site Suite `5.2.99`.

Evidenza live:

- prodotto creato: `prod_codex_20260529163117`;
- tecnologia creata: `e2e-test-tecnologia-codex_20260529163117`;
- cliente CRM creato: `crm_codex_20260529163117`;
- bozza WooCommerce creata: ordine `2037`;
- riga vista ordini aggregata: `woocommerce_2037_e2e_technology_e2e-test-tecnologia-codex_20260529163117`;
- documento collegato: `doc_0aaa304a1f2d`;
- pagamento simulato: `manual_review`;
- report: `reports/wordpress/suite_crm_erp_lite_e2e_latest.json`.

Check live: `12/12` passati.

Il ciclo conferma che CRM legge/orchestra Product Registry, Technology Registry, WooCommerce, documento, pagamento simulato, timeline e Company Cockpit senza diventare ERP parallelo.

Residuo non bloccante: il runtime check segnala ancora `package_url` manifest su zip `5.2.93`, mentre plugin live e `current_origin_version` sono `5.2.99`.
