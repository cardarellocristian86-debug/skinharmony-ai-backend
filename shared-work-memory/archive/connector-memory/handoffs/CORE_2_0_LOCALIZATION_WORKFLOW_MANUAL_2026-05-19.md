# Core 2.0 Localization Workflow Manual

Data: 2026-05-19
Scopo: spiegare come usare il workflow di localizzazione software governata senza appesantire il sistema.

## Regola madre

- `Core 2.0 locale` guida `Codex` e i worker AI
- `Core Render` guida `plugin`, `gestionale`, `Suite`, `tenant`, `chiavi`, `publish` e `runtime`
- la logica operativa di localizzazione non vive nel Core 2.0: vive nel connector e nel worker dedicato `packages/core-codex-connector/src/localization-worker.mjs`

Non invertire i ruoli.

## Obiettivo

Trovare e correggere:

- inglese residuo
- mixed language
- fallback incoerenti
- copy UI fuori tono
- casi da non tradurre

senza:

- scrivere patch automatiche fuori controllo
- usare il Core come worker
- toccare produzione

## Flusso corretto

### 1. Audit

Comando:

```bash
sh-core-codex localize-ui-audit \
  --target-path skin-harmony-web/src/renderer/pages \
  --surface react_web \
  --target-language it \
  --domain-hint smartdesk
```

Output:

- `reports/codex-core/localize_ui_audit_latest.json`
- `reports/codex-core/localize_ui_audit_latest.md`

Fa:

- scan stringhe
- filtra rumore tecnico
- classifica residui inglesi
- riconosce termini protetti
- propone prime traduzioni note

### 2. Proposal

Comando:

```bash
sh-core-codex localize-ui-fix \
  --from-report reports/codex-core/localize_ui_audit_latest.json
```

Output:

- `reports/codex-core/localize_ui_fix_proposal_latest.json`
- `reports/codex-core/localize_ui_fix_proposal_latest.md`

Fa:

- prende solo le stringhe con suggerimento pulito
- non scrive file
- prepara la base per patch review

### 3. Review

Codex e owner leggono:

- candidate count
- file coinvolti
- stringa sorgente
- stringa suggerita
- rischio

Se il report e pulito:

- si passa al prossimo blocco `propose_patch applicabile`

Se il report e rumoroso:

- si migliora prima l audit

### 4. Apply limitato

Comando:

```bash
sh-core-codex localize-ui-fix \
  --from-report reports/codex-core/localize_ui_audit_latest.json \
  --limit 20 \
  --apply
```

Output:

- `reports/codex-core/localize_ui_fix_apply_latest.json`
- `reports/codex-core/localize_ui_fix_apply_latest.md`

Fa:

- sostituzione esatta sulla riga candidata
- skip automatico se il contesto non coincide
- nessun deploy
- nessun bypass del Core prodotto

Subito dopo va eseguito il build-check del target.

## Cosa abbiamo gia fatto

### Audit MVP

- implementato in `packages/core-codex-connector/src/cli.mjs`
- logica estratta in `packages/core-codex-connector/src/localization-worker.mjs`
- supporta `SH_CORE_LAB_2_0=1`
- usa fallback `OFFLINE_AUDIT` se il Core non e raggiungibile

### Proposal MVP

- implementato in `packages/core-codex-connector/src/cli.mjs`
- logica estratta in `packages/core-codex-connector/src/localization-worker.mjs`
- solo `propose_patch_only`
- nessuna scrittura sui file

### Apply MVP

- implementato in `packages/core-codex-connector/src/cli.mjs`
- logica estratta in `packages/core-codex-connector/src/localization-worker.mjs`
- modalita `apply_exact_line_replace`
- report dedicato di apply
- pensato per patch locali limitate e reversibili

## Stato reale corrente

Ultima passata reale su `skin-harmony-web/src/renderer/pages`:

- audit corretto: `446` findings
- famiglie utili:
  - `ui_visible_copy = 237`
  - `brand_protected_terms = 199`
  - `mixed_language_fallback = 10`
- apply limitato:
  - `13` sostituzioni applicate
  - `7` saltate in sicurezza
  - `1` file toccato
- build target: `ok`

Questo vuol dire:

- il flusso e gia utile
- non e ancora il motore finale
- ma non e piu teoria

## Come leggere i report

### Audit

Guarda:

- `winner_family`
- distribuzione famiglie
- esempi iniziali
- suggerimenti gia noti

### Fix proposal

Guarda:

- quanti candidati veri ci sono
- in quali file
- se i suggerimenti sono sensati
- se i termini protetti vengono lasciati intatti

## Cose da evitare

- non usare il report audit come patch automatica
- non tradurre bundle compilati
- non toccare Render con questo flusso
- non mescolare testo visibile e stringhe tecniche
- non trasformare ogni finding in azione

## Prossimo blocco consigliato

1. ridurre ancora i falsi positivi sulle stringhe con termini protetti
2. allargare `apply` a piu file in lotti piccoli
3. mantenere build-check obbligatorio
4. solo dopo pensare a WordPress structured localization
