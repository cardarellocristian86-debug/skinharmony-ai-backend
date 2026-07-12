# Translator / Software Language Closure Checklist

Data: 2026-06-05
Scope: SkinHarmony Core traduttore, Software Language Gate, Smart Desk cataloghi UI.

## Regola

Chiusura locale prima, produzione solo con gate dedicato. Nessuna lingua o UI viene dichiarata pronta se restano `high` su CTA, errori, onboarding, privacy, prezzi/pagamenti o AI Gold copy.

## Checklist

- [x] Leggere mappa programma SkinHarmony Core.
- [x] Verificare report `3.2.32`, `3.2.33`, `3.2.34`.
- [x] Verificare plugin locale: `node scripts/check_skinharmony_core_plugin.mjs`.
- [x] Verificare dizionari: `node packages/language-core/scripts/check-dictionaries.js`.
- [x] Verificare Program Registry.
- [x] Eseguire radar Smart Desk completo senza limit operativo.
- [x] Generare catalogo software Smart Desk con radar universale.
- [x] Estrarre top blocchi high per area: onboarding/login, CTA, AI Gold, pricing/payment, privacy.
- [x] Verificare SkinHarmony Core live `3.2.34` installato e attivo.
- [x] Importare/tradurre catalogo Render Smart Desk tramite SkinHarmony Core live.
- [x] Verificare risposta live `software_language_gate` con metadata V2/V1/V0.
- [x] Verificare export/status live del catalogo software.
- [ ] Applicare traduzioni solo nel runtime/dizionario corretto, non nel bundle compilato.
- [ ] Rilanciare radar fino ad azzerare high sulle superfici bloccanti.
- [ ] Verifica browser/runtime Smart Desk in lingua target.
- [ ] Aggiornare mappa programma e report finale.

## Stato Trovato

- SkinHarmony Core locale: `3.2.34`, check statico `137/137`.
- Dizionari `it/en/fr/de/es`: OK.
- SkinHarmony Core live: `3.2.34`, plugin attivo.
- Smart Desk Render active bundle: `public/assets/index-D9D6R0Lr.js`.
- Dizionario Render attivo estratto: `it=506`, `en=506`, `de=287`, `fr=0`, `es=0`.
- Gap Render DE: `219` chiavi mancanti, di cui `34` high-risk operative.
- Traduzione live Core delle `34` chiavi: generata con `software_language_gate_ready=true` e audit Core presente su tutte.
- Stato export/status live: catalogo sorgente registrato (`34` source entries), ma memoria software persistente `0`; export DE `0` entries.

## Blocchi Aperti

1. Ponte software live: `translate-catalog` restituisce traduzioni, ma non risultano persistite in `software:smartdesk_render_de_gap_20260605`.
2. Review live: endpoint `/review/pending` non filtra per `software_catalog`/dominio e taglia a `200`; non usare approvazioni bulk alla cieca.
3. Smart Desk Render e piu avanti lato dizionario, ma il sorgente modificabile pulito non e ancora individuato: il dizionario principale e nel bundle compilato.
4. Serve fix mirato del ponte software o endpoint/filter di review prima di dichiarare il catalogo exportabile.
