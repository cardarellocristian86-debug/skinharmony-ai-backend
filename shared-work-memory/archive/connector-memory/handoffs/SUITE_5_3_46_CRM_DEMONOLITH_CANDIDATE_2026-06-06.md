# Suite 5.3.46 CRM De-monolith Candidate

Data: `2026-06-06`

## Punto fermo
- Si riparte dal comportamento `5.3.44`.
- `5.3.45` resta scartata perche introduce `light view` nel `CRM B2B`.

## Cosa contiene `5.3.46`
- rollback del ramo `light view` su:
  - `render_dashboard()`
  - `render_waas_analytics_admin()`
  - `render_b2b_crm_admin()`
- primo taglio anti-monolite sul `CRM B2B`:
  - `get_b2b_crm_admin_context()`
  - `render_b2b_crm_admin_notices()`
  - `render_b2b_crm_account_form_panel()`

## Perche questa direzione e corretta
- non cambia il flusso operativo
- non aggiunge schermate intermedie
- riduce il peso del metodo principale
- prepara la separazione progressiva di pannelli e builder piu grandi

## Artefatti
- zip locale: `dist/skinharmony-site-suite-5.3.46.zip`
- closure report: `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_46_LOCAL_2026-05-19.json`

## Prossimo blocco corretto
- estrarre dal `CRM B2B`:
  - `legacy registry panel`
  - `order ledger panel`
- poi applicare lo stesso criterio a:
  - `render_dashboard()`
  - `render_waas_analytics_admin()`

## Regola da non violare
- la performance non si recupera cambiando il flusso di lavoro dei pannelli operativi
- la performance si recupera separando builder, cacheando dietro le quinte e spostando i carichi profondi fuori dal first paint
