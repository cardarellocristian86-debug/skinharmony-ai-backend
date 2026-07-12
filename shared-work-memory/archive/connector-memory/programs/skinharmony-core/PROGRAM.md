# SkinHarmony Translation Hub

## Cos'e

SkinHarmony Translation Hub e il plugin WordPress dedicato a traduzione, governance linguistica, content autopilot, claim guard e collegamento con Universal Core.

Serve per migliorare testi, traduzioni, marketing copy e controllo claim senza duplicare funzioni dentro Suite.

## Cosa Fa

- Traduce contenuti con fallback e protezione lingua sorgente.
- Espone Content Governance / Language Autopilot.
- Usa automation key scoped per chiamate esterne senza sessione admin.
- Analizza claim rischiosi e propone correzioni puntuali.
- Usa Content Orchestrator per segnalare testi freddi, astratti, ripetitivi o poveri di dettaglio funzionale.
- Dialoga con Universal Core quando configurato.
- Gestisce coda traduzioni, review, integrity, SEO bridge, memory, runtime layer e policy pack.
- Espone snapshot decisionale locale per dashboard, Nyra advisory e control plane.
- Sincronizza Suite locale/remota tramite network connector e API key scoped.

## Per Chi E

- SkinHarmony: controllo linguistico e marketing.
- Clienti con siti multilingua.
- Suite: consumo centralizzato dei servizi di testo/claim/traduzione.
- Codex/automazioni: uso tramite automation key.

## Modello Vendibile

Il traduttore non va venduto come semplice "plugin traduttore AI".

Va venduto come traduttore governato:

- traduzione;
- miglioramento marketing;
- claim guard;
- tono premium;
- glossario/policy pack;
- review prima della pubblicazione;
- Universal Core opzionale per decisioni, rami e audit.

La modalita commerciale principale deve usare una chiave SkinHarmony scoped (`SHX-TRANSLATOR-KEY`), non la chiave OpenAI del cliente come default.

La chiave SkinHarmony controlla piano, lingue, limiti, settori, claim guard, Core/Render, review e automazioni. La modalita BYOK/OpenAI cliente resta opzione avanzata per clienti tecnici.

Piano operativo salvato in:

- `SHARED_MEMORY/reports/core-translator/TRANSLATOR_PRODUCTIZATION_PLAN_2026-05-28.md`

## Cosa Non Fa

- Non deve pubblicare automaticamente testi sensibili senza review.
- Non sostituisce consulenza legale.
- Non deve contenere logiche CRM/Suite duplicate.
- Non deve inventare specifiche tecniche o claim.

## Stato

- Versione live verificata: `3.2.37` come `SkinHarmony Translation Hub`.
- Release locale progressiva preparata: `3.2.38`.
- Plugin live attivo su WordPress con namespace `sh-core/v1` esposto.
- Endpoint live principali verificati in sola lettura: traduzione, Content Governance, Language Autopilot, provider, queue, integrity, software e snapshot.
- Stato operativo da monitorare: provider OpenAI configurato ma ultimo check live in timeout; coda live con job falliti storici da analizzare prima di retry.
- Meta SEO Rank Math non sempre modificabile da REST standard.

## Mappa Aggiornabile

- `ARCHITECTURE.md` - architettura generale e indice blocchi.
- `OPERATIONS.md` - regole operative e test minimi.
- `USER_MANUAL.md` - uso per admin/utente.
- `BLOCK_01_BOOTSTRAP_ACCESS_STORAGE_MAP.md`
- `BLOCK_02_TRANSLATION_CONTENT_GOVERNANCE_MAP.md`
- `BLOCK_03_QUEUE_REVIEW_PROVIDER_INTEGRITY_SEO_MAP.md`
- `BLOCK_04_CONTROL_PLANE_NETWORK_LICENSE_ACCESS_MAP.md`
- `BLOCK_05_MEMORY_GLOSSARY_RUNTIME_DELTA_SOFTWARE_MAP.md`
- `BLOCK_06_LANGUAGE_CORE_ASSETS_CONTRACTS_POLICY_MAP.md`
