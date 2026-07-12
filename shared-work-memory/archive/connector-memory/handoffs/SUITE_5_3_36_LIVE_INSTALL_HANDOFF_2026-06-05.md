# Suite 5.3.36 Live Install Handoff

Data: 2026-06-05
Owner: Cristian Cardarello

## Stato
- Release locale `5.3.36` pronta.
- Zip installabile: `dist/skinharmony-site-suite-5.3.36.zip`.
- Latest zip locale: `dist/skinharmony-site-suite.zip`.
- Preflight locale: `22/22`.
- Test locale plugin: `1688/1688`.
- Live WordPress resta su `5.3.35`.
- Manifest live resta coerente su `stable_version=5.3.35` e `current_origin_version=5.3.35`.

## Decisione
Non e stato promosso il manifest live a `5.3.36`, perche lo script di upload configura anche il manifest e fallirebbe la policy quando il plugin installato e ancora `5.3.35`.

## Prossimo Passo Manuale
1. Installare/aggiornare manualmente lo zip `dist/skinharmony-site-suite-5.3.36.zip` da WordPress.
2. Verificare che il plugin live riporti `5.3.36`.
3. Solo dopo, caricare/allineare package e manifest `5.3.36`.
4. Rieseguire runtime check e probe sui fast path:
   - `/wp-json/shss/v1/waas-manager/enterprise-core/snapshot`
   - `/wp-json/shss/v1/waas-manager/completion-map`
   - `/wp-json/shss/v1/waas-manager/ai-control-tower-score`

## Comandi Verifica
```bash
SHSS_EXPECTED_VERSION=5.3.36 node scripts/check_wp_suite_runtime_data.js
node scripts/audit_wordpress_plugins.js
```

## Gate
- Release gate: `reports/codex-core/codex_core_gate_latest.json`
- Memory update gate: `reports/codex-core/codex_core_gate_latest.json`
