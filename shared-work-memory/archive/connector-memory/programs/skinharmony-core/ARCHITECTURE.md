# Architettura SkinHarmony Translation Hub

## Dove Vive

- WordPress plugin: `wordpress/plugins/skinharmony-core`.
- Zip: `dist/skinharmony-translation-hub*.zip`.
- Report: `reports/core-translator`, `SHARED_MEMORY/reports/core-translator`.

## Componenti

- Admin UI: impostazioni Core, API key, automazioni.
- REST API: traduzione, content governance, language autopilot, automation key, review.
- Translation engine: gestione lingua sorgente/target.
- Claim guard: rileva parole/frasi rischiose e propone correzioni.
- Content Orchestrator: valuta qualità narrativa/funzionale del testo.
- Universal Core adapter: manda snapshot/decisioni quando configurato.

## Flussi

1. Il client invia testo atomico, contesto e lingua.
2. Core plugin genera o valuta candidato.
3. Claim guard e content orchestrator decidono se publish_safe, review o rewrite.
4. Se configurato, Universal Core riceve payload strutturato.
5. Il risultato torna con testo, review, note e workflow.

## Su Server / Non Su Server

- Su WordPress: plugin, chiavi automation, queue e review locale.
- Su Render: Universal Core per decisioni/policy/rami se collegato.
- Locale: sviluppo, test, zip, report.

## Confini

- Suite deve consumare questo plugin per testo/traduzione/claim quando possibile.
- Universal Core resta giudice centrale quando collegato.
- Il plugin non deve trasformarsi in CRM o gestionale.

## Mappa A Blocchi

1. `BLOCK_01_BOOTSTRAP_ACCESS_STORAGE_MAP.md` - bootstrap, accesso, storage, settings, automation key e Core Admin.
2. `BLOCK_02_TRANSLATION_CONTENT_GOVERNANCE_MAP.md` - traduzione, runtime lingua, Suite sync, multiverse preview, Content Governance e Language Autopilot.
3. `BLOCK_03_QUEUE_REVIEW_PROVIDER_INTEGRITY_SEO_MAP.md` - coda traduzioni, review queue, provider, integrity check e SEO bridge.
4. `BLOCK_04_CONTROL_PLANE_NETWORK_LICENSE_ACCESS_MAP.md` - Universal Core adapter locale, network/nodi, Smart Desk bridge, licenza e ruoli.
5. `BLOCK_05_MEMORY_GLOSSARY_RUNTIME_DELTA_SOFTWARE_MAP.md` - glossary, policy pack, memory, runtime layer, delta, autosync e cataloghi software.
6. `BLOCK_06_LANGUAGE_CORE_ASSETS_CONTRACTS_POLICY_MAP.md` - contratti, dizionari, policy pack, termini, claim rules e WaaS market access.

## Stato Architetturale Verificato - Blocco 01

Mappa dettagliata:

- `SHARED_MEMORY/programs/skinharmony-core/BLOCK_01_BOOTSTRAP_ACCESS_STORAGE_MAP.md`

Verità attuale:

- SkinHarmony Translation Hub è alla release locale `3.2.38`; live verificato `3.2.37` finché non viene installato lo zip progressivo.
- Core Admin è alla versione `1.0.4`.
- Il bootstrap usa safe init per evitare fatal su componenti avanzati.
- Lo storage crea memory, jobs, sources, review queue, audit, usage, revisions e nodi network.
- Le automation key locali sono scoped e rate limited; non sono le stesse chiavi provider Universal Core.
- Core Admin gestisce chiavi/clienti/setup Suite e parla con Universal Core tramite admin key.

## Stato Architetturale Verificato - Blocco 02

Mappa dettagliata:

- `SHARED_MEMORY/programs/skinharmony-core/BLOCK_02_TRANSLATION_CONTENT_GOVERNANCE_MAP.md`

Verità attuale:

