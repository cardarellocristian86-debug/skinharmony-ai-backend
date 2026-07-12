# Suite WordPress Heavy Builder Inventory

Data: 2026-06-06
Stato: operativo
Scope: inventario locale dei builder/admin status ancora pesanti in Site Suite; nessun deploy, nessun sync live, nessuna modifica tenant o dati cliente
Gate report: `reports/codex-core/codex_core_gate_latest.json`

## Regole di classificazione

- `resta locale`: source of truth o write path operativo vicino a WordPress/WooCommerce.
- `solo cache`: puo restare in WordPress se letto da snapshot/transient cheap.
- `fuori first paint`: la shell puo restare in wp-admin, ma i calcoli profondi non devono partire all apertura.
- `va su Render`: servizio multi-tenant, registry centrale, audit/evidence, analytics aggregata o snapshot pesante di control plane.

## Builder UI principali

| Schermata | Builder / status | Evidenza reale oggi | Classificazione immediata | Destino corretto | Prossima azione |
| --- | --- | --- | --- | --- | --- |
| Dashboard radice Suite | `render_dashboard()` | in first paint chiama `get_leads()`, `scan_pages_for_claims()`, `scan_pages_for_prices()` | `fuori first paint` | claim/price scan `va su Render`; lead count `resta locale` | separare KPI cheap dai due scan e aprire gli scan solo su richiesta |
| WaaS Enterprise Control Room | `render_waas_control_room_admin()` + `get_waas_control_room_light_status()` | vista light gia attiva, ritorno prima delle board profonde | `resta locale` | shell locale + fallback | non spostare ora; mantenere solo deep links e no deep build in apertura |
| WaaS Manager | `render_waas_manager_admin()` + `get_waas_manager_light_status()` | first paint leggero gia chiuso in `5.3.37`; full status resta separato | `solo cache` | shell locale | tenere full status fuori apertura e usare cache corta sullo snapshot leggero |
| Dashboard WaaS | `render_waas_dashboard_admin()` + `get_waas_dashboard_light_status()` | first paint leggero gia chiuso; full status costruisce lead, ordini, claim/price, network map | `solo cache` | fleet/network summary `va su Render`; shell locale | non riaprire il builder completo in apertura; remotizzare solo la parte fleet/network |
| Analytics WaaS | `render_waas_analytics_admin()` + `get_waas_analytics_status()` | apre subito analytics completi, Google funnel, Event Spine, chart, claim scan, price scan, remote action plan | `va su Render` | BI/Event Spine/action plan Render-first con fallback locale | fare shell con summary cheap e caricare deep diagnostics solo on demand |
| SkinHarmony Core Connector | `render_skinharmony_core_connector_admin()` + `get_core_connector_complete_snapshot_cached()` | light mode ok, ma full snapshot unisce tenant registry, runbook, evidence, remote dashboard, Google provider sync | `solo cache` | control plane state `va su Render`; config UI `resta locale` | lasciare locali solo setup/chiavi mascherate/fallback e leggere il resto da snapshot remoto |
| CRM B2B | `render_b2b_crm_admin()` + `get_b2b_crm_status()` | apre contatti, email, documenti, ledger, commerce policy, enterprise logic, report e cockpit | `fuori first paint` | read model/cockpit `va su Render`; CRUD `resta locale` | tenere locale il write path, ma spezzare la pagina in shell leggera + snapshot profondi |
| CRM Order Ledger | `get_crm_order_ledger_status()` | legge ledger locale, settlements e Value Chain; dominio protetto e vicino a Woo/B2B | `resta locale` | locale con preview cachata | non spostare ora su Render; tenere solo viste read-only e audit locale |
| Payment Settlements | `render_payment_settlements_admin()` + `get_payment_settlements_status()` | reader manuale di gateway e ordini Woo, nessun movimento denaro | `resta locale` | locale | nessun passaggio Render come source of truth |
| Value Chain Pricing Guard | `render_value_chain_pricing_guard_admin()` + `get_value_chain_pricing_guard_status()` | pricing/rischio sensibile e collegato ai registry locali | `resta locale` | locale; advisory remoto solo in futuro | non centralizzare la logica di prezzo ora |
| Product Inventory | `render_product_inventory_admin()` + service modulare | master prodotti veri, Woo/B2C e policy locali | `resta locale` | UI esterna read-only in futuro; write locale | non spostare il master prodotto su Render |
| Technology Inventory | `render_technology_inventory_admin()` + route `technology-inventory` | master tecnologie, CRM/B2B/Woo gating, price pending e SSOT tecnologia | `resta locale` | UI esterna read-only in futuro; write locale | non spostare il master tecnologia su Render |
| Commerce Control Room | `render_commerce_control_room_admin()` + `get_commerce_control_room_status()` | aggregatore sottile con `safe_call` verso moduli locali | `solo cache` | shell locale; servizi pesanti sotto possono uscire | tenere il cockpit locale e remotizzare solo i servizi davvero pesanti sotto |

