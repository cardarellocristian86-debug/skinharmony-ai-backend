# Core 2.0 `localize-ui-audit` Spec

Data: 2026-05-19
Scopo: definire il primo comando operativo del `Governed Localization Connector`.

## Regola madre

- `Core 2.0 locale` governa il lavoro di `Codex`
- `Core su Render` governa il lavoro del `prodotto`

Quindi:

- `localize-ui-audit` nasce locale
- non pubblica
- non modifica tenant
- non usa chiavi cliente
- non sostituisce il traduttore/Core remoto

## Obiettivo

Trovare e classificare nel software:

- inglese residuo
- mixed language
- stringhe traducibili
- stringhe da non tradurre
- stringhe con rischio claim/tone
- incoerenze cross-surface

Output:

- report strutturato
- patch candidate opzionali
- evidenza build/check

## Input

### Obbligatori

- `target_path`
- `surface`
  - `react_web`
  - `electron`
  - `wordpress_plugin`
  - `site_suite`
- `target_language`
  - es. `it`

### Opzionali

- `domain_hint`
  - `smartdesk`
  - `suite`
  - `translator`
  - `marketing`
- `mode`
  - `audit_only`
  - `propose_patch`
- `branch_overrides`
- `protected_terms`
- `do_not_translate`

## Output

```json
{
  "status": "ok",
  "core_mode": "local_2_0",
  "selected_branches": [
    "branch_router_v2",
    "ramo_testo",
    "claim_guard",
    "codex_local_change",
    "audit_evidence"
  ],
  "winner_family_id": "mixed_language_fallback",
  "review_required": false,
  "items": [
    {
      "file": "src/renderer/pages/ClientDetailPage.tsx",
      "line": 455,
      "kind": "visible_ui_label",
      "source": "Client Intelligence",
      "suggested": "Lettura cliente",
      "risk": "low",
      "reason": "english residue in Italian UI",
      "do_not_translate": false
    }
  ],
  "protected_terms": ["Gold", "WhatsApp", "Skin Pro"],
  "build_check": "pending",
  "audit_report_path": "reports/localization/....json"
}
```

## Rami Core minimi

Sempre:

- `branch_router_v2`
- `ramo_testo`
- `codex_local_change`
- `audit_evidence`

Condizionali:

- `claim_guard`
- `marketing_intelligence`
- `wordpress`
- `release_update_governance`

## Famiglie scenario minime

1. `ui_visible_copy`
2. `mixed_language_fallback`
3. `brand_protected_terms`
4. `software_non_translatable`
5. `claim_sensitive_copy`
6. `cross_surface_consistency`

## Worker model

### Codex

Fa:

- scan iniziale
- costruzione payload
- chiamata Core 2.0
- assegnazione worker
- raccolta evidenze finali

### AI worker testo

Fa:

- suggerimento traduzione
- rewrite UI
- tono naturale

### AI worker codice

Fa:

- patch candidate
- sostituzione mirata
- build/check

### Owner

Fa:

- approvazione se:
  - rischio medio/alto
  - claim
  - brand ambiguity
  - release candidate

## Non obiettivi

- non deploya
- non scrive su Render
- non aggiorna WordPress remoto
- non tocca chiavi
- non promuove regole permanenti

## Verifica minima

1. scan completato
2. selected branches presenti
3. family winner presente
4. protected terms rispettati
5. nessuna patch su token/placeholder
6. se `propose_patch`, build/check passano

## Passo successivo

Dopo `localize-ui-audit`:

- `localize-ui-fix`
- poi `localize-wordpress-structured`
- poi `localize-release-check`
