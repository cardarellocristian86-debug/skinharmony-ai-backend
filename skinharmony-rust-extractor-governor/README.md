# SkinHarmony Rust Extractor Governor

Governatore Rust per creare cataloghi traducibili prima della traduzione.

Non traduce direttamente e non corregge "a vista". Legge sorgenti, HTML, JSON/API, CSS, risorse e bundle conservativi, poi produce segmenti con contesto, rischio, radar, visibilita, categoria e stato publish-safe.

## Perche e piu forte di un bridge

Un bridge passa dati da un sistema a un altro. Questo progetto decide prima cosa merita di entrare nel catalogo:

- elimina rumore tecnico, route, token, segreti e stringhe low-signal;
- assegna contesto e origine;
- calcola rischio, radar e visibilita;
- preserva placeholder;
- blocca pubblicazione quando testi critici non sono tradotti o validati.

## Architettura

Workspace Cargo:

- `skinharmony-core-math`: funzioni pure deterministiche.
- `skinharmony-extractor`: scanner e parser conservativi v2/v1/v0.
- `skinharmony-classifier`: categoria, rischio, radar e visibilita.
- `skinharmony-catalog`: dedupe e output JSON/JSONL.
- `skinharmony-translator-contract`: tipi del contratto traduttore/Core/Nyra.
- `skinharmony-policy`: policy publish-safe.
- `skinharmony-cli`: binario `skinharmony-extract`.

## V2 / V1 / V0

- `V2`: governor matematico con feature vector, translatability, quality, risk, radar e visibility.
- `V1`: estrazione strutturale da formati noti.
- `V0`: fallback user-visible conservativo, senza esportare rumore tecnico.

## Matematica

Il core usa funzioni pure:

- Shannon entropy e normalizzazione;
- sigmoid;
- dot product;
- logistic translatability;
- quality score;
- risk score;
- radar score;
- visibility score;
- Jaccard;
- cosine similarity;
- clamp.

## Categorie

Ogni segmento viene classificato in:

- `cta`
- `navigation`
- `errors`
- `onboarding_trial`
- `ai_gold_copy`
- `data_quality`
- `pricing_payment`
- `legal_privacy`
- `admin_support`
- `generic_ui_copy`

Il classificatore e offline: non usa LLM.

## CLI

```bash
skinharmony-extract ./src --source-lang en --target-lang it --out ./out/catalog.jsonl --format jsonl
```

Bundle:

```bash
skinharmony-extract ./dist --scan-bundles --use-sourcemaps --source-lang en --target-lang it --out ./out/bundle-catalog.jsonl
```

Policy:

```bash
skinharmony-extract ./project --fail-on-high-untranslated --emit-policy-report ./out/policy.json
```

Report radar:

```bash
skinharmony-extract ./project --emit-radar-report ./out/radar.json
```

Translation memory:

```bash
skinharmony-extract ./project --translation-memory ./locales/it.json --out ./out/catalog.jsonl
```

## Output

Ogni segmento contiene:

- stable id e semantic id;
- testo sorgente e normalizzato;
- file, riga, colonna e span;
- origine;
- stage v2/v1/v0;
- categoria;
- contesto;
- placeholder;
- rischio;
- radar;
- visibilita;
- confidence e quality score;
- stato traduttore.

## Integrazione Core/Nyra

Il catalogo e pensato per essere passato a SkinHarmony Core Translator.

Core/Nyra decide:

- `publish_safe`;
- rischio e radar finali;
- segmenti mancanti;
- mismatch placeholder;
- errori brand voice;
- se serve refinement OpenAI.

OpenAI entra solo quando serve: rischio medio o alto, legal/privacy, pricing/payment, AI Gold copy, onboarding, placeholder mismatch o qualita target sotto soglia.

## Policy publish-safe

La policy blocca pubblicazione se:

- segmenti high/block non sono tradotti;
- placeholder non combaciano;
- legal/privacy critico non e validato;
- pricing/payment critico non e validato;
- radar critical resta pending.

## Limiti legali

Il progetto supporta solo sorgenti, bundle, file, siti statici e software per cui esiste autorizzazione di analisi, estrazione e traduzione.

Non implementa bypass DRM, cracking, decrittazione, evasione anti-bot, scraping aggressivo, furto dati, estrazione credenziali o reverse engineering non autorizzato.

Se rileva segreti, token o credenziali, non li esporta nel catalogo traducibile.

## Verifica

```bash
cargo fmt
cargo test
cargo clippy --all-targets --all-features -- -D warnings
cargo build --release
```
