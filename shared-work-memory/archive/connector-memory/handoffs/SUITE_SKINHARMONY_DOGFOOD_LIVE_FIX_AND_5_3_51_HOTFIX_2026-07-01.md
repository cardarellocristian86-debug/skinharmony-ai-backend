# Site Suite Dogfood Live Fix + 5.3.51 Hotfix - 2026-07-01

## Esito

SkinHarmony live usa Site Suite `5.3.50`, non `5.3.48` e non la linea errata `.53`.

Il punto 3 e stato portato a stato vendibile quote-first, ma non al 100% dogfood:

- Dogfood live finale: `80`, `partial_dogfood`, verdict `quote_first_ready`
- Critical mancanti: `0`
- Open actions: `2`
- Plugin sale readiness live: `88`
- Guard-scan live finale: `claim_issues=0`, `price_issues=9`
- Audit diretto claim/prezzi: `0/0`
- Product Inventory live: `0`

## Fix Live Eseguiti

- Manifest live riallineato a `stable_version=5.3.50` e plugin `5.3.50`.
- Package live `.50` caricato su WordPress media:
  `https://www.skinharmony.it/wp-content/uploads/2026/07/skinharmony-site-suite-5.3.50-1.zip`
- Rollback `.48` caricato su WordPress media:
  `https://www.skinharmony.it/wp-content/uploads/2026/07/skinharmony-site-suite-5.3.48.zip`
- Bozza `soluzione-waas-aziende` aggiornata con `[sh_waas_offer]`.
- Pagina `AI Gold Smart Desk` aggiornata con `[sh_trial_bridge title="Richiedi prova Smart Desk"]`.
- Claim O3 ripuliti; audit diretto finale senza claim issue.

Backup live prima dei fix:

- `reports/wordpress/SUITE_SKINHARMONY_DOGFOOD_LIVE_FIX_BACKUP_2026-07-01.json`

Report fix live:

- `reports/wordpress/SUITE_SKINHARMONY_DOGFOOD_LIVE_FIX_2026-07-01.json`

## Hotfix Locale 5.3.51

La `5.3.51` non e stata installata live. E un pacchetto locale pronto per chiudere due bug software emersi dal dogfood:

- `default_official_prices()` del monolite ora include i prezzi ufficiali ammessi, evitando falsi positivi sui prezzi annuali/equivalenti mensili Smart Desk.
- `plugin_sale_readiness` non usa piu la chiave legacy `package_filename_matches_stable`; usa `package_url_matches_version` e `package_is_zip`.
- `scripts/suite_operational_closure.js` ora scrive `current_origin_version` coerente nel manifest locale.

Artefatti locali:

- `dist/skinharmony-site-suite-5.3.51.zip`
- `dist/skinharmony-site-suite.zip`
- `dist/skinharmony-site-suite-latest.zip`
- `dist/skinharmony-site-suite-update-manifest.json`
- `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_51_LOCAL_2026-05-19.json`

SHA256 `.51`:

`7e5b785eb110c7a692fc56ddd0495e0fa73bd47c5473a1611ccbe2d2832bdb1b`

Copia esterna versionata:

`/Volumes/Esterno/MEC/priority_backup_2026-06-15/dist/skinharmony-site-suite-5.3.51.zip`

Alias esterni non sovrascritti:

- `/Volumes/Esterno/MEC/priority_backup_2026-06-15/dist/skinharmony-site-suite.zip` resta su `.48`
- `/Volumes/Esterno/MEC/priority_backup_2026-06-15/dist/skinharmony-site-suite-latest.zip` resta su `.48`

## Verifiche

- PHP lint: OK su tutti i file plugin.
- JS syntax: OK su `assets/site-suite-admin.js`.
- Suite local test: `1717/1717`.
- Release preflight: `22/22`.
- Program Registry: READY.
- Manifest locale `.51`: `stable_version=5.3.51`, `current_origin_version=5.3.51`, automatic install off.
- Verifica live read-only finale: dogfood `80`, readiness `88`, guard `claim_issues=0`, `price_issues=9`, inventory `0`.

## Residui Per 100%

1. Preset template SkinHarmony
   - Stato: mancante.
   - Causa: opzione `shss_waas_template_design_presets` salvabile solo da wp-admin/admin-post con nonce; application password non apre wp-admin.
   - Azione corretta: salvarlo manualmente da Suite oppure aggiungere endpoint governato in una release successiva.

2. Google Ads
   - Stato: non configurato dentro Suite.
   - Evidenza recuperata read-only: tag candidato pubblico `AW-10821455869` dal JS gtag collegato a GA4 `G-QS516K4PFL`.
   - Azione corretta: configurarlo in Suite solo con conferma owner e percorso sicuro; non inventare label conversione.

3. Product Inventory
   - Stato: `0` prodotti.
   - Azione corretta: inserire solo prodotti con scheda/listino ufficiale. Non usare lo script pilota se contiene prezzi o specifiche inventate.

4. Live install `.51`
   - Stato: non eseguita.
   - Azione corretta: nuovo gate Core 2.0 + conferma owner, poi installazione manuale/canary con rollback `.48`.

## Core 2.0

Report canonico finale:

- `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`

Input principali:

- `universal-core-2.0/reports/universal-core/codex/suite_skinharmony_dogfood_closure_live_core2_input_2026_07_01.json`
- `universal-core-2.0/reports/universal-core/codex/suite_5_3_51_price_guard_readiness_hotfix_core2_input_2026_07_01.json`
- `universal-core-2.0/reports/universal-core/codex/suite_5_3_51_copy_to_external_dist_core2_input_2026_07_01.json`
