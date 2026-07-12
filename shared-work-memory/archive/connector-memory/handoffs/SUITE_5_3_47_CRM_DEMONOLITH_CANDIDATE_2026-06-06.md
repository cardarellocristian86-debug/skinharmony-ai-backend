# Suite 5.3.47 CRM De-monolith Candidate

Data: `2026-06-06`

## Punto fermo
- Si continua dal comportamento `5.3.44`.
- `5.3.45` resta scartata perche introduce `light view` nel `CRM B2B`.
- `5.3.46` ha aperto il primo taglio strutturale senza cambiare UX.

## Cosa contiene `5.3.47`
- conferma del rollback del ramo `light view` su:
  - `render_dashboard()`
  - `render_waas_analytics_admin()`
  - `render_b2b_crm_admin()`
- secondo taglio anti-monolite sul `CRM B2B`:
  - `get_b2b_crm_admin_context()`
  - `render_b2b_crm_admin_notices()`
  - `render_b2b_crm_account_form_panel()`
  - `render_b2b_crm_legacy_registry_panel()`
  - `render_b2b_crm_rules_panel()`

## Confine attuale
- Il pannello ordini/ledger non e stato toccato.
- Un gate iniziale sul refactor che citava il perimetro `ledger` e stato bloccato dal connector locale con `local_hard_gate:ledger`.
- Il lavoro `.47` e quindi stato ristretto ai blocchi CRM non protetti dal gate.

## Perche questa direzione e corretta
- non cambia il flusso operativo
- non aggiunge schermate intermedie
- continua a ridurre il peso del metodo principale
- prepara la separazione progressiva dei pannelli rimasti senza forzare domini protetti

## Artefatti
- zip locale: `dist/skinharmony-site-suite-5.3.47.zip`
- closure report: `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_47_LOCAL_2026-05-19.json`
- Core report usato: `reports/codex-core/codex_core_gate_latest.json`

## Prossimo blocco corretto
- continuare a estrarre dal `CRM B2B` solo blocchi non protetti dal gate locale
- poi applicare lo stesso criterio a:
  - `render_dashboard()`
  - `render_waas_analytics_admin()`

## Regola da non violare
- la performance non si recupera cambiando il flusso di lavoro dei pannelli operativi
- la performance si recupera separando builder, cacheando dietro le quinte e spostando i carichi profondi fuori dal first paint
