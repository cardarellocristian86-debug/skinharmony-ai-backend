# Site Suite SkinHarmony Dogfood Audit - 2026-07-01

## Stato

Audit read-only completato sul mother site `https://www.skinharmony.it` dopo decisione Core 2.0.

- Core input: `universal-core-2.0/reports/universal-core/codex/suite_skinharmony_dogfood_audit_core2_input_2026_07_01.json`
- Core report: `universal-core-2.0/reports/universal-core/codex/codex_core_decision_latest.json`
- Report JSON: `reports/wordpress/SUITE_SKINHARMONY_DOGFOOD_AUDIT_2026-07-01.json`
- Report MD: `reports/wordpress/SUITE_SKINHARMONY_DOGFOOD_AUDIT_2026-07-01.md`
- Script audit: `tmp/suite_skinharmony_dogfood_readonly_audit.js`
- Dettaglio claim/prezzi: `reports/wordpress/skinharmony_claim_price_audit_latest.json`

## Risultato

La Suite live risponde con `version=5.3.50`, quindi il mother site sta usando il pacchetto installato `.50`.

Non e chiudibile come `SkinHarmony usa Suite al 100%` perche il dogfood score live e `70` (`partial_dogfood`) e ci sono gap reali.

## Gap principali

1. Manifest/update server non allineato:
   - `stable_version=5.3.53`
   - `current_origin_version=5.3.50`
   - `distribution_ready=false`
   - Azione: allineare manifest solo dopo conferma owner.

2. Dogfood pubblico incompleto:
   - `sh_waas_offer` manca nella pagina `soluzione-waas-aziende`
   - `shortcodes_found=1/2`
   - Azione: aggiornare pagina live solo con Core/owner confirmation.

3. Preset template SkinHarmony mancante:
   - `template_presets_skinharmony=0`
   - Azione: salvare almeno un preset Template WaaS con project key `skinharmony`.

4. Google Ads tag non configurato:
   - manca `google_ads_global_tag_id`
   - Azione: serve dato reale, non inventare AW ID o label.

5. Guardrail:
   - endpoint `guard-scan`: `claim_issues=1`, `price_issues=9`
   - dettaglio separato: il claim reale e su pagina `O3 System` (`match=cura`); i 9 prezzi sono falsi positivi su prezzi ufficiali annuali/equivalenti mensili Base/Silver/Gold.
   - Causa tecnica trovata localmente: nel monolite `default_official_prices()` ritorna array vuoto, mentre il modulo `price-guard` e `core/class-shss-health.php` hanno la lista corretta.
   - Azione: fix software o configurazione ufficiale prezzi live; non modificare prezzi pubblici perche sono coerenti col listino ufficiale.

6. Magazzino Prodotti vuoto:
   - `product_inventory.item_count=0`
   - Azione: caricare/verificare prodotti master come dati runtime, non nello zip.

7. Pagina `ai-gold-smart-desk`:
   - status 200 ma check minimo `shss-lead-form` fallisce.
   - Azione: verificare se deve essere collegata a form Suite o a flusso diverso.

## Cosa e gia OK

- Live Site Suite `5.3.50` attiva.
- CRM B2B leggibile: `contacts=2`, order ledger con `1` riga.
- Lead endpoint leggibile: `3` lead letti, PII non salvata nel report.
- Technology Registry leggibile: `11` tecnologie.
- Smart Desk Bridge configurato e operativo: `configured=true`, `operational_ready=true`, `last_test_code=200`, payloads `3`.
- Public pages minime OK: home, Smart Desk, contatti, tecnologie, WaaS, offerte WaaS.
- Enterprise closure endpoint: `checks_ok=9/9`, score `100`.
- Post install validation: score `93`, critical `0`, warning `1`.

## Prossima azione corretta

Prima di dichiarare chiusura:

1. Core decision per scegliere se chiudere con micro-fix software `5.3.51` per Price Guard o con sola configurazione live prezzi ufficiali.
2. Owner confirmation per qualsiasi scrittura live:
   - manifest/update server
   - pagina `soluzione-waas-aziende`
   - preset template
   - Google Ads tag
   - Product Inventory
   - pagina `ai-gold-smart-desk`
3. Ripetere `tmp/suite_skinharmony_dogfood_readonly_audit.js`.

Nessuna scrittura WordPress, nessun publish e nessun sync Smart Desk sono stati eseguiti in questo audit.
