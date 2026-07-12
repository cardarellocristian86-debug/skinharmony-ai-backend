# Suite Plugin 5.3.50 CRM Scope Local Closure

Data: 2026-07-01

## Stato
- Baseline di partenza corretta: `5.3.48` dal disco esterno.
- Release locale corrente: `5.3.50`.
- La `5.3.53` non e baseline di questo ramo.
- Nessun deploy, upload WordPress, modifica tenant, chiavi, prezzi o produzione.

## Core 2.0
- Winner: `implement_combined_5_3_49_5_3_50_local_scope_contract`
- Report: `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`
- Input: `universal-core-2.0/reports/universal-core/codex/suite_5_3_48_next_crm_scope_core2_input_2026_07_01.json`
- Control level: `suggest`
- Blocked: `false`

## Modifiche chiuse
- `Finance Desk` e `Support Desk` role-aware/read-only.
- Menu ristretto per ruoli CRM limitati.
- Profilo attivo visibile nel CRM con copy operativo.
- Form non coerenti nascosti per finance/support.
- Assegnazione strutturata agente con `assigned_user_id`.
- `portfolio_scope` con `assigned_only`, `shared_agents`, `unassigned_pool`.
- Filtri per contatti, email thread, documenti, export e ledger.
- Finder filtrati: `find_b2b_crm_email_thread`, `find_b2b_crm_document`.
- CRM Order Ledger arricchito con `created_by_label`, `agente_user_id`, `scope_locked`.
- README aggiornato con `CRM Agent Portfolio Scope 5.3.48`, `CRM Finance / Support Scope 5.3.49`, `CRM Shared / Pool Scope 5.3.50`.

## Artefatti
- Zip installabile progressivo: `dist/skinharmony-site-suite-5.3.50.zip`
- Copia su disco esterno: `/Volumes/Esterno/MEC/priority_backup_2026-06-15/dist/skinharmony-site-suite-5.3.50.zip`
- Alias installabile: `dist/skinharmony-site-suite.zip`
- Alias latest: `dist/skinharmony-site-suite-latest.zip`
- Manifest: `dist/skinharmony-site-suite-update-manifest.json`
- Closure report: `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_50_LOCAL_2026-05-19.json`

## Hash
- `5.3.50`: `368e4bead1fe3e555b9d3d84814a1a4a99cb239a6febca69c8b6bbd896ab68d7`
- `5.3.50` su disco esterno: `368e4bead1fe3e555b9d3d84814a1a4a99cb239a6febca69c8b6bbd896ab68d7`
- Rollback `5.3.48`: `513868dc7cb2a8da10ea2877446d7e111d146cc4bd90a0736a5c5f806a5da1a1`
- Sorgente rollback esterna: `/Volumes/Esterno/MEC/priority_backup_2026-06-15/dist/skinharmony-site-suite-5.3.48.zip`

## Verifiche
- `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`: OK.
- PHP lint su tutti i file PHP del plugin: OK.
- `node --check wordpress/plugins/skinharmony-site-suite/assets/site-suite-admin.js`: OK.
- `SHSS_EXPECTED_VERSION=5.3.50 node scripts/test_skinharmony_site_suite_plugin.js`: `1717/1717`.
- `node scripts/suite_operational_closure.js --version=5.3.50`: OK, preflight `22/22`, local test `1717/1717`.
- Program Registry: READY.

## Prossimo passo
Solo dopo conferma owner: installazione manuale dello zip `dist/skinharmony-site-suite-5.3.50.zip` su WordPress/staging-live e verifica browser reale con ruoli `owner`, `agent A`, `agent B`, `finance`, `support`. Non usare la `5.3.53` per ripartire da questo ramo senza nuovo Core 2.0 e conferma owner.
