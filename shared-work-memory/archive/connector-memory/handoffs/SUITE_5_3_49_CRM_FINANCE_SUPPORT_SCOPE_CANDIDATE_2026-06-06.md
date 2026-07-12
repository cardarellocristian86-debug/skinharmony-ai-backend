# Suite 5.3.49 CRM Finance/Support Scope Candidate

Data: `2026-06-06`

## Stato

Preparata in locale la release `5.3.49` di `SkinHarmony Site Suite`, continuando dalla baseline UX `5.3.44` e dal blocco multiutente `5.3.48`.

## Cosa chiude

- matrice `finance/support` nel `CRM B2B` a livello UI/menu
- rilevamento profili CRM ristretti: `agent`, `finance`, `support`
- menu Suite coerente per ruoli CRM ristretti
- desk dedicati:
  - `Finance Desk`
  - `Support Desk`
- cockpit azienda role-aware:
  - niente `Modifica` se il ruolo non puo scrivere
  - niente `Crea ordine assistito` se il ruolo non puo creare ordini
  - ledger read-only quando il ruolo puo solo leggere
- pannelli email/documenti coerenti con capability reali:
  - support legge email e documenti
  - finance gestisce documenti/export finance
  - niente form o archiviazioni mostrate se il ruolo non puo salvare

## Verifiche locali

- `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
- `SHSS_EXPECTED_VERSION=5.3.49 node scripts/test_skinharmony_site_suite_plugin.js` -> `1714/1714`
- `node scripts/program_registry_check.js --memory-dir SHARED_MEMORY --require-all-programs` -> `READY`
- `node scripts/suite_operational_closure.js --version=5.3.49` -> preflight `22/22`, local test `1714/1714`

## Artefatti

- `dist/skinharmony-site-suite-5.3.49.zip`
- `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_49_LOCAL_2026-05-19.json`
- `reports/wordpress/skinharmony_site_suite_local_latest.json`
- `reports/codex-core/program_registry_check_latest.json`

## Residui veri

1. policy account `non assegnati` / `condivisi`
2. isolamento completo ordini assistiti sul perimetro portafoglio
3. test scenario reale `azienda con 15 agenti`
4. verifica browser live dei desk `finance/support` dopo installazione

## Gate

- Core gate locale: `ALLOWED`
- report: `reports/codex-core/codex_core_gate_latest.json`
