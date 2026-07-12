# Suite 5.3.53 Agnostic Before Upload - 2026-07-01

## Decisione
- Non caricare `5.3.51`: contiene prezzi ufficiali hardcoded nel codice.
- Non usare `5.3.52` per upload agnostico: rimuove solo il fallback prezzi del monolite, ma lascia residui prezzo/prodotto in moduli e documenti.
- Usare come candidato manuale `5.3.53`.

## Artefatti
- Locale: `dist/skinharmony-site-suite-5.3.53.zip`
- Locale alias: `dist/skinharmony-site-suite.zip`, `dist/skinharmony-site-suite-latest.zip`
- Esterno versionato: `/Volumes/Esterno/MEC/priority_backup_2026-06-15/dist/skinharmony-site-suite-5.3.53.zip`
- SHA256: `9c36756d1846442bb21b1042bf3b120502ef8f6ec6457ae8383b39a0c91dae49`
- Manifest: `dist/skinharmony-site-suite-update-manifest.json`

## Cosa Cambia Nella 5.3.53
- `Price Guard` e `Health` non hanno piu fallback prezzi hardcoded.
- Le definizioni piani/SKU/prezzi Smart Desk non sono piu hardcoded nel bridge WooCommerce o nel monolite.
- Il pricebook WaaS default e vuoto/runtime-required.
- Endpoint Smart Desk live non e piu precompilato.
- Tenant fallback `skinharmony-suite` rimosso.
- Bootstrap dogfood ripulito da PEC, domini reali e chiavi demo reali.
- Test aggiornato per fallire se ricompaiono prezzi/SKU hardcoded.

## Verifiche
- PHP lint: OK su tutti i file plugin.
- JS admin `node --check`: OK.
- Program Registry: READY.
- Suite local test: `1715/1715`.
- Release preflight: `22/22`.
- Scan zip estratto: nessuna occorrenza per dominio reale, endpoint live, PEC/legalmail, VAT, chiavi demo hardcoded, prezzi Smart Desk, SKU hardcoded, AW reale.

## Core 2.0
- Release agnostica: `universal-core-2.0/reports/universal-core/codex/suite_5_3_53_agnostic_release_core2_input_2026_07_01.json`
- Copia esterna: `universal-core-2.0/reports/universal-core/codex/suite_5_3_53_copy_to_external_dist_core2_input_2026_07_01.json`
- Report canonico: `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`

## Nota Operativa
- Gli alias esterni `skinharmony-site-suite.zip` e `skinharmony-site-suite-latest.zip` non sono stati sovrascritti: restano sulla `.48` rollback.
- Nessun upload/install live WordPress della `.53` eseguito.
- Per configurare SkinHarmony reale dopo install: prezzi, prodotti, endpoint, Google Ads e preset vanno salvati da impostazioni/import/runtime, non ricodificati nel plugin.