## Status builder da rendere Render-first

| Componente | Builder | Perche deve uscire dal monolite | Ruolo WordPress dopo lo split |
| --- | --- | --- | --- |
| Tenant Registry | `get_suite_tenant_registry_status()` | multi-tenant e cross-node | mostra stato nodo e fallback locale |
| Suite Control Plane | `get_suite_control_plane_status()` / `get_suite_control_snapshot()` | registry, evidence, runbook, topology e update sono control plane veri | leggere snapshot remoto e mostrare CTA locali |
| Remote Runtime / Runbook Marketplace | `get_suite_remote_runtime_status()` / `get_suite_remote_runbook_marketplace_status()` / dashboard evidence | ownership naturale del runtime remoto | configurazione locale + lettura stato |
| Customer Node 360 | `get_suite_customer_node_360_status()` | snapshot aggregato tra CRM, analytics, inventory, settlements, license, bridge | mostrare preview locale e fallback |
| ERP Lite Backbone | `get_suite_erp_light_backbone_status()` | snapshot commerciale trasversale, adatto a control plane | consumare snapshot pronto |
| Event Spine | `get_suite_event_spine_status()` | aggregazione eventi, osservabilita e storicizzazione | forward locale + fallback |
| Smart Desk Customer Intelligence | `get_suite_smartdesk_customer_intelligence_status()` | vista cross-track tra Suite e Smart Desk, piu naturale su control plane | leggere insight remoti e aprire moduli locali |
| Analytics Action Plan | `get_suite_remote_analytics_action_plan()` | esiste gia il ponte remoto; deve diventare default invece di fallback | fallback locale se Render non risponde |

## P0 da fare adesso

1. `render_dashboard()`:
   togliere `claim scan` e `price scan` dal first paint.
2. `render_waas_analytics_admin()`:
   shell leggera + deep diagnostics lazy; Event Spine e action plan da Render.
3. `render_b2b_crm_admin()`:
   shell light, cockpit e report da snapshot; CRUD e ledger write restano locali.

## P1 subito dopo

1. consolidare `tenant_registry`, `control_plane_status`, `remote_runtime_dashboard`, `runbook_marketplace` come servizi Render-first;
2. usare WordPress come nodo UI/fallback invece di builder completo per ogni stato centrale;
3. mantenere locali solo le scritture che toccano WordPress, WooCommerce o registry master.

## Non spostare adesso

- WooCommerce come source of truth ordini/pagamenti;
- `Product Inventory` come master prodotti;
- `Technology Inventory` come master tecnologie;
- `Value Chain Pricing Guard` come logica autorevole di prezzo;
- `Payment Settlements` come reader operativo locale.

## Decisione operativa

- WordPress deve smettere di fare in apertura i builder profondi di `dashboard root`, `analytics` e `CRM shell`.
- Render deve diventare il proprietario dei blocchi `control plane`, `registry centrale`, `event spine`, `runbook`, `evidence`, `tenant state`, `customer 360` e `analytics action plan`.
- I registry master e i moduli che scrivono su Woo/WordPress restano locali finche non esiste un connector write scoped davvero maturo.
