# Operazioni SkinHarmony Translation Hub

## Installazione

- Caricare zip `dist/skinharmony-translation-hub-latest.zip`.
- Attivare plugin WordPress.
- Verificare namespace `sh-core/v1`.

## Aggiornamento

- Bump versione nel plugin.
- PHP lint file modificati.
- Test `node scripts/check_skinharmony_core_plugin.mjs`.
- Test legacy esteso `node scripts/test_skinharmony_core_plugin.js`.
- Creare zip.
- Caricare e testare endpoint live.

## Test Minimi

- Route `site/content-governance`.
- Test copy freddo/astratto.
- Test claim rischioso.
- Report in `reports/core-translator`.
- Dopo ogni modifica eseguire Program Registry:
  - `npm run codex:program-registry -- --file <file-core> --file SHARED_MEMORY/programs/skinharmony-core/<mappa-aggiornata>.md`

## Lettura A Blocchi

1. `BLOCK_01_BOOTSTRAP_ACCESS_STORAGE_MAP.md` - bootstrap plugin, settings, storage, automation key, Core Admin.
2. `BLOCK_02_TRANSLATION_CONTENT_GOVERNANCE_MAP.md` - traduzione pagina/strutturata, language runtime, multiverse, content governance e orchestrator.
3. `BLOCK_03_QUEUE_REVIEW_PROVIDER_INTEGRITY_SEO_MAP.md` - queue, review, provider, integrity e SEO bridge.
4. `BLOCK_04_CONTROL_PLANE_NETWORK_LICENSE_ACCESS_MAP.md` - snapshot decisionale, network connector, Smart Desk bridge, licenza e ruoli.
5. `BLOCK_05_MEMORY_GLOSSARY_RUNTIME_DELTA_SOFTWARE_MAP.md` - policy pack, memory, runtime layer, delta, autosync e cataloghi software.
6. `BLOCK_06_LANGUAGE_CORE_ASSETS_CONTRACTS_POLICY_MAP.md` - contratti, dizionari, policy pack, termini, claim rules e WaaS.

## Regole Traduzione / Content Governance

- Non modificare automaticamente la lingua sorgente.
- Non tradurre HTML finale se è disponibile payload strutturato.
- Se manca memory approvata in `memory_only`, restituire errore/review, non inventare.
- Content Governance deve proporre correzioni puntuali, non bloccare tutto per una parola.
- Testi marketing devono spiegare problema, funzionamento, valore, limite e CTA.
- Claim medici/terapeutici richiedono riscrittura e review.
- Se Universal Core remoto non è raggiungibile e la policy lo richiede, `publish_safe` deve essere falso o richiedere review.
- Queue, provider e SEO bridge non devono pubblicare contenuti sensibili saltando review e claim guard.
- Integrity readiness deve distinguere tradotto, approvato e pubblicabile.
- Smart Desk bridge indica raggiungibilita, non sync completo dei dati.
- Network sync deve usare API key scoped e non deve mescolare tenant/brand.
- Universal Core remoto, quando configurato, resta giudice primario rispetto alla decisione locale.
- Ogni modulo che produce testo deve usare `domain` e `key_path` stabili.
- Autosync crea job controllabili, non pubblicazione automatica.
- Cataloghi software/UI devono usare Software Bridge invece di traduzioni sparse.
- Le parole interne tecniche non devono finire nel sito pubblico se non sono nomi prodotto protetti.
- Policy pack e contratti sono parte del prodotto: aggiornarli richiede registry e report.

## Fallback

- Ripristinare zip precedente.
- Usare backup pagina prima di batch replace.
- Non eliminare automation key attive senza report.
