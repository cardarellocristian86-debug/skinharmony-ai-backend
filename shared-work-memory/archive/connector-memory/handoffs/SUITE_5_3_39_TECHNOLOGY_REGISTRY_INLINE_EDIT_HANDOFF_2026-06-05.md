# Suite 5.3.39 Technology Registry Inline Edit Handoff

Aggiornato: 2026-06-05T21:18:05Z

## Stato
- Release locale pronta: `dist/skinharmony-site-suite-5.3.39.zip`
- Closure locale OK: `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_39_LOCAL_2026-05-19.json`
- Plugin live ancora da aggiornare: lo screenshot non cliccabile e coerente con `5.3.38`

## Fix incluso
- le righe `registry-only / price pending` di `Magazzino Tecnologie` sono ora editabili dalla tabella
- campi disponibili:
  - nome tecnologia
  - prezzo ufficiale
  - costo acquisto
  - modalita IVA acquisto
  - aliquota IVA
  - stock
  - ordine su richiesta
  - toggle WooCommerce
  - toggle pubblicazione
- il salvataggio aggiorna il `Technology Registry` anche senza prodotto Woo
- CRM continua a leggere il `Technology Registry` come master

## Sequenza corretta
1. Installare manualmente `dist/skinharmony-site-suite-5.3.39.zip` sul mother site
2. Aprire `Magazzino Tecnologie`
3. Verificare che una riga `price pending` sia modificabile
4. Salvare una modifica di test su una tecnologia non critica
5. Verificare che il dato sia rimasto in tabella e nel registry REST

## Report chiave
- `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_39_LOCAL_2026-05-19.json`
- `reports/wordpress/skinharmony_site_suite_local_latest.json`
- `reports/codex-core/codex_core_gate_latest.json`
- `reports/codex-core/program_registry_check_latest.json`
