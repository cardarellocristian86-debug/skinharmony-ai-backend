# Suite 5.3.52 CRM Company 360 Fatal Hotfix Candidate

## Contesto
- Live `Site Suite 5.3.51` risultava installata correttamente.
- Gli endpoint REST chiave erano sani:
  - `/wp-json/shss/v1/status` -> `200`
  - `/wp-json/shss/v1/waas-manager/b2b-crm` -> `200`
  - `/wp-json/shss/v1/waas-manager/crm-order-ledger` -> `200`
  - `/wp-json/shss/v1/waas-manager/control-plane` -> `200`
  - `/wp-json/shss/v1/waas-manager/tenant-registry` -> `200`
- Il crash emerso in browser riguardava quindi il render admin di `CRM B2B`, non il reader REST o i dati base.

## Diagnosi
- Punto piu plausibile: `get_b2b_crm_company_360_status()` nel plugin principale.
- Quel builder viene usato dal cockpit admin della pagina CRM ma non dal reader REST `b2b-crm`.
- Il metodo assumeva sempre presenti:
  - `license_registry['licenses']`
  - `customer_success_followup['followups']`
  - `customer_lifecycle_board['customers']`
  - `renewal_risk_board['customers']`
  - `customer_value_board['customers']`
- Con payload null/parziali, `array_filter()` su PHP 8 puo generare `TypeError` e mandare WordPress nel generic critical error screen.

## Patch chiusa in 5.3.52
- Hardening stretto senza cambiare UX o flussi:
  - validazione `license_registry['licenses']` prima del loop licenze
  - fallback array vuoto per `followups` e `customers` delle board secondarie prima dei `array_filter()`
- Nessuna mutazione live, nessun cambio commerciale, nessun cambio di layout.

## File toccati
- `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
- `SHARED_MEMORY/programs/suite/OPERATIONS.md`
- `SHARED_MEMORY/snapshots/STATE_SNAPSHOT.md`
- `SHARED_MEMORY/snapshots/WORK_SNAPSHOT.md`

## Verifiche locali
- `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
- `node scripts/test_skinharmony_site_suite_plugin.js` -> `1717/1717`
- `node scripts/program_registry_check.js --memory-dir SHARED_MEMORY --require-all-programs` -> `READY`
- `bash scripts/build_skinharmony_site_suite_plugin.sh`
- `node scripts/suite_operational_closure.js --version=5.3.52` -> preflight `22/22`, local test `1717/1717`

## Artefatti
- `dist/skinharmony-site-suite-5.3.52.zip`
- `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_52_LOCAL_2026-05-19.json`
- `reports/wordpress/skinharmony_site_suite_local_latest.json`

## Prossimo passo
1. Riaprire `CRM B2B` in browser sul sito dove compariva l'errore.
2. Riaprire la checklist di verifica dal punto 2 con osservazione manuale:
   - se non ci sono più errori di pagina, passare al check di performance del candidato `5.3.51`.
3. Solo dopo il fix del fatal riprendere il lavoro performance della `5.3.51`.

## Stato aggiornato (2026-06-06)
- Il `package_url` live del manifest è stato riallineato: `5.3.36-1` -> `5.3.52`.
- Manifest ora risulta `distribution_ready: true` e `package_url_matches_version: true`.
- Evidenza: `reports/wordpress/suite_5_3_52_package_upload_manifest_alignment_latest.json`.

## Audit Core
- `reports/codex-core/codex_core_gate_latest.json`
