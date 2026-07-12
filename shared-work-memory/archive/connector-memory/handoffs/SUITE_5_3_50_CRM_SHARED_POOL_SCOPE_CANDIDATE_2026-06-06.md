# Suite 5.3.50 CRM Shared / Pool Scope Candidate

Data: `2026-06-06`

## Stato

Preparata candidata locale `5.3.50` di `SkinHarmony Site Suite`.

Baseline rispettata:
- ripartenza da comportamento `5.3.44`
- nessuna `light view`
- continuita con blocchi multiutente `5.3.48` e `5.3.49`

## Chiusure fatte

### 1. Eccezioni portafoglio CRM

Nuovo campo strutturato:
- `portfolio_scope`

Valori:
- `assigned_only`
- `shared_agents`
- `unassigned_pool`

Regole:
- `assigned_only`: visibile solo a owner/admin e agente assegnato
- `shared_agents`: visibile a tutti gli agenti senza duplicare l account
- `unassigned_pool`: visibile alla rete finche un agente non lo prende in carico con salvataggio dal proprio profilo

Compatibilita:
- `assigned_agent` storico resta letto come alias legacy
- `assigned_user_id` resta la source of truth strutturata

### 2. Order Ledger in scope

Chiuso il perimetro agente anche sul `CRM Order Ledger`:
- helper `can_current_user_access_crm_order_ledger_row(...)`
- filtro righe ledger coerente con il portafoglio del contatto
- soft archive bloccato fuori perimetro con `scope_locked`

### 3. Provenienza ordine assistito leggibile

Ogni riga ordine assistito salva e mostra:
- `created_by_user_id`
- `created_by_label`
- `contact_assigned_user_id`
- `contact_assigned_agent`
- `contact_portfolio_scope`

UI aggiornata in:
- tabella account CRM
- form anagrafica CRM
- `CRM Order Ledger`
- `Company Cockpit -> Ordini e pagamenti`

## File toccati

- `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
- `wordpress/plugins/skinharmony-site-suite/README.md`
- `scripts/test_skinharmony_site_suite_plugin.js`
- `SHARED_MEMORY/programs/suite/OPERATIONS.md`
- `SHARED_MEMORY/checklists/suite_crm_multiuser_commercial_closure_checklist_2026-06-06.md`
- `SHARED_MEMORY/snapshots/STATE_SNAPSHOT.md`
- `SHARED_MEMORY/snapshots/WORK_SNAPSHOT.md`

## Verifiche locali

- `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
- `SHSS_EXPECTED_VERSION=5.3.50 node scripts/test_skinharmony_site_suite_plugin.js`
- `node scripts/program_registry_check.js --memory-dir SHARED_MEMORY --require-all-programs`
- `node scripts/suite_operational_closure.js --version=5.3.50`

Esito:
- local test `1717/1717`
- preflight `22/22`

## Artefatti

- zip: `dist/skinharmony-site-suite-5.3.50.zip`
- closure: `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_50_LOCAL_2026-05-19.json`
- test: `reports/wordpress/skinharmony_site_suite_local_latest.json`

## Residuo vero

- installazione manuale owner della `5.3.50`
- verifica browser casi:
  - account assegnato
  - account condiviso
  - account nel pool non assegnato
- test di accettazione scenario `azienda con 15 agenti`
- eventuale rifinitura `support mode owner` se emerge da test reali

## Gate Core

Report usato:
- `reports/codex-core/codex_core_gate_latest.json`
