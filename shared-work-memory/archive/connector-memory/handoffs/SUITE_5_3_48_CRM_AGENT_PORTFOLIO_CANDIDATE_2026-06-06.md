# SUITE 5.3.48 CRM Agent Portfolio Candidate

Data: `2026-06-06`

## Obiettivo chiuso

Primo blocco reale del `CRM B2B` multiutente commerciale:
- assegnazione strutturata `assigned_user_id`
- compatibilita con storico `assigned_agent`
- visibilita portafoglio per ruolo `agent`
- menu Suite agente ridotto al perimetro commerciale
- blocco write su risorse CRM non visibili

## Implementazione

File principale:
- `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`

Punti chiave:
- helper nuovi per ruolo agente ristretto, utenti assegnabili, alias storico e filtro portafoglio
- `register_admin_menu()` con top-level CRM per agente e pagine consentite limitate
- form contatto CRM con select `assigned_user_id` per owner/admin e auto-assegnazione per agente
- filtro portafoglio applicato a:
  - contatti CRM
  - company cockpit
  - email thread
  - documenti
  - export CSV
- hardening handler:
  - salva contatto
  - duplica contatto
  - archivia contatto
  - converti contatto
  - crea bozza proposta
  - salva/archivia thread email
  - salva/archivia documenti

## Test e packaging

Verifiche locali:
- `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
- `SHSS_EXPECTED_VERSION=5.3.48 node scripts/test_skinharmony_site_suite_plugin.js`
- `node scripts/program_registry_check.js --memory-dir SHARED_MEMORY --require-all-programs`
- `node scripts/suite_operational_closure.js --version=5.3.48`

Esito:
- `php -l`: OK
- test plugin: `1710/1710`
- Program Registry: `READY`
- closure: preflight `22/22`

Artefatti:
- `dist/skinharmony-site-suite-5.3.48.zip`
- `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_48_LOCAL_2026-05-19.json`
- `reports/wordpress/skinharmony_site_suite_local_latest.json`

## Residuo vero

Questa release non chiude ancora tutto il multiutente commerciale:
- manca la matrice dedicata `finance/support`
- manca la policy `account non assegnati`
- manca la policy `account condivisi`
- il perimetro ordini assistiti va ancora rifinito sul piano portfolio-first
- manca test di accettazione scenario `azienda con 15 agenti`

## Regola da mantenere

Non introdurre `light view` nei moduli operativi CRM.

La UX deve restare diretta:
- il CRM apre nella vista piena
- la riduzione del monolite resta interna
- cache/snapshot solo dietro le quinte

## Audit Core

Gate usato per la patch locale:
- `reports/codex-core/codex_core_gate_latest.json`