- Il plugin supporta `it`, `en`, `fr`, `de`, `es` con lingua sorgente protetta.
- La traduzione pagina estrae text node visibili e stringhe dinamiche da shortcode Suite.
- La traduzione strutturata usa payload atomici con `domain`, `object_id`, `key_path` e fallback.
- Il render frontend sostituisce solo testo visibile e degrada sul contenuto sorgente.
- Content Governance/Language Autopilot produce scenari, digest V7, workflow, branch hints, claim corrections e suggested output.
- Content Orchestrator valuta strategia, funzionamento reale, ripetizione, freddezza, dettagli e rischio claim.

## Stato Architetturale Verificato - Blocco 03

Mappa dettagliata:

- `SHARED_MEMORY/programs/skinharmony-core/BLOCK_03_QUEUE_REVIEW_PROVIDER_INTEGRITY_SEO_MAP.md`

Verità attuale:

- La coda usa REST + cron ogni 5 minuti per pagine, SEO, integrity scan e cataloghi software.
- La review queue gestisce pending, history, assign, note, approve, submit, reject, update, cleanup, publish e rollback.
- Il provider supporta memory-only, OpenAI e local service, con stato, test, usage e budget.
- L'integrity check misura readiness delle lingue, stringhe mancanti, review pendenti e SEO mancante.
- Il SEO bridge copre Yoast, Rank Math, AIOSEO e alt immagine, senza sostituire claim/review.

## Stato Architetturale Verificato - Blocco 04

Mappa dettagliata:

- `SHARED_MEMORY/programs/skinharmony-core/BLOCK_04_CONTROL_PLANE_NETWORK_LICENSE_ACCESS_MAP.md`

Verità attuale:

- L'Universal Core Adapter locale aggrega readiness, contenuti, SEO, provider, queue, safety, Suite governance, rete, bridge e licenza.
- Nyra Advisory locale spiega cosa succede, cosa blocca, cosa fare prima e cosa ignorare.
- Network Orchestrator registra nodi, esporta/importa bundle e sincronizza Suite locale/remota con API key.
- Smart Desk Bridge verifica reachability, non sincronizza dati operativi completi.
- License distingue internal e SaaS con verifica server/cache 6h.
- Access crea profili enterprise per translator, reviewer, approver, publisher, compliance, regional manager e distributor.

## Stato Architetturale Verificato - Blocco 05

Mappa dettagliata:

- `SHARED_MEMORY/programs/skinharmony-core/BLOCK_05_MEMORY_GLOSSARY_RUNTIME_DELTA_SOFTWARE_MAP.md`

Verità attuale:

- Glossary legge termini, market tone, preferred/avoid words e policy pack JSON.
- Memory e Runtime separano memoria approvata, layer pagina, layer SEO e layer Suite strutturato.
- Delta Detector registra fonti e riconosce nuove stringhe/cambiamenti via hash e key_path.
- Autosync crea job su salvataggio solo quando delta e opzioni sono attive.
- Software Bridge traduce cataloghi UI/app tramite domain `software:<app>`.
- OpenAI legacy produce solo bozze da review, non pubblicazioni automatiche.

## Stato Architetturale Verificato - Blocco 06

Mappa dettagliata:

- `SHARED_MEMORY/programs/skinharmony-core/BLOCK_06_LANGUAGE_CORE_ASSETS_CONTRACTS_POLICY_MAP.md`

Verità attuale:

- `language-core` contiene contratti stabili per automation key, content governance e policy pack.
- Sono presenti dizionari IT/EN/FR/DE/ES per stringhe base di ecosistema, Smart Desk, prodotti e safety.
- Policy pack attivi: beauty marketing, compliance guard, partner distributor e software runtime.
- Regole claim multilingua coprono italiano, inglese, francese, spagnolo e tedesco.
- WaaS/Market Access definisce label e confini per non promettere laboratorio, consulenza regolatoria o accesso garantito.
