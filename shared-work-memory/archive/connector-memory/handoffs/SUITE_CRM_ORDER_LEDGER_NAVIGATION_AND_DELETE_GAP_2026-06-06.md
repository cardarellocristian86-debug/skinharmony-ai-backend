# SUITE CRM ORDER LEDGER NAVIGATION AND DELETE GAP - 2026-06-06

## Stato
- Patch locale applicata solo sul perimetro di navigazione CRM B2B.
- Nessuna mutazione del ledger implementata.
- Test locali chiusi:
  - `php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
  - `node --check wordpress/plugins/skinharmony-site-suite/assets/site-suite-admin.js`
  - `SHSS_EXPECTED_VERSION=5.3.43 node scripts/test_skinharmony_site_suite_plugin.js`

## Cosa e stato fatto
- Nel form `CRM Order Ledger` sono stati aggiunti link dinamici:
  - `Apri scheda cliente`
  - `Apri ordini del cliente`
- La tabella `Registro aziende` ora ha anche `Apri ordini`.
- La tabella ordini nella `Scheda azienda` ora espone azioni di sola navigazione:
  - `Apri origine`
  - `Apri pagamenti`
  - `Apri margine`

## File toccati
- `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
- `wordpress/plugins/skinharmony-site-suite/assets/site-suite-admin.js`
- `scripts/test_skinharmony_site_suite_plugin.js`

## Blocco residuo
- Qualsiasi patch che aggiunga `archiviazione`, `eliminazione` o altra mutazione sul `CRM Order Ledger` viene bloccata dal connector locale con:
  - `local_hard_gate:ledger`
- Il blocco scatta anche su richieste ristrette alla sola UX del ledger.
- Report corrente: `reports/codex-core/codex_core_gate_latest.json`

## Implicazione pratica
- Ora l'utente riesce a capire meglio cosa e gia stato inserito e dove aprirlo.
- Non esiste ancora un'azione supportata in Suite per togliere una riga ledger dal CRM.

## Prossimo passo corretto
1. Decidere se sbloccare la policy locale `ledger` per una patch di soft-delete auditata.
2. In alternativa usare `core off` solo per:
   - `soft archive` di righe `crm_manual`
   - nessuna cancellazione hard
   - nessun impatto su WooCommerce, pagamenti o stock
3. Se si apre quel perimetro, implementare:
   - archivio soft con `archived_at`, `archived_by`, audit event
   - filtro righe attive nel reader del ledger
   - pulsante `Archivia` solo per righe `crm_manual`
